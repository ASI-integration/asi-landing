import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { initializeLifecycleForBooking } from './lifecycle';
import { getBookingOpsRecord } from './repository';
import { listBookingOpsTasksForRecord } from './tasks';
import { syncGuestIntakeAutopilot } from './guest-intake-autopilot';
import { syncBookingOpsCommunications } from './communication-orchestrator';
import { prepareContract, prepareMvdReport, requestDeposit, requestGuestDocuments } from './legal-payment-autopilot';
import { prepareCheckinInstructions, queueCheckinInstructions, requestArrivalConfirmation } from './checkin-execution-autopilot';
import { ensurePhysicalTasks, recomputePhysicalReadiness, updateCleaningTask, approveFinalPhysicalReadiness } from './physical-readiness-execution';
import { durableEventId, recordProcessedBookingAuditEvent } from './lifecycle-autopilot-service';
import { reconcileOperatorAlertConditions, type OperatorAlertCondition } from './operator-alerts';
import { planBookingOpsAutomation, type BookingAutomationActionCode, type BookingAutomationSnapshot, type BookingAutomationStep } from './booking-automation-planner';
import { getCommunicationPolicy } from './communication-auto-send-policy';
import type { BookingOpsCommunicationIntent } from './types';

const LOCK_TTL_SECONDS = 120;
export const DEFAULT_AUTOMATION_MAX_ACTIONS = 5;
export const DEFAULT_AUTOMATION_MAX_TECHNICAL_ATTEMPTS = 3;
const ACTIVE_ALERT_STATUSES = ['open', 'acknowledged'];
type Row = Record<string, unknown>;

export type BookingAutomationRunSummary = {
  runId: string; bookingId: string; accountId: string; startedAt: string; completedAt: string;
  lockAcquired: boolean; planned: BookingAutomationStep[]; executed: BookingAutomationStep[];
  waiting: BookingAutomationStep[]; retriesScheduled: BookingAutomationStep[];
  approvalsRequired: BookingAutomationStep[]; handoffsCreated: number;
  alertsCreated: number; alertsResolved: number; errors: string[];
};

export type RunBookingOpsAutomationInput = {
  bookingId: string; expectedAccountId?: string; now?: string; dryRun?: boolean; maxActions?: number;
};

const text = (value: unknown) => String(value ?? '').trim();
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const latest = (items: Row[]) => [...items].sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)))[0] ?? null;

