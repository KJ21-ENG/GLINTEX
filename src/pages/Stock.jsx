/**
 * Stock page component for GLINTEX Inventory
 */

import React, { useState, useMemo, useRef } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Select, Pill } from '../components';
import { PieceRow } from '../components/stock';
import { formatKg, todayISO } from '../utils';
import * as api from '../api';
import { exportXlsx, exportCsv, exportPdf } from '../services';

export function Stock({ db, onIssuePieces, refreshing, refreshDb }) {
  const { cls, brand, theme } = useBrand();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  const [filters, setFilters] = useState({ itemId: '', firmId: '', supplierId: '', from: '', to: '', lotSearch: '', type: 'active' });
  const [expandedLot, setExpandedLot] = useState(null);
  const [selectedByLot, setSelectedByLot] = useState({});
  const [issuingLot, setIssuingLot] = useState(null);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueModalData, setIssueModalData] = useState({ lotNo: '', pieceIds: [], date: todayISO(), machineId: '', operatorId: '', note: '' });

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
      };
    }
    for (const p of db.inbound_items) {
      if (!m[p.lotNo]) continue;
      m[p.lotNo].pieces.push(p);
      if (p.status === 'available') {
        m[p.lotNo].availableCount = (m[p.lotNo].availableCount || 0) + 1;
        m[p.lotNo].pendingWeight = (m[p.lotNo].pendingWeight || 0) + Number(p.weight || 0);
      }
    }
    return m;
  }, [db.lots, db.items, db.firms, db.suppliers, db.inbound_items]);

  // Include all lots (even those with zero available pieces) so filters like "inactive" work
  const allLots = useMemo(() => Object.values(lotsMap), [lotsMap]);

  // Apply filters
  const filteredLots = useMemo(() => {
    return allLots.filter(l => {
      if (filters.itemId && l.itemId !== filters.itemId) return false;
      if (filters.firmId && l.firmId !== filters.firmId) return false;
      if (filters.supplierId && l.supplierId !== filters.supplierId) return false;
      if (filters.lotSearch && !l.lotNo.toLowerCase().includes(filters.lotSearch.toLowerCase())) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      // client-side type filter: active / inactive
      // pending = weight available to be issued (computed earlier on lotsMap)
      const pending = Number(l.pendingWeight || 0);
      const initialWeight = Number(l.totalWeight || 0);
      if (filters.type === 'active') {
        // show lots where pending > 0 and pending <= initial
        if (!(pending > 0 && pending <= initialWeight)) return false;
      } else if (filters.type === 'inactive') {
        // show lots where pending === 0
        if (!(Math.abs(pending) < 1e-9)) return false;
      } else if (filters.type === 'all') {
        // no filtering
      }
      return true;
    }).sort((a,b) => (b.date || '').localeCompare(a.date));
  }, [allLots, filters]);

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
      await onIssuePieces(payload);
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

  return (
    <div className="space-y-6">
      <Section title={null}>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3 md:gap-4 mb-3">
          <div><label className={`text-xs ${cls.muted}`}>Lot search</label><Input value={filters.lotSearch} onChange={e=>setFilters(f=>({ ...f, lotSearch: e.target.value }))} placeholder="Search lot no" /></div>
          <div><label className={`text-xs ${cls.muted}`}>Date From</label><Input type="date" value={filters.from} onChange={e=>setFilters(f=>({ ...f, from: e.target.value }))} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Date To</label><Input type="date" value={filters.to} onChange={e=>setFilters(f=>({ ...f, to: e.target.value }))} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={filters.itemId} onChange={e=>setFilters(f=>({ ...f, itemId: e.target.value }))}><option value="">Any</option>{db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Firm</label><Select value={filters.firmId} onChange={e=>setFilters(f=>({ ...f, firmId: e.target.value }))}><option value="">Any</option>{db.firms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Supplier</label><Select value={filters.supplierId} onChange={e=>setFilters(f=>({ ...f, supplierId: e.target.value }))}><option value="">Any</option>{db.suppliers.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Type</label>
            <div className="relative flex items-center gap-2">
              <Select value={filters.type} onChange={e=>setFilters(f=>({ ...f, type: e.target.value }))} style={{ minWidth: 120 }}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
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
          </div>
        </div>

          <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Lot No</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Pieces (available/out)</th><th className="py-2 pr-2 text-right">Initial Weight (kg)</th><th className="py-2 pr-2 text-right">Pending Weight (kg)</th></tr></thead>
            <tbody>
              {filteredLots.length===0? <tr><td colSpan={8} className="py-4">No lots match filters.</td></tr> : filteredLots.map(l=> (
                <React.Fragment key={l.lotNo}>
                  <tr className={`border-t ${cls.rowBorder} align-top row-hover`} onClick={()=>toggleExpand(l.lotNo)} style={{ cursor: 'pointer' }}>
                    <td className="py-2 pr-2 font-medium">{l.lotNo}</td>
                    <td className="py-2 pr-2">{l.date}</td>
                    <td className="py-2 pr-2">{l.itemName}</td>
                    <td className="py-2 pr-2">{l.firmName}</td>
                    <td className="py-2 pr-2">{l.supplierName}</td>
                    <td className="py-2 pr-2 text-right">{`${(l.pieces||[]).filter(p=>p.status==='available').length} / ${l.totalPieces ?? 0}`}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(l.totalWeight || 0)}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(Number(l.pendingWeight || 0))}</td>
                  </tr>
                  {expandedLot === l.lotNo && (
                    <tr className={`border-t ${cls.rowBorder}`}>
                      <td colSpan={7} className="p-3">
                        <div className={`p-3 rounded-xl border ${cls.cardBorder} ${cls.cardBg}`}>
                          <div className="mb-2 flex items-center gap-2">
                          <Pill>Available: {(l.pieces||[]).length} pcs</Pill>
                          <Pill>Selected: {(selectedByLot[l.lotNo]||[]).length} pcs</Pill>
                          <SecondaryButton onClick={selectAll.bind(null, l.lotNo)} disabled={(l.pieces||[]).length===0}>Select all</SecondaryButton>
                          <SecondaryButton onClick={clearSel.bind(null, l.lotNo)} disabled={(selectedByLot[l.lotNo]||[]).length===0}>Clear</SecondaryButton>
                          <button onClick={(e)=>{ e.stopPropagation(); if(!confirm('Delete lot '+l.lotNo+'? This will remove all pieces and history for this lot.')) return; api.deleteLot(l.lotNo).then(()=>{ refreshDb().catch(()=>{}); alert('Deleted'); }).catch(err=>alert(err.message || err)); }} title="Delete lot" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ml-2 hover:opacity-90`}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-red-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18M8 6v12a2 2 0 002 2h4a2 2 0 002-2V6M10 6V4a2 2 0 012-2h0a2 2 0 012 2v2"/></svg>
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
                                      <PieceRow key={p.id} p={p} lotNo={l.lotNo} selected={(selectedByLot[l.lotNo]||[]).includes(p.id)} onToggle={() => togglePiece(l.lotNo, p.id)} onSaved={() => { refreshDb().catch(()=>{}); }} initialWeight={initialWeight} pendingWeight={p.status === 'available' ? p.weight : 0} />
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
              ))}
            </tbody>
          </table>
        </div>
      </Section>

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
