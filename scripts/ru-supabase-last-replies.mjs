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

function normalize(s) {
  return String(s ?? '').trim().replace(/\r\n/g, '\n');
}

/**
 * Given turns sorted newest→oldest, find the most recent user turn matching `needle`,
 * then return the assistant turn that immediately follows it in time (older in array).
 */
function findReplyPair(turns, needle) {
  const n = normalize(needle);
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== 'user') continue;
    if (normalize(t.content) !== n) continue;
    // turns are newest→oldest, so "next in time" is at i-1? actually older is i+1.
    for (let j = i - 1; j >= 0; j--) {
      if (turns[j].role === 'assistant') return { user: t, assistant: turns[j] };
    }
    return { user: t, assistant: null };
  }
  return null;
}

const envPath = process.argv[2] || '.env.ru.production.pulled';
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

const { data: turns, error } = await supabase
  .from('tg_message_turns')
  .select('chat_id, role, content, category, lang, created_at, update_id')
  .eq('chat_id', chatId)
  .order('created_at', { ascending: false })
  .limit(120);

if (error) {
  console.error(`Supabase error: ${error.message}`);
  process.exit(1);
}

const testcases = [
  { id: 'start', text: '/start' },
  { id: 'late_checkin', text: 'Поздний заезд. Мы приедем после 23:00.' },
  { id: 'access_code', text: 'Нужен код доступа/код от замка для заселения.' },
  { id: 'lock_not_working', text: 'Замок не работает, дверь не открывается. Срочно.' },
  { id: 'unknown', text: 'Подскажите, пожалуйста.' },
];

const out = {
  chat_id: chatId,
  looked_back_turns: turns?.length ?? 0,
  cases: {},
};

for (const tc of testcases) {
  const pair = findReplyPair(turns ?? [], tc.text);
  out.cases[tc.id] = pair
    ? {
        found_user_turn: true,
        user_created_at: pair.user.created_at,
        assistant_found: Boolean(pair.assistant),
        assistant_created_at: pair.assistant?.created_at ?? null,
        assistant_reply: pair.assistant?.content ?? null,
        assistant_category: pair.assistant?.category ?? null,
        assistant_lang: pair.assistant?.lang ?? null,
      }
    : { found_user_turn: false };
}

console.log(JSON.stringify(out, null, 2));

