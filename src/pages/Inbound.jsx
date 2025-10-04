/**
 * Inbound page component for GLINTEX Inventory
 */

import React, { useState, useEffect, useRef } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Select, Pill } from '../components';
import { CartPreview, RecentLots } from '../components/inbound';
import { formatKg, uid, todayISO } from '../utils';
import * as api from '../api';

export function Inbound({ db, onCreateLot, refreshing }) {
  const { cls } = useBrand();
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [firmId, setFirmId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [weight, setWeight] = useState("");
  const [previewLotNo, setPreviewLotNo] = useState("");
  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);

  // Keep selects empty by default; if current value disappears from DB, clear it
  useEffect(() => { if (db.items.length && !db.items.some(i => i.id === itemId)) setItemId(""); }, [db.items, itemId]);
  useEffect(() => { if (db.firms.length && !db.firms.some(f => f.id === firmId)) setFirmId(""); }, [db.firms, firmId]);
  useEffect(() => { if (db.suppliers.length && !db.suppliers.some(s => s.id === supplierId)) setSupplierId(""); }, [db.suppliers, supplierId]);

  // Fetch next sequence preview
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
        const j = await res.json();
        if (!cancelled) setPreviewLotNo(j.next);
      } catch (e) {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const canAdd = date && itemId && firmId && supplierId && Number(weight) > 0;
  const canSave = cart.length > 0 && date && itemId && firmId && supplierId && !saving;

  const weightRef = useRef(null);

  function addPiece() {
    if (!canAdd) return;
    const nextSeq = cart.length + 1;
    setCart([...cart, { seq: nextSeq, tempId: uid("piece"), weight: Number(weight) }]);
    setWeight("");
    // focus back to weight input
    setTimeout(() => { try { weightRef.current?.focus(); } catch (e) {} }, 0);
  }

  function removeFromCart(tempId) {
    setCart(cart.filter(c => c.tempId !== tempId).map((c, idx) => ({...c, seq: idx+1})));
  }

  async function saveLot() {
    if (!canSave) return;
    setSaving(true);
    try {
      const pieces = cart.map((row, idx) => ({ seq: idx + 1, weight: Number(row.weight) }));
      try {
        await onCreateLot({ date, itemId, firmId, supplierId, pieces });
      } catch (err) {
        // If lot already exists (race), refresh preview and retry once
        if ((err && String(err.message || '').toLowerCase().includes('lot already exists')) || (err && String(err.message || '').toLowerCase().includes('already exists'))) {
          try {
            const res = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
            const j = await res.json();
            setPreviewLotNo(j.next);
          } catch (e) {
            // ignore
          }
          // retry once
          await onCreateLot({ date, itemId, firmId, supplierId, pieces });
        } else {
          throw err;
        }
      }

      const totalPieces = cart.length;
      const totalWeight = cart.reduce((s, r) => s + (Number(r.weight)||0), 0);
      alert(`Saved Lot with ${totalPieces} pcs / ${formatKg(totalWeight)} kg`);

      // reset inbound form fields
      setCart([]);
      setWeight("");
      setDate(todayISO());
      setItemId("");
      setFirmId("");
      setSupplierId("");
      // focus back to weight input for quick entry
      try { weightRef.current?.focus(); } catch (e) {}

      // refresh preview
      try {
        const res2 = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
        const j2 = await res2.json();
        setPreviewLotNo(j2.next);
      } catch (e) {}
    } catch (err) {
      alert(err.message || 'Failed to save lot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="Inbound Receiving"
        actions={<Pill>Lot No is auto-generated from database sequence</Pill>}
      >
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>{setDate(e.target.value); setCart([]);}} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select</option>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Firm</label><Select value={firmId} onChange={e=>setFirmId(e.target.value)}><option value="">Select</option>{db.firms.length===0? <option>No firms</option> : db.firms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Supplier</label><Select value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Select</option>{db.suppliers.length===0? <option>No suppliers</option> : db.suppliers.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot No (preview)</label><Input value={previewLotNo} readOnly /></div>
          <div><label className={`text-xs ${cls.muted}`}>Weight (kg)</label><Input inputRef={weightRef} type="number" min="0" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); if(e.shiftKey){ saveLot(); } else { addPiece(); } } }} placeholder="e.g. 1.250" /></div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={addPiece} disabled={!canAdd}>Add</Button>
          <SecondaryButton onClick={()=>setCart([])} disabled={cart.length===0}>Clear Cart</SecondaryButton>
          <Button onClick={saveLot} disabled={!canSave || refreshing} className="ml-auto">{saving ? 'Saving…' : 'Save Lot'}</Button>
        </div>
        <CartPreview previewLotNo={previewLotNo} cart={cart} removeFromCart={removeFromCart} />
      </Section>
      <Section title="Recent Lots"><RecentLots db={db} /></Section>
    </div>
  );
}
