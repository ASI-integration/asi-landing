import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent, type BookingOpsEventType } from './events';

export type OperatorAlertSeverity = 'info' | 'warning' | 'critical';
export type OperatorAlertStatus = 'open' | 'acknowledged' | 'resolved';

export type OperatorAlert = {
  id: string;
  accountId: string;
  bookingId: string;
  propertyId: string;
  alertCode: string;
  incidentFamily: string;
  sourceDomain: string;
  sourceGate: string;
  severity: OperatorAlertSeverity;
  status: OperatorAlertStatus;
  title: string;
  description: string;
  recommendedAction: string;
  dedupeKey: string;
  detectedAt: string;
  deadlineAt: string | null;
  nextCheckInAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
};

export type OperatorAlertCondition = {
  code: string;
  incidentFamily: string;
  sourceDomain: string;
  sourceGate: string;
  severity: OperatorAlertSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  deadlineAt: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ReconcileOperatorAlertConditionsInput = {
  accountId: string;
  bookingId: string;
  propertyId: string;
  managedSourceDomains: string[];
  conditions: OperatorAlertCondition[];
  now: string;
  previousBookingId?: string | null;
  nextCheckInAt?: string | null;
};

export type OperatorAlertReconcileSummary = {
  alertsCreated: number;
  alertsUpdated: number;
  alertsEscalated: number;
  alertsResolved: number;
  unchanged: number;
};

type Row = Record<string, unknown>;
const ACTIVE_STATUSES: OperatorAlertStatus[] = ['open', 'acknowledged'];
const severityRank: Record<OperatorAlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
const SAFE_METADATA_KEYS = new Set([
  'attemptCount',
  'checkoutAt',
  'communicationState',
  'gateStatus',
  'minutesToCheckIn',
  'nextCheckInAt',
  'previousBookingId',
  'reasonCode',
  'readinessStatus',
  'referenceId',
  'state',
  'taskId',
  'turnoverId',
  'automationStatus',
  'automationLastAction',
  'automationAttemptCount',
  'automationNextRetryAt',
  'failureCode',
  'requiresApproval',
  'policyDecision',
]);

const text = (value: unknown, maxLength = 500) => String(value ?? '').trim().slice(0, maxLength);
const nullableText = (value: unknown) => {
  const normalized = text(value);
  return normalized || null;
};

function safeMetadataValue(value: unknown): unknown {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return text(value, 160);
  if (Array.isArray(value)) {
    return value
      .filter((item) => ['boolean', 'number', 'string'].includes(typeof item))
      .slice(0, 20)
      .map(safeMetadataValue);
  }
  return undefined;
}

export function sanitizeOperatorAlertMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (!SAFE_METADATA_KEYS.has(key)) return [];
      const safeValue = safeMetadataValue(value);
      return safeValue === undefined ? [] : [[key, safeValue]];
    }),
  );
}

export function buildOperatorAlertDedupeKey(input: {
  bookingId: string;
  propertyId: string;
  incidentFamily: string;
  sourceDomain: string;
  sourceGate: string;
}): string {
  const parts = input.sourceDomain === 'turnover'
    ? [input.bookingId, input.propertyId, input.incidentFamily, input.sourceGate, input.bookingId]
    : [input.bookingId, input.propertyId, input.sourceDomain, input.incidentFamily, input.sourceGate, input.bookingId];
  return parts.map((part) => text(part, 120)).join(':');
}

export function mapOperatorAlertRow(row: Row): OperatorAlert {
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    bookingId: text(row.booking_id),
    propertyId: text(row.property_id),
    alertCode: text(row.alert_code),
    incidentFamily: text(row.incident_family),
    sourceDomain: text(row.source_domain),
    sourceGate: text(row.source_gate),
    severity: text(row.severity) as OperatorAlertSeverity,
    status: text(row.status) as OperatorAlertStatus,
    title: text(row.title),
    description: text(row.description),
    recommendedAction: text(row.recommended_action),
    dedupeKey: text(row.dedupe_key),
    detectedAt: text(row.detected_at),
    deadlineAt: nullableText(row.deadline_at),
    nextCheckInAt: nullableText(row.next_check_in_at),
    acknowledgedAt: nullableText(row.acknowledged_at),
    resolvedAt: nullableText(row.resolved_at),
    metadata: sanitizeOperatorAlertMetadata(row.metadata as Record<string, unknown> | null),
  };
}

