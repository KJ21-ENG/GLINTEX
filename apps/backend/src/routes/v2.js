import { Router } from 'express';

import prisma from '../lib/prisma.js';
import { requirePermission } from '../middleware/auth.js';
import { requireSessionOrAgentRead as requireAuth } from '../middleware/agentPrincipalAuth.js';
import { resolveUserFields } from '../utils/userResolver.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import {
  buildReceiveMachineContainsFilter,
  buildReceiveMachineInFilter,
  resolveDisplayedReceiveMachineName,
} from '../utils/receiveHistoryFilters.js';
import {
  buildAgentDateFilterMetadata,
  buildRecordDateWhere,
  formatAgentRecordDate,
  normalizeAgentDateBasis,
} from '../utils/agentDateFilters.js';

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

function normalizeOrder(raw) {
  return String(raw || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function buildCursorWhere(cursor, order = 'desc') {
  if (!cursor) return null;
  // Stable pagination for orderBy: createdAt <order>, id <order>
  const cmp = order === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { createdAt: { [cmp]: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { [cmp]: String(cursor.id) } },
    ],
  };
}

function applyCursorWhere(baseWhere, cursorWhere) {
  // IMPORTANT: both baseWhere and cursorWhere can contain top-level OR clauses.
  // Spreading them into one object would overwrite OR and break filtering on page 2+.
  return cursorWhere ? { AND: [baseWhere, cursorWhere] } : baseWhere;
}

// Optional 1-based page number for offset pagination. Returns null when absent so
// endpoints keep their cursor behavior for callers that don't send it.
function parsePageParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(1000000, Math.floor(n));
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

// Cutter receive rows have no issue.itemId relation; their displayed item comes from the
// inbound piece (pieceId -> InboundItem.itemId -> Item.name). Resolve the selected item
// names to the matching piece ids so the filter targets the same value the column shows.
async function buildCutterReceiveItemWhere(filters = []) {
  const and = [];
  for (const f of filters || []) {
    if (!f || typeof f !== 'object') continue;
    if (String(f.field || '').trim() !== 'item') continue;
    const op = String(f.op || '').trim();
    let itemIds = [];
    if (op === 'in') itemIds = await itemIdsByExactNames(Array.isArray(f.values) ? f.values : []);
    else if (op === 'contains') itemIds = await itemIdsByNameContains(f.value);
    else continue;
    if (!itemIds.length) { and.push({ pieceId: { in: ['__no_such_piece__'] } }); continue; }
    const pieces = await prisma.inboundItem.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } });
    const pieceIds = pieces.map((p) => p.id);
    and.push({ pieceId: { in: pieceIds.length ? pieceIds : ['__no_such_piece__'] } });
  }
  return and;
}

// `addedBy` options are usernames (there is no username facet, so options are derived from
// page rows). Resolve them to user ids before matching createdByUserId.
async function buildAddedByWhereFromSheetFilters(filters = []) {
  const and = [];
  for (const f of filters || []) {
    if (!f || typeof f !== 'object') continue;
    if (String(f.field || '').trim() !== 'addedBy') continue;
    if (String(f.op || '').trim() !== 'in') continue;
    const usernames = (Array.isArray(f.values) ? f.values : []).map((v) => String(v).trim()).filter(Boolean);
    if (!usernames.length) continue;
    const users = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    and.push({ createdByUserId: { in: ids.length ? ids : ['__no_such_user__'] } });
  }
  return and;
}

// Coning cone type lives on the ISSUE as receivedRowRefs[0].coneTypeId (JSON), matching the
// displayed value resolved by fetchConeTypeNameByIssueIdForConingReceiveRows. Resolve the
// selected cone-type names -> coneTypeIds -> the set of matching coning issue ids.
async function coningIssueIdsByConeTypeFilter(f) {
  const op = String(f.op || '').trim();
  let coneTypeIds = [];
  if (op === 'in') {
    const names = (Array.isArray(f.values) ? f.values : []).map((v) => String(v));
    if (!names.length) return [];
    const cts = await prisma.coneType.findMany({ where: { name: { in: names } }, select: { id: true } });
    coneTypeIds = cts.map((c) => c.id);
  } else if (op === 'contains') {
    const val = normalizeText(f.value);
    if (!val) return [];
    const cts = await prisma.coneType.findMany({ where: { name: { contains: val, mode: 'insensitive' } }, select: { id: true } });
    coneTypeIds = cts.map((c) => c.id);
  } else {
    return [];
  }
  if (!coneTypeIds.length) return ['__no_such_issue__'];
  const rows = await prisma.$queryRaw`
    SELECT id FROM "IssueToConingMachine"
    WHERE "isDeleted" = false
      AND ("receivedRowRefs"->0->>'coneTypeId') = ANY(${coneTypeIds}::text[])
  `;
  const ids = rows.map((r) => r.id);
  return ids.length ? ids : ['__no_such_issue__'];
}

async function buildConeTypeWhereFromSheetFilters(filters = [], { mode } = {}) {
  const and = [];
  for (const f of filters || []) {
    if (!f || typeof f !== 'object') continue;
    if (String(f.field || '').trim() !== 'coneType') continue;
    const issueIds = await coningIssueIdsByConeTypeFilter(f);
    if (!issueIds.length) continue;
    // Receive rows link to their issue via issueId; issue/on-machine rows ARE the issue.
    if (mode === 'receive') and.push({ issueId: { in: issueIds } });
    else and.push({ id: { in: issueIds } });
  }
  return and;
}

// Async side-path filters that can't be expressed via the sync *_FILTERS maps
// (item name -> ids, cone type -> issue ids, username -> user id).
async function buildReceiveExtraFilters(filters = [], process) {
  const out = [];
  if (process === 'cutter') out.push(...await buildCutterReceiveItemWhere(filters));
  else out.push(...await buildItemWhereFromSheetFilters(filters, { mode: 'receive' }));
  if (process === 'coning') out.push(...await buildConeTypeWhereFromSheetFilters(filters, { mode: 'receive' }));
  out.push(...await buildAddedByWhereFromSheetFilters(filters));
  return out;
}

async function buildIssueExtraFilters(filters = [], process) {
  const out = [];
  out.push(...await buildItemWhereFromSheetFilters(filters, { mode: 'issue' }));
  if (process === 'coning') out.push(...await buildConeTypeWhereFromSheetFilters(filters, { mode: 'issue' }));
  out.push(...await buildAddedByWhereFromSheetFilters(filters));
  return out;
}

function buildFilterWhere(filters = [], mapping = {}, { excludeField, process } = {}) {
  const and = [];
  const ctx = { process };
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
      and.push(mapEntry.in(values, ctx));
    } else if (op === 'contains') {
      const value = normalizeText(f.value);
      if (!value) continue;
      and.push(mapEntry.contains(value, ctx));
    } else if (op === 'between') {
      const min = f.min == null ? null : Number(f.min);
      const max = f.max == null ? null : Number(f.max);
      and.push(mapEntry.between({ min, max }, ctx));
    }
  }
  return and;
}

