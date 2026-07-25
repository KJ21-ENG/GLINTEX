import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requirePermission, requireEditPermission, requireDeletePermission, requireRole } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import { logCrud } from '../utils/auditLogger.js';
import { resolveUserFields } from '../utils/userResolver.js';
import {
  ADJUSTMENT_TYPES,
  PAYMENT_MODES,
  isValidDateStr,
  normalizeSide,
  computeAmount,
  roundKg,
  roundTo,
  ratesConflict,
} from '../services/contractorPayments/calc.js';
import {
  computePayablePreview,
  recomputeSettlementTotals,
  diffSettlementProduction,
  isValidProcess,
  lockSettlementInputs,
  lockSettlementLineCreation,
} from '../services/contractorPayments/service.js';
import { generateContractorSettlementPdf } from '../utils/pdf/contractorSettlementPdf.js';

const router = Router();
// Payments workflow (preview/settlements/mark-paid/paid-edit/PDF) is gated by
// contractor_payments; the underlying contractor/assignment/rate master data is
// managed under the Masters permission (it lives in the Masters UI).
const PERM = 'contractor_payments';
const MASTERS = 'masters';
const PERM_READ = ACCESS_LEVELS.READ;
const PERM_WRITE = ACCESS_LEVELS.WRITE;

// All contractor-payment routes require an authenticated user. (This sub-router
// is mounted before the global requireAuth in routes/index.js.)
router.use(requireAuth);

// Allow the request if the user has READ on ANY of the given permission keys
// (admins always pass). Used for master-data lists that both the Masters page
// and the Contractor Payments page need to read.
function requireAnyRead(keys) {
  return function requireAnyReadMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (req.user.isAdmin) return next();
    const ok = keys.some((k) => Number(req.user.permissions?.[k] || 0) >= PERM_READ);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actorCreateFields(userId) {
  if (!userId) return {};
  return { createdByUserId: userId, updatedByUserId: userId };
}
function actorUpdateFields(userId) {
  if (!userId) return {};
  return { updatedByUserId: userId };
}
function getActor(req) {
  if (!req?.user) return null;
  return { userId: req.user.id, username: req.user.username, roleKey: req.user.primaryRoleKey || null };
}
async function audit(req, args, client) {
  const actor = getActor(req);
  return logCrud({
    ...args,
    client,
    actorUserId: actor?.userId,
    actorUsername: actor?.username,
    actorRoleKey: actor?.roleKey,
  });
}

// Sanity ceilings so out-of-range inputs return 400 rather than overflowing a
// Decimal column and surfacing as a 500. Chosen so that neither a single
// override product (MAX_KG × MAX_RATE = 1e12) NOR the worst-case adjustments
// aggregate (MAX_ADJUSTMENTS × MAX_AMOUNT = 2e13) can exceed DECIMAL(16,2)
// (~1e14), while remaining far above any realistic weight/rate/amount.
const MAX_AMOUNT = 1e11; // ₹ per adjustment
const MAX_KG = 1e7;
const MAX_RATE = 1e5; // ₹/KG
const MAX_ADJUSTMENTS = 200;
const MAX_RATE_BATCH = 100;

function num(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanString(value, max = 500) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function cleanStringList(value, max = 40) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.map((item) => cleanString(item, max)).filter(Boolean)));
}

function parseProcess(value) {
  const p = String(value || '').trim().toLowerCase();
  return isValidProcess(p) ? p : null;
}

// Serialize a settlement (with relations) converting Decimals to numbers.
function serializeSettlement(s) {
  if (!s) return null;
  return {
    ...s,
    productionKg: num(s.productionKg),
    productionAmount: num(s.productionAmount),
    adjustmentsTotal: num(s.adjustmentsTotal),
    finalPayable: num(s.finalPayable),
    lines: Array.isArray(s.lines) ? s.lines.map(serializeLine) : undefined,
    adjustments: Array.isArray(s.adjustments)
      ? s.adjustments.map((a) => ({ ...a, amount: num(a.amount) }))
      : undefined,
    revisions: Array.isArray(s.revisions)
      ? s.revisions.map((r) => ({
        ...r,
        previousTotal: num(r.previousTotal),
        newTotal: num(r.newTotal),
        delta: num(r.delta),
      }))
      : undefined,
  };
}
function serializeLine(l) {
  return { ...l, netKg: num(l.netKg), ratePerKg: num(l.ratePerKg), amount: num(l.amount) };
}
// Lean snapshot (lines + adjustments + totals) used for immutable before/after
// revision records. Drops nested revisions (avoids recursive growth) and the
// joined contractor so the before/after shapes stay symmetric.
function settlementSnapshot(s) {
  const serialized = serializeSettlement(s);
  if (serialized) {
    delete serialized.revisions;
    delete serialized.contractor;
  }
  return serialized;
}
function serializeRate(r) {
  return { ...r, ratePerKg: num(r.ratePerKg) };
}


// Validate + normalize a rate payload for a process; returns { data } or { error }.
function normalizeRatePayload(process, body) {
  const ratePerKg = num(body.ratePerKg);
  if (ratePerKg === null || ratePerKg <= 0 || ratePerKg > MAX_RATE) return { error: 'ratePerKg must be a positive number within range' };

  const data = {
    process,
    ratePerKg,
    itemId: null,
    yarnId: null,
    cutId: null,
    side: null,
    twistId: null,
    coneTypeId: null,
  };
  if (process === 'cutter') {
    data.itemId = cleanString(body.itemId, 40);
    data.cutId = cleanString(body.cutId, 40);
  } else if (process === 'holo') {
    data.yarnId = cleanString(body.yarnId, 40);
    data.cutId = cleanString(body.cutId, 40); // optional override
    data.twistId = cleanString(body.twistId, 40); // optional override
    if (!data.yarnId) return { error: 'Holo rate requires Yarn' };
  } else if (process === 'coning') {
    data.yarnId = cleanString(body.yarnId, 40);
    data.cutId = cleanString(body.cutId, 40); // optional override
    data.side = normalizeSide(body.side);
    data.twistId = cleanString(body.twistId, 40); // optional override
    data.coneTypeId = cleanString(body.coneTypeId, 40); // optional override
    if (!data.yarnId) return { error: 'Coning rate requires Yarn' };
    if (!data.side || data.side === 'UNKNOWN') return { error: 'Coning rate requires a Side (SINGLE or BOTH)' };
  }
  return { data };
}

