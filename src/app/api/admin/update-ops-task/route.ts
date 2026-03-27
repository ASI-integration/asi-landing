/**
 * Admin endpoint: update an ops task.
 *
 * POST /api/admin/update-ops-task
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     task_id:        string   // REQUIRED
 *     task_status?:   "open" | "in_progress" | "resolved" | "canceled"
 *     assigned_to?:   string | null
 *     operator_note?: string | null
 *   }
 *
 * Side-effects:
 *   - When resolving a "checkout" task → auto-creates a "turnover" task
 *     for the same reservation (idempotent via dedup_key).
 *   - Unit state is advanced on checkout/turnover task transitions.
 *   - Timeline events are appended for every update.
 *
 * Returns:
 *   200 { ok: true, task: OpsTask, turnover_created?: boolean, unit_state?: string }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "task_not_found" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import {
  updateOpsTask,
  createOpsTask,
  OpsTaskType,
  OpsTaskStatus,
  OpsTaskPriority,
} from '@/lib/ops/tasks';
import { appendTimelineEvent } from '@/lib/communication/timeline';
import {
  getUnitState,
  markUnitCheckoutDue,
  markUnitTurnoverNeeded,
  markUnitInTurnover,
  markUnitReadyAfterTurnover,
} from '@/lib/ops/unit-state';

const VALID_STATUSES = new Set<string>(Object.values(OpsTaskStatus));

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { task_id, task_status, assigned_to, operator_note } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!task_id || typeof task_id !== 'string' || !task_id.trim()) {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 });
  }

  if (task_status !== undefined) {
    if (typeof task_status !== 'string' || !VALID_STATUSES.has(task_status)) {
      return NextResponse.json(
        { error: `Invalid task_status. Must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────
  const result = await updateOpsTask({
    task_id: task_id as string,
    task_status: task_status as OpsTaskStatus | undefined,
    assigned_to: assigned_to !== undefined ? (assigned_to as string | null) : undefined,
    operator_note: operator_note !== undefined ? (operator_note as string | null) : undefined,
  });

  if (!result.ok) {
    const status = result.error === 'task_not_found' ? 404 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  const task = result.task!;

  // ── Timeline ──────────────────────────────────────────────────────────────
  const guestId = task.chat_id ? `tg_${task.chat_id}` : `prop_${task.property_id}`;
  const isResolved   = task_status === OpsTaskStatus.Resolved;
  const isInProgress = task_status === OpsTaskStatus.InProgress;

  appendTimelineEvent(
    guestId,
    isResolved
      ? { type: 'ops_task_resolved', task_id: task.id, task_type: task.task_type, ts: new Date() }
      : { type: 'ops_task_updated', task_id: task.id, task_status: task.task_status, ts: new Date() },
  ).catch(() => {});

  // ── Unit state transitions ─────────────────────────────────────────────────
  let unit_state: string | undefined;

  if (task.task_type === OpsTaskType.Checkout) {
    if (isInProgress) {
      // checkout task → in_progress: unit becomes checkout_due
      const us = await markUnitCheckoutDue(task.property_id, task.reservation_id);
      if (us.ok && us.state) {
        unit_state = us.state.current_state;
        const prev = await getUnitState(task.property_id);
        const fromState = prev.state?.current_state ?? 'unknown';
        appendTimelineEvent(`prop_${task.property_id}`, {
          type: 'unit_state_changed',
          property_id: task.property_id,
          from_state: fromState,
          to_state: us.state.current_state,
          ts: new Date(),
        }).catch(() => {});
      }
    } else if (isResolved) {
      // checkout task resolved: unit → turnover_needed, dirty = true
      const us = await markUnitTurnoverNeeded(task.property_id, task.reservation_id);
      if (us.ok && us.state) {
        unit_state = us.state.current_state;
        appendTimelineEvent(`prop_${task.property_id}`, {
          type: 'unit_state_changed',
          property_id: task.property_id,
          from_state: 'checkout_due',
          to_state: us.state.current_state,
          ts: new Date(),
        }).catch(() => {});
      }
    }
  }

  if (task.task_type === OpsTaskType.Turnover) {
    if (isInProgress) {
      // turnover task → in_progress: unit → in_turnover
      const us = await markUnitInTurnover(task.property_id, task.reservation_id);
      if (us.ok && us.state) {
        unit_state = us.state.current_state;
        appendTimelineEvent(`prop_${task.property_id}`, {
          type: 'unit_state_changed',
          property_id: task.property_id,
          from_state: 'turnover_needed',
          to_state: us.state.current_state,
          ts: new Date(),
        }).catch(() => {});
      }
    } else if (isResolved) {
      // turnover task resolved: check gates → ready or blocked
      appendTimelineEvent(`prop_${task.property_id}`, {
        type: 'turnover_completed',
        property_id: task.property_id,
        reservation_id: task.reservation_id,
        ts: new Date(),
      }).catch(() => {});

      const us = await markUnitReadyAfterTurnover(task.property_id, task.reservation_id);
      if (us.ok && us.state) {
        unit_state = us.state.current_state;
        if (us.gate_blocked) {
          appendTimelineEvent(`prop_${task.property_id}`, {
            type: 'unit_blocked',
            property_id: task.property_id,
            blocked_reason: us.state.blocked_reason ?? 'gate_failed',
            ts: new Date(),
          }).catch(() => {});
        } else {
          appendTimelineEvent(`prop_${task.property_id}`, {
            type: 'unit_ready',
            property_id: task.property_id,
            reservation_id: task.reservation_id,
            ts: new Date(),
          }).catch(() => {});
        }
      }
    }
  }

  // ── Auto-create turnover when checkout is resolved ────────────────────────
  let turnover_created = false;

  if (isResolved && task.task_type === OpsTaskType.Checkout && task.reservation_id) {
    const turnoverResult = await createOpsTask({
      property_id:    task.property_id,
      reservation_id: task.reservation_id,
      chat_id:        task.chat_id,
      task_type:      OpsTaskType.Turnover,
      title:          'Post-checkout turnover',
      description:    'Clean and prepare property after guest checkout.',
      priority:       OpsTaskPriority.Normal,
      source_event:   'checkout_resolved',
      trigger_reason: 'checkout_task_resolved',
      due_at:         new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });

    turnover_created = turnoverResult.created;

    if (turnoverResult.created) {
      appendTimelineEvent(
        guestId,
        { type: 'ops_task_created', task_type: OpsTaskType.Turnover, task_id: turnoverResult.task_id, ts: new Date() },
      ).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    task,
    ...(isResolved && task.task_type === OpsTaskType.Checkout ? { turnover_created } : {}),
    ...(unit_state !== undefined ? { unit_state } : {}),
  });
}
