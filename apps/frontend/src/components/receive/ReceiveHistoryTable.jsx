import React, { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Card, CardHeader, CardTitle, CardContent, ActionMenu } from '../ui';
import { Printer } from 'lucide-react';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { InfoPopover } from '../common/InfoPopover';

export function ReceiveHistoryTable() {
    const { db, process, refreshDb } = useInventory();

    // Determine which collection to use based on process
    const history = useMemo(() => {
        let rows = [];
        if (process === 'holo') {
            rows = db.receive_from_holo_machine_rows || [];
        } else if (process === 'coning') {
            rows = db.receive_from_coning_machine_rows || [];
        } else {
            rows = db.receive_from_cutter_machine_rows || [];
        }
        // Sort by created date descending
        return rows.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }, [db, process]);

    // Helper for Coning Machine Lookup
    const getConingMachineName = (row) => {
        if (row.machineNo) return row.machineNo;
        // Fallback to looking up the issue's machine
        if (row.issueId) {
            const issue = db.issue_to_coning_machine?.find(i => i.id === row.issueId);
            if (issue && issue.machineId) {
                const machine = db.machines?.find(m => m.id === issue.machineId);
                return machine ? machine.name : '—';
            }
        }
        return '—';
    };

    // Helper for Cutter Receive Info Popover
    const getCutterReceiveInfo = (row) => {
        const piece = db.inbound_items?.find(p => p.id === row.pieceId);
        const item = db.items?.find(i => i.id === piece?.itemId);
        const lot = db.lots?.find(l => l.lotNo === piece?.lotNo);
        const box = db.boxes?.find(b => b.id === row.boxId);
        const helper = db.workers?.find(w => w.id === row.helperId) || db.operators?.find(o => o.id === row.helperId);

        return [
            { label: 'Date', value: formatDateDDMMYYYY(row.date || row.createdAt) || '—' },
            { label: 'Lot', value: piece?.lotNo || '—' },
            { label: 'Item', value: item?.name || '—' },
            { label: 'Gross Wt', value: `${formatKg(row.grossWt)} kg` },
            { label: 'Tare Wt', value: `${formatKg(row.tareWt)} kg` },
            { label: 'Net Wt', value: `${formatKg(row.netWt)} kg` },
            { label: 'Box', value: box?.name || row.pktTypeName || '—' },
            { label: 'Helper', value: helper?.name || row.helperName || '—' },
            { label: 'Shift', value: row.shift || '—' },
        ];
    };

    const handleReprint = async (row) => {
        try {
            let stageKey, data;

            if (process === 'cutter') {
                stageKey = LABEL_STAGE_KEYS.CUTTER_RECEIVE;

                // Get item from inbound piece
                const piece = db.inbound_items?.find(p => p.id === row.pieceId);
                const item = db.items?.find(i => i.id === piece?.itemId || row.itemId);
                const bobbin = db.bobbins?.find(b => b.id === row.bobbinId);
                const box = db.boxes?.find(b => b.id === row.boxId);
                const cut = db.cuts?.find(c => c.id === row.cutId)?.name || row.cutMaster?.name || row.cut || '';
                const operator = db.operators?.find(o => o.id === row.operatorId);
                const helper = db.workers?.find(w => w.id === row.helperId);

                // Get machine from issue record
                const issue = (db.issue_to_cutter_machine || []).find(i =>
                    i.pieceIds && (Array.isArray(i.pieceIds) ? i.pieceIds.includes(row.pieceId) : i.pieceIds.includes(row.pieceId))
                );
                const machine = db.machines?.find(m => m.id === issue?.machineId);

                data = {
                    lotNo: row.lotNo || piece?.lotNo || '',
                    itemName: item?.name || '',
                    pieceId: row.pieceId,
                    netWeight: row.netWt,
                    grossWeight: row.grossWt,
                    tareWeight: row.tareWt,
                    bobbinQty: row.bobbinQuantity,
                    bobbinName: bobbin?.name || row.bobbin?.name || '',
                    boxName: box?.name || row.box?.name || '',
                    cut: cut,
                    cutName: cut,
                    machineName: machine?.name || row.machineNo || '',
                    operatorName: operator?.name || row.operator?.name || '',
                    helperName: helper?.name || row.helper?.name || '',
                    date: row.date || row.createdAt,
                    barcode: row.barcode,
                };
            } else if (process === 'holo') {
                stageKey = LABEL_STAGE_KEYS.HOLO_RECEIVE;
                const issue = db.issue_to_holo_machine?.find(i => i.id === row.issueId);
                const item = db.items?.find(i => i.id === issue?.itemId);
                const rollType = db.rollTypes?.find(rt => rt.id === row.rollTypeId);
                const box = db.boxes?.find(b => b.id === row.boxId);
                const yarnName = db.yarns?.find(y => y.id === issue?.yarnId)?.name || '';

                // Trace back to get cut from cutter receive row
                let cut = '';
                try {
                    const refs = typeof issue?.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue?.receivedRowRefs;
                    if (Array.isArray(refs) && refs.length > 0) {
                        const cutterRow = db.receive_from_cutter_machine_rows?.find(r => r.id === refs[0].rowId);
                        if (cutterRow) {
                            cut = cutterRow.cutMaster?.name || cutterRow.cut || db.cuts?.find(c => c.id === cutterRow.cutId)?.name || '';
                        }
                    }
                } catch (e) { console.error('Error parsing receivedRowRefs', e); }

                // Calculate tare weight
                const boxWeight = box?.weight || 0;
                const rollTypeWeight = rollType?.weight || 0;
                const tareWeight = boxWeight + rollTypeWeight;

                data = {
                    lotNo: issue?.lotNo || row.issue?.lotNo || '',
                    itemName: item?.name || '',
                    rollCount: row.rollCount || 1,
                    rollType: rollType?.name || '',
                    netWeight: row.rollWeight ?? row.netWeight ?? row.grossWeight,
                    grossWeight: row.grossWeight,
                    tareWeight: tareWeight,
                    boxName: box?.name || row.box?.name || '',
                    cut: cut,
                    yarnName: yarnName,
                    machineName: row.machineNo || row.machine?.name || '',
                    operatorName: row.operator?.name || '',
                    date: row.date || row.createdAt,
                    barcode: row.barcode,
                };
            } else if (process === 'coning') {
                stageKey = LABEL_STAGE_KEYS.CONING_RECEIVE;
                const issue = db.issue_to_coning_machine?.find(i => i.id === row.issueId);
                const box = db.boxes?.find(b => b.id === row.boxId);
                const operator = db.operators?.find(o => o.id === row.operatorId);
                const item = db.items?.find(i => i.id === issue?.itemId);

                // Get coneType, wrapperName from issue's receivedRowRefs
                let coneType = '';
                let wrapperName = '';
                let cut = '';
                let yarnName = '';
                let rollType = '';

                try {
                    const refs = typeof issue?.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue?.receivedRowRefs;
                    if (Array.isArray(refs) && refs.length > 0) {
                        const firstRef = refs[0];

                        // Get cone type and wrapper
                        if (firstRef.coneTypeId) coneType = db.cone_types?.find(c => c.id === firstRef.coneTypeId)?.name || '';
                        if (firstRef.wrapperId) wrapperName = db.wrappers?.find(w => w.id === firstRef.wrapperId)?.name || '';

                        // Trace back through holo receive -> holo issue -> cutter receive
                        const holoRow = db.receive_from_holo_machine_rows?.find(r => r.id === firstRef.rowId);
                        if (holoRow) {
                            rollType = db.rollTypes?.find(rt => rt.id === holoRow.rollTypeId)?.name || '';

                            const holoIssue = db.issue_to_holo_machine?.find(i => i.id === holoRow.issueId);
                            if (holoIssue) {
                                yarnName = db.yarns?.find(y => y.id === holoIssue.yarnId)?.name || '';

                                // Get cut from cutter receive
                                const holoRefs = typeof holoIssue.receivedRowRefs === 'string' ? JSON.parse(holoIssue.receivedRowRefs) : holoIssue.receivedRowRefs;
                                if (Array.isArray(holoRefs) && holoRefs.length > 0) {
                                    const cutterRow = db.receive_from_cutter_machine_rows?.find(r => r.id === holoRefs[0].rowId);
                                    if (cutterRow) {
                                        cut = cutterRow.cutMaster?.name || cutterRow.cut || db.cuts?.find(c => c.id === cutterRow.cutId)?.name || '';
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { console.error('Error parsing receivedRowRefs', e); }

                data = {
                    lotNo: issue?.lotNo || row.issue?.lotNo || '',
                    itemName: item?.name || '',
                    coneCount: row.coneCount,
                    grossWeight: row.grossWeight,
                    tareWeight: row.tareWeight || 0,
                    netWeight: row.netWeight ?? row.grossWeight,
                    boxName: box?.name || row.box?.name || '',
                    cut: cut,
                    yarnName: yarnName,
                    rollType: rollType,
                    coneType: coneType,
                    wrapperName: wrapperName,
                    operatorName: operator?.name || row.operator?.name || '',
                    machineName: getConingMachineName(row),
                    date: row.date || row.createdAt,
                    barcode: row.barcode,
                };
            }


            if (!stageKey) {
                alert('Unknown process type');
                return;
            }

            const template = await loadTemplate(stageKey);
            if (!template) {
                alert('No sticker template found for this stage. Please configure it in Label Designer.');
                return;
            }

            await printStageTemplate(stageKey, data, { template });
            // Silent success
        } catch (err) {
            alert(err.message || 'Failed to reprint sticker');
        }
    };

    const getActions = (row) => [
        {
            label: 'Reprint',
            icon: <Printer className="w-4 h-4" />,
            onClick: () => handleReprint(row),
        },
    ];

    return (
        <Card>
            <CardHeader><CardTitle>Receive History ({process === 'cutter' ? 'Cutter' : process === 'holo' ? 'Holography' : 'Coning'})</CardTitle></CardHeader>
            <CardContent>
                <div className="rounded-md border max-h-[600px] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {process === 'cutter' && (
                                    <>
                                        <TableHead>Piece</TableHead>
                                        <TableHead>Cut</TableHead>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead>Machine</TableHead>
                                        <TableHead>Employee</TableHead>
                                        <TableHead className="text-right">Net Wt (kg)</TableHead>
                                        <TableHead className="text-right">Bobbin Qty</TableHead>
                                        <TableHead>Bobbin</TableHead>
                                        <TableHead className="w-[50px]">Actions</TableHead>
                                    </>
                                )}
                                {process === 'holo' && (
                                    <>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Lot</TableHead>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead className="text-right">Rolls</TableHead>
                                        <TableHead className="text-right">Weight (kg)</TableHead>
                                        <TableHead>Machine</TableHead>
                                        <TableHead>Operator</TableHead>
                                        <TableHead>Helper</TableHead>
                                        <TableHead>Notes</TableHead>
                                        <TableHead className="w-[50px]">Actions</TableHead>
                                    </>
                                )}
                                {process === 'coning' && (
                                    <>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Lot</TableHead>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead>Box</TableHead>
                                        <TableHead className="text-right">Cones</TableHead>
                                        <TableHead className="text-right">Weight (kg)</TableHead>
                                        <TableHead>Machine</TableHead>
                                        <TableHead>Operator</TableHead>
                                        <TableHead>Notes</TableHead>
                                        <TableHead className="w-[50px]">Actions</TableHead>
                                    </>
                                )}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {history.length === 0 ? (
                                <TableRow><TableCell colSpan={10} className="text-center py-4 text-muted-foreground">No records found.</TableCell></TableRow>
                            ) : (
                                history.map(r => {
                                    if (process === 'cutter') {
                                        const infoItems = getCutterReceiveInfo(r);
                                        return (
                                            <TableRow key={r.id}>
                                                <TableCell className="font-mono text-xs">{r.pieceId}</TableCell>
                                                <TableCell>{r.cutMaster?.name || r.cut || '—'}</TableCell>
                                                <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                                                <TableCell>{r.machineNo || '—'}</TableCell>
                                                <TableCell>{r.operator?.name || r.employee || '—'}</TableCell>
                                                <TableCell className="text-right font-medium">
                                                    <div className="flex items-center justify-end gap-1">
                                                        {formatKg(r.netWt)}
                                                        <InfoPopover
                                                            title="Receive Details"
                                                            items={infoItems}
                                                            renderItem={(item) => (
                                                                <div className="flex justify-between text-xs">
                                                                    <span className="text-muted-foreground">{item.label}:</span>
                                                                    <span className="font-medium">{item.value}</span>
                                                                </div>
                                                            )}
                                                            widthClassName="w-56"
                                                            buttonClassName="h-5 w-5 rounded-full hover:bg-muted"
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">{r.bobbinQuantity}</TableCell>
                                                <TableCell>{r.bobbin?.name || r.pcsTypeName || '—'}</TableCell>
                                                <TableCell><ActionMenu actions={getActions(r)} /></TableCell>
                                            </TableRow>
                                        );
                                    } else if (process === 'holo') {
                                        const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';
                                        return (
                                            <TableRow key={r.id}>
                                                <TableCell>{dateDisplay}</TableCell>
                                                <TableCell>{r.issue?.lotNo || '—'}</TableCell>
                                                <TableCell className="font-mono text-xs">{r.barcode || '—'}</TableCell>
                                                <TableCell className="text-right">1</TableCell>
                                                <TableCell className="text-right font-medium">{formatKg(r.rollWeight ?? r.grossWeight)}</TableCell>
                                                <TableCell>{r.machineNo || r.machine?.name || '—'}</TableCell>
                                                <TableCell>{r.operator?.name || '—'}</TableCell>
                                                <TableCell>{r.helper?.name || '—'}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]" title={r.note || r.notes}>{r.note || r.notes || '—'}</TableCell>
                                                <TableCell><ActionMenu actions={getActions(r)} /></TableCell>
                                            </TableRow>
                                        );
                                    } else if (process === 'coning') {
                                        const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';
                                        return (
                                            <TableRow key={r.id}>
                                                <TableCell>{dateDisplay}</TableCell>
                                                <TableCell>{r.issue?.lotNo || '—'}</TableCell>
                                                <TableCell className="font-mono text-xs">{r.barcode || '—'}</TableCell>
                                                <TableCell>{r.box?.name || '—'}</TableCell>
                                                <TableCell className="text-right">{r.coneCount}</TableCell>
                                                <TableCell className="text-right font-medium">{formatKg(r.netWeight ?? r.grossWeight)}</TableCell>
                                                <TableCell>{getConingMachineName(r)}</TableCell>
                                                <TableCell>{r.operator?.name || '—'}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]" title={r.notes}>{r.notes || '—'}</TableCell>
                                                <TableCell><ActionMenu actions={getActions(r)} /></TableCell>
                                            </TableRow>
                                        );
                                    }
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

