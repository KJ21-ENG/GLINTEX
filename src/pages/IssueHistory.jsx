/**
 * IssueHistory page component for GLINTEX Inventory
 */

import React, { useMemo, useState, useRef } from 'react';
import { useBrand } from '../context';
import { formatKg } from '../utils';
import { Input, Select } from '../components';
import { exportXlsx, exportCsv, exportPdf } from '../services';

export function IssueHistory({ db, rows: rowsProp }) {
  const { cls, theme, brand } = useBrand();
  const exportRef = useRef(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [filters, setFilters] = useState({ itemId: '', lotSearch: '', from: '', to: '' });

  const rows = useMemo(() => {
    return Array.isArray(rowsProp) ? rowsProp.slice() : (db.consumptions || []).slice();
  }, [db.consumptions, rowsProp]);

  const filtered = useMemo(() => {
    const out = rows.filter(r => {
      if (filters.itemId && r.itemId !== filters.itemId) return false;
      if (filters.lotSearch && !String(r.lotNo || '').toLowerCase().includes(filters.lotSearch.toLowerCase())) return false;
      if (filters.from && r.date < filters.from) return false;
      if (filters.to && r.date > filters.to) return false;
      return true;
    });

    // If both from and to are set, show results oldest->latest (ascending). Otherwise keep latest->oldest (descending).
    if (filters.from && filters.to) {
      return out.sort((a, b) => a.date.localeCompare(b.date));
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, filters]);

  const items = db.items || [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className={`text-xs ${cls.muted}`}>Date From</label>
          <Input type="date" value={filters.from} onChange={e=>setFilters(f=>({ ...f, from: e.target.value }))} />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className={`text-xs ${cls.muted}`}>Date To</label>
          <Input type="date" value={filters.to} onChange={e=>setFilters(f=>({ ...f, to: e.target.value }))} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className={`text-xs ${cls.muted}`}>Item</label>
          <Select value={filters.itemId} onChange={e=>setFilters(f=>({ ...f, itemId: e.target.value }))}>
            <option value="">Any</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className={`text-xs ${cls.muted}`}>Lot</label>
          <Input value={filters.lotSearch} onChange={e=>setFilters(f=>({ ...f, lotSearch: e.target.value }))} placeholder="Search lot" />
        </div>
        <div className="flex-shrink-0">
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
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Lot</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Weight (kg)</th><th className="py-2 pr-2">Pieces</th><th className="py-2 pr-2">Note</th></tr></thead>
          <tbody>
            {filtered.length===0? <tr><td colSpan={7} className="py-4">No issues match filters.</td></tr> : filtered.map((r, idx) => (
              <tr key={r.id || idx} className={`border-t ${cls.rowBorder} align-top row-hover`}>
                <td className="py-2 pr-2">{r.date}</td>
                <td className="py-2 pr-2">{db.items.find(i=>i.id===r.itemId)?.name || "—"}</td>
                <td className="py-2 pr-2">{r.lotNo}</td>
                <td className="py-2 pr-2 text-right">{r.count}</td>
                <td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td>
                <td className="py-2 pr-2 font-mono whitespace-pre-wrap">{r.pieceIds.join(", ")}</td>
                <td className="py-2 pr-2">{r.note || "—"}</td>
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
