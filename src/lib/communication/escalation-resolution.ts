/**
 * Operator escalation resolution — minimal admin path.
 *
 * Resolves an escalation event and optionally resumes or closes the
 * associated stay flow.  Idempotent: calling resolve on an already-resolved
 * event returns { ok: true, alreadyResolved: true } with no side effects.
 *
 * Three actions:
 *   resolve_and_resume    — mark resolved + advance stay flow to safest next state
 *   resolve_only          — mark resolved, leave stay flow in escalated state
 *   close_without_resume  — mark resolved + set stay flow to closed
 *
 * Called from: POST /api/admin/resolve-escalation
 */

import { supabase } from '@/lib/supabase';
import { appendTimelineEvent } from './timeline';
import { StayFlowStatus, updateFlowStatus } from './stay-flow';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolutionAction =
  | 'resolve_and_resume'
  | 'resolve_only'
  | 'close_without_resume';

export const VALID_RESOLUTION_ACTIONS: ResolutionAction[] = [
  'resolve_and_resume',
  'resolve_only',
  'close_without_resume',
];

export interface ResolveEscalationParams {
  /** Direct lookup by PK. Takes precedence over chatId. */
  escalationEventId?: string;
  /** Fallback: resolves the most recent unresolved escalation for this chat. */
  chatId?: number;
  action: ResolutionAction;
  operatorNote?: string;
  resolvedBy?: string;
}

export interface ResolveEscalationResult {
  ok: boolean;
  alreadyResolved?: boolean;
  escalationEventId?: string;
  resumedStatus?: string;
  error?: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface EscalationRow {
  id:          string;
  chat_id:     number;
  reason:      string;
  summary?:    string;
  resolved_at: string | null;
}

interface StayFlowRow {
  id:                  string;
  chat_id:             number | null;
  guest_id:            string | null;
  flow_status:         string;
  checkin_date:        string | null;
  checkout_date:       string | null;
  pre_checkin_sent_at: string | null;
}

// ─── DB: escalation lookup ────────────────────────────────────────────────────

async function findEscalationEvent(
  escalationEventId?: string,
  chatId?: number,
): Promise<EscalationRow | null> {
  try {
    if (escalationEventId) {
      const { data } = await supabase
        .from('tg_escalation_events')
        .select('id, chat_id, reason, summary, resolved_at')
        .eq('id', escalationEventId)
        .maybeSingle();
      return data as EscalationRow | null;
    }

    if (chatId != null) {
      const { data } = await supabase
        .from('tg_escalation_events')
        .select('id, chat_id, reason, summary, resolved_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as EscalationRow | null;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── DB: mark escalation resolved ────────────────────────────────────────────

async function markEscalationResolved(
  eventId:      string,
  action:       ResolutionAction,
  operatorNote?: string,
  resolvedBy?:  string,
): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tg_escalation_events')
      .update({
        resolved_at:       now,
        resolved_by:       resolvedBy   ?? null,
        resolution_action: action,
        operator_note:     operatorNote ?? null,
      })
      .eq('id', eventId);

    if (error) {
      console.error('[EscalationResolution] markEscalationResolved failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[EscalationResolution] markEscalationResolved exception:', String(err));
    return false;
  }
}

// ─── DB: stay flow lookup (includes escalated status) ────────────────────────

async function getEscalatedFlowByChatId(chatId: number): Promise<StayFlowRow | null> {
  try {
    const { data } = await supabase
      .from('tg_stay_flows')
      .select('id, chat_id, guest_id, flow_status, checkin_date, checkout_date, pre_checkin_sent_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    const row = data as StayFlowRow;
    // Only return the flow if it is actually in escalated state.
    return row.flow_status === StayFlowStatus.Escalated ? row : null;
  } catch {
    return null;
  }
}

// ─── Resume state determination ───────────────────────────────────────────────

/**
 * Determine the safest next state for a stay flow resuming from escalated.
 * Uses checkin/checkout dates and sent-at timestamps to reconstruct where
 * the flow was before escalation without storing the prior state explicitly.
 */
function determineResumeStatus(flow: StayFlowRow): StayFlowStatus {
  const today = new Date().toISOString().split('T')[0];

  if (!flow.checkin_date) {
    // No date context — land at reservation_linked so the cron will advance it.
    return StayFlowStatus.ReservationLinked;
  }

  if (today < flow.checkin_date) {
    // Still before check-in.
    return flow.pre_checkin_sent_at
      ? StayFlowStatus.PreCheckinSent
      : StayFlowStatus.ReservationLinked;
  }

  // Check-in date has arrived or passed — in_stay is the correct current state.
  // If checkout is also past, the cron runner will advance to checkout_sent on
  // its next tick, which is the safe approach (do not jump blindly past in_stay).
  return StayFlowStatus.InStay;
}

// ─── Core: resolveEscalation ──────────────────────────────────────────────────

export async function resolveEscalation(
  params: ResolveEscalationParams,
): Promise<ResolveEscalationResult> {
  const { escalationEventId, chatId, action, operatorNote, resolvedBy } = params;

  // 1. Locate the escalation event.
  const event = await findEscalationEvent(escalationEventId, chatId);
  if (!event) {
    return { ok: false, error: 'Escalation event not found' };
  }

  // 2. Idempotency — already resolved; safe retry.
  if (event.resolved_at) {
    return { ok: true, alreadyResolved: true, escalationEventId: event.id };
  }

  // 3. Write durable resolution metadata to tg_escalation_events.
  const saved = await markEscalationResolved(event.id, action, operatorNote, resolvedBy);
  if (!saved) {
    return { ok: false, error: 'Failed to persist resolution' };
  }

  // 4. Apply stay-flow state change.
  const effectiveChatId = chatId ?? event.chat_id;
  let resumedStatus: string | undefined;

  if (action !== 'resolve_only' && effectiveChatId != null) {
    const flow = await getEscalatedFlowByChatId(effectiveChatId);

    if (flow) {
      if (action === 'resolve_and_resume') {
        const nextStatus = determineResumeStatus(flow);
        await updateFlowStatus(flow.id, nextStatus);
        resumedStatus = nextStatus;

        // Audit: escalation_resumed
        if (flow.guest_id) {
          appendTimelineEvent(
            flow.guest_id,
            { type: 'escalation_resumed', action, resumeStatus: nextStatus, ts: new Date() },
            effectiveChatId,
          ).catch(() => {});
        }
      } else {
        // close_without_resume — definitively close the flow.
        await updateFlowStatus(flow.id, StayFlowStatus.Closed);
        resumedStatus = StayFlowStatus.Closed;
      }
    }
  }

  // 5. Audit: escalation_resolved timeline event (best-effort).
  const guestId = `tg_${effectiveChatId}`;
  appendTimelineEvent(
    guestId,
    { type: 'escalation_resolved', action, note: operatorNote, ts: new Date() },
    effectiveChatId ?? undefined,
  ).catch(() => {});

  return { ok: true, escalationEventId: event.id, resumedStatus };
}
