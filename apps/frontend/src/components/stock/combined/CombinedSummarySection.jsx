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
  error = null,
  onRetry = null,
  emptyMessage = 'No stock found.',
  expanded = false,
  onToggle,
}) {
  const rowKeyFor = (row, idx) => (getRowKey ? (getRowKey(row) || idx) : idx);

  return (
    <Card className="overflow-hidden">
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className="font-semibold truncate">{label}</span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {isLoading ? (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </span>
          ) : error ? (
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4" />
                Failed to load
              </span>
              {onRetry && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Retry
                </Button>
              )}
            </span>
          ) : (
            totals.map((t) => (
              <div key={t.label} className="text-right">
                <div className="font-mono font-semibold tabular-nums whitespace-nowrap">{t.value}</div>
                <div className="text-[10px] uppercase text-muted-foreground">{t.label}</div>
              </div>
            ))
          )}
        </div>
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
        </>
      )}
    </Card>
  );
}
