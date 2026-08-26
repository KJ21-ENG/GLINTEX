import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import {
  activatePackingRecipe,
  createPackingColor,
  createPackingPackageType,
  createPackingRecipe,
  getPackingRecipe,
  listPackingColors,
  listPackingPackageTypes,
  listPackingRecipes,
  retirePackingRecipe,
  updatePackingColor,
  updatePackingPackageType,
  updatePackingRecipe,
} from '../services/packing/recipeService.js';
import {
  amendPackingBatchTarget,
  confirmPackingBatch,
  createPackingBatch,
  getPackingBatch,
  getPackingBatchHistory,
  listPackingBatches,
  reservePackingBatchSources,
  shortClosePackingBatch,
  startPackingBatch,
  updatePackingBatch,
  voidPackingBatch,
} from '../services/packing/batchService.js';
import {
  createPackingUnit,
  damagePackingUnit,
  getPackingUnit,
  getPackingUnitHistory,
  inspectPackingUnitReturn,
  releasePackingUnitQuality,
  replacePackingUnitBarcode,
  reprintPackingUnitLabel,
  returnPackingUnit,
  sealPackingUnit as sealUnit,
  writeOffPackingUnit,
} from '../services/packing/unitService.js';
import { createPackingRepackingBatch } from '../services/packing/repackingService.js';
import { stableErrorResponse } from '../services/packing/errors.js';
import { getIdempotencyKeyFromRequest } from '../services/inventory/idempotency.js';
import { serialize } from '../services/packing/serialization.js';
import { notifyPackingBatchCompleted, notifyPackingBatchShortClosed, notifyPackingBatchVariance, notifyPackingException } from '../utils/packingNotifications.js';

const router = Router();
const READ = ACCESS_LEVELS.READ;
const WRITE = ACCESS_LEVELS.WRITE;

router.use(requireAuth);

function requirePackingPermission(level) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized', message: 'Authentication is required.', details: null });
    if (!req.user.isAdmin && Number(req.user.permissions?.packing || 0) < Number(level)) {
      return res.status(403).json({ error: 'forbidden', message: 'Packing permission is required for this operation.', details: { requiredLevel: level } });
    }
    return next();
  };
}

function actorUserId(req) {
  return req.user?.id || null;
}

function mutationBody(result, key) {
  const outcome = result && Object.prototype.hasOwnProperty.call(result, 'result')
    ? { value: result.result, replay: result.replay === true }
    : { value: result, replay: false };
  if (key) return { [key]: serialize(outcome.value), replay: outcome.replay };
  if (outcome.value && typeof outcome.value === 'object' && !Array.isArray(outcome.value)) return { ...serialize(outcome.value), replay: outcome.replay };
  return { value: serialize(outcome.value), replay: outcome.replay };
}

function completedBatchVariance(batch, sealingEvidence = null) {
  const sealedEvents = Array.isArray(batch?.events)
    ? batch.events.filter((event) => event.type === 'UNIT_SEALED' && event.payload && typeof event.payload === 'object')
    : [];
  if (sealingEvidence && typeof sealingEvidence === 'object') sealedEvents.push({ id: sealingEvidence.sealedEventId || null, unitId: sealingEvidence.unitId || null, payload: sealingEvidence });
  const variances = sealedEvents
    .map((event) => ({
      eventId: event.id,
      unitId: event.unitId || null,
      variancePercent: Number(event.payload.variancePercent),
      warningVariancePercent: Number(event.payload.warningVariancePercent),
      approvalVariancePercent: Number(event.payload.approvalVariancePercent),
    }))
    .filter((event) => Number.isFinite(event.variancePercent));
  if (!variances.length) return null;
  const warningVariancePercent = Number(batch.recipe?.warningVariancePercent ?? batch.recipeSnapshot?.warningVariancePercent ?? variances[0].warningVariancePercent);
  const approvalVariancePercent = Number(batch.recipe?.approvalVariancePercent ?? batch.recipeSnapshot?.approvalVariancePercent ?? variances[0].approvalVariancePercent);
  const maxVariancePercent = Math.max(...variances.map((event) => event.variancePercent));
  return {
    batchId: batch.id,
    batchNo: batch.batchNo,
    warningVariancePercent,
    approvalVariancePercent,
    maxVariancePercent,
    exceptions: variances.filter((event) => event.variancePercent > warningVariancePercent + 0.000001),
  };
}

async function notifyBatchOutcome(req, body) {
  if (body.replay || !body.batch) return;
  const notifications = [];
  if (body.batch.status === 'COMPLETED') {
    notifications.push(notifyPackingBatchCompleted({ batch: body.batch, createdByUserId: actorUserId(req) }));
    const variance = completedBatchVariance(body.batch, body.sealingEvidence);
    if (variance) notifications.push(notifyPackingBatchVariance({ ...variance, batch: body.batch, createdByUserId: actorUserId(req) }));
  }
  if (body.unit?.status === 'QUALITY_HOLD') notifications.push(notifyPackingException('packing_quality_hold', {
    batchId: body.batch.id,
    unitId: body.unit.id,
    barcode: body.unit.barcode,
    createdByUserId: actorUserId(req),
    event: body.event || { id: body.unit.id, type: 'UNIT_QUALITY_HOLD', unitId: body.unit.id, batchId: body.batch.id, payload: { status: body.unit.status } },
  }));
  await Promise.all(notifications);
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const response = stableErrorResponse(error);
      res.status(response.statusCode).json(response.body);
    }
  };
}

function key(req) {
  return getIdempotencyKeyFromRequest(req);
}

