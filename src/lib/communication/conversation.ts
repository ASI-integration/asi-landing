/**
 * Conversation Entity Management
 *
 * Central domain object for a guest-facing conversation thread.
 * Backed by Supabase `tg_conversations` table; in-memory cache for hot reads.
 *
 * Responsibilities:
 *   - Create / load a Conversation by (chatId, channel)
 *   - Transition ConversationState via deterministic rules
 *   - Link business entities (contactId, leadId, reservationId, propertyId)
 *   - Expose a linkable surface for the integration-event bus
 *
 * Graceful degradation: Supabase errors are swallowed so that Conversation
 * management never blocks message processing.
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import { runInBackground } from './background';
import {
  Conversation,
  ConversationState,
  CommunicationChannel,
} from './types';

// ─── In-Memory Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, Conversation>(); // key = `${channel}:${chatId}`

function cacheKey(channel: string, chatId: string | number): string {
  return `${channel}:${chatId}`;
}

// ─── State Transition Table ───────────────────────────────────────────────────

const STATE_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  [ConversationState.New]:              [ConversationState.Qualifying, ConversationState.NeedsOperator],
  [ConversationState.Qualifying]:       [ConversationState.AwaitingResponse, ConversationState.Engaged, ConversationState.NeedsOperator],
  [ConversationState.AwaitingResponse]: [ConversationState.Engaged, ConversationState.NeedsOperator, ConversationState.Dropped],
  [ConversationState.Engaged]:          [ConversationState.AwaitingResponse, ConversationState.Converted, ConversationState.NeedsOperator, ConversationState.Dropped],
  [ConversationState.NeedsOperator]:    [ConversationState.Engaged, ConversationState.Dropped],
  [ConversationState.Converted]:        [],
  [ConversationState.Dropped]:          [ConversationState.New],
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load an existing Conversation for this channel+chatId, or create one.
 * Uses in-memory cache first; falls back to Supabase; creates if missing.
 */
export async function getOrCreateConversation(
  channel: CommunicationChannel,
  chatId: string | number,
  contactId: string,
): Promise<Conversation> {
  const key = cacheKey(channel, chatId);
  const cached = cache.get(key);
  if (cached) return cached;

  // Try Supabase
  try {
    const { data } = await supabase
      .from('tg_conversations')
      .select('*')
      .eq('channel', channel)
      .eq('chat_id', String(chatId))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const conv = rowToConversation(data);
      cache.set(key, conv);
      return conv;
    }
  } catch {
    // DB unreachable — fall through to create in-memory
  }

  return createConversation(channel, chatId, contactId);
}

/**
 * Forcibly create a new Conversation record (e.g. when a new booking starts).
 */
export async function createConversation(
  channel: CommunicationChannel,
  chatId: string | number,
  contactId: string,
): Promise<Conversation> {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: randomUUID(),
    channel,
    contactId,
    status: 'active',
    currentState: ConversationState.New,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };

  cache.set(cacheKey(channel, chatId), conv);

  try {
    await supabase.from('tg_conversations').insert({
      id: conv.id,
      channel: conv.channel,
      chat_id: String(chatId),
      contact_id: conv.contactId,
      status: conv.status,
      current_state: conv.currentState,
      last_message_at: conv.lastMessageAt,
      created_at: conv.createdAt,
      updated_at: conv.updatedAt,
    });
  } catch {
    // Best-effort — in-memory record is authoritative for this process lifetime
  }

  return conv;
}

/**
 * Transition a Conversation to a new ConversationState.
 * Invalid transitions are silently skipped with a warning.
 */
export async function transitionConversationState(
  conv: Conversation,
  newState: ConversationState,
): Promise<Conversation> {
  if (conv.currentState === newState) return conv;

  const allowed = STATE_TRANSITIONS[conv.currentState];
  if (!allowed.includes(newState)) {
    console.warn(
      `[Conversation] Invalid state transition ${conv.currentState} → ${newState} ` +
      `for conversation ${conv.id} — skipped`,
    );
    return conv;
  }

  const now = new Date().toISOString();
  const updated: Conversation = {
    ...conv,
    currentState: newState,
    updatedAt: now,
    status: newState === ConversationState.NeedsOperator ? 'escalated'
          : newState === ConversationState.Converted    ? 'closed'
          : newState === ConversationState.Dropped      ? 'closed'
          : 'active',
  };

  // Update cache
  for (const [k, v] of Array.from(cache.entries())) {
    if (v.id === conv.id) cache.set(k, updated);
  }

  // Persist (best-effort)
  supabase
    .from('tg_conversations')
    .update({
      current_state: updated.currentState,
      status: updated.status,
      updated_at: now,
    })
    .eq('id', conv.id)
    .then(({ error }) => { if (error) console.error(`[Conversation] Supabase state update failed: ${error.message}`); });

  return updated;
}

/**
 * Link business entities to an existing Conversation.
 * Merges; only updates fields that are provided.
 */
export async function linkEntities(
  conv: Conversation,
  entities: {
    leadId?: string;
    reservationId?: string;
    propertyId?: string;
  },
): Promise<Conversation> {
  const now = new Date().toISOString();
  const updated: Conversation = {
    ...conv,
    ...entities,
    updatedAt: now,
  };

  // Update cache
  for (const [k, v] of Array.from(cache.entries())) {
    if (v.id === conv.id) cache.set(k, updated);
  }

  // Persist (best-effort)
  const patch: Record<string, string | undefined> = { updated_at: now };
  if (entities.leadId)        patch.lead_id        = entities.leadId;
  if (entities.reservationId) patch.reservation_id = entities.reservationId;
  if (entities.propertyId)    patch.property_id    = entities.propertyId;

  supabase
    .from('tg_conversations')
    .update(patch)
    .eq('id', conv.id)
    .then(({ error }) => { if (error) console.error(`[Conversation] linkEntities Supabase error: ${error.message}`); });

  return updated;
}

/**
 * Touch lastMessageAt on a conversation (fire-and-forget).
 */
export function touchConversation(conv: Conversation): Conversation {
  const now = new Date().toISOString();
  const updated = { ...conv, lastMessageAt: now, updatedAt: now };
  for (const [k, v] of Array.from(cache.entries())) {
    if (v.id === conv.id) cache.set(k, updated);
  }
  runInBackground(
    { correlationId: conv.id, module: 'conversation', taskName: 'touchConversation', triggerId: conv.id },
    async () => {
      await supabase
        .from('tg_conversations')
        .update({ last_message_at: now, updated_at: now })
        .eq('id', conv.id);
    },
  );
  return updated;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToConversation(row: any): Conversation {
  return {
    id:             row.id,
    channel:        row.channel,
    contactId:      row.contact_id,
    leadId:         row.lead_id ?? undefined,
    reservationId:  row.reservation_id ?? undefined,
    propertyId:     row.property_id ?? undefined,
    status:         row.status ?? 'active',
    currentState:   (row.current_state as ConversationState) ?? ConversationState.New,
    lastMessageAt:  row.last_message_at,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}
