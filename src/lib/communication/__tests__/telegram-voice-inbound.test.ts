import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { tgVoiceUpdate } from '../dev/telegram-fixtures';
import { processTelegramVoiceUpdate } from '../telegram-voice-inbound';

const mockTranscribe = vi.fn<Parameters<typeof import('../voice-transcription').transcribeVoiceMessage>, any>();
vi.mock('../voice-transcription', async () => {
  const actual = await vi.importActual<typeof import('../voice-transcription')>('../voice-transcription');
  return { ...actual, transcribeVoiceMessage: (...args: any[]) => mockTranscribe(...args) };
});

const mockHandleVoiceTranscript = vi.fn();
vi.mock('../voice/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('../voice/orchestrator')>('../voice/orchestrator');
  return { ...actual, handleVoiceTranscript: (...args: any[]) => mockHandleVoiceTranscript(...args) };
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
  });

  it('normalizes voice update -> STT -> handleVoiceTranscript with provider ids', async () => {
    mockTranscribe.mockResolvedValue('hello from voice');
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 1001, message_id: 2002, language_code: 'en' });

    const r = await processTelegramVoiceUpdate(update);

    expect(r.outcome).toBe('transcribed');
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(1);

    const args = mockHandleVoiceTranscript.mock.calls[0][0];
    expect(args.channel).toBe('telegram_voice');
    expect(args.actorId).toBe('111');
    expect(args.transcript).toBe('hello from voice');
    expect(args.providerUpdateId).toBe(1001);
    expect(args.providerMessageId).toBe('2002');
    expect(args.providerMediaId).toMatch(/^voice_/);
  });

  it('dedupes duplicate update delivery (no second STT, no second brain call)', async () => {
    mockTranscribe.mockResolvedValue('hi');
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 1001, message_id: 2002, language_code: 'en' });

    const r1 = await processTelegramVoiceUpdate(update);
    const r2 = await processTelegramVoiceUpdate(update);

    expect(r1.outcome).toBe('transcribed');
    expect(r2.outcome).toBe('duplicate');
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(1);
  });

  it('safe failure: STT failure escalates and sends holding reply once', async () => {
    mockTranscribe.mockResolvedValue(null);
    const update = tgVoiceUpdate({ chat_id: 222, update_id: 3003, message_id: 4004, language_code: 'ru' });

    const r1 = await processTelegramVoiceUpdate(update);
    const r2 = await processTelegramVoiceUpdate(update);

    expect(r1.outcome).toBe('stt_failed_escalated');
    expect(r2.outcome).toBe('duplicate');
    expect(mockCreateReview).toHaveBeenCalledTimes(1);
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(String(mockReply.mock.calls[0][1])).toMatch(/Спасибо/i);
    expect(mockHandleVoiceTranscript).toHaveBeenCalledTimes(0);
  });
});

