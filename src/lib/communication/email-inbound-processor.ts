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
  type InboundMessageEnvelope,
  type Message,
  type ProcessResult,
} from './types';
import { stableEmailChatId } from './email-stable-chat-id';
import { getEmailOutboundMode, isEmailDraftOnly } from './email-outbound-safe-mode';

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

  const orchestrator = await processMessage(envelope);

  if (orchestrator.outcome === 'duplicate') {
    return {
      ok: true,
      skipped: 'duplicate',
      from,
      subject,
      orchestrator,
      outboundMode: getEmailOutboundMode(),
    };
  }

  const review = await createEmailOperatorDraft({
    envelope,
    payload: params.payload,
    orchestrator,
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

async function createEmailOperatorDraft(params: {
  envelope: InboundMessageEnvelope;
  payload: EmailInboundPayload;
  orchestrator: ProcessResult;
}) {
  const identity = await bindIdentity(params.envelope).catch(() => null);
  const { session, key } = getOrCreateConversationSession({
    envelope: params.envelope,
    identity: identity ?? undefined,
  });

  const sessionForReview = appendSessionMessage({
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
    role: identity?.role ?? sessionForReview.role,
    reservationId: sessionForReview.reservationId ?? identity?.reservationId,
    propertyId: sessionForReview.propertyId ?? identity?.propertyId,
    leadId: sessionForReview.leadId ?? identity?.leadId,
    escalationReason,
    confidence: identity?.confidence ?? sessionForReview.confidence,
    latestMessages: latestMessagesForEmailReview(sessionForReview.memory.lastMessages, params),
    suggestedReply: params.orchestrator.reply,
    source: emailReviewSource(params),
    detail: `email_mvp draft_only=${isEmailDraftOnly()} outcome=${params.orchestrator.outcome}`,
  });
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
