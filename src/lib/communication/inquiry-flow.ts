/**
 * Pre-booking inquiry flow — minimal vertical slice.
 *
 * Tracks guest contacts that arrive without a linked reservation.
 * Classifies the contact intent, accumulates minimum booking details
 * across multiple turns, creates a structured human handoff, and
 * bridges to the stay-flow when a reservation is eventually linked.
 *
 * Persisted in: tg_inquiry_flows
 *               (migration 20260326000003_inquiry_flow_table.sql)
 *
 * State machine:
 *   new_contact → general_question
 *              → collecting_booking_details → awaiting_missing_details ↺
 *                                           → ready_for_handoff → handed_off
 *              → escalated
 *   any state  → converted_to_reservation  (when reservation linked)
 *   any state  → closed
 *
 * Called from: orchestrator.ts after buildCommunicationContext.
 * Graceful degradation: all DB operations catch errors and never throw.
 */

import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { appendTimelineEvent } from './timeline';
import { upsertStayFlow } from './stay-flow';
import { IntentCategory, IntentResult } from './types';

// ─── Status constants ──────────────────────────────────────────────────────────

export const InquiryFlowStatus = {
  NewContact:              'new_contact',
  GeneralQuestion:         'general_question',
  CollectingDetails:       'collecting_booking_details',
  AwaitingMissingDetails:  'awaiting_missing_details',
  ReadyForHandoff:         'ready_for_handoff',
  HandedOff:               'handed_off',
  ConvertedToReservation:  'converted_to_reservation',
  Closed:                  'closed',
  Escalated:               'escalated',
} as const;

export type InquiryFlowStatus = (typeof InquiryFlowStatus)[keyof typeof InquiryFlowStatus];

// ─── Handoff type ──────────────────────────────────────────────────────────────

export type InquiryHandoffType = 'booking_inquiry' | 'support_issue' | 'uncertainty';

// ─── Booking details (accumulated across turns) ───────────────────────────────

export interface InquiryBookingDetails {
  desired_dates?:  string;
  guest_count?:    number;
  property_ref?:   string;
  lang_hint?:      string;
  freeform_note?:  string;
}

// ─── Domain type ──────────────────────────────────────────────────────────────

export interface InquiryFlow {
  id:                    string;
  chatId:                number;
  guestId?:              string;
  telegramUserId?:       number;
  inquiryStatus:         InquiryFlowStatus;
  bookingDetails:        InquiryBookingDetails;
  intakeTurnCount:       number;
  handoffType?:          InquiryHandoffType;
  handoffAt?:            Date;
  handoffSummary?:       string;
  linkedReservationId?:  string;
  convertedAt?:          Date;
  conversionSource?:     string;
  lastInboundAt:         Date;
  lastOutboundAt?:       Date;
  createdAt:             Date;
  updatedAt:             Date;
}

// ─── Row → domain mapper ──────────────────────────────────────────────────────

function rowToFlow(row: Record<string, unknown>): InquiryFlow {
  return {
    id:                   row.id                  as string,
    chatId:               Number(row.chat_id),
    guestId:              row.guest_id             as string | undefined,
    telegramUserId:       row.telegram_user_id != null ? Number(row.telegram_user_id) : undefined,
    inquiryStatus:        (row.inquiry_status      as InquiryFlowStatus) ?? InquiryFlowStatus.NewContact,
    bookingDetails:       (row.booking_details      as InquiryBookingDetails) ?? {},
    intakeTurnCount:      Number(row.intake_turn_count ?? 0),
    handoffType:          row.handoff_type          as InquiryHandoffType | undefined,
    handoffAt:            row.handoff_at     ? new Date(row.handoff_at     as string) : undefined,
    handoffSummary:       row.handoff_summary       as string | undefined,
    linkedReservationId:  row.linked_reservation_id as string | undefined,
    convertedAt:          row.converted_at  ? new Date(row.converted_at  as string) : undefined,
    conversionSource:     row.conversion_source    as string | undefined,
    lastInboundAt:        new Date(row.last_inbound_at as string),
    lastOutboundAt:       row.last_outbound_at ? new Date(row.last_outbound_at as string) : undefined,
    createdAt:            new Date(row.created_at  as string),
    updatedAt:            new Date(row.updated_at  as string),
  };
}

