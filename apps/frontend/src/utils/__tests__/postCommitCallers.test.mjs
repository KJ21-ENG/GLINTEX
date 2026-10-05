import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runPostCommitPrint, refreshAfterCommit } from '../postCommitPrint.js';
function source(rel, start, end) {
  const s = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  const a = s.indexOf(start), b = s.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing actual handler ${start}`); return s.slice(a, b);
}
for (const failure of ['template', 'print']) {
  test(`actual Inbound save handler clears committed cart before ${failure} failure; retry cannot resave`, async () => {
    let mutations = 0; const events = [], notices = [];
    const context = vm.createContext({
      runPostCommitPrint, refreshAfterCommit, readOnly: false, canSave: true, wrapSaveLot: f => f,
      cart: [{ weight: 12.3 }], date: '2026-10-05', itemId: 'item', firmId: 'firm', supplierId: 'supplier', previewLotNo: '001', db: {},
      createLot: async () => { mutations++; events.push('commit'); return { res: { lot: { lotNo: '001' } }, db: { inbound_items: [{ id: '001-1', lotNo: '001', seq: 1, weight: 12.3 }], items: [] } }; },
      setSaving: () => {}, setCart: () => { events.push('reset'); context.cart = []; context.canSave = false; },
      setWeight: () => {}, setDate: () => {}, setItemId: () => {}, setFirmId: () => {}, setSupplierId: () => {},
      weightRef: { current: null }, todayISO: () => '2026-10-05', fetchSequence: async () => {},
      LABEL_STAGE_KEYS: { INBOUND: 'inbound' },
      loadTemplate: async () => { events.push('template'); if (failure === 'template') throw new Error('template unavailable'); return {}; },
      printStageTemplatesBatch: async () => { events.push('print'); throw new Error('spool failed'); },
      window: { confirm: () => true }, alert: message => notices.push(message), console,
    });
    vm.runInContext(source('pages/Inbound.jsx', '    const handleSaveLot =', '    const addCutterCrate =') + '\nglobalThis.invoke = handleSaveLot;', context);
    await context.invoke(); await context.invoke();
    assert.equal(mutations, 1); assert.equal(context.cart.length, 0);
    assert.ok(events.indexOf('reset') < events.indexOf('template'));
    assert.match(notices.at(-1), /was saved.*labels failed/);
    assert.match(notices.at(-1), /do not save the lot again/);
  });
}
test('actual InventoryContext action wrappers return confirmed save despite refresh failure', async () => {
  let mutations = 0;
  const context = vm.createContext({ refreshAfterCommit,
    api: { createLot: async () => { mutations++; return { ok: true }; }, createIssueToMachine: async () => { mutations++; return { ok: true }; } },
    refreshModuleData: async () => { throw new Error('refresh offline'); }, refreshProcessData: async () => { throw new Error('refresh offline'); },
    emitInvalidation: () => {}, INVENTORY_INVALIDATION_KEYS: { issueOnMachine: () => 'one', issueHistory: () => 'two' },
  });
  const lot = source('context/InventoryContext.jsx', '    createLot: async', '    deleteLot: async');
  const issue = source('context/InventoryContext.jsx', '    createIssueToMachine: async', '    createIssueTakeBack: async');
  vm.runInContext(`globalThis.actions = ({${lot}${issue}});`, context);
  const a = await context.actions.createLot({}); const b = await context.actions.createIssueToMachine({});
  assert.equal(mutations, 2); assert.equal(a.res.ok, true); assert.equal(b.ok, true);
  assert.equal(a.refreshWarning, 'refresh offline'); assert.equal(b.refreshWarning, 'refresh offline');
});
test('actual Cutter issue handler clears selection before template failure', async () => {
  let mutations = 0; const events = [], notices = [];
  const context = vm.createContext({ runPostCommitPrint, wrapIssue: f => f,
    date: '2026-10-05', itemId: 'item', lotNo: '001', machineId: 'm', operatorId: 'o', cutId: 'cut', note: '', selectedLines: [{ pieceId: '001-1', issuedWeight: 2 }], to3: Number,
    createIssueToMachine: async () => { mutations++; events.push('commit'); return { issueToMachine: { id: 'issued' } }; }, setIssuing: () => {},
    setSelectedLines: () => { context.selectedLines = []; events.push('reset'); }, setCutId: () => {}, setNote: () => {},
    LABEL_STAGE_KEYS: { CUTTER_ISSUE: 'cutter_issue' }, loadTemplate: async () => { events.push('template'); throw new Error('template offline'); }, alert: m => notices.push(m),
  });
  vm.runInContext(source('components/issue/IssueToCutter.jsx', '    const handleIssue =', '    function toggle(') + '\nglobalThis.invoke = handleIssue;', context);
  await context.invoke(); await context.invoke();
  assert.equal(mutations, 1); assert.equal(context.selectedLines.length, 0);
  assert.ok(events.indexOf('reset') < events.indexOf('template')); assert.match(notices.at(-1), /Issue was saved.*label failed/);
});
test('actual Inbound history reprint invokes only label pipeline, never a save API', async () => {
  let prints = 0, mutations = 0;
  const context = vm.createContext({
    LABEL_STAGE_KEYS: { INBOUND: 'inbound' }, loadTemplate: async () => ({}),
    printStageTemplate: async () => { prints++; return { success: true }; },
    createLot: async () => { mutations++; }, api: new Proxy({}, { get: () => () => { mutations++; } }),
    alert: () => assert.fail('Unexpected reprint failure'),
  });
  vm.runInContext(source('pages/Inbound.jsx', '    const handleReprintPiece =', '    const handleReprintAllPieces =') + '\nglobalThis.invoke = handleReprintPiece;', context);
  await context.invoke({ id: '001-1', seq: 1, weight: 1, barcode: 'INB001' }, { lotNo: '001', itemName: 'Fixture' });
  assert.equal(prints, 1); assert.equal(mutations, 0);
});