router.get('/api/packing/colors', requirePackingPermission(READ), route(async (req, res) => {
  const colors = await listPackingColors({ includeInactive: req.query.includeInactive === 'true' });
  res.json({ colors: serialize(colors) });
}));

router.post('/api/packing/colors', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createPackingColor({ payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'color'));
}));

router.put('/api/packing/colors/:id', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await updatePackingColor({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'color'));
}));

router.get('/api/packing/package-types', requirePackingPermission(READ), route(async (req, res) => {
  const packageTypes = await listPackingPackageTypes({ includeInactive: req.query.includeInactive === 'true', kind: req.query.kind });
  res.json({ packageTypes: serialize(packageTypes) });
}));

router.post('/api/packing/package-types', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createPackingPackageType({ payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'packageType'));
}));

router.put('/api/packing/package-types/:id', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await updatePackingPackageType({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'packageType'));
}));

router.get('/api/packing/recipes', requirePackingPermission(READ), route(async (req, res) => {
  const result = await listPackingRecipes({ status: req.query.status, familyKey: req.query.familyKey, cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(result));
}));

router.post('/api/packing/recipes', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createPackingRecipe({ payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'recipe'));
}));

router.get('/api/packing/recipes/:id', requirePackingPermission(READ), route(async (req, res) => {
  const recipe = await getPackingRecipe(req.params.id);
  res.json({ recipe: serialize(recipe) });
}));

router.put('/api/packing/recipes/:id', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await updatePackingRecipe({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'recipe'));
}));

router.post('/api/packing/recipes/:id/activate', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await activatePackingRecipe({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'recipe'));
}));

router.post('/api/packing/recipes/:id/retire', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await retirePackingRecipe({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'recipe'));
}));

router.get('/api/packing/batches', requirePackingPermission(READ), route(async (req, res) => {
  const result = await listPackingBatches({ status: req.query.status, customerId: req.query.customerId, recipeId: req.query.recipeId, cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(result));
}));

router.post('/api/packing/batches', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createPackingBatch({ payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.get('/api/packing/batches/:id', requirePackingPermission(READ), route(async (req, res) => {
  const batch = await getPackingBatch(req.params.id);
  res.json({ batch: serialize(batch) });
}));

router.get('/api/packing/batches/:id/history', requirePackingPermission(READ), route(async (req, res) => {
  const history = await getPackingBatchHistory({ id: req.params.id, cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(history));
}));

router.put('/api/packing/batches/:id', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await updatePackingBatch({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.post('/api/packing/batches/:id/confirm', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await confirmPackingBatch({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.post('/api/packing/batches/:id/start', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await startPackingBatch({ id: req.params.id, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.post('/api/packing/batches/:id/amend-target', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await amendPackingBatchTarget({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.post('/api/packing/batches/:id/short-close', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await shortClosePackingBatch({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  const body = mutationBody(result, 'batch');
  const batch = body.batch;
  if (batch && !body.replay) await notifyPackingBatchShortClosed({ batch, reason: batch.shortCloseReason, createdByUserId: actorUserId(req) });
  res.json(body);
}));

router.post('/api/packing/batches/:id/void', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await voidPackingBatch({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.post('/api/packing/batches/:id/sources/reserve', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await reservePackingBatchSources({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result));
}));

router.post('/api/packing/batches/:id/units', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createPackingUnit({ batchId: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'unit'));
}));

router.post('/api/packing/units/:id/seal', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await sealUnit({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  const body = mutationBody(result);
  await notifyBatchOutcome(req, body);
  res.json(body);
}));

router.post('/api/packing/units/:id/reprint-label', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await reprintPackingUnitLabel({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  const body = mutationBody(result);
  await notifyBatchOutcome(req, body);
  res.json(body);
}));

router.post('/api/packing/units/:id/replace-barcode', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await replacePackingUnitBarcode({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result));
}));

router.post('/api/packing/units/:id/release-quality', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await releasePackingUnitQuality({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'unit'));
}));

router.post('/api/packing/units/:id/return', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await returnPackingUnit({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'unit'));
}));

router.post('/api/packing/units/:id/inspect-return', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await inspectPackingUnitReturn({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'unit'));
}));

router.post('/api/packing/units/:id/damage', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await damagePackingUnit({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  const body = mutationBody(result);
  if (!body.replay) await notifyPackingException('packing_damage', {
    unitId: body.unit?.id,
    barcode: body.unit?.barcode,
    createdByUserId: actorUserId(req),
    event: body.event || { id: body.unit?.id, type: 'UNIT_DAMAGED', unitId: body.unit?.id, reason: body.reason, payload: {} },
  });
  res.json(body);
}));

router.post('/api/packing/units/:id/write-off', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await writeOffPackingUnit({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  const body = mutationBody(result);
  if (!body.replay) await notifyPackingException('packing_write_off', {
    unitId: body.unit?.id,
    barcode: body.unit?.barcode,
    createdByUserId: actorUserId(req),
    event: body.event || { id: body.unit?.id, type: 'UNIT_WRITTEN_OFF', unitId: body.unit?.id, reason: body.reason, payload: {} },
  });
  res.json(body);
}));

router.post('/api/packing/repacking-batches', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createPackingRepackingBatch({ payload: req.body, actorUserId: actorUserId(req), idempotencyKey: key(req) });
  res.json(mutationBody(result, 'batch'));
}));

router.get('/api/packing/units/:id', requirePackingPermission(READ), route(async (req, res) => {
  const unit = await getPackingUnit(req.params.id);
  res.json({ unit: serialize(unit) });
}));

router.get('/api/packing/units/:id/history', requirePackingPermission(READ), route(async (req, res) => {
  const history = await getPackingUnitHistory({ id: req.params.id, cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(history));
}));

export default router;
