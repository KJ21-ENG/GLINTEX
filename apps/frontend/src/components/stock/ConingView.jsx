import React, { useMemo, useState, useEffect } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, formatDateDDMMYYYY, fuzzyScore, calculateMultiTermScore } from '../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { HighlightMatch } from '../common/HighlightMatch';
import { LotPopover } from './LotPopover';

const buildGroupKey = (lot) => ([
  lot.itemId || lot.itemName || '',
  lot.supplierId || lot.supplierName || '',
  lot.cutName || '',
  lot.yarnName || '',
  lot.twistName || ''
].join('::'));

export function ConingView({ db, filters, search = '', groupBy = false, onApplyFilter }) {
  const EPSILON = 1e-9;
  const [expandedLot, setExpandedLot] = useState(null);
  useEffect(() => { setExpandedLot(null); }, [groupBy]);

  const issueMap = useMemo(() => {
    const map = new Map();
    (db.issue_to_coning_machine || []).forEach((issue) => {
      if (issue?.id) map.set(issue.id, issue);
    });
    return map;
  }, [db.issue_to_coning_machine]);

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

  const coningRows = useMemo(() => {
    return (db.receive_from_coning_machine_rows || []).map((row) => {
      const issue = row?.issueId ? issueMap.get(row.issueId) : row.issue;
      const lotNoRaw = row?.lotNo || issue?.lotNo || '';
      const lotLabel = issue?.lotLabel || lotNoRaw || '';
      const lotMeta = lotNoRaw ? lotMetaMap.get(lotNoRaw) : null;
      const itemName = lotMeta?.itemName || db.items?.find(i => i.id === issue?.itemId)?.name || '—';
      const machineName = row.machineNo || row.machine?.name || (() => {
        if (!issue?.machineId) return '';
        const m = db.machines?.find(mc => mc.id === issue.machineId);
        return m?.name || '';
      })();

      const coneCount = Number(row.coneCount || row.totalCones || 0);
      const dispatchedCones = Number(row.dispatchedCount || 0);
      const baseNetWeight = Number.isFinite(row.netWeight)
        ? Number(row.netWeight)
        : (Number.isFinite(row.coneWeight) ? Number(row.coneWeight) : (Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
      const dispatchedWeight = Number(row.dispatchedWeight || 0);
      const availableWeightRaw = Math.max(0, baseNetWeight - dispatchedWeight);
      const availableWeight = availableWeightRaw > EPSILON ? availableWeightRaw : 0;
      const availableCones = Math.max(0, coneCount - dispatchedCones);
      const grossWeight = Number(row.grossWeight ?? 0);

      return {
        ...row,
        lotNo: lotLabel,
        lotNoRaw,
        itemId: issue?.itemId || lotMeta?.itemId || '',
        itemName,
        firmId: lotMeta?.firmId || '',
        firmName: lotMeta?.firmName || '—',
        supplierId: lotMeta?.supplierId || '',
        supplierName: lotMeta?.supplierName || '—',
        coneCount,
        dispatchedCones,
        availableCones,
        netWeight: baseNetWeight,
        availableWeight,
        grossWeight,
        coneType: row.coneType?.name || row.coneTypeName || '—',
        boxName: row.box?.name || '—',
        machineName: machineName || '—',
        operatorName: row.operator?.name || '—',
        date: row.date || row.createdAt || '',
        statusType: availableWeight > EPSILON ? 'active' : 'inactive',
      };
    });
  }, [db.receive_from_coning_machine_rows, issueMap, lotMetaMap, db.items, db.machines]);

  const coningLots = useMemo(() => {
    const map = new Map();
    coningRows.forEach((row) => {
      const lotNo = row.lotNo || '(No Lot)';
      const existing = map.get(lotNo) || {
        lotNo,
        itemId: row.itemId || '',
        itemName: row.itemName || '—',
        firmId: row.firmId || '',
        firmName: row.firmName || '—',
        supplierId: row.supplierId || '',
        supplierName: row.supplierName || '—',
        totalCones: 0,
        totalWeight: 0,
        rows: []
      };
      existing.rows.push(row);
      existing.totalCones += row.availableCones;
      existing.totalWeight += row.availableWeight;
      map.set(lotNo, existing);
    });
    return Array.from(map.values()).map((lot) => ({
      ...lot,
      statusType: lot.totalWeight > EPSILON ? 'active' : 'inactive',
      date: lot.rows?.[0]?.date || '',
    }));
  }, [coningRows]);

  const filteredLots = useMemo(() => {
    let list = coningLots.map(l => {
      let score = 0;
      if (search) {
        const formattedDate = formatDateDDMMYYYY(l.date);
        const searchableFields = [
          'lotNo', 'itemName', 'firmName', 'supplierName', 'machineName', 'operatorName', 'coneType', 'boxName',
          'totalCones', 'totalWeight'
        ];
        const tempItem = {
          ...l,
          dateStr: formattedDate,
          totalCones: String(l.totalCones || 0),
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
      if (filters.firm && l.firmId !== filters.firm) return false;
      if (filters.supplier && l.supplierId !== filters.supplier) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      if (filters.status !== 'all' && l.statusType !== filters.status) return false;
      return true;
    }).sort((a, b) => {
      if (search && a.searchScore !== b.searchScore) {
        return b.searchScore - a.searchScore;
      }
      return (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true });
    });
  }, [coningLots, filters, search]);

  const displayLots = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = buildGroupKey(lot);
      const existing = map.get(key) || {
        lotNo: '', // grouped rows show dash for lot
        groupKey: key,
        itemId: lot.itemId,
        itemName: lot.itemName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierId: lot.supplierId,
        supplierName: lot.supplierName,
        totalCones: 0,
        totalWeight: 0,
        statusType: lot.statusType,
        rows: [],
        lots: [],
      };
      existing.totalCones += lot.totalCones;
      existing.totalWeight += lot.totalWeight;
      existing.statusType = existing.totalWeight > EPSILON ? 'active' : 'inactive';
      existing.rows = [];
      existing.lots.push(lot.lotNo);
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [filteredLots, groupBy]);

  const tableColumnCount = groupBy ? 7 : 8;

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
              {!groupBy ? <TableHead>Firm</TableHead> : null}
              <TableHead>Supplier</TableHead>
              <TableHead className="">Available Cones</TableHead>
              <TableHead className="">Net Weight</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLots.length === 0 ? (
              <TableRow><TableCell colSpan={tableColumnCount} className="text-center py-4 text-muted-foreground">No coning stock found.</TableCell></TableRow>
            ) : (
              displayLots.map((lot, idx) => {
                const rowKey = groupBy ? (lot.groupKey || idx) : (lot.lotNo || idx);
                const isExpanded = !groupBy && expandedLot === lot.lotNo;
                return (
                  <React.Fragment key={rowKey}>
                    <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : lot.lotNo)}>
                      <TableCell>
                        {!groupBy && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {groupBy ? (
                          <LotPopover lots={lot.lots || []} onApplyFilter={onApplyFilter} />
                        ) : (
                          <HighlightMatch text={lot.lotNo || '—'} query={search} />
                        )}
                      </TableCell>
                      <TableCell>{formatDateDDMMYYYY(lot.date) || '—'}</TableCell>
                      <TableCell>
                        <HighlightMatch text={lot.itemName} query={search} />
                      </TableCell>
                      {!groupBy ? (
                        <TableCell>
                          <HighlightMatch text={lot.firmName} query={search} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <HighlightMatch text={lot.supplierName} query={search} />
                      </TableCell>
                      <TableCell className="">{lot.totalCones}</TableCell>
                      <TableCell className="">{formatKg(lot.totalWeight)}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={8} className="p-4">
                          <div className="border rounded-md bg-background overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Barcode</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Box</TableHead>
                                  <TableHead>Cone Type</TableHead>
                                  <TableHead className="">Available Cones</TableHead>
                                  <TableHead className="">Net / Gross Wt</TableHead>
                                  <TableHead>Machine</TableHead>
                                  <TableHead>Operator</TableHead>
                                  <TableHead>Notes</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {lot.rows.map((row) => (
                                  <TableRow key={row.id}>
                                    <TableCell className="font-mono text-xs">{row.barcode || '—'}</TableCell>
                                    <TableCell>{formatDateDDMMYYYY(row.date) || '—'}</TableCell>
                                    <TableCell>{row.boxName}</TableCell>
                                    <TableCell>{row.coneType}</TableCell>
                                    <TableCell className="">{row.availableCones}</TableCell>
                                    <TableCell className="">{formatKg(row.availableWeight)}{row.grossWeight ? ` / ${formatKg(row.grossWeight)}` : ''}</TableCell>
                                    <TableCell>{row.machineName}</TableCell>
                                    <TableCell>{row.operatorName}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{row.notes || row.note || '—'}</TableCell>
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
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View for Coning Stock */}
      <div className="block sm:hidden space-y-3">
        {displayLots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No coning stock found.</div>
        ) : (
          displayLots.map((lot, idx) => {
            const rowKey = groupBy ? (lot.groupKey || idx) : (lot.lotNo || idx);
            const isExpanded = !groupBy && expandedLot === lot.lotNo;

            return (
              <div key={rowKey} className="border rounded-lg bg-card shadow-sm overflow-hidden text-sm">
                <div className="p-4" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : lot.lotNo)}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold flex items-center gap-2">
                        {groupBy ? (
                          <LotPopover lots={lot.lots || []} onApplyFilter={onApplyFilter} />
                        ) : (
                          <HighlightMatch text={lot.lotNo || '—'} query={search} />
                        )}
                        {!groupBy && (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
                      </div>
                      <p className="font-medium mt-1">
                        <HighlightMatch text={lot.itemName} query={search} />
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateDDMMYYYY(lot.date) || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-semibold">{formatKg(lot.totalWeight)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{lot.totalCones} cones</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Supplier: <HighlightMatch text={lot.supplierName} query={search} /></span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Box Details</p>
                    {lot.rows.map(r => (
                      <div key={r.id} className="bg-background border rounded p-2 space-y-1">
                        <div className="flex justify-between font-mono text-xs">
                          <span className="font-semibold text-primary">{r.barcode}</span>
                          <span>{formatKg(r.availableWeight)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>{r.boxName} • Cones: {r.availableCones}</span>
                          <span>Mac: {r.machineName}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
