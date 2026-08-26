import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Printer, ScanLine, Search, Truck } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input } from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { Label } from '../components/ui';
import AccessDenied from '../components/common/AccessDenied';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import useDispatchV2Controller from '../components/dispatchV2/useDispatchV2Controller';
import SourceSelector from '../components/dispatchV2/SourceSelector';
import ScanQueue from '../components/dispatchV2/ScanQueue';
import DispatchDraft from '../components/dispatchV2/DispatchDraft';
import ChallanHistory from '../components/dispatchV2/ChallanHistory';
import ChallanDetail from '../components/dispatchV2/ChallanDetail';
import {
  buildDispatchDocumentHtml,
  downloadDispatchPdfBlob,
  openDispatchDocumentPreview,
  openDispatchPdfBlob,
  printDispatchDocuments,
} from '../utils/dispatchDocumentPreview';

function hasCompleteRenderingSnapshot(document) {
  const snapshot = document?.renderingSnapshot;
  if (!snapshot || typeof snapshot !== 'object') return false;
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const hasChallanNumber = Boolean(snapshot.challanNo || document.challanNo);
  const hasCustomer = Boolean(snapshot.customer || snapshot.customerSnapshot || snapshot.customerId || snapshot.customerName);
  const hasCompleteLines = lines.length > 0 && lines.every((line) => {
    if (!line || typeof line !== 'object') return false;
    const hasIdentity = Boolean(line.sourceId || line.sourceBarcode || line.stageItemId || line.stageBarcode || line.barcode);
    const hasWeight = line.netWeightKg !== undefined || line.weight !== undefined;
    return hasIdentity && hasWeight;
  });
  return hasChallanNumber && hasCustomer && hasCompleteLines;
}

function getDocumentDto(challan) {
  const document = challan?.document || challan?.dispatchDocument;
  return hasCompleteRenderingSnapshot(document) ? document : challan;
}

