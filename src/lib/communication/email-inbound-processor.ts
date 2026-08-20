/**
 * Email inbound processor — MVP guest communication.
 *
 * Normalizes inbound email, runs the shared orchestrator (booking/object memory +
 * policy guardrails), stores an operator draft, and optionally notifies the operator.
 * Guest SMTP send is controlled by EMAIL_AUTO_SEND / EMAIL_DRAFT_ONLY.
 */

import { randomUUID } from 'node:crypto';
import { EmailAdapter, type EmailInboundPayload, getPrimaryEmailAddress } from './channels/email';
import { processMessage } from './orchestrator';
import { bindIdentity } from './identity-binding';
import { resolveCommunicationIdentityRoute } from './communication-identity-routing';
import {
  appendSessionMessage,
  getOrCreateConversationSession,
} from './conversation-session-engine';
import {
  createOrUpdateEscalationReview,
  getActiveEscalationReviewIdForSession,
  getEscalationReview,
} from './operator-review';
import { notifyOperator } from './operator-notify';
import { auditInbound, auditDecision } from './audit';
import { checkAndMarkKey } from './idempotency';
import {
  DeliveryStatus,
  EscalationReason,
  MessageDirection,
  MessageType,
  ProcessOutcome,
  type IdentityResolution,
  type InboundMessageEnvelope,
  type Message,
  type ProcessResult,
} from './types';
import { stableEmailChatId } from './email-stable-chat-id';
import { getEmailOutboundMode, isEmailDraftOnly } from './email-outbound-safe-mode';
import {
  bookingObjectContextToAutopilotFields,
  resolveEmailGuestBookingObjectContext,
} from './telegram-booking-object-memory';
import { decideCommunicationAutopilotResponse } from './autopilot';
import { canClassifyInboundCommunication } from './communication-autopilot-settings';

export type EmailInboundProcessingResult = {
  ok: boolean;
  skipped?: 'auto_reply' | 'duplicate';
  from?: string;
  subject?: string;
  orchestrator?: ProcessResult;
  reviewId?: string;
  outboundMode?: ReturnType<typeof getEmailOutboundMode>;
};

export async function processEmailInbound(params: {
  payload: EmailInboundPayload;
  adapter?: EmailAdapter;
}): Promise<EmailInboundProcessingResult> {
  const adapter = params.adapter ?? new EmailAdapter();
  const from = getPrimaryEmailAddress(params.payload.from);
  const subject = String(params.payload.subject ?? '').trim() || undefined;

  const envelope = await adapter.normalizeInbound(params.payload);
  const inboundKey = String(
    envelope.metadata?.inboundIdempotencyKey ??
      envelope.metadata?.providerMessageId ??
      envelope.metadata?.externalMessageId ??
      `${from}:${subject ?? ''}:${envelope.messageText ?? ''}`,
  );

  if (
    checkAndMarkKey({
      scope: 'action',
      key: `email_inbound:${inboundKey}`,
      meta: { from, subject, providerMessageId: envelope.metadata?.providerMessageId },
    })
  ) {
    auditDecision({
      type: 'ignore',
      chat_id: stableEmailChatId(envelope),
      update_id: envelope.update_id,
      detail: `duplicate_email_inbound key=${inboundKey}`,
    });
    return { ok: true, skipped: 'duplicate', from, subject, outboundMode: getEmailOutboundMode() };
  }

  auditInbound({
    chat_id: stableEmailChatId(envelope),
    update_id: envelope.update_id ?? Date.now(),
    text: envelope.messageText ?? subject ?? '',
  });

  const orchestratorResult = await processMessage(envelope);

  if (orchestratorResult.outcome === ProcessOutcome.Duplicate) {
    return {
      ok: true,
      skipped: 'duplicate',
      from,
      subject,
      orchestrator: orchestratorResult,
      outboundMode: getEmailOutboundMode(),
    };
  }

  const identity = await bindIdentity(envelope).catch(() => null);
  const groundedOrchestrator = await recoverDraftOnlyGroundedGuestReply({
    envelope,
    orchestrator: orchestratorResult,
    identity,
    adapter,
  });
  const orchestrator = await recoverDraftOnlyIdentityClarification({
    envelope,
    orchestrator: groundedOrchestrator,
    identity,
  });

  const review = await createEmailOperatorDraft({
    envelope,
    payload: params.payload,
    orchestrator,
    identity,
  });

  if (isEmailDraftOnly() && orchestrator.reply?.trim()) {
    await notifyOperator(buildEmailDraftNotification({
      from,
      subject,
      replyDraft: orchestrator.reply,
      escalation: orchestrator.escalation?.reason,
      reviewId: review.reviewId,
      outboundMode: getEmailOutboundMode(),
    })).catch(() => undefined);
  }

  return {
    ok: true,
    from,
    subject,
    orchestrator,
    reviewId: review.reviewId,
    outboundMode: getEmailOutboundMode(),
  };
}

