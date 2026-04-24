import fs from 'node:fs';
import path from 'node:path';

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      [
        `Missing required env var ${name}.`,
        `Set it like:`,
        `  PowerShell: $env:${name}="..."`,
        `  bash: export ${name}="..."`,
      ].join('\n'),
    );
  }
  return v.trim();
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

function countClarifications(reply) {
  const m = String(reply ?? '').match(/\?/g);
  return m ? m.length : 0;
}

const ESCALATION_KEYWORDS = [
  'администратор',
  'админу',
  'ресепшен',
  'ресепшн',
  'переведу',
  'передам',
  'свяжется',
  'позвоните',
  'позвоню',
  'звоните',
  'контакт',
  'оператор',
  'поддержк',
];

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const http_status = res.status;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, description: `Non-JSON response: ${text}` };
  }
  return { http_status, json };
}

async function tgGetUpdates(token, args) {
  const { http_status, json } = await tgCall(token, 'getUpdates', args);
  if (!json.ok) {
    throw new Error(
      `Telegram getUpdates failed (http ${http_status}): ${json.description ?? 'unknown error'}`,
    );
  }
  const updates = json.result ?? [];
  const maxId = updates.reduce((m, u) => Math.max(m, u.update_id), -1);
  return { updates, next_offset: maxId >= 0 ? maxId + 1 : args.offset ?? 0 };
}

async function tgSendMessage(token, chatId, text) {
  const { http_status, json } = await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
  });
  if (!json.ok) {
    throw new Error(
      `Telegram sendMessage failed (http ${http_status}): ${json.description ?? 'unknown error'}`,
    );
  }
  if (!json.result?.message_id || !json.result?.date) {
    throw new Error(`Telegram sendMessage returned unexpected result payload.`);
  }
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
  const mustNot = caseDef.assertions?.must_not_include ?? [];
  const shouldAny = caseDef.assertions?.should_include_any ?? [];
  const maxClar = caseDef.assertions?.max_clarifications ?? 999;
  const allowEsc = caseDef.assertions?.allow_escalation ?? false;

  const matchedMustNot = mustNot.filter((s) => includesCI(replyText, s));
  if (matchedMustNot.length) {
    return {
      case_name: caseDef.name,
      input: caseDef.input,
      pass: false,
      failure_reason: `Reply includes forbidden phrase(s): ${matchedMustNot.join(', ')}`,
      meta: {
        sent_message_id: null,
        received_message_id: null,
        received_date_unix: null,
        clarifications: countClarifications(replyText),
        matched_includes: [],
        matched_must_not: matchedMustNot,
        matched_escalation: [],
      },
    };
  }

  const clarifications = countClarifications(replyText);
  if (clarifications > maxClar) {
    return {
      case_name: caseDef.name,
      input: caseDef.input,
      pass: false,
      failure_reason: `Too many clarifications: ${clarifications} > ${maxClar}`,
      meta: {
        sent_message_id: null,
        received_message_id: null,
        received_date_unix: null,
        clarifications,
        matched_includes: [],
        matched_must_not: [],
        matched_escalation: [],
      },
    };
  }

  const matchedIncludes = shouldAny.filter((s) => includesCI(replyText, s));
  if (shouldAny.length && matchedIncludes.length === 0) {
    return {
      case_name: caseDef.name,
      input: caseDef.input,
      pass: false,
      failure_reason: `Reply did not include any of required hints: ${shouldAny.join(', ')}`,
      meta: {
        sent_message_id: null,
        received_message_id: null,
        received_date_unix: null,
        clarifications,
        matched_includes: [],
        matched_must_not: [],
        matched_escalation: [],
      },
    };
  }

  const matchedEsc = ESCALATION_KEYWORDS.filter((k) => includesCI(replyText, k));
  if (!allowEsc && matchedEsc.length) {
    return {
      case_name: caseDef.name,
      input: caseDef.input,
      pass: false,
      failure_reason: `Escalation not allowed but found: ${matchedEsc.join(', ')}`,
      meta: {
        sent_message_id: null,
        received_message_id: null,
        received_date_unix: null,
        clarifications,
        matched_includes: matchedIncludes,
        matched_must_not: [],
        matched_escalation: matchedEsc,
      },
    };
  }

  return {
    case_name: caseDef.name,
    input: caseDef.input,
    pass: true,
    failure_reason: null,
    meta: {
      sent_message_id: null,
      received_message_id: null,
      received_date_unix: null,
      clarifications,
      matched_includes: matchedIncludes,
      matched_must_not: [],
      matched_escalation: matchedEsc,
    },
  };
}

