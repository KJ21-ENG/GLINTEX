import { randomUUID } from 'node:crypto';

import { perfLog, isPerfLogEnabled, getSlowRequestThresholdMs } from '../lib/perfLog.js';

// Any HTTP request slower than this surfaces a separate `slow_route` line in
// perf.log so future regressions are visible without re-running the full
// investigation. Tunable via env (PERF_SLOW_ROUTE_MS), defaults to 5 s.
const SLOW_ROUTE_MS = Number(process.env.PERF_SLOW_ROUTE_MS || 5000);

const MUTATION_ROUTES = [
  { method: 'POST', match: /^\/api\/issue_to_cutter_machine\/?$/, label: 'issue_to_cutter_machine.create' },
  { method: 'POST', match: /^\/api\/issue_to_holo_machine\/?$/, label: 'issue_to_holo_machine.create' },
  { method: 'POST', match: /^\/api\/issue_to_coning_machine\/?$/, label: 'issue_to_coning_machine.create' },
  { method: 'POST', match: /^\/api\/issue_to_cutter_machine\/[^/]+\/take_back$/, label: 'issue_to_cutter_machine.take_back' },
  { method: 'POST', match: /^\/api\/issue_to_holo_machine\/[^/]+\/take_back$/, label: 'issue_to_holo_machine.take_back' },
  { method: 'POST', match: /^\/api\/issue_to_coning_machine\/[^/]+\/take_back$/, label: 'issue_to_coning_machine.take_back' },
  { method: 'PUT', match: /^\/api\/issue_to_cutter_machine\/[^/]+$/, label: 'issue_to_cutter_machine.update' },
  { method: 'PUT', match: /^\/api\/issue_to_holo_machine\/[^/]+$/, label: 'issue_to_holo_machine.update' },
  { method: 'PUT', match: /^\/api\/issue_to_coning_machine\/[^/]+$/, label: 'issue_to_coning_machine.update' },
  { method: 'POST', match: /^\/api\/issue_take_backs\/[^/]+\/reverse$/, label: 'issue_take_back.reverse' },
  { method: 'POST', match: /^\/api\/receive_from_cutter_machine\/(bulk|manual|import|mark_wastage|revert_wastage)$/, label: 'receive_from_cutter_machine.mutate' },
  { method: 'PUT', match: /^\/api\/receive_from_cutter_machine\/challans\/[^/]+$/, label: 'receive_from_cutter_machine.update' },
  { method: 'DELETE', match: /^\/api\/receive_from_cutter_machine\/challans\/[^/]+$/, label: 'receive_from_cutter_machine.delete' },
  { method: 'POST', match: /^\/api\/receive_from_holo_machine\/(manual|revert_wastage_row)$/, label: 'receive_from_holo_machine.mutate' },
  { method: 'PUT', match: /^\/api\/receive_from_holo_machine\/rows\/[^/]+$/, label: 'receive_from_holo_machine.update' },
  { method: 'DELETE', match: /^\/api\/receive_from_holo_machine\/rows\/[^/]+$/, label: 'receive_from_holo_machine.delete' },
  { method: 'POST', match: /^\/api\/receive_from_coning_machine\/(manual|mark_wastage|revert_wastage)$/, label: 'receive_from_coning_machine.mutate' },
  { method: 'PUT', match: /^\/api\/receive_from_coning_machine\/rows\/[^/]+$/, label: 'receive_from_coning_machine.update' },
  { method: 'DELETE', match: /^\/api\/receive_from_coning_machine\/rows\/[^/]+$/, label: 'receive_from_coning_machine.delete' },
];

function classifyRoute(req) {
  const method = req.method;
  const url = (req.originalUrl || req.url || '').split('?')[0];
  for (const route of MUTATION_ROUTES) {
    if (route.method === method && route.match.test(url)) {
      return { label: route.label, classification: 'mutation', url };
    }
  }
  const fullFlag = String(req.query?.full || '').trim().toLowerCase();
  if (/^\/api\/module\/process\/(cutter|holo|coning)$/.test(url) && ['1', 'true', 'yes'].includes(fullFlag)) {
    return { label: 'legacy_process_full_snapshot', classification: 'legacy_full_snapshot', url };
  }
  if (/^\/api\/v2\/(issue|receive)\/(cutter|holo|coning)\/[^/]+\/action-detail$/.test(url)) {
    return { label: 'v2_action_detail', classification: 'action_detail', url };
  }
  if (/^\/api\/v2\/issue\/(cutter|holo|coning)\/source-row$/.test(url)) {
    return { label: 'v2_source_lookup', classification: 'source_lookup', url };
  }
  if (/^\/api\/v2\//.test(url)) {
    const classification = /\/export\.json$/.test(url)
      ? 'export'
      : (/\/summary$/.test(url) ? 'v2_summary' : 'v2_list');
    return { label: null, classification, url };
  }
  return { label: null, classification: 'other', url };
}

