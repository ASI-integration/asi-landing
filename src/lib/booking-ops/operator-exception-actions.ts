import { supabase } from '@/lib/supabase';
import {
  createOperatorMissingDataRequestDraft,
  OPERATOR_MISSING_DATA_REASONS,
  type OperatorMissingDataReason,
} from './communication-orchestrator';
import { durableEventId, recordAndProcessBookingEvent, recordProcessedBookingAuditEvent } from './lifecycle-autopilot-service';
import { reconcileOperatorAlertsForBooking } from './ops-alert-orchestrator';
import {
  acknowledgeOperatorAlert,
  getOperatorAlert,
  resolveOperatorAlertOccurrence,
  type OperatorAlert,
  type OperatorAlertResolutionCategory,
  OPERATOR_ALERT_RESOLUTION_CATEGORIES,
} from './operator-alerts';
import { updateCleaningTask } from './physical-readiness-execution';

export const OPERATOR_ALERT_ACTIONS = [
  'acknowledge',
  'assign_executor',
  'request_missing_data',
  'advance_work',
  'resolve_alert',
] as const;
export type OperatorAlertAction = (typeof OPERATOR_ALERT_ACTIONS)[number];

export type OperatorAlertActionOption = {
  action: OperatorAlertAction;
  label: string;
  enabled: boolean;
  disabledReason: string | null;
  input: 'none' | 'executor' | 'missing_data_reason' | 'resolution';
  requiresConfirmation: boolean;
};

export type OperatorAlertActionHistory = {
  id: string;
  action: string;
  actorId: string | null;
  previousState: string | null;
  resultingState: string | null;
  reason: string | null;
  createdAt: string;
};

export type OperatorAlertControl = {
  linkedObject: { kind: 'worker_task' | 'cleaning'; id: string; role: string | null; status: string } | null;
  actions: OperatorAlertActionOption[];
  navigation: Array<{ kind: string; label: string; href: string }>;
  recentHistory: OperatorAlertActionHistory[];
};

type Row = Record<string, unknown>;
type LinkedObject = OperatorAlertControl['linkedObject'];
const SUPPORTED_WORKER_ROLES = new Set(['cleaner', 'linen_worker', 'consumables', 'inspector', 'maintenance_technician']);
const ASSIGNABLE_WORKER_STATES = new Set(['pending', 'assigned']);
const COMPLETABLE_WORKER_STATES = new Set(['assigned', 'in_progress']);
const MISSING_DATA_DOMAINS = new Set(['guest', 'legal', 'payment', 'compliance', 'booking', 'communication']);
const text = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max);

function roleForGate(gate: string): string | null {
  return gate === 'cleaning' ? 'cleaner'
    : gate === 'linen' ? 'linen_worker'
      : gate === 'inspection' ? 'inspector'
        : gate === 'maintenance' ? 'maintenance_technician'
          : null;
}

