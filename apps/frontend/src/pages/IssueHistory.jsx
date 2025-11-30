import React, { useMemo, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { formatKg } from '../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Button, Badge } from '../components/ui';
import { Trash2 } from 'lucide-react';
import * as api from '../api';

export function IssueHistory({ db, refreshDb }) {
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
      const rows = db.issue_to_cutter_machine || [];
      return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [db.issue_to_cutter_machine]);

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

  return (
    <div className="space-y-4">
      <div className="rounded-md border max-h-[600px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Lot</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Weight (kg)</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-4 text-muted-foreground">No issue records found.</TableCell></TableRow>
            ) : (
              issues.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                  <TableCell>{itemNameById.get(r.itemId)}</TableCell>
                  <TableCell>{r.lotNo}</TableCell>
                  <TableCell>{machineNameById.get(r.machineId)}</TableCell>
                  <TableCell>{operatorNameById.get(r.operatorId)}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{formatKg(r.totalWeight)}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.note || ''}>{r.note || "—"}</TableCell>
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