async function emitAlertEvent(
  bookingId: string,
  eventType: BookingOpsEventType,
  alert: Row,
  suffix: string,
) {
  await recordBookingOpsEvent({
    bookingOpsRecordId: bookingId,
    eventType,
    title: text(alert.title),
    description: text(alert.description),
    actorType: 'system',
    metadata: {
      alertId: alert.id,
      alertCode: alert.alert_code,
      severity: alert.severity,
      sourceGate: alert.source_gate,
    },
    dedupeKey: `operator-alert:${alert.id}:${suffix}`,
  });
}

function comparable(value: unknown): string {
  if (!value || typeof value !== 'object') return text(value);
  const object = value as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]])));
}

function conditionPatch(condition: OperatorAlertCondition, input: ReconcileOperatorAlertConditionsInput) {
  return {
    alert_code: text(condition.code, 120),
    incident_family: text(condition.incidentFamily, 120),
    source_domain: text(condition.sourceDomain, 120),
    source_gate: text(condition.sourceGate, 120),
    severity: condition.severity,
    title: text(condition.title, 200),
    description: text(condition.description),
    recommended_action: text(condition.recommendedAction),
    deadline_at: condition.deadlineAt,
    next_check_in_at: input.nextCheckInAt ?? null,
    metadata: sanitizeOperatorAlertMetadata(condition.metadata),
    updated_at: input.now,
  };
}

async function updateExistingAlert(
  existing: Row,
  condition: OperatorAlertCondition,
  input: ReconcileOperatorAlertConditionsInput,
  summary: OperatorAlertReconcileSummary,
) {
  const patch = conditionPatch(condition, input);
  const changedKeys = [
    'alert_code', 'incident_family', 'source_domain', 'source_gate', 'severity', 'title',
    'description', 'recommended_action', 'deadline_at', 'next_check_in_at', 'metadata',
  ] as const;
  if (!changedKeys.some((key) => comparable(existing[key]) !== comparable(patch[key]))) {
    summary.unchanged += 1;
    return;
  }

  const previousSeverity = text(existing.severity) as OperatorAlertSeverity;
  const escalated = severityRank[condition.severity] > (severityRank[previousSeverity] ?? -1);
  const result = await supabase
    .from('booking_ops_alerts')
    .update(patch)
    .eq('id', existing.id)
    .eq('account_id', input.accountId)
    .in('status', ACTIVE_STATUSES)
    .select('*')
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('operator_alert_update_conflict');

  summary.alertsUpdated += 1;
  if (escalated) summary.alertsEscalated += 1;
  const row = result.data as Row;
  await emitAlertEvent(input.bookingId, escalated ? 'ops_alert_escalated' : 'ops_alert_updated', row,
    `${escalated ? 'escalated' : 'updated'}:${condition.severity}:${condition.deadlineAt ?? 'none'}`);
  if (escalated) {
    await emitAlertEvent(input.bookingId, 'sla_critical_triggered', row, `critical:${condition.deadlineAt ?? 'none'}`);
  }
}

