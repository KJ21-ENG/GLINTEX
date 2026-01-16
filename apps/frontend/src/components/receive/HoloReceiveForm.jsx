import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';
import { CatchWeightButton } from '../common/CatchWeightButton';

export function HoloReceiveForm() {
    const { db, refreshDb } = useInventory();
    const [searchParams, setSearchParams] = useSearchParams();
    const traceContext = useMemo(() => buildHoloTraceContext(db), [db]);

    const [scanInput, setScanInput] = useState('');
    const [issue, setIssue] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState({
        date: todayISO(),
        machineId: '',
        operatorId: '',
        rollTypeId: '',
        rollCount: '',
        grossWeight: '',
        boxId: '',
        notes: '',
        shift: '',
        pieceId: '',
    });

    // Auto-scan barcode from URL query param (from "Go to Receive" button in OnMachineTable)
    useEffect(() => {
        const barcodeFromUrl = searchParams.get('barcode');
        if (barcodeFromUrl && !issue) {
            // Auto-load the issue
            api.getIssueByHoloBarcode(barcodeFromUrl)
                .then(result => {
                    if (result && result.id) {
                        setIssue(result);
                        // Pre-fill defaults from issue if available
                        setForm(p => ({
                            ...p,
                            machineId: result.machineId || '',
                            operatorId: result.operatorId || '',
                            shift: result.shift || '',
                            pieceId: Array.isArray(result.pieceIds) && result.pieceIds.length > 0 ? result.pieceIds[0] : '',
                        }));
                    } else {
                        alert('Barcode not found or invalid');
                    }
                })
                .catch(err => {
                    alert(err.message || 'Failed to fetch barcode details');
                })
                .finally(() => {
                    // Clear the URL param to prevent re-scan on refresh
                    setSearchParams({}, { replace: true });
                });
        }
    }, [searchParams, issue, setSearchParams]);

    // --- Derived ---
    const selectedBox = db?.boxes?.find(b => b.id === form.boxId);
    const selectedRollType = db?.rollTypes?.find(r => r.id === form.rollTypeId);

    const tareWeight = useMemo(() => {
        const rolls = Number(form.rollCount);
        if (!rolls) return 0;

        let t = 0;
        if (selectedBox) t += selectedBox.weight || 0;
        if (selectedRollType) t += (selectedRollType.weight || 0) * rolls;
        return t;
    }, [form.rollCount, selectedBox, selectedRollType]);

    const netWeight = useMemo(() => {
        const g = Number(form.grossWeight);
        if (!g) return 0;
        return Math.max(0, g - tareWeight);
    }, [form.grossWeight, tareWeight]);

    const pieceOptions = useMemo(() => {
        if (!issue) return [];
        const ids = Array.isArray(issue.pieceIds) ? issue.pieceIds : [];
        return ids.map(pid => {
            const piece = db.inbound_items.find(p => p.id === pid);
            const label = piece ? `${piece.id} (${piece.lotNo})` : pid;
            return { id: pid, name: label };
        });
    }, [issue, db.inbound_items]);

    const selectedPiece = useMemo(() => {
        if (!issue || !form.pieceId) return null;
        return db.inbound_items.find(p => p.id === form.pieceId) || null;
    }, [issue, form.pieceId, db.inbound_items]);

    const cutName = useMemo(() => {
        if (!issue) return '';
        const resolved = resolveHoloTrace(issue, traceContext);
        return resolved.cutName === '—' ? '' : resolved.cutName;
    }, [issue, traceContext]);

    // --- Handlers ---
    async function handleScan() {
        if (!scanInput.trim()) return;
        try {
            const result = await api.getIssueByHoloBarcode(scanInput.trim());
            setIssue(result);

            // Pre-fill defaults from issue if available
            setForm(p => ({
                ...p,
                machineId: result.machineId || '',
                operatorId: result.operatorId || '',
                shift: result.shift || '',
                pieceId: Array.isArray(result.pieceIds) && result.pieceIds.length > 0 ? result.pieceIds[0] : '',
            }));
        } catch (e) {
            alert(e.message);
            setIssue(null);
        } finally {
            setScanInput('');
        }
    }

    async function handleSubmit() {
        if (!issue) return;
        if (!form.pieceId) {
            alert('Select a piece for this receive');
            return;
        }
        setSubmitting(true);
        try {
            const result = await api.manualReceiveFromHoloMachine({
                issueId: issue.id,
                pieceId: form.pieceId,
                rollCount: Number(form.rollCount),
                rollTypeId: form.rollTypeId,
                boxId: form.boxId,
                grossWeight: Number(form.grossWeight),
                crateTareWeight: 0, // Handled in net calculation implicitly by backend usually, but we send what we have
                date: form.date,
                machineNo: db.machines.find(m => m.id === form.machineId)?.name,
                operatorId: form.operatorId,
                shift: form.shift,
                notes: form.notes
            });
            const template = await loadTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE);
            if (template && result?.row) {
                const confirmPrint = window.confirm('Print sticker for this receive?');
                if (confirmPrint) {
                    const rollTypeName = db?.rollTypes?.find((r) => r.id === form.rollTypeId)?.name;
                    const boxName = db?.boxes?.find((b) => b.id === form.boxId)?.name;
                    const operatorName = db?.operators?.find((o) => o.id === form.operatorId)?.name;
                    const machineName = db?.machines?.find((m) => m.id === form.machineId)?.name;
                    const itemName = selectedPiece
                        ? db?.items?.find((i) => i.id === selectedPiece.itemId)?.name
                        : db?.items?.find((i) => i.id === issue.itemId)?.name;
                    const yarnName = db?.yarns?.find((y) => y.id === issue.yarnId)?.name;
                    const twist = db?.twists?.find((t) => t.id === issue.twistId)?.name;

                    const resolved = resolveHoloTrace(issue, traceContext);
                    const cutName = resolved.cutName === '—' ? '' : resolved.cutName;

                    await printStageTemplate(
                        LABEL_STAGE_KEYS.HOLO_RECEIVE,
                        {
                            lotNo: selectedPiece?.lotNo || issue.lotLabel || issue.lotNo,
                            barcode: result.row.barcode,
                            rollCount: form.rollCount,
                            grossWeight: form.grossWeight,
                            tareWeight,
                            netWeight,
                            rollType: rollTypeName,
                            boxName,
                            operatorName,
                            machineName,
                            itemName,
                            yarnName,
                            twist: twist || '',
                            twistName: twist || '',
                            cut: cutName,
                            shift: form.shift,
                            date: form.date,
                        },
                        { template },
                    );
                }
            }
            await refreshDb();
            alert('Received successfully');

            // Reset partial form
            setForm(p => ({ ...p, rollCount: '', grossWeight: '' }));
        } catch (e) {
            alert(e.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <CardTitle>Scan Issue</CardTitle>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Input
                            placeholder="Scan Issue Barcode (HLO-...)"
                            value={scanInput}
                            onChange={e => setScanInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleScan()}
                            className="flex-1 sm:w-64"
                        />
                        <Button onClick={handleScan}>Load</Button>
                    </div>
                </CardHeader>
                {issue && (
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-muted rounded-md text-sm">
                            <div><strong>Lot:</strong> {issue.lotLabel || issue.lotNo}</div>
                            <div><strong>Item:</strong> {db?.items?.find(i => i.id === issue.itemId)?.name || issue.itemId}</div>
                            <div><strong>Cut:</strong> {cutName || '—'}</div>
                            <div><strong>Yarn:</strong> {db?.yarns?.find(y => y.id === issue.yarnId)?.name || '—'}</div>
                            <div><strong>Twist:</strong> {db?.twists?.find(t => t.id === issue.twistId)?.name || '—'}</div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                            <div>
                                <Label>Piece / Lot</Label>
                                <Select
                                    value={form.pieceId}
                                    onChange={e => setForm({ ...form, pieceId: e.target.value })}
                                    options={pieceOptions}
                                    labelKey="name"
                                    valueKey="id"
                                    placeholder="Select Piece"
                                />
                            </div>
                            <div>
                                <Label>Machine</Label>
                                <Select
                                    value={form.machineId}
                                    onChange={e => setForm({ ...form, machineId: e.target.value })}
                                    options={(db?.machines || []).filter(m => m.processType === 'all' || m.processType === 'holo').map(m => ({ id: m.id, name: m.name }))}
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
                                    options={(db?.operators || []).filter(o => o.processType === 'all' || o.processType === 'holo').map(o => ({ id: o.id, name: o.name }))}
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
                                    options={[{ id: 'Day', name: 'Day' }, { id: 'Night', name: 'Night' }]}
                                    labelKey="name"
                                    valueKey="id"
                                    placeholder="Select Shift"
                                    clearable
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                                <Label>Roll Type</Label>
                                <Select
                                    value={form.rollTypeId}
                                    onChange={e => setForm({ ...form, rollTypeId: e.target.value })}
                                    options={(db?.rollTypes || []).map(r => ({ id: r.id, name: r.name }))}
                                    labelKey="name"
                                    valueKey="id"
                                    placeholder="Select Roll Type"
                                    clearable
                                />
                            </div>
                            <div>
                                <Label>Box</Label>
                                <Select
                                    value={form.boxId}
                                    onChange={e => setForm({ ...form, boxId: e.target.value })}
                                    options={(db?.boxes || []).filter(b => b.processType === 'all' || b.processType === 'holo').map(b => ({ id: b.id, name: b.name }))}
                                    labelKey="name"
                                    valueKey="id"
                                    placeholder="Select Box"
                                    clearable
                                />
                            </div>
                            <div>
                                <Label>Roll Count</Label>
                                <Input type="number" value={form.rollCount} onChange={e => setForm({ ...form, rollCount: e.target.value })} />
                            </div>
                            <div>
                                <Label>Gross Weight</Label>
                                <div className="flex gap-2">
                                    <Input type="number" value={form.grossWeight} onChange={e => setForm({ ...form, grossWeight: e.target.value })} className="flex-1" />
                                    <CatchWeightButton onWeightCaptured={(wt) => setForm({ ...form, grossWeight: wt.toFixed(3) })} />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between sm:items-center pt-4 border-t gap-4">
                            <div className="text-sm">
                                Tare: {formatKg(tareWeight)} | <span className="font-bold">Net: {formatKg(netWeight)}</span>
                            </div>
                            <Button onClick={handleSubmit} disabled={submitting || !netWeight} className="w-full sm:w-auto">Save Receive</Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
