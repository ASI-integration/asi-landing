import { supabase } from '@/lib/supabase';
import { GroundedKnowledge } from './types';

const UNIVERSAL_POLICY =
  `General Policy: Be helpful, concise, and professional. ` +
  `Never provide information you are not certain of. ` +
  `If information is missing, state 'That information is unavailable right now'. ` +
  `Never fabricate house rules, fees, times, access details, or payment conditions.`;

/**
 * Legacy/mock fallback knowledge store. Kept intentionally so local/dev runs can
 * still function when Supabase tables are missing or unavailable.
 */
const PROPERTY_DB: Record<string, Partial<GroundedKnowledge>> = {
  prop_A: {
    propertyPolicy: 'Strict quiet hours from 10 PM to 8 AM.',
    houseRules: 'No smoking, no pets. Parties are strictly forbidden.',
    checkInInstructions: 'Smart lock code is 1234*. Check-in is at 3:00 PM.',
    checkOutInstructions: 'Leave keys on table. Checkout at 11:00 AM.',
    wifiInstructions: 'Network: GuestWifi, Pass: secret123',
    emergencyContacts: 'Call maintenance at 555-0199 for plumbing/heating issues.',
    upsells: 'Late checkout available for $50. Extra towels $10.',
  },
};

/**
 * Retrieves documented knowledge for the given property.
 * Applies the universal policy and explicitly states if specific info is unavailable.
 */
export async function getGroundedKnowledge(propertyId?: string, listingId?: string): Promise<GroundedKnowledge> {
  const base: GroundedKnowledge = {
    universalPolicy: UNIVERSAL_POLICY,
  };

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
    return {
      ...base,
      propertyPolicy: 'Information unavailable.',
      houseRules: 'Information unavailable.',
      checkInInstructions: 'Information unavailable.',
      checkOutInstructions: 'Information unavailable.',
      wifiInstructions: 'Information unavailable.',
      parkingInstructions: 'Information unavailable.',
      paymentRules: 'Information unavailable.',
      upsells: 'Information unavailable.',
      emergencyContacts: 'Information unavailable.',
    };
  }

  // Prefer Supabase-backed knowledge when available.
  // NOTE: listingId currently isn't persisted in tg_property_knowledge; we keep
  // the param for forward-compatibility.
  try {
    if (propertyId) {
      const { data, error } = await supabase
        .from('tg_property_knowledge')
        .select(
          [
            'property_policy',
            'house_rules',
            'check_in_instructions',
            'check_out_instructions',
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

      if (!error && data) {
        const wifiInstructions =
          (data as any).wifi_instructions ??
          (((data as any).wifi_name || (data as any).wifi_password)
            ? `Network: ${(data as any).wifi_name ?? ''}, Password: ${(data as any).wifi_password ?? ''}`
            : null);

        const out: GroundedKnowledge = {
          ...base,
          propertyPolicy: (data as any).property_policy ?? 'Information unavailable.',
          houseRules: (data as any).house_rules ?? 'Information unavailable.',
          checkInInstructions: (data as any).check_in_instructions ?? 'Information unavailable.',
          checkOutInstructions: (data as any).check_out_instructions ?? 'Information unavailable.',
          wifiInstructions: wifiInstructions ?? 'Information unavailable.',
          parkingInstructions: (data as any).parking_instructions ?? 'Information unavailable.',
          paymentRules: (data as any).payment_rules ?? 'Information unavailable.',
          upsells: (data as any).upsells ?? 'Information unavailable.',
          emergencyContacts: (data as any).emergency_contacts ?? 'Information unavailable.',
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

      if (debug && !error) {
        console.log('[ru:tg] knowledge.load supabase', {
          source: 'supabase_no_row',
          property_id: propertyId,
          listing_id: listingId ?? null,
          latency_ms: Date.now() - startedAt,
        });
      }
    }
  } catch {
    // Fall back below.
  }

  // Last resort: legacy in-repo mock store (local/dev friendliness).
  const prop = propertyId && PROPERTY_DB[propertyId] ? PROPERTY_DB[propertyId] : {};
  const out: GroundedKnowledge = {
    ...base,
    propertyPolicy: prop.propertyPolicy ?? 'Information unavailable.',
    houseRules: prop.houseRules ?? 'Information unavailable.',
    checkInInstructions: prop.checkInInstructions ?? 'Information unavailable.',
    checkOutInstructions: prop.checkOutInstructions ?? 'Information unavailable.',
    wifiInstructions: prop.wifiInstructions ?? 'Information unavailable.',
    parkingInstructions: prop.parkingInstructions ?? 'Information unavailable.',
    paymentRules: prop.paymentRules ?? 'Information unavailable.',
    upsells: prop.upsells ?? 'Information unavailable.',
    emergencyContacts: prop.emergencyContacts ?? 'Information unavailable.',
  };

  if (debug) {
    console.log('[ru:tg] knowledge.load fallback', {
      source: propertyId && PROPERTY_DB[propertyId] ? 'mock' : 'fallback_empty',
      property_id: propertyId ?? null,
      listing_id: listingId ?? null,
      latency_ms: Date.now() - startedAt,
    });
  }

  return out;
}
