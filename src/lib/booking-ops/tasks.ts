import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { computeBookingReadiness, fetchTelegramDraftStatusesForRecord } from './readiness';
import { recordBookingOpsEvent, recordBookingOpsReadinessEvent } from './events';
import { syncBookingOpsTasksForReadiness } from './task-sync';
import {
  BOOKING_OPS_OPEN_TASK_STATUSES,
  BOOKING_OPS_TASK_TYPE_LABELS_RU,
  normalizeBookingOpsTaskPriority,
  normalizeBookingOpsTaskSource,
  normalizeBookingOpsTaskStatus,
  normalizeBookingOpsTaskType,
  type BookingOpsTask,
  type BookingOpsTaskPlanItem,
  type BookingOpsTaskSource,
  type BookingOpsTaskStatus,
  type BookingOpsTaskType,
  type CreateBookingOpsTaskInput,
  type UpdateBookingOpsTaskInput,
} from './task-types';
import type { BookingOpsRecord } from './types';

type BookingOpsTaskRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  task_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source: string;
  due_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function mapRow(row: BookingOpsTaskRow): BookingOpsTask {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    bookingId: text(row.booking_id) || null,
    taskType: row.task_type as BookingOpsTaskType,
    title: row.title,
    description: text(row.description) || null,
    status: row.status as BookingOpsTaskStatus,
    priority: row.priority as BookingOpsTask['priority'],
    source: row.source as BookingOpsTaskSource,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBookingOpsTasksForRecord(
  bookingOpsRecordId: string,
): Promise<{ ok: true; tasks: BookingOpsTask[] } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId);
  if (!recordId) return { ok: false, error: 'id_required' };

  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .order('updated_at', { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, tasks: ((data ?? []) as BookingOpsTaskRow[]).map(mapRow) };
}

async function findOpenTaskByType(
  bookingOpsRecordId: string,
  taskType: BookingOpsTaskType,
): Promise<BookingOpsTask | null> {
  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .select('*')
    .eq('booking_ops_record_id', bookingOpsRecordId)
    .eq('task_type', taskType)
    .in('status', BOOKING_OPS_OPEN_TASK_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as BookingOpsTaskRow);
}

async function findLatestTaskByType(
  bookingOpsRecordId: string,
  taskType: BookingOpsTaskType,
): Promise<BookingOpsTask | null> {
  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .select('*')
    .eq('booking_ops_record_id', bookingOpsRecordId)
    .eq('task_type', taskType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as BookingOpsTaskRow);
}

export async function createBookingOpsTask(
  input: CreateBookingOpsTaskInput,
): Promise<{ ok: true; task: BookingOpsTask; created: boolean } | { ok: false; error: string }> {
  const recordId = text(input.bookingOpsRecordId);
  const taskType = input.taskType;
  if (!recordId) return { ok: false, error: 'id_required' };

  const existing = await findOpenTaskByType(recordId, taskType);
  if (existing) return { ok: true, task: existing, created: false };

  const now = nowIso();
  const id = randomUUID();
  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .insert({
      id,
      booking_ops_record_id: recordId,
      booking_id: text(input.bookingId) || null,
      task_type: taskType,
      title: input.title,
      description: input.description ?? null,
      status: 'open',
      priority: input.priority ?? 'normal',
      source: input.source ?? 'manual',
      due_at: input.dueAt ?? null,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'task_create_failed' };
  const task = mapRow(data as BookingOpsTaskRow);
  await recordBookingOpsEvent({
    bookingOpsRecordId: recordId,
    eventType: 'operational_task_created',
    title: 'Создана операционная задача',
    description: BOOKING_OPS_TASK_TYPE_LABELS_RU[task.taskType],
    actorType: task.source === 'readiness_gate' ? 'readiness_gate' : 'admin',
    metadata: {
      taskId: task.id,
      taskType: task.taskType,
      taskStatus: task.status,
      priority: task.priority,
      source: task.source,
    },
    dedupeKey: `task-created:${task.id}`,
  });
  return { ok: true, task, created: true };
}

export async function getBookingOpsTask(
  bookingOpsRecordId: string,
  taskId: string,
): Promise<{ ok: true; task: BookingOpsTask } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId);
  const id = text(taskId);
  if (!recordId || !id) return { ok: false, error: 'id_required' };

  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .select('*')
    .eq('id', id)
    .eq('booking_ops_record_id', recordId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  return { ok: true, task: mapRow(data as BookingOpsTaskRow) };
}

