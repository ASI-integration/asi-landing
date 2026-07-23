import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import {
  formatCommV1AcceptanceResultLine,
  runCommV1AutomatedAcceptance,
  type CommV1AcceptanceDeps,
} from '../comm-v1-automated-acceptance';

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
      urgent: true,
      missingContext: [],
      matchedSignals: [],
      channelMode: 'live',
      policy: ['test'],
    },
  }),
  createOpsTask: vi.fn().mockResolvedValue({ task_id: 'task-1', error: null }),
  transcribeDetailed: vi.fn<() => Promise<any>>(),
  transcribe: vi.fn<(fileId: string, mimeType?: string, ctx?: { updateId?: number }) => Promise<string | null>>(),
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
    decideCommunicationAutopilotResponseWithLlmRouter: (...args: unknown[]) => mocks.decideAutopilot(...args),
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
  createOpsTask: (...args: unknown[]) => mocks.createOpsTask(...args),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: vi.fn(),
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({ status: 'unmatched', confidence: 0 }),
}));

vi.mock('../voice-transcription', async () => {
  const actual = await vi.importActual<typeof import('../voice-transcription')>('../voice-transcription');
  return {
    ...actual,
    transcribeVoiceMessageDetailed: async (fileId: string, mimeType?: string, ctx?: { updateId?: number }) => {
      const detailed = await mocks.transcribeDetailed();
      if (detailed) return detailed;
      const text = await mocks.transcribe(fileId, mimeType, ctx);
      if (!text) return { ok: false, reason: 'stt_failed', provider: 'voice_stt_relay', stt: { kind: 'empty' } };
      return {
        ok: true,
        text,
        provider: 'voice_stt_relay',
        usedFallback: false,
        filename: 'voice_message.ogg',
        mimeType: mimeType ?? 'audio/ogg',
        extension: '.ogg',
        filePath: 'voice/file.oga',
        downloadBytes: 12,
      };
    },
  };
});

import { __resetAutonomousSessionStoreForTests, loadAutonomousSession } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import {
  __resetEscalationReviewStoreForTests,
  getActiveEscalationReviewIdForSession,
  listEscalationReviews,
  sendOperatorReply,
} from '../operator-review';
import { __resetSessionStatusStoreForTests } from '../session-status';
import {
  canAiReply,
  lockSessionForOperator,
  releaseSessionToAi,
} from '../handoff-lock';
import { processUpdate } from '../orchestrator';
import { processTelegramVoiceUpdate } from '../telegram-voice-inbound';

function resetAllStores(): void {
  _resetForTesting();
  __resetAutonomousSessionStoreForTests();
  __resetConversationSessionEngineForTests();
  __resetEscalationReviewStoreForTests();
  __resetSessionStatusStoreForTests();
}

function resetEphemeralMocks(): void {
  mocks.sendMessage.mockClear();
  mocks.answerTelegramCallbackQuery.mockClear();
  mocks.decideAutopilot.mockClear();
  mocks.createOpsTask.mockClear();
  mocks.transcribeDetailed.mockReset();
  mocks.transcribe.mockReset();
  mocks.transcribe.mockResolvedValue(null);
  mocks.insertedRows.length = 0;
}

function buildDeps(): CommV1AcceptanceDeps {
  return {
    processUpdate,
    processTelegramVoiceUpdate,
    loadAutonomousSession: (chatId) => loadAutonomousSession(chatId) ?? null,
    listEscalationReviews: (filter) => listEscalationReviews(filter as any),
    getActiveEscalationReviewIdForSession,
    canAiReply,
    lockSessionForOperator,
    releaseSessionToAi,
    sendOperatorReply,
    getSendMessageCalls: () =>
      mocks.sendMessage.mock.calls.map((call) => ({
        chatId: call[0] as string | number,
        text: String(call[1] ?? ''),
        metadata: (call[2] as Record<string, unknown> | undefined) ?? undefined,
      })),
    getAnswerCallbackQueryCalls: () =>
      mocks.answerTelegramCallbackQuery.mock.calls.map((call) => ({
        callbackQueryId: String(call[0] ?? ''),
        text: call[1] !== undefined ? String(call[1]) : undefined,
      })),
    resetEphemeralMocks,
  };
}

describe('COMM v1 automated acceptance', () => {
  beforeEach(() => {
    resetAllStores();
    resetEphemeralMocks();
    delete process.env.VOICE_REPLY_ENABLED;
  });

  afterEach(() => {
    delete process.env.VOICE_REPLY_ENABLED;
  });

  it('COMM v1 automated acceptance contour', async () => {
    const result = await runCommV1AutomatedAcceptance(buildDeps());

    console.log(formatCommV1AcceptanceResultLine(result));

    for (const [name, status] of Object.entries(result.checks)) {
      if (status === 'FAIL') {
        const detail = result.failures.find((item) => item.startsWith(`${name}:`));
        expect.soft(status, detail ?? name).toBe('PASS');
      }
    }

    expect(result.ok, result.failures.join('\n')).toBe(true);
  });
});
