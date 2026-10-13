import test from 'node:test';
import assert from 'node:assert/strict';
import { stickerRunWhere, stickerStatus, markConingStickersPrinted, ConingStickerRunError } from '../coningStickerRun.js';

test('morning range takes yesterday Night and today Day, keeping issues saved without a shift', () => {
  const where = stickerRunWhere({ dateFrom: '2026-10-12', dateTo: '2026-10-13', fromShifts: 'Night', toShifts: ['Day'] });
  assert.equal(where.isDeleted, false);
  assert.deepEqual(where.OR[0], { date: '2026-10-12', OR: [{ shift: { in: ['Night'] } }, { shift: null }, { shift: '' }] });
  assert.deepEqual(where.OR[1], { date: '2026-10-13', OR: [{ shift: { in: ['Day'] } }, { shift: null }, { shift: '' }] });
  assert.deepEqual(where.OR[2], { date: { gt: '2026-10-12', lt: '2026-10-13' } });
});

test('a single date merges both shift lists and both shifts means the whole day', () => {
  assert.deepEqual(stickerRunWhere({ dateFrom: '2026-10-13', dateTo: '2026-10-13', fromShifts: 'Day', toShifts: 'Night' }), { isDeleted: false, date: '2026-10-13' });
  assert.throws(() => stickerRunWhere({ dateFrom: '2026-10-13', dateTo: '2026-10-12', fromShifts: 'Day', toShifts: 'Day' }), ConingStickerRunError);
  assert.throws(() => stickerRunWhere({ dateFrom: '2026-10-12', dateTo: '2026-10-13', fromShifts: '', toShifts: 'Day' }), /at least one shift/);
});

test('a batch that changed after printing is flagged until printed again', () => {
  assert.equal(stickerStatus({ stickerPrintedAt: null, coningBatchRevision: 0, stickerPrintedRevision: 0 }), 'not_printed');
  assert.equal(stickerStatus({ stickerPrintedAt: new Date(), coningBatchRevision: 2, stickerPrintedRevision: 2 }), 'printed');
  assert.equal(stickerStatus({ stickerPrintedAt: new Date(), coningBatchRevision: 3, stickerPrintedRevision: 2 }), 'changed');
});

test('marking printed records the revision the operator saw, never a newer one', async () => {
  const updates = [];
  const client = { issueToConingMachine: {
    findMany: async () => [{ id: 'a', receivedRowRefs: [{ rowId: 1 }, { rowId: 2 }], coningBatchRevision: 4 }],
    update: async (args) => { updates.push(args); return args; },
  } };
  await markConingStickersPrinted(client, [{ id: 'a', copies: 4, revision: 3 }], 'user-1');
  assert.equal(updates[0].data.stickerPrintedRevision, 3);
  assert.equal(updates[0].data.stickerPrintedCrates, 2);
  assert.equal(updates[0].data.stickerPrintedCopies, 4);
  await assert.rejects(markConingStickersPrinted(client, [{ id: 'a', copies: 0, revision: 1 }]), /between 1 and 100/);
  await assert.rejects(markConingStickersPrinted(client, [{ id: 'a', copies: 2, revision: 1 }, { id: 'b', copies: 2, revision: 1 }]), /deleted/);
});
