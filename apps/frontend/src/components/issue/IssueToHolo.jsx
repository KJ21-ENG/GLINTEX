import React, { useState, useEffect, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';

export function IssueToHolo() {
    const { db, refreshDb } = useInventory();

    const [form, setForm] = useState({
        date: todayISO(),
        machineId: '',
        operatorId: '',
        shift: '',
        yarnId: '',
        yarnKg: '',
        twistId: '',
        note: '',
    });

    const [crates, setCrates] = useState([]);
    const [scanInput, setScanInput] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // --- Derived Data ---

    const holoTotals = useMemo(() => {
        return crates.reduce((acc, c) => ({
            rolls: acc.rolls + (Number(c.issuedBobbins) || 0),
            weight: acc.weight + (Number(c.issuedBobbinWeight) || 0)
        }), { rolls: 0, weight: 0 });
    }, [crates]);

    const lotSummary = useMemo(() => {
        if (crates.length === 0) return { lotNos: [], itemIds: [], lotLabel: '', itemId: '' };
        const lotSet = new Set();
        const itemSet = new Set();
        crates.forEach(c => {
            if (c.lotNo) lotSet.add(c.lotNo);
            if (c.itemId) itemSet.add(c.itemId);
        });
        const lotNos = Array.from(lotSet);
        const itemIds = Array.from(itemSet);
        const lotLabel = lotNos.length <= 1
            ? (lotNos[0] || '')
            : (lotNos.length <= 3 ? `Mixed (${lotNos.join(', ')})` : `Mixed (${lotNos.length})`);
        return { lotNos, itemIds, lotLabel, itemId: itemIds[0] || '' };
    }, [crates]);

    // --- Handlers ---

    async function handleScan() {
        if (!scanInput.trim()) return;

        // Lookup in cutter receive rows
        const normalized = scanInput.trim().toUpperCase();
        const row = (db.receive_from_cutter_machine_rows || []).find(r => !r.isDeleted && (r.barcode || '').toUpperCase() === normalized);

        if (!row) {
            alert('Barcode not found in Cutter Receive rows');
            return;
        }

        if (crates.some(c => c.rowId === row.id)) {
            alert('Crate already added');
            return;
        }

        // Check Lot Consistency
        const piece = db.inbound_items.find(p => p.id === row.pieceId);
        if (!piece) {
            alert('Inbound piece not found for this crate');
            return;
        }
        const rowLot = piece.lotNo;
        const rowItem = piece.itemId;
        if (!rowLot || !rowItem) {
            alert('Missing lot or item for this crate');
            return;
        }

        if (crates.length > 0 && rowItem !== lotSummary.itemId) {
            alert('Mixed items not allowed');
            return;
        }

        // Calculate Default Issue Qty (Available)
        const issuedCount = row.issuedBobbins || 0;
        const availCount = Math.max(0, (row.bobbinQuantity || 0) - issuedCount);

        const issuedWt = row.issuedBobbinWeight || 0;
        const availWt = Math.max(0, (row.netWt || 0) - issuedWt);

        const newCrate = {
            rowId: row.id,
            barcode: row.barcode,
            lotNo: rowLot,
            pieceId: row.pieceId, // Show piece ID in the 'Piece' column
            itemId: rowItem,
            availCount,
            availWt,
            cut: row.cut || row.cutMaster?.name || '',
            issuedBobbins: availCount, // Default to all available
            issuedBobbinWeight: availWt
        };

        setCrates(prev => [...prev, newCrate]);
        setScanInput('');
    }

    function updateCrate(rowId, field, val) {
        setCrates(prev => prev.map(c => {
            if (c.rowId !== rowId) return c;
            const next = { ...c, [field]: val };

            // Auto-calc weight if count changes
            if (field === 'issuedBobbins') {
                const count = Number(val);
                const ratio = c.availCount > 0 ? count / c.availCount : 0;
                next.issuedBobbinWeight = Number((c.availWt * ratio).toFixed(3));
            }
            return next;
        }));
    }

    async function handleSubmit() {
        if (crates.length === 0) return;
        if (lotSummary.itemIds.length > 1) {
            alert('Mixed items not allowed');
            return;
        }
        setSubmitting(true);
        try {
            const created = await api.createIssueToHoloMachine({
                date: form.date,
                itemId: lotSummary.itemId,
                lotNo: lotSummary.lotNos[0] || '',
                machineId: form.machineId || null,
                operatorId: form.operatorId || null,
                shift: form.shift || null,
                yarnId: form.yarnId || null,
                twistId: form.twistId || null,
                metallicBobbins: holoTotals.rolls,
                metallicBobbinsWeight: holoTotals.weight,
                yarnKg: Number(form.yarnKg) || holoTotals.weight,
                note: form.note,
                crates: crates.map(c => ({
                    rowId: c.rowId,
                    issuedBobbins: Number(c.issuedBobbins),
                    issuedBobbinWeight: Number(c.issuedBobbinWeight)
                }))
            });
            const template = await loadTemplate(LABEL_STAGE_KEYS.HOLO_ISSUE);
            if (template && created?.issueToHoloMachine) {
                const confirmPrint = window.confirm('Print sticker for this issue?');
                if (confirmPrint) {
                    const machineName = db.machines.find((m) => m.id === form.machineId)?.name;
                    const operatorName = db.operators.find((o) => o.id === form.operatorId)?.name;
                    const itemName = db.items.find((i) => i.id === lotSummary.itemId)?.name;
                    const twistName = db.twists?.find((t) => t.id === form.twistId)?.name;
                    const yarnName = db.yarns?.find((y) => y.id === form.yarnId)?.name;

                    // Get bobbin info from the first crate's source row
                    const firstCrateRow = crates[0]
                        ? (db.receive_from_cutter_machine_rows || []).find(r => !r.isDeleted && r.id === crates[0].rowId)
                        : null;
                    const bobbinType = firstCrateRow?.bobbin?.name || firstCrateRow?.pcsTypeName || '';
                    const cut = firstCrateRow?.cut || firstCrateRow?.cutMaster?.name || '';

                    await printStageTemplate(
                        LABEL_STAGE_KEYS.HOLO_ISSUE,
                        {
                            lotNo: lotSummary.lotLabel || created.issueToHoloMachine.lotNo,
                            barcode: created.issueToHoloMachine.barcode,
                            itemName,
                            machineName,
                            operatorName,
                            shift: form.shift || '',
                            totalRolls: holoTotals.rolls,
                            totalWeight: holoTotals.weight,
                            netWeight: holoTotals.weight,
                            bobbinQty: holoTotals.rolls,
                            bobbinType,
                            cut,
                            yarnKg: created.issueToHoloMachine.yarnKg,
                            twistName,
                            yarnName,
                            date: form.date,
                        },
                        { template },
                    );
                }
            }
            await refreshDb();
            setCrates([]);
            setForm(prev => ({ ...prev, yarnKg: '', note: '' }));
            alert('Issued successfully');
        } catch (e) {
            alert(e.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Issue Parameters</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <Label>Date</Label>
                            <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                        </div>
                        <div>
                            <Label>Machine</Label>
                            <Select
                                value={form.machineId}
                                onChange={e => setForm({ ...form, machineId: e.target.value })}
                                options={(db.machines || []).filter(m => m.processType === 'all' || m.processType === 'holo').map(m => ({ id: m.id, name: m.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Machine"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Operator</Label>
                            <Select
                                value={form.operatorId}
                                onChange={e => setForm({ ...form, operatorId: e.target.value })}
                                options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'holo').map(o => ({ id: o.id, name: o.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Operator"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Shift (Optional)</Label>
                            <Select
                                value={form.shift}
                                onChange={e => setForm({ ...form, shift: e.target.value })}
                                options={[{ value: 'Day', label: 'Day' }, { value: 'Night', label: 'Night' }]}
                                placeholder="Select Shift"
                                clearable
                                searchable={false}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <Label>Yarn</Label>
                            <Select
                                value={form.yarnId}
                                onChange={e => setForm({ ...form, yarnId: e.target.value })}
                                options={(db.yarns || []).map(y => ({ id: y.id, name: y.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Yarn"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Twist</Label>
                            <Select
                                value={form.twistId}
                                onChange={e => setForm({ ...form, twistId: e.target.value })}
                                options={(db.twists || []).map(t => ({ id: t.id, name: t.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Twist"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Total Yarn Kg</Label>
                            <Input type="number" value={form.yarnKg} onChange={e => setForm({ ...form, yarnKg: e.target.value })} placeholder={formatKg(holoTotals.weight)} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <CardTitle>Scan Crates</CardTitle>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Input
                            placeholder="Scan Barcode"
                            value={scanInput}
                            onChange={e => setScanInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleScan()}
                            className="flex-1 sm:w-48"
                        />
                        <Button onClick={handleScan}>Add</Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Barcode</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Cut</TableHead>
                                    <TableHead>Piece</TableHead>
                                    <TableHead className="">Avail Count</TableHead>
                                    <TableHead className="">Issue Count</TableHead>
                                    <TableHead className="">Issue Wt</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {crates.length === 0 ? (
                                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No crates scanned.</TableCell></TableRow>
                                ) : crates.map((c, i) => (
                                    <TableRow key={c.rowId}>
                                        <TableCell className="font-mono">{c.barcode}</TableCell>
                                        <TableCell>{(db.items || []).find(item => item.id === c.itemId)?.name || '—'}</TableCell>
                                        <TableCell>{c.cut || '—'}</TableCell>
                                        <TableCell>{c.pieceId || c.lotNo}</TableCell>
                                        <TableCell className="">{c.availCount}</TableCell>
                                        <TableCell className="">
                                            <Input
                                                type="number"
                                                className="w-24 ml-auto h-8"
                                                value={c.issuedBobbins}
                                                onChange={e => updateCrate(c.rowId, 'issuedBobbins', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell className="">{formatKg(c.issuedBobbinWeight)}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCrates(p => p.filter(x => x.rowId !== c.rowId))}>X</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="mt-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div className="text-sm font-medium">
                            Total Rolls: {holoTotals.rolls} | Total Weight: {formatKg(holoTotals.weight)}
                            {lotSummary.lotLabel ? ` | Lots: ${lotSummary.lotLabel}` : ''}
                        </div>
                        <Button onClick={handleSubmit} disabled={submitting || crates.length === 0} className="w-full sm:w-auto">
                            {submitting ? 'Issuing...' : 'Confirm Issue'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
