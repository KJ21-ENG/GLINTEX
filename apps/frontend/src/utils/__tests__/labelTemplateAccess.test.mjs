// Real authenticated template route + actual loader/print callers; only persistence,
// rendering and physical printer sinks are simulated. No production I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fixture, login, TEMPLATE_STAGES } from '../../../../backend/src/routes/__tests__/helpers/desktopAuthFixture.js';
import { runPostCommitPrint, refreshAfterCommit } from '../postCommitPrint.js';
const require = createRequire(import.meta.url);
const { assertPermission } = require('../../../../desktop/src/authorization.cjs');
const source = readFileSync(new URL('../labelPrint.js', import.meta.url), 'utf8');
const names = [...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
const executable = source.replace(/import[\s\S]*?from ['"][^'"]+['"];\n/g, '')
  .replace(/import\.meta(?:\?)?\.env/g, '({})').replace(/export const /g, 'const ')
  .replace(/export default \{[\s\S]*?\};/g, '');

function printFixture(f, cookie, platform, role) {
  const submissions = [], rendered = [], events = [];
  const window = { location: { origin: 'http://fixture.invalid', protocol: 'http:', hostname: 'fixture.invalid' },
    localStorage: { getItem: key => key === 'useBitmapPrint' ? 'false' : '', setItem() {} },
    dispatchEvent: event => events.push(event.type) };
  let printerFails = false;
  if (platform === 'Electron') window.glintexDesktop = { printers: {
    status: async () => ({ profile: { printerName: 'Fixture printer', dpi: 203 } }),
    submit: async ({ artifact }) => {
      assertPermission({ id: 'user-test', permissions: role }, 'printers.submit', artifact.stageKey);
      submissions.push(artifact); return { success: !printerFails, error: printerFails ? 'Fixture printer failure' : undefined };
    },
  } };
  const context = vm.createContext({ window, console: { ...console, info() {} }, TextEncoder, Uint8Array, AbortController, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type) { this.type = type; } }, formatDateDDMMYYYY: String,
    buildPrintableArtifact: async (template, data, options) => {
      assert.match(template.content.texts[0].value, /^SAVED FIXTURE/);
      rendered.push(template); return { stageKey: options.stageKey, savedText: template.content.texts[0].value };
    },
    fetch: async (url, options = {}) => {
      if (url.startsWith('http://fixture.invalid/api/')) return f.fetchTemplate(url, options, cookie);
      assert.equal(platform, 'browser'); assert.equal(url, 'http://printer.invalid/print');
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body); assert.match(payload.content, /SAVED FIXTURE/);
      submissions.push(payload); return { json: async () => ({ success: !printerFails, error: printerFails ? 'Fixture printer failure' : undefined }) };
    },
  });
  vm.runInContext(`globalThis.labels = (() => {${executable}\nreturn {${names.join(',')}};})();`, context);
  return { context, labels: context.labels, submissions, rendered, events, failPrinter: () => { printerFails = true; } };
}
const printOptions = { apiBase: 'http://fixture.invalid/api', serviceBase: 'http://printer.invalid' };
for (const platform of ['browser', 'Electron']) {
  for (const [name, role, stage] of [
    ['stage reader', { 'receive.cutter': 1 }, 'cutter_receive'],
    ['stage writer', { inbound: 2 }, 'inbound'],
    ['stock reader', { stock: 1 }, 'coning_receive_small'],
    ['opening-stock reader', { opening_stock: 1 }, 'holo_receive'],
  ]) {
    test(`${platform}: ${name} without Settings prints the saved template once`, async () => {
      const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
      assert.deepEqual(Object.values(p.labels.LABEL_STAGE_KEYS).sort(), [...TEMPLATE_STAGES].sort());
      const result = await p.labels.printStageTemplatesBatch(stage, [{ itemName: 'Test' }], printOptions);
      assert.equal(result.success, true); assert.equal(f.calls.reads, 1); assert.equal(p.submissions.length, 1);
      assert.equal(f.calls.writes, 0); assert.equal(f.calls.lists, 0);
    });
  }
  test(`${platform}: wrong stage, unknown stage, missing saved template and expired auth never print fallback artwork`, async () => {
    const role = { inbound: 2 }; const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
    await assert.rejects(p.labels.printStageTemplatesBatch('cutter_receive', [{}], printOptions), /403/);
    await assert.rejects(p.labels.printStageTemplatesBatch('inbound_extra', [{}], printOptions), /404/);
    f.templates.delete('inbound');
    await assert.rejects(p.labels.printStageTemplatesBatch('inbound', [{}], printOptions), /404/);
    f.sessions[0].expiresAt = new Date(Date.now() - 1000);
    await assert.rejects(p.labels.printStageTemplatesBatch('inbound', [{}], printOptions), /401/);
    assert.equal(p.submissions.length, 0); assert.equal(p.rendered.length, 0); assert.deepEqual(p.events, ['glintex:auth:unauthorized']);
    assert.equal(f.calls.writes, 0);
  });
  for (const outcome of ['success', 'missing template', 'printer failure']) {
    test(`${platform}: actual Inbound save finalizes receipt once before optional printing (${outcome})`, async () => {
      const role = { inbound: 2 }; const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
      if (outcome === 'missing template') f.templates.delete('inbound');
      if (outcome === 'printer failure') p.failPrinter();
      let saves = 0; const notices = [], order = [];
      Object.assign(p.context, {
        runPostCommitPrint, refreshAfterCommit, LABEL_STAGE_KEYS: p.labels.LABEL_STAGE_KEYS, readOnly: false, canSave: true, wrapSaveLot: fn => fn,
        cart: [{ weight: 12.3 }], date: '2026-10-05', itemId: 'item', firmId: 'firm', supplierId: 'supplier', previewLotNo: '001', db: {},
        createLot: async () => { saves++; order.push('commit'); return { res: { lot: { lotNo: '001' } }, db: { inbound_items: [{ id: '001-1', lotNo: '001', seq: 1, weight: 12.3 }], items: [] } }; },
        setSaving() {}, setCart: () => { p.context.cart = []; p.context.canSave = false; order.push('reset'); },
        setWeight() {}, setDate() {}, setItemId() {}, setFirmId() {}, setSupplierId() {}, weightRef: { current: null }, todayISO: () => '2026-10-05', fetchSequence: async () => {},
        loadTemplate: async stage => { order.push('load'); return p.labels.loadTemplate(stage, printOptions); },
        printStageTemplatesBatch: (stage, data, options) => p.labels.printStageTemplatesBatch(stage, data, { ...printOptions, ...options }),
        alert: message => notices.push(message),
      });
      p.context.window.confirm = () => true;
      const inbound = readFileSync(new URL('../../pages/Inbound.jsx', import.meta.url), 'utf8');
      const start = inbound.indexOf('    const handleSaveLot ='), end = inbound.indexOf('    const addCutterCrate =', start);
      assert.ok(start >= 0 && end > start);
      vm.runInContext(inbound.slice(start, end) + '\nglobalThis.invoke = handleSaveLot;', p.context);
      await p.context.invoke(); await p.context.invoke();
      assert.equal(saves, 1); assert.equal(p.context.cart.length, 0); assert.deepEqual(order, ['commit', 'reset', 'load']);
      assert.equal(f.calls.writes, 0);
      assert.equal(p.submissions.length, outcome === 'missing template' ? 0 : 1);
      if (outcome === 'success') assert.equal(notices.length, 0);
      else { assert.match(notices.at(-1), /was saved.*labels failed/); assert.match(notices.at(-1), /do not save the lot again/); }
    });
  }
}
