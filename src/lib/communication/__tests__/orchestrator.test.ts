import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, TelegramUpdate, IntentCategory, EscalationReason } from '../types';

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

// Mock channel adapter sendMessage (delivery path)
const mockSendMessage = vi.fn().mockResolvedValue(true);
vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('normalizeInbound not used in orchestrator unit tests');
    },
    sendMessage: (to: string, content: string) => mockSendMessage(to, content),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
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
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';

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
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    mockSendMessage.mockClear();
    mockLLM.mockClear();
    mockLLM.mockResolvedValue('LLM reply text');
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
    mockCreatePaymentRequest.mockClear();
  });

  it('replies to a valid message and returns Replied outcome', async () => {
    const result = await processUpdate(makeUpdate('hello'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('sends the LLM reply when LLM succeeds on an issue', async () => {
    mockLLM.mockResolvedValue('LLM: issue acknowledged');
    const result = await processUpdate(makeUpdate('problem with the lock'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockSendMessage).toHaveBeenCalledWith('42', 'LLM: issue acknowledged');
  });

  it('injects session context into LLM prompt', async () => {
    mockLLM.mockResolvedValue('ok');
    await processUpdate(makeUpdate('need invoice for payment, 2 guests 2026-05-01'));
    expect(mockLLM).toHaveBeenCalled();
    const call = mockLLM.mock.calls[0]?.[0] as { userMessage?: string };
    expect(call.userMessage).toContain('--- Session Context ---');
    expect(call.userMessage).toContain('summary:');
    expect(call.userMessage).toMatch(/payment/i);
  });

  it('escalates on low confidence intent', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.4 });
    const result = await processUpdate(makeUpdate('some weird message'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe(EscalationReason.LowIntentConfidence);
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(sentText).toMatch(/review|ответом|операционный/i);
  });

  it('generates mock payment link on PaymentRequest intent', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.PaymentRequest, confidence: 0.95 });
    const result = await processUpdate(makeUpdate('I want to pay'));
    expect(mockCreatePaymentRequest).toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(sentText).toContain('https://pay.test/pay_mock123');
  });

  it('falls back to deterministic reply when LLM returns null', async () => {
    mockLLM.mockResolvedValue(null);
    await processUpdate(makeUpdate('guest says wifi is broken'));
    const [, sentText] = mockSendMessage.mock.calls[0];
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
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('prevents duplicate outbound send when same reply is attempted twice', async () => {
    const update = makeUpdate('hello');
    await processUpdate(update);
    // Simulate a second processing run with a different update_id but same provider message id
    const replay: TelegramUpdate = {
      update_id: update.update_id + 999,
      message: { ...update.message!, message_id: update.message!.message_id, chat: { id: 42 }, text: 'hello' },
    };
    await processUpdate(replay);
    // Outbound idempotency should prevent the second send
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('returns Ignored for an update with no message', async () => {
    const update: TelegramUpdate = { update_id: nextUpdateId++ };
    const result = await processUpdate(update);
    expect(result.outcome).toBe(ProcessOutcome.Ignored);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('creates an escalation event for urgent access issues based on slots', async () => {
    const result = await processUpdate(makeUpdate('urgent lock failed access'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe('URGENT_ISSUE');
  });

  it('returns Error outcome but still does not throw when reply fails', async () => {
    // Delivery layer treats `false` as failure and orchestrator returns Error outcome
    // reliability layer will retry up to 3 times; force consistent failure
    mockSendMessage.mockResolvedValue(false);
    const result = await processUpdate(makeUpdate('check-in tomorrow'));
    expect(result.outcome).toBe(ProcessOutcome.Error);
  });
});
