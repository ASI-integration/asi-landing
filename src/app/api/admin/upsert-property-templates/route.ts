/**
 * Admin endpoint: create or update guest-facing message templates for a property.
 *
 * POST /api/admin/upsert-property-templates
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     property_id:              string   // REQUIRED
 *     pre_checkin_template?:    string   // message sent before check-in
 *     checkout_template?:       string   // message sent at checkout
 *     followup_template?:       string   // post-stay follow-up message
 *     escalation_contact_text?: string   // contact text appended on escalation
 *   }
 *
 * Behaviour:
 *   - Creates row in tg_property_knowledge if property_id is new.
 *   - Updates template fields on existing row.
 *   - Only provided fields are written; omitted fields are left unchanged.
 *   - Idempotent: safe to call multiple times with the same payload.
 *
 * Returns:
 *   200 { ok: true, property_id, created: boolean }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { supabase }     from '@/lib/supabase';
import { appendTimelineEvent } from '@/lib/communication/timeline';

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

  const {
    property_id,
    pre_checkin_template,
    checkout_template,
    followup_template,
    escalation_contact_text,
  } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!property_id || typeof property_id !== 'string' || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  // ── Check if row exists (for created flag) ────────────────────────────────
  const { data: existing } = await supabase
    .from('tg_property_knowledge')
    .select('property_id')
    .eq('property_id', property_id)
    .maybeSingle();

  const created = !existing;

  // ── Build upsert payload — only include explicitly provided fields ─────────
  const row: Record<string, unknown> = { property_id, updated_at: new Date().toISOString() };

  if (pre_checkin_template    !== undefined) row.pre_checkin_template    = pre_checkin_template;
  if (checkout_template       !== undefined) row.checkout_template       = checkout_template;
  if (followup_template       !== undefined) row.followup_template       = followup_template;
  if (escalation_contact_text !== undefined) row.escalation_contact_text = escalation_contact_text;

  // ── Upsert ────────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from('tg_property_knowledge')
    .upsert(row, { onConflict: 'property_id', ignoreDuplicates: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // ── Timeline audit (best-effort) ──────────────────────────────────────────
  await appendTimelineEvent(
    `property:${property_id}`,
    { type: 'property_templates_upserted', property_id: property_id as string, created, ts: new Date() },
  );

  return NextResponse.json({ ok: true, property_id, created });
}
