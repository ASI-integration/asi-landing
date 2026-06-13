import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tgAudioUpdate, tgTextUpdate, tgVoiceUpdate } from '@/lib/communication/dev/telegram-fixtures';

const mockProcessUpdate = vi.fn();
vi.mock('@/lib/communication/orchestrator', () => ({
  processUpdate: (...args: unknown[]) => mockProcessUpdate(...args),
}));

const mockProcessTelegramVoiceUpdate = vi.fn();
vi.mock('@/lib/communication/telegram-voice-inbound', () => ({
  processTelegramVoiceUpdate: (...args: unknown[]) => mockProcessTelegramVoiceUpdate(...args),
}));

const mockProcessTelegramLeadIntakeUpdate = vi.fn();
vi.mock('@/lib/communication/telegram-lead-intake', () => ({
  processTelegramLeadIntakeUpdate: (...args: unknown[]) => mockProcessTelegramLeadIntakeUpdate(...args),
}));

const mockReplyToTelegram = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

import { POST } from '../webhook/route';

function telegramRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Telegram webhook route', () => {
  beforeEach(() => {
    mockProcessUpdate.mockReset();
    mockProcessTelegramVoiceUpdate.mockReset();
    mockProcessTelegramLeadIntakeUpdate.mockReset();
    mockProcessTelegramLeadIntakeUpdate.mockResolvedValue(null);
    mockReplyToTelegram.mockReset();
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.ASI_FEEDBACK_WEBHOOK_SECRET;
    vi.useRealTimers();
  });

  it('detects Telegram voice messages and uses the voice inbound path', async () => {
    const update = tgVoiceUpdate({ chat_id: 111, update_id: 9001, message_id: 42 });
    mockProcessTelegramVoiceUpdate.mockResolvedValue({
      outcome: 'voice_transcript_processed',
      update_id: 9001,
      chat_id: 111,
      message_id: 42,
    });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, path: 'voice_transcript_processed' });
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessUpdate).toHaveBeenCalledTimes(0);
  });

  it('detects Telegram audio messages and uses the voice inbound path', async () => {
    const update = tgAudioUpdate({ chat_id: 222, update_id: 9002, message_id: 43 });
    mockProcessTelegramVoiceUpdate.mockResolvedValue({
      outcome: 'voice_transcript_processed',
      update_id: 9002,
      chat_id: 222,
      message_id: 43,
    });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, path: 'voice_transcript_processed' });
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessUpdate).toHaveBeenCalledTimes(0);
  });

  it('continues routing non-lead text Telegram messages through processUpdate', async () => {
    const update = tgTextUpdate({ chat_id: 333, update_id: 9003, message_id: 44, text: 'hello' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9003, chat_id: 333 });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessTelegramLeadIntakeUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledTimes(0);
  });

  it('routes ASI Feedback lead intake before the operational orchestrator', async () => {
    const update = tgTextUpdate({ chat_id: 334, update_id: 9007, message_id: 48, text: '/start site' });
    mockProcessTelegramLeadIntakeUpdate.mockResolvedValue({
      outcome: 'replied',
      update_id: 9007,
      chat_id: 334,
      reply: 'question',
    });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, path: 'telegram_lead_intake' });
    expect(mockProcessTelegramLeadIntakeUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessUpdate).toHaveBeenCalledTimes(0);
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledTimes(0);
  });

  it('accepts ASI Feedback webhook secret for lead intake', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'operational-secret';
    process.env.ASI_FEEDBACK_WEBHOOK_SECRET = 'feedback-secret';
    const update = tgTextUpdate({ chat_id: 335, update_id: 9008, message_id: 49, text: '/start site' });
    mockProcessTelegramLeadIntakeUpdate.mockResolvedValue({
      outcome: 'replied',
      update_id: 9008,
      chat_id: 335,
      reply: 'question',
    });

    const res = await POST(telegramRequest(update, {
      'x-telegram-bot-api-secret-token': 'feedback-secret',
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, path: 'telegram_lead_intake' });
    expect(mockProcessTelegramLeadIntakeUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessUpdate).toHaveBeenCalledTimes(0);
  });

  it('keeps operational webhook secret out of ASI Feedback lead intake', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'operational-secret';
    process.env.ASI_FEEDBACK_WEBHOOK_SECRET = 'feedback-secret';
    const update = tgTextUpdate({ chat_id: 336, update_id: 9009, message_id: 50, text: '/start site' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9009, chat_id: 336 });

    const res = await POST(telegramRequest(update, {
      'x-telegram-bot-api-secret-token': 'operational-secret',
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessTelegramLeadIntakeUpdate).toHaveBeenCalledTimes(0);
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
  });

  it('does not send an extra slow acknowledgement while waiting for final processing', async () => {
    vi.useFakeTimers();
    const update = tgTextUpdate({ chat_id: 444, update_id: 9004, message_id: 45, text: 'Need check-in details' });
    let resolveProcess!: (value: { outcome: string; update_id: number; chat_id: number }) => void;
    mockProcessUpdate.mockReturnValue(
      new Promise((resolve) => {
        resolveProcess = resolve;
      }),
    );
    mockReplyToTelegram.mockResolvedValue(true);

    const responsePromise = POST(telegramRequest(update));
    await vi.advanceTimersByTimeAsync(3600);

    expect(mockReplyToTelegram).toHaveBeenCalledTimes(0);

    resolveProcess({ outcome: 'replied', update_id: 9004, chat_id: 444 });
    const res = await responsePromise;
    expect(res.status).toBe(200);
  });

  it('does not send slow acknowledgement when processing finishes quickly', async () => {
    vi.useFakeTimers();
    const update = tgTextUpdate({ chat_id: 555, update_id: 9005, message_id: 46, text: 'Hi there' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9005, chat_id: 555 });
    mockReplyToTelegram.mockResolvedValue(true);

    const res = await POST(telegramRequest(update));
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(3600);
    expect(mockReplyToTelegram).toHaveBeenCalledTimes(0);
  });

  it('does not send a separate acknowledgement for urgent access updates', async () => {
    vi.useFakeTimers();
    const update = tgTextUpdate({
      chat_id: 556,
      update_id: 9006,
      message_id: 47,
      text: 'не могу попасть, код не работает',
    });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9006, chat_id: 556 });
    mockReplyToTelegram.mockResolvedValue(true);

    const res = await POST(telegramRequest(update));
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(3600);
    expect(mockProcessUpdate).toHaveBeenCalledTimes(1);
    expect(mockReplyToTelegram).toHaveBeenCalledTimes(0);
  });
});
