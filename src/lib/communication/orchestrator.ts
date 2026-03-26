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
  buildSystemPrompt,
  buildIntelligentPrompt,
  classifyMessage,
  deterministicReply,
} from './classifier';
import { checkAndMark, checkDurableDuplicate, markDurable } from './idempotency';
import {
  linkSessionToReservation,
  loadRecentTurns,
  saveAssistantTurn,
  saveEscalationEvent,
  saveOutboundFailure,
  saveUserTurn,
  upsertSession,
} from './persistence';
import {
  createEscalationEvent,
  deriveEscalationReason,
  notifyOperatorEscalation,
  shouldEscalate,
} from './escalation';
import {
  ProcessOutcome,
  ProcessResult,
  EscalationReason,
  InboundMessageEnvelope,
} from './types';

import { getContext, updateContext, loadContextFromDB, persistContext } from './memory';
import { updateBookingDraft } from './memory';
import { detectIntent } from './intent';
import { transitionFlowOnEscalation, transitionFlowOnGuestReply } from './stay-flow';
import { createPaymentRequest } from '@/lib/payments/factory';
import { callLLM } from '@/lib/openai';
import { buildCommunicationContext } from './context';
import { evaluateActionSafety } from './action';
import { buildOperatorHandoff } from './handoff';
import { extractBookingDraft } from './booking-draft';
import {
  SessionStatus,
  getSessionStatusSync,
  setPaymentExpiry,
  transitionSessionStatus,
} from './session-status';

