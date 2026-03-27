/**
 * Tests for POST /api/admin/upsert-property-templates
 *
 * Strategy: mock @/lib/supabase at module boundary.
 * Routes are called directly (not via HTTP) so no server is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────

type MaybeRow = Record<string, unknown> | null;

let mockExistingRow: MaybeRow = null;
let mockUpsertError: string | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'tg_property_knowledge') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockExistingRow, error: null }),
            }),
          }),
          upsert: (_row: unknown, _opts: unknown) => ({
            then: (cb: (v: unknown) => unknown) =>
              cb({ error: mockUpsertError ? { message: mockUpsertError } : null }),
            error: mockUpsertError ? { message: mockUpsertError } : null,
          }),
        };
      }
      return { from: () => ({}) };
    },
  },
}));

// Timeline mock — fire-and-forget, no assertions
vi.mock('@/lib/communication/timeline', () => ({
  appendTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import route after mocks ─────────────────────────────────────────────────
import { POST } from '../upsert-property-templates/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(body: unknown, secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/upsert-property-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/upsert-property-templates', () => {
  beforeEach(() => {
    mockExistingRow = null;
    mockUpsertError = null;
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  it('returns 401 when x-admin-secret is missing', async () => {
    const res = await POST(makeReq({ property_id: 'prop_A' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 when x-admin-secret is wrong', async () => {
    const res = await POST(makeReq({ property_id: 'prop_A' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when property_id is missing', async () => {
    const res = await POST(makeReq({ pre_checkin_template: 'Hello!' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 400 when property_id is blank', async () => {
    const res = await POST(makeReq({ property_id: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/admin/upsert-property-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  it('creates a new property template record and returns created=true', async () => {
    mockExistingRow = null;
    const res = await POST(makeReq({
      property_id:           'prop_new',
      pre_checkin_template:  'Welcome! Check-in instructions: ...',
      checkout_template:     'Thank you for staying!',
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.created).toBe(true);
    expect(json.property_id).toBe('prop_new');
  });

  // ── Update ─────────────────────────────────────────────────────────────────

  it('updates existing property templates and returns created=false', async () => {
    mockExistingRow = { property_id: 'prop_A' };
    const res = await POST(makeReq({
      property_id:          'prop_A',
      checkout_template:    'Updated checkout message.',
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.created).toBe(false);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('is idempotent: calling twice with same payload does not fail', async () => {
    const body = { property_id: 'prop_idem', pre_checkin_template: 'Hello!' };
    const res1 = await POST(makeReq(body));
    mockExistingRow = { property_id: 'prop_idem' };
    const res2 = await POST(makeReq(body));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const j2 = await res2.json();
    expect(j2.created).toBe(false);
  });

  // ── Partial update (only provided fields written) ─────────────────────────

  it('accepts a payload with only followup_template set', async () => {
    mockExistingRow = { property_id: 'prop_A' };
    const res = await POST(makeReq({
      property_id:       'prop_A',
      followup_template: 'Hope you enjoyed your stay!',
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('accepts a payload with only escalation_contact_text set', async () => {
    mockExistingRow = { property_id: 'prop_A' };
    const res = await POST(makeReq({
      property_id:             'prop_A',
      escalation_contact_text: 'Call us at +7-XXX-XXX-XXXX.',
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  // ── DB error ───────────────────────────────────────────────────────────────

  it('returns 500 when Supabase upsert fails', async () => {
    mockUpsertError = 'DB connection failed';
    const res = await POST(makeReq({ property_id: 'prop_fail', pre_checkin_template: 'Hi' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/DB connection failed/);
  });
});
