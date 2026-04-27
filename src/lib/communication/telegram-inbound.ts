/**
 * Telegram inbound normalization layer.
 *
 * Converts a raw Telegram update into a stable typed shape before it enters
 * the communication pipeline. Keeps the pipeline boundary explicit and makes
 * the normalization independently testable.
 *
 * This module is deliberately dependency-free (no supabase, no LLM, no I/O).
 */

import type { TelegramUpdate, TelegramMessage } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TelegramMessageType =
  | 'text'
  | 'voice'
  | 'audio'
  | 'photo'
  | 'document'
  | 'other';

/**
 * Canonical normalized representation of a Telegram inbound message.
 * This is the "seam" between the raw Telegram webhook payload and the
 * internal communication pipeline.
 */
export interface NormalizedTelegramInbound {
  provider: 'telegram';
  updateId: number;
  /** Stable identifier for the Telegram message (message_id within chat). */
  externalMessageId: string;
  /** Telegram chat_id — stable key for session management. */
  externalChatId: string;
  /** Telegram from.id if available; falls back to externalChatId for private chats. */
  externalUserId: string;
  externalUsername?: string;
  languageCode?: string;
  /** Normalized text content (empty string for non-text messages). */
  text: string;
  messageType: TelegramMessageType;
  receivedAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveMessageType(message: TelegramMessage): TelegramMessageType {
  if (message.voice) return 'voice';
  if (message.audio) return 'audio';
  if (message.photo && message.photo.length > 0) return 'photo';
  if (message.document) return 'document';
  if (message.text || message.caption) return 'text';
  return 'other';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a raw Telegram update into `NormalizedTelegramInbound`.
 *
 * Returns null when the update carries no actionable message
 * (e.g. channel posts, poll answers, callback queries without message).
 *
 * Never throws — all errors return null.
 */
export function normalizeTelegramUpdate(
  update: unknown,
): NormalizedTelegramInbound | null {
  try {
    if (!update || typeof update !== 'object') return null;
    const u = update as TelegramUpdate;

    if (typeof u.update_id !== 'number') return null;

    const message = u.message ?? u.edited_message;
    if (!message) return null;

    const chatId = message.chat?.id;
    if (chatId == null) return null;

    const externalChatId = String(chatId);
    // For private chats from.id === chat.id, but we prefer from.id when
    // available so group-chat senders are individually identified.
    const externalUserId =
      message.from?.id != null ? String(message.from.id) : externalChatId;
    const externalUsername = message.from?.username ?? undefined;
    const languageCode = message.from?.language_code ?? undefined;

    return {
      provider: 'telegram',
      updateId: u.update_id,
      externalMessageId: String(message.message_id),
      externalChatId,
      externalUserId,
      ...(externalUsername ? { externalUsername } : {}),
      ...(languageCode ? { languageCode } : {}),
      text: message.text ?? message.caption ?? '',
      messageType: resolveMessageType(message),
      receivedAt: new Date(),
    };
  } catch {
    return null;
  }
}

/**
 * Build a stable idempotency key for an inbound Telegram message.
 * Used by the idempotency store to deduplicate retried webhook deliveries.
 */
export function buildTelegramInboundKey(norm: NormalizedTelegramInbound): string {
  return `telegram:${norm.externalChatId}:msg:${norm.externalMessageId}`;
}
