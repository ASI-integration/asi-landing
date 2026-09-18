/**
 * Admin endpoint: create or update a property knowledge record.
 *
 * POST /api/admin/upsert-property-knowledge
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     property_id:              string   // REQUIRED — stable identifier
 *     property_name?:           string   // display name shown to guests
 *     location?:                string   // city or location label
 *     check_in_time?:           string   // e.g. "15:00"
 *     check_out_time?:          string   // e.g. "11:00"
 *     wifi_name?:               string   // network SSID
 *     wifi_password?:           string   // network password ("" clears canonical)
 *     check_in_instructions?:   string
 *     check_out_instructions?:  string
 *     house_rules?:             string
 *     property_policy?:         string
 *     emergency_contacts?:      string
 *     parking_instructions?:    string
 *     payment_rules?:           string
 *     upsells?:                 string
 *     active?:                  boolean  // default true
 *   }
 *
 * Behaviour:
 *   - Guest-facing facts: canonical object_knowledge_entries mutation FIRST.
 *   - If canonical fails, legacy guest facts are NOT mutated.
 *   - If canonical succeeds and legacy later fails, canonical remains SSOT.
 *   - Explicit blank/null guest fields write canonical tombstones (value_text null).
 *   - Non-guest metadata (name/location/templates) may still update tg_property_knowledge.
 *   - Idempotent for the same payload.
 *
 * Returns:
 *   200 { ok: true, property_id, created: boolean }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';
import { appendTimelineEvent } from '@/lib/communication/timeline';
import {
  adminPayloadHasGuestFacingFields,
  buildCanonicalGuestFactUpserts,
} from '@/lib/communication/guest-property-knowledge';

export async function POST(req: Request) {
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

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

  if (!property_id || typeof property_id !== 'string' || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('tg_property_knowledge')
    .select('property_id, wifi_name, wifi_password')
    .eq('property_id', property_id)
    .maybeSingle();

  const created = !existing;

  const guestFacingFields: Record<string, unknown> = {};
  if (wifi_name !== undefined) guestFacingFields.wifi_name = wifi_name;
  if (wifi_password !== undefined) guestFacingFields.wifi_password = wifi_password;
  if (check_in_instructions !== undefined) {
    guestFacingFields.check_in_instructions = check_in_instructions;
    guestFacingFields.checkin_instructions = check_in_instructions;
  }
  if (check_out_instructions !== undefined) guestFacingFields.checkout_notes = check_out_instructions;
  if (check_out_time !== undefined) guestFacingFields.check_out_time = check_out_time;
  if (house_rules !== undefined) guestFacingFields.house_rules = house_rules;
  if (parking_instructions !== undefined) guestFacingFields.parking_instructions = parking_instructions;

  const hasGuestFacingMutation = adminPayloadHasGuestFacingFields(guestFacingFields);
  const canonicalRows = buildCanonicalGuestFactUpserts({
    property_id: String(property_id),
    fields: guestFacingFields,
  });

  // P0-02 SSOT write safety: canonical guest facts must commit before legacy.
  if (hasGuestFacingMutation && canonicalRows.length > 0) {
    const { error: okError } = await supabase
      .from('object_knowledge_entries')
      .upsert(canonicalRows, { onConflict: 'object_id,key' });
    if (okError) {
      return NextResponse.json(
        { ok: false, error: `canonical_guest_fact_upsert_failed:${okError.message}` },
        { status: 500 },
      );
    }
  }

  const row: Record<string, unknown> = { property_id, updated_at: new Date().toISOString() };

  if (property_name !== undefined) row.object_name = property_name;
  if (location !== undefined) row.location = location;
  if (check_in_time !== undefined) row.check_in_time = check_in_time;
  if (check_out_time !== undefined) row.check_out_time = check_out_time;
  if (wifi_name !== undefined) row.wifi_name = wifi_name;
  if (wifi_password !== undefined) row.wifi_password = wifi_password;
  if (check_in_instructions !== undefined) row.checkin_instructions = check_in_instructions;
  if (check_out_instructions !== undefined) row.checkout_notes = check_out_instructions;
  if (house_rules !== undefined) row.house_rules = house_rules;
  if (property_policy !== undefined) row.property_policy = property_policy;
  if (emergency_contacts !== undefined) row.emergency_contacts = emergency_contacts;
  if (parking_instructions !== undefined) row.parking_instructions = parking_instructions;
  if (payment_rules !== undefined) row.payment_rules = payment_rules;
  if (upsells !== undefined) row.upsells = upsells;
  if (active !== undefined) row.active = active;

  const existingRow = existing as Record<string, unknown> | null;
  const mergedWifiName = (wifi_name !== undefined ? wifi_name : existingRow?.wifi_name) as string | undefined;
  const mergedWifiPassword = (wifi_password !== undefined ? wifi_password : existingRow?.wifi_password) as
    | string
    | undefined;
  if (mergedWifiName || mergedWifiPassword) {
    row.wifi_instructions = `Network: ${mergedWifiName ?? ''}, Password: ${mergedWifiPassword ?? ''}`;
  }

  const { error } = await supabase
    .from('tg_property_knowledge')
    .upsert(row, { onConflict: 'property_id', ignoreDuplicates: false });

  if (error) {
    // Canonical (if any) already committed and remains authoritative guest truth.
    return NextResponse.json(
      {
        ok: false,
        error: hasGuestFacingMutation
          ? `legacy_tg_property_knowledge_upsert_failed_after_canonical:${error.message}`
          : error.message,
        canonical_guest_facts_committed: hasGuestFacingMutation && canonicalRows.length > 0,
      },
      { status: 500 },
    );
  }

  await appendTimelineEvent(
    `property:${property_id}`,
    { type: 'property_knowledge_upserted', property_id: property_id as string, created, ts: new Date() },
  );

  return NextResponse.json({ ok: true, property_id, created });
}
