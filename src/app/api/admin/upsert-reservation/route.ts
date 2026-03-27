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

  return NextResponse.json({ ok: true, reservation_id: reservationId, reservation_ref, created });
}
