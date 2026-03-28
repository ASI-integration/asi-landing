/**
 * Tests for GET /api/admin/reservation-readiness
 *
 * Covers:
 *  - 401 without secret
 *  - 401 with wrong secret
 *  - 400 when property_id or reservation_ref missing
 *  - 404 when reservation not found
 *  - 500 on DB error
 *  - 200 with full readiness payload
 *  - eligible_for_auto_advance = true when all runner criteria met
 *  - eligible_for_auto_advance = false when readiness_blocked = true
 *  - eligible_for_auto_advance = false when pre_checkin_sent_at already set
 *  - eligible_for_auto_advance = false when cancelled
 *  - eligible_for_auto_advance = false when readiness_checked_at is null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mutable state ─────────────────────────────────────────────────────

type MockRow = Record<string, unknown> | null;

let mockReservation: MockRow = null;
let mockQueryError: string | null = null;

let mockUnitState: Record<string, unknown> | null = {
  id: 'us-1', property_id: 'prop_A', current_state: 'ready',
  dirty: false, ready_for_checkin: true, blocked_reason: null,
};
let mockUnitStateError: string | null = null;

let mockGateAllowed = true;
let mockGateReason: string | null = null;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'tg_guest_reservations') return {};
      const b: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: (_cols: string) => builder,
        eq:     (_col: string, _val: unknown) => builder,
        maybeSingle: async () => {
          if (mockQueryError) return { data: null, error: { message: mockQueryError } };
          return { data: mockReservation, error: null };
        },
      };
      void b;
      return builder;
    },
  },
}));

vi.mock('@/lib/ops/unit-state', () => ({
  getUnitState: async (_property_id: string) => {
    if (mockUnitStateError) return { ok: false, state: null, error: mockUnitStateError };
    return { ok: true, state: mockUnitState };
  },
}));

vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async (_property_id: string) => ({
    allowed:        mockGateAllowed,
    unit_state:     mockGateAllowed ? 'ready' : 'blocked',
    blocked_reason: mockGateReason,
    checked_at:     new Date().toISOString(),
  }),
}));

import { GET } from '../reservation-readiness/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

// A check_in 24h in the future — within the 48h runner window
const futureCheckin = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const baseReservation = {
  id:                    'res-uuid-1',
  reservation_ref:       'RES-001',
  property_id:           'prop_A',
  chat_id:               123456789,
  check_in:              futureCheckin,
  status:                'confirmed',
  readiness_blocked:     false,
  readiness_block_reason: null,
  readiness_checked_at:  new Date().toISOString(),
  pre_checkin_sent_at:   null,
};

function makeReq(
  params: Record<string, string>,
  secret: string | null = ADMIN_SECRET,
): Request {
  const url = new URL('http://localhost/api/admin/reservation-readiness');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: secret !== null ? { 'x-admin-secret': secret } : {},
  });
}

beforeEach(() => {
  mockReservation    = { ...baseReservation };
  mockQueryError     = null;
  mockUnitState      = { id: 'us-1', property_id: 'prop_A', current_state: 'ready', dirty: false, ready_for_checkin: true, blocked_reason: null };
  mockUnitStateError = null;
  mockGateAllowed    = true;
  mockGateReason     = null;
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/reservation-readiness', () => {
  it('returns 401 without secret', async () => {
    const res = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }, 'bad'));
    expect(res.status).toBe(401);
  });

  // ─── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when property_id is missing', async () => {
    const res  = await GET(makeReq({ reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 400 when reservation_ref is missing', async () => {
    const res  = await GET(makeReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/reservation_ref/);
  });

  // ─── Not found / DB errors ──────────────────────────────────────────────────

  it('returns 404 when reservation not found', async () => {
    mockReservation = null;
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-999' }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe('not_found');
  });

  it('returns 500 on DB error', async () => {
    mockQueryError = 'connection refused';
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });

  // ─── Success ────────────────────────────────────────────────────────────────

  it('returns 200 with full readiness payload', async () => {
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.reservation.reservation_ref).toBe('RES-001');
    expect(json.reservation.readiness_blocked).toBe(false);
    expect(json.reservation.pre_checkin_sent_at).toBeNull();
    expect(json.unit_state).toBeDefined();
    expect(json.checkin_gate.allowed).toBe(true);
  });

  // ─── Eligibility ────────────────────────────────────────────────────────────

  it('eligible_for_auto_advance = true when all criteria met', async () => {
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(json.eligible_for_auto_advance).toBe(true);
  });

  it('eligible_for_auto_advance = false when readiness_blocked = true', async () => {
    mockReservation = { ...baseReservation, readiness_blocked: true, readiness_block_reason: 'unit_dirty' };
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('eligible_for_auto_advance = false when pre_checkin_sent_at is set', async () => {
    mockReservation = { ...baseReservation, pre_checkin_sent_at: new Date().toISOString() };
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('eligible_for_auto_advance = false when status is cancelled', async () => {
    mockReservation = { ...baseReservation, status: 'cancelled' };
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('eligible_for_auto_advance = false when readiness_checked_at is null (never gated)', async () => {
    mockReservation = { ...baseReservation, readiness_checked_at: null };
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('eligible_for_auto_advance = false when check_in is older than 48h', async () => {
    const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockReservation = { ...baseReservation, check_in: oldDate };
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(json.eligible_for_auto_advance).toBe(false);
  });

  it('returns unit_state null when no unit state row exists', async () => {
    mockUnitState = null;
    const res  = await GET(makeReq({ property_id: 'prop_A', reservation_ref: 'RES-001' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.unit_state).toBeNull();
  });
});
