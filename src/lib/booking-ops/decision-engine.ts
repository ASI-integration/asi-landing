import type {
  BookingOpsAutomationDecision,
  BookingOpsNextAction,
  BookingOpsRecord,
  BookingOpsStatus,
} from './types';
import {
  BOOKING_OPS_NEXT_ACTION_LABELS_RU,
  bookingOpsHasProblemSignals,
  hasGuestContact,
} from './types';

const AUTOMATION_NEXT_ACTION_LABELS = new Set(Object.values(BOOKING_OPS_NEXT_ACTION_LABELS_RU));

type DecisionDraft = Omit<BookingOpsAutomationDecision, 'evaluatedAt'>;

function decision(evaluatedAt: string, draft: DecisionDraft): BookingOpsAutomationDecision {
  return { evaluatedAt, ...draft };
}

export function hasBookingOpsManualOverride(record: BookingOpsRecord): boolean {
  const manual = record.manualNextAction?.trim() ?? '';
  return manual.length > 0 && !AUTOMATION_NEXT_ACTION_LABELS.has(manual);
}

function collectBlockers(record: BookingOpsRecord): string[] {
  const blockers: string[] = [];
  if (record.isBlocked) {
    blockers.push(record.blockerReason?.trim() || 'Запись помечена как заблокированная.');
  }
  if (record.documentsStatus === 'problem') blockers.push('Проблема с документами гостя.');
  if (record.contractStatus === 'problem') blockers.push('Проблема с договором.');
  if (record.depositStatus === 'problem') blockers.push('Проблема с депозитом.');
  if (record.mvdStatus === 'problem') blockers.push('Проблема с отчётом МВД.');
  if (record.checkinReadinessStatus === 'problem') blockers.push('Проблема с готовностью к заезду.');
  if (!hasGuestContact(record)) blockers.push('Нет контакта гостя (телефон, email или Telegram).');
  if (!String(record.guestName ?? '').trim()) blockers.push('Не указано имя гостя.');
  if (!String(record.propertyId ?? '').trim() && !String(record.propertyLabel ?? '').trim()) {
    blockers.push('Не указан объект.');
  }
  if (!record.checkInAt) blockers.push('Не указана дата заезда.');
  return blockers;
}

function mvdRequired(record: BookingOpsRecord): boolean {
  return record.mvdStatus === 'required' || record.mvdStatus === 'prepared' || record.mvdStatus === 'submitted';
}

