import type {
  BookingOpsContractStatus,
  BookingOpsDepositStatus,
  BookingOpsDocumentsStatus,
  BookingOpsMvdStatus,
  BookingOpsRecord,
  BookingOpsTelegramDraft,
  BookingOpsTelegramDraftActionId,
  BookingOpsTelegramDraftStatus,
} from './types';
import { supabase } from '@/lib/supabase';

export const BOOKING_READINESS_STATUSES = [
  'missing_booking_data',
  'missing_documents',
  'missing_contract',
  'missing_deposit',
  'missing_mvd_data',
  'ready_for_drafts',
  'drafts_created',
  'ready_for_manual_send',
  'completed',
] as const;

export type BookingReadinessStatus = (typeof BOOKING_READINESS_STATUSES)[number];

export const BOOKING_READINESS_STATUS_LABELS_RU: Record<BookingReadinessStatus, string> = {
  missing_booking_data: 'Не хватает данных брони',
  missing_documents: 'Нужны документы гостя',
  missing_contract: 'Нужен договор',
  missing_deposit: 'Нужен депозит',
  missing_mvd_data: 'Нужны данные МВД',
  ready_for_drafts: 'Готово к черновикам Telegram',
  drafts_created: 'Черновики созданы',
  ready_for_manual_send: 'Готово к ручной отправке',
  completed: 'Завершено',
};

export const TELEGRAM_DRAFT_READINESS_STATUSES = [
  'not_ready',
  'ready_for_drafts',
  'drafts_created',
  'ready_for_manual_send',
  'completed',
] as const;

export type TelegramDraftReadinessStatus =
  (typeof TELEGRAM_DRAFT_READINESS_STATUSES)[number];

export const TELEGRAM_DRAFT_READINESS_STATUS_LABELS_RU: Record<
  TelegramDraftReadinessStatus,
  string
> = {
  not_ready: 'Не готово',
  ready_for_drafts: 'Можно создать черновики',
  drafts_created: 'Черновики созданы',
  ready_for_manual_send: 'Готово к ручной отправке',
  completed: 'Отправка завершена',
};

export type BookingReadinessChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string | null;
};

export type BookingReadinessChecklistGroup = {
  id: 'booking' | 'documents' | 'contract' | 'deposit' | 'mvd' | 'telegram_drafts';
  title: string;
  items: BookingReadinessChecklistItem[];
};

export type BookingReadinessResult = {
  status: BookingReadinessStatus;
  missingItems: string[];
  canCreateDrafts: boolean;
  canManualSend: boolean;
  checklist: BookingReadinessChecklistGroup[];
  telegramDraftStatus: TelegramDraftReadinessStatus;
};

export type BookingReadinessInput = Pick<
  BookingOpsRecord,
  | 'guestName'
  | 'propertyId'
  | 'propertyLabel'
  | 'checkInAt'
  | 'checkOutAt'
  | 'guestCount'
  | 'otaSource'
  | 'paymentStatus'
  | 'documentRequired'
  | 'documentCollected'
  | 'documentVerificationStatus'
  | 'documentNotes'
  | 'contractRequired'
  | 'contractProvider'
  | 'contractIntakeStatus'
  | 'contractLink'
  | 'contractNotes'
  | 'depositRequired'
  | 'depositAmount'
  | 'depositIntakeStatus'
  | 'depositPaymentMethod'
  | 'depositNotes'
  | 'mvdRequired'
  | 'mvdDataStatus'
  | 'mvdConfirmationLink'
  | 'mvdNotes'
  | 'documentsStatus'
  | 'contractStatus'
  | 'depositStatus'
  | 'mvdStatus'
> & {
  telegramDrafts?: Pick<BookingOpsTelegramDraft, 'status'>[];
};

type EffectiveDocumentVerification = 'missing' | 'uploaded' | 'verified' | 'rejected' | 'undecided';
type EffectiveContractIntake =
  | 'not_required'
  | 'missing'
  | 'prepared'
  | 'sent'
  | 'signed'
  | 'undecided';
type EffectiveDepositIntake =
  | 'not_required'
  | 'missing'
  | 'requested'
  | 'received'
  | 'held'
  | 'returned'
  | 'issue'
  | 'undecided';
type EffectiveMvdData =
  | 'not_required'
  | 'missing'
  | 'collected'
  | 'prepared'
  | 'submitted'
  | 'confirmed'
  | 'undecided';

