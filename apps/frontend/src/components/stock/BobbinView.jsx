import React, { useMemo, useState } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Card, Badge, Button, Input } from '../ui';
import { formatKg, aggregateLots } from '../../utils';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';

export function BobbinView({ db, filters }) {
  const [expandedLot, setExpandedLot] = useState(null);
  const [isSummary, setIsSummary] = useState(false);

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
        if (filters.item && l.itemId !== filters.item) return false;
        if (filters.firm && l.firmId !== filters.firm) return false;
        if (filters.supplier && l.supplierId !== filters.supplier) return false;
        if (filters.from && l.date < filters.from) return false;
        if (filters.to && l.date > filters.to) return false;
        
        if (filters.status === 'active' && l.availableBobbins <= 0) return false;
        if (filters.status === 'inactive' && l.availableBobbins > 0) return false;
        
        return true;
    }).sort((a, b) => (a.lotNo || '').localeCompare(b.lotNo || ''));
  }, [bobbinLots, filters]);

  const displayData = isSummary ? aggregateLots(filteredLots) : filteredLots;

  return (
    <div className="space-y-4">
        <div className="flex justify-end">
             <label className="flex items-center gap-2 text-sm cursor-pointer bg-muted px-3 py-1 rounded-md">
                <input type="checkbox" checked={isSummary} onChange={e=>setIsSummary(e.target.checked)} className="rounded border-gray-300" />
                Group by Item/Firm
             </label>
        </div>

        <div className="rounded-md border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[30px]"></TableHead>
                        <TableHead>Lot No</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Firm</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Bobbins (Avail/Total)</TableHead>
                        <TableHead className="text-right">Weight (Avail/Total)</TableHead>
                        <TableHead className="text-right">Crates</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {displayData.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-4 text-muted-foreground">No bobbin stock found.</TableCell></TableRow>
                    ) : (
                        displayData.map((l, idx) => {
                            const isExpanded = expandedLot === l.lotNo;
                            const rowKey = l.lotNo || idx;
                            return (
                                <React.Fragment key={rowKey}>
                                    <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => !isSummary && setExpandedLot(isExpanded ? null : l.lotNo)}>
                                        <TableCell>
                                            {!isSummary && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                                        </TableCell>
                                        <TableCell className="font-medium">{isSummary ? '—' : l.lotNo}</TableCell>
                                        <TableCell>{l.itemName}</TableCell>
                                        <TableCell>{l.firmName}</TableCell>
                                        <TableCell>{l.supplierName}</TableCell>
                                        <TableCell className="text-right">{l.availableBobbins} / {l.totalBobbins}</TableCell>
                                        <TableCell className="text-right">{formatKg(l.availableWeight)} / {formatKg(l.totalWeight)}</TableCell>
                                        <TableCell className="text-right">{l.crates?.length || l.crateCount}</TableCell>
                                    </TableRow>
                                    {isExpanded && !isSummary && (
                                        <TableRow className="bg-muted/30">
                                            <TableCell colSpan={8} className="p-4">
                                                <div className="border rounded-md bg-background">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead>Barcode</TableHead>
                                                                <TableHead>Date</TableHead>
                                                                <TableHead>Bobbin Type</TableHead>
                                                                <TableHead className="text-right">Bobbins (Avail)</TableHead>
                                                                <TableHead className="text-right">Weight (Avail)</TableHead>
                                                                <TableHead>Operator</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {l.crates.map(c => (
                                                                <TableRow key={c.id}>
                                                                    <TableCell className="font-mono text-xs">{c.barcode}</TableCell>
                                                                    <TableCell>{c.date}</TableCell>
                                                                    <TableCell>{c.bobbinName}</TableCell>
                                                                    <TableCell className="text-right">{c.availableBobbins} / {c.bobbinQty}</TableCell>
                                                                    <TableCell className="text-right">{formatKg(c.availableWeight)} / {formatKg(c.netWeight)}</TableCell>
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