import React from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, FileText, Loader2, Printer, RotateCcw, Undo2, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../ui';
import { formatDateDDMMYYYY, formatKg } from '../../utils';
import { canReverseDispatchEvent, canShowChallanMutationActions, isReversalEvent } from './dispatchEventActions';

function statusVariant(status) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'VOIDED') return 'destructive';
  if (status === 'RETURNED' || status === 'PARTIALLY_RETURNED') return 'warning';
  return 'secondary';
}

function lineLabel(line) {
  const snapshot = line.sourceDisplaySnapshot || {};
  return line.sourceBarcode || line.barcode || snapshot.barcode || snapshot.stageBarcode || line.sourceId || 'Dispatch line';
}

function sourceDisplaySnapshot(line) {
  return line.sourceDisplaySnapshot || {};
}

function displaySnapshotValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return value.name || value.label || value.kind || value.id || '';
  return String(value);
}

function SnapshotDetails({ snapshot, title = 'Source details', compact = false }) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const fields = [
    ['Item', snapshot.itemName || snapshot.item?.name],
    ['Lot', snapshot.lotLabel || snapshot.lotNo || snapshot.lot],
    ['Process', snapshot.process || snapshot.processType || snapshot.stage || snapshot.sourceType],
    ['Piece', snapshot.pieceId],
    ['Cut', snapshot.cutName || snapshot.cut],
    ['Yarn', snapshot.yarnName || snapshot.yarn],
    ['Twist', snapshot.twistName || snapshot.twist],
    ['Type', snapshot.typeName || snapshot.rollTypeName || snapshot.coneTypeName || snapshot.packageKind],
    ['Machine', snapshot.machineName || snapshot.machineNo],
    ['Source ref', snapshot.sourceReference || snapshot.sourceId || snapshot.stageItemId],
    ['Notes', snapshot.notes || snapshot.sourceNotes],
  ].map(([label, value]) => [label, displaySnapshotValue(value)]).filter(([, value]) => value);
  if (!fields.length) return null;
  return (
    <div className={`rounded-md border bg-background/60 p-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <p className="mb-2 font-semibold text-muted-foreground">{title}</p>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {fields.map(([label, value]) => <div key={`${label}-${value}`}><span className="text-muted-foreground">{label}: </span><span>{value}</span></div>)}
      </div>
    </div>
  );
}

export function ChallanDetail({
  challan,
  loading = false,
  canWrite = false,
  onBack,
  onPreview,
  onPrint,
  onDownload,
  onVoid,
  onCorrect,
  onReturn,
  onReverse,
}) {
  const [expandedLine, setExpandedLine] = React.useState(null);
  if (loading) {
    return <Card><CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading challan details…</CardContent></Card>;
  }
  if (!challan) return null;
  const lines = challan.lines || challan.items || [];
  const events = Array.isArray(challan.events) ? challan.events : [];
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-2"><ArrowLeft className="mr-1 h-4 w-4" /> Back to history</Button>
          <CardTitle className="text-xl">{challan.challanNo}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateDDMMYYYY(challan.businessDate)} · {challan.customer?.name || challan.customerName || 'No customer'}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant={statusVariant(challan.status)}>{challan.status || 'ACTIVE'}</Badge>
          <Button type="button" size="icon" variant="outline" onClick={() => onPreview(challan)} title="Preview PDF" aria-label="Preview PDF"><FileText className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="outline" onClick={() => onPrint(challan)} title="Print PDF" aria-label="Print PDF"><Printer className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="outline" onClick={() => onDownload(challan)} title="Download PDF" aria-label="Download PDF"><Download className="h-4 w-4" /></Button>
          {canShowChallanMutationActions(challan, { canWrite }) && <Button type="button" size="icon" variant="outline" onClick={() => onVoid(challan)} title="Void challan" aria-label="Void challan"><XCircle className="h-4 w-4 text-destructive" /></Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {challan.notes && <div className="rounded-lg border bg-muted/20 p-3 text-sm"><strong>Notes:</strong> {challan.notes}</div>}
        <div className="space-y-2">
          {lines.map((line, index) => {
            const lineId = line.id || `${index}`;
            const expanded = expandedLine === lineId;
            const snapshot = sourceDisplaySnapshot(line);
            const children = line.children || line.childUnits || snapshot.children || (snapshot.child ? [snapshot.child] : []);
            const parentSnapshot = snapshot.parent || snapshot.parentSnapshot || line.parentPackedUnit || (line.parentPackedUnitId ? { id: line.parentPackedUnitId } : null);
            const itemName = line.itemName || snapshot.itemName || snapshot.item?.name || '—';
            const packageKind = line.packageKind || snapshot.packageKind || snapshot.packageType?.kind || '—';
            const processName = snapshot.process || snapshot.processType || snapshot.stage || line.sourceType || '—';
            return (
              <div key={lineId} className="rounded-lg border p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={() => setExpandedLine(expanded ? null : lineId)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      {children.length > 0 ? (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
                      <span className="font-mono text-sm font-semibold">{lineLabel(line)}</span>
                      <Badge variant="outline">{line.sourceType || 'PACKED'}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{itemName} · {packageKind} · {processName} · count {line.baseCount ?? '—'} · net {line.netWeightKg == null ? '—' : formatKg(line.netWeightKg)} kg</p>
                  </button>
                  {canShowChallanMutationActions(challan, { canWrite, line }) && (
                    <div className="flex gap-1">
                      {(line.sourceType !== 'PACKED' || challan.status === 'RETURNED') && <Button type="button" size="sm" variant="outline" onClick={() => onCorrect(line)}>Correct</Button>}
                      <Button type="button" size="sm" variant="outline" onClick={() => onReturn(line)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Return</Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  <SnapshotDetails snapshot={snapshot} />
                  {parentSnapshot && <SnapshotDetails snapshot={parentSnapshot} title="Parent snapshot" compact />}
                </div>
                {expanded && children.length > 0 && <div className="mt-3 space-y-2 border-l-2 pl-4"><p className="text-xs font-semibold text-muted-foreground">Child snapshot details</p>{children.map((child, childIndex) => <div key={child.id || child.barcode || childIndex} className="space-y-1"><p className="font-mono text-xs">{child.barcode || child.sourceBarcode || child.id || 'Child unit'} · {child.baseCount ?? '—'} base count · {child.netWeightKg == null ? '—' : formatKg(child.netWeightKg)} kg</p><SnapshotDetails snapshot={child} compact /></div>)}</div>}
              </div>
            );
          })}
        </div>
        {events.length > 0 ? (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div><p className="text-sm font-semibold">Append-only event history</p><p className="mt-1 text-xs text-muted-foreground">Eligible legacy events can be reversed once with a required reason. Packed transitions remain append-only.</p></div>
            <div className="space-y-2">
              {events.map((event) => {
                const reversible = canWrite && typeof onReverse === 'function' && !challan.isLegacyReconstruction && canReverseDispatchEvent(event, lines, events);
                return (
                  <div key={event.id || `${event.type}-${event.createdAt}`} className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><p className="font-mono text-xs font-semibold">{event.type || 'Dispatch event'}</p><p className="mt-1 text-xs text-muted-foreground">{event.reason || 'No reason recorded'}{event.createdAt ? ` · ${formatDateDDMMYYYY(event.createdAt)}` : ''}{isReversalEvent(event) ? ' · reversal' : ''}</p></div>
                    {reversible ? <Button type="button" size="sm" variant="outline" onClick={() => onReverse(event)}><Undo2 className="mr-1 h-3.5 w-3.5" />Reverse</Button> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ChallanDetail;
