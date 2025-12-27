import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Checkbox } from '../ui';
import { formatKg, todayISO, uid, formatDateDDMMYYYY } from '../../utils';
import * as api from '../../api';
import { Scan, Save, Trash2, Plus } from 'lucide-react';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, makeReceiveBarcode, parseReceiveCrateIndex } from '../../utils/labelPrint';
import { InfoPopover } from '../common/InfoPopover';
import { CatchWeightButton } from '../common/CatchWeightButton';

export function CutterReceiveForm() {
    const { db, refreshDb } = useInventory();
    const [barcode, setBarcode] = useState('');
    const [loading, setLoading] = useState(false);

    // Form State
    const [issueRecord, setIssueRecord] = useState(null);
    const [receiveDate, setReceiveDate] = useState(todayISO());

    // Fields
    const [cutId, setCutId] = useState('');
    const [shift, setShift] = useState('');
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
                // Auto-fill cut from issue, reset other fields
                setCutId(res.cutId || '');
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

    // Compute inbound weight and total received for the current issue
    const { inboundWeight, totalReceived, totalReceivedBobbins, pendingWeight } = useMemo(() => {
        if (!issueRecord || !issueRecord.pieceIds?.length) return { inboundWeight: 0, totalReceived: 0, totalReceivedBobbins: 0, pendingWeight: 0 };
        const pieceIds = issueRecord.pieceIds;

        // Get inbound weight from inbound_items
        const inboundWt = pieceIds.reduce((sum, pid) => {
            const piece = db.inbound_items?.find(p => p.id === pid);
            return sum + (piece?.weight || 0);
        }, 0);

        // Get totals from piece totals (database)
        let receivedFromDb = 0;
        let wastageFromDb = 0;
        let bobbinsFromDb = 0;

        pieceIds.forEach((pid) => {
            const tot = db.receive_from_cutter_machine_piece_totals?.find(t => t.pieceId === pid);
            receivedFromDb += Number(tot?.totalNetWeight || 0);
            wastageFromDb += Number(tot?.wastageNetWeight || 0);
            bobbinsFromDb += Number(tot?.totalBob || 0);
        });

        // Add cart items' net weights and bobbins for real-time update
        let receivedInCart = 0;
        let bobbinsInCart = 0;

        cart.forEach((entry) => {
            if (pieceIds.includes(entry.pieceId)) {
                receivedInCart += Number(entry.netWeight) || 0;
                bobbinsInCart += Number(entry.bobbinQty) || 0;
            }
        });

        return {
            inboundWeight: inboundWt,
            totalReceived: receivedFromDb + receivedInCart,
            totalReceivedBobbins: bobbinsFromDb + bobbinsInCart,
            pendingWeight: Math.max(0, inboundWt - receivedFromDb - wastageFromDb - receivedInCart)
        };
    }, [issueRecord, db.inbound_items, db.receive_from_cutter_machine_piece_totals, cart]);

    const computeNextBarcode = (pieceId, lotNo, seq) => {
        const existing = (db.receive_from_cutter_machine_rows || []).filter((row) => row.pieceId === pieceId);
        const existingMax = existing.reduce((max, row) => {
            const idx = parseReceiveCrateIndex(row.barcode);
            if (idx != null && idx > max) return idx;
            return max;
        }, 0);
        const inCartCount = cart.filter((c) => c.pieceId === pieceId).length;
        const nextIndex = existingMax + inCartCount + 1;
        return makeReceiveBarcode({ lotNo, seq, crateIndex: nextIndex });
    };

    async function handleAdd() {
        if (!issueRecord) return;

        // Validation: Cut, Bobbin, Box, Qty, Gross Weight are mandatory. Helper and Shift are optional.
        if (!cutId || !bobbinId || !boxId || !bobbinQty || !grossWeight) {
            alert('Please fill all fields (Cut, Bobbin, Box, Qty, Gross Weight)');
            return;
        }

        const pieceIdToUse = issueRecord.pieceIds?.[0];
        if (!pieceIdToUse) {
            alert('No piece ID found in issue record');
            return;
        }

        // Validate bobbin weight is set
        const bobbinWeight = Number(selectedBobbin?.weight);
        if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) {
            alert('Bobbin weight is missing. Please update the bobbin first.');
            return;
        }

        // Validate box weight is set
        const boxWeight = Number(selectedBox?.weight);
        if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
            alert('Box weight is missing. Please update the box first.');
            return;
        }

        // Validate net weight is positive
        if (!Number.isFinite(netWeight) || netWeight <= 0) {
            alert('Computed net weight must be positive. Check weights and quantity.');
            return;
        }

        // Validate net weight doesn't exceed pending weight
        const pieceMeta = db.inbound_items.find((p) => p.id === pieceIdToUse);
        const pieceInboundWeight = Number(pieceMeta?.weight || 0);
        const pieceTotals = db.receive_from_cutter_machine_piece_totals?.find(t => t.pieceId === pieceIdToUse);
        const alreadyReceivedDb = Number(pieceTotals?.totalNetWeight || 0);
        const existingWastage = Number(pieceTotals?.wastageNetWeight || 0);
        // Include cart items for this piece that are not yet saved
        const cartReceivedForPiece = cart.reduce((sum, entry) => {
            if (entry.pieceId === pieceIdToUse) {
                return sum + (Number(entry.netWeight) || 0);
            }
            return sum;
        }, 0);
        const pendingWeight = Math.max(0, pieceInboundWeight - alreadyReceivedDb - existingWastage - cartReceivedForPiece);

        if (pendingWeight <= 0) {
            alert('Piece has no pending weight remaining.');
            return;
        }

        if (netWeight > pendingWeight + 0.001) { // Small tolerance for floating point
            alert(`Net weight (${netWeight.toFixed(3)} kg) exceeds pending weight (${pendingWeight.toFixed(3)} kg).`);
            return;
        }

        const seq = pieceMeta?.seq || Number((pieceMeta?.id || '').split('-').pop());
        const receiveBarcode = computeNextBarcode(pieceIdToUse, issueRecord.lotNo, seq || 0);

        const cutName = db.cuts.find(c => c.id === cutId)?.name;
        const helperName = db.workers.find(o => o.id === helperId)?.name;

        setCart(prev => [...prev, {
            id: uid(),
            issueId: issueRecord.id,
            pieceId: pieceIdToUse,
            lotNo: issueRecord.lotNo,
            itemId: issueRecord.itemId,
            operatorId: issueRecord.operatorId, // Capture operator from issue
            cutId, helperId, shift, bobbinId, boxId, bobbinQty, grossWeight, isWastage, receiveDate,
            netWeight: netWeight,
            barcode: receiveBarcode,

            // Display Names
            itemName: db.items.find(i => i.id === issueRecord.itemId)?.name,
            cutName: cutName,
            cut: cutName,
            helperName: helperName,
            shiftName: shift,
            operatorName: db.workers.find(o => o.id === issueRecord.operatorId)?.name,
            bobbinName: selectedBobbin?.name,
            boxName: selectedBox?.name
        }]);

        const template = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE);
        if (template && receiveBarcode) {
            const confirmPrint = window.confirm('Print sticker for this crate?');
            if (confirmPrint) {
                const itemName = db.items.find(i => i.id === issueRecord.itemId)?.name;
                const machineName = db.machines.find(m => m.id === issueRecord.machineId)?.name;
                const tareWeight = ((selectedBox?.weight || 0) + (selectedBobbin?.weight || 0) * Number(bobbinQty)).toFixed(3);

                await printStageTemplate(
                    LABEL_STAGE_KEYS.CUTTER_RECEIVE,
                    {
                        lotNo: issueRecord.lotNo,
                        itemName,
                        pieceId: pieceIdToUse,
                        barcode: receiveBarcode,
                        netWeight: netWeight,
                        grossWeight,
                        tareWeight,
                        bobbinQty,
                        bobbinName: selectedBobbin?.name,
                        boxName: selectedBox?.name,
                        cut: cutName,
                        cutName,
                        machineName,
                        helperName,
                        operatorName: db.workers.find((o) => o.id === issueRecord.operatorId)?.name,
                        date: receiveDate,
                    },
                    { template },
                );
            }
        }

        // Reset fields for next box
        setGrossWeight('');
        setBobbinQty('');
        setIsWastage(false);
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
                    grossWeight: Number(entry.grossWeight),
                    receiveDate: entry.receiveDate,
                    operatorId: entry.operatorId, // Pass operatorId
                    cutId: entry.cutId,
                    helperId: entry.helperId,
                    shift: entry.shift,
                    isWastage: entry.isWastage
                });

                if (entry.isWastage) {
                    await api.markPieceWastage({ pieceId: entry.pieceId });
                }
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
                        <div className="mt-4 p-4 bg-muted rounded-md grid grid-cols-2 md:grid-cols-8 gap-4 text-sm">
                            <div><span className="font-semibold">Lot:</span> {issueRecord.lotNo}</div>
                            <div><span className="font-semibold">Item:</span> {db.items.find(i => i.id === issueRecord.itemId)?.name}</div>
                            <div><span className="font-semibold">Machine:</span> {db.machines.find(m => m.id === issueRecord.machineId)?.name}</div>
                            <div><span className="font-semibold">Operator:</span> {db.workers.find(o => o.id === issueRecord.operatorId)?.name}</div>
                            <div><span className="font-semibold">Inbound:</span> {formatKg(inboundWeight)}</div>
                            <div>
                                <span className="font-semibold">Received:</span> {formatKg(totalReceived)}
                                <InfoPopover
                                    title="Received Crates"
                                    items={(db.receive_from_cutter_machine_rows || []).filter(row =>
                                        issueRecord?.pieceIds?.includes(row.pieceId)
                                    )}
                                    renderContent={(items) => (
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b">
                                                    <th className="text-left py-1 px-1 font-medium">Barcode</th>
                                                    <th className="text-left py-1 px-1 font-medium">Date</th>
                                                    <th className="text-right py-1 px-1 font-medium">Bobbins</th>
                                                    <th className="text-right py-1 px-1 font-medium">Net Wt</th>
                                                    <th className="text-left py-1 px-1 font-medium">Cut</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {items.map((row, idx) => (
                                                    <tr key={row.id || idx} className="border-b last:border-0">
                                                        <td className="py-1 px-1 font-mono">{row.barcode || '—'}</td>
                                                        <td className="py-1 px-1">{formatDateDDMMYYYY(row.date || row.createdAt) || '—'}</td>
                                                        <td className="py-1 px-1 text-right">{row.bobbinQuantity || 0}</td>
                                                        <td className="py-1 px-1 text-right font-medium">{formatKg(row.netWt)}</td>
                                                        <td className="py-1 px-1">{row.cutMaster?.name || row.cut || '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="border-t-2 bg-muted/50 font-semibold">
                                                    <td className="py-1 px-1" colSpan={2}>Total</td>
                                                    <td className="py-1 px-1 text-right">{items.reduce((sum, row) => sum + (row.bobbinQuantity || 0), 0)}</td>
                                                    <td className="py-1 px-1 text-right">{formatKg(items.reduce((sum, row) => sum + (row.netWt || 0), 0))}</td>
                                                    <td className="py-1 px-1"></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    )}
                                    emptyText="No crates received yet"
                                    widthClassName="w-[420px]"
                                    bodyClassName="max-h-[300px] overflow-y-auto"
                                    buttonClassName="h-5 w-5 rounded-full hover:bg-muted inline-flex ml-1"
                                    align="right"
                                />
                            </div>
                            <div>
                                <span className="font-semibold">Pending:</span> {formatKg(pendingWeight)}
                            </div>
                            <div>
                                <span className="font-semibold">Bobbins:</span> {totalReceivedBobbins}
                            </div>
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
                                <Label>Helper (Optional)</Label>
                                <Select value={helperId} onChange={e => setHelperId(e.target.value)}>
                                    <option value="">Select Helper</option>
                                    {(db.helpers || []).filter(h => h.processType === 'all' || h.processType === 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label>Shift (Optional)</Label>
                                <Select value={shift} onChange={e => setShift(e.target.value)}>
                                    <option value="">Select Shift</option>
                                    <option value="Day">Day</option>
                                    <option value="Night">Night</option>
                                </Select>
                            </div>
                            <div className="flex items-end pb-2">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <Checkbox checked={isWastage} onCheckedChange={setIsWastage} />
                                    <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Mark remaining as Wastage</span>
                                </label>
                            </div>
                        </div>

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
                                    {(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'cutter').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label>Bobbin Qty</Label>
                                <Input type="number" value={bobbinQty} onChange={e => setBobbinQty(e.target.value)} />
                            </div>
                            <div>
                                <Label>Gross Weight</Label>
                                <div className="flex gap-2">
                                    <Input type="number" value={grossWeight} onChange={e => setGrossWeight(e.target.value)} className="flex-1" />
                                    <CatchWeightButton onWeightCaptured={(wt) => setGrossWeight(wt.toFixed(3))} />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center pt-2">
                            <div className="text-sm font-medium">
                                {`Calculated Net Weight: ${formatKg(netWeight)}`}
                            </div>
                            <Button onClick={handleAdd} disabled={!netWeight}>
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
                                                <div>
                                                    {entry.bobbinQty} x {entry.bobbinName}
                                                    {entry.cutName && ` | ${entry.cutName}`}
                                                    {entry.helperName && ` | ${entry.helperName}`}
                                                </div>
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