const DRAFT_READY_STATUSES: BookingOpsTelegramDraftStatus[] = ['draft', 'copied'];
const DRAFT_MANUAL_READY_STATUSES: BookingOpsTelegramDraftStatus[] = [
  'copied',
  'sent_manually',
];

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveDocumentRequired(input: BookingReadinessInput): boolean | null {
  if (input.documentRequired !== null && input.documentRequired !== undefined) {
    return input.documentRequired;
  }
  if (input.documentsStatus !== 'not_started') return true;
  return null;
}

function mapDocumentsStatusToVerification(
  status: BookingOpsDocumentsStatus,
): EffectiveDocumentVerification {
  switch (status) {
    case 'not_started':
    case 'requested':
      return 'missing';
    case 'received':
      return 'uploaded';
    case 'verified':
      return 'verified';
    case 'problem':
      return 'rejected';
    default:
      return 'missing';
  }
}

function resolveDocumentVerification(input: BookingReadinessInput): EffectiveDocumentVerification {
  if (input.documentVerificationStatus) return input.documentVerificationStatus;
  return mapDocumentsStatusToVerification(input.documentsStatus);
}

function resolveDocumentCollected(input: BookingReadinessInput): boolean | null {
  if (input.documentCollected !== null && input.documentCollected !== undefined) {
    return input.documentCollected;
  }
  const verification = resolveDocumentVerification(input);
  if (verification === 'uploaded' || verification === 'verified') return true;
  if (verification === 'missing' || verification === 'rejected') return false;
  return null;
}

function resolveContractRequired(input: BookingReadinessInput): boolean | null {
  if (input.contractRequired !== null && input.contractRequired !== undefined) {
    return input.contractRequired;
  }
  if (input.contractProvider === 'none') return false;
  if (input.contractStatus !== 'not_started') return true;
  return null;
}

function mapContractStatusToIntake(status: BookingOpsContractStatus): EffectiveContractIntake {
  switch (status) {
    case 'not_started':
      return 'missing';
    case 'prepared':
      return 'prepared';
    case 'sent':
      return 'sent';
    case 'signed':
      return 'signed';
    case 'problem':
      return 'missing';
    default:
      return 'missing';
  }
}

function resolveContractIntake(input: BookingReadinessInput): EffectiveContractIntake {
  if (input.contractIntakeStatus) return input.contractIntakeStatus;
  const required = resolveContractRequired(input);
  if (required === false) return 'not_required';
  return mapContractStatusToIntake(input.contractStatus);
}

function resolveDepositRequired(input: BookingReadinessInput): boolean | null {
  if (input.depositRequired !== null && input.depositRequired !== undefined) {
    return input.depositRequired;
  }
  if (input.depositStatus !== 'not_started') return true;
  return null;
}

function mapDepositStatusToIntake(status: BookingOpsDepositStatus): EffectiveDepositIntake {
  switch (status) {
    case 'not_started':
      return 'missing';
    case 'requested':
      return 'requested';
    case 'confirmed':
      return 'received';
    case 'problem':
      return 'issue';
    default:
      return 'missing';
  }
}

function resolveDepositIntake(input: BookingReadinessInput): EffectiveDepositIntake {
  if (input.depositIntakeStatus) return input.depositIntakeStatus;
  const required = resolveDepositRequired(input);
  if (required === false) return 'not_required';
  return mapDepositStatusToIntake(input.depositStatus);
}

function resolveMvdRequired(input: BookingReadinessInput): boolean | null {
  if (input.mvdRequired !== null && input.mvdRequired !== undefined) {
    return input.mvdRequired;
  }
  if (input.mvdStatus === 'not_required') return false;
  if (
    input.mvdStatus === 'required'
    || input.mvdStatus === 'prepared'
    || input.mvdStatus === 'submitted'
    || input.mvdStatus === 'problem'
  ) {
    return true;
  }
  return null;
}

function mapMvdStatusToData(status: BookingOpsMvdStatus): EffectiveMvdData {
  switch (status) {
    case 'not_required':
      return 'not_required';
    case 'required':
      return 'missing';
    case 'prepared':
      return 'prepared';
    case 'submitted':
      return 'submitted';
    case 'problem':
      return 'missing';
    default:
      return 'missing';
  }
}

function resolveMvdData(input: BookingReadinessInput): EffectiveMvdData {
  if (input.mvdDataStatus) return input.mvdDataStatus;
  const required = resolveMvdRequired(input);
  if (required === false) return 'not_required';
  return mapMvdStatusToData(input.mvdStatus);
}

