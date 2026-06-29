import type {
  BookingOpsGuestIntakeSession,
  BookingOpsGuestIntakeStatus,
  BookingOpsRecord,
} from './types';

export const GUEST_INTAKE_FIELD_LABELS_RU: Record<string, string> = {
  guest_name: 'Имя гостя',
  guest_phone: 'Телефон',
  guest_email: 'E-mail',
  guest_contact: 'Контакт гостя',
  arrival_details: 'Время заезда',
  documents: 'Документы',
  companion_guest_data: 'Данные второго гостя',
  contract_confirmation: 'Подтверждение договора',
  deposit_confirmation: 'Депозит',
  mvd_data: 'Данные МВД',
};

export type GuestIntakeSubmission = {
  guestName?: string | null;
  phone?: string | null;
  email?: string | null;
  telegram?: string | null;
  arrivalDetails?: string | null;
  documentAttachmentRefs?: string[];
  companionGuestDataPresent?: boolean;
  contractConfirmed?: boolean;
  depositConfirmed?: boolean;
  mvdDataPresent?: boolean;
  guestCannotProceed?: boolean;
  fallbackReason?: string | null;
};

export type GuestIntakeStatePlan = {
  intakeStatus: BookingOpsGuestIntakeStatus;
  missingFields: string[];
  collectedFields: Record<string, unknown>;
  validationErrors: string[];
  channel: 'telegram' | 'web' | 'manual';
  guestContactRef: string | null;
  fallbackReason: string | null;
  generatedMessage: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function hasAnyContact(record: BookingOpsRecord): boolean {
  return Boolean(text(record.guestTelegram) || text(record.guestPhone) || text(record.guestEmail));
}

function preferredChannel(record: BookingOpsRecord): GuestIntakeStatePlan['channel'] {
  if (text(record.guestTelegram)) return 'telegram';
  if (text(record.guestEmail) || text(record.guestPhone)) return 'web';
  return 'manual';
}

function contactRef(record: BookingOpsRecord): string | null {
  return text(record.guestTelegram) || text(record.guestPhone) || text(record.guestEmail) || null;
}

function depositComplete(record: BookingOpsRecord): boolean {
  return (
    record.depositRequired === false
    || record.depositIntakeStatus === 'received'
    || record.depositIntakeStatus === 'held'
    || record.depositIntakeStatus === 'returned'
    || record.depositStatus === 'confirmed'
  );
}

function contractComplete(record: BookingOpsRecord): boolean {
  return (
    record.contractRequired === false
    || record.contractProvider === 'none'
    || record.contractIntakeStatus === 'signed'
    || record.contractStatus === 'signed'
  );
}

function mvdComplete(record: BookingOpsRecord): boolean {
  return (
    record.mvdRequired === false
    || record.mvdStatus === 'not_required'
    || record.mvdDataStatus === 'collected'
    || record.mvdDataStatus === 'prepared'
    || record.mvdDataStatus === 'submitted'
    || record.mvdDataStatus === 'confirmed'
  );
}

function documentsComplete(record: BookingOpsRecord): boolean {
  return (
    record.documentRequired === false
    || record.documentVerificationStatus === 'uploaded'
    || record.documentVerificationStatus === 'verified'
    || record.documentsStatus === 'received'
    || record.documentsStatus === 'verified'
  );
}

function isInactive(existing: BookingOpsGuestIntakeSession | null | undefined, now: Date): boolean {
  if (!existing || existing.intakeStatus === 'completed') return false;
  const anchor = existing.lastGuestActivityAt ?? existing.createdAt;
  const parsed = new Date(anchor).getTime();
  if (!Number.isFinite(parsed)) return false;
  return now.getTime() - parsed > 72 * 60 * 60 * 1000;
}

function buildGuestMessage(record: BookingOpsRecord, missingFields: string[]): string | null {
  if (missingFields.length === 0) return null;
  const guest = text(record.guestName) || 'гость';
  const items = missingFields.map((field) => GUEST_INTAKE_FIELD_LABELS_RU[field] ?? field);
  return `Здравствуйте, ${guest}. Для подготовки заезда нужно уточнить: ${items.join(', ')}. Пришлите данные удобным способом.`;
}

export function evaluateGuestIntakeState(input: {
  record: BookingOpsRecord;
  existingSession?: BookingOpsGuestIntakeSession | null;
  now?: Date;
}): GuestIntakeStatePlan {
  const { record } = input;
  const missing = new Set<string>();
  const collected: Record<string, unknown> = {};
  const validationErrors: string[] = [];

  if (!text(record.guestName)) missing.add('guest_name');
  else collected.guest_name = true;

  if (!text(record.guestPhone)) missing.add('guest_phone');
  else collected.guest_phone = true;

  if (!hasAnyContact(record)) missing.add('guest_contact');
  else collected.guest_contact = true;

  if (!text(record.checkInAt)) missing.add('arrival_details');
  else collected.arrival_details = true;

  if (!documentsComplete(record)) {
    missing.add('documents');
    if (record.documentVerificationStatus === 'rejected' || record.documentsStatus === 'problem') {
      validationErrors.push('Проверить документы вручную');
    }
  } else if (
    record.documentVerificationStatus === 'uploaded'
    || record.documentsStatus === 'received'
  ) {
    collected.documents = true;
    validationErrors.push('Проверить документы вручную');
  } else {
    collected.documents = true;
  }

  if ((record.guestCount ?? 1) > 1 && !mvdComplete(record)) {
    missing.add('companion_guest_data');
  }

  if (!contractComplete(record)) missing.add('contract_confirmation');
  else collected.contract_confirmation = true;

  if (!depositComplete(record)) missing.add('deposit_confirmation');
  else collected.deposit_confirmation = true;

  if (!mvdComplete(record)) missing.add('mvd_data');
  else collected.mvd_data = true;

  const missingFields = [...missing];
  const now = input.now ?? new Date();
  let intakeStatus: BookingOpsGuestIntakeStatus = 'not_started';
  let fallbackReason: string | null = null;

  if (missingFields.length === 0 && validationErrors.length === 0) {
    intakeStatus = 'completed';
  } else if (!hasAnyContact(record)) {
    intakeStatus = 'fallback_required';
    fallbackReason = 'Требуется ручная помощь гостю';
  } else if (validationErrors.length > 0) {
    intakeStatus = 'validation_needed';
    fallbackReason = validationErrors.includes('Проверить документы вручную')
      ? 'Проверить документы вручную'
      : null;
  } else if (isInactive(input.existingSession, now)) {
    intakeStatus = 'fallback_required';
    fallbackReason = 'Гость не завершил ввод данных';
  } else if (input.existingSession?.lastGuestActivityAt && Object.keys(collected).length > 0) {
    intakeStatus = 'partially_completed';
  } else {
    intakeStatus = 'waiting_for_guest';
  }

  return {
    intakeStatus,
    missingFields,
    collectedFields: collected,
    validationErrors,
    channel: preferredChannel(record),
    guestContactRef: contactRef(record),
    fallbackReason,
    generatedMessage: buildGuestMessage(record, missingFields),
  };
}

export function buildBookingOpsPatchFromGuestSubmission(
  submission: GuestIntakeSubmission,
): {
  patch: Record<string, unknown>;
  validationErrors: string[];
} {
  const patch: Record<string, unknown> = {};
  const validationErrors: string[] = [];
  const phone = text(submission.phone);
  if (submission.guestName !== undefined) patch.guestName = text(submission.guestName) || null;
  if (phone) {
    if (!/^\+?[0-9 ()-]{7,24}$/.test(phone)) validationErrors.push('Телефон выглядит некорректно');
    else patch.guestPhone = phone;
  }
  if (submission.email !== undefined) {
    const email = text(submission.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push('E-mail выглядит некорректно');
    } else {
      patch.guestEmail = email || null;
    }
  }
  if (submission.telegram !== undefined) patch.guestTelegram = text(submission.telegram) || null;
  if (submission.arrivalDetails !== undefined) patch.documentNotes = 'Детали заезда получены';
  if (submission.documentAttachmentRefs !== undefined) {
    if (submission.documentAttachmentRefs.length === 0) {
      validationErrors.push('Проверить документы вручную');
    } else {
      patch.documentCollected = true;
      patch.documentVerificationStatus = 'uploaded';
      patch.documentsStatus = 'received';
    }
  }
  if (submission.contractConfirmed === true) {
    patch.contractIntakeStatus = 'signed';
    patch.contractStatus = 'signed';
  }
  if (submission.depositConfirmed === true) {
    patch.depositIntakeStatus = 'received';
    patch.depositStatus = 'confirmed';
  }
  if (submission.mvdDataPresent === true) {
    patch.mvdDataStatus = 'collected';
    patch.mvdStatus = 'prepared';
  }
  if (submission.guestCannotProceed === true) {
    validationErrors.push(text(submission.fallbackReason) || 'Гость не может завершить ввод данных');
  }
  return { patch, validationErrors };
}
