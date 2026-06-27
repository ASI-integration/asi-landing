import {
  buildBookingOpsAutomationPatch,
  evaluateBookingOpsAutomation,
  hasBookingOpsManualOverride,
  opsStatusForNextAction,
} from './decision-engine';
import { wouldDowngradeOpsStatus } from './reservation-mapping';
import { getBookingOpsRecord, updateBookingOpsRecord } from './repository';
import type {
  BookingOpsActionFieldsOnConfirm,
  BookingOpsActionTemplate,
  BookingOpsCheckinReadinessStatus,
  BookingOpsContractStatus,
  BookingOpsDepositStatus,
  BookingOpsDocumentsStatus,
  BookingOpsMvdStatus,
  BookingOpsNextAction,
  BookingOpsOperatorActionId,
  BookingOpsRecord,
  UpdateBookingOpsInput,
} from './types';
import {
  BOOKING_OPS_NEXT_ACTION_LABELS_RU,
  BOOKING_OPS_OPERATOR_ACTIONS,
  bookingOpsHasProblemSignals,
  hasGuestContact,
} from './types';

const DOCUMENTS_RANK: Record<BookingOpsDocumentsStatus, number> = {
  not_started: 0,
  requested: 1,
  received: 2,
  verified: 3,
  problem: -1,
};

const CONTRACT_RANK: Record<BookingOpsContractStatus, number> = {
  not_started: 0,
  prepared: 1,
  sent: 2,
  signed: 3,
  problem: -1,
};

const DEPOSIT_RANK: Record<BookingOpsDepositStatus, number> = {
  not_started: 0,
  requested: 1,
  confirmed: 2,
  problem: -1,
};

const MVD_RANK: Record<BookingOpsMvdStatus, number> = {
  not_required: 0,
  required: 1,
  prepared: 2,
  submitted: 3,
  problem: -1,
};

const CHECKIN_READINESS_RANK: Record<BookingOpsCheckinReadinessStatus, number> = {
  not_started: 0,
  in_progress: 1,
  ready: 2,
  problem: -1,
};

function isOperatorAction(action: BookingOpsNextAction): action is BookingOpsOperatorActionId {
  return (BOOKING_OPS_OPERATOR_ACTIONS as readonly string[]).includes(action);
}

function wouldDowngradeRank<T extends string>(
  current: T,
  next: T,
  ranks: Record<T, number>,
): boolean {
  if (current === next) return false;
  const currentRank = ranks[current];
  const nextRank = ranks[next];
  if (currentRank < 0 || nextRank < 0) return true;
  return nextRank < currentRank;
}

function guestNameLabel(record: BookingOpsRecord): string {
  const name = String(record.guestName ?? '').trim();
  return name || '[имя гостя]';
}

function propertyLabel(record: BookingOpsRecord): string {
  const label = String(record.propertyLabel ?? '').trim();
  if (label) return label;
  const id = String(record.propertyId ?? '').trim();
  if (id) return id;
  return '[объект]';
}

