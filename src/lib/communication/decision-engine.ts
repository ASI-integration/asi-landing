import {
  AutonomousSessionStatus,
  IntentCategory,
  Lang,
  MessageCategory,
  ReservationMatchResult,
  SessionTimelineEntry,
} from './types';

export type AutonomousRouteDecision =
  | {
      action: 'proceed';
      reason: string;
      /** True when the current session goal has been fully satisfied. */
      fulfilled?: boolean;
    }
  | {
      action: 'ask';
      reason: string;
      missing: string[];
      messageRu: string;
      messageEn: string;
    };

// ─── Field label maps ─────────────────────────────────────────────────────────

const FIELD_LABEL_EN: Record<string, string> = {
  guest_name:       'guest name',
  property_location:'property name or address',
  check_in_date:    'check-in date',
  check_out_date:   'check-out date',
  guests:           'number of guests',
  issue_detail:     'what is wrong and where (unit/room)',
};

const FIELD_LABEL_RU: Record<string, string> = {
  guest_name:       'имя гостя',
  property_location:'объект или адрес',
  check_in_date:    'дата заезда',
  check_out_date:   'дата выезда',
  guests:           'количество гостей',
  issue_detail:     'что именно не так и где (номер/объект)',
};

function labelsEn(keys: string[]): string {
  return keys.map(k => FIELD_LABEL_EN[k] ?? k).join(', ');
}

function labelsRu(keys: string[]): string {
  return keys.map(k => FIELD_LABEL_RU[k] ?? k).join(', ');
}

// ─── Booking flow ─────────────────────────────────────────────────────────────

/** Required fields for the booking flow, in priority order (ask one block at a time). */
const BOOKING_REQUIRED: string[] = [
  'guest_name',
  'property_location',
  'check_in_date',
  'check_out_date',
  'guests',
];

function bookingMissing(collected: Record<string, string | undefined>): string[] {
  return BOOKING_REQUIRED.filter(f => !collected[f]?.trim());
}

/**
 * Ask for missing booking fields one "block" at a time so the conversation
 * flows naturally. We ask for name+location together first, then dates, then guests.
 */
function bookingAskDecision(missing: string[], lang: Lang): AutonomousRouteDecision {
  // First block: identity/location
  const identityMissing = missing.filter(f => ['guest_name', 'property_location'].includes(f));
  if (identityMissing.length > 0) {
    return {
      action: 'ask',
      reason: `booking_missing:${identityMissing.join(',')}`,
      missing: identityMissing,
      messageRu: `Чтобы обработать запрос, пришлите: ${labelsRu(identityMissing)}.`,
      messageEn: `To process your booking request, please send: ${labelsEn(identityMissing)}.`,
    };
  }
  // Second block: dates
  const datesMissing = missing.filter(f => ['check_in_date', 'check_out_date'].includes(f));
  if (datesMissing.length > 0) {
    return {
      action: 'ask',
      reason: `booking_missing:${datesMissing.join(',')}`,
      missing: datesMissing,
      messageRu: `Укажите, пожалуйста: ${labelsRu(datesMissing)}.`,
      messageEn: `Please provide: ${labelsEn(datesMissing)}.`,
    };
  }
  // Third block: guests count
  const guestsMissing = missing.filter(f => f === 'guests');
  if (guestsMissing.length > 0) {
    return {
      action: 'ask',
      reason: 'booking_missing:guests',
      missing: guestsMissing,
      messageRu: 'Сколько гостей планирует размещение?',
      messageEn: 'How many guests will be staying?',
    };
  }
  return { action: 'proceed', reason: 'booking_all_collected', fulfilled: true };
}

// ─── Support flow ─────────────────────────────────────────────────────────────

const SUPPORT_REQUIRED: string[] = ['property_location', 'issue_detail'];

function supportMissing(collected: Record<string, string | undefined>, text: string): string[] {
  const missing: string[] = [];
  if (!collected.property_location?.trim()) missing.push('property_location');
  const vague = !collected.issue_detail?.trim() && text.trim().length < 20;
  if (vague) missing.push('issue_detail');
  return missing;
}

// ─── Completion guard ─────────────────────────────────────────────────────────

