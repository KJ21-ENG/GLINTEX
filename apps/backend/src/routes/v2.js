import { Router } from 'express';
import { Prisma } from '@prisma/client';

import prisma from '../lib/prisma.js';
import { requirePermission } from '../middleware/auth.js';
import { requireSessionOrAgentRead as requireAuth } from '../middleware/agentPrincipalAuth.js';
import { resolveUserFields } from '../utils/userResolver.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import { computeIssueBalancesBatch } from '../services/issueBalances.js';
import {
  buildReceiveMachineContainsFilter,
  buildReceiveMachineInFilter,
  resolveDisplayedReceiveMachineName,
} from '../utils/receiveHistoryFilters.js';

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

async function loadConingTraceMap(issueIds = []) {
  const ids = Array.from(new Set(issueIds.filter(Boolean)));
  const out = new Map();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE lineage AS (
      SELECT ic.id AS root_issue_id, ic.id AS issue_id, ARRAY[ic.id]::text[] AS path, 0 AS depth
      FROM "IssueToConingMachine" ic
      WHERE ic.id = ANY (${ids}::text[]) AND ic."isDeleted" = false
      UNION ALL
      SELECT l.root_issue_id, parent.id, l.path || parent.id, l.depth + 1
      FROM lineage l
      JOIN "IssueToConingMachine" current_issue ON current_issue.id = l.issue_id
      JOIN LATERAL jsonb_array_elements(COALESCE(current_issue."receivedRowRefs", '[]'::jsonb)) elem ON true
      JOIN "ReceiveFromConingMachineRow" parent_row ON parent_row.id = elem->>'rowId' AND parent_row."isDeleted" = false
      JOIN "IssueToConingMachine" parent ON parent.id = parent_row."issueId" AND parent."isDeleted" = false
      WHERE l.depth < 20 AND NOT parent.id = ANY(l.path)
    )
    SELECT
      l.root_issue_id,
      array_remove(array_agg(DISTINCT hi."cutId"), NULL) AS cut_ids,
      array_remove(array_agg(DISTINCT ct.name), NULL) AS cut_names,
      array_remove(array_agg(DISTINCT hi."yarnId"), NULL) AS yarn_ids,
      array_remove(array_agg(DISTINCT yn.name), NULL) AS yarn_names,
      array_remove(array_agg(DISTINCT hi."twistId"), NULL) AS twist_ids,
      array_remove(array_agg(DISTINCT tw.name), NULL) AS twist_names
    FROM lineage l
    JOIN "IssueToConingMachine" ci ON ci.id = l.issue_id
    JOIN LATERAL jsonb_array_elements(COALESCE(ci."receivedRowRefs", '[]'::jsonb)) elem ON true
    JOIN "ReceiveFromHoloMachineRow" hr ON hr.id = elem->>'rowId' AND hr."isDeleted" = false
    JOIN "IssueToHoloMachine" hi ON hi.id = hr."issueId" AND hi."isDeleted" = false
    LEFT JOIN "Cut" ct ON ct.id = hi."cutId"
    LEFT JOIN "Yarn" yn ON yn.id = hi."yarnId"
    LEFT JOIN "Twist" tw ON tw.id = hi."twistId"
    GROUP BY l.root_issue_id
  `;
  const normalize = (values) => Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b)));
  for (const row of rows || []) {
    const cutNames = normalize(row.cut_names);
    const yarnNames = normalize(row.yarn_names);
    const twistNames = normalize(row.twist_names);
    out.set(row.root_issue_id, {
      cutIds: normalize(row.cut_ids),
      cutNames,
      cutName: cutNames.join(', '),
      yarnIds: normalize(row.yarn_ids),
      yarnNames,
      yarnName: yarnNames.join(', '),
      twistIds: normalize(row.twist_ids),
      twistNames,
      twistName: twistNames.join(', '),
    });
  }
  return out;
}

async function buildConingTraceWhereFromSheetFilters(filters = []) {
  const relevant = (filters || []).filter((filter) => ['cut', 'yarn', 'twist'].includes(String(filter?.field || '')));
  if (relevant.length === 0) return [];
  const issues = await prisma.issueToConingMachine.findMany({
    where: { isDeleted: false },
    include: { cut: true, yarn: true, twist: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const traceMap = await loadConingTraceMap(issues.map((issue) => issue.id));
  const matches = (issue, filter) => {
    const field = String(filter.field);
    const trace = traceMap.get(issue.id);
    const tracedValues = trace?.[`${field}Names`] || [];
    const fallback = issue?.[field]?.name ? [issue[field].name] : [];
    const values = tracedValues.length > 0 ? tracedValues : fallback;
    if (filter.op === 'in') {
      const expected = new Set((filter.values || []).map(String));
      return values.some((value) => expected.has(String(value)));
    }
    if (filter.op === 'contains') {
      const needle = String(filter.value || '').trim().toLowerCase();
      return !needle || values.some((value) => String(value).toLowerCase().includes(needle));
    }
    return true;
  };
  const ids = issues.filter((issue) => relevant.every((filter) => matches(issue, filter))).map((issue) => issue.id);
  return [{ id: { in: ids.length > 0 ? ids : ['__no_such_issue__'] } }];
}

const CONING_TRACE_FILTER_FIELDS = new Set(['cut', 'yarn', 'twist']);

function coningTraceFilters(filters = []) {
  return (filters || []).filter((filter) => CONING_TRACE_FILTER_FIELDS.has(String(filter?.field || '')));
}

function matchesConingTraceFilters(row, filters = []) {
  return (filters || []).every((filter) => {
    const field = String(filter?.field || '');
    const tokens = String(row?.[`${field}Name`] || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (filter?.op === 'in') {
      const expected = new Set((Array.isArray(filter.values) ? filter.values : []).map(String));
      return expected.size === 0 || tokens.some((value) => expected.has(value));
    }
    if (filter?.op === 'contains') {
      const needle = String(filter.value || '').trim().toLowerCase();
      return !needle || tokens.some((value) => value.toLowerCase().includes(needle));
    }
    return true;
  });
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

async function loadStageFacetUsers(model) {
  const actorRows = await model.findMany({
    where: { isDeleted: false, NOT: { createdByUserId: null } },
    select: { createdByUserId: true },
    distinct: ['createdByUserId'],
  });
  const userIds = actorRows.map((row) => row.createdByUserId).filter(Boolean);
  if (userIds.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { username: true },
    orderBy: { username: 'asc' },
  });
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
    if (!['cutter', 'holo', 'coning'].includes(process)) return null;
    return { ...parsed, process };
  } catch {
    return null;
  }
}

function calcAvailableCountFromWeight({ totalCount, issuedCount, dispatchedCount, totalWeight, availableWeight }) {
  const total = Number(totalCount || 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const countBased = Math.max(0, total - Number(issuedCount || 0) - Number(dispatchedCount || 0));
  const totalWt = Number(totalWeight || 0);
  if (!Number.isFinite(totalWt) || totalWt <= 0) return countBased;
  const availableWt = Number(availableWeight || 0);
  if (!Number.isFinite(availableWt) || availableWt <= 0) return 0;
  const weightBased = Math.floor(((availableWt / totalWt) * total) + 1e-6);
  return Math.max(0, Math.min(countBased, weightBased));
}

export function encodeCursor({ createdAt, id }) {
  const payload = { createdAt, id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodeCursor(raw) {
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

export function applyCursorWhere(baseWhere, cursorWhere) {
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

async function buildIssueExtraFilters(filters = [], process, { includeConingTrace = true } = {}) {
  const out = [];
  out.push(...await buildItemWhereFromSheetFilters(filters, { mode: 'issue' }));
  if (process === 'coning') {
    out.push(...await buildConeTypeWhereFromSheetFilters(filters, { mode: 'issue' }));
    if (includeConingTrace) out.push(...await buildConingTraceWhereFromSheetFilters(filters));
  }
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

async function mapIssueTrackingBatch(process, rowsRaw) {
  const rowsWithUsers = await resolveUserFields(rowsRaw);
  const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
  const issueIds = rowsWithItems.map((row) => row.id);
  const [takeBackTotalsByIssueId, wastageByIssueId, traceByIssueId] = await Promise.all([
    fetchTakeBackTotalsByIssueIds(process, issueIds),
    process === 'cutter' ? buildCutterIssueWastageByIssueId(rowsWithItems) : Promise.resolve(new Map()),
    process === 'coning' ? loadConingTraceMap(issueIds) : Promise.resolve(new Map()),
  ]);
  return rowsWithItems.map((row) => mapIssueRow(process, row, {
    takeBackTotalsByIssueId,
    wastageByIssueId,
    traceByIssueId,
  }));
}

async function buildUnfilteredIssueTrackingSummarySql(process) {
  if (process === 'cutter') {
    const [row] = await prisma.$queryRaw`
      WITH takebacks AS (
        SELECT "issueId", SUM("totalCount")::numeric AS count, SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'cutter' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), balances AS (
        SELECT i.id,
          COALESCE(i.count, 0)::numeric AS qty,
          COALESCE(i."totalWeight", 0)::numeric AS original_weight,
          COALESCE(tb.count, 0)::numeric AS takeback_count,
          COALESCE(tb.weight, 0)::numeric AS takeback_weight
        FROM "IssueToCutterMachine" i
        LEFT JOIN takebacks tb ON tb."issueId" = i.id
        WHERE i."isDeleted" = false
      )
      SELECT COALESCE(SUM(qty), 0)::float8 AS qty,
        COALESCE(SUM(original_weight), 0)::float8 AS weight,
        COALESCE(SUM(takeback_count), 0)::float8 AS taken_back_count,
        COALESCE(SUM(takeback_weight), 0)::float8 AS taken_back_weight,
        COALESCE(SUM(GREATEST(0, original_weight - takeback_weight)), 0)::float8 AS net_issued_weight,
        COUNT(*)::int AS total_count
      FROM balances
    `;
    return {
      qty: Number(row?.qty || 0),
      weight: Number(row?.weight || 0),
      takenBackCount: Number(row?.taken_back_count || 0),
      takenBackWeight: Number(row?.taken_back_weight || 0),
      netIssuedWeight: Number(row?.net_issued_weight || 0),
      totalCount: Number(row?.total_count || 0),
    };
  }
  if (process === 'holo') {
    const [row] = await prisma.$queryRaw`
      WITH takebacks AS (
        SELECT "issueId", SUM("totalCount")::numeric AS count, SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'holo' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), balances AS (
        SELECT i.id,
          COALESCE(i."metallicBobbins", 0)::numeric AS metallic_bobbins,
          COALESCE(i."metallicBobbinsWeight", 0)::numeric AS metallic_bobbins_weight,
          (COALESCE(i."metallicBobbinsWeight", 0) + COALESCE(i."yarnKg", 0))::numeric AS original_weight,
          COALESCE(i."yarnKg", 0)::numeric AS yarn_kg,
          COALESCE(i."rollsProducedEstimate", 0)::numeric AS rolls_estimate,
          COALESCE(tb.count, 0)::numeric AS takeback_count,
          COALESCE(tb.weight, 0)::numeric AS takeback_weight
        FROM "IssueToHoloMachine" i
        LEFT JOIN takebacks tb ON tb."issueId" = i.id
        WHERE i."isDeleted" = false
      )
      SELECT COALESCE(SUM(metallic_bobbins), 0)::float8 AS metallic_bobbins,
        COALESCE(SUM(metallic_bobbins_weight), 0)::float8 AS metallic_bobbins_weight,
        COALESCE(SUM(yarn_kg), 0)::float8 AS yarn_kg,
        COALESCE(SUM(rolls_estimate), 0)::float8 AS rolls_estimate,
        COALESCE(SUM(takeback_count), 0)::float8 AS taken_back_count,
        COALESCE(SUM(takeback_weight), 0)::float8 AS taken_back_weight,
        COALESCE(SUM(GREATEST(0, original_weight - takeback_weight)), 0)::float8 AS net_issued_weight,
        COUNT(*)::int AS total_count
      FROM balances
    `;
    return {
      metallicBobbins: Number(row?.metallic_bobbins || 0),
      metallicBobbinsWeight: Number(row?.metallic_bobbins_weight || 0),
      yarnKg: Number(row?.yarn_kg || 0),
      rollsProducedEstimate: Number(row?.rolls_estimate || 0),
      takenBackCount: Number(row?.taken_back_count || 0),
      takenBackWeight: Number(row?.taken_back_weight || 0),
      netIssuedWeight: Number(row?.net_issued_weight || 0),
      totalCount: Number(row?.total_count || 0),
    };
  }
  const [row] = await prisma.$queryRaw`
    WITH issue_refs AS (
      SELECT i.id,
        COALESCE(SUM(COALESCE(NULLIF(ref->>'issueRolls', '')::numeric, NULLIF(ref->>'baseRolls', '')::numeric, 0)), 0)::numeric AS rolls_issued,
        COALESCE(SUM(COALESCE(NULLIF(ref->>'issueWeight', '')::numeric, 0)), 0)::numeric AS original_weight
      FROM "IssueToConingMachine" i
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) ref ON true
      WHERE i."isDeleted" = false
      GROUP BY i.id
    ), takebacks AS (
      SELECT "issueId", SUM("totalCount")::numeric AS count, SUM("totalWeight")::numeric AS weight
      FROM "IssueTakeBack"
      WHERE stage = 'coning' AND "isReverse" = false AND "isReversed" = false
      GROUP BY "issueId"
    ), balances AS (
      SELECT refs.*,
        COALESCE(tb.count, 0)::numeric AS takeback_count,
        COALESCE(tb.weight, 0)::numeric AS takeback_weight
      FROM issue_refs refs
      LEFT JOIN takebacks tb ON tb."issueId" = refs.id
    )
    SELECT COALESCE(SUM(rolls_issued), 0)::float8 AS rolls_issued,
      COALESCE(SUM(original_weight), 0)::float8 AS original_weight,
      COALESCE(SUM(takeback_count), 0)::float8 AS taken_back_count,
      COALESCE(SUM(takeback_weight), 0)::float8 AS taken_back_weight,
      COALESCE(SUM(GREATEST(0, original_weight - takeback_weight)), 0)::float8 AS net_issued_weight,
      COUNT(*)::int AS total_count
    FROM balances
  `;
  return {
    rollsIssued: Number(row?.rolls_issued || 0),
    originalIssuedWeight: Number(row?.original_weight || 0),
    takenBackCount: Number(row?.taken_back_count || 0),
    takenBackWeight: Number(row?.taken_back_weight || 0),
    netIssuedWeight: Number(row?.net_issued_weight || 0),
    totalCount: Number(row?.total_count || 0),
  };
}

async function buildBoundedIssueTrackingResult({
  process,
  whereAll,
  filters,
  computedFilters,
  cursor,
  pageNum,
  order,
  limit,
}) {
  const model = issueModelForProcess(process);
  const traceFilters = process === 'coning' ? coningTraceFilters(filters) : [];
  const items = [];
  // Computed and trace filters cannot be summarized without replaying every
  // matching issue through application-level lineage/balance mapping. Keep the
  // ordinary page bounded and omit the global footer for this filtered context.
  const summary = null;
  const pageOffset = pageNum != null ? (pageNum - 1) * limit : 0;
  const desiredMatchCount = pageOffset + limit + 1;
  let scanCursor = pageNum != null ? null : cursor;
  let exhausted = false;
  const batchSize = Math.max(200, Math.min(1000, limit * 5));
  const maxScanRows = Math.max(batchSize, Math.min(5000, desiredMatchCount * 10));
  let scannedRows = 0;

  while (!exhausted && items.length < desiredMatchCount && scannedRows < maxScanRows) {
    const where = applyCursorWhere(whereAll, buildCursorWhere(scanCursor, order));
    const requestedBatchSize = Math.min(batchSize, maxScanRows - scannedRows);
    const raw = await model.findMany({
      where,
      include: issueIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
      take: requestedBatchSize,
    });
    if (raw.length === 0) {
      exhausted = true;
      break;
    }
    scannedRows += raw.length;
    const mapped = (await mapIssueTrackingBatch(process, raw))
      .filter((row) => matchesConingTraceFilters(row, traceFilters))
      .filter((row) => matchesComputedFilters(row, computedFilters));
    items.push(...mapped);
    const lastRaw = raw[raw.length - 1];
    scanCursor = { createdAt: lastRaw.createdAt, id: lastRaw.id };
    exhausted = raw.length < requestedBatchSize;
  }

  const hasBufferedMatch = items.length > pageOffset + limit;
  const hasMore = hasBufferedMatch || (!exhausted && Boolean(scanCursor));
  const pageItems = items.slice(pageOffset, pageOffset + limit);
  // If a full result page was found, resume after the last returned match so
  // any additional matches already seen in the final raw batch are retained.
  // Otherwise resume after the final scanned raw row and never replay the same
  // sparse segment.
  const continuation = hasBufferedMatch ? pageItems[pageItems.length - 1] : scanCursor;
  const nextCursor = pageNum == null && hasMore && continuation
    ? encodeCursor({ createdAt: continuation.createdAt, id: continuation.id })
    : null;
  return { items: pageItems, hasMore, nextCursor, summary };
}

async function buildCutterIssueWastageByIssueId(issueRows = []) {
  const issueIds = Array.from(new Set((issueRows || []).map((row) => row?.id).filter(Boolean)));
  const output = new Map(issueIds.map((issueId) => [issueId, 0]));
  if (!issueIds.length) return output;

  const pieceIds = Array.from(new Set(
    (issueRows || []).flatMap((row) => parsePieceIdsCsv(row?.pieceIds))
  ));
  if (!pieceIds.length) return output;

  const issueLines = await prisma.$queryRaw`
    SELECT line."pieceId" AS "pieceId", line."issueId" AS "issueId", issue."createdAt" AS "createdAt"
    FROM "IssueToCutterMachineLine" line
    JOIN "IssueToCutterMachine" issue ON issue.id = line."issueId"
    WHERE issue."isDeleted" = false AND line."pieceId" = ANY(${pieceIds}::text[])
    UNION
    SELECT trim(header_piece.piece_id) AS "pieceId", issue.id AS "issueId", issue."createdAt" AS "createdAt"
    FROM "IssueToCutterMachine" issue
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(issue."pieceIds", ''), '\\s*,\\s*')
      AS header_piece(piece_id)
    WHERE issue."isDeleted" = false
      AND trim(header_piece.piece_id) <> ''
      AND trim(header_piece.piece_id) = ANY(${pieceIds}::text[])
  `;

  const issuesByPiece = new Map();
  issueLines.forEach((line) => {
    const pieceId = String(line?.pieceId || '').trim();
    if (!pieceId) return;
    const entries = issuesByPiece.get(pieceId) || [];
    entries.push({
      issueId: line.issueId,
      createdAtMs: toTimeMs(line.createdAt),
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
    in: (values, ctx) => (ctx?.process === 'coning' ? {} : { cut: { name: { in: values } } }),
    contains: (value, ctx) => (ctx?.process === 'coning' ? {} : { cut: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  yarn: {
    in: (values, ctx) => (ctx?.process === 'coning' ? {} : { yarn: { name: { in: values } } }),
    contains: (value, ctx) => (ctx?.process === 'coning' ? {} : { yarn: { name: { contains: value, mode: 'insensitive' } } }),
    between: () => ({}),
  },
  twist: {
    in: (values, ctx) => (ctx?.process === 'coning' ? {} : { twist: { name: { in: values } } }),
    contains: (value, ctx) => (ctx?.process === 'coning' ? {} : { twist: { name: { contains: value, mode: 'insensitive' } } }),
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

function mapIssueRow(process, row, { takeBackTotalsByIssueId, wastageByIssueId, traceByIssueId } = {}) {
  const tb = takeBackTotalsByIssueId.get(row.id) || { count: 0, weight: 0 };
  let originalIssuedWeight = Number(process === 'cutter'
    ? row.totalWeight
    : process === 'holo'
      ? Number(row.metallicBobbinsWeight || 0) + Number(row.yarnKg || 0)
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
  const trace = process === 'coning' ? traceByIssueId?.get(row.id) : null;
  return {
    ...row,
    // Flatten common names to avoid frontend deep lookups (UI stays same).
    itemName: row.itemName || '',
    cutName: trace?.cutName || row.cut?.name || '',
    yarnName: trace?.yarnName || row.yarn?.name || '',
    twistName: trace?.twistName || row.twist?.name || '',
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
  const order = normalizeOrder(req.query.order);
  const pageNum = parsePageParam(req.query.page);

  try {
    const model = issueModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, ISSUE_COMPUTED_FIELDS[process] || new Set());
    const cursorWhere = computedFilters.length > 0 || pageNum != null ? null : buildCursorWhere(cursor, order);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(rawFilters, ISSUE_FILTERS, { process });
    const traceFilters = process === 'coning' ? coningTraceFilters(filters) : [];
    const extraWhere = await buildIssueExtraFilters(filters, process, { includeConingTrace: false });
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

    if (computedFilters.length > 0 || traceFilters.length > 0) {
      if (pageNum != null && ((pageNum - 1) * limit + limit + 1) > 5000) {
        return res.status(400).json({
          error: 'This filtered page is beyond the bounded page window. Reload and continue with the cursor.',
          code: 'cursor_required',
        });
      }
      const result = await buildBoundedIssueTrackingResult({
        process,
        whereAll,
        filters,
        computedFilters,
        cursor,
        pageNum,
        order,
        limit,
      });
      return res.json(result);
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
    const traceByIssueId = process === 'coning' ? await loadConingTraceMap(issueIds) : new Map();
    const items = pageWithItems.map((r) => mapIssueRow(process, r, { takeBackTotalsByIssueId, wastageByIssueId, traceByIssueId }));
    const lastInPage = pageWithItems[pageWithItems.length - 1];
    const nextCursor = pageNum == null && hasMore && lastInPage ? encodeCursor({ createdAt: lastInPage.createdAt, id: lastInPage.id }) : null;

    const isFirstPage = !cursor && (pageNum == null || pageNum === 1);
    const canUseAggregateSummary = isFirstPage
      && filters.length === 0
      && !normalizeText(search)
      && !dateFrom
      && !dateTo;
    // Full unfiltered totals stay database-aggregate backed. Filtered totals are
    // omitted because resolving them would require enumerating every matching
    // issue before the first page can render.
    const summary = canUseAggregateSummary
      ? await buildUnfilteredIssueTrackingSummarySql(process)
      : null;

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
    const filterWhere = buildFilterWhere(filters, ISSUE_FILTERS, { excludeField, process });
    const searchOr = buildSearchOr({ search, fields: pickIssueSearchFields(process) });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length ? { AND: filterWhere } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };

    const supportsYarn = process !== 'cutter';
    const supportsConeType = process === 'coning';
    const [machines, operators, items, cuts, yarns, twists, coneTypes, users] = await Promise.all([
      prisma.machine.findMany({
        where: { processType: { in: ['all', process] } },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      supportsYarn ? prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      supportsYarn ? prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      supportsConeType ? prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      loadStageFacetUsers(model),
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
  const order = normalizeOrder(req.query.order);

  try {
    const model = issueModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, ISSUE_COMPUTED_FIELDS[process] || new Set());
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
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
    const traceByIssueId = process === 'coning'
      ? await loadConingTraceMap(rowsWithItems.map((row) => row.id))
      : new Map();
    const items = rowsWithItems
      .map((r) => mapIssueRow(process, r, { takeBackTotalsByIssueId, wastageByIssueId, traceByIssueId }))
      .filter((row) => matchesComputedFilters(row, computedFilters));
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
  const base = { ...row };
  if (process === 'holo' || process === 'coning') {
    base.shift = row.shift || row.issue?.shift || '';
    base.itemName = row.issue?.itemName || '';
    base.cutName = row.issue?.cut?.name || '';
    base.yarnName = row.issue?.yarn?.name || '';
    base.twistName = row.issue?.twist?.name || '';
    if (process === 'coning') {
      // Coning-specific fields are needed for immediate, correct first-render in Receive History.
      // Returning them from v2 eliminates UI dependence on late-loaded legacy module data.
      base.perConeTargetG = Number(row.issue?.requiredPerConeNetWeight || 0);
      base.coneTypeName = extras.coneTypeName || '';
      base.machineName = resolveDisplayedReceiveMachineName(row, { process });
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

// Receive derived (computed) filters — not expressible in Prisma because the displayed value
// is computed after the query (per-cone ratio, multi-hop piece ids).
const RECEIVE_COMPUTED_FIELDS = {
  cutter: new Set(),
  holo: new Set(['piece']),
  coning: new Set(['actualG', 'piece']),
};

// Map a batch of raw receive rows into the flattened display shape, attaching the same
// computed extras (piece ids, cone type) the paged handler uses.
async function mapReceiveRowsWithExtras(process, rows = []) {
  if (process === 'holo') {
    const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(rows.map(r => r.issueId));
    return rows.map((r) => mapReceiveRow(process, r, { computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [] }));
  }
  if (process === 'coning') {
    const pieceIdsByIssueId = await computeConingIssuePieceIdsByIssueId(rows.map(r => r.issueId));
    const coneTypeNameByIssueId = await fetchConeTypeNameByIssueIdForConingReceiveRows(rows);
    return rows.map((r) => mapReceiveRow(process, r, {
      computedPieceIds: pieceIdsByIssueId.get(r.issueId) || [],
      coneTypeName: coneTypeNameByIssueId.get(String(r.issueId)) || '',
    }));
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
  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);
  const pageNum = parsePageParam(req.query.page);

  try {
    const model = receiveModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, RECEIVE_COMPUTED_FIELDS[process] || new Set());
    const cursorWhere = computedFilters.length > 0 || pageNum != null ? null : buildCursorWhere(cursor, order);
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
    const filterWhere = buildFilterWhere(rawFilters, RECEIVE_FILTERS, { process });
    const extraWhere = await buildReceiveExtraFilters(filters, process);
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    if (process !== 'cutter') {
      const itemSearchIds = await itemIdsByNameContains(search);
      if (itemSearchIds.length) searchOr.push({ issue: { itemId: { in: itemSearchIds } } });
    }
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
        include: receiveIncludesForProcess(process),
        orderBy: [{ createdAt: order }, { id: order }],
      });
      const rowsWithUsers = await resolveUserFields(rowsRaw);
      const rowsWithItems = process === 'cutter' ? rowsWithUsers : await attachItemNamesToReceiveRows(rowsWithUsers);
      const allItems = (await mapReceiveRowsWithExtras(process, rowsWithItems))
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
        ? buildReceiveSummaryFromItems(process, allItems)
        : null;
      return res.json({ items, hasMore, nextCursor, summary });
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
    const filterWhere = buildFilterWhere(filters, RECEIVE_FILTERS, { excludeField, process });
    const searchOr = buildSearchOr({ search, fields: pickReceiveSearchFields(process) });
    const where = {
      isDeleted: false,
      ...(dateWhere ? dateWhere : {}),
      ...(filterWhere.length ? { AND: filterWhere } : {}),
      ...(searchOr.length ? { OR: searchOr } : {}),
    };
    const supportsYarn = process !== 'cutter';
    const supportsBobbin = process === 'cutter';
    const supportsConeType = process === 'coning';
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
      supportsYarn ? prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      supportsYarn ? prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      prisma.box.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      supportsBobbin ? prisma.bobbin.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      supportsConeType ? prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      loadStageFacetUsers(model),
    ]);

    let shifts = [];
    if (process === 'cutter') {
      const distinctShifts = await prisma.receiveFromCutterMachineRow.findMany({
        where: { isDeleted: false, NOT: { shift: null } },
        select: { shift: true },
        distinct: ['shift'],
      });
      shifts = distinctShifts.map(s => s.shift).filter(Boolean);
    } else if (process === 'holo') {
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
  const order = normalizeOrder(req.query.order);

  try {
    const model = receiveModelForProcess(process);
    const { rawFilters, computedFilters } = splitComputedFilters(filters, RECEIVE_COMPUTED_FIELDS[process] || new Set());
    const dateWhere = buildDateWhere({ dateFrom, dateTo, field: 'date' });
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
      const rowsRaw = await prisma.inboundItem.findMany({ where, orderBy: [{ createdAt: order }, { id: order }] });
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
  const extraWhere = await buildIssueExtraFilters(filters, process, { includeConingTrace: false });
  const filterAnd = onMachineFilterWhere.length || extraWhere.length
    ? { AND: [...onMachineFilterWhere, ...extraWhere] }
    : {};

  return { ...whereAll, ...filterAnd };
}

// Enrich raw cutter issue rows (with includes) into on-machine entries and keep pending only.
async function buildOnMachineCutterItems(rowsRaw) {
  const rowsWithUsers = await resolveUserFields(rowsRaw);
  const rowsWithItems = await attachItemNamesToIssueRows(rowsWithUsers);
  const unresolved = rowsWithItems.filter((issue) => !issue.__onMachineBalance);
  const balanceByIssueId = unresolved.length > 0
    ? await computeIssueBalancesBatch(prisma, 'cutter', unresolved)
    : new Map();

  return rowsWithItems.map((issue) => {
    const balance = issue.__onMachineBalance || balanceByIssueId.get(issue.id) || {};
    const originalIssuedWeight = Number(balance.original_weight ?? balance.originalWeight ?? 0);
    const takeBackWeight = Number(balance.takeback_weight ?? balance.takeBackWeight ?? 0);
    const netIssuedWeight = Number(balance.net_issued_weight ?? balance.netIssuedWeight ?? 0);
    const receivedWeight = Number(balance.received_weight ?? balance.receivedWeight ?? 0);
    const wastageWeight = Number(balance.wastage_weight ?? balance.wastageWeight ?? 0);
    const pendingWeight = Number(balance.pending_weight ?? balance.pendingWeight ?? 0);
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
      select: {
        issueId: true,
        rollWeight: true,
        grossWeight: true,
        tareWeight: true,
        isWastage: true,
      },
    })
    : [];
  const receivedByIssue = new Map();
  const wastageByIssue = new Map();
  for (const r of receiveRows) {
    const netWeight = Number.isFinite(r.rollWeight)
      ? Number(r.rollWeight)
      : (Number(r.grossWeight || 0) - Number(r.tareWeight || 0));
    const isWastage = r.isWastage === true;
    if (isWastage) {
      wastageByIssue.set(r.issueId, (wastageByIssue.get(r.issueId) || 0) + netWeight);
    } else {
      receivedByIssue.set(r.issueId, (receivedByIssue.get(r.issueId) || 0) + netWeight);
    }
  }
  const pieceIdsByIssueId = await computeHoloIssuePieceIdsByIssueId(issueIds);

  return rowsWithItems.map((issue) => {
    const tb = takeBackTotalsByIssueId.get(issue.id) || { count: 0, weight: 0 };
    const originalIssuedWeight = Number(issue.metallicBobbinsWeight || 0) + Number(issue.yarnKg || 0);
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
  const traceByIssueId = await loadConingTraceMap(issueIds);
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
    const trace = traceByIssueId.get(issue.id);
    return {
      ...issue,
      itemName: issue.itemName || '',
      cutName: trace?.cutName || issue.cut?.name || '',
      yarnName: trace?.yarnName || issue.yarn?.name || '',
      twistName: trace?.twistName || issue.twist?.name || '',
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
async function loadPendingOnMachinePage({ process, whereAllFiltered, cursor, order, limit, postFilters = [] }) {
  const model = issueModelForProcess(process);
  const collected = [];
  let scanCursor = cursor;
  let exhausted = false;
  const batchSize = Math.max(100, Math.min(500, limit * 4));
  const maxScanRows = Math.max(batchSize, Math.min(1000, limit * 10));
  let scannedRows = 0;

  while (collected.length <= limit && !exhausted && scannedRows < maxScanRows) {
    const where = applyCursorWhere(whereAllFiltered, buildCursorWhere(scanCursor, order));
    const requestedBatchSize = Math.min(batchSize, maxScanRows - scannedRows);
    const raw = await model.findMany({
      where,
      include: onMachineIncludesForProcess(process),
      orderBy: [{ createdAt: order }, { id: order }],
      take: requestedBatchSize,
    });
    if (raw.length === 0) {
      exhausted = true;
      break;
    }
    scannedRows += raw.length;
    const traceFilters = process === 'coning' ? coningTraceFilters(postFilters) : [];
    const computedFilters = splitComputedFilters(postFilters, ON_MACHINE_COMPUTED_FIELDS[process] || new Set()).computedFilters;
    const pendingItems = (await buildOnMachineItems(process, raw))
      .filter((item) => matchesConingTraceFilters(item, traceFilters))
      .filter((item) => matchesComputedFilters(item, computedFilters));
    collected.push(...pendingItems);
    const lastRaw = raw[raw.length - 1];
    scanCursor = { createdAt: lastRaw.createdAt, id: lastRaw.id };
    exhausted = raw.length < requestedBatchSize;
  }

  const hasBufferedMatch = collected.length > limit;
  const hasMore = hasBufferedMatch || (!exhausted && Boolean(scanCursor));
  const items = collected.slice(0, limit);
  const continuation = hasBufferedMatch ? items[items.length - 1] : scanCursor;
  const nextCursor = hasMore && continuation
    ? encodeCursor({ createdAt: continuation.createdAt, id: continuation.id })
    : null;
  return { items, hasMore, nextCursor };
}

async function loadUnfilteredPendingOnMachinePageSql({ process, cursor, order, limit }) {
  const direction = Prisma.raw(order === 'asc' ? 'ASC' : 'DESC');
  const comparison = Prisma.raw(order === 'asc' ? '>' : '<');
  const cursorSql = cursor
    ? Prisma.sql`AND (pending."createdAt", pending.id) ${comparison} (${cursor.createdAt}, ${cursor.id})`
    : Prisma.sql``;
  let selected = [];

  if (process === 'cutter') {
    selected = await prisma.$queryRaw(Prisma.sql`
      WITH active_issues AS (
        SELECT id, "createdAt", COALESCE("totalWeight", 0)::numeric AS original_weight
        FROM "IssueToCutterMachine"
        WHERE "isDeleted" = false
      ), issue_candidates AS (
        SELECT line."issueId" AS issue_id, line."pieceId" AS piece_id, issue."createdAt" AS created_at
        FROM "IssueToCutterMachineLine" line
        JOIN active_issues issue ON issue.id = line."issueId"
        UNION
        SELECT issue.id AS issue_id, trim(header_piece.piece_id) AS piece_id, issue."createdAt" AS created_at
        FROM "IssueToCutterMachine" source_issue
        JOIN active_issues issue ON issue.id = source_issue.id
        CROSS JOIN LATERAL regexp_split_to_table(COALESCE(source_issue."pieceIds", ''), '\\s*,\\s*')
          AS header_piece(piece_id)
        WHERE trim(header_piece.piece_id) <> ''
      ), takebacks AS (
        SELECT "issueId", SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'cutter' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), receive_allocations AS (
        SELECT r."issueId" AS issue_id, COALESCE(r."netWt", 0)::numeric AS received_weight
        FROM "ReceiveFromCutterMachineRow" r
        WHERE r."isDeleted" = false AND r."issueId" IS NOT NULL
        UNION ALL
        SELECT assigned.issue_id, COALESCE(r."netWt", 0)::numeric AS received_weight
        FROM "ReceiveFromCutterMachineRow" r
        JOIN LATERAL (
          SELECT candidate.issue_id
          FROM issue_candidates candidate
          WHERE candidate.piece_id = r."pieceId" AND candidate.created_at <= r."createdAt"
          ORDER BY candidate.created_at DESC, candidate.issue_id DESC
          LIMIT 1
        ) assigned ON true
        WHERE r."isDeleted" = false AND r."issueId" IS NULL
      ), receives AS (
        SELECT issue_id, SUM(received_weight)::numeric AS received_weight
        FROM receive_allocations
        GROUP BY issue_id
      ), assigned_wastage AS (
        SELECT assigned.issue_id, SUM(COALESCE(c."wastageNetWeight", 0))::numeric AS wastage_weight
        FROM "ReceiveFromCutterMachineChallan" c
        JOIN LATERAL (
          SELECT candidate.issue_id
          FROM issue_candidates candidate
          WHERE candidate.piece_id = c."pieceId" AND candidate.created_at <= c."createdAt"
          ORDER BY candidate.created_at DESC, candidate.issue_id DESC
          LIMIT 1
        ) assigned ON true
        WHERE c."isDeleted" = false AND COALESCE(c."wastageNetWeight", 0) > 0
        GROUP BY assigned.issue_id
      ), pending AS (
        SELECT i.id, i."createdAt", i.original_weight,
          COALESCE(tb.weight, 0)::numeric AS takeback_weight,
          GREATEST(0, i.original_weight - COALESCE(tb.weight, 0))::numeric AS net_issued_weight,
          COALESCE(rc.received_weight, 0)::numeric AS received_weight,
          COALESCE(w.wastage_weight, 0)::numeric AS wastage_weight,
          GREATEST(0,
            GREATEST(0, i.original_weight - COALESCE(tb.weight, 0))
            - COALESCE(rc.received_weight, 0) - COALESCE(w.wastage_weight, 0)
          )::numeric AS pending_weight
        FROM active_issues i
        LEFT JOIN takebacks tb ON tb."issueId" = i.id
        LEFT JOIN receives rc ON rc.issue_id = i.id
        LEFT JOIN assigned_wastage w ON w.issue_id = i.id
      )
      SELECT id, "createdAt", original_weight, takeback_weight, net_issued_weight,
             received_weight, wastage_weight, pending_weight
      FROM pending
      WHERE pending_weight > 0.001 ${cursorSql}
      ORDER BY "createdAt" ${direction}, id ${direction}
      LIMIT ${limit + 1}
    `);
  } else if (process === 'holo') {
    selected = await prisma.$queryRaw(Prisma.sql`
      WITH takebacks AS (
        SELECT "issueId", SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'holo' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), receives AS (
        SELECT r."issueId",
          SUM(CASE WHEN r."isWastage" IS TRUE THEN 0
            ELSE COALESCE(r."rollWeight", COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)) END)::numeric AS received_weight,
          SUM(CASE WHEN r."isWastage" IS TRUE
            THEN COALESCE(r."rollWeight", COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)) ELSE 0 END)::numeric AS wastage_weight
        FROM "ReceiveFromHoloMachineRow" r
        WHERE r."isDeleted" = false
        GROUP BY r."issueId"
      ), pending AS (
        SELECT i.id, i."createdAt",
          GREATEST(0,
            GREATEST(0, COALESCE(i."metallicBobbinsWeight", 0) + COALESCE(i."yarnKg", 0) - COALESCE(tb.weight, 0))
            - COALESCE(rc.received_weight, 0) - COALESCE(rc.wastage_weight, 0)
          )::numeric AS pending_weight
        FROM "IssueToHoloMachine" i
        LEFT JOIN takebacks tb ON tb."issueId" = i.id
        LEFT JOIN receives rc ON rc."issueId" = i.id
        WHERE i."isDeleted" = false
      )
      SELECT id, "createdAt"
      FROM pending
      WHERE pending_weight > 0.001 ${cursorSql}
      ORDER BY "createdAt" ${direction}, id ${direction}
      LIMIT ${limit + 1}
    `);
  } else if (process === 'coning') {
    selected = await prisma.$queryRaw(Prisma.sql`
      WITH issue_refs AS (
        SELECT i.id, i."createdAt",
          COALESCE(SUM(COALESCE(NULLIF(ref->>'issueWeight', '')::numeric, 0)), 0)::numeric AS original_weight
        FROM "IssueToConingMachine" i
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) ref ON true
        WHERE i."isDeleted" = false
        GROUP BY i.id, i."createdAt"
      ), takebacks AS (
        SELECT "issueId", SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'coning' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), receives AS (
        SELECT "issueId", SUM(COALESCE("netWeight", 0))::numeric AS received_weight
        FROM "ReceiveFromConingMachineRow"
        WHERE "isDeleted" = false
        GROUP BY "issueId"
      ), wastage AS (
        SELECT "pieceId" AS issue_id, SUM(COALESCE("wastageNetWeight", 0))::numeric AS wastage_weight
        FROM "ReceiveFromConingMachinePieceTotal"
        GROUP BY "pieceId"
      ), pending AS (
        SELECT refs.id, refs."createdAt",
          GREATEST(0,
            GREATEST(0, refs.original_weight - COALESCE(tb.weight, 0))
            - COALESCE(rc.received_weight, 0) - COALESCE(w.wastage_weight, 0)
          )::numeric AS pending_weight
        FROM issue_refs refs
        LEFT JOIN takebacks tb ON tb."issueId" = refs.id
        LEFT JOIN receives rc ON rc."issueId" = refs.id
        LEFT JOIN wastage w ON w.issue_id = refs.id
      )
      SELECT id, "createdAt"
      FROM pending
      WHERE pending_weight > 0.001 ${cursorSql}
      ORDER BY "createdAt" ${direction}, id ${direction}
      LIMIT ${limit + 1}
    `);
  } else {
    throw Object.assign(new Error('Invalid process'), { status: 400 });
  }

  const hasMore = selected.length > limit;
  const page = selected.slice(0, limit);
  const pageIds = page.map((row) => row.id);
  const model = issueModelForProcess(process);
  const raw = pageIds.length
    ? await model.findMany({
      where: { id: { in: pageIds }, isDeleted: false },
      include: onMachineIncludesForProcess(process),
    })
    : [];
  const orderById = new Map(pageIds.map((id, index) => [id, index]));
  raw.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  const selectedById = new Map(page.map((row) => [row.id, row]));
  const rowsWithSelectedBalances = process === 'cutter'
    ? raw.map((row) => ({ ...row, __onMachineBalance: selectedById.get(row.id) || null }))
    : raw;
  const items = await buildOnMachineItems(process, rowsWithSelectedBalances);
  const last = page[page.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

function summarizeOnMachineItems(items) {
  return items.reduce((summary, item) => {
    summary.originalIssuedWeight += Number(item.originalIssuedWeight || 0);
    summary.takeBackWeight += Number(item.takeBackWeight || 0);
    summary.netIssuedWeight += Number(item.netIssuedWeight || 0);
    summary.receivedWeight += Number(item.receivedWeight || 0);
    summary.wastageWeight += Number(item.wastageWeight || 0);
    summary.pendingWeight += Number(item.pendingWeight || 0);
    summary.rollsIssued += Number(item.rollsIssued || 0);
    summary.totalCount += 1;
    return summary;
  }, {
    originalIssuedWeight: 0,
    takeBackWeight: 0,
    netIssuedWeight: 0,
    receivedWeight: 0,
    wastageWeight: 0,
    pendingWeight: 0,
    rollsIssued: 0,
    totalCount: 0,
  });
}

async function buildUnfilteredOnMachineSummarySql(process) {
  if (process === 'cutter') {
    const [row] = await prisma.$queryRaw`
      WITH active_issues AS (
        SELECT id, "totalWeight", "createdAt"
        FROM "IssueToCutterMachine"
        WHERE "isDeleted" = false
      ), issue_candidates AS (
        SELECT line."issueId" AS issue_id, line."pieceId" AS piece_id, issue."createdAt" AS created_at
        FROM "IssueToCutterMachineLine" line
        JOIN active_issues issue ON issue.id = line."issueId"
        UNION
        SELECT issue.id AS issue_id, trim(header_piece.piece_id) AS piece_id, issue."createdAt" AS created_at
        FROM "IssueToCutterMachine" source_issue
        JOIN active_issues issue ON issue.id = source_issue.id
        CROSS JOIN LATERAL regexp_split_to_table(COALESCE(source_issue."pieceIds", ''), '\\s*,\\s*')
          AS header_piece(piece_id)
        WHERE trim(header_piece.piece_id) <> ''
      ), takebacks AS (
        SELECT "issueId", SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'cutter' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), receive_allocations AS (
        SELECT r."issueId" AS issue_id, COALESCE(r."netWt", 0)::numeric AS received_weight
        FROM "ReceiveFromCutterMachineRow" r
        WHERE r."isDeleted" = false AND r."issueId" IS NOT NULL
        UNION ALL
        SELECT assigned.issue_id, COALESCE(r."netWt", 0)::numeric AS received_weight
        FROM "ReceiveFromCutterMachineRow" r
        JOIN LATERAL (
          SELECT candidate.issue_id
          FROM issue_candidates candidate
          WHERE candidate.piece_id = r."pieceId" AND candidate.created_at <= r."createdAt"
          ORDER BY candidate.created_at DESC, candidate.issue_id DESC
          LIMIT 1
        ) assigned ON true
        WHERE r."isDeleted" = false AND r."issueId" IS NULL
      ), receives AS (
        SELECT issue_id, SUM(received_weight)::numeric AS received_weight
        FROM receive_allocations
        GROUP BY issue_id
      ), assigned_wastage AS (
        SELECT assigned.issue_id, SUM(COALESCE(c."wastageNetWeight", 0))::numeric AS wastage_weight
        FROM "ReceiveFromCutterMachineChallan" c
        JOIN LATERAL (
          SELECT candidate.issue_id
          FROM issue_candidates candidate
          WHERE candidate.piece_id = c."pieceId"
            AND candidate.created_at <= c."createdAt"
          ORDER BY candidate.created_at DESC, candidate.issue_id DESC
          LIMIT 1
        ) assigned ON true
        WHERE c."isDeleted" = false AND COALESCE(c."wastageNetWeight", 0) > 0
        GROUP BY assigned.issue_id
      ), balances AS (
        SELECT i.id,
          COALESCE(i."totalWeight", 0)::numeric AS original_weight,
          COALESCE(tb.weight, 0)::numeric AS takeback_weight,
          GREATEST(0, COALESCE(i."totalWeight", 0) - COALESCE(tb.weight, 0))::numeric AS net_weight,
          COALESCE(rc.received_weight, 0)::numeric AS received_weight,
          COALESCE(w.wastage_weight, 0)::numeric AS wastage_weight
        FROM active_issues i
        LEFT JOIN takebacks tb ON tb."issueId" = i.id
        LEFT JOIN receives rc ON rc.issue_id = i.id
        LEFT JOIN assigned_wastage w ON w.issue_id = i.id
      ), pending AS (
        SELECT *, GREATEST(0, net_weight - received_weight - wastage_weight)::numeric AS pending_weight
        FROM balances
      )
      SELECT
        COALESCE(SUM(original_weight), 0)::float8 AS original_issued_weight,
        COALESCE(SUM(takeback_weight), 0)::float8 AS takeback_weight,
        COALESCE(SUM(net_weight), 0)::float8 AS net_issued_weight,
        COALESCE(SUM(received_weight), 0)::float8 AS received_weight,
        COALESCE(SUM(wastage_weight), 0)::float8 AS wastage_weight,
        COALESCE(SUM(pending_weight), 0)::float8 AS pending_weight,
        COUNT(*)::int AS total_count
      FROM pending
      WHERE pending_weight > 0.001
    `;
    return {
      originalIssuedWeight: Number(row?.original_issued_weight || 0),
      takeBackWeight: Number(row?.takeback_weight || 0),
      netIssuedWeight: Number(row?.net_issued_weight || 0),
      receivedWeight: Number(row?.received_weight || 0),
      wastageWeight: Number(row?.wastage_weight || 0),
      pendingWeight: Number(row?.pending_weight || 0),
      totalCount: Number(row?.total_count || 0),
    };
  }
  if (process === 'holo') {
    const [row] = await prisma.$queryRaw`
      WITH takebacks AS (
        SELECT "issueId", SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'holo' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), receives AS (
        SELECT r."issueId",
          SUM(CASE WHEN r."isWastage" IS TRUE THEN 0
            ELSE COALESCE(r."rollWeight", COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)) END)::numeric AS received_weight,
          SUM(CASE WHEN r."isWastage" IS TRUE
            THEN COALESCE(r."rollWeight", COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)) ELSE 0 END)::numeric AS wastage_weight
        FROM "ReceiveFromHoloMachineRow" r
        WHERE r."isDeleted" = false
        GROUP BY r."issueId"
      ), balances AS (
        SELECT i.id,
          (COALESCE(i."metallicBobbinsWeight", 0) + COALESCE(i."yarnKg", 0))::numeric AS original_weight,
          COALESCE(tb.weight, 0)::numeric AS takeback_weight,
          GREATEST(0, COALESCE(i."metallicBobbinsWeight", 0) + COALESCE(i."yarnKg", 0) - COALESCE(tb.weight, 0))::numeric AS net_weight,
          COALESCE(rc.received_weight, 0)::numeric AS received_weight,
          COALESCE(rc.wastage_weight, 0)::numeric AS wastage_weight
        FROM "IssueToHoloMachine" i
        LEFT JOIN takebacks tb ON tb."issueId" = i.id
        LEFT JOIN receives rc ON rc."issueId" = i.id
        WHERE i."isDeleted" = false
      ), pending AS (
        SELECT *, GREATEST(0, net_weight - received_weight - wastage_weight)::numeric AS pending_weight
        FROM balances
      )
      SELECT
        COALESCE(SUM(original_weight), 0)::float8 AS original_issued_weight,
        COALESCE(SUM(takeback_weight), 0)::float8 AS takeback_weight,
        COALESCE(SUM(net_weight), 0)::float8 AS net_issued_weight,
        COALESCE(SUM(received_weight), 0)::float8 AS received_weight,
        COALESCE(SUM(wastage_weight), 0)::float8 AS wastage_weight,
        COALESCE(SUM(pending_weight), 0)::float8 AS pending_weight,
        COUNT(*)::int AS total_count
      FROM pending
      WHERE pending_weight > 0.001
    `;
    return {
      originalIssuedWeight: Number(row?.original_issued_weight || 0),
      takeBackWeight: Number(row?.takeback_weight || 0),
      netIssuedWeight: Number(row?.net_issued_weight || 0),
      receivedWeight: Number(row?.received_weight || 0),
      wastageWeight: Number(row?.wastage_weight || 0),
      pendingWeight: Number(row?.pending_weight || 0),
      totalCount: Number(row?.total_count || 0),
    };
  }
  if (process === 'coning') {
    const [row] = await prisma.$queryRaw`
      WITH issue_refs AS (
        SELECT i.id AS issue_id,
          COALESCE(SUM(COALESCE(NULLIF(ref->>'issueWeight', '')::numeric, 0)), 0)::numeric AS original_weight,
          COALESCE(SUM(COALESCE(NULLIF(ref->>'issueRolls', '')::numeric, NULLIF(ref->>'baseRolls', '')::numeric, 0)), 0)::numeric AS rolls_issued
        FROM "IssueToConingMachine" i
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) ref ON true
        WHERE i."isDeleted" = false
        GROUP BY i.id
      ), takebacks AS (
        SELECT "issueId", SUM("totalWeight")::numeric AS weight
        FROM "IssueTakeBack"
        WHERE stage = 'coning' AND "isReverse" = false AND "isReversed" = false
        GROUP BY "issueId"
      ), receives AS (
        SELECT "issueId", SUM(COALESCE("netWeight", 0))::numeric AS received_weight
        FROM "ReceiveFromConingMachineRow"
        WHERE "isDeleted" = false
        GROUP BY "issueId"
      ), wastage AS (
        SELECT "pieceId" AS issue_id, SUM(COALESCE("wastageNetWeight", 0))::numeric AS wastage_weight
        FROM "ReceiveFromConingMachinePieceTotal"
        GROUP BY "pieceId"
      ), balances AS (
        SELECT refs.issue_id,
          refs.original_weight,
          refs.rolls_issued,
          COALESCE(tb.weight, 0)::numeric AS takeback_weight,
          GREATEST(0, refs.original_weight - COALESCE(tb.weight, 0))::numeric AS net_weight,
          COALESCE(rc.received_weight, 0)::numeric AS received_weight,
          COALESCE(w.wastage_weight, 0)::numeric AS wastage_weight
        FROM issue_refs refs
        LEFT JOIN takebacks tb ON tb."issueId" = refs.issue_id
        LEFT JOIN receives rc ON rc."issueId" = refs.issue_id
        LEFT JOIN wastage w ON w.issue_id = refs.issue_id
      ), pending AS (
        SELECT *, GREATEST(0, net_weight - received_weight - wastage_weight)::numeric AS pending_weight
        FROM balances
      )
      SELECT
        COALESCE(SUM(original_weight), 0)::float8 AS original_issued_weight,
        COALESCE(SUM(takeback_weight), 0)::float8 AS takeback_weight,
        COALESCE(SUM(net_weight), 0)::float8 AS net_issued_weight,
        COALESCE(SUM(received_weight), 0)::float8 AS received_weight,
        COALESCE(SUM(wastage_weight), 0)::float8 AS wastage_weight,
        COALESCE(SUM(pending_weight), 0)::float8 AS pending_weight,
        COALESCE(SUM(rolls_issued), 0)::float8 AS rolls_issued,
        COUNT(*)::int AS total_count
      FROM pending
      WHERE pending_weight > 0.001
    `;
    return {
      originalIssuedWeight: Number(row?.original_issued_weight || 0),
      takeBackWeight: Number(row?.takeback_weight || 0),
      netIssuedWeight: Number(row?.net_issued_weight || 0),
      receivedWeight: Number(row?.received_weight || 0),
      wastageWeight: Number(row?.wastage_weight || 0),
      pendingWeight: Number(row?.pending_weight || 0),
      rollsIssued: Number(row?.rolls_issued || 0),
      totalCount: Number(row?.total_count || 0),
    };
  }
  return null;
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
  const separateSummary = String(req.query.summaryMode || '').toLowerCase() === 'separate';

  try {
    const whereAllFiltered = await buildOnMachineWhere({ process, filters, dateFrom, dateTo, search });
    const isFirstPage = !cursor;
    const isUnfiltered = filters.length === 0 && !normalizeText(search) && !dateFrom && !dateTo;
    const { items, hasMore, nextCursor } = isUnfiltered
      ? await loadUnfilteredPendingOnMachinePageSql({ process, cursor, order, limit })
      : await loadPendingOnMachinePage({
        process, whereAllFiltered, cursor, order, limit, postFilters: filters,
      });
    const canUseAggregateSummary = isFirstPage
      && ['cutter', 'holo', 'coning'].includes(process)
      && isUnfiltered
      && !separateSummary;
    // Filtered On Machine totals require trace and balance derivation for the
    // complete history. Return the exact bounded page without a misleading or
    // unbounded footer; unfiltered totals remain aggregate-backed in SQL.
    const summary = canUseAggregateSummary
      ? await buildUnfilteredOnMachineSummarySql(process)
      : null;
    res.json({
      items,
      hasMore,
      nextCursor,
      summary,
      summaryPending: separateSummary ? true : undefined,
    });
  } catch (err) {
    console.error('v2 on-machine error', err);
    res.status(err?.status || 500).json({ error: err.message || 'Failed to load on-machine' });
  }
});

router.get('/on-machine/:process/summary', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const filters = sheetFiltersArrayFromQuery(req.query.filters);
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = req.query.search;
  const order = normalizeOrder(req.query.order);
  try {
    if (!['cutter', 'holo', 'coning'].includes(process)) {
      return res.status(400).json({ error: 'Invalid process' });
    }
    const isUnfiltered = filters.length === 0 && !normalizeText(search) && !dateFrom && !dateTo;
    let summary;
    if (isUnfiltered) {
      summary = await buildUnfilteredOnMachineSummarySql(process);
    } else {
      const whereAllFiltered = await buildOnMachineWhere({ process, filters, dateFrom, dateTo, search });
      const rowsRaw = await issueModelForProcess(process).findMany({
        where: whereAllFiltered,
        include: onMachineIncludesForProcess(process),
        orderBy: [{ createdAt: order }, { id: order }],
      });
      const { computedFilters } = splitComputedFilters(filters, ON_MACHINE_COMPUTED_FIELDS[process] || new Set());
      const traceFilters = process === 'coning' ? coningTraceFilters(filters) : [];
      const items = (await buildOnMachineItems(process, rowsRaw))
        .filter((item) => matchesConingTraceFilters(item, traceFilters))
        .filter((item) => matchesComputedFilters(item, computedFilters));
      summary = summarizeOnMachineItems(items);
    }
    return res.json({ summary, computedAt: new Date().toISOString() });
  } catch (err) {
    console.error('v2 on-machine summary error', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate on-machine summary' });
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
    const traceFilters = process === 'coning' ? coningTraceFilters(filters) : [];
    const items = (await buildOnMachineItems(process, rowsRaw))
      .filter((it) => matchesConingTraceFilters(it, traceFilters))
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
    const supportsYarn = process !== 'cutter';
    const supportsConeType = process === 'coning';
    const [machines, operators, items, cuts, yarns, twists, coneTypes] = await Promise.all([
      prisma.machine.findMany({
        where: { processType: { in: ['all', process] } },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.operator.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.cut.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      supportsYarn ? prisma.yarn.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      supportsYarn ? prisma.twist.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
      supportsConeType ? prisma.coneType.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
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

// Action dialogs must load only the selected record. Keeping this contract
// separate from the paged tables prevents edit, label and take-back actions
// from depending on the legacy full process snapshot.
async function resolveHoloTraceForV2(issue) {
  return {
    cutName: issue?.cut?.name || '',
    yarnName: issue?.yarn?.name || '',
    twistName: issue?.twist?.name || '',
    rollTypeName: '',
  };
}

async function resolveConingTraceForV2(issue) {
  const traced = issue?.id ? (await loadConingTraceMap([issue.id])).get(issue.id) : null;
  const refs = normalizeReceivedRowRefs(issue?.receivedRowRefs);
  const rowIds = Array.from(new Set(refs.map((ref) => ref?.rowId).filter(Boolean)));
  const sourceRows = rowIds.length > 0
    ? await prisma.receiveFromHoloMachineRow.findMany({
      where: { id: { in: rowIds }, isDeleted: false },
      include: {
        rollType: { select: { name: true } },
        issue: {
          include: {
            cut: { select: { name: true } },
            yarn: { select: { name: true } },
            twist: { select: { name: true } },
          },
        },
      },
    })
    : [];
  const summarize = (values) => {
    const unique = Array.from(new Set(values.filter(Boolean)));
    if (unique.length === 0) return '';
    return unique.length === 1 ? unique[0] : unique.join(', ');
  };
  return {
    cutName: traced?.cutName || summarize(sourceRows.map((row) => row.issue?.cut?.name || issue?.cut?.name)),
    yarnName: traced?.yarnName || summarize(sourceRows.map((row) => row.issue?.yarn?.name || issue?.yarn?.name)),
    twistName: traced?.twistName || summarize(sourceRows.map((row) => row.issue?.twist?.name || issue?.twist?.name)),
    rollTypeName: summarize(sourceRows.map((row) => row.rollType?.name)),
  };
}

router.get('/receive/cutter/challans', requireAuth, requirePermission('receive.cutter', PERM_READ), async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const page = parsePageParam(req.query.page) || 1;
    const search = String(req.query.search || '').trim();
    const order = normalizeOrder(req.query.order);
    const [matchingItems, matchingOperators, matchingHelpers, matchingCuts] = search
      ? await Promise.all([
        prisma.item.findMany({ where: { name: { contains: search, mode: 'insensitive' } }, select: { id: true } }),
        prisma.operator.findMany({ where: { name: { contains: search, mode: 'insensitive' } }, select: { id: true } }),
        prisma.operator.findMany({ where: { name: { contains: search, mode: 'insensitive' } }, select: { id: true } }),
        prisma.cut.findMany({ where: { name: { contains: search, mode: 'insensitive' } }, select: { id: true } }),
      ])
      : [[], [], [], []];
    const where = {
      isDeleted: false,
      ...(search ? {
        OR: [
          { challanNo: { contains: search, mode: 'insensitive' } },
          { lotNo: { contains: search, mode: 'insensitive' } },
          { wastageNote: { contains: search, mode: 'insensitive' } },
          { date: { contains: search, mode: 'insensitive' } },
          ...(matchingItems.length ? [{ itemId: { in: matchingItems.map((row) => row.id) } }] : []),
          ...(matchingOperators.length ? [{ operatorId: { in: matchingOperators.map((row) => row.id) } }] : []),
          ...(matchingHelpers.length ? [{ helperId: { in: matchingHelpers.map((row) => row.id) } }] : []),
          ...(matchingCuts.length ? [{ cutId: { in: matchingCuts.map((row) => row.id) } }] : []),
        ],
      } : {}),
    };
    const [rawItems, totalCount] = await Promise.all([
      prisma.receiveFromCutterMachineChallan.findMany({
        where,
        orderBy: [{ createdAt: order }, { id: order }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.receiveFromCutterMachineChallan.count({ where }),
    ]);
    const itemIds = Array.from(new Set(rawItems.map((row) => row.itemId).filter(Boolean)));
    const operatorIds = Array.from(new Set(rawItems.flatMap((row) => [row.operatorId, row.helperId]).filter(Boolean)));
    const cutIds = Array.from(new Set(rawItems.map((row) => row.cutId).filter(Boolean)));
    const lotNos = Array.from(new Set(rawItems.map((row) => row.lotNo).filter(Boolean)));
    const [itemsMaster, operators, cuts, lots] = await Promise.all([
      itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }) : [],
      operatorIds.length ? prisma.operator.findMany({ where: { id: { in: operatorIds } }, select: { id: true, name: true } }) : [],
      cutIds.length ? prisma.cut.findMany({ where: { id: { in: cutIds } }, select: { id: true, name: true } }) : [],
      lotNos.length ? prisma.lot.findMany({
        where: { lotNo: { in: lotNos } },
        select: { lotNo: true, firm: { select: { id: true, name: true, address: true, mobile: true } } },
      }) : [],
    ]);
    const itemById = new Map(itemsMaster.map((row) => [row.id, row]));
    const operatorById = new Map(operators.map((row) => [row.id, row]));
    const cutById = new Map(cuts.map((row) => [row.id, row]));
    const lotByNo = new Map(lots.map((row) => [row.lotNo, row]));
    const items = rawItems.map((row) => ({
      ...row,
      itemName: itemById.get(row.itemId)?.name || '',
      operatorName: operatorById.get(row.operatorId)?.name || '',
      helperName: operatorById.get(row.helperId)?.name || '',
      cutName: cutById.get(row.cutId)?.name || '',
      consignee: lotByNo.get(row.lotNo)?.firm || null,
    }));
    return res.json({
      items,
      hasMore: page * limit < totalCount,
      nextCursor: null,
      summary: { totalCount },
    });
  } catch (err) {
    console.error('v2 cutter challan history error', err);
    return res.status(500).json({ error: err.message || 'Failed to load Cutter challans' });
  }
});

router.get('/receive/cutter/csv-dashboard', requireAuth, requirePermission('receive.cutter', PERM_READ), async (req, res) => {
  try {
    const [uploads, rowsRaw, totals] = await Promise.all([
      prisma.receiveFromCutterMachineUpload.findMany({
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
        take: 25,
      }),
      prisma.receiveFromCutterMachineRow.findMany({
        where: { isDeleted: false },
        include: { bobbin: true, cutMaster: true, operator: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      prisma.receiveFromCutterMachinePieceTotal.aggregate({
        _count: { _all: true },
        _sum: { totalNetWeight: true },
      }),
    ]);
    const rows = await mapReceiveRowsWithExtras('cutter', rowsRaw);
    return res.json({
      uploads,
      rows,
      summary: {
        piecesWithReceipts: Number(totals?._count?._all || 0),
        totalReceivedWeight: Number(totals?._sum?.totalNetWeight || 0),
      },
    });
  } catch (err) {
    console.error('v2 Cutter CSV dashboard error', err);
    return res.status(500).json({ error: err.message || 'Failed to load Cutter CSV status' });
  }
});

router.get('/issue/:process/:id/action-detail', requireAuth, requireStageReadPermission(issueStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing issue id' });

  try {
    const model = issueModelForProcess(process);
    const issue = await model.findFirst({
      where: { id, isDeleted: false },
      include: {
        ...issueIncludesForProcess(process),
        ...(process === 'cutter' ? { lines: true } : {}),
      },
    });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const [item, takeBacks, receiveRowsRaw, receiveRowCount, receivedBySourceRows, takeBackTotalsByIssueId] = await Promise.all([
      issue.itemId
        ? prisma.item.findUnique({ where: { id: issue.itemId }, select: { id: true, name: true } })
        : Promise.resolve(null),
      prisma.issueTakeBack.findMany({
        where: { stage: process, issueId: id },
        include: { lines: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      receiveModelForProcess(process).findMany({
        where: { issueId: id, isDeleted: false },
        include: receiveIncludesForProcess(process),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      receiveModelForProcess(process).count({ where: { issueId: id, isDeleted: false } }),
      process === 'cutter'
        ? prisma.$queryRaw`
          WITH issue_candidates AS (
            SELECT line."issueId" AS issue_id, line."pieceId" AS piece_id, issue."createdAt" AS created_at
            FROM "IssueToCutterMachineLine" line
            JOIN "IssueToCutterMachine" issue ON issue.id = line."issueId"
            WHERE issue."isDeleted" = false
            UNION
            SELECT issue.id AS issue_id, trim(header_piece.piece_id) AS piece_id, issue."createdAt" AS created_at
            FROM "IssueToCutterMachine" issue
            CROSS JOIN LATERAL regexp_split_to_table(COALESCE(issue."pieceIds", ''), '\\s*,\\s*')
              AS header_piece(piece_id)
            WHERE issue."isDeleted" = false AND trim(header_piece.piece_id) <> ''
          ), receive_allocations AS (
            SELECT r."issueId" AS issue_id, r."pieceId" AS piece_id,
                   COALESCE(r."bobbin_quantity", 0)::numeric AS received_count,
                   COALESCE(r."netWt", 0)::numeric AS received_weight
            FROM "ReceiveFromCutterMachineRow" r
            WHERE r."isDeleted" = false AND r."issueId" = ${id}
            UNION ALL
            SELECT assigned.issue_id, r."pieceId" AS piece_id,
                   COALESCE(r."bobbin_quantity", 0)::numeric AS received_count,
                   COALESCE(r."netWt", 0)::numeric AS received_weight
            FROM "ReceiveFromCutterMachineRow" r
            JOIN LATERAL (
              SELECT candidate.issue_id
              FROM issue_candidates candidate
              WHERE candidate.piece_id = r."pieceId" AND candidate.created_at <= r."createdAt"
              ORDER BY candidate.created_at DESC, candidate.issue_id DESC
              LIMIT 1
            ) assigned ON true
            WHERE r."isDeleted" = false AND r."issueId" IS NULL
          )
          SELECT piece_id,
                 COALESCE(SUM(received_count), 0)::float8 AS received_count,
                 COALESCE(SUM(received_weight), 0)::float8 AS received_weight
          FROM receive_allocations
          WHERE issue_id = ${id}
          GROUP BY piece_id
        `
        : Promise.resolve([]),
      fetchTakeBackTotalsByIssueIds(process, [id]),
    ]);

    const receiveRows = await mapReceiveRowsWithExtras(process, receiveRowsRaw);
    const mappedIssue = mapIssueRow(process, {
      ...issue,
      itemName: item?.name || '',
    }, { takeBackTotalsByIssueId });
    const issueBalance = (await computeIssueBalancesBatch(prisma, process, [issue])).get(id) || null;
    let sourceLines = process === 'cutter'
      ? (issue.lines || [])
      : normalizeReceivedRowRefs(issue.receivedRowRefs);
    const sourceRowIds = Array.from(new Set(sourceLines.map((line) => line?.rowId).filter(Boolean)));
    let sourceRows = [];
    let sourcePieces = [];
    if (process === 'cutter') {
      const pieceIds = Array.from(new Set(String(issue.pieceIds || '').split(',').map((id) => id.trim()).filter(Boolean)));
      sourcePieces = pieceIds.length > 0
        ? await prisma.inboundItem.findMany({ where: { id: { in: pieceIds } } })
        : [];
      if (sourceLines.length === 0) {
        const pieceById = new Map(sourcePieces.map((piece) => [piece.id, piece]));
        sourceLines = pieceIds.map((pieceId) => ({
          issueId: issue.id,
          pieceId,
          issuedWeight: Number(pieceById.get(pieceId)?.weight || 0),
          legacyHeaderSource: true,
        }));
      }
    } else if (process === 'holo' && sourceRowIds.length > 0) {
      sourceRows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { id: { in: sourceRowIds }, isDeleted: false },
        include: { bobbin: true, box: true, cutMaster: true, issue: true },
      });
      const pieceIds = Array.from(new Set(sourceRows.map((row) => row.pieceId).filter(Boolean)));
      sourcePieces = pieceIds.length > 0
        ? await prisma.inboundItem.findMany({ where: { id: { in: pieceIds } } })
        : [];
    } else if (process === 'coning' && sourceRowIds.length > 0) {
      const [holoRows, coningRows] = await Promise.all([
        prisma.receiveFromHoloMachineRow.findMany({
          where: { id: { in: sourceRowIds }, isDeleted: false },
          include: { rollType: true, box: true, issue: { include: { cut: true, yarn: true, twist: true } } },
        }),
        prisma.receiveFromConingMachineRow.findMany({
          where: { id: { in: sourceRowIds }, isDeleted: false },
          include: { box: true, issue: { include: { cut: true, yarn: true, twist: true } } },
        }),
      ]);
      const coningSourceConeTypeIds = new Map();
      coningRows.forEach((row) => {
        const ref = normalizeReceivedRowRefs(row.issue?.receivedRowRefs)
          .find((entry) => typeof entry?.coneTypeId === 'string' && entry.coneTypeId.trim());
        coningSourceConeTypeIds.set(row.id, ref?.coneTypeId || null);
      });
      const coneTypeIds = Array.from(new Set(Array.from(coningSourceConeTypeIds.values()).filter(Boolean)));
      const coneTypes = coneTypeIds.length > 0
        ? await prisma.coneType.findMany({ where: { id: { in: coneTypeIds } } })
        : [];
      const coneTypeById = new Map(coneTypes.map((coneType) => [coneType.id, coneType]));
      sourceRows = [
        ...holoRows,
        ...coningRows.map((row) => {
          const coneTypeId = coningSourceConeTypeIds.get(row.id) || null;
          return { ...row, coneTypeId, coneType: coneTypeId ? (coneTypeById.get(coneTypeId) || null) : null };
        }),
      ];
    }

    return res.json({
      issue: { ...mappedIssue, ...(issueBalance || {}) },
      issueBalance,
      sourceLines,
      sourceRows,
      sourcePieces,
      receiveRows,
      takeBacks,
      activeTakeBacks: takeBacks.filter((takeBack) => !takeBack.isReverse && !takeBack.isReversed),
      receivedBySource: Object.fromEntries((receivedBySourceRows || []).map((row) => [row.piece_id, {
        count: Number(row.received_count || 0),
        weight: Number(row.received_weight || 0),
      }])),
      meta: {
        process,
        receiveRowCount,
        receiveRowsTruncated: receiveRowCount > receiveRows.length,
      },
    });
  } catch (err) {
    console.error('v2 issue action detail error', err);
    return res.status(500).json({ error: err.message || 'Failed to load issue details' });
  }
});

router.get('/receive/:process/:id/action-detail', requireAuth, requireStageReadPermission(receiveStagePermissionKey), async (req, res) => {
  const process = String(req.params.process || '').trim().toLowerCase();
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing receive row id' });

  try {
    const row = await receiveModelForProcess(process).findFirst({
      where: { id, isDeleted: false },
      include: {
        ...receiveIncludesForProcess(process),
        ...(process === 'cutter' ? { issue: { include: { machine: true } } } : {}),
      },
    });
    if (!row) return res.status(404).json({ error: 'Receive row not found' });

    const [mappedRow] = await mapReceiveRowsWithExtras(process, [row]);
    let pieceOptions = [];
    if (process === 'holo' && row.issue) {
      pieceOptions = await computeHoloIssuePieceIdsByIssueId([row.issueId]).then((map) => map.get(row.issueId) || []);
    } else if (process === 'coning' && row.issue) {
      pieceOptions = await computeConingIssuePieceIdsByIssueId([row.issueId]).then((map) => map.get(row.issueId) || []);
    } else if (process === 'cutter' && row.pieceId) {
      pieceOptions = [row.pieceId];
    }

    const piece = process === 'cutter' && row.pieceId
      ? await prisma.inboundItem.findUnique({ where: { id: row.pieceId } })
      : null;
    const itemId = process === 'cutter' ? piece?.itemId : row.issue?.itemId;
    const item = itemId
      ? await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, name: true } })
      : null;

    let trace = {};
    if (process === 'holo' && row.issue) {
      trace = await resolveHoloTraceForV2(row.issue);
    } else if (process === 'coning' && row.issue) {
      trace = await resolveConingTraceForV2(row.issue);
    }

    return res.json({
      row: {
        ...mappedRow,
        cutName: mappedRow?.cutName || trace.cutName || '',
        yarnName: mappedRow?.yarnName || trace.yarnName || '',
        twistName: mappedRow?.twistName || trace.twistName || '',
        rollTypeName: mappedRow?.rollTypeName || trace.rollTypeName || '',
      },
      issue: row.issue ? { ...row.issue, itemName: item?.name || '' } : null,
      piece: piece ? { ...piece, itemName: item?.name || '' } : null,
      pieceOptions,
      trace,
      meta: { process },
    });
  } catch (err) {
    console.error('v2 receive action detail error', err);
    return res.status(500).json({ error: err.message || 'Failed to load receive details' });
  }
});

// -----------------------------
// Stock v2 (fast-load, UI-parity)
// -----------------------------

async function buildCutterJumboStockGroups() {
  const [lots, pieces, totals, issues, challans, receiveRows, yarns] = await Promise.all([
    prisma.lot.findMany({
      include: { item: true, firm: true, supplier: true },
      orderBy: [{ lotNo: 'asc' }],
    }),
    prisma.inboundItem.findMany({ orderBy: [{ lotNo: 'asc' }, { seq: 'asc' }, { id: 'asc' }] }),
    prisma.receiveFromCutterMachinePieceTotal.findMany(),
    prisma.issueToCutterMachine.findMany({
      where: { isDeleted: false },
      select: { pieceIds: true, date: true, createdAt: true, machine: { select: { name: true } }, cut: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.receiveFromCutterMachineChallan.findMany({
      where: { isDeleted: false, wastageNetWeight: { gt: 0 } },
      select: { pieceId: true, wastageNote: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.receiveFromCutterMachineRow.findMany({
      where: { isDeleted: false, yarnName: { not: null } },
      select: { pieceId: true, yarnName: true },
    }),
    prisma.yarn.findMany({ select: { id: true, name: true } }),
  ]);

  const totalsByPiece = new Map(totals.map((row) => [row.pieceId, row]));
  const issueByPiece = new Map();
  for (const issue of issues) {
    const pieceIds = Array.isArray(issue.pieceIds)
      ? issue.pieceIds
      : String(issue.pieceIds || '').split(',').map((value) => value.trim()).filter(Boolean);
    for (const pieceId of pieceIds) {
      if (!issueByPiece.has(pieceId)) issueByPiece.set(pieceId, issue);
    }
  }
  const wastageNoteByPiece = new Map();
  for (const row of challans) {
    if (!row.pieceId || wastageNoteByPiece.has(row.pieceId)) continue;
    const note = String(row.wastageNote || '').split('—').slice(1).join('—').trim();
    if (note) wastageNoteByPiece.set(row.pieceId, note);
  }
  const yarnNamesByPiece = new Map();
  for (const row of receiveRows) {
    if (!row.pieceId || !row.yarnName) continue;
    const values = yarnNamesByPiece.get(row.pieceId) || new Set();
    values.add(row.yarnName);
    yarnNamesByPiece.set(row.pieceId, values);
  }
  const yarnIdByName = new Map(yarns.map((yarn) => [String(yarn.name || '').trim().toLowerCase(), yarn.id]));

  const lotByNo = new Map(lots.map((lot) => [lot.lotNo, lot]));
  const groups = new Map(lots.map((lot) => [lot.lotNo, {
    lotKey: encodeStockLotKey({ v: 1, process: 'cutter', view: 'jumbo', lotNo: lot.lotNo }),
    lotNo: lot.lotNo,
    date: lot.date || '',
    itemId: lot.itemId || '',
    itemName: lot.item?.name || '—',
    firmId: lot.firmId || '',
    firmName: lot.firm?.name || '—',
    supplierId: lot.supplierId || '',
    supplierName: lot.supplier?.name || '—',
    totalPieces: Number(lot.totalPieces || 0),
    totalWeight: Number(lot.totalWeight || 0),
    availableCount: 0,
    remainingWeight: 0,
    pendingWeight: 0,
    wastageTotal: 0,
    wastageCount: 0,
    wastageWeightBaseTotal: 0,
    issuedWeightBaseTotal: 0,
    cutNames: new Set(),
    cutIds: new Set(),
    yarnNames: new Set(),
    yarnIds: new Set(),
    barcodes: [],
    pieces: [],
  }]));

  for (const piece of pieces) {
    const group = groups.get(piece.lotNo);
    if (!group) continue;
    const inboundWeight = Number(piece.weight || 0);
    const dispatchedWeight = Number(piece.dispatchedWeight || 0);
    const issuedWeight = Number(piece.issuedToCutterWeight || 0);
    const aggregate = totalsByPiece.get(piece.id);
    const receivedWeight = Number(aggregate?.totalNetWeight || 0);
    const wastageWeight = Number(aggregate?.wastageNetWeight || 0);
    const pendingWeight = Math.max(0, inboundWeight - receivedWeight - wastageWeight - dispatchedWeight);
    const issueableWeight = Math.max(0, inboundWeight - dispatchedWeight - issuedWeight);
    const available = issueableWeight > 1e-9
      && dispatchedWeight <= 1e-9
      && String(piece.status || '').toLowerCase() !== 'consumed';
    const issue = issueByPiece.get(piece.id);
    const cutName = issue?.cut?.name || '';
    if (cutName) group.cutNames.add(cutName);
    if (issue?.cut?.id) group.cutIds.add(issue.cut.id);
    for (const yarnName of yarnNamesByPiece.get(piece.id) || []) {
      group.yarnNames.add(yarnName);
      const yarnId = yarnIdByName.get(String(yarnName).trim().toLowerCase());
      if (yarnId) group.yarnIds.add(yarnId);
    }
    if (piece.barcode) group.barcodes.push(piece.barcode);
    group.availableCount += available ? 1 : 0;
    if (String(piece.status || '').toLowerCase() !== 'consumed') group.remainingWeight += inboundWeight;
    group.pendingWeight += pendingWeight;
    group.wastageTotal += wastageWeight;
    if (wastageWeight > 0) {
      group.wastageCount += 1;
      group.wastageWeightBaseTotal += inboundWeight;
    }
    group.issuedWeightBaseTotal += issuedWeight;
    group.pieces.push({
      ...piece,
      pendingWeight,
      receivedWeight,
      wastageWeight,
      wastageNote: wastageNoteByPiece.get(piece.id) || null,
      totalUnits: Number(aggregate?.totalBob || 0),
      issueableWeight,
      cutName,
      yarnName: Array.from(yarnNamesByPiece.get(piece.id) || []).join(', '),
      issuedLabel: issue ? `Issued${issue.machine?.name ? `: ${issue.machine.name}` : ''}${issue.date ? ` • ${issue.date}` : ''}` : '',
    });
  }

  return Array.from(groups.values())
    .filter((group) => !String(group.lotNo || '').toUpperCase().startsWith('CP-'))
    .map((group) => ({
      ...group,
      cutNames: Array.from(group.cutNames),
      cutIds: Array.from(group.cutIds),
      yarnNames: Array.from(group.yarnNames),
      yarnIds: Array.from(group.yarnIds),
      cutName: Array.from(group.cutNames).join(', ') || '—',
      yarnName: Array.from(group.yarnNames).join(', ') || '—',
      barcodeStr: group.barcodes.join(' '),
      avgWastage: group.wastageCount > 0 ? group.wastageTotal / group.wastageCount : 0,
      wastagePercent: group.issuedWeightBaseTotal > 0 ? (group.wastageTotal / group.issuedWeightBaseTotal) * 100 : 0,
      statusType: group.pendingWeight > 1e-9 ? 'active' : 'inactive',
      pieces: [],
    }));
}

async function buildCutterBobbinStockGroups() {
  const [rows, pieces, lots, yarns] = await Promise.all([
    prisma.receiveFromCutterMachineRow.findMany({
      where: { isDeleted: false },
      include: { bobbin: true, box: true, cutMaster: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.inboundItem.findMany({ select: { id: true, lotNo: true, itemId: true } }),
    prisma.lot.findMany({ include: { item: true, firm: true, supplier: true } }),
    prisma.yarn.findMany({ select: { id: true, name: true } }),
  ]);
  const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
  const lotByNo = new Map(lots.map((lot) => [lot.lotNo, lot]));
  const groups = new Map();
  const yarnIdByName = new Map(yarns.map((yarn) => [String(yarn.name || '').trim().toLowerCase(), yarn.id]));
  for (const row of rows) {
    const piece = pieceById.get(row.pieceId);
    const lotNo = piece?.lotNo || '(No Lot)';
    const lot = lotByNo.get(lotNo);
    const totalBobbins = Number(row.bobbinQuantity || 0);
    const issuedBobbins = Number(row.issuedBobbins || 0);
    const dispatchedBobbins = Number(row.dispatchedCount || 0);
    const totalWeight = Number(row.netWt ?? row.totalKg ?? row.yarnWt ?? 0);
    const issuedWeight = Number(row.issuedBobbinWeight || 0);
    const availableWeight = Math.max(0, totalWeight - issuedWeight - Number(row.dispatchedWeight || 0));
    const availableBobbins = calcAvailableCountFromWeight({
      totalCount: totalBobbins,
      issuedCount: issuedBobbins,
      dispatchedCount: dispatchedBobbins,
      totalWeight,
      availableWeight,
    });
    const group = groups.get(lotNo) || {
      lotKey: encodeStockLotKey({ v: 1, process: 'cutter', view: 'bobbins', lotNo }),
      lotNo,
      date: row.date || row.createdAt || '',
      itemId: piece?.itemId || lot?.itemId || '',
      itemName: lot?.item?.name || '—',
      firmId: lot?.firmId || '',
      firmName: lot?.firm?.name || '—',
      supplierId: lot?.supplierId || '',
      supplierName: lot?.supplier?.name || '—',
      totalBobbins: 0,
      issuedBobbins: 0,
      availableBobbins: 0,
      totalWeight: 0,
      issuedWeight: 0,
      availableWeight: 0,
      crateCount: 0,
      cutNames: new Set(),
      cutIds: new Set(),
      yarnNames: new Set(),
      yarnIds: new Set(),
      barcodes: [],
      notes: [],
    };
    const cutName = row.cutMaster?.name || (typeof row.cut === 'string' ? row.cut : '') || '—';
    const yarnName = row.yarnName || '—';
    if (cutName !== '—') group.cutNames.add(cutName);
    if (row.cutId) group.cutIds.add(row.cutId);
    if (yarnName !== '—') group.yarnNames.add(yarnName);
    const yarnId = yarnIdByName.get(String(yarnName).trim().toLowerCase());
    if (yarnId) group.yarnIds.add(yarnId);
    if (row.barcode) group.barcodes.push(row.barcode);
    if (row.notes) group.notes.push(row.notes);
    group.totalBobbins += totalBobbins;
    group.issuedBobbins += issuedBobbins;
    group.availableBobbins += availableBobbins;
    group.totalWeight += totalWeight;
    group.issuedWeight += issuedWeight;
    group.availableWeight += availableWeight;
    group.crateCount += 1;
    groups.set(lotNo, group);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    cutNames: Array.from(group.cutNames),
    cutIds: Array.from(group.cutIds),
    yarnNames: Array.from(group.yarnNames),
    yarnIds: Array.from(group.yarnIds),
    cutName: group.cutNames.size > 1 ? 'Mixed' : (Array.from(group.cutNames)[0] || '—'),
    yarnName: group.yarnNames.size > 1 ? 'Mixed' : (Array.from(group.yarnNames)[0] || '—'),
    barcodeStr: group.barcodes.join(' '),
    notesStr: group.notes.join(' '),
    statusType: group.availableBobbins > 0 ? 'active' : 'inactive',
    crates: [],
  }));
}

function cutterStockSearchSql(req, view) {
  const search = String(req.query.search || '').trim().toLowerCase();
  if (!search) return Prisma.empty;
  const haystack = view === 'bobbins'
    ? Prisma.sql`LOWER(CONCAT_WS(' ', lot_no, item_name, cut_name, yarn_name, firm_name, supplier_name, barcode_str, notes_str))`
    : Prisma.sql`LOWER(CONCAT_WS(' ', lot_no, item_name, cut_name, yarn_name, firm_name, supplier_name, barcode_str))`;
  const alternatives = search.split('|').map((value) => value.trim()).filter(Boolean);
  const groups = (alternatives.length > 1 ? alternatives : [search]).map((alternative) => {
    const terms = alternative.split(/\s+/).filter(Boolean);
    return Prisma.sql`(${Prisma.join(terms.map((term) => Prisma.sql`${haystack} LIKE ${`%${term}%`}`), ' AND ')})`;
  });
  return Prisma.sql`(${Prisma.join(groups, ' OR ')})`;
}

function cutterStockFilterSql(req, view) {
  const clauses = [];
  if (req.query.item) clauses.push(Prisma.sql`item_id = ${String(req.query.item)}`);
  if (req.query.cut) clauses.push(Prisma.sql`${String(req.query.cut)} = ANY(COALESCE(cut_ids, ARRAY[]::text[]))`);
  if (req.query.yarn) clauses.push(Prisma.sql`${String(req.query.yarn)} = ANY(COALESCE(yarn_ids, ARRAY[]::text[]))`);
  if (req.query.firm) clauses.push(Prisma.sql`firm_id = ${String(req.query.firm)}`);
  if (req.query.supplier) clauses.push(Prisma.sql`supplier_id = ${String(req.query.supplier)}`);
  if (req.query.from) clauses.push(Prisma.sql`date >= ${String(req.query.from)}`);
  if (req.query.to) clauses.push(Prisma.sql`date <= ${String(req.query.to)}`);
  const status = String(req.query.status || 'all');
  if (status === 'available_to_issue') {
    clauses.push(view === 'bobbins' ? Prisma.sql`available_bobbins > 0` : Prisma.sql`available_count > 0`);
  } else if (status === 'active') {
    clauses.push(Prisma.sql`status_type = 'active'`);
  } else if (status === 'inactive') {
    clauses.push(Prisma.sql`status_type = 'inactive'`);
  }
  const searchClause = cutterStockSearchSql(req, view);
  if (searchClause !== Prisma.empty) clauses.push(searchClause);
  return clauses.length > 0 ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
}

function decodeCutterStockCursor(raw) {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8'));
    return typeof parsed?.afterSortKey === 'string' ? parsed.afterSortKey : '';
  } catch {
    const error = new Error('Invalid stock cursor');
    error.status = 400;
    throw error;
  }
}

function stageStockFilterSql(req, process) {
  const clauses = [];
  if (req.query.item) clauses.push(Prisma.sql`item_id = ${String(req.query.item)}`);
  if (req.query.cut) clauses.push(Prisma.sql`${String(req.query.cut)} = ANY(COALESCE(cut_ids, ARRAY[]::text[]))`);
  if (req.query.yarn) clauses.push(Prisma.sql`${String(req.query.yarn)} = ANY(COALESCE(yarn_ids, ARRAY[]::text[]))`);
  if (req.query.firm) clauses.push(Prisma.sql`firm_id = ${String(req.query.firm)}`);
  if (req.query.supplier) clauses.push(Prisma.sql`supplier_id = ${String(req.query.supplier)}`);
  if (req.query.from) clauses.push(Prisma.sql`max_date >= ${String(req.query.from)}`);
  if (req.query.to) clauses.push(Prisma.sql`max_date <= ${String(req.query.to)}`);
  const status = String(req.query.status || 'all');
  if (status === 'active' || status === 'available_to_issue') clauses.push(Prisma.sql`total_weight > 0.000000001`);
  if (status === 'inactive') clauses.push(Prisma.sql`total_weight <= 0.000000001`);
  if (process === 'holo') {
    const steamed = String(req.query.steamed || 'all');
    if (steamed === 'not_steamed') clauses.push(Prisma.sql`steamed_rolls = 0`);
    if (steamed === 'steamed') clauses.push(Prisma.sql`steamed_rolls >= total_rolls AND total_rolls > 0`);
    if (steamed === 'partial') clauses.push(Prisma.sql`steamed_rolls > 0 AND steamed_rolls < total_rolls`);
  }
  const search = String(req.query.search || '').trim().toLowerCase();
  if (search) {
    const haystack = Prisma.sql`LOWER(CONCAT_WS(' ', lot_label, item_name, cut_name, yarn_name, twist_name, firm_name, supplier_name, barcode_str, notes_str))`;
    const alternatives = search.split('|').map((value) => value.trim()).filter(Boolean);
    const groups = (alternatives.length > 1 ? alternatives : [search]).map((alternative) => {
      const terms = alternative.split(/\s+/).filter(Boolean);
      return Prisma.sql`(${Prisma.join(terms.map((term) => Prisma.sql`${haystack} LIKE ${`%${term}%`}`), ' AND ')})`;
    });
    clauses.push(Prisma.sql`(${Prisma.join(groups, ' OR ')})`);
  }
  return clauses.length > 0 ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
}

function stageStockSummaryFromRow(row, process) {
  return {
    process,
    groupCount: Number(row?.summary_group_count || 0),
    totalWeight: Number(row?.summary_total_weight || 0),
    totalRolls: Number(row?.summary_total_rolls || 0),
    totalCones: Number(row?.summary_total_cones || 0),
    steamedRolls: Number(row?.summary_steamed_rolls || 0),
  };
}

function mapCutterStockQueryRow(row, view, groupBy, includeMembers = false) {
  const base = {
    lotKey: groupBy ? null : encodeStockLotKey({ v: 1, process: 'cutter', view, lotNo: row.lot_no }),
    expandable: !groupBy,
    lotNo: groupBy ? '' : (row.lot_no || ''),
    groupKey: groupBy ? row.group_key : null,
    lots: Array.isArray(row.lot_nos) ? row.lot_nos : [],
    memberLotKeys: groupBy && includeMembers
      ? (Array.isArray(row.lot_nos) ? row.lot_nos : []).map((lotNo) => encodeStockLotKey({ v: 1, process: 'cutter', view, lotNo }))
      : [],
    date: row.date || '',
    itemId: row.item_id || '',
    itemName: row.item_name || '—',
    firmId: row.firm_id || '',
    firmName: row.firm_name || '—',
    supplierId: row.supplier_id || '',
    supplierName: row.supplier_name || '—',
    cutNames: Array.isArray(row.cut_names) ? row.cut_names : [],
    cutIds: Array.isArray(row.cut_ids) ? row.cut_ids : [],
    yarnNames: Array.isArray(row.yarn_names) ? row.yarn_names : [],
    yarnIds: Array.isArray(row.yarn_ids) ? row.yarn_ids : [],
    cutName: row.cut_name || '—',
    yarnName: row.yarn_name || '—',
    barcodeStr: row.barcode_str || '',
    statusType: row.status_type || 'inactive',
  };
  if (view === 'bobbins') {
    return {
      ...base,
      notesStr: row.notes_str || '',
      totalBobbins: Number(row.total_bobbins || 0),
      issuedBobbins: Number(row.issued_bobbins || 0),
      availableBobbins: Number(row.available_bobbins || 0),
      totalWeight: Number(row.total_weight || 0),
      issuedWeight: Number(row.issued_weight || 0),
      availableWeight: Number(row.available_weight || 0),
      crateCount: Number(row.crate_count || 0),
      crates: [],
    };
  }
  const wastageTotal = Number(row.wastage_total || 0);
  const wastageCount = Number(row.wastage_count || 0);
  const issuedWeightBaseTotal = Number(row.issued_weight_base_total || 0);
  return {
    ...base,
    totalPieces: Number(row.total_pieces || 0),
    totalWeight: Number(row.total_weight || 0),
    availableCount: Number(row.available_count || 0),
    remainingWeight: Number(row.remaining_weight || 0),
    pendingWeight: Number(row.pending_weight || 0),
    wastageTotal,
    wastageCount,
    wastageWeightBaseTotal: Number(row.wastage_weight_base_total || 0),
    issuedWeightBaseTotal,
    avgWastage: wastageCount > 0 ? wastageTotal / wastageCount : 0,
    wastagePercent: issuedWeightBaseTotal > 0 ? (wastageTotal / issuedWeightBaseTotal) * 100 : 0,
    pieces: [],
  };
}

function cutterStockSummaryFromRow(row, process = 'cutter') {
  if (!row) {
    return {
      process, groupCount: 0, totalWeight: 0, totalPieces: 0, availableCount: 0,
      remainingWeight: 0, pendingWeight: 0, wastageTotal: 0, wastageCount: 0,
      wastageWeightBaseTotal: 0, issuedWeightBaseTotal: 0, totalBobbins: 0,
      availableBobbins: 0, availableWeight: 0, crateCount: 0,
    };
  }
  return {
    process,
    groupCount: Number(row.summary_group_count || 0),
    totalWeight: Number(row.summary_total_weight || 0),
    totalPieces: Number(row.summary_total_pieces || 0),
    availableCount: Number(row.summary_available_count || 0),
    remainingWeight: Number(row.summary_remaining_weight || 0),
    pendingWeight: Number(row.summary_pending_weight || 0),
    wastageTotal: Number(row.summary_wastage_total || 0),
    wastageCount: Number(row.summary_wastage_count || 0),
    wastageWeightBaseTotal: Number(row.summary_wastage_weight_base_total || 0),
    issuedWeightBaseTotal: Number(row.summary_issued_weight_base_total || 0),
    totalBobbins: Number(row.summary_total_bobbins || 0),
    availableBobbins: Number(row.summary_available_bobbins || 0),
    availableWeight: Number(row.summary_available_weight || 0),
    crateCount: Number(row.summary_crate_count || 0),
  };
}

async function queryCutterJumboStockGroups(req) {
  const limit = clampLimit(req.query.limit);
  const afterSortKey = decodeCutterStockCursor(req.query.cursor);
  const groupBy = ['1', 'true', 'yes'].includes(String(req.query.groupBy || '').toLowerCase());
  const includeMembers = ['1', 'true', 'yes'].includes(String(req.query.includeMembers || '').toLowerCase());
  const filterSql = cutterStockFilterSql(req, 'jumbo');
  const separateSummary = String(req.query.summaryMode || '').toLowerCase() === 'separate';
  const summaryColumns = separateSummary ? Prisma.sql`
    NULL::int AS summary_group_count,
    NULL::float8 AS summary_total_weight,
    NULL::float8 AS summary_total_pieces,
    NULL::float8 AS summary_available_count,
    NULL::float8 AS summary_remaining_weight,
    NULL::float8 AS summary_pending_weight,
    NULL::float8 AS summary_wastage_total,
    NULL::float8 AS summary_wastage_count,
    NULL::float8 AS summary_wastage_weight_base_total,
    NULL::float8 AS summary_issued_weight_base_total,
    NULL::float8 AS summary_total_bobbins,
    NULL::float8 AS summary_available_bobbins,
    NULL::float8 AS summary_available_weight,
    NULL::float8 AS summary_crate_count
  ` : Prisma.sql`
    COUNT(*) OVER ()::int AS summary_group_count,
    SUM(total_weight) OVER ()::float8 AS summary_total_weight,
    SUM(total_pieces) OVER ()::float8 AS summary_total_pieces,
    SUM(available_count) OVER ()::float8 AS summary_available_count,
    SUM(remaining_weight) OVER ()::float8 AS summary_remaining_weight,
    SUM(pending_weight) OVER ()::float8 AS summary_pending_weight,
    SUM(wastage_total) OVER ()::float8 AS summary_wastage_total,
    SUM(wastage_count) OVER ()::float8 AS summary_wastage_count,
    SUM(wastage_weight_base_total) OVER ()::float8 AS summary_wastage_weight_base_total,
    SUM(issued_weight_base_total) OVER ()::float8 AS summary_issued_weight_base_total,
    0::float8 AS summary_total_bobbins,
    0::float8 AS summary_available_bobbins,
    0::float8 AS summary_available_weight,
    0::float8 AS summary_crate_count
  `;
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH issue_candidates AS (
      SELECT line."pieceId" AS piece_id, line."issueId" AS issue_id
      FROM "IssueToCutterMachineLine" line
      UNION
      SELECT trim(header_piece.piece_id) AS piece_id, issue.id AS issue_id
      FROM "IssueToCutterMachine" issue
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(issue."pieceIds", ''), '\\s*,\\s*')
        AS header_piece(piece_id)
      WHERE trim(header_piece.piece_id) <> ''
    ), latest_issue AS (
      SELECT DISTINCT ON (candidate.piece_id)
        candidate.piece_id,
        issue."cutId" AS cut_id,
        cut.name AS cut_name
      FROM issue_candidates candidate
      JOIN "IssueToCutterMachine" issue ON issue.id = candidate.issue_id AND issue."isDeleted" = false
      LEFT JOIN "Cut" cut ON cut.id = issue."cutId"
      ORDER BY candidate.piece_id, issue."createdAt" DESC, issue.id DESC
    ),
    yarn_by_lot AS (
      SELECT
        piece."lotNo" AS lot_no,
        array_remove(array_agg(DISTINCT row."yarnName" ORDER BY row."yarnName"), NULL) AS yarn_names,
        array_remove(array_agg(DISTINCT yarn.id ORDER BY yarn.id), NULL) AS yarn_ids
      FROM "ReceiveFromCutterMachineRow" row
      JOIN "InboundItem" piece ON piece.id = row."pieceId"
      LEFT JOIN "Yarn" yarn ON lower(trim(yarn.name)) = lower(trim(row."yarnName"))
      WHERE row."isDeleted" = false AND row."yarnName" IS NOT NULL
      GROUP BY piece."lotNo"
    ),
    piece_rollup AS (
      SELECT
        piece."lotNo" AS lot_no,
        COUNT(*) FILTER (
          WHERE GREATEST(0, piece.weight - piece."issuedToCutterWeight" - piece."dispatchedWeight") > 0.000000001
            AND piece."dispatchedWeight" <= 0.000000001
            AND lower(COALESCE(piece.status, '')) <> 'consumed'
        )::int AS available_count,
        SUM(CASE WHEN lower(COALESCE(piece.status, '')) <> 'consumed' THEN piece.weight ELSE 0 END)::float8 AS remaining_weight,
        SUM(GREATEST(0, piece.weight - COALESCE(total."totalNetWeight", 0) - COALESCE(total."wastageNetWeight", 0) - piece."dispatchedWeight"))::float8 AS pending_weight,
        SUM(COALESCE(total."wastageNetWeight", 0))::float8 AS wastage_total,
        COUNT(*) FILTER (WHERE COALESCE(total."wastageNetWeight", 0) > 0)::int AS wastage_count,
        SUM(CASE WHEN COALESCE(total."wastageNetWeight", 0) > 0 THEN piece.weight ELSE 0 END)::float8 AS wastage_weight_base_total,
        SUM(piece."issuedToCutterWeight")::float8 AS issued_weight_base_total,
        array_remove(array_agg(DISTINCT latest.cut_name ORDER BY latest.cut_name), NULL) AS cut_names,
        array_remove(array_agg(DISTINCT latest.cut_id ORDER BY latest.cut_id), NULL) AS cut_ids,
        string_agg(DISTINCT piece.barcode, ' ') AS barcode_str
      FROM "InboundItem" piece
      LEFT JOIN "ReceiveFromCutterMachinePieceTotal" total ON total."pieceId" = piece.id
      LEFT JOIN latest_issue latest ON latest.piece_id = piece.id
      GROUP BY piece."lotNo"
    ),
    base AS (
      SELECT
        lot."lotNo" AS lot_no,
        lot.date,
        lot."itemId" AS item_id,
        item.name AS item_name,
        lot."firmId" AS firm_id,
        COALESCE(firm.name, '—') AS firm_name,
        lot."supplierId" AS supplier_id,
        COALESCE(supplier.name, '—') AS supplier_name,
        lot."totalPieces"::int AS total_pieces,
        lot."totalWeight"::float8 AS total_weight,
        COALESCE(rollup.available_count, 0)::int AS available_count,
        COALESCE(rollup.remaining_weight, 0)::float8 AS remaining_weight,
        COALESCE(rollup.pending_weight, 0)::float8 AS pending_weight,
        COALESCE(rollup.wastage_total, 0)::float8 AS wastage_total,
        COALESCE(rollup.wastage_count, 0)::int AS wastage_count,
        COALESCE(rollup.wastage_weight_base_total, 0)::float8 AS wastage_weight_base_total,
        COALESCE(rollup.issued_weight_base_total, 0)::float8 AS issued_weight_base_total,
        COALESCE(rollup.cut_names, ARRAY[]::text[]) AS cut_names,
        COALESCE(rollup.cut_ids, ARRAY[]::text[]) AS cut_ids,
        COALESCE(yarns.yarn_names, ARRAY[]::text[]) AS yarn_names,
        COALESCE(yarns.yarn_ids, ARRAY[]::text[]) AS yarn_ids,
        COALESCE(array_to_string(rollup.cut_names, ', '), '—') AS cut_name,
        COALESCE(array_to_string(yarns.yarn_names, ', '), '—') AS yarn_name,
        COALESCE(rollup.barcode_str, '') AS barcode_str,
        CASE WHEN COALESCE(rollup.pending_weight, 0) > 0.000000001 THEN 'active' ELSE 'inactive' END AS status_type
      FROM "Lot" lot
      JOIN "Item" item ON item.id = lot."itemId"
      LEFT JOIN "Firm" firm ON firm.id = lot."firmId"
      LEFT JOIN "Supplier" supplier ON supplier.id = lot."supplierId"
      LEFT JOIN piece_rollup rollup ON rollup.lot_no = lot."lotNo"
      LEFT JOIN yarn_by_lot yarns ON yarns.lot_no = lot."lotNo"
      WHERE upper(lot."lotNo") NOT LIKE 'CP-%'
    ),
    filtered AS (
      SELECT * FROM base ${filterSql}
    ),
    selected AS (
      SELECT
        lot_no, NULL::text AS group_key, ARRAY[lot_no]::text[] AS lot_nos, date,
        item_id, item_name, firm_id, firm_name, supplier_id, supplier_name,
        total_pieces, total_weight, available_count, remaining_weight, pending_weight,
        wastage_total, wastage_count, wastage_weight_base_total, issued_weight_base_total,
        cut_names, cut_ids, yarn_names, yarn_ids, cut_name, yarn_name, barcode_str, status_type,
        lot_no AS sort_key
      FROM filtered WHERE ${groupBy} = false
      UNION ALL
      SELECT
        ''::text AS lot_no,
        CONCAT_WS('::', item_id, COALESCE(supplier_id, ''), cut_name, yarn_name, '') AS group_key,
        array_agg(lot_no ORDER BY lot_no) AS lot_nos,
        MAX(date) AS date,
        item_id, MAX(item_name), MIN(firm_id), MIN(firm_name), supplier_id, MAX(supplier_name),
        SUM(total_pieces)::int, SUM(total_weight)::float8, SUM(available_count)::int,
        SUM(remaining_weight)::float8, SUM(pending_weight)::float8, SUM(wastage_total)::float8,
        SUM(wastage_count)::int, SUM(wastage_weight_base_total)::float8, SUM(issued_weight_base_total)::float8,
        string_to_array(cut_name, ', '), ARRAY[]::text[], string_to_array(yarn_name, ', '), ARRAY[]::text[],
        cut_name, yarn_name, string_agg(barcode_str, ' '),
        CASE WHEN SUM(pending_weight) > 0.000000001 THEN 'active' ELSE 'inactive' END,
        CONCAT_WS('::', item_id, COALESCE(supplier_id, ''), cut_name, yarn_name, '') AS sort_key
      FROM filtered
      WHERE ${groupBy} = true
      GROUP BY item_id, supplier_id, cut_name, yarn_name
    ),
    summarized AS (
      SELECT selected.*,
        ${summaryColumns}
      FROM selected
    )
    SELECT * FROM summarized
    WHERE sort_key > ${afterSortKey}
    ORDER BY sort_key ASC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => mapCutterStockQueryRow(row, 'jumbo', groupBy, includeMembers));
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ afterSortKey: last.sort_key }), 'utf8').toString('base64')
    : null;
  return { items, summary: cutterStockSummaryFromRow(rows[0]), hasMore, nextCursor };
}

async function queryCutterBobbinStockGroups(req) {
  const limit = clampLimit(req.query.limit);
  const afterSortKey = decodeCutterStockCursor(req.query.cursor);
  const groupBy = ['1', 'true', 'yes'].includes(String(req.query.groupBy || '').toLowerCase());
  const includeMembers = ['1', 'true', 'yes'].includes(String(req.query.includeMembers || '').toLowerCase());
  const filterSql = cutterStockFilterSql(req, 'bobbins');
  const separateSummary = String(req.query.summaryMode || '').toLowerCase() === 'separate';
  const summaryColumns = separateSummary ? Prisma.sql`
    NULL::int AS summary_group_count,
    NULL::float8 AS summary_total_weight,
    NULL::float8 AS summary_total_pieces,
    NULL::float8 AS summary_available_count,
    NULL::float8 AS summary_remaining_weight,
    NULL::float8 AS summary_pending_weight,
    NULL::float8 AS summary_wastage_total,
    NULL::float8 AS summary_wastage_count,
    NULL::float8 AS summary_wastage_weight_base_total,
    NULL::float8 AS summary_issued_weight_base_total,
    NULL::float8 AS summary_total_bobbins,
    NULL::float8 AS summary_available_bobbins,
    NULL::float8 AS summary_available_weight,
    NULL::float8 AS summary_crate_count
  ` : Prisma.sql`
    COUNT(*) OVER ()::int AS summary_group_count,
    SUM(total_weight) OVER ()::float8 AS summary_total_weight,
    0::float8 AS summary_total_pieces,
    0::float8 AS summary_available_count,
    0::float8 AS summary_remaining_weight,
    0::float8 AS summary_pending_weight,
    0::float8 AS summary_wastage_total,
    0::float8 AS summary_wastage_count,
    0::float8 AS summary_wastage_weight_base_total,
    0::float8 AS summary_issued_weight_base_total,
    SUM(total_bobbins) OVER ()::float8 AS summary_total_bobbins,
    SUM(available_bobbins) OVER ()::float8 AS summary_available_bobbins,
    SUM(available_weight) OVER ()::float8 AS summary_available_weight,
    SUM(crate_count) OVER ()::float8 AS summary_crate_count
  `;
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH row_values AS (
      SELECT
        COALESCE(piece."lotNo", '(No Lot)') AS lot_no,
        COALESCE(row.date, to_char(row."createdAt", 'YYYY-MM-DD')) AS date,
        COALESCE(piece."itemId", lot."itemId", '') AS item_id,
        COALESCE(item.name, '—') AS item_name,
        lot."firmId" AS firm_id,
        COALESCE(firm.name, '—') AS firm_name,
        lot."supplierId" AS supplier_id,
        COALESCE(supplier.name, '—') AS supplier_name,
        COALESCE(row.bobbin_quantity, 0)::int AS total_bobbins,
        COALESCE(row."issuedBobbins", 0)::int AS issued_bobbins,
        GREATEST(0, COALESCE(row.bobbin_quantity, 0) - COALESCE(row."issuedBobbins", 0) - COALESCE(row."dispatchedCount", 0))::int AS count_available,
        COALESCE(row."netWt", row."totalKg", row."yarnWt", 0)::float8 AS total_weight,
        COALESCE(row."issuedBobbinWeight", 0)::float8 AS issued_weight,
        GREATEST(0, COALESCE(row."netWt", row."totalKg", row."yarnWt", 0) - COALESCE(row."issuedBobbinWeight", 0) - COALESCE(row."dispatchedWeight", 0))::float8 AS available_weight,
        COALESCE(cut.name, NULLIF(row.cut, ''), '—') AS cut_name,
        row."cutId" AS cut_id,
        COALESCE(NULLIF(row."yarnName", ''), '—') AS yarn_name,
        yarn.id AS yarn_id,
        COALESCE(row.barcode, '') AS barcode,
        COALESCE(row.notes, '') AS notes
      FROM "ReceiveFromCutterMachineRow" row
      LEFT JOIN "InboundItem" piece ON piece.id = row."pieceId"
      LEFT JOIN "Lot" lot ON lot."lotNo" = piece."lotNo"
      LEFT JOIN "Item" item ON item.id = COALESCE(piece."itemId", lot."itemId")
      LEFT JOIN "Firm" firm ON firm.id = lot."firmId"
      LEFT JOIN "Supplier" supplier ON supplier.id = lot."supplierId"
      LEFT JOIN "Cut" cut ON cut.id = row."cutId"
      LEFT JOIN "Yarn" yarn ON lower(trim(yarn.name)) = lower(trim(row."yarnName"))
      WHERE row."isDeleted" = false
    ),
    base AS (
      SELECT
        lot_no, MAX(date) AS date, item_id, MAX(item_name) AS item_name,
        firm_id, MAX(firm_name) AS firm_name, supplier_id, MAX(supplier_name) AS supplier_name,
        SUM(total_bobbins)::int AS total_bobbins,
        SUM(issued_bobbins)::int AS issued_bobbins,
        SUM(CASE
          WHEN total_bobbins <= 0 THEN 0
          WHEN total_weight <= 0 THEN count_available
          WHEN available_weight <= 0 THEN 0
          ELSE LEAST(count_available, FLOOR(((available_weight / total_weight) * total_bobbins) + 0.000001)::int)
        END)::int AS available_bobbins,
        SUM(total_weight)::float8 AS total_weight,
        SUM(issued_weight)::float8 AS issued_weight,
        SUM(available_weight)::float8 AS available_weight,
        COUNT(*)::int AS crate_count,
        array_remove(array_agg(DISTINCT cut_name ORDER BY cut_name), '—') AS cut_names,
        array_remove(array_agg(DISTINCT cut_id ORDER BY cut_id), NULL) AS cut_ids,
        array_remove(array_agg(DISTINCT yarn_name ORDER BY yarn_name), '—') AS yarn_names,
        array_remove(array_agg(DISTINCT yarn_id ORDER BY yarn_id), NULL) AS yarn_ids,
        CASE WHEN COUNT(DISTINCT cut_name) FILTER (WHERE cut_name <> '—') > 1 THEN 'Mixed'
          ELSE COALESCE(MAX(cut_name) FILTER (WHERE cut_name <> '—'), '—') END AS cut_name,
        CASE WHEN COUNT(DISTINCT yarn_name) FILTER (WHERE yarn_name <> '—') > 1 THEN 'Mixed'
          ELSE COALESCE(MAX(yarn_name) FILTER (WHERE yarn_name <> '—'), '—') END AS yarn_name,
        string_agg(NULLIF(barcode, ''), ' ') AS barcode_str,
        string_agg(NULLIF(notes, ''), ' ') AS notes_str,
        CASE WHEN SUM(CASE
          WHEN total_bobbins <= 0 THEN 0
          WHEN total_weight <= 0 THEN count_available
          WHEN available_weight <= 0 THEN 0
          ELSE LEAST(count_available, FLOOR(((available_weight / total_weight) * total_bobbins) + 0.000001)::int)
        END) > 0 THEN 'active' ELSE 'inactive' END AS status_type
      FROM row_values
      GROUP BY lot_no, item_id, firm_id, supplier_id
    ),
    filtered AS (
      SELECT * FROM base ${filterSql}
    ),
    selected AS (
      SELECT
        lot_no, NULL::text AS group_key, ARRAY[lot_no]::text[] AS lot_nos, date,
        item_id, item_name, firm_id, firm_name, supplier_id, supplier_name,
        total_bobbins, issued_bobbins, available_bobbins, total_weight, issued_weight,
        available_weight, crate_count, cut_names, cut_ids, yarn_names, yarn_ids,
        cut_name, yarn_name, barcode_str, notes_str, status_type, lot_no AS sort_key
      FROM filtered WHERE ${groupBy} = false
      UNION ALL
      SELECT
        ''::text, CONCAT_WS('::', item_id, COALESCE(supplier_id, ''), cut_name, yarn_name, ''),
        array_agg(lot_no ORDER BY lot_no), MAX(date), item_id, MAX(item_name), MIN(firm_id), MIN(firm_name),
        supplier_id, MAX(supplier_name), SUM(total_bobbins)::int, SUM(issued_bobbins)::int,
        SUM(available_bobbins)::int, SUM(total_weight)::float8, SUM(issued_weight)::float8,
        SUM(available_weight)::float8, SUM(crate_count)::int,
        string_to_array(cut_name, ', '), ARRAY[]::text[], string_to_array(yarn_name, ', '), ARRAY[]::text[],
        cut_name, yarn_name, string_agg(barcode_str, ' '), string_agg(notes_str, ' '),
        CASE WHEN SUM(available_bobbins) > 0 THEN 'active' ELSE 'inactive' END,
        CONCAT_WS('::', item_id, COALESCE(supplier_id, ''), cut_name, yarn_name, '')
      FROM filtered WHERE ${groupBy} = true
      GROUP BY item_id, supplier_id, cut_name, yarn_name
    ),
    summarized AS (
      SELECT selected.*,
        ${summaryColumns}
      FROM selected
    )
    SELECT * FROM summarized
    WHERE sort_key > ${afterSortKey}
    ORDER BY sort_key ASC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => mapCutterStockQueryRow(row, 'bobbins', groupBy, includeMembers));
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ afterSortKey: last.sort_key }), 'utf8').toString('base64')
    : null;
  return { items, summary: cutterStockSummaryFromRow(rows[0]), hasMore, nextCursor };
}

export function paginateStockGroupItems(items, req, process) {
  const search = String(req.query.search || '').trim().toLowerCase();
  let filteredItems = items.filter((item) => {
    if (req.query.item && String(item.itemId || '') !== String(req.query.item)) return false;
    if (req.query.cut && !(Array.isArray(item.cutIds) && item.cutIds.some((id) => String(id) === String(req.query.cut)))) return false;
    if (req.query.yarn) {
      const yarnMatches = String(item.yarnId || '') === String(req.query.yarn)
        || (Array.isArray(item.yarnIds) && item.yarnIds.some((id) => String(id) === String(req.query.yarn)));
      if (!yarnMatches) return false;
    }
    if (req.query.firm && String(item.firmId || '') !== String(req.query.firm)) return false;
    if (req.query.supplier && String(item.supplierId || '') !== String(req.query.supplier)) return false;
    if (req.query.status && req.query.status !== 'all') {
      if (req.query.status === 'available_to_issue') {
        const available = process === 'cutter'
          ? Number(item.availableCount ?? item.availableBobbins ?? 0)
          : Number(item.totalWeight || 0);
        if (available <= 0) return false;
      } else if (String(item.statusType || '') !== String(req.query.status)) return false;
    }
    if (req.query.from && String(item.date || '') < String(req.query.from)) return false;
    if (req.query.to && String(item.date || '') > String(req.query.to)) return false;
    if (req.query.steamed && req.query.steamed !== 'all' && String(item.steamedStatusType || '') !== String(req.query.steamed)) return false;
    if (search) {
      const haystack = [item.lotNo, item.itemName, item.cutName, item.yarnName, item.twistName, item.firmName, item.supplierName, item.barcodeStr, item.notesStr]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      const alternatives = search.split('|').map((value) => value.trim()).filter(Boolean);
      const matches = alternatives.length > 1
        ? alternatives.some((value) => haystack.includes(value))
        : search.split(/\s+/).filter(Boolean).every((value) => haystack.includes(value));
      if (!matches) return false;
    }
    return true;
  });
  if (['1', 'true', 'yes'].includes(String(req.query.groupBy || '').toLowerCase())) {
    const grouped = new Map();
    for (const item of filteredItems) {
      const groupKey = [item.itemId, item.supplierId, item.cutName, item.yarnName, item.twistName]
        .map((value) => String(value || ''))
        .join('::');
      const existing = grouped.get(groupKey) || {
        ...item,
        lotKey: null,
        expandable: false,
        lotNo: '',
        groupKey,
        lots: [],
        memberLotKeys: [],
        totalWeight: 0,
        totalRolls: 0,
        totalCones: 0,
        steamedRolls: 0,
        steamedWeight: 0,
        totalPieces: 0,
        availableCount: 0,
        remainingWeight: 0,
        pendingWeight: 0,
        wastageTotal: 0,
        wastageCount: 0,
        wastageWeightBaseTotal: 0,
        issuedWeightBaseTotal: 0,
        totalBobbins: 0,
        issuedBobbins: 0,
        availableBobbins: 0,
        issuedWeight: 0,
        availableWeight: 0,
        crateCount: 0,
        rows: [],
        pieces: [],
        crates: [],
      };
      existing.lots.push(item.lotNo);
      if (item.lotKey) existing.memberLotKeys.push(item.lotKey);
      for (const field of [
        'totalWeight', 'totalRolls', 'totalCones', 'steamedRolls', 'steamedWeight',
        'totalPieces', 'availableCount', 'remainingWeight', 'pendingWeight',
        'wastageTotal', 'wastageCount', 'wastageWeightBaseTotal', 'issuedWeightBaseTotal',
        'totalBobbins', 'issuedBobbins', 'availableBobbins', 'issuedWeight', 'availableWeight', 'crateCount',
      ]) existing[field] += Number(item[field] || 0);
      existing.statusType = existing.availableCount > 0 || existing.availableBobbins > 0 || existing.totalWeight > 1e-9 ? 'active' : 'inactive';
      grouped.set(groupKey, existing);
    }
    filteredItems = Array.from(grouped.values()).sort((a, b) => String(a.groupKey).localeCompare(String(b.groupKey)));
  }
  // Cursor identity is the opaque lot key, so every page must use the same
  // deterministic ordering regardless of database planner or insertion order.
  filteredItems.sort((a, b) => String(a.lotKey || a.groupKey || '').localeCompare(String(b.lotKey || b.groupKey || '')));
  const limit = clampLimit(req.query.limit);
  let afterKey = '';
  if (req.query.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(String(req.query.cursor), 'base64').toString('utf8'));
      afterKey = String(decoded?.afterKey || '');
    } catch (_) { }
  }
  const afterIndex = afterKey ? filteredItems.findIndex((item) => (item.lotKey || item.groupKey) === afterKey) : -1;
  const start = afterKey ? (afterIndex >= 0 ? afterIndex + 1 : filteredItems.length) : 0;
  const page = filteredItems.slice(start, start + limit);
  const hasMore = start + page.length < filteredItems.length;
  const nextCursor = hasMore && page.length > 0
    ? Buffer.from(JSON.stringify({ afterKey: page[page.length - 1].lotKey || page[page.length - 1].groupKey }), 'utf8').toString('base64')
    : null;
  const summary = filteredItems.reduce((acc, item) => ({
    ...acc,
    groupCount: acc.groupCount + 1,
    totalWeight: acc.totalWeight + Number(item.totalWeight || 0),
    totalRolls: acc.totalRolls + Number(item.totalRolls || 0),
    totalCones: acc.totalCones + Number(item.totalCones || 0),
    steamedRolls: acc.steamedRolls + Number(item.steamedRolls || 0),
    totalPieces: acc.totalPieces + Number(item.totalPieces || 0),
    availableCount: acc.availableCount + Number(item.availableCount || 0),
    remainingWeight: acc.remainingWeight + Number(item.remainingWeight || 0),
    pendingWeight: acc.pendingWeight + Number(item.pendingWeight || 0),
    wastageTotal: acc.wastageTotal + Number(item.wastageTotal || 0),
    wastageCount: acc.wastageCount + Number(item.wastageCount || 0),
    wastageWeightBaseTotal: acc.wastageWeightBaseTotal + Number(item.wastageWeightBaseTotal || 0),
    issuedWeightBaseTotal: acc.issuedWeightBaseTotal + Number(item.issuedWeightBaseTotal || 0),
    totalBobbins: acc.totalBobbins + Number(item.totalBobbins || 0),
    availableBobbins: acc.availableBobbins + Number(item.availableBobbins || 0),
    availableWeight: acc.availableWeight + Number(item.availableWeight || 0),
    crateCount: acc.crateCount + Number(item.crateCount || 0),
  }), {
    process,
    groupCount: 0,
    totalWeight: 0,
    totalRolls: 0,
    totalCones: 0,
    steamedRolls: 0,
    totalPieces: 0,
    availableCount: 0,
    remainingWeight: 0,
    pendingWeight: 0,
    wastageTotal: 0,
    wastageCount: 0,
    wastageWeightBaseTotal: 0,
    issuedWeightBaseTotal: 0,
    totalBobbins: 0,
    availableBobbins: 0,
    availableWeight: 0,
    crateCount: 0,
  });
  return { items: page, summary, hasMore, nextCursor };
}

export function paginateStockRows(items, req) {
  const limit = clampLimit(req.query.limit);
  let afterId = '';
  if (req.query.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(String(req.query.cursor), 'base64').toString('utf8'));
      afterId = String(decoded?.afterId || '');
    } catch (_) { }
  }
  const afterIndex = afterId ? items.findIndex((item) => item.id === afterId) : -1;
  const start = afterId ? (afterIndex >= 0 ? afterIndex + 1 : items.length) : 0;
  const page = items.slice(start, start + limit);
  const hasMore = start + page.length < items.length;
  const nextCursor = hasMore && page.length > 0
    ? Buffer.from(JSON.stringify({ afterId: page[page.length - 1].id }), 'utf8').toString('base64')
    : null;
  return { items: page, hasMore, nextCursor };
}

function decodeStockRowCursor(rawCursor) {
  if (!rawCursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(rawCursor), 'base64').toString('utf8'));
    const afterId = String(decoded?.afterId || '').trim();
    return afterId ? { afterId } : null;
  } catch (_) {
    return null;
  }
}

function buildStockRowPage(fetchedItems, limit) {
  const hasMore = fetchedItems.length > limit;
  const items = fetchedItems.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = hasMore && last?.id
    ? Buffer.from(JSON.stringify({ afterId: last.id }), 'utf8').toString('base64')
    : null;
  return { items, hasMore, nextCursor };
}

async function handleStockGroups(req, res, { summaryOnly = false } = {}) {
  try {
    const process = String(req.params.process || '').trim().toLowerCase();
    const separateSummary = !summaryOnly && String(req.query.summaryMode || '').toLowerCase() === 'separate';
    const includeMembers = ['1', 'true', 'yes'].includes(String(req.query.includeMembers || '').toLowerCase());
    if (!['cutter', 'holo', 'coning'].includes(process)) {
      return res.status(400).json({ error: 'Invalid process' });
    }

    if (process === 'cutter') {
      const view = String(req.query.view || 'jumbo').trim().toLowerCase();
      if (!['jumbo', 'bobbins'].includes(view)) return res.status(400).json({ error: 'Invalid cutter stock view' });
      const result = view === 'bobbins'
        ? await queryCutterBobbinStockGroups(req)
        : await queryCutterJumboStockGroups(req);
      if (summaryOnly) {
        return res.json({ summary: result.summary, computedAt: new Date().toISOString() });
      }
      return res.json(separateSummary
        ? { ...result, summary: null, summaryPending: true }
        : result);
    }

    if (process === 'holo') {
      const limit = clampLimit(req.query.limit);
      const afterSortKey = decodeCutterStockCursor(req.query.cursor);
      const filterSql = stageStockFilterSql(req, process);
      const groupBy = ['1', 'true', 'yes'].includes(String(req.query.groupBy || '').toLowerCase());
      const selectedSql = groupBy ? Prisma.sql`
        SELECT
          ''::text AS lot_label,
          ARRAY[]::text[] AS lot_nos,
          false AS is_mixed,
          ''::text AS lot_no_raw,
          item_id,
          MIN(yarn_id) AS yarn_id,
          MIN(twist_id) AS twist_id,
          ''::text AS firm_id,
          supplier_id,
          MIN(item_name) AS item_name,
          ''::text AS firm_name,
          MIN(supplier_name) AS supplier_name,
          yarn_name,
          twist_name,
          ARRAY[cut_name]::text[] AS cut_names,
          ARRAY[]::text[] AS cut_ids,
          MAX(max_date) AS max_date,
          SUM(total_weight) AS total_weight,
          SUM(total_rolls) AS total_rolls,
          SUM(steamed_weight) AS steamed_weight,
          SUM(steamed_rolls) AS steamed_rolls,
          ARRAY[]::text[] AS boiler_machine_names,
          ARRAY[]::text[] AS boiler_labels,
          ''::text AS barcode_str,
          ''::text AS notes_str,
          CASE WHEN SUM(total_weight) > 0.000000001 THEN 'active' ELSE 'inactive' END AS status_type,
          CASE WHEN SUM(steamed_rolls) = 0 THEN 'not_steamed'
            WHEN SUM(steamed_rolls) >= SUM(total_rolls) THEN 'steamed' ELSE 'partial' END AS steamed_status_type,
          CONCAT_WS('::', item_id, supplier_id, cut_name, yarn_name, twist_name) AS group_key,
          CONCAT_WS('::', item_id, supplier_id, cut_name, yarn_name, twist_name) AS page_sort_key,
          array_agg(lot_label ORDER BY lot_label) AS lots,
          jsonb_agg(jsonb_build_object(
            'lotLabel', lot_label, 'lotNoRaw', lot_no_raw, 'itemId', item_id,
            'yarnId', yarn_id, 'twistId', twist_id, 'firmId', firm_id,
            'supplierId', supplier_id, 'cutNames', cut_names, 'lotNos', lot_nos,
            'isMixed', is_mixed
          ) ORDER BY sort_key) AS member_groups
        FROM filtered
        GROUP BY item_id, supplier_id, cut_name, yarn_name, twist_name
      ` : Prisma.sql`
        SELECT
          filtered.*,
          NULL::text AS group_key,
          sort_key AS page_sort_key,
          ARRAY[]::text[] AS lots,
          NULL::jsonb AS member_groups
        FROM filtered
      `;
      const holoSummaryColumns = separateSummary ? Prisma.sql`
        NULL::int AS summary_group_count,
        NULL::float8 AS summary_total_weight,
        NULL::float8 AS summary_total_rolls,
        NULL::float8 AS summary_total_cones,
        NULL::float8 AS summary_steamed_rolls
      ` : Prisma.sql`
        COUNT(*) OVER ()::int AS summary_group_count,
        SUM(total_weight) OVER ()::float8 AS summary_total_weight,
        SUM(total_rolls) OVER ()::float8 AS summary_total_rolls,
        0::float8 AS summary_total_cones,
        SUM(steamed_rolls) OVER ()::float8 AS summary_steamed_rolls
      `;
      const rows = await prisma.$queryRaw(Prisma.sql`
        WITH issue_refs AS (
          SELECT i.id AS issue_id, elem->>'rowId' AS cutter_row_id
          FROM "IssueToHoloMachine" i
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem ON true
          WHERE i."isDeleted" = false
        ),
        issue_lots AS (
          SELECT ir.issue_id,
                 array_remove(array_agg(DISTINCT bi."lotNo" ORDER BY bi."lotNo"), NULL) AS lot_nos
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
            SUM(COALESCE(NULLIF(elem->>'issueRolls', '')::numeric, NULLIF(elem->>'baseRolls', '')::numeric, 0)) AS issue_rolls,
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
            r."barcode" AS barcode,
            r."notes" AS notes,
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
          LEFT JOIN LATERAL (
            SELECT log.*
            FROM "BoilerSteamLog" log
            WHERE log."holoReceiveRowId" = r.id
               OR (log."barcode" IS NOT NULL AND upper(log."barcode") = upper(r."barcode"))
            ORDER BY (log."holoReceiveRowId" = r.id) DESC, log."steamedAt" DESC, log.id DESC
            LIMIT 1
          ) st ON true
          LEFT JOIN "Machine" bm ON bm.id = st."boilerMachineId"
          WHERE r."isDeleted" = false
        ),
        base_groups AS (
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
          COALESCE(yn.name, '—') AS yarn_name,
          COALESCE(tw.name, '—') AS twist_name,
          array_remove(array_agg(DISTINCT COALESCE(ct.name, '—')), NULL) AS cut_names,
          array_remove(array_agg(DISTINCT i."cutId"), NULL) AS cut_ids,
          MAX(rc.date_str) AS max_date,
          SUM(GREATEST(0, rc.net_weight - rc.dispatched_weight - rc.issued_weight)) AS total_weight,
          SUM(LEAST(
            GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls),
            CASE
              WHEN rc.net_weight <= 0 THEN GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls)
              ELSE FLOOR((GREATEST(0, rc.net_weight - rc.dispatched_weight - rc.issued_weight) / rc.net_weight) * rc.roll_count)
            END
          )) AS total_rolls,
          SUM(CASE WHEN rc.is_steamed THEN GREATEST(0, rc.net_weight - rc.dispatched_weight - rc.issued_weight) ELSE 0 END) AS steamed_weight,
          SUM(CASE WHEN rc.is_steamed THEN LEAST(
            GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls),
            CASE
              WHEN rc.net_weight <= 0 THEN GREATEST(0, rc.roll_count - rc.dispatched_count - rc.issued_rolls)
              ELSE FLOOR((GREATEST(0, rc.net_weight - rc.dispatched_weight - rc.issued_weight) / rc.net_weight) * rc.roll_count)
            END
          ) ELSE 0 END) AS steamed_rolls,
          array_remove(array_agg(DISTINCT rc.boiler_machine_name), NULL) AS boiler_machine_names,
          array_remove(array_agg(DISTINCT rc.boiler_label), NULL) AS boiler_labels,
          string_agg(DISTINCT COALESCE(rc.barcode, ''), ' ') AS barcode_str,
          string_agg(DISTINCT COALESCE(rc.notes, ''), ' ') AS notes_str
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
        ),
        normalized AS (
          SELECT
            base_groups.*,
            CASE WHEN COALESCE(array_length(cut_names, 1), 0) > 1 THEN 'Mixed'
              ELSE COALESCE(cut_names[1], '—') END AS cut_name,
            ARRAY_REMOVE(ARRAY[yarn_id]::text[], NULL) AS yarn_ids,
            CASE WHEN total_weight > 0.000000001 THEN 'active' ELSE 'inactive' END AS status_type,
            CASE WHEN steamed_rolls = 0 THEN 'not_steamed'
              WHEN steamed_rolls >= total_rolls THEN 'steamed' ELSE 'partial' END AS steamed_status_type,
            CONCAT_WS(E'\x1f', lot_label, lot_no_raw, item_id, COALESCE(yarn_id, ''), COALESCE(twist_id, ''),
              COALESCE(firm_id, ''), COALESCE(supplier_id, ''), array_to_string(cut_names, E'\x1e'),
              array_to_string(lot_nos, E'\x1e'), is_mixed::text) AS sort_key
          FROM base_groups
        ),
        filtered AS (
          SELECT * FROM normalized
          ${filterSql}
        ),
        selected AS (
          ${selectedSql}
        ),
        summarized AS (
          SELECT selected.*,
            ${holoSummaryColumns}
          FROM selected
        )
        SELECT * FROM summarized
        WHERE page_sort_key > ${afterSortKey}
        ORDER BY page_sort_key ASC
        LIMIT ${limit + 1}
      `);

      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const items = pageRows.map((r) => {
        const cutNames = Array.isArray(r.cut_names) ? [...r.cut_names].sort((a, b) => String(a).localeCompare(String(b))) : [];
        const cutIds = Array.isArray(r.cut_ids) ? r.cut_ids.filter(Boolean) : [];
        const cutName = cutNames.length > 1 ? 'Mixed' : (cutNames[0] || '—');
        const totalRolls = Number(r.total_rolls || 0);
        const steamedRolls = Number(r.steamed_rolls || 0);
        const steamedStatusType = steamedRolls === 0 ? 'not_steamed'
          : (steamedRolls >= totalRolls ? 'steamed' : 'partial');
        const lotNos = Array.isArray(r.lot_nos)
          ? Array.from(new Set(r.lot_nos.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)))
          : [];
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
        const memberGroups = Array.isArray(r.member_groups) ? r.member_groups : [];
        const isGroup = Boolean(r.group_key);

        return {
          lotKey: isGroup ? null : encodeStockLotKey({
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
            lotNos,
            isMixed,
          }),
          expandable: !isGroup,
          groupKey: r.group_key || null,
          lots: Array.isArray(r.lots) ? r.lots : [],
          memberLotKeys: includeMembers ? memberGroups.map((member) => encodeStockLotKey({
            v: 1,
            process: 'holo',
            lotLabel: member.lotLabel || '',
            lotNoRaw: member.lotNoRaw || '',
            itemId: member.itemId || '',
            yarnId: member.yarnId || null,
            twistId: member.twistId || null,
            firmId: member.firmId || '',
            supplierId: member.supplierId || '',
            cutNames: Array.isArray(member.cutNames) ? member.cutNames : [],
            lotNos: Array.isArray(member.lotNos) ? member.lotNos : [],
            isMixed: Boolean(member.isMixed),
          })) : [],
          lotNo: isGroup ? '' : (r.lot_label || '—'),
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
          cutIds,
          totalRolls,
          totalWeight: Number(r.total_weight || 0),
          steamedRolls,
          steamedWeight: Number(r.steamed_weight || 0),
          steamedStatusType,
          boilerMachineNames,
          boilerMachineNamesStr: boilerMachineNames.join(', '),
          boilerLabels,
          boilerLabelsStr: boilerLabels.join(', '),
          barcodeStr: r.barcode_str || '',
          notesStr: r.notes_str || '',
          statusType: Number(r.total_weight || 0) > 0.000000001 ? 'active' : 'inactive',
          date: r.max_date || '',
          rows: [],
        };
      });
      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last
        ? Buffer.from(JSON.stringify({ afterSortKey: last.page_sort_key }), 'utf8').toString('base64')
        : null;
      const summary = stageStockSummaryFromRow(rows[0], process);
      if (summaryOnly) {
        return res.json({ summary, computedAt: new Date().toISOString() });
      }
      return res.json({
        items,
        summary: separateSummary ? null : summary,
        summaryPending: separateSummary ? true : undefined,
        hasMore,
        nextCursor,
      });
    }

    // coning
    const limit = clampLimit(req.query.limit);
    const afterSortKey = decodeCutterStockCursor(req.query.cursor);
    const filterSql = stageStockFilterSql(req, process);
    const groupBy = ['1', 'true', 'yes'].includes(String(req.query.groupBy || '').toLowerCase());
    const selectedSql = groupBy ? Prisma.sql`
      SELECT
        ''::text AS lot_label,
        ''::text AS lot_no,
        item_id,
        ''::text AS firm_id,
        supplier_id,
        MIN(item_name) AS item_name,
        ''::text AS firm_name,
        MIN(supplier_name) AS supplier_name,
        ARRAY[cut_name]::text[] AS cut_names,
        ARRAY[]::text[] AS cut_ids,
        ARRAY[yarn_name]::text[] AS yarn_names,
        ARRAY[]::text[] AS yarn_ids,
        ARRAY[twist_name]::text[] AS twist_names,
        ARRAY[]::text[] AS twist_ids,
        yarn_name,
        twist_name,
        cut_name,
        ''::text AS barcode_str,
        ''::text AS notes_str,
        MAX(max_date) AS max_date,
        SUM(total_cones) AS total_cones,
        SUM(total_weight) AS total_weight,
        CASE WHEN SUM(total_weight) > 0.000000001 THEN 'active' ELSE 'inactive' END AS status_type,
        CONCAT_WS('::', item_id, supplier_id, cut_name, yarn_name, twist_name) AS group_key,
        CONCAT_WS('::', item_id, supplier_id, cut_name, yarn_name, twist_name) AS page_sort_key,
        array_agg(lot_no ORDER BY lot_no) AS lots,
        jsonb_agg(jsonb_build_object(
          'lotNo', lot_no, 'itemId', item_id, 'yarnId', yarn_id,
          'firmId', firm_id, 'supplierId', supplier_id,
          'cutIds', cut_ids, 'yarnIds', yarn_ids, 'twistIds', twist_ids
        ) ORDER BY sort_key) AS member_groups
      FROM filtered
      GROUP BY item_id, supplier_id, cut_name, yarn_name, twist_name
    ` : Prisma.sql`
      SELECT
        filtered.*,
        NULL::text AS group_key,
        sort_key AS page_sort_key,
        ARRAY[]::text[] AS lots,
        NULL::jsonb AS member_groups
      FROM filtered
    `;
    const coningSummaryColumns = separateSummary ? Prisma.sql`
      NULL::int AS summary_group_count,
      NULL::float8 AS summary_total_weight,
      NULL::float8 AS summary_total_rolls,
      NULL::float8 AS summary_total_cones,
      NULL::float8 AS summary_steamed_rolls
    ` : Prisma.sql`
      COUNT(*) OVER ()::int AS summary_group_count,
      SUM(total_weight) OVER ()::float8 AS summary_total_weight,
      0::float8 AS summary_total_rolls,
      SUM(total_cones) OVER ()::float8 AS summary_total_cones,
      0::float8 AS summary_steamed_rolls
    `;
    const rows = await prisma.$queryRaw(Prisma.sql`
      WITH RECURSIVE coning_refs AS MATERIALIZED (
        SELECT ic.id AS issue_id, elem
        FROM "IssueToConingMachine" ic
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem
        WHERE ic."isDeleted" = false
      ),
      lineage AS (
        SELECT ic.id AS root_issue_id, ic.id AS issue_id, ARRAY[ic.id]::text[] AS path, 0 AS depth
        FROM "IssueToConingMachine" ic
        WHERE ic."isDeleted" = false
        UNION ALL
        SELECT l.root_issue_id, parent.id, l.path || parent.id, l.depth + 1
        FROM lineage l
        JOIN coning_refs current_ref ON current_ref.issue_id = l.issue_id
        JOIN "ReceiveFromConingMachineRow" parent_row ON parent_row.id = current_ref.elem->>'rowId' AND parent_row."isDeleted" = false
        JOIN "IssueToConingMachine" parent ON parent.id = parent_row."issueId" AND parent."isDeleted" = false
        WHERE NOT parent.id = ANY(l.path) AND l.depth < 32
      ),
      trace AS (
        SELECT
          l.root_issue_id AS issue_id,
          CASE WHEN count(hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hc.name ORDER BY hc.name) FILTER (WHERE hi."cutId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT cc.name ORDER BY cc.name), NULL) END AS cut_names,
          CASE WHEN count(hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."cutId" ORDER BY hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."cutId" ORDER BY ic."cutId"), NULL) END AS cut_ids,
          CASE WHEN count(hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hy.name ORDER BY hy.name) FILTER (WHERE hi."yarnId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT cy.name ORDER BY cy.name), NULL) END AS yarn_names,
          CASE WHEN count(hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."yarnId" ORDER BY hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."yarnId" ORDER BY ic."yarnId"), NULL) END AS yarn_ids,
          CASE WHEN count(hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT ht.name ORDER BY ht.name) FILTER (WHERE hi."twistId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ctw.name ORDER BY ctw.name), NULL) END AS twist_names,
          CASE WHEN count(hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."twistId" ORDER BY hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."twistId" ORDER BY ic."twistId"), NULL) END AS twist_ids
        FROM lineage l
        JOIN "IssueToConingMachine" ic ON ic.id = l.issue_id
        LEFT JOIN coning_refs source_ref ON source_ref.issue_id = ic.id
        LEFT JOIN "ReceiveFromHoloMachineRow" hr ON hr.id = source_ref.elem->>'rowId'
        LEFT JOIN "IssueToHoloMachine" hi ON hi.id = hr."issueId"
        LEFT JOIN "Cut" hc ON hc.id = hi."cutId"
        LEFT JOIN "Cut" cc ON cc.id = ic."cutId"
        LEFT JOIN "Yarn" hy ON hy.id = hi."yarnId"
        LEFT JOIN "Yarn" cy ON cy.id = ic."yarnId"
        LEFT JOIN "Twist" ht ON ht.id = hi."twistId"
        LEFT JOIN "Twist" ctw ON ctw.id = ic."twistId"
        GROUP BY l.root_issue_id
      ),
      issued AS (
        SELECT elem->>'rowId' AS row_id,
               SUM(COALESCE(NULLIF(elem->>'issueRolls', '')::numeric, NULLIF(elem->>'baseRolls', '')::numeric, 0)) AS issue_count,
               SUM(COALESCE(NULLIF(elem->>'issueWeight', '')::numeric, 0)) AS issue_weight
        FROM coning_refs
        GROUP BY elem->>'rowId'
      ),
      takeback AS (
        SELECT l."sourceId" AS row_id,
               SUM((CASE WHEN tb."isReverse" THEN 1 ELSE -1 END) * l."count") AS count_delta,
               SUM((CASE WHEN tb."isReverse" THEN 1 ELSE -1 END) * l."weight") AS weight_delta
        FROM "IssueTakeBackLine" l
        JOIN "IssueTakeBack" tb ON tb.id = l."takeBackId"
        WHERE tb.stage = 'coning'
        GROUP BY l."sourceId"
      ),
      base_groups AS (
      SELECT
        i."lotNo" AS lot_no,
        i."itemId" AS item_id,
        lot."firmId" AS firm_id,
        lot."supplierId" AS supplier_id,
        it.name AS item_name,
        fm.name AS firm_name,
        sp.name AS supplier_name,
        COALESCE(tr.cut_names, ARRAY[]::text[]) AS cut_names,
        COALESCE(tr.cut_ids, ARRAY[]::text[]) AS cut_ids,
        COALESCE(tr.yarn_names, ARRAY[]::text[]) AS yarn_names,
        COALESCE(tr.yarn_ids, ARRAY[]::text[]) AS yarn_ids,
        COALESCE(tr.twist_names, ARRAY[]::text[]) AS twist_names,
        COALESCE(tr.twist_ids, ARRAY[]::text[]) AS twist_ids,
        string_agg(DISTINCT COALESCE(r."barcode", ''), ' ') AS barcode_str,
        string_agg(DISTINCT COALESCE(r."notes", ''), ' ') AS notes_str,
        MAX(COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD'))) AS max_date,
        SUM(LEAST(
          GREATEST(0, COALESCE(r."coneCount", 0) - COALESCE(r."dispatchedCount", 0) - COALESCE(iss.issue_count, 0) - COALESCE(tb.count_delta, 0)),
          CASE
            WHEN COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) <= 0
              THEN GREATEST(0, COALESCE(r."coneCount", 0) - COALESCE(r."dispatchedCount", 0) - COALESCE(iss.issue_count, 0) - COALESCE(tb.count_delta, 0))
            ELSE FLOOR(
              (GREATEST(0, COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) - COALESCE(r."dispatchedWeight", 0) - COALESCE(iss.issue_weight, 0) - COALESCE(tb.weight_delta, 0))
              / COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))))) * COALESCE(r."coneCount", 0))
          END
        )) AS total_cones,
        SUM(GREATEST(0, COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) - COALESCE(r."dispatchedWeight", 0) - COALESCE(iss.issue_weight, 0) - COALESCE(tb.weight_delta, 0))) AS total_weight
      FROM "ReceiveFromConingMachineRow" r
      JOIN "IssueToConingMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
      LEFT JOIN trace tr ON tr.issue_id = i.id
      LEFT JOIN issued iss ON iss.row_id = r.id
      LEFT JOIN takeback tb ON tb.row_id = r.id
      LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
      LEFT JOIN "Item" it ON it.id = i."itemId"
      LEFT JOIN "Firm" fm ON fm.id = lot."firmId"
      LEFT JOIN "Supplier" sp ON sp.id = lot."supplierId"
      WHERE r."isDeleted" = false
      GROUP BY i."lotNo", i."itemId", lot."firmId", lot."supplierId", it.name, fm.name, sp.name, tr.cut_names, tr.cut_ids, tr.yarn_names, tr.yarn_ids, tr.twist_names, tr.twist_ids
      ),
      normalized AS (
        SELECT
          base_groups.*,
          lot_no AS lot_label,
          CASE WHEN COALESCE(array_length(cut_names, 1), 0) > 0
            THEN array_to_string(cut_names, ', ') ELSE '—' END AS cut_name,
          CASE WHEN COALESCE(array_length(yarn_names, 1), 0) > 0
            THEN array_to_string(yarn_names, ', ') ELSE '—' END AS yarn_name,
          CASE WHEN COALESCE(array_length(yarn_ids, 1), 0) = 1 THEN yarn_ids[1] ELSE NULL END AS yarn_id,
          CASE WHEN COALESCE(array_length(twist_names, 1), 0) > 0
            THEN array_to_string(twist_names, ', ') ELSE '—' END AS twist_name,
          CASE WHEN COALESCE(array_length(twist_ids, 1), 0) = 1 THEN twist_ids[1] ELSE NULL END AS twist_id,
          CASE WHEN total_weight > 0.000000001 THEN 'active' ELSE 'inactive' END AS status_type,
          CONCAT_WS(E'\x1f', lot_no, item_id, COALESCE(firm_id, ''), COALESCE(supplier_id, ''),
            array_to_string(cut_ids, E'\x1e'), array_to_string(yarn_ids, E'\x1e'), array_to_string(twist_ids, E'\x1e')) AS sort_key
        FROM base_groups
      ),
      filtered AS (
        SELECT * FROM normalized
        ${filterSql}
      ),
      selected AS (
        ${selectedSql}
      ),
      summarized AS (
        SELECT selected.*,
          ${coningSummaryColumns}
        FROM selected
      )
      SELECT * FROM summarized
      WHERE page_sort_key > ${afterSortKey}
      ORDER BY page_sort_key ASC
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((r) => {
      const cutNamesArr = Array.isArray(r.cut_names) ? r.cut_names.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [];
      const cutIds = Array.isArray(r.cut_ids) ? r.cut_ids.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [];
      const yarnNamesArr = Array.isArray(r.yarn_names) ? r.yarn_names.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [];
      const yarnIds = Array.isArray(r.yarn_ids) ? r.yarn_ids.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [];
      const twistNamesArr = Array.isArray(r.twist_names) ? r.twist_names.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [];
      const twistIds = Array.isArray(r.twist_ids) ? r.twist_ids.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [];
      const canonicalYarnId = yarnIds.length === 1 ? yarnIds[0] : null;
      const canonicalTwistId = twistIds.length === 1 ? twistIds[0] : null;
      const cutName = cutNamesArr.length ? cutNamesArr.join(', ') : '—';
      const yarnName = yarnNamesArr.length ? yarnNamesArr.join(', ') : '—';
      const isGroup = Boolean(r.group_key);
      const memberGroups = Array.isArray(r.member_groups) ? r.member_groups : [];
      return {
        lotKey: isGroup ? null : encodeStockLotKey({
          v: 1,
          process: 'coning',
          lotNo: r.lot_no || '',
          itemId: r.item_id || '',
          yarnId: canonicalYarnId,
          firmId: r.firm_id || '',
          supplierId: r.supplier_id || '',
          cutIds,
          yarnIds,
          twistIds,
        }),
        expandable: !isGroup,
        groupKey: r.group_key || null,
        lots: Array.isArray(r.lots) ? r.lots : [],
        memberLotKeys: includeMembers ? memberGroups.map((member) => encodeStockLotKey({
          v: 1,
          process: 'coning',
          lotNo: member.lotNo || '',
          itemId: member.itemId || '',
          yarnId: member.yarnId || null,
          firmId: member.firmId || '',
          supplierId: member.supplierId || '',
          cutIds: Array.isArray(member.cutIds) ? member.cutIds : [],
          yarnIds: Array.isArray(member.yarnIds) ? member.yarnIds : [],
          twistIds: Array.isArray(member.twistIds) ? member.twistIds : [],
        })) : [],
        lotNo: isGroup ? '' : (r.lot_no || '—'),
        itemId: r.item_id || '',
        itemName: r.item_name || '—',
        firmId: r.firm_id || '',
        firmName: r.firm_name || '—',
        supplierId: r.supplier_id || '',
        supplierName: r.supplier_name || '—',
        yarnId: canonicalYarnId || '',
        twistId: canonicalTwistId || '',
        yarnName,
        twistName: twistNamesArr.length ? twistNamesArr.join(', ') : '—',
        cutName,
        cutNames: cutNamesArr,
        cutIds,
        yarnNames: yarnNamesArr,
        yarnIds,
        twistNames: twistNamesArr,
        twistIds,
        barcodeStr: r.barcode_str || '',
        notesStr: r.notes_str || '',
        totalCones: Number(r.total_cones || 0),
        totalWeight: Number(r.total_weight || 0),
        statusType: Number(r.total_weight || 0) > 0.000000001 ? 'active' : 'inactive',
        date: r.max_date || '',
        rows: [],
      };
    });
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ afterSortKey: last.page_sort_key }), 'utf8').toString('base64')
      : null;
    const summary = stageStockSummaryFromRow(rows[0], process);
    if (summaryOnly) {
      return res.json({ summary, computedAt: new Date().toISOString() });
    }
    return res.json({
      items,
      summary: separateSummary ? null : summary,
      summaryPending: separateSummary ? true : undefined,
      hasMore,
      nextCursor,
    });
  } catch (err) {
    console.error('v2 stock lots error', err);
    res.status(500).json({ error: err.message || 'Failed to load stock lots' });
  }
}

