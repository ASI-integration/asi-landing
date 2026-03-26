/**
 * Communication Module Hardening Tests
 *
 * Covers the gaps addressed in the feat/comms-module-hardening task:
 *   G1 — Recent history loaded into context (conversation continuity)
 *   G3 — Session linked to reservation on match
 *   G4 — Outbound delivery failures persisted
 *   G5 — Escalation events persisted to DB
 *   G6 — Durable idempotency (cross-restart safety)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, TelegramUpdate, IntentCategory, TurnRole } from '../types';
import { clearContext } from '../memory';

// ─── Supabase mock — tracks calls per table ───────────────────────────────────

const insertedRows: Record<string, unknown[]> = {};
const upsertedRows: Record<string, unknown[]> = {};

// Rows available via SELECT (keyed by table)
const selectRows: Record<string, unknown[]> = {
  tg_message_turns: [],
  tg_processed_updates: [],
};

function makeSupabaseMock() {
  return {
    from: (table: string) => ({
      upsert: async (row: unknown) => {
        (upsertedRows[table] ??= []).push(row);
        return { error: null };
      },
      insert: async (row: unknown) => {
        (insertedRows[table] ??= []).push(row);
        return { error: null };
      },
      select: (_cols?: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: async () => ({ data: null, error: { message: 'not found' } }),
          maybeSingle: async () => {
            // For tg_processed_updates: return row if it exists
            if (table === 'tg_processed_updates') {
              const found = (selectRows[table] ?? []).find(
                (r: unknown) => (r as { update_id: number }).update_id === _val,
              );
              return { data: found ?? null, error: null };
            }
            return { data: null, error: null };
          },
          order: (_col2: string, _opts?: unknown) => ({
            limit: (_n: number) => ({
              single: async () => ({ data: null, error: { message: 'not found' } }),
              // For loadRecentTurns — return seeded rows
              then: (cb: (v: unknown) => unknown) =>
                cb({ data: selectRows[table] ?? [], error: null }),
            }),
          }),
          limit: (_n: number) => ({
            then: (cb: (v: unknown) => unknown) =>
              cb({ data: selectRows[table] ?? [], error: null }),
          }),
        }),
        order: (_col: string, _opts?: unknown) => ({
          limit: (_n: number) => ({
            then: (cb: (v: unknown) => unknown) =>
              cb({ data: selectRows[table] ?? [], error: null }),
          }),
        }),
      }),
      update: (_data: unknown) => ({
        eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
      }),
    }),
  };
}

vi.mock('@/lib/supabase', () => ({ supabase: makeSupabaseMock() }));

// ─── Other mocks ──────────────────────────────────────────────────────────────

const mockReply = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReply(...args),
}));

const mockLLM = vi.fn().mockResolvedValue('LLM reply');
vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mockLLM(...args),
}));

const mockDetectIntent = vi.fn().mockResolvedValue({
  intent: IntentCategory.GeneralQuestion,
  confidence: 0.9,
});
vi.mock('../intent', () => ({
  detectIntent: (...args: unknown[]) => mockDetectIntent(...args),
}));

const mockCreatePaymentRequest = vi.fn().mockResolvedValue({
  id: 'pay_x',
  provider: 'stripe',
  providerTransactionId: 'cs_x',
  status: 'pending',
  amount: 100,
  currency: 'USD',
  paymentUrl: 'https://pay.test/x',
  createdAt: new Date(),
  updatedAt: new Date(),
});
vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: (...args: unknown[]) => mockCreatePaymentRequest(...args),
}));

const mockMatchReservation = vi.fn().mockResolvedValue({
  status: 'matched',
  confidence: 1.0,
  propertyId: 'prop_A',
  guestId: 'guest_alpha',
  guestName: 'Test Guest',
  reservationId: 'res_test',
});
vi.mock('../reservation', () => ({
  matchReservation: (...args: unknown[]) => mockMatchReservation(...args),
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { processUpdate } from '../orchestrator';
import {
  loadRecentTurns,
  saveEscalationEvent,
  saveOutboundFailure,
  linkSessionToReservation,
} from '../persistence';
import { checkAndMark, checkDurableDuplicate, markDurable, _storeSize } from '../idempotency';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let nextUpdateId = 2000;
function makeUpdate(text: string): TelegramUpdate {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      chat: { id: 99 },
      from: { language_code: 'en' },
      text,
    },
  };
}

function resetMocks() {
  _resetForTesting();
  clearContext(99);
  mockReply.mockClear();
  mockReply.mockResolvedValue(true);
  mockLLM.mockClear();
  mockLLM.mockResolvedValue('LLM reply');
  mockDetectIntent.mockClear();
  mockDetectIntent.mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
  mockMatchReservation.mockClear();
  mockMatchReservation.mockResolvedValue({
    status: 'matched',
    confidence: 1.0,
    propertyId: 'prop_A',
    guestId: 'guest_alpha',
    guestName: 'Test Guest',
    reservationId: 'res_test',
  });
  for (const key of Object.keys(insertedRows)) delete insertedRows[key];
  for (const key of Object.keys(upsertedRows)) delete upsertedRows[key];
  selectRows['tg_message_turns'] = [];
  selectRows['tg_processed_updates'] = [];
}

// ─── G1: Conversation continuity ─────────────────────────────────────────────

describe('G1 — recent turns loaded into context', () => {
  beforeEach(resetMocks);

  it('loadRecentTurns returns empty array when no turns exist', async () => {
    const turns = await loadRecentTurns(99);
    expect(turns).toEqual([]);
  });

  it('loadRecentTurns returns seeded turns in oldest→newest order', async () => {
    // Supabase ORDER BY created_at DESC returns newest first — seed that way so
    // the mock matches real DB behaviour; loadRecentTurns then reverses to oldest→newest.
    selectRows['tg_message_turns'] = [
      {
        chat_id: 99,
        role: TurnRole.Assistant,
        content: 'first reply',
        created_at: '2026-01-01T10:00:01Z',
      },
      {
        chat_id: 99,
        role: TurnRole.User,
        content: 'first message',
        created_at: '2026-01-01T10:00:00Z',
      },
    ];

    const turns = await loadRecentTurns(99, 10);
    expect(turns.length).toBe(2);
    // After reverse: oldest first
    expect(turns[0].content).toBe('first message');
    expect(turns[1].content).toBe('first reply');
  });

  it('processUpdate results in Replied even when turn history load is empty', async () => {
    const result = await processUpdate(makeUpdate('hello'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
  });
});

// ─── G5: Escalation persistence ──────────────────────────────────────────────

describe('G5 — escalation events persisted', () => {
  beforeEach(resetMocks);

  it('saveEscalationEvent inserts into tg_escalation_events', async () => {
    await saveEscalationEvent({
      reason: 'URGENT_ISSUE' as never,
      chat_id: 99,
      update_id: 1234,
      summary: 'urgent lock issue',
      created_at: new Date().toISOString(),
    });

    expect(insertedRows['tg_escalation_events']).toHaveLength(1);
    const row = insertedRows['tg_escalation_events'][0] as Record<string, unknown>;
    expect(row.chat_id).toBe(99);
    expect(row.reason).toBe('URGENT_ISSUE');
    expect(row.summary).toBe('urgent lock issue');
  });

  it('processUpdate persists escalation when urgent issue detected', async () => {
    // "urgent lock failed access" triggers UrgentIssue escalation via slots
    const result = await processUpdate(makeUpdate('urgent lock failed access'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation).toBeDefined();
    // Escalation row should have been inserted (fire-and-forget, so we check asynchronously)
    // Allow microtasks to flush
    await new Promise(resolve => setTimeout(resolve, 0));
    const escalationRows = insertedRows['tg_escalation_events'] ?? [];
    expect(escalationRows.length).toBeGreaterThan(0);
  });

  it('processUpdate persists escalation when LLM fails on guest message', async () => {
    mockLLM.mockResolvedValueOnce(null);
    const result = await processUpdate(makeUpdate('wifi password please'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    await new Promise(resolve => setTimeout(resolve, 0));
    const escalationRows = insertedRows['tg_escalation_events'] ?? [];
    expect(escalationRows.length).toBeGreaterThan(0);
  });
});

// ─── G4: Outbound delivery failure persistence ───────────────────────────────

describe('G4 — outbound delivery failures persisted', () => {
  beforeEach(resetMocks);

  it('saveOutboundFailure inserts into tg_outbound_failures', async () => {
    await saveOutboundFailure({
      chat_id: 99,
      update_id: 5678,
      error_detail: 'Telegram API timeout',
    });

    expect(insertedRows['tg_outbound_failures']).toHaveLength(1);
    const row = insertedRows['tg_outbound_failures'][0] as Record<string, unknown>;
    expect(row.chat_id).toBe(99);
    expect(row.error_detail).toBe('Telegram API timeout');
    expect(row.retry_count).toBe(0);
  });

  it('processUpdate returns Error and persists failure when adapter returns false', async () => {
    // TelegramAdapter.sendMessage returns false when replyToTelegram throws
    mockReply.mockRejectedValueOnce(new Error('Telegram API refused'));
    const result = await processUpdate(makeUpdate('check-in time?'));
    expect(result.outcome).toBe(ProcessOutcome.Error);
    await new Promise(resolve => setTimeout(resolve, 0));
    const failureRows = insertedRows['tg_outbound_failures'] ?? [];
    expect(failureRows.length).toBeGreaterThan(0);
  });

  it('processUpdate returns Error and persists failure when adapter throws', async () => {
    mockReply.mockRejectedValueOnce(new Error('Telegram API send failure'));
    const result = await processUpdate(makeUpdate('check-out info'));
    expect(result.outcome).toBe(ProcessOutcome.Error);
    await new Promise(resolve => setTimeout(resolve, 0));
    const failureRows = insertedRows['tg_outbound_failures'] ?? [];
    expect(failureRows.length).toBeGreaterThan(0);
  });

  it('successful send does NOT create a failure record', async () => {
    const result = await processUpdate(makeUpdate('hello'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(insertedRows['tg_outbound_failures'] ?? []).toHaveLength(0);
  });
});

// ─── G3: Session linked to reservation ───────────────────────────────────────

describe('G3 — session linked to reservation on match', () => {
  beforeEach(resetMocks);

  it('linkSessionToReservation upserts guest_id and property_id', async () => {
    await linkSessionToReservation({
      chat_id: 99,
      guest_id: 'guest_alpha',
      property_id: 'prop_A',
    });

    const rows = upsertedRows['tg_conversation_sessions'] ?? [];
    const linkRow = rows.find((r: unknown) => {
      const row = r as Record<string, unknown>;
      return row.guest_id === 'guest_alpha';
    });
    expect(linkRow).toBeDefined();
    expect((linkRow as Record<string, unknown>).property_id).toBe('prop_A');
  });

  it('processUpdate upserts guest_id/property_id when reservation is matched', async () => {
    await processUpdate(makeUpdate('hello'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const rows = upsertedRows['tg_conversation_sessions'] ?? [];
    const linkRow = rows.find((r: unknown) => {
      const row = r as Record<string, unknown>;
      return row.guest_id === 'guest_alpha';
    });
    expect(linkRow).toBeDefined();
  });

  it('does NOT upsert guest_id when reservation is unmatched', async () => {
    mockMatchReservation.mockResolvedValueOnce({ status: 'unmatched', confidence: 0 });
    await processUpdate(makeUpdate('hello'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const rows = upsertedRows['tg_conversation_sessions'] ?? [];
    const linkRow = rows.find((r: unknown) => {
      const row = r as Record<string, unknown>;
      return row.guest_id !== undefined && row.guest_id !== null;
    });
    expect(linkRow).toBeUndefined();
  });
});

// ─── G6: Durable idempotency ──────────────────────────────────────────────────

describe('G6 — durable idempotency', () => {
  beforeEach(resetMocks);

  it('checkAndMark returns false on first call, true on second', () => {
    expect(checkAndMark(9001)).toBe(false);
    expect(checkAndMark(9001)).toBe(true);
  });

  it('markDurable fires insert to tg_processed_updates', async () => {
    markDurable(9002);
    // fire-and-forget — flush microtasks
    await new Promise(resolve => setTimeout(resolve, 0));
    const rows = insertedRows['tg_processed_updates'] ?? [];
    expect(rows.some((r: unknown) => (r as { update_id: number }).update_id === 9002)).toBe(true);
  });

  it('checkDurableDuplicate returns false when update_id not in DB', async () => {
    const result = await checkDurableDuplicate(9999);
    expect(result).toBe(false);
  });

  it('checkDurableDuplicate returns true when update_id exists in DB', async () => {
    selectRows['tg_processed_updates'] = [{ update_id: 8888, processed_at: '2026-01-01T00:00:00Z' }];
    const result = await checkDurableDuplicate(8888);
    expect(result).toBe(true);
  });

  it('processUpdate returns Duplicate on second call with same update_id (L1)', async () => {
    const update = makeUpdate('hello');
    const first = await processUpdate(update);
    expect(first.outcome).toBe(ProcessOutcome.Replied);

    const second = await processUpdate(update);
    expect(second.outcome).toBe(ProcessOutcome.Duplicate);
    expect(mockReply).toHaveBeenCalledOnce();
  });

  it('duplicate harmless retry does not send duplicate outbound message', async () => {
    const update = makeUpdate('wifi password?');
    await processUpdate(update);
    await processUpdate(update); // duplicate
    await processUpdate(update); // duplicate again

    expect(mockReply).toHaveBeenCalledOnce();
  });
});
