import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu } from '../ui';
import { ArrowRight, Download } from 'lucide-react';
import { exportHistoryToExcel } from '../../services';
import { buildConingTraceContext, resolveConingTrace } from '../../utils/coningTrace';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';
import { KeyValueGrid } from '../common/KeyValueGrid';

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
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const traceContext = useMemo(() => buildConingTraceContext(db), [db]);
    const holoTraceContext = useMemo(() => buildHoloTraceContext(db), [db]);

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

    const yarnNameById = useMemo(() => {
        const map = new Map();
        (db.yarns || []).forEach(y => map.set(y.id, y.name || '—'));
        return map;
    }, [db.yarns]);

    const twistNameById = useMemo(() => {
        const map = new Map();
        (db.twists || []).forEach(t => map.set(t.id, t.name || '—'));
        return map;
    }, [db.twists]);

    const resolvePieceCutName = (piece) => {
        if (!piece) return '';
        const cutVal = piece.cut;
        return piece.cutName
            || (typeof cutVal === 'string' ? cutVal : cutVal?.name)
            || piece.cutMaster?.name
            || (piece.cutId ? cutNameById.get(piece.cutId) : '')
            || '';
    };

    const resolvePieceYarnName = (piece) => {
        if (!piece) return '';
        const yarnVal = piece.yarn;
        return piece.yarnName
            || (typeof yarnVal === 'string' ? yarnVal : yarnVal?.name)
            || (piece.yarnId ? yarnNameById.get(piece.yarnId) : '')
            || '';
    };

    const resolvePieceTwistName = (piece) => {
        if (!piece) return '';
        const twistVal = piece.twist;
        return piece.twistName
            || (typeof twistVal === 'string' ? twistVal : twistVal?.name)
            || (piece.twistId ? twistNameById.get(piece.twistId) : '')
            || '';
    };

    const pickName = (primary, fallback) => {
        const primaryClean = String(primary || '').trim();
        if (primaryClean && primaryClean !== '—') return primaryClean;
        const fallbackClean = String(fallback || '').trim();
        return fallbackClean || '—';
    };

    const resolveEntryNames = (entry) => {
        if (!entry) return { cutName: '—', yarnName: '—', twistName: '—' };
        const firstPieceId = Array.isArray(entry.pieceIdsList) ? entry.pieceIdsList[0] : null;
        const piece = firstPieceId ? db.inbound_items?.find(p => p.id === firstPieceId) : null;
        const fallbackCut = resolvePieceCutName(piece);
        const fallbackYarn = resolvePieceYarnName(piece);
        const fallbackTwist = resolvePieceTwistName(piece);

        if (process === 'cutter') {
            const directCut = cutNameById.get(entry.cutId) || '';
            return {
                cutName: pickName(directCut, fallbackCut),
                yarnName: pickName('', fallbackYarn),
                twistName: pickName('', fallbackTwist),
            };
        }

        if (process === 'holo') {
            const resolved = resolveHoloTrace(entry, holoTraceContext);
            return {
                cutName: pickName(resolved.cutName, fallbackCut),
                yarnName: pickName(resolved.yarnName, fallbackYarn),
                twistName: pickName(resolved.twistName, fallbackTwist),
            };
        }

        if (process === 'coning') {
            const resolved = resolveConingTrace(entry, traceContext);
            return {
                cutName: pickName(resolved.cutName, fallbackCut),
                yarnName: pickName(resolved.yarnName, fallbackYarn),
                twistName: pickName(resolved.twistName, fallbackTwist),
            };
        }

        return { cutName: '—', yarnName: '—', twistName: '—' };
    };

    const resolvePieceDisplay = (entry) => {
        if (!entry) return '-';
        if (Array.isArray(entry.pieceIdsList) && entry.pieceIdsList.length > 0) {
            return entry.pieceIdsList.join(', ');
        }
        if (Array.isArray(entry.pieceIds) && entry.pieceIds.length > 0) {
            return entry.pieceIds.join(', ');
        }
        if (typeof entry.pieceIds === 'string' && entry.pieceIds.trim()) {
            return entry.pieceIds.trim();
        }
        return '-';
    };

    const resolveConingConeTypeName = (issue) => {
        if (!issue?.receivedRowRefs) return '—';
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') {
            try { refs = JSON.parse(refs || '[]'); } catch { refs = []; }
        }
        if (!Array.isArray(refs) || refs.length === 0) return '—';
        const ids = new Set(refs.map(ref => ref?.coneTypeId).filter(Boolean));
        if (!ids.size) return '—';
        const names = Array.from(ids).map(id => db.cone_types?.find(c => c.id === id)?.name || id);
        return names.join(', ');
    };

    const formatPerConeNet = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return '—';
        return `${num} g`;
    };

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
                // Trace pieces for holo: trace back to cutter receive rows
                let pieceIds = [];
                try {
                    const refs = typeof issue.receivedRowRefs === 'string'
                        ? JSON.parse(issue.receivedRowRefs)
                        : issue.receivedRowRefs;
                    if (Array.isArray(refs)) {
                        const idsSet = new Set();
                        refs.forEach(ref => {
                            const cutterRow = (db.receive_from_cutter_machine_rows || []).find(r => r.id === ref.rowId);
                            if (cutterRow?.pieceId) {
                                idsSet.add(cutterRow.pieceId);
                            }
                        });
                        pieceIds = Array.from(idsSet);
                    }
                } catch (e) {
                    pieceIds = [];
                }
                if (pieceIds.length === 0 && issue.lotNo) {
                    pieceIds = [`${issue.lotNo}-1`];
                }

                let totalReceived = 0;
                let totalWastage = 0;
                pieceIds.forEach((pieceId) => {
                    const totals = holoPieceTotals.get(pieceId);
                    if (totals) {
                        totalReceived += totals.totalNetWeight || 0;
                        totalWastage += totals.wastageNetWeight || 0;
                    }
                });

                const issuedWeight = issue.metallicBobbinsWeight || 0;
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
                let rollsIssued = 0;
                let pieceIds = [];
                try {
                    const refs = typeof issue.receivedRowRefs === 'string'
                        ? JSON.parse(issue.receivedRowRefs)
                        : issue.receivedRowRefs;
                    if (Array.isArray(refs)) {
                        const idsSet = new Set();
                        refs.forEach(ref => {
                            issuedWeight += Number(ref.issueWeight || 0);
                            rollsIssued += Number(ref.issueRolls || ref.baseRolls || 0);

                            // Trace back to piece: coning issue -> holo receive -> holo issue -> cutter receive -> pieceId
                            const holoRow = (db.receive_from_holo_machine_rows || []).find(r => r.id === ref.rowId);
                            if (holoRow) {
                                if (holoRow.pieceId) {
                                    idsSet.add(holoRow.pieceId);
                                }
                                const holoIssue = (db.issue_to_holo_machine || []).find(i => i.id === holoRow.issueId);
                                if (holoIssue) {
                                    const holoRefs = typeof holoIssue.receivedRowRefs === 'string'
                                        ? JSON.parse(holoIssue.receivedRowRefs)
                                        : holoIssue.receivedRowRefs;
                                    if (Array.isArray(holoRefs)) {
                                        holoRefs.forEach(hRef => {
                                            const cutterRow = (db.receive_from_cutter_machine_rows || []).find(r => r.id === hRef.rowId);
                                            if (cutterRow?.pieceId) {
                                                idsSet.add(cutterRow.pieceId);
                                            }
                                        });
                                    }
                                }
                            }
                        });
                        pieceIds = Array.from(idsSet);
                    }
                } catch (e) {
                    // If parsing fails, use rollsIssued as fallback (less accurate)
                    issuedWeight = 0;
                    pieceIds = [];
                }

                const accountedWeight = totalReceived + totalWastage;
                const pendingWeight = issuedWeight - accountedWeight;

                return {
                    ...issue,
                    issuedWeight,
                    rollsIssued,
                    receivedWeight: totalReceived,
                    wastageWeight: totalWastage,
                    pendingWeight: Math.max(0, pendingWeight),
                    pieceIdsList: pieceIds,
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
                const lot = [e.lotLabel || e.lotNo || '', ...(Array.isArray(e.lotNos) ? e.lotNos : [])].join(' ').toLowerCase();
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
                    machineName.includes(term) ||
                    (e.pieceIdsList && e.pieceIdsList.join(' ').toLowerCase().includes(term));
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
            const resolvedNames = resolveEntryNames(entry);
            const baseData = {
                date: formatDateDDMMYYYY(entry.date),
                lotOrPiece: (process === 'cutter' || process === 'holo' || process === 'coning')
                    ? resolvePieceDisplay(entry)
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
            if (process === 'coning') {
                return {
                    ...baseData,
                    cut: resolvedNames.cutName,
                    yarn: resolvedNames.yarnName,
                    twist: resolvedNames.twistName,
                    rollsIssued: entry.rollsIssued || 0,
                    coneType: resolveConingConeTypeName(entry),
                    perConeNetG: Number.isFinite(Number(entry.requiredPerConeNetWeight)) ? Number(entry.requiredPerConeNetWeight) : '',
                };
            }

            if (process === 'cutter' || process === 'holo') {
                return {
                    ...baseData,
                    cut: resolvedNames.cutName,
                    yarn: resolvedNames.yarnName,
                    twist: resolvedNames.twistName,
                };
            }

            return baseData;
        });

        let columns = [
            { key: 'date', header: 'Date' },
            { key: 'lotOrPiece', header: (process === 'cutter' || process === 'holo' || process === 'coning') ? 'Piece' : 'Lot' },
            { key: 'itemName', header: 'Item' },
        ];
        if (process === 'cutter' || process === 'holo' || process === 'coning') {
            columns.push({ key: 'cut', header: 'Cut' });
            columns.push({ key: 'yarn', header: 'Yarn' });
            columns.push({ key: 'twist', header: 'Twist' });
        }
        if (process === 'coning') {
            columns.push({ key: 'rollsIssued', header: 'Rolls Issued' });
            columns.push({ key: 'coneType', header: 'Cone Type' });
            columns.push({ key: 'perConeNetG', header: 'Per Cone (g)' });
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

    const emptyColSpan = process === 'cutter' ? 14 : process === 'holo' ? 14 : 17;

    return (
        <div className="space-y-4">
            <div className="flex flex-col items-stretch sm:flex-row sm:items-end gap-4 bg-muted/30 p-4 rounded-lg border">
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
                <div className="flex flex-col sm:flex-row gap-2">
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

            <div className="hidden sm:block rounded-md border max-h-[calc(100vh-280px)] overflow-y-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {process === 'cutter' && (
                                <>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Piece</TableHead>
                                    <TableHead>Cut</TableHead>
                                    <TableHead>Yarn</TableHead>
                                    <TableHead>Twist</TableHead>
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
                                    <TableHead>Piece</TableHead>
                                    <TableHead>Cut</TableHead>
                                    <TableHead>Yarn</TableHead>
                                    <TableHead>Twist</TableHead>
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
                                    <TableHead>Piece</TableHead>
                                    <TableHead>Cut</TableHead>
                                    <TableHead>Yarn</TableHead>
                                    <TableHead>Twist</TableHead>
                                    <TableHead>Rolls Issued</TableHead>
                                    <TableHead>Cone Type</TableHead>
                                    <TableHead>Per Cone (g)</TableHead>
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
                                <TableCell colSpan={emptyColSpan} className="text-center py-8 text-muted-foreground">
                                    No pending entries on machine for {process}.
                                </TableCell>
                            </TableRow>
                        ) : (
                            onMachineEntries.map((entry) => {
                                const progressPercent = getProgressPercent(entry);
                                const resolvedNames = resolveEntryNames(entry);
                                return (
                                    <TableRow key={entry.id}>
                                        <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(entry.date)}</TableCell>
                                        <TableCell>{itemNameById.get(entry.itemId)}</TableCell>
                                        <TableCell className="max-w-[120px] truncate" title={(process === 'cutter' || process === 'holo' || process === 'coning') ? resolvePieceDisplay(entry) : (entry.lotNo || '')}>
                                            {(process === 'cutter' || process === 'holo' || process === 'coning') ? resolvePieceDisplay(entry) : (entry.lotNo || '—')}
                                        </TableCell>
                                        {process === 'cutter' && (
                                            <>
                                                <TableCell>{resolvedNames.cutName}</TableCell>
                                                <TableCell>{resolvedNames.yarnName}</TableCell>
                                                <TableCell>{resolvedNames.twistName}</TableCell>
                                            </>
                                        )}
                                        {process === 'holo' && (
                                            <>
                                                <TableCell>{resolvedNames.cutName}</TableCell>
                                                <TableCell>{resolvedNames.yarnName}</TableCell>
                                                <TableCell>{resolvedNames.twistName}</TableCell>
                                            </>
                                        )}
                                        {process === 'coning' && (
                                            <>
                                                <TableCell>{resolvedNames.cutName}</TableCell>
                                                <TableCell>{resolvedNames.yarnName}</TableCell>
                                                <TableCell>{resolvedNames.twistName}</TableCell>
                                                <TableCell>{entry.rollsIssued || 0}</TableCell>
                                                <TableCell>{resolveConingConeTypeName(entry)}</TableCell>
                                                <TableCell>{formatPerConeNet(entry.requiredPerConeNetWeight)}</TableCell>
                                            </>
                                        )}
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

            {/* Mobile Card View - shown on small screens only */}
            <div className="block sm:hidden space-y-3">
                {onMachineEntries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
                        No pending entries on machine for {process}.
                    </div>
                ) : (
                    onMachineEntries.map((entry) => {
                        const progressPercent = getProgressPercent(entry);
                        const resolvedNames = resolveEntryNames(entry);
                        const identifier = (process === 'cutter' || process === 'holo' || process === 'coning')
                            ? resolvePieceDisplay(entry)
                            : (entry.lotNo || '—');
                        const isExpanded = expandedIds.has(entry.id);
                        const pieceIds = Array.isArray(entry.pieceIdsList) ? entry.pieceIdsList : [];
                        const showPieces = pieceIds.slice(0, 6);
                        return (
                            <div key={entry.id} className="border rounded-lg p-4 bg-card shadow-sm">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold truncate" title={identifier}>{identifier}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {formatDateDDMMYYYY(entry.date)} • {itemNameById.get(entry.itemId)}
                                        </p>
                                    </div>
                                    <Badge variant="outline" className="text-blue-600 border-blue-600 whitespace-nowrap">
                                        {formatKg(entry.pendingWeight)} pending
                                    </Badge>
                                </div>

                                <div className="mt-3">
                                    <KeyValueGrid
                                        items={[
                                            { label: 'Machine', value: machineNameById.get(entry.machineId) },
                                            { label: 'Operator', value: operatorNameById.get(entry.operatorId) },
                                            { label: 'Cut', value: resolvedNames.cutName },
                                            { label: 'Yarn', value: resolvedNames.yarnName },
                                            { label: 'Twist', value: resolvedNames.twistName },
                                            ...(process === 'coning'
                                                ? [
                                                    { label: 'Rolls', value: String(entry.rollsIssued || 0) },
                                                    { label: 'Cone Type', value: resolveConingConeTypeName(entry) },
                                                    { label: 'Per Cone', value: formatPerConeNet(entry.requiredPerConeNetWeight) },
                                                ]
                                                : []),
                                            { label: 'Barcode', value: entry.barcode || entry.id?.substring?.(0, 8) || '—', mono: true },
                                        ]}
                                    />
                                </div>

                                {pieceIds.length > 0 ? (
                                    <div className="mt-3">
                                        <button
                                            type="button"
                                            className="text-xs font-medium text-primary hover:underline"
                                            onClick={() => {
                                                setExpandedIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(entry.id)) next.delete(entry.id);
                                                    else next.add(entry.id);
                                                    return next;
                                                });
                                            }}
                                        >
                                            {isExpanded ? 'Hide pieces' : `Show pieces (${pieceIds.length})`}
                                        </button>
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            {(isExpanded ? pieceIds : showPieces).join(', ')}
                                            {!isExpanded && pieceIds.length > showPieces.length ? ' …' : ''}
                                        </div>
                                    </div>
                                ) : null}

                                <div className="mt-3 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>Issued: {formatKg(entry.issuedWeight)}</span>
                                        <span>→</span>
                                        <span className="text-green-600">Rcvd: {formatKg(entry.receivedWeight)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                                            <div className="h-full bg-primary rounded-full" style={{ width: `${progressPercent}%` }} />
                                        </div>
                                        <span className="text-xs">{progressPercent}%</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleGoToReceive(entry)}
                                    className="mt-3 w-full h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 flex items-center justify-center gap-2"
                                >
                                    <ArrowRight className="w-4 h-4" /> Receive
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
