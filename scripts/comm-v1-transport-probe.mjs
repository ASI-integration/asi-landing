#!/usr/bin/env node

/**
 * COMM v1 transport probe — live Telegram API reachability for ASI_COMM_Test_Bot only.
 *
 * Reports ONLY transport endpoint reachability. Does NOT claim production callback
 * ingestion PASS (that is covered by telegram-poller-callback-e2e + acceptance:comm-v1).
 *
 * Synthetic answerCallbackQuery QUERY_ID_INVALID = API method reachable, not a real callback.
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

  const checks = {
    transport_endpoint_reachable: 'FAIL',
    answerCallbackQuery_reachable: 'FAIL',
    production_callback_ingestion: 'NOT_CLAIMED',
  };

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

  const cleared = await tgCall(token, 'editMessageReplyMarkup', {
    chat_id: ownerChatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
  if (!cleared.json.ok) {
    const desc = String(cleared.json.description ?? '');
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

  checks.transport_endpoint_reachable = 'PASS';

  // Real callback_query id only when provided; synthetic id proves method reachability only.
  const liveCallbackId = optionalEnv('COMM_V1_TRANSPORT_CALLBACK_ID');
  const callbackId = liveCallbackId ?? 'comm-v1-transport-probe-synthetic';
  const answered = await tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    text: 'probe',
  });

  if (answered.json.ok && liveCallbackId) {
    checks.answerCallbackQuery_reachable = 'PASS';
    console.log('[comm-v1-transport] answerCallbackQuery ok (live callback id)');
  } else if (answered.json.ok && !liveCallbackId) {
    // Unexpected success on synthetic id — still only reachability.
    checks.answerCallbackQuery_reachable = 'PASS';
    console.log(
      '[comm-v1-transport] answerCallbackQuery reachable (synthetic id unexpectedly accepted; not production callback ingestion)',
    );
  } else {
    const desc = String(answered.json.description ?? 'unknown');
    if (/query is too old|query ID is invalid|QUERY_ID_INVALID/i.test(desc)) {
      checks.answerCallbackQuery_reachable = 'PASS';
      console.log(
        `[comm-v1-transport] answerCallbackQuery reachable only (QUERY_ID_INVALID / synthetic — NOT production callback ingestion PASS): ${desc}`,
      );
    } else if (!liveCallbackId) {
      checks.answerCallbackQuery_reachable = 'PASS';
      console.log(
        `[comm-v1-transport] answerCallbackQuery reachable only (synthetic rejection — NOT production callback ingestion PASS): ${desc}`,
      );
    } else {
      fail(`answerCallbackQuery failed with live id: ${desc}`);
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

  console.log(
    'COMM_V1_TRANSPORT_RESULT=' +
      JSON.stringify({
        ok: checks.transport_endpoint_reachable === 'PASS',
        bot: TEST_BOT_EXPECTED_USERNAME,
        checks: {
          transport_endpoint_reachable: checks.transport_endpoint_reachable,
          answerCallbackQuery_reachable: checks.answerCallbackQuery_reachable,
          production_callback_ingestion: checks.production_callback_ingestion,
        },
        note:
          'QUERY_ID_INVALID / synthetic answerCallbackQuery is transport reachability only. Production callback ingestion is telegram-poller-callback-e2e.',
      }),
  );

  if (checks.transport_endpoint_reachable !== 'PASS') {
    fail('transport_endpoint_reachable failed');
  }

  console.log('[comm-v1-transport] TRANSPORT_ENDPOINT_REACHABLE=PASS');
  console.log('[comm-v1-transport] PRODUCTION_CALLBACK_INGESTION=NOT_CLAIMED');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
