import React, { useMemo, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY } from '../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Button, Badge } from '../components/ui';
import { Trash2 } from 'lucide-react';
import * as api from '../api';

export function IssueHistory({ db, refreshDb }) {
  const { process } = useInventory();
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (issueId) => {
    if (!confirm('Are you sure you want to delete this issue record? This will make the pieces available again for re-issuing.')) {
      return;
    }
    setDeletingId(issueId);
    try {
      await api.deleteIssueToMachine(issueId);
      await refreshDb();
      alert('Issue record deleted.');
    } catch (err) {
      alert(err.message || 'Failed to delete issue record');
    } finally {
      setDeletingId(null);
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
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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
                  <TableHead>Qty</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Pieces</TableHead>
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
                      <TableCell>{r.lotNo}</TableCell>
                      <TableCell>{machineNameById.get(r.machineId)}</TableCell>
                      <TableCell>{operatorNameById.get(r.operatorId)}</TableCell>
                      <TableCell>{r.count}</TableCell>
                      <TableCell>{formatKg(r.totalWeight)}</TableCell>
                      <TableCell className="max-w-[150px] truncate" title={r.pieceIds || ''}>{r.pieceIds || '—'}</TableCell>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(r.id)}
                      disabled={deletingId === r.id}
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {deletingId === r.id ? '...' : <Trash2 className="w-4 h-4" />}
                    </Button>
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