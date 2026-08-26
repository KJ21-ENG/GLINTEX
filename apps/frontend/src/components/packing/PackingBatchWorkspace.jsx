import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Edit3, LockKeyhole, Play, Scissors, XCircle } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Input } from '../ui';
import {
  amendPackingBatchTarget,
  confirmPackingBatch,
  createPackingRepackingBatch,
  createPackingUnit,
  damagePackingUnit,
  getPackingBatch,
  inspectPackingUnitReturn,
  releasePackingUnitQuality,
  reprintPackingUnitLabel,
  replacePackingUnitBarcode,
  reservePackingBatchSources,
  returnPackingUnit,
  sealPackingUnit,
  shortClosePackingBatch,
  startPackingBatch,
  updatePackingBatch,
  voidPackingBatch,
  writeOffPackingUnit,
} from '../../api/packing';
import { batchSources, batchUnits, entityId, formatCount, formatKg, recipeLabel } from './packingUtils';
import { ErrorNotice, Field, ReadOnlyNotice, SectionHeading, StatusBadge, SuccessNotice } from './PackingPrimitives';
import { PackingBatchForm } from './PackingBatchForm';
import { PackingBatchHistory } from './PackingBatchHistory';
import { PackingContainerBuilder } from './PackingContainerBuilder';
import { PackingRepackingForm } from './PackingRepackingForm';
import { PackingSourceReservation } from './PackingSourceReservation';
import { PackingTargetSourceDeltaEditor } from './PackingTargetSourceDeltaEditor';

const PANELS = [
  { id: 'sources', label: 'Sources' },
  { id: 'containers', label: 'Containers' },
  { id: 'repacking', label: 'Repacking' },
  { id: 'history', label: 'History' },
];

const draftSourcePayload = (source) => ({
  sourceType: source.sourceType,
  sourceId: String(source.sourceId || source.id || '').trim(),
  sourceBarcode: String(source.sourceBarcode || source.barcode || '').trim() || null,
  reservedBaseCount: Number(source.reservedBaseCount ?? source.baseCount),
  reservedNetWeightKg: Number(source.reservedNetWeightKg ?? source.netWeightKg),
});

