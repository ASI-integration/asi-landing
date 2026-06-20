import type { InboundMessageEnvelope, TelegramUpdate } from './types';
import { auditDecision, auditDuplicate, auditError } from './audit';
import { checkAndMarkKey } from './idempotency';
import { processMessage } from './orchestrator';
import { sha256Base64Url } from './reliability';
import { transcribeVoiceMessageDetailed } from './voice-transcription';
import { ProcessOutcome } from './types';
import { replyToTelegram } from '../telegram';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function sttFailText(lang?: string): string {
  return 'Не удалось разобрать голосовое сообщение. Напишите, пожалуйста, текстом или отправьте голосовое ещё раз.';
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
      category?: string;
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
  const telegramUserId = message.from?.id;
  const duration = typeof media?.duration === 'number' ? media.duration : undefined;

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

  const transcriptionResult = await transcribeVoiceMessageDetailed(fileId, media?.mime_type, {
    updateId,
  });
  const transcript = transcriptionResult.ok ? transcriptionResult.text.trim() : null;

  if (!transcript) {
    const sttFailure = transcriptionResult.ok ? null : transcriptionResult;
    const detail = JSON.stringify({
      event: 'telegram_voice_stt_failed',
      original_message_type: kind,
      stt_success: false,
      fallback_reason: sttFailure?.reason ?? 'stt_failed',
      duration: duration ?? null,
      mime_type: media?.mime_type ?? sttFailure?.mimeType ?? null,
      extension: sttFailure?.extension ?? null,
      download_success: Boolean(sttFailure?.downloadBytes),
      download_bytes: sttFailure?.downloadBytes ?? null,
      stt_provider: sttFailure?.provider ?? null,
      stt_failure_code: sttFailure?.stt?.code ?? voiceFailureCode(sttFailure?.reason),
      stt_error_kind: sttFailure?.stt?.kind ?? null,
      stt_error_status: sttFailure?.stt?.status ?? null,
      stt_error_message: sttFailure?.stt?.message ?? sttFailure?.telegram?.message ?? null,
      telegram_chat_id: chatId,
      telegram_user_id: telegramUserId ?? null,
      telegram_message_id: messageId,
      telegram_file_id: fileId,
    });
    console.warn('[tg:voice] stt.failed', {
      update_id: updateId,
      chat_id: chatId,
      message_id: messageId,
      kind,
      file_id: fileId,
      duration: duration ?? null,
      mime_type: media?.mime_type ?? sttFailure?.mimeType ?? null,
      extension: sttFailure?.extension ?? null,
      download_success: Boolean(sttFailure?.downloadBytes),
      provider: sttFailure?.provider ?? null,
      failure_code: sttFailure?.stt?.code ?? voiceFailureCode(sttFailure?.reason),
      error_kind: sttFailure?.stt?.kind ?? null,
      error_status: sttFailure?.stt?.status ?? null,
      error_message: sttFailure?.stt?.message ?? sttFailure?.telegram?.message ?? null,
      fallback_reason: sttFailure?.reason ?? 'stt_failed',
    });
    auditError({ chat_id: chatId, update_id: updateId, detail });
    return sendVoiceFallback({ updateId, chatId, messageId, lang, reason: 'stt_failed' });
  }

  try {
    const audioRef = `telegram:${kind}:${messageId}:file:${fileId}`;
    const metadata: InboundMessageEnvelope['metadata'] = {
      transport: 'telegram_voice',
      source: kind,
      original_message_type: kind,
      originalMessageType: kind,
      sttStatus: 'success',
      sttSuccess: true,
      sttProvider: transcriptionResult.provider,
      sttUsedFallback: transcriptionResult.usedFallback,
      transcription: transcript,
      transcriptText: transcript,
      duration: duration ?? null,
      mime_type: transcriptionResult.mimeType,
      extension: transcriptionResult.extension,
      download_bytes: transcriptionResult.downloadBytes,
      providerMessageId: String(messageId),
      externalMessageId: String(messageId),
      telegram_user_language_code: lang,
      telegram_chat_id: chatId,
      telegram_user_id: telegramUserId ?? null,
      telegram_message_id: messageId,
      telegram_file_id: fileId,
      voice: {
        source: 'voice',
        voiceChannel: 'telegram_voice',
        originalMessageType: kind,
        original_message_type: kind,
        sttStatus: 'success',
        sttSuccess: true,
        sttProvider: transcriptionResult.provider,
        sttUsedFallback: transcriptionResult.usedFallback,
        transcription: transcript,
        transcriptText: transcript,
        duration: duration ?? null,
        mimeType: transcriptionResult.mimeType,
        extension: transcriptionResult.extension,
        downloadBytes: transcriptionResult.downloadBytes,
        audioRef,
        providerMessageId: String(messageId),
        providerMediaId: fileId,
        language: lang,
        telegramChatId: chatId,
        telegramUserId: telegramUserId ?? null,
      },
    };

    auditDecision({
      type: 'reply',
      chat_id: chatId,
      update_id: updateId,
      detail: JSON.stringify({
        event: 'telegram_voice_transcript_ready',
        original_message_type: kind,
        stt_success: true,
        transcript_text: transcript.slice(0, 500),
        telegram_chat_id: chatId,
        telegram_user_id: telegramUserId ?? null,
        telegram_message_id: messageId,
        telegram_file_id: fileId,
      }),
    });

    const envelope: InboundMessageEnvelope = {
      channel: 'telegram',
      externalUserId: String(telegramUserId ?? chatId),
      chatId: String(chatId),
      messageText: transcript,
      receivedAt: new Date(),
      update_id: updateId,
      metadata,
    };

    const handled = await processMessage(envelope);

    console.info('[tg:voice] brain.done', {
      update_id: updateId,
      chat_id: chatId,
      message_id: messageId,
      outcome: handled.outcome,
      escalated: Boolean(handled.escalation),
      category: handled.category ?? null,
      reply_len: String(handled.reply ?? '').length,
    });

    if (handled.outcome === ProcessOutcome.Error) {
      auditError({
        chat_id: chatId,
        update_id: updateId,
        detail: JSON.stringify({
          event: 'telegram_voice_processing_failed',
          original_message_type: kind,
          stt_success: true,
          telegram_chat_id: chatId,
          telegram_user_id: telegramUserId ?? null,
          telegram_message_id: messageId,
        }),
      });
      return sendVoiceFallback({ updateId, chatId, messageId, lang, reason: 'processing_failed' });
    }

    return {
      outcome: 'voice_transcript_processed',
      update_id: updateId,
      chat_id: chatId,
      message_id: messageId,
      kind,
      transcript_chars: transcript.length,
      brain_outcome: handled.outcome,
      category: handled.category,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[tg:voice] processing.threw', { update_id: updateId, chat_id: chatId, message_id: messageId, detail });
    auditError({
      chat_id: chatId,
      update_id: updateId,
      detail: JSON.stringify({
        event: 'telegram_voice_processing_threw',
        original_message_type: kind,
        stt_success: true,
        telegram_chat_id: chatId,
        telegram_user_id: telegramUserId ?? null,
        telegram_message_id: messageId,
        error: detail,
      }),
    });
    return sendVoiceFallback({ updateId, chatId, messageId, lang, reason: 'processing_failed' });
  }
}

function voiceFailureCode(reason?: string): string {
  if (reason === 'missing_telegram_bot_token' || reason === 'transcription_disabled') return 'missing_env';
  if (reason === 'get_file_failed' || reason === 'download_failed') return 'telegram_download_failed';
  return 'stt_provider_error';
}

