/**
 * Escalation event model + operator delivery foundation (G6).
 *
 * G6 delivery path: when an escalation is created, a notification is sent
 * to the operator via sendTelegramMessage() which uses the TELEGRAM_CHAT_ID
 * environment variable (the configured operator group / channel).
 *
 * This is the smallest real delivery mechanism already present in the repo
 * (sendTelegramMessage is already used for payment confirmations).
 *
 * Graceful degradation: delivery failure is logged but never aborts
 * processing or prevents the guest from receiving a reply.
 */

import {
  ClassifyResult,
  EscalationEvent,
  EscalationReason,
  MessageCategory,
} from './types';
import { sendTelegramMessage } from '@/lib/telegram';

// ─── Event creation ───────────────────────────────────────────────────────────

export function createEscalationEvent(params: {
  reason:          EscalationReason;
  chat_id:         number;
  update_id?:      number;
  classification?: ClassifyResult;
  summary:         string;
}): EscalationEvent {
  return {
    reason:     params.reason,
    chat_id:    params.chat_id,
    update_id:  params.update_id,
    category:   params.classification?.category,
    summary:    params.summary,
    created_at: new Date().toISOString(),
  };
}

// ─── Escalation routing rules ─────────────────────────────────────────────────

/**
 * Determines whether a classification + reply outcome warrants an escalation
 * event.  Conservative rules — better to over-escalate than under.
 */
export function shouldEscalate(
  classification: ClassifyResult,
  llmSucceeded:   boolean,
): boolean {
  const { category, slots } = classification;

  // Urgent access issue — always escalate even if LLM replied.
  if (category === MessageCategory.Issue && slots.isUrgent && slots.isAccessRelated) {
    return true;
  }

  // LLM failed on a guest message or issue — operator attention needed.
  if (
    !llmSucceeded &&
    category !== MessageCategory.Start &&
    category !== MessageCategory.Greeting
  ) {
    return true;
  }

  return false;
}

/**
 * Builds the escalation reason given the context.
 */
export function deriveEscalationReason(
  classification: ClassifyResult,
  llmSucceeded:   boolean,
): EscalationReason {
  const { category, slots } = classification;

  if (category === MessageCategory.Issue && slots.isUrgent && slots.isAccessRelated) {
    return EscalationReason.UrgentIssue;
  }

  if (!llmSucceeded) {
    return EscalationReason.LLMUncertain;
  }

  return EscalationReason.RequiresOperator;
}

// ─── G6: Operator delivery ────────────────────────────────────────────────────

/**
 * Send a real-time escalation notification to the operator via Telegram.
 *
 * Uses sendTelegramMessage() which targets the TELEGRAM_CHAT_ID env var
 * (the configured operator group / channel).  If TELEGRAM_CHAT_ID is not
 * set, the function logs a warning and returns false without throwing.
 *
 * This must be called after saveEscalationEvent() so the durable record
 * exists even if the notification delivery fails.
 *
 * Never throws — fire-and-forget safe.
 */
export async function notifyOperatorEscalation(
  event: EscalationEvent,
): Promise<boolean> {
  const lines = [
    `🚨 Escalation Required`,
    `Chat ID: ${event.chat_id}`,
    `Reason: ${event.reason}`,
    ...(event.category ? [`Category: ${event.category}`] : []),
    `Summary: ${event.summary}`,
  ];

  try {
    return await sendTelegramMessage(lines.join('\n'));
  } catch (err) {
    console.warn(
      `[Escalation] notifyOperatorEscalation delivery failed chatId=${event.chat_id}: ${String(err)}`,
    );
    return false;
  }
}
