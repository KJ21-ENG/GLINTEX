import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api/client';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Label, ActionMenu } from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { formatKg, uid, todayISO, formatDateDDMMYYYY } from '../utils';
import { LABEL_STAGE_KEYS, loadTemplate, printStageTemplate, printStageTemplatesBatch } from '../utils/labelPrint';
import { Trash2, Plus, Save, ArrowUpDown, Search, Printer, Download, Edit2 } from 'lucide-react';
import { exportHistoryToExcel } from '../services';
import { usePermission, useStagePermission } from '../hooks/usePermission';
import AccessDenied from '../components/common/AccessDenied';
import { UserBadge } from '../components/common/UserBadge';

const INBOUND_MODE_OPTIONS = [
    { value: 'raw', label: 'Raw Inbound (Rolls)' },
    { value: 'cutter_purchase', label: 'Cutter Purchase (Bobbins)' },
];

const SHIFT_OPTIONS = [
    { value: 'Day', label: 'Day' },
    { value: 'Night', label: 'Night' },
];

const filterByProcess = (list = [], processKey) => {
    return list.filter(item => !item?.processType || item.processType === 'all' || item.processType === processKey);
};

const round3 = (val) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 1000) / 1000;
};

// Mirror backend helper: infer remaining count from remaining weight so count stays consistent
// even when dispatch/issue operations were recorded by weight only.
const calcAvailableCountFromWeight = ({ totalCount, issuedCount, dispatchedCount, totalWeight, availableWeight }) => {
    const total = Number(totalCount || 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    const issued = Number(issuedCount || 0);
    const dispatched = Number(dispatchedCount || 0);
    const countBased = Math.max(0, total - issued - dispatched);
    const totalWt = Number(totalWeight || 0);
    if (!Number.isFinite(totalWt) || totalWt <= 0) return countBased;
    const availWt = Number(availableWeight || 0);
    if (!Number.isFinite(availWt) || availWt <= 0) return 0;
    const ratio = availWt / totalWt;
    if (!Number.isFinite(ratio) || ratio <= 0) return 0;
    const weightBased = Math.floor((ratio * total) + 1e-6);
    return Math.max(0, Math.min(countBased, weightBased));
};

const EMPTY_CUTTER_ENTRY = {
    bobbinId: '',
    bobbinQuantity: '',
    boxId: '',
    grossWeight: '',
    operatorId: '',
    helperId: '',
    cutId: '',
    shift: '',
    machineId: '',
};


export function Inbound() {
    const { db, createLot, refreshing, ensureModuleData, refreshDb } = useInventory();
    const { canRead, canWrite } = usePermission('inbound');
    const { canRead: canReadCutter, canWrite: canWriteCutter } = useStagePermission('receive', 'cutter');
    const readOnly = canRead && !canWrite;
    const purchaseReadOnly = !canWrite || !canWriteCutter;

    useEffect(() => {
        if (canRead) {
            ensureModuleData('inbound');
        }
    }, [canRead, ensureModuleData]);

    // Form State
    const [mode, setMode] = useState('raw');
    const [date, setDate] = useState(todayISO());
    const [itemId, setItemId] = useState("");
    const [firmId, setFirmId] = useState("");
    const [supplierId, setSupplierId] = useState("");
    const [weight, setWeight] = useState("");
    const [previewLotNo, setPreviewLotNo] = useState("");
    const [previewCutterLotNo, setPreviewCutterLotNo] = useState("");
    const [cart, setCart] = useState([]);
    const [cutterEntry, setCutterEntry] = useState(EMPTY_CUTTER_ENTRY);
    const [cutterCart, setCutterCart] = useState([]);
    const [saving, setSaving] = useState(false);

    const weightRef = useRef(null);

    // Load Preview Sequence
    const fetchSequence = async () => {
        try {
            const res = await api.getLotSequenceNext();
            setPreviewLotNo(res?.next || "");
        } catch (e) {
            console.error("Failed to fetch sequence", e);
        }
    };

    useEffect(() => {
        if (canRead) {
            fetchSequence();
        }
    }, [canRead]);

    const fetchCutterSequence = async () => {
        try {
            const res = await api.getCutterPurchaseSequenceNext();
            setPreviewCutterLotNo(res?.next || "");
        } catch (e) {
            console.error("Failed to fetch cutter purchase sequence", e);
        }
    };

    useEffect(() => {
        if (canReadCutter) {
            fetchCutterSequence();
        }
    }, [canReadCutter]);

    useEffect(() => {
        if (mode === 'cutter_purchase' && !canReadCutter) {
            setMode('raw');
        }
    }, [mode, canReadCutter]);

    const cutterTotals = useMemo(() => {
        return cutterCart.reduce((acc, row) => {
            acc.totalNet += Number(row.netWeight || 0);
            acc.totalBobbinQty += Number(row.bobbinQuantity || 0);
            return acc;
        }, { totalNet: 0, totalBobbinQty: 0 });
    }, [cutterCart]);

    const getBobbin = (id) => db?.bobbins?.find(b => b.id === id);
    const getBox = (id) => db?.boxes?.find(b => b.id === id);
    const getCut = (id) => db?.cuts?.find(c => c.id === id);
    const getOperator = (id) => db?.operators?.find(o => o.id === id);
    const getHelper = (id) => db?.helpers?.find(h => h.id === id);
    const getMachine = (id) => db?.machines?.find(m => m.id === id);

    const calcCutterWeights = (entry) => {
        const bobbin = getBobbin(entry.bobbinId);
        const box = getBox(entry.boxId);
        const bobbinQty = Number(entry.bobbinQuantity || 0);
        const gross = Number(entry.grossWeight || 0);
        const bobbinWeight = Number(bobbin?.weight || 0);
        const boxWeight = Number(box?.weight || 0);
        const tare = bobbinWeight * bobbinQty + boxWeight;
        const net = round3(gross - tare);
        return { net, tare };
    };

    // Validation
    const canAdd = date && itemId && firmId && supplierId && Number(weight) > 0;
    const canSave = cart.length > 0 && date && itemId && firmId && supplierId && !saving;
    const canAddCutter = Boolean(
        date
        && itemId
        && supplierId
        && cutterEntry.cutId
        && cutterEntry.bobbinId
        && cutterEntry.boxId
        && Number(cutterEntry.bobbinQuantity) > 0
        && Number(cutterEntry.grossWeight) > 0
    );
    const canSaveCutter = cutterCart.length > 0 && date && itemId && supplierId && !saving;

    // Handlers
    function addPiece() {
        if (readOnly) return;
        if (!canAdd) return;
        const nextSeq = cart.length + 1;
        setCart([...cart, { seq: nextSeq, tempId: uid("piece"), weight: Number(weight) }]);
        setWeight("");
        setTimeout(() => { try { weightRef.current?.focus(); } catch (e) { } }, 0);
    }

    function removeFromCart(tempId) {
        setCart(cart.filter(c => c.tempId !== tempId).map((c, idx) => ({ ...c, seq: idx + 1 })));
    }

    async function handleSaveLot() {
        if (readOnly) return;
        if (!canSave) return;
        setSaving(true);
        try {
            const pieces = cart.map((row, idx) => ({ seq: idx + 1, weight: Number(row.weight) }));
            const savedLotNo = previewLotNo;
            let result = null;
            try {
                result = await createLot({ date, itemId, firmId, supplierId, pieces });
            } catch (err) {
                if (err && String(err.message || '').toLowerCase().includes('lot already exists')) {
                    await fetchSequence(); // Retry with new sequence
                    result = await createLot({ date, itemId, firmId, supplierId, pieces });
                } else {
                    throw err;
                }
            }

            const refreshedDb = result?.db || db;
            const lotNo = result?.res?.lot?.lotNo || savedLotNo;
            const piecesForLot = (refreshedDb?.inbound_items || []).filter((p) => p.lotNo === lotNo);
            const itemName = refreshedDb?.items?.find((i) => i.id === itemId)?.name;
            const inboundTemplate = await loadTemplate(LABEL_STAGE_KEYS.INBOUND);
            if (inboundTemplate && piecesForLot.length > 0) {
                const confirmPrint = window.confirm(`Print ${piecesForLot.length} stickers for lot ${lotNo}?`);
                if (confirmPrint) {
                    const batchData = piecesForLot.map(piece => ({
                        lotNo,
                        itemName,
                        pieceId: piece.id,
                        seq: piece.seq,
                        weight: piece.weight,
                        barcode: piece.barcode,
                        date,
                    }));
                    await printStageTemplatesBatch(
                        LABEL_STAGE_KEYS.INBOUND,
                        batchData,
                        { template: inboundTemplate },
                    );
                }
            }

            // Success
            const totalPieces = cart.length;
            const totalWeight = cart.reduce((s, r) => s + (Number(r.weight) || 0), 0);

            // Reset
            setCart([]);
            setWeight("");
            setDate(todayISO());
            setItemId("");
            setFirmId("");
            setSupplierId("");
            weightRef.current?.focus();
            fetchSequence();

        } catch (err) {
            alert(err.message || 'Failed to save lot');
        } finally {
            setSaving(false);
        }
    }

    const addCutterCrate = () => {
        if (purchaseReadOnly) return;
        if (!cutterEntry.cutId) {
            alert('Cut is required.');
            return;
        }
        if (!cutterEntry.bobbinId || !cutterEntry.boxId) return;
        const bobbin = getBobbin(cutterEntry.bobbinId);
        const box = getBox(cutterEntry.boxId);
        const bobbinWeight = bobbin?.weight;
        const boxWeight = box?.weight;
        if (bobbinWeight == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
            alert('Bobbin weight missing. Update masters first.');
            return;
        }
        if (boxWeight == null || !Number.isFinite(boxWeight) || boxWeight <= 0) {
            alert('Box weight missing. Update masters first.');
            return;
        }
        const bobbinQty = Number(cutterEntry.bobbinQuantity || 0);
        const gross = Number(cutterEntry.grossWeight || 0);
        if (!bobbinQty || !gross) return;
        const { net, tare } = calcCutterWeights(cutterEntry);
        if (net <= 0) {
            alert('Net weight must be positive.');
            return;
        }

        const newCrate = {
            id: uid('crate'),
            ...cutterEntry,
            bobbinQuantity: bobbinQty,
            grossWeight: gross,
            netWeight: net,
            tareWeight: tare,
        };

        setCutterCart(prev => [...prev, newCrate]);

        setCutterEntry(prev => ({
            ...prev,
            bobbinQuantity: '',
            grossWeight: '',
        }));
    };

    const removeCutterCrate = (crateId) => {
        setCutterCart(prev => prev.filter(row => row.id !== crateId));
    };

    const handleSaveCutterPurchase = async () => {
        if (purchaseReadOnly) return;
        if (!canSaveCutter) return;
        if (cutterCart.some(row => !row.cutId)) {
            alert('Cut is required for every crate.');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                date,
                itemId,
                firmId: firmId || null,
                supplierId,
                crates: cutterCart.map(row => ({
                    bobbinId: row.bobbinId,
                    boxId: row.boxId,
                    bobbinQuantity: Number(row.bobbinQuantity),
                    grossWeight: Number(row.grossWeight),
                    operatorId: row.operatorId || null,
                    helperId: row.helperId || null,
                    cutId: row.cutId,
                    shift: row.shift || null,
                    machineNo: row.machineId ? (getMachine(row.machineId)?.name || '') : null,
                })),
            };
            // Capture item name before async call (db state may be stale after refreshDb)
            const itemName = db.items?.find(i => i.id === itemId)?.name;
            const result = await api.createCutterPurchaseInbound(payload);
            await refreshDb();

            // Print stickers using actual lotNo and barcodes from API response (like Raw Inbound)
            const lotNo = result?.lotNo;
            const rows = result?.rows || [];
            if (rows.length > 0) {
                const cutterTemplate = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE);
                if (cutterTemplate) {
                    const confirmPrint = window.confirm(`Print ${rows.length} sticker(s) for lot ${lotNo}?`);
                    if (confirmPrint) {
                        const batchData = rows.map((row, idx) => {
                            const cartRow = cutterCart[idx];
                            return {
                                lotNo,
                                itemName,
                                pieceId: result.pieceId,
                                barcode: row.barcode,
                                netWeight: cartRow?.netWeight,
                                grossWeight: cartRow?.grossWeight,
                                tareWeight: cartRow?.tareWeight,
                                bobbinQty: cartRow?.bobbinQuantity,
                                bobbinName: getBobbin(cartRow?.bobbinId)?.name,
                                boxName: getBox(cartRow?.boxId)?.name,
                                cut: getCut(cartRow?.cutId)?.name,
                                cutName: getCut(cartRow?.cutId)?.name,
                                operatorName: getOperator(cartRow?.operatorId)?.name,
                                helperName: getHelper(cartRow?.helperId)?.name,
                                shift: cartRow?.shift,
                                machineName: cartRow?.machineId ? getMachine(cartRow.machineId)?.name : null,
                                date,
                            };
                        });
                        await printStageTemplatesBatch(LABEL_STAGE_KEYS.CUTTER_RECEIVE, batchData, { template: cutterTemplate });
                    }
                }
            }

            setCutterCart([]);
            setCutterEntry(EMPTY_CUTTER_ENTRY);
            setDate(todayISO());
            setItemId("");
            setFirmId("");
            setSupplierId("");
            await fetchCutterSequence();
        } catch (err) {
            alert(err.message || 'Failed to save cutter purchase');
        } finally {
            setSaving(false);
        }
    };


    if (!canRead) {
        return (
            <div className="space-y-6 fade-in">
                <h1 className="text-2xl font-bold tracking-tight">Inbound Receiving</h1>
                <AccessDenied message="You do not have access to inbound receiving. Contact an administrator to request access." />
            </div>
        );
    }

    return (
        <div className="space-y-6 fade-in">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <h1 className="text-2xl font-bold tracking-tight">Inbound Receiving</h1>
                {canReadCutter && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full md:w-auto">
                        <Label className="text-xs text-muted-foreground">Mode</Label>
                        <Select
                            value={mode}
                            onChange={e => setMode(e.target.value)}
                            options={INBOUND_MODE_OPTIONS}
                            searchable={false}
                            className="w-full sm:w-auto"
                        />
                    </div>
                )}
            </div>

            {mode === 'raw' && (
                <Card>
                    <CardHeader>
                        <CardTitle>New Lot Entry</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {readOnly && (
                            <div className="mb-3 text-xs text-muted-foreground">
                                Read-only access: you can view inbound data but cannot create or edit lots.
                            </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                            <div className="space-y-2">
                                <Label>Date</Label>
                                <Input type="date" value={date} onChange={e => { setDate(e.target.value); setCart([]); }} disabled={readOnly} />
                            </div>
                            <div className="space-y-2">
                                <Label>Item</Label>
                                <Select value={itemId} onChange={e => setItemId(e.target.value)} disabled={readOnly}>
                                    <option value="">Select Item</option>
                                    {db?.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Firm</Label>
                                <Select value={firmId} onChange={e => setFirmId(e.target.value)} disabled={readOnly}>
                                    <option value="">Select Firm</option>
                                    {db?.firms?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Supplier</Label>
                                <Select value={supplierId} onChange={e => setSupplierId(e.target.value)} disabled={readOnly}>
                                    <option value="">Select Supplier</option>
                                    {db?.suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Lot No (Preview)</Label>
                                <Input value={previewLotNo} readOnly className="bg-muted" />
                            </div>
                            <div className="space-y-2">
                                <Label>Weight (kg)</Label>
                                <Input
                                    ref={weightRef}
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    placeholder="e.g. 1.250"
                                    value={weight}
                                    onChange={e => setWeight(e.target.value)}
                                    disabled={readOnly}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            if (e.shiftKey) { handleSaveLot(); } else { addPiece(); }
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col sm:flex-row justify-between items-end gap-4 sm:gap-0">
                            <div className="flex w-full sm:w-auto gap-2">
                                <Button onClick={addPiece} disabled={!canAdd || readOnly} className="flex-1 sm:flex-none gap-2">
                                    <Plus className="w-4 h-4" /> Add Piece
                                </Button>
                                <Button variant="outline" onClick={() => setCart([])} disabled={cart.length === 0 || readOnly} className="flex-1 sm:flex-none text-destructive hover:text-destructive">
                                    Clear
                                </Button>
                            </div>
                            <Button onClick={handleSaveLot} disabled={!canSave || refreshing || readOnly} className="w-full sm:w-auto gap-2 min-w-[120px]">
                                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Lot</>}
                            </Button>
                        </div>

                        {/* Cart */}
                        <div className="mt-6">
                            <div className="hidden sm:block rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[100px]">#</TableHead>
                                            <TableHead>Piece ID (Preview)</TableHead>
                                            <TableHead>Weight (kg)</TableHead>
                                            <TableHead className="">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {cart.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                                    No pieces added. Enter weight and press Enter.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            cart.map((r) => (
                                                <TableRow key={r.tempId}>
                                                    <TableCell className="font-medium">{r.seq}</TableCell>
                                                    <TableCell>{previewLotNo ? `${previewLotNo}-${r.seq}` : 'Pending...'}</TableCell>
                                                    <TableCell>{formatKg(r.weight)}</TableCell>
                                                    <TableCell className="">
                                                        <Button variant="ghost" size="icon" onClick={() => removeFromCart(r.tempId)} disabled={readOnly} className="h-8 w-8 text-destructive">
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="sm:hidden space-y-2">
                                {cart.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
                                        No pieces added. Enter weight and press Enter.
                                    </div>
                                ) : (
                                    cart.map((r) => (
                                        <div key={r.tempId} className="border rounded-lg bg-card p-3 shadow-sm">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-xs text-muted-foreground">#{r.seq}</div>
                                                    <div className="font-mono text-xs text-primary truncate">
                                                        {previewLotNo ? `${previewLotNo}-${r.seq}` : 'Pending...'}
                                                    </div>
                                                    <div className="mt-1 font-medium">{formatKg(r.weight)}</div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => removeFromCart(r.tempId)}
                                                    disabled={readOnly}
                                                    className="h-10 w-10 text-destructive"
                                                >
                                                    <Trash2 className="w-5 h-5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {mode === 'cutter_purchase' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Cutter Purchase Inbound</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {purchaseReadOnly && (
                            <div className="mb-3 text-xs text-muted-foreground">
                                Read-only access: you can view cutter purchase data but cannot create or edit lots.
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                            <div className="space-y-2">
                                <Label>Date</Label>
                                <Input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={purchaseReadOnly} />
                            </div>
                            <div className="space-y-2">
                                <Label>Item</Label>
                                <Select value={itemId} onChange={e => setItemId(e.target.value)} disabled={purchaseReadOnly}>
                                    <option value="">Select Item</option>
                                    {db?.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Firm (Optional)</Label>
                                <Select value={firmId} onChange={e => setFirmId(e.target.value)} disabled={purchaseReadOnly}>
                                    <option value="">Select Firm</option>
                                    {db?.firms?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Supplier</Label>
                                <Select value={supplierId} onChange={e => setSupplierId(e.target.value)} disabled={purchaseReadOnly}>
                                    <option value="">Select Supplier</option>
                                    {db?.suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Lot No (Preview)</Label>
                                <Input value={previewCutterLotNo} readOnly className="bg-muted" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                            <div className="space-y-2">
                                <Label>Bobbin</Label>
                                <Select value={cutterEntry.bobbinId} onChange={e => setCutterEntry(prev => ({ ...prev, bobbinId: e.target.value }))} disabled={purchaseReadOnly}>
                                    <option value="">Select Bobbin</option>
                                    {db.bobbins?.map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Bobbin Qty</Label>
                                <Input type="number" min="0" value={cutterEntry.bobbinQuantity} onChange={e => setCutterEntry(prev => ({ ...prev, bobbinQuantity: e.target.value }))} disabled={purchaseReadOnly} />
                            </div>
                            <div className="space-y-2">
                                <Label>Box</Label>
                                <Select value={cutterEntry.boxId} onChange={e => setCutterEntry(prev => ({ ...prev, boxId: e.target.value }))} disabled={purchaseReadOnly}>
                                    <option value="">Select Box</option>
                                    {filterByProcess(db.boxes, 'cutter').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Gross Weight (kg)</Label>
                                <Input type="number" min="0" step="0.001" value={cutterEntry.grossWeight} onChange={e => setCutterEntry(prev => ({ ...prev, grossWeight: e.target.value }))} disabled={purchaseReadOnly} />
                            </div>
                            <div className="space-y-2">
                                <Label>Cut</Label>
                                <Select value={cutterEntry.cutId} onChange={e => setCutterEntry(prev => ({ ...prev, cutId: e.target.value }))} disabled={purchaseReadOnly}>
                                    <option value="">Select Cut</option>
                                    {db.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Operator (Optional)</Label>
                                <Select value={cutterEntry.operatorId} onChange={e => setCutterEntry(prev => ({ ...prev, operatorId: e.target.value }))} disabled={purchaseReadOnly}>
                                    <option value="">Select Operator</option>
                                    {filterByProcess(db.operators, 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Helper (Optional)</Label>
                                <Select value={cutterEntry.helperId} onChange={e => setCutterEntry(prev => ({ ...prev, helperId: e.target.value }))} disabled={purchaseReadOnly}>
                                    <option value="">Select Helper</option>
                                    {filterByProcess(db.helpers, 'cutter').map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Shift (Optional)</Label>
                                <Select
                                    value={cutterEntry.shift}
                                    onChange={e => setCutterEntry(prev => ({ ...prev, shift: e.target.value }))}
                                    options={SHIFT_OPTIONS}
                                    placeholder="Select Shift"
                                    searchable={false}
                                    clearable
                                    disabled={purchaseReadOnly}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Machine (Optional)</Label>
                                <Select value={cutterEntry.machineId} onChange={e => setCutterEntry(prev => ({ ...prev, machineId: e.target.value }))} disabled={purchaseReadOnly}>
                                    <option value="">Select Machine</option>
                                    {filterByProcess(db.machines, 'cutter').map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </Select>
                            </div>
                        </div>

                        {cutterEntry.bobbinId && cutterEntry.boxId && cutterEntry.bobbinQuantity && cutterEntry.grossWeight && (
                            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                                Tare: <span className="font-medium">{formatKg(calcCutterWeights(cutterEntry).tare)}</span> |
                                Net: <span className="font-medium">{formatKg(calcCutterWeights(cutterEntry).net)}</span>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row justify-between items-end gap-4 sm:gap-0">
                            <div className="flex w-full sm:w-auto gap-2">
                                <Button onClick={addCutterCrate} disabled={!canAddCutter || purchaseReadOnly} className="flex-1 sm:flex-none gap-2">
                                    <Plus className="w-4 h-4" /> Add Crate
                                </Button>
                                <Button variant="outline" onClick={() => setCutterCart([])} disabled={cutterCart.length === 0 || purchaseReadOnly} className="flex-1 sm:flex-none text-destructive hover:text-destructive">
                                    Clear
                                </Button>
                            </div>
                            <Button onClick={handleSaveCutterPurchase} disabled={!canSaveCutter || refreshing || purchaseReadOnly} className="w-full sm:w-auto gap-2 min-w-[120px]">
                                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Inbound</>}
                            </Button>
                        </div>

                        <div className="mt-6">
                            <div className="hidden sm:block rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Bobbin</TableHead>
                                            <TableHead>Qty</TableHead>
                                            <TableHead>Box</TableHead>
                                            <TableHead>Gross</TableHead>
                                            <TableHead>Net</TableHead>
                                            <TableHead>Cut</TableHead>
                                            <TableHead>Operator</TableHead>
                                            <TableHead className="">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {cutterCart.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                                    No crates added.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            cutterCart.map((row) => (
                                                <TableRow key={row.id}>
                                                    <TableCell>{getBobbin(row.bobbinId)?.name || '—'}</TableCell>
                                                    <TableCell>{row.bobbinQuantity}</TableCell>
                                                    <TableCell>{getBox(row.boxId)?.name || '—'}</TableCell>
                                                    <TableCell>{formatKg(row.grossWeight)}</TableCell>
                                                    <TableCell>{formatKg(row.netWeight)}</TableCell>
                                                    <TableCell>{row.cutId ? getCut(row.cutId)?.name || '—' : '—'}</TableCell>
                                                    <TableCell>{row.operatorId ? getOperator(row.operatorId)?.name || '—' : '—'}</TableCell>
                                                    <TableCell className="">
                                                        <Button variant="ghost" size="icon" onClick={() => removeCutterCrate(row.id)} disabled={purchaseReadOnly} className="h-8 w-8 text-destructive">
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="sm:hidden space-y-2">
                                {cutterCart.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
                                        No crates added.
                                    </div>
                                ) : (
                                    cutterCart.map((row) => {
                                        const bobbin = getBobbin(row.bobbinId)?.name || '—';
                                        const box = getBox(row.boxId)?.name || '—';
                                        const cut = row.cutId ? (getCut(row.cutId)?.name || '—') : '—';
                                        const operator = row.operatorId ? (getOperator(row.operatorId)?.name || '—') : '—';
                                        return (
                                            <div key={row.id} className="border rounded-lg bg-card p-3 shadow-sm">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="font-medium truncate">{bobbin}</div>
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            Qty: <span className="font-medium text-foreground">{row.bobbinQuantity}</span> • Net: <span className="font-medium text-foreground">{formatKg(row.netWeight)}</span>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            Box: {box} • Gross: {formatKg(row.grossWeight)}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            Cut: {cut} • Op: {operator}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeCutterCrate(row.id)}
                                                        disabled={purchaseReadOnly}
                                                        className="h-10 w-10 text-destructive"
                                                    >
                                                        <Trash2 className="w-5 h-5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {cutterCart.length > 0 && (
                            <div className="flex flex-col sm:flex-row justify-between text-sm text-muted-foreground font-medium">
                                <div>Total Crates: {cutterCart.length}</div>
                                <div>Total Bobbins: {cutterTotals.totalBobbinQty}</div>
                                <div>Total Net Weight: {formatKg(cutterTotals.totalNet)}</div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <RecentLotsTable db={db} />
        </div>
    );
}

// Sub-component for Recent Lots
function RecentLotsTable({ db }) {
    const { refreshDb } = useInventory();
    const { canEdit: canEditInbound, canDelete: canDeleteInbound } = usePermission('inbound');
    const { canEdit: canEditCutter, canDelete: canDeleteCutter } = useStagePermission('receive', 'cutter');
    const canEditCutterPurchase = canEditInbound && canEditCutter;
    const canDeleteCutterPurchase = canDeleteInbound && canDeleteCutter;

    const [filter, setFilter] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [page, setPage] = useState(1);
    const [expandedLot, setExpandedLot] = useState(null);
    const [cutterEditorOpen, setCutterEditorOpen] = useState(false);
    const [cutterEditorLotNo, setCutterEditorLotNo] = useState(null);
    const [cutterEditorLoading, setCutterEditorLoading] = useState(false);
    const [cutterEditorSaving, setCutterEditorSaving] = useState(false);
    const [cutterEditorForm, setCutterEditorForm] = useState({
        date: '',
        itemId: '',
        firmId: '',
        supplierId: '',
        crates: [],
    });
    const pageSize = 25;

    const isCutterPurchaseLot = (lotNo) => String(lotNo || '').toUpperCase().startsWith('CP-');

    const getBobbin = (id) => db?.bobbins?.find(b => b.id === id);
    const getBox = (id) => db?.boxes?.find(b => b.id === id);
    const getCut = (id) => db?.cuts?.find(c => c.id === id);
    const getOperator = (id) => db?.operators?.find(o => o.id === id);
    const getHelper = (id) => db?.helpers?.find(h => h.id === id);
    const getMachine = (id) => db?.machines?.find(m => m.id === id);

    const calcCutterWeights = (entry) => {
        const bobbin = getBobbin(entry.bobbinId);
        const box = getBox(entry.boxId);
        const bobbinQty = Number(entry.bobbinQuantity || 0);
        const gross = Number(entry.grossWeight || 0);
        const bobbinWeight = Number(bobbin?.weight || 0);
        const boxWeight = Number(box?.weight || 0);
        const tare = bobbinWeight * bobbinQty + boxWeight;
        const net = round3(gross - tare);
        return { net, tare };
    };

    const cutterEditorTotals = useMemo(() => {
        const crates = cutterEditorForm.crates || [];
        const locked = crates.some((row) => (
            Number(row.issuedBobbins || 0) > 0
            || Number(row.dispatchedCount || 0) > 0
            || Number(row.issuedBobbinWeight || 0) > 0
            || Number(row.dispatchedWeight || 0) > 0
        ));

        return crates.reduce((acc, row) => {
            const bobbins = Number(row.bobbinQuantity || 0);
            const issuedBobbins = Number(row.issuedBobbins || 0);
            const dispatchedCount = Number(row.dispatchedCount || 0);
            const issuedWeight = Number(row.issuedBobbinWeight || 0);
            const dispatchedWeight = Number(row.dispatchedWeight || 0);
            const { net } = calcCutterWeights(row);
            const storedNet = Number(row.netWeight);
            const totalNet = locked
                ? (Number.isFinite(storedNet) && storedNet > 0 ? storedNet : net)
                : net;
            const availableWeight = round3(Math.max(0, totalNet - issuedWeight - dispatchedWeight));
            const availableCount = calcAvailableCountFromWeight({
                totalCount: bobbins,
                issuedCount: issuedBobbins,
                dispatchedCount,
                totalWeight: totalNet,
                availableWeight,
            }) || 0;
            acc.totalCrates += 1;
            acc.totalBobbins += bobbins;
            acc.totalNet += Number.isFinite(totalNet) ? totalNet : 0;
            acc.availableBobbins += availableCount;
            acc.availableNet += availableWeight;
            return acc;
        }, { totalCrates: 0, totalBobbins: 0, totalNet: 0, availableBobbins: 0, availableNet: 0, locked });
    }, [cutterEditorForm.crates]);

    const cutterEditorLocked = cutterEditorTotals.locked;

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!cutterEditorOpen || !cutterEditorLotNo) return;
            setCutterEditorLoading(true);
            try {
                const res = await api.getCutterPurchaseLot(cutterEditorLotNo);
                if (cancelled) return;
                const lot = res?.lot || {};
                const rows = Array.isArray(res?.rows) ? res.rows : [];
                setCutterEditorForm({
                    date: lot.date || todayISO(),
                    itemId: lot.itemId || '',
                    firmId: lot.firmId || '',
                    supplierId: lot.supplierId || '',
                    crates: rows.map((row) => {
                        const machineId = row.machineNo
                            ? (db?.machines || []).find(m => m.name === row.machineNo)?.id || ''
                            : '';
                        return {
                            id: row.id,
                            rowId: row.id,
                            bobbinId: row.bobbinId || '',
                            bobbinQuantity: row.bobbinQuantity || '',
                            boxId: row.boxId || '',
                            grossWeight: row.grossWt || '',
                            tareWeight: row.tareWt ?? null,
                            netWeight: row.netWt ?? null,
                            issuedBobbins: row.issuedBobbins || 0,
                            issuedBobbinWeight: row.issuedBobbinWeight || 0,
                            dispatchedCount: row.dispatchedCount || 0,
                            dispatchedWeight: row.dispatchedWeight || 0,
                            operatorId: row.operatorId || '',
                            helperId: row.helperId || '',
                            cutId: row.cutId || '',
                            shift: row.shift || '',
                            machineId,
                        };
                    }),
                });
            } catch (err) {
                if (cancelled) return;
                alert(err.message || 'Failed to load cutter purchase');
                setCutterEditorOpen(false);
                setCutterEditorLotNo(null);
            } finally {
                if (!cancelled) setCutterEditorLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [cutterEditorOpen, cutterEditorLotNo, db?.machines]);

    const lots = useMemo(() => {
        if (!db?.lots) return [];
        const all = db.lots.map(l => ({
            ...l,
            itemName: db.items.find(i => i.id === l.itemId)?.name || "—",
            firmName: db.firms.find(f => f.id === l.firmId)?.name || "—",
            supplierName: db.suppliers.find(s => s.id === l.supplierId)?.name || "—",
        }));

        // Sort descending by Lot No (Higher to Lower)
        all.sort((a, b) => b.lotNo.localeCompare(a.lotNo, undefined, { numeric: true }));

        // Date filter
        const withDates = all.filter(l => {
            if (startDate || endDate) {
                const itemDate = new Date(l.date || l.createdAt);
                if (startDate && itemDate < new Date(startDate)) return false;
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    if (itemDate > end) return false;
                }
            }
            return true;
        });

        // Basic Filter
        if (!filter) return withDates;
        const lower = filter.toLowerCase();
        return withDates.filter(l =>
            l.lotNo.toLowerCase().includes(lower) ||
            l.itemName.toLowerCase().includes(lower) ||
            l.firmName.toLowerCase().includes(lower) ||
            l.supplierName.toLowerCase().includes(lower)
        );
    }, [db, filter, startDate, endDate]);

    const paged = lots.slice((page - 1) * pageSize, page * pageSize);
    const totalPages = Math.ceil(lots.length / pageSize);

    // Get pieces for expanded lot
    const getPiecesForLot = (lotNo) => {
        return (db?.inbound_items || []).filter(p => p.lotNo === lotNo).sort((a, b) => (a.seq || 0) - (b.seq || 0));
    };

    const handleReprintPiece = async (piece, lot) => {
        try {
            const template = await loadTemplate(LABEL_STAGE_KEYS.INBOUND);
            if (!template) {
                alert('No sticker template found for Inbound. Please configure it in Label Designer.');
                return;
            }

            await printStageTemplate(
                LABEL_STAGE_KEYS.INBOUND,
                {
                    lotNo: lot.lotNo,
                    itemName: lot.itemName,
                    pieceId: piece.id,
                    seq: piece.seq,
                    weight: piece.weight,
                    barcode: piece.barcode,
                    date: lot.date,
                },
                { template },
            );
        } catch (err) {
            alert(err.message || 'Failed to reprint sticker');
        }
    };

    const handleReprintAllPieces = async (lot) => {
        const pieces = getPiecesForLot(lot.lotNo);
        if (pieces.length === 0) {
            alert('No pieces found for this lot');
            return;
        }

        if (!confirm(`Print ${pieces.length} stickers for lot ${lot.lotNo}?`)) {
            return;
        }

        try {
            const template = await loadTemplate(LABEL_STAGE_KEYS.INBOUND);
            if (!template) {
                alert('No sticker template found for Inbound. Please configure it in Label Designer.');
                return;
            }

            const batchData = pieces.map(piece => ({
                lotNo: lot.lotNo,
                itemName: lot.itemName,
                pieceId: piece.id,
                seq: piece.seq,
                weight: piece.weight,
                barcode: piece.barcode,
                date: lot.date,
            }));

            await printStageTemplatesBatch(
                LABEL_STAGE_KEYS.INBOUND,
                batchData,
                { template },
            );
        } catch (err) {
            alert(err.message || 'Failed to reprint stickers');
        }
    };

    const handleExportLots = () => {
        const exportData = lots.map(l => ({
            lotNo: l.lotNo,
            date: formatDateDDMMYYYY(l.date),
            item: l.itemName,
            firm: l.firmName,
            supplier: l.supplierName,
            pieces: l.totalPieces || 0,
            weight: formatKg(l.totalWeight),
        }));
        const columns = [
            { key: 'lotNo', header: 'Lot No' },
            { key: 'date', header: 'Date' },
            { key: 'item', header: 'Item' },
            { key: 'firm', header: 'Firm' },
            { key: 'supplier', header: 'Supplier' },
            { key: 'pieces', header: 'Pieces' },
            { key: 'weight', header: 'Weight (kg)' },
        ];
        const today = new Date().toISOString().split('T')[0];
        exportHistoryToExcel(exportData, columns, `inbound-lots-${today}`);
    };

    const openCutterPurchaseEditor = (lotNo) => {
        setCutterEditorLotNo(lotNo);
        setCutterEditorOpen(true);
    };

    const closeCutterPurchaseEditor = () => {
        setCutterEditorOpen(false);
        setCutterEditorLotNo(null);
        setCutterEditorForm({
            date: '',
            itemId: '',
            firmId: '',
            supplierId: '',
            crates: [],
        });
    };

    const updateCutterCrate = (crateId, patch) => {
        setCutterEditorForm(prev => ({
            ...prev,
            crates: (prev.crates || []).map(c => (c.id === crateId ? { ...c, ...patch } : c)),
        }));
    };

    const addCutterCrate = () => {
        setCutterEditorForm(prev => ({
            ...prev,
            crates: [...(prev.crates || []), {
                id: uid('crate'),
                rowId: null,
                bobbinId: '',
                bobbinQuantity: '',
                boxId: '',
                grossWeight: '',
                tareWeight: null,
                netWeight: null,
                issuedBobbins: 0,
                issuedBobbinWeight: 0,
                dispatchedCount: 0,
                dispatchedWeight: 0,
                operatorId: '',
                helperId: '',
                cutId: '',
                shift: '',
                machineId: '',
            }],
        }));
    };

    const removeCutterCrate = (crateId) => {
        setCutterEditorForm(prev => ({
            ...prev,
            crates: (prev.crates || []).filter(c => c.id !== crateId),
        }));
    };

    const handleSaveCutterPurchaseEdit = async () => {
        if (!cutterEditorLotNo) return;
        if (cutterEditorLocked) {
            alert('Cannot edit this cutter purchase because it has already been issued/dispatched/transferred.');
            return;
        }
        const { date, itemId, firmId, supplierId, crates } = cutterEditorForm || {};
        if (!date || !itemId || !supplierId) {
            alert('Date, item, and supplier are required.');
            return;
        }
        if (!Array.isArray(crates) || crates.length === 0) {
            alert('Add at least one crate.');
            return;
        }

        for (let i = 0; i < crates.length; i++) {
            const row = crates[i];
            const idx = i + 1;
            if (!row.cutId) { alert(`Cut is required for crate ${idx}.`); return; }
            if (!row.bobbinId) { alert(`Bobbin is required for crate ${idx}.`); return; }
            if (!row.boxId) { alert(`Box is required for crate ${idx}.`); return; }
            if (!(Number(row.bobbinQuantity) > 0)) { alert(`Bobbin qty must be > 0 for crate ${idx}.`); return; }
            if (!(Number(row.grossWeight) > 0)) { alert(`Gross weight must be > 0 for crate ${idx}.`); return; }
            const { net } = calcCutterWeights(row);
            if (!(Number(net) > 0)) { alert(`Net weight must be positive for crate ${idx}.`); return; }
        }

        setCutterEditorSaving(true);
        try {
            const payload = {
                date,
                itemId,
                firmId: firmId || null,
                supplierId,
                crates: crates.map(row => ({
                    rowId: row.rowId || null,
                    bobbinId: row.bobbinId,
                    boxId: row.boxId,
                    bobbinQuantity: Number(row.bobbinQuantity),
                    grossWeight: Number(row.grossWeight),
                    operatorId: row.operatorId || null,
                    helperId: row.helperId || null,
                    cutId: row.cutId,
                    shift: row.shift || null,
                    machineNo: row.machineId ? (getMachine(row.machineId)?.name || '') : null,
                })),
            };
            await api.updateCutterPurchaseLot(cutterEditorLotNo, payload);
            await refreshDb();
            closeCutterPurchaseEditor();
        } catch (err) {
            alert(err.message || 'Failed to update cutter purchase');
        } finally {
            setCutterEditorSaving(false);
        }
    };

    const handleDeleteCutterPurchase = async (lotNo) => {
        if (!lotNo) return;
        const confirmDelete = window.confirm(
            `Delete cutter purchase ${lotNo}?\n\nThis will delete the challan, all crates, piece totals, and the inbound lot.`
        );
        if (!confirmDelete) return;
        try {
            await api.deleteCutterPurchaseLot(lotNo);
            await refreshDb();
            if (expandedLot === lotNo) setExpandedLot(null);
        } catch (err) {
            alert(err.message || 'Failed to delete cutter purchase');
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>Recent Lots</CardTitle>
                <div className="flex flex-col items-stretch sm:flex-row sm:items-end gap-2 w-full sm:w-auto">
                    <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase px-1">Search</label>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Filter lots..."
                                className="pl-8"
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase px-1">From</label>
                            <Input
                                type="date"
                                className="h-9 text-xs"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase px-1">To</label>
                            <Input
                                type="date"
                                className="h-9 text-xs"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 text-xs border"
                        onClick={() => {
                            setFilter('');
                            setStartDate('');
                            setEndDate('');
                        }}
                    >
                        Clear
                    </Button>
                    <Button
                        size="sm"
                        className="h-9 text-xs"
                        onClick={handleExportLots}
                    >
                        <Download className="w-4 h-4 mr-1" />
                        Export
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <Dialog open={cutterEditorOpen} onOpenChange={(open) => (open ? setCutterEditorOpen(true) : closeCutterPurchaseEditor())}>
                    <DialogContent
                        title={cutterEditorLotNo ? `Edit Cutter Purchase (${cutterEditorLotNo})` : 'Edit Cutter Purchase'}
                        onOpenChange={(open) => (open ? setCutterEditorOpen(true) : closeCutterPurchaseEditor())}
                        className="max-w-6xl"
                    >
                        {cutterEditorLoading ? (
                            <div className="text-sm text-muted-foreground">Loading…</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                                    <div className="space-y-1">
                                        <Label>Date</Label>
                                        <Input
                                            type="date"
                                            value={cutterEditorForm.date}
                                            disabled={cutterEditorLocked}
                                            onChange={e => setCutterEditorForm(prev => ({ ...prev, date: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Item</Label>
                                        <Select
                                            value={cutterEditorForm.itemId}
                                            disabled={cutterEditorLocked}
                                            onChange={e => setCutterEditorForm(prev => ({ ...prev, itemId: e.target.value }))}
                                        >
                                            <option value="">Select Item</option>
                                            {(db?.items || []).map(i => (
                                                <option key={i.id} value={i.id}>{i.name}</option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Firm (Optional)</Label>
                                        <Select
                                            value={cutterEditorForm.firmId}
                                            disabled={cutterEditorLocked}
                                            onChange={e => setCutterEditorForm(prev => ({ ...prev, firmId: e.target.value }))}
                                        >
                                            <option value="">Select Firm</option>
                                            {(db?.firms || []).map(f => (
                                                <option key={f.id} value={f.id}>{f.name}</option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Supplier</Label>
                                        <Select
                                            value={cutterEditorForm.supplierId}
                                            disabled={cutterEditorLocked}
                                            onChange={e => setCutterEditorForm(prev => ({ ...prev, supplierId: e.target.value }))}
                                        >
                                            <option value="">Select Supplier</option>
                                            {(db?.suppliers || []).map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Totals</Label>
                                        <div className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                                            Crates: <span className="font-medium text-foreground">{cutterEditorTotals.totalCrates}</span>{' '}
                                            | Bobbins: <span className="font-medium text-foreground">{cutterEditorTotals.totalBobbins}</span>{' '}
                                            <span className="text-muted-foreground">(Left: <span className="font-medium text-foreground">{cutterEditorTotals.availableBobbins}</span>)</span>{' '}
                                            | Net: <span className="font-medium text-foreground">{formatKg(cutterEditorTotals.totalNet)}</span>{' '}
                                            <span className="text-muted-foreground">(Left: <span className="font-medium text-foreground">{formatKg(cutterEditorTotals.availableNet)}</span>)</span>
                                        </div>
                                    </div>
                                </div>

                                {cutterEditorLocked && (
                                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                        This cutter purchase has already been <span className="font-medium">issued/dispatched/transferred</span>.
                                        Editing is locked to prevent stock mismatches. Use the <span className="font-medium">Left</span> values below to see current stock.
                                    </div>
                                )}

                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-2">
                                    <Button variant="outline" onClick={addCutterCrate} className="gap-2 w-full sm:w-auto" disabled={cutterEditorLocked}>
                                        <Plus className="w-4 h-4" /> Add Crate
                                    </Button>
                                    <Button onClick={handleSaveCutterPurchaseEdit} disabled={cutterEditorSaving || cutterEditorLocked} className="gap-2 w-full sm:w-auto">
                                        {cutterEditorSaving ? 'Saving…' : <><Save className="w-4 h-4" /> Save Changes</>}
                                    </Button>
                                </div>

                                <div className="rounded-md border overflow-auto max-h-[60vh] hidden sm:block">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Bobbin</TableHead>
                                                <TableHead className="w-[120px] min-w-[120px]">Qty</TableHead>
                                                <TableHead>Box</TableHead>
                                                <TableHead className="w-[140px] min-w-[140px]">Gross</TableHead>
                                                <TableHead className="w-[120px] min-w-[120px]">Tare</TableHead>
                                                <TableHead className="w-[120px] min-w-[120px]">Net</TableHead>
                                                <TableHead>Cut</TableHead>
                                                <TableHead>Operator</TableHead>
                                                <TableHead>Helper</TableHead>
                                                <TableHead className="w-[100px]">Shift</TableHead>
                                                <TableHead>Machine</TableHead>
                                                <TableHead className="w-[60px]">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {(cutterEditorForm.crates || []).length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
                                                        No crates.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                (cutterEditorForm.crates || []).map((row) => {
                                                    const { tare, net } = calcCutterWeights(row);
                                                    const netForStock = (cutterEditorLocked && Number.isFinite(Number(row.netWeight)))
                                                        ? Number(row.netWeight)
                                                        : net;
                                                    const tareForDisplay = (cutterEditorLocked && Number.isFinite(Number(row.tareWeight)))
                                                        ? Number(row.tareWeight)
                                                        : tare;

                                                    const totalCount = Number(row.bobbinQuantity || 0);
                                                    const issuedCount = Number(row.issuedBobbins || 0);
                                                    const dispatchedCount = Number(row.dispatchedCount || 0);
                                                    const issuedWeight = Number(row.issuedBobbinWeight || 0);
                                                    const dispatchedWeight = Number(row.dispatchedWeight || 0);
                                                    const availableWeight = round3(Math.max(0, netForStock - issuedWeight - dispatchedWeight));
                                                    const availableCount = calcAvailableCountFromWeight({
                                                        totalCount,
                                                        issuedCount,
                                                        dispatchedCount,
                                                        totalWeight: netForStock,
                                                        availableWeight,
                                                    });
                                                    const showLeft = (issuedCount > 0 || dispatchedCount > 0 || issuedWeight > 0 || dispatchedWeight > 0);
                                                    return (
                                                        <TableRow key={row.id}>
                                                            <TableCell className="min-w-[180px]">
                                                                <Select value={row.bobbinId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { bobbinId: e.target.value })}>
                                                                    <option value="">Select Bobbin</option>
                                                                    {(db?.bobbins || []).map(b => (
                                                                        <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                            <TableCell className="min-w-[120px] p-2">
                                                                <div className="flex flex-col items-stretch">
                                                                    <Input
                                                                        type="number"
                                                                        min="0"
                                                                        value={row.bobbinQuantity}
                                                                        disabled={cutterEditorLocked}
                                                                        onChange={e => updateCutterCrate(row.id, { bobbinQuantity: e.target.value })}
                                                                        className="text-right font-mono tabular-nums"
                                                                    />
                                                                    {showLeft && (
                                                                        <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                                                                            Left: <span className="font-medium text-foreground">{Number(availableCount || 0)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="min-w-[180px]">
                                                                <Select value={row.boxId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { boxId: e.target.value })}>
                                                                    <option value="">Select Box</option>
                                                                    {filterByProcess(db?.boxes || [], 'cutter').map(b => (
                                                                        <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                            <TableCell className="min-w-[140px] p-2">
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.001"
                                                                    value={row.grossWeight}
                                                                    disabled={cutterEditorLocked}
                                                                    onChange={e => updateCutterCrate(row.id, { grossWeight: e.target.value })}
                                                                    className="text-right font-mono tabular-nums"
                                                                />
                                                            </TableCell>
                                                            <TableCell className="font-mono text-sm">{formatKg(tareForDisplay)}</TableCell>
                                                            <TableCell className="font-mono text-sm">
                                                                <div className="flex flex-col items-center">
                                                                    <div>{formatKg(netForStock)}</div>
                                                                    {showLeft && (
                                                                        <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                                                                            Left: <span className="font-medium text-foreground">{formatKg(availableWeight)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="min-w-[160px]">
                                                                <Select value={row.cutId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { cutId: e.target.value })}>
                                                                    <option value="">Select Cut</option>
                                                                    {(db?.cuts || []).map(c => (
                                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                            <TableCell className="min-w-[160px]">
                                                                <Select value={row.operatorId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { operatorId: e.target.value })}>
                                                                    <option value="">Select Operator</option>
                                                                    {filterByProcess(db?.operators || [], 'cutter').map(o => (
                                                                        <option key={o.id} value={o.id}>{o.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                            <TableCell className="min-w-[160px]">
                                                                <Select value={row.helperId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { helperId: e.target.value })}>
                                                                    <option value="">Select Helper</option>
                                                                    {filterByProcess(db?.helpers || [], 'cutter').map(h => (
                                                                        <option key={h.id} value={h.id}>{h.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Select
                                                                    value={row.shift}
                                                                    disabled={cutterEditorLocked}
                                                                    onChange={e => updateCutterCrate(row.id, { shift: e.target.value })}
                                                                    options={SHIFT_OPTIONS}
                                                                    placeholder="Shift"
                                                                    searchable={false}
                                                                    clearable
                                                                />
                                                            </TableCell>
                                                            <TableCell className="min-w-[180px]">
                                                                <Select value={row.machineId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { machineId: e.target.value })}>
                                                                    <option value="">Select Machine</option>
                                                                    {filterByProcess(db?.machines || [], 'cutter').map(m => (
                                                                        <option key={m.id} value={m.id}>{m.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-destructive"
                                                                    disabled={cutterEditorLocked}
                                                                    onClick={() => removeCutterCrate(row.id)}
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                <div className="sm:hidden space-y-2">
                                    {(cutterEditorForm.crates || []).length === 0 ? (
                                        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
                                            No crates.
                                        </div>
                                    ) : (
                                        (cutterEditorForm.crates || []).map((row) => {
                                            const { tare, net } = calcCutterWeights(row);
                                            const netForStock = (cutterEditorLocked && Number.isFinite(Number(row.netWeight)))
                                                ? Number(row.netWeight)
                                                : net;
                                            const tareForDisplay = (cutterEditorLocked && Number.isFinite(Number(row.tareWeight)))
                                                ? Number(row.tareWeight)
                                                : tare;

                                            const totalCount = Number(row.bobbinQuantity || 0);
                                            const issuedCount = Number(row.issuedBobbins || 0);
                                            const dispatchedCount = Number(row.dispatchedCount || 0);
                                            const issuedWeight = Number(row.issuedBobbinWeight || 0);
                                            const dispatchedWeight = Number(row.dispatchedWeight || 0);
                                            const availableWeight = round3(Math.max(0, netForStock - issuedWeight - dispatchedWeight));
                                            const availableCount = calcAvailableCountFromWeight({
                                                totalCount,
                                                issuedCount,
                                                dispatchedCount,
                                                totalWeight: netForStock,
                                                availableWeight,
                                            });
                                            const showLeft = (issuedCount > 0 || dispatchedCount > 0 || issuedWeight > 0 || dispatchedWeight > 0);

                                            return (
                                                <div key={row.id} className="border rounded-lg bg-card p-3 shadow-sm">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-xs text-muted-foreground">Crate</div>
                                                            <div className="text-sm font-medium">
                                                                Net: <span className="font-mono">{formatKg(netForStock)}</span>
                                                                {showLeft ? (
                                                                    <span className="text-muted-foreground"> (Left {formatKg(availableWeight)})</span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-10 w-10 text-destructive"
                                                            disabled={cutterEditorLocked}
                                                            onClick={() => removeCutterCrate(row.id)}
                                                        >
                                                            <Trash2 className="w-5 h-5" />
                                                        </Button>
                                                    </div>

                                                    <div className="mt-3 grid grid-cols-1 gap-3">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">Bobbin</Label>
                                                            <Select value={row.bobbinId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { bobbinId: e.target.value })}>
                                                                <option value="">Select Bobbin</option>
                                                                {(db?.bobbins || []).map(b => (
                                                                    <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>
                                                                ))}
                                                            </Select>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Qty</Label>
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    value={row.bobbinQuantity}
                                                                    disabled={cutterEditorLocked}
                                                                    onChange={e => updateCutterCrate(row.id, { bobbinQuantity: e.target.value })}
                                                                    className="text-right font-mono tabular-nums"
                                                                />
                                                                {showLeft ? (
                                                                    <div className="text-[11px] text-muted-foreground">
                                                                        Left: <span className="font-medium text-foreground">{Number(availableCount || 0)}</span>
                                                                    </div>
                                                                ) : null}
                                                            </div>

                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Gross (kg)</Label>
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.001"
                                                                    value={row.grossWeight}
                                                                    disabled={cutterEditorLocked}
                                                                    onChange={e => updateCutterCrate(row.id, { grossWeight: e.target.value })}
                                                                    className="text-right font-mono tabular-nums"
                                                                />
                                                                <div className="text-[11px] text-muted-foreground">
                                                                    Tare: <span className="font-mono text-foreground">{formatKg(tareForDisplay)}</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-1">
                                                            <Label className="text-xs">Box</Label>
                                                            <Select value={row.boxId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { boxId: e.target.value })}>
                                                                <option value="">Select Box</option>
                                                                {filterByProcess(db?.boxes || [], 'cutter').map(b => (
                                                                    <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>
                                                                ))}
                                                            </Select>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Cut</Label>
                                                                <Select value={row.cutId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { cutId: e.target.value })}>
                                                                    <option value="">Select Cut</option>
                                                                    {(db?.cuts || []).map(c => (
                                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Shift</Label>
                                                                <Select
                                                                    value={row.shift}
                                                                    disabled={cutterEditorLocked}
                                                                    onChange={e => updateCutterCrate(row.id, { shift: e.target.value })}
                                                                    options={SHIFT_OPTIONS}
                                                                    placeholder="Shift"
                                                                    searchable={false}
                                                                    clearable
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Operator</Label>
                                                                <Select value={row.operatorId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { operatorId: e.target.value })}>
                                                                    <option value="">Select Operator</option>
                                                                    {filterByProcess(db?.operators || [], 'cutter').map(o => (
                                                                        <option key={o.id} value={o.id}>{o.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Helper</Label>
                                                                <Select value={row.helperId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { helperId: e.target.value })}>
                                                                    <option value="">Select Helper</option>
                                                                    {filterByProcess(db?.helpers || [], 'cutter').map(h => (
                                                                        <option key={h.id} value={h.id}>{h.name}</option>
                                                                    ))}
                                                                </Select>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-1">
                                                            <Label className="text-xs">Machine</Label>
                                                            <Select value={row.machineId} disabled={cutterEditorLocked} onChange={e => updateCutterCrate(row.id, { machineId: e.target.value })}>
                                                                <option value="">Select Machine</option>
                                                                {filterByProcess(db?.machines || [], 'cutter').map(m => (
                                                                    <option key={m.id} value={m.id}>{m.name}</option>
                                                                ))}
                                                            </Select>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
                <div className="hidden sm:block rounded-md border overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]"></TableHead>
                                <TableHead>Lot No</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Item</TableHead>
                                <TableHead>Firm</TableHead>
                                <TableHead>Supplier</TableHead>
                                <TableHead className="">Pieces</TableHead>
                                <TableHead className="">Weight</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paged.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                                        No lots found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paged.map(l => (
                                    <React.Fragment key={l.lotNo}>
                                        <TableRow className={expandedLot === l.lotNo ? 'bg-muted/50' : ''}>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => setExpandedLot(expandedLot === l.lotNo ? null : l.lotNo)}
                                                >
                                                    {expandedLot === l.lotNo ? '−' : '+'}
                                                </Button>
                                            </TableCell>
                                            <TableCell className="font-medium">{l.lotNo}</TableCell>
                                            <TableCell>{formatDateDDMMYYYY(l.date)}</TableCell>
                                            <TableCell>{l.itemName}</TableCell>
                                            <TableCell>{l.firmName}</TableCell>
                                            <TableCell>{l.supplierName}</TableCell>
                                            <TableCell className="">{l.totalPieces}</TableCell>
                                            <TableCell className="font-mono">{formatKg(l.totalWeight)}</TableCell>
                                            <TableCell>
                                                <UserBadge user={l.createdByUser} timestamp={l.createdAt} />
                                            </TableCell>
                                            <TableCell>
                                                <ActionMenu actions={[
                                                    {
                                                        label: 'Reprint All',
                                                        icon: <Printer className="w-4 h-4" />,
                                                        onClick: () => handleReprintAllPieces(l),
                                                    },
                                                    ...(isCutterPurchaseLot(l.lotNo) ? [
                                                        {
                                                            label: 'Edit Cutter Purchase',
                                                            icon: <Edit2 className="w-4 h-4" />,
                                                            onClick: () => openCutterPurchaseEditor(l.lotNo),
                                                            disabled: !canEditCutterPurchase,
                                                            disabledReason: 'You do not have permission to edit cutter purchases.',
                                                        },
                                                        {
                                                            label: 'Delete Cutter Purchase',
                                                            icon: <Trash2 className="w-4 h-4" />,
                                                            onClick: () => handleDeleteCutterPurchase(l.lotNo),
                                                            variant: 'destructive',
                                                            disabled: !canDeleteCutterPurchase,
                                                            disabledReason: 'You do not have permission to delete cutter purchases.',
                                                        },
                                                    ] : []),
                                                ]} />
                                            </TableCell>
                                        </TableRow>
                                        {expandedLot === l.lotNo && (
                                            <TableRow>
                                                <TableCell colSpan={10} className="bg-muted/30 p-0">
                                                    <div className="p-4">
                                                        <h4 className="font-medium text-sm mb-2">Pieces in Lot {l.lotNo}</h4>
                                                        <div className="rounded-md border bg-background overflow-x-auto">
                                                            <Table>
                                                                <TableHeader>
                                                                    <TableRow>
                                                                        <TableHead className="w-[60px]">Seq</TableHead>
                                                                        <TableHead>Piece ID</TableHead>
                                                                        <TableHead>Barcode</TableHead>
                                                                        <TableHead>Weight (kg)</TableHead>
                                                                        <TableHead>Status</TableHead>
                                                                        <TableHead className="w-[50px]">Actions</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {getPiecesForLot(l.lotNo).map(piece => (
                                                                        <TableRow key={piece.id}>
                                                                            <TableCell>{piece.seq}</TableCell>
                                                                            <TableCell className="font-mono text-xs">{piece.id}</TableCell>
                                                                            <TableCell className="font-mono text-xs">{piece.barcode || '—'}</TableCell>
                                                                            <TableCell>{formatKg(piece.weight)}</TableCell>
                                                                            <TableCell>
                                                                                <Badge variant={piece.status === 'available' ? 'default' : 'secondary'}>
                                                                                    {piece.status}
                                                                                </Badge>
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <ActionMenu actions={[
                                                                                    {
                                                                                        label: 'Reprint',
                                                                                        icon: <Printer className="w-4 h-4" />,
                                                                                        onClick: () => handleReprintPiece(piece, l),
                                                                                    },
                                                                                ]} />
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                </TableBody>
                                                            </Table>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View for Recent Lots */}
                <div className="block sm:hidden space-y-3">
                    {paged.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No lots found.</div>
                    ) : (
                        paged.map(l => (
                            <div key={l.lotNo} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                                <div className="p-4" onClick={() => setExpandedLot(expandedLot === l.lotNo ? null : l.lotNo)}>
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold">{l.lotNo}</p>
                                            <p className="text-sm text-muted-foreground">{l.itemName}</p>
                                            <p className="text-xs text-muted-foreground mt-1">{formatDateDDMMYYYY(l.date)} • {l.firmName}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <Badge variant="outline">{l.totalPieces} pcs</Badge>
                                            <span className="font-mono text-sm font-medium">{formatKg(l.totalWeight)}</span>
                                        </div>
                                    </div>
                                </div>
                                {expandedLot === l.lotNo && (
                                    <div className="border-t bg-muted/30 p-3 space-y-2">
                                        <p className="text-xs font-medium text-muted-foreground">Pieces in this lot:</p>
                                        {(l.pieces || []).map(p => (
                                            <div key={p.id} className="flex justify-between items-center text-sm bg-background rounded px-2 py-1">
                                                <span className="font-mono">{p.seq || p.id.substring(0, 6)}</span>
                                                <span className="font-medium">{formatKg(p.weight)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-end space-x-2 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                    >
                        Previous
                    </Button>
                    <div className="text-sm text-muted-foreground">
                        Page {page} of {totalPages || 1}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                    >
                        Next
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
