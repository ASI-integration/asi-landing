import { supabase } from '@/lib/supabase';
import { auditLog } from './audit';
import { AuditEventType, MessageTurn, TelegramConversationSessionRow, TurnRole } from './types';

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
export async function loadSession(chatId: number): Promise<TelegramConversationSessionRow | null> {
  try {
    const { data, error } = await supabase
      .from('tg_conversation_sessions')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (error) return null;
    return data as TelegramConversationSessionRow;
  } catch {
    return null;
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
