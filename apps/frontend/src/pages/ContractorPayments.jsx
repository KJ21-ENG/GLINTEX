import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import {
  Button, Input, Card, CardContent, CardHeader, CardTitle, Table, TableBody,
  TableCell, TableHead, TableHeader, TableRow, Select, Badge, Label,
} from '../components/ui';
import { TablePagination, TableResultCount, TableStateRow } from '../components/data-table';
import AccessDenied from '../components/common/AccessDenied';
import { DisabledWithTooltip } from '../components/common/DisabledWithTooltip';
import { applySheetFilters, SheetColumnFilter } from '../components/common/SheetColumnFilters';
import { AlertTriangle, Plus, Trash2, FileText, IndianRupee, RefreshCw, Check, X, Pencil } from 'lucide-react';
import * as api from '../api/client';
import { useSubmitLock } from '../hooks/useSubmitLock';

const PROCESS_OPTIONS = [
  { value: 'cutter', label: 'Cutter' },
  { value: 'holo', label: 'Holo' },
  { value: 'coning', label: 'Coning' },
];
const ADJUSTMENT_OPTIONS = [
  { value: 'bonus', label: 'Bonus (+)' },
  { value: 'other', label: 'Other (+)' },
  { value: 'advance_recovery', label: 'Advance Recovery (−)' },
  { value: 'deduction', label: 'Deduction (−)' },
];
const PAYMENT_MODES = ['Cash', 'Bank', 'UPI', 'Other'];
const ADJ_LABEL = { bonus: 'Bonus', other: 'Other', advance_recovery: 'Advance Recovery', deduction: 'Deduction' };
const TABLE_PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 25;

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v) => Number(v || 0).toFixed(3);
const isAddition = (type) => type === 'bonus' || type === 'other';
const signedAdj = (type, amount) => (isAddition(type) ? 1 : -1) * Math.abs(Number(amount) || 0);

const PROCESS_QUANTITY_META = {
  cutter: { unit: 'Bobbins', header: 'Qty (Bobbins)' },
  holo: { unit: 'Rolls', header: 'Qty (Rolls)' },
  coning: { unit: 'Cones', header: 'Qty (Cones)' },
};

// Process-specific quality-total columns live in one configuration map so new
// process metrics can be added without changing the shared table structure.
const PROCESS_QUALITY_TOTAL_COLUMNS = {
  cutter: [
    { key: 'issuedRolls', label: 'Rolls issued', knownKey: 'issuedRollsKnown' },
    { key: 'receivedBobbins', label: 'Bobbins received', knownKey: 'receivedBobbinsKnown' },
  ],
};

function quantityMeta(process) {
  return PROCESS_QUANTITY_META[process] || { unit: 'Units', header: 'Qty' };
}

function qualityTotalColumns(process) {
  return PROCESS_QUALITY_TOTAL_COLUMNS[process] || [];
}

function asQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.trunc(quantity) : null;
}

function formatQuantity(value, known = true) {
  const quantity = asQuantity(value);
  if (!known || quantity === null) return '—';
  return quantity.toLocaleString('en-IN');
}

function summarizeQuantities(lines) {
  let total = 0;
  let known = true;
  for (const line of lines) {
    const quantity = asQuantity(line.quantity);
    if (quantity === null) known = false;
    else total += quantity;
  }
  return { total, known };
}

function groupSettlementLines(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = [
      line.itemId,
      line.yarnId,
      line.cutId,
      line.twistId,
      line.side,
      line.coneTypeId,
      line.ratePerKg,
    ].join('|');
    const existing = map.get(key) || {
      key,
      itemName: line.itemName,
      yarnName: line.yarnName,
      cutName: line.cutName,
      twistName: line.twistName,
      side: line.side,
      coneTypeName: line.coneTypeName,
      ratePerKg: line.ratePerKg,
      quantity: 0,
      quantityKnown: true,
      issuedRolls: 0,
      issuedRollsKnown: true,
      receivedBobbins: 0,
      receivedBobbinsKnown: true,
      cutterIssueIds: new Set(),
      netKg: 0,
      amount: 0,
    };
    existing.netKg += Number(line.netKg || 0);
    existing.amount += Number(line.amount || 0);
    const quantity = asQuantity(line.quantity);
    if (quantity === null) existing.quantityKnown = false;
    else existing.quantity += quantity;

    if (line.process === 'cutter') {
      if (quantity === null) existing.receivedBobbinsKnown = false;
      else existing.receivedBobbins += quantity;

      const issuedRolls = asQuantity(line.cutterIssuedRolls);
      if (!line.cutterIssueId || issuedRolls === null) {
        existing.issuedRollsKnown = false;
      } else if (!existing.cutterIssueIds.has(line.cutterIssueId)) {
        existing.cutterIssueIds.add(line.cutterIssueId);
        existing.issuedRolls += issuedRolls;
      }
    }
    map.set(key, existing);
  }
  return Array.from(map.values()).map(({ cutterIssueIds, ...group }) => group);
}

function summarizeQualityTotals(groups, process) {
  const metricColumns = qualityTotalColumns(process);
  const totals = { rowCount: 0, netKg: 0, amount: 0 };
  for (const column of metricColumns) {
    totals[column.key] = 0;
    totals[column.knownKey] = true;
  }
  for (const group of groups) {
    totals.rowCount += Number(group.rowCount || 0);
    totals.netKg += Number(group.netKg || 0);
    totals.amount += Number(group.amount || 0);
    for (const column of metricColumns) {
      if (group[column.knownKey] === false) totals[column.knownKey] = false;
      else totals[column.key] += Number(group[column.key] || 0);
    }
  }
  totals.netKg = Number(totals.netKg.toFixed(3));
  totals.amount = round2(totals.amount);
  return totals;
}

