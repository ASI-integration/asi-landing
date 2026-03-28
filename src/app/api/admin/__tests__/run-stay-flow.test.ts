/**
 * Tests for POST /api/admin/run-stay-flow
 *
 * Covers:
 *  - 401 when no secret provided
 *  - 401 when wrong secret provided
 *  - 200 with runner result on success
 *  - 500 when runner throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunnerResult = { advanced: 0, skipped: 0, re_blocked: 0, failed: 0 };
const mockRunner = vi.fn();

vi.mock('@/lib/ops/stay-flow-runner', () => ({
  runStayFlowAdvancement: async () => mockRunner(),
}));

import { POST } from '../run-stay-flow/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/run-stay-flow', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
  });
}

beforeEach(() => {
  mockRunner.mockResolvedValue(mockRunnerResult);
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/run-stay-flow', () => {
  it('returns 401 without secret', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await POST(makeReq('bad-secret'));
    expect(res.status).toBe(401);
  });

  // ─── Success ────────────────────────────────────────────────────────────────

  it('returns 200 with runner result', async () => {
    mockRunner.mockResolvedValue({ advanced: 2, skipped: 1, re_blocked: 0, failed: 0 });
    const res  = await POST(makeReq());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.advanced).toBe(2);
    expect(json.result.skipped).toBe(1);
    expect(json.result.re_blocked).toBe(0);
    expect(json.result.failed).toBe(0);
  });

  it('returns 200 with all-zero result when nothing to advance', async () => {
    const res  = await POST(makeReq());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({ advanced: 0, skipped: 0, re_blocked: 0, failed: 0 });
  });

  // ─── Error ──────────────────────────────────────────────────────────────────

  it('returns 500 when runner throws', async () => {
    mockRunner.mockRejectedValue(new Error('DB connection failed'));
    const res  = await POST(makeReq());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('DB connection failed');
  });
});