async function selectRows(table: string, bookingId: string, column = 'booking_id'): Promise<Row[]> {
  const result = await supabase.from(table).select('*').eq(column, bookingId);
  if (result.error) throw new Error(`${table}:${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function nextQuietHoursEnd(now: string, end: string | null): string | null {
  if (!end) return null;
  const [hour, minute] = end.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const retry = new Date(now);
  retry.setHours(hour, minute, 0, 0);
  if (retry.getTime() <= new Date(now).getTime()) retry.setDate(retry.getDate() + 1);
  return retry.toISOString();
}

async function policyFromCommunications(communications: Row[], input: { bookingId: string; propertyId: string; now: string }) {
  const active = latest(communications.filter((row) => !['superseded', 'cancelled'].includes(text(row.status))));
  const metadata = object(active?.metadata);
  const decision = object(metadata.auto_send_decision);
  const rawCode = text(decision.decision || decision.code || metadata.autoSendDecision || metadata.policyDecision);
  const code = rawCode === 'allowed' || rawCode === 'review_required' || rawCode === 'quiet_hours' || rawCode === 'rate_limited' || rawCode === 'blocked'
    ? rawCode : rawCode === 'unsafe_content' ? 'unsafe' : ['missing_metadata', 'unknown_message_type'].includes(rawCode) ? 'blocked' : null;
  if (!active || !code) return null;
  let retryAt = text(decision.retryAt || decision.nextAllowedAt || metadata.automationNextRetryAt) || null;
  if (!retryAt && (code === 'quiet_hours' || code === 'rate_limited')) {
    const intent = {
      id: text(active.id), bookingOpsRecordId: input.bookingId, bookingId: text(active.booking_id) || null,
      relatedTaskId: null, actorType: text(active.actor_type), actorLabel: null, purpose: text(active.purpose),
      channel: text(active.channel), status: text(active.status), messageText: text(active.message_text),
      messageTemplateKey: text(active.message_template_key), metadata, createdAt: text(active.created_at), updatedAt: text(active.updated_at), supersededAt: null,
    } as BookingOpsCommunicationIntent;
    const policy = await getCommunicationPolicy(intent, { bookingId: input.bookingId, propertyId: input.propertyId, now: new Date(input.now) });
    retryAt = code === 'quiet_hours'
      ? nextQuietHoursEnd(input.now, policy.quietHoursEnd)
      : (() => { const value = new Date(input.now); value.setDate(value.getDate() + 1); value.setHours(0, 0, 0, 0); return value.toISOString(); })();
  }
  return {
    code,
    retryAt,
    reasonCode: text(decision.rule_key || decision.ruleKey || decision.reasonCode || metadata.failureCode) || (rawCode === 'missing_metadata' ? 'missing_required_metadata' : rawCode === 'unsafe_content' ? 'unsafe_content' : null),
    communicationIntentId: text(active.id) || null,
  } as BookingAutomationSnapshot['guestIntake']['policy'];
}

function retryFromGates(gates: Row[]) {
  const retryGate = gates.find((row) => {
    const metadata = object(row.metadata);
    return Boolean(metadata.automationStatus || metadata.automationLastAction || metadata.automationAttemptCount);
  });
  const metadata = object(retryGate?.metadata);
  return {
    nextRetryAt: text(metadata.automationNextRetryAt) || null,
    attemptCount: Number(metadata.automationAttemptCount) || 0,
    maxAttempts: DEFAULT_AUTOMATION_MAX_TECHNICAL_ATTEMPTS,
    lastAction: text(metadata.automationLastAction) || null,
    lastErrorCode: text(metadata.automationLastErrorCode) || null,
  };
}

export async function loadBookingAutomationSnapshot(bookingId: string, expectedAccountId?: string, now = new Date().toISOString()): Promise<BookingAutomationSnapshot> {
  const bookingResult = await supabase.from('booking_ops_records').select('*').eq('id', bookingId).maybeSingle();
  if (bookingResult.error) throw new Error(bookingResult.error.message);
  if (!bookingResult.data) throw new Error('booking_not_found');
  const booking = bookingResult.data as Row;
  const accountId = text(booking.account_id);
  if (!accountId || accountId === 'legacy') throw new Error('booking_account_missing');
  if (expectedAccountId && expectedAccountId !== accountId) throw new Error('booking_account_mismatch');
  const propertyId = text(booking.property_id);
  if (!propertyId) throw new Error('booking_property_missing');
  const [accountResult, propertyResult, knowledgeResult] = await Promise.all([
    supabase.from('accounts').select('id').eq('id', accountId).maybeSingle(),
    supabase.from('properties').select('id,account_id').eq('id', propertyId).eq('account_id', accountId).maybeSingle(),
    supabase.from('tg_property_knowledge').select('property_id').eq('property_id', propertyId).maybeSingle(),
  ]);
  if (accountResult.error) throw new Error(accountResult.error.message);
  if (!accountResult.data) throw new Error('booking_account_not_found');
  if (propertyResult.error && knowledgeResult.error) throw new Error(propertyResult.error.message);
  if (!propertyResult.data && !knowledgeResult.data) throw new Error('booking_property_not_found');

  const [gates, tasks, intakeRows, documents, contracts, deposits, mvdReports, communications, checkinRows, cleaningRows, linenRows, suppliesRows, maintenanceRows, readinessRows, alerts] = await Promise.all([
    selectRows('booking_lifecycle_gates', bookingId),
    selectRows('booking_ops_tasks', bookingId, 'booking_ops_record_id'),
    selectRows('booking_ops_guest_intake_sessions', bookingId, 'booking_ops_record_id'),
    selectRows('booking_guest_documents', bookingId), selectRows('booking_contracts', bookingId),
    selectRows('booking_deposits', bookingId), selectRows('booking_mvd_reports', bookingId),
    selectRows('booking_ops_communication_intents', bookingId, 'booking_ops_record_id'),
    selectRows('booking_checkin_execution', bookingId), selectRows('booking_cleaning_tasks', bookingId),
    selectRows('booking_linen_tasks', bookingId), selectRows('booking_supplies_tasks', bookingId),
    selectRows('booking_maintenance_tickets', bookingId), selectRows('booking_physical_readiness', bookingId),
    selectRows('booking_ops_alerts', bookingId),
  ]);
  void tasks; void linenRows; void suppliesRows; void maintenanceRows; void alerts;
  const intake = latest(intakeRows);
  const contract = latest(contracts);
  const deposit = latest(deposits);
  const mvd = latest(mvdReports);
  const checkin = latest(checkinRows);
  const cleaning = latest(cleaningRows);
  const readiness = latest(readinessRows);
  const cleaner = cleaning && (text(cleaning.assigned_to_name) || text(cleaning.assigned_to_phone) || text(cleaning.assigned_to_telegram)) ? {
    ...(text(cleaning.assigned_to_name) ? { assignedToName: text(cleaning.assigned_to_name) } : {}),
    ...(text(cleaning.assigned_to_phone) ? { assignedToPhone: text(cleaning.assigned_to_phone) } : {}),
    ...(text(cleaning.assigned_to_telegram) ? { assignedToTelegram: text(cleaning.assigned_to_telegram) } : {}),
  } : null;
  const lifecycleComplete = (key: string) => gates.some((gate) => text(gate.gate_key) === key && ['completed', 'skipped'].includes(text(gate.status)));
  const documentsRequired = booking.document_required !== false;
  const contractRequired = booking.contract_required !== false;
  const depositRequired = booking.deposit_required === true;
  const mvdRequired = booking.mvd_required === true;
  const prerequisiteKeys = [
    ...(documentsRequired ? ['documents_verified'] : []), ...(contractRequired ? ['contract_signed'] : []),
    ...(depositRequired ? ['deposit_received'] : []), ...(mvdRequired ? ['mvd_report_submitted'] : []), 'property_ready',
  ];
  const communicationsFor = (...purposes: string[]) => communications.filter((row) => purposes.includes(text(row.purpose)));
  return {
    bookingId, accountId, propertyId, now,
    lifecycle: { exists: gates.length > 0 },
    guestIntake: {
      exists: Boolean(intake), status: text(intake?.intake_status) || 'not_started',
      missingFields: Array.isArray(intake?.missing_fields) ? intake.missing_fields.map(text).filter(Boolean) : [],
      requestPrepared: communications.some((row) => ['request_guest_data', 'request_missing_guest_data'].includes(text(row.purpose)) && !['superseded', 'cancelled'].includes(text(row.status))),
      policy: await policyFromCommunications(communications, { bookingId, propertyId, now }),
    },
    legal: {
      documentsRequired, documents: documents.map((row) => ({ status: text(row.status) })),
      documentsPolicy: await policyFromCommunications(communicationsFor('request_guest_documents'), { bookingId, propertyId, now }),
      contractRequired, contractStatus: text(contract?.status) || null,
      contractPolicy: await policyFromCommunications(communicationsFor('request_contract_confirmation'), { bookingId, propertyId, now }),
      depositRequired, depositStatus: text(deposit?.status) || null,
      depositPolicy: await policyFromCommunications(communicationsFor('request_deposit_payment'), { bookingId, propertyId, now }),
      mvdRequired, mvdStatus: text(mvd?.status) || null,
      mvdPolicy: await policyFromCommunications(communicationsFor('request_mvd_data'), { bookingId, propertyId, now }),
      canonicalDataComplete: Boolean(intake && text(intake.intake_status) === 'completed' && (!Array.isArray(intake.missing_fields) || intake.missing_fields.length === 0)),
    },
    checkin: {
      instructionsStatus: text(checkin?.instructions_status) || 'not_prepared',
      arrivalStatus: text(checkin?.arrival_status) || 'unknown',
      prerequisitesComplete: prerequisiteKeys.every(lifecycleComplete),
      policy: await policyFromCommunications(communicationsFor('checkin_instructions', 'send_checkin_instructions'), { bookingId, propertyId, now }),
    },
    physical: {
      tasksExist: Boolean(cleaningRows.length && linenRows.length && suppliesRows.length),
      cleaningStatus: text(cleaning?.status) || null, deterministicCleaner: cleaner,
      readinessStatus: text(readiness?.status) || null,
      physicalStateChanged: false,
      autoApprovalAuthorized: object(booking.metadata).autoPhysicalReadinessApproval === true || object(readiness?.metadata).autoApprovalAuthorized === true,
    },
    retry: retryFromGates(gates),
  };
}

async function syncCommunications(bookingId: string) {
  const record = await getBookingOpsRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  const taskResult = await listBookingOpsTasksForRecord(record.id);
  if (!taskResult.ok) throw new Error(taskResult.error);
  const result = await syncBookingOpsCommunications({ record, tasks: taskResult.tasks });
  if (!result.ok) throw new Error(result.error ?? 'communication_sync_failed');
}

async function executeStep(step: BookingAutomationStep, snapshot: BookingAutomationSnapshot): Promise<void> {
  const metadata = { source: 'booking_automation_runner_v1', actionCode: step.code };
  switch (step.code) {
    case 'initialize_lifecycle': {
      const result = await initializeLifecycleForBooking(snapshot.bookingId);
      if (!result.ok) throw new Error(result.error ?? 'lifecycle_initialization_failed');
      return;
    }
    case 'ensure_guest_intake':
    case 'prepare_guest_data_request': {
      const record = await getBookingOpsRecord(snapshot.bookingId);
      if (!record) throw new Error('booking_not_found');
      const result = await syncGuestIntakeAutopilot(record);
      if (!result.ok) throw new Error(result.error ?? 'guest_intake_sync_failed');
      await syncCommunications(snapshot.bookingId);
      return;
    }
    case 'prepare_documents_request': await requestGuestDocuments(snapshot.bookingId, ['passport'], metadata); await syncCommunications(snapshot.bookingId); return;
    case 'prepare_contract': await prepareContract(snapshot.bookingId, undefined, metadata); await syncCommunications(snapshot.bookingId); return;
    case 'prepare_deposit_request': {
      const booking = await getBookingOpsRecord(snapshot.bookingId);
      if (!booking?.depositAmount || booking.depositAmount <= 0) throw new Error('deposit_amount_missing');
      await requestDeposit(snapshot.bookingId, booking.depositAmount, 'RUB', metadata); await syncCommunications(snapshot.bookingId); return;
    }
    case 'prepare_mvd_draft': await prepareMvdReport(snapshot.bookingId, metadata); return;
    case 'prepare_checkin_instructions': await prepareCheckinInstructions(snapshot.bookingId, metadata); return;
    case 'queue_checkin_instructions': await queueCheckinInstructions(snapshot.bookingId, undefined, metadata); return;
    case 'request_arrival_confirmation': await requestArrivalConfirmation(snapshot.bookingId, metadata); return;
    case 'activate_turnover_cleaning': await ensurePhysicalTasks(snapshot.bookingId); return;
    case 'assign_cleaner': await updateCleaningTask(snapshot.bookingId, { status: 'assigned', ...step.safeMetadata }); return;
    case 'recompute_physical_readiness': await recomputePhysicalReadiness(snapshot.bookingId); return;
    case 'approve_physical_readiness': await approveFinalPhysicalReadiness(snapshot.bookingId, 'automation_policy'); return;
    case 'reconcile_operator_alerts': return;
  }
}

async function audit(snapshot: Pick<BookingAutomationSnapshot, 'bookingId' | 'propertyId' | 'accountId'>, eventType: string, step: BookingAutomationStep | null, runId: string, suffix: string) {
  await recordProcessedBookingAuditEvent({
    id: durableEventId('booking-automation', runId, step?.code ?? 'run', suffix),
    bookingId: snapshot.bookingId, objectId: snapshot.propertyId, type: eventType, actorType: 'system', source: 'booking_automation_runner_v1',
    correlationId: durableEventId('booking-automation-run', runId),
    payload: {
      bookingId: snapshot.bookingId, propertyId: snapshot.propertyId, accountId: snapshot.accountId,
      actionCode: step?.code, domain: step?.domain, gateKey: step?.gateKey,
      outcome: suffix, reasonCode: step?.reasonCode,
      attemptCount: step?.safeMetadata.automationAttemptCount,
      retryAt: step?.retryAt, alertId: step?.safeMetadata.alertId,
      taskId: step?.safeMetadata.taskId, communicationIntentId: step?.safeMetadata.referenceId,
    },
  });
}

async function updateRetryMetadata(snapshot: BookingAutomationSnapshot, action: BookingAutomationActionCode, errorCode: string, now: string) {
  const gate = await supabase.from('booking_lifecycle_gates').select('id,metadata').eq('booking_id', snapshot.bookingId).eq('gate_key', 'booking_received').maybeSingle();
  if (gate.error || !gate.data) throw new Error(gate.error?.message ?? 'retry_gate_missing');
  const count = snapshot.retry.attemptCount + 1;
  const retryAt = count < DEFAULT_AUTOMATION_MAX_TECHNICAL_ATTEMPTS ? new Date(new Date(now).getTime() + Math.min(60, 5 * (2 ** (count - 1))) * 60_000).toISOString() : null;
  const metadata = { ...object(gate.data.metadata), automationStatus: retryAt ? 'retry_scheduled' : 'retry_exhausted', automationLastAction: action, automationAttemptCount: count, automationLastAttemptAt: now, automationNextRetryAt: retryAt, automationLastErrorCode: errorCode };
  const result = await supabase.from('booking_lifecycle_gates').update({ metadata, updated_at: now }).eq('id', gate.data.id);
  if (result.error) throw new Error(result.error.message);
  return { count, retryAt };
}

async function clearRetryMetadata(snapshot: BookingAutomationSnapshot, now: string) {
  if (!snapshot.retry.lastAction && snapshot.retry.attemptCount === 0) return;
  const gate = await supabase.from('booking_lifecycle_gates').select('id,metadata').eq('booking_id', snapshot.bookingId).eq('gate_key', 'booking_received').maybeSingle();
  if (gate.error || !gate.data) return;
  const metadata = { ...object(gate.data.metadata), automationStatus: 'completed', automationLastAction: null, automationAttemptCount: 0, automationLastAttemptAt: now, automationNextRetryAt: null, automationLastErrorCode: null };
  await supabase.from('booking_lifecycle_gates').update({ metadata, updated_at: now }).eq('id', gate.data.id);
}

function handoffCondition(step: BookingAutomationStep): OperatorAlertCondition {
  const approval = step.disposition === 'approval_required';
  return {
    code: step.reasonCode, incidentFamily: `AUTOMATION_${step.reasonCode.toUpperCase()}`,
    sourceDomain: 'automation', sourceGate: step.gateKey ?? step.domain,
    severity: ['unsafe_content', 'retry_exhausted', 'payment_exception'].includes(step.reasonCode) ? 'critical' : 'warning',
    title: approval ? 'Нужно подтверждение оператора' : 'Автоматизация не может продолжить',
    description: `Автоматизация выполнила проверку шага ${step.code}. Продолжение остановлено: ${step.reasonCode}.`,
    recommendedAction: approval ? 'Проверьте подготовленное действие и подтвердите его безопасным способом.' : 'Устраните указанную причину и повторите автоматизацию.',
    deadlineAt: null,
    metadata: { automationStatus: step.disposition, automationLastAction: step.code, automationAttemptCount: step.safeMetadata.automationAttemptCount, automationNextRetryAt: step.retryAt, failureCode: step.reasonCode, requiresApproval: step.requiresApproval, policyDecision: step.safeMetadata.policyDecision, taskId: step.safeMetadata.taskId, referenceId: step.safeMetadata.referenceId },
  };
}

async function reconcileAutomationHandoffs(snapshot: BookingAutomationSnapshot, steps: BookingAutomationStep[], now: string) {
  return reconcileOperatorAlertConditions({
    accountId: snapshot.accountId, bookingId: snapshot.bookingId, propertyId: snapshot.propertyId,
    managedSourceDomains: ['automation'], now,
    conditions: steps.filter((item) => item.disposition === 'handoff_required' || item.disposition === 'approval_required').map(handoffCondition),
    nextCheckInAt: null,
  });
}

export async function runBookingOpsAutomationForBooking(input: RunBookingOpsAutomationInput): Promise<BookingAutomationRunSummary> {
  const runId = randomUUID();
  const startedAt = input.now ? new Date(input.now).toISOString() : new Date().toISOString();
  let snapshot = await loadBookingAutomationSnapshot(input.bookingId, input.expectedAccountId, startedAt);
  const maxActions = Math.max(0, Math.min(DEFAULT_AUTOMATION_MAX_ACTIONS, Math.floor(input.maxActions ?? DEFAULT_AUTOMATION_MAX_ACTIONS)));
  const summary: BookingAutomationRunSummary = { runId, bookingId: input.bookingId, accountId: snapshot.accountId, startedAt, completedAt: startedAt, lockAcquired: false, planned: [], executed: [], waiting: [], retriesScheduled: [], approvalsRequired: [], handoffsCreated: 0, alertsCreated: 0, alertsResolved: 0, errors: [] };
  if (input.dryRun) {
    summary.planned = planBookingOpsAutomation(snapshot, maxActions);
    summary.waiting = summary.planned.filter((item) => item.disposition === 'waiting_external' || item.disposition === 'no_action');
    summary.retriesScheduled = summary.planned.filter((item) => item.disposition === 'retry_scheduled');
    summary.approvalsRequired = summary.planned.filter((item) => item.disposition === 'approval_required');
    summary.completedAt = startedAt;
    return summary;
  }

  const lockScope = `booking-automation:${input.bookingId}`;
  const lock = await supabase.rpc('acquire_booking_ops_alert_run_lock', { p_lock_scope: lockScope, p_owner_id: runId, p_ttl_seconds: LOCK_TTL_SECONDS });
  if (lock.error || lock.data !== true) { summary.errors.push(lock.error ? 'lock_unavailable' : 'lock_not_acquired'); summary.completedAt = new Date().toISOString(); return summary; }
  summary.lockAcquired = true;
  try {
    await audit(snapshot, 'booking_automation_run_started', null, runId, 'started');
    let remaining = maxActions;
    while (remaining > 0) {
      const plan = planBookingOpsAutomation(snapshot, remaining);
      summary.planned.push(...plan);
      for (const [index, item] of plan.entries()) await audit(snapshot, 'booking_automation_step_planned', item, runId, `planned:${summary.planned.length - plan.length + index}`);
      const next = plan.find((item) => item.disposition === 'execute');
      if (!next) break;
      await audit(snapshot, 'booking_automation_step_started', next, runId, `started:${summary.executed.length}`);
      try {
        await executeStep(next, snapshot);
        summary.executed.push(next);
        await audit(snapshot, 'booking_automation_step_completed', next, runId, `completed:${summary.executed.length}`);
        await clearRetryMetadata(snapshot, new Date().toISOString());
      } catch (error) {
        const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'automation_step_failed';
        summary.errors.push(`${next.code}:${errorCode}`);
        const retry = await updateRetryMetadata(snapshot, next.code, errorCode, new Date().toISOString());
        const failed = { ...next, disposition: (retry.retryAt ? 'retry_scheduled' : 'handoff_required') as BookingAutomationStep['disposition'], reasonCode: retry.retryAt ? 'automation_failed' : 'retry_exhausted', retryAt: retry.retryAt, safeMetadata: { automationAttemptCount: retry.count, failureCode: errorCode } };
        summary.planned.push(failed);
        if (retry.retryAt) summary.retriesScheduled.push(failed);
        await audit(snapshot, 'booking_automation_step_failed', failed, runId, `failed:${retry.count}`);
        if (retry.retryAt) await audit(snapshot, 'booking_automation_retry_scheduled', failed, runId, `retry:${retry.count}`);
        break;
      }
      remaining -= 1;
      const reloaded = await loadBookingAutomationSnapshot(input.bookingId, input.expectedAccountId, new Date().toISOString());
      const nextPlan = planBookingOpsAutomation(reloaded, remaining);
      if (nextPlan.some((candidate) => candidate.code === next.code && candidate.disposition === 'execute')) break;
      snapshot = reloaded;
    }
    const finalPlan = planBookingOpsAutomation(await loadBookingAutomationSnapshot(input.bookingId, input.expectedAccountId, new Date().toISOString()), Math.max(0, remaining));
    summary.planned.push(...finalPlan.filter((item) => !summary.planned.some((existing) => existing.code === item.code && existing.reasonCode === item.reasonCode && existing.disposition === item.disposition)));
    const terminalFailures = summary.planned.filter((item) => item.disposition === 'handoff_required' && item.reasonCode === 'retry_exhausted');
    const remainingSteps = [...finalPlan, ...terminalFailures.filter((failed) => !finalPlan.some((item) => item.code === failed.code && item.reasonCode === failed.reasonCode))];
    summary.waiting = remainingSteps.filter((item) => item.disposition === 'waiting_external' || item.disposition === 'no_action');
    summary.retriesScheduled = remainingSteps.filter((item) => item.disposition === 'retry_scheduled');
    summary.approvalsRequired = remainingSteps.filter((item) => item.disposition === 'approval_required');
    const reconciled = await reconcileAutomationHandoffs(snapshot, remainingSteps, new Date().toISOString());
    summary.handoffsCreated = reconciled.alertsCreated;
    summary.alertsCreated = reconciled.alertsCreated;
    summary.alertsResolved = reconciled.alertsResolved;
    for (const item of summary.waiting) await audit(snapshot, 'booking_automation_step_waiting', item, runId, `waiting:${item.reasonCode}`);
    for (const item of remainingSteps.filter((entry) => entry.disposition === 'handoff_required' || entry.disposition === 'approval_required')) await audit(snapshot, 'booking_automation_handoff_created', item, runId, `handoff:${item.reasonCode}`);
    return summary;
  } finally {
    summary.completedAt = new Date().toISOString();
    try {
      await audit(snapshot, 'booking_automation_run_completed', null, runId, summary.errors.length ? 'completed_with_errors' : 'completed');
    } finally {
      await supabase.rpc('release_booking_ops_alert_run_lock', { p_lock_scope: lockScope, p_owner_id: runId });
    }
  }
}

export function isActiveOperatorAlertStatus(status: unknown): boolean {
  return ACTIVE_ALERT_STATUSES.includes(text(status));
}
