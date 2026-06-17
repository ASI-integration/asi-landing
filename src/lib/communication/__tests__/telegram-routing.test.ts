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
const mockUpsertCrmContactFromTelegram = vi.fn();
const mockRecordCrmCommunicationEvent = vi.fn();
const mockRecordCrmEventFromOwnerNotification = vi.fn();

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

vi.mock('@/lib/communication/persistence', () => ({
  saveCommunicationAutopilotDecision: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/lib/crm/repository', () => ({
  upsertCrmContactFromTelegram: (...args: unknown[]) => mockUpsertCrmContactFromTelegram(...args),
  recordCrmCommunicationEvent: (...args: unknown[]) => mockRecordCrmCommunicationEvent(...args),
  recordCrmEventFromOwnerNotification: (...args: unknown[]) => mockRecordCrmEventFromOwnerNotification(...args),
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
    mockUpsertCrmContactFromTelegram.mockReset();
    mockRecordCrmCommunicationEvent.mockReset();
    mockRecordCrmEventFromOwnerNotification.mockReset();

    mockReplyToTelegram.mockResolvedValue(true);
    mockAnswerTelegramCallbackQuery.mockResolvedValue(true);
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    mockUpsertCrmContactFromTelegram.mockResolvedValue({});
    mockRecordCrmCommunicationEvent.mockResolvedValue(undefined);
    mockRecordCrmEventFromOwnerNotification.mockResolvedValue(undefined);
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
    await Promise.resolve();

    expect(mockBeginLead).toHaveBeenCalledTimes(1);
    expect(getTelegramRoutingSession(8101)?.role).toBe('lead');
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'role_selected_lead',
    }));
  });

  it('routes support choice to support flow', async () => {
    await processTelegramRoutingUpdate(roleCallback('support', 2004));

    expect(mockBeginSupport).toHaveBeenCalledTimes(1);
  });

  it('records owner role selection in CRM without starting lead intake', async () => {
    await processTelegramRoutingUpdate(roleCallback('owner', 2007));
    await Promise.resolve();

    expect(mockBeginLead).not.toHaveBeenCalled();
    expect(mockUpsertCrmContactFromTelegram).toHaveBeenCalledWith(expect.objectContaining({
      role: 'owner',
      source: 'telegram',
      telegramUsername: 'guest_tester',
      status: 'qualified',
    }));
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'role_selected_owner',
    }));
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('/dashboard/properties'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('sends owner to the next setup step when a linked object is incomplete', async () => {
    mockUpsertCrmContactFromTelegram.mockResolvedValueOnce({
      propertySummary: {
        id: 'prop-setup',
        title: 'ASI Test Flat',
        missingOperationalItems: [
          {
            id: 'wifi',
            label: 'Wi-Fi и инструкции',
            done: false,
            hint: '',
            actionHref: '/dashboard/properties/prop-setup/setup?step=wifi',
            actionLabel: 'Добавить Wi-Fi',
          },
        ],
      },
    });

    await processTelegramRoutingUpdate(roleCallback('owner', 2008));

    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('/dashboard/properties/prop-setup/setup?step=wifi'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('keeps pilot application context when owner Telegram is linked by username', async () => {
    mockUpsertCrmContactFromTelegram.mockResolvedValueOnce({
      source: 'pilot_form',
      status: 'pilot_candidate',
      propertySummary: null,
      nextAction: 'Выбрать в пилот и предложить создать объект',
    });

    await processTelegramRoutingUpdate(roleCallback('owner', 2014));

    expect(mockUpsertCrmContactFromTelegram).toHaveBeenCalledWith(expect.objectContaining({
      role: 'owner',
      telegramUsername: 'guest_tester',
      telegramChatId: 8101,
    }));
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('/dashboard/properties'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('sends selected pilot owner to property creation without changing pilot source', async () => {
    mockUpsertCrmContactFromTelegram.mockResolvedValueOnce({
      source: 'pilot_form',
      status: 'pilot_selected',
      propertySummary: null,
      nextAction: 'Предложить создать объект',
    });

    const result = await processTelegramRoutingUpdate(roleCallback('owner', 2015));

    expect(mockUpsertCrmContactFromTelegram).toHaveBeenCalledWith(expect.objectContaining({
      role: 'owner',
      source: 'telegram',
      telegramUsername: 'guest_tester',
      status: 'qualified',
    }));
    expect(result?.reply).toBe(
      'Вы выбраны в пилот ASI. Следующий шаг: создать первый объект в личном кабинете.\nhttps://asi-global.ru/dashboard/properties',
    );
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      'Вы выбраны в пилот ASI. Следующий шаг: создать первый объект в личном кабинете.\nhttps://asi-global.ru/dashboard/properties',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('offers guest_test when owner linked object is ready', async () => {
    mockUpsertCrmContactFromTelegram.mockResolvedValueOnce({
      propertySummary: {
        id: 'prop-ready',
        title: 'ASI Ready Flat',
        missingOperationalItems: [],
      },
    });

    await processTelegramRoutingUpdate(roleCallback('owner', 2009));

    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('/guest_test prop-ready'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('activates guest test mode and answers passport questions in autopilot', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2005));
    await Promise.resolve();
    expect(getTelegramRoutingSession(8101)?.testGuest).toBe(true);
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'guest_test_started',
    }));

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

  it('handles real emergency as CRM escalation and guest safety reply', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2020));
    await Promise.resolve();
    mockSendTelegramMessageToChat.mockClear();
    mockRecordCrmCommunicationEvent.mockClear();
    mockRecordCrmEventFromOwnerNotification.mockClear();
    mockDecideAutopilot.mockClear();

    const result = await processTelegramRoutingUpdate(routingUpdate('Пожар и дым в квартире', 2021));
    await Promise.resolve();

    expect(result?.reply).toContain('112');
    expect(result?.reply).toContain('101');
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(mockSendTelegramMessageToChat).toHaveBeenCalled();
    expect(mockRecordCrmEventFromOwnerNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'escalation_created',
      escalationReason: 'emergency_fire',
      severity: 'critical',
    }));
  });

  it('does not create critical escalation for explicit emergency test phrase', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2022));
    await Promise.resolve();
    mockSendTelegramMessageToChat.mockClear();
    mockRecordCrmCommunicationEvent.mockClear();

    const result = await processTelegramRoutingUpdate(routingUpdate('тест пожар', 2023));

    expect(result?.reply).toContain('Emergency Protocol');
    expect(mockSendTelegramMessageToChat).not.toHaveBeenCalled();
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'note',
      metadata: expect.objectContaining({
        real_escalation_created: false,
      }),
    }));
  });

  it('resets telegram test state with /reset_test_state', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2024));
    expect(getTelegramRoutingSession(8101)?.testGuest).toBe(true);

    const result = await processTelegramRoutingUpdate(routingUpdate('/reset_test_state', 2025));

    expect(result?.reply).toContain('/start');
    expect(getTelegramRoutingSession(8101)).toBeUndefined();
  });

  it('does not leak operator notification into guest chat when admin chat matches guest chat', async () => {
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '8101';
    mockDecideAutopilot.mockResolvedValueOnce({
      action: 'escalate',
      confidence: 0.9,
      replyText: 'Сейчас уточню точный адрес у оператора и напишу вам здесь.',
      escalationReason: 'address_directions',
      metadata: {
        intent: 'address_instruction',
        missingContext: ['object.address', 'object.directionsText'],
        matchedSignals: [],
        policy: [],
      },
    });

    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2010));
    await processTelegramRoutingUpdate(routingUpdate('Какой адрес?', 2011));

    expect(mockSendTelegramMessageToChat).not.toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      'Сейчас уточню точный адрес у оператора и напишу вам здесь.',
      expect.any(Object),
      expect.any(Object),
    );
    const guestReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
    expect(guestReply).not.toContain('Намерение:');
    expect(guestReply).not.toContain('object.address');
    expect(guestReply).not.toContain('prop_A');
  });

  it('sanitizes guest reply when autopilot draft contains forbidden internal tokens', async () => {
    mockDecideAutopilot.mockResolvedValueOnce({
      action: 'escalate',
      confidence: 0.5,
      replyText: 'Намерение: address_instruction. Не хватает: object.address',
      escalationReason: 'address_directions',
      metadata: {
        intent: 'address_instruction',
        missingContext: ['object.address'],
        matchedSignals: [],
        policy: [],
      },
    });

    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2012));
    await processTelegramRoutingUpdate(routingUpdate('Какой адрес?', 2013));

    const guestReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
    expect(guestReply).toBe('Сейчас уточню этот вопрос у оператора и напишу вам здесь.');
    expect(guestReply).not.toContain('object.address');
  });

  it('builds guest test deep link for dashboard', () => {
    expect(buildGuestTestDeepLink('obj-123')).toContain('guest_test_obj-123');
    expect(buildGuestTestDeepLink()).toContain('guest_test');
  });
});
