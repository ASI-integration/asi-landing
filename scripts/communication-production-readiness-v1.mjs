#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function truthy(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function present(name) {
  return Boolean(String(process.env[name] ?? '').trim());
}

function safeProvider(value, fallback) {
  const raw = String(value ?? fallback).trim().toLowerCase();
  return raw || fallback;
}

function hasFfmpeg() {
  try {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveLlm() {
  const enabled = truthy(process.env.LLM_SAFE_DOMAIN_ENABLED) || truthy(process.env.GUEST_CONCIERGE_LLM_ENABLED);
  const provider = safeProvider(process.env.LLM_SAFE_DOMAIN_PROVIDER ?? process.env.LLM_ROUTER_PROVIDER, 'openai');
  const hasKey = provider === 'deepseek'
    ? present('DEEPSEEK_API_KEY')
    : present('OPENAI_API_KEY') || present('LLM_API_KEY');
  return {
    enabled,
    provider,
    hasKey,
    modelPresent: present('LLM_SAFE_DOMAIN_MODEL') || present('GUEST_CONCIERGE_LLM_MODEL') || present('OPENAI_MODEL') || present('DEEPSEEK_MODEL'),
    configured: enabled && hasKey,
  };
}

function resolveStt() {
  const disabled = truthy(process.env.VOICE_TRANSCRIPTION_DISABLED);
  const relayConfigured = present('VOICE_STT_BASE_URL') && (present('VOICE_STT_RELAY_TOKEN') || present('VOICE_STT_API_KEY') || present('OPENAI_API_KEY'));
  const directConfigured = present('OPENAI_API_KEY') || present('LLM_API_KEY') || (present('LLM_FALLBACK_BASE_URL') && present('LLM_FALLBACK_API_KEY'));
  return {
    disabled,
    telegramTokenPresent: present('TELEGRAM_BOT_TOKEN'),
    relayConfigured,
    directConfigured,
    modelPresent: present('VOICE_STT_MODEL'),
    primary: String(process.env.VOICE_STT_PRIMARY ?? '').trim() || null,
    fallback: String(process.env.VOICE_STT_FALLBACK ?? '').trim() || null,
    configured: !disabled && present('TELEGRAM_BOT_TOKEN') && (relayConfigured || directConfigured),
  };
}

function resolveTts() {
  const provider = present('VOICE_TTS_BASE_URL')
    ? 'relay'
    : safeProvider(process.env.VOICE_TTS_PROVIDER, 'openai');
  const configured = {
    relay: present('VOICE_TTS_BASE_URL') && (present('VOICE_TTS_RELAY_TOKEN') || present('VOICE_TTS_API_KEY') || present('OPENAI_API_KEY')),
    openai: present('OPENAI_API_KEY') || present('VOICE_TTS_API_KEY'),
    elevenlabs: present('ELEVENLABS_API_KEY'),
  };
  const hasKey = Boolean(configured[provider]);
  const fallbackProviders = provider === 'elevenlabs'
    ? configured.openai ? ['openai'] : []
    : provider === 'openai'
      ? configured.elevenlabs ? ['elevenlabs'] : []
      : [configured.openai ? 'openai' : null, configured.elevenlabs ? 'elevenlabs' : null].filter(Boolean);
  return {
    provider,
    hasKey,
    fallbackProviders,
    modelPresent: present('VOICE_TTS_MODEL'),
    voicePresent: present('VOICE_TTS_VOICE') || present('ELEVENLABS_VOICE_ID'),
    responseFormat: String(process.env.VOICE_TTS_RESPONSE_FORMAT ?? 'opus').trim() || 'opus',
    configured: hasKey || fallbackProviders.length > 0,
  };
}

async function telegramProbe() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return { attempted: false, ok: false, reason: 'missing_token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    return {
      attempted: true,
      ok: Boolean(res.ok && json?.ok),
      httpStatus: res.status,
      botUsername: json?.result?.username ?? null,
    };
  } catch (error) {
    return { attempted: true, ok: false, reason: error instanceof Error ? error.name : 'network' };
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const llm = resolveLlm();
  const stt = resolveStt();
  const tts = resolveTts();
  const telegram = {
    tokenPresent: present('TELEGRAM_BOT_TOKEN'),
    testChatIdPresent: present('TELEGRAM_TEST_CHAT_ID') || present('TELEGRAM_AUTOPILOT_TEST_CHAT_ID'),
    outboundDryRun: truthy(process.env.DRY_RUN_TELEGRAM_OUTBOUND) || truthy(process.env.TELEGRAM_DRY_RUN),
    protectedChatOverride: truthy(process.env.ALLOW_REAL_TELEGRAM_SYNTHETIC),
  };
  const autopilot = {
    killSwitch: truthy(process.env.COMMUNICATION_KILL_SWITCH),
    forceDisabled: truthy(process.env.COMMUNICATION_AUTOPILOT_FORCE_DISABLED),
    forceEnabled: truthy(process.env.COMMUNICATION_AUTOPILOT_FORCE_ENABLED),
  };
  const voice = {
    replyEnabled: truthy(process.env.VOICE_REPLY_ENABLED),
    ffmpegPresent: hasFfmpeg(),
    stateDirPresent: present('SESSION_STORE_DIR') || present('COMM_STATE_DIR') || present('CONVERSATION_SESSION_DIR') || present('STATE_DIR'),
  };

  const activationPrerequisitesMet = Boolean(
    telegram.tokenPresent &&
    llm.hasKey &&
    stt.configured &&
    tts.configured &&
    voice.ffmpegPresent
  );
  const active = Boolean(
    activationPrerequisitesMet &&
    llm.enabled &&
    voice.replyEnabled &&
    !autopilot.killSwitch &&
    !autopilot.forceDisabled &&
    !telegram.outboundDryRun
  );

  const report = {
    schemaVersion: 1,
    activationPrerequisitesMet,
    active,
    llm,
    stt,
    tts,
    telegram,
    autopilot,
    voice,
    network: args.has('--probe-network') ? { telegram: await telegramProbe() } : { telegram: { attempted: false } },
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.has('--require-prereqs') && !activationPrerequisitesMet) process.exitCode = 2;
  if (args.has('--require-active') && !active) process.exitCode = 3;
  if (args.has('--probe-network') && report.network.telegram.attempted && !report.network.telegram.ok) process.exitCode = 4;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
