import { InboundMessageEnvelope } from './types';

export interface UnifiedGuestIdentity {
  guestId: string;
  knownEmails: string[];
  knownPhones: string[];
  knownChatIds: string[];
  firstName?: string;
  lastName?: string;
}

// Memory Mock for Phase 3 Identity mapping. In reality, queries Supabase `guests` or `profiles`.
const identityDB = new Map<string, UnifiedGuestIdentity>();

export async function resolveGuestIdentity(envelope: InboundMessageEnvelope): Promise<UnifiedGuestIdentity | null> {
  // 1. Search by chat ID
  if (envelope.chatId) {
    for (const identity of Array.from(identityDB.values())) {
      if (identity.knownChatIds.includes(envelope.chatId)) return identity;
    }
  }

  // 2. Search by phone
  if (envelope.phoneNumber) {
    for (const identity of Array.from(identityDB.values())) {
      if (identity.knownPhones.includes(envelope.phoneNumber)) return identity;
    }
  }

  // 3. Search by email
  if (envelope.email) {
    for (const identity of Array.from(identityDB.values())) {
      if (identity.knownEmails.includes(envelope.email.toLowerCase())) return identity;
    }
  }

  return null;
}

export async function createOrMergeIdentity(envelope: InboundMessageEnvelope, existingId?: string): Promise<UnifiedGuestIdentity> {
  const targetId = existingId || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  let identity = identityDB.get(targetId) || {
    guestId: targetId,
    knownEmails: [],
    knownPhones: [],
    knownChatIds: []
  };

  if (envelope.chatId && !identity.knownChatIds.includes(envelope.chatId)) {
    identity.knownChatIds.push(envelope.chatId);
  }
  if (envelope.phoneNumber && !identity.knownPhones.includes(envelope.phoneNumber)) {
    identity.knownPhones.push(envelope.phoneNumber);
  }
  if (envelope.email) {
    const lEmail = envelope.email.toLowerCase();
    if (!identity.knownEmails.includes(lEmail)) {
      identity.knownEmails.push(lEmail);
    }
  }

  identityDB.set(targetId, identity);
  return identity;
}
