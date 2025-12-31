import React, { useState, useMemo, useEffect } from 'react';
import { useInventory } from '../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Badge, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui';
import { PieceRow } from '../components/stock/PieceRow';
import { BobbinView } from '../components/stock/BobbinView';
import { HoloView } from '../components/stock/HoloView';
import { ConingView } from '../components/stock/ConingView';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { formatKg, todayISO, aggregateLots, formatDateDDMMYYYY } from '../utils';
import * as api from '../api';
import { exportXlsx, exportCsv, exportPdf } from '../services';
import { getProcessDefinition } from '../constants/processes';
import { Search, Download, Filter, ChevronDown, ChevronRight, Trash2, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import { fuzzyScore, calculateMultiTermScore } from '../utils';
import { HighlightMatch } from '../components/common/HighlightMatch';
import { LotPopover } from '../components/stock/LotPopover';
import { cn } from '../lib/utils';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../utils/labelPrint';

const EPSILON = 1e-9;

function lotStatus(lot) {
  const pending = Number(lot.pendingWeight || 0);
  const initial = Number(lot.totalWeight || 0);
  if (pending > EPSILON && pending <= initial + EPSILON) return 'active';
  if (Math.abs(pending) <= EPSILON) return 'inactive';
  return pending > 0 ? 'active' : 'inactive';
}


export function Stock() {
  const { db, createIssueToMachine, refreshing, refreshDb, process } = useInventory();

  // --- Process Config ---
  const processId = process || 'cutter';
  const processDef = getProcessDefinition(processId);
  const { receiveTotalsKey, receiveUnitField, receiveWeightField, unitLabelPlural } = processDef;
  const isCutter = processId === 'cutter';
  const isHolo = processId === 'holo';
  const isConing = processId === 'coning';

  // --- UI State ---
  const [view, setView] = useState(() => (isHolo ? 'holo' : 'jumbo')); // 'jumbo' | 'bobbins' | 'holo'
  const [expandedLot, setExpandedLot] = useState(null);
  const [selectedByLot, setSelectedByLot] = useState({});
  const [groupByItem, setGroupByItem] = useState(false);

  // --- Filters ---
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    item: "",
    firm: "",
    supplier: "",
    status: (process || 'cutter') === 'cutter' ? "available_to_issue" : "active",
    from: "",
    to: ""
  });

  // --- Data Prep (Memoized) ---

  const receiveTotalsMap = useMemo(() => {
    const map = new Map();
    const totalsList = Array.isArray(db?.[receiveTotalsKey]) ? db[receiveTotalsKey] : [];
    totalsList.forEach((row) => {
      map.set(row.pieceId, {
        received: Number(row[receiveWeightField] || 0),
        wastage: Number(row.wastageNetWeight || 0),
        totalUnits: Number(row[receiveUnitField] || 0),
      });
    });
    return map;
  }, [db, receiveTotalsKey, receiveWeightField, receiveUnitField]);

  const lotsMap = useMemo(() => {
    if (!db?.lots) return {};
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
        totalReceivedUnits: 0,
        wastageTotal: 0,
        wastageCount: 0,
        avgWastage: 0,
      };
    }
    const inbound = db.inbound_items || [];
    for (const piece of inbound) {
      if (!m[piece.lotNo]) continue;
      const inboundWeight = Number(piece.weight || 0);
      const totals = receiveTotalsMap.get(piece.id) || { received: 0, wastage: 0, totalUnits: 0 };
      const receivedWeight = totals.received || 0;
      const wastageWeight = totals.wastage || 0;
      const pieceTotalUnits = totals.totalUnits || 0;
      const pendingForPiece = Math.max(0, inboundWeight - receivedWeight - wastageWeight);

      const pieceEntry = {
        ...piece,
        pendingWeight: pendingForPiece,
        receivedWeight,
        wastageWeight,
        totalUnits: pieceTotalUnits
      };

      m[piece.lotNo].pieces.push(pieceEntry);

      if (wastageWeight > 0) {
        m[piece.lotNo].wastageTotal = (m[piece.lotNo].wastageTotal || 0) + wastageWeight;
        m[piece.lotNo].wastageCount = (m[piece.lotNo].wastageCount || 0) + 1;
      }
      if (piece.status === 'available') {
        m[piece.lotNo].availableCount = (m[piece.lotNo].availableCount || 0) + 1;
      }
      m[piece.lotNo].pendingWeight = (m[piece.lotNo].pendingWeight || 0) + pendingForPiece;
      m[piece.lotNo].totalReceivedWeight = (m[piece.lotNo].totalReceivedWeight || 0) + receivedWeight;
      m[piece.lotNo].totalReceivedUnits = (m[piece.lotNo].totalReceivedUnits || 0) + pieceTotalUnits;
    }

    Object.values(m).forEach(lot => {
      lot.avgWastage = (lot.wastageCount && lot.wastageCount > 0) ? (lot.wastageTotal / lot.wastageCount) : 0;
      lot.statusType = lotStatus(lot);
    });
    return m;
  }, [db, receiveTotalsMap]);

  const allLots = useMemo(() => Object.values(lotsMap), [lotsMap]);

  // Filtered Lots
  const filteredLots = useMemo(() => {
    let list = allLots.map(l => {
      let score = 0;
      if (search) {
        // Pre-format fields for search
        const formattedDate = formatDateDDMMYYYY(l.date);
        const searchableFields = [
          'lotNo', 'itemName', 'firmName', 'supplierName', 'statusType',
          'totalWeight', 'pendingWeight', 'availableCount', 'totalPieces'
        ];
        const tempItem = {
          ...l,
          dateStr: formattedDate,
          totalWeight: String(l.totalWeight || 0),
          pendingWeight: String(l.pendingWeight || 0),
          availableCount: String(l.availableCount || 0),
          totalPieces: String(l.totalPieces || 0)
        };
        score = calculateMultiTermScore(tempItem, search, [...searchableFields, 'dateStr']);
      } else {
        score = 1; // Default score when no search
      }
      return { ...l, searchScore: score };
    });

    if (search) {
      list = list.filter(l => l.searchScore > 0);
    }

    return list.filter(l => {
      // Filters
      if (filters.item && l.itemId !== filters.item) return false;
      if (filters.firm && l.firmId !== filters.firm) return false;
      if (filters.supplier && l.supplierId !== filters.supplier) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;

      // Status
      if (filters.status !== 'all') {
        if (filters.status === 'available_to_issue') {
          if ((l.availableCount || 0) <= 0) return false;
        } else {
          const status = l.statusType || lotStatus(l);
          if (status !== filters.status) return false;
        }
      }
      return true;
    }).sort((a, b) => {
      if (search && a.searchScore !== b.searchScore) {
        return b.searchScore - a.searchScore;
      }
      return (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true });
    });
  }, [allLots, search, filters]);

  const displayedLots = useMemo(() => {
    if (!groupByItem) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = `${lot.itemId || ''}`;
      const existing = map.get(key) || {
        lotNo: `Group-${key}`,
        itemId: lot.itemId,
        itemName: lot.itemName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierName: lot.supplierName,
        totalWeight: 0,
        pendingWeight: 0,
        availableCount: 0,
        totalPieces: 0,
        pieces: [],
        lots: [], // Collect lot numbers
        statusType: 'inactive',
      };
      existing.totalWeight += Number(lot.totalWeight || 0);
      existing.pendingWeight += Number(lot.pendingWeight || 0);
      const available = lot.availableCount ?? (lot.pieces || []).filter(p => p.status === 'available').length;
      existing.availableCount += available;
      existing.totalPieces += lot.totalPieces ?? (lot.pieces || []).length;
      existing.statusType = existing.pendingWeight > EPSILON ? 'active' : 'inactive';
      existing.lots.push(lot.lotNo); // Add lot number to group
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [filteredLots, groupByItem]);

  // --- Handlers ---

  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueModalData, setIssueModalData] = useState({
    lotNo: '',
    pieceIds: [],
    date: todayISO(),
    machineId: '',
    operatorId: '',
    cutId: '',
    note: '',
  });
  const [issuing, setIssuing] = useState(false);
  const [deletingPieces, setDeletingPieces] = useState(() => new Set());

  // Keep view aligned with process (match main-branch behaviour)
  useEffect(() => {
    if (isHolo) {
      setView('holo');
      return;
    }
    // For coning/other processes, force jumbo like main-branch behaviour
    if (!isCutter) {
      if (view !== 'jumbo') setView('jumbo');
      return;
    }
    if (view === 'holo') {
      setView('jumbo');
    }
  }, [isCutter, isHolo, view]);

  useEffect(() => { setExpandedLot(null); }, [groupByItem, view, processId]);
  useEffect(() => {
    setFilters(f => ({
      ...f,
      status: isCutter ? 'available_to_issue' : 'active'
    }));
  }, [isCutter]);

  async function handleDeletePiece(pieceId) {
    if (!pieceId) return;
    const ok = window.confirm(`Delete piece ${pieceId}? This action cannot be undone.`);
    if (!ok) return;
    setDeletingPieces(prev => new Set(prev).add(pieceId));
    try {
      await api.deleteInboundItem(pieceId);
      await refreshDb();
    } catch (err) {
      alert(err.message || 'Failed to delete piece');
    } finally {
      setDeletingPieces(prev => { const s = new Set(prev); s.delete(pieceId); return s; });
    }
  }

  function togglePiece(lotNo, pieceId) {
    setSelectedByLot(prev => {
      const next = { ...prev };
      const arr = new Set(next[lotNo] || []);
      if (arr.has(pieceId)) arr.delete(pieceId); else arr.add(pieceId);
      next[lotNo] = Array.from(arr);
      return next;
    });
  }

  function toggleAllPieces(lotNo) {
    const availablePieces = (lotsMap[lotNo]?.pieces || []).filter(p => p.status === 'available').map(p => p.id);
    const currentSelected = selectedByLot[lotNo] || [];
    const allSelected = availablePieces.length > 0 && availablePieces.every(id => currentSelected.includes(id));
    if (allSelected) {
      // Deselect all
      setSelectedByLot(prev => ({ ...prev, [lotNo]: [] }));
    } else {
      // Select all available
      setSelectedByLot(prev => ({ ...prev, [lotNo]: availablePieces }));
    }
  }

  async function handleDeleteLot(lotNo, e) {
    e.stopPropagation();
    if (!confirm('Delete lot ' + lotNo + '? This will remove all pieces and history for this lot.')) return;
    try {
      await api.deleteLot(lotNo);
      await refreshDb();
    } catch (err) {
      alert(err.message || 'Failed to delete lot');
    }
  }

  function openIssueModal(lotNo) {
    const pieceIds = (selectedByLot[lotNo] || []).slice();
    if (!pieceIds.length) { alert('Select pieces to issue'); return; }
    setIssueModalData({ lotNo, pieceIds, date: todayISO(), machineId: '', operatorId: '', cutId: '', note: '' });
    setIssueModalOpen(true);
  }

  async function doIssue() {
    setIssuing(true);
    try {
      const { lotNo, pieceIds, date, machineId, operatorId, cutId, note } = issueModalData;
      if (!cutId) {
        alert('Select a cut before issuing.');
        return;
      }
      const payload = {
        date,
        itemId: lotsMap[lotNo].itemId,
        lotNo,
        pieceIds,
        note,
        machineId,
        operatorId,
        cutId,
      };
      const result = await createIssueToMachine(payload);
      const issueRecord = result?.issueToMachine || result?.issueToCutterMachine || result?.issue_to_cutter_machine;
      const template = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_ISSUE);
      if (template && issueRecord) {
        const confirmPrint = window.confirm('Print sticker for this issue?');
        if (confirmPrint) {
          const itemName = lotsMap[lotNo]?.itemName;
          const machineName = db?.machines?.find((m) => m.id === machineId)?.name;
          const operatorName = db?.operators?.find((o) => o.id === operatorId)?.name;
          const inboundDate = lotsMap[lotNo]?.date || '';
          const cut = db?.cuts?.find((c) => c.id === cutId)?.name || '';
          const selectedPieces = (db?.inbound_items || []).filter((p) => pieceIds.includes(p.id));
          const primaryPiece =
            selectedPieces.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0] || selectedPieces[0] || null;
          const pieceId = primaryPiece?.id || pieceIds[0] || '';
          const seq = primaryPiece?.seq ?? '';
          await printStageTemplate(
            LABEL_STAGE_KEYS.CUTTER_ISSUE,
            {
              lotNo: issueRecord.lotNo,
              itemName,
              pieceId,
              seq,
              barcode: issueRecord.barcode,
              count: issueRecord.count || pieceIds.length,
              totalWeight: issueRecord.totalWeight,
              pieceIds,
              machineName,
              operatorName,
              inboundDate,
              cut,
              date,
            },
            { template },
          );
        }
      }
      setSelectedByLot(prev => ({ ...prev, [lotNo]: [] }));
      setIssueModalOpen(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setIssuing(false);
    }
  }

  function handleApplyLotFilter(lots) {
    setSearch(lots.join(" "));
    setGroupByItem(false); // Optionally disable grouping to see the individual lots
  }

  // --- Render Helper ---
  const toggleExpand = (lotNo) => setExpandedLot(prev => prev === lotNo ? null : lotNo);
  const showBobbins = isCutter && view === 'bobbins';

  return (
    <div className="space-y-6 fade-in">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-tight">Stock & Inventory</h1>
          <div className="flex gap-2">
            {/* View Toggles */}
            {isCutter ? (
              <div className="flex p-1 bg-muted rounded-lg">
                <button
                  onClick={() => setView('jumbo')}
                  className={cn("px-3 py-1 text-sm font-medium rounded-md transition-all", view === 'jumbo' ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Jumbo Rolls
                </button>
                <button
                  onClick={() => setView('bobbins')}
                  className={cn("px-3 py-1 text-sm font-medium rounded-md transition-all", view === 'bobbins' ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Bobbins
                </button>
              </div>
            ) : null}
            {/* Export Button */}
            <Button variant="outline" size="icon" onClick={() => exportXlsx(filteredLots, {})}>
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <Card className="bg-muted/40 border-none shadow-none">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs mb-1 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Lot No, Item Name..."
                  className="pl-8 bg-background"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="w-[140px]">
              <Label className="text-xs mb-1 block">Item</Label>
              <Select className="bg-background" value={filters.item} onChange={e => setFilters(f => ({ ...f, item: e.target.value }))}>
                <option value="">All Items</option>
                {db?.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </div>
            <div className="w-[140px]">
              <Label className="text-xs mb-1 block">Firm</Label>
              <Select className="bg-background" value={filters.firm} onChange={e => setFilters(f => ({ ...f, firm: e.target.value }))}>
                <option value="">All Firms</option>
                {db?.firms?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </div>
            <div className="w-[160px]">
              <Label className="text-xs mb-1 block">Supplier</Label>
              <Select className="bg-background" value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))}>
                <option value="">All Suppliers</option>
                {db?.suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div className="w-[140px]">
              <Label className="text-xs mb-1 block">Status</Label>
              <Select className="bg-background" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
                {isCutter && <option value="available_to_issue">Available to issue</option>}
                <option value="all">All</option>
              </Select>
            </div>
            <div className="w-[130px]">
              <Label className="text-xs mb-1 block">From</Label>
              <Input type="date" className="bg-background" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
            </div>
            <div className="w-[130px]">
              <Label className="text-xs mb-1 block">To</Label>
              <Input type="date" className="bg-background" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 ml-auto pb-1">
              <Label className="text-xs cursor-pointer flex items-center gap-2">
                <input type="checkbox" checked={groupByItem} onChange={e => setGroupByItem(e.target.checked)} className="rounded border-gray-300" />
                Group by Item
              </Label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content based on View */}
      {processId === 'coning' ? (
        <ConingView db={db} filters={filters} search={search} groupBy={groupByItem} onApplyFilter={handleApplyLotFilter} />
      ) : isHolo ? (
        <HoloView db={db} filters={filters} search={search} groupBy={groupByItem} onApplyFilter={handleApplyLotFilter} />
      ) : showBobbins ? (
        <BobbinView db={db} filters={filters} search={search} groupBy={groupByItem} onApplyFilter={handleApplyLotFilter} />
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead>Lot No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                {!groupByItem ? <TableHead>Firm</TableHead> : null}
                <TableHead>Supplier</TableHead>
                <TableHead className="">Pieces</TableHead>
                <TableHead className="">Total Wt</TableHead>
                {filters.status !== 'available_to_issue' && <TableHead className="">Pending Wt</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedLots.length === 0 ? (
                <TableRow><TableCell colSpan={(groupByItem ? 8 : 9) - (filters.status === 'available_to_issue' ? 1 : 0)} className="h-24 text-center text-muted-foreground">No lots found.</TableCell></TableRow>
              ) : (
                displayedLots.map((l, idx) => {
                  const isExpanded = !groupByItem && expandedLot === l.lotNo;
                  return (
                    <React.Fragment key={l.lotNo || idx}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => !groupByItem && toggleExpand(l.lotNo)}
                      >
                        <TableCell>
                          {!groupByItem && (
                            isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {groupByItem ? (
                            <LotPopover lots={l.lots || []} onApplyFilter={handleApplyLotFilter} />
                          ) : (
                            <HighlightMatch text={l.lotNo || '—'} query={search} />
                          )}
                        </TableCell>
                        <TableCell>{formatDateDDMMYYYY(l.date)}</TableCell>
                        <TableCell>
                          <HighlightMatch text={l.itemName} query={search} />
                        </TableCell>
                        {!groupByItem ? (
                          <TableCell>
                            <HighlightMatch text={l.firmName} query={search} />
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <HighlightMatch text={l.supplierName} query={search} />
                        </TableCell>
                        <TableCell className="">
                          {`${l.availableCount ?? (l.pieces || []).filter(p => p.status === 'available').length} / ${l.totalPieces ?? (l.pieces || []).length}`}
                        </TableCell>
                        <TableCell className="">{formatKg(l.totalWeight)}</TableCell>
                        {filters.status !== 'available_to_issue' && (
                          <TableCell className="font-bold">
                            {formatKg(l.pendingWeight)}
                          </TableCell>
                        )}
                      </TableRow>
                      {isExpanded && !groupByItem && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={filters.status === 'available_to_issue' ? 8 : 9} className="p-4">
                            <div className="bg-background border rounded-lg p-4 shadow-sm">
                              <div className="flex justify-between items-center mb-4">
                                <div className="flex gap-2">
                                  {(selectedByLot[l.lotNo] || []).length === 1 && (
                                    <Button
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); openIssueModal(l.lotNo); }}
                                    >
                                      Issue Selected
                                    </Button>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={(e) => handleDeleteLot(l.lotNo, e)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> Delete Lot
                                </Button>
                              </div>

                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
                                    <TableHead className="w-[30px]">
                                      {(() => {
                                        const availablePieces = (l.pieces || []).filter(p => p.status === 'available');
                                        const currentSelected = selectedByLot[l.lotNo] || [];
                                        const allSelected = availablePieces.length > 0 && availablePieces.every(p => currentSelected.includes(p.id));
                                        const someSelected = currentSelected.length > 0 && !allSelected;
                                        return (
                                          <input
                                            type="checkbox"
                                            checked={allSelected}
                                            ref={el => { if (el) el.indeterminate = someSelected; }}
                                            onChange={(e) => { e.stopPropagation(); toggleAllPieces(l.lotNo); }}
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            disabled={availablePieces.length === 0}
                                          />
                                        );
                                      })()}
                                    </TableHead>
                                    <TableHead>Piece ID</TableHead>
                                    <TableHead>Barcode</TableHead>
                                    <TableHead>Seq</TableHead>
                                    <TableHead className="">Weight</TableHead>
                                    {filters.status !== 'available_to_issue' && <TableHead className="">Pending</TableHead>}
                                    <TableHead className="">Total Units</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(l.pieces || []).sort((a, b) => a.seq - b.seq).map(p => (
                                    <PieceRow
                                      key={p.id}
                                      p={p}
                                      selected={(selectedByLot[l.lotNo] || []).includes(p.id)}
                                      onToggle={() => togglePiece(l.lotNo, p.id)}
                                      onSaved={refreshDb}
                                      pendingWeight={p.pendingWeight}
                                      wastageWeight={p.wastageWeight}
                                      totalUnits={p.totalUnits}
                                      onDelete={handleDeletePiece}
                                      isDeleting={deletingPieces.has(p.id)}
                                      hidePending={filters.status === 'available_to_issue'}
                                    />
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Issue Modal */}
      <Dialog open={issueModalOpen} onOpenChange={setIssueModalOpen}>
        <DialogContent title="Issue Pieces to Machine" onOpenChange={setIssueModalOpen}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Date</Label>
                <Input type="date" value={issueModalData.date} onChange={e => setIssueModalData({ ...issueModalData, date: e.target.value })} />
              </div>
              <div>
                <Label>Machine</Label>
                <Select value={issueModalData.machineId} onChange={e => setIssueModalData({ ...issueModalData, machineId: e.target.value })}>
                  <option value="">Select Machine</option>
                  {(db?.machines || []).filter(m => m.processType === 'all' || m.processType === 'cutter').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Cut</Label>
                <Select value={issueModalData.cutId} onChange={e => setIssueModalData({ ...issueModalData, cutId: e.target.value })}>
                  <option value="">Select Cut</option>
                  {db?.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label>Operator</Label>
              <Select value={issueModalData.operatorId} onChange={e => setIssueModalData({ ...issueModalData, operatorId: e.target.value })}>
                <option value="">Select Operator</option>
                {(db?.operators || []).filter(o => o.processType === 'all' || o.processType === 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Note (Optional)</Label>
              <Input value={issueModalData.note} onChange={e => setIssueModalData({ ...issueModalData, note: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setIssueModalOpen(false)}>Cancel</Button>
              <Button onClick={doIssue} disabled={issuing || !issueModalData.machineId || !issueModalData.operatorId || !issueModalData.cutId}>
                {issuing ? 'Issuing...' : 'Confirm Issue'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
