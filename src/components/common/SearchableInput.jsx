/**
 * SearchableInput component
 * Renders an input + Add button and a filtered list of items with delete buttons.
 * Encapsulates duplicate prevention (case-insensitive, trimmed) and local input state.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useBrand } from '../../context';
import { Input } from './Input.jsx';
import { Button } from './Button.jsx';
import { SecondaryButton } from './SecondaryButton.jsx';
import { debounce } from '../../utils';

export const SearchableInput = ({ items = [], onAdd, onDelete, placeholder = 'New item', disabled = false, className = '', onQueryChange = null, debounceMs = 250 }) => {
  const { cls } = useBrand();
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null); // { text, type: 'success'|'error'|'duplicate' }
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const debouncedQuery = useRef(null);

  const normalized = value.trim().toLowerCase();
  const isDuplicate = normalized !== '' && items.some(i => i.name.trim().toLowerCase() === normalized);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [items, value]);

  // Debounced external query callback
  useEffect(() => {
    if (typeof onQueryChange !== 'function') return undefined;
    if (debouncedQuery.current) debouncedQuery.current.cancel?.();
    debouncedQuery.current = debounce((q) => onQueryChange(q), debounceMs);
    debouncedQuery.current(value);
    return () => debouncedQuery.current && debouncedQuery.current.cancel?.();
  }, [value, onQueryChange, debounceMs]);

  async function handleAdd() {
    const name = value.trim();
    if (!name) return;
    if (isDuplicate) return; // safeguard
    if (typeof onAdd !== 'function') return;
    setWorking(true);
    try {
      await onAdd(name);
      setValue('');
      // success message
      setMessage({ text: `Added "${name}".`, type: 'success' });
      // focus back to input for faster subsequent adds
      inputRef.current && inputRef.current.focus();
    } catch (err) {
      const errMsg = err?.message || 'Failed to add';
      setMessage({ text: errMsg, type: 'error' });
      // also show native alert as fallback
      // alert(errMsg);
    } finally {
      setWorking(false);
    }
  }

  // clear transient messages after a short delay
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
      <div className="flex gap-2 mb-3 items-center">
        <Input
          inputRef={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!disabled && !working && !isDuplicate && value.trim()) handleAdd();
              if (isDuplicate) setMessage({ text: 'Duplicate entry', type: 'duplicate' });
            }
          }}
          aria-describedby={message ? 'searchable-input-message' : undefined}
        />
        <Button onClick={handleAdd} disabled={disabled || working || isDuplicate || !value.trim()}>Add</Button>
        {isDuplicate && <div className="text-sm text-gray-500 ml-2">Duplicate</div>}
      </div>

      {message && (
        <div id="searchable-input-message" role="status" aria-live="polite" className={`mt-1 text-sm ${message.type==='success' ? 'text-green-600' : message.type==='error' ? 'text-red-600' : 'text-gray-600'}`}>
          {message.text}
        </div>
      )}

      <ul className="space-y-2">{filtered.map(i => (
        <li key={i.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
          <span>{i.name}</span>
          <SecondaryButton onClick={() => onDelete && onDelete(i.id)} disabled={disabled || working}>Delete</SecondaryButton>
        </li>
      ))}</ul>
    </div>
  );
};

export default SearchableInput;