async function main() {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatIdRaw = requireEnv('TELEGRAM_TEST_CHAT_ID');
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || undefined;

  const chatIdNum = Number(chatIdRaw);
  if (!Number.isFinite(chatIdNum)) {
    throw new Error(`TELEGRAM_TEST_CHAT_ID must be numeric chat id. Got: ${chatIdRaw}`);
  }

  const casesPath =
    process.env.TELEGRAM_LIVE_CASES_PATH?.trim() ||
    path.join(process.cwd(), 'tests', 'telegram-live-cases.ru.json');
  const raw = fs.readFileSync(casesPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed?.cases?.length) {
    throw new Error(`No cases found in ${casesPath}`);
  }

  const startedAt = new Date();

  // Drain updates so we don't match old replies.
  let offset = 0;
  {
    const { updates, next_offset } = await tgGetUpdates(token, { offset, timeout: 0, limit: 100 });
    const maxId = updates.reduce((m, u) => Math.max(m, u.update_id), -1);
    offset = maxId >= 0 ? maxId + 1 : next_offset;
  }

  const results = [];

  // /reset_session must reply exactly.
  const reset = await tgSendMessage(token, chatIdRaw, '/reset_session');
  const resetReply = await waitForBotReply({
    token,
    chatIdNum,
    offset,
    afterDateUnix: reset.date,
    replyToMessageId: reset.message_id,
    botUsername,
    timeoutMs: 40_000,
  });
  offset = resetReply.next_offset;
  const resetText = resetReply.msg.text?.trim() ?? '';
  if (resetText !== 'Session reset for acceptance testing.') {
    const reportDir = path.join(process.cwd(), 'test-results', 'telegram-live-acceptance');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
    const report = {
      timestamp: startedAt.toISOString(),
      overall_pass: false,
      failure: {
        step: 'reset_session',
        expected: 'Session reset for acceptance testing.',
        actual: resetText,
      },
      cases: [],
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.error(`FAIL: /reset_session reply mismatch.`);
    console.error(`Expected: "Session reset for acceptance testing."`);
    console.error(`Actual:   "${resetText}"`);
    console.error(`Report:   ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  for (const c of parsed.cases) {
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
      const baseEval = evaluateCase(c, replyText);
      results.push({
        ...baseEval,
        actual_reply: replyText,
        meta: {
          ...baseEval.meta,
          sent_message_id: sent.message_id,
          received_message_id: got.msg.message_id,
          received_date_unix: got.msg.date,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        case_name: c.name,
        input: c.input,
        actual_reply: null,
        pass: false,
        failure_reason: msg,
        meta: {
          sent_message_id: sent.message_id,
          received_message_id: null,
          received_date_unix: null,
          clarifications: 0,
          matched_includes: [],
          matched_must_not: [],
          matched_escalation: [],
        },
      });
    }
  }

  const overall = results.every((r) => r.pass);
  const reportDir = path.join(process.cwd(), 'test-results', 'telegram-live-acceptance');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: startedAt.toISOString(),
        overall_pass: overall,
        cases: results.map((r) => ({
          timestamp: startedAt.toISOString(),
          case_name: r.case_name,
          input: r.input,
          actual_reply: r.actual_reply,
          pass: r.pass,
          failure_reason: r.failure_reason,
        })),
        raw: results,
      },
      null,
      2,
    ),
    'utf8',
  );

  const passed = results.filter((r) => r.pass).length;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    const extra = r.pass ? '' : ` — ${r.failure_reason ?? 'unknown failure'}`;
    console.log(`${tag} ${r.case_name}${extra}`);
  }

  console.log(`\nSummary: ${overall ? 'PASS' : 'FAIL'} (${passed}/${results.length} passed)`);
  console.log(`Report: ${reportPath}`);

  if (!overall) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});

