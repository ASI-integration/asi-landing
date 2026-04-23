import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { tgVoiceUpdate } from '../dev/telegram-fixtures';
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

  it('de-scoped: always replies with honest "send text" fallback', async () => {
    mockTranscribe.mockResolvedValue('hello from voice');
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 1001, message_id: 2002, language_code: 'en' });

    const r = await processTelegramVoiceUpdate(update);

    expect(r.outcome).toBe('voice_fallback_sent');
    expect(mockTranscribe).toHaveBeenCalledTimes(0);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(0);
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(String(mockReply.mock.calls[0][1])).toMatch(/send it as text/i);
  });

  it('dedupes duplicate update delivery (no second reply)', async () => {
    mockTranscribe.mockResolvedValue('hi');
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 1001, message_id: 2002, language_code: 'en' });

    const r1 = await processTelegramVoiceUpdate(update);
    const r2 = await processTelegramVoiceUpdate(update);

    expect(r1.outcome).toBe('voice_fallback_sent');
    expect(r2.outcome).toBe('duplicate');
    expect(mockTranscribe).toHaveBeenCalledTimes(0);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(0);
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(1);
  });

  it('does not claim operator handoff even if operator env vars exist', async () => {
    process.env.OPERATOR_TELEGRAM_CHAT_ID = '-100123';
    mockTranscribe.mockResolvedValue(null);
    const update = tgVoiceUpdate({ chat_id: 222, update_id: 3003, message_id: 4004, language_code: 'ru' });

    const r1 = await processTelegramVoiceUpdate(update);
    const r2 = await processTelegramVoiceUpdate(update);

    expect(r1.outcome).toBe('voice_fallback_sent');
    expect(r2.outcome).toBe('duplicate');
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(String(mockReply.mock.calls[0][1])).toMatch(/Не удалось распознать голосовое/i);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(0);
  });

  it('replies honestly (RU) with the requested fallback text', async () => {
    mockTranscribe.mockResolvedValue(null);
    const update = tgVoiceUpdate({ chat_id: 222, update_id: 3003, message_id: 4004, language_code: 'ru' });

    const r = await processTelegramVoiceUpdate(update);

    expect(r.outcome).toBe('voice_fallback_sent');
    expect(mockCreateReview).toHaveBeenCalledTimes(0);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(String(mockReply.mock.calls[0][1])).toMatch(/Не удалось распознать голосовое/i);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(0);
  });
});

