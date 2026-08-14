/**
 * Admin endpoint: read guest-facing message templates for a property.
 *
 * GET /api/admin/property-templates?property_id=...
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Returns:
 *   200 { ok: true, property_id, templates: { ... } }
 *   400 { error: "property_id query param is required" }
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
  const propertyId = searchParams.get('property_id');

  if (!propertyId) {
    return NextResponse.json({ error: 'property_id query param is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tg_property_knowledge')
    .select('property_id, pre_checkin_template, checkout_template, followup_template, escalation_contact_text')
    .eq('property_id', propertyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const row = data as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    property_id: row.property_id,
    templates: {
      pre_checkin_template:    row.pre_checkin_template    ?? null,
      checkout_template:       row.checkout_template       ?? null,
      followup_template:       row.followup_template       ?? null,
      escalation_contact_text: row.escalation_contact_text ?? null,
    },
  });
}
