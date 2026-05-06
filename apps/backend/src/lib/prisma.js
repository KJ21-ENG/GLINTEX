import { PrismaClient } from '@prisma/client';
import { perfLog, isQueryLogEnabled, getSlowQueryThresholdMs } from './perfLog.js';

const STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000);

function applyStatementTimeout(rawUrl) {
  if (!rawUrl) return rawUrl;
  if (!Number.isFinite(STATEMENT_TIMEOUT_MS) || STATEMENT_TIMEOUT_MS <= 0) return rawUrl;
  if (/[?&]statement_timeout=/i.test(rawUrl)) return rawUrl;
  const sep = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${sep}statement_timeout=${STATEMENT_TIMEOUT_MS}`;
}

const datasourceUrl = applyStatementTimeout(process.env.DATABASE_URL);
const datasources = datasourceUrl ? { db: { url: datasourceUrl } } : undefined;

const queryLogEnabled = isQueryLogEnabled();

const prisma = new PrismaClient({
  ...(datasources ? { datasources } : {}),
  ...(queryLogEnabled ? { log: [{ emit: 'event', level: 'query' }] } : {}),
});

if (queryLogEnabled) {
  const threshold = getSlowQueryThresholdMs();
  prisma.$on('query', (e) => {
    const durationMs = Number(e.duration);
    if (!Number.isFinite(durationMs) || durationMs < threshold) return;
    const query = typeof e.query === 'string' ? e.query.slice(0, 500) : '';
    perfLog('slow_query', { durationMs, query });
  });
}

export default prisma;
