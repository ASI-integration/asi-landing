import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboundMessageEnvelope } from '../types';
import { MaxAdapter } from '../channels/max';

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
    entityId: 'guest-max',
    propertyId: null,
    reservationId: null,
    leadId: null,
    confidence: 1,
    status: 'resolved',
    reason: 'max-test',
    guestId: 'guest-max',
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
      entityId: 'guest-max',
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
import { getCommunicationCanon, isCanonicalGuestCommunicationChannel } from '../communication-canon';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function maxEnvelope(messageText: string, providerMessageId: string): InboundMessageEnvelope {
  return {
    channel: 'max',
    externalUserId: 'max-user-1',
    chatId: '99001',
    messageText,
    receivedAt: new Date('2026-05-08T10:00:00.000Z'),
    update_id: providerMessageId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 7000),
    metadata: {
      provider: 'max',
      providerMessageId,
      externalMessageId: providerMessageId,
      message_id: providerMessageId,
      user_id: 'max-user-1',
      chat_id: '99001',
      update_type: 'message_created',
    },
  };
}

function lastReplyText(): string {
  return String(mockSendMessage.mock.calls.at(-1)?.[1] ?? '');
}

describe('MAX canonical communication channel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
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
    delete process.env.MAX_BOT_TOKEN;
    delete process.env.MAX_API_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes MAX inbound webhook into stable envelope identifiers', async () => {
    const adapter = new MaxAdapter();
    const envelope = await adapter.normalizeInbound({
      update_type: 'message_created',
      update_id: 'max-event-1',
      timestamp: 1715158800,
      message: {
        id: 'msg-1',
        sender: { user_id: 'max-user-1' },
        recipient: { chat_id: 'max-chat-1' },
        body: { text: 'вафля?' },
        timestamp: 1715158800,
      },
    });

    expect(envelope.channel).toBe('max');
    expect(envelope.externalUserId).toBe('max-user-1');
    expect(envelope.chatId).toBe('max-chat-1');
    expect(envelope.messageText).toBe('вафля?');
    expect(envelope.metadata).toEqual(
      expect.objectContaining({
        provider: 'max',
        providerMessageId: 'max:max-event-1',
        externalMessageId: 'max:max-event-1',
        update_type: 'message_created',
        user_id: 'max-user-1',
        chat_id: 'max-chat-1',
      }),
    );
    expect(envelope.update_id).toEqual(expect.any(Number));
  });

  it('sends outbound MAX replies with Authorization header and chat_id target', async () => {
    process.env.MAX_BOT_TOKEN = 'max-token-1';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MaxAdapter();
    const sent = await adapter.sendMessage('max-chat-1', 'hello', { chat_id: 'max-chat-1', user_id: 'max-user-1' });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstFetchCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstFetchCall[0]).toBe('https://platform-api2.max.ru/messages?chat_id=max-chat-1');
    expect(firstFetchCall[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'max-token-1',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ text: 'hello' }),
      }),
    );
  });

  it('routes MAX casual RU message through shared canon without Wi-Fi hallucination', async () => {
    const result = await processMessage(maxEnvelope('вафля?', 'max-wifi-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/объект|брони/i);
    expect(lastReplyText()).not.toMatch(/пароль:\s*\S+|\b\d{4,}\b/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('escalates urgent access using canonical stronger wording', async () => {
    const result = await processMessage(maxEnvelope('Срочно, я у двери, код не работает', 'max-access-urgent-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/Срочно передаю оператору, чтобы помочь с доступом/i);
  });

  it('escalates refund and cancellation requests through canonical policy', async () => {
    const result = await processMessage(maxEnvelope('Хочу отмену брони и возврат денег', 'max-refund-1'));

    expect(result.outcome).toBe('replied');
    expect(result.escalation).toBeTruthy();
    expect(lastReplyText()).toMatch(/оператор|отмена\/возврат/i);
  });

  it('asks for missing object or booking instead of inventing facts', async () => {
    const result = await processMessage(maxEnvelope('same booking', 'max-same-booking-1'));

    expect(result.outcome).toBe('replied');
    expect(lastReplyText()).toMatch(/property|booking|объект|брон/i);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('drops duplicate MAX messages without duplicate outbound spam', async () => {
    const envelope = maxEnvelope('вафля?', 'max-duplicate-1');

    const first = await processMessage(envelope);
    const second = await processMessage(envelope);

    expect(first.outcome).toBe('replied');
    expect(second.outcome).toBe('duplicate');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('is included in canonical channel set and communication dashboard filters', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/dashboard/communication/page.tsx'), 'utf8');
    const canon = getCommunicationCanon();

    expect(isCanonicalGuestCommunicationChannel('max')).toBe(true);
    expect(canon.ruleGroups.prohibitedHallucinations).toContain('do_not_guess_wifi_password_or_door_code');
    expect(pageSource).toContain("{ key: 'max', label: 'MAX'");
    expect(pageSource).toContain("review.channel === 'max'");
  });
});
