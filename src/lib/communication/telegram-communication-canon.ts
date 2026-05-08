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

export type CheckinTimeBucket =
  | 'very_early_checkin'
  | 'early_checkin'
  | 'conditional_early_checkin'
  | 'normal_checkin'
  | 'late_checkin'
  | 'unknown';

export type CanonicalCheckinTimePolicy = {
  bucket: CheckinTimeBucket;
  isEarlyCheckinByTime: boolean;
  requiresCleaningAvailability: boolean;
  requiresPreviousNightAvailability: boolean;
  policy: string;
  scenarioFamily: 'CHECK_IN_STANDARD' | 'CHECK_IN_EARLY' | 'CHECK_IN_VERY_EARLY' | null;
};

export type CommunicationCanonSource = {
  path: string;
  role: string;
  affects: string[];
};

export type CommunicationCanonRuleGroups = {
  autoReply: TelegramOperationalScenarioFamily[];
  requiresClarification: TelegramOperationalScenarioFamily[];
  requiresEscalation: TelegramOperationalScenarioFamily[];
  requiredContext: {
    objectOrBooking: TelegramOperationalScenarioFamily[];
    operatorHandoff: TelegramOperationalScenarioFamily[];
  };
  toneStyle: {
    russianGuestReplies: string[];
    telegramStyle: string[];
  };
  prohibitedHallucinations: string[];
  automation: string[];
};

const COMMON_FORBIDDEN_CLAIMS = [
  'do_not_promise_availability_without_live_status',
  'do_not_mention_cleaning_without_explicit_cleaning_context',
];

export const TELEGRAM_COMMUNICATION_CANON_SOURCES: CommunicationCanonSource[] = [
  {
    path: 'docs/CANONICAL-AI-GUIDED-SETUP-AND-DASHBOARD.md',
    role: 'Canonical product and truthfulness doctrine for guided setup, Master Card/object context, and honest unfinished behavior.',
    affects: ['booking_context', 'object_context', 'guest_guidance', 'truthfulness'],
  },
  {
    path: 'docs/telegram-bot-source-of-truth.md',
    role: 'Production Telegram routing source of truth.',
    affects: ['telegram_webhook', 'orchestrator_entrypoint', 'production_behavior'],
  },
  {
    path: 'docs/telegram-communication-architecture.md',
    role: 'Communication pipeline, escalation, idempotency, persistence, and handoff architecture.',
    affects: ['orchestrator', 'escalation', 'operator_handoff', 'duplicate_prevention'],
  },
  {
    path: 'docs/communication-live-test-plan.md',
    role: 'Operational acceptance behavior for Telegram text, handoff, duplicates, and dry-run safety.',
    affects: ['manual_acceptance', 'slow_ack', 'operator_handoff', 'telegram_text'],
  },
  {
    path: 'docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md',
    role: 'OPS autonomy boundaries: silent by default, safe operational autonomy, human review for disputes/finance/safety.',
    affects: ['ops_policy', 'automation_boundaries', 'complaints', 'refunds', 'safety_escalation'],
  },
  {
    path: 'docs/platform-90-percent-roadmap.md',
    role: 'Communication/Ops integration target: avoid duplicate policies and keep reservation ambiguity covered.',
    affects: ['reservation_ambiguity', 'comm_ops_integration', 'policy_deduplication'],
  },
];

