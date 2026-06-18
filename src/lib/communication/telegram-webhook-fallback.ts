import { replyToTelegram, type TelegramSendOptions } from '@/lib/telegram';
import type { TelegramUpdate } from './types';
import { TELEGRAM_TECHNICAL_ERROR_REPLY } from './telegram-webhook-scope';

export type TelegramWebhookHandlerContext = {
  handler: string;
  update_id?: number;
  telegram_user_id?: string;
  chat_id?: number | string;
  telegram_event_type?: string;
};

export function extractTelegramWebhookContext(update: TelegramUpdate | null | undefined): {
  chatId: number | null;
  telegramUserId: string | null;
  telegramEventType: string;
  textPreview: string;
} {
  const telegramEventType = update?.callback_query
    ? 'callback_query'
    : update?.edited_message
      ? 'edited_message'
      : update?.message
        ? 'message'
        : 'unknown';
  const message = update?.edited_message ?? update?.message ?? update?.callback_query?.message;
  const chatId = message?.chat?.id ?? null;
  const from = update?.callback_query?.from ?? message?.from;
  const telegramUserId = from?.id != null ? String(from.id) : null;
  const text = (message?.text ?? message?.caption ?? update?.callback_query?.data ?? '').trim();
  const textPreview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return { chatId, telegramUserId, telegramEventType, textPreview };
}

export function logTelegramWebhookHandlerError(
  error: unknown,
  ctx: TelegramWebhookHandlerContext,
): void {
  console.error('[tg:webhook] handler_error', {
    handler: ctx.handler,
    update_id: ctx.update_id ?? null,
    telegram_user_id: ctx.telegram_user_id ?? null,
    chat_id: ctx.chat_id ?? null,
    telegram_event_type: ctx.telegram_event_type ?? null,
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function sendTelegramWebhookFallbackReply(input: {
  chatId: number | string;
  updateId?: number;
  handler: string;
  sendOptions?: TelegramSendOptions;
  replyText?: string;
}): Promise<boolean> {
  return replyToTelegram(
    input.chatId,
    input.replyText ?? TELEGRAM_TECHNICAL_ERROR_REPLY,
    {
      handler: input.handler,
      update_id: input.updateId,
    },
    input.sendOptions ?? {},
  );
}

export function getAsiFeedbackTelegramSendOptions(): TelegramSendOptions {
  return {
    botToken: process.env.ASI_FEEDBACK_BOT_TOKEN?.trim() || null,
    tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN',
  };
}

export function getOperationalTelegramSendOptions(): TelegramSendOptions {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null,
    tokenLabel: 'TELEGRAM_BOT_TOKEN',
  };
}

export function resolveFallbackSendOptions(scope: 'operational' | 'asi_feedback' | 'unscoped'): TelegramSendOptions {
  if (scope === 'asi_feedback' || scope === 'unscoped') {
    const feedback = getAsiFeedbackTelegramSendOptions();
    if (feedback.botToken) return feedback;
  }
  return getOperationalTelegramSendOptions();
}
