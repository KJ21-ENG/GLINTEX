import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, login, TEMPLATE_STAGES } from './helpers/desktopAuthFixture.js';

// Expected policy is independent of the middleware's map.
const stages = {
  inbound: 'inbound', cutter_issue: 'issue.cutter', cutter_issue_small: 'issue.cutter',
  holo_issue: 'issue.holo', coning_issue: 'issue.coning', cutter_receive: 'receive.cutter',
  holo_receive: 'receive.holo', coning_receive: 'receive.coning', coning_receive_small: 'receive.coning',
};
for (const permission of [...new Set(Object.values(stages)), 'stock', 'opening_stock', 'settings', 'reports']) {
  for (const level of [1, 2]) {
    test(`${permission} level ${level}: only applicable template reads, with no added Settings access`, async () => {
      const f = await fixture({ [permission]: level }); const cookie = await login(f.app);
      let allowedReads = 0;
      for (const [stage, required] of Object.entries(stages)) {
        const allowed = permission === required || permission === 'stock' || permission === 'settings'
          || (permission === 'opening_stock' && (required === 'inbound' || required.startsWith('receive.')));
        const result = await request(f.app).get(`/api/sticker_templates/${stage}`).set('Cookie', cookie).expect(allowed ? 200 : 403);
        if (allowed) { allowedReads++; assert.equal(result.body.template.stageKey, stage); }
      }
      assert.equal(f.calls.reads, allowedReads);
      await request(f.app).get('/api/sticker_templates').set('Cookie', cookie).expect(permission === 'settings' ? 200 : 403);
      // Even Settings-write alone still needs the existing explicit edit action.
      await request(f.app).put('/api/sticker_templates/inbound').set('Cookie', cookie)
        .send({ dimensions: {}, content: {} }).expect(403);
      assert.equal(f.calls.writes, 0);
      await request(f.app).post('/fixture/receive').set('Cookie', cookie).expect(permission === 'receive.cutter' && level === 2 ? 200 : 403);
    });
  }
}

test('authenticated no-access users and unauthenticated/expired/disabled sessions are rejected before template reads', async () => {
  const f = await fixture({}); const cookie = await login(f.app);
  for (const stage of TEMPLATE_STAGES) {
    await request(f.app).get(`/api/sticker_templates/${stage}`).expect(401);
    await request(f.app).get(`/api/sticker_templates/${stage}`).set('Cookie', cookie).expect(403);
  }
  f.users[0].roles[0].role.permissions.inbound = 2;
  f.sessions[0].expiresAt = new Date(Date.now() - 1000);
  await request(f.app).get('/api/sticker_templates/inbound').set('Cookie', cookie).expect(401);
  f.sessions[0].expiresAt = new Date(Date.now() + 60000); f.users[0].isActive = false;
  await request(f.app).get('/api/sticker_templates/inbound').set('Cookie', cookie).expect(403);
  assert.equal(f.calls.reads, 0);
});

test('admin and Settings designer retain read/edit controls; unknown keys and missing saved templates fail closed', async () => {
  for (const [roleKey, permission] of [['admin', {}], ['designer', { settings: 1, 'settings.edit': 1 }], ['stock-reader', { stock: 1 }]]) {
    const f = await fixture(permission, roleKey); const cookie = await login(f.app);
    for (const stage of TEMPLATE_STAGES) await request(f.app).get(`/api/sticker_templates/${stage}`).set('Cookie', cookie).expect(200);
    const reads = f.calls.reads;
    for (const key of ['unknown', '__proto__', 'constructor', 'toString', 'cutter_receive_extra', 'INBOUND']) {
      await request(f.app).get(`/api/sticker_templates/${key}`).set('Cookie', cookie).expect(404);
    }
    assert.equal(f.calls.reads, reads);
    f.templates.delete('inbound');
    await request(f.app).get('/api/sticker_templates/inbound').set('Cookie', cookie).expect(404);
    const designer = roleKey !== 'stock-reader';
    await request(f.app).get('/api/sticker_templates').set('Cookie', cookie).expect(designer ? 200 : 403);
    await request(f.app).put('/api/sticker_templates/inbound').set('Cookie', cookie)
      .send({ dimensions: { width: 48 }, content: { texts: [] } }).expect(designer ? 200 : 403);
    assert.equal(f.calls.writes, designer ? 1 : 0);
  }
});
