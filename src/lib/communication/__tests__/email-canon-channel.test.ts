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
  getChannelAdapter: () => ({
    channel: 'email',
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
  classifyMessage: async () => ({
    category: 'issue',
    lang: 'ru',
    slots: { isUrgent: false },
  }),
  classify: () => ({
    category: 'issue',
    lang: 'ru',
    slots: { isUrgent: false },
  }),
  deterministicReply: () => 'ok',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT: 'SYSTEM',
}));

vi.mock('../identity-binding', () => ({
  bindIdentity: async () => ({
    role: 'guest',
    entityType: 'guest',
    entityId: 'guest-email',
    propertyId: null,
    reservationId: null,
    leadId: null,
    confidence: 1,
    status: 'resolved',
    reason: 'email-test',
    guestId: 'guest-email',
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
      entityId: 'guest-email',
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

import { EmailAdapter } from '../channels/email';
import { getCommunicationCanon, isCanonicalGuestCommunicationChannel } from '../communication-canon';
import { processMessage } from '../orchestrator';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function emailEnvelope(messageText: string, providerMessageId: string, subject = 'Guest request'): InboundMessageEnvelope {
  return {
    channel: 'email',
    externalUserId: 'guest@example.com',
    email: 'guest@example.com',
    subject,
    messageText,
    receivedAt: new Date('2026-05-08T10:00:00.000Z'),
    update_id: providerMessageId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 1000),
    metadata: {
      provider: 'email',
      providerMessageId,
      externalMessageId: providerMessageId,
      message_id: providerMessageId,
    },
  };
}

function lastReplyText(): string {
  return String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
}

describe('Email canonical communication channel', () => {
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

  it('normalizes inbound email into a stable guest envelope', async () => {
    const adapter = new EmailAdapter();
    const envelope = await adapter.normalizeInbound({
      from: 'Guest Name <Guest@Example.COM>',
      to: ['Support <support@asi-global.ru>'],
      subject: 'Wi-Fi question',
      text: 'Где пароль от Wi-Fi?',
      messageId: '<mail-1@example.com>',
      date: '2026-05-08T09:30:00.000Z',
    });

    expect(envelope.channel).toBe('email');
    expect(envelope.externalUserId).toBe('guest@example.com');
    expect(envelope.email).toBe('guest@example.com');
    expect(envelope.messageText).toBe('Где пароль от Wi-Fi?');
    expect(envelope.metadata).toEqual(
      expect.objectContaining({
        provider: 'email',
        providerMessageId: 'mail-1@example.com',
        externalMessageId: 'mail-1@example.com',
      }),
    );
    expect(envelope.update_id).toEqual(expect.any(Number));
  });

  it('routes email outbound replies through the canonical communication core', async () => {
    const canon = getCommunicationCanon();
    expect(isCanonicalGuestCommunicationChannel('email')).toBe(true);
    expect(canon.ruleGroups.requiredContext.objectOrBooking).toContain('WIFI');

    const result = await processMessage(emailEnvelope('Где пароль от Wi-Fi?', 'email-wifi-1', 'Wi-Fi question'));

    expect(result.outcome).toBe('replied');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][0]).toBe('guest@example.com');
    expect(lastReplyText()).toMatch(/объект|брони/i);
    expect(mockSendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({ subject: 'Re: Wi-Fi question' }));
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('does not hallucinate Wi-Fi, key, parking, or pet facts without object context', async () => {
    const result = await processMessage(
      emailEnvelope('Где Wi-Fi, код от двери, парковка, можно с собакой?', 'email-missing-facts-1'),
    );

    const reply = lastReplyText();
    expect(result.outcome).toBe('replied');
    expect(reply).toMatch(/объект|брони/i);
    expect(reply).not.toMatch(/пароль:\s*\S+|\b\d{4,}\b|free parking|бесплатн|разрешено/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('escalates refund and cancellation requests through canonical policy', async () => {
    const result = await processMessage(emailEnvelope('Хочу отменить бронь и вернуть деньги', 'email-refund-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/отмена\/возврат|оператор/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('escalates urgent access with stronger email wording', async () => {
    const result = await processMessage(
      emailEnvelope('Срочно, не могу войти прямо сейчас у двери в Невском 24, код не работает', 'email-access-urgent-1'),
    );

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toBe('Срочно передаю оператору, чтобы помочь с доступом.');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('drops duplicate inbound email without duplicate replies', async () => {
    const envelope = emailEnvelope('Где пароль от Wi-Fi?', 'email-duplicate-1');

    const first = await processMessage(envelope);
    const second = await processMessage(envelope);

    expect(first.outcome).toBe('replied');
    expect(second.outcome).toBe('duplicate');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});
