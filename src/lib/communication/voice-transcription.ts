/**
 * Voice transcription for Telegram voice/audio messages.
 *
 * Flow:
 *   1. getFile — resolve file_id → file_path via Telegram Bot API
 *   2. Download the binary from the Telegram CDN
 *   3. POST to OpenAI Whisper (audio/transcriptions) — returns plain text
 *
 * Env vars required:
 *   TELEGRAM_BOT_TOKEN  — Bot API token (same as used for outbound)
 *   OPENAI_API_KEY      — Whisper transcription (falls back to LLM_API_KEY)
 *
 * Optional:
 *   WHISPER_TIMEOUT_MS  — Per-request timeout (default: 30 000)
 *   VOICE_TRANSCRIPTION_DISABLED=1  — Kill-switch to disable at runtime
 *
 * Debug:
 *   COMM_PIPELINE_DEBUG=1 or TELEGRAM_DEBUG=1
 */

const WHISPER_TIMEOUT_MS_DEFAULT = 30_000;

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function getWhisperTimeoutMs(): number {
  const raw = process.env.WHISPER_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : WHISPER_TIMEOUT_MS_DEFAULT;
}

function getTelegramBotToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

function getWhisperApiKey(): string | null {
  const k = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : null;
}

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
    const res = await fetch(url, { method: 'GET' });
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
    if (debugEnabled()) {
      console.log('[tg:voice] getFile.ok', {
        file_path: data.result.file_path,
        file_size: data.result.file_size ?? null,
      });
    }
    return { file_path: data.result.file_path, file_size: data.result.file_size };
  } catch (err) {
    console.error('[tg:voice] getFile.fail_network', (err as Error).message);
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
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      console.error('[tg:voice] download.fail_http', { status: res.status });
      return null;
    }
    const buf = await res.arrayBuffer();
    if (debugEnabled()) {
      console.log('[tg:voice] download.ok', { bytes: buf.byteLength });
    }
    return buf;
  } catch (err) {
    console.error('[tg:voice] download.fail_network', (err as Error).message);
    return null;
  }
}

// ─── Step 3: transcribe with Whisper ─────────────────────────────────────────

async function transcribeBuffer(
  audioBuffer: ArrayBuffer,
  filename: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (debugEnabled()) {
    console.log('[tg:voice] whisper.start', { filename, timeout_ms: timeoutMs, bytes: audioBuffer.byteLength });
  }

  try {
    const blob = new Blob([audioBuffer]);
    const form = new FormData();
    form.append('file', blob, filename);
    form.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[tg:voice] whisper.fail_http', { status: res.status, body: body.slice(0, 200) });
      return null;
    }

    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    if (!text) {
      console.warn('[tg:voice] whisper.fail_empty');
      return null;
    }
    if (debugEnabled()) {
      console.log('[tg:voice] whisper.ok', { chars: text.length });
    }
    return text;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[tg:voice] whisper.fail_timeout', { timeout_ms: timeoutMs });
    } else {
      console.error('[tg:voice] whisper.fail_network', (err as Error).message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
  const apiKey = getWhisperApiKey();

  if (debugEnabled()) {
    console.log('[tg:voice] env.check', {
      has_telegram_bot_token: Boolean(token),
      has_whisper_api_key: Boolean(apiKey),
      whisper_timeout_ms: getWhisperTimeoutMs(),
    });
  }

  if (!token) {
    console.warn('[tg:voice] missing_env.TELEGRAM_BOT_TOKEN');
    return null;
  }

  if (!apiKey) {
    console.warn('[tg:voice] missing_env.OPENAI_API_KEY_or_LLM_API_KEY');
    return null;
  }

  const ext = mimeTypeToExt(mimeType);
  const filename = `voice_message${ext}`;

  const fileInfo = await resolveFilePath(fileId, token);
  if (!fileInfo) return null;

  const audioBuffer = await downloadFileBinary(fileInfo.file_path, token);
  if (!audioBuffer) return null;

  const timeoutMs = getWhisperTimeoutMs();
  return transcribeBuffer(audioBuffer, filename, apiKey, timeoutMs);
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

