export type TelegramOperationalScenarioFamily =
  | 'CHECK_IN_STANDARD'
  | 'CHECK_IN_EARLY'
  | 'CHECK_IN_VERY_EARLY'
  | 'LATE_CHECKOUT'
  | 'ACCESS_KEY_ISSUE'
  | 'ADDRESS_FIND_OBJECT'
  | 'WIFI'
  | 'PARKING'
  | 'PETS'
  | 'EXTRA_GUESTS'
  | 'DOCUMENTS_PASSPORT'
  | 'PAYMENT_DEPOSIT'
  | 'CANCELLATION_REFUND'
  | 'CLEANING_LINEN_TOWELS'
  | 'COMPLAINTS_PROBLEMS'
  | 'EMERGENCY_URGENT_ISSUE'
  | 'OPERATOR_HANDOFF'
  | 'OBJECT_CLARIFICATION'
  | 'BOOKING_CONTEXT'
  | 'SLOW_ACK'
  | 'ESCALATE_TO_OPERATOR'
  | 'UNKNOWN_OPERATIONAL_REQUEST';

export type TelegramOperationalAction = 'auto_reply' | 'clarify' | 'slow_ack' | 'escalate';

export type TelegramOperationalKnowledgeRule = {
  scenarioFamily: TelegramOperationalScenarioFamily;
  description: string;
  triggerPatterns: string[];
  requiredContext: string[];
  safeReplyFacts: string[];
  forbiddenClaims: string[];
  expectedAction: TelegramOperationalAction;
};

const COMMON_FORBIDDEN_CLAIMS = [
  'do_not_promise_availability_without_live_status',
  'do_not_mention_cleaning_without_explicit_cleaning_context',
];

