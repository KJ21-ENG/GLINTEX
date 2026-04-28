import archiver from 'archiver';
import multer from 'multer';
import XLSX from 'xlsx';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole, requirePermission, requireEditPermission, requireDeletePermission } from '../middleware/auth.js';
import whatsapp from '../../whatsapp/service.js';
import telegram from '../../telegram/service.js';
import { interpolateTemplate, getTemplateByEvent, listTemplates, upsertTemplate } from '../utils/whatsappTemplates.js';
import { appendCreatorToCaption, getNotificationChannelConfig, persistNotificationDeliveryLogs, resolveTelegramRecipients, resolveTemplateTelegramRecipients, resolveWhatsappRecipients, sendNotification } from '../utils/notifications.js';
import { logCrud } from '../utils/auditLogger.js';
import { clearSessionCookie, generateSessionToken, getSessionCookieOptions, getSessionExpiryDate, hashPassword, normalizeUsername, verifyPassword, SESSION_COOKIE_NAME } from '../utils/auth.js';
import { ACCESS_LEVELS, buildEffectivePermissions, normalizePermissions } from '../utils/permissions.js';
import { ensureDefaultAdminUser } from '../utils/defaultAdmin.js';
import bwipjs from 'bwip-js';
import { deriveMaterialCodeFromItem, makeInboundBarcode, makeIssueBarcode, makeReceiveBarcode, parseReceiveCrateIndex, makeHoloIssueBarcode, makeHoloReceiveBarcode, makeConingIssueBarcode, makeConingReceiveBarcode, parseHoloSeries, parseConingSeries, parseLegacyReceiveBarcode } from '../utils/barcodeHelpers.js';
import { createBackup, listBackups, getBackupPath, normalizeBackupTime, updateBackupScheduleTime } from '../utils/backup.js';
import { getDiskUsage } from '../utils/diskSpace.js';
import { createGoogleDriveAuthUrl, disconnectGoogleDrive, getGoogleDriveStatus, handleGoogleDriveCallback, listDriveBackups } from '../utils/googleDrive.js';
import { generateSummaryPDF, generateProductionDailyExportPdf, generateHoloWeeklyExportPdf } from '../utils/pdf/index.js';
import { buildProductionDailyExportData } from '../utils/pdf/productionDailyExportData.js';
import { enumerateDatesInclusive, mapWithConcurrency, parseDateOnly, validateProductionDailyExportRequest } from '../utils/productionDailyExport.js';
import { buildHoloWeeklyExportData } from '../utils/holoWeeklyExport.js';
import { getBaseMachineName } from '../utils/machineGrouping.js';
import { resolveUserFields, clearUserCache } from '../utils/userResolver.js';
import v2Router from './v2.js';
import { perfLog, isPerfLogEnabled } from '../lib/perfLog.js';

async function timedTransaction(label, lineCount, fn) {
  if (!isPerfLogEnabled()) return prisma.$transaction(fn);
  const startNs = process.hrtime.bigint();
  try {
    const result = await prisma.$transaction(fn);
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    perfLog('txn', { label, lineCount, durationMs: Math.round(durationMs * 1000) / 1000, ok: true });
    return result;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    perfLog('txn', { label, lineCount, durationMs: Math.round(durationMs * 1000) / 1000, ok: false, error: String(err?.message || err).slice(0, 200) });
    throw err;
  }
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const RECEIVE_ROWS_FETCH_LIMIT = 5000;
const RECEIVE_UPLOADS_FETCH_LIMIT = 100;
const PERM_READ = ACCESS_LEVELS.READ;
const PERM_WRITE = ACCESS_LEVELS.WRITE;
const TAKE_BACK_EPSILON = 1e-6;
const TAKE_BACK_STAGES = ['cutter', 'holo', 'coning'];

let bootstrapToken = null;

// v2 performance endpoints (cursor pagination, server-side filtering, facets, export)
router.use('/api/v2', v2Router);

function normalizeBarcodeInput(value) {
  return String(value || '').trim().toUpperCase();
}

function parsePieceIdsCsv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

async function buildCutterIssueMachineMap(pieceIds) {
  const uniquePieceIds = Array.from(new Set((pieceIds || []).filter(Boolean)));
  if (uniquePieceIds.length === 0) return new Map();
  const orFilters = uniquePieceIds.map(id => ({ pieceIds: { contains: id } }));
  const issues = await prisma.issueToCutterMachine.findMany({
    where: { OR: orFilters, isDeleted: false },
    include: { machine: true },
    orderBy: { createdAt: 'desc' },
  });
  const map = new Map();
  for (const issue of issues) {
    const ids = parsePieceIdsCsv(issue.pieceIds);
    const machineName = issue.machine?.name || null;
    ids.forEach((id) => {
      if (!map.has(id) && machineName) {
        map.set(id, machineName);
      }
    });
  }
  return map;
}

function buildLegacyReceiveBarcode(prefix, lotNo, crateIndex) {
  if (!lotNo || typeof lotNo !== 'string') return null;
  const match = lotNo.trim().toUpperCase().match(/^OP-(\d+)$/);
  if (!match) return null;
  const lotPart = match[1].padStart(3, '0');
  if (!Number.isFinite(crateIndex)) return null;
  const cratePart = String(crateIndex).padStart(3, '0');
  return `${prefix}-OP-${lotPart}-C${cratePart}`;
}

async function resolveLegacyReceiveRow(barcode, options = {}) {
  const parsed = parseLegacyReceiveBarcode(barcode);
  if (!parsed) return null;
  const { stage, lotNo, crateIndex } = parsed;
  const baseWhere = { issue: { lotNo }, isDeleted: false };
  const query = { ...options, where: { ...baseWhere, ...(options.where || {}) } };
  const rows = stage === 'coning'
    ? await prisma.receiveFromConingMachineRow.findMany(query)
    : await prisma.receiveFromHoloMachineRow.findMany(query);
  const matches = rows.filter(row => parseReceiveCrateIndex(row.barcode) === crateIndex);
  if (matches.length === 1) return { stage, row: matches[0] };
  if (matches.length > 1) return { stage, error: 'ambiguous' };
  return { stage, error: 'not_found' };
}

function dropDuplicateLegacyBarcodes(items = []) {
  const counts = new Map();
  items.forEach((item) => {
    if (item.legacyBarcode) {
      counts.set(item.legacyBarcode, (counts.get(item.legacyBarcode) || 0) + 1);
    }
  });
  if (counts.size === 0) return items;
  return items.map((item) => {
    if (!item.legacyBarcode) return item;
    if ((counts.get(item.legacyBarcode) || 0) <= 1) return item;
    return { ...item, legacyBarcode: null };
  });
}

async function resolveHoloIssuePieceIds(issue) {
  if (!issue) return [];
  let refs = issue.receivedRowRefs;
  if (typeof refs === 'string') {
    try { refs = JSON.parse(refs || '[]'); } catch (_) { refs = []; }
  }
  if (!Array.isArray(refs)) refs = [];

  const rowIds = refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
  const rows = rowIds.length > 0
    ? await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: rowIds }, isDeleted: false },
      select: { pieceId: true },
    })
    : [];
  const pieceIds = Array.from(new Set(rows.map(r => r.pieceId).filter(Boolean)));
  if (pieceIds.length > 0) return pieceIds;

  if (!issue.lotNo) return [];
  const inboundPieces = await prisma.inboundItem.findMany({
    where: { lotNo: issue.lotNo },
    select: { id: true },
  });
  if (inboundPieces.length === 1) return [inboundPieces[0].id];
  return [];
}

async function isHoloRowReferencedByConing({ rowId, barcode }) {
  const rowIdArray = rowId ? [rowId] : ['__none__'];
  const barcodeArray = barcode ? [String(barcode)] : ['__none__'];
  const coningUsage = await prisma.$queryRaw`
    SELECT id FROM "IssueToConingMachine"
    WHERE "isDeleted" = false
      AND EXISTS (
      SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
      WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
         OR elem->>'barcode' = ANY (${barcodeArray}::text[])
    )
  `;
  return Array.isArray(coningUsage) && coningUsage.length > 0;
}

function normalizePieceId(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;
  // Treat underscore as dash so CSVs using 12_5 map to 12-5
  const normalizedSeparators = cleaned.replace(/_/g, '-');
  const parts = normalizedSeparators.split('-').map(p => p.trim()).filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[0])) {
    const lot = parts[0].padStart(3, '0');
    const seqPart = parts[1];
    if (/^\d+$/.test(seqPart)) {
      const seq = String(Number(seqPart));
      return `${lot}-${seq}`;
    }
    return `${lot}-${seqPart}`;
  }
  return normalizedSeparators;
}

function toNumber(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim().replace(/,/g, '');
  if (str === '') return null;
  const num = Number(str);
  if (!Number.isFinite(num)) return null;
  return num;
}

function toInt(val) {
  const num = toNumber(val);
  if (num === null) return null;
  const rounded = Math.round(num);
  return Number.isFinite(rounded) ? rounded : null;
}

function normalizeCutMatcherValue(cutId) {
  const normalized = String(cutId || '').trim();
  return normalized || 'ANY';
}

function normalizeBaseMachineValue(value) {
  return getBaseMachineName(String(value || '').trim());
}

// Round weight value to 3 decimal places for consistent storage
function roundTo3Decimals(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function normalizeTakeBackStage(stage) {
  const normalized = String(stage || '').trim().toLowerCase();
  return TAKE_BACK_STAGES.includes(normalized) ? normalized : null;
}

function parseJsonArraySafe(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampZero(val) {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return 0;
  return num <= TAKE_BACK_EPSILON ? 0 : num;
}

function toStrictPositiveWeight(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return roundTo3Decimals(num);
}

function toNonNegativeInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function deriveHoloIssuedWeightFromCount({ bobbinQuantity, netWeight, issuedBobbins }) {
  const totalCount = Number(bobbinQuantity || 0);
  const totalWeight = Number(netWeight || 0);
  const requestedCount = Number(issuedBobbins || 0);
  if (!Number.isFinite(totalCount) || totalCount <= 0) return 0;
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return 0;
  if (!Number.isFinite(requestedCount) || requestedCount <= 0) return 0;
  const perBobbinWeight = totalWeight / totalCount;
  return perBobbinWeight * requestedCount;
}

function resolveHoloIssuedWeight({ requestedCount, availableCount, availableWeight, requestedWeight }) {
  const normalizedRequestedCount = Number(requestedCount || 0);
  const normalizedAvailableCount = Number(availableCount || 0);
  const normalizedAvailableWeight = Math.max(0, Number(availableWeight || 0));
  const normalizedRequestedWeight = Math.max(0, Number(requestedWeight || 0));
  const takingAllRemainingBobbins = (
    Number.isFinite(normalizedAvailableCount)
    && normalizedAvailableCount > 0
    && normalizedRequestedCount === normalizedAvailableCount
  );

  // If the user is taking every remaining bobbin from a crate, assign the exact
  // remaining weight to this issue so earlier 3-decimal allocations do not block
  // a full depletion of the crate.
  return {
    takingAllRemainingBobbins,
    issuedWeight: takingAllRemainingBobbins
      ? normalizedAvailableWeight
      : roundTo3Decimals(normalizedRequestedWeight),
  };
}

function getIssueModelByStage(stage) {
  if (stage === 'holo') return 'issueToHoloMachine';
  if (stage === 'coning') return 'issueToConingMachine';
  return 'issueToCutterMachine';
}

function getIssuePermissionKeyByStage(stage) {
  if (stage === 'holo') return 'issue.holo';
  if (stage === 'coning') return 'issue.coning';
  return 'issue.cutter';
}

function normalizeTakeBackLines(lines = []) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      sourceId: typeof line?.sourceId === 'string' ? line.sourceId.trim() : '',
      sourceBarcode: typeof line?.sourceBarcode === 'string' ? line.sourceBarcode.trim() : '',
      count: toNonNegativeInt(line?.count),
      weight: toStrictPositiveWeight(line?.weight) || 0,
      meta: line?.meta && typeof line.meta === 'object' ? line.meta : {},
    }))
    .filter((line) => line.sourceId);
}

function aggregateTakeBackLinesBySource(lines = []) {
  const aggregated = new Map();
  for (const line of lines) {
    const sourceId = String(line?.sourceId || '').trim();
    if (!sourceId) continue;
    const current = aggregated.get(sourceId) || {
      sourceId,
      sourceBarcode: line?.sourceBarcode || '',
      count: 0,
      weight: 0,
    };
    if (!current.sourceBarcode && line?.sourceBarcode) {
      current.sourceBarcode = line.sourceBarcode;
    }
    current.count += Number(line?.count || 0);
    current.weight += Number(line?.weight || 0);
    aggregated.set(sourceId, current);
  }
  return Array.from(aggregated.values()).map((line) => ({
    ...line,
    count: toNonNegativeInt(line.count),
    weight: roundTo3Decimals(line.weight),
  }));
}

async function listIssueTakeBacksForStage(client, stage, issueId = null) {
  const where = {
    stage,
    ...(issueId ? { issueId } : {}),
  };
  return await client.issueTakeBack.findMany({
    where,
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function getIssueTakeBackSnapshot(client, stage, issueId) {
  const rows = await listIssueTakeBacksForStage(client, stage, issueId);
  const activeBySource = new Map();
  const effectiveBySource = new Map();
  let activeCount = 0;
  let activeWeight = 0;
  let effectiveCount = 0;
  let effectiveWeight = 0;

  rows.forEach((row) => {
    const sign = row.isReverse ? -1 : 1;
    const rowCount = Number(row.totalCount || 0);
    const rowWeight = Number(row.totalWeight || 0);
    effectiveCount += sign * rowCount;
    effectiveWeight += sign * rowWeight;

    if (!row.isReverse && !row.isReversed) {
      activeCount += rowCount;
      activeWeight += rowWeight;
      (Array.isArray(row.lines) ? row.lines : []).forEach((line) => {
        const current = activeBySource.get(line.sourceId) || { count: 0, weight: 0 };
        current.count += Number(line.count || 0);
        current.weight += Number(line.weight || 0);
        activeBySource.set(line.sourceId, current);
      });
    }

    (Array.isArray(row.lines) ? row.lines : []).forEach((line) => {
      const current = effectiveBySource.get(line.sourceId) || { count: 0, weight: 0 };
      current.count += sign * Number(line.count || 0);
      current.weight += sign * Number(line.weight || 0);
      effectiveBySource.set(line.sourceId, current);
    });
  });

  return {
    rows,
    activeCount: clampZero(activeCount),
    activeWeight: clampZero(activeWeight),
    effectiveCount: clampZero(effectiveCount),
    effectiveWeight: clampZero(effectiveWeight),
    activeBySource,
    effectiveBySource,
  };
}

async function getIssueOriginalIssued(client, stage, issue) {
  const sourceMap = new Map();
  let totalCount = 0;
  let totalWeight = 0;

  if (!issue) {
    return { totalCount: 0, totalWeight: 0, sourceMap };
  }

  if (stage === 'cutter') {
    const lines = Array.isArray(issue.lines) && issue.lines.length > 0
      ? issue.lines
      : await client.issueToCutterMachineLine.findMany({
        where: { issueId: issue.id },
        select: { pieceId: true, issuedWeight: true },
      });

    if (lines.length > 0) {
      lines.forEach((line) => {
        const sourceId = String(line.pieceId || '').trim();
        if (!sourceId) return;
        const issuedWeight = Number(line.issuedWeight || 0);
        const current = sourceMap.get(sourceId) || { count: 0, weight: 0, sourceBarcode: null };
        current.count += 1;
        current.weight += issuedWeight;
        sourceMap.set(sourceId, current);
        totalWeight += issuedWeight;
      });
      totalCount = Number(issue.count || 0) || Array.from(sourceMap.values()).reduce((sum, line) => sum + Number(line.count || 0), 0);
    } else {
      const pieceIds = parsePieceIdsCsv(issue.pieceIds);
      const pieces = pieceIds.length
        ? await client.inboundItem.findMany({
          where: { id: { in: pieceIds } },
          select: { id: true, weight: true, barcode: true },
        })
        : [];
      const byId = new Map(pieces.map((piece) => [piece.id, piece]));
      pieceIds.forEach((pieceId) => {
        const piece = byId.get(pieceId);
        const current = sourceMap.get(pieceId) || { count: 0, weight: 0, sourceBarcode: piece?.barcode || null };
        current.count += 1;
        current.weight += Number(piece?.weight || 0);
        sourceMap.set(pieceId, current);
      });
      totalCount = Number(issue.count || 0) || pieceIds.length;
      totalWeight = Number(issue.totalWeight || 0) || Array.from(sourceMap.values()).reduce((sum, line) => sum + Number(line.weight || 0), 0);
    }
    return {
      totalCount: clampZero(totalCount),
      totalWeight: clampZero(totalWeight),
      sourceMap,
    };
  }

  if (stage === 'holo') {
    const refs = parseJsonArraySafe(issue.receivedRowRefs);
    refs.forEach((ref) => {
      const sourceId = typeof ref?.rowId === 'string' ? ref.rowId.trim() : '';
      if (!sourceId) return;
      const count = Number(ref?.issuedBobbins || 0);
      const weight = Number(ref?.issuedBobbinWeight || 0);
      const current = sourceMap.get(sourceId) || { count: 0, weight: 0, sourceBarcode: typeof ref?.barcode === 'string' ? ref.barcode : null };
      current.count += count;
      current.weight += weight;
      sourceMap.set(sourceId, current);
      totalCount += count;
      totalWeight += weight;
    });
    totalCount = totalCount > 0 ? totalCount : Number(issue.metallicBobbins || 0);
    totalWeight = totalWeight > 0 ? totalWeight : Number(issue.metallicBobbinsWeight || 0);
    return {
      totalCount: clampZero(totalCount),
      totalWeight: clampZero(totalWeight),
      sourceMap,
    };
  }

  const refs = parseJsonArraySafe(issue.receivedRowRefs);
  refs.forEach((ref) => {
    const sourceId = typeof ref?.rowId === 'string' ? ref.rowId.trim() : '';
    if (!sourceId) return;
    const count = Number(ref?.issueRolls || 0);
    const weight = Number(ref?.issueWeight || 0);
    const current = sourceMap.get(sourceId) || { count: 0, weight: 0, sourceBarcode: typeof ref?.barcode === 'string' ? ref.barcode : null };
    current.count += count;
    current.weight += weight;
    sourceMap.set(sourceId, current);
    totalCount += count;
    totalWeight += weight;
  });
  totalCount = totalCount > 0 ? totalCount : Number(issue.rollsIssued || 0);
  return {
    totalCount: clampZero(totalCount),
    totalWeight: clampZero(totalWeight),
    sourceMap,
  };
}

async function getIssueReceivedAndWastage(client, stage, issue) {
  const receivedBySource = new Map();
  const wastageBySource = new Map();
  let receivedCount = 0;
  let receivedWeight = 0;
  let wastageCount = 0;
  let wastageWeight = 0;

  if (!issue) {
    return { receivedCount, receivedWeight, wastageCount, wastageWeight, receivedBySource, wastageBySource };
  }

  if (stage === 'cutter') {
    const linkedRows = await client.receiveFromCutterMachineRow.findMany({
      where: { issueId: issue.id, isDeleted: false },
      select: { pieceId: true, bobbinQuantity: true, netWt: true },
    });

    let fallbackRows = [];
    const pieceIds = parsePieceIdsCsv(issue.pieceIds);
    if (pieceIds.length > 0) {
      fallbackRows = await client.receiveFromCutterMachineRow.findMany({
        where: {
          issueId: null,
          pieceId: { in: pieceIds },
          isDeleted: false,
          createdAt: { gte: issue.createdAt },
        },
        select: { pieceId: true, bobbinQuantity: true, netWt: true },
      });
    }
    const rows = [...linkedRows, ...fallbackRows];

    rows.forEach((row) => {
      const sourceId = String(row.pieceId || '').trim();
      if (!sourceId) return;
      const rowCount = Number(row.bobbinQuantity || 0);
      const rowWeight = Number(row.netWt || 0);
      receivedCount += rowCount;
      receivedWeight += rowWeight;
      const current = receivedBySource.get(sourceId) || { count: 0, weight: 0 };
      current.count += rowCount;
      current.weight += rowWeight;
      receivedBySource.set(sourceId, current);
    });

    if (pieceIds.length > 0) {
      const issueLinesForPieces = await client.issueToCutterMachineLine.findMany({
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
      issueLinesForPieces.forEach((line) => {
        const sourceId = String(line.pieceId || '').trim();
        if (!sourceId) return;
        const createdAtMs = Number.isFinite(new Date(line.issue?.createdAt || 0).getTime())
          ? new Date(line.issue?.createdAt || 0).getTime()
          : 0;
        const list = issuesByPiece.get(sourceId) || [];
        list.push({ issueId: line.issueId, createdAtMs });
        issuesByPiece.set(sourceId, list);
      });
      issuesByPiece.forEach((list, sourceId) => {
        const dedup = Array.from(new Map(list.map((entry) => [entry.issueId, entry])).values());
        dedup.sort((a, b) => a.createdAtMs - b.createdAtMs || String(a.issueId).localeCompare(String(b.issueId)));
        issuesByPiece.set(sourceId, dedup);
      });

      const wastageRows = await client.receiveFromCutterMachineChallan.findMany({
        where: {
          pieceId: { in: pieceIds },
          isDeleted: false,
          createdAt: { gte: issue.createdAt },
        },
        select: {
          pieceId: true,
          wastageNetWeight: true,
          createdAt: true,
        },
      });

      wastageRows.forEach((row) => {
        const sourceId = String(row.pieceId || '').trim();
        if (!sourceId) return;
        const challanAtMs = Number.isFinite(new Date(row.createdAt || 0).getTime())
          ? new Date(row.createdAt || 0).getTime()
          : Number.MAX_SAFE_INTEGER;
        const issueCandidates = issuesByPiece.get(sourceId) || [];
        // Deterministically attribute each challan wastage to exactly one issue for a piece
        // (latest issue created on or before challan time) to avoid multi-issue double-counting.
        const assigned = [...issueCandidates]
          .reverse()
          .find((candidate) => candidate.createdAtMs <= challanAtMs);
        if (!assigned || assigned.issueId !== issue.id) return;
        const rowWastageWeight = Number(row.wastageNetWeight || 0);
        if (rowWastageWeight <= 0) return;
        wastageWeight += rowWastageWeight;
        const current = wastageBySource.get(sourceId) || { count: 0, weight: 0 };
        current.weight += rowWastageWeight;
        wastageBySource.set(sourceId, current);
      });
    }

    return {
      receivedCount: clampZero(receivedCount),
      receivedWeight: clampZero(receivedWeight),
      wastageCount: clampZero(wastageCount),
      wastageWeight: clampZero(wastageWeight),
      receivedBySource,
      wastageBySource,
    };
  }

  if (stage === 'holo') {
    const rows = await client.receiveFromHoloMachineRow.findMany({
      where: { issueId: issue.id, isDeleted: false },
      select: {
        rollCount: true,
        rollWeight: true,
        grossWeight: true,
        tareWeight: true,
        rollType: { select: { name: true } },
      },
    });

    rows.forEach((row) => {
      const count = Number(row.rollCount || 0);
      const weight = Number.isFinite(Number(row.rollWeight))
        ? Number(row.rollWeight)
        : Number(row.grossWeight || 0) - Number(row.tareWeight || 0);
      const isWastage = String(row.rollType?.name || '').toLowerCase().includes('wastage');
      if (isWastage) {
        wastageCount += count;
        wastageWeight += weight;
      } else {
        receivedCount += count;
        receivedWeight += weight;
      }
    });

    return {
      receivedCount: clampZero(receivedCount),
      receivedWeight: clampZero(receivedWeight),
      wastageCount: clampZero(wastageCount),
      wastageWeight: clampZero(wastageWeight),
      receivedBySource,
      wastageBySource,
    };
  }

  const rows = await client.receiveFromConingMachineRow.findMany({
    where: { issueId: issue.id, isDeleted: false },
    select: { coneCount: true, netWeight: true, sourceRowRefs: true },
  });
  rows.forEach((row) => {
    // Coning receives are recorded in cone units, while issue/take-back counts are in roll units.
    // Keep count math unit-consistent by not mapping cones into receivedCount.
    receivedWeight += Number(row.netWeight || 0);

    const refs = parseJsonArraySafe(row.sourceRowRefs);
    refs.forEach((ref) => {
      const sourceId = typeof ref?.rowId === 'string' ? ref.rowId.trim() : '';
      if (!sourceId) return;
      const rolls = Number(ref?.rolls || 0);
      const weight = Number(ref?.weight || 0);
      if (rolls > 0) receivedCount += rolls;
      const current = receivedBySource.get(sourceId) || { count: 0, weight: 0 };
      current.count += rolls;
      current.weight += weight;
      receivedBySource.set(sourceId, current);
    });
  });
  const totalRow = await client.receiveFromConingMachinePieceTotal.findUnique({
    where: { pieceId: issue.id },
    select: { wastageNetWeight: true },
  });
  wastageWeight = Number(totalRow?.wastageNetWeight || 0);

  return {
    receivedCount: clampZero(receivedCount),
    receivedWeight: clampZero(receivedWeight),
    wastageCount: 0,
    wastageWeight: clampZero(wastageWeight),
    receivedBySource,
    wastageBySource,
  };
}

async function getIssuePending(client, stage, issue) {
  const original = await getIssueOriginalIssued(client, stage, issue);
  const takeBack = await getIssueTakeBackSnapshot(client, stage, issue?.id);
  const received = await getIssueReceivedAndWastage(client, stage, issue);

  const netIssuedCount = clampZero(original.totalCount - takeBack.activeCount);
  const netIssuedWeight = clampZero(original.totalWeight - takeBack.activeWeight);
  const accountedCount = clampZero(received.receivedCount + received.wastageCount);
  const accountedWeight = clampZero(received.receivedWeight + received.wastageWeight);

  return {
    original,
    takeBack,
    received,
    netIssuedCount,
    netIssuedWeight,
    pendingCount: clampZero(netIssuedCount - accountedCount),
    pendingWeight: clampZero(netIssuedWeight - accountedWeight),
  };
}

function getCutterPiecePending(issuePending, pieceId) {
  const sourceId = String(pieceId || '').trim();
  if (!sourceId || !issuePending) return null;
  const originalLine = issuePending.original?.sourceMap?.get(sourceId);
  if (!originalLine) {
    return { pendingCount: 0, pendingWeight: 0 };
  }
  const takenBackLine = issuePending.takeBack?.activeBySource?.get(sourceId) || { count: 0, weight: 0 };
  const receivedLine = issuePending.received?.receivedBySource?.get(sourceId) || { count: 0, weight: 0 };
  const wastageLine = issuePending.received?.wastageBySource?.get(sourceId) || { count: 0, weight: 0 };
  return {
    pendingCount: clampZero(
      Number(originalLine.count || 0)
      - Number(takenBackLine.count || 0)
      - Number(receivedLine.count || 0),
    ),
    pendingWeight: clampZero(
      Number(originalLine.weight || 0)
      - Number(takenBackLine.weight || 0)
      - Number(receivedLine.weight || 0)
      - Number(wastageLine.weight || 0),
    ),
  };
}

function buildTakeBackConsumedBySource(stage, pending) {
  const consumedBySource = new Map();
  if (!pending) return consumedBySource;

  const receivedBySource = pending.received?.receivedBySource || new Map();
  const wastageBySource = pending.received?.wastageBySource || new Map();

  if (stage === 'cutter') {
    for (const [sourceId, received] of receivedBySource.entries()) {
      const current = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
      current.count += Number(received?.count || 0);
      current.weight += Number(received?.weight || 0);
      consumedBySource.set(sourceId, current);
    }
    for (const [sourceId, wastage] of wastageBySource.entries()) {
      const current = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
      current.count += Number(wastage?.count || 0);
      current.weight += Number(wastage?.weight || 0);
      consumedBySource.set(sourceId, current);
    }
    return consumedBySource;
  }

  // Coning uses free source selection — per-source consumed deduction is skipped.
  // The issue-level pendingWeight check is the authoritative guard for coning take-backs.
  if (stage === 'coning') return consumedBySource;

  // Holo receives are tracked issue-level (not source-row-level). Allocate consumed
  // issue quantity to source rows deterministically so per-source take-back validation
  // cannot exceed net remaining on any source row.
  const originalMap = pending.original?.sourceMap || new Map();
  const takeBackBySource = pending.takeBack?.activeBySource || new Map();
  // Prefer actual persisted per-source consumption if available (coning upgrade path).
  // Any leftover issue-level consumption (e.g. wastage without refs) is allocated FIFO as a fallback.
  let remainingCountToAllocate = clampZero(Number(pending.received?.receivedCount || 0) + Number(pending.received?.wastageCount || 0));
  let remainingWeightToAllocate = clampZero(Number(pending.received?.receivedWeight || 0) + Number(pending.received?.wastageWeight || 0));

  for (const [sourceId, received] of receivedBySource.entries()) {
    const current = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
    current.count += Number(received?.count || 0);
    current.weight += Number(received?.weight || 0);
    consumedBySource.set(sourceId, current);
    remainingCountToAllocate = clampZero(remainingCountToAllocate - Number(received?.count || 0));
    remainingWeightToAllocate = clampZero(remainingWeightToAllocate - Number(received?.weight || 0));
  }

  const orderedSourceIds = Array.from(originalMap.keys());

  // Allocate counts and weights independently so mixed source ratios cannot
  // over-consume one dimension on a source when only the other dimension is used.
  for (const sourceId of orderedSourceIds) {
    if (remainingCountToAllocate <= TAKE_BACK_EPSILON) break;
    const originalLine = originalMap.get(sourceId) || { count: 0, weight: 0 };
    const takenBackLine = takeBackBySource.get(sourceId) || { count: 0, weight: 0 };
    const alreadyConsumed = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
    const sourceNetCount = clampZero(
      Number(originalLine?.count || 0)
      - Number(takenBackLine?.count || 0)
      - Number(alreadyConsumed.count || 0),
    );
    if (sourceNetCount <= TAKE_BACK_EPSILON) continue;
    const allocatedCount = Math.min(sourceNetCount, remainingCountToAllocate);
    const current = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
    current.count = clampZero(Number(current.count || 0) + allocatedCount);
    consumedBySource.set(sourceId, current);
    remainingCountToAllocate = clampZero(remainingCountToAllocate - allocatedCount);
  }

  for (const sourceId of orderedSourceIds) {
    if (remainingWeightToAllocate <= TAKE_BACK_EPSILON) break;
    const originalLine = originalMap.get(sourceId) || { count: 0, weight: 0 };
    const takenBackLine = takeBackBySource.get(sourceId) || { count: 0, weight: 0 };
    const alreadyConsumed = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
    const sourceNetWeight = clampZero(
      Number(originalLine?.weight || 0)
      - Number(takenBackLine?.weight || 0)
      - Number(alreadyConsumed.weight || 0),
    );
    if (sourceNetWeight <= TAKE_BACK_EPSILON) continue;
    const allocatedWeight = Math.min(sourceNetWeight, remainingWeightToAllocate);
    const current = consumedBySource.get(sourceId) || { count: 0, weight: 0 };
    current.weight = clampZero(Number(current.weight || 0) + allocatedWeight);
    consumedBySource.set(sourceId, current);
    remainingWeightToAllocate = clampZero(remainingWeightToAllocate - allocatedWeight);
  }

  return consumedBySource;
}

async function computeConingReceiveSourceRowRefs(client, issue, netWeight, excludeReceiveRowId = null) {
  const weightToAllocate = clampZero(Number(netWeight || 0));
  if (!issue?.id || weightToAllocate <= TAKE_BACK_EPSILON) return [];

  const original = await getIssueOriginalIssued(client, 'coning', issue);
  const takeBack = await getIssueTakeBackSnapshot(client, 'coning', issue.id);
  const takeBackBySource = takeBack?.activeBySource || new Map();

  const existingRows = await client.receiveFromConingMachineRow.findMany({
    where: {
      issueId: issue.id,
      isDeleted: false,
      ...(excludeReceiveRowId ? { NOT: { id: excludeReceiveRowId } } : {}),
    },
    select: { sourceRowRefs: true },
  });

  const receivedBySource = new Map();
  existingRows.forEach((row) => {
    const refs = parseJsonArraySafe(row.sourceRowRefs);
    refs.forEach((ref) => {
      const sourceId = typeof ref?.rowId === 'string' ? ref.rowId.trim() : '';
      if (!sourceId) return;
      const weight = Number(ref?.weight || 0);
      const current = receivedBySource.get(sourceId) || 0;
      receivedBySource.set(sourceId, current + weight);
    });
  });

  let remaining = weightToAllocate;
  const allocations = [];
  const orderedSourceIds = Array.from(original.sourceMap.keys());

  for (const sourceId of orderedSourceIds) {
    if (remaining <= TAKE_BACK_EPSILON) break;
    const originalLine = original.sourceMap.get(sourceId) || { count: 0, weight: 0, sourceBarcode: null };
    const takenBackLine = takeBackBySource.get(sourceId) || { count: 0, weight: 0 };
    const netIssuedWeight = clampZero(Number(originalLine.weight || 0) - Number(takenBackLine.weight || 0));
    const alreadyReceivedWeight = Number(receivedBySource.get(sourceId) || 0);
    const remainingCap = clampZero(netIssuedWeight - alreadyReceivedWeight);
    if (remainingCap <= TAKE_BACK_EPSILON) continue;

    const allocated = Math.min(remaining, remainingCap);
    allocations.push({
      rowId: sourceId,
      barcode: originalLine.sourceBarcode || null,
      rolls: 0,
      weight: roundTo3Decimals(allocated),
    });
    remaining = clampZero(remaining - allocated);
  }

  // If receive weight exceeds remaining caps (legacy behavior allowed it), attribute overflow to the last source
  // so future take-back math is deterministic (it will clamp remaining at 0).
  if (remaining > TAKE_BACK_EPSILON && orderedSourceIds.length > 0) {
    const lastId = orderedSourceIds[orderedSourceIds.length - 1];
    const existing = allocations.find((a) => a.rowId === lastId);
    if (existing) {
      existing.weight = roundTo3Decimals(Number(existing.weight || 0) + remaining);
    } else {
      const originalLine = original.sourceMap.get(lastId) || { sourceBarcode: null };
      allocations.push({
        rowId: lastId,
        barcode: originalLine.sourceBarcode || null,
        rolls: 0,
        weight: roundTo3Decimals(remaining),
      });
    }
  }

  return allocations;
}

async function buildIssueBalancesByStage(client, stage, issues = []) {
  const map = {};
  for (const issue of issues) {
    const pending = await getIssuePending(client, stage, issue);
    map[issue.id] = {
      stage,
      issueId: issue.id,
      originalCount: pending.original.totalCount,
      originalWeight: pending.original.totalWeight,
      takeBackCount: pending.takeBack.activeCount,
      takeBackWeight: pending.takeBack.activeWeight,
      netIssuedCount: pending.netIssuedCount,
      netIssuedWeight: pending.netIssuedWeight,
      receivedCount: pending.received.receivedCount,
      receivedWeight: pending.received.receivedWeight,
      wastageCount: pending.received.wastageCount,
      wastageWeight: pending.received.wastageWeight,
      pendingCount: pending.pendingCount,
      pendingWeight: pending.pendingWeight,
    };
  }
  return map;
}

async function resolveOpenCutterIssueIdForPiece(client, pieceId, requiredWeight = null) {
  const pieceKey = String(pieceId || '').trim();
  if (!pieceKey) return null;
  const openCandidates = await listOpenCutterIssueAllocationsForPiece(client, pieceKey);
  if (openCandidates.length === 0) return null;
  const reqWeight = Number(requiredWeight);
  if (Number.isFinite(reqWeight) && reqWeight > TAKE_BACK_EPSILON) {
    const matched = openCandidates.find((entry) => Number(entry.remainingWeight || 0) - reqWeight > -TAKE_BACK_EPSILON);
    return matched?.issueId || null;
  }
  return openCandidates[0].issueId;
}

async function listOpenCutterIssueAllocationsForPiece(client, pieceId) {
  const pieceKey = String(pieceId || '').trim();
  if (!pieceKey) return [];
  const candidateLines = await client.issueToCutterMachineLine.findMany({
    where: {
      pieceId: pieceKey,
      issue: { isDeleted: false },
    },
    select: { issueId: true },
  });
  const issueIds = Array.from(new Set(candidateLines.map((line) => line.issueId).filter(Boolean)));
  if (issueIds.length === 0) return [];

  const openCandidates = [];
  for (const issueId of issueIds) {
    const issue = await loadIssueForTakeBack(client, 'cutter', issueId);
    if (!issue) continue;
    const pending = await getIssuePending(client, 'cutter', issue);
    const piecePending = getCutterPiecePending(pending, pieceKey);
    if (piecePending && piecePending.pendingWeight > TAKE_BACK_EPSILON) {
      const createdAtMs = Number.isFinite(new Date(issue.createdAt || 0).getTime())
        ? new Date(issue.createdAt || 0).getTime()
        : Number.MAX_SAFE_INTEGER;
      openCandidates.push({
        issueId,
        remainingWeight: piecePending.pendingWeight,
        createdAtMs,
        issueDate: String(issue.date || ''),
      });
    }
  }
  if (openCandidates.length === 0) return [];

  // Deterministic allocator for auto-linked receives:
  // prefer the oldest open issue for this piece, so consumption closes earlier allocations first.
  openCandidates.sort((a, b) => {
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    const dateCmp = a.issueDate.localeCompare(b.issueDate);
    if (dateCmp !== 0) return dateCmp;
    return String(a.issueId).localeCompare(String(b.issueId));
  });
  return openCandidates;
}

function calcAvailableCountFromWeight({ totalCount, issuedCount, dispatchedCount, totalWeight, availableWeight }) {
  const total = Number(totalCount || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const issued = Number(issuedCount || 0);
  const dispatched = Number(dispatchedCount || 0);
  const countBased = Math.max(0, total - issued - dispatched);
  const totalWt = Number(totalWeight || 0);
  if (!Number.isFinite(totalWt) || totalWt <= 0) return countBased;
  const availWt = Number(availableWeight || 0);
  if (!Number.isFinite(availWt) || availWt <= 0) return 0;
  const ratio = availWt / totalWt;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const weightBased = Math.floor((ratio * total) + 1e-6);
  return Math.max(0, Math.min(countBased, weightBased));
}

function parseRefs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createTraceCaches() {
  return {
    cutNames: new Map(),
    yarnNames: new Map(),
    twistNames: new Map(),
    rollTypeNames: new Map(),
  };
}

async function hydrateNameCache(modelKey, ids, cache) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  const missing = uniqueIds.filter((id) => !cache.has(id));
  if (missing.length === 0) return;
  const rows = await prisma[modelKey].findMany({
    where: { id: { in: missing } },
    select: { id: true, name: true },
  });
  rows.forEach((row) => cache.set(row.id, row.name || ''));
  missing.forEach((id) => {
    if (!cache.has(id)) cache.set(id, '');
  });
}

async function resolveHoloIssueDetails(issue, caches) {
  if (!issue) return { cutName: '', yarnName: '', twistName: '', yarnKg: null };
  const traceCaches = caches || createTraceCaches();
  const cutNames = new Set();

  const addName = (set, value) => {
    const name = String(value || '').trim();
    if (name) set.add(name);
  };

  if (issue.cut?.name) {
    addName(cutNames, issue.cut.name);
  } else if (issue.cutId) {
    await hydrateNameCache('cut', [issue.cutId], traceCaches.cutNames);
    addName(cutNames, traceCaches.cutNames.get(issue.cutId));
  }

  if (cutNames.size === 0) {
    const refs = parseRefs(issue.receivedRowRefs);
    const rowIds = refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
    if (rowIds.length > 0) {
      const cutterRows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { id: { in: rowIds }, isDeleted: false },
        select: { id: true, cutId: true, cut: true, cutMaster: { select: { name: true } } },
      });
      const cutIds = new Set();
      const fallbackNames = new Set();
      cutterRows.forEach((row) => {
        if (row.cutId) cutIds.add(row.cutId);
        if (row.cutMaster?.name) fallbackNames.add(row.cutMaster.name);
        if (typeof row.cut === 'string' && row.cut) fallbackNames.add(row.cut);
      });
      if (cutIds.size > 0) {
        await hydrateNameCache('cut', Array.from(cutIds), traceCaches.cutNames);
        cutIds.forEach((id) => fallbackNames.add(traceCaches.cutNames.get(id)));
      }
      fallbackNames.forEach((name) => addName(cutNames, name));
    }
  }

  if (issue.yarnId && !traceCaches.yarnNames.has(issue.yarnId)) {
    await hydrateNameCache('yarn', [issue.yarnId], traceCaches.yarnNames);
  }
  if (issue.twistId && !traceCaches.twistNames.has(issue.twistId)) {
    await hydrateNameCache('twist', [issue.twistId], traceCaches.twistNames);
  }

  const yarnName = (() => {
    if (issue.yarn?.name) return issue.yarn.name;
    if (issue.yarnId) return traceCaches.yarnNames.get(issue.yarnId) || '';
    return '';
  })();

  const twistName = (() => {
    if (issue.twist?.name) return issue.twist.name;
    if (issue.twistId) return traceCaches.twistNames.get(issue.twistId) || '';
    return '';
  })();

  const yarnKgNum = Number(issue.yarnKg);
  const yarnKg = Number.isFinite(yarnKgNum) ? yarnKgNum : null;

  return {
    cutName: cutNames.size ? Array.from(cutNames).join(', ') : '',
    yarnName,
    twistName,
    yarnKg,
  };
}

async function resolveConingTraceDetails(issue, options = {}) {
  if (!issue) return { cutName: '', yarnName: '', twistName: '', rollTypeName: '', yarnKg: null };
  const caches = options.caches || createTraceCaches();
  const holoIssueDetailsCache = options.holoIssueDetailsCache || new Map();
  const cutNames = new Set();
  const yarnNames = new Set();
  const twistNames = new Set();
  const rollTypeNames = new Set();
  let yarnKgTotal = 0;
  let yarnKgFound = false;
  const countedHoloIssues = new Set();
  const visitedConingIssues = new Set();

  const addName = (set, value) => {
    const name = String(value || '').trim();
    if (name) set.add(name);
  };

  const addFromConingIssue = async (coningIssue) => {
    if (!coningIssue) return;
    if (coningIssue.cut?.name) {
      addName(cutNames, coningIssue.cut.name);
    } else if (coningIssue.cutId) {
      await hydrateNameCache('cut', [coningIssue.cutId], caches.cutNames);
      addName(cutNames, caches.cutNames.get(coningIssue.cutId));
    }
    if (coningIssue.yarn?.name) {
      addName(yarnNames, coningIssue.yarn.name);
    } else if (coningIssue.yarnId) {
      await hydrateNameCache('yarn', [coningIssue.yarnId], caches.yarnNames);
      addName(yarnNames, caches.yarnNames.get(coningIssue.yarnId));
    }
    if (coningIssue.twist?.name) {
      addName(twistNames, coningIssue.twist.name);
    } else if (coningIssue.twistId) {
      await hydrateNameCache('twist', [coningIssue.twistId], caches.twistNames);
      addName(twistNames, caches.twistNames.get(coningIssue.twistId));
    }
  };

  const walkConingIssue = async (coningIssue) => {
    if (!coningIssue?.id || visitedConingIssues.has(coningIssue.id)) return;
    visitedConingIssues.add(coningIssue.id);
    await addFromConingIssue(coningIssue);

    const refs = parseRefs(coningIssue.receivedRowRefs);
    const rowIds = refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
    if (rowIds.length === 0) return;

    const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
      where: { id: { in: rowIds }, isDeleted: false },
      select: { id: true, issueId: true, rollTypeId: true },
    });
    const holoRowIds = new Set(holoRows.map(r => r.id));

    const rollTypeIds = Array.from(new Set(holoRows.map(r => r.rollTypeId).filter(Boolean)));
    if (rollTypeIds.length > 0) {
      await hydrateNameCache('rollType', rollTypeIds, caches.rollTypeNames);
      rollTypeIds.forEach((id) => addName(rollTypeNames, caches.rollTypeNames.get(id)));
    }

    const holoIssueIds = Array.from(new Set(holoRows.map(r => r.issueId).filter(Boolean)));
    if (holoIssueIds.length > 0) {
      const holoIssues = await prisma.issueToHoloMachine.findMany({
        where: { id: { in: holoIssueIds }, isDeleted: false },
        select: { id: true, cutId: true, yarnId: true, twistId: true, yarnKg: true, receivedRowRefs: true },
      });
      for (const holoIssue of holoIssues) {
        let resolved = holoIssueDetailsCache.get(holoIssue.id);
        if (!resolved) {
          resolved = await resolveHoloIssueDetails(holoIssue, caches);
          holoIssueDetailsCache.set(holoIssue.id, resolved);
        }
        addName(cutNames, resolved.cutName);
        addName(yarnNames, resolved.yarnName);
        addName(twistNames, resolved.twistName);
        if (!countedHoloIssues.has(holoIssue.id)) {
          const kg = Number(resolved.yarnKg);
          if (Number.isFinite(kg)) {
            yarnKgTotal += kg;
            yarnKgFound = true;
          }
          countedHoloIssues.add(holoIssue.id);
        }
      }
    }

    const remainingRowIds = rowIds.filter(id => !holoRowIds.has(id));
    if (remainingRowIds.length === 0) return;
    const coningRows = await prisma.receiveFromConingMachineRow.findMany({
      where: { id: { in: remainingRowIds }, isDeleted: false },
      select: { id: true, issueId: true },
    });
    const parentIssueIds = Array.from(new Set(coningRows.map(r => r.issueId).filter(Boolean)));
    if (parentIssueIds.length === 0) return;
    const parentIssues = await prisma.issueToConingMachine.findMany({
      where: { id: { in: parentIssueIds }, isDeleted: false },
      select: { id: true, cutId: true, yarnId: true, twistId: true, receivedRowRefs: true },
    });
    for (const parentIssue of parentIssues) {
      await walkConingIssue(parentIssue);
    }
  };

  await walkConingIssue(issue);

  return {
    cutName: cutNames.size ? Array.from(cutNames).join(', ') : '',
    yarnName: yarnNames.size ? Array.from(yarnNames).join(', ') : '',
    twistName: twistNames.size ? Array.from(twistNames).join(', ') : '',
    rollTypeName: rollTypeNames.size ? Array.from(rollTypeNames).join(', ') : '',
    yarnKg: yarnKgFound ? roundTo3Decimals(yarnKgTotal) : null,
  };
}

function isOpeningLotNo(lotNo) {
  return typeof lotNo === 'string' && lotNo.startsWith('OP-');
}

async function recalculateLotTotals(tx, lotNo, actorUserId) {
  if (!lotNo) return { totalWeight: 0, totalPieces: 0 };
  const agg = await tx.inboundItem.aggregate({
    where: { lotNo },
    _sum: { weight: true },
    _count: { id: true },
  });
  const totalWeight = Number(agg._sum.weight || 0);
  const totalPieces = Number(agg._count.id || 0);
  await tx.lot.update({
    where: { lotNo },
    data: { totalWeight, totalPieces, ...actorUpdateFields(actorUserId) },
  });
  return { totalWeight, totalPieces };
}

function extractWastageFromNote(note) {
  if (!note) return 0;
  const raw = String(note);
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return 0;
  const cleaned = match[1].replace(/,/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return roundTo3Decimals(value);
}

const OPENING_LOT_SEQUENCE_ID = 'opening_lot_sequence';
const CUTTER_PURCHASE_LOT_SEQUENCE_ID = 'cutter_purchase_lot_sequence';

function formatOpeningLotNo(nextVal) {
  const num = Number(nextVal);
  const padded = Number.isFinite(num)
    ? String(num).padStart(3, '0')
    : String(nextVal || '').padStart(3, '0');
  return `OP-${padded}`;
}

function formatCutterPurchaseLotNo(nextVal) {
  const num = Number(nextVal);
  const padded = Number.isFinite(num)
    ? String(num).padStart(3, '0')
    : String(nextVal || '').padStart(3, '0');
  return `CP-${padded}`;
}

function isCutterPurchaseLotNo(lotNo) {
  if (!lotNo || typeof lotNo !== 'string') return false;
  return lotNo.trim().toUpperCase().startsWith('CP-');
}

function cutterPurchasePieceIdFromLotNo(lotNo) {
  if (!lotNo) return null;
  const trimmed = String(lotNo).trim();
  if (!trimmed) return null;
  return `${trimmed}-1`;
}

async function resolveLotNoFromPieceId(pieceId) {
  if (!pieceId) return null;
  const normalized = normalizePieceId(pieceId);
  if (!normalized) return null;
  const inbound = await prisma.inboundItem.findUnique({
    where: { id: normalized },
    select: { lotNo: true },
  });
  if (inbound?.lotNo) return inbound.lotNo;
  const parts = normalized.split('-').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 3 && /^[A-Za-z]+$/.test(parts[0])) {
    return `${parts[0]}-${parts[1]}`;
  }
  return parts[0] || null;
}

async function findHoloIssuesReferencingCutterRows({ rowIds = [], barcodes = [] }) {
  const uniqueRowIds = Array.from(new Set((rowIds || []).filter(Boolean)));
  const uniqueBarcodes = Array.from(new Set((barcodes || []).filter(Boolean)));
  const rowIdArray = uniqueRowIds.length > 0 ? uniqueRowIds : ['__none__'];
  const barcodeArray = uniqueBarcodes.length > 0 ? uniqueBarcodes : ['__none__'];
  const holoUsage = await prisma.$queryRaw`
    SELECT id, barcode, date
    FROM "IssueToHoloMachine"
    WHERE "isDeleted" = false
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE("receivedRowRefs", '[]'::jsonb)) AS elem
        WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
           OR elem->>'barcode' = ANY (${barcodeArray}::text[])
      )
    LIMIT 10
  `;
  return Array.isArray(holoUsage) ? holoUsage : [];
}

async function findCutterBoxTransfersForRows({ rowIds = [], barcodes = [] }) {
  const uniqueRowIds = Array.from(new Set((rowIds || []).filter(Boolean)));
  const uniqueBarcodes = Array.from(new Set((barcodes || []).filter(Boolean)));
  if (uniqueRowIds.length === 0 && uniqueBarcodes.length === 0) return [];
  return await prisma.boxTransfer.findMany({
    where: {
      stage: 'cutter',
      isReversed: false,
      OR: [
        ...(uniqueRowIds.length > 0 ? [{ fromItemId: { in: uniqueRowIds } }, { toItemId: { in: uniqueRowIds } }] : []),
        ...(uniqueBarcodes.length > 0 ? [{ fromBarcode: { in: uniqueBarcodes } }, { toBarcode: { in: uniqueBarcodes } }] : []),
      ],
    },
    select: { id: true, date: true, fromItemId: true, toItemId: true },
    take: 10,
  });
}

function buildOpeningGroupKey(stage, {
  itemId,
  supplierId,
  firmId,
  date,
  twistId,
  yarnId,
  cutId,
}) {
  const base = [itemId || '', supplierId || '', firmId || ''].join('::');
  if (stage === 'holo') {
    return `${base}::${twistId || ''}::${yarnId || ''}::${cutId || ''}`;
  }
  return `${base}::${date || ''}`;
}

async function getOpeningLotPreview() {
  const seq = await prisma.sequence.findUnique({ where: { id: OPENING_LOT_SEQUENCE_ID } });
  const nextValue = (seq ? seq.nextValue : 0) + 1;
  return { nextValue, lotNo: formatOpeningLotNo(nextValue) };
}

async function allocateOpeningLot(tx, actorUserId) {
  const seq = await tx.sequence.upsert({
    where: { id: OPENING_LOT_SEQUENCE_ID },
    update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
    create: { id: OPENING_LOT_SEQUENCE_ID, nextValue: 1, ...actorCreateFields(actorUserId) },
  });
  return formatOpeningLotNo(seq.nextValue);
}

async function getCutterPurchaseLotPreview() {
  const seq = await prisma.sequence.findUnique({ where: { id: CUTTER_PURCHASE_LOT_SEQUENCE_ID } });
  const nextValue = (seq ? seq.nextValue : 0) + 1;
  return { nextValue, lotNo: formatCutterPurchaseLotNo(nextValue) };
}

async function allocateCutterPurchaseLot(tx, actorUserId) {
  const seq = await tx.sequence.upsert({
    where: { id: CUTTER_PURCHASE_LOT_SEQUENCE_ID },
    update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
    create: { id: CUTTER_PURCHASE_LOT_SEQUENCE_ID, nextValue: 1, ...actorCreateFields(actorUserId) },
  });
  return formatCutterPurchaseLotNo(seq.nextValue);
}

async function ensureHoloIssueSequence(tx, actorUserId) {
  const rows = await tx.$queryRaw`
    SELECT GREATEST(
      COALESCE((SELECT MAX(CAST(split_part(barcode, '-', 2) AS INT)) FROM "IssueToHoloMachine" WHERE barcode ~ '^IHO-[0-9]+'), 0),
      COALESCE((SELECT MAX(CAST(split_part(barcode, '-', 2) AS INT)) FROM "ReceiveFromHoloMachineRow" WHERE barcode ~ '^RHO-[0-9]+'), 0)
    ) AS max_series
  `;
  const maxSeries = Number(rows?.[0]?.max_series || 0);
  const current = await tx.holoIssueSequence.findUnique({ where: { id: 'holo_issue_seq' } });
  if (!current) {
    await tx.holoIssueSequence.create({
      data: {
        id: 'holo_issue_seq',
        nextValue: Math.max(1, maxSeries + 1),
        ...actorCreateFields(actorUserId),
      },
    });
    return;
  }
  if (Number(current.nextValue || 0) <= maxSeries) {
    await tx.holoIssueSequence.update({
      where: { id: 'holo_issue_seq' },
      data: { nextValue: maxSeries + 1, ...actorUpdateFields(actorUserId) },
    });
  }
}

async function ensureConingIssueSequence(tx, actorUserId) {
  const rows = await tx.$queryRaw`
    SELECT GREATEST(
      COALESCE((SELECT MAX(CAST(split_part(barcode, '-', 2) AS INT)) FROM "IssueToConingMachine" WHERE barcode ~ '^ICO-[0-9]+'), 0),
      COALESCE((SELECT MAX(CAST(split_part(barcode, '-', 2) AS INT)) FROM "ReceiveFromConingMachineRow" WHERE barcode ~ '^RCO-[0-9]+'), 0)
    ) AS max_series
  `;
  const maxSeries = Number(rows?.[0]?.max_series || 0);
  const current = await tx.coningIssueSequence.findUnique({ where: { id: 'coning_issue_seq' } });
  if (!current) {
    await tx.coningIssueSequence.create({
      data: {
        id: 'coning_issue_seq',
        nextValue: Math.max(1, maxSeries + 1),
        ...actorCreateFields(actorUserId),
      },
    });
    return;
  }
  if (Number(current.nextValue || 0) <= maxSeries) {
    await tx.coningIssueSequence.update({
      where: { id: 'coning_issue_seq' },
      data: { nextValue: maxSeries + 1, ...actorUpdateFields(actorUserId) },
    });
  }
}

function toOptionalString(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str ? str : null;
}

function normalizeWorkerRole(role) {
  const val = typeof role === 'string' ? role.toLowerCase().trim() : '';
  return val === 'helper' ? 'helper' : 'operator';
}

function buildUserPayload(user) {
  const roleLinks = Array.isArray(user?.roles) ? user.roles : [];
  const roles = roleLinks.map(link => link.role).filter(Boolean);
  const normalizedRoles = roles.map(role => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description || null,
    permissions: normalizePermissions(role.permissions),
  }));
  const roleKeys = normalizedRoles.map(role => role.key);
  const roleNames = normalizedRoles.map(role => role.name);
  const isAdmin = roleKeys.includes('admin');
  const permissions = buildEffectivePermissions(roles);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: normalizedRoles,
    roleKeys,
    roleNames,
    permissions,
    isAdmin,
  };
}

function getActor(req) {
  if (!req || !req.user) return null;
  return {
    userId: req.user.id,
    username: req.user.username,
    roleKey: req.user.primaryRoleKey || null,
  };
}

function actorCreateFields(actorUserId) {
  if (!actorUserId) return {};
  return { createdByUserId: actorUserId, updatedByUserId: actorUserId };
}

function actorUpdateFields(actorUserId) {
  if (!actorUserId) return {};
  return { updatedByUserId: actorUserId };
}

async function logCrudWithActor(req, args) {
  const actor = getActor(req);
  return await logCrud({
    ...args,
    actorUserId: actor?.userId,
    actorUsername: actor?.username,
    actorRoleKey: actor?.roleKey,
  });
}

function getFiscalYearLabel(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) return getFiscalYearLabel();
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-based
  const startYear = month >= 3 ? year : year - 1; // FY starts in April
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

function formatCutterChallanNo(sequence, fiscalYear) {
  const padded = String(sequence || 0).padStart(3, '0');
  return `CUT/CH/${padded}/${fiscalYear}`;
}

async function allocateCutterChallanNumber(tx, actorUserId, dateInput) {
  const fiscalYear = getFiscalYearLabel(dateInput);
  const seqId = `cutter_challan_seq_${fiscalYear.replace('-', '_')}`;
  const seq = await tx.sequence.upsert({
    where: { id: seqId },
    update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
    create: { id: seqId, nextValue: 1, ...actorCreateFields(actorUserId) },
  });
  return {
    challanNo: formatCutterChallanNo(seq.nextValue, fiscalYear),
    sequence: seq.nextValue,
    fiscalYear,
  };
}

function appendChangeLog(existing, entry) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  list.push(entry);
  return list;
}

async function findWastageNoteChallans({ pieceId, referenceDate, includeSelf = false }) {
  return await prisma.receiveFromCutterMachineChallan.findMany({
    where: {
      pieceId,
      isDeleted: false,
      OR: [
        { wastageNote: { not: null } },
        { wastageNetWeight: { gt: 0 } },
      ],
      createdAt: includeSelf ? { gte: referenceDate } : { gt: referenceDate },
    },
    orderBy: { createdAt: 'asc' },
  });
}

// Helper: Get or create bobbin by name (normalize to "Bobbin" if empty/null)
async function getOrCreateBobbin(pcsTypeName) {
  if (!pcsTypeName || !String(pcsTypeName).trim()) {
    // Default to "Bobbin" if PcsTypeName is empty
    pcsTypeName = 'Bobbin';
  }
  const normalizedName = String(pcsTypeName).trim();

  // Try to find existing bobbin (case-insensitive)
  const existing = await prisma.bobbin.findFirst({
    where: {
      name: {
        equals: normalizedName,
        mode: 'insensitive',
      },
    },
  });

  if (existing) {
    return existing.id;
  }

  // Create new bobbin
  const newBobbin = await prisma.bobbin.create({
    data: { name: normalizedName },
  });

  return newBobbin.id;
}

function parseReceiveCsvContent(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('CSV content missing');
  }
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => line.toLowerCase().includes('narration'));
  if (headerIndex === -1) {
    throw new Error('Unable to locate header row with Narration column');
  }
  const trimmedLines = lines.slice(headerIndex).join('\n');
  const rawRecords = parse(trimmedLines, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  const rows = [];
  const issues = [];
  const duplicateVchNos = new Set();
  const seenInFile = new Set();

  rawRecords.forEach((rec, idx) => {
    const rowPos = idx + 1; // relative to data portion
    const values = Object.values(rec || {}).map(val => (val === undefined || val === null) ? '' : String(val).trim());
    const allEmpty = values.every(v => v === '');
    if (allEmpty) {
      return;
    }
    const narrationRaw = rec['Narration'] ?? '';
    const pieceId = normalizePieceId(narrationRaw);
    const vchNoRaw = rec['VchNo'];
    const vchNo = toOptionalString(vchNoRaw);

    if (!pieceId && !vchNo) {
      return;
    }

    if (!pieceId) {
      issues.push({ type: 'missing_piece', row: rowPos, message: 'Missing Narration / piece id' });
      return;
    }
    if (!vchNo) {
      issues.push({ type: 'missing_vch', row: rowPos, message: 'Missing VchNo' });
      return;
    }
    if (seenInFile.has(vchNo)) {
      duplicateVchNos.add(vchNo);
      return;
    }
    seenInFile.add(vchNo);

    rows.push({
      pieceId,
      vchNo,
      narration: toOptionalString(narrationRaw),
      date: toOptionalString(rec['Date']),
      vchBook: toOptionalString(rec['Vch.Book']),
      barcode: toOptionalString(rec['Barcode']),
      shift: toOptionalString(rec['Shift']),
      godownName: toOptionalString(rec['Godown Name']),
      racNo: toOptionalString(rec['RacNo']),
      prodIssType: toOptionalString(rec['ProdIss Type']),
      yarnName: toOptionalString(rec['Yarn Name']),
      itemName: toOptionalString(rec['Item']),
      cut: toOptionalString(rec['Cut']),
      machineNo: toOptionalString(rec['MachineNo']),
      employee: toOptionalString(rec['Employee']),
      pktTypeName: toOptionalString(rec['PktTypeName']),
      pcsTypeName: toOptionalString(rec['PcsTypeName']),
      bobbinQuantity: toInt(rec['Pcs']),
      grossWt: toNumber(rec['Grs Wt']),
      tareWt: toNumber(rec['Tare Wt']),
      netWt: toNumber(rec['Net Wt']),
      pktBoxWt: toNumber(rec['PktBoxWt']),
      pcsBoxWt: toNumber(rec['PcsBoxWt']),
      yarnWt: toNumber(rec['YarnWt']),
      totalKg: toNumber(rec['TotalKg']),
      createdBy: toOptionalString(rec['CreatedBy']),
      modifiedBy: toOptionalString(rec['modifyBy']),
    });
  });

  if (duplicateVchNos.size > 0) {
    issues.push({ type: 'duplicate_vch_in_file', rows: Array.from(duplicateVchNos) });
  }

  return { rows, issues };
}

function aggregateNetByPiece(rows) {
  const increments = new Map();
  for (const row of rows) {
    const net = Number(row.netWt || 0);
    if (!Number.isFinite(net) || net <= 0) continue;
    increments.set(row.pieceId, (increments.get(row.pieceId) || 0) + net);
  }
  return increments;
}

function aggregatePieceCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const qty = Number(row.bobbinQuantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    counts.set(row.pieceId, (counts.get(row.pieceId) || 0) + qty);
  }
  return counts;
}

async function fetchInboundAndTotals(pieceIds) {
  if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
    return { inboundMap: new Map(), totalsMap: new Map() };
  }
  const [inboundPieces, pieceTotals] = await Promise.all([
    prisma.inboundItem.findMany({ where: { id: { in: pieceIds } } }),
    prisma.receiveFromCutterMachinePieceTotal.findMany({ where: { pieceId: { in: pieceIds } } }),
  ]);
  const inboundMap = new Map(inboundPieces.map(p => [p.id, p]));
  const totalsMap = new Map(pieceTotals.map(t => [t.pieceId, Number(t.totalNetWeight || 0)]));
  return { inboundMap, totalsMap };
}

function buildPieceSummaries(pieceIds, { inboundMap, totalsMap }, incrementsMap = new Map()) {
  const sortedIds = Array.from(new Set(pieceIds)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const pieces = [];
  let totalNetWeight = 0;
  for (const pieceId of sortedIds) {
    const inbound = inboundMap.get(pieceId) || null;
    const inboundWeight = inbound ? Number(inbound.weight || 0) : null;
    const currentReceived = totalsMap.get(pieceId) || 0;
    const delta = incrementsMap.get(pieceId) || 0;
    const nextReceived = currentReceived + delta;
    const currentPending = inboundWeight == null ? null : Math.max(0, inboundWeight - currentReceived);
    const nextPending = inboundWeight == null ? null : Math.max(0, inboundWeight - nextReceived);
    totalNetWeight += delta;
    pieces.push({
      pieceId,
      lotNo: inbound ? inbound.lotNo : null,
      inboundWeight,
      currentReceivedWeight: currentReceived,
      currentPendingWeight: currentPending,
      incrementWeight: delta,
      futureReceivedWeight: nextReceived,
      futurePendingWeight: nextPending,
      inboundExists: Boolean(inbound),
    });
  }
  return { pieces, totalNetWeight };
}

function buildLotSummaries(pieces) {
  const lotMap = new Map();
  for (const piece of pieces) {
    if (!piece.lotNo) continue;
    const lot = lotMap.get(piece.lotNo) || {
      lotNo: piece.lotNo,
      inboundWeight: 0,
      currentReceivedWeight: 0,
      currentPendingWeight: 0,
      incrementWeight: 0,
      futureReceivedWeight: 0,
      futurePendingWeight: 0,
      pieceCount: 0,
    };
    if (Number.isFinite(piece.inboundWeight)) {
      lot.inboundWeight += piece.inboundWeight;
    }
    if (Number.isFinite(piece.currentReceivedWeight)) {
      lot.currentReceivedWeight += piece.currentReceivedWeight;
    }
    if (Number.isFinite(piece.currentPendingWeight)) {
      lot.currentPendingWeight += piece.currentPendingWeight;
    }
    if (Number.isFinite(piece.incrementWeight)) {
      lot.incrementWeight += piece.incrementWeight;
    }
    if (Number.isFinite(piece.futureReceivedWeight)) {
      lot.futureReceivedWeight += piece.futureReceivedWeight;
    }
    if (Number.isFinite(piece.futurePendingWeight)) {
      lot.futurePendingWeight += piece.futurePendingWeight;
    }
    lot.pieceCount += 1;
    lotMap.set(piece.lotNo, lot);
  }
  return Array.from(lotMap.values()).sort((a, b) => a.lotNo.localeCompare(b.lotNo, undefined, { numeric: true, sensitivity: 'base' }));
}

function buildReceiveSummary({ filename, rows, incrementsMap, pieceMeta }) {
  const missingPieces = pieceMeta.pieces.filter(p => !p.inboundExists).map(p => p.pieceId);
  return {
    filename,
    rowCount: rows.length,
    pieceCount: incrementsMap.size,
    totalNetWeight: pieceMeta.totalNetWeight,
    pieces: pieceMeta.pieces,
    lots: buildLotSummaries(pieceMeta.pieces),
    missingPieces,
  };
}

// ===== Auth (public) =====

router.get('/api/auth/status', async (req, res) => {
  try {
    await ensureDefaultAdminUser();
    const userCount = await prisma.user.count();
    res.json({ ok: true, hasUsers: userCount > 0, needsBootstrap: userCount === 0 });
  } catch (err) {
    console.error('Failed to read auth status', err);
    res.status(500).json({ error: 'Failed to read auth status' });
  }
});

router.post('/api/auth/login', async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });
    if (!user || !Array.isArray(user.roles) || user.roles.length === 0) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    if (user.isActive === false) return res.status(403).json({ error: 'user_disabled' });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const expiresAt = getSessionExpiryDate();
    const { token, tokenHash } = generateSessionToken();
    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ip: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), ...actorUpdateFields(user.id) },
    });

    res.cookie(SESSION_COOKIE_NAME, token, { ...getSessionCookieOptions(), expires: expiresAt });
    res.json({ ok: true, user: buildUserPayload(user) });
  } catch (err) {
    console.error('Login failed', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/api/auth/bootstrap', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) return res.status(409).json({ error: 'already_bootstrapped' });

    if (!bootstrapToken) {
      bootstrapToken = randomUUID();
      console.log('============================================================');
      console.log('GLINTEX AUTH BOOTSTRAP TOKEN (one-time):', bootstrapToken);
      console.log('Use it to create the first admin user via POST /api/auth/bootstrap');
      console.log('============================================================');
    }

    const provided = String(req.headers['x-bootstrap-token'] || req.body?.bootstrapToken || '').trim();
    if (!provided || provided !== bootstrapToken) return res.status(401).json({ error: 'invalid_bootstrap_token' });

    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

    const adminRole = await prisma.role.findUnique({ where: { key: 'admin' } });
    if (!adminRole) return res.status(500).json({ error: 'admin role missing; run migrations' });

    const passwordHash = await hashPassword(password);
    const createdUser = await prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        isActive: true,
        roles: {
          create: [{ roleId: adminRole.id }],
        },
      },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });

    const expiresAt = getSessionExpiryDate();
    const { token, tokenHash } = generateSessionToken();
    await prisma.userSession.create({
      data: {
        userId: createdUser.id,
        tokenHash,
        expiresAt,
        ip: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });

    bootstrapToken = null;
    res.cookie(SESSION_COOKIE_NAME, token, { ...getSessionCookieOptions(), expires: expiresAt });
    res.json({ ok: true, user: buildUserPayload(createdUser) });
  } catch (err) {
    console.error('Bootstrap failed', err);
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

router.get('/api/health', async (req, res) => {
  res.json({ ok: true });
});

// Weight scale capture audit (scale/manual)
router.post('/api/weight_capture', requireAuth, async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const source = typeof req.body?.source === 'string' ? req.body.source.trim().toLowerCase() : '';
    const weightKg = toNumber(req.body?.weightKg);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : null;

    if (!source || (source !== 'scale' && source !== 'manual')) {
      return res.status(400).json({ error: 'Invalid source' });
    }
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return res.status(400).json({ error: 'Invalid weightKg' });
    }
    if (source === 'manual' && reason.length < 3) {
      return res.status(400).json({ error: 'Manual entry requires a reason' });
    }

    const payload = {
      source,
      weightKg: roundTo3Decimals(weightKg),
      reason: source === 'manual' ? reason : undefined,
      context,
      // Optional diagnostic metadata
      portInfo: req.body?.portInfo ?? null,
      baudRate: req.body?.baudRate ?? null,
      parser: req.body?.parser ?? null,
      raw: typeof req.body?.raw === 'string' ? req.body.raw.slice(0, 500) : null,
      stableFlag: Boolean(req.body?.stableFlag),
    };

    await logCrudWithActor(req, {
      entityType: 'weight_capture',
      entityId: typeof context?.entityId === 'string' ? context.entityId : null,
      action: 'create',
      payload,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('weight capture log failed', err);
    res.status(500).json({ error: 'Failed to log weight capture' });
  }
});

// Public branding endpoint (accessible without login)
router.get('/api/public/branding', async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return res.json({
        brandPrimary: '#2E4CA6',
        brandGold: '#D4AF37',
        logoDataUrl: null,
        faviconDataUrl: null,
      });
    }
    res.json({
      brandPrimary: settings.brandPrimary,
      brandGold: settings.brandGold,
      logoDataUrl: settings.logoDataUrl || null,
      faviconDataUrl: settings.faviconDataUrl || null,
    });
  } catch (err) {
    console.error('Failed to fetch public branding', err);
    res.status(500).json({ error: 'Failed to fetch branding' });
  }
});

router.get('/api/google-drive/callback', async (req, res) => {
  try {
    const error = req.query?.error;
    if (error) {
      return res.status(400).send('<html><body><h3>Google Drive connection failed</h3><p>Please try again.</p></body></html>');
    }

    const code = typeof req.query?.code === 'string' ? req.query.code : '';
    const state = typeof req.query?.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      return res.status(400).send('<html><body><h3>Missing OAuth parameters</h3><p>Please try connecting again.</p></body></html>');
    }

    const result = await handleGoogleDriveCallback({ code, state });
    const emailLabel = result?.email ? `Connected as ${result.email}.` : 'Connected successfully.';
    return res.send(`<html><body><h3>Google Drive connected</h3><p>${emailLabel}</p><p>You can close this window.</p><script>setTimeout(() => window.close(), 1500);</script></body></html>`);
  } catch (err) {
    console.error('Google Drive callback failed', err);
    return res.status(500).send('<html><body><h3>Google Drive connection failed</h3><p>Please try again.</p></body></html>');
  }
});

// ===== Auth (required) =====
router.use(requireAuth);

router.get('/api/auth/me', async (req, res) => {
  res.json({ ok: true, user: req.user });
});

router.post('/api/auth/logout', async (req, res) => {
  try {
    const sessionId = req.session?.id;
    if (sessionId) {
      await prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    }
  } catch (err) {
    console.error('Failed to revoke session', err);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ===== Admin: Users & Roles =====

router.get('/api/admin/roles', requireRole('admin'), async (req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { key: 'asc' } });
  res.json({ roles });
});

router.post('/api/admin/roles', requireRole('admin'), async (req, res) => {
  try {
    const actor = getActor(req);
    const key = String(req.body?.key || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    const permissions = normalizePermissions(req.body?.permissions);
    if (!key || !/^[a-z0-9_\\-]+$/.test(key)) return res.status(400).json({ error: 'role key must be alphanumeric/underscore/dash' });
    if (!name) return res.status(400).json({ error: 'role name is required' });

    const created = await prisma.role.create({
      data: {
        key,
        name,
        description,
        permissions,
        ...actorCreateFields(actor?.userId),
      },
    });

    await logCrud({
      entityType: 'role',
      entityId: created.id,
      action: 'create',
      payload: { key, name, description, permissions },
      actorUserId: actor?.userId,
      actorUsername: actor?.username,
      actorRoleKey: actor?.roleKey,
    });

    res.json({ role: created });
  } catch (err) {
    console.error('Failed to create role', err);
    if (err.code === 'P2002') return res.status(409).json({ error: 'role already exists' });
    res.status(500).json({ error: err.message || 'Failed to create role' });
  }
});

router.put('/api/admin/roles/:id', requireRole('admin'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Role not found' });

    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const description = req.body?.description != null ? String(req.body.description).trim() : undefined;
    const permissions = req.body?.permissions !== undefined ? normalizePermissions(req.body.permissions) : undefined;
    const updated = await prisma.role.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
        ...actorUpdateFields(actor?.userId),
      },
    });

    await logCrud({
      entityType: 'role',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      actorUserId: actor?.userId,
      actorUsername: actor?.username,
      actorRoleKey: actor?.roleKey,
    });

    res.json({ role: updated });
  } catch (err) {
    console.error('Failed to update role', err);
    res.status(500).json({ error: err.message || 'Failed to update role' });
  }
});

router.get('/api/admin/users', requireRole('admin'), async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { username: 'asc' },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });
  res.json({
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      isActive: u.isActive,
      roles: Array.isArray(u.roles)
        ? u.roles.map(link => link.role).filter(Boolean).map(role => ({
          id: role.id,
          key: role.key,
          name: role.name,
        }))
        : [],
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      createdByUserId: u.createdByUserId || null,
      updatedByUserId: u.updatedByUserId || null,
    })),
  });
});

router.post('/api/admin/users', requireRole('admin'), async (req, res) => {
  try {
    const actor = getActor(req);
    const username = normalizeUsername(req.body?.username);
    const displayName = req.body?.displayName != null ? String(req.body.displayName).trim() : null;
    const password = String(req.body?.password || '');
    const roleIdsInput = Array.isArray(req.body?.roleIds)
      ? req.body.roleIds
      : (req.body?.roleId ? [req.body.roleId] : []);
    const roleIds = roleIdsInput.map(id => String(id)).filter(Boolean);
    const isActive = req.body?.isActive !== false;
    if (!username || !password || roleIds.length === 0) return res.status(400).json({ error: 'username, password, roleIds are required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== roleIds.length) return res.status(400).json({ error: 'role not found' });

    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        isActive,
        roles: {
          createMany: {
            data: roleIds.map(roleId => ({ roleId })),
            skipDuplicates: true,
          },
        },
        ...actorCreateFields(actor?.userId),
      },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });

    await logCrud({
      entityType: 'user',
      entityId: created.id,
      action: 'create',
      payload: { username, displayName, roleIds, isActive },
      actorUserId: actor?.userId,
      actorUsername: actor?.username,
      actorRoleKey: actor?.roleKey,
    });

    res.json({
      user: {
        id: created.id,
        username: created.username,
        displayName: created.displayName,
        isActive: created.isActive,
        roles: Array.isArray(created.roles)
          ? created.roles.map(link => link.role).filter(Boolean).map(role => ({
            id: role.id,
            key: role.key,
            name: role.name,
          }))
          : [],
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    console.error('Failed to create user', err);
    if (err.code === 'P2002') return res.status(409).json({ error: 'username already exists' });
    res.status(500).json({ error: err.message || 'Failed to create user' });
  }
});

router.put('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;
    const existing = await prisma.user.findUnique({
      where: { id },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const displayName = req.body?.displayName !== undefined ? (req.body.displayName ? String(req.body.displayName).trim() : null) : undefined;
    const roleIdsInput = req.body?.roleIds !== undefined
      ? (Array.isArray(req.body.roleIds) ? req.body.roleIds : (req.body.roleId ? [req.body.roleId] : []))
      : undefined;
    const roleIds = roleIdsInput !== undefined ? roleIdsInput.map(id => String(id)).filter(Boolean) : undefined;
    const isActive = req.body?.isActive !== undefined ? !!req.body.isActive : undefined;
    if (roleIds !== undefined && roleIds.length === 0) return res.status(400).json({ error: 'roleIds are required when provided' });
    if (roleIds !== undefined) {
      const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
      if (roles.length !== roleIds.length) return res.status(400).json({ error: 'role not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(displayName !== undefined ? { displayName } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...actorUpdateFields(actor?.userId),
        },
      });

      if (roleIds !== undefined) {
        await tx.userRole.deleteMany({
          where: {
            userId: id,
            roleId: { notIn: roleIds },
          },
        });
        await tx.userRole.createMany({
          data: roleIds.map(roleId => ({ userId: id, roleId })),
          skipDuplicates: true,
        });
      }

      return await tx.user.findUnique({
        where: { id },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });
    });

    await logCrud({
      entityType: 'user',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      actorUserId: actor?.userId,
      actorUsername: actor?.username,
      actorRoleKey: actor?.roleKey,
    });

    res.json({
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        isActive: updated.isActive,
        roles: Array.isArray(updated.roles)
          ? updated.roles.map(link => link.role).filter(Boolean).map(role => ({
            id: role.id,
            key: role.key,
            name: role.name,
          }))
          : [],
      },
    });
  } catch (err) {
    console.error('Failed to update user', err);
    res.status(500).json({ error: err.message || 'Failed to update user' });
  }
});

router.put('/api/admin/users/:id/password', requireRole('admin'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;
    const password = String(req.body?.password || '');
    if (!password || password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id },
      data: { passwordHash, ...actorUpdateFields(actor?.userId) },
    });

    await logCrud({
      entityType: 'user',
      entityId: id,
      action: 'password_reset',
      payload: { userId: id },
      actorUserId: actor?.userId,
      actorUsername: actor?.username,
      actorRoleKey: actor?.roleKey,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to reset password', err);
    res.status(500).json({ error: err.message || 'Failed to reset password' });
  }
});

function hasReadPermission(req, key) {
  if (req.user?.isAdmin) return true;
  return Number(req.user?.permissions?.[key] || 0) >= PERM_READ;
}

function hasPermissionLevel(req, key, level) {
  if (req.user?.isAdmin) return true;
  return Number(req.user?.permissions?.[key] || 0) >= Number(level || 0);
}

function hasAnyReadPermission(req, keys = []) {
  if (req.user?.isAdmin) return true;
  return keys.some(key => Number(req.user?.permissions?.[key] || 0) >= PERM_READ);
}

function buildBrandPayload(settingsRow) {
  return {
    primary: settingsRow?.brandPrimary || null,
    gold: settingsRow?.brandGold || null,
    logoDataUrl: settingsRow?.logoDataUrl || '',
    faviconDataUrl: settingsRow?.faviconDataUrl || '',
  };
}

function sanitizeSettingsForResponse(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  return {
    ...settings,
    telegramBotToken: settings.telegramBotToken ? '********' : null,
  };
}

async function fetchInboundBasics() {
  const [lotsRaw, inbound_itemsRaw] = await Promise.all([
    prisma.lot.findMany(),
    prisma.inboundItem.findMany(),
  ]);
  // Resolve user fields for display
  const [lots, inbound_items] = await Promise.all([
    resolveUserFields(lotsRaw),
    resolveUserFields(inbound_itemsRaw),
  ]);
  return { lots, inbound_items };
}

async function fetchCutterReceiveData(options = {}) {
  const includeAll = Boolean(options.includeAll);
  const receive_from_cutter_machine_uploads = await prisma.receiveFromCutterMachineUpload.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: RECEIVE_UPLOADS_FETCH_LIMIT,
  });
  const receive_from_cutter_machine_rows_raw = await prisma.receiveFromCutterMachineRow.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' },
    ...(includeAll ? {} : { take: RECEIVE_ROWS_FETCH_LIMIT }),
    include: {
      bobbin: { select: { id: true, name: true, weight: true } },
      box: { select: { id: true, name: true, weight: true } },
      operator: { select: { id: true, name: true } },
      helper: { select: { id: true, name: true } },
      cutMaster: { select: { id: true, name: true } },
    },
  });
  const receive_from_cutter_machine_challans_raw = await prisma.receiveFromCutterMachineChallan.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' },
    ...(includeAll ? {} : { take: RECEIVE_ROWS_FETCH_LIMIT }),
  });
  const receive_from_cutter_machine_piece_totals = await prisma.receiveFromCutterMachinePieceTotal.findMany();

  // Resolve user fields for display
  const [receive_from_cutter_machine_rows, receive_from_cutter_machine_challans] = await Promise.all([
    resolveUserFields(receive_from_cutter_machine_rows_raw),
    resolveUserFields(receive_from_cutter_machine_challans_raw),
  ]);

  return {
    receive_from_cutter_machine_uploads,
    receive_from_cutter_machine_rows,
    receive_from_cutter_machine_challans,
    receive_from_cutter_machine_piece_totals,
  };
}

function buildIssueToHoloMachine(issueRaw = [], cutterRowPieceMap, inbound_items) {
  const pieceMetaMap = new Map(inbound_items.map(p => [p.id, { lotNo: p.lotNo, itemId: p.itemId }]));
  const issue_to_holo_machine = issueRaw.map((issue) => {
    let refs = [];
    try {
      refs = Array.isArray(issue.receivedRowRefs)
        ? issue.receivedRowRefs
        : (typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : []);
    } catch (e) {
      refs = [];
    }
    const lotSet = new Set();
    const itemSet = new Set();
    refs.forEach((ref) => {
      const rowId = typeof ref?.rowId === 'string' ? ref.rowId : null;
      if (!rowId) return;
      const pieceId = cutterRowPieceMap.get(rowId);
      if (!pieceId) return;
      const meta = pieceMetaMap.get(pieceId);
      if (meta?.lotNo) lotSet.add(meta.lotNo);
      if (meta?.itemId) itemSet.add(meta.itemId);
    });
    const lotNos = Array.from(lotSet);
    const itemIds = Array.from(itemSet);
    if (lotNos.length === 0 && issue.lotNo) lotNos.push(issue.lotNo);
    if (itemIds.length === 0 && issue.itemId) itemIds.push(issue.itemId);
    const lotLabel = lotNos.length <= 1
      ? (lotNos[0] || issue.lotNo || '')
      : (lotNos.length <= 3 ? `Mixed (${lotNos.join(', ')})` : `Mixed (${lotNos.length})`);
    return { ...issue, lotNos, itemIds, lotLabel, isMixedLot: lotNos.length > 1 };
  });
  const issueLotLabelMap = new Map(issue_to_holo_machine.map(i => [i.id, i.lotLabel]));
  const issueLotNosMap = new Map(issue_to_holo_machine.map(i => [i.id, i.lotNos]));
  return { issue_to_holo_machine, issueLotLabelMap, issueLotNosMap };
}

async function buildHoloIssuedToConingMap(client, holoRowIds = []) {
  const uniqueIds = Array.from(new Set((holoRowIds || []).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const [rows, takeBackRows] = await Promise.all([
    client.$queryRaw`
    SELECT
      elem->>'rowId' AS row_id,
      SUM(CASE WHEN (elem->>'issueRolls') IS NULL OR (elem->>'issueRolls') = '' THEN 0 ELSE (elem->>'issueRolls')::numeric END) AS issue_rolls,
      SUM(CASE WHEN (elem->>'issueWeight') IS NULL OR (elem->>'issueWeight') = '' THEN 0 ELSE (elem->>'issueWeight')::numeric END) AS issue_weight
    FROM "IssueToConingMachine" i,
      jsonb_array_elements(COALESCE(i."receivedRowRefs", '[]'::jsonb)) elem
    WHERE i."isDeleted" = false
      AND elem->>'rowId' = ANY (${uniqueIds}::text[])
    GROUP BY row_id
  `,
    client.issueTakeBackLine.findMany({
      where: {
        sourceId: { in: uniqueIds },
        takeBack: {
          stage: 'coning',
        },
      },
      select: {
        sourceId: true,
        count: true,
        weight: true,
        takeBack: {
          select: {
            isReverse: true,
          },
        },
      },
    }),
  ]);
  const map = new Map();
  (rows || []).forEach((row) => {
    const rowId = row.row_id || row.rowId;
    if (!rowId) return;
    const issuedRolls = Number(row.issue_rolls || row.issueRolls || 0);
    const issuedWeight = Number(row.issue_weight || row.issueWeight || 0);
    map.set(rowId, {
      issuedRolls: Number.isFinite(issuedRolls) ? issuedRolls : 0,
      issuedWeight: Number.isFinite(issuedWeight) ? issuedWeight : 0,
    });
  });

  (takeBackRows || []).forEach((line) => {
    const rowId = line.sourceId;
    if (!rowId) return;
    const current = map.get(rowId) || { issuedRolls: 0, issuedWeight: 0 };
    const sign = line.takeBack?.isReverse ? 1 : -1;
    current.issuedRolls = clampZero(Number(current.issuedRolls || 0) + (sign * Number(line.count || 0)));
    current.issuedWeight = clampZero(Number(current.issuedWeight || 0) + (sign * Number(line.weight || 0)));
    map.set(rowId, current);
  });

  return map;
}

function getHoloRowNetWeight(row) {
  const rollWeight = Number(row?.rollWeight);
  if (Number.isFinite(rollWeight) && rollWeight > 0) return rollWeight;
  const gross = Number(row?.grossWeight || 0);
  const tare = Number(row?.tareWeight || 0);
  return Math.max(0, gross - tare);
}

async function buildConingSourceLookupPayload(row) {
  if (!row) return null;

  const issue = row.issue || null;
  const totalWeight = getHoloRowNetWeight(row);
  const totalRolls = Number(row.rollCount || 0);
  const dispatchedCount = Number(row.dispatchedCount || 0);
  const dispatchedWeight = Number(row.dispatchedWeight || 0);
  const issuedToConingMap = await buildHoloIssuedToConingMap(prisma, [row.id]);
  const issuedToConing = issuedToConingMap.get(row.id) || { issuedRolls: 0, issuedWeight: 0 };
  const availableWeight = Math.max(0, totalWeight - dispatchedWeight - Number(issuedToConing.issuedWeight || 0));
  const availableRolls = calcAvailableCountFromWeight({
    totalCount: totalRolls,
    issuedCount: issuedToConing.issuedRolls || 0,
    dispatchedCount,
    totalWeight,
    availableWeight,
  }) || 0;
  const trace = await resolveHoloIssueDetails(issue, createTraceCaches());
  const pieceIds = await resolveHoloIssuePieceIds(issue);
  const item = issue?.itemId
    ? await prisma.item.findUnique({ where: { id: issue.itemId }, select: { id: true, name: true } })
    : null;
  const crateIndex = parseReceiveCrateIndex(row.barcode);
  const legacyBarcode = buildLegacyReceiveBarcode('RHO', issue?.lotNo, crateIndex);

  const outcome = (availableRolls > 0 && availableWeight > TAKE_BACK_EPSILON) ? 'found' : 'unavailable';

  return {
    outcome,
    ...(outcome === 'unavailable' ? { error: 'No rolls available for issue (may have been dispatched or already issued).' } : {}),
    row: {
      id: row.id,
      date: row.date,
      issueId: row.issueId,
      pieceId: row.pieceId,
      rollCount: totalRolls,
      rollWeight: totalWeight,
      grossWeight: Number(row.grossWeight || 0),
      tareWeight: Number(row.tareWeight || 0),
      barcode: row.barcode,
      legacyBarcode,
      notes: row.notes || '',
      dispatchedCount,
      dispatchedWeight,
      issuedToConingRolls: issuedToConing.issuedRolls || 0,
      issuedToConingWeight: issuedToConing.issuedWeight || 0,
      availableRolls,
      availableWeight: roundTo3Decimals(availableWeight),
      computedPieceIds: pieceIds,
      issue: issue ? {
        id: issue.id,
        lotNo: issue.lotNo,
        itemId: issue.itemId,
        yarnId: issue.yarnId,
        twistId: issue.twistId,
        cutId: issue.cutId,
        cut: issue.cut ? { name: issue.cut.name } : null,
      } : null,
    },
    issue: issue ? {
      id: issue.id,
      lotNo: issue.lotNo,
      itemId: issue.itemId,
      itemName: item?.name || '',
      yarnId: issue.yarnId,
      twistId: issue.twistId,
      cutId: issue.cutId,
    } : null,
    trace,
    pieceIds,
    availability: {
      totalRolls,
      totalWeight: roundTo3Decimals(totalWeight),
      dispatchedCount,
      dispatchedWeight,
      issuedToConingRolls: issuedToConing.issuedRolls || 0,
      issuedToConingWeight: issuedToConing.issuedWeight || 0,
      availableRolls,
      availableWeight: roundTo3Decimals(availableWeight),
    },
  };
}

async function fetchHoloReceiveData({ issueLotLabelMap, issueLotNosMap, cutterRowPieceMap, includeAll = false }) {
  const receive_from_holo_machine_rows_raw = await prisma.receiveFromHoloMachineRow.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' },
    ...(includeAll ? {} : { take: RECEIVE_ROWS_FETCH_LIMIT }),
    include: {
      operator: { select: { id: true, name: true } },
      helper: { select: { id: true, name: true } },
      issue: { select: { id: true, lotNo: true, itemId: true, barcode: true, date: true, yarnId: true, twistId: true, cutId: true, cut: { select: { name: true } }, receivedRowRefs: true } },
      rollType: { select: { id: true, name: true, weight: true } },
      box: { select: { id: true, name: true, weight: true } },
    },
  });

  const holoRowRefs = receive_from_holo_machine_rows_raw
    .flatMap(r => {
      const refs = Array.isArray(r.issue?.receivedRowRefs) ? r.issue.receivedRowRefs : [];
      return refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
    });
  const uniqueHoloRowRefs = [...new Set(holoRowRefs)];
  const cutterRowsForHolo = uniqueHoloRowRefs.length > 0
    ? await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: uniqueHoloRowRefs } },
      select: { id: true, pieceId: true },
    })
    : [];
  const holoCutterRowPieceMap = new Map(cutterRowsForHolo.map(r => [r.id, r.pieceId]));

  const holoRowIds = receive_from_holo_machine_rows_raw.map(r => r.id);
  const holoBarcodes = receive_from_holo_machine_rows_raw.map(r => r.barcode).filter(Boolean);

  const steamLogs = await prisma.boilerSteamLog.findMany({
    where: {
      OR: [
        { holoReceiveRowId: { in: holoRowIds } },
        { barcode: { in: holoBarcodes } }
      ]
    },
    select: {
      barcode: true,
      steamedAt: true,
      holoReceiveRowId: true,
      boilerMachineId: true,
      boilerNumber: true,
      boilerMachine: { select: { name: true } },
    }
  });
  const steamedByBarcode = new Map(steamLogs.map(s => [s.barcode?.toUpperCase(), s]));
  const steamedByRowId = new Map(steamLogs.filter(s => s.holoReceiveRowId).map(s => [s.holoReceiveRowId, s]));

  const holoIssuedToConingMap = await buildHoloIssuedToConingMap(prisma, receive_from_holo_machine_rows_raw.map(r => r.id));

  const receive_from_holo_machine_rows = receive_from_holo_machine_rows_raw.map(r => {
    const refs = Array.isArray(r.issue?.receivedRowRefs) ? r.issue.receivedRowRefs : [];
    const pieceIds = new Set();
    if (r.pieceId) {
      pieceIds.add(r.pieceId);
    } else {
      refs.forEach(ref => {
        if (typeof ref?.rowId === 'string') {
          const pieceId = holoCutterRowPieceMap.get(ref.rowId);
          if (pieceId) pieceIds.add(pieceId);
        }
      });
    }

    if (pieceIds.size === 0 && r.issue?.lotNo) {
      pieceIds.add(`${r.issue.lotNo}-1`);
    }

    const issueCopy = r.issue ? { ...r.issue } : null;
    if (issueCopy && issueLotLabelMap.has(issueCopy.id)) {
      issueCopy.lotLabel = issueLotLabelMap.get(issueCopy.id);
    }
    if (issueCopy && issueLotNosMap.has(issueCopy.id)) {
      issueCopy.lotNos = issueLotNosMap.get(issueCopy.id);
    }
    if (issueCopy) delete issueCopy.receivedRowRefs;
    const crateIndex = parseReceiveCrateIndex(r.barcode);
    const legacyBarcode = buildLegacyReceiveBarcode('RHO', r.issue?.lotNo, crateIndex);
    const steamLog = steamedByRowId.get(r.id) || steamedByBarcode.get(r.barcode?.toUpperCase());
    const issuedToConing = holoIssuedToConingMap.get(r.id) || { issuedRolls: 0, issuedWeight: 0 };

    return {
      ...r,
      issue: issueCopy,
      computedPieceIds: Array.from(pieceIds),
      legacyBarcode,
      isSteamed: !!steamLog,
      steamedAt: steamLog?.steamedAt || null,
      boilerMachineId: steamLog?.boilerMachineId || null,
      boilerMachineName: steamLog?.boilerMachine?.name || null,
      boilerNumber: steamLog?.boilerNumber || null,
      issuedToConingRolls: issuedToConing.issuedRolls || 0,
      issuedToConingWeight: issuedToConing.issuedWeight || 0,
    };
  });

  const receive_from_holo_machine_piece_totals = await prisma.receiveFromHoloMachinePieceTotal.findMany();
  return { receive_from_holo_machine_rows, receive_from_holo_machine_piece_totals, receive_from_holo_machine_rows_raw };
}

async function fetchConingReceiveData({ receive_from_holo_machine_rows_raw, includeAll = false }) {
  const receive_from_coning_machine_rows_raw = await prisma.receiveFromConingMachineRow.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' },
    ...(includeAll ? {} : { take: RECEIVE_ROWS_FETCH_LIMIT }),
    include: {
      operator: { select: { id: true, name: true } },
      helper: { select: { id: true, name: true } },
      issue: { select: { id: true, lotNo: true, barcode: true, date: true, itemId: true, receivedRowRefs: true } },
      box: { select: { id: true, name: true, weight: true } },
    },
  });

  const coningHoloRowRefs = receive_from_coning_machine_rows_raw
    .flatMap(r => {
      const refs = Array.isArray(r.issue?.receivedRowRefs) ? r.issue.receivedRowRefs : [];
      return refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
    });
  const uniqueConingHoloRowRefs = [...new Set(coningHoloRowRefs)];
  const holoRowsForConing = uniqueConingHoloRowRefs.length > 0
    ? await prisma.receiveFromHoloMachineRow.findMany({
      where: { id: { in: uniqueConingHoloRowRefs }, isDeleted: false },
      select: { id: true, issueId: true },
    })
    : [];
  const holoIssueIds = [...new Set(holoRowsForConing.map(r => r.issueId).filter(Boolean))];
  const holoIssuesForConing = holoIssueIds.length > 0
    ? await prisma.issueToHoloMachine.findMany({
      where: { id: { in: holoIssueIds }, isDeleted: false },
      select: { id: true, receivedRowRefs: true },
    })
    : [];
  const holoIssueMap = new Map(holoIssuesForConing.map(i => [i.id, i]));
  const holoRowIssueMap = new Map(holoRowsForConing.map(r => [r.id, r.issueId]));

  const coningCutterRowRefs = holoIssuesForConing.flatMap(issue => {
    const refs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
    return refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
  });
  const uniqueConingCutterRowRefs = [...new Set(coningCutterRowRefs)];
  const cutterRowsForConing = uniqueConingCutterRowRefs.length > 0
    ? await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: uniqueConingCutterRowRefs } },
      select: { id: true, pieceId: true },
    })
    : [];
  const coningCutterRowPieceMap = new Map(cutterRowsForConing.map(r => [r.id, r.pieceId]));

  const receive_from_coning_machine_rows = receive_from_coning_machine_rows_raw.map(r => {
    const refs = Array.isArray(r.issue?.receivedRowRefs) ? r.issue.receivedRowRefs : [];
    const pieceIds = new Set();
    refs.forEach(ref => {
      if (typeof ref?.rowId === 'string') {
        const holoIssueId = holoRowIssueMap.get(ref.rowId);
        if (holoIssueId) {
          const holoIssue = holoIssueMap.get(holoIssueId);
          if (holoIssue) {
            const hRefs = Array.isArray(holoIssue.receivedRowRefs) ? holoIssue.receivedRowRefs : [];
            hRefs.forEach(hRef => {
              if (typeof hRef?.rowId === 'string') {
                const pieceId = coningCutterRowPieceMap.get(hRef.rowId);
                if (pieceId) pieceIds.add(pieceId);
              }
            });
          }
        }
      }
    });

    if (pieceIds.size === 0 && r.issue?.lotNo) {
      pieceIds.add(`${r.issue.lotNo}-1`);
    }

    const issueCopy = r.issue ? { ...r.issue } : null;
    if (issueCopy) delete issueCopy.receivedRowRefs;
    const crateIndex = parseReceiveCrateIndex(r.barcode);
    const legacyBarcode = buildLegacyReceiveBarcode('RCO', r.issue?.lotNo, crateIndex);
    return { ...r, issue: issueCopy, computedPieceIds: Array.from(pieceIds), legacyBarcode };
  });

  const receive_from_coning_machine_piece_totals = await prisma.receiveFromConingMachinePieceTotal.findMany();
  return { receive_from_coning_machine_rows, receive_from_coning_machine_piece_totals };
}

async function buildProcessData(process, options = {}) {
  const includeAll = Boolean(options.includeAll);
  const { lots, inbound_items } = await fetchInboundBasics();
  const issue_to_cutter_machine_raw = process === 'cutter'
    ? await prisma.issueToCutterMachine.findMany({ where: { isDeleted: false } })
    : [];
  const issue_to_holo_machine_raw = (process === 'holo' || process === 'coning')
    ? await prisma.issueToHoloMachine.findMany({ where: { isDeleted: false }, orderBy: { createdAt: 'desc' } })
    : [];
  const issue_to_coning_machine_raw = process === 'coning'
    ? await prisma.issueToConingMachine.findMany({ where: { isDeleted: false }, orderBy: { createdAt: 'desc' } })
    : [];
  const issue_take_backs_raw = await prisma.issueTakeBack.findMany({
    where: { stage: process },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  });

  const cutterData = await fetchCutterReceiveData({ includeAll });
  const cutterRowPieceMap = new Map(cutterData.receive_from_cutter_machine_rows.map(r => [r.id, r.pieceId]));
  const issue_take_backs = await resolveUserFields(issue_take_backs_raw);

  if (process === 'cutter') {
    // Resolve user fields on cutter issues
    const issue_to_cutter_machine = await resolveUserFields(issue_to_cutter_machine_raw);
    const cutterIssueIds = issue_to_cutter_machine.map((issue) => issue.id).filter(Boolean);
    const issue_to_cutter_machine_lines = cutterIssueIds.length > 0
      ? await prisma.issueToCutterMachineLine.findMany({
        where: { issueId: { in: cutterIssueIds } },
        orderBy: { createdAt: 'desc' },
      })
      : [];
    const issue_balances = await buildIssueBalancesByStage(prisma, 'cutter', issue_to_cutter_machine);
    return {
      lots,
      inbound_items,
      issue_to_cutter_machine,
      issue_to_cutter_machine_lines,
      issue_take_backs,
      issue_balances,
      ...cutterData,
    };
  }

  // Resolve user fields on holo issues
  const issue_to_holo_machine_resolved = await resolveUserFields(issue_to_holo_machine_raw);
  const { issue_to_holo_machine, issueLotLabelMap, issueLotNosMap } = buildIssueToHoloMachine(issue_to_holo_machine_resolved, cutterRowPieceMap, inbound_items);
  const holoData = await fetchHoloReceiveData({ issueLotLabelMap, issueLotNosMap, cutterRowPieceMap, includeAll });

  // Resolve user fields on holo receive rows
  const receive_from_holo_machine_rows = await resolveUserFields(holoData.receive_from_holo_machine_rows);

  if (process === 'holo') {
    const issue_balances = await buildIssueBalancesByStage(prisma, 'holo', issue_to_holo_machine);
    return {
      lots,
      inbound_items,
      issue_to_holo_machine,
      issue_take_backs,
      issue_balances,
      receive_from_holo_machine_rows,
      receive_from_holo_machine_piece_totals: holoData.receive_from_holo_machine_piece_totals,
      receive_from_cutter_machine_rows: cutterData.receive_from_cutter_machine_rows,
    };
  }

  // Resolve user fields on coning issues
  const issue_to_coning_machine = await resolveUserFields(issue_to_coning_machine_raw);
  const coningData = await fetchConingReceiveData({ receive_from_holo_machine_rows_raw: holoData.receive_from_holo_machine_rows_raw, includeAll });
  const issue_balances = await buildIssueBalancesByStage(prisma, 'coning', issue_to_coning_machine);

  // Resolve user fields on coning receive rows
  const receive_from_coning_machine_rows = await resolveUserFields(coningData.receive_from_coning_machine_rows);

  return {
    lots,
    inbound_items,
    issue_to_holo_machine,
    issue_to_coning_machine,
    issue_take_backs,
    issue_balances,
    receive_from_cutter_machine_rows: cutterData.receive_from_cutter_machine_rows,
    receive_from_holo_machine_rows,
    receive_from_coning_machine_rows,
    receive_from_coning_machine_piece_totals: coningData.receive_from_coning_machine_piece_totals,
  };
}

async function buildOpeningStockData() {
  const processData = await buildProcessData('coning');
  return {
    inbound_items: processData.inbound_items,
    issue_to_holo_machine: processData.issue_to_holo_machine,
    issue_to_coning_machine: processData.issue_to_coning_machine,
    receive_from_cutter_machine_rows: processData.receive_from_cutter_machine_rows,
    receive_from_holo_machine_rows: processData.receive_from_holo_machine_rows,
    receive_from_coning_machine_rows: processData.receive_from_coning_machine_rows,
  };
}

router.get('/api/bootstrap', async (req, res) => {
  try {
    const settingsRow = await prisma.settings.findFirst();
    const brand = buildBrandPayload(settingsRow);

    const allowed = {
      items: hasAnyReadPermission(req, ['inbound', 'issue.cutter', 'issue.holo', 'issue.coning', 'receive.cutter', 'receive.holo', 'receive.coning', 'stock', 'dispatch', 'opening_stock', 'reports', 'masters']),
      yarns: hasAnyReadPermission(req, ['issue.holo', 'issue.coning', 'receive.holo', 'receive.coning', 'stock', 'opening_stock', 'reports', 'masters']),
      cuts: hasAnyReadPermission(req, ['issue.cutter', 'issue.holo', 'issue.coning', 'receive.cutter', 'receive.holo', 'receive.coning', 'stock', 'opening_stock', 'reports', 'masters']),
      twists: hasAnyReadPermission(req, ['issue.holo', 'issue.coning', 'receive.holo', 'receive.coning', 'stock', 'opening_stock', 'reports', 'masters']),
      firms: hasAnyReadPermission(req, ['inbound', 'dispatch', 'opening_stock', 'reports', 'masters']),
      suppliers: hasAnyReadPermission(req, ['inbound', 'stock', 'opening_stock', 'reports', 'masters']),
      customers: hasAnyReadPermission(req, ['dispatch', 'reports', 'masters']),
      machines: hasAnyReadPermission(req, ['issue.cutter', 'issue.holo', 'issue.coning', 'receive.cutter', 'receive.holo', 'receive.coning', 'boiler', 'opening_stock', 'masters']),
      workers: hasAnyReadPermission(req, ['issue.cutter', 'issue.holo', 'issue.coning', 'receive.cutter', 'receive.holo', 'receive.coning', 'boiler', 'opening_stock', 'masters']),
      bobbins: hasAnyReadPermission(req, ['receive.cutter', 'stock', 'opening_stock', 'masters']),
      boxes: hasAnyReadPermission(req, ['receive.cutter', 'receive.holo', 'receive.coning', 'stock', 'opening_stock', 'box_transfer', 'masters']),
      roll_types: hasAnyReadPermission(req, ['receive.holo', 'stock', 'opening_stock', 'masters']),
      holo_production_per_hours: hasReadPermission(req, 'masters'),
      holo_other_wastage_items: hasReadPermission(req, 'masters'),
      cone_types: hasAnyReadPermission(req, ['issue.coning', 'receive.coning', 'stock', 'opening_stock', 'masters']),
      wrappers: hasAnyReadPermission(req, ['issue.coning', 'receive.coning', 'stock', 'opening_stock', 'masters']),
      settings: hasReadPermission(req, 'settings'),
    };

    const slices = {};
    slices.items = allowed.items ? await prisma.item.findMany() : [];
    slices.yarns = allowed.yarns ? await prisma.yarn.findMany() : [];
    slices.cuts = allowed.cuts ? await prisma.cut.findMany({ orderBy: { name: 'asc' } }) : [];
    slices.twists = allowed.twists ? await prisma.twist.findMany({ orderBy: { name: 'asc' } }) : [];
    slices.firms = allowed.firms ? await prisma.firm.findMany() : [];
    slices.suppliers = allowed.suppliers ? await prisma.supplier.findMany() : [];
    slices.customers = allowed.customers ? await prisma.customer.findMany({ orderBy: { name: 'asc' } }) : [];
    slices.machines = allowed.machines ? await prisma.machine.findMany() : [];
    slices.workers = allowed.workers ? await prisma.operator.findMany() : [];
    slices.bobbins = allowed.bobbins ? await prisma.bobbin.findMany() : [];
    slices.boxes = allowed.boxes ? await prisma.box.findMany() : [];
    slices.roll_types = allowed.roll_types ? await prisma.rollType.findMany() : [];
    slices.holo_production_per_hours = allowed.holo_production_per_hours
      ? await prisma.holoProductionPerHour.findMany({
        include: {
          yarn: true,
          cut: true,
        },
        orderBy: [
          { yarn: { name: 'asc' } },
          { cutMatcher: 'asc' },
        ],
      })
      : [];
    slices.holo_other_wastage_items = allowed.holo_other_wastage_items
      ? await prisma.holoOtherWastageItem.findMany({ orderBy: { name: 'asc' } })
      : [];
    slices.cone_types = allowed.cone_types ? await prisma.coneType.findMany() : [];
    slices.wrappers = allowed.wrappers ? await prisma.wrapper.findMany() : [];
    slices.settings = allowed.settings
      ? (await prisma.settings.findMany()).map(sanitizeSettingsForResponse)
      : [];

    // Resolve user fields for master data (for User columns in Masters page)
    const masterSliceKeys = ['items', 'yarns', 'cuts', 'twists', 'firms', 'suppliers', 'customers', 'machines', 'workers', 'bobbins', 'boxes', 'roll_types', 'holo_production_per_hours', 'holo_other_wastage_items', 'cone_types', 'wrappers'];
    for (const key of masterSliceKeys) {
      if (slices[key] && slices[key].length > 0) {
        slices[key] = await resolveUserFields(slices[key], ['createdByUserId', 'updatedByUserId']);
      }
    }

    res.json({ brand, allowed, slices });
  } catch (err) {
    console.error('Failed to load bootstrap', err);
    res.status(500).json({ error: err.message || 'Failed to load bootstrap data' });
  }
});

router.get('/api/module/inbound', requirePermission('inbound', PERM_READ), async (req, res) => {
  try {
    const data = await fetchInboundBasics();
    res.json(data);
  } catch (err) {
    console.error('Failed to load inbound module data', err);
    res.status(500).json({ error: err.message || 'Failed to load inbound data' });
  }
});

router.get('/api/module/process/:process', async (req, res) => {
  try {
    const process = String(req.params.process || '').toLowerCase();
    if (!['cutter', 'holo', 'coning'].includes(process)) {
      return res.status(400).json({ error: 'Invalid process' });
    }
    const allowed = hasReadPermission(req, 'stock')
      || hasReadPermission(req, `issue.${process}`)
      || hasReadPermission(req, `receive.${process}`);
    if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });

    const fullFlag = String(req.query?.full || '').toLowerCase();
    const includeAll = fullFlag === '1' || fullFlag === 'true' || fullFlag === 'yes';
    const data = await buildProcessData(process, { includeAll });
    res.json(data);
  } catch (err) {
    console.error('Failed to load process module data', err);
    res.status(500).json({ error: err.message || 'Failed to load process data' });
  }
});

router.get('/api/module/opening_stock', requirePermission('opening_stock', PERM_READ), async (req, res) => {
  try {
    const data = await buildOpeningStockData();
    res.json(data);
  } catch (err) {
    console.error('Failed to load opening stock module data', err);
    res.status(500).json({ error: err.message || 'Failed to load opening stock data' });
  }
});

router.get('/api/db', async (req, res) => {
  return res.status(410).json({ error: 'Deprecated. Use /api/bootstrap and /api/module/* endpoints.' });
});


router.get('/api/receive_from_cutter_machine/piece/:pieceId/crate_stats', requirePermission('receive.cutter', PERM_READ), async (req, res) => {
  try {
    const rawPieceId = req.params.pieceId;
    const pieceId = normalizePieceId(rawPieceId);
    if (!pieceId) {
      return res.status(400).json({ error: 'Invalid piece id' });
    }

    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { pieceId, isDeleted: false },
      select: { id: true, barcode: true },
    });

    let maxCrateIndex = 0;
    let missingCrateBarcodes = 0;
    for (const row of rows) {
      const crateIndex = parseReceiveCrateIndex(row.barcode);
      if (crateIndex == null) {
        missingCrateBarcodes += 1;
        continue;
      }
      if (crateIndex > maxCrateIndex) {
        maxCrateIndex = crateIndex;
      }
    }

    res.json({
      pieceId,
      totalCrates: rows.length,
      maxCrateIndex,
      missingCrateBarcodes,
    });
  } catch (err) {
    console.error('Failed to fetch crate stats', err);
    res.status(500).json({ error: 'Failed to fetch crate stats' });
  }
});

router.get('/api/issue_to_cutter_machine', requirePermission('issue.cutter', PERM_READ), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode query param' });
    const issue = await prisma.issueToCutterMachine.findFirst({ where: { barcode, isDeleted: false } });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').filter(Boolean) : [];
    res.json({ ...issue, pieceIds });
  } catch (err) {
    console.error('Failed to fetch issue by barcode', err);
    res.status(500).json({ error: 'Failed to fetch issue' });
  }
});

router.get('/api/inbound_items/barcode/:code', requirePermission('inbound', PERM_READ), async (req, res) => {
  try {
    const code = normalizeBarcodeInput(req.params.code);
    if (!code) return res.status(400).json({ error: 'Missing barcode' });
    const piece = await prisma.inboundItem.findUnique({ where: { barcode: code } });
    if (!piece) return res.status(404).json({ error: 'Barcode not found' });
    res.json(piece);
  } catch (err) {
    console.error('Failed to lookup inbound barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

router.get('/api/issue_to_cutter_machine/lookup', requirePermission('issue.cutter', PERM_READ), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
    const issue = await prisma.issueToCutterMachine.findFirst({ where: { barcode, isDeleted: false } });
    if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
    const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean) : [];
    res.json({ ...issue, pieceIds });
  } catch (err) {
    console.error('Failed to lookup issue barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

router.get('/api/issue_to_holo_machine/lookup', requirePermission('issue.holo', PERM_READ), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
    const issue = await prisma.issueToHoloMachine.findFirst({ where: { barcode, isDeleted: false } });
    if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
    const receivedRefs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
    const rowIds = receivedRefs.map((r) => (typeof r?.rowId === 'string' ? r.rowId : null)).filter(Boolean);
    const rows = rowIds.length > 0
      ? await prisma.receiveFromCutterMachineRow.findMany({
        where: { id: { in: rowIds }, isDeleted: false },
        select: {
          id: true,
          bobbinId: true,
          pieceId: true,
          barcode: true,
          netWt: true,
          tareWt: true,
          pktBoxWt: true,
          pcsBoxWt: true,
          grossWt: true,
          bobbinQuantity: true,
        },
      })
      : [];
    const bobbinIds = Array.from(new Set(rows.map((r) => r.bobbinId).filter(Boolean)));
    const bobbins = bobbinIds.length > 0
      ? await prisma.bobbin.findMany({
        where: { id: { in: bobbinIds } },
        select: { id: true, name: true },
      })
      : [];
    const bobbinNameById = new Map(bobbins.map((b) => [b.id, b.name || '']));
    const pieceIds = Array.from(new Set(rows.map((r) => r.pieceId).filter(Boolean)));
    if (pieceIds.length === 0 && issue?.lotNo) {
      pieceIds.push(`${issue.lotNo}-1`);
    }
    const pieces = pieceIds.length
      ? await prisma.inboundItem.findMany({
        where: { id: { in: pieceIds } },
        select: { id: true, lotNo: true, itemId: true, seq: true },
      })
      : [];
    const pieceMap = new Map(pieces.map((p) => [p.id, p]));
    const refMap = new Map(receivedRefs.map((r) => [r?.rowId, r]));
    const crates = rows.map((row) => {
      const meta = refMap.get(row.id) || {};
      const piece = pieceMap.get(row.pieceId);
      const crateTare = row.tareWt ?? row.pktBoxWt ?? row.pcsBoxWt ?? 0;
      return {
        rowId: row.id,
        bobbinId: row.bobbinId || null,
        bobbinName: row.bobbinId ? (bobbinNameById.get(row.bobbinId) || null) : null,
        pieceId: row.pieceId,
        lotNo: piece?.lotNo || meta.lotNo || null,
        itemId: piece?.itemId || meta.itemId || null,
        barcode: row.barcode || meta.barcode || null,
        netWeight: row.netWt ?? null,
        grossWeight: row.grossWt ?? null,
        crateTare,
        issuedBobbins: meta.issuedBobbins ?? row.bobbinQuantity ?? null,
      };
    });
    const lotNos = Array.from(new Set(crates.map((c) => c.lotNo).filter(Boolean)));
    const lotLabel = lotNos.length <= 1
      ? (lotNos[0] || issue.lotNo || '')
      : (lotNos.length <= 3 ? `Mixed (${lotNos.join(', ')})` : `Mixed (${lotNos.length})`);
    res.json({ ...issue, pieceIds, lotNos, lotLabel, crates });
  } catch (err) {
    console.error('Failed to lookup holo issue barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

router.get('/api/issue_to_coning_machine/lookup', requirePermission('issue.coning', PERM_READ), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
    const issue = await prisma.issueToConingMachine.findFirst({ where: { barcode, isDeleted: false } });
    if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
    res.json(issue);
  } catch (err) {
    console.error('Failed to lookup coning issue barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

function getTakeBackEventName(stage, action) {
  const suffix = action === 'reversed' ? 'reversed' : 'created';
  return `issue_to_${stage}_machine_takeback_${suffix}`;
}

async function buildIssueTakeBackNotificationPayload(issue, takeBack, client = prisma) {
  const itemRec = issue?.itemId ? await client.item.findUnique({ where: { id: issue.itemId }, select: { name: true } }) : null;
  const machineRec = issue?.machineId ? await client.machine.findUnique({ where: { id: issue.machineId }, select: { name: true } }) : null;
  const operatorRec = issue?.operatorId ? await client.operator.findUnique({ where: { id: issue.operatorId }, select: { name: true } }) : null;
  return {
    issueId: issue?.id || null,
    issueBarcode: issue?.barcode || null,
    takeBackId: takeBack?.id || null,
    itemName: itemRec?.name || '',
    lotNo: issue?.lotNo || '',
    date: takeBack?.date || '',
    totalCount: Number(takeBack?.totalCount || 0),
    totalWeight: Number(takeBack?.totalWeight || 0),
    reason: takeBack?.reason || '',
    note: takeBack?.note || '',
    machineName: machineRec?.name || '',
    operatorName: operatorRec?.name || '',
    createdByUserId: takeBack?.createdByUserId || null,
  };
}

async function loadIssueForTakeBack(client, stage, issueId) {
  const modelKey = getIssueModelByStage(stage);
  const issue = await client[modelKey].findFirst({
    where: { id: issueId, isDeleted: false },
  });
  if (!issue) return null;
  if (stage === 'cutter') {
    const lines = await client.issueToCutterMachineLine.findMany({
      where: { issueId: issue.id },
      select: { pieceId: true, issuedWeight: true },
    });
    return { ...issue, lines };
  }
  return issue;
}

async function applyCutterTakeBackReturn(tx, lines, actorUserId, multiplier = -1) {
  for (const line of lines) {
    const piece = await tx.inboundItem.findUnique({
      where: { id: line.sourceId },
      select: { id: true, weight: true, dispatchedWeight: true, issuedToCutterWeight: true },
    });
    if (!piece) {
      throw new Error(`Inbound piece ${line.sourceId} not found`);
    }

    const currentIssued = Number(piece.issuedToCutterWeight || 0);
    const maxIssueable = Math.max(0, Number(piece.weight || 0) - Number(piece.dispatchedWeight || 0));
    const nextIssuedRaw = roundTo3Decimals(currentIssued + (multiplier * Number(line.weight || 0)));
    if (nextIssuedRaw < -TAKE_BACK_EPSILON) {
      throw new Error(`Cannot reduce issued weight below zero for piece ${line.sourceId}`);
    }
    if (nextIssuedRaw - maxIssueable > TAKE_BACK_EPSILON) {
      throw new Error(`Cannot restore issued weight beyond available capacity for piece ${line.sourceId}`);
    }
    const nextIssued = clampZero(nextIssuedRaw);
    const nextAvailable = Math.max(0, maxIssueable - nextIssued);
    const nextStatus = nextAvailable > TAKE_BACK_EPSILON ? 'available' : 'consumed';

    await tx.inboundItem.update({
      where: { id: line.sourceId },
      data: {
        issuedToCutterWeight: nextIssued,
        status: nextStatus,
        ...actorUpdateFields(actorUserId),
      },
    });
  }
}

async function applyHoloTakeBackReturn(tx, lines, actorUserId, multiplier = -1) {
  for (const line of lines) {
    const sourceRow = await tx.receiveFromCutterMachineRow.findUnique({
      where: { id: line.sourceId },
      select: {
        id: true,
        bobbinQuantity: true,
        netWt: true,
        issuedBobbins: true,
        issuedBobbinWeight: true,
        dispatchedCount: true,
        dispatchedWeight: true,
      },
    });
    if (!sourceRow) {
      throw new Error(`Source cutter row ${line.sourceId} not found`);
    }

    const currentCount = Number(sourceRow.issuedBobbins || 0);
    const currentWeight = Number(sourceRow.issuedBobbinWeight || 0);
    const nextCountRaw = currentCount + (multiplier * Number(line.count || 0));
    const nextWeightRaw = currentWeight + (multiplier * Number(line.weight || 0));
    if (nextCountRaw < -TAKE_BACK_EPSILON || nextWeightRaw < -TAKE_BACK_EPSILON) {
      throw new Error(`Cannot reduce issued counters below zero for row ${line.sourceId}`);
    }

    const maxCount = Math.max(0, Number(sourceRow.bobbinQuantity || 0) - Number(sourceRow.dispatchedCount || 0));
    const maxWeight = Math.max(0, Number(sourceRow.netWt || 0) - Number(sourceRow.dispatchedWeight || 0));
    if (nextCountRaw - maxCount > TAKE_BACK_EPSILON || nextWeightRaw - maxWeight > TAKE_BACK_EPSILON) {
      throw new Error(`Source cutter row ${line.sourceId} does not have enough capacity`);
    }

    await tx.receiveFromCutterMachineRow.update({
      where: { id: line.sourceId },
      data: {
        issuedBobbins: clampZero(nextCountRaw),
        issuedBobbinWeight: clampZero(nextWeightRaw),
        ...actorUpdateFields(actorUserId),
      },
    });
  }
}

async function ensureConingTakeBackReverseCapacity(tx, lines) {
  const sourceIds = Array.from(new Set(lines.map((line) => line.sourceId).filter(Boolean)));
  if (sourceIds.length === 0) return;
  const sourceRows = await tx.receiveFromHoloMachineRow.findMany({
    where: { id: { in: sourceIds }, isDeleted: false },
    select: { id: true, rollCount: true, rollWeight: true, grossWeight: true, tareWeight: true, dispatchedCount: true, dispatchedWeight: true },
  });
  const sourceMap = new Map(sourceRows.map((row) => [row.id, row]));
  const issuedMap = await buildHoloIssuedToConingMap(tx, sourceIds);

  for (const line of lines) {
    const row = sourceMap.get(line.sourceId);
    if (!row) {
      throw new Error(`Source holo row ${line.sourceId} not found`);
    }
    const issued = issuedMap.get(line.sourceId) || { issuedRolls: 0, issuedWeight: 0 };
    const netWeight = Number.isFinite(Number(row.rollWeight))
      ? Number(row.rollWeight)
      : Number(row.grossWeight || 0) - Number(row.tareWeight || 0);
    const maxCount = Math.max(0, Number(row.rollCount || 0) - Number(row.dispatchedCount || 0));
    const maxWeight = Math.max(0, netWeight - Number(row.dispatchedWeight || 0));
    const nextCount = Number(issued.issuedRolls || 0) + Number(line.count || 0);
    const nextWeight = Number(issued.issuedWeight || 0) + Number(line.weight || 0);
    if (nextCount - maxCount > TAKE_BACK_EPSILON || nextWeight - maxWeight > TAKE_BACK_EPSILON) {
      throw new Error(`Source holo row ${line.sourceId} does not have enough capacity`);
    }
  }
}

async function createIssueTakeBackForStage(req, res, stage) {
  try {
    const actorUserId = req.user?.id;
    const issueId = String(req.params.id || '').trim();
    const date = String(req.body?.date || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const note = req.body?.note ? String(req.body.note).trim() : null;
    const normalizedLines = normalizeTakeBackLines(req.body?.lines || []);

    if (!issueId) return res.status(400).json({ error: 'Missing issue id' });
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    if (normalizedLines.length === 0) return res.status(400).json({ error: 'lines must be a non-empty array' });

    if (stage === 'cutter') {
      const badLine = normalizedLines.find((line) => line.weight <= 0);
      if (badLine) return res.status(400).json({ error: `Invalid weight for source ${badLine.sourceId}` });
    } else {
      const badCount = normalizedLines.find((line) => line.count <= 0);
      if (badCount) return res.status(400).json({ error: `Invalid count for source ${badCount.sourceId}` });
      const badWeight = normalizedLines.find((line) => line.weight <= 0);
      if (badWeight) return res.status(400).json({ error: `Invalid weight for source ${badWeight.sourceId}` });
    }

    const txResult = await prisma.$transaction(async (tx) => {
      const issue = await loadIssueForTakeBack(tx, stage, issueId);
      if (!issue) {
        throw new Error('Issue not found');
      }

      const pending = await getIssuePending(tx, stage, issue);
      const originalMap = pending.original.sourceMap || new Map();
      const activeTakeBackBySource = pending.takeBack.activeBySource || new Map();
      const consumedBySource = buildTakeBackConsumedBySource(stage, pending);
      const requestedBySource = aggregateTakeBackLinesBySource(normalizedLines);

      let totalCount = 0;
      let totalWeight = 0;
      for (const line of requestedBySource) {
        const originalLine = originalMap.get(line.sourceId);
        if (!originalLine) {
          throw new Error(`Source ${line.sourceId} does not belong to issue ${issueId}`);
        }
        const takenBackLine = activeTakeBackBySource.get(line.sourceId) || { count: 0, weight: 0 };
        const consumedLine = consumedBySource.get(line.sourceId) || { count: 0, weight: 0 };

        // For coning: skip FIFO-consumed deduction. The user selects source freely;
        // the issue-level pendingWeight check below is the authoritative guard.
        // For cutter/holo: keep existing per-source consumed deduction.
        const lineRemainingWeight = stage === 'coning'
          ? clampZero(Number(originalLine.weight || 0) - Number(takenBackLine.weight || 0))
          : clampZero(Number(originalLine.weight || 0) - Number(takenBackLine.weight || 0) - Number(consumedLine.weight || 0));
        const lineRemainingCount = stage === 'coning'
          ? clampZero(Number(originalLine.count || 0) - Number(takenBackLine.count || 0))
          : clampZero(Number(originalLine.count || 0) - Number(takenBackLine.count || 0) - Number(consumedLine.count || 0));

        if (line.weight - lineRemainingWeight > TAKE_BACK_EPSILON) {
          throw new Error(`Requested weight exceeds remaining allocation for source ${line.sourceId}`);
        }
        if (stage !== 'cutter' && (line.count - lineRemainingCount > TAKE_BACK_EPSILON)) {
          throw new Error(`Requested count exceeds remaining allocation for source ${line.sourceId}`);
        }
        totalCount += Number(line.count || 0);
        totalWeight += Number(line.weight || 0);
      }

      totalCount = clampZero(totalCount);
      totalWeight = clampZero(totalWeight);
      if (totalWeight - pending.pendingWeight > TAKE_BACK_EPSILON) {
        throw new Error('Take-back exceeds issue pending weight');
      }
      if (stage !== 'cutter' && totalCount - pending.pendingCount > TAKE_BACK_EPSILON) {
        throw new Error('Take-back exceeds issue pending count');
      }

      const created = await tx.issueTakeBack.create({
        data: {
          stage,
          issueId: issue.id,
          date,
          reason,
          note,
          totalCount: toNonNegativeInt(totalCount),
          totalWeight: roundTo3Decimals(totalWeight),
          isReverse: false,
          isReversed: false,
          ...actorCreateFields(actorUserId),
          lines: {
            create: normalizedLines.map((line) => ({
              sourceId: line.sourceId,
              sourceBarcode: line.sourceBarcode || (originalMap.get(line.sourceId)?.sourceBarcode || null),
              count: toNonNegativeInt(line.count),
              weight: roundTo3Decimals(line.weight),
              meta: line.meta || {},
              ...actorCreateFields(actorUserId),
            })),
          },
        },
        include: { lines: true },
      });

      if (stage === 'cutter') {
        await applyCutterTakeBackReturn(tx, normalizedLines, actorUserId, -1);
      } else if (stage === 'holo') {
        await applyHoloTakeBackReturn(tx, normalizedLines, actorUserId, -1);
      }

      await logCrudWithActor(req, {
        entityType: 'issue_take_back',
        entityId: created.id,
        action: 'create',
        payload: {
          stage,
          issueId: issue.id,
          totalCount: created.totalCount,
          totalWeight: created.totalWeight,
          reason: created.reason,
          note: created.note,
        },
        client: tx,
      });

      return { issue, created };
    });

    const payload = await buildIssueTakeBackNotificationPayload(txResult.issue, txResult.created);
    sendNotification(getTakeBackEventName(stage, 'created'), payload);

    const issuePending = await getIssuePending(prisma, stage, txResult.issue);
    return res.json({
      ok: true,
      issue_take_back: txResult.created,
      issue_balance: {
        issueId: txResult.issue.id,
        stage,
        originalCount: issuePending.original.totalCount,
        originalWeight: issuePending.original.totalWeight,
        takeBackCount: issuePending.takeBack.activeCount,
        takeBackWeight: issuePending.takeBack.activeWeight,
        netIssuedCount: issuePending.netIssuedCount,
        netIssuedWeight: issuePending.netIssuedWeight,
        receivedCount: issuePending.received.receivedCount,
        receivedWeight: issuePending.received.receivedWeight,
        wastageWeight: issuePending.received.wastageWeight,
        pendingCount: issuePending.pendingCount,
        pendingWeight: issuePending.pendingWeight,
      },
    });
  } catch (err) {
    console.error(`Failed to create ${stage} take-back`, err);
    return res.status(400).json({ error: err.message || 'Failed to create take-back' });
  }
}

async function reverseIssueTakeBack(req, res) {
  try {
    const actorUserId = req.user?.id;
    const takeBackId = String(req.params.id || '').trim();
    const date = String(req.body?.date || '').trim() || new Date().toISOString().slice(0, 10);
    const reason = String(req.body?.reason || '').trim() || 'reverse';
    const note = req.body?.note ? String(req.body.note).trim() : null;

    if (!takeBackId) return res.status(400).json({ error: 'Missing take-back id' });

    const baseRecord = await prisma.issueTakeBack.findUnique({
      where: { id: takeBackId },
      select: { stage: true },
    });
    if (!baseRecord) return res.status(404).json({ error: 'Take-back not found' });
    const stage = normalizeTakeBackStage(baseRecord.stage);
    if (!stage) return res.status(400).json({ error: 'Invalid take-back stage' });
    const permissionKey = getIssuePermissionKeyByStage(stage);
    if (!hasPermissionLevel(req, permissionKey, PERM_READ) || !hasPermissionLevel(req, `${permissionKey}.delete`, PERM_READ)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const txResult = await prisma.$transaction(async (tx) => {
      const original = await tx.issueTakeBack.findUnique({
        where: { id: takeBackId },
        include: { lines: true },
      });
      if (!original) throw new Error('Take-back not found');
      if (original.isReverse) throw new Error('Reverse records cannot be reversed');
      if (original.isReversed) throw new Error('Take-back is already reversed');

      const issue = await loadIssueForTakeBack(tx, stage, original.issueId);
      if (!issue) throw new Error('Issue not found');

      const lines = (original.lines || []).map((line) => ({
        sourceId: line.sourceId,
        sourceBarcode: line.sourceBarcode || null,
        count: toNonNegativeInt(line.count),
        weight: roundTo3Decimals(Number(line.weight || 0)),
        meta: line.meta && typeof line.meta === 'object' ? line.meta : {},
      }));

      if (stage === 'cutter') {
        await applyCutterTakeBackReturn(tx, lines, actorUserId, 1);
      } else if (stage === 'holo') {
        await applyHoloTakeBackReturn(tx, lines, actorUserId, 1);
      } else if (stage === 'coning') {
        await ensureConingTakeBackReverseCapacity(tx, lines);
      }

      const reversed = await tx.issueTakeBack.create({
        data: {
          stage,
          issueId: original.issueId,
          date,
          reason,
          note,
          totalCount: original.totalCount,
          totalWeight: original.totalWeight,
          isReverse: true,
          isReversed: false,
          ...actorCreateFields(actorUserId),
          lines: {
            create: lines.map((line) => ({
              sourceId: line.sourceId,
              sourceBarcode: line.sourceBarcode || null,
              count: line.count,
              weight: line.weight,
              meta: line.meta || {},
              ...actorCreateFields(actorUserId),
            })),
          },
        },
        include: { lines: true },
      });

      await tx.issueTakeBack.update({
        where: { id: original.id },
        data: {
          isReversed: true,
          reversedById: reversed.id,
          ...actorUpdateFields(actorUserId),
        },
      });

      await logCrudWithActor(req, {
        entityType: 'issue_take_back',
        entityId: reversed.id,
        action: 'reverse',
        payload: {
          stage,
          issueId: original.issueId,
          reversedTakeBackId: original.id,
          totalCount: reversed.totalCount,
          totalWeight: reversed.totalWeight,
        },
        client: tx,
      });

      return { issue, reversed };
    });

    const payload = await buildIssueTakeBackNotificationPayload(txResult.issue, txResult.reversed);
    sendNotification(getTakeBackEventName(stage, 'reversed'), payload);
    return res.json({ ok: true, issue_take_back: txResult.reversed });
  } catch (err) {
    console.error('Failed to reverse take-back', err);
    return res.status(400).json({ error: err.message || 'Failed to reverse take-back' });
  }
}

router.get('/api/issue_take_backs', requireAuth, async (req, res) => {
  try {
    const stage = req.query?.stage ? normalizeTakeBackStage(req.query.stage) : null;
    const issueId = req.query?.issueId ? String(req.query.issueId).trim() : null;
    const allStages = ['cutter', 'holo', 'coning'];
    const readableStages = allStages.filter((s) => hasPermissionLevel(req, getIssuePermissionKeyByStage(s), PERM_READ));

    if (req.query?.stage && !stage) {
      return res.status(400).json({ error: 'Invalid stage. Use cutter, holo, or coning' });
    }

    if (readableStages.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (stage && !readableStages.includes(stage)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const where = {
      ...(stage ? { stage } : { stage: { in: readableStages } }),
      ...(issueId ? { issueId } : {}),
    };
    const takeBacksRaw = await prisma.issueTakeBack.findMany({
      where,
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    const issue_take_backs = await resolveUserFields(takeBacksRaw);
    return res.json({ issue_take_backs });
  } catch (err) {
    console.error('Failed to fetch issue take-backs', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch take-back history' });
  }
});

router.post('/api/issue_take_backs/:id/reverse', requireAuth, reverseIssueTakeBack);
router.post('/api/issue_to_cutter_machine/:id/take_back', requirePermission('issue.cutter', PERM_WRITE), async (req, res) => createIssueTakeBackForStage(req, res, 'cutter'));
router.post('/api/issue_to_holo_machine/:id/take_back', requirePermission('issue.holo', PERM_WRITE), async (req, res) => createIssueTakeBackForStage(req, res, 'holo'));
router.post('/api/issue_to_coning_machine/:id/take_back', requirePermission('issue.coning', PERM_WRITE), async (req, res) => createIssueTakeBackForStage(req, res, 'coning'));

router.get('/api/barcodes/render', async (req, res) => {
  try {
    const code = normalizeBarcodeInput(req.query.code);
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const scale = Math.min(Math.max(Number(req.query.scale) || 3, 2), 8);
    const height = Math.min(Math.max(Number(req.query.height) || 12, 8), 30);
    const buffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: code,
      scale,
      height,
      includetext: true,
      textxalign: 'center',
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Failed to render barcode', err);
    res.status(500).json({ error: 'Failed to render barcode' });
  }
});

// Return the next lot number preview (value that will be used on save)
router.get('/api/sequence/next', requirePermission('inbound', PERM_READ), async (req, res) => {
  try {
    const seq = await prisma.sequence.findUnique({ where: { id: 'lot_sequence' } });
    const nextVal = (seq ? seq.nextValue : 0) + 1;
    res.json({ next: String(nextVal).padStart(3, '0'), raw: nextVal });
  } catch (err) {
    console.error('Failed to read sequence', err);
    res.status(500).json({ error: 'Failed to read sequence' });
  }
});

// Return the next cutter purchase lot number preview (value that will be used on save)
router.get(
  '/api/inbound/cutter_purchase/sequence/next',
  requirePermission('inbound', PERM_READ),
  requirePermission('receive.cutter', PERM_READ),
  async (req, res) => {
    try {
      const preview = await getCutterPurchaseLotPreview();
      res.json({ next: preview.lotNo, raw: preview.nextValue });
    } catch (err) {
      console.error('Failed to read cutter purchase sequence', err);
      res.status(500).json({ error: 'Failed to read sequence' });
    }
  },
);

// Reserve a cutter purchase lot number (increments sequence, guarantees lot number for this session)
router.post(
  '/api/inbound/cutter_purchase/reserve',
  requirePermission('inbound', PERM_WRITE),
  requirePermission('receive.cutter', PERM_WRITE),
  async (req, res) => {
    try {
      const actorUserId = req.user?.id;
      // Allocate (increment) the sequence to reserve the lot number
      const seq = await prisma.sequence.upsert({
        where: { id: CUTTER_PURCHASE_LOT_SEQUENCE_ID },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: CUTTER_PURCHASE_LOT_SEQUENCE_ID, nextValue: 1, ...actorCreateFields(actorUserId) },
      });
      const reservedLotNo = formatCutterPurchaseLotNo(seq.nextValue);
      res.json({ ok: true, reservedLotNo, raw: seq.nextValue });
    } catch (err) {
      console.error('Failed to reserve cutter purchase lot', err);
      res.status(500).json({ error: 'Failed to reserve lot number' });
    }
  },
);

// Set the lot sequence to a specific integer value (so the next created lot becomes value+1)
router.post('/api/sequence/set', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { next } = req.body || {};
    const num = Number(next);
    if (!Number.isInteger(num) || num < 0) return res.status(400).json({ error: 'next must be a non-negative integer' });
    const updated = await prisma.sequence.upsert({
      where: { id: 'lot_sequence' },
      update: { nextValue: num, ...actorUpdateFields(actorUserId) },
      create: { id: 'lot_sequence', nextValue: num, ...actorCreateFields(actorUserId) },
    });
    res.json({ ok: true, nextValue: updated.nextValue });
  } catch (err) {
    console.error('Failed to set sequence', err);
    res.status(500).json({ error: 'Failed to set sequence' });
  }
});

// ===== Opening Stock =====

router.get('/api/opening_stock/sequence/next', requirePermission('opening_stock', PERM_READ), async (req, res) => {
  try {
    const preview = await getOpeningLotPreview();
    res.json({ next: preview.lotNo, raw: preview.nextValue });
  } catch (err) {
    console.error('Failed to read opening sequence', err);
    res.status(500).json({ error: 'Failed to read opening sequence' });
  }
});

// Reserve a holo/coning issue series number for opening stock label printing
router.post('/api/opening_stock/issue_series/reserve', requirePermission('opening_stock', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const stage = String(req.body?.stage || '').trim().toLowerCase();
    if (!['holo', 'coning'].includes(stage)) {
      return res.status(400).json({ error: 'stage must be holo or coning' });
    }

    const seriesNumber = await prisma.$transaction(async (tx) => {
      if (stage === 'holo') {
        await ensureHoloIssueSequence(tx, actorUserId);
        const seq = await tx.holoIssueSequence.upsert({
          where: { id: 'holo_issue_seq' },
          update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
          create: { id: 'holo_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
        });
        return seq.nextValue - 1;
      }

      await ensureConingIssueSequence(tx, actorUserId);
      const seq = await tx.coningIssueSequence.upsert({
        where: { id: 'coning_issue_seq' },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: 'coning_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
      });
      return seq.nextValue - 1;
    });

    res.json({ seriesNumber });
  } catch (err) {
    console.error('Failed to reserve opening issue series', err);
    res.status(500).json({ error: err.message || 'Failed to reserve series' });
  }
});

router.post('/api/opening_stock/inbound', requirePermission('opening_stock', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, firmId, supplierId, pieces } = req.body || {};
    if (!date || !itemId || !supplierId) {
      return res.status(400).json({ error: 'Missing required opening stock fields' });
    }
    if (!Array.isArray(pieces) || pieces.length === 0) {
      return res.status(400).json({ error: 'Add at least one piece' });
    }

    const [itemRecord, firmRecord, supplierRecord] = await Promise.all([
      prisma.item.findUnique({ where: { id: itemId } }),
      firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
      prisma.supplier.findUnique({ where: { id: supplierId } }),
    ]);
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
    if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });

    const result = await prisma.$transaction(async (tx) => {
      const lotNo = await allocateOpeningLot(tx, actorUserId);
      const totalWeight = pieces.reduce((sum, p) => sum + (toNumber(p.weight) || 0), 0);

      const lot = await tx.lot.create({
        data: {
          lotNo,
          date,
          itemId,
          firmId: firmId || null,
          supplierId,
          totalPieces: pieces.length,
          totalWeight: roundTo3Decimals(totalWeight),
          ...actorCreateFields(actorUserId),
        },
      });

      const inboundItems = [];
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        const seq = i + 1;
        const weight = toNumber(piece.weight) || 0;
        const isConsumed = Boolean(piece.isConsumed);
        const status = isConsumed ? 'consumed' : 'available';
        const consumptionDate = piece.consumptionDate || null;
        const note = piece.note || null;

        const pieceId = `${lotNo}-${seq}`;
        const barcode = makeInboundBarcode({ lotNo, seq });

        const created = await tx.inboundItem.create({
          data: {
            id: pieceId,
            lotNo,
            itemId,
            weight: roundTo3Decimals(weight),
            status,
            seq,
            barcode,
            consumptionDate,
            note,
            isOpeningStock: true,
            ...actorCreateFields(actorUserId),
          },
        });
        inboundItems.push(created);
      }

      return { lot, rows: inboundItems };
    });

    await logCrudWithActor(req, {
      entityType: 'lot',
      entityId: result.lot.lotNo,
      action: 'create_opening_inbound',
      payload: { date, itemId, firmId, supplierId, pieceCount: pieces.length },
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to save opening inbound', err);
    res.status(500).json({ error: err.message || 'Failed to save opening inbound stock' });
  }
});

router.post('/api/opening_stock/cutter_receive', requirePermission('opening_stock', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, firmId, supplierId, crates } = req.body || {};
    if (!date || !itemId || !supplierId) {
      return res.status(400).json({ error: 'Missing required opening stock fields' });
    }
    if (!Array.isArray(crates) || crates.length === 0) {
      return res.status(400).json({ error: 'Add at least one crate' });
    }

    const [itemRecord, firmRecord, supplierRecord] = await Promise.all([
      prisma.item.findUnique({ where: { id: itemId } }),
      firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
      prisma.supplier.findUnique({ where: { id: supplierId } }),
    ]);
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
    if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });

    const bobbinIds = Array.from(new Set(crates.map(c => c?.bobbinId).filter(Boolean)));
    const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));
    const operatorIds = Array.from(new Set(crates.map(c => c?.operatorId).filter(Boolean)));
    const helperIds = Array.from(new Set(crates.map(c => c?.helperId).filter(Boolean)));
    const cutIds = Array.from(new Set(crates.map(c => c?.cutId).filter(Boolean)));

    const [bobbins, boxes, operators, helpers, cuts] = await Promise.all([
      bobbinIds.length ? prisma.bobbin.findMany({ where: { id: { in: bobbinIds } } }) : Promise.resolve([]),
      boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
      operatorIds.length ? prisma.operator.findMany({ where: { id: { in: operatorIds } } }) : Promise.resolve([]),
      helperIds.length ? prisma.operator.findMany({ where: { id: { in: helperIds } } }) : Promise.resolve([]),
      cutIds.length ? prisma.cut.findMany({ where: { id: { in: cutIds } } }) : Promise.resolve([]),
    ]);

    const bobbinMap = new Map(bobbins.map(b => [b.id, b]));
    const boxMap = new Map(boxes.map(b => [b.id, b]));
    const operatorMap = new Map(operators.map(o => [o.id, o]));
    const helperMap = new Map(helpers.map(h => [h.id, h]));
    const cutMap = new Map(cuts.map(c => [c.id, c]));

    const normalizedCrates = crates.map((crate, idx) => {
      const rowIndex = idx + 1;
      if (!crate?.cutId) {
        throw new Error(`Missing cut for crate ${rowIndex}`);
      }
      const bobbinId = crate?.bobbinId || null;
      const boxId = crate?.boxId || null;
      const bobbin = bobbinId ? bobbinMap.get(bobbinId) : null;
      const box = boxId ? boxMap.get(boxId) : null;
      if (!bobbin) throw new Error(`Missing bobbin for crate ${rowIndex}`);
      if (!box) throw new Error(`Missing box for crate ${rowIndex}`);

      const bobbinQty = Math.max(0, toInt(crate?.bobbinQuantity) || 0);
      if (bobbinQty <= 0) throw new Error(`Invalid bobbin quantity for crate ${rowIndex}`);
      const gross = toNumber(crate?.grossWeight);
      if (!Number.isFinite(gross) || gross <= 0) throw new Error(`Invalid gross weight for crate ${rowIndex}`);

      const bobbinWeightRaw = bobbin.weight;
      const bobbinWeight = Number(bobbinWeightRaw);
      const boxWeight = Number(box.weight);
      if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
        throw new Error('Bobbin weight missing. Update bobbin first.');
      }
      if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
        throw new Error('Box weight missing. Update box first.');
      }

      const tare = bobbinWeight * bobbinQty + boxWeight;
      const net = roundTo3Decimals(gross - tare);
      if (!Number.isFinite(net) || net <= 0) {
        throw new Error(`Net weight must be positive for crate ${rowIndex}`);
      }

      if (!cutMap.has(crate.cutId)) {
        throw new Error(`Cut not found for crate ${rowIndex}`);
      }

      return {
        bobbinId,
        boxId,
        bobbinQty,
        gross,
        tare,
        net,
        operatorId: crate?.operatorId || null,
        helperId: crate?.helperId || null,
        cutId: crate.cutId,
        shift: crate?.shift || null,
        machineNo: crate?.machineNo || null,
        notes: crate?.notes || null,
      };
    });

    const totalNetWeight = roundTo3Decimals(normalizedCrates.reduce((sum, row) => sum + row.net, 0));
    const totalBobbins = normalizedCrates.reduce((sum, row) => sum + row.bobbinQty, 0);
    if (!Number.isFinite(totalNetWeight) || totalNetWeight <= 0) {
      return res.status(400).json({ error: 'Total net weight must be greater than zero' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const lotNo = await allocateOpeningLot(tx, actorUserId);
      const pieceId = `${lotNo}-1`;

      await tx.lot.create({
        data: {
          lotNo,
          date,
          itemId,
          firmId: firmId || null,
          supplierId,
          totalPieces: 1,
          totalWeight: totalNetWeight,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.create({
        data: {
          id: pieceId,
          lotNo,
          itemId,
          weight: totalNetWeight,
          status: 'consumed',
          seq: 1,
          barcode: makeInboundBarcode({ lotNo, seq: 1 }),
          ...actorCreateFields(actorUserId),
        },
      });

      const upload = await tx.receiveFromCutterMachineUpload.create({
        data: {
          originalFilename: 'opening-stock',
          rowCount: normalizedCrates.length,
          ...actorCreateFields(actorUserId),
        },
      });

      const rows = [];
      let crateIndex = 0;
      for (const row of normalizedCrates) {
        crateIndex += 1;
        const barcode = makeReceiveBarcode({ lotNo, seq: 1, crateIndex });
        const vchNo = `OPEN-${randomUUID().slice(0, 8)}`;
        const cut = row.cutId ? cutMap.get(row.cutId) : null;
        const created = await tx.receiveFromCutterMachineRow.create({
          data: {
            uploadId: upload.id,
            pieceId,
            vchNo,
            date,
            itemName: itemRecord?.name || null,
            grossWt: row.gross,
            tareWt: row.tare,
            netWt: row.net,
            totalKg: row.net,
            pktTypeName: boxMap.get(row.boxId)?.name || null,
            pcsTypeName: bobbinMap.get(row.bobbinId)?.name || null,
            bobbinId: row.bobbinId,
            boxId: row.boxId,
            operatorId: row.operatorId,
            helperId: row.helperId,
            bobbinQuantity: row.bobbinQty,
            employee: row.operatorId ? operatorMap.get(row.operatorId)?.name || null : null,
            helperName: row.helperId ? helperMap.get(row.helperId)?.name || null : null,
            cutId: row.cutId || null,
            cut: cut ? cut.name : null,
            shift: row.shift,
            machineNo: row.machineNo,
            notes: row.notes || null,
            narration: 'Opening stock',
            createdBy: 'opening',
            barcode,
            ...actorCreateFields(actorUserId),
          },
        });
        rows.push({ id: created.id, barcode });
      }

      await tx.receiveFromCutterMachinePieceTotal.upsert({
        where: { pieceId },
        update: {
          totalNetWeight: { increment: totalNetWeight },
          totalBob: { increment: totalBobbins },
          ...actorUpdateFields(actorUserId),
        },
        create: {
          pieceId,
          totalNetWeight,
          totalBob: totalBobbins,
          wastageNetWeight: 0,
          ...actorCreateFields(actorUserId),
        },
      });

      return { lotNo, pieceId, uploadId: upload.id, rows };
    });

    await logCrudWithActor(req, {
      entityType: 'opening_cutter_receive',
      entityId: result.uploadId,
      action: 'create',
      payload: {
        lotNo: result.lotNo,
        pieceId: result.pieceId,
        rowCount: result.rows.length,
        totalNetWeight,
        totalBobbins,
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to create opening cutter stock', err);
    res.status(400).json({ error: err.message || 'Failed to create opening cutter stock' });
  }
});

router.post('/api/opening_stock/holo_receive', requirePermission('opening_stock', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, firmId, supplierId, twistId, yarnId, cutId, machineId, operatorId, shift, issueSeries, crates } = req.body || {};
    if (!date || !itemId || !supplierId || !twistId) {
      return res.status(400).json({ error: 'Missing required opening stock fields' });
    }
    if (!Array.isArray(crates) || crates.length === 0) {
      return res.status(400).json({ error: 'Add at least one crate' });
    }
    const hasIssueSeries = issueSeries !== undefined && issueSeries !== null && issueSeries !== '';
    const requestedIssueSeries = hasIssueSeries ? toInt(issueSeries) : null;
    if (hasIssueSeries && (!requestedIssueSeries || requestedIssueSeries <= 0)) {
      return res.status(400).json({ error: 'issueSeries must be a positive integer' });
    }

    const [itemRecord, firmRecord, supplierRecord, twistRecord, cutRecord] = await Promise.all([
      prisma.item.findUnique({ where: { id: itemId } }),
      firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
      prisma.supplier.findUnique({ where: { id: supplierId } }),
      prisma.twist.findUnique({ where: { id: twistId } }),
      cutId ? prisma.cut.findUnique({ where: { id: cutId } }) : Promise.resolve(null),
    ]);
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
    if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });
    if (!twistRecord) return res.status(404).json({ error: 'Twist not found' });
    if (cutId && !cutRecord) return res.status(404).json({ error: 'Cut not found' });

    const rollTypeIds = Array.from(new Set(crates.map(c => c?.rollTypeId).filter(Boolean)));
    const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));

    const [rollTypes, boxes] = await Promise.all([
      rollTypeIds.length ? prisma.rollType.findMany({ where: { id: { in: rollTypeIds } } }) : Promise.resolve([]),
      boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
    ]);

    const rollTypeMap = new Map(rollTypes.map(r => [r.id, r]));
    const boxMap = new Map(boxes.map(b => [b.id, b]));

    const crateIndexSet = new Set();
    const normalizedCrates = crates.map((crate, idx) => {
      const rowIndex = idx + 1;
      const hasCrateIndex = crate?.crateIndex !== undefined && crate?.crateIndex !== null && crate?.crateIndex !== '';
      const requestedCrateIndex = hasCrateIndex ? toInt(crate?.crateIndex) : null;
      if (hasCrateIndex && (!requestedCrateIndex || requestedCrateIndex <= 0)) {
        throw new Error(`Invalid crate index for crate ${rowIndex}`);
      }
      const crateIndex = requestedCrateIndex || rowIndex;
      if (crateIndexSet.has(crateIndex)) {
        throw new Error(`Duplicate crate index ${crateIndex}`);
      }
      crateIndexSet.add(crateIndex);
      const rollTypeId = crate?.rollTypeId || null;
      const rollType = rollTypeId ? rollTypeMap.get(rollTypeId) : null;
      if (!rollType) throw new Error(`Missing roll type for crate ${rowIndex}`);
      const rollTypeWeight = Number(rollType.weight);
      if (!Number.isFinite(rollTypeWeight) || rollTypeWeight <= 0) {
        throw new Error('Roll type weight missing. Update roll type first.');
      }

      const rollCount = Math.max(0, toInt(crate?.rollCount) || 0);
      if (rollCount <= 0) throw new Error(`Invalid roll count for crate ${rowIndex}`);
      const gross = toNumber(crate?.grossWeight);
      if (!Number.isFinite(gross) || gross <= 0) throw new Error(`Invalid gross weight for crate ${rowIndex}`);

      const boxId = crate?.boxId || null;
      const box = boxId ? boxMap.get(boxId) : null;
      const boxWeight = box && Number.isFinite(box.weight) ? Number(box.weight) : 0;
      const crateTare = toNumber(crate?.crateTareWeight) || 0;
      const tare = rollTypeWeight * rollCount + boxWeight + crateTare;
      const net = roundTo3Decimals(gross - tare);
      if (!Number.isFinite(net) || net <= 0) {
        throw new Error(`Net weight must be positive for crate ${rowIndex}`);
      }

      return {
        crateIndex,
        rollTypeId,
        rollCount,
        gross,
        tare,
        net,
        boxId,
        crateTare,
        operatorId: crate?.operatorId || null,
        helperId: crate?.helperId || null,
        machineNo: crate?.machineNo || null,
        notes: crate?.notes || null,
      };
    });

    const totalNetWeight = roundTo3Decimals(normalizedCrates.reduce((sum, row) => sum + row.net, 0));
    const totalRolls = normalizedCrates.reduce((sum, row) => sum + row.rollCount, 0);
    if (!Number.isFinite(totalNetWeight) || totalNetWeight <= 0) {
      return res.status(400).json({ error: 'Total net weight must be greater than zero' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const lotNo = await allocateOpeningLot(tx, actorUserId);
      const pieceId = `${lotNo}-1`;

      await tx.lot.create({
        data: {
          lotNo,
          date,
          itemId,
          firmId: firmId || null,
          supplierId,
          totalPieces: 1,
          totalWeight: totalNetWeight,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.create({
        data: {
          id: pieceId,
          lotNo,
          itemId,
          weight: totalNetWeight,
          status: 'consumed',
          seq: 1,
          barcode: makeInboundBarcode({ lotNo, seq: 1 }),
          ...actorCreateFields(actorUserId),
        },
      });

      let seriesNumber = requestedIssueSeries;
      let issueBarcode = '';
      if (seriesNumber) {
        await ensureHoloIssueSequence(tx, actorUserId);
        issueBarcode = makeHoloIssueBarcode({ series: seriesNumber });
        const existingIssue = await tx.issueToHoloMachine.findFirst({
          where: { barcode: issueBarcode },
          select: { id: true },
        });
        if (existingIssue) {
          throw new Error(`Holo issue series ${seriesNumber} already used`);
        }
        const currentSeq = await tx.holoIssueSequence.findUnique({
          where: { id: 'holo_issue_seq' },
          select: { nextValue: true },
        });
        const nextValue = Number(currentSeq?.nextValue || 0);
        if (nextValue <= seriesNumber) {
          await tx.holoIssueSequence.update({
            where: { id: 'holo_issue_seq' },
            data: { nextValue: seriesNumber + 1, ...actorUpdateFields(actorUserId) },
          });
        }
      } else {
        await ensureHoloIssueSequence(tx, actorUserId);
        const holoSeq = await tx.holoIssueSequence.upsert({
          where: { id: 'holo_issue_seq' },
          update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
          create: { id: 'holo_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
        });
        seriesNumber = holoSeq.nextValue - 1;
        issueBarcode = makeHoloIssueBarcode({ series: seriesNumber });
      }

      const issue = await tx.issueToHoloMachine.create({
        data: {
          date,
          itemId,
          lotNo,
          yarnId: yarnId || null,
          twistId,
          cutId: cutId || null,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: issueBarcode,
          note: 'Opening Stock',
          shift: shift || null,
          metallicBobbins: 0,
          metallicBobbinsWeight: 0,
          yarnKg: 0,
          receivedRowRefs: [],
          ...actorCreateFields(actorUserId),
        },
      });

      const rows = [];
      for (const row of normalizedCrates) {
        const barcode = makeHoloReceiveBarcode({ series: seriesNumber, crateIndex: row.crateIndex });
        const created = await tx.receiveFromHoloMachineRow.create({
          data: {
            issueId: issue.id,
            pieceId,
            date,
            rollCount: row.rollCount,
            rollWeight: row.net,
            grossWeight: row.gross,
            tareWeight: row.tare,
            rollTypeId: row.rollTypeId,
            boxId: row.boxId || null,
            machineNo: row.machineNo || null,
            operatorId: row.operatorId || null,
            helperId: row.helperId || null,
            notes: row.notes || null,
            createdBy: 'opening',
            barcode,
            ...actorCreateFields(actorUserId),
          },
        });
        rows.push({ id: created.id, barcode });
      }

      await tx.receiveFromHoloMachinePieceTotal.upsert({
        where: { pieceId },
        update: {
          totalRolls: { increment: totalRolls },
          totalNetWeight: { increment: totalNetWeight },
          ...actorUpdateFields(actorUserId),
        },
        create: {
          pieceId,
          totalRolls,
          totalNetWeight,
          wastageNetWeight: 0,
          ...actorCreateFields(actorUserId),
        },
      });

      return { lotNo, pieceId, issueId: issue.id, issueBarcode: issue.barcode, rows };
    });

    await logCrudWithActor(req, {
      entityType: 'opening_holo_receive',
      entityId: result.issueId,
      action: 'create',
      payload: {
        lotNo: result.lotNo,
        pieceId: result.pieceId,
        issueId: result.issueId,
        rowCount: result.rows.length,
        totalNetWeight,
        totalRolls,
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to create opening holo stock', err);
    res.status(400).json({ error: err.message || 'Failed to create opening holo stock' });
  }
});

router.post('/api/opening_stock/coning_receive', requirePermission('opening_stock', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, firmId, supplierId, coneTypeId, wrapperId, yarnId, twistId, cutId, machineId, operatorId, shift, issueSeries, crates } = req.body || {};
    if (!date || !itemId || !supplierId || !coneTypeId) {
      return res.status(400).json({ error: 'Missing required opening stock fields' });
    }
    if (!Array.isArray(crates) || crates.length === 0) {
      return res.status(400).json({ error: 'Add at least one crate' });
    }
    const hasIssueSeries = issueSeries !== undefined && issueSeries !== null && issueSeries !== '';
    const requestedIssueSeries = hasIssueSeries ? toInt(issueSeries) : null;
    if (hasIssueSeries && (!requestedIssueSeries || requestedIssueSeries <= 0)) {
      return res.status(400).json({ error: 'issueSeries must be a positive integer' });
    }

    const [itemRecord, firmRecord, supplierRecord, coneTypeRecord] = await Promise.all([
      prisma.item.findUnique({ where: { id: itemId } }),
      firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
      prisma.supplier.findUnique({ where: { id: supplierId } }),
      prisma.coneType.findUnique({ where: { id: coneTypeId } }),
    ]);
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
    if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });
    if (!coneTypeRecord) return res.status(404).json({ error: 'Cone type not found' });
    if (wrapperId) {
      const wrapper = await prisma.wrapper.findUnique({ where: { id: wrapperId } });
      if (!wrapper) return res.status(404).json({ error: 'Wrapper not found' });
    }
    if (yarnId) {
      const yarn = await prisma.yarn.findUnique({ where: { id: yarnId } });
      if (!yarn) return res.status(404).json({ error: 'Yarn not found' });
    }
    if (twistId) {
      const twist = await prisma.twist.findUnique({ where: { id: twistId } });
      if (!twist) return res.status(404).json({ error: 'Twist not found' });
    }
    if (cutId) {
      const cut = await prisma.cut.findUnique({ where: { id: cutId } });
      if (!cut) return res.status(404).json({ error: 'Cut not found' });
    }

    const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));

    const [boxes] = await Promise.all([
      boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
    ]);

    const boxMap = new Map(boxes.map(b => [b.id, b]));

    const coneWeight = Number(coneTypeRecord.weight);
    if (!Number.isFinite(coneWeight) || coneWeight <= 0) {
      return res.status(400).json({ error: 'Cone type weight missing. Update cone type first.' });
    }

    const crateIndexSet = new Set();
    const normalizedCrates = crates.map((crate, idx) => {
      const rowIndex = idx + 1;
      const hasCrateIndex = crate?.crateIndex !== undefined && crate?.crateIndex !== null && crate?.crateIndex !== '';
      const requestedCrateIndex = hasCrateIndex ? toInt(crate?.crateIndex) : null;
      if (hasCrateIndex && (!requestedCrateIndex || requestedCrateIndex <= 0)) {
        throw new Error(`Invalid crate index for crate ${rowIndex}`);
      }
      const crateIndex = requestedCrateIndex || rowIndex;
      if (crateIndexSet.has(crateIndex)) {
        throw new Error(`Duplicate crate index ${crateIndex}`);
      }
      crateIndexSet.add(crateIndex);
      const coneCount = Math.max(0, toInt(crate?.coneCount) || 0);
      if (coneCount <= 0) throw new Error(`Invalid cone count for crate ${rowIndex}`);
      const gross = toNumber(crate?.grossWeight);
      if (!Number.isFinite(gross) || gross <= 0) throw new Error(`Invalid gross weight for crate ${rowIndex}`);

      const boxId = crate?.boxId || null;
      const box = boxId ? boxMap.get(boxId) : null;
      const boxWeight = box && Number.isFinite(box.weight) ? Number(box.weight) : 0;
      const tare = boxWeight + coneWeight * coneCount;
      const net = roundTo3Decimals(gross - tare);
      if (!Number.isFinite(net) || net <= 0) {
        throw new Error(`Net weight must be positive for crate ${rowIndex}`);
      }

      return {
        crateIndex,
        coneCount,
        gross,
        tare,
        net,
        boxId,
        operatorId: crate?.operatorId || null,
        helperId: crate?.helperId || null,
        machineNo: crate?.machineNo || null,
        notes: crate?.notes || null,
      };
    });

    const totalNetWeight = roundTo3Decimals(normalizedCrates.reduce((sum, row) => sum + row.net, 0));
    const totalCones = normalizedCrates.reduce((sum, row) => sum + row.coneCount, 0);
    if (!Number.isFinite(totalNetWeight) || totalNetWeight <= 0) {
      return res.status(400).json({ error: 'Total net weight must be greater than zero' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const lotNo = await allocateOpeningLot(tx, actorUserId);
      const pieceId = `${lotNo}-1`;

      await tx.lot.create({
        data: {
          lotNo,
          date,
          itemId,
          firmId: firmId || null,
          supplierId,
          totalPieces: 1,
          totalWeight: totalNetWeight,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.create({
        data: {
          id: pieceId,
          lotNo,
          itemId,
          weight: totalNetWeight,
          status: 'consumed',
          seq: 1,
          barcode: makeInboundBarcode({ lotNo, seq: 1 }),
          ...actorCreateFields(actorUserId),
        },
      });

      let seriesNumber = requestedIssueSeries;
      let issueBarcode = '';
      if (seriesNumber) {
        await ensureConingIssueSequence(tx, actorUserId);
        issueBarcode = makeConingIssueBarcode({ series: seriesNumber });
        const existingIssue = await tx.issueToConingMachine.findFirst({
          where: { barcode: issueBarcode },
          select: { id: true },
        });
        if (existingIssue) {
          throw new Error(`Coning issue series ${seriesNumber} already used`);
        }
        const currentSeq = await tx.coningIssueSequence.findUnique({
          where: { id: 'coning_issue_seq' },
          select: { nextValue: true },
        });
        const nextValue = Number(currentSeq?.nextValue || 0);
        if (nextValue <= seriesNumber) {
          await tx.coningIssueSequence.update({
            where: { id: 'coning_issue_seq' },
            data: { nextValue: seriesNumber + 1, ...actorUpdateFields(actorUserId) },
          });
        }
      } else {
        await ensureConingIssueSequence(tx, actorUserId);
        const coningSeq = await tx.coningIssueSequence.upsert({
          where: { id: 'coning_issue_seq' },
          update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
          create: { id: 'coning_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
        });
        seriesNumber = coningSeq.nextValue - 1;
        issueBarcode = makeConingIssueBarcode({ series: seriesNumber });
      }

      const issue = await tx.issueToConingMachine.create({
        data: {
          date,
          itemId,
          lotNo,
          yarnId: yarnId || null,
          twistId: twistId || null,
          cutId: cutId || null,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: issueBarcode,
          note: 'Opening Stock',
          shift: shift || null,
          rollsIssued: 0,
          requiredPerConeNetWeight: 0,
          expectedCones: 0,
          receivedRowRefs: [{ coneTypeId, wrapperId: wrapperId || null }],
          ...actorCreateFields(actorUserId),
        },
      });

      const rows = [];
      for (const row of normalizedCrates) {
        const barcode = makeConingReceiveBarcode({ series: seriesNumber, crateIndex: row.crateIndex });
        const created = await tx.receiveFromConingMachineRow.create({
          data: {
            issueId: issue.id,
            coneCount: row.coneCount,
            coneWeight: row.net,
            netWeight: row.net,
            tareWeight: row.tare,
            grossWeight: row.gross,
            barcode,
            boxId: row.boxId || null,
            machineNo: row.machineNo || null,
            operatorId: row.operatorId || null,
            helperId: row.helperId || null,
            notes: row.notes || null,
            date,
            createdBy: 'opening',
            ...actorCreateFields(actorUserId),
          },
        });
        rows.push({ id: created.id, barcode });
      }

      await tx.receiveFromConingMachinePieceTotal.upsert({
        where: { pieceId: issue.id },
        update: {
          totalCones: { increment: totalCones },
          totalNetWeight: { increment: totalNetWeight },
          ...actorUpdateFields(actorUserId),
        },
        create: {
          pieceId: issue.id,
          totalCones,
          totalNetWeight,
          wastageNetWeight: 0,
          ...actorCreateFields(actorUserId),
        },
      });

      return { lotNo, pieceId, issueId: issue.id, issueBarcode: issue.barcode, rows };
    });

    await logCrudWithActor(req, {
      entityType: 'opening_coning_receive',
      entityId: result.issueId,
      action: 'create',
      payload: {
        lotNo: result.lotNo,
        pieceId: result.pieceId,
        issueId: result.issueId,
        rowCount: result.rows.length,
        totalNetWeight,
        totalCones,
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to create opening coning stock', err);
    res.status(400).json({ error: err.message || 'Failed to create opening coning stock' });
  }
});

// Delete a single opening stock cutter receive row
router.delete('/api/opening_stock/cutter_receive_rows/:id', requireDeletePermission('opening_stock'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing row id' });

    const row = await prisma.receiveFromCutterMachineRow.findUnique({ where: { id } });
    if (!row || row.isDeleted) return res.status(404).json({ error: 'Receive row not found' });
    if (!row.pieceId || !isOpeningLotNo(row.pieceId)) {
      return res.status(400).json({ error: 'Only opening stock rows can be removed' });
    }

    const issuedBobbins = Number(row.issuedBobbins || 0);
    const issuedBobbinWeight = Number(row.issuedBobbinWeight || 0);
    if (issuedBobbins > 0 || issuedBobbinWeight > 0) {
      return res.status(400).json({ error: 'Cannot delete row: bobbins already issued' });
    }
    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    if (dispatchedWeight > 0) {
      return res.status(400).json({ error: 'Cannot delete row: already dispatched' });
    }

    const piece = await prisma.inboundItem.findUnique({ where: { id: row.pieceId } });
    if (!piece) return res.status(404).json({ error: 'Linked inbound piece not found' });

    const result = await prisma.$transaction(async (tx) => {
      await tx.receiveFromCutterMachineRow.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      const remainingRows = await tx.receiveFromCutterMachineRow.findMany({
        where: { pieceId: row.pieceId, isDeleted: false },
        select: { netWt: true, bobbinQuantity: true },
      });
      const totalNetWeight = roundTo3Decimals(
        remainingRows.reduce((sum, r) => sum + (Number(r.netWt) || 0), 0)
      );
      const totalBob = remainingRows.reduce((sum, r) => sum + (Number(r.bobbinQuantity) || 0), 0);

      await tx.receiveFromCutterMachinePieceTotal.upsert({
        where: { pieceId: row.pieceId },
        update: { totalNetWeight, totalBob, ...actorUpdateFields(actorUserId) },
        create: {
          pieceId: row.pieceId,
          totalNetWeight,
          totalBob,
          wastageNetWeight: 0,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.update({
        where: { id: row.pieceId },
        data: { weight: totalNetWeight, ...actorUpdateFields(actorUserId) },
      });

      const lotTotals = await recalculateLotTotals(tx, piece.lotNo, actorUserId);

      await logCrudWithActor(req, {
        entityType: 'opening_cutter_receive_row',
        entityId: row.id,
        action: 'delete',
        payload: {
          pieceId: row.pieceId,
          lotNo: piece.lotNo,
          totalNetWeight,
          totalBob,
        },
        client: tx,
      });

      return { totalNetWeight, totalBob, lotTotals };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to delete opening cutter receive row', err);
    res.status(500).json({ error: err.message || 'Failed to delete opening cutter receive row' });
  }
});

// Delete a single opening stock holo receive row
router.delete('/api/opening_stock/holo_receive_rows/:id', requireDeletePermission('opening_stock'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing row id' });

    const row = await prisma.receiveFromHoloMachineRow.findUnique({
      where: { id },
      include: { issue: { select: { id: true, lotNo: true } } },
    });
    if (!row || row.isDeleted || !row.issue) return res.status(404).json({ error: 'Receive row not found' });
    if (!isOpeningLotNo(row.issue.lotNo)) {
      return res.status(400).json({ error: 'Only opening stock rows can be removed' });
    }

    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    if (dispatchedWeight > 0) {
      return res.status(400).json({ error: 'Cannot delete row: already dispatched' });
    }

    const rowIds = [row.id];
    const barcodeArray = row.barcode ? [String(row.barcode)] : [];
    const rowIdArray = rowIds.length ? rowIds : ['__none__'];
    const barcodeCheck = barcodeArray.length ? barcodeArray : ['__none__'];
    const coningUsage = await prisma.$queryRaw`
      SELECT id FROM "IssueToConingMachine"
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
        WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
           OR elem->>'barcode' = ANY (${barcodeCheck}::text[])
      )
    `;
    if (Array.isArray(coningUsage) && coningUsage.length > 0) {
      return res.status(400).json({ error: 'Cannot delete row: already issued to coning' });
    }

    const pieceId = row.pieceId || `${row.issue.lotNo}-1`;
    const piece = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
    if (!piece) return res.status(404).json({ error: 'Linked inbound piece not found' });

    const result = await prisma.$transaction(async (tx) => {
      await tx.receiveFromHoloMachineRow.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      const remainingRows = await tx.receiveFromHoloMachineRow.findMany({
        where: { issueId: row.issueId, isDeleted: false },
        select: { rollCount: true, rollWeight: true, grossWeight: true, tareWeight: true },
      });

      const totalRolls = remainingRows.reduce((sum, r) => sum + (Number(r.rollCount) || 0), 0);
      const totalNetWeight = roundTo3Decimals(
        remainingRows.reduce((sum, r) => {
          const net = Number.isFinite(r.rollWeight)
            ? Number(r.rollWeight)
            : (Number(r.grossWeight || 0) - Number(r.tareWeight || 0));
          return sum + (Number(net) || 0);
        }, 0)
      );

      await tx.receiveFromHoloMachinePieceTotal.upsert({
        where: { pieceId },
        update: { totalRolls, totalNetWeight, ...actorUpdateFields(actorUserId) },
        create: {
          pieceId,
          totalRolls,
          totalNetWeight,
          wastageNetWeight: 0,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.update({
        where: { id: pieceId },
        data: { weight: totalNetWeight, ...actorUpdateFields(actorUserId) },
      });

      const lotTotals = await recalculateLotTotals(tx, piece.lotNo, actorUserId);

      await logCrudWithActor(req, {
        entityType: 'opening_holo_receive_row',
        entityId: row.id,
        action: 'delete',
        payload: {
          issueId: row.issueId,
          pieceId,
          lotNo: piece.lotNo,
          totalNetWeight,
          totalRolls,
        },
        client: tx,
      });

      return { totalNetWeight, totalRolls, lotTotals };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to delete opening holo receive row', err);
    res.status(500).json({ error: err.message || 'Failed to delete opening holo receive row' });
  }
});

// Delete a single opening stock coning receive row
router.delete('/api/opening_stock/coning_receive_rows/:id', requireDeletePermission('opening_stock'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing row id' });

    const row = await prisma.receiveFromConingMachineRow.findUnique({
      where: { id },
      include: { issue: { select: { id: true, lotNo: true } } },
    });
    if (!row || row.isDeleted || !row.issue) return res.status(404).json({ error: 'Receive row not found' });
    if (!isOpeningLotNo(row.issue.lotNo)) {
      return res.status(400).json({ error: 'Only opening stock rows can be removed' });
    }

    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    if (dispatchedWeight > 0) {
      return res.status(400).json({ error: 'Cannot delete row: already dispatched' });
    }

    const pieceId = `${row.issue.lotNo}-1`;
    const piece = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
    if (!piece) return res.status(404).json({ error: 'Linked inbound piece not found' });

    const result = await prisma.$transaction(async (tx) => {
      await tx.receiveFromConingMachineRow.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      const remainingRows = await tx.receiveFromConingMachineRow.findMany({
        where: { issueId: row.issueId, isDeleted: false },
        select: { coneCount: true, netWeight: true, coneWeight: true, grossWeight: true, tareWeight: true },
      });

      const totalCones = remainingRows.reduce((sum, r) => sum + (Number(r.coneCount) || 0), 0);
      const totalNetWeight = roundTo3Decimals(
        remainingRows.reduce((sum, r) => {
          const net = Number.isFinite(r.netWeight)
            ? Number(r.netWeight)
            : (Number.isFinite(r.coneWeight) ? Number(r.coneWeight) : (Number(r.grossWeight || 0) - Number(r.tareWeight || 0)));
          return sum + (Number(net) || 0);
        }, 0)
      );

      await tx.receiveFromConingMachinePieceTotal.upsert({
        where: { pieceId: row.issueId },
        update: { totalCones, totalNetWeight, ...actorUpdateFields(actorUserId) },
        create: {
          pieceId: row.issueId,
          totalCones,
          totalNetWeight,
          wastageNetWeight: 0,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.update({
        where: { id: pieceId },
        data: { weight: totalNetWeight, ...actorUpdateFields(actorUserId) },
      });

      const lotTotals = await recalculateLotTotals(tx, piece.lotNo, actorUserId);

      await logCrudWithActor(req, {
        entityType: 'opening_coning_receive_row',
        entityId: row.id,
        action: 'delete',
        payload: {
          issueId: row.issueId,
          pieceId,
          lotNo: piece.lotNo,
          totalNetWeight,
          totalCones,
        },
        client: tx,
      });

      return { totalNetWeight, totalCones, lotTotals };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to delete opening coning receive row', err);
    res.status(500).json({ error: err.message || 'Failed to delete opening coning receive row' });
  }
});

// Helper to parse uploaded buffer (CSV or Excel)
function parseUploadBuffer(buffer, type) {
  let workbook;
  if (type === 'csv' || type === 'text/csv') {
    // Treat as CSV text
    const text = buffer.toString('utf-8');
    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    return records;
  } else {
    // Treat as Excel/Binary
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { raw: false, dateNF: 'yyyy-mm-dd' });
  }
}

// Download Template Endpoint - accepts optional ?stage= query param
router.get('/api/opening_stock/template', requirePermission('opening_stock', PERM_READ), async (req, res) => {
  try {
    const { stage } = req.query;
    const wb = XLSX.utils.book_new();

    // Helper to add sheet
    const addSheet = (name, headers) => {
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    // Stage-specific or all templates
    const commonHeaders = ["Date", "Item Name", "Supplier Name", "Firm Name (Optional)"];

    if (!stage || stage === 'inbound') {
      addSheet("Inbound", [...commonHeaders, "Weight (kg)", "Is Consumed", "Consumption Date"]);
    }
    if (!stage || stage === 'cutter') {
      addSheet("Cutter", [...commonHeaders, "Cut Name", "Machine Name", "Operator Name", "Helper Name", "Shift", "Bobbin Name", "Quantity", "Box Name", "Gross Weight (kg)"]);
    }
    if (!stage || stage === 'holo') {
      addSheet("Holo", [...commonHeaders, "Cutter (Cut Name)", "Twist Name", "Yarn Name", "Machine Name", "Operator Name", "Shift", "Roll Type Name", "Roll Count", "Net Weight (kg)", "Notes"]);
    }
    if (!stage || stage === 'coning') {
      addSheet("Coning", [...commonHeaders, "Machine Name", "Operator Name", "Shift", "Wrapper Name", "Cone Type Name", "Cone Count", "Gross Weight (kg)", "Box Name", "Notes"]);
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = stage ? `Opening_Stock_${stage.charAt(0).toUpperCase() + stage.slice(1)}_Template.xlsx` : "Opening_Stock_Templates.xlsx";

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Failed to download template', err);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// ===== Opening Stock Bulk Upload =====

// Preview endpoint - shows what lots will be created without actually creating them
router.post('/api/opening_stock/preview/:stage', requirePermission('opening_stock', PERM_READ), async (req, res) => {
  try {
    const { stage } = req.params;
    const { fileContent, fileType, date: uiDate, itemId: uiItemId, firmId: uiFirmId, supplierId: uiSupplierId, ...extraParams } = req.body;

    if (!fileContent) return res.status(400).json({ error: 'Missing file content' });

    // Decode and parse file
    const base64Data = fileContent.replace(/^data:.*,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const rows = parseUploadBuffer(buffer, fileType);
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'File is empty' });

    // Collect unique names - including stage-specific fields
    const uniqueItemNames = new Set();
    const uniqueSupplierNames = new Set();
    const uniqueFirmNames = new Set();
    const uniqueTwistNames = new Set();
    const uniqueYarnNames = new Set();
    const uniqueCutNames = new Set();
    const uniqueMachineNames = new Set();
    const uniqueOperatorNames = new Set();
    rows.forEach(row => {
      if (row['Item Name']) uniqueItemNames.add(String(row['Item Name']).trim());
      if (row['Supplier Name']) uniqueSupplierNames.add(String(row['Supplier Name']).trim());
      if (row['Firm Name (Optional)']) uniqueFirmNames.add(String(row['Firm Name (Optional)']).trim());
      if (row['Twist Name']) uniqueTwistNames.add(String(row['Twist Name']).trim());
      if (row['Yarn Name']) uniqueYarnNames.add(String(row['Yarn Name']).trim());
      if (row['Cutter (Cut Name)']) uniqueCutNames.add(String(row['Cutter (Cut Name)']).trim());
      if (row['Machine Name']) uniqueMachineNames.add(String(row['Machine Name']).trim());
      if (row['Operator Name']) uniqueOperatorNames.add(String(row['Operator Name']).trim());
    });

    // Fetch masters
    const [items, suppliers, firms, twists, yarns, cuts, machines, operators] = await Promise.all([
      uniqueItemNames.size > 0 ? prisma.item.findMany({ where: { name: { in: Array.from(uniqueItemNames), mode: 'insensitive' } } }) : [],
      uniqueSupplierNames.size > 0 ? prisma.supplier.findMany({ where: { name: { in: Array.from(uniqueSupplierNames), mode: 'insensitive' } } }) : [],
      uniqueFirmNames.size > 0 ? prisma.firm.findMany({ where: { name: { in: Array.from(uniqueFirmNames), mode: 'insensitive' } } }) : [],
      uniqueTwistNames.size > 0 ? prisma.twist.findMany({ where: { name: { in: Array.from(uniqueTwistNames), mode: 'insensitive' } } }) : [],
      uniqueYarnNames.size > 0 ? prisma.yarn.findMany({ where: { name: { in: Array.from(uniqueYarnNames), mode: 'insensitive' } } }) : [],
      uniqueCutNames.size > 0 ? prisma.cut.findMany({ where: { name: { in: Array.from(uniqueCutNames), mode: 'insensitive' } } }) : [],
      uniqueMachineNames.size > 0 ? prisma.machine.findMany({ where: { name: { in: Array.from(uniqueMachineNames), mode: 'insensitive' } } }) : [],
      uniqueOperatorNames.size > 0 ? prisma.operator.findMany({ where: { name: { in: Array.from(uniqueOperatorNames), mode: 'insensitive' } } }) : [],
    ]);

    const itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));
    const supplierMap = new Map(suppliers.map(x => [x.name.toLowerCase(), x]));
    const firmMap = new Map(firms.map(x => [x.name.toLowerCase(), x]));
    const twistMap = new Map(twists.map(x => [x.name.toLowerCase(), x]));
    const yarnMap = new Map(yarns.map(x => [x.name.toLowerCase(), x]));
    const cutMap = new Map(cuts.map(x => [x.name.toLowerCase(), x]));
    const machineMap = new Map(machines.map(x => [x.name.toLowerCase(), x]));
    const operatorMap = new Map(operators.map(x => [x.name.toLowerCase(), x]));

    // Get item/supplier from UI if provided
    let uiItemName = null;
    let uiSupplierName = null;
    if (uiItemId) {
      const itm = await prisma.item.findUnique({ where: { id: uiItemId } });
      if (itm) uiItemName = itm.name;
    }
    if (uiSupplierId) {
      const sup = await prisma.supplier.findUnique({ where: { id: uiSupplierId } });
      if (sup) uiSupplierName = sup.name;
    }

    // Group rows by Item + Supplier, also collect master validation errors
    const groups = new Map();
    const errors = [];
    const warnings = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;

      let itemName = uiItemName;
      let itemId = uiItemId;
      let supplierName = uiSupplierName;
      let supplierId = uiSupplierId;

      if (row['Item Name']) {
        const name = String(row['Item Name']).trim();
        const itm = itemMap.get(name.toLowerCase());
        if (!itm) {
          errors.push(`Row ${rowIdx}: Item '${name}' not found`);
          continue;
        }
        itemName = itm.name;
        itemId = itm.id;
      }
      if (!itemId) {
        errors.push(`Row ${rowIdx}: Item Name is required`);
        continue;
      }

      if (row['Supplier Name']) {
        const name = String(row['Supplier Name']).trim();
        const sup = supplierMap.get(name.toLowerCase());
        if (!sup) {
          errors.push(`Row ${rowIdx}: Supplier '${name}' not found`);
          continue;
        }
        supplierName = sup.name;
        supplierId = sup.id;
      }
      if (!supplierId) {
        errors.push(`Row ${rowIdx}: Supplier Name is required`);
        continue;
      }

      let firmId = uiFirmId || null;
      if (row['Firm Name (Optional)']) {
        const name = String(row['Firm Name (Optional)']).trim();
        const frm = firmMap.get(name.toLowerCase());
        if (frm) firmId = frm.id;
      }

      let rowDate = uiDate;
      if (row['Date']) rowDate = String(row['Date']);
      if (!rowDate) {
        errors.push(`Row ${rowIdx}: Date is required`);
        continue;
      }

      // Validate Twist (for Holo)
      if (row['Twist Name']) {
        const name = String(row['Twist Name']).trim();
        if (!twistMap.get(name.toLowerCase())) {
          warnings.push(`Row ${rowIdx}: Twist '${name}' not found in masters`);
        }
      }

      // Validate Yarn (for Holo)
      if (row['Yarn Name']) {
        const name = String(row['Yarn Name']).trim();
        if (!yarnMap.get(name.toLowerCase())) {
          warnings.push(`Row ${rowIdx}: Yarn '${name}' not found in masters`);
        }
      }

      // Validate Cut (for Holo)
      if (row['Cutter (Cut Name)']) {
        const name = String(row['Cutter (Cut Name)']).trim();
        if (!cutMap.get(name.toLowerCase())) {
          warnings.push(`Row ${rowIdx}: Cut '${name}' not found in masters`);
        }
      }

      const rowTwistId = extraParams.twistId || (row['Twist Name'] ? twistMap.get(String(row['Twist Name']).trim().toLowerCase())?.id : null);
      const rowYarnId = extraParams.yarnId || (row['Yarn Name'] ? yarnMap.get(String(row['Yarn Name']).trim().toLowerCase())?.id : null);
      const rowMachineId = extraParams.machineId || (row['Machine Name'] ? machineMap.get(String(row['Machine Name']).trim().toLowerCase())?.id : null);
      const rowOperatorId = extraParams.operatorId || (row['Operator Name'] ? operatorMap.get(String(row['Operator Name']).trim().toLowerCase())?.id : null);
      const rowShift = extraParams.shift || (row['Shift'] ? String(row['Shift']) : null);
      const rowCutId = extraParams.cutId || (row['Cutter (Cut Name)'] ? cutMap.get(String(row['Cutter (Cut Name)']).trim().toLowerCase())?.id : null);

      const groupKey = buildOpeningGroupKey(stage, {
        itemId,
        supplierId,
        firmId,
        date: rowDate,
        twistId: rowTwistId,
        yarnId: rowYarnId,
        machineId: rowMachineId,
        operatorId: rowOperatorId,
        shift: rowShift,
        cutId: rowCutId,
      });
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { itemName, supplierName, rowCount: 0 });
      }
      groups.get(groupKey).rowCount++;
    }

    // Get next lot number preview
    const seq = await prisma.sequence.findUnique({ where: { id: OPENING_LOT_SEQUENCE_ID } });
    const nextValue = (seq ? seq.nextValue : 0) + 1;
    const lotsCount = groups.size;

    // Build preview response
    const groupList = Array.from(groups.values());
    const lotAssignments = groupList.map((g, idx) => ({
      lotNo: formatOpeningLotNo(nextValue + idx),
      itemName: g.itemName,
      supplierName: g.supplierName,
      rowCount: g.rowCount
    }));

    res.json({
      totalRows: rows.length,
      lotsToCreate: lotsCount,
      lotAssignments,
      errors: errors.length > 0 ? errors.slice(0, 10) : [],
      hasMoreErrors: errors.length > 10,
      warnings: warnings.length > 0 ? warnings.slice(0, 10) : [],
      hasMoreWarnings: warnings.length > 10
    });
  } catch (err) {
    console.error('Preview failed', err);
    res.status(400).json({ error: err.message || 'Preview failed' });
  }
});

router.post('/api/opening_stock/upload/:stage', requirePermission('opening_stock', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { stage } = req.params;
    const { fileContent, fileType, date: uiDate, itemId: uiItemId, firmId: uiFirmId, supplierId: uiSupplierId, ...extraParams } = req.body;

    if (!fileContent) return res.status(400).json({ error: 'Missing file content' });

    // Decode base64 - frontend uses readAsDataURL which always encodes as base64
    const base64Data = fileContent.replace(/^data:.*,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const rows = parseUploadBuffer(buffer, fileType);
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'File is empty' });

    // Collect all unique names from the file for bulk fetching
    const uniqueItemNames = new Set();
    const uniqueSupplierNames = new Set();
    const uniqueFirmNames = new Set();
    const uniqueTwistNames = new Set();
    const uniqueYarnNames = new Set();
    const uniqueMachineNames = new Set();
    const uniqueOperatorNames = new Set();
    const uniqueWrapperNames = new Set();
    const uniqueCutNames = new Set();

    rows.forEach(row => {
      if (row['Item Name']) uniqueItemNames.add(String(row['Item Name']).trim());
      if (row['Supplier Name']) uniqueSupplierNames.add(String(row['Supplier Name']).trim());
      if (row['Firm Name (Optional)']) uniqueFirmNames.add(String(row['Firm Name (Optional)']).trim());
      if (row['Twist Name']) uniqueTwistNames.add(String(row['Twist Name']).trim());
      if (row['Yarn Name']) uniqueYarnNames.add(String(row['Yarn Name']).trim());
      if (row['Machine Name']) uniqueMachineNames.add(String(row['Machine Name']).trim());
      if (row['Operator Name']) uniqueOperatorNames.add(String(row['Operator Name']).trim());
      if (row['Wrapper Name']) uniqueWrapperNames.add(String(row['Wrapper Name']).trim());
      if (row['Cutter (Cut Name)']) uniqueCutNames.add(String(row['Cutter (Cut Name)']).trim());
    });

    // Prefetch all masters in bulk for performance
    const [items, suppliers, firms, twists, yarns, machines, operators, wrappers, cuts] = await Promise.all([
      uniqueItemNames.size > 0 ? prisma.item.findMany({ where: { name: { in: Array.from(uniqueItemNames), mode: 'insensitive' } } }) : [],
      uniqueSupplierNames.size > 0 ? prisma.supplier.findMany({ where: { name: { in: Array.from(uniqueSupplierNames), mode: 'insensitive' } } }) : [],
      uniqueFirmNames.size > 0 ? prisma.firm.findMany({ where: { name: { in: Array.from(uniqueFirmNames), mode: 'insensitive' } } }) : [],
      uniqueTwistNames.size > 0 ? prisma.twist.findMany({ where: { name: { in: Array.from(uniqueTwistNames), mode: 'insensitive' } } }) : [],
      uniqueYarnNames.size > 0 ? prisma.yarn.findMany({ where: { name: { in: Array.from(uniqueYarnNames), mode: 'insensitive' } } }) : [],
      uniqueMachineNames.size > 0 ? prisma.machine.findMany({ where: { name: { in: Array.from(uniqueMachineNames), mode: 'insensitive' } } }) : [],
      uniqueOperatorNames.size > 0 ? prisma.operator.findMany({ where: { name: { in: Array.from(uniqueOperatorNames), mode: 'insensitive' } } }) : [],
      uniqueWrapperNames.size > 0 ? prisma.wrapper.findMany({ where: { name: { in: Array.from(uniqueWrapperNames), mode: 'insensitive' } } }) : [],
      uniqueCutNames.size > 0 ? prisma.cut.findMany({ where: { name: { in: Array.from(uniqueCutNames), mode: 'insensitive' } } }) : [],
    ]);

    // Create lookup maps (case-insensitive)
    const itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));
    const supplierMap = new Map(suppliers.map(x => [x.name.toLowerCase(), x]));
    const firmMap = new Map(firms.map(x => [x.name.toLowerCase(), x]));
    const twistMap = new Map(twists.map(x => [x.name.toLowerCase(), x]));
    const yarnMap = new Map(yarns.map(x => [x.name.toLowerCase(), x]));
    const machineMap = new Map(machines.map(x => [x.name.toLowerCase(), x]));
    const operatorMap = new Map(operators.map(x => [x.name.toLowerCase(), x]));
    const wrapperMap = new Map(wrappers.map(x => [x.name.toLowerCase(), x]));
    const cutMap = new Map(cuts.map(x => [x.name.toLowerCase(), x]));

    // Group rows by (Item + Supplier) combination - each group becomes one Lot
    const groupedRows = new Map();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;

      // Resolve Item
      let rowItemId = uiItemId;
      if (row['Item Name']) {
        const itm = itemMap.get(String(row['Item Name']).trim().toLowerCase());
        if (!itm) throw new Error(`Row ${rowIdx}: Item '${row['Item Name']}' not found in masters`);
        rowItemId = itm.id;
      }
      if (!rowItemId) throw new Error(`Row ${rowIdx}: Item Name is required`);

      // Resolve Supplier
      let rowSupplierId = uiSupplierId;
      if (row['Supplier Name']) {
        const sup = supplierMap.get(String(row['Supplier Name']).trim().toLowerCase());
        if (!sup) throw new Error(`Row ${rowIdx}: Supplier '${row['Supplier Name']}' not found in masters`);
        rowSupplierId = sup.id;
      }
      if (!rowSupplierId) throw new Error(`Row ${rowIdx}: Supplier Name is required`);

      // Resolve Firm (optional)
      let rowFirmId = uiFirmId;
      if (row['Firm Name (Optional)']) {
        const frm = firmMap.get(String(row['Firm Name (Optional)']).trim().toLowerCase());
        if (frm) rowFirmId = frm.id;
      }

      // Resolve Date
      let rowDate = uiDate;
      if (row['Date']) rowDate = String(row['Date']);
      if (!rowDate) throw new Error(`Row ${rowIdx}: Date is required`);

      const rowTwistId = extraParams.twistId || (row['Twist Name'] ? twistMap.get(String(row['Twist Name']).trim().toLowerCase())?.id : null);
      const rowYarnId = extraParams.yarnId || (row['Yarn Name'] ? yarnMap.get(String(row['Yarn Name']).trim().toLowerCase())?.id : null);
      const rowMachineId = extraParams.machineId || (row['Machine Name'] ? machineMap.get(String(row['Machine Name']).trim().toLowerCase())?.id : null);
      const rowOperatorId = extraParams.operatorId || (row['Operator Name'] ? operatorMap.get(String(row['Operator Name']).trim().toLowerCase())?.id : null);
      const rowShift = extraParams.shift || (row['Shift'] ? String(row['Shift']) : null);
      const rowWrapperId = extraParams.wrapperId || (row['Wrapper Name'] ? wrapperMap.get(String(row['Wrapper Name']).trim().toLowerCase())?.id : null);
      const rowCutId = extraParams.cutId || (row['Cutter (Cut Name)'] ? cutMap.get(String(row['Cutter (Cut Name)']).trim().toLowerCase())?.id : null);

      const groupKey = buildOpeningGroupKey(stage, {
        itemId: rowItemId,
        supplierId: rowSupplierId,
        firmId: rowFirmId,
        date: rowDate,
        twistId: rowTwistId,
        yarnId: rowYarnId,
        machineId: rowMachineId,
        operatorId: rowOperatorId,
        shift: rowShift,
        cutId: rowCutId,
      });
      if (!groupedRows.has(groupKey)) {
        groupedRows.set(groupKey, {
          itemId: rowItemId,
          supplierId: rowSupplierId,
          firmId: rowFirmId,
          date: rowDate,
          twistId: rowTwistId,
          yarnId: rowYarnId,
          machineId: rowMachineId,
          operatorId: rowOperatorId,
          shift: rowShift,
          wrapperId: rowWrapperId,
          cutId: rowCutId,
          coneTypeId: extraParams.coneTypeId || null,
          rows: [],
        });
      }
      groupedRows.get(groupKey).rows.push(row);
    }

    // Process each group as a separate Lot
    const results = [];
    for (const [groupKey, group] of groupedRows.entries()) {
      const { itemId, supplierId, firmId, date, rows: groupRows } = group;
      const common = { date, itemId, firmId, supplierId, actorUserId };

      const {
        twistId,
        yarnId,
        machineId,
        operatorId,
        shift,
        wrapperId,
        cutId,
        coneTypeId,
      } = group;

      let result;
      if (stage === 'inbound') {
        result = await processOpeningInboundUpload(groupRows, common);
      } else if (stage === 'cutter') {
        result = await processOpeningCutterUpload(groupRows, common);
      } else if (stage === 'holo') {
        result = await processOpeningHoloUpload(groupRows, { ...common, twistId, yarnId, machineId, operatorId, shift, cutId });
      } else if (stage === 'coning') {
        result = await processOpeningConingUpload(groupRows, { ...common, machineId, operatorId, shift, wrapperId, coneTypeId });
      } else {
        throw new Error('Invalid stage');
      }
      results.push(result);
    }

    // Return summary of all lots created
    const lotNos = results.map(r => r.lotNo);
    const totalCount = results.reduce((sum, r) => sum + r.count, 0);
    res.json({ lotNos, lotsCreated: results.length, totalCount, details: results });
  } catch (err) {
    console.error(`Failed to upload opening stock for ${req.params.stage}`, err);
    res.status(400).json({ error: err.message || 'Upload failed' });
  }
});

// Helper functions for processing uploads
async function processOpeningInboundUpload(rows, { date, itemId, firmId, supplierId, actorUserId }) {
  const pieces = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const weight = toNumber(row['Weight (kg)'] || row['weight']);
    if (!weight || weight <= 0) throw new Error(`Row ${i + 1}: Invalid weight`);
    const isConsumed = String(row['Is Consumed'] || row['isConsumed']).toLowerCase();
    const consumed = ['yes', 'y', 'true', '1'].includes(isConsumed);
    const consumptionDate = row['Consumption Date'] || row['consumptionDate'] || null;
    pieces.push({ weight, isConsumed: consumed, consumptionDate });
  }

  return prisma.$transaction(async (tx) => {
    const lotNo = await allocateOpeningLot(tx, actorUserId);
    const totalWeight = pieces.reduce((sum, p) => sum + p.weight, 0);

    const lot = await tx.lot.create({
      data: {
        lotNo, date, itemId, firmId: firmId || null, supplierId,
        totalPieces: pieces.length, totalWeight: roundTo3Decimals(totalWeight),
        ...actorCreateFields(actorUserId),
      },
    });

    const inboundItems = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const seq = i + 1;
      const pieceId = `${lotNo}-${seq}`;
      const barcode = makeInboundBarcode({ lotNo, seq });

      inboundItems.push({
        id: pieceId, lotNo, itemId, weight: roundTo3Decimals(piece.weight),
        status: piece.isConsumed ? 'consumed' : 'available',
        consumptionDate: piece.consumptionDate,
        seq, barcode, isOpeningStock: true,
        ...actorCreateFields(actorUserId),
      });
    }
    await tx.inboundItem.createMany({ data: inboundItems });
    return { lotNo, count: pieces.length };
  });
}

async function processOpeningCutterUpload(rows, { date, itemId, firmId, supplierId, actorUserId }) {
  const itemRec = itemId ? await prisma.item.findUnique({ where: { id: itemId } }) : null;
  const uniqueNames = {
    bobbins: new Set(), boxes: new Set(), cuts: new Set(),
    operators: new Set(), helpers: new Set(), machines: new Set()
  };

  rows.forEach(r => {
    if (r['Bobbin Name']) uniqueNames.bobbins.add(r['Bobbin Name']);
    if (r['Box Name']) uniqueNames.boxes.add(r['Box Name']);
    if (r['Cut Name']) uniqueNames.cuts.add(r['Cut Name']);
    if (r['Operator Name']) uniqueNames.operators.add(r['Operator Name']);
    if (r['Helper Name']) uniqueNames.helpers.add(r['Helper Name']);
    if (r['Machine Name']) uniqueNames.machines.add(r['Machine Name']);
  });

  const [bobbins, boxes, cuts, operators, machines] = await Promise.all([
    prisma.bobbin.findMany({ where: { name: { in: Array.from(uniqueNames.bobbins) } } }),
    prisma.box.findMany({ where: { name: { in: Array.from(uniqueNames.boxes) }, processType: { in: ['cutter', 'all'] } } }),
    prisma.cut.findMany({ where: { name: { in: Array.from(uniqueNames.cuts) } } }),
    prisma.operator.findMany({ where: { name: { in: [...uniqueNames.operators, ...uniqueNames.helpers] }, processType: { in: ['cutter', 'all'] } } }),
    prisma.machine.findMany({ where: { name: { in: Array.from(uniqueNames.machines) }, processType: { in: ['cutter', 'all'] } } }),
  ]);

  const mapByName = (arr) => new Map(arr.map(x => [x.name.toLowerCase(), x]));
  const bobbinMap = mapByName(bobbins);
  const boxMap = mapByName(boxes);
  const cutMap = mapByName(cuts);
  const operatorMap = mapByName(operators);
  const machineMap = mapByName(machines);

  const crates = [];
  let totalNetWeight = 0;
  let totalBobbins = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    const bobbinName = String(row['Bobbin Name'] || '').trim();
    const boxName = String(row['Box Name'] || '').trim();
    const cutName = String(row['Cut Name'] || '').trim();
    const qty = toInt(row['Quantity']);
    const gross = toNumber(row['Gross Weight (kg)']);

    if (!bobbinName) throw new Error(`Row ${idx}: Missing Bobbin Name`);
    if (!boxName) throw new Error(`Row ${idx}: Missing Box Name`);
    if (!cutName) throw new Error(`Row ${idx}: Missing Cut Name`);
    if (qty <= 0) throw new Error(`Row ${idx}: Invalid Quantity`);
    if (gross <= 0) throw new Error(`Row ${idx}: Invalid Gross Weight`);

    const bobbin = bobbinMap.get(bobbinName.toLowerCase());
    if (!bobbin) throw new Error(`Row ${idx}: Bobbin '${bobbinName}' not found`);
    const box = boxMap.get(boxName.toLowerCase());
    if (!box) throw new Error(`Row ${idx}: Box '${boxName}' not found (or not allowed for Cutter)`);
    const cut = cutMap.get(cutName.toLowerCase());
    if (!cut) throw new Error(`Row ${idx}: Cut '${cutName}' not found`);

    const opName = String(row['Operator Name'] || '').trim();
    const operator = opName ? operatorMap.get(opName.toLowerCase()) : null;
    if (opName && !operator) throw new Error(`Row ${idx}: Operator '${opName}' not found`);

    const helpName = String(row['Helper Name'] || '').trim();
    const helper = helpName ? operatorMap.get(helpName.toLowerCase()) : null;
    if (helpName && !helper) throw new Error(`Row ${idx}: Helper '${helpName}' not found`);

    const machName = String(row['Machine Name'] || '').trim();
    const machine = machName ? machineMap.get(machName.toLowerCase()) : null;
    if (machName && !machine) throw new Error(`Row ${idx}: Machine '${machName}' not found`);

    const bobbinWt = Number(bobbin.weight || 0);
    const boxWt = Number(box.weight || 0);
    const tare = (bobbinWt * qty) + boxWt;
    const net = roundTo3Decimals(gross - tare);

    if (net <= 0) throw new Error(`Row ${idx}: Net weight <= 0`);

    crates.push({
      bobbinId: bobbin.id, boxId: box.id, cutId: cut.id,
      bobbinQuantity: qty, grossWeight: gross, tareWeight: tare, netWeight: net,
      operatorId: operator?.id, helperId: helper?.id, machineNo: machine?.name, machineId: machine?.id,
      shift: row['Shift'] || null
    });
    totalNetWeight += net;
    totalBobbins += qty;
  }

  return prisma.$transaction(async (tx) => {
    const lotNo = await allocateOpeningLot(tx, actorUserId);
    const pieceId = `${lotNo}-1`;

    await tx.lot.create({
      data: {
        lotNo, date, itemId, firmId: firmId || null, supplierId,
        totalPieces: 1, totalWeight: roundTo3Decimals(totalNetWeight),
        ...actorCreateFields(actorUserId),
      },
    });

    await tx.inboundItem.create({
      data: {
        id: pieceId, lotNo, itemId, weight: roundTo3Decimals(totalNetWeight),
        status: 'consumed', seq: 1, barcode: makeInboundBarcode({ lotNo, seq: 1 }),
        ...actorCreateFields(actorUserId),
      },
    });

    const upload = await tx.receiveFromCutterMachineUpload.create({
      data: { originalFilename: 'bulk-opening', rowCount: crates.length, ...actorCreateFields(actorUserId) }
    });

    let crateIndex = 0;
    const createdRows = [];
    for (const crate of crates) {
      crateIndex++;
      const barcode = makeReceiveBarcode({ lotNo, seq: 1, crateIndex });
      const created = await tx.receiveFromCutterMachineRow.create({
        data: {
          uploadId: upload.id, pieceId, vchNo: `OPEN-BLK-${randomUUID().slice(0, 6)}`,
          date, grossWt: crate.grossWeight, tareWt: crate.tareWeight, netWt: crate.netWeight, totalKg: crate.netWeight,
          itemName: itemRec?.name || null,
          bobbinId: crate.bobbinId, boxId: crate.boxId, cutId: crate.cutId,
          bobbinQuantity: crate.bobbinQuantity,
          operatorId: crate.operatorId, helperId: crate.helperId, machineNo: crate.machineNo,
          shift: crate.shift, narration: 'Opening stock bulk', createdBy: 'opening_bulk', barcode,
          ...actorCreateFields(actorUserId),
        }
      });
      createdRows.push({ id: created.id, barcode });
    }

    await tx.receiveFromCutterMachinePieceTotal.upsert({
      where: { pieceId },
      update: { totalNetWeight: { increment: totalNetWeight }, totalBob: { increment: totalBobbins } },
      create: { pieceId, totalNetWeight, totalBob: totalBobbins, wastageNetWeight: 0 }
    });

    return { lotNo, count: crates.length };
  });
}

async function processOpeningHoloUpload(rows, { date, itemId, firmId, supplierId, twistId, yarnId, machineId, operatorId, shift, cutId, actorUserId }) {
  const uniqueNames = { rollTypes: new Set() };
  rows.forEach(r => {
    if (r['Roll Type Name']) uniqueNames.rollTypes.add(r['Roll Type Name']);
  });

  const rollTypes = await prisma.rollType.findMany({ where: { name: { in: Array.from(uniqueNames.rollTypes) } } });
  const rollTypeMap = new Map(rollTypes.map(x => [x.name.toLowerCase(), x]));

  const crates = [];
  let totalNetWeight = 0;
  let totalRolls = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    const rtName = String(row['Roll Type Name'] || '').trim();
    const count = toInt(row['Roll Count']);
    const net = toNumber(row['Net Weight (kg)'] || row['netWeight'] || row['Net Weight']);

    if (!rtName) throw new Error(`Row ${idx}: Missing Roll Type Name`);
    if (count <= 0) throw new Error(`Row ${idx}: Invalid Roll Count`);
    if (net <= 0) throw new Error(`Row ${idx}: Invalid Net Weight`);

    const rt = rollTypeMap.get(rtName.toLowerCase());
    if (!rt) throw new Error(`Row ${idx}: Roll Type '${rtName}' not found`);

    crates.push({
      rollTypeId: rt.id,
      rollCount: count,
      netWeight: net,
      notes: row['Notes']
    });
    totalNetWeight += net;
    totalRolls += count;
  }


  return prisma.$transaction(async (tx) => {
    const lotNo = await allocateOpeningLot(tx, actorUserId);
    const pieceId = `${lotNo}-1`;

    await tx.lot.create({
      data: {
        lotNo, date, itemId, firmId: firmId || null, supplierId,
        totalPieces: 1, totalWeight: roundTo3Decimals(totalNetWeight),
        ...actorCreateFields(actorUserId),
      },
    });

    await tx.inboundItem.create({
      data: {
        id: pieceId, lotNo, itemId, weight: roundTo3Decimals(totalNetWeight),
        status: 'consumed', seq: 1, barcode: makeInboundBarcode({ lotNo, seq: 1 }),
        ...actorCreateFields(actorUserId),
      },
    });

    await ensureHoloIssueSequence(tx, actorUserId);
    const holoSeq = await tx.holoIssueSequence.upsert({
      where: { id: 'holo_issue_seq' },
      update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
      create: { id: 'holo_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
    });
    const seriesNumber = holoSeq.nextValue - 1;

    const issue = await tx.issueToHoloMachine.create({
      data: {
        date, itemId, lotNo, yarnId: yarnId || null, twistId,
        machineId: machineId || null, operatorId: operatorId || null,
        cutId: cutId || null,
        barcode: makeHoloIssueBarcode({ series: seriesNumber }),
        note: 'Opening Stock Bulk', shift: shift || null,
        ...actorCreateFields(actorUserId),
      },
    });

    let crateIndex = 0;
    for (const crate of crates) {
      crateIndex++;
      await tx.receiveFromHoloMachineRow.create({
        data: {
          issueId: issue.id,
          pieceId,
          date,
          rollCount: crate.rollCount, rollWeight: crate.netWeight,
          rollTypeId: crate.rollTypeId,
          createdBy: 'opening_bulk', barcode: makeHoloReceiveBarcode({ series: seriesNumber, crateIndex }),
          notes: crate.notes, ...actorCreateFields(actorUserId),
        }
      });
    }

    await tx.receiveFromHoloMachinePieceTotal.upsert({
      where: { pieceId },
      update: { totalRolls: { increment: totalRolls }, totalNetWeight: { increment: totalNetWeight } },
      create: { pieceId, totalRolls, totalNetWeight, wastageNetWeight: 0 }
    });

    return { lotNo, count: crates.length };
  });
}

async function processOpeningConingUpload(rows, { date, itemId, firmId, supplierId, coneTypeId, wrapperId, machineId, operatorId, shift, actorUserId }) {
  const uniqueNames = { coneTypes: new Set(), boxes: new Set() };
  rows.forEach(r => {
    if (r['Cone Type Name']) uniqueNames.coneTypes.add(r['Cone Type Name']);
    if (r['Box Name']) uniqueNames.boxes.add(r['Box Name']);
  });

  const [coneTypes, boxes] = await Promise.all([
    prisma.coneType.findMany({ where: { name: { in: Array.from(uniqueNames.coneTypes) } } }),
    prisma.box.findMany({ where: { name: { in: Array.from(uniqueNames.boxes) }, processType: { in: ['coning', 'all'] } } }),
  ]);

  const mapByName = (arr) => new Map(arr.map(x => [x.name.toLowerCase(), x]));
  const coneTypeMap = mapByName(coneTypes);
  const boxMap = mapByName(boxes);

  const crates = [];
  let totalNetWeight = 0;
  let totalCones = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    const ctName = String(row['Cone Type Name'] || '').trim();
    const count = toInt(row['Cone Count']);
    const gross = toNumber(row['Gross Weight (kg)']);
    const boxName = String(row['Box Name'] || '').trim();

    // Cone Type Name is required for every row
    if (!ctName) {
      throw new Error(`Row ${idx}: Cone Type Name is required`);
    }
    const ct = coneTypeMap.get(ctName.toLowerCase());
    if (!ct) throw new Error(`Row ${idx}: Cone Type '${ctName}' not found`);

    const box = boxName ? boxMap.get(boxName.toLowerCase()) : null;
    if (boxName && !box) throw new Error(`Row ${idx}: Box '${boxName}' not found`);

    if (count <= 0) throw new Error(`Row ${idx}: Invalid Cone Count`);
    if (gross <= 0) throw new Error(`Row ${idx}: Invalid Gross Weight`);

    const ctWt = Number(ct.weight || 0);
    const boxWt = box ? Number(box.weight || 0) : 0;
    const tare = (ctWt * count) + boxWt;
    const net = roundTo3Decimals(gross - tare);

    if (net <= 0) throw new Error(`Row ${idx}: Net weight <= 0`);

    crates.push({
      coneTypeId: ct.id, boxId: box?.id,
      coneCount: count, grossWeight: gross, tareWeight: tare, netWeight: net,
      notes: row['Notes']
    });
    totalNetWeight += net;
    totalCones += count;
  }

  return prisma.$transaction(async (tx) => {
    const lotNo = await allocateOpeningLot(tx, actorUserId);
    const pieceId = `${lotNo}-1`;

    await tx.lot.create({
      data: {
        lotNo, date, itemId, firmId: firmId || null, supplierId,
        totalPieces: 1, totalWeight: roundTo3Decimals(totalNetWeight),
        ...actorCreateFields(actorUserId),
      },
    });

    await tx.inboundItem.create({
      data: {
        id: pieceId, lotNo, itemId, weight: roundTo3Decimals(totalNetWeight),
        status: 'consumed', seq: 1, barcode: makeInboundBarcode({ lotNo, seq: 1 }),
        ...actorCreateFields(actorUserId),
      },
    });

    await ensureConingIssueSequence(tx, actorUserId);
    const coningSeq = await tx.coningIssueSequence.upsert({
      where: { id: 'coning_issue_seq' },
      update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
      create: { id: 'coning_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
    });
    const seriesNumber = coningSeq.nextValue - 1;

    const primaryConeTypeId = crates[0]?.coneTypeId || coneTypeId;

    const issue = await tx.issueToConingMachine.create({
      data: {
        date, itemId, lotNo,
        machineId: machineId || null, operatorId: operatorId || null,
        barcode: makeConingIssueBarcode({ series: seriesNumber }),
        note: 'Opening Stock Bulk', shift: shift || null,
        receivedRowRefs: [{ coneTypeId: primaryConeTypeId, wrapperId: wrapperId || null }],
        ...actorCreateFields(actorUserId),
      },
    });

    let crateIndex = 0;
    for (const crate of crates) {
      crateIndex++;
      await tx.receiveFromConingMachineRow.create({
        data: {
          issueId: issue.id, date,
          coneCount: crate.coneCount, coneWeight: crate.netWeight,
          grossWeight: crate.grossWeight, tareWeight: crate.tareWeight, netWeight: crate.netWeight,
          boxId: crate.boxId, barcode: makeConingReceiveBarcode({ series: seriesNumber, crateIndex }),
          notes: crate.notes, ...actorCreateFields(actorUserId),
        }
      });
    }

    await tx.receiveFromConingMachinePieceTotal.upsert({
      where: { pieceId: issue.id },
      update: { totalCones: { increment: totalCones }, totalNetWeight: { increment: totalNetWeight } },
      create: { pieceId: issue.id, totalCones, totalNetWeight, wastageNetWeight: 0 }
    });

    return { lotNo, count: crates.length };
  });
}

function parseTelegramChatIds(value) {
  const raw = Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim())
    : typeof value === 'string'
      ? value.split(/[\n,]/g).map((entry) => entry.trim())
      : [];
  const unique = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  return unique;
}

async function dispatchMediaByChannels({
  settings,
  template,
  buffer,
  filename,
  mimetype,
  caption = '',
  explicitWhatsappRecipients = [],
  explicitTelegramChatIds = [],
}) {
  const { whatsappEnabled, telegramEnabled } = getNotificationChannelConfig(settings || {});
  if (!whatsappEnabled && !telegramEnabled) {
    return { ok: false, reason: 'no_enabled_channels', channels: { whatsapp: { enabled: false }, telegram: { enabled: false } } };
  }

  const channels = {
    whatsapp: { enabled: whatsappEnabled, recipients: [], results: [], ok: false, reason: null },
    telegram: { enabled: telegramEnabled, recipients: [], results: [], ok: false, reason: null },
  };

  if (whatsappEnabled) {
    const recipients = explicitWhatsappRecipients.length > 0
      ? explicitWhatsappRecipients
      : resolveWhatsappRecipients({ template, settings });
    channels.whatsapp.recipients = recipients;
    if (recipients.length === 0) {
      channels.whatsapp.reason = 'no_recipients';
    } else {
      channels.whatsapp.results = await Promise.all(recipients.map(async (recipient) => {
        try {
          if (recipient.type === 'number') {
            await whatsapp.sendMediaSafe(recipient.value, buffer, filename, mimetype, caption);
          } else {
            await whatsapp.sendMediaToChatIdSafe(recipient.value, buffer, filename, mimetype, caption);
          }
          return { recipient: recipient.value, type: recipient.type, success: true };
        } catch (err) {
          return { recipient: recipient.value, type: recipient.type, success: false, error: err?.message || String(err) };
        }
      }));
      channels.whatsapp.ok = channels.whatsapp.results.some((result) => result.success);
      if (!channels.whatsapp.ok) channels.whatsapp.reason = 'send_failed';
    }
  }

  if (telegramEnabled) {
    const chatIds = explicitTelegramChatIds.length > 0
      ? explicitTelegramChatIds
      : resolveTemplateTelegramRecipients({ template, settings: settings || {} });
    channels.telegram.recipients = chatIds.map((chatId) => ({ type: 'chat', value: chatId }));
    if (chatIds.length === 0) {
      channels.telegram.reason = 'no_recipients';
    } else {
      channels.telegram.results = await Promise.all(chatIds.map(async (chatId) => {
        try {
          await telegram.sendMediaSafe(chatId, buffer, filename, mimetype, caption);
          return { recipient: chatId, success: true };
        } catch (err) {
          return { recipient: chatId, success: false, error: err?.message || String(err) };
        }
      }));
      channels.telegram.ok = channels.telegram.results.some((result) => result.success);
      if (!channels.telegram.ok) channels.telegram.reason = 'send_failed';
    }
  }

  return {
    ok: channels.whatsapp.ok || channels.telegram.ok,
    reason: channels.whatsapp.ok || channels.telegram.ok ? null : 'all_channels_failed',
    channels,
  };
}

// Whatsapp control endpoints
router.get('/api/whatsapp/status', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const status = whatsapp.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/telegram/status', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const status = await telegram.refreshStatus();
    res.json({
      ...status,
      enabled: settings?.telegramEnabled === true,
      hasBotToken: !!settings?.telegramBotToken,
      chatCount: Array.isArray(settings?.telegramChatIds) ? settings.telegramChatIds.length : 0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/telegram/send-test', requirePermission('settings', PERM_WRITE), async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const configuredChatIds = resolveTelegramRecipients(settings || {});
    const chatId = String(req.body?.chatId || '').trim() || configuredChatIds[0];
    if (!chatId) return res.status(400).json({ error: 'No telegram chat ID configured' });
    const text = String(req.body?.text || 'GLINTEX Telegram test message');
    await telegram.sendTextSafe(chatId, text);
    res.json({ ok: true, chatId });
  } catch (err) {
    console.error('Failed to send telegram test message', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post('/api/telegram/chats/resolve', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const rawChatIds = Array.isArray(req.body?.chatIds) ? req.body.chatIds : [];
    const uniqueChatIds = Array.from(new Set(rawChatIds.map((id) => String(id || '').trim()).filter(Boolean)));
    if (uniqueChatIds.length === 0) return res.json({ items: [] });

    const items = await Promise.all(uniqueChatIds.map(async (chatId) => {
      try {
        const info = await telegram.getChatInfoSafe(chatId);
        return { ok: true, ...info };
      } catch (err) {
        return {
          ok: false,
          chatId,
          displayName: chatId,
          error: err?.message || String(err),
        };
      }
    }));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/whatsapp/start', requireRole('admin'), requirePermission('settings', PERM_WRITE), async (req, res) => {
  try {
    const force = req.body && (req.body.force === true || req.body.force === 'true');
    await whatsapp.init({ force });
    res.status(202).json({ ok: true });
  } catch (err) {
    console.error('Failed to start whatsapp', err);
    res.status(500).json({ error: String(err) });
  }
});

// List Whatsapp groups
router.get('/api/whatsapp/groups', requireRole('admin'), requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const st = whatsapp.getStatus();
    if (st.status !== 'connected' || !whatsapp.client) return res.status(409).json({ error: 'not_connected' });
    const chats = await whatsapp.client.getChats();
    // Filter for groups where isGroup is true AND isReadOnly is false
    // isReadOnly is usually true if you have left the group or are restricted
    const groups = (chats || [])
      .filter(c => c.isGroup && c.isReadOnly === false)
      .map(c => ({ id: c.id?._serialized || c.id || '', name: c.name || '' }));
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Templates endpoints
router.get('/api/whatsapp/templates', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const t = await listTemplates();
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Sticker template endpoints (shared across all users)
router.get('/api/sticker_templates', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const templates = await prisma.stickerTemplate.findMany({ orderBy: { stageKey: 'asc' } });
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/api/sticker_templates/:stageKey', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const stageKey = String(req.params.stageKey || '').trim();
    if (!stageKey) return res.status(400).json({ error: 'stageKey is required' });
    const template = await prisma.stickerTemplate.findUnique({ where: { stageKey } });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.put('/api/sticker_templates/:stageKey', requireEditPermission('settings'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const stageKey = String(req.params.stageKey || '').trim();
    if (!stageKey) return res.status(400).json({ error: 'stageKey is required' });
    const dimensions = req.body?.dimensions;
    const content = req.body?.content;
    if (!dimensions || typeof dimensions !== 'object') return res.status(400).json({ error: 'dimensions must be an object' });
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'content must be an object' });

    const template = await prisma.stickerTemplate.upsert({
      where: { stageKey },
      update: { dimensions, content, ...actorUpdateFields(actorUserId) },
      create: { stageKey, dimensions, content, ...actorCreateFields(actorUserId) },
    });

    await logCrudWithActor(req, { entityType: 'StickerTemplate', entityId: template.id, action: 'upsert', payload: { stageKey } });
    res.json({ template });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.put('/api/whatsapp/templates/:event', requireEditPermission('settings'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { event } = req.params;
    const { enabled, template, sendToPrimary, groupIds, telegramChatIds } = req.body;
    const cleanGroups = Array.isArray(groupIds) ? groupIds.filter(x => typeof x === 'string') : [];
    const cleanTelegramChatIds = Array.isArray(telegramChatIds)
      ? telegramChatIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const uniqueTelegramChatIds = Array.from(new Set(cleanTelegramChatIds));
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const telegramEnabled = settings?.telegramEnabled === true;
    const templateEnabled = enabled !== false;
    if (telegramEnabled && templateEnabled && uniqueTelegramChatIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one Telegram chat ID for this template while Telegram is enabled' });
    }
    const t = await upsertTemplate(
      event,
      {
        enabled: !!enabled,
        template: template || '',
        sendToPrimary: sendToPrimary !== false,
        groupIds: cleanGroups,
        telegramChatIds: uniqueTelegramChatIds,
      },
      { actorUserId }
    );
    await logCrudWithActor(req, { entityType: 'whatsapp_template', entityId: String(t.id), action: 'upsert', payload: { event } });
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get('/api/whatsapp/contacts', requirePermission('send_documents', PERM_READ), async (req, res) => {
  try {
    const contacts = await whatsapp.getContacts();
    // Filter out groups if needed, but for now user said "all numbers"
    // We typically want only individual contacts for "Send Documents", but maybe user wants groups too? 
    // The previous implementation used "Customer" which implies individuals. 
    // Let's filter out groups by default to be safe, or include them if distinguishable.
    // Spec said "numbers of logged in whatsapp account", usually implies contacts.
    const individualContacts = contacts.filter(c => !c.isGroup && c.hasSavedName && /[A-Za-z]/.test(c.name || '') && !c.id.endsWith('@lid'));

    // Deduplicate by normalized number (handles duplicates with country code or formatting)
    const normalizeNumber = (value) => {
      const digits = String(value || '').replace(/\D/g, '');
      if (digits.length > 10 && digits.startsWith('91')) return digits.slice(-10);
      return digits;
    };
    const uniqueByNumber = new Map();
    individualContacts.forEach(c => {
      const key = normalizeNumber(c.number);
      if (!key) return;
      if (!uniqueByNumber.has(key)) uniqueByNumber.set(key, c);
    });
    const uniqueContacts = Array.from(uniqueByNumber.values());

    // Sort by name
    uniqueContacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json({ contacts: uniqueContacts });
  } catch (err) {
    console.error('Failed to get whatsapp contacts', err);
    res.status(500).json({ error: err.message || 'Failed to fetch contacts' });
  }
});

router.post('/api/whatsapp/send-document', requirePermission('send_documents', PERM_WRITE), upload.single('file'), async (req, res) => {
  try {
    const { event, payload } = req.body;
    const tpl = await getTemplateByEvent(event);
    if (!tpl || !tpl.enabled) return res.status(400).json({ error: 'Template not enabled or missing' });
    const payloadWithActor = { ...(payload || {}) };
    if (!Object.prototype.hasOwnProperty.call(payloadWithActor, 'createdByUserId') && req.user?.id) {
      payloadWithActor.createdByUserId = req.user.id;
    }
    const outcome = await sendNotification(event, payloadWithActor);
    if (!outcome.ok) {
      return res.status(400).json({
        ok: false,
        reason: outcome.reason || 'send_failed',
        channels: outcome.channels || {},
      });
    }
    res.json({ ok: true, channels: outcome.channels || {} });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post('/api/whatsapp/send-event', requirePermission('settings', PERM_WRITE), async (req, res) => {
  try {
    const { event, payload } = req.body;
    const payloadWithActor = { ...(payload || {}) };
    if (!Object.prototype.hasOwnProperty.call(payloadWithActor, 'createdByUserId') && req.user?.id) {
      payloadWithActor.createdByUserId = req.user.id;
    }
    const outcome = await sendNotification(event, payloadWithActor);
    if (!outcome.ok) {
      return res.status(400).json({
        ok: false,
        reason: outcome.reason || 'send_failed',
        channels: outcome.channels || {},
      });
    }
    res.json({ ok: true, channels: outcome.channels || {} });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get('/api/whatsapp/qrcode', requireRole('admin'), requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const qr = whatsapp.getQrDataUrl();
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// SSE endpoint for real-time whatsapp events (qr/status)
router.get('/api/whatsapp/events', requirePermission('settings', PERM_READ), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const emitter = whatsapp.getEmitter();
  const onStatus = (data) => res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
  const onQr = (data) => res.write(`event: qr\ndata: ${JSON.stringify(data)}\n\n`);
  emitter.on('status', onStatus);
  emitter.on('qr', onQr);
  req.on('close', () => {
    emitter.off('status', onStatus);
    emitter.off('qr', onQr);
  });
});

router.post('/api/whatsapp/logout', requireRole('admin'), requirePermission('settings', PERM_WRITE), async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/whatsapp/send-test', requirePermission('settings', PERM_WRITE), async (req, res) => {
  try {
    const number = req.body.number || '916353131826';
    await whatsapp.sendText(number, 'Hii');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to send test message', err);
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/lots', requirePermission('inbound', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const actorUserId = actor?.userId;
    const { date, itemId, firmId, supplierId, pieces } = req.body;
    if (!date || !itemId || !firmId || !supplierId) {
      return res.status(400).json({ error: 'Missing required lot fields' });
    }
    if (!Array.isArray(pieces) || pieces.length === 0) {
      return res.status(400).json({ error: 'Lot requires at least one piece' });
    }

    const preparedPieces = pieces.map((piece, idx) => {
      const seq = piece.seq || idx + 1;
      const weight = roundTo3Decimals(piece.weight);
      if (weight <= 0) {
        throw new Error(`Invalid weight for piece ${idx + 1}`);
      }
      return {
        seq,
        weight,
      };
    });

    const itemRecord = await prisma.item.findUnique({ where: { id: itemId } });
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    const materialCode = deriveMaterialCodeFromItem(itemRecord);

    const totalPieces = preparedPieces.length;
    const totalWeight = roundTo3Decimals(preparedPieces.reduce((sum, piece) => sum + piece.weight, 0));

    const result = await prisma.$transaction(async (tx) => {
      // Get next lot number from sequence
      const sequence = await tx.sequence.upsert({
        where: { id: 'lot_sequence' },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: 'lot_sequence', nextValue: 1, ...actorCreateFields(actorUserId) }
      });

      // Use the sequence value directly as the lot number (e.g. "001", "002")
      const lotNo = String(sequence.nextValue).padStart(3, "0");

      // Update piece IDs with the actual lot number
      const updatedPieces = preparedPieces.map((piece, idx) => {
        const seq = idx + 1;
        return {
          ...piece,
          id: `${lotNo}-${seq}`,
          lotNo,
          itemId,
          seq,
          status: 'available',
          barcode: makeInboundBarcode({ lotNo, seq }),
          ...actorCreateFields(actorUserId),
        };
      });

      const lot = await tx.lot.create({
        data: {
          lotNo,
          date,
          itemId,
          firmId,
          supplierId,
          totalPieces,
          totalWeight,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.inboundItem.createMany({ data: updatedPieces });

      await logCrud({
        entityType: 'lot',
        entityId: lot.id,
        action: 'create',
        payload: {
          lotNo,
          date,
          itemId,
          firmId,
          supplierId,
          totalPieces,
          totalWeight,
          pieces: updatedPieces.map(p => ({ id: p.id, seq: p.seq, weight: p.weight })),
        },
        client: tx,
        actorUserId: actorUserId,
        actorUsername: actor?.username,
        actorRoleKey: actor?.roleKey,
      });

      return lot;
    });

    res.json({ ok: true, lot: result });
    // Notify inbound created (non-blocking)
    try {
      const itemName = (await prisma.item.findUnique({ where: { id: itemId } })).name || '';
      sendNotification('inbound_created', { itemName, lotNo: result.lotNo, date, totalPieces, totalWeight, createdByUserId: result.createdByUserId || actorUserId || null });
    } catch (e) { console.error('notify inbound error', e); }
  } catch (err) {
    console.error('Failed to create lot', err);
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Lot already exists' });
    } else {
      res.status(500).json({ error: err.message || 'Failed to create lot' });
    }
  }
});

router.post(
  '/api/inbound/cutter_purchase',
  requirePermission('inbound', PERM_WRITE),
  requirePermission('receive.cutter', PERM_WRITE),
  async (req, res) => {
    try {
      const actorUserId = req.user?.id;
      const { date, itemId, firmId, supplierId, crates, reservedLotNo } = req.body || {};
      if (!date || !itemId || !supplierId) {
        return res.status(400).json({ error: 'Missing required cutter purchase fields' });
      }
      if (!Array.isArray(crates) || crates.length === 0) {
        return res.status(400).json({ error: 'Add at least one crate' });
      }

      const [itemRecord, firmRecord, supplierRecord] = await Promise.all([
        prisma.item.findUnique({ where: { id: itemId } }),
        firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
        prisma.supplier.findUnique({ where: { id: supplierId } }),
      ]);
      if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
      if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
      if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });

      const bobbinIds = Array.from(new Set(crates.map(c => c?.bobbinId).filter(Boolean)));
      const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));
      const operatorIds = Array.from(new Set(crates.map(c => c?.operatorId).filter(Boolean)));
      const helperIds = Array.from(new Set(crates.map(c => c?.helperId).filter(Boolean)));
      const cutIds = Array.from(new Set(crates.map(c => c?.cutId).filter(Boolean)));

      const [bobbins, boxes, operators, helpers, cuts] = await Promise.all([
        bobbinIds.length ? prisma.bobbin.findMany({ where: { id: { in: bobbinIds } } }) : Promise.resolve([]),
        boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
        operatorIds.length ? prisma.operator.findMany({ where: { id: { in: operatorIds } } }) : Promise.resolve([]),
        helperIds.length ? prisma.operator.findMany({ where: { id: { in: helperIds } } }) : Promise.resolve([]),
        cutIds.length ? prisma.cut.findMany({ where: { id: { in: cutIds } } }) : Promise.resolve([]),
      ]);

      const bobbinMap = new Map(bobbins.map(b => [b.id, b]));
      const boxMap = new Map(boxes.map(b => [b.id, b]));
      const operatorMap = new Map(operators.map(o => [o.id, o]));
      const helperMap = new Map(helpers.map(h => [h.id, h]));
      const cutMap = new Map(cuts.map(c => [c.id, c]));

      const normalizedCrates = crates.map((crate, idx) => {
        const rowIndex = idx + 1;
        if (!crate?.cutId) {
          throw new Error(`Missing cut for crate ${rowIndex}`);
        }
        const bobbinId = crate?.bobbinId || null;
        const boxId = crate?.boxId || null;
        const bobbin = bobbinId ? bobbinMap.get(bobbinId) : null;
        const box = boxId ? boxMap.get(boxId) : null;
        if (!bobbin) throw new Error(`Missing bobbin for crate ${rowIndex}`);
        if (!box) throw new Error(`Missing box for crate ${rowIndex}`);

        const bobbinQty = Math.max(0, toInt(crate?.bobbinQuantity) || 0);
        if (bobbinQty <= 0) throw new Error(`Invalid bobbin quantity for crate ${rowIndex}`);
        const gross = toNumber(crate?.grossWeight);
        if (!Number.isFinite(gross) || gross <= 0) throw new Error(`Invalid gross weight for crate ${rowIndex}`);

        const bobbinWeightRaw = bobbin.weight;
        const bobbinWeight = Number(bobbinWeightRaw);
        const boxWeight = Number(box.weight);
        if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
          throw new Error('Bobbin weight missing. Update bobbin first.');
        }
        if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
          throw new Error('Box weight missing. Update box first.');
        }

        const tare = bobbinWeight * bobbinQty + boxWeight;
        const net = roundTo3Decimals(gross - tare);
        if (!Number.isFinite(net) || net <= 0) {
          throw new Error(`Net weight must be positive for crate ${rowIndex}`);
        }

        if (!cutMap.has(crate.cutId)) {
          throw new Error(`Cut not found for crate ${rowIndex}`);
        }

        const operatorId = toOptionalString(crate?.operatorId);
        if (operatorId) {
          const operator = operatorMap.get(operatorId);
          if (!operator || normalizeWorkerRole(operator.role) !== 'operator') {
            throw new Error(`Invalid operator for crate ${rowIndex}`);
          }
        }

        const helperId = toOptionalString(crate?.helperId);
        if (helperId) {
          const helper = helperMap.get(helperId);
          if (!helper || normalizeWorkerRole(helper.role) !== 'helper') {
            throw new Error(`Invalid helper for crate ${rowIndex}`);
          }
        }

        return {
          bobbinId,
          boxId,
          bobbinQty,
          gross,
          tare,
          net,
          operatorId,
          helperId,
          cutId: crate.cutId,
          shift: toOptionalString(crate?.shift),
          machineNo: toOptionalString(crate?.machineNo),
        };
      });

      const totalNetWeight = roundTo3Decimals(normalizedCrates.reduce((sum, row) => sum + row.net, 0));
      const totalBobbins = normalizedCrates.reduce((sum, row) => sum + row.bobbinQty, 0);
      if (!Number.isFinite(totalNetWeight) || totalNetWeight <= 0) {
        return res.status(400).json({ error: 'Total net weight must be greater than zero' });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Use reserved lot number if provided, otherwise allocate a new one
        const lotNo = reservedLotNo && isCutterPurchaseLotNo(reservedLotNo)
          ? reservedLotNo
          : await allocateCutterPurchaseLot(tx, actorUserId);
        const pieceId = `${lotNo}-1`;

        await tx.lot.create({
          data: {
            lotNo,
            date,
            itemId,
            firmId: firmId || null,
            supplierId,
            totalPieces: 1,
            totalWeight: totalNetWeight,
            ...actorCreateFields(actorUserId),
          },
        });

        await tx.inboundItem.create({
          data: {
            id: pieceId,
            lotNo,
            itemId,
            weight: totalNetWeight,
            status: 'consumed',
            seq: 1,
            barcode: makeInboundBarcode({ lotNo, seq: 1 }),
            ...actorCreateFields(actorUserId),
          },
        });

        const upload = await tx.receiveFromCutterMachineUpload.create({
          data: {
            originalFilename: 'cutter-purchase',
            rowCount: normalizedCrates.length,
            ...actorCreateFields(actorUserId),
          },
        });

        const challanMeta = await allocateCutterChallanNumber(tx, actorUserId, date);
        const uniqueOperatorIds = Array.from(new Set(normalizedCrates.map(row => row.operatorId).filter(Boolean)));
        const uniqueHelperIds = Array.from(new Set(normalizedCrates.map(row => row.helperId).filter(Boolean)));
        const uniqueCutIds = Array.from(new Set(normalizedCrates.map(row => row.cutId).filter(Boolean)));

        const challan = await tx.receiveFromCutterMachineChallan.create({
          data: {
            challanNo: challanMeta.challanNo,
            sequence: challanMeta.sequence,
            fiscalYear: challanMeta.fiscalYear,
            pieceId,
            lotNo,
            itemId,
            date,
            totalNetWeight,
            totalBobbinQty: totalBobbins,
            operatorId: uniqueOperatorIds.length === 1 ? uniqueOperatorIds[0] : null,
            helperId: uniqueHelperIds.length === 1 ? uniqueHelperIds[0] : null,
            cutId: uniqueCutIds.length === 1 ? uniqueCutIds[0] : null,
            wastageNetWeight: 0,
            changeLog: [
              {
                at: new Date().toISOString(),
                action: 'create',
                actorUserId,
                details: { totalNetWeight, totalBobbinQty: totalBobbins },
              },
            ],
            ...actorCreateFields(actorUserId),
          },
        });

        const rows = [];
        let crateIndex = 0;
        for (const row of normalizedCrates) {
          crateIndex += 1;
          const barcode = makeReceiveBarcode({ lotNo, seq: 1, crateIndex });
          const vchNo = `CPUR-${randomUUID().slice(0, 8)}`;
          const cut = row.cutId ? cutMap.get(row.cutId) : null;
          const created = await tx.receiveFromCutterMachineRow.create({
            data: {
              uploadId: upload.id,
              challanId: challan.id,
              pieceId,
              vchNo,
              date,
              itemName: itemRecord?.name || null,
              grossWt: row.gross,
              tareWt: row.tare,
              netWt: row.net,
              totalKg: row.net,
              pktTypeName: boxMap.get(row.boxId)?.name || null,
              pcsTypeName: bobbinMap.get(row.bobbinId)?.name || null,
              bobbinId: row.bobbinId,
              boxId: row.boxId,
              operatorId: row.operatorId,
              helperId: row.helperId,
              bobbinQuantity: row.bobbinQty,
              issuedBobbins: 0,
              issuedBobbinWeight: 0,
              employee: row.operatorId ? operatorMap.get(row.operatorId)?.name || null : null,
              helperName: row.helperId ? helperMap.get(row.helperId)?.name || null : null,
              cutId: row.cutId,
              cut: cut ? cut.name : null,
              shift: row.shift,
              machineNo: row.machineNo,
              narration: 'Cutter purchase',
              createdBy: 'cutter_purchase',
              barcode,
              ...actorCreateFields(actorUserId),
            },
          });
          rows.push({ id: created.id, barcode });
        }

        await tx.receiveFromCutterMachinePieceTotal.upsert({
          where: { pieceId },
          update: {
            totalNetWeight: { increment: totalNetWeight },
            totalBob: { increment: totalBobbins },
            ...actorUpdateFields(actorUserId),
          },
          create: {
            pieceId,
            totalNetWeight,
            totalBob: totalBobbins,
            wastageNetWeight: 0,
            ...actorCreateFields(actorUserId),
          },
        });

        return {
          lotNo,
          pieceId,
          uploadId: upload.id,
          challanId: challan.id,
          challanNo: challan.challanNo,
          rows,
        };
      });

      await logCrudWithActor(req, {
        entityType: 'cutter_purchase_inbound',
        entityId: result.lotNo,
        action: 'create',
        payload: {
          lotNo: result.lotNo,
          pieceId: result.pieceId,
          challanNo: result.challanNo,
          totalNetWeight,
          totalBobbins,
        },
      });

      res.json({ ok: true, ...result, totalNetWeight, totalBobbins });
    } catch (err) {
      console.error('Failed to create cutter purchase inbound', err);
      res.status(400).json({ error: err.message || 'Failed to create cutter purchase inbound' });
    }
  },
);

router.get(
  '/api/inbound/cutter_purchase/:lotNo',
  requirePermission('inbound', PERM_READ),
  requirePermission('receive.cutter', PERM_READ),
  async (req, res) => {
    try {
      const lotNo = String(req.params.lotNo || '').trim();
      if (!lotNo) return res.status(400).json({ error: 'Missing lotNo' });
      if (!isCutterPurchaseLotNo(lotNo)) {
        return res.status(400).json({ error: 'Not a cutter purchase lot' });
      }

      const lot = await prisma.lot.findUnique({ where: { lotNo } });
      if (!lot) return res.status(404).json({ error: 'Lot not found' });

      const pieces = await prisma.inboundItem.findMany({
        where: { lotNo },
        orderBy: { seq: 'asc' },
      });
      if (pieces.length !== 1) {
        return res.status(400).json({ error: 'Cutter purchase lot must have exactly 1 inbound piece' });
      }
      const piece = pieces[0];

      const challans = await prisma.receiveFromCutterMachineChallan.findMany({
        where: { lotNo, pieceId: piece.id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      if (challans.length === 0) {
        return res.status(404).json({ error: 'Cutter purchase challan not found' });
      }
      if (challans.length > 1) {
        return res.status(409).json({ error: 'Multiple challans found for cutter purchase lot. Cannot edit.' });
      }
      const challan = challans[0];

      const rows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { challanId: challan.id, isDeleted: false, createdBy: 'cutter_purchase' },
        include: {
          bobbin: { select: { id: true, name: true, weight: true } },
          box: { select: { id: true, name: true, weight: true } },
          operator: { select: { id: true, name: true, role: true } },
          helper: { select: { id: true, name: true, role: true } },
          cutMaster: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      res.json({ ok: true, lot, piece, challan, rows });
    } catch (err) {
      console.error('Failed to load cutter purchase lot', err);
      res.status(500).json({ error: err.message || 'Failed to load cutter purchase' });
    }
  },
);

router.put(
  '/api/inbound/cutter_purchase/:lotNo',
  requireEditPermission('inbound'),
  requireEditPermission('receive.cutter'),
  async (req, res) => {
    try {
      const actorUserId = req.user?.id;
      const lotNo = String(req.params.lotNo || '').trim();
      if (!lotNo) return res.status(400).json({ error: 'Missing lotNo' });
      if (!isCutterPurchaseLotNo(lotNo)) {
        return res.status(400).json({ error: 'Not a cutter purchase lot' });
      }

      const { date, itemId, firmId, supplierId, crates } = req.body || {};
      if (!date || !itemId || !supplierId) {
        return res.status(400).json({ error: 'Missing required cutter purchase fields' });
      }
      if (!Array.isArray(crates) || crates.length === 0) {
        return res.status(400).json({ error: 'Add at least one crate' });
      }

      const lot = await prisma.lot.findUnique({ where: { lotNo } });
      if (!lot) return res.status(404).json({ error: 'Lot not found' });

      const pieces = await prisma.inboundItem.findMany({ where: { lotNo }, orderBy: { seq: 'asc' } });
      if (pieces.length !== 1) {
        return res.status(400).json({ error: 'Cutter purchase lot must have exactly 1 inbound piece' });
      }
      const piece = pieces[0];

      const challans = await prisma.receiveFromCutterMachineChallan.findMany({
        where: { lotNo, pieceId: piece.id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      if (challans.length === 0) return res.status(404).json({ error: 'Cutter purchase challan not found' });
      if (challans.length > 1) {
        return res.status(409).json({ error: 'Multiple challans found for cutter purchase lot. Cannot edit.' });
      }
      const challan = challans[0];

      const existingRows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { pieceId: piece.id },
        select: {
          id: true,
          createdBy: true,
          isDeleted: true,
          uploadId: true,
          challanId: true,
          barcode: true,
          issuedBobbins: true,
          issuedBobbinWeight: true,
          dispatchedCount: true,
          dispatchedWeight: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const nonPurchaseRows = existingRows.filter(r => r.createdBy !== 'cutter_purchase');
      if (nonPurchaseRows.length > 0) {
        return res.status(409).json({ error: 'Lot contains non-purchase cutter receive rows. Cannot edit safely.' });
      }

      const activePurchaseRows = existingRows.filter(r => r.createdBy === 'cutter_purchase' && !r.isDeleted);
      if (activePurchaseRows.some(r => r.challanId !== challan.id)) {
        return res.status(409).json({ error: 'Cutter purchase rows do not belong to a single challan. Cannot edit.' });
      }

      const rowIds = existingRows.map(r => r.id);
      const barcodes = existingRows.map(r => r.barcode).filter(Boolean);

      const counterUsed = existingRows.find(r => Number(r.issuedBobbins || 0) > 0
        || Number(r.issuedBobbinWeight || 0) > 0
        || Number(r.dispatchedCount || 0) > 0
        || Number(r.dispatchedWeight || 0) > 0);
      if (counterUsed) {
        return res.status(409).json({ error: 'Cannot edit cutter purchase: one or more crates were already issued or dispatched.' });
      }

      const [holoIssues, boxTransfers] = await Promise.all([
        findHoloIssuesReferencingCutterRows({ rowIds, barcodes }),
        findCutterBoxTransfersForRows({ rowIds, barcodes }),
      ]);

      if (holoIssues.length > 0) {
        return res.status(409).json({
          error: 'Cannot edit cutter purchase: already used in Holo issue.',
          details: { holoIssueIds: holoIssues.map(i => i.id) },
        });
      }
      if (boxTransfers.length > 0) {
        return res.status(409).json({
          error: 'Cannot edit cutter purchase: box transfer exists for one or more crates.',
          details: { boxTransferIds: boxTransfers.map(t => t.id) },
        });
      }

      const [itemRecord, firmRecord, supplierRecord] = await Promise.all([
        prisma.item.findUnique({ where: { id: itemId } }),
        firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
        prisma.supplier.findUnique({ where: { id: supplierId } }),
      ]);
      if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
      if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
      if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });

      const bobbinIds = Array.from(new Set(crates.map(c => c?.bobbinId).filter(Boolean)));
      const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));
      const operatorIds = Array.from(new Set(crates.map(c => c?.operatorId).filter(Boolean)));
      const helperIds = Array.from(new Set(crates.map(c => c?.helperId).filter(Boolean)));
      const cutIds = Array.from(new Set(crates.map(c => c?.cutId).filter(Boolean)));

      const [bobbins, boxes, operators, helpers, cuts] = await Promise.all([
        bobbinIds.length ? prisma.bobbin.findMany({ where: { id: { in: bobbinIds } } }) : Promise.resolve([]),
        boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
        operatorIds.length ? prisma.operator.findMany({ where: { id: { in: operatorIds } } }) : Promise.resolve([]),
        helperIds.length ? prisma.operator.findMany({ where: { id: { in: helperIds } } }) : Promise.resolve([]),
        cutIds.length ? prisma.cut.findMany({ where: { id: { in: cutIds } } }) : Promise.resolve([]),
      ]);

      const bobbinMap = new Map(bobbins.map(b => [b.id, b]));
      const boxMap = new Map(boxes.map(b => [b.id, b]));
      const operatorMap = new Map(operators.map(o => [o.id, o]));
      const helperMap = new Map(helpers.map(h => [h.id, h]));
      const cutMap = new Map(cuts.map(c => [c.id, c]));

      const existingRowIdsSet = new Set(activePurchaseRows.map(r => r.id));
      const payloadRowIds = new Set();

      const normalizedCrates = crates.map((crate, idx) => {
        const rowIndex = idx + 1;
        const rowId = toOptionalString(crate?.rowId || crate?.id);
        if (rowId) {
          if (!existingRowIdsSet.has(rowId)) {
            throw new Error(`Row not found in cutter purchase: ${rowId}`);
          }
          if (payloadRowIds.has(rowId)) {
            throw new Error(`Duplicate row in payload: ${rowId}`);
          }
          payloadRowIds.add(rowId);
        }

        if (!crate?.cutId) {
          throw new Error(`Missing cut for crate ${rowIndex}`);
        }
        const bobbinId = crate?.bobbinId || null;
        const boxId = crate?.boxId || null;
        const bobbin = bobbinId ? bobbinMap.get(bobbinId) : null;
        const box = boxId ? boxMap.get(boxId) : null;
        if (!bobbin) throw new Error(`Missing bobbin for crate ${rowIndex}`);
        if (!box) throw new Error(`Missing box for crate ${rowIndex}`);

        const bobbinQty = Math.max(0, toInt(crate?.bobbinQuantity) || 0);
        if (bobbinQty <= 0) throw new Error(`Invalid bobbin quantity for crate ${rowIndex}`);
        const gross = toNumber(crate?.grossWeight);
        if (!Number.isFinite(gross) || gross <= 0) throw new Error(`Invalid gross weight for crate ${rowIndex}`);

        const bobbinWeightRaw = bobbin.weight;
        const bobbinWeight = Number(bobbinWeightRaw);
        const boxWeight = Number(box.weight);
        if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
          throw new Error('Bobbin weight missing. Update bobbin first.');
        }
        if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
          throw new Error('Box weight missing. Update box first.');
        }

        const tare = bobbinWeight * bobbinQty + boxWeight;
        const net = roundTo3Decimals(gross - tare);
        if (!Number.isFinite(net) || net <= 0) {
          throw new Error(`Net weight must be positive for crate ${rowIndex}`);
        }

        if (!cutMap.has(crate.cutId)) {
          throw new Error(`Cut not found for crate ${rowIndex}`);
        }

        const operatorId = toOptionalString(crate?.operatorId);
        if (operatorId) {
          const operator = operatorMap.get(operatorId);
          if (!operator || normalizeWorkerRole(operator.role) !== 'operator') {
            throw new Error(`Invalid operator for crate ${rowIndex}`);
          }
        }

        const helperId = toOptionalString(crate?.helperId);
        if (helperId) {
          const helper = helperMap.get(helperId);
          if (!helper || normalizeWorkerRole(helper.role) !== 'helper') {
            throw new Error(`Invalid helper for crate ${rowIndex}`);
          }
        }

        return {
          rowId,
          bobbinId,
          boxId,
          bobbinQty,
          gross,
          tare,
          net,
          operatorId,
          helperId,
          cutId: crate.cutId,
          shift: toOptionalString(crate?.shift),
          machineNo: toOptionalString(crate?.machineNo),
        };
      });

      const removedRowIds = Array.from(existingRowIdsSet).filter(id => !payloadRowIds.has(id));
      const totalNetWeight = roundTo3Decimals(normalizedCrates.reduce((sum, row) => sum + row.net, 0));
      const totalBobbins = normalizedCrates.reduce((sum, row) => sum + row.bobbinQty, 0);
      if (!Number.isFinite(totalNetWeight) || totalNetWeight <= 0) {
        return res.status(400).json({ error: 'Total net weight must be greater than zero' });
      }

      const uploadIds = Array.from(new Set(existingRows.map(r => r.uploadId).filter(Boolean)));
      if (uploadIds.length !== 1) {
        return res.status(409).json({ error: 'Cutter purchase has multiple uploads. Cannot edit.' });
      }
      const uploadId = uploadIds[0];

      // Determine the next crateIndex for newly added crates
      const maxCrateIndex = activePurchaseRows.reduce((max, row) => {
        const idx = parseReceiveCrateIndex(row.barcode);
        if (!idx) return max;
        return Math.max(max, idx);
      }, 0);

      const updated = await prisma.$transaction(async (tx) => {
        await tx.lot.update({
          where: { lotNo },
          data: {
            date,
            itemId,
            firmId: firmId || null,
            supplierId,
            totalPieces: 1,
            totalWeight: totalNetWeight,
            ...actorUpdateFields(actorUserId),
          },
        });

        await tx.inboundItem.update({
          where: { id: piece.id },
          data: {
            itemId,
            weight: totalNetWeight,
            ...actorUpdateFields(actorUserId),
          },
        });

        const uniqueOperatorIds = Array.from(new Set(normalizedCrates.map(row => row.operatorId).filter(Boolean)));
        const uniqueHelperIds = Array.from(new Set(normalizedCrates.map(row => row.helperId).filter(Boolean)));
        const uniqueCutIds = Array.from(new Set(normalizedCrates.map(row => row.cutId).filter(Boolean)));

        const updatedChallan = await tx.receiveFromCutterMachineChallan.update({
          where: { id: challan.id },
          data: {
            itemId,
            date,
            totalNetWeight,
            totalBobbinQty: totalBobbins,
            operatorId: uniqueOperatorIds.length === 1 ? uniqueOperatorIds[0] : null,
            helperId: uniqueHelperIds.length === 1 ? uniqueHelperIds[0] : null,
            cutId: uniqueCutIds.length === 1 ? uniqueCutIds[0] : null,
            wastageNote: null,
            wastageNetWeight: 0,
            changeLog: appendChangeLog(challan.changeLog, {
              at: new Date().toISOString(),
              action: 'update',
              actorUserId,
              details: { totalNetWeight, totalBobbinQty: totalBobbins },
            }),
            ...actorUpdateFields(actorUserId),
          },
        });

        if (removedRowIds.length > 0) {
          await tx.receiveFromCutterMachineRow.deleteMany({
            where: { id: { in: removedRowIds } },
          });
        }

        for (const crate of normalizedCrates) {
          const cut = crate.cutId ? cutMap.get(crate.cutId) : null;
          if (crate.rowId) {
            await tx.receiveFromCutterMachineRow.update({
              where: { id: crate.rowId },
              data: {
                date,
                itemName: itemRecord?.name || null,
                grossWt: crate.gross,
                tareWt: crate.tare,
                netWt: crate.net,
                totalKg: crate.net,
                pktTypeName: boxMap.get(crate.boxId)?.name || null,
                pcsTypeName: bobbinMap.get(crate.bobbinId)?.name || null,
                bobbinId: crate.bobbinId,
                boxId: crate.boxId,
                operatorId: crate.operatorId,
                helperId: crate.helperId,
                bobbinQuantity: crate.bobbinQty,
                employee: crate.operatorId ? operatorMap.get(crate.operatorId)?.name || null : null,
                helperName: crate.helperId ? helperMap.get(crate.helperId)?.name || null : null,
                cutId: crate.cutId,
                cut: cut ? cut.name : null,
                shift: crate.shift,
                machineNo: crate.machineNo,
                ...actorUpdateFields(actorUserId),
              },
            });
          }
        }

        let crateIndex = maxCrateIndex;
        const createdRows = [];
        for (const crate of normalizedCrates.filter(c => !c.rowId)) {
          crateIndex += 1;
          const barcode = makeReceiveBarcode({ lotNo, seq: piece.seq || 1, crateIndex });
          const vchNo = `CPUR-${randomUUID().slice(0, 8)}`;
          const cut = crate.cutId ? cutMap.get(crate.cutId) : null;
          const created = await tx.receiveFromCutterMachineRow.create({
            data: {
              uploadId,
              challanId: challan.id,
              pieceId: piece.id,
              vchNo,
              date,
              itemName: itemRecord?.name || null,
              grossWt: crate.gross,
              tareWt: crate.tare,
              netWt: crate.net,
              totalKg: crate.net,
              pktTypeName: boxMap.get(crate.boxId)?.name || null,
              pcsTypeName: bobbinMap.get(crate.bobbinId)?.name || null,
              bobbinId: crate.bobbinId,
              boxId: crate.boxId,
              operatorId: crate.operatorId,
              helperId: crate.helperId,
              bobbinQuantity: crate.bobbinQty,
              issuedBobbins: 0,
              issuedBobbinWeight: 0,
              employee: crate.operatorId ? operatorMap.get(crate.operatorId)?.name || null : null,
              helperName: crate.helperId ? helperMap.get(crate.helperId)?.name || null : null,
              cutId: crate.cutId,
              cut: cut ? cut.name : null,
              shift: crate.shift,
              machineNo: crate.machineNo,
              narration: 'Cutter purchase',
              createdBy: 'cutter_purchase',
              barcode,
              ...actorCreateFields(actorUserId),
            },
          });
          createdRows.push({ id: created.id, barcode });
        }

        await tx.receiveFromCutterMachineUpload.update({
          where: { id: uploadId },
          data: { rowCount: normalizedCrates.length, ...actorUpdateFields(actorUserId) },
        });

        await tx.receiveFromCutterMachinePieceTotal.upsert({
          where: { pieceId: piece.id },
          update: {
            totalNetWeight,
            totalBob: totalBobbins,
            wastageNetWeight: 0,
            ...actorUpdateFields(actorUserId),
          },
          create: {
            pieceId: piece.id,
            totalNetWeight,
            totalBob: totalBobbins,
            wastageNetWeight: 0,
            ...actorCreateFields(actorUserId),
          },
        });

        return { challan: updatedChallan, createdRows, removedRowIds };
      });

      await logCrudWithActor(req, {
        entityType: 'cutter_purchase_inbound',
        entityId: lotNo,
        action: 'update',
        payload: {
          lotNo,
          pieceId: piece.id,
          challanNo: challan.challanNo,
          totalNetWeight,
          totalBobbins,
          removedRows: removedRowIds.length,
          addedRows: updated.createdRows.length,
        },
      });

      res.json({ ok: true, lotNo, pieceId: piece.id, ...updated, totalNetWeight, totalBobbins });
    } catch (err) {
      console.error('Failed to update cutter purchase inbound', err);
      res.status(400).json({ error: err.message || 'Failed to update cutter purchase inbound' });
    }
  },
);

router.delete(
  '/api/inbound/cutter_purchase/:lotNo',
  requireDeletePermission('inbound'),
  requireDeletePermission('receive.cutter'),
  async (req, res) => {
    try {
      const actorUserId = req.user?.id;
      const lotNo = String(req.params.lotNo || '').trim();
      if (!lotNo) return res.status(400).json({ error: 'Missing lotNo' });
      if (!isCutterPurchaseLotNo(lotNo)) {
        return res.status(400).json({ error: 'Not a cutter purchase lot' });
      }

      const lot = await prisma.lot.findUnique({ where: { lotNo } });
      if (!lot) return res.status(404).json({ error: 'Lot not found' });

      const pieces = await prisma.inboundItem.findMany({ where: { lotNo }, orderBy: { seq: 'asc' } });
      if (pieces.length !== 1) {
        return res.status(409).json({ error: 'Cutter purchase lot must have exactly 1 inbound piece' });
      }
      const piece = pieces[0];

      const allRows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { pieceId: piece.id },
        select: {
          id: true,
          createdBy: true,
          uploadId: true,
          challanId: true,
          barcode: true,
          issuedBobbins: true,
          issuedBobbinWeight: true,
          dispatchedCount: true,
          dispatchedWeight: true,
        },
      });

      const nonPurchaseRows = allRows.filter(r => r.createdBy !== 'cutter_purchase');
      if (nonPurchaseRows.length > 0) {
        return res.status(409).json({ error: 'Lot contains non-purchase cutter receive rows. Cannot delete safely.' });
      }

      const rowIds = allRows.map(r => r.id);
      const barcodes = allRows.map(r => r.barcode).filter(Boolean);

      const counterUsed = allRows.find(r => Number(r.issuedBobbins || 0) > 0
        || Number(r.issuedBobbinWeight || 0) > 0
        || Number(r.dispatchedCount || 0) > 0
        || Number(r.dispatchedWeight || 0) > 0);
      if (counterUsed) {
        return res.status(409).json({ error: 'Cannot delete cutter purchase: one or more crates were already issued or dispatched.' });
      }

      const [holoIssues, boxTransfers] = await Promise.all([
        findHoloIssuesReferencingCutterRows({ rowIds, barcodes }),
        findCutterBoxTransfersForRows({ rowIds, barcodes }),
      ]);
      if (holoIssues.length > 0) {
        return res.status(409).json({
          error: 'Cannot delete cutter purchase: already used in Holo issue.',
          details: { holoIssueIds: holoIssues.map(i => i.id) },
        });
      }
      if (boxTransfers.length > 0) {
        return res.status(409).json({
          error: 'Cannot delete cutter purchase: box transfer exists for one or more crates.',
          details: { boxTransferIds: boxTransfers.map(t => t.id) },
        });
      }

      const challans = await prisma.receiveFromCutterMachineChallan.findMany({
        where: { lotNo, pieceId: piece.id },
        select: { id: true, challanNo: true },
      });
      const challanIds = challans.map(c => c.id);
      const uploadIds = Array.from(new Set(allRows.map(r => r.uploadId).filter(Boolean)));

      await prisma.$transaction(async (tx) => {
        if (allRows.length > 0) {
          await tx.receiveFromCutterMachineRow.deleteMany({ where: { pieceId: piece.id } });
        }
        if (challanIds.length > 0) {
          await tx.receiveFromCutterMachineChallan.deleteMany({ where: { id: { in: challanIds } } });
        }
        await tx.receiveFromCutterMachinePieceTotal.deleteMany({ where: { pieceId: piece.id } });

        if (uploadIds.length > 0) {
          for (const uploadId of uploadIds) {
            const remaining = await tx.receiveFromCutterMachineRow.count({ where: { uploadId } });
            if (remaining === 0) {
              await tx.receiveFromCutterMachineUpload.delete({ where: { id: uploadId } });
            }
          }
        }

        await tx.inboundItem.deleteMany({ where: { lotNo } });
        await tx.lot.delete({ where: { lotNo } });
      });

      await logCrudWithActor(req, {
        entityType: 'cutter_purchase_inbound',
        entityId: lotNo,
        action: 'delete',
        payload: {
          lotNo,
          pieceId: piece.id,
          challanNos: challans.map(c => c.challanNo),
          totalRows: allRows.length,
        },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to delete cutter purchase inbound', err);
      res.status(500).json({ error: err.message || 'Failed to delete cutter purchase inbound' });
    }
  },
);

router.post('/api/issue_to_cutter_machine', requirePermission('issue.cutter', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, lotNo, pieceIds, pieceLines, note, machineId, operatorId, cutId } = req.body;
    if (!date || !itemId || !lotNo) {
      return res.status(400).json({ error: 'Missing required issue_to_cutter_machine fields' });
    }
    if (!cutId) {
      return res.status(400).json({ error: 'cutId is required' });
    }

    const rawPieceLines = Array.isArray(pieceLines) ? pieceLines : [];
    const explicitPieceLines = rawPieceLines
      .map((line) => ({
        pieceId: typeof line?.pieceId === 'string' ? line.pieceId.trim() : '',
        issuedWeight: toStrictPositiveWeight(line?.issuedWeight),
        count: toNonNegativeInt(line?.count) || 0,
      }))
      .filter((line) => line.pieceId);

    const fallbackPieceIds = Array.isArray(pieceIds)
      ? pieceIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitPieceLines.length === 0 && fallbackPieceIds.length === 0) {
      return res.status(400).json({ error: 'Provide pieceLines or pieceIds' });
    }

    const itemRecord = await prisma.item.findUnique({ where: { id: itemId } });
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });

    const cutRecord = await prisma.cut.findUnique({ where: { id: cutId } });
    if (!cutRecord) return res.status(404).json({ error: 'Cut not found' });

    const cutterLineCount = (explicitPieceLines.length > 0 ? explicitPieceLines.length : fallbackPieceIds.length);
    const { issueRecord, issueLines } = await timedTransaction('issue_to_cutter_machine.create', cutterLineCount, async (tx) => {
      const sourceLines = explicitPieceLines.length > 0
        ? explicitPieceLines
        : fallbackPieceIds.map((pieceId) => ({ pieceId, issuedWeight: null, count: 1 }));
      const uniquePieceIds = Array.from(new Set(sourceLines.map((line) => line.pieceId).filter(Boolean)));
      const pieces = await tx.inboundItem.findMany({
        where: { id: { in: uniquePieceIds } },
        orderBy: { seq: 'asc' },
      });

      if (pieces.length !== uniquePieceIds.length) {
        throw new Error('One or more pieces do not exist');
      }
      const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));

      const normalizedLines = sourceLines.map((line) => {
        const piece = pieceMap.get(line.pieceId);
        if (!piece) throw new Error(`Piece ${line.pieceId} does not exist`);
        if (piece.lotNo !== lotNo) {
          throw new Error(`Piece ${piece.id} does not belong to lot ${lotNo}`);
        }
        if (piece.itemId !== itemId) {
          throw new Error(`Piece ${piece.id} does not match item ${itemId}`);
        }
        const availableWeight = Math.max(
          0,
          Number(piece.weight || 0) - Number(piece.dispatchedWeight || 0) - Number(piece.issuedToCutterWeight || 0),
        );
        if (availableWeight <= TAKE_BACK_EPSILON) {
          throw new Error(`Piece ${piece.id} has no available weight`);
        }
        const requestedWeight = line.issuedWeight == null ? availableWeight : Number(line.issuedWeight);
        if (!Number.isFinite(requestedWeight) || requestedWeight <= 0) {
          throw new Error(`Invalid issued weight for piece ${piece.id}`);
        }
        if (requestedWeight - availableWeight > TAKE_BACK_EPSILON) {
          throw new Error(`Issued weight exceeds available weight for piece ${piece.id}`);
        }

        return {
          sourceId: piece.id,
          weight: roundTo3Decimals(requestedWeight),
          count: line.count > 0 ? line.count : 1,
        };
      });

      const totalWeight = roundTo3Decimals(normalizedLines.reduce((sum, line) => sum + Number(line.weight || 0), 0));
      const totalCount = normalizedLines.reduce((sum, line) => sum + (Number(line.count || 0) > 0 ? Number(line.count) : 1), 0);
      const pieceIdsCsv = uniquePieceIds.join(',');
      const firstSeq = pieces[0]?.seq ?? 0;

      const issueRow = await tx.issueToCutterMachine.create({
        data: {
          id: randomUUID(),
          date,
          itemId,
          lotNo,
          cutId,
          count: toNonNegativeInt(totalCount),
          totalWeight,
          pieceIds: pieceIdsCsv,
          reason: 'internal',
          note: note || null,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: makeIssueBarcode({ lotNo, seq: firstSeq }),
          ...actorCreateFields(actorUserId),
        },
      });

      const createdLines = [];
      for (const line of normalizedLines) {
        const createdLine = await tx.issueToCutterMachineLine.create({
          data: {
            issueId: issueRow.id,
            pieceId: line.sourceId,
            issuedWeight: line.weight,
            ...actorCreateFields(actorUserId),
          },
        });
        createdLines.push(createdLine);
      }

      await applyCutterTakeBackReturn(
        tx,
        normalizedLines.map((line) => ({ sourceId: line.sourceId, weight: line.weight })),
        actorUserId,
        1,
      );

      return { issueRecord: issueRow, issueLines: createdLines };
    });

    await logCrudWithActor(req, {
      entityType: 'issue_to_cutter_machine',
      entityId: issueRecord.id,
      action: 'create',
      payload: {
        lotNo: issueRecord.lotNo,
        date: issueRecord.date,
        itemId: issueRecord.itemId,
        cutId: issueRecord.cutId,
        count: issueRecord.count,
        totalWeight: issueRecord.totalWeight,
        pieceIds: issueLines.map((line) => line.pieceId),
        pieceLines: issueLines.map((line) => ({ pieceId: line.pieceId, issuedWeight: line.issuedWeight })),
        machineId: issueRecord.machineId,
        operatorId: issueRecord.operatorId,
      },
    });

    res.json({ ok: true, issueToCutterMachine: issueRecord, issueToMachine: issueRecord });
    // Notify issue_to_cutter_machine created
    try {
      const itemName = (await prisma.item.findUnique({ where: { id: issueRecord.itemId } })).name || '';
      const machineName = issueRecord.machineId ? (await prisma.machine.findUnique({ where: { id: issueRecord.machineId } })).name : '';
      const operatorName = issueRecord.operatorId ? (await prisma.operator.findUnique({ where: { id: issueRecord.operatorId } })).name : '';
      const cutName = issueRecord.cutId ? (await prisma.cut.findUnique({ where: { id: issueRecord.cutId } })).name : '';
      // Include machineNumber for templates (alias of machineName)
      const machineNumber = machineName || '';
      sendNotification('issue_to_cutter_machine_created', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, machineName, machineNumber, operatorName, cutName, pieceIds: issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [], createdByUserId: issueRecord.createdByUserId || actorUserId || null });
      // If this issue_to_cutter_machine made available pieces for this item drop to zero, notify
      try {
        const availableAfter = await prisma.inboundItem.count({ where: { itemId: issueRecord.itemId, status: 'available' } });
        console.log(`Available pieces after issue_to_cutter_machine for ${itemName}: ${availableAfter}`);
        if (availableAfter === 0) {
          console.log(`Triggering out_of_stock notification for ${itemName}`);
          // Add small delay to ensure first message is queued before second
          setTimeout(() => {
            sendNotification('item_out_of_stock', { itemName, available: 0 });
          }, 1000);
        }
      } catch (e) { console.error('failed to check/send out_of_stock after issue_to_cutter_machine', e); }
    } catch (e) { console.error('notify issue_to_cutter_machine error', e); }
  } catch (err) {
    console.error('Failed to record issue_to_cutter_machine', err);
    res.status(400).json({ error: err.message || 'Failed to record issue_to_cutter_machine' });
  }
});

router.post('/api/receive_from_cutter_machine/import', requirePermission('receive.cutter', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { filename, content } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Missing filename' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing CSV content' });
    }

    const { rows, issues } = parseReceiveCsvContent(content);
    if (issues.length > 0) {
      return res.status(400).json({ error: 'CSV validation failed', issues });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No usable rows found in CSV' });
    }

    const vchNos = rows.map(r => r.vchNo);
    const existing = await prisma.receiveFromCutterMachineRow.findMany({ where: { vchNo: { in: vchNos } }, select: { vchNo: true } });
    if (existing.length > 0) {
      const duplicates = existing.map(r => r.vchNo);
      return res.status(409).json({ error: 'Duplicate VchNo detected in database', duplicates });
    }

    const pieceIncrements = aggregateNetByPiece(rows);
    const pieceCountIncrements = aggregatePieceCounts(rows);

    const pieceIds = Array.from(pieceIncrements.keys());
    const inboundAndTotals = await fetchInboundAndTotals(pieceIds);
    const pieceMeta = buildPieceSummaries(pieceIds, inboundAndTotals, pieceIncrements);
    const summary = buildReceiveSummary({ filename, rows, incrementsMap: pieceIncrements, pieceMeta });

    const upload = await prisma.$transaction(async (tx) => {
      // Normalize PcsTypeName to bobbin IDs (create bobbins if they don't exist)
      const uniquePcsTypeNames = [...new Set(rows.map(r => r.pcsTypeName).filter(Boolean))];
      const bobbinIdMap = new Map();

      for (const pcsTypeName of uniquePcsTypeNames) {
        const normalizedName = pcsTypeName.trim() || 'Bobbin';
        // Find or create bobbin (case-insensitive)
        let bobbin = await tx.bobbin.findFirst({
          where: {
            name: {
              equals: normalizedName,
              mode: 'insensitive',
            },
          },
        });

        if (!bobbin) {
          bobbin = await tx.bobbin.create({
            data: { name: normalizedName, ...actorCreateFields(actorUserId) },
          });
        }

        bobbinIdMap.set(pcsTypeName, bobbin.id);
      }

      // Also ensure "Bobbin" exists for empty/null values
      if (!bobbinIdMap.has(null) && !bobbinIdMap.has('')) {
        let defaultBobbin = await tx.bobbin.findFirst({
          where: {
            name: {
              equals: 'Bobbin',
              mode: 'insensitive',
            },
          },
        });

        if (!defaultBobbin) {
          defaultBobbin = await tx.bobbin.create({
            data: { name: 'Bobbin', ...actorCreateFields(actorUserId) },
          });
        }

        bobbinIdMap.set(null, defaultBobbin.id);
        bobbinIdMap.set('', defaultBobbin.id);
      }

      const createdUpload = await tx.receiveFromCutterMachineUpload.create({
        data: {
          originalFilename: filename,
          rowCount: rows.length,
          ...actorCreateFields(actorUserId),
        },
      });

      const uniquePieceIds = Array.from(new Set(rows.map((row) => row.pieceId).filter(Boolean)));
      const pieceAllocations = new Map();
      for (const pid of uniquePieceIds) {
        const allocations = await listOpenCutterIssueAllocationsForPiece(tx, pid);
        pieceAllocations.set(pid, allocations.map((entry) => ({ ...entry })));
      }

      const createPayload = [];
      for (const row of rows) {
        const allocations = pieceAllocations.get(row.pieceId) || [];
        const rowNetWeight = Number(row.netWt || 0);
        let resolvedIssueId = null;
        if (Number.isFinite(rowNetWeight) && rowNetWeight > TAKE_BACK_EPSILON) {
          const matched = allocations.find((entry) => Number(entry.remainingWeight || 0) - rowNetWeight > -TAKE_BACK_EPSILON);
          if (!matched) {
            throw new Error(`Unable to allocate imported row ${row.vchNo || ''} for piece ${row.pieceId || ''} to an open issue`);
          }
          matched.remainingWeight = clampZero(Number(matched.remainingWeight || 0) - rowNetWeight);
          resolvedIssueId = matched.issueId || null;
        }

        createPayload.push({
          issueId: resolvedIssueId,
          ...row,
          uploadId: createdUpload.id,
          bobbinQuantity: row.bobbinQuantity,
          bobbinId: bobbinIdMap.get(row.pcsTypeName) || bobbinIdMap.get(null) || bobbinIdMap.get(''),
          ...actorCreateFields(actorUserId),
        });
      }

      if (createPayload.length > 0) {
        await tx.receiveFromCutterMachineRow.createMany({ data: createPayload });
      }

      for (const [pieceId, incrementBy] of pieceIncrements.entries()) {
        if (!Number.isFinite(incrementBy) || incrementBy === 0) continue;
        const pcsIncrement = pieceCountIncrements.get(pieceId) || 0;
        const updateData = {
          totalNetWeight: { increment: incrementBy },
          ...(pcsIncrement > 0 ? { totalBob: { increment: pcsIncrement } } : {}),
          ...actorUpdateFields(actorUserId),
        };
        await tx.receiveFromCutterMachinePieceTotal.upsert({
          where: { pieceId },
          update: updateData,
          create: { pieceId, totalNetWeight: incrementBy, totalBob: pcsIncrement > 0 ? pcsIncrement : 0, ...actorCreateFields(actorUserId) },
        });
      }

      return createdUpload;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_upload',
      entityId: upload.id,
      action: 'create',
      payload: {
        filename,
        rowCount: upload.rowCount,
        summary,
      },
    });

    res.json({
      ok: true,
      upload: {
        id: upload.id,
        originalFilename: upload.originalFilename,
        uploadedAt: upload.uploadedAt,
        rowCount: upload.rowCount,
      },
      summary,
    });
  } catch (err) {
    console.error('Failed to import receive-from-machine CSV', err);
    res.status(400).json({ error: err.message || 'Failed to import receive-from-machine CSV' });
  }
});

// Mark remaining pending weight for a piece as wastage (only if piece was issued to machine)
router.post('/api/receive_from_cutter_machine/mark_wastage', requirePermission('receive.cutter', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { pieceId } = req.body || {};
    if (!pieceId || typeof pieceId !== 'string') return res.status(400).json({ error: 'Missing pieceId' });

    // Check inbound item exists
    const inbound = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
    if (!inbound) return res.status(404).json({ error: 'Piece not found' });

    // Verify piece was issued to machine at least once
    const issuedCount = await prisma.issueToCutterMachineLine.count({
      where: {
        pieceId,
        issue: { isDeleted: false },
      },
    });
    if (issuedCount === 0) return res.status(400).json({ error: 'Piece was not issued to machine' });

    const currentTotal = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
    const trackedWastageWeight = Number(currentTotal?.wastageNetWeight || 0);
    const challanWastageAgg = await prisma.receiveFromCutterMachineChallan.aggregate({
      where: { pieceId, isDeleted: false },
      _sum: { wastageNetWeight: true },
    });
    const challanWastageWeight = Number(challanWastageAgg?._sum?.wastageNetWeight || 0);
    const unattributedWastageWeight = Math.max(0, trackedWastageWeight - challanWastageWeight);

    // Mark only still-issued pending allocation (never full inbound balance).
    const openAllocations = await listOpenCutterIssueAllocationsForPiece(prisma, pieceId);
    const remaining = clampZero(roundTo3Decimals(
      openAllocations.reduce((sum, entry) => sum + Number(entry.remainingWeight || 0), 0) - unattributedWastageWeight,
    ));
    if (remaining <= 0) return res.status(400).json({ error: 'No remaining pending weight to mark as wastage' });

    // Upsert wastage increment inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      await tx.receiveFromCutterMachinePieceTotal.upsert({
        where: { pieceId },
        update: { wastageNetWeight: { increment: remaining }, ...actorUpdateFields(actorUserId) },
        create: { pieceId, totalNetWeight: 0, wastageNetWeight: remaining, ...actorCreateFields(actorUserId) },
      });
      return tx.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
    });

    // Send notification
    try {
      const lotNo = inbound.lotNo || '';
      const itemRec = inbound.itemId ? await prisma.item.findUnique({ where: { id: inbound.itemId } }) : null;
      const itemName = itemRec ? itemRec.name || '' : '';
      const wastageFormatted = Number(remaining).toFixed(3);
      const inboundWeight = Number(inbound.weight || 0);
      const wastagePercent = inboundWeight > 0 ? ((remaining / inboundWeight) * 100).toFixed(2) : '0.00';
      sendNotification('piece_wastage_marked_cutter', { pieceId, lotNo, itemName, wastage: wastageFormatted, wastagePercent, createdByUserId: updated?.createdByUserId || actorUserId || null });
    } catch (e) { console.error('notify piece wastage error', e); }

    await logCrudWithActor(req, {
      entityType: 'receive_piece_total',
      entityId: pieceId,
      action: 'update',
      before: currentTotal,
      after: updated,
      payload: { action: 'mark_wastage', marked: remaining },
    });

    res.json({ ok: true, pieceId, marked: remaining, updated });
  } catch (err) {
    console.error('Failed to mark wastage', err);
    res.status(500).json({ error: err.message || 'Failed to mark wastage' });
  }
});

// Bulk manual receive for cutter with challan generation
router.post('/api/receive_from_cutter_machine/bulk', requirePermission('receive.cutter', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const entriesRaw = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entriesRaw.length === 0) {
      return res.status(400).json({ error: 'No entries provided' });
    }

    const normalizedEntries = entriesRaw.map((entry) => ({
      ...entry,
      pieceId: typeof entry.pieceId === 'string' ? entry.pieceId.trim() : '',
      bobbinId: typeof entry.bobbinId === 'string' ? entry.bobbinId.trim() : '',
      boxId: typeof entry.boxId === 'string' ? entry.boxId.trim() : '',
      operatorId: typeof entry.operatorId === 'string' ? entry.operatorId.trim() : '',
      helperId: typeof entry.helperId === 'string' ? entry.helperId.trim() : '',
      cutId: typeof entry.cutId === 'string' ? entry.cutId.trim() : '',
      shift: typeof entry.shift === 'string' ? entry.shift.trim() : '',
    }));

    const pieceIds = new Set(normalizedEntries.map(e => e.pieceId).filter(Boolean));
    if (pieceIds.size !== 1) {
      return res.status(400).json({ error: 'Entries must belong to a single piece' });
    }
    const pieceId = Array.from(pieceIds)[0];

    const piece = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
    if (!piece) return res.status(404).json({ error: 'Piece not found' });
    const issueAllocations = (await listOpenCutterIssueAllocationsForPiece(prisma, pieceId)).map((entry) => ({ ...entry }));
    const itemRec = piece.itemId ? await prisma.item.findUnique({ where: { id: piece.itemId } }) : null;
    const itemName = itemRec ? itemRec.name || '' : '';
    const machineByPieceId = await buildCutterIssueMachineMap([pieceId]);
    const fallbackMachineName = machineByPieceId.get(pieceId) || null;

    const receiveEntries = normalizedEntries.filter(e => !e.isWastage);
    const wastageEntries = normalizedEntries.filter(e => e.isWastage);
    if (wastageEntries.length > 1) {
      return res.status(400).json({ error: 'Only one wastage entry is allowed per challan' });
    }
    if (receiveEntries.length === 0 && wastageEntries.length === 0) {
      return res.status(400).json({ error: 'No valid entries provided' });
    }

    const operatorIds = new Set(normalizedEntries.map(e => e.operatorId).filter(Boolean));
    if (operatorIds.size !== 1) {
      return res.status(400).json({ error: 'All entries must use the same operator' });
    }
    const operatorId = Array.from(operatorIds)[0];
    if (!operatorId) {
      return res.status(400).json({ error: 'Missing operator' });
    }

    const operatorRec = await prisma.operator.findUnique({ where: { id: operatorId } });
    if (!operatorRec || normalizeWorkerRole(operatorRec.role) !== 'operator') {
      return res.status(400).json({ error: 'Invalid operator selected' });
    }

    const helperIds = new Set(normalizedEntries.map(e => e.helperId).filter(Boolean));
    if (helperIds.size > 1) {
      return res.status(400).json({ error: 'All entries must use the same helper' });
    }
    const helperId = helperIds.size === 1 ? Array.from(helperIds)[0] : null;
    let helperRec = null;
    if (helperId) {
      helperRec = await prisma.operator.findUnique({ where: { id: helperId } });
      if (!helperRec || normalizeWorkerRole(helperRec.role) !== 'helper') {
        return res.status(400).json({ error: 'Invalid helper selected' });
      }
    }

    const cutIds = new Set(normalizedEntries.map(e => e.cutId).filter(Boolean));
    if (cutIds.size > 1) {
      return res.status(400).json({ error: 'All entries must use the same cut' });
    }
    const cutId = cutIds.size === 1 ? Array.from(cutIds)[0] : null;
    let cutRecord = null;
    if (cutId) {
      cutRecord = await prisma.cut.findUnique({ where: { id: cutId } });
      if (!cutRecord) {
        return res.status(404).json({ error: 'Selected cut was not found' });
      }
    }

    const receiveDateStr = toOptionalString(normalizedEntries[0]?.receiveDate) || new Date().toISOString().slice(0, 10);

    const inboundWeight = Number(piece.weight || 0);
    let pendingRemaining = roundTo3Decimals(
      issueAllocations.reduce((sum, entry) => sum + Number(entry.remainingWeight || 0), 0),
    );
    if (pendingRemaining <= TAKE_BACK_EPSILON) {
      const currentTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
      const alreadyReceived = currentTotals ? Number(currentTotals.totalNetWeight || 0) : 0;
      const existingWastage = currentTotals ? Number(currentTotals.wastageNetWeight || 0) : 0;
      pendingRemaining = Math.max(0, inboundWeight - alreadyReceived - existingWastage);
    }

    if (pendingRemaining <= 0 && receiveEntries.length > 0) {
      return res.status(400).json({ error: 'Piece has no pending weight remaining' });
    }

    const bobbinIds = Array.from(new Set(receiveEntries.map(e => e.bobbinId).filter(Boolean)));
    const boxIds = Array.from(new Set(receiveEntries.map(e => e.boxId).filter(Boolean)));
    const bobbins = bobbinIds.length ? await prisma.bobbin.findMany({ where: { id: { in: bobbinIds } } }) : [];
    const boxes = boxIds.length ? await prisma.box.findMany({ where: { id: { in: boxIds } } }) : [];
    const bobbinMap = new Map(bobbins.map(b => [b.id, b]));
    const boxMap = new Map(boxes.map(b => [b.id, b]));

    const existingRows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { pieceId, isDeleted: false },
      select: { barcode: true },
    });
    let maxCrateIndex = 0;
    for (const row of existingRows) {
      const idx = parseReceiveCrateIndex(row.barcode);
      if (idx != null && idx > maxCrateIndex) {
        maxCrateIndex = idx;
      }
    }

    const rowsToCreate = [];
    let totalNetWeight = 0;
    let totalBobbinQty = 0;
    let crateIndex = maxCrateIndex;

    for (const entry of receiveEntries) {
      if (!entry.bobbinId) return res.status(400).json({ error: 'Missing bobbin selection' });
      if (!entry.boxId) return res.status(400).json({ error: 'Missing box selection' });

      const bobbinQty = Math.max(0, toInt(entry.bobbinQuantity ?? entry.bobbinQty) || 0);
      if (bobbinQty <= 0) {
        return res.status(400).json({ error: 'Bobbin quantity must be greater than zero' });
      }
      const gross = toNumber(entry.grossWeight);
      if (gross === null || !Number.isFinite(gross) || gross <= 0) {
        return res.status(400).json({ error: 'Gross weight must be a positive number' });
      }

      const bobbin = bobbinMap.get(entry.bobbinId);
      if (!bobbin) return res.status(404).json({ error: 'Bobbin not found' });
      const box = boxMap.get(entry.boxId);
      if (!box) return res.status(404).json({ error: 'Box not found' });

      const bobbinWeightRaw = bobbin.weight;
      const bobbinWeight = Number(bobbinWeightRaw);
      if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
        return res.status(400).json({ error: 'Bobbin weight missing. Update bobbin first.' });
      }
      const boxWeight = Number(box.weight);
      if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
        return res.status(400).json({ error: 'Box weight missing. Update box first.' });
      }

      const tare = roundTo3Decimals(boxWeight + bobbinWeight * bobbinQty);
      const net = roundTo3Decimals(gross - tare);
      if (!Number.isFinite(net) || net <= 0) {
        return res.status(400).json({ error: 'Computed net weight must be positive. Check weights and quantity.' });
      }
      if (net - pendingRemaining > 1e-6) {
        return res.status(400).json({ error: 'Net weight exceeds pending weight' });
      }

      let rowIssueId = null;
      if (issueAllocations.length > 0) {
        const matched = issueAllocations.find((entry) => Number(entry.remainingWeight || 0) - net > -TAKE_BACK_EPSILON);
        if (!matched) {
          return res.status(400).json({ error: 'Net weight exceeds pending weight' });
        }
        rowIssueId = matched.issueId || null;
        matched.remainingWeight = clampZero(Number(matched.remainingWeight || 0) - net);
      }

      pendingRemaining = roundTo3Decimals(pendingRemaining - net);
      totalNetWeight = roundTo3Decimals(totalNetWeight + net);
      totalBobbinQty += bobbinQty;
      crateIndex += 1;

      rowsToCreate.push({
        issueId: rowIssueId,
        pieceId,
        vchNo: `MAN-${randomUUID().slice(0, 8)}`,
        date: receiveDateStr,
        itemName: itemName || null,
        grossWt: roundTo3Decimals(gross),
        tareWt: tare,
        netWt: net,
        totalKg: net,
        pktTypeName: box.name,
        pcsTypeName: bobbin.name,
        bobbinId: bobbin.id,
        boxId: box.id,
        operatorId: operatorRec.id,
        helperId: helperId || null,
        bobbinQuantity: bobbinQty,
        employee: operatorRec.name,
        shift: entry.shift || null,
        machineNo: entry.machineNo || fallbackMachineName,
        helperName: helperRec ? helperRec.name : null,
        cutId: cutRecord ? cutRecord.id : null,
        cut: cutRecord ? cutRecord.name : null,
        narration: 'Manual entry',
        createdBy: 'manual',
        barcode: makeReceiveBarcode({ lotNo: piece.lotNo, seq: piece.seq, crateIndex }),
      });
    }

    let wastageToMark = 0;
    let wastageNote = null;
    if (wastageEntries.length > 0) {
      if (pendingRemaining <= 0) {
        return res.status(400).json({ error: 'No remaining pending weight to mark as wastage' });
      }
      wastageToMark = roundTo3Decimals(pendingRemaining);
      wastageNote = `Wastage marked: ${wastageToMark.toFixed(3)} kg`;
      pendingRemaining = 0;
    }

    const created = await prisma.$transaction(async (tx) => {
      const upload = await tx.receiveFromCutterMachineUpload.create({
        data: {
          originalFilename: 'manual-challan',
          rowCount: rowsToCreate.length,
          ...actorCreateFields(actorUserId),
        },
      });

      const challanMeta = await allocateCutterChallanNumber(tx, actorUserId, receiveDateStr);
      const challan = await tx.receiveFromCutterMachineChallan.create({
        data: {
          challanNo: challanMeta.challanNo,
          sequence: challanMeta.sequence,
          fiscalYear: challanMeta.fiscalYear,
          pieceId,
          lotNo: piece.lotNo,
          itemId: piece.itemId || null,
          date: receiveDateStr,
          totalNetWeight,
          totalBobbinQty,
          operatorId: operatorRec.id,
          helperId: helperId || null,
          cutId: cutRecord ? cutRecord.id : null,
          wastageNetWeight: wastageToMark,
          wastageNote,
          changeLog: [
            {
              at: new Date().toISOString(),
              action: 'create',
              actorUserId,
              details: { totalNetWeight, totalBobbinQty, wastageNetWeight: wastageToMark },
            },
          ],
          ...actorCreateFields(actorUserId),
        },
      });

      const createdRows = [];
      for (const row of rowsToCreate) {
        const createdRow = await tx.receiveFromCutterMachineRow.create({
          data: {
            ...row,
            uploadId: upload.id,
            challanId: challan.id,
            ...actorCreateFields(actorUserId),
          },
        });
        createdRows.push(createdRow);
      }

      await tx.receiveFromCutterMachinePieceTotal.upsert({
        where: { pieceId },
        update: {
          totalNetWeight: { increment: totalNetWeight },
          totalBob: { increment: totalBobbinQty },
          ...(wastageToMark > 0 ? { wastageNetWeight: { increment: wastageToMark } } : {}),
          ...actorUpdateFields(actorUserId),
        },
        create: {
          pieceId,
          totalNetWeight,
          totalBob: totalBobbinQty,
          wastageNetWeight: wastageToMark,
          ...actorCreateFields(actorUserId),
        },
      });

      return { challan, upload, rows: createdRows };
    });

    if (wastageToMark > 0) {
      try {
        const itemRec = piece.itemId ? await prisma.item.findUnique({ where: { id: piece.itemId } }) : null;
        const itemName = itemRec ? itemRec.name || '' : '';
        const wastageFormatted = Number(wastageToMark).toFixed(3);
        const wastagePercent = inboundWeight > 0 ? ((wastageToMark / inboundWeight) * 100).toFixed(2) : '0.00';
        sendNotification('piece_wastage_marked_cutter', { pieceId, lotNo: piece.lotNo || '', itemName, wastage: wastageFormatted, wastagePercent, createdByUserId: created?.challan?.createdByUserId || actorUserId || null });
      } catch (e) {
        console.error('notify piece wastage error', e);
      }
    }

    await logCrudWithActor(req, {
      entityType: 'receive_challan',
      entityId: created.challan.id,
      action: 'create',
      payload: {
        challanNo: created.challan.challanNo,
        pieceId,
        totalNetWeight,
        totalBobbinQty,
        wastageNetWeight: wastageToMark,
      },
    });

    res.json({
      ok: true,
      challan: created.challan,
      rowsCreated: created.rows.length,
      wastageMarked: wastageToMark,
    });

    // Notify receive_from_cutter_machine created
    try {
      const itemRec = piece.itemId ? await prisma.item.findUnique({ where: { id: piece.itemId } }) : null;
      const itemName = itemRec ? itemRec.name || '' : '';
      const operatorRec = normalizedEntries[0].operatorId ? await prisma.operator.findUnique({ where: { id: normalizedEntries[0].operatorId } }) : null;
      const operatorName = operatorRec ? operatorRec.name : '';

      sendNotification('receive_from_cutter_machine_created', {
        itemName,
        lotNo: piece.lotNo,
        date: new Date().toISOString().slice(0, 10),
        netWeight: totalNetWeight,
        bobbinQuantity: totalBobbinQty,
        operatorName,
        challanNo: created.challan.challanNo,
        createdByUserId: created?.challan?.createdByUserId || actorUserId || null,
      });
    } catch (e) { console.error('notify receive_from_cutter_machine bulk error', e); }
  } catch (err) {
    console.error('Failed to record bulk receive', err);
    res.status(500).json({ error: err.message || 'Failed to record bulk receive' });
  }
});

router.post('/api/receive_from_cutter_machine/manual', requirePermission('receive.cutter', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const {
      pieceId,
      lotNo,
      bobbinId,
      boxId,
      bobbinQuantity,
      operatorId,
      helperId,
      grossWeight,
      receiveDate,
      issueBarcode,
      cutId,
      shift,
    } = req.body || {};

    if (!boxId) return res.status(400).json({ error: 'Missing box selection' });
    if (!bobbinId) return res.status(400).json({ error: 'Missing bobbin selection' });
    if (!operatorId) return res.status(400).json({ error: 'Missing operator' });

    const normalizedIssueCode = issueBarcode ? normalizeBarcodeInput(issueBarcode) : '';
    let issueMachineName = null;
    let resolvedIssueId = null;
    let resolvedPieceId = pieceId;
    let resolvedLotNo = lotNo;
    if (normalizedIssueCode) {
      const issue = await prisma.issueToCutterMachine.findFirst({
        where: { barcode: normalizedIssueCode, isDeleted: false },
      });
      if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
      const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (pieceIds.length !== 1) {
        return res.status(400).json({ error: 'Issue barcode must reference exactly one piece' });
      }
      resolvedPieceId = pieceIds[0];
      resolvedLotNo = issue.lotNo;
      resolvedIssueId = issue.id;
      if (issue.machineId) {
        const machineRec = await prisma.machine.findUnique({ where: { id: issue.machineId } });
        issueMachineName = machineRec ? machineRec.name : null;
      }
    }

    if (!resolvedPieceId || typeof resolvedPieceId !== 'string') return res.status(400).json({ error: 'Missing pieceId' });

    const piece = await prisma.inboundItem.findUnique({ where: { id: resolvedPieceId } });
    if (!piece) return res.status(404).json({ error: 'Piece not found' });
    const openAllocations = resolvedIssueId
      ? []
      : await listOpenCutterIssueAllocationsForPiece(prisma, resolvedPieceId);
    if (resolvedLotNo && piece.lotNo !== resolvedLotNo) return res.status(400).json({ error: 'Piece does not belong to the scanned issue' });
    const itemRec = piece.itemId ? await prisma.item.findUnique({ where: { id: piece.itemId } }) : null;
    const itemName = itemRec ? itemRec.name || '' : '';

    const bobbin = await prisma.bobbin.findUnique({ where: { id: bobbinId } });
    if (!bobbin) return res.status(404).json({ error: 'Bobbin not found' });
    const box = await prisma.box.findUnique({ where: { id: boxId } });
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const operatorRec = await prisma.operator.findUnique({ where: { id: operatorId } });
    if (!operatorRec || normalizeWorkerRole(operatorRec.role) !== 'operator') {
      return res.status(400).json({ error: 'Invalid operator selected' });
    }
    const helperRec = helperId ? await prisma.operator.findUnique({ where: { id: helperId } }) : null;
    if (helperId && (!helperRec || normalizeWorkerRole(helperRec.role) !== 'helper')) {
      return res.status(400).json({ error: 'Invalid helper selected' });
    }

    let cutRecord = null;
    if (cutId) {
      cutRecord = await prisma.cut.findUnique({ where: { id: cutId } });
      if (!cutRecord) {
        return res.status(404).json({ error: 'Selected cut was not found' });
      }
    }

    const bobbinQty = Math.max(0, toInt(bobbinQuantity) || 0);
    if (bobbinQty <= 0) {
      return res.status(400).json({ error: 'Bobbin quantity must be greater than zero' });
    }
    const gross = toNumber(grossWeight);
    if (gross === null || !Number.isFinite(gross) || gross <= 0) {
      return res.status(400).json({ error: 'Gross weight must be a positive number' });
    }

    const bobbinWeightRaw = bobbin.weight;
    const bobbinWeight = Number(bobbinWeightRaw);
    if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
      return res.status(400).json({ error: 'Bobbin weight missing. Update bobbin first.' });
    }
    const boxWeight = Number(box.weight);
    if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
      return res.status(400).json({ error: 'Box weight missing. Update box first.' });
    }

    const computedTare = boxWeight + bobbinWeight * bobbinQty;
    const net = gross - computedTare;
    if (!Number.isFinite(net) || net <= 0) {
      return res.status(400).json({ error: 'Computed net weight must be positive. Check weights and quantity.' });
    }

    let pendingBefore = null;
    if (resolvedIssueId) {
      const issueForPending = await loadIssueForTakeBack(prisma, 'cutter', resolvedIssueId);
      if (issueForPending) {
        const issuePending = await getIssuePending(prisma, 'cutter', issueForPending);
        const piecePending = getCutterPiecePending(issuePending, resolvedPieceId);
        pendingBefore = piecePending ? piecePending.pendingWeight : 0;
      }
    }
    const inboundWeight = Number(piece.weight || 0);
    if (pendingBefore == null) {
      const currentTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: resolvedPieceId } });
      const alreadyReceived = currentTotals ? Number(currentTotals.totalNetWeight || 0) : 0;
      const existingWastage = currentTotals ? Number(currentTotals.wastageNetWeight || 0) : 0;
      pendingBefore = Math.max(0, inboundWeight - alreadyReceived - existingWastage);
    }
    if (!resolvedIssueId) {
      resolvedIssueId = await resolveOpenCutterIssueIdForPiece(prisma, resolvedPieceId, net);
      if (resolvedIssueId) {
        const issueForPending = await loadIssueForTakeBack(prisma, 'cutter', resolvedIssueId);
        if (issueForPending) {
          const issuePending = await getIssuePending(prisma, 'cutter', issueForPending);
          const piecePending = getCutterPiecePending(issuePending, resolvedPieceId);
          pendingBefore = piecePending ? piecePending.pendingWeight : pendingBefore;
        }
      }
      if (!resolvedIssueId && openAllocations.length > 0) {
        return res.status(400).json({ error: 'Net weight exceeds pending weight' });
      }
    }
    if (pendingBefore <= 0) {
      return res.status(400).json({ error: 'Piece has no pending weight remaining' });
    }
    if (net - pendingBefore > 1e-6) {
      return res.status(400).json({ error: 'Net weight exceeds pending weight' });
    }

    const receiveDateStr = toOptionalString(receiveDate) || new Date().toISOString().slice(0, 10);
    const vchNo = `MAN-${randomUUID().slice(0, 8)}`;
    const fallbackMachineName = issueMachineName || (await buildCutterIssueMachineMap([resolvedPieceId])).get(resolvedPieceId) || null;

    const txResult = await prisma.$transaction(async (tx) => {
      const upload = await tx.receiveFromCutterMachineUpload.create({
        data: {
          originalFilename: 'manual-entry',
          rowCount: 1,
          ...actorCreateFields(actorUserId),
        },
      });

      const previousCrates = await tx.receiveFromCutterMachineRow.findMany({
        where: { pieceId: resolvedPieceId, isDeleted: false },
        select: { barcode: true },
      });
      let maxCrateIndex = 0;
      for (const row of previousCrates) {
        const idx = parseReceiveCrateIndex(row.barcode);
        if (idx != null && idx > maxCrateIndex) {
          maxCrateIndex = idx;
        }
      }
      const receiveBarcode = makeReceiveBarcode({ lotNo: piece.lotNo, seq: piece.seq, crateIndex: maxCrateIndex + 1 });

      const fallbackMachineName = issueMachineName || (await buildCutterIssueMachineMap([resolvedPieceId])).get(resolvedPieceId) || null;
      const createdRow = await tx.receiveFromCutterMachineRow.create({
        data: {
          uploadId: upload.id,
          issueId: resolvedIssueId || null,
          pieceId: resolvedPieceId,
          vchNo,
          date: receiveDateStr,
          itemName: itemName || null,
          grossWt: gross,
          tareWt: computedTare,
          netWt: net,
          totalKg: net,
          pktTypeName: box.name,
          pcsTypeName: bobbin.name,
          bobbinId: bobbin.id,
          boxId: box.id,
          operatorId: operatorRec.id,
          helperId: helperRec ? helperRec.id : null,
          bobbinQuantity: bobbinQty,
          employee: operatorRec.name,
          shift: shift || null,
          machineNo: fallbackMachineName,
          helperName: helperRec ? helperRec.name : null,
          cutId: cutRecord ? cutRecord.id : null,
          cut: cutRecord ? cutRecord.name : null,
          narration: 'Manual entry',
          createdBy: 'manual',
          barcode: receiveBarcode,
          ...actorCreateFields(actorUserId),
        },
      });

      await tx.receiveFromCutterMachinePieceTotal.upsert({
        where: { pieceId: resolvedPieceId },
        update: {
          totalNetWeight: { increment: net },
          totalBob: { increment: bobbinQty },
          ...actorUpdateFields(actorUserId),
        },
        create: {
          pieceId: resolvedPieceId,
          totalNetWeight: net,
          totalBob: bobbinQty,
          ...actorCreateFields(actorUserId),
        },
      });

      return {
        rowId: createdRow.id,
        upload,
        receiveBarcode,
      };
    });

    const rowWithRelations = await prisma.receiveFromCutterMachineRow.findUnique({
      where: { id: txResult.rowId },
      include: {
        bobbin: { select: { id: true, name: true, weight: true } },
        box: { select: { id: true, name: true, weight: true } },
        operator: { select: { id: true, name: true } },
        helper: { select: { id: true, name: true } },
        cutMaster: { select: { id: true, name: true } },
      },
    });

    if (!rowWithRelations) {
      return res.status(500).json({ error: 'Failed to load manual entry' });
    }

    let pendingAfter = null;
    if (resolvedIssueId) {
      const issueForPending = await loadIssueForTakeBack(prisma, 'cutter', resolvedIssueId);
      if (issueForPending) {
        const issuePending = await getIssuePending(prisma, 'cutter', issueForPending);
        pendingAfter = issuePending.pendingWeight;
      }
    }
    if (pendingAfter == null) {
      const updatedTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: resolvedPieceId } });
      pendingAfter = Math.max(
        0,
        inboundWeight - Number(updatedTotals?.totalNetWeight || 0) - Number(updatedTotals?.wastageNetWeight || 0),
      );
    }

    res.json({
      ok: true,
      row: rowWithRelations,
      upload: txResult.upload,
      pendingBefore,
      pendingAfter,
      receiveBarcode: txResult.receiveBarcode,
    });

    // Notify receive_from_cutter_machine created (manual)
    try {
      const itemRec = piece.itemId ? await prisma.item.findUnique({ where: { id: piece.itemId } }) : null;
      const itemName = itemRec ? itemRec.name || '' : '';

      sendNotification('receive_from_cutter_machine_created', {
        itemName,
        lotNo: piece.lotNo,
        date: receiveDateStr,
        netWeight: net,
        bobbinQuantity: bobbinQty,
        operatorName: operatorRec.name,
        challanNo: 'N/A (Manual)',
        createdByUserId: actorUserId || null,
      });
    } catch (e) { console.error('notify receive_from_cutter_machine manual error', e); }
  } catch (err) {
    console.error('Failed to record manual receive', err);
    res.status(500).json({ error: err.message || 'Failed to record manual receive' });
  }
});

router.get('/api/receive_from_cutter_machine/challans/:id', requirePermission('receive.cutter', PERM_READ), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing challan id' });
    const challan = await prisma.receiveFromCutterMachineChallan.findUnique({ where: { id } });
    if (!challan || challan.isDeleted) return res.status(404).json({ error: 'Challan not found' });

    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { challanId: id, isDeleted: false },
      include: {
        bobbin: { select: { id: true, name: true, weight: true } },
        box: { select: { id: true, name: true, weight: true } },
        operator: { select: { id: true, name: true } },
        helper: { select: { id: true, name: true } },
        cutMaster: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ ok: true, challan, rows });
  } catch (err) {
    console.error('Failed to load challan', err);
    res.status(500).json({ error: err.message || 'Failed to load challan' });
  }
});

router.put('/api/receive_from_cutter_machine/challans/:id', requireEditPermission('receive.cutter'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const challanId = req.params.id;
    const updatesRaw = Array.isArray(req.body?.updates) ? req.body.updates : [];
    const removedRaw = Array.isArray(req.body?.removedRowIds) ? req.body.removedRowIds : [];
    const confirmCascade = Boolean(req.body?.confirmCascade);

    if (!challanId) return res.status(400).json({ error: 'Missing challan id' });
    if (updatesRaw.length === 0 && removedRaw.length === 0) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    const challan = await prisma.receiveFromCutterMachineChallan.findUnique({ where: { id: challanId } });
    if (!challan || challan.isDeleted) return res.status(404).json({ error: 'Challan not found' });

    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { challanId, isDeleted: false },
    });
    const rowMap = new Map(rows.map(r => [r.id, r]));

    const removedRowIds = Array.from(new Set(removedRaw.map(id => String(id || '').trim()).filter(Boolean)));
    for (const rowId of removedRowIds) {
      if (!rowMap.has(rowId)) {
        return res.status(404).json({ error: `Row not found in challan: ${rowId}` });
      }
    }

    const updates = updatesRaw.map((u) => ({
      rowId: String(u?.rowId || u?.id || '').trim(),
      grossWeight: u?.grossWeight,
      bobbinQuantity: u?.bobbinQuantity ?? u?.bobbinQty,
      boxId: typeof u?.boxId === 'string' ? u.boxId.trim() : u?.boxId,
    })).filter(u => u.rowId);

    if (updates.length === 0 && removedRowIds.length === 0) {
      return res.status(400).json({ error: 'No valid changes provided' });
    }

    for (const update of updates) {
      if (!rowMap.has(update.rowId)) {
        return res.status(404).json({ error: `Row not found in challan: ${update.rowId}` });
      }
      if (removedRowIds.includes(update.rowId)) {
        return res.status(400).json({ error: 'Cannot update and remove the same row' });
      }
    }

    const piece = await prisma.inboundItem.findUnique({ where: { id: challan.pieceId } });
    if (!piece) return res.status(404).json({ error: 'Piece not found' });

    const pieceTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: challan.pieceId } });
    const currentTotalNet = Number(pieceTotals?.totalNetWeight || 0);
    const currentTotalBob = Number(pieceTotals?.totalBob || 0);
    const currentWastage = Number(pieceTotals?.wastageNetWeight || 0);

    const requiredBobbinIds = new Set();
    const requiredBoxIds = new Set();
    for (const update of updates) {
      const row = rowMap.get(update.rowId);
      if (!row) continue;
      if (row.bobbinId) requiredBobbinIds.add(row.bobbinId);
      if (update.boxId || row.boxId) requiredBoxIds.add(update.boxId || row.boxId);
    }

    const bobbins = requiredBobbinIds.size
      ? await prisma.bobbin.findMany({ where: { id: { in: Array.from(requiredBobbinIds) } } })
      : [];
    const boxes = requiredBoxIds.size
      ? await prisma.box.findMany({ where: { id: { in: Array.from(requiredBoxIds) } } })
      : [];
    const bobbinMap = new Map(bobbins.map(b => [b.id, b]));
    const boxMap = new Map(boxes.map(b => [b.id, b]));

    let deltaNetWeight = 0;
    let deltaBobbinQty = 0;
    const updatesToApply = [];

    for (const update of updates) {
      const row = rowMap.get(update.rowId);
      if (!row) continue;
      const bobbin = row.bobbinId ? bobbinMap.get(row.bobbinId) : null;
      if (!bobbin) return res.status(404).json({ error: 'Bobbin not found for row' });
      const boxId = update.boxId || row.boxId;
      const box = boxId ? boxMap.get(boxId) : null;
      if (!box) return res.status(404).json({ error: 'Box not found for row' });

      const bobbinQty = Math.max(0, toInt(update.bobbinQuantity ?? row.bobbinQuantity) || 0);
      if (bobbinQty <= 0) {
        return res.status(400).json({ error: 'Bobbin quantity must be greater than zero' });
      }
      const gross = toNumber(update.grossWeight ?? row.grossWt);
      if (gross === null || !Number.isFinite(gross) || gross <= 0) {
        return res.status(400).json({ error: 'Gross weight must be a positive number' });
      }

      const bobbinWeightRaw = bobbin.weight;
      const bobbinWeight = Number(bobbinWeightRaw);
      if (bobbinWeightRaw == null || !Number.isFinite(bobbinWeight) || bobbinWeight < 0) {
        return res.status(400).json({ error: 'Bobbin weight missing. Update bobbin first.' });
      }
      const boxWeight = Number(box.weight);
      if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
        return res.status(400).json({ error: 'Box weight missing. Update box first.' });
      }

      const tare = roundTo3Decimals(boxWeight + bobbinWeight * bobbinQty);
      const net = roundTo3Decimals(gross - tare);
      if (!Number.isFinite(net) || net <= 0) {
        return res.status(400).json({ error: 'Computed net weight must be positive. Check weights and quantity.' });
      }

      const prevNet = Number(row.netWt || 0);
      deltaNetWeight = roundTo3Decimals(deltaNetWeight + (net - prevNet));
      deltaBobbinQty += bobbinQty - Number(row.bobbinQuantity || 0);

      updatesToApply.push({
        id: row.id,
        data: {
          grossWt: roundTo3Decimals(gross),
          tareWt: tare,
          netWt: net,
          totalKg: net,
          bobbinQuantity: bobbinQty,
          boxId,
          pktTypeName: box.name,
          ...actorUpdateFields(actorUserId),
        },
      });
    }

    for (const rowId of removedRowIds) {
      const row = rowMap.get(rowId);
      if (!row) continue;
      deltaNetWeight = roundTo3Decimals(deltaNetWeight - Number(row.netWt || 0));
      deltaBobbinQty -= Number(row.bobbinQuantity || 0);
    }

    const nextTotalNet = roundTo3Decimals(currentTotalNet + deltaNetWeight);
    const nextTotalBob = currentTotalBob + deltaBobbinQty;
    if (nextTotalNet < -1e-6 || nextTotalBob < 0) {
      return res.status(400).json({ error: 'Invalid totals after update' });
    }

    const inboundWeight = Number(piece.weight || 0);
    if (nextTotalNet + currentWastage - inboundWeight > 1e-6) {
      return res.status(400).json({ error: 'Net weight exceeds inbound weight' });
    }

    const pendingAfter = Math.max(0, inboundWeight - nextTotalNet - currentWastage);
    const affectedChallans = await findWastageNoteChallans({
      pieceId: challan.pieceId,
      referenceDate: challan.createdAt,
      includeSelf: true,
    });

    const affectedWastage = affectedChallans.reduce((sum, c) => {
      const numeric = Number(c.wastageNetWeight || 0);
      if (numeric > 0) return sum + numeric;
      return sum + extractWastageFromNote(c.wastageNote);
    }, 0);
    const wastageAmountToReset = currentWastage > 0 ? currentWastage : affectedWastage;
    const shouldResetWastage = wastageAmountToReset > 0 || affectedChallans.length > 0;
    if ((affectedChallans.length > 0 || shouldResetWastage) && !confirmCascade) {
      return res.status(409).json({
        error: 'wastage_note_conflict',
        affectedChallans: affectedChallans.map(c => ({ id: c.id, challanNo: c.challanNo })),
        wastageReset: shouldResetWastage,
        wastageAmount: wastageAmountToReset,
      });
    }

    const changeEntry = {
      at: new Date().toISOString(),
      action: 'update',
      actorUserId,
      details: {
        deltaNetWeight,
        deltaBobbinQty,
        updatedRows: updatesToApply.length,
        removedRows: removedRowIds.length,
        wastageResetWeight: shouldResetWastage ? wastageAmountToReset : 0,
      },
    };

    const updated = await prisma.$transaction(async (tx) => {
      for (const update of updatesToApply) {
        await tx.receiveFromCutterMachineRow.update({
          where: { id: update.id },
          data: update.data,
        });
      }

      if (removedRowIds.length > 0) {
        await tx.receiveFromCutterMachineRow.updateMany({
          where: { id: { in: removedRowIds }, isDeleted: false },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedByUserId: actorUserId || null,
            ...actorUpdateFields(actorUserId),
          },
        });
      }

      if (deltaNetWeight !== 0 || deltaBobbinQty !== 0 || shouldResetWastage) {
        await tx.receiveFromCutterMachinePieceTotal.update({
          where: { pieceId: challan.pieceId },
          data: {
            ...(deltaNetWeight !== 0 ? { totalNetWeight: { increment: deltaNetWeight } } : {}),
            ...(deltaBobbinQty !== 0 ? { totalBob: { increment: deltaBobbinQty } } : {}),
            ...(shouldResetWastage ? { wastageNetWeight: 0 } : {}),
            ...actorUpdateFields(actorUserId),
          },
        });
      }

      const updatedChallan = await tx.receiveFromCutterMachineChallan.update({
        where: { id: challanId },
        data: {
          totalNetWeight: { increment: deltaNetWeight },
          totalBobbinQty: { increment: deltaBobbinQty },
          changeLog: appendChangeLog(challan.changeLog, changeEntry),
          ...actorUpdateFields(actorUserId),
        },
      });

      if (affectedChallans.length > 0) {
        for (const affected of affectedChallans) {
          if (affected.id === challanId && affected.isDeleted) continue;
          await tx.receiveFromCutterMachineChallan.update({
            where: { id: affected.id },
            data: {
              wastageNote: null,
              wastageNetWeight: 0,
              changeLog: appendChangeLog(affected.changeLog, {
                at: new Date().toISOString(),
                action: 'wastage_reset',
                actorUserId,
                details: {
                  sourceChallanId: challanId,
                  reason: 'pending_opened',
                  previousWastageNetWeight: affected.wastageNetWeight || 0,
                },
              }),
              ...actorUpdateFields(actorUserId),
            },
          });
        }
      }

      return updatedChallan;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_challan',
      entityId: updated.id,
      action: 'update',
      payload: {
        deltaNetWeight,
        deltaBobbinQty,
        updatedRows: updatesToApply.length,
        removedRows: removedRowIds.length,
      },
    });

    const pendingAfterFinal = shouldResetWastage
      ? Math.max(0, inboundWeight - nextTotalNet)
      : pendingAfter;

    res.json({
      ok: true,
      challan: updated,
      pendingAfter: pendingAfterFinal,
      affectedChallans: affectedChallans.map(c => ({ id: c.id, challanNo: c.challanNo })),
      wastageReset: shouldResetWastage,
    });
  } catch (err) {
    console.error('Failed to update challan', err);
    res.status(500).json({ error: err.message || 'Failed to update challan' });
  }
});

router.delete('/api/receive_from_cutter_machine/challans/:id', requireDeletePermission('receive.cutter'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const challanId = req.params.id;
    const confirmCascade = Boolean(req.body?.confirmCascade);
    if (!challanId) return res.status(400).json({ error: 'Missing challan id' });

    const challan = await prisma.receiveFromCutterMachineChallan.findUnique({ where: { id: challanId } });
    if (!challan || challan.isDeleted) return res.status(404).json({ error: 'Challan not found' });

    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { challanId, isDeleted: false },
    });
    const totalNetWeight = roundTo3Decimals(rows.reduce((sum, row) => sum + Number(row.netWt || 0), 0));
    const totalBobbinQty = rows.reduce((sum, row) => sum + Number(row.bobbinQuantity || 0), 0);

    const piece = await prisma.inboundItem.findUnique({ where: { id: challan.pieceId } });
    if (!piece) return res.status(404).json({ error: 'Piece not found' });

    const pieceTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: challan.pieceId } });
    const currentTotalNet = Number(pieceTotals?.totalNetWeight || 0);
    const currentTotalBob = Number(pieceTotals?.totalBob || 0);
    const currentWastage = Number(pieceTotals?.wastageNetWeight || 0);

    const deltaNetWeight = roundTo3Decimals(-totalNetWeight);
    const deltaBobbinQty = -totalBobbinQty;
    const deltaWastage = roundTo3Decimals(Number(challan.wastageNetWeight || 0));

    const nextTotalNet = roundTo3Decimals(currentTotalNet + deltaNetWeight);
    const nextTotalBob = currentTotalBob + deltaBobbinQty;
    const nextWastage = roundTo3Decimals(currentWastage - deltaWastage);

    if (nextTotalNet < -1e-6 || nextTotalBob < 0 || nextWastage < -1e-6) {
      return res.status(400).json({ error: 'Invalid totals after delete' });
    }

    const inboundWeight = Number(piece.weight || 0);
    const pendingAfter = Math.max(0, inboundWeight - nextTotalNet - nextWastage);
    const affectedChallans = await findWastageNoteChallans({
      pieceId: challan.pieceId,
      referenceDate: challan.createdAt,
      includeSelf: false,
    });

    const affectedWastage = affectedChallans.reduce((sum, c) => {
      const numeric = Number(c.wastageNetWeight || 0);
      if (numeric > 0) return sum + numeric;
      return sum + extractWastageFromNote(c.wastageNote);
    }, 0);
    const wastageAmountToReset = currentWastage > 0 ? currentWastage : affectedWastage;
    const shouldResetWastage = wastageAmountToReset > 0 || affectedChallans.length > 0;

    if ((affectedChallans.length > 0 || shouldResetWastage) && !confirmCascade) {
      return res.status(409).json({
        error: 'wastage_note_conflict',
        affectedChallans: affectedChallans.map(c => ({ id: c.id, challanNo: c.challanNo })),
        wastageReset: shouldResetWastage,
        wastageAmount: wastageAmountToReset,
      });
    }

    const changeEntry = {
      at: new Date().toISOString(),
      action: 'delete',
      actorUserId,
      details: {
        totalNetWeight,
        totalBobbinQty,
        wastageNetWeight: deltaWastage,
        wastageResetWeight: shouldResetWastage ? wastageAmountToReset : 0,
      },
    };

    const deleted = await prisma.$transaction(async (tx) => {
      if (rows.length > 0) {
        await tx.receiveFromCutterMachineRow.updateMany({
          where: { challanId, isDeleted: false },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedByUserId: actorUserId || null,
            ...actorUpdateFields(actorUserId),
          },
        });
      }

      await tx.receiveFromCutterMachinePieceTotal.update({
        where: { pieceId: challan.pieceId },
        data: {
          ...(deltaNetWeight !== 0 ? { totalNetWeight: { increment: deltaNetWeight } } : {}),
          ...(deltaBobbinQty !== 0 ? { totalBob: { increment: deltaBobbinQty } } : {}),
          ...(shouldResetWastage ? { wastageNetWeight: 0 } : (deltaWastage > 0 ? { wastageNetWeight: { increment: -deltaWastage } } : {})),
          ...actorUpdateFields(actorUserId),
        },
      });

      const updatedChallan = await tx.receiveFromCutterMachineChallan.update({
        where: { id: challanId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          changeLog: appendChangeLog(challan.changeLog, changeEntry),
          ...actorUpdateFields(actorUserId),
        },
      });

      if (affectedChallans.length > 0) {
        for (const affected of affectedChallans) {
          await tx.receiveFromCutterMachineChallan.update({
            where: { id: affected.id },
            data: {
              wastageNote: null,
              wastageNetWeight: 0,
              changeLog: appendChangeLog(affected.changeLog, {
                at: new Date().toISOString(),
                action: 'wastage_reset',
                actorUserId,
                details: {
                  sourceChallanId: challanId,
                  reason: 'pending_opened',
                  previousWastageNetWeight: affected.wastageNetWeight || 0,
                },
              }),
              ...actorUpdateFields(actorUserId),
            },
          });
        }
      }

      return updatedChallan;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_challan',
      entityId: deleted.id,
      action: 'delete',
      payload: {
        totalNetWeight,
        totalBobbinQty,
        wastageNetWeight: deltaWastage,
      },
    });

    const pendingAfterFinal = shouldResetWastage
      ? Math.max(0, inboundWeight - nextTotalNet)
      : pendingAfter;

    res.json({
      ok: true,
      challan: deleted,
      pendingAfter: pendingAfterFinal,
      affectedChallans: affectedChallans.map(c => ({ id: c.id, challanNo: c.challanNo })),
      wastageReset: shouldResetWastage,
    });
  } catch (err) {
    console.error('Failed to delete challan', err);
    res.status(500).json({ error: err.message || 'Failed to delete challan' });
  }
});

router.post('/api/receive_from_cutter_machine/preview', requirePermission('receive.cutter', PERM_READ), async (req, res) => {
  try {
    const { filename, content } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Missing filename' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing CSV content' });
    }

    const { rows, issues } = parseReceiveCsvContent(content);
    if (issues.length > 0) {
      return res.status(400).json({ error: 'CSV validation failed', issues });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No usable rows found in CSV' });
    }

    const vchNos = rows.map(r => r.vchNo);
    const existing = await prisma.receiveFromCutterMachineRow.findMany({ where: { vchNo: { in: vchNos } }, select: { vchNo: true } });
    if (existing.length > 0) {
      const duplicates = existing.map(r => r.vchNo);
      return res.status(409).json({ error: 'Duplicate VchNo detected in database', duplicates });
    }

    const pieceIncrements = aggregateNetByPiece(rows);
    const pieceIds = Array.from(pieceIncrements.keys());
    const inboundAndTotals = await fetchInboundAndTotals(pieceIds);
    const pieceMeta = buildPieceSummaries(pieceIds, inboundAndTotals, pieceIncrements);
    const summary = buildReceiveSummary({ filename, rows, incrementsMap: pieceIncrements, pieceMeta });

    res.json({
      ok: true,
      preview: summary,
    });
  } catch (err) {
    console.error('Failed to preview receive-from-machine CSV', err);
    res.status(400).json({ error: err.message || 'Failed to preview receive-from-machine CSV' });
  }
});

router.post('/api/issue_to_holo_machine', requirePermission('issue.holo', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, machineId, operatorId, yarnId, yarnKg, note, crates, rollsProducedEstimate, twistId, shift } = req.body || {};
    if (!date) {
      return res.status(400).json({ error: 'Missing date' });
    }
    const crateRows = Array.isArray(crates) ? crates : [];
    if (crateRows.length === 0) {
      return res.status(400).json({ error: 'Scan at least one crate to issue' });
    }

    const normalizedCrates = crateRows
      .map((crate) => ({
        rowId: typeof crate.rowId === 'string' ? crate.rowId.trim() : '',
        issuedBobbins: Number(crate.issuedBobbins || 0),
      }))
      .filter((crate) => crate.rowId);

    if (normalizedCrates.length === 0) {
      return res.status(400).json({ error: 'Invalid crate payload' });
    }
    if (normalizedCrates.some((crate) => !Number.isFinite(crate.issuedBobbins) || crate.issuedBobbins <= 0)) {
      return res.status(400).json({ error: 'Enter bobbin quantity for each scanned crate' });
    }
    const rowIds = normalizedCrates.map((crate) => crate.rowId);
    const uniqueRowIds = new Set(rowIds);
    if (uniqueRowIds.size !== rowIds.length) {
      return res.status(400).json({ error: 'Duplicate crates were scanned. Remove duplicates and try again.' });
    }
    const receiveRows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: rowIds }, isDeleted: false },
      select: {
        id: true,
        pieceId: true,
        cutId: true,
        bobbinQuantity: true,
        netWt: true,
        issuedBobbins: true,
        issuedBobbinWeight: true,
        dispatchedCount: true,
        dispatchedWeight: true,
      },
    });
    if (receiveRows.length !== normalizedCrates.length) {
      return res.status(404).json({ error: 'One or more scanned crates were not found' });
    }

    const rowMap = new Map(receiveRows.map((row) => [row.id, row]));
    const pieceIds = Array.from(new Set(receiveRows.map((row) => row.pieceId).filter(Boolean)));
    const pieces = await prisma.inboundItem.findMany({
      where: { id: { in: pieceIds } },
      select: { id: true, itemId: true, lotNo: true },
    });
    const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));
    if (pieceMap.size !== pieceIds.length) {
      return res.status(400).json({ error: 'One or more crates are missing linked inbound pieces' });
    }

    const lotSet = new Set();
    const itemSet = new Set();
    for (const row of receiveRows) {
      const piece = pieceMap.get(row.pieceId);
      lotSet.add(piece.lotNo);
      itemSet.add(piece.itemId);
    }
    if (itemSet.size !== 1) {
      return res.status(400).json({ error: 'Crates must belong to a single item' });
    }
    const lotNos = Array.from(lotSet).filter(Boolean);
    if (lotNos.length === 0) {
      return res.status(400).json({ error: 'Unable to resolve lot numbers for scanned crates' });
    }
    const lotNo = lotNos.length === 1 ? lotNos[0] : 'MIXED';
    const itemId = Array.from(itemSet)[0];

    // Keep issue-level cut in sync with source cutter crates.
    const sourceCutIds = new Set(receiveRows.map((r) => r.cutId).filter(Boolean));
    if (sourceCutIds.size > 1) {
      return res.status(400).json({ error: 'Crates must belong to a single cut' });
    }
    let resolvedCutId = sourceCutIds.size === 1 ? Array.from(sourceCutIds)[0] : null;
    if (!resolvedCutId) {
      // Fallback for legacy rows that may only carry plain-text cut.
      const sourceCutNames = Array.from(new Set(receiveRows.map((r) => String(r.cut || '').trim()).filter(Boolean)));
      if (sourceCutNames.length > 1) {
        return res.status(400).json({ error: 'Crates must belong to a single cut' });
      }
      if (sourceCutNames.length === 1) {
        const cutRec = await prisma.cut.findUnique({ where: { name: sourceCutNames[0] } });
        if (cutRec) resolvedCutId = cutRec.id;
      }
    }

    let yarnRecord = null;
    if (yarnId) {
      yarnRecord = await prisma.yarn.findUnique({ where: { id: yarnId } });
      if (!yarnRecord) {
        return res.status(404).json({ error: 'Selected yarn not found' });
      }
    }

    if (!twistId) {
      return res.status(400).json({ error: 'Missing twist selection' });
    }
    const twistRecord = await prisma.twist.findUnique({ where: { id: twistId } });
    if (!twistRecord) {
      return res.status(404).json({ error: 'Selected twist not found' });
    }

    const overIssuedCrates = [];
    const computedCrates = [];
    for (const crate of normalizedCrates) {
      const sourceRow = rowMap.get(crate.rowId);
      if (!sourceRow) continue;
      const totalCount = Number(sourceRow.bobbinQuantity || 0);
      const issuedCount = Number(sourceRow.issuedBobbins || 0);
      const dispatchedCount = Number(sourceRow.dispatchedCount || 0);
      const netWeight = Number(sourceRow.netWt || 0);
      const issuedWeight = Number(sourceRow.issuedBobbinWeight || 0);
      const dispatchedWeight = Number(sourceRow.dispatchedWeight || 0);
      const availableWeight = Math.max(0, netWeight - issuedWeight - dispatchedWeight);
      const availableCount = Math.max(0, totalCount - issuedCount - dispatchedCount);

      const requestedCount = Number(crate.issuedBobbins || 0);
      const requestedWeightExact = deriveHoloIssuedWeightFromCount({
        bobbinQuantity: sourceRow.bobbinQuantity,
        netWeight: sourceRow.netWt,
        issuedBobbins: requestedCount,
      });
      const exceedsCount = availableCount != null && requestedCount > availableCount;
      const { takingAllRemainingBobbins, issuedWeight: requestedWeight } = resolveHoloIssuedWeight({
        requestedCount,
        availableCount,
        availableWeight,
        requestedWeight: requestedWeightExact,
      });
      const exceedsWeight = !takingAllRemainingBobbins && requestedWeightExact > availableWeight + TAKE_BACK_EPSILON;

      if (exceedsCount || exceedsWeight) {
        overIssuedCrates.push({
          rowId: crate.rowId,
          requestedCount,
          availableCount,
          requestedWeight: roundTo3Decimals(requestedWeightExact),
          availableWeight: roundTo3Decimals(availableWeight),
        });
      }

      computedCrates.push({
        rowId: crate.rowId,
        issuedBobbins: requestedCount,
        issuedBobbinWeight: requestedWeight,
      });
    }

    if (overIssuedCrates.length > 0) {
      return res.status(400).json({
        error: 'Insufficient bobbins/weight available for one or more crates (may have been dispatched).',
        crates: overIssuedCrates,
      });
    }

    const totalBobbins = computedCrates.reduce((sum, crate) => sum + (Number(crate.issuedBobbins) || 0), 0);
    if (!Number.isFinite(totalBobbins) || totalBobbins <= 0) {
      return res.status(400).json({ error: 'Enter bobbin quantity for the scanned crates' });
    }
    const totalWeight = computedCrates.reduce((sum, crate) => sum + (Number(crate.issuedBobbinWeight) || 0), 0);
    const normalizedYarnKg = Number(yarnKg || 0);

    const created = await timedTransaction('issue_to_holo_machine.create', computedCrates.length, async (tx) => {
      await ensureHoloIssueSequence(tx, actorUserId);
      // Get next Holo issue series number
      const holoSeq = await tx.holoIssueSequence.upsert({
        where: { id: 'holo_issue_seq' },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: 'holo_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
      });
      const seriesNumber = holoSeq.nextValue - 1; // Use value before increment

      const issue = await tx.issueToHoloMachine.create({
        data: {
          date,
          itemId,
          lotNo,
          yarnId: yarnRecord ? yarnRecord.id : null,
          twistId: twistRecord.id,
          cutId: resolvedCutId,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: makeHoloIssueBarcode({ series: seriesNumber }),
          note: note || null,
          shift: shift || null,
          metallicBobbins: totalBobbins,
          metallicBobbinsWeight: totalWeight,
          yarnKg: Number.isFinite(normalizedYarnKg) ? normalizedYarnKg : 0,
          receivedRowRefs: computedCrates,
          rollsProducedEstimate: rollsProducedEstimate == null ? null : Number(rollsProducedEstimate),
          ...actorCreateFields(actorUserId),
        },
      });

      for (const crate of computedCrates) {
        const sourceRow = rowMap.get(crate.rowId);
        const existingQty = Number(sourceRow?.issuedBobbins || 0);
        const existingWeight = Number(sourceRow?.issuedBobbinWeight || 0);
        await tx.receiveFromCutterMachineRow.update({
          where: { id: crate.rowId },
          data: {
            issuedBobbins: existingQty + (Number(crate.issuedBobbins) || 0),
            issuedBobbinWeight: existingWeight + (Number(crate.issuedBobbinWeight) || 0),
            ...actorUpdateFields(actorUserId),
          },
        });
      }

      return issue;
    });

    await logCrudWithActor(req, {
      entityType: 'issue_to_holo_machine',
      entityId: created.id,
      action: 'create',
      payload: {
        date: created.date,
        lotNo: created.lotNo,
        itemId: created.itemId,
        machineId: created.machineId,
        operatorId: created.operatorId,
        yarnId: created.yarnId,
        twistId: created.twistId,
      },
    });

    res.json({ ok: true, issueToHoloMachine: created });

    // Notify issue_to_holo_machine created
    try {
      const itemRec = await prisma.item.findUnique({ where: { id: created.itemId } });
      const itemName = itemRec ? itemRec.name : '';
      const machineRec = created.machineId ? await prisma.machine.findUnique({ where: { id: created.machineId } }) : null;
      const operatorRec = created.operatorId ? await prisma.operator.findUnique({ where: { id: created.operatorId } }) : null;
      const trace = await resolveHoloIssueDetails(created);

      sendNotification('issue_to_holo_machine_created', {
        itemName,
        lotNo: created.lotNo,
        date: created.date,
        metallicBobbins: created.metallicBobbins,
        metallicBobbinsWeight: created.metallicBobbinsWeight,
        yarnKg: trace.yarnKg != null ? trace.yarnKg : null,
        yarnName: trace.yarnName || '',
        machineName: machineRec ? machineRec.name : '',
        operatorName: operatorRec ? operatorRec.name : '',
        twistName: trace.twistName || '',
        cutName: trace.cutName || '',
        barcode: created.barcode,
        createdByUserId: created.createdByUserId || actorUserId || null,
      });
    } catch (e) { console.error('notify issue_to_holo_machine error', e); }
  } catch (err) {
    console.error('Failed to issue to holo machine', err);
    res.status(500).json({ error: err.message || 'Failed to issue to holo' });
  }
});

router.post('/api/receive_from_holo_machine/manual', requirePermission('receive.holo', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const {
      issueId,
      pieceId: rawPieceId,
      rollCount,
      // rollWeight, // No longer accepted for calculation
      rollTypeId,
      grossWeight,
      crateTareWeight,
      boxId,
      date,
      machineNo,
      operatorId,
      helperId,
      notes,
      createdBy,
    } = req.body || {};
    const pieceId = typeof rawPieceId === 'string' ? rawPieceId.trim() : rawPieceId;
    const rollCountNum = Number(rollCount);
    const grossNum = Number(grossWeight);

    if (!issueId || !pieceId || !Number.isFinite(rollCountNum) || rollCountNum <= 0 || !Number.isFinite(grossNum) || grossNum <= 0) {
      return res.status(400).json({ error: 'Missing required roll count or gross weight data' });
    }

    const rollType = rollTypeId ? await prisma.rollType.findUnique({ where: { id: rollTypeId } }) : null;
    const box = boxId ? await prisma.box.findUnique({ where: { id: boxId } }) : null;
    const issue = await prisma.issueToHoloMachine.findFirst({
      where: { id: issueId, isDeleted: false },
      select: { lotNo: true, barcode: true, itemId: true, receivedRowRefs: true, cutId: true, twistId: true, yarnId: true },
    });
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    let allowedPieceIds = [];
    try {
      let refs = issue.receivedRowRefs;
      if (typeof refs === 'string') refs = JSON.parse(refs || '[]');
      if (!Array.isArray(refs)) refs = [];
      const rowIds = refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
      if (rowIds.length > 0) {
        const cutterRows = await prisma.receiveFromCutterMachineRow.findMany({
          where: { id: { in: rowIds }, isDeleted: false },
          select: { pieceId: true },
        });
        allowedPieceIds = Array.from(new Set(cutterRows.map(r => r.pieceId).filter(Boolean)));
      }
    } catch (e) {
      allowedPieceIds = [];
    }
    if (allowedPieceIds.length === 0 && issue.lotNo) {
      allowedPieceIds = [`${issue.lotNo}-1`];
    }
    if (allowedPieceIds.length > 0 && !allowedPieceIds.includes(pieceId)) {
      return res.status(400).json({ error: 'Selected piece is not part of this issue' });
    }

    const rollTypeWeight = rollType && Number.isFinite(rollType.weight) ? Number(rollType.weight) : null;
    const boxWeight = box && Number.isFinite(box.weight) ? Number(box.weight) : null;
    const crateTare = crateTareWeight == null ? null : Number(crateTareWeight);

    const tareWeight = (() => {
      const base = rollTypeWeight != null ? rollCountNum * rollTypeWeight : null;
      if (base == null && crateTare == null && boxWeight == null) return null;
      return (base || 0) + (crateTare || 0) + (boxWeight || 0);
    })();

    if (tareWeight == null) {
      return res.status(400).json({ error: 'Unable to calculate tare weight (missing roll type, box, or crate tare)' });
    }

    const netWeight = grossNum - tareWeight;
    if (!Number.isFinite(netWeight) || netWeight <= 0) {
      return res.status(400).json({ error: 'Gross weight must be greater than tare weight' });
    }

    // Extract series from issue barcode and count existing crates
    const issueSeriesNumber = parseHoloSeries(issue?.barcode);
    if (!issueSeriesNumber) {
      return res.status(400).json({ error: 'Invalid issue barcode format. Cannot derive Holo receive series.' });
    }
    const existingCrates = await prisma.receiveFromHoloMachineRow.count({ where: { issueId } });
    const crateIndex = existingCrates + 1;
    const barcode = makeHoloReceiveBarcode({ series: issueSeriesNumber, crateIndex });

    const createdRow = await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId,
        pieceId,
        date: date || null,
        machineNo: machineNo || null,
        operatorId: operatorId || null,
        helperId: helperId || null,
        rollTypeId: rollTypeId || null,
        rollCount: rollCountNum,
        rollWeight: Number(netWeight), // Derived net weight
        grossWeight: grossNum,
        tareWeight,
        barcode,
        boxId: boxId || null,
        notes: notes || null,
        createdBy: createdBy || 'manual',
        ...actorCreateFields(actorUserId),
      },
    });

    const netIncrement = Number(netWeight);
    await prisma.receiveFromHoloMachinePieceTotal.upsert({
      where: { pieceId },
      update: {
        totalRolls: { increment: rollCountNum },
        totalNetWeight: { increment: netIncrement },
        ...actorUpdateFields(actorUserId),
      },
      create: {
        pieceId,
        totalRolls: rollCountNum,
        totalNetWeight: netIncrement,
        wastageNetWeight: 0,
        ...actorCreateFields(actorUserId),
      },
    });
    res.json({ ok: true, row: createdRow });

    // Notify receive_from_holo_machine created
    try {
      const itemRec = await prisma.item.findUnique({ where: { id: issue.itemId } });
      const itemName = itemRec ? itemRec.name || '' : '';
      const operatorRec = operatorId ? await prisma.operator.findUnique({ where: { id: operatorId } }) : null;
      const trace = await resolveHoloIssueDetails(issue);

      sendNotification('receive_from_holo_machine_created', {
        itemName,
        lotNo: issue.lotNo,
        date: date || new Date().toISOString().slice(0, 10),
        grossWeight: grossNum,
        tareWeight,
        netWeight,
        rollCount: rollCountNum,
        machineName: machineNo || '',
        operatorName: operatorRec ? operatorRec.name : '',
        cutName: trace.cutName || '',
        twistName: trace.twistName || '',
        yarnName: trace.yarnName || '',
        yarnKg: trace.yarnKg != null ? trace.yarnKg : null,
        barcode,
        createdByUserId: createdRow?.createdByUserId || actorUserId || null,
      });
    } catch (e) { console.error('notify receive_from_holo_machine manual error', e); }
  } catch (err) {
    console.error('Failed to receive from holo machine', err);
    res.status(500).json({ error: err.message || 'Failed to record holo receive' });
  }
});

router.put('/api/receive_from_holo_machine/rows/:id', requireEditPermission('receive.holo'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing receive row id' });

    const row = await prisma.receiveFromHoloMachineRow.findUnique({
      where: { id },
      include: { issue: true },
    });
    if (!row || row.isDeleted) return res.status(404).json({ error: 'Receive row not found' });
    if (!row.issue) return res.status(404).json({ error: 'Receive issue not found' });

    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    const dispatchedCount = Number(row.dispatchedCount || 0);
    if (dispatchedWeight > 0 || dispatchedCount > 0) {
      return res.status(400).json({ error: 'Cannot edit row: already dispatched' });
    }
    if (await isHoloRowReferencedByConing({ rowId: row.id, barcode: row.barcode })) {
      return res.status(400).json({ error: 'Cannot edit row: already issued to coning' });
    }
    const transfer = await prisma.boxTransfer.findFirst({
      where: {
        stage: 'holo',
        OR: [{ fromItemId: id }, { toItemId: id }],
      },
      select: { id: true },
    });
    if (transfer) {
      return res.status(400).json({ error: 'Cannot edit row: box transfer exists' });
    }

    const rollCount = toInt(req.body?.rollCount ?? row.rollCount);
    const grossWeight = toNumber(req.body?.grossWeight ?? row.grossWeight);
    const rollTypeId = typeof req.body?.rollTypeId === 'string' ? req.body.rollTypeId : row.rollTypeId;
    const boxId = typeof req.body?.boxId === 'string' ? req.body.boxId : row.boxId;
    const date = toOptionalString(req.body?.date ?? row.date);
    const machineNo = toOptionalString(req.body?.machineNo ?? row.machineNo);
    const operatorId = typeof req.body?.operatorId === 'string' ? req.body.operatorId : row.operatorId;
    const helperId = typeof req.body?.helperId === 'string' ? req.body.helperId : row.helperId;
    const notes = toOptionalString(req.body?.notes ?? row.notes);
    const crateTareWeight = toNumber(req.body?.crateTareWeight) || 0;

    if (!Number.isFinite(rollCount) || rollCount <= 0) {
      return res.status(400).json({ error: 'Roll count must be a positive number' });
    }
    if (!Number.isFinite(grossWeight) || grossWeight <= 0) {
      return res.status(400).json({ error: 'Gross weight must be a positive number' });
    }
    if (!rollTypeId) return res.status(400).json({ error: 'Roll type is required' });
    if (!boxId) return res.status(400).json({ error: 'Box type is required' });

    const [rollType, box] = await Promise.all([
      prisma.rollType.findUnique({ where: { id: rollTypeId } }),
      prisma.box.findUnique({ where: { id: boxId } }),
    ]);
    const rollTypeWeight = Number(rollType?.weight);
    const boxWeight = Number(box?.weight);
    if (!rollType || !Number.isFinite(rollTypeWeight) || rollTypeWeight <= 0) {
      return res.status(400).json({ error: 'Roll type weight missing. Update roll type first.' });
    }
    if (!box || !Number.isFinite(boxWeight) || boxWeight <= 0) {
      return res.status(400).json({ error: 'Box weight missing. Update box first.' });
    }

    const tareWeight = roundTo3Decimals(rollTypeWeight * rollCount + boxWeight + crateTareWeight);
    const netWeight = roundTo3Decimals(grossWeight - tareWeight);
    if (!Number.isFinite(netWeight) || netWeight <= 0) {
      return res.status(400).json({ error: 'Gross weight must be greater than tare weight' });
    }

    const requestedPieceId = normalizePieceId(req.body?.pieceId);
    if (row.pieceId && requestedPieceId && requestedPieceId !== row.pieceId) {
      return res.status(400).json({ error: 'Piece assignment is locked for this row' });
    }

    let pieceId = row.pieceId || requestedPieceId;
    if (!pieceId) {
      const candidates = await resolveHoloIssuePieceIds(row.issue);
      if (candidates.length === 1) {
        pieceId = candidates[0];
      } else {
        return res.status(409).json({ error: 'piece_id_required', pieceIds: candidates });
      }
    }

    if (!row.pieceId) {
      const candidates = await resolveHoloIssuePieceIds(row.issue);
      if (candidates.length > 0 && !candidates.includes(pieceId)) {
        return res.status(400).json({ error: 'Piece is not part of this issue' });
      }
      const inbound = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
      if (!inbound) {
        return res.status(404).json({ error: 'Piece not found' });
      }
      if (row.issue?.lotNo && inbound.lotNo !== row.issue.lotNo) {
        return res.status(400).json({ error: 'Piece does not belong to issue lot' });
      }
    }

    const prevNetWeight = Number.isFinite(row.rollWeight)
      ? Number(row.rollWeight)
      : roundTo3Decimals((Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
    const prevRollCount = Number(row.rollCount || 0);
    const deltaNetWeight = roundTo3Decimals(netWeight - prevNetWeight);
    const deltaRolls = rollCount - prevRollCount;

    const updated = await prisma.$transaction(async (tx) => {
      const totals = await tx.receiveFromHoloMachinePieceTotal.findUnique({ where: { pieceId } });
      if (!totals) {
        throw new Error('Receive totals not found for this piece');
      }
      const nextTotalNet = roundTo3Decimals(Number(totals.totalNetWeight || 0) + deltaNetWeight);
      const nextTotalRolls = Number(totals.totalRolls || 0) + deltaRolls;
      if (nextTotalNet < -1e-6 || nextTotalRolls < 0) {
        throw new Error('Invalid totals after update');
      }

      const updatedRow = await tx.receiveFromHoloMachineRow.update({
        where: { id },
        data: {
          pieceId,
          date,
          machineNo,
          operatorId: operatorId || null,
          helperId: helperId || null,
          rollTypeId,
          rollCount,
          rollWeight: netWeight,
          grossWeight: roundTo3Decimals(grossWeight),
          tareWeight,
          boxId,
          notes,
          ...actorUpdateFields(actorUserId),
        },
      });

      if (deltaNetWeight !== 0 || deltaRolls !== 0) {
        await tx.receiveFromHoloMachinePieceTotal.update({
          where: { pieceId },
          data: {
            ...(deltaNetWeight !== 0 ? { totalNetWeight: { increment: deltaNetWeight } } : {}),
            ...(deltaRolls !== 0 ? { totalRolls: { increment: deltaRolls } } : {}),
            ...actorUpdateFields(actorUserId),
          },
        });
      }

      return updatedRow;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_from_holo_machine_row',
      entityId: updated.id,
      action: 'update',
      payload: {
        rollCount,
        grossWeight,
        tareWeight,
        netWeight,
        deltaNetWeight,
        deltaRolls,
      },
    });

    res.json({ ok: true, row: updated });
  } catch (err) {
    console.error('Failed to update holo receive row', err);
    res.status(500).json({ error: err.message || 'Failed to update holo receive row' });
  }
});

router.delete('/api/receive_from_holo_machine/rows/:id', requireDeletePermission('receive.holo'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing receive row id' });

    const row = await prisma.receiveFromHoloMachineRow.findUnique({
      where: { id },
      include: { issue: true },
    });
    if (!row || row.isDeleted) return res.status(404).json({ error: 'Receive row not found' });
    if (!row.issue) return res.status(404).json({ error: 'Receive issue not found' });

    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    const dispatchedCount = Number(row.dispatchedCount || 0);
    if (dispatchedWeight > 0 || dispatchedCount > 0) {
      return res.status(400).json({ error: 'Cannot delete row: already dispatched' });
    }
    if (await isHoloRowReferencedByConing({ rowId: row.id, barcode: row.barcode })) {
      return res.status(400).json({ error: 'Cannot delete row: already issued to coning' });
    }
    const transfer = await prisma.boxTransfer.findFirst({
      where: {
        stage: 'holo',
        OR: [{ fromItemId: id }, { toItemId: id }],
      },
      select: { id: true },
    });
    if (transfer) {
      return res.status(400).json({ error: 'Cannot delete row: box transfer exists' });
    }

    const requestedPieceId = normalizePieceId(req.body?.pieceId);
    if (row.pieceId && requestedPieceId && requestedPieceId !== row.pieceId) {
      return res.status(400).json({ error: 'Piece assignment is locked for this row' });
    }

    let pieceId = row.pieceId || requestedPieceId;
    if (!pieceId) {
      const candidates = await resolveHoloIssuePieceIds(row.issue);
      if (candidates.length === 1) {
        pieceId = candidates[0];
      } else {
        return res.status(409).json({ error: 'piece_id_required', pieceIds: candidates });
      }
    }

    if (!row.pieceId) {
      const candidates = await resolveHoloIssuePieceIds(row.issue);
      if (candidates.length > 0 && !candidates.includes(pieceId)) {
        return res.status(400).json({ error: 'Piece is not part of this issue' });
      }
      const inbound = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
      if (!inbound) {
        return res.status(404).json({ error: 'Piece not found' });
      }
      if (row.issue?.lotNo && inbound.lotNo !== row.issue.lotNo) {
        return res.status(400).json({ error: 'Piece does not belong to issue lot' });
      }
    }

    const prevNetWeight = Number.isFinite(row.rollWeight)
      ? Number(row.rollWeight)
      : roundTo3Decimals((Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
    const prevRollCount = Number(row.rollCount || 0);
    const deltaNetWeight = roundTo3Decimals(-prevNetWeight);
    const deltaRolls = -prevRollCount;

    const deleted = await prisma.$transaction(async (tx) => {
      const totals = await tx.receiveFromHoloMachinePieceTotal.findUnique({ where: { pieceId } });
      if (!totals) {
        throw new Error('Receive totals not found for this piece');
      }
      const nextTotalNet = roundTo3Decimals(Number(totals.totalNetWeight || 0) + deltaNetWeight);
      const nextTotalRolls = Number(totals.totalRolls || 0) + deltaRolls;
      if (nextTotalNet < -1e-6 || nextTotalRolls < 0) {
        throw new Error('Invalid totals after delete');
      }

      const updatedRow = await tx.receiveFromHoloMachineRow.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      await tx.receiveFromHoloMachinePieceTotal.update({
        where: { pieceId },
        data: {
          totalNetWeight: { increment: deltaNetWeight },
          totalRolls: { increment: deltaRolls },
          ...actorUpdateFields(actorUserId),
        },
      });

      return updatedRow;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_from_holo_machine_row',
      entityId: deleted.id,
      action: 'delete',
      payload: {
        rollCount: prevRollCount,
        netWeight: prevNetWeight,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete holo receive row', err);
    res.status(500).json({ error: err.message || 'Failed to delete holo receive row' });
  }
});

router.get('/api/issue_to_coning_machine/source-row/lookup', requirePermission('issue.coning', PERM_WRITE), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query?.barcode);
    if (!barcode) {
      return res.status(400).json({ outcome: 'not_found', error: 'barcode query parameter is required' });
    }

    const include = {
      issue: {
        include: {
          cut: { select: { name: true } },
          yarn: { select: { name: true } },
          twist: { select: { name: true } },
        },
      },
    };

    const barcodeRows = await prisma.receiveFromHoloMachineRow.findMany({
      where: { barcode: { equals: barcode, mode: 'insensitive' } },
      include,
      orderBy: { createdAt: 'desc' },
    });
    if (barcodeRows.length > 0) {
      const activeRows = barcodeRows.filter((row) => !row.isDeleted && !row.issue?.isDeleted);
      if (activeRows.length === 1) {
        const payload = await buildConingSourceLookupPayload(activeRows[0]);
        const status = payload.outcome === 'found' ? 200 : 409;
        return res.status(status).json(payload);
      }
      if (activeRows.length > 1) {
        return res.status(409).json({
          outcome: 'duplicate_legacy_match',
          error: 'Multiple rows match this barcode. Please use the new barcode instead.',
        });
      }
      return res.status(410).json({ outcome: 'deleted', error: 'Barcode belongs to a deleted Holo Receive row' });
    }

    const noteRows = await prisma.receiveFromHoloMachineRow.findMany({
      where: { notes: { equals: barcode, mode: 'insensitive' } },
      include,
      orderBy: { createdAt: 'desc' },
    });
    if (noteRows.length > 0) {
      const activeRows = noteRows.filter((row) => !row.isDeleted && !row.issue?.isDeleted);
      if (activeRows.length === 1) {
        const payload = await buildConingSourceLookupPayload(activeRows[0]);
        const status = payload.outcome === 'found' ? 200 : 409;
        return res.status(status).json(payload);
      }
      if (activeRows.length > 1) {
        return res.status(409).json({
          outcome: 'duplicate_legacy_match',
          error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.',
        });
      }
      return res.status(410).json({ outcome: 'deleted', error: 'Barcode belongs to a deleted Holo Receive row' });
    }

    const legacyResolved = await resolveLegacyReceiveRow(barcode, { include });
    if (legacyResolved?.stage === 'holo' && legacyResolved.row) {
      const payload = await buildConingSourceLookupPayload(legacyResolved.row);
      const status = payload.outcome === 'found' ? 200 : 409;
      return res.status(status).json(payload);
    }
    if (legacyResolved?.stage === 'holo' && legacyResolved.error === 'ambiguous') {
      return res.status(409).json({
        outcome: 'duplicate_legacy_match',
        error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.',
      });
    }

    return res.status(404).json({ outcome: 'not_found', error: 'Barcode not found in Holo Receive rows' });
  } catch (err) {
    console.error('Failed to lookup coning source row', err);
    res.status(500).json({ outcome: 'not_found', error: err.message || 'Failed to lookup barcode' });
  }
});

router.post('/api/issue_to_coning_machine', requirePermission('issue.coning', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, machineId, operatorId, note, crates, requiredPerConeNetWeight: reqPerConeWt, shift } = req.body || {};
    if (!date) return res.status(400).json({ error: 'Missing date' });
    const crateRows = Array.isArray(crates) ? crates : [];
    if (crateRows.length === 0) return res.status(400).json({ error: 'Scan at least one crate to issue' });
    const requiredPerConeNetWeight = toNumber(reqPerConeWt); // grams
    if (!Number.isFinite(requiredPerConeNetWeight) || requiredPerConeNetWeight <= 0) {
      return res.status(400).json({ error: 'Enter required per-cone net weight (grams)' });
    }

    const normalizedCrates = crateRows
      .map((crate) => ({
        rowId: typeof crate.rowId === 'string' ? crate.rowId.trim() : '',
        barcode: typeof crate.barcode === 'string' ? normalizeBarcodeInput(crate.barcode) : '',
        coneTypeId: typeof crate.coneTypeId === 'string' ? crate.coneTypeId : null,
        wrapperId: typeof crate.wrapperId === 'string' ? crate.wrapperId : null,
        boxId: typeof crate.boxId === 'string' ? crate.boxId : null,
        issueRolls: toNumber(crate.issueRolls),
        issueWeight: toNumber(crate.issueWeight),
      }))
      .filter((c) => c.rowId || c.barcode);

    if (normalizedCrates.length === 0) return res.status(400).json({ error: 'Invalid crate payload' });

    const rowIds = normalizedCrates.map((c) => c.rowId).filter(Boolean);
    const barcodes = normalizedCrates.map((c) => c.barcode).filter(Boolean);

    const coningRows = rowIds.length
      ? await prisma.receiveFromConingMachineRow.findMany({
        where: { id: { in: rowIds }, isDeleted: false },
        include: { issue: { select: { id: true, lotNo: true, itemId: true } } },
      })
      : [];

    const matchedConingRowIds = new Set(coningRows.map((row) => row.id));
    const pendingRowIds = rowIds.filter((id) => !matchedConingRowIds.has(id));

    const holoWhere = [];
    if (pendingRowIds.length) {
      holoWhere.push({ id: { in: pendingRowIds } });
    }
    if (barcodes.length) {
      holoWhere.push({ barcode: { in: barcodes } });
      barcodes.forEach((code) => {
        holoWhere.push({ notes: { equals: code, mode: 'insensitive' } });
      });
    }

    const holoRows = holoWhere.length
      ? await prisma.receiveFromHoloMachineRow.findMany({
        where: { OR: holoWhere, isDeleted: false },
        include: { issue: { select: { id: true, lotNo: true, itemId: true, cutId: true, yarnId: true, twistId: true } } },
      })
      : [];

    const rows = [...coningRows, ...holoRows];
    if (rows.length === 0) return res.status(404).json({ error: 'One or more scanned crates were not found' });

    const rowMapById = new Map(rows.map((r) => [r.id, r]));
    const rowMapByBarcode = new Map();
    const ambiguousBarcodes = new Set();
    rows.forEach((row) => {
      if (!row?.barcode) return;
      const code = normalizeBarcodeInput(row.barcode);
      if (!code) return;
      const existing = rowMapByBarcode.get(code);
      if (existing && existing.id !== row.id) {
        rowMapByBarcode.set(code, null);
        ambiguousBarcodes.add(code);
        return;
      }
      if (!existing) {
        rowMapByBarcode.set(code, row);
      }
    });

    const legacyMap = new Map();
    const ambiguousLegacy = new Set();
    holoRows.forEach((row) => {
      if (!row?.notes) return;
      const code = normalizeBarcodeInput(row.notes);
      if (!code) return;
      const existing = legacyMap.get(code);
      if (existing && existing.id !== row.id) {
        legacyMap.set(code, null);
        ambiguousLegacy.add(code);
        return;
      }
      if (!existing) {
        legacyMap.set(code, row);
      }
    });

    const legacyConflicts = normalizedCrates
      .map((crate) => crate.barcode)
      .filter((code) => code && (ambiguousBarcodes.has(code) || ambiguousLegacy.has(code)));
    if (legacyConflicts.length > 0) {
      return res.status(409).json({
        error: `Legacy barcode matches multiple rows: ${Array.from(new Set(legacyConflicts)).join(', ')}`
      });
    }

    const resolvedCrates = normalizedCrates.map((crate) => {
      let found = crate.rowId ? rowMapById.get(crate.rowId) : rowMapByBarcode.get(crate.barcode);
      if (!found && crate.barcode) {
        found = legacyMap.get(crate.barcode);
      }
      return {
        ...crate,
        rowId: found?.id || crate.rowId,
        sourceIssueId: found?.issue?.id || null,
        lotNo: found?.issue?.lotNo || null,
        itemId: found?.issue?.itemId || null,
        baseRolls: typeof found?.coneCount === 'number'
          ? found.coneCount
          : (typeof found?.rollCount === 'number' ? found.rollCount : 0),
        baseWeight: typeof found?.coneWeight === 'number'
          ? found.coneWeight
          : (typeof found?.rollWeight === 'number' ? found.rollWeight : 0),
        dispatchedCount: Number(found?.dispatchedCount || 0),
        dispatchedWeight: Number(found?.dispatchedWeight || 0),
      };
    });

    if (resolvedCrates.some((c) => !c.rowId)) {
      return res.status(404).json({ error: 'One or more scanned crates were not found' });
    }

    const lotSet = new Set(resolvedCrates.map((c) => c.lotNo).filter(Boolean));
    const itemSet = new Set(resolvedCrates.map((c) => c.itemId).filter(Boolean));
    if (itemSet.size !== 1) {
      return res.status(400).json({ error: 'Crates must belong to a single item' });
    }
    const lotNos = Array.from(lotSet).filter(Boolean);
    if (lotNos.length === 0) {
      return res.status(400).json({ error: 'Unable to resolve lot numbers for scanned crates' });
    }
    const lotNo = lotNos.length === 1 ? lotNos[0] : 'MIXED';
    const itemId = Array.from(itemSet)[0];
    const sourceIssueMap = new Map((holoRows || []).map(r => [r.issue?.id, r.issue]));
    const sourceCutIds = new Set();
    const sourceYarnIds = new Set();
    const sourceTwistIds = new Set();
    resolvedCrates.forEach((c) => {
      if (!c.sourceIssueId) return;
      const issue = sourceIssueMap.get(c.sourceIssueId);
      if (issue?.cutId) sourceCutIds.add(issue.cutId);
      if (issue?.yarnId) sourceYarnIds.add(issue.yarnId);
      if (issue?.twistId) sourceTwistIds.add(issue.twistId);
    });
    if (sourceCutIds.size > 1) {
      return res.status(400).json({ error: 'Crates must belong to a single cut' });
    }
    const resolvedCutId = sourceCutIds.size === 1 ? Array.from(sourceCutIds)[0] : null;
    if (sourceYarnIds.size > 1) {
      return res.status(400).json({ error: 'Crates must belong to a single yarn' });
    }
    const resolvedYarnId = sourceYarnIds.size === 1 ? Array.from(sourceYarnIds)[0] : null;
    const resolvedTwistId = sourceTwistIds.size === 1 ? Array.from(sourceTwistIds)[0] : null;

    // Validate masters if provided
    const coneTypeIds = Array.from(new Set(resolvedCrates.map((c) => c.coneTypeId).filter(Boolean)));
    const wrapperIds = Array.from(new Set(resolvedCrates.map((c) => c.wrapperId).filter(Boolean)));
    const boxIds = Array.from(new Set(resolvedCrates.map((c) => c.boxId).filter(Boolean)));
    if (coneTypeIds.length) {
      const ctCount = await prisma.coneType.count({ where: { id: { in: coneTypeIds } } });
      if (ctCount !== coneTypeIds.length) return res.status(400).json({ error: 'One or more cone types not found' });
    }
    if (coneTypeIds.length > 1) {
      return res.status(400).json({ error: 'Crates must use a single cone type for coning issues' });
    }
    if (wrapperIds.length) {
      const wCount = await prisma.wrapper.count({ where: { id: { in: wrapperIds } } });
      if (wCount !== wrapperIds.length) return res.status(400).json({ error: 'One or more wrappers not found' });
    }
    if (boxIds.length) {
      const bCount = await prisma.box.count({ where: { id: { in: boxIds } } });
      if (bCount !== boxIds.length) return res.status(400).json({ error: 'One or more boxes not found' });
    }

    if (resolvedCrates.some((c) => !Number.isFinite(c.issueRolls) || c.issueRolls <= 0)) {
      return res.status(400).json({ error: 'Enter issue rolls for each crate' });
    }

    const preparedCrates = resolvedCrates.map((c) => {
      const baseRolls = Number(c.baseRolls) || 0;
      const baseWeight = Number(c.baseWeight) || 0;
      const perRoll = baseRolls > 0 && Number.isFinite(baseWeight) ? baseWeight / baseRolls : 0;
      const rolls = Number(c.issueRolls) || 0;
      const providedWeight = Number(c.issueWeight);
      const issueWeight = Number.isFinite(providedWeight) && providedWeight > 0
        ? providedWeight
        : Number((perRoll * rolls).toFixed(3));
      return {
        rowId: c.rowId,
        barcode: c.barcode,
        lotNo: c.lotNo,
        itemId: c.itemId,
        coneTypeId: c.coneTypeId,
        wrapperId: c.wrapperId,
        boxId: c.boxId,
        issueRolls: rolls,
        issueWeight,
        baseRolls,
        baseWeight,
        dispatchedCount: c.dispatchedCount,
        dispatchedWeight: c.dispatchedWeight,
      };
    });

    if (preparedCrates.some((c) => !Number.isFinite(c.issueWeight) || c.issueWeight <= 0)) {
      return res.status(400).json({ error: 'Issue weight missing for one or more crates' });
    }

    // Guard against re-issuing the same crate beyond its available rolls
    const rowIdsToCheck = preparedCrates.map((c) => c.rowId).filter(Boolean);
    const barcodesToCheck = preparedCrates.map((c) => c.barcode).filter(Boolean);
    let existingRowRefs = [];

    if (rowIdsToCheck.length || barcodesToCheck.length) {
      const rowIdArray = rowIdsToCheck.length ? rowIdsToCheck : ['__none__'];
      const barcodeArray = barcodesToCheck.length ? barcodesToCheck : ['__none__'];
      existingRowRefs = await prisma.$queryRaw`
        SELECT id, "receivedRowRefs"
        FROM "IssueToConingMachine"
        WHERE "isDeleted" = false
          AND EXISTS (
          SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
          WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
             OR elem->>'barcode' = ANY (${barcodeArray}::text[])
        )
      `;
    }
    const coningTakeBackLines = rowIdsToCheck.length > 0
      ? await prisma.issueTakeBackLine.findMany({
        where: {
          sourceId: { in: rowIdsToCheck },
          takeBack: { stage: 'coning' },
        },
        select: {
          sourceId: true,
          count: true,
          weight: true,
          takeBack: { select: { isReverse: true } },
        },
      })
      : [];

    const previouslyIssuedByRowId = new Map();
    const previouslyIssuedWeightByRowId = new Map();
    for (const issue of existingRowRefs) {
      const refs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
      for (const ref of refs) {
        const rid = ref?.rowId || (ref?.barcode ? normalizeBarcodeInput(ref.barcode) : null);
        if (!rid) continue;
        const already = previouslyIssuedByRowId.get(rid) || 0;
        previouslyIssuedByRowId.set(rid, already + (Number(ref.issueRolls) || 0));
        const weightAlready = previouslyIssuedWeightByRowId.get(rid) || 0;
        previouslyIssuedWeightByRowId.set(rid, weightAlready + (Number(ref.issueWeight) || 0));
      }
    }
    coningTakeBackLines.forEach((line) => {
      const rid = line.sourceId;
      if (!rid) return;
      const sign = line.takeBack?.isReverse ? 1 : -1;
      const existingCount = previouslyIssuedByRowId.get(rid) || 0;
      const existingWeight = previouslyIssuedWeightByRowId.get(rid) || 0;
      previouslyIssuedByRowId.set(rid, Math.max(0, existingCount + (sign * Number(line.count || 0))));
      previouslyIssuedWeightByRowId.set(rid, Math.max(0, existingWeight + (sign * Number(line.weight || 0))));
    });

    const issueTracker = new Map();
    const issueWeightTracker = new Map();
    const overIssuedCrates = [];
    for (const crate of preparedCrates) {
      const rid = crate.rowId || (crate.barcode ? normalizeBarcodeInput(crate.barcode) : null);
      if (!rid) continue;
      const baseRolls = Number(crate.baseRolls) || 0;
      const baseWeight = Number(crate.baseWeight) || 0;
      const dispatchedCount = Number(crate.dispatchedCount || 0);
      const dispatchedWeight = Number(crate.dispatchedWeight || 0);
      const availableWeight = Math.max(0, baseWeight - dispatchedWeight);
      const baseAvailableRolls = Math.max(0, baseRolls - dispatchedCount);

      const existingIssued = previouslyIssuedByRowId.get(rid) || 0;
      const alreadyPlanned = issueTracker.get(rid) || 0;
      const totalAfterRequest = existingIssued + alreadyPlanned + (Number(crate.issueRolls) || 0);

      const existingIssuedWeight = previouslyIssuedWeightByRowId.get(rid) || 0;
      const alreadyPlannedWeight = issueWeightTracker.get(rid) || 0;
      const totalWeightAfter = existingIssuedWeight + alreadyPlannedWeight + (Number(crate.issueWeight) || 0);

      const exceedsRolls = totalAfterRequest > baseAvailableRolls;
      const exceedsWeight = availableWeight <= 0
        ? (Number(crate.issueWeight) || 0) > 0
        : totalWeightAfter > availableWeight + 1e-6;

      if (exceedsRolls || exceedsWeight) {
        overIssuedCrates.push({
          rowId: rid,
          barcode: crate.barcode,
          requestedRolls: crate.issueRolls,
          availableRolls: Math.max(baseAvailableRolls - existingIssued - alreadyPlanned, 0),
          requestedWeight: roundTo3Decimals(crate.issueWeight),
          availableWeight: roundTo3Decimals(Math.max(availableWeight - existingIssuedWeight - alreadyPlannedWeight, 0)),
        });
      }

      issueTracker.set(rid, alreadyPlanned + (Number(crate.issueRolls) || 0));
      issueWeightTracker.set(rid, alreadyPlannedWeight + (Number(crate.issueWeight) || 0));
    }

    if (overIssuedCrates.length) {
      return res.status(400).json({
        error: 'One or more crates do not have enough rolls/weight available (may have been dispatched).',
        crates: overIssuedCrates,
      });
    }

    const totalRolls = preparedCrates.reduce((sum, c) => sum + (Number(c.issueRolls) || 0), 0);
    const totalIssueWeightKg = preparedCrates.reduce((sum, c) => sum + (Number(c.issueWeight) || 0), 0);
    const expectedCones = requiredPerConeNetWeight > 0
      ? Math.floor((totalIssueWeightKg * 1000) / requiredPerConeNetWeight)
      : 0;

    const created = await timedTransaction('issue_to_coning_machine.create', preparedCrates.length, async (tx) => {
      await ensureConingIssueSequence(tx, actorUserId);
      // Get next Coning issue series number
      const coningSeq = await tx.coningIssueSequence.upsert({
        where: { id: 'coning_issue_seq' },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: 'coning_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
      });
      const seriesNumber = coningSeq.nextValue - 1; // Use value before increment

      return tx.issueToConingMachine.create({
        data: {
          date,
          itemId,
          lotNo,
          cutId: resolvedCutId,
          yarnId: resolvedYarnId,
          twistId: resolvedTwistId,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: makeConingIssueBarcode({ series: seriesNumber }),
          note: note || null,
          shift: shift || null,
          rollsIssued: Number(totalRolls || 0),
          requiredPerConeNetWeight,
          expectedCones,
          receivedRowRefs: preparedCrates,
          ...actorCreateFields(actorUserId),
        },
      });
    });

    await logCrudWithActor(req, {
      entityType: 'issue_to_coning_machine',
      entityId: created.id,
      action: 'create',
      payload: {
        date: created.date,
        lotNo: created.lotNo,
        itemId: created.itemId,
        machineId: created.machineId,
        operatorId: created.operatorId,
      },
    });
    res.json({ ok: true, issueToConingMachine: created });

    // Notify issue_to_coning_machine created
    try {
      const itemRec = await prisma.item.findUnique({ where: { id: created.itemId } });
      const itemName = itemRec ? itemRec.name : '';
      const machineRec = created.machineId ? await prisma.machine.findUnique({ where: { id: created.machineId } }) : null;
      const operatorRec = created.operatorId ? await prisma.operator.findUnique({ where: { id: created.operatorId } }) : null;
      const trace = await resolveConingTraceDetails(created);

      sendNotification('issue_to_coning_machine_created', {
        itemName,
        lotNo: created.lotNo,
        date: created.date,
        rollsIssued: created.rollsIssued,
        requiredPerConeNetWeight: created.requiredPerConeNetWeight,
        expectedCones: created.expectedCones,
        machineName: machineRec ? machineRec.name : '',
        operatorName: operatorRec ? operatorRec.name : '',
        cutName: trace.cutName || '',
        twistName: trace.twistName || '',
        yarnName: trace.yarnName || '',
        yarnKg: trace.yarnKg != null ? trace.yarnKg : null,
        barcode: created.barcode,
        createdByUserId: created.createdByUserId || actorUserId || null,
      });
    } catch (e) { console.error('notify issue_to_coning_machine error', e); }
  } catch (err) {
    console.error('Failed to issue to coning machine', err);
    res.status(500).json({ error: err.message || 'Failed to issue to coning' });
  }
});

router.post('/api/receive_from_coning_machine/manual', requirePermission('receive.coning', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const {
      issueId,
      pieceId: rawPieceId,
      coneCount,
      boxId,
      date,
      grossWeight: providedGross,
      machineNo,
      operatorId,
      helperId,
      notes,
      createdBy,
    } = req.body || {};
    const pieceId = typeof rawPieceId === 'string' ? rawPieceId.trim() : rawPieceId;
    if (!issueId || !pieceId || typeof coneCount !== 'number' || !Number.isFinite(providedGross)) {
      return res.status(400).json({ error: 'Missing required cone or gross weight data' });
    }
    const issue = await prisma.issueToConingMachine.findFirst({
      where: { id: issueId, isDeleted: false },
    });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    let boxWeight = null;
    if (boxId) {
      const box = await prisma.box.findUnique({ where: { id: boxId }, select: { weight: true } });
      boxWeight = box?.weight ?? null;
    }
    const coneTypeId = Array.isArray(issue.receivedRowRefs) && issue.receivedRowRefs.length
      ? issue.receivedRowRefs[0].coneTypeId
      : null;
    let coneWeightPerPiece = null;
    if (coneTypeId) {
      const coneType = await prisma.coneType.findUnique({ where: { id: coneTypeId }, select: { weight: true } });
      coneWeightPerPiece = coneType?.weight ?? null;
    }
    const tareWeight = (boxWeight || 0) + (coneWeightPerPiece || 0) * coneCount;
    const grossWeight = Number(providedGross);
    const netWeight = grossWeight - tareWeight;
    if (!Number.isFinite(netWeight) || netWeight < 0) {
      return res.status(400).json({ error: 'Gross weight must be greater than tare weight' });
    }

    const existingCount = await prisma.receiveFromConingMachineRow.count({ where: { issueId } });
    const crateIndex = existingCount + 1;
    const issueSeriesNumber = parseConingSeries(issue.barcode);
    if (!issueSeriesNumber) {
      return res.status(400).json({ error: 'Invalid issue barcode format. Cannot derive Coning receive series.' });
    }
    const barcode = makeConingReceiveBarcode({ series: issueSeriesNumber, crateIndex });

    const sourceRowRefs = await computeConingReceiveSourceRowRefs(prisma, issue, netWeight);
    const createdRow = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId,
        coneCount,
        barcode,
        coneWeight: Number(netWeight),
        netWeight: Number(netWeight),
        tareWeight: Number(tareWeight),
        grossWeight: Number(grossWeight),
        sourceRowRefs,
        boxId: boxId || null,
        machineNo: machineNo || null,
        operatorId: operatorId || issue.operatorId || null,
        helperId: helperId || null,
        notes: notes || null,
        date: date || issue.date,
        createdBy: createdBy || 'manual',
        ...actorCreateFields(actorUserId),
      },
    });
    await prisma.receiveFromConingMachinePieceTotal.upsert({
      where: { pieceId },
      update: {
        totalCones: { increment: coneCount },
        totalNetWeight: { increment: netWeight || 0 },
        ...actorUpdateFields(actorUserId),
      },
      create: {
        pieceId,
        totalCones: coneCount,
        totalNetWeight: netWeight || 0,
        wastageNetWeight: 0,
        ...actorCreateFields(actorUserId),
      },
    });
    res.json({ ok: true, row: createdRow });

    // Notify receive_from_coning_machine created
    try {
      const itemRec = await prisma.item.findUnique({ where: { id: issue.itemId } });
      const itemName = itemRec ? itemRec.name : '';
      const operatorRec = (operatorId || issue.operatorId) ? await prisma.operator.findUnique({ where: { id: (operatorId || issue.operatorId) } }) : null;
      const trace = await resolveConingTraceDetails(issue);

      let machineName = machineNo || '';
      if (issue.machineId && !machineName) {
        const machineRec = await prisma.machine.findUnique({ where: { id: issue.machineId } });
        machineName = machineRec ? machineRec.name : '';
      }

      sendNotification('receive_from_coning_machine_created', {
        itemName,
        lotNo: issue.lotNo,
        date: date || issue.date,
        grossWeight: Number(grossWeight),
        tareWeight: Number(tareWeight),
        netWeight: Number(netWeight),
        coneCount,
        machineName: machineName,
        operatorName: operatorRec ? operatorRec.name : '',
        cutName: trace.cutName || '',
        twistName: trace.twistName || '',
        yarnName: trace.yarnName || '',
        yarnKg: trace.yarnKg != null ? trace.yarnKg : null,
        barcode,
        createdByUserId: createdRow?.createdByUserId || actorUserId || null,
      });
    } catch (e) { console.error('notify receive_from_coning_machine manual error', e); }
  } catch (err) {
    console.error('Failed to receive from coning machine', err);
    res.status(500).json({ error: err.message || 'Failed to record coning receive' });
  }
});

// Mark remaining pending weight for a coning issue as wastage
router.post('/api/receive_from_coning_machine/mark_wastage', requirePermission('receive.coning', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { issueId } = req.body || {};
    if (!issueId || typeof issueId !== 'string') {
      return res.status(400).json({ error: 'Missing issueId' });
    }

    // 1. Fetch coning issue
    const issue = await prisma.issueToConingMachine.findUnique({ where: { id: issueId } });
    if (!issue) return res.status(404).json({ error: 'Coning issue not found' });
    if (issue.isDeleted) return res.status(400).json({ error: 'Issue has been deleted' });

    // 2. Calculate total issued weight from receivedRowRefs
    let issuedWeight = 0;
    try {
      const refs = typeof issue.receivedRowRefs === 'string'
        ? JSON.parse(issue.receivedRowRefs)
        : issue.receivedRowRefs;
      if (Array.isArray(refs)) {
        issuedWeight = refs.reduce((sum, ref) => {
          // Prefer stamped issueWeight, fallback to lookup
          if (ref.issueWeight) return sum + Number(ref.issueWeight);
          return sum;
        }, 0);
      }
    } catch (e) {
      console.error('Error parsing receivedRowRefs for coning wastage', e);
    }

    if (issuedWeight <= 0) {
      return res.status(400).json({ error: 'Unable to determine issued weight for this issue' });
    }

    // 3. Fetch current received and wastage totals
    const currentTotal = await prisma.receiveFromConingMachinePieceTotal.findUnique({
      where: { pieceId: issueId }
    });
    const received = currentTotal ? Number(currentTotal.totalNetWeight || 0) : 0;
    const existingWastage = currentTotal ? Number(currentTotal.wastageNetWeight || 0) : 0;

    // 4. Calculate remaining pending weight
    const remaining = roundTo3Decimals(Math.max(0, issuedWeight - received - existingWastage));
    if (remaining <= 0) {
      return res.status(400).json({ error: 'No remaining pending weight to mark as wastage' });
    }

    // 5. Upsert wastage inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      await tx.receiveFromConingMachinePieceTotal.upsert({
        where: { pieceId: issueId },
        update: {
          wastageNetWeight: { increment: remaining },
          ...actorUpdateFields(actorUserId)
        },
        create: {
          pieceId: issueId,
          totalCones: 0,
          totalNetWeight: 0,
          wastageNetWeight: remaining,
          ...actorCreateFields(actorUserId)
        },
      });
      return tx.receiveFromConingMachinePieceTotal.findUnique({ where: { pieceId: issueId } });
    });

    // 6. Send WhatsApp notification
    try {
      const itemRec = issue.itemId ? await prisma.item.findUnique({ where: { id: issue.itemId } }) : null;
      const itemName = itemRec ? itemRec.name || '' : '';
      const wastageFormatted = Number(remaining).toFixed(3);
      const wastagePercent = issuedWeight > 0 ? ((remaining / issuedWeight) * 100).toFixed(2) : '0.00';
      sendNotification('piece_wastage_marked_coning', {
        pieceId: issueId,
        lotNo: issue.lotNo || issue.lotLabel || '',
        itemName,
        wastage: wastageFormatted,
        wastagePercent,
        createdByUserId: updated?.createdByUserId || actorUserId || null,
      });
    } catch (e) {
      console.error('notify coning wastage error', e);
    }

    // 7. Audit log
    await logCrudWithActor(req, {
      entityType: 'receive_coning_piece_total',
      entityId: issueId,
      action: 'update',
      before: currentTotal,
      after: updated,
      payload: { action: 'mark_wastage', marked: remaining },
    });

    res.json({ ok: true, issueId, marked: remaining, updated });
  } catch (err) {
    console.error('Failed to mark coning wastage', err);
    res.status(500).json({ error: err.message || 'Failed to mark coning wastage' });
  }
});

router.put('/api/receive_from_coning_machine/rows/:id', requireEditPermission('receive.coning'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing receive row id' });

    const row = await prisma.receiveFromConingMachineRow.findUnique({
      where: { id },
      include: { issue: true },
    });
    if (!row || row.isDeleted) return res.status(404).json({ error: 'Receive row not found' });
    if (!row.issue) return res.status(404).json({ error: 'Receive issue not found' });

    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    const dispatchedCount = Number(row.dispatchedCount || 0);
    if (dispatchedWeight > 0 || dispatchedCount > 0) {
      return res.status(400).json({ error: 'Cannot edit row: already dispatched' });
    }
    const transfer = await prisma.boxTransfer.findFirst({
      where: {
        stage: 'coning',
        OR: [{ fromItemId: id }, { toItemId: id }],
      },
      select: { id: true },
    });
    if (transfer) {
      return res.status(400).json({ error: 'Cannot edit row: box transfer exists' });
    }

    const coneCount = toInt(req.body?.coneCount ?? row.coneCount);
    const grossWeight = toNumber(req.body?.grossWeight ?? row.grossWeight);
    const boxId = typeof req.body?.boxId === 'string' ? req.body.boxId : row.boxId;
    const date = toOptionalString(req.body?.date ?? row.date);
    const machineNo = toOptionalString(req.body?.machineNo ?? row.machineNo);
    const operatorId = typeof req.body?.operatorId === 'string' ? req.body.operatorId : row.operatorId;
    const helperId = typeof req.body?.helperId === 'string' ? req.body.helperId : row.helperId;
    const notes = toOptionalString(req.body?.notes ?? row.notes);

    if (!Number.isFinite(coneCount) || coneCount <= 0) {
      return res.status(400).json({ error: 'Cone count must be a positive number' });
    }
    if (!Number.isFinite(grossWeight) || grossWeight <= 0) {
      return res.status(400).json({ error: 'Gross weight must be a positive number' });
    }

    const box = boxId ? await prisma.box.findUnique({ where: { id: boxId } }) : null;
    if (boxId && (!box || !Number.isFinite(box.weight) || Number(box.weight) <= 0)) {
      return res.status(400).json({ error: 'Box weight missing. Update box first.' });
    }

    let coneTypeId = null;
    try {
      let refs = row.issue?.receivedRowRefs;
      if (typeof refs === 'string') refs = JSON.parse(refs || '[]');
      if (Array.isArray(refs) && refs.length > 0) {
        coneTypeId = refs[0]?.coneTypeId || null;
      }
    } catch (e) {
      coneTypeId = null;
    }

    let coneWeightPerPiece = 0;
    if (coneTypeId) {
      const coneType = await prisma.coneType.findUnique({ where: { id: coneTypeId } });
      if (!coneType || !Number.isFinite(coneType.weight) || Number(coneType.weight) <= 0) {
        return res.status(400).json({ error: 'Cone type weight missing. Update cone type first.' });
      }
      coneWeightPerPiece = Number(coneType.weight);
    }

    const boxWeight = box ? Number(box.weight) : 0;
    const tareWeight = roundTo3Decimals(boxWeight + coneWeightPerPiece * coneCount);
    const netWeight = roundTo3Decimals(grossWeight - tareWeight);
    if (!Number.isFinite(netWeight) || netWeight <= 0) {
      return res.status(400).json({ error: 'Gross weight must be greater than tare weight' });
    }

    const prevNetWeight = Number.isFinite(row.netWeight)
      ? Number(row.netWeight)
      : roundTo3Decimals((Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
    const prevConeCount = Number(row.coneCount || 0);
    const deltaNetWeight = roundTo3Decimals(netWeight - prevNetWeight);
    const deltaCones = coneCount - prevConeCount;

    const pieceId = row.issueId;
    const updated = await prisma.$transaction(async (tx) => {
      const totals = await tx.receiveFromConingMachinePieceTotal.findUnique({ where: { pieceId } });
      if (!totals) {
        throw new Error('Receive totals not found for this issue');
      }
      const nextTotalNet = roundTo3Decimals(Number(totals.totalNetWeight || 0) + deltaNetWeight);
      const nextTotalCones = Number(totals.totalCones || 0) + deltaCones;
      if (nextTotalNet < -1e-6 || nextTotalCones < 0) {
        throw new Error('Invalid totals after update');
      }

      const sourceRowRefs = await computeConingReceiveSourceRowRefs(tx, row.issue, netWeight, id);
      const updatedRow = await tx.receiveFromConingMachineRow.update({
        where: { id },
        data: {
          date,
          machineNo,
          operatorId: operatorId || null,
          helperId: helperId || null,
          boxId: boxId || null,
          coneCount,
          coneWeight: netWeight,
          netWeight,
          tareWeight,
          grossWeight: roundTo3Decimals(grossWeight),
          sourceRowRefs,
          notes,
          ...actorUpdateFields(actorUserId),
        },
      });

      if (deltaNetWeight !== 0 || deltaCones !== 0) {
        await tx.receiveFromConingMachinePieceTotal.update({
          where: { pieceId },
          data: {
            ...(deltaNetWeight !== 0 ? { totalNetWeight: { increment: deltaNetWeight } } : {}),
            ...(deltaCones !== 0 ? { totalCones: { increment: deltaCones } } : {}),
            ...actorUpdateFields(actorUserId),
          },
        });
      }

      return updatedRow;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_from_coning_machine_row',
      entityId: updated.id,
      action: 'update',
      payload: {
        coneCount,
        grossWeight,
        tareWeight,
        netWeight,
        deltaNetWeight,
        deltaCones,
      },
    });

    res.json({ ok: true, row: updated });
  } catch (err) {
    console.error('Failed to update coning receive row', err);
    res.status(500).json({ error: err.message || 'Failed to update coning receive row' });
  }
});

router.delete('/api/receive_from_coning_machine/rows/:id', requireDeletePermission('receive.coning'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing receive row id' });

    const row = await prisma.receiveFromConingMachineRow.findUnique({
      where: { id },
      include: { issue: true },
    });
    if (!row || row.isDeleted) return res.status(404).json({ error: 'Receive row not found' });
    if (!row.issue) return res.status(404).json({ error: 'Receive issue not found' });

    const dispatchedWeight = Number(row.dispatchedWeight || 0);
    const dispatchedCount = Number(row.dispatchedCount || 0);
    if (dispatchedWeight > 0 || dispatchedCount > 0) {
      return res.status(400).json({ error: 'Cannot delete row: already dispatched' });
    }
    const transfer = await prisma.boxTransfer.findFirst({
      where: {
        stage: 'coning',
        OR: [{ fromItemId: id }, { toItemId: id }],
      },
      select: { id: true },
    });
    if (transfer) {
      return res.status(400).json({ error: 'Cannot delete row: box transfer exists' });
    }

    const prevNetWeight = Number.isFinite(row.netWeight)
      ? Number(row.netWeight)
      : roundTo3Decimals((Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
    const prevConeCount = Number(row.coneCount || 0);
    const deltaNetWeight = roundTo3Decimals(-prevNetWeight);
    const deltaCones = -prevConeCount;

    const pieceId = row.issueId;
    const deleted = await prisma.$transaction(async (tx) => {
      const totals = await tx.receiveFromConingMachinePieceTotal.findUnique({ where: { pieceId } });
      if (!totals) {
        throw new Error('Receive totals not found for this issue');
      }
      const nextTotalNet = roundTo3Decimals(Number(totals.totalNetWeight || 0) + deltaNetWeight);
      const nextTotalCones = Number(totals.totalCones || 0) + deltaCones;
      if (nextTotalNet < -1e-6 || nextTotalCones < 0) {
        throw new Error('Invalid totals after delete');
      }

      const updatedRow = await tx.receiveFromConingMachineRow.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      await tx.receiveFromConingMachinePieceTotal.update({
        where: { pieceId },
        data: {
          totalNetWeight: { increment: deltaNetWeight },
          totalCones: { increment: deltaCones },
          ...actorUpdateFields(actorUserId),
        },
      });

      return updatedRow;
    });

    await logCrudWithActor(req, {
      entityType: 'receive_from_coning_machine_row',
      entityId: deleted.id,
      action: 'delete',
      payload: {
        coneCount: prevConeCount,
        netWeight: prevNetWeight,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete coning receive row', err);
    res.status(500).json({ error: err.message || 'Failed to delete coning receive row' });
  }
});

// Simple import endpoint: replaces data for simplicity
router.post('/api/import', requireRole('admin'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Missing body' });

    // Clear existing tables (simple approach for import)
    await prisma.receiveFromConingMachineRow.deleteMany();
    await prisma.receiveFromConingMachinePieceTotal.deleteMany();
    await prisma.issueToConingMachine.deleteMany();
    await prisma.issueToCutterMachine.deleteMany();
    await prisma.receiveFromCutterMachineRow.deleteMany();
    await prisma.receiveFromCutterMachineUpload.deleteMany();
    await prisma.receiveFromCutterMachinePieceTotal.deleteMany();
    await prisma.inboundItem.deleteMany();
    await prisma.lot.deleteMany();
    await prisma.item.deleteMany();
    await prisma.firm.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.operator.deleteMany();
    await prisma.bobbin.deleteMany();
    await prisma.box.deleteMany();
    await prisma.coneType.deleteMany();
    await prisma.wrapper.deleteMany();

    // Bulk create
    if (Array.isArray(data.items)) {
      for (const it of data.items) {
        await prisma.item.create({ data: { id: it.id || undefined, name: it.name, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.firms)) {
      for (const f of data.firms) {
        await prisma.firm.create({ data: { id: f.id || undefined, name: f.name, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.suppliers)) {
      for (const s of data.suppliers) {
        await prisma.supplier.create({ data: { id: s.id || undefined, name: s.name, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.lots)) {
      for (const l of data.lots) {
        await prisma.lot.create({ data: { id: l.id || undefined, lotNo: l.lotNo, date: l.date, itemId: l.itemId, firmId: l.firmId, supplierId: l.supplierId || null, totalPieces: l.totalPieces || 0, totalWeight: Number(l.totalWeight || 0), ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.inbound_items)) {
      for (const ii of data.inbound_items) {
        await prisma.inboundItem.create({ data: { id: ii.id, lotNo: ii.lotNo, itemId: ii.itemId, weight: Number(ii.weight || 0), status: ii.status || 'available', seq: ii.seq || 0, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.issue_to_cutter_machine)) {
      for (const c of data.issue_to_cutter_machine) {
        await prisma.issueToCutterMachine.create({ data: { id: c.id, date: c.date, itemId: c.itemId, lotNo: c.lotNo, count: c.count || 0, totalWeight: Number(c.totalWeight || 0), pieceIds: Array.isArray(c.pieceIds) ? c.pieceIds.join(',') : (c.pieceIds || ''), reason: c.reason || 'internal', note: c.note || null, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.workers)) {
      for (const w of data.workers) {
        await prisma.operator.create({ data: { id: w.id || undefined, name: w.name, role: normalizeWorkerRole(w.role), ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.bobbins)) {
      for (const b of data.bobbins) {
        await prisma.bobbin.create({ data: { id: b.id || undefined, name: b.name, weight: b.weight != null ? Number(b.weight) : null, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.boxes)) {
      for (const box of data.boxes) {
        await prisma.box.create({ data: { id: box.id || undefined, name: box.name, weight: Number(box.weight || 0), ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.cone_types)) {
      for (const ct of data.cone_types) {
        await prisma.coneType.create({ data: { id: ct.id || undefined, name: ct.name, weight: ct.weight != null ? Number(ct.weight) : null, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.wrappers)) {
      for (const w of data.wrappers) {
        await prisma.wrapper.create({ data: { id: w.id || undefined, name: w.name, ...actorCreateFields(actorUserId) } });
      }
    }
    if (Array.isArray(data.issue_to_coning_machine)) {
      for (const c of data.issue_to_coning_machine) {
        await prisma.issueToConingMachine.create({
          data: {
            id: c.id || undefined,
            date: c.date,
            itemId: c.itemId,
            lotNo: c.lotNo,
            machineId: c.machineId || null,
            operatorId: c.operatorId || null,
            barcode: c.barcode,
            note: c.note || null,
            rollsIssued: Number(c.rollsIssued || 0),
            requiredPerConeNetWeight: Number(c.requiredPerConeNetWeight || 0),
            expectedCones: Number(c.expectedCones || 0),
            receivedRowRefs: Array.isArray(c.receivedRowRefs) ? c.receivedRowRefs : [],
            ...actorCreateFields(actorUserId),
          },
        });
      }
    }
    if (Array.isArray(data.receive_from_coning_machine_rows)) {
      for (const row of data.receive_from_coning_machine_rows) {
        await prisma.receiveFromConingMachineRow.create({
          data: {
            id: row.id || undefined,
            issueId: row.issueId,
            coneCount: Number(row.coneCount || 0),
            coneWeight: row.coneWeight != null ? Number(row.coneWeight) : null,
            netWeight: row.netWeight != null ? Number(row.netWeight) : null,
            tareWeight: row.tareWeight != null ? Number(row.tareWeight) : null,
            grossWeight: row.grossWeight != null ? Number(row.grossWeight) : null,
            barcode: row.barcode || null,
            date: row.date || null,
            boxId: row.boxId || null,
            machineNo: row.machineNo || null,
            operatorId: row.operatorId || null,
            helperId: row.helperId || null,
            notes: row.notes || null,
            createdBy: row.createdBy || null,
            ...actorCreateFields(actorUserId),
          },
        });
      }
    }
    if (Array.isArray(data.receive_from_coning_machine_piece_totals)) {
      for (const total of data.receive_from_coning_machine_piece_totals) {
        await prisma.receiveFromConingMachinePieceTotal.create({
          data: {
            pieceId: total.pieceId,
            totalCones: Number(total.totalCones || 0),
            totalNetWeight: Number(total.totalNetWeight || 0),
            wastageNetWeight: Number(total.wastageNetWeight || 0),
            ...actorCreateFields(actorUserId),
          },
        });
      }
    }

    // Settings
    if (data.ui && data.ui.brand) {
      const b = data.ui.brand;
      await prisma.settings.upsert({
        where: { id: 1 },
        update: { brandPrimary: b.primary || '#2E4CA6', brandGold: b.gold || '#D4AF37', logoDataUrl: b.logoDataUrl || null, ...actorUpdateFields(actorUserId) },
        create: { id: 1, brandPrimary: b.primary || '#2E4CA6', brandGold: b.gold || '#D4AF37', logoDataUrl: b.logoDataUrl || null, ...actorCreateFields(actorUserId) },
      });
    }

    await logCrudWithActor(req, {
      entityType: 'import',
      entityId: null,
      action: 'import',
      payload: {
        counts: {
          items: Array.isArray(data.items) ? data.items.length : 0,
          firms: Array.isArray(data.firms) ? data.firms.length : 0,
          suppliers: Array.isArray(data.suppliers) ? data.suppliers.length : 0,
          lots: Array.isArray(data.lots) ? data.lots.length : 0,
          inboundItems: Array.isArray(data.inbound_items) ? data.inbound_items.length : 0,
          issues: Array.isArray(data.issue_to_cutter_machine) ? data.issue_to_cutter_machine.length : 0,
          coningIssues: Array.isArray(data.issue_to_coning_machine) ? data.issue_to_coning_machine.length : 0,
          coningReceives: Array.isArray(data.receive_from_coning_machine_rows) ? data.receive_from_coning_machine_rows.length : 0,
          coningTotals: Array.isArray(data.receive_from_coning_machine_piece_totals) ? data.receive_from_coning_machine_piece_totals.length : 0,
          coneTypes: Array.isArray(data.cone_types) ? data.cone_types.length : 0,
          wrappers: Array.isArray(data.wrappers) ? data.wrappers.length : 0,
          workers: Array.isArray(data.workers) ? data.workers.length : 0,
          bobbins: Array.isArray(data.bobbins) ? data.bobbins.length : 0,
          boxes: Array.isArray(data.boxes) ? data.boxes.length : 0,
        },
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Basic CRUD endpoints (items example)
router.get('/api/items', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.item.findMany()); });
router.post('/api/items', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name } = req.body;
  const item = await prisma.item.create({ data: { name, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, {
    entityType: 'item',
    entityId: item.id,
    action: 'create',
    payload: item,
  });
  res.json(item);
});
router.delete('/api/items/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingItem = await prisma.item.findUnique({ where: { id } });
  if (!existingItem) {
    return res.status(404).json({ error: 'Item not found' });
  }
  const usage = await prisma.lot.count({ where: { itemId: id } }) +
    await prisma.inboundItem.count({ where: { itemId: id } }) +
    await prisma.issueToCutterMachine.count({ where: { itemId: id, isDeleted: false } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Item is referenced and cannot be deleted' });
  }
  await prisma.item.delete({ where: { id } });
  await logCrudWithActor(req, {
    entityType: 'item',
    entityId: id,
    action: 'delete',
    payload: existingItem,
  });
  res.json({ ok: true });
});
// Update item name
router.put('/api/items/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const updated = await prisma.item.update({ where: { id }, data: { name, ...actorUpdateFields(req.user?.id) } });
    await logCrudWithActor(req, {
      entityType: 'item',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update item', err);
    res.status(500).json({ error: err.message || 'Failed to update item' });
  }
});

router.get('/api/yarns', requirePermission('masters', PERM_READ), async (req, res) => {
  const yarns = await prisma.yarn.findMany({ orderBy: { name: 'asc' } });
  res.json(yarns);
});

router.post('/api/yarns', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Missing yarn name' });
    }
    const yarn = await prisma.yarn.create({ data: { name: String(name).trim(), ...actorCreateFields(actorUserId) } });
    await logCrudWithActor(req, { entityType: 'yarn', entityId: yarn.id, action: 'create', payload: yarn });
    res.json(yarn);
  } catch (err) {
    console.error('Failed to create yarn', err);
    res.status(500).json({ error: err.message || 'Failed to create yarn' });
  }
});

router.put('/api/yarns/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Missing yarn name' });
    }
    const existing = await prisma.yarn.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Yarn not found' });
    }
    const updated = await prisma.yarn.update({ where: { id }, data: { name: String(name).trim(), ...actorUpdateFields(actorUserId) } });
    await logCrudWithActor(req, {
      entityType: 'yarn',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: { oldName: existing.name, newName: updated.name },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update yarn', err);
    res.status(500).json({ error: err.message || 'Failed to update yarn' });
  }
});

router.delete('/api/yarns/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.yarn.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Yarn not found' });
    }
    const issueUsage = await prisma.issueToHoloMachine.count({ where: { yarnId: id, isDeleted: false } });
    if (issueUsage > 0) {
      return res.status(400).json({ error: 'Yarn has been used in issues and cannot be deleted' });
    }
    await prisma.yarn.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'yarn', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete yarn', err);
    res.status(500).json({ error: err.message || 'Failed to delete yarn' });
  }
});

router.get('/api/cuts', requirePermission('masters', PERM_READ), async (req, res) => {
  const cuts = await prisma.cut.findMany({ orderBy: { name: 'asc' } });
  res.json(cuts);
});

router.post('/api/cuts', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing cut name' });
    }
    const cut = await prisma.cut.create({ data: { name: trimmed, ...actorCreateFields(actorUserId) } });
    await logCrudWithActor(req, { entityType: 'cut', entityId: cut.id, action: 'create', payload: cut });
    res.json(cut);
  } catch (err) {
    console.error('Failed to create cut', err);
    res.status(500).json({ error: err.message || 'Failed to create cut' });
  }
});

router.put('/api/cuts/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing cut name' });
    }
    const existing = await prisma.cut.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Cut not found' });
    }
    const updated = await prisma.cut.update({ where: { id }, data: { name: trimmed, ...actorUpdateFields(actorUserId) } });
    await logCrudWithActor(req, {
      entityType: 'cut',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: { oldName: existing.name, newName: updated.name },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update cut', err);
    res.status(500).json({ error: err.message || 'Failed to update cut' });
  }
});

router.delete('/api/cuts/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.cut.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Cut not found' });
    }
    const usage = await prisma.receiveFromCutterMachineRow.count({ where: { cutId: id, isDeleted: false } });
    if (usage > 0) {
      return res.status(400).json({ error: 'Cut is in use and cannot be deleted' });
    }
    await prisma.cut.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'cut', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete cut', err);
    res.status(500).json({ error: err.message || 'Failed to delete cut' });
  }
});

router.get('/api/twists', requirePermission('masters', PERM_READ), async (req, res) => {
  const twists = await prisma.twist.findMany({ orderBy: { name: 'asc' } });
  res.json(twists);
});

router.post('/api/twists', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing twist name' });
    }
    const twist = await prisma.twist.create({ data: { name: trimmed, ...actorCreateFields(actorUserId) } });
    await logCrudWithActor(req, { entityType: 'twist', entityId: twist.id, action: 'create', payload: twist });
    res.json(twist);
  } catch (err) {
    console.error('Failed to create twist', err);
    res.status(500).json({ error: err.message || 'Failed to create twist' });
  }
});

router.put('/api/twists/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing twist name' });
    }
    const existing = await prisma.twist.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Twist not found' });
    }
    const updated = await prisma.twist.update({ where: { id }, data: { name: trimmed, ...actorUpdateFields(actorUserId) } });
    await logCrudWithActor(req, {
      entityType: 'twist',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: { oldName: existing.name, newName: updated.name },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update twist', err);
    res.status(500).json({ error: err.message || 'Failed to update twist' });
  }
});

router.delete('/api/twists/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.twist.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Twist not found' });
    }
    const usage = await prisma.issueToHoloMachine.count({ where: { twistId: id, isDeleted: false } });
    if (usage > 0) {
      return res.status(400).json({ error: 'Twist is in use and cannot be deleted' });
    }
    await prisma.twist.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'twist', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete twist', err);
    res.status(500).json({ error: err.message || 'Failed to delete twist' });
  }
});

router.get('/api/firms', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.firm.findMany()); });
router.post('/api/firms', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, address, mobile } = req.body;
  const firm = await prisma.firm.create({ data: { name, address, mobile, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'firm', entityId: firm.id, action: 'create', payload: firm });
  res.json(firm);
});
router.delete('/api/firms/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingFirm = await prisma.firm.findUnique({ where: { id } });
  if (!existingFirm) return res.status(404).json({ error: 'Firm not found' });
  const usage = await prisma.lot.count({ where: { firmId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Firm is referenced and cannot be deleted' });
  }
  await prisma.firm.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'firm', entityId: id, action: 'delete', payload: existingFirm });
  res.json({ ok: true });
});
// Update firm name
router.put('/api/firms/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, address, mobile } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.firm.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Firm not found' });
    const updated = await prisma.firm.update({
      where: { id },
      data: { name, address, mobile, ...actorUpdateFields(actorUserId) }
    });
    await logCrudWithActor(req, {
      entityType: 'firm',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update firm', err);
    res.status(500).json({ error: err.message || 'Failed to update firm' });
  }
});

router.get('/api/suppliers', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.supplier.findMany()); });
router.post('/api/suppliers', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name } = req.body;
  const seller = await prisma.supplier.create({ data: { name, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'supplier', entityId: seller.id, action: 'create', payload: seller });
  res.json(seller);
});
router.delete('/api/suppliers/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingSupplier = await prisma.supplier.findUnique({ where: { id } });
  if (!existingSupplier) return res.status(404).json({ error: 'Supplier not found' });
  const usage = await prisma.lot.count({ where: { supplierId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Supplier is referenced and cannot be deleted' });
  }
  await prisma.supplier.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'supplier', entityId: id, action: 'delete', payload: existingSupplier });
  res.json({ ok: true });
});
// Update supplier name
router.put('/api/suppliers/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });
    const updated = await prisma.supplier.update({ where: { id }, data: { name, ...actorUpdateFields(actorUserId) } });
    await logCrudWithActor(req, {
      entityType: 'supplier',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update supplier', err);
    res.status(500).json({ error: err.message || 'Failed to update supplier' });
  }
});

const MACHINE_PROCESS_TYPES = new Set(['all', 'cutter', 'holo', 'coning', 'boiler']);

router.get('/api/machines', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.machine.findMany()); });
router.post('/api/machines', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, processType = 'all', spindle } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  if (!MACHINE_PROCESS_TYPES.has(processType)) {
    return res.status(400).json({ error: 'Invalid machine process type' });
  }
  const spindleValue = spindle === undefined || spindle === null || spindle === ''
    ? null
    : toNumber(spindle);
  if (spindle !== undefined && spindle !== null && spindle !== '' && (!Number.isInteger(spindleValue) || spindleValue < 0)) {
    return res.status(400).json({ error: 'spindle must be a non-negative integer' });
  }
  const machine = await prisma.machine.create({ data: { name, processType, spindle: spindleValue, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'machine', entityId: machine.id, action: 'create', payload: machine });
  res.json(machine);
});
router.delete('/api/machines/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingMachine = await prisma.machine.findUnique({ where: { id } });
  if (!existingMachine) return res.status(404).json({ error: 'Machine not found' });
  const [cutterUsage, holoUsage, coningUsage, boilerUsage] = await Promise.all([
    prisma.issueToCutterMachine.count({ where: { machineId: id, isDeleted: false } }),
    prisma.issueToHoloMachine.count({ where: { machineId: id, isDeleted: false } }),
    prisma.issueToConingMachine.count({ where: { machineId: id, isDeleted: false } }),
    prisma.boilerSteamLog.count({ where: { boilerMachineId: id } }),
  ]);
  const usage = cutterUsage + holoUsage + coningUsage + boilerUsage;
  if (usage > 0) {
    return res.status(400).json({ error: 'Machine is referenced and cannot be deleted' });
  }
  await prisma.machine.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'machine', entityId: id, action: 'delete', payload: existingMachine });
  res.json({ ok: true });
});
// Update machine name and processType
router.put('/api/machines/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, processType, spindle } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Machine not found' });
    const data = { name };
    if (processType !== undefined) {
      if (!MACHINE_PROCESS_TYPES.has(processType)) {
        return res.status(400).json({ error: 'Invalid machine process type' });
      }
      data.processType = processType;
    }
    if (spindle !== undefined) {
      const spindleValue = spindle === null || spindle === ''
        ? null
        : toNumber(spindle);
      if (spindle !== null && spindle !== '' && (!Number.isInteger(spindleValue) || spindleValue < 0)) {
        return res.status(400).json({ error: 'spindle must be a non-negative integer' });
      }
      data.spindle = spindleValue;
    }
    const updated = await prisma.machine.update({ where: { id }, data: { ...data, ...actorUpdateFields(actorUserId) } });
    await logCrudWithActor(req, {
      entityType: 'machine',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldProcessType: existing.processType,
        newProcessType: updated.processType,
        oldSpindle: existing.spindle,
        newSpindle: updated.spindle,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update machine', err);
    res.status(500).json({ error: err.message || 'Failed to update machine' });
  }
});

router.get('/api/operators', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.operator.findMany()); });
router.post('/api/operators', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, role, processType = 'all' } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const workerRole = normalizeWorkerRole(role);
  const worker = await prisma.operator.create({ data: { name, role: workerRole, processType, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'operator', entityId: worker.id, action: 'create', payload: worker });
  res.json(worker);
});
router.delete('/api/operators/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingOperator = await prisma.operator.findUnique({ where: { id } });
  if (!existingOperator) return res.status(404).json({ error: 'Operator not found' });
  const usage =
    (await prisma.issueToCutterMachine.count({ where: { operatorId: id, isDeleted: false } })) +
    (await prisma.receiveFromCutterMachineRow.count({
      where: {
        OR: [
          { operatorId: id },
          { helperId: id },
        ],
        isDeleted: false,
      },
    }));
  if (usage > 0) {
    return res.status(400).json({ error: 'Operator is referenced and cannot be deleted' });
  }
  await prisma.operator.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'operator', entityId: id, action: 'delete', payload: existingOperator });
  res.json({ ok: true });
});
// Update operator name, role, and processType
router.put('/api/operators/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, role, processType } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.operator.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Operator not found' });
    const data = { name };
    if (role !== undefined) data.role = normalizeWorkerRole(role);
    if (processType !== undefined) data.processType = processType;
    const updated = await prisma.operator.update({ where: { id }, data: { ...data, ...actorUpdateFields(actorUserId) } });
    await logCrudWithActor(req, {
      entityType: 'operator',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldRole: existing.role,
        newRole: updated.role,
        oldProcessType: existing.processType,
        newProcessType: updated.processType,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update operator', err);
    res.status(500).json({ error: err.message || 'Failed to update operator' });
  }
});

router.get('/api/bobbins', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.bobbin.findMany()); });
router.post('/api/bobbins', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, weight } = req.body;
  const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
  const bobbin = await prisma.bobbin.create({
    data: {
      name,
      weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
      ...actorCreateFields(actorUserId),
    },
  });
  await logCrudWithActor(req, { entityType: 'bobbin', entityId: bobbin.id, action: 'create', payload: bobbin });
  res.json(bobbin);
});
router.delete('/api/bobbins/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingBobbin = await prisma.bobbin.findUnique({ where: { id } });
  if (!existingBobbin) return res.status(404).json({ error: 'Bobbin not found' });
  const usage = await prisma.receiveFromCutterMachineRow.count({ where: { bobbinId: id, isDeleted: false } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Bobbin is referenced and cannot be deleted' });
  }
  await prisma.bobbin.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'bobbin', entityId: id, action: 'delete', payload: existingBobbin });
  res.json({ ok: true });
});
// Update bobbin name and weight
router.put('/api/bobbins/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, weight } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.bobbin.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Bobbin not found' });
    const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
    const updated = await prisma.bobbin.update({
      where: { id },
      data: {
        name,
        weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
        ...actorUpdateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, {
      entityType: 'bobbin',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldWeight: existing.weight,
        newWeight: updated.weight,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update bobbin', err);
    res.status(500).json({ error: err.message || 'Failed to update bobbin' });
  }
});

// Roll types (Holo) master
router.get('/api/roll_types', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.rollType.findMany()); });
router.post('/api/roll_types', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { name, weight } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
    const created = await prisma.rollType.create({
      data: {
        name,
        weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
        ...actorCreateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, { entityType: 'roll_type', entityId: created.id, action: 'create', payload: created });
    res.json(created);
  } catch (err) {
    console.error('Failed to create roll type', err);
    res.status(500).json({ error: err.message || 'Failed to create roll type' });
  }
});
router.put('/api/roll_types/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, weight } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.rollType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Roll type not found' });
    const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
    const updated = await prisma.rollType.update({
      where: { id },
      data: {
        name,
        weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
        ...actorUpdateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, {
      entityType: 'roll_type',
      entityId: id,
      action: 'update',
      payload: { before: existing, after: updated },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update roll type', err);
    res.status(500).json({ error: err.message || 'Failed to update roll type' });
  }
});
router.delete('/api/roll_types/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.rollType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Roll type not found' });
    const usage = await prisma.receiveFromHoloMachineRow.count({ where: { rollTypeId: id, isDeleted: false } });
    if (usage > 0) {
      return res.status(400).json({ error: 'Roll type is referenced and cannot be deleted' });
    }
    await prisma.rollType.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'roll_type', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete roll type', err);
    res.status(500).json({ error: err.message || 'Failed to delete roll type' });
  }
});

// Holo production per hour master
router.get('/api/holo_production_per_hours', requirePermission('masters', PERM_READ), async (req, res) => {
  try {
    const rows = await prisma.holoProductionPerHour.findMany({
      include: {
        yarn: true,
        cut: true,
      },
      orderBy: [
        { yarn: { name: 'asc' } },
        { cutMatcher: 'asc' },
      ],
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to list holo production per hour rows', err);
    res.status(500).json({ error: err.message || 'Failed to list holo production per hour rows' });
  }
});
router.post('/api/holo_production_per_hours', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const yarnId = String(req.body?.yarnId || '').trim();
    const cutId = String(req.body?.cutId || '').trim() || null;
    const cutMatcher = normalizeCutMatcherValue(cutId);
    const productionPerHourKg = toNumber(req.body?.productionPerHourKg);
    if (!yarnId) return res.status(400).json({ error: 'yarnId is required' });
    if (!Number.isFinite(productionPerHourKg) || productionPerHourKg <= 0) {
      return res.status(400).json({ error: 'productionPerHourKg must be a positive number' });
    }

    const created = await prisma.holoProductionPerHour.create({
      data: {
        yarnId,
        cutId,
        cutMatcher,
        productionPerHourKg,
        ...actorCreateFields(actorUserId),
      },
      include: {
        yarn: true,
        cut: true,
      },
    });
    await logCrudWithActor(req, { entityType: 'holo_production_per_hour', entityId: created.id, action: 'create', payload: created });
    res.json(created);
  } catch (err) {
    console.error('Failed to create holo production per hour row', err);
    const isUnique = err?.code === 'P2002' || String(err?.message || '').includes('Unique constraint');
    res.status(isUnique ? 400 : 500).json({ error: isUnique ? 'A production-per-hour row already exists for this yarn/cut' : (err.message || 'Failed to create holo production per hour row') });
  }
});
router.put('/api/holo_production_per_hours/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const existing = await prisma.holoProductionPerHour.findUnique({ where: { id }, include: { yarn: true, cut: true } });
    if (!existing) return res.status(404).json({ error: 'Production-per-hour row not found' });

    const yarnId = String(req.body?.yarnId || '').trim();
    const cutId = String(req.body?.cutId || '').trim() || null;
    const cutMatcher = normalizeCutMatcherValue(cutId);
    const productionPerHourKg = toNumber(req.body?.productionPerHourKg);
    if (!yarnId) return res.status(400).json({ error: 'yarnId is required' });
    if (!Number.isFinite(productionPerHourKg) || productionPerHourKg <= 0) {
      return res.status(400).json({ error: 'productionPerHourKg must be a positive number' });
    }

    const updated = await prisma.holoProductionPerHour.update({
      where: { id },
      data: {
        yarnId,
        cutId,
        cutMatcher,
        productionPerHourKg,
        ...actorUpdateFields(actorUserId),
      },
      include: {
        yarn: true,
        cut: true,
      },
    });
    await logCrudWithActor(req, {
      entityType: 'holo_production_per_hour',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldYarnId: existing.yarnId,
        newYarnId: updated.yarnId,
        oldCutMatcher: existing.cutMatcher,
        newCutMatcher: updated.cutMatcher,
        oldProductionPerHourKg: existing.productionPerHourKg,
        newProductionPerHourKg: updated.productionPerHourKg,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update holo production per hour row', err);
    const isUnique = err?.code === 'P2002' || String(err?.message || '').includes('Unique constraint');
    res.status(isUnique ? 400 : 500).json({ error: isUnique ? 'A production-per-hour row already exists for this yarn/cut' : (err.message || 'Failed to update holo production per hour row') });
  }
});
router.delete('/api/holo_production_per_hours/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.holoProductionPerHour.findUnique({ where: { id }, include: { yarn: true, cut: true } });
    if (!existing) return res.status(404).json({ error: 'Production-per-hour row not found' });
    await prisma.holoProductionPerHour.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'holo_production_per_hour', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete holo production per hour row', err);
    res.status(500).json({ error: err.message || 'Failed to delete holo production per hour row' });
  }
});

router.get('/api/holo_other_wastage_items', requirePermission('masters', PERM_READ), async (req, res) => {
  try {
    const rows = await prisma.holoOtherWastageItem.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to list holo other wastage items', err);
    res.status(500).json({ error: err.message || 'Failed to list holo other wastage items' });
  }
});

router.post('/api/holo_other_wastage_items', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const created = await prisma.holoOtherWastageItem.create({
      data: {
        name,
        ...actorCreateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, { entityType: 'holo_other_wastage_item', entityId: created.id, action: 'create', payload: created });
    res.json(created);
  } catch (err) {
    console.error('Failed to create holo other wastage item', err);
    const isUnique = err?.code === 'P2002' || String(err?.message || '').includes('Unique constraint');
    res.status(isUnique ? 400 : 500).json({ error: isUnique ? 'Other wastage item already exists' : (err.message || 'Failed to create holo other wastage item') });
  }
});

router.put('/api/holo_other_wastage_items/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const existing = await prisma.holoOtherWastageItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Other wastage item not found' });

    const updated = await prisma.holoOtherWastageItem.update({
      where: { id },
      data: {
        name,
        ...actorUpdateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, {
      entityType: 'holo_other_wastage_item',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: { oldName: existing.name, newName: updated.name },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update holo other wastage item', err);
    const isUnique = err?.code === 'P2002' || String(err?.message || '').includes('Unique constraint');
    res.status(isUnique ? 400 : 500).json({ error: isUnique ? 'Other wastage item already exists' : (err.message || 'Failed to update holo other wastage item') });
  }
});

router.delete('/api/holo_other_wastage_items/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.holoOtherWastageItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Other wastage item not found' });

    await prisma.holoOtherWastageItem.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'holo_other_wastage_item', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete holo other wastage item', err);
    const isReferenced = err?.code === 'P2003' || String(err?.message || '').toLowerCase().includes('foreign key');
    res.status(isReferenced ? 400 : 500).json({
      error: isReferenced
        ? 'Cannot delete this Other Wastage item because daily wastage entries exist for it'
        : (err.message || 'Failed to delete holo other wastage item'),
    });
  }
});

router.get('/api/boxes', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.box.findMany()); });
router.post('/api/boxes', requirePermission('masters', PERM_WRITE), async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, weight, processType = 'all' } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const weightNum = Number(weight);
  if (!Number.isFinite(weightNum) || weightNum <= 0) return res.status(400).json({ error: 'weight must be a positive number' });
  const box = await prisma.box.create({
    data: {
      name,
      weight: weightNum,
      processType,
      ...actorCreateFields(actorUserId),
    },
  });
  await logCrudWithActor(req, { entityType: 'box', entityId: box.id, action: 'create', payload: box });
  res.json(box);
});
router.delete('/api/boxes/:id', requireDeletePermission('masters'), async (req, res) => {
  const { id } = req.params;
  const existingBox = await prisma.box.findUnique({ where: { id } });
  if (!existingBox) return res.status(404).json({ error: 'Box not found' });
  const usage = (await prisma.receiveFromCutterMachineRow.count({ where: { boxId: id, isDeleted: false } }))
    + (await prisma.receiveFromHoloMachineRow.count({ where: { boxId: id, isDeleted: false } }))
    + (await prisma.receiveFromConingMachineRow.count({ where: { boxId: id, isDeleted: false } }));
  if (usage > 0) {
    return res.status(400).json({ error: 'Box is referenced and cannot be deleted' });
  }
  await prisma.box.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'box', entityId: id, action: 'delete', payload: existingBox });
  res.json({ ok: true });
});

router.get('/api/cone_types', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.coneType.findMany()); });
router.post('/api/cone_types', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { name, weight } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
    const created = await prisma.coneType.create({
      data: {
        name,
        weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
        ...actorCreateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, { entityType: 'cone_type', entityId: created.id, action: 'create', payload: created });
    res.json(created);
  } catch (err) {
    console.error('Failed to create cone type', err);
    res.status(500).json({ error: err.message || 'Failed to create cone type' });
  }
});
router.put('/api/cone_types/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, weight } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.coneType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Cone type not found' });
    const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
    const updated = await prisma.coneType.update({
      where: { id },
      data: {
        name,
        weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
        ...actorUpdateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, {
      entityType: 'cone_type',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update cone type', err);
    res.status(500).json({ error: err.message || 'Failed to update cone type' });
  }
});
router.delete('/api/cone_types/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.coneType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Cone type not found' });
    await prisma.coneType.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'cone_type', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete cone type', err);
    res.status(500).json({ error: err.message || 'Failed to delete cone type' });
  }
});

router.get('/api/wrappers', requirePermission('masters', PERM_READ), async (req, res) => { res.json(await prisma.wrapper.findMany()); });
router.post('/api/wrappers', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const created = await prisma.wrapper.create({
      data: {
        name,
        ...actorCreateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, { entityType: 'wrapper', entityId: created.id, action: 'create', payload: created });
    res.json(created);
  } catch (err) {
    console.error('Failed to create wrapper', err);
    res.status(500).json({ error: err.message || 'Failed to create wrapper' });
  }
});
router.put('/api/wrappers/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.wrapper.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Wrapper not found' });
    const updated = await prisma.wrapper.update({
      where: { id },
      data: {
        name,
        ...actorUpdateFields(actorUserId),
      },
    });
    await logCrudWithActor(req, {
      entityType: 'wrapper',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update wrapper', err);
    res.status(500).json({ error: err.message || 'Failed to update wrapper' });
  }
});
router.delete('/api/wrappers/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.wrapper.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Wrapper not found' });
    await prisma.wrapper.delete({ where: { id } });
    await logCrudWithActor(req, { entityType: 'wrapper', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete wrapper', err);
    res.status(500).json({ error: err.message || 'Failed to delete wrapper' });
  }
});
router.put('/api/boxes/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, weight, processType } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const weightNum = Number(weight);
    if (!Number.isFinite(weightNum) || weightNum <= 0) return res.status(400).json({ error: 'weight must be a positive number' });
    const existing = await prisma.box.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Box not found' });
    const data = { name, weight: weightNum, ...actorUpdateFields(actorUserId) };
    if (processType !== undefined) data.processType = processType;
    const updated = await prisma.box.update({
      where: { id },
      data,
    });
    await logCrudWithActor(req, {
      entityType: 'box',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldWeight: existing.weight,
        newWeight: updated.weight,
        oldProcessType: existing.processType,
        newProcessType: updated.processType,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update box', err);
    res.status(500).json({ error: err.message || 'Failed to update box' });
  }
});

router.put('/api/issue_to_cutter_machine/:id', requireEditPermission('issue.cutter'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const {
      date,
      note,
      machineId,
      operatorId,
      cutId,
      pieceIds: rawPieceIds,
    } = req.body || {};

    const issueRecord = await prisma.issueToCutterMachine.findFirst({
      where: { id, isDeleted: false },
    });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to machine record not found' });
    }

    const existingIssueLines = await prisma.issueToCutterMachineLine.findMany({
      where: { issueId: id },
      select: { pieceId: true, issuedWeight: true },
    });
    const existingPieceIds = Array.from(new Set(existingIssueLines.map((line) => line.pieceId).filter(Boolean)));
    const receiveCount = await prisma.receiveFromCutterMachineRow.count({
      where: {
        isDeleted: false,
        OR: [
          { issueId: id },
          ...(existingPieceIds.length > 0 ? [{ issueId: null, pieceId: { in: existingPieceIds }, createdAt: { gte: issueRecord.createdAt } }] : []),
        ],
      },
    });

    const rawPieceLines = Array.isArray(req.body?.pieceLines) ? req.body.pieceLines : [];
    const hasPieceLinesInput = rawPieceLines.length > 0;
    const hasPieceIdsInput = rawPieceIds !== undefined;
    const wantsQuantityEdit = hasPieceLinesInput || hasPieceIdsInput;

    if (wantsQuantityEdit) {
      const activeTakeBackCount = await prisma.issueTakeBack.count({
        where: { stage: 'cutter', issueId: id, isReverse: false, isReversed: false },
      });
      if (activeTakeBackCount > 0) {
        return res.status(400).json({ error: 'Cannot edit issue quantities while active take-backs exist' });
      }
      if (receiveCount > 0) {
        return res.status(400).json({ error: 'Cannot change issue quantities: receive records exist for this issue' });
      }
    }

    let updatedIssue = issueRecord;

    await prisma.$transaction(async (tx) => {
      const data = {};

      if (date !== undefined) {
        const trimmed = String(date).trim();
        if (!trimmed) throw new Error('Date is required');
        data.date = trimmed;
      }
      if (note !== undefined) data.note = note ? String(note) : null;
      if (machineId !== undefined) data.machineId = machineId || null;
      if (operatorId !== undefined) data.operatorId = operatorId || null;
      if (cutId !== undefined) data.cutId = cutId || null;

      if (wantsQuantityEdit) {
        const normalizedInputLines = hasPieceLinesInput
          ? rawPieceLines
            .map((line) => ({
              pieceId: typeof line?.pieceId === 'string' ? line.pieceId.trim() : '',
              issuedWeight: toStrictPositiveWeight(line?.issuedWeight),
              count: toNonNegativeInt(line?.count) || 0,
            }))
            .filter((line) => line.pieceId)
          : (Array.isArray(rawPieceIds)
            ? rawPieceIds
              .map((pieceId) => String(pieceId || '').trim())
              .filter(Boolean)
              .map((pieceId) => ({ pieceId, issuedWeight: null, count: 1 }))
            : String(rawPieceIds || '')
              .split(',')
              .map((pieceId) => String(pieceId || '').trim())
              .filter(Boolean)
              .map((pieceId) => ({ pieceId, issuedWeight: null, count: 1 })));

        if (normalizedInputLines.length === 0) {
          throw new Error('pieceLines/pieceIds must be non-empty');
        }

        const uniquePieceIds = Array.from(new Set(normalizedInputLines.map((line) => line.pieceId)));
        const pieces = await tx.inboundItem.findMany({
          where: { id: { in: uniquePieceIds } },
          orderBy: { seq: 'asc' },
        });
        if (pieces.length !== uniquePieceIds.length) {
          throw new Error('One or more pieces do not exist');
        }

        const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));
        const oldAllocationMap = new Map();
        existingIssueLines.forEach((line) => {
          const prev = oldAllocationMap.get(line.pieceId) || 0;
          oldAllocationMap.set(line.pieceId, prev + Number(line.issuedWeight || 0));
        });

        const nextLines = normalizedInputLines.map((line) => {
          const piece = pieceMap.get(line.pieceId);
          if (!piece) throw new Error(`Piece ${line.pieceId} not found`);
          const oldAlloc = Number(oldAllocationMap.get(line.pieceId) || 0);
          const baseIssued = Math.max(0, Number(piece.issuedToCutterWeight || 0) - oldAlloc);
          const maxIssueable = Math.max(0, Number(piece.weight || 0) - Number(piece.dispatchedWeight || 0));
          const availableForThisIssue = Math.max(0, maxIssueable - baseIssued);
          const requestedWeight = line.issuedWeight == null ? availableForThisIssue : Number(line.issuedWeight);
          if (!Number.isFinite(requestedWeight) || requestedWeight <= 0) {
            throw new Error(`Invalid issued weight for piece ${line.pieceId}`);
          }
          if (requestedWeight - availableForThisIssue > TAKE_BACK_EPSILON) {
            throw new Error(`Issued weight exceeds available weight for piece ${line.pieceId}`);
          }
          return {
            pieceId: line.pieceId,
            issuedWeight: roundTo3Decimals(requestedWeight),
            count: line.count > 0 ? line.count : 1,
          };
        });

        const itemIds = new Set(pieces.map((piece) => piece.itemId));
        const lotNos = new Set(pieces.map((piece) => piece.lotNo));
        if (itemIds.size !== 1) throw new Error('Pieces must belong to a single item');
        if (lotNos.size !== 1) throw new Error('Pieces must belong to a single lot');

        const allPieceIdsToAdjust = Array.from(new Set([...existingPieceIds, ...uniquePieceIds]));
        const nextWeightByPiece = new Map();
        nextLines.forEach((line) => {
          const prev = nextWeightByPiece.get(line.pieceId) || 0;
          nextWeightByPiece.set(line.pieceId, prev + Number(line.issuedWeight || 0));
        });

        for (const pieceId of allPieceIdsToAdjust) {
          const piece = pieceMap.get(pieceId) || await tx.inboundItem.findUnique({
            where: { id: pieceId },
            select: { id: true, weight: true, dispatchedWeight: true, issuedToCutterWeight: true },
          });
          if (!piece) continue;

          const oldAlloc = Number(oldAllocationMap.get(pieceId) || 0);
          const baseIssued = Math.max(0, Number(piece.issuedToCutterWeight || 0) - oldAlloc);
          const nextAlloc = Number(nextWeightByPiece.get(pieceId) || 0);
          const maxIssueable = Math.max(0, Number(piece.weight || 0) - Number(piece.dispatchedWeight || 0));
          const nextIssuedRaw = baseIssued + nextAlloc;
          if (nextIssuedRaw - maxIssueable > TAKE_BACK_EPSILON) {
            throw new Error(`Insufficient capacity for piece ${pieceId}`);
          }
          const nextIssued = clampZero(nextIssuedRaw);
          const nextAvailable = Math.max(0, maxIssueable - nextIssued);
          const nextStatus = nextAvailable > TAKE_BACK_EPSILON ? 'available' : 'consumed';

          await tx.inboundItem.update({
            where: { id: pieceId },
            data: {
              issuedToCutterWeight: nextIssued,
              status: nextStatus,
              ...actorUpdateFields(actorUserId),
            },
          });
        }

        await tx.issueToCutterMachineLine.deleteMany({ where: { issueId: id } });
        for (const line of nextLines) {
          await tx.issueToCutterMachineLine.create({
            data: {
              issueId: id,
              pieceId: line.pieceId,
              issuedWeight: line.issuedWeight,
              ...actorCreateFields(actorUserId),
            },
          });
        }

        const totalWeight = roundTo3Decimals(nextLines.reduce((sum, line) => sum + Number(line.issuedWeight || 0), 0));
        const totalCount = nextLines.reduce((sum, line) => sum + Number(line.count || 0), 0);
        data.itemId = pieces[0].itemId;
        data.lotNo = pieces[0].lotNo;
        data.count = toNonNegativeInt(totalCount);
        data.totalWeight = totalWeight;
        data.pieceIds = uniquePieceIds.join(',');
      }

      if (Object.keys(data).length > 0) {
        updatedIssue = await tx.issueToCutterMachine.update({
          where: { id },
          data: { ...data, ...actorUpdateFields(actorUserId) },
        });
      }
    });

    await logCrudWithActor(req, {
      entityType: 'issue_to_cutter_machine',
      entityId: id,
      action: 'update',
      before: issueRecord,
      after: updatedIssue,
      payload: {
        quantityEdited: wantsQuantityEdit,
      },
    });

    res.json({ ok: true, issueToCutterMachine: updatedIssue, issueToMachine: updatedIssue });
  } catch (err) {
    console.error('Failed to update issue_to_cutter_machine', err);
    res.status(400).json({ error: err.message || 'Failed to update issue_to_cutter_machine' });
  }
});

router.put('/api/issue_to_holo_machine/:id', requireEditPermission('issue.holo'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const {
      date,
      machineId,
      operatorId,
      yarnId,
      yarnKg,
      note,
      crates,
      receivedRowRefs,
      rollsProducedEstimate,
      twistId,
      shift,
      cutId,
    } = req.body || {};

    const issueRecord = await prisma.issueToHoloMachine.findFirst({
      where: { id, isDeleted: false },
    });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to Holo machine record not found' });
    }

    const receiveCount = await prisma.receiveFromHoloMachineRow.count({
      where: { issueId: id, isDeleted: false },
    });
    const hasReceives = receiveCount > 0;

    const cratesInput = Array.isArray(crates)
      ? crates
      : (Array.isArray(receivedRowRefs) ? receivedRowRefs : undefined);
    const wantsCrateUpdate = cratesInput !== undefined;
    const activeTakeBackCount = wantsCrateUpdate
      ? await prisma.issueTakeBack.count({
        where: { stage: 'holo', issueId: id, isReverse: false, isReversed: false },
      })
      : 0;

    if (hasReceives && wantsCrateUpdate) {
      return res.status(400).json({ error: 'Cannot change crates: receive records exist for this issue' });
    }
    if (wantsCrateUpdate && activeTakeBackCount > 0) {
      return res.status(400).json({ error: 'Cannot change issue quantities while active take-backs exist' });
    }

    let updatedIssue = issueRecord;

    await prisma.$transaction(async (tx) => {
      const data = {};

      if (date !== undefined) {
        const trimmed = String(date).trim();
        if (!trimmed) throw new Error('Date is required');
        data.date = trimmed;
      }
      if (note !== undefined) data.note = note ? String(note) : null;
      if (machineId !== undefined) data.machineId = machineId || null;
      if (operatorId !== undefined) data.operatorId = operatorId || null;
      if (shift !== undefined) data.shift = shift || null;
      if (cutId !== undefined) data.cutId = cutId || null;

      if (!hasReceives) {
        if (yarnId !== undefined) data.yarnId = yarnId || null;
        if (twistId !== undefined) data.twistId = twistId || null;
        if (rollsProducedEstimate !== undefined) {
          const estimate = Number(rollsProducedEstimate);
          data.rollsProducedEstimate = Number.isFinite(estimate) ? estimate : null;
        }
        if (yarnKg !== undefined) {
          const yarnKgNum = Number(yarnKg);
          data.yarnKg = Number.isFinite(yarnKgNum) ? yarnKgNum : 0;
        }
      }

      if (wantsCrateUpdate) {
        const normalizedCrates = cratesInput
          .map((crate) => ({
            rowId: typeof crate.rowId === 'string' ? crate.rowId.trim() : '',
            issuedBobbins: Number(crate.issuedBobbins || 0),
          }))
          .filter((crate) => crate.rowId);

        if (normalizedCrates.length === 0) {
          throw new Error('Invalid crate payload');
        }
        if (normalizedCrates.some((crate) => !Number.isFinite(crate.issuedBobbins) || crate.issuedBobbins <= 0)) {
          throw new Error('Enter bobbin quantity for each scanned crate');
        }
        const rowIds = normalizedCrates.map((crate) => crate.rowId);
        const uniqueRowIds = new Set(rowIds);
        if (uniqueRowIds.size !== rowIds.length) {
          throw new Error('Duplicate crates were scanned. Remove duplicates and try again.');
        }

        const receiveRows = await tx.receiveFromCutterMachineRow.findMany({
          where: { id: { in: rowIds }, isDeleted: false },
          select: {
            id: true,
            pieceId: true,
            cutId: true,
            cut: true,
            bobbinQuantity: true,
            netWt: true,
            issuedBobbins: true,
            issuedBobbinWeight: true,
            dispatchedCount: true,
            dispatchedWeight: true,
          },
        });
        if (receiveRows.length !== normalizedCrates.length) {
          throw new Error('One or more scanned crates were not found');
        }

        const pieceIds = Array.from(new Set(receiveRows.map((row) => row.pieceId).filter(Boolean)));
        const pieces = await tx.inboundItem.findMany({
          where: { id: { in: pieceIds } },
          select: { id: true, itemId: true, lotNo: true },
        });
        const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));
        if (pieceMap.size !== pieceIds.length) {
          throw new Error('One or more crates are missing linked inbound pieces');
        }

        const lotSet = new Set();
        const itemSet = new Set();
        for (const row of receiveRows) {
          const piece = pieceMap.get(row.pieceId);
          lotSet.add(piece.lotNo);
          itemSet.add(piece.itemId);
        }
        if (itemSet.size !== 1) {
          throw new Error('Crates must belong to a single item');
        }
        const lotNos = Array.from(lotSet).filter(Boolean);
        if (lotNos.length === 0) {
          throw new Error('Unable to resolve lot numbers for scanned crates');
        }
        const lotNo = lotNos.length === 1 ? lotNos[0] : 'MIXED';
        const itemId = Array.from(itemSet)[0];
        const sourceCutIds = new Set(receiveRows.map((row) => row.cutId).filter(Boolean));
        if (sourceCutIds.size > 1) {
          throw new Error('Crates must belong to a single cut');
        }
        let resolvedCutId = sourceCutIds.size === 1 ? Array.from(sourceCutIds)[0] : null;
        if (!resolvedCutId) {
          const sourceCutNames = Array.from(new Set(receiveRows.map((row) => String(row.cut || '').trim()).filter(Boolean)));
          if (sourceCutNames.length > 1) {
            throw new Error('Crates must belong to a single cut');
          }
          if (sourceCutNames.length === 1) {
            const cutRecord = await tx.cut.findUnique({ where: { name: sourceCutNames[0] } });
            if (cutRecord) resolvedCutId = cutRecord.id;
          }
        }

        const resolvedTwistId = twistId !== undefined ? (twistId || null) : issueRecord.twistId;
        if (!resolvedTwistId) {
          throw new Error('Missing twist selection');
        }
        const twistRecord = await tx.twist.findUnique({ where: { id: resolvedTwistId } });
        if (!twistRecord) {
          throw new Error('Selected twist not found');
        }

        let resolvedYarnId = yarnId !== undefined ? (yarnId || null) : issueRecord.yarnId;
        if (resolvedYarnId) {
          const yarnRecord = await tx.yarn.findUnique({ where: { id: resolvedYarnId } });
          if (!yarnRecord) {
            throw new Error('Selected yarn not found');
          }
        }

        const oldRefsRaw = issueRecord.receivedRowRefs;
        let oldRefs = Array.isArray(oldRefsRaw) ? oldRefsRaw : [];
        if (typeof oldRefsRaw === 'string') {
          try { oldRefs = JSON.parse(oldRefsRaw || '[]'); } catch (_) { oldRefs = []; }
        }
        const oldMap = new Map();
        oldRefs.forEach((ref) => {
          const rowId = typeof ref?.rowId === 'string' ? ref.rowId : null;
          if (!rowId) return;
          oldMap.set(rowId, {
            issuedBobbins: Number(ref.issuedBobbins || 0),
            issuedBobbinWeight: Number(ref.issuedBobbinWeight || 0),
          });
        });
        const receiveRowMap = new Map(receiveRows.map((row) => [row.id, row]));
        const newMap = new Map();

        for (const crate of normalizedCrates) {
          const sourceRow = receiveRowMap.get(crate.rowId);
          if (!sourceRow) continue;
          const oldForIssue = oldMap.get(crate.rowId) || { issuedBobbins: 0, issuedBobbinWeight: 0 };
          const requestedCount = Number(crate.issuedBobbins || 0);
          const requestedWeightExact = deriveHoloIssuedWeightFromCount({
            bobbinQuantity: sourceRow.bobbinQuantity,
            netWeight: sourceRow.netWt,
            issuedBobbins: requestedCount,
          });

          const totalCount = Number(sourceRow.bobbinQuantity || 0);
          const totalWeight = Number(sourceRow.netWt || 0);
          const dispatchedCount = Number(sourceRow.dispatchedCount || 0);
          const dispatchedWeight = Number(sourceRow.dispatchedWeight || 0);
          const issuedCountTotal = Number(sourceRow.issuedBobbins || 0);
          const issuedWeightTotal = Number(sourceRow.issuedBobbinWeight || 0);

          const availableCountForThisIssue = Math.max(0, totalCount - dispatchedCount - (issuedCountTotal - Number(oldForIssue.issuedBobbins || 0)));
          if (requestedCount > availableCountForThisIssue + TAKE_BACK_EPSILON) {
            throw new Error(`Requested bobbins exceed remaining allocation for crate ${crate.rowId}`);
          }

          const availableWeightForThisIssue = Math.max(0, totalWeight - dispatchedWeight - (issuedWeightTotal - Number(oldForIssue.issuedBobbinWeight || 0)));
          const { takingAllRemainingBobbins, issuedWeight: normalizedRequestedWeight } = resolveHoloIssuedWeight({
            requestedCount,
            availableCount: availableCountForThisIssue,
            availableWeight: availableWeightForThisIssue,
            requestedWeight: requestedWeightExact,
          });
          if (!takingAllRemainingBobbins && requestedWeightExact > availableWeightForThisIssue + TAKE_BACK_EPSILON) {
            throw new Error(`Requested weight exceeds remaining allocation for crate ${crate.rowId}`);
          }

          newMap.set(crate.rowId, {
            issuedBobbins: requestedCount,
            issuedBobbinWeight: normalizedRequestedWeight,
          });
        }

        const totalBobbins = normalizedCrates.reduce((sum, crate) => sum + (Number(crate.issuedBobbins) || 0), 0);
        const totalWeight = Array.from(newMap.values()).reduce((sum, crate) => sum + (Number(crate.issuedBobbinWeight) || 0), 0);

        const allRowIds = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));
        if (allRowIds.length > 0) {
          const rowsForUpdate = await tx.receiveFromCutterMachineRow.findMany({
            where: { id: { in: allRowIds }, isDeleted: false },
            select: { id: true },
          });
          if (rowsForUpdate.length !== allRowIds.length) {
            throw new Error('One or more referenced crates are missing');
          }
        }

        for (const rowId of allRowIds) {
          const oldVals = oldMap.get(rowId) || { issuedBobbins: 0, issuedBobbinWeight: 0 };
          const newVals = newMap.get(rowId) || { issuedBobbins: 0, issuedBobbinWeight: 0 };
          const deltaBobbins = Number(newVals.issuedBobbins || 0) - Number(oldVals.issuedBobbins || 0);
          const deltaWeight = Number(newVals.issuedBobbinWeight || 0) - Number(oldVals.issuedBobbinWeight || 0);
          if (deltaBobbins !== 0 || deltaWeight !== 0) {
            await tx.receiveFromCutterMachineRow.update({
              where: { id: rowId },
              data: {
                issuedBobbins: { increment: deltaBobbins },
                issuedBobbinWeight: { increment: deltaWeight },
                ...actorUpdateFields(actorUserId),
              },
            });
          }
        }

        const yarnKgValue = yarnKg !== undefined
          ? (Number.isFinite(Number(yarnKg)) ? Number(yarnKg) : 0)
          : issueRecord.yarnKg;

        data.itemId = itemId;
        data.lotNo = lotNo;
        data.cutId = resolvedCutId || null;
        data.twistId = resolvedTwistId;
        data.yarnId = resolvedYarnId || null;
        data.metallicBobbins = totalBobbins;
        data.metallicBobbinsWeight = totalWeight;
        data.yarnKg = yarnKgValue;
        data.receivedRowRefs = Array.from(newMap.entries()).map(([rowId, vals]) => ({
          rowId,
          issuedBobbins: Number(vals.issuedBobbins || 0),
          issuedBobbinWeight: Number(vals.issuedBobbinWeight || 0),
        }));
      }

      if (Object.keys(data).length > 0) {
        updatedIssue = await tx.issueToHoloMachine.update({
          where: { id },
          data: { ...data, ...actorUpdateFields(actorUserId) },
        });
      }
    });

    await logCrudWithActor(req, {
      entityType: 'issue_to_holo_machine',
      entityId: id,
      action: 'update',
      before: issueRecord,
      after: updatedIssue,
      payload: {
        cratesChanged: wantsCrateUpdate,
      },
    });

    res.json({ ok: true, issueToHoloMachine: updatedIssue });
  } catch (err) {
    console.error('Failed to update issue_to_holo_machine', err);
    res.status(400).json({ error: err.message || 'Failed to update issue_to_holo_machine' });
  }
});

router.put('/api/issue_to_coning_machine/:id', requireEditPermission('issue.coning'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const {
      date,
      machineId,
      operatorId,
      note,
      crates,
      receivedRowRefs,
      requiredPerConeNetWeight: reqPerConeWt,
      shift,
      coneTypeId,
      wrapperId,
      boxId,
    } = req.body || {};

    const issueRecord = await prisma.issueToConingMachine.findFirst({
      where: { id, isDeleted: false },
    });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to Coning machine record not found' });
    }

    const receiveCount = await prisma.receiveFromConingMachineRow.count({
      where: { issueId: id, isDeleted: false },
    });
    const hasReceives = receiveCount > 0;

    const cratesInput = Array.isArray(crates)
      ? crates
      : (Array.isArray(receivedRowRefs) ? receivedRowRefs : undefined);
    const wantsCrateUpdate = cratesInput !== undefined;
    const wantsMetaUpdate = coneTypeId !== undefined || wrapperId !== undefined || boxId !== undefined;
    const wantsQuantityUpdate = wantsCrateUpdate || reqPerConeWt !== undefined;
    const activeTakeBackCount = wantsQuantityUpdate
      ? await prisma.issueTakeBack.count({
        where: { stage: 'coning', issueId: id, isReverse: false, isReversed: false },
      })
      : 0;

    if (hasReceives && (wantsCrateUpdate || reqPerConeWt !== undefined)) {
      return res.status(400).json({ error: 'Cannot change issue quantities: receive records exist for this issue' });
    }
    if (wantsQuantityUpdate && activeTakeBackCount > 0) {
      return res.status(400).json({ error: 'Cannot change issue quantities while active take-backs exist' });
    }

    let updatedIssue = issueRecord;

    await prisma.$transaction(async (tx) => {
      const data = {};

      if (date !== undefined) {
        const trimmed = String(date).trim();
        if (!trimmed) throw new Error('Date is required');
        data.date = trimmed;
      }
      if (note !== undefined) data.note = note ? String(note) : null;
      if (machineId !== undefined) data.machineId = machineId || null;
      if (operatorId !== undefined) data.operatorId = operatorId || null;
      if (shift !== undefined) data.shift = shift || null;

      if (wantsCrateUpdate) {
        const requiredPerConeNetWeight = toNumber(reqPerConeWt);
        const resolvedPerCone = requiredPerConeNetWeight != null
          ? requiredPerConeNetWeight
          : Number(issueRecord.requiredPerConeNetWeight || 0);
        if (!Number.isFinite(resolvedPerCone) || resolvedPerCone <= 0) {
          throw new Error('Enter required per-cone net weight (grams)');
        }

        const normalizedCrates = cratesInput
          .map((crate) => ({
            rowId: typeof crate.rowId === 'string' ? crate.rowId.trim() : '',
            barcode: typeof crate.barcode === 'string' ? normalizeBarcodeInput(crate.barcode) : '',
            coneTypeId: typeof crate.coneTypeId === 'string' ? crate.coneTypeId : null,
            wrapperId: typeof crate.wrapperId === 'string' ? crate.wrapperId : null,
            boxId: typeof crate.boxId === 'string' ? crate.boxId : null,
            issueRolls: toNumber(crate.issueRolls),
            issueWeight: toNumber(crate.issueWeight),
          }))
          .filter((c) => c.rowId || c.barcode);

        if (normalizedCrates.length === 0) throw new Error('Invalid crate payload');

        const rowIds = normalizedCrates.map((c) => c.rowId).filter(Boolean);
        const barcodes = normalizedCrates.map((c) => c.barcode).filter(Boolean);

        const coningRows = rowIds.length
          ? await tx.receiveFromConingMachineRow.findMany({
            where: { id: { in: rowIds }, isDeleted: false },
            include: { issue: { select: { id: true, lotNo: true, itemId: true } } },
          })
          : [];

        const matchedConingRowIds = new Set(coningRows.map((row) => row.id));
        const pendingRowIds = rowIds.filter((rid) => !matchedConingRowIds.has(rid));

        const holoWhere = [];
        if (pendingRowIds.length) {
          holoWhere.push({ id: { in: pendingRowIds } });
        }
        if (barcodes.length) {
          holoWhere.push({ barcode: { in: barcodes } });
          barcodes.forEach((code) => {
            holoWhere.push({ notes: { equals: code, mode: 'insensitive' } });
          });
        }

        const holoRows = holoWhere.length
          ? await tx.receiveFromHoloMachineRow.findMany({
            where: { OR: holoWhere, isDeleted: false },
            include: { issue: { select: { id: true, lotNo: true, itemId: true, cutId: true, yarnId: true, twistId: true } } },
          })
          : [];

        const rows = [...coningRows, ...holoRows];
        if (rows.length === 0) throw new Error('One or more scanned crates were not found');

        const rowMapById = new Map(rows.map((r) => [r.id, r]));
        const rowMapByBarcode = new Map();
        const ambiguousBarcodes = new Set();
        rows.forEach((row) => {
          if (!row?.barcode) return;
          const code = normalizeBarcodeInput(row.barcode);
          if (!code) return;
          const existing = rowMapByBarcode.get(code);
          if (existing && existing.id !== row.id) {
            rowMapByBarcode.set(code, null);
            ambiguousBarcodes.add(code);
            return;
          }
          if (!existing) {
            rowMapByBarcode.set(code, row);
          }
        });

        const legacyMap = new Map();
        const ambiguousLegacy = new Set();
        holoRows.forEach((row) => {
          if (!row?.notes) return;
          const code = normalizeBarcodeInput(row.notes);
          if (!code) return;
          const existing = legacyMap.get(code);
          if (existing && existing.id !== row.id) {
            legacyMap.set(code, null);
            ambiguousLegacy.add(code);
            return;
          }
          if (!existing) {
            legacyMap.set(code, row);
          }
        });

        const legacyConflicts = normalizedCrates
          .map((crate) => crate.barcode)
          .filter((code) => code && (ambiguousBarcodes.has(code) || ambiguousLegacy.has(code)));
        if (legacyConflicts.length > 0) {
          throw new Error(`Legacy barcode matches multiple rows: ${Array.from(new Set(legacyConflicts)).join(', ')}`);
        }

        const resolvedCrates = normalizedCrates.map((crate) => {
          let found = crate.rowId ? rowMapById.get(crate.rowId) : rowMapByBarcode.get(crate.barcode);
          if (!found && crate.barcode) {
            found = legacyMap.get(crate.barcode);
          }
          return {
            ...crate,
            rowId: found?.id || crate.rowId,
            sourceIssueId: found?.issue?.id || null,
            lotNo: found?.issue?.lotNo || null,
            itemId: found?.issue?.itemId || null,
            baseRolls: typeof found?.coneCount === 'number'
              ? found.coneCount
              : (typeof found?.rollCount === 'number' ? found.rollCount : 0),
            baseWeight: typeof found?.coneWeight === 'number'
              ? found.coneWeight
              : (typeof found?.rollWeight === 'number' ? found.rollWeight : 0),
          };
        });

        if (resolvedCrates.some((c) => !c.rowId)) {
          throw new Error('One or more scanned crates were not found');
        }

        const lotSet = new Set(resolvedCrates.map((c) => c.lotNo).filter(Boolean));
        const itemSet = new Set(resolvedCrates.map((c) => c.itemId).filter(Boolean));
        if (itemSet.size !== 1) {
          throw new Error('Crates must belong to a single item');
        }
        const lotNos = Array.from(lotSet).filter(Boolean);
        if (lotNos.length === 0) {
          throw new Error('Unable to resolve lot numbers for scanned crates');
        }
        const lotNo = lotNos.length === 1 ? lotNos[0] : 'MIXED';
        const itemId = Array.from(itemSet)[0];
        const sourceIssueMap = new Map((holoRows || []).map(r => [r.issue?.id, r.issue]));
        const sourceCutIds = new Set();
        const sourceYarnIds = new Set();
        const sourceTwistIds = new Set();
        resolvedCrates.forEach((c) => {
          if (!c.sourceIssueId) return;
          const issue = sourceIssueMap.get(c.sourceIssueId);
          if (issue?.cutId) sourceCutIds.add(issue.cutId);
          if (issue?.yarnId) sourceYarnIds.add(issue.yarnId);
          if (issue?.twistId) sourceTwistIds.add(issue.twistId);
        });
        if (sourceCutIds.size > 1) {
          throw new Error('Crates must belong to a single cut');
        }
        const resolvedCutId = sourceCutIds.size === 1 ? Array.from(sourceCutIds)[0] : null;
        if (sourceYarnIds.size > 1) {
          throw new Error('Crates must belong to a single yarn');
        }
        const resolvedYarnId = sourceYarnIds.size === 1 ? Array.from(sourceYarnIds)[0] : null;
        const resolvedTwistId = sourceTwistIds.size === 1 ? Array.from(sourceTwistIds)[0] : null;

        const coneTypeIds = Array.from(new Set(resolvedCrates.map((c) => c.coneTypeId).filter(Boolean)));
        const wrapperIds = Array.from(new Set(resolvedCrates.map((c) => c.wrapperId).filter(Boolean)));
        const boxIds = Array.from(new Set(resolvedCrates.map((c) => c.boxId).filter(Boolean)));
        if (coneTypeIds.length) {
          const ctCount = await tx.coneType.count({ where: { id: { in: coneTypeIds } } });
          if (ctCount !== coneTypeIds.length) throw new Error('One or more cone types not found');
        }
        if (coneTypeIds.length > 1) {
          throw new Error('Crates must use a single cone type for coning issues');
        }
        if (wrapperIds.length) {
          const wCount = await tx.wrapper.count({ where: { id: { in: wrapperIds } } });
          if (wCount !== wrapperIds.length) throw new Error('One or more wrappers not found');
        }
        if (boxIds.length) {
          const bCount = await tx.box.count({ where: { id: { in: boxIds } } });
          if (bCount !== boxIds.length) throw new Error('One or more boxes not found');
        }

        if (resolvedCrates.some((c) => !Number.isFinite(c.issueRolls) || c.issueRolls <= 0)) {
          throw new Error('Enter issue rolls for each crate');
        }

        const preparedCrates = resolvedCrates.map((c) => {
          const baseRolls = Number(c.baseRolls) || 0;
          const baseWeight = Number(c.baseWeight) || 0;
          const perRoll = baseRolls > 0 && Number.isFinite(baseWeight) ? baseWeight / baseRolls : 0;
          const rolls = Number(c.issueRolls) || 0;
          const providedWeight = Number(c.issueWeight);
          const issueWeight = Number.isFinite(providedWeight) && providedWeight > 0
            ? providedWeight
            : Number((perRoll * rolls).toFixed(3));
          return {
            rowId: c.rowId,
            barcode: c.barcode,
            lotNo: c.lotNo,
            itemId: c.itemId,
            coneTypeId: c.coneTypeId,
            wrapperId: c.wrapperId,
            boxId: c.boxId,
            issueRolls: rolls,
            issueWeight,
            baseRolls,
            baseWeight,
          };
        });

        if (preparedCrates.some((c) => !Number.isFinite(c.issueWeight) || c.issueWeight <= 0)) {
          throw new Error('Issue weight missing for one or more crates');
        }

        const rowIdsToCheck = preparedCrates.map((c) => c.rowId).filter(Boolean);
        const barcodesToCheck = preparedCrates.map((c) => c.barcode).filter(Boolean);
        let existingRowRefs = [];

        if (rowIdsToCheck.length || barcodesToCheck.length) {
          const rowIdArray = rowIdsToCheck.length ? rowIdsToCheck : ['__none__'];
          const barcodeArray = barcodesToCheck.length ? barcodesToCheck : ['__none__'];
          existingRowRefs = await tx.$queryRaw`
            SELECT id, "receivedRowRefs"
            FROM "IssueToConingMachine"
            WHERE "isDeleted" = false
              AND id <> ${id}
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
                WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
                   OR elem->>'barcode' = ANY (${barcodeArray}::text[])
              )
          `;
        }
        const coningTakeBackLines = rowIdsToCheck.length > 0
          ? await tx.issueTakeBackLine.findMany({
            where: {
              sourceId: { in: rowIdsToCheck },
              takeBack: { stage: 'coning' },
            },
            select: {
              sourceId: true,
              count: true,
              weight: true,
              takeBack: { select: { isReverse: true } },
            },
          })
          : [];

        const previouslyIssuedByRowId = new Map();
        const previouslyIssuedWeightByRowId = new Map();
        for (const issue of existingRowRefs) {
          const refs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
          for (const ref of refs) {
            const rid = ref?.rowId || (ref?.barcode ? normalizeBarcodeInput(ref.barcode) : null);
            if (!rid) continue;
            const already = previouslyIssuedByRowId.get(rid) || 0;
            previouslyIssuedByRowId.set(rid, already + (Number(ref.issueRolls) || 0));
            const weightAlready = previouslyIssuedWeightByRowId.get(rid) || 0;
            previouslyIssuedWeightByRowId.set(rid, weightAlready + (Number(ref.issueWeight) || 0));
          }
        }
        coningTakeBackLines.forEach((line) => {
          const rid = line.sourceId;
          if (!rid) return;
          const sign = line.takeBack?.isReverse ? 1 : -1;
          const existingCount = previouslyIssuedByRowId.get(rid) || 0;
          const existingWeight = previouslyIssuedWeightByRowId.get(rid) || 0;
          previouslyIssuedByRowId.set(rid, Math.max(0, existingCount + (sign * Number(line.count || 0))));
          previouslyIssuedWeightByRowId.set(rid, Math.max(0, existingWeight + (sign * Number(line.weight || 0))));
        });

        const issueTracker = new Map();
        const issueWeightTracker = new Map();
        const overIssuedCrates = [];
        for (const crate of preparedCrates) {
          const rid = crate.rowId || (crate.barcode ? normalizeBarcodeInput(crate.barcode) : null);
          if (!rid) continue;
          const baseRolls = Number(crate.baseRolls) || 0;
          const baseWeight = Number(crate.baseWeight) || 0;
          const existingIssued = previouslyIssuedByRowId.get(rid) || 0;
          const existingIssuedWeight = previouslyIssuedWeightByRowId.get(rid) || 0;
          const alreadyPlanned = issueTracker.get(rid) || 0;
          const alreadyPlannedWeight = issueWeightTracker.get(rid) || 0;
          const totalAfterRequest = existingIssued + alreadyPlanned + (Number(crate.issueRolls) || 0);
          const totalWeightAfter = existingIssuedWeight + alreadyPlannedWeight + (Number(crate.issueWeight) || 0);

          const exceedsRolls = baseRolls > 0 && totalAfterRequest > baseRolls;
          const exceedsWeight = baseWeight > 0 && totalWeightAfter > baseWeight + 1e-6;
          if (exceedsRolls || exceedsWeight) {
            overIssuedCrates.push({
              rowId: rid,
              barcode: crate.barcode,
              requestedRolls: crate.issueRolls,
              availableRolls: Math.max(baseRolls - existingIssued - alreadyPlanned, 0),
              requestedWeight: roundTo3Decimals(crate.issueWeight),
              availableWeight: roundTo3Decimals(Math.max(baseWeight - existingIssuedWeight - alreadyPlannedWeight, 0)),
            });
          }

          issueTracker.set(rid, alreadyPlanned + (Number(crate.issueRolls) || 0));
          issueWeightTracker.set(rid, alreadyPlannedWeight + (Number(crate.issueWeight) || 0));
        }

        if (overIssuedCrates.length) {
          throw new Error('One or more crates have already been fully issued');
        }

        const totalRolls = preparedCrates.reduce((sum, c) => sum + (Number(c.issueRolls) || 0), 0);
        const totalIssueWeightKg = preparedCrates.reduce((sum, c) => sum + (Number(c.issueWeight) || 0), 0);
        const expectedCones = resolvedPerCone > 0
          ? Math.floor((totalIssueWeightKg * 1000) / resolvedPerCone)
          : 0;

        data.itemId = itemId;
        data.lotNo = lotNo;
        // Keep parent issue metadata aligned with the selected source crates.
        data.cutId = resolvedCutId || null;
        data.yarnId = resolvedYarnId || null;
        data.twistId = resolvedTwistId || null;
        data.rollsIssued = Number(totalRolls || 0);
        data.requiredPerConeNetWeight = resolvedPerCone;
        data.expectedCones = expectedCones;
        data.receivedRowRefs = preparedCrates;
      } else if (!hasReceives && reqPerConeWt !== undefined) {
        const requiredPerConeNetWeight = toNumber(reqPerConeWt);
        if (!Number.isFinite(requiredPerConeNetWeight) || requiredPerConeNetWeight <= 0) {
          throw new Error('Enter required per-cone net weight (grams)');
        }
        const refsRaw = issueRecord.receivedRowRefs;
        let refs = Array.isArray(refsRaw) ? refsRaw : [];
        if (typeof refsRaw === 'string') {
          try { refs = JSON.parse(refsRaw || '[]'); } catch (_) { refs = []; }
        }
        const totalRolls = refs.reduce((sum, r) => sum + (Number(r.issueRolls) || 0), 0);
        const totalIssueWeightKg = refs.reduce((sum, r) => sum + (Number(r.issueWeight) || 0), 0);
        const expectedCones = Math.floor((totalIssueWeightKg * 1000) / requiredPerConeNetWeight);
        data.rollsIssued = Number(totalRolls || 0);
        data.requiredPerConeNetWeight = requiredPerConeNetWeight;
        data.expectedCones = expectedCones;
      }

      if (!hasReceives && !wantsCrateUpdate && wantsMetaUpdate) {
        const refsRaw = issueRecord.receivedRowRefs;
        let refs = Array.isArray(refsRaw) ? refsRaw : [];
        if (typeof refsRaw === 'string') {
          try { refs = JSON.parse(refsRaw || '[]'); } catch (_) { refs = []; }
        }
        if (refs.length > 0) {
          const nextRefs = refs.map((ref) => ({
            ...ref,
            ...(coneTypeId !== undefined ? { coneTypeId: coneTypeId || null } : {}),
            ...(wrapperId !== undefined ? { wrapperId: wrapperId || null } : {}),
            ...(boxId !== undefined ? { boxId: boxId || null } : {}),
          }));
          data.receivedRowRefs = nextRefs;
        }
      }

      if (Object.keys(data).length > 0) {
        updatedIssue = await tx.issueToConingMachine.update({
          where: { id },
          data: { ...data, ...actorUpdateFields(actorUserId) },
        });
      }
    });

    await logCrudWithActor(req, {
      entityType: 'issue_to_coning_machine',
      entityId: id,
      action: 'update',
      before: issueRecord,
      after: updatedIssue,
      payload: {
        cratesChanged: wantsCrateUpdate,
      },
    });

    res.json({ ok: true, issueToConingMachine: updatedIssue });
  } catch (err) {
    console.error('Failed to update issue_to_coning_machine', err);
    res.status(400).json({ error: err.message || 'Failed to update issue_to_coning_machine' });
  }
});

router.delete('/api/issue_to_cutter_machine/:id', requireDeletePermission('issue.cutter'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;

    // Find the issue_to_cutter_machine record
    const issueRecord = await prisma.issueToCutterMachine.findFirst({
      where: { id, isDeleted: false },
    });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to machine record not found' });
    }

    const hasTakeBack = await prisma.issueTakeBack.count({
      where: { stage: 'cutter', issueId: id, isReverse: false },
    });
    if (hasTakeBack > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: take-back records exist for this issue' });
    }

    const issueLines = await prisma.issueToCutterMachineLine.findMany({
      where: { issueId: id },
      select: { pieceId: true, issuedWeight: true },
    });
    const cleanPieceIds = Array.from(new Set(issueLines.map((line) => line.pieceId).filter(Boolean)));
    const receiveCount = await prisma.receiveFromCutterMachineRow.count({
      where: {
        isDeleted: false,
        OR: [
          { issueId: id },
          ...(cleanPieceIds.length > 0 ? [{ issueId: null, pieceId: { in: cleanPieceIds }, createdAt: { gte: issueRecord.createdAt } }] : []),
        ],
      },
    });
    if (receiveCount > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: receive records exist for this issue' });
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Soft delete the issue_to_cutter_machine record
      await tx.issueToCutterMachine.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      if (issueLines.length > 0) {
        await applyCutterTakeBackReturn(
          tx,
          issueLines.map((line) => ({ sourceId: line.pieceId, weight: Number(line.issuedWeight || 0) })),
          actorUserId,
          -1,
        );
      }

      await logCrudWithActor(req, {
        entityType: 'issue_to_cutter_machine',
        entityId: id,
        action: 'delete',
        payload: {
          issue: issueRecord,
          restoredPieceIds: cleanPieceIds,
        },
        client: tx,
      });
    });

    res.json({ ok: true });
    // Notify issue_to_cutter_machine deleted
    try {
      const itemName = issueRecord.itemId ? (await prisma.item.findUnique({ where: { id: issueRecord.itemId } })).name : '';
      // include machine/operator info if available
      const machineRec = issueRecord.machineId ? await prisma.machine.findUnique({ where: { id: issueRecord.machineId } }) : null;
      const operatorRec = issueRecord.operatorId ? await prisma.operator.findUnique({ where: { id: issueRecord.operatorId } }) : null;
      const machineNameDel = machineRec ? machineRec.name : '';
      const operatorNameDel = operatorRec ? operatorRec.name : '';
      const machineNumberDel = machineNameDel || '';
      sendNotification('issue_to_cutter_machine_deleted', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, pieceIds: cleanPieceIds, machineName: machineNameDel, machineNumber: machineNumberDel, operatorName: operatorNameDel, createdByUserId: issueRecord.createdByUserId || null });
    } catch (e) { console.error('notify issue_to_cutter_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_cutter_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_cutter_machine record' });
  }
});

// Delete an issue_to_holo_machine record (safe delete)
router.delete('/api/issue_to_holo_machine/:id', requireDeletePermission('issue.holo'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;

    // Find the issue record
    const issueRecord = await prisma.issueToHoloMachine.findFirst({
      where: { id, isDeleted: false },
    });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to Holo machine record not found' });
    }

    const hasTakeBack = await prisma.issueTakeBack.count({
      where: { stage: 'holo', issueId: id, isReverse: false },
    });
    if (hasTakeBack > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: take-back records exist for this issue' });
    }

    // Check if any receives exist for this issue
    const receiveCount = await prisma.receiveFromHoloMachineRow.count({ where: { issueId: id, isDeleted: false } });
    if (receiveCount > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: receive records exist for this issue' });
    }

    // Parse receivedRowRefs to get source cutter rows that need reversal
    let refs = [];
    try {
      refs = typeof issueRecord.receivedRowRefs === 'string'
        ? JSON.parse(issueRecord.receivedRowRefs)
        : issueRecord.receivedRowRefs;
      if (!Array.isArray(refs)) refs = [];
    } catch (e) {
      refs = [];
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Revert bobbin counts on source cutter receive rows
      for (const ref of refs) {
        if (!ref.rowId) continue;
        const bobbinsToRevert = Number(ref.issuedBobbins || 0);
        const weightToRevert = Number(ref.issuedBobbinWeight || 0);
        if (bobbinsToRevert > 0 || weightToRevert > 0) {
          await tx.receiveFromCutterMachineRow.update({
            where: { id: ref.rowId },
            data: {
              issuedBobbins: { decrement: bobbinsToRevert },
              issuedBobbinWeight: { decrement: weightToRevert },
              ...actorUpdateFields(actorUserId),
            },
          });
        }
      }

      // Soft delete the issue record
      await tx.issueToHoloMachine.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      await logCrudWithActor(req, {
        entityType: 'issue_to_holo_machine',
        entityId: id,
        action: 'delete',
        payload: {
          issue: issueRecord,
          revertedRefs: refs,
        },
        client: tx,
      });
    });

    res.json({ ok: true });
    // Notify issue_to_holo_machine deleted
    try {
      const itemName = issueRecord.itemId ? (await prisma.item.findUnique({ where: { id: issueRecord.itemId } }))?.name : '';
      const machineRec = issueRecord.machineId ? await prisma.machine.findUnique({ where: { id: issueRecord.machineId } }) : null;
      const operatorRec = issueRecord.operatorId ? await prisma.operator.findUnique({ where: { id: issueRecord.operatorId } }) : null;
      sendNotification('issue_to_holo_machine_deleted', {
        itemName,
        lotNo: issueRecord.lotNo,
        date: issueRecord.date,
        metallicBobbins: issueRecord.metallicBobbins,
        metallicBobbinsWeight: issueRecord.metallicBobbinsWeight,
        machineName: machineRec?.name || '',
        operatorName: operatorRec?.name || '',
        createdByUserId: issueRecord.createdByUserId || null,
      });
    } catch (e) { console.error('notify issue_to_holo_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_holo_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_holo_machine record' });
  }
});

// Delete an issue_to_coning_machine record (safe delete)
router.delete('/api/issue_to_coning_machine/:id', requireDeletePermission('issue.coning'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;

    // Find the issue record
    const issueRecord = await prisma.issueToConingMachine.findFirst({
      where: { id, isDeleted: false },
    });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to Coning machine record not found' });
    }

    const hasTakeBack = await prisma.issueTakeBack.count({
      where: { stage: 'coning', issueId: id, isReverse: false },
    });
    if (hasTakeBack > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: take-back records exist for this issue' });
    }

    // Check if any receives exist for this issue
    const receiveCount = await prisma.receiveFromConingMachineRow.count({ where: { issueId: id, isDeleted: false } });
    if (receiveCount > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: receive records exist for this issue' });
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Soft delete the issue record (no source row updates needed for coning)
      await tx.issueToConingMachine.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: actorUserId || null,
          ...actorUpdateFields(actorUserId),
        },
      });

      await logCrudWithActor(req, {
        entityType: 'issue_to_coning_machine',
        entityId: id,
        action: 'delete',
        payload: {
          issue: issueRecord,
        },
        client: tx,
      });
    });

    res.json({ ok: true });
    // Notify issue_to_coning_machine deleted
    try {
      const itemName = issueRecord.itemId ? (await prisma.item.findUnique({ where: { id: issueRecord.itemId } }))?.name : '';
      const machineRec = issueRecord.machineId ? await prisma.machine.findUnique({ where: { id: issueRecord.machineId } }) : null;
      const operatorRec = issueRecord.operatorId ? await prisma.operator.findUnique({ where: { id: issueRecord.operatorId } }) : null;
      sendNotification('issue_to_coning_machine_deleted', {
        itemName,
        lotNo: issueRecord.lotNo,
        date: issueRecord.date,
        rollsIssued: issueRecord.rollsIssued,
        machineName: machineRec?.name || '',
        operatorName: operatorRec?.name || '',
        createdByUserId: issueRecord.createdByUserId || null,
      });
    } catch (e) { console.error('notify issue_to_coning_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_coning_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_coning_machine record' });
  }
});

// Delete a single inbound item (piece)
router.delete('/api/inbound_items/:id', requireDeletePermission('inbound'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const existing = await prisma.inboundItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Inbound piece not found' });
    const isConsumed = existing.status === 'consumed';
    if (isConsumed && !existing.isOpeningStock) {
      return res.status(400).json({ error: 'Cannot delete consumed piece' });
    }

    const dispatchedWeight = Number(existing.dispatchedWeight || 0);
    if (dispatchedWeight > 0) {
      return res.status(400).json({ error: 'Cannot delete piece with dispatched weight' });
    }

    const issuedCount = await prisma.issueToCutterMachineLine.count({
      where: {
        pieceId: existing.id,
        issue: { isDeleted: false },
      },
    });
    if (issuedCount > 0) {
      return res.status(400).json({ error: 'Cannot delete piece that was issued to cutter' });
    }

    const receiveCount = await prisma.receiveFromCutterMachineRow.count({
      where: { pieceId: existing.id, isDeleted: false },
    });
    if (receiveCount > 0) {
      return res.status(400).json({ error: 'Cannot delete piece with cutter receives' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.inboundItem.delete({ where: { id } });
      // Recalculate lot totals
      const agg = await tx.inboundItem.aggregate({ where: { lotNo: existing.lotNo }, _sum: { weight: true }, _count: { id: true } });
      const totalWeight = Number(agg._sum.weight || 0);
      const totalPieces = Number(agg._count.id || 0);
      await tx.lot.update({ where: { lotNo: existing.lotNo }, data: { totalWeight, totalPieces, ...actorUpdateFields(actorUserId) } });

      await logCrudWithActor(req, {
        entityType: 'inbound_item',
        entityId: id,
        action: 'delete',
        payload: {
          lotNo: existing.lotNo,
          itemId: existing.itemId,
          weight: existing.weight,
          totalWeight,
          totalPieces,
        },
        client: tx,
      });
    });

    res.json({ ok: true });
    // Notify inbound piece deleted
    try {
      const itemName = existing.itemId ? (await prisma.item.findUnique({ where: { id: existing.itemId } })).name : '';
      sendNotification('inbound_piece_deleted', { itemName, lotNo: existing.lotNo, pieceId: existing.id, createdByUserId: existing.createdByUserId || null });
      // If deleting this piece caused available count to become zero, notify
      try {
        const availableAfter = await prisma.inboundItem.count({ where: { itemId: existing.itemId, status: 'available' } });
        console.log(`Available pieces after inbound piece delete for ${itemName}: ${availableAfter}`);
        if (availableAfter === 0) {
          console.log(`Triggering out_of_stock notification for ${itemName}`);
          // Add small delay to ensure first message is queued before second
          setTimeout(() => {
            sendNotification('item_out_of_stock', { itemName, available: 0 });
          }, 1000);
        }
      } catch (e) { console.error('failed to check/send out_of_stock after inbound piece delete', e); }
    } catch (e) { console.error('notify inbound piece deleted error', e); }
  } catch (err) {
    console.error('Failed to delete inbound piece', err);
    res.status(500).json({ error: err.message || 'Failed to delete inbound piece' });
  }
});

router.put('/api/settings', requireEditPermission('settings'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const body = req.body || {};
    const brandPrimary = body.brandPrimary ?? body.primary;
    const brandGold = body.brandGold ?? body.gold;
    const {
      logoDataUrl,
      faviconDataUrl,
      whatsappEnabled,
      whatsappNumber,
      whatsappGroupIds,
      telegramEnabled,
      telegramBotToken,
      telegramChatIds,
      backupTime,
      challanFromName,
      challanFromAddress,
      challanFromMobile,
      challanFieldsConfig
    } = body;
    const hasBrandPrimary = Object.prototype.hasOwnProperty.call(body, 'brandPrimary') || Object.prototype.hasOwnProperty.call(body, 'primary');
    const hasBrandGold = Object.prototype.hasOwnProperty.call(body, 'brandGold') || Object.prototype.hasOwnProperty.call(body, 'gold');
    const hasLogoDataUrl = Object.prototype.hasOwnProperty.call(body, 'logoDataUrl');
    const hasFaviconDataUrl = Object.prototype.hasOwnProperty.call(body, 'faviconDataUrl');
    const hasWhatsAppEnabled = Object.prototype.hasOwnProperty.call(body, 'whatsappEnabled');
    const hasWhatsAppNumber = Object.prototype.hasOwnProperty.call(body, 'whatsappNumber');
    const hasWhatsAppGroupIds = Object.prototype.hasOwnProperty.call(body, 'whatsappGroupIds');
    const hasTelegramEnabled = Object.prototype.hasOwnProperty.call(body, 'telegramEnabled');
    const hasTelegramBotToken = Object.prototype.hasOwnProperty.call(body, 'telegramBotToken');
    const hasTelegramChatIds = Object.prototype.hasOwnProperty.call(body, 'telegramChatIds');
    const hasBackupTime = Object.prototype.hasOwnProperty.call(body, 'backupTime');
    const hasChallanFromName = Object.prototype.hasOwnProperty.call(body, 'challanFromName');
    const hasChallanFromAddress = Object.prototype.hasOwnProperty.call(body, 'challanFromAddress');
    const hasChallanFromMobile = Object.prototype.hasOwnProperty.call(body, 'challanFromMobile');
    const hasChallanFieldsConfig = Object.prototype.hasOwnProperty.call(body, 'challanFieldsConfig');
    const previousSettings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (hasBackupTime && !req.user?.isAdmin) {
      return res.status(403).json({ error: 'forbidden' });
    }
    // Normalize incoming whatsappNumber: accept 10-digit numbers without country code
    function normalizeForStore(num) {
      if (!num) return null;
      const digits = String(num).replace(/[^0-9]/g, '');
      if (!digits) return null;
      let d = digits.replace(/^0+/, '');
      if (d.length === 10) d = `91${d}`;
      return d;
    }
    const normalizedWhatsAppNumber = normalizeForStore(whatsappNumber);
    const cleanGroupIds = Array.isArray(whatsappGroupIds) ? whatsappGroupIds.filter(x => typeof x === 'string') : undefined;
    const cleanTelegramChatIds = hasTelegramChatIds
      ? parseTelegramChatIds(telegramChatIds)
      : undefined;
    let normalizedTelegramToken = hasTelegramBotToken
      ? String(telegramBotToken || '').trim()
      : undefined;
    if (normalizedTelegramToken === '********') {
      normalizedTelegramToken = undefined;
    }
    const effectiveTelegramEnabled = hasTelegramEnabled
      ? !!telegramEnabled
      : !!previousSettings?.telegramEnabled;
    const effectiveTelegramToken = (hasTelegramBotToken && normalizedTelegramToken !== undefined)
      ? normalizedTelegramToken
      : String(previousSettings?.telegramBotToken || '').trim();
    if (effectiveTelegramEnabled && !effectiveTelegramToken) {
      return res.status(400).json({ error: 'Telegram bot token is required when Telegram is enabled' });
    }
    const normalizedBackupTime = hasBackupTime ? normalizeBackupTime(backupTime) : null;
    if (hasBackupTime && !normalizedBackupTime) {
      return res.status(400).json({ error: 'backupTime must be in HH:mm format (00:00-23:59)' });
    }
    // Try to upsert including whatsappNumber if DB supports it, otherwise fallback without it
    try {
      const updateData = {
        ...actorUpdateFields(actorUserId),
      };
      if (hasBrandPrimary) updateData.brandPrimary = brandPrimary || '#2E4CA6';
      if (hasBrandGold) updateData.brandGold = brandGold || '#D4AF37';
      if (hasLogoDataUrl) updateData.logoDataUrl = logoDataUrl || null;
      if (hasFaviconDataUrl) updateData.faviconDataUrl = faviconDataUrl || null;
      if (hasWhatsAppEnabled) updateData.whatsappEnabled = !!whatsappEnabled;
      if (hasWhatsAppNumber) updateData.whatsappNumber = normalizedWhatsAppNumber || null;
      if (hasWhatsAppGroupIds && cleanGroupIds !== undefined) updateData.whatsappGroupIds = cleanGroupIds;
      if (hasTelegramEnabled) updateData.telegramEnabled = !!telegramEnabled;
      if (hasTelegramBotToken && normalizedTelegramToken !== undefined) updateData.telegramBotToken = normalizedTelegramToken || null;
      if (hasTelegramChatIds && cleanTelegramChatIds !== undefined) updateData.telegramChatIds = cleanTelegramChatIds;
      if (hasBackupTime) updateData.backupTime = normalizedBackupTime;
      if (hasChallanFromName) updateData.challanFromName = challanFromName || null;
      if (hasChallanFromAddress) updateData.challanFromAddress = challanFromAddress || null;
      if (hasChallanFromMobile) updateData.challanFromMobile = challanFromMobile || null;
      if (hasChallanFieldsConfig) updateData.challanFieldsConfig = challanFieldsConfig || {};

      const createData = {
        id: 1,
        brandPrimary: hasBrandPrimary ? (brandPrimary || '#2E4CA6') : '#2E4CA6',
        brandGold: hasBrandGold ? (brandGold || '#D4AF37') : '#D4AF37',
        logoDataUrl: hasLogoDataUrl ? (logoDataUrl || null) : null,
        ...actorCreateFields(actorUserId),
      };
      createData.whatsappEnabled = hasWhatsAppEnabled ? !!whatsappEnabled : true;
      if (hasFaviconDataUrl) createData.faviconDataUrl = faviconDataUrl || null;
      if (hasWhatsAppNumber) createData.whatsappNumber = normalizedWhatsAppNumber || null;
      if (hasWhatsAppGroupIds) createData.whatsappGroupIds = cleanGroupIds || [];
      createData.telegramEnabled = hasTelegramEnabled ? !!telegramEnabled : false;
      if (hasTelegramBotToken && normalizedTelegramToken !== undefined) createData.telegramBotToken = normalizedTelegramToken || null;
      if (hasTelegramChatIds) createData.telegramChatIds = cleanTelegramChatIds || [];
      createData.backupTime = hasBackupTime ? normalizedBackupTime : '03:00';
      createData.challanFromName = hasChallanFromName ? (challanFromName || null) : null;
      createData.challanFromAddress = hasChallanFromAddress ? (challanFromAddress || null) : null;
      createData.challanFromMobile = hasChallanFromMobile ? (challanFromMobile || null) : null;
      createData.challanFieldsConfig = hasChallanFieldsConfig ? (challanFieldsConfig || {}) : {};

      const settings = await prisma.settings.upsert({
        where: { id: 1 },
        update: updateData,
        create: createData,
      });
      if (hasBackupTime) {
        try {
          await updateBackupScheduleTime(normalizedBackupTime);
        } catch (scheduleErr) {
          console.error('Failed to update backup scheduler', scheduleErr);
          return res.status(500).json({ error: 'Failed to update backup scheduler' });
        }
      }
      await logCrudWithActor(req, {
        entityType: 'settings',
        entityId: '1',
        action: 'update',
        before: sanitizeSettingsForResponse(previousSettings),
        after: sanitizeSettingsForResponse(settings),
        payload: sanitizeSettingsForResponse(settings),
      });
      return res.json(sanitizeSettingsForResponse(settings));
    } catch (innerErr) {
      // Fallback: column may not exist yet (migration not applied). Persist without whatsappNumber
      console.warn('Failed to upsert with whatsappNumber, retrying without it:', innerErr.message || innerErr);
      const fallbackUpdate = { ...actorUpdateFields(actorUserId) };
      if (hasBrandPrimary) fallbackUpdate.brandPrimary = brandPrimary || '#2E4CA6';
      if (hasBrandGold) fallbackUpdate.brandGold = brandGold || '#D4AF37';
      if (hasLogoDataUrl) fallbackUpdate.logoDataUrl = logoDataUrl || null;
      if (hasFaviconDataUrl) fallbackUpdate.faviconDataUrl = faviconDataUrl || null;
      if (hasChallanFromName) fallbackUpdate.challanFromName = challanFromName || null;
      if (hasChallanFromAddress) fallbackUpdate.challanFromAddress = challanFromAddress || null;
      if (hasChallanFromMobile) fallbackUpdate.challanFromMobile = challanFromMobile || null;
      if (hasChallanFieldsConfig) fallbackUpdate.challanFieldsConfig = challanFieldsConfig || {};

      const fallbackCreate = {
        id: 1,
        brandPrimary: hasBrandPrimary ? (brandPrimary || '#2E4CA6') : '#2E4CA6',
        brandGold: hasBrandGold ? (brandGold || '#D4AF37') : '#D4AF37',
        logoDataUrl: hasLogoDataUrl ? (logoDataUrl || null) : null,
        ...actorCreateFields(actorUserId),
      };
      if (hasFaviconDataUrl) fallbackCreate.faviconDataUrl = faviconDataUrl || null;
      fallbackCreate.challanFromName = hasChallanFromName ? (challanFromName || null) : null;
      fallbackCreate.challanFromAddress = hasChallanFromAddress ? (challanFromAddress || null) : null;
      fallbackCreate.challanFromMobile = hasChallanFromMobile ? (challanFromMobile || null) : null;
      fallbackCreate.challanFieldsConfig = hasChallanFieldsConfig ? (challanFieldsConfig || {}) : {};

      const settings = await prisma.settings.upsert({
        where: { id: 1 },
        update: fallbackUpdate,
        create: fallbackCreate,
      });
      await logCrudWithActor(req, {
        entityType: 'settings',
        entityId: '1',
        action: 'update',
        before: sanitizeSettingsForResponse(previousSettings),
        after: sanitizeSettingsForResponse(settings),
        payload: sanitizeSettingsForResponse(settings),
      });
      return res.json(sanitizeSettingsForResponse(settings));
    }
  } catch (err) {
    console.error('Failed to update settings', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Update a single inbound piece (seq, weight)
router.put('/api/inbound_items/:id', requireEditPermission('inbound'), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { seq, weight } = req.body;
    if (seq !== undefined && (!Number.isInteger(seq) || seq < 1)) return res.status(400).json({ error: 'seq must be a positive integer' });
    if (weight !== undefined && (!Number.isFinite(Number(weight)) || Number(weight) <= 0)) return res.status(400).json({ error: 'weight must be a positive number' });

    let beforeInbound = null;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.inboundItem.findUnique({ where: { id } });
      if (!existing) throw new Error('Inbound piece not found');
      beforeInbound = existing;

      const updated = await tx.inboundItem.update({
        where: { id },
        data: {
          ...(seq !== undefined ? { seq } : {}),
          ...(weight !== undefined ? { weight: Number(weight) } : {}),
          ...actorUpdateFields(actorUserId),
        },
      });

      // Recalculate lot totals (totalPieces and totalWeight) based on current inbound items for the lot
      const lotNo = updated.lotNo;
      const agg = await tx.inboundItem.aggregate({ where: { lotNo }, _sum: { weight: true }, _count: { id: true } });
      const totalWeight = Number(agg._sum.weight || 0);
      const totalPieces = Number(agg._count.id || 0);
      await tx.lot.update({ where: { lotNo }, data: { totalWeight, totalPieces, ...actorUpdateFields(actorUserId) } });

      return updated;
    });

    const payload = {};
    if (seq !== undefined) payload.seq = seq;
    if (weight !== undefined) payload.weight = weight;
    await logCrudWithActor(req, {
      entityType: 'inbound_item',
      entityId: id,
      action: 'update',
      before: beforeInbound,
      after: result,
      payload: Object.keys(payload).length ? payload : undefined,
    });

    res.json({ ok: true, inboundItem: result });
  } catch (err) {
    console.error('Failed to update inbound item', err);
    res.status(400).json({ error: err.message || 'Failed to update inbound item' });
  }
});

// Delete a lot and its inbound items and issue-to-machine records
router.delete('/api/lots/:lotNo', requireDeletePermission('inbound'), async (req, res) => {
  try {
    const { lotNo } = req.params;
    // Do not allow delete if any issue_to_cutter_machine record exists for this lot
    const consCount = await prisma.issueToCutterMachine.count({ where: { lotNo, isDeleted: false } });
    if (consCount > 0) {
      return res.status(400).json({ error: 'Cannot delete lot: one or more pieces have been issued' });
    }
    // Gather info for notification before deletion
    const lotRec = await prisma.lot.findUnique({ where: { lotNo } });
    const itemRec = lotRec ? await prisma.item.findUnique({ where: { id: lotRec.itemId } }) : null;
    const totalPieces = lotRec ? Number(lotRec.totalPieces || 0) : 0;

    await prisma.$transaction(async (tx) => {
      await tx.inboundItem.deleteMany({ where: { lotNo } });
      await tx.lot.deleteMany({ where: { lotNo } });
      await logCrudWithActor(req, {
        entityType: 'lot',
        entityId: lotRec ? lotRec.id : null,
        action: 'delete',
        payload: {
          lotNo,
          itemId: lotRec ? lotRec.itemId : null,
          totalPieces,
          totalWeight: lotRec ? lotRec.totalWeight : null,
        },
        client: tx,
      });
    });

    res.json({ ok: true });

    // Notify lot deletion
    try {
      sendNotification('lot_deleted', { itemName: itemRec ? itemRec.name : '', lotNo, totalPieces, date: lotRec ? lotRec.date : '', createdByUserId: lotRec?.createdByUserId || null });
      // After removing the lot's pieces, if item has zero available pieces now, notify
      try {
        const itemIdentifier = lotRec ? lotRec.itemId : null;
        const itemNameForCheck = itemRec ? itemRec.name : (lotRec ? (await prisma.item.findUnique({ where: { id: lotRec.itemId } })).name : '');
        if (itemIdentifier) {
          const availableAfter = await prisma.inboundItem.count({ where: { itemId: itemIdentifier, status: 'available' } });
          console.log(`Available pieces after lot delete for ${itemNameForCheck}: ${availableAfter}`);
          if (availableAfter === 0) {
            console.log(`Triggering out_of_stock notification for ${itemNameForCheck}`);
            // Add small delay to ensure first message is queued before second
            setTimeout(() => {
              sendNotification('item_out_of_stock', { itemName: itemNameForCheck || '', available: 0 });
            }, 1000);
          }
        }
      } catch (e) { console.error('failed to check/send out_of_stock after lot delete', e); }
    } catch (e) { console.error('notify lot deleted error', e); }
  } catch (err) {
    console.error('Failed to delete lot', err);
    res.status(500).json({ error: err.message || 'Failed to delete lot' });
  }
});

// ===== Google Drive Backup (admin only) =====

router.get('/api/google-drive/status', requireRole('admin'), async (req, res) => {
  try {
    const status = await getGoogleDriveStatus();
    res.json(status);
  } catch (err) {
    console.error('Failed to fetch Google Drive status', err);
    res.status(500).json({ error: 'Failed to fetch Google Drive status' });
  }
});

router.post('/api/google-drive/connect', requireRole('admin'), async (req, res) => {
  try {
    const { authUrl } = createGoogleDriveAuthUrl();
    res.json({ authUrl });
  } catch (err) {
    console.error('Failed to create Google Drive auth url', err);
    res.status(500).json({ error: err.message || 'Failed to connect Google Drive' });
  }
});

router.post('/api/google-drive/disconnect', requireRole('admin'), async (req, res) => {
  try {
    await disconnectGoogleDrive();
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to disconnect Google Drive', err);
    res.status(500).json({ error: 'Failed to disconnect Google Drive' });
  }
});

router.get('/api/google-drive/files', requireRole('admin'), async (req, res) => {
  try {
    const result = await listDriveBackups();
    res.json(result);
  } catch (err) {
    console.error('Failed to list Google Drive backups', err);
    res.status(500).json({ error: 'Failed to list Google Drive backups' });
  }
});

// ===== Backup Management =====

// List all available backups (all authenticated users can view)
router.get('/api/backups', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const backups = listBackups();
    res.json({ backups });
  } catch (err) {
    console.error('Failed to list backups', err);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Create a manual backup (admin only)
router.post('/api/backups', requireRole('admin'), async (req, res) => {
  try {
    const actor = getActor(req);
    const result = await createBackup('manual');
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Backup failed' });
    }

    await logCrud({
      entityType: 'backup',
      entityId: result.filename,
      action: 'create',
      payload: { filename: result.filename, size: result.size, type: 'manual' },
      actorUserId: actor?.userId,
      actorUsername: actor?.username,
      actorRoleKey: actor?.roleKey,
    });

    res.json({ backup: result });
  } catch (err) {
    console.error('Failed to create backup', err);
    res.status(500).json({ error: err.message || 'Failed to create backup' });
  }
});

// Download a backup file (admin only)
router.get('/api/backups/:filename/download', requireRole('admin'), async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = getBackupPath(filename);

    if (!filepath) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    res.download(filepath, filename);
  } catch (err) {
    console.error('Failed to download backup', err);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

// Get disk usage status
router.get('/api/disk-usage', requirePermission('settings', PERM_READ), async (req, res) => {
  try {
    const usage = await getDiskUsage();
    res.json(usage);
  } catch (err) {
    console.error('Failed to get disk usage', err);
    res.status(500).json({ error: 'Failed to get disk usage' });
  }
});

// ========== CUSTOMER ENDPOINTS ==========

router.get('/api/customers', requirePermission('masters', PERM_READ), async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ customers });
  } catch (err) {
    console.error('Failed to fetch customers', err);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.post('/api/customers', requirePermission('masters', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const name = String(req.body?.name || '').trim();
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;
    const address = req.body?.address ? String(req.body.address).trim() : null;

    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    // Check for duplicate customer name (case-insensitive)
    const existingCustomer = await prisma.customer.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existingCustomer) {
      return res.status(409).json({ error: 'A customer with this name already exists' });
    }

    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        address,
        ...actorCreateFields(actor?.userId),
      },
    });

    await logCrudWithActor(req, {
      entityType: 'customer',
      entityId: customer.id,
      action: 'create',
      payload: { name, phone, address },
    });

    res.json({ customer });
  } catch (err) {
    console.error('Failed to create customer', err);
    res.status(500).json({ error: err.message || 'Failed to create customer' });
  }
});

router.put('/api/customers/:id', requireEditPermission('masters'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
    const address = req.body?.address != null ? String(req.body.address).trim() : undefined;

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(address !== undefined ? { address } : {}),
        ...actorUpdateFields(actor?.userId),
      },
    });

    await logCrudWithActor(req, {
      entityType: 'customer',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
    });

    res.json({ customer: updated });
  } catch (err) {
    console.error('Failed to update customer', err);
    res.status(500).json({ error: err.message || 'Failed to update customer' });
  }
});

router.delete('/api/customers/:id', requireDeletePermission('masters'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    // Check if customer has dispatches
    const dispatchCount = await prisma.dispatch.count({ where: { customerId: id } });
    if (dispatchCount > 0) {
      return res.status(409).json({ error: 'Cannot delete customer with existing dispatches' });
    }

    await prisma.customer.delete({ where: { id } });

    await logCrudWithActor(req, {
      entityType: 'customer',
      entityId: id,
      action: 'delete',
      payload: existing,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete customer', err);
    res.status(500).json({ error: err.message || 'Failed to delete customer' });
  }
});

// ========== DISPATCH ENDPOINTS ==========

// Generate dispatch challan number
async function allocateDispatchChallanNumber(tx, dateInput) {
  const fiscalYear = getFiscalYearLabel(dateInput);
  const seqId = `dispatch_seq_${fiscalYear.replace('-', '_')}`;

  const seq = await tx.dispatchSequence.upsert({
    where: { id: seqId },
    create: { id: seqId, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });

  const num = seq.nextValue - 1;
  return `DC/${fiscalYear}/${String(num).padStart(3, '0')}`;
}

// Get available items for dispatch at a specific stage
router.get('/api/dispatch/available/:stage', requirePermission('dispatch', PERM_READ), async (req, res) => {
  try {
    const { stage } = req.params;
    const EPSILON = 1e-9;
    let items = [];

    if (stage === 'inbound') {
      // Get inbound items with remaining weight (weight - dispatchedWeight > 0)
      const inboundItems = await prisma.inboundItem.findMany({
        where: {
          status: { not: 'consumed' },
        },
        orderBy: { createdAt: 'desc' },
      });
      items = inboundItems
        .map(item => ({
          id: item.id,
          barcode: item.barcode,
          lotNo: item.lotNo,
          weight: item.weight,
          dispatchedWeight: item.dispatchedWeight || 0,
          issuedToCutterWeight: item.issuedToCutterWeight || 0,
          availableWeight: Math.max(0, item.weight - (item.dispatchedWeight || 0) - (item.issuedToCutterWeight || 0)),
          stage: 'inbound',
        }))
        .filter(item => item.availableWeight > 0);
    } else if (stage === 'cutter') {
      // Get cutter receive rows with remaining weight
      // Subtract both dispatchedWeight AND issuedBobbinWeight (weight already issued to Holo)
      const cutterRows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
      items = cutterRows
        .map(row => {
          const issuedToHolo = row.issuedBobbinWeight || 0;
          const dispatched = row.dispatchedWeight || 0;
          const netWt = row.netWt || 0;
          const totalCount = row.bobbinQuantity || 0;
          const dispatchedCount = row.dispatchedCount || 0;
          const issuedCount = row.issuedBobbins || 0;
          const availableWeight = Math.max(0, netWt - dispatched - issuedToHolo);
          const availableCount = calcAvailableCountFromWeight({
            totalCount,
            issuedCount,
            dispatchedCount,
            totalWeight: netWt,
            availableWeight,
          }) || 0;
          const avgWeightPerPiece = availableCount > 0
            ? (availableWeight / availableCount)
            : 0;
          return {
            id: row.id,
            barcode: row.barcode || row.vchNo,
            pieceId: row.pieceId,
            notes: row.notes || null,
            weight: netWt,
            dispatchedWeight: dispatched,
            issuedToHolo: issuedToHolo,
            availableWeight: availableWeight,
            stage: 'cutter',
            bobbinQuantity: totalCount,
            totalCount: totalCount,
            dispatchedCount: dispatchedCount,
            issuedCount: issuedCount,
            availableCount: availableCount,
            avgWeightPerPiece: roundTo3Decimals(avgWeightPerPiece),
          };
        })
        .filter(item => item.availableWeight > EPSILON || item.availableCount > 0);
    } else if (stage === 'holo') {
      // Get holo receive rows with remaining weight
      const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
        where: { isDeleted: false },
        include: { issue: true },
        orderBy: { createdAt: 'desc' },
      });
      const issuedToConingMap = await buildHoloIssuedToConingMap(prisma, holoRows.map(row => row.id));
      const issueById = new Map();
      holoRows.forEach((row) => {
        if (row.issue?.id) issueById.set(row.issue.id, row.issue);
      });
      const issueRowIdsMap = new Map();
      const allRowIds = [];
      issueById.forEach((issue) => {
        let refs = [];
        try {
          refs = Array.isArray(issue.receivedRowRefs)
            ? issue.receivedRowRefs
            : (typeof issue.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : []);
        } catch (e) {
          refs = [];
        }
        const rowIds = refs.map(ref => (typeof ref?.rowId === 'string' ? ref.rowId : null)).filter(Boolean);
        issueRowIdsMap.set(issue.id, rowIds);
        allRowIds.push(...rowIds);
      });
      const uniqueRowIds = Array.from(new Set(allRowIds));
      const cutterRows = uniqueRowIds.length
        ? await prisma.receiveFromCutterMachineRow.findMany({
          where: { id: { in: uniqueRowIds }, isDeleted: false },
          select: { id: true, pieceId: true },
        })
        : [];
      const rowToPieceMap = new Map(cutterRows.map(r => [r.id, r.pieceId]));
      const pieceIds = Array.from(new Set(cutterRows.map(r => r.pieceId).filter(Boolean)));
      const pieces = pieceIds.length
        ? await prisma.inboundItem.findMany({
          where: { id: { in: pieceIds } },
          select: { id: true, lotNo: true },
        })
        : [];
      const pieceLotMap = new Map(pieces.map(p => [p.id, p.lotNo]));
      const issueLotLabelMap = new Map();
      issueById.forEach((issue) => {
        const rowIds = issueRowIdsMap.get(issue.id) || [];
        const lotSet = new Set();
        rowIds.forEach((rowId) => {
          const pieceId = rowToPieceMap.get(rowId);
          if (!pieceId) return;
          const lotNo = pieceLotMap.get(pieceId);
          if (lotNo) lotSet.add(lotNo);
        });
        if (lotSet.size === 0 && issue.lotNo) lotSet.add(issue.lotNo);
        const lotNos = Array.from(lotSet);
        const lotLabel = lotNos.length <= 1
          ? (lotNos[0] || issue.lotNo || '')
          : (lotNos.length <= 3 ? `Mixed (${lotNos.join(', ')})` : `Mixed (${lotNos.length})`);
        issueLotLabelMap.set(issue.id, lotLabel);
      });
      items = holoRows
        .map(row => {
          const crateIndex = parseReceiveCrateIndex(row.barcode);
          const legacyBarcode = buildLegacyReceiveBarcode('RHO', row.issue?.lotNo, crateIndex);
          const netWeight = row.rollWeight ? row.rollWeight : (row.grossWeight || 0) - (row.tareWeight || 0);
          const totalCount = row.rollCount || 0;
          const dispatchedCount = row.dispatchedCount || 0;
          const issuedToConing = issuedToConingMap.get(row.id) || { issuedRolls: 0, issuedWeight: 0 };
          const availableWeight = Math.max(0, netWeight - (row.dispatchedWeight || 0) - (issuedToConing.issuedWeight || 0));
          const availableCount = calcAvailableCountFromWeight({
            totalCount,
            issuedCount: issuedToConing.issuedRolls || 0,
            dispatchedCount,
            totalWeight: netWeight,
            availableWeight,
          }) || 0;
          const avgWeightPerPiece = availableCount > 0
            ? (availableWeight / availableCount)
            : 0;
          return {
            id: row.id,
            barcode: row.barcode,
            legacyBarcode,
            lotNo: row.issue?.lotNo,
            lotLabel: row.issue?.id ? issueLotLabelMap.get(row.issue.id) : null,
            notes: row.notes || null,
            weight: netWeight,
            dispatchedWeight: row.dispatchedWeight || 0,
            issuedToConingWeight: issuedToConing.issuedWeight || 0,
            availableWeight: availableWeight,
            stage: 'holo',
            rollCount: totalCount,
            totalCount: totalCount,
            dispatchedCount: dispatchedCount,
            availableCount: availableCount,
            avgWeightPerPiece: roundTo3Decimals(avgWeightPerPiece),
          };
        })
        .filter(item => item.availableWeight > EPSILON || item.availableCount > 0);
      items = dropDuplicateLegacyBarcodes(items);
    } else if (stage === 'coning') {
      // Get coning receive rows with remaining weight
      const coningRows = await prisma.receiveFromConingMachineRow.findMany({
        where: { isDeleted: false },
        include: { issue: true },
        orderBy: { createdAt: 'desc' },
      });
      items = coningRows
        .map(row => {
          const crateIndex = parseReceiveCrateIndex(row.barcode);
          const legacyBarcode = buildLegacyReceiveBarcode('RCO', row.issue?.lotNo, crateIndex);
          const netWeight = row.netWeight || 0;
          const totalCount = row.coneCount || 0;
          const dispatchedCount = row.dispatchedCount || 0;
          const availableWeight = Math.max(0, netWeight - (row.dispatchedWeight || 0));
          const availableCount = calcAvailableCountFromWeight({
            totalCount,
            issuedCount: 0,
            dispatchedCount,
            totalWeight: netWeight,
            availableWeight,
          }) || 0;
          const avgWeightPerPiece = availableCount > 0
            ? (availableWeight / availableCount)
            : 0;
          return {
            id: row.id,
            barcode: row.barcode,
            legacyBarcode,
            lotNo: row.issue?.lotNo,
            notes: row.notes || null,
            weight: netWeight,
            dispatchedWeight: row.dispatchedWeight || 0,
            availableWeight: availableWeight,
            stage: 'coning',
            coneCount: totalCount,
            totalCount: totalCount,
            dispatchedCount: dispatchedCount,
            availableCount: availableCount,
            avgWeightPerPiece: roundTo3Decimals(avgWeightPerPiece),
          };
        })
        .filter(item => item.availableWeight > EPSILON || item.availableCount > 0);
      items = dropDuplicateLegacyBarcodes(items);
    } else {
      return res.status(400).json({ error: 'Invalid stage. Must be: inbound, cutter, holo, or coning' });
    }

    res.json({ items });
  } catch (err) {
    console.error('Failed to fetch available items for dispatch', err);
    res.status(500).json({ error: 'Failed to fetch available items' });
  }
});

// List all dispatches
router.get('/api/dispatch', requirePermission('dispatch', PERM_READ), async (req, res) => {
  try {
    const { stage, customerId, from, to } = req.query;
    const where = {};

    if (stage) where.stage = stage;
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }

    const dispatchesRaw = await prisma.dispatch.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });

    // Resolve user fields for display
    const dispatches = await resolveUserFields(dispatchesRaw);

    res.json({ dispatches });
  } catch (err) {
    console.error('Failed to fetch dispatches', err);
    res.status(500).json({ error: 'Failed to fetch dispatches' });
  }
});

// Get single dispatch
router.get('/api/dispatch/:id', requirePermission('dispatch', PERM_READ), async (req, res) => {
  try {
    const { id } = req.params;
    const dispatch = await prisma.dispatch.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });
    res.json({ dispatch });
  } catch (err) {
    console.error('Failed to fetch dispatch', err);
    res.status(500).json({ error: 'Failed to fetch dispatch' });
  }
});

function normalizeDispatchCountInput(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('Count must be a positive number');
  }
  return Math.floor(num);
}

async function getDispatchSourceAvailability(tx, stage, stageItemId) {
  if (stage === 'inbound') {
    const sourceItem = await tx.inboundItem.findUnique({ where: { id: stageItemId } });
    if (!sourceItem) throw new Error('Inbound item not found');
    const availableWeight = Math.max(0, Number(sourceItem.weight || 0) - Number(sourceItem.dispatchedWeight || 0) - Number(sourceItem.issuedToCutterWeight || 0));
    return { availableWeight, availableCount: null };
  }

  if (stage === 'cutter') {
    const sourceItem = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: stageItemId } });
    if (!sourceItem || sourceItem.isDeleted) throw new Error('Cutter receive row not found');
    const issuedToHolo = Number(sourceItem.issuedBobbinWeight || 0);
    const totalWeight = Number(sourceItem.netWt || 0);
    const availableWeight = Math.max(0, totalWeight - Number(sourceItem.dispatchedWeight || 0) - issuedToHolo);
    const availableCount = calcAvailableCountFromWeight({
      totalCount: Number(sourceItem.bobbinQuantity || 0),
      issuedCount: Number(sourceItem.issuedBobbins || 0),
      dispatchedCount: Number(sourceItem.dispatchedCount || 0),
      totalWeight,
      availableWeight,
    }) || 0;
    return { availableWeight, availableCount };
  }

  if (stage === 'holo') {
    const sourceItem = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: stageItemId } });
    if (!sourceItem || sourceItem.isDeleted) throw new Error('Holo receive row not found');
    const netWeight = Number(sourceItem.rollWeight || (Number(sourceItem.grossWeight || 0) - Number(sourceItem.tareWeight || 0)));
    const issuedToConingMap = await buildHoloIssuedToConingMap(tx, [sourceItem.id]);
    const issuedToConing = issuedToConingMap.get(sourceItem.id) || { issuedRolls: 0, issuedWeight: 0 };
    const availableWeight = Math.max(0, netWeight - Number(sourceItem.dispatchedWeight || 0) - Number(issuedToConing.issuedWeight || 0));
    const availableCount = calcAvailableCountFromWeight({
      totalCount: Number(sourceItem.rollCount || 0),
      issuedCount: Number(issuedToConing.issuedRolls || 0),
      dispatchedCount: Number(sourceItem.dispatchedCount || 0),
      totalWeight: netWeight,
      availableWeight,
    }) || 0;
    return { availableWeight, availableCount };
  }

  if (stage === 'coning') {
    const sourceItem = await tx.receiveFromConingMachineRow.findUnique({ where: { id: stageItemId } });
    if (!sourceItem || sourceItem.isDeleted) throw new Error('Coning receive row not found');
    const totalWeight = Number(sourceItem.netWeight || 0);
    const availableWeight = Math.max(0, totalWeight - Number(sourceItem.dispatchedWeight || 0));
    const availableCount = calcAvailableCountFromWeight({
      totalCount: Number(sourceItem.coneCount || 0),
      issuedCount: 0,
      dispatchedCount: Number(sourceItem.dispatchedCount || 0),
      totalWeight,
      availableWeight,
    }) || 0;
    return { availableWeight, availableCount };
  }

  throw new Error('Invalid stage');
}

async function applyDispatchSourceDelta(tx, { stage, stageItemId, deltaWeight, deltaCount }) {
  const roundedDeltaWeight = roundTo3Decimals(Number(deltaWeight || 0));
  const normalizedDeltaCount = Math.trunc(Number(deltaCount || 0));
  if (Math.abs(roundedDeltaWeight) <= 0.000001 && normalizedDeltaCount === 0) return;

  const updateData = {};
  if (Math.abs(roundedDeltaWeight) > 0.000001) {
    updateData.dispatchedWeight = { increment: roundedDeltaWeight };
  }
  if (stage !== 'inbound' && normalizedDeltaCount !== 0) {
    updateData.dispatchedCount = { increment: normalizedDeltaCount };
  }

  if (Object.keys(updateData).length === 0) return;

  if (stage === 'inbound') {
    await tx.inboundItem.update({ where: { id: stageItemId }, data: updateData });
  } else if (stage === 'cutter') {
    await tx.receiveFromCutterMachineRow.update({ where: { id: stageItemId }, data: updateData });
  } else if (stage === 'holo') {
    await tx.receiveFromHoloMachineRow.update({ where: { id: stageItemId }, data: updateData });
  } else if (stage === 'coning') {
    await tx.receiveFromConingMachineRow.update({ where: { id: stageItemId }, data: updateData });
  } else {
    throw new Error('Invalid stage');
  }
}

router.put('/api/dispatch/:id', requireEditPermission('dispatch'), async (req, res) => {
  try {
    const actor = getActor(req);
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Dispatch id is required' });

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.dispatch.findUnique({ where: { id } });
      if (!existing) throw new Error('Dispatch not found');

      if (req.body?.stage !== undefined && String(req.body.stage) !== String(existing.stage)) {
        throw new Error('Dispatch stage cannot be changed');
      }
      if (req.body?.stageItemId !== undefined && String(req.body.stageItemId) !== String(existing.stageItemId)) {
        throw new Error('Dispatch source item cannot be changed');
      }

      const newCustomerId = req.body?.customerId !== undefined ? String(req.body.customerId || '').trim() : existing.customerId;
      const newDate = req.body?.date !== undefined ? String(req.body.date || '').trim() : existing.date;
      const newNotes = req.body?.notes !== undefined ? (String(req.body.notes || '').trim() || null) : (existing.notes || null);
      const newWeight = req.body?.weight !== undefined ? Number(req.body.weight) : Number(existing.weight || 0);
      const parsedCount = normalizeDispatchCountInput(req.body?.count);
      const newCount = parsedCount === undefined ? (existing.count ?? null) : parsedCount;

      if (!newCustomerId) throw new Error('Customer is required');
      if (!newDate) throw new Error('Date is required');
      if (!Number.isFinite(newWeight) || newWeight <= 0) throw new Error('Weight must be a positive number');
      if (existing.stage === 'inbound' && newCount !== null) throw new Error('Count is not supported for inbound dispatch rows');

      const customer = await tx.customer.findUnique({ where: { id: newCustomerId } });
      if (!customer) throw new Error('Customer not found');

      const oldWeight = Number(existing.weight || 0);
      const oldCount = Number(existing.count || 0);
      const nextCount = Number(newCount || 0);
      const deltaWeight = roundTo3Decimals(newWeight - oldWeight);
      const deltaCount = Math.trunc(nextCount - oldCount);

      const availability = await getDispatchSourceAvailability(tx, existing.stage, existing.stageItemId);
      if (deltaWeight > Number(availability.availableWeight || 0) + 0.001) {
        throw new Error(`Dispatch weight increase (${deltaWeight.toFixed(3)}) exceeds available weight (${Number(availability.availableWeight || 0).toFixed(3)})`);
      }
      if (deltaCount > 0) {
        if (availability.availableCount == null) throw new Error('Count dispatch is not supported for this stage');
        if (deltaCount > Number(availability.availableCount || 0)) {
          throw new Error(`Dispatch count increase (${deltaCount}) exceeds available count (${Number(availability.availableCount || 0)})`);
        }
      }

      await applyDispatchSourceDelta(tx, {
        stage: existing.stage,
        stageItemId: existing.stageItemId,
        deltaWeight,
        deltaCount,
      });

      return await tx.dispatch.update({
        where: { id: existing.id },
        data: {
          customerId: newCustomerId,
          date: newDate,
          notes: newNotes,
          weight: roundTo3Decimals(newWeight),
          count: newCount,
          ...actorUpdateFields(actor?.userId),
        },
        include: { customer: true },
      });
    });

    await logCrudWithActor(req, {
      entityType: 'dispatch',
      entityId: updated.id,
      action: 'update',
      payload: {
        challanNo: updated.challanNo,
        stage: updated.stage,
        customerId: updated.customerId,
        date: updated.date,
        weight: updated.weight,
        count: updated.count,
      },
    });

    return res.json({ dispatch: updated });
  } catch (err) {
    console.error('Failed to update dispatch', err);
    return res.status(400).json({ error: err.message || 'Failed to update dispatch' });
  }
});

router.put('/api/dispatch/challan/:challanNo', requireEditPermission('dispatch'), async (req, res) => {
  try {
    const actor = getActor(req);
    const challanNo = String(req.params.challanNo || '').trim();
    if (!challanNo) return res.status(400).json({ error: 'Challan number is required' });

    const payloadRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (payloadRows.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });

    const result = await prisma.$transaction(async (tx) => {
      const existingRows = await tx.dispatch.findMany({
        where: { challanNo },
        include: { customer: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!existingRows.length) throw new Error('Challan not found');

      const existingById = new Map(existingRows.map((r) => [r.id, r]));
      if (payloadRows.length !== existingRows.length) {
        throw new Error('All challan rows must be included in the edit payload');
      }

      const seen = new Set();
      const normalizedRows = payloadRows.map((row) => {
        const id = String(row?.id || '').trim();
        if (!id) throw new Error('Each row requires id');
        if (seen.has(id)) throw new Error(`Duplicate row id in payload: ${id}`);
        seen.add(id);
        const existing = existingById.get(id);
        if (!existing) throw new Error(`Row ${id} does not belong to challan ${challanNo}`);
        if (row?.stage !== undefined && String(row.stage) !== String(existing.stage)) {
          throw new Error('Dispatch stage cannot be changed');
        }
        if (row?.stageItemId !== undefined && String(row.stageItemId) !== String(existing.stageItemId)) {
          throw new Error('Dispatch source item cannot be changed');
        }
        const parsedCount = normalizeDispatchCountInput(row?.count);
        const newCount = parsedCount === undefined ? (existing.count ?? null) : parsedCount;
        const newWeight = row?.weight !== undefined ? Number(row.weight) : Number(existing.weight || 0);
        if (!Number.isFinite(newWeight) || newWeight <= 0) {
          throw new Error(`Weight must be a positive number for row ${id}`);
        }
        if (existing.stage === 'inbound' && newCount !== null) {
          throw new Error(`Count is not supported for inbound row ${id}`);
        }
        const oldWeight = Number(existing.weight || 0);
        const oldCount = Number(existing.count || 0);
        const nextCount = Number(newCount || 0);
        return {
          id,
          existing,
          newWeight,
          newCount,
          deltaWeight: roundTo3Decimals(newWeight - oldWeight),
          deltaCount: Math.trunc(nextCount - oldCount),
        };
      });

      const newCustomerId = req.body?.customerId !== undefined
        ? String(req.body.customerId || '').trim()
        : existingRows[0].customerId;
      const newDate = req.body?.date !== undefined
        ? String(req.body.date || '').trim()
        : existingRows[0].date;
      const hasNotes = req.body?.notes !== undefined;
      const sharedNotes = hasNotes ? (String(req.body.notes || '').trim() || null) : undefined;

      if (!newCustomerId) throw new Error('Customer is required');
      if (!newDate) throw new Error('Date is required');
      const customer = await tx.customer.findUnique({ where: { id: newCustomerId } });
      if (!customer) throw new Error('Customer not found');

      const deltaBySource = new Map();
      normalizedRows.forEach((row) => {
        const key = `${row.existing.stage}:${row.existing.stageItemId}`;
        const current = deltaBySource.get(key) || {
          stage: row.existing.stage,
          stageItemId: row.existing.stageItemId,
          deltaWeight: 0,
          deltaCount: 0,
        };
        current.deltaWeight += Number(row.deltaWeight || 0);
        current.deltaCount += Number(row.deltaCount || 0);
        deltaBySource.set(key, current);
      });

      for (const entry of deltaBySource.values()) {
        const availability = await getDispatchSourceAvailability(tx, entry.stage, entry.stageItemId);
        if (entry.deltaWeight > Number(availability.availableWeight || 0) + 0.001) {
          throw new Error(`Dispatch weight increase (${entry.deltaWeight.toFixed(3)}) exceeds available weight (${Number(availability.availableWeight || 0).toFixed(3)}) for ${entry.stageItemId}`);
        }
        if (entry.deltaCount > 0) {
          if (availability.availableCount == null) throw new Error(`Count dispatch is not supported for source ${entry.stageItemId}`);
          if (entry.deltaCount > Number(availability.availableCount || 0)) {
            throw new Error(`Dispatch count increase (${entry.deltaCount}) exceeds available count (${Number(availability.availableCount || 0)}) for ${entry.stageItemId}`);
          }
        }
      }

      for (const row of normalizedRows) {
        await tx.dispatch.update({
          where: { id: row.id },
          data: {
            customerId: newCustomerId,
            date: newDate,
            notes: hasNotes ? sharedNotes : row.existing.notes,
            weight: roundTo3Decimals(row.newWeight),
            count: row.newCount,
            ...actorUpdateFields(actor?.userId),
          },
        });
      }

      for (const entry of deltaBySource.values()) {
        await applyDispatchSourceDelta(tx, entry);
      }

      const dispatches = await tx.dispatch.findMany({
        where: { challanNo },
        include: { customer: true },
        orderBy: { createdAt: 'asc' },
      });
      return { dispatches };
    });

    await logCrudWithActor(req, {
      entityType: 'dispatch',
      entityId: challanNo,
      action: 'update_challan',
      payload: {
        challanNo,
        rows: result.dispatches.length,
      },
    });

    return res.json(result);
  } catch (err) {
    console.error('Failed to update dispatch challan', err);
    return res.status(400).json({ error: err.message || 'Failed to update dispatch challan' });
  }
});

// Create dispatch
router.post('/api/dispatch', requirePermission('dispatch', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const { customerId, stage, stageItemId, weight, count, date, notes } = req.body;

    if (!customerId) return res.status(400).json({ error: 'Customer is required' });
    if (!stage) return res.status(400).json({ error: 'Stage is required' });
    if (!stageItemId) return res.status(400).json({ error: 'Stage item is required' });
    // If count provided, weight can be auto-calculated, so check weight only if count is missing
    if ((!count && (!weight || weight <= 0))) return res.status(400).json({ error: 'Valid weight or count is required' });
    if (!['inbound', 'cutter', 'holo', 'coning'].includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    const dispatchDate = date || new Date().toISOString().split('T')[0];

    // Verify customer exists (can be outside transaction as it's read-only)
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(400).json({ error: 'Customer not found' });

    // IMPORTANT: All source item validation and updates must be inside transaction
    // to prevent race conditions where two concurrent requests could over-dispatch
    const dispatch = await prisma.$transaction(async (tx) => {
      let sourceItem;
      let stageBarcode = '';
      let availableWeight = 0;
      let availableCount = 0;
      let finalWeight = weight;
      let avgWeight = 0;

      // Fetch source item INSIDE transaction to get fresh data
      if (stage === 'inbound') {
        sourceItem = await tx.inboundItem.findUnique({ where: { id: stageItemId } });
        if (!sourceItem) throw new Error('Inbound item not found');
        stageBarcode = sourceItem.barcode;
        availableWeight = sourceItem.weight - (sourceItem.dispatchedWeight || 0) - (sourceItem.issuedToCutterWeight || 0);
        // Inbound doesn't support partial count dispatch (it's 1 piece)
      } else if (stage === 'cutter') {
        sourceItem = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: stageItemId } });
        if (!sourceItem || sourceItem.isDeleted) throw new Error('Cutter receive row not found');
        stageBarcode = sourceItem.barcode || sourceItem.vchNo;
        // Subtract both dispatchedWeight AND issuedBobbinWeight (weight already issued to Holo)
        const issuedToHolo = sourceItem.issuedBobbinWeight || 0;
        const totalWeight = sourceItem.netWt || 0;
        availableWeight = Math.max(0, (totalWeight || 0) - (sourceItem.dispatchedWeight || 0) - issuedToHolo);

        const totalCount = sourceItem.bobbinQuantity || 0;
        const dispatchedCount = sourceItem.dispatchedCount || 0;
        const issuedCount = sourceItem.issuedBobbins || 0;
        availableCount = calcAvailableCountFromWeight({
          totalCount,
          issuedCount,
          dispatchedCount,
          totalWeight,
          availableWeight,
        }) || 0;
        avgWeight = availableCount > 0 ? (availableWeight / availableCount) : 0;
      } else if (stage === 'holo') {
        sourceItem = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: stageItemId } });
        if (!sourceItem || sourceItem.isDeleted) throw new Error('Holo receive row not found');
        stageBarcode = sourceItem.barcode || '';
        const netWeight = sourceItem.rollWeight ? sourceItem.rollWeight : (sourceItem.grossWeight || 0) - (sourceItem.tareWeight || 0);
        const issuedToConingMap = await buildHoloIssuedToConingMap(tx, [sourceItem.id]);
        const issuedToConing = issuedToConingMap.get(sourceItem.id) || { issuedRolls: 0, issuedWeight: 0 };
        availableWeight = Math.max(0, netWeight - (sourceItem.dispatchedWeight || 0) - (issuedToConing.issuedWeight || 0));

        const totalCount = sourceItem.rollCount || 0;
        const dispatchedCount = sourceItem.dispatchedCount || 0;
        availableCount = calcAvailableCountFromWeight({
          totalCount,
          issuedCount: issuedToConing.issuedRolls || 0,
          dispatchedCount,
          totalWeight: netWeight,
          availableWeight,
        }) || 0;
        avgWeight = availableCount > 0 ? (availableWeight / availableCount) : 0;
      } else if (stage === 'coning') {
        sourceItem = await tx.receiveFromConingMachineRow.findUnique({ where: { id: stageItemId } });
        if (!sourceItem || sourceItem.isDeleted) throw new Error('Coning receive row not found');
        stageBarcode = sourceItem.barcode || '';
        const totalWeight = sourceItem.netWeight || 0;
        availableWeight = Math.max(0, (totalWeight || 0) - (sourceItem.dispatchedWeight || 0));

        const totalCount = sourceItem.coneCount || 0;
        const dispatchedCount = sourceItem.dispatchedCount || 0;
        availableCount = calcAvailableCountFromWeight({
          totalCount,
          issuedCount: 0,
          dispatchedCount,
          totalWeight,
          availableWeight,
        }) || 0;
        avgWeight = availableCount > 0 ? (availableWeight / availableCount) : 0;
      }

      // If count provided, validate and calculate weight if needed
      if (count && count > 0) {
        if (stage === 'inbound') {
          throw new Error('Count dispatch not supported for inbound items');
        }
        if (count > availableCount) {
          throw new Error(`Dispatch count (${count}) exceeds available count (${availableCount})`);
        }

        // Auto-calculate weight if not provided
        if (!finalWeight || finalWeight <= 0) {
          if (count === availableCount && availableWeight > 0) {
            finalWeight = roundTo3Decimals(availableWeight);
          } else {
            finalWeight = roundTo3Decimals(count * avgWeight);
          }
        }
      }

      // Validate weight INSIDE transaction to prevent race condition
      if (finalWeight > availableWeight + 0.001) {
        throw new Error(`Dispatch weight (${finalWeight}) exceeds available weight (${availableWeight.toFixed(3)})`);
      }

      const challanNo = await allocateDispatchChallanNumber(tx, dispatchDate);

      const created = await tx.dispatch.create({
        data: {
          challanNo,
          date: dispatchDate,
          customerId,
          stage,
          stageItemId,
          stageBarcode,
          weight: roundTo3Decimals(finalWeight),
          count: count || null,
          notes: notes || null,
          ...actorCreateFields(actor?.userId),
        },
        include: { customer: true },
      });

      // Update dispatchedWeight AND dispatchedCount on source item
      const updateData = {
        dispatchedWeight: { increment: roundTo3Decimals(finalWeight) }
      };

      if (count && count > 0) {
        updateData.dispatchedCount = { increment: count };
      }

      if (stage === 'inbound') {
        await tx.inboundItem.update({
          where: { id: stageItemId },
          data: updateData, // Inbound doesn't have dispatchedCount
        });
      } else if (stage === 'cutter') {
        await tx.receiveFromCutterMachineRow.update({
          where: { id: stageItemId },
          data: updateData,
        });
      } else if (stage === 'holo') {
        await tx.receiveFromHoloMachineRow.update({
          where: { id: stageItemId },
          data: updateData,
        });
      } else if (stage === 'coning') {
        await tx.receiveFromConingMachineRow.update({
          where: { id: stageItemId },
          data: updateData,
        });
      }

      return created;
    });

    await logCrudWithActor(req, {
      entityType: 'dispatch',
      entityId: dispatch.id,
      action: 'create',
      payload: { challanNo: dispatch.challanNo, stage, weight, customerId },
    });

    res.json({ dispatch });
  } catch (err) {
    console.error('Failed to create dispatch', err);
    res.status(500).json({ error: err.message || 'Failed to create dispatch' });
  }
});

// Create dispatch for multiple items (single challan)
router.post('/api/dispatch/bulk', requirePermission('dispatch', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const { customerId, stage, date, notes, items } = req.body;

    if (!customerId) return res.status(400).json({ error: 'Customer is required' });
    if (!stage) return res.status(400).json({ error: 'Stage is required' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }
    if (!['inbound', 'cutter', 'holo', 'coning'].includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    const dispatchDate = date || new Date().toISOString().split('T')[0];

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(400).json({ error: 'Customer not found' });

    const result = await prisma.$transaction(async (tx) => {
      const challanNo = await allocateDispatchChallanNumber(tx, dispatchDate);
      const adjustments = new Map();
      const created = [];

      for (const item of items) {
        const stageItemId = item?.stageItemId;
        if (!stageItemId) throw new Error('Stage item is required');

        const rawCount = item?.count != null ? Number(item.count) : null;
        const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : null;
        const rawWeight = item?.weight != null ? Number(item.weight) : null;
        const inputWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : null;

        if (!count && !inputWeight) throw new Error('Valid weight or count is required');
        if (stage === 'inbound' && count) throw new Error('Count dispatch not supported for inbound items');

        let sourceItem;
        let stageBarcode = '';
        let availableWeight = 0;
        let availableCount = 0;
        let avgWeight = 0;

        if (stage === 'inbound') {
          sourceItem = await tx.inboundItem.findUnique({ where: { id: stageItemId } });
          if (!sourceItem) throw new Error('Inbound item not found');
          stageBarcode = sourceItem.barcode;
          availableWeight = sourceItem.weight - (sourceItem.dispatchedWeight || 0) - (sourceItem.issuedToCutterWeight || 0);
        } else if (stage === 'cutter') {
          sourceItem = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: stageItemId } });
          if (!sourceItem || sourceItem.isDeleted) throw new Error('Cutter receive row not found');
          stageBarcode = sourceItem.barcode || sourceItem.vchNo;
          const issuedToHolo = sourceItem.issuedBobbinWeight || 0;
          availableWeight = (sourceItem.netWt || 0) - (sourceItem.dispatchedWeight || 0) - issuedToHolo;
          const totalCount = sourceItem.bobbinQuantity || 0;
          const dispatchedCount = sourceItem.dispatchedCount || 0;
          const issuedCount = sourceItem.issuedBobbins || 0;
          availableCount = Math.max(0, totalCount - dispatchedCount - issuedCount);
          avgWeight = availableCount > 0 ? (availableWeight / availableCount) : 0;
        } else if (stage === 'holo') {
          sourceItem = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: stageItemId } });
          if (!sourceItem || sourceItem.isDeleted) throw new Error('Holo receive row not found');
          stageBarcode = sourceItem.barcode || '';
          const netWeight = sourceItem.rollWeight ? sourceItem.rollWeight : (sourceItem.grossWeight || 0) - (sourceItem.tareWeight || 0);
          const issuedToConingMap = await buildHoloIssuedToConingMap(tx, [sourceItem.id]);
          const issuedToConing = issuedToConingMap.get(sourceItem.id) || { issuedRolls: 0, issuedWeight: 0 };
          availableWeight = netWeight - (sourceItem.dispatchedWeight || 0) - (issuedToConing.issuedWeight || 0);
          const totalCount = sourceItem.rollCount || 0;
          const dispatchedCount = sourceItem.dispatchedCount || 0;
          availableCount = calcAvailableCountFromWeight({
            totalCount,
            issuedCount: issuedToConing.issuedRolls || 0,
            dispatchedCount,
            totalWeight: netWeight,
            availableWeight,
          }) || 0;
          avgWeight = availableCount > 0 ? (availableWeight / availableCount) : 0;
        } else if (stage === 'coning') {
          sourceItem = await tx.receiveFromConingMachineRow.findUnique({ where: { id: stageItemId } });
          if (!sourceItem || sourceItem.isDeleted) throw new Error('Coning receive row not found');
          stageBarcode = sourceItem.barcode || '';
          availableWeight = (sourceItem.netWeight || 0) - (sourceItem.dispatchedWeight || 0);
          const totalCount = sourceItem.coneCount || 0;
          const dispatchedCount = sourceItem.dispatchedCount || 0;
          availableCount = Math.max(0, totalCount - dispatchedCount);
          avgWeight = availableCount > 0 ? (availableWeight / availableCount) : 0;
        }

        const adj = adjustments.get(stageItemId) || { weight: 0, count: 0 };
        availableWeight = Math.max(0, availableWeight - adj.weight);
        availableCount = Math.max(0, availableCount - adj.count);

        let finalWeight = inputWeight;
        if (count && count > 0) {
          if (count > availableCount) {
            throw new Error(`Dispatch count (${count}) exceeds available count (${availableCount})`);
          }
          if (!finalWeight || finalWeight <= 0) {
            if (count === availableCount && availableWeight > 0) {
              finalWeight = roundTo3Decimals(availableWeight);
            } else {
              if (!avgWeight || avgWeight <= 0) {
                throw new Error('Cannot auto-calculate weight without a valid average weight');
              }
              finalWeight = roundTo3Decimals(count * avgWeight);
            }
          }
        }

        if (!finalWeight || finalWeight <= 0) throw new Error('Valid weight is required');
        if (finalWeight > availableWeight + 0.001) {
          throw new Error(`Dispatch weight (${finalWeight}) exceeds available weight (${availableWeight.toFixed(3)})`);
        }

        adjustments.set(stageItemId, {
          weight: adj.weight + finalWeight,
          count: adj.count + (count || 0),
        });

        const createdRow = await tx.dispatch.create({
          data: {
            challanNo,
            date: dispatchDate,
            customerId,
            stage,
            stageItemId,
            stageBarcode,
            weight: roundTo3Decimals(finalWeight),
            count: count || null,
            notes: notes || null,
            ...actorCreateFields(actor?.userId),
          },
          include: { customer: true },
        });

        const updateData = {
          dispatchedWeight: { increment: roundTo3Decimals(finalWeight) }
        };
        if (count && count > 0) {
          updateData.dispatchedCount = { increment: count };
        }

        if (stage === 'inbound') {
          await tx.inboundItem.update({
            where: { id: stageItemId },
            data: updateData,
          });
        } else if (stage === 'cutter') {
          await tx.receiveFromCutterMachineRow.update({
            where: { id: stageItemId },
            data: updateData,
          });
        } else if (stage === 'holo') {
          await tx.receiveFromHoloMachineRow.update({
            where: { id: stageItemId },
            data: updateData,
          });
        } else if (stage === 'coning') {
          await tx.receiveFromConingMachineRow.update({
            where: { id: stageItemId },
            data: updateData,
          });
        }

        created.push(createdRow);
      }

      return { challanNo, dispatches: created };
    });

    await logCrudWithActor(req, {
      entityType: 'dispatch',
      entityId: result.challanNo,
      action: 'create_bulk',
      payload: { challanNo: result.challanNo, stage, customerId, itemCount: result.dispatches.length },
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to create bulk dispatch', err);
    res.status(500).json({ error: err.message || 'Failed to create bulk dispatch' });
  }
});

// Delete/cancel dispatch (restores weight)
router.delete('/api/dispatch/:id', requireDeletePermission('dispatch'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;

    const existing = await prisma.dispatch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Dispatch not found' });

    // Delete dispatch and restore weight in transaction
    await prisma.$transaction(async (tx) => {
      await tx.dispatch.delete({ where: { id } });

      // Restore dispatchedWeight on source item
      const { stage, stageItemId, weight, count } = existing;

      const updateData = {
        dispatchedWeight: { decrement: weight }
      };

      if (count && count > 0) {
        updateData.dispatchedCount = { decrement: count };
      }

      if (stage === 'inbound') {
        await tx.inboundItem.update({
          where: { id: stageItemId },
          data: updateData, // Inbound doesn't have dispatchedCount
        });
      } else if (stage === 'cutter') {
        await tx.receiveFromCutterMachineRow.update({
          where: { id: stageItemId },
          data: updateData,
        });
      } else if (stage === 'holo') {
        await tx.receiveFromHoloMachineRow.update({
          where: { id: stageItemId },
          data: updateData,
        });
      } else if (stage === 'coning') {
        await tx.receiveFromConingMachineRow.update({
          where: { id: stageItemId },
          data: updateData,
        });
      }
    });

    await logCrudWithActor(req, {
      entityType: 'dispatch',
      entityId: id,
      action: 'delete',
      payload: existing,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete dispatch', err);
    res.status(500).json({ error: err.message || 'Failed to delete dispatch' });
  }
});

// Delete/cancel all dispatch rows for a challan (restores weight)
router.delete('/api/dispatch/challan/:challanNo', requireDeletePermission('dispatch'), async (req, res) => {
  try {
    const actor = getActor(req);
    const { challanNo } = req.params;
    if (!challanNo) return res.status(400).json({ error: 'Challan number is required' });

    const rows = await prisma.dispatch.findMany({ where: { challanNo } });
    if (rows.length === 0) return res.status(404).json({ error: 'Challan not found' });

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const { stage, stageItemId, weight, count } = row;
        const updateData = {
          dispatchedWeight: { decrement: weight }
        };

        if (count && count > 0) {
          updateData.dispatchedCount = { decrement: count };
        }

        if (stage === 'inbound') {
          await tx.inboundItem.update({
            where: { id: stageItemId },
            data: updateData,
          });
        } else if (stage === 'cutter') {
          await tx.receiveFromCutterMachineRow.update({
            where: { id: stageItemId },
            data: updateData,
          });
        } else if (stage === 'holo') {
          await tx.receiveFromHoloMachineRow.update({
            where: { id: stageItemId },
            data: updateData,
          });
        } else if (stage === 'coning') {
          await tx.receiveFromConingMachineRow.update({
            where: { id: stageItemId },
            data: updateData,
          });
        }
      }

      await tx.dispatch.deleteMany({ where: { challanNo } });
    });

    await logCrudWithActor(req, {
      entityType: 'dispatch',
      entityId: challanNo,
      action: 'delete_challan',
      payload: { challanNo, rows: rows.length },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete dispatch challan', err);
    res.status(500).json({ error: err.message || 'Failed to delete dispatch challan' });
  }
});

// ========== REPORTS ENDPOINTS ==========

// Barcode History - FULL BIRTH CHART / LINEAGE TRACING
// When any barcode is scanned, trace the complete production chain:
// Inbound → Cutter Issue → Cutter Receive → Holo Issue → Holo Receive → Coning Issue → Coning Receive → Dispatch
router.get('/api/reports/barcode-history/:barcode', requirePermission('reports', PERM_READ), async (req, res) => {
  try {
    const { barcode } = req.params;
    const normalizedBarcode = normalizeBarcodeInput(barcode);
    const treeMode = req.query.tree === '1';

    const history = {
      barcode: normalizedBarcode,
      resolvedBarcode: null,
      searchedStage: null,
      found: false,
      lineage: [],  // Complete lineage from Inbound to Dispatch
    };

    // Helper to format stage data
    const formatStageData = (stage, data) => ({ stage, ...data });
    const traceCaches = createTraceCaches();
    const holoIssueDetailsCache = new Map();
    const coningTraceCache = new Map();
    const holoTraceCache = new Map();

    const resolveHoloTrace = async (issue) => {
      if (!issue?.id) return { cutName: '', yarnName: '', twistName: '', yarnKg: null };
      const cached = holoTraceCache.get(issue.id);
      if (cached) return cached;
      const resolved = await resolveHoloIssueDetails(issue, traceCaches);
      holoTraceCache.set(issue.id, resolved);
      return resolved;
    };

    const resolveConingTrace = async (issue) => {
      if (!issue?.id) return { cutName: '', yarnName: '', twistName: '', rollTypeName: '', yarnKg: null };
      const cached = coningTraceCache.get(issue.id);
      if (cached) return cached;
      const resolved = await resolveConingTraceDetails(issue, { caches: traceCaches, holoIssueDetailsCache });
      coningTraceCache.set(issue.id, resolved);
      return resolved;
    };

    // ============ TREE MODE HELPERS ============
    const MAX_TREE_NODES = 200;
    let treeNodeCount = 0;
    const visitedNodeIds = new Set();

    function createTreeNode(stage, date, barcode, data) {
      return {
        id: `${stage}_${data.pieceId || data.issueId || data.receiveId || data.dispatchId || 'unknown'}`,
        stage, date, barcode, data, children: [], isSearched: false,
      };
    }

    function computeTreeStats(root) {
      if (!root) return { totalNodes: 0, totalBranches: 0, maxDepth: 0, stageBreakdown: {} };
      let totalNodes = 0, totalBranches = 0, maxDepth = 0;
      const stageBreakdown = {};
      function walk(node, depth) {
        totalNodes++;
        if (depth > maxDepth) maxDepth = depth;
        stageBreakdown[node.stage] = (stageBreakdown[node.stage] || 0) + 1;
        if (node.children.length > 1) totalBranches += node.children.length - 1;
        for (const child of node.children) walk(child, depth + 1);
      }
      walk(root, 1);
      return { totalNodes, totalBranches, maxDepth, stageBreakdown };
    }

    // ---- Tree-mode forward trace functions ----

    async function treeBuildFromInbound(item, directCutterReceiveId = null) {
      const lot = await prisma.lot.findUnique({ where: { lotNo: item.lotNo } });
      const itemMaster = lot?.itemId ? await prisma.item.findUnique({ where: { id: lot.itemId } }) : null;
      const firm = lot?.firmId ? await prisma.firm.findUnique({ where: { id: lot.firmId } }) : null;
      const supplier = lot?.supplierId ? await prisma.supplier.findUnique({ where: { id: lot.supplierId } }) : null;

      const nodeData = {
        pieceId: item.id, lotNo: item.lotNo,
        itemName: itemMaster?.name || null, firmName: firm?.name || null,
        supplierName: supplier?.name || null, weight: item.weight,
        status: item.status, dispatchedWeight: item.dispatchedWeight || 0,
      };
      const node = createTreeNode('inbound', lot?.date || null, item.barcode, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      // Forward: cutter issues
      const cutterIssue = await prisma.issueToCutterMachine.findFirst({
        where: { pieceIds: { contains: item.id }, isDeleted: false },
        include: { machine: true, operator: true, cut: true },
      });
      if (cutterIssue && treeNodeCount < MAX_TREE_NODES) {
        const childNode = await treeBuildCutterIssue(cutterIssue, item.id, directCutterReceiveId);
        if (childNode) node.children.push(childNode);
      }

      // Dispatches
      const dispatchNodes = await treeBuildDispatches(item.barcode, 'inbound');
      node.children.push(...dispatchNodes);

      return node;
    }

    async function treeBuildCutterIssue(issue, pieceId, directCutterReceiveId = null) {
      const nodeData = {
        issueId: issue.id, machineName: issue.machine?.name || null,
        operatorName: issue.operator?.name || null, cutName: issue.cut?.name || null,
        totalWeight: issue.totalWeight, pieceCount: issue.count, lotNo: issue.lotNo,
      };
      const node = createTreeNode('cutter_issue', issue.date, issue.barcode, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      if (treeNodeCount >= MAX_TREE_NODES) {
        node.children.push({ truncated: true, hiddenCount: 0 });
        return node;
      }

      if (directCutterReceiveId) {
        const recv = await prisma.receiveFromCutterMachineRow.findFirst({
          where: { id: directCutterReceiveId, isDeleted: false },
          include: { bobbin: true, operator: true, challan: true },
        });
        if (recv) {
          const childNode = await treeBuildCutterReceive(recv);
          if (childNode) node.children.push(childNode);
        }
      } else {
        // findMany — all cutter receives for this piece
        const cutterReceives = await prisma.receiveFromCutterMachineRow.findMany({
          where: { pieceId: pieceId, isDeleted: false },
          include: { bobbin: true, operator: true, challan: true },
          orderBy: { createdAt: 'asc' },
        });
        const childPromises = cutterReceives.filter(() => treeNodeCount < MAX_TREE_NODES).map(recv => treeBuildCutterReceive(recv));
        const children = await Promise.all(childPromises);
        node.children.push(...children.filter(Boolean));
      }

      return node;
    }

    async function treeBuildCutterReceive(recv) {
      let itemName = null, cutName = null;
      if (recv.pieceId) {
        const piece = await prisma.inboundItem.findUnique({ where: { id: recv.pieceId } });
        if (piece?.lotNo) {
          const lot = await prisma.lot.findUnique({ where: { lotNo: piece.lotNo }, include: { item: true } });
          itemName = lot?.item?.name || null;
        }
        const cutterIssue = await prisma.issueToCutterMachine.findFirst({
          where: { pieceIds: { contains: recv.pieceId }, isDeleted: false }, include: { cut: true },
        });
        cutName = cutterIssue?.cut?.name || null;
      }

      const nodeData = {
        receiveId: recv.id, itemName, cutName,
        challanNo: recv.challan?.challanNo || null, bobbinQuantity: recv.bobbinQuantity,
        netWeight: recv.netWt, operatorName: recv.operator?.name || null,
        bobbinName: recv.bobbin?.name || null, dispatchedWeight: recv.dispatchedWeight || 0,
        issuedToHoloWeight: recv.issuedBobbinWeight || 0,
      };
      const node = createTreeNode('cutter_receive', recv.date || recv.challan?.date, recv.barcode || recv.vchNo, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      // Dispatches
      const dispatchNodes = await treeBuildDispatches(recv.barcode || recv.vchNo, 'cutter');
      node.children.push(...dispatchNodes);

      // Forward: holo issues that reference this cutter receive via receivedRowRefs
      if (recv.id && treeNodeCount < MAX_TREE_NODES) {
        const recvIdArray = [recv.id];
        const holoIssueIds = await prisma.$queryRaw`
          SELECT id FROM "IssueToHoloMachine"
          WHERE "isDeleted" = false
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
              WHERE elem->>'rowId' = ANY (${recvIdArray}::text[])
            )
        `;
        if (holoIssueIds && holoIssueIds.length > 0) {
          const childPromises = holoIssueIds.filter(() => treeNodeCount < MAX_TREE_NODES).map(async (row) => {
            const holoIssue = await prisma.issueToHoloMachine.findUnique({
              where: { id: row.id },
              include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
            });
            return holoIssue ? treeBuildHoloIssue(holoIssue) : null;
          });
          const children = await Promise.all(childPromises);
          node.children.push(...children.filter(Boolean));
        }
      }

      return node;
    }

    async function treeBuildHoloIssue(issue, directHoloReceiveId = null) {
      const resolved = await resolveHoloTrace(issue);
      const nodeData = {
        issueId: issue.id, lotNo: issue.lotNo,
        machineName: issue.machine?.name || null, operatorName: issue.operator?.name || null,
        yarnName: resolved.yarnName || null, twistName: resolved.twistName || null,
        cutName: resolved.cutName || null,
        yarnKg: resolved.yarnKg != null ? resolved.yarnKg : (Number.isFinite(Number(issue.yarnKg)) ? Number(issue.yarnKg) : null),
        metallicBobbins: issue.metallicBobbins, metallicBobbinsWeight: issue.metallicBobbinsWeight, shift: issue.shift,
      };
      const node = createTreeNode('holo_issue', issue.date, issue.barcode, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      if (treeNodeCount >= MAX_TREE_NODES) {
        node.children.push({ truncated: true, hiddenCount: 0 });
        return node;
      }

      if (directHoloReceiveId) {
        const recv = await prisma.receiveFromHoloMachineRow.findFirst({
          where: { id: directHoloReceiveId, isDeleted: false },
          include: { operator: true, rollType: true, box: true },
        });
        if (recv) {
          const childNode = await treeBuildHoloReceive(recv);
          if (childNode) node.children.push(childNode);
        }
      } else {
        // findMany — all holo receives for this issue
        const holoReceives = await prisma.receiveFromHoloMachineRow.findMany({
          where: { issueId: issue.id, isDeleted: false },
          include: { operator: true, rollType: true, box: true },
          orderBy: { createdAt: 'asc' },
        });
        const childPromises = holoReceives.filter(() => treeNodeCount < MAX_TREE_NODES).map(recv => treeBuildHoloReceive(recv));
        const children = await Promise.all(childPromises);
        node.children.push(...children.filter(Boolean));
      }

      return node;
    }

    async function treeBuildHoloReceive(recv) {
      const netWeight = recv.rollWeight || ((recv.grossWeight || 0) - (recv.tareWeight || 0));
      let itemName = null, cutName = null, yarnName = null, twistName = null;
      if (recv.issueId) {
        const holoIssue = await prisma.issueToHoloMachine.findUnique({
          where: { id: recv.issueId }, include: { cut: true },
        });
        if (holoIssue) {
          const resolved = await resolveHoloTrace(holoIssue);
          cutName = resolved.cutName || null;
          yarnName = resolved.yarnName || null;
          twistName = resolved.twistName || null;
        }
        if (holoIssue?.lotNo) {
          const lot = await prisma.lot.findUnique({ where: { lotNo: holoIssue.lotNo }, include: { item: true } });
          itemName = lot?.item?.name || null;
        }
      }

      const nodeData = {
        receiveId: recv.id, itemName, cutName, yarnName, twistName,
        rollCount: recv.rollCount, netWeight,
        rollTypeName: recv.rollType?.name || null, operatorName: recv.operator?.name || null,
        boxName: recv.box?.name || null, dispatchedWeight: recv.dispatchedWeight || 0,
      };
      const node = createTreeNode('holo_receive', recv.date, recv.barcode, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      // Dispatches
      if (recv.barcode) {
        const dispatchNodes = await treeBuildDispatches(recv.barcode, 'holo');
        node.children.push(...dispatchNodes);
      }

      if (treeNodeCount >= MAX_TREE_NODES) {
        node.children.push({ truncated: true, hiddenCount: 0 });
        return node;
      }

      // Forward: coning issues referencing this holo receive
      if (recv.id || recv.barcode) {
        const rowIdArray = recv.id ? [recv.id] : ["__none__"];
        const barcodeArray = recv.barcode ? [recv.barcode] : ["__none__"];
        const coningIssueIds = await prisma.$queryRaw`
          SELECT id FROM "IssueToConingMachine"
          WHERE "isDeleted" = false
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
              WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
                 OR elem->>'barcode' = ANY (${barcodeArray}::text[])
            )
        `;
        if (coningIssueIds && coningIssueIds.length > 0) {
          const childPromises = coningIssueIds.filter(() => treeNodeCount < MAX_TREE_NODES).map(async (row) => {
            const coningIssue = await prisma.issueToConingMachine.findUnique({
              where: { id: row.id },
              include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
            });
            return coningIssue ? treeBuildConingIssue(coningIssue) : null;
          });
          const children = await Promise.all(childPromises);
          node.children.push(...children.filter(Boolean));
        }
      }

      return node;
    }

    async function treeBuildConingIssue(issue, directConingReceiveId = null) {
      let itemName = null, cutName = null;
      try {
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') refs = JSON.parse(refs || '[]');
        refs = refs || [];
        const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];
        if (refIds.length > 0) {
          const holoRecv = await prisma.receiveFromHoloMachineRow.findFirst({
            where: { id: { in: refIds }, isDeleted: false },
          });
          if (holoRecv?.issueId) {
            const holoIssue = await prisma.issueToHoloMachine.findUnique({
              where: { id: holoRecv.issueId }, include: { cut: true },
            });
            cutName = holoIssue?.cut?.name || null;
            if (holoIssue?.lotNo) {
              const lot = await prisma.lot.findUnique({ where: { lotNo: holoIssue.lotNo }, include: { item: true } });
              itemName = lot?.item?.name || null;
            }
          }
        }
      } catch { }

      const resolved = await resolveConingTrace(issue);
      const nodeData = {
        issueId: issue.id, itemName, cutName: resolved.cutName || cutName,
        yarnName: resolved.yarnName || null, twistName: resolved.twistName || null,
        yarnKg: resolved.yarnKg != null ? resolved.yarnKg : null,
        lotNo: issue.lotNo, machineName: issue.machine?.name || null,
        operatorName: issue.operator?.name || null, rollsIssued: issue.rollsIssued,
        expectedCones: issue.expectedCones, shift: issue.shift,
      };
      const node = createTreeNode('coning_issue', issue.date, issue.barcode, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      if (treeNodeCount >= MAX_TREE_NODES) {
        node.children.push({ truncated: true, hiddenCount: 0 });
        return node;
      }

      if (directConingReceiveId) {
        const recv = await prisma.receiveFromConingMachineRow.findFirst({
          where: { id: directConingReceiveId, isDeleted: false },
          include: { operator: true, box: true },
        });
        if (recv) {
          const childNode = await treeBuildConingReceive(recv);
          if (childNode) node.children.push(childNode);
        }
      } else {
        // findMany — all coning receives
        const coningReceives = await prisma.receiveFromConingMachineRow.findMany({
          where: { issueId: issue.id, isDeleted: false },
          include: { operator: true, box: true },
          orderBy: { createdAt: 'asc' },
        });
        const childPromises = coningReceives.filter(() => treeNodeCount < MAX_TREE_NODES).map(recv => treeBuildConingReceive(recv));
        const children = await Promise.all(childPromises);
        node.children.push(...children.filter(Boolean));
      }

      return node;
    }

    async function treeBuildConingReceive(recv) {
      let itemName = null, cutName = null, yarnName = null, twistName = null;
      if (recv.issueId) {
        const coningIssue = await prisma.issueToConingMachine.findUnique({ where: { id: recv.issueId } });
        if (coningIssue) {
          try {
            let refs = coningIssue.receivedRowRefs;
            if (typeof refs === 'string') refs = JSON.parse(refs || '[]');
            refs = refs || [];
            const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];
            if (refIds.length > 0) {
              const holoRecv = await prisma.receiveFromHoloMachineRow.findFirst({
                where: { id: { in: refIds }, isDeleted: false },
              });
              if (holoRecv?.issueId) {
                const holoIssue = await prisma.issueToHoloMachine.findUnique({
                  where: { id: holoRecv.issueId }, include: { cut: true },
                });
                if (holoIssue) {
                  const resolved = await resolveHoloTrace(holoIssue);
                  cutName = resolved.cutName || null;
                  yarnName = resolved.yarnName || null;
                  twistName = resolved.twistName || null;
                }
                if (holoIssue?.lotNo) {
                  const lot = await prisma.lot.findUnique({ where: { lotNo: holoIssue.lotNo }, include: { item: true } });
                  itemName = lot?.item?.name || null;
                }
              }
            }
          } catch { }

          const resolvedConing = await resolveConingTrace(coningIssue);
          cutName = resolvedConing.cutName || cutName;
          yarnName = resolvedConing.yarnName || yarnName;
          twistName = resolvedConing.twistName || twistName;
        }
      }

      const nodeData = {
        receiveId: recv.id, itemName, cutName, yarnName, twistName,
        coneCount: recv.coneCount, netWeight: recv.netWeight,
        coneWeight: recv.coneWeight, operatorName: recv.operator?.name || null,
        boxName: recv.box?.name || null, dispatchedWeight: recv.dispatchedWeight || 0,
      };
      const node = createTreeNode('coning_receive', recv.date, recv.barcode, nodeData);
      if (visitedNodeIds.has(node.id)) return node;
      visitedNodeIds.add(node.id);
      treeNodeCount++;

      // Dispatches
      if (recv.barcode) {
        const dispatchNodes = await treeBuildDispatches(recv.barcode, 'coning');
        node.children.push(...dispatchNodes);
      }

      return node;
    }

    async function treeBuildDispatches(barcode, stage) {
      if (!barcode) return [];
      const dispatches = await prisma.dispatch.findMany({
        where: { stageBarcode: { equals: barcode, mode: 'insensitive' }, stage },
        include: { customer: true },
        orderBy: { createdAt: 'asc' },
      });
      return dispatches.filter(() => treeNodeCount < MAX_TREE_NODES).map(d => {
        const nodeData = {
          dispatchId: d.id, challanNo: d.challanNo,
          customerName: d.customer?.name || null, weight: d.weight, sourceStage: d.stage,
        };
        const n = createTreeNode('dispatch', d.date, d.stageBarcode, nodeData);
        if (!visitedNodeIds.has(n.id)) {
          visitedNodeIds.add(n.id);
          treeNodeCount++;
        }
        return n;
      });
    }

    // ---- Tree-mode backward trace (traces back to root, then builds full tree forward) ----

    async function treeTraceFromConingReceive(recv) {
      const issue = await prisma.issueToConingMachine.findFirst({
        where: { id: recv.issueId, isDeleted: false },
        include: { machine: true, operator: true },
      });
      if (issue) return treeTraceFromConingIssue(issue, recv.id);
      return treeBuildConingReceive(recv);
    }

    async function treeTraceFromConingIssue(issue, directConingReceiveId = null) {
      try {
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') refs = JSON.parse(refs || '[]');
        refs = refs || [];
        const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];
        if (refIds.length > 0) {
          const holoReceive = await prisma.receiveFromHoloMachineRow.findFirst({
            where: { id: { in: refIds }, isDeleted: false },
            include: { operator: true, rollType: true, box: true },
          });
          if (holoReceive) return treeTraceFromHoloReceive(holoReceive);
        }
      } catch (err) { console.error('treeTraceFromConingIssue error:', err); }
      // Can't go further back — build forward from this issue
      return treeBuildConingIssue(issue, directConingReceiveId);
    }

    async function treeTraceFromHoloReceive(recv) {
      const issue = await prisma.issueToHoloMachine.findFirst({
        where: { id: recv.issueId, isDeleted: false },
        include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
      });
      if (issue) return treeTraceFromHoloIssue(issue);
      return treeBuildHoloReceive(recv);
    }

    async function treeTraceFromHoloIssue(issue, directHoloReceiveId = null) {
      try {
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') refs = JSON.parse(refs || '[]');
        refs = refs || [];
        const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];
        if (refIds.length > 0) {
          const cutterReceive = await prisma.receiveFromCutterMachineRow.findFirst({
            where: { id: { in: refIds }, isDeleted: false },
            include: { bobbin: true, operator: true, challan: true },
          });
          if (cutterReceive) return treeTraceFromCutterReceive(cutterReceive);
        }
      } catch (err) { console.error('treeTraceFromHoloIssue error:', err); }
      return treeBuildHoloIssue(issue, directHoloReceiveId);
    }

    async function treeTraceFromCutterReceive(recv) {
      const inboundItem = await prisma.inboundItem.findUnique({ where: { id: recv.pieceId } });
      if (inboundItem) return treeBuildFromInbound(inboundItem);  // no directCutterReceiveId — build full tree
      return treeBuildCutterReceive(recv);
    }

    async function treeTraceFromCutterIssue(issue) {
      const pieceIds = issue.pieceIds.split(',').map(p => p.trim()).filter(Boolean);
      if (pieceIds.length > 0) {
        const firstPiece = await prisma.inboundItem.findUnique({ where: { id: pieceIds[0] } });
        if (firstPiece) return treeBuildFromInbound(firstPiece);
      }
      return treeBuildCutterIssue(issue, null);
    }

    function markSearchedNode(root, searchedBarcode, searchedStage) {
      if (!root) return;
      function walk(node) {
        if (node.barcode && node.barcode.toUpperCase() === searchedBarcode.toUpperCase() &&
            (!searchedStage || node.stage === searchedStage)) {
          node.isSearched = true;
        }
        if (node.children) node.children.forEach(walk);
      }
      walk(root);
    }

    // Helper to send response (adds tree data when in treeMode)
    async function sendTreeResponse(treeRoot) {
      if (treeRoot) {
        markSearchedNode(treeRoot, history.resolvedBarcode || normalizedBarcode, history.searchedStage);
        history.tree = treeRoot;
        history.stats = computeTreeStats(treeRoot);
      }
      return res.json({ history });
    }

    // ============ STEP 1: IDENTIFY WHICH STAGE THE BARCODE BELONGS TO ============

    // Legacy receive barcode resolution (opening stock labels)
    const legacyParsed = parseLegacyReceiveBarcode(normalizedBarcode);
    if (legacyParsed?.stage === 'coning') {
      const legacyResolved = await resolveLegacyReceiveRow(normalizedBarcode, { include: { operator: true, box: true } });
      if (legacyResolved?.error === 'ambiguous') {
        return res.status(409).json({ error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.' });
      }
      if (legacyResolved?.row) {
        history.found = true;
        history.searchedStage = 'coning_receive';
        history.resolvedBarcode = legacyResolved.row.barcode;
        if (treeMode) {
          const tree = await treeTraceFromConingReceive(legacyResolved.row);
          return sendTreeResponse(tree);
        }
        await traceFromConingReceive(legacyResolved.row, history);
        return res.json({ history });
      }
    }
    if (legacyParsed?.stage === 'holo') {
      const legacyResolved = await resolveLegacyReceiveRow(normalizedBarcode, { include: { operator: true, rollType: true, box: true } });
      if (legacyResolved?.error === 'ambiguous') {
        return res.status(409).json({ error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.' });
      }
      if (legacyResolved?.row) {
        history.found = true;
        history.searchedStage = 'holo_receive';
        history.resolvedBarcode = legacyResolved.row.barcode;
        if (treeMode) {
          const tree = await treeTraceFromHoloReceive(legacyResolved.row);
          return sendTreeResponse(tree);
        }
        await traceFromHoloReceive(legacyResolved.row, history);
        return res.json({ history });
      }
    }

    // Check Coning Receive
    const coningRecv = await prisma.receiveFromConingMachineRow.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' }, isDeleted: false },
      include: { operator: true, box: true },
    });

    if (coningRecv) {
      history.found = true;
      history.searchedStage = 'coning_receive';
      if (treeMode) {
        const tree = await treeTraceFromConingReceive(coningRecv);
        return sendTreeResponse(tree);
      }
      await traceFromConingReceive(coningRecv, history);
      return res.json({ history });
    }

    // Check Coning Issue
    const coningIssue = await prisma.issueToConingMachine.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' }, isDeleted: false },
      include: { machine: true, operator: true },
    });

    if (coningIssue) {
      history.found = true;
      history.searchedStage = 'coning_issue';
      if (treeMode) {
        const tree = await treeTraceFromConingIssue(coningIssue);
        return sendTreeResponse(tree);
      }
      await traceFromConingIssue(coningIssue, history);
      return res.json({ history });
    }

    // Check Holo Receive
    const holoRecv = await prisma.receiveFromHoloMachineRow.findFirst({
      where: {
        OR: [
          { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
          { notes: { equals: normalizedBarcode, mode: 'insensitive' } },
        ],
        isDeleted: false,
      },
      include: { operator: true, rollType: true, box: true },
    });

    if (holoRecv) {
      history.found = true;
      history.searchedStage = 'holo_receive';
      if (treeMode) {
        const tree = await treeTraceFromHoloReceive(holoRecv);
        return sendTreeResponse(tree);
      }
      await traceFromHoloReceive(holoRecv, history);
      return res.json({ history });
    }

    // Check Holo Issue
    const holoIssue = await prisma.issueToHoloMachine.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' }, isDeleted: false },
      include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
    });

    if (holoIssue) {
      history.found = true;
      history.searchedStage = 'holo_issue';
      if (treeMode) {
        const tree = await treeTraceFromHoloIssue(holoIssue);
        return sendTreeResponse(tree);
      }
      await traceFromHoloIssue(holoIssue, history);
      return res.json({ history });
    }

    // Check Cutter Receive (by vchNo or barcode)
    const cutterRecv = await prisma.receiveFromCutterMachineRow.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
          { vchNo: { equals: normalizedBarcode, mode: 'insensitive' } },
        ],
      },
      include: { bobbin: true, operator: true, challan: true },
    });

    if (cutterRecv) {
      history.found = true;
      history.searchedStage = 'cutter_receive';
      if (treeMode) {
        const tree = await treeTraceFromCutterReceive(cutterRecv);
        return sendTreeResponse(tree);
      }
      await traceFromCutterReceive(cutterRecv, history);
      return res.json({ history });
    }

    // Check Cutter Issue
    const cutterIssue = await prisma.issueToCutterMachine.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' }, isDeleted: false },
      include: { machine: true, operator: true, cut: true },
    });

    if (cutterIssue) {
      history.found = true;
      history.searchedStage = 'cutter_issue';
      if (treeMode) {
        const tree = await treeTraceFromCutterIssue(cutterIssue);
        return sendTreeResponse(tree);
      }
      await traceFromCutterIssue(cutterIssue, history);
      return res.json({ history });
    }

    // Check Inbound
    const inboundItem = await prisma.inboundItem.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
    });

    if (inboundItem) {
      history.found = true;
      history.searchedStage = 'inbound';
      if (treeMode) {
        const tree = await treeBuildFromInbound(inboundItem);
        return sendTreeResponse(tree);
      }
      await traceFromInbound(inboundItem, history);
      return res.json({ history });
    }

    // Not found
    res.json({ history });

    // ============ HELPER FUNCTIONS FOR TRACING ============

    async function traceFromInbound(item, history, directCutterReceiveId = null) {
      const lot = await prisma.lot.findUnique({ where: { lotNo: item.lotNo } });
      const itemMaster = lot?.itemId ? await prisma.item.findUnique({ where: { id: lot.itemId } }) : null;
      const firm = lot?.firmId ? await prisma.firm.findUnique({ where: { id: lot.firmId } }) : null;
      const supplier = lot?.supplierId ? await prisma.supplier.findUnique({ where: { id: lot.supplierId } }) : null;

      history.lineage.push({
        stage: 'inbound',
        date: lot?.date || null,
        barcode: item.barcode,
        data: {
          pieceId: item.id,
          lotNo: item.lotNo,
          itemName: itemMaster?.name || null,
          firmName: firm?.name || null,
          supplierName: supplier?.name || null,
          weight: item.weight,
          status: item.status,
          dispatchedWeight: item.dispatchedWeight || 0,
        },
      });

      // Forward trace: Check if issued to cutter
      const cutterIssue = await prisma.issueToCutterMachine.findFirst({
        where: { pieceIds: { contains: item.id }, isDeleted: false },
        include: { machine: true, operator: true, cut: true },
      });

      if (cutterIssue) {
        // Pass directCutterReceiveId to only show that specific cutter receive
        await addCutterIssueAndForward(cutterIssue, item.id, history, directCutterReceiveId);
      }

      // Check if directly dispatched
      await addDispatchesForItem(item.barcode, 'inbound', history);
    }

    async function addCutterIssueAndForward(issue, pieceId, history, directCutterReceiveId = null) {
      history.lineage.push({
        stage: 'cutter_issue',
        date: issue.date,
        barcode: issue.barcode,
        data: {
          issueId: issue.id,
          machineName: issue.machine?.name || null,
          operatorName: issue.operator?.name || null,
          cutName: issue.cut?.name || null,
          totalWeight: issue.totalWeight,
          pieceCount: issue.count,
          lotNo: issue.lotNo,
        },
      });

      // Forward trace: Check cutter receives
      // If directCutterReceiveId is provided, only show that specific cutter receive (direct lineage only)
      if (directCutterReceiveId) {
        const recv = await prisma.receiveFromCutterMachineRow.findFirst({
          where: { id: directCutterReceiveId, isDeleted: false },
          include: { bobbin: true, operator: true, challan: true },
        });
        if (recv) {
          await addCutterReceiveAndForward(recv, history);
        }
      } else {
        // When scanning inbound directly, show all cutter receives (but only first one traced forward)
        const cutterReceive = await prisma.receiveFromCutterMachineRow.findFirst({
          where: { pieceId: pieceId, isDeleted: false },
          include: { bobbin: true, operator: true, challan: true },
          orderBy: { createdAt: 'asc' },
        });

        if (cutterReceive) {
          await addCutterReceiveAndForward(cutterReceive, history);
        }
      }
    }

    async function addCutterReceiveAndForward(recv, history) {
      // Look up item and cut from the cutter issue (via pieceId -> inbound -> lot)
      let itemName = null;
      let cutName = null;
      if (recv.pieceId) {
        const piece = await prisma.inboundItem.findUnique({ where: { id: recv.pieceId } });
        if (piece?.lotNo) {
          const lot = await prisma.lot.findUnique({ where: { lotNo: piece.lotNo }, include: { item: true } });
          itemName = lot?.item?.name || null;
        }
        // Get cut from the cutter issue that used this piece
        const cutterIssue = await prisma.issueToCutterMachine.findFirst({
          where: { pieceIds: { contains: recv.pieceId }, isDeleted: false },
          include: { cut: true },
        });
        cutName = cutterIssue?.cut?.name || null;
      }

      history.lineage.push({
        stage: 'cutter_receive',
        date: recv.date || recv.challan?.date,
        barcode: recv.barcode || recv.vchNo,
        data: {
          receiveId: recv.id,
          itemName: itemName,
          cutName: cutName,
          challanNo: recv.challan?.challanNo || null,
          bobbinQuantity: recv.bobbinQuantity,
          netWeight: recv.netWt,
          operatorName: recv.operator?.name || null,
          bobbinName: recv.bobbin?.name || null,
          dispatchedWeight: recv.dispatchedWeight || 0,
          issuedToHoloWeight: recv.issuedBobbinWeight || 0,
        },
      });

      // Check if directly dispatched (do not trace forward to all sibling holo issues)
      await addDispatchesForItem(recv.barcode || recv.vchNo, 'cutter', history);
    }

    async function addHoloIssueAndForward(issue, history, directHoloReceiveId = null) {
      // Avoid duplicates
      if (history.lineage.find(l => l.stage === 'holo_issue' && l.data.issueId === issue.id)) return;

      const resolved = await resolveHoloTrace(issue);

      history.lineage.push({
        stage: 'holo_issue',
        date: issue.date,
        barcode: issue.barcode,
        data: {
          issueId: issue.id,
          lotNo: issue.lotNo,
          machineName: issue.machine?.name || null,
          operatorName: issue.operator?.name || null,
          yarnName: resolved.yarnName || null,
          twistName: resolved.twistName || null,
          cutName: resolved.cutName || null,
          yarnKg: resolved.yarnKg != null ? resolved.yarnKg : (Number.isFinite(Number(issue.yarnKg)) ? Number(issue.yarnKg) : null),
          metallicBobbins: issue.metallicBobbins,
          metallicBobbinsWeight: issue.metallicBobbinsWeight,
          shift: issue.shift,
        },
      });

      // Forward trace: Check holo receives
      // If directHoloReceiveId is provided, only show that specific holo receive (direct lineage only)
      if (directHoloReceiveId) {
        const recv = await prisma.receiveFromHoloMachineRow.findFirst({
          where: { id: directHoloReceiveId, isDeleted: false },
          include: { operator: true, rollType: true, box: true },
        });
        if (recv) {
          await addHoloReceiveAndForward(recv, history);
        }
      } else {
        // When scanning holo issue directly, show first holo receive
        const holoReceive = await prisma.receiveFromHoloMachineRow.findFirst({
          where: { issueId: issue.id, isDeleted: false },
          include: { operator: true, rollType: true, box: true },
          orderBy: { createdAt: 'asc' },
        });

        if (holoReceive) {
          await addHoloReceiveAndForward(holoReceive, history);
        }
      }
    }

    async function addHoloReceiveAndForward(recv, history) {
      // Avoid duplicates
      if (history.lineage.find(l => l.stage === 'holo_receive' && l.data.receiveId === recv.id)) return;

      // rollWeight is the TOTAL net weight (not per-roll), so use it directly if available
      // Otherwise calculate from gross - tare
      const netWeight = recv.rollWeight || ((recv.grossWeight || 0) - (recv.tareWeight || 0));

      // Look up item and cut from the holo issue
      let itemName = null;
      let cutName = null;
      let yarnName = null;
      let twistName = null;
      if (recv.issueId) {
        const holoIssue = await prisma.issueToHoloMachine.findUnique({
          where: { id: recv.issueId },
          include: { cut: true },
        });
        if (holoIssue) {
          const resolved = await resolveHoloTrace(holoIssue);
          cutName = resolved.cutName || null;
          yarnName = resolved.yarnName || null;
          twistName = resolved.twistName || null;
        }
        // Get item from the lot
        if (holoIssue?.lotNo) {
          const lot = await prisma.lot.findUnique({ where: { lotNo: holoIssue.lotNo }, include: { item: true } });
          itemName = lot?.item?.name || null;
        }
      }

      history.lineage.push({
        stage: 'holo_receive',
        date: recv.date,
        barcode: recv.barcode,
        data: {
          receiveId: recv.id,
          itemName: itemName,
          cutName: cutName,
          yarnName: yarnName,
          twistName: twistName,
          rollCount: recv.rollCount,
          netWeight: netWeight,
          rollTypeName: recv.rollType?.name || null,
          operatorName: recv.operator?.name || null,
          boxName: recv.box?.name || null,
          dispatchedWeight: recv.dispatchedWeight || 0,
        },
      });

      // Check if directly dispatched (do not trace forward to all sibling coning issues)
      if (recv.barcode) {
        await addDispatchesForItem(recv.barcode, 'holo', history);
      }

      // Forward trace to coning issue that references this specific holo receive (direct lineage only)
      if (recv.id || recv.barcode) {
        const rowIdArray = recv.id ? [recv.id] : ["__none__"];
        const barcodeArray = recv.barcode ? [recv.barcode] : ["__none__"];
        const coningIssues = await prisma.$queryRaw`
          SELECT id FROM "IssueToConingMachine"
          WHERE "isDeleted" = false
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
              WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
                 OR elem->>'barcode' = ANY (${barcodeArray}::text[])
            )
          LIMIT 1
        `;
        if (coningIssues && coningIssues.length > 0) {
          const coningIssue = await prisma.issueToConingMachine.findUnique({
            where: { id: coningIssues[0].id },
            include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
          });
          if (coningIssue) {
            await addConingIssueAndForward(coningIssue, history);
          }
        }
      }
    }

    async function addConingIssueAndForward(issue, history, directConingReceiveId = null) {
      // Avoid duplicates
      if (history.lineage.find(l => l.stage === 'coning_issue' && l.data.issueId === issue.id)) return;

      // Look up item and cut from holo receives -> holo issue
      let itemName = null;
      let cutName = null;
      try {
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') {
          refs = JSON.parse(refs || '[]');
        }
        refs = refs || [];
        const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];
        if (refIds.length > 0) {
          const holoRecv = await prisma.receiveFromHoloMachineRow.findFirst({
            where: { id: { in: refIds }, isDeleted: false },
          });
          if (holoRecv?.issueId) {
            const holoIssue = await prisma.issueToHoloMachine.findUnique({
              where: { id: holoRecv.issueId },
              include: { cut: true },
            });
            cutName = holoIssue?.cut?.name || null;
            if (holoIssue?.lotNo) {
              const lot = await prisma.lot.findUnique({ where: { lotNo: holoIssue.lotNo }, include: { item: true } });
              itemName = lot?.item?.name || null;
            }
          }
        }
      } catch { }

      const resolved = await resolveConingTrace(issue);

      history.lineage.push({
        stage: 'coning_issue',
        date: issue.date,
        barcode: issue.barcode,
        data: {
          issueId: issue.id,
          itemName: itemName,
          cutName: resolved.cutName || cutName,
          yarnName: resolved.yarnName || null,
          twistName: resolved.twistName || null,
          yarnKg: resolved.yarnKg != null ? resolved.yarnKg : null,
          lotNo: issue.lotNo,
          machineName: issue.machine?.name || null,
          operatorName: issue.operator?.name || null,
          rollsIssued: issue.rollsIssued,
          expectedCones: issue.expectedCones,
          shift: issue.shift,
        },
      });

      // Forward trace: Check coning receives
      // If directConingReceiveId is provided, only show that specific coning receive (direct lineage only)
      if (directConingReceiveId) {
        const recv = await prisma.receiveFromConingMachineRow.findFirst({
          where: { id: directConingReceiveId, isDeleted: false },
          include: { operator: true, box: true },
        });
        if (recv) {
          await addConingReceive(recv, history);
        }
      } else {
        // When scanning coning issue directly, show first coning receive
        const coningReceive = await prisma.receiveFromConingMachineRow.findFirst({
          where: { issueId: issue.id, isDeleted: false },
          include: { operator: true, box: true },
          orderBy: { createdAt: 'asc' },
        });

        if (coningReceive) {
          await addConingReceive(coningReceive, history);
        }
      }
    }

    async function addConingReceive(recv, history) {
      // Avoid duplicates
      if (history.lineage.find(l => l.stage === 'coning_receive' && l.data.receiveId === recv.id)) return;

      // Look up item and cut from coning issue -> holo receives -> holo issue
      let itemName = null;
      let cutName = null;
      let yarnName = null;
      let twistName = null;
      if (recv.issueId) {
        const coningIssue = await prisma.issueToConingMachine.findUnique({
          where: { id: recv.issueId },
        });
        if (coningIssue) {
          try {
            let refs = coningIssue.receivedRowRefs;
            if (typeof refs === 'string') {
              refs = JSON.parse(refs || '[]');
            }
            refs = refs || [];
            const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];
            if (refIds.length > 0) {
              const holoRecv = await prisma.receiveFromHoloMachineRow.findFirst({
                where: { id: { in: refIds }, isDeleted: false },
              });
              if (holoRecv?.issueId) {
                const holoIssue = await prisma.issueToHoloMachine.findUnique({
                  where: { id: holoRecv.issueId },
                  include: { cut: true },
                });
                if (holoIssue) {
                  const resolved = await resolveHoloTrace(holoIssue);
                  cutName = resolved.cutName || null;
                  yarnName = resolved.yarnName || null;
                  twistName = resolved.twistName || null;
                }
                if (holoIssue?.lotNo) {
                  const lot = await prisma.lot.findUnique({ where: { lotNo: holoIssue.lotNo }, include: { item: true } });
                  itemName = lot?.item?.name || null;
                }
              }
            }
          } catch { }

          const resolvedConing = await resolveConingTrace(coningIssue);
          cutName = resolvedConing.cutName || cutName;
          yarnName = resolvedConing.yarnName || yarnName;
          twistName = resolvedConing.twistName || twistName;
        }
      }

      history.lineage.push({
        stage: 'coning_receive',
        date: recv.date,
        barcode: recv.barcode,
        data: {
          receiveId: recv.id,
          itemName: itemName,
          cutName: cutName,
          yarnName: yarnName,
          twistName: twistName,
          coneCount: recv.coneCount,
          netWeight: recv.netWeight,
          coneWeight: recv.coneWeight,
          operatorName: recv.operator?.name || null,
          boxName: recv.box?.name || null,
          dispatchedWeight: recv.dispatchedWeight || 0,
        },
      });

      // Check if dispatched
      if (recv.barcode) {
        await addDispatchesForItem(recv.barcode, 'coning', history);
      }
    }

    async function addDispatchesForItem(barcode, stage, history) {
      if (!barcode) return;
      const dispatches = await prisma.dispatch.findMany({
        where: { stageBarcode: { equals: barcode, mode: 'insensitive' }, stage },
        include: { customer: true },
        orderBy: { createdAt: 'asc' },
      });

      for (const d of dispatches) {
        if (history.lineage.find(l => l.stage === 'dispatch' && l.data.dispatchId === d.id)) continue;
        history.lineage.push({
          stage: 'dispatch',
          date: d.date,
          barcode: d.stageBarcode,
          data: {
            dispatchId: d.id,
            challanNo: d.challanNo,
            customerName: d.customer?.name || null,
            weight: d.weight,
            sourceStage: d.stage,
          },
        });
      }
    }

    // ============ BACKWARD TRACING FUNCTIONS ============

    async function traceFromConingReceive(recv, history) {
      const issue = await prisma.issueToConingMachine.findFirst({
        where: { id: recv.issueId, isDeleted: false },
        include: { machine: true, operator: true },
      });

      if (issue) {
        // Pass the specific coning receive ID for direct lineage filtering
        await traceFromConingIssue(issue, history, recv.id);
      } else {
        // If no issue found, just add the coning receive
        await addConingReceive(recv, history);
      }
    }

    async function traceFromConingIssue(issue, history, directConingReceiveId = null) {
      // Get holo receives referenced - only trace from first one (direct lineage)
      try {
        // receivedRowRefs is a Prisma Json field - might be already parsed or a string
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') {
          refs = JSON.parse(refs || '[]');
        }
        refs = refs || [];

        // refs is array of objects with rowId property
        const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];

        if (refIds.length > 0) {
          // Get only the first holo receive for direct lineage
          const holoReceive = await prisma.receiveFromHoloMachineRow.findFirst({
            where: { id: { in: refIds }, isDeleted: false },
            include: { operator: true, rollType: true, box: true },
          });

          if (holoReceive) {
            // Trace from this single holo receive (direct lineage only)
            await traceFromHoloReceive(holoReceive, history);
          }
        }
      } catch (err) {
        console.error('traceFromConingIssue error:', err);
      }

      // Add coning issue - pass directConingReceiveId to show only that specific coning receive
      await addConingIssueAndForward(issue, history, directConingReceiveId);
    }

    async function traceFromHoloReceive(recv, history) {
      const issue = await prisma.issueToHoloMachine.findFirst({
        where: { id: recv.issueId, isDeleted: false },
        include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
      });

      if (issue) {
        // Pass the specific holo receive ID for direct lineage filtering
        await traceFromHoloIssue(issue, history, recv.id);
      } else {
        // If no issue found, just add the holo receive
        await addHoloReceiveAndForward(recv, history);
      }
    }

    async function traceFromHoloIssue(issue, history, directHoloReceiveId = null) {
      // Get cutter receives referenced - only trace from first one (direct lineage)
      try {
        // receivedRowRefs is a Prisma Json field - might be already parsed or a string
        let refs = issue.receivedRowRefs;
        if (typeof refs === 'string') {
          refs = JSON.parse(refs || '[]');
        }
        refs = refs || [];

        // refs is array of objects with rowId property
        const refIds = Array.isArray(refs) ? refs.map(r => r.rowId || r).filter(Boolean) : [];

        if (refIds.length > 0) {
          // Get only the first cutter receive for direct lineage
          const cutterReceive = await prisma.receiveFromCutterMachineRow.findFirst({
            where: { id: { in: refIds }, isDeleted: false },
            include: { bobbin: true, operator: true, challan: true },
          });

          if (cutterReceive) {
            // Trace from this single cutter receive (direct lineage only)
            await traceFromCutterReceive(cutterReceive, history);
          }
        }
      } catch (err) {
        console.error('traceFromHoloIssue error:', err);
      }

      // Add holo issue - pass directHoloReceiveId to show only that specific holo receive
      await addHoloIssueAndForward(issue, history, directHoloReceiveId);
    }

    async function traceFromCutterReceive(recv, history) {
      // Get the inbound item (pieceId)
      const inboundItem = await prisma.inboundItem.findUnique({
        where: { id: recv.pieceId },
      });

      if (inboundItem) {
        // Pass the specific cutter receive ID for direct lineage filtering
        await traceFromInbound(inboundItem, history, recv.id);
      } else {
        // Just add cutter receive
        await addCutterReceiveAndForward(recv, history);
      }
    }

    async function traceFromCutterIssue(issue, history) {
      // Get piece IDs
      const pieceIds = issue.pieceIds.split(',').map(p => p.trim()).filter(Boolean);

      if (pieceIds.length > 0) {
        // Trace from first piece
        const firstPiece = await prisma.inboundItem.findUnique({ where: { id: pieceIds[0] } });
        if (firstPiece) {
          await traceFromInbound(firstPiece, history);
        }
      } else {
        // Just add cutter issue  
        history.lineage.push({
          stage: 'cutter_issue',
          date: issue.date,
          barcode: issue.barcode,
          data: {
            issueId: issue.id,
            lotNo: issue.lotNo,
            machineName: issue.machine?.name || null,
            operatorName: issue.operator?.name || null,
            cutName: issue.cut?.name || null,
            totalWeight: issue.totalWeight,
            pieceCount: issue.count,
          },
        });
      }
    }

  } catch (err) {
    console.error('Failed to fetch barcode history', err);
    res.status(500).json({ error: 'Failed to fetch barcode history' });
  }
});

// Production Report
router.get('/api/reports/production', requirePermission('reports', PERM_READ), async (req, res) => {
  try {
    const { process, view, from, to } = req.query;

    // Default to last 30 days
    const toDate = to || new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const report = {
      process: process || 'all',
      view: view || 'machine',
      dateRange: { from: fromDate, to: toDate },
      summary: {
        totalIssued: 0,
        totalReceived: 0,
        totalWastage: 0,
        efficiency: 0,
      },
      data: [],
    };

    // Helper to calculate efficiency using actual issued weight
    const calcEfficiency = (issued, received) => {
      if (!issued || issued === 0) return 0;
      return Math.round((received / issued) * 100 * 10) / 10;
    };

    // Aggregate based on process type
    if (process === 'cutter' || !process || process === 'all') {
      // Get ACTUAL issued weight from IssueToCutterMachine
      const cutterIssues = await prisma.issueToCutterMachine.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
          isDeleted: false,
        },
      });
      const totalCutterIssued = cutterIssues.reduce((sum, i) => sum + (i.totalWeight || 0), 0);

      // Get cutter receive data - aggregate from actual rows with date filter (not lifetime PieceTotal)
      const cutterReceives = await prisma.receiveFromCutterMachineRow.findMany({
        where: {
          isDeleted: false,
          date: { gte: fromDate, lte: toDate },
        },
        include: { operator: true },
      });

      // Calculate totals from date-filtered receive rows
      const totalCutterReceived = cutterReceives.reduce((sum, r) => sum + (r.netWt || 0), 0);
      // Wastage is calculated as difference between issued and received for the period
      const totalCutterWastage = Math.max(0, totalCutterIssued - totalCutterReceived);

      if (!process || process === 'all' || process === 'cutter') {
        report.summary.totalIssued += totalCutterIssued;
        report.summary.totalReceived += totalCutterReceived;
        report.summary.totalWastage += totalCutterWastage;
      }

      // Group by view type
      if (view === 'operator') {
        const byOperator = new Map();
        for (const row of cutterReceives) {
          const key = row.operatorId || 'unknown';
          const current = byOperator.get(key) || { operatorId: key, operatorName: row.operator?.name || 'Unknown', received: 0, count: 0 };
          current.received += row.netWt || 0;
          current.count += 1;
          byOperator.set(key, current);
        }
        if (process === 'cutter') {
          report.data = Array.from(byOperator.values());
        }
      } else if (view === 'shift') {
        const byShift = new Map();
        for (const row of cutterReceives) {
          const key = row.shift || 'Not Specified';
          const current = byShift.get(key) || { shift: key, received: 0, count: 0 };
          current.received += row.netWt || 0;
          current.count += 1;
          byShift.set(key, current);
        }
        if (process === 'cutter') {
          report.data = Array.from(byShift.values());
        }
      } else if (view === 'item') {
        const byItem = new Map();
        for (const row of cutterReceives) {
          const itemName = row.itemName || 'Unknown Item';
          const cut = row.cut || '';
          const key = `${itemName}|${cut}`;
          const current = byItem.get(key) || { itemName, cut, received: 0, count: 0 };
          current.received += row.netWt || 0;
          current.count += 1;
          byItem.set(key, current);
        }
        if (process === 'cutter') {
          report.data = Array.from(byItem.values());
        }
      } else if (view === 'yarn') {
        const byYarn = new Map();
        for (const row of cutterReceives) {
          const key = row.yarnName || 'Unknown Yarn';
          const current = byYarn.get(key) || { yarnName: key, received: 0, count: 0 };
          current.received += row.netWt || 0;
          current.count += 1;
          byYarn.set(key, current);
        }
        if (process === 'cutter') {
          report.data = Array.from(byYarn.values());
        }
      } else {
        // Machine-wise (default)
        const byMachine = new Map();
        for (const row of cutterReceives) {
          const fullName = row.machineNo || 'unknown';
          const parts = fullName.split('-');
          const key = parts.length > 1 ? parts[0] : fullName;

          const current = byMachine.get(key) || { machineNo: key, received: 0, count: 0 };
          current.received += row.netWt || 0;
          current.count += 1;
          byMachine.set(key, current);
        }
        if (process === 'cutter') {
          report.data = Array.from(byMachine.values());
        } else if (!process || process === 'all') {
          // For 'All Processes', we can't easily mix machine-wise data from different stages 
          // because the fields differ. However, we can push normalized objects or simply allow the UI to handle it.
          // A better approach for "All Processes" is to perhaps NOT show the detailed table, 
          // OR show a combined list if the UI supports it.
          // Given the current UI structure, let's try to populate report.data with a generic structure
          // identifying the process.
          const cutterData = Array.from(byMachine.values()).map(d => ({ ...d, process: 'Cutter' }));
          report.data.push(...cutterData);
        }
      }
    }

    if (process === 'holo' || !process || process === 'all') {
      // Get ACTUAL issued weight from IssueToHoloMachine
      const holoIssues = await prisma.issueToHoloMachine.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
          isDeleted: false,
        },
      });
      // Holo issued weight = metallicBobbinsWeight + yarnKg
      const totalHoloIssued = holoIssues.reduce((sum, i) => sum + (i.metallicBobbinsWeight || 0) + (i.yarnKg || 0), 0);


      // Get holo receive data - aggregate from actual rows with date filter
      const holoReceives = await prisma.receiveFromHoloMachineRow.findMany({
        where: {
          isDeleted: false,
          date: { gte: fromDate, lte: toDate },
        },
        include: { operator: true, issue: { include: { machine: true, cut: true } } },
      });

      // Build fallback context: extract all cutter row IDs from receivedRowRefs for cut resolution
      const allCutterRowIds = new Set();
      holoReceives.forEach(r => {
        const refs = Array.isArray(r.issue?.receivedRowRefs) ? r.issue.receivedRowRefs : [];
        refs.forEach(ref => {
          if (typeof ref?.rowId === 'string') allCutterRowIds.add(ref.rowId);
        });
      });
      const cutterRowsForFallback = allCutterRowIds.size > 0
        ? await prisma.receiveFromCutterMachineRow.findMany({
          where: { id: { in: Array.from(allCutterRowIds) } },
          select: { id: true, cutId: true, cut: true, cutMaster: { select: { name: true } } },
        })
        : [];
      const cutterRowMap = new Map(cutterRowsForFallback.map(r => [r.id, r]));

      // Fetch all cuts for lookup
      const allCutIds = new Set();
      holoReceives.forEach(r => { if (r.issue?.cutId) allCutIds.add(r.issue.cutId); });
      cutterRowsForFallback.forEach(r => { if (r.cutId) allCutIds.add(r.cutId); });
      const cutsForLookup = allCutIds.size > 0
        ? await prisma.cut.findMany({ where: { id: { in: Array.from(allCutIds) } }, select: { id: true, name: true } })
        : [];
      const cutLookupMap = new Map(cutsForLookup.map(c => [c.id, c.name]));

      // Helper: Resolve cut with fallback to source cutter rows
      const resolveCutWithFallback = (issue) => {
        // Priority 1: Direct cutId on issue
        if (issue?.cutId) {
          const name = issue.cut?.name || cutLookupMap.get(issue.cutId) || '';
          if (name) return { cutId: issue.cutId, cutName: name };
        }
        // Priority 2: Trace through receivedRowRefs to cutter rows
        const refs = Array.isArray(issue?.receivedRowRefs) ? issue.receivedRowRefs : [];
        for (const ref of refs) {
          if (typeof ref?.rowId !== 'string') continue;
          const cutterRow = cutterRowMap.get(ref.rowId);
          if (!cutterRow) continue;
          // Try cutId first
          if (cutterRow.cutId) {
            const name = cutLookupMap.get(cutterRow.cutId) || cutterRow.cutMaster?.name || '';
            if (name) return { cutId: cutterRow.cutId, cutName: name };
          }
          // Try string cut field
          if (typeof cutterRow.cut === 'string' && cutterRow.cut) {
            return { cutId: 'legacy', cutName: cutterRow.cut };
          }
          // Try cutMaster
          if (cutterRow.cutMaster?.name) {
            return { cutId: 'legacy', cutName: cutterRow.cutMaster.name };
          }
        }
        return { cutId: 'none', cutName: '' };
      };

      // Calculate totals from date-filtered receive rows
      // rollWeight is the total net weight for holo receives
      const totalHoloReceived = holoReceives.reduce((sum, r) => {
        const netWt = r.rollWeight || ((r.grossWeight || 0) - (r.tareWeight || 0));
        return sum + netWt;
      }, 0);
      // Wastage is calculated as difference between issued and received for the period
      const totalHoloWastage = Math.max(0, totalHoloIssued - totalHoloReceived);

      if (!process || process === 'all' || process === 'holo') {
        report.summary.totalIssued += totalHoloIssued;
        report.summary.totalReceived += totalHoloReceived;
        report.summary.totalWastage += totalHoloWastage;
      }

      if (view === 'operator' && process === 'holo') {
        const byOperator = new Map();
        for (const row of holoReceives) {
          const key = row.operatorId || 'unknown';
          const netWeight = row.rollWeight ? row.rollWeight : (row.grossWeight || 0) - (row.tareWeight || 0);
          const current = byOperator.get(key) || { operatorId: key, operatorName: row.operator?.name || 'Unknown', received: 0, rollCount: 0 };
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byOperator.set(key, current);
        }
        report.data = Array.from(byOperator.values());
      } else if (view === 'shift' && process === 'holo') {
        const byShift = new Map();
        for (const row of holoReceives) {
          const key = row.issue?.shift || 'Not Specified';
          const netWeight = row.rollWeight ? row.rollWeight : (row.grossWeight || 0) - (row.tareWeight || 0);
          const current = byShift.get(key) || { shift: key, received: 0, rollCount: 0 };
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byShift.set(key, current);
        }
        report.data = Array.from(byShift.values());
      } else if (view === 'item' && process === 'holo') {
        const byItem = new Map();
        const itemIds = [...new Set(holoReceives.map(r => r.issue?.itemId).filter(Boolean))];
        const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
        const itemMap = new Map(items.map(i => [i.id, i.name]));

        for (const row of holoReceives) {
          const itemId = row.issue?.itemId || 'unknown';
          const itemName = itemMap.get(itemId) || 'Unknown Item';
          const resolved = resolveCutWithFallback(row.issue);
          const cutName = resolved.cutName;
          const cutId = resolved.cutId;
          const key = `${itemId}|${cutId}`;
          const netWeight = row.rollWeight ? row.rollWeight : (row.grossWeight || 0) - (row.tareWeight || 0);
          const current = byItem.get(key) || { itemId, itemName, cutName, cutId, received: 0, rollCount: 0 };
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byItem.set(key, current);
        }
        report.data = Array.from(byItem.values());
      } else if (view === 'yarn' && process === 'holo') {
        const byYarn = new Map();
        const yarnIds = [...new Set(holoReceives.map(r => r.issue?.yarnId).filter(Boolean))];
        const yarns = await prisma.yarn.findMany({ where: { id: { in: yarnIds } } });
        const yarnMap = new Map(yarns.map(y => [y.id, y.name]));

        for (const row of holoReceives) {
          const yarnId = row.issue?.yarnId || 'unknown';
          const yarnName = yarnMap.get(yarnId) || 'Unknown Yarn';
          const netWeight = row.rollWeight ? row.rollWeight : (row.grossWeight || 0) - (row.tareWeight || 0);
          const current = byYarn.get(yarnId) || { yarnId, yarnName, received: 0, rollCount: 0 };
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byYarn.set(yarnId, current);
        }
        report.data = Array.from(byYarn.values());
      } else { // Default to machine-wise
        const byMachine = new Map();
        for (const row of holoReceives) {
          const fullName = row.issue?.machine?.name || row.machineNo || 'unknown';
          // Extract base machine name (e.g. "H12-B1" -> "H12")
          const parts = fullName.split('-');
          const key = parts.length > 1 ? parts[0] : fullName;

          const current = byMachine.get(key) || { machineName: key, received: 0, rollCount: 0 };
          const netWeight = row.rollWeight ? row.rollWeight : (row.grossWeight || 0) - (row.tareWeight || 0);
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byMachine.set(key, current);
        }
        if (process === 'holo') {
          report.data = Array.from(byMachine.values());
        } else if (!process || process === 'all') {
          const holoData = Array.from(byMachine.values()).map(d => ({ ...d, process: 'Holo' }));
          report.data.push(...holoData);
        }
      }
    }

    if (process === 'coning' || !process || process === 'all') {
      // Get ACTUAL issued weight from IssueToConingMachine
      // Coning issues weight = rollsIssued * (avg roll weight from holo) - but we need to calculate this differently
      // For coning, the input is rolls from holo. We need to get the weight of rolled issued.
      // The IssueToConingMachine has receivedRowRefs which references holo receive rows
      const coningIssues = await prisma.issueToConingMachine.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
          isDeleted: false,
        },
      });

      // Calculate coning issued weight by summing up requiredPerConeNetWeight * expectedCones  
      // or we can use rollsIssued and lookup the actual roll weights
      // Simpler approach: use expectedCones * requiredPerConeNetWeight as the target input
      let totalConingIssued = 0;
      for (const issue of coningIssues) {
        // If we have receivedRowRefs, try to get actual weights from holo receives
        try {
          let refs = JSON.parse(issue.receivedRowRefs || '[]');
          if (Array.isArray(refs) && refs.length > 0) {
            const rowIds = refs.map(r => (typeof r === 'object' && r.rowId) ? r.rowId : r);
            const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
              where: { id: { in: rowIds }, isDeleted: false },
            });
            const issuedWeight = holoRows.reduce((sum, r) => {
              const netWeight = r.rollWeight ? r.rollWeight : (r.grossWeight || 0) - (r.tareWeight || 0);
              return sum + netWeight;
            }, 0);
            totalConingIssued += issuedWeight;
          } else {
            // Fallback: use expectedCones * requiredPerConeNetWeight
            totalConingIssued += (issue.expectedCones || 0) * (issue.requiredPerConeNetWeight || 0);
          }
        } catch {
          totalConingIssued += (issue.expectedCones || 0) * (issue.requiredPerConeNetWeight || 0);
        }
      }

      // Get coning receive data - aggregate from actual rows with date filter
      const coningReceives = await prisma.receiveFromConingMachineRow.findMany({
        where: {
          isDeleted: false,
          date: { gte: fromDate, lte: toDate },
        },
        include: {
          operator: true,
          issue: {
            select: {
              id: true,
              lotNo: true,
              itemId: true,
              cutId: true,
              yarnId: true,
              twistId: true,
              shift: true,
              requiredPerConeNetWeight: true,
              expectedCones: true,
              receivedRowRefs: true,
              machine: true,
              yarn: true,
              twist: true,
              cut: true,
            },
          },
        },
      });

      const coningTraceCaches = createTraceCaches();
      const coningHoloIssueDetailsCache = new Map();
      const coningIssueTraceCache = new Map();
      const resolveConingIssueTrace = async (issue) => {
        if (!issue?.id) return null;
        const cached = coningIssueTraceCache.get(issue.id);
        if (cached) return cached;
        const resolved = await resolveConingTraceDetails(issue, { caches: coningTraceCaches, holoIssueDetailsCache: coningHoloIssueDetailsCache });
        coningIssueTraceCache.set(issue.id, resolved);
        return resolved;
      };
      const issuesForTrace = new Map();
      coningReceives.forEach((row) => {
        if (row.issue?.id && !issuesForTrace.has(row.issue.id)) {
          issuesForTrace.set(row.issue.id, row.issue);
        }
      });
      for (const issue of issuesForTrace.values()) {
        await resolveConingIssueTrace(issue);
      }

      // Calculate totals from date-filtered receive rows
      const totalConingReceived = coningReceives.reduce((sum, r) => sum + (r.netWeight || 0), 0);
      // Wastage is calculated as difference between issued and received for the period
      const totalConingWastage = Math.max(0, totalConingIssued - totalConingReceived);

      if (!process || process === 'all' || process === 'coning') {
        report.summary.totalIssued += totalConingIssued;
        report.summary.totalReceived += totalConingReceived;
        report.summary.totalWastage += totalConingWastage;
      }

      if (view === 'operator' && process === 'coning') {
        const byOperator = new Map();
        for (const row of coningReceives) {
          const key = row.operatorId || 'unknown';
          const current = byOperator.get(key) || { operatorId: key, operatorName: row.operator?.name || 'Unknown', received: 0, coneCount: 0 };
          current.received += row.netWeight || 0;
          current.coneCount += row.coneCount || 0;
          byOperator.set(key, current);
        }
        report.data = Array.from(byOperator.values());
      } else if (view === 'shift' && process === 'coning') {
        const byShift = new Map();
        for (const row of coningReceives) {
          const key = row.issue?.shift || 'Not Specified';
          const current = byShift.get(key) || { shift: key, received: 0, coneCount: 0 };
          current.received += row.netWeight || 0;
          current.coneCount += row.coneCount || 0;
          byShift.set(key, current);
        }
        report.data = Array.from(byShift.values());
      } else if (view === 'item' && process === 'coning') {
        const byItem = new Map();
        const itemIds = [...new Set(coningReceives.map(r => r.issue?.itemId).filter(Boolean))];
        const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
        const itemMap = new Map(items.map(i => [i.id, i.name]));

        for (const row of coningReceives) {
          const trace = row.issue?.id ? coningIssueTraceCache.get(row.issue.id) : null;
          const resolvedCutName = trace?.cutName || row.issue?.cut?.name || '';
          const itemId = row.issue?.itemId || 'unknown';
          const itemName = itemMap.get(itemId) || 'Unknown Item';
          const cutId = row.issue?.cutId || (resolvedCutName ? `name:${resolvedCutName}` : 'none');
          const cutName = resolvedCutName || '';
          const key = `${itemId}|${cutId}`;
          const current = byItem.get(key) || { itemId, itemName, cutId, cutName, received: 0, coneCount: 0 };
          current.received += row.netWeight || 0;
          current.coneCount += row.coneCount || 0;
          byItem.set(key, current);
        }
        report.data = Array.from(byItem.values());
      } else if (view === 'yarn' && process === 'coning') {
        // Coning issue has yarnId - group by yarn
        const byYarn = new Map();
        for (const row of coningReceives) {
          const trace = row.issue?.id ? coningIssueTraceCache.get(row.issue.id) : null;
          const resolvedYarnName = trace?.yarnName || row.issue?.yarn?.name || '';
          const yarnId = row.issue?.yarnId || (resolvedYarnName ? `name:${resolvedYarnName}` : 'unknown');
          const yarnName = resolvedYarnName || 'Unknown Yarn';
          const current = byYarn.get(yarnId) || { yarnId, yarnName, received: 0, coneCount: 0 };
          current.received += row.netWeight || 0;
          current.coneCount += row.coneCount || 0;
          byYarn.set(yarnId, current);
        }
        report.data = Array.from(byYarn.values());
      } else if (process === 'coning') {
        const byMachine = new Map();
        for (const row of coningReceives) {
          const fullName = row.issue?.machine?.name || row.machineNo || 'unknown';
          const parts = fullName.split('-');
          const key = parts.length > 1 ? parts[0] : fullName;

          const current = byMachine.get(key) || { machineName: key, received: 0, coneCount: 0 };
          current.received += row.netWeight || 0;
          current.coneCount += row.coneCount || 0;
          byMachine.set(key, current);
        }
        if (process === 'coning') {
          report.data = Array.from(byMachine.values());
        } else if (!process || process === 'all') {
          const coningData = Array.from(byMachine.values()).map(d => ({ ...d, process: 'Coning' }));
          report.data.push(...coningData);
        }
      }
    }

    // Calculate overall efficiency using ACTUAL issued weight as denominator
    report.summary.efficiency = calcEfficiency(
      report.summary.totalIssued,
      report.summary.totalReceived
    );


    res.json({ report });
  } catch (err) {
    console.error('Failed to generate production report', err);
    res.status(500).json({ error: 'Failed to generate production report' });
  }
});

router.get('/api/reports/production/details', requirePermission('reports', PERM_READ), async (req, res) => {
  try {
    const { process, view, from, to, key } = req.query;
    if (!process || !from || !to) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Default dates
    const toDate = to;
    const fromDate = from;

    let rows = [];

    // "All" process not supported for details view specifically, or we just handle case by case.
    // Ideally UI calls this with specific process.

    if (process === 'cutter') {
      const where = {
        isDeleted: false,
        date: { gte: fromDate, lte: toDate },
      };

      if (view === 'operator') {
        where.operatorId = key === 'unknown' ? null : key;
      } else if (view === 'shift') {
        where.shift = key === 'Not Specified' ? null : key;
      } else if (view === 'item') {
        const [itemName, cut] = key.split('|');
        where.itemName = itemName;
        if (cut) where.cut = cut;
      } else if (view === 'yarn') {
        where.yarnName = key;
      } else {
        // Machine View - key is base machine name
        if (key === 'unknown') {
          where.machineNo = null;
        } else {
          where.OR = [
            { machineNo: key },
            { machineNo: { startsWith: `${key}-` } }
          ];
        }
      }

      const rawRows = await prisma.receiveFromCutterMachineRow.findMany({
        where,
        include: { operator: true, challan: true },
        orderBy: { date: 'desc' },
        take: 2000
      });

      rows = rawRows.map(r => ({
        id: r.id,
        date: r.date,
        shift: r.shift,
        barcode: r.barcode || r.pieceId,
        receivedQty: r.bobbinQuantity || 0,
        receivedWeight: r.netWt || 0,
        issueInfo: null,
        operatorName: r.operator?.name || r.machineNo || 'Unknown',
        machineName: r.machineNo || null
      }));

    } else if (process === 'holo') {
      const where = {
        isDeleted: false,
        date: { gte: fromDate, lte: toDate },
      };

      if (view === 'operator') {
        where.operatorId = key === 'unknown' ? null : key;
      } else if (view === 'shift') {
        // We grouped by issue.shift in the main report (line 10512)
        where.issue = {
          shift: key === 'Not Specified' ? null : key
        };
      } else if (view === 'item') {
        const [itemId, cutId] = key.split('|');
        where.issue = {
          itemId: itemId === 'unknown' ? null : itemId,
          cutId: (cutId && cutId !== 'none') ? cutId : undefined
        };
      } else if (view === 'yarn') {
        where.issue = {
          yarnId: key === 'unknown' ? null : key
        };
      } else {
        // Machine view: the key is now the BASE machine name (e.g. "H12")
        if (key === 'unknown') {
          where.AND = [
            { issue: { machineId: null } },
            { machineNo: null }
          ];
        } else {
          where.OR = [
            { issue: { machine: { name: key } } },
            { issue: { machine: { name: { startsWith: `${key}-` } } } },
            { machineNo: key },
            { machineNo: { startsWith: `${key}-` } }
          ];
        }
      }
      const rawRows = await prisma.receiveFromHoloMachineRow.findMany({
        where,
        include: {
          operator: true,
          issue: { include: { machine: true, yarn: true, twist: true, cut: true } }
        },
        orderBy: { date: 'desc' },
        take: 2000
      });

      // Build fallback context: extract all cutter row IDs from receivedRowRefs for cut resolution
      const allCutterRowIdsForDetails = new Set();
      rawRows.forEach(r => {
        const refs = Array.isArray(r.issue?.receivedRowRefs) ? r.issue.receivedRowRefs : [];
        refs.forEach(ref => {
          if (typeof ref?.rowId === 'string') allCutterRowIdsForDetails.add(ref.rowId);
        });
      });
      const cutterRowsForDetailsFallback = allCutterRowIdsForDetails.size > 0
        ? await prisma.receiveFromCutterMachineRow.findMany({
          where: { id: { in: Array.from(allCutterRowIdsForDetails) } },
          select: { id: true, cutId: true, cut: true, cutMaster: { select: { name: true } } },
        })
        : [];
      const cutterRowMapForDetails = new Map(cutterRowsForDetailsFallback.map(r => [r.id, r]));

      // Fetch all cuts for lookup
      const allCutIdsForDetails = new Set();
      rawRows.forEach(r => { if (r.issue?.cutId) allCutIdsForDetails.add(r.issue.cutId); });
      cutterRowsForDetailsFallback.forEach(r => { if (r.cutId) allCutIdsForDetails.add(r.cutId); });
      const cutsForDetailsLookup = allCutIdsForDetails.size > 0
        ? await prisma.cut.findMany({ where: { id: { in: Array.from(allCutIdsForDetails) } }, select: { id: true, name: true } })
        : [];
      const cutDetailsLookupMap = new Map(cutsForDetailsLookup.map(c => [c.id, c.name]));

      // Helper: Resolve cut with fallback to source cutter rows (for details)
      const resolveCutForDetails = (issue) => {
        // Priority 1: Direct cutId on issue
        if (issue?.cutId) {
          const name = issue.cut?.name || cutDetailsLookupMap.get(issue.cutId) || '';
          if (name) return name;
        }
        // Priority 2: Trace through receivedRowRefs to cutter rows
        const refs = Array.isArray(issue?.receivedRowRefs) ? issue.receivedRowRefs : [];
        for (const ref of refs) {
          if (typeof ref?.rowId !== 'string') continue;
          const cutterRow = cutterRowMapForDetails.get(ref.rowId);
          if (!cutterRow) continue;
          if (cutterRow.cutId) {
            const name = cutDetailsLookupMap.get(cutterRow.cutId) || cutterRow.cutMaster?.name || '';
            if (name) return name;
          }
          if (typeof cutterRow.cut === 'string' && cutterRow.cut) return cutterRow.cut;
          if (cutterRow.cutMaster?.name) return cutterRow.cutMaster.name;
        }
        return '';
      };

      // Fetch all unique item IDs to get item names
      const itemIds = [...new Set(rawRows.map(r => r.issue?.itemId).filter(Boolean))];
      const items = await prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true }
      });
      const itemMap = new Map(items.map(i => [i.id, i.name]));

      rows = rawRows.map(r => {
        const itemName = r.issue?.itemId ? itemMap.get(r.issue.itemId) : null;
        const yarnTwist = `${r.issue?.yarn?.name || ''} ${r.issue?.twist?.name || ''}`.trim();
        const cutName = resolveCutForDetails(r.issue);
        const descParts = [cutName, itemName, yarnTwist].filter(Boolean);
        return {
          id: r.id,
          date: r.date,
          shift: r.issue?.shift,
          barcode: r.barcode,
          receivedQty: r.rollCount || 0,
          receivedWeight: r.rollWeight || ((r.grossWeight || 0) - (r.tareWeight || 0)),
          issueInfo: {
            id: r.issue?.id,
            barcode: r.issue?.barcode,
            weight: (r.issue?.metallicBobbinsWeight || 0) + (r.issue?.yarnKg || 0),
            desc: descParts.length > 0 ? descParts.join(' - ') : null
          },
          operatorName: r.operator?.name,
          machineName: r.issue?.machine?.name // Return full machine name for grouping
        };
      });

    } else if (process === 'coning') {
      const where = {
        isDeleted: false,
        date: { gte: fromDate, lte: toDate },
      };
      let cutNameFilter = null;
      let yarnNameFilter = null;

      if (view === 'operator') {
        where.operatorId = key === 'unknown' ? null : key;
      } else if (view === 'shift') {
        where.issue = {
          shift: key === 'Not Specified' ? null : key
        };
      } else if (view === 'item') {
        const [itemId, cutKey] = key.split('|');
        const isNameKey = cutKey && cutKey.startsWith('name:');
        if (isNameKey) cutNameFilter = cutKey.slice(5);
        where.issue = {
          itemId: itemId === 'unknown' ? null : itemId,
          cutId: (!isNameKey && cutKey && cutKey !== 'none') ? cutKey : undefined
        };
      } else if (view === 'yarn') {
        const isNameKey = key && key.startsWith('name:');
        if (isNameKey) yarnNameFilter = key.slice(5);
        // Coning issue has yarnId - filter by it
        where.issue = {
          yarnId: (!isNameKey && key !== 'unknown') ? key : (key === 'unknown' ? null : undefined)
        };
      } else {
        if (key === 'unknown') {
          where.AND = [
            { issue: { machineId: null } },
            { machineNo: null }
          ];
        } else {
          where.OR = [
            { issue: { machine: { name: key } } },
            { issue: { machine: { name: { startsWith: `${key}-` } } } },
            { machineNo: key },
            { machineNo: { startsWith: `${key}-` } }
          ];
        }
      }
      const rawRows = await prisma.receiveFromConingMachineRow.findMany({
        where,
        include: {
          operator: true,
          issue: {
            select: {
              id: true,
              itemId: true,
              lotNo: true,
              barcode: true,
              shift: true,
              cutId: true,
              yarnId: true,
              twistId: true,
              receivedRowRefs: true,
              machine: true,
              yarn: true,
              twist: true,
              cut: true,
            }
          }
        },
        orderBy: { date: 'desc' },
        take: 2000
      });

      const coningTraceCaches = createTraceCaches();
      const coningHoloIssueDetailsCache = new Map();
      const coningIssueTraceCache = new Map();
      const resolveConingIssueTrace = async (issue) => {
        if (!issue?.id) return null;
        const cached = coningIssueTraceCache.get(issue.id);
        if (cached) return cached;
        const resolved = await resolveConingTraceDetails(issue, { caches: coningTraceCaches, holoIssueDetailsCache: coningHoloIssueDetailsCache });
        coningIssueTraceCache.set(issue.id, resolved);
        return resolved;
      };
      const issuesForTrace = new Map();
      rawRows.forEach((row) => {
        if (row.issue?.id && !issuesForTrace.has(row.issue.id)) {
          issuesForTrace.set(row.issue.id, row.issue);
        }
      });
      for (const issue of issuesForTrace.values()) {
        await resolveConingIssueTrace(issue);
      }

      let filteredRows = rawRows;
      if (cutNameFilter) {
        filteredRows = filteredRows.filter((row) => {
          const trace = row.issue?.id ? coningIssueTraceCache.get(row.issue.id) : null;
          const resolvedCutName = trace?.cutName || row.issue?.cut?.name || '';
          return resolvedCutName === cutNameFilter;
        });
      }
      if (yarnNameFilter) {
        filteredRows = filteredRows.filter((row) => {
          const trace = row.issue?.id ? coningIssueTraceCache.get(row.issue.id) : null;
          const resolvedYarnName = trace?.yarnName || row.issue?.yarn?.name || '';
          return resolvedYarnName === yarnNameFilter;
        });
      }

      // Fetch all unique item IDs to get item names for coning
      const coningItemIds = [...new Set(filteredRows.map(r => r.issue?.itemId).filter(Boolean))];
      const coningItems = await prisma.item.findMany({
        where: { id: { in: coningItemIds } },
        select: { id: true, name: true }
      });
      const coningItemMap = new Map(coningItems.map(i => [i.id, i.name]));

      rows = filteredRows.map(r => {
        const trace = r.issue?.id ? coningIssueTraceCache.get(r.issue.id) : null;
        const cutName = trace?.cutName || r.issue?.cut?.name || '';
        const yarnName = trace?.yarnName || r.issue?.yarn?.name || '';
        const twistName = trace?.twistName || r.issue?.twist?.name || '';
        const itemName = r.issue?.itemId ? coningItemMap.get(r.issue.itemId) : null;
        const yarnTwist = `${yarnName} ${twistName}`.trim();
        const descParts = [cutName, itemName, yarnTwist].filter(Boolean);
        return {
          id: r.id,
          date: r.date,
          shift: r.issue?.shift,
          barcode: r.barcode,
          receivedQty: r.coneCount || 0,
          receivedWeight: r.netWeight || 0,
          issueInfo: {
            id: r.issue?.id,
            barcode: r.issue?.barcode,
            weight: 0,
            desc: descParts.length > 0 ? descParts.join(' - ') : null
          },
          cutName,
          yarnName,
          twistName,
          operatorName: r.operator?.name,
          machineName: r.issue?.machine?.name || r.machineNo // Return full machine name for grouping
        };
      });
    }

    res.json({ ok: true, rows });

  } catch (err) {
    console.error('Production report details failed', err);
    res.status(500).json({ error: 'Failed to fetch details' });
  }
});

router.get('/api/reports/production/holo-metrics', requirePermission('reports', PERM_READ), async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const fromDate = parseDateOnly(from);
    const toDate = parseDateOnly(to);
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'from and to must be valid YYYY-MM-DD dates' });
    }
    if (fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ error: 'from date cannot be later than to date' });
    }

    const rows = await prisma.holoDailyMetric.findMany({
      where: {
        date: { gte: from, lte: to },
      },
      orderBy: [
        { date: 'asc' },
        { baseMachine: 'asc' },
      ],
    });
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('Failed to load holo daily metrics', err);
    res.status(500).json({ error: err.message || 'Failed to load holo daily metrics' });
  }
});

router.get('/api/reports/production/holo-other-wastage', requirePermission('reports', PERM_READ), async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const fromDate = parseDateOnly(from);
    const toDate = parseDateOnly(to);
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'from and to must be valid YYYY-MM-DD dates' });
    }
    if (fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ error: 'from date cannot be later than to date' });
    }

    const rows = await prisma.holoOtherWastageMetric.findMany({
      where: {
        date: { gte: from, lte: to },
      },
      include: {
        otherWastageItem: true,
      },
      orderBy: [
        { date: 'asc' },
        { otherWastageItem: { name: 'asc' } },
      ],
    });
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('Failed to load holo other wastage rows', err);
    res.status(500).json({ error: err.message || 'Failed to load holo other wastage rows' });
  }
});

router.put('/api/reports/production/holo-other-wastage', requirePermission('reports', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const entriesRaw = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entriesRaw.length === 0) {
      return res.status(400).json({ error: 'entries must be a non-empty array' });
    }

    const normalizedMap = new Map();
    const itemIds = new Set();
    for (const entry of entriesRaw) {
      const date = String(entry?.date || '').trim();
      const otherWastageItemId = String(entry?.otherWastageItemId || '').trim();
      if (!date || !parseDateOnly(date)) {
        return res.status(400).json({ error: 'Each entry must include a valid date' });
      }
      if (!otherWastageItemId) {
        return res.status(400).json({ error: 'Each entry must include a valid otherWastageItemId' });
      }

      const hasWastage = entry?.wastage !== undefined && entry?.wastage !== null && String(entry.wastage).trim() !== '';
      const wastage = hasWastage ? toNumber(entry.wastage) : null;
      if (hasWastage && (!Number.isFinite(wastage) || wastage < 0)) {
        return res.status(400).json({ error: 'wastage must be a non-negative number' });
      }

      normalizedMap.set(`${date}::${otherWastageItemId}`, { date, otherWastageItemId, wastage });
      itemIds.add(otherWastageItemId);
    }

    const items = await prisma.holoOtherWastageItem.findMany({
      where: { id: { in: Array.from(itemIds) } },
      select: { id: true, name: true },
    });
    const itemMap = new Map(items.map((item) => [item.id, item]));
    for (const itemId of itemIds) {
      if (!itemMap.has(itemId)) {
        return res.status(400).json({ error: `Other wastage item not found: ${itemId}` });
      }
    }

    const results = [];
    await prisma.$transaction(async (tx) => {
      for (const entry of normalizedMap.values()) {
        const existing = await tx.holoOtherWastageMetric.findUnique({
          where: {
            date_otherWastageItemId: {
              date: entry.date,
              otherWastageItemId: entry.otherWastageItemId,
            },
          },
          include: {
            otherWastageItem: true,
          },
        });

        if (entry.wastage === null) {
          if (existing) {
            await tx.holoOtherWastageMetric.delete({ where: { id: existing.id } });
            results.push({ ...existing, deleted: true });
          }
          continue;
        }

        if (existing) {
          const updated = await tx.holoOtherWastageMetric.update({
            where: { id: existing.id },
            data: {
              wastage: entry.wastage,
              ...actorUpdateFields(actorUserId),
            },
            include: {
              otherWastageItem: true,
            },
          });
          results.push(updated);
          continue;
        }

        const created = await tx.holoOtherWastageMetric.create({
          data: {
            date: entry.date,
            otherWastageItemId: entry.otherWastageItemId,
            wastage: entry.wastage,
            ...actorCreateFields(actorUserId),
          },
          include: {
            otherWastageItem: true,
          },
        });
        results.push(created);
      }
    });

    await logCrudWithActor(req, {
      entityType: 'holo_other_wastage_metric',
      entityId: 'batch',
      action: 'upsert',
      payload: { entries: Array.from(normalizedMap.values()) },
    });

    res.json({ ok: true, rows: results });
  } catch (err) {
    console.error('Failed to save holo other wastage rows', err);
    res.status(500).json({ error: err.message || 'Failed to save holo other wastage rows' });
  }
});

router.put('/api/reports/production/holo-metrics', requirePermission('reports', PERM_WRITE), async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const entriesRaw = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entriesRaw.length === 0) {
      return res.status(400).json({ error: 'entries must be a non-empty array' });
    }

    const normalizedMap = new Map();
    for (const entry of entriesRaw) {
      const date = String(entry?.date || '').trim();
      const baseMachine = normalizeBaseMachineValue(entry?.baseMachine);
      if (!date || !parseDateOnly(date)) {
        return res.status(400).json({ error: 'Each entry must include a valid date' });
      }
      if (!baseMachine || baseMachine === 'Unassigned') {
        return res.status(400).json({ error: 'Each entry must include a valid baseMachine' });
      }

      const hasHours = entry?.hours !== undefined && entry?.hours !== null && String(entry.hours).trim() !== '';
      const hasWastage = entry?.wastage !== undefined && entry?.wastage !== null && String(entry.wastage).trim() !== '';
      const hours = hasHours ? toNumber(entry.hours) : null;
      const wastage = hasWastage ? toNumber(entry.wastage) : null;

      if (hasHours && (!Number.isFinite(hours) || hours < 0)) {
        return res.status(400).json({ error: 'hours must be a non-negative number' });
      }
      if (hasWastage && (!Number.isFinite(wastage) || wastage < 0)) {
        return res.status(400).json({ error: 'wastage must be a non-negative number' });
      }

      normalizedMap.set(`${date}::${baseMachine}`, { date, baseMachine, hours, wastage });
    }

    const results = [];
    await prisma.$transaction(async (tx) => {
      for (const entry of normalizedMap.values()) {
        const existing = await tx.holoDailyMetric.findUnique({
          where: {
            date_baseMachine: {
              date: entry.date,
              baseMachine: entry.baseMachine,
            },
          },
        });

        if (entry.hours === null && entry.wastage === null) {
          if (existing) {
            await tx.holoDailyMetric.delete({ where: { id: existing.id } });
            results.push({ ...existing, deleted: true });
          }
          continue;
        }

        if (existing) {
          const updated = await tx.holoDailyMetric.update({
            where: { id: existing.id },
            data: {
              hours: entry.hours,
              wastage: entry.wastage,
              ...actorUpdateFields(actorUserId),
            },
          });
          results.push(updated);
          continue;
        }

        const created = await tx.holoDailyMetric.create({
          data: {
            date: entry.date,
            baseMachine: entry.baseMachine,
            hours: entry.hours,
            wastage: entry.wastage,
            ...actorCreateFields(actorUserId),
          },
        });
        results.push(created);
      }
    });

    await logCrudWithActor(req, {
      entityType: 'holo_daily_metric',
      entityId: 'batch',
      action: 'upsert',
      payload: { entries: Array.from(normalizedMap.values()) },
    });

    res.json({ ok: true, rows: results });
  } catch (err) {
    console.error('Failed to save holo daily metrics', err);
    res.status(500).json({ error: err.message || 'Failed to save holo daily metrics' });
  }
});

router.get('/api/reports/production/export/daily', requirePermission('reports', PERM_READ), async (req, res) => {
  let archive = null;
  let clientAborted = false;
  const markAborted = () => {
    clientAborted = true;
    if (archive) {
      try { archive.abort(); } catch (_) { }
    }
  };
  req.on('aborted', markAborted);
  res.on('close', () => {
    if (!res.writableEnded) markAborted();
  });

  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const validation = validateProductionDailyExportRequest({
      process: req.query.process,
      from,
      to,
    });

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const process = validation.process;
    const fromDate = validation.fromDate;
    const toDate = validation.toDate;

    const ensureClientConnected = () => {
      if (!clientAborted) return;
      const error = new Error('Client disconnected during export');
      error.code = 'CLIENT_ABORTED';
      throw error;
    };

    const buildPdfEntry = async (date) => {
      ensureClientConnected();
      const exportData = await buildProductionDailyExportData({
        process,
        date,
        helpers: {
          parseRefs,
          resolveHoloIssueDetails,
          resolveConingTraceDetails,
          resolveLotNoFromPieceId,
        },
      });
      ensureClientConnected();
      const pdfBuffer = await generateProductionDailyExportPdf(exportData);
      ensureClientConnected();
      return { date, pdfBuffer };
    };

    if (from === to) {
      const { pdfBuffer } = await buildPdfEntry(from);
      const filename = `production_daily_${process}_${from}.pdf`;

      ensureClientConnected();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    }

    const dates = enumerateDatesInclusive(fromDate, toDate);
    const pdfEntries = await mapWithConcurrency(dates, 2, async (date) => await buildPdfEntry(date));
    ensureClientConnected();
    const zipFilename = `production_daily_${process}_${from}_to_${to}.zip`;
    archive = archiver('zip', { zlib: { level: 0 } });

    archive.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Failed to build export ZIP' });
        return;
      }
      res.destroy(error);
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    archive.pipe(res);

    for (const entry of pdfEntries) {
      ensureClientConnected();
      archive.append(entry.pdfBuffer, {
        name: `production_daily_${process}_${entry.date}.pdf`,
      });
    }

    await archive.finalize();
  } catch (err) {
    if (err?.code === 'CLIENT_ABORTED') {
      return;
    }
    console.error('Failed to export daily production report', err);
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.status(500).json({ error: err.message || 'Failed to export daily production report' });
  }
});

router.get('/api/reports/production/export/weekly', requirePermission('reports', PERM_READ), async (req, res) => {
  try {
    const process = String(req.query.process || '').trim().toLowerCase();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (process !== 'holo') {
      return res.status(400).json({ error: 'Weekly production export supports only holo process' });
    }

    const exportData = await buildHoloWeeklyExportData({
      from,
      to,
      helpers: {
        parseRefs,
        resolveHoloIssueDetails,
      },
    });
    const pdfBuffer = await generateHoloWeeklyExportPdf(exportData);
    const filename = `production_weekly_${process}_${from}_to_${to}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Failed to export weekly production report', err);
    const statusCode = Number(err?.statusCode || 500);
    const payload = { error: err.message || 'Failed to export weekly production report' };
    if (err?.details) payload.details = err.details;
    res.status(statusCode).json(payload);
  }
});

// ========== BOX TRANSFER FEATURE ==========

// Lookup barcode for box transfer
router.post('/api/box-transfer/lookup', requirePermission('box_transfer', PERM_READ), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.body?.barcode);
    if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

    const EPSILON = 1e-9;

    const legacyResolved = await resolveLegacyReceiveRow(barcode);
    if (legacyResolved?.error === 'ambiguous') {
      return res.status(409).json({ error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.' });
    }
    if (legacyResolved?.row) {
      if (legacyResolved.stage === 'holo') {
        const holoRow = await prisma.receiveFromHoloMachineRow.findUnique({
          where: { id: legacyResolved.row.id },
          include: {
            issue: { include: { machine: true } },
            box: true,
            rollType: true,
          },
        });
        if (holoRow && !holoRow.isDeleted) {
          const totalNetWeight = holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0));
          const dispatchedWeight = Number(holoRow.dispatchedWeight || 0);
          const issuedToConingMap = await buildHoloIssuedToConingMap(prisma, [holoRow.id]);
          const issuedToConing = issuedToConingMap.get(holoRow.id) || { issuedRolls: 0, issuedWeight: 0 };
          const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight - (issuedToConing.issuedWeight || 0));
          const availableRolls = calcAvailableCountFromWeight({
            totalCount: holoRow.rollCount,
            issuedCount: issuedToConing.issuedRolls || 0,
            dispatchedCount: holoRow.dispatchedCount || 0,
            totalWeight: totalNetWeight,
            availableWeight,
          }) || 0;
          return res.json({
            found: true,
            stage: 'holo',
            itemId: holoRow.id,
            barcode: holoRow.barcode,
            lotNo: holoRow.issue?.lotNo || null,
            itemName: holoRow.issue?.itemId || null,
            currentCount: availableRolls,
            currentWeight: roundTo3Decimals(availableWeight),
            totalCount: holoRow.rollCount,
            totalWeight: roundTo3Decimals(totalNetWeight),
            boxName: holoRow.box?.name || null,
            boxId: holoRow.boxId || null,
            rollTypeName: holoRow.rollType?.name || null,
            machineName: holoRow.issue?.machine?.name || holoRow.machineNo || null,
            date: holoRow.date || null,
          });
        }
      } else if (legacyResolved.stage === 'coning') {
        const coningRow = await prisma.receiveFromConingMachineRow.findUnique({
          where: { id: legacyResolved.row.id },
          include: {
            issue: { include: { machine: true } },
            box: true,
          },
        });
        if (coningRow && !coningRow.isDeleted) {
          const totalNetWeight = Number(coningRow.netWeight || 0);
          const dispatchedWeight = Number(coningRow.dispatchedWeight || 0);
          const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight);
          const availableCones = calcAvailableCountFromWeight({
            totalCount: coningRow.coneCount || 0,
            issuedCount: 0,
            dispatchedCount: coningRow.dispatchedCount || 0,
            totalWeight: totalNetWeight,
            availableWeight,
          }) || 0;
          return res.json({
            found: true,
            stage: 'coning',
            itemId: coningRow.id,
            barcode: coningRow.barcode,
            lotNo: coningRow.issue?.lotNo || null,
            itemName: coningRow.issue?.itemId || null,
            currentCount: availableCones,
            currentWeight: roundTo3Decimals(availableWeight),
            totalCount: coningRow.coneCount,
            totalWeight: roundTo3Decimals(totalNetWeight),
            boxName: coningRow.box?.name || null,
            boxId: coningRow.boxId || null,
            machineName: coningRow.issue?.machine?.name || coningRow.machineNo || null,
            date: coningRow.date || null,
          });
        }
      }
    }

    // Try Holo receive rows
    const holoRow = await prisma.receiveFromHoloMachineRow.findFirst({
      where: {
        OR: [
          { barcode: { equals: barcode, mode: 'insensitive' } },
          { notes: { equals: barcode, mode: 'insensitive' } },
        ],
        isDeleted: false,
      },
      include: {
        issue: { include: { machine: true } },
        box: true,
        rollType: true,
      },
    });
    if (holoRow) {
      const totalNetWeight = holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0));
      const dispatchedWeight = Number(holoRow.dispatchedWeight || 0);
      const issuedToConingMap = await buildHoloIssuedToConingMap(prisma, [holoRow.id]);
      const issuedToConing = issuedToConingMap.get(holoRow.id) || { issuedRolls: 0, issuedWeight: 0 };
      const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight - (issuedToConing.issuedWeight || 0));
      const availableRolls = calcAvailableCountFromWeight({
        totalCount: holoRow.rollCount,
        issuedCount: issuedToConing.issuedRolls || 0,
        dispatchedCount: holoRow.dispatchedCount || 0,
        totalWeight: totalNetWeight,
        availableWeight,
      }) || 0;
      return res.json({
        found: true,
        stage: 'holo',
        itemId: holoRow.id,
        barcode: holoRow.barcode,
        lotNo: holoRow.issue?.lotNo || null,
        itemName: holoRow.issue?.itemId || null,
        currentCount: availableRolls,
        currentWeight: roundTo3Decimals(availableWeight),
        totalCount: holoRow.rollCount,
        totalWeight: roundTo3Decimals(totalNetWeight),
        boxName: holoRow.box?.name || null,
        boxId: holoRow.boxId || null,
        rollTypeName: holoRow.rollType?.name || null,
        machineName: holoRow.issue?.machine?.name || holoRow.machineNo || null,
        date: holoRow.date || null,
      });
    }

    // Try Coning receive rows
    const coningRow = await prisma.receiveFromConingMachineRow.findUnique({
      where: { barcode },
      include: {
        issue: { include: { machine: true } },
        box: true,
      },
    });
    if (coningRow && !coningRow.isDeleted) {
      const totalNetWeight = Number(coningRow.netWeight || 0);
      const dispatchedWeight = Number(coningRow.dispatchedWeight || 0);
      const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight);
      const availableCones = calcAvailableCountFromWeight({
        totalCount: coningRow.coneCount || 0,
        issuedCount: 0,
        dispatchedCount: coningRow.dispatchedCount || 0,
        totalWeight: totalNetWeight,
        availableWeight,
      }) || 0;
      return res.json({
        found: true,
        stage: 'coning',
        itemId: coningRow.id,
        barcode: coningRow.barcode,
        lotNo: coningRow.issue?.lotNo || null,
        itemName: coningRow.issue?.itemId || null,
        currentCount: availableCones,
        currentWeight: roundTo3Decimals(availableWeight),
        totalCount: coningRow.coneCount,
        totalWeight: roundTo3Decimals(totalNetWeight),
        boxName: coningRow.box?.name || null,
        boxId: coningRow.boxId || null,
        machineName: coningRow.issue?.machine?.name || coningRow.machineNo || null,
        date: coningRow.date || null,
      });
    }

    // Try Cutter receive rows (by vchNo as primary identifier, or barcode)
    const cutterRow = await prisma.receiveFromCutterMachineRow.findFirst({
      where: {
        OR: [
          { barcode: barcode },
          { vchNo: barcode },
        ],
        isDeleted: false,
      },
      include: {
        box: true,
        bobbin: true,
        cutMaster: true,
      },
    });
    if (cutterRow) {
      const bobbinQty = Number(cutterRow.bobbinQuantity || 0);
      const issuedBobbins = Number(cutterRow.issuedBobbins || 0);
      const netWeight = Number(cutterRow.netWt || 0);
      const issuedWeight = Number(cutterRow.issuedBobbinWeight || 0);
      const dispatchedWeight = Number(cutterRow.dispatchedWeight || 0);
      const availableWeight = Math.max(0, netWeight - issuedWeight - dispatchedWeight);
      const availableBobbins = calcAvailableCountFromWeight({
        totalCount: bobbinQty,
        issuedCount: issuedBobbins,
        dispatchedCount: cutterRow.dispatchedCount || 0,
        totalWeight: netWeight,
        availableWeight,
      }) || 0;
      const resolvedLotNo = await resolveLotNoFromPieceId(cutterRow.pieceId);
      return res.json({
        found: true,
        stage: 'cutter',
        itemId: cutterRow.id,
        barcode: cutterRow.barcode || cutterRow.vchNo,
        lotNo: resolvedLotNo,
        pieceId: cutterRow.pieceId,
        itemName: cutterRow.itemName || null,
        currentCount: availableBobbins,
        currentWeight: roundTo3Decimals(availableWeight),
        totalCount: bobbinQty,
        totalWeight: roundTo3Decimals(netWeight),
        boxName: cutterRow.box?.name || null,
        boxId: cutterRow.boxId || null,
        bobbinName: cutterRow.bobbin?.name || null,
        cutName: cutterRow.cutMaster?.name || (typeof cutterRow.cut === 'string' ? cutterRow.cut : cutterRow.cut?.name) || null,
        date: cutterRow.date || null,
      });
    }

    res.json({ found: false, error: 'Barcode not found' });
  } catch (err) {
    console.error('Box transfer lookup failed', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// Execute box transfer
router.post('/api/box-transfer', requirePermission('box_transfer', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const fromBarcode = normalizeBarcodeInput(req.body?.fromBarcode);
    const toBarcode = normalizeBarcodeInput(req.body?.toBarcode);
    const pieceCount = toInt(req.body?.pieceCount);
    const notes = toOptionalString(req.body?.notes);

    if (!fromBarcode) return res.status(400).json({ error: 'From barcode is required' });
    if (!toBarcode) return res.status(400).json({ error: 'To barcode is required' });
    if (fromBarcode === toBarcode) return res.status(400).json({ error: 'From and To barcodes must be different' });
    if (!pieceCount || pieceCount <= 0) return res.status(400).json({ error: 'Piece count must be a positive number' });

    // Lookup both barcodes
    const lookupFrom = await lookupBarcodeForTransfer(fromBarcode);
    const lookupTo = await lookupBarcodeForTransfer(toBarcode);

    if (lookupFrom.error) return res.status(409).json({ error: `From barcode issue: ${lookupFrom.error}` });
    if (lookupTo.error) return res.status(409).json({ error: `To barcode issue: ${lookupTo.error}` });
    if (!lookupFrom.found) return res.status(400).json({ error: `From barcode not found: ${fromBarcode}` });
    if (!lookupTo.found) return res.status(400).json({ error: `To barcode not found: ${toBarcode}` });
    if (lookupFrom.itemId && lookupTo.itemId && lookupFrom.itemId === lookupTo.itemId) {
      return res.status(400).json({ error: 'Cannot transfer to the same item' });
    }
    if (lookupFrom.stage !== lookupTo.stage) {
      return res.status(400).json({ error: `Cannot transfer between different processes (${lookupFrom.stage} → ${lookupTo.stage})` });
    }
    if (pieceCount > lookupFrom.currentCount) {
      return res.status(400).json({ error: `Insufficient pieces. Available: ${lookupFrom.currentCount}, Requested: ${pieceCount}` });
    }

    const stage = lookupFrom.stage;
    const weightPerPiece = lookupFrom.currentCount > 0 ? lookupFrom.currentWeight / lookupFrom.currentCount : 0;
    const weightTransferred = roundTo3Decimals(pieceCount * weightPerPiece);

    const today = new Date().toISOString().split('T')[0];

    const result = await prisma.$transaction(async (tx) => {
      const EPSILON = 1e-9;

      // Update source - decrease count and weight
      if (stage === 'holo') {
        const sourceRow = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: lookupFrom.itemId } });
        if (!sourceRow || sourceRow.isDeleted) throw new Error('Source item not found');

        // Re-validate availability inside transaction to prevent race condition
        const srcTotalNetWeight = sourceRow.rollWeight ? sourceRow.rollWeight : ((sourceRow.grossWeight || 0) - (sourceRow.tareWeight || 0));
        const srcDispatchedWeight = Number(sourceRow.dispatchedWeight || 0);
        const issuedToConingMap = await buildHoloIssuedToConingMap(tx, [sourceRow.id]);
        const issuedToConing = issuedToConingMap.get(sourceRow.id) || { issuedRolls: 0, issuedWeight: 0 };
        const srcAvailableWeight = Math.max(0, srcTotalNetWeight - srcDispatchedWeight - (issuedToConing.issuedWeight || 0));
        const srcAvailableRolls = calcAvailableCountFromWeight({
          totalCount: sourceRow.rollCount || 0,
          issuedCount: issuedToConing.issuedRolls || 0,
          dispatchedCount: sourceRow.dispatchedCount || 0,
          totalWeight: srcTotalNetWeight,
          availableWeight: srcAvailableWeight,
        }) || 0;

        if (pieceCount > srcAvailableRolls) {
          throw new Error(`Insufficient rolls available. Only ${srcAvailableRolls} available (may have been dispatched).`);
        }
        if (weightTransferred > srcAvailableWeight + 0.001) {
          throw new Error(`Insufficient weight available. Only ${srcAvailableWeight.toFixed(3)} kg available (may have been dispatched).`);
        }

        const newRollCount = sourceRow.rollCount - pieceCount;
        const newNetWeight = srcTotalNetWeight - weightTransferred;
        const newRollWeight = roundTo3Decimals(Math.max(0, newNetWeight));
        await tx.receiveFromHoloMachineRow.update({
          where: { id: lookupFrom.itemId },
          data: { rollCount: newRollCount, rollWeight: newRollWeight, ...actorUpdateFields(actor?.userId) },
        });

        // Update destination - increase count and weight
        const destRow = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: lookupTo.itemId } });
        if (!destRow || destRow.isDeleted) throw new Error('Destination item not found');
        const destNewRollCount = destRow.rollCount + pieceCount;
        const destOldNetWeight = destRow.rollWeight ? destRow.rollWeight : ((destRow.grossWeight || 0) - (destRow.tareWeight || 0));
        const destNewNetWeight = destOldNetWeight + weightTransferred;
        const destNewRollWeight = roundTo3Decimals(Math.max(0, destNewNetWeight));
        await tx.receiveFromHoloMachineRow.update({
          where: { id: lookupTo.itemId },
          data: { rollCount: destNewRollCount, rollWeight: destNewRollWeight, ...actorUpdateFields(actor?.userId) },
        });
        const srcPieceId = sourceRow.pieceId || null;
        const destPieceId = destRow.pieceId || null;
        if (srcPieceId && destPieceId && srcPieceId !== destPieceId) {
          const srcTotals = await tx.receiveFromHoloMachinePieceTotal.findUnique({ where: { pieceId: srcPieceId } });
          if (!srcTotals) throw new Error('Receive totals not found for source piece');
          await tx.receiveFromHoloMachinePieceTotal.update({
            where: { pieceId: srcPieceId },
            data: {
              totalRolls: { decrement: pieceCount },
              totalNetWeight: { decrement: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
          });
          await tx.receiveFromHoloMachinePieceTotal.upsert({
            where: { pieceId: destPieceId },
            update: {
              totalRolls: { increment: pieceCount },
              totalNetWeight: { increment: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
            create: {
              pieceId: destPieceId,
              totalRolls: pieceCount,
              totalNetWeight: weightTransferred,
              wastageNetWeight: 0,
              ...actorCreateFields(actor?.userId),
            },
          });
        }
      } else if (stage === 'coning') {
        const sourceRow = await tx.receiveFromConingMachineRow.findUnique({ where: { id: lookupFrom.itemId } });
        if (!sourceRow || sourceRow.isDeleted) throw new Error('Source item not found');

        // Re-validate availability inside transaction to prevent race condition
        const srcTotalNetWeight = Number(sourceRow.netWeight || 0);
        const srcDispatchedWeight = Number(sourceRow.dispatchedWeight || 0);
        const srcAvailableWeight = Math.max(0, srcTotalNetWeight - srcDispatchedWeight);
        const srcAvailableCones = calcAvailableCountFromWeight({
          totalCount: sourceRow.coneCount || 0,
          issuedCount: 0,
          dispatchedCount: sourceRow.dispatchedCount || 0,
          totalWeight: srcTotalNetWeight,
          availableWeight: srcAvailableWeight,
        }) || 0;

        if (pieceCount > srcAvailableCones) {
          throw new Error(`Insufficient cones available. Only ${srcAvailableCones} available (may have been dispatched).`);
        }
        if (weightTransferred > srcAvailableWeight + 0.001) {
          throw new Error(`Insufficient weight available. Only ${srcAvailableWeight.toFixed(3)} kg available (may have been dispatched).`);
        }

        const newConeCount = sourceRow.coneCount - pieceCount;
        const newNetWeight = srcTotalNetWeight - weightTransferred;
        await tx.receiveFromConingMachineRow.update({
          where: { id: lookupFrom.itemId },
          data: { coneCount: newConeCount, netWeight: roundTo3Decimals(Math.max(0, newNetWeight)), ...actorUpdateFields(actor?.userId) },
        });

        const destRow = await tx.receiveFromConingMachineRow.findUnique({ where: { id: lookupTo.itemId } });
        if (!destRow || destRow.isDeleted) throw new Error('Destination item not found');
        const destNewConeCount = destRow.coneCount + pieceCount;
        const destNewNetWeight = (destRow.netWeight || 0) + weightTransferred;
        await tx.receiveFromConingMachineRow.update({
          where: { id: lookupTo.itemId },
          data: { coneCount: destNewConeCount, netWeight: roundTo3Decimals(destNewNetWeight), ...actorUpdateFields(actor?.userId) },
        });
      } else if (stage === 'cutter') {
        const sourceRow = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: lookupFrom.itemId } });
        if (!sourceRow || sourceRow.isDeleted) throw new Error('Source item not found');

        // Re-validate availability inside transaction to prevent race condition
        const srcBobbinQty = Number(sourceRow.bobbinQuantity || 0);
        const srcIssuedBobbins = Number(sourceRow.issuedBobbins || 0);
        const srcNetWeight = Number(sourceRow.netWt || 0);
        const srcIssuedWeight = Number(sourceRow.issuedBobbinWeight || 0);
        const srcDispatchedWeight = Number(sourceRow.dispatchedWeight || 0);
        const srcAvailableWeight = Math.max(0, srcNetWeight - srcIssuedWeight - srcDispatchedWeight);
        const srcAvailableBobbins = calcAvailableCountFromWeight({
          totalCount: srcBobbinQty,
          issuedCount: srcIssuedBobbins,
          dispatchedCount: sourceRow.dispatchedCount || 0,
          totalWeight: srcNetWeight,
          availableWeight: srcAvailableWeight,
        }) || 0;

        if (pieceCount > srcAvailableBobbins) {
          throw new Error(`Insufficient bobbins available. Only ${srcAvailableBobbins} available (may have been issued or dispatched).`);
        }
        if (weightTransferred > srcAvailableWeight + 0.001) {
          throw new Error(`Insufficient weight available. Only ${srcAvailableWeight.toFixed(3)} kg available (may have been issued or dispatched).`);
        }

        const newBobbinQty = srcBobbinQty - pieceCount;
        const newNetWt = srcNetWeight - weightTransferred;
        await tx.receiveFromCutterMachineRow.update({
          where: { id: lookupFrom.itemId },
          data: { bobbinQuantity: newBobbinQty, netWt: roundTo3Decimals(Math.max(0, newNetWt)), ...actorUpdateFields(actor?.userId) },
        });

        const destRow = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: lookupTo.itemId } });
        if (!destRow || destRow.isDeleted) throw new Error('Destination item not found');
        const destNewBobbinQty = (destRow.bobbinQuantity || 0) + pieceCount;
        const destNewNetWt = (destRow.netWt || 0) + weightTransferred;
        await tx.receiveFromCutterMachineRow.update({
          where: { id: lookupTo.itemId },
          data: { bobbinQuantity: destNewBobbinQty, netWt: roundTo3Decimals(destNewNetWt), ...actorUpdateFields(actor?.userId) },
        });
        const srcPieceId = sourceRow.pieceId || null;
        const destPieceId = destRow.pieceId || null;
        if (srcPieceId && destPieceId && srcPieceId !== destPieceId) {
          const srcTotals = await tx.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: srcPieceId } });
          if (!srcTotals) throw new Error('Receive totals not found for source piece');
          await tx.receiveFromCutterMachinePieceTotal.update({
            where: { pieceId: srcPieceId },
            data: {
              totalBob: { decrement: pieceCount },
              totalNetWeight: { decrement: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
          });
          await tx.receiveFromCutterMachinePieceTotal.upsert({
            where: { pieceId: destPieceId },
            update: {
              totalBob: { increment: pieceCount },
              totalNetWeight: { increment: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
            create: {
              pieceId: destPieceId,
              totalBob: pieceCount,
              totalNetWeight: weightTransferred,
              wastageNetWeight: 0,
              ...actorCreateFields(actor?.userId),
            },
          });
        }
      }

      // Create transfer record
      const transfer = await tx.boxTransfer.create({
        data: {
          date: today,
          stage,
          fromBarcode,
          fromItemId: lookupFrom.itemId,
          toBarcode,
          toItemId: lookupTo.itemId,
          pieceCount,
          weightTransferred,
          notes,
          ...actorCreateFields(actor?.userId),
        },
      });

      return transfer;
    });

    await logCrudWithActor(req, {
      entityType: 'boxTransfer',
      entityId: result.id,
      action: 'create',
      payload: {
        stage,
        fromBarcode,
        toBarcode,
        pieceCount,
        weightTransferred,
        notes,
      },
    });

    res.json({ ok: true, transfer: result });
  } catch (err) {
    console.error('Box transfer failed', err);
    res.status(500).json({ error: err.message || 'Transfer failed' });
  }
});

// Get box transfer history
router.get('/api/box-transfer/history', requirePermission('box_transfer', PERM_READ), async (req, res) => {
  try {
    const { dateFrom, dateTo, search, stage } = req.query;
    const where = {};

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = String(dateFrom);
      if (dateTo) where.date.lte = String(dateTo);
    }

    if (stage && stage !== 'all') {
      where.stage = String(stage);
    }

    if (search) {
      const term = String(search).trim();
      where.OR = [
        { fromBarcode: { contains: term, mode: 'insensitive' } },
        { toBarcode: { contains: term, mode: 'insensitive' } },
        { notes: { contains: term, mode: 'insensitive' } },
      ];
    }

    const transfersRaw = await prisma.boxTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Resolve user fields for display
    const transfers = await resolveUserFields(transfersRaw);

    res.json({ transfers });
  } catch (err) {
    console.error('Failed to fetch box transfer history', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Reverse a box transfer
router.post('/api/box-transfer/:id/reverse', requirePermission('box_transfer', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;

    const original = await prisma.boxTransfer.findUnique({ where: { id } });
    if (!original) return res.status(404).json({ error: 'Transfer not found' });
    if (original.isReversed) return res.status(400).json({ error: 'Transfer has already been reversed' });

    const today = new Date().toISOString().split('T')[0];
    const { stage, pieceCount, weightTransferred } = original;

    const result = await prisma.$transaction(async (tx) => {
      // Reverse the transfer: add back to source, subtract from destination
      if (stage === 'holo') {
        const sourceRow = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: original.fromItemId } });
        const destRow = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: original.toItemId } });
        if (!sourceRow || sourceRow.isDeleted || !destRow || destRow.isDeleted) {
          throw new Error('Original items not found');
        }

        // Validate destination has sufficient pieces to reverse
        if (destRow.rollCount < pieceCount) {
          throw new Error(`Cannot reverse: destination only has ${destRow.rollCount} rolls, but ${pieceCount} are needed. The pieces may have been dispatched or transferred elsewhere.`);
        }

        // Add back to source
        const srcNewRollCount = sourceRow.rollCount + pieceCount;
        const srcOldNetWeight = sourceRow.rollWeight ? sourceRow.rollWeight : ((sourceRow.grossWeight || 0) - (sourceRow.tareWeight || 0));
        const srcNewNetWeight = srcOldNetWeight + weightTransferred;
        const srcNewRollWeight = roundTo3Decimals(Math.max(0, srcNewNetWeight));
        await tx.receiveFromHoloMachineRow.update({
          where: { id: original.fromItemId },
          data: { rollCount: srcNewRollCount, rollWeight: srcNewRollWeight, ...actorUpdateFields(actor?.userId) },
        });

        // Subtract from destination
        const destNewRollCount = destRow.rollCount - pieceCount;
        const destOldNetWeight = destRow.rollWeight ? destRow.rollWeight : ((destRow.grossWeight || 0) - (destRow.tareWeight || 0));
        const destNewNetWeight = Math.max(0, destOldNetWeight - weightTransferred);
        const destNewRollWeight = roundTo3Decimals(Math.max(0, destNewNetWeight));
        await tx.receiveFromHoloMachineRow.update({
          where: { id: original.toItemId },
          data: { rollCount: destNewRollCount, rollWeight: destNewRollWeight, ...actorUpdateFields(actor?.userId) },
        });
        const srcPieceId = sourceRow.pieceId || null;
        const destPieceId = destRow.pieceId || null;
        if (srcPieceId && destPieceId && srcPieceId !== destPieceId) {
          const destTotals = await tx.receiveFromHoloMachinePieceTotal.findUnique({ where: { pieceId: destPieceId } });
          if (!destTotals) throw new Error('Receive totals not found for destination piece');
          await tx.receiveFromHoloMachinePieceTotal.update({
            where: { pieceId: destPieceId },
            data: {
              totalRolls: { decrement: pieceCount },
              totalNetWeight: { decrement: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
          });
          await tx.receiveFromHoloMachinePieceTotal.upsert({
            where: { pieceId: srcPieceId },
            update: {
              totalRolls: { increment: pieceCount },
              totalNetWeight: { increment: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
            create: {
              pieceId: srcPieceId,
              totalRolls: pieceCount,
              totalNetWeight: weightTransferred,
              wastageNetWeight: 0,
              ...actorCreateFields(actor?.userId),
            },
          });
        }
      } else if (stage === 'coning') {
        const sourceRow = await tx.receiveFromConingMachineRow.findUnique({ where: { id: original.fromItemId } });
        const destRow = await tx.receiveFromConingMachineRow.findUnique({ where: { id: original.toItemId } });
        if (!sourceRow || sourceRow.isDeleted || !destRow || destRow.isDeleted) {
          throw new Error('Original items not found');
        }

        // Validate destination has sufficient pieces to reverse
        if (destRow.coneCount < pieceCount) {
          throw new Error(`Cannot reverse: destination only has ${destRow.coneCount} cones, but ${pieceCount} are needed. The pieces may have been dispatched or transferred elsewhere.`);
        }

        await tx.receiveFromConingMachineRow.update({
          where: { id: original.fromItemId },
          data: {
            coneCount: sourceRow.coneCount + pieceCount,
            netWeight: roundTo3Decimals((sourceRow.netWeight || 0) + weightTransferred),
            ...actorUpdateFields(actor?.userId)
          },
        });
        await tx.receiveFromConingMachineRow.update({
          where: { id: original.toItemId },
          data: {
            coneCount: destRow.coneCount - pieceCount,
            netWeight: roundTo3Decimals(Math.max(0, (destRow.netWeight || 0) - weightTransferred)),
            ...actorUpdateFields(actor?.userId)
          },
        });
      } else if (stage === 'cutter') {
        const sourceRow = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: original.fromItemId } });
        const destRow = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: original.toItemId } });
        if (!sourceRow || sourceRow.isDeleted || !destRow || destRow.isDeleted) {
          throw new Error('Original items not found');
        }

        // Validate destination has sufficient pieces to reverse
        const destBobbinQty = destRow.bobbinQuantity || 0;
        if (destBobbinQty < pieceCount) {
          throw new Error(`Cannot reverse: destination only has ${destBobbinQty} bobbins, but ${pieceCount} are needed. The pieces may have been dispatched or transferred elsewhere.`);
        }

        await tx.receiveFromCutterMachineRow.update({
          where: { id: original.fromItemId },
          data: {
            bobbinQuantity: (sourceRow.bobbinQuantity || 0) + pieceCount,
            netWt: roundTo3Decimals((sourceRow.netWt || 0) + weightTransferred),
            ...actorUpdateFields(actor?.userId)
          },
        });
        await tx.receiveFromCutterMachineRow.update({
          where: { id: original.toItemId },
          data: {
            bobbinQuantity: destBobbinQty - pieceCount,
            netWt: roundTo3Decimals(Math.max(0, (destRow.netWt || 0) - weightTransferred)),
            ...actorUpdateFields(actor?.userId)
          },
        });
        const srcPieceId = sourceRow.pieceId || null;
        const destPieceId = destRow.pieceId || null;
        if (srcPieceId && destPieceId && srcPieceId !== destPieceId) {
          const destTotals = await tx.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: destPieceId } });
          if (!destTotals) throw new Error('Receive totals not found for destination piece');
          await tx.receiveFromCutterMachinePieceTotal.update({
            where: { pieceId: destPieceId },
            data: {
              totalBob: { decrement: pieceCount },
              totalNetWeight: { decrement: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
          });
          await tx.receiveFromCutterMachinePieceTotal.upsert({
            where: { pieceId: srcPieceId },
            update: {
              totalBob: { increment: pieceCount },
              totalNetWeight: { increment: weightTransferred },
              ...actorUpdateFields(actor?.userId),
            },
            create: {
              pieceId: srcPieceId,
              totalBob: pieceCount,
              totalNetWeight: weightTransferred,
              wastageNetWeight: 0,
              ...actorCreateFields(actor?.userId),
            },
          });
        }
      }

      // Create reverse transfer record
      const reverseTransfer = await tx.boxTransfer.create({
        data: {
          date: today,
          stage,
          fromBarcode: original.toBarcode, // Reversed direction
          fromItemId: original.toItemId,
          toBarcode: original.fromBarcode,
          toItemId: original.fromItemId,
          pieceCount,
          weightTransferred,
          notes: `Reversal of transfer ${original.id}`,
          reversedById: original.id,
          ...actorCreateFields(actor?.userId),
        },
      });

      // Mark original as reversed
      await tx.boxTransfer.update({
        where: { id: original.id },
        data: { isReversed: true, ...actorUpdateFields(actor?.userId) },
      });

      return reverseTransfer;
    });

    await logCrudWithActor(req, {
      entityType: 'boxTransfer',
      entityId: result.id,
      action: 'reverse',
      payload: { originalTransferId: id },
    });

    res.json({ ok: true, reverseTransfer: result });
  } catch (err) {
    console.error('Box transfer reverse failed', err);
    res.status(500).json({ error: err.message || 'Reverse failed' });
  }
});

// Helper function for transfer lookup
async function lookupBarcodeForTransfer(barcode) {
  const EPSILON = 1e-9;

  const legacyResolved = await resolveLegacyReceiveRow(barcode);
  if (legacyResolved?.error === 'ambiguous') {
    return { found: false, error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.' };
  }
  if (legacyResolved?.row) {
    if (legacyResolved.stage === 'holo') {
      const holoRow = legacyResolved.row;
      const totalNetWeight = holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0));
      const dispatchedWeight = Number(holoRow.dispatchedWeight || 0);
      const issuedToConingMap = await buildHoloIssuedToConingMap(prisma, [holoRow.id]);
      const issuedToConing = issuedToConingMap.get(holoRow.id) || { issuedRolls: 0, issuedWeight: 0 };
      const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight - (issuedToConing.issuedWeight || 0));
      const availableRolls = calcAvailableCountFromWeight({
        totalCount: holoRow.rollCount || 0,
        issuedCount: issuedToConing.issuedRolls || 0,
        dispatchedCount: holoRow.dispatchedCount || 0,
        totalWeight: totalNetWeight,
        availableWeight,
      }) || 0;
      return { found: true, stage: 'holo', itemId: holoRow.id, currentCount: availableRolls, currentWeight: roundTo3Decimals(availableWeight) };
    }
    if (legacyResolved.stage === 'coning') {
      const coningRow = legacyResolved.row;
      const totalNetWeight = Number(coningRow.netWeight || 0);
      const dispatchedWeight = Number(coningRow.dispatchedWeight || 0);
      const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight);
      const availableCones = calcAvailableCountFromWeight({
        totalCount: coningRow.coneCount || 0,
        issuedCount: 0,
        dispatchedCount: coningRow.dispatchedCount || 0,
        totalWeight: totalNetWeight,
        availableWeight,
      }) || 0;
      return { found: true, stage: 'coning', itemId: coningRow.id, currentCount: availableCones, currentWeight: roundTo3Decimals(availableWeight) };
    }
  }

  // Try Holo
  const holoRow = await prisma.receiveFromHoloMachineRow.findFirst({
    where: {
      OR: [
        { barcode: { equals: barcode, mode: 'insensitive' } },
        { notes: { equals: barcode, mode: 'insensitive' } },
      ],
      isDeleted: false,
    },
  });
  if (holoRow) {
    const totalNetWeight = holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0));
    const dispatchedWeight = Number(holoRow.dispatchedWeight || 0);
    const issuedToConingMap = await buildHoloIssuedToConingMap(prisma, [holoRow.id]);
    const issuedToConing = issuedToConingMap.get(holoRow.id) || { issuedRolls: 0, issuedWeight: 0 };
    const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight - (issuedToConing.issuedWeight || 0));
    const availableRolls = calcAvailableCountFromWeight({
      totalCount: holoRow.rollCount || 0,
      issuedCount: issuedToConing.issuedRolls || 0,
      dispatchedCount: holoRow.dispatchedCount || 0,
      totalWeight: totalNetWeight,
      availableWeight,
    }) || 0;
    return { found: true, stage: 'holo', itemId: holoRow.id, currentCount: availableRolls, currentWeight: roundTo3Decimals(availableWeight) };
  }

  // Try Coning
  const coningRow = await prisma.receiveFromConingMachineRow.findUnique({ where: { barcode } });
  if (coningRow && coningRow.isDeleted) {
    return { found: false };
  }
  if (coningRow) {
    const totalNetWeight = Number(coningRow.netWeight || 0);
    const dispatchedWeight = Number(coningRow.dispatchedWeight || 0);
    const availableWeight = Math.max(0, totalNetWeight - dispatchedWeight);
    const availableCones = calcAvailableCountFromWeight({
      totalCount: coningRow.coneCount || 0,
      issuedCount: 0,
      dispatchedCount: coningRow.dispatchedCount || 0,
      totalWeight: totalNetWeight,
      availableWeight,
    }) || 0;
    return { found: true, stage: 'coning', itemId: coningRow.id, currentCount: availableCones, currentWeight: roundTo3Decimals(availableWeight) };
  }

  // Try Cutter
  const cutterRow = await prisma.receiveFromCutterMachineRow.findFirst({
    where: { OR: [{ barcode }, { vchNo: barcode }], isDeleted: false },
  });
  if (cutterRow) {
    const bobbinQty = Number(cutterRow.bobbinQuantity || 0);
    const issuedBobbins = Number(cutterRow.issuedBobbins || 0);
    const netWeight = Number(cutterRow.netWt || 0);
    const issuedWeight = Number(cutterRow.issuedBobbinWeight || 0);
    const dispatchedWeight = Number(cutterRow.dispatchedWeight || 0);
    const availableWeight = Math.max(0, netWeight - issuedWeight - dispatchedWeight);
    const availableBobbins = calcAvailableCountFromWeight({
      totalCount: bobbinQty,
      issuedCount: issuedBobbins,
      dispatchedCount: cutterRow.dispatchedCount || 0,
      totalWeight: netWeight,
      availableWeight,
    }) || 0;
    return { found: true, stage: 'cutter', itemId: cutterRow.id, currentCount: availableBobbins, currentWeight: roundTo3Decimals(availableWeight) };
  }

  return { found: false };
}

// ========== SUMMARY ENDPOINTS ==========

function getTodayDateString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateForFilename(dateStr) {
  if (!dateStr) return getTodayDateString().replace(/-/g, '');
  return String(dateStr).replace(/-/g, '');
}

// Helper to aggregate by a key
function aggregateBy(items, keyFn, valueFns) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, { key, ...Object.fromEntries(Object.keys(valueFns).map(k => [k, 0])) });
    }
    const agg = map.get(key);
    for (const [propName, fn] of Object.entries(valueFns)) {
      agg[propName] += fn(item);
    }
  }
  return Array.from(map.values());
}

// Shared helper to generate summary data (used by both GET and POST endpoints)
async function generateSummaryData(stage, type, date) {
  let summary = { stage, type, date };

  // Helper to lookup item names from ids
  async function getItemNameMap(itemIds) {
    if (!itemIds.length) return {};
    const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
    return Object.fromEntries(items.map(i => [i.id, i.name]));
  }

  const parseRefs = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  async function buildHoloCutNameMap(issues) {
    const issueList = Array.isArray(issues) ? issues : [];
    if (!issueList.length) return new Map();

    const rowIds = new Set();
    issueList.forEach((issue) => {
      const refs = parseRefs(issue.receivedRowRefs);
      refs.forEach((ref) => {
        if (ref?.rowId) rowIds.add(ref.rowId);
      });
    });

    const rowIdArray = Array.from(rowIds);
    const sourceRowCutMap = new Map();
    if (rowIdArray.length > 0) {
      const sourceRows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { id: { in: rowIdArray } },
        include: { cutMaster: true },
      });
      sourceRows.forEach((row) => {
        const cutName = row.cutMaster?.name || row.cut || null;
        if (cutName) sourceRowCutMap.set(row.id, cutName);
      });
    }

    const issueCutNameMap = new Map();
    issueList.forEach((issue) => {
      const cutNames = new Set();
      if (issue.cut?.name) cutNames.add(issue.cut.name);
      const refs = parseRefs(issue.receivedRowRefs);
      refs.forEach((ref) => {
        const cutName = ref?.rowId ? sourceRowCutMap.get(ref.rowId) : null;
        if (cutName) cutNames.add(cutName);
      });
      const cutName = cutNames.size ? Array.from(cutNames).join(', ') : '-';
      issueCutNameMap.set(issue.id, cutName);
    });

    return issueCutNameMap;
  }

  if (stage === 'cutter' && type === 'issue') {
    const issues = await prisma.issueToCutterMachine.findMany({
      where: { date, isDeleted: false },
      include: { machine: true, operator: true, cut: true },
      orderBy: { createdAt: 'asc' },
    });

    // Lookup item names
    const itemIds = [...new Set(issues.map(i => i.itemId).filter(Boolean))];
    const itemMap = await getItemNameMap(itemIds);

    summary.totalCount = issues.length;
    summary.totalPieces = issues.reduce((sum, i) => sum + (i.count || 0), 0);
    summary.totalWeight = issues.reduce((sum, i) => sum + (i.totalWeight || 0), 0);

    // Detailed rows for PDF table
    summary.details = issues.map(i => ({
      machineName: i.machine?.name || '-',
      itemName: itemMap[i.itemId] || i.itemId || '-',
      lotNo: i.lotNo || '-',
      cutName: i.cut?.name || '-',
      operatorName: i.operator?.name || '-',
      note: i.note || '',
      count: i.count || 0,
      totalWeight: i.totalWeight || 0,
    }));

    // Keep aggregations for backward compatibility
    summary.byOperator = aggregateBy(issues, i => i.operator?.name || 'Unknown', {
      count: () => 1,
      weight: i => i.totalWeight || 0,
      name: i => 0,
    }).map(a => ({ name: a.key, count: a.count, weight: a.weight }));

    summary.byMachine = aggregateBy(issues, i => i.machine?.name || 'Unknown', {
      count: () => 1,
      weight: i => i.totalWeight || 0,
    }).map(a => ({ name: a.key, count: a.count, weight: a.weight }));

    summary.byLot = aggregateBy(issues, i => i.lotNo || 'Unknown', {
      count: () => 1,
      weight: i => i.totalWeight || 0,
    }).map(a => ({ lotNo: a.key, count: a.count, weight: a.weight }));

  } else if (stage === 'cutter' && type === 'receive') {
    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { date, isDeleted: false },
      include: { operator: true, challan: true, cutMaster: true, box: true },
      orderBy: { createdAt: 'asc' },
    });

    const pieceIds = Array.from(new Set(rows.map(r => r.pieceId).filter(Boolean)));
    const inboundItems = pieceIds.length > 0
      ? await prisma.inboundItem.findMany({ where: { id: { in: pieceIds } } })
      : [];
    const pieceMap = new Map(inboundItems.map(p => [p.id, p]));
    const itemIds = Array.from(new Set(inboundItems.map(p => p.itemId).filter(Boolean)));
    const itemMap = await getItemNameMap(itemIds);
    const machineByPieceId = await buildCutterIssueMachineMap(pieceIds);
    const resolveItemName = (row) => {
      const piece = pieceMap.get(row.pieceId);
      return row.itemName || (piece?.itemId ? (itemMap[piece.itemId] || piece.itemId) : '-') || '-';
    };
    const resolveMachineName = (row) => {
      if (row.machineNo && row.machineNo !== '---') return row.machineNo;
      return machineByPieceId.get(row.pieceId) || '-';
    };
    const resolveOperatorName = (row) => row.operator?.name || row.employee || '-';

    summary.totalCount = rows.length;
    summary.totalBobbins = rows.reduce((sum, r) => sum + (r.bobbinQuantity || 0), 0);
    summary.totalNetWeight = rows.reduce((sum, r) => sum + (r.netWt || 0), 0);
    summary.totalChallans = new Set(rows.filter(r => r.challanId).map(r => r.challanId)).size;

    // Aggregate by item for the receive summary (grouping rows by item/cut/machine/operator)
    const groupedMap = new Map();
    for (const r of rows) {
      const resolvedItemName = resolveItemName(r);
      const resolvedMachine = resolveMachineName(r);
      const resolvedOperator = resolveOperatorName(r);
      const key = `${resolvedItemName}|${r.cut || r.cutMaster?.name || '-'}|${resolvedMachine}|${r.shift || '-'}|${resolvedOperator}`;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          itemName: resolvedItemName,
          cutName: r.cut || r.cutMaster?.name || '-',
          machineNo: resolvedMachine,
          shift: r.shift || '-',
          operatorName: resolvedOperator,
          netWeight: 0,
          bobbinCount: 0,
          boxIds: new Set(),
        });
      }
      const grp = groupedMap.get(key);
      grp.netWeight += Number(r.netWt || 0);
      grp.bobbinCount += Number(r.bobbinQuantity || 0);
      if (r.boxId) grp.boxIds.add(r.boxId);
    }
    summary.details = Array.from(groupedMap.values()).map(g => ({
      ...g,
      boxCount: g.boxIds.size,
      boxIds: undefined,
    }));

    summary.byOperator = aggregateBy(rows, r => resolveOperatorName(r) || 'Unknown', {
      count: () => 1,
      netWeight: r => r.netWt || 0,
    }).map(a => ({ name: a.key, count: a.count, netWeight: a.netWeight }));

    summary.byPiece = aggregateBy(rows, r => r.pieceId || 'Unknown', {
      count: () => 1,
      netWeight: r => r.netWt || 0,
    }).map(a => ({ pieceId: a.key, count: a.count, netWeight: a.netWeight }));

    summary.byMachine = aggregateBy(rows, r => resolveMachineName(r) || 'Unknown', {
      count: () => 1,
      netWeight: r => r.netWt || 0,
    }).map(a => ({ name: a.key, count: a.count, netWeight: a.netWeight }));

  } else if (stage === 'holo' && type === 'issue') {
    const issues = await prisma.issueToHoloMachine.findMany({
      where: { date, isDeleted: false },
      include: { machine: true, operator: true, twist: true, yarn: true, cut: true },
      orderBy: { createdAt: 'asc' },
    });

    // Lookup item names
    const itemIds = [...new Set(issues.map(i => i.itemId).filter(Boolean))];
    const itemMap = await getItemNameMap(itemIds);

    const cutNameMap = await buildHoloCutNameMap(issues);

    summary.totalCount = issues.length;
    summary.totalMetallicBobbins = issues.reduce((sum, i) => sum + (i.metallicBobbins || 0), 0);
    summary.totalBobbinWeight = issues.reduce((sum, i) => sum + (i.metallicBobbinsWeight || 0), 0);
    summary.totalYarnKg = issues.reduce((sum, i) => sum + (i.yarnKg || 0), 0);

    // Helper to check if issue is opening stock
    const isOpeningStock = (issue) => issue.note && issue.note.toLowerCase().includes('opening stock');

    summary.details = issues.map(i => ({
      machineName: i.machine?.name || (isOpeningStock(i) ? 'Opening Stock' : '-'),
      itemName: itemMap[i.itemId] || i.itemId || '-',
      lotNo: i.lotNo || '-',
      cutName: cutNameMap.get(i.id) || '-',
      twistName: i.twist?.name || '-',
      yarnName: i.yarn?.name || '-',
      operatorName: i.operator?.name || (isOpeningStock(i) ? 'Opening Stock' : '-'),
      shift: i.shift || '-',
      metallicBobbins: i.metallicBobbins || 0,
      metallicBobbinsWeight: i.metallicBobbinsWeight || 0,
      yarnKg: i.yarnKg || 0,
    }));

    summary.byOperator = aggregateBy(issues, i => i.operator?.name || 'Unknown', {
      count: () => 1,
      bobbinWeight: i => i.metallicBobbinsWeight || 0,
    }).map(a => ({ name: a.key, count: a.count, bobbinWeight: a.bobbinWeight }));

    summary.byMachine = aggregateBy(issues, i => i.machine?.name || 'Unknown', {
      count: () => 1,
      bobbinWeight: i => i.metallicBobbinsWeight || 0,
    }).map(a => ({ name: a.key, count: a.count, bobbinWeight: a.bobbinWeight }));

  } else if (stage === 'holo' && type === 'receive') {
    const rows = await prisma.receiveFromHoloMachineRow.findMany({
      where: { date, isDeleted: false },
      include: { operator: true, box: true },
      orderBy: { createdAt: 'asc' },
    });

    const issueIds = [...new Set(rows.map(r => r.issueId).filter(Boolean))];
    const issuesForRows = issueIds.length > 0
      ? await prisma.issueToHoloMachine.findMany({
        where: { id: { in: issueIds }, isDeleted: false },
        include: { machine: true, cut: true, twist: true, yarn: true },
      })
      : [];
    const issueMap = new Map(issuesForRows.map(i => [i.id, i]));
    const cutNameMap = await buildHoloCutNameMap(issuesForRows);

    // Lookup item names from issue.itemId
    const itemIds = [...new Set(issuesForRows.map(i => i.itemId).filter(Boolean))];
    const itemMap = await getItemNameMap(itemIds);

    const netWeight = (r) => {
      if (r.rollWeight) return Number(r.rollWeight);
      const gross = Number(r.grossWeight || 0);
      const tare = Number(r.tareWeight || 0);
      return gross - tare;
    };

    summary.totalCount = rows.length;
    summary.totalRolls = rows.reduce((sum, r) => sum + (r.rollCount || 0), 0);
    summary.totalNetWeight = rows.reduce((sum, r) => sum + netWeight(r), 0);

    summary.details = rows.map(r => ({
      machineName: issueMap.get(r.issueId)?.machine?.name || (issueMap.get(r.issueId)?.note === 'Opening Stock' ? 'Opening Stock' : '-'),
      itemName: itemMap[issueMap.get(r.issueId)?.itemId] || issueMap.get(r.issueId)?.itemId || '-',
      lotNo: issueMap.get(r.issueId)?.lotNo || '-',
      cutName: cutNameMap.get(r.issueId) || '-',
      twistName: issueMap.get(r.issueId)?.twist?.name || '-',
      yarnName: issueMap.get(r.issueId)?.yarn?.name || '-',
      operatorName: r.operator?.name || (issueMap.get(r.issueId)?.note === 'Opening Stock' ? 'Opening Stock' : '-'),
      boxName: r.box?.name || '-',
      rollCount: r.rollCount || 0,
      netWeight: netWeight(r),
    }));

    summary.byOperator = aggregateBy(rows, r => r.operator?.name || 'Unknown', {
      count: () => 1,
      netWeight: r => netWeight(r),
    }).map(a => ({ name: a.key, count: a.count, netWeight: a.netWeight }));

    summary.byMachine = aggregateBy(rows, r => issueMap.get(r.issueId)?.machine?.name || 'Unknown', {
      count: () => 1,
      netWeight: r => netWeight(r),
    }).map(a => ({ name: a.key, count: a.count, netWeight: a.netWeight }));

  } else if (stage === 'coning' && type === 'issue') {
    const issues = await prisma.issueToConingMachine.findMany({
      where: { date, isDeleted: false },
      include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
      orderBy: { createdAt: 'asc' },
    });

    const coningTraceCaches = createTraceCaches();
    const coningHoloIssueDetailsCache = new Map();
    const coningIssueTraceCache = new Map();
    const resolveConingIssueTrace = async (issue) => {
      if (!issue?.id) return null;
      const cached = coningIssueTraceCache.get(issue.id);
      if (cached) return cached;
      const resolved = await resolveConingTraceDetails(issue, { caches: coningTraceCaches, holoIssueDetailsCache: coningHoloIssueDetailsCache });
      coningIssueTraceCache.set(issue.id, resolved);
      return resolved;
    };
    for (const issue of issues) {
      await resolveConingIssueTrace(issue);
    }

    // Lookup item names
    const itemIds = [...new Set(issues.map(i => i.itemId).filter(Boolean))];
    const itemMap = await getItemNameMap(itemIds);

    const coneTypeIds = new Set();
    issues.forEach((issue) => {
      const refs = parseRefs(issue.receivedRowRefs);
      refs.forEach(ref => {
        if (ref?.coneTypeId) coneTypeIds.add(ref.coneTypeId);
      });
    });
    const coneTypes = coneTypeIds.size
      ? await prisma.coneType.findMany({ where: { id: { in: Array.from(coneTypeIds) } } })
      : [];
    const coneTypeMap = new Map(coneTypes.map(c => [c.id, c.name]));
    const resolveConeTypeName = (issue) => {
      const refs = parseRefs(issue?.receivedRowRefs);
      const ids = new Set(refs.map(ref => ref?.coneTypeId).filter(Boolean));
      if (!ids.size) return '-';
      return Array.from(ids).map(id => coneTypeMap.get(id) || id).join(', ');
    };

    summary.totalCount = issues.length;
    summary.totalRollsIssued = issues.reduce((sum, i) => sum + (i.rollsIssued || 0), 0);
    summary.totalExpectedCones = issues.reduce((sum, i) => sum + (i.expectedCones || 0), 0);

    summary.details = issues.map(i => {
      const trace = coningIssueTraceCache.get(i.id);
      const yarnName = trace?.yarnName || i.yarn?.name || '-';
      const twistName = trace?.twistName || i.twist?.name || '-';
      const cutName = trace?.cutName || i.cut?.name || '-';
      return {
        machineName: i.machine?.name || '-',
        itemName: itemMap[i.itemId] || i.itemId || '-',
        lotNo: i.lotNo || '-',
        cutName,
        yarnName,
        twistName,
        coneTypeName: resolveConeTypeName(i),
        perConeTargetG: i.requiredPerConeNetWeight || 0,
        operatorName: i.operator?.name || '-',
        shift: i.shift || '-',
        note: i.note || '',
        rollsIssued: i.rollsIssued || 0,
        expectedCones: i.expectedCones || 0,
      };
    });

    summary.byOperator = aggregateBy(issues, i => i.operator?.name || 'Unknown', {
      count: () => 1,
      rollsIssued: i => i.rollsIssued || 0,
    }).map(a => ({ name: a.key, count: a.count, rollsIssued: a.rollsIssued }));

    summary.byMachine = aggregateBy(issues, i => i.machine?.name || 'Unknown', {
      count: () => 1,
      rollsIssued: i => i.rollsIssued || 0,
    }).map(a => ({ name: a.key, count: a.count, rollsIssued: a.rollsIssued }));

  } else if (stage === 'coning' && type === 'receive') {
    const rows = await prisma.receiveFromConingMachineRow.findMany({
      where: { date, isDeleted: false },
      include: { operator: true, box: true, issue: { include: { machine: true, yarn: true, twist: true, cut: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Lookup item names from issue.itemId
    const itemIds = [...new Set(rows.map(r => r.issue?.itemId).filter(Boolean))];
    const itemMap = await getItemNameMap(itemIds);

    const issueMap = new Map();
    rows.forEach((row) => {
      if (row.issue?.id && !issueMap.has(row.issue.id)) {
        issueMap.set(row.issue.id, row.issue);
      }
    });
    const issueList = Array.from(issueMap.values());
    const coningTraceCaches = createTraceCaches();
    const coningHoloIssueDetailsCache = new Map();
    const coningIssueTraceCache = new Map();
    const resolveConingIssueTrace = async (issue) => {
      if (!issue?.id) return null;
      const cached = coningIssueTraceCache.get(issue.id);
      if (cached) return cached;
      const resolved = await resolveConingTraceDetails(issue, { caches: coningTraceCaches, holoIssueDetailsCache: coningHoloIssueDetailsCache });
      coningIssueTraceCache.set(issue.id, resolved);
      return resolved;
    };
    for (const issue of issueList) {
      await resolveConingIssueTrace(issue);
    }
    const holoRowIds = new Set();
    issueList.forEach((issue) => {
      const refs = parseRefs(issue.receivedRowRefs);
      refs.forEach(ref => {
        if (ref?.rowId) holoRowIds.add(ref.rowId);
      });
    });

    const holoRows = holoRowIds.size
      ? await prisma.receiveFromHoloMachineRow.findMany({
        where: { id: { in: Array.from(holoRowIds) }, isDeleted: false },
        select: { id: true, issueId: true },
      })
      : [];
    const holoIssueIds = [...new Set(holoRows.map(r => r.issueId).filter(Boolean))];
    const holoIssues = holoIssueIds.length
      ? await prisma.issueToHoloMachine.findMany({
        where: { id: { in: holoIssueIds }, isDeleted: false },
        include: { cut: true },
      })
      : [];
    const holoIssueMap = new Map(holoIssues.map(i => [i.id, i]));
    const holoRowIssueMap = new Map(holoRows.map(r => [r.id, r.issueId]));
    const holoCutNameMap = await buildHoloCutNameMap(holoIssues);
    const coningIssueCutMap = new Map();
    issueList.forEach((issue) => {
      const cutNames = new Set();
      if (issue.cut?.name) cutNames.add(issue.cut.name);
      const refs = parseRefs(issue.receivedRowRefs);
      refs.forEach((ref) => {
        const holoIssueId = ref?.rowId ? holoRowIssueMap.get(ref.rowId) : null;
        if (holoIssueId) {
          const cutName = holoCutNameMap.get(holoIssueId);
          if (cutName) cutNames.add(cutName);
        }
      });
      coningIssueCutMap.set(issue.id, cutNames.size ? Array.from(cutNames).join(', ') : '-');
    });
    const coneTypeIds = new Set();
    issueMap.forEach((issue) => {
      const refs = parseRefs(issue.receivedRowRefs);
      refs.forEach(ref => {
        if (ref?.coneTypeId) coneTypeIds.add(ref.coneTypeId);
      });
    });
    const coneTypes = coneTypeIds.size
      ? await prisma.coneType.findMany({ where: { id: { in: Array.from(coneTypeIds) } } })
      : [];
    const coneTypeMap = new Map(coneTypes.map(c => [c.id, c.name]));
    const resolveConeTypeName = (issue) => {
      const refs = parseRefs(issue?.receivedRowRefs);
      const ids = new Set(refs.map(ref => ref?.coneTypeId).filter(Boolean));
      if (!ids.size) return '-';
      return Array.from(ids).map(id => coneTypeMap.get(id) || id).join(', ');
    };

    summary.totalCount = rows.length;
    summary.totalCones = rows.reduce((sum, r) => sum + (r.coneCount || 0), 0);
    summary.totalNetWeight = rows.reduce((sum, r) => sum + (r.netWeight || 0), 0);

    summary.details = rows.map(r => {
      const trace = r.issue?.id ? coningIssueTraceCache.get(r.issue.id) : null;
      const cutName = trace?.cutName || coningIssueCutMap.get(r.issue?.id) || r.issue?.cut?.name || '-';
      const yarnName = trace?.yarnName || r.issue?.yarn?.name || '-';
      const twistName = trace?.twistName || r.issue?.twist?.name || '-';
      return {
        machineName: r.issue?.machine?.name || '-',
        itemName: itemMap[r.issue?.itemId] || r.issue?.itemId || '-',
        lotNo: r.issue?.lotNo || '-',
        cutName,
        yarnName,
        twistName,
        coneTypeName: resolveConeTypeName(r.issue),
        perConeTargetG: r.issue?.requiredPerConeNetWeight || 0,
        operatorName: r.operator?.name || '-',
        coneCount: r.coneCount || 0,
        netWeight: r.netWeight || 0,
      };
    });

    summary.byOperator = aggregateBy(rows, r => r.operator?.name || 'Unknown', {
      count: () => 1,
      netWeight: r => r.netWeight || 0,
    }).map(a => ({ name: a.key, count: a.count, netWeight: a.netWeight }));

    summary.byMachine = aggregateBy(rows, r => r.issue?.machine?.name || 'Unknown', {
      count: () => 1,
      netWeight: r => r.netWeight || 0,
    }).map(a => ({ name: a.key, count: a.count, netWeight: a.netWeight }));
  }

  return summary;
}

// GET /api/summary/:stage/:type - Get summary data
router.get('/api/summary/:stage/:type', async (req, res) => {
  try {
    const { stage, type } = req.params;
    const date = req.query.date || getTodayDateString();

    const validStages = ['cutter', 'holo', 'coning'];
    const validTypes = ['issue', 'receive'];

    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
    }
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const permissionKey = type === 'issue' ? `issue.${stage}` : `receive.${stage}`;
    if (!req.user?.isAdmin) {
      const level = Number(req.user?.permissions?.[permissionKey] || 0);
      if (level < PERM_READ) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const summary = await generateSummaryData(stage, type, date);
    res.json(summary);
  } catch (err) {
    console.error('Failed to get summary', err);
    res.status(500).json({ error: err.message || 'Failed to get summary' });
  }
});

// POST /api/summary/:stage/:type/send - Generate PDF and send via configured channels
router.post('/api/summary/:stage/:type/send', async (req, res) => {
  try {
    const { stage, type } = req.params;
    const date = req.query.date || req.body.date || getTodayDateString();

    const validStages = ['cutter', 'holo', 'coning'];
    const validTypes = ['issue', 'receive'];

    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
    }
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const permissionKey = type === 'issue' ? `issue.${stage}` : `receive.${stage}`;
    if (!req.user?.isAdmin) {
      const level = Number(req.user?.permissions?.[permissionKey] || 0);
      if (level < PERM_WRITE) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    // Check if template is enabled
    const templateEvent = `summary_${stage}_${type}`;
    const template = await prisma.whatsappTemplate.findUnique({ where: { event: templateEvent } });

    if (!template) {
      return res.status(404).json({ error: `Template not found: ${templateEvent}. Please seed templates.` });
    }
    if (!template.enabled) {
      return res.json({ ok: false, reason: 'template_disabled', message: 'Summary template is disabled' });
    }

    // Get summary data using shared helper function (no internal HTTP request)
    const summaryData = await generateSummaryData(stage, type, date);

    // Check if there are any entries
    if (!summaryData.totalCount || summaryData.totalCount === 0) {
      return res.json({ ok: false, reason: 'no_data', message: `No ${type} entries found for ${stage} on ${date}` });
    }

    // Generate PDF
    const pdfBuffer = await generateSummaryPDF(stage, type, summaryData);
    const filename = `summary_${stage}_${type}_${formatDateForFilename(date)}.pdf`;

    // Get settings and resolve channel routing
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const { whatsappEnabled, telegramEnabled } = getNotificationChannelConfig(settings || {});
    if (!whatsappEnabled && !telegramEnabled) {
      return res.json({
        ok: false,
        reason: 'no_enabled_channels',
        message: 'No notification channels are enabled',
      });
    }

    // Generate caption from template
    const caption = interpolateTemplate(template.template, {
      stage,
      type,
      date: summaryData.date,
      totalCount: summaryData.totalCount,
      totalWeight: summaryData.totalWeight || summaryData.totalNetWeight || summaryData.totalBobbinWeight || 0,
      totalPieces: summaryData.totalPieces || summaryData.totalBobbins || summaryData.totalRolls || summaryData.totalCones || 0,
    });

    const dispatchResult = await dispatchMediaByChannels({
      settings: settings || {},
      template,
      buffer: pdfBuffer,
      filename,
      mimetype: 'application/pdf',
      caption,
    });
    persistNotificationDeliveryLogs({
      event: templateEvent,
      templateEvent,
      templateId: template?.id,
      source: 'summary_send',
      channels: dispatchResult.channels,
      createdByUserId: req.user?.id || null,
    }).catch(() => { });

    res.json({
      ok: dispatchResult.ok,
      reason: dispatchResult.reason,
      channels: dispatchResult.channels,
      summary: {
        stage,
        type,
        date,
        totalCount: summaryData.totalCount,
      }
    });
  } catch (err) {
    console.error('Failed to send summary', err);
    res.status(500).json({ error: err.message || 'Failed to send summary' });
  }
});

// GET /api/summary/:stage/:type/download - Generate PDF and download directly (no WhatsApp send)
router.get('/api/summary/:stage/:type/download', async (req, res) => {
  try {
    const { stage, type } = req.params;
    const date = req.query.date || getTodayDateString();

    const validStages = ['cutter', 'holo', 'coning'];
    const validTypes = ['issue', 'receive'];

    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
    }
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const permissionKey = type === 'issue' ? `issue.${stage}` : `receive.${stage}`;
    if (!req.user?.isAdmin) {
      const level = Number(req.user?.permissions?.[permissionKey] || 0);
      if (level < PERM_READ) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const summaryData = await generateSummaryData(stage, type, date);
    if (!summaryData.totalCount || summaryData.totalCount === 0) {
      return res.status(404).json({ error: `No ${type} entries found for ${stage} on ${date}` });
    }

    const pdfBuffer = await generateSummaryPDF(stage, type, summaryData);
    const filename = `summary_${stage}_${type}_${formatDateForFilename(date)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Failed to download summary', err);
    res.status(500).json({ error: err.message || 'Failed to download summary' });
  }
});

// ========== BOILER (STEAMING) FEATURE ==========

// Lookup barcode for boiler steaming
router.get('/api/boiler/lookup', requirePermission('boiler', PERM_READ), async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query?.barcode);
    if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

    // Check if already steamed
    const existingSteamLog = await prisma.boilerSteamLog.findUnique({
      where: { barcode },
      include: { boilerMachine: { select: { id: true, name: true } } },
    });

    // Try legacy barcode resolution first
    const legacyResolved = await resolveLegacyReceiveRow(barcode);
    if (legacyResolved?.error === 'ambiguous') {
      return res.status(409).json({ error: 'Multiple rows match this legacy barcode. Please use the new barcode instead.' });
    }

    if (legacyResolved?.row && legacyResolved.stage === 'holo') {
      const holoRow = await prisma.receiveFromHoloMachineRow.findUnique({
        where: { id: legacyResolved.row.id },
        include: {
          issue: { include: { machine: true } },
          box: true,
          rollType: true,
        },
      });
      if (holoRow && !holoRow.isDeleted) {
        const totalNetWeight = holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0));
        return res.json({
          found: true,
          itemId: holoRow.id,
          barcode: holoRow.barcode,
          lotNo: holoRow.issue?.lotNo || null,
          rollCount: holoRow.rollCount,
          netWeight: roundTo3Decimals(totalNetWeight),
          boxName: holoRow.box?.name || null,
          rollTypeName: holoRow.rollType?.name || null,
          machineName: holoRow.issue?.machine?.name || holoRow.machineNo || null,
          date: holoRow.date || null,
          isSteamed: Boolean(existingSteamLog),
          steamedAt: existingSteamLog?.steamedAt || null,
          boilerMachineId: existingSteamLog?.boilerMachineId || null,
          boilerMachineName: existingSteamLog?.boilerMachine?.name || null,
          boilerNumber: existingSteamLog?.boilerNumber || null,
        });
      }
    }

    // Try Holo receive rows by barcode
    const holoRow = await prisma.receiveFromHoloMachineRow.findFirst({
      where: {
        OR: [
          { barcode: { equals: barcode, mode: 'insensitive' } },
          { notes: { equals: barcode, mode: 'insensitive' } },
        ],
        isDeleted: false,
      },
      include: {
        issue: { include: { machine: true } },
        box: true,
        rollType: true,
      },
    });

    if (holoRow) {
      const totalNetWeight = holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0));
      // Check if already steamed by actual barcode
      const steamedByActualBarcode = holoRow.barcode
        ? await prisma.boilerSteamLog.findUnique({
          where: { barcode: holoRow.barcode },
          include: { boilerMachine: { select: { id: true, name: true } } },
        })
        : null;
      const steamLog = existingSteamLog || steamedByActualBarcode;
      const isSteamed = Boolean(steamLog);
      return res.json({
        found: true,
        itemId: holoRow.id,
        barcode: holoRow.barcode,
        lotNo: holoRow.issue?.lotNo || null,
        rollCount: holoRow.rollCount,
        netWeight: roundTo3Decimals(totalNetWeight),
        boxName: holoRow.box?.name || null,
        rollTypeName: holoRow.rollType?.name || null,
        machineName: holoRow.issue?.machine?.name || holoRow.machineNo || null,
        date: holoRow.date || null,
        isSteamed,
        steamedAt: steamLog?.steamedAt || null,
        boilerMachineId: steamLog?.boilerMachineId || null,
        boilerMachineName: steamLog?.boilerMachine?.name || null,
        boilerNumber: steamLog?.boilerNumber || null,
      });
    }

    return res.json({ found: false });
  } catch (err) {
    console.error('Failed to lookup boiler barcode', err);
    res.status(500).json({ error: err.message || 'Failed to lookup barcode' });
  }
});

// Mark barcodes as steamed
router.post('/api/boiler/steam', requirePermission('boiler', PERM_WRITE), async (req, res) => {
  try {
    const actor = getActor(req);
    const barcodes = req.body?.barcodes;
    const boilerMachineId = typeof req.body?.boilerMachineId === 'string' ? req.body.boilerMachineId.trim() : '';
    const boilerNumberRaw = req.body?.boilerNumber;
    const boilerNumber = boilerNumberRaw === null || boilerNumberRaw === undefined || boilerNumberRaw === ''
      ? null
      : Number(boilerNumberRaw);
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      return res.status(400).json({ error: 'barcodes array is required' });
    }
    if (!boilerMachineId) {
      return res.status(400).json({ error: 'boilerMachineId is required' });
    }
    if (!Number.isInteger(boilerNumber) || boilerNumber < 1) {
      return res.status(400).json({ error: 'boilerNumber must be a positive integer' });
    }

    const normalizedBarcodes = barcodes.map(b => normalizeBarcodeInput(b)).filter(Boolean);
    if (normalizedBarcodes.length === 0) {
      return res.status(400).json({ error: 'No valid barcodes provided' });
    }

    const boilerMachine = await prisma.machine.findUnique({
      where: { id: boilerMachineId },
      select: { id: true, name: true, processType: true },
    });
    if (!boilerMachine || boilerMachine.processType !== 'boiler') {
      return res.status(400).json({ error: 'Selected machine must be a Boiler machine' });
    }

    // Check which are already steamed
    const existingSteamLogs = await prisma.boilerSteamLog.findMany({
      where: { barcode: { in: normalizedBarcodes } },
      select: { barcode: true },
    });
    const alreadySteamed = new Set(existingSteamLogs.map(s => s.barcode));
    const duplicates = normalizedBarcodes.filter(b => alreadySteamed.has(b));

    if (duplicates.length > 0) {
      return res.status(409).json({
        error: 'Some barcodes are already steamed',
        duplicates,
      });
    }

    // Resolve barcodes to holo receive rows for reference - BATCH QUERY
    // Build OR conditions for all barcodes at once
    const orConditions = normalizedBarcodes.flatMap(barcode => [
      { barcode: { equals: barcode, mode: 'insensitive' } },
      { notes: { equals: barcode, mode: 'insensitive' } },
    ]);

    const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
      where: {
        OR: orConditions,
        isDeleted: false,
      },
      select: { id: true, barcode: true, notes: true },
    });

    // Create lookup maps for barcode -> holoRow (case-insensitive)
    const barcodeToHoloId = new Map();
    for (const row of holoRows) {
      if (row.barcode) {
        barcodeToHoloId.set(row.barcode.toUpperCase(), row.id);
      }
      if (row.notes) {
        barcodeToHoloId.set(row.notes.toUpperCase(), row.id);
      }
    }

    // Build steam logs using the lookup map
    const steamLogs = normalizedBarcodes.map(barcode => ({
      barcode,
      holoReceiveRowId: barcodeToHoloId.get(barcode.toUpperCase()) || null,
      boilerMachineId,
      boilerNumber,
      steamedAt: new Date(),
      ...actorCreateFields(actor?.userId),
    }));

    // Create steam logs
    const created = await prisma.boilerSteamLog.createMany({
      data: steamLogs,
      skipDuplicates: true,
    });

    res.json({
      ok: true,
      steamedCount: created.count,
      barcodes: normalizedBarcodes,
      boilerMachineId: boilerMachine.id,
      boilerMachineName: boilerMachine.name,
      boilerNumber,
    });
  } catch (err) {
    console.error('Failed to mark barcodes as steamed', err);
    res.status(500).json({ error: err.message || 'Failed to mark as steamed' });
  }
});

// List steamed items
router.get('/api/boiler/steamed', requirePermission('boiler', PERM_READ), async (req, res) => {
  try {
    const date = req.query?.date; // Optional date filter (YYYY-MM-DD)

    let where = {};
    if (date) {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      where = {
        steamedAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      };
    }

    const steamLogs = await prisma.boilerSteamLog.findMany({
      where,
      include: { boilerMachine: { select: { id: true, name: true } } },
      orderBy: { steamedAt: 'desc' },
      take: 500,
    });

    // Fetch related holo receive row details
    const holoRowIds = steamLogs.map(s => s.holoReceiveRowId).filter(Boolean);
    const holoRows = holoRowIds.length > 0
      ? await prisma.receiveFromHoloMachineRow.findMany({
        where: { id: { in: holoRowIds } },
        include: {
          issue: { select: { lotNo: true, machine: { select: { name: true } } } },
          box: { select: { name: true } },
          rollType: { select: { name: true } },
        },
      })
      : [];
    const holoRowMap = new Map(holoRows.map(r => [r.id, r]));

    const items = steamLogs.map(log => {
      const holoRow = log.holoReceiveRowId ? holoRowMap.get(log.holoReceiveRowId) : null;
      const totalNetWeight = holoRow
        ? (holoRow.rollWeight ? holoRow.rollWeight : ((holoRow.grossWeight || 0) - (holoRow.tareWeight || 0)))
        : null;
      return {
        id: log.id,
        barcode: log.barcode,
        steamedAt: log.steamedAt,
        holoReceiveRowId: log.holoReceiveRowId,
        lotNo: holoRow?.issue?.lotNo || null,
        rollCount: holoRow?.rollCount || null,
        netWeight: totalNetWeight != null ? roundTo3Decimals(totalNetWeight) : null,
        boxName: holoRow?.box?.name || null,
        rollTypeName: holoRow?.rollType?.name || null,
        machineName: holoRow?.issue?.machine?.name || holoRow?.machineNo || null,
        boilerMachineId: log.boilerMachineId || null,
        boilerMachineName: log.boilerMachine?.name || null,
        boilerNumber: log.boilerNumber || null,
        createdByUserId: log.createdByUserId || null,
        createdAt: log.createdAt || null,
      };
    });

    // Resolve user fields for display
    const itemsWithUsers = await resolveUserFields(items);

    res.json({ items: itemsWithUsers, count: itemsWithUsers.length });
  } catch (err) {
    console.error('Failed to list steamed items', err);
    res.status(500).json({ error: err.message || 'Failed to list steamed items' });
  }
});

// ========== DOCUMENT SEND VIA WHATSAPP ==========

// Configure multer for memory storage (no disk persistence)
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
  }
});

// Send document via enabled notification channels
router.post('/api/documents/send', requireAuth, requirePermission('send_documents', PERM_WRITE), documentUpload.single('file'), async (req, res) => {
  try {
    const { customerId, phone, caption, customerName } = req.body;
    const file = req.file;
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const { whatsappEnabled } = getNotificationChannelConfig(settings || {});

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!whatsappEnabled) {
      return res.status(400).json({ error: 'WhatsApp notifications are disabled' });
    }
    const resolvedPhone = String(phone || '').trim();
    if (!resolvedPhone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const finalCaption = await appendCreatorToCaption(caption || '', req.user?.id || null);
    await whatsapp.sendMediaSafe(
      resolvedPhone,
      file.buffer,
      file.originalname,
      file.mimetype,
      finalCaption
    );
    persistNotificationDeliveryLogs({
      event: 'documents_send',
      templateEvent: null,
      templateId: null,
      source: 'documents_send',
      channels: {
        whatsapp: {
          enabled: true,
          recipients: [{ type: 'number', value: resolvedPhone }],
          results: [{ recipient: resolvedPhone, type: 'number', success: true }],
          ok: true,
          reason: null,
        },
      },
      createdByUserId: req.user?.id || null,
    }).catch(() => { });

    // Resolve or create customer after successful dispatch
    let customer = null;
    if (customerId) {
      customer = await prisma.customer.findUnique({ where: { id: customerId } });
    }
    if (!customer) {
      customer = await prisma.customer.findFirst({ where: { phone: resolvedPhone } });
    }
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: (customerName || resolvedPhone || '').trim() || 'Unknown',
          phone: resolvedPhone || null
        }
      });
    }

    // Save metadata only (no file content)
    const docMessage = await prisma.documentMessage.create({
      data: {
        customerId: customer.id,
        phone: resolvedPhone,
        filename: file.originalname,
        mimetype: file.mimetype,
        fileSize: file.size,
        caption: caption || null,
        createdByUserId: req.user?.id || null,
      },
      include: { customer: true }
    });

    res.json({
      ok: true,
      message: docMessage,
      channels: {
        whatsapp: {
          enabled: true,
          recipients: [{ type: 'number', value: resolvedPhone }],
          results: [{ recipient: resolvedPhone, type: 'number', success: true }],
          ok: true,
          reason: null,
        },
      },
    });
  } catch (err) {
    console.error('Failed to send document', err);
    const failedPhone = String(req.body?.phone || '').trim();
    if (failedPhone) {
      persistNotificationDeliveryLogs({
        event: 'documents_send',
        templateEvent: null,
        templateId: null,
        source: 'documents_send',
        channels: {
          whatsapp: {
            enabled: true,
            recipients: [{ type: 'number', value: failedPhone }],
            results: [{ recipient: failedPhone, type: 'number', success: false, error: err?.message || String(err) }],
            ok: false,
            reason: 'send_failed',
          },
        },
        createdByUserId: req.user?.id || null,
      }).catch(() => { });
    }
    res.status(500).json({ error: err.message || 'Failed to send document' });
  }
});

// Get document send history
router.get('/api/documents/history', requireAuth, requirePermission('send_documents', PERM_READ), async (req, res) => {
  try {
    const messages = await prisma.documentMessage.findMany({
      orderBy: { sentAt: 'desc' },
      take: 100,
      include: { customer: true }
    });

    // Resolve user fields for display
    const messagesWithUsers = await resolveUserFields(messages);

    res.json({ messages: messagesWithUsers });
  } catch (err) {
    console.error('Failed to fetch document history', err);
    res.status(500).json({ error: err.message || 'Failed to fetch document history' });
  }
});

export default router;
