import { describe, expect, it } from 'vitest';

import { assertToolAuthorized, buildReadRequest, parseResponse } from './client.js';

const config = {
  baseUrl: 'https://app.glintex.in',
  apiTokenFile: '/tmp/glintex-token',
  allowedAgentId: 'glintex-companion',
};

describe('GLINTEX read request boundary', () => {
  it('builds only the fixed issues endpoint with bounded query fields', () => {
    const url = buildReadRequest('https://app.glintex.in', {
      resource: 'issues',
      process: 'holo',
      search: 'LOT-12',
      limit: 25,
      order: 'desc',
    });
    expect(url.pathname).toBe('/api/v2/issue/holo/tracking');
    expect(url.searchParams.get('search')).toBe('LOT-12');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('order')).toBe('desc');
  });

  it('rejects stock processes not supported by the app endpoint', () => {
    expect(() =>
      buildReadRequest('https://app.glintex.in', {
        resource: 'stock',
        process: 'cutter',
      }),
    ).toThrow('process must be one of: holo, coning');
  });

  it('rejects a production range longer than 93 days', () => {
    expect(() =>
      buildReadRequest('https://app.glintex.in', {
        resource: 'production',
        dateFrom: '2026-01-01',
        dateTo: '2026-08-10',
      }),
    ).toThrow('limited to 93 days');
  });

  it('requires exact owner and agent context', () => {
    expect(() =>
      assertToolAuthorized(config, {
        agentId: 'main',
        senderIsOwner: true,
      }),
    ).toThrow('dedicated companion');
    expect(() =>
      assertToolAuthorized(config, {
        agentId: 'glintex-companion',
        senderIsOwner: false,
      }),
    ).toThrow('authenticated owner');
    expect(() =>
      assertToolAuthorized(config, {
        agentId: 'glintex-companion',
        senderIsOwner: undefined,
      }),
    ).toThrow('authenticated owner');
    expect(() =>
      assertToolAuthorized(config, {
        agentId: 'glintex-companion',
        senderIsOwner: true,
      }),
    ).not.toThrow();
  });

  it('distinguishes a rejected backend credential from owner-context denial', async () => {
    const response = new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseResponse(response, 65_536)).rejects.toThrow(
      'GLINTEX backend rejected the agent credential (HTTP 401)',
    );
  });
});
