// Real authenticated template route + the actual print module and Inbound save handler.
// Only persistence, text measurement, fonts and the physical printer are simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fixture, login, TEMPLATE_STAGES } from '../../../../backend/src/routes/__tests__/helpers/desktopAuthFixture.js';
import { runPostCommitPrint, refreshAfterCommit } from '../postCommitPrint.js';
import * as labels from '../labelPrint.js';
import { createEstimateMeasurer } from '../label/layout.js';
const require = createRequire(import.meta.url);
const { assertPermission } = require('../../../../desktop/src/authorization.cjs');

labels.setLabelPrintSupport({ measurer: createEstimateMeasurer(), loadEmbeddedFonts: async () => [], ensureFontsReady: async () => {} });

// A minimal document whose hidden print frame "prints" by recording its document.
function fakeDocument(submissions, shouldFail) {
  const body = { appendChild(frame) { setTimeout(() => frame.listeners.load?.(), 0); } };
  return {
    body,
    createElement: () => {
      const frame = {
        listeners: {}, style: {}, srcdoc: '', setAttribute() {}, remove() {},
        addEventListener(type, fn) { frame.listeners[type] = fn; },
      };
      frame.contentWindow = {
        document: { fonts: { ready: Promise.resolve() }, images: [] },
        addEventListener(type, fn) { frame.listeners[type] = fn; },
        focus() {},
        print() { submissions.push({ srcdoc: frame.srcdoc }); if (shouldFail()) throw new Error('Fixture print dialog failure'); setTimeout(() => frame.listeners.afterprint?.(), 0); },
      };
      return frame;
    },
  };
}

function printFixture(f, cookie, platform, role) {
  const submissions = [], events = [];
  let printerFails = false;
  const window = {
    location: { origin: 'http://fixture.invalid', protocol: 'http:', hostname: 'fixture.invalid' },
    dispatchEvent: (event) => events.push(event.type),
    addEventListener() {}, removeEventListener() {},
  };
  if (platform === 'Electron') window.glintexDesktop = { printers: {
    status: async () => ({ profile: { printerName: 'Fixture printer', dpi: 203 } }),
    submit: async ({ artifact }) => {
      assertPermission({ id: 'user-test', permissions: role }, 'printers.submit', artifact.templateSnapshot.stageKey);
      assert.equal(artifact.version, 2);
      assert.match(artifact.pages[0].html, /SAVED FIXTURE/);
      submissions.push(artifact); return { success: !printerFails, error: printerFails ? 'Fixture printer failure' : undefined };
    },
  } };
  globalThis.window = window;
  globalThis.document = platform === 'browser' ? fakeDocument(submissions, () => printerFails) : undefined;
  globalThis.fetch = async (url, options = {}) => {
    assert.ok(String(url).startsWith('http://fixture.invalid/api/'), `unexpected request ${url}`);
    return f.fetchTemplate(url, options, cookie);
  };
  return { submissions, events, failPrinter: () => { printerFails = true; } };
}
const printOptions = { apiBase: 'http://fixture.invalid/api' };

test('every stage key has a template permission mapping and version 2 rows are namespaced', () => {
  assert.deepEqual(Object.values(labels.LABEL_STAGE_KEYS).sort(), [...TEMPLATE_STAGES].sort());
  assert.equal(labels.templateStorageKey('inbound'), 'v2:inbound');
});