async function requireOwnedBooking(alert: OperatorAlert, accountId: string): Promise<Row> {
  const result = await supabase.from('booking_ops_records').select('id,account_id,property_id,booking_id')
    .eq('id', alert.bookingId).eq('account_id', accountId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('booking_not_found');
  if (text(result.data.property_id) !== alert.propertyId) throw new Error('booking_property_mismatch');
  return result.data as Row;
}

async function linkedObject(alert: OperatorAlert): Promise<LinkedObject> {
  if (alert.sourceGate === 'cleaning') {
    const cleaning = await supabase.from('booking_cleaning_tasks').select('id,booking_id,property_id,status')
      .eq('booking_id', alert.bookingId).eq('property_id', alert.propertyId).maybeSingle();
    if (cleaning.error) throw new Error(cleaning.error.message);
    if (cleaning.data) return { kind: 'cleaning', id: text(cleaning.data.id), role: 'cleaner', status: text(cleaning.data.status) };
  }
  const metadataTaskId = text(alert.metadata.taskId, 64);
  const role = roleForGate(alert.sourceGate);
  if (!metadataTaskId && !role) return null;
  let query = supabase.from('booking_ops_worker_tasks').select('id,booking_id,object_id,task_key,assigned_role,assigned_person_id,status')
    .eq('booking_id', alert.bookingId);
  if (metadataTaskId) query = query.eq('id', metadataTaskId);
  else query = query.eq('assigned_role', role!).order('updated_at', { ascending: false }).limit(1);
  const task = await query.maybeSingle();
  if (task.error) throw new Error(task.error.message);
  if (!task.data) return null;
  if (text(task.data.object_id) && text(task.data.object_id) !== alert.propertyId) throw new Error('task_property_mismatch');
  return { kind: 'worker_task', id: text(task.data.id), role: text(task.data.assigned_role), status: text(task.data.status) };
}

function navigation(alert: OperatorAlert, linked: LinkedObject) {
  const booking = encodeURIComponent(alert.bookingId);
  const property = encodeURIComponent(alert.propertyId);
  const links = [{ kind: 'booking', label: 'Открыть бронь', href: `/dashboard/booking-ops?bookingId=${booking}` }];
  const focus = alert.sourceDomain === 'guest' ? 'guest'
    : alert.sourceDomain === 'legal' ? 'legal'
      : alert.sourceDomain === 'payment' ? 'payment'
        : alert.sourceDomain === 'compliance' ? 'legal'
          : alert.sourceGate === 'cleaning' ? 'cleaning'
            : alert.sourceGate === 'readiness' ? 'readiness'
              : linked ? 'tasks' : null;
  if (focus) links.push({ kind: focus, label: focus === 'guest' ? 'Данные гостя' : focus === 'payment' ? 'Оплата и депозит' : focus === 'legal' ? 'Документы' : focus === 'cleaning' ? 'Уборка' : focus === 'readiness' ? 'Готовность' : 'Задача', href: `/dashboard/booking-ops?bookingId=${booking}&focus=${focus}` });
  if (alert.sourceDomain === 'communication') links.push({ kind: 'communication', label: 'Очередь сообщений', href: `/dashboard/communication?bookingId=${booking}` });
  links.push({ kind: 'property', label: 'Объект', href: `/dashboard/property-knowledge?propertyId=${property}` });
  return links;
}

function actionOptions(alert: OperatorAlert, linked: LinkedObject, canOverrideHighRisk: boolean): OperatorAlertActionOption[] {
  const active = alert.status !== 'resolved';
  const acknowledged = alert.status === 'acknowledged';
  const assignmentEnabled = active && Boolean(linked) && (
    linked?.kind === 'cleaning' ? ['pending', 'blocked'].includes(linked.status) : ASSIGNABLE_WORKER_STATES.has(linked?.status ?? '')
  );
  const advanceEnabled = active && Boolean(linked) && (
    linked?.kind === 'cleaning' ? ['assigned', 'in_progress', 'completed'].includes(linked.status) : COMPLETABLE_WORKER_STATES.has(linked?.status ?? '')
  );
  const resolveEnabled = active && (alert.severity !== 'critical' || canOverrideHighRisk);
  const result: OperatorAlertActionOption[] = [
    { action: 'acknowledge', label: 'Принять в работу', enabled: active && !acknowledged, disabledReason: !active ? 'Уведомление уже закрыто.' : acknowledged ? 'Уведомление уже принято в работу.' : null, input: 'none', requiresConfirmation: false },
  ];
  if (roleForGate(alert.sourceGate)) result.push({
    action: 'assign_executor', label: 'Назначить исполнителя', enabled: assignmentEnabled,
    disabledReason: !active ? 'Уведомление уже закрыто.' : !linked ? 'Связанная задача не найдена.' : assignmentEnabled ? null : `Назначение недоступно в состоянии «${linked.status}».`,
    input: 'executor', requiresConfirmation: false,
  });
  if (MISSING_DATA_DOMAINS.has(alert.sourceDomain)) result.push({ action: 'request_missing_data', label: 'Запросить данные', enabled: active, disabledReason: active ? null : 'Уведомление уже закрыто.', input: 'missing_data_reason', requiresConfirmation: false });
  if (roleForGate(alert.sourceGate)) result.push({
    action: 'advance_work', label: linked?.kind === 'cleaning' && linked.status === 'assigned' ? 'Начать уборку' : linked?.kind === 'cleaning' && linked.status === 'completed' ? 'Подтвердить уборку' : 'Отметить выполненным',
    enabled: advanceEnabled,
    disabledReason: !active ? 'Уведомление уже закрыто.' : !linked ? 'Связанная задача не найдена.' : advanceEnabled ? null : `Переход недоступен из состояния «${linked.status}».`,
    input: 'none', requiresConfirmation: false,
  });
  result.push({ action: 'resolve_alert', label: 'Закрыть уведомление', enabled: resolveEnabled, disabledReason: !active ? 'Уведомление уже закрыто.' : resolveEnabled ? null : 'Срочное уведомление может закрыть только администратор.', input: 'resolution', requiresConfirmation: true });
  return result;
}

async function recentHistory(alert: OperatorAlert): Promise<OperatorAlertActionHistory[]> {
  const result = await supabase.from('booking_ops_domain_events').select('id,event_type,actor_id,payload,created_at')
    .eq('booking_id', alert.bookingId).eq('source', 'operator_alert_actions').eq('payload->>alertId', alert.id)
    .order('created_at', { ascending: false }).limit(5);
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? []) as Row[]).map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Row : {};
    return {
      id: text(row.id), action: text(payload.actionType) || text(row.event_type), actorId: text(row.actor_id) || null,
      previousState: text(payload.previousCanonicalState) || null, resultingState: text(payload.resultingCanonicalState) || null,
      reason: text(payload.reason) || null, createdAt: text(row.created_at),
    };
  });
}

