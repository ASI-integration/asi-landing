/**
 * Minimum ops task layer.
 *
 * Provides idempotent task creation keyed by `dedup_key`, and simple read/update
 * helpers that admin routes can call.  All Supabase writes are synchronous (await)
 * so callers can choose to fire-and-forget or await as needed.
 */

import { supabase } from '@/lib/supabase';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const OpsTaskType = {
  PreArrivalPrep: 'pre_arrival_prep',
  CheckinReady:   'checkin_ready',
  GuestIssue:     'guest_issue',
  Checkout:       'checkout',
  Turnover:       'turnover',
} as const;
export type OpsTaskType = (typeof OpsTaskType)[keyof typeof OpsTaskType];

export const OpsTaskStatus = {
  Open:       'open',
  InProgress: 'in_progress',
  Resolved:   'resolved',
  Canceled:   'canceled',
} as const;
export type OpsTaskStatus = (typeof OpsTaskStatus)[keyof typeof OpsTaskStatus];

export const OpsTaskPriority = {
  Emergency:     'emergency',
  Urgent:        'urgent',
  Normal:        'normal',
  Informational: 'informational',
} as const;
export type OpsTaskPriority = (typeof OpsTaskPriority)[keyof typeof OpsTaskPriority];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpsTask {
  id:             string;
  property_id:    string;
  reservation_id: string | null;
  chat_id:        number | null;
  task_type:      OpsTaskType;
  task_status:    OpsTaskStatus;
  title:          string;
  description:    string | null;
  due_at:         string | null;
  priority:       OpsTaskPriority;
  assigned_to:    string | null;
  source_event:   string | null;
  trigger_reason: string | null;
  operator_note:  string | null;
  dedup_key:      string | null;
  created_at:     string;
  updated_at:     string;
  resolved_at:    string | null;
}

export interface CreateOpsTaskParams {
  property_id:     string;
  reservation_id?: string | null;
  chat_id?:        number | null;
  task_type:       OpsTaskType;
  title:           string;
  description?:    string | null;
  due_at?:         string | null;
  priority?:       OpsTaskPriority;
  assigned_to?:    string | null;
  source_event?:   string | null;
  trigger_reason?: string | null;
  /** Explicit dedup key. Falls back to "{task_type}:{reservation_id}" if not provided. */
  dedup_key?:      string;
}

export interface UpdateOpsTaskParams {
  task_id:        string;
  task_status?:   OpsTaskStatus;
  assigned_to?:   string | null;
  operator_note?: string | null;
}

export interface GetOpsTasksFilter {
  property_id?:    string;
  reservation_id?: string;
  task_status?:    OpsTaskStatus;
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create an ops task.  Idempotent: if a row with the same dedup_key already
 * exists, the insert is silently ignored and `{ created: false }` is returned.
 *
 * Default dedup_key: "{task_type}:{reservation_id}" (or "{task_type}:no_res:{chat_id}"
 * when no reservation_id is available).
 */
export async function createOpsTask(
  params: CreateOpsTaskParams,
): Promise<{ ok: boolean; task_id: string | null; created: boolean; error?: string }> {
  const {
    property_id,
    reservation_id = null,
    chat_id = null,
    task_type,
    title,
    description = null,
    due_at = null,
    priority = OpsTaskPriority.Normal,
    assigned_to = null,
    source_event = null,
    trigger_reason = null,
  } = params;

  const dedup_key =
    params.dedup_key ??
    (reservation_id
      ? `${task_type}:${reservation_id}`
      : `${task_type}:no_res:${chat_id ?? 'unknown'}`);

  const now = new Date().toISOString();

  const row = {
    property_id,
    reservation_id,
    chat_id,
    task_type,
    task_status: OpsTaskStatus.Open,
    title,
    description,
    due_at,
    priority,
    assigned_to,
    source_event,
    trigger_reason,
    dedup_key,
    created_at: now,
    updated_at: now,
  };

  // Use upsert with ignoreDuplicates so retries never throw — they just skip.
  const { data, error } = await supabase
    .from('ops_tasks')
    .upsert(row, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, task_id: null, created: false, error: error.message };
  }

  // If data is null, a row with this dedup_key already existed — not created.
  if (!data) {
    return { ok: true, task_id: null, created: false };
  }

  return { ok: true, task_id: (data as { id: string }).id, created: true };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getOpsTasks(
  filter: GetOpsTasksFilter,
): Promise<{ ok: boolean; tasks: OpsTask[]; error?: string }> {
  let query = supabase.from('ops_tasks').select('*').order('created_at', { ascending: false });

  if (filter.property_id) {
    query = query.eq('property_id', filter.property_id) as typeof query;
  }
  if (filter.reservation_id) {
    query = query.eq('reservation_id', filter.reservation_id) as typeof query;
  }
  if (filter.task_status) {
    query = query.eq('task_status', filter.task_status) as typeof query;
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, tasks: [], error: error.message };
  }

  return { ok: true, tasks: (data ?? []) as OpsTask[] };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateOpsTask(
  params: UpdateOpsTaskParams,
): Promise<{ ok: boolean; task: OpsTask | null; error?: string }> {
  const { task_id, task_status, assigned_to, operator_note } = params;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (task_status !== undefined) updates.task_status = task_status;
  if (assigned_to !== undefined) updates.assigned_to = assigned_to;
  if (operator_note !== undefined) updates.operator_note = operator_note;

  if (task_status === OpsTaskStatus.Resolved) {
    updates.resolved_at = now;
  }

  const { data, error } = await supabase
    .from('ops_tasks')
    .update(updates)
    .eq('id', task_id)
    .select('*')
    .maybeSingle();

  if (error) {
    return { ok: false, task: null, error: error.message };
  }
  if (!data) {
    return { ok: false, task: null, error: 'task_not_found' };
  }

  return { ok: true, task: data as OpsTask };
}
