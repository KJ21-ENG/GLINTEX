import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INVENTORY_INVALIDATION_KEYS, useInventory } from '../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY, extractUserWastageNote } from '../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu, Button, Input, Select } from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { Trash2, Printer, Download, Edit2, Loader2, Plus, Search, X, Undo2 } from 'lucide-react';
import * as api from '../api';
import { HighlightMatch } from '../components/common/HighlightMatch';
import { WastageNoteDialog } from '../components/stock/WastageNoteDialog';
import { InfoPopover } from '../components/common/InfoPopover';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, printStageTemplatesBatch } from '../utils/labelPrint';
import { exportHistoryToExcel } from '../services';
import { useSubmitLock } from '../hooks/useSubmitLock';
import { UserBadge } from '../components/common/UserBadge';
import { SheetColumnFilter } from '../components/common/SheetColumnFilters';
import { CellText, ListState, SortToggle, TablePagination, TableResultCount, TableStateRow } from '../components/data-table';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useV2CursorList } from '../hooks/useV2CursorList';
import { useV2PagedList } from '../hooks/useV2PagedList';
import { useInfiniteScrollSentinel } from '../hooks/useInfiniteScrollSentinel';
import * as v2 from '../api/v2';

const EMPTY_TOTALS = { qty: 0, weight: 0, metallicBobbins: 0, metallicBobbinsWeight: 0, yarnKg: 0, rollsProducedEstimate: 0, rollsIssued: 0, takenBackWeight: 0, netIssuedWeight: 0 };

