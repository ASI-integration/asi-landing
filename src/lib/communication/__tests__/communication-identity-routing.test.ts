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
const insertedCrmRows: Array<Record<string, unknown>> = [];
const UNKNOWN_IDENTITY_CLARIFY_RU =
  'Здравствуйте! Я помощник ASI. Подскажите, пожалуйста, вы гость по бронированию, владелец/управляющий объекта или хотите подключить ASI?';
const GUEST_SELECTED_REPLY_RU =
  'Понял, вы гость. Напишите, пожалуйста, что нужно: заселение, доступ, Wi-Fi, правила, поздний выезд, проблема в квартире или другой вопрос.';
const OWNER_MANAGER_REPLY_RU =
  'Понял, вы владелец/управляющий. Опишите, пожалуйста, объект или ситуацию, которую нужно разобрать. Я передам это как внутреннее обращение.';
const LEAD_REPLY_RU =
  'Отлично. Напишите, пожалуйста, сколько у вас объектов, в каком городе и через какие площадки вы сейчас принимаете бронирования. Я передам заявку на подключение ASI.';
const PROBLEM_IDENTITY_CLARIFY_RU = 'Проблема связана с вашим проживанием как гостя или с объектом, которым вы управляете?';

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
      insertedCrmRows.push(row);
      return {
        select: () => ({
          single: async () => ({ data: { id: 'crm-created' }, error: null }),
        }),
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

import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '../operator-review';
import { __resetSessionStatusStoreForTests } from '../session-status';

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
    insertedCrmRows.length = 0;
  });

  it('routes known test_guest into Guest Concierge', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: '/guest_test не работает Wi-Fi' }));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(result.reply).not.toContain('вы гость по бронированию');
  });

  it('asks unknown Telegram users to identify themselves without Guest Concierge', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(envelope({ messageText: 'Здравствуйте' }));

    expect(result.reply).toBe(UNKNOWN_IDENTITY_CLARIFY_RU);
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_markup: {
        keyboard: [
          ['Я гость', 'Я владелец/управляющий'],
          ['Хочу подключить ASI', 'Проблема по объекту'],
        ],
      },
    });
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
        keyboard: expect.arrayContaining([expect.arrayContaining(['Я гость'])]),
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
        keyboard: expect.arrayContaining([expect.arrayContaining(['Я гость'])]),
      }),
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

  it('routes button/text Хочу подключить ASI to CRM lead path', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'Хочу подключить ASI',
        metadata: { telegram_username: 'lead_user' },
      }),
    );

    expect(result.reply).toBe(LEAD_REPLY_RU);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(listEscalationReviews({ status: 'pending' }).at(0)).toMatchObject({
      escalationReason: 'lead_connection_request',
      detail: expect.stringContaining('Роль: лид'),
      suggestedReply: LEAD_REPLY_RU,
    });
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

  it('routes lead intent to CRM lead path without mixing it with guest', async () => {
    const { processMessage } = await import('../orchestrator');
    const result = await processMessage(
      envelope({
        messageText: 'как подключить ASI?',
        metadata: { telegram_username: 'new_owner' },
      }),
    );

    expect(result.reply).toBe(LEAD_REPLY_RU);
    expect(insertedCrmRows[0]).toMatchObject({
      telegram_username: 'new_owner',
      source: 'telegram',
      status: 'new_lead',
      communication_status: 'wrote_first',
    });
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
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
      suggestedReply: expect.stringContaining('Передаю оператору'),
    });
    expect(review?.detail).toContain('Причина эскалации: booking_payment_support');
  });
});
