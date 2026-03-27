/**
 * Admin endpoint: read a property knowledge record.
 *
 * GET /api/admin/property-knowledge?property_id=prop_A
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Returns:
 *   200 { ok: true, property: { ... } }
 *   400 { error: "property_id query param is required" }
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "not_found" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { supabase }     from '@/lib/supabase';

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get('property_id');

  if (!propertyId) {
    return NextResponse.json({ error: 'property_id query param is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tg_property_knowledge')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, property: data });
}
