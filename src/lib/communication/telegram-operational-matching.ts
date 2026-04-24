import { supabase } from '@/lib/supabase';
import type { TelegramOperationalCategory } from './telegram-operational-intake';
import type { EscalationMatrixAction } from './escalation-matrix';

type SurfaceLang = 'en' | 'ru';

export type TelegramOperationalMatchConfidence =
  | 'high_confidence_match'
  | 'medium_confidence_match'
  | 'low_confidence_match'
  | 'no_match';

type SupabaseLike = { from: (table: string) => any };

export type TelegramOperationalExtractedFactsV1 = {
  guest_name?: string | null;
  property_hint?: string | null;
  address_hint?: string | null;
  checkin_hint?: string | null; // e.g. "today", "tomorrow", "2026-04-23"
  checkout_hint?: string | null;
  time_hint?: string | null; // "18:00"
  issue_type?: TelegramOperationalCategory | null;
  urgency_signals?: string[] | null;
};

export type TelegramOperationalMatchResultV1 = {
  match_confidence: TelegramOperationalMatchConfidence;
  reservation_match_status: 'matched' | 'ambiguous' | 'unmatched';
  property_match_status: 'matched' | 'ambiguous' | 'unmatched';
  matched_guest: string | null;
  matched_property: { property_id: string; location?: string | null } | null;
  matched_reservation_id: string | null;
  reason: string;
  suggested_clarification_question: string | null;
  suggested_action_override: EscalationMatrixAction | null;
  /** Debug surface for the property_hint → matched_property_id trace. */
  property_hint: string | null;
  normalized_property_hint: string | null;
  candidate_matches: Array<{ property_id: string; location: string | null }>;
  chosen_match: { property_id: string; location: string | null } | null;
};

