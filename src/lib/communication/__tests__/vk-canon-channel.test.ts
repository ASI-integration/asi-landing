import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';
import { VkAdapter } from '../channels/vk';

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
    entityId: 'guest-vk',
    propertyId: null,
    reservationId: null,
    leadId: null,
    confidence: 1,
    status: 'resolved',
    reason: 'vk-test',
    guestId: 'guest-vk',
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
      entityId: 'guest-vk',
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

import { processMessage } from '../orchestrator';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function vkEnvelope(messageText: string, providerMessageId: string): InboundMessageEnvelope {
  return {
    channel: 'vk',
    externalUserId: '112233',
    chatId: '2000000411',
    messageText,
    receivedAt: new Date('2026-05-08T10:00:00.000Z'),
    update_id: providerMessageId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 2000),
    metadata: {
      provider: 'vk',
      providerMessageId,
      externalMessageId: providerMessageId,
      message_id: providerMessageId,
      peer_id: 2000000411,
      from_id: 112233,
    },
  };
}

function lastReplyText(): string {
  return String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
}

describe('VK canonical communication channel', () => {
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

  it('normalizes VK inbound callback into stable envelope identifiers', async () => {
    const adapter = new VkAdapter();
    const envelope = await adapter.normalizeInbound({
      type: 'message_new',
      group_id: 77,
      event_id: 'vk-event-1',
      object: {
        message: {
          id: 15,
          conversation_message_id: 91,
          from_id: 112233,
          peer_id: 2000000411,
          text: 'вафля?',
          date: 1715158800,
        },
      },
    });

    expect(envelope.channel).toBe('vk');
    expect(envelope.externalUserId).toBe('112233');
    expect(envelope.chatId).toBe('2000000411');
    expect(envelope.metadata).toEqual(
      expect.objectContaining({
        provider: 'vk',
        providerMessageId: 'vk:77:vk-event-1',
        externalMessageId: 'vk:77:vk-event-1',
      }),
    );
    expect(envelope.update_id).toEqual(expect.any(Number));
  });

  it('routes VK casual RU message through shared canon without Wi-Fi hallucination', async () => {
    const result = await processMessage(vkEnvelope('вафля?', 'vk-wifi-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/объект|брони/i);
    expect(lastReplyText()).not.toMatch(/пароль:\s*\S+|\b\d{4,}\b/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('escalates urgent access using canonical wording', async () => {
    const result = await processMessage(vkEnvelope('Срочно, я у двери, код не работает', 'vk-access-urgent-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/Срочно передаю оператору, чтобы помочь с доступом/i);
  });

  it('escalates refund and cancellation requests', async () => {
    const result = await processMessage(vkEnvelope('Хочу отмену брони и возврат денег', 'vk-refund-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/оператор|отмена\/возврат/i);
  });

  it('asks for missing object or booking instead of inventing facts', async () => {
    const result = await processMessage(vkEnvelope('same booking', 'vk-same-booking-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/property|booking|объект|брон/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('drops duplicate VK message without duplicate outbound spam', async () => {
    const envelope = vkEnvelope('вафля?', 'vk-duplicate-1');

    const first = await processMessage(envelope);
    const second = await processMessage(envelope);

    expect(first.outcome).toBe('replied');
    expect(second.outcome).toBe('duplicate');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});
