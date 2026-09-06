import { createHash } from 'node:crypto';
import type { BookingOpsCommunicationPurpose, BookingOpsPropertyKnowledge } from '@/lib/booking-ops/types';
import type { RelevantGuestMemoryContext } from './guest-long-term-memory';

export const GUEST_LIFECYCLE_EVENT_TYPES = [
  'reservation.created',
  'reservation.confirmed',
  'arrival.due_24h',
  'arrival.due_3h',
  'checkin.ready',
  'guest.checked_in',
  'stay.active',
  'stay.checkin_followup',
  'checkout.due_24h',
  'checkout.due_3h',
  'late_checkout.requested',
  'late_checkout.approved',
  'late_checkout.denied',
  'guest.checked_out',
  'stay.completed',
  'reservation.cancelled',
  'incident.reported',
  'incident.resolved',
] as const;

export type GuestLifecycleEventType = (typeof GUEST_LIFECYCLE_EVENT_TYPES)[number];
export type GuestLifecycleLanguage = 'ru' | 'en';
export type GuestLifecycleCommunicationMode = 'text' | 'voice';

export type GuestLifecycleEvent = {
  eventType: GuestLifecycleEventType;
  reservationId: string;
  propertyId: string;
  guestId: string;
  occurredAt: string;
  scheduledFor?: string | null;
  source: string;
  sourceEventId: string;
  language?: GuestLifecycleLanguage | null;
  facts?: {
    operatorConfirmed?: boolean;
    feedbackAppropriate?: boolean;
    approvedUntil?: string | null;
    incidentSummary?: string | null;
  };
};

export const GUEST_LIFECYCLE_STAGES = [
  'reservation',
  'arrival',
  'checkin',
  'stay',
  'checkout',
  'completed',
  'cancelled',
  'incident',
] as const;

export type GuestLifecycleStage = (typeof GUEST_LIFECYCLE_STAGES)[number];

export type GuestLifecycleExecutionStatus =
  | 'received'
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'dry_run'
  | 'completed'
  | 'skipped'
  | 'blocked'
  | 'operator_required'
  | 'failed';

/** Owner Console labels for existing Guest Lifecycle event types. Display-only. */
export const GUEST_LIFECYCLE_EVENT_LABELS_RU: Record<GuestLifecycleEventType, string> = {
  'reservation.created': 'Бронь создана',
  'reservation.confirmed': 'Бронь подтверждена',
  'arrival.due_24h': 'Заезд через 24 часа',
  'arrival.due_3h': 'Заезд через 3 часа',
  'checkin.ready': 'Готово к заезду',
  'guest.checked_in': 'Гость заехал',
  'stay.active': 'Проживание',
  'stay.checkin_followup': 'Сообщение после заезда',
  'checkout.due_24h': 'Выезд через 24 часа',
  'checkout.due_3h': 'Выезд через 3 часа',
  'late_checkout.requested': 'Запрос позднего выезда',
  'late_checkout.approved': 'Поздний выезд одобрен',
  'late_checkout.denied': 'Поздний выезд отклонён',
  'guest.checked_out': 'Гость выехал',
  'stay.completed': 'Проживание завершено',
  'reservation.cancelled': 'Бронь отменена',
  'incident.reported': 'Обращение создано',
  'incident.resolved': 'Обращение закрыто',
};

export const GUEST_LIFECYCLE_STAGE_LABELS_RU: Record<GuestLifecycleStage, string> = {
  reservation: 'Бронирование',
  arrival: 'Подготовка к заезду',
  checkin: 'Заезд',
  stay: 'Проживание',
  checkout: 'Выезд',
  completed: 'Завершено',
  cancelled: 'Отменено',
  incident: 'Обращение',
};

export const GUEST_LIFECYCLE_EXECUTION_STATUS_LABELS_RU: Record<GuestLifecycleExecutionStatus, string> = {
  received: 'Получено',
  scheduled: 'Запланировано',
  processing: 'Обрабатывается',
  sent: 'Отправлено',
  dry_run: 'Без отправки',
  completed: 'Завершено',
  skipped: 'Пропущено',
  blocked: 'Заблокировано',
  operator_required: 'Нужен оператор',
  failed: 'Ошибка',
};

