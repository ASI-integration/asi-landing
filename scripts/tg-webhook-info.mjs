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

function tgGet(token, method) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'GET',
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
    req.end();
  });
}

const env = parseEnvFile('.env.ru');
const token = env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env.ru');
  process.exit(2);
}

const me = await tgGet(token, 'getMe');
const wh = await tgGet(token, 'getWebhookInfo');

const out = {
  getMe_ok: me.body?.ok,
  bot_username: me.body?.result?.username,
  bot_id: me.body?.result?.id,
  getWebhookInfo_ok: wh.body?.ok,
  webhook_url: wh.body?.result?.url,
  has_custom_cert: wh.body?.result?.has_custom_certificate,
  pending_update_count: wh.body?.result?.pending_update_count,
  last_error_date: wh.body?.result?.last_error_date,
  last_error_message: wh.body?.result?.last_error_message,
  max_connections: wh.body?.result?.max_connections,
  ip_address: wh.body?.result?.ip_address,
  allowed_updates: wh.body?.result?.allowed_updates,
};

console.log(JSON.stringify(out, null, 2));

