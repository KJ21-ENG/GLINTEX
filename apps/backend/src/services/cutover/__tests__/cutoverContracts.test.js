import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACTIVE_BARCODE_OWNER_SQL,
  openingBalanceKindPredicate,
  requireSuccessfulEvidence,
  requireZeroEvidenceDifference,
  verifyBarcodeUniqueness,
  verifySnapshotOwnerReferences,
} from '../cutoverService.js';
import { hasNewWritePermission, runDeterministicWritePreflight } from '../writeGate.js';

test('linked opening-balance queries cast the PostgreSQL enum before comparison', () => {
  const predicate = openingBalanceKindPredicate();
  assert.match(predicate.strings.join(''), /"kind"::text\s*=\s*$/);
  assert.deepEqual(predicate.values, ['OPENING_BALANCE']);
});

test('new write gates defer authentication and module permission decisions to the route contract', () => {
  assert.equal(hasNewWritePermission({}, 'packing'), false);
  assert.equal(hasNewWritePermission({ user: { permissions: { packing: 0 } } }, 'packing'), false);
  assert.equal(hasNewWritePermission({ user: { permissions: { packing: 1 } } }, 'packing'), false);
  assert.equal(hasNewWritePermission({ user: { permissions: { packing: 2 } } }, 'packing'), true);
  assert.equal(hasNewWritePermission({ user: { permissions: { dispatch: 2 } } }, 'dispatch-v2'), true);
  assert.equal(hasNewWritePermission({ user: { isAdmin: true } }, 'packed-stock'), true);
});

test('deterministic preflight runs before the generic gate and preserves it for admissible writes', async () => {
  const order = [];
  const result = await runDeterministicWritePreflight({
    preflight: async () => { order.push('preflight'); },
    gate: async () => { order.push('gate'); return 'writes_gated'; },
  });
  assert.equal(result, 'writes_gated');
  assert.deepEqual(order, ['preflight', 'gate']);

  await assert.rejects(
    () => runDeterministicWritePreflight({
      preflight: async () => { order.push('rejecting-preflight'); throw Object.assign(new Error('legacy'), { code: 'legacy_dispatch_read_only' }); },
      gate: async () => { throw new Error('generic gate must not run'); },
    }),
    (error) => error?.code === 'legacy_dispatch_read_only',
  );
  assert.deepEqual(order, ['preflight', 'gate', 'rejecting-preflight']);
});

test('route preflight remains after auth, permission, and idempotency checks', () => {
  const source = readFileSync(new URL('../../../routes/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('function pathAwareAffectedWriteGate');
  const end = source.indexOf('function legacyIdempotencyGate');
  assert.ok(start >= 0 && end > start);
  const contract = source.slice(start, end);
  assert.match(contract, /requireMutationIdempotencyKey\(req, res, \(\) => runDeterministicWritePreflight/);
  assert.match(contract, /preflight: preflight \? \(\) => preflight\(req\) : null/);
  assert.match(contract, /gate: \(\) => policyGate\(req, res, next\)/);
  assert.match(source, /pathAwareAffectedWriteGate\('dispatch-v2',[\s\S]*preflight: preflightDispatchV2Mutation/);
  assert.match(source, /pathAwareAffectedWriteGate\('packing',[\s\S]*preflight: preflightPackingBatchSourceMutation/);
});

test('activation evidence requires explicit success and zero reconciliation drift', () => {
  assert.deepEqual(requireSuccessfulEvidence({ status: 'PASS' }, 'historicalConing'), { status: 'PASS' });
  assert.doesNotThrow(() => requireZeroEvidenceDifference({ countDifference: 0, weightDifferenceKg: 0 }, 'reconciliationTotals'));
  assert.throws(
    () => requireSuccessfulEvidence({ status: 'PENDING' }, 'historicalConing'),
    (error) => error?.code === 'activation_evidence_incomplete',
  );
  assert.throws(
    () => requireZeroEvidenceDifference({ countDifference: 1, weightDifferenceKg: 0 }, 'reconciliationTotals'),
    (error) => error?.code === 'activation_evidence_incomplete',
  );
});

test('cutover barcode owners exclude deleted historical rows while retaining active identities', () => {
  const sql = ACTIVE_BARCODE_OWNER_SQL.strings.join('');
  assert.match(sql, /"IssueToCutterMachine"[^\n]*"isDeleted"\s*=\s*false/);
  assert.match(sql, /"ReceiveFromCutterMachineRow"[^\n]*"isDeleted"\s*=\s*false/);
  assert.match(sql, /"ReceiveFromHoloMachineRow"[^\n]*"isDeleted"\s*=\s*false/);
  assert.match(sql, /"ReceiveFromConingMachineRow"[^\n]*"isDeleted"\s*=\s*false/);
  assert.doesNotMatch(sql, /"InboundItem"[^\n]*"isDeleted"/);
});

test('barcode uniqueness remains a hard activation gate for active duplicate results', async () => {
  await assert.rejects(
    () => verifyBarcodeUniqueness(
      { $queryRaw: async () => [{ barcode: 'RCU-DUPLICATE', occurrences: 2 }] },
      { status: 'PASS', duplicateCount: 0 },
    ),
    (error) => error?.code === 'barcode_uniqueness_unverified' && error?.details?.durableDuplicates?.length === 1,
  );
  await assert.doesNotReject(() => verifyBarcodeUniqueness(
    { $queryRaw: async () => [] },
    { status: 'PASS', duplicateCount: 0 },
  ));
});

test('snapshot ownership uses the same active-owner boundary', async () => {
  let query;
  const result = await verifySnapshotOwnerReferences(
    { $queryRaw: async (value) => { query = value; return []; } },
    { status: 'PASS', ownerCountFailures: 0 },
  );
  assert.deepEqual(result, { ownerCountFailures: 0 });
  assert.match(query.strings.join(''), /"ReceiveFromCutterMachineRow"[^\n]*"isDeleted"\s*=\s*false/);
});
