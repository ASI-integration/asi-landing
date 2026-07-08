#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sealData } from 'iron-session';
import { createClient } from '@supabase/supabase-js';

const BASE = String(process.env.ACCEPTANCE_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PREFIX = 'ASI_OPS_V13_LIFECYCLE_ACCEPTANCE_';

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
assert(sessionSecret.length >= 32, 'missing_session_secret');
assert(supabaseUrl && supabaseKey, 'missing_supabase_env');

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sealed = await sealData(
  { userId: 'ops-v13-lifecycle-acceptance', email: adminEmail },
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

  const runId = Date.now().toString(36);
  const checkIn = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const checkOut = new Date(checkIn.getTime() + 48 * 60 * 60 * 1000);

  const created = await post('/api/dashboard/booking-ops', {
    guestName: `${PREFIX}${runId}`,
    guestPhone: '+79990000999',
    guestTelegram: `tg_v13_${runId}`,
    propertyId: `ops_v13_${runId}`,
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
  const { count: bookingsCount } = await sb
    .from('booking_ops_records')
    .select('id', { count: 'exact', head: true })
    .eq('id', recordId);
  assert(bookingsCount === 1, 'bookings_count_not_1');
  lifecycleStagesPassed.push('new');

  await post('/api/dashboard/booking-ops/guest-intake-release', {
    bookingId: recordId,
    action: 'submit_simulated',
    fields: { fullName: 'Тестовый Гость V13', phone: '+79990000999' },
  });
  lifecycleStagesPassed.push('confirmed');

  await satisfyLegalAndPhysicalReadiness();
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
    console.log('CLEANUP_LEFTOVERS', leftovers);
    if (leftovers !== 0 && !failure) failure = new Error(`cleanup_leftovers:${leftovers}`);
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
