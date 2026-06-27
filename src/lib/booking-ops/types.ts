export const BOOKING_OPS_STATUSES = [
  'created',
  'guest_contact_known',
  'documents_requested',
  'documents_received',
  'contract_prepared',
  'contract_sent',
  'contract_signed',
  'deposit_requested',
  'deposit_confirmed',
  'mvd_required',
  'mvd_prepared',
  'mvd_submitted',
  'checkin_instructions_ready',
  'ready_for_checkin',
  'problem_blocked',
] as const;

export type BookingOpsStatus = (typeof BOOKING_OPS_STATUSES)[number];

export const BOOKING_OPS_STATUS_LABELS_RU: Record<BookingOpsStatus, string> = {
  created: 'Бронь создана',
  guest_contact_known: 'Контакт гостя известен',
  documents_requested: 'Документы запрошены',
  documents_received: 'Документы получены',
  contract_prepared: 'Договор подготовлен',
  contract_sent: 'Договор отправлен',
  contract_signed: 'Договор подписан',
  deposit_requested: 'Депозит запрошен',
  deposit_confirmed: 'Депозит подтверждён',
  mvd_required: 'Нужна регистрация МВД',
  mvd_prepared: 'Отчёт МВД подготовлен',
  mvd_submitted: 'Отчёт МВД отправлен',
  checkin_instructions_ready: 'Инструкции заезда готовы',
  ready_for_checkin: 'Готово к заезду',
  problem_blocked: 'Проблема / блокировка',
};

export const BOOKING_OPS_DOCUMENTS_STATUSES = [
  'not_started',
  'requested',
  'received',
  'verified',
  'problem',
] as const;

export type BookingOpsDocumentsStatus = (typeof BOOKING_OPS_DOCUMENTS_STATUSES)[number];

export const BOOKING_OPS_DOCUMENTS_STATUS_LABELS_RU: Record<BookingOpsDocumentsStatus, string> = {
  not_started: 'Не начато',
  requested: 'Запрошено',
  received: 'Получено',
  verified: 'Проверено',
  problem: 'Проблема',
};

export const BOOKING_OPS_CONTRACT_STATUSES = [
  'not_started',
  'prepared',
  'sent',
  'signed',
  'problem',
] as const;

export type BookingOpsContractStatus = (typeof BOOKING_OPS_CONTRACT_STATUSES)[number];

export const BOOKING_OPS_CONTRACT_STATUS_LABELS_RU: Record<BookingOpsContractStatus, string> = {
  not_started: 'Не начато',
  prepared: 'Подготовлен',
  sent: 'Отправлен',
  signed: 'Подписан',
  problem: 'Проблема',
};

export const BOOKING_OPS_DEPOSIT_STATUSES = [
  'not_started',
  'requested',
  'confirmed',
  'problem',
] as const;

export type BookingOpsDepositStatus = (typeof BOOKING_OPS_DEPOSIT_STATUSES)[number];

export const BOOKING_OPS_DEPOSIT_STATUS_LABELS_RU: Record<BookingOpsDepositStatus, string> = {
  not_started: 'Не начато',
  requested: 'Запрошен',
  confirmed: 'Подтверждён',
  problem: 'Проблема',
};

export const BOOKING_OPS_MVD_STATUSES = [
  'not_required',
  'required',
  'prepared',
  'submitted',
  'problem',
] as const;

export type BookingOpsMvdStatus = (typeof BOOKING_OPS_MVD_STATUSES)[number];

export const BOOKING_OPS_MVD_STATUS_LABELS_RU: Record<BookingOpsMvdStatus, string> = {
  not_required: 'Не требуется',
  required: 'Требуется',
  prepared: 'Подготовлен',
  submitted: 'Отправлен',
  problem: 'Проблема',
};

export const BOOKING_OPS_CHECKIN_READINESS_STATUSES = [
  'not_started',
  'in_progress',
  'ready',
  'problem',
] as const;

export type BookingOpsCheckinReadinessStatus =
  (typeof BOOKING_OPS_CHECKIN_READINESS_STATUSES)[number];

export const BOOKING_OPS_CHECKIN_READINESS_STATUS_LABELS_RU: Record<
  BookingOpsCheckinReadinessStatus,
  string
