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
] as const;

export type BookingOpsEventType = (typeof BOOKING_OPS_EVENT_TYPES)[number];
export type BookingOpsEventActorType = 'system' | 'admin' | 'readiness_gate' | 'task_runner';

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

export async function listBookingOpsEvents(
  bookingOpsRecordId: string,
  options?: { limit?: number },
): Promise<{ ok: true; events: BookingOpsEvent[] } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId, 100);
  if (!recordId) return { ok: false, error: 'id_required' };

  const { data, error } = await supabase
    .from('booking_ops_events')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 100));

  if (error) return { ok: false, error: error.message };
  return { ok: true, events: ((data ?? []) as BookingOpsEventRow[]).map(mapRow) };
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
