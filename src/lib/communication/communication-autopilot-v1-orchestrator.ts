import type { ChannelAdapter } from './channels/base';
import { recordCommunicationAutopilotTurn } from './communication-autopilot-crm';
import { isCommunicationAutopilotEnabled } from './communication-autopilot-settings';
import {
  autopilotSessionFromCollectedData,
  patchAutopilotSessionCollectedData,
} from './communication-autopilot-session';
import {
  buildAutopilotSessionPatch,
  detectOperationalLanguage,
  isExplicitOperationalLanguageSwitch,
  runCommunicationAutopilotV1,
} from './communication-autopilot-v1';
import { logCommAgentMetrics } from './comm-agent-metrics';
import { loadAutonomousSession, patchAutonomousSessionCollectedData } from './conversation-session-store';
import { getGroundedKnowledge } from './knowledge';
import { classifyKnowledgeTopic, requiresAutopilotOperatorEscalation } from './knowledge-resolver';
import { resolveTelegramGuestBookingObjectContext } from './telegram-booking-object-memory';
import { buildOperatorEscalationDetail } from './guest-communication-brain';
import {
  loadRelevantGuestMemory,
  observeGuestCommunication,
} from './guest-long-term-memory';
import type { CommunicationIdentityRoutingDecision } from './communication-identity-routing';
import { SessionStatus, transitionSessionStatus } from './session-status';
import { MessageCategory, ProcessOutcome, type IdentityResolution, type InboundMessageEnvelope, type ProcessResult } from './types';

