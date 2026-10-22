import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { resolveTemplateTelegramRecipients } from '../../utils/notifications.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function retiredRoutes() {
  const app = express();
  const router = express.Router();
  const pass = (_req, _res, next) => next();
  const context = vm.createContext({ router, requireAuth: pass, requirePermission: () => pass, PERM_READ: 1, PERM_WRITE: 2 });
  vm.runInContext(section('// Older desktop clients still ask for status', "router.get('/api/telegram/status'"), context);
  vm.runInContext(section('// Retired connection, contact, and direct-send endpoints', "router.post('/api/lots'"), context);
  vm.runInContext(section('// Historical customer document sends remain available', '// Get document send history'), context);
  app.use(router);
  return app;
}

test('Retired WhatsApp controls and direct document sender cannot create sessions or send', async () => {
  const app = retiredRoutes();
  for (const path of ['/api/whatsapp/start', '/api/whatsapp/logout', '/api/whatsapp/send-test', '/api/documents/send']) {
    const response = await request(app).post(path).send({ force: true });
    assert.equal(response.status, 410, path);
    assert.match(response.body.error, /removed/);
  }
  for (const path of ['/api/whatsapp/qrcode', '/api/whatsapp/contacts', '/api/whatsapp/groups']) {
    await request(app).get(path).expect(410);
  }
  const status = await request(app).get('/api/whatsapp/status').expect(200);
  assert.deepEqual(status.body, { status: 'retired', retired: true });
});

test('Summary media keeps Telegram routing, caption, and per-template allow-list', async () => {
  const sent = [];
  const context = vm.createContext({
    getNotificationChannelConfig: settings => ({ telegramEnabled: settings.telegramEnabled === true }),
    resolveTemplateTelegramRecipients,
    telegram: { sendMediaSafe: async (...args) => { sent.push(args); } },
  });
  vm.runInContext(section('async function dispatchMediaByChannels(', '// Older desktop clients still ask for status'), context);
  const buffer = Buffer.from('fixture pdf');
  const parameters = {
    settings: { whatsappEnabled: true, telegramEnabled: true, telegramChatIds: ['allowed'] },
    template: { telegramChatIds: ['allowed', 'blocked', 'allowed'] },
    buffer, filename: 'summary.pdf', mimetype: 'application/pdf', caption: 'Fixture summary',
  };
  const result = await context.dispatchMediaByChannels(parameters);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.channels), ['telegram']);
  assert.deepEqual(sent, [['allowed', buffer, 'summary.pdf', 'application/pdf', 'Fixture summary']]);
  const blocked = await context.dispatchMediaByChannels({ ...parameters, template: { telegramChatIds: ['blocked'] } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.channels.telegram.reason, 'no_recipients');
  assert.equal(sent.length, 1);
  const disabled = await context.dispatchMediaByChannels({ ...parameters, settings: { whatsappEnabled: true, telegramEnabled: false } });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, 'no_enabled_channels');
  assert.equal(sent.length, 1);
});