> = {
  not_started: 'Не начато',
  in_progress: 'В работе',
  ready: 'Готово',
  problem: 'Проблема',
};

export const BOOKING_OPS_NEXT_ACTIONS = [
  'request_guest_documents',
  'verify_guest_documents',
  'prepare_contract',
  'send_contract',
  'confirm_contract_signed',
  'request_deposit',
  'confirm_deposit',
  'prepare_mvd_report',
  'submit_mvd_report',
  'prepare_checkin_instructions',
  'mark_ready_for_checkin',
  'needs_operator_attention',
  'blocked',
  'pause',
] as const;

export type BookingOpsNextAction = (typeof BOOKING_OPS_NEXT_ACTIONS)[number];

export const BOOKING_OPS_NEXT_ACTION_LABELS_RU: Record<BookingOpsNextAction, string> = {
  request_guest_documents: 'Запросить документы гостя',
  verify_guest_documents: 'Проверить документы гостя',
  prepare_contract: 'Подготовить договор',
  send_contract: 'Отправить договор',
  confirm_contract_signed: 'Подтвердить подписание договора',
  request_deposit: 'Запросить депозит',
  confirm_deposit: 'Подтвердить депозит',
  prepare_mvd_report: 'Подготовить отчёт МВД',
  submit_mvd_report: 'Отправить отчёт МВД',
  prepare_checkin_instructions: 'Подготовить инструкции заезда',
  mark_ready_for_checkin: 'Отметить готовность к заезду',
  needs_operator_attention: 'Нужна проверка оператора',
  blocked: 'Заблокировано',
  pause: 'Пауза',
};

export type BookingOpsAutomationState =
  | 'action_required'
  | 'waiting'
  | 'automatic_action_available'
  | 'needs_operator_attention'
  | 'manual_override'
  | 'blocked'
  | 'completed'
  | 'paused';

export type BookingOpsAutomationDecision = {
  nextAction: BookingOpsNextAction;
  automationState: BookingOpsAutomationState;
  needsOperatorAction: boolean;
  canAutoPerform: boolean;
  recommendedOpsStatus: BookingOpsStatus | null;
  blockers: string[];
  reason: string;
  evaluatedAt: string;
};

export type BookingOpsAlertSeverity = 'info' | 'warning' | 'critical';

export type BookingOpsAlertKind =
  | 'guest_contact_missing'
  | 'documents_not_requested'
  | 'documents_not_received'
  | 'contract_incomplete'
  | 'deposit_incomplete'
  | 'mvd_not_submitted'
  | 'checkin_instructions_not_ready'
  | 'booking_blocked'
  | 'checkin_approaching_incomplete';

export type BookingOpsAlert = {
  bookingOpsId: string;
  sourceBookingId: string | null;
  kind: BookingOpsAlertKind;
  title: string;
  reason: string;
  severity: BookingOpsAlertSeverity;
  /** v1 computed-only — always open; no resolve/ignore persistence. */
  status: 'open';
  dueAt: string | null;
  relatedNextAction: BookingOpsNextAction | null;
};

export type BookingOpsAlertSummary = {
  alerts: BookingOpsAlert[];
  primaryAlert: BookingOpsAlert | null;
  maxSeverity: BookingOpsAlertSeverity | null;
};

/** Operator-confirmable workflow actions (excludes blocked/pause/attention). */
export const BOOKING_OPS_OPERATOR_ACTIONS = [
  'request_guest_documents',
  'verify_guest_documents',
  'prepare_contract',
  'send_contract',
  'confirm_contract_signed',
  'request_deposit',
  'confirm_deposit',
  'prepare_mvd_report',
  'submit_mvd_report',
  'prepare_checkin_instructions',
  'mark_ready_for_checkin',
] as const;

export type BookingOpsOperatorActionId = (typeof BOOKING_OPS_OPERATOR_ACTIONS)[number];

export type BookingOpsActionFieldsOnConfirm = {
  documentsStatus?: BookingOpsDocumentsStatus;
  contractStatus?: BookingOpsContractStatus;
  depositStatus?: BookingOpsDepositStatus;
  mvdStatus?: BookingOpsMvdStatus;
  checkinReadinessStatus?: BookingOpsCheckinReadinessStatus;
  opsStatus?: BookingOpsStatus;
};

