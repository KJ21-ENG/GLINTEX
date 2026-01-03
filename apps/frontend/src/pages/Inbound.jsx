import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api/client';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Label, ActionMenu } from '../components/ui';
import { formatKg, uid, todayISO, formatDateDDMMYYYY } from '../utils';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, printStageTemplatesBatch } from '../utils/labelPrint';
import { Trash2, Plus, Save, ArrowUpDown, Search, Printer, Download } from 'lucide-react';
import { exportHistoryToExcel } from '../services';


export function Inbound() {
    const { db, createLot, refreshing } = useInventory();

    // Form State
    const [date, setDate] = useState(todayISO());
    const [itemId, setItemId] = useState("");
    const [firmId, setFirmId] = useState("");
    const [supplierId, setSupplierId] = useState("");
    const [weight, setWeight] = useState("");
    const [previewLotNo, setPreviewLotNo] = useState("");
    const [cart, setCart] = useState([]);
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
        fetchSequence();
    }, []);

    // Validation
    const canAdd = date && itemId && firmId && supplierId && Number(weight) > 0;
    const canSave = cart.length > 0 && date && itemId && firmId && supplierId && !saving;

    // Handlers
    function addPiece() {
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

    return (
        <div className="space-y-6 fade-in">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <h1 className="text-2xl font-bold tracking-tight">Inbound Receiving</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>New Lot Entry</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Input type="date" value={date} onChange={e => { setDate(e.target.value); setCart([]); }} />
                        </div>
                        <div className="space-y-2">
                            <Label>Item</Label>
                            <Select value={itemId} onChange={e => setItemId(e.target.value)}>
                                <option value="">Select Item</option>
                                {db?.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Firm</Label>
                            <Select value={firmId} onChange={e => setFirmId(e.target.value)}>
                                <option value="">Select Firm</option>
                                {db?.firms?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Supplier</Label>
                            <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
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
                            <Button onClick={addPiece} disabled={!canAdd} className="flex-1 sm:flex-none gap-2">
                                <Plus className="w-4 h-4" /> Add Piece
                            </Button>
                            <Button variant="outline" onClick={() => setCart([])} disabled={cart.length === 0} className="flex-1 sm:flex-none text-destructive hover:text-destructive">
                                Clear
                            </Button>
                        </div>
                        <Button onClick={handleSaveLot} disabled={!canSave || refreshing} className="w-full sm:w-auto gap-2 min-w-[120px]">
                            {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Lot</>}
                        </Button>
                    </div>

                    {/* Cart Table */}
                    <div className="mt-6 rounded-md border overflow-x-auto">
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
                                                <Button variant="ghost" size="icon" onClick={() => removeFromCart(r.tempId)} className="h-8 w-8 text-destructive">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <RecentLotsTable db={db} />
        </div>
    );
}

// Sub-component for Recent Lots
function RecentLotsTable({ db }) {
    const [filter, setFilter] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [page, setPage] = useState(1);
    const [expandedLot, setExpandedLot] = useState(null);
    const pageSize = 25;

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

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>Recent Lots</CardTitle>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto items-end">
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
                <div className="rounded-md border overflow-x-auto">
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
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paged.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
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
                                                <ActionMenu actions={[
                                                    {
                                                        label: 'Reprint All',
                                                        icon: <Printer className="w-4 h-4" />,
                                                        onClick: () => handleReprintAllPieces(l),
                                                    },
                                                ]} />
                                            </TableCell>
                                        </TableRow>
                                        {expandedLot === l.lotNo && (
                                            <TableRow>
                                                <TableCell colSpan={9} className="bg-muted/30 p-0">
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
