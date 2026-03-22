import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, TelegramUpdate, IntentCategory } from '../types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock Supabase persistence so tests don't need a real DB
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

// Mock replyToTelegram to capture calls
const mockReply = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReply(...args),
}));

// Mock callLLM — returns a string by default, can be overridden per test
const mockLLM = vi.fn().mockResolvedValue('LLM reply text');
vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mockLLM(...args),
}));

// Mock detectIntent
const mockDetectIntent = vi.fn().mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
vi.mock('../intent', () => ({
  detectIntent: (...args: unknown[]) => mockDetectIntent(...args),
}));

// Mock Payments
const mockCreatePaymentRequest = vi.fn().mockReturnValue('pay_mock123');
vi.mock('@/lib/payments/stub', () => ({
  createPaymentRequest: (...args: unknown[]) => mockCreatePaymentRequest(...args),
  confirmPayment: vi.fn(),
  getPaymentRequest: vi.fn(),
}));

// Mock Reservation Matcher
const mockMatchReservation = vi.fn().mockResolvedValue({ status: 'matched', confidence: 1.0, propertyId: 'prop_A', guestName: 'Test Guest', reservationId: 'res_test' });
vi.mock('../reservation', () => ({
  matchReservation: (...args: unknown[]) => mockMatchReservation(...args),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { processUpdate } from '../orchestrator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let nextUpdateId = 1000;
function makeUpdate(text: string, languageCode = 'en'): TelegramUpdate {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      chat: { id: 42 },
      from: { language_code: languageCode },
      text,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processUpdate', () => {
  beforeEach(() => {
    _resetForTesting();
    mockReply.mockClear();
    mockLLM.mockClear();
    mockLLM.mockResolvedValue('LLM reply text');
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
    mockCreatePaymentRequest.mockClear();
  });

  it('replies to a valid message and returns Replied outcome', async () => {
    const result = await processUpdate(makeUpdate('hello'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockReply).toHaveBeenCalledOnce();
  });

  it('sends the LLM reply when LLM succeeds on an issue', async () => {
    mockLLM.mockResolvedValue('LLM: issue acknowledged');
    const result = await processUpdate(makeUpdate('problem with the lock'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockReply).toHaveBeenCalledWith(42, 'LLM: issue acknowledged');
  });

  it('escalates on low confidence intent', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.4 });
    const result = await processUpdate(makeUpdate('some weird message'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe('LLM_UNCERTAIN');
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toContain('review');
  });

  it('generates mock payment link on PaymentRequest intent', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.PaymentRequest, confidence: 0.95 });
    const result = await processUpdate(makeUpdate('I want to pay'));
    expect(mockCreatePaymentRequest).toHaveBeenCalled();
    const [, sentText] = mockReply.mock.calls[0];
    expect(sentText).toContain('https://pay.test/pay_mock123');
  });

  it('falls back to deterministic reply when LLM returns null', async () => {
    mockLLM.mockResolvedValue(null);
    await processUpdate(makeUpdate('guest says wifi is broken'));
    const [, sentText] = mockReply.mock.calls[0];
    // Should be deterministic fallback text
    expect(typeof sentText).toBe('string');
    expect(sentText.length).toBeGreaterThan(0);
  });

  it('deduplicates the same update_id — second call returns Duplicate, sends no reply', async () => {
    const update = makeUpdate('check-in at 3pm');
    const first = await processUpdate(update);
    expect(first.outcome).toBe(ProcessOutcome.Replied);

    const second = await processUpdate(update);
    expect(second.outcome).toBe(ProcessOutcome.Duplicate);
    // Reply was sent exactly once
    expect(mockReply).toHaveBeenCalledOnce();
  });

  it('returns Ignored for an update with no message', async () => {
    const update: TelegramUpdate = { update_id: nextUpdateId++ };
    const result = await processUpdate(update);
    expect(result.outcome).toBe(ProcessOutcome.Ignored);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('creates an escalation event for urgent access issues based on slots', async () => {
    const result = await processUpdate(makeUpdate('urgent lock failed access'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe('URGENT_ISSUE');
  });

  it('returns Error outcome but still does not throw when reply fails', async () => {
    mockReply.mockRejectedValueOnce(new Error('Telegram API down'));
    const result = await processUpdate(makeUpdate('check-in tomorrow'));
    expect(result.outcome).toBe(ProcessOutcome.Error);
  });
});
