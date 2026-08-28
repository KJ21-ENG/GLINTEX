import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyCursorWhere,
  decodeCursor,
  encodeCursor,
  paginateStockGroupItems,
  paginateStockRows,
} from '../v2.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(dirname, '../..');
const routeSource = fs.readFileSync(path.join(sourceRoot, 'routes/index.js'), 'utf8');
const v2Source = fs.readFileSync(path.join(sourceRoot, 'routes/v2.js'), 'utf8');

function req(query = {}) {
  return { query };
}

test('stock group pagination is stable and summaries cover the complete filtered result', () => {
  const items = Array.from({ length: 205 }, (_, index) => ({
    lotKey: `lot-${String(index).padStart(3, '0')}`,
    lotNo: `LOT-${String(index).padStart(3, '0')}`,
    itemId: index % 2 === 0 ? 'item-a' : 'item-b',
    statusType: 'active',
    totalWeight: 10,
    availableCount: 1,
    totalPieces: 2,
  }));
  const first = paginateStockGroupItems(items, req({ limit: '100', item: 'item-a' }), 'cutter');
  const second = paginateStockGroupItems(items, req({ limit: '100', item: 'item-a', cursor: first.nextCursor }), 'cutter');
  assert.equal(first.items.length, 100);
  assert.equal(second.items.length, 3);
  assert.equal(first.summary.groupCount, 103);
  assert.equal(first.summary.totalWeight, 1030);
  assert.equal(first.summary.availableCount, 103);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.lotKey)).size, 103);
});

test('lot row cursor does not duplicate or omit rows', () => {
  const items = Array.from({ length: 75 }, (_, index) => ({ id: `row-${String(index).padStart(3, '0')}` }));
  const first = paginateStockRows(items, req({ limit: '50' }));
  const second = paginateStockRows(items, req({ limit: '50', cursor: first.nextCursor }));
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 25);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 75);
});

test('server grouping aggregates the complete filtered result before pagination', () => {
  const items = [
    { lotKey: 'a', lotNo: 'LOT-1', itemId: 'item-a', supplierId: 'supplier-a', cutName: 'Cut A', totalWeight: 10, availableCount: 1 },
    { lotKey: 'b', lotNo: 'LOT-2', itemId: 'item-a', supplierId: 'supplier-a', cutName: 'Cut A', totalWeight: 20, availableCount: 2 },
  ];
  const result = paginateStockGroupItems(items, req({ groupBy: 'true', limit: '1' }), 'cutter');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].lots, ['LOT-1', 'LOT-2']);
  assert.deepEqual(result.items[0].memberLotKeys, ['a', 'b']);
  assert.equal(result.items[0].totalWeight, 30);
  assert.equal(result.summary.totalWeight, 30);
  assert.equal(result.summary.groupCount, 1);
});

test('createdAt and id cursor retains the deterministic tie-breaker', () => {
  const cursor = encodeCursor({ createdAt: '2026-08-27T00:00:00.000Z', id: 'row-b' });
  assert.deepEqual(decodeCursor(cursor), { createdAt: '2026-08-27T00:00:00.000Z', id: 'row-b' });
  const where = applyCursorWhere({ isDeleted: false }, {
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    id: 'row-b',
    order: 'desc',
  });
  assert.equal(where.AND[0].isDeleted, false);
  assert.match(JSON.stringify(where), /row-b/);
});

test('targeted contracts are permission protected and expose explicit lookup outcomes', () => {
  assert.match(v2Source, /\/issue\/:process\/:id\/action-detail[^\n]+requireStageReadPermission/);
  assert.match(v2Source, /\/receive\/:process\/:id\/action-detail[^\n]+requireStageReadPermission/);
  assert.match(v2Source, /\/stock\/:process\/lot-rows[^\n]+requirePermission\('stock', PERM_READ\)/);
  assert.match(routeSource, /\/api\/v2\/issue\/:process\/source-row/);
  assert.match(routeSource, /\/api\/v2\/issue\/cutter\/source-candidates/);
  for (const outcome of ['not_found', 'exhausted', 'availability_changed', 'duplicate_legacy_match', 'deleted']) {
    assert.match(routeSource, new RegExp(outcome));
  }
});

