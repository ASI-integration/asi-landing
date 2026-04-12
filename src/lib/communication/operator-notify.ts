/**
 * Operator Notification Layer
 *
 * Delivers escalation and system alerts to the operator.
 *
 * Delivery order:
 *   1. Telegram — if OPERATOR_TELEGRAM_CHAT_ID is set
 *   2. Email    — if OPERATOR_EMAIL is set (via Resend)
 *   3. Log-only — if neither is configured (dev / misconfigured)
 *
 * Required env vars (at least one):
 *   OPERATOR_TELEGRAM_CHAT_ID  — operator's Telegram chat_id (number, negative for group)
 *   OPERATOR_EMAIL             — operator's email address
 *
 * Used by the orchestrator when a conversation is escalated.
 */

import { replyToTelegram } from '@/lib/telegram';
import { getChannelAdapter } from './channels';

export interface OperatorNotification {
  subject:  string;   // short subject line (used as email subject + Telegram header)
  body:     string;   // full message body
  /** Optional: source chat_id / conversation key for reference */
  sourceKey?: string;
}

/**
 * Notify the operator via the best available channel.
 * Never throws — failures are logged but do not break the caller.
 *
 * Returns the channel that successfully delivered the notification,
 * or null if all attempts failed.
 */
export async function notifyOperator(
  notification: OperatorNotification,
): Promise<'telegram' | 'email' | null> {
  const telegramChatId = process.env.OPERATOR_TELEGRAM_CHAT_ID;
  const operatorEmail  = process.env.OPERATOR_EMAIL;

  // 1. Try Telegram
  if (telegramChatId) {
    const chatId = parseInt(telegramChatId, 10);
    if (!isNaN(chatId)) {
      try {
        const text = `[ESCALATION] ${notification.subject}\n\n${notification.body}`;
        const ok   = await replyToTelegram(chatId, text);
        if (ok) return 'telegram';
      } catch (err) {
        console.warn('[OperatorNotify] Telegram delivery failed, will try email fallback', err);
      }
    }
  }

  // 2. Fall back to Email
  if (operatorEmail) {
    try {
      const emailAdapter = getChannelAdapter('email');
      const ok = await emailAdapter.sendMessage(operatorEmail, notification.body, {
        subject: notification.subject,
      });
      if (ok) return 'email';
    } catch (err) {
      console.warn('[OperatorNotify] Email fallback failed', err);
    }
  }

  // 3. Nothing worked
  console.error('[OperatorNotify] All delivery channels failed', {
    subject:   notification.subject,
    sourceKey: notification.sourceKey,
    hasTelegram: Boolean(telegramChatId),
    hasEmail:    Boolean(operatorEmail),
  });
  return null;
}

/**
 * Build a standard escalation notification from an escalation event.
 */
export function buildEscalationNotification(params: {
  reason:     string;
  chatId:     number;
  channel:    string;
  summary:    string;
  update_id?: number;
}): OperatorNotification {
  const lines = [
    `Reason:  ${params.reason}`,
    `Channel: ${params.channel}`,
    `Chat:    ${params.chatId}`,
    `Summary: ${params.summary}`,
  ];
  if (params.update_id != null) lines.push(`Update:  ${params.update_id}`);

  return {
    subject:   `Escalation — ${params.reason} [${params.channel}:${params.chatId}]`,
    body:      lines.join('\n'),
    sourceKey: `${params.channel}:${params.chatId}`,
  };
}