// ─── DB: Lookup ───────────────────────────────────────────────────────────────

export async function getInquiryFlowByChatId(chatId: number): Promise<InquiryFlow | null> {
  try {
    const { data } = await supabase
      .from('tg_inquiry_flows')
      .select('*')
      .eq('chat_id', chatId)
      .maybeSingle();

    return data ? rowToFlow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function getInquiryFlowById(id: string): Promise<InquiryFlow | null> {
  try {
    const { data } = await supabase
      .from('tg_inquiry_flows')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    return data ? rowToFlow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─── DB: Upsert ───────────────────────────────────────────────────────────────

interface InquiryFlowUpsert {
  chatId:               number;
  guestId?:             string;
  telegramUserId?:      number;
  status?:              InquiryFlowStatus;
  bookingDetails?:      InquiryBookingDetails;
  intakeTurnCount?:     number;
  handoffType?:         InquiryHandoffType;
  handoffAt?:           Date;
  handoffSummary?:      string;
  linkedReservationId?: string;
  convertedAt?:         Date;
  conversionSource?:    string;
  lastInboundAt?:       Date;
  lastOutboundAt?:      Date;
}

export async function upsertInquiryFlow(params: InquiryFlowUpsert): Promise<InquiryFlow | null> {
  try {
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      chat_id:    params.chatId,
      updated_at: now,
    };

    if (params.guestId            != null) row.guest_id              = params.guestId;
    if (params.telegramUserId     != null) row.telegram_user_id      = params.telegramUserId;
    if (params.status             != null) row.inquiry_status        = params.status;
    if (params.bookingDetails     != null) row.booking_details       = params.bookingDetails;
    if (params.intakeTurnCount    != null) row.intake_turn_count     = params.intakeTurnCount;
    if (params.handoffType        != null) row.handoff_type          = params.handoffType;
    if (params.handoffAt          != null) row.handoff_at            = params.handoffAt.toISOString();
    if (params.handoffSummary     != null) row.handoff_summary       = params.handoffSummary;
    if (params.linkedReservationId != null) row.linked_reservation_id = params.linkedReservationId;
    if (params.convertedAt        != null) row.converted_at          = params.convertedAt.toISOString();
    if (params.conversionSource   != null) row.conversion_source     = params.conversionSource;
    if (params.lastInboundAt      != null) row.last_inbound_at       = params.lastInboundAt.toISOString();
    if (params.lastOutboundAt     != null) row.last_outbound_at      = params.lastOutboundAt.toISOString();

    const { error } = await supabase
      .from('tg_inquiry_flows')
      .upsert(row, { onConflict: 'chat_id', ignoreDuplicates: false });

    if (error) {
      console.error('[InquiryFlow] upsert failed:', error.message);
      return null;
    }

    return getInquiryFlowByChatId(params.chatId);
  } catch (err) {
    console.error('[InquiryFlow] upsert exception:', String(err));
    return null;
  }
}

// ─── Contact classification ───────────────────────────────────────────────────

/**
 * Classify a first contact as booking_inquiry, general_question, or support_issue.
 * Uses the intent result and message category already resolved by the orchestrator.
 */
export function classifyFirstContact(
  intentResult:    IntentResult,
  messageCategory: string,
): 'booking_inquiry' | 'general_question' | 'support_issue' {
  const { intent } = intentResult;

  if (intent === IntentCategory.BookingInquiry)                  return 'booking_inquiry';
  if (intent === IntentCategory.IssueReport)                     return 'support_issue';
  if (messageCategory === 'booking')                             return 'booking_inquiry';
  if (messageCategory === 'issue')                               return 'support_issue';

  return 'general_question';
}

// ─── Booking detail extraction ────────────────────────────────────────────────

/**
 * Merge newly detected booking fields from inbound text into existing details.
 * Uses lightweight regex — no LLM call required.
 * Never overwrites a field that is already set.
 */
export function mergeBookingDetails(
  text:     string,
  existing: InquiryBookingDetails,
): InquiryBookingDetails {
  const merged: InquiryBookingDetails = { ...existing };

  // Guest count: "2 people", "for 3 guests", "2 человека", "3 гостя"
  if (!merged.guest_count) {
    // No trailing \b — Cyrillic endings are not in \w so \b fails there
    const m = text.match(/\b(\d{1,2})\s+(?:people|guests?|persons?|человек[аи]?|гост(?:я|ей|и))/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 30) merged.guest_count = n;
    }
  }

  // Desired dates — Russian ISO-like: "с 05.07 по 10.07", "01.08-05.08"
  if (!merged.desired_dates) {
    const ruDate = text.match(
      /(?:с|от)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:по|до|-|–|—)\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/i,
    );
    if (ruDate) {
      merged.desired_dates = `${ruDate[1]}–${ruDate[2]}`;
    }
  }

  // Desired dates — English: "July 5-10", "Aug 1 to Sep 3"
  // Requires an actual month name to avoid false positives like "for 2".
  if (!merged.desired_dates) {
    const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    const enDate = text.match(
      new RegExp(`\\b(${MONTH} \\d{1,2}(?:\\s*[-–—]\\s*(?:${MONTH} ?)?\\d{1,2})?)\\b`, 'i'),
    );
    if (enDate) {
      merged.desired_dates = enDate[1].trim();
    }
  }

  // Property / city reference: "in Moscow", "в Москве", "near New York"
  // Each captured word must start with a capital letter to stop at lowercase
  // prepositions like "for", "с", "по" that follow the city name.
  if (!merged.property_ref) {
    const propRu = text.match(/в\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)*)(?=\s|,|\.|$)/u);
    const propEn = text.match(/(?:in|at|near)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)(?=\s|,|\.|$)/u);
    if (propRu?.[1]) {
      merged.property_ref = propRu[1].trim();
    } else if (propEn?.[1]) {
      merged.property_ref = propEn[1].trim();
    }
  }

  // Freeform note — capture the first message (first 400 chars)
  if (!merged.freeform_note && text.trim().length > 3) {
    merged.freeform_note = text.slice(0, 400);
  }

  return merged;
}

