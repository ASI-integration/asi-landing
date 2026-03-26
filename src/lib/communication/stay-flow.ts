/**
 * Guest Stay Flow — minimal vertical slice for a pilot hospitality workflow.
 *
 * State machine:
 *   reservation_linked → pre_checkin_sent → in_stay → checkout_sent → followup_sent → closed
 *                              ↓                ↓
 *                          escalated (from any active state on issue/access signal)
 *
 * Persisted in: tg_stay_flows (migration 20260326000002_stay_flow_table.sql)
 *
 * Advance rules are driven by the cron runner at:
 *   src/app/api/cron/advance-stay-flows/route.ts
 *
 * Inbound bridge is called by the orchestrator after processing each message:
 *   transitionFlowOnEscalation — when an escalation event is created
 *   transitionFlowOnGuestReply — for benign guest replies (pre_checkin_sent → in_stay)
 *
 * Graceful degradation: all Supabase operations catch errors and never throw
 * so that stay-flow state never blocks the inbound processing path.
 */

import { supabase } from '@/lib/supabase';
import { replyToTelegram } from '@/lib/telegram';
import { getGroundedKnowledge } from './knowledge';
import { appendTimelineEvent } from './timeline';

// ─── Status constants ─────────────────────────────────────────────────────────

export const StayFlowStatus = {
  ReservationLinked: 'reservation_linked',
  PreCheckinSent:    'pre_checkin_sent',
  InStay:            'in_stay',
  Escalated:         'escalated',
  CheckoutSent:      'checkout_sent',
  FollowupSent:      'followup_sent',
  Closed:            'closed',
} as const;

export type StayFlowStatus = (typeof StayFlowStatus)[keyof typeof StayFlowStatus];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StayFlow {
  id:                string;
  reservationId:     string;
  chatId?:           number;
  guestId?:          string;
  propertyId?:       string;
  flowStatus:        StayFlowStatus;
  checkinDate?:      string;    // YYYY-MM-DD
  checkoutDate?:     string;    // YYYY-MM-DD
  preCheckinSentAt?: Date;
  checkoutSentAt?:   Date;
  followupSentAt?:   Date;
  createdAt:         Date;
  updatedAt:         Date;
}

// ─── Row → domain mapper ──────────────────────────────────────────────────────

function rowToFlow(row: Record<string, unknown>): StayFlow {
  return {
    id:                row.id              as string,
    reservationId:     row.reservation_id  as string,
    chatId:            row.chat_id         != null ? Number(row.chat_id) : undefined,
    guestId:           row.guest_id        as string | undefined,
    propertyId:        row.property_id     as string | undefined,
    flowStatus:        row.flow_status     as StayFlowStatus,
    checkinDate:       row.checkin_date    as string | undefined,
    checkoutDate:      row.checkout_date   as string | undefined,
    preCheckinSentAt:  row.pre_checkin_sent_at ? new Date(row.pre_checkin_sent_at as string) : undefined,
    checkoutSentAt:    row.checkout_sent_at    ? new Date(row.checkout_sent_at    as string) : undefined,
    followupSentAt:    row.followup_sent_at    ? new Date(row.followup_sent_at    as string) : undefined,
    createdAt:         new Date(row.created_at as string),
    updatedAt:         new Date(row.updated_at as string),
  };
}

// ─── DB: Upsert / create ──────────────────────────────────────────────────────

/**
 * Create or update a stay flow row for the given reservation.
 * If a row already exists for reservationId, non-null fields are updated.
 * The flow_status is NOT overwritten on conflict so it cannot be reset by re-upserting.
 */
export async function upsertStayFlow(params: {
  reservationId: string;
  chatId?:       number;
  guestId?:      string;
  propertyId?:   string;
  checkinDate?:  string;
  checkoutDate?: string;
}): Promise<StayFlow | null> {
  try {
    const now = new Date().toISOString();
    // INSERT or UPDATE — on conflict keep existing flow_status untouched.
    const { error } = await supabase
      .from('tg_stay_flows')
      .upsert(
        {
          reservation_id: params.reservationId,
          chat_id:        params.chatId       ?? null,
          guest_id:       params.guestId      ?? null,
          property_id:    params.propertyId   ?? null,
          checkin_date:   params.checkinDate  ?? null,
          checkout_date:  params.checkoutDate ?? null,
          updated_at:     now,
        },
        { onConflict: 'reservation_id', ignoreDuplicates: false },
      );

    if (error) {
      console.error('[StayFlow] upsertStayFlow failed:', error.message);
      return null;
    }

    // Fetch the persisted row so callers always get the DB-resolved state.
    return getStayFlowByReservationId(params.reservationId);
  } catch (err) {
    console.error('[StayFlow] upsertStayFlow exception:', String(err));
    return null;
  }
}

