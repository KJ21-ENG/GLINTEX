import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { resolveUserFields } from '../utils/userResolver.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import XLSX from 'xlsx';

const router = Router();
const PERM_READ = ACCESS_LEVELS.READ;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeReceivedRowRefs(receivedRowRefs) {
  if (Array.isArray(receivedRowRefs)) return receivedRowRefs;
  if (typeof receivedRowRefs === 'string') {
    const parsed = safeJsonParse(receivedRowRefs, []);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

function requireStageReadPermission(resolver) {
  return function stageReadPermissionMiddleware(req, res, next) {
    const key = resolver(req);
    if (!key) return res.status(400).json({ error: 'Invalid stage' });
    return requirePermission(key, PERM_READ)(req, res, next);
  };
}

function issueStagePermissionKey(req) {
  const process = String(req.params.process || '').trim().toLowerCase();
  if (!['cutter', 'holo', 'coning'].includes(process)) return null;
  return `issue.${process}`;
}

function receiveStagePermissionKey(req) {
  const process = String(req.params.process || '').trim().toLowerCase();
  if (!['cutter', 'holo', 'coning'].includes(process)) return null;
  return `receive.${process}`;
}

function encodeStockLotKey(payload) {
  // Opaque, stable identifier used by the frontend to request expanded rows for a lot group.
  // Treat this as an internal contract (UI should never parse it).
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeStockLotKey(raw) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(String(raw), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || parsed.v !== 1) return null;
    const process = String(parsed.process || '').toLowerCase();
    if (!['holo', 'coning'].includes(process)) return null;
    return { ...parsed, process };
  } catch {
    return null;
  }
}

function encodeCursor({ createdAt, id }) {
  const payload = { createdAt, id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(String(raw), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || !parsed.createdAt || !parsed.id) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function buildCursorWhere(cursor) {
  if (!cursor) return null;
  // Stable pagination for orderBy: createdAt desc, id desc
  return {
    OR: [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: String(cursor.id) } },
    ],
  };
}

function applyCursorWhere(baseWhere, cursorWhere) {
  // IMPORTANT: both baseWhere and cursorWhere can contain top-level OR clauses.
  // Spreading them into one object would overwrite OR and break filtering on page 2+.
  return cursorWhere ? { AND: [baseWhere, cursorWhere] } : baseWhere;
}

function normalizeText(v) {
  return String(v || '').trim();
}

function clampZero(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x;
}

function buildSearchOr({ search, fields }) {
  const q = normalizeText(search);
  if (!q) return [];
  const contains = { contains: q, mode: 'insensitive' };
  return (fields || []).map((path) => {
    // path supports 1-2 levels like "barcode" or "operator.name"
    const parts = String(path).split('.');
    if (parts.length === 1) return { [parts[0]]: contains };
    if (parts.length === 2) return { [parts[0]]: { [parts[1]]: contains } };
    return null;
  }).filter(Boolean);
}

async function itemIdsByExactNames(names = []) {
  const unique = Array.from(new Set((names || []).map(String).map(s => s.trim()).filter(Boolean)));
  if (!unique.length) return [];
  const rows = await prisma.item.findMany({ where: { name: { in: unique } }, select: { id: true } });
  return rows.map(r => r.id);
}

async function itemIdsByNameContains(q) {
  const s = normalizeText(q);
  if (!s) return [];
  const rows = await prisma.item.findMany({
    where: { name: { contains: s, mode: 'insensitive' } },
    select: { id: true },
    take: 200,
  });
  return rows.map(r => r.id);
}

async function attachItemNamesToIssueRows(issueRows = []) {
  const ids = Array.from(new Set((issueRows || []).map(r => r?.itemId).filter(Boolean)));
  if (!ids.length) return issueRows;
  const rows = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(rows.map(r => [r.id, r.name]));
  return (issueRows || []).map(r => ({ ...r, itemName: byId.get(r.itemId) || '' }));
}

async function attachItemNamesToReceiveRows(receiveRows = []) {
  const itemIds = Array.from(new Set((receiveRows || []).map(r => r?.issue?.itemId).filter(Boolean)));
  if (!itemIds.length) return receiveRows;
  const rows = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } });
  const byId = new Map(rows.map(r => [r.id, r.name]));
  return (receiveRows || []).map((r) => {
    if (!r.issue) return r;
    return { ...r, issue: { ...r.issue, itemName: byId.get(r.issue.itemId) || '' } };
  });
}

async function buildItemWhereFromSheetFilters(filters = [], { mode } = {}) {
  const and = [];
  for (const f of filters || []) {
    if (!f || typeof f !== 'object') continue;
    if (String(f.field || '').trim() !== 'item') continue;

    const op = String(f.op || '').trim();
    let itemIds = [];
    if (op === 'in') {
      const values = Array.isArray(f.values) ? f.values : [];
      itemIds = await itemIdsByExactNames(values);
    } else if (op === 'contains') {
      itemIds = await itemIdsByNameContains(f.value);
    } else {
      continue;
    }

    if (!itemIds.length) itemIds = ['__no_such_item__'];

    if (mode === 'issue') and.push({ itemId: { in: itemIds } });
    if (mode === 'receive') and.push({ issue: { itemId: { in: itemIds } } });
  }
  return and;
}

function buildFilterWhere(filters = [], mapping = {}, { excludeField } = {}) {
  const and = [];
  for (const f of filters || []) {
    if (!f || typeof f !== 'object') continue;
    const field = String(f.field || '').trim();
    if (!field) continue;
    if (excludeField && field === excludeField) continue;
    const mapEntry = mapping[field];
    if (!mapEntry) continue;

    const op = String(f.op || '').trim();
    if (op === 'in') {
      const values = Array.isArray(f.values) ? f.values.map(v => String(v)) : [];
      if (!values.length) continue;
      and.push(mapEntry.in(values));
    } else if (op === 'contains') {
      const value = normalizeText(f.value);
      if (!value) continue;
      and.push(mapEntry.contains(value));
    } else if (op === 'between') {
      const min = f.min == null ? null : Number(f.min);
      const max = f.max == null ? null : Number(f.max);
      and.push(mapEntry.between({ min, max }));
    }
  }
  return and;
}

function toIsoDateString(v) {
  const s = normalizeText(v);
  if (!s) return '';
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function buildDateWhere({ dateFrom, dateTo, field = 'date' }) {
  const from = toIsoDateString(dateFrom);
  const to = toIsoDateString(dateTo);
  if (!from && !to) return null;
  const w = {};
  if (from) w.gte = from;
  if (to) w.lte = to;
  return { [field]: w };
}

function parsePieceIdsCsv(raw) {
  if (Array.isArray(raw)) return raw.map((value) => String(value || '').trim()).filter(Boolean);
  return String(raw || '').split(',').map((value) => value.trim()).filter(Boolean);
}

function toTimeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const CUTTER_HISTORY_COMPUTED_FILTER_FIELDS = new Set([
  'weight',
  'takenBackWeight',
  'netIssuedWeight',
  'wastageWeight',
]);

function splitCutterHistoryFilters(filters = []) {
  const rawFilters = [];
  const computedFilters = [];
  for (const filter of filters || []) {
    const field = String(filter?.field || '').trim();
    if (CUTTER_HISTORY_COMPUTED_FILTER_FIELDS.has(field)) {
      computedFilters.push(filter);
    } else {
      rawFilters.push(filter);
    }
  }
  return { rawFilters, computedFilters };
}

function getCutterHistoryComputedValue(row, field) {
  if (field === 'weight') return Number(row?.totalWeight ?? row?.originalIssuedWeight ?? 0);
  if (field === 'takenBackWeight') return Number(row?.takenBackWeight || 0);
  if (field === 'netIssuedWeight') return Number(row?.netIssuedWeight ?? 0);
  if (field === 'wastageWeight') return Number(row?.wastageWeight || 0);
  return null;
}

function matchesComputedBetween(value, { min, max }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return false;
  if (Number.isFinite(min) && numeric < min) return false;
  if (Number.isFinite(max) && numeric > max) return false;
  return true;
}

function matchesCutterHistoryComputedFilters(row, filters = []) {
  return (filters || []).every((filter) => {
    if (!filter || typeof filter !== 'object') return true;
    if (String(filter.op || '').trim() !== 'between') return true;
    const field = String(filter.field || '').trim();
    const value = getCutterHistoryComputedValue(row, field);
    const min = filter.min == null || filter.min === '' ? null : Number(filter.min);
    const max = filter.max == null || filter.max === '' ? null : Number(filter.max);
    return matchesComputedBetween(value, { min, max });
  });
}

function applyCursorToSortedItems(items = [], cursor) {
  if (!cursor) return items;
  const cursorMs = toTimeMs(cursor.createdAt);
  return (items || []).filter((item) => {
    const itemMs = toTimeMs(item?.createdAt);
    if (itemMs == null || cursorMs == null) return false;
    if (itemMs < cursorMs) return true;
    if (itemMs > cursorMs) return false;
    return String(item?.id || '') < String(cursor.id || '');
  });
}

function buildCutterHistorySummary(items = []) {
  return (items || []).reduce((summary, item) => {
    summary.qty += Number(item?.count || 0);
    summary.weight += Number(item?.totalWeight ?? item?.originalIssuedWeight ?? 0);
    summary.takenBackWeight += Number(item?.takenBackWeight || 0);
    summary.netIssuedWeight += Number(item?.netIssuedWeight ?? 0);
    return summary;
  }, {
    qty: 0,
    weight: 0,
    takenBackWeight: 0,
    netIssuedWeight: 0,
  });
}

async function buildCutterIssueWastageByIssueId(issueRows = []) {
  const issueIds = Array.from(new Set((issueRows || []).map((row) => row?.id).filter(Boolean)));
  const output = new Map(issueIds.map((issueId) => [issueId, 0]));
  if (!issueIds.length) return output;

  const pieceIds = Array.from(new Set(
    (issueRows || []).flatMap((row) => parsePieceIdsCsv(row?.pieceIds))
  ));
  if (!pieceIds.length) return output;

  const issueLines = await prisma.issueToCutterMachineLine.findMany({
    where: {
      pieceId: { in: pieceIds },
      issue: { isDeleted: false },
    },
    select: {
      pieceId: true,
      issueId: true,
      issue: { select: { createdAt: true } },
    },
  });

  const issuesByPiece = new Map();
  issueLines.forEach((line) => {
    const pieceId = String(line?.pieceId || '').trim();
    if (!pieceId) return;
    const entries = issuesByPiece.get(pieceId) || [];
    entries.push({
      issueId: line.issueId,
      createdAtMs: toTimeMs(line.issue?.createdAt),
    });
    issuesByPiece.set(pieceId, entries);
  });

  issuesByPiece.forEach((entries, pieceId) => {
    const deduped = Array.from(new Map(entries.map((entry) => [entry.issueId, entry])).values());
    deduped.sort((a, b) => {
      const aMs = a.createdAtMs == null ? Number.MAX_SAFE_INTEGER : a.createdAtMs;
      const bMs = b.createdAtMs == null ? Number.MAX_SAFE_INTEGER : b.createdAtMs;
      if (aMs !== bMs) return aMs - bMs;
      return String(a.issueId).localeCompare(String(b.issueId));
    });
    issuesByPiece.set(pieceId, deduped);
  });

  const challans = await prisma.receiveFromCutterMachineChallan.findMany({
    where: {
      pieceId: { in: pieceIds },
      isDeleted: false,
    },
    select: {
      pieceId: true,
      wastageNetWeight: true,
      createdAt: true,
    },
  });

  const targetIssueIds = new Set(issueIds);
  challans.forEach((challan) => {
    const pieceId = String(challan?.pieceId || '').trim();
    if (!pieceId) return;
    const wastageWeight = Number(challan?.wastageNetWeight || 0);
    if (wastageWeight <= 0) return;
    const challanAtMs = toTimeMs(challan?.createdAt);
    const candidates = issuesByPiece.get(pieceId) || [];
    const assigned = [...candidates]
      .reverse()
      .find((candidate) => candidate.createdAtMs != null && challanAtMs != null && candidate.createdAtMs <= challanAtMs);
    if (!assigned || !targetIssueIds.has(assigned.issueId)) return;
    output.set(assigned.issueId, Number(output.get(assigned.issueId) || 0) + wastageWeight);
  });

  return output;
}

async function computeHoloIssuePieceIdsByIssueId(issueIds = []) {
  const unique = Array.from(new Set((issueIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  const issues = await prisma.issueToHoloMachine.findMany({
    where: { id: { in: unique }, isDeleted: false },
    select: { id: true, lotNo: true, receivedRowRefs: true },
  });
  const cutterRowIds = [];
  const refsByIssue = new Map();
  for (const i of issues) {
    const refs = normalizeReceivedRowRefs(i.receivedRowRefs);
    const rowIds = refs.map(r => (typeof r?.rowId === 'string' ? r.rowId : null)).filter(Boolean);
    refsByIssue.set(i.id, { rowIds, lotNo: i.lotNo });
    cutterRowIds.push(...rowIds);
  }
  const uniqueCutterRowIds = Array.from(new Set(cutterRowIds));
  const cutterRows = uniqueCutterRowIds.length
    ? await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: uniqueCutterRowIds }, isDeleted: false },
      select: { id: true, pieceId: true },
    })
    : [];
  const pieceByRowId = new Map(cutterRows.map(r => [r.id, r.pieceId]));
  const out = new Map();
  for (const [issueId, meta] of refsByIssue.entries()) {
    const set = new Set();
    for (const rowId of meta.rowIds) {
      const pid = pieceByRowId.get(rowId);
      if (pid) set.add(pid);
    }
    if (set.size === 0 && meta.lotNo) set.add(`${meta.lotNo}-1`);
    out.set(issueId, Array.from(set));
  }
  return out;
}

