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
      has_whisper_api_key: Boolean(process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY),
    });
  }

  if (!token) {
    console.warn('[tg:voice] missing_env.TELEGRAM_BOT_TOKEN');
    return null;
  }

  const ext = mimeTypeToExt(mimeType);
  const filename = `voice_message${ext}`;

  const fileInfo = await resolveFilePath(fileId, token);
  if (!fileInfo) return null;

  const audioBuffer = await downloadFileBinary(fileInfo.file_path, token);
  if (!audioBuffer) return null;

  const r = await transcribeWithWhisper({ audioBuffer, filename });
  return r?.text ?? null;
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

