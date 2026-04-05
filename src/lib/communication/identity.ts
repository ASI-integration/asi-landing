/**
 * Guest Identity Resolution
 *
 * Resolves and merges identities across channels. Backed by Supabase `tg_contacts`
 * table with in-memory cache for hot-path reads.
 *
 * Resolution order:
 *   1. Telegram chatId  → tg_contacts.telegram_id
 *   2. Phone number     → tg_contacts.phone
 *   3. Email            → tg_contacts.email
 *
 * If no match is found, a new contact record is created.
 * Merging: if a new identifier is observed for an existing contact, it is added.
 *
 * DB table required: tg_contacts (see SQL migration)
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import { InboundMessageEnvelope } from './types';

export interface UnifiedGuestIdentity {
  guestId: string;
  knownEmails: string[];
  knownPhones: string[];
  knownChatIds: string[];
  firstName?: string;
  lastName?: string;
}

// ─── In-Memory Cache (keyed by guestId) ──────────────────────────────────────

const identityCache = new Map<string, UnifiedGuestIdentity>();

/** Additional lookup indexes so we don't scan the whole cache. */
const byTelegramId = new Map<string, string>(); // telegramId → guestId
const byPhone      = new Map<string, string>(); // normalised phone → guestId
const byEmail      = new Map<string, string>(); // lower email → guestId

// ─── Public API ───────────────────────────────────────────────────────────────

export async function resolveGuestIdentity(
  envelope: InboundMessageEnvelope,
): Promise<UnifiedGuestIdentity | null> {
  // 1. Cache lookup
  const cached = lookupInCache(envelope);
  if (cached) return cached;

  // 2. Supabase lookup
  return resolveFromDB(envelope);
}

export async function createOrMergeIdentity(
  envelope: InboundMessageEnvelope,
  existingId?: string,
): Promise<UnifiedGuestIdentity> {
  // Fast-path: if existingId provided and cached, merge in-place
  if (existingId) {
    const cached = identityCache.get(existingId);
    if (cached) return mergeAndPersist(cached, envelope);
  }

  // Try to find existing identity
  const existing = await resolveGuestIdentity(envelope);
  if (existing) return mergeAndPersist(existing, envelope);

  // Create new contact
  const guestId = existingId ?? `guest_${randomUUID().slice(0, 8)}`;
  const identity: UnifiedGuestIdentity = {
    guestId,
    knownEmails:  [],
    knownPhones:  [],
    knownChatIds: [],
  };

  const merged = mergeLocalFields(identity, envelope);
  setInCache(merged);

  // Persist to Supabase (best-effort)
  await persistContact(merged, envelope);

  return merged;
}

// ─── Resolution Helpers ───────────────────────────────────────────────────────

function lookupInCache(envelope: InboundMessageEnvelope): UnifiedGuestIdentity | null {
  if (envelope.chatId) {
    const guestId = byTelegramId.get(envelope.chatId);
    if (guestId) return identityCache.get(guestId) ?? null;
  }
  if (envelope.phoneNumber) {
    const guestId = byPhone.get(normalisePhone(envelope.phoneNumber));
    if (guestId) return identityCache.get(guestId) ?? null;
  }
  if (envelope.email) {
    const guestId = byEmail.get(envelope.email.toLowerCase());
    if (guestId) return identityCache.get(guestId) ?? null;
  }
  return null;
}

