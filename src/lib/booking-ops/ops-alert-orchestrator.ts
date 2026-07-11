import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent, type BookingOpsEventType } from './events';
import { evaluateOpsTurnover, type OpsAlertCondition } from './ops-alert-engine';

const FULL_RUN_LEASE_TTL_SECONDS = 900;
const FULL_RUN_LEASE_RENEW_INTERVAL_MS = 60_000;

export type OpsAlertRunSummary = { runId?: string; trigger?: 'scheduled' | 'manual' | 'targeted'; startedAt?: string; completedAt?: string; lockAcquired?: boolean; evaluated: number; alertsCreated: number; alertsUpdated: number; alertsEscalated: number; alertsResolved: number; skipped: number; unchanged: number; errors: string[] };
type Row = Record<string, unknown>;
const rank = { info: 0, warning: 1, critical: 2 } as const;
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

async function emit(bookingId: string, eventType: BookingOpsEventType, alert: Row, suffix: string) {
  await recordBookingOpsEvent({
    bookingOpsRecordId: bookingId,
    eventType,
    title: text(alert.title),
    description: text(alert.description),
    actorType: 'system',
    metadata: { alertId: alert.id, alertCode: alert.alert_code, severity: alert.severity, sourceGate: alert.source_gate },
    dedupeKey: `ops-v15:${alert.id}:${suffix}`,
  });
}

async function persistConditions(booking: Row, previousBookingId: string | null, conditions: OpsAlertCondition[], now: string, summary: OpsAlertRunSummary) {
  const bookingId = text(booking.id);
  const activeResult = await supabase.from('booking_ops_alerts').select('*').eq('booking_id', bookingId).in('status', ['open', 'acknowledged']);
  if (activeResult.error) throw new Error(activeResult.error.message);
  const active = (activeResult.data ?? []) as Row[];
  const desired = new Map(conditions.map((condition) => [condition.dedupeKey, condition]));
  for (const alert of active) {
    if (desired.has(text(alert.dedupe_key))) continue;
    const resolvedAt = now;
    const result = await supabase.from('booking_ops_alerts').update({ status: 'resolved', resolved_at: resolvedAt, resolution_reason: 'underlying_condition_cleared', updated_at: now }).eq('id', alert.id).in('status', ['open', 'acknowledged']).select('*').maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (result.data) { summary.alertsResolved += 1; await emit(bookingId, 'ops_alert_resolved', result.data as Row, `resolved:${resolvedAt}`); }
  }
  for (const condition of conditions) {
    const existing = active.find((alert) => text(alert.dedupe_key) === condition.dedupeKey);
    const patch = { alert_code: condition.code, severity: condition.severity, title: condition.title, description: condition.description, deadline_at: condition.deadlineAt, next_check_in_at: condition.nextCheckInAt, metadata: condition.metadata, updated_at: now };
    if (existing) {
      const changed = ['alert_code', 'severity', 'title', 'description', 'deadline_at', 'next_check_in_at'].some((key) => text(existing[key]) !== text(patch[key as keyof typeof patch]));
      if (!changed) { summary.unchanged += 1; continue; }
      const escalated = rank[condition.severity] > rank[text(existing.severity) as keyof typeof rank];
      const result = await supabase.from('booking_ops_alerts').update(patch).eq('id', existing.id).select('*').single();
      if (result.error) throw new Error(result.error.message);
      summary.alertsUpdated += 1;
      if (escalated) summary.alertsEscalated += 1;
      await emit(bookingId, escalated ? 'ops_alert_escalated' : 'ops_alert_updated', result.data as Row, `${escalated ? 'escalated' : 'updated'}:${condition.severity}:${condition.deadlineAt}`);
      if (escalated) await emit(bookingId, 'sla_critical_triggered', result.data as Row, `critical:${condition.deadlineAt}`);
      continue;
    }
    const insert = { id: randomUUID(), booking_id: bookingId, previous_booking_id: previousBookingId, property_id: text(booking.property_id), alert_code: condition.code, source_gate: condition.gate, severity: condition.severity, status: 'open', title: condition.title, description: condition.description, dedupe_key: condition.dedupeKey, detected_at: now, deadline_at: condition.deadlineAt, next_check_in_at: condition.nextCheckInAt, metadata: condition.metadata, created_at: now, updated_at: now };
    const result = await supabase.from('booking_ops_alerts').insert(insert).select('*').single();
    if (result.error?.code === '23505') { summary.unchanged += 1; continue; }
    if (result.error) throw new Error(result.error.message);
    summary.alertsCreated += 1;
    await emit(bookingId, 'ops_alert_created', result.data as Row, 'created');
    await emit(bookingId, condition.severity === 'critical' ? 'sla_critical_triggered' : 'sla_warning_triggered', result.data as Row, `sla:${condition.severity}:${condition.deadlineAt}`);
  }
}

