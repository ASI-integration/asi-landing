import fs from 'node:fs';
import path from 'node:path';

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var ${name}.`);
  }
  return v.trim();
}

function optionalEnv(name) {
  const v = process.env[name];
  return v?.trim() || undefined;
}

function getTelegramToken() {
  const smokeToken = optionalEnv('TELEGRAM_SMOKE_BOT_TOKEN');
  if (smokeToken) return { token: smokeToken, source: 'TELEGRAM_SMOKE_BOT_TOKEN' };
  return { token: requireEnv('TELEGRAM_BOT_TOKEN'), source: 'TELEGRAM_BOT_TOKEN' };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function norm(s) {
  return String(s ?? '').toLowerCase();
}

function includesCI(haystack, needle) {
  return norm(haystack).includes(norm(needle));
}

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { http_status: res.status, json };
}

async function tgGetUpdates(token, args) {
  const { json } = await tgCall(token, 'getUpdates', args);
  if (!json.ok) throw new Error(`getUpdates failed: ${json.description ?? 'unknown'}`);
  const updates = json.result ?? [];
  const maxId = updates.reduce((m, u) => Math.max(m, u.update_id), -1);
  return { updates, next_offset: maxId >= 0 ? maxId + 1 : args.offset ?? 0 };
}

async function tgSendMessage(token, chatId, text) {
  const { json } = await tgCall(token, 'sendMessage', { chat_id: chatId, text });
  if (!json.ok) throw new Error(`sendMessage failed: ${json.description ?? 'unknown'}`);
  return { message_id: json.result.message_id, date: json.result.date };
}

function isBotReplyMessage(msg, chatIdNum, botUsername) {
  if (!msg?.chat || msg.chat.id !== chatIdNum) return false;
  if (!msg.from?.is_bot) return false;
  if (botUsername && msg.from?.username && msg.from.username !== botUsername) return false;
  return typeof msg.text === 'string' && msg.text.trim().length > 0;
}

async function waitForBotReply(args) {
  const start = Date.now();
  let offset = args.offset;
  while (Date.now() - start < args.timeoutMs) {
    const { updates, next_offset } = await tgGetUpdates(args.token, {
      offset,
      timeout: 10,
      limit: 50,
      allowed_updates: ['message'],
    });
    offset = next_offset;
    const messages = updates.map((u) => u.message).filter(Boolean);
    const candidates = messages
      .filter((m) => isBotReplyMessage(m, args.chatIdNum, args.botUsername))
      .filter((m) => m.date >= args.afterDateUnix);
    const byReplyTo = args.replyToMessageId
      ? candidates.find((m) => m.reply_to_message?.message_id === args.replyToMessageId)
      : undefined;
    const chosen = byReplyTo ?? candidates[0];
    if (chosen) return { msg: chosen, next_offset: offset };
    await sleep(400);
  }
  throw new Error(`Timed out waiting for bot reply (${args.timeoutMs}ms).`);
}

function evaluateCase(caseDef, replyText) {
  const shouldAny = caseDef.assertions?.should_include_any ?? [];
  const mustNotAny = caseDef.assertions?.must_not_include_any ?? [];

  const matchedIncludes = shouldAny.filter((s) => includesCI(replyText, s));
  if (shouldAny.length && matchedIncludes.length === 0) {
    return {
      pass: false,
      failure_reason: `Expected one of: ${shouldAny.join(', ')}`,
    };
  }

  const matchedMustNot = mustNotAny.filter((s) => includesCI(replyText, s));
  if (matchedMustNot.length) {
    return {
      pass: false,
      failure_reason: `Reply includes forbidden phrase(s): ${matchedMustNot.join(', ')}`,
    };
  }

  return { pass: true, failure_reason: null };
}

async function fetchVersion(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/version`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/api/version HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const { token, source: tokenSource } = getTelegramToken();
  const chatIdRaw = requireEnv('TELEGRAM_TEST_CHAT_ID');
  const botUsername = optionalEnv('TELEGRAM_BOT_USERNAME');
  const versionBase = optionalEnv('ASI_ACCEPTANCE_BASE_URL') ?? optionalEnv('NEXT_PUBLIC_SITE_URL') ?? 'https://asi.ru';

  const chatIdNum = Number(chatIdRaw);
  if (!Number.isFinite(chatIdNum)) throw new Error('TELEGRAM_TEST_CHAT_ID must be numeric.');

  const casesPath =
    optionalEnv('TELEGRAM_IDENTITY_CASES_PATH') ??
    path.join(process.cwd(), 'tests', 'telegram-live-identity-acceptance.ru.json');
  const spec = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

  const startedAt = new Date();
  console.log(`Telegram identity acceptance token source: ${tokenSource}`);

  let versionInfo = null;
  try {
    versionInfo = await fetchVersion(versionBase);
    console.log(`/api/version sha=${versionInfo.sha ?? 'unknown'}`);
  } catch (err) {
    console.warn(`WARN: /api/version check failed: ${err instanceof Error ? err.message : err}`);
  }

  let offset = 0;
  {
    const { updates, next_offset } = await tgGetUpdates(token, { offset, timeout: 0, limit: 100 });
    const maxId = updates.reduce((m, u) => Math.max(m, u.update_id), -1);
    offset = maxId >= 0 ? maxId + 1 : next_offset;
  }

  const resetCmd = spec.reset_command ?? '/reset_identity';
  const resetExpected = spec.reset_expected_reply ?? 'Идентичность и сессия сброшены для acceptance-тестирования.';
  const resetSent = await tgSendMessage(token, chatIdRaw, resetCmd);
  const resetReply = await waitForBotReply({
    token,
    chatIdNum,
    offset,
    afterDateUnix: resetSent.date,
    replyToMessageId: resetSent.message_id,
    botUsername,
    timeoutMs: 40_000,
  });
  offset = resetReply.next_offset;
  const resetText = resetReply.msg.text?.trim() ?? '';

  const results = [];
  if (resetText !== resetExpected) {
    results.push({
      case_name: 'reset_identity',
      input: resetCmd,
      actual_reply: resetText,
      pass: false,
      failure_reason: `Expected: "${resetExpected}"`,
    });
  } else {
    results.push({
      case_name: 'reset_identity',
      input: resetCmd,
      actual_reply: resetText,
      pass: true,
      failure_reason: null,
    });
  }

  for (const c of spec.cases ?? []) {
    const sent = await tgSendMessage(token, chatIdRaw, c.input);
    try {
      const got = await waitForBotReply({
        token,
        chatIdNum,
        offset,
        afterDateUnix: sent.date,
        replyToMessageId: sent.message_id,
        botUsername,
        timeoutMs: 60_000,
      });
      offset = got.next_offset;
      const replyText = got.msg.text?.trim() ?? '';
      const evalResult = evaluateCase(c, replyText);
      results.push({
        case_name: c.name,
        input: c.input,
        actual_reply: replyText,
        ...evalResult,
      });
    } catch (err) {
      results.push({
        case_name: c.name,
        input: c.input,
        actual_reply: null,
        pass: false,
        failure_reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const overall = results.every((r) => r.pass);
  const reportDir = path.join(process.cwd(), 'test-results', 'telegram-identity-live-acceptance');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
  const report = {
    timestamp: startedAt.toISOString(),
    overall_pass: overall,
    token_source: tokenSource,
    version: versionInfo,
    reset_before_cases: { command: resetCmd, expected: resetExpected, actual: resetText },
    cases: results,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.case_name}${r.pass ? '' : ` — ${r.failure_reason}`}`);
  }
  console.log(`\nSummary: ${overall ? 'PASS' : 'FAIL'} (${results.filter((r) => r.pass).length}/${results.length})`);
  console.log(`Report: ${reportPath}`);
  if (!overall) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
