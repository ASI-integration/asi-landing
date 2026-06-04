/**
 * Email inbound webhook.
 *
 * Accepts normalized inbound email payloads from a mail provider bridge and
 * feeds them into the shared communication orchestrator. Email stays a
 * transport layer; business decisions happen in the canonical core.
 */

import { NextResponse } from 'next/server';
import {
  EmailInboundPayload,
  getPrimaryEmailAddress,
} from '@/lib/communication/channels/email';
import { processEmailInbound } from '@/lib/communication/email-inbound-processor';

export const runtime = 'nodejs';

const AUTO_REPLY_RE = /^(no-?reply|mailer-daemon|postmaster|bounce|auto[-_]?reply|noreply)/i;

export async function POST(req: Request): Promise<Response> {
  let payload: EmailInboundPayload;
  try {
    payload = (await req.json()) as EmailInboundPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (isAutoReply(payload.from)) {
    return NextResponse.json({ ok: true, skipped: 'auto_reply' }, { status: 200 });
  }

  try {
    const result = await processEmailInbound({ payload });

    if (process.env.COMM_PIPELINE_DEBUG === '1') {
      console.log('[email:inbound] processed', {
        outcome: result.orchestrator?.outcome,
        skipped: result.skipped,
        reviewId: result.reviewId,
        outboundMode: result.outboundMode,
        from: result.from ?? getPrimaryEmailAddress(payload.from),
        subject: result.subject ?? payload.subject,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        skipped: result.skipped,
        reviewId: result.reviewId,
        outboundMode: result.outboundMode,
        outcome: result.orchestrator?.outcome,
        draftOnly: result.outboundMode === 'draft_only',
      },
      { status: 200 },
    );
  } catch (e) {
    console.error('[email:inbound] processEmailInbound threw', e);
    // Return 200 to prevent provider resend loops.
    return NextResponse.json({ ok: true, error: 'processing_failed' }, { status: 200 });
  }
}

function isAutoReply(from: EmailInboundPayload['from']): boolean {
  const addr = getPrimaryEmailAddress(from);
  const local = addr.split('@')[0] ?? '';
  return AUTO_REPLY_RE.test(local);
}
