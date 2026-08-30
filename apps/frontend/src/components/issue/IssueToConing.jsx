import React, { useEffect, useState, useMemo } from 'react';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { BarcodeScanDialog } from '../scanner/BarcodeScanDialog';
import { useSubmitLock } from '../../hooks/useSubmitLock';
import { useUnsavedGuard } from '../../context/UnsavedChangesContext';

export function IssueToConing() {
    const { db, emitInvalidation } = useInventory();

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
    const [scanLoading, setScanLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [, wrapSubmit] = useSubmitLock();
    // Issue parameters are retained after a successful issue — only the staged
    // crates count as unsaved.
    useUnsavedGuard('issue-to-coning', crates.length > 0);
    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanFeedback, setScanFeedback] = useState(null);

    useEffect(() => {
        if (!scanFeedback) return;
        const t = setTimeout(() => setScanFeedback(null), 2000);
        return () => clearTimeout(t);
    }, [scanFeedback]);

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
        if (crates.length === 0) return { lotNo: '', itemId: null, cut: '', yarnId: null };
        return { lotNo: crates[0].lotNo, itemId: crates[0].itemId, cut: crates[0].cut, yarnId: crates[0].yarnId };
    }, [crates]);

    // --- Handlers ---

    const normalizeValue = (val) => String(val || '').trim().toUpperCase();
    const findItemName = (itemId, fallback = '') => (db.items || []).find(i => i.id === itemId)?.name || fallback || 'Unknown';
    const findYarnName = (yarnId, fallback = '') => (db.yarns || []).find(y => y.id === yarnId)?.name || fallback || 'Unknown';

    function normalizeServerLookup(result) {
        if (!result || result.outcome !== 'found') {
            return { error: result?.error || 'Barcode not found in Holo or Coning Receive rows' };
        }
        const row = result.row || {};
        const issue = result.issue || row.issue || null;
        const trace = result.trace || {};
        const pieceIds = Array.isArray(result.pieceIds)
            ? result.pieceIds
            : (Array.isArray(row.computedPieceIds) ? row.computedPieceIds : []);
        return {
            row: { ...row, issueId: row.issueId || issue?.id },
            issue,
            trace,
            pieceIds,
            itemName: issue?.itemName || result.item?.name || row.itemName || trace.itemName || findItemName(issue?.itemId, ''),
            yarnName: trace.yarnName || issue?.yarnName || row.yarnName || findYarnName(issue?.yarnId, ''),
            cutId: row.cutId || issue?.cutId || trace.cutId || null,
            twistId: row.twistId || issue?.twistId || trace.twistId || null,
            twistName: row.twistName || issue?.twistName || trace.twistName || '',
            rollTypeId: row.rollTypeId || row.rollType?.id || trace.rollTypeId || null,
            rollTypeName: row.rollTypeName || row.rollType?.name || trace.rollTypeName || result.rollType?.name || '',
            rollTypeWeight: Number(row.rollTypeWeight ?? row.rollType?.weight ?? trace.rollTypeWeight ?? 0),
            boxId: row.boxId || row.box?.id || null,
            boxName: row.boxName || row.box?.name || '',
            boxWeight: Number(row.boxWeight ?? row.box?.weight ?? 0),
            grossWeight: Number(row.grossWeight ?? 0),
            tareWeight: Number(row.tareWeight ?? 0),
            availability: result.availability || {
                totalRolls: row.rollCount || 0,
                totalWeight: row.rollWeight || 0,
                availableRolls: row.availableRolls || 0,
                availableWeight: row.availableWeight || 0,
            },
        };
    }

    async function resolveScannedCrate(normalized) {
        try {
            const result = await api.lookupConingSourceRowByBarcode(normalized);
            return normalizeServerLookup(result);
        } catch (e) {
            return { error: e.message || 'Barcode not found in Holo or Coning Receive rows' };
        }
    }

    async function addBarcode(raw) {
        if (scanLoading) return;
        const normalized = normalizeValue(raw);
        if (!normalized) return;

        setScanLoading(true);
        try {
            const lookup = await resolveScannedCrate(normalized);
            if (lookup?.error) {
                alert(lookup.error);
                return;
            }

            const { row, issue, availability, trace, pieceIds, itemName, yarnName, rollTypeName } = lookup;

            if (crates.some(c => c.rowId === row.id)) {
                alert('Crate already added');
                return;
            }

            const rowLot = issue?.lotNo || row.issue?.lotNo;
            if (!rowLot) {
                alert('Lot not found for this crate');
                return;
            }

            const scannedItemId = issue?.itemId || row.issue?.itemId;
            const scannedYarnId = issue?.yarnId || row.issue?.yarnId || null;
            const cutName = trace?.cutName && trace.cutName !== '—' ? trace.cutName : '';

            if (crates.length > 0 && rowLot !== meta.lotNo) {
                if (scannedItemId !== meta.itemId || cutName !== meta.cut) {
                    const existingItemName = findItemName(meta.itemId);
                    const scannedItemName = itemName || findItemName(scannedItemId);
                    alert(`Mixed lots are only allowed for same Item and Cut.\n\nExisting: Item="${existingItemName}", Cut="${meta.cut || 'N/A'}"\nScanned: Item="${scannedItemName}", Cut="${cutName || 'N/A'}"`);
                    return;
                }
            }

            if (crates.length > 0 && scannedYarnId && meta.yarnId && scannedYarnId !== meta.yarnId) {
                const existingYarnName = findYarnName(meta.yarnId);
                const scannedYarnName = yarnName || findYarnName(scannedYarnId);
                alert(`Crates must belong to a single yarn.\n\nExisting: "${existingYarnName}"\nScanned: "${scannedYarnName}"`);
                return;
            }

            const totalRolls = Number(availability?.totalRolls ?? row.rollCount ?? 0);
            const totalWeight = Number(availability?.totalWeight ?? row.rollWeight ?? row.netWeight ?? 0);
            const availableRolls = Number(availability?.availableRolls ?? row.availableRolls ?? 0);
            const availableWeight = Number(availability?.availableWeight ?? row.availableWeight ?? 0);

            if (availableRolls <= 0 || availableWeight <= 0) {
                alert('No rolls available for issue (may have been dispatched or already issued).');
                setScanInput('');
                return;
            }

            const unitWeight = totalRolls > 0 ? (totalWeight / totalRolls) : 0;
            const defaultIssueWeight = Number(availableWeight.toFixed(3));
            const pieceIdsDisplay = (pieceIds || []).join(', ') || rowLot;

            setCrates(prev => [...prev, {
                rowId: row.id,
                barcode: row.barcode,
                lotNo: rowLot,
                pieceIdsDisplay,
                availRolls: availableRolls,
                unitWeight,
                issueRolls: availableRolls,
                issueWeight: defaultIssueWeight,
                itemId: scannedItemId,
                itemName,
                cutId: lookup.cutId,
                cut: cutName,
                yarnId: scannedYarnId,
                yarnName,
                twistId: lookup.twistId,
                twistName: lookup.twistName,
                rollTypeId: lookup.rollTypeId,
                rollTypeName,
                rollTypeWeight: lookup.rollTypeWeight,
                boxId: lookup.boxId,
                boxName: lookup.boxName,
                boxWeight: lookup.boxWeight,
                grossWeight: lookup.grossWeight,
                tareWeight: lookup.tareWeight,
                totalRolls,
                totalWeight,
                issueId: row.issueId || issue?.id || null,
                pieceIds: pieceIds || [],
                trace,
                source: { row, issue, availability, trace, pieceIds },
            }]);
            setScanInput('');
            setScanFeedback(`Added ${normalized}`);
        } finally {
            setScanLoading(false);
        }
    }

    async function handleScan() {
        return await addBarcode(scanInput);
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

    async function offerPostCommitPrint(created, snapshot) {
        try {
            const issue = created?.issueToConingMachine;
            if (!issue) return;
            const template = await loadTemplate(LABEL_STAGE_KEYS.CONING_ISSUE);
            if (!template || !window.confirm('Print sticker for this issue?')) return;

            await printStageTemplate(
                LABEL_STAGE_KEYS.CONING_ISSUE,
                {
                    lotNo: issue.lotNo,
                    barcode: issue.barcode,
                    totalRolls: snapshot.totalRolls,
                    rollCount: snapshot.totalRolls,
                    totalWeight: snapshot.totalWeight,
                    grossWeight: null,
                    tareWeight: null,
                    netWeight: snapshot.totalWeight,
                    expectedCones: issue.expectedCones,
                    perConeTargetG: snapshot.targetWeight,
                    machineName: snapshot.machineName,
                    operatorName: snapshot.operatorName,
                    shift: snapshot.shift,
                    itemName: snapshot.itemName,
                    cut: snapshot.cut,
                    yarnName: snapshot.yarnName,
                    rollType: snapshot.rollType,
                    coneType: snapshot.coneType,
                    wrapperName: snapshot.wrapperName,
                    date: snapshot.date,
                },
                { template },
            );
        } catch (error) {
            console.error('Coning issue was saved but its label could not be printed', error);
            alert('Issue was saved, but the label could not be printed. You can reprint it from Issue History.');
        }
    }

    const handleSubmit = wrapSubmit(async () => {
        if (crates.length === 0) return;
        if (!form.targetWeight) { alert('Enter target cone weight'); return; }

        const distinctNames = (field) => Array.from(new Set(crates.map((crate) => String(crate[field] || '').trim()).filter(Boolean))).join(', ');
        const labelSnapshot = {
            machineName: (db.machines || []).find((machine) => machine.id === form.machineId)?.name || '',
            operatorName: (db.operators || []).find((operator) => operator.id === form.operatorId)?.name || '',
            coneType: (db.cone_types || []).find((cone) => cone.id === form.coneTypeId)?.name || '',
            wrapperName: (db.wrappers || []).find((wrapper) => wrapper.id === form.wrapperId)?.name || '',
            itemName: distinctNames('itemName'),
            cut: distinctNames('cut'),
            yarnName: distinctNames('yarnName'),
            rollType: distinctNames('rollTypeName'),
            totalRolls: coningMeta.totalRolls,
            totalWeight: coningMeta.totalNet,
            targetWeight: form.targetWeight,
            shift: form.shift || '',
            date: form.date,
        };
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
            emitInvalidation([
                INVENTORY_INVALIDATION_KEYS.issueOnMachine('coning'),
                INVENTORY_INVALIDATION_KEYS.issueHistory('coning'),
            ], { source: 'createIssueToConingMachine' });
            setCrates([]);
            alert('Issued to Coning successfully');
            void offerPostCommitPrint(created, labelSnapshot);
        } catch (e) {
            alert(e.message);
        } finally {
            setSubmitting(false);
        }
    });

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
                    <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full sm:w-auto">
                        <Input
                            placeholder="Scan Barcode"
                            value={scanInput}
                            onChange={e => setScanInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleScan()}
                            disabled={scanLoading}
                            className="flex-1 sm:w-48"
                        />
                        <Button onClick={handleScan} disabled={scanLoading}>{scanLoading ? 'Adding...' : 'Add'}</Button>
                        <Button type="button" className="md:hidden" onClick={() => setScanDialogOpen(true)} disabled={scanLoading}>
                            Scan
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {scanFeedback && (
                        <div className="mb-2 text-xs text-green-600">{scanFeedback}</div>
                    )}
                    <div className="border rounded-md overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Barcode</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Cut</TableHead>
                                    <TableHead>Piece</TableHead>
                                    <TableHead className="text-right">Avail Rolls</TableHead>
                                    <TableHead className="text-right">Issue Rolls</TableHead>
                                    <TableHead className="text-right">Issue Wt</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {crates.length === 0 ? (
                                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No crates scanned.</TableCell></TableRow>
                                ) : crates.map((c, i) => (
                                    <TableRow key={c.rowId}>
                                        <TableCell className="font-mono">{c.barcode}</TableCell>
                                        <TableCell>{c.itemName || (db.items || []).find(item => item.id === c.itemId)?.name || '—'}</TableCell>
                                        <TableCell>{c.cut || '—'}</TableCell>
                                        <TableCell>{c.pieceIdsDisplay || c.lotNo}</TableCell>
                                        <TableCell className="text-right tabular-nums">{c.availRolls}</TableCell>
                                        <TableCell className="">
                                            <Input
                                                type="number"
                                                className="w-24 ml-auto h-8"
                                                value={c.issueRolls}
                                                onChange={e => updateCrate(c.rowId, 'issueRolls', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(c.issueWeight)}</TableCell>
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

            <BarcodeScanDialog
                open={scanDialogOpen}
                onOpenChange={setScanDialogOpen}
                onScanned={(code) => {
                    setScanDialogOpen(false);
                    setScanInput(code);
                    addBarcode(code);
                }}
            />
        </div>
    );
}
