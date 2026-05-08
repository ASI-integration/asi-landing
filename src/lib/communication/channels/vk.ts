/**
 * VK channel adapter.
 *
 * VK is transport-only. Inbound callbacks are normalized into the shared
 * envelope and then processed by the canonical communication core.
 */

import { createHash, randomUUID } from 'node:crypto';
import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

// ─── VK Callback API payload shape ───────────────────────────────────────────

export interface VkCallbackPayload {
  type: string;
  object?: {
    message?: {
      id: number;
      conversation_message_id?: number;
      from_id: number;
      peer_id: number;
      text: string;
      date: number;
      attachments?: unknown[];
    };
  };
  group_id: number;
  event_id?: string;
  secret?: string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class VkAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'vk';

  async normalizeInbound(rawPayload: VkCallbackPayload): Promise<InboundMessageEnvelope> {
    const msg = rawPayload.object?.message;
    if (!msg) throw new Error('[VkAdapter] normalizeInbound: no message in payload');
    const providerMessageId = stableVkProviderMessageId(rawPayload);
    const updateId = stablePositiveInt(providerMessageId);

    return {
      channel: 'vk',
      externalUserId: String(msg.from_id),
      chatId: String(msg.peer_id),
      messageText: msg.text,
      receivedAt: parseVkDate(msg.date),
      update_id: updateId,
      metadata: {
        provider: 'vk',
        providerMessageId,
        externalMessageId: providerMessageId,
        message_id: providerMessageId,
        vk_message_id: msg.id,
        vk_conversation_message_id: msg.conversation_message_id ?? null,
        vk_event_id: rawPayload.event_id ?? null,
        group_id: rawPayload.group_id,
        peer_id: msg.peer_id,
        from_id: msg.from_id,
      },
    };
  }

  async sendMessage(to: string, content: string): Promise<boolean> {
    const token = process.env.VK_API_TOKEN;
    const groupId = String(process.env.VK_GROUP_ID ?? '').trim();
    const version = String(process.env.VK_API_VERSION ?? '5.199').trim() || '5.199';
    if (!token || !groupId) {
      console.error('[VkAdapter] VK_API_TOKEN / VK_GROUP_ID not configured');
      return false;
    }

    const url = new URL('https://api.vk.com/method/messages.send');
    url.searchParams.set('peer_id',   to);
    url.searchParams.set('message',   content);
    url.searchParams.set('group_id', groupId);
    url.searchParams.set('random_id', stableVkRandomId(to, content));
    url.searchParams.set('access_token', token);
    url.searchParams.set('v', version);

    try {
      const res  = await fetch(url.toString(), { method: 'POST' });
      const json = (await res.json()) as { response?: number; error?: { error_code: number; error_msg: string } };

      if (json.error) {
        console.error('[VkAdapter] API error', json.error);
        return false;
      }
      return typeof json.response === 'number';
    } catch (e) {
      console.error('[VkAdapter] sendMessage failed', e);
      return false;
    }
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    // VK is conversational — keep it short. Max 4096 chars per message.
    const trimmed = rawMessage.trim();
    return trimmed.length > 4096 ? trimmed.substring(0, 4093) + '...' : trimmed;
  }
}

// ─── Webhook signature verification ──────────────────────────────────────────

/**
 * Returns true if the payload's `secret` matches VK_WEBHOOK_SECRET.
 * If the env var is not set, all payloads are accepted (useful for local dev).
 */
export function verifyVkWebhookSecret(payload: VkCallbackPayload): boolean {
  const expected = process.env.VK_CALLBACK_SECRET;
  if (!expected) return true;
  return payload.secret === expected;
}

function stableVkProviderMessageId(payload: VkCallbackPayload): string {
  const msg = payload.object?.message;
  const peer = msg?.peer_id ?? 0;
  const from = msg?.from_id ?? 0;
  const id = msg?.id ?? 0;
  const convoId = msg?.conversation_message_id ?? 0;
  const eventId = payload.event_id ?? '';
  if (eventId) return `vk:${payload.group_id}:${eventId}`;
  if (id > 0) return `vk:${payload.group_id}:${peer}:${id}`;
  return `vk:${payload.group_id}:${peer}:${from}:${convoId}:${msg?.date ?? 0}`;
}

function stablePositiveInt(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  const n = hash.readUInt32BE(0);
  return n === 0 ? 1 : n;
}

function stableVkRandomId(peerId: string, content: string): string {
  const seed = `${peerId}:${content}:${randomUUID()}`;
  const hash = createHash('sha256').update(seed).digest();
  return String(hash.readUInt32BE(0));
}

function parseVkDate(unixSeconds: number): Date {
  const ms = Number(unixSeconds) * 1000;
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
