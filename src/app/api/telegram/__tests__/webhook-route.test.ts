import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tgAudioUpdate, tgTextUpdate, tgVoiceUpdate } from '@/lib/communication/dev/telegram-fixtures';

const mockProcessUpdate = vi.fn();
vi.mock('@/lib/communication/orchestrator', () => ({
  processUpdate: (...args: unknown[]) => mockProcessUpdate(...args),
}));

const mockClaimTelegramInboundReceipt = vi.fn();
const mockCompleteTelegramInboundReceipt = vi.fn();
const mockFailTelegramInboundReceipt = vi.fn();
vi.mock('@/lib/communication/telegram-inbound-receipts', () => ({
  claimTelegramInboundReceipt: (...args: unknown[]) => mockClaimTelegramInboundReceipt(...args),
  completeTelegramInboundReceipt: (...args: unknown[]) => mockCompleteTelegramInboundReceipt(...args),
  failTelegramInboundReceipt: (...args: unknown[]) => mockFailTelegramInboundReceipt(...args),
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

const WEBHOOK_SECRET = 'test-webhook-secret';

function telegramRequest(body: unknown, secretToken: string | null = WEBHOOK_SECRET): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secretToken !== null) {
    headers.set('x-telegram-bot-api-secret-token', secretToken);
  }

  return new Request('https://example.test/api/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('Telegram webhook route', () => {
  beforeEach(() => {
    mockProcessUpdate.mockReset();
    mockProcessTelegramVoiceUpdate.mockReset();
    mockReplyToTelegram.mockReset();
    mockSendTelegramChatAction.mockReset();
    mockClaimTelegramInboundReceipt.mockReset();
    mockCompleteTelegramInboundReceipt.mockReset();
    mockFailTelegramInboundReceipt.mockReset();
    mockSendTelegramChatAction.mockResolvedValue(true);
    mockClaimTelegramInboundReceipt.mockImplementation(async (update) => ({
      action: 'process',
      receiptId: `receipt-${update.update_id}`,
      claimToken: `claim-${update.update_id}`,
      retryCount: 0,
      scope: { accountId: null, propertyId: null },
      update,
    }));
    mockCompleteTelegramInboundReceipt.mockResolvedValue(undefined);
    mockFailTelegramInboundReceipt.mockResolvedValue(undefined);
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    vi.useRealTimers();
  });

  it('returns 503 without processing when the configured secret is missing', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const res = await POST(telegramRequest(tgTextUpdate({ chat_id: 100, text: 'blocked' })));

    expect(res.status).toBe(503);
    expect(mockProcessUpdate).not.toHaveBeenCalled();
    expect(mockProcessTelegramVoiceUpdate).not.toHaveBeenCalled();
    expect(mockSendTelegramChatAction).not.toHaveBeenCalled();
  });

  it('returns 503 without processing when the configured secret is blank', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = '   ';

    const res = await POST(telegramRequest(tgTextUpdate({ chat_id: 100, text: 'blocked' })));

    expect(res.status).toBe(503);
    expect(mockProcessUpdate).not.toHaveBeenCalled();
    expect(mockProcessTelegramVoiceUpdate).not.toHaveBeenCalled();
    expect(mockSendTelegramChatAction).not.toHaveBeenCalled();
  });

  it('returns 403 without processing when request authentication is missing', async () => {
    const res = await POST(telegramRequest(tgTextUpdate({ chat_id: 100, text: 'blocked' }), null));

    expect(res.status).toBe(403);
    expect(mockProcessUpdate).not.toHaveBeenCalled();
    expect(mockProcessTelegramVoiceUpdate).not.toHaveBeenCalled();
    expect(mockSendTelegramChatAction).not.toHaveBeenCalled();
  });

  it('returns 403 without processing when request authentication is incorrect', async () => {
    const res = await POST(
      telegramRequest(tgTextUpdate({ chat_id: 100, text: 'blocked' }), 'wrong-secret'),
    );

    expect(res.status).toBe(403);
    expect(mockProcessUpdate).not.toHaveBeenCalled();
    expect(mockProcessTelegramVoiceUpdate).not.toHaveBeenCalled();
    expect(mockSendTelegramChatAction).not.toHaveBeenCalled();
  });

  it('accepts and processes a request with correct authentication', async () => {
    const update = tgTextUpdate({ chat_id: 101, update_id: 9000, message_id: 41, text: 'Hello' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9000, chat_id: 101 });

    const res = await POST(telegramRequest(update));

    expect(res.status).toBe(200);
    expect(mockProcessUpdate).toHaveBeenCalledWith(update, { durableReceiptOwned: true });
    expect(mockCompleteTelegramInboundReceipt).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'replied' }));
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
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledWith(update, { durableReceiptOwned: true });
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
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledWith(update, { durableReceiptOwned: true });
    expect(mockProcessUpdate).toHaveBeenCalledTimes(0);
  });

  it('continues routing text Telegram messages through processUpdate', async () => {
    const update = tgTextUpdate({ chat_id: 333, update_id: 9003, message_id: 44, text: '/start' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9003, chat_id: 333 });

    const res = await POST(telegramRequest(update));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mockProcessUpdate).toHaveBeenCalledWith(update, { durableReceiptOwned: true });
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
    expect(mockProcessUpdate).toHaveBeenCalledWith(update, { durableReceiptOwned: true });
    expect(mockProcessTelegramVoiceUpdate).toHaveBeenCalledTimes(0);
  });

  it('processes a duplicate delivery only once after the durable receipt is complete', async () => {
    const update = tgTextUpdate({ chat_id: 778, update_id: 9011, message_id: 56, text: 'Wi-Fi?' });
    const ownedClaim = {
      action: 'process',
      receiptId: 'receipt-9011',
      claimToken: 'claim-9011',
      retryCount: 0,
      scope: { accountId: 'account-a', propertyId: 'property-a' },
      update,
    };
    mockClaimTelegramInboundReceipt
      .mockResolvedValueOnce(ownedClaim)
      .mockResolvedValueOnce({ ...ownedClaim, action: 'duplicate' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'replied', update_id: 9011, chat_id: 778 });

    const first = await POST(telegramRequest(update));
    const duplicate = await POST(telegramRequest(update));

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ ok: true, duplicate: true });
    expect(mockProcessUpdate).toHaveBeenCalledTimes(1);
    expect(mockCompleteTelegramInboundReceipt).toHaveBeenCalledTimes(1);
    expect(mockFailTelegramInboundReceipt).not.toHaveBeenCalled();
  });

  it('keeps a thrown downstream failure retryable and operator-visible', async () => {
    const update = tgTextUpdate({ chat_id: 779, update_id: 9012, message_id: 57, text: 'Не могу войти' });
    mockProcessUpdate.mockRejectedValue(new Error('downstream unavailable'));

    const res = await POST(telegramRequest(update));

    expect(res.status).toBe(503);
    expect(mockFailTelegramInboundReceipt).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'processing_threw',
      claim: expect.objectContaining({ receiptId: 'receipt-9012' }),
    }));
    expect(mockCompleteTelegramInboundReceipt).not.toHaveBeenCalled();
  });

  it('does not treat an explicit ProcessOutcome.Error as successful processing', async () => {
    const update = tgTextUpdate({ chat_id: 780, update_id: 9013, message_id: 58, text: 'Нужна помощь' });
    mockProcessUpdate.mockResolvedValue({ outcome: 'error', update_id: 9013, chat_id: 780 });

    const res = await POST(telegramRequest(update));

    expect(res.status).toBe(503);
    expect(mockFailTelegramInboundReceipt).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'process_outcome_error',
    }));
    expect(mockCompleteTelegramInboundReceipt).not.toHaveBeenCalled();
  });

  it('does not process or acknowledge when durable receipt persistence fails', async () => {
    const update = tgTextUpdate({ chat_id: 781, update_id: 9014, message_id: 59, text: 'Hello' });
    mockClaimTelegramInboundReceipt.mockRejectedValue(new Error('database unavailable'));

    const res = await POST(telegramRequest(update));

    expect(res.status).toBe(503);
    expect(mockProcessUpdate).not.toHaveBeenCalled();
    expect(mockProcessTelegramVoiceUpdate).not.toHaveBeenCalled();
    expect(mockSendTelegramChatAction).not.toHaveBeenCalled();
  });

  it('retries the same failed durable receipt and completes it without a second receipt', async () => {
    const update = tgTextUpdate({ chat_id: 782, update_id: 9015, message_id: 60, text: 'Где ключи?' });
    mockClaimTelegramInboundReceipt
      .mockResolvedValueOnce({
        action: 'process', receiptId: 'receipt-9015', claimToken: 'claim-first', retryCount: 0,
        scope: { accountId: 'account-a', propertyId: 'property-a' }, update,
      })
      .mockResolvedValueOnce({
        action: 'process', receiptId: 'receipt-9015', claimToken: 'claim-retry', retryCount: 1,
        scope: { accountId: 'account-a', propertyId: 'property-a' }, update,
      });
    mockProcessUpdate
      .mockResolvedValueOnce({ outcome: 'error', update_id: 9015, chat_id: 782 })
      .mockResolvedValueOnce({ outcome: 'replied', update_id: 9015, chat_id: 782 });

    const failed = await POST(telegramRequest(update));
    const retried = await POST(telegramRequest(update));

    expect(failed.status).toBe(503);
    expect(retried.status).toBe(200);
    expect(mockFailTelegramInboundReceipt).toHaveBeenCalledTimes(1);
    expect(mockCompleteTelegramInboundReceipt).toHaveBeenCalledWith(expect.objectContaining({
      claim: expect.objectContaining({ receiptId: 'receipt-9015', retryCount: 1 }),
      outcome: 'replied',
    }));
  });

  it('fails closed when the durable receipt rejects a mismatched tenant/event scope', async () => {
    const update = tgTextUpdate({ chat_id: 783, update_id: 9016, message_id: 61, text: 'Replay' });
    mockClaimTelegramInboundReceipt.mockRejectedValue(
      new Error('telegram_inbound_receipt_claim_failed:telegram_inbound_receipt_identity_mismatch'),
    );

    const res = await POST(telegramRequest(update));

    expect(res.status).toBe(503);
    expect(mockProcessUpdate).not.toHaveBeenCalled();
    expect(mockCompleteTelegramInboundReceipt).not.toHaveBeenCalled();
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