export function DispatchV2() {
  const { user } = useAuth();
  const dispatchPermission = usePermission('dispatch');
  const canRead = Boolean(user?.isAdmin || dispatchPermission.canRead);
  const canWrite = Boolean(user?.isAdmin || dispatchPermission.canWrite);
  const controller = useDispatchV2Controller({ enabled: canRead });
  const [activeTab, setActiveTab] = useState('dispatch');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [selectedChallanIds, setSelectedChallanIds] = useState(() => new Set());
  const [lineAction, setLineAction] = useState(null);
  const [lineActionSubmitting, setLineActionSubmitting] = useState(false);
  const [lineActionError, setLineActionError] = useState(null);
  const [challanAction, setChallanAction] = useState(null);
  const [challanActionSubmitting, setChallanActionSubmitting] = useState(false);
  const [challanActionError, setChallanActionError] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const documentFrameRef = useRef(null);

  useEffect(() => {
    if (!documentPreview?.autoPrint) return undefined;
    const timer = window.setTimeout(() => documentFrameRef.current?.contentWindow?.print(), 150);
    return () => window.clearTimeout(timer);
  }, [documentPreview]);

  const runAction = useCallback(async (callback) => {
    setPageError(null);
    try {
      return await callback();
    } catch (error) {
      setPageError(error);
      return null;
    }
  }, []);

  const handleBarcode = useCallback(async (value) => {
    await runAction(async () => {
      await controller.scanBarcode(value);
      controller.setScanInput('');
    });
  }, [controller, runAction]);

  const handleAddSource = useCallback((source) => {
    runAction(async () => controller.addSourceToQueue(source));
  }, [controller, runAction]);

  const handleCreate = useCallback(() => {
    runAction(async () => {
      const challan = await controller.createChallan();
      if (challan?.challanNo) window.alert(`Dispatch challan ${challan.challanNo} created.`);
    });
  }, [controller, runAction]);

  const loadDetail = useCallback(async (challan) => {
    await runAction(async () => controller.openChallan(challan));
  }, [controller, runAction]);

  const getPdf = useCallback(async (challan) => {
    const id = challan?.id || challan?.challanId;
    if (!id) throw new Error('This challan has no server identity');
    setDocumentLoading(id);
    try {
      return await controller.api.getDispatchChallanPdf(id);
    } finally {
      setDocumentLoading(null);
    }
  }, [controller.api]);

  const handlePreview = useCallback((challan) => {
    runAction(async () => {
      const detail = challan?.lines?.length ? challan : await controller.openChallan(challan);
      try {
        const pdf = await getPdf(detail);
        openDispatchPdfBlob(pdf.blob, { title: `Dispatch ${detail.challanNo}` });
      } catch (error) {
        // A DTO preview keeps the browser workflow useful when a legacy reconstruction
        // is still waiting for its first server-side PDF generation.
        openDispatchDocumentPreview([getDocumentDto(detail)], { title: `Dispatch ${detail.challanNo}` });
      }
    });
  }, [controller, getPdf, runAction]);

  const handlePrint = useCallback((challan) => {
    runAction(async () => {
      const detail = challan?.lines?.length ? challan : await controller.openChallan(challan);
      try {
        const pdf = await getPdf(detail);
        openDispatchPdfBlob(pdf.blob, { title: `Dispatch ${detail.challanNo}`, autoPrint: true });
      } catch (error) {
        printDispatchDocuments([getDocumentDto(detail)], { title: `Dispatch ${detail.challanNo}` });
      }
    });
  }, [controller, getPdf, runAction]);

  const handleDownload = useCallback((challan) => {
    runAction(async () => {
      const detail = challan?.lines?.length ? challan : await controller.openChallan(challan);
      const pdf = await getPdf(detail);
      downloadDispatchPdfBlob(pdf.blob, pdf.filename || `dispatch-${detail.challanNo || detail.id}.pdf`);
    });
  }, [controller, getPdf, runAction]);

  const handleVoid = useCallback((challan) => {
    setChallanActionError(null);
    setChallanAction({ type: 'void', challan, reason: '' });
  }, []);

  const handleReverse = useCallback((event) => {
    setChallanActionError(null);
    setChallanAction({ type: 'reverse', event, reason: '' });
  }, []);

  const updateChallanActionReason = useCallback((reason) => {
    setChallanAction((previous) => previous ? { ...previous, reason } : previous);
  }, []);

  const submitChallanAction = useCallback(async () => {
    if (!challanAction) return;
    const reason = String(challanAction.reason || '').trim();
    if (!reason) {
      setChallanActionError(new Error('A reason is required for this action'));
      return;
    }
    setChallanActionError(null);
    setChallanActionSubmitting(true);
    try {
      if (challanAction.type === 'void') {
        await controller.voidChallan(challanAction.challan.id, reason);
      } else {
        await controller.reverseEvent(challanAction.event.id, { reason });
      }
      setChallanAction(null);
    } catch (error) {
      setChallanActionError(error);
      setPageError(error);
    } finally {
      setChallanActionSubmitting(false);
    }
  }, [challanAction, controller]);

  const handleCorrect = useCallback((line) => {
    setLineActionError(null);
    setLineAction({
      type: 'correct',
      line,
      form: {
        baseCount: line.baseCount ?? '',
        netWeightKg: line.netWeightKg ?? '',
        reason: '',
      },
    });
  }, []);

  const handleReturn = useCallback((line) => {
    setLineActionError(null);
    setLineAction({
      type: 'return',
      line,
      form: {
        opened: false,
        physicallyChanged: false,
        reason: '',
      },
    });
  }, []);

  const updateLineActionForm = useCallback((patch) => {
    setLineAction((previous) => previous ? ({ ...previous, form: { ...previous.form, ...patch } }) : previous);
  }, []);

  const submitLineAction = useCallback(async () => {
    if (!lineAction?.line?.id) return;
    const form = lineAction.form || {};
    const reason = String(form.reason || '').trim();
    if (!reason) {
      setLineActionError(new Error('A reason is required for this action'));
      return;
    }
    setLineActionError(null);
    setLineActionSubmitting(true);
    try {
      if (lineAction.type === 'correct') {
        const correctedCount = Number(form.baseCount);
        const correctedWeight = Number(form.netWeightKg);
        if (!Number.isInteger(correctedCount) || correctedCount < 0) {
          throw new Error('Corrected base count must be a whole number');
        }
        if (!Number.isFinite(correctedWeight) || correctedWeight <= 0) {
          throw new Error('Corrected net weight must be a positive number');
        }
        await controller.correctLine(lineAction.line.id, {
          baseCount: correctedCount,
          netWeightKg: correctedWeight,
          reason,
        });
      } else {
        const opened = Boolean(form.opened);
        const physicallyChanged = Boolean(form.physicallyChanged);
        const condition = opened && physicallyChanged
          ? 'OPENED_AND_PHYSICALLY_CHANGED'
          : opened
            ? 'OPENED'
            : physicallyChanged
              ? 'PHYSICALLY_CHANGED'
              : 'SEALED_UNCHANGED';
        await controller.returnLine(lineAction.line.id, {
          reason,
          opened,
          physicallyChanged,
          condition,
        });
      }
      setLineAction(null);
    } catch (error) {
      setLineActionError(error);
      setPageError(error);
    } finally {
      setLineActionSubmitting(false);
    }
  }, [controller, lineAction]);

  const handleExport = useCallback(() => {
    runAction(async () => {
      setExporting(true);
      try {
        const exportFile = await controller.exportHistory();
        downloadDispatchPdfBlob(exportFile.blob, exportFile.filename || 'dispatch-v2-export');
      } finally {
        setExporting(false);
      }
    });
  }, [controller, runAction]);

  const toggleChallanSelection = useCallback((challan) => {
    if (!challan?.id) return;
    setSelectedChallanIds((previous) => {
      const next = new Set(previous);
      if (next.has(challan.id)) next.delete(challan.id);
      else next.add(challan.id);
      return next;
    });
  }, []);

  const getSelectedChallanDocuments = useCallback(async () => {
    const selected = controller.challans.filter((challan) => selectedChallanIds.has(challan.id));
    const documents = [];
    for (const challan of selected) {
      const response = challan.lines?.length
        ? challan
        : await controller.api.getDispatchChallan(challan.id);
      const detail = response?.challan || response?.data || response;
      documents.push(getDocumentDto(detail));
    }
    return documents;
  }, [controller, selectedChallanIds]);

  const handlePreviewSelected = useCallback(() => {
    runAction(async () => {
      const documents = await getSelectedChallanDocuments();
      if (!documents.length) throw new Error('Select at least one challan to preview');
      setDocumentPreview({ documents, autoPrint: false });
    });
  }, [getSelectedChallanDocuments, runAction]);

  const handlePrintSelected = useCallback(() => {
    runAction(async () => {
      const documents = await getSelectedChallanDocuments();
      if (!documents.length) throw new Error('Select at least one challan to print');
      setDocumentPreview({ documents, autoPrint: true });
    });
  }, [getSelectedChallanDocuments, runAction]);

  if (!canRead) {
    return <AccessDenied title="Dispatch V2 unavailable" message="Dispatch read access is required to view source availability and challan history." />;
  }

  const combinedError = pageError || controller.sourceError || controller.scanError || controller.mutationError || controller.historyError;
  const activeChallan = controller.selectedChallan;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Truck className="h-6 w-6 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">Dispatch V2</h1><Badge variant="secondary">Responsive workflow</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">One source queue, one customer lock, one authoritative challan and document path across desktop and mobile.</p>
        </div>
        <div className="flex rounded-md border p-1"><Button type="button" size="sm" variant={activeTab === 'dispatch' ? 'secondary' : 'ghost'} onClick={() => { setActiveTab('dispatch'); controller.setSelectedChallan(null); setSelectedChallanIds(new Set()); }}>Create dispatch</Button><Button type="button" size="sm" variant={activeTab === 'history' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('history')}>Challan history</Button></div>
      </div>

      {combinedError && <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{combinedError.message || 'Dispatch V2 request failed'}</span></div>}

      {activeTab === 'dispatch' ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Exact barcode lookup</p><p className="mt-1 text-xs text-muted-foreground">Lookup is server-authoritative and never scans a browser-downloaded array.</p></div><Button type="button" variant={scannerOpen ? 'secondary' : 'outline'} onClick={() => setScannerOpen((open) => !open)}><ScanLine className="mr-2 h-4 w-4" /> {scannerOpen ? 'Close scanner' : 'Open scanner'}</Button></div>
              <form onSubmit={(event) => { event.preventDefault(); handleBarcode(controller.scanInput); }} className="flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={controller.scanInput} onChange={(event) => controller.setScanInput(event.target.value)} placeholder="Enter or scan PKU-/legacy barcode" className="pl-9" aria-label="Dispatch barcode" /></div><Button type="submit" disabled={controller.scanningBarcode || !controller.scanInput.trim()}>{controller.scanningBarcode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Lookup barcode</Button></form>
              {scannerOpen && <div className="max-w-xl rounded-lg border p-3"><BarcodeScanner onScan={handleBarcode} onInvalidScan={(value) => setPageError(new Error(`Invalid barcode: ${value}`))} disabled={controller.scanningBarcode} /></div>}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
            <SourceSelector sourceTypes={controller.sourceTypes} selectedSourceType={controller.selectedSourceType} sourceSummary={controller.sourceSummary} onSelectSourceType={controller.selectSourceType} search={controller.sourceSearch} onSearchChange={controller.setSourceSearch} sources={controller.sources} loading={controller.sourceLoading} loadingMore={controller.sourceLoadingMore} hasMore={Boolean(controller.sourceCursor)} onLoadMore={controller.loadMoreSources} onAddSource={handleAddSource} />
            <div className="space-y-4"><ScanQueue queue={controller.scanQueue} onUpdate={controller.updateQueueItem} onRemove={controller.removeQueueItem} onClear={controller.clearQueue} disabled={!canWrite} /><DispatchDraft customers={controller.customers} draft={controller.draft} onChange={controller.updateDraft} lockedCustomerId={controller.lockedCustomerId} queueLength={controller.scanQueue.length} submitting={controller.submitting} onSubmit={handleCreate} readOnly={!canWrite} /></div>
          </div>
        </div>
      ) : activeChallan ? (
        <ChallanDetail challan={activeChallan} loading={controller.detailLoading} canWrite={canWrite} onBack={() => controller.setSelectedChallan(null)} onPreview={handlePreview} onPrint={handlePrint} onDownload={handleDownload} onVoid={handleVoid} onCorrect={handleCorrect} onReturn={handleReturn} onReverse={handleReverse} />
      ) : (
        <ChallanHistory challans={controller.challans} filters={controller.historyFilters} onFiltersChange={(patch) => controller.setHistoryFilters((previous) => ({ ...previous, ...patch }))} loading={controller.historyLoading} loadingMore={controller.historyLoadingMore} hasMore={Boolean(controller.historyCursor)} onLoadMore={controller.loadMoreHistory} onOpen={loadDetail} onVoid={handleVoid} onPreview={handlePreview} onPrint={handlePrint} onDownload={handleDownload} onExport={handleExport} exporting={exporting} selectedIds={selectedChallanIds} onToggleSelect={toggleChallanSelection} onPreviewSelected={handlePreviewSelected} onPrintSelected={handlePrintSelected} canWrite={canWrite} />
      )}

      {documentLoading && <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Preparing authoritative document…</div>}

      <Dialog open={Boolean(lineAction)} onOpenChange={(open) => { if (!open && !lineActionSubmitting) setLineAction(null); }}>
        <DialogContent title={lineAction?.type === 'correct' ? 'Correct dispatch line' : 'Inspect returned line'} onOpenChange={(open) => { if (!open && !lineActionSubmitting) setLineAction(null); }}>
          {lineAction && <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Line <span className="font-mono font-semibold text-foreground">{lineAction.line.sourceBarcode || lineAction.line.barcode || lineAction.line.sourceId}</span>. This creates an append-only correction or return event.</p>
            {lineAction.type === 'correct' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="dispatch-correction-count">Corrected base count</Label><Input id="dispatch-correction-count" type="number" min="0" step="1" value={lineAction.form.baseCount} onChange={(event) => updateLineActionForm({ baseCount: event.target.value })} disabled={lineActionSubmitting} /></div>
                <div className="space-y-2"><Label htmlFor="dispatch-correction-weight">Corrected net kg</Label><Input id="dispatch-correction-weight" type="number" min="0.001" step="0.001" value={lineAction.form.netWeightKg} onChange={(event) => updateLineActionForm({ netWeightKg: event.target.value })} disabled={lineActionSubmitting} /></div>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <p className="text-sm font-semibold">Physical return condition</p>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={Boolean(lineAction.form.opened)} onChange={(event) => updateLineActionForm({ opened: event.target.checked })} disabled={lineActionSubmitting} className="mt-1" /><span><span className="font-medium">Opened</span><span className="mt-1 block text-xs text-muted-foreground">The sealed container was opened. The backend must route it through inspection/repacking rules.</span></span></label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={Boolean(lineAction.form.physicallyChanged)} onChange={(event) => updateLineActionForm({ physicallyChanged: event.target.checked })} disabled={lineActionSubmitting} className="mt-1" /><span><span className="font-medium">Physically changed</span><span className="mt-1 block text-xs text-muted-foreground">Content, packaging, or identity changed. A Repacking batch is required instead of reactivating the old unit.</span></span></label>
                <p className="text-xs text-muted-foreground">Condition: {lineAction.form.opened && lineAction.form.physicallyChanged ? 'Opened and physically changed' : lineAction.form.opened ? 'Opened' : lineAction.form.physicallyChanged ? 'Physically changed' : 'Sealed and unchanged'}</p>
              </div>
            )}
            <div className="space-y-2"><Label htmlFor="dispatch-line-action-reason">Reason <span className="text-destructive">*</span></Label><textarea id="dispatch-line-action-reason" value={lineAction.form.reason} onChange={(event) => updateLineActionForm({ reason: event.target.value })} disabled={lineActionSubmitting} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={lineAction.type === 'correct' ? 'Explain the corrected count and weight' : 'Explain the return and inspection condition'} /></div>
            {lineActionError && <p className="text-sm text-destructive">{lineActionError.message}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setLineAction(null)} disabled={lineActionSubmitting}>Cancel</Button><Button type="button" onClick={submitLineAction} disabled={lineActionSubmitting}>{lineActionSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{lineAction.type === 'correct' ? 'Save correction' : 'Record return'}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(challanAction)} onOpenChange={(open) => { if (!open && !challanActionSubmitting) setChallanAction(null); }}>
        <DialogContent title={challanAction?.type === 'void' ? 'Void dispatch challan' : 'Reverse dispatch event'} onOpenChange={(open) => { if (!open && !challanActionSubmitting) setChallanAction(null); }}>
          {challanAction && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitChallanAction(); }}>
            <p className="text-sm text-muted-foreground">
              {challanAction.type === 'void'
                ? `Voiding ${challanAction.challan.challanNo} restores its eligible source balances and appends a void event.`
                : `Reverse ${challanAction.event.type || 'this event'} with an append-only inverse event. The server will re-check eligibility and lineage.`}
            </p>
            <div className="space-y-2"><Label htmlFor="dispatch-challan-action-reason">Reason <span className="text-destructive">*</span></Label><textarea id="dispatch-challan-action-reason" autoFocus value={challanAction.reason} onChange={(event) => updateChallanActionReason(event.target.value)} disabled={challanActionSubmitting} rows={4} required className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={challanAction.type === 'void' ? 'Why is this challan being voided?' : 'Why is this event being reversed?'} /></div>
            {challanActionError && <p className="text-sm text-destructive" role="alert">{challanActionError.message}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setChallanAction(null)} disabled={challanActionSubmitting}>Cancel</Button><Button type="submit" variant={challanAction.type === 'void' ? 'destructive' : 'default'} disabled={challanActionSubmitting}>{challanActionSubmitting ? 'Submitting…' : challanAction.type === 'void' ? 'Void challan' : 'Reverse event'}</Button></div>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(documentPreview)} onOpenChange={(open) => { if (!open) setDocumentPreview(null); }}>
        <DialogContent title="Dispatch challan documents" className="max-w-5xl" onOpenChange={(open) => { if (!open) setDocumentPreview(null); }}>
          {documentPreview && <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{documentPreview.documents.length} authoritative challan document{documentPreview.documents.length === 1 ? '' : 's'} are shown as separate printable pages.</p>
            <iframe ref={documentFrameRef} title="Dispatch challan document preview" srcDoc={buildDispatchDocumentHtml(documentPreview.documents, { title: 'Dispatch challan selection' })} onLoad={() => { if (documentPreview.autoPrint) documentFrameRef.current?.contentWindow?.print(); }} className="h-[68vh] w-full rounded-md border bg-white" />
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDocumentPreview(null)}>Close</Button><Button type="button" onClick={() => documentFrameRef.current?.contentWindow?.print()}><Printer className="mr-2 h-4 w-4" />Print documents</Button></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DispatchV2;
