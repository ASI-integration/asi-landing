import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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
const limit = Number.parseInt(process.argv[3] || '30', 10);
const env = parseEnvFile(envPath);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const chatIdRaw = env.TELEGRAM_CHAT_ID;

if (!url || !key) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envPath}`);
  process.exit(2);
}
if (!chatIdRaw) {
  console.error(`Missing TELEGRAM_CHAT_ID in ${envPath}`);
  process.exit(2);
}

const chatId = Number.parseInt(String(chatIdRaw), 10);
if (!Number.isFinite(chatId)) {
  console.error(`TELEGRAM_CHAT_ID is not a number: ${String(chatIdRaw)}`);
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('tg_message_turns')
  .select('chat_id, role, content, category, lang, created_at, update_id')
  .eq('chat_id', chatId)
  .order('created_at', { ascending: false })
  .limit(Number.isFinite(limit) && limit > 0 ? limit : 30);

if (error) {
  console.error(`Supabase error: ${error.message}`);
  process.exit(1);
}

console.log(JSON.stringify({ chat_id: chatId, turns: data ?? [] }, null, 2));

