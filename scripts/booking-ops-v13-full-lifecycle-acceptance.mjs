#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sealData } from 'iron-session';
import { createClient } from '@supabase/supabase-js';

const BASE = String(process.env.ACCEPTANCE_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PREFIX = 'ASI_OPS_V13_LIFECYCLE_ACCEPTANCE_';
const ACCEPTANCE_EMAIL = 'staging-acceptance@asi.local';
const FIXTURE_ACCOUNT_PREFIX = 'ASI staging acceptance ';

const EXPECTED_COMMUNICATION_PURPOSES = [
  'checkin_instructions',
  'send_checkin_instructions',
  'guest_issue_acknowledgement',
  'guest_stay_issue_followup',
  'checkout_instructions',
  'checkout_confirmation_request',
  'checkout_reminder',
  'inspection_request',
];

const CLEANING_CHAIN = [
  'checkout_confirmed',
  'cleaning_needed',
  'cleaning_assigned',
  'cleaning_in_progress',
  'cleaning_done',
  'unit_inspection_needed',
  'inspection_needed',
];

function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/gu, '')];
    }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = {
  ...loadEnv(resolve('.env.local')),
  ...loadEnv(resolve('КЛЮЧИ.txt')),
  ...process.env,
};
process.env.OPS_ADMIN_EMAILS = env.OPS_ADMIN_EMAILS || '';
process.env.CRM_OPERATOR_EMAILS = env.CRM_OPERATOR_EMAILS || '';

const admins = String(env.OPS_ADMIN_EMAILS || '').split(/[,;\s]+/u).filter((value) => value.includes('@'));
const operators = new Set(String(env.CRM_OPERATOR_EMAILS || '').split(/[,;\s]+/u).map((value) => value.toLowerCase()));
const adminEmail = admins.find((value) => operators.has(value.toLowerCase())) || admins[0];
const sessionSecret = String(env.SESSION_SECRET || '');
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/u, '');
const supabaseKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');

assert(adminEmail, 'missing_ops_admin_email');
assert(adminEmail.toLowerCase() === ACCEPTANCE_EMAIL, 'staging_acceptance_email_required');
assert(operators.has(ACCEPTANCE_EMAIL), 'staging_acceptance_operator_required');
assert(sessionSecret.length >= 32, 'missing_session_secret');
assert(supabaseUrl && supabaseKey, 'missing_supabase_env');
for (const [key, expected] of Object.entries({
  DRY_RUN_TELEGRAM_OUTBOUND: 'true',
  ALLOW_REAL_TELEGRAM_SYNTHETIC: 'false',
  EMAIL_AUTO_SEND: 'false',
  EMAIL_DRAFT_ONLY: 'true',
  LLM_ENABLED: 'false',
  YOOKASSA_ENABLED: 'false',
})) assert(String(env[key] ?? '').toLowerCase() === expected, `unsafe_runtime_flag:${key}`);

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userId = randomUUID();
const accountId = randomUUID();
const propertyId = randomUUID();
const sealed = await sealData(
  { userId, email: adminEmail },
  { password: sessionSecret, ttl: 3600 },
);
const headers = { Cookie: `asi_session=${sealed}`, 'Content-Type': 'application/json' };

let recordId = null;
let failure = null;
const lifecycleStagesPassed = [];
const duplicatesAvoided = {};

