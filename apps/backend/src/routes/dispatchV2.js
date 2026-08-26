import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import { getIdempotencyKeyFromRequest } from '../services/inventory/idempotency.js';
import { stableErrorResponse } from '../services/packing/errors.js';
import { serialize } from '../services/packing/serialization.js';
import {
  correctDispatchLine,
  createDispatchChallan,
  exportDispatchCsv,
  getDispatchChallan,
  getDispatchSourceSummary,
  listDispatchChallans,
  listDispatchSourceItems,
  lookupDispatchBarcode,
  returnDispatchLine,
  reverseDispatchEvent,
  voidDispatchChallan,
} from '../services/dispatch/dispatchService.js';
import { getDispatchDocument } from '../services/dispatch/documentService.js';

const router = Router();
const READ = ACCESS_LEVELS.READ;
const WRITE = ACCESS_LEVELS.WRITE;

router.use(requireAuth);

function requireDispatchPermission(level) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized', message: 'Authentication is required.', details: null });
    if (!req.user.isAdmin && Number(req.user.permissions?.dispatch || 0) < Number(level)) {
      return res.status(403).json({ error: 'forbidden', message: 'Dispatch permission is required for this operation.', details: { requiredLevel: level } });
    }
    return next();
  };
}

function actorUserId(req) {
  return req.user?.id || null;
}

function idempotencyKey(req) {
  return getIdempotencyKeyFromRequest(req);
}

function mutationBody(result, key = 'challan') {
  const replay = result?.replay === true;
  const value = result?.result !== undefined ? result.result : result;
  return { [key]: serialize(value), replay };
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

function writeCsvChunk(res, chunk) {
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      res.removeListener('error', onError);
      resolve();
    };
    const onError = (error) => {
      res.removeListener('drain', onDrain);
      reject(error);
    };
    res.once('drain', onDrain);
    res.once('error', onError);
  });
}

router.get('/api/v2/dispatch/sources/summary', requireDispatchPermission(READ), route(async (req, res) => {
  const summary = await getDispatchSourceSummary();
  res.json({ summary: serialize(summary) });
}));

router.get('/api/v2/dispatch/sources/:sourceType', requireDispatchPermission(READ), route(async (req, res) => {
  const result = await listDispatchSourceItems({
    sourceType: req.params.sourceType,
    search: req.query.search,
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.json(serialize(result));
}));

router.get('/api/v2/dispatch/barcode/:barcode', requireDispatchPermission(READ), route(async (req, res) => {
  const source = await lookupDispatchBarcode({ barcode: req.params.barcode });
  res.json(serialize(source));
}));

router.get('/api/v2/dispatch/challans', requireDispatchPermission(READ), route(async (req, res) => {
  const result = await listDispatchChallans({
    filters: {
      customerId: req.query.customerId,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      search: req.query.search,
      cursor: req.query.cursor,
      limit: req.query.limit,
      includeLegacy: req.query.includeLegacy,
    },
  });
  res.json(serialize(result));
}));

router.post('/api/v2/dispatch/challans', requireDispatchPermission(WRITE), route(async (req, res) => {
  const result = await createDispatchChallan({ payload: req.body, actorUserId: actorUserId(req), idempotencyKey: idempotencyKey(req) });
  res.json(mutationBody(result));
}));

router.get('/api/v2/dispatch/challans/:id', requireDispatchPermission(READ), route(async (req, res) => {
  const challan = await getDispatchChallan({ id: req.params.id });
  res.json({ challan: serialize(challan) });
}));

router.post('/api/v2/dispatch/challans/:id/void', requireDispatchPermission(WRITE), route(async (req, res) => {
  const result = await voidDispatchChallan({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: idempotencyKey(req) });
  res.json(mutationBody(result));
}));

router.post('/api/v2/dispatch/lines/:id/correct', requireDispatchPermission(WRITE), route(async (req, res) => {
  const result = await correctDispatchLine({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: idempotencyKey(req) });
  res.json(mutationBody(result));
}));

router.post('/api/v2/dispatch/lines/:id/return', requireDispatchPermission(WRITE), route(async (req, res) => {
  const result = await returnDispatchLine({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: idempotencyKey(req) });
  res.json(mutationBody(result));
}));

router.post('/api/v2/dispatch/events/:id/reverse', requireDispatchPermission(WRITE), route(async (req, res) => {
  const result = await reverseDispatchEvent({ id: req.params.id, payload: req.body, actorUserId: actorUserId(req), idempotencyKey: idempotencyKey(req) });
  res.json(mutationBody(result, 'result'));
}));

router.get('/api/v2/dispatch/challans/:id/pdf', requireDispatchPermission(READ), route(async (req, res) => {
  const document = await getDispatchDocument({ id: req.params.id });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(document.pdfBytes.length));
  res.setHeader('Content-Disposition', `inline; filename="${document.filename}"`);
  res.setHeader('X-Dispatch-Document-SHA256', document.sha256Hash || '');
  res.send(document.pdfBytes);
}));

router.get('/api/v2/dispatch/export', requireDispatchPermission(READ), async (req, res) => {
  try {
    const result = await exportDispatchCsv({
      filters: {
        customerId: req.query.customerId,
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        search: req.query.search,
      },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    for await (const chunk of result.chunks()) await writeCsvChunk(res, chunk);
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const response = stableErrorResponse(error);
    res.status(response.statusCode).json(response.body);
  }
});

export default router;