function summarizeIssuePayload(label, body) {
  if (!body || typeof body !== 'object') return {};
  if (label?.startsWith('issue_to_cutter_machine')) {
    const pieceLines = Array.isArray(body.pieceLines) ? body.pieceLines.length : 0;
    const pieceIds = Array.isArray(body.pieceIds) ? body.pieceIds.length : 0;
    return { lineCount: Math.max(pieceLines, pieceIds) };
  }
  if (label?.startsWith('issue_to_holo_machine')) {
    const crates = Array.isArray(body.crates) ? body.crates.length : 0;
    return { lineCount: crates };
  }
  if (label?.startsWith('issue_to_coning_machine')) {
    const crates = Array.isArray(body.crates) ? body.crates.length : 0;
    return { lineCount: crates };
  }
  return {};
}

function chunkSize(chunk, encoding) {
  if (chunk == null || typeof chunk === 'function') return 0;
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) return chunk.length;
  return Buffer.byteLength(String(chunk), typeof encoding === 'string' ? encoding : undefined);
}

export function perfLoggerMiddleware(req, res, next) {
  if (!isPerfLogEnabled()) return next();

  const startNs = process.hrtime.bigint();
  const { label, classification, url } = classifyRoute(req);
  const filterClassification = [
    req.query?.search ? 'search' : null,
    req.query?.filters ? 'column_filters' : null,
    (req.query?.dateFrom || req.query?.dateTo || req.query?.from || req.query?.to) ? 'date' : null,
    ['1', 'true', 'yes'].includes(String(req.query?.groupBy || '').toLowerCase()) ? 'grouped' : null,
  ].filter(Boolean).join('+') || 'none';
  const recursiveLineageUsed = /^\/api\/v2\/(?:stock\/coning|on-machine\/coning)/.test(url);
  const summary = label ? summarizeIssuePayload(label, req.body) : {};
  const incomingRequestId = String(req.get('x-request-id') || '').trim();
  const requestId = incomingRequestId && incomingRequestId.length <= 100 ? incomingRequestId : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  let streamedResponseBytes = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  res.write = (chunk, encoding, callback) => {
    streamedResponseBytes += chunkSize(chunk, encoding);
    return originalWrite(chunk, encoding, callback);
  };
  res.end = (chunk, encoding, callback) => {
    streamedResponseBytes += chunkSize(chunk, encoding);
    return originalEnd(chunk, encoding, callback);
  };

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    const rounded = Math.round(durationMs * 1000) / 1000;
    const threshold = getSlowRequestThresholdMs();
    const isInteresting = !!label || classification !== 'other';
    const isSlow = Number.isFinite(SLOW_ROUTE_MS) && SLOW_ROUTE_MS > 0 && durationMs >= SLOW_ROUTE_MS;
    const contentLength = Number(res.getHeader('content-length'));
    const responseBytes = Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : streamedResponseBytes;

    if (isInteresting || (threshold > 0 && durationMs >= threshold) || threshold === 0) {
      perfLog('http', {
        requestId,
        method: req.method,
        url,
        status: res.statusCode,
        durationMs: rounded,
        label: label || undefined,
        classification,
        filterClassification,
        recursiveLineageUsed,
        responseBytes,
        ...summary,
      });
    }

    if (isSlow) {
      perfLog('slow_route', {
        requestId,
        method: req.method,
        url,
        status: res.statusCode,
        durationMs: rounded,
        label: label || undefined,
        classification,
        filterClassification,
        recursiveLineageUsed,
        responseBytes,
      });
    }

    const alertReasons = [];
    if (classification === 'legacy_full_snapshot') alertReasons.push('ui_full_snapshot');
    if (!['export', 'legacy_full_snapshot'].includes(classification) && responseBytes > 1024 * 1024) alertReasons.push('routine_response_over_1mb');
    if (classification === 'mutation' && label?.startsWith('issue_to_') && durationMs > 5000) alertReasons.push('issue_post_over_5s');
    if (classification === 'v2_list' && durationMs > 5000) alertReasons.push('list_over_5s');
    if (classification === 'v2_summary' && durationMs > 10000) alertReasons.push('summary_over_10s');
    if (res.statusCode === 499 || res.statusCode >= 500) alertReasons.push('http_error');
    if (alertReasons.length > 0) {
      perfLog('performance_alert', {
        requestId,
        method: req.method,
        url,
        status: res.statusCode,
        durationMs: rounded,
        label: label || undefined,
        classification,
        filterClassification,
        recursiveLineageUsed,
        responseBytes,
        reasons: alertReasons,
      });
    }
  });

  next();
}
