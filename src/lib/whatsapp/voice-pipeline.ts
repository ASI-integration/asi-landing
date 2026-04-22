import { checkAndMarkKey } from '@/lib/communication/idempotency';
import type { VoiceInput } from '@/lib/communication/voice/types';
import { handleVoiceTranscript } from '@/lib/communication/voice/orchestrator';
import type { WhatsAppWebhook } from './types';
import { extractInboundAudioMessage } from './webhook';
import type { WhatsAppMediaMeta, WhatsAppSttResult } from './types';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.WHATSAPP_DEBUG === '1';
}

export type WhatsAppVoicePipelineDeps = {
  fetchMediaMeta: (mediaId: string) => Promise<WhatsAppMediaMeta | null>;
  downloadMediaBytes: (meta: WhatsAppMediaMeta) => Promise<ArrayBuffer | null>;
  transcribe: (params: { audioBuffer: ArrayBuffer; mimeType?: string }) => Promise<WhatsAppSttResult | null>;
  handleTranscript?: (input: VoiceInput) => Promise<unknown>;
};

export async function processWhatsAppVoiceWebhook(
  webhook: WhatsAppWebhook,
  deps: WhatsAppVoicePipelineDeps,
): Promise<
  | { ok: true; ignored?: string; duplicate?: boolean }
  | { ok: false; ignored?: string; error: string }
> {
  const audioMsg = extractInboundAudioMessage(webhook);
  if (!audioMsg) return { ok: true, ignored: 'no_audio_message' };

  const { waId, messageId, mediaId, mimeType, phoneNumberId, displayPhoneNumber } = audioMsg;

  // Provider redeliveries happen; prevent duplicate media fetch + STT early.
  const dedupeKey = `whatsapp_voice:inbound:${waId}:${messageId}`;
  if (checkAndMarkKey({ scope: 'action', key: dedupeKey, meta: { messageId, mediaId } })) {
    if (debugEnabled()) console.info('[wa:voice] duplicate.prevented', { message_id: messageId, wa_id: waId });
    return { ok: true, duplicate: true };
  }

  console.info('[wa:voice] webhook.recv', {
    message_id: messageId,
    wa_id: waId,
    media_id: mediaId,
    mime_type: mimeType ?? null,
    phone_number_id: phoneNumberId ?? null,
    display_phone: displayPhoneNumber ?? null,
  });

  const meta = await deps.fetchMediaMeta(mediaId);
  if (!meta) {
    console.error('[wa:voice] media.meta.failed', { message_id: messageId, media_id: mediaId });
    return { ok: false, error: 'media_meta_failed' };
  }
  console.info('[wa:voice] media.meta.ok', { message_id: messageId, bytes: meta.file_size ?? null, mime: meta.mime_type ?? null });

  const audioBuffer = await deps.downloadMediaBytes(meta);
  if (!audioBuffer) {
    console.error('[wa:voice] media.download.failed', { message_id: messageId, media_id: mediaId });
    return { ok: false, error: 'media_download_failed' };
  }

  const stt = await deps.transcribe({ audioBuffer, mimeType: mimeType ?? meta.mime_type });
  if (!stt?.transcript?.trim()) {
    console.error('[wa:voice] stt.failed', { message_id: messageId, media_id: mediaId });
    return { ok: false, error: 'stt_failed' };
  }
  console.info('[wa:voice] stt.ok', { message_id: messageId, chars: stt.transcript.length });

  const input: VoiceInput = {
    channel: 'whatsapp_voice',
    actorId: waId,
    transcript: stt.transcript.trim(),
    transcriptConfidence: stt.confidence,
    audioRef: `whatsapp:message:${messageId}:media:${mediaId}`,
    language: stt.language,
    providerMessageId: messageId,
    externalMessageId: messageId,
    providerMediaId: mediaId,
  };

  const result = deps.handleTranscript ? await deps.handleTranscript(input) : await handleVoiceTranscript(input);
  if (!deps.handleTranscript) {
    const r = result as Awaited<ReturnType<typeof handleVoiceTranscript>>;
    console.info('[wa:voice] brain.done', {
      message_id: messageId,
      outcome: r.brain.outcome,
      escalated: Boolean(r.brain.escalation),
      reply_len: String(r.brain.reply ?? '').length,
    });
  }

  return { ok: true };
}