function contractSatisfied(status: EffectiveContractIntake): boolean {
  return status === 'not_required' || status === 'signed';
}

function contractReadyToSend(status: EffectiveContractIntake): boolean {
  return status === 'prepared' || status === 'sent' || status === 'signed';
}

function depositSatisfied(status: EffectiveDepositIntake): boolean {
  return (
    status === 'not_required'
    || status === 'received'
    || status === 'held'
    || status === 'returned'
  );
}

function mvdSatisfied(status: EffectiveMvdData): boolean {
  return status === 'not_required' || status === 'submitted' || status === 'confirmed';
}

function documentsSatisfied(
  required: boolean | null,
  verification: EffectiveDocumentVerification,
): boolean {
  if (required === false) return true;
  if (required === null) return false;
  return verification === 'verified';
}

function summarizeTelegramDrafts(
  drafts: Pick<BookingOpsTelegramDraft, 'status'>[],
): {
  count: number;
  telegramDraftStatus: TelegramDraftReadinessStatus;
  allManualReady: boolean;
  allCompleted: boolean;
} {
  const count = drafts.length;
  if (count === 0) {
    return {
      count,
      telegramDraftStatus: 'not_ready',
      allManualReady: false,
      allCompleted: false,
    };
  }

  const allCompleted = drafts.every((draft) => draft.status === 'sent_manually');
  if (allCompleted) {
    return {
      count,
      telegramDraftStatus: 'completed',
      allManualReady: true,
      allCompleted: true,
    };
  }

  const allManualReady = drafts.every((draft) =>
    DRAFT_MANUAL_READY_STATUSES.includes(draft.status),
  );
  if (allManualReady) {
    return {
      count,
      telegramDraftStatus: 'ready_for_manual_send',
      allManualReady: true,
      allCompleted: false,
    };
  }

  const allCreated = drafts.every((draft) => DRAFT_READY_STATUSES.includes(draft.status));
  return {
    count,
    telegramDraftStatus: allCreated ? 'drafts_created' : 'drafts_created',
    allManualReady: false,
    allCompleted: false,
  };
}

function bookingChecklist(input: BookingReadinessInput): BookingReadinessChecklistGroup {
  const hasProperty = Boolean(text(input.propertyId) || text(input.propertyLabel));
  const hasDates = Boolean(input.checkInAt && input.checkOutAt);
  const hasGuestCount = input.guestCount != null && input.guestCount > 0;
  const hasGuestName = Boolean(text(input.guestName));
  const hasSource = Boolean(text(input.otaSource));
  const hasPayment = Boolean(text(input.paymentStatus));

  return {
    id: 'booking',
    title: 'Бронь',
    items: [
      {
        id: 'guest_name',
        label: 'Имя гостя',
        ok: hasGuestName,
        detail: hasGuestName ? null : 'Укажите имя гостя',
      },
      {
        id: 'property',
        label: 'Объект',
        ok: hasProperty,
        detail: hasProperty ? null : 'Выберите или укажите объект',
      },
      {
        id: 'dates',
        label: 'Даты заезда и выезда',
        ok: hasDates,
        detail: hasDates ? null : 'Укажите даты бронирования',
      },
      {
        id: 'guest_count',
        label: 'Количество гостей',
        ok: hasGuestCount,
        detail: hasGuestCount ? null : 'Укажите количество гостей',
      },
      {
        id: 'source',
        label: 'Источник / канал',
        ok: hasSource,
        detail: hasSource ? null : 'Укажите источник, если известен',
      },
      {
        id: 'payment',
        label: 'Оплата / статус платежа',
        ok: hasPayment,
        detail: hasPayment ? null : 'Укажите статус оплаты, если известен',
      },
    ],
  };
}

function documentsChecklist(
  input: BookingReadinessInput,
  required: boolean | null,
  verification: EffectiveDocumentVerification,
  collected: boolean | null,
): BookingReadinessChecklistGroup {
  const requiredLabel =
    required === null
      ? 'Нужно решение оператора'
      : required
        ? 'Требуются'
        : 'Не требуются';

  return {
    id: 'documents',
    title: 'Документы гостя',
    items: [
      {
        id: 'document_required',
        label: 'Документы требуются',
        ok: required !== null,
        detail: required === null ? 'Укажите, требуются ли документы' : requiredLabel,
      },
      {
        id: 'document_collected',
        label: 'Документы получены',
        ok: required === false || collected === true,
        detail:
          required === false
            ? null
            : collected
              ? null
              : 'Документы ещё не получены',
      },
      {
        id: 'document_verification',
        label: 'Проверка документов',
        ok: required === false || verification === 'verified',
        detail:
          required === false
            ? null
            : verification === 'verified'
              ? null
              : verification === 'rejected'
                ? 'Документы отклонены'
                : verification === 'uploaded'
                  ? 'Документы загружены, нужна проверка'
                  : 'Документы не проверены',
      },
    ],
  };
}

