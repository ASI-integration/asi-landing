/**
 * Telegram outbound voice reply: policy-driven TTS + sendVoice.
 *
 * Text reply is always sent separately by TelegramAdapter.
 * Voice is optional and must never block text delivery.
 *
 * Env vars:
 *   VOICE_TTS_BASE_URL, VOICE_TTS_MODEL, VOICE_TTS_VOICE
 *   VOICE_TTS_RELAY_TOKEN / VOICE_TTS_API_KEY / OPENAI_API_KEY / ELEVENLABS_API_KEY
 *   TELEGRAM_BOT_TOKEN — Required for sendVoice
 *   VOICE_REPLY_ENABLED=1 — Global kill-switch
 */

import type { VoiceResponseDecision } from './voice-response-policy';
import { estimateVoiceSeconds } from './voice-response-policy';
import { recordVoiceBudgetUsage } from './voice-budget-store';
import { generateSpeech } from './voice-tts';
import { prepareTelegramVoiceAudio } from './voice-audio';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function getTelegramBotToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

export interface VoiceReplyContext {
  chatId: number;
  decision: VoiceResponseDecision;
}

export function isVoiceReplyGloballyEnabled(): boolean {
  return process.env.VOICE_REPLY_ENABLED === '1';
}

export async function sendTelegramVoice(chatId: number | string, oggBytes: Buffer): Promise<boolean> {
  const token = getTelegramBotToken();
  if (!token) {
    console.warn('[tg:voice] missing_env.TELEGRAM_BOT_TOKEN_for_sendVoice');
    return false;
  }

  if (process.env.TELEGRAM_DRY_RUN === '1') {
    if (debugEnabled()) console.log('[tg:voice] telegram.sendVoice.dry_run', { chat_id: String(chatId) });
    return true;
  }

  const url = `https://api.telegram.org/bot${token}/sendVoice`;
  if (debugEnabled()) {
    console.log('[tg:voice] telegram.sendVoice.start', { chat_id: String(chatId), bytes: oggBytes.byteLength });
  }

  try {
    const blob = new Blob([new Uint8Array(oggBytes)], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', blob, 'reply.ogg');

    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.text();
      console.error('[tg:voice] telegram.sendVoice.fail_http', { status: res.status, body: body.slice(0, 200) });
      return false;
    }

    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      console.error('[tg:voice] telegram.sendVoice.fail_api', { description: data.description ?? null });
      return false;
    }

    if (debugEnabled()) console.log('[tg:voice] telegram.sendVoice.ok', { chat_id: String(chatId) });
    return true;
  } catch (err) {
    console.error('[tg:voice] telegram.sendVoice.fail_network', (err as Error).message);
    return false;
  }
}

/**
 * Attempt voice delivery per policy decision.
 * Returns true if voice bubble was sent; false otherwise. Never throws.
 */
export async function sendVoiceReply(chatId: number, ctx: VoiceReplyContext): Promise<boolean> {
  if (!isVoiceReplyGloballyEnabled()) {
    if (debugEnabled()) console.log('[tg:voice] voice_reply.skip_global_disabled', { chat_id: chatId });
    return false;
  }

  const { decision } = ctx;
  if (!decision.shouldSendVoice) {
    if (debugEnabled()) {
      console.log('[tg:voice] voice_reply.skip_policy', { chat_id: chatId, reason: decision.reason });
    }
    return false;
  }

  const voiceText = String(decision.voiceText ?? '').trim();
  if (!voiceText) {
    console.warn('[tg:voice] voice_reply.skip_empty_voice_text', { chat_id: chatId, reason: decision.reason });
    return false;
  }

  try {
    const tts = await generateSpeech(voiceText);
    if (!tts.audio) {
      console.warn('[tg:voice] voice_reply.fail_tts', {
        chat_id: chatId,
        reason: decision.reason,
        error_type: tts.errorType ?? 'unknown',
      });
      return false;
    }

    const prepared = prepareTelegramVoiceAudio(tts.audio, tts.format);
    if (!prepared.oggBytes) {
      console.warn('[tg:voice] voice_reply.fail_audio_prep', {
        chat_id: chatId,
        ffmpeg_missing: prepared.ffmpegMissing,
        ffmpeg_used: prepared.ffmpegUsed,
      });
      return false;
    }

    const sent = await sendTelegramVoice(chatId, prepared.oggBytes);
    if (!sent) {
      console.warn('[tg:voice] voice_reply.fail_sendVoice', { chat_id: chatId });
      return false;
    }

    recordVoiceBudgetUsage({
      chatId,
      estimatedSeconds: estimateVoiceSeconds(voiceText),
    });

    console.info('[tg:voice] voice_reply.ok', {
      chat_id: chatId,
      reason: decision.reason,
      chars: voiceText.length,
      provider: tts.provider,
      ffmpeg_used: prepared.ffmpegUsed,
    });
    return true;
  } catch (err) {
    console.error('[tg:voice] voice_reply.fail_unexpected', err);
    return false;
  }
}

// Legacy exports kept for tests importing old helpers.
export type VoiceReplyMode = 'text' | 'voice' | 'both' | 'mirror';

export function getVoiceReplyMode(): VoiceReplyMode {
  const raw = String(process.env.VOICE_REPLY_MODE ?? 'both').trim().toLowerCase();
  if (raw === 'text' || raw === 'voice' || raw === 'both' || raw === 'mirror') return raw;
  return 'both';
}

/** @deprecated Policy v1 replaces mirror heuristics. */
export function shouldUseVoiceReply(_replyText: string, _ctx: { voiceEnabled: boolean }): boolean {
  return false;
}