export function formatGuestLifecycleEventLabelRu(eventType: string | null | undefined): string {
  const raw = String(eventType ?? '').trim();
  if (!raw) return '—';
  return GUEST_LIFECYCLE_EVENT_LABELS_RU[raw as GuestLifecycleEventType] ?? raw;
}

export function formatGuestLifecycleStageLabelRu(stage: string | null | undefined): string {
  const raw = String(stage ?? '').trim();
  if (!raw) return '—';
  return GUEST_LIFECYCLE_STAGE_LABELS_RU[raw as GuestLifecycleStage] ?? raw;
}

export function formatGuestLifecycleExecutionStatusLabelRu(status: string | null | undefined): string {
  const raw = String(status ?? '').trim();
  if (!raw) return '—';
  return GUEST_LIFECYCLE_EXECUTION_STATUS_LABELS_RU[raw as GuestLifecycleExecutionStatus] ?? raw;
}

export type GuestLifecycleExecutionRecord = {
  id: string;
  idempotencyKey: string;
  event: GuestLifecycleEvent;
  stage: GuestLifecycleStage;
  status: GuestLifecycleExecutionStatus;
  bookingOpsRecordId?: string | null;
  communicationIntentId?: string | null;
  deliveryId?: string | null;
  operatorReviewId?: string | null;
  deliveryStatus?: string | null;
  safeCommunicationSummary?: string | null;
  operatorActionRequired?: boolean;
  failureReason?: string | null;
  updatedAt: string;
};

export type GuestLifecycleReservationContext = {
  bookingOpsRecordId: string;
  reservationId: string;
  propertyId: string;
  guestId: string;
  guestName: string | null;
  channel: 'telegram' | 'email';
  targetId: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  propertyLabel: string | null;
  propertyKnowledge: BookingOpsPropertyKnowledge | null;
  guestMemory: RelevantGuestMemoryContext | null;
  identityVerified: true;
  accessAllowed: boolean;
  reservationCancelled: boolean;
  operatorHandoffActive: boolean;
};

export type GuestLifecycleContextResolution =
  | { ok: true; context: GuestLifecycleReservationContext }
  | { ok: false; reason: 'unknown_guest' | 'reservation_not_found' | 'reservation_guest_mismatch' | 'property_mismatch' | 'recipient_missing' };

export type GuestLifecyclePlan = {
  action: 'send' | 'skip' | 'operator';
  stage: GuestLifecycleStage;
  language: GuestLifecycleLanguage;
  communicationMode: GuestLifecycleCommunicationMode;
  purpose: BookingOpsCommunicationPurpose;
  text: string | null;
  safeSummary: string;
  urgent: boolean;
  operatorReason?: string;
  memoryEvent?: 'completed_stay' | 'late_checkout_history' | 'operator_confirmed_resolution';
};

export type GuestLifecycleDeliveryResult = {
  status: 'sent' | 'dry_run' | 'blocked' | 'failed';
  communicationIntentId?: string | null;
  deliveryId?: string | null;
  deliveryStatus?: string | null;
  reason?: string | null;
};

export type GuestLifecycleOperatorResult = { reviewId: string };

export type GuestLifecycleExecutionPort = {
  findByIdempotencyKey(key: string): Promise<GuestLifecycleExecutionRecord | null>;
  claim(event: GuestLifecycleEvent, key: string, stage: GuestLifecycleStage): Promise<GuestLifecycleExecutionRecord>;
  update(id: string, patch: Partial<GuestLifecycleExecutionRecord>): Promise<GuestLifecycleExecutionRecord>;
  resolveContext(event: GuestLifecycleEvent): Promise<GuestLifecycleContextResolution>;
  deliver(input: {
    event: GuestLifecycleEvent;
    context: GuestLifecycleReservationContext;
    plan: GuestLifecyclePlan;
    idempotencyKey: string;
  }): Promise<GuestLifecycleDeliveryResult>;
  requestOperator(input: {
    event: GuestLifecycleEvent;
    context: GuestLifecycleReservationContext;
    plan: GuestLifecyclePlan;
    idempotencyKey: string;
  }): Promise<GuestLifecycleOperatorResult>;
  recordMemory(input: {
    event: GuestLifecycleEvent;
    context: GuestLifecycleReservationContext;
    plan: GuestLifecyclePlan;
    idempotencyKey: string;
  }): Promise<void>;
};

