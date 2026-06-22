#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_OPS_ACCEPTANCE';
const RUNNER_TS = resolve(__dirname, 'ops-v12-live-acceptance.runner.ts');
const ENV_FILE = resolve(ROOT, '.env.local');

function printFail(message, error) {
  console.error(`[ops-v12-acceptance] FAIL: ${message}`);
  if (error instanceof Error) {
    if (error.message && error.message !== message) {
      console.error(`[ops-v12-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
  } else if (error !== undefined) {
    console.error(`[ops-v12-acceptance] error: ${String(error)}`);
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

function getMissingSupabaseEnvNames() {
  const missing = [];
  const hasUrl = Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim());
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!hasUrl) {
    missing.push('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!hasKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  return missing;
}

function ensureSupabaseEnv(dotenvState) {
  const missing = getMissingSupabaseEnvNames();
  if (missing.length === 0) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const base = String(url)
      .replace(/\/$/, '')
      .replace(/\/rest\/v1$/, '');
    process.env.SUPABASE_URL = base;
    process.env.NEXT_PUBLIC_SUPABASE_URL = base;
    return;
  }

  console.error('[ops-v12-acceptance] FAIL: missing required configuration.');
  if (dotenvState.missingFile) {
    console.error(`[ops-v12-acceptance] missing file: .env.local (${ENV_FILE})`);
  }
  console.error(`[ops-v12-acceptance] missing env: ${missing.join(', ')}`);
  console.error('[ops-v12-acceptance] need at least one of SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
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
    console.log('[ops-v12-acceptance] PASS');
    process.exit(0);
  }

  console.error(`[ops-v12-acceptance] FAIL: runner exited with code ${code}`);
  if (result.signal) {
    console.error(`[ops-v12-acceptance] signal: ${result.signal}`);
  }
  process.exit(code);
}

function main() {
  try {
    const confirm = process.env.OPS_ACCEPTANCE_CONFIRM?.trim();
    if (confirm !== REQUIRED_CONFIRM) {
      console.log(
        `[ops-v12-acceptance] SKIPPED: no changes. Set OPS_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM} to run live acceptance.`,
      );
      process.exit(0);
    }

    const dotenvState = loadDotEnvLocal();
    ensureSupabaseEnv(dotenvState);

    const result = runWithTsx(RUNNER_TS);
    reportRunnerResult(result);
  } catch (error) {
    printFail('unexpected error in acceptance launcher', error);
    process.exit(1);
  }
}

main();
