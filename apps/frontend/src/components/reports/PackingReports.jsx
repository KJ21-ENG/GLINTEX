import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Check,
  ClipboardCheck,
  Eye,
  Factory,
  History,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Undo2,
} from 'lucide-react';

import { Badge, Button, Card, CardContent, Input, Label } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { usePermission } from '../../hooks/usePermission';
import { formatDateDDMMYYYY, formatKg } from '../../utils';
import { cn } from '../../lib/utils';
import { BarcodeTreeView } from './BarcodeTreeView';
import { buildPackingReportQuery, mergePackingReportFilters } from './reportQuery';
import {
  getPackingBarcodeHistory,
  getPackingExceptionsReport,
  getPackingProductionReport,
  getPackingReconciliationReport,
  getPackingStockReport,
  getPackingVarianceReport,
} from '../../api/packingReports';
import { applyReconciliationBatch, createReconciliationBatch, previewReconciliationBatch, reverseReconciliationBatch } from '../../api/reconciliation';
import { buildReconciliationCreatePayload, getReconciliationActionState } from './reconciliationActionState';

const TABS = [
  { key: 'production', label: 'Packing Production', icon: Factory },
  { key: 'stock', label: 'Packed Stock', icon: Boxes },
  { key: 'variance', label: 'Yield & Variance', icon: ClipboardCheck },
  { key: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { key: 'reconciliation', label: 'Reconciliation', icon: PackageCheck },
  { key: 'history', label: 'Barcode History', icon: History },
];

const INITIAL_FILTERS = { dateFrom: '', dateTo: '', status: '', kind: '' };

function formatDate(value) {
  if (!value) return '—';
  try {
    return formatDateDDMMYYYY(value);
  } catch {
    return String(value).slice(0, 10);
  }
}

function formatNumber(value, { minimumFractionDigits = 0, maximumFractionDigits = 3 } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits }) : String(value);
}

