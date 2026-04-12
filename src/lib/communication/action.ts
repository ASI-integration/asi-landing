import {
  ActionSafetyResult,
  ActionType,
  CommunicationContext,
  EscalationReason,
  IntentCategory,
} from './types';
import { getAutonomousIntentEscalationThreshold } from './escalation-engine';
import { classifyIssuePriority } from './triage';
import { extractSlots } from './classifier';

export function evaluateActionSafety(
  context: CommunicationContext,
  text: string
): ActionSafetyResult {
  const { intentResult, reservation } = context;
  const slots = extractSlots(text);
  const priority = classifyIssuePriority(text, intentResult.intent, slots);

  // 1. Emergency Bypass
  if (priority === 'emergency') {
    return {
      safe: false,
      action: 'escalate_to_operator',
      reason: 'Emergency detected. Bypassing normal chat flow.',
      escalationReason: EscalationReason.UrgentIssue,
    };
  }

  // 2. Urgent Issue Bypass
  if (priority === 'urgent') {
    return {
      safe: false,
      action: 'escalate_to_operator',
      reason: 'Urgent issue detected. Escalating to operator.',
      escalationReason: EscalationReason.UrgentIssue,
    };
  }

  // 3. Ambiguous reservation: ask clarifying question
  if (reservation.status === 'ambiguous') {
    return {
      safe: true,
      action: 'ask_clarifying_question',
      reason: 'Multiple reservations match. Need to ask clarifying question.',
    };
  }

  // 4. Low confidence intent — clarify only above autonomous escalation threshold
  const autoEscFloor = getAutonomousIntentEscalationThreshold();
  if (intentResult.confidence < 0.6 && intentResult.confidence >= autoEscFloor) {
    return {
      safe: true,
      action: 'ask_clarifying_question',
      reason: `Low intent confidence (${intentResult.confidence}). Asking clarifying question instead of escalating.`,
    };
  }

  // 5. Payment request needs high confidence mapping (unmatched -> ask)
  if (intentResult.intent === IntentCategory.PaymentRequest) {
    if (reservation.status === 'unmatched') {
      return {
        safe: false, // or true but 'ask_clarifying_question'
        action: 'ask_clarifying_question',
        reason: 'Payment requested but no matched reservation found.',
      };
    }
    return {
      safe: true,
      action: 'trigger_payment_request',
    };
  }

  // 6. Check-in/Checkout instructions
  if (intentResult.intent === IntentCategory.CheckInInfo) {
    return { safe: true, action: 'provide_check_in_instructions' };
  }
  if (intentResult.intent === IntentCategory.CheckOut) {
    return { safe: true, action: 'provide_checkout_instructions' };
  }

  // 7. Vague messages
  if (intentResult.intent === IntentCategory.Unknown) {
    return {
      safe: true,
      action: 'ask_clarifying_question',
      reason: 'Vague message. Asking to clarify.',
    };
  }

  // Default: Informational rely based on grounded knowledge
  return {
    safe: true,
    action: 'send_informational_reply',
  };
}