/**
 * True when the session has already been fulfilled (all fields collected and
 * request handled). The bot should not prompt for more data.
 */
function isCompleted(sessionStatus: AutonomousSessionStatus): boolean {
  return sessionStatus === AutonomousSessionStatus.Completed;
}

// ─── Main decision function ───────────────────────────────────────────────────

/**
 * Rule-based routing. Does not call an LLM.
 * `timeline` is used only for read-only context — no side effects.
 */
export function decideAutonomousRoute(input: {
  lang: Lang;
  classificationCategory: MessageCategory;
  intent: IntentCategory;
  intentConfidence: number;
  reservationStatus: ReservationMatchResult['status'];
  collected_data: Record<string, string | undefined>;
  sessionStatus: AutonomousSessionStatus;
  text: string;
  timeline?: SessionTimelineEntry[];
}): AutonomousRouteDecision {
  // Start / greeting always proceed
  if (
    input.classificationCategory === MessageCategory.Start ||
    input.classificationCategory === MessageCategory.Greeting
  ) {
    return { action: 'proceed', reason: 'start_or_greeting' };
  }

  // Already completed — don't ask again
  if (isCompleted(input.sessionStatus)) {
    return { action: 'proceed', reason: 'session_already_completed' };
  }

  // ── Booking flow ────────────────────────────────────────────────────────────
  const bookingLike =
    input.intent === IntentCategory.BookingInquiry ||
    input.classificationCategory === MessageCategory.Booking;

  if (bookingLike && input.reservationStatus === 'unmatched') {
    const missing = bookingMissing(input.collected_data);
    if (missing.length > 0) {
      return bookingAskDecision(missing, input.lang);
    }
    // All booking fields present → fulfilled
    return { action: 'proceed', reason: 'booking_all_collected', fulfilled: true };
  }

  // ── Support / issue flow ────────────────────────────────────────────────────
  const issueLike =
    input.intent === IntentCategory.IssueReport ||
    input.classificationCategory === MessageCategory.Issue;

  if (issueLike && input.reservationStatus === 'unmatched') {
    const missing = supportMissing(input.collected_data, input.text);
    if (missing.length > 0) {
      if (missing.includes('property_location') && missing.includes('issue_detail')) {
        return {
          action: 'ask',
          reason: 'support_missing:property_location,issue_detail',
          missing,
          messageRu:
            'Опишите, пожалуйста, проблему подробнее: что случилось, в каком объекте/номере, насколько срочно.',
          messageEn:
            'Please describe the issue: what happened, which property/room, and how urgent it is.',
        };
      }
      if (missing.includes('property_location')) {
        return {
          action: 'ask',
          reason: 'support_missing:property_location',
          missing,
          messageRu: `Уточните, пожалуйста: ${labelsRu(['property_location'])}.`,
          messageEn: `Please share: ${labelsEn(['property_location'])}.`,
        };
      }
      if (missing.includes('issue_detail')) {
        return {
          action: 'ask',
          reason: 'support_missing:issue_detail',
          missing,
          messageRu:
            'Расскажите подробнее: что случилось и в каком объекте/номере?',
          messageEn:
            'Could you tell us more: what happened and in which unit/room?',
        };
      }
    }
    // All support fields present → fulfilled
    return { action: 'proceed', reason: 'support_all_collected', fulfilled: true };
  }

  // ── General question with low confidence ────────────────────────────────────
  const questionLike =
    input.intent === IntentCategory.GeneralQuestion ||
    input.classificationCategory === MessageCategory.GuestMessage;

  if (
    questionLike &&
    input.intent === IntentCategory.GeneralQuestion &&
    input.intentConfidence < 0.55 &&
    input.reservationStatus === 'unmatched'
  ) {
    return {
      action: 'ask',
      reason: 'low_confidence_general_question',
      missing: ['guest_name', 'property_location'],
      messageRu:
        'Уточните, пожалуйста: объект/адрес и имя гостя — так мы сможем ответить точнее.',
      messageEn: 'Please share the property/address and guest name so we can answer accurately.',
    };
  }

  return { action: 'proceed', reason: 'no_rule_matched' };
}