// ─── Completeness check ───────────────────────────────────────────────────────

export function getMissingBookingFields(details: InquiryBookingDetails): Array<'desired_dates' | 'guest_count' | 'property_ref'> {
  const missing: Array<'desired_dates' | 'guest_count' | 'property_ref'> = [];
  if (!details.desired_dates) missing.push('desired_dates');
  if (!details.guest_count)   missing.push('guest_count');
  if (!details.property_ref)  missing.push('property_ref');
  return missing;
}

/**
 * Ready for handoff when ≥2 of 3 booking fields are known,
 * OR when the guest has had 3+ intake turns (avoid endless questionnaire).
 */
export function isReadyForHandoff(details: InquiryBookingDetails, intakeTurnCount: number): boolean {
  if (intakeTurnCount >= 3) return true;
  return getMissingBookingFields(details).length <= 1;
}

// ─── Next-question helper ─────────────────────────────────────────────────────

/**
 * Return the single question to ask for the highest-priority missing field.
 * Returns null when no fields are missing.
 */
export function buildNextMissingFieldQuestion(
  missing: Array<'desired_dates' | 'guest_count' | 'property_ref'>,
  lang:    string,
): string | null {
  if (missing.length === 0) return null;
  const isRu = lang === 'ru';
  const field = missing[0];

  if (field === 'desired_dates') {
    return isRu
      ? 'Уточните, пожалуйста, предполагаемые даты заезда и выезда.'
      : 'Could you share your preferred check-in and check-out dates?';
  }
  if (field === 'guest_count') {
    return isRu
      ? 'Сколько гостей планирует заехать?'
      : 'How many guests will be staying?';
  }
  if (field === 'property_ref') {
    return isRu
      ? 'В каком городе или объекте вас интересует размещение?'
      : 'Which city or property are you interested in?';
  }
  return null;
}

