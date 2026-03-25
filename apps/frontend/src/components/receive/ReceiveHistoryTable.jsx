import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Card, CardHeader, CardTitle, CardContent, ActionMenu, Button, Input, Select } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Printer, Edit2, Trash2, Download, History, RotateCcw, Search, X } from 'lucide-react';
import * as api from '../../api';
import { HighlightMatch } from '../common/HighlightMatch';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { InfoPopover } from '../common/InfoPopover';
import { exportHistoryToExcel } from '../../services';
import { buildConingTraceContext, resolveConingTrace } from '../../utils/coningTrace';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';
import { UserBadge } from '../common/UserBadge';
import { usePermission } from '../../hooks/usePermission';
import { SheetColumnFilter, applySheetFilters } from '../common/SheetColumnFilters';
import { getFeatureFlags } from '../../utils/featureFlags';
import { useV2CursorList } from '../../hooks/useV2CursorList';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import * as v2 from '../../api/v2';

export function ReceiveHistoryTable({ canEdit = false, canDelete = false }) {
    const { db, process, refreshProcessData, refreshModuleData, patchDb, subscribeInvalidation } = useInventory();
    const flags = getFeatureFlags();
    const v2Enabled = flags.v2ReceiveHistory;
    const { canDelete: canDeleteInbound } = usePermission('inbound');
    const canDeleteCutterPurchase = canDelete && canDeleteInbound;
    const [activeTab, setActiveTab] = useState('history');
    const [editingChallan, setEditingChallan] = useState(null);
    const [editRows, setEditRows] = useState([]);
    const [removedRowIds, setRemovedRowIds] = useState(new Set());
    const [savingEdit, setSavingEdit] = useState(false);
    const [editingReceiveRow, setEditingReceiveRow] = useState(null);
    const [receiveDraft, setReceiveDraft] = useState(null);
    const [savingReceive, setSavingReceive] = useState(false);
    const [deletingReceive, setDeletingReceive] = useState(false);
    const [deletePrompt, setDeletePrompt] = useState(null);
    const [pieceOptionsOverride, setPieceOptionsOverride] = useState(null);
    const [logChallan, setLogChallan] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sheetFilters, setSheetFilters] = useState({});
    const [openFilterId, setOpenFilterId] = useState(null);
    const [historyDirtyWhileHidden, setHistoryDirtyWhileHidden] = useState(false);
    const scrollRootRef = useRef(null);
    const lastV2RefreshAtRef = useRef(0);

    const workerNameById = useMemo(() => new Map((db.workers || []).map(w => [w.id, w.name])), [db.workers]);
    const boxById = useMemo(() => new Map((db.boxes || []).map(b => [b.id, b])), [db.boxes]);
    const bobbinById = useMemo(() => new Map((db.bobbins || []).map(b => [b.id, b])), [db.bobbins]);
    const rollTypeById = useMemo(() => new Map((db.rollTypes || []).map(r => [r.id, r])), [db.rollTypes]);

    const calcNetFromGrossTare = (row) => {
        const gross = Number(row?.grossWeight || 0);
        const tare = Number(row?.tareWeight || 0);
        const net = gross - tare;
        return Number.isFinite(net) ? net : 0;
    };

    const history = useMemo(() => {
        if (v2Enabled) return [];
        let rows = [];
        if (process === 'holo') {
            rows = (db.receive_from_holo_machine_rows || []).filter(row => !row.isDeleted);
        } else if (process === 'coning') {
            rows = (db.receive_from_coning_machine_rows || []).filter(row => !row.isDeleted);
        } else {
            rows = (db.receive_from_cutter_machine_rows || []).filter(row => !row.isDeleted);
        }
        // Sort by created date descending
        let sorted = rows.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        // Filter based on search and date
        return sorted.map(r => {
            let pieceIdsList = [];
            if (process === 'holo') {
                // Use server-computed pieceIds if available
                if (Array.isArray(r.computedPieceIds) && r.computedPieceIds.length > 0) {
                    pieceIdsList = r.computedPieceIds;
                } else {
                    // Fallback to client-side tracing
                    const issue = db.issue_to_holo_machine?.find(i => i.id === r.issueId);
                    if (issue) {
                        try {
                            const refs = typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue.receivedRowRefs;
                            if (Array.isArray(refs)) {
                                const ids = new Set();
                                refs.forEach(ref => {
                                    const cutterRow = db.receive_from_cutter_machine_rows?.find(cr => cr.id === ref.rowId);
                                    if (cutterRow?.pieceId) ids.add(cutterRow.pieceId);
                                });
                                pieceIdsList = Array.from(ids);
                            }
                        } catch (e) { }
                    }
                }
            } else if (process === 'coning') {
                // Use server-computed pieceIds if available
                if (Array.isArray(r.computedPieceIds) && r.computedPieceIds.length > 0) {
                    pieceIdsList = r.computedPieceIds;
                } else {
                    // Fallback to client-side tracing
                    const issue = db.issue_to_coning_machine?.find(i => i.id === r.issueId);
                    if (issue) {
                        try {
                            const refs = typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue.receivedRowRefs;
                            if (Array.isArray(refs)) {
                                const ids = new Set();
                                refs.forEach(ref => {
                                    const holoRow = db.receive_from_holo_machine_rows?.find(hr => hr.id === ref.rowId);
                                    if (holoRow) {
                                        const holoIssue = db.issue_to_holo_machine?.find(hi => hi.id === holoRow.issueId);
                                        if (holoIssue) {
                                            const hRefs = typeof holoIssue.receivedRowRefs === 'string' ? JSON.parse(holoIssue.receivedRowRefs) : holoIssue.receivedRowRefs;
                                            if (Array.isArray(hRefs)) {
                                                hRefs.forEach(hRef => {
                                                    const cutterRow = db.receive_from_cutter_machine_rows?.find(cr => cr.id === hRef.rowId);
                                                    if (cutterRow?.pieceId) ids.add(cutterRow.pieceId);
                                                });
                                            }
                                        }
                                    }
                                });
                                pieceIdsList = Array.from(ids);
                            }
                        } catch (e) { }
                    }
                }
            }
            return { ...r, pieceIdsList };
        });
    }, [db, process, v2Enabled]);

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

    const resolvePieceCutName = (piece) => {
        if (!piece) return '';
        const cutVal = piece.cut;
        return piece.cutName
            || (typeof cutVal === 'string' ? cutVal : cutVal?.name)
            || piece.cutMaster?.name
            || (piece.cutId ? db.cuts?.find(c => c.id === piece.cutId)?.name : '')
            || '';
    };

    const resolvePieceYarnName = (piece) => {
        if (!piece) return '';
        const yarnVal = piece.yarn;
        return piece.yarnName
            || (typeof yarnVal === 'string' ? yarnVal : yarnVal?.name)
            || (piece.yarnId ? db.yarns?.find(y => y.id === piece.yarnId)?.name : '')
            || '';
    };

    const resolvePieceTwistName = (piece) => {
        if (!piece) return '';
        const twistVal = piece.twist;
        return piece.twistName
            || (typeof twistVal === 'string' ? twistVal : twistVal?.name)
            || (piece.twistId ? db.twists?.find(t => t.id === piece.twistId)?.name : '')
            || '';
    };

    const getCutterChallanMeta = (challan) => {
        const item = db.items?.find(i => i.id === challan.itemId);
        const operator = db.operators?.find(o => o.id === challan.operatorId) || db.workers?.find(w => w.id === challan.operatorId);
        const helper = db.workers?.find(w => w.id === challan.helperId) || db.operators?.find(o => o.id === challan.helperId);
        const cut = db.cuts?.find(c => c.id === challan.cutId);
        return {
            itemName: item?.name || '—',
            operatorName: operator?.name || '—',
            helperName: helper?.name || '—',
            cutName: cut?.name || '—'
        };
    };

    const challans = useMemo(() => {
        if (process !== 'cutter') return [];
        const list = db.receive_from_cutter_machine_challans || [];
        let sorted = list
            .filter(challan => !challan.isDeleted)
            .slice()
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        // Filter based on search
        return sorted.filter(c => {
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const challanNo = (c.challanNo || '').toLowerCase();
                const lot = (c.lotNo || '').toLowerCase();
                const meta = getCutterChallanMeta(c);
                const itemName = (meta.itemName || '').toLowerCase();
                const operatorName = (meta.operatorName || '').toLowerCase();
                const note = (c.wastageNote || '').toLowerCase();
                const dateStr = formatDateDDMMYYYY(c.date || c.createdAt)?.toLowerCase() || '';

                return challanNo.includes(term) ||
                    lot.includes(term) ||
                    itemName.includes(term) ||
                    operatorName.includes(term) ||
                    note.includes(term) ||
                    dateStr.includes(term);
            }

            return true;
        });
    }, [db, process, searchTerm]);

    const getChallanEntriesLocal = (challanId) => (db.receive_from_cutter_machine_rows || [])
        .filter(row => !row.isDeleted && row.challanId === challanId)
        .slice()
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    const resolveChallanRows = async (challanId) => {
        const local = getChallanEntriesLocal(challanId);
        if (local.length > 0) return local;
        try {
            const res = await api.getCutterReceiveChallan(challanId);
            return Array.isArray(res?.rows) ? res.rows : local;
        } catch (err) {
            return local;
        }
    };

    const computeNetWeight = (bobbinId, boxId, bobbinQty, grossWeight) => {
        const bobbinWeight = Number(bobbinById.get(bobbinId)?.weight || 0);
        const boxWeight = Number(boxById.get(boxId)?.weight || 0);
        const qty = Number(bobbinQty || 0);
        const gross = Number(grossWeight || 0);
        const net = gross - (boxWeight + bobbinWeight * qty);
        return Number.isFinite(net) ? net : 0;
    };

    const roundTo3Decimals = (val) => {
        const num = Number(val);
        if (!Number.isFinite(num)) return 0;
        return Math.round(num * 1000) / 1000;
    };

    const formatInputDate = (value) => {
        if (!value) return '';
        const input = String(value).trim();
        try {
            // Handle DD/MM/YYYY or DD-MM-YYYY format
            if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/.test(input)) {
                const parts = input.split(/[\/-]/);
                // Assume DD/MM/YYYY
                const d = parts[0].padStart(2, '0');
                const m = parts[1].padStart(2, '0');
                const y = parts[2];
                return `${y}-${m}-${d}`;
            }
            // Handle YYYY-MM-DD (already ISO like)
            if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
                return input;
            }
            const d = new Date(input);
            if (Number.isNaN(d.getTime())) return '';
            return d.toISOString().split('T')[0];
        } catch (e) {
            return '';
        }
    };

    const buildPieceOptions = (pieceIds = []) => {
        const unique = Array.from(new Set(pieceIds.filter(Boolean)));
        return unique.map((pid) => {
            const piece = db.inbound_items?.find(p => p.id === pid);
            const label = piece ? `${piece.id} (${piece.lotNo})` : pid;
            return { id: pid, name: label };
        });
    };

    const resolveHoloPieceOptions = (row) => {
        if (!row) return [];
        const ids = [];
        if (Array.isArray(row.computedPieceIds)) ids.push(...row.computedPieceIds);
        if (Array.isArray(row.pieceIdsList)) ids.push(...row.pieceIdsList);
        if (row.pieceId) ids.push(row.pieceId);
        return buildPieceOptions(ids);
    };

    const resolveConingIssue = (row) => {
        if (!row?.issueId) return row?.issue || null;
        return db.issue_to_coning_machine?.find(i => i.id === row.issueId) || row.issue || null;
    };

    const traceContext = useMemo(() => buildConingTraceContext(db), [db]);
    const holoTraceContext = useMemo(() => buildHoloTraceContext(db), [db]);

    // Legacy rows (db.receive_from_*) generally don't have flattened v2 fields and may not include `issue.*` relations.
    // Precompute issue-level names once to keep legacy filtering fast and correct.
    const legacyIssueNamesByIssueId = useMemo(() => {
        const map = new Map();
        const itemNameById = new Map((db.items || []).map((i) => [i.id, i.name || '']));
        const cutNameById = new Map((db.cuts || []).map((c) => [c.id, c.name || '']));
        const yarnNameById = new Map((db.yarns || []).map((y) => [y.id, y.name || '']));
        const twistNameById = new Map((db.twists || []).map((t) => [t.id, t.name || '']));

        const fillDirect = (issue, base = {}) => {
            if (!issue) return base;
            return {
                itemName: base.itemName || (issue.itemId ? itemNameById.get(issue.itemId) : '') || '',
                cutName: base.cutName || (issue.cutId ? cutNameById.get(issue.cutId) : '') || '',
                yarnName: base.yarnName || (issue.yarnId ? yarnNameById.get(issue.yarnId) : '') || '',
                twistName: base.twistName || (issue.twistId ? twistNameById.get(issue.twistId) : '') || '',
            };
        };

        if (process === 'holo') {
            for (const issue of db.issue_to_holo_machine || []) {
                if (!issue?.id) continue;
                let names = {};
                try {
                    const resolved = holoTraceContext ? resolveHoloTrace(issue, holoTraceContext) : null;
                    names = {
                        cutName: resolved?.cutName || '',
                        yarnName: resolved?.yarnName || '',
                        twistName: resolved?.twistName || '',
                    };
                } catch { }
                map.set(issue.id, fillDirect(issue, names));
            }
        } else if (process === 'coning') {
            for (const issue of db.issue_to_coning_machine || []) {
                if (!issue?.id) continue;
                let names = {};
                try {
                    const resolved = traceContext ? resolveConingTrace(issue, traceContext) : null;
                    names = {
                        cutName: resolved?.cutName || '',
                        yarnName: resolved?.yarnName || '',
                        twistName: resolved?.twistName || '',
                    };
                } catch { }
                map.set(issue.id, fillDirect(issue, names));
            }
        }

        return map;
    }, [db.items, db.cuts, db.yarns, db.twists, db.issue_to_holo_machine, db.issue_to_coning_machine, process, traceContext, holoTraceContext]);

    const filterColumns = useMemo(() => {
        const base = [
            { id: 'date', label: 'Date', kind: 'date', getValue: (r) => r.date || r.createdAt || '' },
            { id: 'barcode', label: 'Barcode', kind: 'text', getValue: (r) => r.barcode || '' },
            { id: 'notes', label: 'Notes', kind: 'text', getValue: (r) => r.note || r.notes || '' },
            { id: 'addedBy', label: 'Added By', kind: 'values', getValue: (r) => r.createdByUser?.username || r.createdByUser?.name || '' },
        ];

        if (process === 'cutter') {
            return [
                ...base,
                { id: 'piece', label: 'Piece', kind: 'values', getValue: (r) => r.pieceId || '' },
                { id: 'machine', label: 'Machine', kind: 'values', getValue: (r) => r.machineNo || '' },
                { id: 'employee', label: 'Employee', kind: 'values', getValue: (r) => r.operator?.name || r.employee || '' },
                { id: 'netWt', label: 'Net Wt (kg)', kind: 'number', getValue: (r) => r.netWt || 0 },
                { id: 'bobbinQty', label: 'Bobbin Qty', kind: 'number', getValue: (r) => r.bobbinQuantity || 0 },
                { id: 'bobbin', label: 'Bobbin', kind: 'values', getValue: (r) => r.bobbin?.name || r.pcsTypeName || '' },
                {
                    id: 'item', label: 'Item', kind: 'values', getValue: (r) => {
                        const piece = db.inbound_items?.find(p => p.id === r.pieceId);
                        const item = db.items?.find(i => i.id === piece?.itemId);
                        return item?.name || '';
                    }
                },
                {
                    id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => {
                        const piece = db.inbound_items?.find(p => p.id === r.pieceId);
                        const cutVal = piece?.cut;
                        return piece?.cutName
                            || (typeof cutVal === 'string' ? cutVal : cutVal?.name)
                            || piece?.cutMaster?.name
                            || (piece?.cutId ? db.cuts?.find(c => c.id === piece.cutId)?.name : '')
                            || '';
                    }
                },
            ];
        }

        if (process === 'holo') {
            return [
                ...base,
                { id: 'piece', label: 'Piece', kind: 'text', getValue: (r) => (Array.isArray(r.computedPieceIds) ? r.computedPieceIds.join(', ') : (Array.isArray(r.pieceIdsList) ? r.pieceIdsList.join(', ') : (r.pieceId || ''))) },
                { id: 'rolls', label: 'Rolls', kind: 'number', getValue: (r) => r.rollCount || 0 },
                { id: 'weight', label: 'Weight (kg)', kind: 'number', getValue: (r) => r.rollWeight || calcNetFromGrossTare(r) || 0 },
                { id: 'machine', label: 'Machine', kind: 'values', getValue: (r) => r.machineNo || '' },
                { id: 'operator', label: 'Operator', kind: 'values', getValue: (r) => r.operator?.name || '' },
                { id: 'helper', label: 'Helper', kind: 'values', getValue: (r) => r.helper?.name || '' },
                {
                    id: 'item', label: 'Item', kind: 'values', getValue: (r) => (r.itemName || legacyIssueNamesByIssueId.get(r.issueId)?.itemName || '')
                },
                {
                    id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => (r.cutName || legacyIssueNamesByIssueId.get(r.issueId)?.cutName || '')
                },
                {
                    id: 'yarn', label: 'Yarn', kind: 'values', getValue: (r) => (r.yarnName || legacyIssueNamesByIssueId.get(r.issueId)?.yarnName || '')
                },
                {
                    id: 'twist', label: 'Twist', kind: 'values', getValue: (r) => (r.twistName || legacyIssueNamesByIssueId.get(r.issueId)?.twistName || '')
                },
            ];
        }

        return [
            ...base,
            { id: 'piece', label: 'Piece', kind: 'text', getValue: (r) => (Array.isArray(r.computedPieceIds) ? r.computedPieceIds.join(', ') : (Array.isArray(r.pieceIdsList) ? r.pieceIdsList.join(', ') : '')) },
            {
                id: 'coneType', label: 'Cone Type', kind: 'values', getValue: (r) => {
                    const issue = resolveConingIssue(r);
                    const coneType = resolveConingConeType(issue);
                    return coneType?.name || '';
                }
            },
            {
                id: 'perCone', label: 'Per Cone (g)', kind: 'number', getValue: (r) => {
                    const issue = resolveConingIssue(r);
                    return issue?.requiredPerConeNetWeight || 0;
                }
            },
            {
                id: 'actualG', label: 'Actual (g)', kind: 'number', getValue: (r) => {
                    const cones = Number(r.coneCount || 0);
                    const net = Number(r.netWeight || 0);
                    if (!cones || cones <= 0) return 0;
                    return (net * 1000) / cones;
                }
            },
            { id: 'box', label: 'Box', kind: 'values', getValue: (r) => r.box?.name || '' },
            { id: 'cones', label: 'Cones', kind: 'number', getValue: (r) => r.coneCount || 0 },
            { id: 'weight', label: 'Weight (kg)', kind: 'number', getValue: (r) => r.netWeight || 0 },
            { id: 'machine', label: 'Machine', kind: 'values', getValue: (r) => getConingMachineName(r) || '' },
            { id: 'operator', label: 'Operator', kind: 'values', getValue: (r) => r.operator?.name || '' },
            {
                id: 'item', label: 'Item', kind: 'values', getValue: (r) => (r.itemName || legacyIssueNamesByIssueId.get(r.issueId)?.itemName || '')
            },
            {
                id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => (r.cutName || legacyIssueNamesByIssueId.get(r.issueId)?.cutName || '')
            },
            {
                id: 'yarn', label: 'Yarn', kind: 'values', getValue: (r) => (r.yarnName || legacyIssueNamesByIssueId.get(r.issueId)?.yarnName || '')
            },
            {
                id: 'twist', label: 'Twist', kind: 'values', getValue: (r) => (r.twistName || legacyIssueNamesByIssueId.get(r.issueId)?.twistName || '')
            },
        ];
    }, [process, db, traceContext, holoTraceContext, getConingMachineName, resolveConingIssue, v2Enabled, legacyIssueNamesByIssueId]);

    const legacyFilteredHistory = useMemo(() => {
        if (v2Enabled) return [];
        let rows = applySheetFilters(history, filterColumns, sheetFilters);

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
    }, [history, filterColumns, sheetFilters, searchTerm]);

    const legacyTotals = useMemo(() => {
        if (v2Enabled) return { netWt: 0, bobbinQty: 0, rolls: 0, weight: 0, cones: 0 };
        const t = { netWt: 0, bobbinQty: 0, rolls: 0, weight: 0, cones: 0 };
        for (const r of legacyFilteredHistory || []) {
            if (process === 'cutter') {
                t.netWt += Number(r.netWt || 0);
                t.bobbinQty += Number(r.bobbinQuantity || 0);
            } else if (process === 'holo') {
                t.rolls += Number(r.rollCount || 0);
                t.weight += Number(r.rollWeight || calcNetFromGrossTare(r) || 0);
            } else if (process === 'coning') {
                t.cones += Number(r.coneCount || 0);
                t.weight += Number(r.netWeight || 0);
            }
        }
        return t;
    }, [legacyFilteredHistory, process, v2Enabled]);

    const showHistory = process !== 'cutter' || activeTab === 'history';
    const showChallans = process === 'cutter' && activeTab === 'challan';

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
        enabled: v2Enabled && showHistory,
        fetchPage: ({ limit, cursor, search, dateFrom, dateTo, filters }) => (
            v2.getV2ReceiveHistory(process, {
                limit,
                cursor,
                search,
                dateFrom,
                dateTo,
                filters: JSON.stringify(filters || []),
            })
        ),
        limit: 50,
        search: searchTerm,
        dateFrom: v2DateFrom,
        dateTo: v2DateTo,
        filters: v2Filters,
    });
    const refreshV2List = (minIntervalMs = 150) => {
        const now = Date.now();
        if (now - lastV2RefreshAtRef.current < minIntervalMs) return;
        lastV2RefreshAtRef.current = now;
        v2List.refresh();
    };

    useEffect(() => {
        if (!v2Enabled) return;
        const key = INVENTORY_INVALIDATION_KEYS.receiveHistory(process);
        return subscribeInvalidation(key, () => {
            if (showHistory) {
                refreshV2List();
                return;
            }
            setHistoryDirtyWhileHidden(true);
        });
    }, [process, showHistory, subscribeInvalidation, v2Enabled]);

    useEffect(() => {
        if (!v2Enabled || !showHistory || !historyDirtyWhileHidden) return;
        refreshV2List();
        setHistoryDirtyWhileHidden(false);
    }, [historyDirtyWhileHidden, showHistory, v2Enabled]);

    useEffect(() => {
        setHistoryDirtyWhileHidden(false);
    }, [process]);

    const filteredHistory = v2Enabled && showHistory ? v2List.items : legacyFilteredHistory;
    const totals = useMemo(() => {
        if (!v2Enabled || !showHistory) return legacyTotals;
        const s = v2List.summary || {};
        if (process === 'cutter') return { ...legacyTotals, netWt: Number(s.netWt || 0), bobbinQty: Number(s.bobbinQty || 0) };
        if (process === 'holo') return { ...legacyTotals, rolls: Number(s.rolls || 0), weight: Number(s.weight || 0) };
        return { ...legacyTotals, cones: Number(s.cones || 0), weight: Number(s.weight || 0) };
    }, [v2Enabled, showHistory, v2List.summary, process, legacyTotals]);

    const loadMoreRef = useInfiniteScrollSentinel({
        enabled: v2Enabled && showHistory && v2List.hasMore && !v2List.isLoading,
        onLoadMore: v2List.loadMore,
        rootRef: scrollRootRef,
    });

    const [v2FacetsById, setV2FacetsById] = useState({});
    useEffect(() => {
        if (!v2Enabled) return;
        if (!showHistory) return;
        if (!openFilterId) return;
        const col = filterColumns.find(c => c.id === openFilterId);
        if (!col || col.kind !== 'values') return;
        let cancelled = false;
        (async () => {
            try {
                const res = await v2.getV2ReceiveHistoryFacets(process, {
                    search: searchTerm,
                    dateFrom: v2DateFrom,
                    dateTo: v2DateTo,
                    filters: JSON.stringify(v2Filters || []),
                    excludeField: openFilterId,
                });
                const next = res?.facets?.[openFilterId];
                if (!cancelled && Array.isArray(next)) {
                    setV2FacetsById((prev) => ({ ...(prev || {}), [openFilterId]: next }));
                }
            } catch (_) { }
        })();
        return () => { cancelled = true; };
    }, [v2Enabled, showHistory, openFilterId, process, searchTerm, v2DateFrom, v2DateTo, v2Filters, filterColumns]);

    // Prefetch the most-used value facets so opening the filter doesn't briefly show "No data".
    useEffect(() => {
        if (!v2Enabled) return;
        if (!showHistory) return;
        let cancelled = false;
        const fields = process === 'cutter' ? ['item', 'cut', 'machine', 'employee'] : ['item', 'cut', 'yarn', 'twist'];
        (async () => {
            try {
                const res = await Promise.all(fields.map(async (field) => {
                    if (Array.isArray(v2FacetsById?.[field])) return null;
                    const col = filterColumns.find(c => c.id === field);
                    if (!col || col.kind !== 'values') return null;
                    const out = await v2.getV2ReceiveHistoryFacets(process, {
                        search: searchTerm,
                        dateFrom: v2DateFrom,
                        dateTo: v2DateTo,
                        filters: JSON.stringify(v2Filters || []),
                        excludeField: field,
                    });
                    return { field, values: out?.facets?.[field] };
                }));
                if (cancelled) return;
                const patch = {};
                for (const item of res) {
                    if (!item) continue;
                    if (Array.isArray(item.values)) patch[item.field] = item.values;
                }
                if (Object.keys(patch).length) {
                    setV2FacetsById((prev) => ({ ...(prev || {}), ...patch }));
                }
            } catch (_) { }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [v2Enabled, showHistory, process, searchTerm, v2DateFrom, v2DateTo, v2Filters, filterColumns]);

    const columnFor = (id) => {
        const col = filterColumns.find(c => c.id === id);
        if (!col) return col;
        if (!v2Enabled || col.kind !== 'values') return col;
        const facetOptions = v2FacetsById?.[id];
        return Array.isArray(facetOptions) ? { ...col, facetOptions } : col;
    };

    function resolveConingConeType(issue) {
        if (!issue?.receivedRowRefs) return null;
        try {
            const refs = typeof issue.receivedRowRefs === 'string'
                ? JSON.parse(issue.receivedRowRefs || '[]')
                : issue.receivedRowRefs;
            if (!Array.isArray(refs) || refs.length === 0) return null;
            const coneTypeId = refs[0]?.coneTypeId;
            if (!coneTypeId) return null;
            return db.cone_types?.find(c => c.id === coneTypeId) || null;
        } catch {
            return null;
        }
    }

    const formatPerConeNet = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return '—';
        return `${num} g`;
    };

    const formatActualPerCone = (netWeightKg, coneCount) => {
        const net = Number(netWeightKg);
        const cones = Number(coneCount);
        if (!Number.isFinite(net) || !Number.isFinite(cones) || cones <= 0) return '—';
        const perCone = (net * 1000) / cones;
        return `${perCone.toFixed(2)} g`;
    };

    const buildMachineNameOptions = (processType, currentValue) => {
        const options = (db.machines || [])
            .filter(m => m.processType === 'all' || m.processType === processType)
            .map(m => ({ id: m.name, name: m.name }));
        if (currentValue && !options.some(o => o.id === currentValue)) {
            options.unshift({ id: currentValue, name: currentValue });
        }
        return options;
    };

    const extractWastageFromNote = (note) => {
        // ... (unchanged)
        if (!note) return 0;
        const match = String(note).match(/([0-9]+(?:\.[0-9]+)?)/);
        if (!match) return 0;
        const value = Number(match[1].replace(/,/g, ''));
        return Number.isFinite(value) ? roundTo3Decimals(value) : 0;
    };

    // ... (keeping other helper functions if they were in the range, but extractingWastageFromNote is usually later. 
    // Wait, I am replacing a range. I should only replace what I need or be careful with the context.)
    // logic of openReceiveEditor is what I want to change.

    // I will replace `formatInputDate` at the top and `openReceiveEditor` content.
    // However, since they are far apart, I should use MULTI_REPLACE or be minimal.
    // The previous tool call output showed lines 580-640 which is inside openReceiveEditor.
    // formatInputDate is around line 251.
    // I should use multi_replace.

    // Actually, I can just redefine formatInputDate locally inside openReceiveEditor? No, it's used elsewhere.
    // I will change the request to multi_replace or just focus on openReceiveEditor and use a local helper or better logic.
    // Since I can't use multi_replace in this turn (one tool call per turn constraint was not mentioned but usually best practice to use the right tool).
    // The prompt says "Use this tool ONLY when you are making MULTIPLE, NON-CONTIGUOUS edits...".
    // I will use `multi_replace_file_content`.

    // Re-reading: "Do NOT make multiple parallel calls to this tool or the replace_file_content tool for the same file."

    // I will use `multi_replace_file_content` to fix `formatInputDate` AND `openReceiveEditor`.




    const resolveWastageResetAmount = ({ pieceId, affected, serverAmount }) => {
        const serverValue = Number(serverAmount);
        if (Number.isFinite(serverValue)) return serverValue;

        const pieceTotals = (db.receive_from_cutter_machine_piece_totals || [])
            .find(total => total.pieceId === pieceId);
        const pieceWastage = Number(pieceTotals?.wastageNetWeight || 0);
        if (pieceWastage > 0) return pieceWastage;

        if (!Array.isArray(affected) || affected.length === 0) return 0;
        const challanMap = new Map(
            (db.receive_from_cutter_machine_challans || []).map(challan => [challan.id, challan])
        );
        const total = affected.reduce((sum, entry) => {
            const challan = challanMap.get(entry.id);
            if (!challan) return sum;
            const numeric = Number(challan.wastageNetWeight || 0);
            if (numeric > 0) return sum + numeric;
            return sum + extractWastageFromNote(challan.wastageNote);
        }, 0);
        return roundTo3Decimals(total);
    };

    const resolvePieceWeights = (pieceId) => {
        if (!pieceId) return { inboundWeight: null, receivedWeight: null };
        const piece = (db.inbound_items || []).find(p => p.id === pieceId);
        const inboundWeight = Number(piece?.weight);
        const pieceTotals = (db.receive_from_cutter_machine_piece_totals || [])
            .find(total => total.pieceId === pieceId);
        const receivedWeight = Number(pieceTotals?.totalNetWeight);
        return {
            inboundWeight: Number.isFinite(inboundWeight) ? inboundWeight : null,
            receivedWeight: Number.isFinite(receivedWeight) ? receivedWeight : null,
        };
    };

    const getWastageResetCheck = ({ entryWeightBack, wastageAmount, inboundWeight, receivedWeight }) => {
        const inbound = Number(inboundWeight);
        const received = Number(receivedWeight);
        if (!Number.isFinite(inbound) || !Number.isFinite(received)) return null;
        const entryWeight = Number(entryWeightBack || 0);
        const wastageWeight = Number(wastageAmount || 0);
        const remainingReceived = Math.max(0, roundTo3Decimals(received - entryWeight));
        const accountedTotal = roundTo3Decimals(remainingReceived + entryWeight + wastageWeight);
        return {
            inbound,
            received,
            remainingReceived,
            accountedTotal,
            exceedsInbound: accountedTotal - inbound > 1e-6,
        };
    };

    const buildWastageResetConfirmMessage = ({ affected, wastageAmount, entryWeightBack, inboundWeight, receivedWeight }) => {
        const lines = [];
        const entryWeight = Number(entryWeightBack || 0);
        const wastageWeight = Number(wastageAmount || 0);
        const totalWeight = entryWeight + wastageWeight;

        lines.push('Wastage will be cleared and made available to receive again.');
        lines.push(
            `Entries back to receive: ${formatKg(entryWeight)} kg + `
            + `Wastage back to receive: ${formatKg(wastageWeight)} kg = `
            + `Total: ${formatKg(totalWeight)} kg`
        );

        const check = getWastageResetCheck({
            entryWeightBack,
            wastageAmount,
            inboundWeight,
            receivedWeight,
        });
        if (check) {
            lines.push(
                `Check: Remaining received ${formatKg(check.remainingReceived)} kg + `
                + `Entries back ${formatKg(entryWeight)} kg + `
                + `Wastage back ${formatKg(wastageWeight)} kg = `
                + `${formatKg(check.accountedTotal)} kg (Inbound ${formatKg(check.inbound)} kg).`
            );
            if (check.exceedsInbound) {
                lines.push('Warning: This exceeds the inbound weight. Please re-check the piece totals.');
            }
        }

        if (affected.length > 0) {
            const list = affected.map(c => c.challanNo).join(', ');
            lines.push(`This will also remove the wastage note from challan(s): ${list}. Please reprint them.`);
        }

        lines.push('Continue?');
        return lines.join('\n\n');
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
                const cut = db.cuts?.find(c => c.id === row.cutId)?.name || row.cutMaster?.name || (typeof row.cut === 'string' ? row.cut : row.cut?.name) || '';
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

                const resolved = issue ? resolveHoloTrace(issue, holoTraceContext) : { cutName: '—', twistName: '—' };
                const cut = resolved.cutName === '—' ? '' : resolved.cutName;
                const twistName = resolved.twistName === '—' ? '' : resolved.twistName;

                // Calculate tare weight
                const boxWeight = Number(box?.weight || 0);
                const rollTypeWeight = Number(rollType?.weight || 0);
                const rollCount = Number(row.rollCount || 1);
                const calculatedTare = boxWeight + (rollTypeWeight * rollCount);
                const tareWeight = Number.isFinite(row.tareWeight) ? Number(row.tareWeight) : calculatedTare;

                const lotLabel = issue?.lotLabel || issue?.lotNo || row.issue?.lotNo || '';
                const netWeight = Number.isFinite(row.rollWeight)
                    ? Number(row.rollWeight)
                    : Number.isFinite(row.netWeight)
                        ? Number(row.netWeight)
                        : Number.isFinite(row.grossWeight)
                            ? Math.max(0, Number(row.grossWeight) - tareWeight)
                            : 0;
                const operatorName = row.operator?.name
                    || (issue?.operatorId ? db.operators?.find(o => o.id === issue.operatorId)?.name : '')
                    || '';
                const machineName = row.machineNo || row.machine?.name
                    || (issue?.machineId ? db.machines?.find(m => m.id === issue.machineId)?.name : '')
                    || '';
                data = {
                    lotNo: lotLabel,
                    itemName: item?.name || '',
                    rollCount,
                    rollType: rollType?.name || '',
                    netWeight,
                    grossWeight: row.grossWeight,
                    tareWeight: tareWeight,
                    boxName: box?.name || row.box?.name || '',
                    cut: cut,
                    yarnName: yarnName,
                    twist: twistName,
                    machineName,
                    operatorName,
                    shift: issue?.shift || row.shift || '',
                    date: row.date || row.createdAt,
                    barcode: row.barcode,
                };
            } else if (process === 'coning') {
                stageKey = LABEL_STAGE_KEYS.CONING_RECEIVE;
                const issue = row.issue || db.issue_to_coning_machine?.find(i => i.id === row.issueId);
                const box = db.boxes?.find(b => b.id === row.boxId);
                const operator = db.operators?.find(o => o.id === row.operatorId);
                const item = db.items?.find(i => i.id === issue?.itemId);

                // Get coneType, wrapperName from issue's receivedRowRefs
                let coneType = '';
                let wrapperName = '';
                let cut = '';
                let yarnName = '';
                let rollType = '';
                let twist = '';

                try {
                    const refs = typeof issue?.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue?.receivedRowRefs;
                    if (Array.isArray(refs) && refs.length > 0) {
                        const firstRef = refs[0];

                        // Get cone type and wrapper
                        if (firstRef.coneTypeId) coneType = db.cone_types?.find(c => c.id === firstRef.coneTypeId)?.name || '';
                        if (firstRef.wrapperId) wrapperName = db.wrappers?.find(w => w.id === firstRef.wrapperId)?.name || '';
                        const resolved = issue ? resolveConingTrace(issue, traceContext) : { cutName: '—', yarnName: '—', twistName: '—', rollTypeName: '—' };
                        cut = resolved.cutName;
                        yarnName = resolved.yarnName;
                        twist = resolved.twistName;
                        rollType = resolved.rollTypeName;
                    }
                } catch (e) { console.error('Error parsing receivedRowRefs', e); }

                const lotLabel = issue?.lotLabel || issue?.lotNo || row.issue?.lotNo || row.lotNo || '';
                const netWeight = Number.isFinite(row.netWeight)
                    ? Number(row.netWeight)
                    : Number.isFinite(row.grossWeight) && Number.isFinite(row.tareWeight)
                        ? Math.max(0, Number(row.grossWeight) - Number(row.tareWeight))
                        : Number(row.grossWeight || 0);

                const resolved = issue ? resolveConingTrace(issue, traceContext) : null;
                const cutResolved = cut === '—' ? '' : cut;
                const yarnResolved = yarnName === '—' ? '' : yarnName;
                const twistResolved = twist === '—' ? '' : twist;
                const rollTypeResolved = rollType === '—' ? '' : rollType;
                const machineName = row.machineNo
                    || (issue?.machineId ? db.machines?.find((m) => m.id === issue.machineId)?.name : '')
                    || getConingMachineName(row)
                    || '';
                const operatorName = operator?.name || row.operator?.name || (issue?.operatorId ? db.operators?.find((o) => o.id === issue.operatorId)?.name : '') || '';

                data = {
                    lotNo: lotLabel,
                    itemName: row.itemName || item?.name || '',
                    coneCount: row.coneCount,
                    grossWeight: row.grossWeight,
                    tareWeight: row.tareWeight || 0,
                    netWeight,
                    boxName: box?.name || row.box?.name || '',
                    cut: row.cutName || (cutResolved || resolved?.cutName || ''),
                    yarnName: row.yarnName || (yarnResolved || resolved?.yarnName || ''),
                    twist: row.twistName || (twistResolved || resolved?.twistName || ''),
                    rollType: rollTypeResolved || resolved?.rollTypeName || '',
                    coneType: row.coneTypeName || coneType,
                    wrapperName: wrapperName,
                    operatorName,
                    machineName,
                    shift: issue?.shift || row.shift || '',
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

    const getEditPieceOptions = (row) => {
        if (Array.isArray(pieceOptionsOverride) && pieceOptionsOverride.length > 0) {
            return buildPieceOptions(pieceOptionsOverride);
        }
        return resolveHoloPieceOptions(row);
    };

    const openReceiveEditor = (row) => {
        if (!canEdit) return;
        if (!row) return;
        setPieceOptionsOverride(null);
        setEditingReceiveRow(row);

        if (process === 'holo') {
            const pieceOptions = resolveHoloPieceOptions(row);
            const pieceId = row.pieceId || (pieceOptions.length === 1 ? pieceOptions[0].id : '');

            let grossWeight = '';
            if (row.grossWeight != null) {
                grossWeight = String(row.grossWeight);
            } else if (Number.isFinite(row.rollWeight)) {
                let tare = row.tareWeight;
                if (!Number.isFinite(tare)) {
                    // Fallback: calculate tare from master data
                    const rollTypeWeight = Number((db.rollTypes || []).find(rt => rt.id === (row.rollTypeId || ''))?.weight || 0);
                    const boxWeight = Number((db.boxes || []).find(b => b.id === (row.boxId || ''))?.weight || 0);
                    const count = Number(row.rollCount || 1);
                    tare = rollTypeWeight * count + boxWeight;
                }
                // Only if we have a valid tare can we back-calculate gross
                if (Number.isFinite(tare)) {
                    grossWeight = String(roundTo3Decimals(Number(row.rollWeight) + Number(tare)));
                }
            }

            // Try to find the related issue to fallback for machine/operator/helper
            const issue = db.issue_to_holo_machine?.find(i => i.id === row.issueId);

            setReceiveDraft({
                date: formatInputDate(row.date || row.createdAt),
                rollTypeId: row.rollTypeId || row.rollType?.id || '',
                boxId: row.boxId || row.box?.id || '',
                rollCount: row.rollCount != null ? String(row.rollCount) : '',
                grossWeight,
                machineNo: row.machineNo || row.machine?.name || db.machines?.find(m => m.id === issue?.machineId)?.name || '',
                operatorId: row.operatorId || row.operator?.id || issue?.operatorId || '',
                helperId: row.helperId || row.helper?.id || issue?.helperId || '',
                notes: row.notes || row.note || '',
                pieceId,
            });
        } else if (process === 'coning') {
            let grossWeight = '';
            if (row.grossWeight != null) {
                grossWeight = String(row.grossWeight);
            } else if (Number.isFinite(row.netWeight)) {
                let tare = row.tareWeight;
                if (!Number.isFinite(tare)) {
                    // Fallback: calculate tare from master data for coning
                    const issue = resolveConingIssue(row);
                    const coneType = resolveConingConeType(issue);
                    const coneWeight = Number(coneType?.weight || 0);
                    const boxWeight = Number((db.boxes || []).find(b => b.id === (row.boxId || ''))?.weight || 0);
                    const count = Number(row.coneCount || 0);
                    tare = boxWeight + coneWeight * count;
                }
                if (Number.isFinite(tare)) {
                    grossWeight = String(roundTo3Decimals(Number(row.netWeight) + Number(tare)));
                }
            }

            setReceiveDraft({
                date: formatInputDate(row.date || row.createdAt),
                boxId: row.boxId || row.box?.id || '',
                coneCount: row.coneCount != null ? String(row.coneCount) : '',
                grossWeight,
                machineNo: row.machineNo || row.machine?.name || '',
                operatorId: row.operatorId || row.operator?.id || '',
                helperId: row.helperId || row.helper?.id || '',
                notes: row.notes || '',
            });
        }
    };

    const closeReceiveEditor = () => {
        setEditingReceiveRow(null);
        setReceiveDraft(null);
        setPieceOptionsOverride(null);
    };

    const updateReceiveDraft = (field, value) => {
        setReceiveDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
    };

    const handleSaveReceiveEdits = async () => {
        if (!editingReceiveRow || !receiveDraft) return;
        if (process !== 'holo' && process !== 'coning') return;

        if (process === 'holo') {
            const rollCount = Number(receiveDraft.rollCount);
            const grossWeight = Number(receiveDraft.grossWeight);
            if (!Number.isFinite(rollCount) || rollCount <= 0) {
                alert('Enter a valid roll count.');
                return;
            }
            if (!Number.isFinite(grossWeight) || grossWeight <= 0) {
                alert('Enter a valid gross weight.');
                return;
            }
            if (!receiveDraft.rollTypeId) {
                alert('Select a roll type.');
                return;
            }
            if (!receiveDraft.boxId) {
                alert('Select a box.');
                return;
            }

            const pieceOptions = getEditPieceOptions(editingReceiveRow);
            if (!editingReceiveRow.pieceId && pieceOptions.length > 1 && !receiveDraft.pieceId) {
                alert('Select a piece for this receive row.');
                return;
            }
        } else if (process === 'coning') {
            const coneCount = Number(receiveDraft.coneCount);
            const grossWeight = Number(receiveDraft.grossWeight);
            if (!Number.isFinite(coneCount) || coneCount <= 0) {
                alert('Enter a valid cone count.');
                return;
            }
            if (!Number.isFinite(grossWeight) || grossWeight <= 0) {
                alert('Enter a valid gross weight.');
                return;
            }
        }

        setSavingReceive(true);
        try {
            if (process === 'holo') {
                const payload = {
                    date: receiveDraft.date || null,
                    rollTypeId: receiveDraft.rollTypeId,
                    boxId: receiveDraft.boxId,
                    rollCount: Number(receiveDraft.rollCount),
                    grossWeight: Number(receiveDraft.grossWeight),
                    machineNo: receiveDraft.machineNo,
                    operatorId: receiveDraft.operatorId,
                    helperId: receiveDraft.helperId,
                    notes: receiveDraft.notes,
                };
                if (!editingReceiveRow.pieceId && receiveDraft.pieceId) {
                    payload.pieceId = receiveDraft.pieceId;
                }
                const res = await api.updateHoloReceiveRow(editingReceiveRow.id, payload);
                const updatedRow = res?.row || null;
                if (updatedRow) {
                    const existingRows = Array.isArray(db.receive_from_holo_machine_rows) ? db.receive_from_holo_machine_rows : [];
                    const existingTotals = Array.isArray(db.receive_from_holo_machine_piece_totals) ? db.receive_from_holo_machine_piece_totals : [];

                    const prevWeight = Number.isFinite(Number(editingReceiveRow.rollWeight))
                        ? Number(editingReceiveRow.rollWeight)
                        : calcNetFromGrossTare(editingReceiveRow);
                    const nextWeight = Number.isFinite(Number(updatedRow.rollWeight))
                        ? Number(updatedRow.rollWeight)
                        : calcNetFromGrossTare(updatedRow);
                    const prevRolls = Number(editingReceiveRow.rollCount || 0);
                    const nextRolls = Number(updatedRow.rollCount || 0);
                    const deltaNetWeight = nextWeight - prevWeight;
                    const deltaRolls = nextRolls - prevRolls;

                    const pieceId = updatedRow.pieceId || editingReceiveRow.pieceId || null;
                    if (pieceId) {
                        const baseTotal = existingTotals.find(t => t.pieceId === pieceId) || { pieceId, totalRolls: 0, totalNetWeight: 0, wastageNetWeight: 0 };
                        const nextTotal = {
                            ...baseTotal,
                            totalNetWeight: Number(baseTotal.totalNetWeight || 0) + deltaNetWeight,
                            totalRolls: Number(baseTotal.totalRolls || 0) + deltaRolls,
                        };
                        const nextTotals = [nextTotal, ...existingTotals.filter(t => t.pieceId !== pieceId)];

                        const nextRows = existingRows.map((r) => {
                            if (r.id !== updatedRow.id) return r;
                            return {
                                ...r,
                                ...updatedRow,
                                pieceId,
                                box: updatedRow.boxId ? (boxById.get(updatedRow.boxId) || null) : null,
                                rollType: updatedRow.rollTypeId ? (rollTypeById.get(updatedRow.rollTypeId) || null) : null,
                                operator: updatedRow.operatorId ? { id: updatedRow.operatorId, name: workerNameById.get(updatedRow.operatorId) || '' } : null,
                                helper: updatedRow.helperId ? { id: updatedRow.helperId, name: workerNameById.get(updatedRow.helperId) || '' } : null,
                            };
                        });

                        patchDb({
                            receive_from_holo_machine_rows: nextRows,
                            receive_from_holo_machine_piece_totals: nextTotals,
                        });
                    } else {
                        if (!v2Enabled) await refreshProcessData(process);
                        else refreshV2List();
                    }
                } else {
                    if (!v2Enabled) await refreshProcessData(process);
                    else refreshV2List();
                }
            } else if (process === 'coning') {
                const payload = {
                    date: receiveDraft.date || null,
                    boxId: receiveDraft.boxId,
                    coneCount: Number(receiveDraft.coneCount),
                    grossWeight: Number(receiveDraft.grossWeight),
                    machineNo: receiveDraft.machineNo,
                    operatorId: receiveDraft.operatorId,
                    helperId: receiveDraft.helperId,
                    notes: receiveDraft.notes,
                };
                const res = await api.updateConingReceiveRow(editingReceiveRow.id, payload);
                const updatedRow = res?.row || null;
                if (updatedRow) {
                    const existingRows = Array.isArray(db.receive_from_coning_machine_rows) ? db.receive_from_coning_machine_rows : [];
                    const existingTotals = Array.isArray(db.receive_from_coning_machine_piece_totals) ? db.receive_from_coning_machine_piece_totals : [];

                    const prevWeight = Number.isFinite(Number(editingReceiveRow.netWeight))
                        ? Number(editingReceiveRow.netWeight)
                        : calcNetFromGrossTare(editingReceiveRow);
                    const nextWeight = Number.isFinite(Number(updatedRow.netWeight))
                        ? Number(updatedRow.netWeight)
                        : calcNetFromGrossTare(updatedRow);
                    const prevCones = Number(editingReceiveRow.coneCount || 0);
                    const nextCones = Number(updatedRow.coneCount || 0);
                    const deltaNetWeight = nextWeight - prevWeight;
                    const deltaCones = nextCones - prevCones;

                    const pieceId = updatedRow.issueId || editingReceiveRow.issueId;
                    const baseTotal = existingTotals.find(t => t.pieceId === pieceId) || { pieceId, totalCones: 0, totalNetWeight: 0, wastageNetWeight: 0 };
                    const nextTotal = {
                        ...baseTotal,
                        totalNetWeight: Number(baseTotal.totalNetWeight || 0) + deltaNetWeight,
                        totalCones: Number(baseTotal.totalCones || 0) + deltaCones,
                    };
                    const nextTotals = [nextTotal, ...existingTotals.filter(t => t.pieceId !== pieceId)];

                    const nextRows = existingRows.map((r) => {
                        if (r.id !== updatedRow.id) return r;
                        return {
                            ...r,
                            ...updatedRow,
                            box: updatedRow.boxId ? (boxById.get(updatedRow.boxId) || null) : null,
                            operator: updatedRow.operatorId ? { id: updatedRow.operatorId, name: workerNameById.get(updatedRow.operatorId) || '' } : null,
                            helper: updatedRow.helperId ? { id: updatedRow.helperId, name: workerNameById.get(updatedRow.helperId) || '' } : null,
                        };
                    });

                    patchDb({
                        receive_from_coning_machine_rows: nextRows,
                        receive_from_coning_machine_piece_totals: nextTotals,
                    });
                } else {
                    if (!v2Enabled) await refreshProcessData(process);
                    else refreshV2List();
                }
            }

            closeReceiveEditor();
        } catch (err) {
            if (err.status === 409 && err.details?.error === 'piece_id_required') {
                const pieceIds = Array.isArray(err.details?.pieceIds) ? err.details.pieceIds : [];
                if (pieceIds.length > 0) {
                    setPieceOptionsOverride(pieceIds);
                    setReceiveDraft((prev) => (prev ? { ...prev, pieceId: '' } : prev));
                    alert('Select a piece for this receive row.');
                    return;
                }
            }
            alert(err.message || 'Failed to update receive row');
        } finally {
            setSavingReceive(false);
        }
    };

    const handleDeleteReceiveRow = async (row) => {
        if (!canDelete) return;
        if (!row || (process !== 'holo' && process !== 'coning')) return;

        if (process === 'holo') {
            const pieceOptions = resolveHoloPieceOptions(row);
            if (!row.pieceId && pieceOptions.length > 1) {
                setDeletePrompt({ row, pieceOptions, pieceId: '' });
                return;
            }
        }

        const label = row.barcode || row.id;
        const ok = window.confirm(`Delete receive ${label}? This will remove the row and update totals.`);
        if (!ok) return;

        try {
            if (process === 'holo') {
                const pieceOptions = resolveHoloPieceOptions(row);
                const pieceId = row.pieceId || (pieceOptions.length === 1 ? pieceOptions[0].id : null);
                await api.deleteHoloReceiveRow(row.id, pieceId ? { pieceId } : undefined);

                const existingRows = Array.isArray(db.receive_from_holo_machine_rows) ? db.receive_from_holo_machine_rows : [];
                const existingTotals = Array.isArray(db.receive_from_holo_machine_piece_totals) ? db.receive_from_holo_machine_piece_totals : [];
                const prevWeight = Number.isFinite(Number(row.rollWeight)) ? Number(row.rollWeight) : calcNetFromGrossTare(row);
                const prevRolls = Number(row.rollCount || 0);
                const resolvedPieceId = pieceId || row.pieceId || null;

                if (resolvedPieceId) {
                    const baseTotal = existingTotals.find(t => t.pieceId === resolvedPieceId) || { pieceId: resolvedPieceId, totalRolls: 0, totalNetWeight: 0, wastageNetWeight: 0 };
                    const nextTotal = {
                        ...baseTotal,
                        totalNetWeight: Number(baseTotal.totalNetWeight || 0) - prevWeight,
                        totalRolls: Number(baseTotal.totalRolls || 0) - prevRolls,
                    };
                    const nextTotals = [nextTotal, ...existingTotals.filter(t => t.pieceId !== resolvedPieceId)];
                    const nextRows = existingRows.filter(r => r.id !== row.id);
                    patchDb({
                        receive_from_holo_machine_rows: nextRows,
                        receive_from_holo_machine_piece_totals: nextTotals,
                    });
                } else {
                    if (!v2Enabled) await refreshProcessData(process);
                    else refreshV2List();
                }
            } else {
                await api.deleteConingReceiveRow(row.id);

                const existingRows = Array.isArray(db.receive_from_coning_machine_rows) ? db.receive_from_coning_machine_rows : [];
                const existingTotals = Array.isArray(db.receive_from_coning_machine_piece_totals) ? db.receive_from_coning_machine_piece_totals : [];
                const prevWeight = Number.isFinite(Number(row.netWeight)) ? Number(row.netWeight) : calcNetFromGrossTare(row);
                const prevCones = Number(row.coneCount || 0);
                const pieceId = row.issueId;
                const baseTotal = existingTotals.find(t => t.pieceId === pieceId) || { pieceId, totalCones: 0, totalNetWeight: 0, wastageNetWeight: 0 };
                const nextTotal = {
                    ...baseTotal,
                    totalNetWeight: Number(baseTotal.totalNetWeight || 0) - prevWeight,
                    totalCones: Number(baseTotal.totalCones || 0) - prevCones,
                };
                const nextTotals = [nextTotal, ...existingTotals.filter(t => t.pieceId !== pieceId)];
                const nextRows = existingRows.filter(r => r.id !== row.id);
                patchDb({
                    receive_from_coning_machine_rows: nextRows,
                    receive_from_coning_machine_piece_totals: nextTotals,
                });
            }
        } catch (err) {
            if (err.status === 409 && err.details?.error === 'piece_id_required') {
                const pieceIds = Array.isArray(err.details?.pieceIds) ? err.details.pieceIds : [];
                if (pieceIds.length > 0) {
                    setDeletePrompt({ row, pieceOptions: buildPieceOptions(pieceIds), pieceId: '' });
                    return;
                }
            }
            alert(err.message || 'Failed to delete receive row');
        }
    };

    const confirmDeleteReceiveRow = async () => {
        if (!deletePrompt?.row) return;
        if (!deletePrompt.pieceId) {
            alert('Select a piece for this receive row.');
            return;
        }

        setDeletingReceive(true);
        try {
            await api.deleteHoloReceiveRow(deletePrompt.row.id, { pieceId: deletePrompt.pieceId });
            const row = deletePrompt.row;
            const pieceId = deletePrompt.pieceId;
            const existingRows = Array.isArray(db.receive_from_holo_machine_rows) ? db.receive_from_holo_machine_rows : [];
            const existingTotals = Array.isArray(db.receive_from_holo_machine_piece_totals) ? db.receive_from_holo_machine_piece_totals : [];
            const prevWeight = Number.isFinite(Number(row.rollWeight)) ? Number(row.rollWeight) : calcNetFromGrossTare(row);
            const prevRolls = Number(row.rollCount || 0);
            const baseTotal = existingTotals.find(t => t.pieceId === pieceId) || { pieceId, totalRolls: 0, totalNetWeight: 0, wastageNetWeight: 0 };
            const nextTotal = {
                ...baseTotal,
                totalNetWeight: Number(baseTotal.totalNetWeight || 0) - prevWeight,
                totalRolls: Number(baseTotal.totalRolls || 0) - prevRolls,
            };
            const nextTotals = [nextTotal, ...existingTotals.filter(t => t.pieceId !== pieceId)];
            const nextRows = existingRows.filter(r => r.id !== row.id);
            patchDb({
                receive_from_holo_machine_rows: nextRows,
                receive_from_holo_machine_piece_totals: nextTotals,
            });
            setDeletePrompt(null);
        } catch (err) {
            alert(err.message || 'Failed to delete receive row');
        } finally {
            setDeletingReceive(false);
        }
    };

    const recalcEditRow = (row) => {
        const bobbinWeight = Number(bobbinById.get(row.bobbinId)?.weight || 0);
        const boxWeight = Number(boxById.get(row.boxId)?.weight || 0);
        const qty = Number(row.bobbinQty || 0);
        const gross = Number(row.grossWeight || 0);
        const tare = boxWeight + bobbinWeight * qty;
        const net = gross - tare;
        return {
            ...row,
            tareWeight: Number.isFinite(tare) ? tare : 0,
            netWeight: Number.isFinite(net) ? net : 0,
            boxName: boxById.get(row.boxId)?.name || row.boxName,
            bobbinName: bobbinById.get(row.bobbinId)?.name || row.bobbinName
        };
    };

    const handleEditChallan = async (challan) => {
        if (!canEdit) return;
        const rows = await resolveChallanRows(challan.id);
        const mappedRows = rows.map((row) => {
            const bobbinQty = row.bobbinQuantity != null ? String(row.bobbinQuantity) : '';
            const grossWeight = row.grossWt != null ? String(row.grossWt) : '';
            const base = {
                id: row.id,
                barcode: row.barcode || '—',
                bobbinId: row.bobbinId,
                boxId: row.boxId,
                bobbinQty,
                grossWeight,
                tareWeight: Number(row.tareWt || 0),
                netWeight: Number(row.netWt || 0),
                bobbinName: row.bobbin?.name || row.pcsTypeName || '',
                boxName: row.box?.name || row.pktTypeName || '',
                original: {
                    bobbinQty,
                    grossWeight,
                    boxId: row.boxId,
                },
            };
            return recalcEditRow(base);
        });

        setEditingChallan(challan);
        setRemovedRowIds(new Set());
        setEditRows(mappedRows);
    };

    const updateEditRow = (rowId, field, value) => {
        setEditRows((prev) => prev.map((row) => {
            if (row.id !== rowId) return row;
            return recalcEditRow({ ...row, [field]: value });
        }));
    };

    const toggleRemovedRow = (rowId) => {
        setRemovedRowIds((prev) => {
            const next = new Set(prev);
            if (next.has(rowId)) next.delete(rowId);
            else next.add(rowId);
            return next;
        });
    };

    const closeEditDialog = () => {
        setEditingChallan(null);
        setEditRows([]);
        setRemovedRowIds(new Set());
    };

    const handleSaveChallanEdits = async () => {
        if (!editingChallan) return;
        const removedIds = Array.from(removedRowIds);
        const updates = editRows
            .filter(row => !removedRowIds.has(row.id))
            .filter(row => (
                row.boxId !== row.original.boxId
                || row.bobbinQty !== row.original.bobbinQty
                || row.grossWeight !== row.original.grossWeight
            ))
            .map(row => ({
                rowId: row.id,
                boxId: row.boxId,
                bobbinQuantity: Number(row.bobbinQty),
                grossWeight: Number(row.grossWeight),
            }));

        if (updates.length === 0 && removedIds.length === 0) {
            closeEditDialog();
            return;
        }

        for (const row of editRows) {
            if (removedRowIds.has(row.id)) continue;
            const qty = Number(row.bobbinQty);
            const gross = Number(row.grossWeight);
            if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(gross) || gross <= 0) {
                alert('Enter valid bobbin quantity and gross weight for all rows.');
                return;
            }
            if (!row.boxId) {
                alert('Select a box type for all rows.');
                return;
            }
        }

        setSavingEdit(true);
        try {
            await api.updateCutterReceiveChallan(editingChallan.id, { updates, removedRowIds: removedIds });
            if (!v2Enabled) await refreshProcessData(process);
            else refreshV2List();
            closeEditDialog();
        } catch (err) {
            if (err.status === 409 && err.details?.error === 'wastage_note_conflict') {
                const affected = err.details?.affectedChallans || [];
                const entryWeightBack = editRows.reduce((sum, row) => {
                    if (removedRowIds.has(row.id)) {
                        const net = Number(row.netWeight || computeNetWeight(row.bobbinId, row.boxId, row.bobbinQty, row.grossWeight));
                        return sum + (Number.isFinite(net) ? Math.max(0, net) : 0);
                    }

                    const changed = row.boxId !== row.original.boxId
                        || row.bobbinQty !== row.original.bobbinQty
                        || row.grossWeight !== row.original.grossWeight;
                    if (!changed) return sum;

                    const originalNet = computeNetWeight(row.bobbinId, row.original.boxId, row.original.bobbinQty, row.original.grossWeight);
                    const currentNet = Number(row.netWeight || computeNetWeight(row.bobbinId, row.boxId, row.bobbinQty, row.grossWeight));
                    const diff = originalNet - currentNet;
                    return diff > 0 ? sum + diff : sum;
                }, 0);
                const wastageAmount = resolveWastageResetAmount({
                    pieceId: editingChallan?.pieceId,
                    affected,
                    serverAmount: err.details?.wastageAmount,
                });
                const { inboundWeight, receivedWeight } = resolvePieceWeights(editingChallan?.pieceId);
                const check = getWastageResetCheck({
                    entryWeightBack,
                    wastageAmount,
                    inboundWeight,
                    receivedWeight,
                });
                if (check?.exceedsInbound) {
                    alert(
                        `Cannot continue: accounted weight (${formatKg(check.accountedTotal)} kg) `
                        + `exceeds inbound weight (${formatKg(check.inbound)} kg).`
                    );
                    return;
                }

                const ok = window.confirm(
                    buildWastageResetConfirmMessage({
                        affected,
                        wastageAmount,
                        entryWeightBack,
                        inboundWeight,
                        receivedWeight,
                    })
                );
                if (ok) {
                    await api.updateCutterReceiveChallan(editingChallan.id, { updates, removedRowIds: removedIds, confirmCascade: true });
                    if (!v2Enabled) await refreshProcessData(process);
                    else refreshV2List();
                    closeEditDialog();
                }
            } else {
                alert(err.message || 'Failed to update challan');
            }
        } finally {
            setSavingEdit(false);
        }
    };

    const handleDeleteChallan = async (challan) => {
        if (!canDelete) return;
        const ok = window.confirm(`Delete challan ${challan.challanNo}? This will revert its receive entries.`);
        if (!ok) return;
        try {
            await api.deleteCutterReceiveChallan(challan.id);
            if (!v2Enabled) await refreshProcessData(process);
            else refreshV2List();
        } catch (err) {
            if (err.status === 409 && err.details?.error === 'wastage_note_conflict') {
                const affected = err.details?.affectedChallans || [];
                const rows = await resolveChallanRows(challan.id);
                const entryWeightBack = rows.reduce((sum, row) => sum + Number(row.netWt || 0), 0);
                const wastageAmount = resolveWastageResetAmount({
                    pieceId: challan?.pieceId,
                    affected,
                    serverAmount: err.details?.wastageAmount,
                });
                const { inboundWeight, receivedWeight } = resolvePieceWeights(challan?.pieceId);
                const check = getWastageResetCheck({
                    entryWeightBack,
                    wastageAmount,
                    inboundWeight,
                    receivedWeight,
                });
                if (check?.exceedsInbound) {
                    alert(
                        `Cannot continue: accounted weight (${formatKg(check.accountedTotal)} kg) `
                        + `exceeds inbound weight (${formatKg(check.inbound)} kg).`
                    );
                    return;
                }
                const confirm = window.confirm(
                    buildWastageResetConfirmMessage({
                        affected,
                        wastageAmount,
                        entryWeightBack,
                        inboundWeight,
                        receivedWeight,
                    })
                );
                if (confirm) {
                    await api.deleteCutterReceiveChallan(challan.id, { confirmCascade: true });
                    if (!v2Enabled) await refreshProcessData(process);
                    else refreshV2List();
                }
            } else {
                alert(err.message || 'Failed to delete challan');
            }
        }
    };

    const buildChallanPrintHtml = (challan, rows) => {
        const settings = db?.settings?.[0] || {};
        const fieldsConfig = settings.challanFieldsConfig || {};
        const meta = getCutterChallanMeta(challan);
        const dateDisplay = formatDateDDMMYYYY(challan.date || challan.createdAt) || '—';

        // Fetch "To" details (from Firm associated with the Lot)
        const lot = db.lots?.find(l => l.lotNo === challan.lotNo);
        const firm = lot ? db.firms?.find(f => f.id === lot.firmId) : null;
        const toDetails = {
            name: firm?.name || '—',
            address: firm?.address || '',
            mobile: firm?.mobile || ''
        };

        const noteContent = (fieldsConfig.showWastageNote !== false && challan.wastageNote)
            ? `<div class="note"><strong>Note:</strong> ${challan.wastageNote}</div>`
            : '';

        const logoHtml = settings.logoDataUrl
            ? `<img src="${settings.logoDataUrl}" style="max-height: 50px; max-width: 150px; margin-bottom: 5px;" />`
            : '';

        // Helper to render a table half
        const renderTableHalf = (subset) => {
            const bodyRows = subset.map((row) => `
                <tr>
                  <td style="text-align: center; width: 30px;">${row.originalIdx + 1}</td>
                  <td class="num" style="width: 65px;">${row.isEmpty ? '' : formatKg(row.grossWt)}</td>
                  <td class="num" style="width: 65px;">${row.isEmpty ? '' : formatKg(row.netWt)}</td>
                  <td style="text-align: center; width: 45px;">${row.isEmpty ? '' : (row.bobbinQuantity || 0)}</td>
                </tr>
            `).join('');

            return `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width: 30px; text-align: center;">#</th>
                      <th class="num" style="width: 65px;">Gross</th>
                      <th class="num" style="width: 65px;">Net</th>
                      <th style="width: 45px; text-align: center;">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${bodyRows}
                  </tbody>
                </table>
            `;
        };

        // Create a padded list of exactly 50 rows
        const indexedRows = rows.map((r, i) => ({ ...r, originalIdx: i, isEmpty: false }));
        while (indexedRows.length < 50) {
            indexedRows.push({ originalIdx: indexedRows.length, isEmpty: true });
        }

        const leftRows = indexedRows.slice(0, 25);
        const rightRows = indexedRows.slice(25, 50);

        const challanContent = `
            <div class="challan-copy">
                <div class="watermark">{WATERMARK}</div>
                <div class="header-container">
                    <div class="header-left">
                        ${logoHtml}
                        <h1 class="challan-title">Delivery Challan</h1>
                        <div class="challan-no">NO: ${challan.challanNo}</div>
                    </div>
                    <div class="header-right">
                        <div class="copy-label"> {COPY_TYPE} </div>
                        <div style="font-size: 11px; font-weight: bold; color: #111827;">${fieldsConfig.showDate !== false ? 'DATE: ' + dateDisplay : ''}</div>
                    </div>
                </div>

                <div class="details-grid">
                    <div class="details-box">
                        <div class="details-title">From (Consigner)</div>
                        <div class="details-content">
                            ${fieldsConfig.showFromName !== false ? `<p><strong>${settings.challanFromName || 'Our Warehouse'}</strong></p>` : ''}
                            ${fieldsConfig.showFromAddress !== false ? `<p style="white-space: pre-wrap;">${settings.challanFromAddress || ''}</p>` : ''}
                            ${fieldsConfig.showFromMobile !== false ? `<p>Mobile: ${settings.challanFromMobile || '—'}</p>` : ''}
                        </div>
                    </div>
                    <div class="details-box">
                        <div class="details-title">To (Consignee)</div>
                        <div class="details-content">
                            ${fieldsConfig.showToDetails !== false ? `
                                <p><strong>${toDetails.name}</strong></p>
                                <p style="white-space: pre-wrap;">${toDetails.address}</p>
                                <p>Contact: ${toDetails.mobile || '—'}</p>
                            ` : '<p>—</p>'}
                        </div>
                    </div>
                </div>

                <div class="meta-inline">
                    ${fieldsConfig.showLotNo !== false ? `
                        <div class="meta-item"><span class="meta-label">Lot No</span><span class="meta-value">${challan.lotNo || '—'}</span></div>
                    ` : ''}
                    ${fieldsConfig.showItem !== false ? `
                        <div class="meta-item"><span class="meta-label">Item</span><span class="meta-value">${meta.itemName}</span></div>
                    ` : ''}
                    ${fieldsConfig.showCut !== false ? `
                        <div class="meta-item"><span class="meta-label">Cut Type</span><span class="meta-value">${meta.cutName}</span></div>
                    ` : ''}
                </div>

                <div class="columns-container">
                    <div class="column">
                        ${renderTableHalf(leftRows)}
                    </div>
                    <div class="column">
                        ${renderTableHalf(rightRows)}
                    </div>
                </div>

                <div class="bottom-section">
                    ${noteContent}
                    ${fieldsConfig.showTotals !== false ? `
                        <div class="summary-table">
                            <div class="summary-row"><span class="summary-label">Total Bobbins:</span><span class="num">${challan.totalBobbinQty || 0}</span></div>
                            <div class="summary-row total-row"><span class="summary-label">Total Net Weight:</span><span class="num">${formatKg(challan.totalNetWeight)} kg</span></div>
                        </div>
                    ` : ''}
                </div>

                <div class="footer">
                    <div class="signature-box"><div class="signature-line">Receiver's Signature</div></div>
                    <div class="signature-box"><div class="signature-line">Authorized Signatory</div></div>
                </div>

                <div class="legal-note">
                    This is a computer-generated delivery challan.
                </div>
            </div>
        `;

        return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Challan ${challan.challanNo}</title>
  <style>
    @page { 
        margin: 0mm; 
        size: A4 landscape;   
    }
    body { 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
        color: #1f2937; 
        margin: 0; 
        padding: 0; 
        line-height: 1.1; 
        font-size: 9px; 
        background: #f3f4f6;
    }
    
    @media print {
        body { background: white; }
        header, footer { display: none !important; }
    }

    .landscape-page {
        display: flex;
        width: 297mm;
        height: 210mm;
        background: white;
        margin: 0 auto;
        box-sizing: border-box;
    }

    .challan-copy {
        position: relative;
        flex: 1;
        padding: 6mm 10mm;
        box-sizing: border-box;
        border-right: 1px dashed #cbd5e1;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .challan-copy:last-child {
        border-right: none;
    }

    .watermark {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-35deg);
        font-size: 70px;
        color: rgba(0, 0, 0, 0.04);
        font-weight: 900;
        text-transform: uppercase;
        z-index: 0;
        pointer-events: none;
        white-space: nowrap;
        letter-spacing: 5px;
    }

    .header-container { position: relative; z-index: 1; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header-left { flex: 1; }
    .header-right { text-align: right; flex: 1; }
    .copy-label { font-size: 8px; font-weight: 800; color: #6b7280; text-transform: uppercase; margin-bottom: 1px; }
    .challan-title { font-size: 14px; font-weight: bold; color: #1e3a8a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
    .challan-no { font-size: 9px; font-weight: bold; color: #3b82f6; margin-top: 1px; }
    
    .details-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 6px; }
    .details-box { border: 1px solid #e5e7eb; padding: 3px; border-radius: 3px; background: #f9fafb; }
    .details-title { font-size: 6px; font-weight: bold; text-transform: uppercase; color: #6b7280; margin-bottom: 1px; border-bottom: 1px solid #e5e7eb; padding-bottom: 1px; }
    .details-content p { margin: 0; font-size: 8px; }

    .meta-inline { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 6px; background: #f3f4f6; padding: 3px; border-radius: 3px; border: 1px solid #e5e7eb; }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label { font-size: 6px; text-transform: uppercase; color: #6b7280; font-weight: bold; }
    .meta-value { font-size: 8px; font-weight: 600; color: #1f2937; }

    .columns-container { position: relative; z-index: 1; display: flex; gap: 8px; flex: 1; min-height: 0; }
    .column { flex: 1; }
    
    table.data-table { width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; }
    th { background: #1e3a8a; color: white; padding: 1px 2px; text-align: center; font-size: 7px; text-transform: uppercase; border: 1px solid #1e3a8a; }
    td { border: 1px solid #cbd5e1; padding: 0.5px 2px; font-size: 7.5px; color: #374151; height: 12px; text-align: center; vertical-align: middle; }
    tr:nth-child(even) { background: #f8fafc; }
    .num { text-align: right; font-family: 'Courier New', Courier, monospace; font-weight: 600; }
    
    .bottom-section { position: relative; z-index: 1; margin-top: 5px; display: flex; justify-content: space-between; align-items: flex-start; }
    .note { flex: 1; margin-right: 8px; padding: 3px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 3px; font-size: 7px; color: #92400e; }
    
    .summary-table { width: 150px; border: 1px solid #e5e7eb; border-radius: 3px; overflow: hidden; }
    .summary-row { display: flex; justify-content: space-between; padding: 2px 5px; border-bottom: 1px solid #e5e7eb; }
    .total-row { 
        border-bottom: none; 
        background: #1e3a8a !important; 
        color: white !important; 
        font-weight: bold; 
        font-size: 9px; 
        padding: 4px 5px !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .footer { position: relative; z-index: 1; margin-top: auto; padding-top: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
    .signature-box { text-align: center; width: 100px; }
    .signature-line { border-top: 1px solid #374151; margin-top: 15px; padding-top: 2px; font-size: 7px; font-weight: bold; text-transform: uppercase; }
    
    .legal-note { margin-top: 4px; text-align: center; font-size: 6px; color: #9ca3af; border-top: 1px solid #f3f4f6; padding-top: 3px; }
  </style>
</head>
<body>
  <div class="landscape-page">
    ${challanContent.replace('{COPY_TYPE}', 'Sender\'s Copy').replace('{WATERMARK}', 'DUPLICATE')}
    ${challanContent.replace('{COPY_TYPE}', 'Receiver\'s Copy').replace('{WATERMARK}', 'ORIGINAL')}
  </div>
</body>
</html>`;
    };

    const handleChallanPrint = async (challan) => {
        const rows = await resolveChallanRows(challan.id);
        const html = buildChallanPrintHtml(challan, rows);

        // Use a hidden iframe to print without opening a new tab
        let iframe = document.getElementById('print-iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'print-iframe';
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);
        }

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();

        // Wait for content (like images/logos) to load if any
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }, 300);
    };

    const handleChallanExport = async (challan) => {
        const rows = await resolveChallanRows(challan.id);
        const meta = getCutterChallanMeta(challan);
        const dateDisplay = formatDateDDMMYYYY(challan.date || challan.createdAt) || '—';
        const escape = (val) => `"${String(val ?? '').replace(/\"/g, '""')}"`;
        const lines = [
            `Challan No,${escape(challan.challanNo)}`,
            `Date,${escape(dateDisplay)}`,
            `Lot,${escape(challan.lotNo || '')}`,
            `Item,${escape(meta.itemName)}`,
            `Operator,${escape(meta.operatorName)}`,
            `Cut,${escape(meta.cutName)}`,
            `Helper,${escape(meta.helperName)}`,
            `Total Net (kg),${escape(formatKg(challan.totalNetWeight))}`,
            `Total Bobbins,${escape(challan.totalBobbinQty || 0)}`,
            challan.wastageNote ? `Note,${escape(challan.wastageNote)}` : '',
            '',
            'Barcode,Gross (kg),Tare (kg),Net (kg),Bobbins,Bobbin,Box',
            ...rows.map((row) => [
                row.barcode || '',
                formatKg(row.grossWt),
                formatKg(row.tareWt),
                formatKg(row.netWt),
                row.bobbinQuantity || 0,
                row.bobbin?.name || row.pcsTypeName || '',
                row.box?.name || row.pktTypeName || ''
            ].map(escape).join(',')),
        ].filter(Boolean);

        const filename = `${String(challan.challanNo || 'challan').replace(/[^\w.-]+/g, '_')}.csv`;
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const isCutterPurchaseLot = (lotNo) => String(lotNo || '').toUpperCase().startsWith('CP-');

    const handleDeleteCutterPurchase = async (challan) => {
        if (!challan?.lotNo) return;
        const lotNo = challan.lotNo;
        const confirmed = window.confirm(
            `Delete cutter purchase ${lotNo}?\n\nThis will delete the challan, all crates, piece totals, and the inbound lot.`
        );
        if (!confirmed) return;
        try {
            await api.deleteCutterPurchaseLot(lotNo);
            await refreshProcessData(process || 'cutter');
            await refreshModuleData('inbound');
        } catch (err) {
            alert(err.message || 'Failed to delete cutter purchase');
        }
    };

    const getActions = (row) => [
        {
            label: 'Reprint',
            icon: <Printer className="w-4 h-4" />,
            onClick: () => handleReprint(row),
        },
        ...((process === 'holo' || process === 'coning') ? [
            {
                label: 'Edit',
                icon: <Edit2 className="w-4 h-4" />,
                onClick: () => openReceiveEditor(row),
                disabled: !canEdit,
                disabledReason: 'You do not have permission to edit receive records.',
            },
            {
                label: 'Delete',
                icon: <Trash2 className="w-4 h-4" />,
                onClick: () => handleDeleteReceiveRow(row),
                variant: 'destructive',
                disabled: !canDelete,
                disabledReason: 'You do not have permission to delete receive records.',
            },
        ] : []),
    ];

    const getChallanActions = (challan) => {
        const base = [
            {
                label: 'Print',
                icon: <Printer className="w-4 h-4" />,
                onClick: () => handleChallanPrint(challan),
            },
            {
                label: 'Export CSV',
                icon: <Download className="w-4 h-4" />,
                onClick: () => handleChallanExport(challan),
            },
            {
                label: 'View Log',
                icon: <History className="w-4 h-4" />,
                onClick: () => setLogChallan(challan),
            },
        ];

        if (process === 'cutter' && isCutterPurchaseLot(challan?.lotNo)) {
            return [
                ...base,
                {
                    label: 'Delete Cutter Purchase',
                    icon: <Trash2 className="w-4 h-4" />,
                    onClick: () => handleDeleteCutterPurchase(challan),
                    variant: 'destructive',
                    disabled: !canDeleteCutterPurchase,
                    disabledReason: 'You need delete access for both Receive (Cutter) and Inbound.',
                },
            ];
        }

        return [
            ...base,
            {
                label: 'Edit',
                icon: <Edit2 className="w-4 h-4" />,
                onClick: () => handleEditChallan(challan),
                disabled: !canEdit,
                disabledReason: 'You do not have permission to edit receive challans.',
            },
            {
                label: 'Delete',
                icon: <Trash2 className="w-4 h-4" />,
                onClick: () => handleDeleteChallan(challan),
                variant: 'destructive',
                disabled: !canDelete,
                disabledReason: 'You do not have permission to delete receive challans.',
            },
        ];
    };

    const holoEditTotals = useMemo(() => {
        if (process !== 'holo' || !receiveDraft) return null;
        const rollCount = Number(receiveDraft.rollCount || 0);
        const grossWeight = Number(receiveDraft.grossWeight || 0);
        const rollTypeWeight = Number((db.rollTypes || []).find(rt => rt.id === receiveDraft.rollTypeId)?.weight || 0);
        const boxWeight = Number((db.boxes || []).find(b => b.id === receiveDraft.boxId)?.weight || 0);
        const tare = roundTo3Decimals(rollTypeWeight * rollCount + boxWeight);
        const net = roundTo3Decimals(grossWeight - tare);
        return { tare, net };
    }, [process, receiveDraft, db.rollTypes, db.boxes]);

    const coningEditTotals = useMemo(() => {
        if (process !== 'coning' || !receiveDraft || !editingReceiveRow) return null;
        const issue = resolveConingIssue(editingReceiveRow);
        const coneType = resolveConingConeType(issue);
        const coneWeight = Number(coneType?.weight || 0);
        const boxWeight = Number((db.boxes || []).find(b => b.id === receiveDraft.boxId)?.weight || 0);
        const coneCount = Number(receiveDraft.coneCount || 0);
        const grossWeight = Number(receiveDraft.grossWeight || 0);
        const tare = roundTo3Decimals(boxWeight + coneWeight * coneCount);
        const net = roundTo3Decimals(grossWeight - tare);
        return { tare, net, coneTypeName: coneType?.name || '—', coneWeight };
    }, [process, receiveDraft, editingReceiveRow, db.boxes, db.issue_to_coning_machine, db.cone_types]);

    const handleExportHistory = async () => {
        let sourceRows = filteredHistory;
        if (v2Enabled && showHistory) {
            try {
                const res = await v2.exportV2ReceiveHistoryJson(process, {
                    search: searchTerm,
                    dateFrom: v2DateFrom,
                    dateTo: v2DateTo,
                    filters: JSON.stringify(v2Filters || []),
                });
                sourceRows = Array.isArray(res?.items) ? res.items : [];
            } catch (err) {
                alert(err?.message || 'Failed to export');
                return;
            }
        }
        let exportData;
        let columns;

        if (process === 'cutter') {
            exportData = sourceRows.map(row => {
                const piece = db.inbound_items?.find(p => p.id === row.pieceId);
                const item = db.items?.find(i => i.id === piece?.itemId);
                const resolvedCut = row.cutMaster?.name || (typeof row.cut === 'string' ? row.cut : row.cut?.name) || resolvePieceCutName(piece) || '—';
                const resolvedYarn = resolvePieceYarnName(piece) || '—';
                const resolvedTwist = resolvePieceTwistName(piece) || '—';
                return {
                    date: formatDateDDMMYYYY(row.date || row.createdAt),
                    item: row.itemName || item?.name || '—',
                    piece: row.pieceId || '—',
                    cut: resolvedCut,
                    yarn: resolvedYarn,
                    twist: resolvedTwist,
                    barcode: row.barcode || '—',
                    machine: row.machineNo || '—',
                    employee: row.operator?.name || '—',
                    netWt: formatKg(row.netWt),
                    bobbinQty: row.bobbinQuantity || 0,
                    bobbin: row.bobbin?.name || row.pcsTypeName || '—',
                };
            });
            columns = [
                { key: 'date', header: 'Date' },
                { key: 'item', header: 'Item' },
                { key: 'piece', header: 'Piece' },
                { key: 'cut', header: 'Cut' },
                { key: 'yarn', header: 'Yarn' },
                { key: 'twist', header: 'Twist' },
                { key: 'barcode', header: 'Barcode' },
                { key: 'machine', header: 'Machine' },
                { key: 'employee', header: 'Employee' },
                { key: 'netWt', header: 'Net Wt (kg)' },
                { key: 'bobbinQty', header: 'Bobbin Qty' },
                { key: 'bobbin', header: 'Bobbin' },
            ];
        } else if (process === 'holo') {
            exportData = sourceRows.map(row => {
                return {
                    date: formatDateDDMMYYYY(row.date || row.createdAt),
                    item: row.itemName || row.issue?.item?.name || '—',
                    cut: row.cutName || row.issue?.cut?.name || '—',
                    yarn: row.yarnName || row.issue?.yarn?.name || '—',
                    twist: row.twistName || row.issue?.twist?.name || '—',
                    piece: (row.computedPieceIds || row.pieceIdsList || []).join(', ') || '—',
                    barcode: row.barcode || '—',
                    rolls: row.rollCount || 0,
                    weight: formatKg(row.rollWeight ?? row.netWeight ?? row.grossWeight),
                    machine: row.machineNo || '—',
                    operator: row.operator?.name || '—',
                    helper: row.helper?.name || '—',
                    notes: row.note || row.notes || '',
                };
            });
            columns = [
                { key: 'date', header: 'Date' },
                { key: 'item', header: 'Item' },
                { key: 'cut', header: 'Cut' },
                { key: 'yarn', header: 'Yarn' },
                { key: 'twist', header: 'Twist' },
                { key: 'piece', header: 'Piece' },
                { key: 'barcode', header: 'Barcode' },
                { key: 'rolls', header: 'Rolls' },
                { key: 'weight', header: 'Weight (kg)' },
                { key: 'machine', header: 'Machine' },
                { key: 'operator', header: 'Operator' },
                { key: 'helper', header: 'Helper' },
                { key: 'notes', header: 'Notes' },
            ];
        } else {
            // Coning - resolve cut/yarn from referenced source rows
            exportData = sourceRows.map(row => {
                const coningIssue = row.issue || (db.issue_to_coning_machine?.find(i => i.id === row.issueId) || null);
                const item = row.itemName || coningIssue?.item?.name || (coningIssue?.itemId ? db.items?.find(i => i.id === coningIssue.itemId)?.name : '');
                const coneType = coningIssue ? resolveConingConeType(coningIssue) : null;
                const perConeNet = Number(coningIssue?.requiredPerConeNetWeight);
                const actualPerConeNet = formatActualPerCone(row.netWeight ?? row.grossWeight, row.coneCount);
                return {
                    date: formatDateDDMMYYYY(row.date || row.createdAt),
                    item: item || '—',
                    cut: row.cutName || coningIssue?.cut?.name || '—',
                    yarn: row.yarnName || coningIssue?.yarn?.name || '—',
                    twist: row.twistName || coningIssue?.twist?.name || '—',
                    piece: (row.computedPieceIds || row.pieceIdsList || []).join(', ') || '—',
                    barcode: row.barcode || '—',
                    coneType: coneType?.name || '—',
                    perConeNetG: Number.isFinite(perConeNet) && perConeNet > 0 ? perConeNet : '',
                    actualPerConeG: actualPerConeNet,
                    box: row.box?.name || '—',
                    cones: row.coneCount || 0,
                    weight: formatKg(row.netWeight ?? row.grossWeight),
                    machine: getConingMachineName(row),
                    operator: row.operator?.name || '—',
                    notes: row.note || row.notes || '',
                };
            });
            columns = [
                { key: 'date', header: 'Date' },
                { key: 'item', header: 'Item' },
                { key: 'cut', header: 'Cut' },
                { key: 'yarn', header: 'Yarn' },
                { key: 'twist', header: 'Twist' },
                { key: 'piece', header: 'Piece' },
                { key: 'barcode', header: 'Barcode' },
                { key: 'coneType', header: 'Cone Type' },
                { key: 'perConeNetG', header: 'Per Cone (g)' },
                { key: 'actualPerConeG', header: 'Actual Per Cone (g)' },
                { key: 'box', header: 'Box' },
                { key: 'cones', header: 'Cones' },
                { key: 'weight', header: 'Weight (kg)' },
                { key: 'machine', header: 'Machine' },
                { key: 'operator', header: 'Operator' },
                { key: 'notes', header: 'Notes' },
            ];
        }

        const today = new Date().toISOString().split('T')[0];
        exportHistoryToExcel(exportData, columns, `receive-history-${process}-${today}`);
    };

    const handleExportChallans = () => {
        const exportData = challans.map(c => {
            const meta = getCutterChallanMeta(c);
            return {
                challanNo: c.challanNo || '—',
                date: formatDateDDMMYYYY(c.date || c.createdAt),
                lot: c.lotNo || '—',
                item: meta.itemName,
                operator: meta.operatorName,
                cut: meta.cutName,
                totalNetWt: formatKg(c.totalNetWeight),
                totalBobbins: c.totalBobbinQty || 0,
            };
        });
        const columns = [
            { key: 'challanNo', header: 'Challan No' },
            { key: 'date', header: 'Date' },
            { key: 'lot', header: 'Lot' },
            { key: 'item', header: 'Item' },
            { key: 'operator', header: 'Operator' },
            { key: 'cut', header: 'Cut' },
            { key: 'totalNetWt', header: 'Total Net Wt (kg)' },
            { key: 'totalBobbins', header: 'Total Bobbins' },
        ];
        const today = new Date().toISOString().split('T')[0];
        exportHistoryToExcel(exportData, columns, `receive-challans-cutter-${today}`);
    };

    const emptyColSpan = process === 'cutter' ? 13 : process === 'holo' ? 14 : 17;

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle>Receive History ({process === 'cutter' ? 'Cutter' : process === 'holo' ? 'Holography' : 'Coning'})</CardTitle>
                {process === 'cutter' && (
                    <div className="inline-flex rounded-md border bg-muted/30 p-1">
                        <Button
                            variant={activeTab === 'history' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('history')}
                        >
                            History
                        </Button>
                        <Button
                            variant={activeTab === 'challan' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('challan')}
                        >
                            Challan
                        </Button>
                    </div>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
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
                        onClick={showChallans ? handleExportChallans : handleExportHistory}
                        className="h-9 px-3 rounded-md border border-primary bg-primary text-primary-foreground text-xs hover:bg-primary/90 font-medium flex items-center gap-1"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                </div>

                {showHistory && (
                    <>
                        <div ref={scrollRootRef} className="hidden sm:block rounded-md border max-h-[calc(100vh-280px)] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        {process === 'cutter' && (
                                            <>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Date</span>
                                                        <SheetColumnFilter column={columnFor('date')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Item</span>
                                                        <SheetColumnFilter column={columnFor('item')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Piece</span>
                                                        <SheetColumnFilter column={columnFor('piece')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Cut</span>
                                                        <SheetColumnFilter column={columnFor('cut')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>

                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Barcode</span>
                                                        <SheetColumnFilter column={columnFor('barcode')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Machine</span>
                                                        <SheetColumnFilter column={columnFor('machine')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Employee</span>
                                                        <SheetColumnFilter column={columnFor('employee')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Net Wt (kg)</span>
                                                        <SheetColumnFilter column={columnFor('netWt')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Bobbin Qty</span>
                                                        <SheetColumnFilter column={columnFor('bobbinQty')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Bobbin</span>
                                                        <SheetColumnFilter column={columnFor('bobbin')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Added By</span>
                                                        <SheetColumnFilter column={columnFor('addedBy')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
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
                                                        <SheetColumnFilter column={columnFor('date')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Item</span>
                                                        <SheetColumnFilter column={columnFor('item')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Cut</span>
                                                        <SheetColumnFilter column={columnFor('cut')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Yarn</span>
                                                        <SheetColumnFilter column={columnFor('yarn')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Twist</span>
                                                        <SheetColumnFilter column={columnFor('twist')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Piece</span>
                                                        <SheetColumnFilter column={columnFor('piece')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Barcode</span>
                                                        <SheetColumnFilter column={columnFor('barcode')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Rolls</span>
                                                        <SheetColumnFilter column={columnFor('rolls')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Weight (kg)</span>
                                                        <SheetColumnFilter column={columnFor('weight')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Machine</span>
                                                        <SheetColumnFilter column={columnFor('machine')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Operator</span>
                                                        <SheetColumnFilter column={columnFor('operator')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Helper</span>
                                                        <SheetColumnFilter column={columnFor('helper')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Notes</span>
                                                        <SheetColumnFilter column={columnFor('notes')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Added By</span>
                                                        <SheetColumnFilter column={columnFor('addedBy')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
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
                                                        <SheetColumnFilter column={columnFor('date')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Item</span>
                                                        <SheetColumnFilter column={columnFor('item')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Cut</span>
                                                        <SheetColumnFilter column={columnFor('cut')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Yarn</span>
                                                        <SheetColumnFilter column={columnFor('yarn')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Twist</span>
                                                        <SheetColumnFilter column={columnFor('twist')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Piece</span>
                                                        <SheetColumnFilter column={columnFor('piece')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Barcode</span>
                                                        <SheetColumnFilter column={columnFor('barcode')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Cone Type</span>
                                                        <SheetColumnFilter column={columnFor('coneType')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Per Cone (g)</span>
                                                        <SheetColumnFilter column={columnFor('perCone')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Actual (g)</span>
                                                        <SheetColumnFilter column={columnFor('actualG')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Box</span>
                                                        <SheetColumnFilter column={columnFor('box')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Cones</span>
                                                        <SheetColumnFilter column={columnFor('cones')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Weight (kg)</span>
                                                        <SheetColumnFilter column={columnFor('weight')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Machine</span>
                                                        <SheetColumnFilter column={columnFor('machine')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Operator</span>
                                                        <SheetColumnFilter column={columnFor('operator')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Notes</span>
                                                        <SheetColumnFilter column={columnFor('notes')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>Added By</span>
                                                        <SheetColumnFilter column={columnFor('addedBy')} rows={history} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                                                    </div>
                                                </TableHead>
                                                <TableHead className="w-[50px]">Actions</TableHead>
                                            </>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredHistory.length === 0 ? (
                                        <TableRow><TableCell colSpan={emptyColSpan} className="text-center py-4 text-muted-foreground">No records found.</TableCell></TableRow>
                                    ) : (
                                        <>
                                            {filteredHistory.map(r => {
                                                if (process === 'cutter') {
                                                    const infoItems = getCutterReceiveInfo(r);
                                                    const piece = db.inbound_items?.find(p => p.id === r.pieceId);
                                                    const item = db.items?.find(i => i.id === piece?.itemId);
                                                    const resolvedCut = r.cutMaster?.name || (typeof r.cut === 'string' ? r.cut : r.cut?.name) || resolvePieceCutName(piece) || '—';
                                                    const resolvedYarn = resolvePieceYarnName(piece) || '—';
                                                    const resolvedTwist = resolvePieceTwistName(piece) || '—';
                                                    const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';
                                                    return (
                                                        <TableRow key={r.id}>
                                                            <TableCell className="whitespace-nowrap"><HighlightMatch text={dateDisplay} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={item?.name || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell className="font-mono text-xs"><HighlightMatch text={r.pieceId} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={resolvedCut} query={searchTerm} /></TableCell>
                                                            <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={r.machineNo || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={r.operator?.name || r.employee || '—'} query={searchTerm} /></TableCell>
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
                                                            <TableCell><HighlightMatch text={r.bobbin?.name || r.pcsTypeName || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell>
                                                                <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                                                            </TableCell>
                                                            <TableCell><ActionMenu actions={getActions(r)} /></TableCell>
                                                        </TableRow>
                                                    );
                                                } else if (process === 'holo') {
                                                    // Prefer flattened v2 fields (fast, immediate). Fall back to legacy trace only if needed.
                                                    const issue = (!r.itemName || !r.cutName || !r.yarnName || !r.twistName)
                                                        ? db.issue_to_holo_machine?.find(i => i.id === r.issueId)
                                                        : null;
                                                    const item = issue ? db.items?.find(i => i.id === issue?.itemId) : null;
                                                    const resolved = issue ? resolveHoloTrace(issue, holoTraceContext) : null;
                                                    const itemName = r.itemName || item?.name || '—';
                                                    const cutName = r.cutName || resolved?.cutName || '—';
                                                    const yarnName = r.yarnName || resolved?.yarnName || '—';
                                                    const twistName = r.twistName || resolved?.twistName || '—';
                                                    const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';
                                                    return (
                                                        <TableRow key={r.id}>
                                                            <TableCell><HighlightMatch text={dateDisplay} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={itemName} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={cutName} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={yarnName} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={twistName} query={searchTerm} /></TableCell>
                                                            <TableCell className="max-w-[120px] truncate" title={(r.computedPieceIds || r.pieceIdsList || []).join(', ')}>
                                                                <HighlightMatch text={(r.computedPieceIds || r.pieceIdsList || []).join(', ') || '—'} query={searchTerm} />
                                                            </TableCell>
                                                            <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell className="text-right">{r.rollCount || 1}</TableCell>
                                                            <TableCell className="text-right font-medium">{formatKg(r.rollWeight ?? r.grossWeight)}</TableCell>
                                                            <TableCell><HighlightMatch text={r.machineNo || r.machine?.name || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={r.operator?.name || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={r.helper?.name || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]" title={r.note || r.notes}><HighlightMatch text={r.note || r.notes || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell>
                                                                <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                                                            </TableCell>
                                                            <TableCell><ActionMenu actions={getActions(r)} /></TableCell>
                                                        </TableRow>
                                                    );
                                                } else if (process === 'coning') {
                                                    // Prefer flattened v2 fields (fast, immediate). Fall back to legacy trace only if needed.
                                                    const coningIssue = (!r.itemName || !r.cutName || !r.yarnName || !r.twistName || !r.coneTypeName || r.perConeTargetG == null)
                                                        ? db.issue_to_coning_machine?.find(i => i.id === r.issueId)
                                                        : null;
                                                    const item = coningIssue ? db.items?.find(i => i.id === coningIssue?.itemId) : null;
                                                    const resolved = coningIssue ? resolveConingTrace(coningIssue, traceContext) : null;
                                                    const itemName = r.itemName || item?.name || '—';
                                                    const cutName = r.cutName || resolved?.cutName || '—';
                                                    const yarnName = r.yarnName || resolved?.yarnName || '—';
                                                    const twistName = r.twistName || resolved?.twistName || '—';
                                                    const coneType = coningIssue ? resolveConingConeType(coningIssue) : null;
                                                    const coneTypeName = r.coneTypeName || coneType?.name || '—';
                                                    const perConeNet = r.perConeTargetG ?? coningIssue?.requiredPerConeNetWeight;
                                                    const actualPerCone = formatActualPerCone(r.netWeight ?? r.grossWeight, r.coneCount);
                                                    const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';
                                                    return (
                                                        <TableRow key={r.id}>
                                                            <TableCell><HighlightMatch text={dateDisplay} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={itemName} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={cutName} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={yarnName} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={twistName} query={searchTerm} /></TableCell>
                                                            <TableCell className="max-w-[120px] truncate" title={(r.computedPieceIds || r.pieceIdsList || []).join(', ')}>
                                                                <HighlightMatch text={(r.computedPieceIds || r.pieceIdsList || []).join(', ') || '—'} query={searchTerm} />
                                                            </TableCell>
                                                            <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={coneTypeName} query={searchTerm} /></TableCell>
                                                            <TableCell className="text-right">{formatPerConeNet(perConeNet)}</TableCell>
                                                            <TableCell className="text-right">{actualPerCone}</TableCell>
                                                            <TableCell><HighlightMatch text={r.box?.name || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell className="text-right">{r.coneCount}</TableCell>
                                                            <TableCell className="text-right font-medium">{formatKg(r.netWeight ?? r.grossWeight)}</TableCell>
                                                            <TableCell><HighlightMatch text={getConingMachineName(r)} query={searchTerm} /></TableCell>
                                                            <TableCell><HighlightMatch text={r.operator?.name || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]" title={r.notes}><HighlightMatch text={r.notes || '—'} query={searchTerm} /></TableCell>
                                                            <TableCell>
                                                                <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                                                            </TableCell>
                                                            <TableCell><ActionMenu actions={getActions(r)} /></TableCell>
                                                        </TableRow>
                                                    );
                                                }
                                            })}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                            {/* Invisible infinite-scroll sentinel for v2 (no UI change). */}
                            <div ref={loadMoreRef} style={{ height: 1 }} aria-hidden="true" />
                        </div>
                        <div className="hidden sm:flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                            <span className="text-sm font-semibold">Grand Total (filtered)</span>
                            <div className="flex flex-wrap items-center justify-end gap-4 text-xs sm:text-sm">
                                {process === 'cutter' && (
                                    <>
                                        <span className="font-medium">Net Wt: {formatKg(totals.netWt)}</span>
                                        <span className="font-medium">Bobbin Qty: {totals.bobbinQty}</span>
                                    </>
                                )}
                                {process === 'holo' && (
                                    <>
                                        <span className="font-medium">Rolls: {totals.rolls}</span>
                                        <span className="font-medium">Weight: {formatKg(totals.weight)}</span>
                                    </>
                                )}
                                {process === 'coning' && (
                                    <>
                                        <span className="font-medium">Cones: {totals.cones}</span>
                                        <span className="font-medium">Weight: {formatKg(totals.weight)}</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Mobile Card View for Receive History */}
                        <div className="block sm:hidden space-y-3">
                            {filteredHistory.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No records found.</div>
                            ) : (
                                filteredHistory.map(r => {
                                    const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';

                                    if (process === 'cutter') {
                                        const piece = db.inbound_items?.find(p => p.id === r.pieceId);
                                        const item = db.items?.find(i => i.id === piece?.itemId);
                                        const resolvedCut = r.cutMaster?.name || (typeof r.cut === 'string' ? r.cut : r.cut?.name) || resolvePieceCutName(piece) || '—';
                                        const resolvedYarn = resolvePieceYarnName(piece) || '—';
                                        const resolvedTwist = resolvePieceTwistName(piece) || '—';
                                        return (
                                            <div key={r.id} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                                                <div className="p-4">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="font-mono text-xs text-primary">{r.barcode}</p>
                                                            <p className="font-medium mt-1">{item?.name || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                {dateDisplay} • {r.operator?.name || r.employee || '—'}
                                                            </p>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-mono font-semibold">{formatKg(r.netWt)}</div>
                                                            <div className="text-[10px] text-muted-foreground uppercase">{r.bobbinQuantity} bobbins</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <span>Cut: {resolvedCut}</span>
                                                            <span>Mac: {r.machineNo || '—'}</span>
                                                        </div>
                                                        <div>Yarn: {resolvedYarn} • Twist: {resolvedTwist}</div>
                                                    </div>
                                                </div>
                                                <div className="border-t bg-muted/30 px-4 py-2 flex justify-end">
                                                    <ActionMenu actions={getActions(r)} />
                                                </div>
                                            </div>
                                        );
                                    } else if (process === 'holo') {
                                        const issue = db.issue_to_holo_machine?.find(i => i.id === r.issueId);
                                        const item = db.items?.find(i => i.id === issue?.itemId);
                                        const resolved = issue ? resolveHoloTrace(issue, holoTraceContext) : { cutName: '—', yarnName: '—', twistName: '—' };
                                        return (
                                            <div key={r.id} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                                                <div className="p-4">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="font-mono text-xs text-primary">{r.barcode || '—'}</p>
                                                            <p className="font-medium mt-1">{item?.name || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">Cut: {resolved.cutName || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">Yarn: {resolved.yarnName || '—'} • Twist: {resolved.twistName || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1 truncate" title={(r.computedPieceIds || r.pieceIdsList || []).join(', ')}>
                                                                Piece: {(r.computedPieceIds || r.pieceIdsList || []).join(', ') || '—'}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                {dateDisplay} • {r.operator?.name || '—'}
                                                            </p>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-mono font-semibold">{formatKg(r.rollWeight ?? r.grossWeight)}</div>
                                                            <div className="text-[10px] text-muted-foreground uppercase">{r.rollCount || 1} roll{(r.rollCount || 1) !== 1 ? 's' : ''}</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                                        <span>Mac: {r.machineNo || r.machine?.name || '—'}</span>
                                                        {r.helper?.name && <span>Helper: {r.helper.name}</span>}
                                                    </div>
                                                </div>
                                                <div className="border-t bg-muted/30 px-4 py-2 flex justify-end">
                                                    <ActionMenu actions={getActions(r)} />
                                                </div>
                                            </div>
                                        );
                                    } else if (process === 'coning') {
                                        const coningIssue = db.issue_to_coning_machine?.find(i => i.id === r.issueId);
                                        const item = db.items?.find(i => i.id === coningIssue?.itemId);
                                        const resolved = coningIssue ? resolveConingTrace(coningIssue, traceContext) : { cutName: '—', yarnName: '—', twistName: '—' };
                                        const coneType = coningIssue ? resolveConingConeType(coningIssue) : null;
                                        const perConeNet = coningIssue?.requiredPerConeNetWeight;
                                        const actualPerCone = formatActualPerCone(r.netWeight ?? r.grossWeight, r.coneCount);
                                        return (
                                            <div key={r.id} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                                                <div className="p-4">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="font-mono text-xs text-primary">{r.barcode || '—'}</p>
                                                            <p className="font-medium mt-1">{item?.name || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">Cut: {resolved.cutName || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">Yarn: {resolved.yarnName || '—'} • Twist: {resolved.twistName || '—'}</p>
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                Cone: {coneType?.name || '—'} • Per Cone: {formatPerConeNet(perConeNet)}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                Actual: {actualPerCone}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground mt-1 truncate" title={(r.computedPieceIds || r.pieceIdsList || []).join(', ')}>
                                                                Piece: {(r.computedPieceIds || r.pieceIdsList || []).join(', ') || '—'}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                {dateDisplay} • {r.operator?.name || '—'}
                                                            </p>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-mono font-semibold">{formatKg(r.netWeight ?? r.grossWeight)}</div>
                                                            <div className="text-[10px] text-muted-foreground uppercase">{r.coneCount} cones</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                                        <span>Box: {r.box?.name || '—'}</span>
                                                        <span>Mac: {getConingMachineName(r)}</span>
                                                    </div>
                                                </div>
                                                <div className="border-t bg-muted/30 px-4 py-2 flex justify-end">
                                                    <ActionMenu actions={getActions(r)} />
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                })
                            )}
                        </div>
                    </>
                )}

                {showChallans && (
                    <>
                        <div className="hidden sm:block rounded-md border max-h-[calc(100vh-280px)] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Challan</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Lot</TableHead>
                                        <TableHead>Item</TableHead>
                                        <TableHead className="text-right">Total Kg</TableHead>
                                        <TableHead className="text-right">Bobbins</TableHead>
                                        <TableHead>Operator</TableHead>
                                        <TableHead>Cut</TableHead>
                                        <TableHead>Helper</TableHead>
                                        <TableHead>Note</TableHead>
                                        <TableHead className="w-[50px]">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {challans.length === 0 ? (
                                        <TableRow><TableCell colSpan={11} className="text-center py-4 text-muted-foreground">No challans found.</TableCell></TableRow>
                                    ) : (
                                        challans.map((challan) => {
                                            const meta = getCutterChallanMeta(challan);
                                            const dateDisplay = formatDateDDMMYYYY(challan.date || challan.createdAt) || '—';
                                            return (
                                                <TableRow key={challan.id}>
                                                    <TableCell className="font-mono text-xs"><HighlightMatch text={challan.challanNo} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={dateDisplay} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={challan.lotNo || '—'} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={meta.itemName} query={searchTerm} /></TableCell>
                                                    <TableCell className="text-right font-medium">{formatKg(challan.totalNetWeight)}</TableCell>
                                                    <TableCell className="text-right">{challan.totalBobbinQty || 0}</TableCell>
                                                    <TableCell><HighlightMatch text={meta.operatorName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={meta.cutName} query={searchTerm} /></TableCell>
                                                    <TableCell><HighlightMatch text={meta.helperName} query={searchTerm} /></TableCell>
                                                    <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]" title={challan.wastageNote || ''}>
                                                        <HighlightMatch text={challan.wastageNote || '—'} query={searchTerm} />
                                                    </TableCell>
                                                    <TableCell><ActionMenu actions={getChallanActions(challan)} /></TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Mobile Card View for Challans */}
                        <div className="block sm:hidden space-y-3">
                            {challans.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No challans found.</div>
                            ) : (
                                challans.map((challan) => {
                                    const meta = getCutterChallanMeta(challan);
                                    const dateDisplay = formatDateDDMMYYYY(challan.date || challan.createdAt) || '—';
                                    return (
                                        <div key={challan.id} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                                            <div className="p-4">
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-mono text-xs text-primary"><HighlightMatch text={challan.challanNo} query={searchTerm} /></p>
                                                        <p className="font-medium mt-1"><HighlightMatch text={meta.itemName} query={searchTerm} /></p>
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            <HighlightMatch text={dateDisplay} query={searchTerm} /> • Lot: <HighlightMatch text={challan.lotNo || '—'} query={searchTerm} />
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-mono font-semibold">{formatKg(challan.totalNetWeight)}</div>
                                                        <div className="text-[10px] text-muted-foreground uppercase">{challan.totalBobbinQty || 0} bobbins</div>
                                                    </div>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>Op: <HighlightMatch text={meta.operatorName} query={searchTerm} /> • Cut: <HighlightMatch text={meta.cutName} query={searchTerm} /></span>
                                                </div>
                                            </div>
                                            <div className="border-t bg-muted/30 px-4 py-2 flex justify-end">
                                                <ActionMenu actions={getChallanActions(challan)} />
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </>
                )}
            </CardContent>

            <Dialog open={Boolean(editingReceiveRow)} onOpenChange={(open) => { if (!open) closeReceiveEditor(); }}>
                <DialogContent
                    title={process === 'holo' ? 'Edit Holo Receive' : 'Edit Coning Receive'}
                    className="max-w-4xl"
                    onOpenChange={(open) => { if (!open) closeReceiveEditor(); }}
                >
                    {editingReceiveRow && receiveDraft && (
                        <div className="space-y-4">
                            <div className="text-xs text-muted-foreground">
                                Barcode {editingReceiveRow.barcode || editingReceiveRow.id || '—'}
                            </div>

                            {process === 'holo' && (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Date</label>
                                            <Input
                                                type="date"
                                                value={receiveDraft.date}
                                                onChange={(e) => updateReceiveDraft('date', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Piece</label>
                                            {editingReceiveRow.pieceId ? (
                                                <Input value={editingReceiveRow.pieceId} disabled />
                                            ) : (
                                                <Select
                                                    value={receiveDraft.pieceId}
                                                    onChange={(e) => updateReceiveDraft('pieceId', e.target.value)}
                                                    options={getEditPieceOptions(editingReceiveRow)}
                                                    labelKey="name"
                                                    valueKey="id"
                                                    placeholder="Select Piece"
                                                />
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Machine</label>
                                            <Select
                                                value={receiveDraft.machineNo}
                                                onChange={(e) => updateReceiveDraft('machineNo', e.target.value)}
                                                options={buildMachineNameOptions('holo', receiveDraft.machineNo)}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Machine"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Operator</label>
                                            <Select
                                                value={receiveDraft.operatorId}
                                                onChange={(e) => updateReceiveDraft('operatorId', e.target.value)}
                                                options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'holo').map(o => ({ id: o.id, name: o.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Operator"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Helper</label>
                                            <Select
                                                value={receiveDraft.helperId}
                                                onChange={(e) => updateReceiveDraft('helperId', e.target.value)}
                                                options={(db.helpers || []).filter(h => h.processType === 'all' || h.processType === 'holo').map(h => ({ id: h.id, name: h.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Helper"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Notes</label>
                                            <Input
                                                value={receiveDraft.notes}
                                                onChange={(e) => updateReceiveDraft('notes', e.target.value)}
                                                placeholder="Notes"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Roll Type</label>
                                            <Select
                                                value={receiveDraft.rollTypeId}
                                                onChange={(e) => updateReceiveDraft('rollTypeId', e.target.value)}
                                                options={(db.rollTypes || []).map(r => ({ id: r.id, name: r.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Roll Type"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Box</label>
                                            <Select
                                                value={receiveDraft.boxId}
                                                onChange={(e) => updateReceiveDraft('boxId', e.target.value)}
                                                options={(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'holo').map(b => ({ id: b.id, name: b.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Box"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Roll Count</label>
                                            <Input
                                                type="number"
                                                value={receiveDraft.rollCount}
                                                onChange={(e) => updateReceiveDraft('rollCount', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Gross Weight</label>
                                            <Input
                                                type="number"
                                                value={receiveDraft.grossWeight}
                                                onChange={(e) => updateReceiveDraft('grossWeight', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-between text-sm">
                                        <span>Tare: {formatKg(holoEditTotals?.tare || 0)}</span>
                                        <span className="font-bold">Net: {formatKg(holoEditTotals?.net || 0)}</span>
                                    </div>
                                </>
                            )}

                            {process === 'coning' && (
                                <>
                                    <div className="text-xs text-muted-foreground">
                                        Cone Type: {coningEditTotals?.coneTypeName || '—'}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Date</label>
                                            <Input
                                                type="date"
                                                value={receiveDraft.date}
                                                onChange={(e) => updateReceiveDraft('date', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Box</label>
                                            <Select
                                                value={receiveDraft.boxId}
                                                onChange={(e) => updateReceiveDraft('boxId', e.target.value)}
                                                options={(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'coning').map(b => ({ id: b.id, name: b.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Box"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Cone Count</label>
                                            <Input
                                                type="number"
                                                value={receiveDraft.coneCount}
                                                onChange={(e) => updateReceiveDraft('coneCount', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Gross Weight</label>
                                            <Input
                                                type="number"
                                                value={receiveDraft.grossWeight}
                                                onChange={(e) => updateReceiveDraft('grossWeight', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Machine</label>
                                            <Select
                                                value={receiveDraft.machineNo}
                                                onChange={(e) => updateReceiveDraft('machineNo', e.target.value)}
                                                options={buildMachineNameOptions('coning', receiveDraft.machineNo)}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Machine"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Operator</label>
                                            <Select
                                                value={receiveDraft.operatorId}
                                                onChange={(e) => updateReceiveDraft('operatorId', e.target.value)}
                                                options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'coning').map(o => ({ id: o.id, name: o.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Operator"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Helper</label>
                                            <Select
                                                value={receiveDraft.helperId}
                                                onChange={(e) => updateReceiveDraft('helperId', e.target.value)}
                                                options={(db.helpers || []).filter(h => h.processType === 'all' || h.processType === 'coning').map(h => ({ id: h.id, name: h.name }))}
                                                labelKey="name"
                                                valueKey="id"
                                                placeholder="Select Helper"
                                                clearable
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase">Notes</label>
                                            <Input
                                                value={receiveDraft.notes}
                                                onChange={(e) => updateReceiveDraft('notes', e.target.value)}
                                                placeholder="Notes"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-between text-sm">
                                        <span>Tare: {formatKg(coningEditTotals?.tare || 0)}</span>
                                        <span className="font-bold">Net: {formatKg(coningEditTotals?.net || 0)}</span>
                                    </div>
                                </>
                            )}

                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" onClick={closeReceiveEditor} disabled={savingReceive}>Cancel</Button>
                                <Button onClick={handleSaveReceiveEdits} disabled={savingReceive}>
                                    {savingReceive ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deletePrompt)} onOpenChange={(open) => { if (!open) setDeletePrompt(null); }}>
                <DialogContent
                    title="Confirm Delete"
                    className="max-w-md"
                    onOpenChange={(open) => { if (!open) setDeletePrompt(null); }}
                >
                    {deletePrompt && (
                        <div className="space-y-4">
                            <div className="text-sm">
                                Delete receive {deletePrompt.row?.barcode || deletePrompt.row?.id || '—'}? This will update totals.
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Piece</label>
                                <Select
                                    value={deletePrompt.pieceId}
                                    onChange={(e) => setDeletePrompt((prev) => (prev ? { ...prev, pieceId: e.target.value } : prev))}
                                    options={deletePrompt.pieceOptions}
                                    labelKey="name"
                                    valueKey="id"
                                    placeholder="Select Piece"
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" onClick={() => setDeletePrompt(null)} disabled={deletingReceive}>Cancel</Button>
                                <Button variant="destructive" onClick={confirmDeleteReceiveRow} disabled={deletingReceive || !deletePrompt.pieceId}>
                                    {deletingReceive ? 'Deleting...' : 'Delete'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(editingChallan)} onOpenChange={(open) => { if (!open) closeEditDialog(); }}>
                <DialogContent
                    title={`Edit Challan ${editingChallan?.challanNo || ''}`}
                    className="max-w-5xl"
                    onOpenChange={(open) => { if (!open) closeEditDialog(); }}
                >
                    <div className="space-y-4">
                        {editingChallan && (
                            <div className="text-xs text-muted-foreground">
                                Lot {editingChallan.lotNo || '—'} • Item {getCutterChallanMeta(editingChallan).itemName}
                            </div>
                        )}
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead>Box</TableHead>
                                        <TableHead className="text-right">Bobbin Qty</TableHead>
                                        <TableHead className="text-right">Gross (kg)</TableHead>
                                        <TableHead className="text-right">Tare (kg)</TableHead>
                                        <TableHead className="text-right">Net (kg)</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {editRows.length === 0 ? (
                                        <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">No entries found.</TableCell></TableRow>
                                    ) : (
                                        editRows.map((row) => {
                                            const isRemoved = removedRowIds.has(row.id);
                                            return (
                                                <TableRow key={row.id} className={isRemoved ? 'opacity-60 line-through' : ''}>
                                                    <TableCell className="font-mono text-xs">{row.barcode}</TableCell>
                                                    <TableCell>
                                                        <Select
                                                            value={row.boxId || ''}
                                                            onChange={(e) => updateEditRow(row.id, 'boxId', e.target.value)}
                                                            disabled={isRemoved}
                                                        >
                                                            <option value="">Select Box</option>
                                                            {(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'cutter').map(b => (
                                                                <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>
                                                            ))}
                                                        </Select>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Input
                                                            type="number"
                                                            value={row.bobbinQty}
                                                            onChange={(e) => updateEditRow(row.id, 'bobbinQty', e.target.value)}
                                                            disabled={isRemoved}
                                                            className="text-right"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Input
                                                            type="number"
                                                            value={row.grossWeight}
                                                            onChange={(e) => updateEditRow(row.id, 'grossWeight', e.target.value)}
                                                            disabled={isRemoved}
                                                            className="text-right"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-right">{formatKg(row.tareWeight)}</TableCell>
                                                    <TableCell className="text-right font-medium">{formatKg(row.netWeight)}</TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => toggleRemovedRow(row.id)}
                                                        >
                                                            {isRemoved ? <RotateCcw className="w-4 h-4" /> : <Trash2 className="w-4 h-4 text-destructive" />}
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={closeEditDialog} disabled={savingEdit}>Cancel</Button>
                            <Button onClick={handleSaveChallanEdits} disabled={savingEdit}>
                                {savingEdit ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(logChallan)} onOpenChange={(open) => { if (!open) setLogChallan(null); }}>
                <DialogContent
                    title={`Challan Log ${logChallan?.challanNo || ''}`}
                    className="max-w-xl"
                    onOpenChange={(open) => { if (!open) setLogChallan(null); }}
                >
                    <div className="space-y-3 max-h-[420px] overflow-y-auto">
                        {Array.isArray(logChallan?.changeLog) && logChallan.changeLog.length > 0 ? (
                            logChallan.changeLog.slice().reverse().map((entry, idx) => (
                                <div key={`${entry.at || idx}-${idx}`} className="border-b last:border-0 pb-2">
                                    <div className="text-sm font-medium">{entry.action || 'update'}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {formatDateTimeDDMMYYYY(entry.at) || entry.at || '—'}
                                    </div>
                                    {entry.details && (
                                        <div className="mt-1 text-xs text-muted-foreground space-y-1">
                                            {Object.entries(entry.details).map(([key, value]) => (
                                                <div key={key} className="flex justify-between gap-2">
                                                    <span>{key}</span>
                                                    <span className="font-medium">{String(value)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="text-sm text-muted-foreground">No log entries.</div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
