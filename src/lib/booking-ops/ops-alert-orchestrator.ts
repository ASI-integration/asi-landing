import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent } from './events';
import { evaluateOpsTurnover } from './ops-alert-engine';
import { reconcileOperatorAlertConditions } from './operator-alerts';
import { evaluatePreCheckinAlerts, PRE_CHECKIN_ALERT_SOURCE_DOMAINS } from './pre-checkin-alert-engine';
import type { BookingLifecycleGate } from './lifecycle-types';
import type { BookingOpsTask } from './task-types';
import type { BookingOpsCommunicationIntent } from './types';
import { runBookingOpsAutomationForBooking, type BookingAutomationRunSummary } from './booking-automation-runner';
import {
  isBookingAutomationExecutionAllowed,
  resolveBookingAutomationCanaryBookingIds,
  resolveBookingAutomationRolloutMode,
  type BookingAutomationRolloutMode,
} from './booking-automation-rollout';
import type { BookingAutomationStep } from './booking-automation-planner';

const FULL_RUN_LEASE_TTL_SECONDS = 900;
const FULL_RUN_LEASE_RENEW_INTERVAL_MS = 60_000;

export type BookingAutomationPreview = {
  bookingId: string;
  plannedActions: Array<{
    actionCode: BookingAutomationStep['code'];
    disposition: BookingAutomationStep['disposition'];
    reasonCode: string;
    retryAt: string | null;
    requiresApproval: boolean;
    requiresHandoff: boolean;
  }>;
};

export type OpsAlertRunSummary = {
  runId?: string; trigger?: 'scheduled' | 'manual' | 'targeted'; startedAt?: string; completedAt?: string; lockAcquired?: boolean;
  automation?: BookingAutomationRunSummary; automationPreview?: BookingAutomationPreview;
  automationMode?: BookingAutomationRolloutMode; automationExecutedCount?: number; automationPreviewCount?: number;
  canaryMatchedCount?: number; automationPreviews?: BookingAutomationPreview[];
  evaluated: number; alertsCreated: number; alertsUpdated: number; alertsEscalated: number; alertsResolved: number;
  skipped: number; unchanged: number; errors: string[];
};
type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();

type RolloutContext = { mode: BookingAutomationRolloutMode; canaryBookingIds: ReadonlySet<string> };
type OrchestrationOptions = { dryRun?: boolean; executeAutomation?: boolean; rollout?: RolloutContext };

function currentRollout(): RolloutContext {
  return { mode: resolveBookingAutomationRolloutMode(), canaryBookingIds: resolveBookingAutomationCanaryBookingIds() };
}

function emptySummary(mode: BookingAutomationRolloutMode): OpsAlertRunSummary {
  return {
    automationMode: mode, automationExecutedCount: 0, automationPreviewCount: 0, canaryMatchedCount: 0, automationPreviews: [],
    evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [],
  };
}

function safeAutomationPreview(automation: BookingAutomationRunSummary): BookingAutomationPreview {
  return {
    bookingId: automation.bookingId,
    plannedActions: automation.planned.map((step) => ({
      actionCode: step.code,
      disposition: step.disposition,
      reasonCode: step.reasonCode,
      retryAt: step.retryAt,
      requiresApproval: step.requiresApproval,
      requiresHandoff: step.disposition === 'handoff_required',
    })),
  };
}

function addSummary(total: OpsAlertRunSummary, current: OpsAlertRunSummary) {
  for (const key of ['evaluated','alertsCreated','alertsUpdated','alertsEscalated','alertsResolved','skipped','unchanged','automationExecutedCount','automationPreviewCount','canaryMatchedCount'] as const) {
    total[key] = (total[key] ?? 0) + (current[key] ?? 0);
  }
  total.automationPreviews?.push(...(current.automationPreviews ?? []));
  total.errors.push(...current.errors);
}

function safeRunLog(summary: OpsAlertRunSummary) {
  return {
    runId: summary.runId, trigger: summary.trigger, startedAt: summary.startedAt, completedAt: summary.completedAt,
    lockAcquired: summary.lockAcquired, automationMode: summary.automationMode,
    automationExecutedCount: summary.automationExecutedCount ?? 0, automationPreviewCount: summary.automationPreviewCount ?? 0,
    canaryMatchedCount: summary.canaryMatchedCount ?? 0, evaluated: summary.evaluated, alertsCreated: summary.alertsCreated,
    alertsUpdated: summary.alertsUpdated, alertsEscalated: summary.alertsEscalated, alertsResolved: summary.alertsResolved,
    skipped: summary.skipped, unchanged: summary.unchanged, errors: summary.errors.length,
  };
}

