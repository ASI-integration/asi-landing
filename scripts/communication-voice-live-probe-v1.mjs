#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  normalizeTelegramTestChatId,
  resolveTelegramTestChatId,
  TestChatConfigurationError,
} from './telegram-test-chat-id.mjs';

function optional(name, env = process.env) {
  const value = String(env[name] ?? '').trim();
  return value || null;
}

function preferredProvider(env = process.env) {
  if (optional('VOICE_TTS_BASE_URL', env)) return 'relay';
  return String(env.VOICE_TTS_PROVIDER ?? 'openai').trim().toLowerCase() === 'elevenlabs'
    ? 'elevenlabs'
    : 'openai';
}

function providerConfigured(provider, env = process.env) {
  if (provider === 'relay') {
    return Boolean(
      optional('VOICE_TTS_BASE_URL', env) &&
      (optional('VOICE_TTS_RELAY_TOKEN', env) || optional('VOICE_TTS_API_KEY', env) || optional('OPENAI_API_KEY', env)),
    );
  }
  if (provider === 'elevenlabs') return Boolean(optional('ELEVENLABS_API_KEY', env));
  return Boolean(optional('VOICE_TTS_API_KEY', env) || optional('OPENAI_API_KEY', env));
}

export function configuredProviderOrder(env = process.env) {
  const preferred = preferredProvider(env);
  const explicitFallback = String(env.VOICE_TTS_FALLBACK_PROVIDER ?? '').trim().toLowerCase();
  const candidates = [preferred];
  if (['relay', 'openai', 'elevenlabs'].includes(explicitFallback) && explicitFallback !== preferred) {
    candidates.push(explicitFallback);
  }
  candidates.push(...(preferred === 'elevenlabs' ? ['openai'] : preferred === 'openai' ? ['elevenlabs'] : ['openai', 'elevenlabs']));
  return [...new Set(candidates)].filter((provider, index) => index === 0 || providerConfigured(provider, env));
}

function resolveModel(provider, env = process.env) {
  if (provider === 'elevenlabs') {
    return optional('ELEVENLABS_MODEL_ID', env) ||
      (preferredProvider(env) === 'elevenlabs' ? optional('VOICE_TTS_MODEL', env) : null) ||
      'eleven_multilingual_v2';
  }
  if (provider === 'openai') {
    return optional('OPENAI_TTS_MODEL', env) ||
      (preferredProvider(env) === 'openai' ? optional('VOICE_TTS_MODEL', env) : null) ||
      'gpt-4o-mini-tts';
  }
  return optional('VOICE_TTS_MODEL', env) || 'gpt-4o-mini-tts';
}

function resolveVoice(provider, env = process.env) {
  if (provider === 'elevenlabs') {
    return optional('ELEVENLABS_VOICE_ID', env) ||
      (preferredProvider(env) === 'elevenlabs' ? optional('VOICE_TTS_VOICE', env) : null) ||
      '21m00Tcm4TlvDq8ikWAM';
  }
  if (provider === 'openai') {
    return optional('OPENAI_TTS_VOICE', env) ||
      (preferredProvider(env) === 'openai' ? optional('VOICE_TTS_VOICE', env) : null) ||
      'coral';
  }
  return optional('VOICE_TTS_VOICE', env) || 'coral';
}

function safeProviderCode(value) {
  const code = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9_.-]{1,80}$/.test(code) ? code : null;
}

