import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { Static } from 'typebox';

import { glintexOwnerDomainContract } from './domain-contract.js';
import type {
  executeActionParameters,
  prepareActionParameters,
  readParameters,
  verifyActionParameters,
} from './tool-schemas.js';

export interface PluginConfig {
  baseUrl: string;
  tallyBaseUrl: string;
  apiTokenFile: string;
  allowedAgentId: string;
  ownerTelegramId: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface TrustedToolContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
}

export type ReadParameters = Static<typeof readParameters>;
export type PrepareActionParameters = Static<typeof prepareActionParameters>;
export type ExecuteActionParameters = Static<typeof executeActionParameters>;
export type VerifyActionParameters = Static<typeof verifyActionParameters>;

interface RequestTarget {
  source: 'glintex' | 'tally';
  url: URL;
}

function rejectIrrelevantReadFields(params: ReadParameters, allowed: readonly (keyof ReadParameters)[]) {
  const allowedSet = new Set<keyof ReadParameters>(['resource', ...allowed]);
  const irrelevant = (Object.keys(params) as (keyof ReadParameters)[])
    .filter(key => params[key] !== undefined && !allowedSet.has(key));
  if (irrelevant.length > 0) {
    throw new Error(`Fields are not valid for resource=${params.resource}: ${irrelevant.join(', ')}.`);
  }
}

function required(value: unknown, field: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function validatedProcess(value: unknown, allowed: readonly string[]) {
  const process = required(value, 'process').toLowerCase();
  if (!allowed.includes(process)) throw new Error(`process must be one of: ${allowed.join(', ')}.`);
  return process;
}

function validateDateRange(dateFrom?: string, dateTo?: string) {
  if (!dateFrom || !dateTo) return;
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error('dateFrom must be on or before dateTo.');
  }
  if ((to - from) / 86_400_000 > 93) throw new Error('Date ranges are limited to 93 days.');
}

function validatedDateBasis(value: ReadParameters['dateBasis']) {
  if (value === undefined) return undefined;
  if (value !== 'business' && value !== 'record') throw new Error('dateBasis must be business or record.');
  return value;
}

function addQuery(url: URL, values: Record<string, string | number | undefined>) {
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });
}

function loopbackBase(raw: string, field: string) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`${field} must use an HTTP loopback URL.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} cannot contain credentials, query, or fragment data.`);
  }
  if (url.pathname !== '/') throw new Error(`${field} must not contain a path.`);
  return url.toString().replace(/\/+$/, '');
}

