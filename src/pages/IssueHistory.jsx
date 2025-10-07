/**
 * IssueHistory page component for GLINTEX Inventory
 */

import React, { useMemo, useState, useRef } from 'react';
import { useBrand } from '../context';
import { formatKg } from '../utils';
import { ColumnFilter, ValueFilterMenu, DateFilterMenu } from '../components';
import { exportXlsx, exportCsv, exportPdf } from '../services';
import * as api from '../api';

const ISSUE_DEFAULT_SORT = { key: 'date', direction: 'desc' };

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function isFilterActive(selectedValues, totalOptions) {
  if (!Array.isArray(selectedValues)) return false;
  if (selectedValues.length === 0) return true;
  if (!totalOptions) return selectedValues.length > 0;
  return selectedValues.length !== totalOptions;
}

function getIssueSortValue(row, key, maps) {
  switch (key) {
    case 'date':
      return row.date || '';
    case 'itemName':
      return maps.itemName.get(row.itemId) || '';
    case 'lotNo':
      return row.lotNo || '';
    case 'machineName':
      return maps.machineName.get(row.machineId) || '';
    case 'operatorName':
      return maps.operatorName.get(row.operatorId) || '';
    case 'count':
      return Number(row.count || 0);
    case 'totalWeight':
      return Number(row.totalWeight || 0);
    default:
      return row[key] ?? '';
  }
}

function sortIssues(list, config, maps) {
  const effective = (config && config.key) ? config : ISSUE_DEFAULT_SORT;
  const directionFactor = effective.direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const primary = compareValues(getIssueSortValue(a, effective.key, maps), getIssueSortValue(b, effective.key, maps));
    if (primary !== 0) return primary * directionFactor;
    if (effective.key !== ISSUE_DEFAULT_SORT.key) {
      const fallbackFactor = ISSUE_DEFAULT_SORT.direction === 'asc' ? 1 : -1;
      const fallback = compareValues(getIssueSortValue(a, ISSUE_DEFAULT_SORT.key, maps), getIssueSortValue(b, ISSUE_DEFAULT_SORT.key, maps));
      if (fallback !== 0) return fallback * fallbackFactor;
    }
    return 0;
  });
}

