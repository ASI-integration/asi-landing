/**
 * Email Channel Adapter (Resend)
 *
 * Sends outbound emails via the Resend REST API (no SDK dependency).
 * Normalises inbound webhooks from Resend's inbound email feature.
 *
 * Required env vars:
 *   RESEND_API_KEY   — Resend API key (re_...)
 *   EMAIL_FROM       — verified sender address, e.g. "support@yourdomain.com"
 *
 * Optional env vars:
 *   EMAIL_REPLY_TO   — reply-to header override
 *
 * Inbound email handling:
 *   Configure a Resend inbound route to POST to /api/email/inbound.
 *   The raw webhook payload is normalised in normalizeInbound().
 *
 * Thread continuity:
 *   Pass metadata.subject and metadata.in_reply_to when sending follow-ups so
 *   mail clients group them into the same thread.
 */

import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

const RESEND_SEND_URL = 'https://api.resend.com/emails';

// ─── Resend inbound webhook payload (minimal surface we need) ─────────────────

export interface ResendInboundPayload {
  from:       string;            // "Name <email@example.com>" or bare email
  to:         string[];
  subject?:   string;
  text?:      string;
  html?:      string;
  message_id: string;
  in_reply_to?: string;
  reply_to?:  string[];
  date?:      string;           // RFC 2822 or ISO
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class EmailAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'email';

  async normalizeInbound(rawPayload: ResendInboundPayload): Promise<InboundMessageEnvelope> {
    const fromEmail = extractEmail(rawPayload.from);
    const body = rawPayload.text ?? stripHtml(rawPayload.html ?? '');

    return {
      channel:        'email',
      externalUserId: fromEmail,
      email:          fromEmail,
      messageText:    body.trim(),
      subject:        rawPayload.subject,
      receivedAt:     rawPayload.date ? new Date(rawPayload.date) : new Date(),
      metadata: {
        message_id:   rawPayload.message_id,
        in_reply_to:  rawPayload.in_reply_to ?? null,
        reply_to:     rawPayload.reply_to ?? [],
        to:           rawPayload.to,
      },
    };
  }

  /**
   * Send an email via Resend REST API.
   *
   * `to`       — recipient email address
   * `content`  — plain-text body (adapter adds signature)
   * `metadata` — optional: subject, in_reply_to (for threading)
   */
  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const apiKey  = process.env.RESEND_API_KEY;
    const from    = process.env.EMAIL_FROM ?? 'support@automationasi.com';
    const replyTo = process.env.EMAIL_REPLY_TO;

    if (!apiKey) {
      console.error('[EmailAdapter] RESEND_API_KEY not configured');
      return false;
    }

    const subject   = (metadata?.subject as string | undefined) ?? 'Re: Your Inquiry';
    const inReplyTo = metadata?.in_reply_to as string | undefined;

    const body: Record<string, unknown> = {
      from,
      to:      [to],
      subject,
      text:    content,
    };
    if (replyTo)    body.reply_to = [replyTo];
    if (inReplyTo) body.headers = { 'In-Reply-To': inReplyTo, References: inReplyTo };

    try {
      const res = await fetch(RESEND_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[EmailAdapter] Resend API error', res.status, err);
        return false;
      }

      return true;
    } catch (e) {
      console.error('[EmailAdapter] sendMessage failed', e);
      return false;
    }
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    const signature = '\n\nBest regards,\nAutomationASI Support\nsupport@automationasi.com';
    return `${rawMessage.trim()}${signature}`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract bare email from a "Name <email>" header value. */
function extractEmail(header: string): string {
  const match = header.match(/<([^>]+)>/);
  return (match ? match[1] : header).trim().toLowerCase();
}

/** Minimal HTML → plain-text strip (no dependency). */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
