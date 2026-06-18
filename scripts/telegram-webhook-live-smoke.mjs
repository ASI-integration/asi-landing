#!/usr/bin/env node
/**
 * Production-safe Telegram webhook diagnostics.
 *
 * Checks:
 * 1. Public /api/version reachability
 * 2. Webhook endpoint reachability (with optional secret)
 * 3. Internal handler on synthetic /start update
 * 4. Telegram getWebhookInfo for operational + ASI Feedback bots (when tokens present)
 * 5. Optional real sendMessage when TELEGRAM_TEST_CHAT_ID is set
 *
 * Exit 0 only when internal webhook logic PASS and delivery/path checks PASS.
 */

const DEFAULT_BASE_URL = (process.env.SMOKE_BASE_URL || process.env.PILOT_SMOKE_BASE_URL || 'https://asi-global.ru')
  .trim()
  .replace(/\/$/, '');

const WEBHOOK_PATH = '/api/telegram/webhook';

function readEnv(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function pass(label, detail = '') {
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.warn(`WARN  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, raw: text };
  }
  return { status: res.status, json };
}

function buildStartUpdate() {
  const updateId = Number(process.env.TELEGRAM_SMOKE_UPDATE_ID || Date.now());
  const chatId = Number(process.env.TELEGRAM_TEST_CHAT_ID || '999000001');
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      from: { id: chatId, first_name: 'Smoke', is_bot: false },
      chat: { id: chatId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: '/start',
    },
  };
}

function webhookHeaders() {
  const headers = { 'content-type': 'application/json' };
  const feedbackSecret = readEnv('ASI_FEEDBACK_WEBHOOK_SECRET');
  const operationalSecret = readEnv('TELEGRAM_WEBHOOK_SECRET');
  const secret = readEnv('TELEGRAM_SMOKE_WEBHOOK_SECRET') || feedbackSecret || operationalSecret;
  if (secret) headers['x-telegram-bot-api-secret-token'] = secret;
  return headers;
}

function isExpectedWebhookUrl(url) {
  const value = String(url || '').trim();
  return value.includes('asi-global.ru') && value.endsWith(WEBHOOK_PATH);
}

async function checkVersion() {
  section('Version');
  const { status, json } = await fetchJson(`${DEFAULT_BASE_URL}/api/version`);
  if (status !== 200 || !json?.sha) {
    fail('GET /api/version', `http ${status}`);
    return false;
  }
  pass('GET /api/version', `sha=${json.sha}`);
  return true;
}

async function checkWebhookReachability() {
  section('Webhook endpoint');
  const headers = webhookHeaders();
  const hasSecret = Boolean(headers['x-telegram-bot-api-secret-token']);
  const body = buildStartUpdate();
  const { status, json } = await fetchJson(`${DEFAULT_BASE_URL}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!hasSecret) {
    warn('No webhook secret in smoke env', 'expect 403 if production secrets are configured');
  }

  if (status === 403) {
    fail('POST /api/telegram/webhook', '403 forbidden — webhook secret mismatch');
    return { ok: false, internalLogicPass: false, pathPass: false };
  }
  if (status !== 200 || json?.ok !== true) {
    fail('POST /api/telegram/webhook', `http ${status} body=${JSON.stringify(json)}`);
    return { ok: false, internalLogicPass: false, pathPass: false };
  }

  pass('POST /api/telegram/webhook', `path=${json.path ?? 'ok'}`);
  const internalLogicPass = true;
  const pathPass = status === 200;
  return { ok: true, internalLogicPass, pathPass, path: json.path ?? 'ok' };
}

async function checkTelegramWebhookInfo(label, token, expectedSecretPresent) {
  if (!token) {
    warn(`${label} getWebhookInfo skipped`, 'token not in env');
    return { ok: true, skipped: true };
  }

  const me = await tgCall(token, 'getMe');
  const wh = await tgCall(token, 'getWebhookInfo');
  const username = me.json?.result?.username;
  const url = wh.json?.result?.url;
  const lastError = wh.json?.result?.last_error_message;

  console.log(
    JSON.stringify(
      {
        label,
        bot_username: username ?? null,
        webhook_url: url ?? null,
        pending_update_count: wh.json?.result?.pending_update_count ?? null,
        last_error_message: lastError ?? null,
      },
      null,
      2,
    ),
  );

  if (!wh.json?.ok) {
    fail(`${label} getWebhookInfo`, wh.json?.description || 'not ok');
    return { ok: false };
  }
  if (!isExpectedWebhookUrl(url)) {
    fail(`${label} webhook URL`, url || 'empty');
    return { ok: false };
  }
  if (lastError) {
    fail(`${label} webhook delivery`, lastError);
    return { ok: false };
  }
  pass(`${label} webhook URL`, url);
  if (expectedSecretPresent) {
    pass(`${label} webhook secret`, 'env secret present (header required on POST)');
  } else {
    warn(`${label} webhook secret`, 'no env secret — Telegram may post without header');
  }
  return { ok: true };
}

async function checkRealTelegramDelivery() {
  section('Real Telegram delivery (optional)');
  const token = readEnv('ASI_FEEDBACK_BOT_TOKEN') || readEnv('TELEGRAM_BOT_TOKEN');
  const chatId = readEnv('TELEGRAM_TEST_CHAT_ID');
  if (!token || !chatId) {
    warn('Real delivery check skipped', 'set ASI_FEEDBACK_BOT_TOKEN + TELEGRAM_TEST_CHAT_ID');
    return { ok: true, skipped: true };
  }

  const probe = `asi smoke ${new Date().toISOString()}`;
  const sent = await tgCall(token, 'sendMessage', { chat_id: chatId, text: probe });
  if (!sent.json?.ok) {
    fail('Telegram sendMessage', sent.json?.description || `http ${sent.status}`);
    return { ok: false };
  }
  pass('Telegram sendMessage', `chat_id=${chatId}`);
  return { ok: true };
}

async function main() {
  console.log(`Telegram live smoke — base URL: ${DEFAULT_BASE_URL}`);
  let allOk = true;

  if (!(await checkVersion())) allOk = false;

  const webhook = await checkWebhookReachability();
  if (!webhook.ok) allOk = false;

  section('Telegram getWebhookInfo');
  const operational = await checkTelegramWebhookInfo(
    'operational',
    readEnv('TELEGRAM_BOT_TOKEN'),
    Boolean(readEnv('TELEGRAM_WEBHOOK_SECRET')),
  );
  const feedback = await checkTelegramWebhookInfo(
    'asi_feedback',
    readEnv('ASI_FEEDBACK_BOT_TOKEN'),
    Boolean(readEnv('ASI_FEEDBACK_WEBHOOK_SECRET')),
  );
  if (!operational.ok || !feedback.ok) allOk = false;

  const delivery = await checkRealTelegramDelivery();
  if (!delivery.ok) allOk = false;

  section('Summary');
  console.log(
    JSON.stringify(
      {
        internal_webhook_logic: webhook.internalLogicPass ? 'PASS' : 'FAIL',
        webhook_path: webhook.pathPass ? 'PASS' : 'FAIL',
        telegram_webhook_info: operational.ok && feedback.ok ? 'PASS' : 'FAIL',
        real_telegram_delivery: delivery.skipped ? 'SKIPPED' : delivery.ok ? 'PASS' : 'FAIL',
      },
      null,
      2,
    ),
  );

  if (!allOk) {
    process.exit(1);
  }
  pass('smoke:telegram-live', 'all required checks passed');
}

main().catch((error) => {
  console.error('smoke:telegram-live crashed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
