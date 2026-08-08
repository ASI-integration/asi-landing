/**
 * Voice transcription for Telegram voice/audio messages.
 *
 * Provider-specific steps:
 *   1) getFile — resolve file_id → file_path via Telegram Bot API
 *   2) Download the binary from the Telegram CDN
 * Shared step:
 *   3) transcribeWithWhisper() — OpenAI Whisper (audio/transcriptions)
 */

import {
  sanitizeSttLogMessage,
  transcribeWithConfiguredStt,
  type SttAttemptResult,
  type SttContext,
  type SttFailureCode,
} from './voice/stt';

type TelegramFileResolveResult =
  | { ok: true; info: TelegramFileInfo }
  | { ok: false; reason: 'get_file_http' | 'get_file_api' | 'file_too_large' | 'get_file_timeout' | 'get_file_network'; status?: number; message?: string };

type TelegramFileDownloadResult =
  | { ok: true; audioBuffer: ArrayBuffer; bytes: number; contentType?: string | null }
  | { ok: false; reason: 'download_http' | 'download_too_large' | 'download_timeout' | 'download_network'; status?: number; message?: string; bytes?: number };

export type TelegramVoiceTranscriptionFailureReason =
  | 'transcription_disabled'
  | 'missing_telegram_bot_token'
  | 'get_file_failed'
  | 'download_failed'
  | 'stt_failed';

export type TelegramVoiceTranscriptionResult =
  | {
      ok: true;
      text: string;
      provider: SttAttemptResult['provider'];
      usedFallback: boolean;
      filename: string;
      mimeType: string;
      extension: string;
      filePath: string;
      fileSize?: number;
      downloadBytes: number;
    }
  | {
      ok: false;
      reason: TelegramVoiceTranscriptionFailureReason;
      provider?: SttAttemptResult['provider'];
      usedFallback?: boolean;
      filename?: string;
      mimeType?: string;
      extension?: string;
      filePath?: string;
      fileSize?: number;
      downloadBytes?: number;
      telegram?: {
        stage: 'getFile' | 'download';
        status?: number;
        message?: string;
      };
      stt?: {
        kind?: NonNullable<SttAttemptResult['fail']>['kind'];
        code?: SttFailureCode;
        status?: number;
        message?: string;
        geoBlocked?: boolean;
      };
    };

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

// ─── Step 1: resolve file_path from file_id ───────────────────────────────────

interface TelegramFileInfo {
  file_path: string;
  file_size?: number;
}