// Confirm every quality-key master referenced by a rate actually exists. The
// keys are stored as plain string IDs (no FK), so validate them here to avoid
// creating an unusable financial rate from a stale/crafted request.
async function validateRateReferences(data) {
  const checks = [];
  if (data.itemId) checks.push(prisma.item.count({ where: { id: data.itemId } }).then((n) => (n ? null : 'Item')));
  if (data.yarnId) checks.push(prisma.yarn.count({ where: { id: data.yarnId } }).then((n) => (n ? null : 'Yarn')));
  if (data.cutId) checks.push(prisma.cut.count({ where: { id: data.cutId } }).then((n) => (n ? null : 'Cut')));
  if (data.twistId) checks.push(prisma.twist.count({ where: { id: data.twistId } }).then((n) => (n ? null : 'Twist')));
  if (data.coneTypeId) checks.push(prisma.coneType.count({ where: { id: data.coneTypeId } }).then((n) => (n ? null : 'Cone Type')));
  const missing = (await Promise.all(checks)).filter(Boolean);
  return missing.length ? `Unknown ${missing.join(', ')} reference` : null;
}

// ===========================================================================
// Contractor CRUD
// ===========================================================================

router.get('/contractors', requireAnyRead([MASTERS, PERM]), async (req, res) => {
  try {
    const contractors = await prisma.contractor.findMany({ orderBy: { name: 'asc' } });
    res.json(await resolveUserFields(contractors, ['createdByUserId', 'updatedByUserId']));
  } catch (err) {
    console.error('Failed to list contractors', err);
    res.status(500).json({ error: err.message || 'Failed to list contractors' });
  }
});

router.post('/contractors', requirePermission(MASTERS, PERM_WRITE), async (req, res) => {
  try {
    const name = cleanString(req.body?.name, 200);
    if (!name) return res.status(400).json({ error: 'Contractor name is required' });
    const data = {
      name,
      phone: cleanString(req.body?.phone, 40),
      paymentDetails: cleanString(req.body?.paymentDetails, 1000),
      notes: cleanString(req.body?.notes, 2000),
      isActive: req.body?.isActive === undefined ? true : !!req.body.isActive,
      ...actorCreateFields(req.user?.id),
    };
    const contractor = await prisma.contractor.create({ data });
    await audit(req, { entityType: 'contractor', entityId: contractor.id, action: 'create', payload: contractor });
    res.json(contractor);
  } catch (err) {
    console.error('Failed to create contractor', err);
    res.status(500).json({ error: err.message || 'Failed to create contractor' });
  }
});

router.put('/contractors/:id', requireEditPermission(MASTERS), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.contractor.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Contractor not found' });
    const name = cleanString(req.body?.name, 200);
    if (!name) return res.status(400).json({ error: 'Contractor name is required' });
    const data = {
      name,
      phone: cleanString(req.body?.phone, 40),
      paymentDetails: cleanString(req.body?.paymentDetails, 1000),
      notes: cleanString(req.body?.notes, 2000),
      isActive: req.body?.isActive === undefined ? existing.isActive : !!req.body.isActive,
      ...actorUpdateFields(req.user?.id),
    };
    const updated = await prisma.contractor.update({ where: { id }, data });
    await audit(req, { entityType: 'contractor', entityId: id, action: 'update', before: existing, after: updated });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update contractor', err);
    res.status(500).json({ error: err.message || 'Failed to update contractor' });
  }
});

router.delete('/contractors/:id', requireDeletePermission(MASTERS), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.contractor.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Contractor not found' });
    const settlementCount = await prisma.contractorSettlement.count({ where: { contractorId: id } });
    if (settlementCount > 0) {
      return res.status(400).json({ error: 'Contractor has settlements and cannot be deleted. Deactivate instead.' });
    }
    // Assignments and rates cascade on delete.
    await prisma.contractor.delete({ where: { id } });
    await audit(req, { entityType: 'contractor', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete contractor', err);
    res.status(500).json({ error: err.message || 'Failed to delete contractor' });
  }
});

// ===========================================================================
// Assignment CRUD
// ===========================================================================

router.get('/assignments', requireAnyRead([MASTERS, PERM]), async (req, res) => {
  try {
    const where = {};
    const contractorId = cleanString(req.query.contractorId, 40);
    const process = parseProcess(req.query.process);
    if (contractorId) where.contractorId = contractorId;
    if (process) where.process = process;
    const rows = await prisma.contractorAssignment.findMany({
      where,
      orderBy: { process: 'asc' },
    });
    res.json(await resolveUserFields(rows, ['createdByUserId', 'updatedByUserId']));
  } catch (err) {
    console.error('Failed to list assignments', err);
    res.status(500).json({ error: err.message || 'Failed to list assignments' });
  }
});