export async function getOperatorAlertControl(alert: OperatorAlert, canOverrideHighRisk: boolean): Promise<OperatorAlertControl> {
  const linked = await linkedObject(alert);
  return { linkedObject: linked, actions: actionOptions(alert, linked, canOverrideHighRisk), navigation: navigation(alert, linked), recentHistory: await recentHistory(alert) };
}

async function auditAction(input: {
  alert: OperatorAlert;
  action: OperatorAlertAction;
  actorId: string;
  linked: LinkedObject;
  previousState: string;
  resultingState: string;
  reason?: string | null;
  idempotencyKey?: string;
}) {
  const correlationId = durableEventId('operator_alert', input.alert.id);
  const fingerprint = input.idempotencyKey || [input.action, input.linked?.id, input.previousState, input.resultingState, input.reason].join(':');
  return recordProcessedBookingAuditEvent({
    id: durableEventId('operator_alert_action', input.alert.id, fingerprint),
    bookingId: input.alert.bookingId,
    objectId: input.alert.propertyId,
    type: `operator_alert.${input.action}`,
    actorType: 'operator',
    actorId: input.actorId,
    source: 'operator_alert_actions',
    correlationId,
    payload: {
      operatorId: input.actorId,
      accountId: input.alert.accountId,
      alertId: input.alert.id,
      bookingId: input.alert.bookingId,
      propertyId: input.alert.propertyId,
      linkedObjectId: input.linked?.id ?? null,
      linkedObjectKind: input.linked?.kind ?? null,
      actionType: input.action,
      previousCanonicalState: input.previousState,
      resultingCanonicalState: input.resultingState,
      reason: input.reason ?? null,
      causationId: input.alert.id,
      noExternalSend: true,
    },
  });
}

async function reconcile(alert: OperatorAlert) {
  const result = await reconcileOperatorAlertsForBooking(alert.bookingId, new Date().toISOString(), alert.accountId);
  if (result.errors.length) throw new Error(`operator_alert_reconcile_failed:${result.errors.join(',')}`);
  return result;
}

