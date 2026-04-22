/**
 * Voice transcription for Telegram voice/audio messages.
 *
 * Provider-specific steps:
 *   1) getFile — resolve file_id → file_path via Telegram Bot API
 *   2) Download the binary from the Telegram CDN
 * Shared step:
 *   3) transcribeWithWhisper() — OpenAI Whisper (audio/transcriptions)
 */

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function getTelegramBotToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

function getTelegramFetchTimeoutMs(): number {
  const raw = process.env.TELEGRAM_FILE_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}

function getTelegramVoiceMaxBytes(): number {
  const raw = process.env.TELEGRAM_VOICE_MAX_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  // Default 20MB — Telegram voice notes are usually far smaller, but be defensive.
  return Number.isFinite(n) && n > 0 ? n : 20 * 1024 * 1024;
}

function getTelegramFetchRetries(): number {
  const raw = process.env.TELEGRAM_VOICE_FETCH_RETRIES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

import { transcribeWithWhisper } from './voice/whisper';

// ─── Step 1: resolve file_path from file_id ───────────────────────────────────

interface TelegramFileInfo {
  file_path: string;
  file_size?: number;
}

async function resolveFilePath(fileId: string, token: string): Promise<TelegramFileInfo | null> {
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  if (debugEnabled()) {
    console.log('[tg:voice] getFile.start', { file_id: fileId });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTelegramFetchTimeoutMs());
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.error('[tg:voice] getFile.fail_http', { status: res.status });
      return null;
    }
    const data = (await res.json()) as {
      ok: boolean;
      result?: { file_path?: string; file_size?: number };
    };
    if (!data.ok || !data.result?.file_path) {
      console.error('[tg:voice] getFile.fail_api', { ok: data.ok });
      return null;
    }
    const maxBytes = getTelegramVoiceMaxBytes();
    if (typeof data.result.file_size === 'number' && data.result.file_size > maxBytes) {
      console.error('[tg:voice] getFile.reject_too_large', {
        file_size: data.result.file_size,
        max_bytes: maxBytes,
      });
      return null;
    }
    if (debugEnabled()) {
      console.log('[tg:voice] getFile.ok', {
        file_path: data.result.file_path,
        file_size: data.result.file_size ?? null,
      });
    }
    return { file_path: data.result.file_path, file_size: data.result.file_size };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.error('[tg:voice] getFile.fail_timeout', { timeout_ms: getTelegramFetchTimeoutMs() });
    } else {
      console.error('[tg:voice] getFile.fail_network', (err as Error).message);
    }
    return null;
  }
}

// ─── Step 2: download file binary ────────────────────────────────────────────

async function downloadFileBinary(filePath: string, token: string): Promise<ArrayBuffer | null> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  if (debugEnabled()) {
    console.log('[tg:voice] download.start', { file_path: filePath });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTelegramFetchTimeoutMs());
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.error('[tg:voice] download.fail_http', { status: res.status });
      return null;
    }
    const buf = await res.arrayBuffer();
    const maxBytes = getTelegramVoiceMaxBytes();
    if (buf.byteLength > maxBytes) {
      console.error('[tg:voice] download.reject_too_large', { bytes: buf.byteLength, max_bytes: maxBytes });
      return null;
    }
    if (debugEnabled()) {
      console.log('[tg:voice] download.ok', { bytes: buf.byteLength });
    }
    return buf;
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.error('[tg:voice] download.fail_timeout', { timeout_ms: getTelegramFetchTimeoutMs() });
    } else {
      console.error('[tg:voice] download.fail_network', (err as Error).message);
    }
    return null;
  }
}

// ─── Step 3: transcribe with Whisper ─────────────────────────────────────────

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Download a Telegram voice/audio file and transcribe it with Whisper.
 *
 * Returns the transcript string on success, null on any error (missing config,
 * network failure, Whisper failure). Never throws.
 */
export async function transcribeVoiceMessage(fileId: string, mimeType?: string): Promise<string | null> {
  if (process.env.VOICE_TRANSCRIPTION_DISABLED === '1') {
    if (debugEnabled()) console.info('[tg:voice] transcription.disabled');
    return null;
  }

  const token = getTelegramBotToken();

  if (debugEnabled()) {
    console.log('[tg:voice] env.check', {
      has_telegram_bot_token: Boolean(token),
      has_whisper_api_key: Boolean(process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? process.env.LLM_FALLBACK_API_KEY),
    });
  }

  if (!token) {
    console.warn('[tg:voice] missing_env.TELEGRAM_BOT_TOKEN');
    return null;
  }

  const ext = mimeTypeToExt(mimeType);
  const filename = `voice_message${ext}`;

  const retries = getTelegramFetchRetries();
  for (let attempt = 1; attempt <= Math.max(1, retries + 1); attempt++) {
    const fileInfo = await resolveFilePath(fileId, token);
    if (!fileInfo) {
      if (attempt <= retries) continue;
      return null;
    }

    const audioBuffer = await downloadFileBinary(fileInfo.file_path, token);
    if (!audioBuffer) {
      if (attempt <= retries) continue;
      return null;
    }

    const r = await transcribeWithWhisper({ audioBuffer, filename });
    if (!r?.text) {
      if (attempt <= retries) continue;
      return null;
    }
    return r.text;
  }

  return null;
}

function mimeTypeToExt(mimeType?: string): string {
  if (!mimeType) return '.ogg';
  const m = mimeType.toLowerCase();
  if (m.includes('ogg')) return '.ogg';
  if (m.includes('mp4') || m.includes('m4a')) return '.m4a';
  if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
  if (m.includes('wav')) return '.wav';
  if (m.includes('webm')) return '.webm';
  if (m.includes('opus')) return '.opus';
  return '.ogg';
}