function timeoutMs(env = process.env) {
  const raw = Number(env.VOICE_TTS_TIMEOUT_MS ?? env.ELEVENLABS_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

async function fetchWithTimeout(fetchImpl, url, init, env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(env));
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function failedAttempt(response, provider, credentialEnv) {
  let body = {};
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = {};
  }
  const detail = body && typeof body.detail === 'object' ? body.detail : {};
  const error = body && typeof body.error === 'object' ? body.error : {};
  const providerCode = safeProviderCode(detail.status ?? detail.code ?? error.code ?? error.type ?? body.code ?? body.type);
  const credentialReplacementRequired = response.status === 401;
  const errorType = credentialReplacementRequired
    ? 'invalid_credential'
    : response.status === 403
      ? 'authorization_failed'
      : response.status === 402
        ? 'quota_exceeded'
        : response.status === 429
          ? 'rate_limited'
          : 'provider_http_error';
  return {
    provider,
    ok: false,
    errorType,
    httpStatus: response.status,
    ...(providerCode ? { providerCode } : {}),
    credentialReplacementRequired,
    ...(credentialReplacementRequired ? { credentialEnv } : {}),
  };
}

async function generateWithProvider(provider, text, env, fetchImpl) {
  if (provider === 'elevenlabs') {
    const key = optional('ELEVENLABS_API_KEY', env);
    if (!key) return { attempt: { provider, ok: false, errorType: 'missing_api_key' } };
    const res = await fetchWithTimeout(
      fetchImpl,
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolveVoice(provider, env))}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': key, accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: resolveModel(provider, env),
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
      env,
    );
    if (!res.ok) return { attempt: await failedAttempt(res, provider, 'ELEVENLABS_API_KEY') };
    return { provider, format: 'mp3', bytes: Buffer.from(await res.arrayBuffer()), attempt: { provider, ok: true } };
  }

  const relay = provider === 'relay';
  const baseUrl = relay
    ? optional('VOICE_TTS_BASE_URL', env)?.replace(/\/+$/, '')
    : String(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = relay
    ? optional('VOICE_TTS_RELAY_TOKEN', env) || optional('VOICE_TTS_API_KEY', env) || optional('OPENAI_API_KEY', env)
    : optional('VOICE_TTS_API_KEY', env) || optional('OPENAI_API_KEY', env);
  const credentialEnv = relay
    ? optional('VOICE_TTS_RELAY_TOKEN', env)
      ? 'VOICE_TTS_RELAY_TOKEN'
      : optional('VOICE_TTS_API_KEY', env)
        ? 'VOICE_TTS_API_KEY'
        : 'OPENAI_API_KEY'
    : optional('VOICE_TTS_API_KEY', env)
      ? 'VOICE_TTS_API_KEY'
      : 'OPENAI_API_KEY';
  if (!baseUrl || !key) return { attempt: { provider, ok: false, errorType: 'missing_api_key' } };
  const format = provider === 'openai'
    ? optional('OPENAI_TTS_RESPONSE_FORMAT', env) || optional('VOICE_TTS_RESPONSE_FORMAT', env) || 'opus'
    : optional('VOICE_TTS_RESPONSE_FORMAT', env) || 'opus';
  const res = await fetchWithTimeout(fetchImpl, `${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, accept: 'audio/*' },
    body: JSON.stringify({
      model: resolveModel(provider, env),
      voice: resolveVoice(provider, env),
      input: text,
      response_format: format,
      speed: Number(env.VOICE_TTS_SPEED ?? '1') || 1,
      instructions: optional('VOICE_TTS_INSTRUCTIONS', env) || undefined,
    }),
  }, env);
  if (!res.ok) return { attempt: await failedAttempt(res, provider, credentialEnv) };
  return { provider, format, bytes: Buffer.from(await res.arrayBuffer()), attempt: { provider, ok: true } };
}

export async function generateTts({ env = process.env, fetchImpl = fetch } = {}) {
  const text = String(env.COMM_VOICE_PROBE_TEXT ?? 'Проверка голосового канала ASI. Связь работает.').trim();
  if (!text) throw Object.assign(new Error('COMM_VOICE_PROBE_TEXT is empty'), { stage: 'tts_generation' });
  const attempts = [];
  const providers = configuredProviderOrder(env);

  for (const [index, provider] of providers.entries()) {
    try {
      const result = await generateWithProvider(provider, text, env, fetchImpl);
      attempts.push(result.attempt);
      if (result.bytes?.length) {
        return { ...result, attempts, fallbackUsed: index > 0 };
      }
    } catch (error) {
      attempts.push({
        provider,
        ok: false,
        errorType: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
      });
    }
  }

  const error = new Error('All configured TTS providers failed');
  error.stage = 'tts_generation';
  error.diagnostic = { attempts };
  throw error;
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
    if (result.status !== 0 || !fs.existsSync(dst)) throw new Error('ffmpeg conversion failed');
    return fs.readFileSync(dst);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function sendVoice(chatId, oggBytes, env, fetchImpl) {
  const token = optional('TELEGRAM_BOT_TOKEN', env);
  if (!token) throw new Error('Missing required env TELEGRAM_BOT_TOKEN');
  const blob = new Blob([new Uint8Array(oggBytes)], { type: 'audio/ogg' });
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('voice', blob, 'asi-communication-probe.ogg');
  const res = await fetchWithTimeout(
    fetchImpl,
    `https://api.telegram.org/bot${token}/sendVoice`,
    { method: 'POST', body: form },
    env,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const error = new Error('Telegram sendVoice failed');
    error.diagnostic = { httpStatus: res.status, telegramOk: Boolean(json?.ok) };
    throw error;
  }
  return {
    messageId: json?.result?.message_id ?? null,
    duration: json?.result?.voice?.duration ?? null,
    fileSize: json?.result?.voice?.file_size ?? null,
  };
}

