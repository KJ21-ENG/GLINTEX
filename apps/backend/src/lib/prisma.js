import { PrismaClient } from '@prisma/client';
import { perfLog, isQueryLogEnabled, getSlowQueryThresholdMs } from './perfLog.js';

const queryLogEnabled = isQueryLogEnabled();

const prisma = queryLogEnabled
  ? new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    })
  : new PrismaClient();

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