export type GuestLifecycleExecutionResult = {
  ok: boolean;
  duplicate: boolean;
  record: GuestLifecycleExecutionRecord;
  plan?: GuestLifecyclePlan;
};

const EVENT_SET = new Set<string>(GUEST_LIFECYCLE_EVENT_TYPES);
const TERMINAL_STATUSES = new Set<GuestLifecycleExecutionStatus>([
  'sent', 'dry_run', 'completed', 'skipped', 'blocked', 'operator_required',
]);
const CANCELLED_SUPPRESSED_EVENTS = new Set<GuestLifecycleEventType>([
  'arrival.due_24h',
  'arrival.due_3h',
  'checkin.ready',
  'guest.checked_in',
  'stay.active',
  'stay.checkin_followup',
  'checkout.due_24h',
  'checkout.due_3h',
]);

function bounded(value: unknown, max = 200): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function required(value: unknown, field: string, max = 200): string {
  const result = bounded(value, max);
  if (!result) throw new Error(`${field}_required`);
  return result;
}

function iso(value: unknown, field: string): string {
  const normalized = required(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${field}_invalid`);
  return new Date(normalized).toISOString();
}

export function normalizeGuestLifecycleEvent(input: GuestLifecycleEvent): GuestLifecycleEvent {
  const eventType = required(input?.eventType, 'event_type', 80);
  if (!EVENT_SET.has(eventType)) throw new Error('event_type_unsupported');
  const language = input.language === 'ru' || input.language === 'en' ? input.language : null;
  const scheduledFor = input.scheduledFor ? iso(input.scheduledFor, 'scheduled_for') : null;
  const incidentSummary = bounded(input.facts?.incidentSummary, 240) || null;
  return {
    eventType: eventType as GuestLifecycleEventType,
    reservationId: required(input.reservationId, 'reservation_id', 160),
    propertyId: required(input.propertyId, 'property_id', 160),
    guestId: required(input.guestId, 'guest_id', 160),
    occurredAt: iso(input.occurredAt, 'occurred_at'),
    scheduledFor,
    source: required(input.source, 'source', 80),
    sourceEventId: required(input.sourceEventId, 'source_event_id', 200),
    language,
    facts: input.facts ? {
      operatorConfirmed: input.facts.operatorConfirmed === true,
      feedbackAppropriate: input.facts.feedbackAppropriate === true,
      approvedUntil: bounded(input.facts.approvedUntil, 80) || null,
      incidentSummary,
    } : undefined,
  };
}

export function guestLifecycleIdempotencyKey(eventInput: GuestLifecycleEvent): string {
  const event = normalizeGuestLifecycleEvent(eventInput);
  const canonical = [
    'guest-lifecycle-v1',
    event.source,
    event.sourceEventId,
    event.eventType,
    event.reservationId,
    event.propertyId,
    event.guestId,
  ].join('|');
  return `glc:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function guestLifecycleStage(eventType: GuestLifecycleEventType): GuestLifecycleStage {
  if (eventType.startsWith('reservation.')) return eventType === 'reservation.cancelled' ? 'cancelled' : 'reservation';
  if (eventType.startsWith('arrival.')) return 'arrival';
  if (eventType === 'checkin.ready' || eventType === 'guest.checked_in') return 'checkin';
  if (eventType.startsWith('stay.')) return eventType === 'stay.completed' ? 'completed' : 'stay';
  if (eventType.startsWith('checkout.') || eventType.startsWith('late_checkout.') || eventType === 'guest.checked_out') return 'checkout';
  return 'incident';
}

function localizedDate(value: string | null, language: GuestLifecycleLanguage): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed);
}

function hasPreference(memory: RelevantGuestMemoryContext | null, key: string): boolean {
  return Boolean(memory?.preferences.some((preference) => preference.key === key));
}

function safeKnowledge(value: string | null | undefined, max = 500): string | null {
  const result = bounded(value, max);
  return result || null;
}

function join(parts: Array<string | null | undefined>): string {
  return parts.map((part) => bounded(part, 800)).filter(Boolean).join(' ');
}

function purposeForEvent(eventType: GuestLifecycleEventType): BookingOpsCommunicationPurpose {
  if (eventType === 'reservation.created' || eventType === 'reservation.confirmed') return 'neutral_booking_acknowledgement';
  if (eventType === 'arrival.due_24h') return 'request_arrival_time';
  if (eventType === 'checkin.ready') return 'send_checkin_instructions';
  return 'neutral_status_update';
}

