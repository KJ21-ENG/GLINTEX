import XLSX from 'xlsx';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import whatsapp from '../../whatsapp/service.js';
import { interpolateTemplate, getTemplateByEvent, listTemplates, upsertTemplate } from '../utils/whatsappTemplates.js';
import { sendNotification } from '../utils/notifications.js';
import { logCrud } from '../utils/auditLogger.js';
import { clearSessionCookie, generateSessionToken, getSessionCookieOptions, getSessionExpiryDate, hashPassword, normalizeUsername, verifyPassword, SESSION_COOKIE_NAME } from '../utils/auth.js';
import { ensureDefaultAdminUser } from '../utils/defaultAdmin.js';
import bwipjs from 'bwip-js';
import { deriveMaterialCodeFromItem, makeInboundBarcode, makeIssueBarcode, makeReceiveBarcode, parseReceiveCrateIndex, makeHoloIssueBarcode, makeHoloReceiveBarcode, makeConingIssueBarcode, makeConingReceiveBarcode, parseHoloSeries, parseConingSeries } from '../utils/barcodeHelpers.js';
import { createBackup, listBackups, getBackupPath, normalizeBackupTime, updateBackupScheduleTime } from '../utils/backup.js';
import { getDiskUsage } from '../utils/diskSpace.js';
import { createGoogleDriveAuthUrl, disconnectGoogleDrive, getGoogleDriveStatus, handleGoogleDriveCallback, listDriveBackups } from '../utils/googleDrive.js';

const router = Router();
const RECEIVE_ROWS_FETCH_LIMIT = 5000;
const RECEIVE_UPLOADS_FETCH_LIMIT = 100;

let bootstrapToken = null;

