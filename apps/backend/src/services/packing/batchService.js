import prisma from '../../lib/prisma.js';
import { runIdempotent } from '../inventory/idempotency.js';
import {
  assertConingAvailability,
  getConingAvailability,
  getConingSourceSnapshot,
  lockConingSources,
  lockPackedSources,
  lockPackingSourcesForConing,
  lockPackingSourcesForPackedUnits,
  EPSILON,
} from '../inventory/coningBalance.js';
import {
  ACTIVE_BATCH_STATUSES,
  BATCH_KINDS,
  BATCH_STATUSES,
  DELIVERY_MODES,
  PACKING_EVENT_TYPES,
  SOURCE_TYPES,
  UNIT_STATUSES,
} from './constants.js';
import {
  actorCreateFields,
  actorId,
  actorUpdateFields,
  assertBatchTransition,
  assertEnumValue,
  assertVersion,
  batchInclude,
  createPackedUnitEvent,
  lockRecord,
  packedUnitInclude,
  recipeInclude,
} from './common.js';
import {
  badRequest,
  conflict,
  notFound,
  optionalString,
  parseNonNegativeNumber,
  parsePositiveInt,
  requireNonEmptyString,
} from './errors.js';
import { effectiveRecipeSnapshot, getPackingRecipeSnapshot } from './recipeService.js';
import { allocatePackingBatchNo } from './sequence.js';
import { serialize } from './serialization.js';
import { transitionBatch, transitionUnit } from './transitionService.js';

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sumSources(sources) {
  return sources.reduce((total, source) => {
    const count = numberOrZero(source.reservedBaseCount) - numberOrZero(source.releasedBaseCount);
    const weight = numberOrZero(source.reservedNetWeightKg) - numberOrZero(source.releasedNetWeightKg);
    return {
      count: total.count + Math.max(0, count),
      weight: total.weight + Math.max(0, weight),
    };
  }, { count: 0, weight: 0 });
}

function sourceResidual(source) {
  return {
    count: Math.max(0, numberOrZero(source.reservedBaseCount) - numberOrZero(source.consumedBaseCount) - numberOrZero(source.releasedBaseCount)),
    weight: Math.max(0, numberOrZero(source.reservedNetWeightKg) - numberOrZero(source.consumedNetWeightKg) - numberOrZero(source.releasedNetWeightKg)),
  };
}

export function assertSourceReleaseWithinResidual(source, release, message = 'A reservation release cannot exceed the source residual after completed consumption.') {
  const residual = sourceResidual(source);
  if (release.releasedBaseCount > residual.count || release.releasedNetWeightKg > residual.weight + 0.001) {
    throw badRequest('source_release_exceeds_residual', message, { sourceId: source.sourceId, residual, release });
  }
  return residual;
}

const SEALED_HIERARCHY_UNIT_STATUSES = new Set([
  UNIT_STATUSES.QUALITY_HOLD,
  UNIT_STATUSES.AVAILABLE,
  UNIT_STATUSES.RESERVED,
  UNIT_STATUSES.DISPATCHED,
  UNIT_STATUSES.DAMAGED,
  UNIT_STATUSES.REPACKED,
  UNIT_STATUSES.SPLIT_CONSUMED,
]);

export function hasCompletePackingHierarchy(batch) {
  const recipe = effectiveRecipeSnapshot(batch?.recipeSnapshot) || batch?.recipe || {};
  const stockLevel = Number(recipe.stockUnitLevelIndex || batch?.recipe?.stockUnitLevelIndex || 1);
  const higherLevels = (Array.isArray(recipe.levels) ? recipe.levels : batch?.recipe?.levels || [])
    .filter((level) => Number(level?.levelIndex) > stockLevel);
  if (!higherLevels.length) return true;
  const units = Array.isArray(batch?.units) ? batch.units : [];
  return higherLevels.every((level) => {
    const levelUnits = units.filter((unit) => Number(unit.levelIndex) === Number(level.levelIndex));
    return levelUnits.length > 0 && levelUnits.every((unit) => SEALED_HIERARCHY_UNIT_STATUSES.has(unit.status));
  });
}

function validateRecipeOverride(override, reason) {
  if (override === undefined || override === null) return null;
  if (!override || typeof override !== 'object' || Array.isArray(override)) throw badRequest('invalid_recipe_override', 'recipeOverride must be a JSON object.');
  const normalizedReason = requireNonEmptyString(reason, 'targetAmendmentReason', 1000);
  return { override, reason: normalizedReason };
}

async function findBatch(tx, id, { include = false } = {}) {
  const batch = await tx.packingBatch.findUnique({
    where: { id: String(id) },
    ...(include ? { include: batchInclude } : {}),
  });
  if (!batch) throw notFound('batch_not_found', 'Packing batch not found.', { id });
  return batch;
}

async function findBatchForUpdate(tx, id, include = true) {
  await lockRecord(tx, 'PackingBatch', id, 'batch_not_found', 'Packing batch not found.');
  return findBatch(tx, id, { include });
}

async function findRecipeForBatch(tx, recipeId) {
  const recipe = await tx.packingRecipe.findUnique({ where: { id: String(recipeId) }, include: recipeInclude });
  if (!recipe) throw notFound('recipe_not_found', 'Packing recipe not found.', { id: recipeId });
  return recipe;
}

async function validateBatchCustomer(tx, recipe, customerId) {
  const requested = customerId ? String(customerId) : null;
  const effective = requested || recipe.customerId || null;
  if (!effective) return null;
  const customer = await tx.customer.findUnique({ where: { id: effective } });
  if (!customer) throw notFound('customer_not_found', 'Customer not found.', { customerId: effective });
  if (customer.isActive === false) throw badRequest('customer_inactive', 'Inactive customers cannot be used for new Packing operations.', { customerId: effective });
  if (recipe.customerId && recipe.customerId !== effective) {
    throw badRequest('recipe_customer_restricted', 'This recipe is restricted to a different Customer.', { recipeCustomerId: recipe.customerId, customerId: effective });
  }
  return effective;
}

function recipeSnapshotForBatch(snapshot, overrideData) {
  if (!overrideData) return snapshot;
  return {
    base: snapshot,
    override: overrideData.override,
    overrideReason: overrideData.reason,
  };
}

async function getFullBatch(tx, id) {
  return tx.packingBatch.findUnique({ where: { id: String(id) }, include: batchInclude });
}

