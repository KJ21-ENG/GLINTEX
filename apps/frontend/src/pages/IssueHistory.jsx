import React, { useMemo, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY } from '../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu } from '../components/ui';
import { Trash2, Printer } from 'lucide-react';
import * as api from '../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, printStageTemplatesBatch } from '../utils/labelPrint';

export function IssueHistory({ db, refreshDb }) {
  const { process } = useInventory();
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (issueId) => {
    if (!confirm('Are you sure you want to delete this issue record? This will make the pieces available again for re-issuing.')) {
      return;
    }
    setDeletingId(issueId);
    try {
      await api.deleteIssueToMachine(issueId, process);
      await refreshDb();
      alert('Issue record deleted.');
    } catch (err) {
      alert(err.message || 'Failed to delete issue record');
    } finally {
      setDeletingId(null);
    }
  };

  const handleReprint = async (row) => {
    try {
      let stageKey, data;

      if (process === 'cutter') {
        stageKey = LABEL_STAGE_KEYS.CUTTER_ISSUE;
        const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';
        const cut = db.cuts?.find(c => c.id === row.cutId)?.name || '';

        // Get inbound date from first piece
        const pieceList = Array.isArray(row.pieceIds) ? row.pieceIds : (row.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
        const firstPiece = db.inbound_items?.find(p => p.id === pieceList[0]);
        const lot = db.lots?.find(l => l.lotNo === row.lotNo);
        const inboundDate = lot?.date || firstPiece?.date || '';

        data = {
          lotNo: row.lotNo,
          itemName,
          pieceId: row.pieceIds,
          seq: firstPiece?.seq || '',
          count: row.count,
          totalWeight: row.totalWeight,
          machineName,
          operatorName,
          cut,
          inboundDate,
          date: row.date,
          barcode: row.barcode,
        };
      } else if (process === 'holo') {
        stageKey = LABEL_STAGE_KEYS.HOLO_ISSUE;
        const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';
        const yarnName = db.yarns?.find(y => y.id === row.yarnId)?.name || '';
        const twistName = db.twists?.find(t => t.id === row.twistId)?.name || '';

        // Get bobbin info and cut from receivedRowRefs
        let bobbinType = '';
        let bobbinQty = 0;
        let cut = '';
        let netWeight = 0;
        let totalRolls = row.metallicBobbins || 0;
        let totalWeight = row.metallicBobbinsWeight || 0;

        try {
          const refs = typeof row.receivedRowRefs === 'string' ? JSON.parse(row.receivedRowRefs) : row.receivedRowRefs;
          if (Array.isArray(refs) && refs.length > 0) {
            // Sum up bobbins from all refs
            refs.forEach(ref => {
              bobbinQty += Number(ref.issuedBobbins || 0);
            });

            // Get cut and bobbin type from first ref's source row
            const firstRef = refs[0];
            const cutterRow = db.receive_from_cutter_machine_rows?.find(r => !r.isDeleted && r.id === firstRef.rowId);
            if (cutterRow) {
              cut = cutterRow.cutMaster?.name || cutterRow.cut || db.cuts?.find(c => c.id === cutterRow.cutId)?.name || '';
              bobbinType = cutterRow.bobbin?.name || db.bobbins?.find(b => b.id === cutterRow.bobbinId)?.name || '';
              netWeight += Number(cutterRow.netWt || 0);
            }
          }
        } catch (e) { console.error('Error parsing receivedRowRefs', e); }

        data = {
          lotNo: row.lotNo,
          itemName,
          machineName,
          operatorName,
          yarnName,
          twistName,
          bobbinType,
          bobbinQty,
          totalRolls,
          totalWeight,
          netWeight: netWeight || totalWeight,
          metallicBobbins: row.metallicBobbins,
          metallicBobbinsWeight: row.metallicBobbinsWeight,
          yarnKg: row.yarnKg,
          cut,
          shift: row.shift,
          date: row.date,
          barcode: row.barcode,
        };
      } else if (process === 'coning') {
        stageKey = LABEL_STAGE_KEYS.CONING_ISSUE;
        const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';

        // Get coneType, wrapperName, and trace back to get cut, yarnName, rollType
        let coneType = '';
        let wrapperName = '';
        let cut = '';
        let yarnName = '';
        let rollType = '';
        let rollCount = 0;
        let totalRolls = 0;
        let totalWeight = 0;
        let netWeight = 0;
        let grossWeight = 0;
        let tareWeight = 0;

        try {
          const refs = typeof row.receivedRowRefs === 'string' ? JSON.parse(row.receivedRowRefs) : row.receivedRowRefs;
          if (Array.isArray(refs) && refs.length > 0) {
            const firstRef = refs[0];

            // Get cone type and wrapper from refs or form data stored in issue
            if (firstRef.coneTypeId) coneType = db.cone_types?.find(c => c.id === firstRef.coneTypeId)?.name || '';
            if (firstRef.wrapperId) wrapperName = db.wrappers?.find(w => w.id === firstRef.wrapperId)?.name || '';

            // Sum up rolls
            refs.forEach(ref => {
              rollCount += Number(ref.issueRolls || 0);
              totalRolls += Number(ref.issueRolls || 0);
              totalWeight += Number(ref.issueWeight || 0);
            });
            netWeight = totalWeight;

            // Trace back through holo receive -> holo issue -> cutter receive for cut, yarnName, rollType
            const holoRow = db.receive_from_holo_machine_rows?.find(r => r.id === firstRef.rowId);
            if (holoRow) {
              rollType = db.rollTypes?.find(rt => rt.id === holoRow.rollTypeId)?.name || '';

              const holoIssue = db.issue_to_holo_machine?.find(i => i.id === holoRow.issueId);
              if (holoIssue) {
                yarnName = db.yarns?.find(y => y.id === holoIssue.yarnId)?.name || '';

                // Get cut from cutter receive row
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
          lotNo: row.lotNo,
          itemName,
          machineName,
          operatorName,
          cut,
          yarnName,
          rollType,
          coneType,
          wrapperName,
          rollCount,
          totalRolls,
          totalWeight,
          grossWeight,
          tareWeight,
          netWeight,
          expectedCones: row.expectedCones,
          perConeTargetG: row.requiredPerConeNetWeight,
          shift: row.shift,
          date: row.date,
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
      // Silent success - printer handles feedback
    } catch (err) {
      alert(err.message || 'Failed to reprint sticker');
    }
  };

  const handlePrintSmallSticker = async (row) => {
    try {
      // Only for cutter process
      if (process !== 'cutter') return;

      // Ask for quantity
      const qtyInput = prompt('Enter quantity of stickers to print:', '1');
      if (qtyInput === null) return; // User cancelled
      const qty = parseInt(qtyInput, 10);
      if (!qty || qty < 1) {
        alert('Please enter a valid quantity (1 or more)');
        return;
      }

      const stageKey = LABEL_STAGE_KEYS.CUTTER_ISSUE_SMALL;
      const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
      const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
      const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';
      const cut = db.cuts?.find(c => c.id === row.cutId)?.name || '';

      // Get inbound date from first piece
      const pieceList = Array.isArray(row.pieceIds) ? row.pieceIds : (row.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
      const firstPiece = db.inbound_items?.find(p => p.id === pieceList[0]);
      const lot = db.lots?.find(l => l.lotNo === row.lotNo);
      const inboundDate = lot?.date || firstPiece?.date || '';

      const data = {
        lotNo: row.lotNo,
        itemName,
        pieceId: row.pieceIds,
        seq: firstPiece?.seq || '',
        count: row.count,
        totalWeight: row.totalWeight,
        machineName,
        operatorName,
        cut,
        inboundDate,
        date: row.date,
        barcode: row.barcode,
      };

      const template = await loadTemplate(stageKey);
      if (!template) {
        alert('No small sticker template found. Please configure it in Label Designer (Issue to machine (cutter)_small sticker).');
        return;
      }

      // Print the requested quantity in one go using batch utility
      await printStageTemplatesBatch(stageKey, [data], { template, copies: qty });
      // Silent success - printer handles feedback
    } catch (err) {
      alert(err.message || 'Failed to print small sticker');
    }
  };

  const issues = useMemo(() => {
    let rows = [];
    if (process === 'holo') {
      rows = db.issue_to_holo_machine || [];
    } else if (process === 'coning') {
      rows = db.issue_to_coning_machine || [];
    } else {
      rows = db.issue_to_cutter_machine || [];
    }
    // Sort by createdAt timestamp descending (latest first, considering time)
    return rows.slice().sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));
  }, [db, process]);

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

  const twistNameById = useMemo(() => {
    const map = new Map();
    (db.twists || []).forEach(t => map.set(t.id, t.name || '—'));
    return map;
  }, [db.twists]);

  const yarnNameById = useMemo(() => {
    const map = new Map();
    (db.yarns || []).forEach(y => map.set(y.id, y.name || '—'));
    return map;
  }, [db.yarns]);

  const getActions = (row) => {
    const actions = [
      {
        label: 'Reprint',
        icon: <Printer className="w-4 h-4" />,
        onClick: () => handleReprint(row),
      },
    ];

    // Add Print Small Stickers button for cutter process only
    if (process === 'cutter') {
      actions.push({
        label: 'Print Small Stickers',
        icon: <Printer className="w-4 h-4" />,
        onClick: () => handlePrintSmallSticker(row),
      });
    }

    actions.push({
      label: 'Delete',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => handleDelete(row.id),
      variant: 'destructive',
      disabled: deletingId === row.id,
    });

    return actions;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border max-h-[600px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {process === 'cutter' && (
                <>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Piece</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Note</TableHead>
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
                  <TableHead>Yarn</TableHead>
                  <TableHead>Twist</TableHead>
                  <TableHead>Metallic Bobbins</TableHead>
                  <TableHead>Met. Bob. Wt (kg)</TableHead>
                  <TableHead>Yarn Wt (kg)</TableHead>
                  <TableHead>Rolls Prod. Est.</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Note</TableHead>
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
                  <TableHead>Rolls Issued</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.length === 0 ? (
              <TableRow><TableCell colSpan={14} className="text-center py-4 text-muted-foreground">No issue records found for {process}.</TableCell></TableRow>
            ) : (
              issues.map((r) => (
                <TableRow key={r.id}>
                  {process === 'cutter' && (
                    <>
                      <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(r.date)}</TableCell>
                      <TableCell>{itemNameById.get(r.itemId)}</TableCell>
                      <TableCell className="max-w-[150px] truncate" title={r.pieceIds || ''}>{r.pieceIds || '—'}</TableCell>
                      <TableCell>{machineNameById.get(r.machineId)}</TableCell>
                      <TableCell>{operatorNameById.get(r.operatorId)}</TableCell>
                      <TableCell>{r.count}</TableCell>
                      <TableCell>{formatKg(r.totalWeight)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.barcode || r.id.substring(0, 8)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.note || ''}>{r.note || "—"}</TableCell>
                    </>
                  )}
                  {process === 'holo' && (
                    <>
                      <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(r.date)}</TableCell>
                      <TableCell>{itemNameById.get(r.itemId)}</TableCell>
                      <TableCell>{r.lotNo}</TableCell>
                      <TableCell>{machineNameById.get(r.machineId)}</TableCell>
                      <TableCell>{operatorNameById.get(r.operatorId)}</TableCell>
                      <TableCell>{yarnNameById.get(r.yarnId)}</TableCell>
                      <TableCell>{twistNameById.get(r.twistId)}</TableCell>
                      <TableCell>{r.metallicBobbins || 0}</TableCell>
                      <TableCell>{formatKg(r.metallicBobbinsWeight)}</TableCell>
                      <TableCell>{formatKg(r.yarnKg)}</TableCell>
                      <TableCell>{r.rollsProducedEstimate || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.barcode || r.id.substring(0, 8)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.note || ''}>{r.note || "—"}</TableCell>
                    </>
                  )}
                  {process === 'coning' && (
                    <>
                      <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(r.date)}</TableCell>
                      <TableCell>{itemNameById.get(r.itemId)}</TableCell>
                      <TableCell>{r.lotNo}</TableCell>
                      <TableCell>{machineNameById.get(r.machineId)}</TableCell>
                      <TableCell>{operatorNameById.get(r.operatorId)}</TableCell>
                      <TableCell>{r.count || r.rollsIssued || 0}</TableCell>
                      <TableCell className="font-mono text-xs">{r.barcode || r.id.substring(0, 8)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.note || ''}>{r.note || "—"}</TableCell>
                    </>
                  )}
                  <TableCell>
                    <ActionMenu actions={getActions(r)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
