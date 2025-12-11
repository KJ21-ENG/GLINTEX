import React, { useState, useEffect, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, todayISO } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';

export function IssueToHolo() {
  const { db, refreshDb } = useInventory();
  
  const [form, setForm] = useState({
    date: todayISO(),
    machineId: '',
    operatorId: '',
    yarnId: '',
    yarnKg: '',
    twistId: '',
    note: '',
  });
  
  const [crates, setCrates] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // --- Derived Data ---
  
  const holoTotals = useMemo(() => {
    return crates.reduce((acc, c) => ({
      rolls: acc.rolls + (Number(c.issuedBobbins) || 0),
      weight: acc.weight + (Number(c.issuedBobbinWeight) || 0)
    }), { rolls: 0, weight: 0 });
  }, [crates]);

  const meta = useMemo(() => {
    if (crates.length === 0) return { lotNo: '', itemId: '' };
    return {
      lotNo: crates[0].lotNo,
      itemId: crates[0].itemId
    };
  }, [crates]);

  // --- Handlers ---

  async function handleScan() {
      if (!scanInput.trim()) return;
      
      // Lookup in cutter receive rows
      const normalized = scanInput.trim().toUpperCase();
      const row = (db.receive_from_cutter_machine_rows || []).find(r => (r.barcode || '').toUpperCase() === normalized);
      
      if (!row) {
          alert('Barcode not found in Cutter Receive rows');
          return;
      }
      
      if (crates.some(c => c.rowId === row.id)) {
          alert('Crate already added');
          return;
      }

      // Check Lot Consistency
      const piece = db.inbound_items.find(p => p.id === row.pieceId);
      const rowLot = row.lotNo || piece?.lotNo;
      const rowItem = piece?.itemId;

      if (crates.length > 0) {
          if (rowLot !== meta.lotNo) { alert('Mixed lots not allowed'); return; }
          if (rowItem !== meta.itemId) { alert('Mixed items not allowed'); return; }
      }

      // Calculate Default Issue Qty (Available)
      const issuedCount = row.issuedBobbins || 0;
      const availCount = Math.max(0, (row.bobbinQuantity || 0) - issuedCount);
      
      const issuedWt = row.issuedBobbinWeight || 0;
      const availWt = Math.max(0, (row.netWt || 0) - issuedWt);

      const newCrate = {
          rowId: row.id,
          barcode: row.barcode,
          lotNo: rowLot,
          itemId: rowItem,
          availCount,
          availWt,
          issuedBobbins: availCount, // Default to all available
          issuedBobbinWeight: availWt
      };

      setCrates(prev => [...prev, newCrate]);
      setScanInput('');
  }

  function updateCrate(rowId, field, val) {
      setCrates(prev => prev.map(c => {
          if (c.rowId !== rowId) return c;
          const next = { ...c, [field]: val };
          
          // Auto-calc weight if count changes
          if (field === 'issuedBobbins') {
              const count = Number(val);
              const ratio = c.availCount > 0 ? count / c.availCount : 0;
              next.issuedBobbinWeight = Number((c.availWt * ratio).toFixed(3));
          }
          return next;
      }));
  }

  async function handleSubmit() {
      if (crates.length === 0) return;
      setSubmitting(true);
      try {
          const created = await api.createIssueToHoloMachine({
              date: form.date,
              itemId: meta.itemId,
              lotNo: meta.lotNo,
              machineId: form.machineId || null,
              operatorId: form.operatorId || null,
              yarnId: form.yarnId || null,
              twistId: form.twistId || null,
              metallicBobbins: holoTotals.rolls,
              metallicBobbinsWeight: holoTotals.weight,
              yarnKg: Number(form.yarnKg) || holoTotals.weight,
              note: form.note,
              crates: crates.map(c => ({
                  rowId: c.rowId,
                  issuedBobbins: Number(c.issuedBobbins),
                  issuedBobbinWeight: Number(c.issuedBobbinWeight)
              }))
          });
          const template = loadTemplate(LABEL_STAGE_KEYS.HOLO_ISSUE);
          if (template && created?.issueToHoloMachine) {
            const confirmPrint = window.confirm('Print sticker for this issue?');
            if (confirmPrint) {
              const machineName = db.machines.find((m) => m.id === form.machineId)?.name;
              const operatorName = db.operators.find((o) => o.id === form.operatorId)?.name;
              const itemName = db.items.find((i) => i.id === meta.itemId)?.name;
              const twistName = db.twists?.find((t) => t.id === form.twistId)?.name;
              const yarnName = db.yarns?.find((y) => y.id === form.yarnId)?.name;
              await printStageTemplate(
                LABEL_STAGE_KEYS.HOLO_ISSUE,
                {
                  lotNo: created.issueToHoloMachine.lotNo || meta.lotNo,
                  barcode: created.issueToHoloMachine.barcode,
                  itemName,
                  machineName,
                  operatorName,
                  totalRolls: holoTotals.rolls,
                  totalWeight: holoTotals.weight,
                  yarnKg: created.issueToHoloMachine.yarnKg,
                  twistName,
                  yarnName,
                  date: form.date,
                },
                { template },
              );
            }
          }
          await refreshDb();
          setCrates([]);
          setForm(prev => ({ ...prev, yarnKg: '', note: '' }));
          alert('Issued successfully');
      } catch (e) {
          alert(e.message);
      } finally {
          setSubmitting(false);
      }
  }

  return (
    <div className="space-y-6">
        <Card>
            <CardHeader><CardTitle>Issue Parameters</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <Label>Date</Label>
                        <Input type="date" value={form.date} onChange={e=>setForm({...form, date: e.target.value})} />
                    </div>
                    <div>
                        <Label>Machine</Label>
                        <Select value={form.machineId} onChange={e=>setForm({...form, machineId: e.target.value})}>
                            <option value="">Select Machine</option>
                            {db.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Operator</Label>
                        <Select value={form.operatorId} onChange={e=>setForm({...form, operatorId: e.target.value})}>
                            <option value="">Select Operator</option>
                            {db.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </Select>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <Label>Yarn</Label>
                        <Select value={form.yarnId} onChange={e=>setForm({...form, yarnId: e.target.value})}>
                            <option value="">Select Yarn</option>
                            {db.yarns?.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Twist</Label>
                        <Select value={form.twistId} onChange={e=>setForm({...form, twistId: e.target.value})}>
                            <option value="">Select Twist</option>
                            {db.twists?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                    </div>
                    <div>
                        <Label>Total Yarn Kg</Label>
                        <Input type="number" value={form.yarnKg} onChange={e=>setForm({...form, yarnKg: e.target.value})} placeholder={formatKg(holoTotals.weight)} />
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>Scan Crates</CardTitle>
                <div className="flex gap-2">
                    <Input 
                        placeholder="Scan Barcode" 
                        value={scanInput} 
                        onChange={e=>setScanInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleScan()} 
                        className="w-48"
                    />
                    <Button onClick={handleScan}>Add</Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Barcode</TableHead>
                                <TableHead>Lot</TableHead>
                                <TableHead className="">Avail Count</TableHead>
                                <TableHead className="">Issue Count</TableHead>
                                <TableHead className="">Issue Wt</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {crates.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No crates scanned.</TableCell></TableRow>
                            ) : crates.map((c, i) => (
                                <TableRow key={c.rowId}>
                                    <TableCell className="font-mono">{c.barcode}</TableCell>
                                    <TableCell>{c.lotNo}</TableCell>
                                    <TableCell className="">{c.availCount}</TableCell>
                                    <TableCell className="">
                                        <Input 
                                            type="number" 
                                            className="w-24 ml-auto h-8"
                                            value={c.issuedBobbins} 
                                            onChange={e => updateCrate(c.rowId, 'issuedBobbins', e.target.value)} 
                                        />
                                    </TableCell>
                                    <TableCell className="">{formatKg(c.issuedBobbinWeight)}</TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="sm" className="text-destructive" onClick={()=>setCrates(p => p.filter(x => x.rowId !== c.rowId))}>X</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <div className="mt-4 flex justify-between items-center">
                    <div className="text-sm font-medium">
                        Total Rolls: {holoTotals.rolls} | Total Weight: {formatKg(holoTotals.weight)}
                    </div>
                    <Button onClick={handleSubmit} disabled={submitting || crates.length === 0}>
                        {submitting ? 'Issuing...' : 'Confirm Issue'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    </div>
  );
}