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

import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

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

    expect(result.reply).toContain('вы гость по бронированию');
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
    expect(result.reply).toContain('вы гость по бронированию');
    expect(result.reply).not.toContain('Hi! Send a guest message');
    expect(mockSendMessage.mock.calls.at(-1)?.[2]).toMatchObject({
      reply_handler: 'orchestrator:communication_identity_route:unknown_clarify',
      sender_identity: 'unknown',
    });
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

    expect(result.reply).toContain('не буду отвечать как гостю');
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

    expect(result.reply).toContain('интерес к ASI');
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
});
