import type { CommunicationChannel } from './types';
import type { TelegramGuestAgentDecision } from './telegram-guest-agent';
import type { CommunicationAutopilotDecision } from './autopilot';

export type OperatorHandoffUrgency = 'low' | 'normal' | 'high' | 'critical';

export type OperatorHandoffDecisionV1 = {
  session_id: string | null;
  guest_identity: string | null;
  reason: string;
  urgency: OperatorHandoffUrgency;
  guest_channel: CommunicationChannel;
  guest_transport: string;
  guest_message: string;
  conversation_summary: string;
  detected_intent: string;
  resolved_booking_id: string | null;
  resolved_property_id: string | null;
  suggested_reply: string | null;
  guest_acknowledgement: string | null;
  next_action: string;
  safe_to_auto_send: boolean;
};

const CRITICAL_URGENCY_INTENTS = new Set([
  'urgent_access_problem',
  'access_urgent',
  'critical_safety',
]);

const HIGH_URGENCY_INTENTS = new Set(['legal_sensitive', 'legal', 'conflict']);

const NORMAL_HANDOFF_INTENTS = new Set([
  'booking_payment_support',
  'payment_refund',
  'refund_request',
  'cancellation',
  'booking_change',
  'cleaning_issue',
  'maintenance_issue',
  'noise_complaint',
  'complaint',
  'late_checkout_request',
  'early_checkin_request',
]);

function urgencyFromIntent(intent: string, flags: string[]): OperatorHandoffUrgency {
  if (flags.includes('urgent_access') || CRITICAL_URGENCY_INTENTS.has(intent)) return 'critical';
  if (flags.includes('legal_sensitive') || flags.includes('operator_escalation') || HIGH_URGENCY_INTENTS.has(intent)) return 'high';
  if (NORMAL_HANDOFF_INTENTS.has(intent)) return 'normal';
  return 'low';
}

export function shouldCreateOperatorHandoff(input: {
  agent?: TelegramGuestAgentDecision | null;
  autopilot?: CommunicationAutopilotDecision | null;
  confidenceThreshold?: number;
}): boolean {
  const threshold = input.confidenceThreshold ?? 0.7;
  if (input.agent) {
    if (input.agent.needs_operator) return true;
    if (input.agent.safety_flags.includes('urgent_access')) return true;
    if (input.agent.safety_flags.includes('payment_refund')) return true;
    if (input.agent.safety_flags.includes('legal_sensitive')) return true;
    if (input.agent.safety_flags.includes('booking_change')) return true;
    if (!input.agent.can_auto_reply && input.agent.confidence < threshold) return true;
    if (input.agent.action === 'escalate' || input.agent.action === 'policy_handoff') return true;
  }
  if (input.autopilot) {
    if (input.autopilot.action === 'escalate') return true;
    if (input.autopilot.metadata.urgent) return true;
    if (input.autopilot.confidence < threshold && input.autopilot.action !== 'auto_reply') return true;
  }
  return false;
}

export function buildOperatorHandoffDecision(input: {
  channel: CommunicationChannel;
  transport?: string | null;
  guestMessage: string;
  agent?: TelegramGuestAgentDecision | null;
  autopilot?: CommunicationAutopilotDecision | null;
  bookingId?: string | null;
  propertyId?: string | null;
  sessionId?: string | null;
  guestIdentity?: string | null;
  conversationSummary?: string | null;
  suggestedOperatorReply?: string | null;
}): OperatorHandoffDecisionV1 | null {
  if (!shouldCreateOperatorHandoff(input)) return null;

  const intent =
    input.agent?.intent ??
    input.autopilot?.metadata.intent ??
    'unknown';
  const flags = input.agent?.safety_flags ?? [];
  const reason =
    input.agent?.needs_operator && input.autopilot?.escalationReason
      ? input.autopilot.escalationReason
      : input.autopilot?.escalationReason ??
        input.agent?.intent ??
        'operator_review_required';

  const guestAcknowledgement =
    input.agent?.reply_text?.trim() ||
    input.autopilot?.replyText?.trim() ||
    null;
  const suggested = String(input.suggestedOperatorReply ?? '').trim().slice(0, 800) || null;

  const safeToAuto =
    Boolean(input.agent?.can_auto_reply && input.agent.action === 'auto_reply') &&
    !input.agent?.needs_operator &&
    (input.autopilot?.action === 'auto_reply' || !input.autopilot);

  return {
    session_id: input.sessionId ?? null,
    guest_identity: input.guestIdentity ?? null,
    reason,
    urgency: urgencyFromIntent(intent, flags),
    guest_channel: input.channel,
    guest_transport: String(input.transport ?? input.channel).slice(0, 40),
    guest_message: input.guestMessage,
    conversation_summary:
      String(input.conversationSummary ?? input.guestMessage).trim().replace(/\s+/g, ' ').slice(0, 800),
    detected_intent: intent,
    resolved_booking_id: input.bookingId ?? null,
    resolved_property_id: input.propertyId ?? null,
    suggested_reply: suggested,
    guest_acknowledgement: guestAcknowledgement,
    next_action: 'operator_review_and_reply',
    safe_to_auto_send: safeToAuto,
  };
}
