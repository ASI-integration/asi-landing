/**
 * Admin endpoint: inspect reservation readiness and auto-advance eligibility.
 *
 * GET /api/admin/reservation-readiness?property_id=...&reservation_ref=...
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Returns:
 *   200 {
 *     ok: true,
 *     reservation: { id, reservation_ref, property_id, chat_id, check_in, status,
 *                    readiness_blocked, readiness_block_reason, readiness_checked_at,
 *                    pre_checkin_sent_at },
 *     unit_state: UnitState | null,
 *     checkin_gate: CheckinGateResult,
 *     eligible_for_auto_advance: boolean,
 *   }
 *   400 { error: "property_id and reservation_ref are required" }
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "not_found" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getUnitState } from '@/lib/ops/unit-state';
import { evaluateCheckinReadiness } from '@/lib/ops/checkin-gate';

interface ReservationRow {
  id:                    string;
  reservation_ref:       string;
  property_id:           string;
  chat_id:               number | null;
  check_in:              string | null;
  status:                string;
  readiness_blocked:     boolean;
  readiness_block_reason:string | null;
  readiness_checked_at:  string | null;
  pre_checkin_sent_at:   string | null;
}

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const property_id     = searchParams.get('property_id');
  const reservation_ref = searchParams.get('reservation_ref');

  if (!property_id || !property_id.trim() || !reservation_ref || !reservation_ref.trim()) {
    return NextResponse.json(
      { error: 'property_id and reservation_ref are required' },
      { status: 400 },
    );
  }

  // ── Fetch reservation ─────────────────────────────────────────────────────
  const { data, error: resError } = await supabase
    .from('tg_guest_reservations')
    .select(
      'id, reservation_ref, property_id, chat_id, check_in, status, ' +
      'readiness_blocked, readiness_block_reason, readiness_checked_at, pre_checkin_sent_at',
    )
    .eq('reservation_ref', reservation_ref)
    .eq('property_id', property_id)
    .maybeSingle();

  if (resError) {
    return NextResponse.json({ ok: false, error: resError.message }, { status: 500 });
  }
  const row = data as ReservationRow | null;
  if (!row) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  // ── Unit state + gate (parallel) ──────────────────────────────────────────
  const [unitStateResult, checkinGate] = await Promise.all([
    getUnitState(property_id),
    evaluateCheckinReadiness(property_id),
  ]);

  // ── Eligibility: mirrors the runner's WHERE clause ────────────────────────
  // readiness_blocked = false, readiness_checked_at IS NOT NULL,
  // pre_checkin_sent_at IS NULL, status != 'cancelled', check_in >= 48h ago
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const eligible_for_auto_advance =
    row.readiness_blocked === false &&
    row.readiness_checked_at !== null &&
    row.pre_checkin_sent_at === null &&
    row.status !== 'cancelled' &&
    row.check_in !== null &&
    row.check_in >= cutoff;

  return NextResponse.json({
    ok: true,
    reservation: {
      id:                    row.id,
      reservation_ref:       row.reservation_ref,
      property_id:           row.property_id,
      chat_id:               row.chat_id,
      check_in:              row.check_in,
      status:                row.status,
      readiness_blocked:     row.readiness_blocked,
      readiness_block_reason:row.readiness_block_reason,
      readiness_checked_at:  row.readiness_checked_at,
      pre_checkin_sent_at:   row.pre_checkin_sent_at,
    },
    unit_state:               unitStateResult.state ?? null,
    checkin_gate:             checkinGate,
    eligible_for_auto_advance,
  });
}
