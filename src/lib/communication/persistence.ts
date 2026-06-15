import { supabase } from '@/lib/supabase';
import * as fs from 'fs';
import * as path from 'path';
import { auditLog, maskedPreview } from './audit';
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
const isTest = process.env.NODE_ENV === 'test';
const stateDir =
  process.env.COMM_STATE_DIR ??
  process.env.CONVERSATION_SESSION_DIR ??
  process.env.SESSION_STORE_DIR ??
  process.env.STATE_DIR ??
  path.join(process.cwd(), '.asi-comm-state');
const decisionAuditPath = path.join(stateDir, 'asi-communication-autopilot-decisions.jsonl');

function truncateContent(text: string): string {
  return text.length <= MAX_CONTENT_LENGTH ? text : text.slice(0, MAX_CONTENT_LENGTH) + '…';
}

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * Upsert a conversation session row. Creates on first contact, updates
 * updated_at on subsequent messages.
 */
export async function upsertSession(chatId: number): Promise<void> {
  if (process.env.TELEGRAM_DRY_RUN === '1') return;
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
  if (process.env.TELEGRAM_DRY_RUN === '1') return null;
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
  if (process.env.TELEGRAM_DRY_RUN === '1') return;
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

export type CommunicationAutopilotStoredDecisionAction = 'auto_reply' | 'escalation' | 'blocked';

export type CommunicationAutopilotStoredDecision = {
  chat_id: number;
  update_id?: number;
  channel: string;
  intent: string;
  decision: CommunicationAutopilotStoredDecisionAction;
  confidence?: number;
  reason?: string | null;
  property_id?: string | null;
  booking_id?: string | null;
  missing_context?: string[];
  reply_preview?: string | null;
  created_at?: string;
};

function appendAutopilotDecisionJsonl(record: CommunicationAutopilotStoredDecision): void {
  if (isTest) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(decisionAuditPath, JSON.stringify(record) + '\n', 'utf-8');
  } catch {
    // best-effort; database/audit logs still carry the decision
  }
}

export async function saveCommunicationAutopilotDecision(
  decision: CommunicationAutopilotStoredDecision,
): Promise<void> {
  const record: CommunicationAutopilotStoredDecision = {
    ...decision,
    reply_preview: maskedPreview(decision.reply_preview ?? undefined, 300) ?? null,
    created_at: decision.created_at ?? new Date().toISOString(),
  };

  appendAutopilotDecisionJsonl(record);

  if (process.env.TELEGRAM_DRY_RUN === '1') return;
  try {
    const { error } = await supabase
      .from('communication_autopilot_decisions')
      .insert({
        chat_id: record.chat_id,
        update_id: record.update_id ?? null,
        channel: record.channel,
        intent: record.intent,
        decision: record.decision,
        confidence: record.confidence ?? null,
        reason: record.reason ?? null,
        property_id: record.property_id ?? null,
        booking_id: record.booking_id ?? null,
        missing_context: record.missing_context ?? [],
        reply_preview: record.reply_preview,
        created_at: record.created_at,
      });

    if (error) {
      auditLog({
        type: AuditEventType.PersistError,
        chat_id: record.chat_id,
        update_id: record.update_id,
        detail: `saveCommunicationAutopilotDecision: ${error.message}`,
      });
    }
  } catch (err) {
    auditLog({
      type: AuditEventType.PersistError,
      chat_id: record.chat_id,
      update_id: record.update_id,
      detail: `saveCommunicationAutopilotDecision exception: ${String(err)}`,
    });
  }
}
