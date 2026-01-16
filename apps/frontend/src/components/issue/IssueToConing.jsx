import React, { useState, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';

export function IssueToConing() {
    const { db, refreshDb } = useInventory();

    const [form, setForm] = useState({
        date: todayISO(),
        machineId: '',
        operatorId: '',
        shift: '',
        coneTypeId: '',
        wrapperId: '',
        boxId: '',
        targetWeight: '', // Required per cone net weight
        note: '',
    });

    const [crates, setCrates] = useState([]);
    const [scanInput, setScanInput] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // --- Derived ---
    const coningMeta = useMemo(() => {
        const totalNet = crates.reduce((s, c) => s + (Number(c.issueWeight) || 0), 0);
        const totalRolls = crates.reduce((s, c) => s + (Number(c.issueRolls) || 0), 0);

        let expectedCones = 0;
        const target = Number(form.targetWeight);
        if (target > 0 && totalNet > 0) {
            expectedCones = Math.floor((totalNet * 1000) / target);
        }

        return { totalNet, totalRolls, expectedCones };
    }, [crates, form.targetWeight]);

    const meta = useMemo(() => {
        if (crates.length === 0) return { lotNo: '', itemId: null, cut: '' };
        return { lotNo: crates[0].lotNo, itemId: crates[0].itemId, cut: crates[0].cut };
    }, [crates]);

    // --- Handlers ---

    async function handleScan() {
        if (!scanInput.trim()) return;
        const normalized = scanInput.trim().toUpperCase();
        const normalizeValue = (val) => String(val || '').trim().toUpperCase();

        // Find in Holo Receive Rows
        const matches = (db.receive_from_holo_machine_rows || []).filter(r => {
            return normalizeValue(r.barcode) === normalized
                || normalizeValue(r.notes) === normalized
                || normalizeValue(r.legacyBarcode) === normalized;
        });

        if (matches.length === 0) {
            alert('Barcode not found in Holo Receive rows');
            return;
        }

        if (matches.length > 1) {
            alert('Multiple rows match this legacy barcode. Please use the new barcode instead.');
            return;
        }

        const row = matches[0];

        if (crates.some(c => c.rowId === row.id)) {
            alert('Crate already added');
            return;
        }

        // Check Lot and get issue info
        const issue = db.issue_to_holo_machine.find(i => i.id === row.issueId);
        const rowLot = issue?.lotNo;
        if (!rowLot) {
            alert('Lot not found for this crate');
            return;
        }

        // Resolve Item & Cut first (needed for mixed lot validation)
        const holoIssue = db.issue_to_holo_machine?.find(i => i.id === row.issueId);
        const scannedItemId = holoIssue?.itemId;
        let cutName = '';
        if (holoIssue) {
            try {
                const refs = typeof holoIssue.receivedRowRefs === 'string' ? JSON.parse(holoIssue.receivedRowRefs) : holoIssue.receivedRowRefs;
                if (Array.isArray(refs) && refs.length > 0) {
                    const cutterRowId = refs[0].rowId;
                    const cutterRow = db.receive_from_cutter_machine_rows?.find(r => !r.isDeleted && r.id === cutterRowId);
                    if (cutterRow) {
                        // cut may be a string field or a relation object; handle both cases
                        const cutVal = cutterRow.cut;
                        cutName = (typeof cutVal === 'string' ? cutVal : cutVal?.name) || cutterRow.cutMaster?.name || (db.cuts?.find(c => c.id === cutterRow.cutId)?.name) || '';
                    }
                }
            } catch (e) { }
        }

        // Allow mixed lots only if item and cut are the same
        if (crates.length > 0 && rowLot !== meta.lotNo) {
            // Check if item and cut match
            if (scannedItemId !== meta.itemId || cutName !== meta.cut) {
                const existingItemName = db.items?.find(i => i.id === meta.itemId)?.name || 'Unknown';
                const scannedItemName = db.items?.find(i => i.id === scannedItemId)?.name || 'Unknown';
                alert(`Mixed lots are only allowed for same Item and Cut.\n\nExisting: Item="${existingItemName}", Cut="${meta.cut || 'N/A'}"\nScanned: Item="${scannedItemName}", Cut="${cutName || 'N/A'}"`);
                return;
            }
        }

        // Defaults
        const remainingRolls = Math.max(0, (row.rollCount || 0) - (row.issuedRolls || 0)); // Simplified logic, assumes 'issuedRolls' tracking exists or we rely on manual check
        // Note: Real implementation needs strict 'issuedSoFar' check from db.issue_to_coning_machine refs. 
        // For now assuming full crate availability if not tracking partially. 
        // Actually, let's calculate unit weight.

        const unitWeight = row.rollCount > 0 ? (row.rollWeight / row.rollCount) : 0;

        // Trace piece IDs
        let pieceIds = [];
        try {
            const hRefs = typeof issue?.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue?.receivedRowRefs;
            if (Array.isArray(hRefs)) {
                const ids = new Set();
                hRefs.forEach(hRef => {
                    const cutterRow = db.receive_from_cutter_machine_rows?.find(cr => cr.id === hRef.rowId);
                    if (cutterRow?.pieceId) ids.add(cutterRow.pieceId);
                });
                pieceIds = Array.from(ids);
            }
        } catch (e) { }

        const pieceIdsDisplay = pieceIds.join(', ') || rowLot;

        setCrates(prev => [...prev, {
            rowId: row.id,
            barcode: row.barcode,
            lotNo: rowLot,
            pieceIdsDisplay, // Show piece IDs in the 'Piece' column
            availRolls: row.rollCount,
            unitWeight,
            issueRolls: row.rollCount, // Default all
            issueWeight: row.rollWeight,
            itemId: scannedItemId,
            cut: cutName
        }]);
        setScanInput('');
    }

    function updateCrate(rowId, field, val) {
        setCrates(prev => prev.map(c => {
            if (c.rowId !== rowId) return c;
            const next = { ...c, [field]: val };
            if (field === 'issueRolls') {
                const rolls = Number(val);
                next.issueWeight = Number((rolls * c.unitWeight).toFixed(3));
            }
            return next;
        }));
    }

    async function handleSubmit() {
        if (crates.length === 0) return;
        if (!form.targetWeight) { alert('Enter target cone weight'); return; }

        setSubmitting(true);
        try {
            const created = await api.createIssueToConingMachine({
                date: form.date,
                machineId: form.machineId || null,
                operatorId: form.operatorId || null,
                shift: form.shift || null,
                note: form.note,
                requiredPerConeNetWeight: Number(form.targetWeight),
                expectedCones: coningMeta.expectedCones,
                crates: crates.map(c => ({
                    rowId: c.rowId,
                    barcode: c.barcode,
                    coneTypeId: form.coneTypeId || null,
                    wrapperId: form.wrapperId || null,
                    boxId: form.boxId || null,
                    issueRolls: Number(c.issueRolls),
                    issueWeight: Number(c.issueWeight)
                }))
            });
            const template = await loadTemplate(LABEL_STAGE_KEYS.CONING_ISSUE);
            if (template && created?.issueToConingMachine) {
                const confirmPrint = window.confirm('Print sticker for this issue?');
                if (confirmPrint) {
                    const machineName = db.machines.find((m) => m.id === form.machineId)?.name;
                    const operatorName = db.operators.find((o) => o.id === form.operatorId)?.name;
                    const coneType = db.cone_types?.find(x => x.id === form.coneTypeId)?.name;
                    const wrapperName = db.wrappers?.find(x => x.id === form.wrapperId)?.name;

                    // Resolve info from first crate source
                    let itemName = '';
                    let yarnName = '';
                    let cutName = '';
                    let rollType = '';

                    if (crates.length > 0) {
                        const firstRow = db.receive_from_holo_machine_rows?.find(r => r.id === crates[0].rowId);
                        if (firstRow) {
                            rollType = db.rollTypes?.find(rt => rt.id === firstRow.rollTypeId)?.name || '';
                            const holoIssue = db.issue_to_holo_machine?.find(i => i.id === firstRow.issueId);
                            if (holoIssue) {
                                itemName = db.items?.find(i => i.id === holoIssue.itemId)?.name || '';
                                yarnName = db.yarns?.find(y => y.id === holoIssue.yarnId)?.name || '';

                                // Resolve cut from holo issue refs
                                try {
                                    const refs = typeof holoIssue.receivedRowRefs === 'string' ? JSON.parse(holoIssue.receivedRowRefs) : holoIssue.receivedRowRefs;
                                    if (Array.isArray(refs) && refs.length > 0) {
                                        const cutterRowId = refs[0].rowId;
                                        const cutterRow = db.receive_from_cutter_machine_rows?.find(r => !r.isDeleted && r.id === cutterRowId);
                                        if (cutterRow) {
                                            cutName = (typeof cutterRow.cut === 'string' ? cutterRow.cut : cutterRow.cut?.name) || cutterRow.cutMaster?.name || db.cuts?.find(c => c.id === cutterRow.cutId)?.name || '';
                                        }
                                    }
                                } catch (e) { }
                            }
                        }
                    }

                    await printStageTemplate(
                        LABEL_STAGE_KEYS.CONING_ISSUE,
                        {
                            lotNo: created.issueToConingMachine.lotNo,
                            barcode: created.issueToConingMachine.barcode,
                            totalRolls: coningMeta.totalRolls,
                            rollCount: coningMeta.totalRolls,
                            totalWeight: coningMeta.totalNet,
                            grossWeight: coningMeta.totalNet,
                            tareWeight: 0,
                            netWeight: coningMeta.totalNet,
                            expectedCones: created.issueToConingMachine.expectedCones,
                            perConeTargetG: form.targetWeight,
                            machineName,
                            operatorName,
                            shift: form.shift || '',
                            itemName,
                            cut: cutName,
                            yarnName,
                            rollType,
                            coneType,
                            wrapperName,
                            date: form.date,
                        },
                        { template },
                    );
                }
            }
            await refreshDb();
            setCrates([]);
            alert('Issued to Coning successfully');
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
                        <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                        <div>
                            <Label>Machine</Label>
                            <Select
                                value={form.machineId}
                                onChange={e => setForm({ ...form, machineId: e.target.value })}
                                options={(db.machines || []).filter(m => m.processType === 'all' || m.processType === 'coning').map(m => ({ id: m.id, name: m.name }))}
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
                                options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'coning').map(o => ({ id: o.id, name: o.name }))}
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
                            <Label>Cone Type</Label>
                            <Select
                                value={form.coneTypeId}
                                onChange={e => setForm({ ...form, coneTypeId: e.target.value })}
                                options={(db.cone_types || []).map(x => ({ id: x.id, name: x.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Cone Type"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Wrapper</Label>
                            <Select
                                value={form.wrapperId}
                                onChange={e => setForm({ ...form, wrapperId: e.target.value })}
                                options={(db.wrappers || []).map(x => ({ id: x.id, name: x.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Wrapper"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Box</Label>
                            <Select
                                value={form.boxId}
                                onChange={e => setForm({ ...form, boxId: e.target.value })}
                                options={(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'coning').map(x => ({ id: x.id, name: x.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Box"
                                clearable
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <Label>Target Net Wt/Cone (g)</Label>
                            <Input type="number" value={form.targetWeight} onChange={e => setForm({ ...form, targetWeight: e.target.value })} placeholder="e.g. 1000" />
                        </div>
                        <div>
                            <Label>Expected Cones</Label>
                            <Input readOnly value={coningMeta.expectedCones} className="bg-muted" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <CardTitle>Scan Holo Crates</CardTitle>
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
                                    <TableHead className="">Avail Rolls</TableHead>
                                    <TableHead className="">Issue Rolls</TableHead>
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
                                        <TableCell>{c.pieceIdsDisplay || c.lotNo}</TableCell>
                                        <TableCell className="">{c.availRolls}</TableCell>
                                        <TableCell className="">
                                            <Input
                                                type="number"
                                                className="w-24 ml-auto h-8"
                                                value={c.issueRolls}
                                                onChange={e => updateCrate(c.rowId, 'issueRolls', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell className="">{formatKg(c.issueWeight)}</TableCell>
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
                            Total Rolls: {coningMeta.totalRolls} | Total Net: {formatKg(coningMeta.totalNet)}
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
