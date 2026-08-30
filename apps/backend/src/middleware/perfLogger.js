import { perfLog, isPerfLogEnabled, getSlowRequestThresholdMs } from '../lib/perfLog.js';

// Any HTTP request slower than this surfaces a separate `slow_route` line in
// perf.log so future regressions are visible without re-running the full
// investigation. Tunable via env (PERF_SLOW_ROUTE_MS), defaults to 5 s.
const SLOW_ROUTE_MS = Number(process.env.PERF_SLOW_ROUTE_MS || 5000);

const ISSUE_SAVE_ROUTES = [
  { method: 'POST', match: /^\/api\/issue_to_cutter_machine\/?$/, label: 'issue_to_cutter_machine.create' },
  { method: 'POST', match: /^\/api\/issue_to_holo_machine\/?$/, label: 'issue_to_holo_machine.create' },
  { method: 'POST', match: /^\/api\/issue_to_coning_machine\/?$/, label: 'issue_to_coning_machine.create' },
  { method: 'POST', match: /^\/api\/issue_to_cutter_machine\/[^/]+\/take_back$/, label: 'issue_to_cutter_machine.take_back' },
  { method: 'POST', match: /^\/api\/issue_to_holo_machine\/[^/]+\/take_back$/, label: 'issue_to_holo_machine.take_back' },
  { method: 'POST', match: /^\/api\/issue_to_coning_machine\/[^/]+\/take_back$/, label: 'issue_to_coning_machine.take_back' },
  { method: 'PUT', match: /^\/api\/issue_to_cutter_machine\/[^/]+$/, label: 'issue_to_cutter_machine.update' },
  { method: 'PUT', match: /^\/api\/issue_to_holo_machine\/[^/]+$/, label: 'issue_to_holo_machine.update' },
  { method: 'PUT', match: /^\/api\/issue_to_coning_machine\/[^/]+$/, label: 'issue_to_coning_machine.update' },
];

function classifyRoute(req) {
  const method = req.method;
  const url = (req.originalUrl || req.url || '').split('?')[0];
  for (const route of ISSUE_SAVE_ROUTES) {
    if (route.method === method && route.match.test(url)) {
      return { label: route.label, url };
    }
  }
  return { label: null, url };
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

export function perfLoggerMiddleware(req, res, next) {
  if (!isPerfLogEnabled()) return next();

  const startNs = process.hrtime.bigint();
  const { label, url } = classifyRoute(req);
  const summary = label ? summarizeIssuePayload(label, req.body) : {};

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    const rounded = Math.round(durationMs * 1000) / 1000;
    const threshold = getSlowRequestThresholdMs();
    const isInteresting = !!label;
    const isSlow = Number.isFinite(SLOW_ROUTE_MS) && SLOW_ROUTE_MS > 0 && durationMs >= SLOW_ROUTE_MS;

    if (isInteresting || (threshold > 0 && durationMs >= threshold) || threshold === 0) {
      perfLog('http', {
        method: req.method,
        url,
        status: res.statusCode,
        durationMs: rounded,
        label: label || undefined,
        ...summary,
      });
    }

    if (isSlow) {
      perfLog('slow_route', {
        method: req.method,
        url,
        status: res.statusCode,
        durationMs: rounded,
        label: label || undefined,
      });
    }
  });

  next();
}
