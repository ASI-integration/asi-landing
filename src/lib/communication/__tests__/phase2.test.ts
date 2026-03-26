/**
 * Phase 2 Communication Module Tests
 *
 * Covers Phase 2 hardening goals:
 *   G1 — identity persistence surviving cold start / re-instantiation
 *   G2 — real reservation lookup replacing mock behavior
 *   G3 — real property knowledge replacing single-mock behavior
 *   G5 — context continuity across multiple turns after service restart
 *   G4 — timeline persistence and reconstruction
 *   G6 — escalation record creation and operator delivery path
 *
 * Also covers:
 *   - harmless retry safety with persisted context
 *   - safe failure when reservation / property linkage is missing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { clearContext } from '../memory';
import { IntentCategory, TurnRole, EscalationReason } from '../types';

// ─── Supabase mock ─────────────────────────────────────────────────────────────

const insertedRows: Record<string, unknown[]>  = {};
const upsertedRows: Record<string, unknown[]>  = {};
const selectRows:   Record<string, unknown[]>  = {};

type QueryBuilder = {
  select:   (cols?: string) => QueryBuilder;
  eq:       (col: string, val: unknown) => QueryBuilder;
  ilike:    (col: string, val: unknown) => QueryBuilder;
  order:    (col: string, opts?: unknown) => QueryBuilder;
  limit:    (n: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null | { message: string } }>;
  single:      () => Promise<{ data: unknown; error: null | { message: string } }>;
  then: (cb: (v: unknown) => unknown) => unknown;
};

function makeTableProxy(table: string): {
  insert:     (row: unknown) => Promise<{ error: null }>;
  upsert:     (row: unknown, opts?: unknown) => Promise<{ error: null }>;
  select:     (cols?: string) => QueryBuilder;
} {
  const rows = () => selectRows[table] ?? [];

  // Tracks the active filter state per query chain.
  const buildQuery = (filters: Array<{ col: string; val: unknown; op: 'eq' | 'ilike' }>): QueryBuilder => {
    const applyFilters = () =>
      rows().filter(row => {
        const r = row as Record<string, unknown>;
        return filters.every(f => {
          if (f.op === 'eq')    return r[f.col] == f.val;
          if (f.op === 'ilike') return String(r[f.col]).toLowerCase() === String(f.val).toLowerCase();
          return true;
        });
      });

    const q: QueryBuilder = {
      select:  () => q,
      eq:      (col, val)  => buildQuery([...filters, { col, val, op: 'eq' }]),
      ilike:   (col, val)  => buildQuery([...filters, { col, val, op: 'ilike' }]),
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

  return {
    insert: async (row: unknown) => {
      (insertedRows[table] ??= []).push(row);
      return { error: null };
    },
    upsert: async (row: unknown) => {
      (upsertedRows[table] ??= []).push(row);
      return { error: null };
    },
    select: (_cols?: string) => buildQuery([]),
  };
}

function makeSupabaseMock() {
  return {
    from: (table: string) => makeTableProxy(table),
  };
}

vi.mock('@/lib/supabase', () => ({ supabase: makeSupabaseMock() }));

// ─── Other mocks ───────────────────────────────────────────────────────────────

const mockSendTelegram = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegram(...args),
  replyToTelegram:     vi.fn().mockResolvedValue(true),
}));

// ─── Import under test ────────────────────────────────────────────────────────
// Imports happen after mocks are registered

import {
  resolveGuestIdentity,
  createOrMergeIdentity,
} from '../identity';
import {
  loadContextFromDB,
  persistContext,
  getContext,
  updateContext,
  clearContext as clearMemoryContext,
} from '../memory';
import { matchReservation } from '../reservation';
import { getGroundedKnowledge } from '../knowledge';
import { appendTimelineEvent } from '../timeline';
import { notifyOperatorEscalation, createEscalationEvent } from '../escalation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetAll() {
  for (const key of Object.keys(insertedRows))  delete insertedRows[key];
  for (const key of Object.keys(upsertedRows))  delete upsertedRows[key];
  for (const key of Object.keys(selectRows))    delete selectRows[key];
  _resetForTesting();
  clearContext(99);
  clearMemoryContext(99);
  mockSendTelegram.mockClear();
}

// ─── G1: Identity persistence ─────────────────────────────────────────────────

describe('G1 — identity persistence (Supabase-backed)', () => {
  beforeEach(resetAll);

  it('createOrMergeIdentity upserts to tg_guest_identities', async () => {
    const envelope = {
      channel: 'telegram' as const,
      externalUserId: '12345',
      chatId: '12345',
      messageText: 'hello',
      receivedAt: new Date(),
    };

    const identity = await createOrMergeIdentity(envelope);

    expect(identity.guestId).toBe('tg_12345');
    expect(identity.knownChatIds).toContain('12345');

    const rows = upsertedRows['tg_guest_identities'] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0] as Record<string, unknown>;
    expect(row.telegram_chat_id).toBe(12345);
    expect(row.guest_id).toBe('tg_12345');
  });

  it('resolveGuestIdentity returns null when not in DB (cold start)', async () => {
    const envelope = {
      channel: 'telegram' as const,
      externalUserId: '99999',
      chatId: '99999',
      messageText: 'hi',
      receivedAt: new Date(),
    };

    const result = await resolveGuestIdentity(envelope);
    expect(result).toBeNull();
  });

  it('resolveGuestIdentity returns existing row when found', async () => {
    selectRows['tg_guest_identities'] = [
      {
        telegram_chat_id: 55555,
        guest_id: 'tg_55555',
        phone: null,
        email: null,
        first_name: 'Alice',
      },
    ];

    const envelope = {
      channel: 'telegram' as const,
      externalUserId: '55555',
      chatId: '55555',
      messageText: 'hello',
      receivedAt: new Date(),
    };

    const result = await resolveGuestIdentity(envelope);
    expect(result).not.toBeNull();
    expect(result!.guestId).toBe('tg_55555');
    expect(result!.firstName).toBe('Alice');
  });

  it('repeated createOrMergeIdentity for same chatId does not create new guest_id', async () => {
    // Seed existing row so resolveGuestIdentity finds it
    selectRows['tg_guest_identities'] = [
      { telegram_chat_id: 77777, guest_id: 'tg_77777', phone: null, email: null },
    ];

    const envelope = {
      channel: 'telegram' as const,
      externalUserId: '77777',
      chatId: '77777',
      messageText: 'second message',
      receivedAt: new Date(),
    };

    const first = await createOrMergeIdentity(envelope);
    const second = await createOrMergeIdentity(envelope);
    expect(first.guestId).toBe(second.guestId);
  });
});

// ─── G5: Context persistence / continuity ────────────────────────────────────

describe('G5 — context persistence / cold-start continuity', () => {
  beforeEach(resetAll);

  it('persistContext writes context to tg_conversation_context', async () => {
    updateContext(99, { lastIntent: IntentCategory.CheckInInfo, guestName: 'Bob' });
    await persistContext(99);

    const rows = upsertedRows['tg_conversation_context'] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0] as Record<string, unknown>;
    expect(row.chat_id).toBe(99);
    expect(row.last_intent).toBe(IntentCategory.CheckInInfo);
    expect(row.guest_name).toBe('Bob');
  });

  it('loadContextFromDB hydrates in-memory store from Supabase', async () => {
    selectRows['tg_conversation_context'] = [
      {
        chat_id: 88,
        last_intent: IntentCategory.BookingInquiry,
        guest_name: 'Carol',
        reservation_id: 'res_abc',
        booking_draft: { stayNights: 3 },
        last_message_at: '2026-03-01T10:00:00Z',
      },
    ];

    // Ensure no in-memory entry exists (simulate cold start)
    clearMemoryContext(88);

    await loadContextFromDB(88);

    const ctx = getContext(88);
    expect(ctx.lastIntent).toBe(IntentCategory.BookingInquiry);
    expect(ctx.guestName).toBe('Carol');
    expect(ctx.reservationId).toBe('res_abc');
    expect(ctx.bookingDraft).toEqual({ stayNights: 3 });
  });

  it('loadContextFromDB is no-op when already cached (warm invocation)', async () => {
    // Pre-populate in-memory store
    updateContext(77, { guestName: 'Dave' });

    // Even if DB has different data, warm cache wins
    selectRows['tg_conversation_context'] = [
      { chat_id: 77, guest_name: 'Different', last_message_at: '2026-03-01T00:00:00Z' },
    ];

    await loadContextFromDB(77);

    const ctx = getContext(77);
    expect(ctx.guestName).toBe('Dave');
  });

  it('persistContext is safe when context store is empty', async () => {
    // chatId 999 has no context yet
    await expect(persistContext(999)).resolves.not.toThrow();
  });
});

// ─── G2: Real reservation lookup ──────────────────────────────────────────────

describe('G2 — real reservation lookup', () => {
  beforeEach(resetAll);

  it('returns unmatched when no reservation data exists', async () => {
    const result = await matchReservation({ chatId: 123 });
    expect(result.status).toBe('unmatched');
    expect(result.confidence).toBe(0);
  });

  it('matches by chatId when reservation row has chat_id set', async () => {
    selectRows['tg_guest_reservations'] = [
      {
        id: 'res-uuid-1',
        chat_id: 999,
        property_id: 'prop_B',
        guest_id: 'tg_999',
        guest_name: 'Eve',
        check_in: '2026-04-01',
        check_out: '2026-04-05',
      },
    ];

    const result = await matchReservation({ chatId: 999 });
    expect(result.status).toBe('matched');
    expect(result.confidence).toBe(1.0);
    expect(result.propertyId).toBe('prop_B');
    expect(result.guestName).toBe('Eve');
  });

  it('matches by booking reference', async () => {
    selectRows['tg_guest_reservations'] = [
      {
        id: 'res-uuid-2',
        reservation_ref: 'REF-XYZ',
        property_id: 'prop_C',
        guest_id: 'tg_200',
        guest_name: 'Frank',
      },
    ];

    const result = await matchReservation({ bookingReference: 'REF-XYZ' });
    expect(result.status).toBe('matched');
    expect(result.reservationId).toBe('res-uuid-2');
  });

  it('returns ambiguous when multiple guest-name matches exist', async () => {
    selectRows['tg_guest_reservations'] = [
      { id: 'r1', guest_name: 'Jane Smith', property_id: 'prop_D' },
      { id: 'r2', guest_name: 'Jane Smith', property_id: 'prop_E' },
    ];

    const result = await matchReservation({ guestName: 'Jane Smith' });
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('returns unmatched safely when Supabase is unavailable', async () => {
    // Override supabase mock temporarily to throw
    const { supabase } = await import('@/lib/supabase');
    const origFrom = supabase.from;
    (supabase as unknown as Record<string, unknown>).from = () => { throw new Error('connection refused'); };

    const result = await matchReservation({ chatId: 1, guestName: 'Test' });
    expect(result.status).toBe('unmatched');

    // Restore
    (supabase as unknown as Record<string, unknown>).from = origFrom;
  });
});

// ─── G3: Real property knowledge lookup ──────────────────────────────────────

describe('G3 — real property knowledge lookup', () => {
  beforeEach(resetAll);

  it('returns all-unavailable fallbacks when property not in DB', async () => {
    const knowledge = await getGroundedKnowledge('unknown_prop');
    expect(knowledge.universalPolicy).toBeTruthy();
    expect(knowledge.checkInInstructions).toBe('Information unavailable.');
    expect(knowledge.houseRules).toBe('Information unavailable.');
    expect(knowledge.wifiInstructions).toBe('Information unavailable.');
  });

  it('returns real data when property row exists in DB', async () => {
    selectRows['tg_property_knowledge'] = [
      {
        property_id: 'prop_A',
        check_in_instructions: 'Code is 5678',
        check_out_instructions: 'Leave by 11am',
        wifi_instructions: 'Net: Fast, Pass: secure',
        house_rules: 'No smoking',
        property_policy: 'Quiet after 10pm',
        emergency_contacts: '555-0000',
        upsells: 'Late checkout $30',
        parking_instructions: null,
        payment_rules: null,
      },
    ];

    const knowledge = await getGroundedKnowledge('prop_A');
    expect(knowledge.checkInInstructions).toBe('Code is 5678');
    expect(knowledge.houseRules).toBe('No smoking');
    expect(knowledge.wifiInstructions).toBe('Net: Fast, Pass: secure');
    expect(knowledge.parkingInstructions).toBe('Information unavailable.');
  });

  it('returns fallbacks when propertyId is undefined', async () => {
    const knowledge = await getGroundedKnowledge(undefined);
    expect(knowledge.checkInInstructions).toBe('Information unavailable.');
  });
});

// ─── G4: Timeline persistence ─────────────────────────────────────────────────

describe('G4 — timeline persistence', () => {
  beforeEach(resetAll);

  it('appendTimelineEvent writes to tg_timeline_events', async () => {
    await appendTimelineEvent(
      'tg_99',
      { type: 'message_inbound', channel: 'telegram', content: 'hello', ts: new Date() },
      99,
    );

    const rows = insertedRows['tg_timeline_events'] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0] as Record<string, unknown>;
    expect(row.guest_id).toBe('tg_99');
    expect(row.chat_id).toBe(99);
    expect(row.event_type).toBe('message_inbound');
  });

  it('appendTimelineEvent stores escalation events', async () => {
    await appendTimelineEvent(
      'tg_99',
      { type: 'escalation', reason: 'urgent issue', ts: new Date() },
      99,
    );

    const rows = insertedRows['tg_timeline_events'] ?? [];
    const escalationRow = rows.find(
      (r: unknown) => (r as Record<string, unknown>).event_type === 'escalation',
    ) as Record<string, unknown> | undefined;
    expect(escalationRow).toBeDefined();
    expect((escalationRow!.event_data as Record<string, unknown>).reason).toBe('urgent issue');
  });

  it('appendTimelineEvent truncates long message content', async () => {
    const longContent = 'A'.repeat(1000);
    await appendTimelineEvent(
      'tg_99',
      { type: 'message_outbound', channel: 'telegram', content: longContent, ts: new Date() },
      99,
    );

    const rows = insertedRows['tg_timeline_events'] ?? [];
    const row = rows[rows.length - 1] as Record<string, unknown>;
    const content = (row.event_data as Record<string, unknown>).content as string;
    expect(content.length).toBeLessThanOrEqual(501); // 500 + '…'
  });

  it('appendTimelineEvent does not throw when Supabase is unavailable', async () => {
    const { supabase } = await import('@/lib/supabase');
    const origFrom = supabase.from;
    (supabase as unknown as Record<string, unknown>).from = () => { throw new Error('db down'); };

    await expect(
      appendTimelineEvent('tg_99', { type: 'payment_event', status: 'paid', ts: new Date() }, 99),
    ).resolves.not.toThrow();

    (supabase as unknown as Record<string, unknown>).from = origFrom;
  });
});

// ─── G6: Operator escalation delivery ────────────────────────────────────────

describe('G6 — operator escalation delivery', () => {
  beforeEach(resetAll);

  it('notifyOperatorEscalation calls sendTelegramMessage', async () => {
    const event = createEscalationEvent({
      reason:  EscalationReason.UrgentIssue,
      chat_id: 99,
      update_id: 1234,
      summary: 'urgent lock failed',
    });

    const result = await notifyOperatorEscalation(event);

    expect(result).toBe(true);
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    const msg = mockSendTelegram.mock.calls[0][0] as string;
    expect(msg).toContain('99');
    expect(msg).toContain('URGENT_ISSUE');
    expect(msg).toContain('urgent lock failed');
  });

  it('notifyOperatorEscalation returns false when sendTelegramMessage throws', async () => {
    mockSendTelegram.mockRejectedValueOnce(new Error('Telegram unavailable'));

    const event = createEscalationEvent({
      reason:  EscalationReason.LLMUncertain,
      chat_id: 88,
      summary: 'llm failed',
    });

    await expect(notifyOperatorEscalation(event)).resolves.toBe(false);
  });

  it('escalation includes category when classification is provided', async () => {
    const event = createEscalationEvent({
      reason: EscalationReason.RequiresOperator,
      chat_id: 55,
      summary: 'needs human',
      classification: {
        category: 'issue' as never,
        lang: 'en',
        slots: { isUrgent: true, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false },
      },
    });

    await notifyOperatorEscalation(event);

    const msg = mockSendTelegram.mock.calls[0][0] as string;
    expect(msg).toContain('issue');
  });
});

// ─── Retry safety ─────────────────────────────────────────────────────────────

describe('Retry safety — persisted context', () => {
  beforeEach(resetAll);

  it('repeated createOrMergeIdentity upserts safely without duplicate guest IDs', async () => {
    const envelope = {
      channel: 'telegram' as const,
      externalUserId: '333',
      chatId: '333',
      messageText: 'hi',
      receivedAt: new Date(),
    };

    await createOrMergeIdentity(envelope);
    await createOrMergeIdentity(envelope);
    await createOrMergeIdentity(envelope);

    // All calls go to upsert — no raw inserts
    const rows = upsertedRows['tg_guest_identities'] ?? [];
    const guestIds = rows.map((r: unknown) => (r as Record<string, unknown>).guest_id);
    // All upserts use the same guest_id
    expect(new Set(guestIds).size).toBe(1);
  });

  it('loadContextFromDB + persistContext round-trips safely', async () => {
    // Start fresh — no DB row
    clearMemoryContext(42);
    await loadContextFromDB(42);  // no-op — no row in DB

    updateContext(42, { guestName: 'Grace', lastIntent: IntentCategory.CheckOut });
    await persistContext(42);

    const rows = upsertedRows['tg_conversation_context'] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0] as Record<string, unknown>;
    expect(row.guest_name).toBe('Grace');

    // Simulate cold start: clear memory, load from DB
    clearMemoryContext(42);
    selectRows['tg_conversation_context'] = [
      { ...row, last_message_at: new Date().toISOString() },
    ];
    await loadContextFromDB(42);
    const ctx = getContext(42);
    expect(ctx.guestName).toBe('Grace');
  });
});
