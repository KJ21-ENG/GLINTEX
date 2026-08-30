import fs from 'fs';
import path from 'path';

const ENABLED = String(process.env.PERF_LOG || '').trim() === '1';
const QUERY_LOG_ENABLED = ENABLED && String(process.env.PERF_LOG_QUERIES || '').trim() === '1';
const SLOW_QUERY_MS = Number(process.env.PERF_SLOW_QUERY_MS || 100);
const SLOW_REQUEST_MS = Number(process.env.PERF_SLOW_REQUEST_MS || 0);

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'perf.log');

let dirReady = false;
function ensureDir() {
  if (dirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch (err) {
    console.error('perfLog: failed to create log dir', err);
  }
}

export function isPerfLogEnabled() {
  return ENABLED;
}

export function isQueryLogEnabled() {
  return QUERY_LOG_ENABLED;
}

export function getSlowQueryThresholdMs() {
  return SLOW_QUERY_MS;
}

export function getSlowRequestThresholdMs() {
  return SLOW_REQUEST_MS;
}

export function perfLog(kind, fields = {}) {
  if (!ENABLED) return;
  ensureDir();
  const entry = { ts: new Date().toISOString(), kind, ...fields };
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('perfLog: write failed', err);
  });
}
