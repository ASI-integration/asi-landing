#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_PILOT_READINESS_ACCEPTANCE';
const RUNNER_TS = resolve(__dirname, 'pilot-readiness-live-acceptance.runner.ts');

const ENV_CANDIDATES = [
  resolve(ROOT, '.env.local'),
  resolve(ROOT, '.env.production.live'),
  '/var/www/asi/shared/.env.production.live',
];

function printFail(message, error) {
  console.error(`[pilot-readiness-acceptance] FAIL: ${message}`);
  if (error instanceof Error) {
    if (error.message && error.message !== message) {
      console.error(`[pilot-readiness-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
  } else if (error !== undefined) {
    console.error(`[pilot-readiness-acceptance] error: ${String(error)}`);
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
  if (!hasUrl) missing.push('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  if (!hasKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.INTERNAL_TEST_SECRET?.trim()) missing.push('INTERNAL_TEST_SECRET');
  return missing;
}

function runWithTsx(runnerPath) {
  return spawnSync('npx', ['--yes', 'tsx', runnerPath], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
    shell: process.platform === 'win32',
  });
}

function main() {
  if (process.env.PILOT_READINESS_ACCEPTANCE_CONFIRM !== REQUIRED_CONFIRM) {
    console.error(`[pilot-readiness-acceptance] FAIL: set PILOT_READINESS_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM}`);
    process.exit(1);
  }

  const { loadedPaths } = loadAcceptanceEnv();
  const missing = getMissingEnvNames();
  if (missing.length > 0) {
    printFail('missing required configuration', new Error(`missing env: ${missing.join(', ')}`));
    if (loadedPaths.length === 0) {
      console.error('[pilot-readiness-acceptance] no env files loaded from candidates');
    } else {
      console.error(`[pilot-readiness-acceptance] loaded env from: ${loadedPaths.join(', ')}`);
    }
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const base = String(url).replace(/\/$/, '').replace(/\/rest\/v1$/, '');
  process.env.SUPABASE_URL = base;
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;

  const result = runWithTsx(RUNNER_TS);
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log('[pilot-readiness-acceptance] PASS');
}

try {
  main();
} catch (error) {
  printFail('unexpected runner error', error);
  process.exit(1);
}
