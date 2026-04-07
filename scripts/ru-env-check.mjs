import fs from 'node:fs';

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

const envPath = process.argv[2] || '.env.ru.production.pulled';
const env = parseEnvFile(envPath);

const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const meta = {};
for (const k of keys) {
  const v = env[k];
  meta[k] = v ? { present: true, length: String(v).length } : { present: false, length: 0 };
}

console.log(JSON.stringify({ envPath, meta }, null, 2));