// Build a Prisma numeric-range filter for a scalar column, supporting a dotted
// relation path (e.g. 'issue.requiredPerConeNetWeight'). Returns {} when the
// range is empty so it AND-merges harmlessly.
function numericBetween(path) {
  return ({ min, max } = {}) => {
    const range = {};
    if (min != null && Number.isFinite(Number(min))) range.gte = Number(min);
    if (max != null && Number.isFinite(Number(max))) range.lte = Number(max);
    if (!Object.keys(range).length) return {};
    const parts = String(path).split('.');
    let node = range;
    for (let i = parts.length - 1; i >= 0; i -= 1) node = { [parts[i]]: node };
    return node;
  };
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

function buildDateWhereForAgent({ dateFrom, dateTo, dateBasis }) {
  return dateBasis === 'record'
    ? buildRecordDateWhere({ dateFrom, dateTo })
    : buildDateWhere({ dateFrom, dateTo, field: 'date' });
}

function parsePieceIdsCsv(raw) {
  if (Array.isArray(raw)) return raw.map((value) => String(value || '').trim()).filter(Boolean);
  return String(raw || '').split(',').map((value) => value.trim()).filter(Boolean);
}

function toTimeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Fields that cannot be filtered via the Prisma *_FILTERS maps because their displayed value
// is derived after the query (take-back aggregation, receivedRowRefs sums, multi-hop pieces).
// They are filtered in memory over the fully-loaded, mapped result set. Keyed by (endpoint, process).
const ISSUE_COMPUTED_FIELDS = {
  cutter: new Set(['weight', 'takenBackWeight', 'netIssuedWeight', 'wastageWeight']),
  holo: new Set(['takenBackWeight', 'netIssuedWeight']),
  coning: new Set(['takenBackWeight', 'netIssuedWeight', 'rollsIssued']),
};
const ON_MACHINE_COMPUTED_FIELDS = {
  // Cutter piece is the raw pieceIds column (Prisma-filterable via ISSUE_FILTERS.piece).
  cutter: new Set(['issuedWeight', 'receivedWeight', 'pendingWeight']),
  holo: new Set(['issuedWeight', 'receivedWeight', 'pendingWeight', 'piece']),
  coning: new Set(['issuedWeight', 'receivedWeight', 'pendingWeight', 'rollsIssued', 'piece']),
};

function splitComputedFilters(filters = [], computedSet = new Set()) {
  const rawFilters = [];
  const computedFilters = [];
  for (const filter of filters || []) {
    const field = String(filter?.field || '').trim();
    if (computedSet.has(field)) computedFilters.push(filter);
    else rawFilters.push(filter);
  }
  return { rawFilters, computedFilters };
}

// Numeric value for a computed field, read from the already-mapped row.
function computedFieldValue(row, field) {
  switch (field) {
    case 'weight': return Number(row?.totalWeight ?? row?.originalIssuedWeight ?? 0);
    case 'takenBackWeight': return Number(row?.takenBackWeight || 0);
    case 'netIssuedWeight': return Number(row?.netIssuedWeight ?? 0);
    case 'wastageWeight': return Number(row?.wastageWeight || 0);
    case 'rollsIssued': return Number(row?.rollsIssued || 0);
    case 'issuedWeight': return Number(row?.issuedWeight ?? 0);
    case 'receivedWeight': return Number(row?.receivedWeight ?? 0);
    case 'pendingWeight': return Number(row?.pendingWeight ?? 0);
    case 'actualG': {
      const cones = Number(row?.coneCount || 0);
      if (!cones) return null;
      return (Number(row?.netWeight || 0) * 1000) / cones;
    }
    default: return null;
  }
}

// Text value for a computed text field (piece), read from the mapped row.
function computedFieldText(row, field) {
  if (field === 'piece') {
    if (Array.isArray(row?.pieceIdsList)) return row.pieceIdsList.join(', ');
    if (Array.isArray(row?.computedPieceIds)) return row.computedPieceIds.join(', ');
    return String(row?.pieceIds || row?.pieceId || '');
  }
  return '';
}

function matchesComputedBetween(value, { min, max }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return false;
  if (Number.isFinite(min) && numeric < min) return false;
  if (Number.isFinite(max) && numeric > max) return false;
  return true;
}

function matchesComputedFilters(row, filters = []) {
  return (filters || []).every((filter) => {
    if (!filter || typeof filter !== 'object') return true;
    const op = String(filter.op || '').trim();
    const field = String(filter.field || '').trim();
    if (op === 'between') {
      const value = computedFieldValue(row, field);
      if (value == null) return true;
      const min = filter.min == null || filter.min === '' ? null : Number(filter.min);
      const max = filter.max == null || filter.max === '' ? null : Number(filter.max);
      return matchesComputedBetween(value, { min, max });
    }
    const haystack = String(computedFieldText(row, field) || '');
    if (op === 'contains') {
      const needle = normalizeText(filter.value).toLowerCase();
      if (!needle) return true;
      return haystack.toLowerCase().includes(needle);
    }
    if (op === 'in') {
      const values = (Array.isArray(filter.values) ? filter.values : []).map((v) => String(v).trim()).filter(Boolean);
      if (!values.length) return true;
      const tokens = haystack.split(',').map((s) => s.trim());
      return values.some((v) => tokens.includes(v));
    }
    return true;
  });
}

function applyCursorToSortedItems(items = [], cursor, order = 'desc') {
  if (!cursor) return items;
  const cursorMs = toTimeMs(cursor.createdAt);
  const asc = order === 'asc';
  return (items || []).filter((item) => {
    const itemMs = toTimeMs(item?.createdAt);
    if (itemMs == null || cursorMs == null) return false;
    if (itemMs !== cursorMs) return asc ? itemMs > cursorMs : itemMs < cursorMs;
    const itemId = String(item?.id || '');
    const cursorId = String(cursor.id || '');
    return asc ? itemId > cursorId : itemId < cursorId;
  });
}

function sumItemsField(items, field) {
  return (items || []).reduce((sum, item) => sum + Number(item?.[field] || 0), 0);
}

// Footer summary computed over the fully-filtered in-memory set (used by the computed-filter
// branch). Mirrors the shape produced by the DB-aggregate path for each process.
function buildIssueSummaryFromItems(process, items = []) {
  const takenBackCount = sumItemsField(items, 'takenBackCount');
  const takenBackWeight = sumItemsField(items, 'takenBackWeight');
  const netIssuedWeight = sumItemsField(items, 'netIssuedWeight');
  if (process === 'holo') {
    return {
      metallicBobbins: sumItemsField(items, 'metallicBobbins'),
      metallicBobbinsWeight: sumItemsField(items, 'metallicBobbinsWeight'),
      yarnKg: sumItemsField(items, 'yarnKg'),
      rollsProducedEstimate: sumItemsField(items, 'rollsProducedEstimate'),
      takenBackCount,
      takenBackWeight,
      netIssuedWeight,
    };
  }
  if (process === 'coning') {
    return {
      rollsIssued: sumItemsField(items, 'rollsIssued'),
      originalIssuedWeight: sumItemsField(items, 'originalIssuedWeight'),
      takenBackCount,
      takenBackWeight,
      netIssuedWeight,
    };
  }
  return {
    qty: sumItemsField(items, 'count'),
    weight: (items || []).reduce((sum, item) => sum + Number(item?.totalWeight ?? item?.originalIssuedWeight ?? 0), 0),
    takenBackCount,
    takenBackWeight,
    netIssuedWeight,
  };
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
  shift: {
    in: (values, ctx) => {
      const proc = ctx?.process || '';
      if (proc === 'cutter') return {};
      return { shift: { in: values } };
    },
    contains: (value, ctx) => {
      const proc = ctx?.process || '';
      if (proc === 'cutter') return {};
      return { shift: { contains: value, mode: 'insensitive' } };
    },
    between: () => ({}),
  },
  lotOrPiece: {
    in: () => ({}),
    // Cutter displays pieceIds in this column; other processes display lotNo.
    contains: (value, ctx) => (ctx?.process === 'cutter'
      ? { OR: [{ lotNo: { contains: value, mode: 'insensitive' } }, { pieceIds: { contains: value, mode: 'insensitive' } }] }
      : { lotNo: { contains: value, mode: 'insensitive' } }),
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
  // NOTE: `addedBy` is intentionally NOT here. The UI sends usernames, not user ids,
  // so it is resolved (username -> id) by buildAddedByWhereFromSheetFilters as a side path.
  // `coneType` is likewise a side path (buildConeTypeWhereFromSheetFilters). Numeric columns:
  qty: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'cutter' ? numericBetween('count')(range) : {}),
  },
  metallicBobbins: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'holo' ? numericBetween('metallicBobbins')(range) : {}),
  },
  metallicBobbinsWeight: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'holo' ? numericBetween('metallicBobbinsWeight')(range) : {}),
  },
  yarnKg: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'holo' ? numericBetween('yarnKg')(range) : {}),
  },
  rollsProducedEstimate: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'holo' ? numericBetween('rollsProducedEstimate')(range) : {}),
  },
  perCone: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'coning' ? numericBetween('requiredPerConeNetWeight')(range) : {}),
  },
  // NOTE: `rollsIssued` is NOT here. In both Issue History and On-Machine the displayed rolls is
  // derived from receivedRowRefs, not the stored column, so it is a computed (in-memory) filter.
  // Cutter piece is the raw pieceIds column (used by On-Machine cutter). Holo/coning piece is
  // derived and handled by the computed-filter path.
  piece: {
    in: (values, ctx) => (ctx?.process === 'cutter' ? { pieceIds: { in: values } } : {}),
    contains: (value, ctx) => (ctx?.process === 'cutter' ? { pieceIds: { contains: value, mode: 'insensitive' } } : {}),
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
    recordDate: formatAgentRecordDate(row.createdAt),
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
  const dateBasis = normalizeAgentDateBasis(req.query.dateBasis);
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);
  const pageNum = parsePageParam(req.query.page);
  if (!dateBasis) return res.status(400).json({ error: 'dateBasis must be business or record.' });

  try {
    const model = issueModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, ISSUE_COMPUTED_FIELDS[process] || new Set());
    const cursorWhere = computedFilters.length > 0 || pageNum != null ? null : buildCursorWhere(cursor, order);
    const dateWhere = buildDateWhereForAgent({ dateFrom, dateTo, dateBasis });
    const filterWhere = buildFilterWhere(rawFilters, ISSUE_FILTERS, { process });
    const extraWhere = await buildIssueExtraFilters(filters, process);
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const itemSearchIds = await itemIdsByNameContains(search);
    if (itemSearchIds.length) searchOr.push({ itemId: { in: itemSearchIds } });
    const whereAll = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || extraWhere.length ? { AND: [...filterWhere, ...extraWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const wherePage = applyCursorWhere(whereAll, cursorWhere);

    if (computedFilters.length > 0) {
      const rowsRaw = await model.findMany({
        where: whereAll,
        include: issueIncludesForProcess(process),
        orderBy: [{ createdAt: order }, { id: order }],
      });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
      const issueIds = rowsWithItems.map((row) => row.id);
      const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds(process, issueIds);
      const wastageByIssueId = process === 'cutter'
        ? await buildCutterIssueWastageByIssueId(rowsWithItems)
        : new Map();
      const allItems = rowsWithItems
        .map((row) => mapIssueRow(process, row, { takeBackTotalsByIssueId, wastageByIssueId }))
        .filter((row) => matchesComputedFilters(row, computedFilters));
      const pageCandidates = pageNum != null
        ? allItems.slice((pageNum - 1) * limit)
        : applyCursorToSortedItems(allItems, cursor, order);
      const hasMore = pageCandidates.length > limit;
      const items = pageCandidates.slice(0, limit);
      const lastInPage = items[items.length - 1];
      const nextCursor = pageNum == null && hasMore && lastInPage
        ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id })
        : null;
      const summary = !cursor && (pageNum == null || pageNum === 1)
        ? { ...buildIssueSummaryFromItems(process, allItems), totalCount: allItems.length }
        : null;
      return res.json({
        items,
        hasMore,
        nextCursor,
        summary,
        dateBasis,
        dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
      });
    }

    const rowsRaw = await model.findMany({
      where: wherePage,
      include: issueIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
      ...(pageNum != null ? { skip: (pageNum - 1) * limit } : {}),
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
    const nextCursor = pageNum == null && hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;

    // Summary for footer totals (full filter context, not just page).
    // First page only: later pages return summary: null and the client keeps the
    // previous value (see useV2CursorList/useV2PagedList), so recomputing per page
    // is wasted work.
    let summary = null;
    if (!cursor && (pageNum == null || pageNum === 1)) {
      const totalCount = await model.count({ where: whereAll });
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
          totalCount,
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
          totalCount,
        };
      } else {
        summary = {
          rollsIssued: coningRollsIssuedTotal || Number(baseAgg?._sum?.rollsIssued || 0),
          originalIssuedWeight: coningIssuedWeightTotal,
          takenBackCount: takenBackCountTotal,
          takenBackWeight: takenBackWeightTotal,
          netIssuedWeight: Math.max(0, coningIssuedWeightTotal - takenBackWeightTotal),
          totalCount,
        };
      }
    }

    res.json({
      items,
      hasMore,
      nextCursor,
      summary,
      dateBasis,
      dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
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
  const dateBasis = normalizeAgentDateBasis(req.query.dateBasis);
  const search = req.query.search;
  if (!dateBasis) return res.status(400).json({ error: 'dateBasis must be business or record.' });

  try {
    const model = issueModelForProcess(process);
    const dateWhere = buildDateWhereForAgent({ dateFrom, dateTo, dateBasis });
    const filterWhere = buildFilterWhere(filters, ISSUE_FILTERS, { excludeField, process });
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length ? { AND: filterWhere } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };

    // Facets are intentionally limited to keep the query fast.
    // UI only needs distinct values for dropdowns.
    const [machines, operators, items, cuts, yarns, twists, coneTypes, users] = await Promise.all([
      prisma.machine.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ select: { username: true }, orderBy: { username: 'asc' } }),
    ]);

    let shifts = [];
    if (process === 'holo') {
      const distinctShifts = await prisma.issueToHoloMachine.findMany({
        where: { isDeleted: false, NOT: { shift: null } },
        select: { shift: true },
        distinct: ['shift'],
      });
      shifts = distinctShifts.map(s => s.shift).filter(Boolean);
    } else if (process === 'coning') {
      const distinctShifts = await prisma.issueToConingMachine.findMany({
        where: { isDeleted: false, NOT: { shift: null } },
        select: { shift: true },
        distinct: ['shift'],
      });
      shifts = distinctShifts.map(s => s.shift).filter(Boolean);
    }
    shifts.sort((a, b) => a.localeCompare(b));

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
        coneType: coneTypes.map(r => r.name).filter(Boolean),
        addedBy: users.map(r => r.username).filter(Boolean),
        shift: shifts,
      },
      meta: {
        process,
        excludeField,
        whereApplied: Boolean(where),
        dateBasis,
        dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
      },
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
  const dateBasis = normalizeAgentDateBasis(req.query.dateBasis);
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);
  if (!dateBasis) return res.status(400).json({ error: 'dateBasis must be business or record.' });

  try {
    const model = issueModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, ISSUE_COMPUTED_FIELDS[process] || new Set());
    const dateWhere = buildDateWhereForAgent({ dateFrom, dateTo, dateBasis });
    const filterWhere = buildFilterWhere(rawFilters, ISSUE_FILTERS, { process });
    const extraWhere = await buildIssueExtraFilters(filters, process);
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const itemSearchIds = await itemIdsByNameContains(search);
    if (itemSearchIds.length) searchOr.push({ itemId: { in: itemSearchIds } });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || extraWhere.length ? { AND: [...filterWhere, ...extraWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const rowsRaw = await model.findMany({
      where,
      include: issueIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
    });
    const rowsWithUsers = await resolveUserFields(rowsRaw);
    const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
    const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds(process, rowsWithItems.map(r => r.id));
    const wastageByIssueId = process === 'cutter'
      ? await buildCutterIssueWastageByIssueId(rowsWithItems)
      : new Map();
    const items = rowsWithItems
      .map((r) => mapIssueRow(process, r, { takeBackTotalsByIssueId, wastageByIssueId }))
      .filter((row) => matchesComputedFilters(row, computedFilters));
    res.json({
      items,
      dateBasis,
      dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
    });
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
  return { box: true, operator: true, helper: true, issue: { include: { cut: true, yarn: true, twist: true, machine: true } } };
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
  shift: {
    in: (values, ctx) => {
      const proc = ctx?.process || '';
      if (proc === 'cutter') {
        return { shift: { in: values } };
      }
      return { issue: { shift: { in: values } } };
    },
    contains: (value, ctx) => {
      const proc = ctx?.process || '';
      if (proc === 'cutter') {
        return { shift: { contains: value, mode: 'insensitive' } };
      }
      return { issue: { shift: { contains: value, mode: 'insensitive' } } };
    },
    between: () => ({}),
  },
  barcode: {
    in: () => ({}),
    contains: (value) => ({ barcode: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  machine: {
    in: (values, ctx) => buildReceiveMachineInFilter(values, ctx),
    contains: (value, ctx) => buildReceiveMachineContainsFilter(value, ctx),
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
    // Cutter receive rows carry their own cut (cutMaster relation or raw `cut` string),
    // not an issue relation — mirror the displayed value. Other processes read issue.cut.
    in: (values, ctx) => (ctx?.process === 'cutter'
      ? { OR: [{ cutMaster: { name: { in: values } } }, { cut: { in: values } }] }
      : { issue: { cut: { name: { in: values } } } }),
    contains: (value, ctx) => (ctx?.process === 'cutter'
      ? { OR: [{ cutMaster: { name: { contains: value, mode: 'insensitive' } } }, { cut: { contains: value, mode: 'insensitive' } }] }
      : { issue: { cut: { name: { contains: value, mode: 'insensitive' } } } }),
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
  notes: {
    in: () => ({}),
    contains: (value) => ({ notes: { contains: value, mode: 'insensitive' } }),
    between: () => ({}),
  },
  // Weight column: coning shows netWeight, holo shows rollWeight (cutter uses `netWt`).
  weight: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'holo'
      ? numericBetween('rollWeight')(range)
      : numericBetween('netWeight')(range)),
  },
  netWt: {
    in: () => ({}),
    contains: () => ({}),
    between: numericBetween('netWt'),
  },
  cones: {
    in: () => ({}),
    contains: () => ({}),
    between: numericBetween('coneCount'),
  },
  rolls: {
    in: () => ({}),
    contains: () => ({}),
    between: numericBetween('rollCount'),
  },
  bobbinQty: {
    in: () => ({}),
    contains: () => ({}),
    between: numericBetween('bobbinQuantity'),
  },
  bobbin: {
    in: (values) => ({ bobbin: { name: { in: values } } }),
    contains: (value) => ({ bobbin: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  perCone: {
    in: () => ({}),
    contains: () => ({}),
    between: (range, ctx) => (ctx?.process === 'coning'
      ? numericBetween('issue.requiredPerConeNetWeight')(range)
      : {}),
  },
  // Cutter piece is a raw column; holo/coning piece is derived (handled as a computed filter).
  piece: {
    in: (values, ctx) => (ctx?.process === 'cutter' ? { pieceId: { in: values } } : {}),
    contains: (value, ctx) => (ctx?.process === 'cutter' ? { pieceId: { contains: value, mode: 'insensitive' } } : {}),
    between: () => ({}),
  },
};

function mapReceiveRow(process, row, extras = {}) {
  const base = { ...row, recordDate: formatAgentRecordDate(row.createdAt) };
  if (process === 'holo' || process === 'coning') {
    base.shift = row.shift || row.issue?.shift || '';
    base.itemName = row.issue?.itemName || '';
    base.cutName = extras.cutName || row.issue?.cut?.name || '';
    base.yarnName = row.issue?.yarn?.name || '';
    base.twistName = row.issue?.twist?.name || '';
    if (process === 'coning') {
      // Coning-specific fields are needed for immediate, correct first-render in Receive History.
      // Returning them from v2 eliminates UI dependence on late-loaded legacy module data.
      base.perConeTargetG = Number(row.issue?.requiredPerConeNetWeight || 0);
      base.coneTypeName = extras.coneTypeName || '';
      base.rollTypeName = extras.rollTypeName || '';
      base.machineName = resolveDisplayedReceiveMachineName(row, { process });
    }
    if (Array.isArray(extras.computedPieceIds)) {
      base.computedPieceIds = extras.computedPieceIds;
    }
  }
  return base;
}

const normalizedLineageName = (value) => {
  const name = String(value || '').trim();
  return name && name !== '—' ? name : '';
};

export function resolveHoloCutNameByIssueIdForReceiveRows(rows = [], cutterRows = []) {
  const cutterRowById = new Map((cutterRows || []).map((row) => [String(row?.id || ''), row]));
  const issueById = new Map();
  for (const row of rows || []) {
    const issue = row?.issue;
    const issueId = String(row?.issueId || issue?.id || '');
    if (issueId && issue && !issueById.has(issueId)) issueById.set(issueId, issue);
  }

  const out = new Map();
  for (const [issueId, issue] of issueById.entries()) {
    const directName = normalizedLineageName(issue?.cut?.name || issue?.cutName);
    if (directName) {
      out.set(issueId, directName);
      continue;
    }

    const names = new Set();
    for (const ref of normalizeReceivedRowRefs(issue?.receivedRowRefs)) {
      const cutterRow = cutterRowById.get(String(ref?.rowId || ''));
      const tracedName = normalizedLineageName(cutterRow?.cutMaster?.name || cutterRow?.cut);
      if (tracedName) names.add(tracedName);
    }
    out.set(issueId, Array.from(names).join(', '));
  }
  return out;
}

async function fetchHoloCutNameByIssueIdForReceiveRows(rows = [], db = prisma) {
  const cutterRowIds = new Set();
  for (const row of rows || []) {
    const issue = row?.issue;
    if (normalizedLineageName(issue?.cut?.name || issue?.cutName)) continue;
    for (const ref of normalizeReceivedRowRefs(issue?.receivedRowRefs)) {
      if (ref?.rowId) cutterRowIds.add(String(ref.rowId));
    }
  }

  const cutterRows = cutterRowIds.size
    ? await db.receiveFromCutterMachineRow.findMany({
      where: { id: { in: Array.from(cutterRowIds) }, isDeleted: false },
      select: { id: true, cut: true, cutMaster: { select: { name: true } } },
    })
    : [];
  return resolveHoloCutNameByIssueIdForReceiveRows(rows, cutterRows);
}

function addLineageFrontierTarget(frontier, seenTargetsByRowId, rowIdValue, targetIssueIdValue) {
  const rowId = String(rowIdValue || '');
  const targetIssueId = String(targetIssueIdValue || '');
  if (!rowId || !targetIssueId) return;
  const seenTargets = seenTargetsByRowId.get(rowId) || new Set();
  if (seenTargets.has(targetIssueId)) return;
  seenTargets.add(targetIssueId);
  seenTargetsByRowId.set(rowId, seenTargets);
  const targets = frontier.get(rowId) || new Set();
  targets.add(targetIssueId);
  frontier.set(rowId, targets);
}

export async function fetchConingRollTypeNameByIssueIdForReceiveRows(rows = [], db = prisma) {
  const rollTypeNamesByIssueId = new Map();
  const seenTargetsByRowId = new Map();
  let frontier = new Map();

  for (const row of rows || []) {
    const issue = row?.issue;
    const targetIssueId = String(row?.issueId || issue?.id || '');
    if (!targetIssueId || !issue) continue;
    if (!rollTypeNamesByIssueId.has(targetIssueId)) rollTypeNamesByIssueId.set(targetIssueId, new Set());
    for (const ref of normalizeReceivedRowRefs(issue?.receivedRowRefs)) {
      addLineageFrontierTarget(frontier, seenTargetsByRowId, ref?.rowId, targetIssueId);
    }
  }

  while (frontier.size > 0) {
    const rowIds = Array.from(frontier.keys());
    const [holoRows, coningRows] = await Promise.all([
      db.receiveFromHoloMachineRow.findMany({
        where: { id: { in: rowIds }, isDeleted: false },
        select: { id: true, rollType: { select: { name: true } } },
      }),
      db.receiveFromConingMachineRow.findMany({
        where: { id: { in: rowIds }, isDeleted: false },
        select: { id: true, issueId: true },
      }),
    ]);

    const holoRowIds = new Set();
    for (const holoRow of holoRows || []) {
      const rowId = String(holoRow?.id || '');
      if (!rowId) continue;
      holoRowIds.add(rowId);
      const rollTypeName = normalizedLineageName(holoRow?.rollType?.name);
      if (!rollTypeName) continue;
      for (const targetIssueId of frontier.get(rowId) || []) {
        const names = rollTypeNamesByIssueId.get(targetIssueId) || new Set();
        names.add(rollTypeName);
        rollTypeNamesByIssueId.set(targetIssueId, names);
      }
    }

    const coningRowsToTrace = (coningRows || []).filter((row) => !holoRowIds.has(String(row?.id || '')));
    const parentIssueIds = Array.from(new Set(coningRowsToTrace.map((row) => row?.issueId).filter(Boolean)));
    const parentIssues = parentIssueIds.length
      ? await db.issueToConingMachine.findMany({
        where: { id: { in: parentIssueIds }, isDeleted: false },
        select: { id: true, receivedRowRefs: true },
      })
      : [];
    const parentIssueById = new Map((parentIssues || []).map((issue) => [String(issue?.id || ''), issue]));
    const nextFrontier = new Map();
    for (const coningRow of coningRowsToTrace) {
      const rowId = String(coningRow?.id || '');
      const parentIssue = parentIssueById.get(String(coningRow?.issueId || ''));
      if (!rowId || !parentIssue) continue;
      const targets = frontier.get(rowId) || [];
      for (const ref of normalizeReceivedRowRefs(parentIssue.receivedRowRefs)) {
        for (const targetIssueId of targets) {
          addLineageFrontierTarget(nextFrontier, seenTargetsByRowId, ref?.rowId, targetIssueId);
        }
      }
    }
    frontier = nextFrontier;
  }

  return new Map(Array.from(rollTypeNamesByIssueId.entries()).map(([issueId, names]) => [
    issueId,
    Array.from(names).sort((a, b) => a.localeCompare(b)).join(', '),
  ]));
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

// Receive derived (computed) filters — not expressible in Prisma because the displayed value
// is computed after the query (per-cone ratio, multi-hop piece ids).
const RECEIVE_COMPUTED_FIELDS = {
  cutter: new Set(),
  holo: new Set(['piece']),
  coning: new Set(['actualG', 'piece']),
};

// Map a batch of raw receive rows into the flattened display shape, attaching the same
// computed extras (piece ids, cone type) the paged handler uses.
async function enrichReceiveRowsWithLabelLineage(process, rows = []) {
  if (process === 'holo') {
    const cutNameByIssueId = await fetchHoloCutNameByIssueIdForReceiveRows(rows);
    return rows.map((row) => ({
      ...row,
      cutName: cutNameByIssueId.get(String(row?.issueId || row?.issue?.id || '')) || row?.cutName || '',
    }));
  }
  if (process === 'coning') {
    const rollTypeNameByIssueId = await fetchConingRollTypeNameByIssueIdForReceiveRows(rows);
    return rows.map((row) => ({
      ...row,
      rollTypeName: rollTypeNameByIssueId.get(String(row?.issueId || row?.issue?.id || '')) || row?.rollTypeName || '',
    }));
  }
  return rows;
}

async function mapReceiveRowsWithExtras(process, rows = [], { includeLabelLineage = true } = {}) {
  if (process === 'holo') {
    const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(rows.map(r => r.issueId));
    const mappedRows = rows.map((r) => mapReceiveRow(process, r, {
      computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [],
    }));
    return includeLabelLineage ? enrichReceiveRowsWithLabelLineage(process, mappedRows) : mappedRows;
  }
  if (process === 'coning') {
    const [pieceIdsByIssueId, coneTypeNameByIssueId] = await Promise.all([
      computeConingIssuePieceIdsByIssueId(rows.map(r => r.issueId)),
      fetchConeTypeNameByIssueIdForConingReceiveRows(rows),
    ]);
    const mappedRows = rows.map((r) => mapReceiveRow(process, r, {
      computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [],
      coneTypeName: coneTypeNameByIssueId.get(String(r.issueId)) || '',
    }));
    return includeLabelLineage ? enrichReceiveRowsWithLabelLineage(process, mappedRows) : mappedRows;
  }
  return rows.map((r) => mapReceiveRow(process, r));
}

function buildReceiveSummaryFromItems(process, items = []) {
  if (process === 'cutter') {
    return { netWt: sumItemsField(items, 'netWt'), bobbinQty: sumItemsField(items, 'bobbinQuantity'), totalCount: items.length };
  }
  if (process === 'holo') {
    return { rolls: sumItemsField(items, 'rollCount'), weight: sumItemsField(items, 'rollWeight'), totalCount: items.length };
  }
  return { cones: sumItemsField(items, 'coneCount'), weight: sumItemsField(items, 'netWeight'), totalCount: items.length };
}

router.get('/receive/:process/history', requireAuth, requireStageReadPermission(receiveStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const issueId = normalizeText(req.query.issueId);
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const dateBasis = normalizeAgentDateBasis(req.query.dateBasis);
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);
  const pageNum = parsePageParam(req.query.page);
  if (!dateBasis) return res.status(400).json({ error: 'dateBasis must be business or record.' });

  try {
    const model = receiveModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, RECEIVE_COMPUTED_FIELDS[process] || new Set());
    const cursorWhere = computedFilters.length > 0 || pageNum != null ? null : buildCursorWhere(cursor, order);
    const dateWhere = buildDateWhereForAgent({ dateFrom, dateTo, dateBasis });
    const filterWhere = buildFilterWhere(rawFilters, RECEIVE_FILTERS, { process });
    const extraWhere = await buildReceiveExtraFilters(filters, process);
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    if (process !== 'cutter') {
      const itemSearchIds = await itemIdsByNameContains(search);
      if (itemSearchIds.length) searchOr.push({ issue: { itemId: { in: itemSearchIds } } });
    }
    const whereAll = {
      isDeleted: false,
      ...(issueId ? { issueId } : {}),
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || extraWhere.length ? { AND: [...filterWhere, ...extraWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const wherePage = applyCursorWhere(whereAll, cursorWhere);

    if (computedFilters.length > 0) {
      const rowsRaw = await model.findMany({
        where: whereAll,
        include: receiveIncludesForProcess(process),
        orderBy: [{ createdAt: order }, { id: order }],
      });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rowsWithItems = process === 'cutter' ? rowsWithUsers : await attachItemNamesToReceiveRows(rowsWithUsers);
      const allItems = (await mapReceiveRowsWithExtras(process, rowsWithItems, { includeLabelLineage: false }))
        .filter((row) => matchesComputedFilters(row, computedFilters));
      const pageCandidates = pageNum != null
        ? allItems.slice((pageNum - 1) * limit)
        : applyCursorToSortedItems(allItems, cursor, order);
      const hasMore = pageCandidates.length > limit;
      const items = await enrichReceiveRowsWithLabelLineage(process, pageCandidates.slice(0, limit));
      const lastInPage = items[items.length - 1];
      const nextCursor = pageNum == null && hasMore && lastInPage
        ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id })
        : null;
      const summary = !cursor && (pageNum == null || pageNum === 1)
        ? buildReceiveSummaryFromItems(process, allItems)
        : null;
      return res.json({
        items,
        hasMore,
        nextCursor,
        summary,
        dateBasis,
        dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
      });
    }

    const rowsRaw = await model.findMany({
      where: wherePage,
      include: receiveIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
      ...(pageNum != null ? { skip: (pageNum - 1) * limit } : {}),
      take: limit + 1,
    });
    const hasMore = rowsRaw.length > limit;
    const page = rowsRaw.slice(0, limit);
    const pageWithUsers = await resolveUserFields(page);
    const pageWithItems = process === 'cutter' ? pageWithUsers : await attachItemNamesToReceiveRows(pageWithUsers);

    const items = await mapReceiveRowsWithExtras(process, pageWithItems);

    const lastInPage = pageWithUsers[pageWithUsers.length - 1];
    const nextCursor = pageNum == null && hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
    // Summary totals for footer (first page only; client preserves it across pages).
    let summary = null;
    if (!cursor && (pageNum == null || pageNum === 1)) {
      const totalCount = await model.count({ where: whereAll });
      if (process === 'cutter') {
        const agg = await prisma.receiveFromCutterMachineRow.aggregate({
          where: whereAll,
          _sum: { netWt: true, bobbinQuantity: true },
        });
        summary = {
          netWt: Number(agg?._sum?.netWt || 0),
          bobbinQty: Number(agg?._sum?.bobbinQuantity || 0),
          totalCount,
        };
      } else if (process === 'holo') {
        const agg = await prisma.receiveFromHoloMachineRow.aggregate({
          where: whereAll,
          _sum: { rollCount: true, rollWeight: true },
        });
        summary = {
          rolls: Number(agg?._sum?.rollCount || 0),
          weight: Number(agg?._sum?.rollWeight || 0),
          totalCount,
        };
      } else if (process === 'coning') {
        const agg = await prisma.receiveFromConingMachineRow.aggregate({
          where: whereAll,
          _sum: { coneCount: true, netWeight: true },
        });
        summary = {
          cones: Number(agg?._sum?.coneCount || 0),
          weight: Number(agg?._sum?.netWeight || 0),
          totalCount,
        };
      }
    }

    res.json({
      items,
      hasMore,
      nextCursor,
      summary,
      dateBasis,
      dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
    });
  } catch (err) {
    console.error('v2 receive history error', err);
    res.status(500).json({ error: err.message || 'Failed to load receive history' });
  }
});

async function fetchReceiveShiftFacet(process) {
  if (process === 'cutter') {
    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { isDeleted: false, NOT: { shift: null } },
      select: { shift: true },
      distinct: ['shift'],
    });
    return rows.map((row) => row.shift).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  const model = process === 'holo' ? prisma.issueToHoloMachine : prisma.issueToConingMachine;
  const rows = await model.findMany({
    where: { isDeleted: false, NOT: { shift: null } },
    select: { shift: true },
    distinct: ['shift'],
  });
  return rows.map((row) => row.shift).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

const RECEIVE_TARGETED_FACET_BASE_FIELDS = Object.freeze([
  'machine',
  'operator',
  'employee',
  'helper',
  'item',
  'cut',
  'yarn',
  'twist',
  'box',
  'bobbin',
  'coneType',
  'addedBy',
  'shift',
]);

export function receiveTargetedFacetFieldsForProcess(process) {
  return process === 'cutter'
    ? [...RECEIVE_TARGETED_FACET_BASE_FIELDS, 'piece']
    : [...RECEIVE_TARGETED_FACET_BASE_FIELDS];
}

async function fetchReceiveFacetValues(process, field) {
  if (!receiveTargetedFacetFieldsForProcess(process).includes(field)) return null;
  if (field === 'machine') {
    const rows = await prisma.machine.findMany({
      where: { processType: { in: ['all', process] } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'operator' || field === 'employee' || field === 'helper') {
    const rows = await prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'item') {
    const rows = await prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'cut') {
    const rows = await prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'yarn') {
    const rows = await prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'twist') {
    const rows = await prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'box') {
    const rows = await prisma.box.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'bobbin') {
    const rows = await prisma.bobbin.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'coneType') {
    const rows = await prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => row.name).filter(Boolean);
  }
  if (field === 'addedBy') {
    const rows = await prisma.user.findMany({ select: { username: true }, orderBy: { username: 'asc' } });
    return rows.map((row) => row.username).filter(Boolean);
  }
  if (field === 'shift') return fetchReceiveShiftFacet(process);
  if (field === 'piece') {
    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { isDeleted: false },
      select: { pieceId: true },
      distinct: ['pieceId'],
      orderBy: { pieceId: 'asc' },
    });
    return rows.map((row) => row.pieceId).filter(Boolean);
  }
  return [];
}

router.get('/receive/:process/history/facets', requireAuth, requireStageReadPermission(receiveStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const field = String(req.query.field || '').trim();
  const excludeField = String(req.query.excludeField || '').trim();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const dateBasis = normalizeAgentDateBasis(req.query.dateBasis);
  const search = req.query.search;
  if (!dateBasis) return res.status(400).json({ error: 'dateBasis must be business or record.' });

  try {
    if (field) {
      const values = await fetchReceiveFacetValues(process, field);
      if (values === null) return res.status(400).json({ error: 'Invalid facet field' });
      return res.json({
        facets: { [field]: values },
        meta: { process, excludeField, field },
      });
    }

    const model = receiveModelForProcess(process);
    const dateWhere = buildDateWhereForAgent({ dateFrom, dateTo, dateBasis });
    const filterWhere = buildFilterWhere(filters, RECEIVE_FILTERS, { excludeField, process });
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length ? { AND: filterWhere } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    // Global facets: from masters + operators; consistent with paging.
    const [machines, operators, helpers, items, cuts, yarns, twists, boxes, bobbins, coneTypes, users] = await Promise.all([
      prisma.machine.findMany({
        where: { processType: { in: ['all', process] } },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.box.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.bobbin.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ select: { username: true }, orderBy: { username: 'asc' } }),
    ]);

    const shifts = await fetchReceiveShiftFacet(process);

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
        bobbin: bobbins.map(r => r.name).filter(Boolean),
        coneType: coneTypes.map(r => r.name).filter(Boolean),
        addedBy: users.map(r => r.username).filter(Boolean),
        shift: shifts,
      },
      meta: {
        process,
        excludeField,
        dateBasis,
        dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
      },
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
  const dateBasis = normalizeAgentDateBasis(req.query.dateBasis);
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);
  if (!dateBasis) return res.status(400).json({ error: 'dateBasis must be business or record.' });

  try {
    const model = receiveModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, RECEIVE_COMPUTED_FIELDS[process] || new Set());
    const dateWhere = buildDateWhereForAgent({ dateFrom, dateTo, dateBasis });
    const filterWhere = buildFilterWhere(rawFilters, RECEIVE_FILTERS, { process });
    const extraWhere = await buildReceiveExtraFilters(filters, process);
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    if (process !== 'cutter') {
      const itemSearchIds = await itemIdsByNameContains(search);
      if (itemSearchIds.length) searchOr.push({ issue: { itemId: { in: itemSearchIds } } });
    }
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length || extraWhere.length ? { AND: [...filterWhere, ...extraWhere] } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const rowsRaw = await model.findMany({
      where,
      include: receiveIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
    });
    const rowsWithUsers = await resolveUserFields(rowsRaw);
    const rowsWithItems = process === 'cutter' ? rowsWithUsers : await attachItemNamesToReceiveRows(rowsWithUsers);

    const items = (await mapReceiveRowsWithExtras(process, rowsWithItems))
      .filter((row) => matchesComputedFilters(row, computedFilters));

    res.json({
      items,
      dateBasis,
      dateFilter: buildAgentDateFilterMetadata({ dateFrom, dateTo, dateBasis }),
    });
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
  const order = normalizeOrder(req.query.order);
  const pageNum = parsePageParam(req.query.page);

  try {
    if (stage === 'inbound') {
      const cursorWhere = (pageNum != null ? null : buildCursorWhere(cursor, order));
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
        orderBy: [{ createdAt: order }, { id: order }],
        ...(pageNum != null ? { skip: (pageNum - 1) * limit } : {}),
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = pageNum == null && hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      const summary = (cursor || (pageNum != null && pageNum !== 1)) ? null : { totalCount: await prisma.inboundItem.count({ where: baseWhere }) };
      // Flatten item name (keyed on the row's own itemId) and resolve createdByUser so the
      // Item and Added By columns render on the first paint instead of after db.* loads.
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToIssueRows(pageWithUsers);
      res.json({ items: pageWithItems, hasMore, nextCursor, summary });
      return;
    }

    if (stage === 'cutter') {
      const model = prisma.receiveFromCutterMachineRow;
      const cursorWhere = (pageNum != null ? null : buildCursorWhere(cursor, order));
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
        orderBy: [{ createdAt: order }, { id: order }],
        ...(pageNum != null ? { skip: (pageNum - 1) * limit } : {}),
        take: limit + 1,
      });
      const hasMore = rowsRaw.length > limit;
      const page = rowsRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const last = pageWithUsers[pageWithUsers.length - 1];
      const nextCursor = pageNum == null && hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      const summary = (cursor || (pageNum != null && pageNum !== 1)) ? null : { totalCount: await model.count({ where: baseWhere }) };
      res.json({ items: pageWithUsers, hasMore, nextCursor, summary });
      return;
    }

    if (stage === 'holo') {
      const cursorWhere = (pageNum != null ? null : buildCursorWhere(cursor, order));
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
        orderBy: [{ createdAt: order }, { id: order }],
        ...(pageNum != null ? { skip: (pageNum - 1) * limit } : {}),
        take: limit + 1,
      });
      const hasMore = rowsRaw.length > limit;
      const page = rowsRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToReceiveRows(pageWithUsers);
      const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(pageWithItems.map(r => r.issueId));
      const items = pageWithItems.map((r) => mapReceiveRow('holo', r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
      const last = items[items.length - 1];
      const nextCursor = pageNum == null && hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      const summary = (cursor || (pageNum != null && pageNum !== 1)) ? null : { totalCount: await prisma.receiveFromHoloMachineRow.count({ where: baseWhere }) };
      res.json({ items, hasMore, nextCursor, summary });
      return;
    }

    if (stage === 'coning') {
      const cursorWhere = (pageNum != null ? null : buildCursorWhere(cursor, order));
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
        orderBy: [{ createdAt: order }, { id: order }],
        ...(pageNum != null ? { skip: (pageNum - 1) * limit } : {}),
        take: limit + 1,
      });
      const hasMore = rowsRaw.length > limit;
      const page = rowsRaw.slice(0, limit);
      const pageWithUsers = await resolveUserFields(page);
      const pageWithItems = await attachItemNamesToReceiveRows(pageWithUsers);
      const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(pageWithItems.map(r => r.issueId));
      const items = pageWithItems.map((r) => mapReceiveRow('coning', r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
      const last = items[items.length - 1];
      const nextCursor = pageNum == null && hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      const summary = (cursor || (pageNum != null && pageNum !== 1)) ? null : { totalCount: await prisma.receiveFromConingMachineRow.count({ where: baseWhere }) };
      res.json({ items, hasMore, nextCursor, summary });
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
  const order = normalizeOrder(req.query.order);
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
      const rowsRaw = await prisma.inboundItem.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rows = await attachItemNamesToIssueRows(rowsWithUsers);
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
        orderBy: [{ createdAt: order }, { id: order }],
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
        orderBy: [{ createdAt: order }, { id: order }],
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
        orderBy: [{ createdAt: order }, { id: order }],
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

// -------------------- On Machine --------------------

function onMachineIncludesForProcess(process) {
  if (process === 'cutter') return { cut: true, machine: true, operator: true, lines: true };
  return { cut: true, machine: true, operator: true, yarn: true, twist: true };
}

// Full filter context (date + search + column filters), WITHOUT cursor.
// Shared by the list, export, and summary paths so they can never disagree.
async function buildOnMachineWhere({ process, filters, dateFrom, dateTo, search }) {
  const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
  const searchOr = buildSearchOr({
    search,
    fields: ['barcode', 'lotNo', 'note', 'machine.name', 'operator.name'],
  });
  const itemSearchIds = await itemIdsByNameContains(search);
  if (itemSearchIds.length) searchOr.push({ itemId: { in: itemSearchIds } });

  const whereAll = {
    isDeleted: false,
    ...(dateWhere ? dateWhere : {}),
    ...(searchOr.length ? { OR: searchOr } : {}),
  };

  // Column filters are supported for the same ids used in OnMachineTable (subset).
  const onMachineFilterWhere = buildFilterWhere(filters, ISSUE_FILTERS, { process });
  const extraWhere = await buildIssueExtraFilters(filters, process);
  const filterAnd = onMachineFilterWhere.length || extraWhere.length
    ? { AND: [...onMachineFilterWhere, ...extraWhere] }
    : {};

  return { ...whereAll, ...filterAnd };
}

// Enrich raw cutter issue rows (with includes) into on-machine entries and keep pending only.
async function buildOnMachineCutterItems(rowsRaw) {
  const rowsWithUsers = await resolveUserFields(rowsRaw);
  const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
  const issueIds = rowsWithItems.map(i => i.id);
  const takeBackTotalsByIssueId = await fetchTakeBackTotalsByIssueIds('cutter', issueIds);
  const wastageByIssueId = await buildCutterIssueWastageByIssueId(rowsWithItems);
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

  return rowsWithItems.map((issue) => {
    const tb = takeBackTotalsByIssueId.get(issue.id) || { count: 0, weight: 0 };
    const originalIssuedWeight = Number(issue.totalWeight || 0);
    const takeBackWeight = Number(tb.weight || 0);
    const netIssuedWeight = Math.max(0, originalIssuedWeight - takeBackWeight);
    const receivedWeight = Number(receivedByIssue.get(issue.id) || 0);
    const wastageWeight = Number(wastageByIssueId.get(issue.id) || 0);
    const pendingWeight = Math.max(0, netIssuedWeight - receivedWeight - wastageWeight);
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
      wastageWeight,
      pendingWeight,
      pieceIdsList,
    };
  }).filter(i => i.pendingWeight > 0.001);
}

// Enrich raw holo issue rows (with includes) into on-machine entries and keep pending only.
async function buildOnMachineHoloItems(rowsRaw) {
  const rowsWithUsers = await resolveUserFields(rowsRaw);
  const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
  const issueIds = rowsWithItems.map(i => i.id);
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

  return rowsWithItems.map((issue) => {
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
}

// Enrich raw coning issue rows (with includes) into on-machine entries and keep pending only.
async function buildOnMachineConingItems(rowsRaw) {
  const rowsWithUsers = await resolveUserFields(rowsRaw);
  const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
  const issueIds = rowsWithItems.map(i => i.id);
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
  const wastageByIssue = new Map();
  if (issueIds.length) {
    const wastageTotals = await prisma.receiveFromConingMachinePieceTotal.findMany({
      where: { pieceId: { in: issueIds } },
      select: { pieceId: true, wastageNetWeight: true },
    });
    for (const w of wastageTotals) {
      const wt = Number(w.wastageNetWeight || 0);
      if (wt > 0) wastageByIssue.set(w.pieceId, wt);
    }
  }
  const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(issueIds);
  const coneTypeIds = new Set();
  for (const issue of rowsWithItems) {
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

  return rowsWithItems.map((issue) => {
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
      rollsIssued,
      coneTypeName,
      perConeTargetG: Number(issue.requiredPerConeNetWeight || 0),
      receivedWeight,
      wastageWeight,
      pendingWeight,
      pieceIdsList: pieceIdsByIssueId.get(issue.id) || [],
    };
  }).filter(i => i.pendingWeight > 0.001);
}

function buildOnMachineItems(process, rowsRaw) {
  if (process === 'holo') return buildOnMachineHoloItems(rowsRaw);
  if (process === 'coning') return buildOnMachineConingItems(rowsRaw);
  return buildOnMachineCutterItems(rowsRaw);
}

// Footer summary over already-built on-machine items (used when a computed filter forces a
// full in-memory pass). Items are already restricted to pending > 0.001 by the builders.
function buildOnMachineSummaryFromItems(items = []) {
  const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, wastageWeight: 0, pendingWeight: 0, totalCount: 0 };
  for (const it of items || []) {
    s.originalIssuedWeight += Number(it?.originalIssuedWeight || 0);
    s.takeBackWeight += Number(it?.takeBackWeight || 0);
    s.netIssuedWeight += Number(it?.netIssuedWeight ?? it?.issuedWeight ?? 0);
    s.receivedWeight += Number(it?.receivedWeight || 0);
    s.wastageWeight += Number(it?.wastageWeight || 0);
    s.pendingWeight += Number(it?.pendingWeight || 0);
    s.totalCount += 1;
  }
  return s;
}

// Load the full filtered set, build items, apply in-memory computed filters, then paginate +
// summarize. Used by the on-machine list/export when derived-field filters are active.
async function buildOnMachineComputedResult({ process, whereAllFiltered, computedFilters, cursor, order, limit, isFirstPage }) {
  const model = issueModelForProcess(process);
  const allRaw = await model.findMany({
    where: whereAllFiltered,
    include: onMachineIncludesForProcess(process),
    orderBy: [{ createdAt: order }, { id: order }],
  });
  const allItems = (await buildOnMachineItems(process, allRaw))
    .filter((it) => matchesComputedFilters(it, computedFilters));
  const pageCandidates = applyCursorToSortedItems(allItems, cursor, order);
  const hasMore = pageCandidates.length > limit;
  const items = pageCandidates.slice(0, limit);
  const lastInPage = items[items.length - 1];
  const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
  const summary = isFirstPage ? buildOnMachineSummaryFromItems(allItems) : null;
  return { items, hasMore, nextCursor, summary };
}

router.get('/on-machine/:process', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);

  try {
    const cursorWhere = buildCursorWhere(cursor, order);
    // whereAllFiltered = all filters WITHOUT cursor (for summary across entire dataset)
    const whereAllFiltered = await buildOnMachineWhere({ process, filters, dateFrom, dateTo, search });

    // where = all filters + cursor (for paginated results)
    const where = applyCursorWhere(whereAllFiltered, cursorWhere);

    // isFirstPage — only compute summary on the first page to avoid repeating expensive work
    const isFirstPage = !cursor;

    // Derived-field filters (issued/received/pending weights, coning rolls, holo/coning piece)
    // cannot be expressed in Prisma; load the full filtered set and filter in memory.
    const { computedFilters } = splitComputedFilters(filters, ON_MACHINE_COMPUTED_FIELDS[process] || new Set());
    if (computedFilters.length > 0) {
      const result = await buildOnMachineComputedResult({ process, whereAllFiltered, computedFilters, cursor, order, limit, isFirstPage });
      res.json(result);
      return;
    }

    if (process === 'cutter') {
      const issuesRaw = await prisma.issueToCutterMachine.findMany({
        where,
        include: onMachineIncludesForProcess(process),
        orderBy: [{ createdAt: order }, { id: order }],
        take: limit + 1,
      });
      const hasMore = issuesRaw.length > limit;
      const page = issuesRaw.slice(0, limit);
      const items = await buildOnMachineCutterItems(page);

      // Compute grand-total summary on first page only
      let summary = null;
      if (isFirstPage) {
        const allIssues = await prisma.issueToCutterMachine.findMany({
          where: whereAllFiltered,
          select: { id: true, totalWeight: true, pieceIds: true },
        });
        const allIds = allIssues.map(i => i.id);
        const allTb = await fetchTakeBackTotalsByIssueIds('cutter', allIds);
        const allWasteMap = await buildCutterIssueWastageByIssueId(allIssues);
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
        const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, wastageWeight: 0, pendingWeight: 0, totalCount: 0 };
        for (const issue of allIssues) {
          const tb = allTb.get(issue.id) || { weight: 0 };
          const orig = Number(issue.totalWeight || 0);
          const tbW = Number(tb.weight || 0);
          const net = Math.max(0, orig - tbW);
          const recv = Number(allRecvMap.get(issue.id) || 0);
          const waste = Number(allWasteMap.get(issue.id) || 0);
          const pend = Math.max(0, net - recv - waste);
          if (pend <= 0.001) continue; // skip fully accounted issues
          s.originalIssuedWeight += orig;
          s.takeBackWeight += tbW;
          s.netIssuedWeight += net;
          s.receivedWeight += recv;
          s.wastageWeight += waste;
          s.pendingWeight += pend;
          s.totalCount += 1;
        }
        summary = s;
      }

      const lastInPage = page[page.length - 1];
      const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
      res.json({ items, hasMore, nextCursor, summary });
      return;
    }

    if (process === 'holo') {
      const issuesRaw = await prisma.issueToHoloMachine.findMany({
        where,
        include: onMachineIncludesForProcess(process),
        orderBy: [{ createdAt: order }, { id: order }],
        take: limit + 1,
      });
      const hasMore = issuesRaw.length > limit;
      const page = issuesRaw.slice(0, limit);
      const items = await buildOnMachineHoloItems(page);

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
        const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, wastageWeight: 0, pendingWeight: 0, totalCount: 0 };
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
          s.wastageWeight += waste;
          s.pendingWeight += pend;
          s.totalCount += 1;
        }
        summary = s;
      }

      const lastInPage = page[page.length - 1];
      const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
      res.json({ items, hasMore, nextCursor, summary });
      return;
    }

    // coning
    const issuesRaw = await prisma.issueToConingMachine.findMany({
      where,
      include: onMachineIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
      take: limit + 1,
    });
    const hasMore = issuesRaw.length > limit;
    const page = issuesRaw.slice(0, limit);
    const items = await buildOnMachineConingItems(page);

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
      const allWasteMap = new Map();
      if (allIds.length) {
        const allWastageTotals = await prisma.receiveFromConingMachinePieceTotal.findMany({
          where: { pieceId: { in: allIds } },
          select: { pieceId: true, wastageNetWeight: true },
        });
        for (const w of allWastageTotals) {
          const wt = Number(w.wastageNetWeight || 0);
          if (wt > 0) allWasteMap.set(w.pieceId, wt);
        }
      }
      const s = { originalIssuedWeight: 0, takeBackWeight: 0, netIssuedWeight: 0, receivedWeight: 0, wastageWeight: 0, pendingWeight: 0, rollsIssued: 0, totalCount: 0 };
      for (const issue of allIssues) {
        const refs = normalizeReceivedRowRefs(issue.receivedRowRefs);
        const orig = refs.reduce((sum, ref) => sum + Number(ref?.issueWeight || 0), 0);
        const rolls = refs.reduce((sum, ref) => sum + Number(ref?.issueRolls || ref?.baseRolls || 0), 0);
        const tb = allTb.get(issue.id) || { weight: 0 };
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
        s.wastageWeight += waste;
        s.pendingWeight += pend;
        s.rollsIssued += rolls;
        s.totalCount += 1;
      }
      summary = s;
    }

    const lastInPage = page[page.length - 1];
    const nextCursor = hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;
    res.json({ items, hasMore, nextCursor, summary });
  } catch (err) {
    console.error('v2 on-machine error', err);
    res.status(500).json({ error: err.message || 'Failed to load on-machine' });
  }
});

