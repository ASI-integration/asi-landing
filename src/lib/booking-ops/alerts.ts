import { evaluateBookingOpsAutomation } from './decision-engine';
import { attachBookingOpsOperatorAction } from './action-templates';
import type {
  BookingOpsAlert,
  BookingOpsAlertKind,
  BookingOpsAlertSeverity,
  BookingOpsAlertSummary,
  BookingOpsNextAction,
  BookingOpsRecord,
} from './types';
import { bookingOpsHasProblemSignals, hasGuestContact } from './types';

export type {
  BookingOpsAlert,
  BookingOpsAlertKind,
  BookingOpsAlertSeverity,
  BookingOpsAlertSummary,
};

/**
 * Booking Ops Alerts v1 — computed server-side (no DB persistence).
 * Resolve/ignore actions are intentionally omitted until a DB-backed v2.
 */

/** Check-in within this many hours escalates incomplete steps to critical. */
export const BOOKING_OPS_CHECKIN_CRITICAL_HOURS = 48;

/** Check-in within this many days escalates incomplete steps to at least warning. */
export const BOOKING_OPS_CHECKIN_WARNING_DAYS = 7;

const SEVERITY_RANK: Record<BookingOpsAlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function hoursUntilCheckIn(checkInAt: string | null, nowMs: number): number | null {
  if (!checkInAt) return null;
  const checkInMs = new Date(checkInAt).getTime();
  if (Number.isNaN(checkInMs)) return null;
  return (checkInMs - nowMs) / (60 * 60 * 1000);
}

function isCheckInVerySoon(checkInAt: string | null, nowMs: number): boolean {
  const hours = hoursUntilCheckIn(checkInAt, nowMs);
  return hours !== null && hours >= 0 && hours <= BOOKING_OPS_CHECKIN_CRITICAL_HOURS;
}

function isCheckInApproaching(checkInAt: string | null, nowMs: number): boolean {
  const hours = hoursUntilCheckIn(checkInAt, nowMs);
  if (hours === null || hours < 0) return false;
  return hours <= BOOKING_OPS_CHECKIN_WARNING_DAYS * 24;
}

function hasIncompleteRequiredSteps(record: BookingOpsRecord): boolean {
  if (record.opsStatus === 'ready_for_checkin') return false;
  if (!hasGuestContact(record)) return true;
  if (record.documentsStatus !== 'verified') return true;
  if (record.contractStatus !== 'signed') return true;
  if (record.depositStatus !== 'confirmed') return true;
  if (
    record.mvdStatus === 'required'
    || record.mvdStatus === 'prepared'
    || record.mvdStatus === 'problem'
  ) {
    return true;
  }
  if (record.checkinReadinessStatus !== 'ready') return true;
  return false;
}

function baseSeverityForIncompleteStep(
  record: BookingOpsRecord,
  nowMs: number,
  defaultSeverity: BookingOpsAlertSeverity,
): BookingOpsAlertSeverity {
  if (isCheckInVerySoon(record.checkInAt, nowMs) && hasIncompleteRequiredSteps(record)) {
    return 'critical';
  }
  if (isCheckInApproaching(record.checkInAt, nowMs) && hasIncompleteRequiredSteps(record)) {
    return defaultSeverity === 'info' ? 'warning' : defaultSeverity;
  }
  return defaultSeverity;
}

function mvdIsRequired(record: BookingOpsRecord): boolean {
  return (
    record.mvdStatus === 'required'
    || record.mvdStatus === 'prepared'
    || record.mvdStatus === 'submitted'
    || record.mvdStatus === 'problem'
  );
}

function contractIsIncomplete(record: BookingOpsRecord): boolean {
  return record.contractStatus !== 'signed';
}

function depositIsIncomplete(record: BookingOpsRecord): boolean {
  return record.depositStatus !== 'confirmed';
}

function makeAlert(
  record: BookingOpsRecord,
  draft: Omit<BookingOpsAlert, 'bookingOpsId' | 'sourceBookingId' | 'status'>,
): BookingOpsAlert {
  return {
    bookingOpsId: record.id,
    sourceBookingId: record.bookingId,
    status: 'open',
    ...draft,
  };
}

function pickPrimaryAlert(alerts: BookingOpsAlert[]): BookingOpsAlert | null {
  if (alerts.length === 0) return null;
  return alerts.reduce((best, current) =>
    SEVERITY_RANK[current.severity] > SEVERITY_RANK[best.severity] ? current : best,
  );
}

function maxSeverity(alerts: BookingOpsAlert[]): BookingOpsAlertSeverity | null {
  const primary = pickPrimaryAlert(alerts);
  return primary?.severity ?? null;
}

