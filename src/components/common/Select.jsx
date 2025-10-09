/**
 * Select component for GLINTEX Inventory
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useBrand } from '../../context';

// Searchable, theme-aware Select with list-style dropdown (backwards-compatible)
export const Select = ({
  className = '',
  children,
  options = null,
  value,
  onChange,
  labelKey = 'label',
  valueKey = 'value',
  searchable = true,
  filterFn = null,
  placeholder = 'Select',
  ...rest
}) => {
  const { cls } = useBrand();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const builtOptions = useMemo(() => {
    if (Array.isArray(options) && options.length) {
      return options.map((o, idx) => ({ key: o.key ?? String(o[valueKey] ?? idx), label: o[labelKey] ?? String(o[valueKey] ?? ''), value: o[valueKey] }));
    }
    const arr = [];
    React.Children.forEach(children, (ch) => {
      if (!ch || !ch.props) return;
      const props = ch.props || {};
      const val = props.value;
      const lab = typeof props.children === 'string' ? props.children : (Array.isArray(props.children) ? props.children.join('') : String(props.children || ''));
      arr.push({ key: props.key ?? String(val ?? lab), label: lab, value: val });
    });
    return arr;
  }, [options, children, labelKey, valueKey]);

  const effectiveFilter = filterFn || ((opt, q) => String(opt.label || '').toLowerCase().includes(String(q || '').toLowerCase()));

  const visibleOptions = useMemo(() => {
    if (!searchable || !query) return builtOptions;
    const q = query.trim().toLowerCase();
    if (!q) return builtOptions;
    return builtOptions.filter(o => effectiveFilter(o, q));
  }, [builtOptions, query, searchable, effectiveFilter]);

  const selectedLabel = useMemo(() => {
    const found = builtOptions.find(o => o.value === value || String(o.value) === String(value));
    return found ? found.label : '';
  }, [builtOptions, value]);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapperRef.current && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
      setQuery('');
      setHighlight(-1);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(h => Math.min(h + 1, visibleOptions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(h => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlight >= 0 && highlight < visibleOptions.length) selectValue(visibleOptions[highlight].value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setQuery('');
        setHighlight(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, highlight, visibleOptions]);

  function selectValue(val) {
    if (typeof onChange === 'function') {
      try { onChange({ target: { value: val } }); } catch (err) { /* ignore */ }
    }
    setOpen(false);
    setQuery('');
    setHighlight(-1);
  }

  // fallback to native select when search disabled
  if (!searchable) {
    return (
      <select
        className={`w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${cls.input} ` + className}
        value={value}
        onChange={onChange}
        {...rest}
      >
        {children}
      </select>
    );
  }

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <div
        className={`w-full px-3 py-2 rounded-xl border cursor-pointer flex items-center justify-between gap-2 ${cls.input}`}
        onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); setTimeout(() => inputRef.current && inputRef.current.focus(), 0); } }}
      >
        <div className="flex-1 truncate text-sm text-left">
          {selectedLabel || (<span className="opacity-60">{placeholder}</span>)}
        </div>
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 opacity-60">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
          </svg>
        </div>
      </div>

      {open && (
        <div className={`absolute left-0 right-0 mt-1 z-50 rounded-md border ${cls.cardBorder}`} style={{ minWidth: 160, backgroundColor: 'var(--card-bg-solid)' }}>
          <div className="p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setHighlight(0); }}
              placeholder="Type to search..."
              className={`w-full px-3 py-2 rounded border ${cls.cardBorder} ${cls.cardBg} text-sm`}
              aria-label="Search options"
            />
          </div>
          <div className="max-h-48 overflow-auto">
            {visibleOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs opacity-60">No matches</div>
            ) : (
              <ul>
                {visibleOptions.map((opt, idx) => {
                  const isSelected = String(opt.value) === String(value);
                  const isHighlighted = idx === highlight;
                  return (
                    <li key={opt.key} className={`cursor-pointer px-3 py-2 row-hover ${isHighlighted ? 'bg-[var(--brand-primary)]/20 text-[var(--brand-primary)]' : ''}`} onMouseEnter={() => setHighlight(idx)} onClick={() => selectValue(opt.value)} role="option" aria-selected={isSelected}>
                      <div className="flex items-center justify-between">
                        <div className={`truncate ${isSelected ? 'font-medium' : ''}`}>{opt.label}</div>
                        {isSelected ? (<span className="text-[11px] opacity-60">✓</span>) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
