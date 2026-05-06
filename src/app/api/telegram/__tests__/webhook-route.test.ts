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
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
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

  it('continues routing text Telegram messages through processUpdate', async () => {
    const update = tgTextUpdate({ chat_id: 333, update_id: 9003, message_id: 44, text: '/start' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9003, chat_id: 333 });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledTimes(0);
  });
});
