import React from 'react';
import { Card, Button, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../../ui';
import { TableStateRow, ListState } from '../../data-table';
import { ChevronDown, ChevronRight, AlertTriangle, Loader2, RotateCcw } from 'lucide-react';

/**
 * One collapsible process section of the Combined Stock summary mode.
 *
 * Purely presentational: the caller passes rows that were already filtered by the
 * owning view's own selectors, plus the headline totals it computed from the same
 * fields the view's grand-total row sums. Nothing here does stock math.
 */
export function CombinedSummarySection({
  label,
  totals = [],
  columns = [],
  rows = [],
  getRowKey = null,
  renderMobileRow = null,
  isLoading = false,
  summaryLoading = false,
  summaryError = null,
  isLoadingMore = false,
  hasMore = false,
  error = null,
  onRetry = null,
  onLoadMore = null,
  emptyMessage = 'No stock found.',
  expanded = false,
  onToggle,
}) {
  const rowKeyFor = (row, idx) => (getRowKey ? (getRowKey(row) || idx) : idx);
  const loaded = !summaryLoading && !summaryError;

  const statusSlot = summaryLoading ? (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" />
      Calculating totals…
    </span>
  ) : summaryError ? (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <AlertTriangle className="w-4 h-4" />
        Totals unavailable
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </span>
  ) : null;

  return (
    <Card className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="p-4 cursor-pointer hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(); }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            {expanded
              ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 self-center" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 self-center" />}
            <span className="font-semibold whitespace-nowrap">{label}</span>
            {loaded && rows.length > 0 && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {rows.length} {rows.length === 1 ? 'lot' : 'lots'}
              </span>
            )}
          </div>
          {statusSlot ? (
            <div className="ml-auto">{statusSlot}</div>
          ) : (
            <div className="hidden sm:flex items-stretch divide-x divide-border ml-auto">
              {totals.map((t) => (
                <div key={t.label} className="px-5 first:pl-0 last:pr-0 text-right">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">{t.label}</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{t.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {!statusSlot && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
            {totals.map((t) => (
              <div key={t.label} className="rounded-md bg-muted/40 px-2.5 py-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate">{t.label}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{t.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <>
          <div className="hidden sm:block border-t overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.header}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableStateRow
                    colSpan={columns.length}
                    isLoading={isLoading}
                    error={error}
                    onRetry={onRetry}
                    emptyMessage={emptyMessage}
                  />
                ) : (
                  rows.map((row, idx) => (
                    <TableRow key={rowKeyFor(row, idx)}>
                      {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.cell(row)}</TableCell>)}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View for the section rows */}
          <div className="block sm:hidden border-t p-3 space-y-3">
            {rows.length === 0 ? (
              <ListState
                isLoading={isLoading}
                error={error}
                onRetry={onRetry}
                emptyMessage={emptyMessage}
                className="border rounded-lg bg-card"
              />
            ) : (
              rows.map((row, idx) => (
                <div key={rowKeyFor(row, idx)} className="border rounded-lg bg-card shadow-sm p-3 text-sm">
                  {renderMobileRow ? renderMobileRow(row) : null}
                </div>
              ))
            )}
          </div>
          {hasMore && (
            <div className="border-t p-3 flex justify-center">
              <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load more lots'}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
