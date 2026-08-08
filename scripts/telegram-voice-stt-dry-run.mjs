import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 30_000;

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] ?? '';
  const prefixed = process.argv.find(v => v.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : '';
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function sanitizeVoiceSttDiagnostic(value, maxLength = 700, sensitiveValues = []) {
  let raw = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  for (const sensitiveValue of sensitiveValues) {
    const secret = String(sensitiveValue ?? '');
    if (secret) raw = raw.split(secret).join('[redacted]');
  }
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
    .replace(/(api[_-]?key|token|secret|authorization)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1$2[redacted]')
    .slice(0, maxLength);
}

function safeBaseUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return sanitizeVoiceSttDiagnostic(baseUrl, 200);
  }
}

function timeoutMs() {
  const n = Number.parseInt(process.env.VOICE_STT_TIMEOUT_MS ?? process.env.WHISPER_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function requireEnv(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function sttAuth() {
  return (process.env.VOICE_STT_API_KEY ?? '').trim() || (process.env.VOICE_STT_RELAY_TOKEN ?? '').trim();
}

function modelFor(baseUrl) {
  return (process.env.VOICE_STT_MODEL ?? '').trim() || (baseUrl.includes('api.groq.com') ? 'whisper-large-v3-turbo' : 'whisper-1');
}

function classify(status, body) {
  const b = String(body ?? '').toLowerCase();
  if (status === 401 || status === 403) return 'stt_auth_failed';
  if (
    status === 400 ||
    status === 415 ||
    b.includes('unsupported audio') ||
    b.includes('unsupported file') ||
    b.includes('invalid file format') ||
    b.includes('audio format') ||
    b.includes('could not parse')
  ) {
    return 'unsupported_audio_format';
  }
  return 'stt_provider_error';
}

function commandVersion(command) {
  try {
    return execFileSync(command, ['-version'], { encoding: 'utf8', timeout: 5000 }).split(/\r?\n/)[0] ?? 'present';
  } catch {
    return null;
  }
}

function probeAudio(filePath) {
  const bytes = readFileSync(filePath);
  const magic = bytes.subarray(0, 4).toString('ascii');
  const ffprobe = commandVersion('ffprobe');
  let ffprobeSummary = null;
  if (ffprobe) {
    try {
      ffprobeSummary = execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_name,codec_type', '-of', 'json', filePath],
        { encoding: 'utf8', timeout: 10_000 },
      );
      ffprobeSummary = JSON.parse(ffprobeSummary);
    } catch (err) {
      ffprobeSummary = { error: sanitizeVoiceSttDiagnostic(err instanceof Error ? err.message : String(err), 300) };
    }
  }
  return {
    bytes: bytes.byteLength,
    magic,
    is_ogg: magic === 'OggS',
    ffmpeg: commandVersion('ffmpeg') ? 'present' : 'missing',
    ffprobe: ffprobe ? 'present' : 'missing',
    ffprobe_summary: ffprobeSummary,
  };
}

async function fetchWithTimeout(url, init, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const fileId = arg('file-id') || process.env.TELEGRAM_VOICE_FILE_ID || '';
  if (!fileId) throw new Error('missing_arg:file-id');

  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const baseUrl = requireEnv('VOICE_STT_BASE_URL').replace(/\/$/, '');
  const apiKey = sttAuth();
  if (!apiKey) throw new Error('missing_env:VOICE_STT_RELAY_TOKEN_OR_VOICE_STT_API_KEY');

  const timeout = timeoutMs();
  const model = modelFor(baseUrl);
  const tmp = mkdtempSync(join(tmpdir(), 'asi-voice-stt-'));
  const audioPath = join(tmp, 'telegram-voice.ogg');
  const keepAudio = hasFlag('keep-audio');

  try {
    console.log(
      JSON.stringify({
        event: 'voice_stt_dry_run.start',
        provider: 'voice_stt_relay',
        model,
        baseUrl: safeBaseUrl(baseUrl),
        has_telegram_bot_token: true,
        has_voice_stt_base_url: true,
        has_voice_stt_relay_token: true,
      }),
    );

    const getFile = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { method: 'GET' },
      timeout,
    );
    const getFileText = await getFile.text();
    if (!getFile.ok) {
      throw new Error(`telegram_download_failed:getFile:${getFile.status}:${sanitizeVoiceSttDiagnostic(getFileText, 700, [fileId, token])}`);
    }
    const getFileJson = JSON.parse(getFileText);
    const filePath = getFileJson?.result?.file_path;
    if (!getFileJson?.ok || !filePath) {
      throw new Error(`telegram_download_failed:getFile_api:${sanitizeVoiceSttDiagnostic(getFileText, 700, [fileId, token])}`);
    }

    const download = await fetchWithTimeout(`https://api.telegram.org/file/bot${token}/${filePath}`, { method: 'GET' }, timeout);
    const audioBuffer = await download.arrayBuffer();
    if (!download.ok) {
      const body = new TextDecoder().decode(audioBuffer);
      throw new Error(`telegram_download_failed:download:${download.status}:${sanitizeVoiceSttDiagnostic(body, 700, [fileId, token])}`);
    }

    writeFileSync(audioPath, Buffer.from(audioBuffer));
    const audio = probeAudio(audioPath);

    console.log(
      JSON.stringify({
        event: 'voice_stt_dry_run.telegram_download_ok',
        file_extension: filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase().replace('.oga', '.ogg') : '.ogg',
        telegram_file_size: getFileJson.result?.file_size ?? null,
        download_bytes: audio.bytes,
        content_type: download.headers.get('content-type') ?? null,
        audio,
      }),
    );

    const bytes = readFileSync(audioPath);
    const blob = new Blob([bytes], { type: arg('mime-type') || 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'voice_message.ogg');
    form.append('model', model);

    const stt = await fetchWithTimeout(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    }, timeout);
    const body = await stt.text();
    if (!stt.ok) {
      console.log(
        JSON.stringify({
          event: 'voice_stt_dry_run.stt_failed',
          provider: 'voice_stt_relay',
          model,
          status: stt.status,
          failure_code: classify(stt.status, body),
          sanitized_error: sanitizeVoiceSttDiagnostic(body),
        }),
      );
      process.exitCode = 2;
      return;
    }

    let data = {};
    try {
      data = JSON.parse(body);
    } catch {
      data = {};
    }
    const transcript = String(data.text ?? '').trim();
    console.log(
      JSON.stringify({
        event: transcript ? 'voice_stt_dry_run.ok' : 'voice_stt_dry_run.empty_transcript',
        provider: 'voice_stt_relay',
        model,
        status: stt.status,
        transcript_chars: transcript.length,
        transcript,
        failure_code: transcript ? null : 'empty_transcript',
      }),
    );
    if (!transcript) process.exitCode = 3;
  } finally {
    if (!keepAudio) rmSync(tmp, { recursive: true, force: true });
    else console.log(JSON.stringify({ event: 'voice_stt_dry_run.audio_kept', path: audioPath }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(
      JSON.stringify({
        event: 'voice_stt_dry_run.error',
        sanitized_error: sanitizeVoiceSttDiagnostic(err instanceof Error ? err.message : String(err)),
      }),
    );
    process.exit(1);
  });
}
