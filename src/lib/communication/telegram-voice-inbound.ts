import type { TelegramUpdate } from './types';
import { checkAndMarkKey } from './idempotency';
import { sha256Base64Url } from './reliability';
import { transcribeVoiceMessage } from './voice-transcription';
import { handleVoiceTranscript } from './voice/orchestrator';
import { createOrUpdateEscalationReview } from './operator-review';
import { replyToTelegram } from '../telegram';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function holdingText(lang?: string): string {
  return lang === 'ru'
    ? 'Спасибо! Я получил(а) голосовое. Сейчас передам это оператору и вернусь с ответом.'
    : 'Thanks — I got your voice message. I’m passing this to a human to review and will get back to you shortly.';
}

export type TelegramVoiceInboundResult =
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'duplicate'; key: string }
  | { outcome: 'transcribed'; transcript: string; update_id: number; chat_id: number; message_id: number }
  | { outcome: 'stt_failed_escalated'; update_id: number; chat_id: number; message_id: number };

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

  console.info('[tg:voice] inbound', {
    update_id: updateId,
    chat_id: chatId,
    message_id: messageId,
    kind: voice ? 'voice' : 'audio',
    file_id: fileId,
    duration: voice?.duration ?? audio?.duration ?? null,
    file_size: voice?.file_size ?? audio?.file_size ?? null,
  });

  const transcript = await transcribeVoiceMessage(fileId, voice?.mime_type ?? audio?.mime_type, { updateId });
  if (!transcript) {
    console.warn('[tg:voice] stt.fail', { update_id: updateId, chat_id: chatId, message_id: messageId, file_id: fileId });

    // Safe fail: create an operator review item with rich provider metadata and a holding reply.
    // This does not bypass the operator review system; it creates the same review item the
    // decision layer would create on escalation.
    const sessionId = `tg_voice:${chatId}`; // stable enough for review grouping when STT fails pre-session
    createOrUpdateEscalationReview({
      sessionId,
      channel: 'telegram_voice',
      targetId: String(chatId),
      actorId: String(chatId),
      escalationReason: 'VOICE_STT_FAILED',
      confidence: 0,
      source: {
        source: 'voice',
        voiceChannel: 'telegram_voice',
        voiceSessionId: '',
        voiceTurnId: '',
        transcript: '',
        providerMessageId: String(messageId),
        providerMediaId: fileId,
        providerUpdateId: updateId,
        duration: voice?.duration ?? audio?.duration ?? undefined,
        mimeType: voice?.mime_type ?? audio?.mime_type ?? undefined,
        fileSize: voice?.file_size ?? audio?.file_size ?? undefined,
      },
      detail: `telegram_voice_stt_failed update_id=${updateId} message_id=${messageId} file_id=${fileId}`,
    });

    const hold = holdingText(lang);
    const outboundKey = sha256Base64Url(['tg_voice_hold', String(chatId), String(updateId), String(messageId), hold].join('|'));
    if (!checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id: updateId, chat_id: chatId } })) {
      await replyToTelegram(chatId, hold);
      console.info('[tg:voice] holding.sent', { update_id: updateId, chat_id: chatId });
    } else if (debugEnabled()) {
      console.info('[tg:voice] holding.duplicate_prevented', { update_id: updateId, chat_id: chatId });
    }

    return { outcome: 'stt_failed_escalated', update_id: updateId, chat_id: chatId, message_id: messageId };
  }

  console.info('[tg:voice] stt.ok', { update_id: updateId, chat_id: chatId, message_id: messageId, chars: transcript.length });

  await handleVoiceTranscript({
    channel: 'telegram_voice',
    actorId: String(chatId),
    transcript,
    providerUpdateId: updateId,
    providerMessageId: String(messageId),
    externalMessageId: String(messageId),
    providerMediaId: fileId,
    audioRef: fileId,
    language: lang,
  });

  return { outcome: 'transcribed', transcript, update_id: updateId, chat_id: chatId, message_id: messageId };
}

