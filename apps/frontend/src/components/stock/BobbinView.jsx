import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, formatDateDDMMYYYY, fuzzyScore, calculateMultiTermScore, calcAvailableCountFromWeight } from '../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { HighlightMatch } from '../common/HighlightMatch';
import { LotPopover } from './LotPopover';
import { cn } from '../../lib/utils';
import { useBarcodeAutoExpand } from '../../utils/useBarcodeAutoExpand';

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
  useEffect(() => { setExpandedLot(null); }, [groupBy]);

  // --- Data Prep ---

  // 1. Map Inbound Pieces
  const inboundPieceMap = useMemo(() => {
    const map = new Map();
    (db.inbound_items || []).forEach((p) => { if (p?.id) map.set(p.id, p); });
    return map;
  }, [db.inbound_items]);

  // 2. Map Lot Metadata
  const lotMetaMap = useMemo(() => {
    const map = new Map();
    (db.lots || []).forEach((lot) => {
      const item = db.items.find(i => i.id === lot.itemId);
      const firm = db.firms.find(f => f.id === lot.firmId);
      const supplier = db.suppliers.find(s => s.id === lot.supplierId);
      map.set(lot.lotNo, {
        ...lot,
        itemName: item?.name || lot.itemName || '—',
        firmName: firm?.name || lot.firmName || '—',
        supplierName: supplier?.name || lot.supplierName || '—',
      });
    });
    return map;
  }, [db.lots, db.items, db.firms, db.suppliers]);

  // 3. Calculate Bobbin Crates (Rows)
  const bobbinCrates = useMemo(() => {
    return (db.receive_from_cutter_machine_rows || [])
      .filter(row => !row.isDeleted)
      .map((row) => {
        const piece = row?.pieceId ? inboundPieceMap.get(row.pieceId) : null;
        const lotNo = row?.lotNo || piece?.lotNo || '';
        const lotMeta = lotNo ? lotMetaMap.get(lotNo) : null;

        const bobbinQty = Number(row?.bobbinQuantity || 0);
        const issuedBobbins = Number(row?.issuedBobbins || 0);
        const dispatchedBobbins = Number(row?.dispatchedCount || 0);

        const netWeight = Number(row?.netWt ?? row?.totalKg ?? row?.yarnWt ?? 0);
        const issuedWeight = Number(row?.issuedBobbinWeight || 0);
        const dispatchedWeight = Number(row?.dispatchedWeight || 0);
        const availableWeightRaw = Number.isFinite(netWeight)
          ? (netWeight - issuedWeight - dispatchedWeight)
          : 0;
        const availableWeight = availableWeightRaw > EPSILON ? Math.max(0, availableWeightRaw) : 0;
        const availableBobbinsCalc = calcAvailableCountFromWeight({
          totalCount: bobbinQty,
          issuedCount: issuedBobbins,
          dispatchedCount: dispatchedBobbins,
          totalWeight: netWeight,
          availableWeight,
        });
        const availableBobbins = availableBobbinsCalc == null ? 0 : availableBobbinsCalc;

        const cutName = (typeof row.cut === 'string' ? row.cut : row.cut?.name) || db.cuts?.find(c => c.id === row.cutId)?.name || '—';

        return {
          ...row,
          lotNo,
          date: row.date || row.createdAt || '',
          itemId: piece?.itemId || lotMeta?.itemId || '',
          firmId: lotMeta?.firmId || '',
          supplierId: lotMeta?.supplierId || '',
          itemName: lotMeta?.itemName || '—',
          firmName: lotMeta?.firmName || '—',
          supplierName: lotMeta?.supplierName || '—',
          cutName,
          bobbinQty,
          issuedBobbins,
          dispatchedBobbins,
          availableBobbins,
          netWeight,
          issuedWeight,
          availableWeight,
          bobbinName: row.bobbin?.name || row.pcsTypeName || '—',
        };
      });
  }, [db.receive_from_cutter_machine_rows, inboundPieceMap, lotMetaMap, db.cuts]);

  // 4. Aggregate into Lots
  const bobbinLots = useMemo(() => {
    const map = new Map();
    bobbinCrates.forEach((crate) => {
      const lotNo = crate.lotNo || '(No Lot)';
      const existing = map.get(lotNo) || {
        lotNo,
        lotKey: [
          lotNo,
          crate.itemId || '',
          crate.supplierId || '',
          crate.firmId || '',
        ].join('::'),
        date: crate.date || '',
        itemId: crate.itemId,
        firmId: crate.firmId,
        supplierId: crate.supplierId,
        itemName: crate.itemName,
        cutNames: new Set(),
        firmName: crate.firmName,
        supplierName: crate.supplierName,
        totalBobbins: 0,
        issuedBobbins: 0,
        availableBobbins: 0,
        totalWeight: 0,
        issuedWeight: 0,
        availableWeight: 0,
        crates: [],
        barcodes: [],
        notes: [],
      };

      existing.crates.push(crate);
      existing.totalBobbins += crate.bobbinQty;
      existing.issuedBobbins += crate.issuedBobbins;
      existing.availableBobbins += crate.availableBobbins;
      existing.totalWeight += crate.netWeight;
      existing.issuedWeight += crate.issuedWeight;
      existing.availableWeight += crate.availableWeight;
      if (crate.cutName && crate.cutName !== '—') existing.cutNames.add(crate.cutName);
      if (crate.barcode) existing.barcodes.push(crate.barcode);
      if (crate.notes) existing.notes.push(crate.notes);

      map.set(lotNo, existing);
    });
    return Array.from(map.values()).map(l => ({
      ...l,
      cutName: l.cutNames.size > 1 ? 'Mixed' : Array.from(l.cutNames)[0] || '—',
      barcodeStr: (l.barcodes || []).join(' '),
      notesStr: (l.notes || []).join(' '),
    }));
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
      if (filters.yarn && l.yarnId && l.yarnId !== filters.yarn) return false;
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
              <TableRow><TableCell colSpan={groupBy ? 8 : 9} className="text-center py-4 text-muted-foreground">No bobbin stock found.</TableCell></TableRow>
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
                      <TableCell className="">{formatKg(l.availableWeight)} / {formatKg(l.totalWeight)}</TableCell>
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
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {activeCrates.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={8} className="text-center py-4 text-muted-foreground">
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
                                      <TableCell className="">{c.availableBobbins} / {c.bobbinQty}</TableCell>
                                      <TableCell className="">{formatKg(c.availableWeight)} / {formatKg(c.netWeight)}</TableCell>
                                      <TableCell>{c.employee || c.operator?.name || '—'}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground"><HighlightMatch text={c.notes || '—'} query={search} /></TableCell>
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
                <TableCell className="font-bold text-primary">{formatKg(grandTotals.availableWeight)} / {formatKg(grandTotals.totalWeight)}</TableCell>
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
                            <span>{formatKg(c.availableWeight)} / {formatKg(c.netWeight)}</span>
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