function normalizeSpace(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function normKey(s: string): string {
  return normalizeSpace(s).toLowerCase();
}

function isoDateUTC(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dayRangeUtcIso(yyyyMmDd: string): { start: string; end: string } {
  return {
    start: `${yyyyMmDd}T00:00:00.000Z`,
    end: `${yyyyMmDd}T23:59:59.999Z`,
  };
}

function bestQuestion(params: {
  surfaceLang: SurfaceLang;
  guestName?: string | null;
  propertyLabel?: string | null;
  checkinHint?: string | null;
  kind:
    | 'need_property'
    | 'need_guest'
    | 'confirm_guest_today_checkin'
    | 'confirm_property'
    | 'need_arrival_time';
}): string {
  const ru = params.surfaceLang === 'ru';
  if (params.kind === 'need_property') return ru ? 'Для какого объекта/адреса это?' : 'Which property is this for?';
  if (params.kind === 'need_guest') return ru ? 'Какое имя гостя?' : 'What is the guest name?';
  if (params.kind === 'need_arrival_time') return ru ? 'Во сколько гость приезжает?' : 'What time is the guest arriving?';
  if (params.kind === 'confirm_property') {
    const label = params.propertyLabel ? params.propertyLabel : null;
    if (label) return ru ? `Это по объекту ${label}?` : `Is this for ${label}?`;
    return ru ? 'Для какого объекта/адреса это?' : 'Which property is this for?';
  }
  // confirm_guest_today_checkin
  const g = params.guestName ? params.guestName : (ru ? 'этот гость' : 'this guest');
  return ru ? `Это про заезд сегодня у гостя ${g}?` : `Is this about ${g} checking in today?`;
}

/**
 * Normalize a property/address hint for DB matching.
 *
 * - lowercases
 * - strips common street-type words that add noise for ilike
 *   (проспект/просп./пр./пр-т, улица/ул., набережная/наб., street/ave/...)
 * - collapses RU declensions for our priority streets so that
 *   "в Невском 24", "на Невском", "Невского 24" all normalize to "невский 24"
 */
function normalizePropertyHintForMatching(hint: string): string {
  let s = String(hint ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/проспект|просп\.?|пр-т|пр\.(?=\s|$)/giu, ' ');
  s = s.replace(/улица|ул\.?(?=\s|$)/giu, ' ');
  s = s.replace(/набережная|наб\.?(?=\s|$)/giu, ' ');
  s = s.replace(/(?:\b|[^\p{L}])(street|str\.?|avenue|ave\.?|road|rd\.?)(?=\s|$)/giu, ' ');
  s = s.replace(/(невск)(ий|ого|ому|ом|ая|ую|ой|им)/iu, 'невский');
  s = s.replace(/(литейн)(ый|ого|ому|ом|ая|ую|ой|ым)/iu, 'литейный');
  return s.replace(/\s+/g, ' ').trim();
}

function extractStreetAndNumber(hint: string): { street: string | null; number: string | null } {
  const norm = normalizePropertyHintForMatching(hint);
  if (!norm) return { street: null, number: null };
  const m = norm.match(/([\p{L}][\p{L}\-\.]{2,40})\s+(\d{1,4})(?:\s*к\d+)?/u);
  if (!m) return { street: null, number: null };
  return { street: String(m[1] ?? '').trim() || null, number: String(m[2] ?? '').trim() || null };
}

/**
 * Build alias query forms so that the same address in different writings
 * ("Невский 24", "Nevsky 24", "nevsky_24") all produce candidates.
 * Order matters — most-specific first.
 */
function buildLocationAliases(hint: string): string[] {
  const set = new Set<string>();
  const raw = String(hint ?? '').replace(/\s+/g, ' ').trim();
  if (raw) set.add(raw);
  const norm = normalizePropertyHintForMatching(raw);
  if (norm) set.add(norm);
  const transMap: Record<string, string[]> = {
    'невский': ['nevsky', 'nevskiy', 'nevskij'],
    'литейный': ['liteyny', 'liteiny', 'liteynyy'],
    'тверской': ['tverskoy', 'tversky'],
  };
  for (const [ru, ens] of Object.entries(transMap)) {
    if (norm.includes(ru)) {
      for (const en of ens) set.add(norm.replace(ru, en));
    }
  }
  return Array.from(set).filter(s => s.length >= 3);
}

async function queryPropertiesByLocationHint(db: SupabaseLike, hint: string) {
  const clue = normalizeSpace(hint);
  if (!clue || clue.length < 3) return [];

  // Attempt 1: try each alias form as a single ilike substring on `location`.
  const aliases = buildLocationAliases(clue);
  for (const alias of aliases) {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select('property_id, location')
      .ilike('location', `%${alias}%`)
      .limit(5);
    if (!error && Array.isArray(data) && data.length > 0) return data as any[];
  }

  // Attempt 2: tokenized fallback — match by street word and then filter on number.
  const { street, number } = extractStreetAndNumber(clue);
  if (street && number) {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select('property_id, location')
      .ilike('location', `%${street}%`)
      .limit(20);
    if (!error && Array.isArray(data)) {
      const filtered = (data as any[]).filter(r => {
        const loc = String((r as any)?.location ?? '').toLowerCase();
        return loc.includes(number);
      });
      if (filtered.length > 0) return filtered;
    }
  }

  return [];
}

function logPropertyMatchDiagnostics(params: {
  update_id: number;
  scenario: string;
  property_hint: string | null;
  normalized_property_hint: string | null;
  candidate_matches: Array<{ property_id: string; location: string | null }>;
  chosen_match: { property_id: string; location: string | null } | null;
  matched_property_id: string | null;
  match_confidence: TelegramOperationalMatchConfidence;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'telegram_property_match_diagnostics',
        update_id: params.update_id,
        scenario: params.scenario,
        property_hint: params.property_hint,
        normalized_property_hint: params.normalized_property_hint,
        candidate_matches: params.candidate_matches,
        chosen_match: params.chosen_match,
        matched_property_id: params.matched_property_id,
        match_confidence: params.match_confidence,
      }),
    );
  } catch {
    // never throw from logging
  }
}