export async function updateBookingOpsTask(
  bookingOpsRecordId: string,
  taskId: string,
  input: UpdateBookingOpsTaskInput,
): Promise<{ ok: true; task: BookingOpsTask } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId);
  const id = text(taskId);
  if (!recordId || !id) return { ok: false, error: 'id_required' };

  const previousResult = await getBookingOpsTask(recordId, id);
  if (!previousResult.ok) return previousResult;

  const patch: Record<string, unknown> = { updated_at: nowIso() };

  if (input.status !== undefined) {
    const status = normalizeBookingOpsTaskStatus(input.status);
    if (!status) return { ok: false, error: 'invalid_status' };
    patch.status = status;
    if (status === 'completed') {
      patch.completed_at = nowIso();
    } else if (status === 'open' || status === 'in_progress' || status === 'blocked') {
      patch.completed_at = null;
    }
  }
  if (input.priority !== undefined) {
    const priority = normalizeBookingOpsTaskPriority(input.priority);
    if (!priority) return { ok: false, error: 'invalid_priority' };
    patch.priority = priority;
  }
  if (input.description !== undefined) {
    patch.description = text(input.description) || null;
  }

  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .update(patch)
    .eq('id', id)
    .eq('booking_ops_record_id', recordId)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  const task = mapRow(data as BookingOpsTaskRow);
  if (input.status !== undefined && task.status !== previousResult.task.status) {
    await recordBookingOpsEvent({
      bookingOpsRecordId: recordId,
      eventType: 'task_status_changed',
      title: 'Статус задачи изменён',
      description: BOOKING_OPS_TASK_TYPE_LABELS_RU[task.taskType],
      actorType: 'admin',
      metadata: {
        taskId: task.id,
        taskType: task.taskType,
        previousStatus: previousResult.task.status,
        status: task.status,
      },
      dedupeKey: `task-status:${task.id}:${previousResult.task.status}:${task.status}:${previousResult.task.updatedAt}`,
    });
  }
  return { ok: true, task };
}

async function cancelObsoleteReadinessTasks(
  bookingOpsRecordId: string,
  plannedTypes: Set<BookingOpsTaskType>,
): Promise<void> {
  const { data, error } = await supabase
    .from('booking_ops_tasks')
    .select('id, task_type')
    .eq('booking_ops_record_id', bookingOpsRecordId)
    .eq('source', 'readiness_gate')
    .in('status', BOOKING_OPS_OPEN_TASK_STATUSES);

  if (error || !data) return;

  const obsolete = (data as Array<{ id: string; task_type: string }>).filter(
    (row) => !plannedTypes.has(row.task_type as BookingOpsTaskType),
  );
  if (obsolete.length === 0) return;

  const now = nowIso();
  await supabase
    .from('booking_ops_tasks')
    .update({ status: 'cancelled', updated_at: now })
    .in('id', obsolete.map((row) => row.id));
}

