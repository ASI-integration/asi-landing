/**
 * Tests for POST /api/admin/apply-readiness-gate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown> | null;

let mockReservation: MockRow = null;
let mockFetchError: string | null = null;
let mockUpdateError: string | null = null;
let mockGateAllowed = false;
let mockGateBlockedReason: string | null = 'unit_state_missing';

const mockUpdateFn = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => {
      // Build a fluent stub that handles select and update chains.
      const stub: Record<string, unknown> = {};

      stub.select = (_cols: string) => stub;
      stub.eq     = (_col: string, _val: unknown) => stub;
      stub.maybeSingle = async () => {
        if (mockFetchError) return { data: null, error: { message: mockFetchError } };
        return { data: mockReservation, error: null };
      };
      stub.update = (data: unknown) => {
        mockUpdateFn(data);
        return {
          eq: (_col: string, _val: unknown) =>
            Promise.resolve({
              data: null,
              error: mockUpdateError ? { message: mockUpdateError } : null,
            }),
        };
      };

      return stub;
    },
  },
}));

vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async (_property_id: string) => ({
    allowed:        mockGateAllowed,
    unit_state:     mockGateAllowed ? 'ready' : null,
    blocked_reason: mockGateAllowed ? null : mockGateBlockedReason,
    checked_at:     '2026-03-28T10:00:00.000Z',
  }),
}));

import { POST } from '../apply-readiness-gate/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(body: unknown, secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/apply-readiness-gate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReservation = {
    id:                 'res-uuid-1',
    check_in:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    status:             'confirmed',
    pre_checkin_sent_at: null,
  };
  mockFetchError        = null;
  mockUpdateError       = null;
  mockGateAllowed       = false;
  mockGateBlockedReason = 'unit_state_missing';
  mockUpdateFn.mockClear();
});

// ─── Auth ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/apply-readiness-gate', () => {
  it('returns 401 without secret', async () => {
    const res = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }, 'bad'));
    expect(res.status).toBe(401);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when property_id is missing', async () => {
    const res  = await POST(makeReq({ reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 400 when reservation_ref is missing', async () => {
    const res  = await POST(makeReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/reservation_ref/);
  });

  // ── Not found ──────────────────────────────────────────────────────────────

  it('returns 404 when reservation is not found', async () => {
    mockReservation = null;
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-999' }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe('not_found');
  });

  it('returns 500 on DB fetch error', async () => {
    mockFetchError = 'connection timeout';
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });

  // ── Gate blocked ───────────────────────────────────────────────────────────

  it('sets readiness_blocked=true when gate is blocked', async () => {
    mockGateAllowed       = false;
    mockGateBlockedReason = 'unit_state_missing';
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.readiness_blocked).toBe(true);
    expect(json.gate.blocked_reason).toBe('unit_state_missing');
    expect(json.eligible_for_auto_advance).toBe(false);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ readiness_blocked: true, readiness_block_reason: 'unit_state_missing' }),
    );
  });

  // ── Gate allowed ───────────────────────────────────────────────────────────

  it('sets readiness_blocked=false and eligible=true when gate passes', async () => {
    mockGateAllowed = true;
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.readiness_blocked).toBe(false);
    expect(json.gate.allowed).toBe(true);
    expect(json.eligible_for_auto_advance).toBe(true);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ readiness_blocked: false, readiness_block_reason: null }),
    );
  });

  it('eligible_for_auto_advance=false when pre_checkin_sent_at is already set', async () => {
    mockGateAllowed = true;
    mockReservation = { ...mockReservation, pre_checkin_sent_at: '2026-03-27T10:00:00.000Z' };
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('eligible_for_auto_advance=false when status is cancelled', async () => {
    mockGateAllowed = true;
    mockReservation = { ...mockReservation, status: 'cancelled' };
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('returns 500 on DB update error', async () => {
    mockUpdateError = 'write failed';
    const res  = await POST(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });
});