async function queryReservationsActiveByGuestName(db: SupabaseLike, guestName: string, nowIso: string) {
  const name = normalizeSpace(guestName);
  if (!name) return [];
  const { data, error } = await db
    .from('tg_guest_reservations')
    .select('id, property_id, guest_name, check_in, check_out')
    .ilike('guest_name', `%${name}%`)
    .lte('check_in', nowIso)
    .gte('check_out', nowIso)
    .order('check_in', { ascending: false })
    .limit(5);
  if (error) return [];
  return Array.isArray(data) ? (data as any[]) : [];
}

async function queryReservationsUpcomingByGuestName(db: SupabaseLike, guestName: string, startDay: string, endDay: string) {
  const name = normalizeSpace(guestName);
  if (!name) return [];
  const { data, error } = await db
    .from('tg_guest_reservations')
    .select('id, property_id, guest_name, check_in, check_out')
    .ilike('guest_name', `%${name}%`)
    .gte('check_in', startDay)
    .lte('check_in', endDay)
    .order('check_in', { ascending: true })
    .limit(8);
  if (error) return [];
  return Array.isArray(data) ? (data as any[]) : [];
}

async function queryReservationsActiveByPropertyIds(db: SupabaseLike, propertyIds: string[], nowIso: string) {
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) return [];
  const { data, error } = await db
    .from('tg_guest_reservations')
    .select('id, property_id, guest_name, check_in, check_out')
    .in('property_id', propertyIds)
    .lte('check_in', nowIso)
    .gte('check_out', nowIso)
    .order('check_in', { ascending: false })
    .limit(5);
  if (error) return [];
  return Array.isArray(data) ? (data as any[]) : [];
}

async function queryReservationsByGuestNameAndCheckinDay(db: SupabaseLike, guestName: string, yyyyMmDd: string) {
  const name = normalizeSpace(guestName);
  if (!name) return [];
  const { start, end } = dayRangeUtcIso(yyyyMmDd);
  const { data, error } = await db
    .from('tg_guest_reservations')
    .select('id, property_id, guest_name, check_in, check_out')
    .ilike('guest_name', `%${name}%`)
    .gte('check_in', start)
    .lte('check_in', end)
    .limit(5);
  if (error) return [];
  return Array.isArray(data) ? (data as any[]) : [];
}

