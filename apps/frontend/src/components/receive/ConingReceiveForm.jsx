import React, { useState, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { InfoPopover } from '../common/InfoPopover';
import { CatchWeightButton } from '../common/CatchWeightButton';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui';
import { formatDateDDMMYYYY, formatKg, todayISO, uid } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';

export function ConingReceiveForm() {
    const { db, refreshDb } = useInventory();

    const [scanInput, setScanInput] = useState('');
    const [issue, setIssue] = useState(null);
    const [cart, setCart] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [receiveDate, setReceiveDate] = useState(todayISO());

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

    const totalIssuedWeight = useMemo(() => {
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

    // --- Handlers ---
    async function handleScan() {
        if (!scanInput.trim()) return;
        try {
            // Expecting Issue Barcode (CN-...)
            // Note: The original logic might have scanned receive crates first, but usually we load the Issue context first.
            // Assuming we scan the Issue Barcode to start.

            // Since the API might not have a direct lookup for coning issue by barcode in the client sdk explicitly named,
            // we can try finding it in the loaded DB issues if available, or assume `getIssueByBarcode` works.
            // In the original code, `lookupIssue` filtered `db.issue_to_coning_machine`.

            const found = db.issue_to_coning_machine.find(i => (i.barcode || '').toUpperCase() === scanInput.trim().toUpperCase());

            if (found) {
                setIssue(found);
                setCart([]);
            } else {
                alert('Issue not found');
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

    const totalReceivedWeight = Number(coningPieceTotals?.totalNetWeight || 0) + cartTotals.totalNetWeight;
    const totalReceivedCones = Number(coningPieceTotals?.totalCones || 0) + cartTotals.totalCones;
    const receivedPerConeWeightG = totalReceivedCones > 0 ? (totalReceivedWeight * 1000) / totalReceivedCones : 0;
    const isReceivedOverIssued = totalIssuedWeight > 0 && totalReceivedWeight > totalIssuedWeight + 0.001;

    const receiveRowsForIssue = useMemo(() => {
        if (!issue?.id) return [];
        return (db.receive_from_coning_machine_rows || []).filter((row) => row.issueId === issue.id);
    }, [db.receive_from_coning_machine_rows, issue?.id]);

    async function handleSubmit() {
        if (!issue || cart.length === 0) return;
        setSubmitting(true);
        try {
            const template = await loadTemplate(LABEL_STAGE_KEYS.CONING_RECEIVE);
            const confirmPrint = template ? window.confirm('Print stickers for these receives?') : false;
            const existingRows = (db.receive_from_coning_machine_rows || []).filter((r) => r.issueId === issue.id);
            const baseCount = existingRows.length;
            const baseCode = issue.barcode || issue.lotNo || issue.id;
            for (const row of cart) {
                await api.manualReceiveFromConingMachine({
                    issueId: issue.id,
                    pieceId: issue.id, // Coning treats the issue as the unit usually
                    coneCount: Number(row.coneCount),
                    boxId: row.boxId,
                    grossWeight: Number(row.grossWeight),
                    date: receiveDate,
                    operatorId: row.operatorId,
                    notes: row.notes
                });
                if (confirmPrint) {
                    const index = cart.indexOf(row);
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

                    let rollCount = 0;

                    try {
                        const refs = typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue.receivedRowRefs;
                        if (Array.isArray(refs) && refs.length > 0) {
                            const firstRef = refs[0];
                            // Cone/Wrapper from issue definition (stored in refs as per creation logic)
                            if (firstRef.coneTypeId) coneType = db.cone_types.find(c => c.id === firstRef.coneTypeId)?.name || '';
                            if (firstRef.wrapperId) wrapperName = db.wrappers.find(w => w.id === firstRef.wrapperId)?.name || '';

                            // Calculate total issued rolls from all refs
                            refs.forEach(ref => {
                                if (ref.issueRolls) rollCount += Number(ref.issueRolls) || 0;
                                else {
                                    // Fallback to row lookup if issueRolls not stamped
                                    const r = db.receive_from_holo_machine_rows?.find(row => row.id === ref.rowId);
                                    if (r) rollCount += (r.rollCount || 0);
                                }
                            });

                            // Trace back for Cut/Yarn/RollType
                            // The ref points to a ReceiveFromHoloMachineRow (usually)
                            const rid = firstRef.rowId;
                            if (rid) {
                                const holoRow = db.receive_from_holo_machine_rows?.find(r => r.id === rid);
                                if (holoRow) {
                                    if (holoRow.rollTypeId) rollType = db.rollTypes.find(rt => rt.id === holoRow.rollTypeId)?.name || '';
                                    const holoIssue = db.issue_to_holo_machine?.find(i => i.id === holoRow.issueId);
                                    if (holoIssue) {
                                        if (holoIssue.yarnId) yarnName = db.yarns.find(y => y.id === holoIssue.yarnId)?.name || '';
                                        // Trace cut
                                        const hRefs = typeof holoIssue.receivedRowRefs === 'string' ? JSON.parse(holoIssue.receivedRowRefs) : holoIssue.receivedRowRefs;
                                        if (Array.isArray(hRefs) && hRefs.length > 0) {
                                            const cutterRow = db.receive_from_cutter_machine_rows?.find(r => r.id === hRefs[0].rowId);
                                            if (cutterRow) {
                                                cutName = cutterRow.cut?.name || cutterRow.cutMaster?.name || db.cuts?.find(c => c.id === cutterRow.cutId)?.name || '';
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) { console.error('Error resolving details', e); }

                    await printStageTemplate(
                        LABEL_STAGE_KEYS.CONING_RECEIVE,
                        {
                            lotNo: issue.lotNo,
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
                            rollType,
                            coneType,
                            wrapperName,
                            shift: issue.shift || '',
                            date: receiveDate,
                        },
                        { template },
                    );
                }
            }
            await refreshDb();
            setCart([]);
            alert('Received successfully');
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
                    <CardTitle>Scan Coning Issue</CardTitle>
                    <div className="flex gap-2">
                        <Input
                            placeholder="Scan Issue (CN-...)"
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
                        <div className="p-4 bg-muted rounded-md text-sm space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div><strong>Lot:</strong> {issue.lotNo}</div>
                                <div><strong>Total Issued Wt:</strong> {formatKg(totalIssuedWeight)}</div>
                                <div><strong>Expected:</strong> {totalExpected} cones</div>
                                <div><strong>Target:</strong> {perConeWeight} g/cone</div>
                            </div>
                            <div className="border-t border-border/60" />
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
                                <div className="hidden md:block" />
                                <div className="flex items-center gap-2">
                                    <div>
                                        <strong>Total Received Wt:</strong>{' '}
                                        <span className={isReceivedOverIssued ? "text-destructive font-semibold" : ""}>
                                            {formatKg(totalReceivedWeight)}
                                        </span>
                                    </div>
                                    <InfoPopover
                                        title={`Coning Receives (${issue.lotNo})`}
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
                                <div><strong>Per Cone Wt:</strong> {totalReceivedCones > 0 ? `${receivedPerConeWeightG.toFixed(1)} g/cone` : '—'}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div><Label>Date</Label><Input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} /></div>
                            <div className="flex items-end">
                                <Button onClick={addCartRow}>Add Crate</Button>
                            </div>
                        </div>

                        <div className="border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Box</TableHead>
                                        <TableHead>Cones</TableHead>
                                        <TableHead>Gross</TableHead>
                                        <TableHead>Net (Calc)</TableHead>
                                        <TableHead>Operator</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {cart.map(row => (
                                        <TableRow key={row.id}>
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
                                                    />
                                                </div>
                                            </TableCell>
                                            <TableCell className="">
                                                {formatKg(calcRowNet(row))}
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
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex justify-between items-center pt-4 border-t">
                            <div className="text-sm">
                                {cart.length > 0 && (
                                    <>
                                        Tare: {formatKg(cart.reduce((sum, row) => sum + (Number(row.grossWeight || 0) - calcRowNet(row)), 0))} | {' '}
                                        <span className="font-bold">Net: {formatKg(cartTotals.totalNetWeight)}</span>
                                    </>
                                )}
                            </div>
                            <Button onClick={handleSubmit} disabled={submitting || cart.length === 0}>Save Receive</Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
