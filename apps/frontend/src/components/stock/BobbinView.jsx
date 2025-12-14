import React, { useMemo, useState, useEffect } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function BobbinView({ db, filters, search = '', groupBy = false }) {
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
    return (db.receive_from_cutter_machine_rows || []).map((row) => {
      const piece = row?.pieceId ? inboundPieceMap.get(row.pieceId) : null;
      const lotNo = row?.lotNo || piece?.lotNo || '';
      const lotMeta = lotNo ? lotMetaMap.get(lotNo) : null;
      
      const bobbinQty = Number(row?.bobbinQuantity || 0);
      const issuedBobbins = Number(row?.issuedBobbins || 0);
      const availableBobbins = Math.max(0, bobbinQty - issuedBobbins);
      
      const netWeight = Number(row?.netWt ?? row?.totalKg ?? row?.yarnWt ?? 0);
      const issuedWeight = Number(row?.issuedBobbinWeight || 0);
      const availableWeight = Number.isFinite(netWeight) ? Math.max(0, netWeight - issuedWeight) : 0;

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
        bobbinQty,
        issuedBobbins,
        availableBobbins,
        netWeight,
        issuedWeight,
        availableWeight,
        bobbinName: row.bobbin?.name || row.pcsTypeName || '—',
      };
    });
  }, [db.receive_from_cutter_machine_rows, inboundPieceMap, lotMetaMap]);

  // 4. Aggregate into Lots
  const bobbinLots = useMemo(() => {
    const map = new Map();
    bobbinCrates.forEach((crate) => {
      const lotNo = crate.lotNo || '(No Lot)';
      const existing = map.get(lotNo) || {
        lotNo,
        date: crate.date || '',
        itemId: crate.itemId,
        firmId: crate.firmId,
        supplierId: crate.supplierId,
        itemName: crate.itemName,
        firmName: crate.firmName,
        supplierName: crate.supplierName,
        totalBobbins: 0,
        issuedBobbins: 0,
        availableBobbins: 0,
        totalWeight: 0,
        issuedWeight: 0,
        availableWeight: 0,
        crates: [],
      };
      
      existing.crates.push(crate);
      existing.totalBobbins += crate.bobbinQty;
      existing.issuedBobbins += crate.issuedBobbins;
      existing.availableBobbins += crate.availableBobbins;
      existing.totalWeight += crate.netWeight;
      existing.issuedWeight += crate.issuedWeight;
      existing.availableWeight += crate.availableWeight;
      
      map.set(lotNo, existing);
    });
    return Array.from(map.values());
  }, [bobbinCrates]);

  // 5. Filter & Sort
  const filteredLots = useMemo(() => {
    return bobbinLots.filter(l => {
        if (search) {
          const s = search.toLowerCase();
          const hit = [l.lotNo, l.itemName, l.firmName, l.supplierName].some(v => (v || '').toLowerCase().includes(s));
          if (!hit) return false;
        }
        if (filters.item && l.itemId !== filters.item) return false;
        if (filters.firm && l.firmId !== filters.firm) return false;
        if (filters.supplier && l.supplierId !== filters.supplier) return false;
        if (filters.from && l.date < filters.from) return false;
        if (filters.to && l.date > filters.to) return false;
        
        if (filters.status === 'active' && l.availableBobbins <= 0) return false;
        if (filters.status === 'inactive' && l.availableBobbins > 0) return false;
        
        return true;
    }).sort((a, b) => (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true }));
  }, [bobbinLots, filters, search]);

  const displayData = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = `${lot.itemId || ''}`;
      const existing = map.get(key) || {
        lotNo: '', // display dash for grouped rows
        itemId: lot.itemId,
        itemName: lot.itemName,
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
        statusType: lot.availableBobbins > 0 ? 'active' : 'inactive',
      };
      existing.totalBobbins += lot.totalBobbins;
      existing.issuedBobbins += lot.issuedBobbins;
      existing.availableBobbins += lot.availableBobbins;
      existing.totalWeight += lot.totalWeight;
      existing.issuedWeight += lot.issuedWeight;
      existing.availableWeight += lot.availableWeight;
      existing.crateCount += lot.crateCount || lot.crates?.length || 0;
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [filteredLots, groupBy]);

  return (
        <div className="space-y-4">
        <div className="rounded-md border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[30px]"></TableHead>
                        <TableHead>Lot No</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Item</TableHead>
                        {!groupBy ? <TableHead>Firm</TableHead> : null}
                        <TableHead className={groupBy ? "bg-primary/10 text-primary" : ""}>Supplier</TableHead>
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
                            const rowKey = l.lotNo || idx;
                            return (
                                <React.Fragment key={rowKey}>
                                    <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => !groupBy && setExpandedLot(isExpanded ? null : l.lotNo)}>
                                        <TableCell>
                                            {!groupBy && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                                        </TableCell>
                                        <TableCell className="font-medium">{groupBy ? '—' : (l.lotNo || '—')}</TableCell>
                                        <TableCell>{formatDateDDMMYYYY(l.date) || '—'}</TableCell>
                                        <TableCell>{l.itemName}</TableCell>
                                        {!groupBy ? <TableCell>{l.firmName}</TableCell> : null}
                                        <TableCell className={groupBy ? "bg-primary/5 font-medium" : ""}>{l.supplierName}</TableCell>
                                        <TableCell className="">{l.availableBobbins} / {l.totalBobbins}</TableCell>
                                        <TableCell className="">{formatKg(l.availableWeight)} / {formatKg(l.totalWeight)}</TableCell>
                                        <TableCell className="">{l.crates?.length || l.crateCount}</TableCell>
                                    </TableRow>
                                    {isExpanded && !groupBy && (
                                        <TableRow className="bg-muted/30">
                                            <TableCell colSpan={9} className="p-4">
                                                <div className="border rounded-md bg-background">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead>Barcode</TableHead>
                                                                <TableHead>Date</TableHead>
                                                                <TableHead>Bobbin Type</TableHead>
                                                                <TableHead className="">Bobbins (Avail)</TableHead>
                                                                <TableHead className="">Weight (Avail)</TableHead>
                                                                <TableHead>Operator</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {l.crates.map(c => (
                                                                <TableRow key={c.id}>
                                                                    <TableCell className="font-mono text-xs">{c.barcode}</TableCell>
                                                                    <TableCell>{formatDateDDMMYYYY(c.date) || '—'}</TableCell>
                                                                    <TableCell>{c.bobbinName}</TableCell>
                                                                    <TableCell className="">{c.availableBobbins} / {c.bobbinQty}</TableCell>
                                                                    <TableCell className="">{formatKg(c.availableWeight)} / {formatKg(c.netWeight)}</TableCell>
                                                                    <TableCell>{c.employee || c.operator?.name || '—'}</TableCell>
                                                                </TableRow>
                                                            ))}
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
                </TableBody>
            </Table>
        </div>
    </div>
  );
}
