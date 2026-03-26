/**
 * Stay-flow unit tests.
 *
 * Strategy: isolate at Supabase + external I/O boundary.
 *   - supabase        → in-memory table store (selectRows/upsertedRows/updatedRows)
 *   - @/lib/telegram  → vi.fn() per test
 *   - ./knowledge     → deterministic stub returning known property data
 *   - ./timeline      → vi.fn() (fire-and-forget, no assertions on content)
 *
 * All Date comparisons use a fixed "now" via vi.setSystemTime() so tests are
 * not sensitive to the clock on the CI machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Fixed clock ──────────────────────────────────────────────────────────────
// "today" = 2027-06-15   (checkin+2d cutoff = 2027-06-17)

const FIXED_NOW = new Date('2027-06-15T10:00:00.000Z');

// ─── Supabase mock ─────────────────────────────────────────────────────────────
// Extended vs phase2.test.ts: adds `update()` and `lte()` (needed by stay-flow).

const upsertedRows: Record<string, unknown[]>  = {};
const updatedRows:  Record<string, unknown[]>  = {};
const selectRows:   Record<string, unknown[]>  = {};

type Op = 'eq' | 'lte';

type QueryBuilder = {
  select:      (cols?: string) => QueryBuilder;
  eq:          (col: string, val: unknown) => QueryBuilder;
  lte:         (col: string, val: unknown) => QueryBuilder;
  order:       (col: string, opts?: unknown) => QueryBuilder;
  limit:       (n: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  single:      () => Promise<{ data: unknown; error: null | { message: string } }>;
  then:        (cb: (v: unknown) => unknown) => unknown;
};

type UpdateBuilder = {
  eq: (col: string, val: unknown) => UpdateBuilder;
  then: (cb: (v: unknown) => unknown) => unknown;
};

function makeTableProxy(table: string) {
  const rows = () => selectRows[table] ?? [];

  const buildQuery = (filters: Array<{ col: string; val: unknown; op: Op }>): QueryBuilder => {
    const applyFilters = () =>
      rows().filter(row => {
        const r = row as Record<string, unknown>;
        return filters.every(f => {
          if (f.op === 'eq')  return r[f.col] == f.val;
          if (f.op === 'lte') return String(r[f.col]) <= String(f.val);
          return true;
        });
      });

    const q: QueryBuilder = {
      select:  () => q,
      eq:      (col, val) => buildQuery([...filters, { col, val, op: 'eq' }]),
      lte:     (col, val) => buildQuery([...filters, { col, val, op: 'lte' }]),
      order:   () => q,
      limit:   () => q,
      maybeSingle: async () => {
        const found = applyFilters();
        return { data: found[0] ?? null, error: null };
      },
      single: async () => {
        const found = applyFilters();
        return found[0]
          ? { data: found[0], error: null }
          : { data: null, error: { message: 'not found' } };
      },
      then: (cb) => cb({ data: applyFilters(), error: null }),
    };
    return q;
  };

  const buildUpdateChain = (payload: unknown, filters: Array<{ col: string; val: unknown }>): UpdateBuilder => {
    const chain: UpdateBuilder = {
      eq: (col, val) => buildUpdateChain(payload, [...filters, { col, val }]),
      then: (cb) => {
        (updatedRows[table] ??= []).push({ payload, filters });
        return cb({ error: null });
      },
    };
    return chain;
  };

  return {
    upsert: async (row: unknown, _opts?: unknown) => {
      (upsertedRows[table] ??= []).push(row);
      return { error: null };
    },
    insert: async (row: unknown) => {
      (upsertedRows[table] ??= []).push(row);
      return { error: null };
    },
    update: (payload: unknown) => buildUpdateChain(payload, []),
    select: (_cols?: string) => buildQuery([]),
  };
}

function makeSupabaseMock() {
  return { from: (table: string) => makeTableProxy(table) };
}

vi.mock('@/lib/supabase', () => ({ supabase: makeSupabaseMock() }));

// ─── Telegram mock ─────────────────────────────────────────────────────────────

const mockReplyToTelegram = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram:     (...args: unknown[]) => mockReplyToTelegram(...args),
  sendTelegramMessage: vi.fn().mockResolvedValue(true),
}));

// ─── Knowledge mock ───────────────────────────────────────────────────────────

vi.mock('../knowledge', () => ({
  getGroundedKnowledge: async (_propertyId?: string) => ({
    universalPolicy:     'Be helpful.',
    checkInInstructions: 'Key is under the mat.',
    checkOutInstructions:'Leave the key on the table.',
    wifiInstructions:    'Network: TestWifi / Pass: 12345',
    houseRules:          'No parties.',
    parkingInstructions: 'Street parking.',
    paymentRules:        'Pay on arrival.',
    emergencyContacts:   '+7 000 000 0000',
    upsells:             'Late checkout 500 RUB.',
  }),
}));

// ─── Timeline mock ────────────────────────────────────────────────────────────

vi.mock('../timeline', () => ({
  appendTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import under test ────────────────────────────────────────────────────────

import {
  StayFlowStatus,
  upsertStayFlow,
  getStayFlowByChatId,
  getStayFlowByReservationId,
  getDuePreCheckinFlows,
  getStalePreCheckinFlows,
  getDueCheckoutFlows,
  getDueFollowupFlows,
  advancePreCheckin,
  advanceToInStay,
  advanceCheckout,
  advanceFollowup,
  transitionFlowOnEscalation,
  transitionFlowOnGuestReply,
  type StayFlow,
} from '../stay-flow';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetAll() {
  for (const key of Object.keys(upsertedRows))  delete upsertedRows[key];
  for (const key of Object.keys(updatedRows))   delete updatedRows[key];
  for (const key of Object.keys(selectRows))    delete selectRows[key];
  mockReplyToTelegram.mockClear();
}

const BASE_FLOW: StayFlow = {
  id:            'flow-uuid-1',
  reservationId: 'res-001',
  chatId:        42000,
  guestId:       'tg_42000',
  propertyId:    'prop_A',
  flowStatus:    StayFlowStatus.ReservationLinked,
  checkinDate:   '2027-06-17',
  checkoutDate:  '2027-06-20',
  preCheckinSentAt:  undefined,
  checkoutSentAt:    undefined,
  followupSentAt:    undefined,
  createdAt: new Date('2027-06-10T00:00:00Z'),
  updatedAt: new Date('2027-06-10T00:00:00Z'),
};

// Row shape used for selectRows (snake_case as returned from Supabase)
function flowRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id:                  BASE_FLOW.id,
    reservation_id:      BASE_FLOW.reservationId,
    chat_id:             BASE_FLOW.chatId,
    guest_id:            BASE_FLOW.guestId,
    property_id:         BASE_FLOW.propertyId,
    flow_status:         BASE_FLOW.flowStatus,
    checkin_date:        BASE_FLOW.checkinDate,
    checkout_date:       BASE_FLOW.checkoutDate,
    pre_checkin_sent_at: null,
    checkout_sent_at:    null,
    followup_sent_at:    null,
    created_at:          BASE_FLOW.createdAt.toISOString(),
    updated_at:          BASE_FLOW.updatedAt.toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetAll();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('upsertStayFlow', () => {
  it('pushes a row to tg_stay_flows on first call', async () => {
    // After upsert the function does a select — seed selectRows so it finds the row
    selectRows['tg_stay_flows'] = [flowRow()];

    const result = await upsertStayFlow({
      reservationId: 'res-001',
      chatId:        42000,
      guestId:       'tg_42000',
      propertyId:    'prop_A',
      checkinDate:   '2027-06-17',
      checkoutDate:  '2027-06-20',
    });

    const upserted = upsertedRows['tg_stay_flows'] ?? [];
    expect(upserted).toHaveLength(1);
    const row = upserted[0] as Record<string, unknown>;
    expect(row.reservation_id).toBe('res-001');
    expect(row.chat_id).toBe(42000);
    expect(result).not.toBeNull();
    expect(result?.flowStatus).toBe(StayFlowStatus.ReservationLinked);
  });

  it('returns null gracefully when Supabase row not found post-upsert', async () => {
    // selectRows left empty → getStayFlowByReservationId returns null
    const result = await upsertStayFlow({ reservationId: 'res-404' });
    expect(result).toBeNull();
    expect(upsertedRows['tg_stay_flows']).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStayFlowByChatId', () => {
  it('returns flow when present and active', async () => {
    selectRows['tg_stay_flows'] = [flowRow()];
    const flow = await getStayFlowByChatId(42000);
    expect(flow).not.toBeNull();
    expect(flow?.chatId).toBe(42000);
  });

  it('returns null when flow status is closed', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.Closed })];
    const flow = await getStayFlowByChatId(42000);
    expect(flow).toBeNull();
  });

  it('returns null when flow status is followup_sent', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.FollowupSent })];
    const flow = await getStayFlowByChatId(42000);
    expect(flow).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getDuePreCheckinFlows', () => {
  it('returns flows with reservation_linked status where checkin ≤ cutoff', async () => {
    // today = 2027-06-15, cutoff = 2027-06-17
    selectRows['tg_stay_flows'] = [
      flowRow({ checkin_date: '2027-06-17', flow_status: StayFlowStatus.ReservationLinked }),
      flowRow({ id: 'flow-2', checkin_date: '2027-06-18', flow_status: StayFlowStatus.ReservationLinked }), // future
      flowRow({ id: 'flow-3', checkin_date: '2027-06-17', flow_status: StayFlowStatus.PreCheckinSent }),    // wrong status
    ];
    const flows = await getDuePreCheckinFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0].id).toBe('flow-uuid-1');
  });

  it('excludes flows with no chat_id', async () => {
    selectRows['tg_stay_flows'] = [
      flowRow({ chat_id: null }),
    ];
    const flows = await getDuePreCheckinFlows();
    expect(flows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getDueCheckoutFlows', () => {
  it('returns in_stay flows where checkout ≤ today', async () => {
    selectRows['tg_stay_flows'] = [
      flowRow({ flow_status: StayFlowStatus.InStay, checkout_date: '2027-06-15' }), // due
      flowRow({ id: 'flow-2', flow_status: StayFlowStatus.InStay, checkout_date: '2027-06-16' }), // tomorrow
    ];
    const flows = await getDueCheckoutFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0].checkoutDate).toBe('2027-06-15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getDueFollowupFlows', () => {
  it('returns checkout_sent flows where checkout+1d ≤ today (yesterday)', async () => {
    // today = 2027-06-15   ⇒ yesterday cutoff = 2027-06-14
    selectRows['tg_stay_flows'] = [
      flowRow({ flow_status: StayFlowStatus.CheckoutSent, checkout_date: '2027-06-14' }), // due
      flowRow({ id: 'flow-2', flow_status: StayFlowStatus.CheckoutSent, checkout_date: '2027-06-15' }), // checkout today, followup tomorrow
    ];
    const flows = await getDueFollowupFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0].checkoutDate).toBe('2027-06-14');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('advancePreCheckin', () => {
  it('sends message, sets status to pre_checkin_sent', async () => {
    const flow = { ...BASE_FLOW, flowStatus: StayFlowStatus.ReservationLinked };
    // Seed reservation row so loadReservationById resolves
    selectRows['tg_guest_reservations'] = [{
      id: flow.reservationId, guest_name: 'Alice', check_in: '2027-06-17', check_out: '2027-06-20', property_id: 'prop_A',
    }];

    await advancePreCheckin(flow);

    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    const [chatArg, textArg] = mockReplyToTelegram.mock.calls[0];
    expect(chatArg).toBe(42000);
    expect(textArg).toContain('Alice');
    expect(textArg).toContain('Key is under the mat.');

    const upd = updatedRows['tg_stay_flows'] ?? [];
    expect(upd).toHaveLength(1);
    const { payload } = upd[0] as { payload: Record<string, unknown>; filters: unknown[] };
    expect(payload.flow_status).toBe(StayFlowStatus.PreCheckinSent);
    expect(payload.pre_checkin_sent_at).toBeTruthy();
  });

  it('is idempotent — skips if preCheckinSentAt already set', async () => {
    const flow = { ...BASE_FLOW, preCheckinSentAt: new Date('2027-06-14T08:00:00Z') };

    await advancePreCheckin(flow);

    expect(mockReplyToTelegram).not.toHaveBeenCalled();
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('does not update status when message delivery fails', async () => {
    mockReplyToTelegram.mockResolvedValueOnce(false);
    const flow = { ...BASE_FLOW };

    await advancePreCheckin(flow);

    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('advanceToInStay', () => {
  it('updates status to in_stay without sending a message', async () => {
    const flow = { ...BASE_FLOW, flowStatus: StayFlowStatus.PreCheckinSent };

    await advanceToInStay(flow);

    expect(mockReplyToTelegram).not.toHaveBeenCalled();
    const upd = updatedRows['tg_stay_flows'] ?? [];
    expect(upd).toHaveLength(1);
    const { payload } = upd[0] as { payload: Record<string, unknown>; filters: unknown[] };
    expect(payload.flow_status).toBe(StayFlowStatus.InStay);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('advanceCheckout', () => {
  it('sends checkout message, sets status to checkout_sent', async () => {
    const flow = { ...BASE_FLOW, flowStatus: StayFlowStatus.InStay };
    selectRows['tg_guest_reservations'] = [{
      id: flow.reservationId, guest_name: 'Bob', check_in: '2027-06-13', check_out: '2027-06-15', property_id: 'prop_A',
    }];

    await advanceCheckout(flow);

    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    const [, textArg] = mockReplyToTelegram.mock.calls[0];
    expect(textArg).toContain('Bob');
    expect(textArg).toContain('Leave the key on the table.');

    const upd = updatedRows['tg_stay_flows'] ?? [];
    expect(upd).toHaveLength(1);
    const { payload } = upd[0] as { payload: Record<string, unknown> };
    expect(payload.flow_status).toBe(StayFlowStatus.CheckoutSent);
    expect(payload.checkout_sent_at).toBeTruthy();
  });

  it('is idempotent — skips if checkoutSentAt already set', async () => {
    const flow = { ...BASE_FLOW, checkoutSentAt: new Date('2027-06-15T06:00:00Z') };

    await advanceCheckout(flow);

    expect(mockReplyToTelegram).not.toHaveBeenCalled();
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('advanceFollowup', () => {
  it('sends followup message, sets status to followup_sent', async () => {
    const flow = { ...BASE_FLOW, flowStatus: StayFlowStatus.CheckoutSent };
    selectRows['tg_guest_reservations'] = [{
      id: flow.reservationId, guest_name: 'Carol', check_in: '2027-06-12', check_out: '2027-06-14', property_id: 'prop_A',
    }];

    await advanceFollowup(flow);

    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    const [, textArg] = mockReplyToTelegram.mock.calls[0];
    expect(textArg).toContain('Carol');
    expect(textArg).toContain('review');

    const upd = updatedRows['tg_stay_flows'] ?? [];
    const { payload } = upd[0] as { payload: Record<string, unknown> };
    expect(payload.flow_status).toBe(StayFlowStatus.FollowupSent);
    expect(payload.followup_sent_at).toBeTruthy();
  });

  it('is idempotent — skips if followupSentAt already set', async () => {
    const flow = { ...BASE_FLOW, followupSentAt: new Date('2027-06-15T06:00:00Z') };

    await advanceFollowup(flow);

    expect(mockReplyToTelegram).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('transitionFlowOnEscalation', () => {
  it('sets flow status to escalated', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.PreCheckinSent })];

    await transitionFlowOnEscalation(42000);

    const upd = updatedRows['tg_stay_flows'] ?? [];
    expect(upd).toHaveLength(1);
    const { payload } = upd[0] as { payload: Record<string, unknown> };
    expect(payload.flow_status).toBe(StayFlowStatus.Escalated);
  });

  it('does not transition when flow is already followup_sent', async () => {
    // getStayFlowByChatId returns null for followup_sent/closed
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.FollowupSent })];

    await transitionFlowOnEscalation(42000);

    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('does not transition when flow is already escalated', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.Escalated })];

    await transitionFlowOnEscalation(42000);

    // Escalated is not in activeStates list → no update
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('does nothing when no flow exists for chatId', async () => {
    // selectRows empty
    await transitionFlowOnEscalation(99999);
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('transitionFlowOnGuestReply', () => {
  it('advances pre_checkin_sent → in_stay for a benign category', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.PreCheckinSent })];

    await transitionFlowOnGuestReply(42000, 'general_question');

    const upd = updatedRows['tg_stay_flows'] ?? [];
    expect(upd).toHaveLength(1);
    const { payload } = upd[0] as { payload: Record<string, unknown> };
    expect(payload.flow_status).toBe(StayFlowStatus.InStay);
  });

  it('does NOT advance for "issue" category (orchestrator handles escalation)', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.PreCheckinSent })];

    await transitionFlowOnGuestReply(42000, 'issue');

    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('does not advance when flow is not in pre_checkin_sent state', async () => {
    selectRows['tg_stay_flows'] = [flowRow({ flow_status: StayFlowStatus.InStay })];

    await transitionFlowOnGuestReply(42000, 'general_question');

    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('does nothing when no active flow exists', async () => {
    await transitionFlowOnGuestReply(99999, 'general_question');
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStalePreCheckinFlows', () => {
  it('returns pre_checkin_sent flows where checkin_date ≤ today', async () => {
    selectRows['tg_stay_flows'] = [
      flowRow({ flow_status: StayFlowStatus.PreCheckinSent, checkin_date: '2027-06-15' }), // today → stale
      flowRow({ id: 'f2', flow_status: StayFlowStatus.PreCheckinSent, checkin_date: '2027-06-16' }), // tomorrow
    ];
    const flows = await getStalePreCheckinFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0].checkinDate).toBe('2027-06-15');
  });
});
