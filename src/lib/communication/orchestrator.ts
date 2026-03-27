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
  IntentCategory,
} from './types';

import { getContext, updateContext } from './memory';
import { detectIntent } from './intent';
import { createPaymentRequest } from '@/lib/payments/factory';
import { callLLM } from '@/lib/openai';
import { buildCommunicationContext } from './context';
import { evaluateActionSafety } from './action';
import { buildOperatorHandoff } from './handoff';
import {
  SessionStatus,
  setPaymentExpiry,
  transitionSessionStatus,
} from './session-status';
import { getPropertyTemplates } from './templates';
import { createOpsTask, OpsTaskType, OpsTaskPriority } from '@/lib/ops/tasks';

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

  // Mark session active on first processed message (fire-and-forget — never blocks reply).
  transitionSessionStatus(chatId, SessionStatus.Active).catch(() => {});

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

    // Fetch per-property templates (null when none set or on any error)
    const propertyId = commContext.reservation.propertyId;
    const templates = propertyId ? await getPropertyTemplates(propertyId) : null;

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
      await transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired);
      // Ops task: policy escalation → guest_issue (fire-and-forget)
      createOpsTask({
        property_id: commContext.reservation.propertyId ?? 'unknown',
        reservation_id: commContext.reservation.reservationId ?? null,
        chat_id: chatId,
        task_type: OpsTaskType.GuestIssue,
        title: `Guest issue escalated: ${escalation.reason}`,
        description: escalation.summary,
        priority: OpsTaskPriority.Urgent,
        source_event: 'escalation_policy',
        trigger_reason: escalation.reason,
      }).then(({ task_id }) => {
        appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
      }).catch(() => {});
      const escalationBase = "I'm not entirely sure how to answer that. I have flagged this for our team to review!";
      const escalationMsg = templates?.escalation_contact_text
        ? `${escalationBase} ${templates.escalation_contact_text}`
        : escalationBase;
      replyText = adapter.formatResponse(escalationMsg, commContext as unknown as Record<string, unknown>);
    } else if (safety.action === 'provide_check_in_instructions' && templates?.pre_checkin_template) {
      replyText = adapter.formatResponse(templates.pre_checkin_template, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
    } else if (safety.action === 'provide_checkout_instructions' && templates?.checkout_template) {
      replyText = adapter.formatResponse(templates.checkout_template, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
    } else if (safety.action === 'trigger_payment_request') {
      const payment = await createPaymentRequest({
        amount: 100,
        currency: classification.lang === 'ru' ? 'RUB' : 'USD',
        chatId: String(chatId),
        serviceType: 'Chat Assistant Payment',
        reservationId: commContext.reservation.reservationId,
        propertyId: commContext.reservation.propertyId,
      });
      const paymentExpiresAt = payment.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000);
      await transitionSessionStatus(chatId, SessionStatus.PaymentPending, { paymentExpiresAt });
      setPaymentExpiry(chatId, paymentExpiresAt);
      const paymentUrl = payment.paymentUrl;
      const linkStr = classification.lang === 'ru'
        ? `Пожалуйста, завершите оплату по этой ссылке: ${paymentUrl}`
        : `Please complete your payment using this link: ${paymentUrl}`;
      replyText = adapter.formatResponse(linkStr, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
    } else {
      const followupHint = templates?.followup_template
        ? `Follow-up template (use when context is post-stay or follow-up): ${templates.followup_template}`
        : null;
      const prompt = buildIntelligentPrompt(commContext as unknown as Parameters<typeof buildIntelligentPrompt>[0], text, classification, followupHint);
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
      await transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired);
      // Ops task: LLM-fallback escalation → guest_issue (fire-and-forget)
      createOpsTask({
        property_id: commContext.reservation.propertyId ?? 'unknown',
        reservation_id: commContext.reservation.reservationId ?? null,
        chat_id: chatId,
        task_type: OpsTaskType.GuestIssue,
        title: `Guest issue escalated: ${reason}`,
        description: escalation.summary,
        priority: classification.slots.isUrgent ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
        source_event: 'escalation_llm_fallback',
        trigger_reason: reason,
      }).then(({ task_id }) => {
        appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
      }).catch(() => {});
    }

    // Ops task: checkout intent → checkout task (fire-and-forget)
    if (intentResult.intent === IntentCategory.CheckOut && commContext.reservation.propertyId) {
      createOpsTask({
        property_id: commContext.reservation.propertyId,
        reservation_id: commContext.reservation.reservationId ?? null,
        chat_id: chatId,
        task_type: OpsTaskType.Checkout,
        title: 'Guest checkout',
        priority: OpsTaskPriority.Normal,
        source_event: 'checkout_intent',
        trigger_reason: 'checkout_message_sent',
      }).then(({ task_id }) => {
        appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.Checkout, task_id, ts: new Date() });
      }).catch(() => {});
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