function contractChecklist(
  input: BookingReadinessInput,
  required: boolean | null,
  intake: EffectiveContractIntake,
): BookingReadinessChecklistGroup {
  return {
    id: 'contract',
    title: 'Договор',
    items: [
      {
        id: 'contract_required',
        label: 'Договор требуется',
        ok: required !== null,
        detail: required === null ? 'Укажите, требуется ли договор' : null,
      },
      {
        id: 'contract_provider',
        label: 'Провайдер договора',
        ok: required === false || Boolean(text(input.contractProvider)),
        detail:
          required === false
            ? null
            : text(input.contractProvider)
              ? null
              : 'Укажите провайдера: manual, okidoki или none',
      },
      {
        id: 'contract_status',
        label: 'Статус договора',
        ok: contractSatisfied(intake),
        detail:
          intake === 'signed' || intake === 'not_required'
            ? null
            : intake === 'sent'
              ? 'Договор отправлен, ждём подписание'
              : intake === 'prepared'
                ? 'Договор подготовлен'
                : 'Договор не готов',
      },
      {
        id: 'contract_link',
        label: 'Ссылка на договор',
        ok:
          required === false
          || intake === 'not_required'
          || intake === 'signed'
          || Boolean(text(input.contractLink)),
        detail:
          required === false || intake === 'signed' || text(input.contractLink)
            ? null
            : 'Ссылка не указана',
      },
    ],
  };
}

function depositChecklist(
  input: BookingReadinessInput,
  required: boolean | null,
  intake: EffectiveDepositIntake,
): BookingReadinessChecklistGroup {
  return {
    id: 'deposit',
    title: 'Депозит',
    items: [
      {
        id: 'deposit_required',
        label: 'Депозит требуется',
        ok: required !== null,
        detail: required === null ? 'Укажите, требуется ли депозит' : null,
      },
      {
        id: 'deposit_amount',
        label: 'Сумма депозита',
        ok: required === false || input.depositAmount != null,
        detail:
          required === false || input.depositAmount != null
            ? null
            : 'Укажите сумму депозита',
      },
      {
        id: 'deposit_status',
        label: 'Статус депозита',
        ok: depositSatisfied(intake),
        detail:
          depositSatisfied(intake)
            ? null
            : intake === 'requested'
              ? 'Депозит запрошен, ждём поступление'
              : intake === 'issue'
                ? 'Проблема с депозитом'
                : 'Депозит не получен',
      },
    ],
  };
}

function mvdChecklist(
  input: BookingReadinessInput,
  required: boolean | null,
  dataStatus: EffectiveMvdData,
): BookingReadinessChecklistGroup {
  return {
    id: 'mvd',
    title: 'МВД',
    items: [
      {
        id: 'mvd_required',
        label: 'Регистрация МВД требуется',
        ok: required !== null,
        detail: required === null ? 'Укажите, требуется ли регистрация МВД' : null,
      },
      {
        id: 'mvd_data_status',
        label: 'Статус данных МВД',
        ok: mvdSatisfied(dataStatus),
        detail:
          mvdSatisfied(dataStatus)
            ? null
            : dataStatus === 'collected' || dataStatus === 'prepared'
              ? 'Данные собраны, нужно отправить отчёт'
              : 'Данные МВД не готовы',
      },
      {
        id: 'mvd_confirmation',
        label: 'Подтверждение / ссылка',
        ok:
          required === false
          || dataStatus === 'not_required'
          || dataStatus === 'confirmed'
          || Boolean(text(input.mvdConfirmationLink)),
        detail:
          required === false
          || dataStatus === 'confirmed'
          || text(input.mvdConfirmationLink)
            ? null
            : 'Подтверждение не указано',
      },
    ],
  };
}

