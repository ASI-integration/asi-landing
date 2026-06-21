import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { IntentCategory, ProcessOutcome, type TelegramUpdate } from '../types';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

const mockSendMessage = vi.fn().mockResolvedValue(true);
vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('normalizeInbound not used');
    },
    sendMessage: (to: string, content: string) => mockSendMessage(to, content),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

const mockReplyToTelegram = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: vi.fn().mockResolvedValue('LLM reply text'),
}));

vi.mock('../intent', () => ({
  detectIntent: vi.fn().mockResolvedValue({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 }),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: vi.fn(),
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({
    status: 'matched',
    confidence: 1,
    propertyId: 'prop_A',
    guestName: 'Test Guest',
    reservationId: 'res_test',
  }),
}));

import { processUpdate } from '../orchestrator';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';
import {
  __listCommunicationOperationsActionsForTests,
  __resetCommunicationOperationsActionsForTests,
} from '../operations-action';

let nextUpdateId = 9000;
function makeUpdate(text: string): TelegramUpdate {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      chat: { id: 42 },
      from: { language_code: 'ru' },
      text,
    },
  };
}

describe('Telegram guest intent canon in orchestrator', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    __resetCommunicationOperationsActionsForTests();
    mockSendMessage.mockClear();
    mockReplyToTelegram.mockClear();
  });

  it('answers identity/meta with one Telegram reply and no action', async () => {
    const result = await processUpdate(makeUpdate('ты бот?'));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).toContain('официальный ассистент ASI');
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(__listCommunicationOperationsActionsForTests()).toHaveLength(0);
  });

  it('answers smart-bot identity wording with one Telegram reply and no action', async () => {
    const result = await processUpdate(makeUpdate('ты умный бот?'));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).toContain('официальный ассистент ASI');
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(__listCommunicationOperationsActionsForTests()).toHaveLength(0);
  });

  it.each([
    ['greeting', 'привет'],
    ['ping/test', 'тест'],
    ['thanks/ok', 'спасибо'],
  ])('answers %s with one Telegram reply and no operation action', async (_label, text) => {
    const result = await processUpdate(makeUpdate(text));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockReplyToTelegram).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(__listCommunicationOperationsActionsForTests()).toHaveLength(0);
  });

  it('creates one urgent access action and sends one combined reply', async () => {
    const result = await processUpdate(makeUpdate('не могу попасть, код не работает'));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [, sentText] = mockSendMessage.mock.calls[0];
    expect(String(sentText)).toBe('Поняла, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.');
    expect(__listCommunicationOperationsActionsForTests()).toMatchObject([
      { category: 'operator_access_support', priority: 'high' },
    ]);
  });
});