for (const platform of ['browser', 'Electron']) {
  for (const [name, role, stage] of [
    ['stage reader', { 'receive.cutter': 1 }, 'cutter_receive'],
    ['stage writer', { inbound: 2 }, 'inbound'],
    ['stock reader', { stock: 1 }, 'coning_receive_small'],
    ['opening-stock reader', { opening_stock: 1 }, 'holo_receive'],
  ]) {
    test(`${platform}: ${name} without Settings prints the converted legacy design once`, async () => {
      const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
      const result = await labels.printStageTemplatesBatch(stage, [{ itemName: 'Test' }], printOptions);
      assert.equal(result.success, true);
      assert.equal(f.calls.reads, 2, 'version 2 miss, then the legacy row');
      assert.equal(p.submissions.length, 1);
      if (platform === 'browser') assert.match(p.submissions[0].srcdoc, /SAVED FIXTURE/);
      assert.equal(f.calls.writes, 0); assert.equal(f.calls.lists, 0);
    });
  }
  test(`${platform}: saved version 2 rows win over legacy rows`, async () => {
    const role = { inbound: 2 }; const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
    const v2 = labels.normalizeTemplate({ version: 2, media: { widthMm: 50, heightMm: 25, orientation: 'portrait' }, elements: [{ id: 't', type: 'text', text: 'SAVED FIXTURE V2', x: 1, y: 1, w: 40, h: 6 }] });
    f.templates.set('v2:inbound', { id: 'v2', stageKey: 'v2:inbound', dimensions: { version: 2, ...v2.media }, content: v2 });
    const loaded = await labels.loadTemplateWithOrigin('inbound', printOptions);
    assert.equal(loaded.origin, 'saved');
    assert.equal(loaded.template.elements[0].text, 'SAVED FIXTURE V2');
    assert.equal(f.calls.reads, 1);
    await labels.printStageTemplatesBatch('inbound', [{}], printOptions);
    assert.equal(p.submissions.length, 1);
  });
  test(`${platform}: wrong stage, unknown stage, missing saved template and expired auth never print fallback artwork`, async () => {
    const role = { inbound: 2 }; const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
    await assert.rejects(labels.printStageTemplatesBatch('cutter_receive', [{}], printOptions), (e) => e.status === 403);
    await assert.rejects(labels.printStageTemplatesBatch('inbound_extra', [{}], printOptions), (e) => e.status === 404);
    f.templates.delete('inbound');
    await assert.rejects(labels.printStageTemplatesBatch('inbound', [{}], printOptions), (e) => e.status === 404 && /No saved label design/.test(e.message));
    f.sessions[0].expiresAt = new Date(Date.now() - 1000);
    await assert.rejects(labels.printStageTemplatesBatch('inbound', [{}], printOptions), (e) => e.status === 401);
    assert.equal(p.submissions.length, 0); assert.deepEqual(p.events, ['glintex:auth:unauthorized']);
    assert.equal(f.calls.writes, 0);
  });
  for (const outcome of ['success', 'missing template', 'printer failure']) {
    test(`${platform}: actual Inbound save finalizes receipt once before optional printing (${outcome})`, async () => {
      const role = { inbound: 2 }; const f = await fixture(role); const cookie = await login(f.app); const p = printFixture(f, cookie, platform, role);
      if (outcome === 'missing template') f.templates.delete('inbound');
      if (outcome === 'printer failure') p.failPrinter();
      let saves = 0; const notices = [], order = [];
      const context = vm.createContext({
        console, setTimeout, clearTimeout, window: globalThis.window,
        runPostCommitPrint, refreshAfterCommit, LABEL_STAGE_KEYS: labels.LABEL_STAGE_KEYS, readOnly: false, canSave: true, wrapSaveLot: fn => fn,
        cart: [{ weight: 12.3 }], date: '2026-10-05', itemId: 'item', firmId: 'firm', supplierId: 'supplier', previewLotNo: '001', db: {},
        createLot: async () => { saves++; order.push('commit'); return { res: { lot: { lotNo: '001' } }, db: { inbound_items: [{ id: '001-1', lotNo: '001', seq: 1, weight: 12.3 }], items: [] } }; },
        setSaving() {}, setCart: () => { context.cart = []; context.canSave = false; order.push('reset'); },
        setWeight() {}, setDate() {}, setItemId() {}, setFirmId() {}, setSupplierId() {}, weightRef: { current: null }, todayISO: () => '2026-10-05', fetchSequence: async () => {},
        loadTemplate: async stage => { order.push('load'); return labels.loadTemplate(stage, printOptions); },
        printStageTemplatesBatch: (stage, data, options) => labels.printStageTemplatesBatch(stage, data, { ...printOptions, ...options }),
        alert: message => notices.push(message),
      });
      context.window.confirm = () => true;
      const inbound = readFileSync(new URL('../../pages/Inbound.jsx', import.meta.url), 'utf8');
      const start = inbound.indexOf('    const handleSaveLot ='), end = inbound.indexOf('    const addCutterCrate =', start);
      assert.ok(start >= 0 && end > start);
      vm.runInContext(inbound.slice(start, end) + '\nglobalThis.invoke = handleSaveLot;', context);
      await context.invoke(); await context.invoke();
      assert.equal(saves, 1); assert.equal(context.cart.length, 0); assert.deepEqual(order, ['commit', 'reset', 'load']);
      assert.equal(f.calls.writes, 0);
      assert.equal(p.submissions.length, outcome === 'missing template' ? 0 : 1);
      if (outcome === 'success') assert.equal(notices.length, 0);
      else { assert.match(notices.at(-1), /was saved.*labels failed/); assert.match(notices.at(-1), /do not save the lot again/); }
    });
  }
}
