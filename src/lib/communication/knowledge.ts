import { supabase } from '@/lib/supabase';
import type { GroundedKnowledge } from './types';

const UNIVERSAL_POLICY =
  `General Policy: Be helpful, concise, and professional. ` +
  `Never provide information you are not certain of. ` +
  `If information is missing, state 'That information is unavailable right now'. ` +
  `Never fabricate house rules, fees, times, access details, or payment conditions.`;

type PropertyKnowledgeRow = {
  property_id: string;
  property_policy: string | null;
  house_rules: string | null;
  checkin_instructions: string | null;
  checkout_notes: string | null;
  wifi_instructions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  parking_instructions: string | null;
  payment_rules: string | null;
  upsells: string | null;
  emergency_contacts: string | null;
  active: boolean;
};

const UNAVAILABLE = 'Information unavailable.';

function unavailableKnowledge(
  loadStatus: GroundedKnowledge['loadStatus'],
  propertyId?: string,
): GroundedKnowledge {
  return {
    universalPolicy: UNIVERSAL_POLICY,
    ...(propertyId ? { propertyId } : {}),
    loadStatus,
    propertyPolicy: UNAVAILABLE,
    houseRules: UNAVAILABLE,
    checkInInstructions: UNAVAILABLE,
    checkOutInstructions: UNAVAILABLE,
    wifiInstructions: UNAVAILABLE,
    parkingInstructions: UNAVAILABLE,
    paymentRules: UNAVAILABLE,
    upsells: UNAVAILABLE,
    emergencyContacts: UNAVAILABLE,
  };
}

/**
 * Retrieves documented knowledge for the given property.
 * Applies the universal policy and explicitly states if specific info is unavailable.
 */
export async function getGroundedKnowledge(
  propertyId?: string,
  listingId?: string,
  client: typeof supabase = supabase,
): Promise<GroundedKnowledge> {
  const debug = process.env.RU_TELEGRAM_DEBUG === '1';
  const startedAt = Date.now();

  if (!propertyId && !listingId) {
    if (debug) {
      console.log('[ru:tg] knowledge.load none', {
        source: 'none',
        property_id: null,
        listing_id: listingId ?? null,
        latency_ms: Date.now() - startedAt,
      });
    }
    return unavailableKnowledge('not_requested');
  }

  // NOTE: listingId currently isn't persisted in tg_property_knowledge; we keep
  // the param for forward-compatibility.
  try {
    if (propertyId) {
      const { data, error } = await client
        .from('tg_property_knowledge')
        .select(
          [
            'property_id',
            'property_policy',
            'house_rules',
            'checkin_instructions',
            'checkout_notes',
            'wifi_instructions',
            'wifi_name',
            'wifi_password',
            'parking_instructions',
            'payment_rules',
            'upsells',
            'emergency_contacts',
            'active',
          ].join(','),
        )
        .eq('property_id', propertyId)
        .maybeSingle();

      if (error) {
        console.error('[ru:tg] knowledge.load failed', {
          property_id: propertyId,
          listing_id: listingId ?? null,
          error: error.message,
        });
        return unavailableKnowledge('lookup_failed', propertyId);
      }

      if (data) {
        const row = data as unknown as PropertyKnowledgeRow;
        if (row.property_id !== propertyId) {
          console.error('[ru:tg] knowledge.load scope mismatch', {
            requested_property_id: propertyId,
            returned_property_id: row.property_id,
          });
          return unavailableKnowledge('lookup_failed', propertyId);
        }

        const wifiInstructions =
          row.wifi_instructions ??
          ((row.wifi_name || row.wifi_password)
            ? `Network: ${row.wifi_name ?? ''}, Password: ${row.wifi_password ?? ''}`
            : null);

        const out: GroundedKnowledge = {
          universalPolicy: UNIVERSAL_POLICY,
          propertyId: row.property_id,
          loadStatus: 'found',
          propertyPolicy: row.property_policy ?? UNAVAILABLE,
          houseRules: row.house_rules ?? UNAVAILABLE,
          checkInInstructions: row.checkin_instructions ?? UNAVAILABLE,
          checkOutInstructions: row.checkout_notes ?? UNAVAILABLE,
          wifiInstructions: wifiInstructions ?? UNAVAILABLE,
          parkingInstructions: row.parking_instructions ?? UNAVAILABLE,
          paymentRules: row.payment_rules ?? UNAVAILABLE,
          upsells: row.upsells ?? UNAVAILABLE,
          emergencyContacts: row.emergency_contacts ?? UNAVAILABLE,
        };

        if (debug) {
          console.log('[ru:tg] knowledge.load supabase', {
            source: 'supabase',
            property_id: propertyId,
            listing_id: listingId ?? null,
            latency_ms: Date.now() - startedAt,
          });
        }

        return out;
      }

      if (debug) {
        console.log('[ru:tg] knowledge.load supabase', {
          source: 'supabase_no_row',
          property_id: propertyId,
          listing_id: listingId ?? null,
          latency_ms: Date.now() - startedAt,
        });
      }
      return unavailableKnowledge('not_found', propertyId);
    }
  } catch (error) {
    console.error('[ru:tg] knowledge.load failed', {
      property_id: propertyId ?? null,
      listing_id: listingId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailableKnowledge('lookup_failed', propertyId);
  }

  return unavailableKnowledge('not_requested');
}