test('lists retain inline compatibility while exposing separate summary contracts', () => {
  assert.match(v2Source, /\/on-machine\/:process\/summary.*requireStageReadPermission/);
  assert.match(v2Source, /\/stock\/:process\/summary.*requirePermission\('stock', PERM_READ\)/);
  assert.match(v2Source, /String\(req\.query\.summaryMode \|\| ''\)\.toLowerCase\(\) === 'separate'/);
  assert.match(v2Source, /summaryPending: separateSummary \? true : undefined/);
  assert.match(v2Source, /isUnfiltered[\s\S]{0,180}loadUnfilteredPendingOnMachinePageSql/);
  assert.match(v2Source, /&& !separateSummary;/);
});

test('stock separate-mode SQL omits full-result window totals from list requests', () => {
  assert.match(v2Source, /const holoSummaryColumns = separateSummary \? Prisma\.sql/);
  assert.match(v2Source, /const coningSummaryColumns = separateSummary \? Prisma\.sql/);
  assert.match(v2Source, /NULL::int AS summary_group_count/);
  assert.match(v2Source, /summary: separateSummary \? null : summary/);
});

test('normal trace and computed filters keep pages bounded and omit exhaustive summaries', () => {
  assert.match(v2Source, /buildBoundedIssueTrackingResult/);
  assert.match(v2Source, /includeConingTrace: false/);
  assert.match(v2Source, /const batchSize = Math\.max\(200, Math\.min\(1000, limit \* 5\)\)/);
  assert.match(v2Source, /const maxScanRows = Math\.max\(batchSize, Math\.min\(1000, limit \* 10\)\)/);
  assert.match(v2Source, /const continuation = hasBufferedMatch \? pageItems\[pageItems\.length - 1\] : scanCursor/);
  assert.match(v2Source, /const continuation = hasBufferedMatch \? items\[items\.length - 1\] : scanCursor/);
  assert.doesNotMatch(v2Source, /isFirstPage \|\| items\.length <= limit/);
  assert.doesNotMatch(v2Source, /buildBoundedOnMachineSummary/);
  assert.match(v2Source, /buildUnfilteredIssueTrackingSummarySql/);
  assert.doesNotMatch(v2Source, /const chunkSize = 5000/);
  assert.doesNotMatch(v2Source, /function buildOnMachineComputedResult/);
});

test('Holo stock keys retain exact canonical source-lot identity', () => {
  assert.match(v2Source, /lotNos,/);
  assert.match(v2Source, /il\.lot_nos_final = \$\{lotNos\}::text\[\]/);
  assert.match(v2Source, /array_agg\(DISTINCT bi\."lotNo" ORDER BY bi\."lotNo"\)/);
});

test('issue mutations preserve rollback keys and enrich source balances', () => {
  assert.match(routeSource, /issueToHoloMachine: created, sourceUpdates:/);
  assert.match(routeSource, /issueToConingMachine: created, sourceUpdates:/);
  assert.match(routeSource, /FOR UPDATE/);
  assert.match(routeSource, /status\(409\)/);
});

test('representative serialized routine and action responses stay within budgets', () => {
  const list = {
    items: Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      barcode: `BC-${index}`,
      lotNo: `LOT-${index % 20}`,
      itemName: 'Representative Item',
      machineName: 'Machine 1',
      operatorName: 'Operator 1',
      count: 100,
      weight: 123.456,
      createdAt: '2026-08-27T00:00:00.000Z',
    })),
    summary: { totalCount: 15000, totalWeight: 1851840 },
  };
  const action = {
    issue: list.items[0],
    sourceLines: Array.from({ length: 50 }, (_, index) => ({ id: `source-${index}`, count: 10, weight: 5.5 })),
    relatedReceiveRows: Array.from({ length: 50 }, (_, index) => ({ id: `receive-${index}`, count: 10, weight: 5.5 })),
    takeBacks: [],
  };
  assert.ok(Buffer.byteLength(JSON.stringify(list)) < 500 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(action)) < 100 * 1024);
});
