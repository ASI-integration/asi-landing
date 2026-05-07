export type TelegramOperationalScenarioFamily =
  | 'CHECK_IN_STANDARD'
  | 'CHECK_IN_EARLY'
  | 'CHECK_IN_VERY_EARLY'
  | 'OBJECT_CLARIFICATION'
  | 'BOOKING_CONTEXT'
  | 'SLOW_ACK'
  | 'ESCALATE_TO_OPERATOR'
  | 'UNKNOWN_OPERATIONAL_REQUEST';

export type TelegramOperationalAction = 'auto_reply' | 'clarify' | 'slow_ack' | 'escalate';

export type TelegramOperationalKnowledgeRule = {
  scenarioFamily: TelegramOperationalScenarioFamily;
  description: string;
  requiredContext: string[];
  safeReplyFacts: string[];
  forbiddenClaims: string[];
};

const COMMON_FORBIDDEN_CLAIMS = [
  'do_not_promise_availability_without_live_status',
  'do_not_mention_cleaning_without_explicit_cleaning_context',
];

export const TELEGRAM_OPERATIONAL_KNOWLEDGE_V1: Record<TelegramOperationalScenarioFamily, TelegramOperationalKnowledgeRule> = {
  CHECK_IN_STANDARD: {
    scenarioFamily: 'CHECK_IN_STANDARD',
    description: 'Standard check-in request around 15:00 window.',
    requiredContext: ['reservation_or_property_context'],
    safeReplyFacts: ['15:00_is_usually_standard_checkin_time', 'request_object_or_booking_if_missing'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_claim_early_checkin_limits_for_standard_time'],
  },
  CHECK_IN_EARLY: {
    scenarioFamily: 'CHECK_IN_EARLY',
    description: 'Conditional early check-in request around 12:00.',
    requiredContext: ['reservation_or_property_context', 'availability_status'],
    safeReplyFacts: ['12:00_is_conditional_early_checkin', 'requires_separate_confirmation'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_confirm_early_checkin_without_status'],
  },
  CHECK_IN_VERY_EARLY: {
    scenarioFamily: 'CHECK_IN_VERY_EARLY',
    description: 'Very early check-in request in 06:00-08:00 range.',
    requiredContext: ['reservation_or_property_context', 'previous_night_occupancy_status'],
    safeReplyFacts: ['06:00_to_08:00_is_very_early', 'possible_only_if_free_from_previous_night'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_confirm_very_early_checkin_without_status'],
  },
  OBJECT_CLARIFICATION: {
    scenarioFamily: 'OBJECT_CLARIFICATION',
    description: 'Need to clarify object/address context.',
    requiredContext: [],
    safeReplyFacts: ['ask_for_object_or_address_once'],
    forbiddenClaims: ['do_not_repeat_object_question_when_context_already_known'],
  },
  BOOKING_CONTEXT: {
    scenarioFamily: 'BOOKING_CONTEXT',
    description: 'Need to clarify or use booking context.',
    requiredContext: [],
    safeReplyFacts: ['persist_booking_context_after_guest_provides_it'],
    forbiddenClaims: ['do_not_drop_existing_booking_context_without_ambiguity'],
  },
  SLOW_ACK: {
    scenarioFamily: 'SLOW_ACK',
    description: 'Safe acknowledgement while request is being routed.',
    requiredContext: [],
    safeReplyFacts: ['short_neutral_acknowledgement', 'no_operational_promise'],
    forbiddenClaims: ['do_not_send_multiple_slow_acks_for_same_update'],
  },
  ESCALATE_TO_OPERATOR: {
    scenarioFamily: 'ESCALATE_TO_OPERATOR',
    description: 'Risky or uncertain request must be escalated to operator.',
    requiredContext: ['operator_handoff'],
    safeReplyFacts: ['state_that_request_is_forwarded'],
    forbiddenClaims: ['do_not_fake_resolution_before_operator_review'],
  },
  UNKNOWN_OPERATIONAL_REQUEST: {
    scenarioFamily: 'UNKNOWN_OPERATIONAL_REQUEST',
    description: 'Unknown operational request with unclear routing.',
    requiredContext: [],
    safeReplyFacts: ['slow_ack_then_escalate_if_still_uncertain'],
    forbiddenClaims: ['do_not_guess_policy_for_unknown_request'],
  },
};

