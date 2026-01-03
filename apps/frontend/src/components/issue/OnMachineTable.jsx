import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu } from '../ui';
import { ArrowRight, Download } from 'lucide-react';
import { exportHistoryToExcel } from '../../services';

/**
 * OnMachineTable - Displays work-in-progress entries (issued but not fully received)
 * 
 * Logic: An entry is "on machine" if:
 *   pendingWeight = issuedWeight - (receivedNetWeight + wastageNetWeight) > 0
 */
export function OnMachineTable({ db, process }) {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

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

    const cutNameById = useMemo(() => {
        const map = new Map();
        (db.cuts || []).forEach(c => map.set(c.id, c.name || '—'));
        return map;
    }, [db.cuts]);

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
        let sorted = entries.sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));

        // Filter based on search and date
        return sorted.filter(e => {
            // Date filter - string comparison
            if (startDate || endDate) {
                const itemDateStr = (e.date || e.createdAt || '').substring(0, 10);
                if (startDate && itemDateStr < startDate) return false;
                if (endDate && itemDateStr > endDate) return false;
            }

            // Search filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const lot = (e.lotNo || '').toLowerCase();
                const barcode = (e.barcode || '').toLowerCase();
                const itemName = itemNameById.get(e.itemId)?.toLowerCase() || '';
                const operatorName = operatorNameById.get(e.operatorId)?.toLowerCase() || '';
                const machineName = machineNameById.get(e.machineId)?.toLowerCase() || '';

                // Handle pieceIds which could be array or string
                let pieceIdsStr = '';
                if (Array.isArray(e.pieceIds)) {
                    pieceIdsStr = e.pieceIds.join(' ');
                } else {
                    pieceIdsStr = e.pieceIds || '';
                }
                pieceIdsStr = pieceIdsStr.toLowerCase();

                return lot.includes(term) ||
                    barcode.includes(term) ||
                    pieceIdsStr.includes(term) ||
                    itemName.includes(term) ||
                    operatorName.includes(term) ||
                    machineName.includes(term);
            }

            return true;
        });
    }, [db, process, cutterPieceTotals, holoPieceTotals, coningPieceTotals, searchTerm, startDate, endDate, itemNameById, operatorNameById, machineNameById]);

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

    const handleExport = () => {
        const exportData = onMachineEntries.map(entry => {
            const progressPercent = getProgressPercent(entry);
            const baseData = {
                date: formatDateDDMMYYYY(entry.date),
                lotOrPiece: process === 'cutter'
                    ? (Array.isArray(entry.pieceIds) ? entry.pieceIds.join(', ') : (entry.pieceIds || ''))
                    : (entry.lotNo || ''),
                itemName: itemNameById.get(entry.itemId) || '—',
                machineName: machineNameById.get(entry.machineId) || '—',
                operatorName: operatorNameById.get(entry.operatorId) || '—',
                issuedWeight: formatKg(entry.issuedWeight),
                receivedWeight: formatKg(entry.receivedWeight),
                pendingWeight: formatKg(entry.pendingWeight),
                progress: `${progressPercent}%`,
                barcode: entry.barcode || entry.id.substring(0, 8),
            };
            if (process === 'cutter') {
                return { ...baseData, cut: cutNameById.get(entry.cutId) || '—' };
            }
            return baseData;
        });

        let columns = [
            { key: 'date', header: 'Date' },
            { key: 'lotOrPiece', header: process === 'cutter' ? 'Piece' : 'Lot' },
            { key: 'itemName', header: 'Item' },
        ];
        if (process === 'cutter') {
            columns.push({ key: 'cut', header: 'Cut' });
        }
        columns = columns.concat([
            { key: 'machineName', header: 'Machine' },
            { key: 'operatorName', header: 'Operator' },
            { key: 'issuedWeight', header: 'Issued (kg)' },
            { key: 'receivedWeight', header: 'Received (kg)' },
            { key: 'pendingWeight', header: 'Pending (kg)' },
            { key: 'progress', header: 'Progress' },
            { key: 'barcode', header: 'Barcode' },
        ]);

        const today = new Date().toISOString().split('T')[0];
        exportHistoryToExcel(exportData, columns, `on-machine-${process}-${today}`);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-end bg-muted/30 p-4 rounded-lg border">
                <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase">Search</label>
                    <input
                        type="text"
                        placeholder="Search by lot, piece, barcode, machine..."
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">From Date</label>
                        <input
                            type="date"
                            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">To Date</label>
                        <input
                            type="date"
                            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>
                </div>
                <button
                    onClick={() => {
                        setSearchTerm('');
                        setStartDate('');
                        setEndDate('');
                    }}
                    className="h-9 px-3 rounded-md border border-input bg-background text-xs hover:bg-muted font-medium"
                >
                    Clear
                </button>
                <button
                    onClick={handleExport}
                    className="h-9 px-3 rounded-md border border-primary bg-primary text-primary-foreground text-xs hover:bg-primary/90 font-medium flex items-center gap-1"
                >
                    <Download className="w-4 h-4" />
                    Export
                </button>
            </div>

            <div className="rounded-md border max-h-[600px] overflow-y-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {process === 'cutter' && (
                                <>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Piece</TableHead>
                                    <TableHead>Cut</TableHead>
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
                                        <TableCell className="max-w-[120px] truncate" title={process === 'cutter' ? (entry.pieceIds || '') : (entry.lotNo || '')}>
                                            {process === 'cutter' ? (entry.pieceIds || '—') : (entry.lotNo || '—')}
                                        </TableCell>
                                        {process === 'cutter' && <TableCell>{cutNameById.get(entry.cutId) || '—'}</TableCell>}
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
