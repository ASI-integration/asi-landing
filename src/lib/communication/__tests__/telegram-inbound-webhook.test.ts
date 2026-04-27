/**
 * Inbound Telegram webhook + session backbone tests.
 *
 * Coverage:
 * 1. Valid text message → normalized shape, session created, message stored.
 * 2. Duplicate update_id → idempotency key already seen, Duplicate outcome.
 * 3. Non-text message (voice/photo) → messageType != 'text', text is empty, ok response.
 * 4. Malformed payload → normalizeTelegramUpdate returns null, no crash.
 * 5. Missing delivery config → replyToTelegram returns false safely.
 * 6. Session state persists across two messages in same chat.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  normalizeTelegramUpdate,
  buildTelegramInboundKey,
} from '../telegram-inbound';
import type { NormalizedTelegramInbound } from '../telegram-inbound';
import { checkAndMarkKey, _resetForTesting } from '../idempotency';
import {
  __resetConversationSessionEngineForTests,
  getOrCreateConversationSession,
  appendSessionMessage,
} from '../conversation-session-engine';
import type { InboundMessageEnvelope } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTextUpdate(
  text: string,
  opts: {
    updateId?: number;
    chatId?: number;
    fromId?: number;
    username?: string;
    langCode?: string;
    messageId?: number;
  } = {},
) {
  return {
    update_id: opts.updateId ?? 1,
    message: {
      message_id: opts.messageId ?? 101,
      chat: { id: opts.chatId ?? 42 },
      from: {
        id: opts.fromId ?? 999,
        username: opts.username,
        language_code: opts.langCode ?? 'ru',
      },
      text,
    },
  };
}

function envelopeFromNorm(norm: NormalizedTelegramInbound): InboundMessageEnvelope {
  return {
    channel: 'telegram',
    externalUserId: norm.externalChatId, // pipeline keys by chatId
    chatId: norm.externalChatId,
    messageText: norm.text,
    receivedAt: norm.receivedAt,
    update_id: norm.updateId,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Telegram inbound webhook — normalization', () => {
  it('test 1: valid text message normalizes into the canonical shape', () => {
    const raw = makeTextUpdate('Привет, когда можно заехать?', {
      updateId: 5001,
      chatId: 100,
      fromId: 200,
      username: 'ivan42',
      langCode: 'ru',
      messageId: 301,
    });

    const norm = normalizeTelegramUpdate(raw);
    expect(norm).not.toBeNull();
    expect(norm!.provider).toBe('telegram');
    expect(norm!.updateId).toBe(5001);
    expect(norm!.externalMessageId).toBe('301');
    expect(norm!.externalChatId).toBe('100');
    expect(norm!.externalUserId).toBe('200');
    expect(norm!.externalUsername).toBe('ivan42');
    expect(norm!.languageCode).toBe('ru');
    expect(norm!.text).toBe('Привет, когда можно заехать?');
    expect(norm!.messageType).toBe('text');
    expect(norm!.receivedAt).toBeInstanceOf(Date);
  });

  it('test 3: voice message normalizes with messageType=voice and empty text', () => {
    const raw = {
      update_id: 5002,
      message: {
        message_id: 302,
        chat: { id: 42 },
        from: { id: 888, language_code: 'ru' },
        voice: { file_id: 'voice_abc', file_unique_id: 'u1', duration: 10 },
      },
    };

    const norm = normalizeTelegramUpdate(raw);
    expect(norm).not.toBeNull();
    expect(norm!.messageType).toBe('voice');
    expect(norm!.text).toBe('');
  });

  it('test 3b: photo message normalizes with messageType=photo', () => {
    const raw = {
      update_id: 5003,
      message: {
        message_id: 303,
        chat: { id: 42 },
        from: { id: 888 },
        photo: [{ file_id: 'f1', file_unique_id: 'u1', width: 100, height: 100 }],
        caption: 'See attached',
      },
    };

    const norm = normalizeTelegramUpdate(raw);
    expect(norm).not.toBeNull();
    expect(norm!.messageType).toBe('photo');
    // caption is preserved as text for non-photo primary text
    expect(norm!.text).toBe('See attached');
  });

  it('test 4: null payload returns null without throwing', () => {
    expect(normalizeTelegramUpdate(null)).toBeNull();
    expect(normalizeTelegramUpdate(undefined)).toBeNull();
    expect(normalizeTelegramUpdate({})).toBeNull();
    expect(normalizeTelegramUpdate({ update_id: 'bad' })).toBeNull();
    expect(normalizeTelegramUpdate({ update_id: 1, message: null })).toBeNull();
  });

  it('test 4b: update with no message field returns null', () => {
    const raw = { update_id: 99 }; // no message — e.g. channel_post, callback_query
    expect(normalizeTelegramUpdate(raw)).toBeNull();
  });

  it('test 4c: missing chat.id returns null without throwing', () => {
    const raw = {
      update_id: 100,
      message: { message_id: 1, chat: {} }, // no id
    };
    expect(normalizeTelegramUpdate(raw)).toBeNull();
  });

  it('from.id falls back to chat.id when from is absent', () => {
    const raw = {
      update_id: 5010,
      message: {
        message_id: 310,
        chat: { id: 77 },
        text: 'hello',
        // no `from` field
      },
    };

    const norm = normalizeTelegramUpdate(raw);
    expect(norm).not.toBeNull();
    expect(norm!.externalUserId).toBe('77'); // falls back to chat.id
    expect(norm!.externalChatId).toBe('77');
    expect(norm!.externalUsername).toBeUndefined();
  });

  it('idempotency key is stable for same message_id', () => {
    const raw = makeTextUpdate('hello', { updateId: 1, chatId: 50, messageId: 200 });
    const norm1 = normalizeTelegramUpdate(raw)!;
    const norm2 = normalizeTelegramUpdate(raw)!;
    expect(buildTelegramInboundKey(norm1)).toBe(buildTelegramInboundKey(norm2));
    expect(buildTelegramInboundKey(norm1)).toBe('telegram:50:msg:200');
  });
});

describe('Telegram inbound webhook — idempotency', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('test 2: same update_id is idempotent — second checkAndMarkKey returns true', () => {
    const raw = makeTextUpdate('check-in at 3pm', { updateId: 7001, chatId: 42, messageId: 501 });
    const norm = normalizeTelegramUpdate(raw)!;
    const key = buildTelegramInboundKey(norm);

    const first = checkAndMarkKey({ scope: 'inbound', key });
    expect(first).toBe(false); // not seen before → process

    const second = checkAndMarkKey({ scope: 'inbound', key });
    expect(second).toBe(true); // seen → duplicate
  });

  it('different messages from same chat produce different keys', () => {
    const raw1 = makeTextUpdate('msg1', { updateId: 1, chatId: 42, messageId: 10 });
    const raw2 = makeTextUpdate('msg2', { updateId: 2, chatId: 42, messageId: 11 });

    const key1 = buildTelegramInboundKey(normalizeTelegramUpdate(raw1)!);
    const key2 = buildTelegramInboundKey(normalizeTelegramUpdate(raw2)!);

    expect(key1).not.toBe(key2);
    expect(checkAndMarkKey({ scope: 'inbound', key: key1 })).toBe(false);
    expect(checkAndMarkKey({ scope: 'inbound', key: key2 })).toBe(false);
  });
});

describe('Telegram inbound webhook — session backbone', () => {
  beforeEach(() => {
    __resetConversationSessionEngineForTests();
  });

  it('test 1: valid text message creates session and stores message in memory', () => {
    const raw = makeTextUpdate('Добрый день, хочу уточнить про заезд', {
      updateId: 8001,
      chatId: 200,
      fromId: 300,
      messageId: 601,
    });

    const norm = normalizeTelegramUpdate(raw)!;
    expect(norm).not.toBeNull();

    const envelope = envelopeFromNorm(norm);
    const { session: s0, created, key } = getOrCreateConversationSession({
      envelope,
      identity: undefined,
    });

    expect(created).toBe(true);
    expect(s0.sessionId).toBeTruthy();
    expect(s0.channel).toBe('telegram');
    expect(s0.state).toBe('active');
    expect(s0.memory.lastMessages).toHaveLength(0);

    const s1 = appendSessionMessage({
      key,
      session: s0,
      direction: 'inbound',
      content: norm.text,
    });

    expect(s1.memory.lastMessages).toHaveLength(1);
    expect(s1.memory.lastMessages[0]!.content).toBe('Добрый день, хочу уточнить про заезд');
  });

  it('test 6: session state persists across two messages in same chat', () => {
    const chatId = 500;

    // First message
    const raw1 = makeTextUpdate('first message', {
      updateId: 9001,
      chatId,
      fromId: 700,
      messageId: 901,
    });
    const norm1 = normalizeTelegramUpdate(raw1)!;
    const env1 = envelopeFromNorm(norm1);

    const { session: s0, created: created1, key } = getOrCreateConversationSession({
      envelope: env1,
      identity: undefined,
    });
    expect(created1).toBe(true);

    const s1 = appendSessionMessage({
      key,
      session: s0,
      direction: 'inbound',
      content: norm1.text,
    });
    expect(s1.memory.lastMessages).toHaveLength(1);

    // Second message — same chatId, different update/message IDs
    const raw2 = makeTextUpdate('second message', {
      updateId: 9002,
      chatId,
      fromId: 700,
      messageId: 902,
    });
    const norm2 = normalizeTelegramUpdate(raw2)!;
    const env2 = envelopeFromNorm(norm2);

    const { session: s2, created: created2 } = getOrCreateConversationSession({
      envelope: env2,
      identity: undefined,
    });
    // Same session — not newly created
    expect(created2).toBe(false);
    expect(s2.sessionId).toBe(s1.sessionId);

    // Append second message
    const s3 = appendSessionMessage({
      key,
      session: s2,
      direction: 'inbound',
      content: norm2.text,
    });
    expect(s3.memory.lastMessages).toHaveLength(2);
    expect(s3.memory.lastMessages[0]!.content).toBe('first message');
    expect(s3.memory.lastMessages[1]!.content).toBe('second message');
  });
});

describe('Telegram inbound webhook — delivery safety', () => {
  it('test 5: replyToTelegram returns false safely when TELEGRAM_BOT_TOKEN is absent', async () => {
    const { replyToTelegram } = await import('@/lib/telegram');

    // Ensure token is not set in this test context
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    let result: boolean;
    try {
      result = await replyToTelegram(12345, 'test message', { handler: 'test' });
    } finally {
      if (savedToken !== undefined) {
        process.env.TELEGRAM_BOT_TOKEN = savedToken;
      }
    }

    // Must return false without throwing
    expect(result).toBe(false);
  });
});
