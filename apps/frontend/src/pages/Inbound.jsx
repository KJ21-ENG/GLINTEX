import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useInventory } from '../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Label } from '../components/ui';
import { formatKg, uid, todayISO } from '../utils';
import { Trash2, Plus, Save, ArrowUpDown, Search } from 'lucide-react';

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
            // Using direct fetch as this isn't in the context actions yet, or we can move it there.
            // Keeping it here as per original implementation.
            const res = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
            const j = await res.json();
            setPreviewLotNo(j.next);
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
            try {
                await createLot({ date, itemId, firmId, supplierId, pieces });
            } catch (err) {
                if (err && String(err.message || '').toLowerCase().includes('lot already exists')) {
                    await fetchSequence(); // Retry with new sequence
                    await createLot({ date, itemId, firmId, supplierId, pieces });
                } else {
                    throw err;
                }
            }

            // Success
            const totalPieces = cart.length;
            const totalWeight = cart.reduce((s, r) => s + (Number(r.weight) || 0), 0);
            // Ideally show a toast here instead of alert, but preserving simple functionality
            // alert(`Saved Lot with ${totalPieces} pcs / ${formatKg(totalWeight)} kg`);

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
                <div className="text-sm text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full border border-secondary">
                    Sequence is auto-generated
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>New Lot Entry</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
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

                    <div className="mt-6 flex justify-between items-end">
                        <div className="flex gap-2">
                            <Button onClick={addPiece} disabled={!canAdd} className="gap-2">
                                <Plus className="w-4 h-4" /> Add Piece
                            </Button>
                            <Button variant="outline" onClick={() => setCart([])} disabled={cart.length === 0} className="text-destructive hover:text-destructive">
                                Clear
                            </Button>
                        </div>
                        <Button onClick={handleSaveLot} disabled={!canSave || refreshing} className="gap-2 min-w-[120px]">
                            {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Lot</>}
                        </Button>
                    </div>

                    {/* Cart Table */}
                    <div className="mt-6 rounded-md border">
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
    const [page, setPage] = useState(1);
    const pageSize = 25;

    const lots = useMemo(() => {
        if (!db?.lots) return [];
        const all = db.lots.map(l => ({
            ...l,
            itemName: db.items.find(i => i.id === l.itemId)?.name || "—",
            firmName: db.firms.find(f => f.id === l.firmId)?.name || "—",
            supplierName: db.suppliers.find(s => s.id === l.supplierId)?.name || "—",
        }));

        // Basic Filter
        if (!filter) return all;
        const lower = filter.toLowerCase();
        return all.filter(l =>
            l.lotNo.toLowerCase().includes(lower) ||
            l.itemName.toLowerCase().includes(lower) ||
            l.firmName.toLowerCase().includes(lower) ||
            l.supplierName.toLowerCase().includes(lower)
        ).sort((a, b) => b.lotNo.localeCompare(a.lotNo, undefined, { numeric: true }));
    }, [db, filter]);

    const paged = lots.slice((page - 1) * pageSize, page * pageSize);
    const totalPages = Math.ceil(lots.length / pageSize);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent Lots</CardTitle>
                <div className="relative w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter lots..."
                        className="pl-8"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Lot No</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Item</TableHead>
                                <TableHead>Firm</TableHead>
                                <TableHead>Supplier</TableHead>
                                <TableHead className="">Pieces</TableHead>
                                <TableHead className="">Weight</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paged.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        No lots found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paged.map(l => (
                                    <TableRow key={l.lotNo}>
                                        <TableCell className="font-medium">{l.lotNo}</TableCell>
                                        <TableCell>{l.date}</TableCell>
                                        <TableCell>{l.itemName}</TableCell>
                                        <TableCell>{l.firmName}</TableCell>
                                        <TableCell>{l.supplierName}</TableCell>
                                        <TableCell className="">{l.totalPieces}</TableCell>
                                        <TableCell className="font-mono">{formatKg(l.totalWeight)}</TableCell>
                                    </TableRow>
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