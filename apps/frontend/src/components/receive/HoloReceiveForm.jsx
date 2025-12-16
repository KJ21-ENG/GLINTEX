import React, { useState, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { CatchWeightButton } from '../common/CatchWeightButton';

export function HoloReceiveForm() {
    const { db, refreshDb } = useInventory();

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
        notes: ''
    });

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

    const selectedPiece = useMemo(() => {
        if (!issue) return null;
        // Default to first piece for now if multiple, assuming single piece workflow primarily
        const pid = issue.pieceIds?.[0];
        return db.inbound_items.find(p => p.id === pid);
    }, [issue, db.inbound_items]);

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
                operatorId: result.operatorId || ''
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
        setSubmitting(true);
        try {
            const result = await api.manualReceiveFromHoloMachine({
                issueId: issue.id,
                pieceId: selectedPiece?.id, // Should be selected from issue crates ideally
                rollCount: Number(form.rollCount),
                rollTypeId: form.rollTypeId,
                boxId: form.boxId,
                grossWeight: Number(form.grossWeight),
                crateTareWeight: 0, // Handled in net calculation implicitly by backend usually, but we send what we have
                date: form.date,
                machineNo: db.machines.find(m => m.id === form.machineId)?.name,
                operatorId: form.operatorId,
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
                    const itemName = db?.items?.find((i) => i.id === issue.itemId)?.name;
                    const yarnName = db?.yarns?.find((y) => y.id === issue.yarnId)?.name;

                    // Resolve Cut from issue's source rows
                    let cutName = '';
                    try {
                        const refs = typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue.receivedRowRefs;
                        if (Array.isArray(refs) && refs.length > 0) {
                            const firstRowId = refs[0].rowId;
                            const sourceRow = db.receive_from_cutter_machine_rows?.find(r => r.id === firstRowId);
                            if (sourceRow) {
                                cutName = sourceRow.cut?.name || sourceRow.cutMaster?.name || db.cuts?.find(c => c.id === sourceRow.cutId)?.name || '';
                            }
                        }
                    } catch (e) { console.error('Error resolving cut', e); }

                    await printStageTemplate(
                        LABEL_STAGE_KEYS.HOLO_RECEIVE,
                        {
                            lotNo: issue.lotNo,
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
                            cut: cutName,
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
                <CardHeader className="flex flex-row justify-between items-center">
                    <CardTitle>Scan Issue</CardTitle>
                    <div className="flex gap-2">
                        <Input
                            placeholder="Scan Issue Barcode (HLO-...)"
                            value={scanInput}
                            onChange={e => setScanInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleScan()}
                            className="w-64"
                        />
                        <Button onClick={handleScan}>Load</Button>
                    </div>
                </CardHeader>
                {issue && (
                    <CardContent className="space-y-6">
                        <div className="flex gap-4 p-4 bg-muted rounded-md text-sm">
                            <div><strong>Lot:</strong> {issue.lotNo}</div>
                            <div><strong>Item:</strong> {issue.itemId}</div>
                            <div><strong>Yarn:</strong> {db?.yarns?.find(y => y.id === issue.yarnId)?.name}</div>
                            <div><strong>Twist:</strong> {db?.twists?.find(t => t.id === issue.twistId)?.name}</div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                            <div>
                                <Label>Machine</Label>
                                <Select
                                    value={form.machineId}
                                    onChange={e => setForm({ ...form, machineId: e.target.value })}
                                    options={(db?.machines || []).map(m => ({ id: m.id, name: m.name }))}
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
                                    options={(db?.operators || []).map(o => ({ id: o.id, name: o.name }))}
                                    labelKey="name"
                                    valueKey="id"
                                    placeholder="Select Operator"
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
                                    options={(db?.boxes || []).map(b => ({ id: b.id, name: b.name }))}
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

                        <div className="flex justify-between items-center pt-4 border-t">
                            <div className="text-sm">
                                Tare: {formatKg(tareWeight)} | <span className="font-bold">Net: {formatKg(netWeight)}</span>
                            </div>
                            <Button onClick={handleSubmit} disabled={submitting || !netWeight}>Save Receive</Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