router.get(['/stock/:process/lots', '/stock/:process/lot-groups'], requireAuth, requirePermission('stock', PERM_READ), (req, res) => (
  handleStockGroups(req, res)
));

router.get('/stock/:process/summary', requireAuth, requirePermission('stock', PERM_READ), (req, res) => (
  handleStockGroups(req, res, { summaryOnly: true })
));

router.get('/stock/:process/lot-rows', requireAuth, requirePermission('stock', PERM_READ), async (req, res) => {
  try {
    const process = String(req.params.process || '').trim().toLowerCase();
    const key = decodeStockLotKey(req.query?.key);
    if (!key || key.process !== process) return res.status(400).json({ error: 'Invalid lot key' });
    const limit = clampLimit(req.query.limit);
    const rowCursor = decodeStockRowCursor(req.query.cursor);
    if (req.query.cursor && !rowCursor) return res.status(400).json({ error: 'Invalid cursor' });

    if (process === 'cutter') {
      const lotNo = String(key.lotNo || '');
      const view = String(key.view || 'jumbo');
      if (!lotNo || !['jumbo', 'bobbins'].includes(view)) return res.status(400).json({ error: 'Invalid cutter lot key' });
      if (view === 'bobbins') {
        const isOrphanGroup = lotNo === '(No Lot)';
        const pieces = isOrphanGroup ? [] : await prisma.inboundItem.findMany({
          where: { lotNo },
          select: { id: true, itemId: true },
        });
        const pieceIds = pieces.map((piece) => piece.id);
        if (rowCursor) {
          const cursorRow = await prisma.receiveFromCutterMachineRow.findUnique({
            where: { id: rowCursor.afterId },
            select: { pieceId: true },
          });
          const cursorPiece = cursorRow
            ? await prisma.inboundItem.findUnique({ where: { id: cursorRow.pieceId }, select: { lotNo: true } })
            : null;
          const cursorBelongs = isOrphanGroup
            ? Boolean(cursorRow && !cursorPiece)
            : Boolean(cursorRow && pieceIds.includes(cursorRow.pieceId));
          if (!cursorBelongs) {
            return res.status(400).json({ error: 'Cursor does not belong to this lot' });
          }
        }
        let rows = [];
        if (isOrphanGroup) {
          const cursorPredicate = rowCursor ? Prisma.sql`
            AND (row."createdAt", row.id) < (
              SELECT cursor_row."createdAt", cursor_row.id
              FROM "ReceiveFromCutterMachineRow" cursor_row
              WHERE cursor_row.id = ${rowCursor.afterId}
            )
          ` : Prisma.sql``;
          const orphanIds = await prisma.$queryRaw(Prisma.sql`
            SELECT row.id
            FROM "ReceiveFromCutterMachineRow" row
            LEFT JOIN "InboundItem" piece ON piece.id = row."pieceId"
            WHERE row."isDeleted" = false AND piece.id IS NULL ${cursorPredicate}
            ORDER BY row."createdAt" DESC, row.id DESC
            LIMIT ${limit + 1}
          `);
          const orderedIds = orphanIds.map((row) => row.id);
          rows = orderedIds.length ? await prisma.receiveFromCutterMachineRow.findMany({
            where: { id: { in: orderedIds } },
            include: {
              bobbin: true,
              box: true,
              cutMaster: true,
              operator: true,
              helper: true,
              issue: { include: { machine: true } },
            },
          }) : [];
          const indexById = new Map(orderedIds.map((id, index) => [id, index]));
          rows.sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));
        } else if (pieceIds.length > 0) {
          rows = await prisma.receiveFromCutterMachineRow.findMany({
            where: { isDeleted: false, pieceId: { in: pieceIds } },
            include: {
              bobbin: true,
              box: true,
              cutMaster: true,
              operator: true,
              helper: true,
              issue: { include: { machine: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...(rowCursor ? { cursor: { id: rowCursor.afterId }, skip: 1 } : {}),
            take: limit + 1,
          });
        }
        const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
        const items = rows.map((row) => {
          const piece = pieceById.get(row.pieceId);
          const totalBobbins = Number(row.bobbinQuantity || 0);
          const issuedBobbins = Number(row.issuedBobbins || 0);
          const dispatchedBobbins = Number(row.dispatchedCount || 0);
          const netWeight = Number(row.netWt ?? row.totalKg ?? row.yarnWt ?? 0);
          const issuedWeight = Number(row.issuedBobbinWeight || 0);
          const availableWeight = Math.max(0, netWeight - issuedWeight - Number(row.dispatchedWeight || 0));
          return {
            ...row,
            lotNo,
            itemId: piece?.itemId || row.issue?.itemId || '',
            date: row.date || row.createdAt || '',
            bobbinQty: totalBobbins,
            dispatchedBobbins,
            availableBobbins: calcAvailableCountFromWeight({
              totalCount: totalBobbins,
              issuedCount: issuedBobbins,
              dispatchedCount: dispatchedBobbins,
              totalWeight: netWeight,
              availableWeight,
            }),
            netWeight,
            issuedWeight,
            availableWeight,
            cutName: row.cutMaster?.name || (typeof row.cut === 'string' ? row.cut : '') || '—',
            yarnName: row.yarnName || '—',
            bobbinName: row.bobbin?.name || row.pcsTypeName || '—',
          };
        });
        return res.json(buildStockRowPage(items, limit));
      }

      if (rowCursor) {
        const cursorPiece = await prisma.inboundItem.findUnique({
          where: { id: rowCursor.afterId },
          select: { lotNo: true },
        });
        if (!cursorPiece || cursorPiece.lotNo !== lotNo) {
          return res.status(400).json({ error: 'Cursor does not belong to this lot' });
        }
      }
      const pieces = await prisma.inboundItem.findMany({
        where: { lotNo },
        orderBy: [{ seq: 'asc' }, { id: 'asc' }],
        ...(rowCursor ? { cursor: { id: rowCursor.afterId }, skip: 1 } : {}),
        take: limit + 1,
      });
      const pagePieces = pieces.slice(0, limit);
      const pieceIds = pagePieces.map((piece) => piece.id);

      const [totals, issueCandidates, challans] = await Promise.all([
        pieceIds.length > 0
          ? prisma.receiveFromCutterMachinePieceTotal.findMany({ where: { pieceId: { in: pieceIds } } })
          : [],
        pieceIds.length > 0
          ? prisma.$queryRaw`
            WITH candidates AS (
              SELECT line."pieceId" AS piece_id, line."issueId" AS issue_id
              FROM "IssueToCutterMachineLine" line
              WHERE line."pieceId" = ANY(${pieceIds}::text[])
              UNION
              SELECT trim(header_piece.piece_id) AS piece_id, issue.id AS issue_id
              FROM "IssueToCutterMachine" issue
              CROSS JOIN LATERAL regexp_split_to_table(COALESCE(issue."pieceIds", ''), '\\s*,\\s*')
                AS header_piece(piece_id)
              WHERE trim(header_piece.piece_id) = ANY(${pieceIds}::text[])
            )
            SELECT DISTINCT ON (candidate.piece_id)
              candidate.piece_id AS "pieceId",
              issue.id AS "issueId",
              issue.date,
              cut.name AS "cutName",
              machine.name AS "machineName"
            FROM candidates candidate
            JOIN "IssueToCutterMachine" issue ON issue.id = candidate.issue_id
            LEFT JOIN "Cut" cut ON cut.id = issue."cutId"
            LEFT JOIN "Machine" machine ON machine.id = issue."machineId"
            WHERE issue."isDeleted" = false
            ORDER BY candidate.piece_id, issue."createdAt" DESC, issue.id DESC
          `
          : [],
        pieceIds.length > 0
          ? prisma.receiveFromCutterMachineChallan.findMany({
            where: { isDeleted: false, pieceId: { in: pieceIds }, wastageNetWeight: { gt: 0 } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
          : [],
      ]);
      const totalsByPiece = new Map(totals.map((row) => [row.pieceId, row]));
      const issueByPiece = new Map(issueCandidates.map((issue) => [issue.pieceId, issue]));
      const wastageNoteByPiece = new Map();
      for (const row of challans) {
        if (wastageNoteByPiece.has(row.pieceId)) continue;
        const note = String(row.wastageNote || '').split('—').slice(1).join('—').trim();
        if (note) wastageNoteByPiece.set(row.pieceId, note);
      }
      const items = pagePieces.map((piece) => {
        const aggregate = totalsByPiece.get(piece.id);
        const issue = issueByPiece.get(piece.id);
        const inboundWeight = Number(piece.weight || 0);
        const receivedWeight = Number(aggregate?.totalNetWeight || 0);
        const wastageWeight = Number(aggregate?.wastageNetWeight || 0);
        const dispatchedWeight = Number(piece.dispatchedWeight || 0);
        return {
          ...piece,
          pendingWeight: Math.max(0, inboundWeight - receivedWeight - wastageWeight - dispatchedWeight),
          receivedWeight,
          wastageWeight,
          wastageNote: wastageNoteByPiece.get(piece.id) || null,
          totalUnits: Number(aggregate?.totalBob || 0),
          issueableWeight: Math.max(0, inboundWeight - dispatchedWeight - Number(piece.issuedToCutterWeight || 0)),
          cutName: issue?.cutName || '',
          yarnName: '',
          issuedLabel: issue ? `Issued${issue.machineName ? `: ${issue.machineName}` : ''}${issue.date ? ` • ${issue.date}` : ''}` : '',
        };
      });
      const hasMore = pieces.length > limit;
      const last = items[items.length - 1];
      return res.json({
        items,
        hasMore,
        nextCursor: hasMore && last?.id
          ? Buffer.from(JSON.stringify({ afterId: last.id }), 'utf8').toString('base64')
          : null,
      });
    }

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
      const lotNos = Array.isArray(key.lotNos)
        ? Array.from(new Set(key.lotNos.map(String).filter(Boolean))).sort((a, b) => a.localeCompare(b))
        : [];
      const cursorRecord = rowCursor
        ? await prisma.receiveFromHoloMachineRow.findUnique({
          where: { id: rowCursor.afterId },
          select: { createdAt: true },
        })
        : null;
      if (rowCursor && !cursorRecord) return res.status(400).json({ error: 'Invalid cursor' });

      const rows = await prisma.$queryRaw`
        WITH cursor_row AS (
          SELECT "createdAt", id
          FROM "ReceiveFromHoloMachineRow"
          WHERE id = ${rowCursor?.afterId || ''}
        ), candidate_issues AS MATERIALIZED (
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
                 array_remove(array_agg(DISTINCT bi."lotNo" ORDER BY bi."lotNo"), NULL) AS lot_nos
          FROM issue_refs ir
          LEFT JOIN "ReceiveFromCutterMachineRow" cr ON cr.id = ir.cutter_row_id
          LEFT JOIN "InboundItem" bi ON bi.id = cr."pieceId"
          GROUP BY ir.issue_id
        ),
        issue_labels AS (
          SELECT ci.id AS issue_id,
                 CASE
                   WHEN COALESCE(array_length(il.lot_nos, 1), 0) = 0 THEN ARRAY[ci."lotNo"]::text[]
                   ELSE il.lot_nos
                 END AS lot_nos_final,
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
            AND (${lotNos.length} = 0 OR il.lot_nos_final = ${lotNos}::text[])
            AND (${rowCursor?.afterId || ''} = ''
              OR r."createdAt" < (SELECT "createdAt" FROM cursor_row)
              OR (r."createdAt" = (SELECT "createdAt" FROM cursor_row) AND r.id < (SELECT id FROM cursor_row)))
          ORDER BY r."createdAt" DESC, r.id DESC
          LIMIT ${limit + 1}
        ),
        issued AS (
          SELECT
            elem->>'rowId' AS row_id,
            SUM(COALESCE(NULLIF(elem->>'issueRolls', '')::numeric, NULLIF(elem->>'baseRolls', '')::numeric, 0)) AS issue_rolls,
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
          r."createdAt" AS created_at,
          r."barcode",
          COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD')) AS date,
          r."machineNo",
          rt.name AS roll_type_name,
          COALESCE(r."grossWeight", 0)::numeric AS gross_weight,
          COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))::numeric AS net_weight,
          LEAST(
            GREATEST(0, COALESCE(r."rollCount", 0)::numeric - COALESCE(r."dispatchedCount", 0)::numeric - (COALESCE(iss.issue_rolls, 0) + COALESCE(tb.tb_rolls, 0))::numeric),
            CASE
              WHEN COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))) <= 0
                THEN GREATEST(0, COALESCE(r."rollCount", 0)::numeric - COALESCE(r."dispatchedCount", 0)::numeric - (COALESCE(iss.issue_rolls, 0) + COALESCE(tb.tb_rolls, 0))::numeric)
              ELSE FLOOR((GREATEST(0, COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))::numeric - COALESCE(r."dispatchedWeight", 0)::numeric - (COALESCE(iss.issue_weight, 0) + COALESCE(tb.tb_weight, 0))::numeric)
                / COALESCE(r."rollWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) * COALESCE(r."rollCount", 0))
            END
          ) AS available_rolls,
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
        LEFT JOIN LATERAL (
          SELECT log.*
          FROM "BoilerSteamLog" log
          WHERE log."holoReceiveRowId" = r.id
             OR (log."barcode" IS NOT NULL AND upper(log."barcode") = upper(r."barcode"))
          ORDER BY (log."holoReceiveRowId" = r.id) DESC, log."steamedAt" DESC, log.id DESC
          LIMIT 1
        ) st ON true
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

      return res.json(buildStockRowPage(items, limit));
    }

    // coning rows
    const lotNo = String(key.lotNo || '');
    const itemId = String(key.itemId || '');
    const firmId = String(key.firmId || '');
    const supplierId = String(key.supplierId || '');
    const traceCutIds = Array.isArray(key.cutIds) ? key.cutIds.map(String).filter(Boolean) : [];
    const traceYarnIds = Array.isArray(key.yarnIds) ? key.yarnIds.map(String).filter(Boolean) : [];
    const traceTwistIds = Array.isArray(key.twistIds) ? key.twistIds.map(String).filter(Boolean) : [];
    const cursorRecord = rowCursor
      ? await prisma.receiveFromConingMachineRow.findUnique({
        where: { id: rowCursor.afterId },
        select: { createdAt: true },
      })
      : null;
    if (rowCursor && !cursorRecord) return res.status(400).json({ error: 'Invalid cursor' });

    const rows = await prisma.$queryRaw`
      WITH RECURSIVE cursor_row AS (
        SELECT "createdAt", id
        FROM "ReceiveFromConingMachineRow"
        WHERE id = ${rowCursor?.afterId || ''}
      ), root_issues AS MATERIALIZED (
        SELECT ic.*
        FROM "IssueToConingMachine" ic
        LEFT JOIN "Lot" lot ON lot."lotNo" = ic."lotNo"
        WHERE ic."isDeleted" = false
          AND ic."lotNo" = ${lotNo}
          AND ic."itemId" = ${itemId}
          AND COALESCE(lot."firmId", '') = ${firmId}
          AND COALESCE(lot."supplierId", '') = ${supplierId}
      ), lineage AS (
        SELECT ic.id AS root_issue_id, ic.id AS issue_id, ARRAY[ic.id]::text[] AS path, 0 AS depth
        FROM root_issues ic
        UNION ALL
        SELECT l.root_issue_id, parent.id, l.path || parent.id, l.depth + 1
        FROM lineage l
        JOIN "IssueToConingMachine" current_issue ON current_issue.id = l.issue_id
        JOIN LATERAL jsonb_array_elements(COALESCE(current_issue."receivedRowRefs", '[]'::jsonb)) elem ON true
        JOIN "ReceiveFromConingMachineRow" parent_row ON parent_row.id = elem->>'rowId' AND parent_row."isDeleted" = false
        JOIN "IssueToConingMachine" parent ON parent.id = parent_row."issueId" AND parent."isDeleted" = false
        WHERE NOT parent.id = ANY(l.path) AND l.depth < 32
      ),
      trace AS (
        SELECT
          l.root_issue_id AS issue_id,
          CASE WHEN count(hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."cutId" ORDER BY hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."cutId" ORDER BY ic."cutId"), NULL) END AS cut_ids,
          CASE WHEN count(hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."yarnId" ORDER BY hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."yarnId" ORDER BY ic."yarnId"), NULL) END AS yarn_ids,
          CASE WHEN count(hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."twistId" ORDER BY hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."twistId" ORDER BY ic."twistId"), NULL) END AS twist_ids
        FROM lineage l
        JOIN "IssueToConingMachine" ic ON ic.id = l.issue_id
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem ON true
        LEFT JOIN "ReceiveFromHoloMachineRow" hr ON hr.id = elem->>'rowId'
        LEFT JOIN "IssueToHoloMachine" hi ON hi.id = hr."issueId"
        GROUP BY l.root_issue_id
      ),
      candidate_rows AS MATERIALIZED (
        SELECT r.*
        FROM "ReceiveFromConingMachineRow" r
        JOIN root_issues i ON i.id = r."issueId"
        LEFT JOIN trace tr ON tr.issue_id = i.id
        WHERE r."isDeleted" = false
          AND (${traceCutIds.length} = 0 OR (COALESCE(tr.cut_ids, ARRAY[]::text[]) @> ${traceCutIds}::text[] AND COALESCE(tr.cut_ids, ARRAY[]::text[]) <@ ${traceCutIds}::text[]))
          AND (${traceYarnIds.length} = 0 OR (COALESCE(tr.yarn_ids, ARRAY[]::text[]) @> ${traceYarnIds}::text[] AND COALESCE(tr.yarn_ids, ARRAY[]::text[]) <@ ${traceYarnIds}::text[]))
          AND (${traceTwistIds.length} = 0 OR (COALESCE(tr.twist_ids, ARRAY[]::text[]) @> ${traceTwistIds}::text[] AND COALESCE(tr.twist_ids, ARRAY[]::text[]) <@ ${traceTwistIds}::text[]))
          AND (${rowCursor?.afterId || ''} = ''
            OR r."createdAt" < (SELECT "createdAt" FROM cursor_row)
            OR (r."createdAt" = (SELECT "createdAt" FROM cursor_row) AND r.id < (SELECT id FROM cursor_row)))
        ORDER BY r."createdAt" DESC, r.id DESC
        LIMIT ${limit + 1}
      ),
      issued AS (
        SELECT elem->>'rowId' AS row_id,
               SUM(COALESCE(NULLIF(elem->>'issueRolls', '')::numeric, NULLIF(elem->>'baseRolls', '')::numeric, 0)) AS issue_count,
               SUM(COALESCE(NULLIF(elem->>'issueWeight', '')::numeric, 0)) AS issue_weight
        FROM "IssueToConingMachine" ic
        JOIN LATERAL jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem ON true
        JOIN candidate_rows cr ON cr.id = elem->>'rowId'
        WHERE ic."isDeleted" = false
        GROUP BY elem->>'rowId'
      ),
      takeback AS (
        SELECT l."sourceId" AS row_id,
               SUM((CASE WHEN tb."isReverse" THEN 1 ELSE -1 END) * l."count") AS count_delta,
               SUM((CASE WHEN tb."isReverse" THEN 1 ELSE -1 END) * l."weight") AS weight_delta
        FROM "IssueTakeBackLine" l
        JOIN "IssueTakeBack" tb ON tb.id = l."takeBackId"
        JOIN candidate_rows cr ON cr.id = l."sourceId"
        WHERE tb.stage = 'coning'
        GROUP BY l."sourceId"
      ),
      cone_types AS (
        SELECT
          i.id AS issue_id,
          array_remove(array_agg(DISTINCT COALESCE(ct.name, NULL)), NULL) AS cone_type_names
        FROM candidate_rows cr
        JOIN "IssueToConingMachine" i ON i.id = cr."issueId"
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem ON true
        LEFT JOIN "ConeType" ct ON ct.id = elem->>'coneTypeId'
        GROUP BY i.id
      )
      SELECT
        r.id,
        r."createdAt" AS created_at,
        r."barcode",
        COALESCE(r."date", to_char(r."createdAt", 'YYYY-MM-DD')) AS date,
        bx.name AS box_name,
        COALESCE(array_to_string(cts.cone_type_names, ', '), '—') AS cone_type_name,
        LEAST(
          GREATEST(0, COALESCE(r."coneCount", 0)::numeric - COALESCE(r."dispatchedCount", 0)::numeric - COALESCE(iss.issue_count, 0) - COALESCE(tb.count_delta, 0)),
          CASE
            WHEN COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) <= 0
              THEN GREATEST(0, COALESCE(r."coneCount", 0)::numeric - COALESCE(r."dispatchedCount", 0)::numeric - COALESCE(iss.issue_count, 0) - COALESCE(tb.count_delta, 0))
            ELSE FLOOR((GREATEST(0, COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0)))) - COALESCE(r."dispatchedWeight", 0) - COALESCE(iss.issue_weight, 0) - COALESCE(tb.weight_delta, 0))
              / COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))))) * COALESCE(r."coneCount", 0))
          END
        ) AS available_cones,
        COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))))::numeric AS net_weight,
        COALESCE(r."grossWeight", 0)::numeric AS gross_weight,
        GREATEST(0, COALESCE(r."netWeight", COALESCE(r."coneWeight", (COALESCE(r."grossWeight", 0) - COALESCE(r."tareWeight", 0))))::numeric - COALESCE(r."dispatchedWeight", 0)::numeric - COALESCE(iss.issue_weight, 0) - COALESCE(tb.weight_delta, 0)) AS available_weight,
        COALESCE(r."machineNo", mc.name, '—') AS machine_name,
        COALESCE(op.name, '—') AS operator_name,
        r."notes" AS notes
      FROM candidate_rows r
      JOIN "IssueToConingMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
      LEFT JOIN cone_types cts ON cts.issue_id = i.id
      LEFT JOIN issued iss ON iss.row_id = r.id
      LEFT JOIN takeback tb ON tb.row_id = r.id
      LEFT JOIN "Box" bx ON bx.id = r."boxId"
      LEFT JOIN "Machine" mc ON mc.id = i."machineId"
      LEFT JOIN "Operator" op ON op.id = r."operatorId"
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

    return res.json(buildStockRowPage(items, limit));
  } catch (err) {
    console.error('v2 stock lot-rows error', err);
    res.status(500).json({ error: err.message || 'Failed to load lot rows' });
  }
});

