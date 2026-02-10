import React, { useState, useMemo, useEffect } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, todayISO, uid } from '../../utils';
import * as api from '../../api';

export function ManualReceiveForm() {
    const { db, refreshProcessData } = useInventory();
    const [lotNo, setLotNo] = useState('');
    const [pieceId, setPieceId] = useState('');
    const [bobbinId, setBobbinId] = useState('');
    const [boxId, setBoxId] = useState('');
    const [bobbinQty, setBobbinQty] = useState('');
    const [grossWeight, setGrossWeight] = useState('');
    const [operatorId, setOperatorId] = useState('');
    const [receiveDate, setReceiveDate] = useState(todayISO());
    const [cart, setCart] = useState([]);
    const [saving, setSaving] = useState(false);

    // Options
    const issuedPieceIds = useMemo(() => {
        const set = new Set();
        (db.issue_to_cutter_machine || []).forEach(record => {
            const list = Array.isArray(record.pieceIds) ? record.pieceIds : String(record.pieceIds || '').split(',').map(id => id.trim()).filter(Boolean);
            list.forEach(id => set.add(id));
        });
        return set;
    }, [db.issue_to_cutter_machine]);

    const lotOptions = useMemo(() => {
        const relevantLots = new Set();
        db.inbound_items.forEach(i => {
            if (issuedPieceIds.has(i.id)) relevantLots.add(i.lotNo);
        });
        return db.lots.filter(l => relevantLots.has(l.lotNo)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [db.lots, db.inbound_items, issuedPieceIds]);

    const pieceOptions = useMemo(() => {
        if (!lotNo) return [];
        return db.inbound_items.filter(i => i.lotNo === lotNo && issuedPieceIds.has(i.id));
    }, [db.inbound_items, lotNo, issuedPieceIds]);

    // Helpers
    const selectedBobbin = db.bobbins.find(b => b.id === bobbinId);
    const selectedBox = db.boxes.find(b => b.id === boxId);

    const netWeight = useMemo(() => {
        const g = Number(grossWeight);
        const qty = Number(bobbinQty);
        if (!g || !qty || !selectedBobbin || !selectedBox) return 0;
        const tare = (selectedBox.weight || 0) + (selectedBobbin.weight || 0) * qty;
        return Math.max(0, g - tare);
    }, [grossWeight, bobbinQty, selectedBobbin, selectedBox]);

    function handleAdd() {
        if (!lotNo || !pieceId || !bobbinId || !boxId || !bobbinQty || !grossWeight || !operatorId) return;
        setCart(prev => [...prev, {
            id: uid(),
            lotNo, pieceId, bobbinId, boxId, bobbinQty, grossWeight, operatorId, receiveDate,
            netWeight,
            operatorName: db.operators.find(o => o.id === operatorId)?.name,
            bobbinName: selectedBobbin?.name,
            boxName: selectedBox?.name
        }]);
        // Reset fields
        setGrossWeight('');
        setBobbinQty('');
    }

    async function handleSave() {
        if (cart.length === 0) return;
        setSaving(true);
        try {
            for (const entry of cart) {
                await api.manualReceiveFromMachine({
                    pieceId: entry.pieceId,
                    lotNo: entry.lotNo,
                    bobbinId: entry.bobbinId,
                    boxId: entry.boxId,
                    bobbinQuantity: Number(entry.bobbinQty),
                    operatorId: entry.operatorId,
                    grossWeight: Number(entry.grossWeight),
                    receiveDate: entry.receiveDate
                });
            }
            // Manual receive here maps to cutter receive; refresh only the cutter process module.
            await refreshProcessData('cutter');
            setCart([]);
            alert('Received successfully');
        } catch (e) {
            alert(e.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardHeader><CardTitle>Manual Entry</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <Label>Date</Label>
                        <Input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} />
                    </div>
                    <div>
                        <Label>Lot</Label>
                        <Select value={lotNo} onChange={e => { setLotNo(e.target.value); setPieceId(''); }}>
                            <option value="">Select Lot</option>
                            {lotOptions.map(l => <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Piece</Label>
                        <Select value={pieceId} onChange={e => setPieceId(e.target.value)}>
                            <option value="">Select Piece</option>
                            {pieceOptions.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Operator</Label>
                        <Select value={operatorId} onChange={e => setOperatorId(e.target.value)}>
                            <option value="">Select Operator</option>
                            {(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </Select>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <Label>Bobbin Type</Label>
                        <Select value={bobbinId} onChange={e => setBobbinId(e.target.value)}>
                            <option value="">Select Bobbin</option>
                            {db.bobbins.map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Box Type</Label>
                        <Select value={boxId} onChange={e => setBoxId(e.target.value)}>
                            <option value="">Select Box</option>
                            {(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'cutter').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Bobbin Qty</Label>
                        <Input type="number" value={bobbinQty} onChange={e => setBobbinQty(e.target.value)} />
                    </div>
                    <div>
                        <Label>Gross Weight</Label>
                        <Input type="number" value={grossWeight} onChange={e => setGrossWeight(e.target.value)} />
                    </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                    <div className="text-sm font-medium">Calculated Net Weight: {formatKg(netWeight)}</div>
                    <Button onClick={handleAdd} disabled={!netWeight}>Add to Cart</Button>
                </div>

                {cart.length > 0 && (
                    <div className="mt-4 border rounded-md overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Piece</TableHead>
                                    <TableHead>Details</TableHead>
                                    <TableHead className="">Net Weight</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cart.map((entry, i) => (
                                    <TableRow key={entry.id}>
                                        <TableCell>{entry.pieceId}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {entry.bobbinQty} x {entry.bobbinName} in {entry.boxName}
                                        </TableCell>
                                        <TableCell className="">{formatKg(entry.netWeight)}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => setCart(c => c.filter(x => x.id !== entry.id))} className="h-6 w-6 text-destructive">
                                                x
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <div className="p-4 flex justify-end bg-muted/50">
                            <Button onClick={handleSave} disabled={saving}>Save {cart.length} Entries</Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
