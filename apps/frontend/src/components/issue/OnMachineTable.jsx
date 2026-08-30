import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu, Button } from '../ui';
import { ArrowRight, Download, Info, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { exportHistoryToExcel } from '../../services';
import { KeyValueGrid } from '../common/KeyValueGrid';
import { SheetColumnFilter } from '../common/SheetColumnFilters';
import { HighlightMatch } from '../common/HighlightMatch';
import { CellText, ListState, SortToggle, TableResultCount, TableStateRow } from '../data-table';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Dialog, DialogContent } from '../ui/Dialog';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../../context/InventoryContext';
import { useV2CursorList } from '../../hooks/useV2CursorList';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import * as api from '../../api';
import * as v2 from '../../api/v2';
import { InfoPopover } from '../common/InfoPopover';

function OnDemandInfoPopover({
    title,
    items = [],
    isLoading = false,
    error = '',
    onOpen,
    renderContent,
    footerText = '',
    emptyText = 'No items.',
    widthClassName = 'w-64',
    bodyClassName = 'max-h-[200px] overflow-y-auto text-sm',
    buttonClassName = 'h-6 w-6 rounded-full hover:bg-muted',
    align = 'left',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handlePointerDown = (event) => {
            if (!popoverRef.current?.contains(event.target)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isOpen]);

    const toggle = () => {
        const nextOpen = !isOpen;
        setIsOpen(nextOpen);
        if (nextOpen) onOpen?.();
    };

    return (
        <div className="relative inline-block" ref={popoverRef}>
            <Button
                variant="ghost"
                size="icon"
                className={buttonClassName}
                onClick={(event) => {
                    event.stopPropagation();
                    toggle();
                }}
            >
                <Info className="h-4 w-4 text-primary" />
            </Button>
            {isOpen && (
                <div
                    className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-2 z-50 ${widthClassName} rounded-md border bg-popover p-4 text-popover-foreground shadow-md`}
                    onClick={(event) => event.stopPropagation()}
                >
                    <h4 className="mb-2 font-medium leading-none">{title}</h4>
                    <div className={bodyClassName}>
                        {isLoading ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading details…
                            </div>
                        ) : error ? (
                            <div className="text-destructive">{error}</div>
                        ) : items.length === 0 ? (
                            <div className="text-muted-foreground">{emptyText}</div>
                        ) : (
                            renderContent(items)
                        )}
                    </div>
                    {footerText && !isLoading && !error ? (
                        <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">{footerText}</div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

/**
 * OnMachineTable - Displays work-in-progress entries (issued but not fully received)
 * 
 * Logic: An entry is "on machine" if:
 *   pendingWeight = issuedWeight - (receivedNetWeight + wastageNetWeight) > 0
 */
export function OnMachineTable({ db, process }) {
    const navigate = useNavigate();
    const { createIssueTakeBack, reverseIssueTakeBack, subscribeInvalidation } = useInventory();
    const [searchTerm, setSearchTerm] = useState('');
    // Debounced copy for server queries so each keystroke doesn't reset the list.
    const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
    const [sortOrder, setSortOrder] = useState('desc');
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
    const [actionLoadingId, setActionLoadingId] = useState(null);
    const [receivedDetailsByIssue, setReceivedDetailsByIssue] = useState({});
    const [receivedDetailsTruncated, setReceivedDetailsTruncated] = useState({});
    const [receivedDetailsLoading, setReceivedDetailsLoading] = useState({});
    const [receivedDetailsError, setReceivedDetailsError] = useState({});
    const actionBusyRef = useRef(false);
    const issueActionCacheRef = useRef(new Map());
    const issueDetailInflightRef = useRef(new Map());
    const scrollRootRef = useRef(null);
    const boxById = useMemo(() => {
        const map = new Map();
        (db.boxes || []).forEach((box) => {
            const id = String(box?.id || '').trim();
            if (!id) return;
            map.set(id, box);
        });
        return map;
    }, [db.boxes]);
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
    const calcConingTakeBackNetWeight = (line, nextCount, grossWeightInput, nextBoxId) => {
        const count = Math.max(0, Number(nextCount || 0));
        const gross = Number(grossWeightInput || 0);
        if (!Number.isFinite(gross) || gross <= 0 || count <= 0) return 0;
        const boxWeight = Number(boxById.get(nextBoxId)?.weight || 0);
        if (!Number.isFinite(boxWeight) || boxWeight < 0) return 0;
        const rollUnitWeight = Number(line?.rollUnitWeight || 0);
        if (!Number.isFinite(rollUnitWeight) || rollUnitWeight <= 0) return 0;
        const tareWeight = boxWeight + (rollUnitWeight * count);
        const net = gross - tareWeight;
        const maxWeight = Math.max(0, Number(line?.maxWeight || 0));
        return roundTakeBackWeight(Math.max(0, Math.min(maxWeight, net)));
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

    const pickName = (primary, fallback) => {
        const primaryClean = String(primary || '').trim();
        if (primaryClean && primaryClean !== '—') return primaryClean;
        const fallbackClean = String(fallback || '').trim();
        return fallbackClean || '—';
    };

    const resolveEntryNames = (entry) => {
        if (!entry) return { cutName: '—', yarnName: '—', twistName: '—' };

        // The API sends already-resolved display fields. Avoid any DB lookups that can
        // "fill in later" (causes flicker) and can be expensive during scroll.
        return {
            cutName: pickName(entry.cutName, ''),
            yarnName: pickName(entry.yarnName, ''),
            twistName: pickName(entry.twistName, ''),
        };
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

    const resolveTakeBackSourceLabel = (stage, sourceId, fallback = '') => {
        if (stage === 'cutter') {
            return inboundBarcodeById.get(sourceId) || fallback || sourceId;
        }
        return fallback || sourceId;
    };

    const receiveRowsByIssue = useMemo(() => {
        const map = new Map();
        // Cutter still owns a process snapshot. Holo and Coning receive details are
        // loaded issue-by-issue when the user opens the details control.
        const collection = process === 'cutter' ? (db.receive_from_cutter_machine_rows || []) : [];

        collection.forEach(r => {
            if (r.isDeleted || !r.issueId) return;
            const arr = map.get(r.issueId) || [];
            arr.push(r);
            map.set(r.issueId, arr);
        });
        return map;
    }, [db, process]);

    const renderReceivedPopoverContent = useCallback((items, stage) => {
        if (!items || items.length === 0) return null;

        const totals = items.reduce((acc, row) => {
            const netWt = Number(row.netWt || row.netWeight || row.rollWeight || 0);
            const count = stage === 'coning' ? (Number(row.coneCount) || 0) :
                (stage === 'cutter' ? (Number(row.bobbinQuantity) || 0) :
                    (Number(row.rollCount) || 0));
            return {
                wt: acc.wt + netWt,
                count: acc.count + count
            };
        }, { wt: 0, count: 0 });

        return (
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b">
                        <th className="text-left py-1 px-1 font-medium">Barcode</th>
                        <th className="text-left py-1 px-1 font-medium">Date</th>
                        {stage === 'coning' ? (
                            <th className="text-right py-1 px-1 font-medium">Cones</th>
                        ) : (
                            <th className="text-right py-1 px-1 font-medium">{stage === 'cutter' ? 'Bobbins' : 'Rolls'}</th>
                        )}
                        <th className="text-right py-1 px-1 font-medium">Net Wt</th>
                        <th className="text-left py-1 px-1 font-medium">{stage === 'coning' ? 'Box' : 'Cut'}</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((row, idx) => {
                        const netWt = Number(row.netWt || row.netWeight || row.rollWeight || 0);
                        const count = stage === 'coning' ? (row.coneCount || 0) : (stage === 'cutter' ? (row.bobbinQuantity || 0) : (row.rollCount || 0));
                        const displayCut = row.cutMaster?.name || (typeof row.cut === 'string' ? row.cut : row.cut?.name) || db.cuts?.find(c => c.id === row.cutId)?.name || '—';
                        const displayBox = row.box?.name || db.boxes?.find(b => b.id === row.boxId)?.name || '—';

                        return (
                            <tr key={row.id || idx} className="border-b last:border-0">
                                <td className="py-1 px-1 font-mono">{row.barcode || '—'}</td>
                                <td className="py-1 px-1 text-muted-foreground">{formatDateDDMMYYYY(row.date || row.createdAt) || '—'}</td>
                                <td className="py-1 px-1 text-right">{count}</td>
                                <td className="py-1 px-1 text-right font-medium">{formatKg(netWt)}</td>
                                <td className="py-1 px-1 text-muted-foreground truncate max-w-[80px]">
                                    {stage === 'coning' ? displayBox : displayCut}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr className="border-t-2 bg-muted/50 font-semibold">
                        <td className="py-1 px-1" colSpan={2}>Total</td>
                        <td className="py-1 px-1 text-right">{totals.count}</td>
                        <td className="py-1 px-1 text-right">{formatKg(totals.wt)}</td>
                        <td className="py-1 px-1"></td>
                    </tr>
                </tfoot>
            </table>
        );
    }, [db.cuts, db.boxes]);

    const getIssueDetailCacheKey = (entry) => `${process}:${entry?.id || entry?.barcode || ''}`;

    const loadIssueDetail = async (entry, { force = false } = {}) => {
        if (!entry) throw new Error('Issue details are unavailable');
        if (process === 'cutter') return entry;

        const key = getIssueDetailCacheKey(entry);
        const cached = issueActionCacheRef.current.get(key);
        if (!force && cached?.detail) return cached.detail;
        if (!force && issueDetailInflightRef.current.has(key)) {
            return await issueDetailInflightRef.current.get(key);
        }
        if (!entry.barcode) throw new Error('Issue barcode is missing');

        const pending = (process === 'holo'
            ? api.getIssueByHoloBarcode(entry.barcode)
            : api.getIssueByConingBarcode(entry.barcode))
            .then((detail) => {
                issueActionCacheRef.current.set(key, { ...(issueActionCacheRef.current.get(key) || {}), detail });
                return detail;
            })
            .finally(() => issueDetailInflightRef.current.delete(key));
        issueDetailInflightRef.current.set(key, pending);
        return await pending;
    };

    const loadIssueActionBundle = async (entry, { force = false } = {}) => {
        if (process === 'cutter') {
            return {
                detail: entry,
                takeBacks: activeTakeBacksByIssue.get(entry.id) || [],
            };
        }

        const key = getIssueDetailCacheKey(entry);
        const cached = issueActionCacheRef.current.get(key);
        if (!force && cached?.detail && Array.isArray(cached?.takeBacks)) return cached;

        const [detail, takeBackResponse] = await Promise.all([
            loadIssueDetail(entry, { force }),
            api.getIssueTakeBacks({ stage: process, issueId: entry.id }),
        ]);
        const takeBacks = Array.isArray(takeBackResponse?.issue_take_backs)
            ? takeBackResponse.issue_take_backs
            : [];
        const next = { ...(issueActionCacheRef.current.get(key) || {}), detail, takeBacks };
        issueActionCacheRef.current.set(key, next);
        return next;
    };

    const clearIssueActionCache = (issueId) => {
        const key = `${process}:${issueId}`;
        issueActionCacheRef.current.delete(key);
        issueDetailInflightRef.current.delete(key);
        setReceivedDetailsByIssue((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, issueId)) return prev;
            const next = { ...prev };
            delete next[issueId];
            return next;
        });
        setReceivedDetailsTruncated((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, issueId)) return prev;
            const next = { ...prev };
            delete next[issueId];
            return next;
        });
    };

    const loadReceivedDetails = async (entry) => {
        if (!entry || process === 'cutter') return;
        if (Object.prototype.hasOwnProperty.call(receivedDetailsByIssue, entry.id)) return;

        setReceivedDetailsLoading((prev) => ({ ...prev, [entry.id]: true }));
        setReceivedDetailsError((prev) => ({ ...prev, [entry.id]: '' }));
        try {
            const detail = await loadIssueDetail(entry);
            let receives = Array.isArray(detail?.receives) ? detail.receives : null;
            let truncated = Boolean(detail?.receivesTruncated);
            if (!receives) {
                const response = await v2.getV2ReceiveHistory(process, {
                    issueId: entry.id,
                    limit: 200,
                    order: 'desc',
                });
                receives = Array.isArray(response?.items) ? response.items : [];
                truncated = Boolean(response?.hasMore);
            }
            if (process === 'holo') {
                const cutName = detail?.cutName || detail?.trace?.cutName || '';
                receives = receives.map((row) => ({ ...row, cut: row?.cut || cutName }));
            }
            setReceivedDetailsByIssue((prev) => ({ ...prev, [entry.id]: receives }));
            setReceivedDetailsTruncated((prev) => ({ ...prev, [entry.id]: truncated }));
        } catch (err) {
            setReceivedDetailsError((prev) => ({
                ...prev,
                [entry.id]: err?.message || 'Failed to load received details',
            }));
        } finally {
            setReceivedDetailsLoading((prev) => ({ ...prev, [entry.id]: false }));
        }
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

    const buildTakeBackSources = (entry, actionBundle = null) => {
        if (!entry) return [];

        const EPSILON = 1e-9;
        const clampZero = (v) => {
            const n = Number(v || 0);
            if (!Number.isFinite(n)) return 0;
            return n > EPSILON ? n : 0;
        };

        const activeTakeBacks = Array.isArray(actionBundle?.takeBacks)
            ? actionBundle.takeBacks.filter((tb) => !tb?.isReverse && !tb?.isReversed)
            : (activeTakeBacksByIssue.get(entry.id) || []);
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
                Number(entry?.pendingWeight ?? Number.POSITIVE_INFINITY),
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

        const detail = actionBundle?.detail || entry;
        let refs = detail?.receivedRowRefs ?? entry.receivedRowRefs;
        if (typeof refs === 'string') {
            try { refs = JSON.parse(refs || '[]'); } catch { refs = []; }
        }
        const refRows = Array.isArray(refs) ? refs : [];
        const detailSources = Array.isArray(detail?.sources)
            ? detail.sources
            : (Array.isArray(detail?.crates) ? detail.crates : []);
        const detailSourceById = new Map();
        detailSources.forEach((source) => {
            const sourceId = String(source?.rowId || source?.id || '').trim();
            if (sourceId) detailSourceById.set(sourceId, source);
        });
        const sourceMap = new Map();
        refRows.forEach((ref) => {
            const sourceId = typeof ref?.rowId === 'string' ? ref.rowId.trim() : '';
            if (!sourceId) return;
            const source = detailSourceById.get(sourceId) || {};
            const originalCount = process === 'holo'
                ? Number(ref?.issuedBobbins ?? source?.issuedBobbins ?? 0)
                : Number(ref?.issueRolls ?? source?.issueRolls ?? 0);
            const originalWeight = process === 'holo'
                ? Number(ref?.issuedBobbinWeight ?? source?.issuedBobbinWeight ?? 0)
                : Number(ref?.issueWeight ?? source?.issueWeight ?? 0);
            const active = activeBySource.get(sourceId) || { count: 0, weight: 0 };
            const maxCount = Math.max(0, originalCount - Number(active.count || 0));
            const maxWeight = Math.max(0, originalWeight - Number(active.weight || 0));
            if (maxWeight <= 0.0001) return;
            const sourceBoxId = String(source?.sourceBoxId || source?.boxId || source?.box?.id || '').trim();
            const sourceBoxWeight = Number(source?.sourceBoxWeight ?? source?.boxWeight ?? source?.box?.weight ?? boxById.get(sourceBoxId)?.weight ?? 0);
            const rollCount = process === 'coning' ? Number(source?.rollCount ?? source?.coneCount ?? 0) : 0;
            const tareWeight = process === 'coning' ? Number(source?.tareWeight ?? source?.tareWt ?? 0) : 0;
            const derivedRollUnitWeight = (process === 'coning' && rollCount > 0 && Number.isFinite(tareWeight))
                ? Math.max(0, (tareWeight - sourceBoxWeight) / rollCount)
                : 0;
            sourceMap.set(sourceId, {
                sourceId,
                label: String(source?.barcode || source?.vchNo || ref?.barcode || sourceId),
                maxCount,
                maxWeight,
                sourceBoxId,
                pieceTypeId: process === 'holo' ? String(source?.bobbinId || source?.bobbin?.id || '').trim() : '',
                pieceTypeName: process === 'holo' ? (source?.bobbinName || source?.bobbin?.name || '—') : '',
                pieceUnitWeight: process === 'holo'
                    ? Number(source?.bobbinWeight ?? source?.bobbin?.weight ?? 0)
                    : 0,
                rollUnitWeight: process === 'coning'
                    ? Number(source?.rollTypeWeight ?? source?.rollType?.weight ?? derivedRollUnitWeight ?? 0)
                    : 0,
            });
        });

        if (process === 'coning') {
            const updated = [];
            for (const line of sourceMap.values()) {
                const issuedWeight = clampZero(Number(line.maxWeight || 0));
                // maxWeight here is already: original issued − active take-backs (built in sourceMap above)
                // No FIFO consumed deduction — user selects source freely; pool is enforced at issue level
                updated.push({
                    ...line,
                    issuedWeight,
                    maxWeight: issuedWeight,
                    maxCount: clampZero(Number(line.maxCount || 0)),
                });
            }
            // Filter out sources that are fully taken back (no remaining issued allocation)
            return updated.filter((s) => s.maxWeight > 0.0001);
        }

        return Array.from(sourceMap.values());
    };

    const showTakeBackModal = (entry, sources) => {
        setTakeBackTarget(entry);
        setTakeBackDate(new Date().toISOString().slice(0, 10));
        setTakeBackReason('');
        setTakeBackNote('');
        setTakeBackLinesDraft(
            sources.map((line) => {
                const count = (process === 'cutter' || process === 'coning') ? 0 : line.maxCount;
                const boxId = (process === 'holo' || process === 'coning') ? (line.sourceBoxId || '') : '';
                const tareEstimate = process === 'holo'
                    ? ((Number(line.pieceUnitWeight || 0) * Number(count || 0)) + Number(boxById.get(boxId)?.weight || 0))
                    : (process === 'coning'
                        ? (Number(boxById.get(boxId)?.weight || 0) + (Number(line.rollUnitWeight || 0) * Number(count || 0)))
                        : 0);
                const grossWeight = process === 'holo'
                    ? roundTakeBackWeight(Number(line.maxWeight || 0) + tareEstimate)
                    : 0;
                const weight = process === 'holo'
                    ? calcHoloTakeBackNetWeight(line, count, grossWeight, boxId)
                    : (process === 'coning'
                        ? calcConingTakeBackNetWeight(line, count, grossWeight, boxId)
                        : (process === 'cutter' ? line.maxWeight : calcAutoTakeBackWeight(line, count)));
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
                    rollUnitWeight: Number(line.rollUnitWeight || 0),
                };
            }),
        );
        setTakeBackModalOpen(true);
    };

    const openTakeBackModal = async (entry) => {
        if (!entry || actionBusyRef.current) return;
        actionBusyRef.current = true;
        setActionLoadingId(entry.id);
        try {
            const actionBundle = await loadIssueActionBundle(entry);
            const sources = buildTakeBackSources(entry, actionBundle);
            if (sources.length === 0) {
                alert('No take-back-eligible lines available.');
                return;
            }
            showTakeBackModal(entry, sources);
        } catch (err) {
            alert(err?.message || 'Failed to load take-back details');
        } finally {
            actionBusyRef.current = false;
            setActionLoadingId(null);
        }
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
        if (process === 'holo' || process === 'coning') {
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
            if (process === 'coning') {
                const invalidRollWeight = (takeBackLinesDraft || []).find((line) => Number(line.count || 0) > 0 && Number(line.rollUnitWeight || 0) <= 0);
                if (invalidRollWeight) {
                    alert(`Roll tare weight missing for source ${invalidRollWeight.sourceBarcode || invalidRollWeight.sourceId}`);
                    return;
                }
            }
            const exceedsMax = (takeBackLinesDraft || []).find((line) => Number(line.count || 0) > 0 && Number(line.weight || 0) - Number(line.maxWeight || 0) > 0.001);
            if (exceedsMax) {
                alert(`Net weight exceeds max for source ${exceedsMax.sourceBarcode || exceedsMax.sourceId}`);
                return;
            }
        }
        if (process === 'coning') {
            const totalLinesWeight = lines.reduce((sum, l) => sum + l.weight, 0);
            const pending = Number(takeBackTarget.pendingWeight || 0);
            if (totalLinesWeight - pending > 0.001) {
                alert(`Total take-back weight (${formatKg(totalLinesWeight)}) exceeds issue pending weight (${formatKg(pending)})`);
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
            clearIssueActionCache(takeBackTarget.id);
            setTakeBackModalOpen(false);
        } catch (err) {
            alert(err.message || 'Failed to create take-back');
        } finally {
            setTakeBackSaving(false);
        }
    };

    const handleReverseLatestTakeBack = async (entry) => {
        if (!entry || actionBusyRef.current) return;
        actionBusyRef.current = true;
        setActionLoadingId(entry.id);
        try {
            const actionBundle = await loadIssueActionBundle(entry);
            const exactTakeBacks = Array.isArray(actionBundle?.takeBacks)
                ? actionBundle.takeBacks
                : [];
            const latest = process === 'cutter'
                ? latestReversibleTakeBackByIssue.get(entry.id)
                : exactTakeBacks.find((takeBack) => !takeBack?.isReverse && !takeBack?.isReversed);
            if (!latest) {
                alert('No reversible take-back found for this issue');
                return;
            }
            const confirmed = window.confirm('Reverse the latest take-back for this issue?');
            if (!confirmed) return;
            await reverseIssueTakeBack(latest.id, {
                date: new Date().toISOString().slice(0, 10),
                reason: 'reverse',
                note: 'Reversed from On Machine',
                stage: process,
            });
            clearIssueActionCache(entry.id);
        } catch (err) {
            alert(err.message || 'Failed to reverse take-back');
        } finally {
            actionBusyRef.current = false;
            setActionLoadingId(null);
        }
    };

    const filterColumns = useMemo(() => {
        const common = [
            { id: 'date', label: 'Date', kind: 'date', getValue: (r) => r.date || r.createdAt || '' },
            { id: 'shift', label: 'Shift', kind: 'values', getValue: (r) => r.shift || '' },
            { id: 'item', label: 'Item', kind: 'values', getValue: (r) => r.itemName || itemNameById.get(r.itemId) || '' },
            { id: 'piece', label: 'Piece', kind: 'text', getValue: (r) => (Array.isArray(r.pieceIdsList) ? r.pieceIdsList.join(', ') : (r.pieceIds || '')) },
            { id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => (resolveEntryNames(r).cutName || '') },
            ...(process !== 'cutter' ? [
                { id: 'yarn', label: 'Yarn', kind: 'values', getValue: (r) => (resolveEntryNames(r).yarnName || '') },
                { id: 'twist', label: 'Twist', kind: 'values', getValue: (r) => (resolveEntryNames(r).twistName || '') },
            ] : []),
            { id: 'machine', label: 'Machine', kind: 'values', getValue: (r) => r.machineName || machineNameById.get(r.machineId) || '' },
            { id: 'operator', label: 'Operator', kind: 'values', getValue: (r) => r.operatorName || operatorNameById.get(r.operatorId) || '' },
            { id: 'issuedWeight', label: 'Net Issued (kg)', kind: 'number', getValue: (r) => r.issuedWeight },
            { id: 'receivedWeight', label: 'Received (kg)', kind: 'number', getValue: (r) => r.receivedWeight },
            { id: 'pendingWeight', label: 'Pending (kg)', kind: 'number', getValue: (r) => r.pendingWeight },
            { id: 'barcode', label: 'Barcode', kind: 'text', getValue: (r) => r.barcode || '' },
        ];
        if (process === 'coning') {
            return [
                ...common.slice(0, 6),
                { id: 'rollsIssued', label: 'Rolls Issued', kind: 'number', getValue: (r) => r.rollsIssued || 0 },
                { id: 'coneType', label: 'Cone Type', kind: 'values', getValue: (r) => r.coneTypeName || resolveConingConeTypeName(r) || '' },
                { id: 'perCone', label: 'Per Cone (g)', kind: 'number', getValue: (r) => (r.perConeTargetG ?? r.requiredPerConeNetWeight ?? 0) },
                ...common.slice(6),
            ];
        }
        return common;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [process, itemNameById, machineNameById, operatorNameById]);

    const v2DateFilter = sheetFilters?.date && sheetFilters.date.kind === 'date' ? sheetFilters.date : null;
    const v2DateFrom = v2DateFilter?.from || '';
    const v2DateTo = v2DateFilter?.to || '';
    const v2Filters = useMemo(() => {
        const out = [];
        for (const [field, f] of Object.entries(sheetFilters || {})) {
            if (!f || field === 'date') continue;
            if (f.kind === 'values') {
                const values = Array.isArray(f.selected) ? f.selected.map(String) : [];
                out.push({ field, op: 'in', values: values.length ? values : ['__NO_MATCH__'] });
            } else if (f.kind === 'text') {
                const value = String(f.query || '').trim();
                if (value) out.push({ field, op: 'contains', value });
            } else if (f.kind === 'number') {
                const min = f.min === '' || f.min == null ? null : Number(f.min);
                const max = f.max === '' || f.max == null ? null : Number(f.max);
                if (min != null || max != null) out.push({ field, op: 'between', min, max });
            }
        }
        return out;
    }, [sheetFilters]);

    const v2List = useV2CursorList({
        enabled: true,
        scopeKey: `on-machine:${process}`,
        fetchPage: ({ limit, cursor, search, dateFrom, dateTo, filters, order }) => (
            v2.getV2OnMachine(process, {
                limit,
                cursor,
                search,
                dateFrom,
                dateTo,
                filters: JSON.stringify(filters || []),
                order,
            })
        ),
        limit: 50,
        search: debouncedSearchTerm,
        dateFrom: v2DateFrom,
        dateTo: v2DateTo,
        filters: v2Filters,
        order: sortOrder,
    });

    useEffect(() => {
        const key = INVENTORY_INVALIDATION_KEYS.issueOnMachine(process);
        return subscribeInvalidation(key, () => {
            issueActionCacheRef.current.clear();
            issueDetailInflightRef.current.clear();
            setReceivedDetailsByIssue({});
            setReceivedDetailsTruncated({});
            setReceivedDetailsError({});
            v2List.refresh();
        });
    }, [process, subscribeInvalidation, v2List.refresh]);

    const filteredEntries = v2List.items;
    const filterRows = filteredEntries;

    const loadMoreRef = useInfiniteScrollSentinel({
        enabled: v2List.hasMore && !v2List.isLoading,
        onLoadMore: v2List.loadMore,
        rootRef: scrollRootRef,
    });

    // Server facets for the values-filter dropdowns. Without these the options were
    // built from loaded pages only, so values not on the first page couldn't be picked.
    const [v2FacetsById, setV2FacetsById] = useState({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await v2.getV2OnMachineFacets(process);
                if (!cancelled && res?.facets && typeof res.facets === 'object') {
                    setV2FacetsById(res.facets);
                }
            } catch (_) {
                // Ignore facet failures; the dropdown falls back to loaded-row values.
            }
        })();
        return () => { cancelled = true; };
    }, [process]);

    const columnFor = (id) => {
        const col = filterColumns.find(c => c.id === id);
        if (!col) return col;
        if (col.kind !== 'values') return col;
        const facetOptions = v2FacetsById?.[id];
        return Array.isArray(facetOptions) && facetOptions.length > 0 ? { ...col, facetOptions } : col;
    };

    const totals = useMemo(() => {
        // Prefer the server-computed summary (covers ALL records, not just loaded pages).
        if (v2List.summary) {
            return {
                originalIssuedWeight: Number(v2List.summary.originalIssuedWeight || 0),
                takeBackWeight: Number(v2List.summary.takeBackWeight || 0),
                netIssuedWeight: Number(v2List.summary.netIssuedWeight || 0),
                issuedWeight: Number(v2List.summary.netIssuedWeight || 0),
                receivedWeight: Number(v2List.summary.receivedWeight || 0),
                pendingWeight: Number(v2List.summary.pendingWeight || 0),
                rollsIssued: Number(v2List.summary.rollsIssued || 0),
            };
        }
        // Legacy / fallback: sum from loaded rows
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
    }, [filteredEntries, process, v2List.summary]);

    const handleGoToReceive = (entry) => {
        // Navigate to receive page with barcode param for auto-scan
        navigate(`/app/receive?barcode=${encodeURIComponent(entry.barcode)}`);
    };

    const getActions = (entry) => {
        const isHydrating = Boolean(actionLoadingId);
        const isHydratingThisRow = actionLoadingId === entry.id;
        const canTakeBack = process === 'cutter'
            ? buildTakeBackSources(entry).length > 0
            : Number(entry.pendingWeight || 0) > 0.001;
        const canReverse = process === 'cutter'
            ? (activeTakeBacksByIssue.get(entry.id) || []).length > 0
            : Number(entry.takeBackWeight || 0) > 0.001;
        return [
            {
                label: 'Go to Receive',
                icon: <ArrowRight className="w-4 h-4" />,
                onClick: () => handleGoToReceive(entry),
            },
            {
                label: 'Take Back',
                icon: isHydratingThisRow ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />,
                onClick: () => openTakeBackModal(entry),
                disabled: !canTakeBack || isHydrating,
                disabledReason: isHydrating ? 'Loading exact issue details.' : 'No pending weight is available to take back.',
            },
            {
                label: 'Reverse Last Take Back',
                icon: <RotateCcw className="w-4 h-4" />,
                onClick: () => handleReverseLatestTakeBack(entry),
                disabled: !canReverse || isHydrating,
                disabledReason: isHydrating ? 'Loading exact take-back history.' : 'No active take-back found.',
            },
        ];
    };

    const renderReceivedDetailsControl = (entry, { mobile = false } = {}) => {
        const title = process === 'cutter'
            ? 'Received Crates'
            : (process === 'holo' ? 'Holo Receives' : 'Coning Receives');
        const commonProps = {
            title,
            emptyText: 'No items received yet.',
            widthClassName: mobile ? 'w-[320px]' : (process === 'coning' ? 'w-[560px]' : 'w-[420px]'),
            bodyClassName: 'max-h-[300px] overflow-y-auto',
            buttonClassName: 'h-5 w-5 rounded-full hover:bg-muted inline-flex',
            align: mobile ? 'left' : 'right',
        };

        if (process === 'cutter') {
            return (
                <InfoPopover
                    {...commonProps}
                    items={receiveRowsByIssue.get(entry.id) || []}
                    renderContent={(items) => renderReceivedPopoverContent(items, process)}
                    actionLabel="View Details"
                />
            );
        }

        return (
            <OnDemandInfoPopover
                {...commonProps}
                items={receivedDetailsByIssue[entry.id] || []}
                isLoading={Boolean(receivedDetailsLoading[entry.id])}
                error={receivedDetailsError[entry.id] || ''}
                onOpen={() => loadReceivedDetails(entry)}
                renderContent={(items) => renderReceivedPopoverContent(items, process)}
                footerText={receivedDetailsTruncated[entry.id] ? 'Showing the latest 200 receive rows for this issue.' : ''}
            />
        );
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

    const handleExport = async () => {
        // The list paginates, so the loaded rows are only a slice of the dataset.
        // Export must go through the server endpoint or the file is silently truncated.
        let sourceRows;
        try {
            const res = await v2.exportV2OnMachineJson(process, {
                search: debouncedSearchTerm,
                dateFrom: v2DateFrom,
                dateTo: v2DateTo,
                filters: JSON.stringify(v2Filters || []),
                order: sortOrder,
            });
            sourceRows = Array.isArray(res?.items) ? res.items : [];
        } catch (err) {
            alert(err?.message || 'Failed to export');
            return;
        }
        const exportData = sourceRows.map(entry => {
            const progressPercent = getProgressPercent(entry);
            const resolvedNames = resolveEntryNames(entry);
            const baseData = {
                date: formatDateDDMMYYYY(entry.date),
                shift: entry.shift || '—',
                lotOrPiece: (process === 'cutter' || process === 'holo' || process === 'coning')
                    ? resolvePieceDisplay(entry)
                    : (entry.lotNo || ''),
                itemName: entry.itemName || itemNameById.get(entry.itemId) || '—',
                machineName: entry.machineName || machineNameById.get(entry.machineId) || '—',
                operatorName: entry.operatorName || operatorNameById.get(entry.operatorId) || '—',
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
                    coneType: entry.coneTypeName || resolveConingConeTypeName(entry),
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
            { key: 'shift', header: 'Shift' },
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

    const emptyColSpan = process === 'cutter' ? 13 : process === 'holo' ? 15 : 18;

    // Shared pool constraint for coning take-back modal
    const issuePendingPool = process === 'coning'
        ? Math.max(0, Number(takeBackTarget?.pendingWeight || 0))
        : Infinity;
    const totalEnteredWeight = process === 'coning'
        ? (takeBackLinesDraft || []).reduce((sum, l) => sum + Math.max(0, Number(l.weight || 0)), 0)
        : 0;

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
                <TableResultCount
                    shown={filteredEntries.length}
                    total={v2List.summary?.totalCount}
                    isLoading={v2List.isLoading}
                    className="self-center"
                />
                <button
                    onClick={handleExport}
                    className="h-9 px-3 rounded-md border border-primary bg-primary text-primary-foreground text-xs hover:bg-primary/90 font-medium flex items-center gap-1"
                >
                    <Download className="w-4 h-4" />
                    Export
                </button>
            </div>

            <div ref={scrollRootRef} className="hidden sm:block rounded-md border max-h-[calc(100vh-280px)] overflow-y-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {process === 'cutter' && (
                                <>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <SortToggle label="Date" order={sortOrder} onToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} />
                                            <SheetColumnFilter column={columnFor('date')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Shift</span>
                                            <SheetColumnFilter column={columnFor('shift')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Item</span>
                                            <SheetColumnFilter column={columnFor('item')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Piece</span>
                                            <SheetColumnFilter column={columnFor('piece')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cut</span>
                                            <SheetColumnFilter column={columnFor('cut')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>

                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Machine</span>
                                            <SheetColumnFilter column={columnFor('machine')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Operator</span>
                                            <SheetColumnFilter column={columnFor('operator')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Issued (O/TB/N)</span>
                                            <SheetColumnFilter column={columnFor('issuedWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Received (kg)</span>
                                            <SheetColumnFilter column={columnFor('receivedWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Pending (kg)</span>
                                            <SheetColumnFilter column={columnFor('pendingWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Barcode</span>
                                            <SheetColumnFilter column={columnFor('barcode')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                            {process === 'holo' && (
                                <>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <SortToggle label="Date" order={sortOrder} onToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} />
                                            <SheetColumnFilter column={columnFor('date')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Shift</span>
                                            <SheetColumnFilter column={columnFor('shift')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Item</span>
                                            <SheetColumnFilter column={columnFor('item')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Piece</span>
                                            <SheetColumnFilter column={columnFor('piece')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cut</span>
                                            <SheetColumnFilter column={columnFor('cut')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Yarn</span>
                                            <SheetColumnFilter column={columnFor('yarn')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Twist</span>
                                            <SheetColumnFilter column={columnFor('twist')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Machine</span>
                                            <SheetColumnFilter column={columnFor('machine')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Operator</span>
                                            <SheetColumnFilter column={columnFor('operator')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Issued (O/TB/N)</span>
                                            <SheetColumnFilter column={columnFor('issuedWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Received (kg)</span>
                                            <SheetColumnFilter column={columnFor('receivedWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Pending (kg)</span>
                                            <SheetColumnFilter column={columnFor('pendingWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Barcode</span>
                                            <SheetColumnFilter column={columnFor('barcode')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                            {process === 'coning' && (
                                <>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <SortToggle label="Date" order={sortOrder} onToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} />
                                            <SheetColumnFilter column={columnFor('date')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Shift</span>
                                            <SheetColumnFilter column={columnFor('shift')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Item</span>
                                            <SheetColumnFilter column={columnFor('item')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Piece</span>
                                            <SheetColumnFilter column={columnFor('piece')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cut</span>
                                            <SheetColumnFilter column={columnFor('cut')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Yarn</span>
                                            <SheetColumnFilter column={columnFor('yarn')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Twist</span>
                                            <SheetColumnFilter column={columnFor('twist')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Rolls Issued</span>
                                            <SheetColumnFilter column={columnFor('rollsIssued')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Cone Type</span>
                                            <SheetColumnFilter column={columnFor('coneType')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="whitespace-nowrap">Per Cone (g)</span>
                                            <SheetColumnFilter column={columnFor('perCone')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Machine</span>
                                            <SheetColumnFilter column={columnFor('machine')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Operator</span>
                                            <SheetColumnFilter column={columnFor('operator')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Issued (O/TB/N)</span>
                                            <SheetColumnFilter column={columnFor('issuedWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Received (kg)</span>
                                            <SheetColumnFilter column={columnFor('receivedWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>Pending (kg)</span>
                                            <SheetColumnFilter column={columnFor('pendingWeight')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>Barcode</span>
                                            <SheetColumnFilter column={columnFor('barcode')} rows={filterRows} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[50px]">Actions</TableHead>
                                </>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredEntries.length === 0 ? (
                            <TableStateRow
                                colSpan={emptyColSpan}
                                isLoading={v2List.isLoading}
                                error={v2List.error}
                                onRetry={v2List.refresh}
                                emptyMessage={`No pending entries on machine for ${process}.`}
                            />
                        ) : (
                            <>
                                {filteredEntries.map((entry) => {
                                    const progressPercent = getProgressPercent(entry);
                                    const resolvedNames = resolveEntryNames(entry);
                                    const itemDisplay = entry.itemName || itemNameById.get(entry.itemId) || '—';
                                    const machineDisplay = entry.machineName || machineNameById.get(entry.machineId) || '—';
                                    const operatorDisplay = entry.operatorName || operatorNameById.get(entry.operatorId) || '—';
                                    return (
                                        <TableRow key={entry.id}>
                                            <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(entry.date)} query={searchTerm} /></TableCell>
                                            <TableCell><HighlightMatch text={entry.shift || '—'} query={searchTerm} /></TableCell>
                                            <TableCell><CellText text={itemDisplay} query={searchTerm} /></TableCell>
                                            <TableCell className="max-w-[120px] truncate" title={(process === 'cutter' || process === 'holo' || process === 'coning') ? resolvePieceDisplay(entry) : (entry.lotNo || '')}>
                                                <HighlightMatch text={(process === 'cutter' || process === 'holo' || process === 'coning') ? resolvePieceDisplay(entry) : (entry.lotNo || '—')} query={searchTerm} />
                                            </TableCell>
                                            {process === 'cutter' && (
                                                <TableCell><HighlightMatch text={resolvedNames.cutName} query={searchTerm} /></TableCell>
                                            )}
                                            {process === 'holo' && (
                                                <>
                                                    <TableCell><HighlightMatch text={resolvedNames.cutName} query={searchTerm} /></TableCell>
                                                    <TableCell className="whitespace-nowrap"><HighlightMatch text={resolvedNames.yarnName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={resolvedNames.twistName} query={searchTerm} /></TableCell>
                                                </>
                                            )}
                                            {process === 'coning' && (
                                                <>
                                                    <TableCell><HighlightMatch text={resolvedNames.cutName} query={searchTerm} /></TableCell>
                                                    <TableCell className="whitespace-nowrap"><HighlightMatch text={resolvedNames.yarnName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={resolvedNames.twistName} query={searchTerm} /></TableCell>
                                                    <TableCell className="text-right tabular-nums">{entry.rollsIssued || 0}</TableCell>
                                                    <TableCell><CellText text={entry.coneTypeName || resolveConingConeTypeName(entry)} query={searchTerm} max="sm" /></TableCell>
                                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatPerConeNet(entry.perConeTargetG ?? entry.requiredPerConeNetWeight)}</TableCell>
                                                </>
                                            )}
                                            <TableCell><CellText text={machineDisplay} query={searchTerm} max="sm" /></TableCell>
                                            <TableCell><CellText text={operatorDisplay} query={searchTerm} max="sm" /></TableCell>
                                            <TableCell className="text-right">
                                                <div className="space-y-0.5 leading-tight whitespace-nowrap tabular-nums">
                                                    <div className="text-[11px] text-muted-foreground">O: {formatKg(entry.originalIssuedWeight || entry.issuedWeight)}</div>
                                                    <div className="text-[11px] text-amber-600">TB: {formatKg(entry.takeBackWeight || 0)}</div>
                                                    <div className="text-[11px] font-medium">N: {formatKg(entry.netIssuedWeight ?? entry.issuedWeight)}</div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1 text-green-600">
                                                    <span className="font-medium">{formatKg(entry.receivedWeight)}</span>
                                                    {renderReceivedDetailsControl(entry)}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums whitespace-nowrap font-medium text-blue-600">{formatKg(entry.pendingWeight)}</TableCell>
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
                                            <TableCell className="font-mono text-xs whitespace-nowrap"><HighlightMatch text={entry.barcode || entry.id.substring(0, 8)} query={searchTerm} /></TableCell>
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
                {/* Invisible infinite-scroll sentinel (no UI change). */}
                <div ref={loadMoreRef} style={{ height: 1 }} aria-hidden="true" />
                {v2List.isLoading && filteredEntries.length > 0 && (
                    <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Loading more…
                    </div>
                )}
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
                    <ListState
                        className="border rounded-lg bg-card"
                        isLoading={v2List.isLoading}
                        error={v2List.error}
                        onRetry={v2List.refresh}
                        emptyMessage={`No pending entries on machine for ${process}.`}
                    />
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
                                            {formatDateDDMMYYYY(entry.date)}{entry.shift ? ` (${entry.shift})` : ''} • {itemNameById.get(entry.itemId)}
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
                                        <div className="flex items-center gap-1 text-green-600">
                                            <span>Rcvd: {formatKg(entry.receivedWeight)}</span>
                                            {renderReceivedDetailsControl(entry, { mobile: true })}
                                        </div>
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
                        {process === 'coning' && (
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                                <span>Issue Pending: <strong>{formatKg(issuePendingPool)}</strong></span>
                                <span>·</span>
                                <span>Entered: <strong>{formatKg(totalEnteredWeight)}</strong></span>
                                <span>·</span>
                                <span>Remaining: <strong>{formatKg(Math.max(0, issuePendingPool - totalEnteredWeight))}</strong></span>
                            </div>
                        )}
                        <div className="rounded-md border overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Source</TableHead>
                                        {process === 'holo' && <TableHead>Piece Type</TableHead>}
                                        {process !== 'cutter' && <TableHead className="text-right">Count</TableHead>}
                                        {(process === 'holo' || process === 'coning') && <TableHead>Box</TableHead>}
                                        {(process === 'holo' || process === 'coning') && <TableHead className="text-right">Gross (kg)</TableHead>}
                                        <TableHead className="text-right">Weight (kg)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {takeBackLinesDraft.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={process === 'cutter' ? 2 : (process === 'holo' || process === 'coning' ? 5 + (process === 'holo' ? 1 : 0) : 3)} className="text-center py-6 text-muted-foreground">
                                                No take-back eligible lines.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        takeBackLinesDraft.map((line, idx) => {
                                            const otherLinesWeight = process === 'coning'
                                                ? totalEnteredWeight - Math.max(0, Number(line.weight || 0))
                                                : 0;
                                            const effectiveMaxWeight = process === 'coning'
                                                ? Math.max(0, Math.min(
                                                    Number(line.maxWeight || 0),
                                                    issuePendingPool - otherLinesWeight
                                                  ))
                                                : Number(line.maxWeight || 0);
                                            const isRowDisabled = effectiveMaxWeight <= 0.0001;
                                            return (
                                            <TableRow key={line.sourceId} className={isRowDisabled ? 'opacity-60' : ''}>
                                                <TableCell className="align-middle whitespace-nowrap">
                                                    <div className="font-mono text-xs">{line.sourceBarcode || line.sourceId}</div>
                                                    {process === 'coning' ? (
                                                        <div className="mt-1 text-[11px] text-muted-foreground">
                                                            Issued: {formatKg(line.issuedWeight || 0)} • Received: {formatKg(line.receivedAllocatedWeight || 0)} • Remaining: {formatKg(line.maxWeight || 0)}
                                                        </div>
                                                    ) : null}
                                                </TableCell>
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
                                                            disabled={isRowDisabled}
                                                            onChange={(e) => {
                                                                const raw = Number(e.target.value || 0);
                                                                const maxCount = Math.max(0, Number(line.maxCount || 0));
                                                                const nextCount = Math.max(0, Math.min(maxCount, Number.isFinite(raw) ? raw : 0));
                                                                setTakeBackLinesDraft((prev) => prev.map((l, i) => {
                                                                    if (i !== idx) return l;
                                                                    const nextWeight = process === 'holo'
                                                                        ? calcHoloTakeBackNetWeight(l, nextCount, l.grossWeight, l.boxId)
                                                                        : (process === 'coning'
                                                                            ? calcConingTakeBackNetWeight(l, nextCount, l.grossWeight, l.boxId)
                                                                            : calcAutoTakeBackWeight(l, nextCount));
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
                                                {(process === 'holo' || process === 'coning') && (
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
                                                                        weight: process === 'holo'
                                                                            ? calcHoloTakeBackNetWeight(l, l.count, l.grossWeight, nextBoxId)
                                                                            : calcConingTakeBackNetWeight(l, l.count, l.grossWeight, nextBoxId),
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
                                                {(process === 'holo' || process === 'coning') && (
                                                    <TableCell className="text-right align-middle">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step="0.001"
                                                            value={line.grossWeight || ''}
                                                            disabled={isRowDisabled}
                                                            onChange={(e) => {
                                                                const raw = Number(e.target.value || 0);
                                                                const grossWeight = roundTakeBackWeight(Math.max(0, Number.isFinite(raw) ? raw : 0));
                                                                setTakeBackLinesDraft((prev) => prev.map((l, i) => {
                                                                    if (i !== idx) return l;
                                                                    const rawWeight = process === 'holo'
                                                                        ? calcHoloTakeBackNetWeight(l, l.count, grossWeight, l.boxId)
                                                                        : calcConingTakeBackNetWeight(l, l.count, grossWeight, l.boxId);
                                                                    return { ...l, grossWeight, weight: rawWeight };
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
                                                        max={process === 'coning' ? undefined : effectiveMaxWeight}
                                                        value={line.weight}
                                                        disabled={isRowDisabled}
                                                        onChange={(e) => {
                                                            const raw = Number(e.target.value || 0);
                                                            const maxWeight = Math.max(0, effectiveMaxWeight);
                                                            const value = roundTakeBackWeight(Math.max(0, Math.min(maxWeight, Number.isFinite(raw) ? raw : 0)));
                                                            setTakeBackLinesDraft((prev) => prev.map((l, i) => i === idx ? { ...l, weight: value } : l));
                                                        }}
                                                        className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs"
                                                        readOnly={process === 'holo' || process === 'coning'}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                            );
                                        })
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
