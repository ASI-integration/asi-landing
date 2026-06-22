#!/usr/bin/env node

const ENDPOINT_PATH = '/api/internal/telegram-wizard-acceptance';
const DEFAULT_BASE_URL = 'https://asi-global.ru';
const DEFAULT_CHAT_ID = '99445001';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function baseUrl() {
  return (process.env.ACCEPTANCE_BASE_URL || process.env.PRODUCTION_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function testChatId() {
  return (
    process.env.WIZARD_ACCEPTANCE_CHAT_ID ||
    process.env.TELEGRAM_TEST_CHAT_ID ||
    DEFAULT_CHAT_ID
  ).trim();
}

function boolEnv(name, fallback = true) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

async function postJson(url, payload, secret) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-test-secret': secret,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url} (http ${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

async function getVersion(origin) {
  const response = await fetch(`${origin}/api/version`, { method: 'GET' });
  const text = await response.text();
  if (!response.ok) throw new Error(`/api/version failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.trim() };
  }
}

async function main() {
  const origin = baseUrl();
  const secret = requiredEnv('INTERNAL_TEST_SECRET');
  const chatId = testChatId();
  const resetTestState = boolEnv('RESET_TEST_STATE', true);
  const url = `${origin}${ENDPOINT_PATH}`;
  const version = await getVersion(origin);

  const result = await postJson(
    url,
    {
      action: 'run',
      chatId,
      resetTestState,
    },
    secret,
  );

  console.log('Telegram Wizard v2 Acceptance');
  console.log(`base_url: ${origin}`);
  console.log(`test_chat_id: ${chatId}`);
  console.log(`reset_test_state: ${resetTestState}`);
  console.log(`production_sha: ${version.sha || version.raw || 'unknown'}`);
  console.log('');
  console.log(result.table || 'No step table returned.');
  console.log('');
  console.log('Summary');
  console.log(JSON.stringify(result.summary ?? {}, null, 2));

  if (!result.ok) {
    console.error('\nAcceptance failed.');
    process.exit(1);
  }

  console.log('\nAcceptance passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
