import { computeBookingOpsAlerts } from '@/lib/booking-ops/alerts';
import type { InStayCheckoutSnapshot } from '@/lib/booking-ops/instay-checkout-autopilot';
import { BOOKING_OPS_NEXT_ACTION_LABELS_RU } from '@/lib/booking-ops/types';
import type {
  BookingOpsAlert,
  BookingOpsAlertKind,
  BookingOpsNextAction,
  BookingOpsRecord,
} from '@/lib/booking-ops/types';
import type { CrmContact } from './types';

export const CRM_BOOKING_SIGNAL_KINDS = [
  'incident_blocker',
  'checkin_blocked',
  'checkout_due',
  'closure_blocked',
  'cleaning_required',
  'linen_required',
  'inspection_required',
  'property_not_ready',
  'documents_incomplete',
  'contract_incomplete',
  'deposit_incomplete',
  'mvd_incomplete',
  'missing_guest_data',
  'intake_needs_review',
  'recent_booking',
] as const;

export type CrmBookingSignalKind = (typeof CRM_BOOKING_SIGNAL_KINDS)[number];

export type CrmBookingSignalSeverity = 'critical' | 'warning' | 'info';

export type CrmBookingSignal = {
  id: string;
  bookingOpsId: string;
  bookingReference: string;
  displayName: string;
  kind: CrmBookingSignalKind;
  severity: CrmBookingSignalSeverity;
  priority: number;
  title: string;
  reason: string;
  nextAction: string;
  bookingOpsHref: string;
  linkedContactId: string | null;
  linkedContactName: string | null;
  propertyLabel: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  updatedAt: string;
};

const PRIORITY_BY_KIND: Record<CrmBookingSignalKind, number> = {
  incident_blocker: 1,
  checkin_blocked: 2,
  checkout_due: 3,
  closure_blocked: 3,
  cleaning_required: 3,
  linen_required: 3,
  inspection_required: 3,
  property_not_ready: 3,
  documents_incomplete: 4,
  contract_incomplete: 4,
  deposit_incomplete: 4,
  mvd_incomplete: 4,
  missing_guest_data: 5,
  intake_needs_review: 5,
  recent_booking: 6,
};

const SEVERITY_RANK: Record<CrmBookingSignalSeverity, number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

const ALERT_KIND_TO_SIGNAL_KIND: Partial<Record<BookingOpsAlertKind, CrmBookingSignalKind>> = {
  booking_blocked: 'incident_blocker',
  guest_contact_missing: 'missing_guest_data',
  documents_not_requested: 'documents_incomplete',
  documents_not_received: 'documents_incomplete',
  contract_incomplete: 'contract_incomplete',
  deposit_incomplete: 'deposit_incomplete',
  mvd_not_submitted: 'mvd_incomplete',
  checkin_instructions_not_ready: 'checkin_blocked',
  checkin_approaching_incomplete: 'checkin_blocked',
};

const CHECKOUT_DUE_STATUSES = new Set<InStayCheckoutSnapshot['status']>([
  'checkout_preparing',
  'checkout_instructions_queued',
  'checkout_pending',
  'checked_out',
  'inspection_pending',
]);

export const CRM_BOOKING_OPS_HREF = '/dashboard/booking-ops';

