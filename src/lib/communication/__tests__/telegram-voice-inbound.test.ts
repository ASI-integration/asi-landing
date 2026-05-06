import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { tgAudioUpdate, tgVoiceUpdate } from '../dev/telegram-fixtures';
import { processTelegramVoiceUpdate } from '../telegram-voice-inbound';

const mockTranscribe = vi.fn<(fileId: string, mimeType?: string, ctx?: { updateId?: number }) => Promise<string | null>>();
vi.mock('../voice-transcription', async () => {
  const actual = await vi.importActual<typeof import('../voice-transcription')>('../voice-transcription');
  return {
    ...actual,
    transcribeVoiceMessage: (fileId: string, mimeType?: string, ctx?: { updateId?: number }) => mockTranscribe(fileId, mimeType, ctx),
  };
});

const mockHandleVoiceTranscript = vi.fn<(input: any) => Promise<any>>();
vi.mock('../voice/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('../voice/orchestrator')>('../voice/orchestrator');
  return { ...actual, handleVoiceTranscript: (input: any) => mockHandleVoiceTranscript(input) };
});

const mockReply = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: any[]) => mockReply(...args),
}));

const mockCreateReview = vi.fn();
vi.mock('../operator-review', async () => {
  const actual = await vi.importActual<typeof import('../operator-review')>('../operator-review');
  return { ...actual, createOrUpdateEscalationReview: (...args: any[]) => mockCreateReview(...args) };
});

describe('telegram voice inbound', () => {
  beforeEach(() => {
    _resetForTesting();
    mockTranscribe.mockReset();
    mockHandleVoiceTranscript.mockReset();
    mockReply.mockClear();
    mockCreateReview.mockReset();
    delete process.env.OPERATOR_TELEGRAM_CHAT_ID;
    delete process.env.OPERATOR_EMAIL;
  });

  it('transcribes a Telegram voice message and routes the transcript through the voice orchestrator', async () => {
    mockTranscribe.mockResolvedValue('hello from voice');
    mockHandleVoiceTranscript.mockResolvedValue({
      brain: { outcome: 'replied', reply: 'hello back' },
      output: { text: 'hello back', mode: 'speak', shouldEndTurn: true, shouldEscalate: false },
    });
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 1001, message_id: 2002, language_code: 'en' });

    const r = await processTelegramVoiceUpdate(update);

    expect(r.outcome).toBe('voice_transcript_processed');
    expect(mockTranscribe).toHaveBeenCalledWith('voice_1001', 'audio/ogg', { updateId: 1001 });
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(1);
    expect(mockHandleVoiceTranscript.mock.calls[0][0]).toMatchObject({
      channel: 'telegram_voice',
      actorId: '111',
      transcript: 'hello from voice',
      language: 'en',
      providerUpdateId: 1001,
      providerMessageId: '2002',
      externalMessageId: '2002',
      providerMediaId: 'voice_1001',
    });
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(0);
  });

  it('transcribes a Telegram audio message and routes it as telegram_voice', async () => {
    mockTranscribe.mockResolvedValue('audio transcript');
    mockHandleVoiceTranscript.mockResolvedValue({
      brain: { outcome: 'replied', reply: 'audio handled' },
      output: { text: 'audio handled', mode: 'speak', shouldEndTurn: true, shouldEscalate: false },
    });
    const update = tgAudioUpdate({ chat_id: 112, update_id: 1002, message_id: 2003, language_code: 'en' });

    const r = await processTelegramVoiceUpdate(update);

    expect(r.outcome).toBe('voice_transcript_processed');
    expect(mockTranscribe).toHaveBeenCalledWith('audio_1002', 'audio/mpeg', { updateId: 1002 });
    expect(mockHandleVoiceTranscript.mock.calls[0][0]).toMatchObject({
      channel: 'telegram_voice',
      actorId: '112',
      transcript: 'audio transcript',
      providerMediaId: 'audio_1002',
    });
  });

  it('dedupes duplicate update delivery (no second reply)', async () => {
    mockTranscribe.mockResolvedValue('hi');
    mockHandleVoiceTranscript.mockResolvedValue({
      brain: { outcome: 'replied', reply: 'hi' },
      output: { text: 'hi', mode: 'speak', shouldEndTurn: true, shouldEscalate: false },
    });
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 1001, message_id: 2002, language_code: 'en' });

    const r1 = await processTelegramVoiceUpdate(update);
    const r2 = await processTelegramVoiceUpdate(update);

    expect(r1.outcome).toBe('voice_transcript_processed');
    expect(r2.outcome).toBe('duplicate');
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(1);
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(0);
  });

  it('falls back clearly when STT fails, without operator handoff claims', async () => {
    process.env.OPERATOR_TELEGRAM_CHAT_ID = '-100123';
    mockTranscribe.mockResolvedValue(null);
    const update = tgVoiceUpdate({ chat_id: 222, update_id: 3003, message_id: 4004, language_code: 'ru' });

    const r1 = await processTelegramVoiceUpdate(update);
    const r2 = await processTelegramVoiceUpdate(update);

    expect(r1.outcome).toBe('voice_fallback_sent');
    expect(r2.outcome).toBe('duplicate');
    expect((r1 as any).reason).toBe('stt_failed');
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(String(mockReply.mock.calls[0][1])).toMatch(/Не удалось распознать голосовое/i);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(0);
  });

  it('falls back clearly when the communication handling path returns an error', async () => {
    mockTranscribe.mockResolvedValue('протекает труба');
    mockHandleVoiceTranscript.mockResolvedValue({
      brain: { outcome: 'error' },
      output: { text: 'Okay.', mode: 'speak', shouldEndTurn: true, shouldEscalate: false },
    });
    const update = tgVoiceUpdate({ chat_id: 222, update_id: 3003, message_id: 4004, language_code: 'ru' });

    const r = await processTelegramVoiceUpdate(update);

    expect(r.outcome).toBe('voice_fallback_sent');
    expect((r as any).reason).toBe('processing_failed');
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(String(mockReply.mock.calls[0][1])).toMatch(/Не удалось распознать голосовое/i);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(1);
  });
});

