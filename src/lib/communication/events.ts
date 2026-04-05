/**
 * Integration Event Bus
 *
 * Emits domain events that downstream contours can subscribe to:
 *   - pricing contour
 *   - ops contour
 *   - automation spine
 *
 * Events are persisted to Supabase `comm_events` (best-effort, fire-and-forget).
 * In-process observers can also register via `subscribe()` for synchronous fan-out.
 *
 * Guaranteed events emitted by the orchestrator:
 *   conversation.started      — first message from a new conversation
 *   message.received          — every inbound message processed
 *   message.sent              — every outbound message delivered
 *   conversation.escalated    — session escalated to operator
 *   lead.created              — a new lead was linked to the conversation
 *   reservation.linked        — an existing reservation was resolved and linked
 *   conversation.state_changed — ConversationState machine transitioned
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import { runInBackground } from './background';
import { CommEvent, CommEventType } from './types';

// ─── In-Process Observer Registry ────────────────────────────────────────────

type Observer = (event: CommEvent) => void | Promise<void>;
const observers = new Map<CommEventType | '*', Observer[]>();

/**
 * Register an observer for a specific event type, or '*' for all events.
 * Observers run fire-and-forget after DB persistence.
 */
export function subscribe(type: CommEventType | '*', fn: Observer): void {
  const list = observers.get(type) ?? [];
  list.push(fn);
  observers.set(type, list);
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

/**
 * Emit a communication domain event.
 *
 * Always returns synchronously — DB persist and in-process observers run as
 * tracked background tasks (registered in the global background registry).
 *
 * Fire-and-forget policy:
 *   emit() is called from the orchestrator's critical path, after the reply
 *   has already been sent.  Blocking the caller on DB I/O would add latency
 *   with no benefit to the guest.  Failures are logged via [Background:failure]
 *   with the correlationId so they are traceable without blocking the request.
 *
 *   At the serverless lifecycle boundary the API route calls
 *   flushBackgroundTasks() (or passes it to waitUntil()) to guarantee these
 *   tasks complete within the request lifetime.
 */
export function emit(
  type: CommEventType,
  payload: Record<string, unknown>,
  opts?: { conversationId?: string; chatId?: number; channel?: string; correlationId?: string },
): void {
  const event: CommEvent = {
    type,
    conversationId: opts?.conversationId,
    chatId: opts?.chatId,
    channel: opts?.channel,
    payload,
    ts: new Date().toISOString(),
  };

  const corrId = opts?.correlationId
    ?? opts?.conversationId
    ?? (opts?.chatId != null ? String(opts.chatId) : 'unknown');

  // Persist to Supabase (best-effort, tracked)
  runInBackground(
    { correlationId: corrId, module: 'events', taskName: 'emit_comm_event_db', eventId: type },
    async () => {
      const { error } = await supabase.from('comm_events').insert({
        id:              randomUUID(),
        type:            event.type,
        conversation_id: event.conversationId ?? null,
        chat_id:         event.chatId ?? null,
        channel:         event.channel ?? null,
        payload:         event.payload,
        created_at:      event.ts,
      });
      if (error) throw new Error(`DB insert failed for ${type}: ${error.message}`);
    },
  );

  // Notify in-process observers (fire-and-forget, tracked)
  const typed    = observers.get(type) ?? [];
  const wildcard = observers.get('*')  ?? [];
  for (const fn of [...typed, ...wildcard]) {
    runInBackground(
      { correlationId: corrId, module: 'events', taskName: 'emit_comm_event_observer', eventId: type },
      async () => { await fn(event); },
    );
  }
}

// ─── Typed Helper Emitters ────────────────────────────────────────────────────

export function emitConversationStarted(params: {
  conversationId: string;
  chatId: number;
  channel: string;
  contactId: string;
}): void {
  emit('conversation.started', { contactId: params.contactId }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
    channel: params.channel,
  });
}

export function emitMessageReceived(params: {
  conversationId?: string;
  chatId: number;
  channel: string;
  messagePreview: string;
  intentCategory?: string;
}): void {
  emit('message.received', {
    preview: params.messagePreview.slice(0, 100),
    intent: params.intentCategory,
  }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
    channel: params.channel,
  });
}

export function emitMessageSent(params: {
  conversationId?: string;
  chatId: number;
  channel: string;
  attempts: number;
}): void {
  emit('message.sent', { attempts: params.attempts }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
    channel: params.channel,
  });
}

export function emitConversationEscalated(params: {
  conversationId?: string;
  chatId: number;
  channel: string;
  reason: string;
}): void {
  emit('conversation.escalated', { reason: params.reason }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
    channel: params.channel,
  });
}

export function emitLeadCreated(params: {
  conversationId?: string;
  chatId: number;
  leadId: string;
}): void {
  emit('lead.created', { leadId: params.leadId }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
  });
}

export function emitReservationLinked(params: {
  conversationId?: string;
  chatId: number;
  reservationId: string;
  propertyId?: string;
}): void {
  emit('reservation.linked', {
    reservationId: params.reservationId,
    propertyId: params.propertyId,
  }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
  });
}

export function emitStateChanged(params: {
  conversationId: string;
  chatId: number;
  from: string;
  to: string;
}): void {
  emit('conversation.state_changed', {
    from: params.from,
    to: params.to,
  }, {
    conversationId: params.conversationId,
    chatId: params.chatId,
  });
}
