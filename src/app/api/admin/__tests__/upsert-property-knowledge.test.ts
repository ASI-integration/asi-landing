/**
 * Tests for POST /api/admin/upsert-property-knowledge
 *
 * Strategy: mock @/lib/supabase at module boundary.
 * Routes are called directly (not via HTTP) so no server is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type MaybeRow = Record<string, unknown> | null;

let mockExistingRow: MaybeRow = null;
let mockLegacyUpsertError: string | null = null;
let mockCanonicalUpsertError: string | null = null;
let legacyUpsertCalls: unknown[] = [];
let canonicalUpsertCalls: unknown[] = [];
let upsertOrder: string[] = [];

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
          upsert: (row: unknown, _opts: unknown) => {
            upsertOrder.push('legacy');
            legacyUpsertCalls.push(row);
            return {
              then: (cb: (v: unknown) => unknown) =>
                cb({ error: mockLegacyUpsertError ? { message: mockLegacyUpsertError } : null }),
              error: mockLegacyUpsertError ? { message: mockLegacyUpsertError } : null,
            };
          },
        };
      }
      if (table === 'object_knowledge_entries') {
        return {
          upsert: (row: unknown, _opts: unknown) => {
            upsertOrder.push('canonical');
            canonicalUpsertCalls.push(row);
            return Promise.resolve({
              error: mockCanonicalUpsertError ? { message: mockCanonicalUpsertError } : null,
              data: [],
            });
          },
        };
      }
      return { from: () => ({}) };
    },
  },
}));

vi.mock('@/lib/communication/timeline', () => ({
  appendTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '../upsert-property-knowledge/route';

const ADMIN_SECRET = 'test-secret';
process.env.ADMIN_SECRET = ADMIN_SECRET;

function makeReq(body: unknown, secret: string | null = ADMIN_SECRET): Request {
  return new Request('http://localhost/api/admin/upsert-property-knowledge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== null ? { 'x-admin-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/upsert-property-knowledge', () => {
  beforeEach(() => {
    mockExistingRow = null;
    mockLegacyUpsertError = null;
    mockCanonicalUpsertError = null;
    legacyUpsertCalls = [];
    canonicalUpsertCalls = [];
    upsertOrder = [];
  });

  it('returns 401 when x-admin-secret is missing', async () => {
    const res = await POST(makeReq({ property_id: 'prop_A' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 when x-admin-secret is wrong', async () => {
    const res = await POST(makeReq({ property_id: 'prop_A' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when property_id is missing', async () => {
    const res = await POST(makeReq({ property_name: 'Test' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/property_id/);
  });

  it('returns 400 when property_id is empty string', async () => {
    const res = await POST(makeReq({ property_id: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/admin/upsert-property-knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates a new property record and returns created=true', async () => {
    mockExistingRow = null;
    const res = await POST(
      makeReq({
        property_id: 'prop_new',
        property_name: 'New Apartment',
        location: 'Moscow',
        check_in_time: '15:00',
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.created).toBe(true);
    expect(json.property_id).toBe('prop_new');
  });

  it('updates existing property and returns created=false', async () => {
    mockExistingRow = { property_id: 'prop_A', wifi_name: 'OldNet', wifi_password: 'OldPass' };
    const res = await POST(
      makeReq({
        property_id: 'prop_A',
        property_name: 'Updated Name',
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.created).toBe(false);
  });

  it('is idempotent: calling twice with same payload does not fail', async () => {
    const body = { property_id: 'prop_idem', property_name: 'Same' };
    const res1 = await POST(makeReq(body));
    mockExistingRow = { property_id: 'prop_idem' };
    const res2 = await POST(makeReq(body));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const j2 = await res2.json();
    expect(j2.created).toBe(false);
  });

  it('writes canonical guest facts before legacy when wifi fields are supplied', async () => {
    mockExistingRow = null;
    const res = await POST(
      makeReq({
        property_id: 'prop_wifi',
        wifi_name: 'GuestNet',
        wifi_password: 'pass123',
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(upsertOrder[0]).toBe('canonical');
    expect(upsertOrder).toContain('legacy');
    expect(upsertOrder.indexOf('canonical')).toBeLessThan(upsertOrder.indexOf('legacy'));
    expect(canonicalUpsertCalls.length).toBe(1);
    expect(legacyUpsertCalls.length).toBe(1);
  });

  it('canonical write failure does not execute legacy guest-field upsert', async () => {
    mockCanonicalUpsertError = 'canonical write boom';
    const res = await POST(
      makeReq({
        property_id: 'prop_fail_canon',
        wifi_password: 'should-not-reach-legacy',
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/canonical_guest_fact_upsert_failed/);
    expect(upsertOrder).toEqual(['canonical']);
    expect(legacyUpsertCalls).toHaveLength(0);
  });

  it('legacy failure after canonical success reports canonical committed', async () => {
    mockLegacyUpsertError = 'legacy write boom';
    const res = await POST(
      makeReq({
        property_id: 'prop_fail_legacy',
        wifi_name: 'Net',
        wifi_password: 'Pass',
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.canonical_guest_facts_committed).toBe(true);
    expect(json.error).toMatch(/legacy_tg_property_knowledge_upsert_failed_after_canonical/);
    expect(upsertOrder[0]).toBe('canonical');
    expect(upsertOrder).toContain('legacy');
  });

  it('explicit wifi_password "" writes canonical tombstone clear', async () => {
    const res = await POST(
      makeReq({
        property_id: 'prop_clear',
        wifi_password: '',
      }),
    );
    expect(res.status).toBe(200);
    expect(canonicalUpsertCalls).toHaveLength(1);
    const rows = canonicalUpsertCalls[0] as Array<{ key: string; value_text: string | null }>;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'wifi_password', value_text: null }),
      ]),
    );
    const legacyRow = legacyUpsertCalls[0] as Record<string, unknown>;
    expect(legacyRow.wifi_password).toBe('');
  });

  it('omitted wifi_password does not emit a canonical password mutation', async () => {
    mockExistingRow = { property_id: 'prop_omit', wifi_name: 'OldNet', wifi_password: 'OldPass' };
    const res = await POST(
      makeReq({
        property_id: 'prop_omit',
        wifi_name: 'NewNet',
      }),
    );
    expect(res.status).toBe(200);
    const rows = canonicalUpsertCalls[0] as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).toEqual(['wifi_name']);
    expect(rows.some((r) => r.key === 'wifi_password')).toBe(false);
  });

  it('returns 500 when legacy-only upsert fails without guest fields', async () => {
    mockLegacyUpsertError = 'DB connection failed';
    const res = await POST(makeReq({ property_id: 'prop_fail', property_name: 'X' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/DB connection failed/);
    expect(canonicalUpsertCalls).toHaveLength(0);
  });
});
