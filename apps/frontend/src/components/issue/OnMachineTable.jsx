import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu } from '../ui';
import { ArrowRight, Download, RotateCcw, Search, X } from 'lucide-react';
import { exportHistoryToExcel } from '../../services';
import { buildConingTraceContext, resolveConingTrace } from '../../utils/coningTrace';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';
import { KeyValueGrid } from '../common/KeyValueGrid';
import { SheetColumnFilter, applySheetFilters } from '../common/SheetColumnFilters';
import { HighlightMatch } from '../common/HighlightMatch';
import { Dialog, DialogContent } from '../ui/Dialog';
import { useInventory } from '../../context/InventoryContext';

/**
 * OnMachineTable - Displays work-in-progress entries (issued but not fully received)
 * 
 * Logic: An entry is "on machine" if:
 *   pendingWeight = issuedWeight - (receivedNetWeight + wastageNetWeight) > 0
 */
export function OnMachineTable({ db, process }) {
    const navigate = useNavigate();
    const { createIssueTakeBack, reverseIssueTakeBack } = useInventory();
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [sheetFilters, setSheetFilters] = useState({});
    const [openFilterId, setOpenFilterId] = useState(null);
    const [takeBackModalOpen, setTakeBackModalOpen] = useState(false);
    const [takeBackTarget, setTakeBackTarget] = useState(null);
    const [takeBackDate, setTakeBackDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [takeBackReason, setTakeBackReason] = useState('');
    const [takeBackNote, setTakeBackNote] = useState('');
    const [takeBackLinesDraft, setTakeBackLinesDraft] = useState([]);
    const [takeBackSaving, setTakeBackSaving] = useState(false);
    const traceContext = useMemo(() => buildConingTraceContext(db), [db]);
    const holoTraceContext = useMemo(() => buildHoloTraceContext(db), [db]);
    const boxById = useMemo(() => {
        const map = new Map();
        (db.boxes || []).forEach((box) => {
            const id = String(box?.id || '').trim();
            if (!id) return;
            map.set(id, box);
        });
        return map;
    }, [db.boxes]);
    const bobbinById = useMemo(() => {
        const map = new Map();
        (db.bobbins || []).forEach((bobbin) => {
            const id = String(bobbin?.id || '').trim();
            if (!id) return;
            map.set(id, bobbin);
        });
        return map;
    }, [db.bobbins]);
    const roundTakeBackWeight = (value) => {
        const num = Number(value || 0);
        if (!Number.isFinite(num) || num <= 0) return 0;
        return Math.round(num * 1000) / 1000;
    };
    const calcAutoTakeBackWeight = (line, countValue) => {
        const count = Math.max(0, Number(countValue || 0));
        const maxCount = Math.max(0, Number(line?.maxCount || 0));
        const maxWeight = Math.max(0, Number(line?.maxWeight || 0));
        if (maxCount <= 0 || maxWeight <= 0 || count <= 0) return 0;
        const proportional = (count / maxCount) * maxWeight;
        return roundTakeBackWeight(Math.min(maxWeight, proportional));
    };
    const calcHoloTakeBackNetWeight = (line, nextCount, grossWeightInput, nextBoxId) => {
        const count = Math.max(0, Number(nextCount || 0));
        const gross = Number(grossWeightInput || 0);
        if (!Number.isFinite(gross) || gross <= 0 || count <= 0) return 0;
        const bobbinWeight = Number(line?.pieceUnitWeight || 0);
        const boxWeight = Number(boxById.get(nextBoxId)?.weight || 0);
        if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) return 0;
        if (!Number.isFinite(boxWeight) || boxWeight < 0) return 0;
        const net = gross - ((count * bobbinWeight) + boxWeight);
        return roundTakeBackWeight(Math.max(0, net));
    };

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

    // Note: holoPieceTotals removed - we now calculate received weight directly from receive rows
    // linked by issueId to fix the bug where all issues sharing a piece would disappear

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

    const inboundBarcodeById = useMemo(() => {
        const map = new Map();
        (db.inbound_items || []).forEach((item) => {
            const id = String(item?.id || '').trim();
            if (!id) return;
            const barcode = String(item?.barcode || '').trim();
            if (barcode) map.set(id, barcode);
        });
        return map;
    }, [db.inbound_items]);

    const cutterReceiveById = useMemo(() => {
        const map = new Map();
        (db.receive_from_cutter_machine_rows || []).forEach((row) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            map.set(id, row);
        });
        return map;
    }, [db.receive_from_cutter_machine_rows]);

    const holoReceiveById = useMemo(() => {
        const map = new Map();
        (db.receive_from_holo_machine_rows || []).forEach((row) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            map.set(id, row);
        });
        return map;
    }, [db.receive_from_holo_machine_rows]);

    const resolveTakeBackSourceLabel = (stage, sourceId, fallback = '') => {
        if (stage === 'cutter') {
            return inboundBarcodeById.get(sourceId) || fallback || sourceId;
        }
        if (stage === 'holo') {
            const row = cutterReceiveById.get(sourceId);
            const rowBarcode = String(row?.barcode || row?.vchNo || '').trim();
            if (rowBarcode) return rowBarcode;
            const pieceBarcode = inboundBarcodeById.get(String(row?.pieceId || '').trim());
            return pieceBarcode || fallback || sourceId;
        }
        if (stage === 'coning') {
            const row = holoReceiveById.get(sourceId);
            const rowBarcode = String(row?.barcode || '').trim();
            if (rowBarcode) return rowBarcode;
            return fallback || sourceId;
        }
        return fallback || sourceId;
    };

    const activeTakeBacksByIssue = useMemo(() => {
        const map = new Map();
        (db.issue_take_backs || [])
            .filter((tb) => !tb.isReverse && !tb.isReversed)
            .forEach((tb) => {
                const arr = map.get(tb.issueId) || [];
                arr.push(tb);
                map.set(tb.issueId, arr);
            });
        return map;
    }, [db.issue_take_backs]);

    const latestReversibleTakeBackByIssue = useMemo(() => {
        const map = new Map();
        (db.issue_take_backs || [])
            .filter((tb) => !tb.isReverse && !tb.isReversed)
            .forEach((tb) => {
                const existing = map.get(tb.issueId);
                if (!existing) {
                    map.set(tb.issueId, tb);
                    return;
                }
                const existingTs = new Date(existing.createdAt || existing.date || 0).getTime();
                const nextTs = new Date(tb.createdAt || tb.date || 0).getTime();
                if (nextTs >= existingTs) {
                    map.set(tb.issueId, tb);
                }
            });
        return map;
    }, [db.issue_take_backs]);

    const buildTakeBackSources = (entry) => {
        if (!entry) return [];

        const activeTakeBacks = activeTakeBacksByIssue.get(entry.id) || [];
        const activeBySource = new Map();
        activeTakeBacks.forEach((tb) => {
            const lines = Array.isArray(tb.lines) ? tb.lines : [];
            lines.forEach((line) => {
                const sourceId = String(line?.sourceId || '').trim();
                if (!sourceId) return;
                const current = activeBySource.get(sourceId) || { count: 0, weight: 0 };
                current.count += Number(line?.count || 0);
                current.weight += Number(line?.weight || 0);
                activeBySource.set(sourceId, current);
            });
        });

        if (process === 'cutter') {
            const issueLines = (db.issue_to_cutter_machine_lines || []).filter((line) => line.issueId === entry.id);
            const linkedRows = (db.receive_from_cutter_machine_rows || [])
                .filter((row) => !row?.isDeleted && row.issueId === entry.id);
            const receivedBySource = new Map();
            linkedRows.forEach((row) => {
                const sourceId = String(row?.pieceId || '').trim();
                if (!sourceId) return;
                const current = receivedBySource.get(sourceId) || 0;
                receivedBySource.set(sourceId, current + Number(row?.netWt || 0));
            });

            const stagePendingWeight = Math.max(
                0,
                Number(entry?.issueBalance?.pendingWeight ?? Number.POSITIVE_INFINITY),
            );
            let pendingPool = stagePendingWeight;
            return issueLines.map((line) => {
                const active = activeBySource.get(line.pieceId) || { count: 0, weight: 0 };
                const originalWeight = Number(line.issuedWeight || 0);
                const receivedWeight = Number(receivedBySource.get(line.pieceId) || 0);
                const lineNetRemaining = Math.max(0, originalWeight - Number(active.weight || 0) - receivedWeight);
                const maxWeight = Number.isFinite(pendingPool)
                    ? Math.max(0, Math.min(lineNetRemaining, pendingPool))
                    : lineNetRemaining;
                if (Number.isFinite(pendingPool)) {
                    pendingPool = Math.max(0, pendingPool - maxWeight);
                }
                return {
                    sourceId: line.pieceId,
                    label: resolveTakeBackSourceLabel('cutter', line.pieceId),
                    maxCount: 0,
                    maxWeight,
                };
            }).filter((line) => line.maxWeight > 0.0001);
        }

        let refs = entry.receivedRowRefs;
        if (typeof refs === 'string') {
            try { refs = JSON.parse(refs || '[]'); } catch { refs = []; }
        }
        const refRows = Array.isArray(refs) ? refs : [];
        const sourceMap = new Map();
        refRows.forEach((ref) => {
            const sourceId = typeof ref?.rowId === 'string' ? ref.rowId.trim() : '';
            if (!sourceId) return;
            const originalCount = process === 'holo'
                ? Number(ref?.issuedBobbins || 0)
                : Number(ref?.issueRolls || 0);
            const originalWeight = process === 'holo'
                ? Number(ref?.issuedBobbinWeight || 0)
                : Number(ref?.issueWeight || 0);
            const active = activeBySource.get(sourceId) || { count: 0, weight: 0 };
            const maxCount = Math.max(0, originalCount - Number(active.count || 0));
            const maxWeight = Math.max(0, originalWeight - Number(active.weight || 0));
            if (maxWeight <= 0.0001) return;
            const cutterRow = process === 'holo' ? cutterReceiveById.get(sourceId) : null;
            const bobbin = process === 'holo' ? bobbinById.get(String(cutterRow?.bobbinId || '').trim()) : null;
            sourceMap.set(sourceId, {
                sourceId,
                label: resolveTakeBackSourceLabel(process, sourceId, ref?.barcode),
                maxCount,
                maxWeight,
                sourceBoxId: process === 'holo' ? String(cutterRow?.boxId || '').trim() : '',
                pieceTypeId: process === 'holo' ? String(cutterRow?.bobbinId || '').trim() : '',
                pieceTypeName: process === 'holo' ? (bobbin?.name || '—') : '',
                pieceUnitWeight: process === 'holo' ? Number(bobbin?.weight || 0) : 0,
            });
        });
        return Array.from(sourceMap.values());
    };

    const openTakeBackModal = (entry) => {
        const sources = buildTakeBackSources(entry);
        setTakeBackTarget(entry);
        setTakeBackDate(new Date().toISOString().slice(0, 10));
        setTakeBackReason('');
        setTakeBackNote('');
        setTakeBackLinesDraft(
            sources.map((line) => {
                const count = process === 'cutter' ? 0 : line.maxCount;
                const boxId = process === 'holo' ? (line.sourceBoxId || '') : '';
                const tareEstimate = process === 'holo'
                    ? ((Number(line.pieceUnitWeight || 0) * Number(count || 0)) + Number(boxById.get(boxId)?.weight || 0))
                    : 0;
                const grossWeight = process === 'holo'
                    ? roundTakeBackWeight(Number(line.maxWeight || 0) + tareEstimate)
                    : 0;
                const weight = process === 'holo'
                    ? calcHoloTakeBackNetWeight(line, count, grossWeight, boxId)
                    : (process === 'cutter' ? line.maxWeight : calcAutoTakeBackWeight(line, count));
                return {
                    sourceId: line.sourceId,
                    sourceBarcode: line.label,
                    maxCount: line.maxCount,
                    maxWeight: line.maxWeight,
                    count,
                    weight,
                    boxId,
                    grossWeight,
                    pieceTypeId: line.pieceTypeId || '',
                    pieceTypeName: line.pieceTypeName || '',
                    pieceUnitWeight: Number(line.pieceUnitWeight || 0),
                };
            }),
        );
        setTakeBackModalOpen(true);
    };

    const submitTakeBack = async () => {
        if (!takeBackTarget) return;
        if (!takeBackDate || !takeBackReason.trim()) {
            alert('Date and reason are required');
            return;
        }
        const lines = (takeBackLinesDraft || [])
            .map((line) => ({
                sourceId: line.sourceId,
                sourceBarcode: line.sourceBarcode || null,
                count: Math.max(0, Number(line.count || 0)),
                weight: Math.max(0, Number(line.weight || 0)),
            }))
            .filter((line) => line.weight > 0.0001 && (process === 'cutter' || line.count > 0));
        if (process === 'holo') {
            const invalidGross = (takeBackLinesDraft || []).find((line) => Number(line.count || 0) > 0 && (!Number.isFinite(Number(line.grossWeight)) || Number(line.grossWeight) <= 0));
            if (invalidGross) {
                alert(`Enter valid gross weight for source ${invalidGross.sourceBarcode || invalidGross.sourceId}`);
                return;
            }
            const invalidBox = (takeBackLinesDraft || []).find((line) => Number(line.count || 0) > 0 && !String(line.boxId || '').trim());
            if (invalidBox) {
                alert(`Select box for source ${invalidBox.sourceBarcode || invalidBox.sourceId}`);
                return;
            }
            const exceedsMax = (takeBackLinesDraft || []).find((line) => Number(line.count || 0) > 0 && Number(line.weight || 0) - Number(line.maxWeight || 0) > 0.001);
            if (exceedsMax) {
                alert(`Net weight exceeds max for source ${exceedsMax.sourceBarcode || exceedsMax.sourceId}`);
                return;
            }
        }
        if (lines.length === 0) {
            alert('Enter at least one valid line');
            return;
        }
        setTakeBackSaving(true);
        try {
            await createIssueTakeBack(process, takeBackTarget.id, {
                date: takeBackDate,
                reason: takeBackReason.trim(),
                note: takeBackNote.trim() || null,
                lines,
            });
            setTakeBackModalOpen(false);
        } catch (err) {
            alert(err.message || 'Failed to create take-back');
        } finally {
            setTakeBackSaving(false);
        }
    };

    const handleReverseLatestTakeBack = async (entry) => {
        const latest = latestReversibleTakeBackByIssue.get(entry.id);
        if (!latest) {
            alert('No reversible take-back found for this issue');
            return;
        }
        const confirmed = window.confirm('Reverse the latest take-back for this issue?');
        if (!confirmed) return;
        try {
            await reverseIssueTakeBack(latest.id, {
                date: new Date().toISOString().slice(0, 10),
                reason: 'reverse',
                note: 'Reversed from On Machine',
                stage: process,
            });
        } catch (err) {
            alert(err.message || 'Failed to reverse take-back');
        }
    };

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

                const balance = issue.issueBalance || {};
                const originalIssuedWeight = Number(balance.originalWeight ?? issue.totalWeight ?? 0);
                const takeBackWeight = Number(balance.takeBackWeight || 0);
                const netIssuedWeight = Number(balance.netIssuedWeight ?? Math.max(0, originalIssuedWeight - takeBackWeight));
                const receivedWeight = Number(balance.receivedWeight ?? totalReceived);
                const wastageWeight = Number(balance.wastageWeight ?? totalWastage);
                const pendingWeight = Number(balance.pendingWeight ?? Math.max(0, netIssuedWeight - receivedWeight - wastageWeight));

                return {
                    ...issue,
                    originalIssuedWeight,
                    takeBackWeight,
                    netIssuedWeight,
                    issuedWeight: netIssuedWeight,
                    receivedWeight,
                    wastageWeight,
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

                // FIX: Calculate received weight from receive rows directly linked to THIS issue
                // instead of using shared piece totals (which caused all issues sharing a piece to disappear)
                let totalReceived = 0;
                let totalWastage = 0;
                const holoReceiveRows = db.receive_from_holo_machine_rows || [];
                holoReceiveRows.forEach(row => {
                    if (row.issueId === issue.id && !row.isDeleted) {
                        // Calculate net weight for this row
                        const netWeight = Number.isFinite(row.rollWeight)
                            ? Number(row.rollWeight)
                            : (Number(row.grossWeight || 0) - Number(row.tareWeight || 0));
                        // Check if this is a wastage row (rollType with 'wastage' in name or specific flag)
                        const rollType = db.roll_types?.find(rt => rt.id === row.rollTypeId);
                        const isWastage = rollType?.name?.toLowerCase().includes('wastage');
                        if (isWastage) {
                            totalWastage += netWeight;
                        } else {
                            totalReceived += netWeight;
                        }
                    }
                });

                const balance = issue.issueBalance || {};
                const originalIssuedWeight = Number(balance.originalWeight ?? issue.metallicBobbinsWeight ?? 0);
                const takeBackWeight = Number(balance.takeBackWeight || 0);
                const netIssuedWeight = Number(balance.netIssuedWeight ?? Math.max(0, originalIssuedWeight - takeBackWeight));
                const receivedWeight = Number(balance.receivedWeight ?? totalReceived);
                const wastageWeight = Number(balance.wastageWeight ?? totalWastage);
                const pendingWeight = Number(balance.pendingWeight ?? Math.max(0, netIssuedWeight - receivedWeight - wastageWeight));

                return {
                    ...issue,
                    originalIssuedWeight,
                    takeBackWeight,
                    netIssuedWeight,
                    issuedWeight: netIssuedWeight,
                    receivedWeight,
                    wastageWeight,
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

                const balance = issue.issueBalance || {};
                const originalIssuedWeight = Number(balance.originalWeight ?? issuedWeight);
                const takeBackWeight = Number(balance.takeBackWeight || 0);
                const netIssuedWeight = Number(balance.netIssuedWeight ?? Math.max(0, originalIssuedWeight - takeBackWeight));
                const receivedWeight = Number(balance.receivedWeight ?? totalReceived);
                const wastageWeight = Number(balance.wastageWeight ?? totalWastage);
                const pendingWeight = Number(balance.pendingWeight ?? Math.max(0, netIssuedWeight - receivedWeight - wastageWeight));

                return {
                    ...issue,
                    originalIssuedWeight,
                    takeBackWeight,
                    netIssuedWeight,
                    issuedWeight: netIssuedWeight,
                    rollsIssued,
                    receivedWeight,
                    wastageWeight,
                    pendingWeight: Math.max(0, pendingWeight),
                    pieceIdsList: pieceIds,
                };
            }).filter(e => e.pendingWeight > 0.001);
        }

        // Sort by date descending (most recent first)
        let sorted = entries.sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));

        return sorted;
    }, [db, process, cutterPieceTotals, coningPieceTotals]);

    const filterColumns = useMemo(() => {
        const common = [
            { id: 'date', label: 'Date', kind: 'date', getValue: (r) => r.date || r.createdAt || '' },
            { id: 'item', label: 'Item', kind: 'values', getValue: (r) => itemNameById.get(r.itemId) || '' },
            { id: 'piece', label: 'Piece', kind: 'text', getValue: (r) => (Array.isArray(r.pieceIdsList) ? r.pieceIdsList.join(', ') : (r.pieceIds || '')) },
            { id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => (resolveEntryNames(r).cutName || '') },
            ...(process !== 'cutter' ? [
                { id: 'yarn', label: 'Yarn', kind: 'values', getValue: (r) => (resolveEntryNames(r).yarnName || '') },
                { id: 'twist', label: 'Twist', kind: 'values', getValue: (r) => (resolveEntryNames(r).twistName || '') },
            ] : []),
            { id: 'machine', label: 'Machine', kind: 'values', getValue: (r) => machineNameById.get(r.machineId) || '' },
            { id: 'operator', label: 'Operator', kind: 'values', getValue: (r) => operatorNameById.get(r.operatorId) || '' },
            { id: 'issuedWeight', label: 'Net Issued (kg)', kind: 'number', getValue: (r) => r.issuedWeight },
            { id: 'receivedWeight', label: 'Received (kg)', kind: 'number', getValue: (r) => r.receivedWeight },
            { id: 'pendingWeight', label: 'Pending (kg)', kind: 'number', getValue: (r) => r.pendingWeight },
            { id: 'barcode', label: 'Barcode', kind: 'text', getValue: (r) => r.barcode || '' },
        ];
        if (process === 'coning') {
            return [
                ...common.slice(0, 6),
                { id: 'rollsIssued', label: 'Rolls Issued', kind: 'number', getValue: (r) => r.rollsIssued || 0 },
                { id: 'coneType', label: 'Cone Type', kind: 'values', getValue: (r) => resolveConingConeTypeName(r) || '' },
                { id: 'perCone', label: 'Per Cone (g)', kind: 'number', getValue: (r) => r.requiredPerConeNetWeight || 0 },
                ...common.slice(6),
            ];
        }
        return common;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [process, itemNameById, machineNameById, operatorNameById, db, traceContext, holoTraceContext]);

    const filteredEntries = useMemo(() => {
        let rows = applySheetFilters(onMachineEntries, filterColumns, sheetFilters);

        // Search across all filterColumns
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            rows = rows.filter(r =>
                filterColumns.some(col => {
                    const val = col.getValue(r);
                    return String(val).toLowerCase().includes(term);
                })
            );
        }

        return rows;
    }, [onMachineEntries, filterColumns, sheetFilters, searchTerm]);

    const totals = useMemo(() => {
        const base = {
            originalIssuedWeight: 0,
            takeBackWeight: 0,
            netIssuedWeight: 0,
            issuedWeight: 0,
            receivedWeight: 0,
            pendingWeight: 0,
            rollsIssued: 0,
        };
        for (const r of filteredEntries || []) {
            base.originalIssuedWeight += Number(r.originalIssuedWeight || r.issuedWeight || 0);
            base.takeBackWeight += Number(r.takeBackWeight || 0);
            base.netIssuedWeight += Number(r.netIssuedWeight ?? r.issuedWeight ?? 0);
            base.issuedWeight += Number(r.issuedWeight || 0);
            base.receivedWeight += Number(r.receivedWeight || 0);
            base.pendingWeight += Number(r.pendingWeight || 0);
            if (process === 'coning') base.rollsIssued += Number(r.rollsIssued || 0);
        }
        return base;
    }, [filteredEntries, process]);

    const handleGoToReceive = (entry) => {
        // Navigate to receive page with barcode param for auto-scan
        navigate(`/app/receive?barcode=${encodeURIComponent(entry.barcode)}`);
    };

    const getActions = (entry) => {
        const activeTakeBackCount = (activeTakeBacksByIssue.get(entry.id) || []).length;
        const takeBackSources = buildTakeBackSources(entry);
        return [
            {
                label: 'Go to Receive',
                icon: <ArrowRight className="w-4 h-4" />,
                onClick: () => handleGoToReceive(entry),
            },
            {
                label: 'Take Back',
                icon: <RotateCcw className="w-4 h-4" />,
                onClick: () => openTakeBackModal(entry),
                disabled: takeBackSources.length === 0,
                disabledReason: 'No take-back-eligible lines available.',
            },
            {
                label: 'Reverse Last Take Back',
                icon: <RotateCcw className="w-4 h-4" />,
                onClick: () => handleReverseLatestTakeBack(entry),
                disabled: activeTakeBackCount <= 0,
                disabledReason: 'No active take-back found.',
            },
        ];
    };

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
        const exportData = filteredEntries.map(entry => {
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
                originalIssuedWeight: formatKg(entry.originalIssuedWeight || entry.issuedWeight),
                takeBackWeight: formatKg(entry.takeBackWeight || 0),
                netIssuedWeight: formatKg(entry.netIssuedWeight ?? entry.issuedWeight),
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
            if (process !== 'cutter') {
                columns.push({ key: 'yarn', header: 'Yarn' });
                columns.push({ key: 'twist', header: 'Twist' });
            }
        }
        if (process === 'coning') {
            columns.push({ key: 'rollsIssued', header: 'Rolls Issued' });
            columns.push({ key: 'coneType', header: 'Cone Type' });
            columns.push({ key: 'perConeNetG', header: 'Per Cone (g)' });
        }
        columns = columns.concat([
            { key: 'machineName', header: 'Machine' },
            { key: 'operatorName', header: 'Operator' },
            { key: 'originalIssuedWeight', header: 'Issued Original (kg)' },
            { key: 'takeBackWeight', header: 'Taken Back (kg)' },
            { key: 'netIssuedWeight', header: 'Net Issued (kg)' },
            { key: 'receivedWeight', header: 'Received (kg)' },
            { key: 'pendingWeight', header: 'Pending (kg)' },
            { key: 'progress', header: 'Progress' },
            { key: 'barcode', header: 'Barcode' },
        ]);

        const today = new Date().toISOString().split('T')[0];
        exportHistoryToExcel(exportData, columns, `on-machine-${process}-${today}`);
    };

    const emptyColSpan = process === 'cutter' ? 12 : process === 'holo' ? 14 : 17;

    return (
        <div className="space-y-4">
            <div className="flex flex-col items-stretch sm:flex-row sm:items-center gap-3 bg-muted/30 p-3 rounded-lg border">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search across all columns..."
                        className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-8 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
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
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Date</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'date')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Item</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'item')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Piece</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'piece')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cut</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'cut')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>

                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Machine</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'machine')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Operator</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'operator')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Issued (O/TB/N)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'issuedWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Received (kg)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'receivedWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Pending (kg)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'pendingWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Barcode</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'barcode')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                            {process === 'holo' && (
                                <>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Date</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'date')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Item</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'item')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Piece</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'piece')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cut</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'cut')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Yarn</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'yarn')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Twist</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'twist')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Machine</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'machine')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Operator</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'operator')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Issued (O/TB/N)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'issuedWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Received (kg)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'receivedWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Pending (kg)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'pendingWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Barcode</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'barcode')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                            {process === 'coning' && (
                                <>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Date</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'date')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Item</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'item')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Piece</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'piece')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cut</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'cut')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Yarn</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'yarn')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Twist</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'twist')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Rolls Issued</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'rollsIssued')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cone Type</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'coneType')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Per Cone (g)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'perCone')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Machine</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'machine')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Operator</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'operator')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Issued (O/TB/N)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'issuedWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Received (kg)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'receivedWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Pending (kg)</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'pendingWeight')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Barcode</span>
                                            <SheetColumnFilter column={filterColumns.find(c => c.id === 'barcode')} rows={onMachineEntries} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredEntries.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={emptyColSpan} className="text-center py-8 text-muted-foreground">
                                    No pending entries on machine for {process}.
                                </TableCell>
                            </TableRow>
                        ) : (
                            <>
                                {filteredEntries.map((entry) => {
                                    const progressPercent = getProgressPercent(entry);
                                    const resolvedNames = resolveEntryNames(entry);
                                    return (
                                        <TableRow key={entry.id}>
                                            <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(entry.date)} query={searchTerm} /></TableCell>
                                            <TableCell><HighlightMatch text={itemNameById.get(entry.itemId)} query={searchTerm} /></TableCell>
                                            <TableCell className="max-w-[120px] truncate" title={(process === 'cutter' || process === 'holo' || process === 'coning') ? resolvePieceDisplay(entry) : (entry.lotNo || '')}>
                                                <HighlightMatch text={(process === 'cutter' || process === 'holo' || process === 'coning') ? resolvePieceDisplay(entry) : (entry.lotNo || '—')} query={searchTerm} />
                                            </TableCell>
                                            {process === 'cutter' && (
                                                <TableCell><HighlightMatch text={resolvedNames.cutName} query={searchTerm} /></TableCell>
                                            )}
                                            {process === 'holo' && (
                                                <>
                                                    <TableCell><HighlightMatch text={resolvedNames.cutName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={resolvedNames.yarnName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={resolvedNames.twistName} query={searchTerm} /></TableCell>
                                                </>
                                            )}
                                            {process === 'coning' && (
                                                <>
                                                    <TableCell><HighlightMatch text={resolvedNames.cutName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={resolvedNames.yarnName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={resolvedNames.twistName} query={searchTerm} /></TableCell>
                                                    <TableCell>{entry.rollsIssued || 0}</TableCell>
                                                    <TableCell><HighlightMatch text={resolveConingConeTypeName(entry)} query={searchTerm} /></TableCell>
                                                    <TableCell>{formatPerConeNet(entry.requiredPerConeNetWeight)}</TableCell>
                                                </>
                                            )}
                                            <TableCell><HighlightMatch text={machineNameById.get(entry.machineId)} query={searchTerm} /></TableCell>
                                            <TableCell><HighlightMatch text={operatorNameById.get(entry.operatorId)} query={searchTerm} /></TableCell>
                                            <TableCell>
                                                <div className="space-y-0.5 leading-tight">
                                                    <div className="text-[11px] text-muted-foreground">O: {formatKg(entry.originalIssuedWeight || entry.issuedWeight)}</div>
                                                    <div className="text-[11px] text-amber-600">TB: {formatKg(entry.takeBackWeight || 0)}</div>
                                                    <div className="text-[11px] font-medium">N: {formatKg(entry.netIssuedWeight ?? entry.issuedWeight)}</div>
                                                </div>
                                            </TableCell>
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
                                            <TableCell className="font-mono text-xs"><HighlightMatch text={entry.barcode || entry.id.substring(0, 8)} query={searchTerm} /></TableCell>
                                            <TableCell>
                                                <ActionMenu actions={getActions(entry)} />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="hidden sm:flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <span className="text-sm font-semibold">Grand Total (filtered)</span>
                <div className="flex flex-wrap items-center justify-end gap-4 text-xs sm:text-sm">
                    {process === 'coning' && (
                        <span className="font-medium">Rolls Issued: {totals.rollsIssued || 0}</span>
                    )}
                    <span className="font-medium">Issued (Original): {formatKg(totals.originalIssuedWeight)}</span>
                    <span className="font-medium text-amber-600">Taken Back: {formatKg(totals.takeBackWeight)}</span>
                    <span className="font-medium">Net Issued: {formatKg(totals.netIssuedWeight)}</span>
                    <span className="font-medium text-green-600">Received: {formatKg(totals.receivedWeight)}</span>
                    <span className="font-medium text-blue-600">Pending: {formatKg(totals.pendingWeight)}</span>
                </div>
            </div>

            {/* Mobile Card View - shown on small screens only */}
            <div className="block sm:hidden space-y-3">
                {filteredEntries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
                        No pending entries on machine for {process}.
                    </div>
                ) : (
                    filteredEntries.map((entry) => {
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
                                            { label: 'Machine', value: <HighlightMatch text={machineNameById.get(entry.machineId)} query={searchTerm} /> },
                                            { label: 'Operator', value: <HighlightMatch text={operatorNameById.get(entry.operatorId)} query={searchTerm} /> },
                                            { label: 'Cut', value: <HighlightMatch text={resolvedNames.cutName} query={searchTerm} /> },
                                            ...(process !== 'cutter' ? [
                                                { label: 'Yarn', value: <HighlightMatch text={resolvedNames.yarnName} query={searchTerm} /> },
                                                { label: 'Twist', value: <HighlightMatch text={resolvedNames.twistName} query={searchTerm} /> },
                                            ] : []),
                                            ...(process === 'coning'
                                                ? [
                                                    { label: 'Rolls', value: String(entry.rollsIssued || 0) },
                                                    { label: 'Cone Type', value: <HighlightMatch text={resolveConingConeTypeName(entry)} query={searchTerm} /> },
                                                    { label: 'Per Cone', value: formatPerConeNet(entry.requiredPerConeNetWeight) },
                                                ]
                                                : []),
                                            { label: 'Barcode', value: <HighlightMatch text={entry.barcode || entry.id?.substring?.(0, 8) || '—'} query={searchTerm} />, mono: true },
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
                                    <div className="flex flex-col gap-0.5 text-xs">
                                        <span className="text-muted-foreground">Orig: {formatKg(entry.originalIssuedWeight || entry.issuedWeight)}</span>
                                        <span className="text-amber-600">Taken Back: {formatKg(entry.takeBackWeight || 0)}</span>
                                        <span className="text-muted-foreground">Net: {formatKg(entry.netIssuedWeight ?? entry.issuedWeight)}</span>
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

            <Dialog open={takeBackModalOpen} onOpenChange={setTakeBackModalOpen}>
                <DialogContent
                    title={`Take Back${takeBackTarget?.barcode ? ` • ${takeBackTarget.barcode}` : ''}`}
                    onOpenChange={setTakeBackModalOpen}
                    className="max-w-5xl"
                >
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label className="text-sm font-medium">Date</label>
                                <input
                                    type="date"
                                    value={takeBackDate}
                                    onChange={(e) => setTakeBackDate(e.target.value)}
                                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-sm font-medium">Reason</label>
                                <input
                                    type="text"
                                    value={takeBackReason}
                                    onChange={(e) => setTakeBackReason(e.target.value)}
                                    placeholder="Required"
                                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Note</label>
                            <input
                                type="text"
                                value={takeBackNote}
                                onChange={(e) => setTakeBackNote(e.target.value)}
                                placeholder="Optional"
                                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                            />
                        </div>
                        <div className="rounded-md border overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Source</TableHead>
                                        {process === 'holo' && <TableHead>Piece Type</TableHead>}
                                        {process !== 'cutter' && <TableHead className="text-right">Count</TableHead>}
                                        {process === 'holo' && <TableHead>Box</TableHead>}
                                        {process === 'holo' && <TableHead className="text-right">Gross (kg)</TableHead>}
                                        <TableHead className="text-right">Weight (kg)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {takeBackLinesDraft.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={process === 'cutter' ? 2 : (process === 'holo' ? 6 : 3)} className="text-center py-6 text-muted-foreground">
                                                No take-back eligible lines.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        takeBackLinesDraft.map((line, idx) => (
                                                <TableRow key={line.sourceId}>
                                                    <TableCell className="font-mono text-xs align-middle whitespace-nowrap">{line.sourceBarcode || line.sourceId}</TableCell>
                                                    {process === 'holo' && (
                                                        <TableCell className="text-xs align-middle whitespace-nowrap">
                                                            <div>{line.pieceTypeName || '—'}</div>
                                                        </TableCell>
                                                    )}
                                                    {process !== 'cutter' && (
                                                        <TableCell className="text-right align-middle">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={line.maxCount || 0}
                                                                value={line.count}
                                                                onChange={(e) => {
                                                                    const raw = Number(e.target.value || 0);
                                                                    const maxCount = Math.max(0, Number(line.maxCount || 0));
                                                                    const nextCount = Math.max(0, Math.min(maxCount, Number.isFinite(raw) ? raw : 0));
                                                                    setTakeBackLinesDraft((prev) => prev.map((l, i) => {
                                                                        if (i !== idx) return l;
                                                                        const nextWeight = process === 'holo'
                                                                            ? calcHoloTakeBackNetWeight(l, nextCount, l.grossWeight, l.boxId)
                                                                            : calcAutoTakeBackWeight(l, nextCount);
                                                                        return {
                                                                            ...l,
                                                                            count: nextCount,
                                                                            weight: nextWeight,
                                                                        };
                                                                    }));
                                                                }}
                                                                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-xs"
                                                            />
                                                        </TableCell>
                                                    )}
                                                    {process === 'holo' && (
                                                        <TableCell className="align-middle">
                                                            <select
                                                                value={line.boxId || ''}
                                                                onChange={(e) => {
                                                                    const nextBoxId = String(e.target.value || '');
                                                                    setTakeBackLinesDraft((prev) => prev.map((l, i) => {
                                                                        if (i !== idx) return l;
                                                                        return {
                                                                            ...l,
                                                                            boxId: nextBoxId,
                                                                            weight: calcHoloTakeBackNetWeight(l, l.count, l.grossWeight, nextBoxId),
                                                                        };
                                                                    }));
                                                                }}
                                                                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
                                                            >
                                                                <option value="">Select Box</option>
                                                                {(db.boxes || []).map((box) => (
                                                                    <option key={box.id} value={box.id}>{box.name}</option>
                                                                ))}
                                                            </select>
                                                        </TableCell>
                                                    )}
                                                    {process === 'holo' && (
                                                        <TableCell className="text-right align-middle">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step="0.001"
                                                                value={line.grossWeight || ''}
                                                                onChange={(e) => {
                                                                    const raw = Number(e.target.value || 0);
                                                                    const grossWeight = roundTakeBackWeight(Math.max(0, Number.isFinite(raw) ? raw : 0));
                                                                    setTakeBackLinesDraft((prev) => prev.map((l, i) => {
                                                                        if (i !== idx) return l;
                                                                        return {
                                                                            ...l,
                                                                            grossWeight,
                                                                            weight: calcHoloTakeBackNetWeight(l, l.count, grossWeight, l.boxId),
                                                                        };
                                                                    }));
                                                                }}
                                                                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs"
                                                            />
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="text-right align-middle">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step="0.001"
                                                            max={line.maxWeight || 0}
                                                            value={line.weight}
                                                            onChange={(e) => {
                                                                const raw = Number(e.target.value || 0);
                                                                const maxWeight = Math.max(0, Number(line.maxWeight || 0));
                                                                const value = roundTakeBackWeight(Math.max(0, Math.min(maxWeight, Number.isFinite(raw) ? raw : 0)));
                                                                setTakeBackLinesDraft((prev) => prev.map((l, i) => i === idx ? { ...l, weight: value } : l));
                                                            }}
                                                            className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs"
                                                            readOnly={process === 'holo'}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                className="h-9 px-3 rounded-md border text-sm"
                                onClick={() => setTakeBackModalOpen(false)}
                                disabled={takeBackSaving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                                onClick={submitTakeBack}
                                disabled={takeBackSaving}
                            >
                                {takeBackSaving ? 'Saving...' : 'Create Take Back'}
                            </button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
