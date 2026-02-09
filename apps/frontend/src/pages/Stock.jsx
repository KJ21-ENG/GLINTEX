import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, Badge, Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui';
import { PieceRow } from '../components/stock/PieceRow';
import { DisabledWithTooltip } from '../components/common/DisabledWithTooltip';
import { BobbinView } from '../components/stock/BobbinView';
import { HoloView } from '../components/stock/HoloView';
import { ConingView } from '../components/stock/ConingView';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { formatKg, todayISO, aggregateLots, formatDateDDMMYYYY } from '../utils';
import * as api from '../api';
import { exportStockXlsx, exportStockPdf } from '../services';
import { getProcessDefinition } from '../constants/processes';
import { Search, Download, Filter, ChevronDown, ChevronRight, Trash2, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import { fuzzyScore, calculateMultiTermScore } from '../utils';
import { HighlightMatch } from '../components/common/HighlightMatch';
import { LotPopover } from '../components/stock/LotPopover';
import { cn } from '../lib/utils';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../utils/labelPrint';
import { usePermission, useStagePermission } from '../hooks/usePermission';

const EPSILON = 1e-9;
const idEq = (a, b) => String(a ?? '') === String(b ?? '');

const isPieceAvailableForIssue = (piece) => (
  piece?.status === 'available'
  && Number(piece.pendingWeight || 0) > EPSILON
  && Number(piece.dispatchedWeight || 0) <= EPSILON
);

const countAvailablePieces = (pieces = []) => pieces.filter(isPieceAvailableForIssue).length;

function lotStatus(lot) {
  const pending = Number(lot.pendingWeight || 0);
  const initial = Number(lot.totalWeight || 0);
  if (pending > EPSILON && pending <= initial + EPSILON) return 'active';
  if (Math.abs(pending) <= EPSILON) return 'inactive';
  return pending > 0 ? 'active' : 'inactive';
}

function buildStockGroupKey(lot) {
  return [
    lot.itemId || lot.itemName || '',
    lot.supplierId || lot.supplierName || '',
    lot.cutName || '',
    lot.yarnName || '',
    lot.twistName || ''
  ].join('::');
}

export function Stock() {
  const { db, brand, createIssueToMachine, refreshing, refreshDb, process, ensureModuleData } = useInventory();

  // --- Process Config ---
  const processId = process || 'cutter';
  const processDef = getProcessDefinition(processId);
  const { receiveTotalsKey, receiveUnitField, receiveWeightField, unitLabelPlural } = processDef;
  const isCutter = processId === 'cutter';
  const isHolo = processId === 'holo';
  const isConing = processId === 'coning';
  const { canEdit: canInboundEdit, canDelete: canInboundDelete } = usePermission('inbound');
  const issueStage = isHolo ? 'holo' : isConing ? 'coning' : 'cutter';
  const { canWrite: canIssueWrite } = useStagePermission('issue', issueStage);

  useEffect(() => {
    ensureModuleData('process', { process: processId, full: true });
  }, [ensureModuleData, processId]);

  // --- UI State ---
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize view from URL or default based on process
  const getInitialView = () => {
    const urlView = searchParams.get('view');
    if (isHolo) return 'holo';
    if (isCutter && urlView === 'bobbins') return 'bobbins';
    if (isCutter && urlView === 'jumbo') return 'jumbo';
    return 'jumbo'; // default for cutter
  };

  const [view, setViewState] = useState(getInitialView);

  // Sync view state when URL searchParams changes (e.g., browser back/forward navigation)
  useEffect(() => {
    const urlView = searchParams.get('view');
    if (isCutter) {
      if (urlView === 'bobbins' && view !== 'bobbins') {
        setViewState('bobbins');
      } else if (urlView === 'jumbo' && view !== 'jumbo') {
        setViewState('jumbo');
      } else if (!urlView && view !== 'jumbo') {
        // No view param defaults to jumbo
        setViewState('jumbo');
      }
    }
  }, [searchParams, isCutter, view]);

  // Wrapper to update both state and URL
  const setView = (newView) => {
    setViewState(newView);
    // Only persist view param for cutter process with jumbo/bobbins views
    if (isCutter && (newView === 'jumbo' || newView === 'bobbins')) {
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.set('view', newView);
        return newParams;
      }, { replace: true });
    }
  };

  const [expandedLot, setExpandedLot] = useState(null);
  const [selectedByLot, setSelectedByLot] = useState({});
  const [groupByItem, setGroupByItem] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  // --- Filters ---
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    item: "",
    cut: "",
    yarn: "",
    firm: "",
    supplier: "",
    status: (process || 'cutter') === 'cutter' ? "available_to_issue" : "active",
    steamed: "all", // For Holo process only
    from: "",
    to: ""
  });

  // --- Export Data State ---
  const [exportData, setExportData] = useState(null);

  // Clear export data when view changes to avoid stale data
  useEffect(() => { setExportData(null); }, [view, processId]);

  // Close export menu when clicking outside / pressing escape
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onMouseDown = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportMenuOpen]);

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

  const cutterIssueByPieceId = useMemo(() => {
    if (!isCutter) return new Map();
    const issues = Array.isArray(db?.issue_to_cutter_machine) ? db.issue_to_cutter_machine : [];
    const machineMap = new Map((db?.machines || []).map(m => [m.id, m.name]));
    const sortedIssues = [...issues].sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(b?.date || '').localeCompare(String(a?.date || ''));
    });
    const map = new Map();
    sortedIssues.forEach((issue) => {
      const pieceIds = Array.isArray(issue.pieceIds)
        ? issue.pieceIds
        : String(issue.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
      const machineName = issue.machineName || machineMap.get(issue.machineId) || '';
      const issueDate = issue.date || '';
      pieceIds.forEach((id) => {
        if (!map.has(id)) {
          map.set(id, { machineName, issueDate });
        }
      });
    });
    return map;
  }, [db, isCutter]);

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
        remainingWeight: 0,
        pendingWeight: 0,
        totalReceivedWeight: 0,
        totalReceivedUnits: 0,
        wastageTotal: 0,
        wastageCount: 0,
        wastageWeightBaseTotal: 0,
        avgWastage: 0,
        wastagePercent: 0,
        cutNames: new Set(),
        yarnNames: new Set(),
      };
    }
    const inbound = db.inbound_items || [];
    for (const piece of inbound) {
      if (!m[piece.lotNo]) continue;
      const inboundWeight = Number(piece.weight || 0);
      const dispatchedWeight = Number(piece.dispatchedWeight || 0);
      const totals = receiveTotalsMap.get(piece.id) || { received: 0, wastage: 0, totalUnits: 0 };
      const receivedWeight = totals.received || 0;
      const wastageWeight = totals.wastage || 0;
      const pieceTotalUnits = totals.totalUnits || 0;
      const pendingRaw = inboundWeight - receivedWeight - wastageWeight - dispatchedWeight;
      const pendingForPiece = pendingRaw > EPSILON ? pendingRaw : 0;

      // Remaining weight for Jumbo Rolls view should reflect pieces that are still present (not issued/consumed).
      // We treat any piece with status === 'consumed' as not remaining.
      if (piece.status !== 'consumed') {
        m[piece.lotNo].remainingWeight = (m[piece.lotNo].remainingWeight || 0) + inboundWeight;
      }

      // Cut & Yarn Resolution
      const cutName = piece.cutName || piece.cut?.name || (typeof piece.cut === 'string' ? piece.cut : '') || db.cuts?.find(c => c.id === piece.cutId)?.name || '';
      if (cutName) m[piece.lotNo].cutNames.add(cutName);

      const yarnName = piece.yarnName || piece.yarn?.name || (typeof piece.yarn === 'string' ? piece.yarn : '') || db.yarns?.find(y => y.id === piece.yarnId)?.name || '';
      if (yarnName) m[piece.lotNo].yarnNames.add(yarnName);

      const issueMeta = cutterIssueByPieceId.get(piece.id);
      const issuedLabel = issueMeta
        ? `Issued${issueMeta.machineName ? `: ${issueMeta.machineName}` : ''}${issueMeta.issueDate ? ` • ${issueMeta.issueDate}` : ''}`
        : '';
      const pieceEntry = {
        ...piece,
        pendingWeight: pendingForPiece,
        receivedWeight,
        wastageWeight,
        totalUnits: pieceTotalUnits,
        cutName,
        yarnName,
        issuedLabel
      };

      m[piece.lotNo].pieces.push(pieceEntry);

      if (wastageWeight > 0) {
        m[piece.lotNo].wastageTotal = (m[piece.lotNo].wastageTotal || 0) + wastageWeight;
        m[piece.lotNo].wastageCount = (m[piece.lotNo].wastageCount || 0) + 1;
        m[piece.lotNo].wastageWeightBaseTotal = (m[piece.lotNo].wastageWeightBaseTotal || 0) + Number(piece.weight || 0);
      }
      const availableForIssue = isPieceAvailableForIssue(pieceEntry);
      if (availableForIssue) {
        m[piece.lotNo].availableCount = (m[piece.lotNo].availableCount || 0) + 1;
      }
      m[piece.lotNo].pendingWeight = (m[piece.lotNo].pendingWeight || 0) + pendingForPiece;
      m[piece.lotNo].totalReceivedWeight = (m[piece.lotNo].totalReceivedWeight || 0) + receivedWeight;
      m[piece.lotNo].totalReceivedUnits = (m[piece.lotNo].totalReceivedUnits || 0) + pieceTotalUnits;
    }

    Object.values(m).forEach(lot => {
      lot.avgWastage = (lot.wastageCount && lot.wastageCount > 0) ? (lot.wastageTotal / lot.wastageCount) : 0;
      lot.wastagePercent = lot.wastageWeightBaseTotal > 0 ? ((lot.wastageTotal / lot.wastageWeightBaseTotal) * 100) : 0;
      lot.statusType = lotStatus(lot);
      lot.cutName = Array.from(lot.cutNames).join(', ') || '—';
      lot.yarnName = Array.from(lot.yarnNames).join(', ') || '—';
    });
    return m;
  }, [db, receiveTotalsMap, cutterIssueByPieceId]);

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
      if (filters.item && !idEq(l.itemId, filters.item)) return false;
      if (filters.cut) {
        const cutName = db?.cuts?.find(c => idEq(c.id, filters.cut))?.name;
        if (cutName && !l.cutNames?.has(cutName)) return false;
      }
      if (filters.firm && !idEq(l.firmId, filters.firm)) return false;
      if (filters.supplier && !idEq(l.supplierId, filters.supplier)) return false;
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
  }, [allLots, search, filters, db.cuts]);

  const displayedLots = useMemo(() => {
    if (!groupByItem) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = buildStockGroupKey(lot);
      const existing = map.get(key) || {
        lotNo: `Group-${key}`,
        groupKey: key,
        itemId: lot.itemId,
        itemName: lot.itemName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierName: lot.supplierName,
        totalWeight: 0,
        remainingWeight: 0,
        pendingWeight: 0,
        availableCount: 0,
        totalPieces: 0,
        wastageTotal: 0,
        wastageCount: 0,
        wastageWeightBaseTotal: 0,
        avgWastage: 0,
        wastagePercent: 0,
        pieces: [],
        lots: [], // Collect lot numbers
        statusType: 'inactive',
      };
      existing.totalWeight += Number(lot.totalWeight || 0);
      existing.remainingWeight += Number(lot.remainingWeight || 0);
      existing.pendingWeight += Number(lot.pendingWeight || 0);
      const available = lot.availableCount ?? countAvailablePieces(lot.pieces || []);
      existing.availableCount += available;
      existing.totalPieces += lot.totalPieces ?? (lot.pieces || []).length;
      existing.wastageTotal += Number(lot.wastageTotal || 0);
      existing.wastageCount += Number(lot.wastageCount || 0);
      existing.wastageWeightBaseTotal += Number(lot.wastageWeightBaseTotal || 0);
      existing.statusType = existing.pendingWeight > EPSILON ? 'active' : 'inactive';
      existing.lots.push(lot.lotNo); // Add lot number to group
      map.set(key, existing);
    });
    const grouped = Array.from(map.values());
    grouped.forEach((lot) => {
      lot.avgWastage = lot.wastageCount > 0 ? (lot.wastageTotal / lot.wastageCount) : 0;
      lot.wastagePercent = lot.wastageWeightBaseTotal > 0 ? ((lot.wastageTotal / lot.wastageWeightBaseTotal) * 100) : 0;
    });
    return grouped;
  }, [filteredLots, groupByItem]);

  // Grand Totals for Jumbo Rolls view
  const grandTotals = useMemo(() => {
    return displayedLots.reduce((acc, lot) => ({
      availableCount: acc.availableCount + (lot.availableCount ?? countAvailablePieces(lot.pieces || [])),
      totalPieces: acc.totalPieces + (lot.totalPieces ?? (lot.pieces || []).length),
      totalWeight: acc.totalWeight + Number(lot.totalWeight || 0),
      remainingWeight: acc.remainingWeight + Number(lot.remainingWeight || 0),
      pendingWeight: acc.pendingWeight + Number(lot.pendingWeight || 0),
      wastageTotal: acc.wastageTotal + Number(lot.wastageTotal || 0),
      wastageCount: acc.wastageCount + Number(lot.wastageCount || 0),
      wastageWeightBaseTotal: acc.wastageWeightBaseTotal + Number(lot.wastageWeightBaseTotal || 0),
    }), { availableCount: 0, totalPieces: 0, totalWeight: 0, remainingWeight: 0, pendingWeight: 0, wastageTotal: 0, wastageCount: 0, wastageWeightBaseTotal: 0 });
  }, [displayedLots]);

  // --- Export Handler ---
  const handleExport = (format = 'xlsx') => {
    // Determine the correct view type for export
    let viewType = 'jumbo';
    if (isConing) viewType = 'coning';
    else if (isHolo) viewType = 'holo';
    else if (isCutter && view === 'bobbins') viewType = 'bobbins';
    else if (isCutter && view === 'jumbo') viewType = 'jumbo';

    // For Jumbo view, we use displayedLots directly since it's managed here
    // For other views, we use exportData from child components
    const dataToExport = (viewType === 'jumbo') ? displayedLots : exportData;

    // Calculate grandTotals based on view type
    let totals = {};
    if (viewType === 'jumbo') {
      totals = grandTotals;
    } else if (dataToExport && dataToExport.length > 0) {
      // Compute totals from exportData for other views
      if (viewType === 'holo') {
        totals = dataToExport.reduce((acc, lot) => ({
          totalRolls: (acc.totalRolls || 0) + (lot.totalRolls || 0),
          totalWeight: (acc.totalWeight || 0) + (lot.totalWeight || 0),
          steamedRolls: (acc.steamedRolls || 0) + (lot.steamedRolls || 0),
        }), {});
      } else if (viewType === 'coning') {
        totals = dataToExport.reduce((acc, lot) => ({
          totalCones: (acc.totalCones || 0) + (lot.totalCones || 0),
          totalWeight: (acc.totalWeight || 0) + (lot.totalWeight || 0),
        }), {});
      } else if (viewType === 'bobbins') {
        totals = dataToExport.reduce((acc, lot) => ({
          totalBobbins: (acc.totalBobbins || 0) + (lot.totalBobbins || 0),
          availableBobbins: (acc.availableBobbins || 0) + (lot.availableBobbins || 0),
          totalWeight: (acc.totalWeight || 0) + (lot.totalWeight || 0),
          availableWeight: (acc.availableWeight || 0) + (lot.availableWeight || 0),
          crateCount: (acc.crateCount || 0) + (lot.crates?.length || lot.crateCount || 0),
        }), {});
      }
    }

    const settings = db?.settings?.[0] || {};
    const companyName = settings.challanFromName || 'GLINTEX';
    const findNameById = (arr, id) => arr?.find((row) => String(row.id) === String(id))?.name || '';

    const statusLabel = {
      active: 'Active Only',
      inactive: 'Inactive Only',
      available_to_issue: 'Available to issue',
      all: 'All',
    }[filters.status] || filters.status;

    const steamedLabel = {
      all: 'All',
      steamed: 'Steamed Only',
      unsteamed: 'Unsteamed Only',
    }[filters.steamed] || filters.steamed;

    const viewLabel = {
      jumbo: 'Jumbo Rolls',
      bobbins: 'Bobbins',
      holo: 'Holo',
      coning: 'Coning',
    }[viewType] || viewType;

    const metaPairs = [
      { label: 'Process', value: processDef?.label || processId },
      { label: 'View', value: viewLabel },
      { label: 'Grouped', value: groupByItem ? 'Yes' : 'No' },
      { label: 'Status', value: statusLabel },
      ...(filters.item ? [{ label: 'Item', value: findNameById(db?.items, filters.item) }] : []),
      ...(filters.cut ? [{ label: 'Cut', value: findNameById(db?.cuts, filters.cut) }] : []),
      ...(filters.yarn ? [{ label: 'Yarn', value: findNameById(db?.yarns, filters.yarn) }] : []),
      ...(filters.firm ? [{ label: 'Firm', value: findNameById(db?.firms, filters.firm) }] : []),
      ...(filters.supplier ? [{ label: 'Supplier', value: findNameById(db?.suppliers, filters.supplier) }] : []),
      ...(isHolo && filters.steamed !== 'all' ? [{ label: 'Steamed', value: steamedLabel }] : []),
      ...((filters.from || filters.to) ? [{ label: 'Date', value: `${filters.from || '—'} to ${filters.to || '—'}` }] : []),
      ...(search ? [{ label: 'Search', value: search }] : []),
      { label: 'Records', value: String(dataToExport?.length || 0) },
    ];

    if (format === 'pdf') {
      exportStockPdf(dataToExport, {
        viewType,
        groupBy: groupByItem,
        grandTotals: totals,
        statusFilter: filters.status,
        brand,
        companyName,
        metaPairs,
      });
      return;
    }

    exportStockXlsx(dataToExport, {
      viewType,
      groupBy: groupByItem,
      grandTotals: totals,
      statusFilter: filters.status,
    });
  };

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
      setViewState('holo');
      // Clear view param from URL for non-cutter processes
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('view');
        return newParams;
      }, { replace: true });
      return;
    }
    // For coning/other processes, force jumbo like main-branch behaviour
    if (!isCutter) {
      if (view !== 'jumbo') setViewState('jumbo');
      // Clear view param from URL for non-cutter processes
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('view');
        return newParams;
      }, { replace: true });
      return;
    }
    if (view === 'holo') {
      setViewState('jumbo');
    }
  }, [isCutter, isHolo, view, setSearchParams]);

  useEffect(() => { setExpandedLot(null); }, [groupByItem, view, processId]);
  useEffect(() => {
    setFilters(f => ({
      ...f,
      status: isCutter ? 'available_to_issue' : 'active'
    }));
  }, [isCutter]);

  async function handleDeletePiece(pieceId) {
    if (!canInboundDelete) return;
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
    const availablePieces = (lotsMap[lotNo]?.pieces || [])
      .filter(isPieceAvailableForIssue)
      .map(p => p.id);
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
    if (!canInboundDelete) return;
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
    if (!canIssueWrite) return;
    const pieceIds = (selectedByLot[lotNo] || []).slice();
    if (!pieceIds.length) { alert('Select pieces to issue'); return; }
    setIssueModalData({ lotNo, pieceIds, date: todayISO(), machineId: '', operatorId: '', cutId: '', note: '' });
    setIssueModalOpen(true);
  }

  async function doIssue() {
    if (!canIssueWrite) return;
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
    setSearch(lots.join("|"));
    setGroupByItem(false); // Optionally disable grouping to see the individual lots
  }

  // --- Render Helper ---
  const toggleExpand = (lotNo) => setExpandedLot(prev => prev === lotNo ? null : lotNo);
  const showBobbins = isCutter && view === 'bobbins';
  const formatWastageSummary = (lot) => {
    const count = Number(lot?.wastageCount || 0);
    if (!count) return '—';
    const avg = Number(lot?.avgWastage || 0);
    const pct = Number(lot?.wastagePercent || 0);
    return `${formatKg(avg)} kg (${pct.toFixed(1)}%)`;
  };
  const grandWastageSummary = formatWastageSummary({
    wastageCount: grandTotals.wastageCount,
    avgWastage: grandTotals.wastageCount > 0 ? (grandTotals.wastageTotal / grandTotals.wastageCount) : 0,
    wastagePercent: grandTotals.wastageWeightBaseTotal > 0 ? ((grandTotals.wastageTotal / grandTotals.wastageWeightBaseTotal) * 100) : 0,
  });

  return (
    <div className="space-y-6 fade-in">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Stock & Inventory</h1>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            {/* View Toggles */}
            {isCutter ? (
              <div className="flex p-1 bg-muted rounded-lg flex-1 md:flex-none">
                <button
                  onClick={() => setView('jumbo')}
                  className={cn("flex-1 md:flex-none px-3 py-1 text-sm font-medium rounded-md transition-all", view === 'jumbo' ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Jumbo Rolls
                </button>
                <button
                  onClick={() => setView('bobbins')}
                  className={cn("flex-1 md:flex-none px-3 py-1 text-sm font-medium rounded-md transition-all", view === 'bobbins' ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Bobbins
                </button>
              </div>
            ) : null}
            {/* Export Button */}
            <div className="relative ml-auto md:ml-0" ref={exportMenuRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportMenuOpen((v) => !v)}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
                <ChevronDown className={cn("w-4 h-4 opacity-70 transition-transform", exportMenuOpen ? "rotate-180" : "rotate-0")} />
              </Button>

              {exportMenuOpen && (
                <div className="absolute right-0 z-50 mt-1 min-w-[180px] rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                    onClick={() => { setExportMenuOpen(false); handleExport('xlsx'); }}
                  >
                    Excel (.xlsx)
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                    onClick={() => { setExportMenuOpen(false); handleExport('pdf'); }}
                  >
                    PDF (.pdf)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <Card className="bg-muted/40 border-none shadow-none">
          <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 items-end">
            <div className="sm:col-span-2 lg:col-span-2 min-w-0">
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
            <div>
              <Label className="text-xs mb-1 block">Item</Label>
              <Select className="bg-background w-full" value={filters.item} onChange={e => setFilters(f => ({ ...f, item: e.target.value }))}>
                <option value="">All Items</option>
                {db?.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Cut</Label>
              <Select className="bg-background w-full" value={filters.cut} onChange={e => setFilters(f => ({ ...f, cut: e.target.value }))}>
                <option value="">All Cuts</option>
                {db?.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Yarn</Label>
              <Select className="bg-background w-full" value={filters.yarn} onChange={e => setFilters(f => ({ ...f, yarn: e.target.value }))}>
                <option value="">All Yarns</option>
                {db?.yarns?.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Firm</Label>
              <Select className="bg-background w-full" value={filters.firm} onChange={e => setFilters(f => ({ ...f, firm: e.target.value }))}>
                <option value="">All Firms</option>
                {db?.firms?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Supplier</Label>
              <Select className="bg-background w-full" value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))}>
                <option value="">All Suppliers</option>
                {db?.suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Status</Label>
              <Select className="bg-background w-full" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
                {isCutter && <option value="available_to_issue">Available to issue</option>}
                <option value="all">All</option>
              </Select>
            </div>
            {isHolo && (
              <div>
                <Label className="text-xs mb-1 block">Steamed</Label>
                <Select className="bg-background w-full" value={filters.steamed} onChange={e => setFilters(f => ({ ...f, steamed: e.target.value }))}>
                  <option value="all">All</option>
                  <option value="steamed">Steamed Only</option>
                  <option value="not_steamed">Not Steamed</option>
                  <option value="partial">Partially Steamed</option>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs mb-1 block">From</Label>
              <Input type="date" className="bg-background w-full" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">To</Label>
              <Input type="date" className="bg-background w-full" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 pb-2 sm:col-span-2 lg:col-span-1 lg:ml-auto">
              <Label className="text-xs cursor-pointer flex items-center gap-2">
                <input type="checkbox" checked={groupByItem} onChange={e => setGroupByItem(e.target.checked)} className="rounded border-gray-300" />
                Group
              </Label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content based on View */}
      {processId === 'coning' ? (
        <ConingView db={db} filters={filters} search={search} groupBy={groupByItem} onApplyFilter={handleApplyLotFilter} onDataChange={setExportData} />
      ) : isHolo ? (
        <HoloView db={db} filters={filters} search={search} groupBy={groupByItem} onApplyFilter={handleApplyLotFilter} onDataChange={setExportData} />
      ) : showBobbins ? (
        <BobbinView db={db} filters={filters} search={search} groupBy={groupByItem} onApplyFilter={handleApplyLotFilter} onDataChange={setExportData} />
      ) : (
        <>
          <div className="hidden sm:block rounded-md border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]"></TableHead>
                  <TableHead>Lot No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Cut</TableHead>
                  {!groupByItem ? <TableHead>Firm</TableHead> : null}
                  <TableHead>Supplier</TableHead>
                  <TableHead className="">Pieces</TableHead>
                  <TableHead className="">Weight</TableHead>
                  {filters.status !== 'available_to_issue' && <TableHead className="">Pending Wt</TableHead>}
                  <TableHead className="">Wastage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedLots.length === 0 ? (
                  <TableRow><TableCell colSpan={(groupByItem ? 10 : 11) - (filters.status === 'available_to_issue' ? 1 : 0)} className="h-24 text-center text-muted-foreground">No lots found.</TableCell></TableRow>
                ) : (
                  displayedLots.map((l, idx) => {
                    const isExpanded = !groupByItem && expandedLot === l.lotNo;
                    const rowKey = groupByItem ? (l.groupKey || l.lotNo || idx) : (l.lotNo || idx);
                    return (
                      <React.Fragment key={rowKey}>
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
                          <TableCell>
                            <HighlightMatch text={l.cutName} query={search} />
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
                            {`${l.availableCount ?? countAvailablePieces(l.pieces || [])} / ${l.totalPieces ?? (l.pieces || []).length}`}
                          </TableCell>
                          <TableCell className="">
                            {formatKg(l.remainingWeight)} / {formatKg(l.totalWeight)}
                          </TableCell>
                          {filters.status !== 'available_to_issue' && (
                            <TableCell className="font-bold">
                              {formatKg(l.pendingWeight)}
                            </TableCell>
                          )}
                          <TableCell className="">
                            {formatWastageSummary(l)}
                          </TableCell>
                        </TableRow>
                        {isExpanded && !groupByItem && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={filters.status === 'available_to_issue' ? 10 : 11} className="p-4">
                              <div className="bg-background border rounded-lg p-4 shadow-sm">
                                <div className="flex justify-between items-center mb-4">
                                  <div className="flex gap-2">
                                    {(selectedByLot[l.lotNo] || []).length === 1 && (
                                      <Button
                                        size="sm"
                                        onClick={(e) => { e.stopPropagation(); openIssueModal(l.lotNo); }}
                                        disabled={!canIssueWrite}
                                      >
                                        Issue Selected
                                      </Button>
                                    )}
                                  </div>
                                  <DisabledWithTooltip
                                    disabled={!canInboundDelete}
                                    tooltip="You do not have permission to delete inbound records."
                                  >
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={(e) => handleDeleteLot(l.lotNo, e)}
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" /> Delete Lot
                                    </Button>
                                  </DisabledWithTooltip>
                                </div>

                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/50">
                                      <TableHead className="w-[30px]">
                                        {(() => {
                                          const availablePieces = (l.pieces || []).filter(isPieceAvailableForIssue);
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
                                              disabled={!canIssueWrite || availablePieces.length === 0}
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
                                        issuedLabel={p.issuedLabel}
                                        onDelete={handleDeletePiece}
                                        isDeleting={deletingPieces.has(p.id)}
                                        hidePending={filters.status === 'available_to_issue'}
                                        canEdit={canInboundEdit}
                                        canDelete={canInboundDelete}
                                        selectDisabled={!canIssueWrite || !isPieceAvailableForIssue(p)}
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
                {/* Grand Total Row */}
                {displayedLots.length > 0 && (
                  <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/20">
                    <TableCell></TableCell>
                    <TableCell className="font-bold text-primary">Grand Total</TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    {!groupByItem ? <TableCell></TableCell> : null}
                    <TableCell></TableCell>
                    <TableCell className="font-bold text-primary">{grandTotals.availableCount} / {grandTotals.totalPieces}</TableCell>
                    <TableCell className="font-bold text-primary">{formatKg(grandTotals.remainingWeight)} / {formatKg(grandTotals.totalWeight)}</TableCell>
                    {filters.status !== 'available_to_issue' && (
                      <TableCell className="font-bold text-primary">{formatKg(grandTotals.pendingWeight)}</TableCell>
                    )}
                    <TableCell className="font-bold text-primary">{grandWastageSummary}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View for Stock (Jumbo Rolls) */}
          <div className="block sm:hidden space-y-3">
            {displayedLots.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No lots found.</div>
            ) : (
              displayedLots.map((l, idx) => {
                const isExpanded = !groupByItem && expandedLot === l.lotNo;
                const available = l.availableCount ?? countAvailablePieces(l.pieces || []);
                const total = l.totalPieces ?? (l.pieces || []).length;
                const rowKey = groupByItem ? (l.groupKey || l.lotNo || idx) : (l.lotNo || idx);

                return (
                  <div key={rowKey} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                    <div className="p-4" onClick={() => !groupByItem && toggleExpand(l.lotNo)}>
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold flex items-center gap-2">
                            {groupByItem ? (
                              <LotPopover lots={l.lots || []} onApplyFilter={handleApplyLotFilter} />
                            ) : (
                              <HighlightMatch text={l.lotNo || '—'} query={search} />
                            )}
                            {!groupByItem && (
                              isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />
                            )}
                          </div>
                          <p className="text-sm text-foreground mt-1">
                            <HighlightMatch text={l.itemName} query={search} />
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDateDDMMYYYY(l.date)} • <HighlightMatch text={l.supplierName} query={search} />
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={l.statusType === 'active' ? 'default' : 'outline'} className="text-[10px] px-1.5 py-0 h-4">
                            {l.statusType}
                          </Badge>
                          <span className="font-mono text-sm font-medium">{formatKg(l.pendingWeight)} pend.</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Pieces: {available} / {total}</span>
                        <span>Weight: {formatKg(l.remainingWeight)} / {formatKg(l.totalWeight)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Wastage: <span className="text-foreground">{formatWastageSummary(l)}</span>
                      </div>
                    </div>

                    {isExpanded && !groupByItem && (
                      <div className="border-t bg-muted/30 p-3 space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground">Firm: <HighlightMatch text={l.firmName} query={search} /></span>
                          <DisabledWithTooltip
                            disabled={!canInboundDelete}
                            tooltip="You do not have permission to delete inbound records."
                          >
                            <Button
                              variant="ghost"
                              // Inline styles here made the button awkward to size across breakpoints.
                              // Keep it purely utility-driven so it behaves consistently on mobile.
                              size="sm"
                              className="h-7 px-2 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => handleDeleteLot(l.lotNo, e)}
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Delete Lot
                            </Button>
                          </DisabledWithTooltip>
                        </div>

                        <div className="space-y-2">
                          {(l.pieces || []).sort((a, b) => a.seq - b.seq).map(p => (
                            <div key={p.id} className="bg-background border rounded p-2 text-sm">
                              <div className="flex justify-between items-start">
                                <div className="flex flex-col">
                                  <span className="font-mono text-xs">{p.barcode || p.id.substring(0, 8)}</span>
                                  <span className="text-xs text-muted-foreground">Seq: {p.seq || '—'}</span>
                                  {p.issuedLabel ? (
                                    <span className="text-[10px] text-muted-foreground">({p.issuedLabel})</span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{formatKg(p.pendingWeight)}</span>
                                  <input
                                    type="checkbox"
                                    checked={(selectedByLot[l.lotNo] || []).includes(p.id)}
                                    onChange={(e) => { e.stopPropagation(); togglePiece(l.lotNo, p.id); }}
                                    className="h-4 w-4 rounded border-gray-300 text-primary"
                                    disabled={!canIssueWrite || !isPieceAvailableForIssue(p)}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {(selectedByLot[l.lotNo] || []).length > 0 && (
                          <Button
                            className="w-full mt-2"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); openIssueModal(l.lotNo); }}
                            disabled={!canIssueWrite}
                          >
                            Issue Selected ({(selectedByLot[l.lotNo] || []).length})
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {/* Mobile Grand Total Card */}
            {displayedLots.length > 0 && (
              <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-4 mt-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-primary">Grand Total</span>
                  <div className="text-right">
                    <div className="font-mono font-bold text-primary">{formatKg(grandTotals.totalWeight)}</div>
                    <div className="text-xs text-muted-foreground">
                      {grandTotals.availableCount} / {grandTotals.totalPieces} pieces
                      {filters.status !== 'available_to_issue' && ` • ${formatKg(grandTotals.pendingWeight)} pending`}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Issue Modal */}
      <Dialog open={issueModalOpen} onOpenChange={setIssueModalOpen}>
        <DialogContent title="Issue Pieces to Machine" onOpenChange={setIssueModalOpen}>
          <div className="grid gap-4 py-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Date</Label>
                <Input type="date" value={issueModalData.date} onChange={e => setIssueModalData({ ...issueModalData, date: e.target.value })} disabled={!canIssueWrite} />
              </div>
              <div>
                <Label>Machine</Label>
                <Select value={issueModalData.machineId} onChange={e => setIssueModalData({ ...issueModalData, machineId: e.target.value })} disabled={!canIssueWrite}>
                  <option value="">Select Machine</option>
                  {(db?.machines || []).filter(m => m.processType === 'all' || m.processType === 'cutter').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Cut</Label>
                <Select value={issueModalData.cutId} onChange={e => setIssueModalData({ ...issueModalData, cutId: e.target.value })} disabled={!canIssueWrite}>
                  <option value="">Select Cut</option>
                  {db?.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label>Operator</Label>
              <Select value={issueModalData.operatorId} onChange={e => setIssueModalData({ ...issueModalData, operatorId: e.target.value })} disabled={!canIssueWrite}>
                <option value="">Select Operator</option>
                {(db?.operators || []).filter(o => o.processType === 'all' || o.processType === 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Note (Optional)</Label>
              <Input value={issueModalData.note} onChange={e => setIssueModalData({ ...issueModalData, note: e.target.value })} disabled={!canIssueWrite} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setIssueModalOpen(false)}>Cancel</Button>
              <Button onClick={doIssue} disabled={!canIssueWrite || issuing || !issueModalData.machineId || !issueModalData.operatorId || !issueModalData.cutId}>
                {issuing ? 'Issuing...' : 'Confirm Issue'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
