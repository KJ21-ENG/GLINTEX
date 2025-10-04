/**
 * PieceRow component for GLINTEX Inventory
 */

import React, { useState, useEffect } from 'react';
import { useBrand } from '../../context';
import { Input } from '../common';
import { formatKg } from '../../utils';
import * as api from '../../api';

export function PieceRow({ p, lotNo, selected, onToggle, onSaved, initialWeight = 0, pendingWeight = 0 }) {
  const { cls } = useBrand();
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(p.weight);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setWeight(p.weight); }, [p.weight]);

  async function save() {
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) { alert('Weight must be positive'); return; }
    setSaving(true);
    try {
      await api.updateInboundItem(p.id, { weight: Number(weight) });
      setEditing(false);
      onSaved && onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save piece');
    } finally {
      setSaving(false);
    }
  }

  const isAvailable = p.status === 'available';

  return (
    <tr className={`border-t ${cls.rowBorder} ${!isAvailable ? 'piece-disabled' : ''} row-hover`}>
      <td className="py-2 pr-2"><input type="checkbox" checked={selected} onChange={onToggle} disabled={!isAvailable} /></td>
      <td className="py-2 pr-2 font-mono">{p.id}</td>
      <td className="py-2 pr-2">{p.seq}</td>
      <td className="py-2 pr-2 text-right">
        <div className="flex items-center justify-end gap-2">
              {editing ? (
            <>
              <Input type="number" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} style={{ width: 120 }} />
              <button onClick={(e)=>{ e.stopPropagation(); setEditing(false); setWeight(p.weight); }} disabled={saving} title="Cancel" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} btn-hover`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-red-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <button onClick={(e)=>{ e.stopPropagation(); save(); }} disabled={saving} title="Save" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} btn-hover`}>
                {saving ? <svg xmlns="http://www.w3.org/2000/svg" className="animate-spin w-4 h-4 text-emerald-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8z"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-emerald-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>}
              </button>
            </>
          ) : (
            <>
              <span className="mr-2">{formatKg(p.weight)}</span>
              <button onClick={(e)=>{ e.stopPropagation(); setEditing(true); }} className={`text-sm ${cls.muted} underline-on-hover`} title="Edit weight" disabled={!isAvailable}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z"/></svg>
              </button>
            </>
          )}
        </div>
      </td>
      <td className="py-2 pr-2 text-right">{formatKg(pendingWeight)}</td>
    </tr>
  );
}
