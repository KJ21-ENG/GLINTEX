import React, { useEffect, useMemo, useState } from 'react';
import { Save, X } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '../ui';
import {
  BATCH_KINDS,
  DELIVERY_MODES,
  activeRecipe,
  firstValue,
  recipeLabel,
} from './packingUtils';
import { Field, NativeSelect } from './PackingPrimitives';

const emptyForm = {
  kind: 'INITIAL',
  recipeId: '',
  customerId: '',
  deliveryMode: 'UNSPECIFIED',
  plannedBaseCount: '',
  plannedNetWeightKg: '',
  notes: '',
  recipeOverride: '',
  targetAmendmentReason: '',
  amendmentReason: '',
};

function valueFor(batch, ...keys) {
  return firstValue(...keys.map((key) => batch?.[key]));
}

export function PackingBatchForm({
  recipes = [],
  customers = [],
  batch = null,
  canWrite = false,
  saving = false,
  onSubmit,
  onCancel,
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!batch) {
      setForm(emptyForm);
      setError('');
      return;
    }
    setForm({
      kind: valueFor(batch, 'kind') || 'INITIAL',
      recipeId: valueFor(batch, 'recipeId') || batch.recipe?.id || '',
      customerId: valueFor(batch, 'customerId') || batch.customer?.id || '',
      deliveryMode: valueFor(batch, 'deliveryMode') || 'UNSPECIFIED',
      plannedBaseCount: valueFor(batch, 'plannedBaseCount') ?? '',
      plannedNetWeightKg: valueFor(batch, 'plannedNetWeightKg') ?? '',
      notes: valueFor(batch, 'notes') || '',
      recipeOverride: '',
      targetAmendmentReason: '',
      amendmentReason: '',
    });
    setError('');
  }, [batch]);

  const activeRecipes = useMemo(
    () => recipes.filter((recipe) => activeRecipe(recipe) || String(recipe?.id) === String(form.recipeId)),
    [form.recipeId, recipes],
  );

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const status = String(batch?.status || 'DRAFT');
  const recipeLocked = !!batch && status !== 'DRAFT';
  const isEdit = !!batch;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canWrite) return;
    setError('');

    if (!form.recipeId) {
      setError('Select an active recipe before saving the batch.');
      return;
    }
    const baseCount = Number(form.plannedBaseCount);
    const netWeight = Number(form.plannedNetWeightKg);
    if (!Number.isInteger(baseCount) || baseCount <= 0) {
      setError('Planned base count must be a positive whole number.');
      return;
    }
    if (!Number.isFinite(netWeight) || netWeight < 0) {
      setError('Planned net weight must be zero or greater.');
      return;
    }
    if (isEdit && !form.amendmentReason.trim()) {
      setError('A reason is required for an administrative batch amendment.');
      return;
    }

    let recipeOverride = undefined;
    if (form.recipeOverride.trim()) {
      if (!form.targetAmendmentReason.trim()) {
        setError('A batch-only recipe override requires a reason.');
        return;
      }
      try {
        recipeOverride = JSON.parse(form.recipeOverride);
      } catch (_) {
        setError('Batch-only recipe override must be valid JSON.');
        return;
      }
    }

    const payload = {
      recipeId: form.recipeId,
      customerId: form.customerId || null,
      deliveryMode: form.deliveryMode,
      plannedBaseCount: baseCount,
      plannedNetWeightKg: netWeight,
      notes: form.notes.trim() || null,
    };
    if (!isEdit) payload.kind = form.kind;
    if (isEdit) payload.reason = form.amendmentReason.trim();
    if (recipeOverride !== undefined) {
      payload.recipeOverride = recipeOverride;
      payload.targetAmendmentReason = form.targetAmendmentReason.trim();
    }

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(submitError?.message || 'Unable to save the Packing batch.');
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{isEdit ? 'Edit Packing batch' : 'Create Packing batch'}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Drafts do not reserve stock. Confirmation reserves the exact source count and weight on the server.
            </p>
          </div>
          {onCancel ? <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Close batch form"><X className="h-4 w-4" /></Button> : null}
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            {!isEdit ? (
              <Field label="Batch kind" required>
                <NativeSelect value={form.kind} onChange={(event) => update('kind', event.target.value)} options={BATCH_KINDS} disabled={!canWrite || saving} placeholder="" />
              </Field>
            ) : (
              <Field label="Batch number">
                <Input value={batch.batchNo || 'Assigned after save'} readOnly className="bg-muted" />
              </Field>
            )}
            <Field label="Recipe" required hint="Only an ACTIVE recipe can be confirmed.">
              <NativeSelect
                value={form.recipeId}
                onChange={(event) => update('recipeId', event.target.value)}
                options={activeRecipes.map((recipe) => ({ value: recipe.id, label: recipeLabel(recipe) }))}
                placeholder="Select recipe"
                disabled={!canWrite || saving || recipeLocked}
              />
            </Field>
            <Field label="Customer" hint="Leave blank for customer-neutral stock.">
              <NativeSelect
                value={form.customerId}
                onChange={(event) => update('customerId', event.target.value)}
                options={customers
                  .filter((customer) => customer?.isActive !== false)
                  .map((customer) => ({ value: customer.id, label: firstValue(customer.name, customer.displayName, customer.id) }))}
                placeholder="Customer-neutral"
                disabled={!canWrite || saving}
              />
            </Field>
            <Field label="Delivery mode" required hint="Changing delivery mode after IN_PROGRESS requires backend compatibility checks.">
              <NativeSelect
                value={form.deliveryMode}
                onChange={(event) => update('deliveryMode', event.target.value)}
                options={DELIVERY_MODES}
                placeholder=""
                disabled={!canWrite || saving || status === 'IN_PROGRESS' || status === 'PARTIALLY_COMPLETED'}
              />
            </Field>
            <Field label="Planned base count" required>
              <Input type="number" min="1" step="1" value={form.plannedBaseCount} onChange={(event) => update('plannedBaseCount', event.target.value)} disabled={!canWrite || saving} />
            </Field>
            <Field label="Planned net weight (kg)" required>
              <Input type="number" min="0" step="0.001" value={form.plannedNetWeightKg} onChange={(event) => update('plannedNetWeightKg', event.target.value)} disabled={!canWrite || saving} />
            </Field>
          </div>

          <Field label="Notes" hint="Notes are administrative metadata and do not change physical identity.">
            <textarea
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              disabled={!canWrite || saving}
              rows={3}
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Optional operator notes"
            />
          </Field>

          {isEdit ? <Field label="Amendment reason" required hint="Required for any edit to a batch's non-inventory metadata or plan."><Input value={form.amendmentReason} onChange={(event) => update('amendmentReason', event.target.value)} disabled={!canWrite || saving} placeholder="Why is this batch being amended?" /></Field> : null}

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Optional batch-only recipe override</summary>
            <div className="mt-3 space-y-3">
              <Field label="Override snapshot (JSON)" hint="This is stored on the batch and never mutates the selected recipe.">
                <textarea
                  value={form.recipeOverride}
                  onChange={(event) => update('recipeOverride', event.target.value)}
                  disabled={!canWrite || saving}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={'{"levels": [{"levelIndex": 1, "childUnitsPerContainer": 50}]}' }
                />
              </Field>
              <Field label="Override reason" required={!!form.recipeOverride.trim()}>
                <Input value={form.targetAmendmentReason} onChange={(event) => update('targetAmendmentReason', event.target.value)} disabled={!canWrite || saving} placeholder="Why this batch differs from the recipe" />
              </Field>
            </div>
          </details>

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {onCancel ? <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button> : null}
            <Button type="submit" disabled={!canWrite || saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create draft'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