function compareSettlementText(left, right) {
  return String(left || '').trim().localeCompare(String(right || '').trim(), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortSettlementGroups(groups) {
  return [...groups].sort((left, right) => (
    compareSettlementText(left.yarnName, right.yarnName)
    || compareSettlementText(left.itemName, right.itemName)
    || compareSettlementText(left.cutName, right.cutName)
    || compareSettlementText(left.twistName, right.twistName)
    || compareSettlementText(left.coneTypeName, right.coneTypeName)
    || compareSettlementText(left.side, right.side)
    || Number(left.ratePerKg || 0) - Number(right.ratePerKg || 0)
  ));
}

function settlementQualityText(process, line) {
  if (process === 'cutter') return line.itemName || '—';
  if (process === 'holo') return [line.yarnName, line.itemName, line.twistName].filter(Boolean).join(' · ') || '—';
  const base = [line.yarnName, line.itemName, line.twistName].filter(Boolean).join(' · ');
  const cone = line.coneTypeName ? ` · Cone:${line.coneTypeName}` : '';
  return (base + cone) || '—';
}

function settlementSideText(side) {
  return side === 'SINGLE' ? 'S/S' : side === 'BOTH' ? 'B/S' : '—';
}

function isoDate(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
/*
 * Contractor settlements use a production period. Keep the pair display
 * helper compatible with older single-day records.
 */
function settlementDate(s) {
  return s.periodFrom === s.periodTo ? s.periodFrom : `${s.periodFrom} → ${s.periodTo}`;
}

function qualityText(process, l) {
  if (process === 'cutter') return [l.itemName, l.cutName].filter(Boolean).join(' · ') || '—';
  const base = [l.yarnName, l.cutName].filter(Boolean).join(' · ');
  const extra = l.twistName ? ` · T:${l.twistName}` : '';
  const cone = l.coneTypeName ? ` · Cone:${l.coneTypeName}` : '';
  return (base + extra + cone) || '—';
}
function sideText(side) { return side === 'SINGLE' ? 'S/S' : side === 'BOTH' ? 'B/S' : '—'; }
function blockerReasonLabel(reason) {
  switch (reason) {
    case 'missing_side': return 'Missing Side';
    case 'missing_quality': return 'Missing Quality';
    case 'no_rate': return 'No Rate';
    case 'ambiguous_rate': return 'Ambiguous Rate';
    default: return 'Blocked';
  }
}

function matchesTextFilter(value, filter) {
  const query = String(filter?.query || '').trim().toLowerCase();
  return !query || String(value || '').toLowerCase().includes(query);
}

function selectedFilterValues(filters, id) {
  const filter = filters?.[id];
  return filter?.kind === 'values' && Array.isArray(filter.selected) ? filter.selected : null;
}

function historyListParams(filters, contractors) {
  const contractorNames = selectedFilterValues(filters, 'contractor');
  const processes = selectedFilterValues(filters, 'process');
  const contractorIds = contractorNames === null ? null : contractorNames
    .map((name) => contractors.find((contractor) => contractor.name === name)?.id)
    .filter(Boolean);
  const period = filters?.period?.kind === 'date' ? filters.period : {};
  return {
    ...(contractorIds === null ? {} : { contractorIds: contractorIds.join(',') || '__none__' }),
    ...(processes === null ? {} : { processes: processes.join(',') || '__none__' }),
    ...(period.from ? { from: period.from } : {}),
    ...(period.to ? { to: period.to } : {}),
  };
}

export function ContractorPayments() {
  const { db } = useInventory();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin || (user?.roleKeys || []).includes('admin');
  const { canRead, canWrite, canDelete } = usePermission('contractor_payments');

  const contractors = useMemo(() => (db.contractors || []).filter((c) => c.isActive !== false), [db.contractors]);

  const [filters, setFilters] = useState({ process: 'coning', from: isoDate(new Date()), to: isoDate(new Date()) });
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [previewColumnFilters, setPreviewColumnFilters] = useState({});
  const [previewOpenFilterId, setPreviewOpenFilterId] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [adjustments, setAdjustments] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  const [view, setView] = useState('preview');
  const [settlements, setSettlements] = useState([]);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementTotalPages, setSettlementTotalPages] = useState(1);
  const [historyColumnFilters, setHistoryColumnFilters] = useState({});
  const [historyOpenFilterId, setHistoryOpenFilterId] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [detail, setDetail] = useState(null);

  // Changing any filter invalidates the current preview (its process/period no
  // longer match), so clear it to avoid showing stale rows/headers.
  const clearPreview = () => { setPreview(null); setSelected(new Set()); setPreviewColumnFilters({}); setPreviewPage(1); setCreateMsg(''); setPreviewErr(''); };
  const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); clearPreview(); };

  const runPreview = useCallback(async () => {
    setPreviewErr(''); setCreateMsg('');
    if (!filters.process || !filters.from || !filters.to) {
      setPreviewErr('Select a process and production date range.');
      return;
    }
    if (filters.from > filters.to) {
      setPreviewErr('From date must be on or before To date.');
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await api.getContractorPayablePreview(filters);
      setPreview(res);
      setSelected(new Set((res.lines || []).map((l) => l.sourceRowId)));
      setPreviewColumnFilters({});
      setPreviewPage(1);
    } catch (err) {
      setPreview(null);
      setPreviewErr(err.message || 'Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  }, [filters]);

  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = preview && preview.lines.length > 0 && preview.lines.every((l) => selected.has(l.sourceRowId));
  const toggleAll = () => {
    if (!preview) return;
    setSelected(allSelected ? new Set() : new Set(preview.lines.map((l) => l.sourceRowId)));
  };

  const selectedLines = useMemo(() => (preview?.lines || []).filter((l) => selected.has(l.sourceRowId)), [preview, selected]);
  const previewFilteredLines = useMemo(() => {
    return (preview?.lines || []).filter((line) => [
      matchesTextFilter(line.barcode || line.lotNo, previewColumnFilters.barcode),
      matchesTextFilter(qualityText(preview.process, line), previewColumnFilters.quality),
    ].every(Boolean));
  }, [preview, previewColumnFilters]);
  const previewTotalPages = Math.max(1, Math.ceil(previewFilteredLines.length / TABLE_PAGE_SIZE));
  const previewVisibleLines = useMemo(() => previewFilteredLines.slice(
    (previewPage - 1) * TABLE_PAGE_SIZE,
    previewPage * TABLE_PAGE_SIZE,
  ), [previewFilteredLines, previewPage]);
  const selProductionKg = useMemo(() => selectedLines.reduce((a, l) => a + Number(l.netKg || 0), 0), [selectedLines]);
  const selProductionAmount = useMemo(() => round2(selectedLines.reduce((a, l) => a + Number(l.amount || 0), 0)), [selectedLines]);
  const adjustmentsTotal = useMemo(() => round2(adjustments.reduce((a, x) => a + signedAdj(x.type, x.amount), 0)), [adjustments]);
  const finalPayable = round2(selProductionAmount + adjustmentsTotal);

  const addAdjustment = () => setAdjustments((a) => [...a, { type: 'bonus', amount: '', reason: '' }]);
  const setAdj = (i, k, v) => setAdjustments((a) => a.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const removeAdj = (i) => setAdjustments((a) => a.filter((_, idx) => idx !== i));

  const cleanAdjustments = () => adjustments
    .filter((x) => Number(x.amount) > 0 && x.reason.trim())
    .map((x) => ({ type: x.type, amount: Number(x.amount), reason: x.reason.trim() }));

  const [, wrapCreateDraft] = useSubmitLock();
  const createDraft = wrapCreateDraft(async () => {
    setCreateMsg(''); setCreating(true);
    try {
      const payload = {
        process: filters.process,
        from: filters.from,
        to: filters.to,
        sourceRowIds: Array.from(selected),
        adjustments: cleanAdjustments(),
      };
      const created = await api.createContractorSettlement(payload);
      setCreateMsg(`Draft created — Final payable ₹ ${money(created.finalPayable)}.`);
      setPreview(null); setSelected(new Set()); setAdjustments([]);
      if (view === 'drafts') loadSettlements('draft');
    } catch (err) {
      const details = err.details?.blockers;
      setCreateMsg(err.message + (details?.length ? ` (${details.length} blocked rows)` : ''));
    } finally {
      setCreating(false);
    }
  });

  const loadSettlements = useCallback(async (status) => {
    setLoadingList(true);
    try {
      const result = await api.listContractorSettlements({
        status,
        page: settlementPage,
        pageSize: HISTORY_PAGE_SIZE,
        ...historyListParams(historyColumnFilters, contractors),
      });
      setSettlements(result.rows || []);
      setSettlementTotal(Number(result.total || 0));
      setSettlementTotalPages(Number(result.totalPages || 1));
    } catch (err) {
      setSettlements([]);
      setSettlementTotal(0);
      setSettlementTotalPages(1);
    } finally {
      setLoadingList(false);
    }
  }, [contractors, historyColumnFilters, settlementPage]);

  useEffect(() => {
    if (view === 'drafts') loadSettlements('draft');
    if (view === 'paid') loadSettlements('paid');
  }, [view, loadSettlements]);

  useEffect(() => {
    if (previewPage > previewTotalPages) setPreviewPage(previewTotalPages);
  }, [previewPage, previewTotalPages]);

  const updateHistoryFilters = (updater) => {
    setHistoryColumnFilters(updater);
    setSettlementPage(1);
  };
  const clearHistoryFilters = () => {
    setHistoryColumnFilters({});
    setSettlementPage(1);
  };

  const openDetail = async (id) => {
    try { const s = await api.getContractorSettlement(id); setDetail(s); }
    catch (err) { alert(err.message || 'Failed to load settlement'); }
  };
  const refreshDetailAndList = async (id) => {
    if (id) await openDetail(id);
    if (view === 'drafts') loadSettlements('draft');
    if (view === 'paid') loadSettlements('paid');
  };

  const contractorName = (id) => contractors.find((c) => c.id === id)?.name
    || (db.contractors || []).find((c) => c.id === id)?.name || '—';
  const processOwner = (db.contractor_assignments || []).find((a) => a.process === filters.process);
  const showSide = filters.process === 'coning';
  const processTotalColumns = qualityTotalColumns(filters.process);
  const previewTotal = useMemo(() => summarizeQualityTotals(preview?.qualityTotals || [], filters.process), [preview?.qualityTotals, filters.process]);

  // Permission guard AFTER all hooks so hook order stays stable across renders.
  if (!canRead) {
    return (
      <div className="space-y-6 fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Contractor Payments</h1>
        <AccessDenied message="You do not have access to contractor payments. Contact an administrator to request access." />
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Contractor Payments</h1>
        <div className="flex gap-1 rounded-lg border p-1">
          {['preview', 'drafts', 'paid'].map((v) => (
            <button key={v} onClick={() => { setView(v); if (v !== view) setSettlementPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-md capitalize ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
              {v === 'preview' ? 'Preview' : v === 'drafts' ? 'Draft History' : 'Paid History'}
            </button>
          ))}
        </div>
      </div>

      {view === 'preview' && (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Process contractor</Label>
                  <div className="h-10 rounded-md border bg-muted/30 px-3 flex items-center text-sm">
                    {preview?.contractor?.name || (processOwner ? contractorName(processOwner.contractorId) : 'Configure in Masters')}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Process</Label>
                  <Select value={filters.process} onChange={(e) => setF('process', e.target.value)}>
                    {PROCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">From date</Label>
                  <Input type="date" value={filters.from} onChange={(e) => setF('from', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">To date</Label>
                  <Input type="date" value={filters.to} onChange={(e) => setF('to', e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Rates are taken from the current card for this process.</span>
                <div className="flex-1" />
                <Button onClick={runPreview} disabled={loadingPreview}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${loadingPreview ? 'animate-spin' : ''}`} /> Preview
                </Button>
              </div>
              {previewErr && <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">{previewErr}</div>}
              {createMsg && <div className="rounded-md border border-primary/40 bg-primary/10 text-sm px-3 py-2">{createMsg}</div>}
            </CardContent>
          </Card>

          {preview && (
            <>
              {preview.truncated && (
                <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Too many production rows for this date range (over {preview.rowFetchLimit}).
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Payable Rows" value={selectedLines.length} sub={`of ${preview.lines.length} eligible`} />
                <SummaryCard label="Net KG" value={kg(selProductionKg)} />
                <SummaryCard label="Production ₹" value={money(selProductionAmount)} />
                <SummaryCard label="Blockers" value={preview.blockers.length} warn={preview.blockers.length > 0} />
              </div>

              {/* Blockers */}
              {preview.blockers.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Missing-data blockers ({preview.blockers.length})</CardTitle></CardHeader>
                  <CardContent>
                    <div className="rounded-md border max-h-[30vh] overflow-auto">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Date</TableHead><TableHead>Barcode / Lot</TableHead>
                          <TableHead className="text-right">Net KG</TableHead><TableHead>Reason</TableHead><TableHead>Detail</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {preview.blockers.map((b) => (
                            <TableRow key={b.sourceRowId} className="bg-amber-50/50">
                              <TableCell>{b.date || '—'}</TableCell>
                              <TableCell>{b.barcode || b.lotNo || '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{kg(b.netKg)}</TableCell>
                              <TableCell><Badge className="bg-amber-100 text-amber-800 border-amber-300">{blockerReasonLabel(b.reason)}</Badge></TableCell>
                              <TableCell className="text-sm text-muted-foreground">{b.message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Quality totals */}
              {preview.qualityTotals.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Quality-wise totals</CardTitle></CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-auto">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Quality</TableHead>{showSide && <TableHead>Side</TableHead>}
                          {processTotalColumns.map((column) => <TableHead key={column.key} className="text-right">{column.label}</TableHead>)}
                          <TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Net KG</TableHead>
                          <TableHead className="text-right">₹/KG</TableHead><TableHead className="text-right">Amount ₹</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {preview.qualityTotals.map((q) => (
                            <TableRow key={q.key}>
                              <TableCell>{qualityText(preview.process, q)}</TableCell>
                              {showSide && <TableCell>{sideText(q.side)}</TableCell>}
                              {processTotalColumns.map((column) => (
                                <TableCell key={column.key} className="text-right tabular-nums">
                                  {formatQuantity(q[column.key], q[column.knownKey] !== false)}
                                </TableCell>
                              ))}
                              <TableCell className="text-right tabular-nums">{q.rowCount}</TableCell>
                              <TableCell className="text-right tabular-nums">{kg(q.netKg)}</TableCell>
                              <TableCell className="text-right tabular-nums">{money(q.ratePerKg)}</TableCell>
                              <TableCell className="text-right tabular-nums">{money(q.amount)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/30 font-semibold">
                            <TableCell>TOTAL</TableCell>
                            {showSide && <TableCell />}
                            {processTotalColumns.map((column) => (
                              <TableCell key={column.key} className="text-right tabular-nums">
                                {formatQuantity(previewTotal[column.key], previewTotal[column.knownKey] !== false)}
                              </TableCell>
                            ))}
                            <TableCell className="text-right tabular-nums">{previewTotal.rowCount}</TableCell>
                            <TableCell className="text-right tabular-nums">{kg(previewTotal.netKg)}</TableCell>
                            <TableCell />
                            <TableCell className="text-right tabular-nums">{money(previewTotal.amount)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Row-level */}
              <Card>
                <CardHeader><CardTitle className="text-base">Production rows ({previewFilteredLines.length} of {preview.lines.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="rounded-md border max-h-[45vh] overflow-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead className="w-10"><input type="checkbox" checked={!!allSelected} onChange={toggleAll} /></TableHead>
                        <TableHead>Date</TableHead>
                        <FilterTableHead label="Barcode / Lot" column={{ id: 'barcode', label: 'Barcode / Lot', kind: 'text' }} rows={preview.lines}
                          filters={previewColumnFilters} setFilters={(updater) => { setPreviewColumnFilters(updater); setPreviewPage(1); }}
                          openId={previewOpenFilterId} setOpenId={setPreviewOpenFilterId} />
                        <FilterTableHead label="Quality" column={{ id: 'quality', label: 'Quality', kind: 'text' }} rows={preview.lines}
                          filters={previewColumnFilters} setFilters={(updater) => { setPreviewColumnFilters(updater); setPreviewPage(1); }}
                          openId={previewOpenFilterId} setOpenId={setPreviewOpenFilterId} />
                        {showSide && <TableHead>Side</TableHead>}
                        <TableHead className="text-right">Net KG</TableHead><TableHead className="text-right">₹/KG</TableHead><TableHead className="text-right">Amount ₹</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {previewVisibleLines.length === 0 ? (
                          <TableStateRow colSpan={showSide ? 8 : 7} emptyMessage="No payable rows for this selection." />
                        ) : previewVisibleLines.map((l) => (
                          <TableRow key={l.sourceRowId} className={selected.has(l.sourceRowId) ? '' : 'opacity-60'}>
                            <TableCell><input type="checkbox" checked={selected.has(l.sourceRowId)} onChange={() => toggleRow(l.sourceRowId)} /></TableCell>
                            <TableCell>{l.date || '—'}</TableCell>
                            <TableCell>{l.barcode || l.lotNo || '—'}</TableCell>
                            <TableCell>{qualityText(preview.process, l)}</TableCell>
                            {showSide && <TableCell>{sideText(l.side)}</TableCell>}
                            <TableCell className="text-right tabular-nums">{kg(l.netKg)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(l.ratePerKg)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(l.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <TableResultCount
                      shown={previewVisibleLines.length}
                      total={previewFilteredLines.length}
                      rangeStart={previewFilteredLines.length ? ((previewPage - 1) * TABLE_PAGE_SIZE) + 1 : 0}
                    />
                    <TablePagination page={previewPage} totalPages={previewTotalPages} onPageChange={setPreviewPage} />
                  </div>
                </CardContent>
              </Card>

              {/* Adjustments + final payable */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Adjustments</CardTitle>
                  <Button size="sm" variant="outline" onClick={addAdjustment}><Plus className="w-4 h-4 mr-1" /> Add</Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {adjustments.length === 0 && <p className="text-sm text-muted-foreground">No adjustments. Add bonuses, advance recoveries, or deductions.</p>}
                  {adjustments.map((a, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[160px_120px_1fr_40px] gap-2 items-center">
                      <Select value={a.type} onChange={(e) => setAdj(i, 'type', e.target.value)}>
                        {ADJUSTMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                      <Input type="number" min="0" step="0.01" placeholder="Amount" value={a.amount} onChange={(e) => setAdj(i, 'amount', e.target.value)} />
                      <Input placeholder="Reason (required)" value={a.reason} onChange={(e) => setAdj(i, 'reason', e.target.value)} />
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeAdj(i)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                  <div className="border-t pt-3 space-y-1 text-sm max-w-xs ml-auto">
                    <div className="flex justify-between"><span className="text-muted-foreground">Production</span><span className="tabular-nums">₹ {money(selProductionAmount)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Adjustments</span><span className="tabular-nums">₹ {money(adjustmentsTotal)}</span></div>
                    <div className="flex justify-between font-bold text-base"><span>Final Payable</span><span className="tabular-nums">₹ {money(finalPayable)}</span></div>
                  </div>
                  <div className="flex justify-end">
                    <DisabledWithTooltip disabled={!canWrite} tooltip="You do not have permission to create settlements.">
                      <Button onClick={createDraft} disabled={creating || !canWrite || (selected.size === 0 && cleanAdjustments().length === 0)}>
                        <IndianRupee className="w-4 h-4 mr-2" /> Create Draft
                      </Button>
                    </DisabledWithTooltip>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {(view === 'drafts' || view === 'paid') && (
        <SettlementList
          rows={settlements}
          loading={loadingList}
          status={view === 'drafts' ? 'draft' : 'paid'}
          contractorName={contractorName}
          onOpen={openDetail}
          contractors={contractors}
          filters={historyColumnFilters}
          setFilters={updateHistoryFilters}
          openFilterId={historyOpenFilterId}
          setOpenFilterId={setHistoryOpenFilterId}
          onClearFilters={clearHistoryFilters}
          page={settlementPage}
          total={settlementTotal}
          totalPages={settlementTotalPages}
          onPageChange={setSettlementPage}
        />
      )}

      {detail && (
        <SettlementDetailModal
          settlement={detail}
          isAdmin={isAdmin}
          canWrite={canWrite}
          canDelete={canDelete}
          onClose={() => setDetail(null)}
          onChanged={refreshDetailAndList}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, warn }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${warn ? 'text-amber-600' : ''}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function FilterTableHead({ label, column, rows, filters, setFilters, openId, setOpenId, className = '', contentClassName = '' }) {
  return (
    <TableHead className={className}>
      <div className={`flex items-center gap-1 ${contentClassName}`}>
        <span>{label}</span>
        <SheetColumnFilter column={column} rows={rows} filters={filters} setFilters={setFilters} openId={openId} setOpenId={setOpenId} />
      </div>
    </TableHead>
  );
}

function SettlementList({
  rows, loading, status, contractorName, onOpen, contractors, filters, setFilters,
  openFilterId, setOpenFilterId, onClearFilters, page, total, totalPages, onPageChange,
}) {
  const contractorColumn = { id: 'contractor', label: 'Contractor', kind: 'values', facetOptions: contractors.map((contractor) => contractor.name) };
  const processColumn = { id: 'process', label: 'Process', kind: 'values', facetOptions: PROCESS_OPTIONS.map((option) => option.value) };
  const periodColumn = { id: 'period', label: 'Period', kind: 'date' };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base capitalize">{status} settlements</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <TableResultCount shown={rows.length} total={total} rangeStart={total ? ((page - 1) * HISTORY_PAGE_SIZE) + 1 : 0} isLoading={loading} />
          <Button size="sm" variant="outline" onClick={onClearFilters}>Clear filters</Button>
        </div>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <FilterTableHead label="Contractor" column={contractorColumn} rows={rows} filters={filters} setFilters={setFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
              <FilterTableHead label="Process" column={processColumn} rows={rows} filters={filters} setFilters={setFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
              <FilterTableHead label="Period" column={periodColumn} rows={rows} filters={filters} setFilters={setFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
              <TableHead className="text-right">Net KG</TableHead><TableHead className="text-right">Final ₹</TableHead>
              {status === 'paid' && <TableHead>Paid</TableHead>}
              <TableHead className="w-20"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableStateRow colSpan={status === 'paid' ? 7 : 6} isLoading />
              ) : rows.length === 0 ? (
                <TableStateRow colSpan={status === 'paid' ? 7 : 6} emptyMessage={`No ${status} settlements.`} />
              ) : rows.map((s) => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-accent/40" onClick={() => onOpen(s.id)}>
                  <TableCell className="font-medium">{s.contractor?.name || contractorName(s.contractorId)}</TableCell>
                  <TableCell className="capitalize">{s.process}</TableCell>
                  <TableCell className="text-sm">{settlementDate(s)}</TableCell>
                  <TableCell className="text-right tabular-nums">{kg(s.productionKg)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(s.finalPayable)}</TableCell>
                  {status === 'paid' && <TableCell className="text-sm">{s.paymentDate} · {s.paymentMode}</TableCell>}
                  <TableCell><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(s.id); }}>Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <TablePagination page={page} totalPages={totalPages} onPageChange={onPageChange} isLoading={loading} />
      </CardContent>
    </Card>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className={`bg-card border rounded-lg shadow-lg w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} my-8`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function SettlementDetailModal({ settlement, isAdmin, canWrite, canDelete, onClose, onChanged }) {
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [paidEditOpen, setPaidEditOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [summaryFilters, setSummaryFilters] = useState({});
  const [summaryOpenFilterId, setSummaryOpenFilterId] = useState(null);
  const showSide = settlement.process === 'coning';
  const isDraft = settlement.status === 'draft';
  const lines = settlement.lines || [];
  const groups = useMemo(() => sortSettlementGroups(groupSettlementLines(lines)), [lines]);
  const quantitySummary = useMemo(() => summarizeQuantities(lines), [lines]);
  const quantityInfo = quantityMeta(settlement.process);
  const quantityHeader = quantityInfo.header;
  const processTotalColumns = qualityTotalColumns(settlement.process);
  const summaryColumns = useMemo(() => [
    {
      id: 'quality', label: 'Quality', kind: 'values',
      getValue: (group) => settlementQualityText(settlement.process, group),
    },
    { id: 'cut', label: 'Cut', kind: 'values', getValue: (group) => group.cutName || '' },
    ...(showSide ? [{ id: 'side', label: 'Side', kind: 'values', getValue: (group) => settlementSideText(group.side) }] : []),
    ...(processTotalColumns.length > 0
      ? processTotalColumns.map((column) => ({ id: column.key, label: column.label, kind: 'number', getValue: (group) => group[column.key] }))
      : [{ id: 'quantity', label: quantityHeader, kind: 'number', getValue: (group) => group.quantity }]),
    { id: 'netKg', label: 'Net KG', kind: 'number', getValue: (group) => group.netKg },
    { id: 'rate', label: 'Rate', kind: 'number', getValue: (group) => group.ratePerKg },
    { id: 'amount', label: 'Amount', kind: 'number', getValue: (group) => group.amount },
  ], [settlement.process, showSide, processTotalColumns, quantityHeader]);
  const summaryColumn = useCallback((id) => summaryColumns.find((column) => column.id === id), [summaryColumns]);
  const filteredGroups = useMemo(
    () => applySheetFilters(groups, summaryColumns, summaryFilters),
    [groups, summaryColumns, summaryFilters]
  );
  const groupTotals = useMemo(() => filteredGroups.reduce((totals, group) => ({
    netKg: totals.netKg + group.netKg,
    amount: totals.amount + group.amount,
  }), { netKg: 0, amount: 0 }), [filteredGroups]);
  const groupMetricTotals = useMemo(() => summarizeQualityTotals(filteredGroups, settlement.process), [filteredGroups, settlement.process]);
  const filteredQuantitySummary = useMemo(() => filteredGroups.reduce((summary, group) => {
    if (group.quantityKnown === false) return { ...summary, known: false };
    return { ...summary, total: summary.total + (asQuantity(group.quantity) || 0) };
  }, { total: 0, known: true }), [filteredGroups]);
  const summaryColSpan = 2 + (showSide ? 1 : 0) + (processTotalColumns.length || 1) + 3;

  const doDelete = async () => {
    if (!confirm('Delete this draft settlement? Its rows will be freed.')) return;
    setBusy(true); setErr('');
    try { await api.deleteContractorSettlement(settlement.id); onClose(); onChanged(null); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const doPdf = async () => {
    try { await api.downloadContractorSettlementPdf(settlement.id); }
    catch (e) { setErr(e.message || 'Failed to download PDF'); }
  };
  const doRefreshProduction = async () => {
    setBusy(true); setErr('');
    try {
      const preview = await api.getContractorPayablePreview({
        process: settlement.process,
        from: settlement.periodFrom,
        to: settlement.periodTo,
        excludeSettlementId: settlement.id,
      });
      if (preview.truncated) throw new Error('Production preview is truncated; narrow the date range before syncing.');
      if (preview.blockers?.length) {
        throw new Error(`Cannot sync while ${preview.blockers.length} production row(s) have missing data or rates.`);
      }
      await api.updateContractorSettlementDraft(settlement.id, {
        sourceRowIds: (preview.lines || []).map((line) => line.sourceRowId),
      });
      setSyncOpen(false);
      await onChanged(settlement.id);
    } catch (e) {
      setSyncOpen(false);
      setErr(e.message || 'Failed to sync production rows');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${settlement.contractor?.name || 'Settlement'} — ${settlement.process}`} onClose={onClose} wide>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <Badge variant={isDraft ? 'secondary' : 'default'} className="capitalize">{settlement.status}</Badge>
        <span className="text-muted-foreground">{settlementDate(settlement)}</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={doPdf}><FileText className="w-4 h-4 mr-1" /> PDF</Button>
        {isDraft && canWrite && <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)} disabled={busy}><RefreshCw className={`w-4 h-4 mr-1 ${busy ? 'animate-spin' : ''}`} /> Sync Production</Button>}
        {isDraft && canWrite && <Button size="sm" onClick={() => setMarkPaidOpen(true)}><Check className="w-4 h-4 mr-1" /> Mark Paid</Button>}
        {isDraft && canDelete && <Button size="sm" variant="outline" className="text-destructive" onClick={doDelete} disabled={busy}><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>}
        {!isDraft && isAdmin && <Button size="sm" variant="outline" onClick={() => setPaidEditOpen(true)}><Pencil className="w-4 h-4 mr-1" /> Admin Edit</Button>}
      </div>
      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
        <Stat label={`QTY (${quantityInfo.unit})`} value={formatQuantity(quantitySummary.total, quantitySummary.known)} />
        <Stat label="Net KG" value={kg(settlement.productionKg)} />
        <Stat label="Production ₹" value={money(settlement.productionAmount)} />
        <Stat label="Adjustments ₹" value={money(settlement.adjustmentsTotal)} />
        <Stat label="Final Payable ₹" value={money(settlement.finalPayable)} bold />
      </div>

      {/* Quality & Side summary */}
      <div className="rounded-md border max-h-[35vh] overflow-auto">
        <div className="px-3 pt-3 text-sm font-medium">Quality &amp; Side Breakdown</div>
        <Table>
          <TableHeader><TableRow>
            <FilterTableHead label="Quality" column={summaryColumn('quality')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} />
            <FilterTableHead label="Cut" column={summaryColumn('cut')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} />
            {showSide && <FilterTableHead label="Side" column={summaryColumn('side')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} />}
            {processTotalColumns.length > 0
              ? processTotalColumns.map((column) => <FilterTableHead key={column.key} label={column.label} column={summaryColumn(column.key)} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} className="text-right" contentClassName="justify-end" />)
              : <FilterTableHead label={quantityHeader} column={summaryColumn('quantity')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} className="text-right" contentClassName="justify-end" />}
            <FilterTableHead label="Net KG" column={summaryColumn('netKg')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} className="text-right" contentClassName="justify-end" />
            <FilterTableHead label="Rate" column={summaryColumn('rate')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} className="text-right" contentClassName="justify-end" />
            <FilterTableHead label="Amount" column={summaryColumn('amount')} rows={groups} filters={summaryFilters} setFilters={setSummaryFilters} openId={summaryOpenFilterId} setOpenId={setSummaryOpenFilterId} className="text-right" contentClassName="justify-end" />
          </TableRow></TableHeader>
          <TableBody>
            {filteredGroups.length === 0 ? <TableStateRow colSpan={summaryColSpan} emptyMessage={groups.length ? 'No rows match the filters.' : 'No production lines.'} /> : (
              <>
                {filteredGroups.map((group) => (
                  <TableRow key={group.key}>
                    <TableCell>{settlementQualityText(settlement.process, group)}</TableCell>
                    <TableCell>{group.cutName || '—'}</TableCell>
                    {showSide && <TableCell>{settlementSideText(group.side)}</TableCell>}
                    {processTotalColumns.length > 0
                      ? processTotalColumns.map((column) => (
                        <TableCell key={column.key} className="text-right tabular-nums">
                          {formatQuantity(group[column.key], group[column.knownKey] !== false)}
                        </TableCell>
                      ))
                      : <TableCell className="text-right tabular-nums">{formatQuantity(group.quantity, group.quantityKnown)}</TableCell>}
                    <TableCell className="text-right tabular-nums">{kg(group.netKg)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(group.ratePerKg)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(group.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell />
                  {showSide && <TableCell />}
                  {processTotalColumns.length > 0
                    ? processTotalColumns.map((column) => (
                      <TableCell key={column.key} className="text-right tabular-nums">
                        {formatQuantity(groupMetricTotals[column.key], groupMetricTotals[column.knownKey] !== false)}
                      </TableCell>
                    ))
                    : <TableCell className="text-right tabular-nums">{formatQuantity(filteredQuantitySummary.total, filteredQuantitySummary.known)}</TableCell>}
                  <TableCell className="text-right tabular-nums">{kg(groupTotals.netKg)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{money(groupTotals.amount)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Adjustments */}
      {(settlement.adjustments || []).length > 0 && (
        <div>
          <div className="text-sm font-medium mb-1">Adjustments</div>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {settlement.adjustments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{ADJ_LABEL[a.type] || a.type}</TableCell>
                    <TableCell>{a.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{isAddition(a.type) ? '+' : '−'} {money(a.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Payment metadata */}
      {settlement.status === 'paid' && (
        <div className="text-sm rounded-md border bg-muted/30 p-3 grid grid-cols-2 gap-1">
          <div><span className="text-muted-foreground">Paid on:</span> {settlement.paymentDate}</div>
          <div><span className="text-muted-foreground">Mode:</span> {settlement.paymentMode}</div>
          <div><span className="text-muted-foreground">Reference:</span> {settlement.paymentReference || '—'}</div>
          <div><span className="text-muted-foreground">Notes:</span> {settlement.paymentNotes || '—'}</div>
        </div>
      )}

      {/* Revisions */}
      {(settlement.revisions || []).length > 0 && (
        <div>
          <div className="text-sm font-medium mb-1">Revision history</div>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Reason</TableHead><TableHead>By</TableHead>
                <TableHead className="text-right">Prev ₹</TableHead><TableHead className="text-right">New ₹</TableHead><TableHead className="text-right">Delta ₹</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {settlement.revisions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.revisionNumber}</TableCell>
                    <TableCell className="text-sm">{r.reason}</TableCell>
                    <TableCell className="text-sm">{r.changedByUsername || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.previousTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.newTotal)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${Number(r.delta) >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                      {Number(r.delta) >= 0 ? '+' : ''}{money(r.delta)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {syncOpen && (
        <Modal title="Sync Production" onClose={() => setSyncOpen(false)}>
          <p className="text-sm text-muted-foreground">
            Replace this draft's production lines with every currently eligible row from {settlementDate(settlement)}. Existing adjustments are preserved.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSyncOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={doRefreshProduction} disabled={busy}>
              <RefreshCw className={`w-4 h-4 mr-1 ${busy ? 'animate-spin' : ''}`} /> Sync Production
            </Button>
          </div>
        </Modal>
      )}

      {markPaidOpen && (
        <MarkPaidDialog settlement={settlement} onClose={() => setMarkPaidOpen(false)}
          onDone={async () => { setMarkPaidOpen(false); await onChanged(settlement.id); }} />
      )}
      {paidEditOpen && (
        <PaidEditDialog settlement={settlement} onClose={() => setPaidEditOpen(false)}
          onDone={async () => { setPaidEditOpen(false); await onChanged(settlement.id); }} />
      )}
    </Modal>
  );
}

function Stat({ label, value, bold }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${bold ? 'font-bold text-lg' : ''}`}>{value}</div>
    </div>
  );
}

function MarkPaidDialog({ settlement, onClose, onDone }) {
  const [form, setForm] = useState({ paymentDate: '', paymentMode: 'Cash', paymentReference: '', paymentNotes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [, wrapSubmit] = useSubmitLock();
  const submit = wrapSubmit(async () => {
    setBusy(true); setErr('');
    try { await api.markContractorSettlementPaid(settlement.id, form); await onDone(); }
    catch (e) { setErr(e.message + (e.details?.mismatches?.length ? ` (${e.details.mismatches.length} row(s) changed)` : '')); }
    finally { setBusy(false); }
  });
  return (
    <Modal title="Mark Paid" onClose={onClose}>
      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}
      <div className="rounded-md border bg-muted/30 p-3 text-sm flex justify-between"><span>Final Payable</span><span className="font-bold tabular-nums">₹ {money(settlement.finalPayable)}</span></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Payment Date *</Label><Input type="date" value={form.paymentDate} onChange={(e) => set('paymentDate', e.target.value)} /></div>
        <div><Label className="text-xs">Mode *</Label>
          <Select value={form.paymentMode} onChange={(e) => set('paymentMode', e.target.value)}>
            {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </div>
        <div className="col-span-2"><Label className="text-xs">Reference</Label><Input value={form.paymentReference} onChange={(e) => set('paymentReference', e.target.value)} placeholder="Txn / cheque / UPI ref" /></div>
        <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={form.paymentNotes} onChange={(e) => set('paymentNotes', e.target.value)} /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !form.paymentDate}>Confirm Payment</Button>
      </div>
    </Modal>
  );
}

// Admin-only paid correction: remove lines, override KG/rate, edit adjustments,
// mandatory reason. Shows previous vs new values and the resulting delta.
function PaidEditDialog({ settlement, onClose, onDone }) {
  const showSide = settlement.process === 'coning';
  const [removeIds, setRemoveIds] = useState(() => new Set());
  const [overrides, setOverrides] = useState({}); // lineId -> {netKg, ratePerKg}
  const [adjustments, setAdjustments] = useState(() => (settlement.adjustments || []).map((a) => ({ type: a.type, amount: String(a.amount), reason: a.reason })));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [payment, setPayment] = useState({
    paymentDate: settlement.paymentDate || '',
    paymentMode: settlement.paymentMode || 'Cash',
    paymentReference: settlement.paymentReference || '',
    paymentNotes: settlement.paymentNotes || '',
  });
  const [available, setAvailable] = useState(null); // null=not loaded, []=none
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [addSelected, setAddSelected] = useState(() => new Set());

  const existingRowIds = useMemo(() => new Set((settlement.lines || []).map((l) => l.sourceRowId)), [settlement.lines]);
  const setPay = (k, v) => setPayment((p) => ({ ...p, [k]: v }));
  const toggleRemove = (id) => setRemoveIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setOverride = (id, k, v) => setOverrides((o) => ({ ...o, [id]: { ...o[id], [k]: v } }));
  const toggleAdd = (id) => setAddSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const loadAvailable = async () => {
    setLoadingAvail(true); setErr('');
    try {
      const res = await api.getContractorPayablePreview({
        process: settlement.process,
        from: settlement.periodFrom,
        to: settlement.periodTo,
        excludeSettlementId: settlement.id,
      });
      setAvailable((res.lines || []).filter((l) => !existingRowIds.has(l.sourceRowId)));
    } catch (e) { setErr(e.message || 'Failed to load available rows'); }
    finally { setLoadingAvail(false); }
  };
  const addableLines = useMemo(() => (available || []).filter((l) => addSelected.has(l.sourceRowId)), [available, addSelected]);

  // Live projected total from current edits (existing lines + newly added rows).
  const projected = useMemo(() => {
    let prod = 0;
    for (const l of settlement.lines || []) {
      if (removeIds.has(l.id)) continue;
      const ov = overrides[l.id] || {};
      const netKg = ov.netKg !== undefined && ov.netKg !== '' ? Number(ov.netKg) : Number(l.netKg);
      const rate = ov.ratePerKg !== undefined && ov.ratePerKg !== '' ? Number(ov.ratePerKg) : Number(l.ratePerKg);
      prod += Math.round(netKg * rate * 100) / 100;
    }
    for (const l of addableLines) prod += Number(l.amount || 0);
    const adj = adjustments.reduce((a, x) => a + signedAdj(x.type, x.amount), 0);
    return { prod: Math.round(prod * 100) / 100, final: Math.round((prod + adj) * 100) / 100 };
  }, [settlement.lines, removeIds, overrides, adjustments, addableLines]);

  const delta = Math.round((projected.final - Number(settlement.finalPayable)) * 100) / 100;

  const setAdj = (i, k, v) => setAdjustments((a) => a.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const addAdj = () => setAdjustments((a) => [...a, { type: 'bonus', amount: '', reason: '' }]);
  const removeAdj = (i) => setAdjustments((a) => a.filter((_, idx) => idx !== i));

  const [, wrapSubmit] = useSubmitLock();
  const submit = wrapSubmit(async () => {
    if (!reason.trim()) { setErr('A reason is required.'); return; }
    setBusy(true); setErr('');
    try {
      const lineOverrides = Object.entries(overrides)
        .filter(([id]) => !removeIds.has(id))
        .map(([lineId, ov]) => ({
          lineId,
          ...(ov.netKg !== undefined && ov.netKg !== '' ? { netKg: Number(ov.netKg) } : {}),
          ...(ov.ratePerKg !== undefined && ov.ratePerKg !== '' ? { ratePerKg: Number(ov.ratePerKg) } : {}),
        }))
        .filter((o) => o.netKg !== undefined || o.ratePerKg !== undefined);
      const payload = {
        reason: reason.trim(),
        removeLineIds: Array.from(removeIds),
        addSourceRowIds: Array.from(addSelected),
        lineOverrides,
        adjustments: adjustments.filter((x) => Number(x.amount) > 0 && x.reason.trim()).map((x) => ({ type: x.type, amount: Number(x.amount), reason: x.reason.trim() })),
        paymentDate: payment.paymentDate || null,
        paymentMode: payment.paymentMode || null,
        paymentReference: payment.paymentReference || null,
        paymentNotes: payment.paymentNotes || null,
      };
      const res = await api.adminEditContractorSettlement(settlement.id, payload);
      setResult(res);
    } catch (e) {
      setErr(e.message + (e.details?.blockers?.length ? ` (${e.details.blockers.length} blocked)` : ''));
    } finally { setBusy(false); }
  });

  if (result) {
    return (
      <Modal title="Correction Applied" onClose={onDone}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Previous total</span><span className="tabular-nums">₹ {money(result.revision.previousTotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">New total</span><span className="tabular-nums">₹ {money(result.revision.newTotal)}</span></div>
          <div className="flex justify-between font-bold text-base"><span>{Number(result.delta) >= 0 ? 'Additional amount due' : 'Recovery due'}</span>
            <span className={`tabular-nums ${Number(result.delta) >= 0 ? 'text-green-600' : 'text-destructive'}`}>₹ {money(Math.abs(result.delta))}</span></div>
        </div>
        <div className="flex justify-end"><Button onClick={onDone}>Done</Button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Admin — Edit Paid Settlement" onClose={onClose} wide>
      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}
      <p className="text-sm text-muted-foreground">Add or remove production lines, override KG/rate, change adjustments, or update payment details. A reason is mandatory and an immutable revision is recorded.</p>

      <div className="rounded-md border max-h-[30vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10">Del</TableHead><TableHead>Date</TableHead><TableHead>Quality</TableHead>
            {showSide && <TableHead>Side</TableHead>}
            <TableHead className="w-28">Net KG</TableHead><TableHead className="w-28">₹/KG</TableHead><TableHead className="text-right">Amount</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(settlement.lines || []).map((l) => {
              const removed = removeIds.has(l.id);
              const ov = overrides[l.id] || {};
              const netKg = ov.netKg !== undefined && ov.netKg !== '' ? Number(ov.netKg) : Number(l.netKg);
              const rate = ov.ratePerKg !== undefined && ov.ratePerKg !== '' ? Number(ov.ratePerKg) : Number(l.ratePerKg);
              return (
                <TableRow key={l.id} className={removed ? 'opacity-40 line-through' : ''}>
                  <TableCell><input type="checkbox" checked={removed} onChange={() => toggleRemove(l.id)} /></TableCell>
                  <TableCell>{l.date || '—'}</TableCell>
                  <TableCell className="text-sm">{qualityText(settlement.process, l)}</TableCell>
                  {showSide && <TableCell>{sideText(l.side)}</TableCell>}
                  <TableCell><Input className="h-8" type="number" step="0.001" disabled={removed} value={ov.netKg ?? ''} placeholder={kg(l.netKg)} onChange={(e) => setOverride(l.id, 'netKg', e.target.value)} /></TableCell>
                  <TableCell><Input className="h-8" type="number" step="0.0001" disabled={removed} value={ov.ratePerKg ?? ''} placeholder={money(l.ratePerKg)} onChange={(e) => setOverride(l.id, 'ratePerKg', e.target.value)} /></TableCell>
                  <TableCell className="text-right tabular-nums">{removed ? '—' : money(Math.round(netKg * rate * 100) / 100)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium">Adjustments</div>
          <Button size="sm" variant="outline" onClick={addAdj}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </div>
        {adjustments.map((a, i) => (
          <div key={i} className="grid grid-cols-[160px_120px_1fr_40px] gap-2 items-center mb-2">
            <Select value={a.type} onChange={(e) => setAdj(i, 'type', e.target.value)}>
              {ADJUSTMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Input type="number" min="0" step="0.01" placeholder="Amount" value={a.amount} onChange={(e) => setAdj(i, 'amount', e.target.value)} />
            <Input placeholder="Reason" value={a.reason} onChange={(e) => setAdj(i, 'reason', e.target.value)} />
            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeAdj(i)}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </div>

      {/* Add production rows */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium">Add production rows</div>
          <Button size="sm" variant="outline" onClick={loadAvailable} disabled={loadingAvail}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loadingAvail ? 'animate-spin' : ''}`} /> {available === null ? 'Load available' : 'Reload'}
          </Button>
        </div>
        {available !== null && (
          available.length === 0 ? (
            <p className="text-sm text-muted-foreground">No additional unclaimed rows for this date range.</p>
          ) : (
            <div className="rounded-md border max-h-[25vh] overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10">Add</TableHead><TableHead>Date</TableHead><TableHead>Quality</TableHead>
                  {showSide && <TableHead>Side</TableHead>}
                  <TableHead className="text-right">Net KG</TableHead><TableHead className="text-right">₹/KG</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {available.map((l) => (
                    <TableRow key={l.sourceRowId} className={addSelected.has(l.sourceRowId) ? '' : 'opacity-60'}>
                      <TableCell><input type="checkbox" checked={addSelected.has(l.sourceRowId)} onChange={() => toggleAdd(l.sourceRowId)} /></TableCell>
                      <TableCell>{l.date || '—'}</TableCell>
                      <TableCell className="text-sm">{qualityText(settlement.process, l)}</TableCell>
                      {showSide && <TableCell>{sideText(l.side)}</TableCell>}
                      <TableCell className="text-right tabular-nums">{kg(l.netKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.ratePerKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </div>

      {/* Payment details */}
      <div>
        <div className="text-sm font-medium mb-1">Payment details</div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Payment Date</Label><Input type="date" value={payment.paymentDate} onChange={(e) => setPay('paymentDate', e.target.value)} /></div>
          <div><Label className="text-xs">Mode</Label>
            <Select value={payment.paymentMode} onChange={(e) => setPay('paymentMode', e.target.value)}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <div className="col-span-2"><Label className="text-xs">Reference</Label><Input value={payment.paymentReference} onChange={(e) => setPay('paymentReference', e.target.value)} /></div>
          <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={payment.paymentNotes} onChange={(e) => setPay('paymentNotes', e.target.value)} /></div>
        </div>
      </div>

      {/* Previous vs new + delta */}
      <div className="grid grid-cols-3 gap-2 text-sm rounded-md border bg-muted/30 p-3">
        <div><div className="text-xs text-muted-foreground">Previous Final</div><div className="tabular-nums font-semibold">₹ {money(settlement.finalPayable)}</div></div>
        <div><div className="text-xs text-muted-foreground">New Final (projected)</div><div className="tabular-nums font-semibold">₹ {money(projected.final)}</div></div>
        <div><div className="text-xs text-muted-foreground">{delta >= 0 ? 'Additional Due' : 'Recovery Due'}</div><div className={`tabular-nums font-bold ${delta >= 0 ? 'text-green-600' : 'text-destructive'}`}>₹ {money(Math.abs(delta))}</div></div>
      </div>

      <div><Label className="text-xs">Reason for correction *</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this paid settlement being changed?" /></div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !reason.trim()}>Apply Correction</Button>
      </div>
    </Modal>
  );
}

export default ContractorPayments;
