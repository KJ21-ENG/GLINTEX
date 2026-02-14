import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { formatKg, formatDateDDMMYYYY } from '../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, ActionMenu, Button, Input, Select } from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { Trash2, Printer, Download, Edit2, Plus, Search, X } from 'lucide-react';
import * as api from '../api';
import { HighlightMatch } from '../components/common/HighlightMatch';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate, printStageTemplatesBatch } from '../utils/labelPrint';
import { exportHistoryToExcel } from '../services';
import { buildConingTraceContext, resolveConingTrace } from '../utils/coningTrace';
import { buildHoloTraceContext, resolveHoloTrace } from '../utils/holoTrace';
import { UserBadge } from '../components/common/UserBadge';
import { SheetColumnFilter, applySheetFilters } from '../components/common/SheetColumnFilters';
import { getFeatureFlags } from '../utils/featureFlags';
import { useV2CursorList } from '../hooks/useV2CursorList';
import { useInfiniteScrollSentinel } from '../hooks/useInfiniteScrollSentinel';
import * as v2 from '../api/v2';

export function IssueHistory({ db, canEdit = false, canDelete = false }) {
  const { process, patchIssueRecord, refreshProcessData, reverseIssueTakeBack } = useInventory();
  const flags = getFeatureFlags();
  const v2Enabled = flags.v2IssueTracking;
  const [deletingId, setDeletingId] = useState(null);
  const [reversingTakeBackId, setReversingTakeBackId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sheetFilters, setSheetFilters] = useState({});
  const [openFilterId, setOpenFilterId] = useState(null);
  const [editingIssue, setEditingIssue] = useState(null);
  const [issueDraft, setIssueDraft] = useState(null);
  const [issueScanInput, setIssueScanInput] = useState('');
  const scrollRootRef = useRef(null);
  const [savingIssue, setSavingIssue] = useState(false);
  const traceContext = useMemo(() => (v2Enabled ? null : buildConingTraceContext(db)), [db, v2Enabled]);
  const holoTraceContext = useMemo(() => (v2Enabled ? null : buildHoloTraceContext(db)), [db, v2Enabled]);
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
  const toTimeMs = (value) => {
    const ms = new Date(value || 0).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const cutterIssueTimelineByPiece = useMemo(() => {
    if (v2Enabled) return new Map();
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
    // v2 list rows are expected to be pre-flattened; avoid heavy tracing during render.
    if (v2Enabled) {
      return {
        itemName: pickName(row.itemName, ''),
        cutName: pickName(row.cutName, ''),
        yarnName: pickName(row.yarnName, ''),
        twistName: pickName(row.twistName, ''),
      };
    }

    if (process === 'holo') {
      if (!holoTraceContext) return { itemName: '—', cutName: '—', yarnName: '—', twistName: '—' };
      const resolved = resolveHoloTrace(row, holoTraceContext);
      return {
        itemName: pickName(db.items?.find(i => i.id === row.itemId)?.name, ''),
        cutName: pickName(resolved?.cutName, ''),
        yarnName: pickName(resolved?.yarnName, ''),
        twistName: pickName(resolved?.twistName, ''),
      };
    }

    if (process === 'coning') {
      if (!traceContext) return { itemName: '—', cutName: '—', yarnName: '—', twistName: '—' };
      const resolved = resolveConingTrace(row, traceContext);
      return {
        itemName: pickName(db.items?.find(i => i.id === row.itemId)?.name, ''),
        cutName: pickName(resolved?.cutName, ''),
        yarnName: pickName(resolved?.yarnName, ''),
        twistName: pickName(resolved?.twistName, ''),
      };
    }

    // cutter doesn't have yarn/twist (use placeholders for parity).
    return {
      itemName: pickName(db.items?.find(i => i.id === row.itemId)?.name, ''),
      cutName: pickName(db.cuts?.find(c => c.id === row.cutId)?.name, ''),
      yarnName: '—',
      twistName: '—',
    };
  };

  const formatPerConeNet = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '—';
    return `${num} g`;
  };

  const handleDelete = async (issueId) => {
    if (!canDelete) return;
    if (!confirm('Are you sure you want to delete this issue record? This will make the pieces available again for re-issuing.')) {
      return;
    }
    setDeletingId(issueId);
    try {
      await api.deleteIssueToMachine(issueId, process);
      if (!v2Enabled) {
        await refreshProcessData(process);
      } else {
        v2List.refresh();
      }
      alert('Issue record deleted.');
    } catch (err) {
      alert(err.message || 'Failed to delete issue record');
    } finally {
      setDeletingId(null);
    }
  };

  const getIssueHasReceives = (row) => {
    if (v2Enabled && typeof row?.hasReceives === 'boolean') return row.hasReceives;
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
    if (process === 'holo') {
      return (db.receive_from_holo_machine_rows || [])
        .some(r => !r.isDeleted && r.issueId === row.id);
    }
    return (db.receive_from_coning_machine_rows || [])
      .some(r => !r.isDeleted && r.issueId === row.id);
  };

  const openIssueEditor = (row) => {
    if (!row) return;
    const hasReceives = getIssueHasReceives(row);
    setEditingIssue({ ...row, hasReceives });
    setIssueScanInput('');

    if (process === 'cutter') {
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

    if (process === 'holo') {
      const refs = parseIssueRefs(row);
      const crates = refs.map((ref) => {
        const cutterRow = db.receive_from_cutter_machine_rows?.find(r => r.id === ref.rowId);
        const pieceId = cutterRow?.pieceId || ref.pieceId || '';
        const piece = db.inbound_items?.find(p => p.id === pieceId);
        const bobbinQty = Number(cutterRow?.bobbinQuantity || 0);
        const unitWeight = bobbinQty > 0 ? Number(cutterRow?.netWt || 0) / bobbinQty : null;
        return {
          rowId: ref.rowId,
          barcode: cutterRow?.barcode || '',
          pieceId,
          itemId: piece?.itemId || '',
          lotNo: piece?.lotNo || '',
          issuedBobbins: Number(ref.issuedBobbins || 0),
          issuedBobbinWeight: Number(ref.issuedBobbinWeight || 0),
          unitWeight,
        };
      });

      setIssueDraft({
        date: formatInputDate(row.date),
        machineId: row.machineId || '',
        operatorId: row.operatorId || '',
        shift: row.shift || '',
        yarnId: row.yarnId || '',
        twistId: row.twistId || '',
        yarnKg: row.yarnKg ?? '',
        rollsProducedEstimate: row.rollsProducedEstimate ?? '',
        note: row.note || '',
        crates,
        cratesTouched: false,
      });
      return;
    }

    const refs = parseIssueRefs(row);
    const crates = refs.map((ref) => {
      const holoRow = db.receive_from_holo_machine_rows?.find(r => r.id === ref.rowId);
      const coningRow = db.receive_from_coning_machine_rows?.find(r => r.id === ref.rowId);
      const sourceRow = holoRow || coningRow;
      const baseRolls = sourceRow?.rollCount ?? sourceRow?.coneCount ?? 0;
      const baseWeight = sourceRow?.rollWeight ?? sourceRow?.coneWeight ?? 0;
      const unitWeight = baseRolls > 0 ? baseWeight / baseRolls : 0;
      let lotNo = sourceRow?.issue?.lotNo || '';
      let itemId = sourceRow?.issue?.itemId || '';
      if (!lotNo && holoRow?.issueId) {
        const holoIssue = db.issue_to_holo_machine?.find(i => i.id === holoRow.issueId);
        lotNo = holoIssue?.lotNo || lotNo;
        itemId = holoIssue?.itemId || itemId;
      }
      return {
        rowId: ref.rowId,
        barcode: ref.barcode || sourceRow?.barcode || '',
        issueRolls: Number(ref.issueRolls || 0),
        issueWeight: Number(ref.issueWeight || 0),
        unitWeight,
        lotNo,
        itemId,
      };
    });
    const firstRef = refs[0] || {};

    setIssueDraft({
      date: formatInputDate(row.date),
      machineId: row.machineId || '',
      operatorId: row.operatorId || '',
      shift: row.shift || '',
      note: row.note || '',
      requiredPerConeNetWeight: row.requiredPerConeNetWeight ?? '',
      coneTypeId: firstRef.coneTypeId || '',
      wrapperId: firstRef.wrapperId || '',
      boxId: firstRef.boxId || '',
      crates,
      cratesTouched: false,
      metaTouched: false,
    });
  };

  const closeIssueEditor = () => {
    setEditingIssue(null);
    setIssueDraft(null);
    setIssueScanInput('');
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

  const handleAddHoloCrate = () => {
    if (!issueDraft) return;
    const normalized = issueScanInput.trim().toUpperCase();
    if (!normalized) return;
    const row = (db.receive_from_cutter_machine_rows || [])
      .find(r => !r.isDeleted && (r.barcode || '').toUpperCase() === normalized);
    if (!row) {
      alert('Barcode not found in Cutter Receive rows');
      return;
    }
    if (issueDraft.crates.some(c => c.rowId === row.id)) {
      alert('Crate already added');
      return;
    }

    const piece = db.inbound_items?.find(p => p.id === row.pieceId);
    if (!piece) {
      alert('Inbound piece not found for this crate');
      return;
    }

    const currentItemId = issueDraft.crates[0]?.itemId;
    const currentLotNo = issueDraft.crates[0]?.lotNo;
    if (currentItemId && piece.itemId !== currentItemId) {
      alert('Mixed items not allowed');
      return;
    }
    if (currentLotNo && piece.lotNo !== currentLotNo) {
      alert('Mixed lots not allowed');
      return;
    }

    const bobbinQty = Number(row.bobbinQuantity || 0);
    const issuedCount = Number(row.issuedBobbins || 0);
    const issuedWt = Number(row.issuedBobbinWeight || 0);
    const availCount = Math.max(0, bobbinQty - issuedCount);
    const availWt = Math.max(0, Number(row.netWt || 0) - issuedWt);
    const unitWeight = bobbinQty > 0 ? Number(row.netWt || 0) / bobbinQty : null;

    setIssueDraft((prev) => ({
      ...prev,
      crates: [
        ...prev.crates,
        {
          rowId: row.id,
          barcode: row.barcode,
          pieceId: row.pieceId,
          itemId: piece.itemId,
          lotNo: piece.lotNo,
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

  const handleAddConingCrate = () => {
    if (!issueDraft) return;
    const normalized = issueScanInput.trim().toUpperCase();
    if (!normalized) return;

    const normalizeValue = (val) => String(val || '').trim().toUpperCase();
    const holoMatches = (db.receive_from_holo_machine_rows || []).filter(r => {
      return !r.isDeleted && (normalizeValue(r.barcode) === normalized
        || normalizeValue(r.notes) === normalized
        || normalizeValue(r.legacyBarcode) === normalized);
    });
    const coningMatches = (db.receive_from_coning_machine_rows || []).filter(r => {
      return !r.isDeleted && normalizeValue(r.barcode) === normalized;
    });
    const matches = [...holoMatches, ...coningMatches];

    if (matches.length === 0) {
      alert('Barcode not found in receive rows');
      return;
    }
    if (matches.length > 1) {
      alert('Multiple rows match this barcode. Please use the new barcode instead.');
      return;
    }

    const row = matches[0];
    if (issueDraft.crates.some(c => c.rowId === row.id)) {
      alert('Crate already added');
      return;
    }

    let lotNo = row.issue?.lotNo || '';
    let itemId = row.issue?.itemId || '';
    if (!lotNo && row.issueId) {
      const holoIssue = db.issue_to_holo_machine?.find(i => i.id === row.issueId);
      lotNo = holoIssue?.lotNo || lotNo;
      itemId = holoIssue?.itemId || itemId;
    }
    if (!lotNo) {
      alert('Lot not found for this crate');
      return;
    }

    if (issueDraft.crates.length > 0) {
      const currentLotNo = issueDraft.crates[0]?.lotNo;
      const currentItemId = issueDraft.crates[0]?.itemId;
      if (currentLotNo && lotNo !== currentLotNo) {
        alert('Mixed lots not allowed');
        return;
      }
      if (currentItemId && itemId && itemId !== currentItemId) {
        alert('Mixed items not allowed');
        return;
      }
    }

    const baseRolls = row.rollCount ?? row.coneCount ?? 0;
    const baseWeight = row.rollWeight ?? row.coneWeight ?? 0;
    const unitWeight = baseRolls > 0 ? baseWeight / baseRolls : 0;

    setIssueDraft((prev) => ({
      ...prev,
      crates: [
        ...prev.crates,
        {
          rowId: row.id,
          barcode: row.barcode,
          issueRolls: baseRolls,
          issueWeight: baseWeight,
          unitWeight,
          lotNo,
          itemId,
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

  const handleSaveIssueEdits = async () => {
    if (!editingIssue || !issueDraft) return;
    if (!issueDraft.date) {
      alert('Date is required');
      return;
    }
    setSavingIssue(true);
    try {
      let updatedIssue = null;
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
        const res = await api.updateIssueToMachine(editingIssue.id, process, payload);
        updatedIssue = res?.issueToCutterMachine || res?.issueToMachine || null;
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
        const res = await api.updateIssueToMachine(editingIssue.id, process, payload);
        updatedIssue = res?.issueToHoloMachine || null;
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
        const res = await api.updateIssueToMachine(editingIssue.id, process, payload);
        updatedIssue = res?.issueToConingMachine || null;
      }
      if (process === 'coning' && updatedIssue) {
        patchIssueRecord(process, updatedIssue);
      } else {
        await refreshProcessData(process);
      }
      closeIssueEditor();
      alert('Issue record updated.');
    } catch (err) {
      alert(err.message || 'Failed to update issue record');
    } finally {
      setSavingIssue(false);
    }
  };

  const handleReprint = async (row) => {
    try {
      let stageKey, data;
      const lotLabel = lotLabelFor(row);

      if (process === 'cutter') {
        stageKey = LABEL_STAGE_KEYS.CUTTER_ISSUE;
        const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';
        const cut = db.cuts?.find(c => c.id === row.cutId)?.name || '';

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
        const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';
        const yarnName = db.yarns?.find(y => y.id === row.yarnId)?.name || '';
        const twistName = db.twists?.find(t => t.id === row.twistId)?.name || '';

        // Get bobbin info and cut from receivedRowRefs
        let bobbinType = '';
        let bobbinQty = 0;
        let cut = '';
        let totalRolls = row.metallicBobbins || 0;
        let totalWeight = row.metallicBobbinsWeight || 0;
        let issuedWeight = 0;

        try {
          const refs = typeof row.receivedRowRefs === 'string' ? JSON.parse(row.receivedRowRefs) : row.receivedRowRefs;
          if (Array.isArray(refs) && refs.length > 0) {
            // Sum up bobbins from all refs
            refs.forEach(ref => {
              bobbinQty += Number(ref.issuedBobbins || 0);
              issuedWeight += Number(ref.issuedBobbinWeight || 0);
            });

            // Get cut - first check direct cutId (Opening Stock), then cutter source row
            const resolved = resolveHoloTrace(row, holoTraceContext);
            cut = resolved.cutName === '—' ? '' : resolved.cutName;

            // Still need bobbin info from first ref
            const firstRef = refs[0];
            const cutterRow = db.receive_from_cutter_machine_rows?.find(r => !r.isDeleted && r.id === firstRef.rowId);
            if (cutterRow) {
              bobbinType = cutterRow.bobbin?.name || db.bobbins?.find(b => b.id === cutterRow.bobbinId)?.name || '';
            }
          }
        } catch (e) { console.error('Error parsing receivedRowRefs', e); }

        const resolvedBobbinQty = bobbinQty || row.metallicBobbins || 0;
        const resolvedNetWeight = issuedWeight || totalWeight || 0;

        data = {
          lotNo: lotLabel,
          itemName,
          machineName,
          operatorName,
          yarnName,
          twistName,
          bobbinType,
          bobbinQty: resolvedBobbinQty,
          totalRolls,
          totalWeight,
          netWeight: resolvedNetWeight,
          metallicBobbins: row.metallicBobbins,
          metallicBobbinsWeight: row.metallicBobbinsWeight,
          yarnKg: row.yarnKg,
          cut,
          shift: row.shift,
          date: row.date,
          barcode: row.barcode,
        };
      } else if (process === 'coning') {
        stageKey = LABEL_STAGE_KEYS.CONING_ISSUE;
        const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
        const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
        const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';

        // Get coneType, wrapperName, and trace back to get cut, yarnName, rollType
        let coneType = '';
        let wrapperName = '';
        let cut = '';
        let yarnName = '';
        let rollType = '';
        let twist = '';
        let twistName = '';
        let rollCount = 0;
        let totalRolls = 0;
        let totalWeight = 0;
        let netWeight = 0;
        let grossWeight = 0;
        let tareWeight = 0;

        try {
          const refs = typeof row.receivedRowRefs === 'string' ? JSON.parse(row.receivedRowRefs) : row.receivedRowRefs;
          if (Array.isArray(refs) && refs.length > 0) {
            const firstRef = refs[0];

            // Get cone type and wrapper from refs or form data stored in issue
            if (firstRef.coneTypeId) coneType = db.cone_types?.find(c => c.id === firstRef.coneTypeId)?.name || '';
            if (firstRef.wrapperId) wrapperName = db.wrappers?.find(w => w.id === firstRef.wrapperId)?.name || '';

            // Sum up rolls
            refs.forEach(ref => {
              rollCount += Number(ref.issueRolls || 0);
              totalRolls += Number(ref.issueRolls || 0);
              totalWeight += Number(ref.issueWeight || 0);
            });
            netWeight = totalWeight;
            grossWeight = totalWeight;
            tareWeight = 0;

            const resolved = resolveConingTrace(row, traceContext);
            cut = resolved.cutName === '—' ? '' : resolved.cutName;
            yarnName = resolved.yarnName === '—' ? '' : resolved.yarnName;
            rollType = resolved.rollTypeName === '—' ? '' : resolved.rollTypeName;
            const twistResolved = resolved.twistName;
            twistName = twistResolved === '—' ? '' : twistResolved;
            twist = twistName;
          }
        } catch (e) { console.error('Error parsing receivedRowRefs', e); }
        if (!grossWeight && totalWeight) grossWeight = totalWeight;
        if (!tareWeight) tareWeight = 0;

        data = {
          lotNo: lotLabel,
          itemName,
          machineName,
          operatorName,
          cut,
          yarnName,
          rollType,
          coneType,
          wrapperName,
          twist: twist || '',
          twistName: twistName || '',
          rollCount,
          totalRolls,
          totalWeight,
          grossWeight,
          tareWeight,
          netWeight,
          expectedCones: row.expectedCones,
          perConeTargetG: row.requiredPerConeNetWeight,
          shift: row.shift,
          date: row.date,
          barcode: row.barcode,
        };
      }


      if (!stageKey) {
        alert('Unknown process type');
        return;
      }

      const template = await loadTemplate(stageKey);
      if (!template) {
        alert('No sticker template found for this stage. Please configure it in Label Designer.');
        return;
      }

      await printStageTemplate(stageKey, data, { template });
      // Silent success - printer handles feedback
    } catch (err) {
      alert(err.message || 'Failed to reprint sticker');
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
      const itemName = db.items?.find(i => i.id === row.itemId)?.name || '';
      const machineName = db.machines?.find(m => m.id === row.machineId)?.name || '';
      const operatorName = db.operators?.find(o => o.id === row.operatorId)?.name || '';
      const cut = db.cuts?.find(c => c.id === row.cutId)?.name || '';

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
    if (row.cutName || row.yarnName || row.twistName) {
      return {
        cutName: row.cutName || '—',
        yarnName: row.yarnName || '—',
        twistName: row.twistName || '—',
      };
    }
    if (process === 'holo') {
      if (!holoTraceContext) return { cutName: '—', yarnName: '—', twistName: '—' };
      return resolveHoloTrace(row, holoTraceContext);
    }
    if (process === 'coning') {
      if (!traceContext) return { cutName: '—', yarnName: '—', twistName: '—' };
      return resolveConingTrace(row, traceContext);
    }
    return resolveCutterIssueDetails(row);
  };

  const stageTakeBacks = useMemo(() => {
    if (v2Enabled) return [];
    return (db.issue_take_backs || [])
      .filter((tb) => tb.stage === process)
      .slice()
      .sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));
  }, [db.issue_take_backs, process]);

  const takeBackTotalsByIssue = useMemo(() => {
    if (v2Enabled) return new Map();
    const map = new Map();
    stageTakeBacks
      .filter((tb) => !tb.isReverse && !tb.isReversed)
      .forEach((tb) => {
        const prev = map.get(tb.issueId) || { count: 0, weight: 0 };
        prev.count += Number(tb.totalCount || 0);
        prev.weight += Number(tb.totalWeight || 0);
        map.set(tb.issueId, prev);
      });
    return map;
  }, [stageTakeBacks]);

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

  const issuesBase = useMemo(() => {
    if (v2Enabled) return [];
    let rows = [];
    if (process === 'holo') {
      rows = (db.issue_to_holo_machine || []).filter(r => !r.isDeleted);
    } else if (process === 'coning') {
      rows = (db.issue_to_coning_machine || []).filter(r => !r.isDeleted);
    } else {
      rows = (db.issue_to_cutter_machine || []).filter(r => !r.isDeleted);
    }

    const filtered = rows.map((row) => {
      const takeBackTotals = takeBackTotalsByIssue.get(row.id) || { count: 0, weight: 0 };
      const balance = row.issueBalance || db.issue_balances?.[row.id] || null;
      const originalIssuedWeight = Number(balance?.originalWeight ?? (process === 'cutter'
        ? row.totalWeight
        : process === 'holo'
          ? row.metallicBobbinsWeight
          : 0));
      const takenBackWeight = Number(balance?.takeBackWeight ?? takeBackTotals.weight ?? 0);
      const netIssuedWeight = Number(balance?.netIssuedWeight ?? Math.max(0, originalIssuedWeight - takenBackWeight));
      const takenBackCount = Number(takeBackTotals.count || 0);
      return {
        ...row,
        takenBackWeight,
        takenBackCount,
        originalIssuedWeight,
        netIssuedWeight,
      };
    });

    // Sort by createdAt timestamp descending (latest first, considering time)
    return filtered.slice().sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));
  }, [db, process, takeBackTotalsByIssue]);

  const filterColumns = useMemo(() => {
    // In v2 mode, row objects already include flattened names; avoid expensive tracing.
    const common = [
      { id: 'date', label: 'Date', kind: 'date', getValue: (r) => r.date || r.createdAt || '' },
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
  }, [process, itemNameById, operatorNameById, machineNameById, db, traceContext, holoTraceContext, v2Enabled]);

  const legacyIssues = useMemo(() => {
    if (v2Enabled) return [];
    let rows = applySheetFilters(issuesBase, filterColumns, sheetFilters);

    // Search across all filterColumns
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(r =>
        filterColumns.some(col => {
          const val = col.getValue(r);
          return String(val).toLowerCase().includes(term);
        })
      );
    }

    return rows;
  }, [issuesBase, filterColumns, sheetFilters, searchTerm]);

  const legacyTotals = useMemo(() => {
    if (v2Enabled) {
      return {
        qty: 0,
        weight: 0,
        metallicBobbins: 0,
        metallicBobbinsWeight: 0,
        yarnKg: 0,
        rollsProducedEstimate: 0,
        rollsIssued: 0,
        takenBackWeight: 0,
        netIssuedWeight: 0,
      };
    }
    const t = {
      qty: 0,
      weight: 0,
      metallicBobbins: 0,
      metallicBobbinsWeight: 0,
      yarnKg: 0,
      rollsProducedEstimate: 0,
      rollsIssued: 0,
      takenBackWeight: 0,
      netIssuedWeight: 0,
    };
    for (const r of legacyIssues || []) {
      if (process === 'cutter') {
        t.qty += Number(r.count || 0);
        t.weight += Number(r.totalWeight || 0);
        t.takenBackWeight += Number(r.takenBackWeight || 0);
        t.netIssuedWeight += Number(r.netIssuedWeight ?? 0);
      } else if (process === 'holo') {
        t.metallicBobbins += Number(r.metallicBobbins || 0);
        t.metallicBobbinsWeight += Number(r.metallicBobbinsWeight || 0);
        t.takenBackWeight += Number(r.takenBackWeight || 0);
        t.netIssuedWeight += Number(r.netIssuedWeight ?? 0);
        t.yarnKg += Number(r.yarnKg || 0);
        t.rollsProducedEstimate += Number(r.rollsProducedEstimate || 0);
      } else if (process === 'coning') {
        t.rollsIssued += Number(r.count || r.rollsIssued || 0);
        t.takenBackWeight += Number(r.takenBackWeight || 0);
        t.netIssuedWeight += Number(r.netIssuedWeight ?? 0);
      }
    }
    return t;
  }, [legacyIssues, process, v2Enabled]);

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

  const v2List = useV2CursorList({
    enabled: v2Enabled,
    fetchPage: ({ limit, cursor, search, dateFrom, dateTo, filters }) => (
      v2.getV2IssueTracking(process, {
        limit,
        cursor,
        search,
        dateFrom,
        dateTo,
        filters: JSON.stringify(filters || []),
      })
    ),
    limit: 50,
    search: searchTerm,
    dateFrom: v2DateFrom,
    dateTo: v2DateTo,
    filters: v2Filters,
  });

  const issues = v2Enabled ? v2List.items : legacyIssues;
  const totals = useMemo(() => {
    if (!v2Enabled) return legacyTotals;
    const s = v2List.summary || {};
    if (process === 'cutter') {
      return {
        ...legacyTotals,
        qty: Number(s.qty || 0),
        weight: Number(s.weight || 0),
        takenBackWeight: Number(s.takenBackWeight || 0),
        netIssuedWeight: Number(s.netIssuedWeight || 0),
      };
    }
    if (process === 'holo') {
      return {
        ...legacyTotals,
        metallicBobbins: Number(s.metallicBobbins || 0),
        metallicBobbinsWeight: Number(s.metallicBobbinsWeight || 0),
        yarnKg: Number(s.yarnKg || 0),
        rollsProducedEstimate: Number(s.rollsProducedEstimate || 0),
        takenBackWeight: Number(s.takenBackWeight || 0),
        netIssuedWeight: Number(s.netIssuedWeight || 0),
      };
    }
    return {
      ...legacyTotals,
      rollsIssued: Number(s.rollsIssued || 0),
      takenBackWeight: Number(s.takenBackWeight || 0),
      netIssuedWeight: Number(s.netIssuedWeight || 0),
    };
  }, [v2Enabled, v2List.summary, process, legacyTotals]);

  const loadMoreRef = useInfiniteScrollSentinel({
    enabled: v2Enabled && v2List.hasMore && !v2List.isLoading,
    onLoadMore: v2List.loadMore,
    rootRef: scrollRootRef,
  });

  const [v2FacetsById, setV2FacetsById] = useState({});

  useEffect(() => {
    if (!v2Enabled) return;
    if (!openFilterId) return;
    const col = filterColumns.find(c => c.id === openFilterId);
    if (!col || col.kind !== 'values') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await v2.getV2IssueTrackingFacets(process, {
          search: searchTerm,
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
  }, [v2Enabled, openFilterId, process, searchTerm, v2DateFrom, v2DateTo, v2Filters, filterColumns]);

  // Prefetch the most-used value facets so opening the filter doesn't briefly show "No data".
  useEffect(() => {
    if (!v2Enabled) return;
    let cancelled = false;
    const fields = process === 'cutter' ? ['item', 'cut', 'machine', 'operator'] : ['item', 'cut', 'yarn', 'twist', 'machine', 'operator'];
    (async () => {
      try {
        const res = await Promise.all(fields.map(async (field) => {
          if (Array.isArray(v2FacetsById?.[field])) return null;
          const col = filterColumns.find(c => c.id === field);
          if (!col || col.kind !== 'values') return null;
          const out = await v2.getV2IssueTrackingFacets(process, {
            search: searchTerm,
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
  }, [v2Enabled, process, searchTerm, v2DateFrom, v2DateTo, v2Filters, filterColumns]);

  const columnFor = (id) => {
    const col = filterColumns.find(c => c.id === id);
    if (!col) return col;
    if (!v2Enabled || col.kind !== 'values') return col;
    const facetOptions = v2FacetsById?.[id];
    return Array.isArray(facetOptions) ? { ...col, facetOptions } : col;
  };

  const issueById = useMemo(() => {
    if (v2Enabled) return new Map((issues || []).map((row) => [row.id, row]));
    const rows = process === 'holo'
      ? (db.issue_to_holo_machine || [])
      : process === 'coning'
        ? (db.issue_to_coning_machine || [])
        : (db.issue_to_cutter_machine || []);
    return new Map(rows.map((row) => [row.id, row]));
  }, [db, process, v2Enabled, issues]);

  const getActions = (row) => {
    const actions = [
      {
        label: 'Edit',
        icon: <Edit2 className="w-4 h-4" />,
        onClick: () => openIssueEditor(row),
        disabled: !canEdit,
        disabledReason: 'You do not have permission to edit issue records.',
      },
      {
        label: 'Reprint',
        icon: <Printer className="w-4 h-4" />,
        onClick: () => handleReprint(row),
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

  const handleExport = async () => {
    let sourceRows = issues;
    if (v2Enabled) {
      try {
        const res = await v2.exportV2IssueTrackingJson(process, {
          search: searchTerm,
          dateFrom: v2DateFrom,
          dateTo: v2DateTo,
          filters: JSON.stringify(v2Filters || []),
        });
        sourceRows = Array.isArray(res?.items) ? res.items : [];
      } catch (err) {
        alert(err?.message || 'Failed to export');
        return;
      }
    }

    // Build export data with resolved names
    const exportData = sourceRows.map(r => {
      const baseData = {
        date: formatDateDDMMYYYY(r.date || r.createdAt),
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
        { key: 'barcode', header: 'Barcode' },
        { key: 'note', header: 'Note' },
      ];
    } else if (process === 'holo') {
      columns = [
        { key: 'date', header: 'Date' },
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

  const emptyColSpan = process === 'cutter' ? 14 : process === 'holo' ? 18 : 17;

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
    const lotNo = issueDraft.crates?.[0]?.lotNo || '';
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
    const lotNo = issueDraft.crates?.[0]?.lotNo || '';
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
                      <span>Date</span>
                      <SheetColumnFilter column={columnFor('date')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Item</span>
                      <SheetColumnFilter column={columnFor('item')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Piece</span>
                      <SheetColumnFilter column={columnFor('lotOrPiece')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cut</span>
                      <SheetColumnFilter column={columnFor('cut')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>

                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Machine</span>
                      <SheetColumnFilter column={columnFor('machine')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Operator</span>
                      <SheetColumnFilter column={columnFor('operator')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Qty</span>
                      <SheetColumnFilter column={columnFor('qty')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Weight (kg)</span>
                      <SheetColumnFilter column={columnFor('weight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Taken Back (kg)</span>
                      <SheetColumnFilter column={columnFor('takenBackWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Net Issued (kg)</span>
                      <SheetColumnFilter column={columnFor('netIssuedWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Barcode</span>
                      <SheetColumnFilter column={columnFor('barcode')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Note</span>
                      <SheetColumnFilter column={columnFor('note')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Added By</span>
                      <SheetColumnFilter column={columnFor('addedBy')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
              {process === 'holo' && (
                <>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Date</span>
                      <SheetColumnFilter column={columnFor('date')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Item</span>
                      <SheetColumnFilter column={columnFor('item')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Lot</span>
                      <SheetColumnFilter column={columnFor('lotOrPiece')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cut</span>
                      <SheetColumnFilter column={columnFor('cut')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Yarn</span>
                      <SheetColumnFilter column={columnFor('yarn')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Twist</span>
                      <SheetColumnFilter column={columnFor('twist')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Machine</span>
                      <SheetColumnFilter column={columnFor('machine')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Operator</span>
                      <SheetColumnFilter column={columnFor('operator')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Metallic Bobbins</span>
                      <SheetColumnFilter column={columnFor('metallicBobbins')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Met. Bob. Wt (kg)</span>
                      <SheetColumnFilter column={columnFor('metallicBobbinsWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Taken Back (kg)</span>
                      <SheetColumnFilter column={columnFor('takenBackWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Net Issued (kg)</span>
                      <SheetColumnFilter column={columnFor('netIssuedWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Yarn Wt (kg)</span>
                      <SheetColumnFilter column={columnFor('yarnKg')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Rolls Prod. Est.</span>
                      <SheetColumnFilter column={columnFor('rollsProducedEstimate')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Barcode</span>
                      <SheetColumnFilter column={columnFor('barcode')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Note</span>
                      <SheetColumnFilter column={columnFor('note')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Added By</span>
                      <SheetColumnFilter column={columnFor('addedBy')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
              {process === 'coning' && (
                <>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Date</span>
                      <SheetColumnFilter column={columnFor('date')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Item</span>
                      <SheetColumnFilter column={columnFor('item')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Lot</span>
                      <SheetColumnFilter column={columnFor('lotOrPiece')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cut</span>
                      <SheetColumnFilter column={columnFor('cut')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Yarn</span>
                      <SheetColumnFilter column={columnFor('yarn')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Twist</span>
                      <SheetColumnFilter column={columnFor('twist')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Machine</span>
                      <SheetColumnFilter column={columnFor('machine')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Operator</span>
                      <SheetColumnFilter column={columnFor('operator')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cone Type</span>
                      <SheetColumnFilter column={columnFor('coneType')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Per Cone (g)</span>
                      <SheetColumnFilter column={columnFor('perCone')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Rolls Issued</span>
                      <SheetColumnFilter column={columnFor('rollsIssued')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Taken Back (kg)</span>
                      <SheetColumnFilter column={columnFor('takenBackWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-between gap-2">
                      <span>Net Issued (kg)</span>
                      <SheetColumnFilter column={columnFor('netIssuedWeight')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Barcode</span>
                      <SheetColumnFilter column={columnFor('barcode')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Note</span>
                      <SheetColumnFilter column={columnFor('note')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between gap-2">
                      <span>Added By</span>
                      <SheetColumnFilter column={columnFor('addedBy')} rows={issuesBase} filters={sheetFilters} setFilters={setSheetFilters} openId={openFilterId} setOpenId={setOpenFilterId} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.length === 0 ? (
              <TableRow><TableCell colSpan={emptyColSpan} className="text-center py-4 text-muted-foreground">No issue records found for {process}.</TableCell></TableRow>
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
                          <TableCell><HighlightMatch text={itemDisplay} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[150px] truncate" title={r.pieceIds || ''}><HighlightMatch text={r.pieceIds || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.cutName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={machineNameById.get(r.machineId)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={operatorNameById.get(r.operatorId)} query={searchTerm} /></TableCell>
                          <TableCell>{r.count}</TableCell>
                          <TableCell>{formatKg(r.totalWeight)}</TableCell>
                          <TableCell>{formatKg(r.takenBackWeight || 0)}</TableCell>
                          <TableCell>{formatKg(r.netIssuedWeight ?? r.totalWeight ?? 0)}</TableCell>
                          <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode || r.id.substring(0, 8)} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[200px] truncate" title={r.note || ''}><HighlightMatch text={r.note || '—'} query={searchTerm} /></TableCell>
                          <TableCell>
                            <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                          </TableCell>
                        </>
                      )}
                      {process === 'holo' && (
                        <>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(r.date)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={itemDisplay} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={lotLabelFor(r) || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.cutName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.yarnName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.twistName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={machineNameById.get(r.machineId)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={operatorNameById.get(r.operatorId)} query={searchTerm} /></TableCell>
                          <TableCell>{r.metallicBobbins || 0}</TableCell>
                          <TableCell>{formatKg(r.metallicBobbinsWeight)}</TableCell>
                          <TableCell>{formatKg(r.takenBackWeight || 0)}</TableCell>
                          <TableCell>{formatKg(r.netIssuedWeight ?? r.metallicBobbinsWeight ?? 0)}</TableCell>
                          <TableCell>{formatKg(r.yarnKg)}</TableCell>
                          <TableCell>{r.rollsProducedEstimate || '—'}</TableCell>
                          <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode || r.id.substring(0, 8)} query={searchTerm} /></TableCell>
                          <TableCell className="max-w-[200px] truncate" title={r.note || ''}><HighlightMatch text={r.note || '—'} query={searchTerm} /></TableCell>
                          <TableCell>
                            <UserBadge user={r.createdByUser} timestamp={r.createdAt} />
                          </TableCell>
                        </>
                      )}
                      {process === 'coning' && (
                        <>
                          <TableCell className="whitespace-nowrap"><HighlightMatch text={formatDateDDMMYYYY(r.date)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={itemDisplay} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={lotLabelFor(r) || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.cutName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.yarnName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={resolved.twistName || '—'} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={machineNameById.get(r.machineId)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={operatorNameById.get(r.operatorId)} query={searchTerm} /></TableCell>
                          <TableCell><HighlightMatch text={r.coneTypeName || resolveConingConeTypeName(r) || '—'} query={searchTerm} /></TableCell>
                          <TableCell>{formatPerConeNet((r.perConeTargetG ?? r.requiredPerConeNetWeight))}</TableCell>
                          <TableCell>{r.count || r.rollsIssued || 0}</TableCell>
                          <TableCell>{formatKg(r.takenBackWeight || 0)}</TableCell>
                          <TableCell>{formatKg(r.netIssuedWeight ?? 0)}</TableCell>
                          <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode || r.id.substring(0, 8)} query={searchTerm} /></TableCell>
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
        {/* Invisible infinite-scroll sentinel for v2 (no UI change). */}
        <div ref={loadMoreRef} style={{ height: 1 }} aria-hidden="true" />
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

      {/* Mobile Card View */}
      <div className="block sm:hidden space-y-3">
        {issues.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
            No issue records found for {process}.
          </div>
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
                      {formatDateDDMMYYYY(r.date)} • {itemNameById.get(r.itemId)}
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
                      Taken Back: {formatKg(r.takenBackWeight || 0)} • Net Issued: {formatKg(r.netIssuedWeight ?? (process === 'cutter' ? r.totalWeight : process === 'holo' ? r.metallicBobbinsWeight : 0))}
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

      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/30 text-sm font-semibold">Take-Back Ledger</div>
        <div className="max-h-[260px] overflow-auto">
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
              {stageTakeBacks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-6 text-muted-foreground">
                    No take-back entries for {process}.
                  </TableCell>
                </TableRow>
              ) : (
                stageTakeBacks.map((tb) => {
                  const issue = issueById.get(tb.issueId) || null;
                  const isActiveOriginal = !tb.isReverse && !tb.isReversed;
                  const typeLabel = tb.isReverse ? 'Reverse' : (tb.isReversed ? 'Take Back (Reversed)' : 'Take Back');
                  return (
                    <TableRow key={tb.id}>
                      <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(tb.date || tb.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={tb.isReverse ? 'secondary' : tb.isReversed ? 'outline' : 'default'}>
                          {typeLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{issue?.barcode || tb.issueId}</TableCell>
                      <TableCell>{lotLabelFor(issue) || '—'}</TableCell>
                      <TableCell>{itemNameById.get(issue?.itemId) || '—'}</TableCell>
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
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Add Crate</label>
                        <Input
                          value={issueScanInput}
                          onChange={(e) => setIssueScanInput(e.target.value)}
                          placeholder="Scan Cutter Receive Barcode"
                          disabled={editingIssue.hasReceives}
                        />
                      </div>
                      <Button
                        onClick={handleAddHoloCrate}
                        disabled={editingIssue.hasReceives}
                        className="h-9"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
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
                                  disabled={editingIssue.hasReceives}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Weight (kg)</label>
                                <Input
                                  type="number"
                                  value={crate.issuedBobbinWeight}
                                  onChange={(e) => updateHoloCrate(crate.rowId, 'issuedBobbinWeight', e.target.value)}
                                  disabled={editingIssue.hasReceives}
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveHoloCrate(crate.rowId)}
                                  disabled={editingIssue.hasReceives}
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
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Add Crate</label>
                        <Input
                          value={issueScanInput}
                          onChange={(e) => setIssueScanInput(e.target.value)}
                          placeholder="Scan Holo/Coning Receive Barcode"
                          disabled={editingIssue.hasReceives}
                        />
                      </div>
                      <Button
                        onClick={handleAddConingCrate}
                        disabled={editingIssue.hasReceives}
                        className="h-9"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
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
                                  disabled={editingIssue.hasReceives}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground uppercase">Weight (kg)</label>
                                <Input
                                  type="number"
                                  value={crate.issueWeight}
                                  onChange={(e) => updateConingCrate(crate.rowId, 'issueWeight', e.target.value)}
                                  disabled={editingIssue.hasReceives}
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveConingCrate(crate.rowId)}
                                  disabled={editingIssue.hasReceives}
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
    </div>
  );
}
