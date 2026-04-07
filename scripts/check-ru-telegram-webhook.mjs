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

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers,
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
const adminSecret = env.ADMIN_SECRET;
if (!adminSecret) {
  console.error('Missing ADMIN_SECRET in .env.ru');
  process.exit(2);
}

const url = 'https://asi-global.ru/api/admin/telegram-webhook-info';
const res = await httpGetJson(url, { 'x-admin-secret': adminSecret });
console.log(JSON.stringify({ http_status: res.status, body: res.body }, null, 2));

