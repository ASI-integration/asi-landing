import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tgTextUpdate } from '@/lib/communication/dev/telegram-fixtures';
import {
  TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES,
  type TelegramMultiIntentAcceptanceFixture,
} from './fixtures/telegram-multi-intent-acceptance.fixtures';

const mockSendMessage = vi.fn().mockResolvedValue(true);
const mockReplyToTelegram = vi.fn().mockResolvedValue(true);
const mockCallLLM = vi.fn().mockResolvedValue('LLM fallback should not be used');
const mockDetectIntent = vi.fn().mockResolvedValue({ intent: 'general_question', confidence: 0.95 });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('normalizeInbound should not be called in processUpdate tests');
    },
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
    entityId: 'guest-1',
    propertyId: null,
    reservationId: null,
    leadId: null,
    confidence: 1,
    status: 'resolved',
    reason: 'test',
    guestId: 'guest-1',
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
      entityId: 'guest-1',
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

vi.mock('../memory', () => {
  const store = new Map<number, Record<string, unknown>>();
  return {
    getContext: (chatId: number) => store.get(chatId) ?? {},
    updateContext: (chatId: number, patch: Record<string, unknown>) => {
      const prev = store.get(chatId) ?? {};
      store.set(chatId, { ...prev, ...patch });
    },
  };
});

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

import { processUpdate } from '../orchestrator';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function lastReplyText(): string {
  const call = mockSendMessage.mock.calls.at(-1);
  return String(call?.[1] ?? '');
}

function operatorWordingCount(text: string): number {
  const matches = text.match(/оператор|передам оператору|эскалац/gi);
  return matches ? matches.length : 0;
}

async function runFixture(
  fixture: TelegramMultiIntentAcceptanceFixture,
  params?: { updateId?: number; chatId?: number },
): Promise<string> {
  const update = tgTextUpdate({
    chat_id: params?.chatId ?? 9001,
    update_id: params?.updateId ?? Date.now(),
    message_id: (params?.updateId ?? Date.now()) + 1,
    text: fixture.text,
    language_code: 'ru',
  });
  const result = await processUpdate(update);
  expect(result.outcome).toBe('replied');
  const reply = lastReplyText();
  expect(reply).toContain('По пунктам');
  expect(mockReplyToTelegram).toHaveBeenCalledTimes(0);
  return reply;
}

describe('Telegram multi-intent operational acceptance runner', () => {
  beforeEach(() => {
    resetIdempotency();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    mockSendMessage.mockClear();
    mockReplyToTelegram.mockClear();
    mockCallLLM.mockClear();
    mockDetectIntent.mockClear();
    mockDetectIntent.mockResolvedValue({ intent: 'general_question', confidence: 0.95 });
  });

  it('splits one inbound RU message into sections and keeps no duplicate slow_ack', async () => {
    const fixture = TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES[0];
    const reply = await runFixture(fixture, { updateId: 5010 });

    expect(reply).toContain('1.');
    expect(reply).toContain('2.');
    expect(reply).not.toContain('Поняла, уже разбираюсь с запросом. Вернусь с ответом через пару секунд.');
    for (const keyword of fixture.expectedSections) {
      expect(reply.toLowerCase()).toContain(keyword.toLowerCase());
    }
    expect(operatorWordingCount(reply) > 0).toBe(fixture.expectsOperator);
  });

  it('preserves known object/booking context across turns for the same message', async () => {
    const reply = await runFixture(TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES[1], { updateId: 5103, chatId: 9010 });
    expect(reply).not.toMatch(/уточните.*объект|номер брони/i);
    expect(reply).toMatch(/15:00|ранний заезд/i);
  });

  it('shows operator/escalation wording for complaint + urgent access case only', async () => {
    const fixture = TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES[2];
    const reply = await runFixture(fixture, { updateId: 5201 });

    for (const keyword of fixture.expectedSections) {
      expect(reply.toLowerCase()).toContain(keyword.toLowerCase());
    }
    expect(operatorWordingCount(reply) > 0).toBe(fixture.expectsOperator);
  });

  it('asks once for object/booking when unknown, not once per intent', async () => {
    const fixture = TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES[3];
    const reply = await runFixture(fixture, { updateId: 5301 });

    for (const keyword of fixture.expectedSections) {
      expect(reply.toLowerCase()).toContain(keyword.toLowerCase());
    }
    const singleClarifyMatches =
      reply.match(/уточните один раз объект или номер брони|уточните, пожалуйста, объект или номер брони/gi) ?? [];
    expect(singleClarifyMatches.length).toBe(1);
  });

  it('does not emit a slow_ack after final multi-intent operational reply', async () => {
    const fixture = TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES[0];
    await runFixture(fixture, { updateId: 5401, chatId: 9040 });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('По пунктам:\n1.');
    expect(reply).not.toMatch(/Поняла, уже разбираюсь с запросом|через пару секунд|slow[_\s-]?ack/i);
  });
});
