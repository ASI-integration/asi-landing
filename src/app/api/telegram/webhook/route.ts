import { NextResponse } from 'next/server';
import { auditError } from '@/lib/communication/audit';
import { processUpdate } from '@/lib/communication/orchestrator';
import { flushBackgroundTasks } from '@/lib/communication/background';
import { TelegramUpdate } from '@/lib/communication/types';

/**
 * Telegram Webhook — transport layer only.
 *
 * Responsibilities:
 *   1. Validate the webhook secret token (TELEGRAM_WEBHOOK_SECRET env var).
 *   2. Parse the request body as a TelegramUpdate.
 *   3. Delegate to the orchestrator.
 *   4. Always return HTTP 200 so Telegram does not retry on logic errors.
 *
 * All business logic, classification, persistence, and audit live in
 * src/lib/communication/.
 *
 * Webhook secret setup:
 *   Set TELEGRAM_WEBHOOK_SECRET to a random string (≥ 32 chars recommended).
 *   Register it with Telegram via:
 *     POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *       { url: "https://yourdomain/api/telegram/webhook",
 *         secret_token: "<TELEGRAM_WEBHOOK_SECRET>" }
 *   Telegram will then include the header X-Telegram-Bot-Api-Secret-Token on
 *   every delivery.  Requests missing or failing this check are rejected with
 *   HTTP 403 — Telegram will NOT retry 4xx responses, so this is safe.
 *
 *   If TELEGRAM_WEBHOOK_SECRET is unset the check is skipped (development
 *   mode / backward compatibility) but a warning is logged on every request.
 */

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

export async function POST(req: Request): Promise<NextResponse> {
  // ── 1. Webhook secret validation ─────────────────────────────────────────
  if (WEBHOOK_SECRET) {
    const incoming = req.headers.get('x-telegram-bot-api-secret-token');
    if (incoming !== WEBHOOK_SECRET) {
      // 403 — Telegram treats 4xx as final failures and will not retry.
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
  } else {
    // Only warn — don't break existing deployments that haven't set the secret.
    console.warn('[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET is not set — requests are unauthenticated');
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    // Malformed JSON — return 200 to avoid Telegram retry storms.
    auditError({ detail: 'Failed to parse request body as JSON' });
    return NextResponse.json({ ok: true });
  }

  // ── 3. Delegate to orchestrator ───────────────────────────────────────────
  await processUpdate(update);

  // ── 4. Flush background tasks before the serverless function exits ────────
  await flushBackgroundTasks();

  // ── 5. Always 200 ─────────────────────────────────────────────────────────
  return NextResponse.json({ ok: true });
}
