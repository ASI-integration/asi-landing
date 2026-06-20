import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, type InboundMessageEnvelope, type TelegramUpdate } from '../types';

const mockSendMessage = vi.fn().mockResolvedValue(true);
const mockDecideAutopilot = vi.fn().mockResolvedValue({
  action: 'auto_reply',
  replyText: 'Гостевой ответ.',
  confidence: 0.9,
  escalationReason: null,
  metadata: {
    intent: 'wifi_problem',
    urgent: true,
    missingContext: [],
    matchedSignals: [],
    channelMode: 'live',
    policy: ['test'],
    operationsAction: {
      category: 'maintenance',
      priority: 'high',
      shortReason: 'wifi_problem',
      title: 'Wi-Fi',
    },
  },
});
const mockCreateOpsTask = vi.fn().mockResolvedValue({ task_id: 'task-1', error: null });
const crmRows = new Map<string, { id: string; role: string | null }>();
const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
const UNKNOWN_IDENTITY_CLARIFY_RU =
  'Здравствуйте! Подскажите, пожалуйста, кто вы — так я смогу ответить правильно:';
const GUEST_SELECTED_REPLY_RU =
  'Понял, вы гость. Напишите вопрос по объекту — адрес, заезд, Wi-Fi, правила. Если бронь ещё не привязана, укажите номер бронирования или телефон из брони.';
const OWNER_MANAGER_REPLY_RU =
  'Понял, вы владелец/управляющий. Опишите, пожалуйста, объект или ситуацию, которую нужно разобрать. Я передам это как внутреннее обращение.';
const LEAD_REPLY_RU =
  'Отлично. Напишите, пожалуйста, сколько у вас объектов, в каком городе и через какие площадки вы сейчас принимаете бронирования. Я передам заявку на подключение ASI.';
const SUPPORT_PROBLEM_REPLY_RU =
  'Понял. Опишите, пожалуйста, что случилось. Если это связано с проживанием, укажите объект или бронь. Если это вопрос владельца/управляющего, напишите объект и ситуацию.';
const PROBLEM_IDENTITY_CLARIFY_RU = 'Проблема связана с вашим проживанием как гостя или с объектом, которым вы управляете?';
const ROLE_CONFLICT_GUEST_QUESTION_RU =
  'Похоже, это вопрос гостя по проживанию. Переключить этот диалог в гостевой сценарий?';

function supabaseQuery(table: string) {
  const query: any = {
    upsert: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn(() => query),
    select: vi.fn(() => query),
    eq: vi.fn((field: string, value: unknown) => {
      query.__eq = { field, value };
      return query;
    }),
    in: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => {
      if (table === 'crm_contacts' && query.__eq?.field === 'telegram_username') {
        return { data: crmRows.get(String(query.__eq.value)) ?? null, error: null };
      }
      return { data: null, error: null };
    }),
    insert: vi.fn((row: Record<string, unknown>) => {
      insertedRows.push({ table, row });
      return {
        select: () => ({
          single: async () => ({ data: { id: 'crm-created' }, error: null }),
        }),
        single: async () => ({ data: { id: 'crm-created' }, error: null }),
      };
    }),
    single: vi.fn(async () => ({ data: null, error: null })),
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => supabaseQuery(table),
  },
}));

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
  classify: () => ({
    category: 'issue',
    lang: 'ru',
    slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false },
  }),
  classifyMessage: async () => ({
    category: 'issue',
    lang: 'ru',
    slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false },
  }),
  extractSlots: () => ({ isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false }),
  deterministicReply: () => 'fallback',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT: 'SYSTEM',
}));

vi.mock('../context', () => ({
  buildCommunicationContext: async () => ({
    memory: {},
    intentResult: { intent: 'general_question', confidence: 0.95 },
    reservation: { status: 'matched', confidence: 1, reservationId: 'res-1', propertyId: 'object-1', guestName: 'Guest' },
    knowledge: { universalPolicy: 'Не выдумывать.', wifiInstructions: 'Wi-Fi: ASI Guest.' },
    recentMessages: [],
  }),
}));