// ─── Operator handoff ─────────────────────────────────────────────────────────

function buildHandoffSummary(flow: InquiryFlow): string {
  const d = flow.bookingDetails;
  return [
    `📋 Booking Inquiry — Human Follow-up Required`,
    `Chat ID: ${flow.chatId}`,
    `Guest ID: ${flow.guestId ?? 'unknown'}`,
    `Handoff type: booking_inquiry`,
    `---`,
    `Dates: ${d.desired_dates ?? '—'}`,
    `Guests: ${d.guest_count   ?? '—'}`,
    `Property/City: ${d.property_ref ?? '—'}`,
    `Language: ${d.lang_hint   ?? '—'}`,
    `---`,
    `Original note: ${d.freeform_note ?? '—'}`,
  ].join('\n');
}

/**
 * Create a booking inquiry handoff record and notify the operator.
 * Idempotent: if handoff already exists for this flow, skips silently.
 * Never throws.
 */
export async function createBookingHandoff(flow: InquiryFlow): Promise<void> {
  // Idempotency: already handed off
  if (flow.handoffAt) {
    console.log(`[InquiryFlow] createBookingHandoff: already exists chatId=${flow.chatId}`);
    return;
  }

  const summary = buildHandoffSummary(flow);
  const now     = new Date();

  await upsertInquiryFlow({
    chatId:         flow.chatId,
    status:         InquiryFlowStatus.HandedOff,
    handoffType:    'booking_inquiry',
    handoffAt:      now,
    handoffSummary: summary,
  });

  // Deliver to operator via existing Telegram notification channel
  try {
    await sendTelegramMessage(summary);
  } catch (err) {
    console.warn(`[InquiryFlow] operator notification failed chatId=${flow.chatId}: ${String(err)}`);
  }

  if (flow.guestId) {
    appendTimelineEvent(
      flow.guestId,
      { type: 'inquiry_handoff', reason: 'booking_inquiry', ts: now },
      flow.chatId,
    ).catch(() => {});
  }

  console.log(`[InquiryFlow] Booking handoff created chatId=${flow.chatId}`);
}

// ─── Reservation bridge ───────────────────────────────────────────────────────

/**
 * Bridge an open inquiry to a matched reservation.
 * Called by the orchestrator when reservation.status === 'matched'.
 * Marks the inquiry as converted_to_reservation and links the stay-flow.
 * Never throws.
 */
export async function bridgeInquiryToReservation(
  chatId:        number,
  reservationId: string,
  guestId?:      string,
): Promise<void> {
  try {
    const flow = await getInquiryFlowByChatId(chatId);
    if (!flow) return;

    // Only bridge if not already converted or closed
    const doneStatuses: InquiryFlowStatus[] = [
      InquiryFlowStatus.ConvertedToReservation,
      InquiryFlowStatus.Closed,
    ];
    if (doneStatuses.includes(flow.inquiryStatus)) return;

    const now = new Date();
    await upsertInquiryFlow({
      chatId,
      status:               InquiryFlowStatus.ConvertedToReservation,
      linkedReservationId:  reservationId,
      convertedAt:          now,
    });

    // Initialize stay-flow (idempotent — on conflict preserves existing flow_status)
    upsertStayFlow({ reservationId, chatId, guestId }).catch(() => {});

    if (guestId) {
      appendTimelineEvent(
        guestId,
        { type: 'stay_flow_initialized', reservation_id: reservationId, ts: now },
        chatId,
      ).catch(() => {});

      appendTimelineEvent(
        guestId,
        { type: 'inquiry_converted', reason: `linked to reservation ${reservationId}`, ts: now },
        chatId,
      ).catch(() => {});
    }

    console.log(`[InquiryFlow] Bridged to reservation ${reservationId} chatId=${chatId}`);
  } catch (err) {
    console.error('[InquiryFlow] bridgeInquiryToReservation error:', String(err));
  }
}

