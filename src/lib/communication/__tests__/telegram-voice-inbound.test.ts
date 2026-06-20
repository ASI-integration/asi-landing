import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { tgAudioUpdate, tgTextUpdate, tgVoiceUpdate } from '../dev/telegram-fixtures';
import { MessageCategory, MessageDirection, MessageType } from '../types';

const mocks = vi.hoisted(() => ({
  transcribeDetailed: vi.fn<() => Promise<any>>(),
  transcribe: vi.fn<(fileId: string, mimeType?: string, ctx?: { updateId?: number }) => Promise<string | null>>(),
  sendMessage: vi.fn().mockResolvedValue(true),
  replyToTelegram: vi.fn().mockResolvedValue(true),
  callLLM: vi.fn().mockResolvedValue('LLM reply text'),
  detectIntent: vi.fn().mockResolvedValue({ intent: 'general_question', confidence: 0.9 }),
  createPaymentRequest: vi.fn().mockResolvedValue({
    id: 'pay_mock',
    provider: 'stripe',
    status: 'pending',
    paymentUrl: 'https://pay.test/pay_mock',
  }),
  matchReservation: vi.fn().mockResolvedValue({ status: 'unmatched', confidence: 0 }),
  createOpsTask: vi.fn().mockResolvedValue({ task_id: 'task_mock', error: null }),
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

vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => {
      throw new Error('normalizeInbound not used in tests');
    },
    sendMessage: (to: string, content: string, metadata?: Record<string, unknown>) =>
      mocks.sendMessage(to, content, metadata),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mocks.replyToTelegram(...args),
  answerTelegramCallbackQuery: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mocks.callLLM(...args),
}));

vi.mock('../intent', () => ({
  detectIntent: (...args: unknown[]) => mocks.detectIntent(...args),
}));

vi.mock('../reservation', () => ({
  matchReservation: (...args: unknown[]) => mocks.matchReservation(...args),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: (...args: unknown[]) => mocks.createPaymentRequest(...args),
}));

vi.mock('@/lib/ops/tasks', () => ({
  createOpsTask: (...args: unknown[]) => mocks.createOpsTask(...args),
  OpsTaskType: { GuestIssue: 'guest_issue', Checkout: 'checkout' },
  OpsTaskPriority: { Urgent: 'urgent', Normal: 'normal' },
}));

vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: () => ({ ready: true, missing: [], blocked: false }),
}));

function makeSupabaseQuery() {
  const q: any = {};
  q.upsert = vi.fn(async () => ({ data: null, error: null }));
  q.insert = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: { id: 'row_mock' }, error: null }),
    }),
    single: async () => ({ data: { id: 'row_mock' }, error: null }),
    then: (resolve: (value: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
  }));
  q.update = vi.fn(() => q);
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.in = vi.fn(() => q);
  q.order = vi.fn(() => q);
  q.limit = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  q.single = vi.fn(async () => ({ data: null, error: null }));
  return q;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => makeSupabaseQuery()),
  },
}));

import { processUpdate } from '../orchestrator';
import { processTelegramVoiceUpdate } from '../telegram-voice-inbound';
import {
  __listConversationSessionsForTests,
  __resetConversationSessionEngineForTests,
} from '../conversation-session-engine';
import { __resetAutonomousSessionStoreForTests, loadAutonomousSession } from '../conversation-session-store';
import { __resetEscalationReviewStoreForTests } from '../operator-review';

function telegramSessions() {
  return __listConversationSessionsForTests().filter(s => s.channel === 'telegram');
}

function inboundMessages() {
  const [session] = telegramSessions();
  return (session?.memory.lastMessages ?? []).filter(m => m.direction === MessageDirection.Inbound);
}

