import { NextResponse } from 'next/server';
import {
  processResendInboundWebhook,
  ResendInboundError,
} from '@/lib/communication/resend-email-inbound';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  try {
    const result = await processResendInboundWebhook({
      rawBody,
      headers: req.headers,
    });

    if (result.ignored) {
      return NextResponse.json({ ok: true, ignored: true, reason: result.reason }, { status: 200 });
    }

    if (process.env.COMM_PIPELINE_DEBUG === '1') {
      console.log('[email:resend] processed', {
        email_id: result.emailId,
        skipped: result.processing.skipped ?? null,
        outcome: result.processing.orchestrator?.outcome ?? null,
        review_id: result.processing.reviewId ?? null,
        outbound_mode: result.processing.outboundMode ?? null,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        emailId: result.emailId,
        skipped: result.processing.skipped,
        reviewId: result.processing.reviewId,
        outboundMode: result.processing.outboundMode,
        outcome: result.processing.orchestrator?.outcome,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ResendInboundError) {
      console.warn('[email:resend] rejected', {
        code: error.code,
        status: error.httpStatus,
      });
      return NextResponse.json({ ok: false, error: error.code }, { status: error.httpStatus });
    }

    console.error('[email:resend] unexpected failure', {
      error_type: (error as Error).name || 'unexpected',
    });
    return NextResponse.json({ ok: false, error: 'processing_failed' }, { status: 503 });
  }
}
