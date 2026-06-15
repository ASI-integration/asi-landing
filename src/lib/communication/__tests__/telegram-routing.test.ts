import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tgTextUpdate } from '../dev/telegram-fixtures';

const mockReplyToTelegram = vi.fn();
const mockAnswerTelegramCallbackQuery = vi.fn();
const mockSendTelegramMessageToChat = vi.fn();
const mockBeginLead = vi.fn();
const mockBeginSupport = vi.fn();
const mockDecideAutopilot = vi.fn();
const mockLookupBooking = vi.fn();
const mockResolveGuestContext = vi.fn();
const mockLookupProperty = vi.fn();

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
  answerTelegramCallbackQuery: (...args: unknown[]) => mockAnswerTelegramCallbackQuery(...args),
  sendTelegramMessageToChat: (...args: unknown[]) => mockSendTelegramMessageToChat(...args),
}));

vi.mock('@/lib/communication/telegram-lead-intake', async () => {
  const actual = await vi.importActual<typeof import('../telegram-lead-intake')>('../telegram-lead-intake');
  return {
    ...actual,
    beginTelegramLeadIntakeFromRouting: (...args: unknown[]) => mockBeginLead(...args),
    beginTelegramSupportFromRouting: (...args: unknown[]) => mockBeginSupport(...args),
  };
});

vi.mock('@/lib/communication/autopilot', () => ({
  decideCommunicationAutopilotResponseWithLlmRouter: (...args: unknown[]) => mockDecideAutopilot(...args),
}));

vi.mock('@/lib/communication/telegram-booking-object-memory', () => ({
  lookup_booking_by_telegram: (...args: unknown[]) => mockLookupBooking(...args),
  resolveTelegramGuestBookingObjectContext: (...args: unknown[]) => mockResolveGuestContext(...args),
  lookup_property_by_booking: (...args: unknown[]) => mockLookupProperty(...args),
  bookingObjectContextToAutopilotFields: () => ({
    bookingVerified: true,
    propertyResolved: true,
    object: { id: 'test-prop-tg-live', name: 'Тестовая квартира ASI', address: 'Невский 24' },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import {
  __resetTelegramRoutingSessionsForTests,
  getTelegramRoutingSession,
} from '../telegram-routing-session';
import {
  buildGuestTestDeepLink,
  processTelegramRoutingUpdate,
} from '../telegram-routing';

function routingUpdate(text: string, update_id = 2000) {
  const update = tgTextUpdate({
    chat_id: 8101,
    user_id: 9101,
    update_id,
    message_id: update_id,
    text,
  });
  update.message!.from = {
    id: 9101,
    username: 'guest_tester',
    first_name: 'Гость',
    language_code: 'ru',
  };
  return update;
}

function roleCallback(role: string, update_id = 2001) {
  return {
    update_id,
    callback_query: {
      id: `cb-${update_id}`,
      from: {
        id: 9101,
        username: 'guest_tester',
        first_name: 'Гость',
        language_code: 'ru',
      },
      message: {
        message_id: update_id,
        chat: { id: 8101 },
      },
      data: `tr:role:${role}`,
    },
  };
}

describe('Telegram routing layer', () => {
  beforeEach(() => {
    __resetTelegramRoutingSessionsForTests();
    mockReplyToTelegram.mockReset();
    mockAnswerTelegramCallbackQuery.mockReset();
    mockSendTelegramMessageToChat.mockReset();
    mockBeginLead.mockReset();
    mockBeginSupport.mockReset();
    mockDecideAutopilot.mockReset();
    mockLookupBooking.mockReset();
    mockResolveGuestContext.mockReset();
    mockLookupProperty.mockReset();

    mockReplyToTelegram.mockResolvedValue(true);
    mockAnswerTelegramCallbackQuery.mockResolvedValue(true);
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    mockLookupBooking.mockResolvedValue(null);
    mockResolveGuestContext.mockResolvedValue({
      booking_resolved: false,
      property_resolved: false,
      access_verified: false,
      wifi_verified: false,
      lookup_reason: 'no_match',
    });
    mockLookupProperty.mockResolvedValue({
      object_id: 'test-prop-tg-live',
      object_name: 'Тестовая квартира ASI',
      address: 'Санкт-Петербург, Невский проспект, 24',
      directions_text: 'Вход со двора.',
      check_in_text: 'Заезд с 15:00.',
      checkout_time: '12:00',
      wifi_name: 'ASI-Nevsky24-Guest',
      wifi_password: 'test-wifi-nevsky24',
      house_rules_text: 'Тишина после 22:00.',
    });
    mockDecideAutopilot.mockResolvedValue({
      action: 'auto_reply',
      confidence: 0.92,
      replyText: 'Адрес: Санкт-Петербург, Невский проспект, 24.',
      metadata: { intent: 'address_instruction', missingContext: [], matchedSignals: [], policy: [] },
    });
    mockBeginLead.mockResolvedValue({
      outcome: 'replied',
      update_id: 2002,
      chat_id: 8101,
      reply: 'Сколько объектов у вас сейчас?',
    });
    mockBeginSupport.mockResolvedValue({
      outcome: 'replied',
      update_id: 2003,
      chat_id: 8101,
      reply: 'Напишите вопрос одним сообщением.',
    });

    process.env.ASI_FEEDBACK_BOT_TOKEN = 'feedback-token';
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '-100admin';
    process.env.NEXT_PUBLIC_ASI_FEEDBACK_BOT_USERNAME = 'ASI_Global_Bot';
  });

  it('shows role selection on /start instead of starting lead intake', async () => {
    const result = await processTelegramRoutingUpdate(routingUpdate('/start site', 2000));

    expect(result?.reply).toContain('Подскажите, пожалуйста, кто вы');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).toContain('Я гость по бронированию');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).toContain('Хочу подключить ASI');
    expect(mockBeginLead).not.toHaveBeenCalled();
  });

  it('starts lead intake only after choosing connect ASI', async () => {
    await processTelegramRoutingUpdate(roleCallback('lead', 2001));

    expect(mockBeginLead).toHaveBeenCalledTimes(1);
    expect(getTelegramRoutingSession(8101)?.role).toBe('lead');
  });

  it('routes support choice to support flow', async () => {
    await processTelegramRoutingUpdate(roleCallback('support', 2004));

    expect(mockBeginSupport).toHaveBeenCalledTimes(1);
  });

  it('activates guest test mode and answers passport questions in autopilot', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2005));
    expect(getTelegramRoutingSession(8101)?.testGuest).toBe(true);

    await processTelegramRoutingUpdate(routingUpdate('Какой адрес?', 2006));

    expect(mockDecideAutopilot).toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      'Адрес: Санкт-Петербург, Невский проспект, 24.',
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockSendTelegramMessageToChat).toHaveBeenCalled();
  });

  it('builds guest test deep link for dashboard', () => {
    expect(buildGuestTestDeepLink('obj-123')).toContain('guest_test_obj-123');
    expect(buildGuestTestDeepLink()).toContain('guest_test');
  });
});
