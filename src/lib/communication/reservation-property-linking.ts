import { supabase } from '@/lib/supabase';
import type {
  ReservationPropertyLinkingCandidateV1,
  ReservationPropertyLinkingCategoryV1,
  ReservationPropertyLinkingMissingFactV1,
  ReservationPropertyLinkingOutcomeV1,
  ReservationPropertyLinkingStateV1,
} from './types';

type SurfaceLang = 'en' | 'ru';

type SupabaseLike = {
  from: (table: string) => any;
};

function normalizeSpace(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function normKey(s: string): string {
  return normalizeSpace(s).toLowerCase();
}

function extractGuestNameLoose(text: string): string | null {
  const t = String(text ?? '');
  const m =
    t.match(/\bguest\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u) ??
    t.match(/\bгость\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u);
  return m ? m[1].trim() : null;
}

function extractPropertySnippetLoose(text: string): string | null {
  const t = String(text ?? '');
  const m1 = t.match(/по\s+адресу\s+([^.\n?]+)/i);
  if (m1) return m1[1].trim().slice(0, 140);
  const m2 = t.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (m2) return m2[1].trim().slice(0, 140);
  return null;
}

function extractTimingToken(text: string): 'today_checkin' | 'today_checkout' | null {
  const n = normKey(text);
  const today = /\b(today|сегодня)\b/i.test(n);
  if (!today) return null;
  const checkin = /\bcheck[-\s]?in\b|заезд|засел/i.test(n);
  const checkout = /\bcheck[-\s]?out\b|выезд/i.test(n);
  if (checkin && !checkout) return 'today_checkin';
  if (checkout && !checkin) return 'today_checkout';
  // Ambiguous "today + check-in/out" is not deterministic enough
  return null;
}

function isoDateUTC(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildOneFactQuestion(missing: ReservationPropertyLinkingMissingFactV1, surfaceLang: SurfaceLang): string {
  const ru = surfaceLang === 'ru';
  if (missing === 'property_or_address') return ru ? 'Для какого объекта/адреса это?' : 'Which property is this for?';
  if (missing === 'guest_name') return ru ? 'Какое имя гостя?' : 'What is the guest name?';
  return ru ? 'Это для заезда/выезда сегодня?' : 'Is this for today’s check-in?';
}

function logLinking(params: {
  update_id: string;
  category: ReservationPropertyLinkingCategoryV1;
  candidate_matches: ReservationPropertyLinkingCandidateV1[];
  chosen_match: ReservationPropertyLinkingCandidateV1 | null;
  missing_fact_for_linking: ReservationPropertyLinkingMissingFactV1 | null;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'reservation_property_linking',
        category: params.category,
        candidate_matches: params.candidate_matches,
        chosen_match: params.chosen_match,
        confidence_type: 'deterministic',
        missing_fact_for_linking: params.missing_fact_for_linking,
        update_id: params.update_id,
      }),
    );
  } catch {
    // never throw from logging
  }
}

async function queryPropertiesByLocation(db: SupabaseLike, clue: string): Promise<Array<{ property_id: string; location?: string }>> {
  const { data, error } = await db
    .from('tg_property_knowledge')
    .select('property_id, location')
    .ilike('location', `%${clue}%`)
    .limit(5);
  if (error) return [];
  return Array.isArray(data) ? (data as any) : [];
}

async function queryReservationsByPropertyIds(db: SupabaseLike, propertyIds: string[], guestName?: string, checkInDate?: string, checkOutDate?: string) {
  let q = db
    .from('tg_guest_reservations')
    .select('id, property_id, guest_name, check_in, check_out')
    .in('property_id', propertyIds)
    .limit(5);

  if (guestName) q = q.ilike('guest_name', `%${guestName}%`);

  if (checkInDate) {
    const start = `${checkInDate}T00:00:00.000Z`;
    const end = `${checkInDate}T23:59:59.999Z`;
    q = q.gte('check_in', start).lte('check_in', end);
  }
  if (checkOutDate) {
    const start = `${checkOutDate}T00:00:00.000Z`;
    const end = `${checkOutDate}T23:59:59.999Z`;
    q = q.gte('check_out', start).lte('check_out', end);
  }

  const { data, error } = await q;
  if (error) return [];
  return Array.isArray(data) ? (data as any) : [];
}

async function queryReservationsByGuestNameAndTiming(
  db: SupabaseLike,
  guestName: string,
  checkInDate?: string,
  checkOutDate?: string,
) {
  let q = db
    .from('tg_guest_reservations')
    .select('id, property_id, guest_name, check_in, check_out')
    .ilike('guest_name', `%${guestName}%`)
    .limit(5);

  if (checkInDate) {
    const start = `${checkInDate}T00:00:00.000Z`;
    const end = `${checkInDate}T23:59:59.999Z`;
    q = q.gte('check_in', start).lte('check_in', end);
  }
  if (checkOutDate) {
    const start = `${checkOutDate}T00:00:00.000Z`;
    const end = `${checkOutDate}T23:59:59.999Z`;
    q = q.gte('check_out', start).lte('check_out', end);
  }

  const { data, error } = await q;
  if (error) return [];
  return Array.isArray(data) ? (data as any) : [];
}

