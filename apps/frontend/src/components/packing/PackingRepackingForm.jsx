import React, { useMemo, useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import { Button, Input } from '../ui';
import { batchUnits, entityId, unitIdentity } from './packingUtils';
import { Field, NativeSelect, SectionHeading, StatusBadge } from './PackingPrimitives';

export function PackingRepackingForm({ batch, recipes = [], customers = [], canWrite, saving, onSubmit }) {
  const units = batchUnits(batch);
  const [selected, setSelected] = useState([]);
  const [recipeId, setRecipeId] = useState(batch?.recipeId || batch?.recipe?.id || '');
  const [customerId, setCustomerId] = useState(batch?.customerId || '');
  const [notes, setNotes] = useState('');
  const [manualSourceIds, setManualSourceIds] = useState('');
  const [error, setError] = useState('');

  const eligibleUnits = useMemo(
    () => units.filter((unit) => ['AVAILABLE', 'RESERVED', 'RETURNED_PENDING_INSPECTION', 'DAMAGED'].includes(String(unit.status || ''))),
    [units],
  );

  const toggleUnit = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const submit = async () => {
    setError('');
    const manualIds = manualSourceIds.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    const sourceUnitIds = [...new Set([...selected, ...manualIds])];
    if (!sourceUnitIds.length) {
      setError('Select at least one eligible Packed Unit or enter a source barcode/ID.');
      return;
    }
    if (!recipeId) {
      setError('Select the output recipe.');
      return;
    }
    if (!notes.trim()) {
      setError('A repacking reason is required.');
      return;
    }
    try {
      await onSubmit({
        kind: 'REPACKING',
        sourceUnitIds,
        recipeId,
        customerId: customerId || null,
        notes: notes.trim() || null,
      });
      setSelected([]);
      setNotes('');
      setManualSourceIds('');
    } catch (submitError) {
      setError(submitError?.message || 'Unable to create the repacking batch.');
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading title="Repacking" description="Select compatible Packed Units. The source units become REPACKED and new physical identities preserve full lineage." />
      <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-3">
        <Field label="Output recipe" required>
          <NativeSelect value={recipeId} onChange={(event) => setRecipeId(event.target.value)} options={recipes.map((recipe) => ({ value: recipe.id, label: `${recipe.familyKey || recipe.name || 'Recipe'} v${recipe.version ?? '—'}` }))} placeholder="Select recipe" disabled={!canWrite || saving} />
        </Field>
        <Field label="Customer" hint="Leave blank for customer-neutral output.">
          <NativeSelect value={customerId} onChange={(event) => setCustomerId(event.target.value)} options={customers.filter((customer) => customer?.isActive !== false).map((customer) => ({ value: customer.id, label: customer.name || customer.displayName || customer.id }))} placeholder="Customer-neutral" disabled={!canWrite || saving} />
        </Field>
        <Field label="Reason" required>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Why is repacking required?" disabled={!canWrite || saving} />
        </Field>
      </div>
      <Field label="Additional source unit IDs or barcodes" hint="Use one exact Packed Unit identity per line or separate values with spaces/commas. The server validates compatibility and availability.">
        <textarea value={manualSourceIds} onChange={(event) => setManualSourceIds(event.target.value)} disabled={!canWrite || saving} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" placeholder="PKU-PB-20260820-0001-L1-U0001" />
      </Field>

      {!eligibleUnits.length ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No eligible Packed Units are present in this batch.</p> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {eligibleUnits.map((unit) => {
            const id = entityId(unit);
            const checked = selected.includes(id);
            return (
              <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleUnit(id)} disabled={!canWrite || saving} className="mt-1 h-4 w-4 rounded border-input" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs break-all">{unitIdentity(unit)}</span><StatusBadge status={unit.status} type="unit" /></span>
                  <span className="mt-1 block text-xs text-muted-foreground">{unit.baseCount ?? '—'} base units · {unit.netWeightKg ?? '—'} kg</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">{selected.length + manualSourceIds.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean).length} source identities staged</span>
        {selected.length || manualSourceIds.trim() ? <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected([]); setManualSourceIds(''); }} disabled={saving}><X className="mr-2 h-4 w-4" />Clear</Button> : null}
        <Button type="button" onClick={submit} disabled={!canWrite || saving || (!selected.length && !manualSourceIds.trim())}><GitBranch className="mr-2 h-4 w-4" />{saving ? 'Creating…' : 'Create repacking batch'}</Button>
      </div>
    </div>
  );
}
