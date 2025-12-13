import React, { useMemo, useState, useEffect } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LotPopover } from './LotPopover';

export function HoloView({ db, filters, search = '', groupBy = false, onApplyFilter }) {
  const [expandedLot, setExpandedLot] = useState(null);
  useEffect(() => { setExpandedLot(null); }, [groupBy]);

  // --- Data Prep ---

  // 1. Map Issue Metadata (to link back to Lot)
  const holoIssueMap = useMemo(() => {
    const map = new Map();
    (db.issue_to_holo_machine || []).forEach((issue) => { if (issue?.id) map.set(issue.id, issue); });
    return map;
  }, [db.issue_to_holo_machine]);

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
      const lotNo = issue?.lotNo || '';
      const lotMeta = lotNo ? lotMetaMap.get(lotNo) : null;

      const yarn = db.yarns?.find(y => y.id === issue?.yarnId);
      const twist = db.twists?.find(t => t.id === issue?.twistId);

      return {
        ...row,
        lotNo,
        itemId: issue?.itemId || lotMeta?.itemId || '',
        itemName: lotMeta?.itemName || '—',
        firmId: lotMeta?.firmId || '',
        firmName: lotMeta?.firmName || '—',
        supplierId: lotMeta?.supplierId || '',
        supplierName: lotMeta?.supplierName || '—',
        yarnName: yarn?.name || '—',
        twistName: twist?.name || '—',
        rollCount: Number(row.rollCount || 0),
        rollWeight: Number(row.rollWeight || 0),
      };
    });
  }, [db.receive_from_holo_machine_rows, holoIssueMap, lotMetaMap, db.yarns, db.twists]);

  // 4. Group by Lot
  const holoLots = useMemo(() => {
    const map = new Map();
    holoRows.forEach((row) => {
      const lotKey = `${row.lotNo || '(No Lot)'}::${row.twistName || '—'}`; // separate rows per twist even if lot matches
      const existing = map.get(lotKey) || {
        lotNo: row.lotNo || '(No Lot)',
        twistKey: row.twistName || '—',
        itemId: row.itemId || '',
        firmId: row.firmId || '',
        supplierId: row.supplierId || '',
        itemName: row.itemName,
        firmName: row.firmName,
        supplierName: row.supplierName,
        yarnName: row.yarnName,
        twistName: row.twistName,
        totalRolls: 0,
        totalWeight: 0,
        rows: []
      };

      existing.rows.push(row);
      existing.totalRolls += row.rollCount;
      existing.totalWeight += row.rollWeight;
      map.set(lotKey, existing);
    });
    return Array.from(map.values()).map((lot) => ({
      ...lot,
      statusType: lot.totalRolls > 0 ? 'active' : 'inactive',
      date: lot.rows?.[0]?.date || lot.rows?.[0]?.createdAt || '',
    }));
  }, [holoRows]);

  // 5. Filter
  const filteredLots = useMemo(() => {
    return holoLots.filter(l => {
      if (search) {
        const s = search.toLowerCase();
        const hit = [l.lotNo, l.itemName, l.yarnName, l.twistName, l.supplierName].some(v => (v || '').toLowerCase().includes(s));
        if (!hit) return false;
      }
      if (filters.item && l.itemId !== filters.item) return false;
      if (filters.firm && l.firmId !== filters.firm) return false;
      if (filters.supplier && l.supplierId !== filters.supplier) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      if (filters.status !== 'all' && l.statusType !== filters.status) return false;
      return true;
    }).sort((a, b) => (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true }));
  }, [holoLots, filters, search]);

  const displayLots = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = `${lot.itemId || ''}::${lot.firmId || ''}::${lot.twistName || ''}`;
      const existing = map.get(key) || {
        lotNo: '', // grouped rows show dash in lot column
        itemId: lot.itemId,
        itemName: lot.itemName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierId: lot.supplierId,
        supplierName: lot.supplierName,
        yarnName: lot.yarnName,
        twistName: lot.twistName,
        totalRolls: 0,
        totalWeight: 0,
        rows: [],
        lots: [],
        statusType: lot.statusType,
      };
      existing.totalRolls += lot.totalRolls;
      existing.totalWeight += lot.totalWeight;
      existing.statusType = existing.totalRolls > 0 ? 'active' : 'inactive';
      existing.rows = []; // collapse detail when grouped
      existing.lots.push(lot.lotNo);
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [filteredLots, groupBy]);

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30px]"></TableHead>
            <TableHead>Lot No</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Yarn / Twist</TableHead>
            <TableHead>Firm / Supplier</TableHead>
            <TableHead className="">Total Rolls</TableHead>
            <TableHead className="">Net Weight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayLots.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">No holo stock found.</TableCell></TableRow>
          ) : (
            displayLots.map((l, idx) => {
              const isExpanded = !groupBy && expandedLot === `${l.lotNo}::${l.twistName}`;
              return (
                <React.Fragment key={l.lotNo || idx}>
                  <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : `${l.lotNo}::${l.twistName}`)}>
                    <TableCell>
                      {!groupBy && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {groupBy ? (
                        <LotPopover lots={l.lots || []} onApplyFilter={onApplyFilter} />
                      ) : (l.lotNo || '—')}
                    </TableCell>
                    <TableCell>{l.itemName}</TableCell>
                    <TableCell>{l.yarnName} / {l.twistName}</TableCell>
                    <TableCell>{l.firmName}<br /><span className="text-xs text-muted-foreground">{l.supplierName}</span></TableCell>
                    <TableCell className="">{l.totalRolls}</TableCell>
                    <TableCell className="">{formatKg(l.totalWeight)}</TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={7} className="p-4">
                        <div className="border rounded-md bg-background">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Barcode</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Roll Type</TableHead>
                                <TableHead className="">Rolls</TableHead>
                                <TableHead className="">Net Wt</TableHead>
                                <TableHead className="">Gross Wt</TableHead>
                                <TableHead>Machine</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {l.rows.map(r => (
                                <TableRow key={r.id}>
                                  <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                                  <TableCell>{formatDateDDMMYYYY(r.date)}</TableCell>
                                  <TableCell>{r.rollType?.name || '—'}</TableCell>
                                  <TableCell className="">{r.rollCount}</TableCell>
                                  <TableCell className="">{formatKg(r.rollWeight)}</TableCell>
                                  <TableCell className="">{formatKg(r.grossWeight)}</TableCell>
                                  <TableCell>{r.machineNo}</TableCell>
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
  );
}
