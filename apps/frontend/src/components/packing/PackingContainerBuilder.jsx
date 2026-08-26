import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Scale, Layers3 } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui';
import { batchUnits, canAddUnit, entityId, formatCount, formatKg, packageTypeLabel, recipeLevels, unitIdentity, unitLabel } from './packingUtils';
import { EmptyState, Field, NativeSelect, SectionHeading, StatusBadge } from './PackingPrimitives';
import { PackingUnitActions } from './PackingUnitActions';

const emptyUnit = {
  packageTypeId: '',
  levelIndex: '1',
  parentUnitId: '',
  baseCount: '',
  grossWeightKg: '',
  tareWeightKg: '',
  netWeightKg: '',
  nominalGram: '',
};

export function PackingContainerBuilder({
  batch,
  recipe,
  packageTypes = [],
  customers = [],
  canWrite,
  saving,
  onCreateUnit,
  onSeal,
  onRetryLabel,
  onReprintLabel,
  onReplaceBarcode,
  onReleaseQuality,
  onReturn,
  onInspectReturn,
  onDamage,
  onWriteOff,
}) {
  const [form, setForm] = useState(emptyUnit);
  const [labelPendingUnitIds, setLabelPendingUnitIds] = useState(() => new Set());
  const [error, setError] = useState('');
  const units = batchUnits(batch);
  const levels = recipeLevels(recipe);
  const status = String(batch?.status || 'DRAFT');
  const canCreate = canWrite && !saving && canAddUnit(status);

  const packageTypeOptions = useMemo(
    () => packageTypes.map((packageType) => ({ value: entityId(packageType), label: packageTypeLabel(packageType) })),
    [packageTypes],
  );
  const levelOptions = levels.map((level) => ({ value: String(level.levelIndex), label: `Level ${level.levelIndex} · ${level.packageType?.name || level.packageTypeName || level.packageTypeId || 'Package'}` }));
  const parentOptions = units
    .filter((unit) => ['IN_PROGRESS', 'LABEL_PENDING', 'QUALITY_HOLD', 'AVAILABLE', 'RESERVED'].includes(String(unit.status || '')))
    .map((unit) => ({ value: entityId(unit), label: `${unitIdentity(unit)} · ${unitLabel(unit, packageTypes)}` }));

  useEffect(() => {
    const firstLevel = levels[0];
    setForm((current) => ({
      ...emptyUnit,
      packageTypeId: current.packageTypeId || firstLevel?.packageTypeId || packageTypeOptions[0]?.value || '',
      levelIndex: current.levelIndex || String(firstLevel?.levelIndex || 1),
    }));
  }, [batch?.id, packageTypeOptions, recipe?.id]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const handleCreate = async (event) => {
    event.preventDefault();
    setError('');
    const count = Number(form.baseCount);
    const gross = Number(form.grossWeightKg);
    const tare = Number(form.tareWeightKg);
    const net = Number(form.netWeightKg);
    if (!form.packageTypeId) {
      setError('Select the recipe-defined package type.');
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setError('Base count must be a positive whole number.');
      return;
    }
    if (![gross, tare, net].every((value) => Number.isFinite(value) && value >= 0)) {
      setError('Gross, tare, and net weights must be zero or greater.');
      return;
    }
    if (gross + 1e-9 < tare) {
      setError('Gross weight cannot be lower than tare weight.');
      return;
    }
    try {
      await onCreateUnit({
        packageTypeId: form.packageTypeId,
        levelIndex: Number(form.levelIndex),
        parentUnitId: form.parentUnitId || null,
        baseCount: count,
        grossWeightKg: gross,
        tareWeightKg: tare,
        netWeightKg: net,
        nominalGram: form.nominalGram === '' ? undefined : Number(form.nominalGram),
      });
      setForm((current) => ({ ...emptyUnit, packageTypeId: current.packageTypeId, levelIndex: current.levelIndex }));
    } catch (createError) {
      setError(createError?.message || 'Unable to create the physical container.');
    }
  };

  const markLabelPending = (unit) => setLabelPendingUnitIds((current) => new Set(current).add(entityId(unit)));
  const markLabelReady = (unit) => setLabelPendingUnitIds((current) => {
    const next = new Set(current);
    next.delete(entityId(unit));
    return next;
  });

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4">
        <SectionHeading
          title="Physical container builder"
          description="Recipe levels define the physical hierarchy. A completed unit is immutable; changes create a new identity and event.">
        </SectionHeading>
      </CardHeader>
      <CardContent className="space-y-5">
        {canCreate ? (
          <form className="rounded-lg border bg-muted/20 p-4" onSubmit={handleCreate}>
            <div className="mb-4 flex items-center gap-2"><Layers3 className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Add container</h3></div>
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
              <Field label="Recipe level" required>
                <NativeSelect value={form.levelIndex} onChange={(event) => update('levelIndex', event.target.value)} options={levelOptions} placeholder="Select level" disabled={saving} />
              </Field>
              <Field label="Package type" required>
                <NativeSelect value={form.packageTypeId} onChange={(event) => update('packageTypeId', event.target.value)} options={packageTypeOptions} placeholder="Select package" disabled={saving} />
              </Field>
              <Field label="Parent container" hint="Optional hierarchy link.">
                <NativeSelect value={form.parentUnitId} onChange={(event) => update('parentUnitId', event.target.value)} options={parentOptions} placeholder="No parent" disabled={saving} />
              </Field>
              <Field label="Base count" required>
                <Input type="number" min="1" step="1" value={form.baseCount} onChange={(event) => update('baseCount', event.target.value)} disabled={saving} placeholder="0" />
              </Field>
              <Field label="Nominal gram" hint="Optional snapshot.">
                <Input type="number" min="0" step="0.001" value={form.nominalGram} onChange={(event) => update('nominalGram', event.target.value)} disabled={saving} placeholder="0.000" />
              </Field>
              <div className="flex items-end"><Button type="submit" className="w-full" disabled={saving}><Plus className="mr-2 h-4 w-4" />Add unit</Button></div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Gross weight (kg)" required><Input type="number" min="0" step="0.001" value={form.grossWeightKg} onChange={(event) => update('grossWeightKg', event.target.value)} disabled={saving} placeholder="0.000" /></Field>
              <Field label="Tare weight (kg)" required><Input type="number" min="0" step="0.001" value={form.tareWeightKg} onChange={(event) => update('tareWeightKg', event.target.value)} disabled={saving} placeholder="0.000" /></Field>
              <Field label="Net weight (kg)" required><Input type="number" min="0" step="0.001" value={form.netWeightKg} onChange={(event) => update('netWeightKg', event.target.value)} disabled={saving} placeholder="0.000" /></Field>
            </div>
            {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
          </form>
        ) : null}

        {!units.length ? (
          <EmptyState
            title="No containers created"
            description={canCreate ? 'Add a recipe-defined container above. Sealing assigns the physical barcode.' : 'Containers become available here after the batch starts.'}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Containers in this batch</h3>
              <span className="text-xs text-muted-foreground">{formatCount(units.length)} physical unit{units.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="hidden md:table-cell">Parent</TableHead>
                    <TableHead className="w-20" aria-label="Details" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((unit) => (
                    <TableRow key={entityId(unit)}>
                      {(() => {
                        const labelPending = labelPendingUnitIds.has(entityId(unit));
                        const displayStatus = labelPending ? 'LABEL_PENDING' : unit.status;
                        return (
                          <>
                      <TableCell className="min-w-44">
                        <p className="font-mono text-xs break-all">{unitIdentity(unit)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Level {unit.levelIndex || '—'}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{unitLabel(unit, packageTypes)}</TableCell>
                      <TableCell><StatusBadge status={displayStatus} type="unit" /></TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(unit.baseCount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatKg(unit.netWeightKg)}</TableCell>
                      <TableCell className="hidden max-w-40 truncate font-mono text-xs md:table-cell">{unit.parentUnitId || '—'}</TableCell>
                      <TableCell>
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-primary">Actions</summary>
                          <PackingUnitActions
                            unit={unit}
                            customers={customers}
                            canWrite={canWrite}
                            saving={saving}
                            forceLabelPending={labelPending}
                            onLabelPending={markLabelPending}
                            onLabelReady={markLabelReady}
                            onSeal={(payload) => onSeal(unit, payload)}
                            onRetryLabel={(payload) => onRetryLabel(unit, payload)}
                            onReprintLabel={(payload) => onReprintLabel(unit, payload)}
                            onReplaceBarcode={(payload) => onReplaceBarcode(unit, payload)}
                            onReleaseQuality={(payload) => onReleaseQuality(unit, payload)}
                            onReturn={(payload) => onReturn(unit, payload)}
                            onInspectReturn={(payload) => onInspectReturn(unit, payload)}
                            onDamage={(payload) => onDamage(unit, payload)}
                            onWriteOff={(payload) => onWriteOff(unit, payload)}
                          />
                        </details>
                      </TableCell>
                          </>
                        );
                      })()}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {recipe?.requiresQualityHold ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Scale className="h-3.5 w-3.5" />This recipe requires a quality release before sealed units become stock.</p> : null}
      </CardContent>
    </Card>
  );
}
