import type { TelegramUpdate } from './types';
import { auditDecision, auditDuplicate, auditError } from './audit';
import { checkAndMarkKey } from './idempotency';
import { sha256Base64Url } from './reliability';
import { transcribeVoiceMessage } from './voice-transcription';
import { handleVoiceTranscript } from './voice/orchestrator';
import { ProcessOutcome } from './types';
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
  | {
      outcome: 'voice_transcript_processed';
      update_id: number;
      chat_id: number;
      message_id: number;
      kind: 'voice' | 'audio';
      transcript_chars: number;
      brain_outcome: ProcessOutcome;
    }
  | {
      outcome: 'voice_fallback_sent';
      update_id: number;
      chat_id: number;
      message_id: number;
      reason: 'stt_failed' | 'processing_failed';
    };

async function sendVoiceFallback(params: {
  updateId: number;
  chatId: number;
  messageId: number;
  lang?: string;
  reason: 'stt_failed' | 'processing_failed';
}): Promise<Extract<TelegramVoiceInboundResult, { outcome: 'voice_fallback_sent' }>> {
  const replyText = sttFailText(params.lang);
  const outboundKey = sha256Base64Url(
    ['tg_voice_fallback', String(params.chatId), String(params.updateId), String(params.messageId), params.reason, replyText].join('|'),
  );

  if (!checkAndMarkKey({ scope: 'outbound', key: outboundKey, meta: { update_id: params.updateId, chat_id: params.chatId } })) {
    await replyToTelegram(params.chatId, replyText, {
      handler: `telegram_voice_${params.reason}`,
      update_id: params.updateId,
    });
    console.info('[tg:voice] fallback.reply_sent', {
      update_id: params.updateId,
      chat_id: params.chatId,
      reason: params.reason,
    });
    auditDecision({
      type: 'reply',
      chat_id: params.chatId,
      update_id: params.updateId,
      detail: `telegram_voice_fallback reason=${params.reason}`,
    });
  } else if (debugEnabled()) {
    console.info('[tg:voice] fallback.reply_duplicate_prevented', {
      update_id: params.updateId,
      chat_id: params.chatId,
      reason: params.reason,
    });
  }

  return {
    outcome: 'voice_fallback_sent',
    update_id: params.updateId,
    chat_id: params.chatId,
    message_id: params.messageId,
    reason: params.reason,
  };
}

export async function processTelegramVoiceUpdate(update: TelegramUpdate): Promise<TelegramVoiceInboundResult> {
  const message = update.message ?? update.edited_message;
  if (!message) return { outcome: 'ignored', reason: 'no_message' };

  const voice = message.voice;
  const audio = message.audio;
  if (!voice && !audio) return { outcome: 'ignored', reason: 'not_voice' };

  const media = voice ?? audio;
  const kind = voice ? 'voice' : 'audio';
  const fileId = (media?.file_id ?? '').trim();
  if (!fileId) return { outcome: 'ignored', reason: 'missing_file_id' };

  const updateId = update.update_id;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const lang = message.from?.language_code;

  const inboundKey = `tg_voice:${updateId}:${messageId}:${fileId}`;
  if (checkAndMarkKey({ scope: 'inbound', key: inboundKey, meta: { update_id: updateId, chat_id: chatId, message_id: messageId } })) {
    console.info('[tg:voice] duplicate.inbound', { update_id: updateId, chat_id: chatId, message_id: messageId });
    auditDuplicate({ chat_id: chatId, update_id: updateId });
    return { outcome: 'duplicate', key: inboundKey };
  }

  console.info('[tg:voice] inbound', {
    update_id: updateId,
    chat_id: chatId,
    message_id: messageId,
    kind,
    file_id: fileId,
    duration: media?.duration ?? null,
    file_size: media?.file_size ?? null,
  });

  const transcript = (
    await transcribeVoiceMessage(fileId, media?.mime_type, {
      updateId,
    })
  )?.trim();

  if (!transcript) {
    console.warn('[tg:voice] stt.failed', { update_id: updateId, chat_id: chatId, message_id: messageId, kind });
    auditError({ chat_id: chatId, update_id: updateId, detail: `telegram_voice_stt_failed kind=${kind}` });
    return sendVoiceFallback({ updateId, chatId, messageId, lang, reason: 'stt_failed' });
  }

  try {
    const handled = await handleVoiceTranscript({
      channel: 'telegram_voice',
      actorId: String(chatId),
      transcript,
      audioRef: `telegram:${kind}:${messageId}:file:${fileId}`,
      language: lang,
      providerUpdateId: updateId,
      providerMessageId: String(messageId),
      externalMessageId: String(messageId),
      providerMediaId: fileId,
    });

    console.info('[tg:voice] brain.done', {
      update_id: updateId,
      chat_id: chatId,
      message_id: messageId,
      outcome: handled.brain.outcome,
      escalated: Boolean(handled.brain.escalation),
      reply_len: String(handled.brain.reply ?? handled.output.text ?? '').length,
    });

    if (handled.brain.outcome === ProcessOutcome.Error) {
      auditError({ chat_id: chatId, update_id: updateId, detail: 'telegram_voice_processing_failed' });
      return sendVoiceFallback({ updateId, chatId, messageId, lang, reason: 'processing_failed' });
    }

    return {
      outcome: 'voice_transcript_processed',
      update_id: updateId,
      chat_id: chatId,
      message_id: messageId,
      kind,
      transcript_chars: transcript.length,
      brain_outcome: handled.brain.outcome,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[tg:voice] processing.threw', { update_id: updateId, chat_id: chatId, message_id: messageId, detail });
    auditError({ chat_id: chatId, update_id: updateId, detail: `telegram_voice_processing_threw ${detail}` });
    return sendVoiceFallback({ updateId, chatId, messageId, lang, reason: 'processing_failed' });
  }
}