router.get('/stock/:process/barcode-lot-keys', requireAuth, requirePermission('stock', PERM_READ), async (req, res) => {
  try {
    const process = String(req.params.process || '').trim().toLowerCase();
    if (!['cutter', 'holo', 'coning'].includes(process)) {
      return res.status(400).json({ error: 'Invalid process' });
    }
    const q = String(req.query?.q || '').trim();
    if (!q) return res.json({ keys: [] });

    if (process === 'cutter') {
      const view = String(req.query.view || 'jumbo').trim().toLowerCase();
      if (!['jumbo', 'bobbins'].includes(view)) return res.status(400).json({ error: 'Invalid cutter stock view' });
      if (view === 'jumbo') {
        const pieces = await prisma.inboundItem.findMany({
          where: { barcode: { contains: q, mode: 'insensitive' } },
          select: { lotNo: true },
          distinct: ['lotNo'],
          take: 50,
        });
        return res.json({ keys: pieces.map((piece) => encodeStockLotKey({ v: 1, process, view, lotNo: piece.lotNo })) });
      }
      const rows = await prisma.receiveFromCutterMachineRow.findMany({
        where: {
          isDeleted: false,
          OR: [
            { barcode: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { pieceId: true },
        take: 100,
      });
      const pieceIds = [...new Set(rows.map((row) => row.pieceId).filter(Boolean))];
      const pieces = pieceIds.length > 0
        ? await prisma.inboundItem.findMany({ where: { id: { in: pieceIds } }, select: { lotNo: true }, distinct: ['lotNo'], take: 50 })
        : [];
      return res.json({ keys: pieces.map((piece) => encodeStockLotKey({ v: 1, process, view, lotNo: piece.lotNo })) });
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
                 array_remove(array_agg(DISTINCT bi."lotNo" ORDER BY bi."lotNo"), NULL) AS lot_nos
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
          il.lot_nos_final,
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
        const lotNos = Array.isArray(r.lot_nos)
          ? Array.from(new Set(r.lot_nos.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)))
          : [];
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
          lotNos,
          isMixed,
        });
      });

      return res.json({ keys });
    }

    // coning
    const rows = await prisma.$queryRaw`
      WITH RECURSIVE lineage AS (
        SELECT ic.id AS root_issue_id, ic.id AS issue_id, ARRAY[ic.id]::text[] AS path, 0 AS depth
        FROM "IssueToConingMachine" ic
        WHERE ic."isDeleted" = false
        UNION ALL
        SELECT l.root_issue_id, parent.id, l.path || parent.id, l.depth + 1
        FROM lineage l
        JOIN "IssueToConingMachine" current_issue ON current_issue.id = l.issue_id
        JOIN LATERAL jsonb_array_elements(COALESCE(current_issue."receivedRowRefs", '[]'::jsonb)) elem ON true
        JOIN "ReceiveFromConingMachineRow" parent_row ON parent_row.id = elem->>'rowId' AND parent_row."isDeleted" = false
        JOIN "IssueToConingMachine" parent ON parent.id = parent_row."issueId" AND parent."isDeleted" = false
        WHERE NOT parent.id = ANY(l.path) AND l.depth < 32
      ),
      trace AS (
        SELECT
          l.root_issue_id AS issue_id,
          CASE WHEN count(hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."cutId" ORDER BY hi."cutId") FILTER (WHERE hi."cutId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."cutId" ORDER BY ic."cutId"), NULL) END AS cut_ids,
          CASE WHEN count(hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."yarnId" ORDER BY hi."yarnId") FILTER (WHERE hi."yarnId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."yarnId" ORDER BY ic."yarnId"), NULL) END AS yarn_ids,
          CASE WHEN count(hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL) > 0
            THEN array_remove(array_agg(DISTINCT hi."twistId" ORDER BY hi."twistId") FILTER (WHERE hi."twistId" IS NOT NULL), NULL)
            ELSE array_remove(array_agg(DISTINCT ic."twistId" ORDER BY ic."twistId"), NULL) END AS twist_ids
        FROM lineage l
        JOIN "IssueToConingMachine" ic ON ic.id = l.issue_id
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(ic."receivedRowRefs", '[]'::jsonb)) elem ON true
        LEFT JOIN "ReceiveFromHoloMachineRow" hr ON hr.id = elem->>'rowId'
        LEFT JOIN "IssueToHoloMachine" hi ON hi.id = hr."issueId"
        GROUP BY l.root_issue_id
      )
      SELECT
        i."lotNo" AS lot_no,
        i."itemId" AS item_id,
        lot."firmId" AS firm_id,
        lot."supplierId" AS supplier_id,
        COALESCE(tr.cut_ids, ARRAY[]::text[]) AS cut_ids,
        COALESCE(tr.yarn_ids, ARRAY[]::text[]) AS yarn_ids,
        COALESCE(tr.twist_ids, ARRAY[]::text[]) AS twist_ids
      FROM "ReceiveFromConingMachineRow" r
      JOIN "IssueToConingMachine" i ON i.id = r."issueId" AND i."isDeleted" = false
      LEFT JOIN trace tr ON tr.issue_id = i.id
      LEFT JOIN "Lot" lot ON lot."lotNo" = i."lotNo"
      WHERE r."isDeleted" = false
        AND (r."barcode" ILIKE ${'%' + q + '%'} OR r."notes" ILIKE ${'%' + q + '%'})
      GROUP BY i."lotNo", i."itemId", lot."firmId", lot."supplierId", tr.cut_ids, tr.yarn_ids, tr.twist_ids
      LIMIT 50
    `;

    const keys = (rows || []).map((r) => {
      const yarnIds = Array.isArray(r.yarn_ids)
        ? r.yarn_ids.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
        : [];
      return encodeStockLotKey({
        v: 1,
        process: 'coning',
        lotNo: r.lot_no || '',
        itemId: r.item_id || '',
        yarnId: yarnIds.length === 1 ? yarnIds[0] : null,
        firmId: r.firm_id || '',
        supplierId: r.supplier_id || '',
        cutIds: Array.isArray(r.cut_ids) ? r.cut_ids.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [],
        yarnIds,
        twistIds: Array.isArray(r.twist_ids) ? r.twist_ids.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))) : [],
      });
    });

    return res.json({ keys });
  } catch (err) {
    console.error('v2 stock barcode-lot-keys error', err);
    res.status(500).json({ error: err.message || 'Failed to lookup barcode lot keys' });
  }
});

export default router;
