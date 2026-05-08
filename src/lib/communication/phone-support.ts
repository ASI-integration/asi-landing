/**
 * Phone Support Phase 1 processing.
 *
 * This module keeps phone as a transport/channel concern. Transcript text,
 * when present, goes through the shared communication orchestrator. Call-only
 * events create operator-visible review records without inventing message text.
 */

import { randomUUID } from 'node:crypto';
import { PhoneAdapter, type NormalizedPhoneCallEvent } from './channels/phone';
import { processMessage } from './orchestrator';
import { auditDecision, auditEscalation, auditInbound } from './audit';
import { checkAndMarkKey } from './idempotency';
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
import {
  EscalationReason,
  MessageDirection,
  DeliveryStatus,
  MessageType,
  type InboundMessageEnvelope,
  type Message,
  type ProcessResult,
} from './types';
import { normalizeGuestMessageForCanon } from './communication-normalizer';

const adapter = new PhoneAdapter();

export type PhoneCallProcessingResult = {
  ok: boolean;
  ignored?: boolean;
  duplicate?: boolean;
  eventType?: NormalizedPhoneCallEvent['eventType'];
  providerCallId?: string;
  reviewId?: string;
  orchestrator?: ProcessResult;
};

export async function processPhoneCallEvent(event: NormalizedPhoneCallEvent): Promise<PhoneCallProcessingResult> {
  const duplicate = checkAndMarkKey({
    scope: 'action',
    key: `phone_call_event:${event.idempotencyKey}`,
    meta: {
      provider: event.provider,
      providerCallId: event.providerCallId,
      eventType: event.eventType,
      update_id: event.update_id,
    },
  });

  if (duplicate) {
    auditDecision({
      type: 'ignore',
      chat_id: stablePhoneChatId(event),
      update_id: event.update_id,
      detail: `duplicate_phone_call_event key=${event.idempotencyKey}`,
    });
    return {
      ok: true,
      ignored: true,
      duplicate: true,
      eventType: event.eventType,
      providerCallId: event.providerCallId,
    };
  }

  const transcriptText = event.transcriptText?.trim();
  let envelope = await adapter.normalizeInbound(event);
  let orchestrator: ProcessResult | undefined;

  auditInbound({
    chat_id: stablePhoneChatId(event),
    update_id: event.update_id,
    text: transcriptText || phoneCallSummary(event),
  });

  if (transcriptText) {
    orchestrator = await processMessage(envelope);
    envelope = await adapter.normalizeInbound(event);
  }

  const review = await createPhoneOperatorReview({
    event,
    envelope,
    orchestrator,
    transcriptProcessed: Boolean(transcriptText),
  });

  auditEscalation({
    chat_id: stablePhoneChatId(event),
    update_id: event.update_id,
    detail: `phone_phase1 event=${event.eventType} provider=${event.provider} reviewId=${review.reviewId}`,
  });
  auditDecision({
    type: 'escalate',
    chat_id: stablePhoneChatId(event),
    update_id: event.update_id,
    detail: `phone_phase1_default_operator_review event=${event.eventType}`,
  });

  return {
    ok: true,
    eventType: event.eventType,
    providerCallId: event.providerCallId,
    reviewId: review.reviewId,
    orchestrator,
  };
}

async function createPhoneOperatorReview(params: {
  event: NormalizedPhoneCallEvent;
  envelope: InboundMessageEnvelope;
  orchestrator?: ProcessResult;
  transcriptProcessed: boolean;
}) {
  const identity = await bindIdentity(params.envelope).catch(() => null);
  const { session, key } = getOrCreateConversationSession({
    envelope: params.envelope,
    identity: identity ?? undefined,
  });

  const sessionForReview = params.transcriptProcessed
    ? session
    : appendSessionMessage({
        key,
        session,
        direction: 'inbound',
        content: phoneCallSummary(params.event),
        meta: params.envelope.metadata,
      });

  const activeReviewId = getActiveEscalationReviewIdForSession(sessionForReview.sessionId);
  const existingReview = activeReviewId ? getEscalationReview(activeReviewId) : null;
  const phoneUrgent = isUrgentPhoneEvent(params.event);
  const escalationReason =
    existingReview?.escalationReason ??
    (phoneUrgent
      ? EscalationReason.UrgentIssue
      : params.event.eventType === 'call_missed'
        ? 'PHONE_CALL_MISSED'
        : params.event.eventType === 'call_transcribed'
          ? 'PHONE_TRANSCRIPT_OPERATOR_REVIEW'
          : params.event.eventType === 'call_escalated_to_operator'
            ? 'PHONE_CALL_ESCALATED_TO_OPERATOR'
            : 'PHONE_CALL_OPERATOR_REVIEW');

  const targetId = params.event.callerPhoneNumber ?? params.event.providerCallId;
  const suggestedReply =
    existingReview?.suggestedReply ??
    (params.orchestrator?.reply ? params.orchestrator.reply : undefined);

  return createOrUpdateEscalationReview({
    sessionId: sessionForReview.sessionId,
    channel: 'phone',
    targetId,
    actorId: sessionForReview.actorId,
    role: identity?.role ?? sessionForReview.role,
    reservationId: sessionForReview.reservationId ?? identity?.reservationId,
    propertyId: sessionForReview.propertyId ?? identity?.propertyId,
    leadId: sessionForReview.leadId ?? identity?.leadId,
    escalationReason,
    confidence: phoneUrgent ? 1 : (identity?.confidence ?? sessionForReview.confidence),
    latestMessages: latestMessagesForReview(sessionForReview.memory.lastMessages, params.event),
    suggestedReply,
    source: {
      ...phoneReviewSource(params),
      previousSource: existingReview?.source ?? null,
    },
    detail: `phone_phase1 event=${params.event.eventType} status=${params.event.callStatus} provider=${params.event.provider}`,
  });
}

