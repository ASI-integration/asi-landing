import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  recordTelegramVoiceAcceptanceEvidence,
  TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE,
} from '../telegram-voice-acceptance-state';
import {
  inboundSttInputError,
  resolveInboundSttFileId,
} from '../../../../scripts/telegram-voice-acceptance-input.mjs';
import { sanitizeVoiceSttDiagnostic } from '../../../../scripts/telegram-voice-stt-dry-run.mjs';

const temporaryDirectories: string[] = [];

function temporaryStateDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'asi-telegram-voice-evidence-'));
  temporaryDirectories.push(directory);
  return directory;
}

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

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('discovers fresh voice evidence only for the configured Telegram test chat', () => {
    const stateDir = temporaryStateDir();
    const now = new Date('2026-08-09T10:00:00.000Z');
    const written = recordTelegramVoiceAcceptanceEvidence(
      {
        chatId: 501,
        updateId: 7001,
        messageId: 8001,
        messageDateUnixSeconds: now.getTime() / 1000,
        kind: 'voice',
        fileId: 'fresh-test-chat-file-id',
      },
      { env: { TELEGRAM_TEST_CHAT_ID: '501', COMM_STATE_DIR: stateDir }, now },
    );

    expect(written.status).toBe('written');
    expect(
      resolveInboundSttFileId({
        testChatId: '501',
        stateFile: join(stateDir, TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE),
        nowMs: now.getTime(),
      }),
    ).toEqual({ ok: true, source: 'test_chat_state', fileId: 'fresh-test-chat-file-id' });
  });

  it('ignores a voice from another Telegram chat without replacing test-chat evidence', () => {
    const stateDir = temporaryStateDir();
    const now = new Date('2026-08-09T10:00:00.000Z');
    const env = { TELEGRAM_TEST_CHAT_ID: '501', COMM_STATE_DIR: stateDir };
    recordTelegramVoiceAcceptanceEvidence(
      {
        chatId: 501,
        updateId: 7001,
        messageId: 8001,
        messageDateUnixSeconds: now.getTime() / 1000,
        kind: 'voice',
        fileId: 'matching-file-id',
      },
      { env, now },
    );

    expect(
      recordTelegramVoiceAcceptanceEvidence(
        {
          chatId: 999,
          updateId: 7002,
          messageId: 8002,
          messageDateUnixSeconds: now.getTime() / 1000,
          kind: 'voice',
          fileId: 'other-user-file-id',
        },
        { env, now },
      ),
    ).toEqual({ status: 'ignored', reason: 'chat_mismatch' });
    expect(
      resolveInboundSttFileId({
        testChatId: '501',
        stateFile: join(stateDir, TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE),
        nowMs: now.getTime(),
      }),
    ).toMatchObject({ ok: true, fileId: 'matching-file-id' });
  });

  it('rejects stale Telegram voice evidence', () => {
    const stateDir = temporaryStateDir();
    const now = new Date('2026-08-09T10:30:00.000Z');
    recordTelegramVoiceAcceptanceEvidence(
      {
        chatId: 501,
        updateId: 7001,
        messageId: 8001,
        messageDateUnixSeconds: new Date('2026-08-09T10:00:00.000Z').getTime() / 1000,
        kind: 'voice',
        fileId: 'stale-file-id',
      },
      { env: { TELEGRAM_TEST_CHAT_ID: '501', COMM_STATE_DIR: stateDir }, now },
    );

    expect(
      resolveInboundSttFileId({
        testChatId: '501',
        stateFile: join(stateDir, TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE),
        maxAgeMs: 20 * 60 * 1000,
        nowMs: now.getTime(),
      }),
    ).toEqual({ ok: false, reason: 'stale_voice_evidence' });
  });

  it('does not let an older test-chat delivery replace newer voice evidence', () => {
    const stateDir = temporaryStateDir();
    const now = new Date('2026-08-09T10:00:00.000Z');
    const env = { TELEGRAM_TEST_CHAT_ID: '501', COMM_STATE_DIR: stateDir };
    recordTelegramVoiceAcceptanceEvidence(
      {
        chatId: 501,
        updateId: 7002,
        messageId: 8002,
        messageDateUnixSeconds: now.getTime() / 1000,
        kind: 'voice',
        fileId: 'newer-file-id',
      },
      { env, now },
    );

    expect(
      recordTelegramVoiceAcceptanceEvidence(
        {
          chatId: 501,
          updateId: 7001,
          messageId: 8001,
          messageDateUnixSeconds: now.getTime() / 1000 - 60,
          kind: 'voice',
          fileId: 'older-file-id',
        },
        { env, now },
      ),
    ).toEqual({ status: 'ignored', reason: 'older_than_recorded' });
    expect(
      resolveInboundSttFileId({
        testChatId: '501',
        stateFile: join(stateDir, TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE),
        nowMs: now.getTime(),
      }),
    ).toMatchObject({ ok: true, fileId: 'newer-file-id' });
  });

  it('fails closed when no Telegram voice evidence exists', () => {
    const result = resolveInboundSttFileId({
      testChatId: '501',
      stateFile: join(temporaryStateDir(), TELEGRAM_VOICE_ACCEPTANCE_STATE_FILE),
    });

    expect(result).toEqual({ ok: false, reason: 'no_voice_evidence' });
    expect(inboundSttInputError(result.reason)).toContain(
      'Send a new voice note in that dedicated test chat to @ASI_core_bot, wait for the bot to process it, then rerun acceptance with stt_file_id empty.',
    );
  });

  it('preserves the explicit STT file id diagnostic override', () => {
    expect(
      resolveInboundSttFileId({
        explicitFileId: 'operator-diagnostic-file-id',
        testChatId: '',
        stateFile: 'not-read-for-an-explicit-override',
      }),
    ).toEqual({ ok: true, source: 'explicit', fileId: 'operator-diagnostic-file-id' });
  });

  it('does not leak Telegram voice file ids through inbound logs', async () => {
    const stateDir = temporaryStateDir();
    vi.stubEnv('TELEGRAM_TEST_CHAT_ID', '511');
    vi.stubEnv('COMM_STATE_DIR', stateDir);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.transcribe.mockResolvedValue(null);

    await processTelegramVoiceUpdate(
      tgVoiceUpdate({
        chat_id: 511,
        user_id: 9011,
        update_id: 7611,
        message_id: 8611,
        file_id: 'telegram-sensitive-file-id',
      }),
    );

    const logs = JSON.stringify([
      ...logSpy.mock.calls,
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]);
    expect(logs).not.toContain('telegram-sensitive-file-id');
    expect(logs).not.toContain('telegram_file_id');
    expect(logs).not.toContain('TELEGRAM_BOT_TOKEN=');

    const botToken = '123456789:telegram-test-secret';
    const fileId = 'telegram-sensitive-file-id';
    const sanitized = sanitizeVoiceSttDiagnostic(
      `download failed at https://api.telegram.org/file/bot${botToken}/voice.oga token=${botToken} file_id=${fileId}`,
      700,
      [botToken, fileId],
    );
    expect(sanitized).not.toContain(botToken);
    expect(sanitized).not.toContain(fileId);
    expect(sanitized).toContain('[redacted]');
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

  it('does not create a dialog for whitespace-only STT success', async () => {
    mocks.transcribeDetailed.mockResolvedValue({
      ok: true,
      text: '   \n\t  ',
      provider: 'voice_stt_relay',
      usedFallback: false,
      filename: 'voice_message.ogg',
      mimeType: 'audio/ogg',
      extension: '.ogg',
      filePath: 'voice/file.oga',
      downloadBytes: 12,
    });

    const result = await processTelegramVoiceUpdate(
      tgVoiceUpdate({ chat_id: 508, user_id: 9008, update_id: 7203, message_id: 8203, language_code: 'ru' }),
    );

    expect(result.outcome).toBe('voice_fallback_sent');
    expect((result as any).reason).toBe('stt_failed');
    expect(telegramSessions()).toHaveLength(0);
    expect(mocks.replyToTelegram).toHaveBeenCalledTimes(1);
  });

  it('drops a duplicate voice update and does not send a second fallback', async () => {
    mocks.transcribe.mockResolvedValue(null);
    const update = tgVoiceUpdate({
      chat_id: 509,
      user_id: 9009,
      update_id: 7204,
      message_id: 8204,
      language_code: 'ru',
    });

    const first = await processTelegramVoiceUpdate(update);
    const second = await processTelegramVoiceUpdate(update);

    expect(first.outcome).toBe('voice_fallback_sent');
    expect(second.outcome).toBe('duplicate');
    expect(mocks.replyToTelegram).toHaveBeenCalledTimes(1);
    expect(telegramSessions()).toHaveLength(0);
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
