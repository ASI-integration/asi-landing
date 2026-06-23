#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_TELEGRAM_OPS_ACCEPTANCE';
const DEFAULT_BASE_URL = 'https://asi-global.ru';

const ENV_CANDIDATES = [
  resolve(ROOT, '.env.local'),
  resolve(ROOT, '.env.production.live'),
  '/var/www/asi/shared/.env.production.live',
];

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

function loadAcceptanceEnv() {
  const loadedPaths = [];
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue;
    loadedPaths.push(path);
    for (const [key, value] of Object.entries(loadEnvFile(path))) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
  return { loadedPaths };
}

function getMissingEnvNames() {
  const missing = [];
  if (!process.env.INTERNAL_TEST_SECRET?.trim()) {
    missing.push('INTERNAL_TEST_SECRET');
  }
  return missing;
}

function printManualChecklist() {
  console.log('[telegram-ops-acceptance] Manual live checklist:');
  console.log('  1. Send test message in Telegram test chat: «У гостя проблема, срочно нужен оператор»');
  console.log('  2. Confirm pending escalation review on server (operator queue)');
  console.log('  3. Open /dashboard/ops → Активные → task source «Коммуникации», type «Проблема»');
  console.log('  4. Готово → Завершённые → Вернуть в работу');
}

async function callInternalRun(baseUrl, secret) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/internal/telegram-ops-acceptance`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-test-secret': secret,
    },
    body: JSON.stringify({ action: 'run' }),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`invalid internal API JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  if (response.status === 403) {
    throw new Error('internal API forbidden: check INTERNAL_TEST_SECRET on production');
  }

  return { httpStatus: response.status, json };
}

async function main() {
  try {
    const mode = process.env.TELEGRAM_OPS_ACCEPTANCE_MODE?.trim().toLowerCase() ?? 'automated';
    const confirm = process.env.TELEGRAM_OPS_ACCEPTANCE_CONFIRM?.trim();

    if (mode === 'manual') {
      printManualChecklist();
      process.exit(0);
    }

    if (confirm !== REQUIRED_CONFIRM) {
      console.log(
        `[telegram-ops-acceptance] SKIPPED: set TELEGRAM_OPS_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM} to run live acceptance.`,
      );
      printManualChecklist();
      console.log('[telegram-ops-acceptance] For manual-only mode: TELEGRAM_OPS_ACCEPTANCE_MODE=manual');
      process.exit(0);
    }

    const envState = loadAcceptanceEnv();
    const missing = getMissingEnvNames();
    if (missing.length > 0) {
      console.error('[telegram-ops-acceptance] FAIL: missing required configuration.');
      if (envState.loadedPaths.length === 0) {
        console.error('[telegram-ops-acceptance] no env files found. Checked:');
        for (const path of ENV_CANDIDATES) {
          console.error(`  - ${path}`);
        }
      } else {
        console.error(`[telegram-ops-acceptance] loaded env from: ${envState.loadedPaths.join(', ')}`);
      }
      console.error(`[telegram-ops-acceptance] missing env: ${missing.join(', ')}`);
      process.exit(1);
    }

    const baseUrl = process.env.ACCEPTANCE_BASE_URL?.trim()
      || process.env.PRODUCTION_URL?.trim()
      || DEFAULT_BASE_URL;
    const secret = process.env.INTERNAL_TEST_SECRET.trim();

    console.info('[telegram-ops-acceptance] mode: automated (synthetic update via internal API, no getUpdates)');
    console.info('[telegram-ops-acceptance] baseUrl:', baseUrl);
    if (envState.loadedPaths.length > 0) {
      console.info('[telegram-ops-acceptance] env:', envState.loadedPaths.join(', '));
    }

    const { httpStatus, json } = await callInternalRun(baseUrl, secret);

    if (json.firstSync) {
      console.info('[telegram-ops-acceptance] first sync', json.firstSync);
    }
    if (json.secondSync) {
      console.info('[telegram-ops-acceptance] second sync', json.secondSync);
    }
    if (json.processOutcome) {
      console.info('[telegram-ops-acceptance] processOutcome:', json.processOutcome);
    }

    if (json.ok) {
      console.log('[telegram-ops-acceptance] PASS');
      process.exit(0);
    }

    console.error(`[telegram-ops-acceptance] FAIL (http ${httpStatus})`);
    for (const item of json.failures ?? [json.error ?? 'unknown failure']) {
      console.error('  -', item);
    }
    process.exit(1);
  } catch (error) {
    printFail('acceptance failed', error);
    process.exit(1);
  }
}

main();
