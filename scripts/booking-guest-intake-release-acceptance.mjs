#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sealData } from 'iron-session';
import { createClient } from '@supabase/supabase-js';

const BASE = String(process.env.ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PREFIX = 'ASI_GUEST_INTAKE_RELEASE_ACCEPTANCE_';
const tables = ['booking_ops_guest_intake_sessions', 'booking_ops_guest_intake_events', 'booking_ops_checkin_release_drafts'];
function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }));
}
const env = { ...loadEnv(resolve('.env.local')), ...loadEnv(resolve('КЛЮЧИ.txt')), ...process.env };
process.env.OPS_ADMIN_EMAILS = env.OPS_ADMIN_EMAILS || '';
process.env.CRM_OPERATOR_EMAILS = env.CRM_OPERATOR_EMAILS || '';
const adminEmail = String(env.OPS_ADMIN_EMAILS || '').split(/[,;\s]+/).find((value) => value.includes('@'));
const secret = String(env.SESSION_SECRET || '');
const url = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '');
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!adminEmail || secret.length < 32 || !url || !key) throw new Error('missing_acceptance_env');
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const sealed = await sealData({ userId: 'guest-intake-release-acceptance', email: adminEmail }, { password: secret, ttl: 3600 });
const headers = { Cookie: `asi_session=${sealed}`, 'Content-Type': 'application/json' };
function assert(value, message) { if (!value) throw new Error(message); }
async function post(path, bookingId, action, extra = {}, expected = 200) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify({ bookingId, action, ...extra }) });
  const body = await response.json().catch(() => ({}));
  assert(response.status === expected, `${action}_unexpected_${response.status}_${body.message || ''}`);
  return body;
}
async function cleanup(ids) {
  if (!ids.length) return 0;
  const result = await sb.from('booking_ops_records').delete().in('id', ids);
  if (result.error) throw result.error;
  return ids.length;
}

