import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui';
import { batchSources, formatCount, formatKg, sourceIdentity, SOURCE_TYPES } from './packingUtils';
import { EmptyState, Field, NativeSelect, SectionHeading } from './PackingPrimitives';
import { canSubmitSourceDelta, releaseExceedsResidual } from './packingSourceReservationRules';

const emptySource = {
  sourceType: 'CONING_RECEIVE',
  sourceId: '',
  sourceBarcode: '',
  reservedBaseCount: '',
  reservedNetWeightKg: '',
};

const normalizeSource = (source, defaultSourceType) => ({
  reserved: source.reserved === true,
  sourceType: source.sourceType || defaultSourceType,
  sourceId: source.sourceId || source.id || '',
  sourceBarcode: source.sourceBarcode || source.barcode || '',
  reservedBaseCount: source.reservedBaseCount ?? source.baseCount ?? '',
  reservedNetWeightKg: source.reservedNetWeightKg ?? source.netWeightKg ?? '',
  consumedBaseCount: Number(source.consumedBaseCount || 0),
  consumedNetWeightKg: Number(source.consumedNetWeightKg || 0),
  releasedBaseCount: Number(source.releasedBaseCount || 0),
  releasedNetWeightKg: Number(source.releasedNetWeightKg || 0),
});

const sourceKey = (source) => `${source.sourceType}:${String(source.sourceId || '').trim()}`;

const sourcePayload = (row) => ({
  sourceType: row.sourceType,
  sourceId: String(row.sourceId || '').trim(),
  sourceBarcode: String(row.sourceBarcode || '').trim() || null,
  reservedBaseCount: Number(row.reservedBaseCount),
  reservedNetWeightKg: Number(row.reservedNetWeightKg),
});

const releasePayload = (row) => ({
  sourceType: row.sourceType,
  sourceId: String(row.sourceId || '').trim(),
  releasedBaseCount: Number(row.releasedBaseCount),
  releasedNetWeightKg: Number(row.releasedNetWeightKg),
});

const sourceResidual = (source) => ({
  count: Math.max(0, Number(source.reservedBaseCount || 0) - Number(source.consumedBaseCount || 0) - Number(source.releasedBaseCount || 0)),
  weight: Math.max(0, Number(source.reservedNetWeightKg || 0) - Number(source.consumedNetWeightKg || 0) - Number(source.releasedNetWeightKg || 0)),
});

const sumRows = (rows, subtractReleases = false) => rows.reduce((totals, row) => ({
  count: totals.count + Number(row.reservedBaseCount || 0) - (subtractReleases ? Number(row.releasedBaseCount || 0) : 0),
  weight: totals.weight + Number(row.reservedNetWeightKg || 0) - (subtractReleases ? Number(row.releasedNetWeightKg || 0) : 0),
}), { count: 0, weight: 0 });

const sumReleases = (releases) => releases.reduce((totals, release) => ({
  count: totals.count + Number(release.releasedBaseCount || 0),
  weight: totals.weight + Number(release.releasedNetWeightKg || 0),
}), { count: 0, weight: 0 });

function batchSourceType(batch) {
  return batch?.kind === 'REPACKING' ? 'PACKED_UNIT' : 'CONING_RECEIVE';
}

