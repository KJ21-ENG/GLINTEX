import React, { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Card, CardHeader, CardTitle, CardContent, ActionMenu, Button, Input, Select } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Printer, Edit2, Trash2, Download, History, RotateCcw } from 'lucide-react';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';
import { InfoPopover } from '../common/InfoPopover';

export function ReceiveHistoryTable() {
    const { db, process, refreshDb } = useInventory();
    const [activeTab, setActiveTab] = useState('history');
    const [editingChallan, setEditingChallan] = useState(null);
    const [editRows, setEditRows] = useState([]);
    const [removedRowIds, setRemovedRowIds] = useState(new Set());
    const [savingEdit, setSavingEdit] = useState(false);
    const [logChallan, setLogChallan] = useState(null);

    // Determine which collection to use based on process
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
        return rows.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }, [db, process]);

    const challans = useMemo(() => {
        if (process !== 'cutter') return [];
        const list = db.receive_from_cutter_machine_challans || [];
        return list
            .filter(challan => !challan.isDeleted)
            .slice()
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }, [db, process]);

    const bobbinMap = useMemo(() => new Map((db.bobbins || []).map(b => [b.id, b])), [db.bobbins]);
    const boxMap = useMemo(() => new Map((db.boxes || []).map(b => [b.id, b])), [db.boxes]);

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
                const list = affected.map(c => c.challanNo).join(', ');
                const ok = window.confirm(
                    `This change will remove the wastage note from challan(s): ${list}. Please reprint them. Continue?`
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
                const list = affected.map(c => c.challanNo).join(', ');
                const confirm = window.confirm(
                    `This delete will remove the wastage note from challan(s): ${list}. Please reprint them. Continue?`
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
        const meta = getCutterChallanMeta(challan);
        const dateDisplay = formatDateDDMMYYYY(challan.date || challan.createdAt) || '—';
        const note = challan.wastageNote ? `<div class="note"><strong>Note:</strong> ${challan.wastageNote}</div>` : '';
        const bodyRows = rows.map((row, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>${row.barcode || ''}</td>
              <td class="num">${formatKg(row.grossWt)}</td>
              <td class="num">${formatKg(row.tareWt)}</td>
              <td class="num">${formatKg(row.netWt)}</td>
              <td class="num">${row.bobbinQuantity || 0}</td>
              <td>${row.bobbin?.name || row.pcsTypeName || ''}</td>
              <td>${row.box?.name || row.pktTypeName || ''}</td>
            </tr>
        `).join('');

        return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Challan ${challan.challanNo}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 24px; font-size: 13px; margin-bottom: 12px; }
    .meta div { display: flex; justify-content: space-between; gap: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
    th { background: #f5f5f5; }
    .num { text-align: right; }
    .summary { margin-top: 10px; font-size: 13px; display: flex; justify-content: flex-end; gap: 16px; }
    .note { margin-top: 10px; padding: 8px; background: #fff7ed; border: 1px solid #fed7aa; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Receive Challan</h1>
  <div class="meta">
    <div><span>Challan No</span><strong>${challan.challanNo}</strong></div>
    <div><span>Date</span><strong>${dateDisplay}</strong></div>
    <div><span>Lot</span><strong>${challan.lotNo || '—'}</strong></div>
    <div><span>Item</span><strong>${meta.itemName}</strong></div>
    <div><span>Operator</span><strong>${meta.operatorName}</strong></div>
    <div><span>Cut</span><strong>${meta.cutName}</strong></div>
    <div><span>Helper</span><strong>${meta.helperName}</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Barcode</th>
        <th class="num">Gross (kg)</th>
        <th class="num">Tare (kg)</th>
        <th class="num">Net (kg)</th>
        <th class="num">Bobbins</th>
        <th>Bobbin</th>
        <th>Box</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="8">No entries</td></tr>'}
    </tbody>
  </table>
  <div class="summary">
    <div><strong>Total Net:</strong> ${formatKg(challan.totalNetWeight)} kg</div>
    <div><strong>Total Bobbins:</strong> ${challan.totalBobbinQty || 0}</div>
  </div>
  ${note}
</body>
</html>`;
    };

    const handleChallanPrint = async (challan) => {
        const rows = await resolveChallanRows(challan.id);
        const html = buildChallanPrintHtml(challan, rows);
        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) {
            alert('Popup blocked. Please allow popups to print.');
            return;
        }
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
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
            <CardContent>
                {showHistory && (
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
                )}

                {showChallans && (
                    <div className="rounded-md border max-h-[600px] overflow-y-auto">
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
