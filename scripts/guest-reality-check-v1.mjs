#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_BASE_URL = 'https://asi-global.ru';
const PROPERTY_ID = process.env.TELEGRAM_AUTOPILOT_PROPERTY_ID?.trim() || 'prop_A';
const FLOW_CHAT_SUFFIX = process.env.GUEST_REALITY_FLOW_CHAT_SUFFIX?.trim() || String(Date.now()).slice(-6);

const SCENARIO_GROUPS = [
  {
    group: 'wifi',
    cases: [
      { id: 'wifi_name', text: 'Какой Wi-Fi?', expectInReply: ['ASI-Test-WiFi', 'test12345'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'wifi_password', text: 'Напомните пароль от Wi-Fi', expectInReply: ['test12345'], expectAction: 'auto_reply', expectResolved: true },
    ],
  },
  {
    group: 'checkin',
    cases: [
      { id: 'checkin_time', text: 'Во сколько можно заехать?', expectInReply: ['14:00'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'early_checkin', text: 'Можно ли приехать раньше?', expectInReply: ['14:00'], expectAction: 'auto_reply', expectResolved: true },
    ],
  },
  {
    group: 'checkout',
    cases: [
      { id: 'checkout_time', text: 'Во сколько выезд?', expectInReply: ['12:00'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'late_checkout', text: 'Можно ли выехать позже?', expectInReply: ['12:00'], expectAction: 'auto_reply', expectResolved: true },
    ],
  },
  {
    group: 'parking',
    cases: [
      { id: 'parking_exists', text: 'Есть парковка?', expectInReply: ['парковка'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'parking_where', text: 'Где парковаться?', expectInReply: ['парковка', 'двор'], expectAction: 'auto_reply', expectResolved: true },
    ],
  },
  {
    group: 'deposit',
    cases: [
      { id: 'deposit_amount', text: 'Какой залог?', expectInReply: ['3000'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'deposit_return', text: 'Когда возвращается залог?', expectInReply: ['возвращ'], expectAction: 'auto_reply', expectResolved: true },
    ],
  },
  {
    group: 'rules',
    cases: [
      { id: 'smoking', text: 'Можно ли курить?', expectInReply: ['кур'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'pets', text: 'Можно ли с животными?', expectInReply: ['животн', 'собак', 'кошк', 'питомц', 'правил'], expectAnyInReply: true, expectAction: 'auto_reply', expectResolved: true },
      { id: 'guests', text: 'Можно ли пригласить гостей?', expectInReply: ['вечерин', 'правил', 'гост'], expectAnyInReply: true, expectAction: 'auto_reply', expectResolved: true },
    ],
  },
  {
    group: 'keys',
    cases: [
      { id: 'keys_where', text: 'Где получить ключи?', expectInReply: ['засел'], expectAction: 'auto_reply', expectResolved: true },
      { id: 'checkin_process', text: 'Как проходит заселение?', expectInReply: ['засел'], expectAction: 'auto_reply', expectResolved: true },
    ],
  },
];

const EDGE_CASES = [
  { id: 'edge_wifi', text: 'вайфай?', expectInReply: ['ASI-Test-WiFi'], expectAction: 'auto_reply' },
  { id: 'edge_password', text: 'пароль?', expectInReply: ['test12345', 'оператор', 'уточн'], expectAnyInReply: true, expectAction: 'auto_reply', allowOperator: true },
  { id: 'edge_parking', text: 'парковка есть?', expectInReply: ['парковка'], expectAction: 'auto_reply' },
  { id: 'edge_dog', text: 'можно с собакой?', expectInReply: ['животн', 'собак', 'правил'], expectAnyInReply: true, expectAction: 'auto_reply' },
  { id: 'edge_late_checkout', text: 'поздний выезд возможен?', expectInReply: ['12:00', 'выезд'], expectAnyInReply: true, expectAction: 'auto_reply' },
];

const ESCALATION_CASES = [
  { id: 'esc_refund', text: 'Хочу вернуть деньги', expectNeedsOperator: true },
  { id: 'esc_cancel', text: 'Хочу отменить бронь', expectNeedsOperator: true },
  { id: 'esc_complaint', text: 'У меня жалоба', expectNeedsOperator: true },
  { id: 'esc_unhappy', text: 'Очень недоволен сервисом', expectNeedsOperator: true },
];

const FLOW_CASES = [
  { id: 'flow_1', text: 'Какой Wi-Fi?' },
  { id: 'flow_2', text: 'Есть парковка?' },
  { id: 'flow_3', text: 'Во сколько заезд?' },
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function normalizeSupabaseUrl(url) {
  const parsed = new URL(url);
  if (parsed.pathname.replace(/\/+$/, '') === '/rest/v1') parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || null;
}

function includesCi(text, needle) {
  return String(text ?? '').toLocaleLowerCase('ru-RU').includes(String(needle ?? '').toLocaleLowerCase('ru-RU'));
}

function hasAnyCi(text, needles) {
  return needles.some((needle) => includesCi(text, needle));
}

function scoreReplyQuality({ text, reply, pass, dryRun }) {
  let score = pass ? 4 : 2;
  const problems = [];
  const replyLower = reply.toLocaleLowerCase('ru-RU');

  if (/please |contact us|information unavailable|operator handoff|needs_context/i.test(reply)) {
    score -= 2;
    problems.push('рунглий или технический текст');
  }
  if (/metadata|intent|autopilot|escalation_reason|needs_operator/i.test(reply)) {
    score -= 2;
    problems.push('технические термины в ответе');
  }
  if (reply.length < 8 && pass) {
    score -= 1;
    problems.push('слишком короткий ответ');
  }
  if (!/[!?]/.test(reply) && reply.length > 20 && pass) {
    score += 0.5;
  }
  if (/поняла|подскаж|с радостью|конечно|пожалуйста/i.test(reply)) {
    score += 0.5;
  }
  if (dryRun?.escalated && !text.match(/вернуть|отмен|жалоб|недовол/i)) {
    score -= 1;
    problems.push('неожиданная эскалация');
  }
  score = Math.max(1, Math.min(5, Math.round(score)));
  return { score, problems };
}

function supabaseClient() {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  const url = normalizeSupabaseUrl(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'));
  return createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

async function getProperty(sb) {
  const { data, error } = await sb
    .from('tg_property_knowledge')
    .select('property_id,wifi_name,wifi_password,parking_text,check_in_text,check_out_time,house_rules_text,deposit,payment_rules,communication_autopilot')
    .eq('property_id', PROPERTY_ID)
    .maybeSingle();
  if (error) throw new Error(`property lookup failed: ${error.message}`);
  if (!data) throw new Error(`Missing tg_property_knowledge row for ${PROPERTY_ID}`);
  return data;
}

async function findLinkedReservation(sb) {
  const preferredChat = optionalEnv('TELEGRAM_AUTOPILOT_TEST_CHAT_ID') ?? optionalEnv('TELEGRAM_TEST_CHAT_ID') ?? '123456789';
  const { data, error } = await sb
    .from('tg_guest_reservations')
    .select('*')
    .eq('property_id', PROPERTY_ID)
    .eq('chat_id', Number(preferredChat))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`reservation lookup failed: ${error.message}`);
  if (data?.chat_id) return data;
  throw new Error(`No reservation with chat_id=${preferredChat} for ${PROPERTY_ID}`);
}

async function ensureReservationForChat(sb, chatId) {
  const guestId = `tg_${chatId}`;
  const now = new Date().toISOString();
  const { data: existingIdentity } = await sb
    .from('tg_guest_identities')
    .select('guest_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
  if (!existingIdentity) {
    await sb.from('tg_guest_identities').insert({
      guest_id: guestId,
      telegram_chat_id: Number(chatId),
      updated_at: now,
    });
  }

  const reservation = {
    id: randomUUID(),
    reservation_ref: `ASI-GUEST-REALITY-${chatId}`,
    guest_id: guestId,
    chat_id: Number(chatId),
    property_id: PROPERTY_ID,
    guest_name: 'ASI Guest Reality Check Guest',
    check_in: '2026-07-12',
    check_out: '2026-07-15',
    status: 'confirmed',
    updated_at: now,
  };
  const { error } = await sb.from('tg_guest_reservations').upsert(reservation, { onConflict: 'id' });
  if (error) throw new Error(`reservation upsert failed: ${error.message}`);
}

async function postDryRun({ baseUrl, secret, chatId, text }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/internal/telegram-dry-run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-test-secret': secret,
    },
    body: JSON.stringify({
      chatId: String(chatId),
      text,
      senderIdentity: 'test_guest',
      guestTestMode: true,
    }),
  });
  const bodyText = await response.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`invalid dry-run JSON (${response.status}): ${bodyText.slice(0, 300)}`);
  }
  if (!response.ok || !json.replyText) {
    throw new Error(`dry-run failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

async function getRecentEvents(sb, sinceIso, messageText) {
  const { data, error } = await sb
    .from('crm_events')
    .select('event_type,property_id,message_text,metadata,created_at')
    .eq('property_id', PROPERTY_ID)
    .eq('message_text', messageText)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`crm event lookup failed: ${error.message}`);
  return data ?? [];
}

async function runScenario(sb, { baseUrl, secret, startedAt, chatId, testCase, section }) {
  await ensureReservationForChat(sb, chatId);
  const dryRun = await postDryRun({ baseUrl, secret, chatId, text: testCase.text });
  const events = await getRecentEvents(sb, startedAt, testCase.text);
  const result = evaluateCase(testCase, dryRun, events);
  return {
    section,
    id: testCase.id,
    chatId,
    question: testCase.text,
    answer: result.reply,
    score: result.quality.score,
    pass: result.pass,
    problems: [...result.failures, ...result.quality.problems],
    recommendation: result.pass ? (result.quality.score >= 4 ? 'OK' : 'Улучшить формулировку') : 'Исправить маршрутизацию или шаблон',
    crmEvents: result.events,
  };
}

function evaluateCase(testCase, dryRun, events) {
  const reply = String(dryRun.replyText ?? '');
  const eventTypes = new Set(events.map((event) => event.event_type));
  const failures = [];
  const needles = testCase.expectInReply ?? [];
  if (testCase.expectAnyInReply) {
    if (!hasAnyCi(reply, needles)) failures.push(`reply missing any of: ${needles.join(', ')}`);
  } else {
    for (const needle of needles) {
      if (!includesCi(reply, needle)) failures.push(`reply missing "${needle}"`);
    }
  }
  if (testCase.expectNeedsOperator) {
    const handoff = events.find((event) => event.event_type === 'autopilot_operator_handoff');
    if (handoff?.metadata?.needs_operator !== true) failures.push('handoff metadata needs_operator is not true');
    if (!eventTypes.has('autopilot_operator_handoff')) failures.push('missing CRM event autopilot_operator_handoff');
    if (!eventTypes.has('operator_followup_required')) failures.push('missing CRM event operator_followup_required');
    if (!includesCi(reply, 'оператор')) failures.push('reply should mention operator handoff');
  } else if (testCase.expectAction === 'auto_reply' && !testCase.allowOperator) {
    if (includesCi(reply, 'передаю оператору')) failures.push('unexpected operator handoff');
    if (!eventTypes.has('autopilot_guest_reply')) failures.push('missing CRM event autopilot_guest_reply');
    if (testCase.expectResolved && !eventTypes.has('conversation_resolved')) {
      failures.push('missing CRM event conversation_resolved');
    }
  }
  const pass = failures.length === 0;
  const quality = scoreReplyQuality({ text: testCase.text, reply, pass, dryRun });
  return { pass, failures, reply, events: [...eventTypes], quality };
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  const sb = supabaseClient();
  const baseUrl = optionalEnv('ACCEPTANCE_BASE_URL') ?? optionalEnv('PRODUCTION_URL') ?? DEFAULT_BASE_URL;
  const secret = requiredEnv('INTERNAL_TEST_SECRET');
  const property = await getProperty(sb);
  const startedAt = new Date().toISOString();
  const rows = [];
  let chatCounter = Number(`99${FLOW_CHAT_SUFFIX}`);

  for (const group of SCENARIO_GROUPS) {
    for (const testCase of group.cases) {
      chatCounter += 1;
      rows.push(
        await runScenario(sb, {
          baseUrl,
          secret,
          startedAt,
          chatId: chatCounter,
          testCase,
          section: group.group,
        }),
      );
    }
  }

  for (const testCase of EDGE_CASES) {
    chatCounter += 1;
    rows.push(
      await runScenario(sb, {
        baseUrl,
        secret,
        startedAt,
        chatId: chatCounter,
        testCase,
        section: 'edge',
      }),
    );
  }

  for (const testCase of ESCALATION_CASES) {
    chatCounter += 1;
    rows.push(
      await runScenario(sb, {
        baseUrl,
        secret,
        startedAt,
        chatId: chatCounter,
        testCase,
        section: 'escalation',
      }),
    );
  }

  const flowChatId = chatCounter + 1;
  await ensureReservationForChat(sb, flowChatId);
  const flowRows = [];
  for (const testCase of FLOW_CASES) {
    const dryRun = await postDryRun({ baseUrl, secret, chatId: flowChatId, text: testCase.text });
    const events = await getRecentEvents(sb, startedAt, testCase.text);
    flowRows.push({
      id: testCase.id,
      question: testCase.text,
      answer: dryRun.replyText,
      crmEvents: [...new Set(events.map((event) => event.event_type))],
      propertyResolved: !includesCi(dryRun.replyText, 'номер бронирования'),
    });
  }
  const flowPass = flowRows.every((row) => row.propertyResolved && row.answer.length > 10);

  const failed = rows.filter((row) => !row.pass);
  const avgScore = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  const summary = {
    pass: failed.length === 0 && flowPass,
    baseUrl,
    propertyId: PROPERTY_ID,
    chatId: flowChatId,
    productionSha: null,
    startedAt,
    total: rows.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    averageScore: Number(avgScore.toFixed(2)),
    flow: { pass: flowPass, rows: flowRows },
    property: {
      communication_autopilot: property.communication_autopilot ?? null,
      wifi_name: property.wifi_name ?? null,
    },
    rows,
  };

  try {
    const versionRes = await fetch(`${baseUrl.replace(/\/$/, '')}/api/version`);
    if (versionRes.ok) summary.productionSha = (await versionRes.json()).sha ?? null;
  } catch {
    // ignore
  }

  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0 || !flowPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
