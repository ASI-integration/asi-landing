/**
 * ElevenLabs outbound voice reply for Telegram.
 *
 * Voice is optional and must never block sending the text fallback.
 *
 * Env vars:
 *   ELEVENLABS_API_KEY         — Required for voice generation
 *   ELEVENLABS_VOICE_ID        — Voice to use (default: Rachel)
 *   ELEVENLABS_MODEL_ID        — Model (default: eleven_multilingual_v2)
 *   ELEVENLABS_TIMEOUT_MS      — TTS request timeout (default: 20 000)
 *   TELEGRAM_BOT_TOKEN         — Required for sendVoice
 *   VOICE_REPLY_ENABLED=1      — Global kill-switch (default: disabled)
 *   VOICE_REPLY_MAX_CHARS      — Override max char limit (default: 300)
 *
 * Debug:
 *   COMM_PIPELINE_DEBUG=1 or TELEGRAM_DEBUG=1
 */

const ELEVENLABS_DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2';
const ELEVENLABS_TIMEOUT_MS_DEF = 20_000;
const VOICE_REPLY_MAX_CHARS_DEF = 300;

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function getElevenLabsApiKey(): string | null {
  const k = process.env.ELEVENLABS_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : null;
}

function getElevenLabsVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID ?? ELEVENLABS_DEFAULT_VOICE_ID;
}

function getElevenLabsModel(): string {
  return process.env.ELEVENLABS_MODEL_ID ?? ELEVENLABS_DEFAULT_MODEL;
}

function getElevenLabsTimeoutMs(): number {
  const raw = process.env.ELEVENLABS_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : ELEVENLABS_TIMEOUT_MS_DEF;
}

function getVoiceReplyMaxChars(): number {
  const raw = process.env.VOICE_REPLY_MAX_CHARS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : VOICE_REPLY_MAX_CHARS_DEF;
}

function getTelegramBotToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

export interface VoiceReplyContext {
  chatId: number;
  voiceEnabled: boolean;
  isEscalation?: boolean;
  isPayment?: boolean;
  isCheckinInstructions?: boolean;
}

export type VoiceReplyMode = 'text' | 'voice' | 'both' | 'mirror';

export function getVoiceReplyMode(): VoiceReplyMode {
  const raw = String(process.env.VOICE_REPLY_MODE ?? 'mirror').trim().toLowerCase();
  if (raw === 'text' || raw === 'voice' || raw === 'both' || raw === 'mirror') return raw;
  return 'mirror';
}

export function shouldUseVoiceReply(replyText: string, ctx: VoiceReplyContext): boolean {
  if (process.env.VOICE_REPLY_ENABLED !== '1') return false;
  if (!ctx.voiceEnabled) return false;
  if (ctx.chatId < 0) return false;
  if (ctx.isEscalation) return false;
  if (ctx.isPayment) return false;
  if (ctx.isCheckinInstructions) return false;
  if (/https?:\/\//i.test(replyText)) return false;
  if (replyText.length > getVoiceReplyMaxChars()) return false;
  return true;
}

export async function generateSpeech(text: string): Promise<ArrayBuffer | null> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    console.warn('[tg:voice] missing_env.ELEVENLABS_API_KEY');
    return null;
  }

  const voiceId = getElevenLabsVoiceId();
  const model = getElevenLabsModel();
  const timeoutMs = getElevenLabsTimeoutMs();

  if (debugEnabled()) {
    console.log('[tg:voice] elevenlabs.start', { voice_id: voiceId, model_id: model, timeout_ms: timeoutMs, chars: text.length });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[tg:voice] elevenlabs.fail_http', { status: res.status, body: body.slice(0, 200) });
      return null;
    }

    const buf = await res.arrayBuffer();
    if (debugEnabled()) console.log('[tg:voice] elevenlabs.ok', { bytes: buf.byteLength });
    return buf;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[tg:voice] elevenlabs.fail_timeout', { timeout_ms: timeoutMs });
    } else {
      console.error('[tg:voice] elevenlabs.fail_network', (err as Error).message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTelegramVoice(chatId: number | string, audioBuffer: ArrayBuffer): Promise<boolean> {
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
  if (debugEnabled()) console.log('[tg:voice] telegram.sendVoice.start', { chat_id: String(chatId), bytes: audioBuffer.byteLength });

  try {
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', blob, 'reply.mp3');

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
 * Returns true if voice was sent successfully.
 * Returns false if voice not attempted (rules) or failed.
 * Never throws.
 */
export async function sendVoiceReply(chatId: number, replyText: string, ctx: VoiceReplyContext): Promise<boolean> {
  if (!shouldUseVoiceReply(replyText, ctx)) {
    if (debugEnabled()) console.log('[tg:voice] voice_reply.skip', { chat_id: chatId });
    return false;
  }

  try {
    const audioBuffer = await generateSpeech(replyText);
    if (!audioBuffer) {
      console.warn('[tg:voice] voice_reply.fail_tts');
      return false;
    }

    const sent = await sendTelegramVoice(chatId, audioBuffer);
    if (!sent) {
      console.warn('[tg:voice] voice_reply.fail_sendVoice');
      return false;
    }

    console.info('[tg:voice] voice_reply.ok', { chat_id: chatId, chars: replyText.length });
    return true;
  } catch (err) {
    console.error('[tg:voice] voice_reply.fail_unexpected', err);
    return false;
  }
}

