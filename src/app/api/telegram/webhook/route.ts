import { NextResponse } from 'next/server';

import { processUpdate } from '@/lib/communication/orchestrator';
import type { TelegramUpdate } from '@/lib/communication/types';
import { postTelegramUpdateToBackendPipeline } from '@/lib/telegram/backend-pipeline-bridge';
import { replyToTelegram } from '@/lib/telegram';

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

function telegramVoiceFallbackText(lang?: string): string {
  return lang === 'ru'
    ? 'Не удалось распознать голосовое. Пришлите, пожалуйста, текстом.'
    : "I couldn't transcribe the voice message. Please send it as text.";
}

export async function POST(req: Request): Promise<Response> {
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

  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id;
  const text = message?.text ?? message?.caption ?? '';
  const hasVoice = Boolean(message?.voice);
  const hasAudio = Boolean(message?.audio);
  const lang = message?.from?.language_code;
  // Always log webhook receipt — minimal fields, no PII beyond chat_id
  console.info('[tg:webhook] recv', {
    update_id: update?.update_id,
    chat_id: chatId,
    has_voice: hasVoice,
    has_audio: hasAudio,
    has_text: Boolean(text),
  });
  if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
    const voice = (message as any)?.voice ?? null;
    const audio = (message as any)?.audio ?? null;
    console.log('[tg:webhook] inbound', {
      update_id: update?.update_id,
      chat_id: chatId,
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
    // Telegram is intentionally text-first for the current production scope.
    // Voice is *not* a production capability right now. Keep an honest fallback.
    if (update && (hasVoice || hasAudio) && chatId) {
      console.info('[comm:routing]', {
        path: 'telegram_voice_fallback',
        update_id: update.update_id,
        chat_id: chatId,
        has_voice: hasVoice,
        has_audio: hasAudio,
      });
      await replyToTelegram(chatId, telegramVoiceFallbackText(lang), {
        handler: 'telegram_voice_fallback',
        update_id: update.update_id,
      });
      return NextResponse.json({ ok: true, path: 'telegram_voice_fallback' }, { status: 200 });
    }

    const backendPipelineUrl = process.env.TELEGRAM_BACKEND_PIPELINE_URL?.trim();
    if (backendPipelineUrl && update) {
      const piped = await postTelegramUpdateToBackendPipeline(update as Record<string, unknown>);
      if (piped.ok) {
        const d = piped.decision;
        const outboundText = d.outbound_payload?.text;
        const maySend =
          d.outbound_send_allowed !== false &&
          typeof outboundText === 'string' &&
          outboundText.trim().length > 0;
        if (maySend && chatId != null) {
          await replyToTelegram(chatId, outboundText, {
            handler: 'backend_pipeline',
            update_id: update.update_id,
          });
        }
        if (d.owner_notification_allowed) {
          console.info('[tg:webhook] backend_pipeline owner_notification_allowed', {
            update_id: update.update_id,
            chat_id: chatId,
            action_type: d.action_type,
            session_id: d.session_id ?? null,
          });
        }
        return NextResponse.json({ ok: true, path: 'backend_pipeline' }, { status: 200 });
      }

      console.error('[tg:webhook] backend_pipeline_fallback', {
        reason: piped.error,
        update_id: update?.update_id,
        chat_id: chatId ?? null,
      });
    }

    // Legacy fallback: processUpdate → session store → LLM intent → rule-based routing (see orchestrator)
    const result = await processUpdate(update);
    if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
      console.log('[tg:webhook] processed', {
        outcome: result.outcome,
        update_id: result.update_id,
        chat_id: (result as any).chat_id,
      });
    }
  } catch (e) {
    console.error('[tg:webhook] processUpdate threw', e);
    // Still 200: Telegram webhooks should not retry due to internal errors.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

