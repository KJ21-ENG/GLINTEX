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
import {
    ResizableIssueSummary,
    ReceiveSummaryGroup,
    ReceiveSummaryMetricCard,
    receiveSummaryMetricGridStyle,
    RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG,
} from './ResizableIssueSummary';

const asArray = (value) => (Array.isArray(value) ? value : []);

const getHoloLookupPieces = (issue) => {
    const explicitPieces = asArray(issue?.pieces);
    if (explicitPieces.length > 0) return explicitPieces;

    const piecesById = new Map();
    for (const crate of asArray(issue?.crates)) {
        if (!crate?.pieceId || piecesById.has(crate.pieceId)) continue;
        piecesById.set(crate.pieceId, {
            id: crate.pieceId,
            lotNo: crate.lotNo || '',
            itemId: crate.itemId || '',
            itemName: crate.itemName || '',
            cutName: crate.cutName || '',
        });
    }
    return Array.from(piecesById.values());
};

const getHoloPieceIds = (issue) => {
    const explicitIds = asArray(issue?.pieceIds).filter(Boolean);
    if (explicitIds.length > 0) return explicitIds;
    return getHoloLookupPieces(issue).map((piece) => piece?.id).filter(Boolean);
};

const getResponseBalance = (response) => response?.issueBalance || response?.issue_balance || response?.balance || null;

const advanceIssueBalance = (balance, {
    receivedWeight = 0,
    wastageWeight = 0,
    receivedCount = 0,
    wastageCount = 0,
} = {}) => {
    if (!balance) return null;
    const nextReceivedWeight = Number(balance.receivedWeight || 0) + Number(receivedWeight || 0);
    const nextWastageWeight = Number(balance.wastageWeight || 0) + Number(wastageWeight || 0);
    const nextReceivedCount = Number(balance.receivedCount || 0) + Number(receivedCount || 0);
    const nextWastageCount = Number(balance.wastageCount || 0) + Number(wastageCount || 0);
    const netIssuedWeight = Number(balance.netIssuedWeight ?? balance.originalWeight ?? 0);
    const netIssuedCount = Number(balance.netIssuedCount ?? balance.originalCount ?? 0);
    return {
        ...balance,
        receivedCount: nextReceivedCount,
        receivedWeight: nextReceivedWeight,
        wastageCount: nextWastageCount,
        wastageWeight: nextWastageWeight,
        pendingCount: Math.max(0, netIssuedCount - nextReceivedCount - nextWastageCount),
        pendingWeight: Math.max(0, netIssuedWeight - nextReceivedWeight - nextWastageWeight),
    };
};

const queueHoloReceivePrint = ({ cachedTemplate, labelData }) => {
    setTimeout(() => {
        void (async () => {
            const tpl = cachedTemplate || (await loadTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE));
            if (!tpl || !window.confirm('Print sticker for this receive?')) return;
            await printStageTemplate(
                LABEL_STAGE_KEYS.HOLO_RECEIVE,
                labelData,
                { template: tpl },
            );
        })().catch((printError) => {
            console.error('Holo receive was saved but post-commit label printing failed', printError);
        });
    }, 0);
};

