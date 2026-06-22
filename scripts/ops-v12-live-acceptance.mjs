#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_OPS_ACCEPTANCE';
const RUNNER_TS = resolve(__dirname, 'ops-v12-live-acceptance.runner.ts');

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

function ensureSupabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim() || !key?.trim()) {
    console.error(
      [
        '[ops-v12-acceptance] FAIL: Supabase env is not configured.',
        'Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
      ].join('\n'),
    );
    process.exit(1);
  }

  const base = String(url)
    .replace(/\/$/, '')
    .replace(/\/rest\/v1$/, '');
  process.env.SUPABASE_URL = base;
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;
}

function runWithTsx(runnerPath) {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(cmd, ['--yes', 'tsx', runnerPath], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
    cwd: ROOT,
  });
}

function main() {
  const confirm = process.env.OPS_ACCEPTANCE_CONFIRM?.trim();
  if (confirm !== REQUIRED_CONFIRM) {
    console.log(
      `[ops-v12-acceptance] SKIP: no changes. Set OPS_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM} to run live acceptance.`,
    );
    process.exit(0);
  }

  const envPath = resolve(ROOT, '.env.local');
  try {
    for (const [key, value] of Object.entries(loadEnvFile(envPath))) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local is optional when env vars are already exported.
  }

  ensureSupabaseEnv();

  const result = runWithTsx(RUNNER_TS);
  process.exit(result.status ?? 1);
}

main();