export function PackingBatchWorkspace({
  batch: initialBatch,
  recipes = [],
  customers = [],
  packageTypes = [],
  canWrite,
  onBack,
  onMutated,
}) {
  const [batch, setBatch] = useState(initialBatch);
  const [activePanel, setActivePanel] = useState('sources');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [targetForm, setTargetForm] = useState({ baseCount: '', netWeightKg: '', reason: '', sourceDelta: { additions: [], releases: [] } });
  const [closeReason, setCloseReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [draftSources, setDraftSources] = useState(() => batchSources(initialBatch).map(draftSourcePayload));

  useEffect(() => {
    setBatch(initialBatch);
    setEditOpen(false);
    setActivePanel('sources');
    setError(null);
    setSuccess('');
    setTargetForm({ baseCount: '', netWeightKg: '', reason: '', sourceDelta: { additions: [], releases: [] } });
    setDraftSources(batchSources(initialBatch).map(draftSourcePayload));
  }, [initialBatch]);

  const refresh = async () => {
    const id = entityId(batch);
    if (!id) return;
    setLoading(true);
    try {
      const response = await getPackingBatch(id);
      setBatch(response?.batch || response?.data || response);
    } catch (refreshError) {
      setError(refreshError);
    } finally {
      setLoading(false);
    }
  };

  const run = async (callback, message) => {
    setSaving(true);
    setError(null);
    setSuccess('');
    try {
      const response = await callback();
      const next = response?.batch || response?.data || response;
      if (next?.id || next?.batchNo) setBatch(next);
      else await refresh();
      setSuccess(message);
      if (onMutated) await onMutated(response);
      return response;
    } catch (mutationError) {
      setError(mutationError);
      throw mutationError;
    } finally {
      setSaving(false);
    }
  };

  const status = String(batch?.status || 'DRAFT');
  const units = batchUnits(batch);
  const sources = batchSources(batch);
  const sourceCount = status === 'DRAFT' ? draftSources.length : sources.length;
  const hasOutput = units.some((unit) => !['IN_PROGRESS', 'LABEL_PENDING'].includes(String(unit.status || '')));
  const canEdit = canWrite && ['DRAFT', 'CONFIRMED'].includes(status);
  const selectedRecipe = useMemo(() => recipes.find((recipe) => String(recipe.id) === String(batch?.recipeId)) || batch?.recipe, [batch?.recipe, batch?.recipeId, recipes]);

  const handleEdit = async (payload) => {
    await run(() => updatePackingBatch(entityId(batch), payload), 'Batch changes saved.');
    setEditOpen(false);
  };

  const handleConfirm = () => {
    const payload = status === 'DRAFT' ? { sources: draftSources.map(draftSourcePayload) } : {};
    void run(() => confirmPackingBatch(entityId(batch), payload), 'Batch confirmed and source reservations are being checked.').catch(() => {});
  };
  const handleStart = () => { void run(() => startPackingBatch(entityId(batch)), 'Batch started. Containers can now be constructed.').catch(() => {}); };

  const handleTargetAmend = async () => {
    setError(null);
    const baseCount = Number(targetForm.baseCount);
    const netWeightKg = Number(targetForm.netWeightKg);
    const sourceDelta = targetForm.sourceDelta || { additions: [], releases: [] };
    if (!targetForm.reason.trim()) {
      setError({ message: 'A target amendment reason is required.' });
      return;
    }
    if (!Number.isInteger(baseCount) || baseCount <= 0) {
      setError({ message: 'Amended base count must be a positive whole number.' });
      return;
    }
    if (!Number.isFinite(netWeightKg) || netWeightKg < 0) {
      setError({ message: 'Amended net weight must be zero or greater.' });
      return;
    }
    if (!sourceDelta.additions.length && !sourceDelta.releases.length) {
      setError({ message: 'Stage at least one exact source addition or release for the target amendment.' });
      return;
    }
    try {
      await run(() => amendPackingBatchTarget(entityId(batch), { plannedBaseCount: baseCount, plannedNetWeightKg: netWeightKg, reason: targetForm.reason.trim(), sourceDelta }), 'Batch target amended with an audit event.');
      setTargetForm({ baseCount: '', netWeightKg: '', reason: '', sourceDelta: { additions: [], releases: [] } });
    } catch (_) {
      // The workspace error notice already contains the server response.
    }
  };

  const handleShortClose = async () => {
    setError(null);
    if (!closeReason.trim()) {
      setError({ message: 'A short-close reason is required.' });
      return;
    }
    try {
      await run(() => shortClosePackingBatch(entityId(batch), { reason: closeReason.trim() }), 'Batch short-closed. Unused reservations were released by the server.');
      setCloseReason('');
    } catch (_) {
      // The workspace error notice already contains the server response.
    }
  };

  const handleVoid = async () => {
    setError(null);
    if (!voidReason.trim()) {
      setError({ message: 'A void reason is required.' });
      return;
    }
    try {
      await run(() => voidPackingBatch(entityId(batch), { reason: voidReason.trim() }), 'Batch voided and reservations released.');
      setVoidReason('');
    } catch (_) {
      // The workspace error notice already contains the server response.
    }
  };

  const handleSaveSources = (payload) => {
    if (status === 'DRAFT') {
      setDraftSources((payload?.sources || []).map(draftSourcePayload));
      return Promise.resolve({ draftOnly: true });
    }
    return run(() => reservePackingBatchSources(entityId(batch), payload), 'Source reservation request accepted.');
  };
  const handleCreateUnit = (payload) => run(() => createPackingUnit(entityId(batch), payload), 'Physical container created.');
  const handleSeal = (unit, payload) => run(() => sealPackingUnit(entityId(unit), payload), 'Unit sealed. Barcode and label status refreshed.');
  const handleRetryLabel = (unit, payload) => run(() => reprintPackingUnitLabel(entityId(unit), payload), 'Pending label retry recorded.');
  const handleReprintLabel = (unit, payload) => run(() => reprintPackingUnitLabel(entityId(unit), payload), 'Unit label reprint recorded.');
  const handleReplaceBarcode = (unit, payload) => run(async () => {
    const replacement = await replacePackingUnitBarcode(entityId(unit), { generate: true, reason: payload.reason });
    const replacementUnit = replacement?.replacementUnit || replacement?.unit;
    if (!replacementUnit?.id) return replacement;
    const labelResponse = await reprintPackingUnitLabel(entityId(replacementUnit), {
      reason: `Physical label after barcode replacement: ${payload.reason}`,
    });
    return {
      ...replacement,
      unit: labelResponse?.unit || replacementUnit,
      replacementUnit: labelResponse?.unit || replacementUnit,
      label: labelResponse?.label || null,
      labelPending: labelResponse?.labelPending === true || labelResponse?.unit?.status === 'LABEL_PENDING',
      labelResponse,
    };
  }, 'Barcode replaced. Confirm the new identity before printing.');
  const handleReleaseQuality = (unit, payload) => run(() => releasePackingUnitQuality(entityId(unit), payload), 'Quality hold released.');
  const handleReturn = (unit, payload) => run(() => returnPackingUnit(entityId(unit), payload), 'Return recorded for inspection.');
  const handleInspectReturn = (unit, payload) => run(() => inspectPackingUnitReturn(entityId(unit), payload), 'Return inspection recorded.');
  const handleDamage = (unit, payload) => run(() => damagePackingUnit(entityId(unit), payload), 'Damage event recorded.');
  const handleWriteOff = (unit, payload) => run(() => writeOffPackingUnit(entityId(unit), payload), 'Write-off event recorded.');
  const handleRepacking = (payload) => run(() => createPackingRepackingBatch(payload), 'Repacking batch created.');

  if (!batch) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2"><ArrowLeft className="mr-2 h-4 w-4" />All batches</Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-bold tracking-tight">{batch.batchNo || 'Packing batch'}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{recipeLabel(selectedRecipe)}{batch.customer?.name ? ` · ${batch.customer.name}` : batch.customerId ? ` · Customer ${batch.customerId}` : ' · Customer-neutral'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}><Edit3 className="mr-2 h-4 w-4" />Edit draft</Button> : null}
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading || saving}><LockKeyhole className="mr-2 h-4 w-4" />{loading ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </div>

      <ErrorNotice error={error} onRetry={refresh} />
      <SuccessNotice>{success}</SuccessNotice>
      {!canWrite ? <ReadOnlyNotice /> : null}
      {batch.launchState?.status && batch.launchState.status !== 'ACTIVE' ? <ReadOnlyNotice>Launch state is {batch.launchState.status}. The server controls whether affected writes are accepted.</ReadOnlyNotice> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Planned base count</p><p className="mt-1 text-xl font-semibold">{formatCount(batch.plannedBaseCount)}</p></CardContent></Card>
        <Card className="shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Planned net weight</p><p className="mt-1 text-xl font-semibold">{formatKg(batch.plannedNetWeightKg)}</p></CardContent></Card>
        <Card className="shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{status === 'DRAFT' ? 'Staged sources' : 'Reserved sources'}</p><p className="mt-1 text-xl font-semibold">{formatCount(sourceCount)}</p></CardContent></Card>
        <Card className="shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Physical units</p><p className="mt-1 text-xl font-semibold">{formatCount(units.length)}</p></CardContent></Card>
      </div>

      {editOpen ? <PackingBatchForm recipes={recipes} customers={customers} batch={batch} canWrite={canWrite} saving={saving} onSubmit={handleEdit} onCancel={() => setEditOpen(false)} /> : null}

      <Card className="shadow-none">
        <CardHeader className="pb-3"><SectionHeading title="Batch controls" description="State transitions are enforced by the backend transition service." /></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {status === 'DRAFT' ? <Button type="button" onClick={handleConfirm} disabled={!canWrite || saving || !draftSources.length}><Check className="mr-2 h-4 w-4" />Confirm batch</Button> : null}
            {status === 'CONFIRMED' ? <Button type="button" onClick={handleStart} disabled={!canWrite || saving}><Play className="mr-2 h-4 w-4" />Start packing</Button> : null}
            {['IN_PROGRESS', 'PARTIALLY_COMPLETED'].includes(status) ? <Button type="button" variant="outline" onClick={() => setActivePanel('containers')} disabled={saving}><Scissors className="mr-2 h-4 w-4" />Build containers</Button> : null}
          </div>
          {['IN_PROGRESS', 'PARTIALLY_COMPLETED'].includes(status) ? (
            <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-3">
              <Field label="Amended target base count" hint="Required before sealing output above target."><Input type="number" min="1" step="1" value={targetForm.baseCount} onChange={(event) => setTargetForm((current) => ({ ...current, baseCount: event.target.value }))} disabled={!canWrite || saving} /></Field>
              <Field label="Amended target weight (kg)"><Input type="number" min="0" step="0.001" value={targetForm.netWeightKg} onChange={(event) => setTargetForm((current) => ({ ...current, netWeightKg: event.target.value }))} disabled={!canWrite || saving} /></Field>
              <div className="flex items-end gap-2"><Field label="Reason" required className="min-w-0 flex-1"><Input value={targetForm.reason} onChange={(event) => setTargetForm((current) => ({ ...current, reason: event.target.value }))} disabled={!canWrite || saving} placeholder="Why is the target changing?" /></Field><Button type="button" variant="outline" className="mb-0" onClick={handleTargetAmend} disabled={!canWrite || saving}>Amend</Button></div>
              <PackingTargetSourceDeltaEditor sources={sources} batchKind={batch.kind} canWrite={canWrite} saving={saving} value={targetForm.sourceDelta} onChange={(sourceDelta) => setTargetForm((current) => ({ ...current, sourceDelta }))} />
            </div>
          ) : null}
          {status === 'PARTIALLY_COMPLETED' ? (
            <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Short-close reason" required hint="Unused source reservations are released by the server."><Input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} disabled={!canWrite || saving} placeholder="Why is the batch ending before target?" /></Field>
              <Button type="button" variant="outline" onClick={handleShortClose} disabled={!canWrite || saving}>Short-close batch</Button>
            </div>
          ) : null}
          {(['DRAFT', 'CONFIRMED'].includes(status) || (status === 'IN_PROGRESS' && !hasOutput)) ? (
            <div className="grid gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Void reason" required hint="A batch with completed output cannot be voided."><Input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} disabled={!canWrite || saving} placeholder="Why is this draft being voided?" /></Field>
              <Button type="button" variant="destructive" onClick={handleVoid} disabled={!canWrite || saving}><XCircle className="mr-2 h-4 w-4" />Void batch</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex gap-1 overflow-x-auto border-b pb-px" role="tablist" aria-label="Packing batch sections">
        {PANELS.map((panel) => (
          <button key={panel.id} type="button" role="tab" aria-selected={activePanel === panel.id} onClick={() => setActivePanel(panel.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${activePanel === panel.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'}`}>
            {panel.label}
          </button>
        ))}
      </div>

      {activePanel === 'sources' ? <PackingSourceReservation batch={batch} canWrite={canWrite} saving={saving} draftSources={draftSources} onDraftSourcesChange={setDraftSources} onReserve={handleSaveSources} /> : null}
      {activePanel === 'containers' ? <PackingContainerBuilder batch={batch} recipe={selectedRecipe} packageTypes={packageTypes} customers={customers} canWrite={canWrite} saving={saving} onCreateUnit={handleCreateUnit} onSeal={handleSeal} onRetryLabel={handleRetryLabel} onReprintLabel={handleReprintLabel} onReplaceBarcode={handleReplaceBarcode} onReleaseQuality={handleReleaseQuality} onReturn={handleReturn} onInspectReturn={handleInspectReturn} onDamage={handleDamage} onWriteOff={handleWriteOff} /> : null}
      {activePanel === 'repacking' ? <Card className="shadow-none"><CardContent className="p-5"><PackingRepackingForm batch={batch} recipes={recipes} customers={customers} canWrite={canWrite} saving={saving} onSubmit={handleRepacking} /></CardContent></Card> : null}
      {activePanel === 'history' ? <PackingBatchHistory batch={batch} /> : null}
    </div>
  );
}