function telegramDraftsChecklist(
  telegramDraftStatus: TelegramDraftReadinessStatus,
  draftCount: number,
): BookingReadinessChecklistGroup {
  return {
    id: 'telegram_drafts',
    title: 'Черновики Telegram',
    items: [
      {
        id: 'telegram_manual_only',
        label: 'Только ручная отправка',
        ok: true,
        detail: 'Автоотправка отключена',
      },
      {
        id: 'telegram_draft_status',
        label: 'Статус черновиков',
        ok: telegramDraftStatus !== 'not_ready',
        detail: TELEGRAM_DRAFT_READINESS_STATUS_LABELS_RU[telegramDraftStatus],
      },
      {
        id: 'telegram_draft_count',
        label: 'Созданные черновики',
        ok: draftCount > 0 || telegramDraftStatus === 'not_ready',
        detail: draftCount > 0 ? `${draftCount} шт.` : 'Черновики ещё не созданы',
      },
    ],
  };
}

function coreBookingComplete(input: BookingReadinessInput): {
  complete: boolean;
  missingItems: string[];
} {
  const bookingGroup = bookingChecklist(input);
  const requiredIds = ['guest_name', 'property', 'dates', 'guest_count'];
  const missingItems = bookingGroup.items
    .filter((item) => !item.ok && requiredIds.includes(item.id) && item.detail)
    .map((item) => item.detail as string);
  return { complete: missingItems.length === 0, missingItems };
}

function intakeGatesForDraftAction(
  input: BookingReadinessInput,
  actionId: BookingOpsTelegramDraftActionId,
): { allowed: boolean; missingItems: string[] } {
  const core = coreBookingComplete(input);
  if (!core.complete) {
    return { allowed: false, missingItems: core.missingItems };
  }

  const documentRequired = resolveDocumentRequired(input);
  const documentVerification = resolveDocumentVerification(input);
  const contractRequired = resolveContractRequired(input);
  const contractIntake = resolveContractIntake(input);
  const depositRequired = resolveDepositRequired(input);
  const depositIntake = resolveDepositIntake(input);
  const mvdRequired = resolveMvdRequired(input);
  const mvdData = resolveMvdData(input);
  const missingItems: string[] = [];

  if (actionId === 'request_guest_documents') {
    return { allowed: true, missingItems: [] };
  }

  if (!documentsSatisfied(documentRequired, documentVerification)) {
    missingItems.push(...collectMissingBookingItems(
      documentsChecklist(input, documentRequired, documentVerification, resolveDocumentCollected(input)),
    ));
    return { allowed: false, missingItems };
  }

  if (actionId === 'send_contract') {
    if (contractRequired === null) {
      missingItems.push('Укажите, требуется ли договор');
    } else if (contractRequired !== false && !contractReadyToSend(contractIntake)) {
      missingItems.push(...collectMissingBookingItems(
        contractChecklist(input, contractRequired, contractIntake),
      ));
    }
    return { allowed: missingItems.length === 0, missingItems };
  }

  if (contractRequired !== false && !contractSatisfied(contractIntake)) {
    missingItems.push(...collectMissingBookingItems(
      contractChecklist(input, contractRequired, contractIntake),
    ));
    return { allowed: false, missingItems };
  }

  if (actionId === 'request_deposit') {
    if (depositRequired === null) {
      missingItems.push('Укажите, требуется ли депозит');
    }
    return { allowed: missingItems.length === 0, missingItems };
  }

  if (depositRequired !== false && !depositSatisfied(depositIntake)) {
    missingItems.push(...collectMissingBookingItems(
      depositChecklist(input, depositRequired, depositIntake),
    ));
    return { allowed: false, missingItems };
  }

  if (actionId === 'prepare_checkin_instructions') {
    if (mvdRequired === null) {
      missingItems.push('Укажите, требуется ли регистрация МВД');
    } else if (mvdRequired !== false && !mvdSatisfied(mvdData)) {
      missingItems.push(...collectMissingBookingItems(mvdChecklist(input, mvdRequired, mvdData)));
    }
    return { allowed: missingItems.length === 0, missingItems };
  }

  return { allowed: true, missingItems };
}

export function canCreateTelegramDraftForAction(
  input: BookingReadinessInput,
  actionId: BookingOpsTelegramDraftActionId,
): { allowed: boolean; missingItems: string[] } {
  return intakeGatesForDraftAction(input, actionId);
}

function collectMissingBookingItems(group: BookingReadinessChecklistGroup): string[] {
  return group.items
    .filter((item) => !item.ok && item.detail)
    .map((item) => item.detail as string);
}

