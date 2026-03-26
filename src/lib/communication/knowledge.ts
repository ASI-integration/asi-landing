/**
 * G3 — Real property knowledge linkage.
 *
 * Replaces the single-property PROPERTY_DB mock with a lookup against the
 * tg_property_knowledge table (see migration 20260326000001).
 *
 * Graceful degradation: if the property is not found or Supabase is
 * unavailable, every field falls back to 'Information unavailable.' so
 * the bot never fabricates data.
 */

import { supabase } from '@/lib/supabase';
import { GroundedKnowledge } from './types';

const UNIVERSAL_POLICY =
  `General Policy: Be helpful, concise, and professional. ` +
  `Never provide information you are not certain of. ` +
  `If information is missing, state 'That information is unavailable right now'. ` +
  `Never fabricate house rules, fees, times, access details, or payment conditions.`;

// ─── Column → field mapping ───────────────────────────────────────────────────
// Supabase returns snake_case column names; GroundedKnowledge uses camelCase.

function rowToKnowledge(row: Record<string, unknown>): Partial<GroundedKnowledge> {
  return {
    propertyPolicy:        row.property_policy        as string | undefined,
    houseRules:            row.house_rules             as string | undefined,
    checkInInstructions:   row.check_in_instructions   as string | undefined,
    checkOutInstructions:  row.check_out_instructions  as string | undefined,
    wifiInstructions:      row.wifi_instructions       as string | undefined,
    parkingInstructions:   row.parking_instructions    as string | undefined,
    paymentRules:          row.payment_rules           as string | undefined,
    emergencyContacts:     row.emergency_contacts      as string | undefined,
    upsells:               row.upsells                 as string | undefined,
  };
}

function withFallbacks(
  base: GroundedKnowledge,
  prop: Partial<GroundedKnowledge>,
): GroundedKnowledge {
  return {
    ...base,
    propertyPolicy:       prop.propertyPolicy       ?? 'Information unavailable.',
    houseRules:           prop.houseRules           ?? 'Information unavailable.',
    checkInInstructions:  prop.checkInInstructions  ?? 'Information unavailable.',
    checkOutInstructions: prop.checkOutInstructions ?? 'Information unavailable.',
    wifiInstructions:     prop.wifiInstructions     ?? 'Information unavailable.',
    parkingInstructions:  prop.parkingInstructions  ?? 'Information unavailable.',
    paymentRules:         prop.paymentRules         ?? 'Information unavailable.',
    upsells:              prop.upsells              ?? 'Information unavailable.',
    emergencyContacts:    prop.emergencyContacts    ?? 'Information unavailable.',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve documented knowledge for the given property from Supabase.
 * Falls back to 'Information unavailable.' for missing fields.
 * Never throws.
 */
export async function getGroundedKnowledge(
  propertyId?: string,
  // listingId is reserved for future sub-property scoping
  _listingId?: string,
): Promise<GroundedKnowledge> {
  const base: GroundedKnowledge = { universalPolicy: UNIVERSAL_POLICY };

  if (!propertyId) return withFallbacks(base, {});

  try {
    const { data, error } = await supabase
      .from('tg_property_knowledge')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle();

    if (!error && data) {
      return withFallbacks(base, rowToKnowledge(data as Record<string, unknown>));
    }
  } catch {
    // Supabase unavailable — safe fallback
  }

  return withFallbacks(base, {});
}
