#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function optional(name) {
  const value = String(process.env[name] ?? '').trim();
  return value || null;
}

function resolveProvider() {
  if (optional('VOICE_TTS_BASE_URL')) return 'relay';
  return String(process.env.VOICE_TTS_PROVIDER ?? 'openai').trim().toLowerCase() === 'elevenlabs'
    ? 'elevenlabs'
    : 'openai';
}

function resolveModel(provider) {
  return optional('VOICE_TTS_MODEL') || (provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'gpt-4o-mini-tts');
}

function resolveVoice(provider) {
  return optional('VOICE_TTS_VOICE') || optional('ELEVENLABS_VOICE_ID') || (provider === 'elevenlabs' ? '21m00Tcm4TlvDq8ikWAM' : 'coral');
}

async function tts() {
  const provider = resolveProvider();
  const text = String(process.env.COMM_VOICE_PROBE_TEXT ?? 'Проверка голосового канала ASI. Связь работает.').trim();
  if (!text) throw new Error('COMM_VOICE_PROBE_TEXT is empty');

  if (provider === 'elevenlabs') {
    const key = required('ELEVENLABS_API_KEY');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolveVoice(provider))}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'xi-api-key': key,
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: resolveModel(provider),
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${res.status}`);
    return { provider, format: 'mp3', bytes: Buffer.from(await res.arrayBuffer()) };
  }

  const baseUrl = provider === 'relay'
    ? required('VOICE_TTS_BASE_URL').replace(/\/+$/, '')
    : String(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = provider === 'relay'
    ? optional('VOICE_TTS_RELAY_TOKEN') || optional('VOICE_TTS_API_KEY') || required('OPENAI_API_KEY')
    : optional('VOICE_TTS_API_KEY') || required('OPENAI_API_KEY');
  const format = 'opus';
  const res = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      accept: 'audio/*',
    },
    body: JSON.stringify({
      model: resolveModel(provider),
      voice: resolveVoice(provider),
      input: text,
      response_format: format,
      speed: Number(process.env.VOICE_TTS_SPEED ?? '1') || 1,
      instructions: optional('VOICE_TTS_INSTRUCTIONS') || undefined,
    }),
  });
  if (!res.ok) throw new Error(`${provider} TTS failed: HTTP ${res.status}`);
  return { provider, format, bytes: Buffer.from(await res.arrayBuffer()) };
}

function toOgg(input) {
  if (input.format === 'opus' || input.format === 'ogg') return input.bytes;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asi-voice-probe-'));
  const src = path.join(dir, `input.${input.format}`);
  const dst = path.join(dir, 'output.ogg');
  try {
    fs.writeFileSync(src, input.bytes);
    const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libopus', '-b:a', '32k', dst], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (result.status !== 0 || !fs.existsSync(dst)) {
      throw new Error(`ffmpeg conversion failed: ${String(result.stderr ?? '').slice(0, 160)}`);
    }
    return fs.readFileSync(dst);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function sendVoice(chatId, oggBytes) {
  const token = required('TELEGRAM_BOT_TOKEN');
  const blob = new Blob([new Uint8Array(oggBytes)], { type: 'audio/ogg' });
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('voice', blob, 'asi-communication-probe.ogg');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error(`Telegram sendVoice failed: HTTP ${res.status} ${json?.description ?? ''}`.trim());
  return {
    messageId: json?.result?.message_id ?? null,
    duration: json?.result?.voice?.duration ?? null,
    fileSize: json?.result?.voice?.file_size ?? null,
  };
}

async function main() {
  const chatId = optional('COMM_VOICE_PROBE_CHAT_ID') || optional('TELEGRAM_TEST_CHAT_ID') || optional('TELEGRAM_AUTOPILOT_TEST_CHAT_ID');
  if (!chatId) throw new Error('Missing COMM_VOICE_PROBE_CHAT_ID / TELEGRAM_TEST_CHAT_ID');

  const generated = await tts();
  if (!generated.bytes.length) throw new Error('TTS returned empty audio');
  const ogg = toOgg(generated);
  const delivered = await sendVoice(chatId, ogg);

  console.log(JSON.stringify({
    pass: true,
    provider: generated.provider,
    generatedBytes: generated.bytes.length,
    oggBytes: ogg.length,
    telegram: delivered,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ pass: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
