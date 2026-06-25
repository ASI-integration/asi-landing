#!/usr/bin/env node
/**
 * Live production MK-first acceptance via Telegram webhook on VPS.
 */
import { readFileSync, existsSync } from 'node:fs';

const TARGET_SHA = '39776922c6b9e9b591e650974c3962701ac2367e';
const BASE = (process.env.ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const WEBHOOK = `${BASE.replace('https://asi-global.ru', 'http://127.0.0.1:3000')}/api/telegram/webhook`;
const ENV_FILE = '/var/www/asi/shared/.env.production.live';

const CHAT_A = Number(process.env.MK_ACCEPTANCE_CHAT_A || '99785211');
const CHAT_B = Number(process.env.MK_ACCEPTANCE_CHAT_B || '99785212');
const CHAT_C = Number(process.env.MK_ACCEPTANCE_CHAT_C || '99785213');
const USERNAME = process.env.MK_ACCEPTANCE_USERNAME || 'mk_first_accept_0625';

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

const env = { ...loadEnv(ENV_FILE), ...process.env };
const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || '';
const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '');
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || '';

let updateSeq = 9_978_520_000;
let callbackSeq = 1;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postWebhook(body) {
  const headers = { 'content-type': 'application/json' };
  if (webhookSecret) headers['x-telegram-bot-api-secret-token'] = webhookSecret;
  const res = await fetch(WEBHOOK, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  await sleep(450);
  return text;
}

async function sendText(chatId, text, username = USERNAME) {
  updateSeq += 1;
  return postWebhook({
    update_id: updateSeq,
    message: {
      message_id: updateSeq,
      date: Math.floor(Date.now() / 1000),
      text,
      chat: { id: chatId, type: 'private' },
      from: { id: chatId, is_bot: false, username, first_name: 'MK Accept' },
    },
  });
}

async function sendCallback(chatId, data, username = USERNAME) {
  updateSeq += 1;
  const cbId = `cb-${callbackSeq++}`;
  return postWebhook({
    update_id: updateSeq,
    callback_query: {
      id: cbId,
      from: { id: chatId, is_bot: false, username, first_name: 'MK Accept' },
      message: {
        message_id: updateSeq - 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        text: 'mk',
      },
      data,
    },
  });
}

function sessionPath(chatId) {
  return `/var/www/asi/current/.asi-comm-state/asi-sess-${chatId}.json`;
}

function readSession(chatId) {
  const p = sessionPath(chatId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function readSessionRetry(chatId) {
  for (let i = 0; i < 12; i += 1) {
    const s = readSession(chatId);
    if (s) return s;
    await sleep(300);
  }
  return readSession(chatId);
}

function readOwnerState(session) {
  const cd = session?.collected_data || {};
  const regRaw = cd.owner_objects_registry;
  if (!regRaw) return null;
  try {
    const reg = JSON.parse(regRaw);
    const activeId = reg.activeObjectId;
    const stateRaw = cd[`owner_obj_state_${activeId}`];
    if (!stateRaw) return null;
    return JSON.parse(stateRaw);
  } catch {
    return null;
  }
}

async function supabaseSelect(table, params) {
  if (!supabaseUrl || !supabaseKey) return [];
  const qs = new URLSearchParams(params);
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${qs}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) throw new Error(`supabase ${table}: ${res.status}`);
  return res.json();
}

async function countMkOps(username) {
  const rows = await supabaseSelect('crm_contacts', {
    select: 'id,telegram_username',
    telegram_username: `ilike.${username}`,
  });
  const contactId = rows[0]?.id;
  if (!contactId) return { contactId: null, mkOps: [] };
  const ops = await supabaseSelect('ops_operator_tasks', {
    select: 'id,task_type,dedup_key,metadata,task_status',
    contact_id: `eq.${contactId}`,
    limit: '30',
  });
  const mkOps = ops.filter((row) => {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return Boolean(meta.mk_followup_kind);
  });
  return { contactId, mkOps };
}

async function walkWizardCore(chatId, username) {
  await sendText(chatId, 'Казань', username);
  await sendText(chatId, 'Баумана 5', username);
  await sendCallback(chatId, 'obv2:type:Квартира', username);
  await sendText(chatId, 'Апартаменты у Кремля', username);
  await sendCallback(chatId, 'obv2:chk_in:15:00', username);
  await sendCallback(chatId, 'obv2:chk_out:11:00', username);
  await sendCallback(chatId, 'obv2:rl_t:no_smoke', username);
  await sendCallback(chatId, 'obv2:rl_done', username);
  await sendText(chatId, 'ASI_Guest, пароль 12345678', username);
  await sendCallback(chatId, 'obv2:ch_t:sutochno', username);
  await sendCallback(chatId, 'obv2:ch_done', username);
  await sendCallback(chatId, 'obv2:photo_later', username);
}

async function scenarioA(chatId) {
  const username = `${USERNAME}_a`;
  await sendText(chatId, 'Хочу подключить ASI', username);
  let session = await readSessionRetry(chatId);
  let state = readOwnerState(session);
  const mkPhaseStart = state?.mk_phase;
  await sendCallback(chatId, 'obmk:has:yes', username);
  await sendCallback(chatId, 'obmk:cm:bnovo', username);
  await sendCallback(chatId, 'obmk:prop:yes', username);
  await sendText(chatId, 'Апартаменты на Невском', username);
  await sendText(chatId, 'Санкт-Петербург', username);
  await sendText(chatId, '+79991112233', username);
  await sendCallback(chatId, 'obmk:placement:skip', username);
  await sleep(800);
  await sendText(chatId, 'спасибо', username);
  session = await readSessionRetry(chatId);
  state = readOwnerState(session);
  await sleep(800);
  const ops1 = await countMkOps(username);
  await sendText(chatId, 'ещё раз', username);
  const ops2 = await countMkOps(username);
  return {
    ok:
      (mkPhaseStart === 'ask_has_cm' || state?.mk_collection_mode === 'minimal') &&
      state?.mk_collection_mode === 'minimal' &&
      state?.selected_channel_manager === 'bnovo' &&
      ops1.mkOps.length === 1 &&
      ops2.mkOps.length === 1 &&
      ops1.mkOps[0]?.metadata?.mk_followup_kind === 'channel_manager_existing_check',
    mkPhaseStart,
    collectionMode: state?.mk_collection_mode,
    opsCountFirst: ops1.mkOps.length,
    opsCountSecond: ops2.mkOps.length,
    mkFollowupKind: ops1.mkOps[0]?.metadata?.mk_followup_kind ?? null,
  };
}

async function scenarioB(chatId) {
  const username = `${USERNAME}_b`;
  await sendText(chatId, 'Хочу подключить ASI', username);
  await sendCallback(chatId, 'obmk:has:no', username);
  await walkWizardCore(chatId, username);
  await sendText(chatId, '+79993334455', username);
  const session = await readSessionRetry(chatId);
  const state = readOwnerState(session);
  const ops = await countMkOps(username);
  return {
    ok:
      state?.mk_route === 'no_cm' &&
      ops.mkOps.length === 1 &&
      ops.mkOps[0]?.metadata?.mk_followup_kind === 'channel_manager_selection_needed',
    mkRoute: state?.mk_route,
    mkFollowupKind: ops.mkOps[0]?.metadata?.mk_followup_kind ?? null,
  };
}

async function scenarioC(chatId) {
  const username = `${USERNAME}_c`;
  await sendText(chatId, 'Хочу подключить ASI', username);
  await sendCallback(chatId, 'obmk:has:unknown', username);
  const sessionExplain = await readSessionRetry(chatId);
  const explainState = readOwnerState(sessionExplain);
  await sendCallback(chatId, 'obmk:explain:help', username);
  await walkWizardCore(chatId, username);
  await sendText(chatId, '@mk_first_accept_0625_c', username);
  const session = await readSessionRetry(chatId);
  const state = readOwnerState(session);
  const ops = await countMkOps(username);
  return {
    ok:
      explainState?.mk_phase === 'explain_cm' &&
      state?.mk_route === 'unknown_help' &&
      ops.mkOps.length === 1 &&
      ops.mkOps[0]?.metadata?.mk_followup_kind === 'channel_manager_explain_and_select',
    mkPhase: explainState?.mk_phase,
    mkRoute: state?.mk_route,
    mkFollowupKind: ops.mkOps[0]?.metadata?.mk_followup_kind ?? null,
  };
}

async function main() {
  const version = await fetch(`${BASE}/api/version`).then((r) => r.json());
  if (version.sha !== TARGET_SHA) throw new Error(`sha mismatch ${version.sha}`);

  const report = {
    productionSha: version.sha,
    scenarioA: await scenarioA(CHAT_A),
    scenarioB: await scenarioB(CHAT_B),
    scenarioC: await scenarioC(CHAT_C),
  };
  report.ok = report.scenarioA.ok && report.scenarioB.ok && report.scenarioC.ok;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('[mk-first-live-acceptance] FAIL', e);
  process.exit(1);
});
