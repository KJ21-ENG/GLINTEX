import React, { useEffect, useState } from 'react';
import { AlertTriangle, Barcode, ClipboardCheck, PackageCheck, Printer, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { Button, Input } from '../ui';
import { printStageTemplate } from '../../utils/labelPrint';
import { canUsePackingUnitLabelActions, isAuthoritativePackingLabelPending, normalizePackingLabelResponse } from '../../utils/packingLabel';
import { Field, NativeSelect } from './PackingPrimitives';
import { unitIdentity } from './packingUtils';
import { canDamagePackedUnit, canWriteOffPackedUnit } from './packingUnitActionState';

const PACKING_UNIT_LABEL_STAGE = 'packing_unit';
const PACKING_UNIT_LABEL_TEMPLATE = {
  dimensions: {
    width: 75,
    height: 125,
    columns: 1,
    offsetX: 0,
    offsetY: 0,
    fontSize: 10,
    marginTop: 0,
    pageWidth: 75,
    marginLeft: 0,
    orientation: 'landscape',
    verticalGap: 2,
    horizontalGap: 2,
  },
  content: {
    copies: 1,
    texts: [
      {
        id: 'packing-unit-item',
        type: 'text',
        angle: 270,
        pos: { x: 15, y: 122 },
        style: { bold: true, size: 18, italic: false, opacity: 1, visible: true, underline: false, wrapAtCenter: true },
        value: '@itemName',
      },
      {
        id: 'packing-unit-count',
        type: 'text',
        angle: 270,
        pos: { x: 30, y: 122 },
        style: { bold: true, size: 18, italic: false, opacity: 1, visible: true, underline: false, wrapAtCenter: false },
        value: '@baseCount',
      },
      {
        id: 'packing-unit-barcode',
        type: 'barcode',
        angle: 270,
        pos: { x: 45, y: 100 },
        style: { bold: false, heightMm: 12, moduleMm: 0.35, underline: false, humanReadable: true },
        value: '{{barcode}}',
      },
    ],
  },
};

function labelPendingError(message) {
  const error = new Error(`LABEL_PENDING: ${message}`);
  error.code = 'LABEL_PENDING';
  return error;
}

function getAuthoritativeLabel(response, requiresLabel) {
  const result = normalizePackingLabelResponse(response);
  if (result.labelPending || result.unit?.status === 'LABEL_PENDING') {
    throw labelPendingError('The authoritative label is still pending generation.');
  }

  const label = result.label;
  if (!label) {
    if (requiresLabel) throw labelPendingError('The response did not include an authoritative label DTO.');
    return null;
  }
  return label;
}

async function printLabelDto(label) {
  const printResult = await printStageTemplate(PACKING_UNIT_LABEL_STAGE, label, {
    template: PACKING_UNIT_LABEL_TEMPLATE,
    copies: 1,
  });
  if (!printResult?.success) {
    const error = new Error(`LABEL_PRINT_FAILED: ${printResult?.error || 'The physical label print path failed.'}`);
    error.code = 'LABEL_PRINT_FAILED';
    throw error;
  }
  return printResult;
}

async function printAuthoritativeLabel(response, requiresLabel) {
  const label = getAuthoritativeLabel(response, requiresLabel);
  if (!label) return { skipped: true };
  return printLabelDto(label);
}

function ActionShell({ title, children, onCancel }) {
  return (
    <div className="mt-3 rounded-lg border bg-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
      {children}
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled, variant = 'outline' }) {
  return <Button type="button" size="sm" variant={variant} onClick={onClick} disabled={disabled}><Icon className="mr-2 h-3.5 w-3.5" />{label}</Button>;
}

export function PackingUnitActions({ unit, customers = [], canWrite, saving, forceLabelPending = false, onLabelPending, onLabelReady, onSeal, onRetryLabel, onReprintLabel, onReplaceBarcode, onReleaseQuality, onReturn, onInspectReturn, onDamage, onWriteOff }) {
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [replacementConfirmation, setReplacementConfirmation] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [form, setForm] = useState({
    baseCount: unit?.baseCount ?? '',
    grossWeightKg: unit?.grossWeightKg ?? '',
    tareWeightKg: unit?.tareWeightKg ?? '',
    netWeightKg: unit?.netWeightKg ?? '',
    outcome: 'AVAILABLE',
    customerId: '',
    salvageableBaseCount: '0',
    salvageableWeightKg: '0',
    writtenOffBaseCount: unit?.baseCount ?? '',
    writtenOffWeightKg: unit?.netWeightKg ?? '',
    confirmAboveApprovalVariance: false,
    opened: false,
    physicallyChanged: false,
  });

  const open = (nextAction) => {
    setError('');
    setReason('');
    setAction(nextAction);
  };

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const run = async (callback, payload, { print = false, replacement = false } = {}) => {
    setError('');
    let response;
    try {
      response = await callback(payload);
    } catch (actionError) {
      setError(actionError?.message || 'The action could not be completed.');
      return;
    }

    if (print) {
      try {
        const normalizedResponse = normalizePackingLabelResponse(response);
        const actionUnit = normalizedResponse.unit || response?.replacementUnit || unit;
        if (replacement) {
          const label = getAuthoritativeLabel(response, true);
          setReplacementConfirmation({
            oldBarcode: unit?.barcode || unitIdentity(unit),
            newBarcode: label.barcode,
            label,
            unit: actionUnit,
            reason: payload?.reason || '',
          });
          setReason('');
          setAction('');
          return;
        }
        setPrinting(true);
        await printAuthoritativeLabel(response, true);
        if (onLabelReady) onLabelReady(actionUnit);
      } catch (printError) {
        setError(printError?.message || 'LABEL_PENDING: The physical label could not be printed.');
        const pendingUnit = normalizePackingLabelResponse(response).unit || response?.replacementUnit || unit;
        if (isAuthoritativePackingLabelPending(response)) {
          if (onLabelPending) onLabelPending(pendingUnit, printError);
          setAction('retry-label');
        } else {
          setAction('reprint-label');
        }
        setReason('');
        return;
      } finally {
        setPrinting(false);
      }
    }
    setAction('');
  };

  const confirmReplacementPrint = async () => {
    if (!replacementConfirmation?.label) return;
    setError('');
    setPrinting(true);
    try {
      await printLabelDto(replacementConfirmation.label);
      if (onLabelReady) onLabelReady(replacementConfirmation.unit);
      setReplacementConfirmation(null);
    } catch (printError) {
      setError(printError?.message || 'LABEL_PENDING: The physical label could not be printed.');
    } finally {
      setPrinting(false);
    }
  };

  const cancelReplacementPrint = () => {
    if (!replacementConfirmation) return;
    setReplacementConfirmation(null);
    setError(`Server-generated replacement ${replacementConfirmation.newBarcode} was created. Printing remains pending until you confirm the returned identity.`);
  };

  const requireReason = () => {
    if (!reason.trim()) {
      setError('A reason is required for this event.');
      return false;
    }
    return true;
  };

  const status = String(unit?.status || '');
  const effectiveStatus = forceLabelPending ? 'LABEL_PENDING' : status;
  const canAct = canWrite && !saving;
  const canDamage = canDamagePackedUnit(unit, { canWrite, saving, forceLabelPending });
  const canWriteOff = canWriteOffPackedUnit(unit, { canWrite, saving, forceLabelPending });
  const canReturn = status === 'DISPATCHED' && !forceLabelPending;
  const canLabelAction = canUsePackingUnitLabelActions(unit, { canWrite, saving, forceLabelPending })
    && typeof onReprintLabel === 'function'
    && typeof onReplaceBarcode === 'function';

  useEffect(() => {
    if ((action === 'damage' && !canDamage) || (action === 'writeoff' && !canWriteOff)) {
      setAction('');
      setReason('');
      setError('');
    }
  }, [action, canDamage, canWriteOff]);

  useEffect(() => {
    if (replacementConfirmation && !canWrite) setReplacementConfirmation(null);
  }, [canWrite, replacementConfirmation]);

  const submitInspection = () => {
    if (!requireReason()) return;
    if (form.outcome === 'RESERVED' && !form.customerId) {
      setError('Select the explicit current customer assignment for a RESERVED return.');
      return;
    }
    const payload = { outcome: form.outcome, reason: reason.trim() };
    if (form.outcome === 'RESERVED') payload.customerId = form.customerId;
    if (form.outcome === 'DAMAGED') {
      const salvageableBaseCount = Number(form.salvageableBaseCount);
      const salvageableWeightKg = Number(form.salvageableWeightKg);
      if (!Number.isInteger(salvageableBaseCount) || salvageableBaseCount < 0 || !Number.isFinite(salvageableWeightKg) || salvageableWeightKg < 0) {
        setError('Enter exact non-negative salvageable base count and weight.');
        return;
      }
      payload.salvageableBaseCount = salvageableBaseCount;
      payload.salvageableWeightKg = salvageableWeightKg;
    }
    run(onInspectReturn, payload);
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        {status === 'IN_PROGRESS' ? (
          <ActionButton icon={PackageCheck} label="Seal" onClick={() => open('seal')} disabled={!canAct} />
        ) : null}
        {effectiveStatus === 'LABEL_PENDING' ? (
          <ActionButton icon={Printer} label="Retry label" onClick={() => open('retry-label')} disabled={!canAct} />
        ) : null}
        {canLabelAction ? (
          <>
            <ActionButton icon={Printer} label="Reprint label" onClick={() => open('reprint-label')} disabled={!canAct} />
            <ActionButton icon={Barcode} label="Replace barcode" onClick={() => open('replace-barcode')} disabled={!canAct} />
          </>
        ) : null}
        {status === 'QUALITY_HOLD' ? (
          <ActionButton icon={ClipboardCheck} label="Release quality" onClick={() => open('quality')} disabled={!canAct} />
        ) : null}
          {canDamage ? <ActionButton icon={ShieldAlert} label="Damage" onClick={() => open('damage')} disabled={!canAct} variant="destructive" /> : null}
          {canWriteOff ? <ActionButton icon={Trash2} label="Write off" onClick={() => open('writeoff')} disabled={!canAct} variant="destructive" /> : null}
        {canReturn ? <ActionButton icon={RotateCcw} label="Return" onClick={() => open('return')} disabled={!canAct} /> : null}
        {status === 'RETURNED_PENDING_INSPECTION' ? (
          <ActionButton icon={ClipboardCheck} label="Inspect return" onClick={() => open('inspect')} disabled={!canAct} />
        ) : null}
      </div>

      {action === 'seal' ? (
        <ActionShell title={`Seal ${unitIdentity(unit)}`} onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Actual base count" required><Input type="number" min="1" step="1" value={form.baseCount} onChange={(event) => update('baseCount', event.target.value)} /></Field>
            <Field label="Gross weight (kg)" required><Input type="number" min="0" step="0.001" value={form.grossWeightKg} onChange={(event) => update('grossWeightKg', event.target.value)} /></Field>
            <Field label="Tare weight (kg)" required><Input type="number" min="0" step="0.001" value={form.tareWeightKg} onChange={(event) => update('tareWeightKg', event.target.value)} /></Field>
            <Field label="Net weight (kg)" required><Input type="number" min="0" step="0.001" value={form.netWeightKg} onChange={(event) => update('netWeightKg', event.target.value)} /></Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Variance reason" hint="Required by the server above the warning threshold."><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain any variance" /></Field>
            <label className="flex items-start gap-2 pt-7 text-sm">
              <input type="checkbox" checked={form.confirmAboveApprovalVariance} onChange={(event) => update('confirmAboveApprovalVariance', event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
              <span>Explicitly confirm above approval variance threshold</span>
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={() => run(onSeal, { baseCount: Number(form.baseCount), grossWeightKg: Number(form.grossWeightKg), tareWeightKg: Number(form.tareWeightKg), netWeightKg: Number(form.netWeightKg), reason: reason.trim() || null, confirmAboveApprovalVariance: form.confirmAboveApprovalVariance }, { print: true })} disabled={saving}><PackageCheck className="mr-2 h-4 w-4" />Seal and print label</Button>
          </div>
        </ActionShell>
      ) : null}

      {action === 'retry-label' ? (
        <ActionShell title="Retry pending label" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Retry reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why did label generation or printing need retry?" /></Field>
            <Button type="button" onClick={() => requireReason() && run(onRetryLabel, { reason: reason.trim() }, { print: true })} disabled={saving || printing}><Printer className="mr-2 h-4 w-4" />Retry label</Button>
          </div>
        </ActionShell>
      ) : null}

      {action === 'reprint-label' ? (
        <ActionShell title="Reprint unit label" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Reprint reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why does this unit need a new label print?" /></Field>
            <Button type="button" onClick={() => requireReason() && run(onReprintLabel, { reason: reason.trim() }, { print: true })} disabled={saving || printing}><Printer className="mr-2 h-4 w-4" />Reprint label</Button>
          </div>
        </ActionShell>
      ) : null}

      {action === 'replace-barcode' ? (
        <ActionShell title="Replace unit barcode" onCancel={() => setAction('')}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">The server will generate a new identity, void the old barcode, and return the authoritative replacement label for confirmation.</p>
            <Field label="Replacement reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why must this barcode be replaced?" /></Field>
            <div className="flex justify-end"><Button type="button" onClick={() => requireReason() && run(onReplaceBarcode, { reason: reason.trim() }, { print: true, replacement: true })} disabled={saving || printing}><Barcode className="mr-2 h-4 w-4" />Replace barcode</Button></div>
          </div>
        </ActionShell>
      ) : null}

      {action === 'quality' ? (
        <ActionShell title="Release quality hold" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Release reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Quality check completed by…" /></Field>
            <Button type="button" onClick={() => requireReason() && run(onReleaseQuality, { reason: reason.trim() })} disabled={saving}><ClipboardCheck className="mr-2 h-4 w-4" />Release quality</Button>
          </div>
        </ActionShell>
      ) : null}

      {action === 'return' ? (
        <ActionShell title="Receive return for inspection" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Return reason" /></Field>
            <label className="flex items-start gap-2 pt-7 text-sm"><input type="checkbox" checked={form.opened} onChange={(event) => update('opened', event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" /><span>Container was opened</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.physicallyChanged} onChange={(event) => update('physicallyChanged', event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" /><span>Physical composition changed</span></label>
          </div>
          <div className="mt-3 flex justify-end"><Button type="button" onClick={() => requireReason() && run(onReturn, { reason: reason.trim(), opened: form.opened, physicallyChanged: form.physicallyChanged })} disabled={saving}><RotateCcw className="mr-2 h-4 w-4" />Record return</Button></div>
        </ActionShell>
      ) : null}

      {action === 'inspect' ? (
        <ActionShell title="Inspect returned unit" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inspection outcome" required><NativeSelect value={form.outcome} onChange={(event) => update('outcome', event.target.value)} options={[{ value: 'AVAILABLE', label: 'Return to available' }, { value: 'RESERVED', label: 'Return to reserved' }, { value: 'DAMAGED', label: 'Mark damaged' }, { value: 'REPACKED', label: 'Send to repacking' }]} placeholder="" /></Field>
            <Field label="Inspection reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Inspection findings" /></Field>
          </div>
          {form.outcome === 'RESERVED' ? <Field label="Explicit current customer assignment" required hint="A returned unit never reactivates its old reservation automatically."><NativeSelect value={form.customerId} onChange={(event) => update('customerId', event.target.value)} options={customers.filter((customer) => customer?.isActive !== false).map((customer) => ({ value: customer.id, label: customer.name || customer.displayName || customer.id }))} placeholder="Select current customer" /></Field> : null}
          {form.outcome === 'DAMAGED' ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Exact salvageable base count" required hint="Must conserve the sealed unit count."><Input type="number" min="0" step="1" value={form.salvageableBaseCount} onChange={(event) => update('salvageableBaseCount', event.target.value)} /></Field><Field label="Exact salvageable weight (kg)" required hint="Must conserve the sealed unit weight."><Input type="number" min="0" step="0.001" value={form.salvageableWeightKg} onChange={(event) => update('salvageableWeightKg', event.target.value)} /></Field></div> : null}
          <div className="mt-3 flex justify-end"><Button type="button" onClick={submitInspection} disabled={saving}><ClipboardCheck className="mr-2 h-4 w-4" />Save inspection</Button></div>
        </ActionShell>
      ) : null}

      {action === 'damage' && canDamage ? (
        <ActionShell title="Record damage" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Salvageable base count" required><Input type="number" min="0" step="1" value={form.salvageableBaseCount} onChange={(event) => update('salvageableBaseCount', event.target.value)} /></Field>
            <Field label="Salvageable weight (kg)" required><Input type="number" min="0" step="0.001" value={form.salvageableWeightKg} onChange={(event) => update('salvageableWeightKg', event.target.value)} /></Field>
            <Field label="Reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Damage reason" /></Field>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The sealed unit is never reduced in place. Salvageable content becomes a repacking source; the remainder is written off with its own event.</p>
          <div className="mt-3 flex justify-end"><Button type="button" variant="destructive" onClick={() => requireReason() && run(onDamage, { salvageableBaseCount: Number(form.salvageableBaseCount), salvageableWeightKg: Number(form.salvageableWeightKg), reason: reason.trim() })} disabled={saving}><ShieldAlert className="mr-2 h-4 w-4" />Record damage</Button></div>
        </ActionShell>
      ) : null}

      {action === 'writeoff' && canWriteOff ? (
        <ActionShell title="Write off unit content" onCancel={() => setAction('')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Written-off base count" required><Input type="number" min="0" step="1" value={form.writtenOffBaseCount} onChange={(event) => update('writtenOffBaseCount', event.target.value)} /></Field>
            <Field label="Written-off weight (kg)" required><Input type="number" min="0" step="0.001" value={form.writtenOffWeightKg} onChange={(event) => update('writtenOffWeightKg', event.target.value)} /></Field>
            <Field label="Reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Write-off reason" /></Field>
          </div>
          <div className="mt-3 flex justify-end"><Button type="button" variant="destructive" onClick={() => requireReason() && run(onWriteOff, { writtenOffBaseCount: Number(form.writtenOffBaseCount), writtenOffWeightKg: Number(form.writtenOffWeightKg), reason: reason.trim() })} disabled={saving}><Trash2 className="mr-2 h-4 w-4" />Write off</Button></div>
        </ActionShell>
      ) : null}

      {replacementConfirmation ? (
        <ActionShell title="Confirm replacement label identity" onCancel={cancelReplacementPrint}>
          <div className="space-y-3 text-sm">
            <p>The server created this replacement identity. Verify it against the physical unit before printing.</p>
            <dl className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Previous barcode</dt><dd className="font-mono font-medium">{replacementConfirmation.oldBarcode}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Replacement barcode</dt><dd className="font-mono font-medium">{replacementConfirmation.newBarcode}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Item</dt><dd>{replacementConfirmation.label.itemName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Base count</dt><dd>{replacementConfirmation.label.baseCount}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Reason: {replacementConfirmation.reason || '—'}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={cancelReplacementPrint} disabled={printing}>Keep printing pending</Button>
              <Button type="button" onClick={confirmReplacementPrint} disabled={printing}>{printing ? 'Printing…' : 'Confirm identity & print'}</Button>
            </div>
          </div>
        </ActionShell>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {effectiveStatus === 'LABEL_PENDING' ? <p className="mt-3 flex items-center gap-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />LABEL_PENDING: label generation or printing must succeed before this unit is available.</p> : null}
      {status === 'QUALITY_HOLD' ? <p className="mt-3 flex items-center gap-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Quality release is required before this unit can enter stock.</p> : null}
    </div>
  );
}
