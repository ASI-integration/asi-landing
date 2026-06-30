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

export const BOOKING_OPS_UNIT_READINESS_STATUSES = [
  'not_ready',
  'cleaning_pending',
  'linen_pending',
  'inspection_pending',
  'ready',
  'blocked',
] as const;

export type BookingOpsUnitReadinessStatus = (typeof BOOKING_OPS_UNIT_READINESS_STATUSES)[number];

export const BOOKING_OPS_UNIT_READINESS_STATUS_LABELS_RU: Record<
  BookingOpsUnitReadinessStatus,
  string
> = {
  not_ready: 'Не готов',
  cleaning_pending: 'Ожидает уборку',
  linen_pending: 'Ожидает бельё',
  inspection_pending: 'Ожидает осмотр',
  ready: 'Готов к заезду',
  blocked: 'Заблокирован',
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

export const BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS = [
  'request_guest_documents',
  'send_contract',
  'request_deposit',
  'prepare_checkin_instructions',
] as const;

export type BookingOpsTelegramDraftActionId =
  (typeof BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS)[number];

export const BOOKING_OPS_TELEGRAM_DRAFT_STATUSES = [
  'draft',
  'copied',
  'sent_manually',
  'cancelled',
  'failed',
] as const;

export type BookingOpsTelegramDraftStatus =
  (typeof BOOKING_OPS_TELEGRAM_DRAFT_STATUSES)[number];

export const BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU: Record<
  BookingOpsTelegramDraftStatus,
  string
> = {
  draft: 'Черновик',
  copied: 'Скопирован',
  sent_manually: 'Отправлен вручную',
  cancelled: 'Отменён',
  failed: 'Ошибка',
};

export const BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES = [
  'missing',
  'uploaded',
  'verified',
  'rejected',
] as const;

export type BookingOpsDocumentVerificationStatus =
  (typeof BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES)[number];

export const BOOKING_OPS_DOCUMENT_VERIFICATION_STATUS_LABELS_RU: Record<
  BookingOpsDocumentVerificationStatus,
  string
> = {
  missing: 'Нет',
  uploaded: 'Загружено',
  verified: 'Проверено',
  rejected: 'Отклонено',
};

export const BOOKING_OPS_CONTRACT_PROVIDERS = ['manual', 'okidoki', 'none'] as const;

export type BookingOpsContractProvider = (typeof BOOKING_OPS_CONTRACT_PROVIDERS)[number];

export const BOOKING_OPS_CONTRACT_PROVIDER_LABELS_RU: Record<BookingOpsContractProvider, string> = {
  manual: 'Вручную',
  okidoki: 'Okidoki',
  none: 'Не нужен',
};

export const BOOKING_OPS_CONTRACT_INTAKE_STATUSES = [
  'not_required',
  'missing',
  'prepared',
  'sent',
  'signed',
] as const;

export type BookingOpsContractIntakeStatus =
  (typeof BOOKING_OPS_CONTRACT_INTAKE_STATUSES)[number];

export const BOOKING_OPS_CONTRACT_INTAKE_STATUS_LABELS_RU: Record<
  BookingOpsContractIntakeStatus,
  string
> = {
  not_required: 'Не требуется',
  missing: 'Нет',
  prepared: 'Подготовлен',
  sent: 'Отправлен',
  signed: 'Подписан',
};

export const BOOKING_OPS_DEPOSIT_INTAKE_STATUSES = [
  'not_required',
  'missing',
  'requested',
  'received',
  'held',
  'returned',
  'issue',
] as const;

export type BookingOpsDepositIntakeStatus =
  (typeof BOOKING_OPS_DEPOSIT_INTAKE_STATUSES)[number];

export const BOOKING_OPS_DEPOSIT_INTAKE_STATUS_LABELS_RU: Record<
  BookingOpsDepositIntakeStatus,
  string
> = {
  not_required: 'Не требуется',
  missing: 'Нет',
  requested: 'Запрошен',
  received: 'Получен',
  held: 'Удержан',
  returned: 'Возвращён',
  issue: 'Проблема',
};

export const BOOKING_OPS_MVD_DATA_STATUSES = [
  'not_required',
  'missing',
  'collected',
  'prepared',
  'submitted',
  'confirmed',
] as const;

export type BookingOpsMvdDataStatus = (typeof BOOKING_OPS_MVD_DATA_STATUSES)[number];

export const BOOKING_OPS_MVD_DATA_STATUS_LABELS_RU: Record<BookingOpsMvdDataStatus, string> = {
  not_required: 'Не требуется',
  missing: 'Нет данных',
  collected: 'Собрано',
  prepared: 'Подготовлено',
  submitted: 'Отправлено',
  confirmed: 'Подтверждено',
};

export type BookingOpsTelegramDraft = {
  id: string;
  bookingOpsRecordId: string;
  sourceBookingId: string | null;
  telegramChatId: string | null;
  telegramTarget: string | null;
  actionId: BookingOpsTelegramDraftActionId;
  messageText: string;
  status: BookingOpsTelegramDraftStatus;
  createdBy: string | null;
  warning: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export const BOOKING_OPS_COMMUNICATION_ACTOR_TYPES = [
  'guest',
  'cleaner',
  'laundry',
  'master',
  'admin',
  'owner',
] as const;

export type BookingOpsCommunicationActorType =
  (typeof BOOKING_OPS_COMMUNICATION_ACTOR_TYPES)[number];

export const BOOKING_OPS_COMMUNICATION_PURPOSES = [
  'request_guest_documents',
  'request_contract_confirmation',
  'request_deposit_payment',
  'request_mvd_data',
  'send_checkin_instructions',
  'remind_guest_before_checkin',
  'checkout_reminder',
  'cleaning_assignment',
  'cleaning_reminder',
  'inspection_request',
  'issue_followup',
  'checkin_instructions',
  'arrival_confirmation_request',
  'access_issue_followup',
  'linen_pickup_request',
  'linen_delivery_request',
  'linen_status_check',
  'maintenance_request',
  'repair_status_check',
  'preparation_blocked_notice',
  'readiness_confirmation_needed',
  'guest_data_missing_notice',
  'unit_ready_notice',
  'issue_escalation_notice',
] as const;

export type BookingOpsCommunicationPurpose =
  (typeof BOOKING_OPS_COMMUNICATION_PURPOSES)[number];

export const BOOKING_OPS_COMMUNICATION_CHANNELS = [
  'telegram',
  'email',
  'phone',
  'internal',
  'manual',
] as const;

export type BookingOpsCommunicationChannel =
  (typeof BOOKING_OPS_COMMUNICATION_CHANNELS)[number];

export const BOOKING_OPS_COMMUNICATION_STATUSES = [
  'draft_ready',
  'waiting_for_external_input',
  'completed',
  'superseded',
  'cancelled',
] as const;

export type BookingOpsCommunicationStatus =
  (typeof BOOKING_OPS_COMMUNICATION_STATUSES)[number];

export const BOOKING_OPS_COMMUNICATION_STATUS_LABELS_RU: Record<
  BookingOpsCommunicationStatus,
  string
> = {
  draft_ready: 'Черновик готов',
  waiting_for_external_input: 'Ждём ответ',
  completed: 'Завершено',
  superseded: 'Заменено',
  cancelled: 'Отменено',
};

export const BOOKING_OPS_COMMUNICATION_ACTOR_LABELS_RU: Record<
  BookingOpsCommunicationActorType,
  string
> = {
  guest: 'Гость',
  cleaner: 'Уборка',
  laundry: 'Прачечная',
  master: 'Мастер',
  admin: 'Оператор',
  owner: 'Собственник',
};

export type BookingOpsCommunicationIntent = {
  id: string;
  bookingOpsRecordId: string;
  bookingId: string | null;
  relatedTaskId: string | null;
  actorType: BookingOpsCommunicationActorType;
  actorLabel: string | null;
  purpose: BookingOpsCommunicationPurpose;
  channel: BookingOpsCommunicationChannel;
  status: BookingOpsCommunicationStatus;
  messageText: string;
  messageTemplateKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  supersededAt: string | null;
};

export const BOOKING_OPS_GUEST_INTAKE_STATUSES = [
  'not_started',
  'waiting_for_guest',
  'partially_completed',
  'validation_needed',
  'completed',
  'fallback_required',
  'expired',
] as const;

export type BookingOpsGuestIntakeStatus =
  (typeof BOOKING_OPS_GUEST_INTAKE_STATUSES)[number];

export const BOOKING_OPS_GUEST_INTAKE_STATUS_LABELS_RU: Record<
  BookingOpsGuestIntakeStatus,
  string
> = {
  not_started: 'Не начато',
  waiting_for_guest: 'Ждём гостя',
  partially_completed: 'Частично заполнено',
  validation_needed: 'Нужна проверка',
  completed: 'Готово',
  fallback_required: 'Нужна ручная помощь',
  expired: 'Просрочено',
};

export type BookingOpsGuestIntakeSession = {
  id: string;
  bookingOpsRecordId: string;
  bookingId: string | null;
  intakeStatus: BookingOpsGuestIntakeStatus;
  missingFields: string[];
  collectedFields: Record<string, unknown>;
  validationErrors: string[];
  channel: 'telegram' | 'web' | 'manual';
  guestContactRef: string | null;
  lastGuestActivityAt: string | null;
  fallbackReason: string | null;
  generatedMessage: string | null;
  publicToken: string | null;
  publicIntakeUrl: string | null;
  tokenCreatedAt: string | null;
  tokenOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export type PropertyKnowledgeMatch = 'property_id' | 'property_label' | 'none' | 'ambiguous' | 'error';

export type BookingOpsPropertyKnowledge = {
  propertyId: string;
  propertyLabel: string | null;
  address: string | null;
  entranceInstructions: string | null;
  floorApartment: string | null;
  intercomCode: string | null;
  keyPickupInstructions: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  parkingInstructions: string | null;
  houseRules: string | null;
  quietHours: string | null;
  checkoutInstructions: string | null;
  emergencyInstructions: string | null;
  cleaningLinenNotes: string | null;
  publicGuestNotes: string | null;
  privateOperatorNotes: string | null;
  updatedAt: string | null;
};

export type BookingOpsIntakeFields = {
  guestCount?: number | null;
  paymentStatus?: string | null;
  documentRequired?: boolean | null;
  documentCollected?: boolean | null;
  documentVerificationStatus?: BookingOpsDocumentVerificationStatus | null;
  documentNotes?: string | null;
  contractRequired?: boolean | null;
  contractProvider?: BookingOpsContractProvider | null;
  contractIntakeStatus?: BookingOpsContractIntakeStatus | null;
  contractLink?: string | null;
  contractNotes?: string | null;
  depositRequired?: boolean | null;
  depositAmount?: number | null;
  depositIntakeStatus?: BookingOpsDepositIntakeStatus | null;
  depositPaymentMethod?: string | null;
  depositNotes?: string | null;
  mvdRequired?: boolean | null;
  mvdDataStatus?: BookingOpsMvdDataStatus | null;
  mvdConfirmationLink?: string | null;
  mvdNotes?: string | null;
};

export const DEFAULT_BOOKING_OPS_INTAKE: Required<{
  [K in keyof BookingOpsIntakeFields]: NonNullable<BookingOpsIntakeFields[K]> | null;
}> = {
  guestCount: null,
  paymentStatus: null,
  documentRequired: null,
  documentCollected: null,
  documentVerificationStatus: null,
  documentNotes: null,
  contractRequired: null,
  contractProvider: null,
  contractIntakeStatus: null,
  contractLink: null,
  contractNotes: null,
  depositRequired: null,
  depositAmount: null,
  depositIntakeStatus: null,
  depositPaymentMethod: null,
  depositNotes: null,
  mvdRequired: null,
  mvdDataStatus: null,
  mvdConfirmationLink: null,
  mvdNotes: null,
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
  unitReadinessStatus: BookingOpsUnitReadinessStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
} & BookingOpsIntakeFields & {
  propertyKnowledge?: BookingOpsPropertyKnowledge | null;
  propertyKnowledgeMatch?: PropertyKnowledgeMatch;
  automation?: BookingOpsAutomationDecision;
  alerts?: BookingOpsAlertSummary;
  operatorAction?: BookingOpsActionTemplate | null;
  readiness?: import('./readiness').BookingReadinessResult;
  guestIntake?: BookingOpsGuestIntakeSession | null;
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
  unitReadinessStatus?: BookingOpsUnitReadinessStatus;
  notes?: string | null;
} & Partial<BookingOpsIntakeFields>;

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

export function normalizeBookingOpsUnitReadinessStatus(
  value: unknown,
): BookingOpsUnitReadinessStatus {
  const raw = String(value ?? '').trim();
  if (includesValue(BOOKING_OPS_UNIT_READINESS_STATUSES, raw)) return raw;
  return 'not_ready';
}

export function normalizeBookingOpsDocumentVerificationStatus(
  value: unknown,
): BookingOpsDocumentVerificationStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (includesValue(BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES, raw)) return raw;
  return null;
}

export function normalizeBookingOpsContractProvider(
  value: unknown,
): BookingOpsContractProvider | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (includesValue(BOOKING_OPS_CONTRACT_PROVIDERS, raw)) return raw;
  return null;
}

export function normalizeBookingOpsContractIntakeStatus(
  value: unknown,
): BookingOpsContractIntakeStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (includesValue(BOOKING_OPS_CONTRACT_INTAKE_STATUSES, raw)) return raw;
  return null;
}