// Export the FULL filtered on-machine set (no pagination) so Excel exports are never
// silently truncated to the pages a user happened to scroll through.
router.get('/on-machine/:process/export.json', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);

  try {
    const whereAllFiltered = await buildOnMachineWhere({ process, filters, dateFrom, dateTo, search });
    const model = issueModelForProcess(process);
    const rowsRaw = await model.findMany({
      where: whereAllFiltered,
      include: onMachineIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
    });
    const { computedFilters } = splitComputedFilters(filters, ON_MACHINE_COMPUTED_FIELDS[process] || new Set());
    const items = (await buildOnMachineItems(process, rowsRaw))
      .filter((it) => matchesComputedFilters(it, computedFilters));
    res.json({ items });
  } catch (err) {
    console.error('v2 on-machine export error', err);
    res.status(500).json({ error: err.message || 'Failed to export' });
  }
});

// Facet values for the on-machine column filter dropdowns. Same master-table approach
// as the issue-tracking facets so options never depend on which pages are loaded.
router.get('/on-machine/:process/facets', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const excludeField = String(req.query.excludeField || '').trim();

  try {
    const [machines, operators, items, cuts, yarns, twists, coneTypes] = await Promise.all([
      prisma.machine.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    ]);

    let shifts = [];
    if (process === 'holo') {
      const distinctShifts = await prisma.issueToHoloMachine.findMany({
        where: { isDeleted: false, NOT: { shift: null } },
        select: { shift: true },
        distinct: ['shift'],
      });
      shifts = distinctShifts.map(s => s.shift).filter(Boolean);
    } else if (process === 'coning') {
      const distinctShifts = await prisma.issueToConingMachine.findMany({
        where: { isDeleted: false, NOT: { shift: null } },
        select: { shift: true },
        distinct: ['shift'],
      });
      shifts = distinctShifts.map(s => s.shift).filter(Boolean);
    }
    shifts.sort((a, b) => a.localeCompare(b));

    res.json({
      facets: {
        machine: machines.map(r => r.name).filter(Boolean),
        operator: operators.map(r => r.name).filter(Boolean),
        item: items.map(r => r.name).filter(Boolean),
        cut: cuts.map(r => r.name).filter(Boolean),
        yarn: yarns.map(r => r.name).filter(Boolean),
        twist: twists.map(r => r.name).filter(Boolean),
        coneType: coneTypes.map(r => r.name).filter(Boolean),
        shift: shifts,
      },
      meta: { process, excludeField },
    });
  } catch (err) {
    console.error('v2 on-machine facets error', err);
    res.status(500).json({ error: err.message || 'Failed to load facets' });
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
            (st.id IS NOT NULL) AS is_steamed,
            st."boilerNumber" AS boiler_number,
            bm.name AS boiler_machine_name,
            CASE
              WHEN bm.name IS NULL AND st."boilerNumber" IS NULL THEN NULL
              WHEN bm.name IS NULL THEN 'No. ' || st."boilerNumber"::text
              WHEN st."boilerNumber" IS NULL THEN bm.name
              ELSE bm.name || ' • No. ' || st."boilerNumber"::text
            END AS boiler_label
          FROM "ReceiveFromHoloMachineRow" r
          JOIN "IssueToHoloMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
          LEFT JOIN issued iss ON iss.row_id = r.id
          LEFT JOIN takeback tb ON tb.row_id = r.id
          LEFT JOIN "BoilerSteamLog" st
            ON st."holoReceiveRowId" = r.id OR (st."barcode" IS NOT NULL AND upper(st."barcode") = upper(r."barcode"))
          LEFT JOIN "Machine" bm ON bm.id = st."boilerMachineId"
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
          SUM(CASE WHEN rc.is_steamed THEN GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls) ELSE 0 END) AS steamed_rolls,
          array_remove(array_agg(DISTINCT rc.boiler_machine_name), NULL) AS boiler_machine_names,
          array_remove(array_agg(DISTINCT rc.boiler_label), NULL) AS boiler_labels
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
        const boilerMachineNames = Array.isArray(r.boiler_machine_names)
          ? r.boiler_machine_names.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
          : [];
        const boilerLabels = Array.isArray(r.boiler_labels)
          ? r.boiler_labels.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
          : [];
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
          boilerMachineNames,
          boilerMachineNamesStr: boilerMachineNames.join(', '),
          boilerLabels,
          boilerLabelsStr: boilerLabels.join(', '),
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
      const lotNoRaw = String(key.lotNoRaw || '');

      const rows = await prisma.$queryRaw`
        WITH candidate_issues AS MATERIALIZED (
          SELECT
            i.id,
            i."lotNo",
            i."itemId",
            i."yarnId",
            i."twistId",
            i."cutId",
            i."receivedRowRefs"
          FROM "IssueToHoloMachine" i
          LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
          LEFT JOIN "Cut" ct ON ct.id = i."cutId"
          WHERE i."isDeleted" = false
            AND i."itemId" = ${itemId}
            AND (${lotNoRaw} = '' OR i."lotNo" = ${lotNoRaw})
            AND (${yarnId}::text IS NULL OR i."yarnId" = ${yarnId})
            AND (${twistId}::text IS NULL OR i."twistId" = ${twistId})
            AND (${isMixed}::boolean = true OR COALESCE(lot."firmId", '') = ${firmId})
            AND (${isMixed}::boolean = true OR COALESCE(lot."supplierId", '') = ${supplierId})
            AND (${cutNames.length} = 0 OR COALESCE(ct.name, '—') = ANY(${cutNames}::text[]))
        ),
        issue_refs AS (
          SELECT ci.id AS issue_id, elem->>'rowId' AS cutter_row_id
          FROM candidate_issues ci
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(ci."receivedRowRefs", '[]'::jsonb)) elem ON true
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
          SELECT ci.id AS issue_id,
                 CASE
                   WHEN COALESCE(array_length(il.lot_nos, 1), 0) <= 1 THEN COALESCE(il.lot_nos[1], ci."lotNo", '')
                   WHEN array_length(il.lot_nos, 1) <= 3 THEN 'Mixed (' || array_to_string(il.lot_nos, ', ') || ')'
                   ELSE 'Mixed (' || array_length(il.lot_nos, 1) || ')'
                 END AS lot_label
          FROM candidate_issues ci
          LEFT JOIN issue_lots il ON il.issue_id = ci.id
        ),
        candidate_rows AS MATERIALIZED (
          SELECT r.*
          FROM "ReceiveFromHoloMachineRow" r
          JOIN candidate_issues ci ON ci.id = r."issueId"
          JOIN issue_labels il ON il.issue_id = ci.id
          WHERE r."isDeleted" = false
            AND il.lot_label = ${lotLabel}
        ),
        issued AS (
          SELECT
            elem->>'rowId' AS row_id,
            SUM(CASE WHEN (elem->>'issueRolls') IS NULL OR (elem->>'issueRolls') = '' THEN 0 ELSE (elem->>'issueRolls')::numeric END) AS issue_rolls,
            SUM(CASE WHEN (elem->>'issueWeight') IS NULL OR (elem->>'issueWeight') = '' THEN 0 ELSE (elem->>'issueWeight')::numeric END) AS issue_weight
          FROM "IssueToConingMachine" ic
          JOIN LATERAL jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem ON true
          JOIN candidate_rows cr ON cr.id = elem->>'rowId'
          WHERE ic."isDeleted" = false
          GROUP BY row_id
        ),
        takeback AS (
          SELECT
            l."sourceId" AS row_id,
            SUM((CASE WHEN tb."isReverse" = true THEN 1 ELSE -1 END) * l."count") AS tb_rolls,
            SUM((CASE WHEN tb."isReverse" = true THEN 1 ELSE -1 END) * l."weight") AS tb_weight
          FROM "IssueTakeBackLine" l
          JOIN candidate_rows cr ON cr.id = l."sourceId"
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
          (st.id IS NOT NULL) AS is_steamed,
          st."boilerMachineId" AS boiler_machine_id,
          bm.name AS boiler_machine_name,
          st."boilerNumber" AS boiler_number,
          r."notes"
        FROM candidate_rows r
        JOIN candidate_issues i ON i.id = r."issueId"
        LEFT JOIN issued iss ON iss.row_id = r.id
        LEFT JOIN takeback tb ON tb.row_id = r.id
        LEFT JOIN "RollType" rt ON rt.id = r."rollTypeId"
        LEFT JOIN "BoilerSteamLog" st
          ON st."holoReceiveRowId" = r.id OR (st."barcode" IS NOT NULL AND upper(st."barcode") = upper(r."barcode"))
        LEFT JOIN "Machine" bm ON bm.id = st."boilerMachineId"
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
        boilerMachineId: r.boiler_machine_id || null,
        boilerMachineName: r.boiler_machine_name || null,
        boilerNumber: r.boiler_number ? Number(r.boiler_number) : null,
        notes: r.notes || '',
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
          AND (r."barcode" ILIKE ${'%' + q + '%'} OR r."notes" ILIKE ${'%' + q + '%'})
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
        AND (r."barcode" ILIKE ${'%' + q + '%'} OR r."notes" ILIKE ${'%' + q + '%'})
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
