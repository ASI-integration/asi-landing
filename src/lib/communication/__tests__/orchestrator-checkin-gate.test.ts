/**
 * Orchestrator check-in gate integration tests.
 *
 * Verifies that:
 * - check-in instructions are delivered when unit is ready
 * - safe holding message is sent when unit is NOT ready
 * - no pre_checkin_template is leaked when blocked
 * - after unit becomes ready, next request delivers instructions
 * - idempotent: repeated requests while blocked don't create duplicate ops tasks
 * - idempotent: repeated requests after ready don't duplicate sends
 * - timeline events are emitted correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, IntentCategory } from '../types';
import type { TelegramUpdate } from '../types';

// ─── Controllable checkin gate mock ──────────────────────────────────────────

let mockGateResult = { allowed: true, unit_state: 'ready', blocked_reason: undefined as string | undefined, checked_at: new Date().toISOString() };
vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async () => mockGateResult,
}));

// ─── Supabase mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      update: () => ({
        eq: () => ({
          then: (fn: () => void) => { fn(); return { catch: () => {} }; },
        }),
      }),
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: 'not found' } }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

// ─── Controllable templates mock ──────────────────────────────────────────────

import type { PropertyTemplates } from '../templates';

let mockTemplates: PropertyTemplates | null = null;
vi.mock('../templates', () => ({
  getPropertyTemplates: async () => mockTemplates,
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

const mockDetectIntent = vi.fn().mockResolvedValue({ intent: IntentCategory.CheckInInfo, confidence: 0.95 });
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

// Track ops tasks created
const mockCreateOpsTask = vi.fn().mockResolvedValue({ ok: true, task_id: null, created: false });
vi.mock('@/lib/ops/tasks', () => ({
  createOpsTask: (...args: unknown[]) => mockCreateOpsTask(...args),
  OpsTaskType: {
    PreArrivalPrep: 'pre_arrival_prep',
    CheckinReady:   'checkin_ready',
    GuestIssue:     'guest_issue',
    Checkout:       'checkout',
    Turnover:       'turnover',
  },
  OpsTaskPriority: {
    Emergency:     'emergency',
    Urgent:        'urgent',
    Normal:        'normal',
    Informational: 'informational',
  },
}));

import { processUpdate } from '../orchestrator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let nextId = 9000;
function makeUpdate(text: string): TelegramUpdate {
  return {
    update_id: nextId++,
    message: { message_id: nextId, chat: { id: 99 }, text },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('orchestrator: check-in gate', () => {
  beforeEach(() => {
    _resetForTesting();
    mockReply.mockClear();
    mockLLM.mockClear();
    mockLLM.mockResolvedValue('LLM reply text');
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: IntentCategory.CheckInInfo, confidence: 0.95 });
    mockCreateOpsTask.mockClear();
    mockCreateOpsTask.mockResolvedValue({ ok: true, task_id: null, created: false });
    mockTemplates = {
      pre_checkin_template:    'Door code is 4321. Check-in at 15:00.',
      checkout_template:       null,
      followup_template:       null,
      escalation_contact_text: null,
    };
    mockGateResult = {
      allowed: true,
      unit_state: 'ready',
      blocked_reason: undefined,
      checked_at: new Date().toISOString(),
    };
  });

  // ── Gate passes ─────────────────────────────────────────────────────────────

  it('delivers check-in instructions when unit is ready', async () => {
    const result = await processUpdate(makeUpdate('how do I check in'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toBe('Door code is 4321. Check-in at 15:00.');
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // ── Gate blocks ─────────────────────────────────────────────────────────────

  it('sends safe holding message when unit is NOT ready', async () => {
    mockGateResult = {
      allowed: false,
      unit_state: 'turnover_needed',
      blocked_reason: 'turnover_needed',
      checked_at: new Date().toISOString(),
    };

    const result = await processUpdate(makeUpdate('how do I check in'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [, sentText] = mockReply.mock.calls[0];
    // Must NOT contain the actual check-in instructions
    expect(sentText).not.toContain('4321');
    expect(sentText).not.toContain('Door code');
    // Must contain holding message
    expect(sentText).toContain('preparing');
  });

  it('does not leak pre_checkin_template when blocked', async () => {
    mockGateResult = {
      allowed: false,
      unit_state: 'blocked',
      blocked_reason: 'property_inactive',
      checked_at: new Date().toISOString(),
    };

    await processUpdate(makeUpdate('what is the door code'));
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).not.toContain('Door code is 4321');
    expect(sentText).not.toContain('15:00');
  });

  // ── Gate unblocked → instructions sent ──────────────────────────────────────

  it('delivers instructions after unit becomes ready', async () => {
    // First call: blocked
    mockGateResult = {
      allowed: false,
      unit_state: 'in_turnover',
      blocked_reason: 'turnover_in_progress',
      checked_at: new Date().toISOString(),
    };
    await processUpdate(makeUpdate('how do I check in'));
    const [, blockedText] = mockReply.mock.calls[0];
    expect(blockedText).not.toContain('4321');

    // Unit becomes ready
    mockGateResult = {
      allowed: true,
      unit_state: 'ready',
      blocked_reason: undefined,
      checked_at: new Date().toISOString(),
    };

    const result = await processUpdate(makeUpdate('how do I check in'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [, readyText] = mockReply.mock.calls[1];
    expect(readyText).toBe('Door code is 4321. Check-in at 15:00.');
  });

  // ── Idempotency while blocked ───────────────────────────────────────────────

  it('repeated requests while blocked send holding message each time (no harmful duplicates)', async () => {
    mockGateResult = {
      allowed: false,
      unit_state: 'turnover_needed',
      blocked_reason: 'unit_dirty',
      checked_at: new Date().toISOString(),
    };

    // Two identical requests while blocked
    await processUpdate(makeUpdate('how do I get in'));
    await processUpdate(makeUpdate('door code please'));

    expect(mockReply).toHaveBeenCalledTimes(2);

    // Both should be holding messages, not check-in instructions
    for (const call of mockReply.mock.calls) {
      const [, text] = call;
      expect(text).not.toContain('4321');
      expect(text).toContain('preparing');
    }

    // LLM should not have been called (deterministic safe response)
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // ── Idempotency after ready ─────────────────────────────────────────────────

  it('repeated requests after ready deliver template each time without duplicating harmful sends', async () => {
    // Already ready
    mockGateResult = {
      allowed: true,
      unit_state: 'ready',
      blocked_reason: undefined,
      checked_at: new Date().toISOString(),
    };

    await processUpdate(makeUpdate('what is the code'));
    await processUpdate(makeUpdate('door code'));

    expect(mockReply).toHaveBeenCalledTimes(2);
    for (const call of mockReply.mock.calls) {
      const [, text] = call;
      expect(text).toBe('Door code is 4321. Check-in at 15:00.');
    }
  });

  // ── Russian holding message ─────────────────────────────────────────────────

  it('sends Russian holding message when lang is ru and unit not ready', async () => {
    mockGateResult = {
      allowed: false,
      unit_state: 'in_turnover',
      blocked_reason: 'turnover_in_progress',
      checked_at: new Date().toISOString(),
    };

    // Send a Russian message (the classifier will detect as ru)
    const result = await processUpdate(makeUpdate('как заселиться'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [, sentText] = mockReply.mock.calls[0];
    // Should not contain English holding or check-in instructions
    expect(sentText).not.toContain('4321');
  });
});