const stale = await sb.from('booking_ops_records').select('id').like('guest_name', `${PREFIX}%`);
if (stale.error) throw stale.error;
await cleanup((stale.data ?? []).map((row) => row.id));
const bookingId = randomUUID();
let cleanupCount = 0;
try {
  for (const table of tables) {
    const result = await sb.from(table).select('id', { head: true, count: 'exact' }).limit(1);
    console.log(`DB_SELECT_${table.toUpperCase()}=${result.error ? `FAIL:${result.error.message}` : 'PASS'}`);
    assert(!result.error, `${table}_select_failed`);
  }
  const created = await sb.from('booking_ops_records').insert({
    id: bookingId, guest_name: `${PREFIX}${Date.now()}`, guest_phone: '+70000000000', guest_telegram: '@asi_test_guest',
    property_id: 'guest-intake-acceptance', property_label: 'Тестовый объект заезда', ota_source: 'manual',
    check_in_at: new Date(Date.now() + 2 * 86400000).toISOString(), check_out_at: new Date(Date.now() + 5 * 86400000).toISOString(), guest_count: 2,
  });
  if (created.error) throw created.error;

  for (const path of ['/api/dashboard/booking-ops/guest-intake-release', '/api/dashboard/booking-ops/checkin-release']) {
    const response = await fetch(`${BASE}${path}?bookingId=${bookingId}`);
    console.log(`UNAUTH_${path.split('/').pop()}=${response.status}`);
    assert(response.status === 401, `unauthorized_route_not_401_${path}`);
  }

  const ensured1 = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'ensure_session');
  const ensured2 = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'ensure_session');
  assert(ensured1.snapshot.session.id === ensured2.snapshot.session.id, 'session_not_idempotent');
  assert(!ensured1.snapshot.validation.isComplete, 'initial_intake_completed');

  await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'prepare_initial_draft');
  const draftTwice = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'prepare_initial_draft');
  assert(!draftTwice.snapshot.validation.isComplete, 'draft_completed_intake');
  const initialDrafts = draftTwice.snapshot.drafts.filter((item) => item.action_id === 'initial_guest_intake');
  assert(initialDrafts.length === 1, 'initial_draft_not_idempotent');

  const partial = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'submit_simulated', { fields: { fullName: 'Тестовый Гость' } });
  assert(!partial.snapshot.validation.isComplete && partial.snapshot.validation.missingFields.length > 0, 'partial_intake_unblocked');
  await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'prepare_reminder_draft');
  const escalated = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'escalate', { reason: 'Тестовая ручная помощь' });
  assert(escalated.snapshot.session.intake_status === 'fallback_required', 'escalation_completed_intake');
  assert(escalated.snapshot.blockers.includes('guest_intake_needs_operator'), 'escalation_blocker_missing');

  await post('/api/dashboard/booking-ops/checkin-release', bookingId, 'prepare_draft', {}, 400);
  const complete = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'submit_simulated', { fields: {
    fullName: 'Тестовый Гость', phone: '+70000000000', guestCount: 2, arrivalWindow: '15:00–17:00',
    identityStatus: 'complete', citizenshipStatus: 'указано', consentAcknowledged: true,
  } });
  assert(complete.snapshot.validation.isComplete, 'complete_intake_not_completed');
  assert(complete.snapshot.blockers.includes('legal_gate_blocked'), 'legal_gate_not_blocking');

  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'initialize');
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'create_documents_request_draft');
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'record_documents_received', { documentReceived: true, documentType: 'guest_identity' });
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'mark_documents_verified_manual');
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'create_contract_draft');
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'mark_contract_signed_manual');
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'create_deposit_request_draft', { amount: 1000, currency: 'RUB' });
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'mark_deposit_paid_manual');
  await post('/api/dashboard/booking-ops/legal-payment', bookingId, 'mark_mvd_not_required', { reason: 'Тестовый сценарий' });
  const afterLegal = await post('/api/dashboard/booking-ops/guest-intake-release', bookingId, 'ensure_session');
  assert(afterLegal.snapshot.blockers.includes('physical_readiness_blocked'), 'physical_gate_not_blocking');

  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'ensure_tasks');
  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'update_cleaning', { status: 'completed' });
  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'update_cleaning', { status: 'verified' });
  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'update_linen', { status: 'delivered' });
  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'update_linen', { status: 'verified' });
  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'update_supplies', { status: 'verified' });
  await post('/api/dashboard/booking-ops/physical-readiness', bookingId, 'final_approval');

  const prepared = await post('/api/dashboard/booking-ops/checkin-release', bookingId, 'prepare_draft');
  assert(prepared.snapshot.release.status === 'draft_prepared', 'release_draft_not_prepared');
  assert(prepared.snapshot.release.draftBody.includes('не отправлено'), 'release_draft_safety_copy_missing');
  const simulated = await post('/api/dashboard/booking-ops/checkin-release', bookingId, 'simulate_release', { confirmSimulatedRelease: true });
  assert(simulated.snapshot.release.status === 'released_simulated', 'simulated_release_failed');

  const sends = await sb.from('booking_ops_telegram_drafts').select('status').eq('booking_ops_record_id', bookingId);
  if (sends.error) throw sends.error;
  assert((sends.data ?? []).every((row) => ['draft', 'copied'].includes(row.status)), 'real_message_status_found');
  console.log('GUEST_INTAKE_RELEASE_PROBE=PASS');
  console.log('EXTERNAL_SENDS=0');
} finally {
  cleanupCount = await cleanup([bookingId]);
  const leftover = await sb.from('booking_ops_records').select('id', { count: 'exact', head: true }).like('guest_name', `${PREFIX}%`);
  console.log(`CLEANUP_COUNT=${cleanupCount}`);
  console.log(`CLEANUP_LEFTOVERS=${leftover.count ?? 'unknown'}`);
  assert(!leftover.error && leftover.count === 0, 'cleanup_failed');
}