export function PackingSourceReservation({ batch, canWrite, saving, onReserve, draftSources = [], onDraftSourcesChange }) {
  const status = String(batch?.status || 'DRAFT');
  const isDraft = status === 'DRAFT';
  const allowedSourceType = batchSourceType(batch);
  const sourceOptions = useMemo(() => SOURCE_TYPES.filter((source) => source.value === allowedSourceType), [allowedSourceType]);
  const [rows, setRows] = useState(() => (isDraft ? draftSources : batchSources(batch)).map((source) => ({ ...normalizeSource(source, allowedSourceType), reserved: isDraft ? false : true })));
  const [draft, setDraft] = useState({ ...emptySource, sourceType: allowedSourceType });
  const [stagedReleases, setStagedReleases] = useState([]);
  const [releaseDrafts, setReleaseDrafts] = useState({});
  const [deltaReason, setDeltaReason] = useState('');
  const [error, setError] = useState('');
  const [savedDraft, setSavedDraft] = useState(false);

  useEffect(() => {
    const nextSources = isDraft ? draftSources : batchSources(batch);
    setRows(nextSources.map((source) => ({ ...normalizeSource(source, allowedSourceType), reserved: isDraft ? false : true })));
    setDraft({ ...emptySource, sourceType: allowedSourceType });
    setStagedReleases([]);
    setReleaseDrafts({});
    setDeltaReason('');
    setError('');
    setSavedDraft(false);
  }, [allowedSourceType, batch?.id, batch?.status, batch?.version, draftSources, isDraft]);

  const canReserve = canWrite && (isDraft || ['CONFIRMED', 'IN_PROGRESS'].includes(status));
  const committedRows = useMemo(() => rows.filter((row) => row.reserved), [rows]);
  const pendingRows = useMemo(() => rows.filter((row) => !row.reserved), [rows]);
  const committedTotals = useMemo(() => sumRows(committedRows, true), [committedRows]);
  const pendingTotals = useMemo(() => sumRows(pendingRows), [pendingRows]);
  const releaseTotals = useMemo(() => sumReleases(stagedReleases), [stagedReleases]);
  const hasInvalidStagedRelease = useMemo(() => stagedReleases.some((release) => {
    const source = committedRows.find((row) => sourceKey(row) === sourceKey(release));
    return source && releaseExceedsResidual(release, sourceResidual(source));
  }), [committedRows, stagedReleases]);
  const projectedTotals = isDraft
    ? sumRows(rows)
    : {
      count: committedTotals.count + pendingTotals.count - releaseTotals.count,
      weight: committedTotals.weight + pendingTotals.weight - releaseTotals.weight,
    };
  const targetCount = Number(batch?.plannedBaseCount);
  const targetWeight = Number(batch?.plannedNetWeightKg);
  const projectedMatchesTarget = Number.isInteger(targetCount)
    && projectedTotals.count === targetCount
    && Number.isFinite(targetWeight)
    && Math.abs(projectedTotals.weight - targetWeight) <= 0.001;
  const hasActiveDelta = pendingRows.length > 0 || stagedReleases.length > 0;
  const canSubmitDelta = canSubmitSourceDelta({ hasActiveDelta, projectedMatchesTarget, hasInvalidStagedRelease });

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const addRow = () => {
    setError('');
    const sourceId = String(draft.sourceId || '').trim();
    const count = Number(draft.reservedBaseCount);
    const weight = Number(draft.reservedNetWeightKg);
    if (draft.sourceType !== allowedSourceType) {
      setError(`This ${batch?.kind || 'Packing'} batch accepts only ${allowedSourceType} sources.`);
      return;
    }
    if (!sourceId) {
      setError('Enter the authoritative source ID before adding a source.');
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setError('Reserved base count must be a positive whole number.');
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Reserved net weight must be greater than zero.');
      return;
    }
    const candidate = { ...draft, sourceType: allowedSourceType, sourceId, reservedBaseCount: count, reservedNetWeightKg: weight, reserved: false };
    if (rows.some((row) => sourceKey(row) === sourceKey(candidate))) {
      setError('A source may appear only once in the batch reservation set.');
      return;
    }
    const nextRows = [...rows, candidate];
    setRows(nextRows);
    if (isDraft && onDraftSourcesChange) onDraftSourcesChange(nextRows.map(sourcePayload));
    setSavedDraft(false);
    setDraft({ ...emptySource, sourceType: allowedSourceType });
  };

  const removeRow = (index) => {
    if (!isDraft && rows[index]?.reserved) return;
    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
    setRows(nextRows);
    if (isDraft && onDraftSourcesChange) onDraftSourcesChange(nextRows.map(sourcePayload));
    setSavedDraft(false);
  };

  const handleDraftSave = () => {
    setError('');
    if (!rows.length) {
      setError('Add at least one source selection before saving the draft.');
      return;
    }
    if (onDraftSourcesChange) onDraftSourcesChange(rows.map(sourcePayload));
    setSavedDraft(true);
  };

  const stageRelease = (source) => {
    setError('');
    const key = sourceKey(source);
    const draftRelease = releaseDrafts[key] || {};
    const count = Number(draftRelease.releasedBaseCount);
    const weight = Number(draftRelease.releasedNetWeightKg);
    if (source.sourceType !== allowedSourceType) {
      setError(`This ${batch?.kind || 'Packing'} batch accepts only ${allowedSourceType} sources.`);
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setError(`Release count for ${sourceIdentity(source)} must be a positive whole number.`);
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setError(`Release weight for ${sourceIdentity(source)} must be greater than zero.`);
      return;
    }
    setStagedReleases((current) => [...current.filter((release) => sourceKey(release) !== key), {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      releasedBaseCount: count,
      releasedNetWeightKg: weight,
    }]);
    setSavedDraft(false);
  };

  const removeRelease = (key) => {
    setStagedReleases((current) => current.filter((release) => sourceKey(release) !== key));
    setReleaseDrafts((current) => ({ ...current, [key]: {} }));
    setSavedDraft(false);
  };

  const handleReserve = async () => {
    setError('');
    if (isDraft) {
      handleDraftSave();
      return;
    }
    const sourceDelta = {
      additions: pendingRows.map(sourcePayload),
      releases: stagedReleases.map(releasePayload),
    };
    if (!sourceDelta.additions.length && !sourceDelta.releases.length) {
      setError('Stage at least one exact source addition or release before applying the active source delta.');
      return;
    }
    if (sourceDelta.releases.length && !deltaReason.trim()) {
      setError('A reason is required when releasing an existing source reservation.');
      return;
    }
    if (!projectedMatchesTarget && !hasInvalidStagedRelease) {
      setError(`The active source delta must preserve the batch target exactly: ${formatCount(targetCount)} base units and ${formatKg(targetWeight)}.`);
      return;
    }
    try {
      const response = await onReserve({ sourceDelta, ...(deltaReason.trim() ? { reason: deltaReason.trim() } : {}) });
      const responseBatch = response?.batch || response?.data?.batch || null;
      const nextSources = responseBatch ? batchSources(responseBatch) : (Array.isArray(response?.sources) ? response.sources : []);
      if (nextSources.length) setRows(nextSources.map((source) => ({ ...normalizeSource(source, allowedSourceType), reserved: true })));
      setStagedReleases([]);
      setReleaseDrafts({});
      setDeltaReason('');
      setSavedDraft(false);
      setDraft({ ...emptySource, sourceType: allowedSourceType });
    } catch (reserveError) {
      setError(reserveError?.message || 'The server could not apply this source delta atomically.');
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4">
        <SectionHeading
          title="Source reservation"
          description={isDraft ? 'Selections stay client-side in DRAFT. Confirming the batch submits the complete set for one atomic authoritative reservation.' : 'Active changes are submitted as one exact source delta. Additions and releases must preserve the unchanged batch target.'}
          actions={<span className="text-xs text-muted-foreground">{formatCount(projectedTotals.count)} base units · {formatKg(projectedTotals.weight)}</span>}
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Base count</TableHead>
                  <TableHead className="text-right">Net weight</TableHead>
                  <TableHead className="w-12" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={`${sourceKey(row)}-${index}`}>
                    <TableCell>
                      <p className="font-mono text-xs">{sourceIdentity(row)}</p>
                      {row.sourceBarcode ? <p className="mt-1 text-xs text-muted-foreground">Barcode: {row.sourceBarcode}</p> : null}
                      {!isDraft && row.reserved && (row.releasedBaseCount || row.releasedNetWeightKg) ? <p className="mt-1 text-xs text-muted-foreground">Released: {formatCount(row.releasedBaseCount)} · {formatKg(row.releasedNetWeightKg)}</p> : null}
                    </TableCell>
                    <TableCell className="text-sm">{row.sourceType === 'PACKED_UNIT' ? 'Packed unit' : 'Coning receive'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.reservedBaseCount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKg(row.reservedNetWeightKg)}</TableCell>
                    <TableCell>
                      {isDraft || !row.reserved ? (
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)} disabled={!canReserve || saving} aria-label={`Remove ${sourceIdentity(row)}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      ) : <span className="px-2 text-xs text-muted-foreground" title="Existing reservation remains committed until an explicit release is staged">✓</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No sources staged" description="Scan or enter the exact source identity, count, and weight to stage a reservation." />
        )}

        <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-5 md:items-end">
          <Field label="Source type" className="md:col-span-1">
            <NativeSelect value={draft.sourceType} onChange={(event) => updateDraft('sourceType', event.target.value)} options={sourceOptions} placeholder="" disabled={!canReserve || saving} />
          </Field>
          <Field label="Source ID" required hint="Use the server identity, not a lot note." className="md:col-span-1">
            <Input value={draft.sourceId} onChange={(event) => updateDraft('sourceId', event.target.value)} disabled={!canReserve || saving} placeholder="Source ID" />
          </Field>
          <Field label="Barcode" hint="Optional exact source barcode." className="md:col-span-1">
            <Input value={draft.sourceBarcode} onChange={(event) => updateDraft('sourceBarcode', event.target.value)} disabled={!canReserve || saving} placeholder="Barcode" />
          </Field>
          <Field label="Base count" required className="md:col-span-1">
            <Input type="number" min="1" step="1" value={draft.reservedBaseCount} onChange={(event) => updateDraft('reservedBaseCount', event.target.value)} disabled={!canReserve || saving} placeholder="0" />
          </Field>
          <div className="flex gap-2 md:col-span-1">
            <Field label="Net weight (kg)" required className="min-w-0 flex-1">
              <Input type="number" min="0.001" step="0.001" value={draft.reservedNetWeightKg} onChange={(event) => updateDraft('reservedNetWeightKg', event.target.value)} disabled={!canReserve || saving} placeholder="0.000" />
            </Field>
            <Button type="button" variant="outline" size="icon" className="mt-6 shrink-0" onClick={addRow} disabled={!canReserve || saving} aria-label="Add source"><Plus className="h-4 w-4" /></Button>
          </div>
        </div>

        {!isDraft ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div>
              <p className="text-sm font-medium">Release from an existing reservation</p>
              <p className="mt-1 text-xs text-muted-foreground">Stage releases beside additions, then submit the complete delta once. Releases cannot exceed consumed-free source residuals.</p>
            </div>
            <Field label="Reason" required={stagedReleases.length > 0} hint="Required when releasing an existing reservation.">
              <Input value={deltaReason} onChange={(event) => setDeltaReason(event.target.value)} disabled={!canReserve || saving} placeholder="Why is this active source delta needed?" />
            </Field>
            {!committedRows.length ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No existing source reservations are available to release.</p> : committedRows.map((source) => {
              const key = sourceKey(source);
              const residual = sourceResidual(source);
              const staged = stagedReleases.find((release) => sourceKey(release) === key);
              return (
                <div key={key} className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[1.3fr_0.7fr_0.7fr_auto] md:items-end">
                  <div className="min-w-0 text-xs"><p className="break-all font-medium">{sourceIdentity(source)}</p><p className="mt-1 text-muted-foreground">Residual: {formatCount(residual.count)} base units · {formatKg(residual.weight)}</p>{staged ? <p className="mt-1 text-amber-700 dark:text-amber-300">Staged release: {formatCount(staged.releasedBaseCount)} · {formatKg(staged.releasedNetWeightKg)}</p> : null}</div>
                  <Field label="Release count"><Input type="number" min="0" step="1" value={releaseDrafts[key]?.releasedBaseCount || ''} onChange={(event) => setReleaseDrafts((current) => ({ ...current, [key]: { ...current[key], releasedBaseCount: event.target.value } }))} disabled={!canReserve || saving || !residual.count} placeholder="0" /></Field>
                  <Field label="Release weight (kg)"><Input type="number" min="0" step="0.001" value={releaseDrafts[key]?.releasedNetWeightKg || ''} onChange={(event) => setReleaseDrafts((current) => ({ ...current, [key]: { ...current[key], releasedNetWeightKg: event.target.value } }))} disabled={!canReserve || saving || !residual.weight} placeholder="0.000" /></Field>
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => stageRelease(source)} disabled={!canReserve || saving || !residual.count || !residual.weight}><Minus className="mr-2 h-4 w-4" />{staged ? 'Update release' : 'Stage release'}</Button>{staged ? <Button type="button" variant="ghost" size="icon" onClick={() => removeRelease(key)} disabled={!canReserve || saving} aria-label={`Remove release ${sourceIdentity(source)}`}><Trash2 className="h-4 w-4 text-destructive" /></Button> : null}</div>
                </div>
              );
            })}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {!isDraft && hasActiveDelta && !projectedMatchesTarget ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200" role="status">Projected active reservation is {formatCount(projectedTotals.count)} base units and {formatKg(projectedTotals.weight)}. It must equal the unchanged target of {formatCount(targetCount)} base units and {formatKg(targetWeight)} before submission.</p> : null}
        <div className="flex items-center justify-end gap-3">
          {isDraft && savedDraft ? <span className="text-xs text-muted-foreground">Draft selections saved locally. Nothing is reserved yet.</span> : null}
          <Button type="button" onClick={handleReserve} disabled={!canReserve || saving || (!isDraft && !canSubmitDelta) || (isDraft && !rows.length)}>
            <Save className="mr-2 h-4 w-4" />
            {isDraft ? 'Save draft selections' : saving ? 'Applying…' : 'Apply source delta'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
