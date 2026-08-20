import { supabase } from '@/lib/supabase';
import { ReservationMatchResult } from './types';

/**
 * Legacy/mock reservation store. Kept so local/dev unit tests and offline
 * work still function if Supabase is unavailable.
 */
const MOCK_DB = {
  res_111: {
    reservationId: 'res_111',
    propertyId: 'prop_A',
    listingId: 'list_1',
    guestId: 'guest_alpha',
    guestName: 'John Doe',
    phone: '+1234567890',
    checkIn: '2026-03-22',
    checkOut: '2026-03-25',
  },
  res_222: {
    reservationId: 'res_222',
    propertyId: 'prop_B',
    guestName: 'Jane Smith',
    checkIn: '2026-03-23',
  },
  res_333: {
    reservationId: 'res_333',
    propertyId: 'prop_C',
    guestName: 'Jane Smith',
    checkIn: '2026-03-24',
  },
} as const;

export interface MatchParams {
  chatId?: number;
  phone?: string;
  guestName?: string;
  bookingReference?: string;
  channelReference?: string;
  propertyLocation?: string;
  /** YYYY-MM-DD (used for narrowing, optional) */
  checkInDate?: string;
}

/**
 * Rules:
 * - never invent reservation linkage
 * - if ambiguous, return multiple candidates
 * - if unmatched, return unmatched safely
 */
