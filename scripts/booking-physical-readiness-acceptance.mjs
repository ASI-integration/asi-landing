#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sealData } from 'iron-session';
import { createClient } from '@supabase/supabase-js';

const BASE = String(process.env.ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PREFIX = 'ASI_PHYSICAL_READINESS_ACCEPTANCE_';
function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}
const env = { ...loadEnv(resolve('.env.local')), ...loadEnv(resolve('КЛЮЧИ.txt')), ...process.env };
process.env.OPS_ADMIN_EMAILS = env.OPS_ADMIN_EMAILS || '';
process.env.CRM_OPERATOR_EMAILS = env.CRM_OPERATOR_EMAILS || '';
const adminEmail = String(env.OPS_ADMIN_EMAILS || '').split(/[,;\s]+/).find((value) => value.includes('@'));
const sessionSecret = String(env.SESSION_SECRET || '');
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '');
const supabaseKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!adminEmail || sessionSecret.length < 32 || !supabaseUrl || !supabaseKey) throw new Error('missing_acceptance_env');

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sealed = await sealData({ userId: 'physical-readiness-acceptance', email: adminEmail }, { password: sessionSecret, ttl: 3600 });
const headers = { Cookie: `asi_session=${sealed}`, 'Content-Type': 'application/json' };
const tableNames = [
  'booking_cleaning_tasks', 'booking_linen_tasks', 'booking_supplies_tasks',
  'booking_maintenance_tickets', 'booking_physical_readiness', 'booking_physical_coordination_drafts',
];
function assert(value, message) { if (!value) throw new Error(message); }
function keys(readiness) { return readiness.blockers.map((item) => item.key); }
async function action(bookingId, name, extra = {}) {
  const response = await fetch(`${BASE}/api/dashboard/booking-ops/physical-readiness`, {
    method: 'POST', headers, body: JSON.stringify({ bookingId, action: name, ...extra }),
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 200 && body.ok && body.readiness, `${name}_failed_${response.status}_${body.message || ''}`);
  return body.readiness;
}
async function cleanup(ids) {
  if (!ids.length) return 0;
  const { error } = await sb.from('booking_ops_records').delete().in('id', ids);
  if (error) throw error;
  return ids.length;
}

const stale = await sb.from('booking_ops_records').select('id').like('guest_name', `${PREFIX}%`);
if (stale.error) throw stale.error;
await cleanup((stale.data ?? []).map((row) => row.id));
const bookingId = randomUUID();
let cleanupCount = 0;
try {
  for (const table of tableNames) {
    const result = await sb.from(table).select('id', { head: true, count: 'exact' }).limit(1);
    console.log(`DB_SELECT_${table.toUpperCase()}=${result.error ? `FAIL:${result.error.message}` : 'PASS'}`);
    assert(!result.error, `${table}_select_failed`);
  }
  const created = await sb.from('booking_ops_records').insert({
    id: bookingId, guest_name: `${PREFIX}${Date.now()}`, property_id: 'physical-acceptance', property_label: 'Тестовый объект готовности',
    check_in_at: new Date(Date.now() + 86400000).toISOString(), check_out_at: new Date(Date.now() + 3 * 86400000).toISOString(),
  });
  if (created.error) throw created.error;

  const unauthenticated = await fetch(`${BASE}/api/dashboard/booking-ops/physical-readiness?bookingId=${bookingId}`);
  console.log(`UNAUTHENTICATED_STATUS=${unauthenticated.status}`);
  assert(unauthenticated.status === 401, 'unauthenticated_route_not_401');

  const first = await action(bookingId, 'ensure_tasks');
  const second = await action(bookingId, 'ensure_tasks');
  assert(first.cleaning.id === second.cleaning.id && first.linen.id === second.linen.id && first.supplies.id === second.supplies.id, 'ensure_tasks_not_idempotent');
  assert(keys(first).includes('cleaning_not_verified'), 'initial_cleaning_blocker_missing');

  for (const taskType of ['cleaning', 'linen', 'maintenance', 'operator']) await action(bookingId, 'create_draft', { taskType });
  let readiness = await action(bookingId, 'recompute');
  assert(readiness.drafts.length === 4 && readiness.cleaning.status === 'pending' && readiness.linen.status === 'pending', 'draft_changed_execution_state');

  readiness = await action(bookingId, 'update_cleaning', { status: 'completed', reportPayload: { photoReportConfirmed: true } });
  assert(keys(readiness).includes('cleaning_not_verified'), 'cleaning_completed_released_gate');
  readiness = await action(bookingId, 'update_cleaning', { status: 'verified' });
  assert(!keys(readiness).includes('cleaning_not_verified'), 'cleaning_verification_did_not_clear');

  readiness = await action(bookingId, 'update_linen', { status: 'delivered', reportPayload: { deliveryReportConfirmed: true } });
  assert(keys(readiness).includes('linen_not_verified'), 'linen_delivered_released_gate');
  readiness = await action(bookingId, 'update_linen', { status: 'verified' });
  assert(!keys(readiness).includes('linen_not_verified'), 'linen_verification_did_not_clear');

  readiness = await action(bookingId, 'create_maintenance', { title: 'Тестовая блокирующая неисправность', isBlocking: true, priority: 'critical' });
  const ticketId = readiness.maintenance[0]?.id;
  assert(ticketId && keys(readiness).includes('blocking_maintenance_open'), 'maintenance_open_not_blocking');
  readiness = await action(bookingId, 'update_maintenance', { ticketId, status: 'resolved' });
  assert(keys(readiness).includes('blocking_maintenance_open'), 'maintenance_resolved_released_gate');
  readiness = await action(bookingId, 'update_maintenance', { ticketId, status: 'verified' });
  assert(!keys(readiness).includes('blocking_maintenance_open'), 'maintenance_verified_did_not_clear');

  readiness = await action(bookingId, 'update_supplies', { status: 'verified', reportPayload: { checklistConfirmed: true } });
  assert(readiness.operationalBlockers.length === 0 && !readiness.finalReady, 'final_approval_gate_missing');
  readiness = await action(bookingId, 'final_approval');
  assert(readiness.finalReady && readiness.status === 'approved', 'final_approval_failed');

  const checkin = await fetch(`${BASE}/api/dashboard/booking-ops/checkin-execution?bookingId=${bookingId}`, { headers });
  const checkinBody = await checkin.json().catch(() => ({}));
  console.log(`CHECKIN_WITH_LEGAL_INCOMPLETE=${checkin.status}:${checkinBody.checkin?.status || 'unknown'}`);
  assert(checkin.status === 200 && checkinBody.checkin?.status !== 'ready_to_send_instructions', 'physical_ready_bypassed_legal_gate');
  console.log('PHYSICAL_READINESS_PROBE=PASS');
} finally {
  cleanupCount = await cleanup([bookingId]);
  const leftover = await sb.from('booking_ops_records').select('id', { count: 'exact', head: true }).like('guest_name', `${PREFIX}%`);
  console.log(`CLEANUP_COUNT=${cleanupCount}`);
  console.log(`CLEANUP_LEFTOVERS=${leftover.count ?? 'unknown'}`);
  assert(!leftover.error && leftover.count === 0, 'cleanup_failed');
}
