import React, { useState, useMemo, useEffect } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Badge, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, todayISO } from '../../utils';
import { Search, QrCode } from 'lucide-react';
import * as api from '../../api';

export function IssueToCutter() {
  const { db, createIssueToMachine, refreshing, loading } = useInventory();
  
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [machineId, setMachineId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [barcodeScan, setBarcodeScan] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);

  // Filtered Lots
  const lots = db?.lots || [];
  const inboundItems = db?.inbound_items || [];
  const issueToCutterRows = db?.issue_to_cutter_machine || [];

  const candidateLots = useMemo(() => {
    if (!itemId) return [];
    return lots
        .filter(l => l.itemId === itemId)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [itemId, lots]);

  // Available Pieces
  const availablePieces = useMemo(() => {
      if (!lotNo) return [];
      return inboundItems
        .filter(ii => ii.lotNo===lotNo && ii.itemId===itemId && ii.status==='available')
        .sort((a,b)=> a.seq - b.seq);
  }, [inboundItems, lotNo, itemId]);

  // Last Issue Info
  const lastIssueForLot = useMemo(() => {
    if (!lotNo) return null;
    const rows = issueToCutterRows
        .filter(record => record.lotNo === lotNo)
        .sort((a,b)=> b.date.localeCompare(a.date));
    return rows[0] || null;
  }, [issueToCutterRows, lotNo]);

  // Handlers
  async function handleScan(e) {
      e.preventDefault();
      if (!barcodeScan.trim()) return;
      setScanLoading(true);
      try {
          const piece = await api.getInboundByBarcode(barcodeScan.trim());
          if (!piece) throw new Error('Barcode not found');
          if (piece.status !== 'available') throw new Error('Piece is not available');
          
          // Auto-select context
          if (itemId !== piece.itemId) setItemId(piece.itemId);
          if (lotNo !== piece.lotNo) setLotNo(piece.lotNo);
          
          setSelected(prev => prev.includes(piece.id) ? prev : [...prev, piece.id]);
      } catch (err) {
          alert(err.message);
      } finally {
          setScanLoading(false);
          setBarcodeScan('');
      }
  }

  async function handleIssue() {
      if (!date || !itemId || !lotNo || !machineId || !operatorId || selected.length===0) return;
      setIssuing(true);
      try {
          const payload = { date, itemId, lotNo, pieceIds: selected, note, machineId, operatorId };
          await createIssueToMachine(payload);
          setSelected([]);
          setNote("");
          alert(`Issued ${selected.length} pieces successfully.`);
      } catch (e) {
          alert(e.message);
      } finally {
          setIssuing(false);
      }
  }

  function toggle(id) {
      setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  if (loading || !db) {
    return (
      <div className="flex justify-center py-8 text-muted-foreground text-sm">
        Loading inventory data...
      </div>
    );
  }

  return (
    <div className="space-y-6">
        <Card>
            <CardHeader><CardTitle>Issue Parameters</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <Label>Date</Label>
                        <Input type="date" value={date} onChange={e=>setDate(e.target.value)} />
                    </div>
                    <div>
                        <Label>Item</Label>
                        <Select value={itemId} onChange={e=>setItemId(e.target.value)}>
                            <option value="">Select Item</option>
                            {db.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Lot</Label>
                        <Select value={lotNo} onChange={e=>setLotNo(e.target.value)}>
                            <option value="">Select Lot</option>
                            {candidateLots.map(l => <option key={l.lotNo} value={l.lotNo}>{l.lotNo} ({l.date})</option>)}
                        </Select>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <Label>Machine</Label>
                        <Select value={machineId} onChange={e=>setMachineId(e.target.value)}>
                            <option value="">Select Machine</option>
                            {db.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Operator</Label>
                        <Select value={operatorId} onChange={e=>setOperatorId(e.target.value)}>
                            <option value="">Select Operator</option>
                            {db.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Note</Label>
                        <Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional" />
                    </div>
                </div>
            </CardContent>
        </Card>

        <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-6">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex justify-between items-center">
                            <span>Select Pieces</span>
                            <form onSubmit={handleScan} className="flex gap-2 w-64">
                                <div className="relative flex-1">
                                    <QrCode className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input 
                                        placeholder="Scan Barcode" 
                                        className="pl-8 h-9" 
                                        value={barcodeScan} 
                                        onChange={e=>setBarcodeScan(e.target.value)} 
                                        disabled={scanLoading}
                                    />
                                </div>
                                <Button size="sm" type="submit" disabled={scanLoading}>Add</Button>
                            </form>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex justify-between items-center mb-2">
                            <div className="text-xs text-muted-foreground">
                                {selected.length} selected / {availablePieces.length} available
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" variant="ghost" onClick={()=>setSelected(availablePieces.map(p=>p.id))}>All</Button>
                                <Button size="sm" variant="ghost" onClick={()=>setSelected([])}>None</Button>
                            </div>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[40px]"></TableHead>
                                        <TableHead>ID</TableHead>
                                        <TableHead className="">Weight</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {availablePieces.length === 0 ? (
                                        <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No pieces available in this lot.</TableCell></TableRow>
                                    ) : availablePieces.map(p => (
                                        <TableRow key={p.id} onClick={()=>toggle(p.id)} className="cursor-pointer hover:bg-muted/50">
                                            <TableCell>
                                                <input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)} className="rounded border-gray-300 text-primary focus:ring-primary" />
                                            </TableCell>
                                            <TableCell className="font-mono">{p.id}</TableCell>
                                            <TableCell className="">{formatKg(p.weight)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button onClick={handleIssue} disabled={issuing || selected.length === 0 || refreshing}>
                                {issuing ? 'Issuing...' : `Issue ${selected.length} Pieces`}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="w-full md:w-1/3">
                 <Card>
                    <CardHeader><CardTitle className="text-base">Last Issue</CardTitle></CardHeader>
                    <CardContent>
                        {lastIssueForLot ? (
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between border-b pb-2">
                                    <span className="text-muted-foreground">Date</span>
                                    <span>{lastIssueForLot.date}</span>
                                </div>
                                <div className="flex justify-between border-b pb-2">
                                    <span className="text-muted-foreground">Pieces</span>
                                    <span>{lastIssueForLot.count}</span>
                                </div>
                                <div className="flex justify-between border-b pb-2">
                                    <span className="text-muted-foreground">Total Weight</span>
                                    <span>{formatKg(lastIssueForLot.totalWeight)}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block mb-1">Piece IDs</span>
                                    <div className="flex flex-wrap gap-1">
                                        {(lastIssueForLot.pieceIds || []).slice(0, 10).map(id => (
                                            <Badge key={id} variant="outline" className="font-mono text-[10px]">{id}</Badge>
                                        ))}
                                        {(lastIssueForLot.pieceIds?.length || 0) > 10 && (
                                            <span className="text-xs text-muted-foreground">+{lastIssueForLot.pieceIds.length - 10} more</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground text-center py-4">
                                No previous issues for this lot.
                            </div>
                        )}
                    </CardContent>
                 </Card>
            </div>
        </div>
    </div>
  );
}
