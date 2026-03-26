/**
 * G5 — Durable conversation context persistence.
 *
 * Architecture (mirrors session-status.ts):
 *   L1 — in-memory Map is the fast synchronous store within a single
 *        request / process lifetime.  All existing callers (getContext,
 *        updateContext, updateBookingDraft, clearContext) continue to work
 *        synchronously with zero changes to call sites.
 *   L2 — Supabase tg_conversation_context table is the durable store.
 *        loadContextFromDB() hydrates L1 on cold start.
 *        persistContext()    writes L1 back to L2 after processing.
 *
 * Table DDL: see supabase/migrations/20260326000001_comms_phase2_tables.sql
 *
 * Graceful degradation: Supabase failures are logged but never abort
 * processing — the system always replies even when persistence fails.
 */

import { supabase } from '@/lib/supabase';
import { ConversationContext } from './types';

// ─── L1: In-memory store (unchanged API) ─────────────────────────────────────

const memoryStore = new Map<number, ConversationContext>();

export function getContext(chatId: number): ConversationContext {
  if (!memoryStore.has(chatId)) {
    memoryStore.set(chatId, { lastMessageAt: new Date() });
  }
  return memoryStore.get(chatId)!;
}

export function updateContext(
  chatId: number,
  updates: Partial<ConversationContext>,
): void {
  const ctx = getContext(chatId);
  memoryStore.set(chatId, { ...ctx, ...updates, lastMessageAt: new Date() });
}

export function updateBookingDraft(
  chatId: number,
  updates: Partial<NonNullable<ConversationContext['bookingDraft']>>,
): void {
  const ctx = getContext(chatId);
  const mergedSpecificRequests = Array.from(
    new Set([
      ...(ctx.bookingDraft?.specificRequests ?? []),
      ...(updates.specificRequests ?? []),
    ]),
  );

  memoryStore.set(chatId, {
    ...ctx,
    guestName: updates.guestName ?? ctx.guestName,
    bookingDraft: {
      ...ctx.bookingDraft,
      ...updates,
      specificRequests:
        mergedSpecificRequests.length > 0 ? mergedSpecificRequests : undefined,
    },
    lastMessageAt: new Date(),
  });
}

export function clearContext(chatId: number): void {
  memoryStore.delete(chatId);
}

// ─── L2: Supabase persistence ─────────────────────────────────────────────────

/**
 * Load conversation context from Supabase and hydrate the in-memory store.
 * Call this early in processMessage (after chatId is resolved) so that
 * getContext() returns the persisted state, not a fresh empty object.
 *
 * No-op if the chatId is already in the in-memory store (warm invocation).
 */
export async function loadContextFromDB(chatId: number): Promise<void> {
  if (memoryStore.has(chatId)) return; // Already cached in this process

  try {
    const { data, error } = await supabase
      .from('tg_conversation_context')
      .select('*')
      .eq('chat_id', chatId)
      .maybeSingle();

    if (!error && data) {
      const row = data as Record<string, unknown>;
      memoryStore.set(chatId, {
        lastIntent:    (row.last_intent    as ConversationContext['lastIntent']) ?? undefined,
        guestName:     (row.guest_name     as string)                           ?? undefined,
        reservationId: (row.reservation_id as string)                           ?? undefined,
        bookingDraft:  (row.booking_draft  as ConversationContext['bookingDraft']) ?? undefined,
        lastMessageAt: row.last_message_at
          ? new Date(row.last_message_at as string)
          : new Date(),
      });
    }
  } catch {
    // Supabase unavailable — proceed with a fresh context; processing continues
  }
}

/**
 * Write the current in-memory context for chatId to Supabase.
 * Call this after all context updates are complete (end of processMessage).
 * Fire-and-forget friendly — never throws.
 */
export async function persistContext(chatId: number): Promise<void> {
  const ctx = memoryStore.get(chatId);
  if (!ctx) return;

  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tg_conversation_context')
      .upsert(
        {
          chat_id:          chatId,
          last_intent:      ctx.lastIntent      ?? null,
          guest_name:       ctx.guestName       ?? null,
          reservation_id:   ctx.reservationId   ?? null,
          booking_draft:    ctx.bookingDraft     ?? null,
          last_message_at:  ctx.lastMessageAt.toISOString(),
          updated_at:       now,
        },
        { onConflict: 'chat_id', ignoreDuplicates: false },
      );

    if (error) {
      console.warn(
        `[Memory] persistContext failed chatId=${chatId}: ${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `[Memory] persistContext exception chatId=${chatId}: ${String(err)}`,
    );
  }
}