export function phoneCallSummary(event: NormalizedPhoneCallEvent): string {
  const parts = [
    `Phone call ${event.callStatus}`,
    event.callerPhoneNumber ? `from ${event.callerPhoneNumber}` : null,
    event.calledNumber ? `to ${event.calledNumber}` : null,
    event.durationSeconds !== undefined ? `duration ${event.durationSeconds}s` : null,
  ].filter(Boolean);

  const transcript = event.transcriptText?.trim();
  return transcript ? `${parts.join(' ')}. Transcript: ${transcript}` : `${parts.join(' ')}.`;
}

function latestMessagesForReview(messages: Message[] | undefined, event: NormalizedPhoneCallEvent): Message[] {
  const existing = Array.isArray(messages) ? messages : [];
  if (existing.length > 0) return existing;
  return [
    {
      id: randomUUID(),
      conversationId: `phone:${event.providerCallId}`,
      direction: MessageDirection.Inbound,
      type: event.transcriptText ? MessageType.Text : MessageType.System,
      content: phoneCallSummary(event),
      meta: { phone: phoneReviewSource({ event, transcriptProcessed: Boolean(event.transcriptText) }) },
      deliveryStatus: DeliveryStatus.Pending,
      providerMessageId: event.idempotencyKey,
      createdAt: event.timestamp.toISOString(),
    },
  ];
}

function phoneReviewSource(params: {
  event: NormalizedPhoneCallEvent;
  orchestrator?: ProcessResult;
  transcriptProcessed: boolean;
}): Record<string, unknown> {
  const event = params.event;
  return {
    source: 'phone_call',
    phase: 'phone_support_phase_1',
    provider: event.provider,
    providerCallId: event.providerCallId,
    callerPhoneNumber: event.callerPhoneNumber ?? null,
    calledNumber: event.calledNumber ?? null,
    eventType: event.eventType,
    callStatus: event.callStatus,
    timestamp: event.timestamp.toISOString(),
    durationSeconds: event.durationSeconds ?? null,
    recordingUrl: event.recordingUrl ?? null,
    transcriptText: event.transcriptText ?? null,
    transcriptProcessed: params.transcriptProcessed,
    orchestratorOutcome: params.orchestrator?.outcome ?? null,
    orchestratorCategory: params.orchestrator?.category ?? null,
    orchestratorEscalationReason: params.orchestrator?.escalation?.reason ?? null,
    providerMetadata: event.providerMetadata,
  };
}

function isUrgentPhoneEvent(event: NormalizedPhoneCallEvent): boolean {
  if (event.eventType === 'call_escalated_to_operator') return true;
  const meta = event.providerMetadata;
  const priority = String(
    meta.priority ??
      meta.urgency ??
      meta.severity ??
      meta.call_priority ??
      '',
  ).toLowerCase();
  const repeatedCount = Number(
    meta.repeatedCallCount ??
      meta.repeated_call_count ??
      meta.call_count ??
      meta.attempt_count ??
      meta.attempts ??
      0,
  );

  if (meta.urgent === true || meta.is_urgent === true) return true;
  if (priority.includes('urgent') || priority.includes('emergency')) return true;
  if (Number.isFinite(repeatedCount) && repeatedCount > 1) return true;

  const transcript = event.transcriptText?.trim();
  if (!transcript) return false;
  const normalized = normalizeGuestMessageForCanon(transcript);
  return normalized.urgency.urgent || normalized.urgency.accessBlocked;
}

function stablePhoneChatId(event: NormalizedPhoneCallEvent): number {
  const basis = event.callerPhoneNumber ?? event.providerCallId ?? event.idempotencyKey;
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = h | 0;
  return out === 0 ? 1 : out;
}
