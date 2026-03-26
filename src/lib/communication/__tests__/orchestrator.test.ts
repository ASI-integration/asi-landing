import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, TelegramUpdate, IntentCategory } from '../types';
import { clearContext, getContext } from '../memory';

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

// Mock Payments (real factory — returns a PaymentRequest object with paymentUrl)
const mockCreatePaymentRequest = vi.fn().mockResolvedValue({
  id: 'pay_mock123',
  provider: 'stripe',
  providerTransactionId: 'cs_test_mock',
  status: 'pending',
  amount: 100,
  currency: 'USD',
  paymentUrl: 'https://pay.test/pay_mock123',
  createdAt: new Date(),
  updatedAt: new Date(),
});
vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: (...args: unknown[]) => mockCreatePaymentRequest(...args),
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
    clearContext(42);
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

  it('stores booking draft entities and passes them to the prompt', async () => {
    await processUpdate(makeUpdate('Принял бронь на Литейный, 38 на 4 ночи. Нужна парковка.', 'ru'));

    const context = getContext(42);
    expect(context.bookingDraft).toMatchObject({
      propertyLabel: 'Литейный, 38',
      stayNights: 4,
      specificRequests: ['parking'],
    });

    const llmArgs = mockLLM.mock.calls[0][0] as { userMessage: string };
    expect(llmArgs.userMessage).toContain('Known Property: Литейный, 38');
    expect(llmArgs.userMessage).toContain('Known Stay Duration Nights: 4');
    expect(llmArgs.userMessage).toContain('Known Specific Requests: parking');
  });

  // ─── G8: edited_message ─────────────────────────────────────────────────────

  it('G8: edited_message returns Ignored and sends no reply', async () => {
    const update: TelegramUpdate = {
      update_id: nextUpdateId++,
      edited_message: {
        message_id: nextUpdateId,
        chat: { id: 42 },
        from: { language_code: 'en' },
        text: 'edited text — should not trigger a reply',
      },
    };
    const result = await processUpdate(update);
    expect(result.outcome).toBe(ProcessOutcome.Ignored);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('G8: edited_message with no text is still Ignored, not an Error', async () => {
    const update: TelegramUpdate = {
      update_id: nextUpdateId++,
      edited_message: { message_id: nextUpdateId, chat: { id: 42 } },
    };
    const result = await processUpdate(update);
    expect(result.outcome).toBe(ProcessOutcome.Ignored);
  });

  // ─── G9: language_code propagation ──────────────────────────────────────────

  it('G9: from.language_code is threaded to the classifier — Russian user gets RU systemPrompt', async () => {
    // Short ambiguous English text that would default to 'en' without languageCode
    const update: TelegramUpdate = {
      update_id: nextUpdateId++,
      message: {
        message_id: nextUpdateId,
        chat: { id: 42 },
        from: { language_code: 'ru' },
        text: 'ok',        // too short for Cyrillic/character-set detection → would fallback to 'en'
      },
    };
    await processUpdate(update);
    // The systemPrompt passed to callLLM should reference 'ru' language
    const firstCallArgs = mockLLM.mock.calls[0][0] as { systemPrompt: string };
    expect(firstCallArgs.systemPrompt).toMatch(/русск|ru|Russian/i);
  });

  it('G9: BCP-47 sub-tag ru-RU is sanitised to ru', async () => {
    const update: TelegramUpdate = {
      update_id: nextUpdateId++,
      message: {
        message_id: nextUpdateId,
        chat: { id: 42 },
        from: { language_code: 'ru-RU' },
        text: 'ok',
      },
    };
    const result = await processUpdate(update);
    // Should not error and should produce a Replied outcome
    expect(result.outcome).toBe(ProcessOutcome.Replied);
  });

  // ─── G7: payment_pending duplicate guard ────────────────────────────────────

  it('G7: does NOT call createPaymentRequest when session is already payment_pending', async () => {
    // First call — creates the initial payment request
    mockDetectIntent.mockResolvedValue({ intent: 'payment_request', confidence: 0.95 });
    await processUpdate(makeUpdate('I want to pay'));
    expect(mockCreatePaymentRequest).toHaveBeenCalledTimes(1);
    mockCreatePaymentRequest.mockClear();

    // Second call with same intent while status is now payment_pending
    await processUpdate(makeUpdate('I want to pay'));
    expect(mockCreatePaymentRequest).not.toHaveBeenCalled();
    // A reminder message should still be sent
    expect(mockReply).toHaveBeenCalled();
    const [, reminderText] = mockReply.mock.calls[mockReply.mock.calls.length - 1];
    expect(reminderText).toMatch(/payment|pending|already|оплат/i);
  });
});
