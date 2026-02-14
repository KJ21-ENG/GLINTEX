import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';

const toIsoDate = (value) => {
  if (!value) return '';
  const s = String(value);
  // Accept YYYY-MM-DD or ISO timestamps.
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const toNumberOrNull = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeValueList = (raw) => {
  if (raw == null) return [''];
  if (Array.isArray(raw)) return raw.map(v => (v == null ? '' : String(v)));
  return [String(raw)];
};

export const isSheetFilterActive = (filter) => {
  if (!filter) return false;
  if (filter.kind === 'values') return Array.isArray(filter.selected);
  if (filter.kind === 'text') return !!String(filter.query || '').trim();
  if (filter.kind === 'number') return filter.min != null || filter.max != null;
  if (filter.kind === 'date') return !!String(filter.from || '').trim() || !!String(filter.to || '').trim();
  return false;
};

export const applySheetFilters = (rows, columns, filters) => {
  const active = Object.entries(filters || {}).filter(([, f]) => isSheetFilterActive(f));
  if (!active.length) return rows;

  return (rows || []).filter((row) => {
    for (const [colId, filter] of active) {
      const col = columns.find(c => c.id === colId);
      if (!col || typeof col.getValue !== 'function') continue;

      const values = normalizeValueList(col.getValue(row)).map(v => (v == null ? '' : String(v)));

      if (filter.kind === 'values') {
        const selected = new Set((filter.selected || []).map(v => String(v)));
        // If any value matches selected, include row (Sheets semantics for multi-valued fields).
        const ok = values.some(v => selected.has(v));
        if (!ok) return false;
      } else if (filter.kind === 'text') {
        const q = String(filter.query || '').toLowerCase().trim();
        if (q) {
          const hay = values.join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
      } else if (filter.kind === 'number') {
        const min = toNumberOrNull(filter.min);
        const max = toNumberOrNull(filter.max);
        const nums = values.map(v => toNumberOrNull(v)).filter(n => n != null);
        if (!nums.length) return false;
        const anyOk = nums.some((n) => {
          if (min != null && n < min) return false;
          if (max != null && n > max) return false;
          return true;
        });
        if (!anyOk) return false;
      } else if (filter.kind === 'date') {
        const from = toIsoDate(filter.from);
        const to = toIsoDate(filter.to);
        const dates = values.map(toIsoDate).filter(Boolean);
        if (!dates.length) return false;
        const anyOk = dates.some((d) => {
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
        if (!anyOk) return false;
      }
    }
    return true;
  });
};

const buildDistinctOptions = (rows, col) => {
  const set = new Set();
  for (const row of rows || []) {
    const vals = normalizeValueList(col.getValue(row));
    vals.forEach(v => set.add(v == null ? '' : String(v)));
  }
  const all = Array.from(set);
  all.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return all;
};

export function SheetColumnFilter({ column, rows, filters, setFilters, openId, setOpenId }) {
  const menuRef = useRef(null);
  const anchorRef = useRef(null);
  const isOpen = openId === column.id;
  const active = isSheetFilterActive(filters?.[column.id]);
  const [optionSearch, setOptionSearch] = useState('');
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 280 });

  // Build distinct values only when the menu is open; doing it for every column on every render is expensive.
  const options = useMemo(() => {
    if (!isOpen) return [];
    if (!column || column.kind !== 'values') return [];
    if (Array.isArray(column.facetOptions)) return column.facetOptions;
    // Defensive cap: value discovery over very large datasets can feel slow.
    // 10k rows is enough for accurate "Sheets-like" filtering in practice.
    const sample = Array.isArray(rows) && rows.length > 10000 ? rows.slice(0, 10000) : rows;
    return buildDistinctOptions(sample, column);
  }, [rows, column, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      const target = e.target;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      {
        setOpenId(null);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, setOpenId]);

  const clearFilter = () => {
    setFilters((prev) => {
      // Use a stable "no filter" sentinel instead of deleting the key.
      // This guarantees a state update/re-render (and keeps UI simple: all options appear selected).
      return { ...(prev || {}), [column.id]: null };
    });
  };

  const setFilter = (nextFilter) => {
    setFilters((prev) => ({ ...(prev || {}), [column.id]: nextFilter }));
  };

  const toggleValue = (value, checked) => {
    const current = filters?.[column.id];
    // When no filter is applied, Sheets behaves as "all values selected".
    const selected = new Set(
      Array.isArray(current?.selected) && current?.kind === 'values'
        ? current.selected.map(String)
        : options.map(String)
    );
    const v = String(value);
    if (checked) selected.add(v);
    else selected.delete(v);
    const selectedArr = Array.from(selected);

    // If everything selected, treat as no filter.
    if (selectedArr.length === options.length) {
      clearFilter();
      return;
    }
    setFilter({ kind: 'values', selected: selectedArr });
  };

  // Initial placement when opening (then corrected in useLayoutEffect with actual menu size).
  useEffect(() => {
    if (!isOpen) return;
    const rect = anchorRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    const width = 280;
    const margin = 8;
    const left = Math.max(margin, Math.min((rect.right - width), window.innerWidth - width - margin));
    const top = Math.min(rect.bottom + 6, window.innerHeight - margin);
    setMenuPos({ top, left, width });
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = anchorRef.current?.getBoundingClientRect?.();
    const menuRect = menuRef.current?.getBoundingClientRect?.();
    if (!rect || !menuRect) return;
    const margin = 8;
    let left = menuPos.left;
    let top = menuPos.top;

    // Horizontal clamp
    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

    // Flip above if it would overflow bottom
    const wouldOverflowBottom = top + menuRect.height + margin > window.innerHeight;
    if (wouldOverflowBottom) {
      top = Math.max(margin, rect.top - menuRect.height - 6);
    }

    // Final clamp
    top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));

    // Only update if it changed (avoid layout loops)
    if (Math.abs(left - menuPos.left) > 0.5 || Math.abs(top - menuPos.top) > 0.5) {
      setMenuPos((p) => ({ ...p, left, top }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, options.length]);

  const menu = (
    <div
      className="fixed z-[1000] rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
      ref={menuRef}
      // Important: prevent the document-level mousedown handler from seeing "inside" clicks as outside.
      // If it closes the menu on mousedown, the button's onClick never fires (feels like "nothing happens").
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate">{column.label}</div>
          <div className="text-[11px] text-muted-foreground">Filter</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setOpenId(null)}
          aria-label="Close filter"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
        {column.kind === 'values' && (
          <>
            <Input
              value={optionSearch}
              onChange={(e) => setOptionSearch(e.target.value)}
              placeholder="Search values..."
              className="h-8"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    clearFilter();
                    setOptionSearch('');
                  }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setFilter({ kind: 'values', selected: [] });
                    setOptionSearch('');
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
            <div className="max-h-56 overflow-auto rounded-md border bg-background">
              <div className="p-2 space-y-1">
                {(function () {
                  const search = optionSearch.trim().toLowerCase();
                  const filtered = search
                    ? options.filter(o => String(o).toLowerCase().includes(search))
                    : options;
                  const limited = filtered.slice(0, 250);
                  const current = filters?.[column.id];
                  const selected = new Set(
                    Array.isArray(current?.selected) && current?.kind === 'values'
                      ? current.selected.map(String)
                      : options.map(String)
                  );
                  return (
                    <>
                      {limited.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-2">No values.</div>
                      ) : (
                        limited.map((opt) => {
                          const label = opt === '' ? '(Blank)' : opt;
                          const effectiveChecked = selected.has(String(opt));
                          return (
                            <label key={`opt-${column.id}-${String(opt)}`} className="flex items-center gap-2 text-xs py-1">
                              <Checkbox
                                checked={effectiveChecked}
                                onCheckedChange={(next) => toggleValue(opt, !!next)}
                              />
                              <span className="truncate" title={label}>{label}</span>
                            </label>
                          );
                        })
                      )}
                      {filtered.length > 250 && (
                        <div className="text-[11px] text-muted-foreground pt-2">
                          Showing first 250 values. Use search to narrow.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}

        {column.kind === 'text' && (
          <>
            <Input
              value={String(filters?.[column.id]?.query || '')}
              onChange={(e) => {
                const q = e.target.value;
                if (!q.trim()) clearFilter();
                else setFilter({ kind: 'text', query: q });
              }}
              placeholder="Contains..."
              className="h-8"
            />
            <button
              type="button"
              className="text-xs underline text-muted-foreground hover:text-foreground"
              onClick={() => {
                clearFilter();
              }}
            >
              Clear all
            </button>
          </>
        )}

        {column.kind === 'number' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={filters?.[column.id]?.min ?? ''}
                onChange={(e) => {
                  const min = e.target.value;
                  const cur = filters?.[column.id] || {};
                  const next = { kind: 'number', min, max: cur.max ?? '' };
                  if (String(next.min).trim() === '' && String(next.max).trim() === '') clearFilter();
                  else setFilter(next);
                }}
                placeholder="Min"
                className="h-8"
              />
              <Input
                value={filters?.[column.id]?.max ?? ''}
                onChange={(e) => {
                  const max = e.target.value;
                  const cur = filters?.[column.id] || {};
                  const next = { kind: 'number', min: cur.min ?? '', max };
                  if (String(next.min).trim() === '' && String(next.max).trim() === '') clearFilter();
                  else setFilter(next);
                }}
                placeholder="Max"
                className="h-8"
              />
            </div>
            <button
              type="button"
              className="text-xs underline text-muted-foreground hover:text-foreground"
              onClick={() => {
                clearFilter();
              }}
            >
              Clear all
            </button>
          </>
        )}

        {column.kind === 'date' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">From</label>
                <input
                  type="date"
                  value={filters?.[column.id]?.from ?? ''}
                  onChange={(e) => {
                    const from = e.target.value;
                    const cur = filters?.[column.id] || {};
                    const next = { kind: 'date', from, to: cur.to ?? '' };
                    if (!String(next.from).trim() && !String(next.to).trim()) clearFilter();
                    else setFilter(next);
                  }}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">To</label>
                <input
                  type="date"
                  value={filters?.[column.id]?.to ?? ''}
                  onChange={(e) => {
                    const to = e.target.value;
                    const cur = filters?.[column.id] || {};
                    const next = { kind: 'date', from: cur.from ?? '', to };
                    if (!String(next.from).trim() && !String(next.to).trim()) clearFilter();
                    else setFilter(next);
                  }}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                />
              </div>
            </div>
            <button
              type="button"
              className="text-xs underline text-muted-foreground hover:text-foreground"
              onClick={() => {
                clearFilter();
              }}
            >
              Clear all
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-transparent hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'text-primary' : 'text-muted-foreground'}`}
        onClick={() => {
          setOptionSearch('');
          setOpenId(isOpen ? null : column.id);
        }}
        aria-label={`Filter ${column.label}`}
        ref={anchorRef}
      >
        <Filter className="h-4 w-4" />
      </button>
      {isOpen ? createPortal(menu, document.body) : null}
    </div>
  );
}
