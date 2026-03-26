import { supabase } from '@/lib/supabase';
import { auditLog } from './audit';
import { AuditEventType, ConversationSession, EscalationEvent, MessageTurn, TurnRole } from './types';

/**
 * Short-term conversation persistence.
 *
 * Tables expected in Supabase (see docs/telegram-communication-architecture.md
 * for DDL):
 *   - tg_conversation_sessions (chat_id PK, created_at, updated_at, guest_id?, property_id?)
 *   - tg_message_turns        (id uuid PK, chat_id, update_id?, role, content, category?, lang?, created_at)
 *
 * Graceful degradation: if the tables don't exist or Supabase is unavailable,
 * persistence errors are logged via the audit trail but do NOT abort message
 * processing.  The system always replies even when persistence fails.
 */

const MAX_CONTENT_LENGTH = 2000;

function truncateContent(text: string): string {
  return text.length <= MAX_CONTENT_LENGTH ? text : text.slice(0, MAX_CONTENT_LENGTH) + '…';
}

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * Upsert a conversation session row. Creates on first contact, updates
 * updated_at on subsequent messages.
 */
export async function upsertSession(chatId: number): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tg_conversation_sessions')
      .upsert(
        { chat_id: chatId, updated_at: now },
        { onConflict: 'chat_id', ignoreDuplicates: false },
      );

    if (error) {
      auditLog({
        type: AuditEventType.PersistError,
        chat_id: chatId,
        detail: `upsertSession: ${error.message}`,
      });
    }
  } catch (err) {
    auditLog({
      type: AuditEventType.PersistError,
      chat_id: chatId,
      detail: `upsertSession exception: ${String(err)}`,
    });
  }
}

/**
 * Load an existing session, or return null if not found.
 */
export async function loadSession(chatId: number): Promise<ConversationSession | null> {
  try {
    const { data, error } = await supabase
      .from('tg_conversation_sessions')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (error) return null;
    return data as ConversationSession;
  } catch {
    return null;
  }
}

/**
 * Load the N most recent message turns for a conversation, ordered oldest→newest.
 * Returns an empty array if the table doesn't exist or Supabase is unavailable.
 */
export async function loadRecentTurns(chatId: number, limit = 10): Promise<MessageTurn[]> {
  try {
    const { data, error } = await supabase
      .from('tg_message_turns')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    // Reverse so result is oldest→newest (natural conversation order)
    return (data as MessageTurn[]).reverse();
  } catch {
    return [];
  }
}

// ─── Message Turns ────────────────────────────────────────────────────────────

/**
 * Persist a single message turn (inbound or outbound).
 * Content is truncated to MAX_CONTENT_LENGTH before storage.
 */
export async function saveTurn(turn: Omit<MessageTurn, 'created_at'>): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tg_message_turns')
      .insert({
        chat_id: turn.chat_id,
        update_id: turn.update_id ?? null,
        role: turn.role,
        content: truncateContent(turn.content),
        category: turn.category ?? null,
        lang: turn.lang ?? null,
        created_at: now,
      });

    if (error) {
      auditLog({
        type: AuditEventType.PersistError,
        chat_id: turn.chat_id,
        detail: `saveTurn(${turn.role}): ${error.message}`,
      });
    }
  } catch (err) {
    auditLog({
      type: AuditEventType.PersistError,
      chat_id: turn.chat_id,
      detail: `saveTurn exception: ${String(err)}`,
    });
  }
}

/**
 * Convenience: save the user inbound turn.
 */
export async function saveUserTurn(params: {
  chat_id: number;
  update_id: number;
  text: string;
  category?: MessageTurn['category'];
  lang?: MessageTurn['lang'];
}): Promise<void> {
  return saveTurn({
    chat_id: params.chat_id,
    update_id: params.update_id,
    role: TurnRole.User,
    content: params.text,
    category: params.category,
    lang: params.lang,
  });
}

/**
 * Convenience: save the assistant outbound turn.
 */
export async function saveAssistantTurn(params: {
  chat_id: number;
  update_id?: number;
  reply: string;
  category?: MessageTurn['category'];
  lang?: MessageTurn['lang'];
}): Promise<void> {
  return saveTurn({
    chat_id: params.chat_id,
    update_id: params.update_id,
    role: TurnRole.Assistant,
    content: params.reply,
    category: params.category,
    lang: params.lang,
  });
}

// ─── Escalation Events ────────────────────────────────────────────────────────

