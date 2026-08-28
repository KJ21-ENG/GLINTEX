import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';
import { CatchWeightButton } from '../common/CatchWeightButton';
import { useSubmitLock } from '../../hooks/useSubmitLock';
import { useUnsavedGuard } from '../../context/UnsavedChangesContext';
import { chooseLatestIssueBalance } from '../../utils/issueBalance';
import {
    ResizableIssueSummary,
    ReceiveSummaryGroup,
    ReceiveSummaryMetricCard,
    receiveSummaryMetricGridStyle,
    RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG,
} from './ResizableIssueSummary';

export function HoloReceiveForm() {
    const { db, patchDb, emitInvalidation } = useInventory();
    const [searchParams, setSearchParams] = useSearchParams();
    const traceContext = useMemo(() => buildHoloTraceContext(db), [db]);

    const [scanInput, setScanInput] = useState('');
    const [issue, setIssue] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [, wrapSubmit] = useSubmitLock();
    const [template, setTemplate] = useState(null);

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
    // `issue` and notes/box are deliberately retained after a successful save
    // (next crate reuses them) — only the in-progress entry counts as unsaved.
    useUnsavedGuard('receive-holo', !!form.rollCount || !!form.grossWeight);

    const enrichIssueWithBalance = (rawIssue) => {
        if (!rawIssue?.id) return rawIssue;
        return {
            ...rawIssue,
            issueBalance: chooseLatestIssueBalance(rawIssue.issueBalance, db?.issue_balances?.[rawIssue.id]),
        };
    };

    // Preload template once to avoid a network fetch on every receive save.
    useEffect(() => {
        let alive = true;
        (async () => {
            const tpl = await loadTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE);
            if (alive) setTemplate(tpl || null);
        })();
        return () => { alive = false; };
    }, []);

    // Auto-scan barcode from URL query param (from "Go to Receive" button in OnMachineTable)
    useEffect(() => {
        const barcodeFromUrl = searchParams.get('barcode');
        if (barcodeFromUrl && !issue) {
            setScanInput(barcodeFromUrl);
            // Auto-load the issue
            api.getIssueByHoloBarcode(barcodeFromUrl)
                .then(result => {
                    if (result && result.id) {
                        const enriched = enrichIssueWithBalance(result);
                        setIssue(enriched);
                        // Pre-fill defaults from issue if available
                        setForm(p => ({
                            ...p,
                            machineId: enriched.machineId || '',
                            operatorId: enriched.operatorId || '',
                            shift: enriched.shift || '',
                            pieceId: Array.isArray(enriched.pieceIds) && enriched.pieceIds.length > 0 ? enriched.pieceIds[0] : '',
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
            const piece = (Array.isArray(issue.pieces) ? issue.pieces : []).find(p => p.id === pid)
                || db.inbound_items.find(p => p.id === pid);
            const label = piece ? `${piece.id} (${piece.lotNo})` : pid;
            return { id: pid, name: label };
        });
    }, [issue, db.inbound_items]);

    const selectedPiece = useMemo(() => {
        if (!issue || !form.pieceId) return null;
        return (Array.isArray(issue.pieces) ? issue.pieces : []).find(p => p.id === form.pieceId)
            || db.inbound_items.find(p => p.id === form.pieceId)
            || null;
    }, [issue, form.pieceId, db.inbound_items]);

    const cutName = useMemo(() => {
        if (!issue) return '';
        const resolved = resolveHoloTrace(issue, traceContext);
        return resolved.cutName === '—' ? '' : resolved.cutName;
    }, [issue, traceContext]);

    const issueMetrics = useMemo(() => {
        const balance = chooseLatestIssueBalance(issue?.issueBalance, issue?.id ? db?.issue_balances?.[issue.id] : null);
        const originalIssued = Number(balance?.originalWeight ?? issue?.metallicBobbinsWeight ?? 0);
        const takenBack = Number(balance?.takeBackWeight || 0);
        const netIssued = Number(balance?.netIssuedWeight ?? Math.max(0, originalIssued - takenBack));
        const received = Number(balance?.receivedWeight || 0);
        const wastage = Number(balance?.wastageWeight || 0);
        const pending = Number(balance?.pendingWeight ?? Math.max(0, netIssued - received - wastage));
        return {
            originalIssued: Math.max(0, originalIssued),
            takenBack: Math.max(0, takenBack),
            netIssued: Math.max(0, netIssued),
            received: Math.max(0, received),
            wastage: Math.max(0, wastage),
            pending: Math.max(0, pending),
        };
    }, [issue, db?.issue_balances]);

    const isReceivedOverIssued = issueMetrics.netIssued > 0
        && issueMetrics.received > issueMetrics.netIssued + RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG;
    const excessReceivedWeight = Math.max(0, issueMetrics.received - issueMetrics.netIssued);

    // --- Handlers ---
    async function handleScan() {
        if (!scanInput.trim()) return;
        try {
            const result = await api.getIssueByHoloBarcode(scanInput.trim());
            const enriched = enrichIssueWithBalance(result);
            setIssue(enriched);

            // Pre-fill defaults from issue if available
            setForm(p => ({
                ...p,
                machineId: enriched.machineId || '',
                operatorId: enriched.operatorId || '',
                shift: enriched.shift || '',
                pieceId: Array.isArray(enriched.pieceIds) && enriched.pieceIds.length > 0 ? enriched.pieceIds[0] : '',
            }));
        } catch (e) {
            alert(e.message);
            setIssue(null);
        }
    }

    const handleSubmit = wrapSubmit(async () => {
        if (!issue) return;
        if (!form.pieceId) {
            alert('Select a piece for this receive');
            return;
        }
        if (!form.rollTypeId || !form.boxId || !Number.isFinite(Number(selectedRollType?.weight)) || Number(selectedRollType?.weight) < 0 || !Number.isFinite(Number(selectedBox?.weight)) || Number(selectedBox?.weight) <= 0 || !Number.isInteger(Number(form.rollCount)) || Number(form.rollCount) <= 0 || Number(form.grossWeight) <= 0 || netWeight <= 0) {
            alert('Select Roll Type and Box, then enter a positive whole roll count and gross weight greater than tare.');
            return;
        }
        setSubmitting(true);
        try {
            const rollCountNum = Number(form.rollCount);
            const grossWeightNum = Number(form.grossWeight);
            const result = await api.manualReceiveFromHoloMachine({
                issueId: issue.id,
                pieceId: form.pieceId,
                rollCount: rollCountNum,
                rollTypeId: form.rollTypeId,
                boxId: form.boxId,
                grossWeight: grossWeightNum,
                date: form.date,
                machineNo: db.machines.find(m => m.id === form.machineId)?.name,
                operatorId: form.operatorId,
                shift: form.shift,
                notes: form.notes
            });

            // Patch local DB so UI is ready for the next entry immediately.
            // Full refresh of the process module is expensive (it runs heavy backend aggregation),
            // so we avoid doing it on every receive save.
            if (result?.row?.id) {
                const savedRollTypeId = result?.row?.rollTypeId || form.rollTypeId || '';
                const savedRollTypeName = (db?.rollTypes || []).find((r) => r.id === savedRollTypeId)?.name || '';
                const isWastageRow = String(savedRollTypeName || '').toLowerCase().includes('wastage');
                const existingRows = Array.isArray(db.receive_from_holo_machine_rows) ? db.receive_from_holo_machine_rows : [];
                const nextRows = [
                    { ...result.row, rollType: savedRollTypeId ? { id: savedRollTypeId, name: savedRollTypeName } : (result.row.rollType || null) },
                    ...existingRows.filter(r => r?.id !== result.row.id),
                ];

                const existingTotals = Array.isArray(db.receive_from_holo_machine_piece_totals) ? db.receive_from_holo_machine_piece_totals : [];
                const netInc = Number(netWeight || 0);
                const totalsIdx = existingTotals.findIndex(t => t?.pieceId === form.pieceId);
                const nextTotals = totalsIdx >= 0
                    ? existingTotals.map((t, idx) => {
                        if (idx !== totalsIdx) return t;
                        return {
                            ...t,
                            totalRolls: Number(t.totalRolls || 0) + (Number.isFinite(rollCountNum) ? rollCountNum : 0),
                            totalNetWeight: Number(t.totalNetWeight || 0) + (isWastageRow ? 0 : (Number.isFinite(netInc) ? netInc : 0)),
                            wastageNetWeight: Number(t.wastageNetWeight || 0) + (isWastageRow && Number.isFinite(netInc) ? netInc : 0),
                        };
                    })
                    : [
                        {
                            pieceId: form.pieceId,
                            totalRolls: Number.isFinite(rollCountNum) ? rollCountNum : 0,
                            totalNetWeight: isWastageRow ? 0 : (Number.isFinite(netInc) ? netInc : 0),
                            wastageNetWeight: isWastageRow && Number.isFinite(netInc) ? netInc : 0,
                        },
                        ...existingTotals,
                    ];

                patchDb({
                    receive_from_holo_machine_rows: nextRows,
                    receive_from_holo_machine_piece_totals: nextTotals,
                    issue_balances: (() => {
                        const map = { ...(db.issue_balances || {}) };
                        if (result?.issueBalance) map[issue.id] = result.issueBalance;
                        return map;
                    })(),
                });

                setIssue((prev) => {
                    if (!prev) return prev;
                    return result?.issueBalance ? { ...prev, issueBalance: result.issueBalance } : prev;
                });
            }
            emitInvalidation([
                INVENTORY_INVALIDATION_KEYS.receiveHistory('holo'),
                INVENTORY_INVALIDATION_KEYS.stock('holo'),
            ], {
                source: 'manualReceiveFromHoloMachine',
                issueId: issue?.id || null,
            });

            const resolved = resolveHoloTrace(issue, traceContext);
            const twist = db?.twists?.find((t) => t.id === issue.twistId)?.name;
            const printData = {
                lotNo: selectedPiece?.lotNo || issue.lotLabel || issue.lotNo,
                barcode: result?.row?.barcode,
                rollCount: form.rollCount,
                grossWeight: form.grossWeight,
                tareWeight,
                netWeight,
                rollType: db?.rollTypes?.find((r) => r.id === form.rollTypeId)?.name,
                boxName: db?.boxes?.find((b) => b.id === form.boxId)?.name,
                operatorName: db?.operators?.find((o) => o.id === form.operatorId)?.name,
                machineName: db?.machines?.find((m) => m.id === form.machineId)?.name,
                itemName: selectedPiece
                    ? db?.items?.find((i) => i.id === selectedPiece.itemId)?.name
                    : db?.items?.find((i) => i.id === issue.itemId)?.name,
                yarnName: db?.yarns?.find((y) => y.id === issue.yarnId)?.name,
                twist: twist || '',
                twistName: twist || '',
                cut: resolved.cutName === '—' ? '' : resolved.cutName,
                shift: form.shift,
                date: form.date,
            };

            setForm(p => ({ ...p, rollCount: '', grossWeight: '' }));
            setSubmitting(false);
            alert('Received successfully');

            try {
                const tpl = template || (await loadTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE));
                if (tpl && result?.row && window.confirm('Print sticker for this receive?')) {
                    await printStageTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE, printData, { template: tpl });
                }
            } catch (printError) {
                console.error('Holo receive label print failed', printError);
                alert('Received successfully, sticker not printed');
            }
        } catch (e) {
            alert(e.message);
        } finally {
            setSubmitting(false);
        }
    });

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
                        <ResizableIssueSummary
                            idPrefix="receive-summary-holo"
                            warning={isReceivedOverIssued ? { excessKg: excessReceivedWeight } : null}
                        >
                            <ReceiveSummaryGroup id="receive-summary-holo-material" title="Material">
                                <div className="min-w-0" style={receiveSummaryMetricGridStyle}>
                                    <ReceiveSummaryMetricCard label="Lot" value={issue.lotLabel || issue.lotNo || '—'} />
                                    <ReceiveSummaryMetricCard label="Item" value={db?.items?.find(i => i.id === issue.itemId)?.name || issue.itemId || '—'} />
                                    <ReceiveSummaryMetricCard label="Cut" value={cutName || '—'} />
                                    <ReceiveSummaryMetricCard label="Yarn" value={db?.yarns?.find(y => y.id === issue.yarnId)?.name || '—'} />
                                    <ReceiveSummaryMetricCard label="Twist" value={db?.twists?.find(t => t.id === issue.twistId)?.name || '—'} />
                                </div>
                            </ReceiveSummaryGroup>

                            <ReceiveSummaryGroup id="receive-summary-holo-issue-balance" title="Issue Balance">
                                <div className="min-w-0" style={receiveSummaryMetricGridStyle}>
                                    <ReceiveSummaryMetricCard label="Issued (Orig)" value={formatKg(issueMetrics.originalIssued)} unit="kg" />
                                    <ReceiveSummaryMetricCard label="Taken Back" value={formatKg(issueMetrics.takenBack)} unit="kg" />
                                    <ReceiveSummaryMetricCard label="Net Issued" value={formatKg(issueMetrics.netIssued)} unit="kg" />
                                </div>
                            </ReceiveSummaryGroup>

                            <ReceiveSummaryGroup id="receive-summary-holo-production-outcome" title="Production Outcome">
                                <div className="min-w-0" style={receiveSummaryMetricGridStyle}>
                                    <ReceiveSummaryMetricCard
                                        label="Received"
                                        value={formatKg(issueMetrics.received)}
                                        unit="kg"
                                        valueClassName={isReceivedOverIssued ? 'text-destructive' : ''}
                                    />
                                    <ReceiveSummaryMetricCard label="Wastage" value={formatKg(issueMetrics.wastage)} unit="kg" />
                                    <ReceiveSummaryMetricCard label="Pending" value={formatKg(issueMetrics.pending)} unit="kg" />
                                </div>
                            </ReceiveSummaryGroup>
                        </ResizableIssueSummary>

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
                                    <CatchWeightButton
                                        onWeightCaptured={(wt) => setForm({ ...form, grossWeight: wt.toFixed(3) })}
                                        context={{
                                            feature: 'receive',
                                            stage: 'holo',
                                            field: 'grossWeight',
                                            issueId: issue?.id || null,
                                            issueBarcode: issue?.barcode || null,
                                            lotNo: issue?.lotNo || null,
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between sm:items-center pt-4 border-t gap-4">
                            <div className="text-sm">
                                Tare: {formatKg(tareWeight)} | <span className="font-bold">Net: {formatKg(netWeight)}</span>
                            </div>
                            <Button
                                onClick={handleSubmit}
                                disabled={submitting || !form.rollTypeId || !form.boxId || !Number.isFinite(Number(selectedRollType?.weight)) || Number(selectedRollType?.weight) < 0 || !Number.isFinite(Number(selectedBox?.weight)) || Number(selectedBox?.weight) <= 0 || !Number.isInteger(Number(form.rollCount)) || Number(form.rollCount) <= 0 || Number(form.grossWeight) <= 0 || netWeight <= 0}
                                className="w-full sm:w-auto"
                            >Save Receive</Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
