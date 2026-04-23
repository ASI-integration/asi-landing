import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  DeliveryStatus,
  MessageDirection,
  MessageType,
  type ConversationSession,
  type InboundMessageEnvelope,
  type Message,
  type Role,
} from './types';
import type { IdentityResolution } from './types';

type SessionState = ConversationSession['state'];

interface Store {
  get(key: string): ConversationSession | undefined;
  set(key: string, session: ConversationSession): void;
  clear(): void;
}

const SESSION_DIR = process.env.CONVERSATION_SESSION_DIR ?? process.env.SESSION_STORE_DIR ?? '/tmp';
const MAX_LAST_MESSAGES = Number(process.env.CONVERSATION_SESSION_MAX_MESSAGES ?? 20);

class FileBackedStore implements Store {
  private cache = new Map<string, ConversationSession>();
  private fsAvailable: boolean;

  constructor() {
    if (process.env.NODE_ENV === 'test') {
      this.fsAvailable = false;
      return;
    }
    try {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
      this.fsAvailable = true;
    } catch {
      this.fsAvailable = false;
    }
  }

  private filePath(key: string): string {
    // keep filenames stable and safe
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(SESSION_DIR, `asi-conv-sess-${safe}.json`);
  }

  get(key: string): ConversationSession | undefined {
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.fsAvailable) return undefined;
    try {
      const raw = fs.readFileSync(this.filePath(key), 'utf-8');
      const s = JSON.parse(raw) as ConversationSession;
      this.cache.set(key, s);
      return s;
    } catch {
      return undefined;
    }
  }

  set(key: string, session: ConversationSession): void {
    this.cache.set(key, session);
    if (!this.fsAvailable) return;
    try {
      fs.writeFileSync(this.filePath(key), JSON.stringify(session), 'utf-8');
    } catch {
      // best-effort
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

const store: Store = new FileBackedStore();

function sessionKey(channel: string, actorId: string): string {
  return `${channel}:${actorId}`;
}

export function resolveActorId(envelope: InboundMessageEnvelope, identity?: IdentityResolution): string {
  return (
    identity?.guestId ??
    identity?.entityId ??
    envelope.externalUserId ??
    envelope.email ??
    envelope.phoneNumber ??
    envelope.chatId ??
    `unknown:${envelope.channel}`
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(event: string, payload: Record<string, unknown>): void {
  try {
    console.log('[comm:session]', { event, ...payload, ts: nowIso() });
  } catch {
    // never break processing
  }
}

export function createConversationSession(params: {
  channel: string;
  actorId: string;
  role: Role;
  identity?: IdentityResolution;
}): ConversationSession {
  const now = nowIso();
  const session: ConversationSession = {
    sessionId: randomUUID(),
    actorId: params.actorId,
    role: params.role,
    channel: params.channel,
    state: 'active',
    memory: { lastMessages: [], extractedFacts: {}, summary: undefined },
    confidence: params.identity?.confidence ?? 0.2,
    resolutionStatus: params.identity?.status,
    createdAt: now,
    updatedAt: now,
  };
  log('created', {
    session_id: session.sessionId,
    channel: session.channel,
    actor_id: session.actorId,
    role: session.role,
  });
  return session;
}

function mergeLinkedEntities(
  prev: ConversationSession,
  identity?: IdentityResolution,
): ConversationSession {
  if (!identity) return prev;
  return {
    ...prev,
    role: identity.role ?? prev.role,
    propertyId: identity.propertyId ?? prev.propertyId,
    reservationId: identity.reservationId ?? prev.reservationId,
    leadId: identity.leadId ?? prev.leadId,
    confidence: Number.isFinite(identity.confidence) ? identity.confidence : prev.confidence,
    resolutionStatus: identity.status ?? prev.resolutionStatus,
  };
}

export function extractConversationFacts(text: string): Record<string, unknown> {
  const t = text.toLowerCase();
  const facts: Record<string, unknown> = {};

  // Dates (very lightweight, deterministic)
  const isoDates = Array.from(t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)).map(m => `${m[1]}-${m[2]}-${m[3]}`);
  if (isoDates.length > 0) facts.requested_dates = Array.from(new Set(isoDates)).slice(0, 6);

  // Guest count (simple)
  const guests =
    t.match(/\b(\d{1,2})\s*(guests?|people|persons)\b/)?.[1] ??
    t.match(/\b(\d{1,2})\s*(гост(ей|я|и)?)\b/)?.[1];
  if (guests) facts.guest_count = Number(guests);

  // Check-in/out mentions
  if (/(check-?in|заезд|засел)/.test(t)) facts.mentions_check_in = true;
  if (/(check-?out|выезд|высел)/.test(t)) facts.mentions_check_out = true;

  // Payment / invoice / receipt
  if (/(pay|payment|paid|invoice|receipt|refund|chargeback|оплат|счет|чек|квитанц|возврат)/.test(t)) {
    facts.payment_related = true;
  }

  // Complaints / issues
  if (/(complain|complaint|broken|not working|issue|problem|жалоб|проблем|не работает|сломал)/.test(t)) {
    facts.complaint = true;
  }

  // Pets / children / parking / late arrival
  if (/(pet|dog|cat|кошк|собак|питом)/.test(t)) facts.pet = true;
  if (/(child|children|kid|kids|ребен|дет)/.test(t)) facts.children = true;
  if (/(parking|park|garage|парковк|паркинг)/.test(t)) facts.parking = true;
  if (/(late|after midnight|поздно|после полуночи)/.test(t)) facts.late_arrival = true;

  return facts;
}

function mergeFacts(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  return { ...prev, ...next };
}

function buildRollingSummary(params: {
  prevSummary?: string;
  facts: Record<string, unknown>;
  lastMessages: Message[];
}): string {
  const parts: string[] = [];
  if (params.facts.requested_dates) parts.push(`dates=${JSON.stringify(params.facts.requested_dates)}`);
  if (typeof params.facts.guest_count === 'number') parts.push(`guests=${params.facts.guest_count}`);
  if (params.facts.payment_related) parts.push('payment');
  if (params.facts.complaint) parts.push('complaint');
  if (params.facts.pet) parts.push('pet');
  if (params.facts.children) parts.push('children');
  if (params.facts.parking) parts.push('parking');
  if (params.facts.late_arrival) parts.push('late_arrival');
  if (params.facts.mentions_check_in) parts.push('check_in');
  if (params.facts.mentions_check_out) parts.push('check_out');

  const recentUser = [...params.lastMessages].reverse().find(m => m.direction === 'inbound')?.content;
  const hint = recentUser ? `last_user="${recentUser.slice(0, 120)}"` : null;

  const compact = [parts.length ? `facts: ${parts.join(', ')}` : null, hint].filter(Boolean).join(' | ');
  if (!compact) return params.prevSummary ?? '';

  // Keep it short and rolling.
  const base = params.prevSummary ? `${params.prevSummary} || ${compact}` : compact;
  return base.length <= 600 ? base : base.slice(-600);
}

const ALLOWED: Record<SessionState, SessionState[]> = {
  active: ['awaiting_input', 'escalated'],
  awaiting_input: ['resolved', 'escalated'],
  resolved: ['active'], // allow re-open on new inbound
  escalated: ['active'], // allow recovery after operator action
};

export function transitionConversationSessionState(
  session: ConversationSession,
  next: SessionState,
  reason: string,
): ConversationSession {
  if (session.state === next) return session;
  const allowed = ALLOWED[session.state] ?? [];
  if (!allowed.includes(next)) {
    log('state.invalid_transition', {
      session_id: session.sessionId,
      from: session.state,
      to: next,
      reason,
    });
    return session;
  }
  const updated = { ...session, state: next, updatedAt: nowIso() };
  log('state.changed', {
    session_id: session.sessionId,
    from: session.state,
    to: next,
    reason,
  });
  return updated;
}

export function getOrCreateConversationSession(params: {
  envelope: InboundMessageEnvelope;
  identity?: IdentityResolution;
}): { session: ConversationSession; created: boolean; key: string } {
  const actorId = resolveActorId(params.envelope, params.identity);
  const key = sessionKey(params.envelope.channel, actorId);
  const existing = store.get(key);
  if (existing) {
    const updated = mergeLinkedEntities({ ...existing, updatedAt: nowIso() }, params.identity);
    store.set(key, updated);
    log('resolved', { session_id: updated.sessionId, key, actor_id: actorId });
    return { session: updated, created: false, key };
  }
  const created = createConversationSession({
    channel: params.envelope.channel,
    actorId,
    role: params.identity?.role ?? 'unknown',
    identity: params.identity,
  });
  store.set(key, created);
  return { session: created, created: true, key };
}

export function appendSessionMessage(params: {
  key: string;
  session: ConversationSession;
  direction: 'inbound' | 'outbound';
  content: string;
  meta?: Record<string, unknown>;
}): ConversationSession {
  const msg: Message = {
    id: randomUUID(),
    conversationId: params.session.sessionId,
    direction: params.direction === 'inbound' ? MessageDirection.Inbound : MessageDirection.Outbound,
    type: MessageType.Text,
    content: params.content,
    meta: params.meta,
    deliveryStatus: params.direction === 'outbound' ? DeliveryStatus.Sent : DeliveryStatus.Pending,
    createdAt: nowIso(),
  };

  const lastMessages = [...params.session.memory.lastMessages, msg].slice(-MAX_LAST_MESSAGES);
  const updated = {
    ...params.session,
    memory: { ...params.session.memory, lastMessages },
    updatedAt: nowIso(),
  };
  store.set(params.key, updated);
  log('memory.updated', { session_id: updated.sessionId, messages: updated.memory.lastMessages.length });
  return updated;
}

export function updateSessionFactsAndSummary(params: {
  key: string;
  session: ConversationSession;
  text: string;
}): ConversationSession {
  const newFacts = extractConversationFacts(params.text);
  if (Object.keys(newFacts).length === 0) return params.session;

  const extractedFacts = mergeFacts(params.session.memory.extractedFacts ?? {}, newFacts);
  const summary = buildRollingSummary({
    prevSummary: params.session.memory.summary,
    facts: extractedFacts,
    lastMessages: params.session.memory.lastMessages,
  });
  const updated: ConversationSession = {
    ...params.session,
    memory: { ...params.session.memory, extractedFacts, summary },
    updatedAt: nowIso(),
  };
  store.set(params.key, updated);
  log('facts.updated', { session_id: updated.sessionId, keys: Object.keys(newFacts) });
  return updated;
}

export function buildSessionContextForLLM(session: ConversationSession): string {
  const linked = [
    session.reservationId ? `reservationId=${session.reservationId}` : null,
    session.propertyId ? `propertyId=${session.propertyId}` : null,
    session.leadId ? `leadId=${session.leadId}` : null,
  ].filter(Boolean).join(' ');

  const last = session.memory.lastMessages.slice(-10).map(m => {
    const who = m.direction === 'inbound' ? 'user' : 'assistant';
    return `${who}: ${String(m.content).slice(0, 240)}`;
  });

  return [
    `--- Session Context ---`,
    `role: ${session.role}`,
    `state: ${session.state}`,
    `confidence: ${session.confidence}`,
    session.resolutionStatus ? `resolutionStatus: ${session.resolutionStatus}` : null,
    linked ? `linked: ${linked}` : null,
    session.memory.summary ? `summary: ${session.memory.summary}` : null,
    last.length ? `lastMessages:\n${last.map(x => `- ${x}`).join('\n')}` : null,
    `-----------------------`,
  ].filter(Boolean).join('\n');
}

/**
 * Best-effort operator recovery: move an escalated session back to active so
 * normal automation can resume on the next inbound turn.
 *
 * This intentionally does NOT create a new session if none exists.
 */
export function recoverConversationSessionToActive(params: {
  channel: string;
  actorId: string;
  reason: string;
}): boolean {
  const key = sessionKey(params.channel, params.actorId);
  const existing = store.get(key);
  if (!existing) return false;
  const updated = transitionConversationSessionState(existing, 'active', params.reason);
  store.set(key, updated);
  return updated.state === 'active';
}

/**
 * Acceptance/admin escape hatch: wipe the session memory and set state to active.
 *
 * This MUST be guarded by the caller (allowlist / non-prod). It does not create
 * a new actor key; it only resets the stored session contents.
 */
export function resetConversationSessionForAcceptance(params: {
  channel: string;
  actorId: string;
  reason: string;
}): boolean {
  const key = sessionKey(params.channel, params.actorId);
  const existing = store.get(key);
  if (!existing) return false;
  const now = nowIso();
  const cleared: ConversationSession = {
    ...existing,
    state: 'active',
    memory: { lastMessages: [], extractedFacts: {}, summary: undefined },
    updatedAt: now,
  };
  store.set(key, cleared);
  log('acceptance.reset', {
    session_id: existing.sessionId,
    key,
    from: existing.state,
    to: 'active',
    reason: params.reason,
  });
  return true;
}

/** @internal tests only */
export function __resetConversationSessionEngineForTests(): void {
  store.clear();
}