async function resolveFilePath(fileId: string, token: string): Promise<TelegramFileResolveResult> {
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  if (debugEnabled()) {
    console.log('[tg:voice] getFile.start');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTelegramFetchTimeoutMs());
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      const message = sanitizeSttLogMessage(await res.text().catch(() => ''));
      console.error('[tg:voice] getFile.fail_http', { status: res.status, message });
      return { ok: false, reason: 'get_file_http', status: res.status, message };
    }
    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: { file_path?: string; file_size?: number };
    };
    if (!data.ok || !data.result?.file_path) {
      const message = sanitizeSttLogMessage(data.description ?? 'Telegram getFile returned no file_path');
      console.error('[tg:voice] getFile.fail_api', { ok: data.ok, message });
      return { ok: false, reason: 'get_file_api', message };
    }
    const maxBytes = getTelegramVoiceMaxBytes();
    if (typeof data.result.file_size === 'number' && data.result.file_size > maxBytes) {
      console.error('[tg:voice] getFile.reject_too_large', {
        file_size: data.result.file_size,
        max_bytes: maxBytes,
      });
      return { ok: false, reason: 'file_too_large', message: `file_size>${maxBytes}` };
    }
    if (debugEnabled()) {
      console.log('[tg:voice] getFile.ok', {
        file_extension: extensionFromPath(data.result.file_path),
        file_size: data.result.file_size ?? null,
      });
    }
    return { ok: true, info: { file_path: data.result.file_path, file_size: data.result.file_size } };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.error('[tg:voice] getFile.fail_timeout', { timeout_ms: getTelegramFetchTimeoutMs() });
      return { ok: false, reason: 'get_file_timeout', message: `timeout_ms=${getTelegramFetchTimeoutMs()}` };
    } else {
      const message = sanitizeSttLogMessage((err as Error).message);
      console.error('[tg:voice] getFile.fail_network', { message });
      return { ok: false, reason: 'get_file_network', message };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Step 2: download file binary ────────────────────────────────────────────

async function downloadFileBinary(filePath: string, token: string): Promise<TelegramFileDownloadResult> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  if (debugEnabled()) {
    console.log('[tg:voice] download.start', { file_extension: extensionFromPath(filePath) });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTelegramFetchTimeoutMs());
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      const message = sanitizeSttLogMessage(await res.text().catch(() => ''));
      console.error('[tg:voice] download.fail_http', { file_extension: extensionFromPath(filePath), status: res.status, message });
      return { ok: false, reason: 'download_http', status: res.status, message };
    }
    const buf = await res.arrayBuffer();
    const maxBytes = getTelegramVoiceMaxBytes();
    if (buf.byteLength > maxBytes) {
      console.error('[tg:voice] download.reject_too_large', { bytes: buf.byteLength, max_bytes: maxBytes });
      return { ok: false, reason: 'download_too_large', bytes: buf.byteLength, message: `bytes>${maxBytes}` };
    }
    if (debugEnabled()) {
      console.log('[tg:voice] download.ok', { bytes: buf.byteLength, content_type: res.headers.get('content-type') ?? null });
    }
    return { ok: true, audioBuffer: buf, bytes: buf.byteLength, contentType: res.headers.get('content-type') };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.error('[tg:voice] download.fail_timeout', { timeout_ms: getTelegramFetchTimeoutMs() });
      return { ok: false, reason: 'download_timeout', message: `timeout_ms=${getTelegramFetchTimeoutMs()}` };
    } else {
      const message = sanitizeSttLogMessage((err as Error).message);
      console.error('[tg:voice] download.fail_network', { file_extension: extensionFromPath(filePath), message });
      return { ok: false, reason: 'download_network', message };
    }
  } finally {
    clearTimeout(timer);
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
export async function transcribeVoiceMessageDetailed(
  fileId: string,
  mimeType?: string,
  ctx?: SttContext,
): Promise<TelegramVoiceTranscriptionResult> {
  if (process.env.VOICE_TRANSCRIPTION_DISABLED === '1') {
    if (debugEnabled()) console.info('[tg:voice] transcription.disabled');
    return { ok: false, reason: 'transcription_disabled' };
  }

  const token = getTelegramBotToken();

  if (debugEnabled()) {
    console.log('[tg:voice] env.check', {
      has_telegram_bot_token: Boolean(token),
      has_voice_stt_base_url: Boolean((process.env.VOICE_STT_BASE_URL ?? '').trim()),
      has_voice_stt_relay_token: Boolean((process.env.VOICE_STT_RELAY_TOKEN ?? process.env.VOICE_STT_API_KEY ?? '').trim()),
      voice_stt_model: process.env.VOICE_STT_MODEL ?? null,
      voice_stt_primary: process.env.VOICE_STT_PRIMARY ?? null,
      voice_stt_fallback: process.env.VOICE_STT_FALLBACK ?? null,
      has_llm_api_key: Boolean(process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY),
      has_llm_fallback: Boolean(process.env.LLM_FALLBACK_BASE_URL && process.env.LLM_FALLBACK_API_KEY),
    });
  }

  if (!token) {
    console.warn('[tg:voice] missing_env.TELEGRAM_BOT_TOKEN');
    return { ok: false, reason: 'missing_telegram_bot_token', stt: { kind: 'missing_config', code: 'missing_env' } };
  }

  const retries = getTelegramFetchRetries();
  for (let attempt = 1; attempt <= Math.max(1, retries + 1); attempt++) {
    const fileInfo = await resolveFilePath(fileId, token);
    if (!fileInfo.ok) {
      if (attempt <= retries) continue;
      return {
        ok: false,
        reason: 'get_file_failed',
        telegram: {
          stage: 'getFile',
          status: fileInfo.status,
          message: fileInfo.message,
        },
      };
    }

    const audio = await downloadFileBinary(fileInfo.info.file_path, token);
    if (!audio.ok) {
      if (attempt <= retries) continue;
      return {
        ok: false,
        reason: 'download_failed',
        filePath: fileInfo.info.file_path,
        fileSize: fileInfo.info.file_size,
        extension: extensionFromPath(fileInfo.info.file_path),
        telegram: {
          stage: 'download',
          status: audio.status,
          message: audio.message,
        },
      };
    }

    const resolvedMimeType = resolveAudioMimeType(mimeType, audio.contentType, fileInfo.info.file_path);
    const ext = mimeTypeToExt(resolvedMimeType);
    const filename = `voice_message${ext}`;

    console.info('[tg:voice] download.ready_for_stt', {
      update_id: ctx?.updateId ?? null,
      mime_type: resolvedMimeType,
      extension: ext,
      bytes: audio.bytes,
      file_size: fileInfo.info.file_size ?? null,
    });

    const stt = await transcribeWithConfiguredStt({
      audioBuffer: audio.audioBuffer,
      filename,
      mimeType: resolvedMimeType,
      ctx,
    });
    if (!stt.ok || !stt.text) {
      console.warn('[tg:voice] stt.attempt_failed', {
        attempt,
        provider: stt.provider,
        used_fallback: stt.usedFallback,
        mime_type: resolvedMimeType,
        extension: ext,
        download_success: true,
        fail_kind: stt.fail?.kind ?? null,
        failure_code: stt.fail?.code ?? null,
        fail_status: stt.fail?.status ?? null,
        fail_message: stt.fail?.message ? sanitizeSttLogMessage(stt.fail.message) : null,
        geo_blocked: stt.fail?.geoBlocked ?? null,
        fallback_reason: 'stt_failed',
      });
      // Geo-block is deterministic; retries won't help and just delay the operator-review path.
      if (stt.fail?.geoBlocked) {
        return sttFailureResult(stt, {
          filename,
          mimeType: resolvedMimeType,
          extension: ext,
          filePath: fileInfo.info.file_path,
          fileSize: fileInfo.info.file_size,
          downloadBytes: audio.bytes,
        });
      }
      if (
        stt.fail?.code === 'missing_env' ||
        stt.fail?.code === 'stt_auth_failed' ||
        stt.fail?.code === 'unsupported_audio_format' ||
        stt.fail?.code === 'empty_transcript'
      ) {
        return sttFailureResult(stt, {
          filename,
          mimeType: resolvedMimeType,
          extension: ext,
          filePath: fileInfo.info.file_path,
          fileSize: fileInfo.info.file_size,
          downloadBytes: audio.bytes,
        });
      }
      if (attempt <= retries) continue;
      return sttFailureResult(stt, {
        filename,
        mimeType: resolvedMimeType,
        extension: ext,
        filePath: fileInfo.info.file_path,
        fileSize: fileInfo.info.file_size,
        downloadBytes: audio.bytes,
      });
    }
    if (stt.usedFallback) {
      console.info('[tg:voice] stt.ok_fallback', { attempt, provider: stt.provider, chars: stt.text.length });
    }
    return {
      ok: true,
      text: stt.text,
      provider: stt.provider,
      usedFallback: stt.usedFallback,
      filename,
      mimeType: resolvedMimeType,
      extension: ext,
      filePath: fileInfo.info.file_path,
      fileSize: fileInfo.info.file_size,
      downloadBytes: audio.bytes,
    };
  }

  return { ok: false, reason: 'stt_failed' };
}

export async function transcribeVoiceMessage(fileId: string, mimeType?: string, ctx?: SttContext): Promise<string | null> {
  const result = await transcribeVoiceMessageDetailed(fileId, mimeType, ctx);
  return result.ok ? result.text : null;
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

function extensionFromPath(filePath: string): string {
  const clean = filePath.split('?')[0] ?? filePath;
  const last = clean.includes('.') ? clean.slice(clean.lastIndexOf('.')).toLowerCase() : '';
  if (last === '.oga') return '.ogg';
  return last || '.ogg';
}

function resolveAudioMimeType(inputMimeType?: string, contentType?: string | null, filePath?: string): string {
  const ext = filePath ? extensionFromPath(filePath) : '';
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg';

  const candidates = [inputMimeType, contentType].map(v => (v ?? '').split(';')[0].trim().toLowerCase()).filter(Boolean);
  const direct = candidates.find(v => v.startsWith('audio/') && v !== 'audio/octet-stream');
  if (direct) {
    if (direct.includes('oga')) return 'audio/ogg';
    return direct;
  }

  if (ext === '.opus') return 'audio/opus';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.mp3' || ext === '.mpeg' || ext === '.mpga') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.webm') return 'audio/webm';
  return 'audio/ogg';
}

function sttFailureResult(
  stt: SttAttemptResult,
  meta: Pick<Extract<TelegramVoiceTranscriptionResult, { ok: true }>, 'filename' | 'mimeType' | 'extension' | 'filePath' | 'fileSize' | 'downloadBytes'>,
): Extract<TelegramVoiceTranscriptionResult, { ok: false }> {
  return {
    ok: false,
    reason: 'stt_failed',
    provider: stt.provider,
    usedFallback: stt.usedFallback,
    ...meta,
    stt: {
      kind: stt.fail?.kind,
      code: stt.fail?.code,
      status: stt.fail?.status,
      message: stt.fail?.message ? sanitizeSttLogMessage(stt.fail.message) : undefined,
      geoBlocked: stt.fail?.geoBlocked,
    },
  };
}

