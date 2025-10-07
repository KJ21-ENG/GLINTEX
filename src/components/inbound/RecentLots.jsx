/**
 * RecentLots component for GLINTEX Inventory
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useBrand } from '../../context';
import { Pagination, ColumnFilter, ValueFilterMenu, DateFilterMenu } from '../common';
import { formatKg } from '../../utils';

const DEFAULT_SORT = { key: 'createdAt', direction: 'desc' };

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function getSortValue(row, key) {
  switch (key) {
    case 'lotNo':
      return row.lotNo || '';
    case 'date':
      return row.date || '';
    case 'itemName':
      return row.itemName || '';
    case 'firmName':
      return row.firmName || '';
    case 'supplierName':
      return row.supplierName || '';
    case 'totalPieces':
      return Number(row.totalPieces || 0);
    case 'totalWeight':
      return Number(row.totalWeight || 0);
    case 'createdAt':
    default:
      return row.createdAt || row.date || '';
  }
}

function sortRows(list, config) {
  const effective = (config && config.key) ? config : DEFAULT_SORT;
  const directionFactor = effective.direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const primary = compareValues(getSortValue(a, effective.key), getSortValue(b, effective.key));
    if (primary !== 0) return primary * directionFactor;
    if (effective.key !== DEFAULT_SORT.key) {
      const fallbackFactor = DEFAULT_SORT.direction === 'asc' ? 1 : -1;
      const fallback = compareValues(getSortValue(a, DEFAULT_SORT.key), getSortValue(b, DEFAULT_SORT.key));
      if (fallback !== 0) return fallback * fallbackFactor;
    }
    return 0;
  });
}

function isFilterActive(selectedValues, totalOptions) {
  if (!Array.isArray(selectedValues)) return false;
  if (selectedValues.length === 0) return true;
  if (!totalOptions) return selectedValues.length > 0;
  return selectedValues.length !== totalOptions;
}

export function RecentLots({ db }) {
  const { cls } = useBrand();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    lotNos: null,
    itemIds: null,
    firmIds: null,
    supplierIds: null,
    from: '',
    to: '',
  });
  const [sortConfig, setSortConfig] = useState(() => ({ ...DEFAULT_SORT }));
  const pageSize = 8;

  const baseRows = useMemo(() => {
    return db.lots.map(l => ({
      ...l,
      itemName: db.items.find(i=>i.id===l.itemId)?.name || "—",
      firmName: db.firms.find(f=>f.id===l.firmId)?.name || "—",
      supplierName: db.suppliers.find(s=>s.id===l.supplierId)?.name || "—",
    }));
  }, [db.lots, db.items, db.firms, db.suppliers]);

  const lotOptions = useMemo(() => {
    const map = new Map();
    baseRows.forEach(r => {
      const value = r.lotNo ?? null;
      const key = value ?? '__blank__';
      if (!map.has(key)) map.set(key, { value, label: value ?? '(Blank)', key });
    });
    return Array.from(map.values()).sort((a, b) => compareValues(a.label, b.label));
  }, [baseRows]);

  const itemOptions = useMemo(() => {
    return db.items.map(i => ({ value: i.id, label: i.name || '—', key: i.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [db.items]);

  const firmOptions = useMemo(() => {
    return db.firms.map(f => ({ value: f.id, label: f.name || '—', key: f.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [db.firms]);

  const supplierOptions = useMemo(() => {
    return db.suppliers.map(s => ({ value: s.id, label: s.name || '—', key: s.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [db.suppliers]);

  const filteredRows = useMemo(() => {
    const next = baseRows.filter(r => {
      if (Array.isArray(filters.lotNos)) {
        if (filters.lotNos.length === 0) return false;
        const lotValue = r.lotNo ?? null;
        if (!filters.lotNos.includes(lotValue)) return false;
      }
      if (Array.isArray(filters.itemIds)) {
        if (filters.itemIds.length === 0) return false;
        if (!filters.itemIds.includes(r.itemId)) return false;
      }
      if (Array.isArray(filters.firmIds)) {
        if (filters.firmIds.length === 0) return false;
        if (!filters.firmIds.includes(r.firmId)) return false;
      }
      if (Array.isArray(filters.supplierIds)) {
        if (filters.supplierIds.length === 0) return false;
        if (!filters.supplierIds.includes(r.supplierId)) return false;
      }
      if (filters.from && r.date < filters.from) return false;
      if (filters.to && r.date > filters.to) return false;
      return true;
    });
    return sortRows(next, sortConfig);
  }, [baseRows, filters, sortConfig]);

  useEffect(() => { setPage(1); }, [filters, sortConfig]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className={`text-left ${cls.muted}`}>
          <tr>
            <th className="py-2 pr-2">
              <div className="flex items-center gap-1">
                <span>Lot No</span>
                <ColumnFilter
                  title="Filter by lot number"
                  align="left"
                  active={isFilterActive(filters.lotNos, lotOptions.length)}
                >
                  {({ close }) => (
                    <ValueFilterMenu
                      title="Lots"
                      options={lotOptions}
                      selectedValues={filters.lotNos}
                      onApply={(next) => setFilters(f => ({ ...f, lotNos: next === null ? null : next }))}
                      close={close}
                      currentSort={sortConfig}
                      sortOptions={[
                        { key: 'lotNo', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: 'lotNo', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...DEFAULT_SORT }) },
                      ]}
                    />
                  )}
                </ColumnFilter>
              </div>
            </th>
            <th className="py-2 pr-2">
              <div className="flex items-center gap-1">
                <span>Date</span>
                <ColumnFilter
                  title="Filter by date"
                  align="left"
                  active={Boolean(filters.from || filters.to)}
                >
                  {({ close }) => (
                    <DateFilterMenu
                      title="Filter by date"
                      from={filters.from}
                      to={filters.to}
                      onApply={({ from, to }) => setFilters(f => ({ ...f, from, to }))}
                      close={close}
                      currentSort={sortConfig}
                      sortOptions={[
                        { key: 'date', direction: 'desc', label: 'Sort newest to oldest', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: 'date', direction: 'asc', label: 'Sort oldest to newest', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                      ]}
                    />
                  )}
                </ColumnFilter>
              </div>
            </th>
            <th className="py-2 pr-2">
              <div className="flex items-center gap-1">
                <span>Item</span>
                <ColumnFilter
                  title="Filter by item"
                  active={isFilterActive(filters.itemIds, itemOptions.length)}
                >
                  {({ close }) => (
                    <ValueFilterMenu
                      title="Items"
                      options={itemOptions}
                      selectedValues={filters.itemIds}
                      onApply={(next) => setFilters(f => ({ ...f, itemIds: next === null ? null : next }))}
                      close={close}
                      currentSort={sortConfig}
                      sortOptions={[
                        { key: 'itemName', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: 'itemName', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...DEFAULT_SORT }) },
                      ]}
                    />
                  )}
                </ColumnFilter>
              </div>
            </th>
            <th className="py-2 pr-2">
              <div className="flex items-center gap-1">
                <span>Firm</span>
                <ColumnFilter
                  title="Filter by firm"
                  active={isFilterActive(filters.firmIds, firmOptions.length)}
                >
                  {({ close }) => (
                    <ValueFilterMenu
                      title="Firms"
                      options={firmOptions}
                      selectedValues={filters.firmIds}
                      onApply={(next) => setFilters(f => ({ ...f, firmIds: next === null ? null : next }))}
                      close={close}
                      currentSort={sortConfig}
                      sortOptions={[
                        { key: 'firmName', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: 'firmName', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...DEFAULT_SORT }) },
                      ]}
                    />
                  )}
                </ColumnFilter>
              </div>
            </th>
            <th className="py-2 pr-2">
              <div className="flex items-center gap-1">
                <span>Supplier</span>
                <ColumnFilter
                  title="Filter by supplier"
                  active={isFilterActive(filters.supplierIds, supplierOptions.length)}
                >
                  {({ close }) => (
                    <ValueFilterMenu
                      title="Suppliers"
                      options={supplierOptions}
                      selectedValues={filters.supplierIds}
                      onApply={(next) => setFilters(f => ({ ...f, supplierIds: next === null ? null : next }))}
                      close={close}
                      currentSort={sortConfig}
                      sortOptions={[
                        { key: 'supplierName', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: 'supplierName', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                        { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...DEFAULT_SORT }) },
                      ]}
                    />
                  )}
                </ColumnFilter>
              </div>
            </th>
            <th className="py-2 pr-2 text-right">
              <div className="flex items-center gap-1 justify-end">
                <span>Pieces</span>
                <ColumnFilter
                  title="Sort pieces"
                  active={sortConfig.key === 'totalPieces'}
                >
                  {({ close }) => (
                    <div className="p-3 space-y-2 text-sm">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:bg-[var(--brand-primary)/10]"
                        onClick={() => { setSortConfig({ key: 'totalPieces', direction: 'desc' }); close(); }}
                      >
                        High to low
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:bg-[var(--brand-primary)/10]"
                        onClick={() => { setSortConfig({ key: 'totalPieces', direction: 'asc' }); close(); }}
                      >
                        Low to high
                      </button>
                      <div className="border-t border-dashed opacity-40" />
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:bg-[var(--brand-primary)/10]"
                        onClick={() => { setSortConfig({ ...DEFAULT_SORT }); close(); }}
                      >
                        Reset sort
                      </button>
                    </div>
                  )}
                </ColumnFilter>
              </div>
            </th>
            <th className="py-2 pr-2 text-right">
              <div className="flex items-center gap-1 justify-end">
                <span>Weight (kg)</span>
                <ColumnFilter
                  title="Sort weight"
                  active={sortConfig.key === 'totalWeight'}
                >
                  {({ close }) => (
                    <div className="p-3 space-y-2 text-sm">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:bg-[var(--brand-primary)/10]"
                        onClick={() => { setSortConfig({ key: 'totalWeight', direction: 'desc' }); close(); }}
                      >
                        High to low
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:bg-[var(--brand-primary)/10]"
                        onClick={() => { setSortConfig({ key: 'totalWeight', direction: 'asc' }); close(); }}
                      >
                        Low to high
                      </button>
                      <div className="border-t border-dashed opacity-40" />
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:bg-[var(--brand-primary)/10]"
                        onClick={() => { setSortConfig({ ...DEFAULT_SORT }); close(); }}
                      >
                        Reset sort
                      </button>
                    </div>
                  )}
                </ColumnFilter>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {pagedRows.length === 0 ? (
            <tr><td colSpan={7} className="py-4">No lots match filters.</td></tr>
          ) : (
            pagedRows.map(r => (
              <tr key={r.lotNo} className={`border-t ${cls.rowBorder} row-hover`}>
                <td className="py-2 pr-2 font-medium">{r.lotNo}</td>
                <td className="py-2 pr-2">{r.date}</td>
                <td className="py-2 pr-2">{r.itemName}</td>
                <td className="py-2 pr-2">{r.firmName}</td>
                <td className="py-2 pr-2">{r.supplierName}</td>
                <td className="py-2 pr-2 text-right">{r.totalPieces}</td>
                <td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination total={filteredRows.length} page={page} setPage={setPage} pageSize={pageSize} />
    </div>
  );
}
