import { NextResponse } from 'next/server';

import { processUpdate } from '@/lib/communication/orchestrator';
import { processTelegramVoiceUpdate } from '@/lib/communication/telegram-voice-inbound';
import {
  claimTelegramInboundReceipt,
  completeTelegramInboundReceipt,
  failTelegramInboundReceipt,
} from '@/lib/communication/telegram-inbound-receipts';
import type { TelegramUpdate } from '@/lib/communication/types';
import { ProcessOutcome } from '@/lib/communication/types';
import { sendTelegramChatAction } from '@/lib/telegram';

export const runtime = 'nodejs';
// Production Telegram webhook entrypoint. The active production bot is determined only by runtime TELEGRAM_BOT_TOKEN;
// local helper scripts/env files are not the source of truth for production bot identity.

function getHeader(req: Request, name: string): string | null {
  // Headers are case-insensitive, but Next's Request exposes a normalized map.
  return req.headers.get(name);
}

function preview(text: string, max = 120): string {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function sendTypingIndicator(chatId: number | undefined, updateId: number | undefined, path: string): void {
  if (typeof chatId !== 'number') return;
  void sendTelegramChatAction(chatId, 'typing', {
    handler: `telegram_webhook:${path}`,
    update_id: updateId,
  }).catch(() => undefined);
}

export async function POST(req: Request): Promise<Response> {
  const webhookStartedAt = Date.now();
  const secretExpected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const secretGot =
    getHeader(req, 'x-telegram-bot-api-secret-token') ??
    getHeader(req, 'X-Telegram-Bot-Api-Secret-Token');

  if (!secretExpected?.trim()) {
    console.error('[tg:webhook] 503 webhook secret is not configured');
    return NextResponse.json({ ok: false, error: 'service_unavailable' }, { status: 503 });
  }

  if (secretGot !== secretExpected) {
    console.warn('[tg:webhook] 403 secret mismatch', {
      hasSecretHeader: Boolean(secretGot),
    });
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let update: TelegramUpdate | null = null;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (e) {
    console.error('[tg:webhook] invalid json body', e);
    // Always return 200 to prevent Telegram retry storms on bad payloads.
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  const telegramEventType = update?.callback_query
    ? 'callback_query'
    : update?.edited_message
      ? 'edited_message'
      : update?.message
        ? 'message'
        : 'unknown';
  // callback_query carries the source message under callback_query.message (no top-level message).
  const message =
    update?.edited_message ?? update?.message ?? update?.callback_query?.message;
  const chatId = message?.chat?.id;
  const text = message?.text ?? message?.caption ?? '';
  const hasVoice = Boolean(message?.voice) && !update?.callback_query;
  const hasAudio = Boolean(message?.audio) && !update?.callback_query;
  const hasText = Boolean(text) && !update?.callback_query;
  // Always log webhook receipt — minimal fields, no PII beyond chat_id
  console.info('[tg:webhook] recv', {
    update_id: update?.update_id,
    chat_id: chatId,
    telegram_event_type: telegramEventType,
    has_edited_message: Boolean(update?.edited_message),
    has_voice: hasVoice,
    has_audio: hasAudio,
    has_text: hasText,
  });
  console.info('[tg:latency] webhook.received', {
    update_id: update?.update_id,
    chat_id: chatId,
    stage_ms: Date.now() - webhookStartedAt,
  });

  let claim: Awaited<ReturnType<typeof claimTelegramInboundReceipt>>;
  try {
    claim = await claimTelegramInboundReceipt(update);
  } catch (error) {
    console.error('[tg:webhook] durable receipt failed', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: 'receipt_unavailable' }, { status: 503 });
  }

  if (claim.action === 'duplicate') {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }
  if (claim.action === 'busy') {
    return NextResponse.json({ ok: false, error: 'processing_in_progress' }, { status: 503 });
  }

  // From this point onward the database receipt owns the event. The stored payload
  // and stored tenant scope are canonical for retries; request-supplied scope is never used.
  update = claim.update;
  if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
    const voice = (message as any)?.voice ?? null;
    const audio = (message as any)?.audio ?? null;
    console.log('[tg:webhook] inbound', {
      update_id: update?.update_id,
      chat_id: chatId,
      telegram_event_type: telegramEventType,
      text_preview: preview(text),
      has_message: Boolean(message),
      has_voice: Boolean(voice),
      has_audio: Boolean(audio),
      voice_mime_type: voice?.mime_type ?? null,
      voice_duration: voice?.duration ?? null,
    });
  }

  try {
    if (update && (hasVoice || hasAudio) && chatId) {
      sendTypingIndicator(chatId, update.update_id, 'voice');
      console.info('[comm:routing]', {
        path: 'telegram_voice',
        update_id: update.update_id,
        chat_id: chatId,
        telegram_event_type: telegramEventType,
        has_voice: hasVoice,
        has_audio: hasAudio,
      });
      const voiceResult = await processTelegramVoiceUpdate(update, { durableReceiptOwned: true });
      if (voiceResult.outcome === 'voice_fallback_sent' && voiceResult.reason === 'processing_failed') {
        await failTelegramInboundReceipt({ claim, failureCode: 'process_outcome_error' });
        return NextResponse.json({ ok: false, error: 'processing_failed' }, { status: 503 });
      }
      await completeTelegramInboundReceipt({ claim, outcome: voiceResult.outcome });
      return NextResponse.json({ ok: true, path: voiceResult.outcome }, { status: 200 });
    }

    // processUpdate → session store → LLM intent → rule-based decision/escalation → reply | ask | escalate (see orchestrator)
    if (hasText && typeof chatId === 'number') {
      sendTypingIndicator(chatId, update?.update_id, 'text');
    }
    const result = await processUpdate(update, { durableReceiptOwned: true });
    if (result.outcome === ProcessOutcome.Error) {
      await failTelegramInboundReceipt({ claim, failureCode: 'process_outcome_error' });
      return NextResponse.json({ ok: false, error: 'processing_failed' }, { status: 503 });
    }
    await completeTelegramInboundReceipt({ claim, outcome: result.outcome });
    if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
      console.log('[tg:webhook] processed', {
        outcome: result.outcome,
        update_id: result.update_id,
        chat_id: (result as any).chat_id,
        telegram_event_type: telegramEventType,
      });
    }
  } catch (e) {
    console.error('[tg:webhook] processUpdate threw', e);
    try {
      await failTelegramInboundReceipt({ claim, failureCode: 'processing_threw' });
    } catch (failureError) {
      console.error(
        '[tg:webhook] failed to transition durable receipt',
        failureError instanceof Error ? failureError.message : String(failureError),
      );
    }
    return NextResponse.json({ ok: false, error: 'processing_failed' }, { status: 503 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

