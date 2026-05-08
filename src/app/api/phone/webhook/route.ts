/**
 * Generic phone webhook endpoint.
 *
 * Accepts provider-agnostic telephony call events. Phone Phase 1 logs calls,
 * creates operator review items, and routes transcript text through the shared
 * communication orchestrator when a provider supplies it.
 */

import { NextResponse } from 'next/server';
import {
  normalizePhoneWebhookPayload,
  verifyPhoneWebhookSecret,
  type PhoneWebhookPayload,
} from '@/lib/communication/channels/phone';
import { processPhoneCallEvent } from '@/lib/communication/phone-support';
import { runInBackground } from '@/lib/communication/background';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  if (!verifyPhoneWebhookSecret(req.headers, req.url)) {
    console.warn('[phone:webhook] secret mismatch');
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let payload: PhoneWebhookPayload;
  try {
    payload = (await req.json()) as PhoneWebhookPayload;
  } catch {
    console.warn('[phone:webhook] invalid json ignored');
    return NextResponse.json({ ok: true, ignored: true, reason: 'invalid_json' }, { status: 200 });
  }

  const normalized = normalizePhoneWebhookPayload(payload);
  if (!normalized.supported) {
    console.info('[phone:webhook] ignored', { reason: normalized.reason });
    return NextResponse.json({ ok: true, ignored: true, reason: normalized.reason }, { status: 200 });
  }

  const event = normalized.event;
  console.info('[phone:webhook] accepted', {
    provider: event.provider,
    eventType: event.eventType,
    providerCallId: event.providerCallId,
    hasTranscript: Boolean(event.transcriptText),
    hasRecording: Boolean(event.recordingUrl),
  });

  runInBackground(
    {
      correlationId: event.idempotencyKey,
      module: 'phone-webhook',
      taskName: 'processPhoneCallEvent',
      triggerId: event.providerCallId,
    },
    () => processPhoneCallEvent(event),
  );

  return NextResponse.json(
    {
      ok: true,
      accepted: true,
      eventType: event.eventType,
      providerCallId: event.providerCallId,
    },
    { status: 200 },
  );
}
