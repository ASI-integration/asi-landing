/**
 * Operator-confirmed reservation bridge.
 *
 * Implements the structured operator-side action that converts a handed-off
 * booking inquiry into a linked reservation and initializes the stay-flow.
 *
 * Called by: POST /api/admin/link-reservation
 *
 * Flow:
 *   1. Load the open inquiry by chat_id or inquiry_flow_id.
 *   2. Guard idempotency: if already converted_to_reservation, return success.
 *   3. Upsert tg_guest_reservations (create or update by reservation_ref).
 *   4. Initialize tg_stay_flows in reservation_linked state (idempotent).
 *   5. Mark inquiry as converted_to_reservation with conversion_source = 'operator_confirmed'.
 *   6. Append timeline events for full audit continuity.
 *
 * Idempotent: repeating the same bridge action is always safe — no duplicate
 * reservation rows, no duplicate stay-flows, no duplicate inquiry conversions.
 *
 * Never throws — all errors are returned in BridgeResult.ok = false.
 */

import { supabase } from '@/lib/supabase';
import { appendTimelineEvent } from './timeline';
import {
  getInquiryFlowByChatId,
  getInquiryFlowById,
  upsertInquiryFlow,
  InquiryFlowStatus,
  InquiryFlow,
} from './inquiry-flow';
import { upsertStayFlow, getStayFlowByReservationId } from './stay-flow';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BridgeParams {
  /** UUID from tg_inquiry_flows.id — preferred when available */
  inquiryFlowId?: string;
  /** Telegram chat_id (shown in the handoff notification) — alternative identifier */
  chatId?:        number;
  /** External booking reference, e.g. "AIRBNB-12345" or "BOOKING-678" */
  reservationRef: string;
  /** Property identifier, e.g. "prop_A" */
  propertyId?:    string;
  /** Guest name for stay-flow message personalisation */
  guestName?:     string;
  /** YYYY-MM-DD check-in date */
  checkIn?:       string;
  /** YYYY-MM-DD check-out date */
  checkOut?:      string;
  /** Free-form operator note (stored in timeline, not persisted to inquiry row) */
  operatorNote?:  string;
}