/**
 * Persist an escalation event to tg_escalation_events.
 *
 * DDL (run once in Supabase):
 *   CREATE TABLE tg_escalation_events (
 *     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     chat_id     BIGINT NOT NULL,
 *     update_id   BIGINT,
 *     reason      TEXT NOT NULL,
 *     category    TEXT,
 *     summary     TEXT,
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * Graceful degradation: if the table doesn't exist, logs via audit trail
 * and does NOT abort processing.
 */
export async function saveEscalationEvent(event: EscalationEvent): Promise<void> {
  try {
    const { error } = await supabase
      .from('tg_escalation_events')
      .insert({
        chat_id: event.chat_id,
        update_id: event.update_id ?? null,
        reason: event.reason,
        category: event.category ?? null,
        summary: event.summary,
        created_at: event.created_at,
      });

    if (error) {
      auditLog({
        type: AuditEventType.PersistError,
        chat_id: event.chat_id,
        detail: `saveEscalationEvent: ${error.message}`,
      });
    }
  } catch (err) {
    auditLog({
      type: AuditEventType.PersistError,
      chat_id: event.chat_id,
      detail: `saveEscalationEvent exception: ${String(err)}`,
    });
  }
}

// ─── Outbound Delivery Failures ───────────────────────────────────────────────

/**
 * Record a failed outbound message delivery to tg_outbound_failures.
 *
 * DDL (run once in Supabase):
 *   CREATE TABLE tg_outbound_failures (
 *     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     chat_id      BIGINT NOT NULL,
 *     update_id    BIGINT,
 *     error_detail TEXT,
 *     retry_count  INT NOT NULL DEFAULT 0,
 *     created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     retried_at   TIMESTAMPTZ
 *   );
 *
 * Graceful degradation: logs via audit trail if table missing.
 */
export async function saveOutboundFailure(params: {
  chat_id: number;
  update_id?: number;
  error_detail: string;
}): Promise<void> {
  try {
    const { error } = await supabase
      .from('tg_outbound_failures')
      .insert({
        chat_id: params.chat_id,
        update_id: params.update_id ?? null,
        error_detail: params.error_detail,
        retry_count: 0,
        created_at: new Date().toISOString(),
      });

    if (error) {
      auditLog({
        type: AuditEventType.PersistError,
        chat_id: params.chat_id,
        detail: `saveOutboundFailure: ${error.message}`,
      });
    }
  } catch (err) {
    auditLog({
      type: AuditEventType.PersistError,
      chat_id: params.chat_id,
      detail: `saveOutboundFailure exception: ${String(err)}`,
    });
  }
}

/**
 * Mark an outbound failure as retried (increments retry_count, sets retried_at).
 * Matches on chat_id + update_id, updates the most recent failure record.
 */
export async function markOutboundRetried(params: {
  chat_id: number;
  update_id?: number;
}): Promise<void> {
  try {
    // Fetch the most recent failure for this chat/update
    const { data, error: fetchErr } = await supabase
      .from('tg_outbound_failures')
      .select('id, retry_count')
      .eq('chat_id', params.chat_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchErr || !data) return;

    await supabase
      .from('tg_outbound_failures')
      .update({
        retry_count: (data.retry_count ?? 0) + 1,
        retried_at: new Date().toISOString(),
      })
      .eq('id', data.id);
  } catch {
    // Best-effort — never block the retry attempt itself
  }
}

// ─── Session: guest/property linkage ─────────────────────────────────────────

/**
 * Write guest_id, property_id, and reservation_id onto a session row once a
 * reservation is matched.
 *
 * DDL: migration 20260322000001 (guest_id, property_id) +
 *      migration 20260326000001 (reservation_id)
 */
export async function linkSessionToReservation(params: {
  chat_id: number;
  guest_id?: string;
  property_id?: string;
  reservation_id?: string;
}): Promise<void> {
  if (!params.guest_id && !params.property_id && !params.reservation_id) return;
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tg_conversation_sessions')
      .upsert(
        {
          chat_id:        params.chat_id,
          guest_id:       params.guest_id       ?? null,
          property_id:    params.property_id    ?? null,
          reservation_id: params.reservation_id ?? null,
          updated_at:     now,
        },
        { onConflict: 'chat_id', ignoreDuplicates: false },
      );

    if (error) {
      auditLog({
        type: AuditEventType.PersistError,
        chat_id: params.chat_id,
        detail: `linkSessionToReservation: ${error.message}`,
      });
    }
  } catch (err) {
    auditLog({
      type: AuditEventType.PersistError,
      chat_id: params.chat_id,
      detail: `linkSessionToReservation exception: ${String(err)}`,
    });
  }
}
