/**
 * Human Handoff & Approval Layer (ASSISTED Mode)
 *
 * Implements three handoff modes:
 *   AUTO     — AI sends immediately (default, current behaviour)
 *   ASSISTED — AI drafts a message; operator must approve/edit/reject before send
 *   MANUAL   — AI pauses entirely; operator writes and sends manually
 *
 * Conversation Locking:
 *   When an operator is actively handling a conversation, the AI must not
 *   generate or send any automatic replies to prevent double-replies.
 *   Lock acquisition is optimistic (in-memory); DB is the fallback for
 *   cross-process consistency.
 *
 * DB tables required:
 *   pending_messages  — stores AI drafts awaiting operator action
 *   (see SQL migration)
 *
 * API routes that consume this:
 *   POST /api/admin/approve-message
 *   POST /api/admin/reject-message
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import { PendingMessage, HandoffMode } from './types';

// ─── Conversation Lock ────────────────────────────────────────────────────────

/** In-memory lock store. Key = chatId. Value = operator session id. */
const activeLocks = new Map<number, { operatorId: string; lockedAt: Date }>();

/** Maximum time an operator lock stays active without activity (10 min). */
const LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Acquire a lock for operator-active mode.
 * If a valid lock already exists for another operator, returns false.
 */
export function acquireLock(chatId: number, operatorId: string): boolean {
  const existing = activeLocks.get(chatId);
  const now = new Date();

  if (existing) {
    const expired = now.getTime() - existing.lockedAt.getTime() > LOCK_TTL_MS;
    if (!expired && existing.operatorId !== operatorId) {
      return false; // locked by someone else
    }
  }

  activeLocks.set(chatId, { operatorId, lockedAt: now });
  return true;
}

/** Release an operator lock. */
export function releaseLock(chatId: number, operatorId?: string): void {
  const existing = activeLocks.get(chatId);
  if (!existing) return;
  if (operatorId && existing.operatorId !== operatorId) return;
  activeLocks.delete(chatId);
}

/**
 * Check if a conversation is currently locked to an operator.
 * Expired locks are cleaned up lazily.
 */
export function isConversationLocked(chatId: number): boolean {
  const lock = activeLocks.get(chatId);
  if (!lock) return false;

  const expired = Date.now() - lock.lockedAt.getTime() > LOCK_TTL_MS;
  if (expired) {
    activeLocks.delete(chatId);
    return false;
  }

  return true;
}

// ─── Pending Message Store ────────────────────────────────────────────────────

/**
 * Create a pending message (AI draft awaiting operator approval).
 * Persists to Supabase and returns the pendingId.
 */
export async function createPendingMessage(params: {
  chatId: number;
  conversationId?: string;
  draftText: string;
  context: string;
}): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const record: PendingMessage = {
    id,
    chatId: params.chatId,
    conversationId: params.conversationId,
    draftText: params.draftText,
    context: params.context,
    status: 'pending',
    createdAt: now,
  };

  try {
    await supabase.from('pending_messages').insert({
      id:              record.id,
      chat_id:         record.chatId,
      conversation_id: record.conversationId ?? null,
      draft_text:      record.draftText,
      context:         record.context,
      status:          record.status,
      created_at:      record.createdAt,
    });
  } catch (err) {
    console.warn('[Approval] Failed to persist pending message:', err);
  }

  return id;
}

/**
 * Load a pending message by ID. Returns null if not found.
 */
export async function getPendingMessage(id: string): Promise<PendingMessage | null> {
  try {
    const { data, error } = await supabase
      .from('pending_messages')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return rowToPending(data);
  } catch {
    return null;
  }
}

/**
 * Approve a pending message as-is.
 * Marks it as 'approved' — caller is responsible for actually sending it.
 * Returns the draft text.
 */
export async function approvePendingMessage(id: string): Promise<string | null> {
  const pending = await getPendingMessage(id);
  if (!pending || pending.status !== 'pending') return null;

  await updatePendingStatus(id, 'approved');
  return pending.draftText;
}

/**
 * Edit and approve a pending message.
 * Returns the edited text that should be sent.
 */
export async function editAndApprovePendingMessage(
  id: string,
  editedText: string,
): Promise<string | null> {
  const pending = await getPendingMessage(id);
  if (!pending || pending.status !== 'pending') return null;

  try {
    await supabase
      .from('pending_messages')
      .update({
        draft_text:   editedText,
        status:       'approved',
        resolved_at:  new Date().toISOString(),
      })
      .eq('id', id);
  } catch (err) {
    console.warn('[Approval] Failed to edit+approve pending message:', err);
  }

  return editedText;
}

/**
 * Reject a pending message. AI draft is discarded.
 */
export async function rejectPendingMessage(id: string): Promise<void> {
  await updatePendingStatus(id, 'rejected');
}

/**
 * Mark a pending message as sent (after delivery confirms it went out).
 */
export async function markPendingMessageSent(id: string): Promise<void> {
  await updatePendingStatus(id, 'sent');
}

/**
 * List all pending (unresolved) messages for a chat.
 */
export async function listPendingMessages(chatId: number): Promise<PendingMessage[]> {
  try {
    const { data } = await supabase
      .from('pending_messages')
      .select('*')
      .eq('chat_id', chatId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    return (data ?? []).map(rowToPending);
  } catch {
    return [];
  }
}

// ─── Handoff Mode Resolution ───────────────────────────────────────────────────

/**
 * Determine which handoff mode applies for a given conversation.
 * Currently reads from env; can be extended to per-operator or per-property config.
 */
export function resolveHandoffMode(): HandoffMode {
  const mode = process.env.HANDOFF_MODE as HandoffMode | undefined;
  if (mode === 'ASSISTED' || mode === 'MANUAL') return mode;
  return 'AUTO';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updatePendingStatus(
  id: string,
  status: PendingMessage['status'],
): Promise<void> {
  try {
    await supabase
      .from('pending_messages')
      .update({ status, resolved_at: new Date().toISOString() })
      .eq('id', id);
  } catch (err) {
    console.warn(`[Approval] Failed to update pending message ${id} → ${status}:`, err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPending(row: any): PendingMessage {
  return {
    id:             row.id,
    chatId:         row.chat_id,
    conversationId: row.conversation_id ?? undefined,
    draftText:      row.draft_text,
    context:        row.context,
    status:         row.status,
    createdAt:      row.created_at,
    resolvedAt:     row.resolved_at ?? undefined,
  };
}
