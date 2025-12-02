import React, { useMemo, useState } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Card, Badge } from '../ui';
import { formatKg } from '../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function HoloView({ db, filters }) {
  const [expandedLot, setExpandedLot] = useState(null);

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
        itemId: issue?.itemId || '',
        itemName: lotMeta?.itemName || '—',
        firmName: lotMeta?.firmName || '—',
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
      const lotNo = row.lotNo || '(No Lot)';
      const existing = map.get(lotNo) || {
        lotNo,
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
      map.set(lotNo, existing);
    });
    return Array.from(map.values());
  }, [holoRows]);

  // 5. Filter
  const filteredLots = useMemo(() => {
      return holoLots.filter(l => {
        if (filters.item && l.itemId !== filters.item) return false; // Note: itemId might need to be passed up
        // Basic text filter if needed
        return true;
      }).sort((a,b) => a.lotNo.localeCompare(b.lotNo));
  }, [holoLots, filters]);

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
                {filteredLots.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">No holo stock found.</TableCell></TableRow>
                ) : (
                    filteredLots.map((l, idx) => {
                        const isExpanded = expandedLot === l.lotNo;
                        return (
                            <React.Fragment key={l.lotNo || idx}>
                                <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => setExpandedLot(isExpanded ? null : l.lotNo)}>
                                    <TableCell>
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </TableCell>
                                    <TableCell className="font-medium">{l.lotNo}</TableCell>
                                    <TableCell>{l.itemName}</TableCell>
                                    <TableCell>{l.yarnName} / {l.twistName}</TableCell>
                                    <TableCell>{l.firmName}<br/><span className="text-xs text-muted-foreground">{l.supplierName}</span></TableCell>
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
                                                                <TableCell>{r.date}</TableCell>
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