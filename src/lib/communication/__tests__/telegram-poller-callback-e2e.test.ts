/**
 * Autonomous end-to-end regression for production Telegram poller callback_query ingestion.
 *
 * Does NOT call processUpdate directly as the entrypoint — updates must arrive via
 * pollAndProcessTelegramUpdates → getUpdates (fake Telegram API / injectable fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { _resetForTesting } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests } from '../operator-review';
import { __resetSessionStatusStoreForTests } from '../session-status';
import { TELEGRAM_IDENTITY_CALLBACKS } from '../communication-identity-routing';
import {
  TELEGRAM_POLLER_ALLOWED_UPDATES,
  createTelegramBotApiClient,
  pollAndProcessTelegramUpdates,
  type TelegramPollerApiClient,
} from '../telegram-poller';
import type { TelegramUpdate } from '../types';

const OWNER_CHAT = 9_880_001;
const BOT_TOKEN = 'poller-e2e-test-token';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  answerTelegramCallbackQuery: vi.fn().mockResolvedValue(true),
  decideAutopilot: vi.fn().mockResolvedValue({
    action: 'auto_reply',
    replyText: 'Гостевой ответ.',
    confidence: 0.9,
    escalationReason: null,
    metadata: {
      intent: 'wifi_problem',
      urgent: false,
      missingContext: [],
      matchedSignals: [],
      channelMode: 'live',
      policy: ['test'],
    },
  }),
  createOpsTask: vi.fn().mockResolvedValue({ task_id: 'task-1', error: null }),
  insertedRows: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

function supabaseQuery(table: string) {
  const query: any = {
    upsert: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn(() => query),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    insert: vi.fn((row: Record<string, unknown>) => {
      mocks.insertedRows.push({ table, row });
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
    channel: 'telegram',
    sendMessage: (...args: unknown[]) => mocks.sendMessage(...args),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mocks.sendMessage(...args),
  answerTelegramCallbackQuery: (...args: unknown[]) => mocks.answerTelegramCallbackQuery(...args),
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
    slots: {
      isUrgent: false,
      isAccessRelated: false,
      mentionsGuest: false,
      mentionsTime: false,
      mentionsObject: false,
    },
  }),
  classifyMessage: async () => ({
    category: 'issue',
    lang: 'ru',
    slots: {
      isUrgent: false,
      isAccessRelated: false,
      mentionsGuest: false,
      mentionsTime: false,
      mentionsObject: false,
    },
  }),
  extractSlots: () => ({
    isUrgent: false,
    isAccessRelated: false,
    mentionsGuest: false,
    mentionsTime: false,
    mentionsObject: false,
  }),
  deterministicReply: () => 'fallback',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT: 'SYSTEM',
}));

vi.mock('../context', () => ({
  buildCommunicationContext: async () => ({
    memory: {},
    intentResult: { intent: 'general_question', confidence: 0.95 },
    reservation: {
      status: 'matched',
      confidence: 1,
      reservationId: 'res-1',
      propertyId: 'object-1',
      guestName: 'Guest',
    },
    knowledge: { universalPolicy: 'Не выдумывать.', wifiInstructions: 'Wi-Fi: ASI Guest.' },
    recentMessages: [],
  }),
}));

vi.mock('../autopilot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autopilot')>();
  return {
    ...actual,
    decideCommunicationAutopilotResponseWithLlmRouter: (...args: unknown[]) =>
      mocks.decideAutopilot(...args),
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
  evaluateCheckinReadiness: async () => ({
    allowed: false,
    blocked_reason: 'not_needed',
    checked_at: new Date().toISOString(),
  }),
}));

vi.mock('@/lib/ops/tasks', () => ({
  OpsTaskType: {
    GuestIssue: 'guest_issue',
    Checkout: 'checkout',
    CheckinReady: 'checkin_ready',
    Turnover: 'turnover',
  },
  OpsTaskPriority: { Normal: 'normal', Urgent: 'urgent' },
  createOpsTask: (...args: unknown[]) => mocks.createOpsTask(...args),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: vi.fn(),
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({ status: 'unmatched', confidence: 0 }),
}));

function buildCallbackUpdate(params: {
  updateId: number;
  callbackId: string;
  callbackData: string;
  chatId?: number;
  messageId?: number;
}): TelegramUpdate {
  const chatId = params.chatId ?? OWNER_CHAT;
  return {
    update_id: params.updateId,
    callback_query: {
      id: params.callbackId,
      from: {
        id: chatId,
        is_bot: false,
        first_name: 'Owner',
        username: 'poller_e2e',
        language_code: 'ru',
      },
      message: {
        message_id: params.messageId ?? 10,
        chat: { id: chatId },
        from: { id: 100, is_bot: true, first_name: 'ASI_COMM_Test_Bot' },
        text: 'Здравствуйте! Вы владелец/управляющий или гость?',
      },
      data: params.callbackData,
    },
  };
}

type FakeTelegramState = {
  updates: TelegramUpdate[];
  webhookUrl: string | null;
  getUpdatesCalls: Array<Record<string, unknown>>;
  answerCallbackCalls: string[];
  sendMessageCalls: Array<Record<string, unknown>>;
  consumerTokens: Set<string>;
};

function matchesAllowed(update: TelegramUpdate, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (update.callback_query) return allowed.includes('callback_query');
  if (update.edited_message) return allowed.includes('edited_message');
  if (update.message) return allowed.includes('message');
  return false;
}

function createFakeTelegramApi(state: FakeTelegramState): {
  server: Server;
  baseUrl: Promise<string>;
} {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    // /bot<token>/<method>
    const botPart = parts[0] ?? '';
    const method = parts[1] ?? '';
    const token = botPart.startsWith('bot') ? botPart.slice(3) : '';
    state.consumerTokens.add(token);

    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
    }

    const json = (payload: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };

    if (method === 'getWebhookInfo') {
      return json({ ok: true, result: { url: state.webhookUrl ?? '' } });
    }
    if (method === 'deleteWebhook') {
      state.webhookUrl = null;
      return json({ ok: true, result: true });
    }
    if (method === 'getUpdates') {
      state.getUpdatesCalls.push(body);
      const offset = Number(body.offset ?? 0);
      const allowed = Array.isArray(body.allowed_updates)
        ? (body.allowed_updates as string[])
        : undefined;
      const batch = state.updates.filter(
        (u) => u.update_id >= offset && matchesAllowed(u, allowed),
      );
      return json({ ok: true, result: batch });
    }
    if (method === 'answerCallbackQuery') {
      state.answerCallbackCalls.push(String(body.callback_query_id ?? ''));
      return json({ ok: true, result: true });
    }
    if (method === 'sendMessage') {
      state.sendMessageCalls.push(body);
      return json({
        ok: true,
        result: { message_id: 99, chat: { id: body.chat_id }, text: body.text },
      });
    }
    return json({ ok: false, description: `unknown method ${method}` }, 404);
  });

  const baseUrl = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no listen address');
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  return { server, baseUrl };
}

describe('production telegram poller callback_query E2E', () => {
  let server: Server | undefined;
  let apiBaseUrl = '';
  let state: FakeTelegramState;
  let api: TelegramPollerApiClient;
  let processUpdate: (update: TelegramUpdate) => Promise<{ outcome: string; chat_id?: number; reply?: string }>;

  beforeEach(async () => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    __resetSessionStatusStoreForTests();
    mocks.sendMessage.mockClear();
    mocks.answerTelegramCallbackQuery.mockClear();
    mocks.decideAutopilot.mockClear();
    mocks.createOpsTask.mockClear();
    mocks.insertedRows.length = 0;
    process.env.COMM_STATE_DIR = `.asi-comm-state-poller-e2e-${Date.now()}`;
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    delete process.env.TELEGRAM_DRY_RUN;
    delete process.env.DRY_RUN_TELEGRAM_OUTBOUND;

    state = {
      updates: [],
      webhookUrl: 'https://stale-webhook.example/hook',
      getUpdatesCalls: [],
      answerCallbackCalls: [],
      sendMessageCalls: [],
      consumerTokens: new Set(),
    };
    const fake = createFakeTelegramApi(state);
    server = fake.server;
    apiBaseUrl = await fake.baseUrl;
    api = createTelegramBotApiClient({
      token: BOT_TOKEN,
      apiBaseUrl,
    });

    const orchestrator = await import('../orchestrator');
    processUpdate = orchestrator.processUpdate;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  });

  it('ingests callback_query via getUpdates → poller → processUpdate → answerCallbackQuery', async () => {
    const callbackUpdate = buildCallbackUpdate({
      updateId: 5_001,
      callbackId: 'cb-poller-guest-1',
      callbackData: TELEGRAM_IDENTITY_CALLBACKS.guest,
    });
    state.updates = [callbackUpdate];

    const committedOffsets: number[] = [];
    const processedIds = new Set<number>();

    const first = await pollAndProcessTelegramUpdates({
      api,
      offset: 0,
      ensureExclusiveConsumer: true,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: processedIds,
      onOffsetCommit: (offset) => {
        committedOffsets.push(offset);
      },
      processUpdate,
    });

    expect(first.getUpdatesAllowedUpdates).toEqual([...TELEGRAM_POLLER_ALLOWED_UPDATES]);
    expect(first.getUpdatesAllowedUpdates).toContain('callback_query');
    expect(state.webhookUrl).toBeNull();
    expect(state.getUpdatesCalls[0]?.allowed_updates).toEqual(
      expect.arrayContaining(['callback_query', 'message', 'edited_message']),
    );
    expect(first.fetched).toBe(1);
    expect(first.handled).toHaveLength(1);
    expect(first.handled[0]?.ignored).not.toBe(true);
    expect(first.handled[0]?.result?.outcome).toMatch(/replied|duplicate|ignored/i);
    expect(first.nextOffset).toBe(5_002);
    expect(committedOffsets).toEqual([5_002]);

    // answerCallbackQuery must fire for the production callback path
    expect(mocks.answerTelegramCallbackQuery).toHaveBeenCalledWith('cb-poller-guest-1');
    // Exactly one outbound reply for the identity selection
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    // Replay same update_id through poller — idempotent (dedup at poller + inbound key)
    state.updates = [callbackUpdate];
    const replay = await pollAndProcessTelegramUpdates({
      api,
      offset: 0,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: processedIds,
      processUpdate,
    });
    expect(replay.handled[0]?.reason).toBe('duplicate_update_id');
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    // Fresh duplicate callback id via new update_id — processUpdate Duplicate, still answered
    const dupCallback = buildCallbackUpdate({
      updateId: 5_002,
      callbackId: 'cb-poller-guest-1',
      callbackData: TELEGRAM_IDENTITY_CALLBACKS.guest,
    });
    state.updates = [dupCallback];
    const dup = await pollAndProcessTelegramUpdates({
      api,
      offset: 5_002,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: processedIds,
      processUpdate,
    });
    expect(dup.handled[0]?.result?.outcome).toBe('duplicate');
    expect(mocks.answerTelegramCallbackQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects stale identity callback safely after role is set (still answers callback)', async () => {
    state.updates = [
      buildCallbackUpdate({
        updateId: 6_001,
        callbackId: 'cb-stale-setup',
        callbackData: TELEGRAM_IDENTITY_CALLBACKS.guest,
      }),
    ];
    const processedIds = new Set<number>();
    await pollAndProcessTelegramUpdates({
      api,
      offset: 0,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: processedIds,
      processUpdate,
    });
    const repliesAfterSetup = mocks.sendMessage.mock.calls.length;
    expect(repliesAfterSetup).toBe(1);

    state.updates = [
      buildCallbackUpdate({
        updateId: 6_002,
        callbackId: 'cb-stale-lead',
        callbackData: TELEGRAM_IDENTITY_CALLBACKS.lead,
      }),
    ];
    const stale = await pollAndProcessTelegramUpdates({
      api,
      offset: 6_002,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: processedIds,
      processUpdate,
    });
    expect(stale.handled[0]?.result).toBeTruthy();
    expect(mocks.answerTelegramCallbackQuery).toHaveBeenCalledWith('cb-stale-lead');
    // Stale/role-conflict path must not spam extra guest autopilot replies beyond identity ack.
    expect(mocks.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(repliesAfterSetup);
    expect(mocks.sendMessage.mock.calls.length).toBeLessThanOrEqual(repliesAfterSetup + 1);
  });

  it('FAILS ingestion when callback_query is excluded from allowed_updates (regression lock)', async () => {
    state.updates = [
      buildCallbackUpdate({
        updateId: 7_001,
        callbackId: 'cb-missing-allowed',
        callbackData: TELEGRAM_IDENTITY_CALLBACKS.guest,
      }),
    ];

    await expect(
      pollAndProcessTelegramUpdates({
        api,
        offset: 0,
        allowedUpdates: ['message', 'edited_message'],
        allowedChatIds: [OWNER_CHAT],
        processUpdate,
      }),
    ).rejects.toThrow(/callback_query/);

    // Even if assert is bypassed, fake Telegram filters callback out — nothing processed.
    const bypassed = await pollAndProcessTelegramUpdates({
      api,
      offset: 0,
      allowedUpdates: ['message', 'edited_message'],
      skipAllowedUpdatesAssert: true,
      allowedChatIds: [OWNER_CHAT],
      processUpdate,
    });
    expect(bypassed.fetched).toBe(0);
    expect(bypassed.handled).toHaveLength(0);
    expect(mocks.answerTelegramCallbackQuery).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('does not let a second consumer steal updates once offset is committed', async () => {
    state.updates = [
      buildCallbackUpdate({
        updateId: 8_001,
        callbackId: 'cb-exclusive',
        callbackData: TELEGRAM_IDENTITY_CALLBACKS.lead,
      }),
    ];
    const processedIds = new Set<number>();
    let committed = 0;

    const primary = await pollAndProcessTelegramUpdates({
      api,
      offset: 0,
      ensureExclusiveConsumer: true,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: processedIds,
      onOffsetCommit: (next) => {
        committed = next;
      },
      processUpdate,
    });
    expect(primary.fetched).toBe(1);
    expect(committed).toBe(8_002);

    const secondaryApi = createTelegramBotApiClient({
      token: BOT_TOKEN,
      apiBaseUrl,
    });
    const secondary = await pollAndProcessTelegramUpdates({
      api: secondaryApi,
      offset: committed,
      allowedChatIds: [OWNER_CHAT],
      processedUpdateIds: new Set<number>(),
      processUpdate,
    });
    expect(secondary.fetched).toBe(0);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });
});
