#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { sealData } from 'iron-session';

const BASE = String(process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/u, '');
const EXPECTED_SHA = String(process.env.EXPECTED_SHA || '').trim();
const PREFIX = 'ASI_LIFECYCLE_ORCHESTRATOR_V1_ACCEPTANCE_';

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/u).flatMap((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || !clean.includes('=')) return [];
    const index = clean.indexOf('=');
    return [[clean.slice(0, index).trim(), clean.slice(index + 1).trim().replace(/^['"]|['"]$/gu, '')]];
  }));
}

function runtimeEnv() {
  const fromFile = parseEnvFile('/var/www/asi/shared/.env.production.live');
  try {
    const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
    const app = processes.find((item) => item.name === 'asi-landing');
    return { ...fromFile, ...(app?.pm2_env?.env ?? {}), ...process.env };
  } catch { return { ...fromFile, ...process.env }; }
}

function requireValue(value, name) {
  const clean = String(value || '').trim();
  if (!clean) throw new Error(`missing_${name}`);
  return clean;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = runtimeEnv();
const sessionSecret = requireValue(env.SESSION_SECRET, 'session_secret');
const supabaseUrl = requireValue(env.NEXT_PUBLIC_SUPABASE_URL, 'supabase_url').replace(/\/rest\/v1\/?$/u, '');
const supabaseKey = requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role_key');
const admins = String(env.OPS_ADMIN_EMAILS || '').split(/[,;\s]+/u).filter((value) => value.includes('@'));
const operators = new Set(String(env.CRM_OPERATOR_EMAILS || '').split(/[,;\s]+/u).map((value) => value.toLowerCase()));
const adminEmail = admins.find((value) => operators.has(value.toLowerCase())) || admins[0];
assert(adminEmail, 'missing_ops_admin_email');

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sealed = await sealData({ userId: 'lifecycle-orchestrator-acceptance', email: adminEmail }, { password: sessionSecret, ttl: 3600 });
const headers = { cookie: `asi_session=${sealed}`, 'content-type': 'application/json' };
let recordId = null;
let failure = null;

async function json(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function cleanup(ids) {
  if (!ids.length) return 0;
  for (const [table, column] of [
    ['booking_ops_telegram_drafts', 'booking_ops_record_id'],
    ['booking_ops_tasks', 'booking_ops_record_id'],
  ]) {
    const { error: childError } = await sb.from(table).delete().in(column, ids);
    if (childError) throw new Error(`cleanup_failed:${table}:${childError.message}`);
  }
  const { error } = await sb.from('booking_ops_records').delete().in('id', ids);
  if (error) throw new Error(`cleanup_failed:${error.message}`);
  const { count } = await sb.from('booking_ops_records').select('id', { count: 'exact', head: true }).in('id', ids);
  return count ?? 0;
}

try {
  if (process.env.SKIP_VERSION !== 'true') {
    const version = await json('/api/version');
    assert(version.response.status === 200, 'version_status');
    if (EXPECTED_SHA) assert(String(version.body.sha || '').startsWith(EXPECTED_SHA), `version_mismatch:${version.body.sha}`);
    console.log('VERSION_SHA', version.body.sha);
  }
  for (const path of ['/api/health', '/dashboard/booking-ops', '/dashboard/crm', '/dashboard/property-knowledge']) {
    const response = await fetch(`${BASE}${path}`);
    console.log('ROUTE', path, response.status);
    assert(response.status === 200, `route_failed:${path}:${response.status}`);
  }
  for (const [path, method] of [
    ['/api/dashboard/booking-ops/lifecycle-orchestrator?bookingId=00000000-0000-4000-8000-000000000001', 'GET'],
    ['/api/dashboard/booking-ops/lifecycle-orchestrator', 'POST'],
    ['/api/dashboard/booking-ops/lifecycle-orchestrator/due', 'POST'],
  ]) {
    const response = await fetch(`${BASE}${path}`, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} });
    console.log('UNAUTHORIZED', path, response.status);
    assert(response.status === 401, `unauthorized_failed:${path}:${response.status}`);
  }

  const { data: stale, error: staleError } = await sb.from('booking_ops_records').select('id').like('guest_name', `${PREFIX}%`);
  if (staleError) throw staleError;
  await cleanup((stale ?? []).map((row) => row.id));

  const runId = Date.now().toString(36);
  const checkIn = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const checkOut = new Date(checkIn.getTime() + 48 * 60 * 60 * 1000);
  const created = await json('/api/dashboard/booking-ops', {
    method: 'POST', headers, body: JSON.stringify({
      guestName: `${PREFIX}${runId}`, guestPhone: '+79990000123', guestTelegram: `tg_${runId}`,
      propertyId: `lifecycle_probe_${runId}`, propertyLabel: 'Тестовый объект оркестратора', otaSource: 'manual',
      checkInAt: checkIn.toISOString(), checkOutAt: checkOut.toISOString(), guestCount: 2,
      documentRequired: true, contractRequired: true, depositRequired: true, depositAmount: 5000, mvdRequired: true,
      notes: `${PREFIX} безопасная тестовая запись`,
    }),
  });
  assert(created.response.status === 201 && created.body.record?.id, `create_failed:${created.response.status}`);
  recordId = created.body.record.id;

  const initial = await json(`/api/dashboard/booking-ops/lifecycle-orchestrator?bookingId=${recordId}`, { headers });
  assert(initial.response.status === 200 && initial.body.orchestration?.state, 'initial_state_missing');
  assert(initial.body.orchestration.state.finalCheckinDraftAllowed === false, 'initial_release_should_be_blocked');
  assert(initial.body.orchestration.slaItems.length === 6, 'sla_items_missing');
  assert(initial.body.orchestration.events.length > 0, 'events_missing');

  const requiredTables = [
    ['booking_ops_guest_intake_sessions', 'booking_ops_record_id'], ['booking_guest_documents', 'booking_id'],
    ['booking_contracts', 'booking_id'], ['booking_deposits', 'booking_id'], ['booking_mvd_reports', 'booking_id'],
    ['booking_cleaning_tasks', 'booking_id'], ['booking_linen_tasks', 'booking_id'], ['booking_supplies_tasks', 'booking_id'],
  ];
  for (const [table, column] of requiredTables) {
    const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(column, recordId);
    if (error) throw error;
    assert((count ?? 0) > 0, `required_state_missing:${table}`);
  }

  const countsBefore = {};
  for (const table of ['booking_ops_lifecycle_drafts', 'booking_ops_telegram_drafts', 'booking_cleaning_tasks', 'booking_linen_tasks', 'booking_supplies_tasks']) {
    const column = table === 'booking_ops_telegram_drafts' ? 'booking_ops_record_id' : 'booking_id';
    const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(column, recordId);
    countsBefore[table] = count ?? 0;
  }
  for (let index = 0; index < 2; index += 1) {
    const rerun = await json('/api/dashboard/booking-ops/lifecycle-orchestrator', { method: 'POST', headers, body: JSON.stringify({ bookingId: recordId, action: 'orchestrate' }) });
    assert(rerun.response.status === 200, `rerun_failed:${index}:${rerun.response.status}:${JSON.stringify(rerun.body)}`);
  }
  for (const [table, before] of Object.entries(countsBefore)) {
    const column = table === 'booking_ops_telegram_drafts' ? 'booking_ops_record_id' : 'booking_id';
    const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(column, recordId);
    assert((count ?? 0) === before, `idempotency_failed:${table}:${before}:${count}`);
  }

  const partial = await json('/api/dashboard/booking-ops/guest-intake-release', {
    method: 'POST', headers, body: JSON.stringify({ bookingId: recordId, action: 'submit_simulated', fields: { fullName: 'Тестовый Гость', phone: '+79990000123' } }),
  });
  assert(partial.response.status === 200 && partial.body.snapshot?.validation?.dataStatus === 'partial', 'partial_guest_failed');
  const overdueNow = new Date(checkIn.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const overdue = await json('/api/dashboard/booking-ops/lifecycle-orchestrator', {
    method: 'POST', headers, body: JSON.stringify({ bookingId: recordId, action: 'orchestrate', now: overdueNow }),
  });
  assert(overdue.response.status === 200 && overdue.body.orchestration.state.slaStatus === 'overdue', 'overdue_not_detected');
  assert(overdue.body.orchestration.lastRun.createdDraftsCount > 0, 'overdue_draft_missing');
  assert(overdue.body.orchestration.state.finalCheckinDraftAllowed === false, 'partial_guest_bypassed_gate');

  const completeGuest = await json('/api/dashboard/booking-ops/guest-intake-release', {
    method: 'POST', headers, body: JSON.stringify({ bookingId: recordId, action: 'submit_simulated', fields: {
      fullName: 'Тестовый Гость', phone: '+79990000123', guestCount: 2, arrivalWindow: '15:00–16:00',
      identityStatus: 'verified', citizenshipStatus: 'РФ', consentAcknowledged: true,
    } }),
  });
  assert(completeGuest.response.status === 200 && completeGuest.body.snapshot?.validation?.isComplete === true, 'guest_completion_failed');

  for (const [table, patch] of [
    ['booking_guest_documents', { status: 'verified' }], ['booking_contracts', { status: 'signed_manual' }],
    ['booking_deposits', { status: 'paid_manual' }], ['booking_mvd_reports', { status: 'accepted_manual' }],
    ['booking_cleaning_tasks', { status: 'verified', verified_at: new Date().toISOString() }],
    ['booking_linen_tasks', { status: 'verified', verified_at: new Date().toISOString() }],
    ['booking_supplies_tasks', { status: 'verified', verified_at: new Date().toISOString() }],
  ]) {
    const { error } = await sb.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq('booking_id', recordId);
    if (error) throw error;
  }
  const approve = await json('/api/dashboard/booking-ops/physical-readiness', { method: 'POST', headers, body: JSON.stringify({ bookingId: recordId, action: 'final_approval' }) });
  assert(approve.response.status === 200 && approve.body.readiness?.finalReady === true, 'physical_approval_failed');
  const finalRun = await json('/api/dashboard/booking-ops/lifecycle-orchestrator', { method: 'POST', headers, body: JSON.stringify({ bookingId: recordId, action: 'orchestrate' }) });
  assert(finalRun.response.status === 200, 'final_run_failed');
  assert(finalRun.body.orchestration.state.currentStage === 'checkin_release_draft_prepared', `final_stage:${finalRun.body.orchestration.state.currentStage}`);
  assert(finalRun.body.orchestration.state.finalCheckinDraftId, 'final_draft_missing');
  const { data: release } = await sb.from('booking_ops_checkin_release_drafts').select('status,metadata').eq('booking_id', recordId).single();
  assert(release?.status === 'draft_prepared' && release?.metadata?.noExternalSend === true, 'release_not_draft_only');

  console.log('ORCHESTRATION_STATE', finalRun.body.orchestration.state.currentStage);
  console.log('IDEMPOTENCY', 'PASS');
  console.log('SLA_OVERDUE_AND_DRAFTS', 'PASS');
  console.log('FINAL_CHECKIN_DRAFT_ONLY', 'PASS');
} catch (error) {
  failure = error;
} finally {
  try {
    const leftovers = await cleanup(recordId ? [recordId] : []);
    console.log('CLEANUP_LEFTOVERS', leftovers);
    if (leftovers !== 0 && !failure) failure = new Error(`cleanup_leftovers:${leftovers}`);
  } catch (cleanupError) { if (!failure) failure = cleanupError; }
}

if (failure) {
  console.error('RESULT', 'FAIL', failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
} else {
  console.log('NO_REAL_EXTERNAL_SIDE_EFFECTS', 'PASS');
  console.log('RESULT', 'PASS');
}