async function computeConingIssuePieceIdsByIssueId(issueIds = []) {
  const unique = Array.from(new Set((issueIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  const issues = await prisma.issueToConingMachine.findMany({
    where: { id: { in: unique }, isDeleted: false },
    select: { id: true, lotNo: true, receivedRowRefs: true },
  });

  const holoRowIds = [];
  const holoRowIdsByIssue = new Map();
  for (const i of issues) {
    const refs = normalizeReceivedRowRefs(i.receivedRowRefs);
    const rowIds = refs.map(r => (typeof r?.rowId === 'string' ? r.rowId : null)).filter(Boolean);
    holoRowIdsByIssue.set(i.id, { rowIds, lotNo: i.lotNo });
    holoRowIds.push(...rowIds);
  }
  const uniqueHoloRowIds = Array.from(new Set(holoRowIds));
  const holoRows = uniqueHoloRowIds.length
    ? await prisma.receiveFromHoloMachineRow.findMany({
      where: { id: { in: uniqueHoloRowIds }, isDeleted: false },
      select: { id: true, issueId: true },
    })
    : [];
  const holoIssueIdByHoloRowId = new Map(holoRows.map(r => [r.id, r.issueId]));
  const holoIssueIds = Array.from(new Set(holoRows.map(r => r.issueId).filter(Boolean)));
  const holoIssues = holoIssueIds.length
    ? await prisma.issueToHoloMachine.findMany({
      where: { id: { in: holoIssueIds }, isDeleted: false },
      select: { id: true, lotNo: true, receivedRowRefs: true },
    })
    : [];

  const cutterRowIds = [];
  const cutterRowIdsByHoloIssueId = new Map();
  for (const hi of holoIssues) {
    const refs = normalizeReceivedRowRefs(hi.receivedRowRefs);
    const rowIds = refs.map(r => (typeof r?.rowId === 'string' ? r.rowId : null)).filter(Boolean);
    cutterRowIdsByHoloIssueId.set(hi.id, { rowIds, lotNo: hi.lotNo });
    cutterRowIds.push(...rowIds);
  }
  const uniqueCutterRowIds = Array.from(new Set(cutterRowIds));
  const cutterRows = uniqueCutterRowIds.length
    ? await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: uniqueCutterRowIds }, isDeleted: false },
      select: { id: true, pieceId: true },
    })
    : [];
  const pieceByCutterRowId = new Map(cutterRows.map(r => [r.id, r.pieceId]));

  const out = new Map();
  for (const [issueId, meta] of holoRowIdsByIssue.entries()) {
    const set = new Set();
    for (const holoRowId of meta.rowIds) {
      const holoIssueId = holoIssueIdByHoloRowId.get(holoRowId);
      if (!holoIssueId) continue;
      const cutterMeta = cutterRowIdsByHoloIssueId.get(holoIssueId);
      const cutterIds = cutterMeta?.rowIds || [];
      for (const cutterRowId of cutterIds) {
        const pid = pieceByCutterRowId.get(cutterRowId);
        if (pid) set.add(pid);
      }
    }
    if (set.size === 0 && meta.lotNo) set.add(`${meta.lotNo}-1`);
    out.set(issueId, Array.from(set));
  }
  return out;
}

