import { callLLM } from '@/lib/openai';
import { replyToTelegram } from '@/lib/telegram';
import {
  auditDuplicate,
  auditEscalation,
  auditError,
  auditInbound,
  auditLLM,
  auditOutbound,
} from './audit';
import {
  buildUserPrompt,
  classify,
  deterministicReply,
  LLM_CATEGORIES,
  SYSTEM_PROMPT,
} from './classifier';
import { checkAndMark } from './idempotency';
import {
  saveAssistantTurn,
  saveUserTurn,
  upsertSession,
} from './persistence';
import {
  createEscalationEvent,
  deriveEscalationReason,
  shouldEscalate,
} from './escalation';
import {
  ProcessOutcome,
  ProcessResult,
  TelegramUpdate,
} from './types';

/**
 * Core orchestrator.
 *
 * Given a parsed TelegramUpdate it:
 *   1. Validates idempotency (dedup by update_id)
 *   2. Classifies the message
 *   3. Calls LLM for substantive categories, falls back to deterministic reply
 *   4. Persists session + message turns
 *   5. Generates escalation event if warranted
 *   6. Sends the reply via Telegram
 *   7. Returns a typed ProcessResult
 *
 * Never throws — all errors are caught, logged, and result in a ProcessResult
 * with outcome=error.  The route layer can then return HTTP 200 safely.
 */
export async function processUpdate(update: TelegramUpdate): Promise<ProcessResult> {
  const { update_id } = update;
  const message = update.message ?? update.edited_message;

  // ── Ignore updates with no message ────────────────────────────────────────
  if (!message) {
    return { outcome: ProcessOutcome.Ignored, update_id };
  }

  const chatId = message.chat.id;
  const text = message.text;
  const languageCode = message.from?.language_code;

  try {
    // ── 1. Idempotency ───────────────────────────────────────────────────────
    const alreadyProcessed = checkAndMark(update_id);
    if (alreadyProcessed) {
      auditDuplicate({ chat_id: chatId, update_id });
      return { outcome: ProcessOutcome.Duplicate, update_id, chat_id: chatId };
    }

    // ── 2. Classify ──────────────────────────────────────────────────────────
    const classification = classify(text ?? '', languageCode);

    auditInbound({
      chat_id: chatId,
      update_id,
      text,
      category: classification.category,
      lang: classification.lang,
    });

    // ── 3. Build reply ───────────────────────────────────────────────────────
    let replyText: string;
    let llmSucceeded = false;

    if (text && LLM_CATEGORIES.includes(classification.category)) {
      const llmReply = await callLLM({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: buildUserPrompt(text, classification),
      });

      llmSucceeded = llmReply !== null;
      replyText = llmReply ?? deterministicReply(classification);

      auditLLM({ chat_id: chatId, update_id, used_fallback: !llmSucceeded });
    } else {
      replyText = deterministicReply(classification);
    }

    // ── 4. Persist (fire-and-forget — errors don't block reply) ──────────────
    await Promise.allSettled([
      upsertSession(chatId),
      saveUserTurn({
        chat_id: chatId,
        update_id,
        text: text ?? '',
        category: classification.category,
        lang: classification.lang,
      }),
    ]);

    // ── 5. Escalation check ──────────────────────────────────────────────────
    let escalation = undefined;
    if (shouldEscalate(classification, llmSucceeded)) {
      const reason = deriveEscalationReason(classification, llmSucceeded);
      escalation = createEscalationEvent({
        reason,
        chat_id: chatId,
        update_id,
        classification,
        summary: `category=${classification.category} llm=${llmSucceeded} urgent=${classification.slots.isUrgent}`,
      });
      auditEscalation({
        chat_id: chatId,
        update_id,
        detail: `reason=${reason} category=${classification.category}`,
      });
    }

    // ── 6. Send reply ────────────────────────────────────────────────────────
    await replyToTelegram(chatId, replyText);

    auditOutbound({
      chat_id: chatId,
      update_id,
      category: classification.category,
      lang: classification.lang,
      detail: escalation ? `escalated:${escalation.reason}` : undefined,
    });

    // ── 7. Persist assistant turn ────────────────────────────────────────────
    await saveAssistantTurn({
      chat_id: chatId,
      update_id,
      reply: replyText,
      category: classification.category,
      lang: classification.lang,
    });

    return {
      outcome: ProcessOutcome.Replied,
      update_id,
      chat_id: chatId,
      category: classification.category,
      escalation,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    auditError({ chat_id: chatId, update_id, detail });
    return { outcome: ProcessOutcome.Error, update_id, chat_id: chatId };
  }
}