describe('telegram voice inbound session continuity', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    mocks.transcribeDetailed.mockReset();
    mocks.transcribe.mockReset();
    mocks.sendMessage.mockClear();
    mocks.replyToTelegram.mockClear();
    mocks.callLLM.mockClear();
    mocks.callLLM.mockResolvedValue('LLM reply text');
    mocks.detectIntent.mockClear();
    mocks.detectIntent.mockResolvedValue({ intent: 'general_question', confidence: 0.9 });
    mocks.matchReservation.mockClear();
    mocks.matchReservation.mockResolvedValue({ status: 'unmatched', confidence: 0 });
    mocks.createOpsTask.mockClear();
  });

  it('text then voice from the same Telegram chat uses the same conversation session', async () => {
    await processUpdate(
      tgTextUpdate({
        chat_id: 501,
        user_id: 9001,
        update_id: 7001,
        message_id: 8001,
        text: 'I have a question about parking',
      }),
    );

    mocks.transcribe.mockResolvedValue('the wifi is not working');
    const voice = await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 501, user_id: 9001, update_id: 7002, message_id: 8002, language_code: 'en' }),
    );

    expect(voice.outcome).toBe('voice_transcript_processed');
    expect(telegramSessions()).toHaveLength(1);
    const inbound = inboundMessages();
    expect(inbound).toHaveLength(2);
    expect(inbound[0].content).toBe('I have a question about parking');
    expect(inbound[0].type).toBe(MessageType.Text);
    expect(inbound[1].content).toBe('the wifi is not working');
    expect(inbound[1].type).toBe(MessageType.Voice);
    expect(inbound[1].meta).toMatchObject({
      transport: 'telegram_voice',
      source: 'voice',
      original_message_type: 'voice',
      originalMessageType: 'voice',
      sttStatus: 'success',
      transcription: 'the wifi is not working',
      transcriptText: 'the wifi is not working',
      duration: 3,
      telegram_chat_id: 501,
      telegram_user_id: 9001,
    });
  });

  it('voice then text from the same Telegram chat uses the same conversation session', async () => {
    mocks.transcribe.mockResolvedValue('what is the wifi password');
    await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 502, user_id: 9002, update_id: 7101, message_id: 8101, language_code: 'en' }),
    );

    await processUpdate(
      tgTextUpdate({
        chat_id: 502,
        user_id: 9002,
        update_id: 7102,
        message_id: 8102,
        text: 'thank you',
      }),
    );

    expect(telegramSessions()).toHaveLength(1);
    const inbound = inboundMessages();
    expect(inbound).toHaveLength(2);
    expect(inbound[0].content).toBe('what is the wifi password');
    expect(inbound[0].type).toBe(MessageType.Voice);
    expect(inbound[1].content).toBe('thank you');
    expect(inbound[1].type).toBe(MessageType.Text);
  });

  it('fails safely when STT fails and does not create a broken conversation session', async () => {
    mocks.transcribe.mockResolvedValue(null);

    const result = await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 503, user_id: 9003, update_id: 7201, message_id: 8201, language_code: 'ru' }),
    );

    expect(result.outcome).toBe('voice_fallback_sent');
    expect((result as any).reason).toBe('stt_failed');
    expect(telegramSessions()).toHaveLength(0);
    expect(mocks.replyToTelegram).toHaveBeenCalledTimes(1);
    expect(String(mocks.replyToTelegram.mock.calls[0][1])).toBe(
      'Не удалось разобрать голосовое сообщение. Напишите, пожалуйста, текстом или отправьте голосовое ещё раз.',
    );
  });

  it('logs sanitized STT auth failures while keeping the voice fallback text', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.transcribeDetailed.mockResolvedValue({
      ok: false,
      reason: 'stt_failed',
      provider: 'voice_stt_relay',
      filename: 'voice_message.ogg',
      mimeType: 'audio/ogg',
      extension: '.ogg',
      filePath: 'voice/file.oga',
      downloadBytes: 12,
      stt: {
        kind: 'http',
        code: 'stt_auth_failed',
        status: 401,
        message: 'Bearer [redacted]',
      },
    });

    const result = await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 507, user_id: 9007, update_id: 7202, message_id: 8202, language_code: 'ru' }),
    );

    expect(result.outcome).toBe('voice_fallback_sent');
    expect(mocks.replyToTelegram).toHaveBeenCalledTimes(1);
    expect(String(mocks.replyToTelegram.mock.calls[0][1])).toBe(
      'Не удалось разобрать голосовое сообщение. Напишите, пожалуйста, текстом или отправьте голосовое ещё раз.',
    );
    const logs = JSON.stringify(warnSpy.mock.calls);
    expect(logs).toContain('stt_auth_failed');
    expect(logs).toContain('Bearer [redacted]');
    expect(logs).not.toContain('sk-liveSecret');
  });

  it('classifies a voice transcript like the same Telegram text', async () => {
    await processUpdate({
      update_id: 7299,
      callback_query: {
        id: 'voice-classify-guest',
        from: { id: 9004, language_code: 'en' },
        message: {
          message_id: 8299,
          chat: { id: 504 },
          text: 'identity',
        },
        data: 'identity:guest',
      },
    });
    mocks.sendMessage.mockClear();
    mocks.transcribe.mockResolvedValue('urgent lock failed access');

    const result = await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 504, user_id: 9004, update_id: 7301, message_id: 8301, language_code: 'en' }),
    );

    expect(result.outcome).toBe('voice_transcript_processed');
    if (result.outcome !== 'voice_transcript_processed') throw new Error('expected voice transcript processing');
    expect(result.category).toBe(MessageCategory.Issue);
    const inbound = inboundMessages().at(-1);
    expect(inbound?.content).toBe('urgent lock failed access');
    expect(inbound?.type).toBe(MessageType.Voice);
  });

  it('transcribes Telegram audio messages with audio source metadata', async () => {
    mocks.transcribe.mockResolvedValue('audio transcript');

    const result = await processTelegramVoiceUpdate(
      tgAudioUpdate({ chat_id: 505, user_id: 9005, update_id: 7401, message_id: 8401, language_code: 'en' }),
    );

    expect(result.outcome).toBe('voice_transcript_processed');
    expect(mocks.transcribe).toHaveBeenCalledWith('audio_7401', 'audio/mpeg', { updateId: 7401 });
    const [inbound] = inboundMessages();
    expect(inbound.type).toBe(MessageType.Voice);
    expect(inbound.meta).toMatchObject({
      source: 'audio',
      transport: 'telegram_voice',
      original_message_type: 'audio',
      originalMessageType: 'audio',
      voice: {
        voiceChannel: 'telegram_voice',
        original_message_type: 'audio',
        originalMessageType: 'audio',
        sttStatus: 'success',
        transcription: 'audio transcript',
        transcriptText: 'audio transcript',
        duration: 12,
        telegramChatId: 505,
        telegramUserId: 9005,
      },
    });
  });

  it('saves an unknown voice transcript as pending first message and replays it after guest selection', async () => {
    mocks.transcribe.mockResolvedValue('вы можете порекомендовать рестораны рядом?');

    const first = await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 506, user_id: 9006, update_id: 7501, message_id: 8501, language_code: 'ru' }),
    );

    expect(first.outcome).toBe('voice_transcript_processed');
    expect(loadAutonomousSession(506)?.pending_identity_message).toBe('вы можете порекомендовать рестораны рядом?');
    expect(mocks.sendMessage.mock.calls.at(-1)?.[2]?.reply_markup).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: 'identity:guest' })]),
      ]),
    });

    const replay = await processUpdate({
      update_id: 7502,
      callback_query: {
        id: 'voice-pending-guest',
        from: { id: 9006, language_code: 'ru' },
        message: {
          message_id: 8502,
          chat: { id: 506 },
          text: 'identity',
        },
        data: 'identity:guest',
      },
    });

    expect(replay.reply).toContain('кафе и рестораны');
    expect(loadAutonomousSession(506)?.pending_identity_message).toBeNull();
  });
});