async function json(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function post(path, payload, expected = 200) {
  const { response, body } = await json(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  assert(response.status === expected, `${path}_status_${response.status}_${body.message || JSON.stringify(body)}`);
  return body;
}

async function patchTask(taskId, status) {
  const { response, body } = await json(`/api/dashboard/booking-ops/${recordId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status }),
  });
  assert(response.status === 200 && body.ok, `patch_task_${taskId}_${response.status}_${body.message || ''}`);
  return body;
}

async function cleanup(ids) {
  if (!ids.length) return 0;
  for (const [table, column] of [
    ['booking_ops_telegram_drafts', 'booking_ops_record_id'],
    ['booking_ops_tasks', 'booking_ops_record_id'],
    ['booking_ops_communication_intents', 'booking_ops_record_id'],
  ]) {
    const { error } = await sb.from(table).delete().in(column, ids);
    if (error) throw new Error(`cleanup_failed:${table}:${error.message}`);
  }
  const { error } = await sb.from('booking_ops_records').delete().in('id', ids);
  if (error) throw new Error(`cleanup_failed:${error.message}`);
  const { count } = await sb.from('booking_ops_records').select('id', { count: 'exact', head: true }).in('id', ids);
  return count ?? 0;
}

async function cleanupSyntheticIdentity() {
  const staleAccounts = await sb.from('accounts').select('id').like('name', `${FIXTURE_ACCOUNT_PREFIX}%`);
  if (staleAccounts.error) throw new Error(`cleanup_failed:accounts_lookup:${staleAccounts.error.message}`);
  if (staleAccounts.data?.length) {
    const result = await sb.from('accounts').delete().in('id', staleAccounts.data.map((row) => row.id));
    if (result.error) throw new Error(`cleanup_failed:accounts:${result.error.message}`);
  }
  const users = await sb.from('users').delete().eq('email', ACCEPTANCE_EMAIL);
  if (users.error) throw new Error(`cleanup_failed:users:${users.error.message}`);
}

async function createSyntheticIdentity(runId) {
  const user = await sb.from('users').insert({
    id: userId,
    email: ACCEPTANCE_EMAIL,
    password_hash: `${PREFIX}${runId}`,
  });
  if (user.error) throw new Error(`fixture_user_failed:${user.error.message}`);
  const account = await sb.from('accounts').insert({
    id: accountId,
    name: `${FIXTURE_ACCOUNT_PREFIX}${runId}`,
    plan_code: 'small',
    subscription_status: 'trial',
  });
  if (account.error) throw new Error(`fixture_account_failed:${account.error.message}`);
  const member = await sb.from('account_members').insert({ account_id: accountId, user_id: userId, role: 'owner' });
  if (member.error) throw new Error(`fixture_member_failed:${member.error.message}`);
  const property = await sb.from('properties').insert({
    id: propertyId,
    account_id: accountId,
    name: `${PREFIX}${runId}`,
    status: 'active',
  });
  if (property.error) throw new Error(`fixture_property_failed:${property.error.message}`);
}

async function listAlerts() {
  const { data, error } = await sb
    .from('booking_ops_alerts')
    .select('id, booking_id, status, dedupe_key')
    .eq('booking_id', recordId)
    .order('id');
  if (error) throw error;
  return data ?? [];
}

async function countRows(table, column = 'booking_id') {
  const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(column, recordId);
  if (error) throw error;
  return count ?? 0;
}

async function verifyAlerts(checkIn) {
  const alertNow = new Date(checkIn.getTime() - 30 * 60 * 1000).toISOString();
  const first = await post('/api/dashboard/booking-ops/alerts/orchestrate', {
    bookingId: recordId,
    now: alertNow,
    dryRun: false,
    executeAutomation: false,
  });
  assert(first.result?.errors?.length === 0, `alerts_first_errors:${JSON.stringify(first.result?.errors)}`);
  const before = await listAlerts();
  assert(before.length > 0 && first.result?.alertsCreated > 0, 'alerts_not_created');
  const operatorTasks = await listTasks();
  assert(operatorTasks.length > 0, 'alert_operator_task_missing');
  assert(before.every((alert) => alert.booking_id === recordId), 'alert_booking_link_missing');

  const second = await post('/api/dashboard/booking-ops/alerts/orchestrate', {
    bookingId: recordId,
    now: alertNow,
    dryRun: false,
    executeAutomation: false,
  });
  assert(second.result?.errors?.length === 0, `alerts_second_errors:${JSON.stringify(second.result?.errors)}`);
  const after = await listAlerts();
  assert(second.result?.alertsCreated === 0, `alerts_duplicated:${second.result?.alertsCreated}`);
  assert(after.length === before.length, `alerts_count_grew:${before.length}->${after.length}`);
  assert(after.map((alert) => alert.id).join(',') === before.map((alert) => alert.id).join(','), 'alert_ids_changed');
  duplicatesAvoided.alerts = 'PASS';
  console.log('ALERTS_IDEMPOTENCY', 'PASS', `alerts=${after.length}`, `operatorTasks=${operatorTasks.length}`);
}

async function verifyReconciliation() {
  const state = await sb.from('booking_ops_lifecycle_states').select('booking_id,next_action').eq('booking_id', recordId).single();
  if (state.error) throw new Error(`reconciliation_state_missing:${state.error.message}`);
  const forced = await sb.from('booking_ops_lifecycle_states')
    .update({ next_action: `${PREFIX}FORCED_DIFF`, updated_at: new Date().toISOString() })
    .eq('booking_id', recordId)
    .select('booking_id')
    .single();
  if (forced.error) throw new Error(`reconciliation_fixture_failed:${forced.error.message}`);

  const beforeDryRun = {
    tasks: await countRows('booking_ops_tasks', 'booking_ops_record_id'),
    alerts: await countRows('booking_ops_alerts'),
    events: await countRows('booking_ops_lifecycle_events'),
  };
  const preview = await post('/api/admin/booking-ops-lifecycle-reconciliation', {
    bookingOpsRecordId: recordId,
    dryRun: true,
  });
  assert(preview.result?.dryRun === true && preview.result?.changed === true, 'reconciliation_preview_diff_missing');
  assert(preview.result?.projectionChanged === true, 'reconciliation_preview_projection_diff_missing');
  assert(await countRows('booking_ops_tasks', 'booking_ops_record_id') === beforeDryRun.tasks, 'reconciliation_dry_run_tasks_changed');
  assert(await countRows('booking_ops_alerts') === beforeDryRun.alerts, 'reconciliation_dry_run_alerts_changed');
  assert(await countRows('booking_ops_lifecycle_events') === beforeDryRun.events, 'reconciliation_dry_run_events_changed');

  const applied = await post('/api/admin/booking-ops-lifecycle-reconciliation', {
    bookingOpsRecordId: recordId,
    dryRun: false,
  });
  assert(applied.result?.dryRun === false && applied.result?.changed === true, 'reconciliation_apply_missing');
  const afterApply = {
    tasks: await countRows('booking_ops_tasks', 'booking_ops_record_id'),
    alerts: await countRows('booking_ops_alerts'),
    events: await countRows('booking_ops_lifecycle_events'),
  };
  const repeated = await post('/api/admin/booking-ops-lifecycle-reconciliation', {
    bookingOpsRecordId: recordId,
    dryRun: true,
  });
  assert(repeated.result?.changed === false, 'reconciliation_repeated_changed');
  assert(repeated.result?.projectionChanged === false, 'reconciliation_repeated_projection_changed');
  assert(repeated.result?.taskRepairs === 0, `reconciliation_repeated_task_repairs:${repeated.result?.taskRepairs}`);
  assert(await countRows('booking_ops_tasks', 'booking_ops_record_id') === afterApply.tasks, 'reconciliation_repeated_tasks_changed');
  assert(await countRows('booking_ops_alerts') === afterApply.alerts, 'reconciliation_repeated_alerts_changed');
  assert(await countRows('booking_ops_lifecycle_events') === afterApply.events, 'reconciliation_repeated_events_changed');
  duplicatesAvoided.reconciliation = 'PASS';
  console.log('RECONCILIATION_IDEMPOTENCY', 'PASS', JSON.stringify(repeated.result));
}

async function countCommunicationsByPurpose(purpose) {
  const { count, error } = await sb
    .from('booking_ops_communication_intents')
    .select('id', { count: 'exact', head: true })
    .eq('booking_ops_record_id', recordId)
    .eq('purpose', purpose);
  if (error) throw error;
  return count ?? 0;
}

async function listCommunications() {
  const { data, error } = await sb
    .from('booking_ops_communication_intents')
    .select('purpose')
    .eq('booking_ops_record_id', recordId);
  if (error) throw error;
  return data ?? [];
}

async function listTasks() {
  const { data, error } = await sb
    .from('booking_ops_tasks')
    .select('id, task_type, status')
    .eq('booking_ops_record_id', recordId);
  if (error) throw error;
  return data ?? [];
}

async function gateStatus(gateKey) {
  const { data, error } = await sb
    .from('booking_lifecycle_gates')
    .select('status')
    .eq('booking_id', recordId)
    .eq('gate_key', gateKey)
    .maybeSingle();
  if (error) throw error;
  return data?.status ?? null;
}

async function completeOpenTasksByTypes(taskTypes) {
  const tasks = await listTasks();
  for (const taskType of taskTypes) {
    const open = tasks.filter((task) => task.task_type === taskType && task.status !== 'completed');
    for (const task of open) {
      await patchTask(task.id, 'completed');
      await post(`/api/dashboard/booking-ops/${recordId}/recompute`, {});
    }
  }
}

async function satisfyLegalAndPhysicalReadiness() {
  const completeGuest = await post('/api/dashboard/booking-ops/guest-intake-release', {
    bookingId: recordId,
    action: 'submit_simulated',
    fields: {
      fullName: 'Тестовый Гость V13',
      phone: '+79990000999',
      guestCount: 2,
      arrivalWindow: '15:00–16:00',
      identityStatus: 'verified',
      citizenshipStatus: 'РФ',
      consentAcknowledged: true,
    },
  });
  assert(completeGuest.snapshot?.validation?.isComplete === true, 'guest_intake_incomplete');

  for (const [table, patch] of [
    ['booking_guest_documents', { status: 'verified' }],
    ['booking_contracts', { status: 'signed_manual' }],
    ['booking_deposits', { status: 'paid_manual' }],
    ['booking_mvd_reports', { status: 'accepted_manual' }],
    ['booking_cleaning_tasks', { status: 'verified', verified_at: new Date().toISOString() }],
    ['booking_linen_tasks', { status: 'verified', verified_at: new Date().toISOString() }],
    ['booking_supplies_tasks', { status: 'verified', verified_at: new Date().toISOString() }],
  ]) {
    const { error } = await sb.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq('booking_id', recordId);
    if (error) throw error;
  }

  const approve = await post('/api/dashboard/booking-ops/physical-readiness', {
    bookingId: recordId,
    action: 'final_approval',
  });
  assert(approve.readiness?.finalReady === true, 'physical_readiness_not_approved');
}

try {
  const stale = await sb.from('booking_ops_records').select('id').like('guest_name', `${PREFIX}%`);
  if (stale.error) throw stale.error;
  await cleanup((stale.data ?? []).map((row) => row.id));
  await cleanupSyntheticIdentity();

  const runId = Date.now().toString(36);
  await createSyntheticIdentity(runId);
  const checkIn = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const checkOut = new Date(checkIn.getTime() + 48 * 60 * 60 * 1000);

  const created = await post('/api/dashboard/booking-ops', {
    guestName: `${PREFIX}${runId}`,
    guestPhone: '+79990000999',
    guestTelegram: `tg_v13_${runId}`,
    propertyId,
    propertyLabel: 'Тестовый объект OPS v13',
    otaSource: 'manual',
    checkInAt: checkIn.toISOString(),
    checkOutAt: checkOut.toISOString(),
    guestCount: 2,
    documentRequired: true,
    contractRequired: true,
    depositRequired: true,
    depositAmount: 5000,
    mvdRequired: true,
    notes: `${PREFIX} полный lifecycle acceptance`,
  }, 201);

  recordId = created.record?.id;
  assert(recordId, 'booking_record_missing');
  const scoped = await sb.from('booking_ops_records').update({
    account_id: accountId,
    reservation_metadata: { acceptance_safe: true, environment: 'test', fixture: PREFIX },
  }).eq('id', recordId).select('id').single();
  if (scoped.error) throw new Error(`booking_scope_failed:${scoped.error.message}`);
  const { count: bookingsCount } = await sb
    .from('booking_ops_records')
    .select('id', { count: 'exact', head: true })
    .eq('id', recordId);
  assert(bookingsCount === 1, 'bookings_count_not_1');
  lifecycleStagesPassed.push('new');

  await verifyAlerts(checkIn);

  await post('/api/dashboard/booking-ops/guest-intake-release', {
    bookingId: recordId,
    action: 'submit_simulated',
    fields: { fullName: 'Тестовый Гость V13', phone: '+79990000999' },
  });
  lifecycleStagesPassed.push('confirmed');

  await satisfyLegalAndPhysicalReadiness();
  const lifecycleRefresh = await json(`/api/dashboard/booking-ops/${recordId}/lifecycle`, { headers });
  assert(lifecycleRefresh.response.status === 200 && lifecycleRefresh.body.ok, 'readiness_lifecycle_refresh_failed');
  assert(await gateStatus('guest_data_completed') === 'completed', 'guest_data_completed_gate_missing');
  lifecycleStagesPassed.push('pre_checkin');

  const checkinActions = [
  ['prepare_instructions', {}],
  ['queue_instructions', {}],
  ['mark_instructions_sent', {}],
  ['request_arrival_confirmation', {}],
  ['mark_arrival_confirmed', {}],
  ['mark_access_ready', {}],
  ['mark_guest_checked_in', {}],
  ];
  for (const [action, extra] of checkinActions) {
    await post('/api/dashboard/booking-ops/checkin-execution', { bookingId: recordId, action, ...extra });
  }

  const checkinStatus = await json(`/api/dashboard/booking-ops/checkin-execution?bookingId=${recordId}`, { headers });
  assert(checkinStatus.response.status === 200, 'checkin_status_failed');
  assert(checkinStatus.body.checkin?.status === 'checked_in', `checkin_not_checked_in:${checkinStatus.body.checkin?.status}`);
  assert(await gateStatus('guest_checked_in') === 'completed', 'guest_checked_in_gate_missing');
  const preCheckinComms = await listCommunications();
  const hasCheckinComm = preCheckinComms.some((item) =>
    item.purpose === 'checkin_instructions' || item.purpose === 'send_checkin_instructions');
  assert(hasCheckinComm || await gateStatus('checkin_instructions_sent') === 'completed', 'pre_checkin_communication_missing');
  lifecycleStagesPassed.push('checked_in');

  const issueCreated = await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'create_guest_issue',
    issueType: 'comfort',
    severity: 'high',
    description: 'Тестовое обращение гостя',
  });
  const issueId = issueCreated.instayCheckout?.openIssues?.[0]?.id;
  assert(issueId, 'guest_issue_missing');
  await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'triage_guest_issue',
    issueId,
    reason: 'acknowledge',
  });
  assert(await countCommunicationsByPurpose('guest_issue_acknowledgement') >= 1, 'guest_issue_ack_missing');
  assert(await countCommunicationsByPurpose('guest_stay_issue_followup') >= 1, 'guest_issue_followup_missing');
  const issueResolved = await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'resolve_guest_issue',
    issueId,
    resolution: 'Synthetic staging acceptance issue resolved',
  });
  assert(issueResolved.instayCheckout?.openIssuesCount === 0, 'guest_issue_not_resolved');
  console.log('IN_STAY_SUPPORT_WATCH', 'PASS (mapped)');
  lifecycleStagesPassed.push('in_stay');

  await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'queue_checkout_instructions',
  });
  const checkoutDue = await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'mark_checkout_instructions_sent',
  });
  assert(checkoutDue.instayCheckout?.status === 'checkout_pending', 'checkout_pending_missing');
  assert(await countCommunicationsByPurpose('checkout_reminder') === 1, 'checkout_reminder_missing');
  console.log('SEND_CHECKOUT_REMINDER', 'PASS');

  const reminderBefore = await countCommunicationsByPurpose('checkout_reminder');
  await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'mark_checkout_instructions_sent',
  });
  const reminderAfter = await countCommunicationsByPurpose('checkout_reminder');
  assert(reminderAfter === reminderBefore, `checkout_reminder_duplicated:${reminderBefore}->${reminderAfter}`);
  duplicatesAvoided.checkout_reminder = 'PASS';
  lifecycleStagesPassed.push('checkout_due');

  await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'request_checkout_confirmation',
  });
  const checkedOut = await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'mark_guest_checked_out',
    actualCheckoutAt: new Date().toISOString(),
  });
  assert(checkedOut.instayCheckout?.status === 'checked_out', 'checked_out_missing');
  assert(await gateStatus('guest_checked_out') === 'completed', 'guest_checked_out_gate_missing');
  lifecycleStagesPassed.push('checked_out');

  await post(`/api/dashboard/booking-ops/${recordId}/recompute`, {});
  await completeOpenTasksByTypes(CLEANING_CHAIN);

  const inspectionGateBefore = await gateStatus('post_checkout_inspection_done');
  if (inspectionGateBefore !== 'completed') {
    await post('/api/dashboard/booking-ops/instay-checkout', {
      bookingId: recordId,
      action: 'trigger_post_checkout_inspection',
    });
    await post('/api/dashboard/booking-ops/instay-checkout', {
      bookingId: recordId,
      action: 'mark_post_checkout_inspection_done',
      result: 'ok',
    });
  }
  assert(await countCommunicationsByPurpose('inspection_request') >= 1, 'inspection_request_missing');
  console.log('POST_STAY_MESSAGE_REVIEW_REQUEST', 'PASS (mapped to inspection_request)');
  assert(await gateStatus('post_checkout_inspection_done') === 'completed', 'post_checkout_inspection_gate_missing');
  lifecycleStagesPassed.push('cleaning');

  await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'mark_deposit_return_ready',
  });
  const closed = await post('/api/dashboard/booking-ops/instay-checkout', {
    bookingId: recordId,
    action: 'mark_booking_closed',
  });
  assert(closed.instayCheckout?.status === 'closed', 'booking_not_closed');
  assert(await gateStatus('booking_closed') === 'completed', 'booking_closed_gate_missing');
  lifecycleStagesPassed.push('closed');

  const tasks = await listTasks();
  const communications = await listCommunications();
  const tasksCreated = new Set(tasks.map((task) => task.id)).size;
  const communicationPurposesFound = [...new Set(communications.map((item) => item.purpose))]
    .filter((purpose) => EXPECTED_COMMUNICATION_PURPOSES.includes(purpose));

  const tasksBeforeRecompute = tasksCreated;
  const commsBeforeRecompute = communications.length;
  await post(`/api/dashboard/booking-ops/${recordId}/recompute`, {});
  const tasksAfterRecompute = new Set((await listTasks()).map((task) => task.id)).size;
  const commsAfterRecompute = (await listCommunications()).length;
  assert(tasksAfterRecompute === tasksBeforeRecompute, `recompute_tasks_grew:${tasksBeforeRecompute}->${tasksAfterRecompute}`);
  assert(commsAfterRecompute === commsBeforeRecompute, `recompute_comms_grew:${commsBeforeRecompute}->${commsAfterRecompute}`);
  duplicatesAvoided.recompute = 'PASS';

  await verifyReconciliation();

  console.log('BOOKINGS_COUNT', bookingsCount);
  console.log('TASKS_CREATED', tasksCreated);
  console.log('COMMUNICATION_PLAN_ITEMS_CREATED', communicationPurposesFound.length, communicationPurposesFound.join(','));
  console.log('LIFECYCLE_STAGES_PASSED', lifecycleStagesPassed.length, lifecycleStagesPassed.join(' -> '));
  console.log('DUPLICATES_AVOIDED', JSON.stringify(duplicatesAvoided));
  assert(lifecycleStagesPassed.length === 9, `lifecycle_stages_incomplete:${lifecycleStagesPassed.join(',')}`);
} catch (error) {
  failure = error;
} finally {
  try {
    const leftovers = await cleanup(recordId ? [recordId] : []);
    const account = await sb.from('accounts').delete().eq('id', accountId);
    if (account.error) throw new Error(`cleanup_failed:account:${account.error.message}`);
    const user = await sb.from('users').delete().eq('id', userId);
    if (user.error) throw new Error(`cleanup_failed:user:${user.error.message}`);
    const [accountsLeft, usersLeft] = await Promise.all([
      sb.from('accounts').select('id', { count: 'exact', head: true }).eq('id', accountId),
      sb.from('users').select('id', { count: 'exact', head: true }).eq('id', userId),
    ]);
    const identityLeftovers = (accountsLeft.count ?? 0) + (usersLeft.count ?? 0);
    console.log('CLEANUP_LEFTOVERS', leftovers + identityLeftovers);
    if (leftovers + identityLeftovers !== 0 && !failure) failure = new Error(`cleanup_leftovers:${leftovers + identityLeftovers}`);
  } catch (cleanupError) {
    if (!failure) failure = cleanupError;
  }
}

if (failure) {
  console.error('RESULT', 'FAIL', failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
} else {
  console.log('NO_REAL_EXTERNAL_SIDE_EFFECTS', 'PASS');
  console.log('RESULT', 'PASS');
}