vi.mock('../autopilot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autopilot')>();
  return {
    ...actual,
    decideCommunicationAutopilotResponseWithLlmRouter: (...args: unknown[]) => mockDecideAutopilot(...args),
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

vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async () => ({ allowed: false, blocked_reason: 'not_needed', checked_at: new Date().toISOString() }),
}));

vi.mock('@/lib/ops/tasks', () => ({
  OpsTaskType: { GuestIssue: 'guest_issue', Checkout: 'checkout', CheckinReady: 'checkin_ready', Turnover: 'turnover' },
  OpsTaskPriority: { Normal: 'normal', Urgent: 'urgent' },
  createOpsTask: (...args: unknown[]) => mockCreateOpsTask(...args),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: vi.fn(),
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({ status: 'unmatched', confidence: 0 }),
}));

import { __resetAutonomousSessionStoreForTests, loadAutonomousSession } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '../operator-review';
import { __resetSessionStatusStoreForTests } from '../session-status';
import { GUEST_MISSING_DATA_OPERATOR_REPLY } from '../guest-test-answers';

function envelope(params: Partial<InboundMessageEnvelope>): InboundMessageEnvelope {
  return {
    channel: 'telegram',
    externalUserId: '9001',
    chatId: '9001',
    messageText: 'Здравствуйте',
    receivedAt: new Date(),
    update_id: Math.floor(Math.random() * 1_000_000),
    metadata: {
      telegram_chat_id: '9001',
      providerMessageId: `msg-${Math.random()}`,
      ...params.metadata,
    },
    ...params,
  };
}

function callbackUpdate(data: string, chatId = 9001): TelegramUpdate {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: `cb-${Math.random()}`,
      from: { id: chatId, language_code: 'ru', username: 'callback_user' },
      message: {
        message_id: 42,
        chat: { id: chatId },
        from: { id: 100, is_bot: true, first_name: 'ASI Support' },
        text: UNKNOWN_IDENTITY_CLARIFY_RU,
      },
      data,
    },
  };
}