async function upsertPlannedTask(
  record: BookingOpsRecord,
  item: BookingOpsTaskPlanItem,
): Promise<void> {
  const existing = await findOpenTaskByType(record.id, item.taskType);
  if (existing) {
    const metadataChanged =
      JSON.stringify(existing.metadata) !== JSON.stringify(item.metadata ?? {});
    if (
      existing.title !== item.title
      || existing.description !== item.description
      || existing.priority !== item.priority
      || metadataChanged
    ) {
      await supabase
        .from('booking_ops_tasks')
        .update({
          title: item.title,
          description: item.description,
          priority: item.priority,
          metadata: {
            ...existing.metadata,
            ...(item.metadata ?? {}),
            readinessStatus: item.metadata?.readinessStatus,
          },
          updated_at: nowIso(),
        })
        .eq('id', existing.id);
    }
    return;
  }

  const latest = await findLatestTaskByType(record.id, item.taskType);
  if (latest && (latest.status === 'completed' || latest.status === 'cancelled')) {
    return;
  }

  await createBookingOpsTask({
    bookingOpsRecordId: record.id,
    bookingId: record.bookingId,
    taskType: item.taskType,
    title: item.title,
    description: item.description,
    priority: item.priority,
    source: 'readiness_gate',
    metadata: {
      ...(item.metadata ?? {}),
      readinessStatus: item.metadata?.readinessStatus,
    },
  });
}

export type BookingOpsTaskSyncResult = {
  ok: boolean;
  plan: ReturnType<typeof syncBookingOpsTasksForReadiness>;
  tasks: BookingOpsTask[];
  error?: string;
};

export async function applyBookingOpsTaskSync(
  record: BookingOpsRecord,
): Promise<BookingOpsTaskSyncResult> {
  const drafts = await fetchTelegramDraftStatusesForRecord(record.id);
  const readiness = computeBookingReadiness({ ...record, telegramDrafts: drafts });
  const plan = syncBookingOpsTasksForReadiness(record, readiness);
  const plannedTypes = new Set(plan.items.map((item) => item.taskType));

  await cancelObsoleteReadinessTasks(record.id, plannedTypes);
  for (const item of plan.items) {
    await upsertPlannedTask(record, item);
  }
  await recordBookingOpsReadinessEvent({
    bookingOpsRecordId: record.id,
    readinessStatus: readiness.status,
    missingCount: readiness.missingItems.length,
    sourceVersion: record.updatedAt,
  });

  const listed = await listBookingOpsTasksForRecord(record.id);
  if (!listed.ok) {
    return { ok: false, plan, tasks: [], error: listed.error };
  }
  return { ok: true, plan, tasks: listed.tasks };
}

export function parseCreateManualBookingOpsTaskInput(
  body: Record<string, unknown>,
  bookingOpsRecordId: string,
): { ok: true; input: CreateBookingOpsTaskInput } | { ok: false; error: string } {
  const taskType = normalizeBookingOpsTaskType(body.taskType ?? body.task_type);
  if (!taskType) return { ok: false, error: 'invalid_task_type' };

  const title = text(body.title) || undefined;
  const description = text(body.description) || null;
  const priority = normalizeBookingOpsTaskPriority(body.priority) ?? 'normal';
  const source = normalizeBookingOpsTaskSource(body.source) ?? 'manual';

  return {
    ok: true,
    input: {
      bookingOpsRecordId,
      bookingId: text(body.bookingId ?? body.booking_id) || null,
      taskType,
      title: title ?? BOOKING_OPS_TASK_TYPE_LABELS_RU[taskType],
      description,
      priority,
      source,
      dueAt: text(body.dueAt ?? body.due_at) || null,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    },
  };
}

export function parseUpdateBookingOpsTaskInput(
  body: Record<string, unknown>,
): { ok: true; input: UpdateBookingOpsTaskInput } | { ok: false; error: string } {
  const input: UpdateBookingOpsTaskInput = {};
  if ('status' in body) {
    const status = normalizeBookingOpsTaskStatus(body.status);
    if (!status) return { ok: false, error: 'invalid_status' };
    input.status = status;
  }
  if ('priority' in body) {
    const priority = normalizeBookingOpsTaskPriority(body.priority);
    if (!priority) return { ok: false, error: 'invalid_priority' };
    input.priority = priority;
  }
  if ('description' in body) {
    input.description = text(body.description) || null;
  }
  if (Object.keys(input).length === 0) return { ok: false, error: 'empty_patch' };
  return { ok: true, input };
}
