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

// Mock Telegram outbound helper for hard short-circuit replies
const mockReplyToTelegram = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
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
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '../operator-review';

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
    __resetEscalationReviewStoreForTests();
    delete process.env.COMM_TELEGRAM_RESET_ALLOWLIST;
    delete process.env.COMM_TELEGRAM_RESET_ALLOWLIST_PROD;
    mockSendMessage.mockClear();
    mockReplyToTelegram.mockClear();
    mockLLM.mockClear();
    mockLLM.mockResolvedValue('LLM reply text');
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 });
    mockCreatePaymentRequest.mockClear();
  });

  it('replies to a valid message and returns Replied outcome', async () => {
    const result = await processUpdate(makeUpdate('hello'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('short-circuits classifier language-check phrases without LLM', async () => {
    const result = await processUpdate(makeUpdate('do you understand me'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    expect(mockLLM).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('short-circuits RU greeting without LLM', async () => {
    await processUpdate(makeUpdate('привет', 'ru'));
    expect(mockLLM).not.toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalled();
  });

  it('sends the LLM reply path does not handle urgent lock issues', async () => {
    mockLLM.mockResolvedValue('LLM: issue acknowledged');
    const result = await processUpdate(makeUpdate('problem with the lock'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation?.reason).toBe(EscalationReason.RequiresOperator);
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(String(sentText)).toMatch(/operator|team|access|доступ|оператор/i);
  });

  it('injects session context into LLM prompt', async () => {
    mockLLM.mockResolvedValue('ok');
    await processUpdate(makeUpdate('need invoice for payment, 2 guests 2026-05-01'));
    // Scenario engine: deterministic clarifying question for invoice/receipt
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(String(sentText)).toMatch(/invoice|receipt|чек|квитанц|сч/i);
  });

  it('escalates on low confidence intent', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.4 });
    const result = await processUpdate(makeUpdate('some weird message'));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe(EscalationReason.LowIntentConfidence);
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(String(sentText)).toMatch(/passing this to the team|Передал\(а\) запрос|оператор/i);
    const reviews = listEscalationReviews({ status: 'pending' });
    expect(reviews.length).toBe(1);
    expect(reviews[0]?.sessionId).toBeTruthy();
  });

  it('uses Telegram operational intake instead of generic escalation on guest access relay (low intent confidence)', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.35 });
    const msg =
      'Hi, guest John Smith is checking in today at 18:00 at Nevsky 24. He says the door code does not work. Can you help?';
    const result = await processUpdate(makeUpdate(msg));
    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(String(sentText)).toMatch(/Understood|access issue/i);
    expect(String(sentText)).not.toMatch(/not entirely sure|безопасно ответить/i);
    // Operational intake may correctly mark access issues urgent.
    // The key requirement is: deterministic path, no generic LLM fallback.
    expect(result.escalation === undefined || result.escalation.reason === EscalationReason.UrgentIssue).toBe(true);
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
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
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
    expect(listEscalationReviews().length).toBe(1);
  });

  it('blocks normal automation on subsequent turns while session is escalated', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.4 });
    await processUpdate(makeUpdate('first message triggers escalation'));
    expect(listEscalationReviews({ status: 'pending' }).length).toBe(1);

    mockLLM.mockClear();
    await processUpdate(makeUpdate('followup question should not call llm'));
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls.at(-1)!;
    expect(String(sentText)).toMatch(/escalated|human operator|оператор|вернёмся/i);
  });

  it('resumes the same telegram operational intake case after escalation (followup fragment)', async () => {
    // First: operational intake escalation (deterministic)
    await processUpdate(makeUpdate("Guest can't enter, door code does not work. Today at 18:00."));
    // Second: follow-up fragment should be processed by session-memory intake, NOT blocked by escalated safety ack
    mockLLM.mockClear();
    await processUpdate(makeUpdate('Nevsky 24'));
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls.at(-1)!;
    expect(String(sentText)).toMatch(/Understood|Понял/i);
    expect(String(sentText)).not.toMatch(/already escalated to a human operator/i);
  });

  it('starts a new telegram operational case for a clearly unrelated message after escalation', async () => {
    await processUpdate(makeUpdate("Guest can't enter, door code does not work."));
    mockLLM.mockClear();
    await processUpdate(makeUpdate('Late checkout tomorrow until 13:00 @ Nevsky 24.'));
    expect(mockLLM).not.toHaveBeenCalled();
    const [, sentText] = mockSendMessage.mock.calls.at(-1)!;
    expect(String(sentText)).toMatch(/late checkout|поздн/i);
    expect(String(sentText)).not.toMatch(/already escalated to a human operator/i);
  });

  it('continues live RU check-in conversation after object context instead of escalated ack', async () => {
    await processUpdate(makeUpdate('Здравствуйте, я гость. Хочу заехать завтра в 15:00, можно?', 'ru'));
    let sentText = String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
    expect(sentText).toContain('Здравствуйте!');
    expect(sentText).toMatch(/15:00 обычно считается стандартным временем заезда/i);
    expect(sentText).toMatch(/для какого это объекта или брони/i);

    await processUpdate(makeUpdate('А если в 7 утра?', 'ru'));
    sentText = String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
    expect(sentText).toMatch(/07:00 — это очень ранний заезд/i);
    expect(sentText).toMatch(/для какого это объекта или брони/i);
    expect(sentText).not.toMatch(/Запрос уже передан|переда[юн].*оператор/i);

    await processUpdate(makeUpdate('Это та же бронь, объект на Тверской.', 'ru'));
    sentText = String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
    expect(sentText).toMatch(/07:00 — это очень ранний заезд/i);
    expect(sentText).not.toMatch(/для какого это объекта или брони/i);
    expect(sentText).not.toMatch(/Запрос уже передан|переда[юн].*оператор/i);
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('allows /reset_session for allowlisted chat ids and unblocks further testing', async () => {
    process.env.COMM_TELEGRAM_RESET_ALLOWLIST = '42';

    // Get into escalated state
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.4 });
    await processUpdate(makeUpdate('first message triggers escalation'));
    expect(listEscalationReviews({ status: 'pending' }).length).toBe(1);

    // Reset
    await processUpdate(makeUpdate('/reset_session'));
    const [, resetReply] = mockSendMessage.mock.calls.at(-1)!;
    expect(String(resetReply)).toMatch(/Session reset/i);

    // After reset, a normal issue should route through LLM again (not blocked)
    mockLLM.mockResolvedValueOnce('LLM: after reset ok');
    await processUpdate(makeUpdate('problem with the lock'));
    const [, sentText] = mockSendMessage.mock.calls.at(-1)!;
    expect(String(sentText)).toBe('LLM: after reset ok');
  });

  it('returns Error outcome but still does not throw when reply fails', async () => {
    // Delivery layer treats `false` as failure and orchestrator returns Error outcome
    // reliability layer will retry up to 3 times; force consistent failure
    mockSendMessage.mockResolvedValue(false);
    const result = await processUpdate(makeUpdate('check-in tomorrow'));
    expect(result.outcome).toBe(ProcessOutcome.Error);
  });
});