export async function processEmailInboundMessage(params: {
  payload: EmailInboundPayload;
  adapter?: EmailAdapter;
}): Promise<EmailInboundProcessingResult> {
  return processEmailInbound(params);
}

function isResolvedGuestIdentity(identity: IdentityResolution | null): boolean {
  if (!identity) return false;
  const role = String(identity.role ?? '').trim().toLowerCase();
  return role === 'guest' || role === 'test_guest';
}

function isBookingContextClarificationReply(reply: string | undefined): boolean {
  const text = String(reply ?? '').trim();
  if (!text) return false;
  const asksForMore = /(уточнит|пришлит|напишит|send|which|what|provide)/i.test(text);
  const mentionsBookingOrProperty =
    /(объект|номер\s+(?:брони|бронирования)|property|booking\s+(?:number|reference)|reservation\s+(?:number|id))/i.test(text);
  return asksForMore && mentionsBookingOrProperty;
}

async function recoverDraftOnlyGroundedGuestReply(params: {
  envelope: InboundMessageEnvelope;
  orchestrator: ProcessResult;
  identity: IdentityResolution | null;
  adapter: EmailAdapter;
}): Promise<ProcessResult> {
  if (!isEmailDraftOnly() || !isResolvedGuestIdentity(params.identity)) {
    return params.orchestrator;
  }

  const currentReply = String(params.orchestrator.reply ?? '').trim();
  const needsRecovery =
    params.orchestrator.outcome === ProcessOutcome.Error ||
    !currentReply ||
    isBookingContextClarificationReply(currentReply);
  if (!needsRecovery) return params.orchestrator;

  const guestEmail = String(params.envelope.email ?? params.envelope.externalUserId ?? '').trim();
  const messageText = String(params.envelope.messageText ?? params.envelope.subject ?? '').trim();
  if (!guestEmail || !messageText) return params.orchestrator;

  // The deterministic email autopilot currently returns RU guest-facing copy.
  // Do not replace a valid EN draft until the email language layer supports the
  // same grounded response contract.
  if (!/[а-яё]/i.test(messageText)) return params.orchestrator;

  const bookingObjectContext = await resolveEmailGuestBookingObjectContext({
    guest_email: guestEmail,
    text: messageText,
  }).catch(() => null);
  if (
    !bookingObjectContext?.booking_resolved ||
    !bookingObjectContext.property_resolved ||
    !canClassifyInboundCommunication(bookingObjectContext.property)
  ) {
    return params.orchestrator;
  }

  const autopilotFields = bookingObjectContextToAutopilotFields(bookingObjectContext);
  const decision = decideCommunicationAutopilotResponse({
    channel: 'email',
    messageText,
    context: {
      ...autopilotFields,
      session: {
        ...(autopilotFields.session ?? {}),
        language: 'ru',
      },
    },
  });

  if (
    decision.action !== 'auto_reply' ||
    !decision.replyText?.trim() ||
    decision.metadata.missingContext.length > 0
  ) {
    return params.orchestrator;
  }

  const reply = params.adapter.formatResponse(decision.replyText, {});
  auditDecision({
    type: 'reply',
    chat_id: stableEmailChatId(params.envelope),
    update_id: params.envelope.update_id,
    detail: `email_draft_only_grounded_reply_recovered intent=${decision.metadata.intent}`,
  });

  return {
    ...params.orchestrator,
    outcome: ProcessOutcome.Replied,
    reply,
  };
}