async function rows(table: string, bookingId: string, column = 'booking_id'): Promise<Row[]> {
  const result = await supabase.from(table).select('*').eq(column, bookingId);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as Row[];
}

function latestTask(tasks: Row[], types: string[]): Row | null {
  return tasks.filter((task) => types.includes(text(task.task_type))).sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)))[0] ?? null;
}

function taskState(row: Row | null, assignmentField = false) {
  if (!row) return null;
  return { status: text(row.status), assigned: assignmentField ? Boolean(text(row.assigned_to_name) || text(row.assigned_to_phone) || text(row.assigned_to_telegram)) : true };
}

export async function reconcileOperatorAlertsForBooking(bookingId: string, now = new Date().toISOString(), expectedAccountId?: string, automation?: BookingAutomationRunSummary): Promise<OpsAlertRunSummary> {
  const summary: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  try {
    const bookingResult = await supabase.from('booking_ops_records').select('*').eq('id', bookingId).maybeSingle();
    if (bookingResult.error) throw new Error(bookingResult.error.message);
    const booking = bookingResult.data as Row | null;
    if (!booking) throw new Error('booking_not_found');
    const accountId = text(booking.account_id);
    if (!accountId || accountId === 'legacy') throw new Error('booking_account_missing');
    if (expectedAccountId && expectedAccountId !== accountId) throw new Error('booking_account_mismatch');
    if (!booking.property_id) { summary.skipped = 1; return summary; }
    const turnoverEligible = Boolean(booking.check_in_at) && !TERMINAL_BOOKING_STATUSES.includes(text(booking.ops_status));
    if (!turnoverEligible) {
      await reconcilePreCheckinAlerts(booking, now, summary, undefined, automation);
      summary.evaluated = 1;
      summary.skipped = 1;
      return summary;
    }
    const previousResult = await supabase.from('booking_ops_records').select('id,check_out_at').eq('account_id', accountId).eq('property_id', booking.property_id).neq('id', bookingId).lte('check_out_at', booking.check_in_at).order('check_out_at', { ascending: false }).limit(1).maybeSingle();
    if (previousResult.error) throw new Error(previousResult.error.message);
    const [cleaningRows, linenRows, maintenanceRows, readinessRows, tasks] = await Promise.all([
      rows('booking_cleaning_tasks', bookingId), rows('booking_linen_tasks', bookingId), rows('booking_maintenance_tickets', bookingId), rows('booking_physical_readiness', bookingId), rows('booking_ops_tasks', bookingId, 'booking_ops_record_id'),
    ]);
    const inspection = latestTask(tasks, ['unit_inspection_needed', 'inspection_needed']);
    const evaluated = evaluateOpsTurnover({
      turnoverId: bookingId, propertyId: text(booking.property_id), previousBookingId: text(previousResult.data?.id) || null, nextBookingId: bookingId,
      checkoutAt: text(previousResult.data?.check_out_at) || null, nextCheckInAt: text(booking.check_in_at), now,
      cleaning: taskState(cleaningRows[0] ?? null, true), linen: taskState(linenRows[0] ?? null, true), inspection: taskState(inspection),
      maintenance: maintenanceRows.map((item) => ({ id: text(item.id), isBlocking: item.is_blocking === true, status: text(item.status) })),
      finalReady: readinessRows[0]?.final_ready === true,
    });
    summary.evaluated = 1;
    if (evaluated.deadlines) {
      await recordBookingOpsEvent({
        bookingOpsRecordId: bookingId,
        eventType: 'turnover_deadlines_recalculated',
        title: 'Сроки подготовки пересчитаны',
        description: 'Сроки этапов рассчитаны от времени следующего заезда.',
        actorType: 'system',
        metadata: { source: 'ops_v15' },
        dedupeKey: `ops-v15:deadlines:${evaluated.deadlines.nextCheckInAt}`,
      });
    }
    const atRiskConditions = evaluated.conditions.filter((condition) =>
      new Date(condition.deadlineAt).getTime() - new Date(now).getTime() <= 60 * 60_000,
    );
    const reconciled = await reconcileOperatorAlertConditions({
      accountId,
      bookingId,
      propertyId: text(booking.property_id),
      managedSourceDomains: ['turnover'],
      previousBookingId: text(previousResult.data?.id) || null,
      nextCheckInAt: evaluated.deadlines?.nextCheckInAt ?? null,
      now,
      conditions: atRiskConditions.map((condition) => ({
        code: condition.code,
        incidentFamily: condition.incidentFamily,
        sourceDomain: condition.sourceDomain,
        sourceGate: condition.sourceGate,
        severity: condition.severity,
        title: condition.title,
        description: condition.description,
        recommendedAction: condition.recommendedAction,
        deadlineAt: condition.deadlineAt,
        metadata: condition.metadata,
      })),
    });
    addReconcileSummary(summary, reconciled);
    await reconcilePreCheckinAlerts(booking, now, summary, tasks, automation);
    return summary;
  } catch (error) { summary.errors.push(error instanceof Error ? error.message : 'orchestration_failed'); return summary; }
}

