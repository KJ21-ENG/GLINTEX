import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReconciliationCreatePayload, getReconciliationActionState } from '../reconciliationActionState.js';

test('read-only reconciliation users receive no mutation actions', () => {
  assert.deepEqual(
    getReconciliationActionState({ status: 'DRAFT', lineCount: 1 }, false),
    { status: 'DRAFT', hasLines: true, isReversal: false, canApply: false, canReverse: false, canPreview: true, canApplyDiagnostic: false, canReverseDiagnostic: false },
  );
});

test('only a lined DRAFT can be applied and only an original APPLIED batch can be reversed', () => {
  assert.equal(getReconciliationActionState({ status: 'DRAFT', lineCount: 1 }, true).canApply, true);
  assert.equal(getReconciliationActionState({ status: 'DRAFT', lineCount: 0 }, true).canApply, false);
  assert.equal(getReconciliationActionState({ status: 'APPLIED', lineCount: 1 }, true).canReverse, true);
  assert.equal(getReconciliationActionState({ status: 'APPLIED', lineCount: 1, evidenceSnapshot: { reversalOfBatchId: 'original' } }, true).canReverse, false);
  assert.equal(getReconciliationActionState({ status: 'REVERSED', lineCount: 1 }, true).canReverse, false);
  assert.equal(getReconciliationActionState({ status: 'REVERSED', lineCount: 1 }, true).canApplyDiagnostic, true);
  assert.equal(getReconciliationActionState({ status: 'REVERSED', lineCount: 1 }, true).canReverseDiagnostic, true);
  assert.equal(getReconciliationActionState({ status: 'APPLIED', lineCount: 1 }, true).canReverseDiagnostic, false);
  assert.equal(getReconciliationActionState({ status: 'APPLIED', lineCount: 1, evidenceSnapshot: { reversalOfBatchId: 'original' } }, true).canReverseDiagnostic, true);
});

test('audited draft payload preserves signed source identity and evidence fields', () => {
  assert.deepEqual(
    buildReconciliationCreatePayload({
      kind: 'MANUAL_CORRECTION',
      reason: '  audited correction  ',
      effectiveAt: '2026-08-23',
      auditReference: 'BAL-001',
      sourceType: 'CONING_RECEIVE',
      sourceId: 'source-1',
      sourceBarcode: 'RCO-001',
      countDelta: '1',
      weightDeltaKg: '0.100',
    }),
    {
      kind: 'MANUAL_CORRECTION',
      reason: 'audited correction',
      effectiveAt: '2026-08-23T00:00:00.000Z',
      evidenceSnapshot: { source: 'authenticated_reconciliation_ui', auditReference: 'BAL-001', auditedBalanceConfirmed: true },
      lines: [{ sourceType: 'CONING_RECEIVE', sourceId: 'source-1', sourceBarcode: 'RCO-001', countDelta: 1, weightDeltaKg: 0.1 }],
    },
  );
  assert.throws(() => buildReconciliationCreatePayload({ reason: '', sourceId: 'source-1', countDelta: 1, weightDeltaKg: 0.1 }), /reason is required/);
  assert.throws(() => buildReconciliationCreatePayload({ reason: 'x', sourceId: 'source-1', countDelta: 0, weightDeltaKg: 0 }), /non-zero/);
});
