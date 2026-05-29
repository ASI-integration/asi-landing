import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { IntentCategory, ProcessOutcome, type TelegramUpdate } from '../types';

const mockSendMessage = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'task_mock' }, error: null }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: 'not found' } }),
          maybeSingle: async () => ({ data: null, error: null }),
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
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
      throw new Error('normalizeInbound not used in telegram target regression tests');
    },
    sendMessage: (to: string, content: string, metadata?: Record<string, unknown>) =>
      mockSendMessage(to, content, metadata),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: vi.fn().mockResolvedValue('LLM reply text'),
}));

const mockDetectIntent = vi.fn().mockResolvedValue({
  intent: IntentCategory.GeneralQuestion,
  confidence: 0.9,
});
vi.mock('../intent', () => ({
  detectIntent: (...args: unknown[]) => mockDetectIntent(...args),
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

import { processMessage, processUpdate } from '../orchestrator';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import {
  __resetEscalationReviewStoreForTests,
  listEscalationReviews,
  sendOperatorReply,
} from '../operator-review';

describe('Telegram outbound target regression', () => {
  let nextUpdateId = 30_000;

  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    mockSendMessage.mockClear();
    mockSendMessage.mockResolvedValue(true);
    mockDetectIntent.mockReset().mockResolvedValue({
      intent: IntentCategory.GeneralQuestion,
      confidence: 0.9,
    });
  });

  it('sends normal Telegram guest replies to telegram_chat_id metadata, not internal ids', async () => {
    const result = await processMessage({
      channel: 'telegram',
      externalUserId: '56750',
      chatId: '56750',
      messageText: 'what time is check-in?',
      receivedAt: new Date(),
      update_id: nextUpdateId++,
      metadata: {
        telegram_chat_id: '931919812',
        providerMessageId: 'tg-msg-normal-target',
        actorId: '56750',
        guestId: '56750',
        identityGuestId: '56750',
        sessionId: '56750',
        userId: '56750',
      },
    });

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockSendMessage).toHaveBeenCalled();
    expect(mockSendMessage.mock.calls.at(-1)?.[0]).toBe('931919812');
    expect(mockSendMessage.mock.calls.at(-1)?.[0]).not.toBe('56750');
  });

  it('refuses to send Telegram outbound when only internal ids are available', async () => {
    const result = await processMessage({
      channel: 'telegram',
      externalUserId: '56750',
      chatId: '56750',
      messageText: 'what time is check-in?',
      receivedAt: new Date(),
      update_id: nextUpdateId++,
      metadata: {
        providerMessageId: 'tg-msg-internal-only',
        guestId: '56750',
        identityGuestId: '56750',
        sessionId: '56750',
        userId: '56750',
      },
    });

    expect(result.outcome).toBe(ProcessOutcome.Error);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sends edited-message acknowledgement/reprocess replies to the Telegram chat id', async () => {
    const update: TelegramUpdate = {
      update_id: nextUpdateId++,
      edited_message: {
        message_id: 81_001,
        edit_date: 1_779_999_000,
        chat: { id: 931919812 },
        from: { language_code: 'en' },
        text: 'check-out at 11am',
      },
    };

    const result = await processUpdate(update);

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockSendMessage).toHaveBeenCalled();
    expect(mockSendMessage.mock.calls.at(-1)?.[0]).toBe('931919812');
    expect(mockSendMessage.mock.calls.at(-1)?.[0]).not.toBe('56750');
  });

  it('stores escalation reviews with Telegram chat id so operator replies use the provider target', async () => {
    mockDetectIntent.mockResolvedValueOnce({ intent: IntentCategory.Unknown, confidence: 0.4 });
    const result = await processMessage({
      channel: 'telegram',
      externalUserId: '56750',
      chatId: '56750',
      messageText: 'unclear guest problem',
      receivedAt: new Date(),
      update_id: nextUpdateId++,
      metadata: {
        telegram_chat_id: '931919812',
        providerMessageId: 'tg-msg-operator-target',
        actorId: '56750',
        guestId: '56750',
        identityGuestId: '56750',
        sessionId: '56750',
      },
    });

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const [review] = listEscalationReviews({ status: 'pending' });
    expect(review?.targetId).toBe('931919812');
    expect(review?.targetId).not.toBe('56750');

    mockSendMessage.mockClear();
    const operatorResult = await sendOperatorReply({
      reviewId: review!.reviewId,
      operatorId: 'op_telegram_target',
      replyText: 'Operator reply',
    });

    expect(operatorResult.ok).toBe(true);
    expect(mockSendMessage.mock.calls.at(-1)?.[0]).toBe('931919812');
    expect(mockSendMessage.mock.calls.at(-1)?.[0]).not.toBe('56750');
  });
});
