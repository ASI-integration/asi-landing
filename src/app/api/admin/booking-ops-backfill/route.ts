/**
 * Admin endpoint: backfill booking_ops_records from tg_guest_reservations.
 *
 * POST /api/admin/booking-ops-backfill
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     dry_run?: boolean   // default false
 *     limit?: number      // default 500
 *   }
 */

import { NextResponse } from 'next/server';
import { backfillBookingOpsFromReservations } from '@/lib/booking-ops/reservation-sync';

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  const dryRun = body.dry_run === true || body.dryRun === true;
  const limitRaw = body.limit;
  const limit = typeof limitRaw === 'number' && limitRaw > 0 ? Math.min(limitRaw, 2000) : undefined;

  const summary = await backfillBookingOpsFromReservations({ dryRun, limit });

  return NextResponse.json({
    ok: summary.ok,
    dry_run: summary.dryRun,
    scanned: summary.scanned,
    created: summary.created,
    updated: summary.updated,
    already_exists: summary.alreadyExists,
    skipped: summary.skipped,
    failed: summary.failed,
    error: summary.error ?? null,
    results: summary.results.map((result) => ({
      outcome: result.outcome,
      booking_id: result.bookingId,
      record_id: result.recordId ?? null,
      reason: result.reason ?? null,
      error: result.error ?? null,
    })),
  });
}