function normalizePhone(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeTelegram(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function linkBookingRecordToCrmContact(
  record: Pick<BookingOpsRecord, 'guestPhone' | 'guestEmail' | 'guestTelegram'>,
  contacts: CrmContact[],
): { contactId: string | null; contactName: string | null } {
  const phone = normalizePhone(record.guestPhone);
  const email = normalizeEmail(record.guestEmail);
  const telegram = normalizeTelegram(record.guestTelegram);

  for (const contact of contacts) {
    if (phone && normalizePhone(contact.phone) === phone) {
      return { contactId: contact.id, contactName: contact.name };
    }
    if (email && normalizeEmail(contact.email) === email) {
      return { contactId: contact.id, contactName: contact.name };
    }
    if (telegram && normalizeTelegram(contact.telegramUsername) === telegram) {
      return { contactId: contact.id, contactName: contact.name };
    }
  }

  return { contactId: null, contactName: null };
}

function bookingReference(record: BookingOpsRecord): string {
  return record.bookingId?.trim() || record.id.slice(0, 8);
}

function displayName(record: BookingOpsRecord): string {
  if (record.guestName?.trim()) return record.guestName.trim();
  if (record.propertyLabel?.trim()) return record.propertyLabel.trim();
  return `Бронь ${bookingReference(record)}`;
}

function nextActionLabel(action: BookingOpsNextAction | null | undefined, fallback: string): string {
  if (action && action in BOOKING_OPS_NEXT_ACTION_LABELS_RU) {
    return BOOKING_OPS_NEXT_ACTION_LABELS_RU[action as keyof typeof BOOKING_OPS_NEXT_ACTION_LABELS_RU];
  }
  return fallback;
}

type CrmBookingSignalCore = Pick<
  CrmBookingSignal,
  | 'kind'
  | 'severity'
  | 'priority'
  | 'title'
  | 'reason'
  | 'nextAction'
>;

type CrmBookingSignalDraft = CrmBookingSignalCore & {
  bookingOpsId: string;
  bookingReference: string;
  displayName: string;
  propertyLabel: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  updatedAt: string;
};

function baseDraft(
  record: BookingOpsRecord,
  draft: CrmBookingSignalCore & { updatedAt?: string },
): CrmBookingSignalDraft {
  return {
    bookingOpsId: record.id,
    bookingReference: bookingReference(record),
    displayName: displayName(record),
    propertyLabel: record.propertyLabel,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    updatedAt: draft.updatedAt ?? record.updatedAt,
    ...draft,
  };
}

export function isBookingClosedForCrmSignals(
  record: BookingOpsRecord,
  instay?: Pick<InStayCheckoutSnapshot, 'status' | 'closureStatus'> | null,
): boolean {
  if (instay?.status === 'closed' || instay?.closureStatus === 'closed') return true;

  const alerts = record.alerts ?? computeBookingOpsAlerts(record);
  if (record.readiness?.status === 'completed' && alerts.alerts.length === 0) {
    return true;
  }

  if (record.automation?.automationState === 'completed' && alerts.alerts.length === 0) {
    return true;
  }

  return false;
}

function deriveInstaySignal(
  record: BookingOpsRecord,
  instay: InStayCheckoutSnapshot,
): CrmBookingSignalDraft | null {
  if (instay.status === 'closed' || instay.closureStatus === 'closed') return null;

  const hasOpenIssues =
    instay.openIssuesCount > 0
    || instay.status === 'guest_issue_open'
    || instay.status === 'guest_issue_blocked';

  if (hasOpenIssues) {
    return baseDraft(record, {
      kind: 'incident_blocker',
      severity: 'critical',
      priority: PRIORITY_BY_KIND.incident_blocker,
      title: 'Открыто обращение гостя',
      reason:
        instay.blockers[0]?.reason
        ?? 'Есть нерешённое обращение или блокировка по проживанию.',
      nextAction: instay.nextAction ?? 'Разобрать обращение гостя',
      updatedAt: instay.updatedAt ?? record.updatedAt,
    });
  }

  if (instay.closureStatus === 'blocked' || instay.status === 'blocked') {
    return baseDraft(record, {
      kind: 'closure_blocked',
      severity: 'critical',
      priority: PRIORITY_BY_KIND.closure_blocked,
      title: 'Закрытие брони заблокировано',
      reason:
        instay.blockers[0]?.reason
        ?? instay.execution?.failureReason
        ?? 'Не выполнены условия для закрытия брони.',
      nextAction: instay.nextAction ?? 'Проверить условия закрытия в Booking Ops',
      updatedAt: instay.updatedAt ?? record.updatedAt,
    });
  }

  if (CHECKOUT_DUE_STATUSES.has(instay.status)) {
    return baseDraft(record, {
      kind: 'checkout_due',
      severity: instay.status === 'checkout_pending' ? 'warning' : 'info',
      priority: PRIORITY_BY_KIND.checkout_due,
      title: 'Нужен контроль выезда',
      reason:
        instay.blockers[0]?.reason
        ?? instay.nextAction
        ?? 'Бронь в фазе выезда; нужен шаг оператора.',
      nextAction: instay.nextAction ?? 'Открыть контур выезда в Booking Ops',
      updatedAt: instay.updatedAt ?? record.updatedAt,
    });
  }

  if (instay.status === 'ready_to_close' && instay.blockers.length > 0) {
    return baseDraft(record, {
      kind: 'closure_blocked',
      severity: 'warning',
      priority: PRIORITY_BY_KIND.closure_blocked,
      title: 'Закрытие брони не готово',
      reason: instay.blockers[0]?.reason ?? 'Перед закрытием остались незавершённые шаги.',
      nextAction: instay.nextAction ?? 'Завершить шаги перед закрытием',
      updatedAt: instay.updatedAt ?? record.updatedAt,
    });
  }

  return null;
}

function deriveAlertSignal(
  alert: BookingOpsAlert,
  record: BookingOpsRecord,
): CrmBookingSignalDraft | null {
  const kind = ALERT_KIND_TO_SIGNAL_KIND[alert.kind];
  if (!kind) return null;

  return baseDraft(record, {
    kind,
    severity: alert.severity,
    priority: PRIORITY_BY_KIND[kind],
    title: alert.title,
    reason: alert.reason,
    nextAction: nextActionLabel(alert.relatedNextAction, 'Открыть Booking Ops'),
  });
}

function deriveIntakeSignal(record: BookingOpsRecord): CrmBookingSignalDraft | null {
  const intakeStatus = record.guestIntake?.intakeStatus;

  if (intakeStatus === 'fallback_required') {
    return baseDraft(record, {
      kind: 'intake_needs_review',
      severity: 'warning',
      priority: PRIORITY_BY_KIND.intake_needs_review,
      title: 'Анкета гостя требует проверки',
      reason: 'Гость не смог завершить анкету; нужен ручной разбор.',
      nextAction: 'Проверить анкету и недостающие данные',
    });
  }

  if (record.readiness?.status === 'missing_booking_data') {
    return baseDraft(record, {
      kind: 'missing_guest_data',
      severity: 'warning',
      priority: PRIORITY_BY_KIND.missing_guest_data,
      title: 'Не хватает данных брони',
      reason:
        record.readiness.missingItems.join(', ')
        || 'В брони не хватает обязательных полей для продолжения.',
      nextAction: 'Дозаполнить данные брони',
    });
  }

  if (
    record.opsStatus === 'created'
    && !record.propertyId
    && !record.propertyLabel?.trim()
  ) {
    return baseDraft(record, {
      kind: 'intake_needs_review',
      severity: 'warning',
      priority: PRIORITY_BY_KIND.intake_needs_review,
      title: 'Бронь требует проверки',
      reason: 'Новая бронь создана без объекта; нужна проверка оператора.',
      nextAction: 'Проверить intake и привязать объект',
    });
  }

  return null;
}

function deriveReadinessSignal(record: BookingOpsRecord): CrmBookingSignalDraft | null {
  switch (record.unitReadinessStatus) {
    case 'cleaning_pending':
      return baseDraft(record, {
        kind: 'cleaning_required',
        severity: 'warning',
        priority: PRIORITY_BY_KIND.cleaning_required,
        title: 'Нужна уборка',
        reason: 'После выезда объект не готов: уборка не завершена.',
        nextAction: 'Завершить уборку в Booking Ops',
      });
    case 'linen_pending':
      return baseDraft(record, {
        kind: 'linen_required',
        severity: 'warning',
        priority: PRIORITY_BY_KIND.linen_required,
        title: 'Нужно белье',
        reason: 'После выезда объект не готов: белье не заменено или не подтверждено.',
        nextAction: 'Завершить шаг по белью в Booking Ops',
      });
    case 'inspection_pending':
      return baseDraft(record, {
        kind: 'inspection_required',
        severity: 'warning',
        priority: PRIORITY_BY_KIND.inspection_required,
        title: 'Нужен осмотр',
        reason: 'После уборки и белья нужен осмотр или подтверждение готовности.',
        nextAction: 'Подтвердить осмотр и готовность в Booking Ops',
      });
    case 'blocked':
      return baseDraft(record, {
        kind: 'property_not_ready',
        severity: 'critical',
        priority: PRIORITY_BY_KIND.property_not_ready,
        title: 'Объект не готов',
        reason: record.blockerReason ?? 'Есть блокер готовности объекта перед следующим заездом.',
        nextAction: 'Разобрать блокер готовности в Booking Ops',
      });
    default:
      return null;
  }
}

function deriveRecentBookingSignal(
  record: BookingOpsRecord,
  evaluatedAt: string,
): CrmBookingSignalDraft | null {
  const createdMs = new Date(record.createdAt).getTime();
  const evaluatedMs = new Date(evaluatedAt).getTime();
  if (Number.isNaN(createdMs) || Number.isNaN(evaluatedMs)) return null;
  if (evaluatedMs - createdMs > 72 * 60 * 60 * 1000) return null;
  if (record.opsStatus !== 'created') return null;

  return baseDraft(record, {
    kind: 'recent_booking',
    severity: 'info',
    priority: PRIORITY_BY_KIND.recent_booking,
    title: 'Новая бронь',
    reason: 'Недавно созданная бронь; проверьте intake и следующий шаг.',
    nextAction: 'Открыть бронь в Booking Ops',
  });
}

function pickBestSignal(candidates: CrmBookingSignalDraft[]): CrmBookingSignalDraft {
  return candidates.reduce((best, current) => {
    if (current.priority < best.priority) return current;
    if (current.priority > best.priority) return best;
    if (SEVERITY_RANK[current.severity] > SEVERITY_RANK[best.severity]) return current;
    if (SEVERITY_RANK[current.severity] < SEVERITY_RANK[best.severity]) return best;
    const currentDue = new Date(current.checkInAt ?? current.updatedAt).getTime();
    const bestDue = new Date(best.checkInAt ?? best.updatedAt).getTime();
    return currentDue < bestDue ? current : best;
  });
}

export function deriveCrmBookingSignalForRecord(
  record: BookingOpsRecord,
  options?: {
    contacts?: CrmContact[];
    instay?: InStayCheckoutSnapshot | null;
    evaluatedAt?: string;
  },
): CrmBookingSignal | null {
  const evaluatedAt = options?.evaluatedAt ?? new Date().toISOString();
  if (isBookingClosedForCrmSignals(record, options?.instay)) return null;

  const candidates: CrmBookingSignalDraft[] = [];

  if (options?.instay) {
    const instaySignal = deriveInstaySignal(record, options.instay);
    if (instaySignal) candidates.push(instaySignal);
  }

  const alerts = record.alerts ?? computeBookingOpsAlerts(record, evaluatedAt);
  for (const alert of alerts.alerts) {
    const signal = deriveAlertSignal(alert, record);
    if (signal) candidates.push(signal);
  }

  const intakeSignal = deriveIntakeSignal(record);
  if (intakeSignal) candidates.push(intakeSignal);

  const readinessSignal = deriveReadinessSignal(record);
  if (readinessSignal) candidates.push(readinessSignal);

  if (candidates.length === 0) {
    const recent = deriveRecentBookingSignal(record, evaluatedAt);
    if (recent) candidates.push(recent);
  }

  if (candidates.length === 0) return null;

  const best = pickBestSignal(candidates);
  const link = linkBookingRecordToCrmContact(record, options?.contacts ?? []);

  return {
    ...best,
    id: `${record.id}:${best.kind}`,
    linkedContactId: link.contactId,
    linkedContactName: link.contactName,
    bookingOpsHref: CRM_BOOKING_OPS_HREF,
  };
}

export function sortCrmBookingSignals(signals: CrmBookingSignal[]): CrmBookingSignal[] {
  return [...signals].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    const aTime = new Date(a.checkInAt ?? a.updatedAt).getTime();
    const bTime = new Date(b.checkInAt ?? b.updatedAt).getTime();
    return aTime - bTime;
  });
}

