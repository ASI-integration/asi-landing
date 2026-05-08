/**
 * MAX Bot API webhook.
 *
 * MAX is production webhook-only here: valid message_created events are
 * normalized into the shared communication envelope and processed by the
 * canonical communication orchestrator.
 */

import { NextResponse } from 'next/server';
import { processMessage } from '@/lib/communication/orchestrator';
import {
  MaxAdapter,
  type MaxWebhookPayload,
  maxWebhookEventType,
  maxWebhookText,
  verifyMaxWebhookSecret,
} from '@/lib/communication/channels/max';

export const runtime = 'nodejs';

const adapter = new MaxAdapter();

export async function POST(req: Request): Promise<Response> {
  if (!verifyMaxWebhookSecret(req.headers.get('x-max-bot-api-secret'))) {
    console.warn('[max:webhook] secret mismatch');
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let payload: MaxWebhookPayload;
  try {
    payload = (await req.json()) as MaxWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const eventType = maxWebhookEventType(payload);
  if (eventType !== 'message_created') {
    return NextResponse.json({ ok: true, ignored: true, reason: 'unsupported_event' }, { status: 200 });
  }

  if (!maxWebhookText(payload)) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'empty_message' }, { status: 200 });
  }

  try {
    const envelope = await adapter.normalizeInbound(payload);
    const result = await processMessage(envelope);
    if (process.env.COMM_PIPELINE_DEBUG === '1') {
      console.log('[max:webhook] processed', {
        outcome: result.outcome,
        chat_id: envelope.chatId,
      });
    }
  } catch (error) {
    console.error('[max:webhook] processMessage threw', error);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