// Serialize overlap-sensitive writes for a logical key using a transaction-
// scoped Postgres advisory lock, so the "check then write" is atomic against
// concurrent requests (closes the TOCTOU window the plain findMany+create had).
async function withAdvisoryLock(lockName, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockName}))`;
    return fn(tx);
  });
}

// Acquire multiple logical locks in a stable order when a master row changes
// process/contractor, preventing a lock-order inversion between two edits.
async function withAdvisoryLocks(lockNames, fn) {
  const names = Array.from(new Set(lockNames.filter(Boolean))).sort();
  return prisma.$transaction(async (tx) => {
    for (const name of names) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
    }
    return fn(tx);
  });
}

const overlapError = (message) => Object.assign(new Error(message), { statusCode: 409 });
const httpError = (statusCode, message, extra) => Object.assign(new Error(message), { statusCode, extra });

// Serialize ALL mutations of a single settlement (draft-edit, mark-paid,
// paid-edit) under one transaction-scoped advisory lock so a concurrent editor
// can't change lines/adjustments/status between another path's revalidation and
// its write. Generous timeout because the body may run a full payable preview.
async function withSettlementLock(id, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contractor_settlement:${id}`}))`;
    return fn(tx);
  }, { timeout: 20000, maxWait: 10000 });
}

router.post('/assignments', requirePermission(MASTERS, PERM_WRITE), async (req, res) => {
  try {
    const contractorId = cleanString(req.body?.contractorId, 40);
    const process = parseProcess(req.body?.process);
    if (!contractorId) return res.status(400).json({ error: 'contractorId is required' });
    if (!process) return res.status(400).json({ error: 'process must be cutter, holo, or coning' });
    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
    if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
    let created;
    try {
      created = await withAdvisoryLock(`contractor_assignment:${process}`, async (tx) => {
        const existing = await tx.contractorAssignment.findUnique({ where: { process } });
        if (existing) throw overlapError('This process already has a contractor. Edit the current assignment to change the owner.');
        return tx.contractorAssignment.create({
          data: { contractorId, process, ...actorCreateFields(req.user?.id) },
        });
      });
    } catch (e) {
      if (e?.statusCode === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
    await audit(req, { entityType: 'contractor_assignment', entityId: created.id, action: 'create', payload: created });
    res.json(created);
  } catch (err) {
    console.error('Failed to create assignment', err);
    res.status(500).json({ error: err.message || 'Failed to create assignment' });
  }
});

router.put('/assignments/:id', requireEditPermission(MASTERS), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.contractorAssignment.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Assignment not found' });
    const process = parseProcess(req.body?.process ?? existing.process);
    const contractorId = cleanString(req.body?.contractorId, 40) || existing.contractorId;
    if (!process) return res.status(400).json({ error: 'process must be cutter, holo, or coning' });
    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
    if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
    let updated;
    try {
      updated = await withAdvisoryLocks([
        `contractor_assignment:${existing.process}`,
        `contractor_assignment:${process}`,
      ], async (tx) => {
        const conflicting = await tx.contractorAssignment.findUnique({ where: { process } });
        if (conflicting && conflicting.id !== id) {
          throw overlapError('This process already has a contractor. Edit the current assignment to change the owner.');
        }
        return tx.contractorAssignment.update({
          where: { id },
          data: { contractorId, process, ...actorUpdateFields(req.user?.id) },
        });
      });
    } catch (e) {
      if (e?.statusCode === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
    await audit(req, { entityType: 'contractor_assignment', entityId: id, action: 'update', before: existing, after: updated });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update assignment', err);
    res.status(500).json({ error: err.message || 'Failed to update assignment' });
  }
});

router.delete('/assignments/:id', requireDeletePermission(MASTERS), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.contractorAssignment.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Assignment not found' });
    // Serialize owner deletion with create/update and preview-backed draft
    // creation for this process.
    await withAdvisoryLock(`contractor_assignment:${existing.process}`, async (tx) => {
      await tx.contractorAssignment.deleteMany({ where: { id } });
    });
    await audit(req, { entityType: 'contractor_assignment', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete assignment', err);
    res.status(500).json({ error: err.message || 'Failed to delete assignment' });
  }
});

// ===========================================================================
// Rate CRUD
// ===========================================================================

router.get('/rates', requireAnyRead([MASTERS, PERM]), async (req, res) => {
  try {
    const where = {};
    const contractorId = cleanString(req.query.contractorId, 40);
    const process = parseProcess(req.query.process);
    if (contractorId) where.contractorId = contractorId;
    if (process) where.process = process;
    const rows = await prisma.contractorRate.findMany({
      where,
      orderBy: [{ process: 'asc' }, { createdAt: 'desc' }],
    });
    const resolved = await resolveUserFields(rows.map(serializeRate), ['createdByUserId', 'updatedByUserId']);
    res.json(resolved);
  } catch (err) {
    console.error('Failed to list rates', err);
    res.status(500).json({ error: err.message || 'Failed to list rates' });
  }
});

// Reject a new/updated current rate that could match the same row at equal
// specificity as an existing rate (would be ambiguous at match time) — this
// covers identical tuples AND cross-override conflicts.
async function assertNoRateOverlap(tx, contractorId, process, data, excludeId) {
  const existing = await tx.contractorRate.findMany({ where: { contractorId, process } });
  return existing.some((r) => r.id !== excludeId
    && ratesConflict(process, data, r));
}

router.post('/rates', requirePermission(MASTERS, PERM_WRITE), async (req, res) => {
  try {
    const contractorId = cleanString(req.body?.contractorId, 40);
    const process = parseProcess(req.body?.process);
    if (!contractorId) return res.status(400).json({ error: 'contractorId is required' });
    if (!process) return res.status(400).json({ error: 'process must be cutter, holo, or coning' });
    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
    if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
    const hasYarnIds = req.body?.yarnIds !== undefined;
    const hasSides = req.body?.sides !== undefined;
    const hasConeTypeIds = req.body?.coneTypeIds !== undefined;
    if (hasYarnIds && process === 'cutter') {
      return res.status(400).json({ error: 'yarnIds are supported only for holo and coning rates' });
    }
    if ((hasSides || hasConeTypeIds) && process !== 'coning') {
      return res.status(400).json({ error: 'sides and coneTypeIds are supported only for coning rates' });
    }
    const yarnIds = process === 'cutter'
      ? [null]
      : (hasYarnIds ? cleanStringList(req.body?.yarnIds) : [cleanString(req.body?.yarnId, 40)]);
    if (process !== 'cutter' && yarnIds.length === 0) {
      const { error } = normalizeRatePayload(process, { ...(req.body || {}), yarnId: null });
      return res.status(400).json({ error });
    }

    const rawSides = process === 'coning'
      ? (hasSides ? cleanStringList(req.body?.sides) : [cleanString(req.body?.side, 40)])
      : [null];
    const sides = process === 'coning'
      ? Array.from(new Set(rawSides.map((side) => normalizeSide(side))))
      : [null];
    if (process === 'coning' && sides.length === 0) {
      const { error } = normalizeRatePayload(process, { ...(req.body || {}), yarnId: yarnIds[0], side: null });
      return res.status(400).json({ error });
    }

    const rawConeTypeIds = process === 'coning'
      ? (hasConeTypeIds ? cleanStringList(req.body?.coneTypeIds) : [cleanString(req.body?.coneTypeId, 40)])
      : [null];
    const coneTypeIds = process === 'coning' && rawConeTypeIds.length === 0 ? [null] : rawConeTypeIds;
    const batchSize = yarnIds.length * sides.length * coneTypeIds.length;
    if (batchSize > MAX_RATE_BATCH) {
      return res.status(400).json({ error: `A maximum of ${MAX_RATE_BATCH} rate combinations can be selected at once` });
    }

    const normalizedRates = [];
    for (const yarnId of yarnIds) {
      for (const side of sides) {
        for (const coneTypeId of coneTypeIds) {
          const { data, error } = normalizeRatePayload(process, { ...(req.body || {}), yarnId, side, coneTypeId });
          if (error) return res.status(400).json({ error });
          const refError = await validateRateReferences(data);
          if (refError) return res.status(400).json({ error: refError });
          normalizedRates.push(data);
        }
      }
    }

    let createdRows;
    try {
      createdRows = await withAdvisoryLock(`contractor_rate:${contractorId}:${process}`, async (tx) => {
        // Check the complete batch before creating any rows so a conflict never
        // leaves a partial multi-yarn rate configuration behind.
        for (const data of normalizedRates) {
          if (await assertNoRateOverlap(tx, contractorId, process, data, null)) {
            throw overlapError('An equally-specific current rate already covers this quality.');
          }
        }
        const rows = [];
        for (const data of normalizedRates) {
          rows.push(await tx.contractorRate.create({ data: { contractorId, ...data, ...actorCreateFields(req.user?.id) } }));
        }
        return rows;
      });
    } catch (e) {
      if (e?.statusCode === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
    for (const created of createdRows) {
      await audit(req, { entityType: 'contractor_rate', entityId: created.id, action: 'create', payload: created });
    }
    res.json(createdRows.length === 1 ? serializeRate(createdRows[0]) : createdRows.map(serializeRate));
  } catch (err) {
    console.error('Failed to create rate', err);
    res.status(500).json({ error: err.message || 'Failed to create rate' });
  }
});

router.put('/rates/:id', requireEditPermission(MASTERS), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.contractorRate.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Rate not found' });
    const process = parseProcess(req.body?.process ?? existing.process);
    if (!process) return res.status(400).json({ error: 'process must be cutter, holo, or coning' });
    const contractorId = cleanString(req.body?.contractorId, 40) || existing.contractorId;
    if (contractorId !== existing.contractorId) {
      const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
      if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
    }
    // Serialize ratePerKg to a number for the merge (existing holds a Decimal).
    const { data, error } = normalizeRatePayload(process, { ...serializeRate(existing), ...req.body });
    if (error) return res.status(400).json({ error });
    const refError = await validateRateReferences(data);
    if (refError) return res.status(400).json({ error: refError });
    let updated;
    try {
      updated = await withAdvisoryLocks([
        `contractor_rate:${existing.contractorId}:${existing.process}`,
        `contractor_rate:${contractorId}:${process}`,
      ], async (tx) => {
        if (await assertNoRateOverlap(tx, contractorId, process, data, id)) {
          throw overlapError('An equally-specific current rate already covers this quality.');
        }
        return tx.contractorRate.update({ where: { id }, data: { contractorId, ...data, ...actorUpdateFields(req.user?.id) } });
      });
    } catch (e) {
      if (e?.statusCode === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
    await audit(req, { entityType: 'contractor_rate', entityId: id, action: 'update', before: existing, after: updated });
    res.json(serializeRate(updated));
  } catch (err) {
    console.error('Failed to update rate', err);
    res.status(500).json({ error: err.message || 'Failed to update rate' });
  }
});

router.delete('/rates/:id', requireDeletePermission(MASTERS), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.contractorRate.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Rate not found' });
    // Same advisory lock as create/update/Mark Paid, so deleting a rate can't
    // race a settlement payment priced by it.
    await withAdvisoryLock(`contractor_rate:${existing.contractorId}:${existing.process}`, async (tx) => {
      await tx.contractorRate.deleteMany({ where: { id } });
    });
    await audit(req, { entityType: 'contractor_rate', entityId: id, action: 'delete', payload: existing });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete rate', err);
    res.status(500).json({ error: err.message || 'Failed to delete rate' });
  }
});

// ===========================================================================
// Payable preview
// ===========================================================================

function parsePreviewQuery(source) {
  const process = parseProcess(source.process);
  const requestedContractorId = cleanString(source.contractorId, 40);
  const date = cleanString(source.date, 10);
  const from = cleanString(source.from, 10);
  const to = cleanString(source.to, 10);
  if (!process) return { error: 'process must be cutter, holo, or coning' };
  if (date && (from || to)) return { error: 'Use either date or both from and to.' };
  if (date) {
    if (!isValidDateStr(date)) return { error: 'date must be YYYY-MM-DD' };
    return { process, from: date, to: date, requestedContractorId };
  }
  if (!from || !to) return { error: 'from and to must be YYYY-MM-DD' };
  if (!isValidDateStr(from) || !isValidDateStr(to)) return { error: 'from and to must be YYYY-MM-DD' };
  if (from > to) return { error: 'from must be on or before to' };
  return { process, from, to, requestedContractorId };
}

// Production rows carry process and date, not contractor identity. Resolve the
// current process owner once at the API boundary so preview and settlement
// creation always use the same contractor/rate-card namespace.
async function resolvePreviewContext(parsed, client = prisma) {
  const assignment = await client.contractorAssignment.findUnique({ where: { process: parsed.process } });
  if (!assignment) throw httpError(409, `No contractor is assigned to the ${parsed.process} process.`);
  if (parsed.requestedContractorId && parsed.requestedContractorId !== assignment.contractorId) {
    throw httpError(409, 'The selected contractor is not the current owner of this process.');
  }
  const contractor = await client.contractor.findUnique({ where: { id: assignment.contractorId } });
  if (!contractor) throw httpError(409, 'The current process contractor no longer exists.');
  return {
    process: parsed.process,
    date: parsed.from,
    from: parsed.from,
    to: parsed.to,
    contractorId: assignment.contractorId,
    contractor,
  };
}

router.get('/preview', requirePermission(PERM, PERM_READ), async (req, res) => {
  try {
    const parsed = parsePreviewQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const context = await resolvePreviewContext(parsed);
    // When re-previewing for an existing settlement (admin paid-edit "add rows"),
    // that settlement's own claimed rows remain available.
    const excludeSettlementId = cleanString(req.query.excludeSettlementId, 40);
    const preview = await computePayablePreview(prisma, { ...context, excludeSettlementId });
    res.json({ contractor: context.contractor, ...preview });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.extra || {}) });
    console.error('Failed to compute preview', err);
    res.status(500).json({ error: err.message || 'Failed to compute preview' });
  }
});

// ===========================================================================
// Settlements — history & detail
// ===========================================================================

const SETTLEMENT_INCLUDE = {
  contractor: true,
  lines: { orderBy: { date: 'asc' } },
  adjustments: { orderBy: { createdAt: 'asc' } },
  revisions: { orderBy: { revisionNumber: 'desc' } },
};

router.get('/settlements', requirePermission(PERM, PERM_READ), async (req, res) => {
  try {
    const where = {};
    const contractorId = cleanString(req.query.contractorId, 40);
    const process = parseProcess(req.query.process);
    const status = cleanString(req.query.status, 20);
    if (contractorId) where.contractorId = contractorId;
    if (process) where.process = process;
    if (status === 'draft' || status === 'paid') where.status = status;
    const rows = await prisma.contractorSettlement.findMany({
      where,
      include: { contractor: true, _count: { select: { lines: true, adjustments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const serialized = rows.map((r) => ({
      ...serializeSettlement(r),
      lineCount: r._count?.lines ?? 0,
      adjustmentCount: r._count?.adjustments ?? 0,
    }));
    res.json(await resolveUserFields(serialized, ['createdByUserId', 'updatedByUserId', 'paidByUserId']));
  } catch (err) {
    console.error('Failed to list settlements', err);
    res.status(500).json({ error: err.message || 'Failed to list settlements' });
  }
});

async function loadSettlementDetail(id) {
  const s = await prisma.contractorSettlement.findUnique({ where: { id }, include: SETTLEMENT_INCLUDE });
  return s;
}

router.get('/settlements/:id', requirePermission(PERM, PERM_READ), async (req, res) => {
  try {
    const s = await loadSettlementDetail(req.params.id);
    if (!s) return res.status(404).json({ error: 'Settlement not found' });
    const serialized = serializeSettlement(s);
    const [withUsers] = await resolveUserFields([serialized], ['createdByUserId', 'updatedByUserId', 'paidByUserId']);
    res.json(withUsers);
  } catch (err) {
    console.error('Failed to load settlement', err);
    res.status(500).json({ error: err.message || 'Failed to load settlement' });
  }
});

// ===========================================================================
// Draft creation & editing
// ===========================================================================

// Normalize an adjustments array from a request body.
function normalizeAdjustments(raw) {
  if (!Array.isArray(raw)) return { adjustments: [] };
  if (raw.length > MAX_ADJUSTMENTS) return { error: `Too many adjustments (max ${MAX_ADJUSTMENTS})` };
  const adjustments = [];
  for (const item of raw) {
    const type = String(item?.type || '').trim().toLowerCase();
    if (!ADJUSTMENT_TYPES.includes(type)) return { error: `Invalid adjustment type: ${item?.type}` };
    const amount = num(item?.amount);
    if (amount === null || amount <= 0 || amount > MAX_AMOUNT) return { error: 'Adjustment amount must be a positive number within range' };
    const reason = cleanString(item?.reason, 500);
    if (!reason) return { error: 'Adjustment reason is required' };
    adjustments.push({ type, amount: Math.abs(amount), reason });
  }
  return { adjustments };
}

// Build DB line-create rows from preview lines selected by sourceRowIds.
// Returns { lines } or { error, blockers } if any selected row is blocked/unavailable.
function selectPayableLines(preview, sourceRowIds) {
  const wanted = new Set(sourceRowIds);
  const byId = new Map(preview.lines.map((l) => [l.sourceRowId, l]));
  const blockerById = new Map(preview.blockers.map((b) => [b.sourceRowId, b]));
  const selectedLines = [];
  const problems = [];
  for (const id of wanted) {
    if (byId.has(id)) { selectedLines.push(byId.get(id)); continue; }
    if (blockerById.has(id)) { problems.push(blockerById.get(id)); continue; }
    problems.push({ sourceRowId: id, reason: 'unavailable', message: 'Row is no longer eligible (excluded or already claimed).' });
  }
  if (problems.length) return { error: 'Some selected rows cannot be paid', blockers: problems };
  return { lines: selectedLines };
}

router.post('/settlements', requirePermission(PERM, PERM_WRITE), async (req, res) => {
  try {
    const parsed = parsePreviewQuery(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const context = await resolvePreviewContext(parsed);

    const sourceRowIds = Array.isArray(req.body?.sourceRowIds)
      ? req.body.sourceRowIds.map((x) => cleanString(x, 40)).filter(Boolean)
      : [];
    const { adjustments, error: adjError } = normalizeAdjustments(req.body?.adjustments);
    if (adjError) return res.status(400).json({ error: adjError });
    if (!sourceRowIds.length && !adjustments.length) {
      return res.status(400).json({ error: 'Select at least one production row or add an adjustment' });
    }

    const notes = cleanString(req.body?.notes, 2000);

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        // Keep the process owner stable while the server recomputes and claims
        // this period report. Owner changes use the same logical lock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contractor_assignment:${context.process}`}))`;
        const currentOwner = await tx.contractorAssignment.findUnique({ where: { process: context.process } });
        if (!currentOwner || currentOwner.contractorId !== context.contractorId) {
          throw httpError(409, 'The process contractor changed. Refresh the production preview and try again.');
        }
        // Shared side of the settlement-lines lock BEFORE pricing: an
        // exclusive import cannot replace production between the preview read
        // and the line insert, so the snapshot below is priced against the
        // same production state it claims. Generous timeout — the preview may
        // scan a full production window.
        await lockSettlementLineCreation(tx);
        // Server recomputes rather than trusting client amounts.
        const preview = await computePayablePreview(tx, context);
        const selection = selectPayableLines(preview, sourceRowIds);
        if (selection.error) throw httpError(400, selection.error, { blockers: selection.blockers });
        const lines = selection.lines;
        const totals = recomputeSettlementTotals(lines, adjustments);
        const settlement = await tx.contractorSettlement.create({
          data: {
            contractorId: context.contractorId,
            process: context.process,
            periodFrom: context.from,
            periodTo: context.to,
            status: 'draft',
            notes,
            productionKg: totals.productionKg,
            productionAmount: totals.productionAmount,
            adjustmentsTotal: totals.adjustmentsTotal,
            finalPayable: totals.finalPayable,
            ...actorCreateFields(req.user?.id),
          },
        });
        if (lines.length) {
          await tx.contractorSettlementLine.createMany({
            data: lines.map((l) => ({ settlementId: settlement.id, ...l })),
          });
        }
        if (adjustments.length) {
          await tx.contractorSettlementAdjustment.createMany({
            data: adjustments.map((a) => ({ settlementId: settlement.id, ...a, ...actorCreateFields(req.user?.id) })),
          });
        }
        return settlement;
      }, { timeout: 20000, maxWait: 10000 });
    } catch (txErr) {
      if (txErr?.statusCode) return res.status(txErr.statusCode).json({ error: txErr.message, ...(txErr.extra || {}) });
      if (txErr?.code === 'P2002') {
        return res.status(409).json({ error: 'One or more rows were just claimed by another settlement. Refresh the preview.' });
      }
      throw txErr;
    }

    const detail = await loadSettlementDetail(created.id);
    await audit(req, { entityType: 'contractor_settlement', entityId: created.id, action: 'create', payload: serializeSettlement(detail) });
    res.json(serializeSettlement(detail));
  } catch (err) {
    console.error('Failed to create settlement', err);
    res.status(500).json({ error: err.message || 'Failed to create settlement' });
  }
});

// Edit a DRAFT: replace selected production rows and adjustments, recompute.
router.put('/settlements/:id', requirePermission(PERM, PERM_WRITE), async (req, res) => {
  try {
    const { id } = req.params;
    const sourceRowIds = Array.isArray(req.body?.sourceRowIds)
      ? req.body.sourceRowIds.map((x) => cleanString(x, 40)).filter(Boolean)
      : null;
    // Keep-if-undefined: omitting `adjustments` leaves existing adjustments intact.
    const hasAdjustments = req.body?.adjustments !== undefined;
    const { adjustments, error: adjError } = normalizeAdjustments(hasAdjustments ? req.body.adjustments : []);
    if (adjError) return res.status(400).json({ error: adjError });

    let before;
    try {
      before = await withSettlementLock(id, async (tx) => {
        // Shared side of the settlement-lines lock (line createMany below).
        await lockSettlementLineCreation(tx);
        const existing = await tx.contractorSettlement.findUnique({ where: { id }, include: SETTLEMENT_INCLUDE });
        if (!existing) throw httpError(404, 'Settlement not found');
        if (existing.status !== 'draft') throw httpError(409, 'Only draft settlements can be edited here (it is no longer a draft). Use paid-edit for paid settlements.');
        const snapshot = serializeSettlement(existing);
        const notes = req.body?.notes === undefined ? existing.notes : cleanString(req.body?.notes, 2000);

        // Recompute line selection if sourceRowIds provided; else keep existing lines.
        if (sourceRowIds) {
          const preview = await computePayablePreview(tx, {
            contractorId: existing.contractorId,
            process: existing.process,
            from: existing.periodFrom,
            to: existing.periodTo,
            excludeSettlementId: id,
          });
          const selection = selectPayableLines(preview, sourceRowIds);
          if (selection.error) throw httpError(400, selection.error, { blockers: selection.blockers });
          await tx.contractorSettlementLine.deleteMany({ where: { settlementId: id } });
          if (selection.lines.length) {
            await tx.contractorSettlementLine.createMany({ data: selection.lines.map((l) => ({ settlementId: id, ...l })) });
          }
        }
        if (hasAdjustments) {
          await tx.contractorSettlementAdjustment.deleteMany({ where: { settlementId: id } });
          if (adjustments.length) {
            await tx.contractorSettlementAdjustment.createMany({
              data: adjustments.map((a) => ({ settlementId: id, ...a, ...actorCreateFields(req.user?.id) })),
            });
          }
        }
        const [freshLines, freshAdjustments] = await Promise.all([
          tx.contractorSettlementLine.findMany({ where: { settlementId: id } }),
          tx.contractorSettlementAdjustment.findMany({ where: { settlementId: id } }),
        ]);
        const totals = recomputeSettlementTotals(freshLines, freshAdjustments.map((a) => ({ type: a.type, amount: Number(a.amount) })));
        await tx.contractorSettlement.update({
          where: { id },
          data: { notes, ...totals, ...actorUpdateFields(req.user?.id) },
        });
        return snapshot;
      });
    } catch (txErr) {
      if (txErr?.statusCode) return res.status(txErr.statusCode).json({ error: txErr.message, ...(txErr.extra || {}) });
      if (txErr?.code === 'P2002') {
        return res.status(409).json({ error: 'One or more rows were just claimed by another settlement. Refresh the preview.' });
      }
      throw txErr;
    }

    const detail = await loadSettlementDetail(id);
    await audit(req, { entityType: 'contractor_settlement', entityId: id, action: 'update', before, after: serializeSettlement(detail) });
    res.json(serializeSettlement(detail));
  } catch (err) {
    console.error('Failed to edit draft settlement', err);
    res.status(500).json({ error: err.message || 'Failed to edit draft settlement' });
  }
});

// Delete a DRAFT (frees its claimed rows via cascade). Paid cannot be deleted.
router.delete('/settlements/:id', requireDeletePermission(PERM), async (req, res) => {
  try {
    const { id } = req.params;
    // Under the same per-settlement lock as mark-paid, so a delete can't race a
    // mark-paid and destroy a settlement that just became paid. The conditional
    // deleteMany({status:'draft'}) is the final guard.
    let snapshot;
    try {
      snapshot = await withSettlementLock(id, async (tx) => {
        const existing = await tx.contractorSettlement.findUnique({ where: { id }, include: SETTLEMENT_INCLUDE });
        if (!existing) throw httpError(404, 'Settlement not found');
        if (existing.status !== 'draft') throw httpError(400, 'Paid settlements cannot be deleted');
        const del = await tx.contractorSettlement.deleteMany({ where: { id, status: 'draft' } });
        if (del.count !== 1) throw httpError(409, 'Settlement changed concurrently; reload and retry.');
        return serializeSettlement(existing);
      });
    } catch (e) {
      if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message, ...(e.extra || {}) });
      throw e;
    }
    await audit(req, { entityType: 'contractor_settlement', entityId: id, action: 'delete', payload: snapshot });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete settlement', err);
    res.status(500).json({ error: err.message || 'Failed to delete settlement' });
  }
});

// ===========================================================================
// Mark Paid
// ===========================================================================

// Re-resolve a settlement's production lines against CURRENT production and
// return the lines that no longer reconcile — the source row was edited,
// deleted, made ineligible (Side/quality/rate change), or its KG/
// rate/amount drifted from the snapshot. Empty array = snapshot still valid.
async function revalidateSettlementProduction(client, settlement) {
  const lines = settlement.lines || [];
  if (!lines.length) return [];
  const preview = await computePayablePreview(client, {
    contractorId: settlement.contractorId,
    process: settlement.process,
    from: settlement.periodFrom,
    to: settlement.periodTo,
    excludeSettlementId: settlement.id,
  });
  return diffSettlementProduction(lines, preview.lines);
}

router.post('/settlements/:id/mark-paid', requirePermission(PERM, PERM_WRITE), async (req, res) => {
  try {
    const { id } = req.params;
    // Validate payment metadata up front (cheap) before the transaction.
    const paymentDate = cleanString(req.body?.paymentDate, 10);
    const paymentMode = cleanString(req.body?.paymentMode, 20);
    if (!isValidDateStr(paymentDate)) return res.status(400).json({ error: 'paymentDate must be YYYY-MM-DD' });
    if (!paymentMode || !PAYMENT_MODES.includes(paymentMode)) {
      return res.status(400).json({ error: `paymentMode must be one of ${PAYMENT_MODES.join(', ')}` });
    }
    const paymentReference = cleanString(req.body?.paymentReference, 200);
    const paymentNotes = cleanString(req.body?.paymentNotes, 2000);

    // Load, revalidate against current production, and flip draft->paid all
    // inside ONE transaction, serialized per-settlement by an advisory lock so a
    // concurrent draft-edit/mark-paid can't slip changes in after revalidation.
    let beforeSnap;
    try {
      beforeSnap = await withSettlementLock(id, async (tx) => {
        const existing = await tx.contractorSettlement.findUnique({ where: { id }, include: { lines: true, adjustments: true } });
        if (!existing) throw httpError(404, 'Settlement not found');
        if (existing.status !== 'draft') throw httpError(409, 'Settlement is no longer a draft (already paid or changed). Reload.');
        if (!existing.lines.length && !existing.adjustments.length) throw httpError(400, 'Cannot mark an empty settlement as paid');

        // Lock every payment input BEFORE revalidating: the settlement
        // advisory lock only serializes settlement endpoints, so also take the
        // assignment/rate advisory locks and row locks on the claimed source
        // rows and their Items. An in-flight production/master edit commits
        // first (revalidation then sees it and 409s), and a later edit blocks
        // until this commit, then hits its own guard or lands post-payment.
        await lockSettlementInputs(tx, existing);
        const mismatches = await revalidateSettlementProduction(tx, existing);
        if (mismatches.length) {
          throw httpError(409, 'Underlying production changed since this draft was created. Refresh the preview and rebuild the draft before paying.', { mismatches });
        }

        // Conditional transition: only flips a row that is STILL a draft.
        const upd = await tx.contractorSettlement.updateMany({
          where: { id, status: 'draft' },
          data: {
            status: 'paid', paymentDate, paymentMode, paymentReference, paymentNotes,
            paidAt: new Date(), paidByUserId: req.user?.id || null, ...actorUpdateFields(req.user?.id),
          },
        });
        if (upd.count !== 1) throw httpError(409, 'Settlement changed concurrently; reload and retry.');
        return serializeSettlement(existing);
      });
    } catch (e) {
      if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message, ...(e.extra || {}) });
      throw e;
    }

    const detail = await loadSettlementDetail(id);
    await audit(req, { entityType: 'contractor_settlement', entityId: id, action: 'mark_paid', before: beforeSnap, after: serializeSettlement(detail) });
    res.json(serializeSettlement(detail));
  } catch (err) {
    console.error('Failed to mark settlement paid', err);
    res.status(500).json({ error: err.message || 'Failed to mark settlement paid' });
  }
});

// ===========================================================================
// Admin paid-edit (mandatory reason, immutable revision, delta)
// ===========================================================================

router.put('/settlements/:id/paid-edit', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await loadSettlementDetail(id);
    if (!existing) return res.status(404).json({ error: 'Settlement not found' });
    if (existing.status !== 'paid') return res.status(400).json({ error: 'Only paid settlements can be corrected here' });

    const reason = cleanString(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: 'A reason is required for paid corrections' });

    // Requested changes
    const removeLineIds = Array.isArray(req.body?.removeLineIds)
      ? req.body.removeLineIds.map((x) => cleanString(x, 40)).filter(Boolean)
      : [];
    // Rows already on this settlement can't be re-added; drop them so the admin
    // gets a coherent result rather than a unique-constraint 409.
    const existingSourceRowIds = new Set(existing.lines.map((l) => l.sourceRowId));
    const addSourceRowIds = Array.isArray(req.body?.addSourceRowIds)
      ? req.body.addSourceRowIds.map((x) => cleanString(x, 40)).filter(Boolean).filter((rid) => !existingSourceRowIds.has(rid))
      : [];
    const overrides = Array.isArray(req.body?.lineOverrides) ? req.body.lineOverrides : [];
    // Validate provided adjustments only; when omitted, existing adjustments are
    // kept (read fresh inside the lock so a concurrent edit isn't reverted).
    const hasAdjustments = req.body?.adjustments !== undefined;
    const { adjustments: providedAdjustments, error: adjError } = normalizeAdjustments(hasAdjustments ? req.body.adjustments : []);
    if (adjError) return res.status(400).json({ error: adjError });

    // Validate overrides reference existing lines.
    const existingLineIds = new Set(existing.lines.map((l) => l.id));
    const overrideMap = new Map();
    for (const ov of overrides) {
      const lineId = cleanString(ov?.lineId, 40);
      if (!lineId || !existingLineIds.has(lineId)) return res.status(400).json({ error: `Unknown line for override: ${ov?.lineId}` });
      const netKg = ov?.netKg === undefined ? null : num(ov.netKg);
      const ratePerKg = ov?.ratePerKg === undefined ? null : num(ov.ratePerKg);
      if (netKg !== null && (netKg <= 0 || netKg > MAX_KG)) return res.status(400).json({ error: 'Override netKg must be a positive number within range' });
      if (ratePerKg !== null && (ratePerKg <= 0 || ratePerKg > MAX_RATE)) return res.status(400).json({ error: 'Override ratePerKg must be a positive number within range' });
      overrideMap.set(lineId, { netKg, ratePerKg });
    }

    let result;
    try {
      result = await withSettlementLock(id, async (tx) => {
        // Re-check status AND capture the revision baseline under the lock, so
        // `before`/`previousTotal` reflect any concurrent edit that committed
        // before us (correct immutable-revision chain + delta).
        const fresh = await tx.contractorSettlement.findUnique({ where: { id }, include: { lines: true, adjustments: true } });
        if (!fresh || fresh.status !== 'paid') throw httpError(409, 'Settlement changed concurrently; reload and retry.');
        const before = settlementSnapshot(fresh);
        const previousTotal = num(fresh.finalPayable);

        // Same locking protocol as Mark Paid: hold the assignment/rate
        // advisory locks plus row locks on the settlement's current rows, the
        // rows being added, and their Items, so the corrected snapshot can't
        // drift against a concurrent production or master edit while this runs.
        await lockSettlementInputs(tx, fresh, addSourceRowIds);

        // Resolve added lines INSIDE the lock (with tx), symmetric with draft-edit,
        // so their KG/rate/amount snapshot reflects production at commit time.
        let addLines = [];
        if (addSourceRowIds.length) {
          const preview = await computePayablePreview(tx, {
            contractorId: fresh.contractorId,
            process: fresh.process,
            from: fresh.periodFrom,
            to: fresh.periodTo,
            excludeSettlementId: id,
          });
          const selection = selectPayableLines(preview, addSourceRowIds);
          if (selection.error) throw httpError(400, selection.error, { blockers: selection.blockers });
          addLines = selection.lines;
        }
        if (removeLineIds.length) {
          await tx.contractorSettlementLine.deleteMany({ where: { id: { in: removeLineIds }, settlementId: id } });
        }
        // Apply overrides (recompute amount = round(netKg × rate, 2)). Re-read
        // the line inside the lock so a partial override composes with the
        // line's current stored values, not a possibly-stale outside snapshot.
        for (const [lineId, ov] of overrideMap.entries()) {
          if (removeLineIds.includes(lineId)) continue;
          const line = await tx.contractorSettlementLine.findUnique({ where: { id: lineId } });
          if (!line || line.settlementId !== id) throw httpError(409, 'A line targeted by an override changed concurrently; reload and retry.');
          const newKg = ov.netKg !== null ? roundKg(ov.netKg) : num(line.netKg);
          // Round the override rate to the stored 4dp precision so the stored
          // rate and the computed amount stay mutually consistent.
          const newRate = ov.ratePerKg !== null ? roundTo(ov.ratePerKg, 4) : num(line.ratePerKg);
          await tx.contractorSettlementLine.update({
            where: { id: lineId },
            data: { netKg: newKg, ratePerKg: newRate, amount: computeAmount(newKg, newRate) },
          });
        }
        if (addLines.length) {
          await tx.contractorSettlementLine.createMany({ data: addLines.map((l) => ({ settlementId: id, ...l })) });
        }
        // Replace adjustments only when the caller sent them; otherwise keep the
        // existing (fresh) ones untouched — no revert of a concurrent change.
        if (hasAdjustments) {
          await tx.contractorSettlementAdjustment.deleteMany({ where: { settlementId: id } });
          if (providedAdjustments.length) {
            await tx.contractorSettlementAdjustment.createMany({
              data: providedAdjustments.map((a) => ({ settlementId: id, ...a, ...actorCreateFields(req.user?.id) })),
            });
          }
        }
        // Payment detail updates (optional).
        const paymentPatch = {};
        if (req.body?.paymentDate !== undefined) {
          const pd = cleanString(req.body.paymentDate, 10);
          if (pd && !isValidDateStr(pd)) throw Object.assign(new Error('paymentDate must be YYYY-MM-DD'), { statusCode: 400 });
          paymentPatch.paymentDate = pd;
        }
        if (req.body?.paymentMode !== undefined) {
          const pm = cleanString(req.body.paymentMode, 20);
          if (pm && !PAYMENT_MODES.includes(pm)) throw Object.assign(new Error('Invalid paymentMode'), { statusCode: 400 });
          paymentPatch.paymentMode = pm;
        }
        if (req.body?.paymentReference !== undefined) paymentPatch.paymentReference = cleanString(req.body.paymentReference, 200);
        if (req.body?.paymentNotes !== undefined) paymentPatch.paymentNotes = cleanString(req.body.paymentNotes, 2000);

        const [freshLines, freshAdjustments] = await Promise.all([
          tx.contractorSettlementLine.findMany({ where: { settlementId: id } }),
          tx.contractorSettlementAdjustment.findMany({ where: { settlementId: id } }),
        ]);
        const totals = recomputeSettlementTotals(freshLines, freshAdjustments.map((a) => ({ type: a.type, amount: Number(a.amount) })));
        await tx.contractorSettlement.update({
          where: { id },
          data: { ...totals, ...paymentPatch, ...actorUpdateFields(req.user?.id) },
        });

        const after = await tx.contractorSettlement.findUnique({
          where: { id },
          include: { lines: true, adjustments: true },
        });
        const newTotal = num(after.finalPayable);
        const delta = Math.round((newTotal - previousTotal) * 100) / 100;
        const lastRev = await tx.contractorSettlementRevision.findFirst({
          where: { settlementId: id }, orderBy: { revisionNumber: 'desc' },
        });
        const revisionNumber = (lastRev?.revisionNumber || 0) + 1;
        const actor = getActor(req);
        const revision = await tx.contractorSettlementRevision.create({
          data: {
            settlementId: id,
            revisionNumber,
            reason,
            beforeSnapshot: before,
            afterSnapshot: serializeSettlement(after),
            previousTotal,
            newTotal,
            delta,
            changedByUserId: actor?.userId || null,
            changedByUsername: actor?.username || null,
          },
        });
        return { revision, before };
      });
    } catch (txErr) {
      if (txErr?.code === 'P2002' || txErr?.code === 'P2025') {
        // P2002: an added row is already claimed / revision-number collision.
        // P2025: a line targeted by remove/override was changed concurrently.
        // All are transient conflicts — ask to retry.
        return res.status(409).json({ error: 'This settlement changed concurrently (a row claim, line, or revision collision). Reload and retry.' });
      }
      if (txErr?.statusCode) return res.status(txErr.statusCode).json({ error: txErr.message, ...(txErr.extra || {}) });
      throw txErr;
    }

    const { revision, before } = result;
    const detail = await loadSettlementDetail(id);
    await audit(req, {
      entityType: 'contractor_settlement',
      entityId: id,
      action: 'paid_edit',
      before,
      after: serializeSettlement(detail),
      payload: { reason, revisionNumber: revision.revisionNumber, previousTotal: num(revision.previousTotal), newTotal: num(revision.newTotal), delta: num(revision.delta) },
    });
    res.json({
      settlement: serializeSettlement(detail),
      revision: { ...revision, previousTotal: num(revision.previousTotal), newTotal: num(revision.newTotal), delta: num(revision.delta) },
      delta: num(revision.delta),
    });
  } catch (err) {
    console.error('Failed to edit paid settlement', err);
    res.status(500).json({ error: err.message || 'Failed to edit paid settlement' });
  }
});

// ===========================================================================
// Settlement PDF
// ===========================================================================

router.get('/settlements/:id/pdf', requirePermission(PERM, PERM_READ), async (req, res) => {
  try {
    const s = await loadSettlementDetail(req.params.id);
    if (!s) return res.status(404).json({ error: 'Settlement not found' });
    const serialized = serializeSettlement(s);
    const pdfBuffer = await generateContractorSettlementPdf(serialized);
    const filename = `contractor_settlement_${(s.contractor?.name || 'contractor').replace(/[^a-z0-9]+/gi, '_')}_${s.periodFrom}_${s.periodTo}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Failed to generate settlement PDF', err);
    res.status(500).json({ error: err.message || 'Failed to generate settlement PDF' });
  }
});

export default router;
