import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';

export const BOOKING_OPS_EVENT_TYPES = [
  'booking_created',
  'booking_updated',
  'readiness_status_changed',
  'readiness_completed',
  'operational_task_created',
  'task_action_run',
  'telegram_draft_created',
  'telegram_draft_reused',
  'task_status_changed',
  'completion_effect_applied',
  'completion_effect_suggested',
  'turnover_started',
  'unit_readiness_changed',
  'communication_intent_created',
  'communication_draft_created',
  'communication_intent_superseded',
  'communication_waiting_for_external_input',
  'guest_intake_started',
  'guest_intake_updated',
  'guest_intake_completed',
  'guest_intake_fallback_required',
  'guest_intake_waiting_for_guest',
  'guest_intake_link_opened',
  'guest_intake_submission_received',
  'guest_intake_validation_failed',
  'guest_intake_partially_completed',
  'ops_alert_created',
  'ops_alert_updated',
  'ops_alert_escalated',
  'ops_alert_acknowledged',
  'ops_alert_resolved',
  'sla_warning_triggered',
  'sla_critical_triggered',
  'turnover_deadlines_recalculated',
  'booking_automation_run_started',
  'booking_automation_step_planned',
  'booking_automation_step_started',
  'booking_automation_step_completed',
  'booking_automation_step_waiting',
  'booking_automation_retry_scheduled',
  'booking_automation_step_failed',
  'booking_automation_handoff_created',
  'booking_automation_run_completed',
] as const;

export type BookingOpsEventType = (typeof BOOKING_OPS_EVENT_TYPES)[number];
export type BookingOpsEventActorType = 'system' | 'admin' | 'readiness_gate' | 'task_runner';

export const BOOKING_OPS_TIMELINE_PINNED_EVENT_TYPES: BookingOpsEventType[] = ['booking_created'];

export const BOOKING_OPS_TIMELINE_DEFAULT_LIMIT = 50;
export const BOOKING_OPS_TIMELINE_MAX_LIMIT = 150;

