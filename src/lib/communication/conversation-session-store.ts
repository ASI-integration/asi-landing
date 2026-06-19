import * as fs from 'fs';
import * as path from 'path';
import type { CommunicationChannel } from './types';
import {
  AutonomousConversationSession,
  AutonomousSessionRole,
  AutonomousSessionStatus,
  IdentityResolution,
  IntentCategory,
  Lang,
  SessionTimelineEntry,
  TelegramOperationalSessionCaseV1,
} from './types';

// ─── Storage abstraction ──────────────────────────────────────────────────────

interface SessionStore {
  get(chatId: number): AutonomousConversationSession | undefined;
  set(chatId: number, session: AutonomousConversationSession): void;
  clear(): void;
}

function defaultStateDir(): string {
  // Never default to /tmp in production-like environments — it is not reliably persistent.
  // Prefer a project-local directory, which works well with TimeWeb + PM2 artifact deployments.
  // Operators can override via SESSION_STORE_DIR / COMM_STATE_DIR.
  const env =
    process.env.SESSION_STORE_DIR ??
    process.env.COMM_STATE_DIR ??
    process.env.CONVERSATION_SESSION_DIR ??
    process.env.STATE_DIR;
  if (env && String(env).trim()) return String(env);
  return path.join(process.cwd(), '.asi-comm-state');
}

const SESSION_DIR = defaultStateDir();
const MAX_TIMELINE = 10;

/**
 * File-backed session store.
 * Each session is stored as `/tmp/asi-sess-{chatId}.json` (or `SESSION_STORE_DIR`).
 * An in-process LRU cache avoids repeated disk reads within the same lambda warm start.
 * Falls back to in-memory-only when the filesystem is unavailable.
 */
class FileSessionStore implements SessionStore {
  private cache = new Map<number, AutonomousConversationSession>();
  private fsAvailable: boolean;

