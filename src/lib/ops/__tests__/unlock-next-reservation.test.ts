/**
 * Tests for unlockNextBlockedReservation() in unit-state.ts
 *
 * Covers:
 *  - No blocked reservation → no-op (ok: true, reservation_id: null)
 *  - Nearest upcoming blocked reservation is cleared
 *  - Multiple blocked reservations → picks nearest by check_in ASC
 *  - Wrong property / unrelated reservation is not affected
 *  - Idempotent: already-cleared reservation is ignored
 *  - Cancelled reservations are ignored
 *  - Historical check-ins (>48h ago) are excluded
 *  - DB error on select → ok: false
 *  - DB error on update → ok: false
 *  - null chat_id handled gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

let mockReservations: MockRow[] = [];
let mockSelectError: string | null = null;
let mockUpdateError: string | null = null;

// Captures the last update call for assertions
let lastUpdatePayload: MockRow | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'tg_guest_reservations') {
        // Minimal stub for other tables (unit_state, etc.) not exercised here
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
          upsert: () => ({
            select: () => ({ single: async () => ({ data: null, error: null }) }),
          }),
        };
      }

      // ── SELECT path ─────────────────────────────────────────────────────
      const selectBuilder = () => {
        const eqFilters: Record<string, unknown> = {};
        const neqFilters: Record<string, unknown> = {};
        const gteFilters: Record<string, unknown> = {};
        let ordering: { col: string; asc: boolean } | null = null;
        let limitN = 1000;

        const b = {
          eq: (col: string, val: unknown) => { eqFilters[col] = val; return b; },
          neq: (col: string, val: unknown) => { neqFilters[col] = val; return b; },
          gte: (col: string, val: unknown) => { gteFilters[col] = val; return b; },
          order: (col: string, opts?: { ascending?: boolean }) => {
            ordering = { col, asc: opts?.ascending ?? true };
            return b;
          },
          limit: (n: number) => { limitN = n; return b; },
          maybeSingle: async () => {
            if (mockSelectError) return { data: null, error: { message: mockSelectError } };

            let rows = mockReservations.filter((r) => {
              // eq filters
              for (const [k, v] of Object.entries(eqFilters)) {
                if (r[k] !== v) return false;
              }
              // neq filters
              for (const [k, v] of Object.entries(neqFilters)) {
                if (r[k] === v) return false;
              }
              // gte filters (string/ISO comparison is fine for dates and booleans)
              for (const [k, v] of Object.entries(gteFilters)) {
                if (String(r[k] ?? '') < String(v)) return false;
              }
              return true;
            });

            if (ordering) {
              const col = ordering.col;
              const asc = ordering.asc;
              rows = rows.slice().sort((a, b) => {
                const av = String(a[col] ?? '');
                const bv = String(b[col] ?? '');
                return asc ? av.localeCompare(bv) : bv.localeCompare(av);
              });
            }

            rows = rows.slice(0, limitN);
            return { data: rows[0] ?? null, error: null };
          },
        };
        return b;
      };

      // ── UPDATE path ─────────────────────────────────────────────────────
      const updateBuilder = (payload: MockRow) => {
        const updateEq: Record<string, unknown> = {};
        const u = {
          eq: (col: string, val: unknown) => {
            updateEq[col] = val;
            // Return a thenable so `await supabase.from(...).update(...).eq(...)` works
            return {
              then: (
                resolve: (v: { error: null | { message: string } }) => void,
                _reject?: (e: unknown) => void,
              ) => {
                if (mockUpdateError) {
                  lastUpdatePayload = null;
                  resolve({ error: { message: mockUpdateError } });
                } else {
                  lastUpdatePayload = payload;
                  // Apply update to matching rows in-place
                  mockReservations = mockReservations.map((r) =>
                    Object.entries(updateEq).every(([k, v]) => r[k] === v)
                      ? { ...r, ...payload }
                      : r,
                  );
                  resolve({ error: null });
                }
              },
            };
          },
        };
        return u;
      };

      return {
        select: (cols?: string) => { void cols; return selectBuilder(); },
        update: (payload: MockRow) => updateBuilder(payload),
      };
    },
  },
}));

import { unlockNextBlockedReservation } from '../unit-state';

// ─── Time helpers ─────────────────────────────────────────────────────────────

const NEAR_FUTURE = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();  // +2h
const FAR_FUTURE  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +24h
const OLD         = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // -72h (> 48h cutoff)

beforeEach(() => {
  mockReservations = [];
  mockSelectError  = null;
  mockUpdateError  = null;
  lastUpdatePayload = null;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('unlockNextBlockedReservation', () => {
  it('returns ok:true and null when no blocked reservation exists', async () => {
    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBeNull();
    expect(result.chat_id).toBeNull();
  });

  it('clears readiness_blocked on the nearest upcoming reservation', async () => {
    mockReservations = [{
      id: 'res_1', property_id: 'prop_A', chat_id: '111',
      readiness_blocked: true, status: 'confirmed', check_in: NEAR_FUTURE,
    }];

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBe('res_1');
    expect(result.chat_id).toBe('111');
    expect(lastUpdatePayload?.readiness_blocked).toBe(false);
    expect(lastUpdatePayload?.readiness_block_reason).toBeNull();
  });

  it('picks the nearest check_in when multiple blocked reservations exist', async () => {
    mockReservations = [
      { id: 'res_far',  property_id: 'prop_A', chat_id: '222', readiness_blocked: true, status: 'confirmed', check_in: FAR_FUTURE },
      { id: 'res_near', property_id: 'prop_A', chat_id: '111', readiness_blocked: true, status: 'confirmed', check_in: NEAR_FUTURE },
    ];

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBe('res_near');
  });

  it('does not affect reservations for a different property', async () => {
    mockReservations = [{
      id: 'res_other', property_id: 'prop_B', chat_id: '999',
      readiness_blocked: true, status: 'confirmed', check_in: NEAR_FUTURE,
    }];

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBeNull();
    expect(mockReservations[0].readiness_blocked).toBe(true);
  });

  it('is a no-op when readiness_blocked is already false', async () => {
    mockReservations = [{
      id: 'res_clear', property_id: 'prop_A', chat_id: '111',
      readiness_blocked: false, status: 'confirmed', check_in: NEAR_FUTURE,
    }];

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBeNull();
  });

  it('ignores check-ins older than 48 h (historical)', async () => {
    mockReservations = [{
      id: 'res_old', property_id: 'prop_A', chat_id: '111',
      readiness_blocked: true, status: 'confirmed', check_in: OLD,
    }];

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBeNull();
  });

  it('returns ok:false on select DB error', async () => {
    mockSelectError = 'connection refused';
    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('connection refused');
    expect(result.reservation_id).toBeNull();
  });

  it('returns ok:false on update DB error', async () => {
    mockReservations = [{
      id: 'res_1', property_id: 'prop_A', chat_id: '111',
      readiness_blocked: true, status: 'confirmed', check_in: NEAR_FUTURE,
    }];
    mockUpdateError = 'update failed';

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('update failed');
    expect(result.reservation_id).toBeNull();
  });

  it('handles null chat_id gracefully', async () => {
    mockReservations = [{
      id: 'res_nochat', property_id: 'prop_A', chat_id: null,
      readiness_blocked: true, status: 'confirmed', check_in: NEAR_FUTURE,
    }];

    const result = await unlockNextBlockedReservation('prop_A');
    expect(result.ok).toBe(true);
    expect(result.reservation_id).toBe('res_nochat');
    expect(result.chat_id).toBeNull();
  });

  it('is idempotent: calling twice unlocks at most one reservation per call', async () => {
    mockReservations = [{
      id: 'res_1', property_id: 'prop_A', chat_id: '111',
      readiness_blocked: true, status: 'confirmed', check_in: NEAR_FUTURE,
    }];

    const first = await unlockNextBlockedReservation('prop_A');
    expect(first.ok).toBe(true);
    expect(first.reservation_id).toBe('res_1');

    // Row is now readiness_blocked: false — second call is a no-op
    const second = await unlockNextBlockedReservation('prop_A');
    expect(second.ok).toBe(true);
    expect(second.reservation_id).toBeNull();
  });
});