export function IssueHistory({ db, rows: rowsProp, refreshDb }) {
  const { cls, theme, brand } = useBrand();
  const exportRef = useRef(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [filters, setFilters] = useState({
    itemIds: null,
    lotNos: null,
    from: '',
    to: '',
    machineIds: null,
    operatorIds: null,
  });
  const [sortConfig, setSortConfig] = useState(() => ({ ...ISSUE_DEFAULT_SORT }));
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (consumptionId) => {
    if (!confirm('Are you sure you want to delete this issue record? This will make the pieces available again for re-issuing.')) {
      return;
    }
    
    setDeletingId(consumptionId);
    try {
      await api.deleteConsumption(consumptionId);
      await refreshDb();
      alert('Issue record deleted successfully. Pieces are now available again.');
    } catch (err) {
      alert(err.message || 'Failed to delete issue record');
    } finally {
      setDeletingId(null);
    }
  };

  const rows = useMemo(() => {
    return Array.isArray(rowsProp) ? rowsProp.slice() : (db.consumptions || []).slice();
  }, [db.consumptions, rowsProp]);

  const items = db.items || [];
  const machines = db.machines || [];
  const operators = db.operators || [];

  const itemNameById = useMemo(() => {
    const map = new Map();
    items.forEach(i => map.set(i.id, i.name || '—'));
    return map;
  }, [items]);

  const machineNameById = useMemo(() => {
    const map = new Map();
    machines.forEach(m => map.set(m.id, m.name || '—'));
    return map;
  }, [machines]);

  const operatorNameById = useMemo(() => {
    const map = new Map();
    operators.forEach(o => map.set(o.id, o.name || '—'));
    return map;
  }, [operators]);

  const itemOptions = useMemo(() => {
    return items.map(i => ({ value: i.id, label: i.name || '—', key: i.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [items]);

  const lotOptions = useMemo(() => {
    const map = new Map();
    rows.forEach(r => {
      const value = r.lotNo ?? null;
      const key = value ?? '__blank__';
      if (!map.has(key)) {
        map.set(key, { value, label: value ?? '(Blank)', key });
      }
    });
    return Array.from(map.values()).sort((a, b) => compareValues(a.label, b.label));
  }, [rows]);

  const machineOptions = useMemo(() => {
    return machines.map(m => ({ value: m.id, label: m.name || '—', key: m.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [machines]);

  const operatorOptions = useMemo(() => {
    return operators.map(o => ({ value: o.id, label: o.name || '—', key: o.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [operators]);

  const filtered = useMemo(() => {
    const out = rows.filter(r => {
      if (Array.isArray(filters.itemIds)) {
        if (filters.itemIds.length === 0) return false;
        if (!filters.itemIds.includes(r.itemId)) return false;
      }
      if (Array.isArray(filters.lotNos)) {
        if (filters.lotNos.length === 0) return false;
        const lotValue = r.lotNo ?? null;
        if (!filters.lotNos.includes(lotValue)) return false;
      }
      if (filters.from && r.date < filters.from) return false;
      if (filters.to && r.date > filters.to) return false;
      if (Array.isArray(filters.machineIds)) {
        if (filters.machineIds.length === 0) return false;
        if (!filters.machineIds.includes(r.machineId)) return false;
      }
      if (Array.isArray(filters.operatorIds)) {
        if (filters.operatorIds.length === 0) return false;
        if (!filters.operatorIds.includes(r.operatorId)) return false;
      }
      return true;
    });

    return sortIssues(out, sortConfig, {
      itemName: itemNameById,
      machineName: machineNameById,
      operatorName: operatorNameById,
    });
  }, [rows, filters, sortConfig, itemNameById, machineNameById, operatorNameById]);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <div className="relative" ref={exportRef}>
          <button type="button" onClick={(e)=>{ e.stopPropagation(); setExportOpen(v=>!v); }} title="Export" className={`w-9 h-9 rounded-md flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ${cls.navHover} btn-hover`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          {exportOpen && (
            <div className={`absolute right-0 mt-2 w-40 rounded-md shadow-lg border ${cls.cardBorder} ${theme === 'dark' ? 'bg-slate-800' : 'bg-white'} z-50`} onClick={e=>e.stopPropagation()}>
              <div className="p-2">
                <button type="button" className={`w-full text-left px-2 py-1 rounded ${theme === 'dark' ? 'hover:bg-slate-700 text-white' : 'hover:bg-slate-100 text-slate-900'} underline-on-hover btn-hover`} onClick={()=>{ const { lots, piecesByLot } = transformIssuesForExport(filtered, db); exportXlsx(lots, piecesByLot); setExportOpen(false); }}>Export XLSX</button>
                <button type="button" className={`w-full text-left px-2 py-1 rounded ${theme === 'dark' ? 'hover:bg-slate-700 text-white' : 'hover:bg-slate-100 text-slate-900'} underline-on-hover btn-hover`} onClick={()=>{ const { lots, piecesByLot } = transformIssuesForExport(filtered, db); exportCsv(lots, piecesByLot); setExportOpen(false); }}>Export CSV</button>
                <button type="button" className={`w-full text-left px-2 py-1 rounded ${theme === 'dark' ? 'hover:bg-slate-700 text-white' : 'hover:bg-slate-100 text-slate-900'} underline-on-hover btn-hover`} onClick={()=>{ const { lots, piecesByLot } = transformIssuesForExport(filtered, db); exportPdf(lots, piecesByLot, brand); setExportOpen(false); }}>Export PDF</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className={`text-left ${cls.muted}`}>
            <tr>
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
                          { key: ISSUE_DEFAULT_SORT.key, direction: ISSUE_DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...ISSUE_DEFAULT_SORT }) },
                        ]}
                      />
                    )}
                  </ColumnFilter>
                </div>
              </th>
              <th className="py-2 pr-2">
                <div className="flex items-center gap-1">
                  <span>Lot</span>
                  <ColumnFilter
                    title="Filter by lot"
                    align="left"
                    active={isFilterActive(filters.lotNos, lotOptions.length)}
                  >
                    {({ close }) => (
                      <ValueFilterMenu
                        title="Lot numbers"
                        options={lotOptions}
                        selectedValues={filters.lotNos}
                        onApply={(next) => setFilters(f => ({ ...f, lotNos: next === null ? null : next }))}
                        close={close}
                        currentSort={sortConfig}
                        sortOptions={[
                          { key: 'lotNo', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                          { key: 'lotNo', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                          { key: ISSUE_DEFAULT_SORT.key, direction: ISSUE_DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...ISSUE_DEFAULT_SORT }) },
                        ]}
                      />
                    )}
                  </ColumnFilter>
                </div>
              </th>
              <th className="py-2 pr-2">
                <div className="flex items-center gap-1">
                  <span>Machine</span>
                  <ColumnFilter
                    title="Filter by machine"
                    active={isFilterActive(filters.machineIds, machineOptions.length)}
                  >
                    {({ close }) => (
                      <ValueFilterMenu
                        title="Machines"
                        options={machineOptions}
                        selectedValues={filters.machineIds}
                        onApply={(next) => setFilters(f => ({ ...f, machineIds: next === null ? null : next }))}
                        close={close}
                        currentSort={sortConfig}
                        sortOptions={[
                          { key: 'machineName', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                          { key: 'machineName', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                          { key: ISSUE_DEFAULT_SORT.key, direction: ISSUE_DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...ISSUE_DEFAULT_SORT }) },
                        ]}
                      />
                    )}
                  </ColumnFilter>
                </div>
              </th>
              <th className="py-2 pr-2">
                <div className="flex items-center gap-1">
                  <span>Operator</span>
                  <ColumnFilter
                    title="Filter by operator"
                    active={isFilterActive(filters.operatorIds, operatorOptions.length)}
                  >
                    {({ close }) => (
                      <ValueFilterMenu
                        title="Operators"
                        options={operatorOptions}
                        selectedValues={filters.operatorIds}
                        onApply={(next) => setFilters(f => ({ ...f, operatorIds: next === null ? null : next }))}
                        close={close}
                        currentSort={sortConfig}
                        sortOptions={[
                          { key: 'operatorName', direction: 'asc', label: 'Sort A to Z', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                          { key: 'operatorName', direction: 'desc', label: 'Sort Z to A', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                          { key: ISSUE_DEFAULT_SORT.key, direction: ISSUE_DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...ISSUE_DEFAULT_SORT }) },
                        ]}
                      />
                    )}
                  </ColumnFilter>
                </div>
              </th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Weight (kg)</th>
              <th className="py-2 pr-2">Pieces</th>
              <th className="py-2 pr-2">Note</th>
              <th className="py-2 pr-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length===0? <tr><td colSpan={10} className="py-4">No issues match filters.</td></tr> : filtered.map((r, idx) => (
              <tr key={r.id || idx} className={`border-t ${cls.rowBorder} align-top row-hover`}>
                <td className="py-2 pr-2">{r.date}</td>
                <td className="py-2 pr-2">{db.items.find(i=>i.id===r.itemId)?.name || "—"}</td>
                <td className="py-2 pr-2">{r.lotNo}</td>
                <td className="py-2 pr-2">{db.machines.find(m=>m.id===r.machineId)?.name || "—"}</td>
                <td className="py-2 pr-2">{db.operators.find(o=>o.id===r.operatorId)?.name || "—"}</td>
                <td className="py-2 pr-2 text-right">{r.count}</td>
                <td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td>
                <td className="py-2 pr-2 font-mono whitespace-pre-wrap">{r.pieceIds.join(", ")}</td>
                <td className="py-2 pr-2">{r.note || "—"}</td>
                <td className="py-2 pr-2 flex items-center justify-center">
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={deletingId === r.id}
                    title="Delete"
                    className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ${deletingId === r.id ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}`}
                  >
                    {deletingId === r.id ? (
                      <svg className="w-4 h-4 animate-spin text-red-500" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-red-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18M8 6v12a2 2 0 002 2h4a2 2 0 002-2V6M10 6V4a2 2 0 012-2h0a2 2 0 012 2v2"/></svg>
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function transformIssuesForExport(issues, db) {
  const lots = issues.map((r, idx) => ({
    lotNo: r.lotNo || `issue-${r.id || idx}`,
    date: r.date,
    itemName: db.items.find(i => i.id === r.itemId)?.name || '',
    firmName: '',
    supplierName: '',
    machineName: db.machines.find(m => m.id === r.machineId)?.name || '',
    operatorName: db.operators.find(o => o.id === r.operatorId)?.name || '',
    totalPieces: r.count,
    totalWeight: r.totalWeight,
  }));

  const piecesByLot = {};
  for (const r of issues) {
    const key = r.lotNo || `issue-${r.id || ''}`;
    piecesByLot[key] = (r.pieceIds || []).map((id, i) => ({ id, seq: i+1, weight: '' }));
  }
  return { lots, piecesByLot };
}