function operatorPlan(
  event: GuestLifecycleEvent,
  language: GuestLifecycleLanguage,
  communicationMode: GuestLifecycleCommunicationMode,
  reason: string,
  text: string,
  urgent = false,
): GuestLifecyclePlan {
  return {
    action: 'operator',
    stage: guestLifecycleStage(event.eventType),
    language,
    communicationMode,
    purpose: 'issue_escalation_notice',
    text,
    safeSummary: language === 'ru' ? 'Нужно действие оператора' : 'Operator action required',
    urgent,
    operatorReason: reason,
  };
}

export function planGuestLifecycleCommunication(input: {
  event: GuestLifecycleEvent;
  context: GuestLifecycleReservationContext;
}): GuestLifecyclePlan {
  const event = normalizeGuestLifecycleEvent(input.event);
  const context = input.context;
  const memory = context.guestMemory;
  const language = memory?.preferredLanguage ?? event.language ?? 'ru';
  const communicationMode = memory?.preferredCommunicationMode ?? 'text';
  const ru = language === 'ru';
  const knowledge = context.propertyKnowledge;
  const checkIn = localizedDate(context.checkInAt, language);
  const checkOut = localizedDate(context.checkOutAt, language);
  const property = safeKnowledge(context.propertyLabel, 120);
  const address = safeKnowledge(knowledge?.address);
  const entrance = safeKnowledge(knowledge?.entranceInstructions);
  const keyPickup = safeKnowledge(knowledge?.keyPickupInstructions);
  const wifi = knowledge?.wifiName && knowledge?.wifiPassword
    ? (ru ? `Wi-Fi: ${safeKnowledge(knowledge.wifiName, 80)}. Пароль: ${safeKnowledge(knowledge.wifiPassword, 120)}.` : `Wi-Fi: ${safeKnowledge(knowledge.wifiName, 80)}. Password: ${safeKnowledge(knowledge.wifiPassword, 120)}.`)
    : null;
  const rules = safeKnowledge(knowledge?.houseRules);
  const checkoutInstructions = safeKnowledge(knowledge?.checkoutInstructions);
  const parking = hasPreference(memory, 'parking') ? safeKnowledge(knowledge?.parkingInstructions) : null;
  const accessibilityPrompt = hasPreference(memory, 'accessibility')
    ? (ru ? 'Если понадобится помощь с доступом, напишите нам.' : 'If you need accessibility assistance, message us.')
    : null;
  const base = {
    action: 'send' as const,
    stage: guestLifecycleStage(event.eventType),
    language,
    communicationMode,
    purpose: purposeForEvent(event.eventType),
    urgent: false,
  };

  switch (event.eventType) {
    case 'reservation.created':
    case 'reservation.confirmed': {
      const confirmed = event.eventType === 'reservation.confirmed';
      const text = join([
        ru
          ? (confirmed ? 'Бронирование подтверждено.' : 'Спасибо! Бронирование получено.')
          : (confirmed ? 'Your reservation is confirmed.' : 'Thank you! We received your reservation.'),
        property ? (ru ? `Объект: ${property}.` : `Property: ${property}.`) : null,
        checkIn ? (ru ? `Заезд: ${checkIn}.` : `Check-in: ${checkIn}.`) : null,
        checkOut ? (ru ? `Выезд: ${checkOut}.` : `Check-out: ${checkOut}.`) : null,
      ]);
      return { ...base, text, safeSummary: ru ? 'Подтверждение бронирования' : 'Reservation acknowledgement' };
    }
    case 'arrival.due_24h':
      return {
        ...base,
        text: join([
          ru ? 'Напоминаем: заезд уже завтра.' : 'A reminder: your check-in is tomorrow.',
          address ? (ru ? `Адрес: ${address}.` : `Address: ${address}.`) : null,
          entrance ? (ru ? `Как добраться: ${entrance}.` : `Arrival information: ${entrance}.`) : null,
          parking ? (ru ? `Парковка: ${parking}.` : `Parking: ${parking}.`) : null,
          ru ? 'Если удобно, сообщите примерное время прибытия.' : 'If convenient, please share your approximate arrival time.',
          accessibilityPrompt,
        ]),
        safeSummary: ru ? 'Напоминание за 24 часа до заезда' : '24-hour arrival reminder',
      };
    case 'arrival.due_3h':
      return {
        ...base,
        text: join([
          ru ? 'До заезда осталось около трёх часов.' : 'Your check-in is about three hours away.',
          address ? (ru ? `Адрес: ${address}.` : `Address: ${address}.`) : null,
          context.accessAllowed && entrance ? (ru ? `Информация по входу: ${entrance}.` : `Entry information: ${entrance}.`) : null,
        ]),
        safeSummary: ru ? 'Короткое напоминание перед заездом' : 'Short arrival reminder',
      };
    case 'checkin.ready': {
      if (!context.accessAllowed) {
        return operatorPlan(
          event,
          language,
          communicationMode,
          'checkin_access_requires_verified_readiness',
          ru ? 'Проверьте готовность объекта и данные доступа перед отправкой гостю.' : 'Verify property readiness and access details before sending.',
        );
      }
      return {
        ...base,
        text: join([
          ru ? 'Объект готов к вашему заезду.' : 'The property is ready for your arrival.',
          address ? (ru ? `Адрес: ${address}.` : `Address: ${address}.`) : null,
          entrance ? (ru ? `Вход: ${entrance}.` : `Entry: ${entrance}.`) : null,
          keyPickup ? (ru ? `Ключи: ${keyPickup}.` : `Keys: ${keyPickup}.`) : null,
          wifi,
          rules ? (ru ? `Важные правила: ${rules}.` : `Important house rules: ${rules}.`) : null,
          ru ? 'Если нужна помощь, ответьте на это сообщение.' : 'Reply to this message if you need help.',
        ]),
        safeSummary: ru ? 'Инструкции для заезда готовы' : 'Check-in instructions ready',
      };
    }
    case 'guest.checked_in':
      return {
        ...base,
        text: ru ? 'Спасибо, что сообщили о заезде. Если понадобится помощь, напишите нам.' : 'Thanks for confirming your arrival. Message us if you need help.',
        safeSummary: ru ? 'Подтверждение заезда' : 'Check-in acknowledgement',
      };
    case 'stay.active':
      return { ...base, action: 'skip', text: null, safeSummary: ru ? 'Без дополнительного сообщения' : 'No additional message' };
    case 'stay.checkin_followup':
      return {
        ...base,
        text: ru ? 'Всё ли в порядке? Если что-то понадобится, просто ответьте на это сообщение.' : 'Is everything all right? If you need anything, just reply to this message.',
        safeSummary: ru ? 'Проверка после заезда' : 'Post-check-in follow-up',
      };
    case 'checkout.due_24h':
    case 'checkout.due_3h': {
      const threeHours = event.eventType === 'checkout.due_3h';
      return {
        ...base,
        text: join([
          ru
            ? (threeHours ? 'До выезда осталось около трёх часов.' : 'Напоминаем о выезде завтра.')
            : (threeHours ? 'Checkout is about three hours away.' : 'A reminder about checkout tomorrow.'),
          checkOut ? (ru ? `Время выезда: ${checkOut}.` : `Checkout time: ${checkOut}.`) : null,
          checkoutInstructions ? (ru ? `Перед выездом: ${checkoutInstructions}.` : `Before leaving: ${checkoutInstructions}.`) : null,
          ru ? 'Если нужен поздний выезд, напишите нам — возможность нужно подтвердить.' : 'If you need a late checkout, message us; availability must be confirmed.',
        ]),
        safeSummary: ru ? 'Напоминание о выезде' : 'Checkout reminder',
      };
    }
    case 'late_checkout.requested':
      return operatorPlan(
        event,
        language,
        communicationMode,
        'late_checkout_requires_operator_approval',
        ru ? 'Гость запросил поздний выезд. Проверьте доступность и подтвердите решение.' : 'The guest requested late checkout. Check availability and confirm the outcome.',
      );
    case 'late_checkout.approved':
    case 'late_checkout.denied': {
      if (!event.facts?.operatorConfirmed) {
        return operatorPlan(
          event,
          language,
          communicationMode,
          'late_checkout_outcome_not_operator_confirmed',
          ru ? 'Подтвердите решение по позднему выезду перед отправкой.' : 'Confirm the late-checkout outcome before sending.',
        );
      }
      const approved = event.eventType === 'late_checkout.approved';
      const until = bounded(event.facts.approvedUntil, 80);
      return {
        ...base,
        text: approved
          ? join([ru ? 'Поздний выезд подтверждён.' : 'Late checkout is confirmed.', until ? (ru ? `Новое время: ${until}.` : `New checkout time: ${until}.`) : null])
          : (ru ? 'К сожалению, поздний выезд подтвердить не удалось. Пожалуйста, выезжайте в обычное время.' : 'Unfortunately, late checkout could not be confirmed. Please check out at the standard time.'),
        safeSummary: approved ? (ru ? 'Поздний выезд подтверждён' : 'Late checkout approved') : (ru ? 'Поздний выезд не подтверждён' : 'Late checkout denied'),
        memoryEvent: approved ? 'late_checkout_history' : undefined,
      };
    }
    case 'guest.checked_out':
      return {
        ...base,
        text: ru ? 'Спасибо, что сообщили о выезде. Хорошей дороги!' : 'Thank you for confirming checkout. Have a safe journey!',
        safeSummary: ru ? 'Подтверждение выезда' : 'Checkout acknowledgement',
      };
    case 'stay.completed':
      return {
        ...base,
        text: event.facts?.feedbackAppropriate
          ? (ru ? 'Спасибо, что выбрали нас. Будем рады короткому отзыву в ответном сообщении.' : 'Thank you for staying with us. We would appreciate brief feedback in a reply.')
          : (ru ? 'Спасибо, что выбрали нас. Будем рады видеть вас снова!' : 'Thank you for staying with us. We hope to welcome you again!'),
        safeSummary: ru ? 'Завершение проживания' : 'Stay completion',
        memoryEvent: 'completed_stay',
      };
    case 'reservation.cancelled':
      return {
        ...base,
        text: ru ? 'Отмена бронирования подтверждена. По вопросам возврата или условий отмены свяжитесь с оператором.' : 'Your reservation cancellation is confirmed. Contact the operator with refund or cancellation-policy questions.',
        safeSummary: ru ? 'Подтверждение отмены' : 'Cancellation acknowledgement',
      };
    case 'incident.reported':
      return operatorPlan(
        event,
        language,
        communicationMode,
        'urgent_incident_requires_operator',
        ru ? 'Получено срочное обращение гостя. Свяжитесь с гостем и действуйте по правилам безопасности.' : 'An urgent guest incident was reported. Contact the guest and follow the safety procedure.',
        true,
      );
    case 'incident.resolved':
      if (!event.facts?.operatorConfirmed) {
        return operatorPlan(
          event,
          language,
          communicationMode,
          'incident_resolution_not_operator_confirmed',
          ru ? 'Подтвердите решение ситуации перед сообщением гостю.' : 'Confirm the incident resolution before messaging the guest.',
        );
      }
      return {
        ...base,
        text: ru ? 'Ситуация отмечена как решённая. Если вопрос остался, пожалуйста, ответьте на это сообщение.' : 'The issue is marked as resolved. If anything remains, please reply to this message.',
        safeSummary: ru ? 'Ситуация решена' : 'Incident resolved',
        memoryEvent: 'operator_confirmed_resolution',
      };
  }
}