export async function orchestrateBookingAutomationAndAlertsForBooking(input: {
  bookingId: string; now?: string; expectedAccountId?: string; dryRun?: boolean; maxActions?: number;
  executeAutomation?: boolean; reconcileLegacyInPreview?: boolean; rollout?: RolloutContext;
}): Promise<OpsAlertRunSummary> {
  const now = input.now ?? new Date().toISOString();
  const rollout = input.rollout ?? currentRollout();
  const canaryMatched = rollout.mode === 'canary' && rollout.canaryBookingIds.has(input.bookingId);
  const executionAllowed = isBookingAutomationExecutionAllowed({ mode: rollout.mode, bookingId: input.bookingId, canaryBookingIds: rollout.canaryBookingIds });
  const executeAutomation = input.dryRun !== true && input.executeAutomation !== false && executionAllowed;
  const automation = await runBookingOpsAutomationForBooking({
    bookingId: input.bookingId, expectedAccountId: input.expectedAccountId, now,
    dryRun: !executeAutomation, maxActions: input.maxActions,
  });
  const preview = executeAutomation ? undefined : safeAutomationPreview(automation);
  const rolloutSummary: Pick<OpsAlertRunSummary, 'automationMode' | 'automationExecutedCount' | 'automationPreviewCount' | 'canaryMatchedCount' | 'automationPreviews'> = {
    automationMode: rollout.mode,
    automationExecutedCount: executeAutomation ? 1 : 0,
    automationPreviewCount: executeAutomation ? 0 : 1,
    canaryMatchedCount: canaryMatched ? 1 : 0,
    automationPreviews: preview ? [preview] : [],
  };
  if (input.dryRun || (!executeAutomation && input.reconcileLegacyInPreview !== true)) {
    return { ...rolloutSummary, automation: executeAutomation ? automation : undefined, automationPreview: preview, evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 1, unchanged: 0, errors: automation.errors };
  }
  const alerts = await reconcileOperatorAlertsForBooking(input.bookingId, now, input.expectedAccountId, executeAutomation ? automation : undefined);
  return {
    ...alerts, ...rolloutSummary, automation: executeAutomation ? automation : undefined, automationPreview: preview,
    alertsCreated: alerts.alertsCreated + (executeAutomation ? automation.alertsCreated : 0),
    alertsResolved: alerts.alertsResolved + (executeAutomation ? automation.alertsResolved : 0),
    errors: [...automation.errors, ...alerts.errors],
  };
}

export async function orchestrateOpsAlertsForBooking(bookingId: string, now = new Date().toISOString(), expectedAccountId?: string): Promise<OpsAlertRunSummary> {
  return orchestrateBookingAutomationAndAlertsForBooking({ bookingId, now, expectedAccountId, reconcileLegacyInPreview: true });
}