export function buildCrmBookingSignals(
  records: BookingOpsRecord[],
  contacts: CrmContact[] = [],
  instayByBookingId: Map<string, InStayCheckoutSnapshot> = new Map(),
  evaluatedAt?: string,
): CrmBookingSignal[] {
  const signals = records
    .map((record) =>
      deriveCrmBookingSignalForRecord(record, {
        contacts,
        instay: instayByBookingId.get(record.id) ?? null,
        evaluatedAt,
      }),
    )
    .filter((item): item is CrmBookingSignal => item !== null);

  return sortCrmBookingSignals(signals);
}

export async function loadCrmBookingSignalsForQueue(contacts: CrmContact[]): Promise<CrmBookingSignal[]> {
  const { listBookingOpsRecords } = await import('@/lib/booking-ops/repository');
  const { getInStayCheckoutStatus } = await import('@/lib/booking-ops/instay-checkout-autopilot');

  const listed = await listBookingOpsRecords({ limit: 100 });
  if (!listed.ok) return [];

  const now = Date.now();
  const instayByBookingId = new Map<string, InStayCheckoutSnapshot>();
  const instayCandidates = listed.records.filter((record) => {
    if (!record.checkInAt) return false;
    const checkInMs = new Date(record.checkInAt).getTime();
    return !Number.isNaN(checkInMs) && checkInMs <= now;
  });

  await Promise.all(
    instayCandidates.slice(0, 40).map(async (record) => {
      try {
        const snapshot = await getInStayCheckoutStatus(record.id);
        if (snapshot.status !== 'closed' && snapshot.closureStatus !== 'closed') {
          instayByBookingId.set(record.id, snapshot);
        }
      } catch {
        // Skip records without in-stay execution state.
      }
    }),
  );

  return buildCrmBookingSignals(listed.records, contacts, instayByBookingId);
}