export const TELEGRAM_OPERATIONAL_KNOWLEDGE_V1: Record<TelegramOperationalScenarioFamily, TelegramOperationalKnowledgeRule> = {
  CHECK_IN_STANDARD: {
    scenarioFamily: 'CHECK_IN_STANDARD',
    description: 'Standard check-in request around 15:00 window.',
    triggerPatterns: ['заезд в 14:00-16:00', 'check-in at 15:00'],
    requiredContext: ['reservation_or_property_context'],
    safeReplyFacts: ['15:00_is_usually_standard_checkin_time', 'request_object_or_booking_if_missing'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_claim_early_checkin_limits_for_standard_time'],
    expectedAction: 'auto_reply',
  },
  CHECK_IN_EARLY: {
    scenarioFamily: 'CHECK_IN_EARLY',
    description: 'Conditional early check-in request around 12:00.',
    triggerPatterns: ['ранний заезд', 'check-in at 09:00-13:59'],
    requiredContext: ['reservation_or_property_context', 'availability_status'],
    safeReplyFacts: ['12:00_is_conditional_early_checkin', 'requires_separate_confirmation'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_confirm_early_checkin_without_status'],
    expectedAction: 'auto_reply',
  },
  CHECK_IN_VERY_EARLY: {
    scenarioFamily: 'CHECK_IN_VERY_EARLY',
    description: 'Very early check-in request in 06:00-08:00 range.',
    triggerPatterns: ['заезд в 06:00-08:00', 'very early check-in'],
    requiredContext: ['reservation_or_property_context', 'previous_night_occupancy_status'],
    safeReplyFacts: ['06:00_to_08:00_is_very_early', 'possible_only_if_free_from_previous_night'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_confirm_very_early_checkin_without_status'],
    expectedAction: 'auto_reply',
  },
  LATE_CHECKOUT: {
    scenarioFamily: 'LATE_CHECKOUT',
    description: 'Guest requests check-out after standard time.',
    triggerPatterns: ['поздний выезд', 'late checkout', 'выезд до 13:00'],
    requiredContext: ['reservation_or_property_context', 'requested_checkout_time'],
    safeReplyFacts: ['late_checkout_requires_availability_confirmation', 'state_request_forwarded_for_check'],
    forbiddenClaims: ['do_not_confirm_late_checkout_without_availability'],
    expectedAction: 'clarify',
  },
  ACCESS_KEY_ISSUE: {
    scenarioFamily: 'ACCESS_KEY_ISSUE',
    description: 'Door/code/key/intercom access failure.',
    triggerPatterns: ['не открывается дверь', 'код не работает', 'cannot enter', 'locked out'],
    requiredContext: ['reservation_or_property_context', 'failure_mode'],
    safeReplyFacts: ['acknowledge_access_issue', 'prioritize_fast_operator_routing'],
    forbiddenClaims: ['do_not_share_unverified_new_code', 'do_not_claim_issue_resolved_before_confirmation'],
    expectedAction: 'escalate',
  },
  ADDRESS_FIND_OBJECT: {
    scenarioFamily: 'ADDRESS_FIND_OBJECT',
    description: 'Guest asks where object is or how to find entrance.',
    triggerPatterns: ['как найти объект', 'какой адрес', 'how to find', 'где вход'],
    requiredContext: ['property_or_booking_reference'],
    safeReplyFacts: ['ask_for_object_if_missing', 'share_only_verified_navigation_facts'],
    forbiddenClaims: ['do_not_invent_landmarks_or_entry_instructions'],
    expectedAction: 'clarify',
  },
  WIFI: {
    scenarioFamily: 'WIFI',
    description: 'Wi-Fi connection/password/router request.',
    triggerPatterns: ['wi-fi', 'вайфай', 'пароль от интернета', 'router'],
    requiredContext: ['reservation_or_property_context'],
    safeReplyFacts: ['acknowledge_wifi_issue_or_request', 'route_for_property_specific_credentials'],
    forbiddenClaims: ['do_not_disclose_password_not_bound_to_verified_property'],
    expectedAction: 'clarify',
  },
  PARKING: {
    scenarioFamily: 'PARKING',
    description: 'Parking rules/availability inquiry.',
    triggerPatterns: ['парковка', 'где поставить машину', 'parking'],
    requiredContext: ['reservation_or_property_context', 'vehicle_need'],
    safeReplyFacts: ['confirm_need_and_property', 'share_only_verified_parking_rules'],
    forbiddenClaims: ['do_not_guarantee_free_or_available_spot_without_source'],
    expectedAction: 'clarify',
  },
  PETS: {
    scenarioFamily: 'PETS',
    description: 'Pet allowance / rules / surcharge.',
    triggerPatterns: ['с питомцем', 'можно с собакой', 'pets allowed'],
    requiredContext: ['reservation_or_property_context', 'pet_details'],
    safeReplyFacts: ['state_pet_policy_requires_property_check'],
    forbiddenClaims: ['do_not_confirm_pet_approval_without_policy_check'],
    expectedAction: 'clarify',
  },
  EXTRA_GUESTS: {
    scenarioFamily: 'EXTRA_GUESTS',
    description: 'Additional guests not in original booking.',
    triggerPatterns: ['доп гость', 'extra guest', 'нас будет больше'],
    requiredContext: ['reservation_context', 'guest_count_delta'],
    safeReplyFacts: ['state_capacity_and_policy_check_needed'],
    forbiddenClaims: ['do_not_approve_extra_guests_without_capacity_and_policy'],
    expectedAction: 'clarify',
  },
  DOCUMENTS_PASSPORT: {
    scenarioFamily: 'DOCUMENTS_PASSPORT',
    description: 'Passport/documents submission questions.',
    triggerPatterns: ['паспорт', 'документы', 'registration form'],
    requiredContext: ['reservation_or_property_context', 'document_step'],
    safeReplyFacts: ['state_documents_needed_per_flow', 'request_secure_channel_if_needed'],
    forbiddenClaims: ['do_not_request_unnecessary_sensitive_data'],
    expectedAction: 'clarify',
  },
  PAYMENT_DEPOSIT: {
    scenarioFamily: 'PAYMENT_DEPOSIT',
    description: 'Payment/deposit paid, pending, or requested.',
    triggerPatterns: ['залог', 'депозит', 'оплатил', 'payment'],
    requiredContext: ['reservation_or_property_context', 'payment_reference'],
    safeReplyFacts: ['acknowledge_payment_signal', 'state_verification_needed'],
    forbiddenClaims: ['do_not_confirm_receipt_without_financial_match', 'do_not_share_bank_sensitive_data'],
    expectedAction: 'clarify',
  },
  CANCELLATION_REFUND: {
    scenarioFamily: 'CANCELLATION_REFUND',
    description: 'Cancellation or refund eligibility request.',
    triggerPatterns: ['отмена', 'refund', 'вернуть деньги'],
    requiredContext: ['reservation_context', 'rate_or_policy_context'],
    safeReplyFacts: ['state_cancellation_refund_depends_on_policy'],
    forbiddenClaims: ['do_not_promise_refund_amount_or_timeline_without_policy_check'],
    expectedAction: 'escalate',
  },
  CLEANING_LINEN_TOWELS: {
    scenarioFamily: 'CLEANING_LINEN_TOWELS',
    description: 'Cleaning/towel/linen requests.',
    triggerPatterns: ['уборка', 'полотенца', 'постельное белье', 'housekeeping'],
    requiredContext: ['reservation_or_property_context', 'service_scope'],
    safeReplyFacts: ['acknowledge_housekeeping_request', 'ask_scope_if_ambiguous'],
    forbiddenClaims: ['do_not_confirm_service_time_without_operational_slot'],
    expectedAction: 'clarify',
  },
  COMPLAINTS_PROBLEMS: {
    scenarioFamily: 'COMPLAINTS_PROBLEMS',
    description: 'General complaints/problems not immediately life-safety urgent.',
    triggerPatterns: ['жалоба', 'проблема', 'не работает', 'complaint'],
    requiredContext: ['reservation_or_property_context', 'issue_details'],
    safeReplyFacts: ['acknowledge_problem', 'collect_one_best_missing_fact'],
    forbiddenClaims: ['do_not_dismiss_or_blame_guest'],
    expectedAction: 'clarify',
  },
  EMERGENCY_URGENT_ISSUE: {
    scenarioFamily: 'EMERGENCY_URGENT_ISSUE',
    description: 'Urgent safety incident requiring immediate human intervention.',
    triggerPatterns: ['пожар', 'дым', 'газ', 'затопление', 'ambulance', 'police'],
    requiredContext: ['operator_handoff', 'safety_triage'],
    safeReplyFacts: ['prioritize_immediate_escalation', 'provide_short_safety_ack_only'],
    forbiddenClaims: ['do_not_delay_with_nonessential_questions'],
    expectedAction: 'escalate',
  },
  OPERATOR_HANDOFF: {
    scenarioFamily: 'OPERATOR_HANDOFF',
    description: 'Guest asks for human/operator directly.',
    triggerPatterns: ['позовите оператора', 'соедините с человеком', 'human agent'],
    requiredContext: ['operator_handoff'],
    safeReplyFacts: ['confirm_handoff_started'],
    forbiddenClaims: ['do_not_claim_operator_already_joined_without_signal'],
    expectedAction: 'escalate',
  },
  OBJECT_CLARIFICATION: {
    scenarioFamily: 'OBJECT_CLARIFICATION',
    description: 'Need to clarify object/address context.',
    triggerPatterns: ['какой объект', 'какой адрес'],
    requiredContext: [],
    safeReplyFacts: ['ask_for_object_or_address_once'],
    forbiddenClaims: ['do_not_repeat_object_question_when_context_already_known'],
    expectedAction: 'clarify',
  },
  BOOKING_CONTEXT: {
    scenarioFamily: 'BOOKING_CONTEXT',
    description: 'Need to clarify or use booking context.',
    triggerPatterns: ['та же бронь', 'booking reference'],
    requiredContext: [],
    safeReplyFacts: ['persist_booking_context_after_guest_provides_it'],
    forbiddenClaims: ['do_not_drop_existing_booking_context_without_ambiguity'],
    expectedAction: 'auto_reply',
  },
  SLOW_ACK: {
    scenarioFamily: 'SLOW_ACK',
    description: 'Safe acknowledgement while request is being routed.',
    triggerPatterns: ['uncertain_or_unmatched_message'],
    requiredContext: [],
    safeReplyFacts: ['short_neutral_acknowledgement', 'no_operational_promise'],
    forbiddenClaims: ['do_not_send_multiple_slow_acks_for_same_update'],
    expectedAction: 'slow_ack',
  },
  ESCALATE_TO_OPERATOR: {
    scenarioFamily: 'ESCALATE_TO_OPERATOR',
    description: 'Risky or uncertain request must be escalated to operator.',
    triggerPatterns: ['requires_operator_review'],
    requiredContext: ['operator_handoff'],
    safeReplyFacts: ['state_that_request_is_forwarded'],
    forbiddenClaims: ['do_not_fake_resolution_before_operator_review'],
    expectedAction: 'escalate',
  },
  UNKNOWN_OPERATIONAL_REQUEST: {
    scenarioFamily: 'UNKNOWN_OPERATIONAL_REQUEST',
    description: 'Unknown operational request with unclear routing.',
    triggerPatterns: ['fallback_unknown'],
    requiredContext: [],
    safeReplyFacts: ['slow_ack_then_escalate_if_still_uncertain'],
    forbiddenClaims: ['do_not_guess_policy_for_unknown_request'],
    expectedAction: 'slow_ack',
  },
};

