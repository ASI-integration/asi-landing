import fs from 'node:fs';
import https from 'node:https';

function parseEnvFile(path) {
  const out = {};
  const raw = fs.readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function tgPostJson(token, method, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const envPath = process.argv[2] || '.env.ru.production.pulled';
const env = parseEnvFile(envPath);

const token = env.TELEGRAM_BOT_TOKEN;
const chatId = env.TELEGRAM_CHAT_ID;
if (!token) {
  console.error(`Missing TELEGRAM_BOT_TOKEN in ${envPath}`);
  process.exit(2);
}
if (!chatId) {
  console.error(`Missing TELEGRAM_CHAT_ID in ${envPath}`);
  process.exit(2);
}

const text = `RU bot smoke test (plain text) ${new Date().toISOString()}`;
const res = await tgPostJson(token, 'sendMessage', { chat_id: chatId, text });

console.log(
  JSON.stringify(
    {
      sendMessage_http_status: res.status,
      sendMessage_ok: res.body?.ok ?? false,
      message_id: res.body?.result?.message_id ?? null,
      chat_id: String(chatId),
    },
    null,
    2,
  ),
);