// ─── DB: Status transition ────────────────────────────────────────────────────

export async function updateFlowStatus(
  flowId: string,
  status: StayFlowStatus,
  extra?: {
    preCheckinSentAt?: Date;
    checkoutSentAt?:   Date;
    followupSentAt?:   Date;
  },
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tg_stay_flows')
      .update({
        flow_status:            status,
        flow_status_updated_at: now,
        updated_at:             now,
        ...(extra?.preCheckinSentAt ? { pre_checkin_sent_at: extra.preCheckinSentAt.toISOString() } : {}),
        ...(extra?.checkoutSentAt   ? { checkout_sent_at:   extra.checkoutSentAt.toISOString()   } : {}),
        ...(extra?.followupSentAt   ? { followup_sent_at:   extra.followupSentAt.toISOString()   } : {}),
      })
      .eq('id', flowId);

    if (error) console.error('[StayFlow] updateFlowStatus failed:', error.message);
  } catch (err) {
    console.error('[StayFlow] updateFlowStatus exception:', String(err));
  }
}

// ─── DB: Lookups ──────────────────────────────────────────────────────────────

/**
 * Find the most recent active (non-closed) stay flow for a chat.
 * Returns null if no active flow exists or on Supabase error.
 */
export async function getStayFlowByChatId(chatId: number): Promise<StayFlow | null> {
  try {
    const { data } = await supabase
      .from('tg_stay_flows')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    const flow = rowToFlow(data as Record<string, unknown>);
    // Treat closed/followup_sent as inactive — no further inbound transitions needed.
    if (flow.flowStatus === StayFlowStatus.Closed || flow.flowStatus === StayFlowStatus.FollowupSent) {
      return null;
    }
    return flow;
  } catch {
    return null;
  }
}

export async function getStayFlowByReservationId(reservationId: string): Promise<StayFlow | null> {
  try {
    const { data } = await supabase
      .from('tg_stay_flows')
      .select('*')
      .eq('reservation_id', reservationId)
      .maybeSingle();

    return data ? rowToFlow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─── DB: Runner queries ───────────────────────────────────────────────────────

/**
 * Flows ready for pre-check-in message: status = reservation_linked AND checkin_date
 * is within the next 2 days. chat_id must be set (guest already messaged in).
 */
export async function getDuePreCheckinFlows(): Promise<StayFlow[]> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 2);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const { data } = await supabase
      .from('tg_stay_flows')
      .select('*')
      .eq('flow_status', StayFlowStatus.ReservationLinked)
      .lte('checkin_date', cutoffStr);

    // Client-side filter: only flows with a known chat_id can receive a message.
    return (data ?? [])
      .map(row => rowToFlow(row as Record<string, unknown>))
      .filter(f => f.chatId != null);
  } catch {
    return [];
  }
}

/**
 * Flows in pre_checkin_sent where check-in date has already passed.
 * Advance these to in_stay without sending another message.
 */
export async function getStalePreCheckinFlows(): Promise<StayFlow[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('tg_stay_flows')
      .select('*')
      .eq('flow_status', StayFlowStatus.PreCheckinSent)
      .lte('checkin_date', today);

    return (data ?? []).map(row => rowToFlow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/**
 * Flows ready for checkout message: status = in_stay AND checkout_date ≤ today.
 */
export async function getDueCheckoutFlows(): Promise<StayFlow[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('tg_stay_flows')
      .select('*')
      .eq('flow_status', StayFlowStatus.InStay)
      .lte('checkout_date', today);

    return (data ?? [])
      .map(row => rowToFlow(row as Record<string, unknown>))
      .filter(f => f.chatId != null);
  } catch {
    return [];
  }
}

/**
 * Flows ready for follow-up: status = checkout_sent AND checkout_date + 1 day ≤ today.
 */
export async function getDueFollowupFlows(): Promise<StayFlow[]> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoffStr = yesterday.toISOString().split('T')[0];

    const { data } = await supabase
      .from('tg_stay_flows')
      .select('*')
      .eq('flow_status', StayFlowStatus.CheckoutSent)
      .lte('checkout_date', cutoffStr);

    return (data ?? [])
      .map(row => rowToFlow(row as Record<string, unknown>))
      .filter(f => f.chatId != null);
  } catch {
    return [];
  }
}

// ─── Reservation data loader ──────────────────────────────────────────────────

interface ReservationRow {
  id:           string;
  guest_name?:  string;
  check_in?:    string;
  check_out?:   string;
  property_id?: string;
}

