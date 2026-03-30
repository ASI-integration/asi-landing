/**
 * /api/operator/leads
 *
 * Operator lead review API — backed by ops_tasks.
 * Protected: requires an active iron-session (logged-in user).
 *
 * GET  /api/operator/leads
 *   Returns all guest_issue and escalated ops_tasks in newest-first order.
 *   Query params: status=open|in_progress|resolved|canceled  (optional)
 *
 * PATCH /api/operator/leads
 *   Body: { task_id, task_status?, operator_note?, follow_up_at? }
 *   Updates the task and returns the updated row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { OpsTaskStatus } from '@/lib/ops/tasks';

export const dynamic = 'force-dynamic';

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireSession() {
  const session = await getSession();
  if (!session.userId) return null;
  return session;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status');

  // Validate status filter
  const validStatuses = Object.values(OpsTaskStatus) as string[];
  if (statusFilter && !validStatuses.includes(statusFilter)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
      { status: 400 },
    );
  }

  // Fetch guest_issue tasks (primary lead type) ordered newest-first
  let query = supabase
    .from('ops_tasks')
    .select('*')
    .in('task_type', ['guest_issue', 'checkin_ready'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (statusFilter) {
    query = query.eq('task_status', statusFilter) as typeof query;
  }

  const { data, error } = await query;

  if (error) {
    console.error(`[operator/leads] GET error: ${error.message}`);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, leads: data ?? [] });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { task_id, task_status, operator_note, follow_up_at } = body;

  if (typeof task_id !== 'string' || !task_id) {
    return NextResponse.json({ error: 'task_id required' }, { status: 400 });
  }

  const validStatuses = Object.values(OpsTaskStatus) as string[];
  if (task_status !== undefined && !validStatuses.includes(task_status as string)) {
    return NextResponse.json(
      { error: `Invalid task_status. Must be one of: ${validStatuses.join(', ')}` },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (task_status !== undefined)  updates.task_status  = task_status;
  if (operator_note !== undefined) updates.operator_note = operator_note;
  if (follow_up_at !== undefined)  updates.follow_up_at  = follow_up_at;

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
    console.error(`[operator/leads] PATCH error task_id=${task_id}: ${error.message}`);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
  }

  console.log(`[operator/leads] PATCH task_id=${task_id} status=${task_status ?? 'unchanged'} by user=${session.userId}`);

  return NextResponse.json({ ok: true, lead: data });
}