// ─── Main entry point (called from orchestrator) ──────────────────────────────

/**
 * Manage the inquiry flow for an unmatched contact on each inbound turn.
 *
 * Steps:
 * 1. Get or create the inquiry flow for this chat.
 * 2. Skip if already in a terminal/converted state.
 * 3. Merge booking details from current message.
 * 4. If still new_contact: classify and set initial status.
 * 5. For booking inquiry path: check if ready for handoff.
 * 6. Persist all updates.
 *
 * Fire-and-forget safe — never throws.
 */
export async function manageInquiryFlow(params: {
  chatId:          number;
  guestId:         string;
  text:            string;
  lang:            string;
  intentResult:    IntentResult;
  messageCategory: string;
}): Promise<void> {
  const { chatId, guestId, text, lang, intentResult, messageCategory } = params;

  try {
    // 1. Get or create
    let flow = await getInquiryFlowByChatId(chatId);
    const isNew = !flow;

    if (isNew) {
      flow = await upsertInquiryFlow({
        chatId,
        guestId,
        status:         InquiryFlowStatus.NewContact,
        bookingDetails: {},
        intakeTurnCount: 0,
        lastInboundAt:  new Date(),
      });
    }

    if (!flow) return; // DB unavailable

    // 2. Skip terminal states
    const terminalStatuses: InquiryFlowStatus[] = [
      InquiryFlowStatus.ConvertedToReservation,
      InquiryFlowStatus.Closed,
      InquiryFlowStatus.HandedOff,
    ];
    if (terminalStatuses.includes(flow.inquiryStatus)) return;

    // 3. Merge booking details from current message
    const mergedDetails = mergeBookingDetails(text, flow.bookingDetails);
    mergedDetails.lang_hint = mergedDetails.lang_hint ?? lang;

    // 4. Classify if still new_contact
    let newStatus: InquiryFlowStatus = flow.inquiryStatus;
    let newTurnCount = flow.intakeTurnCount;

    if (flow.inquiryStatus === InquiryFlowStatus.NewContact) {
      const contactType = classifyFirstContact(intentResult, messageCategory);

      if (contactType === 'booking_inquiry') {
        newStatus = InquiryFlowStatus.CollectingDetails;
      } else if (contactType === 'support_issue') {
        // Support path — mark escalated for tracking; operator already notified by main escalation path
        newStatus = InquiryFlowStatus.Escalated;
      } else {
        newStatus = InquiryFlowStatus.GeneralQuestion;
      }
    }

    // 5. Booking inquiry multi-turn logic
    if (
      newStatus === InquiryFlowStatus.CollectingDetails ||
      newStatus === InquiryFlowStatus.AwaitingMissingDetails
    ) {
      newTurnCount += 1;

      if (isReadyForHandoff(mergedDetails, newTurnCount)) {
        newStatus = InquiryFlowStatus.ReadyForHandoff;
      } else {
        newStatus = InquiryFlowStatus.AwaitingMissingDetails;
      }
    }

    // 6. Persist
    const updated = await upsertInquiryFlow({
      chatId,
      guestId,
      status:         newStatus,
      bookingDetails: mergedDetails,
      intakeTurnCount: newTurnCount,
      lastInboundAt:  new Date(),
    });

    // 7. Create handoff when status has reached ready_for_handoff
    if (newStatus === InquiryFlowStatus.ReadyForHandoff && updated) {
      await createBookingHandoff(updated);
    }
  } catch (err) {
    console.error('[InquiryFlow] manageInquiryFlow error:', String(err));
  }
}
