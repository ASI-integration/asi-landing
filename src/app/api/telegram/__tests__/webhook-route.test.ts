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

const mockReplyToTelegram = vi.fn();
const mockSendTelegramChatAction = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
  sendTelegramChatAction: (...args: unknown[]) => mockSendTelegramChatAction(...args),
}));

import { POST } from '../webhook/route';

function telegramRequest(body: unknown): Request {
  return new Request('https://example.test/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Telegram webhook route', () => {
  beforeEach(() => {
    mockProcessUpdate.mockReset();
    mockProcessTelegramVoiceUpdate.mockReset();
    mockReplyToTelegram.mockReset();
    mockSendTelegramChatAction.mockReset();
    mockSendTelegramChatAction.mockResolvedValue(true);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
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
    expect(mockSendTelegramChatAction).toHaveBeenCalledWith(
      111,
      'typing',
      expect.objectContaining({ handler: 'telegram_webhook:voice', update_id: 9001 }),
    );
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

  it('continues routing text Telegram messages through processUpdate', async () => {
    const update = tgTextUpdate({ chat_id: 333, update_id: 9003, message_id: 44, text: '/start' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9003, chat_id: 333 });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledTimes(0);
    expect(mockSendTelegramChatAction).toHaveBeenCalledWith(
      333,
      'typing',
      expect.objectContaining({ handler: 'telegram_webhook:text', update_id: 9003 }),
    );
  });

  it('routes callback_query without top-level message through processUpdate', async () => {
    const update = {
      update_id: 9010,
      callback_query: {
        id: 'cb-webhook-1',
        from: { id: 777, language_code: 'ru' },
        data: 'identity:guest',
        message: {
          message_id: 55,
          chat: { id: 777, type: 'private' },
          text: 'clarify',
        },
      },
    };
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9010, chat_id: 777 });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledTimes(0);
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
