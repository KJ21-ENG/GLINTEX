import { refreshAfterCommit } from '../../utils/postCommitPrint';
import { transactionWeightProvenance } from '../../utils/weightProvenance';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Checkbox } from '../ui';
import { formatKg, todayISO, uid, formatDateDDMMYYYY } from '../../utils';
import * as api from '../../api';
import { Scan, Save, Trash2, Plus } from 'lucide-react';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, makeReceiveBarcode, parseReceiveCrateIndex } from '../../utils/labelPrint';
import { InfoPopover } from '../common/InfoPopover';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Dialog, DialogContent } from '../ui/Dialog';
import { CatchWeightButton } from '../common/CatchWeightButton';
import { WastageNoteDialog } from '../stock/WastageNoteDialog';
import { useSubmitLock } from '../../hooks/useSubmitLock';
import { useUnsavedGuard } from '../../context/UnsavedChangesContext';
import {
    ResizableIssueSummary,
    ReceiveSummaryGroup,
    ReceiveSummaryMetricCard,
    receiveSummaryMetricGridStyle,
    RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG,
} from './ResizableIssueSummary';

export function CutterReceiveForm() {
    const { db, refreshProcessData, emitInvalidation } = useInventory();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [barcode, setBarcode] = useState('');
    const [loading, setLoading] = useState(false);
    const [template, setTemplate] = useState(null);
    const [pendingPrint, setPendingPrint] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const showMessage = (message) => setFeedback({ title: 'Check receive details', message });

    // Form State
    const [issueRecord, setIssueRecord] = useState(null);
    const [receiveDate, setReceiveDate] = useState(todayISO());

    // Fields
    const [cutId, setCutId] = useState('');
    const [operatorId, setOperatorId] = useState('');
    const [shift, setShift] = useState('');
    const [helperId, setHelperId] = useState('');
    const [bobbinId, setBobbinId] = useState('');
    const [boxId, setBoxId] = useState('');
    const [bobbinQty, setBobbinQty] = useState('');
    const [grossWeight, setGrossWeight] = useState('');
    const [weightProvenance, setWeightProvenance] = useState(null);
    const [isWastage, setIsWastage] = useState(false);
    const [wastageDialogOpen, setWastageDialogOpen] = useState(false);
    const [pendingWastageContext, setPendingWastageContext] = useState(null);

    const [cart, setCart] = useState([]);
    const workerGroups = useMemo(() => {
        const groups = new Map();
        cart.forEach((entry) => {
            const key = JSON.stringify([entry.operatorId, entry.helperId || '', entry.cutId || '', entry.receiveDate]);
            if (!groups.has(key)) groups.set(key, {
                key, operatorName: entry.operatorName || '—', helperName: entry.helperName || '—',
                crates: 0, netWeight: 0,
            });
            if (!entry.isWastage) {
                const group = groups.get(key);
                group.crates += 1;
                group.netWeight += Number(entry.netWeight) || 0;
            }
        });
        return [...groups.values()];
    }, [cart]);
    const [saving, setSaving] = useState(false);
    const [, wrapScan] = useSubmitLock();
    const [addLocked, wrapAdd] = useSubmitLock();
    const [, wrapSave] = useSubmitLock();
    useUnsavedGuard('receive-cutter', cart.length > 0 || !!issueRecord || !!bobbinQty || !!grossWeight || !!barcode);

    const barcodeInputRef = useRef(null);
    const enrichIssueWithBalance = (rawIssue) => {
        if (!rawIssue?.id) return rawIssue;
        return {
            ...rawIssue,
            issueBalance: rawIssue.issueBalance || db?.issue_balances?.[rawIssue.id] || null,
        };
    };
    const toTimeMs = (value) => {
        const ms = new Date(value || 0).getTime();
        return Number.isFinite(ms) ? ms : null;
    };
    const cutterIssueTimelineByPiece = useMemo(() => {
        const map = new Map();
        (db.issue_to_cutter_machine || [])
            .filter((issue) => !issue?.isDeleted && issue?.id)
            .forEach((issue) => {
                const issueCreatedAtMs = toTimeMs(issue.createdAt);
                const pieceIds = Array.isArray(issue.pieceIds)
                    ? issue.pieceIds
                    : String(issue.pieceIds || '').split(',').map((s) => s.trim()).filter(Boolean);
                pieceIds.forEach((pieceId) => {
                    if (!pieceId) return;
                    const rows = map.get(pieceId) || [];
                    rows.push({ issueId: issue.id, createdAtMs: issueCreatedAtMs });
                    map.set(pieceId, rows);
                });
            });
        map.forEach((rows, pieceId) => {
            rows.sort((a, b) => {
                const aMs = a.createdAtMs == null ? Number.MAX_SAFE_INTEGER : a.createdAtMs;
                const bMs = b.createdAtMs == null ? Number.MAX_SAFE_INTEGER : b.createdAtMs;
                if (aMs !== bMs) return aMs - bMs;
                return String(a.issueId).localeCompare(String(b.issueId));
            });
            map.set(pieceId, rows);
        });
        return map;
    }, [db.issue_to_cutter_machine]);

    // Focus barcode input on mount
    useEffect(() => {
        barcodeInputRef.current?.focus();
    }, []);

    // Preload template once to avoid a network fetch on each add/print.
    useEffect(() => {
        let alive = true;
        (async () => {
            const tpl = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE);
            if (alive) setTemplate(tpl || null);
        })().catch(() => { if (alive) setTemplate(null); });
        return () => { alive = false; };
    }, []);

    // Auto-scan barcode from URL query param (from "Go to Receive" button)
    useEffect(() => {
        const barcodeFromUrl = searchParams.get('barcode');
        if (barcodeFromUrl && !issueRecord) {
            // Set barcode and trigger scan
            setBarcode(barcodeFromUrl);
            setLoading(true);
            api.getIssueByCutterBarcode(barcodeFromUrl)
                .then(res => {
                    if (res && res.id) {
                        const enriched = enrichIssueWithBalance(res);
                        setIssueRecord(enriched);
                        setCutId(enriched.cutId || '');
                        setOperatorId(enriched.operatorId || '');
                        setHelperId('');
                        setBobbinId('');
                        setBoxId('');
                        setBobbinQty('');
                        setGrossWeight(''); setWeightProvenance(null);
                        setIsWastage(false);
                    } else {
                        showMessage('Barcode not found or invalid');
                        setIssueRecord(null);
                    }
                })
                .catch(err => {
                    showMessage(err.message || 'Failed to fetch barcode details');
                })
                .finally(() => {
                    setLoading(false);
                    // Clear the URL param to prevent re-scan on refresh
                    setSearchParams({}, { replace: true });
                });
        }
    }, [searchParams, issueRecord, setSearchParams]);


    const handleScan = wrapScan(async (e) => {
        e.preventDefault();
        if (!barcode) return;
        setLoading(true);
        try {
            const res = await api.getIssueByCutterBarcode(barcode);
            if (res && res.id) {
                const enriched = enrichIssueWithBalance(res);
                setIssueRecord(enriched);
                // Auto-fill known fields if available/logical
                // Auto-fill cut from issue, reset other fields
                setCutId(enriched.cutId || '');
                setOperatorId(enriched.operatorId || '');
                setHelperId('');
                setBobbinId('');
                setBoxId('');
                setBobbinQty('');
                setGrossWeight(''); setWeightProvenance(null);
                setIsWastage(false);
            } else {
                showMessage('Barcode not found or invalid');
                setIssueRecord(null);
            }
        } catch (err) {
            showMessage(err.message || 'Failed to fetch barcode details');
        } finally {
            setLoading(false);
        }
    });

    // Helpers
    const selectedBobbin = db.bobbins.find(b => b.id === bobbinId);
    const selectedBox = db.boxes.find(b => b.id === boxId);

    const netWeight = useMemo(() => {
        const g = Number(grossWeight);
        const qty = Number(bobbinQty);
        if (!g || !qty || !selectedBobbin || !selectedBox) return 0;
        const tare = (selectedBox.weight || 0) + (selectedBobbin.weight || 0) * qty;
        return Math.max(0, g - tare);
    }, [grossWeight, bobbinQty, selectedBobbin, selectedBox]);

    const issueReceiveRows = useMemo(() => {
        if (!issueRecord?.id) return [];
        const allRows = db.receive_from_cutter_machine_rows || [];
        const linkedRows = allRows.filter((row) => !row.isDeleted && row.issueId === issueRecord.id);
        const issuePieceIds = Array.isArray(issueRecord.pieceIds) ? issueRecord.pieceIds : [];
        const issueCreatedAtMs = toTimeMs(issueRecord.createdAt);
        // Include eligible legacy rows where issueId was not captured historically.
        const legacyRows = allRows.filter((row) => {
            if (row.isDeleted) return false;
            if (row.issueId) return false;
            if (!issuePieceIds.includes(row.pieceId)) return false;
            const rowCreatedAtMs = toTimeMs(row.createdAt || row.date);
            if (issueCreatedAtMs != null && (rowCreatedAtMs == null || rowCreatedAtMs < issueCreatedAtMs)) return false;
            if (rowCreatedAtMs == null) return false;
            const timeline = cutterIssueTimelineByPiece.get(row.pieceId) || [];
            const assignedIssue = [...timeline]
                .reverse()
                .find((entry) => entry.createdAtMs != null && entry.createdAtMs <= rowCreatedAtMs);
            return assignedIssue?.issueId === issueRecord.id;
        });
        const byId = new Map();
        [...linkedRows, ...legacyRows].forEach((row) => {
            if (row?.id) byId.set(row.id, row);
        });
        return Array.from(byId.values());
    }, [db.receive_from_cutter_machine_rows, issueRecord, cutterIssueTimelineByPiece]);

    // Compute issue-level metrics (take-back aware when issueBalance is present).
    const {
        inboundWeight,
        originalIssuedWeight,
        takenBackWeight,
        netIssuedWeight,
        totalReceived,
        totalReceivedBobbins,
        pendingWeight,
        wastageWeight,
    } = useMemo(() => {
        if (!issueRecord || !issueRecord.pieceIds?.length) {
            return {
                inboundWeight: 0,
                originalIssuedWeight: 0,
                takenBackWeight: 0,
                netIssuedWeight: 0,
                totalReceived: 0,
                totalReceivedBobbins: 0,
                pendingWeight: 0,
                wastageWeight: 0,
            };
        }
        const pieceIds = issueRecord.pieceIds;
        const issueBalance = issueRecord.issueBalance || db?.issue_balances?.[issueRecord.id] || null;

        const inboundWt = pieceIds.reduce((sum, pid) => {
            const piece = db.inbound_items?.find(p => p.id === pid);
            return sum + (piece?.weight || 0);
        }, 0);

        const receivedFromRows = issueReceiveRows
            .filter((row) => !row.isWastage)
            .reduce((sum, row) => sum + Number(row.netWt || row.netWeight || 0), 0);
        const wastageFromRows = issueReceiveRows
            .filter((row) => row.isWastage)
            .reduce((sum, row) => sum + Number(row.netWt || row.netWeight || 0), 0);
        const bobbinsFromRows = issueReceiveRows
            .filter((row) => !row.isWastage)
            .reduce((sum, row) => sum + Number(row.bobbinQuantity || 0), 0);

        const receivedInCart = cart
            .filter((entry) => !entry.isWastage)
            .reduce((sum, entry) => sum + (Number(entry.netWeight) || 0), 0);
        const bobbinsInCart = cart
            .filter((entry) => !entry.isWastage)
            .reduce((sum, entry) => sum + (Number(entry.bobbinQty) || 0), 0);
        const wastageInCart = cart
            .filter((entry) => entry.isWastage)
            .reduce((sum, entry) => sum + (Number(entry.netWeight) || 0), 0);

        const originalIssued = Number(issueBalance?.originalWeight ?? issueRecord.totalWeight ?? inboundWt);
        const takenBack = Number(issueBalance?.takeBackWeight || 0);
        const netIssued = Number(issueBalance?.netIssuedWeight ?? Math.max(0, originalIssued - takenBack));
        const receivedBase = Number(issueBalance?.receivedWeight ?? receivedFromRows);
        const wastageBase = Number(issueBalance?.wastageWeight ?? wastageFromRows);
        const pendingBase = Number(issueBalance?.pendingWeight ?? Math.max(0, netIssued - receivedBase - wastageBase));

        return {
            inboundWeight: inboundWt,
            originalIssuedWeight: Math.max(0, originalIssued),
            takenBackWeight: Math.max(0, takenBack),
            netIssuedWeight: Math.max(0, netIssued),
            totalReceived: Math.max(0, receivedBase + receivedInCart),
            totalReceivedBobbins: Math.max(0, bobbinsFromRows + bobbinsInCart),
            pendingWeight: Math.max(0, pendingBase - receivedInCart - wastageInCart),
            wastageWeight: Math.max(0, wastageBase + wastageInCart),
        };
    }, [issueRecord, db.inbound_items, db.issue_balances, issueReceiveRows, cart]);

    const pieceIdToUse = issueRecord?.pieceIds?.[0] || '';

    const pieceStatus = useMemo(() => {
        if (!pieceIdToUse) {
            return {
                inboundWeight: 0,
                receivedWeight: 0,
                wastageWeight: 0,
                pendingWeight: 0,
                hasWastageInDb: false,
                hasWastageInCart: false,
            };
        }
        const pieceMeta = db.inbound_items?.find(p => p.id === pieceIdToUse);
        const issueLines = (db.issue_to_cutter_machine_lines || []).filter((line) => line.issueId === issueRecord?.id);
        const issueLineWeight = issueLines
            .filter((line) => line.pieceId === pieceIdToUse)
            .reduce((sum, line) => sum + Number(line.issuedWeight || 0), 0);
        const activeTakeBacks = (db.issue_take_backs || []).filter((tb) => (
            tb.issueId === issueRecord?.id
            && !tb.isReverse
            && !tb.isReversed
        ));
        const takeBackForPiece = activeTakeBacks.reduce((sum, tb) => {
            const lines = Array.isArray(tb.lines) ? tb.lines : [];
            return sum + lines
                .filter((line) => String(line?.sourceId || '') === pieceIdToUse)
                .reduce((lineSum, line) => lineSum + Number(line?.weight || 0), 0);
        }, 0);

        const linkedPieceRows = issueReceiveRows.filter((row) => row.pieceId === pieceIdToUse);
        const receivedDb = linkedPieceRows
            .filter((row) => !row.isWastage)
            .reduce((sum, row) => sum + Number(row.netWt || row.netWeight || 0), 0);
        const wastageDb = linkedPieceRows
            .filter((row) => row.isWastage)
            .reduce((sum, row) => sum + Number(row.netWt || row.netWeight || 0), 0);

        const cartReceived = cart.reduce((sum, entry) => {
            if (entry.pieceId !== pieceIdToUse || entry.isWastage) return sum;
            return sum + (Number(entry.netWeight) || 0);
        }, 0);

        const cartWastage = cart.reduce((sum, entry) => {
            if (entry.pieceId !== pieceIdToUse || !entry.isWastage) return sum;
            return sum + (Number(entry.netWeight) || 0);
        }, 0);

        const legacyInboundWeight = Number(pieceMeta?.weight || 0);
        const issueNetForPiece = issueLineWeight > 0
            ? Math.max(0, issueLineWeight - takeBackForPiece)
            : legacyInboundWeight;
        const pendingWeight = Math.max(0, issueNetForPiece - receivedDb - wastageDb - cartReceived - cartWastage);

        return {
            inboundWeight: issueNetForPiece,
            receivedWeight: receivedDb + cartReceived,
            wastageWeight: wastageDb + cartWastage,
            pendingWeight,
            hasWastageInDb: wastageDb > 0,
            hasWastageInCart: cartWastage > 0,
        };
    }, [pieceIdToUse, db.inbound_items, db.issue_to_cutter_machine_lines, db.issue_take_backs, issueRecord?.id, issueReceiveRows, cart]);

    const effectiveNetWeight = isWastage ? pieceStatus.pendingWeight : netWeight;
    const isWastageClosed = pieceStatus.pendingWeight <= 0 && pieceStatus.hasWastageInDb;
    const receivingBlocked = pieceStatus.hasWastageInCart || isWastageClosed;
    const receiveFieldsDisabled = isWastage || receivingBlocked;
    const isReceivedOverIssued = netIssuedWeight > 0
        && totalReceived > netIssuedWeight + RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG;
    const excessReceivedWeight = Math.max(0, totalReceived - netIssuedWeight);

    const computeNextBarcode = (pieceId, lotNo, seq) => {
        const existing = (db.receive_from_cutter_machine_rows || []).filter((row) => row.pieceId === pieceId && !row.isDeleted);
        const existingMax = existing.reduce((max, row) => {
            const idx = parseReceiveCrateIndex(row.barcode);
            if (idx != null && idx > max) return idx;
            return max;
        }, 0);
        const inCartCount = cart.filter((c) => c.pieceId === pieceId && !c.isWastage).length;
        const nextIndex = existingMax + inCartCount + 1;
        return makeReceiveBarcode({ lotNo, seq, crateIndex: nextIndex });
    };

    const handleAdd = wrapAdd(async () => {
        if (!issueRecord) return;

        if (!pieceIdToUse) {
            showMessage('No piece ID found in issue record');
            return;
        }

        if (!operatorId) {
            showMessage('Please select the operator for this crate.');
            return;
        }

        if (isWastageClosed) {
            showMessage('This piece is already marked as wastage. Receiving is closed.');
            return;
        }

        if (pieceStatus.hasWastageInCart) {
            showMessage('Wastage is already queued for this piece. Remove it to continue.');
            return;
        }

        if (isWastage) {
            const closeWeight = Math.min(pieceStatus.pendingWeight, pendingWeight);
            if (closeWeight <= 0) {
                showMessage('Piece has no pending weight remaining.');
                return;
            }

            setPendingWastageContext({
                closeWeight,
                lotNo: issueRecord.lotNo,
                pieceId: pieceIdToUse,
            });
            setWastageDialogOpen(true);
            return;
        }

        // Validation: Cut, Bobbin, Box, Qty, Gross Weight are mandatory. Helper and Shift are optional.
        if (!cutId || !bobbinId || !boxId || !bobbinQty || !grossWeight) {
            showMessage('Please fill all fields (Cut, Bobbin, Box, Qty, Gross Weight)');
            return;
        }

        // Validate bobbin weight is set (0 is allowed)
        const bobbinWeightRaw = selectedBobbin?.weight;
        const bobbinWeight = Number(bobbinWeightRaw);
        if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
            showMessage('Bobbin weight is missing. Please update the bobbin first.');
            return;
        }

        // Validate box weight is set
        const boxWeight = Number(selectedBox?.weight);
        if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
            showMessage('Box weight is missing. Please update the box first.');
            return;
        }

        // Validate net weight is positive
        if (!Number.isFinite(netWeight) || netWeight <= 0) {
            showMessage('Computed net weight must be positive. Check weights and quantity.');
            return;
        }

        // Validate net weight doesn't exceed pending weight
        const pieceMeta = db.inbound_items.find((p) => p.id === pieceIdToUse);
        const piecePendingWeight = pieceStatus.pendingWeight;

        if (pendingWeight <= 0) {
            showMessage('Issue has no pending weight remaining.');
            return;
        }

        if (piecePendingWeight <= 0) {
            showMessage('Piece has no pending weight remaining.');
            return;
        }

        if (netWeight > pendingWeight + 0.001) {
            showMessage(`Net weight (${netWeight.toFixed(3)} kg) exceeds issue pending weight (${pendingWeight.toFixed(3)} kg).`);
            return;
        }

        if (netWeight > piecePendingWeight + 0.001) {
            showMessage(`Net weight (${netWeight.toFixed(3)} kg) exceeds piece pending weight (${piecePendingWeight.toFixed(3)} kg).`);
            return;
        }

        const seq = pieceMeta?.seq || Number((pieceMeta?.id || '').split('-').pop());
        const receiveBarcode = computeNextBarcode(pieceIdToUse, issueRecord.lotNo, seq || 0);

        const cutName = db.cuts.find(c => c.id === cutId)?.name;
        const helperName = db.workers.find(o => o.id === helperId)?.name;

        setCart(prev => [...prev, {
            id: uid(),
            issueId: issueRecord.id,
            pieceId: pieceIdToUse,
            lotNo: issueRecord.lotNo,
            itemId: issueRecord.itemId,
            operatorId,
            cutId, helperId, shift, bobbinId, boxId, bobbinQty, grossWeight, isWastage, receiveDate,
            weightProvenance: transactionWeightProvenance(grossWeight, weightProvenance),
            netWeight: netWeight,
            barcode: receiveBarcode,

            // Display Names
            itemName: db.items.find(i => i.id === issueRecord.itemId)?.name,
            cutName: cutName,
            cut: cutName,
            helperName: helperName,
            shiftName: shift,
            operatorName: db.workers.find(o => o.id === operatorId)?.name,
            bobbinName: selectedBobbin?.name,
            boxName: selectedBox?.name
        }]);

        try {
        const tpl = template || (await loadTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE));
        if (tpl && receiveBarcode) {
            setPendingPrint({
                template: tpl,
                data: {
                    lotNo: issueRecord.lotNo,
                    itemName: db.items.find(i => i.id === issueRecord.itemId)?.name,
                    pieceId: pieceIdToUse,
                    barcode: receiveBarcode,
                    netWeight,
                    grossWeight,
                    tareWeight: ((selectedBox?.weight || 0) + (selectedBobbin?.weight || 0) * Number(bobbinQty)).toFixed(3),
                    bobbinQty,
                    bobbinName: selectedBobbin?.name,
                    boxName: selectedBox?.name,
                    cut: cutName,
                    cutName,
                    machineName: db.machines.find(m => m.id === issueRecord.machineId)?.name,
                    helperName,
                    operatorName: db.workers.find(o => o.id === operatorId)?.name,
                    shift,
                    date: receiveDate,
                },
            });
        }

        } catch (error) {
            showMessage(`Crate is in the cart. Its label could not be prepared: ${error.message}. Do not add this crate again.`);
        }

        // Reset fields for next box
        setGrossWeight(''); setWeightProvenance(null);
        setBobbinQty('');
        setIsWastage(false);
    });

    const handleSave = wrapSave(async () => {
        if (cart.length === 0) return;
        setSaving(true);
        try {
            const entries = cart.map(entry => ({
                issueId: entry.issueId,
                pieceId: entry.pieceId,
                lotNo: entry.lotNo,
                bobbinId: entry.bobbinId,
                boxId: entry.boxId,
                bobbinQuantity: Number(entry.bobbinQty),
                grossWeight: Number(entry.grossWeight),
                weightProvenance: transactionWeightProvenance(entry.grossWeight, entry.weightProvenance),
                receiveDate: entry.receiveDate,
                operatorId: entry.operatorId,
                cutId: entry.cutId,
                helperId: entry.helperId,
                shift: entry.shift,
                isWastage: entry.isWastage,
                wastageNote: entry.isWastage ? (entry.wastageNote || null) : undefined,
            }));

            const res = await api.createCutterReceiveChallan({ entries });
            // Avoid full bootstrap refresh; cutter receives are covered by the cutter process module.
            const refreshResult = await refreshAfterCommit(() => refreshProcessData('cutter'));
            emitInvalidation(INVENTORY_INVALIDATION_KEYS.receiveHistory('cutter'), {
                source: 'createCutterReceiveChallan',
                challanId: res?.challan?.id || null,
            });
            setCart([]);
            setIssueRecord(null);
            setBarcode('');
            const challans = res?.challans || (res?.challan ? [res.challan] : []);
            setFeedback({
                title: 'Received successfully',
                message: `${cart.filter(entry => !entry.isWastage).length} crates saved. ${challans.length} ${challans.length === 1 ? 'challan' : 'challans'} generated.${refreshResult.warning ? ` Data refresh failed: ${refreshResult.warning}. Do not save again; reload the view.` : ''}`,
                challans,
            });
            barcodeInputRef.current?.focus();
        } catch (e) {
            showMessage(e.message);
        } finally {
            setSaving(false);
        }
    });

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Scan Barcode (Cutter)</CardTitle></CardHeader>
                <CardContent>
                    <form onSubmit={handleScan} className="flex flex-col sm:flex-row gap-4">
                        <Input
                            ref={barcodeInputRef}
                            value={barcode}
                            onChange={e => setBarcode(e.target.value)}
                            placeholder="Scan Issue Barcode..."
                            className="text-lg flex-1"
                        />
                        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                            {loading ? 'Scanning...' : <><Scan className="w-4 h-4 mr-2" /> Scan</>}
                        </Button>
                    </form>

                    {issueRecord && (
                        <ResizableIssueSummary
                            idPrefix="receive-summary-cutter"
                            warning={isReceivedOverIssued ? { excessKg: excessReceivedWeight } : null}
                        >
                            <ReceiveSummaryGroup id="receive-summary-cutter-material" title="Material / Assignment">
                                <div className="min-w-0" style={receiveSummaryMetricGridStyle}>
                                    <ReceiveSummaryMetricCard label="Lot" value={issueRecord.lotNo || '—'} />
                                    <ReceiveSummaryMetricCard label="Item" value={db.items.find(i => i.id === issueRecord.itemId)?.name || '—'} />
                                    <ReceiveSummaryMetricCard label="Machine" value={db.machines.find(m => m.id === issueRecord.machineId)?.name || '—'} />
                                    <ReceiveSummaryMetricCard label="Issue Operator" value={db.workers.find(o => o.id === issueRecord.operatorId)?.name || '—'} />
                                </div>
                            </ReceiveSummaryGroup>

                            <ReceiveSummaryGroup id="receive-summary-cutter-issue-balance" title="Issue Balance">
                                <div className="min-w-0" style={receiveSummaryMetricGridStyle}>
                                    <ReceiveSummaryMetricCard label="Inbound" value={formatKg(inboundWeight)} unit="kg" />
                                    <ReceiveSummaryMetricCard label="Issued (Orig)" value={formatKg(originalIssuedWeight)} unit="kg" />
                                    <ReceiveSummaryMetricCard label="Taken Back" value={formatKg(takenBackWeight)} unit="kg" />
                                    <ReceiveSummaryMetricCard label="Net Issued" value={formatKg(netIssuedWeight)} unit="kg" />
                                </div>
                            </ReceiveSummaryGroup>

                            <ReceiveSummaryGroup id="receive-summary-cutter-production-outcome" title="Production Outcome">
                                <div className="min-w-0" style={receiveSummaryMetricGridStyle}>
                                    <ReceiveSummaryMetricCard
                                        label="Received"
                                        value={formatKg(totalReceived)}
                                        unit="kg"
                                        valueClassName={isReceivedOverIssued ? 'text-destructive' : ''}
                                        action={(
                                            <InfoPopover
                                                title="Received Crates"
                                                items={issueReceiveRows}
                                                renderContent={(items) => (
                                                    <table className="w-full text-xs">
                                                        <thead>
                                                            <tr className="border-b">
                                                                <th className="text-left py-1 px-1 font-medium">Barcode</th>
                                                                <th className="text-left py-1 px-1 font-medium">Date</th>
                                                                <th className="text-right py-1 px-1 font-medium">Bobbins</th>
                                                                <th className="text-right py-1 px-1 font-medium">Net Wt</th>
                                                                <th className="text-left py-1 px-1 font-medium">Cut</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {items.map((row, idx) => (
                                                                <tr key={row.id || idx} className="border-b last:border-0">
                                                                    <td className="py-1 px-1 font-mono">{row.barcode || '—'}</td>
                                                                    <td className="py-1 px-1">{formatDateDDMMYYYY(row.date || row.createdAt) || '—'}</td>
                                                                    <td className="py-1 px-1 text-right">{row.bobbinQuantity || 0}</td>
                                                                    <td className="py-1 px-1 text-right font-medium">{formatKg(row.netWt)}</td>
                                                                    <td className="py-1 px-1">{row.cutMaster?.name || (typeof row.cut === 'string' ? row.cut : row.cut?.name) || db.cuts?.find(c => c.id === row.cutId)?.name || '—'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr className="border-t-2 bg-muted/50 font-semibold">
                                                                <td className="py-1 px-1" colSpan={2}>Total</td>
                                                                <td className="py-1 px-1 text-right">{items.reduce((sum, row) => sum + (row.bobbinQuantity || 0), 0)}</td>
                                                                <td className="py-1 px-1 text-right">{formatKg(items.reduce((sum, row) => sum + Number(row.netWt || row.netWeight || 0), 0))}</td>
                                                                <td className="py-1 px-1"></td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                )}
                                                emptyText="No crates received yet"
                                                widthClassName="w-[420px]"
                                                bodyClassName="max-h-[300px] overflow-y-auto"
                                                buttonClassName="h-6 w-6 rounded-full hover:bg-muted inline-flex ml-1"
                                                align="right"
                                            />
                                        )}
                                    />
                                    <ReceiveSummaryMetricCard label="Wastage" value={formatKg(wastageWeight)} unit="kg" />
                                    <ReceiveSummaryMetricCard
                                        label="Pending"
                                        value={formatKg(pendingWeight)}
                                        unit="kg"
                                        valueClassName={pendingWeight > 0.001 ? '' : 'text-muted-foreground'}
                                        detail={isWastageClosed ? `(${formatKg(pieceStatus.wastageWeight)} kg wastage)` : null}
                                        action={!isWastageClosed ? (
                                            <InfoPopover
                                                title="Piece Close"
                                                items={[pieceStatus]}
                                                renderContent={() => {
                                                    if (!pieceIdToUse) {
                                                        return (
                                                            <div className="text-muted-foreground">
                                                                Scan an issue barcode to manage piece wastage.
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div className="space-y-2 text-xs">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-muted-foreground">Piece</span>
                                                                <span className="font-mono">{pieceIdToUse}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-muted-foreground">Pending to close</span>
                                                                <span className="font-medium">{formatKg(pieceStatus.pendingWeight)}</span>
                                                            </div>
                                                            {pieceStatus.hasWastageInCart && (
                                                                <div className="text-muted-foreground">
                                                                    Wastage is queued in the list. Remove it to continue.
                                                                </div>
                                                            )}
                                                            <label className="flex items-start gap-2 cursor-pointer">
                                                                <Checkbox
                                                                    checked={isWastage}
                                                                    onCheckedChange={setIsWastage}
                                                                    disabled={!pieceIdToUse || pieceStatus.pendingWeight <= 0 || receivingBlocked}
                                                                />
                                                                <span className="leading-snug">Close piece (mark remaining as wastage)</span>
                                                            </label>
                                                        </div>
                                                    );
                                                }}
                                                widthClassName="w-64"
                                                bodyClassName="text-xs"
                                                buttonClassName="h-6 w-6 rounded-full hover:bg-muted inline-flex ml-1"
                                                align="right"
                                            />
                                        ) : null}
                                    />
                                    <ReceiveSummaryMetricCard label="Bobbins" value={totalReceivedBobbins} unit="bobbins" />
                                </div>
                            </ReceiveSummaryGroup>
                        </ResizableIssueSummary>
                    )}
                </CardContent>
            </Card>

            {issueRecord && isWastageClosed && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Wastage already marked. Receiving is closed.
                </div>
            )}

            {issueRecord && !isWastageClosed && (
                <Card className="fade-in">
                    <CardHeader><CardTitle>Receive Details</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                            <div>
                                <Label htmlFor="cutter-receive-date">Date</Label>
                                <Input id="cutter-receive-date" type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} disabled={receiveFieldsDisabled} />
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-cut">Cut</Label>
                                <Select id="cutter-receive-cut" value={cutId} onChange={e => setCutId(e.target.value)} disabled={receiveFieldsDisabled}>
                                    <option value="">Select Cut</option>
                                    {db.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-operator">Operator</Label>
                                <Select id="cutter-receive-operator" value={operatorId} onChange={e => setOperatorId(e.target.value)} disabled={receiveFieldsDisabled}>
                                    <option value="">Select Operator</option>
                                    {(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-helper">Helper (Optional)</Label>
                                <Select id="cutter-receive-helper" value={helperId} onChange={e => setHelperId(e.target.value)} disabled={receiveFieldsDisabled}>
                                    <option value="">Select Helper</option>
                                    {(db.helpers || []).filter(h => h.processType === 'all' || h.processType === 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-shift">Shift (Optional)</Label>
                                <Select id="cutter-receive-shift" value={shift} onChange={e => setShift(e.target.value)} disabled={receiveFieldsDisabled}>
                                    <option value="">Select Shift</option>
                                    <option value="Day">Day</option>
                                    <option value="Night">Night</option>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                                <Label htmlFor="cutter-receive-bobbin">Bobbin Type</Label>
                                <Select id="cutter-receive-bobbin" value={bobbinId} onChange={e => setBobbinId(e.target.value)} disabled={receiveFieldsDisabled}>
                                    <option value="">Select Bobbin</option>
                                    {db.bobbins?.map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-box">Box Type</Label>
                                <Select id="cutter-receive-box" value={boxId} onChange={e => setBoxId(e.target.value)} disabled={receiveFieldsDisabled}>
                                    <option value="">Select Box</option>
                                    {(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'cutter').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-qty">Bobbin Qty</Label>
                                <Input id="cutter-receive-qty" type="number" value={bobbinQty} onChange={e => setBobbinQty(e.target.value)} disabled={receiveFieldsDisabled} />
                            </div>
                            <div>
                                <Label htmlFor="cutter-receive-gross">Gross Weight</Label>
                                <div className="flex gap-2">
                                    <Input id="cutter-receive-gross" type="number" value={grossWeight} onChange={e => { setGrossWeight(e.target.value); setWeightProvenance(null); }} className="flex-1" disabled={receiveFieldsDisabled} />
                                    <CatchWeightButton
                                        onWeightCaptured={(wt, meta) => { setGrossWeight(String(wt)); setWeightProvenance(meta); }}
                                        disabled={receiveFieldsDisabled}
                                        context={{
                                            feature: 'receive',
                                            stage: 'cutter',
                                            field: 'grossWeight',
                                            issueId: issueRecord?.id || null,
                                            issueBarcode: issueRecord?.barcode || null,
                                            lotNo: issueRecord?.lotNo || null,
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pt-2">
                            <div className="text-sm font-medium">
                                {isWastage
                                    ? `Wastage Weight (Pending): ${formatKg(effectiveNetWeight)}`
                                    : `Calculated Net Weight: ${formatKg(effectiveNetWeight)}`}
                            </div>
                            <Button onClick={handleAdd} disabled={addLocked || receivingBlocked || !effectiveNetWeight} className="w-full sm:w-auto">
                                <Plus className="w-4 h-4 mr-2" /> {isWastage ? 'Add Wastage to List' : 'Add to List'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {cart.length > 0 && (
                <Card className="fade-in">
                    <CardContent className="pt-6">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Lot</TableHead>
                                        <TableHead>Details</TableHead>
                                        <TableHead>Operator</TableHead>
                                        <TableHead>Helper</TableHead>
                                        <TableHead className="text-right">Net Weight</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {cart.map((entry) => (
                                        <TableRow key={entry.id}>
                                            <TableCell>{entry.lotNo}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {entry.isWastage ? (
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-destructive font-bold">WASTAGE / CLOSE</span>
                                                            <span>{formatKg(entry.netWeight)}</span>
                                                        </div>
                                                        {entry.wastageNote && (
                                                            <span className="italic text-[11px] text-muted-foreground">"{entry.wastageNote}"</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div>
                                                        {entry.bobbinQty} x {entry.bobbinName}
                                                        {entry.cutName && ` | ${entry.cutName}`}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell>{entry.operatorName || '—'}</TableCell>
                                            <TableCell>{entry.helperName || '—'}</TableCell>
                                            <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(entry.netWeight)}</TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="icon" onClick={() => setCart(c => c.filter(x => x.id !== entry.id))} className="h-6 w-6 text-destructive">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-4 rounded-md border bg-muted/30 p-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold">Summary by worker</h3>
                                <span className="text-sm text-muted-foreground">
                                    {cart.filter(entry => !entry.isWastage).length} crates · {workerGroups.length} {workerGroups.length === 1 ? 'challan' : 'challans'}
                                </span>
                            </div>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Operator</TableHead>
                                            <TableHead>Helper</TableHead>
                                            <TableHead className="text-right">Crates</TableHead>
                                            <TableHead className="text-right">Net Weight</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {workerGroups.map(group => (
                                            <TableRow key={group.key}>
                                                <TableCell>{group.operatorName}</TableCell>
                                                <TableCell>{group.helperName}</TableCell>
                                                <TableCell className="text-right">{group.crates}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatKg(group.netWeight)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving...' : <><Save className="w-4 h-4 mr-2" /> Save All</>}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <ConfirmDialog
                open={!!pendingPrint}
                title="Print crate sticker"
                message="Print sticker for this crate?"
                confirmLabel="Print sticker"
                cancelLabel="Skip printing"
                destructive={false}
                onCancel={() => setPendingPrint(null)}
                onConfirm={async () => {
                    const job = pendingPrint;
                    setPendingPrint(null);
                    try {
                        await printStageTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE, job.data, { template: job.template });
                    } catch (error) {
                        showMessage(error.message || 'Failed to print sticker');
                    }
                }}
            />
            <Dialog open={!!feedback} onOpenChange={() => setFeedback(null)}>
                <DialogContent title={feedback?.title} onOpenChange={() => setFeedback(null)} role="dialog" aria-label={feedback?.title}>
                    <div className="space-y-4">
                        <p className="text-sm whitespace-pre-line">{feedback?.message}</p>
                        {feedback?.challans?.length > 0 && (
                            <ul className="space-y-2 text-sm">
                                {feedback.challans.map(challan => (
                                    <li key={challan.id} className="rounded-md border p-3 flex flex-wrap justify-between gap-2">
                                        <span className="font-medium">{challan.challanNo}</span>
                                        <span>{db.workers.find(worker => worker.id === challan.operatorId)?.name || '—'} · {formatKg(challan.totalNetWeight)} kg</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex justify-end"><Button onClick={() => setFeedback(null)}>Done</Button></div>
                    </div>
                </DialogContent>
            </Dialog>
            <WastageNoteDialog
                open={wastageDialogOpen}
                onOpenChange={(open) => {
                    setWastageDialogOpen(open);
                    if (!open) setPendingWastageContext(null);
                }}
                mode="mark"
                stage="cutter"
                contextLine={pendingWastageContext ? `Lot ${pendingWastageContext.lotNo} • Piece ${pendingWastageContext.pieceId}` : ''}
                weight={pendingWastageContext?.closeWeight}
                onConfirm={({ note }) => {
                    if (!pendingWastageContext || !issueRecord) {
                        setWastageDialogOpen(false);
                        setPendingWastageContext(null);
                        return;
                    }
                    setCart(prev => [...prev, {
                        id: uid(),
                        issueId: issueRecord.id,
                        pieceId: pendingWastageContext.pieceId,
                        lotNo: issueRecord.lotNo,
                        itemId: issueRecord.itemId,
                        operatorId,
                        cutId,
                        helperId,
                        shift,
                        bobbinId: '',
                        boxId: '',
                        bobbinQty: '',
                        grossWeight: '',
                        isWastage: true,
                        wastageNote: note || null,
                        receiveDate,
                        netWeight: pendingWastageContext.closeWeight,
                        barcode: '',
                        itemName: db.items.find(i => i.id === issueRecord.itemId)?.name,
                        cutName: db.cuts.find(c => c.id === cutId)?.name,
                        cut: db.cuts.find(c => c.id === cutId)?.name,
                        helperName: db.workers.find(o => o.id === helperId)?.name,
                        shiftName: '',
                        operatorName: db.workers.find(o => o.id === operatorId)?.name,
                        bobbinName: '',
                        boxName: '',
                    }]);
                    setIsWastage(false);
                    setWastageDialogOpen(false);
                    setPendingWastageContext(null);
                }}
            />
        </div>
    );
}