export interface BridgeResult {
  ok:                boolean;
  /** true when the inquiry was already converted — no changes made, safe retry */
  alreadyConverted?: boolean;
  reservationId?:    string;
  stayFlowId?:       string;
  inquiryFlowId?:    string;
  error?:            string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONVERSION_SOURCE = 'operator_confirmed';

// ─── Core bridge function ─────────────────────────────────────────────────────

/**
 * Operator bridge: link an open inquiry to a real reservation and auto-start stay-flow.
 *
 * Safe to call multiple times — all writes are idempotent.
 */
export async function operatorLinkReservation(params: BridgeParams): Promise<BridgeResult> {
  try {
    // ── 1. Load inquiry ───────────────────────────────────────────────────────
    let flow: InquiryFlow | null = null;

    if (params.inquiryFlowId) {
      flow = await getInquiryFlowById(params.inquiryFlowId);
    } else if (params.chatId != null) {
      flow = await getInquiryFlowByChatId(params.chatId);
    }

    if (!flow) {
      return { ok: false, error: 'inquiry_not_found' };
    }

    const chatId  = flow.chatId;
    const guestId = flow.guestId;

    // ── 2. Idempotency: already converted ─────────────────────────────────────
    if (
      flow.inquiryStatus === InquiryFlowStatus.ConvertedToReservation &&
      flow.linkedReservationId
    ) {
      const existingFlow = await getStayFlowByReservationId(flow.linkedReservationId);
      return {
        ok:               true,
        alreadyConverted: true,
        reservationId:    flow.linkedReservationId,
        stayFlowId:       existingFlow?.id,
        inquiryFlowId:    flow.id,
      };
    }

    // ── 3. Upsert tg_guest_reservations ──────────────────────────────────────
    // ON CONFLICT reservation_ref: update linkage fields so the row is always
    // consistent with the current inquiry context.
    const { data: resData, error: resErr } = await supabase
      .from('tg_guest_reservations')
      .upsert(
        {
          reservation_ref: params.reservationRef,
          guest_id:        guestId            ?? null,
          chat_id:         chatId,
          property_id:     params.propertyId  ?? null,
          guest_name:      params.guestName   ?? null,
          check_in:        params.checkIn     ?? null,
          check_out:       params.checkOut    ?? null,
          status:          'confirmed',
          updated_at:      new Date().toISOString(),
        },
        { onConflict: 'reservation_ref', ignoreDuplicates: false },
      )
      .select('id')
      .single();

    if (resErr || !resData) {
      const msg = resErr?.message ?? 'no data returned';
      console.error('[ReservationBridge] reservation upsert failed:', msg);
      return { ok: false, error: `reservation_upsert_failed: ${msg}` };
    }

    const reservationId = (resData as { id: string }).id;

    // ── 4. Initialize stay-flow (idempotent) ──────────────────────────────────
    // upsertStayFlow does NOT include flow_status in the payload, so on conflict
    // the existing status is preserved (never regresses an active stay-flow).
    const stayFlow = await upsertStayFlow({
      reservationId,
      chatId,
      guestId,
      propertyId:   params.propertyId,
      checkinDate:  params.checkIn,
      checkoutDate: params.checkOut,
    });

    // ── 5. Convert inquiry ────────────────────────────────────────────────────
    const now = new Date();
    await upsertInquiryFlow({
      chatId,
      status:              InquiryFlowStatus.ConvertedToReservation,
      linkedReservationId: reservationId,
      convertedAt:         now,
      conversionSource:    CONVERSION_SOURCE,
    });

    // ── 6. Append timeline events (audit continuity) ──────────────────────────
    if (guestId) {
      appendTimelineEvent(
        guestId,
        {
          type:            'reservation_linked',
          source:          CONVERSION_SOURCE,
          reservation_ref: params.reservationRef,
          reservation_id:  reservationId,
          ...(params.operatorNote ? { operator_note: params.operatorNote } : {}),
          ts:              now,
        },
        chatId,
      ).catch(() => {});

      appendTimelineEvent(
        guestId,
        { type: 'stay_flow_initialized', reservation_id: reservationId, ts: now },
        chatId,
      ).catch(() => {});

      appendTimelineEvent(
        guestId,
        {
          type:              'inquiry_converted',
          reason:            `operator_confirmed: ${params.reservationRef}`,
          reservation_id:    reservationId,
          conversion_source: CONVERSION_SOURCE,
          ts:                now,
        },
        chatId,
      ).catch(() => {});
    }

    console.log(
      `[ReservationBridge] Linked chatId=${chatId} → reservationId=${reservationId}` +
      ` ref=${params.reservationRef} stayFlowId=${stayFlow?.id ?? 'null'}`,
    );

    return {
      ok:            true,
      reservationId,
      stayFlowId:    stayFlow?.id,
      inquiryFlowId: flow.id,
    };
  } catch (err) {
    console.error('[ReservationBridge] operatorLinkReservation error:', String(err));
    return { ok: false, error: String(err) };
  }
}

// ─── Recovery: create missing stay_flows for already-converted inquiries ──────

export interface RecoveryDetail {
  reservationId: string;
  chatId?:       number;
  status:        'recovered' | 'already_exists' | 'error';
  error?:        string;
}

export interface RecoveryResult {
  ok:        boolean;
  recovered: number;
  skipped:   number;
  errors:    number;
  details:   RecoveryDetail[];
  error?:    string;
}

/**
 * Find converted inquiries that have a linked_reservation_id but no tg_stay_flows row,
 * and create the missing stay_flow in reservation_linked state.
 *
 * Idempotent: safe to call multiple times — skips any reservation that already has a stay_flow.
 * Pass chatId to scope recovery to a single chat for targeted manual validation.
 * Never throws — per-row errors are recorded in details[].
 */
export async function recoverMissingStayFlows(params?: {
  chatId?: number;
}): Promise<RecoveryResult> {
  try {
    // 1. Load converted inquiries with a linked reservation
    const base = supabase
      .from('tg_inquiry_flows')
      .select('chat_id, guest_id, linked_reservation_id')
      .eq('inquiry_status', InquiryFlowStatus.ConvertedToReservation)
      .not('linked_reservation_id', 'is', null);

    const query = params?.chatId != null ? base.eq('chat_id', params.chatId) : base;

    const { data: inquiries, error: qErr } = await query;
    if (qErr) {
      return { ok: false, recovered: 0, skipped: 0, errors: 0, details: [], error: qErr.message };
    }

    const rows = (inquiries ?? []) as Array<{
      chat_id:               number;
      guest_id?:             string;
      linked_reservation_id: string;
    }>;

    const details: RecoveryDetail[] = [];
    let recovered = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const row of rows) {
      const reservationId = row.linked_reservation_id;
      const chatId        = row.chat_id;
      const guestId       = row.guest_id;

      try {
        // 2. Skip if stay_flow already exists
        const existing = await getStayFlowByReservationId(reservationId);
        if (existing) {
          details.push({ reservationId, chatId, status: 'already_exists' });
          skipped++;
          continue;
        }

        // 3. Confirm reservation row exists and load enrichment data
        const { data: resRow } = await supabase
          .from('tg_guest_reservations')
          .select('id, property_id, check_in, check_out')
          .eq('id', reservationId)
          .maybeSingle();

        if (!resRow) {
          details.push({ reservationId, chatId, status: 'error', error: 'reservation_not_found' });
          errors++;
          continue;
        }

        const res = resRow as { id: string; property_id?: string; check_in?: string; check_out?: string };

        // 4. Create missing stay_flow (upsert on conflict reservation_id is safe)
        const flow = await upsertStayFlow({
          reservationId,
          chatId,
          guestId,
          propertyId:   res.property_id,
          checkinDate:  res.check_in,
          checkoutDate: res.check_out,
        });

        if (!flow) {
          details.push({ reservationId, chatId, status: 'error', error: 'upsert_failed' });
          errors++;
        } else {
          details.push({ reservationId, chatId, status: 'recovered' });
          recovered++;
          console.log(`[RecoverStayFlow] Created stay_flow flowId=${flow.id} reservationId=${reservationId} chatId=${chatId}`);
        }
      } catch (rowErr) {
        details.push({ reservationId, chatId, status: 'error', error: String(rowErr) });
        errors++;
      }
    }

    return { ok: true, recovered, skipped, errors, details };
  } catch (err) {
    console.error('[RecoverStayFlow] recoverMissingStayFlows error:', String(err));
    return { ok: false, recovered: 0, skipped: 0, errors: 0, details: [], error: String(err) };
  }
}
