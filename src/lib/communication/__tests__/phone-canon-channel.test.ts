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
    entityType: 'unknown',
    entityId: 'guest-phone',
    propertyId: null,
    reservationId: null,
    leadId: null,
    confidence: 0.55,
    status: 'unresolved',
    reason: 'phone-test',
    guestId: 'guest-phone',
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
      entityType: 'unknown',
      entityId: 'guest-phone',
      confidence: 0.55,
      status: 'unresolved',
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

import { getCommunicationCanon, isCanonicalGuestCommunicationChannel } from '../communication-canon';
import { processMessage } from '../orchestrator';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function phoneEnvelope(messageText: string, providerMessageId: string): InboundMessageEnvelope {
  return {
    channel: 'phone',
    externalUserId: '+15550001111',
    phoneNumber: '+15550001111',
    messageText,
    receivedAt: new Date('2026-05-08T10:00:00.000Z'),
    update_id: providerMessageId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 9000),
    metadata: {
      provider: 'phone-test',
      providerMessageId,
      externalMessageId: providerMessageId,
      message_id: providerMessageId,
      phone_event_type: 'call_transcribed',
      provider_call_id: providerMessageId,
    },
  };
}

function lastReplyText(): string {
  return String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
}

describe('Phone canonical communication channel', () => {
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

  it('is included in the shared canonical communication channel set', () => {
    const canon = getCommunicationCanon();

    expect(isCanonicalGuestCommunicationChannel('phone')).toBe(true);
    expect(canon.ruleGroups.prohibitedHallucinations).toContain('do_not_guess_wifi_password_or_door_code');
  });

  it('escalates urgent access transcripts with canonical phone wording', async () => {
    const result = await processMessage(
      phoneEnvelope('Срочно, я у двери, код не работает', 'phone-access-urgent-1'),
    );

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toBe('Срочно передаю оператору, чтобы помочь с доступом.');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('escalates refund and cancellation transcripts through canonical policy', async () => {
    const result = await processMessage(phoneEnvelope('Хочу отменить бронь и вернуть деньги', 'phone-refund-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/отмена\/возврат|оператор/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('does not hallucinate property facts when transcript lacks booking or object context', async () => {
    const result = await processMessage(
      phoneEnvelope('Где Wi-Fi, код от двери, парковка, можно с собакой?', 'phone-missing-facts-1'),
    );

    const reply = lastReplyText();
    expect(result.outcome).toBe('replied');
    expect(reply).toMatch(/объект|брони/i);
    expect(reply).not.toMatch(/пароль:\s*\S+|\b\d{4,}\b|free parking|бесплатн|разрешено/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
