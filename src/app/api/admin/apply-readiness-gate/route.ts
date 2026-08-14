/**
 * Admin endpoint: apply the readiness gate to a reservation.
 *
 * Evaluates `evaluateCheckinReadiness` for the property and writes the
 * result into the reservation's readiness fields, exactly as the
 * communication orchestrator would — enabling the stay-flow runner to
 * pick up the reservation on the next pass if the unit is ready.
 *
 * POST /api/admin/apply-readiness-gate
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   { property_id: string, reservation_ref: string }
 *
 * Returns:
 *   200 {
 *     ok: true,
 *     reservation_id: string,
 *     gate: CheckinGateResult,
 *     readiness_blocked: boolean,
 *     readiness_checked_at: string,
 *     eligible_for_auto_advance: boolean,
 *   }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "not_found" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';
import { evaluateCheckinReadiness } from '@/lib/ops/checkin-gate';

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { property_id, reservation_ref } = body;

  if (!property_id || typeof property_id !== 'string' || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }
  if (!reservation_ref || typeof reservation_ref !== 'string' || !reservation_ref.trim()) {
    return NextResponse.json({ error: 'reservation_ref is required' }, { status: 400 });
  }

  // ── Fetch reservation ─────────────────────────────────────────────────────
  const { data, error: fetchError } = await supabase
    .from('tg_guest_reservations')
    .select('id, check_in, status, pre_checkin_sent_at')
    .eq('reservation_ref', reservation_ref)
    .eq('property_id', property_id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const row = data as {
    id: string;
    check_in: string | null;
    status: string;
    pre_checkin_sent_at: string | null;
  };

  // ── Evaluate gate ─────────────────────────────────────────────────────────
  const gate = await evaluateCheckinReadiness(property_id);

  const now = gate.checked_at;
  const readiness_blocked      = !gate.allowed;
  const readiness_block_reason = gate.blocked_reason ?? null;

  // ── Write result to reservation ───────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('tg_guest_reservations')
    .update({
      readiness_blocked,
      readiness_block_reason,
      readiness_checked_at: now,
    })
    .eq('id', row.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  // ── Compute eligibility (mirrors runner WHERE clause) ─────────────────────
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const eligible_for_auto_advance =
    !readiness_blocked &&
    row.pre_checkin_sent_at === null &&
    row.status !== 'cancelled' &&
    row.check_in !== null &&
    row.check_in >= cutoff;

  return NextResponse.json({
    ok: true,
    reservation_id:          row.id,
    gate,
    readiness_blocked,
    readiness_checked_at:    now,
    eligible_for_auto_advance,
  });
}