function sheetFiltersArrayFromQuery(rawFilters) {
  const parsed = safeJsonParse(rawFilters, []);
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

// -------------------- Issue Tracking --------------------

const ISSUE_FILTERS = {
  date: {
    in: () => ({}),
    contains: () => ({}),
    between: () => ({}),
  },
  lotOrPiece: {
    in: () => ({}),
    contains: (value) => ({ lotNo: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  cut: {
    in: (values) => ({ cut: { name: { in: values } } }),
    contains: (value) => ({ cut: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  yarn: {
    in: (values) => ({ yarn: { name: { in: values } } }),
    contains: (value) => ({ yarn: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  twist: {
    in: (values) => ({ twist: { name: { in: values } } }),
    contains: (value) => ({ twist: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  machine: {
    in: (values) => ({ machine: { name: { in: values } } }),
    contains: (value) => ({ machine: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  operator: {
    in: (values) => ({ operator: { name: { in: values } } }),
    contains: (value) => ({ operator: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  barcode: {
    in: () => ({}),
    contains: (value) => ({ barcode: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  note: {
    in: () => ({}),
    contains: (value) => ({ note: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  addedBy: {
    in: (values) => ({ createdByUserId: { in: values } }),
    contains: () => ({}),
    between: () => ({}),
  },
};

function issueModelForProcess(process) {
  if (process === 'holo') return prisma.issueToHoloMachine;
  if (process === 'coning') return prisma.issueToConingMachine;
  return prisma.issueToCutterMachine;
}

function issueIncludesForProcess(process) {
  // Keep joins minimal but enough to show filter dropdowns and row rendering.
  if (process === 'cutter') {
    return { cut: true, machine: true, operator: true };
  }
  if (process === 'holo') {
    return { cut: true, machine: true, operator: true, yarn: true, twist: true };
  }
  return { cut: true, machine: true, operator: true, yarn: true, twist: true };
}

function pickIssueSearchFields(process) {
  // Item name is handled by translating search -> itemId IN (matching Item rows), since Issue* tables
  // only have itemId (no Prisma relation to Item).
  const base = ['barcode', 'lotNo', 'note', 'machine.name', 'operator.name'];
  if (process === 'cutter') base.push('pieceIds');
  return base;
}

function mapIssueRow(process, row, { takeBackTotalsByIssueId, wastageByIssueId } = {}) {
  const tb = takeBackTotalsByIssueId.get(row.id) || { count: 0, weight: 0 };
  let originalIssuedWeight = Number(process === 'cutter'
    ? row.totalWeight
    : process === 'holo'
      ? row.metallicBobbinsWeight
      : 0);
  let rollsIssued = 0;
  if (process === 'coning') {
    const refs = normalizeReceivedRowRefs(row.receivedRowRefs);
    originalIssuedWeight = refs.reduce((sum, ref) => sum + Number(ref?.issueWeight || 0), 0);
    rollsIssued = refs.reduce((sum, ref) => sum + Number(ref?.issueRolls || ref?.baseRolls || 0), 0);
  }
  const takenBackWeight = Number(tb.weight || 0);
  const netIssuedWeight = Math.max(0, originalIssuedWeight - takenBackWeight);
  const wastageWeight = Number(process === 'cutter' ? (wastageByIssueId?.get(row.id) || 0) : 0);
  return {
    ...row,
    // Flatten common names to avoid frontend deep lookups (UI stays same).
    itemName: row.itemName || '',
    cutName: row.cut?.name || '',
    yarnName: row.yarn?.name || '',
    twistName: row.twist?.name || '',
    machineName: row.machine?.name || (row.machineId ? '' : ''),
    operatorName: row.operator?.name || (row.operatorId ? '' : ''),
    takenBackCount: Number(tb.count || 0),
    takenBackWeight,
    originalIssuedWeight,
    netIssuedWeight,
    wastageWeight,
    ...(process === 'coning' ? { rollsIssued } : {}),
  };
}

async function fetchTakeBackTotalsByIssueIds(stage, issueIds) {
  const unique = Array.from(new Set((issueIds || []).filter(Boolean)));
  const map = new Map();
  if (!unique.length) return map;
  const rows = await prisma.issueTakeBack.findMany({
    where: { stage, issueId: { in: unique } },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const tb of rows) {
    if (tb.isReverse || tb.isReversed) continue;
    const prev = map.get(tb.issueId) || { count: 0, weight: 0 };
    prev.count += Number(tb.totalCount || 0);
    prev.weight += Number(tb.totalWeight || 0);
    map.set(tb.issueId, prev);
  }
  return map;
}

router.get('/issue/:process/tracking', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const model = issueModelForProcess(process);
    const { rawFilters, computedFilters } = process === 'cutter'
      ? splitCutterHistoryFilters(filters)
      : { rawFilters: filters, computedFilters: [] };
    const cursorWhere = computedFilters.length > 0 ? null : buildCursorWhere(cursor);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(rawFilters, ISSUE_FILTERS);
    const itemFilterWhere = await buildItemWhereFromSheetFilters(rawFilters, { mode: 'issue' });
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const itemSearchIds = await itemIdsByNameContains(search);
    if (itemSearchIds.length) searchOr.push({ itemId: { in: itemSearchIds } });
    const whereAll = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || itemFilterWhere.length ? { AND: [...filterWhere, ...itemFilterWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const wherePage = applyCursorWhere(whereAll, cursorWhere);

    if (process === 'cutter' && computedFilters.length > 0) {
      const rowsRaw = await model.findMany({
        where: whereAll,
        include: issueIncludesForProcess(process),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
      const issueIds = rowsWithItems.map((row) => row.id);
      const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds(process, issueIds);
      const wastageByIssueId = await buildCutterIssueWastageByIssueId(rowsWithItems);
      const allItems = rowsWithItems
        .map((row) => mapIssueRow(process, row, { takeBackTotalsByIssueId, wastageByIssueId }))
        .filter((row) => matchesCutterHistoryComputedFilters(row, computedFilters));
      const pageCandidates = applyCursorToSortedItems(allItems, cursor);
      const hasMore = pageCandidates.length > limit;
      const items = pageCandidates.slice(0, limit);
      const lastInPage = items[items.length - 1];
      const nextCursor = hasMore && lastInPage
        ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id })
        : null;
      const summary = !cursor ? buildCutterHistorySummary(allItems) : null;
      return res.json({ items, hasMore, nextCursor, summary });
    }

    const rowsRaw = await model.findMany({
      where: wherePage,
      include: issueIncludesForProcess(process),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rowsRaw.length > limit;
    const page = rowsRaw.slice(0, limit);
    const pageWithUsers = await resolveUserFields(page);
    const pageWithItems = await attachItemNamesToIssueRows(pageWithUsers);
    const issueIds = pageWithItems.map(r => r.id);
    const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds(process, issueIds);
    const wastageByIssueId = process === 'cutter'
      ? await buildCutterIssueWastageByIssueId(pageWithItems)
      : new Map();
    const items = pageWithItems.map((r) => mapIssueRow(process, r, { takeBackTotalsByIssueId, wastageByIssueId }));
    const lastInPage = pageWithItems[pageWithItems.length - 1];
    const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;

    // Summary for footer totals (full filter context, not just page).
    let summary = null;
    const issueTable = process === 'holo' ? prisma.issueToHoloMachine : process === 'coning' ? prisma.issueToConingMachine : prisma.issueToCutterMachine;
    const baseAgg = process === 'cutter'
      ? await prisma.issueToCutterMachine.aggregate({ where: whereAll, _sum: { count: true, totalWeight: true } })
      : process === 'holo'
        ? await prisma.issueToHoloMachine.aggregate({ where: whereAll, _sum: { metallicBobbins: true, metallicBobbinsWeight: true, yarnKg: true, rollsProducedEstimate: true } })
        : await prisma.issueToConingMachine.aggregate({ where: whereAll, _sum: { rollsIssued: true } });

    // Taken-back totals: chunk through matching issue ids to avoid huge IN lists.
    let takenBackWeightTotal = 0;
    let takenBackCountTotal = 0;
    let coningIssuedWeightTotal = 0;
    let coningRollsIssuedTotal = 0;
    const chunkSize = 5000;
    let loopCursor = null;
    // Use same stable ordering.
    // NOTE: this is still far cheaper than returning full issue graphs to the client.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batchWhere = loopCursor ? applyCursorWhere(whereAll, buildCursorWhere(loopCursor)) : whereAll;
      const batch = await issueTable.findMany({
        where: batchWhere,
        select: process === 'coning'
          ? { id: true, createdAt: true, receivedRowRefs: true }
          : { id: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: chunkSize,
      });
      if (!batch.length) break;
      if (process === 'coning') {
        batch.forEach((b) => {
          const refs = normalizeReceivedRowRefs(b.receivedRowRefs);
          coningIssuedWeightTotal += refs.reduce((sum, ref) => sum + Number(ref?.issueWeight || 0), 0);
          coningRollsIssuedTotal += refs.reduce((sum, ref) => sum + Number(ref?.issueRolls || ref?.baseRolls || 0), 0);
        });
      }
      const ids = batch.map(b => b.id);
      const tbAgg = await prisma.issueTakeBack.aggregate({
        where: { stage: process, isReverse: false, isReversed: false, issueId: { in: ids } },
        _sum: { totalWeight: true, totalCount: true },
      });
      takenBackWeightTotal += Number(tbAgg?._sum?.totalWeight || 0);
      takenBackCountTotal += Number(tbAgg?._sum?.totalCount || 0);
      const lastInBatch = batch[batch.length - 1];
      loopCursor = { createdAt: lastInBatch.createdAt, id: lastInBatch.id };
      if (batch.length < chunkSize) break;
    }

    if (process === 'cutter') {
      const weight = Number(baseAgg?._sum?.totalWeight || 0);
      summary = {
        qty: Number(baseAgg?._sum?.count || 0),
        weight,
        takenBackCount: takenBackCountTotal,
        takenBackWeight: takenBackWeightTotal,
        netIssuedWeight: Math.max(0, weight - takenBackWeightTotal),
      };
    } else if (process === 'holo') {
      const issued = Number(baseAgg?._sum?.metallicBobbinsWeight || 0);
      summary = {
        metallicBobbins: Number(baseAgg?._sum?.metallicBobbins || 0),
        metallicBobbinsWeight: issued,
        yarnKg: Number(baseAgg?._sum?.yarnKg || 0),
        rollsProducedEstimate: Number(baseAgg?._sum?.rollsProducedEstimate || 0),
        takenBackCount: takenBackCountTotal,
        takenBackWeight: takenBackWeightTotal,
        netIssuedWeight: Math.max(0, issued - takenBackWeightTotal),
      };
    } else {
      summary = {
        rollsIssued: coningRollsIssuedTotal || Number(baseAgg?._sum?.rollsIssued || 0),
        originalIssuedWeight: coningIssuedWeightTotal,
        takenBackCount: takenBackCountTotal,
        takenBackWeight: takenBackWeightTotal,
        netIssuedWeight: Math.max(0, coningIssuedWeightTotal - takenBackWeightTotal),
      };
    }

    res.json({
      items,
      hasMore,
      nextCursor,
      summary,
    });
  } catch (err) {
    console.error('v2 issue tracking error', err);
    res.status(500).json({ error: err.message || 'Failed to load issue tracking' });
  }
});

router.get('/issue/:process/tracking/facets', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const excludeField = String(req.query.excludeField || '').trim();
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const model = issueModelForProcess(process);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(filters, ISSUE_FILTERS, { excludeField });
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length ? { AND: filterWhere } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };

    // Facets are intentionally limited to keep the query fast.
    // UI only needs distinct values for dropdowns.
    const [machines, operators, items, cuts, yarns, twists] = await Promise.all([
      prisma.machine.findMany({ select: { name: true }, where: { name: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.operator.findMany({ select: { name: true }, where: { name: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, where: { name: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, where: { name: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.yarn.findMany({ select: { name: true }, where: { name: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.twist.findMany({ select: { name: true }, where: { name: { not: null } }, orderBy: { name: 'asc' } }),
    ]);

    // NOTE: The above uses master tables (global facets) to preserve current dropdown behavior even when paging.
    // If you want truly context-filtered facets later, we can add per-field distinct-from-where queries.
    res.json({
      facets: {
        machine: machines.map(r => r.name).filter(Boolean),
        operator: operators.map(r => r.name).filter(Boolean),
        item: items.map(r => r.name).filter(Boolean),
        cut: cuts.map(r => r.name).filter(Boolean),
        yarn: yarns.map(r => r.name).filter(Boolean),
        twist: twists.map(r => r.name).filter(Boolean),
      },
      meta: { process, excludeField, whereApplied: Boolean(where) },
    });
  } catch (err) {
    console.error('v2 issue facets error', err);
    res.status(500).json({ error: err.message || 'Failed to load facets' });
  }
});

router.get('/issue/:process/tracking/export.json', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const model = issueModelForProcess(process);
    const { rawFilters, computedFilters } = process === 'cutter'
      ? splitCutterHistoryFilters(filters)
      : { rawFilters: filters, computedFilters: [] };
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(rawFilters, ISSUE_FILTERS);
    const itemFilterWhere = await buildItemWhereFromSheetFilters(rawFilters, { mode: 'issue' });
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const itemSearchIds = await itemIdsByNameContains(search);
    if (itemSearchIds.length) searchOr.push({ itemId: { in: itemSearchIds } });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || itemFilterWhere.length ? { AND: [...filterWhere, ...itemFilterWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const rowsRaw = await model.findMany({
      where,
      include: issueIncludesForProcess(process),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const rowsWithUsers = await resolveUserFields(rowsRaw);
    const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
    const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds(process, rowsWithItems.map(r => r.id));
    const wastageByIssueId = process === 'cutter'
      ? await buildCutterIssueWastageByIssueId(rowsWithItems)
      : new Map();
    const items = rowsWithItems
      .map((r) => mapIssueRow(process, r, { takeBackTotalsByIssueId, wastageByIssueId }))
      .filter((row) => process !== 'cutter' || matchesCutterHistoryComputedFilters(row, computedFilters));
    res.json({ items });
  } catch (err) {
    console.error('v2 issue export error', err);
    res.status(500).json({ error: err.message || 'Failed to export' });
  }
});

// -------------------- Receive History --------------------

function receiveModelForProcess(process) {
  if (process === 'holo') return prisma.receiveFromHoloMachineRow;
  if (process === 'coning') return prisma.receiveFromConingMachineRow;
  return prisma.receiveFromCutterMachineRow;
}

function receiveIncludesForProcess(process) {
  if (process === 'cutter') {
    return { bobbin: true, box: true, operator: true, helper: true, cutMaster: true };
  }
  if (process === 'holo') {
    return { rollType: true, box: true, operator: true, helper: true, issue: { include: { cut: true, yarn: true, twist: true } } };
  }
  return { box: true, operator: true, helper: true, issue: { include: { cut: true, yarn: true, twist: true } } };
}

function pickReceiveSearchFields(process) {
  const base = ['barcode', 'notes', 'createdBy'];
  if (process === 'cutter') base.push('pieceId', 'vchNo', 'itemName', 'yarnName', 'cut');
  if (process !== 'cutter') base.push('issue.lotNo', 'issue.note');
  return base;
}

const RECEIVE_FILTERS = {
  date: {
    in: () => ({}),
    contains: () => ({}),
    between: () => ({}),
  },
  barcode: {
    in: () => ({}),
    contains: (value) => ({ barcode: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  machine: {
    in: (values) => ({ machineNo: { in: values } }),
    contains: (value) => ({ machineNo: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  operator: {
    in: (values) => ({ operator: { name: { in: values } } }),
    contains: (value) => ({ operator: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  // Cutter UI uses `employee` column id; legacy rows may have either `operator.name` or `employee` string set.
  employee: {
    in: (values) => ({
      OR: [
        { operator: { name: { in: values } } },
        { employee: { in: values } },
      ],
    }),
    contains: (value) => ({
      OR: [
        { operator: { name: { contains: value, mode: 'insensitive' } } },
        { employee: { contains: value, mode: 'insensitive' } },
      ],
    }),
    between: () => ({}),
  },
  helper: {
    in: (values) => ({ helper: { name: { in: values } } }),
    contains: (value) => ({ helper: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  box: {
    in: (values) => ({ box: { name: { in: values } } }),
    contains: (value) => ({ box: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  cut: {
    in: (values) => ({ issue: { cut: { name: { in: values } } } }),
    contains: (value) => ({ issue: { cut: { name: { contains: value, mode: 'insensitive' } } } }),
    between: () => ({}),
  },
  yarn: {
    in: (values) => ({ issue: { yarn: { name: { in: values } } } }),
    contains: (value) => ({ issue: { yarn: { name: { contains: value, mode: 'insensitive' } } } }),
    between: () => ({}),
  },
  twist: {
    in: (values) => ({ issue: { twist: { name: { in: values } } } }),
    contains: (value) => ({ issue: { twist: { name: { contains: value, mode: 'insensitive' } } } }),
    between: () => ({}),
  },
};

function mapReceiveRow(process, row, extras = {}) {
  const base = { ...row };
  if (process === 'holo' || process === 'coning') {
    base.itemName = row.issue?.itemName || '';
    base.cutName = row.issue?.cut?.name || '';
    base.yarnName = row.issue?.yarn?.name || '';
    base.twistName = row.issue?.twist?.name || '';
    if (process === 'coning') {
      // Coning-specific fields are needed for immediate, correct first-render in Receive History.
      // Returning them from v2 eliminates UI dependence on late-loaded legacy module data.
      base.perConeTargetG = Number(row.issue?.requiredPerConeNetWeight || 0);
      base.coneTypeName = extras.coneTypeName || '';
    }
    if (Array.isArray(extras.computedPieceIds)) {
      base.computedPieceIds = extras.computedPieceIds;
    }
  }
  return base;
}

async function fetchConeTypeNameByIssueIdForConingReceiveRows(rows = []) {
  const coneTypeIdByIssueId = new Map();
  const coneTypeIds = new Set();

  for (const row of rows || []) {
    const issue = row?.issue;
    const issueId = row?.issueId || issue?.id;
    if (!issueId) continue;
    const refs = normalizeReceivedRowRefs(issue?.receivedRowRefs);
    const coneTypeId = refs?.[0]?.coneTypeId;
    if (!coneTypeId) continue;
    const normalizedConeTypeId = String(coneTypeId);
    coneTypeIdByIssueId.set(String(issueId), normalizedConeTypeId);
    coneTypeIds.add(normalizedConeTypeId);
  }

  if (!coneTypeIds.size) return new Map();

  const coneTypes = await prisma.coneType.findMany({
    where: { id: { in: Array.from(coneTypeIds) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(coneTypes.map((c) => [String(c.id), c.name || '']));

  const out = new Map();
  for (const [issueId, coneTypeId] of coneTypeIdByIssueId.entries()) {
    out.set(issueId, nameById.get(coneTypeId) || '');
  }
  return out;
}

router.get('/receive/:process/history', requireAuth, requireStageReadPermission(receiveStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const model = receiveModelForProcess(process);
    const cursorWhere = buildCursorWhere(cursor);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(filters, RECEIVE_FILTERS);
    const itemFilterWhere = process === 'cutter' ? [] : await buildItemWhereFromSheetFilters(filters, { mode: 'receive' });
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    if (process !== 'cutter') {
      const itemSearchIds = await itemIdsByNameContains(search);
      if (itemSearchIds.length) searchOr.push({ issue: { itemId: { in: itemSearchIds } } });
    }
    const whereAll = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || itemFilterWhere.length ? { AND: [...filterWhere, ...itemFilterWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const wherePage = applyCursorWhere(whereAll, cursorWhere);

    const rowsRaw = await model.findMany({
      where: wherePage,
      include: receiveIncludesForProcess(process),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rowsRaw.length > limit;
    const page = rowsRaw.slice(0, limit);
    const pageWithUsers = await resolveUserFields(page);
    const pageWithItems = process === 'cutter' ? pageWithUsers : await attachItemNamesToReceiveRows(pageWithUsers);

    let items = pageWithItems;
    if (process === 'holo') {
      const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(items.map(r => r.issueId));
      items = items.map((r) => mapReceiveRow(process, r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
    } else if (process === 'coning') {
      const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(items.map(r => r.issueId));
      const coneTypeNameByIssueId = await fetchConeTypeNameByIssueIdForConingReceiveRows(items);
      items = items.map((r) => mapReceiveRow(process, r, {
        computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [],
        coneTypeName: coneTypeNameByIssueId.get(String(r.issueId)) || '',
      }));
    } else {
      items = items.map((r) => mapReceiveRow(process, r));
    }

    const lastInPage = pageWithUsers[pageWithUsers.length - 1];
    const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
    // Summary totals for footer
    let summary = null;
    if (process === 'cutter') {
      const agg = await prisma.receiveFromCutterMachineRow.aggregate({
        where: whereAll,
        _sum: { netWt: true, bobbinQuantity: true },
      });
      summary = {
        netWt: Number(agg?._sum?.netWt || 0),
        bobbinQty: Number(agg?._sum?.bobbinQuantity || 0),
      };
    } else if (process === 'holo') {
      const agg = await prisma.receiveFromHoloMachineRow.aggregate({
        where: whereAll,
        _sum: { rollCount: true, rollWeight: true },
      });
      summary = {
        rolls: Number(agg?._sum?.rollCount || 0),
        weight: Number(agg?._sum?.rollWeight || 0),
      };
    } else if (process === 'coning') {
      const agg = await prisma.receiveFromConingMachineRow.aggregate({
        where: whereAll,
        _sum: { coneCount: true, netWeight: true },
      });
      summary = {
        cones: Number(agg?._sum?.coneCount || 0),
        weight: Number(agg?._sum?.netWeight || 0),
      };
    }

    res.json({ items, hasMore, nextCursor, summary });
  } catch (err) {
    console.error('v2 receive history error', err);
    res.status(500).json({ error: err.message || 'Failed to load receive history' });
  }
});

router.get('/receive/:process/history/facets', requireAuth, requireStageReadPermission(receiveStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const excludeField = String(req.query.excludeField || '').trim();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const model = receiveModelForProcess(process);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(filters, RECEIVE_FILTERS, { excludeField });
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length ? { AND: filterWhere } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    // Global facets: from masters + operators; consistent with paging.
    const [machines, operators, helpers, items, cuts, yarns, twists, boxes] = await Promise.all([
      prisma.machine.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.box.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    ]);
    // `where` is currently unused; keeping it for future context-filtered facets.
    void where;
    void model;
    res.json({
      facets: {
        machine: machines.map(r => r.name).filter(Boolean),
        operator: operators.map(r => r.name).filter(Boolean),
        employee: operators.map(r => r.name).filter(Boolean),
        helper: helpers.map(r => r.name).filter(Boolean),
        item: items.map(r => r.name).filter(Boolean),
        cut: cuts.map(r => r.name).filter(Boolean),
        yarn: yarns.map(r => r.name).filter(Boolean),
        twist: twists.map(r => r.name).filter(Boolean),
        box: boxes.map(r => r.name).filter(Boolean),
      },
      meta: { process, excludeField },
    });
  } catch (err) {
    console.error('v2 receive facets error', err);
    res.status(500).json({ error: err.message || 'Failed to load facets' });
  }
});

router.get('/receive/:process/history/export.json', requireAuth, requireStageReadPermission(receiveStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const model = receiveModelForProcess(process);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(filters, RECEIVE_FILTERS);
    const itemFilterWhere = process === 'cutter' ? [] : await buildItemWhereFromSheetFilters(filters, { mode: 'receive' });
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    if (process !== 'cutter') {
      const itemSearchIds = await itemIdsByNameContains(search);
      if (itemSearchIds.length) searchOr.push({ issue: { itemId: { in: itemSearchIds } } });
    }
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || itemFilterWhere.length ? { AND: [...filterWhere, ...itemFilterWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const rowsRaw = await model.findMany({
      where,
      include: receiveIncludesForProcess(process),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const rowsWithUsers = await resolveUserFields(rowsRaw);
    const rowsWithItems = process === 'cutter' ? rowsWithUsers : await attachItemNamesToReceiveRows(rowsWithUsers);

    let items = rowsWithItems;
    if (process === 'holo') {
      const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(items.map(r => r.issueId));
      items = items.map((r) => mapReceiveRow(process, r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
    } else if (process === 'coning') {
      const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(items.map(r => r.issueId));
      const coneTypeNameByIssueId = await fetchConeTypeNameByIssueIdForConingReceiveRows(items);
      items = items.map((r) => mapReceiveRow(process, r, {
        computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [],
        coneTypeName: coneTypeNameByIssueId.get(String(r.issueId)) || '',
      }));
    } else {
      items = items.map((r) => mapReceiveRow(process, r));
    }

    res.json({ items });
  } catch (err) {
    console.error('v2 receive export error', err);
    res.status(500).json({ error: err.message || 'Failed to export' });
  }
});

// -------------------- Opening Stock History --------------------

router.get('/opening-stock/:stage/history', requireAuth, requirePermission('opening_stock', PERM_READ), async (req, res) => {
  const stage = String(req.params.stage || '').trim().toLowerCase();
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    if (stage === 'inbound') {
      const cursorWhere = buildCursorWhere(cursor);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'createdAt' });
      const q = normalizeText(search);
      const baseWhere = {
        isOpeningStock: true,
        ...(dateWhere ? dateWhere : {}),
        ...(q ? {
          OR: [
            { lotNo: { contains: q, mode: 'insensitive' } },
            { id: { contains: q, mode: 'insensitive' } },
            { status: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      };
      const where = applyCursorWhere(baseWhere, cursorWhere);
      const rows = await prisma.inboundItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      res.json({ items: page, hasMore, nextCursor, summary: null });
      return;
    }

    if (stage === 'cutter') {
      const model = prisma.receiveFromCutterMachineRow;
      const cursorWhere = buildCursorWhere(cursor);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
      const q = normalizeText(search);
      const baseWhere = {
        isDeleted: false,
        pieceId: { startsWith: 'OP-' },
        ...(dateWhere ? dateWhere : {}),
        ...(q ? {
          OR: [
            { pieceId: { contains: q, mode: 'insensitive' } },
            { barcode: { contains: q, mode: 'insensitive' } },
            { vchNo: { contains: q, mode: 'insensitive' } },
            { itemName: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      };
      const where = applyCursorWhere(baseWhere, cursorWhere);
      const rowsRaw = await model.findMany({
        where,
        include: { bobbin: true, cutMaster: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rowsRaw.length > limit;
      const page = rowsRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const last = pageWithUsers[pageWithUsers.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      res.json({ items: pageWithUsers, hasMore, nextCursor, summary: null });
      return;
    }

    if (stage === 'holo') {
      const cursorWhere = buildCursorWhere(cursor);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
      const q = normalizeText(search);
      const itemSearchIds = await itemIdsByNameContains(q);
      const baseWhere = {
        isDeleted: false,
        ...(dateWhere ? dateWhere : {}),
        issue: { lotNo: { startsWith: 'OP-' }, isDeleted: false },
        ...(q ? {
          OR: [
            { barcode: { contains: q, mode: 'insensitive' } },
            { issue: { lotNo: { contains: q, mode: 'insensitive' } } },
            { issue: { note: { contains: q, mode: 'insensitive' } } },
            ...(itemSearchIds.length ? [{ issue: { itemId: { in: itemSearchIds } } }] : []),
          ],
        } : {}),
      };
      const where = applyCursorWhere(baseWhere, cursorWhere);
      const rowsRaw = await prisma.receiveFromHoloMachineRow.findMany({
        where,
        include: { rollType: true, issue: { include: { cut: true, yarn: true, twist: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rowsRaw.length > limit;
      const page = rowsRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToReceiveRows(pageWithUsers);
      const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(pageWithItems.map(r => r.issueId));
      const items = pageWithItems.map((r) => mapReceiveRow('holo', r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      res.json({ items, hasMore, nextCursor, summary: null });
      return;
    }

    if (stage === 'coning') {
      const cursorWhere = buildCursorWhere(cursor);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
      const q = normalizeText(search);
      const itemSearchIds = await itemIdsByNameContains(q);
      const baseWhere = {
        isDeleted: false,
        ...(dateWhere ? dateWhere : {}),
        issue: { lotNo: { startsWith: 'OP-' }, isDeleted: false },
        ...(q ? {
          OR: [
            { barcode: { contains: q, mode: 'insensitive' } },
            { issue: { lotNo: { contains: q, mode: 'insensitive' } } },
            { issue: { note: { contains: q, mode: 'insensitive' } } },
            ...(itemSearchIds.length ? [{ issue: { itemId: { in: itemSearchIds } } }] : []),
          ],
        } : {}),
      };
      const where = applyCursorWhere(baseWhere, cursorWhere);
      const rowsRaw = await prisma.receiveFromConingMachineRow.findMany({
        where,
        include: { issue: { include: { cut: true, yarn: true, twist: true } }, box: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rowsRaw.length > limit;
      const page = rowsRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToReceiveRows(pageWithUsers);
      const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(pageWithItems.map(r => r.issueId));
      const items = pageWithItems.map((r) => mapReceiveRow('coning', r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      res.json({ items, hasMore, nextCursor, summary: null });
      return;
    }

    res.status(400).json({ error: 'Invalid stage' });
  } catch (err) {
    console.error('v2 opening stock history error', err);
    res.status(500).json({ error: err.message || 'Failed to load opening stock history' });
  }
});

router.get('/opening-stock/:stage/history/export.json', requireAuth, requirePermission('opening_stock', PERM_READ), async (req, res) => {
  const stage = String(req.params.stage || '').trim().toLowerCase();
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;
  try {
    // Export uses "history" endpoint without pagination.
    const fakeReq = { ...req, query: { ...req.query, limit: String(MAX_LIMIT), cursor: null } };
    void fakeReq;
    // Keep it simple: call the same logic via direct queries (no cursor).
    if (stage === 'inbound') {
      const q = normalizeText(search);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'createdAt' });
      const where = {
        isOpeningStock: true,
        ...(dateWhere ? dateWhere : {}),
        ...(q ? {
          OR: [
            { lotNo: { contains: q, mode: 'insensitive' } },
            { id: { contains: q, mode: 'insensitive' } },
            { status: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      };
      const rows = await prisma.inboundItem.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      res.json({ items: rows });
      return;
    }
    if (stage === 'cutter') {
      const q = normalizeText(search);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
      const where = {
        isDeleted: false,
        pieceId: { startsWith: 'OP-' },
        ...(dateWhere ? dateWhere : {}),
        ...(q ? {
          OR: [
            { pieceId: { contains: q, mode: 'insensitive' } },
            { barcode: { contains: q, mode: 'insensitive' } },
            { vchNo: { contains: q, mode: 'insensitive' } },
            { itemName: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      };
      const rowsRaw = await prisma.receiveFromCutterMachineRow.findMany({
        where,
        include: { bobbin: true, cutMaster: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const rows = await resolveUserFields(rowsRaw);
      res.json({ items: rows });
      return;
    }
    if (stage === 'holo') {
      const q = normalizeText(search);
      const itemSearchIds = await itemIdsByNameContains(q);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
      const where = {
        isDeleted: false,
        issue: { lotNo: { startsWith: 'OP-' }, isDeleted: false },
        ...(dateWhere ? dateWhere : {}),
        ...(q ? {
          OR: [
            { barcode: { contains: q, mode: 'insensitive' } },
            { issue: { lotNo: { contains: q, mode: 'insensitive' } } },
            { issue: { note: { contains: q, mode: 'insensitive' } } },
            ...(itemSearchIds.length ? [{ issue: { itemId: { in: itemSearchIds } } }] : []),
          ],
        } : {}),
      };
      const rowsRaw = await prisma.receiveFromHoloMachineRow.findMany({
        where,
        include: { rollType: true, issue: { include: { cut: true, yarn: true, twist: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rows = await attachItemNamesToReceiveRows(rowsWithUsers);
      const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(rows.map(r => r.issueId));
      res.json({ items: rows.map(r => mapReceiveRow('holo', r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] })) });
      return;
    }
    if (stage === 'coning') {
      const q = normalizeText(search);
      const itemSearchIds = await itemIdsByNameContains(q);
      const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
      const where = {
        isDeleted: false,
        issue: { lotNo: { startsWith: 'OP-' }, isDeleted: false },
        ...(dateWhere ? dateWhere : {}),
        ...(q ? {
          OR: [
            { barcode: { contains: q, mode: 'insensitive' } },
            { issue: { lotNo: { contains: q, mode: 'insensitive' } } },
            { issue: { note: { contains: q, mode: 'insensitive' } } },
            ...(itemSearchIds.length ? [{ issue: { itemId: { in: itemSearchIds } } }] : []),
          ],
        } : {}),
      };
      const rowsRaw = await prisma.receiveFromConingMachineRow.findMany({
        where,
        include: { issue: { include: { cut: true, yarn: true, twist: true } }, box: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rows = await attachItemNamesToReceiveRows(rowsWithUsers);
      const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(rows.map(r => r.issueId));
      res.json({ items: rows.map(r => mapReceiveRow('coning', r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] })) });
      return;
    }
    res.status(400).json({ error: 'Invalid stage' });
  } catch (err) {
    console.error('v2 opening export error', err);
    res.status(500).json({ error: err.message || 'Failed to export' });
  }
});

// -------------------- On Machine (Pending) --------------------

router.get('/on-machine/:process', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;

  try {
    const cursorWhere = buildCursorWhere(cursor);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const searchOr = buildSearchOr({
      search,
      fields: ['barcode', 'lotNo', 'note', 'machine.name', 'operator.name'],
    });
    const itemSearchIds = await itemIdsByNameContains(search);
    if (itemSearchIds.length) searchOr.push({ itemId: { in: itemSearchIds } });

    // whereAll = all filters WITHOUT cursor (for summary across entire dataset)
    const whereAll = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };

    // Column filters are supported for the same ids used in OnMachineTable (subset).
    const onMachineFilterWhere = buildFilterWhere(filters, ISSUE_FILTERS);
    const itemFilterWhere = await buildItemWhereFromSheetFilters(filters, { mode: 'issue' });
    const filterAnd = onMachineFilterWhere.length || itemFilterWhere.length
      ? { AND: [...onMachineFilterWhere, ...itemFilterWhere] }
      : {};

    const whereAllFiltered = { ...whereAll, ...filterAnd };

    // where = all filters + cursor (for paginated results)
    const where = applyCursorWhere(whereAllFiltered, cursorWhere);

    // isFirstPage — only compute summary on the first page to avoid repeating expensive work
    const isFirstPage = !cursor;

    if (process === 'cutter') {
      const issuesRaw = await prisma.issueToCutterMachine.findMany({
        where,
        include: { cut: true, machine: true, operator: true, lines: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = issuesRaw.length > limit;
      const page = issuesRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToIssueRows(pageWithUsers);
      const issueIds = pageWithItems.map(i => i.id);
      const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds('cutter', issueIds);
      const receiveRows = issueIds.length
        ? await prisma.receiveFromCutterMachineRow.findMany({
          where: { isDeleted: false, issueId: { in: issueIds } },
          select: { issueId: true, pieceId: true, netWt: true },
        })
        : [];
      const receivedByIssue = new Map();
      for (const r of receiveRows) {
        const cur = receivedByIssue.get(r.issueId) || 0;
        receivedByIssue.set(r.issueId, cur + Number(r.netWt || 0));
      }

      const items = pageWithItems.map((issue) => {
        const tb = takeBackTotalsByIssueId.get(issue.id) || { count: 0, weight: 0 };
        const originalIssuedWeight = Number(issue.totalWeight || 0);
        const takeBackWeight = Number(tb.weight || 0);
        const netIssuedWeight = Math.max(0, originalIssuedWeight - takeBackWeight);
        const receivedWeight = Number(receivedByIssue.get(issue.id) || 0);
        const pendingWeight = Math.max(0, netIssuedWeight - receivedWeight);
        const pieceIdsList = Array.isArray(issue.pieceIds)
          ? issue.pieceIds
          : String(issue.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
        return {
          ...issue,
          itemName: issue.itemName || '',
          cutName: issue.cut?.name || '',
          machineName: issue.machine?.name || '',
          operatorName: issue.operator?.name || '',
          originalIssuedWeight,
          takeBackWeight,
          netIssuedWeight,
          issuedWeight: netIssuedWeight,
          receivedWeight,
          wastageWeight: 0,
          pendingWeight,
          pieceIdsList,
        };
      }).filter(i => i.pendingWeight > 0.001);

      // Compute grand-total summary on first page only
      let summary = null;
      if (isFirstPage) {
        const allIssues = await prisma.issueToCutterMachine.findMany({
          where: whereAllFiltered,
          select: { id: true, totalWeight: true },
        });
        const allIds = allIssues.map(i => i.id);
        const allTb = await fetchTakeBackTotalsByIssueIds('cutter', allIds);
        const allRecv = allIds.length
          ? await prisma.receiveFromCutterMachineRow.findMany({
            where: { isDeleted: false, issueId: { in: allIds } },
            select: { issueId: true, netWt: true },
          })
          : [];
        const allRecvMap = new Map();
        for (const r of allRecv) {
          allRecvMap.set(r.issueId, (allRecvMap.get(r.issueId) || 0) + Number(r.netWt || 0));
        }
        const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, pendingWeight: 0 };
        for (const issue of allIssues) {
          const tb = allTb.get(issue.id) || { weight: 0 };
          const orig = Number(issue.totalWeight || 0);
          const tbW = Number(tb.weight || 0);
          const net = Math.max(0, orig - tbW);
          const recv = Number(allRecvMap.get(issue.id) || 0);
          const pend = Math.max(0, net - recv);
          if (pend <= 0.001) continue; // skip fully received
          s.originalIssuedWeight += orig;
          s.takeBackWeight += tbW;
          s.netIssuedWeight += net;
          s.receivedWeight += recv;
          s.pendingWeight += pend;
        }
        summary = s;
      }

      const lastInPage = pageWithItems[pageWithItems.length - 1];
      const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
      res.json({ items, hasMore, nextCursor, summary });
      return;
    }

    if (process === 'holo') {
      const issuesRaw = await prisma.issueToHoloMachine.findMany({
        where,
        include: { cut: true, machine: true, operator: true, yarn: true, twist: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = issuesRaw.length > limit;
      const page = issuesRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToIssueRows(pageWithUsers);
      const issueIds = pageWithItems.map(i => i.id);
      const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds('holo', issueIds);
      const receiveRows = issueIds.length
        ? await prisma.receiveFromHoloMachineRow.findMany({
          where: { isDeleted: false, issueId: { in: issueIds } },
          include: { rollType: true },
        })
        : [];
      const receivedByIssue = new Map();
      const wastageByIssue = new Map();
      for (const r of receiveRows) {
        const netWeight = Number.isFinite(r.rollWeight)
          ? Number(r.rollWeight)
          : (Number(r.grossWeight || 0) - Number(r.tareWeight || 0));
        const isWastage = String(r.rollType?.name || '').toLowerCase().includes('wastage');
        if (isWastage) {
          wastageByIssue.set(r.issueId, (wastageByIssue.get(r.issueId) || 0) + netWeight);
        } else {
          receivedByIssue.set(r.issueId, (receivedByIssue.get(r.issueId) || 0) + netWeight);
        }
      }
      const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(issueIds);

      const items = pageWithItems.map((issue) => {
        const tb = takeBackTotalsByIssueId.get(issue.id) || { count: 0, weight: 0 };
        const originalIssuedWeight = Number(issue.metallicBobbinsWeight || 0);
        const takeBackWeight = Number(tb.weight || 0);
        const netIssuedWeight = Math.max(0, originalIssuedWeight - takeBackWeight);
        const receivedWeight = Number(receivedByIssue.get(issue.id) || 0);
        const wastageWeight = Number(wastageByIssue.get(issue.id) || 0);
        const pendingWeight = Math.max(0, netIssuedWeight - receivedWeight - wastageWeight);
        return {
          ...issue,
          itemName: issue.itemName || '',
          cutName: issue.cut?.name || '',
          yarnName: issue.yarn?.name || '',
          twistName: issue.twist?.name || '',
          machineName: issue.machine?.name || '',
          operatorName: issue.operator?.name || '',
          originalIssuedWeight,
          takeBackWeight,
          netIssuedWeight,
          issuedWeight: netIssuedWeight,
          receivedWeight,
          wastageWeight,
          pendingWeight,
          pieceIdsList: pieceIdsByIssueId.get(issue.id) || [],
        };
      }).filter(i => i.pendingWeight > 0.001);

      // Compute grand-total summary on first page only
      let summary = null;
      if (isFirstPage) {
        const allIssues = await prisma.issueToHoloMachine.findMany({
          where: whereAllFiltered,
          select: { id: true, metallicBobbinsWeight: true },
        });
        const allIds = allIssues.map(i => i.id);
        const allTb = await fetchTakeBackTotalsByIssueIds('holo', allIds);
        const allRecvRows = allIds.length
          ? await prisma.receiveFromHoloMachineRow.findMany({
            where: { isDeleted: false, issueId: { in: allIds } },
            include: { rollType: true },
          })
          : [];
        const allRecvMap = new Map();
        const allWasteMap = new Map();
        for (const r of allRecvRows) {
          const nw = Number.isFinite(r.rollWeight)
            ? Number(r.rollWeight)
            : (Number(r.grossWeight || 0) - Number(r.tareWeight || 0));
          const isW = String(r.rollType?.name || '').toLowerCase().includes('wastage');
          if (isW) {
            allWasteMap.set(r.issueId, (allWasteMap.get(r.issueId) || 0) + nw);
          } else {
            allRecvMap.set(r.issueId, (allRecvMap.get(r.issueId) || 0) + nw);
          }
        }
        const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, pendingWeight: 0 };
        for (const issue of allIssues) {
          const tb = allTb.get(issue.id) || { weight: 0 };
          const orig = Number(issue.metallicBobbinsWeight || 0);
          const tbW = Number(tb.weight || 0);
          const net = Math.max(0, orig - tbW);
          const recv = Number(allRecvMap.get(issue.id) || 0);
          const waste = Number(allWasteMap.get(issue.id) || 0);
          const pend = Math.max(0, net - recv - waste);
          if (pend <= 0.001) continue;
          s.originalIssuedWeight += orig;
          s.takeBackWeight += tbW;
          s.netIssuedWeight += net;
          s.receivedWeight += recv;
          s.pendingWeight += pend;
        }
        summary = s;
      }

      const lastInPage = pageWithItems[pageWithItems.length - 1];
      const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
      res.json({ items, hasMore, nextCursor, summary });
      return;
    }

    // coning
    const issuesRaw = await prisma.issueToConingMachine.findMany({
      where,
      include: { cut: true, machine: true, operator: true, yarn: true, twist: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = issuesRaw.length > limit;
    const page = issuesRaw.slice(0, limit);
    const pageWithUsers = await resolveUserFields(page);
    const pageWithItems = await attachItemNamesToIssueRows(pageWithUsers);
    const issueIds = pageWithItems.map(i => i.id);
    const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds('coning', issueIds);
    const receiveRows = issueIds.length
      ? await prisma.receiveFromConingMachineRow.findMany({
        where: { isDeleted: false, issueId: { in: issueIds } },
        select: { issueId: true, netWeight: true },
      })
      : [];
    const receivedByIssue = new Map();
    for (const r of receiveRows) {
      receivedByIssue.set(r.issueId, (receivedByIssue.get(r.issueId) || 0) + Number(r.netWeight || 0));
    }
    const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(issueIds);
    const coneTypeIds = new Set();
    for (const issue of pageWithItems) {
      const refs = normalizeReceivedRowRefs(issue.receivedRowRefs);
      refs.forEach((ref) => {
        if (ref?.coneTypeId) coneTypeIds.add(ref.coneTypeId);
      });
    }
    const coneTypes = coneTypeIds.size
      ? await prisma.coneType.findMany({
        where: { id: { in: Array.from(coneTypeIds) } },
        select: { id: true, name: true },
      })
      : [];
    const coneTypeNameById = new Map(coneTypes.map((c) => [c.id, c.name]));

    const items = pageWithItems.map((issue) => {
      const refs = normalizeReceivedRowRefs(issue.receivedRowRefs);
      const originalIssuedWeight = refs.reduce((sum, ref) => sum + Number(ref?.issueWeight || 0), 0);
      const rollsIssued = refs.reduce((sum, ref) => sum + Number(ref?.issueRolls || ref?.baseRolls || 0), 0);
      const coneTypeName = (() => {
        if (!refs.length) return '';
        const ids = new Set(refs.map((ref) => ref?.coneTypeId).filter(Boolean));
        if (!ids.size) return '';
        return Array.from(ids).map((id) => coneTypeNameById.get(id) || id).join(', ');
      })();
      const tb = takeBackTotalsByIssueId.get(issue.id) || { count: 0, weight: 0 };
      const takeBackWeight = Number(tb.weight || 0);
      const netIssuedWeight = Math.max(0, originalIssuedWeight - takeBackWeight);
      const receivedWeight = Number(receivedByIssue.get(issue.id) || 0);
      const pendingWeight = Math.max(0, netIssuedWeight - receivedWeight);
      return {
        ...issue,
        itemName: issue.itemName || '',
        cutName: issue.cut?.name || '',
        yarnName: issue.yarn?.name || '',
        twistName: issue.twist?.name || '',
        machineName: issue.machine?.name || '',
        operatorName: issue.operator?.name || '',
        originalIssuedWeight,
        takeBackWeight,
        netIssuedWeight,
        issuedWeight: netIssuedWeight,
        rollsIssued,
        coneTypeName,
        perConeTargetG: Number(issue.requiredPerConeNetWeight || 0),
        receivedWeight,
        wastageWeight: 0,
        pendingWeight,
        pieceIdsList: pieceIdsByIssueId.get(issue.id) || [],
      };
    }).filter(i => i.pendingWeight > 0.001);

    // Compute grand-total summary on first page only
    let summary = null;
    if (isFirstPage) {
      const allIssues = await prisma.issueToConingMachine.findMany({
        where: whereAllFiltered,
        select: { id: true, receivedRowRefs: true },
      });
      const allIds = allIssues.map(i => i.id);
      const allTb = await fetchTakeBackTotalsByIssueIds('coning', allIds);
      const allRecv = allIds.length
        ? await prisma.receiveFromConingMachineRow.findMany({
          where: { isDeleted: false, issueId: { in: allIds } },
          select: { issueId: true, netWeight: true },
        })
        : [];
      const allRecvMap = new Map();
      for (const r of allRecv) {
        allRecvMap.set(r.issueId, (allRecvMap.get(r.issueId) || 0) + Number(r.netWeight || 0));
      }
      const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, pendingWeight: 0, rollsIssued: 0 };
      for (const issue of allIssues) {
        const refs = normalizeReceivedRowRefs(issue.receivedRowRefs);
        const orig = refs.reduce((sum, ref) => sum + Number(ref?.issueWeight || 0), 0);
        const rolls = refs.reduce((sum, ref) => sum + Number(ref?.issueRolls || ref?.baseRolls || 0), 0);
        const tb = allTb.get(issue.id) || { weight: 0 };
        const tbW = Number(tb.weight || 0);
        const net = Math.max(0, orig - tbW);
        const recv = Number(allRecvMap.get(issue.id) || 0);
        const pend = Math.max(0, net - recv);
        if (pend <= 0.001) continue;
        s.originalIssuedWeight += orig;
        s.takeBackWeight += tbW;
        s.netIssuedWeight += net;
        s.receivedWeight += recv;
        s.pendingWeight += pend;
        s.rollsIssued += rolls;
      }
      summary = s;
    }

    const lastInPage = pageWithItems[pageWithItems.length - 1];
    const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
    res.json({ items, hasMore, nextCursor, summary });
  } catch (err) {
    console.error('v2 on-machine error', err);
    res.status(500).json({ error: err.message || 'Failed to load on-machine' });
  }
});

router.get('/issue/:process/take-back-history', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = normalizeText(req.query.search);

  try {
    const cursorWhere = buildCursorWhere(cursor);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });

    let searchWhere = {};
    if (search) {
      // 1. Find issues matching barcode/lotNo
      const issueModel = issueModelForProcess(process);
      const matchingIssues = await issueModel.findMany({
        where: {
          OR: [
            { barcode: { contains: search, mode: 'insensitive' } },
            { lotNo: { contains: search, mode: 'insensitive' } }
          ]
        },
        select: { id: true },
        take: 2000
      });
      const issueIds = matchingIssues.map(i => i.id);

      searchWhere = {
        OR: [
          { reason: { contains: search, mode: 'insensitive' } },
          { note: { contains: search, mode: 'insensitive' } },
          { issueId: { in: issueIds } }
        ]
      };
    }

    const whereAll = {
      stage: process,
      isReverse: false,
      isReversed: false,
      ...(dateWhere ? dateWhere : {}),
      ...searchWhere
    };

    const wherePage = applyCursorWhere(whereAll, cursorWhere);

    const rowsRaw = await prisma.issueTakeBack.findMany({
      where: wherePage,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rowsRaw.length > limit;
    const page = rowsRaw.slice(0, limit);
    const pageWithUsers = await resolveUserFields(page);

    // Resolve Issue Details
    const issueIds = Array.from(new Set(page.map(r => r.issueId)));
    let issueMap = new Map();
    
    if (issueIds.length > 0) {
      const issueModel = issueModelForProcess(process);
      const issues = await issueModel.findMany({
        where: { id: { in: issueIds } },
        select: { id: true, barcode: true, lotNo: true, itemId: true }
      });
      
      // Resolve Item Names
      const itemIds = Array.from(new Set(issues.map(i => i.itemId).filter(Boolean)));
      const itemsRef = await prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true }
      });
      const itemNameById = new Map(itemsRef.map(i => [i.id, i.name]));

      issueMap = new Map(issues.map(i => [i.id, { 
        ...i, 
        itemName: itemNameById.get(i.itemId) || '' 
      }]));
    }

    const items = pageWithUsers.map(r => {
      const issue = issueMap.get(r.issueId) || {};
      return {
        ...r,
        issueBarcode: issue.barcode || '',
        issueLotNo: issue.lotNo || '',
        itemName: issue.itemName || '',
      };
    });

    const lastInPage = page[page.length - 1];
    const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;

    res.json({
      items,
      hasMore,
      nextCursor,
    });

  } catch (err) {
    console.error('v2 take-back history error', err);
    res.status(500).json({ error: err.message || 'Failed to load take-back history' });
  }
});

// -----------------------------
// Stock v2 (fast-load, UI-parity)
// -----------------------------

router.get('/stock/:process/lots', requireAuth, requirePermission('stock', PERM_READ), async (req, res) => {
  try {
    const process = String(req.params.process || '').trim().toLowerCase();
    if (!['holo', 'coning'].includes(process)) {
      return res.status(400).json({ error: 'Invalid process' });
    }

    if (process === 'holo') {
      const rows = await prisma.$queryRaw`
        WITH issue_refs AS (
          SELECT i.id AS issue_id, elem->>'rowId' AS cutter_row_id
          FROM "IssueToHoloMachine" i
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem ON true
          WHERE i."isDeleted" = false
        ),
        issue_lots AS (
          SELECT ir.issue_id,
                 array_remove(array_agg(DISTINCT bi."lotNo"), NULL) AS lot_nos
          FROM issue_refs ir
          LEFT JOIN "ReceiveFromCutterMachineRow" cr ON cr.id = ir.cutter_row_id
          LEFT JOIN "InboundItem" bi ON bi.id = cr."pieceId"
          GROUP BY ir.issue_id
        ),
        issue_labels AS (
          SELECT i.id AS issue_id,
                 CASE
                   WHEN COALESCE(array_length(il.lot_nos, 1), 0) = 0 THEN ARRAY[i."lotNo"]::text[]
                   ELSE il.lot_nos
                 END AS lot_nos_final,
                 CASE
                   WHEN COALESCE(array_length(il.lot_nos, 1), 0) <= 1 THEN COALESCE(il.lot_nos[1], i."lotNo", '')
                   WHEN array_length(il.lot_nos, 1) <= 3 THEN 'Mixed (' || array_to_string(il.lot_nos, ', ') || ')'
                   ELSE 'Mixed (' || array_length(il.lot_nos, 1) || ')'
                 END AS lot_label,
                 CASE WHEN COALESCE(array_length(il.lot_nos, 1), 0) > 1 THEN true ELSE false END AS is_mixed
          FROM "IssueToHoloMachine" i
          LEFT JOIN issue_lots il ON il.issue_id = i.id
          WHERE i."isDeleted" = false
        ),
        issued AS (
          SELECT
            elem->>'rowId' AS row_id,
            SUM(CASE WHEN (elem->>'issueRolls') IS NULL OR (elem->>'issueRolls') = '' THEN 0 ELSE (elem->>'issueRolls')::numeric END) AS issue_rolls,
            SUM(CASE WHEN (elem->>'issueWeight') IS NULL OR (elem->>'issueWeight') = '' THEN 0 ELSE (elem->>'issueWeight')::numeric END) AS issue_weight
          FROM "IssueToConingMachine" ic,
            jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem
          WHERE ic."isDeleted" = false
          GROUP BY row_id
        ),
        takeback AS (
          SELECT
            l."sourceId" AS row_id,
            SUM((CASE WHEN tb."isReverse" = true THEN 1 ELSE -1 END) * l."count") AS tb_rolls,
            SUM((CASE WHEN tb."isReverse" = true THEN 1 ELSE -1 END) * l."weight") AS tb_weight
          FROM "IssueTakeBackLine" l
          JOIN "IssueTakeBack" tb ON tb.id = l."takeBackId"
          WHERE tb.stage = 'coning'
          GROUP BY l."sourceId"
        ),
        row_calc AS (
          SELECT
            r.id AS row_id,
            r."issueId" AS issue_id,
            COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD')) AS date_str,
            COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))::numeric AS net_weight,
            COALESCE(r."rollCount", 0)::numeric AS roll_count,
            COALESCE(r."dispatchedCount", 0)::numeric AS dispatched_count,
            COALESCE(r."dispatchedWeight", 0)::numeric AS dispatched_weight,
            (COALESCE(iss.issue_rolls, 0) + COALESCE(tb.tb_rolls, 0))::numeric AS issued_rolls,
            (COALESCE(iss.issue_weight, 0) + COALESCE(tb.tb_weight, 0))::numeric AS issued_weight,
            (st.id IS NOT NULL) AS is_steamed
          FROM "ReceiveFromHoloMachineRow" r
          JOIN "IssueToHoloMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
          LEFT JOIN issued iss ON iss.row_id = r.id
          LEFT JOIN takeback tb ON tb.row_id = r.id
          LEFT JOIN "BoilerSteamLog" st
            ON st."holoReceiveRowId" = r.id OR (st."barcode" IS NOT NULL AND upper(st."barcode") = upper(r."barcode"))
          WHERE r."isDeleted" = false
        )
        SELECT
          il.lot_label AS lot_label,
          il.lot_nos_final AS lot_nos,
          il.is_mixed AS is_mixed,
          i."lotNo" AS lot_no_raw,
          i."itemId" AS item_id,
          i."yarnId" AS yarn_id,
          i."twistId" AS twist_id,
          lot."firmId" AS firm_id,
          lot."supplierId" AS supplier_id,
          it.name AS item_name,
          fm.name AS firm_name,
          sp.name AS supplier_name,
          yn.name AS yarn_name,
          tw.name AS twist_name,
          array_remove(array_agg(DISTINCT COALESCE(ct.name, '—')), NULL) AS cut_names,
          MAX(rc.date_str) AS max_date,
          SUM(GREATEST(0, rc.net_weight - rc.dispatched_weight - rc.issued_weight)) AS total_weight,
          SUM(GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls)) AS total_rolls,
          SUM(CASE WHEN rc.is_steamed THEN GREATEST(0, rc.net_weight - rc.dispatched_weight - rc.issued_weight) ELSE 0 END) AS steamed_weight,
          SUM(CASE WHEN rc.is_steamed THEN GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls) ELSE 0 END) AS steamed_rolls
        FROM row_calc rc
        JOIN "IssueToHoloMachine" i ON i.id = rc.issue_id
        JOIN issue_labels il ON il.issue_id = i.id
        LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
        LEFT JOIN "Item" it ON it.id = i."itemId"
        LEFT JOIN "Firm" fm ON fm.id = lot."firmId"
        LEFT JOIN "Supplier" sp ON sp.id = lot."supplierId"
        LEFT JOIN "Yarn" yn ON yn.id = i."yarnId"
        LEFT JOIN "Twist" tw ON tw.id = i."twistId"
        LEFT JOIN "Cut" ct ON ct.id = i."cutId"
        GROUP BY
          il.lot_label, il.lot_nos_final, il.is_mixed,
          i."lotNo", i."itemId", i."yarnId", i."twistId",
          lot."firmId", lot."supplierId",
          it.name, fm.name, sp.name, yn.name, tw.name
        ORDER BY il.lot_label ASC
      `;

      const items = (rows || []).map((r) => {
        const cutNames = Array.isArray(r.cut_names) ? [...r.cut_names].sort((a, b) => String(a).localeCompare(String(b))) : [];
        const cutName = cutNames.length > 1 ? 'Mixed' : (cutNames[0] || '—');
        const totalRolls = Number(r.total_rolls || 0);
        const steamedRolls = Number(r.steamed_rolls || 0);
        const steamedStatusType = steamedRolls === 0 ? 'not_steamed'
          : (steamedRolls >= totalRolls ? 'steamed' : 'partial');
        const lotNos = Array.isArray(r.lot_nos) ? r.lot_nos.filter(Boolean) : [];
        const isMixed = !!r.is_mixed;
        const firmName = isMixed ? 'Mixed' : (r.firm_name || '—');
        const supplierName = isMixed ? 'Mixed' : (r.supplier_name || '—');
        const firmId = isMixed ? '' : (r.firm_id || '');
        const supplierId = isMixed ? '' : (r.supplier_id || '');

        return {
          lotKey: encodeStockLotKey({
            v: 1,
            process: 'holo',
            lotLabel: r.lot_label || '',
            lotNoRaw: r.lot_no_raw || '',
            itemId: r.item_id || '',
            yarnId: r.yarn_id || null,
            twistId: r.twist_id || null,
            firmId,
            supplierId,
            cutNames,
            isMixed,
          }),
          lotNo: r.lot_label || '—',
          lotNoRaw: r.lot_no_raw || '',
          lotNos,
          itemId: r.item_id || '',
          itemName: r.item_name || '—',
          firmId,
          firmName,
          supplierId,
          supplierName,
          yarnId: r.yarn_id || '',
          yarnName: r.yarn_name || '—',
          twistId: r.twist_id || '',
          twistName: r.twist_name || '—',
          cutName,
          cutNames,
          totalRolls,
          totalWeight: Number(r.total_weight || 0),
          steamedRolls,
          steamedWeight: Number(r.steamed_weight || 0),
          steamedStatusType,
          statusType: Number(r.total_weight || 0) > 0.000000001 ? 'active' : 'inactive',
          date: r.max_date || '',
          rows: [],
        };
      });

      return res.json({ items });
    }

    // coning
    const rows = await prisma.$queryRaw`
      WITH trace AS (
        SELECT
          ic.id AS issue_id,
          array_remove(array_agg(DISTINCT COALESCE(hc.name, NULL)), NULL) AS cut_names,
          array_remove(array_agg(DISTINCT COALESCE(hy.name, NULL)), NULL) AS yarn_names
        FROM "IssueToConingMachine" ic
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem ON true
        LEFT JOIN "ReceiveFromHoloMachineRow" hr ON hr.id = elem->>'rowId'
        LEFT JOIN "IssueToHoloMachine" hi ON hi.id = hr."issueId"
        LEFT JOIN "Cut" hc ON hc.id = hi."cutId"
        LEFT JOIN "Yarn" hy ON hy.id = hi."yarnId"
        WHERE ic."isDeleted" = false
        GROUP BY ic.id
      )
      SELECT
        i."lotNo" AS lot_no,
        i."itemId" AS item_id,
        i."yarnId" AS yarn_id,
        lot."firmId" AS firm_id,
        lot."supplierId" AS supplier_id,
        it.name AS item_name,
        fm.name AS firm_name,
        sp.name AS supplier_name,
        COALESCE(tr.cut_names, ARRAY[]::text[]) AS cut_names,
        COALESCE(tr.yarn_names, ARRAY[]::text[]) AS yarn_names,
        MAX(COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD'))) AS max_date,
        SUM(GREATEST(0, COALESCE(r."coneCount", 0) - COALESCE(r."dispatchedCount", 0))) AS total_cones,
        SUM(GREATEST(0, COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) - COALESCE(r."dispatchedWeight", 0))) AS total_weight
      FROM "ReceiveFromConingMachineRow" r
      JOIN "IssueToConingMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
      LEFT JOIN trace tr ON tr.issue_id = i.id
      LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
      LEFT JOIN "Item" it ON it.id = i."itemId"
      LEFT JOIN "Firm" fm ON fm.id = lot."firmId"
      LEFT JOIN "Supplier" sp ON sp.id = lot."supplierId"
      WHERE r."isDeleted" = false
      GROUP BY i."lotNo", i."itemId", i."yarnId", lot."firmId", lot."supplierId", it.name, fm.name, sp.name, tr.cut_names, tr.yarn_names
      ORDER BY i."lotNo" ASC
    `;

    const items = (rows || []).map((r) => {
      const cutNamesArr = Array.isArray(r.cut_names) ? r.cut_names.filter(Boolean) : [];
      const yarnNamesArr = Array.isArray(r.yarn_names) ? r.yarn_names.filter(Boolean) : [];
      const cutName = cutNamesArr.length ? cutNamesArr.join(', ') : '—';
      const yarnName = yarnNamesArr.length ? yarnNamesArr.join(', ') : '—';
      return {
        lotKey: encodeStockLotKey({
          v: 1,
          process: 'coning',
          lotNo: r.lot_no || '',
          itemId: r.item_id || '',
          yarnId: r.yarn_id || null,
          firmId: r.firm_id || '',
          supplierId: r.supplier_id || '',
        }),
        lotNo: r.lot_no || '—',
        itemId: r.item_id || '',
        itemName: r.item_name || '—',
        firmId: r.firm_id || '',
        firmName: r.firm_name || '—',
        supplierId: r.supplier_id || '',
        supplierName: r.supplier_name || '—',
        yarnId: r.yarn_id || '',
        yarnName,
        cutName,
        cutNames: cutNamesArr,
        yarnNames: yarnNamesArr,
        totalCones: Number(r.total_cones || 0),
        totalWeight: Number(r.total_weight || 0),
        statusType: Number(r.total_weight || 0) > 0.000000001 ? 'active' : 'inactive',
        date: r.max_date || '',
        rows: [],
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error('v2 stock lots error', err);
    res.status(500).json({ error: err.message || 'Failed to load stock lots' });
  }
});

router.get('/stock/:process/lot-rows', requireAuth, requirePermission('stock', PERM_READ), async (req, res) => {
  try {
    const process = String(req.params.process || '').trim().toLowerCase();
    const key = decodeStockLotKey(req.query?.key);
    if (!key || key.process !== process) return res.status(400).json({ error: 'Invalid lot key' });

    if (process === 'holo') {
      const lotLabel = String(key.lotLabel || '');
      const itemId = String(key.itemId || '');
      const yarnId = key.yarnId ? String(key.yarnId) : null;
      const twistId = key.twistId ? String(key.twistId) : null;
      const isMixed = !!key.isMixed;
      const cutNames = Array.isArray(key.cutNames) ? key.cutNames.map(String).filter(Boolean) : [];
      const firmId = String(key.firmId || '');
      const supplierId = String(key.supplierId || '');

      const rows = await prisma.$queryRaw`
        WITH issue_refs AS (
          SELECT i.id AS issue_id, elem->>'rowId' AS cutter_row_id
          FROM "IssueToHoloMachine" i
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem ON true
          WHERE i."isDeleted" = false
        ),
        issue_lots AS (
          SELECT ir.issue_id,
                 array_remove(array_agg(DISTINCT bi."lotNo"), NULL) AS lot_nos
          FROM issue_refs ir
          LEFT JOIN "ReceiveFromCutterMachineRow" cr ON cr.id = ir.cutter_row_id
          LEFT JOIN "InboundItem" bi ON bi.id = cr."pieceId"
          GROUP BY ir.issue_id
        ),
        issue_labels AS (
          SELECT i.id AS issue_id,
                 CASE
                   WHEN COALESCE(array_length(il.lot_nos, 1), 0) <= 1 THEN COALESCE(il.lot_nos[1], i."lotNo", '')
                   WHEN array_length(il.lot_nos, 1) <= 3 THEN 'Mixed (' || array_to_string(il.lot_nos, ', ') || ')'
                   ELSE 'Mixed (' || array_length(il.lot_nos, 1) || ')'
                 END AS lot_label
          FROM "IssueToHoloMachine" i
          LEFT JOIN issue_lots il ON il.issue_id = i.id
          WHERE i."isDeleted" = false
        ),
        issued AS (
          SELECT
            elem->>'rowId' AS row_id,
            SUM(CASE WHEN (elem->>'issueRolls') IS NULL OR (elem->>'issueRolls') = '' THEN 0 ELSE (elem->>'issueRolls')::numeric END) AS issue_rolls,
            SUM(CASE WHEN (elem->>'issueWeight') IS NULL OR (elem->>'issueWeight') = '' THEN 0 ELSE (elem->>'issueWeight')::numeric END) AS issue_weight
          FROM "IssueToConingMachine" ic,
            jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem
          WHERE ic."isDeleted" = false
          GROUP BY row_id
        ),
        takeback AS (
          SELECT
            l."sourceId" AS row_id,
            SUM((CASE WHEN tb."isReverse" = true THEN 1 ELSE -1 END) * l."count") AS tb_rolls,
            SUM((CASE WHEN tb."isReverse" = true THEN 1 ELSE -1 END) * l."weight") AS tb_weight
          FROM "IssueTakeBackLine" l
          JOIN "IssueTakeBack" tb ON tb.id = l."takeBackId"
          WHERE tb.stage = 'coning'
          GROUP BY l."sourceId"
        )
        SELECT
          r.id,
          r."barcode",
          COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD')) AS date,
          r."machineNo",
          rt.name AS roll_type_name,
          COALESCE(r."grossWeight", 0)::numeric AS gross_weight,
          COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))::numeric AS net_weight,
          GREATEST(0, COALESCE(r."rollCount", 0)::numeric - COALESCE(r."dispatchedCount", 0)::numeric - (COALESCE(iss.issue_rolls, 0) + COALESCE(tb.tb_rolls, 0))::numeric) AS available_rolls,
          GREATEST(0, COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))::numeric - COALESCE(r."dispatchedWeight", 0)::numeric - (COALESCE(iss.issue_weight, 0) + COALESCE(tb.tb_weight, 0))::numeric) AS available_weight,
          (st.id IS NOT NULL) AS is_steamed
        FROM "ReceiveFromHoloMachineRow" r
        JOIN "IssueToHoloMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
        JOIN issue_labels il ON il.issue_id = i.id
        LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
        LEFT JOIN "Cut" ct ON ct.id = i."cutId"
        LEFT JOIN issued iss ON iss.row_id = r.id
        LEFT JOIN takeback tb ON tb.row_id = r.id
        LEFT JOIN "RollType" rt ON rt.id = r."rollTypeId"
        LEFT JOIN "BoilerSteamLog" st
          ON st."holoReceiveRowId" = r.id OR (st."barcode" IS NOT NULL AND upper(st."barcode") = upper(r."barcode"))
        WHERE r."isDeleted" = false
          AND il.lot_label = ${lotLabel}
          AND i."itemId" = ${itemId}
          AND (${yarnId}::text IS NULL OR i."yarnId" = ${yarnId})
          AND (${twistId}::text IS NULL OR i."twistId" = ${twistId})
          AND (${isMixed}::boolean = true OR COALESCE(lot."firmId", '') = ${firmId})
          AND (${isMixed}::boolean = true OR COALESCE(lot."supplierId", '') = ${supplierId})
          AND (${cutNames.length} = 0 OR COALESCE(ct.name, '—') = ANY(${cutNames}::text[]))
        ORDER BY r."createdAt" DESC, r.id DESC
      `;

      const items = (rows || []).map((r) => ({
        id: r.id,
        barcode: r.barcode || '',
        date: r.date || '',
        machineNo: r.machineNo || '',
        rollTypeName: r.roll_type_name || '—',
        availableRolls: Number(r.available_rolls || 0),
        availableWeight: Number(r.available_weight || 0),
        grossWeight: Number(r.gross_weight || 0),
        netWeight: Number(r.net_weight || 0),
        isSteamed: !!r.is_steamed,
      }));

      return res.json({ items });
    }

    // coning rows
    const lotNo = String(key.lotNo || '');
    const itemId = String(key.itemId || '');
    const yarnId = key.yarnId ? String(key.yarnId) : null;
    const firmId = String(key.firmId || '');
    const supplierId = String(key.supplierId || '');

    const rows = await prisma.$queryRaw`
      WITH cone_types AS (
        SELECT
          i.id AS issue_id,
          array_remove(array_agg(DISTINCT COALESCE(ct.name, NULL)), NULL) AS cone_type_names
        FROM "IssueToConingMachine" i
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem ON true
        LEFT JOIN "ConeType" ct ON ct.id = elem->>'coneTypeId'
        WHERE i."isDeleted" = false
        GROUP BY i.id
      )
      SELECT
        r.id,
        r."barcode",
        COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD')) AS date,
        bx.name AS box_name,
        COALESCE(array_to_string(cts.cone_type_names, ', '), '—') AS cone_type_name,
        GREATEST(0, COALESCE(r."coneCount", 0)::numeric - COALESCE(r."dispatchedCount", 0)::numeric) AS available_cones,
        COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))))::numeric AS net_weight,
        COALESCE(r."grossWeight", 0)::numeric AS gross_weight,
        GREATEST(0, COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))))::numeric - COALESCE(r."dispatchedWeight", 0)::numeric) AS available_weight,
        COALESCE(r."machineNo", mc.name, '—') AS machine_name,
        COALESCE(op.name, '—') AS operator_name,
        r."notes" AS notes
      FROM "ReceiveFromConingMachineRow" r
      JOIN "IssueToConingMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
      LEFT JOIN cone_types cts ON cts.issue_id = i.id
      LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
      LEFT JOIN "Box" bx ON bx.id = r."boxId"
      LEFT JOIN "Machine" mc ON mc.id = i."machineId"
      LEFT JOIN "Operator" op ON op.id = r."operatorId"
      WHERE r."isDeleted" = false
        AND i."lotNo" = ${lotNo}
        AND i."itemId" = ${itemId}
        AND (${yarnId}::text IS NULL OR i."yarnId" = ${yarnId})
        AND COALESCE(lot."firmId", '') = ${firmId}
        AND COALESCE(lot."supplierId", '') = ${supplierId}
      ORDER BY r."createdAt" DESC, r.id DESC
    `;

    const items = (rows || []).map((r) => ({
      id: r.id,
      barcode: r.barcode || '',
      date: r.date || '',
      boxName: r.box_name || '—',
      coneType: r.cone_type_name || '—',
      availableCones: Number(r.available_cones || 0),
      availableWeight: Number(r.available_weight || 0),
      grossWeight: Number(r.gross_weight || 0),
      netWeight: Number(r.net_weight || 0),
      machineName: r.machine_name || '—',
      operatorName: r.operator_name || '—',
      notes: r.notes || '',
    }));

    return res.json({ items });
  } catch (err) {
    console.error('v2 stock lot-rows error', err);
    res.status(500).json({ error: err.message || 'Failed to load lot rows' });
  }
});

router.get('/stock/:process/barcode-lot-keys', requireAuth, requirePermission('stock', PERM_READ), async (req, res) => {
  try {
    const process = String(req.params.process || '').trim().toLowerCase();
    if (!['holo', 'coning'].includes(process)) {
      return res.status(400).json({ error: 'Invalid process' });
    }
    const q = String(req.query?.q || '').trim();
    if (!q) return res.json({ keys: [] });

    if (process === 'holo') {
      const rows = await prisma.$queryRaw`
        WITH issue_refs AS (
          SELECT i.id AS issue_id, elem->>'rowId' AS cutter_row_id
          FROM "IssueToHoloMachine" i
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem ON true
          WHERE i."isDeleted" = false
        ),
        issue_lots AS (
          SELECT ir.issue_id,
                 array_remove(array_agg(DISTINCT bi."lotNo"), NULL) AS lot_nos
          FROM issue_refs ir
          LEFT JOIN "ReceiveFromCutterMachineRow" cr ON cr.id = ir.cutter_row_id
          LEFT JOIN "InboundItem" bi ON bi.id = cr."pieceId"
          GROUP BY ir.issue_id
        ),
        issue_labels AS (
          SELECT i.id AS issue_id,
                 CASE
                   WHEN COALESCE(array_length(il.lot_nos, 1), 0) <= 1 THEN COALESCE(il.lot_nos[1], i."lotNo", '')
                   WHEN array_length(il.lot_nos, 1) <= 3 THEN 'Mixed (' || array_to_string(il.lot_nos, ', ') || ')'
                   ELSE 'Mixed (' || array_length(il.lot_nos, 1) || ')'
                 END AS lot_label,
                 CASE WHEN COALESCE(array_length(il.lot_nos, 1), 0) > 1 THEN true ELSE false END AS is_mixed
          FROM "IssueToHoloMachine" i
          LEFT JOIN issue_lots il ON il.issue_id = i.id
          WHERE i."isDeleted" = false
        )
        SELECT
          il.lot_label AS lot_label,
          il.is_mixed AS is_mixed,
          i."lotNo" AS lot_no_raw,
          i."itemId" AS item_id,
          i."yarnId" AS yarn_id,
          i."twistId" AS twist_id,
          lot."firmId" AS firm_id,
          lot."supplierId" AS supplier_id,
          array_remove(array_agg(DISTINCT COALESCE(ct.name, '—')), NULL) AS cut_names
        FROM "ReceiveFromHoloMachineRow" r
        JOIN "IssueToHoloMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
        JOIN issue_labels il ON il.issue_id = i.id
        LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
        LEFT JOIN "Cut" ct ON ct.id = i."cutId"
        WHERE r."isDeleted" = false
          AND r."barcode" ILIKE ${'%' + q + '%'}
        GROUP BY
          il.lot_label,
          il.is_mixed,
          i."lotNo",
          i."itemId",
          i."yarnId",
          i."twistId",
          lot."firmId",
          lot."supplierId"
        ORDER BY il.lot_label ASC
        LIMIT 50
      `;

      const keys = (rows || []).map((r) => {
        const isMixed = !!r.is_mixed;
        const firmId = isMixed ? '' : (r.firm_id || '');
        const supplierId = isMixed ? '' : (r.supplier_id || '');
        const cutNames = Array.isArray(r.cut_names) ? [...r.cut_names].sort((a, b) => String(a).localeCompare(String(b))) : [];
        return encodeStockLotKey({
          v: 1,
          process: 'holo',
          lotLabel: r.lot_label || '',
          lotNoRaw: r.lot_no_raw || '',
          itemId: r.item_id || '',
          yarnId: r.yarn_id || null,
          twistId: r.twist_id || null,
          firmId,
          supplierId,
          cutNames,
          isMixed,
        });
      });

      return res.json({ keys });
    }

    // coning
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT
        i."lotNo" AS lot_no,
        i."itemId" AS item_id,
        i."yarnId" AS yarn_id,
        lot."firmId" AS firm_id,
        lot."supplierId" AS supplier_id
      FROM "ReceiveFromConingMachineRow" r
      JOIN "IssueToConingMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
      LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
      WHERE r."isDeleted" = false
        AND r."barcode" ILIKE ${'%' + q + '%'}
      LIMIT 50
    `;

    const keys = (rows || []).map((r) => encodeStockLotKey({
      v: 1,
      process: 'coning',
      lotNo: r.lot_no || '',
      itemId: r.item_id || '',
      yarnId: r.yarn_id || null,
      firmId: r.firm_id || '',
      supplierId: r.supplier_id || '',
    }));

    return res.json({ keys });
  } catch (err) {
    console.error('v2 stock barcode-lot-keys error', err);
    res.status(500).json({ error: err.message || 'Failed to lookup barcode lot keys' });
  }
});

export default router;
