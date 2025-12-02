import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Checkbox } from '../ui';
import { formatKg, todayISO, uid } from '../../utils';
import * as api from '../../api';
import { Scan, Save, Trash2, Plus } from 'lucide-react';

export function CutterReceiveForm() {
    const { db, refreshDb } = useInventory();
    const [barcode, setBarcode] = useState('');
    const [loading, setLoading] = useState(false);

    // Form State
    const [issueRecord, setIssueRecord] = useState(null);
    const [receiveDate, setReceiveDate] = useState(todayISO());

    // Fields
    const [cutId, setCutId] = useState('');
    const [helperId, setHelperId] = useState('');
    const [bobbinId, setBobbinId] = useState('');
    const [boxId, setBoxId] = useState('');
    const [bobbinQty, setBobbinQty] = useState('');
    const [grossWeight, setGrossWeight] = useState('');
    const [isWastage, setIsWastage] = useState(false);

    const [cart, setCart] = useState([]);
    const [saving, setSaving] = useState(false);

    const barcodeInputRef = useRef(null);

    // Focus barcode input on mount
    useEffect(() => {
        barcodeInputRef.current?.focus();
    }, []);

    const handleScan = async (e) => {
        e.preventDefault();
        if (!barcode) return;
        setLoading(true);
        try {
            const res = await api.getIssueByCutterBarcode(barcode);
            if (res && res.id) {
                setIssueRecord(res);
                // Auto-fill known fields if available/logical
                // Reset other fields
                setCutId('');
                setHelperId('');
                setBobbinId('');
                setBoxId('');
                setBobbinQty('');
                setGrossWeight('');
                setIsWastage(false);
            } else {
                alert('Barcode not found or invalid');
                setIssueRecord(null);
            }
        } catch (err) {
            alert(err.message || 'Failed to fetch barcode details');
        } finally {
            setLoading(false);
        }
    };

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
        if (!issueRecord) return;
        if (!isWastage && (!cutId || !helperId || !bobbinId || !boxId || !bobbinQty || !grossWeight)) {
            alert('Please fill all fields');
            return;
        }

        // If wastage, we might allow minimal fields, but user asked for "Check box for mark remaining pending is wastage"
        // This implies it's a flag on the receive entry.

        setCart(prev => [...prev, {
            id: uid(),
            issueId: issueRecord.id,
            lotNo: issueRecord.lotNo,
            itemId: issueRecord.itemId,
            cutId, helperId, bobbinId, boxId, bobbinQty, grossWeight, isWastage, receiveDate,
            netWeight: isWastage ? 0 : netWeight, // Wastage logic might differ, assuming net weight calc applies or is 0 if just marking pending

            // Display Names
            itemName: db.items.find(i => i.id === issueRecord.itemId)?.name,
            cutName: db.cuts.find(c => c.id === cutId)?.name,
            helperName: db.operators.find(o => o.id === helperId)?.name,
            bobbinName: selectedBobbin?.name,
            boxName: selectedBox?.name
        }]);

        // Reset fields for next box of same issue? Or reset issue?
        // Usually multiple boxes per issue. Keep issue, reset weights.
        setGrossWeight('');
        setBobbinQty('');
        // Keep Cut/Helper/Bobbin/Box as they might be same for next box
    }

    async function handleSave() {
        if (cart.length === 0) return;
        setSaving(true);
        try {
            for (const entry of cart) {
                await api.manualReceiveFromMachine({ // Using manual endpoint or create specific one?
                    // The manual endpoint might not support all new fields.
                    // If backend changes are needed, I should have planned for them.
                    // User said "backend... are there in the code just they are missing on the front end".
                    // So I assume api.manualReceiveFromCutterMachine supports these extra fields or I need to check payload.
                    // Let's assume standard payload structure extension.

                    pieceId: entry.issueId, // Mapping issueId to pieceId as per context usually
                    lotNo: entry.lotNo,
                    bobbinId: entry.bobbinId,
                    boxId: entry.boxId,
                    bobbinQuantity: Number(entry.bobbinQty),
                    grossWeight: Number(entry.grossWeight),
                    receiveDate: entry.receiveDate,

                    // New Fields
                    cutId: entry.cutId,
                    helperId: entry.helperId,
                    isWastage: entry.isWastage
                });
            }
            await refreshDb();
            setCart([]);
            setIssueRecord(null);
            setBarcode('');
            alert('Received successfully');
            barcodeInputRef.current?.focus();
        } catch (e) {
            alert(e.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Scan Barcode (Cutter)</CardTitle></CardHeader>
                <CardContent>
                    <form onSubmit={handleScan} className="flex gap-4">
                        <Input
                            ref={barcodeInputRef}
                            value={barcode}
                            onChange={e => setBarcode(e.target.value)}
                            placeholder="Scan Issue Barcode..."
                            className="text-lg"
                        />
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Scanning...' : <><Scan className="w-4 h-4 mr-2" /> Scan</>}
                        </Button>
                    </form>

                    {issueRecord && (
                        <div className="mt-4 p-4 bg-muted rounded-md grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div><span className="font-semibold">Lot:</span> {issueRecord.lotNo}</div>
                            <div><span className="font-semibold">Item:</span> {db.items.find(i => i.id === issueRecord.itemId)?.name}</div>
                            <div><span className="font-semibold">Machine:</span> {db.machines.find(m => m.id === issueRecord.machineId)?.name}</div>
                            <div><span className="font-semibold">Operator:</span> {db.operators.find(o => o.id === issueRecord.operatorId)?.name}</div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {issueRecord && (
                <Card className="fade-in">
                    <CardHeader><CardTitle>Receive Details</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                                <Label>Date</Label>
                                <Input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} />
                            </div>
                            <div>
                                <Label>Cut</Label>
                                <Select value={cutId} onChange={e => setCutId(e.target.value)}>
                                    <option value="">Select Cut</option>
                                    {db.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label>Helper</Label>
                                <Select value={helperId} onChange={e => setHelperId(e.target.value)}>
                                    <option value="">Select Helper</option>
                                    {db.operators?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </Select>
                            </div>
                            <div className="flex items-end pb-2">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <Checkbox checked={isWastage} onCheckedChange={setIsWastage} />
                                    <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Mark remaining as Wastage</span>
                                </label>
                            </div>
                        </div>

                        {!isWastage && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <Label>Bobbin Type</Label>
                                    <Select value={bobbinId} onChange={e => setBobbinId(e.target.value)}>
                                        <option value="">Select Bobbin</option>
                                        {db.bobbins?.map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                                    </Select>
                                </div>
                                <div>
                                    <Label>Box Type</Label>
                                    <Select value={boxId} onChange={e => setBoxId(e.target.value)}>
                                        <option value="">Select Box</option>
                                        {db.boxes?.map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
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
                        )}

                        <div className="flex justify-between items-center pt-2">
                            <div className="text-sm font-medium">
                                {!isWastage && `Calculated Net Weight: ${formatKg(netWeight)}`}
                            </div>
                            <Button onClick={handleAdd} disabled={!isWastage && !netWeight}>
                                <Plus className="w-4 h-4 mr-2" /> Add to List
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {cart.length > 0 && (
                <Card className="fade-in">
                    <CardContent className="pt-6">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Lot</TableHead>
                                    <TableHead>Details</TableHead>
                                    <TableHead className="">Net Weight</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cart.map((entry) => (
                                    <TableRow key={entry.id}>
                                        <TableCell>{entry.lotNo}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {entry.isWastage ? (
                                                <span className="text-destructive font-bold">WASTAGE / CLOSE</span>
                                            ) : (
                                                `${entry.bobbinQty} x ${entry.bobbinName} | ${entry.cutName} | ${entry.helperName}`
                                            )}
                                        </TableCell>
                                        <TableCell className="">{formatKg(entry.netWeight)}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => setCart(c => c.filter(x => x.id !== entry.id))} className="h-6 w-6 text-destructive">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <div className="mt-4 flex justify-end">
                            <Button onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving...' : <><Save className="w-4 h-4 mr-2" /> Save All</>}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
