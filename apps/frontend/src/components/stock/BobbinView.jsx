import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, formatDateDDMMYYYY, fuzzyScore, calculateMultiTermScore } from '../../utils';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { HighlightMatch } from '../common/HighlightMatch';
import { TableStateRow } from '../data-table';
import { LotPopover } from './LotPopover';
import { cn } from '../../lib/utils';
import { useBarcodeAutoExpand } from '../../utils/useBarcodeAutoExpand';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { buildInboundPieceMap, buildBobbinLotMetaMap, buildBobbinCrates, buildBobbinLots } from './stockSelectors';

const buildGroupKey = (lot) => ([
  lot.itemId || lot.itemName || '',
  lot.supplierId || lot.supplierName || '',
  lot.cutName || '',
  lot.yarnName || '',
  lot.twistName || ''
].join('::'));

const idEq = (a, b) => String(a ?? '') === String(b ?? '');

export function BobbinView({ db, filters, search = '', groupBy = false, onApplyFilter, onDataChange }) {
  const EPSILON = 1e-9;
  const [expandedLot, setExpandedLot] = useState(null);
  const [reprintingId, setReprintingId] = useState(null);
  useEffect(() => { setExpandedLot(null); }, [groupBy]);

  // --- Data Prep ---

  // 1. Map Inbound Pieces
  const inboundPieceMap = useMemo(() => {
    return buildInboundPieceMap(db);
  }, [db.inbound_items]);

  // 2. Map Lot Metadata
  const lotMetaMap = useMemo(() => {
    return buildBobbinLotMetaMap(db);
  }, [db.lots, db.items, db.firms, db.suppliers]);

  // 3. Calculate Bobbin Crates (Rows)
  const bobbinCrates = useMemo(() => {
    return buildBobbinCrates(db, inboundPieceMap, lotMetaMap);
  }, [db.receive_from_cutter_machine_rows, inboundPieceMap, lotMetaMap, db.cuts]);

  // 4. Aggregate into Lots
  const bobbinLots = useMemo(() => {
    return buildBobbinLots(bobbinCrates);
  }, [bobbinCrates]);

  // 5. Filter & Sort
  const filteredLots = useMemo(() => {
    let list = bobbinLots.map(l => {
      let score = 0;
      if (search) {
        const formattedDate = formatDateDDMMYYYY(l.date);
        const searchableFields = [
          'lotNo', 'itemName', 'cutName', 'firmName', 'supplierName', 'bobbinName',
          'totalBobbins', 'availableBobbins', 'totalWeight', 'availableWeight', 'barcodeStr', 'notesStr'
        ];
        const tempItem = {
          ...l,
          dateStr: formattedDate,
          totalBobbins: String(l.totalBobbins || 0),
          availableBobbins: String(l.availableBobbins || 0),
          totalWeight: String(l.totalWeight || 0),
          availableWeight: String(l.availableWeight || 0)
        };
        score = calculateMultiTermScore(tempItem, search, [...searchableFields, 'dateStr']);
      } else {
        score = 1;
      }
      // Also check for direct barcode or notes hit (substring match)
      const searchLower = search ? search.trim().toLowerCase() : '';
      const hasBarcodeHit = (searchLower.length >= 6 && (l.barcodes || []).some(b => String(b || '').toLowerCase().includes(searchLower)))
        || (searchLower.length >= 3 && (l.notes || []).some(n => String(n || '').toLowerCase().includes(searchLower)));
      return { ...l, searchScore: score, hasBarcodeHit };
    });

    if (search) {
      // For long search terms (likely barcodes), require at least a substring match (score >= 40)
      const minScore = search.trim().length >= 8 ? 40 : 1;
      list = list.filter(l => l.searchScore >= minScore || l.hasBarcodeHit);
    }

    return list.filter(l => {
      if (filters.item && !idEq(l.itemId, filters.item)) return false;
      if (filters.cut) {
        const cutName = db?.cuts?.find(c => idEq(c.id, filters.cut))?.name;
        if (cutName && !l.cutNames?.has(cutName)) return false;
      }
      if (filters.yarn) {
        const yarnName = db?.yarns?.find(y => idEq(y.id, filters.yarn))?.name;
        if (yarnName && !l.yarnNames?.has(yarnName)) return false;
      }
      if (filters.firm && !idEq(l.firmId, filters.firm)) return false;
      if (filters.supplier && !idEq(l.supplierId, filters.supplier)) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;

      if (filters.status === 'active' && l.availableBobbins <= 0) return false;
      if (filters.status === 'inactive' && l.availableBobbins > 0) return false;
      if (filters.status === 'available_to_issue' && l.availableBobbins <= 0) return false;

      return true;
    }).sort((a, b) => {
      if (search && a.searchScore !== b.searchScore) {
        return b.searchScore - a.searchScore;
      }
      return (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true });
    });
  }, [bobbinLots, filters, search, db.cuts]);

  const getLotKey = useCallback((lot) => lot?.lotNo || null, []);
  const { markManualInteraction } = useBarcodeAutoExpand({
    enabled: true,
    groupBy,
    search,
    filteredLots,
    getLotKey,
    expandedLot,
    setExpandedLot,
  });


  const displayData = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = buildGroupKey(lot);
      const existing = map.get(key) || {
        lotNo: '', // display dash for grouped rows
        groupKey: key,
        itemId: lot.itemId,
        itemName: lot.itemName,
        cutName: lot.cutName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierName: lot.supplierName,
        totalBobbins: 0,
        issuedBobbins: 0,
        availableBobbins: 0,
        totalWeight: 0,
        issuedWeight: 0,
        availableWeight: 0,
        crateCount: 0,
        crates: [],
        lots: [],
        statusType: lot.availableBobbins > 0 ? 'active' : 'inactive',
      };
      existing.totalBobbins += lot.totalBobbins;
      existing.issuedBobbins += lot.issuedBobbins;
      existing.availableBobbins += lot.availableBobbins;
      existing.totalWeight += lot.totalWeight;
      existing.issuedWeight += lot.issuedWeight;
      existing.availableWeight += lot.availableWeight;
      existing.crateCount += lot.crateCount || lot.crates?.length || 0;
      existing.lots.push(lot.lotNo);
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [filteredLots, groupBy]);

  // Bubble up data for export (pass displayed data which respects groupBy)
  useEffect(() => {
    if (onDataChange) onDataChange(displayData);
  }, [displayData, onDataChange]);

  // Grand Totals
  const grandTotals = useMemo(() => {
    return displayData.reduce((acc, lot) => ({
      totalBobbins: acc.totalBobbins + (lot.totalBobbins || 0),
      availableBobbins: acc.availableBobbins + (lot.availableBobbins || 0),
      totalWeight: acc.totalWeight + (lot.totalWeight || 0),
      availableWeight: acc.availableWeight + (lot.availableWeight || 0),
      crateCount: acc.crateCount + (lot.crates?.length || lot.crateCount || 0),
    }), { totalBobbins: 0, availableBobbins: 0, totalWeight: 0, availableWeight: 0, crateCount: 0 });
  }, [displayData]);

  const handleReprintCrate = async (c) => {
    if (reprintingId) return;
    setReprintingId(c.id);
    try {
      const fullRow = db.receive_from_cutter_machine_rows?.find(x => x.id === c.id) || c;
      const piece = db.inbound_items?.find(p => p.id === fullRow.pieceId);
      const item = db.items?.find(i => i.id === (piece?.itemId || fullRow.itemId));
      const bobbin = db.bobbins?.find(b => b.id === fullRow.bobbinId);
      const box = db.boxes?.find(b => b.id === fullRow.boxId);
      const cut = db.cuts?.find(ct => ct.id === fullRow.cutId)?.name || c.cutName || '';
      const operator = db.operators?.find(o => o.id === fullRow.operatorId);
      const helper = db.workers?.find(w => w.id === fullRow.helperId);
      const issue = (db.issue_to_cutter_machine || []).find(i =>
        Array.isArray(i.pieceIds) && i.pieceIds.includes(fullRow.pieceId)
      );
      const machine = db.machines?.find(m => m.id === issue?.machineId);
      const data = {
        lotNo: fullRow.lotNo || piece?.lotNo || '',
        itemName: item?.name || '',
        pieceId: fullRow.pieceId,
        netWeight: fullRow.netWt,
        grossWeight: fullRow.grossWt,
        tareWeight: fullRow.tareWt,
        bobbinQty: fullRow.bobbinQuantity,
        bobbinName: bobbin?.name || fullRow.bobbin?.name || '',
        boxName: box?.name || fullRow.box?.name || '',
        cut,
        cutName: cut,
        machineName: machine?.name || fullRow.machineNo || '',
        operatorName: operator?.name || fullRow.operator?.name || '',
        helperName: helper?.name || fullRow.helper?.name || '',
        date: fullRow.date || fullRow.createdAt,
        barcode: fullRow.barcode,
      };
      const template = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE);
      if (!template) { alert('No sticker template found for Cutter Receive. Configure it in Label Designer.'); return; }
      await printStageTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE, data, { template });
    } catch (err) {
      alert(err.message || 'Failed to reprint sticker');
    } finally {
      setReprintingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="hidden sm:block rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Lot No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Cut</TableHead>
              {!groupBy ? <TableHead>Firm</TableHead> : null}
              <TableHead>Supplier</TableHead>
              <TableHead className="">Bobbins (Avail/Total)</TableHead>
              <TableHead className="">Weight (Avail/Total)</TableHead>
              <TableHead className="">Crates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayData.length === 0 ? (
              <TableStateRow colSpan={groupBy ? 8 : 9} emptyMessage="No bobbin stock found." />
            ) : (
              displayData.map((l, idx) => {
                const isExpanded = !groupBy && expandedLot === l.lotNo;
                const activeCrates = (l.crates || []).filter((c) => (
                  Number(c?.availableBobbins || 0) > 0 || Number(c?.availableWeight || 0) > EPSILON
                ));
                const rowKey = groupBy ? (l.groupKey || idx) : (l.lotKey || l.lotNo || idx);
                return (
                  <React.Fragment key={rowKey}>
                    <TableRow
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        if (groupBy) return;
                        markManualInteraction();
                        setExpandedLot(isExpanded ? null : l.lotNo);
                      }}
                    >
                      <TableCell>
                        {!groupBy && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {groupBy ? (
                          <LotPopover lots={l.lots || []} onApplyFilter={onApplyFilter} />
                        ) : (
                          <HighlightMatch text={l.lotNo || '—'} query={search} />
                        )}
                      </TableCell>
                      <TableCell>{formatDateDDMMYYYY(l.date) || '—'}</TableCell>
                      <TableCell>
                        <HighlightMatch text={l.itemName} query={search} />
                      </TableCell>
                      <TableCell>
                        <HighlightMatch text={l.cutName || '—'} query={search} />
                      </TableCell>
                      {!groupBy ? (
                        <TableCell>
                          <HighlightMatch text={l.firmName} query={search} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <HighlightMatch text={l.supplierName} query={search} />
                      </TableCell>
                      <TableCell className="">{l.availableBobbins} / {l.totalBobbins}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(l.availableWeight)} / {formatKg(l.totalWeight)}</TableCell>
                      <TableCell className="">{l.crates?.length || l.crateCount}</TableCell>
                    </TableRow>
                    {isExpanded && !groupBy && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={10} className="p-4">
                          <div className="border rounded-md bg-background overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Barcode</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Cut</TableHead>
                                  <TableHead>Bobbin Type</TableHead>
                                  <TableHead className="">Bobbins (Avail)</TableHead>
                                  <TableHead className="">Weight (Avail)</TableHead>
                                  <TableHead>Operator</TableHead>
                                  <TableHead>Notes</TableHead>
                                  <TableHead className="w-8"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {activeCrates.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={9} className="text-center py-4 text-muted-foreground">
                                      No active crate rows.
                                    </TableCell>
                                  </TableRow>
                                ) : activeCrates.map(c => {
                                  const crateMatch = search && (
                                    (search.trim().length >= 6 && String(c.barcode || '').toLowerCase().includes(search.trim().toLowerCase()))
                                    || (search.trim().length >= 3 && String(c.notes || '').toLowerCase().includes(search.trim().toLowerCase()))
                                  );
                                  return (
                                    <TableRow key={c.id} className={crateMatch ? 'bg-primary/10' : ''}>
                                      <TableCell className="font-mono text-xs"><HighlightMatch text={c.barcode || ''} query={search} /></TableCell>
                                      <TableCell>{formatDateDDMMYYYY(c.date) || '—'}</TableCell>
                                      <TableCell>{c.cutName || '—'}</TableCell>
                                      <TableCell>{c.bobbinName}</TableCell>
                                      <TableCell className="text-right tabular-nums">{c.availableBobbins} / {c.bobbinQty}</TableCell>
                                      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(c.availableWeight)} / {formatKg(c.netWeight)}</TableCell>
                                      <TableCell>{c.employee || c.operator?.name || '—'}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground"><HighlightMatch text={c.notes || '—'} query={search} /></TableCell>
                                      <TableCell className="p-1">
                                        <button onClick={(e) => { e.stopPropagation(); handleReprintCrate(c); }} disabled={reprintingId === c.id} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40" title="Reprint label">
                                          <Printer className="w-3.5 h-3.5" />
                                        </button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })
            )}
            {/* Grand Total Row */}
            {displayData.length > 0 && (
              <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/20">
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">Grand Total</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                {!groupBy ? <TableCell></TableCell> : null}
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.availableBobbins} / {grandTotals.totalBobbins}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap font-bold text-primary">{formatKg(grandTotals.availableWeight)} / {formatKg(grandTotals.totalWeight)}</TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.crateCount}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View for Bobbin Stock */}
      <div className="block sm:hidden space-y-3">
        {displayData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No bobbin stock found.</div>
        ) : (
          displayData.map((l, idx) => {
            const isExpanded = !groupBy && expandedLot === l.lotNo;
            const activeCrates = (l.crates || []).filter((c) => (
              Number(c?.availableBobbins || 0) > 0 || Number(c?.availableWeight || 0) > EPSILON
            ));
            const rowKey = groupBy ? (l.groupKey || idx) : (l.lotKey || l.lotNo || idx);

            return (
              <div key={rowKey} className="border rounded-lg bg-card shadow-sm overflow-hidden text-sm">
                <div
                  className="p-4"
                  onClick={() => {
                    if (groupBy) return;
                    markManualInteraction();
                    setExpandedLot(isExpanded ? null : l.lotNo);
                  }}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold flex items-center gap-2">
                        {groupBy ? (
                          <LotPopover lots={l.lots || []} onApplyFilter={onApplyFilter} />
                        ) : (
                          <HighlightMatch text={l.lotNo || '—'} query={search} />
                        )}
                        {!groupBy && (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
                      </div>
                      <p className="font-medium mt-1">
                        <HighlightMatch text={l.itemName} query={search} />
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateDDMMYYYY(l.date) || '—'} • {l.cutName}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-semibold">{formatKg(l.availableWeight)} / {formatKg(l.totalWeight)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{l.availableBobbins} / {l.totalBobbins} bobbins</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Supplier: <HighlightMatch text={l.supplierName} query={search} /></span>
                    <span>Crates: {l.crates?.length || l.crateCount}</span>
                  </div>
                </div>

                {isExpanded && !groupBy && (
                  <div className="border-t bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Crate Details</p>
                    {activeCrates.length === 0 ? (
                      <div className="text-xs text-muted-foreground bg-background border rounded p-2 text-center">
                        No active crate rows.
                      </div>
                    ) : activeCrates.map(c => {
                      const crateMatch = search && (
                        (search.trim().length >= 6 && String(c.barcode || '').toLowerCase().includes(search.trim().toLowerCase()))
                        || (search.trim().length >= 3 && String(c.notes || '').toLowerCase().includes(search.trim().toLowerCase()))
                      );
                      return (
                        <div key={c.id} className={cn("bg-background border rounded p-2 space-y-1", crateMatch && "bg-primary/10")}>
                          <div className="flex justify-between font-mono text-xs">
                            <span className="font-semibold text-primary"><HighlightMatch text={c.barcode} query={search} /></span>
                            <span className="flex items-center gap-1.5">
                              <span>{formatKg(c.availableWeight)} / {formatKg(c.netWeight)}</span>
                              <button onClick={(e) => { e.stopPropagation(); handleReprintCrate(c); }} disabled={reprintingId === c.id} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40" title="Reprint label">
                                <Printer className="w-3 h-3" />
                              </button>
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span>{c.bobbinName} • Qty: {c.availableBobbins}</span>
                            <span>Op: {c.operator?.name || '—'}</span>
                          </div>
                          {c.notes && <div className="text-[11px] text-muted-foreground">Note: <HighlightMatch text={c.notes} query={search} /></div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        {/* Mobile Grand Total Card */}
        {displayData.length > 0 && (
          <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-4 mt-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-primary">Grand Total</span>
              <div className="text-right">
                <div className="font-mono font-bold text-primary">{formatKg(grandTotals.availableWeight)} / {formatKg(grandTotals.totalWeight)}</div>
                <div className="text-xs text-muted-foreground">{grandTotals.availableBobbins} / {grandTotals.totalBobbins} bobbins • {grandTotals.crateCount} crates</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
