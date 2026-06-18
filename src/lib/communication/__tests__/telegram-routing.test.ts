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
const mockLookupGuestTestProperty = vi.fn();
const mockUpsertCrmContactFromTelegram = vi.fn();
const mockRecordCrmCommunicationEvent = vi.fn();
const mockRecordCrmEventFromOwnerNotification = vi.fn();
const mockAttachTelegramToPilotContact = vi.fn();
const mockLoadObjectGuestReadiness = vi.fn();

vi.mock('@/lib/crm/property-readiness-sync', () => ({
  loadObjectGuestReadiness: (...args: unknown[]) => mockLoadObjectGuestReadiness(...args),
}));

vi.mock('@/lib/communication/guest-test-property', () => ({
  lookup_property_for_guest_test: (...args: unknown[]) => mockLookupGuestTestProperty(...args),
}));

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

vi.mock('@/lib/communication/telegram-booking-object-memory', async () => {
  const actual = await vi.importActual<typeof import('../telegram-booking-object-memory')>(
    '../telegram-booking-object-memory',
  );
  return {
    ...actual,
    lookup_booking_by_telegram: (...args: unknown[]) => mockLookupBooking(...args),
    resolveTelegramGuestBookingObjectContext: (...args: unknown[]) => mockResolveGuestContext(...args),
    lookup_property_by_booking: (...args: unknown[]) => mockLookupProperty(...args),
    bookingObjectContextToAutopilotFields: () => ({
      bookingVerified: true,
      propertyResolved: true,
      object: { id: 'test-prop-tg-live', name: 'Тестовая квартира ASI', address: 'Невский 24' },
    }),
  };
});

vi.mock('@/lib/crm/repository', () => ({
  attachTelegramToPilotContact: (...args: unknown[]) => mockAttachTelegramToPilotContact(...args),
  upsertCrmContactFromTelegram: (...args: unknown[]) => mockUpsertCrmContactFromTelegram(...args),
  recordCrmCommunicationEvent: (...args: unknown[]) => mockRecordCrmCommunicationEvent(...args),
  recordCrmEventFromOwnerNotification: (...args: unknown[]) => mockRecordCrmEventFromOwnerNotification(...args),
  updateCrmContact: vi.fn().mockResolvedValue(undefined),
}));

const { supabaseQueryBuilder } = vi.hoisted(() => {
  function buildSupabaseQueryBuilder(result: unknown = { data: null, error: null }) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      update: vi.fn(() => builder),
      upsert: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => result),
      maybeSingle: vi.fn(async () => result),
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  return { supabaseQueryBuilder: buildSupabaseQueryBuilder };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => supabaseQueryBuilder({ data: null, error: null }),
  },
}));

