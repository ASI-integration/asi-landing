import type { TelegramUpdate } from './types';
import { checkAndMarkKey } from './idempotency';
import { sha256Base64Url } from './reliability';
import { replyToTelegram } from '../telegram';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function sttFailText(lang?: string): string {
  return lang === 'ru'
    ? 'Не удалось распознать голосовое. Пришлите, пожалуйста, текстом.'
    : "I couldn't transcribe the voice message. Please send it as text.";
}

export type TelegramVoiceInboundResult =
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'duplicate'; key: string }
  | { outcome: 'voice_fallback_sent'; update_id: number; chat_id: number; message_id: number };

export async function processTelegramVoiceUpdate(update: TelegramUpdate): Promise<TelegramVoiceInboundResult> {
  const message = update.message ?? update.edited_message;
  if (!message) return { outcome: 'ignored', reason: 'no_message' };

  const voice = message.voice;
  const audio = message.audio;
  if (!voice && !audio) return { outcome: 'ignored', reason: 'not_voice' };

  const fileId = (voice?.file_id ?? audio?.file_id ?? '').trim();
  if (!fileId) return { outcome: 'ignored', reason: 'missing_file_id' };

  const updateId = update.update_id;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const lang = message.from?.language_code;

  const inboundKey = `tg_voice:${updateId}:${messageId}:${fileId}`;
  if (checkAndMarkKey({ scope: 'inbound', key: inboundKey, meta: { update_id: updateId, chat_id: chatId, message_id: messageId } })) {
    console.info('[tg:voice] duplicate.inbound', { update_id: updateId, chat_id: chatId, message_id: messageId });
    return { outcome: 'duplicate', key: inboundKey };
  }

  console.info('[tg:voice] inbound (de-scoped)', {
    update_id: updateId,
    chat_id: chatId,
    message_id: messageId,
    kind: voice ? 'voice' : 'audio',
    file_id: fileId,
    duration: voice?.duration ?? audio?.duration ?? null,
    file_size: voice?.file_size ?? audio?.file_size ?? null,
  });

  console.info('[tg:voice] fallback.only', { update_id: updateId, chat_id: chatId, message_id: messageId });
  const replyText = sttFailText(lang);
  const outboundKey = sha256Base64Url(['tg_voice_fallback', String(chatId), String(updateId), String(messageId), replyText].join('|'));
  if (!checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id: updateId, chat_id: chatId } })) {
    await replyToTelegram(chatId, replyText);
    console.info('[tg:voice] fallback.reply_sent', { update_id: updateId, chat_id: chatId });
  } else if (debugEnabled()) {
    console.info('[tg:voice] fallback.reply_duplicate_prevented', { update_id: updateId, chat_id: chatId });
  }

  return { outcome: 'voice_fallback_sent', update_id: updateId, chat_id: chatId, message_id: messageId };
}