type AutopilotV1OrchestratorInput = {
  text: string;
  chatId: number;
  update_id: number;
  envelope: InboundMessageEnvelope;
  identity: IdentityResolution;
  senderRoute: CommunicationIdentityRoutingDecision;
  adapter: ChannelAdapter;
  commContext: {
    reservation: {
      propertyId?: string | null;
    };
  };
  transportEventMeta: Record<string, unknown>;
  sessionId: string;
  guestIdentity: string | null;
  conversationSummary: string | null;
  persistEscalationReview: (params: {
    reason: string;
    escalationSummary: string;
    confidence?: number;
    suggestedReply?: string;
    detail?: string;
    source?: Record<string, unknown>;
  }) => void;
  resolveOutboundTargetId: (
    envelope: InboundMessageEnvelope,
    guestId: string | null | undefined,
  ) => string | number | null;
  withAwaitCheckpoint: <T>(
    label: string,
    fn: () => Promise<T>,
    meta: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<T>;
};

export function shouldPreferCommunicationAutopilotV1(
  messageText: string,
  session?: ReturnType<typeof autopilotSessionFromCollectedData>,
): boolean {
  const text = String(messageText ?? '').trim();
  if (!text) return false;
  if (requiresAutopilotOperatorEscalation(text)) return true;
  if (isExplicitOperationalLanguageSwitch(text)) return true;
  if (classifyKnowledgeTopic(text) !== 'unknown') return true;
  if (session?.requested_missing_field === 'booking_reference') {
    return /^(?=.{4,40}$)(?=.*\d)[A-ZА-Я0-9][A-ZА-Я0-9._/-]*$/i.test(text);
  }
  if (session?.requested_missing_field === 'requested_time') {
    return /^(?:до\s+|к\s+|until\s+|at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/i.test(text);
  }
  return false;
}

export async function tryCommunicationAutopilotV1OrchestratorTurn(
  input: AutopilotV1OrchestratorInput,
): Promise<ProcessResult | null> {
  const sessionCollectedData = loadAutonomousSession(input.chatId)?.collected_data ?? {};
  const sessionMemory = autopilotSessionFromCollectedData(sessionCollectedData);
  if (!shouldPreferCommunicationAutopilotV1(input.text, sessionMemory)) return null;

  const bookingObjectCtx = await input.withAwaitCheckpoint(
    'memory/booking_object.resolve.await',
    () =>
      resolveTelegramGuestBookingObjectContext({
        telegram_chat_id: input.chatId,
        text: input.text,
      }),
    { chat_id: input.chatId },
    15_000,
  );
  const autopilotProperty = bookingObjectCtx.property;
  if (!isCommunicationAutopilotEnabled(autopilotProperty)) return null;

  const propertyId =
    autopilotProperty?.object_id ??
    input.commContext.reservation.propertyId ??
    input.identity.propertyId ??
    null;
  const passport = propertyId ? await getGroundedKnowledge(propertyId) : null;
  const guestMemory = await loadRelevantGuestMemory({
    guestId: input.identity.guestId,
    requestText: input.text,
  });
  const autopilotResult = runCommunicationAutopilotV1({
    messageText: input.text,
    property: autopilotProperty,
    propertyId,
    bookingVerified: bookingObjectCtx.access_verified,
    passport,
    session: sessionMemory,
    guestMemory,
    language: detectOperationalLanguage(input.text, sessionMemory),
  });
  if (input.identity.guestId) {
    await observeGuestCommunication({
      guestId: input.identity.guestId,
      messageText: input.text,
      language: autopilotResult.language,
      transport: String(input.transportEventMeta.transport ?? input.envelope.channel),
      sourceRef: input.sessionId,
    }).catch((error) => {
      console.warn('[communication-autopilot-v1] guest memory write skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  const sessionPatch = buildAutopilotSessionPatch({
    result: autopilotResult,
    messageText: input.text,
    propertyId,
    propertyName: autopilotProperty?.object_name ?? null,
    previous: sessionMemory,
    transport: String(input.transportEventMeta.transport ?? input.envelope.channel),
    bookingReference: bookingObjectCtx.booking?.booking_id ?? null,
  });
  patchAutonomousSessionCollectedData({
    chatId: input.chatId,
    channel: input.envelope.channel,
    set: patchAutopilotSessionCollectedData({
      memory: sessionPatch,
    }),
  });

  const telegramUserId = String(
    input.envelope.metadata?.telegram_user_id ??
      input.envelope.metadata?.telegramUserId ??
      input.envelope.externalUserId ??
      input.chatId,
  );
  await recordCommunicationAutopilotTurn({
    telegramUserId,
    telegramChatId: input.chatId,
    propertyId,
    guestQuestion: input.text,
    result: autopilotResult,
    role: input.senderRoute.senderIdentity,
    ...input.transportEventMeta,
  });
  const transport = String(input.transportEventMeta.transport ?? input.envelope.channel).slice(0, 40);
  const urgency = autopilotResult.intent === 'critical_safety' || autopilotResult.intent === 'urgent_access_problem'
    ? 'critical'
    : autopilotResult.intent === 'legal' || autopilotResult.intent === 'conflict'
      ? 'high'
      : 'normal';
  logCommAgentMetrics({
    channel: input.envelope.channel,
    session_key: input.sessionId,
    intent: autopilotResult.intent,
    confidence: 0.9,
    action: autopilotResult.action === 'operator_handoff'
      ? 'escalate'
      : autopilotResult.action === 'auto_reply'
        ? 'auto_reply'
        : 'ask_clarification',
    source: autopilotResult.memoryUsed ? 'session_continuation' : 'deterministic_mvp',
    memory_used: autopilotResult.memoryUsed,
    booking_resolved: bookingObjectCtx.booking_resolved,
    operator_needed: autopilotResult.needsOperator,
    auto_reply_allowed: autopilotResult.action === 'auto_reply' && !autopilotResult.needsOperator,
    operational_outcome: autopilotResult.needsOperator
      ? 'safety_blocked'
      : autopilotResult.resolved
        ? 'auto_resolved'
        : 'clarification',
    language: autopilotResult.language,
    transport,
    handoff_reason: autopilotResult.escalationReason,
    handoff_urgency: autopilotResult.needsOperator ? urgency : undefined,
    safety_blocked_action: Boolean(autopilotResult.safetyBlockedAction),
  });

  if (autopilotResult.needsOperator) {
    input.persistEscalationReview({
      reason: autopilotResult.escalationReason ?? 'operator_required',
      escalationSummary: `communication_autopilot_v1:${autopilotResult.intent}`,
      confidence: 0.9,
      source: {
        route: 'communication_autopilot_v1',
        session_id: input.sessionId,
        guest_identity: input.guestIdentity,
        channel: input.envelope.channel,
        transport,
        booking_id: bookingObjectCtx.booking?.booking_id ?? null,
        property_id: propertyId,
        latest_guest_request: input.text.slice(0, 800),
        conversation_summary: String(input.conversationSummary ?? input.text).replace(/\s+/g, ' ').slice(0, 800),
        intent: autopilotResult.intent,
        reason: autopilotResult.escalationReason ?? 'operator_required',
        urgency,
        guest_acknowledgement: autopilotResult.replyText,
        what_asi_told_guest: autopilotResult.replyText,
        next_action: 'operator_review_and_reply',
        needs_operator: true,
      },
      detail: buildOperatorEscalationDetail({
        role: input.senderRoute.senderIdentity,
        intent: autopilotResult.intent,
        message: input.text,
        reason: autopilotResult.escalationReason ?? 'Нужна проверка оператора.',
        recommendedStep: autopilotResult.replyText,
      }),
    });
    await input.withAwaitCheckpoint(
      'session.transition.operator_review_required_autopilot_v1',
      () => transitionSessionStatus(input.chatId, SessionStatus.OperatorReviewRequired),
      { chat_id: input.chatId },
      15_000,
    );
  }

  const targetId = input.resolveOutboundTargetId(input.envelope, input.identity.guestId);
  if (!targetId) {
    return { outcome: ProcessOutcome.Error, update_id: input.update_id, chat_id: input.chatId };
  }
  const sent = await input.adapter.sendMessage(String(targetId), autopilotResult.replyText, {
    reply_handler: `orchestrator:communication_autopilot_v1:${autopilotResult.action}`,
    update_id: input.update_id,
    sender_identity: input.senderRoute.senderIdentity,
    communication_autopilot_v1: true,
    autopilot_action: autopilotResult.action,
    autopilot_intent: autopilotResult.intent,
    needs_operator: autopilotResult.needsOperator,
    conversation_resolved: autopilotResult.resolved,
  });
  if (!sent) return { outcome: ProcessOutcome.Error, update_id: input.update_id, chat_id: input.chatId };
  return {
    outcome: ProcessOutcome.Replied,
    update_id: input.update_id,
    chat_id: input.chatId,
    category: MessageCategory.GuestMessage,
    reply: autopilotResult.replyText,
  };
}