async function sweepAllRelevantOpsAlerts(now: string, accountId?: string, options: OrchestrationOptions = {}): Promise<OpsAlertRunSummary> {
  const rollout = options.rollout ?? currentRollout();
  const empty = emptySummary(rollout.mode);
  let query = supabase.from('booking_ops_records').select('id').not('check_in_at', 'is', null)
    .not('ops_status', 'in', '(cancelled,completed,archived,inactive)')
    .gte('check_in_at', new Date(new Date(now).getTime() - 24 * 60 * 60_000).toISOString())
    .lte('check_in_at', new Date(new Date(now).getTime() + 48 * 60 * 60_000).toISOString())
    .order('check_in_at').limit(200);
  if (accountId) query = query.eq('account_id', accountId);
  const result = await query;
  if (result.error) return { ...empty, errors: [result.error.message] };
  for (const item of result.data ?? []) {
    const current = await orchestrateBookingAutomationAndAlertsForBooking({
      bookingId: String(item.id), now, expectedAccountId: accountId, dryRun: options.dryRun,
      executeAutomation: options.executeAutomation, reconcileLegacyInPreview: options.dryRun !== true, rollout,
    });
    addSummary(empty, current);
  }
  return empty;
}

export async function orchestrateAllRelevantOpsAlerts(now = new Date().toISOString(), trigger: 'scheduled' | 'manual' = 'manual', accountId?: string, options: OrchestrationOptions = {}): Promise<OpsAlertRunSummary> {
  const rollout = options.rollout ?? currentRollout();
  if (options.dryRun) return sweepAllRelevantOpsAlerts(now, accountId, { ...options, rollout });
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const lock = await supabase.rpc('acquire_booking_ops_alert_run_lock', { p_lock_scope: 'ops-alerts:full', p_owner_id: runId, p_ttl_seconds: FULL_RUN_LEASE_TTL_SECONDS });
  if (lock.error || lock.data !== true) {
    const summary: OpsAlertRunSummary = { ...emptySummary(rollout.mode), runId, trigger, startedAt, completedAt: new Date().toISOString(), lockAcquired: false, errors: lock.error ? ['lock_unavailable'] : [] };
    console.info('[booking-ops-alert-run]', JSON.stringify(safeRunLog(summary)));
    return summary;
  }
  let leaseRenewalFailed = false;
  const renewalTimer = setInterval(() => {
    void supabase.rpc('acquire_booking_ops_alert_run_lock', {
      p_lock_scope: 'ops-alerts:full',
      p_owner_id: runId,
      p_ttl_seconds: FULL_RUN_LEASE_TTL_SECONDS,
    }).then(({ data, error }) => {
      if (error || data !== true) {
        leaseRenewalFailed = true;
        console.error('[booking-ops-alert-run-lock-renewal]', JSON.stringify({ runId, error: 'lock_renewal_failed' }));
      }
    });
  }, FULL_RUN_LEASE_RENEW_INTERVAL_MS);
  try {
    const result = await sweepAllRelevantOpsAlerts(now, accountId, { ...options, rollout });
    if (leaseRenewalFailed) result.errors.push('lock_renewal_failed');
    const summary = { ...result, runId, trigger, startedAt, completedAt: new Date().toISOString(), lockAcquired: true };
    console.info('[booking-ops-alert-run]', JSON.stringify(safeRunLog(summary)));
    return summary;
  } finally {
    clearInterval(renewalTimer);
    const released = await supabase.rpc('release_booking_ops_alert_run_lock', { p_lock_scope: 'ops-alerts:full', p_owner_id: runId });
    if (released.error) console.error('[booking-ops-alert-run-lock-release]', JSON.stringify({ runId, error: 'lock_release_failed' }));
  }
}

export async function orchestrateOpsAlertsForProperty(propertyId: string, now = new Date().toISOString(), accountId?: string, options: OrchestrationOptions = {}): Promise<OpsAlertRunSummary> {
  const rollout = options.rollout ?? currentRollout();
  let query = supabase.from('booking_ops_records').select('id').eq('property_id', propertyId).not('check_in_at', 'is', null).order('check_in_at').limit(100);
  if (accountId) query = query.eq('account_id', accountId);
  const result = await query;
  const total = emptySummary(rollout.mode);
  if (result.error) { total.errors.push(result.error.message); return total; }
  for (const item of result.data ?? []) {
    const current = await orchestrateBookingAutomationAndAlertsForBooking({
      bookingId: String(item.id), now, expectedAccountId: accountId, dryRun: options.dryRun,
      executeAutomation: options.executeAutomation, reconcileLegacyInPreview: options.dryRun !== true, rollout,
    });
    addSummary(total, current);
  }
  return total;
}

const TERMINAL_BOOKING_STATUSES = ['checked_in', 'closed', 'cancelled', 'canceled', 'completed', 'archived', 'inactive'];

