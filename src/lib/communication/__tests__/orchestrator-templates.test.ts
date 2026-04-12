/**
 * Orchestrator template integration tests.
 *
 * Verifies that:
 * - pre_checkin_template is used directly when CheckInInfo intent fires
 * - checkout_template is used directly when CheckOut intent fires
 * - fallback to LLM when templates are absent
 * - escalation_contact_text appended on escalation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, TelegramUpdate, IntentCategory } from '../types';

// ─── Supabase mock (no maybeSingle — getPropertyTemplates catches and returns null by default) ─
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

// ─── Controllable templates mock ──────────────────────────────────────────────
import type { PropertyTemplates } from '../templates';

let mockTemplates: PropertyTemplates | null = null;
vi.mock('../templates', () => ({
  getPropertyTemplates: async () => mockTemplates,
}));

// ─── Check-in gate mock (default: allowed — existing tests don't test the gate) ─
vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async () => ({
    allowed: true,
    unit_state: 'ready',
    blocked_reason: null,
    checked_at: new Date().toISOString(),
  }),
}));

// ─── Standard mocks ───────────────────────────────────────────────────────────

const mockReply = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReply(...args),
}));

const mockLLM = vi.fn().mockResolvedValue('LLM reply text');
vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mockLLM(...args),
}));

const mockDetectIntent = vi.fn().mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
vi.mock('../intent', () => ({
  detectIntent: (...args: unknown[]) => mockDetectIntent(...args),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: vi.fn().mockResolvedValue({
    id: 'pay_mock',
    provider: 'stripe',
    providerTransactionId: 'cs_test',
    status: 'pending',
    amount: 100,
    currency: 'USD',
    paymentUrl: 'https://pay.test/pay_mock',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({
    status: 'matched',
    confidence: 1.0,
    propertyId: 'prop_A',
    guestName: 'Test Guest',
    reservationId: 'res_test',
  }),
}));

import { processUpdate } from '../orchestrator';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let nextId = 5000;
function makeUpdate(text: string): TelegramUpdate {
  return {
    update_id: nextId++,
    message: { message_id: nextId, chat: { id: 99 }, text },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('orchestrator: property template usage', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    mockReply.mockClear();
    mockLLM.mockClear();
    mockLLM.mockResolvedValue('LLM reply text');
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
    mockTemplates = null;
  });

  // ── pre-checkin template ────────────────────────────────────────────────────

  it('uses pre_checkin_template directly and skips LLM on CheckInInfo intent', async () => {
    mockTemplates = {
      pre_checkin_template:    'Door code is 4321. Check-in at 15:00.',
      checkout_template:       null,
      followup_template:       null,
      escalation_contact_text: null,
    };
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.CheckInInfo, confidence: 0.95 });

    const result = await processUpdate(makeUpdate('how do I check in'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toBe('Door code is 4321. Check-in at 15:00.');
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('uses deterministic check-in clarify when pre_checkin_template is absent', async () => {
    mockTemplates = null;
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.CheckInInfo, confidence: 0.95 });

    const result = await processUpdate(makeUpdate('how do I check in'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toMatch(/check-in|access|заселен/i);
  });

  // ── checkout template ───────────────────────────────────────────────────────

  it('uses checkout_template directly and skips LLM on CheckOut intent', async () => {
    mockTemplates = {
      pre_checkin_template:    null,
      checkout_template:       'Leave keys on the table. Checkout by 11:00.',
      followup_template:       null,
      escalation_contact_text: null,
    };
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.CheckOut, confidence: 0.95 });

    const result = await processUpdate(makeUpdate('how do I check out'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toBe('Leave keys on the table. Checkout by 11:00.');
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('falls back to LLM for CheckOut when checkout_template is absent', async () => {
    mockTemplates = null;
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.CheckOut, confidence: 0.95 });

    const result = await processUpdate(makeUpdate('how do I check out'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockLLM).toHaveBeenCalledOnce();
  });

  // ── escalation contact text ─────────────────────────────────────────────────

  it('appends escalation_contact_text to escalation reply', async () => {
    mockTemplates = {
      pre_checkin_template:    null,
      checkout_template:       null,
      followup_template:       null,
      escalation_contact_text: 'Call us: +7-999-000-0000.',
    };
    // Low confidence forces escalation
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.3 });

    await processUpdate(makeUpdate('something weird'));
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toContain('Call us: +7-999-000-0000.');
  });

  it('uses default escalation text when escalation_contact_text is absent', async () => {
    mockTemplates = null;
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.3 });

    await processUpdate(makeUpdate('something weird'));
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toContain('flagged this for our team');
    expect(sentText).not.toContain('Call us:');
  });
});
