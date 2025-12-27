import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu } from '../ui';
import { ArrowRight } from 'lucide-react';

/**
 * OnMachineTable - Displays work-in-progress entries (issued but not fully received)
 * 
 * Logic: An entry is "on machine" if:
 *   pendingWeight = issuedWeight - (receivedNetWeight + wastageNetWeight) > 0
 */
export function OnMachineTable({ db, process }) {
    const navigate = useNavigate();

    // Build lookup maps
    const itemNameById = useMemo(() => {
        const map = new Map();
        (db.items || []).forEach(i => map.set(i.id, i.name || '—'));
        return map;
    }, [db.items]);

    const machineNameById = useMemo(() => {
        const map = new Map();
        (db.machines || []).forEach(m => map.set(m.id, m.name || '—'));
        return map;
    }, [db.machines]);

    const operatorNameById = useMemo(() => {
        const map = new Map();
        (db.operators || []).forEach(o => map.set(o.id, o.name || '—'));
        return map;
    }, [db.operators]);

    // Build piece totals lookup maps for each process
    const cutterPieceTotals = useMemo(() => {
        const map = new Map();
        (db.receive_from_cutter_machine_piece_totals || []).forEach(pt => {
            map.set(pt.pieceId, {
                totalNetWeight: pt.totalNetWeight || 0,
                wastageNetWeight: pt.wastageNetWeight || 0,
            });
        });
        return map;
    }, [db.receive_from_cutter_machine_piece_totals]);

    const holoPieceTotals = useMemo(() => {
        const map = new Map();
        (db.receive_from_holo_machine_piece_totals || []).forEach(pt => {
            map.set(pt.pieceId, {
                totalNetWeight: pt.totalNetWeight || 0,
                wastageNetWeight: pt.wastageNetWeight || 0,
            });
        });
        return map;
    }, [db.receive_from_holo_machine_piece_totals]);

    const coningPieceTotals = useMemo(() => {
        const map = new Map();
        (db.receive_from_coning_machine_piece_totals || []).forEach(pt => {
            map.set(pt.pieceId, {
                totalNetWeight: pt.totalNetWeight || 0,
                wastageNetWeight: pt.wastageNetWeight || 0,
            });
        });
        return map;
    }, [db.receive_from_coning_machine_piece_totals]);

    // Compute on-machine entries based on process
    const onMachineEntries = useMemo(() => {
        let entries = [];

        if (process === 'cutter') {
            const issues = db.issue_to_cutter_machine || [];
            entries = issues.map(issue => {
                // For cutter: pieceIds can be a comma-separated string or an array
                let pieceIds = [];
                if (Array.isArray(issue.pieceIds)) {
                    pieceIds = issue.pieceIds;
                } else if (typeof issue.pieceIds === 'string') {
                    pieceIds = issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean);
                }

                // Sum up received + wastage for all pieces in this issue
                let totalReceived = 0;
                let totalWastage = 0;
                pieceIds.forEach(pieceId => {
                    const totals = cutterPieceTotals.get(pieceId);
                    if (totals) {
                        totalReceived += totals.totalNetWeight;
                        totalWastage += totals.wastageNetWeight;
                    }
                });

                const issuedWeight = issue.totalWeight || 0;
                const accountedWeight = totalReceived + totalWastage;
                const pendingWeight = issuedWeight - accountedWeight;

                return {
                    ...issue,
                    issuedWeight,
                    receivedWeight: totalReceived,
                    wastageWeight: totalWastage,
                    pendingWeight: Math.max(0, pendingWeight),
                    pieceIdsList: pieceIds,
                };
            }).filter(e => e.pendingWeight > 0.001); // Filter entries with pending weight > 0 (with small tolerance)

        } else if (process === 'holo') {
            const issues = db.issue_to_holo_machine || [];
            entries = issues.map(issue => {
                // For holo: use issue.id as the pieceId key for totals
                const totals = holoPieceTotals.get(issue.id);
                const totalReceived = totals?.totalNetWeight || 0;
                const totalWastage = totals?.wastageNetWeight || 0;

                const issuedWeight = issue.metallicBobbinsWeight || 0;
                const accountedWeight = totalReceived + totalWastage;
                const pendingWeight = issuedWeight - accountedWeight;

                return {
                    ...issue,
                    issuedWeight,
                    receivedWeight: totalReceived,
                    wastageWeight: totalWastage,
                    pendingWeight: Math.max(0, pendingWeight),
                };
            }).filter(e => e.pendingWeight > 0.001);

        } else if (process === 'coning') {
            const issues = db.issue_to_coning_machine || [];
            entries = issues.map(issue => {
                // For coning: use issue.id as the pieceId key for totals
                const totals = coningPieceTotals.get(issue.id);
                const totalReceived = totals?.totalNetWeight || 0;
                const totalWastage = totals?.wastageNetWeight || 0;

                // Calculate issued weight from receivedRowRefs
                let issuedWeight = 0;
                try {
                    const refs = typeof issue.receivedRowRefs === 'string'
                        ? JSON.parse(issue.receivedRowRefs)
                        : issue.receivedRowRefs;
                    if (Array.isArray(refs)) {
                        refs.forEach(ref => {
                            issuedWeight += Number(ref.issueWeight || 0);
                        });
                    }
                } catch (e) {
                    // If parsing fails, use rollsIssued as fallback (less accurate)
                    issuedWeight = 0;
                }

                const accountedWeight = totalReceived + totalWastage;
                const pendingWeight = issuedWeight - accountedWeight;

                return {
                    ...issue,
                    issuedWeight,
                    receivedWeight: totalReceived,
                    wastageWeight: totalWastage,
                    pendingWeight: Math.max(0, pendingWeight),
                };
            }).filter(e => e.pendingWeight > 0.001);
        }

        // Sort by date descending (most recent first)
        return entries.sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));
    }, [db, process, cutterPieceTotals, holoPieceTotals, coningPieceTotals]);

    const handleGoToReceive = (entry) => {
        // Navigate to receive page with barcode param for auto-scan
        navigate(`/app/receive?barcode=${encodeURIComponent(entry.barcode)}`);
    };

    const getActions = (entry) => [
        {
            label: 'Go to Receive',
            icon: <ArrowRight className="w-4 h-4" />,
            onClick: () => handleGoToReceive(entry),
        },
    ];

    // Calculate progress percentage - cap at 99% if there's still pending weight
    const getProgressPercent = (entry) => {
        if (entry.issuedWeight <= 0) return 0;
        const accounted = entry.receivedWeight + entry.wastageWeight;
        const percent = Math.round((accounted / entry.issuedWeight) * 100);
        // If there's still pending weight, cap at 99% to avoid confusion
        if (entry.pendingWeight > 0.001 && percent >= 100) {
            return 99;
        }
        return Math.min(100, percent);
    };

    return (
        <div className="space-y-4">
            <div className="rounded-md border max-h-[600px] overflow-y-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {process === 'cutter' && (
                                <>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Lot</TableHead>
                                    <TableHead>Machine</TableHead>
                                    <TableHead>Operator</TableHead>
                                    <TableHead>Issued (kg)</TableHead>
                                    <TableHead>Received (kg)</TableHead>
                                    <TableHead>Pending (kg)</TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>Barcode</TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                            {process === 'holo' && (
                                <>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Lot</TableHead>
                                    <TableHead>Machine</TableHead>
                                    <TableHead>Operator</TableHead>
                                    <TableHead>Issued (kg)</TableHead>
                                    <TableHead>Received (kg)</TableHead>
                                    <TableHead>Pending (kg)</TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>Barcode</TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                            {process === 'coning' && (
                                <>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Lot</TableHead>
                                    <TableHead>Machine</TableHead>
                                    <TableHead>Operator</TableHead>
                                    <TableHead>Issued (kg)</TableHead>
                                    <TableHead>Received (kg)</TableHead>
                                    <TableHead>Pending (kg)</TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>Barcode</TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {onMachineEntries.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                                    No pending entries on machine for {process}.
                                </TableCell>
                            </TableRow>
                        ) : (
                            onMachineEntries.map((entry) => {
                                const progressPercent = getProgressPercent(entry);
                                return (
                                    <TableRow key={entry.id}>
                                        <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(entry.date)}</TableCell>
                                        <TableCell>{itemNameById.get(entry.itemId)}</TableCell>
                                        <TableCell>{entry.lotNo}</TableCell>
                                        <TableCell>{machineNameById.get(entry.machineId)}</TableCell>
                                        <TableCell>{operatorNameById.get(entry.operatorId)}</TableCell>
                                        <TableCell>{formatKg(entry.issuedWeight)}</TableCell>
                                        <TableCell className="text-green-600">{formatKg(entry.receivedWeight)}</TableCell>
                                        <TableCell className="font-medium text-blue-600">{formatKg(entry.pendingWeight)}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary rounded-full transition-all"
                                                        style={{ width: `${progressPercent}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-muted-foreground">{progressPercent}%</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{entry.barcode || entry.id.substring(0, 8)}</TableCell>
                                        <TableCell>
                                            <ActionMenu actions={getActions(entry)} />
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
