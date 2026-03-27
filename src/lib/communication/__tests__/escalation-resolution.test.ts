/**
 * Escalation resolution unit tests.
 *
 * Strategy: isolate at the Supabase boundary.
 *   - supabase → in-memory table store (selectRows / updatedRows)
 *   - timeline  → vi.fn() (fire-and-forget, audited separately)
 *   - stay-flow → updateFlowStatus mocked through supabase mock
 *
 * Fixtures use a fixed clock via vi.setSystemTime() so date-based resume
 * logic is deterministic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Fixed clock ───────────────────────────────────────────────────────────────
// "today" = 2027-06-15
const FIXED_NOW = new Date('2027-06-15T10:00:00.000Z');

// ─── In-memory store ───────────────────────────────────────────────────────────

const selectRows:  Record<string, unknown[]> = {};
const updatedRows: Record<string, { payload: unknown; filters: { col: string; val: unknown }[] }[]> = {};
const insertedRows: Record<string, unknown[]> = {};

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
  eq:   (col: string, val: unknown) => UpdateBuilder;
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
      eq:      (col, val) => buildQuery([...filters, { col, val, op: 'eq'  }]),
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
      then: cb => cb({ data: applyFilters(), error: null }),
    };
    return q;
  };

  const buildUpdateChain = (payload: unknown, filters: Array<{ col: string; val: unknown }>): UpdateBuilder => {
    const chain: UpdateBuilder = {
      eq: (col, val) => buildUpdateChain(payload, [...filters, { col, val }]),
      then: cb => {
        (updatedRows[table] ??= []).push({ payload, filters });
        // Also reflect the update in selectRows for subsequent reads.
        const tableRows = selectRows[table] ?? [];
        for (const row of tableRows) {
          const r = row as Record<string, unknown>;
          const match = filters.every(f => r[f.col] == f.val);
          if (match) Object.assign(r, payload);
        }
        return cb({ error: null });
      },
    };
    return chain;
  };

  return {
    upsert: async (row: unknown) => {
      (insertedRows[table] ??= []).push(row);
      return { error: null };
    },
    insert: async (row: unknown) => {
      (insertedRows[table] ??= []).push(row);
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

// ─── Timeline mock ─────────────────────────────────────────────────────────────

const mockAppendTimeline = vi.fn().mockResolvedValue(undefined);
vi.mock('../timeline', () => ({ appendTimelineEvent: (...args: unknown[]) => mockAppendTimeline(...args) }));

// ─── Import under test ─────────────────────────────────────────────────────────

import {
  resolveEscalation,
  resumeStayFlow,
  VALID_RESOLUTION_ACTIONS,
} from '../escalation-resolution';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const ESCALATION_ID   = 'esc-uuid-001';
const STAY_FLOW_ID    = 'sf-uuid-001';
const CHAT_ID         = 111222333;
const RESERVATION_ID  = 'res-001';

/** Seed an unresolved escalation event. */
function seedEscalation(overrides: Partial<Record<string, unknown>> = {}) {
  selectRows['tg_escalation_events'] = [
    {
      id:          ESCALATION_ID,
      chat_id:     CHAT_ID,
      reason:      'URGENT_ISSUE',
      summary:     'Guest locked out',
      resolved_at: null,
      ...overrides,
    },
  ];
}

