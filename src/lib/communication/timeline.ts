/**
 * G4 — Durable timeline / history persistence.
 *
 * Replaces the in-memory timelineDB Map with Supabase tg_timeline_events
 * so the full conversation audit trail survives cold starts.
 *
 * Note: message_inbound / message_outbound turns are also persisted via
 * saveUserTurn / saveAssistantTurn in persistence.ts (tg_message_turns).
 * This table captures those same events plus non-message events (escalation,
 * payment_event, call_record) so the timeline is fully reconstructable from
 * a single table query per guest / chat.
 *
 * Table DDL: see supabase/migrations/20260326000001_comms_phase2_tables.sql
 */

import { supabase } from '@/lib/supabase';
import { CommunicationChannel, InboundMessageEnvelope, PhoneCallRecord } from './types';

export type TimelineEvent =
  | { type: 'message_inbound';  channel: CommunicationChannel; content: string; ts: Date }
  | { type: 'message_outbound'; channel: CommunicationChannel; content: string; ts: Date }
  | { type: 'call_record';      record:  PhoneCallRecord;       ts: Date }
  | { type: 'payment_event';    status:  string;                ts: Date }
  | { type: 'escalation';       reason:  string;                ts: Date };

export interface GlobalTimeline {
  guestId: string;
  events:  TimelineEvent[];
}

const MAX_CONTENT_LENGTH = 500;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a timeline event to tg_timeline_events.
 *
 * @param guestId  Stable guest identifier (e.g. 'tg_12345' for Telegram).
 * @param event    The event to record.
 * @param chatId   Optional numeric Telegram chat ID for indexed lookup.
 *
 * Graceful degradation: Supabase failures are silently swallowed so that
 * timeline persistence never blocks the processing flow.
 */
export async function appendTimelineEvent(
  guestId: string,
  event:   TimelineEvent,
  chatId?: number,
): Promise<void> {
  // Build a compact event_data payload — never store raw message bodies in full
  let eventData: Record<string, unknown>;

  if (event.type === 'message_inbound' || event.type === 'message_outbound') {
    eventData = {
      channel: event.channel,
      content: event.content.length > MAX_CONTENT_LENGTH
        ? event.content.slice(0, MAX_CONTENT_LENGTH) + '…'
        : event.content,
    };
  } else if (event.type === 'call_record') {
    eventData = {
      phoneNumber:   event.record.phoneNumber,
      direction:     event.record.direction,
      status:        event.record.status,
      reservationId: event.record.reservationId,
    };
  } else if (event.type === 'payment_event') {
    eventData = { status: event.status };
  } else {
    // escalation
    eventData = { reason: event.reason };
  }

  try {
    await supabase
      .from('tg_timeline_events')
      .insert({
        chat_id:    chatId  ?? null,
        guest_id:   guestId,
        event_type: event.type,
        event_data: eventData,
        created_at: event.ts.toISOString(),
      });
  } catch {
    // Best-effort — timeline persistence must never abort processing
  }
}

/**
 * Reconstruct the timeline for a guest from tg_timeline_events.
 * Returns events in chronological order (oldest first).
 */
export async function getTimeline(guestId: string): Promise<GlobalTimeline> {
  try {
    const { data, error } = await supabase
      .from('tg_timeline_events')
      .select('*')
      .eq('guest_id', guestId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      const events: TimelineEvent[] = (data as Record<string, unknown>[]).map(row => {
        const ed = (row.event_data ?? {}) as Record<string, unknown>;
        const ts = new Date(row.created_at as string);

        switch (row.event_type as string) {
          case 'message_inbound':
            return { type: 'message_inbound',  channel: ed.channel as CommunicationChannel, content: ed.content as string ?? '', ts };
          case 'message_outbound':
            return { type: 'message_outbound', channel: ed.channel as CommunicationChannel, content: ed.content as string ?? '', ts };
          case 'payment_event':
            return { type: 'payment_event', status: ed.status as string ?? '', ts };
          case 'escalation':
            return { type: 'escalation', reason: ed.reason as string ?? '', ts };
          default:
            return { type: 'escalation', reason: String(row.event_type), ts };
        }
      });

      return { guestId, events };
    }
  } catch {
    // Supabase unavailable — return empty
  }

  return { guestId, events: [] };
}