export function evaluateBookingOpsAutomation(
  record: BookingOpsRecord,
  evaluatedAt = new Date().toISOString(),
): BookingOpsAutomationDecision {
  const blockers = collectBlockers(record);

  if (hasBookingOpsManualOverride(record)) {
    return decision(evaluatedAt, {
      nextAction: 'pause',
      automationState: 'manual_override',
      needsOperatorAction: false,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Сохранён ручной следующий шаг. Автоматизация не меняет его и статус.',
    });
  }

  if (record.isBlocked || record.opsStatus === 'problem_blocked') {
    return decision(evaluatedAt, {
      nextAction: 'blocked',
      automationState: 'blocked',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'problem_blocked',
      blockers,
      reason: record.blockerReason?.trim() || 'Бронь заблокирована; требуется решение оператора.',
    });
  }

  if (bookingOpsHasProblemSignals(record)) {
    return decision(evaluatedAt, {
      nextAction: 'needs_operator_attention',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'problem_blocked',
      blockers,
      reason: 'Зафиксирован проблемный сигнал; требуется проверка оператора.',
    });
  }

  if (record.opsStatus === 'ready_for_checkin') {
    return decision(evaluatedAt, {
      nextAction: 'pause',
      automationState: 'completed',
      needsOperatorAction: false,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Все операционные шаги до заезда выполнены.',
    });
  }

  if (!hasGuestContact(record)) {
    return decision(evaluatedAt, {
      nextAction: 'needs_operator_attention',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Нужен контакт гостя, чтобы продолжить операционный контур.',
    });
  }

  if (record.documentsStatus === 'not_started') {
    return decision(evaluatedAt, {
      nextAction: 'request_guest_documents',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'documents_requested',
      blockers,
      reason: 'Документы гостя ещё не запрошены.',
    });
  }

  if (record.documentsStatus === 'requested') {
    return decision(evaluatedAt, {
      nextAction: 'request_guest_documents',
      automationState: 'waiting',
      needsOperatorAction: false,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Документы запрошены; ждём ответ гостя.',
    });
  }

  if (record.documentsStatus === 'received') {
    return decision(evaluatedAt, {
      nextAction: 'verify_guest_documents',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'documents_received',
      blockers,
      reason: 'Документы получены; нужна проверка оператором.',
    });
  }

  if (record.documentsStatus !== 'verified') {
    return decision(evaluatedAt, {
      nextAction: 'needs_operator_attention',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Статус документов неоднозначен.',
    });
  }

  if (record.contractStatus === 'not_started') {
    return decision(evaluatedAt, {
      nextAction: 'prepare_contract',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'contract_prepared',
      blockers,
      reason: 'Документы проверены; нужно подготовить договор.',
    });
  }

  if (record.contractStatus === 'prepared') {
    return decision(evaluatedAt, {
      nextAction: 'send_contract',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'contract_sent',
      blockers,
      reason: 'Договор подготовлен; его нужно отправить гостю.',
    });
  }

  if (record.contractStatus === 'sent') {
    return decision(evaluatedAt, {
      nextAction: 'confirm_contract_signed',
      automationState: 'waiting',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Договор отправлен; ждём подписание.',
    });
  }

  if (record.contractStatus !== 'signed') {
    return decision(evaluatedAt, {
      nextAction: 'needs_operator_attention',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Статус договора неоднозначен.',
    });
  }

  if (record.depositStatus === 'not_started') {
    return decision(evaluatedAt, {
      nextAction: 'request_deposit',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'deposit_requested',
      blockers,
      reason: 'Договор подписан; нужно запросить депозит.',
    });
  }

  if (record.depositStatus === 'requested') {
    return decision(evaluatedAt, {
      nextAction: 'confirm_deposit',
      automationState: 'waiting',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Депозит запрошен; ждём подтверждение.',
    });
  }

  if (record.depositStatus !== 'confirmed') {
    return decision(evaluatedAt, {
      nextAction: 'needs_operator_attention',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      blockers,
      reason: 'Статус депозита неоднозначен.',
    });
  }

  if (mvdRequired(record)) {
    if (record.mvdStatus === 'required') {
      return decision(evaluatedAt, {
        nextAction: 'prepare_mvd_report',
        automationState: 'action_required',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedOpsStatus: 'mvd_prepared',
        blockers,
        reason: 'Требуется подготовить отчёт МВД.',
      });
    }
    if (record.mvdStatus === 'prepared') {
      return decision(evaluatedAt, {
        nextAction: 'submit_mvd_report',
        automationState: 'action_required',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedOpsStatus: 'mvd_submitted',
        blockers,
        reason: 'Отчёт МВД подготовлен; его нужно отправить.',
      });
    }
    if (record.mvdStatus !== 'submitted') {
      return decision(evaluatedAt, {
        nextAction: 'needs_operator_attention',
        automationState: 'needs_operator_attention',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedOpsStatus: null,
        blockers,
        reason: 'Статус отчёта МВД неоднозначен.',
      });
    }
  }

  if (record.checkinReadinessStatus === 'not_started' || record.checkinReadinessStatus === 'in_progress') {
    return decision(evaluatedAt, {
      nextAction: 'prepare_checkin_instructions',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'checkin_instructions_ready',
      blockers,
      reason: 'Нужно подготовить инструкции заезда.',
    });
  }

  if (record.checkinReadinessStatus === 'ready') {
    return decision(evaluatedAt, {
      nextAction: 'mark_ready_for_checkin',
      automationState: 'automatic_action_available',
      needsOperatorAction: false,
      canAutoPerform: true,
      recommendedOpsStatus: 'ready_for_checkin',
      blockers,
      reason: 'Инструкции готовы; можно отметить бронь готовой к заезду.',
    });
  }

  return decision(evaluatedAt, {
    nextAction: 'needs_operator_attention',
    automationState: 'needs_operator_attention',
    needsOperatorAction: true,
    canAutoPerform: false,
    recommendedOpsStatus: null,
    blockers,
    reason: 'Состояние брони не распознано как безопасный автоматический сценарий.',
  });
}

export type BookingOpsAutomationPatch = Pick<BookingOpsRecord, 'opsStatus' | 'manualNextAction'>;

export function buildBookingOpsAutomationPatch(
  record: BookingOpsRecord,
  evaluatedAt = new Date().toISOString(),
): Partial<BookingOpsAutomationPatch> {
  const currentDecision = evaluateBookingOpsAutomation(record, evaluatedAt);
  if (currentDecision.automationState === 'manual_override') return {};

  const patch: Partial<BookingOpsAutomationPatch> = {};
  const recommendedOpsStatus = currentDecision.canAutoPerform
    ? currentDecision.recommendedOpsStatus
    : null;

  if (recommendedOpsStatus && recommendedOpsStatus !== record.opsStatus) {
    patch.opsStatus = recommendedOpsStatus;
  }

  const postTransitionRecord = recommendedOpsStatus
    ? { ...record, opsStatus: recommendedOpsStatus }
    : record;
  const nextDecision = evaluateBookingOpsAutomation(postTransitionRecord, evaluatedAt);
  const recommendedNextAction = BOOKING_OPS_NEXT_ACTION_LABELS_RU[nextDecision.nextAction];
  const currentManual = record.manualNextAction?.trim() ?? '';
  if (!currentManual || AUTOMATION_NEXT_ACTION_LABELS.has(currentManual)) {
    if (record.manualNextAction !== recommendedNextAction) {
      patch.manualNextAction = recommendedNextAction;
    }
  }

  return patch;
}

export function opsStatusForNextAction(nextAction: BookingOpsNextAction): BookingOpsStatus | null {
  const map: Partial<Record<BookingOpsNextAction, BookingOpsStatus>> = {
    request_guest_documents: 'documents_requested',
    verify_guest_documents: 'documents_received',
    prepare_contract: 'contract_prepared',
    send_contract: 'contract_sent',
    confirm_contract_signed: 'contract_signed',
    request_deposit: 'deposit_requested',
    confirm_deposit: 'deposit_confirmed',
    prepare_mvd_report: 'mvd_prepared',
    submit_mvd_report: 'mvd_submitted',
    prepare_checkin_instructions: 'checkin_instructions_ready',
    mark_ready_for_checkin: 'ready_for_checkin',
  };
  return map[nextAction] ?? null;
}
