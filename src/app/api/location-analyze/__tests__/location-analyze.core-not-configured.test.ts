import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { POST } from '../route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/location-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/location-analyze when core API not configured', () => {
  const prevBase = process.env.ASI_CORE_BASE_URL;
  const prevSecret = process.env.ASI_CORE_API_SECRET;

  beforeEach(() => {
    delete process.env.ASI_CORE_BASE_URL;
    delete process.env.ASI_CORE_API_SECRET;
  });

  afterEach(() => {
    if (prevBase === undefined) delete process.env.ASI_CORE_BASE_URL;
    else process.env.ASI_CORE_BASE_URL = prevBase;

    if (prevSecret === undefined) delete process.env.ASI_CORE_API_SECRET;
    else process.env.ASI_CORE_API_SECRET = prevSecret;
  });

  it('returns a non-leaky 503 with CORE_API_NOT_CONFIGURED', async () => {
    const res = await POST(makeReq({ address: 'Test address 123' }) as any);
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('CORE_API_NOT_CONFIGURED');

    const raw = JSON.stringify(json);
    expect(raw).not.toContain('ASI_CORE_BASE_URL');
    expect(raw).not.toContain('[core-api]');
  });
});