export function buildReadRequest(config: PluginConfig, params: ReadParameters): RequestTarget {
  const base = loopbackBase(config.baseUrl, 'baseUrl');
  const tally = loopbackBase(config.tallyBaseUrl, 'tallyBaseUrl');
  let url: URL;

  switch (params.resource) {
    case 'health':
      rejectIrrelevantReadFields(params, []);
      url = new URL(`${base}/api/agent/v1/health`);
      return { source: 'glintex', url };
    case 'reference':
      rejectIrrelevantReadFields(params, []);
      url = new URL(`${base}/api/agent/v1/reference`);
      return { source: 'glintex', url };
    case 'issues': {
      rejectIrrelevantReadFields(params, ['process', 'search', 'dateFrom', 'dateTo', 'dateBasis', 'order', 'cursor', 'page', 'limit']);
      const process = validatedProcess(params.process, ['cutter', 'holo', 'coning']);
      const dateBasis = validatedDateBasis(params.dateBasis);
      url = new URL(`${base}/api/agent/v1/app/issue/${process}/tracking`);
      addQuery(url, { dateBasis });
      break;
    }
    case 'receives': {
      rejectIrrelevantReadFields(params, ['process', 'search', 'dateFrom', 'dateTo', 'dateBasis', 'order', 'cursor', 'page', 'limit']);
      const process = validatedProcess(params.process, ['cutter', 'holo', 'coning']);
      const dateBasis = validatedDateBasis(params.dateBasis);
      url = new URL(`${base}/api/agent/v1/app/receive/${process}/history`);
      addQuery(url, { dateBasis });
      break;
    }
    case 'on_machine': {
      rejectIrrelevantReadFields(params, ['process', 'search', 'dateFrom', 'dateTo', 'order', 'cursor', 'page', 'limit']);
      const process = validatedProcess(params.process, ['cutter', 'holo', 'coning']);
      url = new URL(`${base}/api/agent/v1/app/on-machine/${process}`);
      break;
    }
    case 'stock': {
      rejectIrrelevantReadFields(params, ['process', 'search', 'dateFrom', 'dateTo', 'order', 'cursor', 'page', 'limit']);
      const process = validatedProcess(params.process, ['holo', 'coning']);
      url = new URL(`${base}/api/agent/v1/app/stock/${process}/lots`);
      break;
    }
    case 'production':
      rejectIrrelevantReadFields(params, ['process', 'dateFrom', 'dateTo']);
      validateDateRange(params.dateFrom, params.dateTo);
      url = new URL(`${base}/api/agent/v1/production`);
      addQuery(url, { process: params.process, dateFrom: params.dateFrom, dateTo: params.dateTo });
      return { source: 'glintex', url };
    case 'contractor_settlements':
      rejectIrrelevantReadFields(params, ['id', 'process', 'status', 'search', 'dateFrom', 'dateTo', 'page', 'limit']);
      url = new URL(`${base}/api/agent/v1/contractor-settlements`);
      addQuery(url, {
        id: params.id,
        process: params.process,
        status: params.status,
        search: params.search,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        page: params.page,
        limit: params.limit,
      });
      return { source: 'glintex', url };
    case 'owner_tasks':
      rejectIrrelevantReadFields(params, ['id', 'status', 'area', 'search', 'limit']);
      url = new URL(`${base}/api/agent/v1/owner-tasks`);
      addQuery(url, { id: params.id, status: params.status, area: params.area, search: params.search, limit: params.limit });
      return { source: 'glintex', url };
    case 'learning_candidates':
      rejectIrrelevantReadFields(params, ['id', 'status', 'category', 'limit']);
      url = new URL(`${base}/api/agent/v1/learning-candidates`);
      addQuery(url, { id: params.id, status: params.status, category: params.category, limit: params.limit });
      return { source: 'glintex', url };
    case 'operation_history':
      rejectIrrelevantReadFields(params, ['id', 'status', 'action', 'limit']);
      url = new URL(`${base}/api/agent/v1/operations`);
      addQuery(url, { id: params.id, status: params.status, action: params.action, limit: params.limit });
      return { source: 'glintex', url };
    case 'system_status':
      rejectIrrelevantReadFields(params, []);
      url = new URL(`${base}/api/agent/v1/system`);
      return { source: 'glintex', url };
    case 'finance_outstanding': {
      rejectIrrelevantReadFields(params, ['side', 'party', 'company', 'limit', 'offset']);
      const side = required(params.side, 'side').toLowerCase();
      if (!['debtor', 'creditor'].includes(side)) throw new Error('side must be debtor or creditor.');
      url = new URL(`${tally}/api/outstanding`);
      addQuery(url, {
        side,
        party: params.party,
        company: params.company,
        limit: params.limit ?? 25,
        offset: params.offset ?? 0,
      });
      return { source: 'tally', url };
    }
    case 'finance_runs':
      rejectIrrelevantReadFields(params, ['limit']);
      url = new URL(`${tally}/api/runs`);
      addQuery(url, { limit: params.limit ?? 20 });
      return { source: 'tally', url };
    default:
      throw new Error('Unsupported GLINTEX resource.');
  }

  addQuery(url, {
    search: params.search,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    order: params.order,
    cursor: params.cursor,
    page: params.page,
    limit: params.limit ?? 25,
  });
  return { source: 'glintex', url };
}

export function assertToolAuthorized(config: PluginConfig, context: TrustedToolContext) {
  if (context.agentId !== config.allowedAgentId) throw new Error('GLINTEX tools are restricted to the owner agent.');
  if (context.messageChannel !== 'telegram') throw new Error('GLINTEX tools require the owner Telegram direct chat.');
  if (context.senderIsOwner !== true || context.requesterSenderId !== config.ownerTelegramId) {
    throw new Error('GLINTEX tools require the authenticated owner context.');
  }
}