export function computeBookingReadiness(input: BookingReadinessInput): BookingReadinessResult {
  const documentRequired = resolveDocumentRequired(input);
  const documentVerification = resolveDocumentVerification(input);
  const documentCollected = resolveDocumentCollected(input);
  const contractRequired = resolveContractRequired(input);
  const contractIntake = resolveContractIntake(input);
  const depositRequired = resolveDepositRequired(input);
  const depositIntake = resolveDepositIntake(input);
  const mvdRequired = resolveMvdRequired(input);
  const mvdData = resolveMvdData(input);

  const bookingGroup = bookingChecklist(input);
  const documentsGroup = documentsChecklist(
    input,
    documentRequired,
    documentVerification,
    documentCollected,
  );
  const contractGroup = contractChecklist(input, contractRequired, contractIntake);
  const depositGroup = depositChecklist(input, depositRequired, depositIntake);
  const mvdGroup = mvdChecklist(input, mvdRequired, mvdData);

  const drafts = input.telegramDrafts ?? [];
  const telegramSummary = summarizeTelegramDrafts(drafts);
  const telegramGroup = telegramDraftsChecklist(
    telegramSummary.telegramDraftStatus,
    telegramSummary.count,
  );

  const checklist = [
    bookingGroup,
    documentsGroup,
    contractGroup,
    depositGroup,
    mvdGroup,
    telegramGroup,
  ];

  const missingItems: string[] = [];
  let status: BookingReadinessStatus;

  const coreBookingMissing = bookingGroup.items.some(
    (item) => !item.ok && ['guest_name', 'property', 'dates', 'guest_count'].includes(item.id),
  );
  if (coreBookingMissing) {
    status = 'missing_booking_data';
    missingItems.push(...collectMissingBookingItems(bookingGroup));
  } else if (!documentsSatisfied(documentRequired, documentVerification)) {
    status = 'missing_documents';
    missingItems.push(...collectMissingBookingItems(documentsGroup));
  } else if (contractRequired !== false && !contractSatisfied(contractIntake)) {
    status = 'missing_contract';
    missingItems.push(...collectMissingBookingItems(contractGroup));
  } else if (depositRequired !== false && !depositSatisfied(depositIntake)) {
    status = 'missing_deposit';
    missingItems.push(...collectMissingBookingItems(depositGroup));
  } else if (mvdRequired !== false && !mvdSatisfied(mvdData)) {
    status = 'missing_mvd_data';
    missingItems.push(...collectMissingBookingItems(mvdGroup));
  } else if (telegramSummary.count === 0) {
    status = 'ready_for_drafts';
    telegramSummary.telegramDraftStatus = 'ready_for_drafts';
  } else if (!telegramSummary.allManualReady) {
    status = 'drafts_created';
  } else if (!telegramSummary.allCompleted) {
    status = 'ready_for_manual_send';
  } else {
    status = 'completed';
  }

  const intakeGatesPassed =
    !coreBookingMissing
    && documentsSatisfied(documentRequired, documentVerification)
    && (contractRequired === false || contractSatisfied(contractIntake))
    && (depositRequired === false || depositSatisfied(depositIntake))
    && (mvdRequired === false || mvdSatisfied(mvdData));

  const canCreateDrafts = intakeGatesPassed;
  const canManualSend =
    intakeGatesPassed && telegramSummary.count > 0 && telegramSummary.allManualReady;

  const resolvedTelegramStatus: TelegramDraftReadinessStatus =
    !intakeGatesPassed
      ? 'not_ready'
      : telegramSummary.count === 0
        ? 'ready_for_drafts'
        : telegramSummary.telegramDraftStatus;

  return {
    status,
    missingItems,
    canCreateDrafts,
    canManualSend,
    checklist,
    telegramDraftStatus: resolvedTelegramStatus,
  };
}

export function attachBookingReadiness(
  record: BookingOpsRecord,
  telegramDrafts?: Pick<BookingOpsTelegramDraft, 'status'>[],
): BookingOpsRecord {
  return {
    ...record,
    readiness: computeBookingReadiness({ ...record, telegramDrafts }),
  };
}

export async function fetchTelegramDraftStatusesForRecord(
  recordId: string,
): Promise<Pick<BookingOpsTelegramDraft, 'status'>[]> {
  const id = String(recordId ?? '').trim();
  if (!id) return [];

  const { data, error } = await supabase
    .from('booking_ops_telegram_drafts')
    .select('status')
    .eq('booking_ops_record_id', id);

  if (error || !data) return [];
  return (data as Array<{ status: string }>).map((row) => ({
    status: row.status as BookingOpsTelegramDraftStatus,
  }));
}