export type BookingOpsActionTemplate = {
  actionId: BookingOpsOperatorActionId;
  title: string;
  description: string;
  /** Guest-facing copy-ready text; null for internal-only actions. */
  messageTemplate: string | null;
  /** Operator-facing steps; empty for guest-message-only actions. */
  internalChecklist: string[];
  warnings: string[];
  isAllowed: boolean;
  blockedReason: string | null;
  fieldsOnConfirm: BookingOpsActionFieldsOnConfirm;
};

export type BookingOpsRecord = {
  id: string;
  bookingId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  guestTelegram: string | null;
  propertyId: string | null;
  propertyLabel: string | null;
  otaSource: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  opsStatus: BookingOpsStatus;
  manualNextAction: string | null;
  isBlocked: boolean;
  blockerReason: string | null;
  documentsStatus: BookingOpsDocumentsStatus;
  contractStatus: BookingOpsContractStatus;
  depositStatus: BookingOpsDepositStatus;
  mvdStatus: BookingOpsMvdStatus;
  checkinReadinessStatus: BookingOpsCheckinReadinessStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  automation?: BookingOpsAutomationDecision;
  alerts?: BookingOpsAlertSummary;
  operatorAction?: BookingOpsActionTemplate | null;
};

export type CreateBookingOpsInput = {
  bookingId?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestTelegram?: string | null;
  propertyId?: string | null;
  propertyLabel?: string | null;
  otaSource?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  opsStatus?: BookingOpsStatus;
  documentsStatus?: BookingOpsDocumentsStatus;
  contractStatus?: BookingOpsContractStatus;
  depositStatus?: BookingOpsDepositStatus;
  mvdStatus?: BookingOpsMvdStatus;
  checkinReadinessStatus?: BookingOpsCheckinReadinessStatus;
  notes?: string | null;
};

export type UpdateBookingOpsInput = Partial<
  Omit<CreateBookingOpsInput, never>
> & {
  manualNextAction?: string | null;
  isBlocked?: boolean;
  blockerReason?: string | null;
  opsStatus?: BookingOpsStatus;
};

function includesValue<T extends string>(values: readonly T[], raw: string): raw is T {
  return (values as readonly string[]).includes(raw);
}

export function normalizeBookingOpsStatus(value: unknown): BookingOpsStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_STATUSES, raw)) return raw;
  return 'created';
}

export function normalizeBookingOpsDocumentsStatus(value: unknown): BookingOpsDocumentsStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_DOCUMENTS_STATUSES, raw)) return raw;
  return 'not_started';
}

export function normalizeBookingOpsContractStatus(value: unknown): BookingOpsContractStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_CONTRACT_STATUSES, raw)) return raw;
  return 'not_started';
}

export function normalizeBookingOpsDepositStatus(value: unknown): BookingOpsDepositStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_DEPOSIT_STATUSES, raw)) return raw;
  return 'not_started';
}

export function normalizeBookingOpsMvdStatus(value: unknown): BookingOpsMvdStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_MVD_STATUSES, raw)) return raw;
  return 'not_required';
}

export function normalizeBookingOpsCheckinReadinessStatus(
  value: unknown,
): BookingOpsCheckinReadinessStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_CHECKIN_READINESS_STATUSES, raw)) return raw;
  return 'not_started';
}

export function hasGuestContact(
  record: Pick<BookingOpsRecord, 'guestPhone' | 'guestEmail' | 'guestTelegram'>,
): boolean {
  return Boolean(
    String(record.guestPhone ?? '').trim()
      || String(record.guestEmail ?? '').trim()
      || String(record.guestTelegram ?? '').trim(),
  );
}

export function bookingOpsHasProblemSignals(
  record: Pick<
    BookingOpsRecord,
    | 'isBlocked'
    | 'documentsStatus'
    | 'contractStatus'
    | 'depositStatus'
    | 'mvdStatus'
    | 'checkinReadinessStatus'
    | 'opsStatus'
  >,
): boolean {
  return (
    record.isBlocked
    || record.opsStatus === 'problem_blocked'
    || record.documentsStatus === 'problem'
    || record.contractStatus === 'problem'
    || record.depositStatus === 'problem'
    || record.mvdStatus === 'problem'
    || record.checkinReadinessStatus === 'problem'
  );
}
