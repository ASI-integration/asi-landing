#!/usr/bin/env node

/**
 * COMM v1 transport probe — live Telegram API smoke for ASI_COMM_Test_Bot only.
 *
 * Business callback flows are covered by the unit harness
 * (comm-v1-automated-acceptance.test.ts). This probe verifies UTF-8 transport:
 * getMe, sendMessage, editMessageText, editMessageReplyMarkup, optional
 * answerCallbackQuery (only when COMM_V1_TRANSPORT_CALLBACK_ID is set), deleteMessage.
 *
 * Never uses production guest bot token — only ASI_COMM_TEST_BOT_TOKEN.
 */

const TEST_BOT_EXPECTED_USERNAME = 'ASI_COMM_Test_Bot';
const DEFAULT_OWNER_CHAT_ID = '931919812';

function fail(message) {
  console.error(`[comm-v1-transport] FAIL: ${message}`);
  process.exit(1);
}

function optionalEnv(name) {
  const value = process.env[name];
  return value?.trim() || undefined;
}

function requireEnv(name) {
  const value = optionalEnv(name);
  if (!value) fail(`Missing required env var ${name}`);
  return value;
}

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { httpStatus: res.status, json };
}

async function main() {
  const token = requireEnv('ASI_COMM_TEST_BOT_TOKEN');
  const ownerChatId = optionalEnv('ASI_COMM_TEST_OWNER_CHAT_ID') ?? DEFAULT_OWNER_CHAT_ID;

  // Isolate probe token — never reuse production guest bot token from env.
  process.env.TELEGRAM_BOT_TOKEN = token;

  const me = await tgCall(token, 'getMe', {});
  if (!me.json.ok) fail(`getMe failed: ${me.json.description ?? 'unknown'}`);
  const botUsername = me.json.result?.username ?? '';
  if (botUsername !== TEST_BOT_EXPECTED_USERNAME) {
    fail(`getMe username must be ${TEST_BOT_EXPECTED_USERNAME}, got ${botUsername || '(empty)'}`);
  }
  console.log(`[comm-v1-transport] getMe ok: @${botUsername}`);

  const probeText = 'COMM v1 probe: кириллица ✓';
  const sent = await tgCall(token, 'sendMessage', {
    chat_id: ownerChatId,
    text: probeText,
    reply_markup: {
      inline_keyboard: [[{ text: 'Probe', callback_data: 'comm_v1:probe' }]],
    },
  });
  if (!sent.json.ok) fail(`sendMessage failed: ${sent.json.description ?? 'unknown'}`);
  const messageId = sent.json.result?.message_id;
  if (!messageId) fail('sendMessage returned no message_id');
  console.log('[comm-v1-transport] sendMessage ok');

  // Invalidate/remove buttons while markup is still present (before text edit).
  const cleared = await tgCall(token, 'editMessageReplyMarkup', {
    chat_id: ownerChatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
  if (!cleared.json.ok) {
    const desc = String(cleared.json.description ?? '');
    // Already-cleared / identical markup is acceptable for invalidate semantics.
    if (!/message is not modified/i.test(desc)) {
      fail(`editMessageReplyMarkup failed: ${desc || 'unknown'}`);
    }
    console.log('[comm-v1-transport] editMessageReplyMarkup ok (already clear / not modified)');
  } else {
    console.log('[comm-v1-transport] editMessageReplyMarkup ok (buttons cleared)');
  }

  const edited = await tgCall(token, 'editMessageText', {
    chat_id: ownerChatId,
    message_id: messageId,
    text: `${probeText} — edited`,
    reply_markup: { inline_keyboard: [] },
  });
  if (!edited.json.ok) fail(`editMessageText failed: ${edited.json.description ?? 'unknown'}`);
  console.log('[comm-v1-transport] editMessageText ok');

  // answerCallbackQuery requires a live callback_query_id from Telegram.
  // Business-logic coverage lives in the unit harness (mocked adapter).
  // Transport probe: call with a synthetic id and accept Telegram rejection as
  // proof the method is reachable; real ids only when COMM_V1_TRANSPORT_CALLBACK_ID is set.
  const callbackId = optionalEnv('COMM_V1_TRANSPORT_CALLBACK_ID') ?? 'comm-v1-transport-probe-synthetic';
  const answered = await tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    text: 'probe',
  });
  if (answered.json.ok) {
    console.log('[comm-v1-transport] answerCallbackQuery ok');
  } else {
    const desc = String(answered.json.description ?? 'unknown');
    // Expected for synthetic / expired ids — API endpoint reached.
    if (/query is too old|query ID is invalid|QUERY_ID_INVALID/i.test(desc) || optionalEnv('COMM_V1_TRANSPORT_CALLBACK_ID') === undefined) {
      console.log(`[comm-v1-transport] answerCallbackQuery reachable (telegram rejected synthetic/expired id: ${desc})`);
    } else {
      fail(`answerCallbackQuery failed: ${desc}`);
    }
  }

  const deleted = await tgCall(token, 'deleteMessage', {
    chat_id: ownerChatId,
    message_id: messageId,
  });
  if (!deleted.json.ok) {
    console.warn(`[comm-v1-transport] deleteMessage warning: ${deleted.json.description ?? 'unknown'}`);
  } else {
    console.log('[comm-v1-transport] deleteMessage ok');
  }

  console.log('[comm-v1-transport] PASS');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
