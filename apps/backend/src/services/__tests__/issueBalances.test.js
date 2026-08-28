import test from 'node:test';
import assert from 'node:assert/strict';

import { computeIssueBalancesBatch } from '../issueBalances.js';

// Minimal Prisma stub. Tracks every call so the regression test can assert that
// computeIssueBalancesBatch is set-based — i.e. its query count does NOT scale
// with the number of input issues.
function makeStub({
  cutterLineGroups = [],
  cutterLinkedGroups = [],
  cutterFallbackRows = [],
  cutterChallans = [],
  takeBacks = [],
  holoRows = [],
  coningRows = [],
  coningPieceTotals = [],
} = {}) {
  const calls = [];
  const record = (label, args) => calls.push({ label, args });
  return {
    calls,
    issueTakeBack: {
      findMany: async (args) => {
        record('issueTakeBack.findMany', args);
        return takeBacks;
      },
    },
    issueToCutterMachineLine: {
      groupBy: async (args) => {
        record('issueToCutterMachineLine.groupBy', args);
        return cutterLineGroups;
      },
    },
    receiveFromCutterMachineRow: {
      groupBy: async (args) => {
        record('receiveFromCutterMachineRow.groupBy', args);
        return cutterLinkedGroups;
      },
      findMany: async (args) => {
        record('receiveFromCutterMachineRow.findMany', args);
        return cutterFallbackRows;
      },
    },
    receiveFromCutterMachineChallan: {
      findMany: async (args) => {
        record('receiveFromCutterMachineChallan.findMany', args);
        return cutterChallans;
      },
    },
    receiveFromHoloMachineRow: {
      findMany: async (args) => {
        record('receiveFromHoloMachineRow.findMany', args);
        return holoRows;
      },
    },
    receiveFromConingMachineRow: {
      findMany: async (args) => {
        record('receiveFromConingMachineRow.findMany', args);
        return coningRows;
      },
    },
    receiveFromConingMachinePieceTotal: {
      findMany: async (args) => {
        record('receiveFromConingMachinePieceTotal.findMany', args);
        return coningPieceTotals;
      },
    },
  };
}

test('computeIssueBalancesBatch returns empty map for empty input', async () => {
  const stub = makeStub();
  const result = await computeIssueBalancesBatch(stub, 'holo', []);
  assert.equal(result.size, 0);
  assert.equal(stub.calls.length, 0, 'no DB calls when no input');
});

test('holo: aggregates original from receivedRowRefs jsonb in memory + 2 DB calls total', async () => {
  const issues = [
    {
      id: 'h1',
      receivedRowRefs: [
        { rowId: 'r1', issuedBobbins: 10, issuedBobbinWeight: 5.0 },
        { rowId: 'r2', issuedBobbins: 4, issuedBobbinWeight: 2.0 },
      ],
      metallicBobbins: 0,
      metallicBobbinsWeight: 0,
      yarnKg: 1.25,
    },
    {
      id: 'h2',
      receivedRowRefs: [],
      metallicBobbins: 7,
      metallicBobbinsWeight: 3.5,
      yarnKg: 0.5,
    },
  ];
  const stub = makeStub({
    takeBacks: [
      { issueId: 'h1', totalCount: 2, totalWeight: 1.0 },
    ],
    holoRows: [
      { issueId: 'h1', rollCount: 3, rollWeight: 1.5, grossWeight: null, tareWeight: null, isWastage: false },
      { issueId: 'h1', rollCount: 1, rollWeight: 0.5, grossWeight: null, tareWeight: null, isWastage: true },
      { issueId: 'h2', rollCount: 2, rollWeight: 1.0, grossWeight: null, tareWeight: null, isWastage: null },
    ],
  });

  const result = await computeIssueBalancesBatch(stub, 'holo', issues);
  assert.equal(stub.calls.length, 2, 'exactly 2 DB calls for holo (take-back + receive)');

  const h1 = result.get('h1');
  assert.equal(h1.originalCount, 14);
  assert.equal(h1.originalWeight, 8.25);
  assert.equal(h1.takeBackCount, 2);
  assert.equal(h1.takeBackWeight, 1.0);
  assert.equal(h1.receivedCount, 3);
  assert.equal(h1.receivedWeight, 1.5);
  assert.equal(h1.wastageCount, 1);
  assert.equal(h1.wastageWeight, 0.5);
  assert.equal(h1.netIssuedCount, 12);
  assert.equal(h1.netIssuedWeight, 7.25);
  assert.equal(h1.pendingCount, 12, 'Holo output rolls do not consume input bobbin count');
  assert.equal(h1.pendingWeight, 5.25);
  assert.ok(Number.isFinite(Date.parse(h1.asOf)));

  const h2 = result.get('h2');
  // empty receivedRowRefs => fall back to issue header
  assert.equal(h2.originalCount, 7);
  assert.equal(h2.originalWeight, 4.0);
  assert.equal(h2.asOf, h1.asOf);
});