export async function orchestrateOpsAlertsForBooking(bookingId: string, now = new Date().toISOString()): Promise<OpsAlertRunSummary> {
  const summary: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  try {
    const bookingResult = await supabase.from('booking_ops_records').select('*').eq('id', bookingId).maybeSingle();
    if (bookingResult.error) throw new Error(bookingResult.error.message);
    const booking = bookingResult.data as Row | null;
    if (!booking) throw new Error('booking_not_found');
    if (!booking.check_in_at || !booking.property_id || ['cancelled', 'completed', 'archived', 'inactive'].includes(text(booking.ops_status))) { summary.skipped = 1; return summary; }
    const previousResult = await supabase.from('booking_ops_records').select('id,check_out_at').eq('property_id', booking.property_id).neq('id', bookingId).lte('check_out_at', booking.check_in_at).order('check_out_at', { ascending: false }).limit(1).maybeSingle();
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
    await persistConditions(booking, text(previousResult.data?.id) || null, evaluated.conditions, now, summary);
    return summary;
  } catch (error) { summary.errors.push(error instanceof Error ? error.message : 'orchestration_failed'); return summary; }
}

async function sweepAllRelevantOpsAlerts(now: string): Promise<OpsAlertRunSummary> {
  const empty: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  const result = await supabase.from('booking_ops_records').select('id').not('check_in_at', 'is', null)
    .not('ops_status', 'in', '(cancelled,completed,archived,inactive)')
    .gte('check_in_at', new Date(new Date(now).getTime() - 24 * 60 * 60_000).toISOString())
    .lte('check_in_at', new Date(new Date(now).getTime() + 48 * 60 * 60_000).toISOString())
    .order('check_in_at').limit(200);
  if (result.error) return { ...empty, errors: [result.error.message] };
  for (const item of result.data ?? []) {
    const current = await orchestrateOpsAlertsForBooking(String(item.id), now);
    for (const key of ['evaluated','alertsCreated','alertsUpdated','alertsEscalated','alertsResolved','skipped','unchanged'] as const) empty[key] += current[key];
    empty.errors.push(...current.errors);
  }
  return empty;
}

export async function orchestrateAllRelevantOpsAlerts(now = new Date().toISOString(), trigger: 'scheduled' | 'manual' = 'manual'): Promise<OpsAlertRunSummary> {
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
    const result = await sweepAllRelevantOpsAlerts(now);
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

export async function orchestrateOpsAlertsForProperty(propertyId: string, now = new Date().toISOString()): Promise<OpsAlertRunSummary> {
  const result = await supabase.from('booking_ops_records').select('id').eq('property_id', propertyId).not('check_in_at', 'is', null).order('check_in_at').limit(100);
  const total: OpsAlertRunSummary = { evaluated: 0, alertsCreated: 0, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, skipped: 0, unchanged: 0, errors: [] };
  if (result.error) { total.errors.push(result.error.message); return total; }
  for (const item of result.data ?? []) {
    const current = await orchestrateOpsAlertsForBooking(String(item.id), now);
    for (const key of ['evaluated','alertsCreated','alertsUpdated','alertsEscalated','alertsResolved','skipped','unchanged'] as const) total[key] += current[key];
    total.errors.push(...current.errors);
  }
  return total;
}

export async function acknowledgeOpsAlert(alertId: string, actor: string) {
  const now = new Date().toISOString();
  const result = await supabase.from('booking_ops_alerts').update({ status: 'acknowledged', acknowledged_at: now, acknowledged_by: actor, updated_at: now }).eq('id', alertId).eq('status', 'open').select('*').maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('alert_not_found_or_not_open');
  await emit(String(result.data.booking_id), 'ops_alert_acknowledged', result.data as Row, `ack:${now}`);
  return result.data;
}
