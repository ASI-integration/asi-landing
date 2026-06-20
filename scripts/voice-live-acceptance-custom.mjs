/**
 * Custom live acceptance for Voice Response Policy v1 deploy.
 * Cases A/B/C from deploy runbook.
 */
function requireEnv(name) {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing ${name}`);
  return v.trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  if (!json.ok) throw new Error(`getUpdates failed: ${json.description}`);
  const updates = json.result ?? [];
  const maxId = updates.reduce((m, u) => Math.max(m, u.update_id), -1);
  return { updates, next_offset: maxId >= 0 ? maxId + 1 : args.offset ?? 0 };
}

async function tgSendMessage(token, chatId, text) {
  const { json } = await tgCall(token, 'sendMessage', { chat_id: chatId, text });
  if (!json.ok) throw new Error(`sendMessage failed: ${json.description}`);
  return json.result;
}

async function waitForUpdates(token, offset, afterDateUnix, timeoutMs = 120000) {
  const start = Date.now();
  let off = offset;
  while (Date.now() - start < timeoutMs) {
    const { updates, next_offset } = await tgGetUpdates(token, {
      offset: off,
      timeout: 10,
      limit: 100,
      allowed_updates: ['message'],
    });
    off = next_offset;
    const msgs = updates.map((u) => u.message).filter(Boolean).filter((m) => m.date >= afterDateUnix);
    if (msgs.length) return { msgs, offset: off };
    await sleep(400);
  }
  throw new Error(`timeout ${timeoutMs}ms waiting for bot messages`);
}

async function runCase(name, input, expect, token, chatIdNum) {
  const { next_offset } = await tgGetUpdates(token, { offset: 0, limit: 1, timeout: 0 });
  let offset = next_offset;
  const sent = await tgSendMessage(token, chatIdNum, input);
  const after = sent.date - 1;
  const { msgs } = await waitForUpdates(token, offset, after, 120000);

  const botMsgs = msgs.filter((m) => m.from?.is_bot && m.chat?.id === chatIdNum);
  const textMsgs = botMsgs.filter((m) => m.text);
  const voiceMsgs = botMsgs.filter((m) => m.voice);

  const passText = expect.text ? textMsgs.length > 0 : textMsgs.length === 0;
  const passVoice = expect.voice ? voiceMsgs.length > 0 : voiceMsgs.length === 0;
  const pass = passText && passVoice;

  return {
    name,
    input,
    pass,
    expect,
    observed: {
      text_replies: textMsgs.length,
      voice_replies: voiceMsgs.length,
      sample_text: textMsgs[0]?.text?.slice(0, 200) ?? null,
    },
  };
}

async function main() {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatIdNum = Number(requireEnv('TELEGRAM_TEST_CHAT_ID'));
  if (!Number.isFinite(chatIdNum)) throw new Error('TELEGRAM_TEST_CHAT_ID must be numeric');

  const cases = [
    {
      name: 'A_urgent_door_lock',
      input: 'я стою у двери, замок не открывается',
      expect: { text: true, voice: true },
    },
    {
      name: 'B_daytime_restaurants',
      input: 'рестораны рядом?',
      expect: { text: true, voice: false },
    },
    {
      name: 'C_voice_off_then_urgent',
      input: '/voice_off',
      expect: { text: true, voice: false },
      followUp: {
        name: 'C_urgent_after_voice_off',
        input: 'я стою у двери, замок не открывается',
        expect: { text: true, voice: false },
      },
    },
  ];

  const results = [];
  for (const c of cases) {
    results.push(await runCase(c.name, c.input, c.expect, token, chatIdNum));
    if (c.followUp) {
      await sleep(2000);
      results.push(await runCase(c.followUp.name, c.followUp.input, c.followUp.expect, token, chatIdNum));
    }
    await sleep(3000);
  }

  const summary = {
    all_pass: results.every((r) => r.pass),
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.all_pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
