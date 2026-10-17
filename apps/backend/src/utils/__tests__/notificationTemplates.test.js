import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import prisma from '../../lib/prisma.js';
import whatsapp from '../../../whatsapp/service.js';
import telegram from '../../../telegram/service.js';
import { buildTelegramMessage, buildWhatsappMessage, sendNotification } from '../notifications.js';
import { runPrimarySequence } from '../telegramScheduler.js';
import { interpolateTelegramTemplate, interpolateTemplate } from '../whatsappTemplates.js';

// Prisma model delegates are proxies without method property descriptors.
function stubPrisma(t, target, method, implementation) {
  const original = target[method];
  target[method] = implementation;
  t.after(() => { target[method] = original; });
}

const event = 'receive_from_coning_machine_created';
const seed = readFileSync(new URL('../../../scripts/seedWhatsappTemplates.mjs', import.meta.url), 'utf8');
// Evaluate just the default's string expression; never import or run the seed.
const expression = seed.split(`event: '${event}'`)[1].match(/template: ([\s\S]+?)\n    },/)[1];
const template = runInNewContext(expression);
const payload = {
  itemName: 'Silver *Premium* A_B [24] & <b>raw</b>',
  lotNo: '167', netWeight: 12.3456, coneCount: 24,
  machineName: 'C-1', operatorName: 'Ravi', barcode: 'RCO-42-C001',
  shift: 'Night', date: '2026-10-16',
};

function boldSections(message) {
  return message.entities.map(({ offset, length }) => message.text.slice(offset, offset + length));
}

test('Coning Receive default renders Shift before Date and preserves WhatsApp markup', async () => {
  const whatsappMessage = await buildWhatsappMessage(template, payload);
  const message = await buildTelegramMessage(template, payload);
  assert.equal(whatsappMessage, '*Coning Receive Confirmation*\n\n'
    + `📦 *Item:* ${payload.itemName}\n`
    + '🔢 *Lot:* 167\n⚖️ *Net Weight:* *12.346 kg*\n🍦 *Cones:* 24\n'
    + '🏗️ *Machine:* C-1\n👤 *Operator:* Ravi\n🏷️ *Barcode:* RCO-42-C001\n'
    + '🕒 *Shift:* Night\n📅 *Date:* 16/10/2026');
  assert.equal(message.text, 'Coning Receive Confirmation\n\n'
    + `📦 Item: ${payload.itemName}\n`
    + '🔢 Lot: 167\n⚖️ Net Weight: 12.346 kg\n🍦 Cones: 24\n'
    + '🏗️ Machine: C-1\n👤 Operator: Ravi\n🏷️ Barcode: RCO-42-C001\n'
    + '🕒 Shift: Night\n📅 Date: 16/10/2026');
  assert.deepEqual(boldSections(message), [
    'Coning Receive Confirmation', 'Item:', 'Lot:', 'Net Weight:', '12.346 kg',
    'Cones:', 'Machine:', 'Operator:', 'Barcode:', 'Shift:', 'Date:',
  ]);
});

test('Telegram offsets and lengths use UTF-16 with emoji before and inside bold', () => {
  const message = interpolateTelegramTemplate('😀 *A* 👩🏽‍🔧 *{{ itemName }}* 🕒 *Shift:* @shift', {
    itemName: '🧵 A*B* & <tag>', shift: 'Day',
  });
  assert.equal(message.text, '😀 A 👩🏽‍🔧 🧵 A*B* & <tag> 🕒 Shift: Day');
  assert.deepEqual(message.entities, [
    { type: 'bold', offset: 3, length: 1 },
    { type: 'bold', offset: '😀 A 👩🏽‍🔧 '.length, length: '🧵 A*B* & <tag>'.length },
    { type: 'bold', offset: '😀 A 👩🏽‍🔧 🧵 A*B* & <tag> 🕒 '.length, length: 6 },
  ]);
});

test('Template rendering preserves punctuation, literal stars, and unformatted values', () => {
  const source = '2 * 3 = 6; SKU*24; **; unmatched *; \\*literal\\*; <tag> & [x]_!\n*Item:* @itemName';
  const message = interpolateTelegramTemplate(source, { itemName: 'A * B * C; <b>&</b>_*' });
  assert.equal(message.text, '2 * 3 = 6; SKU*24; **; unmatched *; \\*literal\\*; <tag> & [x]_!\nItem: A * B * C; <b>&</b>_*');
  assert.deepEqual(boldSections(message), ['Item:']);
  assert.deepEqual(interpolateTelegramTemplate('*@missing* text @list', { list: ['A', 'B'] }), {
    text: ' text A, B', entities: [],
  });
  assert.equal(interpolateTemplate('@date @weight @machineName', {
    date: '2026-10-16', weight: 2, machineName: null,
  }), '16/10/2026 2.000 —');
});