export const TELEGRAM_OPERATIONAL_KNOWLEDGE_V1: Record<TelegramOperationalScenarioFamily, TelegramOperationalKnowledgeRule> = {
  CHECK_IN_STANDARD: {
    scenarioFamily: 'CHECK_IN_STANDARD',
    description: 'Standard check-in request around the 15:00 window.',
    triggerPatterns: ['заезд в 14:00-16:00', 'check-in at 15:00'],
    requiredContext: ['reservation_or_property_context'],
    safeReplyFacts: ['15:00_is_standard_checkin_time', 'request_object_or_booking_if_missing'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_claim_early_checkin_limits_for_standard_time'],
    expectedAction: 'auto_reply',
  },
  CHECK_IN_EARLY: {
    scenarioFamily: 'CHECK_IN_EARLY',
    description: 'Conditional early check-in request before the standard check-in window.',
    triggerPatterns: ['ранний заезд', 'check-in at 09:00-13:59'],
    requiredContext: ['reservation_or_property_context', 'availability_status'],
    safeReplyFacts: ['12:00_is_conditional_not_guaranteed', 'requires_separate_confirmation'],
    forbiddenClaims: [...COMMON_FORBIDDEN_CLAIMS, 'do_not_confirm_early_checkin_without_status'],
    expectedAction: 'auto_reply',
  },
  CHECK_IN_VERY_EARLY: {
    scenarioFamily: 'CHECK_IN_VERY_EARLY',
    description: 'Very early check-in request in the 06:00-08:00 range.',
    triggerPatterns: ['заезд в 06:00-08:00', 'very early check-in'],
    requiredContext: ['reservation_or_property_context', 'previous_night_occupancy_status'],
    safeReplyFacts: ['06:00_to_08:00_requires_previous_night_availability', 'do_not_treat_same_day_cleaning_as_certain'],
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
    safeReplyFacts: ['acknowledge_problem', 'collect_one_best_missing_fact', 'route_dispute_or_sensitive_problem_to_operator'],
    forbiddenClaims: ['do_not_dismiss_or_blame_guest'],
    expectedAction: 'escalate',
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

const RUSSIAN_GUEST_REPLY_STYLE = [
  'short_and_operational',
  'polite_plain_russian',
  'one_best_clarifying_question',
  'no_gender_placeholders',
  'no_false_resolution_claims',
];

const TELEGRAM_REPLY_STYLE = [
  'single_final_reply_per_update',
  'omit_slow_ack_after_final_reply',
  'avoid_multi_paragraph_dump',
  'templates_are_allowed_only_after_policy_decision',
];

const PROHIBITED_HALLUCINATIONS = [
  'do_not_invent_object_specific_facts',
  'do_not_guess_wifi_password_or_door_code',
  'do_not_invent_address_entrance_parking_or_landmarks',
  'do_not_confirm_checkin_checkout_refund_or_cancellation_without_policy_context',
  'do_not_claim_operator_joined_or_issue_resolved_without_signal',
  'do_not_trigger_financial_action_without_operator_review',
];

function parseTimeParts(time: string | null): { hour: number; minute: number } | null {
  const m = String(time ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

export function classifyCanonicalCheckinTime(time: string | null): CanonicalCheckinTimePolicy {
  const parsed = parseTimeParts(time);
  if (!parsed) {
    return {
      bucket: 'unknown',
      isEarlyCheckinByTime: false,
      requiresCleaningAvailability: false,
      requiresPreviousNightAvailability: false,
      policy: 'no_explicit_checkin_time',
      scenarioFamily: null,
    };
  }

  const { hour, minute } = parsed;
  if (hour >= 6 && (hour < 8 || (hour === 8 && minute === 0))) {
    return {
      bucket: 'very_early_checkin',
      isEarlyCheckinByTime: true,
      requiresCleaningAvailability: false,
      requiresPreviousNightAvailability: true,
      policy: '06:00-08:00_very_early_requires_previous_night_availability',
      scenarioFamily: 'CHECK_IN_VERY_EARLY',
    };
  }
  if ((hour === 8 && minute > 0) || (hour >= 9 && hour <= 10)) {
    return {
      bucket: 'early_checkin',
      isEarlyCheckinByTime: true,
      requiresCleaningAvailability: true,
      requiresPreviousNightAvailability: false,
      policy: '08:01-10:59_early_checkin_requires_availability_confirmation',
      scenarioFamily: 'CHECK_IN_EARLY',
    };
  }
  if (hour >= 11 && hour <= 13) {
    return {
      bucket: 'conditional_early_checkin',
      isEarlyCheckinByTime: true,
      requiresCleaningAvailability: true,
      requiresPreviousNightAvailability: false,
      policy: '11:00-13:59_conditional_depends_on_cleaning_and_previous_checkout',
      scenarioFamily: 'CHECK_IN_EARLY',
    };
  }
  if (hour >= 14 && hour <= 16) {
    return {
      bucket: 'normal_checkin',
      isEarlyCheckinByTime: false,
      requiresCleaningAvailability: false,
      requiresPreviousNightAvailability: false,
      policy: '14:00-16:00_standard_checkin_window',
      scenarioFamily: 'CHECK_IN_STANDARD',
    };
  }
  if (hour >= 21 || hour <= 5) {
    return {
      bucket: 'late_checkin',
      isEarlyCheckinByTime: false,
      requiresCleaningAvailability: false,
      requiresPreviousNightAvailability: false,
      policy: '21:00-05:59_late_checkin_access_instructions_needed',
      scenarioFamily: null,
    };
  }
  return {
    bucket: 'normal_checkin',
    isEarlyCheckinByTime: false,
    requiresCleaningAvailability: false,
    requiresPreviousNightAvailability: false,
    policy: '17:00-20:59_standard_evening_checkin',
    scenarioFamily: 'CHECK_IN_STANDARD',
  };
}

export function getTelegramOperationalRule(
  scenarioFamily: TelegramOperationalScenarioFamily,
): TelegramOperationalKnowledgeRule {
  return TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[scenarioFamily];
}

export function getCommunicationCanonRuleGroups(): CommunicationCanonRuleGroups {
  const families = Object.keys(TELEGRAM_OPERATIONAL_KNOWLEDGE_V1) as TelegramOperationalScenarioFamily[];
  return {
    autoReply: families.filter((family) => TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[family].expectedAction === 'auto_reply'),
    requiresClarification: families.filter((family) => TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[family].expectedAction === 'clarify'),
    requiresEscalation: families.filter((family) => TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[family].expectedAction === 'escalate'),
    requiredContext: {
      objectOrBooking: families.filter((family) =>
        TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[family].requiredContext.some((ctx) =>
          /reservation|property|object|booking/i.test(ctx),
        ),
      ),
      operatorHandoff: families.filter((family) =>
        TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[family].requiredContext.includes('operator_handoff') ||
        TELEGRAM_OPERATIONAL_KNOWLEDGE_V1[family].expectedAction === 'escalate',
      ),
    },
    toneStyle: {
      russianGuestReplies: [...RUSSIAN_GUEST_REPLY_STYLE],
      telegramStyle: [...TELEGRAM_REPLY_STYLE],
    },
    prohibitedHallucinations: [...PROHIBITED_HALLUCINATIONS],
    automation: [
      'silent_by_default_unless_rule_triggers_reply_or_handoff',
      'slow_ack_is_transient_not_a_final_policy_answer',
      'operator_review_required_for_refund_cancellation_financial_or_urgent_access_risk',
      'object_specific_facts_require_verified_property_or_booking_context',
    ],
  };
}

export function requiresCanonicalObjectOrBookingContext(scenarioFamily: TelegramOperationalScenarioFamily): boolean {
  const rule = getTelegramOperationalRule(scenarioFamily);
  return rule.requiredContext.some((ctx) => /reservation|property|object|booking/i.test(ctx));
}

export function isCanonicalEscalationScenario(scenarioFamily: TelegramOperationalScenarioFamily): boolean {
  return getTelegramOperationalRule(scenarioFamily).expectedAction === 'escalate';
}

export function decideCanonicalTelegramAction(params: {
  scenarioFamily: TelegramOperationalScenarioFamily;
  hasKnownObjectOrBooking: boolean;
  requestedAction?: TelegramOperationalAction;
}): TelegramOperationalAction {
  const family = params.scenarioFamily;
  if (
    family === 'EMERGENCY_URGENT_ISSUE' ||
    family === 'OPERATOR_HANDOFF' ||
    family === 'CANCELLATION_REFUND' ||
    family === 'ESCALATE_TO_OPERATOR' ||
    family === 'UNKNOWN_OPERATIONAL_REQUEST' ||
    family === 'COMPLAINTS_PROBLEMS'
  ) {
    return 'escalate';
  }
  if (family === 'SLOW_ACK') return 'slow_ack';
  if (family === 'BOOKING_CONTEXT') return 'auto_reply';
  if (family === 'ACCESS_KEY_ISSUE') return params.hasKnownObjectOrBooking ? 'escalate' : 'clarify';
  if (requiresCanonicalObjectOrBookingContext(family) && !params.hasKnownObjectOrBooking) return 'clarify';
  if (
    family === 'CHECK_IN_STANDARD' ||
    family === 'CHECK_IN_EARLY' ||
    family === 'CHECK_IN_VERY_EARLY' ||
    family === 'LATE_CHECKOUT' ||
    family === 'ADDRESS_FIND_OBJECT' ||
    family === 'WIFI' ||
    family === 'PARKING' ||
    family === 'PETS' ||
    family === 'EXTRA_GUESTS' ||
    family === 'DOCUMENTS_PASSPORT' ||
    family === 'PAYMENT_DEPOSIT' ||
    family === 'CLEANING_LINEN_TOWELS'
  ) {
    return 'auto_reply';
  }
  return params.requestedAction ?? getTelegramOperationalRule(family).expectedAction;
}

export function buildCanonicalRuCheckinTimeReply(params: {
  bucket: CheckinTimeBucket;
  time: string | null;
  hasProperty: boolean;
  greet?: boolean;
}): string {
  const time = params.time ?? 'Это время';
  const prefix = params.greet ? 'Здравствуйте! ' : 'Понял. ';
  const missingObjectQuestion = params.hasProperty ? '' : ' Уточните, пожалуйста, для какого это объекта или брони?';

  if (params.bucket === 'very_early_checkin') {
    return `${prefix}${time} — это очень ранний заезд. Такое время возможно только если объект свободен с предыдущей ночи и это отдельно подтверждено.${missingObjectQuestion}`;
  }
  if (params.bucket === 'early_checkin') {
    return `${prefix}${time} — это ранний заезд, его нужно отдельно подтвердить. Проверю доступность и готовность объекта, затем вернусь с подтверждением.${missingObjectQuestion}`;
  }
  if (params.bucket === 'conditional_early_checkin') {
    return `${prefix}${time} — это ранний заезд с условным подтверждением: зависит от уборки, предыдущего выезда и готовности объекта.${missingObjectQuestion}`;
  }
  if (params.bucket === 'normal_checkin') {
    return `${prefix}${time} обычно считается стандартным временем заезда.${missingObjectQuestion}`;
  }
  if (params.bucket === 'late_checkin') {
    return `${prefix}${time} — это поздний заезд. Проверю, что по объекту есть подтверждённые инструкции по доступу и ключам.${missingObjectQuestion}`;
  }
  return `${prefix}Уточню возможность заезда и готовность объекта.${missingObjectQuestion}`;
}

export function buildCanonicalRuScenarioLine(scenarioFamily: TelegramOperationalScenarioFamily): string {
  switch (scenarioFamily) {
    case 'CHECK_IN_STANDARD':
      return 'Заезд в 15:00 считается стандартным временем заезда.';
    case 'CHECK_IN_EARLY':
      return 'Ранний заезд подтверждается отдельно и зависит от готовности объекта.';
    case 'CHECK_IN_VERY_EARLY':
      return 'Заезд в 06:00-08:00 возможен только если объект свободен с предыдущей ночи.';
    case 'LATE_CHECKOUT':
      return 'Поздний выезд возможен только после проверки доступности по конкретной брони/объекту.';
    case 'ADDRESS_FIND_OBJECT':
      return 'По адресу и входу можно дать только проверенные инструкции по конкретному объекту.';
    case 'WIFI':
      return 'По Wi-Fi можно подсказать сеть/пароль только для подтверждённого объекта или брони.';
    case 'PARKING':
      return 'По парковке можно сообщать только проверенные правила и варианты рядом с конкретным адресом.';
    case 'PETS':
      return 'Размещение с питомцами зависит от правил конкретного объекта и требует проверки.';
    case 'DOCUMENTS_PASSPORT':
      return 'По документам можно подсказать только данные, нужные для сценария заселения.';
    case 'COMPLAINTS_PROBLEMS':
      return 'Проблему нужно зафиксировать; спорные или чувствительные случаи передаются оператору.';
    case 'BOOKING_CONTEXT':
      return 'Контекст по брони/объекту зафиксирован.';
    case 'CANCELLATION_REFUND':
      return 'Отмена и возврат требуют проверки правил брони и не подтверждаются автоматически.';
    default:
      return 'Запрос принят, детали сверяются по контексту брони и объекта.';
  }
}

export function getTelegramCommunicationCanon(): {
  sources: CommunicationCanonSource[];
  rules: Record<TelegramOperationalScenarioFamily, TelegramOperationalKnowledgeRule>;
  ruleGroups: CommunicationCanonRuleGroups;
} {
  return {
    sources: [...TELEGRAM_COMMUNICATION_CANON_SOURCES],
    rules: TELEGRAM_OPERATIONAL_KNOWLEDGE_V1,
    ruleGroups: getCommunicationCanonRuleGroups(),
  };
}