async function recoverDraftOnlyIdentityClarification(params: {
  envelope: InboundMessageEnvelope;
  orchestrator: ProcessResult;
  identity: IdentityResolution | null;
}): Promise<ProcessResult> {
  if (!isEmailDraftOnly() || params.orchestrator.outcome !== ProcessOutcome.Error || !params.identity) {
    return params.orchestrator;
  }

  const targetId = String(params.envelope.email ?? params.envelope.externalUserId ?? '').trim();
  if (!targetId) return params.orchestrator;

  const route = await resolveCommunicationIdentityRoute({
    envelope: params.envelope,
    identity: params.identity,
    rememberedIdentity: null,
  }).catch(() => null);

  if (route?.route !== 'unknown_clarify' || route.shouldRunGuestConcierge || !route.replyText?.trim()) {
    return params.orchestrator;
  }

  auditDecision({
    type: 'reply',
    chat_id: stableEmailChatId(params.envelope),
    update_id: params.envelope.update_id,
    detail: 'email_draft_only_identity_clarification_recovered route=unknown_clarify',
  });

  return {
    ...params.orchestrator,
    outcome: ProcessOutcome.Replied,
    reply: route.replyText,
  };
}

async function createEmailOperatorDraft(params: {
  envelope: InboundMessageEnvelope;
  payload: EmailInboundPayload;
  orchestrator: ProcessResult;
  identity: IdentityResolution | null;
}) {
  const { session, key } = getOrCreateConversationSession({
    envelope: params.envelope,
    identity: params.identity ?? undefined,
  });

  const sessionForReview = sessionAlreadyContainsInboundEmail(session.memory.lastMessages, params.envelope)
    ? session
    : appendSessionMessage({
        key,
        session,
        direction: 'inbound',
        content: params.envelope.messageText ?? String(params.payload.subject ?? ''),
        meta: {
          ...params.envelope.metadata,
          subject: params.payload.subject ?? null,
          from: getPrimaryEmailAddress(params.payload.from),
        },
      });

  const activeReviewId = getActiveEscalationReviewIdForSession(sessionForReview.sessionId);
  const existingReview = activeReviewId ? getEscalationReview(activeReviewId) : null;
  const escalationReason =
    existingReview?.escalationReason ??
    params.orchestrator.escalation?.reason ??
    (isEmailDraftOnly() ? 'EMAIL_DRAFT_OPERATOR_REVIEW' : EscalationReason.RequiresOperator);

  const targetId =
    getPrimaryEmailAddress(params.payload.from) ||
    params.envelope.email ||
    params.envelope.externalUserId;

  return createOrUpdateEscalationReview({
    sessionId: sessionForReview.sessionId,
    channel: 'email',
    targetId,
    actorId: sessionForReview.actorId,
    role: params.identity?.role ?? sessionForReview.role,
    reservationId: sessionForReview.reservationId ?? params.identity?.reservationId,
    propertyId: sessionForReview.propertyId ?? params.identity?.propertyId,
    leadId: sessionForReview.leadId ?? params.identity?.leadId,
    escalationReason,
    confidence: params.identity?.confidence ?? sessionForReview.confidence,
    latestMessages: latestMessagesForEmailReview(sessionForReview.memory.lastMessages, params),
    suggestedReply: params.orchestrator.reply,
    source: emailReviewSource(params),
    detail: `email_mvp draft_only=${isEmailDraftOnly()} outcome=${params.orchestrator.outcome}`,
  });
}

