import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';

const testState = vi.hoisted(() => ({
  memoryStore: new Map<number, Record<string, unknown>>(),
}));

const mockSendMessage = vi.fn().mockResolvedValue(true);
const mockReplyToTelegram = vi.fn().mockResolvedValue(true);
const mockCallLLM = vi.fn().mockResolvedValue('LLM fallback should not be used');
const mockDetectIntent = vi.fn().mockResolvedValue({ intent: 'general_question', confidence: 0.95 });

function supabaseQuery() {
  const query: any = {
    upsert: vi.fn(async () => ({ data: null, error: null })),
    insert: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn(() => query),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => supabaseQuery(),
  },
}));

vi.mock('../channels', () => ({
  getChannelAdapter: (channel: string) => ({
    channel,
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

vi.mock('../intent', () => ({
  detectIntent: (...args: unknown[]) => mockDetectIntent(...args),
}));

vi.mock('../classifier', () => ({
  classifyMessage: async (text: string) => ({
    category: 'issue',
    lang: /[а-яё]/i.test(text) ? 'ru' : 'en',
    slots: { isUrgent: /срочн|urgent/i.test(text) },
  }),
  classify: (text: string) => ({
    category: 'issue',
    lang: /[а-яё]/i.test(text) ? 'ru' : 'en',
    slots: { isUrgent: /срочн|urgent/i.test(text) },
  }),
  deterministicReply: () => 'ok',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT: 'SYSTEM',
}));

vi.mock('../identity-binding', () => ({
  bindIdentity: async () => ({
    role: 'guest',
    entityType: 'guest',
    entityId: 'guest-normalizer',
    propertyId: null,
    reservationId: null,
    leadId: null,
    confidence: 1,
    status: 'resolved',
    reason: 'normalizer-test',
    guestId: 'guest-normalizer',
  }),
}));

vi.mock('../context', () => ({
  buildCommunicationContext: async () => ({
    memory: {
      bookingReference: null,
      propertyLocation: null,
      guestName: null,
      checkInDate: null,
    },
    identity: {
      role: 'guest',
      entityType: 'guest',
      entityId: 'guest-normalizer',
      confidence: 1,
      status: 'resolved',
    },
    reservation: {
      status: 'unmatched',
      confidence: 0,
      reservationId: null,
      propertyId: null,
    },
  }),
}));

vi.mock('../memory', () => ({
  getContext: (chatId: number) => testState.memoryStore.get(chatId) ?? {},
  updateContext: (chatId: number, patch: Record<string, unknown>) => {
    const prev = testState.memoryStore.get(chatId) ?? {};
    testState.memoryStore.set(chatId, { ...prev, ...patch });
  },
}));

vi.mock('../action', () => ({
  evaluateActionSafety: () => ({
    safe: true,
    action: 'reply',
    reason: null,
    escalationReason: null,
  }),
}));

vi.mock('../templates', () => ({
  getPropertyTemplates: async () => null,
}));

vi.mock('../background', () => ({
  runInBackground: () => undefined,
}));

vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async () => ({
    allowed: false,
    unit_state: null,
    blocked_reason: 'not_needed',
    checked_at: new Date().toISOString(),
  }),
}));

vi.mock('@/lib/ops/tasks', () => ({
  OpsTaskType: { GuestIssue: 'guest_issue', Checkout: 'checkout', CheckinReady: 'checkin_ready' },
  OpsTaskPriority: { Normal: 'normal', Urgent: 'urgent' },
  createOpsTask: async () => ({ task_id: null, error: null }),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: async () => ({
    id: 'pay-id',
    provider: 'stripe',
    providerTransactionId: 'tx',
    status: 'pending',
    amount: 100,
    currency: 'RUB',
    paymentUrl: 'https://pay.test/mock',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));

import { normalizeGuestMessageForCanon } from '../communication-normalizer';
import { executeTelegramOperationalPolicy } from '../telegram-operational-policy-executor';
import { processMessage } from '../orchestrator';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function envelope(channel: 'telegram' | 'email', messageText: string, id: string): InboundMessageEnvelope {
  return {
    channel,
    externalUserId: channel === 'email' ? 'guest@example.com' : '9017',
    chatId: channel === 'telegram' ? '9017' : undefined,
    email: channel === 'email' ? 'guest@example.com' : undefined,
    subject: channel === 'email' ? 'Guest request' : undefined,
    messageText,
    receivedAt: new Date('2026-05-08T10:00:00.000Z'),
    update_id: id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 9000),
    metadata: {
      providerMessageId: id,
      externalMessageId: id,
      message_id: id,
    },
  };
}

function lastReplyText(): string {
  return String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
}

describe('communication natural-language normalizer', () => {
  beforeEach(() => {
    resetIdempotency();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    testState.memoryStore.clear();
    mockSendMessage.mockClear();
    mockReplyToTelegram.mockClear();
    mockCallLLM.mockClear();
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: 'general_question', confidence: 0.95 });
  });

  it('maps casual Russian Wi-Fi phrasing and slang to the Wi-Fi canon intent', () => {
    for (const text of ['вайфай?', 'вафля?', 'пароль от wifi?']) {
      const normalization = normalizeGuestMessageForCanon(text);
      const policy = executeTelegramOperationalPolicy({ messageText: text, normalization });

      expect(normalization.scenarioFamilies).toContain('WIFI');
      expect(policy.scenarioFamily).toBe('WIFI');
      expect(policy.action).toBe('clarify');
    }
  });

  it('maps casual English abbreviations to canonical intents', () => {
    const wifi = normalizeGuestMessageForCanon('wifi pass?');
    const checkin = normalizeGuestMessageForCanon('can u send checkin?');
    const parking = normalizeGuestMessageForCanon('u have parking?');

    expect(wifi.scenarioFamilies).toContain('WIFI');
    expect(checkin.scenarioFamilies).toContain('ADDRESS_FIND_OBJECT');
    expect(parking.scenarioFamilies).toContain('PARKING');
  });

  it('maps mixed-language late checkout phrasing', () => {
    for (const text of ['late checkout?', 'можно позже выехать?', 'выезд попозже?', 'можно late checkout?']) {
      const normalization = normalizeGuestMessageForCanon(text);
      expect(normalization.scenarioFamilies).toContain('LATE_CHECKOUT');
    }
  });

  it('maps informal pet questions without deciding policy', () => {
    for (const text of ['pets ok?', 'можно с собакой?', 'с котом можно?', 'с животными?']) {
      const normalization = normalizeGuestMessageForCanon(text);
      const policy = executeTelegramOperationalPolicy({ messageText: text, normalization });

      expect(normalization.scenarioFamilies).toContain('PETS');
      expect(policy.scenarioFamily).toBe('PETS');
      expect(policy.action).toBe('clarify');
    }
  });

  it('marks urgent access intent without inventing access facts', () => {
    const normalization = normalizeGuestMessageForCanon('я у двери, код не работает, срочно');
    const policy = executeTelegramOperationalPolicy({
      messageText: 'я у двери, код не работает, срочно',
      normalization,
    });

    expect(normalization.scenarioFamilies).toContain('ACCESS_KEY_ISSUE');
    expect(normalization.urgency.accessBlocked).toBe(true);
    expect(policy.scenarioFamily).toBe('ACCESS_KEY_ISSUE');
    expect(policy.action).toBe('escalate');
  });

  it('uses normalization before canon for Telegram casual messages', async () => {
    const result = await processMessage(envelope('telegram', 'wifi pass?', 'norm-tg-wifi-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/property|object|which/i);
    expect(lastReplyText()).not.toMatch(/password:\s*\S+|\b\d{4,}\b/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('uses normalization before canon for Email typo/slang messages', async () => {
    const result = await processMessage(envelope('email', 'вафля?', 'norm-email-wifi-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/объект|брони/i);
    expect(lastReplyText()).not.toMatch(/пароль:\s*\S+|\b\d{4,}\b/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('routes low-confidence input to clarification instead of guessing', async () => {
    const result = await processMessage(envelope('telegram', 'code', 'norm-low-confidence-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/property|booking|объект|брон/i);
    expect(lastReplyText()).not.toMatch(/password:\s*\S+|\b\d{4,}\b/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('still escalates urgent blocked access when confidence is low', async () => {
    const result = await processMessage(envelope('telegram', 'urgent, at the door right now', 'norm-low-confidence-access-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).not.toMatch(/password:\s*\S+|\b\d{4,}\b/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('asks for booking or object when guest references same booking without memory', async () => {
    const result = await processMessage(envelope('telegram', 'same booking, as I said', 'norm-same-booking-no-memory-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/property|booking|объект|брон/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('uses warmer urgent escalation wording for stressed access tone', async () => {
    const result = await processMessage(
      envelope('telegram', 'help please, I am locked out at the door right now, door code not working', 'norm-stressed-access-tone-1'),
    );

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/urgently passing this to an operator|Срочно передаю оператору/i);
  });

  it('replies in English for English guest message', async () => {
    const result = await processMessage(envelope('telegram', 'same apartment, wifi pass?', 'norm-english-reply-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/please|property|booking/i);
    expect(lastReplyText()).not.toMatch(/[а-яё]/i);
  });

  it('replies in Russian for Russian guest message', async () => {
    const result = await processMessage(envelope('telegram', 'та же бронь, вайфай?', 'norm-russian-reply-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/[а-яё]/i);
  });

  it('keeps sensible language continuity for mixed messages', async () => {
    const first = await processMessage(envelope('telegram', 'same apartment wifi pass?', 'norm-mixed-lang-seed-1'));
    const second = await processMessage(
      envelope('telegram', 'как я говорил, same booking, нужен wifi password', 'norm-mixed-lang-followup-1'),
    );

    expect(first.outcome).toBe('replied');
    expect(second.outcome).toBe('replied');
    expect(lastReplyText()).not.toMatch(/[а-яё]/i);
  });

  it('prevents repeated near-identical replies with anti-loop marker behavior', async () => {
    const first = await processMessage(envelope('telegram', 'wifi?', 'norm-anti-loop-1'));
    const second = await processMessage(envelope('telegram', 'wifi?', 'norm-anti-loop-2'));
    const third = await processMessage(envelope('telegram', 'wifi?', 'norm-anti-loop-3'));

    const secondReply = String(mockSendMessage.mock.calls[1]?.[1] ?? '');
    const thirdReply = String(mockSendMessage.mock.calls[2]?.[1] ?? '');

    expect(first.outcome).toBe('replied');
    expect(second.outcome).toBe('replied');
    expect(third.outcome).toBe('replied');
    expect(new Set([lastReplyText(), secondReply, thirdReply]).size).toBeGreaterThan(1);
    expect(`${secondReply}\n${thirdReply}`).toMatch(/avoid repeating|operator|team|не повторяться|оператор|команд/i);
  });
});
