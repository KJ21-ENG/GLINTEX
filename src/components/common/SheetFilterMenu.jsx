/**
 * Spreadsheet-style filter menus with search, select-all and optional sort controls.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from './Button.jsx';
import { SecondaryButton } from './SecondaryButton.jsx';
import { Input } from './Input.jsx';

const DEFAULT_SEARCH_PLACEHOLDER = 'Search values';

function normalizeSelected(values, optionsLength) {
  if (!Array.isArray(values)) return null;
  if (values.length === 0) return [];
  return values.length === optionsLength ? null : values;
}

export function ValueFilterMenu({
  title,
  options,
  selectedValues,
  onApply,
  close,
  sortOptions = [],
  currentSort,
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
}) {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(() => new Set());

  const optionValues = useMemo(() => options.map(o => o.value), [options]);

  useEffect(() => {
    if (!options.length) {
      setPending(new Set());
      return;
    }
    if (Array.isArray(selectedValues) && selectedValues.length > 0) {
      setPending(new Set(selectedValues));
    } else if (selectedValues === null || selectedValues === undefined) {
      setPending(new Set(optionValues));
    } else if (Array.isArray(selectedValues) && selectedValues.length === 0) {
      setPending(new Set());
    } else {
      setPending(new Set(optionValues));
    }
  }, [selectedValues, optionValues]);

  useEffect(() => { setQuery(''); }, [options]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(opt => opt.label?.toLowerCase().includes(q));
  }, [options, query]);

  const toggleValue = (value) => {
    setPending(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const handleApply = () => {
    const arr = Array.from(pending);
    onApply(normalizeSelected(arr, optionValues.length));
    close();
  };

  const handleSelectAll = () => setPending(new Set(optionValues));
  const handleClearAll = () => setPending(new Set());

  const allSelected = pending.size === optionValues.length && optionValues.length > 0;

  return (
    <div className="space-y-3 text-sm" style={{ minWidth: 260 }}>
      {title && <div className="font-semibold text-xs uppercase tracking-wide opacity-70">{title}</div>}

      {sortOptions.length > 0 && (
        <div className="space-y-1">
          {sortOptions.map(opt => {
            const active = currentSort && currentSort.key === opt.key && currentSort.direction === opt.direction;
            return (
              <button
                key={`${opt.key}-${opt.direction}`}
                type="button"
                className={`w-full text-left px-3 py-2 rounded-md border transition ${active ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)/10]' : 'border-transparent hover:bg-[var(--brand-primary)/10]'}`}
                onClick={() => {
                  opt.onChange?.({ key: opt.key, direction: opt.direction });
                  close();
                }}
              >
                {opt.label}
              </button>
            );
          })}
          <div className="border-t border-dashed opacity-40 my-2" />
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <button type="button" className="text-[var(--brand-primary)] hover:underline" onClick={handleSelectAll} disabled={allSelected}>Select all</button>
        <button type="button" className="hover:underline" onClick={handleClearAll}>Clear</button>
      </div>

      <div>
        <div className="relative">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 text-sm"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-60">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M8.5 3a5.5 5.5 0 1 1 3.473 9.8l3.613 3.614a.75.75 0 1 1-1.06 1.06l-3.614-3.613A5.5 5.5 0 0 1 8.5 3Zm-4 5.5a4 4 0 1 0 7.562 1.925.75.75 0 0 1 .178-.285.75.75 0 0 1 .285-.178A4 4 0 0 0 4.5 8.5Z" clipRule="evenodd" />
            </svg>
          </span>
        </div>
        <div className="text-[11px] opacity-60 mt-1">Displaying {filtered.length} / {options.length}</div>
      </div>

      <div className="max-h-60 overflow-auto rounded-md border border-dashed border-slate-500/40">
        {filtered.length === 0 ? (
          <div className="text-center text-xs py-4 opacity-60">No values</div>
        ) : (
          <ul>
            {filtered.map(opt => {
              const checked = pending.has(opt.value);
              return (
                <li key={opt.key ?? String(opt.value ?? '__blank__')} className="border-b border-slate-500/20 last:border-b-0">
                  <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--brand-primary)/8]">
                    <input
                      type="checkbox"
                      className="form-checkbox rounded"
                      checked={checked}
                      onChange={() => toggleValue(opt.value)}
                    />
                    <span>{opt.label ?? '—'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <SecondaryButton className="px-3 py-1 text-sm" onClick={() => close()}>Cancel</SecondaryButton>
        <Button className="px-3 py-1 text-sm" onClick={handleApply}>Apply</Button>
      </div>
    </div>
  );
}

export function DateFilterMenu({
  title = 'Filter by date',
  from,
  to,
  onApply,
  close,
  sortOptions = [],
  currentSort,
}) {
  const [pending, setPending] = useState({ from: from || '', to: to || '' });

  useEffect(() => {
    setPending({ from: from || '', to: to || '' });
  }, [from, to]);

  const handleApply = () => {
    onApply({ from: pending.from || '', to: pending.to || '' });
    close();
  };

  const handleClear = () => setPending({ from: '', to: '' });

  return (
    <div className="space-y-3 text-sm" style={{ minWidth: 260 }}>
      <div className="font-semibold text-xs uppercase tracking-wide opacity-70">{title}</div>

      {sortOptions.length > 0 && (
        <div className="space-y-1">
          {sortOptions.map(opt => {
            const active = currentSort && currentSort.key === opt.key && currentSort.direction === opt.direction;
            return (
              <button
                key={`${opt.key}-${opt.direction}`}
                type="button"
                className={`w-full text-left px-3 py-2 rounded-md border transition ${active ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)/10]' : 'border-transparent hover:bg-[var(--brand-primary)/10]'}`}
                onClick={() => {
                  opt.onChange?.({ key: opt.key, direction: opt.direction });
                  close();
                }}
              >
                {opt.label}
              </button>
            );
          })}
          <div className="border-t border-dashed opacity-40 my-2" />
        </div>
      )}

      <div className="space-y-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide opacity-70 mb-1">From</div>
          <Input type="date" value={pending.from} onChange={e => setPending(prev => ({ ...prev, from: e.target.value }))} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide opacity-70 mb-1">To</div>
          <Input type="date" value={pending.to} onChange={e => setPending(prev => ({ ...prev, to: e.target.value }))} />
        </div>
        <button type="button" className="text-xs text-[var(--brand-primary)] hover:underline" onClick={handleClear}>Clear dates</button>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <SecondaryButton className="px-3 py-1 text-sm" onClick={() => close()}>Cancel</SecondaryButton>
        <Button className="px-3 py-1 text-sm" onClick={handleApply}>Apply</Button>
      </div>
    </div>
  );
}