function formatRuDate(value: string | null, placeholder: string): string {
  if (!value) return placeholder;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return placeholder;
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function propertyDataWarnings(record: BookingOpsRecord): string[] {
  const warnings: string[] = [];
  if (!String(record.propertyLabel ?? '').trim() && !String(record.propertyId ?? '').trim()) {
    warnings.push('Не указан объект — в тексте будет заглушка [объект].');
  }
  if (!record.checkInAt) {
    warnings.push('Не указана дата заезда — в тексте будет заглушка [дата заезда].');
  }
  return warnings;
}

function getReadyForCheckinBlockers(record: BookingOpsRecord): string[] {
  const blockers: string[] = [];
  if (record.isBlocked || record.opsStatus === 'problem_blocked') {
    blockers.push('Запись заблокирована.');
  }
  if (bookingOpsHasProblemSignals(record)) {
    blockers.push('Есть проблемный статус; сначала устраните проблему.');
  }
  if (!hasGuestContact(record)) blockers.push('Нет контакта гостя.');
  if (record.documentsStatus !== 'verified') blockers.push('Документы гостя не проверены.');
  if (record.contractStatus !== 'signed') blockers.push('Договор не подписан.');
  if (record.depositStatus !== 'confirmed') blockers.push('Депозит не подтверждён.');
  if (record.mvdStatus === 'required' || record.mvdStatus === 'prepared') {
    blockers.push('Отчёт МВД не отправлен.');
  }
  if (record.mvdStatus === 'problem') blockers.push('Проблема с отчётом МВД.');
  if (record.checkinReadinessStatus !== 'ready') {
    blockers.push('Инструкции заезда не готовы.');
  }
  return blockers;
}

function baseBlockedReason(record: BookingOpsRecord): string | null {
  if (hasBookingOpsManualOverride(record)) {
    return 'Установлен ручной следующий шаг; автоматические действия отключены.';
  }
  if (record.isBlocked || record.opsStatus === 'problem_blocked') {
    return record.blockerReason?.trim() || 'Запись заблокирована.';
  }
  if (bookingOpsHasProblemSignals(record)) {
    return 'Зафиксирован проблемный статус; требуется проверка оператора.';
  }
  return null;
}

type ActionSpec = {
  fieldsOnConfirm: BookingOpsActionFieldsOnConfirm;
  description: string;
  messageTemplate: ((record: BookingOpsRecord) => string) | null;
  internalChecklist: string[];
  isAllowed: (record: BookingOpsRecord) => boolean;
  blockedReason: (record: BookingOpsRecord) => string | null;
  warnings: (record: BookingOpsRecord) => string[];
};

const ACTION_SPECS: Record<BookingOpsOperatorActionId, ActionSpec> = {
  request_guest_documents: {
    fieldsOnConfirm: { documentsStatus: 'requested', opsStatus: 'documents_requested' },
    description: 'Отправьте гостю запрос документов вручную (Telegram, email или другой канал).',
    messageTemplate: (record) => {
      const name = guestNameLabel(record);
      const property = propertyLabel(record);
      const checkIn = formatRuDate(record.checkInAt, '[дата заезда]');
      return `Здравствуйте, ${name}!

Для оформления заезда в «${property}» (${checkIn}) нам нужны документы:
• паспорт (разворот с фото и прописка);
• при необходимости — данные сопровождающих.

Пожалуйста, пришлите фото или сканы удобным способом.

Спасибо!`;
    },
    internalChecklist: [],
    isAllowed: (record) =>
      hasGuestContact(record)
      && (record.documentsStatus === 'not_started' || record.documentsStatus === 'requested'),
    blockedReason: (record) => {
      if (!hasGuestContact(record)) return 'Нет контакта гостя для отправки запроса.';
      if (record.documentsStatus === 'received' || record.documentsStatus === 'verified') {
        return 'Документы уже получены или проверены; нельзя откатить статус.';
      }
      if (record.documentsStatus === 'problem') return 'Статус документов — проблема.';
      return null;
    },
    warnings: (record) => {
      const warnings = propertyDataWarnings(record);
      if (!String(record.guestName ?? '').trim()) {
        warnings.push('Не указано имя гостя — в тексте будет заглушка [имя гостя].');
      }
      return warnings;
    },
  },
  verify_guest_documents: {
    fieldsOnConfirm: { documentsStatus: 'verified', opsStatus: 'documents_received' },
    description: 'Проверьте полученные документы гостя перед подготовкой договора.',
    messageTemplate: null,
    internalChecklist: [
      'Сверить ФИО гостя с бронью.',
      'Проверить срок действия паспорта и читаемость фото.',
      'Убедиться, что данные всех гостей получены (если бронь на нескольких).',
      'При сомнениях — связаться с гостем до подтверждения.',
    ],
    isAllowed: (record) => record.documentsStatus === 'received',
    blockedReason: (record) => {
      if (record.documentsStatus === 'verified') return 'Документы уже проверены.';
      if (record.documentsStatus !== 'received') return 'Документы ещё не получены.';
      return null;
    },
    warnings: () => [],
  },
  prepare_contract: {
    fieldsOnConfirm: { contractStatus: 'prepared', opsStatus: 'contract_prepared' },
    description: 'Подготовьте договор вручную (OkiDoki пока не подключён).',
    messageTemplate: null,
    internalChecklist: [
      'Создать договор с данными гостя и объекта.',
      'Проверить даты заезда/выезда и сумму.',
      'Сохранить черновик договора для отправки гостю.',
    ],
    isAllowed: (record) =>
      record.documentsStatus === 'verified' && record.contractStatus === 'not_started',
    blockedReason: (record) => {
      if (record.documentsStatus !== 'verified') return 'Сначала проверьте документы гостя.';
      if (record.contractStatus !== 'not_started') return 'Договор уже подготовлен или дальше по процессу.';
      return null;
    },
    warnings: () => [],
  },
  send_contract: {
    fieldsOnConfirm: { contractStatus: 'sent', opsStatus: 'contract_sent' },
    description: 'Отправьте гостю ссылку или файл договора вручную.',
    messageTemplate: (record) => {
      const name = guestNameLabel(record);
      const property = propertyLabel(record);
      return `Здравствуйте, ${name}!

Договор на проживание в «${property}» готов. Пожалуйста, ознакомьтесь и подпишите его.

[Вставьте ссылку или приложите файл договора]

Если будут вопросы — напишите нам.`;
    },
    internalChecklist: [],
    isAllowed: (record) => record.contractStatus === 'prepared',
    blockedReason: (record) => {
      if (record.contractStatus !== 'prepared') return 'Сначала подготовьте договор.';
      return null;
    },
    warnings: (record) => propertyDataWarnings(record),
  },
  confirm_contract_signed: {
    fieldsOnConfirm: { contractStatus: 'signed', opsStatus: 'contract_signed' },
    description: 'Подтвердите, что гость подписал договор.',
    messageTemplate: null,
    internalChecklist: [
      'Проверить, что подписанный договор получен от гостя.',
      'Сверить подпись и данные с оригиналом брони.',
    ],
    isAllowed: (record) => record.contractStatus === 'sent',
    blockedReason: (record) => {
      if (record.contractStatus === 'signed') return 'Договор уже подписан.';
      if (record.contractStatus !== 'sent') return 'Договор ещё не отправлен гостю.';
      return null;
    },
    warnings: () => [],
  },
  request_deposit: {
    fieldsOnConfirm: { depositStatus: 'requested', opsStatus: 'deposit_requested' },
    description: 'Запросите депозит у гостя вручную (оплата пока не подключена).',
    messageTemplate: (record) => {
      const name = guestNameLabel(record);
      const property = propertyLabel(record);
      return `Здравствуйте, ${name}!

Для брони «${property}» нужен депозит (залог).

Сумма: [укажите сумму]
Реквизиты / способ оплаты: [укажите реквизиты]

После перевода пришлите, пожалуйста, подтверждение оплаты.`;
    },
    internalChecklist: [],
    isAllowed: (record) =>
      record.contractStatus === 'signed'
      && (record.depositStatus === 'not_started' || record.depositStatus === 'requested'),
    blockedReason: (record) => {
      if (record.contractStatus !== 'signed') return 'Сначала подтвердите подписание договора.';
      if (record.depositStatus === 'confirmed') return 'Депозит уже подтверждён.';
      if (record.depositStatus === 'problem') return 'Статус депозита — проблема.';
      return null;
    },
    warnings: (record) => propertyDataWarnings(record),
  },
  confirm_deposit: {
    fieldsOnConfirm: { depositStatus: 'confirmed', opsStatus: 'deposit_confirmed' },
    description: 'Подтвердите, что депозит получен.',
    messageTemplate: null,
    internalChecklist: [
      'Проверить поступление депозита на счёт.',
      'Сверить сумму и назначение платежа с бронью.',
    ],
    isAllowed: (record) => record.depositStatus === 'requested',
    blockedReason: (record) => {
      if (record.depositStatus === 'confirmed') return 'Депозит уже подтверждён.';
      if (record.depositStatus !== 'requested') return 'Депозит ещё не запрошен.';
      return null;
    },
    warnings: () => [],
  },
  prepare_mvd_report: {
    fieldsOnConfirm: { mvdStatus: 'prepared', opsStatus: 'mvd_prepared' },
    description: 'Подготовьте отчёт МВД вручную (автоматическая отправка не подключена).',
    messageTemplate: null,
    internalChecklist: [
      'Собрать паспортные данные гостя из проверенных документов.',
      'Заполнить форму регистрации для МВД.',
      'Сохранить черновик отчёта перед отправкой.',
    ],
    isAllowed: (record) => record.mvdStatus === 'required',
    blockedReason: (record) => {
      if (record.mvdStatus === 'not_required') return 'Регистрация МВД не требуется для этой брони.';
      if (record.mvdStatus !== 'required') return 'Отчёт МВД уже подготовлен или отправлен.';
      return null;
    },
    warnings: () => [],
  },
  submit_mvd_report: {
    fieldsOnConfirm: { mvdStatus: 'submitted', opsStatus: 'mvd_submitted' },
    description: 'Подтвердите, что отчёт МВД отправлен (реальная отправка не подключена).',
    messageTemplate: null,
    internalChecklist: [
      'Проверить, что отчёт заполнен полностью.',
      'Отправить отчёт в МВД вручную через установленный канал.',
      'Сохранить номер/подтверждение отправки в заметках (по желанию).',
    ],
    isAllowed: (record) => record.mvdStatus === 'prepared',
    blockedReason: (record) => {
      if (record.mvdStatus === 'submitted') return 'Отчёт МВД уже отправлен.';
      if (record.mvdStatus !== 'prepared') return 'Сначала подготовьте отчёт МВД.';
      return null;
    },
    warnings: () => [],
  },
  prepare_checkin_instructions: {
    fieldsOnConfirm: {
      checkinReadinessStatus: 'ready',
      opsStatus: 'checkin_instructions_ready',
    },
    description: 'Подготовьте и отправьте гостю инструкции заезда вручную.',
    messageTemplate: (record) => {
      const name = guestNameLabel(record);
      const property = propertyLabel(record);
      const checkIn = formatRuDate(record.checkInAt, '[дата заезда]');
      const checkOut = formatRuDate(record.checkOutAt, '[дата выезда]');
      return `Здравствуйте, ${name}!

Инструкции по заезду в «${property}»:

Дата заезда: ${checkIn}
Дата выезда: ${checkOut}

Адрес: [укажите адрес объекта]
Как добраться: [укажите маршрут]
Код домофона / ключ: [укажите код или способ получения ключей]
Контакт на месте: [укажите контакт]

Если возникнут вопросы — напишите нам.`;
    },
    internalChecklist: [
      'Проверить адрес и способ доступа в карточке объекта.',
      'Уточнить время заезда с гостем при необходимости.',
      'Заменить заглушки в тексте на реальные данные перед отправкой.',
    ],
    isAllowed: (record) =>
      record.checkinReadinessStatus === 'not_started'
      || record.checkinReadinessStatus === 'in_progress',
    blockedReason: (record) => {
      if (record.checkinReadinessStatus === 'ready') return 'Инструкции заезда уже готовы.';
      if (record.checkinReadinessStatus === 'problem') return 'Статус инструкций — проблема.';
      return null;
    },
    warnings: (record) => propertyDataWarnings(record),
  },
  mark_ready_for_checkin: {
    fieldsOnConfirm: { opsStatus: 'ready_for_checkin' },
    description: 'Отметьте бронь готовой к заезду после выполнения всех обязательных шагов.',
    messageTemplate: null,
    internalChecklist: [
      'Документы проверены.',
      'Договор подписан.',
      'Депозит подтверждён.',
      'МВД (если требуется) — отправлено.',
      'Инструкции заезда подготовлены и отправлены гостю.',
    ],
    isAllowed: (record) =>
      record.checkinReadinessStatus === 'ready'
      && record.opsStatus !== 'ready_for_checkin'
      && getReadyForCheckinBlockers(record).length === 0,
    blockedReason: (record) => {
      if (record.opsStatus === 'ready_for_checkin') return 'Бронь уже отмечена готовой к заезду.';
      const blockers = getReadyForCheckinBlockers(record);
      if (blockers.length > 0) return blockers.join(' ');
      return null;
    },
    warnings: () => [],
  },
};

function buildTemplateForAction(
  record: BookingOpsRecord,
  actionId: BookingOpsOperatorActionId,
): BookingOpsActionTemplate {
  const spec = ACTION_SPECS[actionId];
  const globalBlock = baseBlockedReason(record);
  const actionBlock = spec.blockedReason(record);
  const blockedReason = globalBlock ?? actionBlock;
  const isAllowed = !blockedReason && spec.isAllowed(record);

  return {
    actionId,
    title: BOOKING_OPS_NEXT_ACTION_LABELS_RU[actionId],
    description: spec.description,
    messageTemplate: spec.messageTemplate ? spec.messageTemplate(record) : null,
    internalChecklist: spec.internalChecklist,
    warnings: spec.warnings(record),
    isAllowed,
    blockedReason: blockedReason ?? (isAllowed ? null : actionBlock ?? 'Действие недоступно в текущем состоянии.'),
    fieldsOnConfirm: spec.fieldsOnConfirm,
  };
}

export function getBookingOpsActionTemplate(
  record: BookingOpsRecord,
): BookingOpsActionTemplate | null {
  const automation = record.automation ?? evaluateBookingOpsAutomation(record);
  const nextAction = automation.nextAction;

  if (!isOperatorAction(nextAction)) return null;
  return buildTemplateForAction(record, nextAction);
}

export function getBookingOpsActionTemplateById(
  record: BookingOpsRecord,
  actionId: BookingOpsOperatorActionId,
): BookingOpsActionTemplate {
  return buildTemplateForAction(record, actionId);
}

function validateConfirmPatch(
  record: BookingOpsRecord,
  fields: BookingOpsActionFieldsOnConfirm,
): string | null {
  if (fields.documentsStatus) {
    if (wouldDowngradeRank(record.documentsStatus, fields.documentsStatus, DOCUMENTS_RANK)) {
      return 'Нельзя понизить статус документов.';
    }
    if (record.documentsStatus === 'problem') return 'Статус документов — проблема.';
  }
  if (fields.contractStatus) {
    if (wouldDowngradeRank(record.contractStatus, fields.contractStatus, CONTRACT_RANK)) {
      return 'Нельзя понизить статус договора.';
    }
    if (record.contractStatus === 'problem') return 'Статус договора — проблема.';
  }
  if (fields.depositStatus) {
    if (wouldDowngradeRank(record.depositStatus, fields.depositStatus, DEPOSIT_RANK)) {
      return 'Нельзя понизить статус депозита.';
    }
    if (record.depositStatus === 'problem') return 'Статус депозита — проблема.';
  }
  if (fields.mvdStatus) {
    if (wouldDowngradeRank(record.mvdStatus, fields.mvdStatus, MVD_RANK)) {
      return 'Нельзя понизить статус МВД.';
    }
    if (record.mvdStatus === 'problem') return 'Статус МВД — проблема.';
  }
  if (fields.checkinReadinessStatus) {
    if (
      wouldDowngradeRank(
        record.checkinReadinessStatus,
        fields.checkinReadinessStatus,
        CHECKIN_READINESS_RANK,
      )
    ) {
      return 'Нельзя понизить готовность к заезду.';
    }
    if (record.checkinReadinessStatus === 'problem') return 'Статус инструкций — проблема.';
  }
  if (fields.opsStatus && wouldDowngradeOpsStatus(record.opsStatus, fields.opsStatus)) {
    return 'Нельзя понизить общий статус операций.';
  }
  return null;
}

function buildConfirmUpdateInput(
  record: BookingOpsRecord,
  actionId: BookingOpsOperatorActionId,
): { input: UpdateBookingOpsInput } | { error: string } {
  const template = getBookingOpsActionTemplateById(record, actionId);
  if (!template.isAllowed) {
    return { error: template.blockedReason ?? 'Действие недоступно.' };
  }

  const automation = record.automation ?? evaluateBookingOpsAutomation(record);
  if (automation.nextAction !== actionId) {
    return {
      error: `Сейчас ожидается другое действие: ${BOOKING_OPS_NEXT_ACTION_LABELS_RU[automation.nextAction]}.`,
    };
  }

  const fields = { ...template.fieldsOnConfirm };
  const expectedOps = opsStatusForNextAction(actionId);
  if (expectedOps && !fields.opsStatus) {
    fields.opsStatus = expectedOps;
  }

  const downgradeError = validateConfirmPatch(record, fields);
  if (downgradeError) return { error: downgradeError };

  const input: UpdateBookingOpsInput = {};
  if (fields.documentsStatus) input.documentsStatus = fields.documentsStatus;
  if (fields.contractStatus) input.contractStatus = fields.contractStatus;
  if (fields.depositStatus) input.depositStatus = fields.depositStatus;
  if (fields.mvdStatus) input.mvdStatus = fields.mvdStatus;
  if (fields.checkinReadinessStatus) {
    input.checkinReadinessStatus = fields.checkinReadinessStatus;
  }
  if (fields.opsStatus) input.opsStatus = fields.opsStatus;

  return { input };
}

export function planBookingOpsOperatorActionConfirm(
  record: BookingOpsRecord,
  actionId: BookingOpsOperatorActionId,
): { input: UpdateBookingOpsInput } | { error: string } {
  return buildConfirmUpdateInput(record, actionId);
}

export async function applyBookingOpsOperatorAction(
  recordId: string,
  actionId: string,
): Promise<{ ok: true; record: BookingOpsRecord } | { ok: false; error: string }> {
  const id = String(recordId ?? '').trim();
  if (!id) return { ok: false, error: 'id_required' };

  const rawAction = String(actionId ?? '').trim();
  if (!(BOOKING_OPS_OPERATOR_ACTIONS as readonly string[]).includes(rawAction)) {
    return { ok: false, error: 'Недопустимое действие.' };
  }
  const operatorActionId = rawAction as BookingOpsOperatorActionId;

  const record = await getBookingOpsRecord(id);
  if (!record) return { ok: false, error: 'not_found' };

  const built = buildConfirmUpdateInput(record, operatorActionId);
  if ('error' in built) return { ok: false, error: built.error };

  const merged: BookingOpsRecord = {
    ...record,
    ...built.input,
    opsStatus: built.input.opsStatus ?? record.opsStatus,
    documentsStatus: built.input.documentsStatus ?? record.documentsStatus,
    contractStatus: built.input.contractStatus ?? record.contractStatus,
    depositStatus: built.input.depositStatus ?? record.depositStatus,
    mvdStatus: built.input.mvdStatus ?? record.mvdStatus,
    checkinReadinessStatus: built.input.checkinReadinessStatus ?? record.checkinReadinessStatus,
  };

  const automationPatch = buildBookingOpsAutomationPatch(merged);
  const finalInput: UpdateBookingOpsInput = { ...built.input };
  if (automationPatch.manualNextAction !== undefined) {
    finalInput.manualNextAction = automationPatch.manualNextAction;
  }
  if (
    automationPatch.opsStatus
    && !finalInput.opsStatus
    && !wouldDowngradeOpsStatus(record.opsStatus, automationPatch.opsStatus)
  ) {
    finalInput.opsStatus = automationPatch.opsStatus;
  }

  const result = await updateBookingOpsRecord(id, finalInput);
  if (!result.ok || !result.record) {
    return { ok: false, error: result.error ?? 'Не удалось сохранить изменения.' };
  }

  return { ok: true, record: result.record };
}

export function attachBookingOpsOperatorAction(record: BookingOpsRecord): BookingOpsRecord {
  return { ...record, operatorAction: getBookingOpsActionTemplate(record) };
}
