import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../../lib/prisma.js';
import telegram from '../../../telegram/service.js';
import router from '../index.js';

// Prisma model delegates are proxies without method property descriptors.
function stubPrisma(t, target, method, implementation) {
  const original = target[method];
  target[method] = implementation;
  t.after(() => { target[method] = original; });
}

const route = router.stack.find((entry) => entry.route?.path === '/api/receive_from_coning_machine/manual');
const receive = route.route.stack.at(-1).handle;

for (const shift of ['Day', 'Night', null, undefined, '']) {
  test(`Coning Receive notification uses committed issue shift (${String(shift)})`, async (t) => {
    const issue = {
      id: 'fixture-issue', itemId: 'fixture-item', lotNo: '167',
      date: '2026-10-15', shift, receivedRowRefs: [],
    };
    const createdRow = {
      id: 'fixture-row', barcode: 'RCO-42-C001',
      grossWeight: 12, tareWeight: 1, netWeight: 11,
    };
    // The handler receives the saved transaction result; no receive, stock,
    // template, audit, or delivery-log data is written to a real database.
    t.mock.method(prisma, '$transaction', async () => ({ issue, createdRow, pieceTotal: {} }));
    stubPrisma(t, prisma.issueTakeBack, 'findMany', async () => []);
    stubPrisma(t, prisma.receiveFromConingMachineRow, 'findMany', async () => []);
    stubPrisma(t, prisma.receiveFromConingMachinePieceTotal, 'findMany', async () => []);
    stubPrisma(t, prisma.auditLog, 'create', async () => ({}));
    stubPrisma(t, prisma.item, 'findUnique', async () => ({ name: 'Fixture item' }));
    stubPrisma(t, prisma.whatsappTemplate, 'findUnique', async () => ({
      id: 7, event: 'receive_from_coning_machine_created', enabled: true,
      template: '🕒 *Shift:* @shift\n📅 *Date:* @date', telegramChatIds: ['fixture-chat'],
    }));
    stubPrisma(t, prisma.settings, 'findUnique', async () => ({
      whatsappEnabled: false, telegramEnabled: true, telegramChatIds: ['fixture-chat'],
    }));
    stubPrisma(t, prisma.notificationDeliveryLog, 'createMany', async () => ({}));
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('Real network sends are forbidden in this test'); });
    let completeSend;
    const sent = new Promise((resolve) => { completeSend = resolve; });
    t.mock.method(telegram, 'sendTextSafe', async (chatId, text, options) => {
      completeSend({ chatId, text, options });
      return { message_id: 1 };
    });
    const setTimeout = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (...args) => setTimeout(...args).unref());
    const req = { body: {
      issueId: issue.id, pieceId: issue.id, coneCount: 24, grossWeight: 12,
      // A receipt's date or supplied shift must never determine the issue shift.
      date: '2026-10-17', shift: 'Wrong request shift',
    } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await receive(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.row, createdRow);
    const message = await sent;
    assert.equal(message.chatId, 'fixture-chat');
    assert.equal(message.text, `🕒 Shift: ${shift || '—'}\n📅 Date: 17/10/2026`);
    assert.deepEqual(message.options.entities, [
      { type: 'bold', offset: 3, length: 6 },
      { type: 'bold', offset: `🕒 Shift: ${shift || '—'}\n📅 `.length, length: 5 },
    ]);
    // Allow fire-and-forget send/log work to settle before restoring mocks.
    await new Promise(setImmediate);
  });
}