export async function matchTelegramOperationalEntitiesV1(params: {
  surfaceLang: SurfaceLang;
  update_id: number;
  scenario: TelegramOperationalCategory;
  extracted_facts: TelegramOperationalExtractedFactsV1;
  /** Override db for tests */
  db?: SupabaseLike;
}): Promise<TelegramOperationalMatchResultV1> {
  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const facts = params.extracted_facts ?? {};
  const guestName = normalizeSpace(facts.guest_name ?? '');
  const propHintRaw = normalizeSpace((facts.property_hint ?? facts.address_hint ?? '') as any);
  const checkinHint = normalizeSpace(facts.checkin_hint ?? '');
  const timeHint = normalizeSpace(facts.time_hint ?? '');

  const now = new Date();
  const nowIso = now.toISOString();
  const today = isoDateUTC(now);
  const plus7 = isoDateUTC(addDaysUTC(now, 7));

  // Property candidate resolution — run once, reuse everywhere.
  // We need candidate_matches + chosen_match on every result path for the property
  // match debug trace, so compute them up-front when a property hint is present.
  const normalizedPropertyHint = propHintRaw ? normalizePropertyHintForMatching(propHintRaw) : '';
  const propertyCandidatesRaw = propHintRaw ? await queryPropertiesByLocationHint(db, propHintRaw) : [];
  const candidateMatches: Array<{ property_id: string; location: string | null }> = (propertyCandidatesRaw as any[])
    .map(p => ({
      property_id: String((p as any)?.property_id ?? ''),
      location: ((p as any)?.location ?? null) as string | null,
    }))
    .filter(c => c.property_id.length > 0);

  const finalize = (base: Omit<TelegramOperationalMatchResultV1,
    'property_hint' | 'normalized_property_hint' | 'candidate_matches' | 'chosen_match'>): TelegramOperationalMatchResultV1 => {
    const chosen = base.matched_property
      ? { property_id: base.matched_property.property_id, location: (base.matched_property.location ?? null) as string | null }
      : null;
    const result: TelegramOperationalMatchResultV1 = {
      ...base,
      property_hint: propHintRaw || null,
      normalized_property_hint: normalizedPropertyHint || null,
      candidate_matches: candidateMatches,
      chosen_match: chosen,
    };
    logPropertyMatchDiagnostics({
      update_id: params.update_id,
      scenario: params.scenario,
      property_hint: result.property_hint,
      normalized_property_hint: result.normalized_property_hint,
      candidate_matches: result.candidate_matches,
      chosen_match: result.chosen_match,
      matched_property_id: result.matched_property?.property_id ?? null,
      match_confidence: result.match_confidence,
    });
    return result;
  };

  // Step 1: active reservation by guest_name
  if (guestName) {
    const active = await queryReservationsActiveByGuestName(db, guestName, nowIso);
    if (active.length === 1) {
      const r = active[0] as any;
      return finalize({
        match_confidence: 'high_confidence_match',
        reservation_match_status: 'matched',
        property_match_status: r.property_id ? 'matched' : 'unmatched',
        matched_guest: r.guest_name ?? guestName,
        matched_property: r.property_id ? { property_id: String(r.property_id), location: null } : null,
        matched_reservation_id: String(r.id),
        reason: 'active_reservation_by_guest_name',
        suggested_clarification_question: null,
        suggested_action_override: null,
      });
    }
  }

  // Step 2: arriving-today / upcoming by guest_name
  if (guestName) {
    // If text says "today check-in", narrow to today first.
    const wantsTodayCheckin = /\btoday\b|сегодня/i.test(checkinHint) || /\bchecking\s+in\s+today\b/i.test(normKey(checkinHint));
    if (wantsTodayCheckin) {
      const todayRes = await queryReservationsByGuestNameAndCheckinDay(db, guestName, today);
      if (todayRes.length === 1) {
        const r = todayRes[0] as any;
        return finalize({
          match_confidence: 'high_confidence_match',
          reservation_match_status: 'matched',
          property_match_status: r.property_id ? 'matched' : 'unmatched',
          matched_guest: r.guest_name ?? guestName,
          matched_property: r.property_id ? { property_id: String(r.property_id), location: null } : null,
          matched_reservation_id: String(r.id),
          reason: 'today_checkin_reservation_by_guest_name',
          suggested_clarification_question: null,
          suggested_action_override: null,
        });
      }
      if (todayRes.length > 1) {
        return finalize({
          match_confidence: 'medium_confidence_match',
          reservation_match_status: 'ambiguous',
          property_match_status: 'unmatched',
          matched_guest: guestName,
          matched_property: null,
          matched_reservation_id: null,
          reason: 'multiple_today_checkin_reservations_by_guest_name',
          suggested_clarification_question: bestQuestion({ surfaceLang: params.surfaceLang, guestName, kind: 'confirm_guest_today_checkin' }),
          suggested_action_override: 'clarify',
        });
      }
    }

    const { start: startDay } = dayRangeUtcIso(today);
    const { end: endDay } = dayRangeUtcIso(plus7);
    const upcoming = await queryReservationsUpcomingByGuestName(db, guestName, startDay, endDay);
    if (upcoming.length === 1) {
      const r = upcoming[0] as any;
      return finalize({
        match_confidence: 'medium_confidence_match',
        reservation_match_status: 'matched',
        property_match_status: r.property_id ? 'matched' : 'unmatched',
        matched_guest: r.guest_name ?? guestName,
        matched_property: r.property_id ? { property_id: String(r.property_id), location: null } : null,
        matched_reservation_id: String(r.id),
        reason: 'upcoming_reservation_by_guest_name',
        suggested_clarification_question: timeHint ? null : bestQuestion({ surfaceLang: params.surfaceLang, kind: 'need_arrival_time' }),
        suggested_action_override: null,
      });
    }
  }

  // Step 3: property hint / address hint → property
  if (propHintRaw) {
    const propIds = candidateMatches.map(c => c.property_id).filter(Boolean);
    if (propIds.length === 1) {
      const p = candidateMatches[0]!;

      // Step 5: if only property known, match active stay for same property
      const activeOnProp = await queryReservationsActiveByPropertyIds(db, propIds, nowIso);
      if (activeOnProp.length === 1) {
        const r = activeOnProp[0] as any;
        return finalize({
          match_confidence: guestName ? 'high_confidence_match' : 'medium_confidence_match',
          reservation_match_status: 'matched',
          property_match_status: 'matched',
          matched_guest: r.guest_name ?? (guestName || null),
          matched_property: { property_id: propIds[0]!, location: (p.location ?? null) as any },
          matched_reservation_id: String(r.id),
          reason: 'active_reservation_by_property',
          suggested_clarification_question: null,
          suggested_action_override: null,
        });
      }

      return finalize({
        match_confidence: 'medium_confidence_match',
        reservation_match_status: 'unmatched',
        property_match_status: 'matched',
        matched_guest: guestName || null,
        matched_property: { property_id: propIds[0]!, location: (p.location ?? null) as any },
        matched_reservation_id: null,
        reason: 'unique_property_by_hint',
        suggested_clarification_question: guestName ? null : bestQuestion({ surfaceLang: params.surfaceLang, propertyLabel: p.location ?? propHintRaw, kind: 'need_guest' }),
        suggested_action_override: null,
      });
    }

    if (propIds.length > 1) {
      const label = candidateMatches[0]?.location ? String(candidateMatches[0]!.location) : propHintRaw;
      return finalize({
        match_confidence: 'low_confidence_match',
        reservation_match_status: 'unmatched',
        property_match_status: 'ambiguous',
        matched_guest: guestName || null,
        matched_property: null,
        matched_reservation_id: null,
        reason: 'ambiguous_property_by_hint',
        suggested_clarification_question: bestQuestion({ surfaceLang: params.surfaceLang, propertyLabel: label, kind: 'need_property' }),
        suggested_action_override: 'clarify',
      });
    }
  }

  // Step 4: combination guest_name + timing hint (very conservative)
  if (guestName && checkinHint && /\b(today|tomorrow|сегодня|завтра)\b/i.test(checkinHint)) {
    const day = /\b(tomorrow|завтра)\b/i.test(checkinHint) ? isoDateUTC(addDaysUTC(now, 1)) : today;
    const res = await queryReservationsByGuestNameAndCheckinDay(db, guestName, day);
    if (res.length === 1) {
      const r = res[0] as any;
      return finalize({
        match_confidence: 'medium_confidence_match',
        reservation_match_status: 'matched',
        property_match_status: r.property_id ? 'matched' : 'unmatched',
        matched_guest: r.guest_name ?? guestName,
        matched_property: r.property_id ? { property_id: String(r.property_id), location: null } : null,
        matched_reservation_id: String(r.id),
        reason: 'guest_plus_timing_day_match',
        suggested_clarification_question: null,
        suggested_action_override: null,
      });
    }
  }

  // No match
  return finalize({
    match_confidence: 'no_match',
    reservation_match_status: 'unmatched',
    property_match_status: 'unmatched',
    matched_guest: guestName || null,
    matched_property: null,
    matched_reservation_id: null,
    reason: 'no_candidates',
    // When nothing matches, the most useful single question for ops routing is the property/address.
    suggested_clarification_question: bestQuestion({ surfaceLang: params.surfaceLang, kind: 'need_property' }),
    suggested_action_override: 'clarify',
  });
}