function operatorActions(attempts) {
  return attempts
    .filter((attempt) => attempt.credentialReplacementRequired && attempt.credentialEnv)
    .map((attempt) => ({
      provider: attempt.provider,
      action: 'replace_production_credential',
      secretEnv: attempt.credentialEnv,
    }));
}

export async function runVoiceAcceptance({
  env = process.env,
  fetchImpl = fetch,
  convertAudio = toOgg,
} = {}) {
  const stages = [];
  let chatId;
  try {
    chatId = optional('COMM_VOICE_PROBE_CHAT_ID', env)
      ? normalizeTelegramTestChatId(env.COMM_VOICE_PROBE_CHAT_ID)
      : resolveTelegramTestChatId(env);
  } catch (error) {
    if (!(error instanceof TestChatConfigurationError)) throw error;
    return { pass: false, failedStage: 'configuration', stages, errorType: error.code };
  }

  let generated;
  try {
    generated = await generateTts({ env, fetchImpl });
    stages.push({ stage: 'tts_generation', pass: true, provider: generated.provider, fallbackUsed: generated.fallbackUsed });
  } catch (error) {
    const diagnostic = error?.diagnostic ?? {};
    stages.push({ stage: 'tts_generation', pass: false, ...diagnostic });
    return {
      pass: false,
      failedStage: 'tts_generation',
      stages,
      operatorActions: operatorActions(diagnostic.attempts ?? []),
    };
  }

  let ogg;
  try {
    ogg = convertAudio(generated);
    if (!ogg?.length) throw new Error('empty_ogg');
    stages.push({ stage: 'audio_conversion', pass: true, oggBytes: ogg.length });
  } catch {
    stages.push({ stage: 'audio_conversion', pass: false, errorType: 'audio_conversion_failed' });
    return { pass: false, failedStage: 'audio_conversion', stages, operatorActions: operatorActions(generated.attempts) };
  }

  try {
    const delivered = await sendVoice(chatId, ogg, env, fetchImpl);
    stages.push({ stage: 'telegram_send_voice', pass: true, ...delivered });
  } catch (error) {
    stages.push({ stage: 'telegram_send_voice', pass: false, ...(error?.diagnostic ?? { errorType: 'telegram_send_failed' }) });
    return { pass: false, failedStage: 'telegram_send_voice', stages, operatorActions: operatorActions(generated.attempts) };
  }

  const actions = operatorActions(generated.attempts);
  return {
    pass: true,
    degraded: generated.fallbackUsed || actions.length > 0,
    provider: generated.provider,
    fallbackUsed: generated.fallbackUsed,
    generatedBytes: generated.bytes.length,
    stages,
    attempts: generated.attempts,
    operatorActions: actions,
  };
}

async function main() {
  const result = await runVoiceAcceptance();
  for (const action of result.operatorActions ?? []) {
    console.log(`::warning::${action.provider} credential failed authentication; replace production secret ${action.secretEnv}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ pass: false, failedStage: 'unexpected', errorType: error instanceof Error ? error.name : 'unknown' }));
    process.exit(1);
  });
}
