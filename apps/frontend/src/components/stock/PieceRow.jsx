/**
 * PieceRow component for GLINTEX Inventory
 */

import React, { useState, useEffect, useRef } from 'react';
import { useBrand } from '../../context';
import { Input } from '../common';
import { ContextMenu } from '../common';
import { formatKg } from '../../utils';
import * as api from '../../api';

export function PieceRow({ p, lotNo, selected, onToggle, onSaved, initialWeight = 0, pendingWeight = 0, isIssued = false, wastageWeight = 0, totalUnits = 0, onMarkWastage, isMarking = false }) {
  const { cls, theme } = useBrand();
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(p.weight);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setWeight(p.weight); }, [p.weight]);

  // Treat a piece as "wastage marked" when its pending weight reaches 0 and
  // it has a recorded wastage weight. Only in that case apply strike-through
  // and disabled formatting in the expanded view.
  const isWastageMarked = Number(pendingWeight || 0) === 0 && Number(wastageWeight || 0) > 0;

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
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });
  const rowRef = useRef(null);

  function openContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    // prefer actual click coordinates, but fall back to bounding rect if coords are missing
    const clickX = (typeof e.clientX === 'number') ? e.clientX : (rowRef.current ? rowRef.current.getBoundingClientRect().left : 0);
    const clickY = (typeof e.clientY === 'number') ? e.clientY : (rowRef.current ? rowRef.current.getBoundingClientRect().top : 0);
    setCtxPos({ x: clickX, y: clickY });
    setCtxOpen(true);
  }

  function closeContextMenu() { setCtxOpen(false); }

  return (
    <>
    <tr ref={rowRef} onContextMenu={openContextMenu} className={`border-t ${cls.rowBorder} ${isWastageMarked ? 'piece-disabled' : ''} row-hover`}>
      <td className="py-2 pr-2"><input type="checkbox" checked={selected} onChange={onToggle} disabled={!isAvailable} /></td>
      <td className="py-2 pr-2 font-mono">{p.id}</td>
      <td className="py-2 pr-2">
        {p.barcode ? (
          <a href={api.barcodeImageUrl(p.barcode)} target="_blank" rel="noreferrer" className="underline text-xs">
            {p.barcode}
          </a>
        ) : '—'}
      </td>
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
              <span className={`mr-2 ${isWastageMarked ? 'line-through' : ''}`}>{formatKg(p.weight)}</span>
            </>
          )}
        </div>
      </td>
      <td className="py-2 pr-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <span style={{ textDecoration: 'none', textDecorationLine: 'none', textDecorationColor: 'transparent', opacity: 1, display: 'inline-block' }}>
            {formatKg(pendingWeight)}
            {wastageWeight > 0 && (
              <span className="ml-2 text-xs text-slate-400" style={{ textDecoration: 'none', textDecorationLine: 'none', textDecorationColor: 'transparent', opacity: 1, display: 'inline-block' }}>
                ({formatKg(wastageWeight)} kg, {((p.weight && p.weight > 0) ? ((wastageWeight / p.weight) * 100) : 0).toFixed(2)}%)
              </span>
            )}
          </span>
          {wastageWeight > 0 ? (
            <span className="ml-2 text-xs text-slate-400" style={{ textDecoration: 'none', textDecorationLine: 'none', textDecorationColor: 'transparent', opacity: 1, display: 'inline-block' }}>
              ({formatKg(wastageWeight)} kg, {((p.weight && p.weight > 0) ? ((wastageWeight / p.weight) * 100) : 0).toFixed(2)}%)
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-2 pr-2 text-right">{totalUnits || 0}</td>
    </tr>
    <ContextMenu open={ctxOpen} x={ctxPos.x} y={ctxPos.y} onClose={closeContextMenu}>
      <div className="text-xs">
        {(() => {
          const itemHover = theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-slate-100';
          const itemText = theme === 'dark' ? 'text-white' : 'text-slate-900';
          return (
            <>
              {(() => {
                const canEdit = !isWastageMarked && !isIssued;
                const canMarkWastage = isIssued && pendingWeight > 0 && wastageWeight === 0;
                const editClass = `${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`;
                const markClass = `${!canMarkWastage ? 'opacity-50 cursor-not-allowed' : ''}`;
                return (
                  <>
                    <button
                      className={`w-full text-left px-3 py-2 ${itemHover} ${itemText} ${editClass}`}
                      onClick={(e)=>{ e.stopPropagation(); if (!canEdit) return; setEditing(true); closeContextMenu(); }}
                      disabled={!canEdit}
                    >
                      Edit weight
                    </button>

                    <button
                      className={`w-full text-left px-3 py-2 ${itemHover} ${itemText} ${markClass}`}
                      onClick={(e)=>{ e.stopPropagation(); if (!canMarkWastage) return; onMarkWastage(p.id); closeContextMenu(); }}
                      disabled={!canMarkWastage || isMarking}
                    >
                      Mark wastage
                    </button>
                  </>
                );
              })()}
            </>
          );
        })()}
      </div>
    </ContextMenu>
    </>
  );
}
