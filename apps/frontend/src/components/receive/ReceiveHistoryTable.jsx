import React, { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Card, CardHeader, CardTitle, CardContent, ActionMenu, Button, Input, Select } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Printer, Edit2, Trash2, Download, History, RotateCcw } from 'lucide-react';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { InfoPopover } from '../common/InfoPopover';
import { exportHistoryToExcel } from '../../services';

export function ReceiveHistoryTable() {
    const { db, process, refreshDb } = useInventory();
    const [activeTab, setActiveTab] = useState('history');
    const [editingChallan, setEditingChallan] = useState(null);
    const [editRows, setEditRows] = useState([]);
    const [removedRowIds, setRemovedRowIds] = useState(new Set());
    const [savingEdit, setSavingEdit] = useState(false);
    const [logChallan, setLogChallan] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const history = useMemo(() => {
        let rows = [];
        if (process === 'holo') {
            rows = db.receive_from_holo_machine_rows || [];
        } else if (process === 'coning') {
            rows = db.receive_from_coning_machine_rows || [];
        } else {
            rows = (db.receive_from_cutter_machine_rows || []).filter(row => !row.isDeleted);
        }
        // Sort by created date descending
        let sorted = rows.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        // Filter based on search and date
        return sorted.map(r => {
            let pieceIdsList = [];
            if (process === 'holo') {
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
            } else if (process === 'coning') {
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
            return { ...r, pieceIdsList };
        }).filter(r => {
            // Date filter
            if (startDate || endDate) {
                const itemDate = new Date(r.date || r.createdAt);
                if (startDate && itemDate < new Date(startDate)) return false;
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    if (itemDate > end) return false;
                }
            }

            // Search filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const barcode = (r.barcode || '').toLowerCase();
                const machine = (r.machineNo || '').toLowerCase();
                const operator = (r.operator?.name || '').toLowerCase();
                const notes = (r.note || r.notes || '').toLowerCase();
                const lot = (r.lotNo || r.issue?.lotNo || '').toLowerCase();
                const pieces = (r.pieceIdsList || []).join(' ').toLowerCase();

                return barcode.includes(term) ||
                    machine.includes(term) ||
                    operator.includes(term) ||
                    notes.includes(term) ||
                    lot.includes(term) ||
                    pieces.includes(term);
            }

            return true;
        });
    }, [db, process, searchTerm, startDate, endDate]);

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

        // Filter based on search and date
        return sorted.filter(c => {
            // Date filter - simple string comparison
            if (startDate || endDate) {
                const itemDateStr = (c.date || c.createdAt || '').substring(0, 10);
                if (startDate && itemDateStr < startDate) return false;
                if (endDate && itemDateStr > endDate) return false;
            }

            // Search filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const challanNo = (c.challanNo || '').toLowerCase();
                const lot = (c.lotNo || '').toLowerCase();
                const meta = getCutterChallanMeta(c);
                const itemName = (meta.itemName || '').toLowerCase();
                const operatorName = (meta.operatorName || '').toLowerCase();
                const note = (c.wastageNote || '').toLowerCase();

                return challanNo.includes(term) ||
                    lot.includes(term) ||
                    itemName.includes(term) ||
                    operatorName.includes(term) ||
                    note.includes(term);
            }

            return true;
        });
    }, [db, process, searchTerm, startDate, endDate]);

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
        const bobbinWeight = Number(bobbinMap.get(bobbinId)?.weight || 0);
        const boxWeight = Number(boxMap.get(boxId)?.weight || 0);
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

    const extractWastageFromNote = (note) => {
        if (!note) return 0;
        const match = String(note).match(/([0-9]+(?:\.[0-9]+)?)/);
        if (!match) return 0;
        const value = Number(match[1].replace(/,/g, ''));
        return Number.isFinite(value) ? roundTo3Decimals(value) : 0;
    };

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
                        const cutterRow = db.receive_from_cutter_machine_rows?.find(r => !r.isDeleted && r.id === refs[0].rowId);
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
                                    const cutterRow = db.receive_from_cutter_machine_rows?.find(r => !r.isDeleted && r.id === holoRefs[0].rowId);
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

    const recalcEditRow = (row) => {
        const bobbinWeight = Number(bobbinMap.get(row.bobbinId)?.weight || 0);
        const boxWeight = Number(boxMap.get(row.boxId)?.weight || 0);
        const qty = Number(row.bobbinQty || 0);
        const gross = Number(row.grossWeight || 0);
        const tare = boxWeight + bobbinWeight * qty;
        const net = gross - tare;
        return {
            ...row,
            tareWeight: Number.isFinite(tare) ? tare : 0,
            netWeight: Number.isFinite(net) ? net : 0,
            boxName: boxMap.get(row.boxId)?.name || row.boxName,
            bobbinName: bobbinMap.get(row.bobbinId)?.name || row.bobbinName
        };
    };

    const handleEditChallan = async (challan) => {
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
            await refreshDb();
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
                    await refreshDb();
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
        const ok = window.confirm(`Delete challan ${challan.challanNo}? This will revert its receive entries.`);
        if (!ok) return;
        try {
            await api.deleteCutterReceiveChallan(challan.id);
            await refreshDb();
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
                    await refreshDb();
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

    const getActions = (row) => [
        {
            label: 'Reprint',
            icon: <Printer className="w-4 h-4" />,
            onClick: () => handleReprint(row),
        },
    ];

    const getChallanActions = (challan) => ([
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
            label: 'Edit',
            icon: <Edit2 className="w-4 h-4" />,
            onClick: () => handleEditChallan(challan),
        },
        {
            label: 'View Log',
            icon: <History className="w-4 h-4" />,
            onClick: () => setLogChallan(challan),
        },
        {
            label: 'Delete',
            icon: <Trash2 className="w-4 h-4" />,
            onClick: () => handleDeleteChallan(challan),
            variant: 'destructive',
        },
    ]);

    const showHistory = process !== 'cutter' || activeTab === 'history';
    const showChallans = process === 'cutter' && activeTab === 'challan';

    const handleExportHistory = () => {
        let exportData;
        let columns;

        if (process === 'cutter') {
            exportData = history.map(row => {
                const piece = db.inbound_items?.find(p => p.id === row.pieceId);
                const item = db.items?.find(i => i.id === piece?.itemId);
                return {
                    date: formatDateDDMMYYYY(row.date || row.createdAt),
                    item: item?.name || '—',
                    piece: row.pieceId || '—',
                    cut: row.cutMaster?.name || row.cut || '—',
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
                { key: 'barcode', header: 'Barcode' },
                { key: 'machine', header: 'Machine' },
                { key: 'employee', header: 'Employee' },
                { key: 'netWt', header: 'Net Wt (kg)' },
                { key: 'bobbinQty', header: 'Bobbin Qty' },
                { key: 'bobbin', header: 'Bobbin' },
            ];
        } else if (process === 'holo') {
            exportData = history.map(row => {
                const issue = db.issue_to_holo_machine?.find(i => i.id === row.issueId);
                const item = db.items?.find(i => i.id === issue?.itemId);
                return {
                    date: formatDateDDMMYYYY(row.date || row.createdAt),
                    item: item?.name || '—',
                    piece: (row.pieceIdsList || []).join(', ') || '—',
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
            exportData = history.map(row => {
                const issue = db.issue_to_coning_machine?.find(i => i.id === row.issueId);
                const item = db.items?.find(i => i.id === issue?.itemId);
                return {
                    date: formatDateDDMMYYYY(row.date || row.createdAt),
                    item: item?.name || '—',
                    piece: (row.pieceIdsList || []).join(', ') || '—',
                    barcode: row.barcode || '—',
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
                { key: 'piece', header: 'Piece' },
                { key: 'barcode', header: 'Barcode' },
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
                <div className="flex flex-col sm:flex-row gap-4 items-end bg-muted/30 p-4 rounded-lg border">
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Search</label>
                        <input
                            type="text"
                            placeholder="Search by lot, barcode, operator, note..."
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
                        onClick={showChallans ? handleExportChallans : handleExportHistory}
                        className="h-9 px-3 rounded-md border border-primary bg-primary text-primary-foreground text-xs hover:bg-primary/90 font-medium flex items-center gap-1"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                </div>

                {showHistory && (
                    <div className="rounded-md border max-h-[600px] overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {process === 'cutter' && (
                                        <>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Item</TableHead>
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
                                            <TableHead>Piece</TableHead>
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
                                            <TableHead>Piece</TableHead>
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
                                            const piece = db.inbound_items?.find(p => p.id === r.pieceId);
                                            const item = db.items?.find(i => i.id === piece?.itemId);
                                            const dateDisplay = formatDateDDMMYYYY(r.date || r.createdAt) || '—';
                                            return (
                                                <TableRow key={r.id}>
                                                    <TableCell className="whitespace-nowrap">{dateDisplay}</TableCell>
                                                    <TableCell>{item?.name || '—'}</TableCell>
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
                                                    <TableCell className="max-w-[120px] truncate" title={(r.pieceIdsList || []).join(', ')}>
                                                        {(r.pieceIdsList || []).join(', ') || '—'}
                                                    </TableCell>
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
                                                    <TableCell className="max-w-[120px] truncate" title={(r.pieceIdsList || []).join(', ')}>
                                                        {(r.pieceIdsList || []).join(', ') || '—'}
                                                    </TableCell>
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
                )}

                {showChallans && (
                    <div className="rounded-md border max-h-[600px] overflow-auto">
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
                                                <TableCell className="font-mono text-xs">{challan.challanNo}</TableCell>
                                                <TableCell>{dateDisplay}</TableCell>
                                                <TableCell>{challan.lotNo || '—'}</TableCell>
                                                <TableCell>{meta.itemName}</TableCell>
                                                <TableCell className="text-right font-medium">{formatKg(challan.totalNetWeight)}</TableCell>
                                                <TableCell className="text-right">{challan.totalBobbinQty || 0}</TableCell>
                                                <TableCell>{meta.operatorName}</TableCell>
                                                <TableCell>{meta.cutName}</TableCell>
                                                <TableCell>{meta.helperName}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]" title={challan.wastageNote || ''}>
                                                    {challan.wastageNote || '—'}
                                                </TableCell>
                                                <TableCell><ActionMenu actions={getChallanActions(challan)} /></TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>

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
