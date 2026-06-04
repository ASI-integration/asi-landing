import type { CommunicationChannel } from './types';
import type { TelegramGuestAgentDecision } from './telegram-guest-agent';
import type { CommunicationAutopilotDecision } from './autopilot';

export type OperatorHandoffUrgency = 'low' | 'normal' | 'high' | 'critical';

export type OperatorHandoffDecisionV1 = {
  reason: string;
  urgency: OperatorHandoffUrgency;
  guest_channel: CommunicationChannel;
  guest_message: string;
  resolved_booking_id: string | null;
  resolved_property_id: string | null;
  suggested_reply: string | null;
  safe_to_auto_send: boolean;
};

const HIGH_URGENCY_INTENTS = new Set([
  'urgent_access_problem',
  'access_urgent',
  'legal_sensitive',
]);

const NORMAL_HANDOFF_INTENTS = new Set([
  'booking_payment_support',
  'payment_refund',
  'cancellation',
  'booking_change',
  'cleaning_issue',
  'maintenance_issue',
]);

function urgencyFromIntent(intent: string, flags: string[]): OperatorHandoffUrgency {
  if (flags.includes('urgent_access') || HIGH_URGENCY_INTENTS.has(intent)) return 'critical';
  if (flags.includes('legal_sensitive') || flags.includes('operator_escalation')) return 'high';
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
  guestMessage: string;
  agent?: TelegramGuestAgentDecision | null;
  autopilot?: CommunicationAutopilotDecision | null;
  bookingId?: string | null;
  propertyId?: string | null;
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

  const suggested =
    input.agent?.reply_text?.trim() ||
    input.autopilot?.replyText?.trim() ||
    null;

  const safeToAuto =
    Boolean(input.agent?.can_auto_reply && input.agent.action === 'auto_reply') &&
    !input.agent?.needs_operator &&
    (input.autopilot?.action === 'auto_reply' || !input.autopilot);

  return {
    reason,
    urgency: urgencyFromIntent(intent, flags),
    guest_channel: input.channel,
    guest_message: input.guestMessage,
    resolved_booking_id: input.bookingId ?? null,
    resolved_property_id: input.propertyId ?? null,
    suggested_reply: suggested,
    safe_to_auto_send: safeToAuto,
  };
}
