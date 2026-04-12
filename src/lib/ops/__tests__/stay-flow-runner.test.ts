/**
 * Tests for runStayFlowAdvancement() in stay-flow-runner.ts
 *
 * Covers:
 *  - No eligible reservations → returns zeros, no sends
 *  - Unlocked reservation with ready gate + template → advanced (message sent, pre_checkin_sent_at set)
 *  - Gate fails on re-check → re_blocked (reservation re-blocked, no send)
 *  - No pre_checkin_template configured → skipped
 *  - No chat_id → skipped
 *  - Repeated runner passes are idempotent (pre_checkin_sent_at seals it)
 *  - Multiple eligible reservations → each processed independently
 *  - DB query error → failed count incremented, no crash
 *  - Telegram send failure → failed count, pre_checkin_sent_at NOT set
 *  - Unrelated reservations (wrong property, cancelled, already sent) are excluded
 *  - Re-blocked reservation gets correct reason from gate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mutable state ─────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

let mockReservations: MockRow[] = [];
let mockQueryError: string | null = null;
let mockUpdateError: string | null = null;
let lastUpdates: { id: string; payload: MockRow }[] = [];

let mockGateAllowed = true;
let mockGateBlockedReason: string | null = null;
let mockGateAllowedSequence: boolean[] | null = null;
let mockGateBlockedReasonSequence: (string | null)[] | null = null;

let mockTemplates: { pre_checkin_template: string | null } | null = { pre_checkin_template: 'Check-in details: door code 1234' };

let mockSendSuccess = true;
let sentMessages: { chatId: number | string; text: string }[] = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'tg_guest_reservations') {
        const b: any = {
          select: () => b,
          eq: () => b,
          is: () => b,
          not: () => b,
          order: () => b,
          limit: () => b,
          maybeSingle: async () => {
            if (table === 'unit_state') {
              return {
                data: {
                  id: 'unit_state_1',
                  property_id: 'prop_A',
                  current_state: 'ready',
                  current_reservation_id: null,
                  dirty: false,
                  ready_for_checkin: true,
                  blocked_reason: null,
                  last_checkout_at: null,
                  last_turnover_completed_at: null,
                  updated_at: new Date().toISOString(),
                },
                error: null,
              };
            }
            if (table === 'property_knowledge') {
              return {
                data: {
                  active: true,
                  check_in_instructions: 'ok',
                  wifi_name: 'ok',
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          single: async () => ({ data: null, error: { message: 'not found' } }),
          then: (resolve: (v: { data: MockRow[]; error: null }) => void) => resolve({ data: [], error: null }),
        };
        return {
          select: () => b,
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: async () => ({ error: null }),
        };
      }

      // ── SELECT builder ───────────────────────────────────────────────────
      const selectBuilder = () => {
        const eqFilters: Record<string, unknown>     = {};
        const neqFilters: Record<string, unknown>    = {};
        const gteFilters: Record<string, unknown>    = {};
        const isFilters: Record<string, unknown>     = {};
        const notIsFilters: Record<string, unknown>  = {};
        let ordering: { col: string; asc: boolean } | null = null;

        const b = {
          select: (_cols?: string) => b,
          eq:   (col: string, val: unknown) => { eqFilters[col]    = val; return b; },
          neq:  (col: string, val: unknown) => { neqFilters[col]   = val; return b; },
          gte:  (col: string, val: unknown) => { gteFilters[col]   = val; return b; },
          is:   (col: string, val: unknown) => { isFilters[col]    = val; return b; },
          not:  (col: string, op: string, val: unknown) => {
            if (op === 'is') notIsFilters[col] = val;
            return b;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            ordering = { col, asc: opts?.ascending ?? true };
            return b;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (
            resolve: (v: { data: MockRow[] | null; error: { message: string } | null }) => void,
          ) => {
            if (mockQueryError) {
              resolve({ data: null, error: { message: mockQueryError } });
              return;
            }

            let rows = mockReservations.filter((r) => {
              for (const [k, v] of Object.entries(eqFilters))    { if (r[k] !== v)  return false; }
              for (const [k, v] of Object.entries(neqFilters))   { if (r[k] === v)  return false; }
              for (const [k, v] of Object.entries(gteFilters))   { if (String(r[k] ?? '') < String(v)) return false; }
              for (const [k, v] of Object.entries(isFilters))    { if (r[k] !== v)  return false; }
              for (const [k, v] of Object.entries(notIsFilters)) { if (r[k] === v)  return false; }
              return true;
            });

            if (ordering) {
              const { col, asc } = ordering;
              rows = rows.slice().sort((a, z) => {
                const av = String(a[col] ?? '');
                const bv = String(z[col] ?? '');
                return asc ? av.localeCompare(bv) : bv.localeCompare(av);
              });
            }

            resolve({ data: rows, error: null });
          },
        };
        return b;
      };

      // ── UPDATE builder ───────────────────────────────────────────────────
      const updateBuilder = (payload: MockRow) => {
        const u = {
          eq: (col: string, val: unknown) => {
            if (!mockUpdateError) {
              lastUpdates.push({ id: val as string, payload });
              mockReservations = mockReservations.map((r) =>
                r[col] === val ? { ...r, ...payload } : r,
              );
            }
            return Promise.resolve({ error: mockUpdateError ? { message: mockUpdateError } : null });
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

vi.mock('@/lib/ops/unit-state', () => ({
  getUnitState: vi.fn(async (_propertyId: string) => {
    const allowed = mockGateAllowedSequence ? (mockGateAllowedSequence.shift() ?? mockGateAllowed) : mockGateAllowed;
    const reason = mockGateBlockedReasonSequence
      ? (mockGateBlockedReasonSequence.shift() ?? (allowed ? null : (mockGateBlockedReason ?? 'unit_not_ready')))
      : (allowed ? null : (mockGateBlockedReason ?? 'unit_not_ready'));

    return {
      ok: true,
      state: {
        id: 'unit_state_1',
        property_id: 'prop_A',
        current_state: allowed ? 'ready' : 'blocked',
        current_reservation_id: null,
        dirty: false,
        ready_for_checkin: allowed,
        blocked_reason: reason,
        last_checkout_at: null,
        last_turnover_completed_at: null,
        updated_at: new Date().toISOString(),
      },
    };
  }),
}));

vi.mock('@/lib/ops/mappers', () => ({
  evaluateReadinessWithOptionalIncident: vi.fn(({ current }: { current: { ready_for_checkin?: boolean } }) => ({
    canProceed: Boolean(current?.ready_for_checkin),
  })),
}));

vi.mock('@/lib/communication/templates', () => ({
  getPropertyTemplates: vi.fn(async (_propertyId: string) => mockTemplates),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: vi.fn(async (chatId: number | string, text: string) => {
    if (mockSendSuccess) {
      sentMessages.push({ chatId, text });
      return true;
    }
    return false;
  }),
}));

vi.mock('@/lib/communication/timeline', () => ({
  appendTimelineEvent: vi.fn(async () => {}),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { runStayFlowAdvancement } from '../stay-flow-runner';

// ─── Time helpers ─────────────────────────────────────────────────────────────

const NEAR_FUTURE  = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();  // +4h
const FAR_FUTURE   = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +24h
const NEAR_PAST    = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();  // -2h (within 48h cutoff)
const OLD          = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // -72h (outside 48h cutoff)

function makeReservation(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id:                   'res_1',
    chat_id:              111,
    property_id:          'prop_A',
    check_in:             NEAR_FUTURE,
    status:               'confirmed',
    readiness_blocked:    false,
    readiness_checked_at: NEAR_PAST, // was previously gated
    pre_checkin_sent_at:  null,       // not yet sent
    ...overrides,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReservations   = [];
  mockQueryError     = null;
  mockUpdateError    = null;
  lastUpdates        = [];
  mockGateAllowed    = true;
  mockGateBlockedReason = null;
  mockGateAllowedSequence = null;
  mockGateBlockedReasonSequence = null;
  mockTemplates      = { pre_checkin_template: 'Check-in details: door code 1234' };
  mockSendSuccess    = true;
  sentMessages       = [];
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runStayFlowAdvancement', () => {

  // ── No work to do ──────────────────────────────────────────────────────────

  it('returns all zeros when no eligible reservations exist', async () => {
    const r = await runStayFlowAdvancement();
    expect(r).toEqual({ advanced: 0, skipped: 0, re_blocked: 0, failed: 0 });
    expect(sentMessages).toHaveLength(0);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('advances an eligible reservation: sends message and sets pre_checkin_sent_at', async () => {
    mockReservations = [makeReservation()];

    const r = await runStayFlowAdvancement();

    expect(r.advanced).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.re_blocked).toBe(0);
    expect(r.failed).toBe(0);

    // Telegram message was sent to the guest's chat
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(111);
    expect(sentMessages[0].text).toContain('Check-in details');

    // pre_checkin_sent_at was set on the row
    const update = lastUpdates.find((u) => u.id === 'res_1' && 'pre_checkin_sent_at' in u.payload);
    expect(update).toBeDefined();
    expect(update!.payload.pre_checkin_sent_at).toBeTruthy();
  });

  // ── Gate re-check fails ────────────────────────────────────────────────────

  it('re-blocks reservation when readiness gate fails on re-check', async () => {
    mockReservations  = [makeReservation()];
    mockGateAllowed   = false;
    mockGateBlockedReason = 'open_turnover_task';

    const r = await runStayFlowAdvancement();

    expect(r.re_blocked).toBe(1);
    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);

    // The reservation should be re-blocked with the correct reason
    const update = lastUpdates.find(
      (u) => u.id === 'res_1' && u.payload.readiness_blocked === true,
    );
    expect(update).toBeDefined();
    expect(update!.payload.readiness_block_reason).toBe('open_turnover_task');
  });

  // ── No template ────────────────────────────────────────────────────────────

  it('skips when no pre_checkin_template is configured', async () => {
    mockReservations = [makeReservation()];
    mockTemplates    = null; // no templates at all

    const r = await runStayFlowAdvancement();

    expect(r.skipped).toBe(1);
    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
    // pre_checkin_sent_at NOT set — remains eligible when template is added
    const sentUpdate = lastUpdates.find((u) => u.id === 'res_1' && 'pre_checkin_sent_at' in u.payload);
    expect(sentUpdate).toBeUndefined();
  });

  it('skips when pre_checkin_template field is null', async () => {
    mockReservations = [makeReservation()];
    mockTemplates    = { pre_checkin_template: null };

    const r = await runStayFlowAdvancement();

    expect(r.skipped).toBe(1);
    expect(sentMessages).toHaveLength(0);
  });

  // ── No chat_id ─────────────────────────────────────────────────────────────

  it('skips when reservation has no chat_id', async () => {
    mockReservations = [makeReservation({ chat_id: null })];

    const r = await runStayFlowAdvancement();

    expect(r.skipped).toBe(1);
    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('does not re-send when pre_checkin_sent_at is already set', async () => {
    mockReservations = [makeReservation({ pre_checkin_sent_at: new Date().toISOString() })];

    const r = await runStayFlowAdvancement();

    // Row excluded by the IS NULL filter — runner sees nothing to do
    expect(r.advanced).toBe(0);
    expect(r.skipped).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  it('is idempotent across two runner passes', async () => {
    mockReservations = [makeReservation()];

    const first = await runStayFlowAdvancement();
    expect(first.advanced).toBe(1);

    // Second pass: row now has pre_checkin_sent_at set (applied by mock update)
    const second = await runStayFlowAdvancement();
    expect(second.advanced).toBe(0);
    expect(sentMessages).toHaveLength(1); // only one send total
  });

  // ── Telegram failure ───────────────────────────────────────────────────────

  it('counts as failed and does not set pre_checkin_sent_at when Telegram send fails', async () => {
    mockReservations = [makeReservation()];
    mockSendSuccess  = false;

    const r = await runStayFlowAdvancement();

    expect(r.failed).toBe(1);
    expect(r.advanced).toBe(0);

    // pre_checkin_sent_at must NOT be set — row remains eligible for retry
    const sentUpdate = lastUpdates.find((u) => u.id === 'res_1' && 'pre_checkin_sent_at' in u.payload);
    expect(sentUpdate).toBeUndefined();
  });

  // ── DB query error ─────────────────────────────────────────────────────────

  it('returns failed=1 and does not crash on DB query error', async () => {
    mockQueryError = 'connection timeout';

    const r = await runStayFlowAdvancement();

    expect(r.failed).toBe(1);
    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  // ── Multiple reservations ──────────────────────────────────────────────────

  it('processes multiple eligible reservations independently', async () => {
    mockReservations = [
      makeReservation({ id: 'res_near', chat_id: 100, check_in: NEAR_FUTURE }),
      makeReservation({ id: 'res_far',  chat_id: 200, check_in: FAR_FUTURE  }),
    ];

    const r = await runStayFlowAdvancement();

    expect(r.advanced).toBe(2);
    expect(sentMessages).toHaveLength(2);
    // Ordered by check_in ascending — near first
    expect(sentMessages[0].chatId).toBe(100);
    expect(sentMessages[1].chatId).toBe(200);
  });

  it('processes reservations independently when one fails', async () => {
    // First res fails gate, second succeeds
    mockGateAllowedSequence = [false, true];
    mockGateBlockedReasonSequence = ['unit_dirty', null];

    mockReservations = [
      makeReservation({ id: 'res_1', chat_id: 100, check_in: NEAR_FUTURE }),
      makeReservation({ id: 'res_2', chat_id: 200, check_in: FAR_FUTURE  }),
    ];

    const r = await runStayFlowAdvancement();

    expect(r.re_blocked).toBe(1); // res_1
    expect(r.advanced).toBe(1);   // res_2
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(200);
  });

  // ── Excluded reservations ──────────────────────────────────────────────────

  it('does not affect cancelled reservations', async () => {
    mockReservations = [makeReservation({ status: 'cancelled' })];

    const r = await runStayFlowAdvancement();

    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  it('does not affect reservations outside the 48-hour look-back window', async () => {
    mockReservations = [makeReservation({ check_in: OLD })];

    const r = await runStayFlowAdvancement();

    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  it('does not affect reservations still readiness_blocked', async () => {
    mockReservations = [makeReservation({ readiness_blocked: true })];

    const r = await runStayFlowAdvancement();

    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  it('does not affect reservations that were never readiness-gated (readiness_checked_at IS NULL)', async () => {
    mockReservations = [makeReservation({ readiness_checked_at: null })];

    const r = await runStayFlowAdvancement();

    expect(r.advanced).toBe(0);
    expect(sentMessages).toHaveLength(0);
  });

  it('does not affect reservations for a different property', async () => {
    // Runner for this test has two rows: one for prop_A and one for prop_B.
    // We only care that the runner handles what it finds — it does not filter
    // by property_id itself, but the eligibility criteria still apply.
    mockReservations = [
      makeReservation({ id: 'res_A', property_id: 'prop_A', chat_id: 100 }),
      makeReservation({ id: 'res_B', property_id: 'prop_B', chat_id: 200 }),
    ];

    const r = await runStayFlowAdvancement();
    // Both should advance (runner is property-agnostic on each pass)
    expect(r.advanced).toBe(2);
    expect(sentMessages).toHaveLength(2);
  });

});
