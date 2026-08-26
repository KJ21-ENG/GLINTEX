import React from 'react';
import { ChevronRight, Download, FileText, Loader2, Printer, Search, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input } from '../ui';
import { formatDateDDMMYYYY, formatKg } from '../../utils';
import { getChallanHistorySummary } from './dispatchHistorySummary';

function statusVariant(status) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'VOIDED') return 'destructive';
  if (status === 'RETURNED' || status === 'PARTIALLY_RETURNED') return 'warning';
  return 'secondary';
}

export function ChallanHistory({
  challans = [],
  filters,
  onFiltersChange,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onOpen,
  onVoid,
  onPreview,
  onPrint,
  onDownload,
  onExport,
  exporting = false,
  selectedIds = new Set(),
  onToggleSelect,
  onPreviewSelected,
  onPrintSelected,
  canWrite = false,
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold">Dispatch challan history</p>
            <p className="mt-1 text-xs text-muted-foreground">Headers are paginated; details and documents load only when opened.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={filters.search || ''} onChange={(event) => onFiltersChange({ search: event.target.value })} placeholder="Search challan/customer" className="pl-9" aria-label="Search challan history" />
            </div>
            <Input type="date" value={filters.from || ''} onChange={(event) => onFiltersChange({ from: event.target.value })} aria-label="History from date" />
            <Input type="date" value={filters.to || ''} onChange={(event) => onFiltersChange({ to: event.target.value })} aria-label="History to date" />
            {onExport && <Button type="button" variant="outline" onClick={onExport} disabled={exporting}>{exporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Download className="mr-1 h-4 w-4" /> Export</Button>}
          </div>
        </div>
        {selectedIds.size > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm"><span className="mr-1 text-muted-foreground">{selectedIds.size} selected</span>{onPreviewSelected && <Button type="button" size="sm" variant="outline" onClick={onPreviewSelected}><FileText className="mr-1 h-4 w-4" /> Preview selected</Button>}{onPrintSelected && <Button type="button" size="sm" variant="outline" onClick={onPrintSelected}><Printer className="mr-1 h-4 w-4" /> Print selected</Button>}</div>}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading challans…</div>
        ) : challans.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">No Dispatch V2 challans match these filters.</div>
        ) : (
          <div className="space-y-2">
            {challans.map((challan) => {
              const { lineCount, totalWeight } = getChallanHistorySummary(challan);
              return (
                <div key={challan.id || challan.challanNo} className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center lg:justify-between">
                  {onToggleSelect && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={selectedIds.has(challan.id)} onChange={() => onToggleSelect(challan)} aria-label={`Select ${challan.challanNo}`} /> Select</label>}
                  <button type="button" onClick={() => onOpen(challan)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{challan.challanNo}</span>
                      <Badge variant={statusVariant(challan.status)}>{challan.status || 'ACTIVE'}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDateDDMMYYYY(challan.businessDate)} · {challan.customer?.name || challan.customerName || 'No customer'} · {lineCount} line{lineCount === 1 ? '' : 's'} · {formatKg(totalWeight)} kg</p>
                  </button>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpen(challan)}><ChevronRight className="mr-1 h-4 w-4" /> Details</Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => onPreview(challan)} title="Preview authoritative document" aria-label={`Preview ${challan.challanNo}`}><FileText className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => onPrint(challan)} title="Print authoritative document" aria-label={`Print ${challan.challanNo}`}><Printer className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => onDownload(challan)} title="Download authoritative PDF" aria-label={`Download ${challan.challanNo}`}><Download className="h-4 w-4" /></Button>
                    {canWrite && challan.status === 'ACTIVE' && <Button type="button" size="icon" variant="ghost" onClick={() => onVoid(challan)} title="Void challan" aria-label={`Void ${challan.challanNo}`}><XCircle className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                </div>
              );
            })}
            {hasMore && <Button type="button" variant="outline" onClick={onLoadMore} disabled={loadingMore} className="w-full">{loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {loadingMore ? 'Loading more…' : 'Load more challans'}</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ChallanHistory;