export type BookingOpsEvent = {
  id: string;
  bookingOpsRecordId: string;
  eventType: BookingOpsEventType;
  title: string;
  description: string | null;
  actorType: BookingOpsEventActorType;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RecordBookingOpsEventInput = {
  bookingOpsRecordId: string;
  eventType: BookingOpsEventType;
  title: string;
  description?: string | null;
  actorType: BookingOpsEventActorType;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
};

type BookingOpsEventRow = {
  id: string;
  booking_ops_record_id: string;
  event_type: BookingOpsEventType;
  title: string;
  description: string | null;
  actor_type: BookingOpsEventActorType;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const SAFE_METADATA_KEYS = new Set([
  'actionOutcome',
  'actionType',
  'changedGroups',
  'draftActionId',
  'draftId',
  'draftStatus',
  'effectFields',
  'missingCount',
  'previousReadinessStatus',
  'previousStatus',
  'priority',
  'readinessStatus',
  'reused',
  'source',
  'status',
  'taskId',
  'taskStatus',
  'taskType',
  'unitReadinessStatus',
  'previousUnitReadinessStatus',
  'actorType',
  'communicationId',
  'communicationPurpose',
  'communicationStatus',
  'relatedTaskId',
  'guestIntakeSessionId',
  'guestIntakeStatus',
  'fallbackReason',
  'submissionSource',
  'validationStatus',
  'alertId',
  'alertCode',
  'severity',
  'sourceGate',
  'actionCode',
  'domain',
  'gateKey',
  'outcome',
  'reasonCode',
  'attemptCount',
  'retryAt',
  'communicationIntentId',
]);

function text(value: unknown, maxLength = 500): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function safeMetadataValue(value: unknown): unknown {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return text(value, 160);
  if (Array.isArray(value)) {
    return value
      .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
      .slice(0, 30)
      .map(safeMetadataValue);
  }
  return undefined;
}

export function sanitizeBookingOpsEventMetadata(
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

function mapRow(row: BookingOpsEventRow): BookingOpsEvent {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    eventType: row.event_type,
    title: row.title,
    description: row.description,
    actorType: row.actor_type,
    metadata: sanitizeBookingOpsEventMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

export async function recordBookingOpsEvent(
  input: RecordBookingOpsEventInput,
): Promise<{ ok: boolean; event?: BookingOpsEvent; deduplicated?: boolean; error?: string }> {
  const recordId = text(input.bookingOpsRecordId, 100);
  const title = text(input.title, 200);
  if (!recordId || !title) return { ok: false, error: 'event_input_required' };

  try {
    const { data, error } = await supabase
      .from('booking_ops_events')
      .insert({
        id: randomUUID(),
        booking_ops_record_id: recordId,
        event_type: input.eventType,
        title,
        description: text(input.description, 500) || null,
        actor_type: input.actorType,
        metadata: sanitizeBookingOpsEventMetadata(input.metadata),
        dedupe_key: text(input.dedupeKey, 300) || null,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error?.code === '23505') return { ok: true, deduplicated: true };
    if (error || !data) return { ok: false, error: error?.message ?? 'event_create_failed' };
    return { ok: true, event: mapRow(data as BookingOpsEventRow) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'event_create_failed' };
  }
}

/** Merge newest timeline events with pinned lifecycle anchors (deduped, newest first). */
export function mergePinnedBookingOpsTimelineEvents(
  newest: BookingOpsEvent[],
  pinned: BookingOpsEvent[],
): BookingOpsEvent[] {
  const byId = new Map<string, BookingOpsEvent>();
  for (const event of [...newest, ...pinned]) {
    byId.set(event.id, event);
  }
  return [...byId.values()].sort((left, right) => {
    const timeCmp = right.createdAt.localeCompare(left.createdAt);
    return timeCmp !== 0 ? timeCmp : right.id.localeCompare(left.id);
  });
}

export async function listBookingOpsEvents(
  bookingOpsRecordId: string,
  options?: { limit?: number },
): Promise<{ ok: true; events: BookingOpsEvent[] } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId, 100);
  if (!recordId) return { ok: false, error: 'id_required' };

  const limit = Math.min(
    Math.max(options?.limit ?? BOOKING_OPS_TIMELINE_DEFAULT_LIMIT, 1),
    BOOKING_OPS_TIMELINE_MAX_LIMIT,
  );

  const newestQuery = await supabase
    .from('booking_ops_events')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (newestQuery.error) return { ok: false, error: newestQuery.error.message };

  const newest = ((newestQuery.data ?? []) as BookingOpsEventRow[]).map(mapRow);
  const newestIds = new Set(newest.map((event) => event.id));
  const missingPinnedTypes = BOOKING_OPS_TIMELINE_PINNED_EVENT_TYPES.filter(
    (eventType) => !newest.some((event) => event.eventType === eventType),
  );

  if (missingPinnedTypes.length === 0) {
    return { ok: true, events: newest };
  }

  const pinnedQuery = await supabase
    .from('booking_ops_events')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .in('event_type', missingPinnedTypes)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (pinnedQuery.error) return { ok: false, error: pinnedQuery.error.message };

  const pinned = ((pinnedQuery.data ?? []) as BookingOpsEventRow[])
    .map(mapRow)
    .filter((event) => !newestIds.has(event.id));

  return { ok: true, events: mergePinnedBookingOpsTimelineEvents(newest, pinned) };
}

export async function recordBookingOpsReadinessEvent(input: {
  bookingOpsRecordId: string;
  readinessStatus: string;
  missingCount: number;
  sourceVersion: string;
}): Promise<void> {
  let data: unknown = null;
  try {
    const result = await supabase
      .from('booking_ops_events')
      .select('event_type, metadata')
      .eq('booking_ops_record_id', input.bookingOpsRecordId)
      .in('event_type', ['readiness_status_changed', 'readiness_completed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = result.data;
  } catch {
    return;
  }

  const previous = data as { metadata?: { readinessStatus?: string } } | null;
  if (previous?.metadata?.readinessStatus === input.readinessStatus) return;

  const completed = input.readinessStatus === 'completed';
  await recordBookingOpsEvent({
    bookingOpsRecordId: input.bookingOpsRecordId,
    eventType: completed ? 'readiness_completed' : 'readiness_status_changed',
    title: completed ? 'Операционная готовность завершена' : 'Готовность брони изменилась',
    description: completed
      ? 'Все обязательные этапы завершены.'
      : 'Чеклист готовности пересчитан после изменений.',
    actorType: 'readiness_gate',
    metadata: {
      previousReadinessStatus: previous?.metadata?.readinessStatus ?? null,
      readinessStatus: input.readinessStatus,
      missingCount: input.missingCount,
    },
    dedupeKey: `readiness:${input.readinessStatus}:${input.sourceVersion}`,
  });
}