export function IssueHistory({ db, canEdit = false, canDelete = false }) {
  const { process, refreshProcessData, reverseIssueTakeBack, emitInvalidation, subscribeInvalidation } = useInventory();
  const [deletingId, setDeletingId] = useState(null);
  const [reversingTakeBackId, setReversingTakeBackId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  // Debounced copy for server queries so each keystroke doesn't reset the list.
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [sortOrder, setSortOrder] = useState('desc');
  const [sheetFilters, setSheetFilters] = useState({});
  const [openFilterId, setOpenFilterId] = useState(null);
  const [editingIssue, setEditingIssue] = useState(null);
  const [issueDraft, setIssueDraft] = useState(null);
  const [issueScanInput, setIssueScanInput] = useState('');
  const [issueScanLoading, setIssueScanLoading] = useState(false);
  const scrollRootRef = useRef(null);
  const takeBackScrollRef = useRef(null);
  const [savingIssue, setSavingIssue] = useState(false);
  const [revertTarget, setRevertTarget] = useState(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [issueActionLoadingId, setIssueActionLoadingId] = useState(null);
  const issueActionBusyRef = useRef(false);
  const issueDetailCacheRef = useRef(new Map());
  const issueDetailInflightRef = useRef(new Map());
  const issueEditorGenerationRef = useRef(0);
  const issueEditorStageRef = useRef(process);
  issueEditorStageRef.current = process;
  const isCurrentIssueEditorRequest = (generation, stage) => (
    issueEditorGenerationRef.current === generation && issueEditorStageRef.current === stage
  );
  useEffect(() => {
    issueEditorGenerationRef.current += 1;
    issueActionBusyRef.current = false;
    setIssueActionLoadingId(null);
    setEditingIssue(null);
    setIssueDraft(null);
    setIssueScanInput('');
    setIssueScanLoading(false);
  }, [process]);
  useEffect(() => () => {
    issueEditorGenerationRef.current += 1;
    issueActionBusyRef.current = false;
  }, []);
  const lotLabelFor = (row) => row?.lotLabel || row?.lotNo || '';
  const formatInputDate = (value) => (value ? String(value).slice(0, 10) : '');
  const parseIssuePieceIds = (row) => (
    Array.isArray(row?.pieceIds)
      ? row.pieceIds
      : (row?.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean)
  );
  const parseIssueRefs = (row) => {
    if (!row?.receivedRowRefs) return [];
    if (Array.isArray(row.receivedRowRefs)) return row.receivedRowRefs;
    try {
      const parsed = JSON.parse(row.receivedRowRefs);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  };
  const getIssueDetailCacheKey = (row) => `${process}:${row?.id || row?.barcode || ''}`;
  const loadExactIssueDetail = async (row, { force = false } = {}) => {
    if (!row) throw new Error('Issue details are unavailable');
    if (process === 'cutter') return row;
    if (!row.barcode) throw new Error('Issue barcode is missing');

    const key = getIssueDetailCacheKey(row);
    if (!force && issueDetailCacheRef.current.has(key)) return issueDetailCacheRef.current.get(key);
    if (!force && issueDetailInflightRef.current.has(key)) return await issueDetailInflightRef.current.get(key);

    const pending = (process === 'holo'
      ? api.getIssueByHoloBarcode(row.barcode)
      : api.getIssueByConingBarcode(row.barcode))
      .then((detail) => {
        issueDetailCacheRef.current.set(key, detail);
        return detail;
      })
      .finally(() => issueDetailInflightRef.current.delete(key));
    issueDetailInflightRef.current.set(key, pending);
    return await pending;
  };
  const issueSources = (detail) => (
    Array.isArray(detail?.sources)
      ? detail.sources
      : (Array.isArray(detail?.crates) ? detail.crates : [])
  );
  const formatMixedLotLabel = (lotNos = []) => {
    const uniqueLots = Array.from(new Set((lotNos || []).map((lot) => String(lot || '').trim()).filter(Boolean)));
    if (uniqueLots.length === 0) return '';
    if (uniqueLots.length === 1) return uniqueLots[0];
    return uniqueLots.length <= 3
      ? `Mixed (${uniqueLots.join(', ')})`
      : `Mixed (${uniqueLots.length})`;
  };
  const resolveConingSourceMeta = (sourceRow) => {
    if (!sourceRow) return { lotNo: '', itemId: '', cut: '' };
    const lotNo = sourceRow.lotNo || sourceRow.trace?.lotNo || sourceRow.issue?.lotNo || '';
    const itemId = sourceRow.itemId || sourceRow.trace?.itemId || sourceRow.issue?.itemId || '';
    const cut = sourceRow.cutName || sourceRow.trace?.cutName || sourceRow.issue?.cut?.name
      || (sourceRow.issue?.cutId ? db.cuts?.find(c => c.id === sourceRow.issue.cutId)?.name || '' : '');
    return { lotNo, itemId, cut };
  };
  const toTimeMs = (value) => {
    const ms = new Date(value || 0).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const cutterIssueTimelineByPiece = useMemo(() => {
    const map = new Map();
    (db.issue_to_cutter_machine || [])
      .filter((issue) => !issue?.isDeleted && issue?.id)
      .forEach((issue) => {
        const issueCreatedAtMs = toTimeMs(issue.createdAt);
        const pieceIds = Array.isArray(issue.pieceIds)
          ? issue.pieceIds
          : (issue.pieceIds || '').split(',').map((s) => s.trim()).filter(Boolean);
        pieceIds.forEach((pieceId) => {
          if (!pieceId) return;
          const rows = map.get(pieceId) || [];
          rows.push({ issueId: issue.id, createdAtMs: issueCreatedAtMs });
          map.set(pieceId, rows);
        });
      });
    map.forEach((rows, pieceId) => {
      rows.sort((a, b) => {
        const aMs = a.createdAtMs == null ? Number.MAX_SAFE_INTEGER : a.createdAtMs;
        const bMs = b.createdAtMs == null ? Number.MAX_SAFE_INTEGER : b.createdAtMs;
        if (aMs !== bMs) return aMs - bMs;
        return String(a.issueId).localeCompare(String(b.issueId));
      });
      map.set(pieceId, rows);
    });
    return map;
  }, [db.issue_to_cutter_machine]);

  const resolveConingConeTypeName = (issue) => {
    const refs = parseIssueRefs(issue);
    if (!refs.length) return '';
    const ids = new Set(refs.map(ref => ref?.coneTypeId).filter(Boolean));
    if (!ids.size) return '';
    const names = Array.from(ids).map(id => db.cone_types?.find(c => c.id === id)?.name || id);
    return names.join(', ');
  };

  const pickName = (primary, fallback = '') => {
    const a = String(primary || '').trim();
    if (a && a !== '—') return a;
    const b = String(fallback || '').trim();
    return b || '—';
  };

  const resolveIssueNames = (row) => {
    if (!row) return { cutName: '—', yarnName: '—', twistName: '—', itemName: '—' };
    // v2 list rows are pre-flattened; avoid heavy tracing during render.
    return {
      itemName: pickName(row.itemName, ''),
      cutName: pickName(row.cutName, ''),
      yarnName: pickName(row.yarnName, ''),
      twistName: pickName(row.twistName, ''),
    };
  };

  const formatPerConeNet = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '—';
    return `${num} g`;
  };

  const formatCutterWastageDisplay = (row) => {
    const wastageWeight = Number(row?.wastageWeight || 0);
    const issuedBase = Number(row?.netIssuedWeight ?? row?.totalWeight ?? 0);
    const wastagePercent = issuedBase > 0 ? ((wastageWeight / issuedBase) * 100) : 0;
    return `${formatKg(wastageWeight)} (${wastagePercent.toFixed(1)}%)`;
  };

  // Latest active wastage note per piece, sourced from cutter challans. Only entries
  // with an actual user-supplied note (after the em-dash separator) are included;
  // auto-only notes like "Wastage marked: 7.794 kg" are skipped so the (i) tooltip
  // surfaces only when there is real operator-written context to read.
  const cutterWastageNoteByPieceId = useMemo(() => {
    if (process !== 'cutter') return new Map();
    const challans = Array.isArray(db?.receive_from_cutter_machine_challans) ? db.receive_from_cutter_machine_challans : [];
    const map = new Map();
    const sorted = [...challans].sort((a, b) => (b?.createdAt || '').localeCompare(a?.createdAt || ''));
    for (const ch of sorted) {
      if (!ch || ch.isDeleted) continue;
      if (!(Number(ch.wastageNetWeight || 0) > 0)) continue;
      if (!ch.pieceId || map.has(ch.pieceId)) continue;
      const userNote = extractUserWastageNote(ch.wastageNote);
      if (userNote) map.set(ch.pieceId, userNote);
    }
    return map;
  }, [db?.receive_from_cutter_machine_challans, process]);

  const renderCutterWastageCell = (row) => {
    const text = formatCutterWastageDisplay(row);
    if (Number(row?.wastageWeight || 0) <= 0) return text;
    const pieceIds = parseIssuePieceIds(row);
    const note = pieceIds.length > 0 ? cutterWastageNoteByPieceId.get(pieceIds[0]) : null;
    if (!note) return text;
    return (
      <span className="inline-flex items-center gap-1">
        {text}
        <InfoPopover
          title="Wastage note"
          items={[note]}
          renderContent={() => (
            <div className="text-xs whitespace-pre-wrap break-words">{note}</div>
          )}
          widthClassName="w-72"
          bodyClassName="text-xs"
          buttonClassName="h-4 w-4 rounded-full hover:bg-muted inline-flex p-0"
          align="left"
        />
      </span>
    );
  };

  const handleDelete = async (issueId) => {
    if (!canDelete) return;
    if (!confirm('Are you sure you want to delete this issue record? This will make the pieces available again for re-issuing.')) {
      return;
    }
    setDeletingId(issueId);
    try {
      await api.deleteIssueToMachine(issueId, process);
      v2List.refresh();
      emitInvalidation([
        INVENTORY_INVALIDATION_KEYS.issueOnMachine(process),
      ], { source: 'deleteIssueToMachine', issueId });
      alert('Issue record deleted.');
    } catch (err) {
      alert(err.message || 'Failed to delete issue record');
    } finally {
      setDeletingId(null);
    }
  };

  const getIssueHasReceives = (row) => {
    if (typeof row?.hasReceives === 'boolean') return row.hasReceives;
    if (!row) return false;
    if (process === 'cutter') {
      const pieceIds = parseIssuePieceIds(row);
      const issueCreatedAtMs = toTimeMs(row.createdAt);
      return (db.receive_from_cutter_machine_rows || [])
        .some((r) => {
          if (r.isDeleted) return false;
          if (r.issueId) return r.issueId === row.id;
          if (!pieceIds.includes(r.pieceId)) return false;
          const rowCreatedAtMs = toTimeMs(r.createdAt || r.date);
          if (issueCreatedAtMs != null && (rowCreatedAtMs == null || rowCreatedAtMs < issueCreatedAtMs)) return false;
          if (rowCreatedAtMs == null) return false;
          const timeline = cutterIssueTimelineByPiece.get(r.pieceId) || [];
          const assignedIssue = [...timeline]
            .reverse()
            .find((entry) => entry.createdAtMs != null && entry.createdAtMs <= rowCreatedAtMs);
          return assignedIssue?.issueId === row.id;
        });
    }
    // Holo and Coning must use the authoritative issue-scoped lookup. Their
    // process snapshots are intentionally not loaded on this page.
    return false;
  };

  const openIssueEditor = async (row) => {
    if (!row) return;

    const requestGeneration = issueEditorGenerationRef.current + 1;
    const requestStage = process;

    if (process === 'cutter') {
      issueEditorGenerationRef.current = requestGeneration;
      const hasReceives = getIssueHasReceives(row);
      setEditingIssue({ ...row, hasReceives });
      setIssueScanInput('');
      setIssueDraft({
        date: formatInputDate(row.date),
        machineId: row.machineId || '',
        operatorId: row.operatorId || '',
        cutId: row.cutId || '',
        note: row.note || '',
        pieceIds: parseIssuePieceIds(row),
        piecesTouched: false,
      });
      return;
    }

    if (issueActionBusyRef.current) return;
    issueEditorGenerationRef.current = requestGeneration;
    issueActionBusyRef.current = true;
    setIssueActionLoadingId(row.id);
    try {
      const detail = await loadExactIssueDetail(row);
      if (!isCurrentIssueEditorRequest(requestGeneration, requestStage)) return;
      const hydrated = { ...row, ...detail };
      const hasReceives = typeof detail?.hasReceives === 'boolean'
        ? detail.hasReceives
        : (Array.isArray(detail?.receives) && detail.receives.length > 0);
      setEditingIssue({ ...hydrated, hasReceives });
      setIssueScanInput('');

      const refs = parseIssueRefs(hydrated);
      const sources = issueSources(detail);
      const sourceById = new Map(sources.map((source) => [String(source?.rowId || source?.id || ''), source]));
      const orderedRefs = refs.length > 0
        ? refs
        : sources.map((source) => ({ rowId: source?.rowId || source?.id, ...source }));

      if (process === 'holo') {
        const crates = orderedRefs.map((ref) => {
          const source = sourceById.get(String(ref?.rowId || '')) || {};
          const combined = { ...source, ...ref };
          const bobbinQty = Number(source?.bobbinQuantity || 0);
          const netWeight = Number(source?.netWeight ?? source?.netWt ?? 0);
          const unitWeight = Number(source?.unitWeight)
            || (bobbinQty > 0 ? netWeight / bobbinQty : null);
          return {
            rowId: combined.rowId || source.id,
            barcode: source.barcode || source.vchNo || combined.barcode || '',
            pieceId: source.pieceId || combined.pieceId || '',
            itemId: source.itemId || combined.itemId || '',
            lotNo: source.lotNo || combined.lotNo || '',
            issuedBobbins: Number(combined.issuedBobbins || 0),
            issuedBobbinWeight: Number(combined.issuedBobbinWeight || 0),
            unitWeight,
          };
        });

        setIssueDraft({
          date: formatInputDate(hydrated.date),
          machineId: hydrated.machineId || '',
          operatorId: hydrated.operatorId || '',
          shift: hydrated.shift || '',
          yarnId: hydrated.yarnId || '',
          twistId: hydrated.twistId || '',
          yarnKg: hydrated.yarnKg ?? '',
          rollsProducedEstimate: hydrated.rollsProducedEstimate ?? '',
          note: hydrated.note || '',
          crates,
          cratesTouched: false,
        });
        return;
      }

      const crates = orderedRefs.map((ref) => {
        const source = sourceById.get(String(ref?.rowId || '')) || {};
        const combined = { ...source, ...ref };
        const baseRolls = Number(source?.rollCount ?? source?.coneCount ?? 0);
        const baseWeight = Number(source?.rollWeight ?? source?.coneWeight ?? source?.netWeight ?? 0);
        const unitWeight = Number(source?.unitWeight)
          || (baseRolls > 0 ? baseWeight / baseRolls : 0);
        const { lotNo, itemId, cut } = resolveConingSourceMeta(source);
        return {
          rowId: combined.rowId || source.id,
          barcode: source.barcode || combined.barcode || '',
          issueRolls: Number(combined.issueRolls || 0),
          issueWeight: Number(combined.issueWeight || 0),
          unitWeight,
          lotNo,
          itemId,
          cut,
        };
      });
      const firstRef = orderedRefs[0] || {};

      setIssueDraft({
        date: formatInputDate(hydrated.date),
        machineId: hydrated.machineId || '',
        operatorId: hydrated.operatorId || '',
        shift: hydrated.shift || '',
        note: hydrated.note || '',
        requiredPerConeNetWeight: hydrated.requiredPerConeNetWeight ?? '',
        coneTypeId: firstRef.coneTypeId || '',
        wrapperId: firstRef.wrapperId || '',
        boxId: firstRef.boxId || '',
        crates,
        cratesTouched: false,
        metaTouched: false,
      });
    } catch (err) {
      if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        alert(err?.message || 'Failed to load issue details');
      }
    } finally {
      if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        issueActionBusyRef.current = false;
        setIssueActionLoadingId(null);
      }
    }
  };

  const closeIssueEditor = () => {
    issueEditorGenerationRef.current += 1;
    setEditingIssue(null);
    setIssueDraft(null);
    setIssueScanInput('');
    setIssueScanLoading(false);
  };

  const updateIssueDraftField = (field, value) => {
    setIssueDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (process === 'coning' && ['coneTypeId', 'wrapperId', 'boxId'].includes(field)) {
        next.metaTouched = true;
      }
      return next;
    });
  };

  const handleAddPiece = () => {
    if (!issueDraft) return;
    const raw = issueScanInput.trim();
    if (!raw) return;
    const normalized = raw.toUpperCase();
    const piece = (db.inbound_items || []).find(p => p.id === raw || p.id === normalized || (p.barcode || '').toUpperCase() === normalized);
    if (!piece) {
      alert('Piece not found');
      return;
    }
    if (issueDraft.pieceIds.includes(piece.id)) {
      alert('Piece already added');
      return;
    }
    const existingPieces = (issueDraft.pieceIds || [])
      .map((id) => (db.inbound_items || []).find(p => p.id === id))
      .filter(Boolean);
    const itemId = existingPieces[0]?.itemId;
    const lotNo = existingPieces[0]?.lotNo;
    if (itemId && piece.itemId !== itemId) {
      alert('Pieces must belong to a single item');
      return;
    }
    if (lotNo && piece.lotNo !== lotNo) {
      alert('Pieces must belong to a single lot');
      return;
    }
    if (piece.status !== 'available') {
      alert('Piece is not available');
      return;
    }
    setIssueDraft((prev) => ({
      ...prev,
      pieceIds: [...prev.pieceIds, piece.id],
      piecesTouched: true,
    }));
    setIssueScanInput('');
  };

  const handleRemovePiece = (pieceId) => {
    setIssueDraft((prev) => ({
      ...prev,
      pieceIds: prev.pieceIds.filter(id => id !== pieceId),
      piecesTouched: true,
    }));
  };

  const handleAddHoloCrate = async () => {
    if (!issueDraft) return;
    const normalized = issueScanInput.trim().toUpperCase();
    if (!normalized) return;
    const requestGeneration = issueEditorGenerationRef.current;
    const requestStage = process;

    let result;
    setIssueScanLoading(true);
    try {
      result = await api.lookupHoloSourceRowByBarcode(normalized);
    } catch (err) {
      if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        alert(err?.message || 'Barcode not found in Cutter Receive rows');
      }
      return;
    } finally {
      if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        setIssueScanLoading(false);
      }
    }
    if (!isCurrentIssueEditorRequest(requestGeneration, requestStage)) return;
    if (result?.outcome !== 'found' || !result?.row) {
      alert(result?.error || 'Barcode is not available for Holo issue');
      return;
    }

    const row = result.row;
    if (issueDraft.crates.some(c => c.rowId === row.id)) {
      alert('Crate already added');
      return;
    }

    const piece = result.piece || {};
    const itemId = piece.itemId || row.itemId || result.trace?.itemId || '';
    const lotNo = piece.lotNo || row.lotNo || result.trace?.lotNo || '';
    if (!itemId || !lotNo) {
      alert('Inbound piece not found for this crate');
      return;
    }

    const currentItemId = issueDraft.crates[0]?.itemId;
    if (currentItemId && itemId !== currentItemId) {
      alert('Mixed items not allowed');
      return;
    }

    const bobbinQty = Number(row.bobbinQuantity || 0);
    const availability = result.availability || {};
    const availCount = Number(availability.availableBobbins ?? row.availableBobbins ?? 0);
    const availWt = Number(availability.availableWeight ?? row.availableWeight ?? 0);
    const unitWeight = Number(row.unitWeight)
      || (bobbinQty > 0 ? Number(row.netWt ?? row.netWeight ?? 0) / bobbinQty : null);

    setIssueDraft((prev) => prev && ({
      ...prev,
      crates: [
        ...(prev.crates || []),
        {
          rowId: row.id,
          barcode: row.barcode,
          pieceId: row.pieceId,
          itemId,
          lotNo,
          issuedBobbins: availCount,
          issuedBobbinWeight: availWt,
          unitWeight,
        },
      ],
      cratesTouched: true,
    }));
    setIssueScanInput('');
  };

  const updateHoloCrate = (rowId, field, value) => {
    setIssueDraft((prev) => ({
      ...prev,
      crates: prev.crates.map((crate) => {
        if (crate.rowId !== rowId) return crate;
        const next = { ...crate, [field]: value };
        if (field === 'issuedBobbins' && crate.unitWeight != null) {
          const count = Number(value);
          next.issuedBobbinWeight = Number((count * crate.unitWeight).toFixed(3));
        }
        return next;
      }),
      cratesTouched: true,
    }));
  };

  const handleRemoveHoloCrate = (rowId) => {
    setIssueDraft((prev) => ({
      ...prev,
      crates: prev.crates.filter(c => c.rowId !== rowId),
      cratesTouched: true,
    }));
  };

  const handleAddConingCrate = async () => {
    if (!issueDraft) return;
    const normalized = issueScanInput.trim().toUpperCase();
    if (!normalized) return;
    const requestGeneration = issueEditorGenerationRef.current;
    const requestStage = process;

    let row = null;
    let availability = null;
    setIssueScanLoading(true);
    try {
      const result = await api.lookupConingSourceRowByBarcode(normalized);
      if (result?.outcome !== 'found') {
        if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
          alert(result?.error || 'Barcode not found in receive rows');
        }
        return;
      }
      row = result.row;
      availability = result.availability || null;
    } catch (err) {
      if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        alert(err.message || 'Barcode not found in receive rows');
      }
      return;
    } finally {
      if (isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        setIssueScanLoading(false);
      }
    }

    if (!isCurrentIssueEditorRequest(requestGeneration, requestStage)) return;
    if (!row) return;
    if (issueDraft.crates.some(c => c.rowId === row.id)) {
      alert('Crate already added');
      return;
    }

    const { lotNo, itemId, cut: cutName } = resolveConingSourceMeta(row);
    if (!lotNo) {
      alert('Lot not found for this crate');
      return;
    }

    if (issueDraft.crates.length > 0) {
      const currentLotNo = issueDraft.crates[0]?.lotNo || '';
      const currentItemId = issueDraft.crates[0]?.itemId || '';
      const currentCut = issueDraft.crates[0]?.cut || '';
      if (currentLotNo && lotNo !== currentLotNo && (itemId !== currentItemId || cutName !== currentCut)) {
        const existingItemName = db.items?.find(i => i.id === currentItemId)?.name || 'Unknown';
        const scannedItemName = db.items?.find(i => i.id === itemId)?.name || 'Unknown';
        alert(`Mixed lots are only allowed for same Item and Cut.\n\nExisting: Item="${existingItemName}", Cut="${currentCut || 'N/A'}"\nScanned: Item="${scannedItemName}", Cut="${cutName || 'N/A'}"`);
        return;
      }
      if (currentItemId && itemId && itemId !== currentItemId) {
        alert('Mixed items not allowed');
        return;
      }
    }

    const baseRolls = availability?.availableRolls ?? row.availableRolls ?? row.rollCount ?? row.coneCount ?? 0;
    const baseWeight = availability?.availableWeight ?? row.availableWeight ?? row.rollWeight ?? row.coneWeight ?? 0;
    const unitWeight = baseRolls > 0 ? baseWeight / baseRolls : 0;

    setIssueDraft((prev) => prev && ({
      ...prev,
      crates: [
        ...(prev.crates || []),
        {
          rowId: row.id,
          barcode: row.barcode,
          issueRolls: baseRolls,
          issueWeight: baseWeight,
          unitWeight,
          lotNo,
          itemId,
          cut: cutName,
        },
      ],
      cratesTouched: true,
    }));
    setIssueScanInput('');
  };

  const updateConingCrate = (rowId, field, value) => {
    setIssueDraft((prev) => ({
      ...prev,
      crates: prev.crates.map((crate) => {
        if (crate.rowId !== rowId) return crate;
        const next = { ...crate, [field]: value };
        if (field === 'issueRolls') {
          const rolls = Number(value);
          next.issueWeight = Number((rolls * (crate.unitWeight || 0)).toFixed(3));
        }
        return next;
      }),
      cratesTouched: true,
    }));
  };

  const handleRemoveConingCrate = (rowId) => {
    setIssueDraft((prev) => ({
      ...prev,
      crates: prev.crates.filter(c => c.rowId !== rowId),
      cratesTouched: true,
    }));
  };

  const [, wrapSaveIssue] = useSubmitLock();
  const handleSaveIssueEdits = wrapSaveIssue(async () => {
    if (!editingIssue || !issueDraft) return;
    if (!issueDraft.date) {
      alert('Date is required');
      return;
    }
    setSavingIssue(true);
    try {
      if (process === 'cutter') {
        const payload = {
          date: issueDraft.date,
          note: issueDraft.note || null,
          machineId: issueDraft.machineId || null,
          operatorId: issueDraft.operatorId || null,
          cutId: issueDraft.cutId || null,
        };
        if (!editingIssue.hasReceives && issueDraft.piecesTouched) {
          payload.pieceIds = issueDraft.pieceIds;
        }
        await api.updateIssueToMachine(editingIssue.id, process, payload);
      } else if (process === 'holo') {
        const payload = {
          date: issueDraft.date,
          note: issueDraft.note || null,
          machineId: issueDraft.machineId || null,
          operatorId: issueDraft.operatorId || null,
          shift: issueDraft.shift || null,
        };
        if (!editingIssue.hasReceives) {
          payload.yarnId = issueDraft.yarnId || null;
          payload.twistId = issueDraft.twistId || null;
          payload.yarnKg = issueDraft.yarnKg === '' ? 0 : Number(issueDraft.yarnKg || 0);
          payload.rollsProducedEstimate = issueDraft.rollsProducedEstimate === '' ? null : Number(issueDraft.rollsProducedEstimate);
          if (issueDraft.cratesTouched) {
            payload.crates = issueDraft.crates.map(c => ({
              rowId: c.rowId,
              issuedBobbins: Number(c.issuedBobbins || 0),
              issuedBobbinWeight: Number(c.issuedBobbinWeight || 0),
            }));
          }
        }
        await api.updateIssueToMachine(editingIssue.id, process, payload);
      } else {
        const payload = {
          date: issueDraft.date,
          note: issueDraft.note || null,
          machineId: issueDraft.machineId || null,
          operatorId: issueDraft.operatorId || null,
          shift: issueDraft.shift || null,
        };
        if (!editingIssue.hasReceives) {
          if (issueDraft.requiredPerConeNetWeight !== '') {
            payload.requiredPerConeNetWeight = Number(issueDraft.requiredPerConeNetWeight || 0);
          }
          if (issueDraft.metaTouched) {
            payload.coneTypeId = issueDraft.coneTypeId || null;
            payload.wrapperId = issueDraft.wrapperId || null;
            payload.boxId = issueDraft.boxId || null;
          }
          if (issueDraft.cratesTouched) {
            payload.crates = issueDraft.crates.map(c => ({
              rowId: c.rowId,
              barcode: c.barcode,
              coneTypeId: issueDraft.coneTypeId || null,
              wrapperId: issueDraft.wrapperId || null,
              boxId: issueDraft.boxId || null,
              issueRolls: Number(c.issueRolls || 0),
              issueWeight: Number(c.issueWeight || 0),
            }));
          }
        }
        await api.updateIssueToMachine(editingIssue.id, process, payload);
      }
      if (process === 'cutter') {
        await refreshProcessData(process);
      } else {
        issueDetailCacheRef.current.delete(getIssueDetailCacheKey(editingIssue));
      }
      emitInvalidation([
        INVENTORY_INVALIDATION_KEYS.issueOnMachine(process),
        INVENTORY_INVALIDATION_KEYS.issueHistory(process),
      ], { source: 'updateIssueToMachine', issueId: editingIssue.id });
      closeIssueEditor();
      alert('Issue record updated.');
    } catch (err) {
      alert(err.message || 'Failed to update issue record');
    } finally {
      setSavingIssue(false);
    }
  });

  const handleReprint = async (row) => {
    if (!row) return;
    const requestStage = process;
    let requestGeneration = null;
    if (process !== 'cutter') {
      if (issueActionBusyRef.current) return;
      requestGeneration = issueEditorGenerationRef.current + 1;
      issueEditorGenerationRef.current = requestGeneration;
      issueActionBusyRef.current = true;
      setIssueActionLoadingId(row.id);
    }
    try {
      let stageKey, data;
      const exactRow = process === 'cutter' ? row : { ...row, ...(await loadExactIssueDetail(row)) };
      if (process !== 'cutter' && !isCurrentIssueEditorRequest(requestGeneration, requestStage)) return;
      const lotLabel = lotLabelFor(exactRow);

      if (process === 'cutter') {
        stageKey = LABEL_STAGE_KEYS.CUTTER_ISSUE;
        const itemName = row.itemName || db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = row.machineName || db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = row.operatorName || db.operators?.find(o => o.id === row.operatorId)?.name || '';
        const cut = row.cutName || db.cuts?.find(c => c.id === row.cutId)?.name || '';

        // Get inbound date from first piece
        const pieceList = Array.isArray(row.pieceIds) ? row.pieceIds : (row.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
        const firstPiece = db.inbound_items?.find(p => p.id === pieceList[0]);
        const lot = db.lots?.find(l => l.lotNo === row.lotNo);
        const inboundDate = lot?.date || firstPiece?.date || '';

        data = {
          lotNo: lotLabel,
          itemName,
          pieceId: row.pieceIds,
          seq: firstPiece?.seq || '',
          count: row.count,
          totalWeight: row.totalWeight,
          machineName,
          operatorName,
          cut,
          inboundDate,
          date: row.date,
          barcode: row.barcode,
        };
      } else if (process === 'holo') {
        stageKey = LABEL_STAGE_KEYS.HOLO_ISSUE;
        const names = resolveIssueNames(exactRow);
        const sources = issueSources(exactRow);
        const refs = parseIssueRefs(exactRow);
        const allocations = refs.length > 0 ? refs : sources;
        const bobbinQty = allocations.reduce((sum, ref) => sum + Number(ref?.issuedBobbins || 0), 0);
        const issuedWeight = allocations.reduce((sum, ref) => sum + Number(ref?.issuedBobbinWeight || 0), 0);
        const bobbinType = sources[0]?.bobbinName || sources[0]?.bobbin?.name || '';
        const cut = exactRow.trace?.cutName || (names.cutName === '—' ? '' : names.cutName);
        const totalRolls = exactRow.metallicBobbins || 0;
        const totalWeight = exactRow.metallicBobbinsWeight || 0;
        const resolvedBobbinQty = bobbinQty || exactRow.metallicBobbins || 0;
        const resolvedNetWeight = issuedWeight || totalWeight || 0;

        data = {
          lotNo: lotLabel,
          itemName: names.itemName === '—' ? (exactRow.itemName || '') : names.itemName,
          machineName: exactRow.machineName || db.machines?.find(m => m.id === exactRow.machineId)?.name || '',
          operatorName: exactRow.operatorName || db.operators?.find(o => o.id === exactRow.operatorId)?.name || '',
          yarnName: names.yarnName === '—' ? (exactRow.yarnName || '') : names.yarnName,
          twistName: names.twistName === '—' ? (exactRow.twistName || '') : names.twistName,
          bobbinType,
          bobbinQty: resolvedBobbinQty,
          totalRolls,
          totalWeight,
          netWeight: resolvedNetWeight,
          metallicBobbins: exactRow.metallicBobbins,
          metallicBobbinsWeight: exactRow.metallicBobbinsWeight,
          yarnKg: exactRow.yarnKg,
          cut,
          shift: exactRow.shift,
          date: exactRow.date,
          barcode: exactRow.barcode,
        };
      } else if (process === 'coning') {
        stageKey = LABEL_STAGE_KEYS.CONING_ISSUE;
        const names = resolveIssueNames(exactRow);
        const refs = parseIssueRefs(exactRow);
        const firstRef = refs[0] || {};
        const trace = exactRow.trace || {};
        const rollCount = refs.reduce((sum, ref) => sum + Number(ref?.issueRolls || 0), 0);
        const totalWeight = refs.reduce((sum, ref) => sum + Number(ref?.issueWeight || 0), 0);
        const twistName = trace.twistName || (names.twistName === '—' ? '' : names.twistName);

        data = {
          lotNo: lotLabel,
          itemName: names.itemName === '—' ? (exactRow.itemName || '') : names.itemName,
          machineName: exactRow.machineName || db.machines?.find(m => m.id === exactRow.machineId)?.name || '',
          operatorName: exactRow.operatorName || db.operators?.find(o => o.id === exactRow.operatorId)?.name || '',
          cut: trace.cutName || (names.cutName === '—' ? '' : names.cutName),
          yarnName: trace.yarnName || (names.yarnName === '—' ? '' : names.yarnName),
          rollType: trace.rollTypeName || exactRow.rollTypeName || exactRow.rollType || '',
          coneType: exactRow.coneTypeName || (firstRef.coneTypeId ? db.cone_types?.find(c => c.id === firstRef.coneTypeId)?.name || '' : ''),
          wrapperName: exactRow.wrapperName || (firstRef.wrapperId ? db.wrappers?.find(w => w.id === firstRef.wrapperId)?.name || '' : ''),
          twist: twistName,
          twistName,
          rollCount,
          totalRolls: rollCount,
          totalWeight,
          grossWeight: null,
          tareWeight: null,
          netWeight: totalWeight,
          expectedCones: exactRow.expectedCones,
          perConeTargetG: exactRow.requiredPerConeNetWeight,
          shift: exactRow.shift,
          date: exactRow.date,
          barcode: exactRow.barcode,
        };
      }


      if (!stageKey) {
        alert('Unknown process type');
        return;
      }

      const template = await loadTemplate(stageKey);
      if (process !== 'cutter' && !isCurrentIssueEditorRequest(requestGeneration, requestStage)) return;
      if (!template) {
        alert('No sticker template found for this stage. Please configure it in Label Designer.');
        return;
      }

      await printStageTemplate(stageKey, data, { template });
      // Silent success - printer handles feedback
    } catch (err) {
      if (process === 'cutter' || isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        alert(err.message || 'Failed to reprint sticker');
      }
    } finally {
      if (process !== 'cutter' && isCurrentIssueEditorRequest(requestGeneration, requestStage)) {
        issueActionBusyRef.current = false;
        setIssueActionLoadingId(null);
      }
    }
  };

  const handlePrintSmallSticker = async (row) => {
    try {
      // Only for cutter process
      if (process !== 'cutter') return;

      // Ask for quantity
      const qtyInput = prompt('Enter quantity of stickers to print:', '1');
      if (qtyInput === null) return; // User cancelled
      const qty = parseInt(qtyInput, 10);
      if (!qty || qty < 1) {
        alert('Please enter a valid quantity (1 or more)');
        return;
      }

      const stageKey = LABEL_STAGE_KEYS.CUTTER_ISSUE_SMALL;
      const itemName = row.itemName || db.items?.find(i => i.id === row.itemId)?.name || '';
      const machineName = row.machineName || db.machines?.find(m => m.id === row.machineId)?.name || '';
      const operatorName = row.operatorName || db.operators?.find(o => o.id === row.operatorId)?.name || '';
      const cut = row.cutName || db.cuts?.find(c => c.id === row.cutId)?.name || '';

      // Get inbound date from first piece
      const pieceList = Array.isArray(row.pieceIds) ? row.pieceIds : (row.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
      const firstPiece = db.inbound_items?.find(p => p.id === pieceList[0]);
      const lot = db.lots?.find(l => l.lotNo === row.lotNo);
      const inboundDate = lot?.date || firstPiece?.date || '';

      const data = {
        lotNo: row.lotNo,
        itemName,
        pieceId: row.pieceIds,
        seq: firstPiece?.seq || '',
        count: row.count,
        totalWeight: row.totalWeight,
        machineName,
        operatorName,
        cut,
        inboundDate,
        date: row.date,
        barcode: row.barcode,
      };

      const template = await loadTemplate(stageKey);
      if (!template) {
        alert('No small sticker template found. Please configure it in Label Designer (Issue to machine (cutter)_small sticker).');
        return;
      }

      // Print the requested quantity in one go using batch utility
      await printStageTemplatesBatch(stageKey, [data], { template, copies: qty });
      // Silent success - printer handles feedback
    } catch (err) {
      alert(err.message || 'Failed to print small sticker');
    }
  };

  const itemNameById = useMemo(() => {
    const map = new Map();
    (db.items || []).forEach(i => map.set(i.id, i.name || '—'));
    return map;
  }, [db.items]);

  const machineNameById = useMemo(() => {
    const map = new Map();
    (db.machines || []).forEach(m => map.set(m.id, m.name || '—'));
    return map;
  }, [db.machines]);

  const operatorNameById = useMemo(() => {
    const map = new Map();
    (db.operators || []).forEach(o => map.set(o.id, o.name || '—'));
    return map;
  }, [db.operators]);

  const cutNameById = useMemo(() => {
    const map = new Map();
    (db.cuts || []).forEach(c => map.set(c.id, c.name || '—'));
    return map;
  }, [db.cuts]);

  const twistNameById = useMemo(() => {
    const map = new Map();
    (db.twists || []).forEach(t => map.set(t.id, t.name || '—'));
    return map;
  }, [db.twists]);

  const yarnNameById = useMemo(() => {
    const map = new Map();
    (db.yarns || []).forEach(y => map.set(y.id, y.name || '—'));
    return map;
  }, [db.yarns]);

  const resolvePieceCutName = (piece) => {
    if (!piece) return '';
    const cutVal = piece.cut;
    return piece.cutName
      || (typeof cutVal === 'string' ? cutVal : cutVal?.name)
      || piece.cutMaster?.name
      || (piece.cutId ? cutNameById.get(piece.cutId) : '')
      || '';
  };

  const resolvePieceYarnName = (piece) => {
    if (!piece) return '';
    const yarnVal = piece.yarn;
    return piece.yarnName
      || (typeof yarnVal === 'string' ? yarnVal : yarnVal?.name)
      || (piece.yarnId ? yarnNameById.get(piece.yarnId) : '')
      || '';
  };

  const resolvePieceTwistName = (piece) => {
    if (!piece) return '';
    const twistVal = piece.twist;
    return piece.twistName
      || (typeof twistVal === 'string' ? twistVal : twistVal?.name)
      || (piece.twistId ? twistNameById.get(piece.twistId) : '')
      || '';
  };

  const resolveCutterIssueDetails = (row) => {
    if (!row) return { cutName: '—', yarnName: '—', twistName: '—' };
    const directCut = cutNameById.get(row.cutId) || '';
    const pieceIds = parseIssuePieceIds(row);
    const firstPiece = db.inbound_items?.find(p => p.id === pieceIds[0]);
    const fallbackCut = resolvePieceCutName(firstPiece);
    const fallbackYarn = resolvePieceYarnName(firstPiece);
    const fallbackTwist = resolvePieceTwistName(firstPiece);
    return {
      cutName: directCut || fallbackCut || '—',
      yarnName: fallbackYarn || '—',
      twistName: fallbackTwist || '—',
    };
  };

  const resolveIssueTraceNames = (row) => {
    if (!row) return { cutName: '—', yarnName: '—', twistName: '—' };

    // Check if names are already on the row (v2 flattened or already resolved)
    if (row.cutName || row.yarnName || row.twistName) {
      return {
        cutName: row.cutName || '—',
        yarnName: row.yarnName || '—',
        twistName: row.twistName || '—',
      };
    }

    if (process === 'holo' || process === 'coning') {
      return {
        cutName: row.cutName || '—',
        yarnName: row.yarnName || '—',
        twistName: row.twistName || '—',
      };
    }
    return resolveCutterIssueDetails(row);
  };

  const handleReverseTakeBack = async (takeBack) => {
    if (!takeBack || takeBack.isReverse || takeBack.isReversed) return;
    const confirmed = window.confirm('Reverse this take-back entry?');
    if (!confirmed) return;
    setReversingTakeBackId(takeBack.id);
    try {
      await reverseIssueTakeBack(takeBack.id, {
        date: new Date().toISOString().slice(0, 10),
        reason: 'reverse',
        note: 'Reversed from Issue History',
        stage: process,
      });
    } catch (err) {
      alert(err.message || 'Failed to reverse take-back');
    } finally {
      setReversingTakeBackId(null);
    }
  };

  const filterColumns = useMemo(() => {
    // In v2 mode, row objects already include flattened names; avoid expensive tracing.
    const common = [
      { id: 'date', label: 'Date', kind: 'date', getValue: (r) => r.date || r.createdAt || '' },
      { id: 'shift', label: 'Shift', kind: 'values', getValue: (r) => r.shift || '' },
      { id: 'item', label: 'Item', kind: 'values', getValue: (r) => r.itemName || itemNameById.get(r.itemId) || '' },
      { id: 'lotOrPiece', label: 'Piece/Lot', kind: 'text', getValue: (r) => (process === 'cutter' ? (r.pieceIds || '') : (r.lotLabel || lotLabelFor(r) || '')) },
      { id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => (resolveIssueTraceNames(r).cutName || '') },
      ...(process !== 'cutter' ? [
        { id: 'yarn', label: 'Yarn', kind: 'values', getValue: (r) => (resolveIssueTraceNames(r).yarnName || '') },
        { id: 'twist', label: 'Twist', kind: 'values', getValue: (r) => (resolveIssueTraceNames(r).twistName || '') },
      ] : []),
      { id: 'machine', label: 'Machine', kind: 'values', getValue: (r) => r.machineName || machineNameById.get(r.machineId) || '' },
      { id: 'operator', label: 'Operator', kind: 'values', getValue: (r) => r.operatorName || operatorNameById.get(r.operatorId) || '' },
      { id: 'barcode', label: 'Barcode', kind: 'text', getValue: (r) => r.barcode || '' },
      { id: 'note', label: 'Note', kind: 'text', getValue: (r) => r.note || '' },
      { id: 'addedBy', label: 'Added By', kind: 'values', getValue: (r) => r.createdByUser?.username || r.createdByUser?.name || '' },
    ];
    if (process === 'cutter') {
      return [
        ...common,
        { id: 'qty', label: 'Qty', kind: 'number', getValue: (r) => r.count || 0 },
        { id: 'weight', label: 'Weight (kg)', kind: 'number', getValue: (r) => r.totalWeight || 0 },
        { id: 'takenBackWeight', label: 'Taken Back (kg)', kind: 'number', getValue: (r) => r.takenBackWeight || 0 },
        { id: 'netIssuedWeight', label: 'Net Issued (kg)', kind: 'number', getValue: (r) => r.netIssuedWeight ?? 0 },
        { id: 'wastageWeight', label: 'Wastage (kg)', kind: 'number', getValue: (r) => r.wastageWeight || 0 },
      ];
    }
    if (process === 'holo') {
      return [
        ...common,
        { id: 'metallicBobbins', label: 'Metallic Bobbins', kind: 'number', getValue: (r) => r.metallicBobbins || 0 },
        { id: 'metallicBobbinsWeight', label: 'Met. Bob. Wt (kg)', kind: 'number', getValue: (r) => r.metallicBobbinsWeight || 0 },
        { id: 'takenBackWeight', label: 'Taken Back (kg)', kind: 'number', getValue: (r) => r.takenBackWeight || 0 },
        { id: 'netIssuedWeight', label: 'Net Issued (kg)', kind: 'number', getValue: (r) => r.netIssuedWeight ?? 0 },
        { id: 'yarnKg', label: 'Yarn Wt (kg)', kind: 'number', getValue: (r) => r.yarnKg || 0 },
        { id: 'rollsProducedEstimate', label: 'Rolls Prod. Est.', kind: 'number', getValue: (r) => r.rollsProducedEstimate || 0 },
      ];
    }
    return [
      ...common,
      { id: 'coneType', label: 'Cone Type', kind: 'values', getValue: (r) => resolveConingConeTypeName(r) || '' },
      { id: 'perCone', label: 'Per Cone (g)', kind: 'number', getValue: (r) => r.requiredPerConeNetWeight || 0 },
      { id: 'rollsIssued', label: 'Rolls Issued', kind: 'number', getValue: (r) => (r.count || r.rollsIssued || 0) },
      { id: 'takenBackWeight', label: 'Taken Back (kg)', kind: 'number', getValue: (r) => r.takenBackWeight || 0 },
      { id: 'netIssuedWeight', label: 'Net Issued (kg)', kind: 'number', getValue: (r) => r.netIssuedWeight ?? 0 },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process, itemNameById, operatorNameById, machineNameById, db]);

  const v2DateFilter = sheetFilters?.date && sheetFilters.date.kind === 'date' ? sheetFilters.date : null;
  const v2DateFrom = v2DateFilter?.from || '';
  const v2DateTo = v2DateFilter?.to || '';
  const v2Filters = useMemo(() => {
    const out = [];
    for (const [field, f] of Object.entries(sheetFilters || {})) {
      if (!f || field === 'date') continue;
      if (f.kind === 'values') {
        const values = Array.isArray(f.selected) ? f.selected.map(String) : [];
        out.push({ field, op: 'in', values: values.length ? values : ['__NO_MATCH__'] });
      } else if (f.kind === 'text') {
        const value = String(f.query || '').trim();
        if (value) out.push({ field, op: 'contains', value });
      } else if (f.kind === 'number') {
        const min = f.min === '' || f.min == null ? null : Number(f.min);
        const max = f.max === '' || f.max == null ? null : Number(f.max);
        if (min != null || max != null) out.push({ field, op: 'between', min, max });
      }
    }
    return out;
  }, [sheetFilters]);

  const v2List = useV2PagedList({
    enabled: true,
    scopeKey: `issue-history:${process}`,
    fetchPage: ({ limit, page, search, dateFrom, dateTo, filters, order }) => (
      v2.getV2IssueTracking(process, {
        limit,
        page,
        search,
        dateFrom,
        dateTo,
        filters: JSON.stringify(filters || []),
        order,
      })
    ),
    limit: 50,
    search: debouncedSearchTerm,
    dateFrom: v2DateFrom,
    dateTo: v2DateTo,
    filters: v2Filters,
    order: sortOrder,
  });

  const v2TakeBackList = useV2CursorList({
    enabled: true,
    scopeKey: `take-back-history:${process}`,
    fetchPage: ({ limit, cursor, search, dateFrom, dateTo }) => (
      v2.getV2TakeBackHistory(process, {
        limit,
        cursor,
        search,
        dateFrom,
        dateTo,
      })
    ),
    limit: 50,
    search: debouncedSearchTerm,
    dateFrom: v2DateFrom,
    dateTo: v2DateTo,
  });

  useEffect(() => {
    const key = INVENTORY_INVALIDATION_KEYS.issueHistory(process);
    return subscribeInvalidation(key, () => {
      issueDetailCacheRef.current.clear();
      issueDetailInflightRef.current.clear();
      v2List.refresh();
      v2TakeBackList.refresh();
    });
  }, [process, subscribeInvalidation, v2List.refresh, v2TakeBackList.refresh]);

  const issues = v2List.items;
  const takeBacks = v2TakeBackList.items;
  const totals = useMemo(() => {
    const s = v2List.summary || {};
    if (process === 'cutter') {
      return {
        ...EMPTY_TOTALS,
        qty: Number(s.qty || 0),
        weight: Number(s.weight || 0),
        takenBackWeight: Number(s.takenBackWeight || 0),
        netIssuedWeight: Number(s.netIssuedWeight || 0),
      };
    }
    if (process === 'holo') {
      return {
        ...EMPTY_TOTALS,
        metallicBobbins: Number(s.metallicBobbins || 0),
        metallicBobbinsWeight: Number(s.metallicBobbinsWeight || 0),
        yarnKg: Number(s.yarnKg || 0),
        rollsProducedEstimate: Number(s.rollsProducedEstimate || 0),
        takenBackWeight: Number(s.takenBackWeight || 0),
        netIssuedWeight: Number(s.netIssuedWeight || 0),
      };
    }
    return {
      ...EMPTY_TOTALS,
      rollsIssued: Number(s.rollsIssued || 0),
      takenBackWeight: Number(s.takenBackWeight || 0),
      netIssuedWeight: Number(s.netIssuedWeight || 0),
    };
  }, [v2List.summary, process]);

  const takeBackLoadMoreRef = useInfiniteScrollSentinel({
    enabled: v2TakeBackList.hasMore && !v2TakeBackList.isLoading,
    onLoadMore: v2TakeBackList.loadMore,
    rootRef: takeBackScrollRef,
  });

  const [v2FacetsById, setV2FacetsById] = useState({});

  useEffect(() => {
    if (!openFilterId) return;
    const col = filterColumns.find(c => c.id === openFilterId);
    if (!col || col.kind !== 'values') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await v2.getV2IssueTrackingFacets(process, {
          search: debouncedSearchTerm,
          dateFrom: v2DateFrom,
          dateTo: v2DateTo,
          filters: JSON.stringify(v2Filters || []),
          excludeField: openFilterId,
        });
        const next = res?.facets?.[openFilterId];
        if (!cancelled && Array.isArray(next)) {
          setV2FacetsById((prev) => ({ ...(prev || {}), [openFilterId]: next }));
        }
      } catch (_) {
        // Ignore facet failures; filter still works via server-side filtering.
      }
    })();
    return () => { cancelled = true; };
  }, [openFilterId, process, debouncedSearchTerm, v2DateFrom, v2DateTo, v2Filters, filterColumns]);

  // Prefetch the most-used value facets so opening the filter doesn't briefly show "No data".
  useEffect(() => {
    let cancelled = false;
    const fields = process === 'cutter' ? ['item', 'cut', 'machine', 'operator'] : ['item', 'cut', 'yarn', 'twist', 'machine', 'operator', 'shift'];
    (async () => {
      try {
        const res = await Promise.all(fields.map(async (field) => {
          if (Array.isArray(v2FacetsById?.[field])) return null;
          const col = filterColumns.find(c => c.id === field);
          if (!col || col.kind !== 'values') return null;
          const out = await v2.getV2IssueTrackingFacets(process, {
            search: debouncedSearchTerm,
            dateFrom: v2DateFrom,
            dateTo: v2DateTo,
            filters: JSON.stringify(v2Filters || []),
            excludeField: field,
          });
          return { field, values: out?.facets?.[field] };
        }));
        if (cancelled) return;
        const patch = {};
        for (const item of res) {
          if (!item) continue;
          if (Array.isArray(item.values)) patch[item.field] = item.values;
        }
        if (Object.keys(patch).length) {
          setV2FacetsById((prev) => ({ ...(prev || {}), ...patch }));
        }
      } catch (_) { }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process, debouncedSearchTerm, v2DateFrom, v2DateTo, v2Filters, filterColumns]);

  const columnFor = (id) => {
    const col = filterColumns.find(c => c.id === id);
    if (!col) return col;
    if (col.kind !== 'values') return col;
    const facetOptions = v2FacetsById?.[id];
    return Array.isArray(facetOptions) && facetOptions.length > 0 ? { ...col, facetOptions } : col;
  };

  const getActions = (row) => {
    const isLoadingExactDetail = Boolean(issueActionLoadingId);
    const isLoadingThisRow = issueActionLoadingId === row.id;
    const actions = [
      {
        label: 'Edit',
        icon: isLoadingThisRow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit2 className="w-4 h-4" />,
        onClick: () => openIssueEditor(row),
        disabled: !canEdit || isLoadingExactDetail,
        disabledReason: !canEdit
          ? 'You do not have permission to edit issue records.'
          : 'Loading exact issue details.',
      },
      {
        label: 'Reprint',
        icon: <Printer className="w-4 h-4" />,
        onClick: () => handleReprint(row),
        disabled: isLoadingExactDetail,
        disabledReason: 'Loading exact issue details.',
      },
    ];

    // Add Print Small Stickers button for cutter process only
    if (process === 'cutter') {
      actions.push({
        label: 'Print Small Stickers',
        icon: <Printer className="w-4 h-4" />,
        onClick: () => handlePrintSmallSticker(row),
      });
    }

    // Revert wastage: cutter only, and only when this issue line has wastage marked.
    // Coning/holo wastage revert flows live elsewhere (see ConingReceiveForm and ReceiveHistoryTable).
    if (process === 'cutter' && Number(row?.wastageWeight || 0) > 0) {
      const pieceIds = parseIssuePieceIds(row);
      const targetPieceId = pieceIds.length === 1 ? pieceIds[0] : null;
      actions.push({
        label: 'Revert wastage',
        icon: <Undo2 className="w-4 h-4" />,
        onClick: () => setRevertTarget({ row, pieceId: targetPieceId }),
        disabled: !canEdit || !targetPieceId,
        disabledReason: !canEdit
          ? 'You do not have permission to revert wastage.'
          : 'Cannot identify a single piece for this issue.',
      });
    }

    actions.push({
      label: 'Delete',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => handleDelete(row.id),
      variant: 'destructive',
      disabled: deletingId === row.id || !canDelete,
      disabledReason: !canDelete
        ? 'You do not have permission to delete issue records.'
        : 'Deleting in progress.',
    });

    return actions;
  };

  const confirmRevertWastage = async ({ reason, note }) => {
    if (!revertTarget?.pieceId || revertBusy) return;
    setRevertBusy(true);
    try {
      await api.revertCutterWastage({ pieceId: revertTarget.pieceId, reason, note });
      setRevertTarget(null);
      await refreshProcessData('cutter');
      emitInvalidation(INVENTORY_INVALIDATION_KEYS.receiveHistory('cutter'), { source: 'revertCutterWastage', pieceId: revertTarget.pieceId });
    } catch (err) {
      alert(err.message || 'Failed to revert wastage');
    } finally {
      setRevertBusy(false);
    }
  };

  const handleExport = async () => {
    let sourceRows;
    try {
      const res = await v2.exportV2IssueTrackingJson(process, {
        search: debouncedSearchTerm,
        dateFrom: v2DateFrom,
        dateTo: v2DateTo,
        filters: JSON.stringify(v2Filters || []),
        order: sortOrder,
      });
      sourceRows = Array.isArray(res?.items) ? res.items : [];
    } catch (err) {
      alert(err?.message || 'Failed to export');
      return;
    }

    // Build export data with resolved names
    const exportData = sourceRows.map(r => {
      const baseData = {
        date: formatDateDDMMYYYY(r.date || r.createdAt),
        shift: r.shift || '—',
        itemName: r.itemName || itemNameById.get(r.itemId) || '—',
        machineName: r.machineName || machineNameById.get(r.machineId) || '—',
        operatorName: r.operatorName || operatorNameById.get(r.operatorId) || '—',
        barcode: r.barcode || r.id.substring(0, 8),
        note: r.note || '',
        takenBackWeight: formatKg(r.takenBackWeight || 0),
        netIssuedWeight: formatKg(r.netIssuedWeight ?? 0),
      };

      if (process === 'cutter') {
        const resolved = resolveCutterIssueDetails(r);
        return {
          ...baseData,
          pieceIds: Array.isArray(r.pieceIds) ? r.pieceIds.join(', ') : (r.pieceIds || ''),
          cut: resolved.cutName,
          yarn: resolved.yarnName,
          twist: resolved.twistName,
          qty: r.count || 0,
          weight: formatKg(r.totalWeight),
          wastageWeight: formatCutterWastageDisplay(r),
        };
      } else if (process === 'holo') {
        const resolved = resolveIssueTraceNames(r);
        return {
          ...baseData,
          lotNo: lotLabelFor(r),
          cut: resolved.cutName || '—',
          yarnName: resolved.yarnName || '—',
          twistName: resolved.twistName || '—',
          metallicBobbins: r.metallicBobbins || 0,
          metallicBobbinsWeight: formatKg(r.metallicBobbinsWeight),
          yarnKg: formatKg(r.yarnKg),
          rollsEst: r.rollsProducedEstimate || '',
        };
      } else {
        // Coning - resolve cut/yarn from referenced source rows
        const resolved = resolveIssueTraceNames(r);
        return {
          ...baseData,
          lotNo: lotLabelFor(r),
          cut: resolved.cutName,
          yarn: resolved.yarnName,
          twist: resolved.twistName,
          coneType: resolveConingConeTypeName(r) || '—',
          perConeNetG: Number.isFinite(Number(r.requiredPerConeNetWeight)) ? Number(r.requiredPerConeNetWeight) : '',
          rollsIssued: r.count || r.rollsIssued || 0,
        };
      }
    });

    // Define columns based on process
    let columns;
    if (process === 'cutter') {
      columns = [
        { key: 'date', header: 'Date' },
        { key: 'shift', header: 'Shift' },
        { key: 'itemName', header: 'Item' },
        { key: 'pieceIds', header: 'Piece IDs' },
        { key: 'cut', header: 'Cut' },
        { key: 'yarn', header: 'Yarn' },
        { key: 'twist', header: 'Twist' },
        { key: 'machineName', header: 'Machine' },
        { key: 'operatorName', header: 'Operator' },
        { key: 'qty', header: 'Qty' },
        { key: 'weight', header: 'Weight (kg)' },
        { key: 'takenBackWeight', header: 'Taken Back (kg)' },
        { key: 'netIssuedWeight', header: 'Net Issued (kg)' },
        { key: 'wastageWeight', header: 'Wastage (kg)' },
        { key: 'barcode', header: 'Barcode' },
        { key: 'note', header: 'Note' },
      ];
    } else if (process === 'holo') {
      columns = [
        { key: 'date', header: 'Date' },
        { key: 'shift', header: 'Shift' },
        { key: 'itemName', header: 'Item' },
        { key: 'lotNo', header: 'Lot' },
        { key: 'cut', header: 'Cut' },
        { key: 'yarnName', header: 'Yarn' },
        { key: 'twistName', header: 'Twist' },
        { key: 'machineName', header: 'Machine' },
        { key: 'operatorName', header: 'Operator' },
        { key: 'metallicBobbins', header: 'Metallic Bobbins' },
        { key: 'metallicBobbinsWeight', header: 'Met. Bob. Wt (kg)' },
        { key: 'takenBackWeight', header: 'Taken Back (kg)' },
        { key: 'netIssuedWeight', header: 'Net Issued (kg)' },
        { key: 'yarnKg', header: 'Yarn Wt (kg)' },
        { key: 'rollsEst', header: 'Rolls Est.' },
        { key: 'barcode', header: 'Barcode' },
        { key: 'note', header: 'Note' },
      ];
    } else {
      columns = [
        { key: 'date', header: 'Date' },
        { key: 'shift', header: 'Shift' },
        { key: 'itemName', header: 'Item' },
        { key: 'lotNo', header: 'Lot' },
        { key: 'cut', header: 'Cut' },
        { key: 'yarn', header: 'Yarn' },
        { key: 'twist', header: 'Twist' },
        { key: 'coneType', header: 'Cone Type' },
        { key: 'perConeNetG', header: 'Per Cone (g)' },
        { key: 'machineName', header: 'Machine' },
        { key: 'operatorName', header: 'Operator' },
        { key: 'rollsIssued', header: 'Rolls Issued' },
        { key: 'takenBackWeight', header: 'Taken Back (kg)' },
        { key: 'netIssuedWeight', header: 'Net Issued (kg)' },
        { key: 'barcode', header: 'Barcode' },
        { key: 'note', header: 'Note' },
      ];
    }

    const today = new Date().toISOString().split('T')[0];
    exportHistoryToExcel(exportData, columns, `issue-history-${process}-${today}`);
  };

  const emptyColSpan = process === 'cutter' ? 16 : process === 'holo' ? 19 : 18;

  const cutterEditTotals = useMemo(() => {
    if (!issueDraft || process !== 'cutter') return null;
    const pieces = (issueDraft.pieceIds || [])
      .map(id => (db.inbound_items || []).find(p => p.id === id))
      .filter(Boolean);
    const itemId = pieces[0]?.itemId || '';
    const lotNo = pieces[0]?.lotNo || '';
    const totalWeight = pieces.reduce((sum, p) => sum + Number(p.weight || 0), 0);
    return {
      count: issueDraft.pieceIds?.length || 0,
      totalWeight,
      itemName: itemNameById.get(itemId) || '',
      lotNo,
    };
  }, [issueDraft, process, db.inbound_items, itemNameById]);

  const holoEditTotals = useMemo(() => {
    if (!issueDraft || process !== 'holo') return null;
    const totalBobbins = (issueDraft.crates || []).reduce((sum, c) => sum + Number(c.issuedBobbins || 0), 0);
    const totalWeight = (issueDraft.crates || []).reduce((sum, c) => sum + Number(c.issuedBobbinWeight || 0), 0);
    const itemId = issueDraft.crates?.[0]?.itemId || '';
    const lotNo = formatMixedLotLabel((issueDraft.crates || []).map(c => c.lotNo));
    return {
      totalBobbins,
      totalWeight,
      itemName: itemNameById.get(itemId) || '',
      lotNo,
    };
  }, [issueDraft, process, itemNameById]);

  const coningEditTotals = useMemo(() => {
    if (!issueDraft || process !== 'coning') return null;
    const totalRolls = (issueDraft.crates || []).reduce((sum, c) => sum + Number(c.issueRolls || 0), 0);
    const totalWeight = (issueDraft.crates || []).reduce((sum, c) => sum + Number(c.issueWeight || 0), 0);
    const target = Number(issueDraft.requiredPerConeNetWeight || 0);
    const expectedCones = target > 0 ? Math.floor((totalWeight * 1000) / target) : 0;
    const itemId = issueDraft.crates?.[0]?.itemId || '';
    const lotNo = formatMixedLotLabel((issueDraft.crates || []).map(c => c.lotNo));
    return {
      totalRolls,
      totalWeight,
      expectedCones,
      itemName: itemNameById.get(itemId) || '',
      lotNo,
    };
  }, [issueDraft, process, itemNameById]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-stretch sm:flex-row sm:items-center gap-3 bg-muted/30 p-3 rounded-lg border">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search across all columns..."
            className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-8 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <TableResultCount
          shown={issues.length}
          total={v2List.totalCount}
          rangeStart={v2List.rangeStart}
          isLoading={v2List.isLoading}
          className="self-center"
        />
        <button
          onClick={handleExport}
          className="h-9 px-3 rounded-md border border-primary bg-primary text-primary-foreground text-xs hover:bg-primary/90 font-medium flex items-center gap-1"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      <div ref={scrollRootRef} className="hidden sm:block rounded-md border max-h-[calc(100vh-280px)] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {process === 'cutter' && (
                <>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <SortToggle label="Date" order={sortOrder} onToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} />
                      <SheetColumnFilter column={columnFor('date')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Shift</span>
                      <SheetColumnFilter column={columnFor('shift')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Item</span>
                      <SheetColumnFilter column={columnFor('item')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Piece</span>
                      <SheetColumnFilter column={columnFor('lotOrPiece')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cut</span>
                      <SheetColumnFilter column={columnFor('cut')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>

                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Machine</span>
                      <SheetColumnFilter column={columnFor('machine')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Operator</span>
                      <SheetColumnFilter column={columnFor('operator')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Qty</span>
                      <SheetColumnFilter column={columnFor('qty')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Weight (kg)</span>
                      <SheetColumnFilter column={columnFor('weight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Taken Back (kg)</span>
                      <SheetColumnFilter column={columnFor('takenBackWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Net Issued (kg)</span>
                      <SheetColumnFilter column={columnFor('netIssuedWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Wastage (kg)</span>
                      <SheetColumnFilter column={columnFor('wastageWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Barcode</span>
                      <SheetColumnFilter column={columnFor('barcode')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Note</span>
                      <SheetColumnFilter column={columnFor('note')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Added By</span>
                      <SheetColumnFilter column={columnFor('addedBy')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
              {process === 'holo' && (
                <>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <SortToggle label="Date" order={sortOrder} onToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} />
                      <SheetColumnFilter column={columnFor('date')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Shift</span>
                      <SheetColumnFilter column={columnFor('shift')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Item</span>
                      <SheetColumnFilter column={columnFor('item')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Lot</span>
                      <SheetColumnFilter column={columnFor('lotOrPiece')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cut</span>
                      <SheetColumnFilter column={columnFor('cut')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Yarn</span>
                      <SheetColumnFilter column={columnFor('yarn')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Twist</span>
                      <SheetColumnFilter column={columnFor('twist')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Machine</span>
                      <SheetColumnFilter column={columnFor('machine')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Operator</span>
                      <SheetColumnFilter column={columnFor('operator')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Metallic Bobbins</span>
                      <SheetColumnFilter column={columnFor('metallicBobbins')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Met. Bob. Wt (kg)</span>
                      <SheetColumnFilter column={columnFor('metallicBobbinsWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Taken Back (kg)</span>
                      <SheetColumnFilter column={columnFor('takenBackWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Net Issued (kg)</span>
                      <SheetColumnFilter column={columnFor('netIssuedWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Yarn Wt (kg)</span>
                      <SheetColumnFilter column={columnFor('yarnKg')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Rolls Prod. Est.</span>
                      <SheetColumnFilter column={columnFor('rollsProducedEstimate')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Barcode</span>
                      <SheetColumnFilter column={columnFor('barcode')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Note</span>
                      <SheetColumnFilter column={columnFor('note')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Added By</span>
                      <SheetColumnFilter column={columnFor('addedBy')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
              {process === 'coning' && (
                <>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <SortToggle label="Date" order={sortOrder} onToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} />
                      <SheetColumnFilter column={columnFor('date')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Shift</span>
                      <SheetColumnFilter column={columnFor('shift')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Item</span>
                      <SheetColumnFilter column={columnFor('item')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Lot</span>
                      <SheetColumnFilter column={columnFor('lotOrPiece')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cut</span>
                      <SheetColumnFilter column={columnFor('cut')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Yarn</span>
                      <SheetColumnFilter column={columnFor('yarn')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Twist</span>
                      <SheetColumnFilter column={columnFor('twist')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Machine</span>
                      <SheetColumnFilter column={columnFor('machine')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Operator</span>
                      <SheetColumnFilter column={columnFor('operator')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cone Type</span>
                      <SheetColumnFilter column={columnFor('coneType')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Per Cone (g)</span>
                      <SheetColumnFilter column={columnFor('perCone')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Rolls Issued</span>
                      <SheetColumnFilter column={columnFor('rollsIssued')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Taken Back (kg)</span>
                      <SheetColumnFilter column={columnFor('takenBackWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="whitespace-nowrap">Net Issued (kg)</span>
                      <SheetColumnFilter column={columnFor('netIssuedWeight')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Barcode</span>
                      <SheetColumnFilter column={columnFor('barcode')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Note</span>
                      <SheetColumnFilter column={columnFor('note')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Added By</span>
                      <SheetColumnFilter column={columnFor('addedBy')} rows={issues} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.length === 0 ? (
              <TableStateRow
                colSpan={emptyColSpan}
                isLoading={v2List.isLoading}
                error={v2List.error}
                onRetry={v2List.refresh}
                emptyMessage={`No issue records found for ${process}.`}
              />
            ) : (
              <>
                {issues.map((r) => {
                  const resolved = resolveIssueTraceNames(r);
                  const itemDisplay = r.itemName || itemNameById.get(r.itemId) || '—';
                  return (
                    <TableRow key={r.id}>
                      {process === 'cutter' && (
                        <>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(r.date)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={r.shift || '—'} query={searchTerm} /></TableCell>
                          <TableCell><CellText text={itemDisplay} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[150px] truncate" title={r.pieceIds || ''}><HighlightMatch text={r.pieceIds || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.cutName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><CellText text={machineNameById.get(r.machineId)} query={searchTerm} max="sm" /></TableCell>
                          <TableCell><CellText text={operatorNameById.get(r.operatorId)} query={searchTerm} max="sm" /></TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{r.count}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.totalWeight)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.takenBackWeight || 0)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.netIssuedWeight ?? r.totalWeight ?? 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{renderCutterWastageCell(r)}</TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap"><HighlightMatch text={r.barcode || r.id.substring(0, 8)} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[200px] truncate" title={r.note || ''}><HighlightMatch text={r.note || '—'} query={searchTerm} /></TableCell>
                          <TableCell>
                            <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                          </TableCell>
                        </>
                      )}
                      {process === 'holo' && (
                        <>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(r.date)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={r.shift || '—'} query={searchTerm} /></TableCell>
                          <TableCell><CellText text={itemDisplay} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={lotLabelFor(r) || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.cutName || '—'} query={searchTerm} /></TableCell>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={resolved.yarnName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.twistName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><CellText text={machineNameById.get(r.machineId)} query={searchTerm} max="sm" /></TableCell>
                          <TableCell><CellText text={operatorNameById.get(r.operatorId)} query={searchTerm} max="sm" /></TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{r.metallicBobbins || 0}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.metallicBobbinsWeight)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.takenBackWeight || 0)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.netIssuedWeight ?? r.metallicBobbinsWeight ?? 0)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.yarnKg)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{r.rollsProducedEstimate || '—'}</TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap"><HighlightMatch text={r.barcode || r.id.substring(0, 8)} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[200px] truncate" title={r.note || ''}><HighlightMatch text={r.note || '—'} query={searchTerm} /></TableCell>
                          <TableCell>
                            <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                          </TableCell>
                        </>
                      )}
                      {process === 'coning' && (
                        <>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(r.date)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={r.shift || '—'} query={searchTerm} /></TableCell>
                          <TableCell><CellText text={itemDisplay} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={lotLabelFor(r) || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.cutName || '—'} query={searchTerm} /></TableCell>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={resolved.yarnName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.twistName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><CellText text={machineNameById.get(r.machineId)} query={searchTerm} max="sm" /></TableCell>
                          <TableCell><CellText text={operatorNameById.get(r.operatorId)} query={searchTerm} max="sm" /></TableCell>
                          <TableCell><CellText text={r.coneTypeName || resolveConingConeTypeName(r) || '—'} query={searchTerm} max="sm" /></TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatPerConeNet((r.perConeTargetG ?? r.requiredPerConeNetWeight))}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{r.count || r.rollsIssued || 0}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.takenBackWeight || 0)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKg(r.netIssuedWeight ?? 0)}</TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap"><HighlightMatch text={r.barcode || r.id.substring(0, 8)} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[200px] truncate" title={r.note || ''}><HighlightMatch text={r.note || '—'} query={searchTerm} /></TableCell>
                          <TableCell>
                            <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <ActionMenu actions={getActions(r)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="hidden sm:flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-sm font-semibold">Grand Total (filtered)</span>
        <div className="flex flex-wrap items-center justify-end gap-4 text-xs sm:text-sm">
          {process === 'cutter' && (
            <>
              <span className="font-medium">Qty: {totals.qty}</span>
              <span className="font-medium">Weight: {formatKg(totals.weight)}</span>
              <span className="font-medium text-amber-600">Taken Back: {formatKg(totals.takenBackWeight)}</span>
              <span className="font-medium">Net Issued: {formatKg(totals.netIssuedWeight)}</span>
            </>
          )}
          {process === 'holo' && (
            <>
              <span className="font-medium">Metallic Bobbins: {totals.metallicBobbins}</span>
              <span className="font-medium">Met. Bob. Wt: {formatKg(totals.metallicBobbinsWeight)}</span>
              <span className="font-medium text-amber-600">Taken Back: {formatKg(totals.takenBackWeight)}</span>
              <span className="font-medium">Net Issued: {formatKg(totals.netIssuedWeight)}</span>
              <span className="font-medium">Yarn Wt: {formatKg(totals.yarnKg)}</span>
              <span className="font-medium">Rolls Prod. Est.: {Math.round(totals.rollsProducedEstimate) || 0}</span>
            </>
          )}
          {process === 'coning' && (
            <>
              <span className="font-medium">Rolls Issued: {totals.rollsIssued}</span>
              <span className="font-medium text-amber-600">Taken Back: {formatKg(totals.takenBackWeight)}</span>
              <span className="font-medium">Net Issued: {formatKg(totals.netIssuedWeight)}</span>
            </>
          )}
        </div>
      </div>
      <TablePagination
        page={v2List.page}
        totalPages={v2List.totalPages}
        hasMore={v2List.hasMore}
        onPageChange={v2List.setPage}
        isLoading={v2List.isLoading}
        className="hidden sm:flex"
      />

      {/* Mobile Card View */}
      <div className="block sm:hidden space-y-3">
        {issues.length === 0 ? (
          <ListState
            className="border rounded-lg bg-card"
            isLoading={v2List.isLoading}
            error={v2List.error}
            onRetry={v2List.refresh}
            emptyMessage={`No issue records found for ${process}.`}
          />
        ) : (
          issues.map((r) => {
            const pieceDisplay = Array.isArray(r.pieceIds) ? r.pieceIds.join(', ') : (r.pieceIds || lotLabelFor(r) || '—');
            const resolved = resolveIssueTraceNames(r);
            return (
              <div key={r.id} className="border rounded-lg p-4 bg-card shadow-sm">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate" title={pieceDisplay}>{pieceDisplay}</p>
                    <p className="text-sm text-muted-foreground">
                      {machineNameById.get(r.machineId)} • {operatorNameById.get(r.operatorId)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDateDDMMYYYY(r.date)}{r.shift ? ` (${r.shift})` : ''} • {itemNameById.get(r.itemId)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Cut: {resolved.cutName || '—'}{process !== 'cutter' && (<> • Yarn: {resolved.yarnName || '—'} • Twist: {resolved.twistName || '—'}</>)}
                    </p>
                    {process === 'coning' && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Cone: {resolveConingConeTypeName(r) || '—'} • Per Cone: {formatPerConeNet(r.requiredPerConeNetWeight)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Taken Back: {formatKg(r.takenBackWeight || 0)} • Net Issued: {formatKg(r.netIssuedWeight ?? (process === 'cutter' ? r.totalWeight : process === 'holo' ? r.metallicBobbinsWeight : 0))}{process === 'cutter' ? ` • Wastage: ${formatCutterWastageDisplay(r)}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="whitespace-nowrap">
                    {process === 'cutter' ? formatKg(r.totalWeight) : (r.count || r.rollsIssued || r.metallicBobbins || 0)}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">{r.barcode || r.id.substring(0, 8)}</span>
                  <ActionMenu actions={getActions(r)} />
                </div>
              </div>
            );
          })
        )}
      </div>
      <TablePagination
        page={v2List.page}
        totalPages={v2List.totalPages}
        hasMore={v2List.hasMore}
        onPageChange={v2List.setPage}
        isLoading={v2List.isLoading}
        className="sm:hidden"
      />

      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/30 text-sm font-semibold">Take-Back Ledger</div>
        <div ref={takeBackScrollRef} className="max-h-[260px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Added By</TableHead>
                <TableHead className="w-[80px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {takeBacks.length === 0 ? (
                <TableStateRow
                  colSpan={11}
                  isLoading={v2TakeBackList.isLoading}
                  error={v2TakeBackList.error}
                  onRetry={v2TakeBackList.refresh}
                  emptyMessage={`No take-back entries for ${process}.`}
                />
              ) : (
                takeBacks.map((tb) => {
                  const isActiveOriginal = !tb.isReverse && !tb.isReversed;
                  const typeLabel = tb.isReverse ? 'Reverse' : (tb.isReversed ? 'Take Back (Reversed)' : 'Take Back');
                  const displayBarcode = tb.issueBarcode || '';
                  const displayLot = tb.issueLotNo || '';
                  const displayItem = tb.itemName || '';
                  return (
                    <TableRow key={tb.id}>
                      <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(tb.date || tb.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={tb.isReverse ? 'secondary' : tb.isReversed ? 'outline' : 'default'}>
                          {typeLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{displayBarcode}</TableCell>
                      <TableCell>{displayLot}</TableCell>
                      <TableCell>{displayItem}</TableCell>
                      <TableCell className="text-right">{Number(tb.totalCount || 0)}</TableCell>
                      <TableCell className="text-right">{formatKg(tb.totalWeight || 0)}</TableCell>
                      <TableCell className="max-w-[180px] truncate" title={tb.reason || ''}>{tb.reason || '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={tb.note || ''}>{tb.note || '—'}</TableCell>
                      <TableCell>
                        <UserBadge user={tb.createdByUser} timestamp={tb.createdAt} />
                      </TableCell>
                      <TableCell>
                        {isActiveOriginal ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReverseTakeBack(tb)}
                            disabled={!canDelete || reversingTakeBackId === tb.id}
                          >
                            {reversingTakeBackId === tb.id ? '...' : 'Reverse'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div ref={takeBackLoadMoreRef} style={{ height: 1 }} aria-hidden="true" />
        </div>
      </div>

      <Dialog open={Boolean(editingIssue)} onOpenChange={(open) => { if (!open) closeIssueEditor(); }}>
        <DialogContent
          title={`Edit ${process === 'cutter' ? 'Cutter' : process === 'holo' ? 'Holo' : 'Coning'} Issue`}
          className="max-w-4xl max-h-[80vh] overflow-y-auto"
          onOpenChange={(open) => { if (!open) closeIssueEditor(); }}
        >
          {editingIssue && issueDraft && (
            <div className="space-y-4">
              {editingIssue.hasReceives && (
                <div className="text-xs text-amber-600">
                  Receives exist for this issue. Piece/crate changes are locked.
                </div>
              )}

              {process === 'cutter' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Date</label>
                      <Input
                        type="date"
                        value={issueDraft.date}
                        onChange={(e) => updateIssueDraftField('date', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Machine</label>
                      <Select
                        value={issueDraft.machineId}
                        onChange={(e) => updateIssueDraftField('machineId', e.target.value)}
                        options={(db.machines || []).filter(m => m.processType === 'all' || m.processType === 'cutter').map(m => ({ id: m.id, name: m.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Machine"
                        clearable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Operator</label>
                      <Select
                        value={issueDraft.operatorId}
                        onChange={(e) => updateIssueDraftField('operatorId', e.target.value)}
                        options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'cutter').map(o => ({ id: o.id, name: o.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Operator"
                        clearable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Cut</label>
                      <Select
                        value={issueDraft.cutId}
                        onChange={(e) => updateIssueDraftField('cutId', e.target.value)}
                        options={(db.cuts || []).map(c => ({ id: c.id, name: c.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Cut"
                        clearable
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Note</label>
                      <Input
                        value={issueDraft.note}
                        onChange={(e) => updateIssueDraftField('note', e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Add Piece</label>
                        <Input
                          value={issueScanInput}
                          onChange={(e) => setIssueScanInput(e.target.value)}
                          placeholder="Piece ID or Barcode"
                          disabled={editingIssue.hasReceives}
                        />
                      </div>
                      <Button
                        onClick={handleAddPiece}
                        disabled={editingIssue.hasReceives}
                        className="h-9"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Item: {cutterEditTotals?.itemName || '—'} • Lot: {cutterEditTotals?.lotNo || '—'} • Pieces: {cutterEditTotals?.count || 0} • Weight: {formatKg(cutterEditTotals?.totalWeight || 0)}
                    </div>
                    <div className="border rounded-md p-2 max-h-48 overflow-auto space-y-2">
                      {(issueDraft.pieceIds || []).length === 0 ? (
                        <div className="text-xs text-muted-foreground">No pieces selected.</div>
                      ) : (
                        issueDraft.pieceIds.map(pid => (
                          <div key={pid} className="flex items-center justify-between border rounded px-2 py-1 text-sm">
                            <span className="font-mono">{pid}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemovePiece(pid)}
                              disabled={editingIssue.hasReceives}
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {process === 'holo' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Date</label>
                      <Input
                        type="date"
                        value={issueDraft.date}
                        onChange={(e) => updateIssueDraftField('date', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Machine</label>
                      <Select
                        value={issueDraft.machineId}
                        onChange={(e) => updateIssueDraftField('machineId', e.target.value)}
                        options={(db.machines || []).filter(m => m.processType === 'all' || m.processType === 'holo').map(m => ({ id: m.id, name: m.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Machine"
                        clearable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Operator</label>
                      <Select
                        value={issueDraft.operatorId}
                        onChange={(e) => updateIssueDraftField('operatorId', e.target.value)}
                        options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'holo').map(o => ({ id: o.id, name: o.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Operator"
                        clearable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Shift</label>
                      <Select
                        value={issueDraft.shift}
                        onChange={(e) => updateIssueDraftField('shift', e.target.value)}
                        options={[{ value: 'Day', label: 'Day' }, { value: 'Night', label: 'Night' }]}
                        placeholder="Select Shift"
                        clearable
                        searchable={false}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Yarn</label>
                      <Select
                        value={issueDraft.yarnId}
                        onChange={(e) => updateIssueDraftField('yarnId', e.target.value)}
                        options={(db.yarns || []).map(y => ({ id: y.id, name: y.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Yarn"
                        clearable
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Twist</label>
                      <Select
                        value={issueDraft.twistId}
                        onChange={(e) => updateIssueDraftField('twistId', e.target.value)}
                        options={(db.twists || []).map(t => ({ id: t.id, name: t.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Twist"
                        clearable
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Yarn Kg</label>
                      <Input
                        type="number"
                        value={issueDraft.yarnKg}
                        onChange={(e) => updateIssueDraftField('yarnKg', e.target.value)}
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Rolls Est.</label>
                      <Input
                        type="number"
                        value={issueDraft.rollsProducedEstimate}
                        onChange={(e) => updateIssueDraftField('rollsProducedEstimate', e.target.value)}
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Note</label>
                      <Input
                        value={issueDraft.note}
                        onChange={(e) => updateIssueDraftField('note', e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {editingIssue.sourcesTruncated ? (
                      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        This issue has more than 200 source rows. Source allocation editing is disabled, but issue details can still be updated safely.
                      </div>
                    ) : null}
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Add Crate</label>
                        <Input
                          value={issueScanInput}
                          onChange={(e) => setIssueScanInput(e.target.value)}
                          placeholder="Scan Cutter Receive Barcode"
                          disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated || issueScanLoading}
                        />
                      </div>
                      <Button
                        onClick={handleAddHoloCrate}
                        disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated || issueScanLoading}
                        className="h-9"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {issueScanLoading ? 'Adding...' : 'Add'}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Lot: {holoEditTotals?.lotNo || lotLabelFor(editingIssue)} • Bobbins: {holoEditTotals?.totalBobbins || 0} • Weight: {formatKg(holoEditTotals?.totalWeight || 0)}
                    </div>
                    <div className="border rounded-md p-2 max-h-60 overflow-auto space-y-2">
                      {(issueDraft.crates || []).length === 0 ? (
                        <div className="text-xs text-muted-foreground">No crates selected.</div>
                      ) : (
                        issueDraft.crates.map((crate) => (
                          <div key={crate.rowId} className="border rounded p-2 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="font-mono">Barcode {crate.barcode || crate.rowId}</span>
                              {crate.pieceId ? <span>Piece {crate.pieceId}</span> : null}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Bobbins</label>
                                <Input
                                  type="number"
                                  value={crate.issuedBobbins}
                                  onChange={(e) => updateHoloCrate(crate.rowId, 'issuedBobbins', e.target.value)}
                                  disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Weight (kg)</label>
                                <Input
                                  type="number"
                                  value={crate.issuedBobbinWeight}
                                  readOnly
                                  disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated}
                                  className="bg-muted"
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveHoloCrate(crate.rowId)}
                                  disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {process === 'coning' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Date</label>
                      <Input
                        type="date"
                        value={issueDraft.date}
                        onChange={(e) => updateIssueDraftField('date', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Machine</label>
                      <Select
                        value={issueDraft.machineId}
                        onChange={(e) => updateIssueDraftField('machineId', e.target.value)}
                        options={(db.machines || []).filter(m => m.processType === 'all' || m.processType === 'coning').map(m => ({ id: m.id, name: m.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Machine"
                        clearable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Operator</label>
                      <Select
                        value={issueDraft.operatorId}
                        onChange={(e) => updateIssueDraftField('operatorId', e.target.value)}
                        options={(db.operators || []).filter(o => o.processType === 'all' || o.processType === 'coning').map(o => ({ id: o.id, name: o.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Operator"
                        clearable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Shift</label>
                      <Select
                        value={issueDraft.shift}
                        onChange={(e) => updateIssueDraftField('shift', e.target.value)}
                        options={[{ value: 'Day', label: 'Day' }, { value: 'Night', label: 'Night' }]}
                        placeholder="Select Shift"
                        clearable
                        searchable={false}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Cone Type</label>
                      <Select
                        value={issueDraft.coneTypeId}
                        onChange={(e) => updateIssueDraftField('coneTypeId', e.target.value)}
                        options={(db.cone_types || []).map(c => ({ id: c.id, name: c.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Cone Type"
                        clearable
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Wrapper</label>
                      <Select
                        value={issueDraft.wrapperId}
                        onChange={(e) => updateIssueDraftField('wrapperId', e.target.value)}
                        options={(db.wrappers || []).map(w => ({ id: w.id, name: w.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Wrapper"
                        clearable
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Box</label>
                      <Select
                        value={issueDraft.boxId}
                        onChange={(e) => updateIssueDraftField('boxId', e.target.value)}
                        options={(db.boxes || []).filter(b => b.processType === 'all' || b.processType === 'coning').map(b => ({ id: b.id, name: b.name }))}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Box"
                        clearable
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Target Cone (g)</label>
                      <Input
                        type="number"
                        value={issueDraft.requiredPerConeNetWeight}
                        onChange={(e) => updateIssueDraftField('requiredPerConeNetWeight', e.target.value)}
                        disabled={editingIssue.hasReceives}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-muted-foreground uppercase">Note</label>
                      <Input
                        value={issueDraft.note}
                        onChange={(e) => updateIssueDraftField('note', e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {editingIssue.sourcesTruncated ? (
                      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        This issue has more than 200 source rows. Source allocation editing is disabled, but issue details can still be updated safely.
                      </div>
                    ) : null}
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Add Crate</label>
                        <Input
                          value={issueScanInput}
                          onChange={(e) => setIssueScanInput(e.target.value)}
                          placeholder="Scan Holo/Coning Receive Barcode"
                          disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated || issueScanLoading}
                        />
                      </div>
                      <Button
                        onClick={handleAddConingCrate}
                        disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated || issueScanLoading}
                        className="h-9"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {issueScanLoading ? 'Adding...' : 'Add'}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Lot: {coningEditTotals?.lotNo || lotLabelFor(editingIssue)} • Rolls: {coningEditTotals?.totalRolls || 0} • Weight: {formatKg(coningEditTotals?.totalWeight || 0)} • Expected Cones: {coningEditTotals?.expectedCones || 0}
                    </div>
                    <div className="border rounded-md p-2 max-h-60 overflow-auto space-y-2">
                      {(issueDraft.crates || []).length === 0 ? (
                        <div className="text-xs text-muted-foreground">No crates selected.</div>
                      ) : (
                        issueDraft.crates.map((crate) => (
                          <div key={crate.rowId} className="border rounded p-2 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="font-mono">Barcode {crate.barcode || crate.rowId}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Rolls</label>
                                <Input
                                  type="number"
                                  value={crate.issueRolls}
                                  onChange={(e) => updateConingCrate(crate.rowId, 'issueRolls', e.target.value)}
                                  disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Weight (kg)</label>
                                <Input
                                  type="number"
                                  value={crate.issueWeight}
                                  onChange={(e) => updateConingCrate(crate.rowId, 'issueWeight', e.target.value)}
                                  disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated}
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveConingCrate(crate.rowId)}
                                  disabled={editingIssue.hasReceives || editingIssue.sourcesTruncated}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="ghost" onClick={closeIssueEditor} disabled={savingIssue}>
                  Cancel
                </Button>
                <Button onClick={handleSaveIssueEdits} disabled={savingIssue}>
                  {savingIssue ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <WastageNoteDialog
        open={!!revertTarget}
        onOpenChange={(open) => { if (!open) setRevertTarget(null); }}
        mode="revert"
        stage="cutter"
        contextLine={revertTarget ? `Piece ${revertTarget.pieceId || '—'} • Issue ${revertTarget.row?.barcode || revertTarget.row?.id || ''}` : ''}
        weight={Number(revertTarget?.row?.wastageWeight || 0)}
        busy={revertBusy}
        onConfirm={confirmRevertWastage}
      />
    </div>
  );
}
