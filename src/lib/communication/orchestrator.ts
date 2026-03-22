import { getChannelAdapter } from './channels';
import { createOrMergeIdentity } from './identity';
import { appendTimelineEvent } from './timeline';
import {
  auditDuplicate,
  auditEscalation,
  auditError,
  auditInbound,
  auditLLM,
  auditOutbound,
} from './audit';
import {
  buildIntelligentPrompt,
  classifyMessage,
  deterministicReply,
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
  EscalationReason,
  InboundMessageEnvelope,
} from './types';

import { getContext, updateContext } from './memory';
import { detectIntent } from './intent';
import { createPaymentRequest } from '@/lib/payments/stub';
import { callLLM } from '@/lib/openai';
import { buildCommunicationContext } from './context';
import { evaluateActionSafety } from './action';
import { buildOperatorHandoff } from './handoff';

export async function processMessage(envelope: InboundMessageEnvelope): Promise<ProcessResult> {
  const update_id = envelope.update_id ?? Date.now();
  const text = envelope.messageText ?? '';

  // Idempotency: drop duplicate update_ids
  if (checkAndMark(update_id)) {
    auditDuplicate({ chat_id: 0, update_id });
    return { outcome: ProcessOutcome.Duplicate, update_id };
  }

  // Resolve unified identity
  const identity = await createOrMergeIdentity(envelope);
  const chatId = envelope.chatId ? parseInt(envelope.chatId, 10) : parseInt(identity.guestId, 10);
  
  await appendTimelineEvent(identity.guestId, { type: 'message_inbound', channel: envelope.channel, content: text, ts: envelope.receivedAt });

  try {
    const classification = await classifyMessage(text);
    auditInbound({
      chat_id: chatId,
      update_id,
      text,
      category: classification.category,
      lang: classification.lang,
    });

    const intentResult = await detectIntent(text);
    const ctx = getContext(chatId);

    // Assembly
    const commContext = await buildCommunicationContext(chatId, text, intentResult, []);

    // Action Policy Guard
    const safety = evaluateActionSafety(commContext, text);

    let replyText: string;
    let llmSucceeded = false;
    let escalation = undefined;
    const adapter = getChannelAdapter(envelope.channel);

    if (!safety.safe && safety.action === 'escalate_to_operator') {
      const handoff = buildOperatorHandoff(commContext, text, safety.action, safety.reason || 'Escalated by policy');
      escalation = createEscalationEvent({
        reason: safety.escalationReason || EscalationReason.RequiresOperator,
        chat_id: chatId,
        update_id,
        classification,
        summary: handoff.reasonForEscalation,
      });
      auditEscalation({ chat_id: chatId, update_id, detail: escalation.summary });
      await appendTimelineEvent(identity.guestId, { type: 'escalation', reason: escalation.summary, ts: new Date() });
      replyText = adapter.formatResponse("I'm not entirely sure how to answer that. I have flagged this for our team to review!", commContext as unknown as Record<string, unknown>);
    } else if (safety.action === 'trigger_payment_request') {
      const paymentId = createPaymentRequest(chatId, 100);
      const paymentUrl = `https://pay.test/${paymentId}`;
      const linkStr = classification.lang === 'ru'
        ? `Пожалуйста, завершите оплату по этой ссылке: ${paymentUrl}`
        : `Please complete your payment using this link: ${paymentUrl}`;
      replyText = adapter.formatResponse(linkStr, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
    } else {
      const prompt = buildIntelligentPrompt(commContext as unknown as Parameters<typeof buildIntelligentPrompt>[0], text, classification);
      const llmReply = await callLLM({ systemPrompt: SYSTEM_PROMPT, userMessage: prompt });

      llmSucceeded = llmReply !== null;
      const rawFallback = llmReply ?? deterministicReply(classification);
      replyText = adapter.formatResponse(rawFallback, commContext as unknown as Record<string, unknown>);
      auditLLM({ chat_id: chatId, update_id, used_fallback: !llmSucceeded });
    }

    updateContext(chatId, { lastIntent: intentResult.intent });

    await Promise.allSettled([
      upsertSession(chatId),
      saveUserTurn({
        chat_id: chatId,
        update_id,
        text,
        category: classification.category,
        lang: classification.lang,
      }),
    ]);

    if (!escalation && shouldEscalate(classification, llmSucceeded)) {
      const reason = deriveEscalationReason(classification, llmSucceeded);
      const handoff = buildOperatorHandoff(commContext, text, 'escalate_to_operator', 'LLM fallback triggered');
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
      await appendTimelineEvent(identity.guestId, { type: 'escalation', reason: escalation.summary, ts: new Date() });
    }

    // Send the response abstractly
    const targetId = envelope.chatId || envelope.email || envelope.phoneNumber || identity.guestId;
    const sent = await adapter.sendMessage(targetId, replyText);
    if (!sent) throw new Error('Adapter failed to send message');
    await appendTimelineEvent(identity.guestId, { type: 'message_outbound', channel: envelope.channel, content: replyText, ts: new Date() });

    auditOutbound({
      chat_id: chatId,
      update_id,
      category: classification.category,
      lang: classification.lang,
      detail: escalation ? `escalated:${escalation.reason}` : undefined,
    });

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

// Keep backward compatibility for Telegram Webhook
import { TelegramUpdate } from './types';
export async function processUpdate(update: TelegramUpdate): Promise<ProcessResult> {
  const message = update.message ?? update.edited_message;
  if (!message) return { outcome: ProcessOutcome.Ignored, update_id: update.update_id };

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: message.chat.id.toString(),
    chatId: message.chat.id.toString(),
    messageText: message.text || '',
    receivedAt: new Date(),
    update_id: update.update_id,
  };

  return processMessage(envelope);
}