export async function reconcileOperatorAlertConditions(
  input: ReconcileOperatorAlertConditionsInput,
): Promise<OperatorAlertReconcileSummary> {
  const summary: OperatorAlertReconcileSummary = {
    alertsCreated: 0,
    alertsUpdated: 0,
    alertsEscalated: 0,
    alertsResolved: 0,
    unchanged: 0,
  };
  if (!input.accountId || input.accountId === 'legacy') throw new Error('operator_alert_account_required');
  const managedSourceDomains = [...new Set(input.managedSourceDomains.map((domain) => text(domain, 120)).filter(Boolean))];
  if (managedSourceDomains.length === 0) throw new Error('operator_alert_managed_source_domains_required');
  if (input.conditions.some((condition) => !managedSourceDomains.includes(text(condition.sourceDomain, 120)))) {
    throw new Error('operator_alert_source_domain_not_managed');
  }

  const bookingResult = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id')
    .eq('id', input.bookingId)
    .maybeSingle();
  if (bookingResult.error) throw new Error(bookingResult.error.message);
  if (!bookingResult.data) throw new Error('booking_not_found');
  if (text(bookingResult.data.account_id) !== input.accountId) throw new Error('booking_account_mismatch');
  if (text(bookingResult.data.property_id) !== input.propertyId) throw new Error('booking_property_mismatch');

  const activeResult = await supabase
    .from('booking_ops_alerts')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('booking_id', input.bookingId)
    .in('source_domain', managedSourceDomains)
    .in('status', ACTIVE_STATUSES);
  if (activeResult.error) throw new Error(activeResult.error.message);
  const active = (activeResult.data ?? []) as Row[];
  const desired = new Map(input.conditions.map((condition) => [buildOperatorAlertDedupeKey({
    bookingId: input.bookingId,
    propertyId: input.propertyId,
    incidentFamily: condition.incidentFamily,
    sourceDomain: condition.sourceDomain,
    sourceGate: condition.sourceGate,
  }), condition]));

  for (const alert of active) {
    if (desired.has(text(alert.dedupe_key))) continue;
    const result = await supabase
      .from('booking_ops_alerts')
      .update({
        status: 'resolved',
        resolved_at: input.now,
        resolution_reason: 'underlying_condition_cleared',
        updated_at: input.now,
      })
      .eq('id', alert.id)
      .eq('account_id', input.accountId)
      .in('status', ACTIVE_STATUSES)
      .select('*')
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (result.data) {
      summary.alertsResolved += 1;
      await emitAlertEvent(input.bookingId, 'ops_alert_resolved', result.data as Row, `resolved:${input.now}`);
    }
  }

  for (const [dedupeKey, condition] of desired) {
    const existing = active.find((alert) => text(alert.dedupe_key) === dedupeKey);
    if (existing) {
      await updateExistingAlert(existing, condition, input, summary);
      continue;
    }

    const patch = conditionPatch(condition, input);
    const insert = {
      id: randomUUID(),
      account_id: input.accountId,
      booking_id: input.bookingId,
      previous_booking_id: input.previousBookingId ?? null,
      property_id: input.propertyId,
      ...patch,
      status: 'open',
      dedupe_key: dedupeKey,
      detected_at: input.now,
      created_at: input.now,
    };
    const result = await supabase.from('booking_ops_alerts').insert(insert).select('*').single();
    if (result.error?.code === '23505') {
      const raced = await supabase
        .from('booking_ops_alerts')
        .select('*')
        .eq('account_id', input.accountId)
        .eq('dedupe_key', dedupeKey)
        .eq('source_domain', condition.sourceDomain)
        .in('status', ACTIVE_STATUSES)
        .maybeSingle();
      if (raced.error) throw new Error(raced.error.message);
      if (!raced.data) throw new Error('operator_alert_duplicate_race_missing');
      await updateExistingAlert(raced.data as Row, condition, input, summary);
      continue;
    }
    if (result.error) throw new Error(result.error.message);
    const row = result.data as Row;
    summary.alertsCreated += 1;
    await emitAlertEvent(input.bookingId, 'ops_alert_created', row, 'created');
    await emitAlertEvent(
      input.bookingId,
      condition.severity === 'critical' ? 'sla_critical_triggered' : 'sla_warning_triggered',
      row,
      `sla:${condition.severity}:${condition.deadlineAt ?? 'none'}`,
    );
  }

  return summary;
}

export async function getOperatorAlert(accountId: string, alertId: string): Promise<OperatorAlert | null> {
  const result = await supabase
    .from('booking_ops_alerts')
    .select('*')
    .eq('id', alertId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? mapOperatorAlertRow(result.data as Row) : null;
}

export async function acknowledgeOperatorAlert(accountId: string, alertId: string, actor: string) {
  const now = new Date().toISOString();
  const result = await supabase
    .from('booking_ops_alerts')
    .update({ status: 'acknowledged', acknowledged_at: now, acknowledged_by: actor, updated_at: now })
    .eq('id', alertId)
    .eq('account_id', accountId)
    .eq('status', 'open')
    .select('*')
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('alert_not_found_or_not_open');
  await emitAlertEvent(String(result.data.booking_id), 'ops_alert_acknowledged', result.data as Row, `ack:${now}`);
  return mapOperatorAlertRow(result.data as Row);
}

export async function resolveOperatorAlertOccurrence(accountId: string, alertId: string, _actor: string, reason: string) {
  const cleanReason = text(reason, 500);
  if (!cleanReason) throw new Error('resolution_reason_required');
  const now = new Date().toISOString();
  const result = await supabase.from('booking_ops_alerts').update({
    status: 'resolved', resolved_at: now, resolution_reason: cleanReason,
    updated_at: now,
  }).eq('id', alertId).eq('account_id', accountId).in('status', ACTIVE_STATUSES).select('*').maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('alert_not_found_or_resolved');
  await emitAlertEvent(String(result.data.booking_id), 'ops_alert_resolved', result.data as Row, `operator:${now}`);
  return mapOperatorAlertRow(result.data as Row);
}
