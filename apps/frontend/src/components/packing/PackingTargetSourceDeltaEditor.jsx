import React, { useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Input } from '../ui';
import { SOURCE_TYPES, formatCount, formatKg, sourceIdentity } from './packingUtils';
import { EmptyState, Field, NativeSelect, SectionHeading } from './PackingPrimitives';

const emptyAddition = {
  sourceType: 'CONING_RECEIVE',
  sourceId: '',
  sourceBarcode: '',
  reservedBaseCount: '',
  reservedNetWeightKg: '',
};

const normalizeDelta = (value) => ({
  additions: Array.isArray(value?.additions) ? value.additions : [],
  releases: Array.isArray(value?.releases) ? value.releases : [],
});

const sourceKey = (source) => `${source.sourceType}:${String(source.sourceId || '').trim()}`;

const sourceResidual = (source) => ({
  count: Math.max(0, Number(source?.reservedBaseCount || 0) - Number(source?.consumedBaseCount || 0) - Number(source?.releasedBaseCount || 0)),
  weight: Math.max(0, Number(source?.reservedNetWeightKg || 0) - Number(source?.consumedNetWeightKg || 0) - Number(source?.releasedNetWeightKg || 0)),
});

export function PackingTargetSourceDeltaEditor({ sources = [], batchKind, canWrite, saving, value, onChange }) {
  const delta = normalizeDelta(value);
  const [addition, setAddition] = useState({ ...emptyAddition, sourceType: batchKind === 'REPACKING' ? 'PACKED_UNIT' : 'CONING_RECEIVE' });
  const [releaseDrafts, setReleaseDrafts] = useState({});
  const [error, setError] = useState('');
  const allowedSourceType = batchKind === 'REPACKING' ? 'PACKED_UNIT' : 'CONING_RECEIVE';
  const sourceOptions = useMemo(() => SOURCE_TYPES.filter((source) => source.value === allowedSourceType), [allowedSourceType]);
  const existingKeys = useMemo(() => new Set(sources.map(sourceKey)), [sources]);
  const stagedKeys = useMemo(() => new Set([...delta.additions, ...delta.releases].map(sourceKey)), [delta]);

  const updateDelta = (next) => onChange({ additions: next.additions || [], releases: next.releases || [] });
  const updateAddition = (key, nextValue) => setAddition((current) => ({ ...current, [key]: nextValue }));

  const addSource = () => {
    setError('');
    const count = Number(addition.reservedBaseCount);
    const weight = Number(addition.reservedNetWeightKg);
    const key = sourceKey(addition);
    if (!addition.sourceId.trim()) {
      setError('Enter the exact source ID for the addition.');
      return;
    }
    if (existingKeys.has(key) || stagedKeys.has(key)) {
      setError('A source may appear only once in this sourceDelta.');
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setError('Added source base count must be a positive whole number.');
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Added source net weight must be greater than zero.');
      return;
    }
    updateDelta({
      additions: [...delta.additions, {
        sourceType: addition.sourceType,
        sourceId: addition.sourceId.trim(),
        sourceBarcode: addition.sourceBarcode.trim() || null,
        reservedBaseCount: count,
        reservedNetWeightKg: weight,
      }],
      releases: delta.releases,
    });
    setAddition({ ...emptyAddition, sourceType: allowedSourceType });
  };

  const stageRelease = (source) => {
    setError('');
    const key = sourceKey(source);
    const residual = sourceResidual(source);
    const draft = releaseDrafts[key] || {};
    const count = Number(draft.releasedBaseCount);
    const weight = Number(draft.releasedNetWeightKg);
    if (!Number.isInteger(count) || count <= 0 || count > residual.count) {
      setError(`Release count for ${sourceIdentity(source)} must be a positive whole number no greater than ${formatCount(residual.count)}.`);
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > residual.weight + 0.001) {
      setError(`Release weight for ${sourceIdentity(source)} must be greater than zero and no greater than ${formatKg(residual.weight)}.`);
      return;
    }
    updateDelta({
      additions: delta.additions,
      releases: [...delta.releases.filter((release) => sourceKey(release) !== key), {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        releasedBaseCount: count,
        releasedNetWeightKg: weight,
      }],
    });
  };

  const removeAddition = (key) => updateDelta({ additions: delta.additions.filter((source) => sourceKey(source) !== key), releases: delta.releases });
  const removeRelease = (key) => updateDelta({ additions: delta.additions, releases: delta.releases.filter((source) => sourceKey(source) !== key) });

  return (
    <Card className="shadow-none md:col-span-3">
      <CardContent className="space-y-4 p-4">
        <SectionHeading
          title="Source delta"
          description="Stage additions and releases against exact source identities. The server applies the complete delta atomically with the new target."
          actions={<span className="text-xs text-muted-foreground">{delta.additions.length} addition{delta.additions.length === 1 ? '' : 's'} · {delta.releases.length} release{delta.releases.length === 1 ? '' : 's'}</span>}
        />

        {delta.additions.length || delta.releases.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {delta.additions.map((source) => (
              <div key={`addition-${sourceKey(source)}`} className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="min-w-0 text-xs"><p className="font-medium text-emerald-800 dark:text-emerald-200">Addition · {sourceIdentity(source)}</p><p className="mt-1 text-muted-foreground">+{formatCount(source.reservedBaseCount)} base units · +{formatKg(source.reservedNetWeightKg)}</p></div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeAddition(sourceKey(source))} disabled={!canWrite || saving} aria-label={`Remove addition ${sourceIdentity(source)}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
            {delta.releases.map((source) => (
              <div key={`release-${sourceKey(source)}`} className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="min-w-0 text-xs"><p className="font-medium text-amber-800 dark:text-amber-200">Release · {sourceIdentity(source)}</p><p className="mt-1 text-muted-foreground">-{formatCount(source.releasedBaseCount)} base units · -{formatKg(source.releasedNetWeightKg)}</p></div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeRelease(sourceKey(source))} disabled={!canWrite || saving} aria-label={`Remove release ${sourceIdentity(source)}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No source delta staged" description="Add a source or stage a release before amending the target." />}

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-5 md:items-end">
          <Field label="Add source type"><NativeSelect value={addition.sourceType} onChange={(event) => updateAddition('sourceType', event.target.value)} options={sourceOptions} placeholder="" disabled={!canWrite || saving} /></Field>
          <Field label="Add source ID" required><Input value={addition.sourceId} onChange={(event) => updateAddition('sourceId', event.target.value)} disabled={!canWrite || saving} placeholder="Exact source ID" /></Field>
          <Field label="Add source barcode"><Input value={addition.sourceBarcode} onChange={(event) => updateAddition('sourceBarcode', event.target.value)} disabled={!canWrite || saving} placeholder="Optional exact barcode" /></Field>
          <Field label="Add count / weight" required><div className="grid grid-cols-2 gap-2"><Input type="number" min="1" step="1" value={addition.reservedBaseCount} onChange={(event) => updateAddition('reservedBaseCount', event.target.value)} disabled={!canWrite || saving} placeholder="Count" /><Input type="number" min="0.001" step="0.001" value={addition.reservedNetWeightKg} onChange={(event) => updateAddition('reservedNetWeightKg', event.target.value)} disabled={!canWrite || saving} placeholder="kg" /></div></Field>
          <Button type="button" variant="outline" onClick={addSource} disabled={!canWrite || saving}><Plus className="mr-2 h-4 w-4" />Stage addition</Button>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Release from an existing reservation</p>
          {!sources.length ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No existing source reservations are available to release.</p> : sources.map((source) => {
            const key = sourceKey(source);
            const residual = sourceResidual(source);
            const staged = delta.releases.some((release) => sourceKey(release) === key);
            return (
              <div key={key} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1.3fr_0.7fr_0.7fr_auto] md:items-end">
                <div className="min-w-0 text-xs"><p className="font-medium break-all">{sourceIdentity(source)}</p><p className="mt-1 text-muted-foreground">Residual: {formatCount(residual.count)} base units · {formatKg(residual.weight)}</p></div>
                <Field label="Release count"><Input type="number" min="0" step="1" value={releaseDrafts[key]?.releasedBaseCount || ''} onChange={(event) => setReleaseDrafts((current) => ({ ...current, [key]: { ...current[key], releasedBaseCount: event.target.value } }))} disabled={!canWrite || saving || !residual.count} placeholder="0" /></Field>
                <Field label="Release weight (kg)"><Input type="number" min="0" step="0.001" value={releaseDrafts[key]?.releasedNetWeightKg || ''} onChange={(event) => setReleaseDrafts((current) => ({ ...current, [key]: { ...current[key], releasedNetWeightKg: event.target.value } }))} disabled={!canWrite || saving || !residual.weight} placeholder="0.000" /></Field>
                <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => stageRelease(source)} disabled={!canWrite || saving || !residual.count || !residual.weight}><Minus className="mr-2 h-4 w-4" />{staged ? 'Update release' : 'Stage release'}</Button>{staged ? <Button type="button" variant="ghost" size="icon" onClick={() => removeRelease(key)} disabled={!canWrite || saving} aria-label={`Remove release ${sourceIdentity(source)}`}><Trash2 className="h-4 w-4 text-destructive" /></Button> : null}</div>
              </div>
            );
          })}
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
