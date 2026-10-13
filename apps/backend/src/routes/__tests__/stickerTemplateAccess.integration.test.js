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

const design = (text) => ({ version: 2, media: { widthMm: 75, heightMm: 125, orientation: 'landscape' }, copies: 1, elements: [{ id: 't', type: 'text', text }] });

test('label variants: one save stores every variant and makes the chosen one the live design', async () => {
  const f = await fixture({ settings: 1, 'settings.edit': 1 }, 'designer'); const cookie = await login(f.app);
  const variants = [{ id: 'standard', name: 'Standard', template: design('STANDARD') }, { id: 'v-plain', name: 'Plain', template: design('PLAIN') }];
  const saved = await request(f.app).put('/api/sticker_templates/holo_issue/variants').set('Cookie', cookie).send({ activeId: 'v-plain', variants }).expect(200);
  assert.equal(saved.body.template.stageKey, 'v2:holo_issue');
  assert.equal(f.templates.get('v2:holo_issue').content.elements[0].text, 'PLAIN', 'the variant in use is the live design');
  assert.equal(JSON.stringify(f.templates.get('v2v:holo_issue').content.variants.map((v) => v.name)), JSON.stringify(['Standard', 'Plain']));
  assert.equal(f.templates.get('v2v:holo_issue').content.activeId, 'v-plain');
  assert.equal(f.templates.get('holo_issue').content.texts[0].value, 'SAVED FIXTURE {itemName}', 'the legacy design is untouched');
  // A stage reader (an operator who prints) can read the variants record like the live design.
  const operator = await fixture({ 'issue.holo': 1 }); const opCookie = await login(operator.app);
  operator.templates.set('v2v:holo_issue', f.templates.get('v2v:holo_issue'));
  await request(operator.app).get('/api/sticker_templates/v2v:holo_issue').set('Cookie', opCookie).expect(200);
  await request(operator.app).get('/api/sticker_templates/v2v:inbound').set('Cookie', opCookie).expect(403);
  await request(operator.app).put('/api/sticker_templates/holo_issue/variants').set('Cookie', opCookie).send({ activeId: 'standard', variants }).expect(403);
});

test('label variants: invalid saves are refused and write nothing', async () => {
  const f = await fixture({ settings: 1, 'settings.edit': 1 }, 'designer'); const cookie = await login(f.app);
  const writes = f.calls.writes;
  const ok = { id: 'standard', name: 'Standard', template: design('A') };
  for (const [path, body] of [
    ['unknown_stage', { activeId: 'standard', variants: [ok] }],
    ['__proto__', { activeId: 'standard', variants: [ok] }],
    ['holo_issue', { activeId: 'missing', variants: [ok] }],
    ['holo_issue', { activeId: 'standard', variants: [] }],
    ['holo_issue', { activeId: 'standard', variants: [ok, { ...ok }] }],
    ['holo_issue', { activeId: 'standard', variants: [ok, { id: 'other', name: 'standard', template: design('B') }] }],
    ['holo_issue', { activeId: 'standard', variants: [{ id: 'Bad Id!', name: 'X', template: design('A') }] }],
    ['holo_issue', { activeId: 'standard', variants: [{ id: 'standard', name: 'Old', template: { texts: [] } }] }],
    ['holo_issue', { activeId: 'standard', variants: Array.from({ length: 21 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, template: design('A') })) }],
  ]) {
    const response = await request(f.app).put(`/api/sticker_templates/${path}/variants`).set('Cookie', cookie).send(body);
    assert.ok([400, 404].includes(response.status), `${path} ${JSON.stringify(body).slice(0, 60)} -> ${response.status}`);
  }
  assert.equal(f.calls.writes, writes);
  assert.equal(f.templates.has('v2v:holo_issue'), false);
});