async function getSourceRows(tx, batchId) {
  return tx.packingBatchSource.findMany({ where: { batchId: String(batchId) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

function normalizeSourceRequests(payload) {
  if (!Array.isArray(payload?.sources) || payload.sources.length === 0) throw badRequest('sources_required', 'At least one source reservation is required.');
  if (payload.sources.length > 100) throw badRequest('too_many_sources', 'A reservation request may contain at most 100 sources.');
  const normalized = payload.sources.map((source) => ({
    sourceType: assertEnumValue(source?.sourceType, SOURCE_TYPES, 'sourceType'),
    sourceId: requireNonEmptyString(source?.sourceId, 'sourceId', 100),
    sourceBarcode: optionalString(source?.sourceBarcode, 200),
    reservedBaseCount: parsePositiveInt(source?.reservedBaseCount, 'reservedBaseCount'),
    reservedNetWeightKg: parseNonNegativeNumber(source?.reservedNetWeightKg, 'reservedNetWeightKg', { allowZero: false }),
  }));
  const identities = new Set();
  for (const source of normalized) {
    const key = `${source.sourceType}:${source.sourceId}`;
    if (identities.has(key)) throw badRequest('duplicate_source', 'A source may appear only once in a reservation request.', { sourceId: source.sourceId });
    identities.add(key);
  }
  return normalized;
}

function assertBatchSourceTypes(batch, sources) {
  const allowed = batch.kind === 'INITIAL'
    ? ['CONING_RECEIVE']
    : (batch.kind === 'REPACKING' ? ['PACKED_UNIT'] : []);
  const invalid = sources.filter((source) => !allowed.includes(source.sourceType));
  if (invalid.length || batch.kind === 'OPENING') {
    throw badRequest('invalid_batch_source_type', 'This Packing batch kind cannot reserve the requested source type.', {
      batchKind: batch.kind,
      allowedSourceTypes: allowed,
      invalidSourceTypes: [...new Set(invalid.map((source) => source.sourceType))],
    });
  }
}

async function lockSourceRows(tx, sources) {
  const coningIds = sources.filter((source) => source.sourceType === 'CONING_RECEIVE').map((source) => source.sourceId);
  const packedIds = sources.filter((source) => source.sourceType === 'PACKED_UNIT').map((source) => source.sourceId);
  await lockConingSources(tx, coningIds);
  await lockPackedSources(tx, packedIds);
  await lockPackingSourcesForConing(tx, coningIds);
  await lockPackingSourcesForPackedUnits(tx, packedIds);
}

async function createSourceReservations(tx, batch, normalized, actorUserId, idempotencyKey) {
  if (!normalized.length) return { sources: await getSourceRows(tx, batch.id), createdSources: [] };
  assertBatchSourceTypes(batch, normalized);
  const currentSources = await getSourceRows(tx, batch.id);
  await lockSourceRows(tx, [...currentSources, ...normalized]);
  const currentByKey = new Map(currentSources.map((source) => [`${source.sourceType}:${source.sourceId}`, source]));
  const createdSources = [];
  for (const source of normalized) {
    const key = `${source.sourceType}:${source.sourceId}`;
    if (currentByKey.has(key)) throw conflict('source_already_reserved', 'This source is already reserved on the batch.', { sourceType: source.sourceType, sourceId: source.sourceId });
    if (source.sourceType === 'CONING_RECEIVE') {
      const balance = await getConingAvailability(tx, source.sourceId);
      if (balance.invariantBroken || source.reservedBaseCount > balance.available.count + EPSILON || source.reservedNetWeightKg > balance.available.weight + 0.001) {
        throw badRequest('insufficient_coning_balance', 'The requested reservation exceeds the authoritative Coning balance.', { sourceId: source.sourceId, available: balance.available, requested: source });
      }
      const row = await getConingSourceSnapshot(tx, source.sourceId);
      if (source.sourceBarcode && row.barcode && source.sourceBarcode !== row.barcode) throw badRequest('source_barcode_mismatch', 'The supplied source barcode does not match the authoritative Coning source.', { sourceId: source.sourceId, expected: row.barcode, received: source.sourceBarcode });
      const created = await tx.packingBatchSource.create({
        data: {
          batchId: batch.id,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceBarcode: source.sourceBarcode || row.barcode || null,
          sourceItemSnapshot: serialize({ id: row.issue?.itemId, name: row.issue?.item?.name }),
          sourceLotSnapshot: serialize({ lotNo: row.issue?.lotNo, issueId: row.issueId }),
          sourceRecipeSnapshot: serialize({ sourceStage: 'CONING_RECEIVE' }),
          sourceCustomerSnapshot: serialize({ customerId: batch.customerId }),
          reservedBaseCount: source.reservedBaseCount,
          reservedNetWeightKg: source.reservedNetWeightKg,
          ...actorCreateFields(actorUserId),
        },
      });
      createdSources.push(created);
    } else {
      const unit = await tx.packedUnit.findUnique({ where: { id: source.sourceId }, include: packedUnitInclude });
      if (!unit || !unit.isStockUnit) throw notFound('packed_unit_not_found', 'Packed Unit source not found.', { sourceId: source.sourceId });
      if (![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.RETURNED_PENDING_INSPECTION, UNIT_STATUSES.DAMAGED].includes(unit.status)) throw badRequest('packed_source_invalid', 'Packed Unit source is not eligible for reservation.', { sourceId: source.sourceId, status: unit.status });
      if (source.sourceBarcode && unit.barcode && source.sourceBarcode !== unit.barcode) throw badRequest('source_barcode_mismatch', 'The supplied source barcode does not match the authoritative Packed Unit.', { sourceId: source.sourceId, expected: unit.barcode, received: source.sourceBarcode });
      if (source.reservedBaseCount !== Number(unit.baseCount) || Math.abs(source.reservedNetWeightKg - Number(unit.netWeightKg)) > 0.001) throw badRequest('packed_source_must_be_whole', 'Packed Unit reservations must use the exact whole unit count and net weight.', { sourceId: source.sourceId, baseCount: unit.baseCount, netWeightKg: unit.netWeightKg });
      const otherReservations = await tx.packingBatchSource.findMany({
        where: { sourceType: 'PACKED_UNIT', sourceId: source.sourceId, batchId: { not: batch.id }, batch: { status: { in: ACTIVE_BATCH_STATUSES } } },
        select: { reservedBaseCount: true, reservedNetWeightKg: true, consumedBaseCount: true, consumedNetWeightKg: true, releasedBaseCount: true, releasedNetWeightKg: true },
      });
      if (otherReservations.some((reservation) => sourceResidual(reservation).count > 0 || sourceResidual(reservation).weight > EPSILON)) {
        throw conflict('packed_source_reserved', 'This Packed Unit is already reserved by another active Packing batch.', { sourceId: source.sourceId });
      }
      const created = await tx.packingBatchSource.create({
        data: {
          batchId: batch.id,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceBarcode: source.sourceBarcode || unit.barcode || null,
          sourceItemSnapshot: serialize({ id: unit.itemId, name: unit.item?.name }),
          sourceLotSnapshot: serialize({ batchId: unit.batchId, batchNo: unit.batch?.batchNo }),
          sourceRecipeSnapshot: serialize({ recipeId: unit.recipeId, familyKey: unit.recipe?.familyKey, version: unit.recipe?.version }),
          sourceCustomerSnapshot: serialize({ customerId: unit.customerId }),
          reservedBaseCount: source.reservedBaseCount,
          reservedNetWeightKg: source.reservedNetWeightKg,
          ...actorCreateFields(actorUserId),
        },
      });
      createdSources.push(created);
    }
    await createPackedUnitEvent(tx, { batchId: batch.id, type: PACKING_EVENT_TYPES.SOURCE_RESERVED, reason: null, payload: { sourceType: source.sourceType, sourceId: source.sourceId, reservedBaseCount: source.reservedBaseCount, reservedNetWeightKg: source.reservedNetWeightKg }, idempotencyKey: `${idempotencyKey}:source:${source.sourceType}:${source.sourceId}`, actorUserId });
  }
  return { sources: await getSourceRows(tx, batch.id), createdSources };
}

function normalizeReservationDelta(payload) {
  const raw = payload?.sourceDelta || payload?.reservationDelta;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw conflict('source_delta_required', 'Target changes for an active batch require an exact sourceDelta with additions and/or releases.');
  const rawAdditions = raw.additions ?? raw.add ?? raw.reservations ?? [];
  const rawReleases = raw.releases ?? raw.release ?? [];
  if (!Array.isArray(rawAdditions) || !Array.isArray(rawReleases)) throw badRequest('invalid_source_delta', 'sourceDelta additions and releases must be arrays.');
  const additions = rawAdditions.length ? normalizeSourceRequests({ sources: rawAdditions }) : [];
  const releases = rawReleases.map((source) => ({
    sourceType: assertEnumValue(source?.sourceType, SOURCE_TYPES, 'sourceType'),
    sourceId: requireNonEmptyString(source?.sourceId, 'sourceId', 100),
    releasedBaseCount: parsePositiveInt(source?.releasedBaseCount ?? source?.baseCount ?? source?.count, 'releasedBaseCount'),
    releasedNetWeightKg: parseNonNegativeNumber(source?.releasedNetWeightKg ?? source?.netWeightKg ?? source?.weightKg, 'releasedNetWeightKg', { allowZero: false }),
  }));
  if (!additions.length && !releases.length) throw conflict('source_delta_required', 'Target changes for an active batch require a non-empty exact sourceDelta.');
  const identities = new Set();
  for (const source of [...additions, ...releases]) {
    const key = `${source.sourceType}:${source.sourceId}`;
    if (identities.has(key)) throw badRequest('duplicate_source_delta', 'A source may appear only once across sourceDelta additions and releases.', { sourceType: source.sourceType, sourceId: source.sourceId });
    identities.add(key);
  }
  return { additions, releases };
}

function normalizeActiveSourceDelta(payload) {
  if (payload?.sourceDelta || payload?.reservationDelta) return normalizeReservationDelta(payload);
  if (Array.isArray(payload?.sources) || Array.isArray(payload?.additions) || Array.isArray(payload?.releases)) {
    return normalizeReservationDelta({ sourceDelta: { additions: payload?.additions || payload?.sources || [], releases: payload?.releases || [] } });
  }
  throw conflict('source_delta_required', 'Active source changes require additions and/or releases in one sourceDelta request.');
}

function preflightReleaseFromPayload(payload) {
  const raw = payload?.sourceDelta || payload?.reservationDelta;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawAdditions = raw.additions ?? raw.add ?? raw.reservations ?? [];
  const rawReleases = raw.releases ?? raw.release ?? [];
  if (!Array.isArray(rawAdditions) || rawAdditions.length || !Array.isArray(rawReleases) || rawReleases.length !== 1) return null;
  if (!String(payload?.reason || '').trim()) return null;
  const release = rawReleases[0];
  const sourceType = String(release?.sourceType || '').trim().toUpperCase();
  const sourceId = String(release?.sourceId || '').trim();
  const releasedBaseCount = Number(release?.releasedBaseCount ?? release?.baseCount ?? release?.count);
  const releasedNetWeightKg = Number(release?.releasedNetWeightKg ?? release?.netWeightKg ?? release?.weightKg);
  if (!SOURCE_TYPES.includes(sourceType) || !sourceId || !Number.isInteger(releasedBaseCount) || releasedBaseCount <= 0 || !Number.isFinite(releasedNetWeightKg) || releasedNetWeightKg <= 0) return null;
  return { sourceType, sourceId, releasedBaseCount, releasedNetWeightKg };
}

export async function preflightPackingBatchSourceReservation({ batchId, payload, client = prisma } = {}) {
  const release = preflightReleaseFromPayload(payload);
  if (!release) return;
  const batch = await client.packingBatch.findUnique({
    where: { id: String(batchId) },
    select: { status: true, kind: true },
  });
  if (!batch || ![BATCH_STATUSES.CONFIRMED, BATCH_STATUSES.IN_PROGRESS].includes(batch.status)) return;
  const allowedSourceType = batch.kind === 'INITIAL'
    ? 'CONING_RECEIVE'
    : (batch.kind === 'REPACKING' ? 'PACKED_UNIT' : null);
  if (release.sourceType !== allowedSourceType) return;
  const source = await client.packingBatchSource.findFirst({
    where: { batchId: String(batchId), sourceType: release.sourceType, sourceId: release.sourceId },
    select: {
      sourceId: true,
      reservedBaseCount: true,
      reservedNetWeightKg: true,
      consumedBaseCount: true,
      consumedNetWeightKg: true,
      releasedBaseCount: true,
      releasedNetWeightKg: true,
    },
  });
  if (!source) return;
  assertSourceReleaseWithinResidual(source, release);
}

export async function preflightPackingBatchSourceMutation(req, options = {}) {
  const path = String(req?.path || req?.originalUrl || '').split('?')[0];
  const match = path.match(/^\/api\/packing\/batches\/([^/]+)\/sources\/reserve$/);
  if (!match) return;
  let batchId = match[1];
  try {
    batchId = decodeURIComponent(batchId);
  } catch {
    // Leave malformed route segments to the ordinary route validation.
  }
  return preflightPackingBatchSourceReservation({ batchId, payload: req?.body, ...options });
}

async function applyReservationDeltaForTarget(tx, batch, delta, target, actorUserId, idempotencyKey, reason) {
  const initialSources = await getSourceRows(tx, batch.id);
  assertBatchSourceTypes(batch, [...initialSources, ...delta.additions, ...delta.releases]);
  const initialByKey = new Map(initialSources.map((source) => [`${source.sourceType}:${source.sourceId}`, source]));
  for (const release of delta.releases) {
    const source = initialByKey.get(`${release.sourceType}:${release.sourceId}`);
    if (!source) throw conflict('source_release_not_found', 'Every reservation release must identify an existing source on this batch.', { sourceType: release.sourceType, sourceId: release.sourceId });
    assertSourceReleaseWithinResidual(source, release);
  }
  await lockSourceRows(tx, [...initialSources, ...delta.additions]);
  const lockedSources = await getSourceRows(tx, batch.id);
  const lockedByKey = new Map(lockedSources.map((source) => [`${source.sourceType}:${source.sourceId}`, source]));
  for (const release of delta.releases) {
    const source = lockedByKey.get(`${release.sourceType}:${release.sourceId}`);
    assertSourceReleaseWithinResidual(source, release, 'A reservation release changed while the target mutation was being locked.');
    await tx.packingBatchSource.update({ where: { id: source.id }, data: { releasedBaseCount: { increment: release.releasedBaseCount }, releasedNetWeightKg: { increment: release.releasedNetWeightKg }, ...actorUpdateFields(actorUserId) } });
    await createPackedUnitEvent(tx, { batchId: batch.id, type: PACKING_EVENT_TYPES.SOURCE_RELEASED, reason, payload: { sourceType: source.sourceType, sourceId: source.sourceId, released: { count: release.releasedBaseCount, weight: release.releasedNetWeightKg }, target: { plannedBaseCount: target.plannedBaseCount, plannedNetWeightKg: target.plannedNetWeightKg } }, idempotencyKey: `${idempotencyKey}:target-release:${source.id}`, actorUserId });
  }
  await createSourceReservations(tx, batch, delta.additions, actorUserId, idempotencyKey);
  const sources = await getSourceRows(tx, batch.id);
  const totals = sumSources(sources);
  if (totals.count !== target.plannedBaseCount || Math.abs(totals.weight - target.plannedNetWeightKg) > 0.001) throw badRequest('source_totals_mismatch', 'Target amendment would leave active reservations different from the exact amended target.', { reserved: totals, planned: target });
  return { sources, totals };
}

async function assertSourceReservationsStillAvailable(tx, batch, sources) {
  await lockSourceRows(tx, sources);
  for (const source of sources) {
    const residual = sourceResidual(source);
    if (source.sourceType === 'CONING_RECEIVE') {
      const balance = await getConingAvailability(tx, source.sourceId);
      if (balance.invariantBroken || balance.available.count + residual.count < -EPSILON || balance.available.weight + residual.weight < -0.001) {
        throw badRequest('source_reservation_invalidated', 'A Coning source reservation is no longer backed by authoritative availability.', { sourceId: source.sourceId, balance: balance.available, reserved: residual });
      }
    } else {
      const unit = await tx.packedUnit.findUnique({ where: { id: source.sourceId }, select: { id: true, status: true, isStockUnit: true, baseCount: true, netWeightKg: true } });
      if (!unit || !unit.isStockUnit) throw badRequest('packed_source_invalid', 'A Packed Unit source is no longer available for Packing.', { sourceId: source.sourceId });
      const repackingSourceAlreadyRetired = batch.kind === 'REPACKING' && unit.status === UNIT_STATUSES.REPACKED;
      if (!repackingSourceAlreadyRetired && ![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.RETURNED_PENDING_INSPECTION, UNIT_STATUSES.DAMAGED].includes(unit.status)) {
        throw badRequest('packed_source_invalid', 'A Packed Unit source is not eligible for this Packing batch.', { sourceId: source.sourceId, status: unit.status });
      }
      if (residual.count > Number(unit.baseCount) || residual.weight > Number(unit.netWeightKg) + 0.001) {
        throw badRequest('packed_source_invalid', 'A Packed Unit source reservation exceeds its exact content.', { sourceId: source.sourceId });
      }
    }
  }
}

async function releaseUnusedReservations(tx, batch, actorUserId, eventPrefix) {
  const sources = await getSourceRows(tx, batch.id);
  await lockSourceRows(tx, sources);
  for (const source of sources) {
    const residual = sourceResidual(source);
    if (residual.count <= 0 && residual.weight <= EPSILON) continue;
    await tx.packingBatchSource.update({
      where: { id: source.id },
      data: {
        releasedBaseCount: { increment: residual.count },
        releasedNetWeightKg: { increment: residual.weight },
        ...actorUpdateFields(actorUserId),
      },
    });
    await createPackedUnitEvent(tx, {
      batchId: batch.id,
      type: PACKING_EVENT_TYPES.SOURCE_RELEASED,
      reason: batch.shortCloseReason || batch.voidReason || null,
      payload: { sourceId: source.sourceId, sourceType: source.sourceType, released: residual },
      idempotencyKey: `${eventPrefix}:source-release:${source.id}`,
      actorUserId,
    });
  }
}

export async function createPackingBatch({ payload, actorUserId, idempotencyKey, client = prisma }) {
  const recipeId = requireNonEmptyString(payload?.recipeId, 'recipeId', 100);
  const kind = assertEnumValue(payload?.kind || 'INITIAL', BATCH_KINDS, 'kind');
  const deliveryMode = assertEnumValue(payload?.deliveryMode || 'UNSPECIFIED', DELIVERY_MODES, 'deliveryMode');
  const plannedBaseCount = parsePositiveInt(payload?.plannedBaseCount, 'plannedBaseCount');
  const plannedNetWeightKg = parseNonNegativeNumber(payload?.plannedNetWeightKg, 'plannedNetWeightKg');
  const override = validateRecipeOverride(payload?.recipeOverride, payload?.targetAmendmentReason);
  return runIdempotent({ operation: 'packing.batch.create', idempotencyKey, actorUserId, client, work: async (tx) => {
    const recipe = await findRecipeForBatch(tx, recipeId);
    const customerId = await validateBatchCustomer(tx, recipe, payload?.customerId || null);
    const recipeSnapshot = recipeSnapshotForBatch(serialize(recipe), override);
    const batchNo = await allocatePackingBatchNo(tx);
    const created = await tx.packingBatch.create({
      data: {
        batchNo,
        kind,
        status: BATCH_STATUSES.DRAFT,
        recipeId,
        recipeSnapshot,
        customerId,
        deliveryMode,
        plannedBaseCount,
        plannedNetWeightKg,
        notes: optionalString(payload?.notes, 2000),
        targetAmendmentReason: override?.reason || null,
        ...actorCreateFields(actorUserId),
      },
      include: batchInclude,
    });
    return serialize(created);
  } });
}

export async function listPackingBatches({ status, customerId, recipeId, cursor, limit = 50, client = prisma } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const where = {};
  if (status) where.status = assertEnumValue(status, Object.values(BATCH_STATUSES), 'status');
  if (customerId) where.customerId = String(customerId);
  if (recipeId) where.recipeId = String(recipeId);
  const rows = await client.packingBatch.findMany({
    where,
    take: take + 1,
    ...(cursor ? { skip: 1, cursor: { id: String(cursor) } } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      recipe: { select: { id: true, familyKey: true, version: true, status: true, deliveryMode: true, stockUnitLevelIndex: true } },
      customer: true,
      _count: { select: { units: true, sources: true, events: true } },
    },
  });
  const hasMore = rows.length > take;
  const batches = hasMore ? rows.slice(0, take) : rows;
  return { batches, nextCursor: hasMore ? batches[batches.length - 1].id : null };
}

export async function getPackingBatch(id, client = prisma) {
  const batch = await client.packingBatch.findUnique({ where: { id: String(id) }, include: batchInclude });
  if (!batch) throw notFound('batch_not_found', 'Packing batch not found.', { id });
  return batch;
}

export async function getPackingBatchHistory({ id, cursor, limit = 50, client = prisma } = {}) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const batch = await client.packingBatch.findUnique({ where: { id: batchId }, select: { id: true } });
  if (!batch) throw notFound('batch_not_found', 'Packing batch not found.', { id: batchId });
  const where = { batchId };
  if (cursor) {
    const marker = await client.packedUnitEvent.findUnique({ where: { id: String(cursor) }, select: { id: true, batchId: true, createdAt: true } });
    if (!marker || marker.batchId !== batchId) throw badRequest('invalid_cursor', 'Packing batch history cursor is invalid.', { cursor });
    where.OR = [{ createdAt: { lt: marker.createdAt } }, { createdAt: marker.createdAt, id: { lt: marker.id } }];
  }
  const rows = await client.packedUnitEvent.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { unit: { select: { id: true, barcode: true, status: true, levelIndex: true } } },
  });
  const hasMore = rows.length > take;
  const events = hasMore ? rows.slice(0, take) : rows;
  return { events, nextCursor: hasMore ? events[events.length - 1].id : null };
}

export async function updatePackingBatch({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runIdempotent({ operation: 'packing.batch.update', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await findBatchForUpdate(tx, batchId, true);
    if ([BATCH_STATUSES.COMPLETED, BATCH_STATUSES.SHORT_CLOSED, BATCH_STATUSES.VOIDED].includes(existing.status)) {
      throw conflict('batch_immutable', 'A completed, short-closed, or voided batch cannot be amended.');
    }
    assertVersion(payload?.expectedVersion, existing.version);
    const status = existing.status;
    if (payload?.recipeId !== undefined && status !== BATCH_STATUSES.DRAFT && String(payload.recipeId) !== existing.recipeId) {
      throw conflict('recipe_locked', 'The recipe is immutable after batch confirmation.');
    }
    if (payload?.deliveryMode !== undefined && [BATCH_STATUSES.IN_PROGRESS, BATCH_STATUSES.PARTIALLY_COMPLETED].includes(status)) {
      throw conflict('delivery_mode_locked', 'Delivery mode is immutable after Packing starts.');
    }
    if (status !== BATCH_STATUSES.DRAFT
        && (payload?.plannedBaseCount !== undefined || payload?.plannedNetWeightKg !== undefined)) {
      throw conflict('target_amendment_required', 'CONFIRMED or started batch targets can change only through the audited amend-target operation with an exact source delta.');
    }
    const recipe = await findRecipeForBatch(tx, payload?.recipeId || existing.recipeId);
    const customerId = payload?.customerId !== undefined
      ? await validateBatchCustomer(tx, recipe, payload.customerId)
      : existing.customerId;
    const override = validateRecipeOverride(payload?.recipeOverride, payload?.targetAmendmentReason);
    const nextSnapshot = payload?.recipeId && String(payload.recipeId) !== existing.recipeId
      ? recipeSnapshotForBatch(serialize(recipe), override)
      : (override ? recipeSnapshotForBatch(effectiveRecipeSnapshot(existing.recipeSnapshot), override) : existing.recipeSnapshot);
    const data = {
      ...(payload?.recipeId !== undefined ? { recipeId: String(payload.recipeId) } : {}),
      ...(payload?.customerId !== undefined ? { customerId } : {}),
      ...(payload?.deliveryMode !== undefined ? { deliveryMode: assertEnumValue(payload.deliveryMode, DELIVERY_MODES, 'deliveryMode') } : {}),
      ...(payload?.plannedBaseCount !== undefined ? { plannedBaseCount: parsePositiveInt(payload.plannedBaseCount, 'plannedBaseCount') } : {}),
      ...(payload?.plannedNetWeightKg !== undefined ? { plannedNetWeightKg: parseNonNegativeNumber(payload.plannedNetWeightKg, 'plannedNetWeightKg') } : {}),
      ...(payload?.notes !== undefined ? { notes: optionalString(payload.notes, 2000) } : {}),
      ...(override ? { recipeSnapshot: nextSnapshot, targetAmendmentReason: override.reason } : {}),
      version: { increment: 1 },
      ...actorUpdateFields(actorUserId),
    };
    if (data.plannedBaseCount !== undefined) {
      const output = await tx.packedUnit.aggregate({ where: { batchId, isStockUnit: true, status: { notIn: [UNIT_STATUSES.IN_PROGRESS, UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.VOIDED] } }, _sum: { baseCount: true } });
      if (Number(data.plannedBaseCount) < Number(output._sum.baseCount || 0)) throw badRequest('target_below_output', 'The amended target cannot be below completed output.');
    }
    const updated = await tx.packingBatch.update({ where: { id: batchId }, data, include: batchInclude });
    await createPackedUnitEvent(tx, {
      batchId,
      type: PACKING_EVENT_TYPES.ADMINISTRATIVE_AMENDMENT,
      reason,
      payload: { before: { customerId: existing.customerId, deliveryMode: existing.deliveryMode, plannedBaseCount: existing.plannedBaseCount, plannedNetWeightKg: existing.plannedNetWeightKg, notes: existing.notes }, after: { customerId: updated.customerId, deliveryMode: updated.deliveryMode, plannedBaseCount: updated.plannedBaseCount, plannedNetWeightKg: updated.plannedNetWeightKg, notes: updated.notes } },
      idempotencyKey: `${idempotencyKey}:amendment`,
      actorUserId,
    });
    if (payload?.customerId !== undefined && payload.customerId !== existing.customerId && status !== BATCH_STATUSES.DRAFT) {
      const units = await tx.packedUnit.findMany({ where: { batchId, status: { in: [UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.QUALITY_HOLD] } }, select: { id: true, status: true, customerId: true } });
      for (const unit of units) {
        const nextStatus = unit.status === UNIT_STATUSES.QUALITY_HOLD
          ? UNIT_STATUSES.QUALITY_HOLD
          : (customerId ? UNIT_STATUSES.RESERVED : UNIT_STATUSES.AVAILABLE);
        if (unit.status !== nextStatus) transitionUnit(unit.status, nextStatus);
        await tx.packedUnit.update({ where: { id: unit.id }, data: { customerId, status: nextStatus, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
        await createPackedUnitEvent(tx, {
          batchId,
          unitId: unit.id,
          type: PACKING_EVENT_TYPES.UNIT_RESERVATION_REASSIGNED,
          reason,
          payload: { beforeCustomerId: unit.customerId, afterCustomerId: customerId },
          idempotencyKey: `${idempotencyKey}:customer:${unit.id}`,
          actorUserId,
        });
      }
    }
    return serialize(updated);
  } });
}

export async function confirmPackingBatch({ id, payload = {}, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.batch.confirm', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await findBatchForUpdate(tx, batchId, true);
    assertBatchTransition(existing.status, BATCH_STATUSES.CONFIRMED);
    if (existing.kind === 'OPENING') throw badRequest('opening_batch_import_only', 'OPENING batches are created only by the opening-balance importer.');
    const requestedSources = payload?.sources === undefined ? [] : normalizeSourceRequests(payload);
    assertBatchSourceTypes(existing, [...existing.sources, ...requestedSources]);
    const recipe = await findRecipeForBatch(tx, existing.recipeId);
    if (recipe.status !== 'ACTIVE') throw conflict('recipe_not_active', 'Only an ACTIVE recipe can confirm a Packing batch.');
    const customerId = await validateBatchCustomer(tx, recipe, existing.customerId);
    await createSourceReservations(tx, existing, requestedSources, actorUserId, idempotencyKey);
    const sources = await getSourceRows(tx, batchId);
    if (!sources.length) throw badRequest('sources_required', 'Confirming a Packing batch requires exact source reservations first.');
    const totals = sumSources(sources);
    if (totals.count !== Number(existing.plannedBaseCount) || Math.abs(totals.weight - Number(existing.plannedNetWeightKg)) > 0.001) throw badRequest('source_totals_mismatch', 'Source reservations must exactly match the batch target before confirmation.', { reserved: totals, planned: { count: existing.plannedBaseCount, weight: existing.plannedNetWeightKg } });
    await assertSourceReservationsStillAvailable(tx, existing, sources);
    const updated = await tx.packingBatch.update({ where: { id: batchId }, data: { status: transitionBatch(existing.status, BATCH_STATUSES.CONFIRMED), customerId, confirmedAt: new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId), recipeSnapshot: existing.recipeSnapshot }, include: batchInclude });
    await createPackedUnitEvent(tx, { batchId, type: PACKING_EVENT_TYPES.BATCH_CONFIRMED, payload: { status: { before: existing.status, after: updated.status } }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function reservePackingBatchSources({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.batch.sources.reserve', idempotencyKey, actorUserId, client, work: async (tx) => {
    const batch = await findBatchForUpdate(tx, batchId, true);
    if (![BATCH_STATUSES.CONFIRMED, BATCH_STATUSES.IN_PROGRESS].includes(batch.status)) throw conflict('batch_not_reservable', 'Sources can be added only to a CONFIRMED or IN_PROGRESS batch. DRAFT selections do not reserve stock; confirm the batch with exact sources instead.');
    const delta = normalizeActiveSourceDelta(payload);
    const recipe = await findRecipeForBatch(tx, batch.recipeId);
    if (recipe.status !== 'ACTIVE') throw conflict('recipe_not_active', 'Only an ACTIVE recipe can reserve sources for a Packing batch.');
    await validateBatchCustomer(tx, recipe, batch.customerId);
    const reason = delta.releases.length ? requireNonEmptyString(payload?.reason, 'reason', 1000) : (optionalString(payload?.reason, 1000) || 'Active source reservation delta');
    const reservationResult = await applyReservationDeltaForTarget(tx, batch, delta, { plannedBaseCount: Number(batch.plannedBaseCount), plannedNetWeightKg: Number(batch.plannedNetWeightKg) }, actorUserId, idempotencyKey, reason);
    await tx.packingBatch.update({ where: { id: batchId }, data: { version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
    const updated = await getFullBatch(tx, batchId);
    return serialize({ batch: updated, sources: reservationResult.sources, reservationTotals: reservationResult.totals, reservationDelta: delta });
  } });
}

async function assertExactSourceTotals(tx, batch) {
  const sources = await getSourceRows(tx, batch.id);
  assertBatchSourceTypes(batch, sources);
  const totals = sumSources(sources);
  if (totals.count !== Number(batch.plannedBaseCount) || Math.abs(totals.weight - Number(batch.plannedNetWeightKg)) > 0.001) {
    throw badRequest('source_totals_mismatch', 'Reserved source count and weight must exactly match the batch target before Packing starts.', { reserved: totals, planned: { count: batch.plannedBaseCount, weight: batch.plannedNetWeightKg } });
  }
  await assertSourceReservationsStillAvailable(tx, batch, sources);
  return sources;
}

export async function startPackingBatch({ id, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.batch.start', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await findBatchForUpdate(tx, batchId, true);
    assertBatchTransition(existing.status, BATCH_STATUSES.IN_PROGRESS);
    const recipe = await findRecipeForBatch(tx, existing.recipeId);
    if (recipe.status !== 'ACTIVE') throw conflict('recipe_not_active', 'Only an ACTIVE recipe can start a Packing batch.');
    await assertExactSourceTotals(tx, existing);
    const updated = await tx.packingBatch.update({ where: { id: batchId }, data: { status: transitionBatch(existing.status, BATCH_STATUSES.IN_PROGRESS), startedAt: new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: batchInclude });
    await createPackedUnitEvent(tx, { batchId, type: PACKING_EVENT_TYPES.BATCH_STARTED, payload: { status: { before: existing.status, after: updated.status } }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function amendPackingBatchTarget({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  const plannedBaseCount = parsePositiveInt(payload?.plannedBaseCount ?? payload?.baseCount, 'plannedBaseCount');
  const plannedNetWeightKg = parseNonNegativeNumber(payload?.plannedNetWeightKg ?? payload?.netWeightKg, 'plannedNetWeightKg');
  return runIdempotent({ operation: 'packing.batch.amend_target', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await findBatchForUpdate(tx, batchId, true);
    if (![BATCH_STATUSES.CONFIRMED, BATCH_STATUSES.IN_PROGRESS, BATCH_STATUSES.PARTIALLY_COMPLETED].includes(existing.status)) throw conflict('target_not_amendable', 'The batch target can be amended only after confirmation and before completion.');
    const sourceDelta = normalizeReservationDelta(payload);
    const output = await tx.packedUnit.aggregate({ where: { batchId, isStockUnit: true, status: { notIn: [UNIT_STATUSES.IN_PROGRESS, UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.VOIDED] } }, _sum: { baseCount: true, netWeightKg: true } });
    if (plannedBaseCount < Number(output._sum.baseCount || 0)) throw badRequest('target_below_output', 'The amended target cannot be below completed output.');
    if (plannedNetWeightKg < Number(output._sum.netWeightKg || 0) - 0.001) throw badRequest('target_below_output', 'The amended target weight cannot be below completed output weight.', { completedWeightKg: output._sum.netWeightKg, plannedNetWeightKg });
    const reservationResult = await applyReservationDeltaForTarget(tx, existing, sourceDelta, { plannedBaseCount, plannedNetWeightKg }, actorUserId, idempotencyKey, reason);
    const updated = await tx.packingBatch.update({ where: { id: batchId }, data: { plannedBaseCount, plannedNetWeightKg, targetAmendmentReason: reason, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: batchInclude });
    await createPackedUnitEvent(tx, { batchId, type: PACKING_EVENT_TYPES.BATCH_TARGET_AMENDED, reason, payload: { before: { plannedBaseCount: existing.plannedBaseCount, plannedNetWeightKg: existing.plannedNetWeightKg }, after: { plannedBaseCount, plannedNetWeightKg }, reservationDelta: sourceDelta, reservationTotals: reservationResult.totals }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function shortClosePackingBatch({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runIdempotent({ operation: 'packing.batch.short_close', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await findBatchForUpdate(tx, batchId, true);
    assertBatchTransition(existing.status, BATCH_STATUSES.SHORT_CLOSED);
    await releaseUnusedReservations(tx, { ...existing, shortCloseReason: reason }, actorUserId, idempotencyKey);
    const updated = await tx.packingBatch.update({ where: { id: batchId }, data: { status: transitionBatch(existing.status, BATCH_STATUSES.SHORT_CLOSED), shortCloseReason: reason, shortClosedAt: new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: batchInclude });
    await createPackedUnitEvent(tx, { batchId, type: PACKING_EVENT_TYPES.BATCH_SHORT_CLOSED, reason, payload: { status: { before: existing.status, after: updated.status } }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

export async function voidPackingBatch({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const batchId = requireNonEmptyString(id, 'id', 100);
  const reason = requireNonEmptyString(payload?.reason, 'reason', 1000);
  return runIdempotent({ operation: 'packing.batch.void', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await findBatchForUpdate(tx, batchId, true);
    if (![BATCH_STATUSES.DRAFT, BATCH_STATUSES.CONFIRMED, BATCH_STATUSES.IN_PROGRESS].includes(existing.status)) throw conflict('batch_not_voidable', 'Only a draft, confirmed, or not-yet-output batch can be voided.');
    const output = await tx.packedUnit.count({ where: { batchId, isStockUnit: true, status: { notIn: [UNIT_STATUSES.IN_PROGRESS, UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.VOIDED] } } });
    if (output > 0) throw conflict('batch_output_exists', 'A batch with completed output cannot be voided. Short-close it instead.');
    if (existing.status !== BATCH_STATUSES.DRAFT) await releaseUnusedReservations(tx, { ...existing, voidReason: reason }, actorUserId, idempotencyKey);
    const updated = await tx.packingBatch.update({ where: { id: batchId }, data: { status: transitionBatch(existing.status, BATCH_STATUSES.VOIDED), voidReason: reason, voidedAt: new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: batchInclude });
    await createPackedUnitEvent(tx, { batchId, type: PACKING_EVENT_TYPES.BATCH_VOIDED, reason, payload: { status: { before: existing.status, after: updated.status } }, idempotencyKey: `${idempotencyKey}:event`, actorUserId });
    return serialize(updated);
  } });
}

async function refreshBatchProgress(tx, batchId, actorUserId, eventPrefix) {
  const batch = await findBatchForUpdate(tx, batchId, true);
  const aggregate = await tx.packedUnit.aggregate({ where: { batchId, isStockUnit: true, status: { notIn: [UNIT_STATUSES.IN_PROGRESS, UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.VOIDED] } }, _sum: { baseCount: true, netWeightKg: true } });
  const outputCount = Number(aggregate._sum.baseCount || 0);
  const outputWeight = Number(aggregate._sum.netWeightKg || 0);
  if (outputCount <= 0 || [BATCH_STATUSES.COMPLETED, BATCH_STATUSES.SHORT_CLOSED, BATCH_STATUSES.VOIDED].includes(batch.status)) return batch;
  let current = batch;
  if (current.status === BATCH_STATUSES.IN_PROGRESS) {
    transitionBatch(current.status, BATCH_STATUSES.PARTIALLY_COMPLETED);
    current = await tx.packingBatch.update({ where: { id: batchId }, data: { status: BATCH_STATUSES.PARTIALLY_COMPLETED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: batchInclude });
  }
  if (outputCount >= Number(current.plannedBaseCount)
      && outputWeight >= Number(current.plannedNetWeightKg) - 0.001
      && current.status === BATCH_STATUSES.PARTIALLY_COMPLETED
      && hasCompletePackingHierarchy(current)) {
    transitionBatch(current.status, BATCH_STATUSES.COMPLETED);
    current = await tx.packingBatch.update({ where: { id: batchId }, data: { status: BATCH_STATUSES.COMPLETED, completedAt: new Date(), version: { increment: 1 }, ...actorUpdateFields(actorUserId) }, include: batchInclude });
    await createPackedUnitEvent(tx, { batchId, type: PACKING_EVENT_TYPES.BATCH_COMPLETED, payload: { outputBaseCount: outputCount, outputNetWeightKg: outputWeight, plannedBaseCount: current.plannedBaseCount, plannedNetWeightKg: current.plannedNetWeightKg }, idempotencyKey: `${eventPrefix}:batch-completed`, actorUserId });
  }
  return current;
}

export async function consumeReservedSources(tx, batch, { baseCount, netWeightKg, actorUserId, idempotencyKey }) {
  const requestedCount = parsePositiveInt(baseCount, 'baseCount');
  const requestedWeight = parseNonNegativeNumber(netWeightKg, 'netWeightKg', { allowZero: false });
  const sources = await getSourceRows(tx, batch.id);
  await lockSourceRows(tx, sources);
  let remainingCount = requestedCount;
  let remainingWeight = requestedWeight;
  const allocations = [];
  for (const source of sources) {
    if (remainingCount <= 0 && remainingWeight <= EPSILON) break;
    const residual = sourceResidual(source);
    if (residual.count <= 0 && residual.weight <= EPSILON) continue;
    const allocatedCount = Math.min(remainingCount, residual.count);
    const allocatedWeight = Math.min(remainingWeight, residual.weight);
    if (source.sourceType === 'CONING_RECEIVE') {
      const balance = await getConingAvailability(tx, source.sourceId);
      if (balance.invariantBroken || balance.available.count + residual.count < allocatedCount - EPSILON || balance.available.weight + residual.weight < allocatedWeight - 0.001) {
        throw badRequest('source_reservation_invalidated', 'A Coning source is no longer available for the reserved Packing output.', { sourceId: source.sourceId, available: balance.available, residual });
      }
    } else {
      const unit = await tx.packedUnit.findUnique({ where: { id: source.sourceId }, select: { id: true, status: true, isStockUnit: true, baseCount: true, netWeightKg: true } });
      if (!unit || !unit.isStockUnit) throw badRequest('packed_source_invalid', 'A Packed Unit source is no longer available.', { sourceId: source.sourceId });
      const repackingSourceAlreadyRetired = batch.kind === 'REPACKING' && unit.status === UNIT_STATUSES.REPACKED;
      if (!repackingSourceAlreadyRetired && ![UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.RETURNED_PENDING_INSPECTION, UNIT_STATUSES.DAMAGED].includes(unit.status)) throw badRequest('packed_source_invalid', 'A Packed Unit source is no longer eligible.', { sourceId: source.sourceId, status: unit.status });
    }
    await tx.packingBatchSource.update({ where: { id: source.id }, data: { consumedBaseCount: { increment: allocatedCount }, consumedNetWeightKg: { increment: allocatedWeight }, ...actorUpdateFields(actorUserId) } });
    allocations.push({ sourceId: source.sourceId, sourceType: source.sourceType, count: allocatedCount, weight: allocatedWeight });
    remainingCount -= allocatedCount;
    remainingWeight -= allocatedWeight;
    await createPackedUnitEvent(tx, { batchId: batch.id, type: PACKING_EVENT_TYPES.SOURCE_CONSUMED, payload: { sourceId: source.sourceId, sourceType: source.sourceType, count: allocatedCount, weight: allocatedWeight }, idempotencyKey: `${idempotencyKey}:source-consumed:${source.id}`, actorUserId });
    if (source.sourceType === 'PACKED_UNIT' && allocatedCount >= residual.count && allocatedWeight >= residual.weight - 0.001) {
      const unit = await tx.packedUnit.findUnique({ where: { id: source.sourceId } });
      if (unit && unit.status !== UNIT_STATUSES.REPACKED) {
        transitionUnit(unit.status, UNIT_STATUSES.REPACKED);
        await tx.packedUnit.update({ where: { id: unit.id }, data: { status: UNIT_STATUSES.REPACKED, version: { increment: 1 }, ...actorUpdateFields(actorUserId) } });
        await createPackedUnitEvent(tx, { batchId: batch.id, unitId: unit.id, type: PACKING_EVENT_TYPES.UNIT_REPACKED, reason: batch.notes || 'Consumed by a Repacking batch.', payload: { sourceBatchId: unit.batchId, repackingBatchId: batch.id }, idempotencyKey: `${idempotencyKey}:unit-repacked:${unit.id}`, actorUserId });
      }
    }
  }
  if (remainingCount > 0 || remainingWeight > 0.001) throw badRequest('insufficient_reserved_sources', 'The batch does not have enough reserved source count and weight for this output.', { remainingCount, remainingWeight, allocations });
  return allocations;
}

export { findBatchForUpdate, findRecipeForBatch, getFullBatch, refreshBatchProgress, sourceResidual, effectiveRecipeSnapshot };
