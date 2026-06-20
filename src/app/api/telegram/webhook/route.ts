import { NextResponse } from 'next/server';

import { processUpdate } from '@/lib/communication/orchestrator';
import { processTelegramVoiceUpdate } from '@/lib/communication/telegram-voice-inbound';
import type { TelegramUpdate } from '@/lib/communication/types';
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

  // Telegram treats 4xx as final, so keep this strict only when configured.
  if (secretExpected && secretGot !== secretExpected) {
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

  const telegramEventType = update?.edited_message ? 'edited_message' : update?.message ? 'message' : 'unknown';
  const message = update?.edited_message ?? update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text ?? message?.caption ?? '';
  const hasVoice = Boolean(message?.voice);
  const hasAudio = Boolean(message?.audio);
  const hasText = Boolean(text);
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
      voice_file_id: voice?.file_id ?? null,
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
      const voiceResult = await processTelegramVoiceUpdate(update);
      return NextResponse.json({ ok: true, path: voiceResult.outcome }, { status: 200 });
    }

    // processUpdate → session store → LLM intent → rule-based decision/escalation → reply | ask | escalate (see orchestrator)
    if (hasText && typeof chatId === 'number') {
      sendTypingIndicator(chatId, update?.update_id, 'text');
    }
    const result = await processUpdate(update);
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
    // Still 200: Telegram webhooks should not retry due to internal errors.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