async function readToken(config: PluginConfig) {
  if (!isAbsolute(config.apiTokenFile)) throw new Error('GLINTEX API token path must be absolute.');
  const path = await realpath(config.apiTokenFile);
  const details = await stat(path);
  if (!details.isFile()) throw new Error('GLINTEX API token path is not a file.');
  if ((details.mode & 0o077) !== 0) throw new Error('GLINTEX API token file must be private (mode 0600).');
  if (typeof process.getuid === 'function' && details.uid !== process.getuid()) {
    throw new Error('GLINTEX API token file must be owned by the OpenClaw service user.');
  }
  const token = (await readFile(path, 'utf8')).trim();
  if (token.length < 32 || token.length > 512) throw new Error('GLINTEX API token is missing or invalid.');
  return token;
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export async function parseResponse(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('GLINTEX response exceeded the configured size limit.');
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GLINTEX response exceeded the configured size limit.');
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), totalBytes).toString('utf8');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 500) || 'Unexpected non-JSON response.' };
  }
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${response.status}`;
    const message = body && typeof body === 'object' && 'message' in body ? String(body.message) : error;
    throw new Error(`${message} (${error}, HTTP ${response.status}).`);
  }
  return body;
}

function agentHeaders(token: string, config: PluginConfig, context: TrustedToolContext) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'x-glintex-agent-id': config.allowedAgentId,
    'x-glintex-requester-id': context.requesterSenderId || '',
    'x-glintex-sender-is-owner': context.senderIsOwner === true ? 'true' : 'false',
    'x-glintex-channel': context.messageChannel || '',
    'x-glintex-session-key': context.sessionKey || '',
    'x-glintex-session-id': context.sessionId || '',
  };
}

async function glintexRequest(
  config: PluginConfig,
  context: TrustedToolContext,
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  assertToolAuthorized(config, context);
  const token = await readToken(config);
  const base = loopbackBase(config.baseUrl, 'baseUrl');
  const response = await fetch(new URL(path, `${base}/`), {
    ...init,
    headers: { ...agentHeaders(token, config, context), ...(init.headers || {}) },
    signal: requestSignal(signal, config.requestTimeoutMs ?? 20_000),
  });
  return parseResponse(response, config.maxResponseBytes ?? 2_097_152);
}

function externalFiltersHash(params: ReadParameters) {
  return createHash('sha256').update(JSON.stringify(params), 'utf8').digest('hex');
}

async function auditTallyRead(
  config: PluginConfig,
  context: TrustedToolContext,
  params: ReadParameters,
  outcome: 'SUCCEEDED' | 'FAILED',
  resultCount: number | null,
  durationMs: number,
  errorCode?: string,
  signal?: AbortSignal,
) {
  await glintexRequest(config, context, '/api/agent/v1/audit/read', {
    method: 'POST',
    body: JSON.stringify({
      resource: params.resource,
      source: 'tally',
      filtersHash: externalFiltersHash(params),
      outcome,
      resultCount,
      durationMs,
      errorCode,
    }),
  }, signal);
}

function countResult(data: unknown) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['items', 'rows', 'runs', 'data']) {
      if (Array.isArray(record[key])) return record[key].length;
    }
  }
  return data === null ? 0 : 1;
}

export async function readGlintex(
  params: ReadParameters,
  config: PluginConfig,
  context: TrustedToolContext,
  signal?: AbortSignal,
) {
  assertToolAuthorized(config, context);
  const target = buildReadRequest(config, params);
  const startedAt = Date.now();
  try {
    let data: unknown;
    if (target.source === 'glintex') {
      const token = await readToken(config);
      const response = await fetch(target.url, {
        method: 'GET',
        headers: agentHeaders(token, config, context),
        signal: requestSignal(signal, config.requestTimeoutMs ?? 20_000),
      });
      data = await parseResponse(response, config.maxResponseBytes ?? 2_097_152);
    } else {
      const response = await fetch(target.url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: requestSignal(signal, config.requestTimeoutMs ?? 20_000),
      });
      data = await parseResponse(response, config.maxResponseBytes ?? 2_097_152);
      await auditTallyRead(config, context, params, 'SUCCEEDED', countResult(data), Date.now() - startedAt, undefined, signal);
    }
    return {
      ok: true,
      resource: params.resource,
      source: target.source,
      data,
      ...(params.resource === 'reference' ? {
        domainContract: glintexOwnerDomainContract,
        domainContractSource: 'glintex-owner-operations-v1',
      } : {}),
    };
  } catch (error) {
    if (target.source === 'tally') {
      try {
        await auditTallyRead(
          config,
          context,
          params,
          'FAILED',
          null,
          Date.now() - startedAt,
          String((error as Error)?.message || 'finance_read_failed').slice(0, 120),
          signal,
        );
      } catch {
        throw new Error(`Finance read failed and its audit could not be persisted: ${String((error as Error)?.message || error)}`);
      }
    }
    throw error;
  }
}

export async function prepareGlintexAction(
  params: PrepareActionParameters,
  config: PluginConfig,
  context: TrustedToolContext,
  signal?: AbortSignal,
) {
  return glintexRequest(config, context, '/api/agent/v1/actions/prepare', {
    method: 'POST',
    body: JSON.stringify(params),
  }, signal);
}

export async function executeGlintexAction(
  params: ExecuteActionParameters,
  config: PluginConfig,
  context: TrustedToolContext,
  signal?: AbortSignal,
) {
  return glintexRequest(config, context, '/api/agent/v1/actions/execute', {
    method: 'POST',
    body: JSON.stringify(params),
  }, signal);
}

export async function verifyGlintexAction(
  params: VerifyActionParameters,
  config: PluginConfig,
  context: TrustedToolContext,
  signal?: AbortSignal,
) {
  return glintexRequest(
    config,
    context,
    `/api/agent/v1/actions/${encodeURIComponent(params.operationId)}/verify`,
    { method: 'GET' },
    signal,
  );
}
