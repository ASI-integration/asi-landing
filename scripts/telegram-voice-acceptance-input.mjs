#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MAX_AGE_MS = 20 * 60 * 1000;
export const STATE_FILE_NAME = 'telegram-voice-acceptance-v1.json';

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0) return argv[index + 1] ?? '';
  const prefixed = argv.find((value) => value.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : '';
}

function chatHash(chatId) {
  return createHash('sha256').update(`asi.telegram.test-chat.v1:${String(chatId).trim()}`).digest('hex');
}

export function defaultVoiceAcceptanceStateFile(env = process.env, cwd = process.cwd()) {
  const stateDir = String(
    env.COMM_STATE_DIR ?? env.SESSION_STORE_DIR ?? env.CONVERSATION_SESSION_DIR ?? env.STATE_DIR ?? '',
  ).trim() || path.join(cwd, '.asi-comm-state');
  return path.join(stateDir, STATE_FILE_NAME);
}

export function resolveInboundSttFileId({
  explicitFileId = '',
  testChatId,
  stateFile,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  nowMs = Date.now(),
  readState = (file) => readFileSync(file, 'utf8'),
}) {
  const override = String(explicitFileId ?? '').trim();
  if (override) return { ok: true, source: 'explicit', fileId: override };

  const normalizedTestChatId = String(testChatId ?? '').trim();
  if (!normalizedTestChatId) return { ok: false, reason: 'test_chat_not_configured' };

  let evidence;
  try {
    evidence = JSON.parse(readState(stateFile));
  } catch {
    return { ok: false, reason: 'no_voice_evidence' };
  }

  if (
    evidence?.schemaVersion !== 'asi.telegram.voice.acceptance.v1' ||
    evidence?.chatIdHash !== chatHash(normalizedTestChatId)
  ) {
    return { ok: false, reason: 'no_matching_test_chat_voice' };
  }

  const messageDateMs = Date.parse(String(evidence.messageDate ?? ''));
  const ageMs = nowMs - messageDateMs;
  if (!Number.isFinite(messageDateMs) || ageMs < -2 * 60 * 1000 || ageMs > maxAgeMs) {
    return { ok: false, reason: 'stale_voice_evidence' };
  }

  const fileId = String(evidence.fileId ?? '').trim();
  if (!fileId) return { ok: false, reason: 'no_voice_evidence' };
  return { ok: true, source: 'test_chat_state', fileId };
}

export function inboundSttInputError(reason, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const minutes = Math.ceil(maxAgeMs / 60_000);
  return `Communication production acceptance failed at stage=inbound_stt_input: no fresh voice from configured TELEGRAM_TEST_CHAT_ID within ${minutes} minutes (reason=${reason}). Send a new voice note in that dedicated test chat to @ASI_core_bot, wait for the bot to process it, then rerun acceptance with stt_file_id empty.`;
}

function main() {
  const explicitFileId = argument('explicit-file-id');
  const testChatId = argument('test-chat-id') || process.env.TELEGRAM_TEST_CHAT_ID;
  const stateFile = argument('state-file') || defaultVoiceAcceptanceStateFile();
  const configuredMaxAgeSeconds = Number(argument('max-age-seconds') || '');
  const maxAgeMs = Number.isFinite(configuredMaxAgeSeconds) && configuredMaxAgeSeconds > 0
    ? configuredMaxAgeSeconds * 1000
    : DEFAULT_MAX_AGE_MS;
  const result = resolveInboundSttFileId({ explicitFileId, testChatId, stateFile, maxAgeMs });

  if (!result.ok) {
    console.error(`::error::${inboundSttInputError(result.reason, maxAgeMs)}`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(result.fileId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
