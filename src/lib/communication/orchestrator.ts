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
import { evaluateCheckinReadiness } from '@/lib/ops/checkin-gate';
import { supabase } from '@/lib/supabase';
import { runInBackground } from './background';

export async function processMessage(envelope: InboundMessageEnvelope): Promise<ProcessResult> {
  const update_id = envelope.update_id ?? Date.now();
  const corrId    = String(update_id);
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
  runInBackground(
    { correlationId: corrId, module: 'orchestrator', taskName: 'transitionSessionStatus', triggerId: String(chatId) },
    () => transitionSessionStatus(chatId, SessionStatus.Active),
  );

  try {
    // Keyword-based incident detection — runs before LLM
    const INCIDENT_KEYWORDS = ['trash', 'dirty', 'party', 'damage'];
    if (INCIDENT_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
      updateContext(chatId, { incident: true, incident_type: 'property_issue', severity: 'high' });
    }

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
    let escalation: ReturnType<typeof createEscalationEvent> | undefined = undefined;
    const adapter = getChannelAdapter(envelope.channel);

    if (ctx.incident) {
      const incidentMsg =
        'Thank you for letting us know.\n\n' +
        'We are reviewing the situation.\n' +
        'Our team will assess the apartment condition.\n\n' +
        'Additional cleaning or damage charges may apply if necessary.\n\n' +
        'We will get back to you shortly.';
      replyText = adapter.formatResponse(incidentMsg, commContext as unknown as Record<string, unknown>);
      llmSucceeded = true;
      updateContext(chatId, { escalation_candidate: true });
    } else if (!safety.safe && safety.action === 'escalate_to_operator') {
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
      runInBackground(
        { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_EscalatePolicy', triggerId: String(chatId) },
        async () => {
          const { task_id } = await createOpsTask({
            property_id: commContext.reservation.propertyId ?? 'unknown',
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.GuestIssue,
            title: `Guest issue escalated: ${escalation!.reason}`,
            description: escalation!.summary,
            priority: OpsTaskPriority.Urgent,
            source_event: 'escalation_policy',
            trigger_reason: escalation!.reason,
          });
          if (task_id) {
            await appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
          }
        },
      );
      const escalationBase = "I'm not entirely sure how to answer that. I have flagged this for our team to review!";
      const escalationMsg = templates?.escalation_contact_text
        ? `${escalationBase} ${templates.escalation_contact_text}`
        : escalationBase;
      replyText = adapter.formatResponse(escalationMsg, commContext as unknown as Record<string, unknown>);
    } else if (safety.action === 'provide_check_in_instructions' && templates?.pre_checkin_template) {
      // ── Check-in readiness gate ──────────────────────────────────────
      const gateResult = propertyId
        ? await evaluateCheckinReadiness(propertyId)
        : { allowed: false, unit_state: null, blocked_reason: 'no_property_id', checked_at: new Date().toISOString() };

      if (gateResult.allowed) {
        // Unit is ready — deliver check-in instructions normally
        replyText = adapter.formatResponse(templates.pre_checkin_template, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true;
        // Timeline: gate passed
        runInBackground(
          { correlationId: corrId, module: 'orchestrator', taskName: 'appendTimelineEvent_CheckinPassed', triggerId: identity.guestId },
          () => appendTimelineEvent(identity.guestId, {
            type: 'checkin_gate_passed',
            property_id: propertyId!,
            reservation_id: commContext.reservation.reservationId ?? null,
            ts: new Date(),
          }),
        );
        // Seal pre_checkin_sent_at so the stay-flow runner never double-sends (best-effort)
        if (commContext.reservation.reservationId) {
          const resId = commContext.reservation.reservationId;
          runInBackground(
            { correlationId: corrId, module: 'orchestrator', taskName: 'update_pre_checkin_sent_at', triggerId: resId },
            async () => {
              const { error } = await supabase
                .from('tg_guest_reservations')
                .update({ pre_checkin_sent_at: new Date().toISOString() })
                .eq('id', resId);
              if (error) throw new Error(error.message);
            },
          );
        }
      } else {
        // Unit NOT ready — send safe holding message, never check-in instructions
        const holdingEn = "We're preparing your accommodation — we'll share check-in details once everything is ready!";
        const holdingRu = 'Мы готовим ваше жильё — мы отправим детали заселения, как только всё будет готово!';
        const holdingMsg = classification.lang === 'ru' ? holdingRu : holdingEn;
        replyText = adapter.formatResponse(holdingMsg, commContext as unknown as Record<string, unknown>);
        llmSucceeded = true; // no LLM fallback needed — we have a deterministic safe reply

        // Timeline: gate blocked
        runInBackground(
          { correlationId: corrId, module: 'orchestrator', taskName: 'appendTimelineEvent_ReadinessBlocked', triggerId: identity.guestId },
          () => appendTimelineEvent(identity.guestId, {
            type: 'stay_flow_readiness_blocked',
            property_id: propertyId!,
            blocked_reason: gateResult.blocked_reason ?? 'unit_not_ready',
            reservation_id: commContext.reservation.reservationId ?? null,
            ts: new Date(),
          }),
        );

        // Persist blocked state on reservation (best-effort)
        if (commContext.reservation.reservationId) {
          runInBackground(
            {
              correlationId: corrId,
              module:        'orchestrator',
              taskName:      'update_readiness_blocked',
              triggerId:     commContext.reservation.reservationId ?? undefined,
            },
            async () => {
              const { error } = await supabase
                .from('tg_guest_reservations')
                .update({
                  readiness_blocked:       true,
                  readiness_block_reason:  gateResult.blocked_reason,
                  readiness_checked_at:    gateResult.checked_at,
                })
                .eq('id', commContext.reservation.reservationId);
              if (error) throw new Error(error.message);
            },
          );
        }

        // Ops task: check-in blocked (idempotent via dedup_key)
        runInBackground(
          { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_CheckinBlocked', triggerId: String(chatId) },
          async () => {
            const { error } = await createOpsTask({
              property_id: propertyId ?? 'unknown',
              reservation_id: commContext.reservation.reservationId ?? null,
              chat_id: chatId,
              task_type: OpsTaskType.CheckinReady,
              title: `Check-in blocked: ${gateResult.blocked_reason}`,
              description: `Guest asked for check-in info but unit is not ready. Reason: ${gateResult.blocked_reason}. Unit state: ${gateResult.unit_state ?? 'unknown'}.`,
              priority: OpsTaskPriority.Urgent,
              source_event: 'checkin_gate_blocked',
              trigger_reason: gateResult.blocked_reason ?? 'unit_not_ready',
              dedup_key: `checkin_gate_blocked:${commContext.reservation.reservationId ?? propertyId ?? 'unknown'}`,
            });
            if (error) throw new Error(error);
          },
        );
      }
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
      runInBackground(
        { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_LLMFallback', triggerId: String(chatId) },
        async () => {
          const { task_id, error } = await createOpsTask({
            property_id: commContext.reservation.propertyId ?? 'unknown',
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.GuestIssue,
            title: `Guest issue escalated: ${reason}`,
            description: escalation!.summary,
            priority: classification.slots.isUrgent ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
            source_event: 'escalation_llm_fallback',
            trigger_reason: reason,
          });
          if (error) throw new Error(error);
          if (task_id) {
            await appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
          }
        },
      );
    }

    // Ops task: checkout intent → checkout task (fire-and-forget)
    if (intentResult.intent === IntentCategory.CheckOut && commContext.reservation.propertyId) {
      runInBackground(
        { correlationId: corrId, module: 'orchestrator', taskName: 'createOpsTask_Checkout', triggerId: String(chatId) },
        async () => {
          const { task_id, error } = await createOpsTask({
            property_id: commContext.reservation.propertyId!,
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.Checkout,
            title: 'Guest checkout',
            priority: OpsTaskPriority.Normal,
            source_event: 'checkout_intent',
            trigger_reason: 'checkout_message_sent',
          });
          if (error) throw new Error(error);
          if (task_id) {
            await appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.Checkout, task_id, ts: new Date() });
          }
        },
      );
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
import { TelegramUpdate, TelegramAttachmentRef } from './types';

/**
 * Build a human-readable text summary of any attachments in the message,
 * and collect attachment refs for the operator leads page.
 *
 * Telegram sends photo arrays (smallest→largest). We use the largest size.
 * The file_id lets operators retrieve the actual file via:
 *   GET https://api.telegram.org/bot<TOKEN>/getFile?file_id=...
 */
function extractAttachments(message: NonNullable<TelegramUpdate['message']>): {
  textHint: string;
  refs: TelegramAttachmentRef[];
} {
  const refs: TelegramAttachmentRef[] = [];

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    refs.push({
      type:      'photo',
      label:     `Photo ${largest.width}×${largest.height}px`,
      file_id:   largest.file_id,
      caption:   message.caption ?? undefined,
      file_size: largest.file_size,
    });
  }

  if (message.document) {
    const doc = message.document;
    refs.push({
      type:      'document',
      label:     doc.file_name ?? 'Document',
      file_id:   doc.file_id,
      caption:   message.caption ?? undefined,
      file_size: doc.file_size,
    });
  }

  if (message.caption && refs.length === 0) {
    refs.push({ type: 'note', label: 'Caption', caption: message.caption });
  }

  const parts: string[] = [];
  if (message.photo)    parts.push('[photo]');
  if (message.document) parts.push(`[file: ${message.document.file_name ?? 'document'}]`);
  if (message.caption)  parts.push(`Caption: ${message.caption}`);

  return { textHint: parts.join(' '), refs };
}

export async function processUpdate(update: TelegramUpdate): Promise<ProcessResult> {
  const message = update.message ?? update.edited_message;
  if (!message) return { outcome: ProcessOutcome.Ignored, update_id: update.update_id };

  const { textHint, refs } = extractAttachments(message);
  const baseText = message.text ?? message.caption ?? '';
  // If message has attachments but no text, synthesise a description so the
  // orchestrator can still classify and create an ops task.
  const messageText = baseText || textHint || '';

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: message.chat.id.toString(),
    chatId: message.chat.id.toString(),
    messageText,
    receivedAt: new Date(),
    update_id: update.update_id,
    metadata: refs.length > 0 ? { attachments: refs } : undefined,
  };

  const result = await processMessage(envelope);

  // If there were attachments, append them to the most recently created ops task
  // for this chat so the operator can see what was sent on the leads page.
  if (refs.length > 0) {
    runInBackground(
      { correlationId: String(update.update_id), module: 'orchestrator', taskName: 'appendAttachmentsToLatestTask', triggerId: String(message.chat.id) },
      () => appendAttachmentsToLatestTask(message.chat.id, refs),
    );
  }

  return result;
}

/**
 * Best-effort: find the most recent open ops_task for this chat_id and
 * append attachment_refs so the operator sees them on the leads page.
 */
async function appendAttachmentsToLatestTask(
  chatId: number,
  refs: TelegramAttachmentRef[],
): Promise<void> {
  const { data } = await supabase
    .from('ops_tasks')
    .select('id, attachment_refs')
    .eq('chat_id', chatId)
    .in('task_status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return;

  const existing: TelegramAttachmentRef[] = Array.isArray(data.attachment_refs)
    ? (data.attachment_refs as TelegramAttachmentRef[])
    : [];

  await supabase
    .from('ops_tasks')
    .update({
      attachment_refs: [...existing, ...refs],
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id);
}
