/**
 * BobbinEditor component for editing bobbin name and weight
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useBrand } from '../../context';
import { Input } from './Input.jsx';
import { Button } from './Button.jsx';
import { SecondaryButton } from './SecondaryButton.jsx';
import { formatKg } from '../../utils/formatting.js';

export function BobbinEditor({ items = [], onAdd, onDelete, onEdit, disabled = false, className = '' }) {
  const { cls } = useBrand();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);
  const nameInputRef = useRef(null);
  const timerRef = useRef(null);

  const normalized = name.trim().toLowerCase();
  const isDuplicate = normalized !== '' && items.some(i => i.name.trim().toLowerCase() === normalized);

  const filtered = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [items, name]);

  async function handleAdd() {
    const bobbinName = name.trim();
    if (!bobbinName) return;
    if (isDuplicate) return;
    if (typeof onAdd !== 'function') return;
    
    const weightNum = weight.trim() ? Number(weight.trim()) : null;
    if (weightNum !== null && (!Number.isFinite(weightNum) || weightNum < 0)) {
      setMessage({ text: 'Weight must be a positive number', type: 'error' });
      return;
    }

    setWorking(true);
    try {
      await onAdd(bobbinName, weightNum);
      setName('');
      setWeight('');
      setMessage({ text: `Added "${bobbinName}".`, type: 'success' });
      nameInputRef.current && nameInputRef.current.focus();
    } catch (err) {
      const errMsg = err?.message || 'Failed to add';
      setMessage({ text: errMsg, type: 'error' });
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (message) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setMessage(null), 3000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [message]);

  return (
    <div className={className}>
      <div className="flex flex-col sm:flex-row gap-2 mb-3 sm:items-center">
        <Input
          inputRef={nameInputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Bobbin name"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!disabled && !working && !isDuplicate && name.trim()) handleAdd();
              if (isDuplicate) setMessage({ text: 'Duplicate entry', type: 'duplicate' });
            }
          }}
        />
        <Input
          type="number"
          step="0.001"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          placeholder="Weight (kg)"
          className="w-full sm:w-32"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!disabled && !working && !isDuplicate && name.trim()) handleAdd();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <Button onClick={handleAdd} disabled={disabled || working || isDuplicate || !name.trim()}>Add</Button>
          {isDuplicate && <div className="text-sm text-gray-500">Duplicate</div>}
        </div>
      </div>

      {message && (
        <div role="status" aria-live="polite" className={`mt-1 text-sm ${message.type==='success' ? 'text-green-600' : message.type==='error' ? 'text-red-600' : 'text-gray-600'}`}>
          {message.text}
        </div>
      )}

      <ul className="space-y-2">{filtered.map(i => (
        <BobbinRow
          key={i.id}
          item={i}
          onDelete={onDelete}
          onEdit={onEdit}
          disabled={disabled || working}
          className={`rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}
        />
      ))}</ul>
    </div>
  );
}

function BobbinRow({ item, onDelete, onEdit, disabled, className = '' }) {
  const { cls } = useBrand();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [weight, setWeight] = useState(item.weight != null ? String(item.weight) : '');
  const [working, setWorking] = useState(false);
  const nameEditRef = useRef(null);

  function startEdit() {
    setName(item.name);
    setWeight(item.weight != null ? String(item.weight) : '');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setName(item.name);
    setWeight(item.weight != null ? String(item.weight) : '');
  }

  useEffect(() => {
    if (editing) {
      setTimeout(() => nameEditRef.current && nameEditRef.current.focus(), 0);
    }
  }, [editing]);

  async function saveEdit() {
    const bobbinName = name.trim();
    if (!bobbinName || bobbinName === item.name && weight === (item.weight != null ? String(item.weight) : '')) {
      setEditing(false);
      return;
    }
    if (typeof onEdit !== 'function') {
      setEditing(false);
      return;
    }

    const weightNum = weight.trim() ? Number(weight.trim()) : null;
    if (weightNum !== null && (!Number.isFinite(weightNum) || weightNum < 0)) {
      alert('Weight must be a positive number');
      return;
    }

    setWorking(true);
    try {
      await onEdit(item.id, bobbinName, weightNum);
      setEditing(false);
    } catch (err) {
      alert(err.message || 'Failed to update');
    } finally {
      setWorking(false);
    }
  }

  return (
    <li className={`flex items-center justify-between ${className}`}>
      {!editing ? (
        <>
          <div className="flex-1 flex items-center gap-3">
            <span>{item.name}</span>
            {item.weight != null && (
              <span className={`text-sm ${cls.muted}`}>({formatKg(item.weight)})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={startEdit} disabled={disabled || working}>Edit</SecondaryButton>
            <button className="text-sm px-2 py-1 rounded text-red-600" onClick={() => onDelete && onDelete(item.id)} disabled={disabled || working}>Delete</button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 mr-4 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
            <Input
              inputRef={nameEditRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              className="flex-1 min-w-0"
            />
            <Input
              type="number"
              step="0.001"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="Weight (kg)"
              className="w-full sm:w-32"
              onKeyDown={e => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={saveEdit} disabled={disabled || working}>Save</Button>
            <SecondaryButton onClick={cancelEdit} disabled={disabled || working}>Cancel</SecondaryButton>
          </div>
        </>
      )}
    </li>
  );
}
