/**
 * Admin endpoint: read unit operational state.
 *
 * GET /api/admin/unit-state?property_id=...
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Returns:
 *   200 { ok: true, state: UnitState | null }
 *   400 { error: "property_id is required" }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { getUnitState } from '@/lib/ops/unit-state';

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const property_id = searchParams.get('property_id');

  if (!property_id || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  const result = await getUnitState(property_id);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, state: result.state });
}