test('Telegram truncation clips bold spans, drops later spans, and keeps surrogate pairs intact', () => {
  const message = interpolateTelegramTemplate(`${'x'.repeat(1490)} *{{ itemName }}* *Later*`, {
    itemName: '12345678😀 more',
  });
  assert.equal(message.text, `${'x'.repeat(1490)} 12345678`);
  assert.deepEqual(message.entities, [{ type: 'bold', offset: 1491, length: 8 }]);
  assert.equal(message.text.isWellFormed(), true);
});

test('Creator labels stay literal and explicit creator variables do not get duplicated', async (t) => {
  stubPrisma(t, prisma.user, 'findUnique', async () => ({
    id: 'creator-fixture', displayName: 'Ravi *Lead* & <team>', username: 'ravi',
  }));
  const creatorPayload = { createdByUserId: 'creator-fixture' };
  const automatic = await buildTelegramMessage('*Saved*', creatorPayload);
  assert.equal(automatic.text, 'Saved\nCreated by: Ravi *Lead* & <team> (ravi)');
  assert.deepEqual(boldSections(automatic), ['Saved']);
  const explicit = await buildTelegramMessage('*By:* *{{ createdByLabel }}*', creatorPayload);
  assert.equal(explicit.text, 'By: Ravi *Lead* & <team> (ravi)');
  assert.deepEqual(boldSections(explicit), ['By:', 'Ravi *Lead* & <team> (ravi)']);
});

test('Notification delivery sends native entities to Telegram and unchanged text to WhatsApp', async (t) => {
  const requests = [];
  const whatsappSends = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  });
  stubPrisma(t, prisma.whatsappTemplate, 'findUnique', async () => ({
    id: 7, event, enabled: true, template,
    sendToPrimary: true, groupIds: ['wa-allowed', 'wa-blocked'],
    telegramChatIds: ['tg-allowed', 'tg-blocked', 'tg-allowed'],
  }));
  stubPrisma(t, prisma.settings, 'findUnique', async () => ({
    whatsappEnabled: true, whatsappNumber: 'fixture-number', whatsappGroupIds: ['wa-allowed'],
    telegramEnabled: true, telegramChatIds: ['tg-allowed'], telegramBotToken: 'fixture-token',
  }));
  stubPrisma(t, prisma.notificationDeliveryLog, 'createMany', async () => ({ count: 3 }));
  t.mock.method(whatsapp, 'sendTextSafe', async (...args) => whatsappSends.push(args));
  t.mock.method(whatsapp, 'sendToChatIdSafe', async (...args) => whatsappSends.push(args));
  // Keep notification timeout promises from holding the test process open.
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (...args) => setTimeout(...args).unref());

  const result = await sendNotification(event, payload);
  assert.equal(result.ok, true);
  const expectedWhatsapp = await buildWhatsappMessage(template, payload);
  assert.deepEqual(whatsappSends, [['fixture-number', expectedWhatsapp], ['wa-allowed', expectedWhatsapp]]);
  assert.equal(requests.length, 1, 'template routing still intersects the allow-list');
  assert.match(requests[0].url, /\/botfixture-token\/sendMessage$/);
  const body = requests[0].body;
  const expectedTelegram = await buildTelegramMessage(template, payload);
  assert.deepEqual(body, {
    chat_id: 'tg-allowed', text: expectedTelegram.text,
    disable_web_page_preview: true, entities: expectedTelegram.entities,
  });
  assert.equal(Object.hasOwn(body, 'parse_mode'), false);
});

test('Ordinary Telegram and cron sends remain plain even when text has stars and HTML', async (t) => {
  const requests = [];
  const text = '*Reminder* A_B & <tag> 😀';
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 2 } }) };
  });
  stubPrisma(t, prisma.settings, 'findUnique', async () => ({
    telegramEnabled: true, telegramBotToken: 'fixture-token', telegramCronEnabled: true,
    telegramCronChatId: 'fixture-chat', telegramCronMessage: text,
  }));
  stubPrisma(t, prisma.telegramCronLog, 'upsert', async () => ({}));
  await telegram.sendTextSafe('fixture-chat', text);
  await runPrimarySequence();
  assert.equal(requests.length, 2);
  for (const body of requests) {
    assert.deepEqual(body, { chat_id: 'fixture-chat', text, disable_web_page_preview: true });
  }
});
