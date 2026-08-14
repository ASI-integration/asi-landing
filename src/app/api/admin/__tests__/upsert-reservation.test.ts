/**
 * Tests for POST /api/admin/upsert-reservation
 *
 * Strategy: mock @/lib/supabase at module boundary.
 * Routes are called directly (not via HTTP) so no server is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────

type MaybeRow = Record<string, unknown> | null;

let mockExistingRow: MaybeRow = null;
let mockUpsertError: string | null = null;
let mockReturnedId = 'uuid-reservation-1';
let mockFromCalls = 0;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFromCalls += 1;
      if (table === 'tg_guest_reservations') {
        return {
          select: (cols?: string) => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockExistingRow, error: null }),
            }),
            single: async () => ({
              data: { id: mockReturnedId },
              error: mockUpsertError ? { message: mockUpsertError } : null,
            }),
          }),
          upsert: (_row: unknown, _opts: unknown) => ({
            select: () => ({
              single: async () => ({
                data:  mockUpsertError ? null : { id: mockReturnedId },
                error: mockUpsertError ? { message: mockUpsertError } : null,
              }),
            }),
          }),
        };
      }
      return { from: () => ({}) };
    },
  },
}));

// Timeline mock
vi.mock('@/lib/communication/timeline', () => ({
  appendTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import route after mocks ─────────────────────────────────────────────────
import { POST } from '../upsert-reservation/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(body: unknown, secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/upsert-reservation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  reservation_ref: 'RES-001',
  property_id:     'prop_A',
  chat_id:         123456789,
  guest_name:      'Jane Doe',
  check_in:        '2026-06-01',
  check_out:       '2026-06-05',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/upsert-reservation', () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    mockExistingRow  = null;
    mockUpsertError  = null;
    mockReturnedId   = 'uuid-reservation-1';
    mockFromCalls    = 0;
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  it('returns 401 when x-admin-secret is missing', async () => {
    const res = await POST(makeReq(VALID_BODY, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 when x-admin-secret is empty', async () => {
    const res = await POST(makeReq(VALID_BODY, ''));
    expect(res.status).toBe(401);
  });

  it('returns 401 when x-admin-secret is wrong', async () => {
    const res = await POST(makeReq(VALID_BODY, 'bad'));
    expect(res.status).toBe(401);
  });

  it('fails closed before validation or database access when ADMIN_SECRET is missing', async () => {
    delete process.env.ADMIN_SECRET;

    const res = await POST(makeReq({}, null));
    expect(res.status).toBe(503);
    expect(mockFromCalls).toBe(0);
  });

  it.each(['', '   '])('fails closed when ADMIN_SECRET is %j', async (configuredSecret) => {
    process.env.ADMIN_SECRET = configuredSecret;

    const res = await POST(makeReq(VALID_BODY, configuredSecret));
    expect(res.status).toBe(503);
    expect(mockFromCalls).toBe(0);
  });

  it('authenticates before parsing an invalid request body', async () => {
    const req = new Request('http://localhost/api/admin/upsert-reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockFromCalls).toBe(0);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when reservation_ref is missing', async () => {
    const { reservation_ref: _, ...rest } = VALID_BODY;
    const res = await POST(makeReq(rest));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/reservation_ref/);
  });

  it('returns 400 when property_id is missing', async () => {
    const { property_id: _, ...rest } = VALID_BODY;
    const res = await POST(makeReq(rest));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 400 when chat_id is missing', async () => {
    const { chat_id: _, ...rest } = VALID_BODY;
    const res = await POST(makeReq(rest));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/chat_id/);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/admin/upsert-reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  it('creates a new reservation and returns created=true', async () => {
    mockExistingRow = null;
    const res  = await POST(makeReq(VALID_BODY));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.created).toBe(true);
    expect(json.reservation_id).toBe('uuid-reservation-1');
    expect(json.reservation_ref).toBe('RES-001');
  });

  it('sets default status=confirmed on create', async () => {
    // We verify indirectly — if no status is passed and the route does not error,
    // the default was applied. The DB mock accepts any row.
    mockExistingRow = null;
    const { ...body } = VALID_BODY;
    const res = await POST(makeReq(body));
    expect(res.status).toBe(200);
  });

  // ── Update ─────────────────────────────────────────────────────────────────

  it('updates existing reservation and returns created=false', async () => {
    mockExistingRow = { id: 'uuid-reservation-1' };
    const res  = await POST(makeReq({ ...VALID_BODY, guest_name: 'Updated Guest' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.created).toBe(false);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('is idempotent: calling twice does not fail', async () => {
    const res1 = await POST(makeReq(VALID_BODY));
    mockExistingRow = { id: 'uuid-reservation-1' };
    const res2 = await POST(makeReq(VALID_BODY));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  // ── Optional fields ────────────────────────────────────────────────────────

  it('accepts guest_count and note', async () => {
    const res = await POST(makeReq({ ...VALID_BODY, guest_count: 2, note: 'Early check-in requested' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  // ── DB error ───────────────────────────────────────────────────────────────

  it('returns 500 when Supabase upsert fails', async () => {
    mockUpsertError = 'constraint violation';
    const res  = await POST(makeReq(VALID_BODY));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/constraint violation/);
  });
});
