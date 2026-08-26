import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import { getIdempotencyKeyFromRequest } from '../services/inventory/idempotency.js';
import { stableErrorResponse } from '../services/packing/errors.js';
import { serialize } from '../services/packing/serialization.js';
import { getPackedStockByBarcode, getPackedStockById, getPackedStockHistory, listPackedStock } from '../services/packing/packedStockService.js';
import { reassignPackedUnitReservation, releasePackedUnitReservation, reservePackedUnit } from '../services/packing/reservationService.js';

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

function mutation(result, key) {
  const value = result?.result !== undefined ? result.result : result;
  const replay = result?.result !== undefined && result.replay === true;
  return { [key]: serialize(value), replay };
}

function idempotencyKey(req) {
  return getIdempotencyKeyFromRequest(req);
}

router.get('/api/packed-stock', requirePackingPermission(READ), route(async (req, res) => {
  const result = await listPackedStock({ status: req.query.status, customerId: req.query.customerId, barcode: req.query.barcode, itemId: req.query.itemId, search: req.query.search, batchKind: req.query.batchKind, includeHierarchy: req.query.includeHierarchy === 'true', cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(result));
}));

router.get('/api/packed-stock/barcode/:barcode', requirePackingPermission(READ), route(async (req, res) => {
  const unit = await getPackedStockByBarcode(req.params.barcode);
  res.json({ unit: serialize(unit) });
}));

router.get('/api/packed-stock/:id', requirePackingPermission(READ), route(async (req, res) => {
  const unit = await getPackedStockById(req.params.id);
  res.json({ unit: serialize(unit) });
}));

router.get('/api/packed-stock/:id/history', requirePackingPermission(READ), route(async (req, res) => {
  const history = await getPackedStockHistory({ id: req.params.id, cursor: req.query.cursor, limit: req.query.limit });
  res.json(serialize(history));
}));

router.post('/api/packed-stock/:id/reserve', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await reservePackedUnit({ id: req.params.id, payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  res.json(mutation(result, 'unit'));
}));

router.post('/api/packed-stock/:id/release-reservation', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await releasePackedUnitReservation({ id: req.params.id, payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  res.json(mutation(result, 'unit'));
}));

router.post('/api/packed-stock/:id/reassign-reservation', requirePackingPermission(WRITE), route(async (req, res) => {
  const result = await reassignPackedUnitReservation({ id: req.params.id, payload: req.body, actorUserId: req.user?.id, idempotencyKey: idempotencyKey(req) });
  res.json(mutation(result, 'unit'));
}));

export default router;
