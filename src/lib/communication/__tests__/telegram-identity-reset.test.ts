import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, type TelegramUpdate } from '../types';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      update: async () => ({ error: null }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: { message: 'not found' } }),
        }),
      }),
    }),
  },
}));

const mockSendMessage = vi.fn().mockResolvedValue(true);
vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockSendMessage(...args),
  answerTelegramCallbackQuery: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: vi.fn().mockResolvedValue('LLM reply'),
}));

vi.mock('../intent', () => ({
  detectIntent: async () => ({ intent: 'general_question', confidence: 0.95 }),
}));

vi.mock('../classifier', () => ({
  classify: () => ({ category: 'greeting', lang: 'ru', slots: {} }),
  classifyMessage: async () => ({ category: 'greeting', lang: 'ru', slots: {} }),
  extractSlots: () => ({}),
  deterministicReply: () => 'fallback',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT: 'SYSTEM',
}));

vi.mock('../context', () => ({
  buildCommunicationContext: async () => ({
    memory: {},
    intentResult: { intent: 'general_question', confidence: 0.95 },
    reservation: { status: 'unmatched', confidence: 0 },
    knowledge: {},
    recentMessages: [],
  }),
}));

vi.mock('../autopilot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autopilot')>();
  return {
    ...actual,
    decideCommunicationAutopilotResponseWithLlmRouter: vi.fn().mockResolvedValue({
      action: 'auto_reply',
      replyText: 'Гостевой ответ.',
      confidence: 0.9,
      escalationReason: null,
      metadata: { intent: 'general_question', urgent: false, missingContext: [], matchedSignals: [], channelMode: 'live', policy: ['test'] },
    }),
  };
});

vi.mock('../templates', () => ({
  getPropertyTemplates: async () => null,
}));

vi.mock('../background', () => ({
  runInBackground: (_meta: unknown, fn: () => unknown) => {
    void fn();
  },
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({ status: 'unmatched', confidence: 0 }),
}));

import { __resetAutonomousSessionStoreForTests, loadAutonomousSession } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';
import { __resetIdentityCacheForTests, createOrMergeIdentity } from '../identity';
import { __resetSessionStatusStoreForTests, getSessionStatusSync } from '../session-status';
import { UNKNOWN_IDENTITY_CLARIFY_RU, RESET_IDENTITY_CLARIFY_RU } from '../communication-identity-routing';

const RESET_IDENTITY_REPLY_RU = RESET_IDENTITY_CLARIFY_RU;

let nextUpdateId = 71_000;
function makeUpdate(text: string, chatId = 4242): TelegramUpdate {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      chat: { id: chatId },
      from: { id: chatId, language_code: 'ru', username: 'acceptance_user' },
      text,
    },
  };
}

describe('telegram /reset_identity acceptance tooling', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    __resetIdentityCacheForTests();
    __resetSessionStatusStoreForTests();
    mockSendMessage.mockClear();
    delete process.env.COMM_TELEGRAM_RESET_ALLOWLIST;
    delete process.env.COMM_TELEGRAM_RESET_ALLOWLIST_PROD;
  });

  it('allows /reset_identity for allowlisted chat ids and returns identity clarify with inline keyboard immediately', async () => {
    process.env.COMM_TELEGRAM_RESET_ALLOWLIST = '4242';
    const { processUpdate } = await import('../orchestrator');

    await createOrMergeIdentity({
      channel: 'telegram',
      externalUserId: '4242',
      chatId: '4242',
      messageText: '/guest_test',
      receivedAt: new Date(),
      metadata: { guestTestMode: true },
    });

    await processUpdate(makeUpdate('/guest_test не работает Wi-Fi'));
    expect(loadAutonomousSession(4242)?.identity_role).toBe('test_guest');

    const reset = await processUpdate(makeUpdate('/reset_identity'));
    expect(reset.reply).toBe(RESET_IDENTITY_REPLY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'acceptance_reset_identity',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Я гость по бронированию', callback_data: 'identity:guest' },
            { text: 'Я владелец / управляющий объекта', callback_data: 'identity:owner_manager' },
          ],
          [
            { text: 'Хочу подключить ASI', callback_data: 'identity:lead' },
            { text: 'Нужна поддержка', callback_data: 'identity:support_problem' },
          ],
        ],
      },
    });
    expect(loadAutonomousSession(4242)?.identity_role).toBeUndefined();
    expect(getSessionStatusSync(4242)).toBe('inquiry');

    const greet = await processUpdate(makeUpdate('здравствуйте'));
    expect(greet.outcome).toBe(ProcessOutcome.Replied);
    expect(greet.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:unknown_clarify',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Я гость по бронированию', callback_data: 'identity:guest' },
            { text: 'Я владелец / управляющий объекта', callback_data: 'identity:owner_manager' },
          ],
          [
            { text: 'Хочу подключить ASI', callback_data: 'identity:lead' },
            { text: 'Нужна поддержка', callback_data: 'identity:support_problem' },
          ],
        ],
      },
    });
    expect(mockSendMessage.mock.calls.at(-1)?.[2]?.reply_markup).not.toHaveProperty('keyboard');
  });
});
