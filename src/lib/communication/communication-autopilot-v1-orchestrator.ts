import type { ChannelAdapter } from './channels/base';
import { recordCommunicationAutopilotTurn } from './communication-autopilot-crm';
import { isCommunicationAutopilotEnabled } from './communication-autopilot-settings';
import {
  autopilotSessionFromCollectedData,
  patchAutopilotSessionCollectedData,
} from './communication-autopilot-session';
import {
  buildAutopilotSessionPatch,
  runCommunicationAutopilotV1,
} from './communication-autopilot-v1';
import { loadAutonomousSession, patchAutonomousSessionCollectedData } from './conversation-session-store';
import { getGroundedKnowledge } from './knowledge';
import { classifyKnowledgeTopic, requiresAutopilotOperatorEscalation } from './knowledge-resolver';
import { resolveTelegramGuestBookingObjectContext } from './telegram-booking-object-memory';
import { buildOperatorEscalationDetail } from './guest-communication-brain';
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

export function shouldPreferCommunicationAutopilotV1(messageText: string): boolean {
  const text = String(messageText ?? '').trim();
  if (!text) return false;
  if (requiresAutopilotOperatorEscalation(text)) return true;
  return classifyKnowledgeTopic(text) !== 'unknown';
}

export async function tryCommunicationAutopilotV1OrchestratorTurn(
  input: AutopilotV1OrchestratorInput,
): Promise<ProcessResult | null> {
  if (!shouldPreferCommunicationAutopilotV1(input.text)) return null;

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
  const sessionCollectedData = loadAutonomousSession(input.chatId)?.collected_data ?? {};
  const sessionMemory = autopilotSessionFromCollectedData(sessionCollectedData);
  const passport = propertyId ? await getGroundedKnowledge(propertyId) : null;
  const autopilotResult = runCommunicationAutopilotV1({
    messageText: input.text,
    property: autopilotProperty,
    propertyId,
    bookingVerified: bookingObjectCtx.access_verified,
    passport,
    session: sessionMemory,
  });
  const sessionPatch = buildAutopilotSessionPatch({
    result: autopilotResult,
    messageText: input.text,
    propertyId,
    propertyName: autopilotProperty?.object_name ?? null,
    previous: sessionMemory,
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

  if (autopilotResult.needsOperator) {
    input.persistEscalationReview({
      reason: autopilotResult.escalationReason ?? 'operator_required',
      escalationSummary: `communication_autopilot_v1:${autopilotResult.intent}`,
      confidence: 0.9,
      suggestedReply: autopilotResult.replyText,
      source: {
        route: 'communication_autopilot_v1',
        intent: autopilotResult.intent,
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
