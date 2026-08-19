import { createHash } from 'node:crypto';
import { auditError } from './audit';
import { checkAndMarkKey } from './idempotency';
import { processMessage } from './orchestrator';
import {
  MaxAdapter,
  type MaxWebhookPayload,
  isAllowedMaxAudioUrl,
  maxAttachmentAudioUrl,
  maxWebhookAudioAttachment,
} from './channels/max';
import { sanitizeSttLogMessage, transcribeWithConfiguredStt } from './voice/stt';

const STT_FALLBACK_RU =
  'Не удалось разобрать голосовое сообщение. Напишите, пожалуйста, текстом или отправьте голосовое ещё раз.';

type MaxVoiceInboundResult =
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'duplicate'; key: string }
  | { outcome: 'voice_transcript_processed'; transcript_chars: number; brain_outcome: string }
  | { outcome: 'voice_fallback_sent'; reason: string };

function maxVoiceTimeoutMs(): number {
  const raw = Number.parseInt(String(process.env.MAX_VOICE_FETCH_TIMEOUT_MS ?? ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

function maxVoiceMaxBytes(): number {
  const raw = Number.parseInt(String(process.env.MAX_VOICE_MAX_BYTES ?? ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 1024 * 1024;
}

function messageFromPayload(payload: MaxWebhookPayload) {
  return payload.message ?? payload.object?.message ?? null;
}

function attachmentFingerprint(payload: MaxWebhookPayload, audioToken: string, audioUrl: string): string {
  const message = messageFromPayload(payload);
  const eventId = String(payload.event_id ?? payload.update_id ?? '').trim();
  const messageId = String(message?.body?.mid ?? message?.id ?? message?.message_id ?? '').trim();
  const opaque = createHash('sha256')
    .update(`${audioToken}|${audioUrl}`)
    .digest('hex')
    .slice(0, 20);
  return `max_voice_media:${eventId || messageId || 'unknown'}:${opaque}`;
}

function mimeFromUrl(url: string): { mimeType: string; extension: string } {
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    // URL is validated before this point.
  }
  if (pathname.endsWith('.wav')) return { mimeType: 'audio/wav', extension: '.wav' };
  if (pathname.endsWith('.m4a') || pathname.endsWith('.mp4')) return { mimeType: 'audio/mp4', extension: '.m4a' };
  if (pathname.endsWith('.ogg') || pathname.endsWith('.oga') || pathname.endsWith('.opus')) {
    return { mimeType: 'audio/ogg', extension: '.ogg' };
  }
  if (pathname.endsWith('.webm')) return { mimeType: 'audio/webm', extension: '.webm' };
  return { mimeType: 'audio/mpeg', extension: '.mp3' };
}

function normalizeMime(contentType: string | null, url: string): { mimeType: string; extension: string } {
  const type = String(contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === 'audio/wav' || type === 'audio/x-wav') return { mimeType: 'audio/wav', extension: '.wav' };
  if (type === 'audio/mp4' || type === 'audio/m4a') return { mimeType: 'audio/mp4', extension: '.m4a' };
  if (type === 'audio/ogg' || type === 'audio/opus') return { mimeType: 'audio/ogg', extension: '.ogg' };
  if (type === 'audio/webm') return { mimeType: 'audio/webm', extension: '.webm' };
  if (type === 'audio/mpeg' || type === 'audio/mp3') return { mimeType: 'audio/mpeg', extension: '.mp3' };
  return mimeFromUrl(url);
}

async function downloadMaxAudio(url: string): Promise<
  | { ok: true; audioBuffer: ArrayBuffer; bytes: number; mimeType: string; extension: string }
  | { ok: false; reason: string; status?: number }
> {
  if (!isAllowedMaxAudioUrl(url)) return { ok: false, reason: 'untrusted_media_url' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxVoiceTimeoutMs());
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) return { ok: false, reason: 'download_http', status: res.status };

    const advertisedBytes = Number.parseInt(String(res.headers.get('content-length') ?? ''), 10);
    if (Number.isFinite(advertisedBytes) && advertisedBytes > maxVoiceMaxBytes()) {
      return { ok: false, reason: 'download_too_large' };
    }

    const audioBuffer = await res.arrayBuffer();
    if (audioBuffer.byteLength === 0) return { ok: false, reason: 'download_empty' };
    if (audioBuffer.byteLength > maxVoiceMaxBytes()) return { ok: false, reason: 'download_too_large' };

    const media = normalizeMime(res.headers.get('content-type'), url);
    return {
      ok: true,
      audioBuffer,
      bytes: audioBuffer.byteLength,
      mimeType: media.mimeType,
      extension: media.extension,
    };
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error).name === 'AbortError' ? 'download_timeout' : 'download_network',
    };
  } finally {
    clearTimeout(timer);
  }
}

function payloadWithTranscript(payload: MaxWebhookPayload, transcript: string): MaxWebhookPayload {
  const message = messageFromPayload(payload);
  if (!message) return payload;
  const updatedMessage = {
    ...message,
    body: {
      ...(message.body ?? {}),
      text: transcript,
    },
  };
  if (payload.message) return { ...payload, message: updatedMessage };
  return {
    ...payload,
    object: {
      ...(payload.object ?? {}),
      message: updatedMessage,
    },
  };
}