  constructor() {
    // Never write to disk in test environments to avoid cross-test contamination.
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

  private filePath(chatId: number): string {
    return path.join(SESSION_DIR, `asi-sess-${chatId}.json`);
  }

  get(chatId: number): AutonomousConversationSession | undefined {
    if (this.cache.has(chatId)) return this.cache.get(chatId);
    if (!this.fsAvailable) return undefined;
    try {
      const raw = fs.readFileSync(this.filePath(chatId), 'utf-8');
      const session = JSON.parse(raw) as AutonomousConversationSession;
      // Ensure timeline field exists for sessions written before this version
      if (!Array.isArray(session.timeline)) session.timeline = [];
      this.cache.set(chatId, session);
      return session;
    } catch {
      return undefined;
    }
  }

  set(chatId: number, session: AutonomousConversationSession): void {
    this.cache.set(chatId, session);
    if (!this.fsAvailable) return;
    try {
      fs.writeFileSync(this.filePath(chatId), JSON.stringify(session), 'utf-8');
    } catch {
      // Non-fatal: in-process cache still serves within this warm lambda instance.
    }
  }

  clear(): void {
    this.cache.clear();
    // We intentionally do NOT delete files on clear — this is only called from tests
    // via __resetAutonomousSessionStoreForTests, and test isolation is via cache reset.
  }
}

const store: SessionStore = new FileSessionStore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferRole(chatId: number, channel: CommunicationChannel): AutonomousSessionRole {
  if (channel === 'telegram' && chatId < 0) return 'staff';
  if (channel === 'telegram' && chatId > 0) return 'guest';
  if (channel === 'vk') return 'guest';   // VK user IDs are always positive; always guests
  if (channel === 'email') return 'guest';
  return 'unknown';
}

function baseSession(chatId: number, channel: CommunicationChannel): AutonomousConversationSession {
  return {
    chat_id: chatId,
    channel,
    role: inferRole(chatId, channel),
    status: AutonomousSessionStatus.Active,
    collected_data: {},
    timeline: [],
    updated_at: new Date().toISOString(),
  };
}

function applyIdentity(
  prev: AutonomousConversationSession,
  identity: IdentityResolution | undefined,
): AutonomousConversationSession {
  if (!identity) return prev;
  return {
    ...prev,
    identity_role: identity.role,
    entity_type: identity.entityType,
    entity_id: identity.entityId,
    property_id: identity.propertyId,
    reservation_id: identity.reservationId,
    lead_id: identity.leadId,
    identity_confidence: identity.confidence,
    identity_resolution_status: identity.status,
    identity_reason: identity.reason,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load session for this chat, or undefined if none yet. */
export function loadAutonomousSession(chatId: number): AutonomousConversationSession | undefined {
  const s = store.get(chatId);
  return s ? { ...s, collected_data: { ...s.collected_data }, timeline: [...s.timeline] } : undefined;
}

/** Get existing or create default session. */
export function getOrCreateAutonomousSession(
  chatId: number,
  channel: CommunicationChannel,
): AutonomousConversationSession {
  let s = store.get(chatId);
  if (!s) {
    s = baseSession(chatId, channel);
    store.set(chatId, s);
  }
  return { ...s, collected_data: { ...s.collected_data }, timeline: [...s.timeline] };
}

/** Attach identity binding info to the session (best-effort). */
export function setAutonomousSessionIdentity(params: {
  chatId: number;
  channel: CommunicationChannel;
  identity: IdentityResolution;
}): AutonomousConversationSession {
  const prev = store.get(params.chatId) ?? baseSession(params.chatId, params.channel);
  const next = applyIdentity(
    { ...prev, channel: params.channel, updated_at: new Date().toISOString() },
    params.identity,
  );
  store.set(params.chatId, next);
  return { ...next, collected_data: { ...next.collected_data }, timeline: [...next.timeline] };
}

export function savePendingIdentityMessage(params: {
  chatId: number;
  channel: CommunicationChannel;
  messageText: string;
  metadata?: Record<string, unknown> | null;
}): void {
  const messageText = String(params.messageText ?? '').trim();
  if (!messageText) return;
  const prev = store.get(params.chatId) ?? baseSession(params.chatId, params.channel);
  if (prev.pending_identity_message) return;
  store.set(params.chatId, {
    ...prev,
    channel: params.channel,
    pending_identity_message: messageText,
    pending_identity_metadata: params.metadata ?? null,
    updated_at: new Date().toISOString(),
  });
}

export function takePendingIdentityMessage(chatId: number): {
  text: string;
  metadata: Record<string, unknown> | null;
} | null {
  const prev = store.get(chatId);
  const text = String(prev?.pending_identity_message ?? '').trim();
  if (!text) return null;
  const metadata = prev?.pending_identity_metadata ?? null;
  store.set(chatId, {
    ...(prev ?? baseSession(chatId, 'telegram')),
    pending_identity_message: null,
    pending_identity_metadata: null,
    updated_at: new Date().toISOString(),
  });
  return { text, metadata };
}

/**
 * Append a turn (user or assistant) to the session's short-term timeline.
 * Caps at MAX_TIMELINE entries (oldest dropped first).
 * Call this once per message — before decision/escalation for user turns,
 * after sending for assistant turns.
 */
export function addSessionTimelineTurn(
  chatId: number,
  channel: CommunicationChannel,
  role: 'user' | 'assistant',
  text: string,
): void {
  const prev = store.get(chatId) ?? baseSession(chatId, channel);
  const entry: SessionTimelineEntry = {
    role,
    text: text.slice(0, 500),
    ts: new Date().toISOString(),
  };
  const timeline = [...prev.timeline, entry].slice(-MAX_TIMELINE);
  store.set(chatId, { ...prev, timeline, updated_at: new Date().toISOString() });
}

/**
 * Merge inbound turn into the autonomous session after intent detection.
 * Preserves previously collected non-empty fields unless overwritten.
 */
export function mergeAutonomousSessionFromInbound(params: {
  chatId: number;
  channel: CommunicationChannel;
  identity?: IdentityResolution;
  intent: IntentCategory;
  intentConfidence: number;
  lang: Lang;
  mergedClues: {
    bookingReference?: string;
    propertyLocation?: string;
    guestName?: string;
    checkInDate?: string;
  };
}): AutonomousConversationSession {
  const prev = store.get(params.chatId) ?? baseSession(params.chatId, params.channel);
  const nextCollected: Record<string, string | undefined> = { ...prev.collected_data };
  const setIf = (key: string, v: string | undefined) => {
    if (v && String(v).trim()) nextCollected[key] = String(v).trim();
  };
  setIf('booking_reference', params.mergedClues.bookingReference);
  setIf('property_location', params.mergedClues.propertyLocation);
  setIf('guest_name', params.mergedClues.guestName);
  setIf('check_in_date', params.mergedClues.checkInDate);
  nextCollected.lang = params.lang;

  let status = prev.status;
  // Never downgrade from Completed or Escalated
  if (status === AutonomousSessionStatus.Completed || status === AutonomousSessionStatus.Escalated) {
    // keep as-is
  } else if (params.intent === IntentCategory.BookingInquiry) {
    status = AutonomousSessionStatus.Collecting;
  } else if (
    params.intent === IntentCategory.Unknown &&
    prev.status === AutonomousSessionStatus.AwaitingClarification
  ) {
    status = AutonomousSessionStatus.AwaitingClarification;
  } else if (prev.status !== AutonomousSessionStatus.AwaitingClarification) {
    status = AutonomousSessionStatus.Active;
  }

  const next: AutonomousConversationSession = {
    ...applyIdentity(prev, params.identity),
    channel: params.channel,
    role: inferRole(params.chatId, params.channel),
    intent: params.intent,
    intent_confidence: params.intentConfidence,
    status,
    collected_data: nextCollected,
    updated_at: new Date().toISOString(),
  };
  store.set(params.chatId, next);
  return { ...next, collected_data: { ...next.collected_data }, timeline: [...next.timeline] };
}

export function markAutonomousSessionStatus(
  chatId: number,
  status: AutonomousSessionStatus,
): AutonomousConversationSession | undefined {
  const prev = store.get(chatId);
  if (!prev) return undefined;
  const next = { ...prev, status, updated_at: new Date().toISOString() };
  store.set(chatId, next);
  return { ...next, collected_data: { ...next.collected_data }, timeline: [...next.timeline] };
}

export function patchAutonomousSessionCollectedData(params: {
  chatId: number;
  channel: CommunicationChannel;
  set?: Record<string, string | null | undefined>;
  clear?: string[];
}): AutonomousConversationSession {
  const prev = store.get(params.chatId) ?? baseSession(params.chatId, params.channel);
  const nextCollected: Record<string, string | undefined> = { ...prev.collected_data };
  for (const key of params.clear ?? []) {
    delete nextCollected[key];
  }
  for (const [key, value] of Object.entries(params.set ?? {})) {
    const normalized = value == null ? '' : String(value).trim();
    if (normalized) {
      nextCollected[key] = normalized;
    } else {
      delete nextCollected[key];
    }
  }
  const next = {
    ...prev,
    channel: params.channel,
    collected_data: nextCollected,
    updated_at: new Date().toISOString(),
  };
  store.set(params.chatId, next);
  return { ...next, collected_data: { ...next.collected_data }, timeline: [...next.timeline] };
}

export function getAutonomousSessionOperationalCaseV1(chatId: number): TelegramOperationalSessionCaseV1 | undefined {
  const prev = store.get(chatId);
  return prev?.operational_case ? JSON.parse(JSON.stringify(prev.operational_case)) : undefined;
}

export function setAutonomousSessionOperationalCaseV1(params: {
  chatId: number;
  channel: CommunicationChannel;
  operationalCase?: TelegramOperationalSessionCaseV1;
}): void {
  const prev = store.get(params.chatId) ?? baseSession(params.chatId, params.channel);
  const next: AutonomousConversationSession = {
    ...prev,
    channel: params.channel,
    operational_case: params.operationalCase,
    updated_at: new Date().toISOString(),
  };
  store.set(params.chatId, next);
}

/**
 * Reset the autonomous session snapshot to a clean baseline.
 *
 * This is intended for acceptance testing / controlled admin tooling and MUST
 * be guarded by the caller (allowlist / non-prod).
 */
export function resetAutonomousSessionSnapshot(params: {
  chatId: number;
  channel: CommunicationChannel;
  preserveIdentity?: boolean;
}): AutonomousConversationSession {
  const prev = store.get(params.chatId);
  const base = baseSession(params.chatId, params.channel);
  const next: AutonomousConversationSession = params.preserveIdentity && prev
    ? {
        ...base,
        identity_role: prev.identity_role,
        entity_type: prev.entity_type,
        entity_id: prev.entity_id,
        property_id: prev.property_id,
        reservation_id: prev.reservation_id,
        lead_id: prev.lead_id,
        identity_confidence: prev.identity_confidence,
        identity_resolution_status: prev.identity_resolution_status,
        identity_reason: prev.identity_reason,
      }
    : {
        ...base,
        pending_identity_message: null,
        pending_identity_metadata: null,
      };
  store.set(params.chatId, next);
  return { ...next, collected_data: { ...next.collected_data }, timeline: [...next.timeline] };
}

/** @internal tests only */
export function __resetAutonomousSessionStoreForTests(): void {
  store.clear();
}
