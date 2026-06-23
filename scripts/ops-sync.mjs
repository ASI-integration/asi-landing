#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RUNNER_TS = resolve(__dirname, 'ops-sync.runner.ts');

const ENV_CANDIDATES = [
  resolve(ROOT, '.env.local'),
  resolve(ROOT, '.env.production.live'),
  '/var/www/asi/shared/.env.production.live',
];

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

function loadEnv() {
  const loadedPaths = [];
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue;
    loadedPaths.push(path);
    for (const [key, value] of Object.entries(loadEnvFile(path))) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
  return loadedPaths;
}

function main() {
  const loadedPaths = loadEnv();
  const hasUrl = Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim());
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!hasUrl || !hasKey) {
    console.error('[ops-sync] FAIL: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    if (loadedPaths.length > 0) {
      console.error(`[ops-sync] loaded env from: ${loadedPaths.join(', ')}`);
    }
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const base = String(url).replace(/\/$/, '').replace(/\/rest\/v1$/, '');
  process.env.SUPABASE_URL = base;
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;

  const result = spawnSync('npx', ['--yes', 'tsx', RUNNER_TS], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

main();
