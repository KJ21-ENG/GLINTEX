import React, { useMemo, useState, useEffect } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg } from '../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function ConingView({ db, filters, search = '', groupBy = false }) {
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
      const lotNo = row?.lotNo || issue?.lotNo || '';
      const lotMeta = lotNo ? lotMetaMap.get(lotNo) : null;
      const machineName = row.machineNo || row.machine?.name || (() => {
        if (!issue?.machineId) return '';
        const m = db.machines?.find(mc => mc.id === issue.machineId);
        return m?.name || '';
      })();

      const coneCount = Number(row.coneCount || row.totalCones || 0);
      const netWeight = Number(row.netWeight ?? row.grossWeight ?? 0);
      const grossWeight = Number(row.grossWeight ?? 0);

      return {
        ...row,
        lotNo,
        itemId: issue?.itemId || lotMeta?.itemId || '',
        itemName: lotMeta?.itemName || '—',
        firmId: lotMeta?.firmId || '',
        firmName: lotMeta?.firmName || '—',
        supplierId: lotMeta?.supplierId || '',
        supplierName: lotMeta?.supplierName || '—',
        coneCount,
        netWeight,
        grossWeight,
        coneType: row.coneType?.name || row.coneTypeName || '—',
        boxName: row.box?.name || '—',
        machineName: machineName || '—',
        operatorName: row.operator?.name || '—',
        date: row.date || row.createdAt || '',
        statusType: coneCount > 0 ? 'active' : 'inactive',
      };
    });
  }, [db.receive_from_coning_machine_rows, issueMap, lotMetaMap, db.machines]);

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
      existing.totalCones += row.coneCount;
      existing.totalWeight += row.netWeight;
      map.set(lotNo, existing);
    });
    return Array.from(map.values()).map((lot) => ({
      ...lot,
      statusType: lot.totalCones > 0 ? 'active' : 'inactive',
      date: lot.rows?.[0]?.date || '',
    }));
  }, [coningRows]);

  const filteredLots = useMemo(() => {
    return coningLots.filter((lot) => {
      if (search) {
        const s = search.toLowerCase();
        const hit = [lot.lotNo, lot.itemName, lot.firmName, lot.supplierName].some(v => (v || '').toLowerCase().includes(s));
        if (!hit) return false;
      }
      if (filters.item && lot.itemId !== filters.item) return false;
      if (filters.firm && lot.firmId !== filters.firm) return false;
      if (filters.supplier && lot.supplierId !== filters.supplier) return false;
      if (filters.from && lot.date < filters.from) return false;
      if (filters.to && lot.date > filters.to) return false;
      if (filters.status !== 'all' && lot.statusType !== filters.status) return false;
      return true;
    }).sort((a,b) => (a.lotNo || '').localeCompare(b.lotNo || ''));
  }, [coningLots, filters, search]);

  const displayLots = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = `${lot.itemId || ''}::${lot.firmId || ''}`;
      const existing = map.get(key) || {
        lotNo: '', // grouped rows show dash for lot
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
      };
      existing.totalCones += lot.totalCones;
      existing.totalWeight += lot.totalWeight;
      existing.statusType = existing.totalCones > 0 ? 'active' : 'inactive';
      existing.rows = [];
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
                    <TableHead>Firm / Supplier</TableHead>
                    <TableHead className="">Cones</TableHead>
                    <TableHead className="">Net Weight</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {displayLots.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No coning stock found.</TableCell></TableRow>
                ) : (
                    displayLots.map((lot) => {
                        const isExpanded = !groupBy && expandedLot === lot.lotNo;
                        return (
                            <React.Fragment key={lot.lotNo}>
                                <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : lot.lotNo)}>
                                    <TableCell>
                                        {!groupBy && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                                    </TableCell>
                                    <TableCell className="font-medium">{groupBy ? '—' : (lot.lotNo || '—')}</TableCell>
                                    <TableCell>{lot.itemName}</TableCell>
                                    <TableCell>
                                      {lot.firmName}
                                      <div className="text-xs text-muted-foreground">{lot.supplierName}</div>
                                    </TableCell>
                                    <TableCell className="">{lot.totalCones}</TableCell>
                                    <TableCell className="">{formatKg(lot.totalWeight)}</TableCell>
                                </TableRow>
                                {isExpanded && (
                                    <TableRow className="bg-muted/30">
                                        <TableCell colSpan={6} className="p-4">
                                            <div className="border rounded-md bg-background">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Barcode</TableHead>
                                                            <TableHead>Date</TableHead>
                                                            <TableHead>Box</TableHead>
                                                            <TableHead>Cone Type</TableHead>
                                                            <TableHead className="">Cones</TableHead>
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
                                                                <TableCell>{row.date || '—'}</TableCell>
                                                                <TableCell>{row.boxName}</TableCell>
                                                                <TableCell>{row.coneType}</TableCell>
                                                                <TableCell className="">{row.coneCount}</TableCell>
                                                                <TableCell className="">{formatKg(row.netWeight)}{row.grossWeight ? ` / ${formatKg(row.grossWeight)}` : ''}</TableCell>
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
  );
}