function normalizeBarcodeInput(value) {
  return String(value || '').trim().toUpperCase();
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

// Round weight value to 3 decimal places for consistent storage
function roundTo3Decimals(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
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

function formatOpeningLotNo(nextVal) {
  const num = Number(nextVal);
  const padded = Number.isFinite(num)
    ? String(num).padStart(3, '0')
    : String(nextVal || '').padStart(3, '0');
  return `OP-${padded}`;
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

function getActor(req) {
  if (!req || !req.user) return null;
  return {
    userId: req.user.id,
    username: req.user.username,
    roleKey: req.user.roleKey,
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
      include: { role: true },
    });
    if (!user || !user.role) return res.status(401).json({ error: 'invalid_credentials' });
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
    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roleId: user.role.id,
        roleKey: user.role.key,
        roleName: user.role.name,
      },
    });
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
        roleId: adminRole.id,
        isActive: true,
      },
      include: { role: true },
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
    res.json({
      ok: true,
      user: {
        id: createdUser.id,
        username: createdUser.username,
        displayName: createdUser.displayName,
        roleId: createdUser.role.id,
        roleKey: createdUser.role.key,
        roleName: createdUser.role.name,
      },
    });
  } catch (err) {
    console.error('Bootstrap failed', err);
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

router.get('/api/health', async (req, res) => {
  res.json({ ok: true });
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
    if (!key || !/^[a-z0-9_\\-]+$/.test(key)) return res.status(400).json({ error: 'role key must be alphanumeric/underscore/dash' });
    if (!name) return res.status(400).json({ error: 'role name is required' });

    const created = await prisma.role.create({
      data: {
        key,
        name,
        description,
        ...actorCreateFields(actor?.userId),
      },
    });

    await logCrud({
      entityType: 'role',
      entityId: created.id,
      action: 'create',
      payload: { key, name, description },
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
    const updated = await prisma.role.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
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
    include: { role: true },
  });
  res.json({
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      isActive: u.isActive,
      role: u.role ? { id: u.role.id, key: u.role.key, name: u.role.name } : null,
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
    const roleId = req.body?.roleId ? String(req.body.roleId) : '';
    const isActive = req.body?.isActive !== false;
    if (!username || !password || !roleId) return res.status(400).json({ error: 'username, password, roleId are required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return res.status(400).json({ error: 'role not found' });

    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        roleId,
        isActive,
        ...actorCreateFields(actor?.userId),
      },
      include: { role: true },
    });

    await logCrud({
      entityType: 'user',
      entityId: created.id,
      action: 'create',
      payload: { username, displayName, roleId, isActive },
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
        role: created.role ? { id: created.role.id, key: created.role.key, name: created.role.name } : null,
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
    const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const displayName = req.body?.displayName !== undefined ? (req.body.displayName ? String(req.body.displayName).trim() : null) : undefined;
    const roleId = req.body?.roleId !== undefined ? String(req.body.roleId || '') : undefined;
    const isActive = req.body?.isActive !== undefined ? !!req.body.isActive : undefined;
    if (roleId !== undefined && !roleId) return res.status(400).json({ error: 'roleId is required when provided' });
    if (roleId !== undefined) {
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) return res.status(400).json({ error: 'role not found' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(roleId !== undefined ? { roleId } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...actorUpdateFields(actor?.userId),
      },
      include: { role: true },
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
        role: updated.role ? { id: updated.role.id, key: updated.role.key, name: updated.role.name } : null,
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

router.get('/api/db', async (req, res) => {
  const items = await prisma.item.findMany();
  const yarns = await prisma.yarn.findMany();
  const cuts = await prisma.cut.findMany({ orderBy: { name: 'asc' } });
  const twists = await prisma.twist.findMany({ orderBy: { name: 'asc' } });
  const firms = await prisma.firm.findMany();
  const suppliers = await prisma.supplier.findMany();
  const machines = await prisma.machine.findMany();
  const workers = await prisma.operator.findMany();
  const operators = workers.filter(w => (w.role || 'operator') === 'operator');
  const helpers = workers.filter(w => (w.role || 'operator') === 'helper');
  const bobbins = await prisma.bobbin.findMany();
  const boxes = await prisma.box.findMany();
  const lots = await prisma.lot.findMany();
  const inbound_items = await prisma.inboundItem.findMany();
  const issue_to_cutter_machine = await prisma.issueToCutterMachine.findMany();
  const issue_to_holo_machine = await prisma.issueToHoloMachine.findMany({ orderBy: { createdAt: 'desc' } });
  const issue_to_coning_machine = await prisma.issueToConingMachine.findMany({ orderBy: { createdAt: 'desc' } });
  const settings = await prisma.settings.findMany();
  const receive_from_cutter_machine_uploads = await prisma.receiveFromCutterMachineUpload.findMany({ orderBy: { uploadedAt: 'desc' }, take: RECEIVE_UPLOADS_FETCH_LIMIT });
  const receive_from_cutter_machine_rows = await prisma.receiveFromCutterMachineRow.findMany({
    orderBy: { createdAt: 'desc' },
    take: RECEIVE_ROWS_FETCH_LIMIT,
    include: {
      bobbin: {
        select: {
          id: true,
          name: true,
          weight: true,
        },
      },
      box: {
        select: {
          id: true,
          name: true,
          weight: true,
        },
      },
      operator: {
        select: {
          id: true,
          name: true,
        },
      },
      helper: {
        select: {
          id: true,
          name: true,
        },
      },
      cutMaster: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  const receive_from_cutter_machine_challans = await prisma.receiveFromCutterMachineChallan.findMany({
    orderBy: { createdAt: 'desc' },
    take: RECEIVE_ROWS_FETCH_LIMIT,
  });
  const receive_from_cutter_machine_piece_totals = await prisma.receiveFromCutterMachinePieceTotal.findMany();
  const receive_from_holo_machine_rows = await prisma.receiveFromHoloMachineRow.findMany({
    orderBy: { createdAt: 'desc' },
    take: RECEIVE_ROWS_FETCH_LIMIT,
    include: {
      operator: { select: { id: true, name: true } },
      helper: { select: { id: true, name: true } },
      issue: { select: { id: true, lotNo: true, itemId: true, barcode: true, date: true, yarnId: true, twistId: true, cutId: true, cut: { select: { name: true } } } },
      rollType: { select: { id: true, name: true, weight: true } },
      box: { select: { id: true, name: true, weight: true } },
    },
  });
  const receive_from_holo_machine_piece_totals = await prisma.receiveFromHoloMachinePieceTotal.findMany();
  const receive_from_coning_machine_rows = await prisma.receiveFromConingMachineRow.findMany({
    orderBy: { createdAt: 'desc' },
    take: RECEIVE_ROWS_FETCH_LIMIT,
    include: {
      operator: { select: { id: true, name: true } },
      helper: { select: { id: true, name: true } },
      issue: { select: { id: true, lotNo: true, barcode: true, date: true, itemId: true } },
      box: { select: { id: true, name: true, weight: true } },
    },
  });
  const receive_from_coning_machine_piece_totals = await prisma.receiveFromConingMachinePieceTotal.findMany();
  const roll_types = await prisma.rollType.findMany();
  const cone_types = await prisma.coneType.findMany();
  const wrappers = await prisma.wrapper.findMany();
  res.json({
    items,
    yarns,
    cuts,
    twists,
    firms,
    suppliers,
    machines,
    workers,
    operators,
    helpers,
    bobbins,
    boxes,
    lots,
    inbound_items,
    issue_to_cutter_machine,
    issue_to_holo_machine,
    issue_to_coning_machine,
    settings,
    receive_from_cutter_machine_uploads,
    receive_from_cutter_machine_rows,
    receive_from_cutter_machine_challans,
    receive_from_cutter_machine_piece_totals,
    receive_from_holo_machine_rows,
    receive_from_holo_machine_piece_totals,
    receive_from_coning_machine_rows,
    receive_from_coning_machine_piece_totals,
    roll_types,
    cone_types,
    wrappers,
  });
});

router.get('/api/receive_from_cutter_machine/piece/:pieceId/crate_stats', async (req, res) => {
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

router.get('/api/issue_to_cutter_machine', async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode query param' });
    const issue = await prisma.issueToCutterMachine.findUnique({ where: { barcode } });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').filter(Boolean) : [];
    res.json({ ...issue, pieceIds });
  } catch (err) {
    console.error('Failed to fetch issue by barcode', err);
    res.status(500).json({ error: 'Failed to fetch issue' });
  }
});

router.get('/api/inbound_items/barcode/:code', async (req, res) => {
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

router.get('/api/issue_to_cutter_machine/lookup', async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
    const issue = await prisma.issueToCutterMachine.findUnique({ where: { barcode } });
    if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
    const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean) : [];
    res.json({ ...issue, pieceIds });
  } catch (err) {
    console.error('Failed to lookup issue barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

router.get('/api/issue_to_holo_machine/lookup', async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
    const issue = await prisma.issueToHoloMachine.findUnique({ where: { barcode } });
    if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
    const receivedRefs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
    const rowIds = receivedRefs.map((r) => (typeof r?.rowId === 'string' ? r.rowId : null)).filter(Boolean);
    const rows = rowIds.length > 0
      ? await prisma.receiveFromCutterMachineRow.findMany({
        where: { id: { in: rowIds }, isDeleted: false },
        select: {
          id: true,
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
    const pieceIds = Array.from(new Set(rows.map((r) => r.pieceId).filter(Boolean)));
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
    res.json({ ...issue, pieceIds, crates });
  } catch (err) {
    console.error('Failed to lookup holo issue barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

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
router.get('/api/sequence/next', async (req, res) => {
  try {
    const seq = await prisma.sequence.findUnique({ where: { id: 'lot_sequence' } });
    const nextVal = (seq ? seq.nextValue : 0) + 1;
    res.json({ next: String(nextVal).padStart(3, '0'), raw: nextVal });
  } catch (err) {
    console.error('Failed to read sequence', err);
    res.status(500).json({ error: 'Failed to read sequence' });
  }
});

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

router.get('/api/opening_stock/sequence/next', async (req, res) => {
  try {
    const preview = await getOpeningLotPreview();
    res.json({ next: preview.lotNo, raw: preview.nextValue });
  } catch (err) {
    console.error('Failed to read opening sequence', err);
    res.status(500).json({ error: 'Failed to read opening sequence' });
  }
});

router.post('/api/opening_stock/inbound', async (req, res) => {
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

router.post('/api/opening_stock/cutter_receive', async (req, res) => {
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

      const bobbinWeight = Number(bobbin.weight);
      const boxWeight = Number(box.weight);
      if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) {
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

router.post('/api/opening_stock/holo_receive', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, firmId, supplierId, twistId, yarnId, machineId, operatorId, shift, crates } = req.body || {};
    if (!date || !itemId || !supplierId || !twistId) {
      return res.status(400).json({ error: 'Missing required opening stock fields' });
    }
    if (!Array.isArray(crates) || crates.length === 0) {
      return res.status(400).json({ error: 'Add at least one crate' });
    }

    const [itemRecord, firmRecord, supplierRecord, twistRecord] = await Promise.all([
      prisma.item.findUnique({ where: { id: itemId } }),
      firmId ? prisma.firm.findUnique({ where: { id: firmId } }) : Promise.resolve(null),
      prisma.supplier.findUnique({ where: { id: supplierId } }),
      prisma.twist.findUnique({ where: { id: twistId } }),
    ]);
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    if (firmId && !firmRecord) return res.status(404).json({ error: 'Firm not found' });
    if (!supplierRecord) return res.status(404).json({ error: 'Supplier not found' });
    if (!twistRecord) return res.status(404).json({ error: 'Twist not found' });

    const rollTypeIds = Array.from(new Set(crates.map(c => c?.rollTypeId).filter(Boolean)));
    const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));

    const [rollTypes, boxes] = await Promise.all([
      rollTypeIds.length ? prisma.rollType.findMany({ where: { id: { in: rollTypeIds } } }) : Promise.resolve([]),
      boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
    ]);

    const rollTypeMap = new Map(rollTypes.map(r => [r.id, r]));
    const boxMap = new Map(boxes.map(b => [b.id, b]));

    const normalizedCrates = crates.map((crate, idx) => {
      const rowIndex = idx + 1;
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

      await ensureHoloIssueSequence(tx, actorUserId);
      const holoSeq = await tx.holoIssueSequence.upsert({
        where: { id: 'holo_issue_seq' },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: 'holo_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
      });
      const seriesNumber = holoSeq.nextValue - 1;

      const issue = await tx.issueToHoloMachine.create({
        data: {
          date,
          itemId,
          lotNo,
          yarnId: yarnId || null,
          twistId,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: makeHoloIssueBarcode({ series: seriesNumber }),
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
      let crateIndex = 0;
      for (const row of normalizedCrates) {
        crateIndex += 1;
        const barcode = makeHoloReceiveBarcode({ series: seriesNumber, crateIndex });
        const created = await tx.receiveFromHoloMachineRow.create({
          data: {
            issueId: issue.id,
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

router.post('/api/opening_stock/coning_receive', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, firmId, supplierId, coneTypeId, wrapperId, machineId, operatorId, shift, crates } = req.body || {};
    if (!date || !itemId || !supplierId || !coneTypeId) {
      return res.status(400).json({ error: 'Missing required opening stock fields' });
    }
    if (!Array.isArray(crates) || crates.length === 0) {
      return res.status(400).json({ error: 'Add at least one crate' });
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

    const boxIds = Array.from(new Set(crates.map(c => c?.boxId).filter(Boolean)));

    const [boxes] = await Promise.all([
      boxIds.length ? prisma.box.findMany({ where: { id: { in: boxIds } } }) : Promise.resolve([]),
    ]);

    const boxMap = new Map(boxes.map(b => [b.id, b]));

    const coneWeight = Number(coneTypeRecord.weight);
    if (!Number.isFinite(coneWeight) || coneWeight <= 0) {
      return res.status(400).json({ error: 'Cone type weight missing. Update cone type first.' });
    }

    const normalizedCrates = crates.map((crate, idx) => {
      const rowIndex = idx + 1;
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

      await ensureConingIssueSequence(tx, actorUserId);
      const coningSeq = await tx.coningIssueSequence.upsert({
        where: { id: 'coning_issue_seq' },
        update: { nextValue: { increment: 1 }, ...actorUpdateFields(actorUserId) },
        create: { id: 'coning_issue_seq', nextValue: 2, ...actorCreateFields(actorUserId) },
      });
      const seriesNumber = coningSeq.nextValue - 1;

      const issue = await tx.issueToConingMachine.create({
        data: {
          date,
          itemId,
          lotNo,
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: makeConingIssueBarcode({ series: seriesNumber }),
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
      let crateIndex = 0;
      for (const row of normalizedCrates) {
        crateIndex += 1;
        const barcode = makeConingReceiveBarcode({ series: seriesNumber, crateIndex });
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
router.get('/api/opening_stock/template', async (req, res) => {
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
router.post('/api/opening_stock/preview/:stage', async (req, res) => {
  try {
    const { stage } = req.params;
    const { fileContent, fileType, date: uiDate, itemId: uiItemId, firmId: uiFirmId, supplierId: uiSupplierId } = req.body;

    if (!fileContent) return res.status(400).json({ error: 'Missing file content' });

    // Decode and parse file
    const base64Data = fileContent.replace(/^data:.*,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const rows = parseUploadBuffer(buffer, fileType);
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'File is empty' });

    // Collect unique names - including stage-specific fields
    const uniqueItemNames = new Set();
    const uniqueSupplierNames = new Set();
    const uniqueTwistNames = new Set();
    const uniqueYarnNames = new Set();
    const uniqueCutNames = new Set();
    rows.forEach(row => {
      if (row['Item Name']) uniqueItemNames.add(String(row['Item Name']).trim());
      if (row['Supplier Name']) uniqueSupplierNames.add(String(row['Supplier Name']).trim());
      if (row['Twist Name']) uniqueTwistNames.add(String(row['Twist Name']).trim());
      if (row['Yarn Name']) uniqueYarnNames.add(String(row['Yarn Name']).trim());
      if (row['Cutter (Cut Name)']) uniqueCutNames.add(String(row['Cutter (Cut Name)']).trim());
    });

    // Fetch masters
    const [items, suppliers, twists, yarns, cuts] = await Promise.all([
      uniqueItemNames.size > 0 ? prisma.item.findMany({ where: { name: { in: Array.from(uniqueItemNames), mode: 'insensitive' } } }) : [],
      uniqueSupplierNames.size > 0 ? prisma.supplier.findMany({ where: { name: { in: Array.from(uniqueSupplierNames), mode: 'insensitive' } } }) : [],
      uniqueTwistNames.size > 0 ? prisma.twist.findMany({ where: { name: { in: Array.from(uniqueTwistNames), mode: 'insensitive' } } }) : [],
      uniqueYarnNames.size > 0 ? prisma.yarn.findMany({ where: { name: { in: Array.from(uniqueYarnNames), mode: 'insensitive' } } }) : [],
      uniqueCutNames.size > 0 ? prisma.cut.findMany({ where: { name: { in: Array.from(uniqueCutNames), mode: 'insensitive' } } }) : [],
    ]);

    const itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));
    const supplierMap = new Map(suppliers.map(x => [x.name.toLowerCase(), x]));
    const twistMap = new Map(twists.map(x => [x.name.toLowerCase(), x]));
    const yarnMap = new Map(yarns.map(x => [x.name.toLowerCase(), x]));
    const cutMap = new Map(cuts.map(x => [x.name.toLowerCase(), x]));

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
      let supplierName = uiSupplierName;

      if (row['Item Name']) {
        const name = String(row['Item Name']).trim();
        const itm = itemMap.get(name.toLowerCase());
        if (!itm) {
          errors.push(`Row ${rowIdx}: Item '${name}' not found`);
          continue;
        }
        itemName = itm.name;
      }
      if (!itemName) {
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
      }
      if (!supplierName) {
        errors.push(`Row ${rowIdx}: Supplier Name is required`);
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

      const groupKey = `${itemName}::${supplierName}`;
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

router.post('/api/opening_stock/upload/:stage', async (req, res) => {
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

      // Group key = itemId + supplierId
      const groupKey = `${rowItemId}::${rowSupplierId}`;
      if (!groupedRows.has(groupKey)) {
        groupedRows.set(groupKey, { itemId: rowItemId, supplierId: rowSupplierId, firmId: rowFirmId, date: rowDate, rows: [] });
      }
      groupedRows.get(groupKey).rows.push(row);
    }

    // Process each group as a separate Lot
    const results = [];
    for (const [groupKey, group] of groupedRows.entries()) {
      const { itemId, supplierId, firmId, date, rows: groupRows } = group;
      const common = { date, itemId, firmId, supplierId, actorUserId };

      // Resolve process-specific fields from first row of each group
      const firstRow = groupRows[0];
      const twistId = extraParams.twistId || (firstRow['Twist Name'] ? twistMap.get(String(firstRow['Twist Name']).trim().toLowerCase())?.id : null);
      const yarnId = extraParams.yarnId || (firstRow['Yarn Name'] ? yarnMap.get(String(firstRow['Yarn Name']).trim().toLowerCase())?.id : null);
      const machineId = extraParams.machineId || (firstRow['Machine Name'] ? machineMap.get(String(firstRow['Machine Name']).trim().toLowerCase())?.id : null);
      const operatorId = extraParams.operatorId || (firstRow['Operator Name'] ? operatorMap.get(String(firstRow['Operator Name']).trim().toLowerCase())?.id : null);
      const shift = extraParams.shift || (firstRow['Shift'] ? String(firstRow['Shift']) : null);
      const wrapperId = extraParams.wrapperId || (firstRow['Wrapper Name'] ? wrapperMap.get(String(firstRow['Wrapper Name']).trim().toLowerCase())?.id : null);
      const cutId = extraParams.cutId || (firstRow['Cutter (Cut Name)'] ? cutMap.get(String(firstRow['Cutter (Cut Name)']).trim().toLowerCase())?.id : null);

      let result;
      if (stage === 'inbound') {
        result = await processOpeningInboundUpload(groupRows, common);
      } else if (stage === 'cutter') {
        result = await processOpeningCutterUpload(groupRows, common);
      } else if (stage === 'holo') {
        result = await processOpeningHoloUpload(groupRows, { ...common, twistId, yarnId, machineId, operatorId, shift, cutId });
      } else if (stage === 'coning') {
        result = await processOpeningConingUpload(groupRows, { ...common, machineId, operatorId, shift, wrapperId, coneTypeId: extraParams.coneTypeId });
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
          issueId: issue.id, date,
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

// Whatsapp control endpoints
router.get('/api/whatsapp/status', async (req, res) => {
  try {
    const status = whatsapp.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/whatsapp/start', async (req, res) => {
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
router.get('/api/whatsapp/groups', async (req, res) => {
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
router.get('/api/whatsapp/templates', async (req, res) => {
  try {
    const t = await listTemplates();
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Sticker template endpoints (shared across all users)
router.get('/api/sticker_templates', async (req, res) => {
  try {
    const templates = await prisma.stickerTemplate.findMany({ orderBy: { stageKey: 'asc' } });
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/api/sticker_templates/:stageKey', async (req, res) => {
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

router.put('/api/sticker_templates/:stageKey', async (req, res) => {
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

router.put('/api/whatsapp/templates/:event', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { event } = req.params;
    const { enabled, template, sendToPrimary, groupIds } = req.body;
    const cleanGroups = Array.isArray(groupIds) ? groupIds.filter(x => typeof x === 'string') : [];
    const t = await upsertTemplate(event, { enabled: !!enabled, template: template || '', sendToPrimary: sendToPrimary !== false, groupIds: cleanGroups }, { actorUserId });
    await logCrudWithActor(req, { entityType: 'whatsapp_template', entityId: String(t.id), action: 'upsert', payload: { event } });
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post('/api/whatsapp/send-event', async (req, res) => {
  try {
    const { event, payload } = req.body;
    const tpl = await getTemplateByEvent(event);
    if (!tpl || !tpl.enabled) return res.status(400).json({ error: 'Template not enabled or missing' });
    const msg = interpolateTemplate(tpl.template, payload || {});
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const recipients = [];
    if (tpl.sendToPrimary !== false && settings && settings.whatsappNumber) recipients.push({ type: 'number', value: settings.whatsappNumber });
    const allowedGroups = (settings && Array.isArray(settings.whatsappGroupIds)) ? settings.whatsappGroupIds : [];
    const templateGroups = (tpl && Array.isArray(tpl.groupIds)) ? tpl.groupIds : [];
    const groupsToSend = templateGroups.filter(id => allowedGroups.includes(id));
    for (const gid of groupsToSend) recipients.push({ type: 'group', value: gid });
    if (recipients.length === 0) return res.status(400).json({ error: 'No recipients configured' });
    const seen = new Set();
    const unique = recipients.filter(r => { const k = `${r.type}:${r.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
    unique.forEach(r => { if (r.type === 'number') whatsapp.sendTextSafe(r.value, msg).catch(() => { }); else whatsapp.sendToChatIdSafe(r.value, msg).catch(() => { }); });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get('/api/whatsapp/qrcode', async (req, res) => {
  try {
    const qr = whatsapp.getQrDataUrl();
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// SSE endpoint for real-time whatsapp events (qr/status)
router.get('/api/whatsapp/events', (req, res) => {
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

router.post('/api/whatsapp/logout', async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/whatsapp/send-test', async (req, res) => {
  try {
    const number = req.body.number || '916353131826';
    await whatsapp.sendText(number, 'Hii');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to send test message', err);
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/lots', async (req, res) => {
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
      sendNotification('inbound_created', { itemName, lotNo: result.lotNo, date, totalPieces, totalWeight });
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

router.post('/api/issue_to_cutter_machine', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { date, itemId, lotNo, pieceIds, note, machineId, operatorId, cutId } = req.body;
    if (!date || !itemId || !lotNo) {
      return res.status(400).json({ error: 'Missing required issue_to_cutter_machine fields' });
    }
    if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
      return res.status(400).json({ error: 'pieceIds must be a non-empty array' });
    }
    if (!cutId) {
      return res.status(400).json({ error: 'cutId is required' });
    }

    const itemRecord = await prisma.item.findUnique({ where: { id: itemId } });
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    const materialCode = deriveMaterialCodeFromItem(itemRecord);

    const cutRecord = await prisma.cut.findUnique({ where: { id: cutId } });
    if (!cutRecord) return res.status(404).json({ error: 'Cut not found' });

    const { issueRecord } = await prisma.$transaction(async (tx) => {
      const pieces = await tx.inboundItem.findMany({
        where: { id: { in: pieceIds } },
        orderBy: { seq: 'asc' },
      });

      if (pieces.length !== pieceIds.length) {
        throw new Error('One or more pieces do not exist');
      }

      for (const piece of pieces) {
        if (piece.status !== 'available') {
          throw new Error(`Piece ${piece.id} is not available`);
        }
        if (piece.lotNo !== lotNo) {
          throw new Error(`Piece ${piece.id} does not belong to lot ${lotNo}`);
        }
        if (piece.itemId !== itemId) {
          throw new Error(`Piece ${piece.id} does not match item ${itemId}`);
        }
      }

      const totalWeight = pieces.reduce((sum, piece) => sum + piece.weight, 0);
      const pieceIdsCsv = pieceIds.join(',');

      await tx.inboundItem.updateMany({
        where: { id: { in: pieceIds } },
        data: { status: 'consumed', ...actorUpdateFields(actorUserId) },
      });

      const firstSeq = pieces[0]?.seq ?? 0;
      const issueRow = await tx.issueToCutterMachine.create({
        data: {
          id: randomUUID(),
          date,
          itemId,
          lotNo,
          cutId,
          count: pieceIds.length,
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

      return { issueRecord: issueRow };
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
        pieceIds: issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [],
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
      sendNotification('issue_to_cutter_machine_created', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, machineName, machineNumber, operatorName, cutName, pieceIds: issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [] });
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

router.post('/api/receive_from_cutter_machine/import', async (req, res) => {
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

      const createPayload = rows.map(row => ({
        ...row,
        uploadId: createdUpload.id,
        bobbinQuantity: row.bobbinQuantity,
        bobbinId: bobbinIdMap.get(row.pcsTypeName) || bobbinIdMap.get(null) || bobbinIdMap.get(''),
        ...actorCreateFields(actorUserId),
      }));

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
router.post('/api/receive_from_cutter_machine/mark_wastage', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { pieceId } = req.body || {};
    if (!pieceId || typeof pieceId !== 'string') return res.status(400).json({ error: 'Missing pieceId' });

    // Check inbound item exists
    const inbound = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
    if (!inbound) return res.status(404).json({ error: 'Piece not found' });

    // Verify piece was issued to machine at least once
    const issuedCount = await prisma.issueToCutterMachine.count({ where: { pieceIds: { contains: pieceId } } });
    if (issuedCount === 0) return res.status(400).json({ error: 'Piece was not issued to machine' });

    // Fetch current received and wastage totals
    const currentTotal = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
    const received = currentTotal ? Number(currentTotal.totalNetWeight || 0) : 0;
    const existingWastage = currentTotal ? Number(currentTotal.wastageNetWeight || 0) : 0;

    const inboundWeight = Number(inbound.weight || 0);
    const remaining = Math.max(0, inboundWeight - received - existingWastage);
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
      sendNotification('piece_wastage_marked_cutter', { pieceId, lotNo, itemName, wastage: wastageFormatted, wastagePercent });
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
router.post('/api/receive_from_cutter_machine/bulk', async (req, res) => {
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

    const currentTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
    const inboundWeight = Number(piece.weight || 0);
    const alreadyReceived = currentTotals ? Number(currentTotals.totalNetWeight || 0) : 0;
    const existingWastage = currentTotals ? Number(currentTotals.wastageNetWeight || 0) : 0;
    let pendingRemaining = Math.max(0, inboundWeight - alreadyReceived - existingWastage);

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

      const bobbinWeight = Number(bobbin.weight);
      if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) {
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

      pendingRemaining = roundTo3Decimals(pendingRemaining - net);
      totalNetWeight = roundTo3Decimals(totalNetWeight + net);
      totalBobbinQty += bobbinQty;
      crateIndex += 1;

      rowsToCreate.push({
        pieceId,
        vchNo: `MAN-${randomUUID().slice(0, 8)}`,
        date: receiveDateStr,
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
        sendNotification('piece_wastage_marked_cutter', { pieceId, lotNo: piece.lotNo || '', itemName, wastage: wastageFormatted, wastagePercent });
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
      });
    } catch (e) { console.error('notify receive_from_cutter_machine bulk error', e); }
  } catch (err) {
    console.error('Failed to record bulk receive', err);
    res.status(500).json({ error: err.message || 'Failed to record bulk receive' });
  }
});

router.post('/api/receive_from_cutter_machine/manual', async (req, res) => {
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
    let resolvedPieceId = pieceId;
    let resolvedLotNo = lotNo;
    if (normalizedIssueCode) {
      const issue = await prisma.issueToCutterMachine.findUnique({ where: { barcode: normalizedIssueCode } });
      if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
      const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (pieceIds.length !== 1) {
        return res.status(400).json({ error: 'Issue barcode must reference exactly one piece' });
      }
      resolvedPieceId = pieceIds[0];
      resolvedLotNo = issue.lotNo;
    }

    if (!resolvedPieceId || typeof resolvedPieceId !== 'string') return res.status(400).json({ error: 'Missing pieceId' });

    const piece = await prisma.inboundItem.findUnique({ where: { id: resolvedPieceId } });
    if (!piece) return res.status(404).json({ error: 'Piece not found' });
    if (resolvedLotNo && piece.lotNo !== resolvedLotNo) return res.status(400).json({ error: 'Piece does not belong to the scanned issue' });

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

    const bobbinWeight = Number(bobbin.weight);
    if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) {
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

    const inboundWeight = Number(piece.weight || 0);
    const currentTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: resolvedPieceId } });
    const alreadyReceived = currentTotals ? Number(currentTotals.totalNetWeight || 0) : 0;
    const existingWastage = currentTotals ? Number(currentTotals.wastageNetWeight || 0) : 0;
    const pendingBefore = Math.max(0, inboundWeight - alreadyReceived - existingWastage);
    if (pendingBefore <= 0) {
      return res.status(400).json({ error: 'Piece has no pending weight remaining' });
    }
    if (net - pendingBefore > 1e-6) {
      return res.status(400).json({ error: 'Net weight exceeds pending weight' });
    }

    const receiveDateStr = toOptionalString(receiveDate) || new Date().toISOString().slice(0, 10);
    const vchNo = `MAN-${randomUUID().slice(0, 8)}`;

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

      const createdRow = await tx.receiveFromCutterMachineRow.create({
        data: {
          uploadId: upload.id,
          pieceId: resolvedPieceId,
          vchNo,
          date: receiveDateStr,
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

    const updatedTotals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: resolvedPieceId } });
    const pendingAfter = Math.max(
      0,
      inboundWeight - Number(updatedTotals?.totalNetWeight || 0) - Number(updatedTotals?.wastageNetWeight || 0)
    );

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
      });
    } catch (e) { console.error('notify receive_from_cutter_machine manual error', e); }
  } catch (err) {
    console.error('Failed to record manual receive', err);
    res.status(500).json({ error: err.message || 'Failed to record manual receive' });
  }
});

router.get('/api/receive_from_cutter_machine/challans/:id', async (req, res) => {
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

router.put('/api/receive_from_cutter_machine/challans/:id', async (req, res) => {
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

      const bobbinWeight = Number(bobbin.weight);
      if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) {
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

router.delete('/api/receive_from_cutter_machine/challans/:id', async (req, res) => {
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

router.post('/api/receive_from_cutter_machine/preview', async (req, res) => {
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

router.post('/api/issue_to_holo_machine', async (req, res) => {
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
        issuedBobbinWeight: Number(crate.issuedBobbinWeight || 0),
      }))
      .filter((crate) => crate.rowId);

    if (normalizedCrates.length === 0) {
      return res.status(400).json({ error: 'Invalid crate payload' });
    }
    if (normalizedCrates.some((crate) => !Number.isFinite(crate.issuedBobbins) || crate.issuedBobbins <= 0)) {
      return res.status(400).json({ error: 'Enter bobbin quantity for each scanned crate' });
    }
    if (normalizedCrates.some((crate) => !Number.isFinite(crate.issuedBobbinWeight) || crate.issuedBobbinWeight < 0)) {
      return res.status(400).json({ error: 'Invalid bobbin weight for a crate' });
    }

    const rowIds = normalizedCrates.map((crate) => crate.rowId);
    const uniqueRowIds = new Set(rowIds);
    if (uniqueRowIds.size !== rowIds.length) {
      return res.status(400).json({ error: 'Duplicate crates were scanned. Remove duplicates and try again.' });
    }
    const receiveRows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: rowIds }, isDeleted: false },
      select: { id: true, pieceId: true, issuedBobbins: true, issuedBobbinWeight: true },
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
    if (lotSet.size !== 1 || itemSet.size !== 1) {
      return res.status(400).json({ error: 'Crates must belong to a single lot and item' });
    }
    const lotNo = Array.from(lotSet)[0];
    const itemId = Array.from(itemSet)[0];

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

    const totalBobbins = normalizedCrates.reduce((sum, crate) => sum + (Number(crate.issuedBobbins) || 0), 0);
    if (!Number.isFinite(totalBobbins) || totalBobbins <= 0) {
      return res.status(400).json({ error: 'Enter bobbin quantity for the scanned crates' });
    }
    const totalWeight = normalizedCrates.reduce((sum, crate) => sum + (Number(crate.issuedBobbinWeight) || 0), 0);
    const normalizedYarnKg = Number(yarnKg || 0);

    const created = await prisma.$transaction(async (tx) => {
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
          machineId: machineId || null,
          operatorId: operatorId || null,
          barcode: makeHoloIssueBarcode({ series: seriesNumber }),
          note: note || null,
          shift: shift || null,
          metallicBobbins: totalBobbins,
          metallicBobbinsWeight: totalWeight,
          yarnKg: Number.isFinite(normalizedYarnKg) ? normalizedYarnKg : 0,
          receivedRowRefs: normalizedCrates,
          rollsProducedEstimate: rollsProducedEstimate == null ? null : Number(rollsProducedEstimate),
          ...actorCreateFields(actorUserId),
        },
      });

      for (const crate of normalizedCrates) {
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
      const twistRec = await prisma.twist.findUnique({ where: { id: created.twistId } });

      sendNotification('issue_to_holo_machine_created', {
        itemName,
        lotNo: created.lotNo,
        date: created.date,
        metallicBobbins: created.metallicBobbins,
        metallicBobbinsWeight: created.metallicBobbinsWeight,
        yarnKg: created.yarnKg,
        machineName: machineRec ? machineRec.name : '',
        operatorName: operatorRec ? operatorRec.name : '',
        twistName: twistRec ? twistRec.name : '',
        barcode: created.barcode,
      });
    } catch (e) { console.error('notify issue_to_holo_machine error', e); }
  } catch (err) {
    console.error('Failed to issue to holo machine', err);
    res.status(500).json({ error: err.message || 'Failed to issue to holo' });
  }
});

router.post('/api/receive_from_holo_machine/manual', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const {
      issueId,
      pieceId,
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
    const rollCountNum = Number(rollCount);
    const grossNum = Number(grossWeight);

    if (!issueId || !pieceId || !Number.isFinite(rollCountNum) || rollCountNum <= 0 || !Number.isFinite(grossNum) || grossNum <= 0) {
      return res.status(400).json({ error: 'Missing required roll count or gross weight data' });
    }

    const rollType = rollTypeId ? await prisma.rollType.findUnique({ where: { id: rollTypeId } }) : null;
    const box = boxId ? await prisma.box.findUnique({ where: { id: boxId } }) : null;
    const issue = await prisma.issueToHoloMachine.findUnique({
      where: { id: issueId },
      select: { lotNo: true, barcode: true, itemId: true },
    });
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
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
        barcode,
      });
    } catch (e) { console.error('notify receive_from_holo_machine manual error', e); }
  } catch (err) {
    console.error('Failed to receive from holo machine', err);
    res.status(500).json({ error: err.message || 'Failed to record holo receive' });
  }
});

router.post('/api/issue_to_coning_machine', async (req, res) => {
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
        where: { id: { in: rowIds } },
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
    }

    const holoRows = holoWhere.length
      ? await prisma.receiveFromHoloMachineRow.findMany({
        where: { OR: holoWhere },
        include: { issue: { select: { id: true, lotNo: true, itemId: true } } },
      })
      : [];

    const rows = [...coningRows, ...holoRows];
    if (rows.length !== normalizedCrates.length) return res.status(404).json({ error: 'One or more scanned crates were not found' });

    const rowMapById = new Map(rows.map((r) => [r.id, r]));
    const rowMapByBarcode = new Map(
      rows
        .filter((r) => r?.barcode)
        .map((r) => [normalizeBarcodeInput(r.barcode), r]),
    );

    const resolvedCrates = normalizedCrates.map((crate) => {
      const found = crate.rowId ? rowMapById.get(crate.rowId) : rowMapByBarcode.get(crate.barcode);
      return {
        ...crate,
        rowId: found?.id || crate.rowId,
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

    const lotSet = new Set(resolvedCrates.map((c) => c.lotNo).filter(Boolean));
    const itemSet = new Set(resolvedCrates.map((c) => c.itemId).filter(Boolean));
    if (lotSet.size !== 1 || itemSet.size !== 1) return res.status(400).json({ error: 'Crates must belong to a single lot and item' });
    const lotNo = Array.from(lotSet)[0];
    const itemId = Array.from(itemSet)[0];

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
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
          WHERE elem->>'rowId' = ANY (${rowIdArray}::text[])
             OR elem->>'barcode' = ANY (${barcodeArray}::text[])
        )
      `;
    }

    const previouslyIssuedByRowId = new Map();
    for (const issue of existingRowRefs) {
      const refs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
      for (const ref of refs) {
        const rid = ref?.rowId || (ref?.barcode ? normalizeBarcodeInput(ref.barcode) : null);
        if (!rid) continue;
        const already = previouslyIssuedByRowId.get(rid) || 0;
        previouslyIssuedByRowId.set(rid, already + (Number(ref.issueRolls) || 0));
      }
    }

    const issueTracker = new Map();
    const overIssuedCrates = [];
    for (const crate of preparedCrates) {
      const rid = crate.rowId || (crate.barcode ? normalizeBarcodeInput(crate.barcode) : null);
      if (!rid) continue;
      const baseRolls = Number(crate.baseRolls) || 0;
      const existingIssued = previouslyIssuedByRowId.get(rid) || 0;
      const alreadyPlanned = issueTracker.get(rid) || 0;
      const totalAfterRequest = existingIssued + alreadyPlanned + (Number(crate.issueRolls) || 0);

      if (baseRolls > 0 && totalAfterRequest > baseRolls) {
        overIssuedCrates.push({
          rowId: rid,
          barcode: crate.barcode,
          requestedRolls: crate.issueRolls,
          availableRolls: Math.max(baseRolls - existingIssued - alreadyPlanned, 0),
        });
      }

      issueTracker.set(rid, alreadyPlanned + (Number(crate.issueRolls) || 0));
    }

    if (overIssuedCrates.length) {
      return res.status(400).json({
        error: 'One or more crates have already been fully issued',
        crates: overIssuedCrates,
      });
    }

    const totalRolls = preparedCrates.reduce((sum, c) => sum + (Number(c.issueRolls) || 0), 0);
    const totalIssueWeightKg = preparedCrates.reduce((sum, c) => sum + (Number(c.issueWeight) || 0), 0);
    const expectedCones = requiredPerConeNetWeight > 0
      ? Math.floor((totalIssueWeightKg * 1000) / requiredPerConeNetWeight)
      : 0;

    const created = await prisma.$transaction(async (tx) => {
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

      sendNotification('issue_to_coning_machine_created', {
        itemName,
        lotNo: created.lotNo,
        date: created.date,
        rollsIssued: created.rollsIssued,
        requiredPerConeNetWeight: created.requiredPerConeNetWeight,
        expectedCones: created.expectedCones,
        machineName: machineRec ? machineRec.name : '',
        operatorName: operatorRec ? operatorRec.name : '',
        barcode: created.barcode,
      });
    } catch (e) { console.error('notify issue_to_coning_machine error', e); }
  } catch (err) {
    console.error('Failed to issue to coning machine', err);
    res.status(500).json({ error: err.message || 'Failed to issue to coning' });
  }
});

router.post('/api/receive_from_coning_machine/manual', async (req, res) => {
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
    const issue = await prisma.issueToConingMachine.findUnique({ where: { id: issueId } });
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

    const createdRow = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId,
        coneCount,
        barcode,
        coneWeight: Number(netWeight),
        netWeight: Number(netWeight),
        tareWeight: Number(tareWeight),
        grossWeight: Number(grossWeight),
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
        barcode,
      });
    } catch (e) { console.error('notify receive_from_coning_machine manual error', e); }
  } catch (err) {
    console.error('Failed to receive from coning machine', err);
    res.status(500).json({ error: err.message || 'Failed to record coning receive' });
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
router.get('/api/items', async (req, res) => { res.json(await prisma.item.findMany()); });
router.post('/api/items', async (req, res) => {
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
router.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const existingItem = await prisma.item.findUnique({ where: { id } });
  if (!existingItem) {
    return res.status(404).json({ error: 'Item not found' });
  }
  const usage = await prisma.lot.count({ where: { itemId: id } }) + await prisma.inboundItem.count({ where: { itemId: id } }) + await prisma.issueToCutterMachine.count({ where: { itemId: id } });
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
router.put('/api/items/:id', async (req, res) => {
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

router.get('/api/yarns', async (req, res) => {
  const yarns = await prisma.yarn.findMany({ orderBy: { name: 'asc' } });
  res.json(yarns);
});

router.post('/api/yarns', async (req, res) => {
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

router.put('/api/yarns/:id', async (req, res) => {
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

router.delete('/api/yarns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.yarn.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Yarn not found' });
    }
    const issueUsage = await prisma.issueToHoloMachine.count({ where: { yarnId: id } });
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

router.get('/api/cuts', async (req, res) => {
  const cuts = await prisma.cut.findMany({ orderBy: { name: 'asc' } });
  res.json(cuts);
});

router.post('/api/cuts', async (req, res) => {
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

router.put('/api/cuts/:id', async (req, res) => {
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

router.delete('/api/cuts/:id', async (req, res) => {
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

router.get('/api/twists', async (req, res) => {
  const twists = await prisma.twist.findMany({ orderBy: { name: 'asc' } });
  res.json(twists);
});

router.post('/api/twists', async (req, res) => {
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

router.put('/api/twists/:id', async (req, res) => {
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

router.delete('/api/twists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.twist.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Twist not found' });
    }
    const usage = await prisma.issueToHoloMachine.count({ where: { twistId: id } });
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

router.get('/api/firms', async (req, res) => { res.json(await prisma.firm.findMany()); });
router.post('/api/firms', async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, address, mobile } = req.body;
  const firm = await prisma.firm.create({ data: { name, address, mobile, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'firm', entityId: firm.id, action: 'create', payload: firm });
  res.json(firm);
});
router.delete('/api/firms/:id', async (req, res) => {
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
router.put('/api/firms/:id', async (req, res) => {
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

router.get('/api/suppliers', async (req, res) => { res.json(await prisma.supplier.findMany()); });
router.post('/api/suppliers', async (req, res) => {
  const actorUserId = req.user?.id;
  const { name } = req.body;
  const seller = await prisma.supplier.create({ data: { name, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'supplier', entityId: seller.id, action: 'create', payload: seller });
  res.json(seller);
});
router.delete('/api/suppliers/:id', async (req, res) => {
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
router.put('/api/suppliers/:id', async (req, res) => {
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

router.get('/api/machines', async (req, res) => { res.json(await prisma.machine.findMany()); });
router.post('/api/machines', async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, processType = 'all' } = req.body;
  const machine = await prisma.machine.create({ data: { name, processType, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'machine', entityId: machine.id, action: 'create', payload: machine });
  res.json(machine);
});
router.delete('/api/machines/:id', async (req, res) => {
  const { id } = req.params;
  const existingMachine = await prisma.machine.findUnique({ where: { id } });
  if (!existingMachine) return res.status(404).json({ error: 'Machine not found' });
  const usage = await prisma.issueToCutterMachine.count({ where: { machineId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Machine is referenced and cannot be deleted' });
  }
  await prisma.machine.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'machine', entityId: id, action: 'delete', payload: existingMachine });
  res.json({ ok: true });
});
// Update machine name and processType
router.put('/api/machines/:id', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { name, processType } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Machine not found' });
    const data = { name };
    if (processType !== undefined) data.processType = processType;
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
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update machine', err);
    res.status(500).json({ error: err.message || 'Failed to update machine' });
  }
});

router.get('/api/operators', async (req, res) => { res.json(await prisma.operator.findMany()); });
router.post('/api/operators', async (req, res) => {
  const actorUserId = req.user?.id;
  const { name, role, processType = 'all' } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const workerRole = normalizeWorkerRole(role);
  const worker = await prisma.operator.create({ data: { name, role: workerRole, processType, ...actorCreateFields(actorUserId) } });
  await logCrudWithActor(req, { entityType: 'operator', entityId: worker.id, action: 'create', payload: worker });
  res.json(worker);
});
router.delete('/api/operators/:id', async (req, res) => {
  const { id } = req.params;
  const existingOperator = await prisma.operator.findUnique({ where: { id } });
  if (!existingOperator) return res.status(404).json({ error: 'Operator not found' });
  const usage =
    (await prisma.issueToCutterMachine.count({ where: { operatorId: id } })) +
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
router.put('/api/operators/:id', async (req, res) => {
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

router.get('/api/bobbins', async (req, res) => { res.json(await prisma.bobbin.findMany()); });
router.post('/api/bobbins', async (req, res) => {
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
router.delete('/api/bobbins/:id', async (req, res) => {
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
router.put('/api/bobbins/:id', async (req, res) => {
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
router.get('/api/roll_types', async (req, res) => { res.json(await prisma.rollType.findMany()); });
router.post('/api/roll_types', async (req, res) => {
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
router.put('/api/roll_types/:id', async (req, res) => {
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
router.delete('/api/roll_types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.rollType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Roll type not found' });
    const usage = await prisma.receiveFromHoloMachineRow.count({ where: { rollTypeId: id } });
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

router.get('/api/boxes', async (req, res) => { res.json(await prisma.box.findMany()); });
router.post('/api/boxes', async (req, res) => {
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
router.delete('/api/boxes/:id', async (req, res) => {
  const { id } = req.params;
  const existingBox = await prisma.box.findUnique({ where: { id } });
  if (!existingBox) return res.status(404).json({ error: 'Box not found' });
  const usage = (await prisma.receiveFromCutterMachineRow.count({ where: { boxId: id, isDeleted: false } }))
    + (await prisma.receiveFromHoloMachineRow.count({ where: { boxId: id } }))
    + (await prisma.receiveFromConingMachineRow.count({ where: { boxId: id } }));
  if (usage > 0) {
    return res.status(400).json({ error: 'Box is referenced and cannot be deleted' });
  }
  await prisma.box.delete({ where: { id } });
  await logCrudWithActor(req, { entityType: 'box', entityId: id, action: 'delete', payload: existingBox });
  res.json({ ok: true });
});

router.get('/api/cone_types', async (req, res) => { res.json(await prisma.coneType.findMany()); });
router.post('/api/cone_types', async (req, res) => {
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
router.put('/api/cone_types/:id', async (req, res) => {
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
router.delete('/api/cone_types/:id', async (req, res) => {
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

router.get('/api/wrappers', async (req, res) => { res.json(await prisma.wrapper.findMany()); });
router.post('/api/wrappers', async (req, res) => {
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
router.put('/api/wrappers/:id', async (req, res) => {
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
router.delete('/api/wrappers/:id', async (req, res) => {
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
router.put('/api/boxes/:id', async (req, res) => {
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

router.delete('/api/issue_to_cutter_machine/:id', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;

    // Find the issue_to_cutter_machine record
    const issueRecord = await prisma.issueToCutterMachine.findUnique({ where: { id } });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to machine record not found' });
    }

    // Get the piece IDs from the issue_to_cutter_machine record
    const pieceIds = issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [];
    const cleanPieceIds = pieceIds.map(p => String(p).trim()).filter(Boolean);
    if (cleanPieceIds.length > 0) {
      const receiveCount = await prisma.receiveFromCutterMachineRow.count({ where: { pieceId: { in: cleanPieceIds }, isDeleted: false } });
      if (receiveCount > 0) {
        return res.status(400).json({ error: 'Cannot delete issue: receive records exist for one or more pieces' });
      }
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Delete the issue_to_cutter_machine record
      await tx.issueToCutterMachine.delete({ where: { id } });

      // Mark pieces as available again
      if (cleanPieceIds.length > 0) {
        await tx.inboundItem.updateMany({
          where: { id: { in: cleanPieceIds } },
          data: { status: 'available', ...actorUpdateFields(actorUserId) },
        });
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
      sendNotification('issue_to_cutter_machine_deleted', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, pieceIds: cleanPieceIds, machineName: machineNameDel, machineNumber: machineNumberDel, operatorName: operatorNameDel });
    } catch (e) { console.error('notify issue_to_cutter_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_cutter_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_cutter_machine record' });
  }
});

// Delete an issue_to_holo_machine record (safe delete)
router.delete('/api/issue_to_holo_machine/:id', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;

    // Find the issue record
    const issueRecord = await prisma.issueToHoloMachine.findUnique({ where: { id } });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to Holo machine record not found' });
    }

    // Check if any receives exist for this issue
    const receiveCount = await prisma.receiveFromHoloMachineRow.count({ where: { issueId: id } });
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

      // Delete the issue record
      await tx.issueToHoloMachine.delete({ where: { id } });

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
      });
    } catch (e) { console.error('notify issue_to_holo_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_holo_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_holo_machine record' });
  }
});

// Delete an issue_to_coning_machine record (safe delete)
router.delete('/api/issue_to_coning_machine/:id', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;

    // Find the issue record
    const issueRecord = await prisma.issueToConingMachine.findUnique({ where: { id } });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to Coning machine record not found' });
    }

    // Check if any receives exist for this issue
    const receiveCount = await prisma.receiveFromConingMachineRow.count({ where: { issueId: id } });
    if (receiveCount > 0) {
      return res.status(400).json({ error: 'Cannot delete issue: receive records exist for this issue' });
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Delete the issue record (no source row updates needed for coning)
      await tx.issueToConingMachine.delete({ where: { id } });

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
      });
    } catch (e) { console.error('notify issue_to_coning_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_coning_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_coning_machine record' });
  }
});

// Delete a single inbound item (piece)
router.delete('/api/inbound_items/:id', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const existing = await prisma.inboundItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Inbound piece not found' });
    // Do not allow delete if consumed
    if (existing.status === 'consumed') return res.status(400).json({ error: 'Cannot delete consumed piece' });

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
      sendNotification('inbound_piece_deleted', { itemName, lotNo: existing.lotNo, pieceId: existing.id });
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

router.put('/api/settings', async (req, res) => {
  try {
    const actorUserId = req.user?.id;
    const body = req.body || {};
    const brandPrimary = body.brandPrimary ?? body.primary;
    const brandGold = body.brandGold ?? body.gold;
    const { logoDataUrl, faviconDataUrl, whatsappNumber, whatsappGroupIds, backupTime, challanFromName, challanFromAddress, challanFromMobile, challanFieldsConfig } = body;
    const hasBrandPrimary = Object.prototype.hasOwnProperty.call(body, 'brandPrimary') || Object.prototype.hasOwnProperty.call(body, 'primary');
    const hasBrandGold = Object.prototype.hasOwnProperty.call(body, 'brandGold') || Object.prototype.hasOwnProperty.call(body, 'gold');
    const hasLogoDataUrl = Object.prototype.hasOwnProperty.call(body, 'logoDataUrl');
    const hasFaviconDataUrl = Object.prototype.hasOwnProperty.call(body, 'faviconDataUrl');
    const hasWhatsAppNumber = Object.prototype.hasOwnProperty.call(body, 'whatsappNumber');
    const hasWhatsAppGroupIds = Object.prototype.hasOwnProperty.call(body, 'whatsappGroupIds');
    const hasBackupTime = Object.prototype.hasOwnProperty.call(body, 'backupTime');
    const hasChallanFromName = Object.prototype.hasOwnProperty.call(body, 'challanFromName');
    const hasChallanFromAddress = Object.prototype.hasOwnProperty.call(body, 'challanFromAddress');
    const hasChallanFromMobile = Object.prototype.hasOwnProperty.call(body, 'challanFromMobile');
    const hasChallanFieldsConfig = Object.prototype.hasOwnProperty.call(body, 'challanFieldsConfig');
    const previousSettings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (hasBackupTime && req.user?.roleKey !== 'admin') {
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
      if (hasWhatsAppNumber) updateData.whatsappNumber = normalizedWhatsAppNumber || null;
      if (hasWhatsAppGroupIds && cleanGroupIds !== undefined) updateData.whatsappGroupIds = cleanGroupIds;
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
      if (hasFaviconDataUrl) createData.faviconDataUrl = faviconDataUrl || null;
      if (hasWhatsAppNumber) createData.whatsappNumber = normalizedWhatsAppNumber || null;
      if (hasWhatsAppGroupIds) createData.whatsappGroupIds = cleanGroupIds || [];
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
        before: previousSettings,
        after: settings,
        payload: settings,
      });
      return res.json(settings);
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
        before: previousSettings,
        after: settings,
        payload: settings,
      });
      return res.json(settings);
    }
  } catch (err) {
    console.error('Failed to update settings', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Update a single inbound piece (seq, weight)
router.put('/api/inbound_items/:id', async (req, res) => {
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
router.delete('/api/lots/:lotNo', async (req, res) => {
  try {
    const { lotNo } = req.params;
    // Do not allow delete if any issue_to_cutter_machine record exists for this lot
    const consCount = await prisma.issueToCutterMachine.count({ where: { lotNo } });
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
      sendNotification('lot_deleted', { itemName: itemRec ? itemRec.name : '', lotNo, totalPieces, date: lotRec ? lotRec.date : '' });
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
router.get('/api/backups', async (req, res) => {
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
router.get('/api/disk-usage', async (req, res) => {
  try {
    const usage = await getDiskUsage();
    res.json(usage);
  } catch (err) {
    console.error('Failed to get disk usage', err);
    res.status(500).json({ error: 'Failed to get disk usage' });
  }
});

// ========== CUSTOMER ENDPOINTS ==========

router.get('/api/customers', async (req, res) => {
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

router.post('/api/customers', async (req, res) => {
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

router.put('/api/customers/:id', async (req, res) => {
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

router.delete('/api/customers/:id', async (req, res) => {
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
router.get('/api/dispatch/available/:stage', async (req, res) => {
  try {
    const { stage } = req.params;
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
          availableWeight: Math.max(0, item.weight - (item.dispatchedWeight || 0)),
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
          return {
            id: row.id,
            barcode: row.barcode || row.vchNo,
            pieceId: row.pieceId,
            weight: netWt,
            dispatchedWeight: dispatched,
            issuedToHolo: issuedToHolo,
            availableWeight: Math.max(0, netWt - dispatched - issuedToHolo),
            stage: 'cutter',
            bobbinQuantity: row.bobbinQuantity,
          };
        })
        .filter(item => item.availableWeight > 0);
    } else if (stage === 'holo') {
      // Get holo receive rows with remaining weight
      const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
        include: { issue: true },
        orderBy: { createdAt: 'desc' },
      });
      items = holoRows
        .map(row => {
          const netWeight = row.rollWeight ? (row.rollWeight * row.rollCount) : (row.grossWeight || 0) - (row.tareWeight || 0);
          return {
            id: row.id,
            barcode: row.barcode,
            lotNo: row.issue?.lotNo,
            weight: netWeight,
            dispatchedWeight: row.dispatchedWeight || 0,
            availableWeight: Math.max(0, netWeight - (row.dispatchedWeight || 0)),
            stage: 'holo',
            rollCount: row.rollCount,
          };
        })
        .filter(item => item.availableWeight > 0);
    } else if (stage === 'coning') {
      // Get coning receive rows with remaining weight
      const coningRows = await prisma.receiveFromConingMachineRow.findMany({
        include: { issue: true },
        orderBy: { createdAt: 'desc' },
      });
      items = coningRows
        .map(row => ({
          id: row.id,
          barcode: row.barcode,
          lotNo: row.issue?.lotNo,
          weight: row.netWeight || 0,
          dispatchedWeight: row.dispatchedWeight || 0,
          availableWeight: Math.max(0, (row.netWeight || 0) - (row.dispatchedWeight || 0)),
          stage: 'coning',
          coneCount: row.coneCount,
        }))
        .filter(item => item.availableWeight > 0);
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
router.get('/api/dispatch', async (req, res) => {
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

    const dispatches = await prisma.dispatch.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ dispatches });
  } catch (err) {
    console.error('Failed to fetch dispatches', err);
    res.status(500).json({ error: 'Failed to fetch dispatches' });
  }
});

// Get single dispatch
router.get('/api/dispatch/:id', async (req, res) => {
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

// Create dispatch
router.post('/api/dispatch', async (req, res) => {
  try {
    const actor = getActor(req);
    const { customerId, stage, stageItemId, weight, date, notes } = req.body;

    if (!customerId) return res.status(400).json({ error: 'Customer is required' });
    if (!stage) return res.status(400).json({ error: 'Stage is required' });
    if (!stageItemId) return res.status(400).json({ error: 'Stage item is required' });
    if (!weight || weight <= 0) return res.status(400).json({ error: 'Valid weight is required' });
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

      // Fetch source item INSIDE transaction to get fresh data
      if (stage === 'inbound') {
        sourceItem = await tx.inboundItem.findUnique({ where: { id: stageItemId } });
        if (!sourceItem) throw new Error('Inbound item not found');
        stageBarcode = sourceItem.barcode;
        availableWeight = sourceItem.weight - (sourceItem.dispatchedWeight || 0);
      } else if (stage === 'cutter') {
        sourceItem = await tx.receiveFromCutterMachineRow.findUnique({ where: { id: stageItemId } });
        if (!sourceItem) throw new Error('Cutter receive row not found');
        stageBarcode = sourceItem.barcode || sourceItem.vchNo;
        // Subtract both dispatchedWeight AND issuedBobbinWeight (weight already issued to Holo)
        const issuedToHolo = sourceItem.issuedBobbinWeight || 0;
        availableWeight = (sourceItem.netWt || 0) - (sourceItem.dispatchedWeight || 0) - issuedToHolo;
      } else if (stage === 'holo') {
        sourceItem = await tx.receiveFromHoloMachineRow.findUnique({ where: { id: stageItemId } });
        if (!sourceItem) throw new Error('Holo receive row not found');
        stageBarcode = sourceItem.barcode || '';
        const netWeight = sourceItem.rollWeight ? (sourceItem.rollWeight * sourceItem.rollCount) : (sourceItem.grossWeight || 0) - (sourceItem.tareWeight || 0);
        availableWeight = netWeight - (sourceItem.dispatchedWeight || 0);
      } else if (stage === 'coning') {
        sourceItem = await tx.receiveFromConingMachineRow.findUnique({ where: { id: stageItemId } });
        if (!sourceItem) throw new Error('Coning receive row not found');
        stageBarcode = sourceItem.barcode || '';
        availableWeight = (sourceItem.netWeight || 0) - (sourceItem.dispatchedWeight || 0);
      }

      // Validate weight INSIDE transaction to prevent race condition
      if (weight > availableWeight + 0.001) {
        throw new Error(`Dispatch weight (${weight}) exceeds available weight (${availableWeight.toFixed(3)})`);
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
          weight: roundTo3Decimals(weight),
          notes: notes || null,
          ...actorCreateFields(actor?.userId),
        },
        include: { customer: true },
      });

      // Update dispatchedWeight on source item
      if (stage === 'inbound') {
        await tx.inboundItem.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { increment: roundTo3Decimals(weight) } },
        });
      } else if (stage === 'cutter') {
        await tx.receiveFromCutterMachineRow.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { increment: roundTo3Decimals(weight) } },
        });
      } else if (stage === 'holo') {
        await tx.receiveFromHoloMachineRow.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { increment: roundTo3Decimals(weight) } },
        });
      } else if (stage === 'coning') {
        await tx.receiveFromConingMachineRow.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { increment: roundTo3Decimals(weight) } },
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

// Delete/cancel dispatch (restores weight)
router.delete('/api/dispatch/:id', async (req, res) => {
  try {
    const actor = getActor(req);
    const { id } = req.params;

    const existing = await prisma.dispatch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Dispatch not found' });

    // Delete dispatch and restore weight in transaction
    await prisma.$transaction(async (tx) => {
      await tx.dispatch.delete({ where: { id } });

      // Restore dispatchedWeight on source item
      const { stage, stageItemId, weight } = existing;

      if (stage === 'inbound') {
        await tx.inboundItem.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { decrement: weight } },
        });
      } else if (stage === 'cutter') {
        await tx.receiveFromCutterMachineRow.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { decrement: weight } },
        });
      } else if (stage === 'holo') {
        await tx.receiveFromHoloMachineRow.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { decrement: weight } },
        });
      } else if (stage === 'coning') {
        await tx.receiveFromConingMachineRow.update({
          where: { id: stageItemId },
          data: { dispatchedWeight: { decrement: weight } },
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

// ========== REPORTS ENDPOINTS ==========

// Barcode History - trace full lifecycle of a barcode
router.get('/api/reports/barcode-history/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const normalizedBarcode = normalizeBarcodeInput(barcode);

    const history = {
      barcode: normalizedBarcode,
      found: false,
      stages: [],
    };

    // 1. Check InboundItem
    const inboundItem = await prisma.inboundItem.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
    });

    if (inboundItem) {
      history.found = true;
      const lot = await prisma.lot.findUnique({ where: { lotNo: inboundItem.lotNo } });
      const item = lot?.itemId ? await prisma.item.findUnique({ where: { id: lot.itemId } }) : null;

      history.stages.push({
        stage: 'inbound',
        date: lot?.date || null,
        data: {
          pieceId: inboundItem.id,
          barcode: inboundItem.barcode,
          lotNo: inboundItem.lotNo,
          itemName: item?.name || null,
          weight: inboundItem.weight,
          status: inboundItem.status,
          seq: inboundItem.seq,
          dispatchedWeight: inboundItem.dispatchedWeight || 0,
        },
      });

      // 2. Check if issued to cutter
      const cutterIssue = await prisma.issueToCutterMachine.findFirst({
        where: { pieceIds: { contains: inboundItem.id } },
        include: { machine: true, operator: true, cut: true },
      });

      if (cutterIssue) {
        history.stages.push({
          stage: 'cutter_issue',
          date: cutterIssue.date,
          data: {
            issueId: cutterIssue.id,
            barcode: cutterIssue.barcode,
            machineName: cutterIssue.machine?.name || null,
            operatorName: cutterIssue.operator?.name || null,
            cutName: cutterIssue.cut?.name || null,
            totalWeight: cutterIssue.totalWeight,
            pieceCount: cutterIssue.count,
          },
        });

        // 3. Check cutter receive
        const cutterReceives = await prisma.receiveFromCutterMachineRow.findMany({
          where: { pieceId: inboundItem.id, isDeleted: false },
          include: { challan: true, bobbin: true, operator: true },
          orderBy: { createdAt: 'asc' },
        });

        for (const recv of cutterReceives) {
          history.stages.push({
            stage: 'cutter_receive',
            date: recv.date || recv.challan?.date,
            data: {
              receiveId: recv.id,
              barcode: recv.barcode,
              challanNo: recv.challan?.challanNo || null,
              bobbinQuantity: recv.bobbinQuantity,
              netWeight: recv.netWt,
              operatorName: recv.operator?.name || null,
              dispatchedWeight: recv.dispatchedWeight || 0,
            },
          });
        }
      }
    }

    // Also search by barcode in other tables
    // Search Cutter Issue
    const cutterIssueByBarcode = await prisma.issueToCutterMachine.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
      include: { machine: true, operator: true, cut: true },
    });

    if (cutterIssueByBarcode && !history.stages.find(s => s.stage === 'cutter_issue' && s.data.issueId === cutterIssueByBarcode.id)) {
      history.found = true;
      history.stages.push({
        stage: 'cutter_issue',
        date: cutterIssueByBarcode.date,
        data: {
          issueId: cutterIssueByBarcode.id,
          barcode: cutterIssueByBarcode.barcode,
          lotNo: cutterIssueByBarcode.lotNo,
          machineName: cutterIssueByBarcode.machine?.name || null,
          operatorName: cutterIssueByBarcode.operator?.name || null,
          cutName: cutterIssueByBarcode.cut?.name || null,
          totalWeight: cutterIssueByBarcode.totalWeight,
          pieceCount: cutterIssueByBarcode.count,
        },
      });
    }

    // Search Holo Issue
    const holoIssue = await prisma.issueToHoloMachine.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
      include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
    });

    if (holoIssue) {
      history.found = true;
      history.stages.push({
        stage: 'holo_issue',
        date: holoIssue.date,
        data: {
          issueId: holoIssue.id,
          barcode: holoIssue.barcode,
          lotNo: holoIssue.lotNo,
          machineName: holoIssue.machine?.name || null,
          operatorName: holoIssue.operator?.name || null,
          yarnName: holoIssue.yarn?.name || null,
          twistName: holoIssue.twist?.name || null,
          cutName: holoIssue.cut?.name || null,
          metallicBobbins: holoIssue.metallicBobbins,
          metallicBobbinsWeight: holoIssue.metallicBobbinsWeight,
        },
      });

      // Check holo receives
      const holoReceives = await prisma.receiveFromHoloMachineRow.findMany({
        where: { issueId: holoIssue.id },
        include: { rollType: true, operator: true, box: true },
        orderBy: { createdAt: 'asc' },
      });

      for (const recv of holoReceives) {
        history.stages.push({
          stage: 'holo_receive',
          date: recv.date,
          data: {
            receiveId: recv.id,
            barcode: recv.barcode,
            rollCount: recv.rollCount,
            rollWeight: recv.rollWeight,
            grossWeight: recv.grossWeight,
            tareWeight: recv.tareWeight,
            rollTypeName: recv.rollType?.name || null,
            operatorName: recv.operator?.name || null,
            dispatchedWeight: recv.dispatchedWeight || 0,
          },
        });
      }
    }

    // Search Holo Receive by barcode
    const holoRecvByBarcode = await prisma.receiveFromHoloMachineRow.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
      include: { issue: true, rollType: true, operator: true },
    });

    if (holoRecvByBarcode && !history.stages.find(s => s.stage === 'holo_receive' && s.data.receiveId === holoRecvByBarcode.id)) {
      history.found = true;
      history.stages.push({
        stage: 'holo_receive',
        date: holoRecvByBarcode.date,
        data: {
          receiveId: holoRecvByBarcode.id,
          barcode: holoRecvByBarcode.barcode,
          lotNo: holoRecvByBarcode.issue?.lotNo || null,
          rollCount: holoRecvByBarcode.rollCount,
          rollWeight: holoRecvByBarcode.rollWeight,
          grossWeight: holoRecvByBarcode.grossWeight,
          tareWeight: holoRecvByBarcode.tareWeight,
          rollTypeName: holoRecvByBarcode.rollType?.name || null,
          operatorName: holoRecvByBarcode.operator?.name || null,
          dispatchedWeight: holoRecvByBarcode.dispatchedWeight || 0,
        },
      });
    }

    // Search Coning Issue
    const coningIssue = await prisma.issueToConingMachine.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
      include: { machine: true, operator: true },
    });

    if (coningIssue) {
      history.found = true;
      history.stages.push({
        stage: 'coning_issue',
        date: coningIssue.date,
        data: {
          issueId: coningIssue.id,
          barcode: coningIssue.barcode,
          lotNo: coningIssue.lotNo,
          machineName: coningIssue.machine?.name || null,
          operatorName: coningIssue.operator?.name || null,
          rollsIssued: coningIssue.rollsIssued,
          expectedCones: coningIssue.expectedCones,
        },
      });

      // Check coning receives
      const coningReceives = await prisma.receiveFromConingMachineRow.findMany({
        where: { issueId: coningIssue.id },
        include: { operator: true, box: true },
        orderBy: { createdAt: 'asc' },
      });

      for (const recv of coningReceives) {
        history.stages.push({
          stage: 'coning_receive',
          date: recv.date,
          data: {
            receiveId: recv.id,
            barcode: recv.barcode,
            coneCount: recv.coneCount,
            netWeight: recv.netWeight,
            grossWeight: recv.grossWeight,
            tareWeight: recv.tareWeight,
            operatorName: recv.operator?.name || null,
            dispatchedWeight: recv.dispatchedWeight || 0,
          },
        });
      }
    }

    // Search Coning Receive by barcode
    const coningRecvByBarcode = await prisma.receiveFromConingMachineRow.findFirst({
      where: { barcode: { equals: normalizedBarcode, mode: 'insensitive' } },
      include: { issue: true, operator: true },
    });

    if (coningRecvByBarcode && !history.stages.find(s => s.stage === 'coning_receive' && s.data.receiveId === coningRecvByBarcode.id)) {
      history.found = true;
      history.stages.push({
        stage: 'coning_receive',
        date: coningRecvByBarcode.date,
        data: {
          receiveId: coningRecvByBarcode.id,
          barcode: coningRecvByBarcode.barcode,
          lotNo: coningRecvByBarcode.issue?.lotNo || null,
          coneCount: coningRecvByBarcode.coneCount,
          netWeight: coningRecvByBarcode.netWeight,
          grossWeight: coningRecvByBarcode.grossWeight,
          tareWeight: coningRecvByBarcode.tareWeight,
          operatorName: coningRecvByBarcode.operator?.name || null,
          dispatchedWeight: coningRecvByBarcode.dispatchedWeight || 0,
        },
      });
    }

    // Search Dispatches by stageBarcode
    const dispatches = await prisma.dispatch.findMany({
      where: { stageBarcode: { equals: normalizedBarcode, mode: 'insensitive' } },
      include: { customer: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const d of dispatches) {
      history.found = true;
      history.stages.push({
        stage: 'dispatch',
        date: d.date,
        data: {
          dispatchId: d.id,
          challanNo: d.challanNo,
          customerName: d.customer?.name || null,
          weight: d.weight,
          sourceStage: d.stage,
          notes: d.notes,
        },
      });
    }

    // Sort stages by date
    history.stages.sort((a, b) => {
      if (!a.date) return -1;
      if (!b.date) return 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    res.json({ history });
  } catch (err) {
    console.error('Failed to fetch barcode history', err);
    res.status(500).json({ error: 'Failed to fetch barcode history' });
  }
});

// Production Report
router.get('/api/reports/production', async (req, res) => {
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
        },
      });
      const totalCutterIssued = cutterIssues.reduce((sum, i) => sum + (i.totalWeight || 0), 0);

      // Get cutter receive data
      const cutterReceives = await prisma.receiveFromCutterMachineRow.findMany({
        where: {
          isDeleted: false,
          date: { gte: fromDate, lte: toDate },
        },
        include: { operator: true },
      });

      const cutterPieceTotals = await prisma.receiveFromCutterMachinePieceTotal.findMany();
      const totalCutterReceived = cutterPieceTotals.reduce((sum, t) => sum + (t.totalNetWeight || 0), 0);
      const totalCutterWastage = cutterPieceTotals.reduce((sum, t) => sum + (t.wastageNetWeight || 0), 0);

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
      } else {
        // Machine-wise (default)
        const byMachine = new Map();
        for (const row of cutterReceives) {
          const key = row.machineNo || 'unknown';
          const current = byMachine.get(key) || { machineNo: key, received: 0, count: 0 };
          current.received += row.netWt || 0;
          current.count += 1;
          byMachine.set(key, current);
        }
        if (process === 'cutter') {
          report.data = Array.from(byMachine.values());
        }
      }
    }

    if (process === 'holo' || !process || process === 'all') {
      // Get ACTUAL issued weight from IssueToHoloMachine
      const holoIssues = await prisma.issueToHoloMachine.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
        },
      });
      // Holo issued weight = metallicBobbinsWeight + yarnKg
      const totalHoloIssued = holoIssues.reduce((sum, i) => sum + (i.metallicBobbinsWeight || 0) + (i.yarnKg || 0), 0);

      // Get holo receive data
      const holoReceives = await prisma.receiveFromHoloMachineRow.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
        },
        include: { operator: true, issue: { include: { machine: true } } },
      });

      const holoPieceTotals = await prisma.receiveFromHoloMachinePieceTotal.findMany();
      const totalHoloReceived = holoPieceTotals.reduce((sum, t) => sum + (t.totalNetWeight || 0), 0);
      const totalHoloWastage = holoPieceTotals.reduce((sum, t) => sum + (t.wastageNetWeight || 0), 0);

      if (!process || process === 'all' || process === 'holo') {
        report.summary.totalIssued += totalHoloIssued;
        report.summary.totalReceived += totalHoloReceived;
        report.summary.totalWastage += totalHoloWastage;
      }

      if (view === 'operator' && process === 'holo') {
        const byOperator = new Map();
        for (const row of holoReceives) {
          const key = row.operatorId || 'unknown';
          const netWeight = row.rollWeight ? (row.rollWeight * row.rollCount) : (row.grossWeight || 0) - (row.tareWeight || 0);
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
          const netWeight = row.rollWeight ? (row.rollWeight * row.rollCount) : (row.grossWeight || 0) - (row.tareWeight || 0);
          const current = byShift.get(key) || { shift: key, received: 0, rollCount: 0 };
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byShift.set(key, current);
        }
        report.data = Array.from(byShift.values());
      } else if (process === 'holo') {
        const byMachine = new Map();
        for (const row of holoReceives) {
          const key = row.issue?.machine?.name || row.machineNo || 'unknown';
          const netWeight = row.rollWeight ? (row.rollWeight * row.rollCount) : (row.grossWeight || 0) - (row.tareWeight || 0);
          const current = byMachine.get(key) || { machineName: key, received: 0, rollCount: 0 };
          current.received += netWeight;
          current.rollCount += row.rollCount || 0;
          byMachine.set(key, current);
        }
        report.data = Array.from(byMachine.values());
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
        },
      });

      // Calculate coning issued weight by summing up requiredPerConeNetWeight * expectedCones  
      // or we can use rollsIssued and lookup the actual roll weights
      // Simpler approach: use expectedCones * requiredPerConeNetWeight as the target input
      let totalConingIssued = 0;
      for (const issue of coningIssues) {
        // If we have receivedRowRefs, try to get actual weights from holo receives
        try {
          const refs = JSON.parse(issue.receivedRowRefs || '[]');
          if (Array.isArray(refs) && refs.length > 0) {
            const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
              where: { id: { in: refs } },
            });
            const issuedWeight = holoRows.reduce((sum, r) => {
              const netWeight = r.rollWeight ? (r.rollWeight * r.rollCount) : (r.grossWeight || 0) - (r.tareWeight || 0);
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

      // Get coning receive data
      const coningReceives = await prisma.receiveFromConingMachineRow.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
        },
        include: { operator: true, issue: { include: { machine: true } } },
      });

      const coningPieceTotals = await prisma.receiveFromConingMachinePieceTotal.findMany();
      const totalConingReceived = coningPieceTotals.reduce((sum, t) => sum + (t.totalNetWeight || 0), 0);
      const totalConingWastage = coningPieceTotals.reduce((sum, t) => sum + (t.wastageNetWeight || 0), 0);

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
      } else if (process === 'coning') {
        const byMachine = new Map();
        for (const row of coningReceives) {
          const key = row.issue?.machine?.name || row.machineNo || 'unknown';
          const current = byMachine.get(key) || { machineName: key, received: 0, coneCount: 0 };
          current.received += row.netWeight || 0;
          current.coneCount += row.coneCount || 0;
          byMachine.set(key, current);
        }
        report.data = Array.from(byMachine.values());
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

export default router;