/** Seed a stay flow in escalated status with check-in on 2027-06-10 (past). */
function seedEscalatedFlow(overrides: Partial<Record<string, unknown>> = {}) {
  selectRows['tg_stay_flows'] = [
    {
      id:                  STAY_FLOW_ID,
      reservation_id:      RESERVATION_ID,
      chat_id:             CHAT_ID,
      guest_id:            `tg_${CHAT_ID}`,
      flow_status:         'escalated',
      checkin_date:        '2027-06-10',   // past — today is 2027-06-15
      checkout_date:       '2027-06-20',   // future
      pre_checkin_sent_at: '2027-06-08T09:00:00Z',
      created_at:          '2027-06-01T00:00:00Z',
      ...overrides,
    },
  ];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  // Clear stores.
  for (const k of Object.keys(selectRows))  delete selectRows[k];
  for (const k of Object.keys(updatedRows)) delete updatedRows[k];
  for (const k of Object.keys(insertedRows)) delete insertedRows[k];

  mockAppendTimeline.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('VALID_RESOLUTION_ACTIONS', () => {
  it('contains exactly the three expected actions', () => {
    expect(VALID_RESOLUTION_ACTIONS).toEqual([
      'resolve_and_resume',
      'resolve_only',
      'close_without_resume',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — resolve_only', () => {
  it('marks the escalation resolved without touching the stay flow', async () => {
    seedEscalation();
    seedEscalatedFlow();

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_only',
      operatorNote:      'Will call guest',
      resolvedBy:        'operator@example.com',
    });

    expect(result.ok).toBe(true);
    expect(result.escalationEventId).toBe(ESCALATION_ID);
    expect(result.alreadyResolved).toBeUndefined();
    expect(result.resumedStatus).toBeUndefined();

    // tg_escalation_events updated with resolution metadata.
    const escUpdates = updatedRows['tg_escalation_events'] ?? [];
    expect(escUpdates).toHaveLength(1);
    const upd = escUpdates[0].payload as Record<string, unknown>;
    expect(upd.resolution_action).toBe('resolve_only');
    expect(upd.operator_note).toBe('Will call guest');
    expect(upd.resolved_by).toBe('operator@example.com');
    expect(upd.resolved_at).toBeTruthy();

    // Stay flow NOT updated.
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('writes escalation_resolved timeline event', async () => {
    seedEscalation();
    seedEscalatedFlow();

    await resolveEscalation({ escalationEventId: ESCALATION_ID, action: 'resolve_only' });

    expect(mockAppendTimeline).toHaveBeenCalledWith(
      expect.stringContaining('tg_'),
      expect.objectContaining({ type: 'escalation_resolved', action: 'resolve_only' }),
      expect.anything(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — resolve_and_resume', () => {
  it('marks escalation resolved and resumes flow to in_stay (checkin past, checkout future)', async () => {
    seedEscalation();
    seedEscalatedFlow(); // checkin 2027-06-10, today 2027-06-15

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('in_stay');

    // Stay flow updated to in_stay.
    const sfUpdates = updatedRows['tg_stay_flows'] ?? [];
    expect(sfUpdates).toHaveLength(1);
    const sfPayload = sfUpdates[0].payload as Record<string, unknown>;
    expect(sfPayload.flow_status).toBe('in_stay');
  });

  it('resumes to pre_checkin_sent when checkin is in the future and message was sent', async () => {
    seedEscalation();
    seedEscalatedFlow({
      checkin_date:        '2027-06-20',   // future
      pre_checkin_sent_at: '2027-06-13T09:00:00Z',
    });

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('pre_checkin_sent');
  });

  it('resumes to reservation_linked when checkin is future and no message sent', async () => {
    seedEscalation();
    seedEscalatedFlow({
      checkin_date:        '2027-06-20',
      pre_checkin_sent_at: null,
    });

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('reservation_linked');
  });

  it('resumes to in_stay when there are no dates', async () => {
    seedEscalation();
    seedEscalatedFlow({ checkin_date: null, checkout_date: null, pre_checkin_sent_at: null });

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('reservation_linked'); // no checkin_date → reservation_linked
  });

  it('writes escalation_resolved AND escalation_resumed timeline events', async () => {
    seedEscalation();
    seedEscalatedFlow();

    await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    const calls = mockAppendTimeline.mock.calls.map(c => (c[1] as { type: string }).type);
    expect(calls).toContain('escalation_resumed');
    expect(calls).toContain('escalation_resolved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — close_without_resume', () => {
  it('marks escalation resolved and closes the stay flow', async () => {
    seedEscalation();
    seedEscalatedFlow();

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'close_without_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('closed');

    const sfUpdates = updatedRows['tg_stay_flows'] ?? [];
    expect(sfUpdates).toHaveLength(1);
    expect((sfUpdates[0].payload as Record<string, unknown>).flow_status).toBe('closed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — idempotency', () => {
  it('returns alreadyResolved=true on second call without duplicate side effects', async () => {
    seedEscalation({ resolved_at: '2027-06-15T08:00:00Z' }); // already resolved
    seedEscalatedFlow();

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyResolved).toBe(true);

    // No DB writes.
    expect(updatedRows['tg_escalation_events'] ?? []).toHaveLength(0);
    expect(updatedRows['tg_stay_flows']         ?? []).toHaveLength(0);
    expect(mockAppendTimeline).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — lookup by chatId (no event id)', () => {
  it('resolves the most recent escalation for the chat', async () => {
    seedEscalation(); // no escalationEventId provided in the call
    seedEscalatedFlow();

    const result = await resolveEscalation({
      chatId: CHAT_ID,
      action: 'resolve_only',
    });

    expect(result.ok).toBe(true);
    expect(result.escalationEventId).toBe(ESCALATION_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — error cases', () => {
  it('returns error when escalation event not found', async () => {
    // Empty store — nothing to find.
    const result = await resolveEscalation({
      escalationEventId: 'nonexistent-id',
      action:            'resolve_only',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('does not require a stay flow to exist — resolve_only still succeeds', async () => {
    seedEscalation();
    // No stay flow seeded.

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_only',
    });

    expect(result.ok).toBe(true);
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
  });

  it('resolve_and_resume with no stay flow still marks escalation resolved', async () => {
    seedEscalation();
    // No stay flow — resumedStatus should be undefined but escalation is resolved.

    const result = await resolveEscalation({
      escalationEventId: ESCALATION_ID,
      chatId:            CHAT_ID,
      action:            'resolve_and_resume',
    });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBeUndefined();
    expect(updatedRows['tg_escalation_events']).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// resumeStayFlow
// ═════════════════════════════════════════════════════════════════════════════

describe('resumeStayFlow — escalated flow (checkin past)', () => {
  it('advances flow to in_stay and writes timeline event', async () => {
    seedEscalatedFlow(); // checkin 2027-06-10, today 2027-06-15

    const result = await resumeStayFlow({ chatId: CHAT_ID });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('in_stay');
    expect(result.alreadyResumed).toBeUndefined();

    const sfUpdates = updatedRows['tg_stay_flows'] ?? [];
    expect(sfUpdates).toHaveLength(1);
    expect((sfUpdates[0].payload as Record<string, unknown>).flow_status).toBe('in_stay');
  });

  it('writes escalation_resumed timeline event', async () => {
    seedEscalatedFlow();

    await resumeStayFlow({ chatId: CHAT_ID, resumedBy: 'ops@example.com' });

    expect(mockAppendTimeline).toHaveBeenCalledWith(
      expect.stringContaining('tg_'),
      expect.objectContaining({ type: 'escalation_resumed', action: 'resume_stay_flow' }),
      CHAT_ID,
    );
  });
});

describe('resumeStayFlow — escalated flow (checkin future, message sent)', () => {
  it('resumes to pre_checkin_sent', async () => {
    seedEscalatedFlow({ checkin_date: '2027-06-20', pre_checkin_sent_at: '2027-06-13T09:00:00Z' });

    const result = await resumeStayFlow({ chatId: CHAT_ID });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('pre_checkin_sent');
  });
});

describe('resumeStayFlow — escalated flow (checkin future, no message sent)', () => {
  it('resumes to reservation_linked', async () => {
    seedEscalatedFlow({ checkin_date: '2027-06-20', pre_checkin_sent_at: null });

    const result = await resumeStayFlow({ chatId: CHAT_ID });

    expect(result.ok).toBe(true);
    expect(result.resumedStatus).toBe('reservation_linked');
  });
});

describe('resumeStayFlow — idempotency: flow not in escalated state', () => {
  it('returns alreadyResumed=true when flow is in_stay, no DB writes', async () => {
    seedEscalatedFlow({ flow_status: 'in_stay' });

    const result = await resumeStayFlow({ chatId: CHAT_ID });

    expect(result.ok).toBe(true);
    expect(result.alreadyResumed).toBe(true);
    expect(result.currentStatus).toBe('in_stay');
    expect(updatedRows['tg_stay_flows'] ?? []).toHaveLength(0);
    expect(mockAppendTimeline).not.toHaveBeenCalled();
  });

  it('returns alreadyResumed=true when flow is closed', async () => {
    seedEscalatedFlow({ flow_status: 'closed' });

    const result = await resumeStayFlow({ chatId: CHAT_ID });

    expect(result.ok).toBe(true);
    expect(result.alreadyResumed).toBe(true);
    expect(result.currentStatus).toBe('closed');
  });
});

describe('resumeStayFlow — error cases', () => {
  it('returns error when no flow exists for chat_id', async () => {
    // empty store

    const result = await resumeStayFlow({ chatId: CHAT_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no stay flow/i);
  });

  it('escalation_events are NOT touched — only the flow is advanced', async () => {
    seedEscalation({ resolved_at: '2027-06-15T08:00:00Z' }); // resolved escalation present
    seedEscalatedFlow();

    await resumeStayFlow({ chatId: CHAT_ID });

    // No writes to escalation table.
    expect(updatedRows['tg_escalation_events'] ?? []).toHaveLength(0);
    // Flow IS updated.
    expect(updatedRows['tg_stay_flows']).toHaveLength(1);
  });
});
