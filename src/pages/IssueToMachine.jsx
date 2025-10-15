/**
 * IssueToMachine page component for GLINTEX Inventory
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Select, Pill, Pagination } from '../components';
import { IssueHistory } from './IssueHistory';
import { formatKg, todayISO } from '../utils';

export function IssueToMachine({ db, onIssueToMachine, refreshing, refreshDb }) {
  const { cls } = useBrand();
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [piecePage, setPiecePage] = useState(1);
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

  useEffect(() => {
    // Do not auto-select first lot; leave user to choose from Select
    if (!candidateLots.some(l => l.lotNo === lotNo)) setLotNo("");
  }, [candidateLots]);

  useEffect(() => { setSelected([]); }, [lotNo]);

  const availablePieces = useMemo(() => db.inbound_items
    .filter(ii => ii.lotNo===lotNo && ii.itemId===itemId && ii.status==='available')
    .sort((a,b)=> a.seq - b.seq), [db.inbound_items, lotNo, itemId]);

  const lastIssueForLot = useMemo(() => {
    const rows = db.issue_to_machine.filter(record => record.lotNo === lotNo).sort((a,b)=> b.date.localeCompare(a.date));
    return rows[0] || null;
  }, [db.issue_to_machine, lotNo]);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function selectAll() { setSelected(availablePieces.map(p=>p.id)); }
  function clearSel() { setSelected([]); }

  async function issue() {
    if (!date || !itemId || !lotNo || !machineId || !operatorId || selected.length===0) return;
    const availSet = new Set(availablePieces.map(p=>p.id));
    const chosen = selected.filter(id => availSet.has(id));
    if (chosen.length===0) { alert("Nothing to issue. Selected pieces are not available."); return; }
    setIssuing(true);
    try {
      await onIssueToMachine({ date, itemId, lotNo, pieceIds: chosen, note, machineId, operatorId });
      const picked = availablePieces.filter(p=> chosen.includes(p.id));
      const totalWeight = picked.reduce((s,p)=>s+p.weight,0);
      alert(`Issued ${chosen.length} pcs from Lot ${lotNo} (Total ${formatKg(totalWeight)} kg)`);
      setSelected([]);
      setNote("");
    } catch (err) {
      alert(err.message || 'Failed to issue pieces');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Issue to machine">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select</option>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot</label><Select value={lotNo} onChange={e=>setLotNo(e.target.value)}><option value="">Select</option>{candidateLots.length===0? <option>No lots</option> : candidateLots.map(l=> <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}</Select></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-3">
          <div><label className={`text-xs ${cls.muted}`}>Machine</label><Select value={machineId} onChange={e=>setMachineId(e.target.value)}><option value="">Select</option>{db.machines.length===0? <option>No machines</option> : db.machines.map(m=> <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Operator</label><Select value={operatorId} onChange={e=>setOperatorId(e.target.value)}><option value="">Select</option>{db.operators.length===0? <option>No operators</option> : db.operators.map(o=> <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Note (optional)</label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reference / reason" /></div>
        </div>

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
              <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Select</th><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
              <tbody>
                {availablePieces.length===0? <tr><td colSpan={3} className="py-4">No available pieces in this lot.</td></tr> : availablePieces.slice((piecePage-1)*piecePageSize, (piecePage-1)*piecePageSize + piecePageSize).map(p=> (
                  <tr key={p.id} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)} /></td>
                    <td className="py-2 pr-2 font-mono">{p.id}</td>
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