export async function applyOperatorAlertAction(input: {
  accountId: string;
  alertId: string;
  action: OperatorAlertAction;
  actorId: string;
  canOverrideHighRisk: boolean;
  idempotencyKey?: unknown;
  executorId?: unknown;
  assignedToName?: unknown;
  assignedToPhone?: unknown;
  assignedToTelegram?: unknown;
  missingDataReason?: unknown;
  resolutionCategory?: unknown;
  reason?: unknown;
}) {
  const alert = await getOperatorAlert(input.accountId, input.alertId);
  if (!alert) throw new Error('alert_not_found');
  const booking = await requireOwnedBooking(alert, input.accountId);
  const linked = await linkedObject(alert);
  const idempotencyKey = text(input.idempotencyKey, 160) || JSON.stringify([
    input.action, text(input.executorId), text(input.assignedToName), text(input.assignedToPhone),
    text(input.assignedToTelegram), text(input.missingDataReason), text(input.resolutionCategory), text(input.reason),
  ]);
  const previousAttempt = await supabase.from('booking_ops_domain_events').select('id')
    .eq('id', durableEventId('operator_alert_action', alert.id, idempotencyKey))
    .eq('booking_id', alert.bookingId).eq('source', 'operator_alert_actions').maybeSingle();
  if (previousAttempt.error) throw new Error(previousAttempt.error.message);
  if (previousAttempt.data) return { alert, idempotent: true, control: await getOperatorAlertControl(alert, input.canOverrideHighRisk) };

  if (input.action === 'acknowledge') {
    const updated = await acknowledgeOperatorAlert(input.accountId, alert.id, input.actorId);
    await auditAction({ alert, action: input.action, actorId: input.actorId, linked, previousState: alert.status, resultingState: updated.status, idempotencyKey });
    return { alert: updated, control: await getOperatorAlertControl(updated, input.canOverrideHighRisk) };
  }
  if (alert.status === 'resolved') throw new Error('alert_already_resolved');

  if (input.action === 'assign_executor') {
    if (!linked) throw new Error('assignable_object_not_found');
    if (linked.kind === 'worker_task') {
      const executorId = text(input.executorId, 200);
      if (!executorId) throw new Error('executor_id_required');
      if (!SUPPORTED_WORKER_ROLES.has(linked.role ?? '')) throw new Error('worker_role_unsupported');
      if (!ASSIGNABLE_WORKER_STATES.has(linked.status)) throw new Error(`worker_task_assignment_invalid:${linked.status}`);
      const write = await supabase.from('booking_ops_worker_tasks').update({ assigned_person_id: executorId, status: 'assigned', updated_at: new Date().toISOString() })
        .eq('id', linked.id).eq('booking_id', alert.bookingId).eq('assigned_role', linked.role!).in('status', [...ASSIGNABLE_WORKER_STATES]).select('id,status').maybeSingle();
      if (write.error) throw new Error(write.error.message);
      if (!write.data) throw new Error('worker_task_assignment_conflict');
      await auditAction({ alert, action: input.action, actorId: input.actorId, linked, previousState: linked.status, resultingState: 'assigned', idempotencyKey });
    } else {
      const assignedToName = text(input.assignedToName, 200);
      const assignedToPhone = text(input.assignedToPhone, 100);
      const assignedToTelegram = text(input.assignedToTelegram, 100);
      if (!assignedToName && !assignedToPhone && !assignedToTelegram) throw new Error('cleaning_executor_required');
      const readiness = await updateCleaningTask(alert.bookingId, { status: 'assigned', assignedToName, assignedToPhone, assignedToTelegram });
      await auditAction({ alert, action: input.action, actorId: input.actorId, linked, previousState: linked.status, resultingState: readiness.cleaning?.status ?? 'assigned', idempotencyKey });
    }
    const alertReconciliation = await reconcile(alert);
    const refreshed = await getOperatorAlert(input.accountId, alert.id);
    return { alert: refreshed, alertReconciliation, control: refreshed ? await getOperatorAlertControl(refreshed, input.canOverrideHighRisk) : null };
  }

  if (input.action === 'request_missing_data') {
    const reason = text(input.missingDataReason) as OperatorMissingDataReason;
    if (!MISSING_DATA_DOMAINS.has(alert.sourceDomain)) throw new Error('missing_data_request_not_supported_for_alert');
    if (!OPERATOR_MISSING_DATA_REASONS.includes(reason)) throw new Error('missing_data_reason_unsupported');
    const draft = await createOperatorMissingDataRequestDraft({
      bookingOpsRecordId: alert.bookingId,
      bookingId: text(booking.booking_id) || null,
      alertId: alert.id,
      reason,
      actorId: input.actorId,
    });
    await auditAction({ alert, action: input.action, actorId: input.actorId, linked, previousState: alert.status, resultingState: draft.created ? 'draft_ready' : 'draft_already_active', reason, idempotencyKey });
    return { alert, communication: { id: draft.communication.id, status: draft.communication.status, created: draft.created }, actuallySent: false, control: await getOperatorAlertControl(alert, input.canOverrideHighRisk) };
  }

  if (input.action === 'advance_work') {
    if (!linked) throw new Error('completable_object_not_found');
    let resultingState: string;
    if (linked.kind === 'cleaning') {
      const next = linked.status === 'assigned' ? 'in_progress' : linked.status === 'in_progress' ? 'completed' : linked.status === 'completed' ? 'verified' : null;
      if (!next) throw new Error(`cleaning_transition_invalid:${linked.status}`);
      const readiness = await updateCleaningTask(alert.bookingId, { status: next });
      resultingState = readiness.cleaning?.status ?? next;
    } else {
      if (!SUPPORTED_WORKER_ROLES.has(linked.role ?? '')) throw new Error('worker_role_unsupported');
      if (!COMPLETABLE_WORKER_STATES.has(linked.status)) {
        if (linked.status === 'completed') resultingState = 'completed';
        else throw new Error(`worker_task_completion_invalid:${linked.status}`);
      } else {
        const eventType = linked.role === 'cleaner' ? 'cleaner.task_completed'
          : linked.role === 'linen_worker' ? 'linen.task_completed'
            : linked.role === 'consumables' ? 'consumables.task_completed'
              : linked.role === 'inspector' ? 'inspection.completed'
                : 'maintenance.task_completed';
        const task = await supabase.from('booking_ops_worker_tasks').select('task_key').eq('id', linked.id).eq('booking_id', alert.bookingId).eq('assigned_role', linked.role!).maybeSingle();
        if (task.error) throw new Error(task.error.message);
        if (!task.data) throw new Error('worker_task_not_found');
        await recordAndProcessBookingEvent({
          id: durableEventId('operator_alert_completion', alert.id, linked.id), bookingId: alert.bookingId, objectId: alert.propertyId,
          type: eventType, actorType: 'operator', actorId: input.actorId, source: 'operator_alert_actions',
          correlationId: durableEventId('operator_alert', alert.id), payload: { taskId: linked.id, taskKey: text(task.data.task_key), alertId: alert.id },
        });
        resultingState = 'completed';
      }
    }
    await auditAction({ alert, action: input.action, actorId: input.actorId, linked, previousState: linked.status, resultingState, idempotencyKey });
    const alertReconciliation = await reconcile(alert);
    const refreshed = await getOperatorAlert(input.accountId, alert.id);
    return { alert: refreshed, alertReconciliation, control: refreshed ? await getOperatorAlertControl(refreshed, input.canOverrideHighRisk) : null };
  }

  const category = text(input.resolutionCategory) as OperatorAlertResolutionCategory;
  const reason = text(input.reason, 500);
  if (!OPERATOR_ALERT_RESOLUTION_CATEGORIES.includes(category)) throw new Error('resolution_category_unsupported');
  if (!reason) throw new Error('resolution_reason_required');
  if (alert.severity === 'critical' && !input.canOverrideHighRisk) throw new Error('high_risk_alert_override_forbidden');
  const updated = await resolveOperatorAlertOccurrence(input.accountId, alert.id, input.actorId, category, reason);
  await auditAction({ alert, action: input.action, actorId: input.actorId, linked, previousState: alert.status, resultingState: updated.status, reason: `${category}:${reason}`, idempotencyKey });
  return { alert: updated, canRecur: true, control: await getOperatorAlertControl(updated, input.canOverrideHighRisk) };
}