export function HoloReceiveForm() {
    const { db, emitInvalidation } = useInventory();
    const [searchParams, setSearchParams] = useSearchParams();

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
            issueBalance: rawIssue.issueBalance || db?.issue_balances?.[rawIssue.id] || null,
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
                            pieceId: getHoloPieceIds(enriched)[0] || '',
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
        const lookupPieces = getHoloLookupPieces(issue);
        const lookupPieceById = new Map(lookupPieces.map((piece) => [piece.id, piece]));
        const ids = getHoloPieceIds(issue);
        return ids.map(pid => {
            const piece = lookupPieceById.get(pid) || db.inbound_items.find(p => p.id === pid);
            const label = piece?.lotNo ? `${pid} (${piece.lotNo})` : pid;
            return { id: pid, name: label };
        });
    }, [issue, db.inbound_items]);

    const selectedPiece = useMemo(() => {
        if (!issue || !form.pieceId) return null;
        return getHoloLookupPieces(issue).find(p => p.id === form.pieceId)
            || db.inbound_items.find(p => p.id === form.pieceId)
            || null;
    }, [issue, form.pieceId, db.inbound_items]);

    const materialDetails = useMemo(() => {
        if (!issue) return { lotNo: '', itemName: '', cutName: '', yarnName: '', twistName: '' };
        const selectedCrate = asArray(issue.crates).find((crate) => crate?.pieceId === form.pieceId)
            || asArray(issue.crates)[0]
            || null;
        const serverTrace = issue.trace || {};
        const itemId = selectedPiece?.itemId || selectedCrate?.itemId || issue.itemId;
        const lookupCutName = selectedPiece?.cutName
            || selectedCrate?.cutName
            || issue.cutName
            || serverTrace.cutName
            || '';
        const lookupYarnName = selectedPiece?.yarnName
            || selectedCrate?.yarnName
            || issue.yarnName
            || serverTrace.yarnName
            || '';
        const lookupTwistName = selectedPiece?.twistName
            || selectedCrate?.twistName
            || issue.twistName
            || serverTrace.twistName
            || '';
        const legacyTrace = !lookupCutName
            ? resolveHoloTrace(issue, buildHoloTraceContext(db))
            : { cutName: '—', yarnName: '—', twistName: '—' };
        return {
            lotNo: selectedPiece?.lotNo || selectedCrate?.lotNo || issue.lotLabel || issue.lotNo || '',
            itemName: selectedPiece?.itemName
                || selectedCrate?.itemName
                || issue.itemName
                || serverTrace.itemName
                || db?.items?.find((item) => item.id === itemId)?.name
                || itemId
                || '',
            cutName: lookupCutName || (legacyTrace.cutName === '—' ? '' : legacyTrace.cutName),
            yarnName: lookupYarnName
                || db?.yarns?.find((yarn) => yarn.id === issue.yarnId)?.name
                || '',
            twistName: lookupTwistName
                || db?.twists?.find((twist) => twist.id === issue.twistId)?.name
                || '',
        };
    }, [issue, form.pieceId, selectedPiece, db]);

    const issueMetrics = useMemo(() => {
        const balance = issue?.issueBalance || (issue?.id ? db?.issue_balances?.[issue.id] : null) || null;
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
                pieceId: getHoloPieceIds(enriched)[0] || '',
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
                crateTareWeight: 0, // Handled in net calculation implicitly by backend usually, but we send what we have
                date: form.date,
                machineNo: db.machines.find(m => m.id === form.machineId)?.name,
                operatorId: form.operatorId,
                shift: form.shift,
                notes: form.notes
            });

            if (result?.row?.id) {
                const savedRollTypeId = result?.row?.rollTypeId || form.rollTypeId || '';
                const savedRollTypeName = result?.row?.rollTypeName
                    || result?.row?.rollType?.name
                    || (db?.rollTypes || []).find((r) => r.id === savedRollTypeId)?.name
                    || '';
                const isWastageRow = String(savedRollTypeName || '').toLowerCase().includes('wastage');
                const savedNetWeight = Number(result.row.rollWeight ?? result.row.netWeight ?? netWeight ?? 0);
                const netIncrement = Number.isFinite(savedNetWeight) ? savedNetWeight : 0;
                const authoritativeBalance = getResponseBalance(result);
                const authoritativePieceTotal = result?.pieceTotal || result?.piece_total || null;
                setIssue((prev) => {
                    if (!prev || prev.id !== issue.id) return prev;
                    const fallbackBalance = prev.issueBalance || db?.issue_balances?.[prev.id] || {
                        originalWeight: issueMetrics.originalIssued,
                        netIssuedWeight: issueMetrics.netIssued,
                        receivedWeight: issueMetrics.received,
                        wastageWeight: issueMetrics.wastage,
                        pendingWeight: issueMetrics.pending,
                    };
                    const nextBalance = authoritativeBalance || advanceIssueBalance(fallbackBalance, {
                        receivedWeight: isWastageRow ? 0 : netIncrement,
                        wastageWeight: isWastageRow ? netIncrement : 0,
                        receivedCount: !isWastageRow && Number.isFinite(rollCountNum) ? rollCountNum : 0,
                        wastageCount: isWastageRow && Number.isFinite(rollCountNum) ? rollCountNum : 0,
                    });
                    const currentPieceTotals = asArray(prev.pieceTotals);
                    const previousPieceTotal = currentPieceTotals.find((total) => total?.pieceId === form.pieceId) || {
                        pieceId: form.pieceId,
                        totalRolls: 0,
                        totalNetWeight: 0,
                        wastageNetWeight: 0,
                    };
                    const nextPieceTotal = authoritativePieceTotal || {
                        ...previousPieceTotal,
                        totalRolls: Number(previousPieceTotal.totalRolls || 0) + (Number.isFinite(rollCountNum) ? rollCountNum : 0),
                        totalNetWeight: Number(previousPieceTotal.totalNetWeight || 0) + (isWastageRow ? 0 : netIncrement),
                        wastageNetWeight: Number(previousPieceTotal.wastageNetWeight || 0) + (isWastageRow ? netIncrement : 0),
                    };
                    return {
                        ...prev,
                        issueBalance: nextBalance,
                        pieceTotals: [
                            nextPieceTotal,
                            ...currentPieceTotals.filter((total) => total?.pieceId !== form.pieceId),
                        ],
                        receives: [
                            result.row,
                            ...asArray(prev.receives).filter((row) => row?.id !== result.row.id),
                        ],
                    };
                });
            }
            emitInvalidation(INVENTORY_INVALIDATION_KEYS.receiveHistory('holo'), {
                source: 'manualReceiveFromHoloMachine',
                issueId: issue?.id || null,
            });

            const postCommitPrint = result?.row ? {
                cachedTemplate: template,
                labelData: {
                    lotNo: materialDetails.lotNo,
                    barcode: result.row.barcode,
                    rollCount: result.row.rollCount ?? form.rollCount,
                    grossWeight: result.row.grossWeight ?? form.grossWeight,
                    tareWeight: result.row.tareWeight ?? tareWeight,
                    netWeight: result.row.rollWeight ?? result.row.netWeight ?? netWeight,
                    rollType: db?.rollTypes?.find((r) => r.id === form.rollTypeId)?.name,
                    boxName: db?.boxes?.find((b) => b.id === form.boxId)?.name,
                    operatorName: db?.operators?.find((o) => o.id === form.operatorId)?.name,
                    machineName: db?.machines?.find((m) => m.id === form.machineId)?.name,
                    itemName: materialDetails.itemName,
                    yarnName: materialDetails.yarnName,
                    twist: materialDetails.twistName,
                    twistName: materialDetails.twistName,
                    cut: materialDetails.cutName,
                    shift: form.shift,
                    date: form.date,
                },
            } : null;

            // Reset partial form
            setForm(p => ({ ...p, rollCount: '', grossWeight: '' }));
            alert('Received successfully');
            if (postCommitPrint) queueHoloReceivePrint(postCommitPrint);
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
                            disabled={submitting}
                        />
                        <Button onClick={handleScan} disabled={submitting}>Load</Button>
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
                                    <ReceiveSummaryMetricCard label="Lot" value={materialDetails.lotNo || '—'} />
                                    <ReceiveSummaryMetricCard label="Item" value={materialDetails.itemName || '—'} />
                                    <ReceiveSummaryMetricCard label="Cut" value={materialDetails.cutName || '—'} />
                                    <ReceiveSummaryMetricCard label="Yarn" value={materialDetails.yarnName || '—'} />
                                    <ReceiveSummaryMetricCard label="Twist" value={materialDetails.twistName || '—'} />
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
                            <Button onClick={handleSubmit} disabled={submitting || !netWeight} className="w-full sm:w-auto">Save Receive</Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
