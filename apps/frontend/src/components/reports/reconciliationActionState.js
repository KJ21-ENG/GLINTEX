export function getReconciliationActionState(batch, canWrite) {
  const status = String(batch?.status || '').toUpperCase();
  const hasLines = Number(batch?.lineCount || batch?.lines?.length || 0) > 0;
  const isReversal = Boolean(batch?.evidenceSnapshot?.reversalOfBatchId || batch?.reversalOfBatchId);

  return {
    status,
    hasLines,
    isReversal,
    canApply: Boolean(canWrite && status === 'DRAFT' && hasLines),
    canReverse: Boolean(canWrite && status === 'APPLIED' && !isReversal),
    canPreview: Boolean(status === 'DRAFT' && hasLines),
    canApplyDiagnostic: Boolean(canWrite && hasLines && status !== 'DRAFT'),
    canReverseDiagnostic: Boolean(canWrite && hasLines && (status !== 'APPLIED' || isReversal)),
  };
}

export function buildReconciliationCreatePayload(form) {
  const reason = String(form?.reason || '').trim();
  const sourceId = String(form?.sourceId || '').trim();
  const countDelta = Number(form?.countDelta);
  const weightDeltaKg = Number(form?.weightDeltaKg);
  if (!reason) throw new Error('A reason is required.');
  if (!sourceId) throw new Error('An audited source ID is required.');
  if (!Number.isInteger(countDelta) || !Number.isFinite(weightDeltaKg) || (countDelta === 0 && Math.abs(weightDeltaKg) <= 0.000001)) {
    throw new Error('Enter a non-zero integer count delta or finite weight delta.');
  }

  return {
    kind: form?.kind,
    reason,
    effectiveAt: form?.effectiveAt ? `${form.effectiveAt}T00:00:00.000Z` : new Date().toISOString(),
    evidenceSnapshot: {
      source: 'authenticated_reconciliation_ui',
      auditReference: String(form?.auditReference || '').trim() || null,
      auditedBalanceConfirmed: true,
    },
    lines: [{
      sourceType: form?.sourceType,
      sourceId,
      sourceBarcode: String(form?.sourceBarcode || '').trim() || null,
      countDelta,
      weightDeltaKg,
    }],
  };
}
