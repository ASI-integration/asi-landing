import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent } from './events';
import { evaluateOpsTurnover } from './ops-alert-engine';
import { reconcileOperatorAlertConditions } from './operator-alerts';

const FULL_RUN_LEASE_TTL_SECONDS = 900;
const FULL_RUN_LEASE_RENEW_INTERVAL_MS = 60_000;

export type OpsAlertRunSummary = { runId?: string; trigger?: 'scheduled' | 'manual' | 'targeted'; startedAt?: string; completedAt?: string; lockAcquired?: boolean; evaluated: number; alertsCreated: number; alertsUpdated: number; alertsEscalated: number; alertsResolved: number; skipped: number; unchanged: number; errors: string[] };
type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();

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

export async function orchestrateOpsAlertsForBooking(bookingId: string, now = new Date().toISOString(), expectedAccountId?: string): Promise<OpsAlertRunSummary> {
  const summary: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  try {
    const bookingResult = await supabase.from('booking_ops_records').select('*').eq('id', bookingId).maybeSingle();
    if (bookingResult.error) throw new Error(bookingResult.error.message);
    const booking = bookingResult.data as Row | null;
    if (!booking) throw new Error('booking_not_found');
    const accountId = text(booking.account_id);
    if (!accountId || accountId === 'legacy') throw new Error('booking_account_missing');
    if (expectedAccountId && expectedAccountId !== accountId) throw new Error('booking_account_mismatch');
    if (!booking.check_in_at || !booking.property_id || ['cancelled', 'completed', 'archived', 'inactive'].includes(text(booking.ops_status))) { summary.skipped = 1; return summary; }
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
    const reconciled = await reconcileOperatorAlertConditions({
      accountId,
      bookingId,
      propertyId: text(booking.property_id),
      previousBookingId: text(previousResult.data?.id) || null,
      nextCheckInAt: evaluated.deadlines?.nextCheckInAt ?? null,
      now,
      conditions: evaluated.conditions.map((condition) => ({
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
    summary.alertsCreated += reconciled.alertsCreated;
    summary.alertsUpdated += reconciled.alertsUpdated;
    summary.alertsEscalated += reconciled.alertsEscalated;
    summary.alertsResolved += reconciled.alertsResolved;
    summary.unchanged += reconciled.unchanged;
    return summary;
  } catch (error) { summary.errors.push(error instanceof Error ? error.message : 'orchestration_failed'); return summary; }
}

async function sweepAllRelevantOpsAlerts(now: string, accountId?: string): Promise<OpsAlertRunSummary> {
  const empty: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  let query = supabase.from('booking_ops_records').select('id').not('check_in_at', 'is', null)
    .not('ops_status', 'in', '(cancelled,completed,archived,inactive)')
    .gte('check_in_at', new Date(new Date(now).getTime() - 24 * 60 * 60_000).toISOString())
    .lte('check_in_at', new Date(new Date(now).getTime() + 48 * 60 * 60_000).toISOString())
    .order('check_in_at').limit(200);
  if (accountId) query = query.eq('account_id', accountId);
  const result = await query;
  if (result.error) return { ...empty, errors: [result.error.message] };
  for (const item of result.data ?? []) {
    const current = await orchestrateOpsAlertsForBooking(String(item.id), now, accountId);
    for (const key of ['evaluated','alertsCreated','alertsUpdated','alertsEscalated','alertsResolved','skipped','unchanged'] as const) empty[key] += current[key];
    empty.errors.push(...current.errors);
  }
  return empty;
}

export async function orchestrateAllRelevantOpsAlerts(now = new Date().toISOString(), trigger: 'scheduled' | 'manual' = 'manual', accountId?: string): Promise<OpsAlertRunSummary> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const lock = await supabase.rpc('acquire_booking_ops_alert_run_lock', { p_lock_scope: 'ops-alerts:full', p_owner_id: runId, p_ttl_seconds: FULL_RUN_LEASE_TTL_SECONDS });
  if (lock.error || lock.data !== true) {
    const summary: OpsAlertRunSummary = { runId, trigger, startedAt, completedAt: new Date().toISOString(), lockAcquired: false, evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: lock.error ? ['lock_unavailable'] : [] };
    console.info('[booking-ops-alert-run]', JSON.stringify({ ...summary, errors: summary.errors.length }));
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
    const result = await sweepAllRelevantOpsAlerts(now, accountId);
    if (leaseRenewalFailed) result.errors.push('lock_renewal_failed');
    const summary = { ...result, runId, trigger, startedAt, completedAt: new Date().toISOString(), lockAcquired: true };
    console.info('[booking-ops-alert-run]', JSON.stringify({ ...summary, errors: summary.errors.length }));
    return summary;
  } finally {
    clearInterval(renewalTimer);
    const released = await supabase.rpc('release_booking_ops_alert_run_lock', { p_lock_scope: 'ops-alerts:full', p_owner_id: runId });
    if (released.error) console.error('[booking-ops-alert-run-lock-release]', JSON.stringify({ runId, error: 'lock_release_failed' }));
  }
}

export async function orchestrateOpsAlertsForProperty(propertyId: string, now = new Date().toISOString(), accountId?: string): Promise<OpsAlertRunSummary> {
  let query = supabase.from('booking_ops_records').select('id').eq('property_id', propertyId).not('check_in_at', 'is', null).order('check_in_at').limit(100);
  if (accountId) query = query.eq('account_id', accountId);
  const result = await query;
  const total: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  if (result.error) { total.errors.push(result.error.message); return total; }
  for (const item of result.data ?? []) {
    const current = await orchestrateOpsAlertsForBooking(String(item.id), now, accountId);
    for (const key of ['evaluated','alertsCreated','alertsUpdated','alertsEscalated','alertsResolved','skipped','unchanged'] as const) total[key] += current[key];
    total.errors.push(...current.errors);
  }
  return total;
}
