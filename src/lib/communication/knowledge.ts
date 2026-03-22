import { GroundedKnowledge } from './types';

const UNIVERSAL_POLICY = `General Policy: Be helpful, concise, and professional. Never provide information you are not certain of. If information is missing, state 'That information is unavailable right now'. Never fabricate house rules, fees, times, access details, or payment conditions.`;

const PROPERTY_DB: Record<string, Partial<GroundedKnowledge>> = {
  'prop_A': {
    propertyPolicy: 'Strict quiet hours from 10 PM to 8 AM.',
    houseRules: 'No smoking, no pets. Parties are strictly forbidden.',
    checkInInstructions: 'Smart lock code is 1234*. Check-in is at 3:00 PM.',
    checkOutInstructions: 'Leave keys on table. Checkout at 11:00 AM.',
    wifiInstructions: 'Network: GuestWifi, Pass: secret123',
    emergencyContacts: 'Call maintenance at 555-0199 for plumbing/heating issues.',
    upsells: 'Late checkout available for $50. Extra towels $10.'
  }
};

/**
 * Retrieves documented knowledge for the given property.
 * Applies the universal policy and explicitly states if specific info is unavailable.
 */
export async function getGroundedKnowledge(propertyId?: string, listingId?: string): Promise<GroundedKnowledge> {
  const base: GroundedKnowledge = {
    universalPolicy: UNIVERSAL_POLICY,
  };

  const prop = propertyId && PROPERTY_DB[propertyId] ? PROPERTY_DB[propertyId] : {};

  return {
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
}