export async function matchReservation(params: MatchParams): Promise<ReservationMatchResult> {
  const { guestName, phone, bookingReference, chatId, propertyLocation, checkInDate } = params;
  const debug = process.env.RU_TELEGRAM_DEBUG === '1';
  const startedAt = Date.now();
  const dbgBase = debug
    ? {
        chat_id: typeof chatId === 'number' && Number.isFinite(chatId) ? chatId : null,
        has_booking_ref: Boolean(bookingReference),
        has_phone: Boolean(phone),
        has_guest_name: Boolean(guestName),
        has_property_location: Boolean(propertyLocation),
        has_checkin_date: Boolean(checkInDate),
      }
    : null;

  // Prefer Supabase-backed matching (production).
  try {
    let supabaseAttempted = false;

    // Exact match by reference (reservation_ref is the public stable key)
    if (bookingReference) {
      const byRef = await supabase
        .from('tg_guest_reservations')
        .select('id, reservation_ref, property_id, guest_id, guest_name, phone, check_in, check_out')
        .eq('reservation_ref', bookingReference)
        .maybeSingle();

      if (!byRef.error) supabaseAttempted = true;
      if (!byRef.error && byRef.data) {
        const out = {
          status: 'matched',
          confidence: 1.0,
          reservationId: (byRef.data as any).id,
          propertyId: (byRef.data as any).property_id ?? undefined,
          guestId: (byRef.data as any).guest_id ?? undefined,
          guestName: (byRef.data as any).guest_name ?? undefined,
        } satisfies ReservationMatchResult;
        if (debug) {
          console.log('[ru:tg] reservation.match supabase', {
            ...dbgBase,
            source: 'supabase',
            status: out.status,
            confidence: out.confidence,
            reservation_id: out.reservationId ?? null,
            property_id: out.propertyId ?? null,
            latency_ms: Date.now() - startedAt,
          });
        }
        return out;
      }

      // Some callers might pass the internal id instead of reservation_ref.
      const byId = await supabase
        .from('tg_guest_reservations')
        .select('id, property_id, guest_id, guest_name, phone, check_in, check_out')
        .eq('id', bookingReference)
        .maybeSingle();

      if (!byId.error) supabaseAttempted = true;
      if (!byId.error && byId.data) {
        const out = {
          status: 'matched',
          confidence: 1.0,
          reservationId: (byId.data as any).id,
          propertyId: (byId.data as any).property_id ?? undefined,
          guestId: (byId.data as any).guest_id ?? undefined,
          guestName: (byId.data as any).guest_name ?? undefined,
        } satisfies ReservationMatchResult;
        if (debug) {
          console.log('[ru:tg] reservation.match supabase', {
            ...dbgBase,
            source: 'supabase',
            status: out.status,
            confidence: out.confidence,
            reservation_id: out.reservationId ?? null,
            property_id: out.propertyId ?? null,
            latency_ms: Date.now() - startedAt,
          });
        }
        return out;
      }
    }

    // ChatId is the strongest link for Telegram.
    if (typeof chatId === 'number' && Number.isFinite(chatId)) {
      const { data, error } = await supabase
        .from('tg_guest_reservations')
        .select('id, property_id, guest_id, guest_name, check_in, check_out')
        .eq('chat_id', chatId)
        .order('updated_at', { ascending: false })
        .limit(3);

      if (!error) supabaseAttempted = true;
      if (!error && Array.isArray(data) && data.length === 1) {
        const out = {
          status: 'matched',
          confidence: 0.95,
          reservationId: (data[0] as any).id,
          propertyId: (data[0] as any).property_id ?? undefined,
          guestId: (data[0] as any).guest_id ?? undefined,
          guestName: (data[0] as any).guest_name ?? undefined,
        } satisfies ReservationMatchResult;
        if (debug) {
          console.log('[ru:tg] reservation.match supabase', {
            ...dbgBase,
            source: 'supabase',
            status: out.status,
            confidence: out.confidence,
            reservation_id: out.reservationId ?? null,
            property_id: out.propertyId ?? null,
            latency_ms: Date.now() - startedAt,
          });
        }
        return out;
      }
      if (!error && Array.isArray(data) && data.length > 1) {
        const out = {
          status: 'ambiguous',
          confidence: 0.6,
          candidates: data.map((r: any) => ({
            reservationId: r.id,
            guestName: r.guest_name ?? undefined,
            checkIn: r.check_in ?? undefined,
            checkOut: r.check_out ?? undefined,
          })),
        } satisfies ReservationMatchResult;
        if (debug) {
          console.log('[ru:tg] reservation.match supabase', {
            ...dbgBase,
            source: 'supabase',
            status: out.status,
            confidence: out.confidence,
            candidates_count: out.candidates?.length ?? 0,
            latency_ms: Date.now() - startedAt,
          });
        }
        return out;
      }
    }

    // Fallback identifiers: phone or guest name (can be ambiguous).
    if (phone || guestName) {
      let query = supabase
        .from('tg_guest_reservations')
        .select('id, property_id, guest_id, guest_name, check_in, check_out')
        .limit(5);

      if (phone) query = query.eq('phone', phone) as typeof query;
      if (guestName) query = query.ilike('guest_name', guestName) as typeof query;

      const { data, error } = await query;
      if (!error) supabaseAttempted = true;
      if (!error && Array.isArray(data) && data.length === 1) {
        const out = {
          status: 'matched',
          confidence: 0.8,
          reservationId: (data[0] as any).id,
          propertyId: (data[0] as any).property_id ?? undefined,
          guestId: (data[0] as any).guest_id ?? undefined,
          guestName: (data[0] as any).guest_name ?? undefined,
        } satisfies ReservationMatchResult;
        if (debug) {
          console.log('[ru:tg] reservation.match supabase', {
            ...dbgBase,
            source: 'supabase',
            status: out.status,
            confidence: out.confidence,
            reservation_id: out.reservationId ?? null,
            property_id: out.propertyId ?? null,
            latency_ms: Date.now() - startedAt,
          });
        }
        return out;
      }
      if (!error && Array.isArray(data) && data.length > 1) {
        const out = {
          status: 'ambiguous',
          confidence: 0.5,
          candidates: data.map((r: any) => ({
            reservationId: r.id,
            guestName: r.guest_name ?? undefined,
            checkIn: r.check_in ?? undefined,
            checkOut: r.check_out ?? undefined,
          })),
        } satisfies ReservationMatchResult;
        if (debug) {
          console.log('[ru:tg] reservation.match supabase', {
            ...dbgBase,
            source: 'supabase',
            status: out.status,
            confidence: out.confidence,
            candidates_count: out.candidates?.length ?? 0,
            latency_ms: Date.now() - startedAt,
          });
        }
        return out;
      }
    }

    // Staff-mode bridge: match by property "location" + optional guestName/checkInDate.
    // Uses tg_property_knowledge.location as a practical operator-facing address/name field.
    if (propertyLocation && propertyLocation.trim().length >= 3) {
      const clue = propertyLocation.trim();

      const prop = await supabase
        .from('tg_property_knowledge')
        .select('property_id, location')
        .ilike('location', `%${clue}%`)
        .limit(5);

      if (!prop.error) supabaseAttempted = true;

      const propIds = Array.isArray(prop.data)
        ? prop.data.map((r: any) => r.property_id).filter((x: any) => typeof x === 'string' && x.length > 0)
        : [];

      if (propIds.length > 0) {
        let q = supabase
          .from('tg_guest_reservations')
          .select('id, property_id, guest_id, guest_name, check_in, check_out')
          .in('property_id', propIds)
          .limit(5);

        if (guestName) {
          // Use a contains-ish match. Operators often provide partial names.
          q = q.ilike('guest_name', `%${guestName}%`) as typeof q;
        }

        if (checkInDate && /^\d{4}-\d{2}-\d{2}$/.test(checkInDate)) {
          // Narrow to that calendar day (best-effort; assumes check_in is timestamptz).
          const start = `${checkInDate}T00:00:00.000Z`;
          const end = `${checkInDate}T23:59:59.999Z`;
          q = (q.gte('check_in', start) as typeof q).lte('check_in', end) as typeof q;
        }

        const { data, error } = await q;
        if (!error) supabaseAttempted = true;

        if (!error && Array.isArray(data) && data.length === 1) {
          const out = {
            status: 'matched',
            confidence: 0.75,
            reservationId: (data[0] as any).id,
            propertyId: (data[0] as any).property_id ?? undefined,
            guestId: (data[0] as any).guest_id ?? undefined,
            guestName: (data[0] as any).guest_name ?? undefined,
          } satisfies ReservationMatchResult;
          if (debug) {
            console.log('[ru:tg] reservation.match supabase', {
              ...dbgBase,
              source: 'supabase_property_location',
              status: out.status,
              confidence: out.confidence,
              reservation_id: out.reservationId ?? null,
              property_id: out.propertyId ?? null,
              latency_ms: Date.now() - startedAt,
            });
          }
          return out;
        }

        if (!error && Array.isArray(data) && data.length > 1) {
          const out = {
            status: 'ambiguous',
            confidence: 0.45,
            candidates: data.map((r: any) => ({
              reservationId: r.id,
              guestName: r.guest_name ?? undefined,
              checkIn: r.check_in ?? undefined,
              checkOut: r.check_out ?? undefined,
            })),
          } satisfies ReservationMatchResult;
          if (debug) {
            console.log('[ru:tg] reservation.match supabase', {
              ...dbgBase,
              source: 'supabase_property_location',
              status: out.status,
              confidence: out.confidence,
              candidates_count: out.candidates?.length ?? 0,
              latency_ms: Date.now() - startedAt,
            });
          }
          return out;
        }
      }
    }

    if (debug && supabaseAttempted) {
      console.log('[ru:tg] reservation.match supabase', {
        ...dbgBase,
        source: 'supabase_no_match',
        status: 'unmatched',
        confidence: 0,
        latency_ms: Date.now() - startedAt,
      });
    }
  } catch {
    // Fall back to mock db below.
  }

  // Legacy/mock behaviour (dev/offline).
  if (bookingReference && (MOCK_DB as any)[bookingReference]) {
    const res = (MOCK_DB as any)[bookingReference];
    const out = { status: 'matched', confidence: 1.0, ...res } satisfies ReservationMatchResult;
    if (debug) {
      console.log('[ru:tg] reservation.match fallback', {
        ...dbgBase,
        source: 'mock',
        status: out.status,
        confidence: out.confidence,
        reservation_id: (out as any).reservationId ?? null,
        property_id: (out as any).propertyId ?? null,
        latency_ms: Date.now() - startedAt,
      });
    }
    return out;
  }

  let matches = Object.values(MOCK_DB) as any[];
  if (phone) {
    matches = matches.filter(r => 'phone' in r && r.phone === phone);
  } else if (guestName) {
    matches = matches.filter(r => r.guestName?.toLowerCase() === guestName.toLowerCase());
  } else {
    const out = { status: 'unmatched', confidence: 0 } satisfies ReservationMatchResult;
    if (debug) {
      console.log('[ru:tg] reservation.match none', {
        ...dbgBase,
        source: 'none',
        status: out.status,
        confidence: out.confidence,
        latency_ms: Date.now() - startedAt,
      });
    }
    return out;
  }

  if (matches.length === 1) {
    const out = { status: 'matched', confidence: 0.9, ...matches[0] } satisfies ReservationMatchResult;
    if (debug) {
      console.log('[ru:tg] reservation.match fallback', {
        ...dbgBase,
        source: 'mock',
        status: out.status,
        confidence: out.confidence,
        reservation_id: (out as any).reservationId ?? null,
        property_id: (out as any).propertyId ?? null,
        latency_ms: Date.now() - startedAt,
      });
    }
    return out;
  }

  if (matches.length > 1) {
    const out = {
      status: 'ambiguous',
      confidence: 0.5,
      candidates: matches.map(m => ({
        reservationId: m.reservationId,
        guestName: m.guestName,
        checkIn: 'checkIn' in m ? m.checkIn : undefined,
        checkOut: 'checkOut' in m ? m.checkOut : undefined,
      })),
    } satisfies ReservationMatchResult;
    if (debug) {
      console.log('[ru:tg] reservation.match fallback', {
        ...dbgBase,
        source: 'mock',
        status: out.status,
        confidence: out.confidence,
        candidates_count: out.candidates?.length ?? 0,
        latency_ms: Date.now() - startedAt,
      });
    }
    return out;
  }

  const out = { status: 'unmatched', confidence: 0 } satisfies ReservationMatchResult;
  if (debug) {
    console.log('[ru:tg] reservation.match none', {
      ...dbgBase,
      source: 'none',
      status: out.status,
      confidence: out.confidence,
      latency_ms: Date.now() - startedAt,
    });
  }
  return out;
}
