import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import { getIdempotencyKeyFromRequest } from '../services/inventory/idempotency.js';
import { stableErrorResponse } from '../services/packing/errors.js';
import { serialize } from '../services/packing/serialization.js';
import {
  applyReconciliationBatch,
  createReconciliationBatch,
  getPackingLaunchState,
  getReconciliationBatch,
  importOpeningBalances,
  listReconciliationBatches,
  previewReconciliationBatch,
  reverseReconciliationBatch,
} from '../services/packing/reconciliationService.js';
import { notifyPackingReconciliation } from '../utils/packingNotifications.js';

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

function mutation(result, key = null) {
  const value = result?.result !== undefined ? result.result : result;
  const body = key ? { [key]: serialize(value) } : (value && typeof value === 'object' ? serialize(value) : { value: serialize(value) });
  body.replay = result?.result !== undefined && result.replay === true;
  return body;
}

function idempotencyKey(req) {
  return getIdempotencyKeyFromRequest(req);
}

router.get('/api/reconciliation/batches', requirePackingPermission(READ), route(async (req, res) => {
  const result = await listReconciliationBatches({ status: req.query.status, kind: req.query.kind, cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(result));
}));

router.post('/api/reconciliation/batches', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await createReconciliationBatch({ payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  res.json(mutation(result, 'batch'));
}));

router.get('/api/reconciliation/batches/:id', requirePackingPermission(READ), route(async (req, res) => {
  const batch = await getReconciliationBatch(req.params.id);
  res.json({ batch: serialize(batch) });
}));

router.post('/api/reconciliation/batches/:id/preview', requirePackingPermission(READ), route(async (req, res) => {
  const result = await previewReconciliationBatch({ id: req.params.id, payload: req.body });
  res.json(serialize(result));
}));

router.post('/api/reconciliation/batches/:id/apply', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await applyReconciliationBatch({ id: req.params.id, payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  const body = mutation(result, 'batch');
  if (!body.replay) await notifyPackingReconciliation('applied', { batch: body.batch, createdByUserId: req.user?.id });
  res.json(body);
}));

router.post('/api/reconciliation/batches/:id/reverse', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await reverseReconciliationBatch({ id: req.params.id, payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  const body = mutation(result);
  if (!body.replay) await notifyPackingReconciliation('reversed', { batch: body.reversal, originalBatchId: body.original?.id || req.params.id, createdByUserId: req.user?.id });
  res.json(body);
}));

router.post('/api/reconciliation/batches/:id/import-opening-balances', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await importOpeningBalances({ id: req.params.id, payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  const body = mutation(result);
  if (!body.replay) await notifyPackingReconciliation('applied', { batch: body.batch, importedOpeningBalances: true, createdByUserId: req.user?.id });
  res.json(body);
}));

router.get('/api/packing-launch-state', requirePackingPermission(READ), route(async (req, res) => {
  const state = await getPackingLaunchState();
  res.json({ launchState: serialize(state) });
}));

export default router;
