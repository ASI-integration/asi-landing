import { supabase } from '@/lib/supabase';
import {
  OPS_DONE_STATUSES,
  OPS_OPEN_STATUSES,
  OPS_TASK_TYPE_LABELS,
  type CreateOpsOperatorTaskInput,
  type OpsContactSummary,
  type OpsOperatorTask,
  type OpsTaskPriority,
  type OpsTaskStatus,
  type OpsTaskType,
  type UpdateOpsOperatorTaskInput,
} from './types';

type OpsOperatorTaskRow = {
  id: string;
  task_type: OpsTaskType;
  task_status: OpsTaskStatus;
  priority: OpsTaskPriority;
  source: CreateOpsOperatorTaskInput['source'];
  title: string;
  description: string | null;
  object_id: string | null;
  contact_id: string | null;
  guest_name: string | null;
  owner_name: string | null;
  object_label: string | null;
  last_event_text: string | null;
  last_event_at: string | null;
  dedup_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

const PRIORITY_RANK: Record<OpsTaskPriority, number> = {
  normal: 0,
  urgent: 1,
  critical: 2,
};

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: OpsOperatorTaskRow): OpsOperatorTask {
  return {
    id: row.id,
    taskType: row.task_type,
    taskStatus: row.task_status,
    priority: row.priority,
    source: row.source,
    title: row.title,
    description: row.description,
    objectId: row.object_id,
    contactId: row.contact_id,
    guestName: row.guest_name,
    ownerName: row.owner_name,
    objectLabel: row.object_label,
    lastEventText: row.last_event_text,
    lastEventAt: row.last_event_at,
    dedupKey: row.dedup_key,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

export function buildOpsDedupKey(input: {
  taskType: OpsTaskType;
  objectId?: string | null;
  contactId?: string | null;
  dateKey?: string | null;
}): string {
  const scope = input.objectId?.trim() || input.contactId?.trim() || 'unknown';
  const scopeKind = input.objectId?.trim() ? 'object' : 'contact';
  const dateSuffix = input.dateKey?.trim() ? `:${input.dateKey.trim()}` : '';
  return `${input.taskType}:${scopeKind}:${scope}${dateSuffix}`;
}

export function buildAutoOpsDedupKey(input: {
  source: string;
  sourceId: string;
  taskType: OpsTaskType;
  dateKey?: string | null;
}): string {
  const dateSuffix = input.dateKey?.trim() ? `:${input.dateKey.trim()}` : '';
  return `auto:${input.source}:${input.sourceId}:${input.taskType}${dateSuffix}`;
}

export function defaultTitleForTaskType(taskType: OpsTaskType): string {
  return OPS_TASK_TYPE_LABELS[taskType];
}

async function findTaskByDedupKey(dedupKey: string): Promise<OpsOperatorTask | null> {
  const { data, error } = await supabase
    .from('ops_operator_tasks')
    .select('*')
    .eq('dedup_key', dedupKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as OpsOperatorTaskRow);
}

async function findOpenTaskByDedupKey(dedupKey: string): Promise<OpsOperatorTask | null> {
  const task = await findTaskByDedupKey(dedupKey);
  if (!task || !OPS_OPEN_STATUSES.includes(task.taskStatus)) return null;
  return task;
}

export async function createOpsOperatorTask(
  input: CreateOpsOperatorTaskInput,
): Promise<{ ok: boolean; task: OpsOperatorTask | null; created: boolean; error?: string }> {
  const dedupKey =
    input.dedupKey?.trim() ||
    buildOpsDedupKey({
      taskType: input.taskType,
      objectId: input.objectId,
      contactId: input.contactId,
    });

  const existing = await findTaskByDedupKey(dedupKey);
  if (existing) {
    if (!OPS_OPEN_STATUSES.includes(existing.taskStatus)) {
      return { ok: true, task: existing, created: false };
    }

    if (input.updateIfExists) {
      const updates: UpdateOpsOperatorTaskInput = {
        taskStatus: input.updateIfExists.taskStatus ?? existing.taskStatus,
        lastEventText: input.updateIfExists.lastEventText,
      };
      if (
        input.updateIfExists.description !== undefined ||
        input.updateIfExists.metadata !== undefined ||
        input.updateIfExists.taskStatus !== undefined ||
        input.updateIfExists.lastEventText !== undefined
      ) {
        const rowUpdates: Record<string, unknown> = {
          task_status: updates.taskStatus,
          updated_at: nowIso(),
        };
        if (input.updateIfExists.description !== undefined) {
          rowUpdates.description = input.updateIfExists.description;
        }
        if (input.updateIfExists.lastEventText !== undefined) {
          rowUpdates.last_event_text = updates.lastEventText ?? existing.lastEventText;
          rowUpdates.last_event_at = updates.lastEventText ? nowIso() : existing.lastEventAt;
        }
        if (input.updateIfExists.metadata !== undefined) {
          rowUpdates.metadata = input.updateIfExists.metadata;
        }
        const { data, error } = await supabase
          .from('ops_operator_tasks')
          .update(rowUpdates)
          .eq('id', existing.id)
          .select('*')
          .maybeSingle();
        if (error) {
          return { ok: false, task: null, created: false, error: error.message };
        }
        if (data) {
          return { ok: true, task: mapRow(data as OpsOperatorTaskRow), created: false };
        }
      }
    }
    return { ok: true, task: existing, created: false };
  }

  const now = nowIso();
  const row = {
    task_type: input.taskType,
    task_status: input.taskStatus ?? 'new',
    priority: input.priority ?? 'normal',
    source: input.source,
    title: input.title?.trim() || defaultTitleForTaskType(input.taskType),
    description: input.description ?? null,
    object_id: input.objectId?.trim() || null,
    contact_id: input.contactId?.trim() || null,
    guest_name: input.guestName?.trim() || null,
    owner_name: input.ownerName?.trim() || null,
    object_label: input.objectLabel?.trim() || null,
    last_event_text: input.lastEventText?.trim() || null,
    last_event_at: input.lastEventText ? now : null,
    dedup_key: dedupKey,
    metadata: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase.from('ops_operator_tasks').insert(row).select('*').single();
  if (error) {
    return { ok: false, task: null, created: false, error: error.message };
  }

  return { ok: true, task: mapRow(data as OpsOperatorTaskRow), created: true };
}

export type ListOpsOperatorTasksFilter = {
  status?: OpsTaskStatus | 'open' | 'active' | 'done' | 'all';
  urgentOnly?: boolean;
};

export async function listOpsOperatorTasks(
  filter: ListOpsOperatorTasksFilter = {},
): Promise<{ ok: boolean; tasks: OpsOperatorTask[]; error?: string }> {
  let query = supabase.from('ops_operator_tasks').select('*').order('updated_at', { ascending: false });

  if (filter.status === 'open' || filter.status === 'active') {
    query = query.in('task_status', OPS_OPEN_STATUSES) as typeof query;
  } else if (filter.status === 'done') {
    query = query.in('task_status', OPS_DONE_STATUSES) as typeof query;
  } else if (filter.status && filter.status !== 'all') {
    query = query.eq('task_status', filter.status) as typeof query;
  }

  if (filter.urgentOnly) {
    query = query.in('priority', ['urgent', 'critical']) as typeof query;
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, tasks: [], error: error.message };
  }

  return { ok: true, tasks: ((data ?? []) as OpsOperatorTaskRow[]).map(mapRow) };
}

export async function getOpsOperatorTask(
  taskId: string,
): Promise<{ ok: boolean; task: OpsOperatorTask | null; error?: string }> {
  const { data, error } = await supabase
    .from('ops_operator_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();

  if (error) {
    return { ok: false, task: null, error: error.message };
  }
  if (!data) {
    return { ok: false, task: null, error: 'task_not_found' };
  }

  return { ok: true, task: mapRow(data as OpsOperatorTaskRow) };
}

export async function updateOpsOperatorTask(
  taskId: string,
  input: UpdateOpsOperatorTaskInput,
): Promise<{ ok: boolean; task: OpsOperatorTask | null; error?: string }> {
  const now = nowIso();
  const updates: Record<string, unknown> = {
    task_status: input.taskStatus,
    updated_at: now,
  };

  if (input.lastEventText !== undefined) {
    updates.last_event_text = input.lastEventText;
    updates.last_event_at = input.lastEventText ? now : null;
  }

  if (input.taskStatus === 'done' || input.taskStatus === 'closed') {
    updates.closed_at = now;
  } else if (OPS_OPEN_STATUSES.includes(input.taskStatus)) {
    updates.closed_at = null;
  }

  const { data, error } = await supabase
    .from('ops_operator_tasks')
    .update(updates)
    .eq('id', taskId)
    .select('*')
    .maybeSingle();

  if (error) {
    return { ok: false, task: null, error: error.message };
  }
  if (!data) {
    return { ok: false, task: null, error: 'task_not_found' };
  }

  return { ok: true, task: mapRow(data as OpsOperatorTaskRow) };
}

export async function summarizeOpenOpsTasksByContactIds(
  contactIds: string[],
): Promise<Record<string, OpsContactSummary>> {
  const unique = [...new Set(contactIds.map((id) => id.trim()).filter(Boolean))];
  const result: Record<string, OpsContactSummary> = {};
  for (const contactId of unique) {
    result[contactId] = { contactId, openCount: 0, highestPriority: null };
  }
  if (unique.length === 0) return result;

  const { data, error } = await supabase
    .from('ops_operator_tasks')
    .select('contact_id, priority')
    .in('contact_id', unique)
    .in('task_status', OPS_OPEN_STATUSES);

  if (error || !data) return result;

  for (const row of data as Array<{ contact_id: string | null; priority: OpsTaskPriority }>) {
    const contactId = row.contact_id;
    if (!contactId || !result[contactId]) continue;
    result[contactId].openCount += 1;
    const current = result[contactId].highestPriority;
    if (!current || PRIORITY_RANK[row.priority] > PRIORITY_RANK[current]) {
      result[contactId].highestPriority = row.priority;
    }
  }

  return result;
}
