import { createHash } from 'crypto';

import prisma from '../../lib/prisma.js';

function resultCount(body) {
  if (Array.isArray(body)) return body.length;
  if (Array.isArray(body?.items)) return body.items.length;
  if (Array.isArray(body?.rows)) return body.rows.length;
  if (body && typeof body === 'object') return 1;
  return 0;
}

function filtersHash(req) {
  const material = JSON.stringify({ path: req.path, query: req.query || {} });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export function auditAgentRead(resourceResolver) {
  return function agentReadAuditMiddleware(req, res, next) {
    const startedAt = Date.now();
    let count = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      count = resultCount(body);
      return originalJson(body);
    };
    res.on('finish', () => {
      if (!req.agent?.authenticated) return;
      const resource = typeof resourceResolver === 'function' ? resourceResolver(req) : resourceResolver;
      prisma.agentAccessLog.create({
        data: {
          agentId: req.agent.id,
          requesterId: req.agent.requesterId,
          channel: req.agent.channel,
          sessionKey: req.agent.sessionKey,
          resource: String(resource || 'unknown').slice(0, 120),
          source: 'glintex',
          filtersHash: filtersHash(req),
          resultCount: count,
          outcome: res.statusCode >= 200 && res.statusCode < 400 ? 'SUCCEEDED' : 'FAILED',
          durationMs: Math.max(0, Date.now() - startedAt),
          errorCode: res.statusCode >= 400 ? `http_${res.statusCode}` : null,
        },
      }).catch(error => console.error('Failed to persist agent read audit', error?.message || error));
    });
    return next();
  };
}

export function hashExternalReadFilters(value) {
  return createHash('sha256').update(JSON.stringify(value || {}), 'utf8').digest('hex');
}
