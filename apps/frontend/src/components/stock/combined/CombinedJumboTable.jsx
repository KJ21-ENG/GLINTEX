import React, { useMemo, useState } from 'react';
import { Button, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../../ui';
import { TableStateRow, ListState } from '../../data-table';
import { formatKg, formatDateDDMMYYYY } from '../../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { countAvailablePieces } from '../stockSelectors';
import { LotRowsLoadMore } from '../LotRowsLoadMore';

/**
 * Read-only Jumbo Rolls table for the Combined Stock full-tables mode.
 *
 * The Stock page's inline jumbo table is entangled with cutter-only actions (piece
 * select, issue modal, delete), so it is not extracted. This renders the same columns
 * from the same `buildJumboLotsMap` output with no actions at all — the lots handed in
 * were already filtered by the caller with the Jumbo view's default status filter, so
 * the Pending Wt column is omitted exactly as it is there.
 */
const formatWastageSummary = (lot) => {
  const total = Number(lot?.wastageTotal || 0);
  if (total <= 0) return '—';
  const pct = Number(lot?.wastagePercent || 0);
  return `${formatKg(total)} kg (${pct.toFixed(1)}%)`;
};

export function CombinedJumboTable({
  lots = [],
  summary = null,
  summaryLoading = false,
  rowsByKey = {},
  rowPagesByKey = {},
  loadLotRows = null,
  loadMoreLotRows = null,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  error = null,
  onRetry = null,
  onLoadMore = null,
}) {
  const [expandedLot, setExpandedLot] = useState(null);
  const [loadingLot, setLoadingLot] = useState(null);
  const piecesFor = (lot) => rowsByKey?.[lot.lotKey] || lot.pieces || [];

  const loadedGrandTotals = useMemo(() => {
    return lots.reduce((acc, lot) => ({
      availableCount: acc.availableCount + (lot.availableCount ?? countAvailablePieces(lot.pieces || [])),
      totalPieces: acc.totalPieces + (lot.totalPieces ?? (lot.pieces || []).length),
      totalWeight: acc.totalWeight + Number(lot.totalWeight || 0),
      remainingWeight: acc.remainingWeight + Number(lot.remainingWeight || 0),
      wastageTotal: acc.wastageTotal + Number(lot.wastageTotal || 0),
      issuedWeightBaseTotal: acc.issuedWeightBaseTotal + Number(lot.issuedWeightBaseTotal || 0),
    }), { availableCount: 0, totalPieces: 0, totalWeight: 0, remainingWeight: 0, wastageTotal: 0, issuedWeightBaseTotal: 0 });
  }, [lots]);
  const grandTotals = summary ? { ...loadedGrandTotals, ...summary } : loadedGrandTotals;

  const grandWastageSummary = formatWastageSummary({
    wastageTotal: grandTotals.wastageTotal,
    wastagePercent: grandTotals.issuedWeightBaseTotal > 0 ? ((grandTotals.wastageTotal / grandTotals.issuedWeightBaseTotal) * 100) : 0,
  });

  const toggleExpand = async (lot) => {
    const key = lot.lotKey || lot.lotNo;
    if (expandedLot === key) {
      setExpandedLot(null);
      return;
    }
    setExpandedLot(key);
    if (lot.lotKey && !rowsByKey?.[lot.lotKey] && loadLotRows) {
      setLoadingLot(key);
      try { await loadLotRows(lot.lotKey); } finally { setLoadingLot(null); }
    }
  };

  return (
    <div className="space-y-4">
      <div className="hidden sm:block rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Lot No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Cut</TableHead>
              <TableHead>Firm</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Pieces</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Wastage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.length === 0 ? (
              <TableStateRow
                colSpan={10}
                isLoading={isLoading}
                error={error}
                onRetry={onRetry}
                emptyMessage="No lots found."
              />
            ) : (
              lots.map((l, idx) => {
                const lotIdentity = l.lotKey || l.lotNo;
                const isExpanded = expandedLot === lotIdentity;
                const pieces = piecesFor(l);
                return (
                  <React.Fragment key={lotIdentity || idx}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(l)}>
                      <TableCell>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-medium">{l.lotNo || '—'}</TableCell>
                      <TableCell>{formatDateDDMMYYYY(l.date)}</TableCell>
                      <TableCell>{l.itemName}</TableCell>
                      <TableCell>{l.cutName}</TableCell>
                      <TableCell>{l.firmName}</TableCell>
                      <TableCell>{l.supplierName}</TableCell>
                      <TableCell className="">
                        {`${l.availableCount ?? countAvailablePieces(l.pieces || [])} / ${l.totalPieces ?? (l.pieces || []).length}`}
                      </TableCell>
                      <TableCell className="">
                        {formatKg(l.remainingWeight)} / {formatKg(l.totalWeight)}
                      </TableCell>
                      <TableCell className="">{formatWastageSummary(l)}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={10} className="p-4">
                          <div className="bg-background border rounded-lg p-4 shadow-sm overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/50">
                                  <TableHead>Piece ID</TableHead>
                                  <TableHead>Barcode</TableHead>
                                  <TableHead>Seq</TableHead>
                                  <TableHead className="text-right">Weight</TableHead>
                                  <TableHead className="">Total Units</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {loadingLot === lotIdentity ? (
                                  <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Loading pieces...</TableCell></TableRow>
                                ) : pieces.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                      No pieces.
                                    </TableCell>
                                  </TableRow>
                                ) : pieces.slice().sort((a, b) => a.seq - b.seq).map(p => (
                                  <TableRow key={p.id}>
                                    <TableCell className="font-mono text-xs">
                                      <div className="flex flex-col">
                                        <span>{p.id}</span>
                                        {p.issuedLabel ? (
                                          <span className="text-[10px] text-muted-foreground">({p.issuedLabel})</span>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{p.barcode || '—'}</TableCell>
                                    <TableCell className="text-sm">{p.seq}</TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(p.weight)}</TableCell>
                                    <TableCell className="text-sm">{p.totalUnits || 0}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            <LotRowsLoadMore
                              pageState={rowPagesByKey?.[l.lotKey]}
                              onLoadMore={() => loadMoreLotRows?.(l.lotKey)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
            {/* Grand Total Row */}
            {lots.length > 0 && summary && (
              <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/20">
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">Grand Total</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.availableCount} / {grandTotals.totalPieces}</TableCell>
                <TableCell className="font-bold text-primary">{formatKg(grandTotals.remainingWeight)} / {formatKg(grandTotals.totalWeight)}</TableCell>
                <TableCell className="font-bold text-primary">{grandWastageSummary}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View for Jumbo Rolls (read-only) */}
      <div className="block sm:hidden space-y-3">
        {lots.length === 0 ? (
          <ListState
            isLoading={isLoading}
            error={error}
            onRetry={onRetry}
            emptyMessage="No lots found."
            className="border rounded-lg bg-card"
          />
        ) : (
          lots.map((l, idx) => {
            const lotIdentity = l.lotKey || l.lotNo;
            const isExpanded = expandedLot === lotIdentity;
            const pieces = piecesFor(l);
            const available = l.availableCount ?? countAvailablePieces(l.pieces || []);
            const total = l.totalPieces ?? (l.pieces || []).length;

            return (
              <div key={lotIdentity || idx} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                <div className="p-4" onClick={() => toggleExpand(l)}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold flex items-center gap-2">
                        {l.lotNo || '—'}
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                      </div>
                      <p className="text-sm text-foreground mt-1">{l.itemName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateDDMMYYYY(l.date)} • {l.supplierName}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-semibold">{formatKg(l.remainingWeight)} / {formatKg(l.totalWeight)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{available} / {total} pieces</div>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Wastage: <span className="text-foreground">{formatWastageSummary(l)}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/30 p-3 space-y-2">
                    <div className="text-xs text-muted-foreground">Firm: {l.firmName}</div>
                    {loadingLot === lotIdentity ? (
                      <div className="text-xs text-muted-foreground bg-background border rounded p-2 text-center">Loading pieces...</div>
                    ) : pieces.length === 0 ? (
                      <div className="text-xs text-muted-foreground bg-background border rounded p-2 text-center">
                        No pieces.
                      </div>
                    ) : pieces.slice().sort((a, b) => a.seq - b.seq).map(p => (
                      <div key={p.id} className="bg-background border rounded p-2 text-sm">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">{p.barcode || p.id}</span>
                            <span className="text-xs text-muted-foreground">Seq: {p.seq || '—'}</span>
                            {p.issuedLabel ? (
                              <span className="text-[10px] text-muted-foreground">({p.issuedLabel})</span>
                            ) : null}
                          </div>
                          <span className="font-medium">{formatKg(p.weight)}</span>
                        </div>
                      </div>
                    ))}
                    <LotRowsLoadMore
                      pageState={rowPagesByKey?.[l.lotKey]}
                      onLoadMore={() => loadMoreLotRows?.(l.lotKey)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
        {/* Mobile Grand Total Card */}
        {lots.length > 0 && summary && (
          <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-4 mt-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-primary">Grand Total</span>
              <div className="text-right">
                <div className="font-mono font-bold text-primary">{formatKg(grandTotals.remainingWeight)} / {formatKg(grandTotals.totalWeight)}</div>
                <div className="text-xs text-muted-foreground">{grandTotals.availableCount} / {grandTotals.totalPieces} pieces</div>
              </div>
            </div>
          </div>
        )}
      </div>
      {summaryLoading && lots.length > 0 && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Calculating totals…</div>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading…' : 'Load more lots'}
          </Button>
        </div>
      )}
    </div>
  );
}
