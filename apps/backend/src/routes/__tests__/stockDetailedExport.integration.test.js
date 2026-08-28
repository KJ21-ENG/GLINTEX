import assert from 'node:assert/strict';
import { read } from 'xlsx';
import test from 'node:test';

import { exportStockDetailedXlsx } from '../../../../frontend/src/services/exporters.js';

async function captureWorkbook(data, options) {
  let capturedBlob = null;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  globalThis.document = {
    createElement: () => ({ click() {} }),
  };
  URL.createObjectURL = (blob) => {
    capturedBlob = blob;
    return 'blob:test-stock-export';
  };
  URL.revokeObjectURL = () => {};

  try {
    exportStockDetailedXlsx(data, options);
    assert.ok(capturedBlob, 'export should create a workbook blob');
    return read(await capturedBlob.arrayBuffer(), { type: 'array' });
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
}

test('detailed Cutter bobbin workbook contains the lazily fetched crate row', async () => {
  const workbook = await captureWorkbook([{
    lotNo: 'LOT-B-1',
    itemName: 'Metallic Yarn',
    availableBobbins: 4,
    totalBobbins: 4,
    availableWeight: 2,
    totalWeight: 2,
    crates: [{
      barcode: 'CUTTER-CRATE-001',
      availableBobbins: 4,
      bobbinQty: 4,
      availableWeight: 2,
      netWeight: 2,
    }],
  }], { viewType: 'bobbins' });

  assert.deepEqual(workbook.SheetNames, ['Summary', 'Crates']);
  assert.equal(workbook.Sheets.Crates.A2.v, 'LOT-B-1');
  assert.equal(workbook.Sheets.Crates.I2.v, 'CUTTER-CRATE-001');
});

test('detailed Cutter jumbo workbook contains the lazily fetched piece row', async () => {
  const workbook = await captureWorkbook([{
    lotNo: 'LOT-J-1',
    itemName: 'Film',
    availableCount: 1,
    totalPieces: 1,
    remainingWeight: 10,
    totalWeight: 10,
    pieces: [{ id: 'piece-1', barcode: 'CUTTER-PIECE-001', seq: 1, weight: 10 }],
  }], { viewType: 'jumbo' });

  assert.deepEqual(workbook.SheetNames, ['Summary', 'Pieces']);
  assert.equal(workbook.Sheets.Pieces.A2.v, 'LOT-J-1');
  assert.equal(workbook.Sheets.Pieces.I2.v, 'piece-1');
  assert.equal(workbook.Sheets.Pieces.J2.v, 'CUTTER-PIECE-001');
});
