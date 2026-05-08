/**
 * MAX channel adapter.
 *
 * MAX is transport-only. Inbound webhooks are normalized into the shared
 * communication envelope and then processed by the canonical communication core.
 */

import { createHash } from 'node:crypto';
import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

export interface MaxWebhookPayload {
  update_type?: string;
  type?: string;
  event_type?: string;
  event_id?: string | number;
  update_id?: string | number;
  timestamp?: string | number;
  user_id?: string | number;
  chat_id?: string | number;
  user?: { user_id?: string | number; id?: string | number } | null;
  chat?: { chat_id?: string | number; id?: string | number } | null;
  message?: MaxWebhookMessage | null;
  object?: {
    message?: MaxWebhookMessage | null;
  } | null;
}

export interface MaxWebhookMessage {
  id?: string | number;
  message_id?: string | number;
  timestamp?: string | number;
  created_at?: string | number;
  text?: string;
  body?: {
    text?: string;
  } | null;
  user_id?: string | number;
  chat_id?: string | number;
  sender?: {
    user_id?: string | number;
    id?: string | number;
  } | null;
  chat?: {
    chat_id?: string | number;
    id?: string | number;
  } | null;
  recipient?: {
    chat_id?: string | number;
    user_id?: string | number;
  } | null;
}

export class MaxAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'max';

  async normalizeInbound(rawPayload: MaxWebhookPayload): Promise<InboundMessageEnvelope> {
    const message = rawPayload.message ?? rawPayload.object?.message ?? null;
    if (!message) throw new Error('[MaxAdapter] normalizeInbound: no message in payload');

    const text = extractMaxText(message);
    const userId = normalizeMaxId(
      message.sender?.user_id ??
        message.sender?.id ??
        message.user_id ??
        rawPayload.user?.user_id ??
        rawPayload.user?.id ??
        rawPayload.user_id ??
        message.recipient?.user_id,
    );
    const chatId = normalizeMaxId(
      message.chat_id ??
        message.chat?.chat_id ??
        message.chat?.id ??
        message.recipient?.chat_id ??
        rawPayload.chat?.chat_id ??
        rawPayload.chat?.id ??
        rawPayload.chat_id,
    );
    const providerMessageId = stableMaxProviderMessageId(rawPayload, message, userId, chatId, text);
    const updateType = normalizeMaxId(rawPayload.update_type ?? rawPayload.type ?? rawPayload.event_type) ?? 'unknown';

    return {
      channel: 'max',
      externalUserId: userId ?? chatId ?? providerMessageId,
      chatId: chatId ?? undefined,
      messageText: text,
      receivedAt: parseMaxTimestamp(message.timestamp ?? message.created_at ?? rawPayload.timestamp),
      update_id: stablePositiveInt(providerMessageId),
      metadata: {
        provider: 'max',
        providerMessageId,
        externalMessageId: providerMessageId,
        message_id: normalizeMaxId(message.id ?? message.message_id) ?? providerMessageId,
        max_message_id: normalizeMaxId(message.id ?? message.message_id) ?? null,
        max_event_id: normalizeMaxId(rawPayload.event_id ?? rawPayload.update_id) ?? null,
        update_type: updateType,
        user_id: userId ?? null,
        chat_id: chatId ?? null,
      },
    };
  }

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const token = String(process.env.MAX_BOT_TOKEN ?? '').trim();
    if (!token) {
      console.error('[MaxAdapter] MAX_BOT_TOKEN is not configured');
      return false;
    }

    const baseUrl = String(process.env.MAX_API_BASE_URL ?? 'https://platform-api.max.ru').trim();
    const url = new URL('/messages', baseUrl);
    const chatId = normalizeMaxId(metadata?.chat_id ?? metadata?.max_chat_id);
    const userId = normalizeMaxId(metadata?.user_id ?? metadata?.max_user_id ?? (chatId ? null : to));
    const body: Record<string, string> = {
      text: limitMaxText(content),
    };
    if (chatId) body.chat_id = chatId;
    else if (userId) body.user_id = userId;
    else {
      console.error('[MaxAdapter] no MAX user_id or chat_id target');
      return false;
    }

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error('[MaxAdapter] API error', { status: res.status, statusText: res.statusText });
        return false;
      }
      return true;
    } catch (error) {
      console.error('[MaxAdapter] sendMessage failed', error);
      return false;
    }
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    return limitMaxText(rawMessage.trim());
  }
}

export function verifyMaxWebhookSecret(headerSecret: string | null | undefined): boolean {
  const expected = process.env.MAX_WEBHOOK_SECRET;
  if (!expected) return true;
  return String(headerSecret ?? '') === expected;
}

export function maxWebhookEventType(payload: MaxWebhookPayload): string {
  return String(payload.update_type ?? payload.type ?? payload.event_type ?? '').trim();
}

export function maxWebhookText(payload: MaxWebhookPayload): string {
  const message = payload.message ?? payload.object?.message ?? null;
  return message ? extractMaxText(message) : '';
}

function extractMaxText(message: MaxWebhookMessage): string {
  return String(message.body?.text ?? message.text ?? '').trim();
}

function normalizeMaxId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function stableMaxProviderMessageId(
  payload: MaxWebhookPayload,
  message: MaxWebhookMessage,
  userId: string | null,
  chatId: string | null,
  text: string,
): string {
  const eventId = normalizeMaxId(payload.event_id ?? payload.update_id);
  if (eventId) return `max:${eventId}`;
  const messageId = normalizeMaxId(message.id ?? message.message_id);
  const actor = chatId ?? userId ?? 'unknown';
  if (messageId) return `max:${actor}:${messageId}`;
  const basis = JSON.stringify({
    actor,
    text,
    timestamp: message.timestamp ?? message.created_at ?? payload.timestamp ?? null,
    updateType: payload.update_type ?? payload.type ?? payload.event_type ?? null,
  });
  return `max:${actor}:${createHash('sha256').update(basis).digest('hex').slice(0, 24)}`;
}

function stablePositiveInt(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  const n = hash.readUInt32BE(0);
  return n === 0 ? 1 : n;
}

function parseMaxTimestamp(value: unknown): Date {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const n = Number(value);
    const ms = n > 10_000_000_000 ? n : n * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

function limitMaxText(value: string): string {
  const text = String(value ?? '').trim();
  return text.length > 4000 ? `${text.slice(0, 3997).trim()}...` : text;
}
