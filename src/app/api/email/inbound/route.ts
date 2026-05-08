/**
 * Email inbound webhook.
 *
 * Accepts normalized inbound email payloads from a mail provider bridge and
 * feeds them into the shared communication orchestrator. Email stays a
 * transport layer; business decisions happen in the canonical core.
 */

import { NextResponse } from 'next/server';
import { processMessage } from '@/lib/communication/orchestrator';
import {
  EmailAdapter,
  EmailInboundPayload,
  getPrimaryEmailAddress,
} from '@/lib/communication/channels/email';

export const runtime = 'nodejs';

const adapter = new EmailAdapter();

export async function POST(req: Request): Promise<Response> {
  let payload: EmailInboundPayload;
  try {
    payload = (await req.json()) as EmailInboundPayload;
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
        from:    getPrimaryEmailAddress(payload.from),
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

function isAutoReply(from: EmailInboundPayload['from']): boolean {
  const addr = getPrimaryEmailAddress(from);
  const local = addr.split('@')[0] ?? '';
  return AUTO_REPLY_RE.test(local);
}
