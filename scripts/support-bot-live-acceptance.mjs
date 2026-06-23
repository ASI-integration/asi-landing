#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_SUPPORT_BOT_ACCEPTANCE';
const RUNNER_TS = resolve(__dirname, 'support-bot-live-acceptance.runner.ts');

const ENV_CANDIDATES = [
  resolve(ROOT, '.env.local'),
  resolve(ROOT, '.env.production.live'),
  '/var/www/asi/shared/.env.production.live',
];

function printFail(message, error) {
  console.error(`[support-bot-acceptance] FAIL: ${message}`);
  if (error instanceof Error) {
    if (error.message && error.message !== message) {
      console.error(`[support-bot-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
  } else if (error !== undefined) {
    console.error(`[support-bot-acceptance] error: ${String(error)}`);
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
  const hasUrl = Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim());
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!hasUrl) missing.push('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  if (!hasKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

function main() {
  try {
    const confirm = process.env.SUPPORT_BOT_ACCEPTANCE_CONFIRM?.trim();
    if (confirm !== REQUIRED_CONFIRM) {
      console.log(
        `[support-bot-acceptance] SKIPPED: set SUPPORT_BOT_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM} to run acceptance.`,
      );
      process.exit(0);
    }

    const envState = loadAcceptanceEnv();
    const missing = getMissingEnvNames();
    if (missing.length > 0) {
      console.error('[support-bot-acceptance] FAIL: missing required configuration.');
      if (envState.loadedPaths.length === 0) {
        console.error('[support-bot-acceptance] no env files found. Checked:');
        for (const path of ENV_CANDIDATES) {
          console.error(`  - ${path}`);
        }
      } else {
        console.error(`[support-bot-acceptance] loaded env from: ${envState.loadedPaths.join(', ')}`);
      }
      console.error(`[support-bot-acceptance] missing env: ${missing.join(', ')}`);
      process.exit(1);
    }

    if (envState.loadedPaths.length > 0) {
      console.info('[support-bot-acceptance] env:', envState.loadedPaths.join(', '));
    }

    console.info('[support-bot-acceptance] mode: local runner (synthetic update, no getUpdates)');

    const result = spawnSync('npx', ['tsx', RUNNER_TS], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      console.log('[support-bot-acceptance] PASS');
      process.exit(0);
    }

    console.error('[support-bot-acceptance] FAIL');
    process.exit(result.status ?? 1);
  } catch (error) {
    printFail('acceptance failed', error);
    process.exit(1);
  }
}

main();