async function resolveFromDB(
  envelope: InboundMessageEnvelope,
): Promise<UnifiedGuestIdentity | null> {
  try {
    let query = supabase.from('tg_contacts').select('*');

    // Try exact match on any available identifier
    if (envelope.chatId) {
      const { data } = await query.eq('telegram_id', envelope.chatId).maybeSingle();
      if (data) return cacheAndReturn(data);
    }
    if (envelope.phoneNumber) {
      const { data } = await supabase
        .from('tg_contacts')
        .select('*')
        .eq('phone', normalisePhone(envelope.phoneNumber))
        .maybeSingle();
      if (data) return cacheAndReturn(data);
    }
    if (envelope.email) {
      const { data } = await supabase
        .from('tg_contacts')
        .select('*')
        .eq('email', envelope.email.toLowerCase())
        .maybeSingle();
      if (data) return cacheAndReturn(data);
    }
  } catch {
    // DB unavailable — proceed without identity
  }

  return null;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistContact(
  identity: UnifiedGuestIdentity,
  envelope: InboundMessageEnvelope,
): Promise<void> {
  try {
    await supabase.from('tg_contacts').upsert(
      {
        id:          identity.guestId,
        telegram_id: envelope.chatId ?? null,
        phone:       envelope.phoneNumber ? normalisePhone(envelope.phoneNumber) : null,
        email:       envelope.email ? envelope.email.toLowerCase() : null,
        first_name:  identity.firstName ?? null,
        last_name:   identity.lastName ?? null,
        created_at:  new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: false },
    );
  } catch (err) {
    console.warn('[Identity] Failed to persist contact:', err);
  }
}

async function mergeAndPersist(
  identity: UnifiedGuestIdentity,
  envelope: InboundMessageEnvelope,
): Promise<UnifiedGuestIdentity> {
  const merged = mergeLocalFields(identity, envelope);
  setInCache(merged);

  // Update Supabase with any newly-seen identifiers (best-effort)
  try {
    const patch: Record<string, string | null> = { updated_at: new Date().toISOString() };
    if (envelope.chatId && !identity.knownChatIds.includes(envelope.chatId)) {
      patch.telegram_id = envelope.chatId;
    }
    if (envelope.phoneNumber && !identity.knownPhones.includes(normalisePhone(envelope.phoneNumber))) {
      patch.phone = normalisePhone(envelope.phoneNumber);
    }
    if (envelope.email && !identity.knownEmails.includes(envelope.email.toLowerCase())) {
      patch.email = envelope.email.toLowerCase();
    }
    if (Object.keys(patch).length > 1) {
      await supabase.from('tg_contacts').update(patch).eq('id', identity.guestId);
    }
  } catch {
    // Best-effort
  }

  return merged;
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function setInCache(identity: UnifiedGuestIdentity): void {
  identityCache.set(identity.guestId, identity);
  identity.knownChatIds.forEach(id => byTelegramId.set(id, identity.guestId));
  identity.knownPhones.forEach(p => byPhone.set(p, identity.guestId));
  identity.knownEmails.forEach(e => byEmail.set(e, identity.guestId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cacheAndReturn(row: any): UnifiedGuestIdentity {
  const identity: UnifiedGuestIdentity = {
    guestId:      row.id,
    knownChatIds: row.telegram_id ? [row.telegram_id] : [],
    knownPhones:  row.phone ? [row.phone] : [],
    knownEmails:  row.email ? [row.email] : [],
    firstName:    row.first_name ?? undefined,
    lastName:     row.last_name ?? undefined,
  };
  setInCache(identity);
  return identity;
}

function mergeLocalFields(
  identity: UnifiedGuestIdentity,
  envelope: InboundMessageEnvelope,
): UnifiedGuestIdentity {
  const knownChatIds = [...identity.knownChatIds];
  const knownPhones  = [...identity.knownPhones];
  const knownEmails  = [...identity.knownEmails];

  if (envelope.chatId && !knownChatIds.includes(envelope.chatId)) {
    knownChatIds.push(envelope.chatId);
  }
  if (envelope.phoneNumber) {
    const norm = normalisePhone(envelope.phoneNumber);
    if (!knownPhones.includes(norm)) knownPhones.push(norm);
  }
  if (envelope.email) {
    const lower = envelope.email.toLowerCase();
    if (!knownEmails.includes(lower)) knownEmails.push(lower);
  }

  return { ...identity, knownChatIds, knownPhones, knownEmails };
}

function normalisePhone(phone: string): string {
  // Strip non-digit characters except leading +
  return phone.replace(/[^\d+]/g, '');
}