describe('communication identity routing v1', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    __resetSessionStatusStoreForTests();
    mockSendMessage.mockClear();
    mockDecideAutopilot.mockClear();
    mockCreateOpsTask.mockClear();
    crmRows.clear();
    insertedRows.length = 0;
  });

  it('routes known test_guest into Guest Concierge', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: '/guest_test не работает Wi-Fi' }));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).not.toContain('вы гость по бронированию');
  });

  it('asks unknown Telegram users to identify themselves for check-in questions', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'как заселиться?' }));

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]?.reply_markup).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: 'identity:guest' })]),
      ]),
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('asks unknown Telegram users to identify themselves for restaurant questions and saves pending message', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'вы можете порекомендовать рестораны рядом?',
        metadata: { providerMessageId: 'unknown-restaurants' },
      }),
    );

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(loadAutonomousSession(9001)?.pending_identity_message).toBe('вы можете порекомендовать рестораны рядом?');
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('replays pending restaurant question through Guest Concierge after guest callback', async () => {
    const { processUpdate } = await import('../orchestrator');
    await processUpdate({
      update_id: 61_010,
      message: {
        message_id: 10,
        chat: { id: 9110 },
        from: { id: 9110, language_code: 'ru', username: 'pending_guest' },
        text: 'вы можете порекомендовать рестораны рядом?',
      },
    });

    mockDecideAutopilot.mockClear();
    const result = await processUpdate(callbackUpdate('identity:guest', 9110));

    expect(result.reply).toContain('кафе и рестораны');
    expect(listEscalationReviews({ status: 'pending' })).toHaveLength(0);
    expect(loadAutonomousSession(9110)?.pending_identity_message).toBeNull();
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('replays pending check-in question after guest callback with guest-facing missing data handoff', async () => {
    const { processUpdate } = await import('../orchestrator');
    const first = await processUpdate({
      update_id: 61_013,
      message: {
        message_id: 13,
        chat: { id: 9113 },
        from: { id: 9113, language_code: 'ru', username: 'pending_guest_missing_data' },
        text: 'здравствуйте, мы хотим заехать в вашу квартиру',
      },
    });

    expect(first.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]?.reply_markup).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: 'identity:guest' })]),
      ]),
    });
    expect(loadAutonomousSession(9113)?.pending_identity_message).toBe('здравствуйте, мы хотим заехать в вашу квартиру');

    const result = await processUpdate(callbackUpdate('identity:guest', 9113));

    expect(result.reply).toBe(GUEST_MISSING_DATA_OPERATOR_REPLY);
    expect(result.reply).not.toContain('Владельцу нужно');
    expect(result.reply).not.toContain('заполнить раздел в личном кабинете');
    expect(result.reply).toContain('номер бронирования');
    expect(result.reply).toContain('адрес/название объекта');
    expect(loadAutonomousSession(9113)?.pending_identity_message).toBeNull();

    const crmEvents = insertedRows.filter((item) => item.table === 'crm_events');
    const guestQuestionEvent = crmEvents.find((item) => item.row.event_type === 'guest_test_question');
    expect(guestQuestionEvent?.row.metadata).toMatchObject({
      outcome: 'missing_data',
      reply_preview: GUEST_MISSING_DATA_OPERATOR_REPLY,
    });
    expect(String((guestQuestionEvent?.row.metadata as Record<string, unknown> | undefined)?.reply_preview ?? '')).not.toContain('Владельцу нужно');

    const missingDataEvent = crmEvents.find((item) => item.row.event_type === 'missing_data');
    expect(missingDataEvent?.row.metadata).toMatchObject({
      intent: 'description',
      source: 'minigpt_brain_v1',
    });
    expect(String((missingDataEvent?.row.metadata as Record<string, unknown> | undefined)?.internal_detail ?? '')).toContain('Владельцу нужно');

    const operatorEvent = crmEvents.find((item) => item.row.event_type === 'operator_followup_required');
    expect(operatorEvent?.row.metadata).toMatchObject({
      intent: 'description',
      source: 'minigpt_brain_v1',
    });
    expect(String((operatorEvent?.row.metadata as Record<string, unknown> | undefined)?.internal_detail ?? '')).toContain('Владельцу нужно');
  });

  it('keeps missing booking/object context for guest lookup follow-up by name', async () => {
    const { processUpdate } = await import('../orchestrator');
    await processUpdate({
      update_id: 61_014,
      message: {
        message_id: 14,
        chat: { id: 9114 },
        from: { id: 9114, language_code: 'ru', username: 'pending_guest_lookup' },
        text: 'здравствуйте, мы хотим заехать в вашу квартиру',
      },
    });
    const replay = await processUpdate(callbackUpdate('identity:guest', 9114));
    expect(replay.reply).toBe(GUEST_MISSING_DATA_OPERATOR_REPLY);
    expect(loadAutonomousSession(9114)?.collected_data).toMatchObject({
      guest_missing_reservation_followup: 'after_missing_booking_or_object_data',
      guest_missing_reservation_followup_state: 'awaiting_guest_booking_identifier',
    });

    const byName = await processUpdate({
      update_id: 61_015,
      message: {
        message_id: 15,
        chat: { id: 9114 },
        from: { id: 9114, language_code: 'ru', username: 'pending_guest_lookup' },
        text: 'в данный момент нет номера бронирования, можно по имени и фамилии?',
      },
    });

    expect(byName.reply).toBe(
      'Да, можно. Напишите, пожалуйста, имя и фамилию, дату заезда и, если есть, последние 4 цифры телефона из брони. Я передам это оператору для проверки.',
    );
    expect(byName.reply).not.toMatch(/владелец|внутрен|оператору нужно|паспорт|документ|фото|банк|карта/i);
    expect(loadAutonomousSession(9114)?.collected_data).toMatchObject({
      guest_missing_reservation_followup_state: 'awaiting_guest_booking_lookup_data',
    });

    const lookupData = await processUpdate({
      update_id: 61_016,
      message: {
        message_id: 16,
        chat: { id: 9114 },
        from: { id: 9114, language_code: 'ru', username: 'pending_guest_lookup' },
        text: 'Иван Петров, дата заезда 24 июня, последние 4 цифры телефона 1234',
      },
    });

    expect(lookupData.reply).toBe('Спасибо, передал данные оператору для проверки. Вернусь с ответом здесь.');
    const operatorEvent = insertedRows
      .filter((item) => item.table === 'crm_events')
      .find((item) => item.row.event_type === 'operator_followup_required' && item.row.message_text === 'Иван Петров, дата заезда 24 июня, последние 4 цифры телефона 1234');
    expect(operatorEvent?.row.metadata).toMatchObject({
      intent: 'booking_lookup_missing_details',
      source: 'minigpt_brain_v1',
      lookup_data: {
        guest_name: 'Иван Петров',
        check_in_date: '24 июня',
        phone_last4: '1234',
      },
    });
  });

  it('replays pending owner message through owner route after owner callback', async () => {
    const { processUpdate } = await import('../orchestrator');
    await processUpdate({
      update_id: 61_011,
      message: {
        message_id: 11,
        chat: { id: 9111 },
        from: { id: 9111, language_code: 'ru', username: 'pending_owner' },
        text: 'Нужно проверить объект на Авито',
      },
    });

    mockDecideAutopilot.mockClear();
    const result = await processUpdate(callbackUpdate('identity:owner_manager', 9111));

    expect(result.reply).toBe(OWNER_MANAGER_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' }).at(0)).toMatchObject({
      escalationReason: 'owner_manager_message',
      detail: expect.stringContaining('Нужно проверить объект на Авито'),
    });
    expect(loadAutonomousSession(9111)?.pending_identity_message).toBeNull();
  });

  it('replays pending message through lead route after lead callback', async () => {
    const { processUpdate } = await import('../orchestrator');
    await processUpdate({
      update_id: 61_012,
      message: {
        message_id: 12,
        chat: { id: 9112 },
        from: { id: 9112, language_code: 'ru', username: 'pending_lead' },
        text: 'хочу подключить ASI для трёх объектов в Казани',
      },
    });

    mockDecideAutopilot.mockClear();
    const result = await processUpdate(callbackUpdate('identity:lead', 9112));

    expect(result.reply).toBe(LEAD_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' }).at(0)).toMatchObject({
      escalationReason: 'lead_connection_request',
    });
    expect(loadAutonomousSession(9112)?.pending_identity_message).toBeNull();
  });

  it('asks unknown Telegram users to identify themselves without Guest Concierge', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'Здравствуйте' }));

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Я гость', callback_data: 'identity:guest' },
            { text: 'Владелец/управляющий', callback_data: 'identity:owner_manager' },
          ],
          [
            { text: 'Хочу подключить ASI', callback_data: 'identity:lead' },
            { text: 'Нужна поддержка', callback_data: 'identity:support_problem' },
          ],
        ],
      },
    });
    expect(mockSendMessage.mock.calls.at(-1)?.[2]?.reply_markup).not.toHaveProperty('keyboard');
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes Telegram hi through envelope identity before any meta greeting reply', async () => {
    const { processUpdate } = await import('../orchestrator');
    const update: TelegramUpdate = {
      update_id: 61_001,
      message: {
        message_id: 7,
        chat: { id: 9001 },
        from: { id: 9001, language_code: 'en', username: 'unknown_user' },
        text: 'hi',
      },
    };

    const result = await processUpdate(update);

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(result.reply).not.toContain('Hi! Send a guest message');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:unknown_clarify',
      sender_identity: 'unknown',
      reply_markup: expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: 'identity:guest' })]),
        ]),
      }),
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes Telegram здравствуйте to identity clarification for unknown senders', async () => {
    const { processUpdate } = await import('../orchestrator');
    const update: TelegramUpdate = {
      update_id: 61_002,
      message: {
        message_id: 8,
        chat: { id: 9002 },
        from: { id: 9002, language_code: 'ru', username: 'fresh_user' },
        text: 'здравствуйте',
      },
    };

    const result = await processUpdate(update);

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_markup: expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: 'identity:guest' })]),
        ]),
      }),
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes guest inline callback to guest selection and saves identity', async () => {
    const { processUpdate } = await import('../orchestrator');
    const result = await processUpdate(callbackUpdate('identity:guest', 9101));

    expect(result.reply).toBe(GUEST_SELECTED_REPLY_RU);
    expect(loadAutonomousSession(9101)?.identity_role).toBe('guest');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:guest_selected',
      sender_identity: 'guest',
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes owner inline callback to owner manager route and saves identity', async () => {
    const { processUpdate } = await import('../orchestrator');
    const result = await processUpdate(callbackUpdate('identity:owner_manager', 9102));

    expect(result.reply).toBe(OWNER_MANAGER_REPLY_RU);
    expect(loadAutonomousSession(9102)?.identity_role).toBe('owner');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:owner_manager',
      sender_identity: 'owner',
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes lead inline callback to lead route and saves identity', async () => {
    const { processUpdate } = await import('../orchestrator');
    const result = await processUpdate(callbackUpdate('identity:lead', 9103));

    expect(result.reply).toBe(LEAD_REPLY_RU);
    expect(loadAutonomousSession(9103)?.identity_role).toBe('lead');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:lead',
      sender_identity: 'lead',
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes support inline callback to support route and overrides previous identity', async () => {
    const { processUpdate } = await import('../orchestrator');
    await processUpdate(callbackUpdate('identity:guest', 9104));

    const result = await processUpdate(callbackUpdate('identity:support_problem', 9104));

    expect(result.reply).toBe(SUPPORT_PROBLEM_REPLY_RU);
    expect(loadAutonomousSession(9104)?.identity_role).toBe('operator');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:support_problem',
      sender_identity: 'support_problem',
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('routes button/text Я гость to guest selection reply without running Guest Concierge first', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'Я гость' }));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).toBe(GUEST_SELECTED_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:guest_selected',
      sender_identity: 'guest',
    });
  });

  it('keeps selected guest route for the next message after button/text Я гость', async () => {
    const { processMessage } = await import('../orchestrator');
    await processMessage(envelope({ messageText: 'Я гость', metadata: { providerMessageId: 'guest-select' } }));
    mockDecideAutopilot.mockClear();

    const result = await processMessage(envelope({ messageText: 'не работает Wi-Fi', metadata: { providerMessageId: 'guest-wifi' } }));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).not.toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).not.toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:unknown_clarify',
    });
  });

  it('routes button/text Я владелец/управляющий away from Guest Concierge with new copy', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'Я владелец/управляющий' }));

    expect(result.reply).toBe(OWNER_MANAGER_REPLY_RU);
    expect(result.reply).not.toContain('не буду отвечать как гостю');
    expect(result.reply).not.toContain('оператор увидит');
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' }).at(0)).toMatchObject({
      escalationReason: 'owner_manager_message',
      detail: expect.stringContaining('⚠️ ASI: нужна проверка оператора'),
      suggestedReply: OWNER_MANAGER_REPLY_RU,
    });
  });

  it('shows identity clarification for lead-like text from unknown sender', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'Хочу подключить ASI',
        metadata: { telegram_username: 'lead_user' },
      }),
    );

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(mockSendMessage.mock.calls.at(-1)?.[2]?.reply_markup).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: 'identity:lead' })]),
      ]),
    });
    expect(listEscalationReviews({ status: 'pending' })).toHaveLength(0);
  });

  it('shows identity clarification for connect ASI questions from unknown sender', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'как подключить ASI?',
        metadata: { telegram_username: 'new_owner' },
      }),
    );

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(insertedRows.find((item) => item.table === 'crm_contacts')).toBeUndefined();
  });

  it('asks guest vs owner/manager for object problem from unknown sender', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'Проблема по объекту' }));

    expect(result.reply).toBe(PROBLEM_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:object_problem_clarify',
      reply_markup: {
        keyboard: [['Я гость', 'Я владелец/управляющий']],
      },
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('does not let guest canon run before identity routing for unknown operational text', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'не работает Wi-Fi' }));

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('does not route owner or manager text into Guest Concierge', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'у меня гость жалуется на Wi-Fi',
        metadata: { senderIdentity: 'owner' },
      }),
    );

    expect(result.reply).toBe(OWNER_MANAGER_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
  });

  it('asks saved owner to confirm before switching a guest restaurant question', async () => {
    const { processMessage } = await import('../orchestrator');
    await processMessage(envelope({ messageText: 'Я владелец/управляющий', metadata: { providerMessageId: 'owner-save' } }));
    mockSendMessage.mockClear();
    mockDecideAutopilot.mockClear();

    const result = await processMessage(
      envelope({
        messageText: 'вы можете порекомендовать рестораны рядом?',
        metadata: { providerMessageId: 'owner-restaurant-conflict' },
      }),
    );

    expect(result.reply).toBe(ROLE_CONFLICT_GUEST_QUESTION_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(loadAutonomousSession(9001)?.pending_identity_message).toBe('вы можете порекомендовать рестораны рядом?');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:role_conflict_guest_question',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Да, я гость', callback_data: 'identity:guest' },
            { text: 'Нет, я владелец/управляющий', callback_data: 'identity:owner_manager' },
          ],
        ],
      },
    });
  });

  it('keeps saved owner on owner route for owner internal requests', async () => {
    const { processMessage } = await import('../orchestrator');
    await processMessage(envelope({ messageText: 'Я владелец/управляющий', metadata: { providerMessageId: 'owner-save-2' } }));
    mockDecideAutopilot.mockClear();

    const result = await processMessage(
      envelope({
        messageText: 'Нужно проверить объект на Авито',
        metadata: { providerMessageId: 'owner-avito' },
      }),
    );

    expect(result.reply).toBe(OWNER_MANAGER_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' }).at(-1)).toMatchObject({
      escalationReason: 'owner_manager_message',
      detail: expect.stringContaining('Нужно проверить объект на Авито'),
    });
  });

  it('routes saved guest lead connection text to lead flow', async () => {
    const { processMessage } = await import('../orchestrator');
    await processMessage(envelope({ messageText: 'Я гость', metadata: { providerMessageId: 'guest-save-lead' } }));
    mockDecideAutopilot.mockClear();

    const result = await processMessage(
      envelope({
        messageText: 'хочу подключить ASI',
        metadata: { providerMessageId: 'guest-lead-switch', telegram_username: 'guest_lead' },
      }),
    );

    expect(result.reply).toBe(LEAD_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' }).at(-1)).toMatchObject({
      escalationReason: 'lead_connection_request',
    });
  });

  it('replays owner-conflict pending restaurant question through concierge after guest callback', async () => {
    const { processMessage, processUpdate } = await import('../orchestrator');
    await processMessage(envelope({ messageText: 'Я владелец/управляющий', metadata: { providerMessageId: 'owner-save-3' } }));
    await processMessage(
      envelope({
        messageText: 'вы можете порекомендовать рестораны рядом?',
        metadata: { providerMessageId: 'owner-restaurant-conflict-2' },
      }),
    );
    mockDecideAutopilot.mockClear();

    const result = await processUpdate(callbackUpdate('identity:guest', 9001));

    expect(result.reply).toContain('кафе и рестораны');
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(loadAutonomousSession(9001)?.pending_identity_message).toBeNull();
    expect(insertedRows.some((item) => item.table === 'crm_events' && item.row.event_type === 'guest_concierge_answered')).toBe(true);
  });

  it('answers guest restaurant questions through Guest Concierge before broad autopilot', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'вы можете порекомендовать какие-то рестораны недалеко?',
        metadata: { senderIdentity: 'guest', providerMessageId: 'guest-restaurants' },
      }),
    );

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).toContain('кафе и рестораны');
    expect(result.reply).toContain('проверить часы работы и рейтинг в картах');
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' })).toHaveLength(0);
    expect(insertedRows.some((item) => item.table === 'crm_events' && item.row.event_type === 'guest_concierge_answered')).toBe(true);
    expect(insertedRows.some((item) => item.table === 'crm_events' && item.row.event_type === 'operator_followup_required')).toBe(false);
  });

  it('routes guest Wi-Fi problem to Guest Concierge with escalation path available', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'не работает Wi-Fi',
        metadata: { senderIdentity: 'guest' },
      }),
    );

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).not.toContain('вы гость по бронированию');
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('escalates guest question when verified data is missing', async () => {
    mockDecideAutopilot.mockResolvedValueOnce({
      action: 'needs_context',
      replyText: undefined,
      confidence: 0.72,
      escalationReason: null,
      metadata: {
        intent: 'baby_crib_request',
        urgent: false,
        missingContext: ['object.id', 'object.babyCribAvailable'],
        matchedSignals: ['baby_crib_request'],
        contextKeys: [],
        channelMode: 'active',
        policy: 'deterministic_mvp_v1',
      },
    });
    const { processMessage } = await import('../orchestrator');

    const result = await processMessage(
      envelope({
        messageText: 'Можно поставить детскую кроватку?',
        metadata: { senderIdentity: 'guest', providerMessageId: 'guest-crib-missing' },
      }),
    );

    expect(result.reply).toBe('Сейчас не вижу точных данных по этому вопросу. Уточню у оператора и вернусь с ответом.');
    const review = listEscalationReviews({ status: 'pending' }).at(0);
    expect(review).toMatchObject({
      escalationReason: 'missing_verified_data',
      detail: expect.stringContaining('Роль: гость'),
    });
    expect(review?.detail).toContain('Причина эскалации: Нет проверенных данных: object.id, object.babyCribAvailable.');
  });

  it('escalates guest refund/payment questions to operator notification', async () => {
    mockDecideAutopilot.mockResolvedValueOnce({
      action: 'escalate',
      replyText: 'Понял запрос по возврату. Передаю оператору, чтобы проверить бронирование и оплату.',
      confidence: 0.91,
      escalationReason: 'booking_payment_support',
      metadata: {
        intent: 'booking_payment_support',
        urgent: false,
        missingContext: [],
        matchedSignals: ['refund'],
        contextKeys: [],
        channelMode: 'active',
        policy: 'deterministic_mvp_v1',
      },
    });
    const { processMessage } = await import('../orchestrator');

    const result = await processMessage(
      envelope({
        messageText: 'Мне нужен возврат оплаты',
        metadata: { senderIdentity: 'guest', providerMessageId: 'guest-refund' },
      }),
    );

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    const review = listEscalationReviews({ status: 'pending' }).at(0);
    expect(review).toMatchObject({
      detail: expect.stringContaining('⚠️ ASI: нужна проверка оператора'),
      suggestedReply: expect.stringContaining('нужна проверка оператора'),
    });
    expect(review?.detail).toContain('Причина эскалации: Вопрос про оплату, возврат, скидку или изменение брони');
  });
});
