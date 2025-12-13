import React, { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Button, Card, CardHeader, CardTitle, CardContent, Badge } from '../ui';
import { Trash2 } from 'lucide-react';
import * as api from '../../api';

export function ReceiveHistoryTable() {
    const { db, process, refreshDb } = useInventory();
    const [deletingId, setDeletingId] = useState(null);

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
                                        return (
                                            <TableRow key={r.id}>
                                                <TableCell className="font-mono text-xs">{r.pieceId}</TableCell>
                                                <TableCell>{r.cutMaster?.name || r.cut || '—'}</TableCell>
                                                <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                                                <TableCell>{r.machineNo || '—'}</TableCell>
                                                <TableCell>{r.operator?.name || r.employee || '—'}</TableCell>
                                                <TableCell className="text-right font-medium">{formatKg(r.netWt)}</TableCell>
                                                <TableCell className="text-right">{r.bobbinQuantity}</TableCell>
                                                <TableCell>{r.bobbin?.name || r.pcsTypeName || '—'}</TableCell>
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