export type ReservationPropertyLinkingInputV1 = {
  text: string;
  surfaceLang: SurfaceLang;
  update_id: number;
  /** Structured facts already in memory/session. */
  propertyLocation?: string | null;
  guestName?: string | null;
  /** YYYY-MM-DD if known (staff bridge). */
  checkInDate?: string | null;
  /** Reservation reference if known (staff bridge). */
  bookingReference?: string | null;
  /** Override db for tests */
  db?: SupabaseLike;
};

export type ReservationPropertyLinkingResultV1 =
  | { outcome: 'linked_to_property'; propertyId: string; state: ReservationPropertyLinkingStateV1 }
  | { outcome: 'linked_to_reservation'; reservationId: string; propertyId?: string; state: ReservationPropertyLinkingStateV1 }
  | { outcome: 'unresolved_needs_one_fact'; question: string; state: ReservationPropertyLinkingStateV1 }
  | { outcome: 'unresolved_escalate'; state: ReservationPropertyLinkingStateV1 };

/**
 * Deterministic reservation/property linking v1.
 * Never invent matches: only link when query returns exactly one candidate.
 */
export async function linkReservationOrPropertyDeterministicV1(
  input: ReservationPropertyLinkingInputV1,
): Promise<ReservationPropertyLinkingResultV1> {
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  const updateId = `tg:${String(input.update_id)}`;

  const propertyLocation =
    (input.propertyLocation && input.propertyLocation.trim()) ? input.propertyLocation.trim() : extractPropertySnippetLoose(input.text);
  const guestName =
    (input.guestName && input.guestName.trim()) ? input.guestName.trim() : extractGuestNameLoose(input.text);

  const checkInDate = input.checkInDate && /^\d{4}-\d{2}-\d{2}$/.test(input.checkInDate) ? input.checkInDate : null;

  const timingToken = extractTimingToken(input.text);
  const todayUtc = isoDateUTC(new Date());
  const timingCheckInDate = timingToken === 'today_checkin' ? todayUtc : null;
  const timingCheckOutDate = timingToken === 'today_checkout' ? todayUtc : null;

  const candidates: ReservationPropertyLinkingCandidateV1[] = [];
  let chosen: ReservationPropertyLinkingCandidateV1 | null = null;
  let category: ReservationPropertyLinkingCategoryV1 = 'none';
  let missingFact: ReservationPropertyLinkingMissingFactV1 | null = null;

  // Booking reference is handled elsewhere (reservation.match). Keep this explicit for audit.
  if (input.bookingReference && String(input.bookingReference).trim()) {
    category = 'booking_reference';
    const state: ReservationPropertyLinkingStateV1 = {
      outcome: 'unresolved_escalate',
      category,
      candidate_matches: [],
      confidence_type: 'deterministic',
      update_id: updateId,
    };
    logLinking({ update_id: updateId, category, candidate_matches: [], chosen_match: null, missing_fact_for_linking: null });
    return { outcome: 'unresolved_escalate', state };
  }

  // 1) Property/address text → property_id (only if exactly one property matches)
  if (propertyLocation && propertyLocation.length >= 3) {
    category = 'property_address_text';
    const props = await queryPropertiesByLocation(db, propertyLocation);
    const propIds = props
      .map(p => String((p as any).property_id ?? ''))
      .filter(id => id && id.length > 0);

    if (propIds.length === 1) {
      chosen = { type: 'property', id: propIds[0]!, reason: 'unique property match by address/location text' };
      candidates.push(chosen);

      // If we also have guest name or timing, try to resolve to a unique reservation for that property.
      const checkInForQuery = checkInDate ?? timingCheckInDate;
      const checkOutForQuery = timingCheckOutDate;
      if (guestName || checkInForQuery || checkOutForQuery) {
        const res = await queryReservationsByPropertyIds(db, propIds, guestName ?? undefined, checkInForQuery ?? undefined, checkOutForQuery ?? undefined);
        if (res.length === 1) {
          const r = res[0] as any;
          const resChosen: ReservationPropertyLinkingCandidateV1 = {
            type: 'reservation',
            id: String(r.id),
            reason: 'unique reservation match within matched property using guest/timing',
          };
          candidates.push(resChosen);
          const state: ReservationPropertyLinkingStateV1 = {
            outcome: 'linked_to_reservation',
            category,
            candidate_matches: candidates,
            chosen_match: resChosen,
            confidence_type: 'deterministic',
            update_id: updateId,
          };
          logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: resChosen, missing_fact_for_linking: null });
          return {
            outcome: 'linked_to_reservation',
            reservationId: String(r.id),
            propertyId: r.property_id ? String(r.property_id) : propIds[0],
            state,
          };
        }
        if (res.length > 1) {
          // Ambiguous reservations under one property → escalate (do not guess)
          for (const r of res.slice(0, 5)) {
            candidates.push({
              type: 'reservation',
              id: String((r as any).id),
              reason: 'multiple reservation candidates under property (ambiguous)',
            });
          }
          const state: ReservationPropertyLinkingStateV1 = {
            outcome: 'unresolved_escalate',
            category,
            candidate_matches: candidates,
            chosen_match: chosen ?? undefined,
            confidence_type: 'deterministic',
            update_id: updateId,
          };
          logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: chosen, missing_fact_for_linking: null });
          return { outcome: 'unresolved_escalate', state };
        }
      }

      // Property linked, reservation not deterministically linked.
      const state: ReservationPropertyLinkingStateV1 = {
        outcome: 'linked_to_property',
        category,
        candidate_matches: candidates,
        chosen_match: chosen,
        confidence_type: 'deterministic',
        update_id: updateId,
      };
      logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: chosen, missing_fact_for_linking: null });
      return { outcome: 'linked_to_property', propertyId: propIds[0]!, state };
    }

    // Multiple properties matched: can't choose deterministically.
    for (const id of propIds.slice(0, 5)) {
      candidates.push({ type: 'property', id, reason: 'multiple property candidates by address/location text (ambiguous)' });
    }
  }

  // 2) Guest name (optionally with timing) → unique reservation
  if (guestName && guestName.length >= 2) {
    category = 'guest_name';
    const checkInForQuery = checkInDate ?? timingCheckInDate;
    const checkOutForQuery = timingCheckOutDate;
    const res = await queryReservationsByGuestNameAndTiming(db, guestName, checkInForQuery ?? undefined, checkOutForQuery ?? undefined);

    if (res.length === 1) {
      const r = res[0] as any;
      chosen = { type: 'reservation', id: String(r.id), reason: 'unique reservation match by guest name (+ optional timing)' };
      candidates.push(chosen);
      const state: ReservationPropertyLinkingStateV1 = {
        outcome: 'linked_to_reservation',
        category,
        candidate_matches: candidates,
        chosen_match: chosen,
        confidence_type: 'deterministic',
        update_id: updateId,
      };
      logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: chosen, missing_fact_for_linking: null });
      return { outcome: 'linked_to_reservation', reservationId: String(r.id), propertyId: r.property_id ? String(r.property_id) : undefined, state };
    }

    if (res.length > 1) {
      for (const r of res.slice(0, 5)) {
        candidates.push({ type: 'reservation', id: String((r as any).id), reason: 'multiple reservation candidates by guest name (ambiguous)' });
      }
      const state: ReservationPropertyLinkingStateV1 = {
        outcome: 'unresolved_escalate',
        category,
        candidate_matches: candidates,
        confidence_type: 'deterministic',
        update_id: updateId,
      };
      logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: null, missing_fact_for_linking: null });
      return { outcome: 'unresolved_escalate', state };
    }
  }

  // 3) Timing-only is not enough to deterministically link without property or guest.
  if (timingToken) {
    category = 'checkin_checkout_timing';
  }

  // Missing fact resolution: if exactly one key fact is missing, ask one short question.
  const hasPropClue = Boolean(propertyLocation && propertyLocation.trim().length >= 3);
  const hasGuestClue = Boolean(guestName && guestName.trim().length >= 2);
  const hasTimingClue = Boolean(checkInDate || timingToken);

  const missing: ReservationPropertyLinkingMissingFactV1[] = [];
  if (!hasPropClue) missing.push('property_or_address');
  if (!hasGuestClue) missing.push('guest_name');
  if (!hasTimingClue) missing.push('checkin_or_checkout_timing');

  // Heuristic for "one missing fact": only when we already have at least two of the three.
  const haveCount = 3 - missing.length;
  if (missing.length === 1 && haveCount >= 2) {
    missingFact = missing[0]!;
    const q = buildOneFactQuestion(missingFact, input.surfaceLang);
    const state: ReservationPropertyLinkingStateV1 = {
      outcome: 'unresolved_needs_one_fact',
      category,
      candidate_matches: candidates,
      confidence_type: 'deterministic',
      missing_fact_for_linking: missingFact,
      update_id: updateId,
    };
    logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: null, missing_fact_for_linking: missingFact });
    return { outcome: 'unresolved_needs_one_fact', question: q, state };
  }

  const state: ReservationPropertyLinkingStateV1 = {
    outcome: 'unresolved_escalate',
    category,
    candidate_matches: candidates,
    confidence_type: 'deterministic',
    update_id: updateId,
  };
  logLinking({ update_id: updateId, category, candidate_matches: candidates, chosen_match: null, missing_fact_for_linking: null });
  return { outcome: 'unresolved_escalate', state };
}

