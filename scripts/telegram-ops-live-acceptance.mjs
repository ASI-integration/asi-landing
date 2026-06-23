#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_TELEGRAM_OPS_ACCEPTANCE';
const RUNNER_TS = resolve(__dirname, 'telegram-ops-live-acceptance.runner.ts');
const ENV_FILE = resolve(ROOT, '.env.local');

function printFail(message, error) {
  console.error(`[telegram-ops-acceptance] FAIL: ${message}`);
  if (error instanceof Error) {
    if (error.message && error.message !== message) {
      console.error(`[telegram-ops-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
  } else if (error !== undefined) {
    console.error(`[telegram-ops-acceptance] error: ${String(error)}`);
  }
}

function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function loadDotEnvLocal() {
  if (!existsSync(ENV_FILE)) {
    return { loaded: false, missingFile: true };
  }

  for (const [key, value] of Object.entries(loadEnvFile(ENV_FILE))) {
    if (!process.env[key]) process.env[key] = value;
  }
  return { loaded: true, missingFile: false };
}

function getMissingEnvNames() {
  const missing = [];
  const hasUrl = Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim());
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!hasUrl) {
    missing.push('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!hasKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!process.env.INTERNAL_TEST_SECRET?.trim()) {
    missing.push('INTERNAL_TEST_SECRET');
  }
  const hasTelegramToken = Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() || process.env.TELEGRAM_SMOKE_BOT_TOKEN?.trim(),
  );
  if (!hasTelegramToken) {
    missing.push('TELEGRAM_BOT_TOKEN', 'TELEGRAM_SMOKE_BOT_TOKEN');
  }
  if (!process.env.TELEGRAM_TEST_CHAT_ID?.trim()) {
    missing.push('TELEGRAM_TEST_CHAT_ID');
  }
  return missing;
}

function getSupabaseHostForLog() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url?.trim()) return '(missing)';
  try {
    return new URL(url).host;
  } catch {
    return '(invalid url)';
  }
}

function ensureEnv(dotenvState) {
  const missing = getMissingEnvNames();
  if (missing.length === 0) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const base = String(url)
      .replace(/\/$/, '')
      .replace(/\/rest\/v1$/, '');
    process.env.SUPABASE_URL = base;
    process.env.NEXT_PUBLIC_SUPABASE_URL = base;
    console.info('[telegram-ops-acceptance] supabase_host:', getSupabaseHostForLog());
    return;
  }

  console.error('[telegram-ops-acceptance] FAIL: missing required configuration.');
  if (dotenvState.missingFile) {
    console.error(`[telegram-ops-acceptance] missing file: .env.local (${ENV_FILE})`);
  }
  console.error(`[telegram-ops-acceptance] missing env: ${missing.join(', ')}`);
  process.exit(1);
}

function runWithTsx(runnerPath) {
  return spawnSync('npx', ['--yes', 'tsx', runnerPath], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
}

function reportRunnerResult(result) {
  if (result.error) {
    printFail('failed to start acceptance runner (tsx)', result.error);
    process.exit(1);
  }

  const code = result.status ?? 1;
  if (code === 0) {
    console.log('[telegram-ops-acceptance] PASS');
    process.exit(0);
  }

  console.error(`[telegram-ops-acceptance] FAIL: runner exited with code ${code}`);
  if (result.signal) {
    console.error(`[telegram-ops-acceptance] signal: ${result.signal}`);
  }
  process.exit(code);
}

function main() {
  try {
    const confirm = process.env.TELEGRAM_OPS_ACCEPTANCE_CONFIRM?.trim();
    if (confirm !== REQUIRED_CONFIRM) {
      console.log(
        `[telegram-ops-acceptance] SKIPPED: set TELEGRAM_OPS_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM} to run live acceptance.`,
      );
      console.log('[telegram-ops-acceptance] Manual live checklist:');
      console.log('  1. Send test message in Telegram test chat: «У гостя проблема, срочно нужен оператор»');
      console.log('  2. Confirm pending escalation review on server (operator queue)');
      console.log('  3. Open /dashboard/ops → Активные → task source «Коммуникации», type «Проблема»');
      console.log('  4. Готово → Завершённые → Вернуть в работу');
      process.exit(0);
    }

    const dotenvState = loadDotEnvLocal();
    ensureEnv(dotenvState);

    const result = runWithTsx(RUNNER_TS);
    reportRunnerResult(result);
  } catch (error) {
    printFail('unexpected error in acceptance launcher', error);
    process.exit(1);
  }
}

main();
