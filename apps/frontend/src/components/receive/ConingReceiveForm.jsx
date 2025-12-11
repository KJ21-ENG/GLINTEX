import React, { useState, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, todayISO, uid } from '../../utils';
import * as api from '../../api';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';

export function ConingReceiveForm() {
  const { db, refreshDb } = useInventory();
  
  const [scanInput, setScanInput] = useState('');
  const [issue, setIssue] = useState(null);
  const [cart, setCart] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [receiveDate, setReceiveDate] = useState(todayISO());

  // --- Derived ---
  const perConeWeight = Number(issue?.requiredPerConeNetWeight || 0);
  const totalExpected = Number(issue?.expectedCones || 0);

  // --- Handlers ---
  async function handleScan() {
      if (!scanInput.trim()) return;
      try {
          // Expecting Issue Barcode (CN-...)
          // Note: The original logic might have scanned receive crates first, but usually we load the Issue context first.
          // Assuming we scan the Issue Barcode to start.
          
          // Since the API might not have a direct lookup for coning issue by barcode in the client sdk explicitly named,
          // we can try finding it in the loaded DB issues if available, or assume `getIssueByBarcode` works.
          // In the original code, `lookupIssue` filtered `db.issue_to_coning_machine`.
          
          const found = db.issue_to_coning_machine.find(i => (i.barcode || '').toUpperCase() === scanInput.trim().toUpperCase());
          
          if (found) {
              setIssue(found);
              setCart([]);
          } else {
              alert('Issue not found');
          }
      } catch (e) {
          alert(e.message);
          setIssue(null);
      } finally {
          setScanInput('');
      }
  }

  function addCartRow() {
      setCart(prev => [...prev, {
          id: uid(),
          coneCount: '',
          grossWeight: '',
          boxId: '',
          notes: '',
          operatorId: issue?.operatorId || ''
      }]);
  }

  function updateRow(id, field, val) {
      setCart(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
  }

  function calcRowNet(row) {
      const gross = Number(row.grossWeight);
      if (!gross) return 0;
      
      const box = db.boxes.find(b => b.id === row.boxId);
      const boxWt = box?.weight || 0;
      
      // Cone Tare? 
      // We need to know the cone type from the issue.
      const coneTypeId = issue?.receivedRowRefs?.[0]?.coneTypeId;
      const coneType = db.cone_types.find(c => c.id === coneTypeId);
      const coneWt = (coneType?.weight || 0) * Number(row.coneCount);
      
      return Math.max(0, gross - boxWt - coneWt);
  }

  async function handleSubmit() {
      if (!issue || cart.length === 0) return;
      setSubmitting(true);
      try {
          const template = loadTemplate(LABEL_STAGE_KEYS.CONING_RECEIVE);
          const confirmPrint = template ? window.confirm('Print stickers for these receives?') : false;
          const existingRows = (db.receive_from_coning_machine_rows || []).filter((r) => r.issueId === issue.id);
          const baseCount = existingRows.length;
          const baseCode = issue.barcode || issue.lotNo || issue.id;
          for (const row of cart) {
              await api.manualReceiveFromConingMachine({
                  issueId: issue.id,
                  pieceId: issue.id, // Coning treats the issue as the unit usually
                  coneCount: Number(row.coneCount),
                  boxId: row.boxId,
                  grossWeight: Number(row.grossWeight),
                  date: receiveDate,
                  operatorId: row.operatorId,
                  notes: row.notes
              });
              if (confirmPrint) {
                const index = cart.indexOf(row);
                const paddedIndex = String(baseCount + index + 1).padStart(3, '0');
                const barcode = `RCN-${baseCode}-${paddedIndex}`;
                const boxName = db.boxes.find((b) => b.id === row.boxId)?.name;
                const operatorName = db.operators.find((o) => o.id === row.operatorId)?.name;
                await printStageTemplate(
                  LABEL_STAGE_KEYS.CONING_RECEIVE,
                  {
                    lotNo: issue.lotNo,
                    issueBarcode: issue.barcode,
                    barcode,
                    coneCount: row.coneCount,
                    grossWeight: row.grossWeight,
                    netWeight: calcRowNet(row),
                    boxName,
                    operatorName,
                    date: receiveDate,
                  },
                  { template },
                );
              }
          }
          await refreshDb();
          setCart([]);
          alert('Received successfully');
      } catch (e) {
          alert(e.message);
      } finally {
          setSubmitting(false);
      }
  }

  return (
    <div className="space-y-6">
        <Card>
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>Scan Coning Issue</CardTitle>
                <div className="flex gap-2">
                    <Input 
                        placeholder="Scan Issue (CN-...)" 
                        value={scanInput} 
                        onChange={e=>setScanInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleScan()} 
                        className="w-64"
                    />
                    <Button onClick={handleScan}>Load</Button>
                </div>
            </CardHeader>
            {issue && (
                <CardContent className="space-y-6">
                    <div className="flex gap-4 p-4 bg-muted rounded-md text-sm">
                        <div><strong>Lot:</strong> {issue.lotNo}</div>
                        <div><strong>Expected:</strong> {totalExpected} cones</div>
                        <div><strong>Target:</strong> {perConeWeight} g/cone</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div><Label>Date</Label><Input type="date" value={receiveDate} onChange={e=>setReceiveDate(e.target.value)} /></div>
                        <div className="flex items-end">
                            <Button onClick={addCartRow}>Add Crate</Button>
                        </div>
                    </div>

                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Box</TableHead>
                                    <TableHead>Cones</TableHead>
                                    <TableHead>Gross</TableHead>
                                    <TableHead>Net (Calc)</TableHead>
                                    <TableHead>Operator</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cart.map(row => (
                                    <TableRow key={row.id}>
                                        <TableCell>
                                            <Select value={row.boxId} onChange={e=>updateRow(row.id, 'boxId', e.target.value)}>
                                                <option value="">Select</option>
                                                {db.boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Input type="number" value={row.coneCount} onChange={e=>updateRow(row.id, 'coneCount', e.target.value)} className="h-8" />
                                        </TableCell>
                                        <TableCell>
                                            <Input type="number" value={row.grossWeight} onChange={e=>updateRow(row.id, 'grossWeight', e.target.value)} className="h-8" />
                                        </TableCell>
                                        <TableCell className="">
                                            {formatKg(calcRowNet(row))}
                                        </TableCell>
                                        <TableCell>
                                            <Select value={row.operatorId} onChange={e=>updateRow(row.id, 'operatorId', e.target.value)} className="h-8">
                                                <option value="">Select</option>
                                                {db.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" className="text-destructive" onClick={()=>setCart(p=>p.filter(x=>x.id!==row.id))}>X</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={handleSubmit} disabled={submitting || cart.length === 0}>Save Receive</Button>
                    </div>
                </CardContent>
            )}
        </Card>
    </div>
  );
}