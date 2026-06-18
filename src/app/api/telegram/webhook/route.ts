import { NextResponse } from 'next/server';

import { processUpdate } from '@/lib/communication/orchestrator';
import { processTelegramLeadIntakeUpdate } from '@/lib/communication/telegram-lead-intake';
import { processTelegramRoutingUpdate } from '@/lib/communication/telegram-routing';
import { processTelegramVoiceUpdate } from '@/lib/communication/telegram-voice-inbound';
import {
  extractTelegramWebhookContext,
  logTelegramWebhookHandlerError,
  resolveFallbackSendOptions,
  sendTelegramWebhookFallbackReply,
} from '@/lib/communication/telegram-webhook-fallback';
import {
  isAsiFeedbackRoutingUpdate,
  resolveWebhookScope,
  shouldTryAsiFeedbackRouting,
} from '@/lib/communication/telegram-webhook-scope';
import type { TelegramUpdate } from '@/lib/communication/types';

export const runtime = 'nodejs';
// Production Telegram webhook entrypoint. Operational Telegram stays on TELEGRAM_BOT_TOKEN;
// ASI Feedback lead intake uses its own runtime ASI_FEEDBACK_* env values.

function getHeader(req: Request, name: string): string | null {
  return req.headers.get(name);
}

function preview(text: string, max = 120): string {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function POST(req: Request): Promise<Response> {
  const webhookStartedAt = Date.now();
  const secretGot =
    getHeader(req, 'x-telegram-bot-api-secret-token') ??
    getHeader(req, 'X-Telegram-Bot-Api-Secret-Token');
  const webhookScope = resolveWebhookScope(secretGot);

  if (!webhookScope) {
    console.warn('[tg:webhook] 403 secret mismatch', {
      hasSecretHeader: Boolean(secretGot),
      hasOperationalSecret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
      hasFeedbackSecret: Boolean(process.env.ASI_FEEDBACK_WEBHOOK_SECRET?.trim()),
      hint: 'Check getWebhookInfo for ASI Feedback bot and TELEGRAM_BOT_TOKEN; secret_token must match env.',
    });
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let update: TelegramUpdate | null = null;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (e) {
    console.error('[tg:webhook] invalid json body', e);
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  const { chatId, telegramUserId, telegramEventType, textPreview } = extractTelegramWebhookContext(update);
  const message = update?.edited_message ?? update?.message ?? update?.callback_query?.message;
  const text = message?.text ?? message?.caption ?? '';
  const hasVoice = Boolean(message?.voice);
  const hasAudio = Boolean(message?.audio);
  const hasText = Boolean(text);
  const hasCallback = Boolean(update?.callback_query?.data);
  const isStartCommand = /^\/start(?:@\w+)?/i.test(String(text).trim());

  console.info('[tg:webhook] recv', {
    update_id: update?.update_id,
    chat_id: chatId,
    webhook_scope: webhookScope,
    telegram_event_type: telegramEventType,
    has_edited_message: Boolean(update?.edited_message),
    has_voice: hasVoice,
    has_audio: hasAudio,
    has_text: hasText,
    has_callback: hasCallback,
    is_start: isStartCommand,
    is_asi_feedback_routing: isAsiFeedbackRoutingUpdate(update),
  });
  console.info('[tg:latency] webhook.received', {
    update_id: update?.update_id,
    chat_id: chatId,
    stage_ms: Date.now() - webhookStartedAt,
  });
  if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
    const voice = (message as { voice?: unknown } | undefined)?.voice ?? null;
    const audio = (message as { audio?: unknown } | undefined)?.audio ?? null;
    console.log('[tg:webhook] inbound', {
      update_id: update?.update_id,
      chat_id: chatId,
      telegram_event_type: telegramEventType,
      text_preview: preview(text),
      has_message: Boolean(message),
      has_voice: Boolean(voice),
      has_audio: Boolean(audio),
    });
  }

  let handlerReplied = false;

  const markReplied = () => {
    handlerReplied = true;
  };

  const tryFallbackReply = async (handler: string, reason: string) => {
    if (!chatId || handlerReplied) return;
    const sent = await sendTelegramWebhookFallbackReply({
      chatId,
      updateId: update?.update_id,
      handler,
      sendOptions: resolveFallbackSendOptions(webhookScope),
    });
    console.warn('[tg:webhook] fallback_reply', {
      handler,
      reason,
      chat_id: chatId,
      update_id: update?.update_id,
      sent,
    });
    if (sent) handlerReplied = true;
  };

  try {
    const tryFeedbackPipeline =
      update &&
      chatId &&
      (hasText || hasCallback) &&
      shouldTryAsiFeedbackRouting(webhookScope, update);

    if (tryFeedbackPipeline) {
      let routingResult = null;
      try {
        routingResult = await processTelegramRoutingUpdate(update);
        if (routingResult) markReplied();
      } catch (e) {
        logTelegramWebhookHandlerError(e, {
          handler: 'telegram_routing',
          update_id: update.update_id,
          telegram_user_id: telegramUserId ?? undefined,
          chat_id: chatId,
          telegram_event_type: telegramEventType,
        });
        await tryFallbackReply('telegram_routing/error_boundary', 'routing_threw');
      }
      if (routingResult) {
        console.info('[comm:routing]', {
          path: 'telegram_routing',
          outcome: routingResult.outcome,
          update_id: update.update_id,
          chat_id: chatId,
          telegram_event_type: telegramEventType,
        });
        return NextResponse.json({ ok: true, path: 'telegram_routing' }, { status: 200 });
      }

      let leadResult = null;
      try {
        leadResult = await processTelegramLeadIntakeUpdate(update);
        if (leadResult) markReplied();
      } catch (e) {
        logTelegramWebhookHandlerError(e, {
          handler: 'telegram_lead_intake',
          update_id: update.update_id,
          telegram_user_id: telegramUserId ?? undefined,
          chat_id: chatId,
          telegram_event_type: telegramEventType,
        });
        await tryFallbackReply('telegram_lead_intake/error_boundary', 'lead_intake_threw');
      }
      if (leadResult) {
        console.info('[comm:routing]', {
          path: 'telegram_lead_intake',
          outcome: leadResult.outcome,
          update_id: update.update_id,
          chat_id: chatId,
          telegram_event_type: telegramEventType,
        });
        return NextResponse.json({ ok: true, path: 'telegram_lead_intake' }, { status: 200 });
      }

      if (isStartCommand || isAsiFeedbackRoutingUpdate(update)) {
        await tryFallbackReply(
          'telegram_routing/start_no_reply',
          'asi_feedback_update_unhandled',
        );
        return NextResponse.json({ ok: true, path: 'telegram_routing_fallback' }, { status: 200 });
      }
    }

    if (hasCallback) {
      return NextResponse.json({ ok: true, ignored: 'callback_query' }, { status: 200 });
    }

    if (update && (hasVoice || hasAudio) && chatId) {
      console.info('[comm:routing]', {
        path: 'telegram_voice',
        update_id: update.update_id,
        chat_id: chatId,
        telegram_event_type: telegramEventType,
        has_voice: hasVoice,
        has_audio: hasAudio,
      });
      try {
        const voiceResult = await processTelegramVoiceUpdate(update);
        if (voiceResult) markReplied();
        return NextResponse.json({ ok: true, path: voiceResult.outcome }, { status: 200 });
      } catch (e) {
        logTelegramWebhookHandlerError(e, {
          handler: 'telegram_voice',
          update_id: update.update_id,
          telegram_user_id: telegramUserId ?? undefined,
          chat_id: chatId,
          telegram_event_type: telegramEventType,
        });
        await tryFallbackReply('telegram_voice/error_boundary', 'voice_threw');
        return NextResponse.json({ ok: true, path: 'telegram_voice_fallback' }, { status: 200 });
      }
    }

    try {
      const result = await processUpdate(update);
      if (result.outcome !== 'ignored' && result.outcome !== 'duplicate') {
        markReplied();
      }
      if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
        console.log('[tg:webhook] processed', {
          outcome: result.outcome,
          update_id: result.update_id,
          chat_id: chatId,
          telegram_event_type: telegramEventType,
        });
      }
    } catch (e) {
      logTelegramWebhookHandlerError(e, {
        handler: 'processUpdate',
        update_id: update?.update_id,
        telegram_user_id: telegramUserId ?? undefined,
        chat_id: chatId ?? undefined,
        telegram_event_type: telegramEventType,
      });
      await tryFallbackReply('processUpdate/error_boundary', 'orchestrator_threw');
    }

    if (isStartCommand && chatId && !handlerReplied) {
      await tryFallbackReply('processUpdate/start_no_reply', 'start_unhandled');
    }
  } catch (e) {
    logTelegramWebhookHandlerError(e, {
      handler: 'tg_webhook_outer',
      update_id: update?.update_id,
      telegram_user_id: telegramUserId ?? undefined,
      chat_id: chatId ?? undefined,
      telegram_event_type: telegramEventType,
    });
    await tryFallbackReply('tg_webhook/outer_error_boundary', 'outer_threw');
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
