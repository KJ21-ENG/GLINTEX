import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Badge, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatKg, todayISO, formatDateDDMMYYYY } from '../../utils';
import { QrCode } from 'lucide-react';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { BarcodeScanDialog } from '../scanner/BarcodeScanDialog';
import { useSubmitLock } from '../../hooks/useSubmitLock';
import { useUnsavedGuard } from '../../context/UnsavedChangesContext';

const EPSILON = 1e-6;
const clampWeight = (value, maxValue) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (!Number.isFinite(maxValue)) return Math.max(0, numeric);
    return Math.max(0, Math.min(numeric, maxValue));
};

const to3 = (value) => Math.round(Number(value || 0) * 1000) / 1000;

export function IssueToCutter() {
    const { db, createIssueToMachine, refreshing, loading } = useInventory();

    const [date, setDate] = useState(todayISO());
    const [itemId, setItemId] = useState("");
    const [lotNo, setLotNo] = useState("");
    const [machineId, setMachineId] = useState("");
    const [operatorId, setOperatorId] = useState("");
    const [cutId, setCutId] = useState("");
    const [note, setNote] = useState("");
    const [selectedLines, setSelectedLines] = useState([]);
    const [barcodeScan, setBarcodeScan] = useState('');
    const [scanLoading, setScanLoading] = useState(false);
    const [issuing, setIssuing] = useState(false);
    const [, wrapScan] = useSubmitLock();
    const [, wrapIssue] = useSubmitLock();
    // Item/lot/machine context is retained after a successful issue (next issue
    // reuses it) — only the staged piece selection counts as unsaved.
    useUnsavedGuard('issue-to-cutter', selectedLines.length > 0);
    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanFeedback, setScanFeedback] = useState(null);
    const [scannedPieces, setScannedPieces] = useState([]);
    const [remoteLots, setRemoteLots] = useState([]);
    const [remotePieces, setRemotePieces] = useState([]);
    const [candidateRefreshNonce, setCandidateRefreshNonce] = useState(0);
    const [candidateLoading, setCandidateLoading] = useState(false);
    const [lotCandidateCursor, setLotCandidateCursor] = useState(null);
    const [pieceCandidateCursor, setPieceCandidateCursor] = useState(null);
    const [lotsHaveMore, setLotsHaveMore] = useState(false);
    const [piecesHaveMore, setPiecesHaveMore] = useState(false);
    const lotCandidateGeneration = useRef(0);
    const pieceCandidateGeneration = useRef(0);

    useEffect(() => {
        if (!scanFeedback) return;
        const t = setTimeout(() => setScanFeedback(null), 2000);
        return () => clearTimeout(t);
    }, [scanFeedback]);

    // Filtered Lots
    const inboundItems = useMemo(() => {
        const byId = new Map((db?.inbound_items || []).map((piece) => [piece.id, piece]));
        remotePieces.forEach((piece) => byId.set(piece.id, { ...(byId.get(piece.id) || {}), ...piece }));
        scannedPieces.forEach((piece) => byId.set(piece.id, { ...(byId.get(piece.id) || {}), ...piece }));
        return Array.from(byId.values());
    }, [db?.inbound_items, remotePieces, scannedPieces]);
    const lots = useMemo(() => {
        const byLotNo = new Map((db?.lots || []).map((lot) => [lot.lotNo, lot]));
        remoteLots.forEach((lot) => byLotNo.set(lot.lotNo, { ...(byLotNo.get(lot.lotNo) || {}), ...lot, itemId }));
        scannedPieces.forEach((piece) => {
            if (!piece?.lotNo || byLotNo.has(piece.lotNo)) return;
            byLotNo.set(piece.lotNo, {
                lotNo: piece.lotNo,
                itemId: piece.itemId,
                date: piece.date || piece.createdAt || '',
            });
        });
        return Array.from(byLotNo.values());
    }, [db?.lots, itemId, remoteLots, scannedPieces]);
    const issueToCutterRows = db?.issue_to_cutter_machine || [];
    const getIssueableWeight = (piece) => {
        const gross = Number(piece?.weight || 0);
        const dispatched = Number(piece?.dispatchedWeight || 0);
        const issued = Number(piece?.issuedToCutterWeight || 0);
        return Math.max(0, gross - dispatched - issued);
    };

    const candidateLots = useMemo(() => {
        if (!itemId) return [];
        return lots
            .filter(l => l.itemId === itemId)
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [itemId, lots]);

    // Available Pieces
    const availablePieces = useMemo(() => {
        if (!lotNo) return [];
        return inboundItems
            .filter(ii => ii.lotNo === lotNo && ii.itemId === itemId && Number(ii.dispatchedWeight || 0) <= 0)
            .map((ii) => ({
                ...ii,
                issueableWeight: getIssueableWeight(ii),
            }))
            .filter((ii) => ii.issueableWeight > EPSILON)
            .sort((a, b) => a.seq - b.seq);
    }, [inboundItems, lotNo, itemId]);

    useEffect(() => {
        const generation = ++lotCandidateGeneration.current;
        let active = true;
        setRemoteLots([]);
        setRemotePieces([]);
        setLotCandidateCursor(null);
        setPieceCandidateCursor(null);
        setLotsHaveMore(false);
        setPiecesHaveMore(false);
        if (!itemId) return () => { active = false; };
        setCandidateLoading(true);
        api.getV2CutterSourceCandidates({ itemId, limit: 100 })
            .then((result) => {
                if (!active || generation !== lotCandidateGeneration.current) return;
                setRemoteLots(Array.isArray(result?.items) ? result.items : []);
                setLotCandidateCursor(result?.nextCursor || null);
                setLotsHaveMore(Boolean(result?.hasMore));
            })
            .catch((err) => {
                if (active) setScanFeedback(err?.message || 'Failed to load lots');
            })
            .finally(() => {
                if (active) setCandidateLoading(false);
            });
        return () => { active = false; };
    }, [itemId, candidateRefreshNonce]);

    useEffect(() => {
        const generation = ++pieceCandidateGeneration.current;
        let active = true;
        setRemotePieces([]);
        setPieceCandidateCursor(null);
        setPiecesHaveMore(false);
        if (!itemId || !lotNo) return () => { active = false; };
        setCandidateLoading(true);
        api.getV2CutterSourceCandidates({ itemId, lotNo, limit: 100 })
            .then((result) => {
                if (!active || generation !== pieceCandidateGeneration.current) return;
                setRemotePieces(Array.isArray(result?.items) ? result.items : []);
                setPieceCandidateCursor(result?.nextCursor || null);
                setPiecesHaveMore(Boolean(result?.hasMore));
            })
            .catch((err) => {
                if (active) setScanFeedback(err?.message || 'Failed to load pieces');
            })
            .finally(() => {
                if (active) setCandidateLoading(false);
            });
        return () => { active = false; };
    }, [itemId, lotNo, candidateRefreshNonce]);

    const loadMoreLots = async () => {
        if (!itemId || !lotsHaveMore || !lotCandidateCursor || candidateLoading) return;
        const generation = lotCandidateGeneration.current;
        setCandidateLoading(true);
        try {
            const result = await api.getV2CutterSourceCandidates({ itemId, limit: 100, cursor: lotCandidateCursor });
            if (generation !== lotCandidateGeneration.current) return;
            const nextItems = Array.isArray(result?.items) ? result.items : [];
            setRemoteLots((prev) => [...prev, ...nextItems.filter((row) => !prev.some((existing) => existing.lotNo === row.lotNo))]);
            setLotCandidateCursor(result?.nextCursor || null);
            setLotsHaveMore(Boolean(result?.hasMore));
        } catch (err) {
            if (generation === lotCandidateGeneration.current) setScanFeedback(err?.message || 'Failed to load more lots');
        } finally {
            if (generation === lotCandidateGeneration.current) setCandidateLoading(false);
        }
    };

    const loadMorePieces = async () => {
        if (!itemId || !lotNo || !piecesHaveMore || !pieceCandidateCursor || candidateLoading) return;
        const generation = pieceCandidateGeneration.current;
        setCandidateLoading(true);
        try {
            const result = await api.getV2CutterSourceCandidates({ itemId, lotNo, limit: 100, cursor: pieceCandidateCursor });
            if (generation !== pieceCandidateGeneration.current) return;
            const nextItems = Array.isArray(result?.items) ? result.items : [];
            setRemotePieces((prev) => [...prev, ...nextItems.filter((row) => !prev.some((existing) => existing.id === row.id))]);
            setPieceCandidateCursor(result?.nextCursor || null);
            setPiecesHaveMore(Boolean(result?.hasMore));
        } catch (err) {
            if (generation === pieceCandidateGeneration.current) setScanFeedback(err?.message || 'Failed to load more pieces');
        } finally {
            if (generation === pieceCandidateGeneration.current) setCandidateLoading(false);
        }
    };

    const selectedLineByPieceId = useMemo(() => {
        const map = new Map();
        (selectedLines || []).forEach((line) => {
            map.set(line.pieceId, line);
        });
        return map;
    }, [selectedLines]);

    const selectedWeightTotal = useMemo(() => {
        return (selectedLines || []).reduce((sum, line) => sum + Number(line.issuedWeight || 0), 0);
    }, [selectedLines]);

    const hasInvalidSelectedWeights = useMemo(() => {
        return (selectedLines || []).some((line) => Number(line.issuedWeight || 0) <= EPSILON);
    }, [selectedLines]);

    useEffect(() => {
        if (!availablePieces?.length) {
            setSelectedLines([]);
            return;
        }
        const maxByPieceId = new Map(availablePieces.map((piece) => [piece.id, Number(piece.issueableWeight || 0)]));
        setSelectedLines((prev) => (
            (prev || [])
                .filter((line) => maxByPieceId.has(line.pieceId))
                .map((line) => {
                    const max = maxByPieceId.get(line.pieceId);
                    return {
                        pieceId: line.pieceId,
                        issuedWeight: to3(clampWeight(line.issuedWeight, max)),
                    };
                })
        ));
    }, [availablePieces]);

    const addPieceLine = (pieceId, issuedWeight = null, pieceOverride = null) => {
        const piece = pieceOverride || availablePieces.find((entry) => entry.id === pieceId)
            || (inboundItems || []).find((entry) => entry.id === pieceId);
        if (!piece) return;
        const maxWeight = Number(piece.issueableWeight ?? getIssueableWeight(piece));
        if (maxWeight <= EPSILON) return;
        const nextWeight = issuedWeight == null ? maxWeight : clampWeight(issuedWeight, maxWeight);
        setSelectedLines((prev) => {
            const exists = (prev || []).some((line) => line.pieceId === piece.id);
            if (exists) return prev;
            return [...(prev || []), { pieceId: piece.id, issuedWeight: to3(nextWeight) }];
        });
    };

    // Last Issue Info
    const lastIssueForLot = useMemo(() => {
        if (!lotNo) return null;
        const rows = issueToCutterRows
            .filter(record => record.lotNo === lotNo)
            .sort((a, b) => b.date.localeCompare(a.date));
        return rows[0] || null;
    }, [issueToCutterRows, lotNo]);

    // Handlers
    async function addBarcode(raw) {
        const barcode = String(raw || '').trim().toUpperCase();
        if (!barcode) return;
        setScanLoading(true);
        try {
            const lookup = await api.getV2IssueSourceRow('cutter', barcode);
            const rawPiece = lookup?.row;
            if (!rawPiece) throw new Error('Barcode not found');
            const piece = {
                ...rawPiece,
                issueableWeight: Number(lookup?.availability?.availableWeight ?? rawPiece.availableWeight ?? 0),
                issuedToCutterWeight: Number(lookup?.availability?.issuedWeight ?? rawPiece.issuedToCutterWeight ?? 0),
                dispatchedWeight: Number(lookup?.availability?.dispatchedWeight ?? rawPiece.dispatchedWeight ?? 0),
            };
            const issueableWeight = Number(piece.issueableWeight || 0);
            if (issueableWeight <= EPSILON) {
                throw new Error('Piece has no available issue weight');
            }

            // Auto-select context
            if (itemId !== piece.itemId) setItemId(piece.itemId);
            if (lotNo !== piece.lotNo) setLotNo(piece.lotNo);
            setScannedPieces((prev) => [piece, ...prev.filter((entry) => entry.id !== piece.id)]);
            addPieceLine(piece.id, issueableWeight, piece);
            setScanFeedback(`Added ${barcode} (${formatKg(issueableWeight)})`);
        } catch (err) {
            alert(err.message);
        } finally {
            setScanLoading(false);
            setBarcodeScan('');
        }
    }

    const handleScan = wrapScan(async (e) => {
        e.preventDefault();
        return await addBarcode(barcodeScan);
    });

    const handleIssue = wrapIssue(async () => {
        if (!date || !itemId || !lotNo || !machineId || !operatorId || !cutId || selectedLines.length === 0) return;
        setIssuing(true);
        try {
            const pieceIds = selectedLines.map((line) => line.pieceId);
            const pieceLines = selectedLines.map((line) => ({
                pieceId: line.pieceId,
                issuedWeight: to3(Number(line.issuedWeight || 0)),
                count: 1,
            }));
            const payload = { date, itemId, lotNo, pieceIds, pieceLines, note, machineId, operatorId, cutId };
            const result = await createIssueToMachine(payload);
            const issueRecord = result?.issueToMachine || result?.issueToCutterMachine || result?.issue_to_cutter_machine;
            setSelectedLines([]);
            setScannedPieces((prev) => prev.filter((piece) => !pieceIds.includes(piece.id)));
            setCandidateRefreshNonce((value) => value + 1);
            setCutId("");
            setNote("");
            setIssuing(false);
            alert(`Issued ${pieceIds.length} pieces successfully.`);

            try {
                const template = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_ISSUE);
                if (template && issueRecord) {
                    const confirmPrint = window.confirm('Print sticker for this issue?');
                    if (confirmPrint) {
                        const itemName = db?.items?.find((i) => i.id === itemId)?.name;
                        const machineName = db?.machines?.find((m) => m.id === machineId)?.name;
                        const operatorName = db?.operators?.find((o) => o.id === operatorId)?.name;
                        const inboundDate = candidateLots.find((l) => l.lotNo === lotNo)?.date || '';
                        const cut = db?.cuts?.find((c) => c.id === cutId)?.name || '';
                        const selectedPieces = (inboundItems || []).filter((p) => pieceIds.includes(p.id));
                        const primaryPiece =
                            selectedPieces.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0] || selectedPieces[0] || null;
                        const pieceId = primaryPiece?.id || pieceIds[0] || '';
                        const seq = primaryPiece?.seq ?? '';
                        await printStageTemplate(
                            LABEL_STAGE_KEYS.CUTTER_ISSUE,
                            {
                                lotNo: issueRecord.lotNo,
                                itemName,
                                pieceId,
                                seq,
                                barcode: issueRecord.barcode,
                                count: issueRecord.count || pieceIds.length,
                                totalWeight: issueRecord.totalWeight,
                                pieceIds,
                                machineName,
                                operatorName,
                                inboundDate,
                                cut,
                                date,
                            },
                            { template },
                        );
                    }
                }
            } catch (printError) {
                console.error('Cutter issue label print failed', printError);
                alert('Issued successfully, sticker not printed');
            }
        } catch (e) {
            alert(e.message);
        } finally {
            setIssuing(false);
        }
    });

    function toggle(id) {
        const existing = selectedLineByPieceId.get(id);
        if (existing) {
            setSelectedLines((prev) => (prev || []).filter((line) => line.pieceId !== id));
            return;
        }
        addPieceLine(id);
    }

    function updateLineWeight(pieceId, rawValue) {
        const piece = availablePieces.find((entry) => entry.id === pieceId);
        if (!piece) return;
        const maxWeight = Number(piece.issueableWeight || 0);
        const nextWeight = to3(clampWeight(rawValue, maxWeight));
        setSelectedLines((prev) => (
            (prev || []).map((line) => (
                line.pieceId === pieceId
                    ? { ...line, issuedWeight: nextWeight }
                    : line
            ))
        ));
    }

    if (loading || !db) {
        return (
            <div className="flex justify-center py-8 text-muted-foreground text-sm">
                Loading inventory data...
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Issue Parameters</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <Label>Date</Label>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </div>
                        <div>
                            <Label>Item</Label>
                            <Select
                                value={itemId}
                                onChange={e => {
                                    setItemId(e.target.value);
                                    setLotNo('');
                                    setSelectedLines([]);
                                }}
                                options={db.items.map(i => ({ id: i.id, name: i.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Item"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Lot</Label>
                            <Select
                                value={lotNo}
                                onChange={e => setLotNo(e.target.value)}
                                options={candidateLots.map(l => ({ value: l.lotNo, label: `${l.lotNo} (${formatDateDDMMYYYY(l.date)})` }))}
                                placeholder="Select Lot"
                                clearable
                                disabled={!itemId || candidateLoading}
                            />
                            {lotsHaveMore && (
                                <Button type="button" variant="ghost" size="sm" className="mt-1 px-0" onClick={loadMoreLots} disabled={candidateLoading}>
                                    {candidateLoading ? 'Loading…' : 'Load more lots'}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <Label>Machine</Label>
                            <Select
                                value={machineId}
                                onChange={e => setMachineId(e.target.value)}
                                options={(db.machines || []).filter(m => m.processType === 'all' || m.processType === 'cutter').map(m => ({ id: m.id, name: m.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Machine"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Operator</Label>
                            <Select
                                value={operatorId}
                                onChange={e => setOperatorId(e.target.value)}
                                options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'cutter').map(o => ({ id: o.id, name: o.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Operator"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Cut</Label>
                            <Select
                                value={cutId}
                                onChange={e => setCutId(e.target.value)}
                                options={db.cuts.map(c => ({ id: c.id, name: c.name }))}
                                labelKey="name"
                                valueKey="id"
                                placeholder="Select Cut"
                                clearable
                            />
                        </div>
                        <div>
                            <Label>Note</Label>
                            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-6">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                                <span>Select Pieces</span>
                                <form onSubmit={handleScan} className="flex flex-wrap sm:flex-nowrap gap-2 w-full sm:w-64">
                                    <div className="relative flex-1">
                                        <QrCode className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Scan Barcode"
                                            className="pl-8 h-9"
                                            value={barcodeScan}
                                            onChange={e => setBarcodeScan(e.target.value)}
                                            disabled={scanLoading}
                                        />
                                    </div>
                                    <Button size="sm" type="submit" disabled={scanLoading}>Add</Button>
                                    <Button
                                        size="sm"
                                        type="button"
                                        className="md:hidden"
                                        disabled={scanLoading}
                                        onClick={() => setScanDialogOpen(true)}
                                    >
                                        Scan
                                    </Button>
                                </form>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {scanFeedback && (
                            <div className="mb-2 text-xs text-green-600">{scanFeedback}</div>
                            )}
                            <div className="flex justify-between items-center mb-2">
                                <div className="text-xs text-muted-foreground">
                                    {selectedLines.length} selected / {availablePieces.length} available • {formatKg(selectedWeightTotal)} issue weight
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setSelectedLines(availablePieces.map((piece) => ({ pieceId: piece.id, issuedWeight: to3(piece.issueableWeight) })))}
                                    >
                                        All
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setSelectedLines([])}>None</Button>
                                </div>
                            </div>
                            <div className="max-h-[400px] overflow-auto border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[40px]"></TableHead>
                                            <TableHead>ID</TableHead>
                                            <TableHead className="text-right">Available (kg)</TableHead>
                                            <TableHead className="text-right">Issue Wt (kg)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {availablePieces.length === 0 ? (
                                            <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No pieces available in this lot.</TableCell></TableRow>
                                        ) : availablePieces.map(p => (
                                            <TableRow key={p.id} onClick={() => toggle(p.id)} className="cursor-pointer hover:bg-muted/50">
                                                <TableCell>
                                                    <input type="checkbox" checked={selectedLineByPieceId.has(p.id)} onChange={() => toggle(p.id)} className="rounded border-gray-300 text-primary focus:ring-primary" />
                                                </TableCell>
                                                <TableCell className="font-mono">{p.id}</TableCell>
                                                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(p.issueableWeight)}</TableCell>
                                                <TableCell className="w-[150px]">
                                                    {selectedLineByPieceId.has(p.id) ? (
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            max={p.issueableWeight}
                                                            step="0.001"
                                                            value={selectedLineByPieceId.get(p.id)?.issuedWeight ?? ''}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => updateLineWeight(p.id, e.target.value)}
                                                            className="h-8"
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            {piecesHaveMore && (
                                <div className="mt-3 flex justify-center">
                                    <Button type="button" variant="outline" size="sm" onClick={loadMorePieces} disabled={candidateLoading}>
                                        {candidateLoading ? 'Loading…' : 'Load more pieces'}
                                    </Button>
                                </div>
                            )}
                            <div className="mt-4 flex justify-end">
                                <Button onClick={handleIssue} disabled={issuing || selectedLines.length === 0 || refreshing || hasInvalidSelectedWeights}>
                                    {issuing ? 'Issuing...' : `Issue ${selectedLines.length} Pieces`}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="w-full md:w-1/3">
                    <Card>
                        <CardHeader><CardTitle className="text-base">Last Issue</CardTitle></CardHeader>
                        <CardContent>
                            {lastIssueForLot ? (
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between border-b pb-2">
                                        <span className="text-muted-foreground">Date</span>
                                        <span>{formatDateDDMMYYYY(lastIssueForLot.date)}</span>
                                    </div>
                                    <div className="flex justify-between border-b pb-2">
                                        <span className="text-muted-foreground">Pieces</span>
                                        <span>{lastIssueForLot.count}</span>
                                    </div>
                                    <div className="flex justify-between border-b pb-2">
                                        <span className="text-muted-foreground">Total Weight</span>
                                        <span>{formatKg(lastIssueForLot.totalWeight)}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block mb-1">Piece IDs</span>
                                        <div className="flex flex-wrap gap-1">
                                            {(lastIssueForLot.pieceIds || []).slice(0, 10).map(id => (
                                                <Badge key={id} variant="outline" className="font-mono text-[10px]">{id}</Badge>
                                            ))}
                                            {(lastIssueForLot.pieceIds?.length || 0) > 10 && (
                                                <span className="text-xs text-muted-foreground">+{lastIssueForLot.pieceIds.length - 10} more</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground text-center py-4">
                                    No previous issues for this lot.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            <BarcodeScanDialog
                open={scanDialogOpen}
                onOpenChange={setScanDialogOpen}
                onScanned={async (code) => {
                    setScanDialogOpen(false);
                    setBarcodeScan(code);
                    await addBarcode(code);
                }}
            />
        </div>
    );
}
