/**
 * Admin endpoint: create or update a guest reservation.
 *
 * POST /api/admin/upsert-reservation
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     reservation_ref:  string   // REQUIRED — external booking reference
 *     property_id:      string   // REQUIRED — which property
 *     chat_id:          number   // REQUIRED — Telegram chat ID for guest linkage
 *     guest_name?:      string
 *     guest_count?:     number
 *     check_in?:        string   // YYYY-MM-DD
 *     check_out?:       string   // YYYY-MM-DD
 *     status?:          string   // default "confirmed"
 *     phone?:           string
 *     email?:           string
 *     note?:            string
 *   }
 *
 * Behaviour:
 *   - Creates row if reservation_ref is new.
 *   - Updates existing row if reservation_ref already exists.
 *   - Sets guest_id = "tg_{chat_id}" for Telegram identity linkage.
 *   - Idempotent: safe to call multiple times with the same payload.
 *
 * Returns:
 *   200 { ok: true, reservation_id, reservation_ref, created: boolean }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { supabase }     from '@/lib/supabase';
import { appendTimelineEvent } from '@/lib/communication/timeline';
import { createOpsTask, OpsTaskType, OpsTaskPriority } from '@/lib/ops/tasks';
import { markUnitOccupied } from '@/lib/ops/unit-state';

/** Reservation statuses that mean the guest is actively staying. */
const ACTIVE_STAY_STATUSES = new Set(['in_stay', 'confirmed', 'active']);

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

  const {
    reservation_ref,
    property_id,
    chat_id,
    guest_name,
    guest_count,
    check_in,
    check_out,
    status,
    phone,
    email,
    note,
  } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!reservation_ref || typeof reservation_ref !== 'string' || !reservation_ref.trim()) {
    return NextResponse.json({ error: 'reservation_ref is required' }, { status: 400 });
  }
  if (!property_id || typeof property_id !== 'string' || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }
  if (chat_id == null || isNaN(Number(chat_id))) {
    return NextResponse.json({ error: 'chat_id is required and must be a number' }, { status: 400 });
  }

  const chatIdNum = Number(chat_id);

  // ── Check if row exists (for created flag) ────────────────────────────────
  const { data: existing } = await supabase
    .from('tg_guest_reservations')
    .select('id')
    .eq('reservation_ref', reservation_ref)
    .maybeSingle();

  const created = !existing;

  // ── Build upsert payload ──────────────────────────────────────────────────
  const row: Record<string, unknown> = {
    reservation_ref,
    property_id,
    chat_id:    chatIdNum,
    guest_id:   `tg_${chatIdNum}`,
    updated_at: new Date().toISOString(),
  };

  if (guest_name  !== undefined) row.guest_name  = guest_name;
  if (guest_count !== undefined) row.guest_count = Number(guest_count);
  if (check_in    !== undefined) row.check_in    = check_in;
  if (check_out   !== undefined) row.check_out   = check_out;
  if (status      !== undefined) row.status      = status;
  if (phone       !== undefined) row.phone       = phone;
  if (email       !== undefined) row.email       = email;
  if (note        !== undefined) row.note        = note;

  // Default status to 'confirmed' on create
  if (created && row.status === undefined) {
    row.status = 'confirmed';
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .upsert(row, { onConflict: 'reservation_ref', ignoreDuplicates: false })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const reservationId = (data as { id: string }).id;

  // ── Timeline audit (best-effort) ──────────────────────────────────────────
  await appendTimelineEvent(
    `tg_${chatIdNum}`,
    { type: 'reservation_upserted', reservation_ref: reservation_ref as string, created, ts: new Date() },
  );

  // ── Auto-create ops tasks on new reservation linkage ──────────────────────
  // Idempotent: dedup_key prevents duplicates on retries.
  if (created) {
    const taskBase = {
      property_id:    property_id as string,
      reservation_id: reservationId,
      chat_id:        chatIdNum,
      priority:       OpsTaskPriority.Normal,
      source_event:   'reservation_linked',
    };

    const checkInDate = typeof check_in === 'string' ? check_in : null;
    const checkOutDate = typeof check_out === 'string' ? check_out : null;

    await Promise.allSettled([
      createOpsTask({
        ...taskBase,
        task_type:      OpsTaskType.PreArrivalPrep,
        title:          'Pre-arrival preparation',
        description:    `Prepare property for guest arrival${checkInDate ? ` on ${checkInDate}` : ''}.`,
        due_at:         checkInDate ? new Date(new Date(checkInDate).getTime() - 24 * 60 * 60 * 1000).toISOString() : null,
        trigger_reason: 'reservation_created',
      }),
      createOpsTask({
        ...taskBase,
        task_type:      OpsTaskType.CheckinReady,
        title:          'Check-in readiness',
        description:    `Confirm property is ready for guest check-in${checkInDate ? ` on ${checkInDate}` : ''}.`,
        due_at:         checkInDate ? new Date(checkInDate).toISOString() : null,
        trigger_reason: 'reservation_created',
      }),
    ]);

    // Timeline: ops tasks created (fire-and-forget)
    appendTimelineEvent(`tg_${chatIdNum}`, { type: 'ops_task_created', task_type: OpsTaskType.PreArrivalPrep, task_id: null, ts: new Date() }).catch(() => {});
    appendTimelineEvent(`tg_${chatIdNum}`, { type: 'ops_task_created', task_type: OpsTaskType.CheckinReady, task_id: null, ts: new Date() }).catch(() => {});

    // Checkout + turnover tasks (only when check_out is known)
    if (checkOutDate) {
      await Promise.allSettled([
        createOpsTask({
          ...taskBase,
          task_type:      OpsTaskType.Checkout,
          title:          'Guest checkout',
          description:    `Guest checkout on ${checkOutDate}.`,
          due_at:         new Date(checkOutDate).toISOString(),
          trigger_reason: 'reservation_created',
        }),
        createOpsTask({
          ...taskBase,
          task_type:      OpsTaskType.Turnover,
          title:          'Post-checkout turnover',
          description:    `Clean and prepare property after checkout on ${checkOutDate}.`,
          due_at:         new Date(new Date(checkOutDate).getTime() + 2 * 60 * 60 * 1000).toISOString(),
          trigger_reason: 'reservation_created',
        }),
      ]);
    }
  }

  // ── Unit state: mark occupied when reservation is active ──────────────────
  // Applies on both create and update so re-sending the same reservation
  // with status=in_stay correctly advances the unit state.
  const effectiveStatus = typeof status === 'string' ? status : (created ? 'confirmed' : undefined);
  if (effectiveStatus && ACTIVE_STAY_STATUSES.has(effectiveStatus)) {
    markUnitOccupied(property_id as string, reservationId).catch(() => {});
  }

  return NextResponse.json({ ok: true, reservation_id: reservationId, reservation_ref, created });
}