function ReportSummary({ cards }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Card key={card.label} className="border-border/70">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">{card.label}</div>
            <div className="mt-1 text-xl font-semibold">{card.value}</div>
            {card.detail ? <div className="mt-1 text-[11px] text-muted-foreground">{card.detail}</div> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{message}</div>;
}

function ReportTable({ columns, rows, rowKey }) {
  if (!rows.length) return <EmptyState message="No records match the selected filters." />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column) => <th key={column.key} className="px-3 py-2 font-medium whitespace-nowrap">{column.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="align-top hover:bg-muted/20">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-2', column.mono && 'font-mono text-xs', column.numeric && 'text-right tabular-nums')}>
                  {column.render ? column.render(row) : (row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusBadge(value) {
  if (!value) return '—';
  const warning = ['QUALITY_HOLD', 'WARNING', 'APPROVAL_REQUIRED', 'DAMAGED', 'FAILED'].includes(value);
  return <Badge variant={warning ? 'destructive' : 'outline'} className="text-[10px]">{value}</Badge>;
}

function reconciliationFormDefaults() {
  return {
    kind: 'MANUAL_CORRECTION',
    reason: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    auditReference: 'Authenticated reconciliation balance review',
    sourceType: 'CONING_RECEIVE',
    sourceId: '',
    sourceBarcode: '',
    countDelta: '1',
    weightDeltaKg: '0.1',
    confirmed: false,
  };
}

function reconciliationInputClassName() {
  return 'mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
}

function reconciliationTextareaClassName() {
  return 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
}

function ReconciliationRowActions({ row, canWrite, busy, onApply, onReverse, onPreview }) {
  const actionState = getReconciliationActionState(row, canWrite);
  if (!canWrite) {
    return actionState.canPreview
      ? <Button type="button" size="sm" variant="outline" onClick={() => onPreview(row)} disabled={busy}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button>
      : <span className="text-xs text-muted-foreground">Read only</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {actionState.canPreview ? <Button type="button" size="sm" variant="outline" onClick={() => onPreview(row)} disabled={busy}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button> : null}
      {actionState.canApply ? <Button type="button" size="sm" variant="outline" onClick={() => onApply(row)} disabled={busy}><Check className="mr-1.5 h-3.5 w-3.5" />Apply</Button> : null}
      {actionState.canReverse ? <Button type="button" size="sm" variant="outline" onClick={() => onReverse(row)} disabled={busy}><Undo2 className="mr-1.5 h-3.5 w-3.5" />Reverse</Button> : null}
      {actionState.canApplyDiagnostic ? <Button type="button" size="sm" variant="ghost" onClick={() => onApply(row)} disabled={busy} title="Attempt Apply to show the server's terminal-state diagnostic"><Check className="mr-1.5 h-3.5 w-3.5" />Apply diagnostic</Button> : null}
      {actionState.canReverseDiagnostic ? <Button type="button" size="sm" variant="ghost" onClick={() => onReverse(row)} disabled={busy} title="Attempt Reverse to show the server's state diagnostic"><Undo2 className="mr-1.5 h-3.5 w-3.5" />Reverse diagnostic</Button> : null}
      {!actionState.canPreview && !actionState.canApply && !actionState.canReverse && !actionState.canApplyDiagnostic && !actionState.canReverseDiagnostic ? <span className="text-xs text-muted-foreground">No actions</span> : null}
    </div>
  );
}

function ReconciliationDialog({ dialog, form, setForm, busy, error, onClose, onSubmit }) {
  if (!dialog) return null;
  const isCreate = dialog.type === 'create';
  const isApply = dialog.type === 'apply';
  const isDiagnostic = dialog.diagnostic === true;
  const title = isCreate ? 'Create audited adjustment draft' : isApply ? `${isDiagnostic ? 'Diagnostic ' : ''}Apply adjustment batch` : `${isDiagnostic ? 'Diagnostic ' : ''}Reverse adjustment batch`;
  const batch = dialog.batch;
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent title={title} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
        <form className="space-y-4" onSubmit={onSubmit}>
          {isCreate ? (
            <>
              <p className="text-sm text-muted-foreground">Create a DRAFT from an audited balance. The server validates the source identity, signed delta, and idempotent mutation before persistence.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="reconciliation-kind">Adjustment kind</Label>
                  <select id="reconciliation-kind" value={form.kind} onChange={(event) => update('kind', event.target.value)} disabled={busy} className={reconciliationInputClassName()}>
                    <option value="MANUAL_CORRECTION">Manual correction</option>
                    <option value="DAMAGE_WRITE_OFF">Damage / write-off</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="reconciliation-effective-at">Effective date</Label>
                  <input id="reconciliation-effective-at" type="date" value={form.effectiveAt} onChange={(event) => update('effectiveAt', event.target.value)} disabled={busy} required className={reconciliationInputClassName()} />
                </div>
                <div>
                  <Label htmlFor="reconciliation-source-type">Audited source type</Label>
                  <select id="reconciliation-source-type" value={form.sourceType} onChange={(event) => update('sourceType', event.target.value)} disabled={busy} className={reconciliationInputClassName()}>
                    <option value="CONING_RECEIVE">Coning receive</option>
                    <option value="PACKED_UNIT">Packed unit</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="reconciliation-source-id">Audited source ID</Label>
                  <input id="reconciliation-source-id" value={form.sourceId} onChange={(event) => update('sourceId', event.target.value)} disabled={busy} required placeholder="Exact durable source ID" className={reconciliationInputClassName()} />
                </div>
                <div>
                  <Label htmlFor="reconciliation-source-barcode">Source barcode</Label>
                  <input id="reconciliation-source-barcode" value={form.sourceBarcode} onChange={(event) => update('sourceBarcode', event.target.value)} disabled={busy} placeholder="Optional authoritative barcode" className={reconciliationInputClassName()} />
                </div>
                <div>
                  <Label htmlFor="reconciliation-audit-reference">Audit reference</Label>
                  <input id="reconciliation-audit-reference" value={form.auditReference} onChange={(event) => update('auditReference', event.target.value)} disabled={busy} className={reconciliationInputClassName()} />
                </div>
                <div>
                  <Label htmlFor="reconciliation-count-delta">Signed count delta</Label>
                  <input id="reconciliation-count-delta" type="number" step="1" value={form.countDelta} onChange={(event) => update('countDelta', event.target.value)} disabled={busy} required className={reconciliationInputClassName()} />
                </div>
                <div>
                  <Label htmlFor="reconciliation-weight-delta">Signed weight delta (kg)</Label>
                  <input id="reconciliation-weight-delta" type="number" step="0.001" value={form.weightDeltaKg} onChange={(event) => update('weightDeltaKg', event.target.value)} disabled={busy} required className={reconciliationInputClassName()} />
                </div>
              </div>
              <div>
                <Label htmlFor="reconciliation-reason">Reason <span className="text-destructive" aria-hidden="true">*</span></Label>
                <textarea id="reconciliation-reason" value={form.reason} onChange={(event) => update('reason', event.target.value)} disabled={busy} required rows={3} placeholder="Explain the audited balance correction" className={reconciliationTextareaClassName()} />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={form.confirmed} onChange={(event) => update('confirmed', event.target.checked)} disabled={busy} required className="mt-0.5 h-4 w-4 rounded border-input" />
                <span>I confirm that the source balance and signed delta were audited before creating this draft.</span>
              </label>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{isDiagnostic ? 'This visible diagnostic submission is expected to return the server state conflict and must not create a new adjustment history row.' : isApply ? 'Applying this DRAFT changes authoritative availability exactly once.' : 'Reversal is append-only and restores the applied signed delta through a linked reversal batch.'}</p>
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1"><span className="font-mono">{batch?.batchNo || batch?.id}</span><span>{batch?.status}</span><span>{formatNumber(batch?.countDelta)} pcs</span><span>{formatKg(batch?.weightDeltaKg)} kg</span></div>
                {batch?.reason ? <p className="mt-2 text-xs text-muted-foreground">Original reason: {batch.reason}</p> : null}
              </div>
              {!isApply ? (
                <div>
                  <Label htmlFor="reconciliation-reversal-reason">Reversal reason <span className="text-destructive" aria-hidden="true">*</span></Label>
                  <textarea id="reconciliation-reversal-reason" value={form.reason} onChange={(event) => update('reason', event.target.value)} disabled={busy} required rows={3} placeholder="Why is this applied adjustment being reversed?" className={reconciliationTextareaClassName()} />
                </div>
              ) : null}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={form.confirmed} onChange={(event) => update('confirmed', event.target.checked)} disabled={busy} required className="mt-0.5 h-4 w-4 rounded border-input" />
                <span>{isDiagnostic ? 'I confirm this is an intentional negative-state diagnostic submission.' : `I confirm this is the eligible ${isApply ? 'DRAFT' : 'original APPLIED'} batch and authorize the append-only mutation.`}</span>
              </label>
            </>
          )}
          {error ? <p className="text-sm text-destructive" role="alert">{error.message || String(error)}{error.code ? ` (${error.code})` : ''}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || (isCreate ? !form.confirmed : !form.confirmed)}>{busy ? 'Submitting…' : isCreate ? 'Create DRAFT' : isDiagnostic ? 'Submit diagnostic' : isApply ? 'Apply batch' : 'Reverse batch'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationPreviewDialog({ preview, busy, error, onClose }) {
  if (!preview) return null;
  const batch = preview.batch || {};
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent title={`Reconciliation preview: ${batch.batchNo || batch.id || 'batch'}`} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
        <div className="space-y-4">
          <div className={`rounded-md border p-3 text-sm ${preview.valid ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-destructive/40 bg-destructive/5 text-destructive'}`}>
            {preview.valid ? 'Preview is valid. No negative adjusted balance was detected.' : 'Preview is invalid. The server will reject the state-changing action.'}
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error.message || String(error)}{error.code ? ` (${error.code})` : ''}</p> : null}
          {preview.errors?.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">{preview.errors.map((entry, index) => <li key={`${entry.sourceId || 'source'}-${index}`}>{entry.sourceId || 'source'}: {entry.error}</li>)}</ul> : null}
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40"><tr><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-right">Before</th><th className="px-3 py-2 text-right">After</th></tr></thead>
              <tbody className="divide-y">
                {(preview.lines || []).map((line, index) => <tr key={line.id || `${line.sourceId}-${index}`}>
                  <td className="px-3 py-2 font-mono text-xs">{line.sourceBarcode || line.sourceId || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.before ? `${formatNumber(line.before.count)} pcs / ${formatKg(line.before.weight)} kg` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.after ? `${formatNumber(line.after.count)} pcs / ${formatKg(line.after.weight)} kg` : '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PackingReports() {
  const { canWrite: canPackingWrite } = usePermission('packing');
  const [activeTab, setActiveTab] = useState('production');
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [barcode, setBarcode] = useState('');
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [reconciliationDialog, setReconciliationDialog] = useState(null);
  const [reconciliationForm, setReconciliationForm] = useState(reconciliationFormDefaults);
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const [reconciliationError, setReconciliationError] = useState(null);
  const [reconciliationSuccess, setReconciliationSuccess] = useState('');
  const [reconciliationPreview, setReconciliationPreview] = useState(null);
  const [reconciliationPreviewBusy, setReconciliationPreviewBusy] = useState(false);
  const [reconciliationPreviewError, setReconciliationPreviewError] = useState(null);

  const loadReport = useCallback(async (nextFilters = filters) => {
    if (activeTab === 'history') return;
    setLoading(true);
    setError(null);
    try {
      const query = buildPackingReportQuery(nextFilters, activeTab);
      const response = activeTab === 'production'
        ? await getPackingProductionReport(query)
        : activeTab === 'stock'
          ? await getPackingStockReport(query)
          : activeTab === 'variance'
            ? await getPackingVarianceReport(query)
            : activeTab === 'exceptions'
              ? await getPackingExceptionsReport(query)
              : await getPackingReconciliationReport(query);
      setReport(response?.report || null);
    } catch (loadError) {
      setError(loadError);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [activeTab, filters]);

  useEffect(() => {
    loadReport();
  }, [activeTab]);

  const refreshReport = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextFilters = mergePackingReportFilters(filters, {
      dateFrom: formData.get('dateFrom'),
      dateTo: formData.get('dateTo'),
    });
    setFilters(nextFilters);
    loadReport(nextFilters);
  };

  const searchBarcode = async (event) => {
    event.preventDefault();
    const normalized = barcode.trim();
    if (!normalized) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await getPackingBarcodeHistory(normalized, { tree: 1 });
      setHistory(response?.history || null);
    } catch (searchError) {
      setHistoryError(searchError);
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openReconciliationCreate = () => {
    if (!canPackingWrite) return;
    setReconciliationForm(reconciliationFormDefaults());
    setReconciliationError(null);
    setReconciliationSuccess('');
    setReconciliationDialog({ type: 'create' });
  };

  const openReconciliationAction = (type, batch) => {
    if (!canPackingWrite) return;
    const actionState = getReconciliationActionState(batch, canPackingWrite);
    const diagnostic = type === 'apply' ? actionState.canApplyDiagnostic : actionState.canReverseDiagnostic;
    setReconciliationForm({ ...reconciliationFormDefaults(), reason: type === 'reverse' ? '' : batch?.reason || '', confirmed: false });
    setReconciliationError(null);
    setReconciliationSuccess('');
    setReconciliationDialog({ type, batch, diagnostic });
  };

  const previewReconciliation = async (batch) => {
    setReconciliationPreviewBusy(true);
    setReconciliationPreviewError(null);
    try {
      setReconciliationPreview(await previewReconciliationBatch(batch.id));
    } catch (previewError) {
      setReconciliationPreviewError(previewError);
      setReconciliationPreview({ batch, lines: [], valid: false, errors: [] });
    } finally {
      setReconciliationPreviewBusy(false);
    }
  };

  const closeReconciliationPreview = () => {
    if (reconciliationPreviewBusy) return;
    setReconciliationPreview(null);
    setReconciliationPreviewError(null);
  };

  const closeReconciliationDialog = () => {
    if (reconciliationBusy) return;
    setReconciliationDialog(null);
    setReconciliationError(null);
  };

  const submitReconciliation = async (event) => {
    event.preventDefault();
    if (!reconciliationDialog || !canPackingWrite || reconciliationBusy) return;
    const { type, batch } = reconciliationDialog;
    setReconciliationBusy(true);
    setReconciliationError(null);
    setReconciliationSuccess('');
    try {
      if (type === 'create') {
        await createReconciliationBatch(buildReconciliationCreatePayload(reconciliationForm));
        setReconciliationSuccess('Adjustment DRAFT created from the audited balance.');
      } else if (type === 'apply') {
        await applyReconciliationBatch(batch.id, {});
        setReconciliationSuccess('Adjustment batch applied.');
      } else {
        if (!reconciliationForm.reason.trim()) throw new Error('A reversal reason is required.');
        await reverseReconciliationBatch(batch.id, { reason: reconciliationForm.reason.trim() });
        setReconciliationSuccess('Adjustment batch reversed through an append-only reversal.');
      }
      setReconciliationDialog(null);
      await loadReport();
    } catch (mutationError) {
      setReconciliationError(mutationError);
    } finally {
      setReconciliationBusy(false);
    }
  };

  const summaryCards = useMemo(() => {
    if (!report) return [];
    if (activeTab === 'stock') {
      const summary = report.summary || {};
      const reserved = (summary.statusGroups || []).find((group) => group.status === 'RESERVED');
      return [
        { label: 'Units in view', value: formatNumber(summary.totalUnits || 0) },
        { label: 'Available', value: formatNumber((summary.statusGroups || []).find((group) => group.status === 'AVAILABLE')?.units || 0) },
        { label: 'Reserved', value: formatNumber(reserved?.units || 0), detail: reserved ? `${formatKg(reserved.netWeightKg)} net` : null },
        { label: 'Customer assignments', value: formatNumber((summary.customerGroups || []).filter((group) => group.customerId).length) },
      ];
    }
    if (activeTab === 'variance') {
      const summary = report.summary || {};
      const counts = summary.severityCounts || {};
      return [
        { label: 'Sealing events', value: formatNumber(summary.totalEvents || 0) },
        { label: 'Normal', value: formatNumber(counts.NORMAL || 0) },
        { label: 'Warnings', value: formatNumber(counts.WARNING || 0) },
        { label: 'Approval required', value: formatNumber(counts.APPROVAL_REQUIRED || 0) },
      ];
    }
    if (activeTab === 'exceptions') {
      const summary = report.summary || {};
      return [
        { label: 'Events in view', value: formatNumber(summary.totalRows || 0) },
        { label: 'Packing events', value: formatNumber(summary.sourceCounts?.PACKING || 0) },
        { label: 'Dispatch events', value: formatNumber(summary.sourceCounts?.DISPATCH || 0) },
        { label: 'Event types', value: formatNumber(Object.keys(summary.typeCounts || {}).length) },
      ];
    }
    if (activeTab === 'reconciliation') {
      const summary = report.summary || {};
      return [
        { label: 'Adjustment batches', value: formatNumber(summary.batchCount || 0) },
        { label: 'Count delta', value: formatNumber(summary.countDelta || 0) },
        { label: 'Weight delta', value: `${formatKg(summary.weightDeltaKg || 0)}` },
        { label: 'Launch state', value: report.launchState?.status || '—' },
      ];
    }
    const rows = report.rows || [];
    return [
      { label: 'Batches in view', value: formatNumber(rows.length) },
      { label: 'Produced base count', value: formatNumber(rows.reduce((sum, row) => sum + Number(row.actualBaseCount || 0), 0)) },
      { label: 'Produced net weight', value: formatKg(rows.reduce((sum, row) => sum + Number(row.actualNetWeightKg || 0), 0)) },
      { label: 'Quality holds', value: formatNumber(rows.reduce((sum, row) => sum + Number(row.qualityHoldCount || 0), 0)) },
    ];
  }, [activeTab, report]);

  const renderRows = () => {
    const rows = report?.rows || [];
    if (activeTab === 'production') {
      return <ReportTable rowKey={(row) => row.id} rows={rows} columns={[
        { key: 'batchNo', label: 'Batch', mono: true },
        { key: 'recipe', label: 'Recipe', render: (row) => row.recipe ? `${row.recipe.familyKey} v${row.recipe.version}` : '—' },
        { key: 'customerName', label: 'Customer' },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
        { key: 'plannedBaseCount', label: 'Planned pcs', numeric: true, render: (row) => formatNumber(row.plannedBaseCount) },
        { key: 'actualBaseCount', label: 'Actual pcs', numeric: true, render: (row) => formatNumber(row.actualBaseCount) },
        { key: 'actualNetWeightKg', label: 'Net kg', numeric: true, render: (row) => formatKg(row.actualNetWeightKg) },
      { key: 'variancePercent', label: 'Variance', numeric: true, render: (row) => row.variancePercent === null ? '—' : `${formatNumber(row.variancePercent, { minimumFractionDigits: 3 })}%` },
      ]} />;
    }
    if (activeTab === 'stock') {
      return <ReportTable rowKey={(row) => row.id} rows={rows} columns={[
        { key: 'barcode', label: 'Barcode', mono: true },
        { key: 'packageTypeName', label: 'Package', render: (row) => row.packageTypeName || row.packageKind || '—' },
        { key: 'itemName', label: 'Item' },
        { key: 'customerName', label: 'Customer' },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
        { key: 'baseCount', label: 'Base pcs', numeric: true, render: (row) => formatNumber(row.baseCount) },
        { key: 'netWeightKg', label: 'Net kg', numeric: true, render: (row) => formatKg(row.netWeightKg) },
      ]} />;
    }
    if (activeTab === 'variance') {
      return <ReportTable rowKey={(row) => row.id} rows={rows} columns={[
        { key: 'createdAt', label: 'Sealed', render: (row) => formatDate(row.createdAt) },
        { key: 'batchNo', label: 'Batch', mono: true },
        { key: 'barcode', label: 'Barcode', mono: true },
        { key: 'severity', label: 'Severity', render: (row) => statusBadge(row.severity) },
        { key: 'plannedNetWeightKg', label: 'Planned kg', numeric: true, render: (row) => formatKg(row.plannedNetWeightKg) },
        { key: 'actualNetWeightKg', label: 'Actual kg', numeric: true, render: (row) => formatKg(row.actualNetWeightKg) },
        { key: 'variancePercent', label: 'Variance', numeric: true, render: (row) => row.variancePercent === null ? '—' : `${formatNumber(row.variancePercent, { minimumFractionDigits: 3 })}%` },
      ]} />;
    }
    if (activeTab === 'exceptions') {
      return <ReportTable rowKey={(row) => `${row.source}-${row.id}`} rows={rows} columns={[
        { key: 'createdAt', label: 'Date', render: (row) => formatDate(row.createdAt) },
        { key: 'source', label: 'Source', render: (row) => statusBadge(row.source) },
        { key: 'type', label: 'Event', mono: true },
        { key: 'barcode', label: 'Barcode', mono: true },
        { key: 'batchNo', label: 'Batch' },
        { key: 'challanNo', label: 'Challan', mono: true },
        { key: 'reason', label: 'Reason' },
      ]} />;
    }
    return <ReportTable rowKey={(row) => row.id} rows={rows} columns={[
      { key: 'effectiveAt', label: 'Effective', render: (row) => formatDate(row.effectiveAt) },
      { key: 'batchNo', label: 'Adjustment', mono: true },
      { key: 'kind', label: 'Kind', render: (row) => statusBadge(row.kind) },
      { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      { key: 'lineCount', label: 'Lines', numeric: true, render: (row) => formatNumber(row.lineCount) },
      { key: 'countDelta', label: 'Count Δ', numeric: true, render: (row) => formatNumber(row.countDelta) },
      { key: 'weightDeltaKg', label: 'Weight Δ', numeric: true, render: (row) => formatKg(row.weightDeltaKg) },
      { key: 'actions', label: 'Actions', render: (row) => <ReconciliationRowActions row={row} canWrite={canPackingWrite} busy={reconciliationBusy || reconciliationPreviewBusy} onApply={(batch) => openReconciliationAction('apply', batch)} onReverse={(batch) => openReconciliationAction('reverse', batch)} onPreview={previewReconciliation} /> },
    ]} />;
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><PackageCheck className="w-5 h-5" /> Packing Reports</h2>
          <p className="text-sm text-muted-foreground">Operational production, stock, exception, reconciliation, and barcode lineage reporting.</p>
        </div>
        {activeTab !== 'history' ? (
          <form onSubmit={refreshReport} className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">From<input name="dateFrom" type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => mergePackingReportFilters(current, { dateFrom: event.target.value }))} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" /></label>
            <label className="text-xs text-muted-foreground">To<input name="dateTo" type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => mergePackingReportFilters(current, { dateTo: event.target.value }))} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" /></label>
            {activeTab === 'reconciliation' && canPackingWrite ? <Button type="button" variant="outline" size="sm" onClick={openReconciliationCreate} disabled={reconciliationBusy} className="h-9"><Plus className="mr-1.5 h-3.5 w-3.5" />Create adjustment</Button> : null}
            <Button type="submit" variant="outline" size="sm" disabled={loading} className="h-9"><RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />Refresh</Button>
          </form>
        ) : null}
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={cn('flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors', activeTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}><Icon className="h-3.5 w-3.5" />{tab.label}</button>;
        })}
      </div>

      {activeTab === 'history' ? (
        <div className="space-y-4">
          <Card><CardContent className="p-4"><form onSubmit={searchBarcode} className="flex flex-col gap-2 sm:flex-row"><Input value={barcode} onChange={(event) => setBarcode(event.target.value.toUpperCase())} placeholder="Scan or enter a barcode" className="font-mono" /><Button type="submit" disabled={!barcode.trim() || historyLoading}><Search className="mr-1.5 h-4 w-4" />{historyLoading ? 'Searching…' : 'Trace barcode'}</Button></form></CardContent></Card>
          {historyError ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{historyError.message}</div> : null}
          {history?.found ? <Card><CardContent className="p-4"><BarcodeTreeView tree={history.tree} stats={history.stats} searchedBarcode={history.resolvedBarcode || history.barcode} /></CardContent></Card> : history && !history.found ? <Card><CardContent className="p-4"><EmptyState message={`No lineage found for ${history.barcode}.`} /></CardContent></Card> : null}
        </div>
      ) : (
        <>
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error.message}</div> : null}
          {activeTab === 'reconciliation' && !canPackingWrite ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Packing WRITE permission is required to create, apply, or reverse reconciliation batches. Eligible mutation controls are hidden for this read-only session.</div> : null}
          {activeTab === 'reconciliation' && reconciliationSuccess ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{reconciliationSuccess}</div> : null}
          {summaryCards.length ? <ReportSummary cards={summaryCards} /> : null}
          <Card><CardContent className="p-0">{loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading report…</div> : renderRows()}</CardContent></Card>
        </>
      )}
      <ReconciliationDialog dialog={reconciliationDialog} form={reconciliationForm} setForm={setReconciliationForm} busy={reconciliationBusy} error={reconciliationError} onClose={closeReconciliationDialog} onSubmit={submitReconciliation} />
      <ReconciliationPreviewDialog preview={reconciliationPreview} busy={reconciliationPreviewBusy} error={reconciliationPreviewError} onClose={closeReconciliationPreview} />
    </div>
  );
}

export default PackingReports;