import {
  __resetTelegramRoutingSessionsForTests,
  getTelegramRoutingSession,
} from '../telegram-routing-session';
import { __resetTelegramIdentityMemoryForTests, loadTelegramConversationMemory } from '../telegram-identity-memory';
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
    __resetTelegramIdentityMemoryForTests();
    mockReplyToTelegram.mockReset();
    mockAnswerTelegramCallbackQuery.mockReset();
    mockSendTelegramMessageToChat.mockReset();
    mockBeginLead.mockReset();
    mockBeginSupport.mockReset();
    mockDecideAutopilot.mockReset();
    mockLookupBooking.mockReset();
    mockResolveGuestContext.mockReset();
    mockLookupProperty.mockReset();
    mockLookupGuestTestProperty.mockReset();
    mockUpsertCrmContactFromTelegram.mockReset();
    mockRecordCrmCommunicationEvent.mockReset();
    mockRecordCrmEventFromOwnerNotification.mockReset();
    mockAttachTelegramToPilotContact.mockReset();
    mockLoadObjectGuestReadiness.mockReset();

    mockReplyToTelegram.mockResolvedValue(true);
    mockAnswerTelegramCallbackQuery.mockResolvedValue(true);
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    mockUpsertCrmContactFromTelegram.mockResolvedValue({});
    mockRecordCrmCommunicationEvent.mockResolvedValue(undefined);
    mockRecordCrmEventFromOwnerNotification.mockResolvedValue(undefined);
    mockAttachTelegramToPilotContact.mockResolvedValue(null);
    mockLoadObjectGuestReadiness.mockResolvedValue({
      found: true,
      readiness: {
        propertyId: 'test-prop-tg-live',
        isReady: true,
        items: [],
        completedCount: 7,
        totalCount: 7,
        nextItem: null,
        guestTestDeepLink: 'https://t.me/ASI_Global_Bot?start=guest_test_test-prop-tg-live',
        guestTestCommand: '/guest_test test-prop-tg-live',
        statusMessage: 'ready',
      },
    });
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
    mockLookupGuestTestProperty.mockResolvedValue({
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
      id: 'crm-pilot-1',
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
      expect.stringMatching(/Заявка в пилот принята[\s\S]*\/dashboard\/properties/),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('links pilot application from telegram start payload without creating a duplicate', async () => {
    const contactId = '6c9f99b1-726c-4fcf-d428-bcb23d84df20';

    await processTelegramRoutingUpdate(routingUpdate(`/start pilot_${contactId}`, 2016));

    expect(mockAttachTelegramToPilotContact).toHaveBeenCalledWith(expect.objectContaining({
      contactId,
      telegramUserId: '9101',
      telegramChatId: 8101,
    }));
    expect(mockUpsertCrmContactFromTelegram).not.toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Заявка в пилот ASI принята'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('sends selected pilot owner to property creation without changing pilot source', async () => {
    mockUpsertCrmContactFromTelegram.mockResolvedValueOnce({
      id: 'crm-pilot-2',
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
    expect(result?.reply).toMatch(/Вы выбраны в пилот ASI[\s\S]*\/dashboard\/properties/);
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringMatching(/Вы выбраны в пилот ASI[\s\S]*\/dashboard\/properties/),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('offers guest test when owner linked object is ready', async () => {
    mockUpsertCrmContactFromTelegram.mockResolvedValueOnce({
      propertySummary: {
        id: 'prop-ready',
        title: 'ASI Ready Flat',
        missingOperationalItems: [],
        guestTestHref: 'https://t.me/ASI_Global_Bot?start=guest_test_prop-ready',
      },
    });

    await processTelegramRoutingUpdate(roleCallback('owner', 2009));

    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('guest_test_prop-ready'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('activates guest test mode and answers passport questions from property data', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2005));
    await Promise.resolve();
    expect(getTelegramRoutingSession(8101)?.testGuest).toBe(true);
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'guest_test_started',
    }));

    mockRecordCrmCommunicationEvent.mockClear();
    await processTelegramRoutingUpdate(routingUpdate('Какой адрес?', 2006));

    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Невский проспект, 24'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'guest_test_question',
      metadata: expect.objectContaining({
        outcome: 'answered_from_property_data',
      }),
    }));
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

  it('creates operator follow-up when guest test question needs a human', async () => {
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '8101';
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2010));
    mockRecordCrmCommunicationEvent.mockClear();
    mockSendTelegramMessageToChat.mockClear();

    await processTelegramRoutingUpdate(routingUpdate('Хочу вернуть деньги за бронь', 2011));

    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(mockSendTelegramMessageToChat).not.toHaveBeenCalled();
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_followup_required',
    }));
    const guestReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
    expect(guestReply).toContain('оператор');
  });

  it('answers nearby restaurant questions as concierge without operator escalation', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2080));
    mockRecordCrmCommunicationEvent.mockClear();
    mockSendTelegramMessageToChat.mockClear();

    const result = await processTelegramRoutingUpdate(
      routingUpdate('вы можете порекомендовать какие-то рестораны недалеко?', 2081),
    );

    expect(result?.reply).toContain('кафе и рестораны');
    expect(result?.reply).toContain('Невский');
    expect(result?.reply).not.toMatch(/Тануки|Шоколадница|Му-Му|Якитория|Хачапури|Додо|Вкусно и точка/i);
    expect(mockSendTelegramMessageToChat).not.toHaveBeenCalled();
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'guest_concierge_answered',
      metadata: expect.objectContaining({
        question_type: 'concierge_food',
        outcome: 'answered_by_concierge_autopilot',
        property_id: 'test-prop-tg-live',
        telegram_chat_id: 8101,
      }),
    }));
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'guest_test_question',
      metadata: expect.objectContaining({
        outcome: 'answered_by_concierge_autopilot',
        question_type: 'concierge_food',
      }),
    }));
    expect(mockRecordCrmCommunicationEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'operator_followup_required',
    }));
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

    await processTelegramRoutingUpdate(roleCallback('guest', 2012));
    await processTelegramRoutingUpdate(routingUpdate('Какой адрес?', 2013));

    const guestReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
    expect(guestReply).toBe('Сейчас уточню этот вопрос у оператора и напишу вам здесь.');
    expect(guestReply).not.toContain('object.address');
  });

  it('rejects guest test deep link when property is not found', async () => {
    mockLoadObjectGuestReadiness.mockResolvedValueOnce({ found: false, readiness: null });

    const result = await processTelegramRoutingUpdate(routingUpdate('/start guest_test_missing-prop', 2030));

    expect(result?.reply).toContain('Объект не найден');
    expect(getTelegramRoutingSession(8101)?.testGuest).not.toBe(true);
  });

  it('explains missing setup fields when property is not guest-ready', async () => {
    mockLoadObjectGuestReadiness.mockResolvedValueOnce({
      found: true,
      readiness: {
        propertyId: 'prop-not-ready',
        isReady: false,
        items: [
          { id: 'photos', label: 'Фото', done: false, hint: '', setupStep: 'photos', actionHref: '/setup', actionLabel: 'Добавить фото' },
          { id: 'wifi', label: 'Wi-Fi', done: false, hint: '', setupStep: 'wifi', actionHref: '/setup', actionLabel: 'Добавить Wi-Fi' },
        ],
        completedCount: 5,
        totalCount: 7,
        nextItem: { id: 'photos', label: 'Фото', done: false, hint: '', setupStep: 'photos', actionHref: '/setup', actionLabel: 'Добавить фото' },
        guestTestDeepLink: 'https://t.me/ASI_Global_Bot?start=guest_test_prop-not-ready',
        guestTestCommand: '/guest_test prop-not-ready',
        statusMessage: 'missing',
      },
    });

    const result = await processTelegramRoutingUpdate(routingUpdate('/start guest_test_prop-not-ready', 2031));

    expect(result?.reply).toContain('не хватает');
    expect(result?.reply).toContain('фото');
    expect(getTelegramRoutingSession(8101)?.testGuest).not.toBe(true);
  });

  it('builds guest test deep link for dashboard', () => {
    expect(buildGuestTestDeepLink('obj-123')).toContain('guest_test_obj-123');
    expect(buildGuestTestDeepLink()).toContain('guest_test');
  });

  it('persists guest_test memory from deep link', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2035));
    await Promise.resolve();

    const memory = await loadTelegramConversationMemory('9101');
    expect(memory?.guestTestActive).toBe(true);
    expect(memory?.activeScenario).toBe('guest_test');
    expect(memory?.propertyId).toBe('test-prop-tg-live');
  });

  it('answers wifi and smoking from property data after deep link', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2036));
    mockReplyToTelegram.mockClear();

    await processTelegramRoutingUpdate(routingUpdate('какой Wi-Fi?', 2037));
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('ASI-Nevsky24-Guest'),
      expect.any(Object),
      expect.any(Object),
    );

    await processTelegramRoutingUpdate(routingUpdate('можно курить?', 2038));
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringMatching(/курить.*нельзя/i),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('does not reset guest_test on plain /start after deep link', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2040));
    __resetTelegramRoutingSessionsForTests();
    mockReplyToTelegram.mockClear();

    const result = await processTelegramRoutingUpdate(routingUpdate('/start', 2041));

    expect(result?.reply).toContain('Тест гостя уже включён');
    expect(result?.reply).toContain('Тестовая квартира ASI');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls.at(-1)?.[3] ?? {})).not.toContain('Я гость по бронированию');
    expect(getTelegramRoutingSession(8101)?.testGuest).toBe(true);
  });

  it('does not override active guest_test when guest role is selected', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2050));
    __resetTelegramRoutingSessionsForTests();
    mockReplyToTelegram.mockClear();

    await processTelegramRoutingUpdate(roleCallback('guest', 2051));

    expect(getTelegramRoutingSession(8101)?.testGuest).toBe(true);
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Тест гостя уже включён'),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('shows guest_test memory via /debug_memory in test mode', async () => {
    await processTelegramRoutingUpdate(routingUpdate('/start guest_test_test-prop-tg-live', 2060));

    const result = await processTelegramRoutingUpdate(routingUpdate('/debug_memory', 2061));

    expect(result?.reply).toContain('guest_test');
    expect(result?.reply).toContain('test-prop-tg-live');
    expect(result?.reply).not.toMatch(/password|ASI-Nevsky24/i);
  });

  it('returns technical fallback on /start when reply send throws', async () => {
    mockReplyToTelegram
      .mockRejectedValueOnce(new Error('telegram send failed'))
      .mockResolvedValue(true);

    const result = await processTelegramRoutingUpdate(routingUpdate('/start', 2070));

    expect(result?.reply).toContain('техническая ошибка');
    expect(mockReplyToTelegram.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('plain /start without payload always returns role selection reply', async () => {
    const result = await processTelegramRoutingUpdate(routingUpdate('/start', 2071));

    expect(result?.reply).toContain('Подскажите, пожалуйста, кто вы');
    expect(result?.outcome).toBe('replied');
  });

  it('/start guest_test payload activates guest test flow', async () => {
    const result = await processTelegramRoutingUpdate(
      routingUpdate('/start guest_test_test-prop-tg-live', 2072),
    );

    expect(result?.outcome).toBe('replied');
    expect(mockReplyToTelegram).toHaveBeenCalled();
  });
});
