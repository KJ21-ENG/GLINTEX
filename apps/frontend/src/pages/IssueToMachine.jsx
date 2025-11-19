/**
 * IssueToMachine page component for GLINTEX Inventory
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Select, Pill, Pagination } from '../components';
import { IssueHistory } from './IssueHistory';
import { formatKg, todayISO } from '../utils';
import { getProcessDefinition } from '../constants/processes';
import * as api from '../api';

const ensureArray = (value) => (Array.isArray(value) ? value : []);

export function IssueToMachine({ db, onIssueToMachine, refreshing, refreshDb, process = 'cutter' }) {
  const { cls } = useBrand();
  const processDef = getProcessDefinition(process);
  const isCutter = process === 'cutter';
  const issueList = ensureArray(db[processDef.issueKey]);
  const totalUnitsIssued = issueList.reduce((sum, issue) => {
    if (process === 'holo') return sum + Number(issue.metallicBobbins || 0);
    if (process === 'coning') return sum + Number(issue.rollsIssued || 0);
    return sum;
  }, 0);
  const [holoForm, setHoloForm] = useState({
    date: todayISO(),
    itemId: '',
    lotNo: '',
    machineId: '',
    operatorId: '',
    metallicBobbins: '',
    yarnKg: '',
    note: '',
    receivedRowRefs: '',
  });
  const [coningForm, setConingForm] = useState({
    date: todayISO(),
    itemId: '',
    lotNo: '',
    machineId: '',
    operatorId: '',
    rollsIssued: '',
    note: '',
    receivedRowRefs: '',
  });
  const [holoSubmitting, setHoloSubmitting] = useState(false);
  const [coningSubmitting, setConingSubmitting] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [piecePage, setPiecePage] = useState(1);
  const [barcodeScan, setBarcodeScan] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const piecePageSize = 50;

  useEffect(() => {
    if (db.items.length && !db.items.some(i => i.id === itemId)) {
      setItemId("");
    }
  }, [db.items, itemId]);

  useEffect(() => {
    if (db.machines.length && !db.machines.some(m => m.id === machineId)) {
      setMachineId("");
    }
  }, [db.machines, machineId]);

  useEffect(() => {
    if (db.operators.length && !db.operators.some(o => o.id === operatorId)) {
      setOperatorId("");
    }
  }, [db.operators, operatorId]);

  const candidateLots = useMemo(() => {
    const parse = (s) => (s && typeof s === 'string') ? s : '';
    return db.lots.filter(l => l.itemId === itemId).slice().sort((a, b) => {
      // prefer ISO dates if present on lot record, fall back to raw date
      const aDate = a.date || '';
      const bDate = b.date || '';
      // normalize to ISO using simple string patterns (YYYY-MM-DD > others)
      const aIso = a.date && a.date.match(/^\d{4}-\d{2}-\d{2}$/) ? a.date : parse(aDate);
      const bIso = b.date && b.date.match(/^\d{4}-\d{2}-\d{2}$/) ? b.date : parse(bDate);
      // localeCompare on ISO-like strings gives correct chronological ordering
      return (bIso || bDate).localeCompare(aIso || aDate);
    });
  }, [db.lots, itemId]);
  const [lotNo, setLotNo] = useState("");
  const [preserveSelectionOnLotChange, setPreserveSelectionOnLotChange] = useState(false);

  const setLotNoWithOptions = (nextLot, { preserveSelection = false } = {}) => {
    if (preserveSelection) {
      setPreserveSelectionOnLotChange(true);
    }
    setLotNo(nextLot);
  };

  useEffect(() => {
    // Do not auto-select first lot; leave user to choose from Select
    if (!candidateLots.some(l => l.lotNo === lotNo)) {
      setLotNoWithOptions("");
    }
  }, [candidateLots, lotNo]);

  useEffect(() => {
    if (preserveSelectionOnLotChange) {
      setPreserveSelectionOnLotChange(false);
      return;
    }
    setSelected([]);
  }, [lotNo, preserveSelectionOnLotChange]);

  const availablePieces = useMemo(() => db.inbound_items
    .filter(ii => ii.lotNo===lotNo && ii.itemId===itemId && ii.status==='available')
    .sort((a,b)=> a.seq - b.seq), [db.inbound_items, lotNo, itemId]);

  const lastIssueForLot = useMemo(() => {
    const rows = db.issue_to_cutter_machine.filter(record => record.lotNo === lotNo).sort((a,b)=> b.date.localeCompare(a.date));
    return rows[0] || null;
  }, [db.issue_to_cutter_machine, lotNo]);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function selectAll() { setSelected(availablePieces.map(p=>p.id)); }
  function clearSel() { setSelected([]); }

  async function handleBarcodeSubmit(e) {
    e.preventDefault();
    const code = barcodeScan.trim();
    if (!code) return;
    setScanLoading(true);
    try {
      const piece = await api.getInboundByBarcode(code);
      if (!piece) throw new Error('Barcode not found');
      if (piece.status !== 'available') throw new Error('Piece is not available');
      if (itemId !== piece.itemId) setItemId(piece.itemId);
      if (lotNo !== piece.lotNo) setLotNoWithOptions(piece.lotNo, { preserveSelection: true });
      setSelected(prev => (prev.includes(piece.id) ? prev : [...prev, piece.id]));
      alert(`Scanned ${piece.id} and added to selection`);
    } catch (err) {
      alert(err.message || 'Failed to lookup barcode');
    } finally {
      setBarcodeScan('');
      setScanLoading(false);
    }
  }

  async function issue() {
    if (!date || !itemId || !lotNo || !machineId || !operatorId || selected.length===0) return;
    const availSet = new Set(availablePieces.map(p=>p.id));
    const chosen = selected.filter(id => availSet.has(id));
    if (chosen.length===0) { alert("Nothing to issue. Selected pieces are not available."); return; }
    setIssuing(true);
    try {
      const result = await onIssueToMachine({ date, itemId, lotNo, pieceIds: chosen, note, machineId, operatorId });
      const picked = availablePieces.filter(p=> chosen.includes(p.id));
      const totalWeight = picked.reduce((s,p)=>s+p.weight,0);
      const crateSummary = result?.issueToMachine?.barcode
        ? `\nIssue barcode: ${result.issueToMachine.barcode}\nPrint multiple stickers with this code.`
        : '';
      alert(`Issued ${chosen.length} pcs from Lot ${lotNo} (Total ${formatKg(totalWeight)} kg)${crateSummary}`);
     setSelected([]);
      setNote("");
    } catch (err) {
      alert(err.message || 'Failed to issue pieces');
    } finally {
      setIssuing(false);
    }
  }

  useEffect(() => {
    setHoloForm(f => ({
      ...f,
      date: todayISO(),
      itemId: f.itemId || db.items[0]?.id || '',
      lotNo: '',
      machineId: '',
      operatorId: '',
      metallicBobbins: '',
      yarnKg: '',
      note: '',
      receivedRowRefs: '',
    }));
    setConingForm(f => ({
      ...f,
      date: todayISO(),
      itemId: f.itemId || db.items[0]?.id || '',
      lotNo: '',
      machineId: '',
      operatorId: '',
      rollsIssued: '',
      note: '',
      receivedRowRefs: '',
    }));
  }, [process, db.items]);

  async function handleHoloSubmit(e) {
    e.preventDefault();
    if (!holoForm.date || !holoForm.itemId || !holoForm.lotNo) {
      window.alert('Date, item, and lot are required');
      return;
    }
    if (!holoForm.metallicBobbins) {
      window.alert('Metallic bobbins count is required');
      return;
    }
    setHoloSubmitting(true);
    try {
      await api.createIssueToHoloMachine({
        date: holoForm.date,
        itemId: holoForm.itemId,
        lotNo: holoForm.lotNo,
        machineId: holoForm.machineId || null,
        operatorId: holoForm.operatorId || null,
        metallicBobbins: Number(holoForm.metallicBobbins),
        yarnKg: holoForm.yarnKg ? Number(holoForm.yarnKg) : 0,
        note: holoForm.note || null,
        receivedRowRefs: holoForm.receivedRowRefs.split(',').map(s => s.trim()).filter(Boolean),
      });
      window.alert('Issued to Holo machine');
      await refreshDb();
      setHoloForm(f => ({
        ...f,
        date: todayISO(),
        lotNo: '',
        machineId: '',
        operatorId: '',
        metallicBobbins: '',
        yarnKg: '',
        note: '',
        receivedRowRefs: '',
      }));
    } catch (err) {
      console.error('Failed to issue to holo', err);
      window.alert(err.message || 'Failed to issue to Holo machine');
    } finally {
      setHoloSubmitting(false);
    }
  }

  async function handleConingSubmit(e) {
    e.preventDefault();
    if (!coningForm.date || !coningForm.itemId || !coningForm.lotNo) {
      window.alert('Date, item, and lot are required');
      return;
    }
    if (!coningForm.rollsIssued) {
      window.alert('Rolls issued count is required');
      return;
    }
    setConingSubmitting(true);
    try {
      await api.createIssueToConingMachine({
        date: coningForm.date,
        itemId: coningForm.itemId,
        lotNo: coningForm.lotNo,
        machineId: coningForm.machineId || null,
        operatorId: coningForm.operatorId || null,
        rollsIssued: Number(coningForm.rollsIssued),
        note: coningForm.note || null,
        receivedRowRefs: coningForm.receivedRowRefs.split(',').map(s => s.trim()).filter(Boolean),
      });
      window.alert('Issued to Coning machine');
      await refreshDb();
      setConingForm(f => ({
        ...f,
        date: todayISO(),
        lotNo: '',
        machineId: '',
        operatorId: '',
        rollsIssued: '',
        note: '',
        receivedRowRefs: '',
      }));
    } catch (err) {
      console.error('Failed to issue to coning', err);
      window.alert(err.message || 'Failed to issue to Coning machine');
    } finally {
      setConingSubmitting(false);
    }
  }

  if (!isCutter) {
    const formState = process === 'holo' ? holoForm : coningForm;
    const setFormState = process === 'holo' ? setHoloForm : setConingForm;
    const submitting = process === 'holo' ? holoSubmitting : coningSubmitting;
    const handleFormSubmit = process === 'holo' ? handleHoloSubmit : handleConingSubmit;
    const unitLabel = process === 'holo' ? 'Metallic bobbins' : 'Rolls issued';
    const unitValueLabel = process === 'holo' ? 'metallicBobbins' : 'rollsIssued';

    return (
      <div className="space-y-6">
        <Section title={`Issue to ${processDef.label}`}>
          <form className="space-y-4" onSubmit={handleFormSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={`text-xs ${cls.muted}`}>Date</label>
                <Input type="date" value={formState.date} onChange={(e) => setFormState(prev => ({ ...prev, date: e.target.value }))} />
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Item</label>
                <Select value={formState.itemId} onChange={(e) => setFormState(prev => ({ ...prev, itemId: e.target.value }))}>
                  <option value="">Select</option>
                  {db.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Lot</label>
                <Input value={formState.lotNo} onChange={(e) => setFormState(prev => ({ ...prev, lotNo: e.target.value }))} placeholder="Lot number" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={`text-xs ${cls.muted}`}>Machine</label>
                <Select value={formState.machineId} onChange={(e) => setFormState(prev => ({ ...prev, machineId: e.target.value }))}>
                  <option value="">Select</option>
                  {db.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Operator</label>
                <Select value={formState.operatorId} onChange={(e) => setFormState(prev => ({ ...prev, operatorId: e.target.value }))}>
                  <option value="">Select</option>
                  {db.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>{unitLabel}</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={formState[unitValueLabel] ?? ''}
                  onChange={(e) => setFormState(prev => ({ ...prev, [unitValueLabel]: e.target.value }))}
                  placeholder={`Enter ${unitLabel.toLowerCase()}`}
                />
              </div>
            </div>

            {process === 'holo' && (
              <div>
                <label className={`text-xs ${cls.muted}`}>Yarn (kg)</label>
                <Input type="number" step="0.1" min="0" value={formState.yarnKg} onChange={(e) => setFormState(prev => ({ ...prev, yarnKg: e.target.value }))} />
              </div>
            )}

            <div>
              <label className={`text-xs ${cls.muted}`}>Received row refs (optional)</label>
              <Input value={formState.receivedRowRefs} onChange={(e) => setFormState(prev => ({ ...prev, receivedRowRefs: e.target.value }))} placeholder="comma separated receive row IDs" />
            </div>

            <div>
              <label className={`text-xs ${cls.muted}`}>Note</label>
              <Input value={formState.note} onChange={(e) => setFormState(prev => ({ ...prev, note: e.target.value }))} placeholder="Reference / reason" />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submitting}>{submitting ? 'Issuing…' : 'Record issue'}</Button>
              <Pill>{unitLabel}: {totalUnitsIssued}</Pill>
            </div>
          </form>
        </Section>

        <Section title={`Issue history (${processDef.label})`}>
          <div className="overflow-x-auto mt-4">
            <table className="min-w-full text-sm">
              <thead className={`text-left ${cls.muted}`}>
                <tr>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Lot</th>
                  <th className="py-2 pr-2 text-right">{unitLabel}</th>
                  {process === 'holo' && <th className="py-2 pr-2 text-right">Yarn (kg)</th>}
                  <th className="py-2 pr-2">Barcode</th>
                  <th className="py-2 pr-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {issueList.length === 0 ? (
                  <tr>
                    <td className="py-3 pr-2" colSpan={process === 'holo' ? 6 : 5}>No issue records yet.</td>
                  </tr>
                ) : (
                  issueList.map((issue) => (
                    <tr key={issue.id} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2">{issue.date || '—'}</td>
                      <td className="py-2 pr-2">{issue.lotNo}</td>
                      <td className="py-2 pr-2 text-right">{process === 'holo' ? issue.metallicBobbins || 0 : issue.rollsIssued || 0}</td>
                      {process === 'holo' && (
                        <td className="py-2 pr-2 text-right">{issue.yarnKg == null ? '—' : issue.yarnKg}</td>
                      )}
                      <td className="py-2 pr-2">{issue.barcode || '—'}</td>
                      <td className="py-2 pr-2">{issue.note || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Issue to machine">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select</option>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot</label><Select value={lotNo} onChange={e=>setLotNoWithOptions(e.target.value)}><option value="">Select</option>{candidateLots.length===0? <option>No lots</option> : candidateLots.map(l=> <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}</Select></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-3">
          <div><label className={`text-xs ${cls.muted}`}>Machine</label><Select value={machineId} onChange={e=>setMachineId(e.target.value)}><option value="">Select</option>{db.machines.length===0? <option>No machines</option> : db.machines.map(m=> <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Operator</label><Select value={operatorId} onChange={e=>setOperatorId(e.target.value)}><option value="">Select</option>{db.operators.length===0? <option>No operators</option> : db.operators.map(o=> <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Note (optional)</label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reference / reason" /></div>
        </div>

        <form onSubmit={handleBarcodeSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <div className="md:col-span-2">
            <label className={`text-xs ${cls.muted}`}>Scan roll barcode</label>
            <Input value={barcodeScan} onChange={e=>setBarcodeScan(e.target.value)} placeholder="Scan or type barcode" disabled={scanLoading} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={scanLoading || !barcodeScan.trim()}>{scanLoading ? 'Scanning…' : 'Apply'}</Button>
          </div>
        </form>

        <div className="mt-4 flex items-center gap-2">
          <Pill>Available: {availablePieces.length} pcs</Pill>
          <Pill>Selected: {selected.length} pcs</Pill>
          <SecondaryButton onClick={selectAll} disabled={availablePieces.length===0}>Select all</SecondaryButton>
          <SecondaryButton onClick={clearSel} disabled={selected.length===0}>Clear</SecondaryButton>
          <Button onClick={issue} disabled={selected.length===0 || refreshing || issuing} className="ml-auto">{issuing ? 'Issuing…' : 'Issue'}</Button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Select</th><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2">Barcode</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
              <tbody>
                {availablePieces.length===0? <tr><td colSpan={4} className="py-4">No available pieces in this lot.</td></tr> : availablePieces.slice((piecePage-1)*piecePageSize, (piecePage-1)*piecePageSize + piecePageSize).map(p=> (
                  <tr key={p.id} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)} /></td>
                    <td className="py-2 pr-2 font-mono">{p.id}</td>
                    <td className="py-2 pr-2">
                      {p.barcode ? (
                        <a href={api.barcodeImageUrl(p.barcode)} target="_blank" rel="noreferrer" className="underline text-xs">{p.barcode}</a>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-2 text-right">{formatKg(p.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2">
              <Pagination total={availablePieces.length} page={piecePage} setPage={setPiecePage} pageSize={piecePageSize} />
            </div>
          </div>

          <div className={`p-3 rounded-xl border ${cls.cardBorder} ${cls.cardBg}`}>
            <div className={`mb-2 font-medium`}>Last issued in this lot</div>
            {!lastIssueForLot? (
              <div className={`text-sm ${cls.muted}`}>No past issues for this lot.</div>
            ) : (
              <div className="text-sm">
                <div className={`${cls.muted} mb-1`}>{lastIssueForLot.date} · {lastIssueForLot.count} pcs · {formatKg(lastIssueForLot.totalWeight)} kg</div>
                <div className="flex flex-wrap gap-1">
                  {lastIssueForLot.pieceIds.map(id => <span key={id} className={`px-2 py-0.5 rounded-md text-xs border ${cls.pill} font-mono`}>{id}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Issue History"><IssueHistory db={db} refreshDb={refreshDb} /></Section>
    </div>
  );
}