export function computeBookingOpsAlerts(
  record: BookingOpsRecord,
  evaluatedAt = new Date().toISOString(),
): BookingOpsAlertSummary {
  const nowMs = new Date(evaluatedAt).getTime();
  const decision = record.automation ?? evaluateBookingOpsAutomation(record, evaluatedAt);
  const alerts: BookingOpsAlert[] = [];
  const dueAt = record.checkInAt;

  if (record.isBlocked || record.opsStatus === 'problem_blocked') {
    alerts.push(
      makeAlert(record, {
        kind: 'booking_blocked',
        title: 'Бронь заблокирована',
        reason: record.blockerReason?.trim() || 'Бронь помечена как заблокированная; нужно решение оператора.',
        severity: 'critical',
        dueAt,
        relatedNextAction: 'blocked',
      }),
    );
  } else if (bookingOpsHasProblemSignals(record)) {
    alerts.push(
      makeAlert(record, {
        kind: 'booking_blocked',
        title: 'Проблема с бронью',
        reason: decision.reason || 'Зафиксирован проблемный сигнал; требуется проверка оператора.',
        severity: 'critical',
        dueAt,
        relatedNextAction: decision.nextAction,
      }),
    );
  }

  if (!hasGuestContact(record)) {
    alerts.push(
      makeAlert(record, {
        kind: 'guest_contact_missing',
        title: 'Нет контакта гостя',
        reason: 'Укажите телефон, email или Telegram, чтобы продолжить операционный контур.',
        severity: baseSeverityForIncompleteStep(record, nowMs, 'warning'),
        dueAt,
        relatedNextAction: 'needs_operator_attention',
      }),
    );
  }

  if (record.documentsStatus === 'not_started') {
    alerts.push(
      makeAlert(record, {
        kind: 'documents_not_requested',
        title: 'Документы не запрошены',
        reason: 'Документы гостя ещё не запрошены.',
        severity: baseSeverityForIncompleteStep(record, nowMs, 'warning'),
        dueAt,
        relatedNextAction: 'request_guest_documents',
      }),
    );
  } else if (record.documentsStatus === 'requested') {
    alerts.push(
      makeAlert(record, {
        kind: 'documents_not_received',
        title: 'Документы не получены',
        reason: 'Документы запрошены, но ответ от гостя ещё не получен.',
        severity: baseSeverityForIncompleteStep(record, nowMs, 'info'),
        dueAt,
        relatedNextAction: 'request_guest_documents',
      }),
    );
  }

  if (
    hasGuestContact(record)
    && record.documentsStatus === 'verified'
    && contractIsIncomplete(record)
  ) {
    const contractReasons: Record<string, string> = {
      not_started: 'Договор ещё не подготовлен.',
      prepared: 'Договор подготовлен, но не отправлен гостю.',
      sent: 'Договор отправлен; ждём подписание.',
      problem: 'Проблема с договором; нужна проверка оператора.',
    };
    const nextActions: Record<string, BookingOpsNextAction> = {
      not_started: 'prepare_contract',
      prepared: 'send_contract',
      sent: 'confirm_contract_signed',
      problem: 'needs_operator_attention',
    };
    const status = record.contractStatus;
    alerts.push(
      makeAlert(record, {
        kind: 'contract_incomplete',
        title: 'Договор не завершён',
        reason: contractReasons[status] ?? 'Договор не подписан.',
        severity:
          status === 'problem'
            ? 'critical'
            : baseSeverityForIncompleteStep(record, nowMs, 'warning'),
        dueAt,
        relatedNextAction: nextActions[status] ?? decision.nextAction,
      }),
    );
  }

  if (
    hasGuestContact(record)
    && record.documentsStatus === 'verified'
    && record.contractStatus === 'signed'
    && depositIsIncomplete(record)
  ) {
    const depositReasons: Record<string, string> = {
      not_started: 'Депозит ещё не запрошен.',
      requested: 'Депозит запрошен; ждём подтверждение.',
      problem: 'Проблема с депозитом; нужна проверка оператора.',
    };
    const nextActions: Record<string, BookingOpsNextAction> = {
      not_started: 'request_deposit',
      requested: 'confirm_deposit',
      problem: 'needs_operator_attention',
    };
    const status = record.depositStatus;
    alerts.push(
      makeAlert(record, {
        kind: 'deposit_incomplete',
        title: 'Депозит не подтверждён',
        reason: depositReasons[status] ?? 'Депозит не подтверждён.',
        severity:
          status === 'problem'
            ? 'critical'
            : baseSeverityForIncompleteStep(record, nowMs, 'warning'),
        dueAt,
        relatedNextAction: nextActions[status] ?? decision.nextAction,
      }),
    );
  }

  if (
    hasGuestContact(record)
    && record.documentsStatus === 'verified'
    && record.contractStatus === 'signed'
    && record.depositStatus === 'confirmed'
    && mvdIsRequired(record)
    && record.mvdStatus !== 'submitted'
  ) {
    const mvdReasons: Record<string, string> = {
      required: 'Требуется подготовить отчёт МВД.',
      prepared: 'Отчёт МВД подготовлен; его нужно отправить.',
      problem: 'Проблема с отчётом МВД; нужна проверка оператора.',
    };
    const nextActions: Record<string, BookingOpsNextAction> = {
      required: 'prepare_mvd_report',
      prepared: 'submit_mvd_report',
      problem: 'needs_operator_attention',
    };
    const status = record.mvdStatus;
    alerts.push(
      makeAlert(record, {
        kind: 'mvd_not_submitted',
        title: 'Отчёт МВД не отправлен',
        reason: mvdReasons[status] ?? 'Отчёт МВД не отправлен.',
        severity:
          status === 'problem'
            ? 'critical'
            : baseSeverityForIncompleteStep(record, nowMs, 'warning'),
        dueAt,
        relatedNextAction: nextActions[status] ?? decision.nextAction,
      }),
    );
  }

  if (
    hasGuestContact(record)
    && record.documentsStatus === 'verified'
    && record.contractStatus === 'signed'
    && record.depositStatus === 'confirmed'
    && (!mvdIsRequired(record) || record.mvdStatus === 'submitted')
    && record.checkinReadinessStatus !== 'ready'
    && record.opsStatus !== 'ready_for_checkin'
  ) {
    const readinessReasons: Record<string, string> = {
      not_started: 'Инструкции заезда ещё не подготовлены.',
      in_progress: 'Инструкции заезда в работе; нужно завершить подготовку.',
      problem: 'Проблема с инструкциями заезда; нужна проверка оператора.',
    };
    alerts.push(
      makeAlert(record, {
        kind: 'checkin_instructions_not_ready',
        title: 'Инструкции заезда не готовы',
        reason: readinessReasons[record.checkinReadinessStatus] ?? 'Инструкции заезда не готовы.',
        severity:
          record.checkinReadinessStatus === 'problem'
            ? 'critical'
            : baseSeverityForIncompleteStep(record, nowMs, 'warning'),
        dueAt,
        relatedNextAction: 'prepare_checkin_instructions',
      }),
    );
  }

  if (
    isCheckInVerySoon(record.checkInAt, nowMs)
    && hasIncompleteRequiredSteps(record)
    && !alerts.some((alert) => alert.severity === 'critical')
  ) {
    alerts.push(
      makeAlert(record, {
        kind: 'checkin_approaching_incomplete',
        title: 'Заезд скоро — шаги не завершены',
        reason: `Заезд через ${Math.max(0, Math.round(hoursUntilCheckIn(record.checkInAt, nowMs) ?? 0))} ч.; обязательные шаги до заезда не выполнены.`,
        severity: 'critical',
        dueAt,
        relatedNextAction: decision.nextAction,
      }),
    );
  } else if (
    isCheckInApproaching(record.checkInAt, nowMs)
    && hasIncompleteRequiredSteps(record)
    && record.opsStatus !== 'ready_for_checkin'
  ) {
    const hasApproachingAlert = alerts.some(
      (alert) => alert.kind === 'checkin_approaching_incomplete',
    );
    if (!hasApproachingAlert) {
      alerts.push(
        makeAlert(record, {
          kind: 'checkin_approaching_incomplete',
          title: 'Заезд приближается — шаги не завершены',
          reason: `До заезда осталось менее ${BOOKING_OPS_CHECKIN_WARNING_DAYS} дн.; обязательные шаги до заезда не выполнены.`,
          severity: 'warning',
          dueAt,
          relatedNextAction: decision.nextAction,
        }),
      );
    }
  }

  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  return {
    alerts: sorted,
    primaryAlert: pickPrimaryAlert(sorted),
    maxSeverity: maxSeverity(sorted),
  };
}

export function attachBookingOpsAlerts(record: BookingOpsRecord): BookingOpsRecord {
  const automation = record.automation ?? evaluateBookingOpsAutomation(record);
  const withAutomation = { ...record, automation };
  const withAlerts = { ...withAutomation, alerts: computeBookingOpsAlerts(withAutomation) };
  return attachBookingOpsOperatorAction(withAlerts);
}
