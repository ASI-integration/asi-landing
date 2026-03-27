/**
 * Admin endpoint: create or update a property knowledge record.
 *
 * POST /api/admin/upsert-property-knowledge
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     property_id:              string   // REQUIRED — stable identifier e.g. "prop_A"
 *     property_name?:           string   // display name shown to guests
 *     location?:                string   // city or location label
 *     check_in_time?:           string   // e.g. "15:00"
 *     check_out_time?:          string   // e.g. "11:00"
 *     wifi_name?:               string   // network SSID
 *     wifi_password?:           string   // network password
 *     check_in_instructions?:   string
 *     check_out_instructions?:  string
 *     house_rules?:             string
 *     property_policy?:         string
 *     emergency_contacts?:      string   // support_contact_text
 *     parking_instructions?:    string
 *     payment_rules?:           string
 *     upsells?:                 string
 *     active?:                  boolean  // default true
 *   }
 *
 * Behaviour:
 *   - Creates row if property_id is new.
 *   - Updates existing row if property_id already exists.
 *   - When wifi_name + wifi_password are both supplied, wifi_instructions is
 *     auto-composed so getGroundedKnowledge() continues working unchanged.
 *   - Idempotent: safe to call multiple times with the same payload.
 *
 * Returns:
 *   200 { ok: true, property_id, created: boolean }
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
    property_id,
    property_name,
    location,
    check_in_time,
    check_out_time,
    wifi_name,
    wifi_password,
    check_in_instructions,
    check_out_instructions,
    house_rules,
    property_policy,
    emergency_contacts,
    parking_instructions,
    payment_rules,
    upsells,
    active,
  } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!property_id || typeof property_id !== 'string' || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  // ── Check if row exists (for created flag) ────────────────────────────────
  const { data: existing } = await supabase
    .from('tg_property_knowledge')
    .select('property_id, wifi_name, wifi_password')
    .eq('property_id', property_id)
    .maybeSingle();

  const created = !existing;

  // ── Build upsert payload — only include explicitly provided fields ─────────
  const row: Record<string, unknown> = { property_id, updated_at: new Date().toISOString() };

  if (property_name          !== undefined) row.object_name             = property_name;
  if (location               !== undefined) row.location                = location;
  if (check_in_time          !== undefined) row.check_in_time           = check_in_time;
  if (check_out_time         !== undefined) row.check_out_time          = check_out_time;
  if (wifi_name              !== undefined) row.wifi_name               = wifi_name;
  if (wifi_password          !== undefined) row.wifi_password           = wifi_password;
  if (check_in_instructions  !== undefined) row.check_in_instructions   = check_in_instructions;
  if (check_out_instructions !== undefined) row.check_out_instructions  = check_out_instructions;
  if (house_rules            !== undefined) row.house_rules             = house_rules;
  if (property_policy        !== undefined) row.property_policy         = property_policy;
  if (emergency_contacts     !== undefined) row.emergency_contacts      = emergency_contacts;
  if (parking_instructions   !== undefined) row.parking_instructions    = parking_instructions;
  if (payment_rules          !== undefined) row.payment_rules           = payment_rules;
  if (upsells                !== undefined) row.upsells                 = upsells;
  if (active                 !== undefined) row.active                  = active;

  // Auto-compose wifi_instructions so getGroundedKnowledge() keeps working.
  // Merge incoming values with whatever is already stored.
  const existingRow = existing as Record<string, unknown> | null;
  const mergedWifiName     = (wifi_name     !== undefined ? wifi_name     : existingRow?.wifi_name)     as string | undefined;
  const mergedWifiPassword = (wifi_password !== undefined ? wifi_password : existingRow?.wifi_password) as string | undefined;
  if (mergedWifiName || mergedWifiPassword) {
    row.wifi_instructions = `Network: ${mergedWifiName ?? ''}, Password: ${mergedWifiPassword ?? ''}`;
  }

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
    { type: 'property_knowledge_upserted', property_id: property_id as string, created, ts: new Date() },
  );

  return NextResponse.json({ ok: true, property_id, created });
}