async function loadReservationById(reservationId: string): Promise<ReservationRow | null> {
  try {
    const { data } = await supabase
      .from('tg_guest_reservations')
      .select('id, guest_name, check_in, check_out, property_id')
      .eq('id', reservationId)
      .maybeSingle();

    return data as ReservationRow | null;
  } catch {
    return null;
  }
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildPreCheckinMessage(params: {
  guestName:           string;
  checkinDate:         string;
  checkInInstructions: string;
  wifiInstructions:    string;
  houseRules:          string;
}): string {
  return [
    `Hi ${params.guestName || 'there'}! 👋`,
    ``,
    `Your check-in is on ${params.checkinDate}. Here's everything you need:`,
    ``,
    `🔑 How to check in:`,
    params.checkInInstructions,
    ``,
    `📶 WiFi:`,
    params.wifiInstructions,
    ``,
    `📋 House rules:`,
    params.houseRules,
    ``,
    `Feel free to reply here if you have questions. See you soon! 🙏`,
  ].join('\n');
}

function buildCheckoutMessage(params: {
  guestName:            string;
  checkOutInstructions: string;
}): string {
  return [
    `Hi ${params.guestName || 'there'}! 👋`,
    ``,
    `Just a reminder — it's checkout day today.`,
    ``,
    `🔑 Checkout instructions:`,
    params.checkOutInstructions,
    ``,
    `Thank you for staying with us! We hope you had a wonderful time. 🙏`,
  ].join('\n');
}

function buildFollowupMessage(guestName: string): string {
  return [
    `Hi ${guestName || 'there'}! 😊`,
    ``,
    `Thank you for your recent stay! We hope everything went smoothly.`,
    ``,
    `We'd really appreciate a brief review — your feedback helps us improve for all guests.`,
    ``,
    `If you have any comments or concerns, please don't hesitate to reply here. 🙏`,
  ].join('\n');
}

// ─── Message senders ──────────────────────────────────────────────────────────

export async function sendPreCheckinMessage(flow: StayFlow): Promise<boolean> {
  if (!flow.chatId) return false;

  const reservation = await loadReservationById(flow.reservationId);
  const knowledge   = await getGroundedKnowledge(flow.propertyId);

  const text = buildPreCheckinMessage({
    guestName:           reservation?.guest_name      ?? '',
    checkinDate:         flow.checkinDate ?? reservation?.check_in ?? 'your upcoming check-in date',
    checkInInstructions: knowledge.checkInInstructions  ?? 'Information unavailable.',
    wifiInstructions:    knowledge.wifiInstructions      ?? 'Information unavailable.',
    houseRules:          knowledge.houseRules            ?? 'Information unavailable.',
  });

  return replyToTelegram(flow.chatId, text);
}

export async function sendCheckoutMessage(flow: StayFlow): Promise<boolean> {
  if (!flow.chatId) return false;

  const reservation = await loadReservationById(flow.reservationId);
  const knowledge   = await getGroundedKnowledge(flow.propertyId);

  const text = buildCheckoutMessage({
    guestName:            reservation?.guest_name        ?? '',
    checkOutInstructions: knowledge.checkOutInstructions ?? 'Information unavailable.',
  });

  return replyToTelegram(flow.chatId, text);
}

export async function sendFollowupMessage(flow: StayFlow): Promise<boolean> {
  if (!flow.chatId) return false;

  const reservation = await loadReservationById(flow.reservationId);
  const text = buildFollowupMessage(reservation?.guest_name ?? '');

  return replyToTelegram(flow.chatId, text);
}

// ─── Advance functions (idempotent) ──────────────────────────────────────────

/**
 * Send pre-check-in message and advance flow to pre_checkin_sent.
 * Guard: pre_checkin_sent_at being set means the message was already sent —
 * calling this again is safe and produces no duplicate outbound message.
 */
export async function advancePreCheckin(flow: StayFlow): Promise<void> {
  if (flow.preCheckinSentAt) {
    // Already sent on a previous runner invocation — skip silently.
    console.log(`[StayFlow] advancePreCheckin: already sent, skipping flowId=${flow.id}`);
    return;
  }

  const sent = await sendPreCheckinMessage(flow);
  if (!sent) {
    console.error(`[StayFlow] advancePreCheckin: delivery failed for flowId=${flow.id}`);
    return;
  }

  const now = new Date();
  await updateFlowStatus(flow.id, StayFlowStatus.PreCheckinSent, { preCheckinSentAt: now });

  if (flow.guestId) {
    appendTimelineEvent(
      flow.guestId,
      { type: 'message_outbound', channel: 'telegram', content: 'pre_checkin_sent', ts: now },
      flow.chatId,
    ).catch(() => {});
  }

  console.log(`[StayFlow] Pre-checkin sent flowId=${flow.id} reservationId=${flow.reservationId}`);
}

/**
 * Advance a stale pre_checkin_sent flow to in_stay once check-in date has passed.
 * No outbound message — pure state catch-up.
 */
export async function advanceToInStay(flow: StayFlow): Promise<void> {
  await updateFlowStatus(flow.id, StayFlowStatus.InStay);
  console.log(`[StayFlow] Catch-up: advanced to in_stay flowId=${flow.id}`);
}

/**
 * Send checkout message and advance flow to checkout_sent.
 * Guard: checkout_sent_at being set means the message was already sent.
 */
export async function advanceCheckout(flow: StayFlow): Promise<void> {
  if (flow.checkoutSentAt) {
    console.log(`[StayFlow] advanceCheckout: already sent, skipping flowId=${flow.id}`);
    return;
  }

  const sent = await sendCheckoutMessage(flow);
  if (!sent) {
    console.error(`[StayFlow] advanceCheckout: delivery failed for flowId=${flow.id}`);
    return;
  }

  const now = new Date();
  await updateFlowStatus(flow.id, StayFlowStatus.CheckoutSent, { checkoutSentAt: now });

  if (flow.guestId) {
    appendTimelineEvent(
      flow.guestId,
      { type: 'message_outbound', channel: 'telegram', content: 'checkout_sent', ts: now },
      flow.chatId,
    ).catch(() => {});
  }

  console.log(`[StayFlow] Checkout message sent flowId=${flow.id}`);
}

/**
 * Send follow-up/review request and advance flow to followup_sent.
 * Guard: followup_sent_at being set means the message was already sent.
 */
export async function advanceFollowup(flow: StayFlow): Promise<void> {
  if (flow.followupSentAt) {
    console.log(`[StayFlow] advanceFollowup: already sent, skipping flowId=${flow.id}`);
    return;
  }

  const sent = await sendFollowupMessage(flow);
  if (!sent) {
    console.error(`[StayFlow] advanceFollowup: delivery failed for flowId=${flow.id}`);
    return;
  }

  const now = new Date();
  await updateFlowStatus(flow.id, StayFlowStatus.FollowupSent, { followupSentAt: now });

  if (flow.guestId) {
    appendTimelineEvent(
      flow.guestId,
      { type: 'message_outbound', channel: 'telegram', content: 'followup_sent', ts: now },
      flow.chatId,
    ).catch(() => {});
  }

  console.log(`[StayFlow] Follow-up sent flowId=${flow.id}`);
}

// ─── Inbound flow bridge ──────────────────────────────────────────────────────

/**
 * Called by the orchestrator when an escalation event is created.
 * Transitions the active stay flow to 'escalated' so the runner skips it
 * and the operator knows the flow is in a blocked state.
 *
 * Fire-and-forget — never throws.
 */
export async function transitionFlowOnEscalation(chatId: number): Promise<void> {
  try {
    const flow = await getStayFlowByChatId(chatId);
    if (!flow) return;

    // Only transition from active non-escalated states.
    const activeStates: StayFlowStatus[] = [
      StayFlowStatus.ReservationLinked,
      StayFlowStatus.PreCheckinSent,
      StayFlowStatus.InStay,
    ];
    if (!activeStates.includes(flow.flowStatus)) return;

    await updateFlowStatus(flow.id, StayFlowStatus.Escalated);
    console.log(`[StayFlow] Escalated flowId=${flow.id} chatId=${chatId}`);
  } catch (err) {
    console.error('[StayFlow] transitionFlowOnEscalation error:', String(err));
  }
}

/**
 * Called by the orchestrator after a benign (non-escalation) inbound reply.
 *
 * Transition: pre_checkin_sent → in_stay when the guest replies normally,
 * indicating they have received the pre-check-in information.
 *
 * Does NOT promote issue/booking-complaint categories to in_stay.
 *
 * Fire-and-forget — never throws.
 */
export async function transitionFlowOnGuestReply(
  chatId:   number,
  category: string,
): Promise<void> {
  try {
    const flow = await getStayFlowByChatId(chatId);
    if (!flow) return;
    if (flow.flowStatus !== StayFlowStatus.PreCheckinSent) return;

    // Issue / urgent access replies should escalate, not promote to in_stay.
    // The orchestrator already handles escalation for those — we only promote
    // on genuinely benign categories.
    const issueCategories = ['issue']; // MessageCategory.Issue value
    if (issueCategories.includes(category)) return;

    await updateFlowStatus(flow.id, StayFlowStatus.InStay);
    console.log(`[StayFlow] Guest reply in pre_checkin_sent → in_stay chatId=${chatId}`);
  } catch (err) {
    console.error('[StayFlow] transitionFlowOnGuestReply error:', String(err));
  }
}
