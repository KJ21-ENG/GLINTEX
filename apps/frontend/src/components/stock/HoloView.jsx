import React, { useMemo, useState, useEffect } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, formatDateDDMMYYYY, fuzzyScore, calculateMultiTermScore, calcAvailableCountFromWeight } from '../../utils';
import { ChevronDown, ChevronRight, Flame, FlameKindling } from 'lucide-react';
import { HighlightMatch } from '../common/HighlightMatch';
import { LotPopover } from './LotPopover';
import { cn } from '../../lib/utils';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';

const buildGroupKey = (lot) => ([
  lot.itemId || lot.itemName || '',
  lot.supplierId || lot.supplierName || '',
  lot.cutName || '',
  lot.yarnName || '',
  lot.twistName || ''
].join('::'));

export function HoloView({ db, filters, search = '', groupBy = false, onApplyFilter, onDataChange }) {
  const EPSILON = 1e-9;
  const [expandedLot, setExpandedLot] = useState(null);
  useEffect(() => { setExpandedLot(null); }, [groupBy]);
  const traceContext = useMemo(() => buildHoloTraceContext(db), [db]);

  // --- Data Prep ---

  // 1. Map Issue Metadata (to link back to Lot)
  const holoIssueMap = useMemo(() => {
    const map = new Map();
    (db.issue_to_holo_machine || []).forEach((issue) => { if (issue?.id) map.set(issue.id, issue); });
    return map;
  }, [db.issue_to_holo_machine]);

  const cutByIssueId = useMemo(() => {
    const map = new Map();
    (db.issue_to_holo_machine || []).forEach((issue) => {
      if (!issue?.id) return;
      const resolved = resolveHoloTrace(issue, traceContext);
      map.set(issue.id, resolved.cutName || '—');
    });
    return map;
  }, [db.issue_to_holo_machine, traceContext]);

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

  // 3. Process Rows
  const holoRows = useMemo(() => {
    return (db.receive_from_holo_machine_rows || []).map((row) => {
      const issue = row?.issueId ? holoIssueMap.get(row.issueId) : null;
      const lotNoRaw = issue?.lotNo || '';
      const lotLabel = issue?.lotLabel || lotNoRaw || '';
      const lotNos = Array.isArray(issue?.lotNos) ? issue.lotNos : (lotNoRaw ? [lotNoRaw] : []);
      const lotMeta = lotNoRaw ? lotMetaMap.get(lotNoRaw) : null;
      const hasMixedLots = Array.isArray(issue?.lotNos) && issue.lotNos.length > 1;

      const yarn = db.yarns?.find(y => y.id === issue?.yarnId);
      const twist = db.twists?.find(t => t.id === issue?.twistId);
      const itemName = lotMeta?.itemName || db.items?.find(i => i.id === issue?.itemId)?.name || '—';
      const firmName = lotMeta?.firmName || (hasMixedLots ? 'Mixed' : '—');
      const supplierName = lotMeta?.supplierName || (hasMixedLots ? 'Mixed' : '—');

      const baseNetWeight = Number.isFinite(row.rollWeight)
        ? Number(row.rollWeight)
        : (Number(row.grossWeight || 0) - Number(row.tareWeight || 0));
      const dispatchedRolls = Number(row.dispatchedCount || 0);
      const dispatchedWeight = Number(row.dispatchedWeight || 0);
      const issuedToConingRolls = Number(row.issuedToConingRolls || 0);
      const issuedToConingWeight = Number(row.issuedToConingWeight || 0);
      const availableWeightRaw = Math.max(0, baseNetWeight - dispatchedWeight - issuedToConingWeight);
      const availableWeight = availableWeightRaw > EPSILON ? availableWeightRaw : 0;
      const availableRolls = calcAvailableCountFromWeight({
        totalCount: Number(row.rollCount || 0),
        issuedCount: issuedToConingRolls,
        dispatchedCount: dispatchedRolls,
        totalWeight: baseNetWeight,
        availableWeight,
      }) || 0;

      return {
        ...row,
        lotNo: lotLabel,
        lotNoRaw,
        lotNos,
        itemId: issue?.itemId || lotMeta?.itemId || '',
        itemName,
        firmId: lotMeta?.firmId || '',
        firmName,
        supplierId: lotMeta?.supplierId || '',
        supplierName,
        yarnId: issue?.yarnId || '',
        yarnName: yarn?.name || '—',
        twistName: twist?.name || '—',
        cutName: row.issue?.cut?.name || (issue?.id ? cutByIssueId.get(issue.id) : null) || '—',
        rollCount: Number(row.rollCount || 0),
        dispatchedRolls,
        availableRolls,
        rollWeight: Number(row.rollWeight || 0),
        netWeight: baseNetWeight,
        availableWeight,
        issuedToConingRolls,
        issuedToConingWeight,
        isSteamed: !!row.isSteamed,
        steamedAt: row.steamedAt || null,
      };
    });
  }, [db.receive_from_holo_machine_rows, holoIssueMap, lotMetaMap, db.items, db.yarns, db.twists, cutByIssueId]);

  // 4. Group by Lot
  const holoLots = useMemo(() => {
    const map = new Map();
    holoRows.forEach((row) => {
      const lotKey = `${row.lotNo || '(No Lot)'}::${row.itemId || ''}::${row.yarnId || ''}::${row.cutName || ''}::${row.twistName || '—'}::${row.supplierId || ''}`; // group by lot, item, yarn, cut, twist, supplier
      const existing = map.get(lotKey) || {
        lotNo: row.lotNo || '(No Lot)',
        twistKey: row.twistName || '—',
        itemId: row.itemId || '',
        firmId: row.firmId || '',
        supplierId: row.supplierId || '',
        yarnId: row.yarnId || '',
        itemName: row.itemName,
        firmName: row.firmName,
        supplierName: row.supplierName,
        yarnName: row.yarnName,
        twistName: row.twistName,
        cutNames: new Set(),
        totalRolls: 0,
        totalWeight: 0,
        steamedRolls: 0,
        steamedWeight: 0,
        lotNos: new Set(),
        rows: []
      };

      existing.rows.push(row);
      existing.totalRolls += row.availableRolls;
      existing.totalWeight += row.availableWeight;
      existing.cutNames.add(row.cutName || '—');
      (row.lotNos || []).forEach(lot => existing.lotNos.add(lot));
      // Track steamed status
      if (row.isSteamed) {
        existing.steamedRolls += row.availableRolls;
        existing.steamedWeight += row.availableWeight;
      }
      map.set(lotKey, existing);
    });
    return Array.from(map.values()).map((lot) => {
      const cutName = lot.cutNames.size > 1 ? 'Mixed' : Array.from(lot.cutNames)[0] || '—';
      const lotNosArr = Array.from(lot.lotNos || []);
      const { lotNos, ...rest } = lot;
      // Determine steamed status type for filtering
      const steamedStatusType = rest.steamedRolls === 0 ? 'not_steamed'
        : rest.steamedRolls >= rest.totalRolls ? 'steamed'
          : 'partial';
      return {
        ...rest,
        cutName,
        cutNames: lot.cutNames,
        lotNos: lotNosArr,
        lotSearch: lotNosArr.join(' '),
        statusType: rest.totalWeight > EPSILON ? 'active' : 'inactive',
        steamedStatusType,
        date: rest.rows?.[0]?.date || rest.rows?.[0]?.createdAt || '',
      };
    });
  }, [holoRows]);

  // 5. Filter
  const filteredLots = useMemo(() => {
    let list = holoLots.map(l => {
      let score = 0;
      if (search) {
        const formattedDate = formatDateDDMMYYYY(l.date);
        const searchableFields = [
          'lotNo', 'lotSearch', 'itemName', 'cutName', 'yarnName', 'twistName', 'firmName', 'supplierName',
          'totalRolls', 'totalWeight'
        ];
        const tempItem = {
          ...l,
          dateStr: formattedDate,
          totalRolls: String(l.totalRolls || 0),
          totalWeight: String(l.totalWeight || 0)
        };
        score = calculateMultiTermScore(tempItem, search, [...searchableFields, 'dateStr']);
      } else {
        score = 1;
      }
      return { ...l, searchScore: score };
    });

    if (search) {
      list = list.filter(l => l.searchScore > 0);
    }

    return list.filter(l => {
      if (filters.item && l.itemId !== filters.item) return false;
      if (filters.cut) {
        const cutName = db?.cuts?.find(c => c.id === filters.cut)?.name;
        if (cutName && !l.cutNames?.has(cutName)) return false;
      }
      if (filters.yarn && l.yarnId !== filters.yarn) return false;
      if (filters.firm && l.firmId !== filters.firm) return false;
      if (filters.supplier && l.supplierId !== filters.supplier) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      if (filters.status !== 'all' && l.statusType !== filters.status) return false;
      // Steamed filter support
      if (filters.steamed && filters.steamed !== 'all') {
        if (filters.steamed === 'steamed' && l.steamedStatusType !== 'steamed') return false;
        if (filters.steamed === 'not_steamed' && l.steamedStatusType !== 'not_steamed') return false;
        if (filters.steamed === 'partial' && l.steamedStatusType !== 'partial') return false;
      }
      return true;
    }).sort((a, b) => {
      if (search && a.searchScore !== b.searchScore) {
        return b.searchScore - a.searchScore;
      }
      return (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true });
    });
  }, [holoLots, filters, search, db.cuts]);


  const displayLots = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = buildGroupKey(lot);
      const existing = map.get(key) || {
        lotNo: '', // grouped rows show dash in lot column
        groupKey: key,
        itemId: lot.itemId,
        itemName: lot.itemName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierId: lot.supplierId,
        supplierName: lot.supplierName,
        yarnName: lot.yarnName,
        twistName: lot.twistName,
        cutNames: new Set(),
        totalRolls: 0,
        totalWeight: 0,
        rows: [],
        lots: [],
        statusType: lot.statusType,
      };
      existing.totalRolls += lot.totalRolls;
      existing.totalWeight += lot.totalWeight;
      existing.statusType = existing.totalWeight > EPSILON ? 'active' : 'inactive';
      existing.rows = []; // collapse detail when grouped
      existing.lots.push(lot.lotNo);
      existing.cutNames.add(lot.cutName || '—');
      map.set(key, existing);
    });
    return Array.from(map.values()).map((lot) => {
      const cutName = lot.cutNames.size > 1 ? 'Mixed' : Array.from(lot.cutNames)[0] || '—';
      const { cutNames, ...rest } = lot;
      return { ...rest, cutName };
    });
  }, [filteredLots, groupBy]);

  // Bubble up data for export (pass displayed data which respects groupBy)
  useEffect(() => {
    if (onDataChange) onDataChange(displayLots);
  }, [displayLots, onDataChange]);

  const tableColumnCount = groupBy ? 10 : 11;

  // Grand Totals
  const grandTotals = useMemo(() => {
    return displayLots.reduce((acc, lot) => ({
      totalRolls: acc.totalRolls + (lot.totalRolls || 0),
      totalWeight: acc.totalWeight + (lot.totalWeight || 0),
      steamedRolls: acc.steamedRolls + (lot.steamedRolls || 0),
    }), { totalRolls: 0, totalWeight: 0, steamedRolls: 0 });
  }, [displayLots]);

  return (
    <>
      <div className="hidden sm:block rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Lot No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Cut</TableHead>
              <TableHead>Yarn / Twist</TableHead>
              {!groupBy ? <TableHead>Firm</TableHead> : null}
              <TableHead>Supplier</TableHead>
              <TableHead className="">Available Rolls</TableHead>
              <TableHead className="">Net Weight</TableHead>
              <TableHead className="">Steamed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLots.length === 0 ? (
              <TableRow><TableCell colSpan={tableColumnCount} className="text-center py-4 text-muted-foreground">No holo stock found.</TableCell></TableRow>
            ) : (
              displayLots.map((l, idx) => {
                const rowKey = groupBy
                  ? (l.groupKey || idx)
                  : (l.lotNo ? `${l.lotNo}::${l.twistName || ''}` : idx);
                const isExpanded = !groupBy && expandedLot === `${l.lotNo}::${l.twistName}`;
                return (
                  <React.Fragment key={rowKey}>
                    <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : `${l.lotNo}::${l.twistName}`)}>
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
                      <TableCell>
                        <div className="flex gap-1">
                          <HighlightMatch text={l.yarnName} query={search} />
                          <span>/</span>
                          <HighlightMatch text={l.twistName} query={search} />
                        </div>
                      </TableCell>
                      {!groupBy ? (
                        <TableCell>
                          <HighlightMatch text={l.firmName} query={search} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <HighlightMatch text={l.supplierName} query={search} />
                      </TableCell>
                      <TableCell className="">{l.totalRolls}</TableCell>
                      <TableCell className="">{formatKg(l.totalWeight)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            l.steamedStatusType === 'steamed' && "bg-green-500/10 text-green-600 border-green-500/50",
                            l.steamedStatusType === 'partial' && "bg-orange-500/10 text-orange-600 border-orange-500/50",
                            l.steamedStatusType === 'not_steamed' && "bg-gray-500/10 text-gray-500 border-gray-500/30"
                          )}
                        >
                          {l.steamedStatusType === 'steamed' && <Flame className="w-3 h-3 mr-1" />}
                          {l.steamedStatusType === 'partial' && <FlameKindling className="w-3 h-3 mr-1" />}
                          {l.steamedRolls} / {l.totalRolls}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={10} className="p-4">
                          <div className="border rounded-md bg-background overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Barcode</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Roll Type</TableHead>
                                  <TableHead className="">Available Rolls</TableHead>
                                  <TableHead className="">Net Wt</TableHead>
                                  <TableHead className="">Gross Wt</TableHead>
                                  <TableHead>Machine</TableHead>
                                  <TableHead>Steamed</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {l.rows.map(r => (
                                  <TableRow key={r.id} className={r.isSteamed ? 'bg-green-500/5' : ''}>
                                    <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                                    <TableCell>{formatDateDDMMYYYY(r.date)}</TableCell>
                                    <TableCell>{r.rollType?.name || '—'}</TableCell>
                                    <TableCell className="">{r.availableRolls}</TableCell>
                                    <TableCell className="">{formatKg(r.availableWeight)}</TableCell>
                                    <TableCell className="">{formatKg(r.grossWeight)}</TableCell>
                                    <TableCell>{r.machineNo}</TableCell>
                                    <TableCell>
                                      {r.isSteamed ? (
                                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/50">
                                          <Flame className="w-3 h-3 mr-1" />
                                          Steamed
                                        </Badge>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
            {/* Grand Total Row */}
            {displayLots.length > 0 && (
              <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/20">
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">Grand Total</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                {!groupBy ? <TableCell></TableCell> : null}
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.totalRolls}</TableCell>
                <TableCell className="font-bold text-primary">{formatKg(grandTotals.totalWeight)}</TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.steamedRolls} / {grandTotals.totalRolls}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View for Holo Stock */}
      <div className="block sm:hidden space-y-3">
        {displayLots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No holo stock found.</div>
        ) : (
          displayLots.map((l, idx) => {
            const rowKey = groupBy ? (l.groupKey || idx) : (l.lotNo ? `${l.lotNo}::${l.twistName || ''}` : idx);
            const isExpanded = !groupBy && expandedLot === `${l.lotNo}::${l.twistName}`;

            return (
              <div key={rowKey} className="border rounded-lg bg-card shadow-sm overflow-hidden text-sm">
                <div className="p-4" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : `${l.lotNo}::${l.twistName}`)}>
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
                      <div className="font-mono font-semibold">{formatKg(l.totalWeight)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{l.totalRolls} rolls</div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] mt-1",
                          l.steamedStatusType === 'steamed' && "bg-green-500/10 text-green-600 border-green-500/50",
                          l.steamedStatusType === 'partial' && "bg-orange-500/10 text-orange-600 border-orange-500/50",
                          l.steamedStatusType === 'not_steamed' && "bg-gray-500/10 text-gray-500 border-gray-500/30"
                        )}
                      >
                        {l.steamedStatusType === 'steamed' && <Flame className="w-3 h-3 mr-1" />}
                        {l.steamedRolls}/{l.totalRolls} steamed
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Twist: {l.twistName}</span>
                    <span>Supplier: <HighlightMatch text={l.supplierName} query={search} /></span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Roll Details</p>
                    {l.rows.map(r => (
                      <div key={r.id} className={cn("bg-background border rounded p-2 space-y-1", r.isSteamed && "border-green-500/30")}>
                        <div className="flex justify-between font-mono text-xs">
                          <span className="font-semibold text-primary">{r.barcode}</span>
                          <span>{formatKg(r.availableWeight)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>{r.rollType?.name} • Rolls: {r.availableRolls}</span>
                          <span className="flex items-center gap-1">
                            {r.isSteamed && <Flame className="w-3 h-3 text-green-600" />}
                            Mac: {r.machineNo}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        {/* Mobile Grand Total Card */}
        {displayLots.length > 0 && (
          <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-4 mt-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-primary">Grand Total</span>
              <div className="text-right">
                <div className="font-mono font-bold text-primary">{formatKg(grandTotals.totalWeight)}</div>
                <div className="text-xs text-muted-foreground">{grandTotals.totalRolls} rolls • {grandTotals.steamedRolls} steamed</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
