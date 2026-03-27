/**
 * Admin endpoint: recover missing stay-flow ops tasks for a reservation.
 *
 * POST /api/admin/recover-stay-flow
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     reservation_id: string   // REQUIRED — internal reservation UUID
 *   }
 *
 * Behaviour:
 *   - Reads the reservation record.
 *   - Checks which of the standard stay-flow tasks exist.
 *   - Creates any missing tasks (pre_arrival_prep, checkin_ready, checkout, turnover).
 *   - Idempotent: uses dedup_key so existing tasks are never duplicated.
 *
 * Returns:
 *   200 { ok: true, reservation_id, created: string[], skipped: string[] }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "reservation_not_found" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { supabase }     from '@/lib/supabase';
import { createOpsTask, getOpsTasks, OpsTaskType, OpsTaskPriority } from '@/lib/ops/tasks';

const STANDARD_TASKS: OpsTaskType[] = [
  OpsTaskType.PreArrivalPrep,
  OpsTaskType.CheckinReady,
  OpsTaskType.Checkout,
  OpsTaskType.Turnover,
];

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

  const { reservation_id } = body;

  if (!reservation_id || typeof reservation_id !== 'string' || !reservation_id.trim()) {
    return NextResponse.json({ error: 'reservation_id is required' }, { status: 400 });
  }

  // ── Load reservation ──────────────────────────────────────────────────────
  const { data: res, error: resErr } = await supabase
    .from('tg_guest_reservations')
    .select('id, property_id, chat_id, check_in, check_out')
    .eq('id', reservation_id)
    .maybeSingle();

  if (resErr) {
    return NextResponse.json({ ok: false, error: resErr.message }, { status: 500 });
  }
  if (!res) {
    return NextResponse.json({ ok: false, error: 'reservation_not_found' }, { status: 404 });
  }

  const row = res as {
    id: string;
    property_id: string;
    chat_id: number | null;
    check_in: string | null;
    check_out: string | null;
  };

  // ── Load existing tasks ───────────────────────────────────────────────────
  const existing = await getOpsTasks({ reservation_id });
  if (!existing.ok) {
    return NextResponse.json({ ok: false, error: existing.error }, { status: 500 });
  }

  const existingTypes = new Set(existing.tasks.map(t => t.task_type));

  // ── Create missing tasks ──────────────────────────────────────────────────
  const created: string[] = [];
  const skipped: string[] = [];

  const base = {
    property_id:    row.property_id,
    reservation_id: row.id,
    chat_id:        row.chat_id,
    priority:       OpsTaskPriority.Normal,
    source_event:   'recover_stay_flow',
  };

  const checkIn  = row.check_in;
  const checkOut = row.check_out;

  const taskDefs: { type: OpsTaskType; title: string; description: string; due_at: string | null }[] = [
    {
      type:        OpsTaskType.PreArrivalPrep,
      title:       'Pre-arrival preparation',
      description: `Prepare property for guest arrival${checkIn ? ` on ${checkIn}` : ''}.`,
      due_at:      checkIn ? new Date(new Date(checkIn).getTime() - 24 * 60 * 60 * 1000).toISOString() : null,
    },
    {
      type:        OpsTaskType.CheckinReady,
      title:       'Check-in readiness',
      description: `Confirm property is ready for guest check-in${checkIn ? ` on ${checkIn}` : ''}.`,
      due_at:      checkIn ? new Date(checkIn).toISOString() : null,
    },
    {
      type:        OpsTaskType.Checkout,
      title:       'Guest checkout',
      description: `Guest checkout${checkOut ? ` on ${checkOut}` : ''}.`,
      due_at:      checkOut ? new Date(checkOut).toISOString() : null,
    },
    {
      type:        OpsTaskType.Turnover,
      title:       'Post-checkout turnover',
      description: `Clean and prepare property after checkout${checkOut ? ` on ${checkOut}` : ''}.`,
      due_at:      checkOut ? new Date(new Date(checkOut).getTime() + 2 * 60 * 60 * 1000).toISOString() : null,
    },
  ];

  for (const def of taskDefs) {
    if (existingTypes.has(def.type) && STANDARD_TASKS.includes(def.type)) {
      skipped.push(def.type);
      continue;
    }
    const result = await createOpsTask({
      ...base,
      task_type:      def.type,
      title:          def.title,
      description:    def.description,
      due_at:         def.due_at,
      trigger_reason: 'manual_recovery',
    });
    if (result.created) {
      created.push(def.type);
    } else {
      skipped.push(def.type);
    }
  }

  return NextResponse.json({ ok: true, reservation_id, created, skipped });
}
