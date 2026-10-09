import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCutterReceiveEntries } from '../cutterReceivePayload.js';
import { collectWeightProvenance } from '../../../../backend/src/utils/weightProvenance.js';

const crate = {
  issueId: 'cutter-issue', pieceId: '182-1', lotNo: '182', operatorId: 'worker',
  bobbinId: 'bobbin', boxId: 'box', bobbinQty: '20', grossWeight: '11.2',
  receiveDate: '2026-10-09', cutId: 'cut', shift: 'Day', isWastage: false,
};
const closePiece = {
  ...crate, bobbinId: '', boxId: '', bobbinQty: '', grossWeight: '',
  isWastage: true, netWeight: 6.441, wastageNote: 'Close finished piece',
};
const wireEntries = cart => JSON.parse(JSON.stringify(buildCutterReceiveEntries(cart)));

test('calculated wastage saves without a fabricated zero-weight capture', () => {
  const entries = wireEntries([closePiece]);
  assert.equal(Object.hasOwn(entries[0], 'weightProvenance'), false);
  assert.equal(entries[0].isWastage, true);
  assert.equal(entries[0].wastageNote, 'Close finished piece');
  assert.deepEqual(collectWeightProvenance({ entries }), []);
});

test('mixed save retains capture on the measured crate and omits it on calculated wastage', () => {
  const capture = { source: 'scale', weightKg: 11.2, captureId: 'scale-capture' };
  const entries = wireEntries([{ ...crate, weightProvenance: capture }, { ...closePiece, weightProvenance: capture }]);
  const records = collectWeightProvenance({ entries });
  assert.equal(records.length, 1);
  assert.equal(records[0].field, 'entries[0]');
  assert.equal(records[0].capture.captureId, 'scale-capture');
  assert.equal(Object.hasOwn(entries[1], 'weightProvenance'), false);
});

test('manual crates retain weight validation and edited scale values lose scale attribution', () => {
  const entries = wireEntries([{ ...crate, weightProvenance: { source: 'scale', weightKg: 9 } }]);
  assert.equal(entries[0].weightProvenance.source, 'manual');
  assert.equal(collectWeightProvenance({ entries })[0].capture.weightKg, 11.2);
  for (const grossWeight of ['', '0', '-1', 'invalid']) {
    assert.throws(() => collectWeightProvenance({ entries: wireEntries([{ ...crate, grossWeight }]) }), /Invalid captured weight/);
  }
});
