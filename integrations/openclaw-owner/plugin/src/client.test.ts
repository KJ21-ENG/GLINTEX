import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertToolAuthorized, buildReadRequest, parseResponse, type PluginConfig } from './client.js';

const config: PluginConfig = {
  baseUrl: 'http://127.0.0.1:4003',
  tallyBaseUrl: 'http://127.0.0.1:4500',
  apiTokenFile: '/tmp/glintex-owner-agent.token',
  allowedAgentId: 'glintex-owner',
  ownerTelegramId: '1234567890',
};

describe('fixed request registry', () => {
  it('maps app resources to the dedicated versioned API only', () => {
    const target = buildReadRequest(config, {
      resource: 'issues',
      process: 'holo',
      search: 'LOT-10',
      limit: 10,
    });
    expect(target.source).toBe('glintex');
    expect(target.url.origin).toBe('http://127.0.0.1:4003');
    expect(target.url.pathname).toBe('/api/agent/v1/app/issue/holo/tracking');
    expect(target.url.searchParams.get('search')).toBe('LOT-10');
  });

  it('maps finance resources only to the loopback Tally read API', () => {
    const target = buildReadRequest(config, {
      resource: 'finance_outstanding',
      side: 'debtor',
      party: 'Example',
      limit: 25,
    });
    expect(target.source).toBe('tally');
    expect(target.url.href).toContain('http://127.0.0.1:4500/api/outstanding');
    expect(target.url.searchParams.get('side')).toBe('debtor');
  });

  it('rejects non-loopback destinations and unsupported process values', () => {
    expect(() => buildReadRequest({ ...config, baseUrl: 'https://example.com' }, { resource: 'health' })).toThrow(/loopback/i);
    expect(() => buildReadRequest({ ...config, baseUrl: 'http://127.0.0.1:4003/hidden' }, { resource: 'health' })).toThrow(/must not contain a path/i);
    expect(() => buildReadRequest(config, { resource: 'stock', process: 'cutter' })).toThrow(/process must/i);
    expect(() => buildReadRequest(config, { resource: 'health', search: 'ignored' })).toThrow(/not valid for resource=health/i);
  });

  it('stops reading a streamed response at the configured byte cap', async () => {
    const response = new Response(JSON.stringify({ value: 'x'.repeat(2_000) }), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseResponse(response, 512)).rejects.toThrow(/size limit/i);
  });
});

describe('trusted tool context', () => {
  it('requires exact runtime owner identity and Telegram channel', () => {
    expect(() => assertToolAuthorized(config, {
      agentId: 'glintex-owner',
      requesterSenderId: '1234567890',
      senderIsOwner: true,
      messageChannel: 'telegram',
    })).not.toThrow();
    expect(() => assertToolAuthorized(config, {
      agentId: 'glintex-owner',
      requesterSenderId: '1234567890',
      senderIsOwner: false,
      messageChannel: 'telegram',
    })).toThrow(/owner context/i);
  });

  it('documents a mode-0600 token fixture for client tests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glintex-owner-plugin-'));
    const tokenFile = join(dir, 'agent.token');
    await writeFile(tokenFile, 'x'.repeat(64), { mode: 0o600 });
    await chmod(tokenFile, 0o600);
    expect(tokenFile).toContain('agent.token');
  });
});
