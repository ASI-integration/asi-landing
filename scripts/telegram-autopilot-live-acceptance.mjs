#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_BASE_URL = 'https://asi-global.ru';
const PROPERTY_ID = process.env.TELEGRAM_AUTOPILOT_PROPERTY_ID?.trim() || 'prop_A';
const ACCEPTANCE_CASES = [
  {
    id: 'wifi',
    text: 'Какой Wi-Fi?',
    expectReply: ['ASI-Test-WiFi', 'test12345'],
    expectEvents: ['autopilot_guest_reply', 'conversation_resolved'],
  },
  {
    id: 'parking',
    text: 'Есть парковка?',
    expectReply: ['парковка во дворе по возможности, место не гарантируется'],
    expectEvents: ['autopilot_guest_reply', 'conversation_resolved'],
  },
  {
    id: 'checkin',
    text: 'Во сколько заезд?',
    expectReply: ['после 14:00'],
    expectEvents: ['autopilot_guest_reply', 'conversation_resolved'],
  },
  {
    id: 'refund',
    text: 'Хочу вернуть деньги',
    expectReply: ['оператор'],
    expectEvents: ['autopilot_operator_handoff', 'operator_followup_required'],
    expectNeedsOperator: true,
  },
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

function supabaseClient() {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  const url = normalizeSupabaseUrl(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'));
  return createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

async function getProperty(sb) {
  const { data, error } = await sb
    .from('tg_property_knowledge')
    .select('property_id,wifi_name,wifi_password,parking_text,check_in_text,communication_autopilot')
    .eq('property_id', PROPERTY_ID)
    .maybeSingle();
  if (error) throw new Error(`property lookup failed: ${error.message}`);
  if (!data) throw new Error(`Missing tg_property_knowledge row for ${PROPERTY_ID}`);
  return data;
}

async function findLinkedReservation(sb) {
  const preferredChat = optionalEnv('TELEGRAM_AUTOPILOT_TEST_CHAT_ID') ?? optionalEnv('TELEGRAM_TEST_CHAT_ID');
  let query = sb.from('tg_guest_reservations').select('*').eq('property_id', PROPERTY_ID);
  if (preferredChat) query = query.eq('chat_id', Number(preferredChat));
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(10);
  if (error) throw new Error(`reservation lookup failed: ${error.message}`);
  const direct = (data ?? []).find((row) => row.chat_id);
  if (direct) return direct;

  const { data: allRows, error: allError } = await sb
    .from('tg_guest_reservations')
    .select('*')
    .eq('property_id', PROPERTY_ID)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (allError) throw new Error(`reservation lookup failed: ${allError.message}`);
  for (const row of allRows ?? []) {
    if (!row.guest_id) continue;
    const { data: identity, error: identityError } = await sb
      .from('tg_guest_identities')
      .select('*')
      .eq('guest_id', row.guest_id)
      .maybeSingle();
    if (identityError) throw new Error(`identity lookup failed: ${identityError.message}`);
    if (identity?.telegram_chat_id) return { ...row, chat_id: identity.telegram_chat_id, identity, needsChatLink: true };
  }
  return null;
}

async function ensureLinkedReservation(sb) {
  const existing = await findLinkedReservation(sb);
  if (existing) {
    if (existing.needsChatLink && existing.id && existing.chat_id) {
      const { data, error } = await sb
        .from('tg_guest_reservations')
        .update({ chat_id: Number(existing.chat_id), updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw new Error(`reservation chat_id link update failed: ${error.message}`);
      return { row: data, created: false, updated: true };
    }
    return { row: existing, created: false, updated: false };
  }

  const chatId = optionalEnv('TELEGRAM_AUTOPILOT_TEST_CHAT_ID') ?? optionalEnv('TELEGRAM_TEST_CHAT_ID');
  if (!chatId) {
    throw new Error('No prop_A reservation link found. Set TELEGRAM_AUTOPILOT_TEST_CHAT_ID to create one.');
  }

  const guestId = `tg_${chatId}`;
  const now = new Date().toISOString();
  const identity = {
    guest_id: guestId,
    telegram_chat_id: Number(chatId),
    display_name: 'ASI Autopilot Acceptance Guest',
    trust_status: 'normal',
    last_seen_at: now,
    updated_at: now,
  };
  const { error: identityError } = await sb.from('tg_guest_identities').upsert(identity, { onConflict: 'guest_id' });
  if (identityError) throw new Error(`identity upsert failed: ${identityError.message}`);

  const reservation = {
    id: 'ASI-AUTOPILOT-PROP-A-LIVE',
    reservation_ref: 'ASI-AUTOPILOT-PROP-A-LIVE',
    guest_id: guestId,
    chat_id: Number(chatId),
    property_id: PROPERTY_ID,
    guest_name: 'ASI Autopilot Acceptance Guest',
    check_in: '2026-07-12',
    check_out: '2026-07-15',
    status: 'confirmed',
    updated_at: now,
  };
  const { data, error } = await sb
    .from('tg_guest_reservations')
    .upsert(reservation, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(`reservation upsert failed: ${error.message}`);
  return { row: data, created: true, updated: false };
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

async function main() {
  const sb = supabaseClient();
  const baseUrl = optionalEnv('ACCEPTANCE_BASE_URL') ?? optionalEnv('PRODUCTION_URL') ?? DEFAULT_BASE_URL;
  const secret = requiredEnv('INTERNAL_TEST_SECRET');
  const property = await getProperty(sb);
  const link = await ensureLinkedReservation(sb);
  const chatId = Number(link.row.chat_id);
  if (!Number.isFinite(chatId)) throw new Error('Resolved prop_A link has no numeric chat_id');

  const startedAt = new Date().toISOString();
  const rows = [];

  for (const testCase of ACCEPTANCE_CASES) {
    const dryRun = await postDryRun({ baseUrl, secret, chatId, text: testCase.text });
    const reply = String(dryRun.replyText ?? '');
    const events = await getRecentEvents(sb, startedAt, testCase.text);
    const eventTypes = new Set(events.map((event) => event.event_type));
    const failures = [];

    for (const needle of testCase.expectReply) {
      if (!includesCi(reply, needle)) failures.push(`reply missing "${needle}"`);
    }
    for (const eventType of testCase.expectEvents) {
      if (!eventTypes.has(eventType)) failures.push(`missing CRM event ${eventType}`);
    }
    if (testCase.expectNeedsOperator) {
      const handoff = events.find((event) => event.event_type === 'autopilot_operator_handoff');
      if (handoff?.metadata?.needs_operator !== true) failures.push('handoff metadata needs_operator is not true');
    }

    rows.push({
      id: testCase.id,
      text: testCase.text,
      pass: failures.length === 0,
      failures,
      reply,
      events: [...eventTypes],
    });
  }

  const failed = rows.filter((row) => !row.pass);
  const summary = {
    pass: failed.length === 0,
    baseUrl,
    propertyId: PROPERTY_ID,
    chatId,
    reservationId: link.row.id ?? null,
    reservationRef: link.row.reservation_ref ?? link.row.booking_id ?? null,
    guestId: link.row.guest_id ?? null,
    linkCreated: link.created,
    linkUpdated: link.updated,
    property: {
      communication_autopilot: property.communication_autopilot ?? null,
      wifi_name: property.wifi_name ?? null,
      wifi_password: property.wifi_password ?? null,
      parking_text: property.parking_text ?? null,
      check_in_text: property.check_in_text ?? null,
    },
    startedAt,
    total: rows.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    rows,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