export function normalizeBookingOpsDepositIntakeStatus(
  value: unknown,
): BookingOpsDepositIntakeStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (includesValue(BOOKING_OPS_DEPOSIT_INTAKE_STATUSES, raw)) return raw;
  return null;
}

export function normalizeBookingOpsMvdDataStatus(value: unknown): BookingOpsMvdDataStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (includesValue(BOOKING_OPS_MVD_DATA_STATUSES, raw)) return raw;
  return null;
}

function parseNullableBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function parseNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBookingOpsIntakeFields(
  body: Record<string, unknown>,
): Partial<BookingOpsIntakeFields> {
  const input: Partial<BookingOpsIntakeFields> = {};

  if ('guestCount' in body || 'guest_count' in body) {
    input.guestCount = parseNullableNumber(body.guestCount ?? body.guest_count) ?? null;
  }
  if ('paymentStatus' in body || 'payment_status' in body) {
    const raw = String(body.paymentStatus ?? body.payment_status ?? '').trim();
    input.paymentStatus = raw || null;
  }
  if ('documentRequired' in body || 'document_required' in body) {
    input.documentRequired = parseNullableBoolean(body.documentRequired ?? body.document_required) ?? null;
  }
  if ('documentCollected' in body || 'document_collected' in body) {
    input.documentCollected = parseNullableBoolean(body.documentCollected ?? body.document_collected) ?? null;
  }
  if ('documentVerificationStatus' in body || 'document_verification_status' in body) {
    input.documentVerificationStatus = normalizeBookingOpsDocumentVerificationStatus(
      body.documentVerificationStatus ?? body.document_verification_status,
    );
  }
  if ('documentNotes' in body || 'document_notes' in body) {
    const raw = String(body.documentNotes ?? body.document_notes ?? '').trim();
    input.documentNotes = raw || null;
  }
  if ('contractRequired' in body || 'contract_required' in body) {
    input.contractRequired = parseNullableBoolean(body.contractRequired ?? body.contract_required) ?? null;
  }
  if ('contractProvider' in body || 'contract_provider' in body) {
    input.contractProvider = normalizeBookingOpsContractProvider(
      body.contractProvider ?? body.contract_provider,
    );
  }
  if ('contractIntakeStatus' in body || 'contract_intake_status' in body) {
    input.contractIntakeStatus = normalizeBookingOpsContractIntakeStatus(
      body.contractIntakeStatus ?? body.contract_intake_status,
    );
  }
  if ('contractLink' in body || 'contract_link' in body) {
    const raw = String(body.contractLink ?? body.contract_link ?? '').trim();
    input.contractLink = raw || null;
  }
  if ('contractNotes' in body || 'contract_notes' in body) {
    const raw = String(body.contractNotes ?? body.contract_notes ?? '').trim();
    input.contractNotes = raw || null;
  }
  if ('depositRequired' in body || 'deposit_required' in body) {
    input.depositRequired = parseNullableBoolean(body.depositRequired ?? body.deposit_required) ?? null;
  }
  if ('depositAmount' in body || 'deposit_amount' in body) {
    input.depositAmount = parseNullableNumber(body.depositAmount ?? body.deposit_amount) ?? null;
  }
  if ('depositIntakeStatus' in body || 'deposit_intake_status' in body) {
    input.depositIntakeStatus = normalizeBookingOpsDepositIntakeStatus(
      body.depositIntakeStatus ?? body.deposit_intake_status,
    );
  }
  if ('depositPaymentMethod' in body || 'deposit_payment_method' in body) {
    const raw = String(body.depositPaymentMethod ?? body.deposit_payment_method ?? '').trim();
    input.depositPaymentMethod = raw || null;
  }
  if ('depositNotes' in body || 'deposit_notes' in body) {
    const raw = String(body.depositNotes ?? body.deposit_notes ?? '').trim();
    input.depositNotes = raw || null;
  }
  if ('mvdRequired' in body || 'mvd_required' in body) {
    input.mvdRequired = parseNullableBoolean(body.mvdRequired ?? body.mvd_required) ?? null;
  }
  if ('mvdDataStatus' in body || 'mvd_data_status' in body) {
    input.mvdDataStatus = normalizeBookingOpsMvdDataStatus(
      body.mvdDataStatus ?? body.mvd_data_status,
    );
  }
  if ('mvdConfirmationLink' in body || 'mvd_confirmation_link' in body) {
    const raw = String(body.mvdConfirmationLink ?? body.mvd_confirmation_link ?? '').trim();
    input.mvdConfirmationLink = raw || null;
  }
  if ('mvdNotes' in body || 'mvd_notes' in body) {
    const raw = String(body.mvdNotes ?? body.mvd_notes ?? '').trim();
    input.mvdNotes = raw || null;
  }

  return input;
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
