/**
 * VK Channel Adapter
 *
 * Handles inbound messages from VK via the Callback API and outbound replies
 * via the VK Community Messages API (messages.send).
 *
 * Required env vars:
 *   VK_COMMUNITY_TOKEN   — community access token (messages, offline, groups)
 *   VK_GROUP_ID          — community/group ID (numeric string)
 *   VK_WEBHOOK_SECRET    — secret string configured in the VK app Callback API settings
 *
 * VK Callback API webhook payload for message_new:
 *   { type: "message_new", object: { message: { id, from_id, peer_id, text, date } }, group_id, secret }
 *
 * DB migration note:
 *   Run supabase/migrations/20260410000001_tg_contacts_vk_id.sql to add the
 *   vk_id column to tg_contacts before deploying this adapter.
 */

import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

// ─── VK Callback API payload shape ───────────────────────────────────────────

export interface VkCallbackPayload {
  type: string;
  object?: {
    message?: {
      id:      number;
      from_id: number;
      peer_id: number;
      text:    string;
      date:    number;
      attachments?: unknown[];
    };
  };
  group_id: number;
  secret?:  string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class VkAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'vk';

  /**
   * Normalise a VK message_new payload into a standard envelope.
   * Caller is responsible for verifying the secret before calling this.
   */
  async normalizeInbound(rawPayload: VkCallbackPayload): Promise<InboundMessageEnvelope> {
    const msg = rawPayload.object?.message;
    if (!msg) throw new Error('[VkAdapter] normalizeInbound: no message in payload');

    return {
      channel:        'vk',
      externalUserId: String(msg.from_id),
      chatId:         String(msg.peer_id),
      messageText:    msg.text,
      receivedAt:     new Date(msg.date * 1000),
      update_id:      msg.id,
      metadata: {
        group_id: rawPayload.group_id,
        peer_id:  msg.peer_id,
        from_id:  msg.from_id,
      },
    };
  }

  /**
   * Send a message to a VK peer via messages.send.
   * `to` is the peer_id (user or chat room) as a string.
   */
  async sendMessage(to: string, content: string): Promise<boolean> {
    const token = process.env.VK_COMMUNITY_TOKEN;
    if (!token) {
      console.error('[VkAdapter] VK_COMMUNITY_TOKEN not configured');
      return false;
    }

    const url = new URL('https://api.vk.com/method/messages.send');
    url.searchParams.set('peer_id',   to);
    url.searchParams.set('message',   content);
    url.searchParams.set('random_id', String(Math.floor(Math.random() * 2_147_483_647)));
    url.searchParams.set('access_token', token);
    url.searchParams.set('v',         '5.131');

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
  const expected = process.env.VK_WEBHOOK_SECRET;
  if (!expected) return true;
  return payload.secret === expected;
}