test('coning: 3 DB calls regardless of issue count', async () => {
  const issues = Array.from({ length: 50 }, (_, i) => ({
    id: `c${i}`,
    receivedRowRefs: [{ rowId: 'r1', issueRolls: 2, issueWeight: 1.0 }],
    rollsIssued: 2,
  }));
  const stub = makeStub();
  const result = await computeIssueBalancesBatch(stub, 'coning', issues);
  assert.equal(result.size, 50);
  assert.equal(stub.calls.length, 3, 'coning uses exactly 3 DB calls');
});

test('cutter: at most 5 DB calls regardless of issue count (regression guard)', async () => {
  const issues = Array.from({ length: 100 }, (_, i) => ({
    id: `cu${i}`,
    pieceIds: `piece${i}`,
    totalWeight: 1.0,
    count: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }));
  const stub = makeStub({
    cutterLineGroups: issues.map((i) => ({
      issueId: i.id,
      _sum: { issuedWeight: 1.0 },
      _count: { _all: 1 },
    })),
  });
  const result = await computeIssueBalancesBatch(stub, 'cutter', issues);
  assert.equal(result.size, 100);
  assert.ok(stub.calls.length <= 5, `expected ≤ 5 DB calls, got ${stub.calls.length}: ${stub.calls.map((c) => c.label).join(', ')}`);
});

test('cutter: no piece ids => skips fallback + challan queries', async () => {
  const issues = [
    { id: 'cu1', pieceIds: '', totalWeight: 5.0, count: 2, createdAt: new Date() },
  ];
  const stub = makeStub({
    cutterLineGroups: [{ issueId: 'cu1', _sum: { issuedWeight: 4.0 }, _count: { _all: 2 } }],
    cutterLinkedGroups: [{ issueId: 'cu1', _sum: { bobbinQuantity: 1, netWt: 0.5 } }],
  });
  const result = await computeIssueBalancesBatch(stub, 'cutter', issues);
  const labels = stub.calls.map((c) => c.label);
  assert.ok(!labels.includes('receiveFromCutterMachineRow.findMany'), 'no fallback rows query');
  assert.ok(!labels.includes('receiveFromCutterMachineChallan.findMany'), 'no challan query');
  const b = result.get('cu1');
  assert.equal(b.originalCount, 2);
  assert.equal(b.originalWeight, 4.0);
  assert.equal(b.receivedCount, 1);
  assert.equal(b.receivedWeight, 0.5);
});

test('finalizeBalance clamps small negatives to zero', async () => {
  const issues = [{ id: 'h1', receivedRowRefs: [], metallicBobbins: 1, metallicBobbinsWeight: 1.0 }];
  const stub = makeStub({
    takeBacks: [{ issueId: 'h1', totalCount: 1, totalWeight: 1.0 + 1e-9 }], // tiny over
  });
  const result = await computeIssueBalancesBatch(stub, 'holo', issues);
  const b = result.get('h1');
  assert.equal(b.netIssuedCount, 0);
  assert.equal(b.netIssuedWeight, 0);
  assert.equal(b.pendingCount, 0);
  assert.equal(b.pendingWeight, 0);
});
