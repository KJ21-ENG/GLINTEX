import fs from 'fs';
import path from 'path';

const ENABLED = String(process.env.PERF_LOG || '').trim() === '1';
const QUERY_LOG_ENABLED = ENABLED && String(process.env.PERF_LOG_QUERIES || '').trim() === '1';
function finiteEnvNumber(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const SLOW_QUERY_MS = finiteEnvNumber('PERF_SLOW_QUERY_MS', 100, { min: 0 });
const SLOW_REQUEST_MS = finiteEnvNumber('PERF_SLOW_REQUEST_MS', 5000, { min: 0 });
const MAX_LOG_BYTES = finiteEnvNumber('PERF_LOG_MAX_BYTES', 50 * 1024 * 1024, { min: 1024 * 1024 });
const RETAINED_LOG_FILES = Math.trunc(finiteEnvNumber('PERF_LOG_RETAIN_FILES', 5, { min: 1, max: 20 }));

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'perf.log');

let dirReady = false;
let writeQueue = Promise.resolve();
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
  const line = JSON.stringify(entry) + '\n';
  writeQueue = writeQueue
    .then(async () => {
      let currentSize = 0;
      try { currentSize = (await fs.promises.stat(LOG_FILE)).size; } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
      if (currentSize + Buffer.byteLength(line) > MAX_LOG_BYTES) {
        await fs.promises.rm(`${LOG_FILE}.${RETAINED_LOG_FILES}`, { force: true });
        for (let index = RETAINED_LOG_FILES - 1; index >= 1; index -= 1) {
          try { await fs.promises.rename(`${LOG_FILE}.${index}`, `${LOG_FILE}.${index + 1}`); } catch (err) {
            if (err?.code !== 'ENOENT') throw err;
          }
        }
        try { await fs.promises.rename(LOG_FILE, `${LOG_FILE}.1`); } catch (err) {
          if (err?.code !== 'ENOENT') throw err;
        }
      }
      await fs.promises.appendFile(LOG_FILE, line);
    })
    .catch((err) => console.error('perfLog: write failed', err));
}
