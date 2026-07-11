#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const cadenceMs = 5 * 60_000;
const endpoint = process.env.BOOKING_OPS_ALERT_RUNNER_URL?.trim() || 'http://127.0.0.1:3000/api/internal/booking-ops/alerts/run';
let running = false;

const ENV_CANDIDATES = [
  resolve(ROOT, '.env.production.local'),
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
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(loadEnvFile(path))) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();
const secret = process.env.BOOKING_OPS_ALERT_RUNNER_SECRET?.trim() || process.env.CRON_SECRET?.trim();

async function tick() {
  if (running) return;
  if (!secret) {
    console.error('[ops-alert-scheduler] runner secret is not configured');
    return;
  }
  running = true;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
    const payload = await response.json().catch(() => ({}));
    const result = payload && typeof payload === 'object' ? payload.result : null;
    console.info('[ops-alert-scheduler]', JSON.stringify({ ok: response.ok, status: response.status, runId: result?.runId, lockAcquired: result?.lockAcquired, evaluated: result?.evaluated, created: result?.alertsCreated, updated: result?.alertsUpdated, escalated: result?.alertsEscalated, resolved: result?.alertsResolved, skipped: result?.skipped, errors: Array.isArray(result?.errors) ? result.errors.length : undefined }));
  } catch {
    console.error('[ops-alert-scheduler]', JSON.stringify({ ok: false, error: 'request_failed' }));
  } finally {
    running = false;
  }
}

await tick();
const timer = setInterval(() => void tick(), cadenceMs);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); process.exit(0); });