async function maxEnvelopeForVoice(payload: MaxWebhookPayload, text: string) {
  const adapter = new MaxAdapter();
  return adapter.normalizeInbound(payloadWithTranscript(payload, text));
}

async function sendSttFallback(payload: MaxWebhookPayload): Promise<MaxVoiceInboundResult> {
  try {
    const envelope = await maxEnvelopeForVoice(payload, '[voice]');
    const target = String(envelope.chatId ?? envelope.externalUserId ?? '').trim();
    if (target) {
      await new MaxAdapter().sendMessage(target, STT_FALLBACK_RU, {
        chat_id: envelope.metadata?.chat_id,
        user_id: envelope.metadata?.user_id,
        max_chat_id: envelope.metadata?.chat_id,
        max_user_id: envelope.metadata?.user_id,
      });
    }
  } catch {
    // Best-effort text fallback only.
  }
  return { outcome: 'voice_fallback_sent', reason: 'stt_failed' };
}

export async function processMaxVoiceUpdate(payload: MaxWebhookPayload): Promise<MaxVoiceInboundResult> {
  const attachment = maxWebhookAudioAttachment(payload);
  if (!attachment) return { outcome: 'ignored', reason: 'no_audio_attachment' };

  const audioUrl = maxAttachmentAudioUrl(attachment);
  if (!audioUrl || !isAllowedMaxAudioUrl(audioUrl)) {
    console.warn('[max:voice] inbound.reject_media_url');
    return sendSttFallback(payload);
  }

  const audioToken = String(attachment.payload?.token ?? '').trim();
  const inboundKey = attachmentFingerprint(payload, audioToken, audioUrl);
  if (checkAndMarkKey({ scope: 'inbound', key: inboundKey })) {
    return { outcome: 'duplicate', key: inboundKey };
  }

  const downloaded = await downloadMaxAudio(audioUrl);
  if (!downloaded.ok) {
    console.warn('[max:voice] inbound.download_failed', {
      reason: downloaded.reason,
      status: downloaded.status ?? null,
    });
    return sendSttFallback(payload);
  }

  const baseEnvelope = await maxEnvelopeForVoice(payload, '[voice]');
  const stt = await transcribeWithConfiguredStt({
    audioBuffer: downloaded.audioBuffer,
    filename: `max_voice${downloaded.extension}`,
    mimeType: downloaded.mimeType,
    ctx: { updateId: baseEnvelope.update_id },
  });
  const transcript = stt.ok ? String(stt.text ?? '').trim() : '';
  if (!transcript) {
    console.warn('[max:voice] inbound.stt_failed', {
      provider: stt.provider,
      failure_code: stt.fail?.code ?? null,
      error_kind: stt.fail?.kind ?? null,
      error_status: stt.fail?.status ?? null,
      error_message: stt.fail?.message ? sanitizeSttLogMessage(stt.fail.message) : null,
    });
    auditError({
      chat_id: Number.parseInt(String(baseEnvelope.chatId ?? ''), 10) || 0,
      update_id: baseEnvelope.update_id,
      detail: JSON.stringify({
        event: 'max_voice_stt_failed',
        stt_provider: stt.provider,
        stt_failure_code: stt.fail?.code ?? null,
        bytes: downloaded.bytes,
        mime_type: downloaded.mimeType,
      }),
    });
    return sendSttFallback(payload);
  }

  const envelope = await maxEnvelopeForVoice(payload, transcript);
  const providerMessageId = String(envelope.metadata?.providerMessageId ?? '').trim();
  envelope.metadata = {
    ...(envelope.metadata ?? {}),
    transport: 'max_voice',
    source: 'audio',
    original_message_type: 'audio',
    originalMessageType: 'audio',
    sttStatus: 'success',
    sttSuccess: true,
    sttProvider: stt.provider,
    sttUsedFallback: stt.usedFallback,
    transcription: transcript,
    transcriptText: transcript,
    mime_type: downloaded.mimeType,
    extension: downloaded.extension,
    download_bytes: downloaded.bytes,
    voice: {
      source: 'voice',
      voiceChannel: 'max_voice',
      originalMessageType: 'audio',
      original_message_type: 'audio',
      sttStatus: 'success',
      sttSuccess: true,
      sttProvider: stt.provider,
      sttUsedFallback: stt.usedFallback,
      transcription: transcript,
      transcriptText: transcript,
      mimeType: downloaded.mimeType,
      extension: downloaded.extension,
      downloadBytes: downloaded.bytes,
      providerMessageId,
      providerMediaId: audioToken ? createHash('sha256').update(audioToken).digest('hex').slice(0, 16) : null,
    },
  };

  try {
    const result = await processMessage(envelope);
    console.info('[max:voice] brain.done', {
      update_id: envelope.update_id,
      outcome: result.outcome,
      escalated: Boolean(result.escalation),
      category: result.category ?? null,
      transcript_chars: transcript.length,
    });
    return {
      outcome: 'voice_transcript_processed',
      transcript_chars: transcript.length,
      brain_outcome: String(result.outcome),
    };
  } catch (error) {
    console.error('[max:voice] processing.threw', { error_type: (error as Error).name || 'unexpected' });
    return sendSttFallback(payload);
  }
}
