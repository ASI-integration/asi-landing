/**
 * VK Callback API webhook
 *
 * VK sends all community events here as POST requests.
 *
 * Confirmation flow:
 *   When you first register this URL in the VK community settings, VK sends
 *   a one-time {"type":"confirmation","group_id":...} request and expects the
 *   server to respond with a confirmation string (VK_WEBHOOK_CONFIRMATION).
 *
 * Security:
 *   Every payload from VK includes a `secret` field (if configured in VK app
 *   settings). We verify it against VK_WEBHOOK_SECRET.
 *
 * Required env vars:
 *   VK_WEBHOOK_CONFIRMATION  — confirmation string from VK Callback API settings
 *   VK_WEBHOOK_SECRET        — optional shared secret for payload verification
 */

import { NextResponse } from 'next/server';
import { processMessage } from '@/lib/communication/orchestrator';
import { VkCallbackPayload, VkAdapter, verifyVkWebhookSecret } from '@/lib/communication/channels/vk';

export const runtime = 'nodejs';

const adapter = new VkAdapter();

export async function POST(req: Request): Promise<Response> {
  let payload: VkCallbackPayload;
  try {
    payload = (await req.json()) as VkCallbackPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // VK confirmation handshake — must respond with the confirmation string as plain text
  if (payload.type === 'confirmation') {
    const confirmation = process.env.VK_WEBHOOK_CONFIRMATION;
    if (!confirmation) {
      console.error('[vk:webhook] VK_WEBHOOK_CONFIRMATION not set');
      return new Response('ok', { status: 200 });
    }
    return new Response(confirmation, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  // Verify shared secret
  if (!verifyVkWebhookSecret(payload)) {
    console.warn('[vk:webhook] secret mismatch');
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Only process new messages
  if (payload.type !== 'message_new') {
    // VK expects 'ok' for all delivered events
    return new Response('ok', { status: 200 });
  }

  if (!payload.object?.message?.text) {
    // Empty text (sticker, attachment-only) — acknowledge and skip
    return new Response('ok', { status: 200 });
  }

  try {
    const envelope = await adapter.normalizeInbound(payload);
    const result   = await processMessage(envelope);

    if (process.env.COMM_PIPELINE_DEBUG === '1') {
      console.log('[vk:webhook] processed', {
        outcome:  result.outcome,
        chat_id:  envelope.chatId,
      });
    }
  } catch (e) {
    console.error('[vk:webhook] processMessage threw', e);
    // Still respond 'ok' — VK retries on non-200 and we don't want storms.
  }

  // VK requires the string literal "ok" as the response body
  return new Response('ok', { status: 200 });
}
