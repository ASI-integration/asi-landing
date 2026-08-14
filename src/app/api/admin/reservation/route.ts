/**
 * Admin endpoint: read a guest reservation record.
 *
 * GET /api/admin/reservation?reservation_ref=ABC-123
 * GET /api/admin/reservation?chat_id=920001
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Returns:
 *   200 { ok: true, reservation: { ... } }
 *   400 { error: "Provide reservation_ref or chat_id" }
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "not_found" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { supabase }     from '@/lib/supabase';

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const reservationRef = searchParams.get('reservation_ref');
  const chatIdParam    = searchParams.get('chat_id');

  if (!reservationRef && !chatIdParam) {
    return NextResponse.json({ error: 'Provide reservation_ref or chat_id' }, { status: 400 });
  }

  let query = supabase.from('tg_guest_reservations').select('*');

  if (reservationRef) {
    query = query.eq('reservation_ref', reservationRef) as typeof query;
  } else {
    query = query.eq('chat_id', Number(chatIdParam)) as typeof query;
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, reservation: data });
}
