import { ReservationMatchResult } from './types';

// Mock database for reservations
const DB = {
  // exact phone/name match
  'res_111': {
    reservationId: 'res_111',
    propertyId: 'prop_A',
    listingId: 'list_1',
    guestId: 'guest_alpha',
    guestName: 'John Doe',
    phone: '+1234567890',
    checkIn: '2026-03-22',
    checkOut: '2026-03-25'
  },
  // two people share the same name (ambiguous)
  'res_222': {
    reservationId: 'res_222',
    propertyId: 'prop_B',
    guestName: 'Jane Smith',
    checkIn: '2026-03-23',
  },
  'res_333': {
    reservationId: 'res_333',
    propertyId: 'prop_C',
    guestName: 'Jane Smith',
    checkIn: '2026-03-24',
  }
};

export interface MatchParams {
  chatId?: number;
  phone?: string;
  guestName?: string;
  bookingReference?: string;
  channelReference?: string;
}

/**
 * Rules:
 * - never invent reservation linkage
 * - if ambiguous, return multiple candidates
 * - if unmatched, return unmatched safely
 */
export async function matchReservation(params: MatchParams): Promise<ReservationMatchResult> {
  const { guestName, phone, bookingReference } = params;

  // 1. Exact match by reference
  if (bookingReference && DB[bookingReference as keyof typeof DB]) {
    const res = DB[bookingReference as keyof typeof DB];
    return {
      status: 'matched',
      confidence: 1.0,
      ...res,
    };
  }

  // 2. Search by phone or name
  let matches = Object.values(DB);
  
  if (phone) {
    matches = matches.filter(r => 'phone' in r && r.phone === phone);
  } else if (guestName) {
    matches = matches.filter(r => r.guestName?.toLowerCase() === guestName.toLowerCase());
  } else {
    // If no identifiers provided, return unmatched
    return { status: 'unmatched', confidence: 0 };
  }

  if (matches.length === 1) {
    return {
      status: 'matched',
      confidence: 0.9,
      ...matches[0]
    };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      confidence: 0.5,
      candidates: matches.map(m => ({
        reservationId: m.reservationId,
        guestName: m.guestName,
        checkIn: 'checkIn' in m ? m.checkIn : undefined,
        checkOut: 'checkOut' in m ? m.checkOut : undefined
      }))
    };
  }

  return {
    status: 'unmatched',
    confidence: 0
  };
}
