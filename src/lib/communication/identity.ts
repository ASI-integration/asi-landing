/**
 * G1 — Durable guest identity persistence.
 *
 * Replaces the previous in-memory identityDB Map with Supabase
 * tg_guest_identities table so identity linkage survives cold starts.
 *
 * Table DDL: see supabase/migrations/20260326000001_comms_phase2_tables.sql
 *
 * Graceful degradation: if Supabase is unavailable, falls back to a
 * transient in-process identity so processing is never blocked.
 */

import { supabase } from '@/lib/supabase';
import { AuditEventType, InboundMessageEnvelope } from './types';
import { auditLog } from './audit';

export interface UnifiedGuestIdentity {
  guestId: string;
  knownEmails: string[];
  knownPhones: string[];
  knownChatIds: string[];
  firstName?: string;
  lastName?: string;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToIdentity(row: Record<string, unknown>): UnifiedGuestIdentity {
  return {
    guestId:      row.guest_id as string,
    knownChatIds: row.telegram_chat_id != null ? [String(row.telegram_chat_id)] : [],
    knownPhones:  row.phone  ? [row.phone  as string] : [],
    knownEmails:  row.email  ? [row.email  as string] : [],
    firstName:    row.first_name  as string | undefined,
    lastName:     row.last_name   as string | undefined,
  };
}

// ─── Derive a stable guest_id from a Telegram chat_id ────────────────────────
// Uses deterministic format so parallel requests for the same chat cannot
// produce duplicate guest_id values.

function guestIdFromChatId(chatId: number): string {
  return `tg_${chatId}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up an existing identity by chat ID, phone, or email.
 * Returns null if not found or Supabase is unavailable.
 */
export async function resolveGuestIdentity(
  envelope: InboundMessageEnvelope,
): Promise<UnifiedGuestIdentity | null> {
  try {
    if (envelope.chatId) {
      const chatId = parseInt(envelope.chatId, 10);
      const { data } = await supabase
        .from('tg_guest_identities')
        .select('*')
        .eq('telegram_chat_id', chatId)
        .maybeSingle();
      if (data) return rowToIdentity(data as Record<string, unknown>);
    }

    if (envelope.phoneNumber) {
      const { data } = await supabase
        .from('tg_guest_identities')
        .select('*')
        .eq('phone', envelope.phoneNumber)
        .maybeSingle();
      if (data) return rowToIdentity(data as Record<string, unknown>);
    }

    if (envelope.email) {
      const { data } = await supabase
        .from('tg_guest_identities')
        .select('*')
        .eq('email', envelope.email.toLowerCase())
        .maybeSingle();
      if (data) return rowToIdentity(data as Record<string, unknown>);
    }
  } catch {
    // Supabase unavailable — return null, caller falls back to createOrMerge
  }
  return null;
}

/**
 * Upsert the identity for an incoming message.
 *
 * - If the chat_id already has a row, updates phone/email/name fields.
 * - If not, creates a new row with a deterministic guest_id.
 * - On Supabase failure, returns a transient in-process identity so
 *   processing is never blocked.
 */
export async function createOrMergeIdentity(
  envelope: InboundMessageEnvelope,
  existingId?: string,
): Promise<UnifiedGuestIdentity> {
  const chatId    = envelope.chatId ? parseInt(envelope.chatId, 10) : null;
  const targetId  = existingId ?? (chatId != null ? guestIdFromChatId(chatId) : `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  const row = {
    ...(chatId != null && { telegram_chat_id: chatId }),
    guest_id:   targetId,
    phone:      envelope.phoneNumber ?? null,
    email:      envelope.email?.toLowerCase() ?? null,
    updated_at: new Date().toISOString(),
  };

  try {
    if (chatId != null) {
      // Upsert on the unique telegram_chat_id column
      const { error } = await supabase
        .from('tg_guest_identities')
        .upsert(row, { onConflict: 'telegram_chat_id', ignoreDuplicates: false });

      if (error) {
        auditLog({
          type:   AuditEventType.PersistError,
          detail: `createOrMergeIdentity upsert: ${error.message}`,
        });
      }
    } else {
      // No chat_id — plain insert (phone/email-only channels)
      const { error } = await supabase
        .from('tg_guest_identities')
        .insert({ ...row, created_at: new Date().toISOString() });

      if (error && error.code !== '23505') {
        auditLog({
          type:   AuditEventType.PersistError,
          detail: `createOrMergeIdentity insert: ${error.message}`,
        });
      }
    }
  } catch (err) {
    auditLog({
      type:   AuditEventType.PersistError,
      detail: `createOrMergeIdentity exception: ${String(err)}`,
    });
  }

  return {
    guestId:      targetId,
    knownChatIds: chatId != null ? [String(chatId)] : [],
    knownPhones:  envelope.phoneNumber ? [envelope.phoneNumber] : [],
    knownEmails:  envelope.email ? [envelope.email.toLowerCase()] : [],
  };
}
