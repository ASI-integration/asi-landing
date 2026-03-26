/**
 * G2 — Real reservation linkage.
 *
 * Replaces the hardcoded 3-record mock with a lookup against the
 * tg_guest_reservations table (see migration 20260326000001).
 *
 * Lookup priority:
 *   1. Session linkage (tg_conversation_sessions already linked this chat
 *      to a guest+property — look up their active reservation directly).
 *   2. Direct chat_id match in tg_guest_reservations.
 *   3. Exact booking reference.
 *   4. Phone number.
 *   5. Guest name (lower-confidence, may return ambiguous).
 *
 * Failure modes:
 *   - No match → status:'unmatched', confidence:0.
 *   - Multiple name matches → status:'ambiguous'.
 *   - Supabase unavailable → status:'unmatched' (safe fallback, logged).
 */

import { supabase } from '@/lib/supabase';
import { ReservationMatchResult } from './types';
import { loadSession } from './persistence';

export interface MatchParams {
  chatId?:           number;
  phone?:            string;
  guestName?:        string;
  bookingReference?: string;
  channelReference?: string;
}

// ─── Row to result ────────────────────────────────────────────────────────────

function rowToMatch(
  row: Record<string, unknown>,
  confidence: number,
): ReservationMatchResult {
  return {
    status:        'matched',
    confidence,
    reservationId: row.id          as string | undefined,
    propertyId:    row.property_id as string | undefined,
    guestId:       row.guest_id    as string | undefined,
    guestName:     row.guest_name  as string | undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rules (unchanged from Phase 1 contract):
 * - Never invent reservation linkage.
 * - If ambiguous, return multiple candidates.
 * - If unmatched, return unmatched safely.
 */
export async function matchReservation(
  params: MatchParams,
): Promise<ReservationMatchResult> {
  const { chatId, phone, guestName, bookingReference } = params;

  try {
    // ── 1. Session linkage: prefer existing match on this session ─────────────
    if (chatId) {
      const session = await loadSession(chatId);
      if (session?.guest_id && session?.property_id) {
        const { data } = await supabase
          .from('tg_guest_reservations')
          .select('*')
          .eq('guest_id', session.guest_id)
          .eq('property_id', session.property_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data) return rowToMatch(data as Record<string, unknown>, 1.0);
      }

      // ── 2. Direct chat_id match ───────────────────────────────────────────
      const { data: byChat } = await supabase
        .from('tg_guest_reservations')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (byChat) return rowToMatch(byChat as Record<string, unknown>, 1.0);
    }

    // ── 3. Exact booking reference ────────────────────────────────────────────
    if (bookingReference) {
      const { data } = await supabase
        .from('tg_guest_reservations')
        .select('*')
        .eq('reservation_ref', bookingReference)
        .maybeSingle();

      if (data) return rowToMatch(data as Record<string, unknown>, 1.0);
    }

    // ── 4. Phone number ───────────────────────────────────────────────────────
    if (phone) {
      const { data, error } = await supabase
        .from('tg_guest_reservations')
        .select('*')
        .eq('phone', phone);

      if (!error && data) {
        if (data.length === 1)
          return rowToMatch(data[0] as Record<string, unknown>, 0.9);

        if (data.length > 1) {
          return {
            status:     'ambiguous',
            confidence: 0.5,
            candidates: (data as Record<string, unknown>[]).map(d => ({
              reservationId: d.id as string,
              guestName:     d.guest_name as string | undefined,
              checkIn:       d.check_in   as string | undefined,
              checkOut:      d.check_out  as string | undefined,
            })),
          };
        }
      }
    }

    // ── 5. Guest name (fuzzy, lower confidence) ───────────────────────────────
    if (guestName) {
      const { data, error } = await supabase
        .from('tg_guest_reservations')
        .select('*')
        .ilike('guest_name', guestName);

      if (!error && data) {
        if (data.length === 1)
          return rowToMatch(data[0] as Record<string, unknown>, 0.7);

        if (data.length > 1) {
          return {
            status:     'ambiguous',
            confidence: 0.4,
            candidates: (data as Record<string, unknown>[]).map(d => ({
              reservationId: d.id as string,
              guestName:     d.guest_name as string | undefined,
              checkIn:       d.check_in   as string | undefined,
              checkOut:      d.check_out  as string | undefined,
            })),
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Reservation] matchReservation failed safely:', String(err));
  }

  return { status: 'unmatched', confidence: 0 };
}