function sessionAlreadyContainsInboundEmail(
  messages: Message[] | undefined,
  envelope: InboundMessageEnvelope,
): boolean {
  const inboundId = stableEmailInboundIdFromEnvelope(envelope);
  if (!inboundId || !Array.isArray(messages)) return false;

  return messages.some(
    (message) =>
      message.direction === MessageDirection.Inbound &&
      stableEmailInboundIdFromMessage(message) === inboundId,
  );
}

function stableEmailInboundIdFromEnvelope(envelope: InboundMessageEnvelope): string {
  const metadata = envelope.metadata as Record<string, unknown> | undefined;
  return firstStableEmailId(
    metadata?.providerMessageId,
    metadata?.externalMessageId,
    metadata?.message_id,
    metadata?.messageId,
  );
}

function stableEmailInboundIdFromMessage(message: Message): string {
  const metadata = message.meta as Record<string, unknown> | undefined;
  return firstStableEmailId(
    message.providerMessageId,
    metadata?.providerMessageId,
    metadata?.externalMessageId,
    metadata?.message_id,
    metadata?.messageId,
  );
}

function firstStableEmailId(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? '').trim().replace(/^<|>$/g, '');
    if (normalized) return normalized;
  }
  return '';
}

function latestMessagesForEmailReview(
  messages: Message[] | undefined,
  params: {
    envelope: InboundMessageEnvelope;
    payload: EmailInboundPayload;
    orchestrator: ProcessResult;
  },
): Message[] {
  const existing = Array.isArray(messages) ? messages : [];
  if (existing.length > 0) return existing;

  const from = getPrimaryEmailAddress(params.payload.from);
  const subject = String(params.payload.subject ?? '').trim();
  const body = String(params.envelope.messageText ?? '').trim();
  const content = subject ? `Subject: ${subject}\n\n${body || '(empty body)'}` : body || '(empty body)';

  return [
    {
      id: randomUUID(),
      conversationId: `email:${from}`,
      direction: MessageDirection.Inbound,
      type: MessageType.Text,
      content,
      meta: {
        channel: 'email',
        from,
        subject: subject || null,
        providerMessageId: params.envelope.metadata?.providerMessageId ?? null,
      },
      deliveryStatus: DeliveryStatus.Pending,
      providerMessageId: String(params.envelope.metadata?.providerMessageId ?? params.envelope.update_id ?? ''),
      createdAt: (params.envelope.receivedAt ?? new Date()).toISOString(),
    },
  ];
}

function emailReviewSource(params: {
  envelope: InboundMessageEnvelope;
  payload: EmailInboundPayload;
  orchestrator: ProcessResult;
}): Record<string, unknown> {
  return {
    source: 'email_inbound',
    phase: 'email_communication_mvp',
    from: getPrimaryEmailAddress(params.payload.from),
    subject: params.payload.subject ?? null,
    messageId: params.envelope.metadata?.message_id ?? params.envelope.metadata?.providerMessageId ?? null,
    orchestratorOutcome: params.orchestrator.outcome,
    orchestratorCategory: params.orchestrator.category ?? null,
    orchestratorEscalationReason: params.orchestrator.escalation?.reason ?? null,
    outboundMode: getEmailOutboundMode(),
    draftOnly: isEmailDraftOnly(),
  };
}

export function buildEmailDraftNotification(params: {
  from: string;
  subject?: string;
  replyDraft: string;
  escalation?: string;
  reviewId?: string;
  outboundMode?: ReturnType<typeof getEmailOutboundMode>;
}) {
  const header = params.subject?.trim() ? `Re: ${params.subject.trim()}` : 'Guest email draft';
  const lines = [
    `From: ${params.from}`,
    params.subject ? `Subject: ${params.subject}` : null,
    params.escalation ? `Escalation: ${params.escalation}` : null,
    params.reviewId ? `Review: ${params.reviewId}` : null,
    `Mode: ${params.outboundMode ?? getEmailOutboundMode()}`,
    '',
    'Suggested reply draft:',
    params.replyDraft.trim(),
  ].filter(Boolean);

  return {
    subject: `[Email draft] ${header}`,
    body: lines.join('\n'),
    sourceKey: `email:${params.from}`,
  };
}
