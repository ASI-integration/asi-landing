/**
 * Email inbound webhook
 *
 * Accepts inbound email payloads from Resend's inbound routing feature.
 * Parses the email, builds an InboundMessageEnvelope, and feeds it into
 * the shared processMessage() orchestrator — same pipeline as Telegram/VK.
 *
 * Resend inbound setup:
 *   1. Add and verify your domain in Resend → Domains.
 *   2. Create an Inbound Route pointing to: https://yourdomain.com/api/email/inbound
 *   3. Resend will POST a JSON payload matching ResendInboundPayload on every received email.
 *
 * Security:
 *   Verify requests using RESEND_WEBHOOK_SECRET (Resend signs inbound webhook POSTs
 *   with a Svix signature header). If the env var is unset, the check is skipped
 *   (suitable for local dev only).
 *
 * Required env vars:
 *   RESEND_WEBHOOK_SECRET  — signing secret from Resend webhook settings (optional but recommended)
 */

import { NextResponse } from 'next/server';
import { processMessage } from '@/lib/communication/orchestrator';
import { EmailAdapter, ResendInboundPayload } from '@/lib/communication/channels/email';

export const runtime = 'nodejs';

const adapter = new EmailAdapter();

export async function POST(req: Request): Promise<Response> {
  // Optional signature verification (Resend uses Svix-style HMAC headers)
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get('svix-signature') ?? req.headers.get('Svix-Signature');
    if (!signature) {
      console.warn('[email:inbound] missing signature header');
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    // Full HMAC verification would require the svix SDK or manual HMAC-SHA256.
    // For now we gate on header presence when the secret is configured.
    // TODO: implement full Svix HMAC-SHA256 verification.
  }

  let payload: ResendInboundPayload;
  try {
    payload = (await req.json()) as ResendInboundPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Ignore bounced / auto-reply loops (no-reply, mailer-daemon, etc.)
  if (isAutoReply(payload.from)) {
    return NextResponse.json({ ok: true, skipped: 'auto_reply' }, { status: 200 });
  }

  try {
    const envelope = await adapter.normalizeInbound(payload);
    const result   = await processMessage(envelope);

    if (process.env.COMM_PIPELINE_DEBUG === '1') {
      console.log('[email:inbound] processed', {
        outcome: result.outcome,
        from:    payload.from,
        subject: payload.subject,
      });
    }
  } catch (e) {
    console.error('[email:inbound] processMessage threw', e);
    // Return 200 to prevent Resend from resending.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AUTO_REPLY_RE = /^(no-?reply|mailer-daemon|postmaster|bounce|auto[-_]?reply|noreply)/i;

function isAutoReply(from: string): boolean {
  const addr = from.includes('<') ? (from.match(/<([^>]+)>/)?.[1] ?? from) : from;
  const local = addr.split('@')[0] ?? '';
  return AUTO_REPLY_RE.test(local);
}