export async function executeGuestLifecycleEvent(
  eventInput: GuestLifecycleEvent,
  port: GuestLifecycleExecutionPort,
  options: { now?: Date } = {},
): Promise<GuestLifecycleExecutionResult> {
  const event = normalizeGuestLifecycleEvent(eventInput);
  const key = guestLifecycleIdempotencyKey(event);
  const stage = guestLifecycleStage(event.eventType);
  const now = options.now ?? new Date();
  let record = await port.findByIdempotencyKey(key);
  if (record && TERMINAL_STATUSES.has(record.status)) return { ok: record.status !== 'blocked', duplicate: true, record };
  if (record?.status === 'processing') {
    const updatedAt = Date.parse(record.updatedAt);
    if (Number.isFinite(updatedAt) && now.getTime() - updatedAt < 5 * 60 * 1_000) {
      return { ok: true, duplicate: true, record };
    }
  }
  if (!record) record = await port.claim(event, key, stage);
  if (TERMINAL_STATUSES.has(record.status)) return { ok: record.status !== 'blocked', duplicate: true, record };

  if (event.scheduledFor && Date.parse(event.scheduledFor) > now.getTime()) {
    record = await port.update(record.id, { status: 'scheduled', updatedAt: now.toISOString() });
    return { ok: true, duplicate: false, record };
  }

  record = await port.update(record.id, { status: 'processing', updatedAt: now.toISOString() });
  const resolution = await port.resolveContext(event);
  if (!resolution.ok) {
    record = await port.update(record.id, {
      status: 'blocked',
      failureReason: resolution.reason,
      operatorActionRequired: resolution.reason !== 'unknown_guest',
      updatedAt: now.toISOString(),
    });
    return { ok: false, duplicate: false, record };
  }
  const context = resolution.context;
  record = await port.update(record.id, { bookingOpsRecordId: context.bookingOpsRecordId, updatedAt: now.toISOString() });

  if (context.reservationCancelled && CANCELLED_SUPPRESSED_EVENTS.has(event.eventType)) {
    record = await port.update(record.id, {
      status: 'skipped',
      safeCommunicationSummary: 'Suppressed after verified reservation cancellation',
      operatorActionRequired: false,
      updatedAt: now.toISOString(),
    });
    return { ok: true, duplicate: false, record };
  }

  const plan = planGuestLifecycleCommunication({ event, context });
  if (plan.memoryEvent) {
    await port.recordMemory({ event, context, plan, idempotencyKey: key }).catch(() => undefined);
  }
  if (context.operatorHandoffActive && plan.action === 'send') {
    const operatorPlan: GuestLifecyclePlan = {
      ...plan,
      action: 'operator',
      operatorReason: 'existing_operator_handoff_active',
      safeSummary: plan.language === 'ru' ? 'Сообщение ожидает оператора' : 'Message waits for operator',
    };
    const handoff = await port.requestOperator({ event, context, plan: operatorPlan, idempotencyKey: key });
    record = await port.update(record.id, {
      status: 'operator_required',
      operatorReviewId: handoff.reviewId,
      safeCommunicationSummary: operatorPlan.safeSummary,
      operatorActionRequired: true,
      updatedAt: now.toISOString(),
    });
    return { ok: true, duplicate: false, record, plan: operatorPlan };
  }

  if (plan.action === 'skip') {
    record = await port.update(record.id, {
      status: 'completed',
      safeCommunicationSummary: plan.safeSummary,
      operatorActionRequired: false,
      updatedAt: now.toISOString(),
    });
    return { ok: true, duplicate: false, record, plan };
  }

  if (plan.action === 'operator') {
    const handoff = await port.requestOperator({ event, context, plan, idempotencyKey: key });
    record = await port.update(record.id, {
      status: 'operator_required',
      operatorReviewId: handoff.reviewId,
      safeCommunicationSummary: plan.safeSummary,
      operatorActionRequired: true,
      updatedAt: now.toISOString(),
    });
    return { ok: true, duplicate: false, record, plan };
  }

  const delivery = await port.deliver({ event, context, plan, idempotencyKey: key });
  const status: GuestLifecycleExecutionStatus = delivery.status === 'sent'
    ? 'sent'
    : delivery.status === 'dry_run'
      ? 'dry_run'
      : delivery.status === 'blocked'
        ? 'operator_required'
        : 'failed';
  let operatorReviewId: string | null = null;
  if (delivery.status === 'blocked') {
    const handoff = await port.requestOperator({
      event,
      context,
      idempotencyKey: key,
      plan: {
        ...plan,
        action: 'operator',
        operatorReason: delivery.reason ?? 'lifecycle_delivery_blocked',
      },
    });
    operatorReviewId = handoff.reviewId;
  }
  record = await port.update(record.id, {
    status,
    communicationIntentId: delivery.communicationIntentId ?? null,
    deliveryId: delivery.deliveryId ?? null,
    deliveryStatus: delivery.deliveryStatus ?? delivery.status,
    operatorReviewId,
    safeCommunicationSummary: plan.safeSummary,
    operatorActionRequired: delivery.status === 'blocked',
    failureReason: delivery.reason ?? null,
    updatedAt: now.toISOString(),
  });
  return { ok: delivery.status === 'sent' || delivery.status === 'dry_run', duplicate: false, record, plan };
}
