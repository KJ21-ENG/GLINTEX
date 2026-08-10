import { isAbsolute } from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { Static } from 'typebox';

import { glintexDomainContract } from './domain-contract.js';
import type { pluginConfigSchema, readParameters } from './tool-schemas.js';

export type PluginConfig = Static<typeof pluginConfigSchema>;
export type ReadParameters = Static<typeof readParameters>;

export interface TrustedToolContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
}

function required(value: string | undefined, field: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required for this GLINTEX read.`);
  return normalized;
}

function validatedProcess(value: string | undefined, allowed: readonly string[]) {
  const process = required(value, 'process').toLowerCase();
  if (!allowed.includes(process)) {
    throw new Error(`process must be one of: ${allowed.join(', ')}.`);
  }
  return process;
}

function validateDateRange(dateFrom?: string, dateTo?: string) {
  if (!dateFrom || !dateTo) return;
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error('dateFrom must be on or before dateTo.');
  }
  if ((to - from) / 86_400_000 > 93) {
    throw new Error('Production date ranges are limited to 93 days per read.');
  }
}

function addQuery(url: URL, values: Record<string, string | number | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
}

export function buildReadRequest(baseUrl: string, params: ReadParameters) {
  const base = baseUrl.replace(/\/+$/, '');
  let url: URL;

  switch (params.resource) {
    case 'health':
      url = new URL(`${base}/api/health`);
      break;
    case 'reference':
      url = new URL(`${base}/api/bootstrap`);
      break;
    case 'issues': {
      const process = validatedProcess(params.process, ['cutter', 'holo', 'coning']);
      url = new URL(`${base}/api/v2/issue/${process}/tracking`);
      addQuery(url, {
        search: params.search,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        order: params.order,
        cursor: params.cursor,
        limit: params.limit ?? 25,
        page: params.page,
      });
      break;
    }
    case 'receives': {
      const process = validatedProcess(params.process, ['cutter', 'holo', 'coning']);
      url = new URL(`${base}/api/v2/receive/${process}/history`);
      addQuery(url, {
        search: params.search,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        order: params.order,
        cursor: params.cursor,
        limit: params.limit ?? 25,
        page: params.page,
      });
      break;
    }
    case 'on_machine': {
      const process = validatedProcess(params.process, ['cutter', 'holo', 'coning']);
      url = new URL(`${base}/api/v2/on-machine/${process}`);
      addQuery(url, {
        search: params.search,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        order: params.order,
        cursor: params.cursor,
        limit: params.limit ?? 25,
      });
      break;
    }
    case 'stock': {
      const process = validatedProcess(params.process, ['holo', 'coning']);
      url = new URL(`${base}/api/v2/stock/${process}/lots`);
      break;
    }
    case 'production': {
      validateDateRange(params.dateFrom, params.dateTo);
      const process = params.process
        ? validatedProcess(params.process, ['cutter', 'holo', 'coning'])
        : 'all';
      url = new URL(`${base}/api/reports/production`);
      addQuery(url, {
        process,
        view: params.view ?? 'machine',
        from: params.dateFrom,
        to: params.dateTo,
      });
      break;
    }
    case 'barcode_history': {
      const barcode = required(params.barcode, 'barcode');
      url = new URL(`${base}/api/reports/barcode-history/${encodeURIComponent(barcode)}`);
      break;
    }
    case 'contractor_settlements': {
      if (params.id) {
        url = new URL(`${base}/api/contractor-payments/settlements/${encodeURIComponent(params.id)}`);
      } else {
        url = new URL(`${base}/api/contractor-payments/settlements`);
        addQuery(url, {
          process: params.process,
          status: params.status,
          search: params.search,
          from: params.dateFrom,
          to: params.dateTo,
          page: params.page ?? 1,
          pageSize: params.limit ?? 25,
        });
      }
      break;
    }
    default:
      throw new Error('Unsupported GLINTEX resource.');
  }

  return url;
}

export function assertToolAuthorized(config: PluginConfig, context: TrustedToolContext) {
  if (context.agentId !== config.allowedAgentId) {
    throw new Error('GLINTEX tools are restricted to the dedicated companion.');
  }
  if (context.senderIsOwner !== true) {
    throw new Error('GLINTEX reads require the authenticated owner context.');
  }
}

async function readToken(config: PluginConfig) {
  if (!isAbsolute(config.apiTokenFile)) {
    throw new Error('GLINTEX API token path must be absolute.');
  }
  const path = await realpath(config.apiTokenFile);
  const details = await stat(path);
  if (!details.isFile()) throw new Error('GLINTEX API token path is not a file.');
  if ((details.mode & 0o077) !== 0) {
    throw new Error('GLINTEX API token file must be private (mode 0600).');
  }
  const token = (await readFile(path, 'utf8')).trim();
  if (token.length < 32) throw new Error('GLINTEX API token is missing or too short.');
  return token;
}

function validatedBaseUrl(config: PluginConfig) {
  const url = new URL(config.baseUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error('GLINTEX API must use HTTPS outside loopback.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('GLINTEX base URL cannot contain credentials, query, or fragment data.');
  }
  return url.toString().replace(/\/+$/, '');
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export async function parseResponse(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('GLINTEX response exceeded the configured size limit.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('GLINTEX response exceeded the configured size limit.');
  }
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 500) || 'Unexpected non-JSON response.' };
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        'GLINTEX backend rejected the agent credential (HTTP 401). The production read identity may be inactive or misconfigured.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GLINTEX backend denied this read scope (HTTP 403). The production read identity does not have access to this GLINTEX area.',
      );
    }
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `GLINTEX request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

export async function readGlintex(
  params: ReadParameters,
  config: PluginConfig,
  context: TrustedToolContext,
  signal?: AbortSignal,
) {
  assertToolAuthorized(config, context);
  const baseUrl = validatedBaseUrl(config);
  const token = await readToken(config);
  const url = buildReadRequest(baseUrl, params);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-glintex-agent-token': token,
      accept: 'application/json',
    },
    signal: requestSignal(signal, config.requestTimeoutMs ?? 20_000),
  });
  const data = await parseResponse(response, config.maxResponseBytes ?? 2_097_152);
  if (params.resource === 'reference') {
    return {
      ok: true,
      data,
      domainContract: glintexDomainContract,
      domainContractSource: 'glintex-readonly-plugin-v1',
    };
  }
  return { ok: true, resource: params.resource, data };
}