function mapLifecycleGate(row: Row): BookingLifecycleGate {
  return {
    id: text(row.id), bookingId: text(row.booking_id), gateKey: text(row.gate_key) as BookingLifecycleGate['gateKey'],
    status: text(row.status) as BookingLifecycleGate['status'], source: text(row.source) as BookingLifecycleGate['source'],
    updatedAt: text(row.updated_at), completedAt: text(row.completed_at) || null, reason: text(row.reason) || null,
    note: text(row.note) || null, metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
  };
}

function mapTask(row: Row): BookingOpsTask {
  return {
    id: text(row.id), bookingOpsRecordId: text(row.booking_ops_record_id), bookingId: text(row.booking_id) || null,
    taskType: text(row.task_type) as BookingOpsTask['taskType'], title: text(row.title), description: text(row.description) || null,
    status: text(row.status) as BookingOpsTask['status'], priority: text(row.priority) as BookingOpsTask['priority'],
    source: text(row.source) as BookingOpsTask['source'], dueAt: text(row.due_at) || null, completedAt: text(row.completed_at) || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function mapCommunication(row: Row): BookingOpsCommunicationIntent {
  return {
    id: text(row.id), bookingOpsRecordId: text(row.booking_ops_record_id), bookingId: text(row.booking_id) || null,
    relatedTaskId: text(row.related_task_id) || null, actorType: text(row.actor_type) as BookingOpsCommunicationIntent['actorType'],
    actorLabel: text(row.actor_label) || null, purpose: text(row.purpose) as BookingOpsCommunicationIntent['purpose'],
    channel: text(row.channel) as BookingOpsCommunicationIntent['channel'], status: text(row.status) as BookingOpsCommunicationIntent['status'],
    messageText: text(row.message_text), messageTemplateKey: text(row.message_template_key),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    createdAt: text(row.created_at), updatedAt: text(row.updated_at), supersededAt: text(row.superseded_at) || null,
  };
}

function addReconcileSummary(summary: OpsAlertRunSummary, reconciled: Awaited<ReturnType<typeof reconcileOperatorAlertConditions>>) {
  summary.alertsCreated += reconciled.alertsCreated;
  summary.alertsUpdated += reconciled.alertsUpdated;
  summary.alertsEscalated += reconciled.alertsEscalated;
  summary.alertsResolved += reconciled.alertsResolved;
  summary.unchanged += reconciled.unchanged;
}

async function reconcilePreCheckinAlerts(booking: Row, now: string, summary: OpsAlertRunSummary, loadedTasks?: Row[], automation?: BookingAutomationRunSummary) {
  const bookingId = text(booking.id);
  const [gateRows, taskRows, communicationRows] = await Promise.all([
    rows('booking_lifecycle_gates', bookingId),
    loadedTasks ? Promise.resolve(loadedTasks) : rows('booking_ops_tasks', bookingId, 'booking_ops_record_id'),
    rows('booking_ops_communication_intents', bookingId, 'booking_ops_record_id'),
  ]);
  const evaluatedConditions = evaluatePreCheckinAlerts({
    bookingId, bookingStatus: text(booking.ops_status), checkInAt: text(booking.check_in_at) || null,
    manualNextAction: text(booking.manual_next_action) || null, lifecycleGates: gateRows.map(mapLifecycleGate),
    tasks: taskRows.map(mapTask), communications: communicationRows.map(mapCommunication), now,
  });
  const safelyManagedGates = new Set((automation?.planned ?? [])
    .filter((step) => !['handoff_required', 'approval_required'].includes(step.disposition))
    .map((step) => step.gateKey).filter((gate): gate is string => Boolean(gate)));
  const conditions = evaluatedConditions.filter((condition) => {
    if (!safelyManagedGates.has(condition.sourceGate)) return true;
    return Boolean(condition.deadlineAt && new Date(condition.deadlineAt).getTime() <= new Date(now).getTime());
  });
  const reconciled = await reconcileOperatorAlertConditions({
    accountId: text(booking.account_id), bookingId, propertyId: text(booking.property_id),
    managedSourceDomains: [...PRE_CHECKIN_ALERT_SOURCE_DOMAINS], conditions, now,
    nextCheckInAt: text(booking.check_in_at) || null,
  });
  addReconcileSummary(summary, reconciled);
}
