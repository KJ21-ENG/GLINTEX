/**
 * Stock page component for GLINTEX Inventory
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Select, Pill, ColumnFilter, ValueFilterMenu, DateFilterMenu, Pagination } from '../components';
import { PieceRow } from '../components/stock';
import { formatKg, todayISO, aggregateLots } from '../utils';
import * as api from '../api';
import { exportXlsx, exportCsv, exportPdf } from '../services';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active (pending > 0)' },
  { value: 'inactive', label: 'Inactive (pending = 0)' },
];

const DEFAULT_SORT = { key: 'lotNo', direction: 'asc' };
const EPSILON = 1e-9;

function lotStatus(lot) {
  const pending = Number(lot.pendingWeight || 0);
  const initial = Number(lot.totalWeight || 0);
  if (pending > EPSILON && pending <= initial + EPSILON) return 'active';
  if (Math.abs(pending) <= EPSILON) return 'inactive';
  return pending > 0 ? 'active' : 'inactive';
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function getSortValue(lot, key) {
  switch (key) {
    case 'lotNo':
      return lot.lotNo || '';
    case 'date':
      return lot.dateISO || lot.date || '';
    case 'itemName':
      return lot.itemName || lot.name || '';
    case 'firmName':
      return lot.firmName || lot.firm || '';
    case 'supplierName':
      return lot.supplierName || lot.supplier || '';
    case 'availableCount':
      return lot.availableCount ?? ((lot.pieces || []).filter(p => p.status === 'available').length);
    case 'totalWeight':
      return Number(lot.totalWeight || 0);
    case 'pendingWeight':
      return Number(lot.pendingWeight || 0);
    default:
      return lot[key] ?? '';
  }
}

function sortLots(list, config) {
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

export function Stock({ db, onIssueToMachine, refreshing, refreshDb }) {
  const { cls, brand, theme } = useBrand();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  const [filters, setFilters] = useState({
    lotNos: null,
    itemIds: null,
    firmIds: null,
    supplierIds: null,
    from: '',
    to: '',
    statuses: ['active'],
  });
  const [sortConfig, setSortConfig] = useState(() => ({ ...DEFAULT_SORT }));
  const [expandedLot, setExpandedLot] = useState(null);
  const [selectedByLot, setSelectedByLot] = useState({});
  const [deletingLot, setDeletingLot] = useState(null);
  const [issuingLot, setIssuingLot] = useState(null);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueModalData, setIssueModalData] = useState({ lotNo: '', pieceIds: [], date: todayISO(), machineId: '', operatorId: '', note: '' });
  const [isSummaryView, setIsSummaryView] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const receiveTotalsMap = useMemo(() => {
    const map = new Map();
    (db.receive_piece_totals || []).forEach(row => {
      map.set(row.pieceId, Number(row.totalNetWeight || 0));
    });
    return map;
  }, [db.receive_piece_totals]);

  // Prepare lots with all pieces (include non-available ones too) and compute available/pending totals
  const lotsMap = useMemo(() => {
    const m = {};
    for (const lot of db.lots) {
      m[lot.lotNo] = {
        ...lot,
        itemName: db.items.find(i => i.id === lot.itemId)?.name || '—',
        firmName: db.firms.find(f => f.id === lot.firmId)?.name || '—',
        supplierName: db.suppliers.find(s => s.id === lot.supplierId)?.name || '—',
        pieces: [],
        availableCount: 0,
        pendingWeight: 0,
        totalReceivedWeight: 0,
      };
    }
    for (const piece of db.inbound_items) {
      if (!m[piece.lotNo]) continue;
      const inboundWeight = Number(piece.weight || 0);
      const receivedWeight = receiveTotalsMap.get(piece.id) || 0;
      const pendingForPiece = Math.max(0, inboundWeight - receivedWeight);
      const pieceEntry = { ...piece, pendingWeight: pendingForPiece, receivedWeight };
      m[piece.lotNo].pieces.push(pieceEntry);
      if (piece.status === 'available') {
        m[piece.lotNo].availableCount = (m[piece.lotNo].availableCount || 0) + 1;
      }
      m[piece.lotNo].pendingWeight = (m[piece.lotNo].pendingWeight || 0) + pendingForPiece;
      m[piece.lotNo].totalReceivedWeight = (m[piece.lotNo].totalReceivedWeight || 0) + receivedWeight;
    }
    Object.values(m).forEach(lot => {
      lot.statusType = lotStatus(lot);
    });
    return m;
  }, [db.lots, db.items, db.firms, db.suppliers, db.inbound_items, receiveTotalsMap]);

  // Include all lots (even those with zero available pieces) so filters like "inactive" work
  const allLots = useMemo(() => Object.values(lotsMap), [lotsMap]);

  const itemOptions = useMemo(() => {
    return [...db.items]
      .map(i => ({ value: i.id, label: i.name || '—', key: i.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [db.items]);

  const firmOptions = useMemo(() => {
    return [...db.firms]
      .map(fm => ({ value: fm.id, label: fm.name || '—', key: fm.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [db.firms]);

  const supplierOptions = useMemo(() => {
    return [...db.suppliers]
      .map(s => ({ value: s.id, label: s.name || '—', key: s.id }))
      .sort((a, b) => compareValues((a.label || '').toLowerCase(), (b.label || '').toLowerCase()));
  }, [db.suppliers]);

  const statusOptions = useMemo(() => STATUS_OPTIONS.map(opt => ({ ...opt, key: opt.value })), []);

  const lotOptions = useMemo(() => {
    const map = new Map();
    for (const lot of allLots) {
      const value = lot.lotNo ?? null;
      const key = value ?? '__blank__';
      if (!map.has(key)) {
        map.set(key, { value, label: value ?? '(Blank)', key });
      }
    }
    return Array.from(map.values()).sort((a, b) => compareValues(a.label, b.label));
  }, [allLots]);

  // Apply filters
  const filteredLots = useMemo(() => {
    const next = allLots.filter(l => {
      if (Array.isArray(filters.itemIds)) {
        if (filters.itemIds.length === 0) return false;
        if (!filters.itemIds.includes(l.itemId)) return false;
      }
      if (Array.isArray(filters.firmIds)) {
        if (filters.firmIds.length === 0) return false;
        if (!filters.firmIds.includes(l.firmId)) return false;
      }
      if (Array.isArray(filters.supplierIds)) {
        if (filters.supplierIds.length === 0) return false;
        if (!filters.supplierIds.includes(l.supplierId)) return false;
      }
      if (Array.isArray(filters.lotNos)) {
        if (filters.lotNos.length === 0) return false;
        if (!filters.lotNos.includes(l.lotNo)) return false;
      }
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      if (Array.isArray(filters.statuses)) {
        if (filters.statuses.length === 0) return false;
        const status = l.statusType || lotStatus(l);
        if (!filters.statuses.includes(status)) return false;
      }
      return true;
    });
    return sortLots(next, sortConfig);
  }, [allLots, filters, sortConfig]);

  function toggleExpand(lotNo) { setExpandedLot(prev => (prev === lotNo ? null : lotNo)); }

  function togglePiece(lotNo, pieceId) {
    setSelectedByLot(prev => {
      const next = { ...prev };
      const arr = new Set(next[lotNo] || []);
      if (arr.has(pieceId)) arr.delete(pieceId); else arr.add(pieceId);
      next[lotNo] = Array.from(arr);
      return next;
    });
  }

  function selectAll(lotNo) { setSelectedByLot(prev => ({ ...prev, [lotNo]: (lotsMap[lotNo].pieces || []).map(p=>p.id) })); }
  function clearSel(lotNo) { setSelectedByLot(prev => ({ ...prev, [lotNo]: [] })); }

  async function handleDelete(lotNo, e) {
    e.stopPropagation();
    const selected = (selectedByLot[lotNo] || []).slice();
    // If there are selected pieces, but all pieces are selected -> treat as deleting whole lot
    const totalPiecesForLot = (lotsMap[lotNo] && (lotsMap[lotNo].pieces || []).length) || 0;
    if (selected.length && selected.length === totalPiecesForLot) {
      // fall through to whole-lot delete
    } else if (selected.length) {
      if (!confirm(`Delete ${selected.length} selected piece(s) from lot ${lotNo}? This cannot be undone.`)) return;
      setDeletingLot(lotNo);
      try {
        await Promise.all(selected.map(id => api.deleteInboundItem(id)));
        // clear selection for this lot
        setSelectedByLot(prev => ({ ...prev, [lotNo]: [] }));
        await refreshDb();
        alert('Selected pieces deleted');
      } catch (err) {
        alert(err.message || 'Failed to delete selected pieces');
      } finally {
        setDeletingLot(null);
      }
      return;
    }

    // otherwise delete whole lot
    if (!confirm('Delete lot '+lotNo+'? This will remove all pieces and history for this lot.')) return;
    setDeletingLot(lotNo);
    try {
      await api.deleteLot(lotNo);
      await refreshDb();
      alert('Deleted lot');
    } catch (err) {
      alert(err.message || err || 'Failed to delete lot');
    } finally {
      setDeletingLot(null);
    }
  }

  function openIssueModal(lotNo) {
    const pieceIds = (selectedByLot[lotNo] || []).slice();
    if (!pieceIds.length) { alert('Select pieces to issue'); return; }
    setIssueModalData({ 
      lotNo, 
      pieceIds, 
      date: todayISO(), 
      machineId: '', 
      operatorId: '', 
      note: '' 
    });
    setIssueModalOpen(true);
  }

  function closeIssueModal() {
    setIssueModalOpen(false);
    setIssueModalData({ lotNo: '', pieceIds: [], date: todayISO(), machineId: '', operatorId: '', note: '' });
  }

  async function doIssue() {
    const { lotNo, pieceIds, date, machineId, operatorId, note } = issueModalData;
    if (!machineId) { alert('Please select a machine'); return; }
    if (!operatorId) { alert('Please select an operator'); return; }
    
    const payload = { 
      date, 
      itemId: lotsMap[lotNo].itemId, 
      lotNo, 
      pieceIds, 
      note, 
      machineId, 
      operatorId 
    };
    
    setIssuingLot(lotNo);
    try {
      await onIssueToMachine(payload);
      alert(`Issued ${pieceIds.length} pcs from Lot ${lotNo}`);
      // clear selection for this lot
      setSelectedByLot(prev => ({ ...prev, [lotNo]: [] }));
      setExpandedLot(null);
      closeIssueModal();
    } catch (err) {
      alert(err.message || 'Failed to issue pieces');
    } finally {
      setIssuingLot(null);
    }
  }

  // Export helpers
  function piecesByLot() {
    const map = {};
    for (const l of filteredLots) map[l.lotNo] = (l.pieces || []).map(p => ({ id: p.id, seq: p.seq, weight: p.weight }));
    return map;
  }

  const [hoveredSummaryKey, setHoveredSummaryKey] = useState(null);
  const [persistentOpenKey, setPersistentOpenKey] = useState(null);
  const hidePopoverTimeout = useRef(null);
  const popoverRef = useRef(null);

  React.useEffect(() => {
    return () => { if (hidePopoverTimeout.current) clearTimeout(hidePopoverTimeout.current); };
  }, []);

  // Close persistent popover when clicking outside
  React.useEffect(() => {
    function onDocClick(e) {
      if (!persistentOpenKey) return;
      if (popoverRef.current && popoverRef.current.contains(e.target)) return;
      setPersistentOpenKey(null);
      setHoveredSummaryKey(null);
    }
    if (persistentOpenKey) {
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }
    return undefined;
  }, [persistentOpenKey]);

  const displayedLots = useMemo(() => {
    if (!isSummaryView) return filteredLots;
    // aggregated lots grouped by name/cullah/supplier
    try {
      return aggregateLots(filteredLots);
    } catch (err) {
      console.error('aggregateLots failed', err);
      return filteredLots;
    }
  }, [filteredLots, isSummaryView]);

  useEffect(() => { setPage(1); }, [filters, sortConfig, isSummaryView]);
  const pagedDisplayedLots = useMemo(() => {
    const start = (page - 1) * pageSize;
    return displayedLots.slice(start, start + pageSize);
  }, [displayedLots, page, pageSize]);

  return (
    <div className="space-y-6">
      <Section title={null}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              role="switch"
              aria-checked={isSummaryView}
              onClick={() => setIsSummaryView(v => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsSummaryView(v => !v);
                }
              }}
              className={`relative inline-flex h-8 w-16 items-center rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
                isSummaryView ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/80' : `${cls.cardBorder} ${cls.cardBg}`
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                  isSummaryView ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`${cls.muted}`}>Summary view</span>
          </div>
          <div className="relative" ref={exportRef}>
            <button type="button" onClick={(e)=>{ e.stopPropagation(); setExportOpen(v=>!v); }} title="Export" className={`w-9 h-9 rounded-md flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ${cls.navHover} btn-hover`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            {exportOpen && (
              <div className={`absolute right-0 mt-2 w-40 rounded-md shadow-lg border ${cls.cardBorder} ${theme === 'dark' ? 'bg-slate-800' : 'bg-white'} z-50`} onClick={e=>e.stopPropagation()}>
                <div className="p-2">
                  <button type="button" className={`w-full text-left px-2 py-1 rounded ${theme === 'dark' ? 'hover:bg-slate-700 text-white' : 'hover:bg-slate-100 text-slate-900'} underline-on-hover btn-hover`} onClick={()=>{ exportXlsx(filteredLots, piecesByLot()); setExportOpen(false); }}>Export XLSX</button>
                  <button type="button" className={`w-full text-left px-2 py-1 rounded ${theme === 'dark' ? 'hover:bg-slate-700 text-white' : 'hover:bg-slate-100 text-slate-900'} underline-on-hover btn-hover`} onClick={()=>{ exportCsv(filteredLots, piecesByLot()); setExportOpen(false); }}>Export CSV</button>
                  <button type="button" className={`w-full text-left px-2 py-1 rounded ${theme === 'dark' ? 'hover:bg-slate-700 text-white' : 'hover:bg-slate-100 text-slate-900'} underline-on-hover btn-hover`} onClick={()=>{ exportPdf(filteredLots, piecesByLot(), brand); setExportOpen(false); }}>Export PDF</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                {isSummaryView ? (
                  <>
                    <th className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        <span>Item</span>
                        <ColumnFilter
                          title="Filter by item"
                          align="left"
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
                        <span>Pieces (available/out)</span>
                        <ColumnFilter
                          title="Filter by stock status"
                          active={isFilterActive(filters.statuses, statusOptions.length)}
                        >
                          {({ close }) => (
                            <ValueFilterMenu
                              title="Status"
                              options={statusOptions}
                              selectedValues={filters.statuses}
                              onApply={(next) => setFilters(f => ({ ...f, statuses: next === null ? null : next }))}
                              close={close}
                              currentSort={sortConfig}
                              sortOptions={[
                                { key: 'availableCount', direction: 'desc', label: 'Sort available high to low', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                                { key: 'availableCount', direction: 'asc', label: 'Sort available low to high', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                                { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...DEFAULT_SORT }) },
                              ]}
                            />
                          )}
                        </ColumnFilter>
                      </div>
                    </th>
                    <th className="py-2 pr-2 text-right">Initial Weight (kg)</th>
                    <th className="py-2 pr-2 text-right">Pending Weight (kg)</th>
                  </>
                ) : (
                  <>
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
                              title="Lot numbers"
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
                        <span>Pieces (available/out)</span>
                        <ColumnFilter
                          title="Filter by stock status"
                          active={isFilterActive(filters.statuses, statusOptions.length)}
                        >
                          {({ close }) => (
                            <ValueFilterMenu
                              title="Status"
                              options={statusOptions}
                              selectedValues={filters.statuses}
                              onApply={(next) => setFilters(f => ({ ...f, statuses: next === null ? null : next }))}
                              close={close}
                              currentSort={sortConfig}
                              sortOptions={[
                                { key: 'availableCount', direction: 'desc', label: 'Sort available high to low', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                                { key: 'availableCount', direction: 'asc', label: 'Sort available low to high', onChange: ({ key, direction }) => setSortConfig({ key, direction }) },
                                { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction, label: 'Reset sort (Newest first)', onChange: () => setSortConfig({ ...DEFAULT_SORT }) },
                              ]}
                            />
                          )}
                        </ColumnFilter>
                      </div>
                    </th>
                    <th className="py-2 pr-2 text-right">Initial Weight (kg)</th>
                    <th className="py-2 pr-2 text-right">Pending Weight (kg)</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {displayedLots.length===0? <tr><td colSpan={8} className="py-4">No lots match filters.</td></tr> : pagedDisplayedLots.map((l, idx)=> {
                const isSummary = isSummaryView;
                const rowKey = l.lotNo || `${l.itemName || l.name || ''}-${l.firmName || l.firm || ''}-${l.supplierName || l.supplier || ''}-${idx}`;
                return (
                <React.Fragment key={rowKey}>
                  <tr className={`border-t ${cls.rowBorder} align-top row-hover`} onClick={isSummary ? undefined : ()=>toggleExpand(l.lotNo)} style={{ cursor: isSummary ? 'default' : 'pointer' }}>
                    {isSummary ? (
                      <>
                        <td className="py-2 pr-2 relative">
                          <div className="flex items-center gap-2">
                            <span>{l.itemName || l.name}</span>
                            <div className="relative">
                              <button
                                type="button"
                                title="Show lots"
                                onMouseEnter={() => {
                                  if (hidePopoverTimeout.current) { clearTimeout(hidePopoverTimeout.current); hidePopoverTimeout.current = null; }
                                  setHoveredSummaryKey(rowKey);
                                }}
                                onMouseLeave={() => {
                                  // delay hiding to allow pointer to move to popover
                                  hidePopoverTimeout.current = setTimeout(() => {
                                    if (persistentOpenKey !== rowKey) setHoveredSummaryKey(null);
                                  }, 160);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (persistentOpenKey === rowKey) {
                                    setPersistentOpenKey(null);
                                    setHoveredSummaryKey(null);
                                  } else {
                                    setPersistentOpenKey(rowKey);
                                    setHoveredSummaryKey(rowKey);
                                  }
                                }}
                                className={`w-6 h-6 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} btn-hover`}
                              >
                                <span className="text-xs font-semibold">i</span>
                              </button>
                            {( (hoveredSummaryKey === rowKey) || (persistentOpenKey === rowKey) ) && (l._sourceLots || []).length > 0 && (
                                <div className={`absolute right-0 top-full mt-1 z-50`} ref={popoverRef} onMouseEnter={() => {
                                  if (hidePopoverTimeout.current) { clearTimeout(hidePopoverTimeout.current); hidePopoverTimeout.current = null; }
                                  setHoveredSummaryKey(rowKey);
                                }} onMouseLeave={() => {
                                  hidePopoverTimeout.current = setTimeout(() => {
                                    if (persistentOpenKey !== rowKey) setHoveredSummaryKey(null);
                                  }, 160);
                                }}>
                                  <div className={`popover-panel ${theme === 'dark' ? 'text-white' : 'text-slate-900'} relative`}>
                                    <button title="Apply lots" className={`apply-arrow border ${cls.cardBorder} ${cls.cardBg} btn-hover`} onClick={(e)=>{
                                        e.stopPropagation();
                                        // set filters.lotSearch to comma-separated list and switch off summary view
                                        const lotsToApply = Array.from(new Set(l._sourceLots || []));
                                        setFilters(f => ({ ...f, lotNos: lotsToApply.length ? lotsToApply : [] }));
                                        setIsSummaryView(false);
                                        // close persistent open if any
                                        setPersistentOpenKey(null);
                                      }}>
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
                                    </button>
                                    <div className="text-xs font-medium mb-1">Lots</div>
                                    <div className="lots-grid text-xs">
                                      {(l._sourceLots || []).map((lotNoStr) => (
                                        <div key={lotNoStr} className="lot-chip">{lotNoStr}</div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-2">{(l._firms || []).join(', ')}</td>
                        <td className="py-2 pr-2">{l.supplierName || l.supplier}</td>
                        <td className="py-2 pr-2 text-right">{`${l.availableCount ?? (l.available || 0)} / ${l.totalPieces ?? l.total ?? 0}`}</td>
                        <td className="py-2 pr-2 text-right">{formatKg(l.totalWeight || 0)}</td>
                        <td className="py-2 pr-2 text-right">{formatKg(Number(l.pendingWeight || 0))}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-2 font-medium">{l.lotNo}</td>
                        <td className="py-2 pr-2">{l.date}</td>
                        <td className="py-2 pr-2">{l.itemName || l.name}</td>
                        <td className="py-2 pr-2">{l.firmName || l.firm}</td>
                        <td className="py-2 pr-2">{l.supplierName || l.supplier}</td>
                        <td className="py-2 pr-2 text-right">{`${(l.pieces||[]).filter(p=>p.status==='available').length} / ${l.totalPieces ?? 0}`}</td>
                        <td className="py-2 pr-2 text-right">{formatKg(l.totalWeight || 0)}</td>
                        <td className="py-2 pr-2 text-right">{formatKg(Number(l.pendingWeight || 0))}</td>
                      </>
                    )}
                  </tr>
                  {!isSummary && expandedLot === l.lotNo && (
                    <tr className={`border-t ${cls.rowBorder}`}>
                      <td colSpan={7} className="p-3">
                        <div className={`p-3 rounded-xl border ${cls.cardBorder} ${cls.cardBg}`}>
                          <div className="mb-2 flex items-center gap-2">
                          <Pill>Available: {(l.pieces||[]).length} pcs</Pill>
                          <Pill>Selected: {(selectedByLot[l.lotNo]||[]).length} pcs</Pill>
                          <SecondaryButton onClick={selectAll.bind(null, l.lotNo)} disabled={(l.pieces||[]).length===0}>Select all</SecondaryButton>
                          <SecondaryButton onClick={clearSel.bind(null, l.lotNo)} disabled={(selectedByLot[l.lotNo]||[]).length===0}>Clear</SecondaryButton>
                          <button onClick={(e)=>handleDelete(l.lotNo, e)} title="Delete" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ml-2 hover:opacity-90` }>
                            {deletingLot === l.lotNo ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="animate-spin w-4 h-4 text-red-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-red-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18M8 6v12a2 2 0 002 2h4a2 2 0 002-2V6M10 6V4a2 2 0 012-2h0a2 2 0 012 2v2"/></svg>
                            )}
                          </button>
                          <div className="ml-auto">
                            <Button onClick={(e)=>{ e.stopPropagation(); openIssueModal(l.lotNo); }} disabled={!(selectedByLot[l.lotNo]||[]).length || refreshing}>
                              Issue Selected
                            </Button>
                          </div>
                          </div>

                          <div className="overflow-auto">
                            {(() => {
                              const initialWeight = Number(l.totalWeight || 0);
                              const pendingWeightVal = Number(l.pendingWeight || 0);
                              return (
                                <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Select</th><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2">Seq</th><th className="py-2 pr-2 text-right">Initial Weight (kg)</th><th className="py-2 pr-2 text-right">Pending Weight (kg)</th></tr></thead>
                                  <tbody>
                                    {(l.pieces||[]).sort((a,b)=> a.seq - b.seq).map(p=> (
                                      <PieceRow key={p.id} p={p} lotNo={l.lotNo} selected={(selectedByLot[l.lotNo]||[]).includes(p.id)} onToggle={() => togglePiece(l.lotNo, p.id)} onSaved={() => { refreshDb().catch(()=>{}); }} initialWeight={initialWeight} pendingWeight={p.pendingWeight ?? 0} />
                                    ))}
                                  </tbody>
                                </table>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="mt-2">
        <Pagination total={displayedLots.length} page={page} setPage={setPage} pageSize={pageSize} />
      </div>

      {/* Issue Modal */}
      {issueModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeIssueModal}>
          <div className={`max-w-md w-full mx-4 rounded-xl border ${cls.cardBorder} modal-sheet`} onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Issue Pieces</h3>
                <button onClick={closeIssueModal} className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} hover:opacity-90`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={`text-sm font-medium ${cls.muted} block mb-1`}>Lot: {issueModalData.lotNo}</label>
                  <label className={`text-sm font-medium ${cls.muted} block mb-1`}>Selected Pieces: {issueModalData.pieceIds.length}</label>
                </div>

                <div>
                  <label className={`text-sm font-medium ${cls.muted} block mb-1`}>Date</label>
                  <Input 
                    type="date" 
                    value={issueModalData.date} 
                    onChange={e => setIssueModalData(prev => ({ ...prev, date: e.target.value }))} 
                  />
                </div>

                <div>
                  <label className={`text-sm font-medium ${cls.muted} block mb-1`}>Machine *</label>
                  <Select 
                    value={issueModalData.machineId} 
                    onChange={e => setIssueModalData(prev => ({ ...prev, machineId: e.target.value }))}
                  >
                    <option value="">Select Machine</option>
                    {db.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </div>

                <div>
                  <label className={`text-sm font-medium ${cls.muted} block mb-1`}>Operator *</label>
                  <Select 
                    value={issueModalData.operatorId} 
                    onChange={e => setIssueModalData(prev => ({ ...prev, operatorId: e.target.value }))}
                  >
                    <option value="">Select Operator</option>
                    {db.operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                </div>

                <div>
                  <label className={`text-sm font-medium ${cls.muted} block mb-1`}>Note (optional)</label>
                  <Input 
                    value={issueModalData.note} 
                    onChange={e => setIssueModalData(prev => ({ ...prev, note: e.target.value }))} 
                    placeholder="Reference / reason"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <SecondaryButton onClick={closeIssueModal} className="flex-1">
                    Cancel
                  </SecondaryButton>
                  <Button 
                    onClick={doIssue} 
                    disabled={issuingLot === issueModalData.lotNo || refreshing}
                    className="flex-1"
                  >
                    {issuingLot === issueModalData.lotNo ? 'Issuing…' : 'Issue Pieces'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
