import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../../context/InventoryContext';
import { InfoPopover } from '../common/InfoPopover';
import { CatchWeightButton } from '../common/CatchWeightButton';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Checkbox } from '../ui';
import { formatDateDDMMYYYY, formatKg, todayISO, uid } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, printStageTemplatesBatch } from '../../utils/labelPrint';
import { buildConingTraceContext, resolveConingTrace } from '../../utils/coningTrace';

const RECEIVED_OVER_ISSUED_EPSILON_KG = 0.001;

export function ConingReceiveForm() {
    const { db, patchDb, emitInvalidation } = useInventory();
    const [searchParams, setSearchParams] = useSearchParams();

    const [scanInput, setScanInput] = useState('');
    const [issue, setIssue] = useState(null);
    const [cart, setCart] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [receiveDate, setReceiveDate] = useState(todayISO());
    const [isWastage, setIsWastage] = useState(false);
    const traceContext = useMemo(() => buildConingTraceContext(db), [db]);
    const enrichIssueWithBalance = (rawIssue) => {
        if (!rawIssue?.id) return rawIssue;
        return {
            ...rawIssue,
            issueBalance: rawIssue.issueBalance || db?.issue_balances?.[rawIssue.id] || null,
        };
    };

    const findIssueByBarcodeInCache = (barcode) => {
        const normalized = String(barcode || '').trim().toUpperCase();
        if (!normalized) return null;
        return (db.issue_to_coning_machine || []).find(
            (i) => String(i.barcode || '').trim().toUpperCase() === normalized
        ) || null;
    };

    const loadIssueByBarcode = async (barcode, { notFoundMessage = 'Coning issue not found for barcode' } = {}) => {
        const normalized = String(barcode || '').trim();
        if (!normalized) return null;

        const cached = findIssueByBarcodeInCache(normalized);
        if (cached) return enrichIssueWithBalance(cached);

        try {
            const lookedUp = await api.getIssueByConingBarcode(normalized);
            if (lookedUp?.id) return enrichIssueWithBalance(lookedUp);
        } catch (err) {
            if (!String(err?.message || '').toLowerCase().includes('not found')) {
                throw err;
            }
        }

        alert(notFoundMessage);
        return null;
    };

    // Auto-scan barcode from URL query param (from "Go to Receive" button in OnMachineTable)
    useEffect(() => {
        const barcodeFromUrl = searchParams.get('barcode');
        if (!barcodeFromUrl || issue) return;
        let cancelled = false;
        (async () => {
            try {
                const found = await loadIssueByBarcode(barcodeFromUrl);
                if (!cancelled && found) {
                    setIssue(found);
                    setCart([]);
                }
            } catch (e) {
                if (!cancelled) alert(e?.message || 'Failed to lookup coning issue');
            } finally {
                // Clear the URL param to prevent re-scan on refresh
                if (!cancelled) setSearchParams({}, { replace: true });
            }
        })();
        return () => { cancelled = true; };
    }, [searchParams, issue, setSearchParams, db.issue_to_coning_machine]);

    // --- Derived ---
    const perConeWeight = Number(issue?.requiredPerConeNetWeight || 0);
    const totalExpected = Number(issue?.expectedCones || 0);

    const issueRefs = useMemo(() => {
        if (!issue?.receivedRowRefs) return [];
        try {
            const refs = typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue.receivedRowRefs;
            return Array.isArray(refs) ? refs : [];
        } catch {
            return [];
        }
    }, [issue?.receivedRowRefs]);

    const fallbackIssuedWeight = useMemo(() => {
        const sumFromRefs = issueRefs.reduce((sum, ref) => sum + (Number(ref?.issueWeight) || 0), 0);
        if (sumFromRefs > 0) return sumFromRefs;
        // Fallback: sum referenced holo receive row weights (if issueWeight not stamped)
        return issueRefs.reduce((sum, ref) => {
            const holoRow = (db.receive_from_holo_machine_rows || []).find((r) => r.id === ref?.rowId);
            return sum + (Number(holoRow?.rollWeight) || 0);
        }, 0);
    }, [issueRefs, db.receive_from_holo_machine_rows]);

    const coningPieceTotals = useMemo(() => {
        if (!issue?.id) return null;
        return (db.receive_from_coning_machine_piece_totals || []).find((t) => t.pieceId === issue.id) || null;
    }, [db.receive_from_coning_machine_piece_totals, issue?.id]);

    const issueMetrics = useMemo(() => {
        const balance = issue?.issueBalance || (issue?.id ? db?.issue_balances?.[issue.id] : null) || null;
        const originalIssued = Number(balance?.originalWeight ?? fallbackIssuedWeight ?? 0);
        const takenBack = Number(balance?.takeBackWeight || 0);
        const netIssued = Number(balance?.netIssuedWeight ?? Math.max(0, originalIssued - takenBack));
        const received = Number(balance?.receivedWeight ?? coningPieceTotals?.totalNetWeight ?? 0);
        const wastage = Number(balance?.wastageWeight ?? coningPieceTotals?.wastageNetWeight ?? 0);
        const pending = Number(balance?.pendingWeight ?? Math.max(0, netIssued - received - wastage));
        return {
            originalIssued: Math.max(0, originalIssued),
            takenBack: Math.max(0, takenBack),
            netIssued: Math.max(0, netIssued),
            received: Math.max(0, received),
            wastage: Math.max(0, wastage),
            pending: Math.max(0, pending),
        };
    }, [issue, db?.issue_balances, fallbackIssuedWeight, coningPieceTotals]);

    // Wastage status for closing the issue
    const wastageStatus = useMemo(() => {
        // Include cart items in pending calculation
        const cartReceivedWeight = cart.filter(r => !r.isWastage).reduce((sum, r) => sum + (calcRowNet(r) || 0), 0);
        const cartWastage = cart.filter(r => r.isWastage).reduce((sum, r) => sum + Number(r.netWeight || 0), 0);
        const existingWastage = Number(issueMetrics.wastage || 0);
        const pendingWeight = Math.max(0, Number(issueMetrics.pending || 0) - cartReceivedWeight - cartWastage);
        const hasWastageInDb = existingWastage > 0;
        const hasWastageInCart = cartWastage > 0;
        const isWastageClosed = pendingWeight <= 0 && hasWastageInDb;

        return {
            existingWastage,
            pendingWeight,
            hasWastageInDb,
            hasWastageInCart,
            isWastageClosed,
        };
    }, [issueMetrics, cart]);

    // Receiving is blocked if wastage is in cart or already marked
    const receivingBlocked = wastageStatus.hasWastageInCart || wastageStatus.isWastageClosed;

    // --- Handlers ---
    async function handleScan() {
        if (!scanInput.trim()) return;
        try {
            const found = await loadIssueByBarcode(scanInput.trim(), { notFoundMessage: 'Issue not found' });
            if (found) {
                setIssue(found);
                setCart([]);
            }
        } catch (e) {
            alert(e.message);
            setIssue(null);
        } finally {
            setScanInput('');
        }
    }

    function addCartRow() {
        setCart(prev => [...prev, {
            id: uid(),
            coneCount: '',
            grossWeight: '',
            boxId: '',
            notes: '',
            operatorId: issue?.operatorId || ''
        }]);
    }

    function addWastageEntry() {
        if (!issue || wastageStatus.pendingWeight <= 0) return;
        if (wastageStatus.hasWastageInCart) {
            alert('Wastage is already queued in the list.');
            return;
        }

        setCart(prev => [...prev, {
            id: uid(),
            isWastage: true,
            coneCount: 0,
            grossWeight: 0,
            netWeight: wastageStatus.pendingWeight,
            boxId: '',
            notes: 'Wastage - Issue Closed',
            operatorId: issue?.operatorId || ''
        }]);
        setIsWastage(false);
    }

    function updateRow(id, field, val) {
        setCart(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
    }

    function calcRowNet(row) {
        const gross = Number(row.grossWeight);
        if (!gross) return 0;

        const box = db.boxes.find(b => b.id === row.boxId);
        const boxWt = box?.weight || 0;

        // Cone Tare? 
        // We need to know the cone type from the issue.
        const coneTypeId = issueRefs?.[0]?.coneTypeId;
        const coneType = db.cone_types.find(c => c.id === coneTypeId);
        const coneWt = (coneType?.weight || 0) * Number(row.coneCount || 0);

        return Math.max(0, gross - boxWt - coneWt);
    }

    const cartTotals = useMemo(() => {
        let totalNetWeight = 0;
        let totalCones = 0;
        for (const row of cart) {
            totalNetWeight += calcRowNet(row);
            const cones = Number(row.coneCount || 0);
            if (Number.isFinite(cones)) totalCones += cones;
        }
        return { totalNetWeight, totalCones };
    }, [cart, db.boxes, db.cone_types, issueRefs]);

    const totalReceivedWeight = Number(issueMetrics.received || 0) + cartTotals.totalNetWeight;
    const totalReceivedCones = Number(coningPieceTotals?.totalCones || 0) + cartTotals.totalCones;
    const receivedPerConeWeightG = totalReceivedCones > 0 ? (totalReceivedWeight * 1000) / totalReceivedCones : 0;
    const isReceivedOverIssued = issueMetrics.netIssued > 0
        && totalReceivedWeight > issueMetrics.netIssued + RECEIVED_OVER_ISSUED_EPSILON_KG;

    const issueDetails = useMemo(() => {
        if (!issue) return { itemName: '', cutName: '', coneTypeName: '' };

        let itemName = db.items?.find(i => i.id === issue.itemId)?.name || '';
        let cutName = '';
        let coneTypeName = '';

        if (issueRefs.length > 0) {
            const firstRef = issueRefs[0];
            if (firstRef.coneTypeId) {
                coneTypeName = db.cone_types?.find(c => c.id === firstRef.coneTypeId)?.name || '';
            }
        }
        const resolved = issue ? resolveConingTrace(issue, traceContext) : { cutName: '—' };
        cutName = resolved.cutName === '—' ? '' : resolved.cutName;
        return { itemName, cutName, coneTypeName };
    }, [issue, issueRefs, db, traceContext]);

    const receiveRowsForIssue = useMemo(() => {
        if (!issue?.id) return [];
        return (db.receive_from_coning_machine_rows || []).filter((row) => row.issueId === issue.id);
    }, [db.receive_from_coning_machine_rows, issue?.id]);

    async function handleSubmit() {
        if (!issue || cart.length === 0) return;
        setSubmitting(true);
        try {
            const exceedsIssuedQty = issueMetrics.netIssued > 0
                && totalReceivedWeight > issueMetrics.netIssued + RECEIVED_OVER_ISSUED_EPSILON_KG;
            if (exceedsIssuedQty) {
                const excessWeight = Math.max(0, totalReceivedWeight - issueMetrics.netIssued);
                const confirmed = window.confirm(
                    `This will exceed issued quantity. Continue?\n\n`
                    + `Net Issued: ${formatKg(issueMetrics.netIssued)}\n`
                    + `New Total Received: ${formatKg(totalReceivedWeight)}\n`
                    + `Excess: ${formatKg(excessWeight)}`
                );
                if (!confirmed) return;
            }

            // Separate receive entries from wastage entries
            const receiveEntries = cart.filter(r => !r.isWastage);
            const wastageEntries = cart.filter(r => r.isWastage);

            const template = await loadTemplate(LABEL_STAGE_KEYS.CONING_RECEIVE);
            const confirmPrint = template && receiveEntries.length > 0 ? window.confirm('Print stickers for these receives?') : false;
            const existingRows = (db.receive_from_coning_machine_rows || []).filter((r) => r.issueId === issue.id);
            const baseCount = existingRows.length;
            const baseCode = issue.barcode || issue.lotNo || issue.id;
            const lotLabel = issue.lotLabel || issue.lotNo;
            const labelsToPrint = [];

            const createdRows = [];

            // Process receive entries
            for (const row of receiveEntries) {
                const res = await api.manualReceiveFromConingMachine({
                    issueId: issue.id,
                    pieceId: issue.id,
                    coneCount: Number(row.coneCount),
                    boxId: row.boxId,
                    grossWeight: Number(row.grossWeight),
                    date: receiveDate,
                    operatorId: row.operatorId,
                    notes: row.notes
                });
                if (res?.row) createdRows.push(res.row);

                if (confirmPrint) {
                    const index = receiveEntries.indexOf(row);
                    const paddedIndex = String(baseCount + index + 1).padStart(3, '0');
                    const barcode = `RCN-${baseCode}-${paddedIndex}`;
                    const boxName = db.boxes.find((b) => b.id === row.boxId)?.name;
                    const operatorName = db.operators.find((o) => o.id === row.operatorId)?.name;

                    // Resolve details from issue source
                    let itemName = db.items.find(i => i.id === issue.itemId)?.name || '';
                    let cutName = '';
                    let yarnName = '';
                    let rollType = '';
                    let coneType = '';
                    let wrapperName = '';
                    let twistName = '';
                    let rollCount = 0;

                    try {
                        const refs = typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue.receivedRowRefs;
                        if (Array.isArray(refs) && refs.length > 0) {
                            const firstRef = refs[0];
                            if (firstRef.coneTypeId) coneType = db.cone_types.find(c => c.id === firstRef.coneTypeId)?.name || '';
                            if (firstRef.wrapperId) wrapperName = db.wrappers.find(w => w.id === firstRef.wrapperId)?.name || '';

                            refs.forEach(ref => {
                                if (ref.issueRolls) rollCount += Number(ref.issueRolls) || 0;
                                else {
                                    const r = db.receive_from_holo_machine_rows?.find(row => row.id === ref.rowId);
                                    if (r) rollCount += (r.rollCount || 0);
                                }
                            });
                        }
                        const resolved = issue ? resolveConingTrace(issue, traceContext) : { cutName: '—', yarnName: '—', twistName: '—', rollTypeName: '—' };
                        cutName = resolved.cutName === '—' ? '' : resolved.cutName;
                        yarnName = resolved.yarnName === '—' ? '' : resolved.yarnName;
                        twistName = resolved.twistName === '—' ? '' : resolved.twistName;
                        rollType = resolved.rollTypeName === '—' ? '' : resolved.rollTypeName;
                    } catch (e) { console.error('Error resolving details', e); }

                    labelsToPrint.push({
                        lotNo: lotLabel,
                        issueBarcode: issue.barcode,
                        barcode,
                        coneCount: row.coneCount,
                        rollCount,
                        grossWeight: row.grossWeight,
                        tareWeight: Number(row.grossWeight) - calcRowNet(row),
                        netWeight: calcRowNet(row),
                        boxName,
                        operatorName,
                        itemName,
                        cut: cutName,
                        yarnName,
                        twist: twistName,
                        twistName: twistName,
                        rollType,
                        coneType,
                        wrapperName,
                        shift: issue.shift || '',
                        date: receiveDate,
                    });
                }
            }

            // Process wastage entry if present
            let wastageTotals = null;
            if (wastageEntries.length > 0) {
                try {
                    const res = await api.markConingWastage(issue.id);
                    wastageTotals = res?.updated || null;
                } catch (e) {
                    console.error('Failed to mark coning wastage', e);
                    alert('Warning: Failed to mark wastage. Please try again separately.');
                }
            }

            if (labelsToPrint.length > 0) {
                await printStageTemplatesBatch(
                    LABEL_STAGE_KEYS.CONING_RECEIVE,
                    labelsToPrint,
                    { template }
                );
            }

            if (createdRows.length > 0 || wastageTotals) {
                const workerNameById = new Map((db.workers || []).map(w => [w.id, w.name]));
                const boxById = new Map((db.boxes || []).map(b => [b.id, b]));

                const enrichedRows = createdRows.map((r) => ({
                    ...r,
                    box: r.boxId ? boxById.get(r.boxId) || null : null,
                    operator: r.operatorId ? { id: r.operatorId, name: workerNameById.get(r.operatorId) || '' } : null,
                    helper: r.helperId ? { id: r.helperId, name: workerNameById.get(r.helperId) || '' } : null,
                }));

                const existingRows = Array.isArray(db.receive_from_coning_machine_rows) ? db.receive_from_coning_machine_rows : [];
                const nextRows = [...enrichedRows, ...existingRows].filter((row, idx, arr) => {
                    const id = row?.id;
                    if (!id) return false;
                    return arr.findIndex(r => r?.id === id) === idx;
                });

                const existingTotals = Array.isArray(db.receive_from_coning_machine_piece_totals) ? db.receive_from_coning_machine_piece_totals : [];
                const pieceId = issue.id;
                const baseTotal = existingTotals.find(t => t.pieceId === pieceId) || { pieceId, totalCones: 0, totalNetWeight: 0, wastageNetWeight: 0 };
                const incCones = createdRows.reduce((sum, r) => sum + (Number(r.coneCount) || 0), 0);
                const incNet = createdRows.reduce((sum, r) => sum + (Number(r.netWeight) || 0), 0);

                const nextTotal = wastageTotals
                    ? { ...baseTotal, ...wastageTotals }
                    : {
                        ...baseTotal,
                        totalCones: Number(baseTotal.totalCones || 0) + incCones,
                        totalNetWeight: Number(baseTotal.totalNetWeight || 0) + incNet,
                    };

                const nextTotals = [
                    nextTotal,
                    ...existingTotals.filter(t => t.pieceId !== pieceId),
                ];

                const nextIssueBalances = { ...(db.issue_balances || {}) };
                const prevBalance = nextIssueBalances[issue.id] || issue?.issueBalance;
                const fallbackNetIssued = Number(issueMetrics.netIssued || 0);
                if (prevBalance) {
                    const prevReceived = Number(prevBalance.receivedWeight || 0);
                    const nextReceived = Number(nextTotal.totalNetWeight || prevReceived);
                    const nextWastage = Number(nextTotal.wastageNetWeight || 0);
                    nextIssueBalances[issue.id] = {
                        ...prevBalance,
                        receivedWeight: nextReceived,
                        wastageWeight: nextWastage,
                        pendingWeight: Math.max(0, fallbackNetIssued - nextReceived - nextWastage),
                    };
                }

                patchDb({
                    receive_from_coning_machine_rows: nextRows,
                    receive_from_coning_machine_piece_totals: nextTotals,
                    issue_balances: nextIssueBalances,
                });

                setIssue((prev) => {
                    if (!prev) return prev;
                    const updatedBalance = nextIssueBalances[prev.id];
                    if (!updatedBalance) return prev;
                    return { ...prev, issueBalance: updatedBalance };
                });
            }
            if (createdRows.length > 0 || wastageTotals) {
                emitInvalidation(INVENTORY_INVALIDATION_KEYS.receiveHistory('coning'), {
                    source: 'manualReceiveFromConingMachine',
                    issueId: issue?.id || null,
                });
            }

            setCart([]);
            setIsWastage(false);
            alert(wastageEntries.length > 0 && receiveEntries.length === 0
                ? 'Wastage marked and issue closed successfully'
                : 'Received successfully');
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
                    <CardTitle>Scan Coning Issue</CardTitle>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Input
                            placeholder="Scan Issue (CN-...)"
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
                        <div className="p-4 bg-muted rounded-md text-sm space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                <div><strong>Lot:</strong> {issue.lotLabel || issue.lotNo}</div>
                                <div><strong>Item:</strong> {issueDetails.itemName || '—'}</div>
                                <div><strong>Cut:</strong> {issueDetails.cutName || '—'}</div>
                                <div><strong>Cone Type:</strong> {issueDetails.coneTypeName || '—'}</div>
                            </div>
                            <div className="border-t border-border/60" />
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                                <div><strong>Issued (Orig):</strong> {formatKg(issueMetrics.originalIssued)}</div>
                                <div><strong>Taken Back:</strong> {formatKg(issueMetrics.takenBack)}</div>
                                <div><strong>Net Issued:</strong> {formatKg(issueMetrics.netIssued)}</div>
                                <div><strong>Expected Cones:</strong> {totalExpected}</div>
                                <div><strong>Target:</strong> {perConeWeight} g/cone</div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-center">
                                <div className="flex items-center gap-2">
                                    <strong>Received Wt:</strong>{' '}
                                    <span className={isReceivedOverIssued ? "text-destructive font-semibold" : ""}>
                                        {formatKg(totalReceivedWeight)}
                                    </span>
                                    <InfoPopover
                                        title={`Coning Receives (${issue.lotLabel || issue.lotNo})`}
                                        items={receiveRowsForIssue}
                                        emptyText="No receives yet for this lot."
                                        widthClassName="w-[560px]"
                                        bodyClassName="max-h-[240px] overflow-auto"
                                        buttonClassName="h-5 w-5 rounded-full hover:bg-muted"
                                        renderContent={(rows) => (
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="h-8 px-2 text-left text-xs">Date</TableHead>
                                                        <TableHead className="h-8 px-2 text-left text-xs">Barcode</TableHead>
                                                        <TableHead className="h-8 px-2 text-right text-xs">Cones</TableHead>
                                                        <TableHead className="h-8 px-2 text-right text-xs">Gross (kg)</TableHead>
                                                        <TableHead className="h-8 px-2 text-right text-xs">Net (kg)</TableHead>
                                                        <TableHead className="h-8 px-2 text-left text-xs">Box</TableHead>
                                                        <TableHead className="h-8 px-2 text-left text-xs">Operator</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {rows.map((row) => {
                                                        const dateLabel = formatDateDDMMYYYY(row.date || row.createdAt) || '—';
                                                        const cones = Number(row.coneCount || 0);
                                                        const gross = Number(row.grossWeight || 0);
                                                        const net = Number(row.netWeight || 0);
                                                        const boxName = row.box?.name || '—';
                                                        const operatorName = row.operator?.name || '—';
                                                        return (
                                                            <TableRow key={row.id || row.barcode}>
                                                                <TableCell className="p-2 text-left text-xs">{dateLabel}</TableCell>
                                                                <TableCell className="p-2 text-left font-mono text-xs">{row.barcode || '—'}</TableCell>
                                                                <TableCell className="p-2 text-right text-xs">{cones || 0}</TableCell>
                                                                <TableCell className="p-2 text-right text-xs">{formatKg(gross)}</TableCell>
                                                                <TableCell className="p-2 text-right text-xs">{formatKg(net)}</TableCell>
                                                                <TableCell className="p-2 text-left text-xs">{boxName}</TableCell>
                                                                <TableCell className="p-2 text-left text-xs">{operatorName}</TableCell>
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        )}
                                    />
                                </div>
                                <div><strong>Received Cones:</strong> {totalReceivedCones}</div>
                                <div><strong>Actual Wt:</strong> {totalReceivedCones > 0 ? `${receivedPerConeWeightG.toFixed(1)} g/cone` : '—'}</div>
                                <div className="flex items-center gap-1">
                                    <strong>Pending:</strong>{' '}
                                    <span className={wastageStatus.pendingWeight > 0.001 ? "" : "text-muted-foreground"}>
                                        {formatKg(wastageStatus.pendingWeight)}
                                    </span>
                                    {wastageStatus.isWastageClosed ? (
                                        <span className="text-xs text-destructive ml-1">
                                            ({formatKg(wastageStatus.existingWastage)} wastage)
                                        </span>
                                    ) : (
                                        <InfoPopover
                                            title="Issue Close"
                                            items={[wastageStatus]}
                                            renderContent={() => {
                                                if (!issue) {
                                                    return (
                                                        <div className="text-muted-foreground">
                                                            Scan an issue barcode to manage wastage.
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div className="space-y-2 text-xs">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-muted-foreground">Issue</span>
                                                            <span className="font-mono">{issue.barcode || issue.id}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-muted-foreground">Pending to close</span>
                                                            <span className="font-medium">{formatKg(wastageStatus.pendingWeight)}</span>
                                                        </div>
                                                        {wastageStatus.hasWastageInCart && (
                                                            <div className="text-muted-foreground">
                                                                Wastage is queued in the list. Remove it to continue.
                                                            </div>
                                                        )}
                                                        <label className="flex items-start gap-2 cursor-pointer pt-2">
                                                            <Checkbox
                                                                checked={isWastage}
                                                                onCheckedChange={setIsWastage}
                                                                disabled={!issue || wastageStatus.pendingWeight <= 0 || receivingBlocked}
                                                            />
                                                            <span className="leading-snug">Close issue (mark remaining as wastage)</span>
                                                        </label>
                                                    </div>
                                                );
                                            }}
                                            widthClassName="w-64"
                                            bodyClassName="text-xs"
                                            buttonClassName="h-5 w-5 rounded-full hover:bg-muted inline-flex ml-1"
                                            align="right"
                                        />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Wastage closed alert */}
                        {wastageStatus.isWastageClosed && (
                            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                Wastage already marked ({formatKg(wastageStatus.existingWastage)}). Issue is closed.
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div><Label>Date</Label><Input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} disabled={receivingBlocked} /></div>
                            <div className="flex items-end gap-2">
                                <Button onClick={isWastage ? addWastageEntry : addCartRow} disabled={receivingBlocked && !isWastage}>
                                    {isWastage ? `Add Wastage (${formatKg(wastageStatus.pendingWeight)})` : 'Add Crate'}
                                </Button>
                            </div>
                        </div>

                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Box</TableHead>
                                        <TableHead>Cones</TableHead>
                                        <TableHead>Gross</TableHead>
                                        <TableHead>Net (Calc)</TableHead>
                                        <TableHead>Per Cone Wt</TableHead>
                                        <TableHead>Operator</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {cart.map(row => (
                                        <TableRow key={row.id} className={row.isWastage ? "bg-destructive/10" : ""}>
                                            {row.isWastage ? (
                                                <>
                                                    <TableCell colSpan={3} className="text-destructive font-semibold">
                                                        ⚠️ WASTAGE / CLOSE ISSUE
                                                    </TableCell>
                                                    <TableCell className="font-medium text-destructive">
                                                        {formatKg(row.netWeight)}
                                                    </TableCell>
                                                    <TableCell>—</TableCell>
                                                    <TableCell>—</TableCell>
                                                    <TableCell>
                                                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCart(p => p.filter(x => x.id !== row.id))}>X</Button>
                                                    </TableCell>
                                                </>
                                            ) : (
                                                <>
                                                    <TableCell>
                                                        <Select
                                                            value={row.boxId}
                                                            onChange={e => updateRow(row.id, 'boxId', e.target.value)}
                                                            options={(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'coning').map(b => ({ id: b.id, name: b.name }))}
                                                            labelKey="name"
                                                            valueKey="id"
                                                            placeholder="Select Box"
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Input type="number" value={row.coneCount} onChange={e => updateRow(row.id, 'coneCount', e.target.value)} className="h-8" />
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex gap-1">
                                                            <Input type="number" value={row.grossWeight} onChange={e => updateRow(row.id, 'grossWeight', e.target.value)} className="h-8 flex-1" />
                                                            <CatchWeightButton
                                                                onWeightCaptured={(wt) => updateRow(row.id, 'grossWeight', wt.toFixed(3))}
                                                                className="h-8 w-8"
                                                                context={{
                                                                    feature: 'receive',
                                                                    stage: 'coning',
                                                                    field: 'grossWeight',
                                                                    issueId: issue?.id || null,
                                                                    issueBarcode: issue?.barcode || null,
                                                                    lotNo: issue?.lotNo || null,
                                                                    cartRowId: row.id,
                                                                }}
                                                            />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="">
                                                        {formatKg(calcRowNet(row))}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {(function () {
                                                            const net = calcRowNet(row);
                                                            const c = Number(row.coneCount || 0);
                                                            if (c <= 0) return '—';
                                                            return `${((net * 1000) / c).toFixed(1)} g`;
                                                        })()}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Select
                                                            value={row.operatorId}
                                                            onChange={e => updateRow(row.id, 'operatorId', e.target.value)}
                                                            className="h-8"
                                                            options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'coning').map(o => ({ id: o.id, name: o.name }))}
                                                            labelKey="name"
                                                            valueKey="id"
                                                            placeholder="Select Operator"
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCart(p => p.filter(x => x.id !== row.id))}>X</Button>
                                                    </TableCell>
                                                </>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between sm:items-center pt-4 border-t gap-4">
                            <div className="text-sm">
                                {cart.length > 0 && (
                                    <>
                                        Tare: {formatKg(cart.reduce((sum, row) => sum + (Number(row.grossWeight || 0) - calcRowNet(row)), 0))} | {' '}
                                        <span className="font-bold">Net: {formatKg(cartTotals.totalNetWeight)}</span>
                                    </>
                                )}
                            </div>
                            <Button onClick={handleSubmit} disabled={submitting || cart.length === 0} className="w-full sm:w-auto">Save Receive</Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
