/**
 * Tests for GET /api/admin/unit-state and POST /api/admin/update-unit-state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

type MockState = Record<string, unknown> | null;

let mockState: MockState   = null;
let mockGetError: string | null = null;
let mockTransitionError: string | null = null;

const mockTransitionResult = vi.fn();
const mockBlockResult      = vi.fn();
const mockUnblockResult    = vi.fn();

vi.mock('@/lib/ops/unit-state', () => ({
  getUnitState: async (_property_id: string) => {
    if (mockGetError) return { ok: false, state: null, error: mockGetError };
    return { ok: true, state: mockState };
  },
  blockUnit: async (_property_id: string, _reason: string) => mockBlockResult(),
  unblockUnit: async (_property_id: string) => mockUnblockResult(),
  transitionUnitState: async (_params: unknown) => mockTransitionResult(),
  UnitStateValue: {
    Idle:           'idle',
    Occupied:       'occupied',
    CheckoutDue:    'checkout_due',
    TurnoverNeeded: 'turnover_needed',
    InTurnover:     'in_turnover',
    Ready:          'ready',
    Blocked:        'blocked',
  },
}));

vi.mock('@/lib/communication/timeline', () => ({
  appendTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

import { GET }  from '../unit-state/route';
import { POST } from '../update-unit-state/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeGetReq(params: Record<string, string>, secret: string | null = ADMIN_SECRET): Request {
  const url = new URL('http://localhost/api/admin/unit-state');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: secret !== null ? { 'x-admin-secret': secret } : {},
  });
}

function makePostReq(body: unknown, secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/update-unit-state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState        = { id: 'us-1', property_id: 'prop_A', current_state: 'idle', dirty: false };
  mockGetError     = null;
  mockTransitionError = null;

  mockTransitionResult.mockResolvedValue({ ok: true, state: mockState });
  mockBlockResult.mockResolvedValue({ ok: true, state: { ...mockState, current_state: 'blocked', blocked_reason: 'maintenance', ready_for_checkin: false } });
  mockUnblockResult.mockResolvedValue({ ok: true, state: { ...mockState, current_state: 'idle', blocked_reason: null } });
});

// ─── GET /api/admin/unit-state ────────────────────────────────────────────────

describe('GET /api/admin/unit-state', () => {
  it('returns 401 without secret', async () => {
    const res = await GET(makeGetReq({ property_id: 'prop_A' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeGetReq({ property_id: 'prop_A' }, 'bad'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when property_id is missing', async () => {
    const res  = await GET(makeGetReq({}));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 200 with state', async () => {
    const res  = await GET(makeGetReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.state.current_state).toBe('idle');
  });

  it('returns 200 with null state when none exists', async () => {
    mockState = null;
    const res  = await GET(makeGetReq({ property_id: 'prop_NEW' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.state).toBeNull();
  });

  it('returns 500 on DB error', async () => {
    mockGetError = 'db error';
    const res  = await GET(makeGetReq({ property_id: 'prop_A' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });
});

// ─── POST /api/admin/update-unit-state ───────────────────────────────────────

describe('POST /api/admin/update-unit-state', () => {
  it('returns 401 without secret', async () => {
    const res = await POST(makePostReq({ property_id: 'prop_A', action: 'block', blocked_reason: 'x' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 400 when property_id is missing', async () => {
    const res  = await POST(makePostReq({ action: 'block', blocked_reason: 'x' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 400 for invalid action', async () => {
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'fly' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/action/);
  });

  it('returns 400 when block action has no blocked_reason', async () => {
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'block' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/blocked_reason/);
  });

  it('blocks unit with a reason', async () => {
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'block', blocked_reason: 'maintenance' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.action).toBe('block');
    expect(json.state.current_state).toBe('blocked');
    expect(json.state.blocked_reason).toBe('maintenance');
  });

  it('unblocks unit', async () => {
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'unblock' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.action).toBe('unblock');
    expect(json.state.blocked_reason).toBeNull();
  });

  it('mark_dirty transitions to turnover_needed', async () => {
    mockTransitionResult.mockResolvedValue({ ok: true, state: { current_state: 'turnover_needed', dirty: true } });
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'mark_dirty' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.state.current_state).toBe('turnover_needed');
  });

  it('mark_ready_override forces ready state and sets override flag', async () => {
    mockTransitionResult.mockResolvedValue({ ok: true, state: { current_state: 'ready', ready_for_checkin: true, dirty: false } });
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'mark_ready_override' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.state.current_state).toBe('ready');
    expect(json.override).toBe(true);
  });

  it('returns 500 on transition error', async () => {
    mockBlockResult.mockResolvedValue({ ok: false, state: null, error: 'db error' });
    const res  = await POST(makePostReq({ property_id: 'prop_A', action: 'block', blocked_reason: 'x' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });
});