export async function processMessage(envelope: InboundMessageEnvelope): Promise<ProcessResult> {
  const update_id = envelope.update_id ?? Date.now();
  const text = envelope.messageText ?? '';

  // Idempotency: L1 in-memory check (fast path)
  if (checkAndMark(update_id)) {
    auditDuplicate({ chat_id: 0, update_id });
    return { outcome: ProcessOutcome.Duplicate, update_id };
  }
  // Idempotency: L2 durable check (cross-restart — only fires on L1 miss)
  if (await checkDurableDuplicate(update_id)) {
    auditDuplicate({ chat_id: 0, update_id });
    return { outcome: ProcessOutcome.Duplicate, update_id };
  }
  // Mark durable immediately so parallel/restarted instances see it
  markDurable(update_id);

  // Resolve unified identity (G1 — now persisted in tg_guest_identities)
  const identity = await createOrMergeIdentity(envelope);
  const chatId = envelope.chatId ? parseInt(envelope.chatId, 10) : parseInt(identity.guestId, 10);

  // G5 — load persisted conversation context on cold start
  await loadContextFromDB(chatId);

  await appendTimelineEvent(
    identity.guestId,
    { type: 'message_inbound', channel: envelope.channel, content: text, ts: envelope.receivedAt },
    chatId,
  );

  // Mark session active on first processed message (fire-and-forget — never blocks reply).
  transitionSessionStatus(chatId, SessionStatus.Active).catch(() => {});

  try {
    const classification = await classifyMessage(text, envelope.languageCode);
    auditInbound({
      chat_id: chatId,
      update_id,
      text,
      category: classification.category,
      lang: classification.lang,
    });

    const intentResult = await detectIntent(text);
    const ctx = getContext(chatId);

    const draftUpdate = extractBookingDraft(text);
    if (draftUpdate.propertyLabel || draftUpdate.stayNights || draftUpdate.guestName || draftUpdate.specificRequests?.length) {
      updateBookingDraft(chatId, draftUpdate);
    }

    // Assembly — load persisted turn history for conversation continuity
    const recentMessages = await loadRecentTurns(chatId, 10);
    const commContext = await buildCommunicationContext(chatId, text, intentResult, recentMessages);

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
      saveEscalationEvent(escalation).catch(() => {});
      // G6 — deliver operator notification (fire-and-forget)
      notifyOperatorEscalation(escalation).catch(() => {});
      await appendTimelineEvent(
        identity.guestId,
        { type: 'escalation', reason: escalation.summary, ts: new Date() },
        chatId,
      );
      await transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired);
      replyText = adapter.formatResponse("I'm not entirely sure how to answer that. I have flagged this for our team to review!", commContext as unknown as Record<string, unknown>);
    } else if (safety.action === 'trigger_payment_request') {
      // G7: Guard against duplicate payment creation when a request is already pending.
      if (getSessionStatusSync(chatId) === SessionStatus.PaymentPending) {
        const isRu = classification.lang === 'ru';
        replyText = adapter.formatResponse(
          isRu
            ? 'Запрос на оплату уже был отправлен. Пожалуйста, завершите предыдущую оплату или дождитесь её истечения.'
            : 'A payment request has already been sent. Please complete the pending payment or wait for it to expire.',
          commContext as unknown as Record<string, unknown>,
        );
        llmSucceeded = true;
      } else {
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
      } // end else (payment not already pending)
    } else {
      const prompt = buildIntelligentPrompt(commContext as unknown as Parameters<typeof buildIntelligentPrompt>[0], text, classification);
      const llmReply = await callLLM({
        systemPrompt: buildSystemPrompt(classification.lang),
        userMessage: prompt,
      });

      llmSucceeded = llmReply !== null;
      const rawFallback = llmReply ?? deterministicReply(classification);
      replyText = adapter.formatResponse(rawFallback, commContext as unknown as Record<string, unknown>);
      auditLLM({ chat_id: chatId, update_id, used_fallback: !llmSucceeded });
    }

    updateContext(chatId, {
      lastIntent: intentResult.intent,
      guestName: draftUpdate.guestName ?? ctx.guestName,
    });

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

    // Link session to reservation once matched (durable chatId→reservation mapping)
    if (commContext.reservation.status === 'matched') {
      linkSessionToReservation({
        chat_id:        chatId,
        guest_id:       commContext.reservation.guestId,
        property_id:    commContext.reservation.propertyId,
        reservation_id: commContext.reservation.reservationId,
      }).catch(() => {});
    }

    if (!escalation && shouldEscalate(classification, llmSucceeded)) {
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
      saveEscalationEvent(escalation).catch(() => {});
      // G6 — deliver operator notification (fire-and-forget)
      notifyOperatorEscalation(escalation).catch(() => {});
      await appendTimelineEvent(
        identity.guestId,
        { type: 'escalation', reason: escalation.summary, ts: new Date() },
        chatId,
      );
      await transitionSessionStatus(chatId, SessionStatus.OperatorReviewRequired);
    }

    // Send the response abstractly
    const targetId = envelope.chatId || envelope.email || envelope.phoneNumber || identity.guestId;
    const sent = await adapter.sendMessage(targetId, replyText);
    if (!sent) {
      // Persist the delivery failure before surfacing as error
      await saveOutboundFailure({
        chat_id: chatId,
        update_id,
        error_detail: 'Adapter returned false — message not delivered',
      });
      throw new Error('Adapter failed to send message');
    }
    await appendTimelineEvent(
      identity.guestId,
      { type: 'message_outbound', channel: envelope.channel, content: replyText, ts: new Date() },
      chatId,
    );

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

    // G5 — persist conversation context for cold-start continuity
    persistContext(chatId).catch(() => {});

    // Stay-flow bridge — awaited so Vercel does not terminate the function
    // before the status write completes. Both functions never throw.
    if (escalation) {
      await transitionFlowOnEscalation(chatId);
    } else {
      await transitionFlowOnGuestReply(chatId, classification.category);
    }

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
  // G8: Edited messages must NOT generate a second assistant reply.
  // Telegram resends edited_message with a new update_id, which bypasses
  // idempotency. Silently ignore them instead.
  if (update.edited_message) {
    return { outcome: ProcessOutcome.Ignored, update_id: update.update_id };
  }

  const message = update.message;
  if (!message) return { outcome: ProcessOutcome.Ignored, update_id: update.update_id };

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: message.chat.id.toString(),
    chatId: message.chat.id.toString(),
    messageText: message.text || '',
    receivedAt: new Date(),
    update_id: update.update_id,
    // G9: Preserve Telegram's language_code so the classifier can use it.
    languageCode: message.from?.language_code,
  };

  return processMessage(envelope);
}
