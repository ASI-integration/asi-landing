import type { CreateBookingOpsInput, UpdateBookingOpsInput } from './types';
import {
  BOOKING_OPS_CHECKIN_READINESS_STATUSES,
  BOOKING_OPS_CONTRACT_INTAKE_STATUSES,
  BOOKING_OPS_CONTRACT_PROVIDERS,
  BOOKING_OPS_CONTRACT_STATUSES,
  BOOKING_OPS_DEPOSIT_INTAKE_STATUSES,
  BOOKING_OPS_DEPOSIT_STATUSES,
  BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES,
  BOOKING_OPS_DOCUMENTS_STATUSES,
  BOOKING_OPS_MVD_DATA_STATUSES,
  BOOKING_OPS_MVD_STATUSES,
  BOOKING_OPS_STATUSES,
  parseBookingOpsIntakeFields,
} from './types';

function text(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw.length > 0 ? raw : null;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldLabel: string,
): T | undefined | { error: string } {
  if (value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return { error: `${fieldLabel}: пустое значение.` };
  if (!(allowed as readonly string[]).includes(raw)) {
    return { error: `${fieldLabel}: недопустимое значение «${raw}».` };
  }
  return raw as T;
}

export function parseCreateBookingOpsInput(
  body: Record<string, unknown>,
): { input: CreateBookingOpsInput } | { error: string } {
  const guestName = text(body.guestName ?? body.guest_name);
  if (!guestName) {
    return { error: 'Укажите имя гостя.' };
  }

  const input: CreateBookingOpsInput = {
    bookingId: text(body.bookingId ?? body.booking_id),
    guestName,
    guestPhone: text(body.guestPhone ?? body.guest_phone),
    guestEmail: text(body.guestEmail ?? body.guest_email),
    guestTelegram: text(body.guestTelegram ?? body.guest_telegram),
    propertyId: text(body.propertyId ?? body.property_id),
    propertyLabel: text(body.propertyLabel ?? body.property_label),
    otaSource: text(body.otaSource ?? body.ota_source),
    checkInAt: text(body.checkInAt ?? body.check_in_at ?? body.checkIn ?? body.check_in),
    checkOutAt: text(body.checkOutAt ?? body.check_out_at ?? body.checkOut ?? body.check_out),
    notes: text(body.notes),
  };

  const opsStatus = parseEnum(body.opsStatus ?? body.ops_status, BOOKING_OPS_STATUSES, 'Статус');
  if (opsStatus && typeof opsStatus === 'object' && 'error' in opsStatus) return opsStatus;
  if (typeof opsStatus === 'string') input.opsStatus = opsStatus;

  const documentsStatus = parseEnum(
    body.documentsStatus ?? body.documents_status,
    BOOKING_OPS_DOCUMENTS_STATUSES,
    'Статус документов',
  );
  if (documentsStatus && typeof documentsStatus === 'object' && 'error' in documentsStatus) {
    return documentsStatus;
  }
  if (typeof documentsStatus === 'string') input.documentsStatus = documentsStatus;

  const contractStatus = parseEnum(
    body.contractStatus ?? body.contract_status,
    BOOKING_OPS_CONTRACT_STATUSES,
    'Статус договора',
  );
  if (contractStatus && typeof contractStatus === 'object' && 'error' in contractStatus) {
    return contractStatus;
  }
  if (typeof contractStatus === 'string') input.contractStatus = contractStatus;

  const depositStatus = parseEnum(
    body.depositStatus ?? body.deposit_status,
    BOOKING_OPS_DEPOSIT_STATUSES,
    'Статус депозита',
  );
  if (depositStatus && typeof depositStatus === 'object' && 'error' in depositStatus) {
    return depositStatus;
  }
  if (typeof depositStatus === 'string') input.depositStatus = depositStatus;

  const mvdStatus = parseEnum(body.mvdStatus ?? body.mvd_status, BOOKING_OPS_MVD_STATUSES, 'Статус МВД');
  if (mvdStatus && typeof mvdStatus === 'object' && 'error' in mvdStatus) return mvdStatus;
  if (typeof mvdStatus === 'string') input.mvdStatus = mvdStatus;

  const checkinReadinessStatus = parseEnum(
    body.checkinReadinessStatus ?? body.checkin_readiness_status,
    BOOKING_OPS_CHECKIN_READINESS_STATUSES,
    'Готовность к заезду',
  );
  if (
    checkinReadinessStatus
    && typeof checkinReadinessStatus === 'object'
    && 'error' in checkinReadinessStatus
  ) {
    return checkinReadinessStatus;
  }
  if (typeof checkinReadinessStatus === 'string') {
    input.checkinReadinessStatus = checkinReadinessStatus;
  }

  Object.assign(input, parseBookingOpsIntakeFields(body));

  const intakeEnums: Array<{
    key: keyof CreateBookingOpsInput;
    raw: unknown;
    allowed: readonly string[];
    label: string;
    bodyKeys: string[];
  }> = [
    {
      key: 'documentVerificationStatus',
      raw: body.documentVerificationStatus ?? body.document_verification_status,
      allowed: BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES,
      label: 'Статус проверки документов',
      bodyKeys: ['documentVerificationStatus', 'document_verification_status'],
    },
    {
      key: 'contractProvider',
      raw: body.contractProvider ?? body.contract_provider,
      allowed: BOOKING_OPS_CONTRACT_PROVIDERS,
      label: 'Провайдер договора',
      bodyKeys: ['contractProvider', 'contract_provider'],
    },
    {
      key: 'contractIntakeStatus',
      raw: body.contractIntakeStatus ?? body.contract_intake_status,
      allowed: BOOKING_OPS_CONTRACT_INTAKE_STATUSES,
      label: 'Статус договора (intake)',
      bodyKeys: ['contractIntakeStatus', 'contract_intake_status'],
    },
    {
      key: 'depositIntakeStatus',
      raw: body.depositIntakeStatus ?? body.deposit_intake_status,
      allowed: BOOKING_OPS_DEPOSIT_INTAKE_STATUSES,
      label: 'Статус депозита (intake)',
      bodyKeys: ['depositIntakeStatus', 'deposit_intake_status'],
    },
    {
      key: 'mvdDataStatus',
      raw: body.mvdDataStatus ?? body.mvd_data_status,
      allowed: BOOKING_OPS_MVD_DATA_STATUSES,
      label: 'Статус данных МВД',
      bodyKeys: ['mvdDataStatus', 'mvd_data_status'],
    },
  ];

  for (const field of intakeEnums) {
    if (!field.bodyKeys.some((key) => key in body)) continue;
    const parsed = parseEnum(field.raw, field.allowed as readonly string[], field.label);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) return parsed;
    if (typeof parsed === 'string') {
      input[field.key] = parsed as never;
    }
  }

  return { input };
}

export function parseUpdateBookingOpsInput(
  body: Record<string, unknown>,
): { input: UpdateBookingOpsInput } | { error: string } {
  const input: UpdateBookingOpsInput = {};

  if ('bookingId' in body || 'booking_id' in body) {
    input.bookingId = text(body.bookingId ?? body.booking_id);
  }
  if ('guestName' in body || 'guest_name' in body) {
    input.guestName = text(body.guestName ?? body.guest_name);
  }
  if ('guestPhone' in body || 'guest_phone' in body) {
    input.guestPhone = text(body.guestPhone ?? body.guest_phone);
  }
  if ('guestEmail' in body || 'guest_email' in body) {
    input.guestEmail = text(body.guestEmail ?? body.guest_email);
  }
  if ('guestTelegram' in body || 'guest_telegram' in body) {
    input.guestTelegram = text(body.guestTelegram ?? body.guest_telegram);
  }
  if ('propertyId' in body || 'property_id' in body) {
    input.propertyId = text(body.propertyId ?? body.property_id);
  }
  if ('propertyLabel' in body || 'property_label' in body) {
    input.propertyLabel = text(body.propertyLabel ?? body.property_label);
  }
  if ('otaSource' in body || 'ota_source' in body) {
    input.otaSource = text(body.otaSource ?? body.ota_source);
  }
  if ('checkInAt' in body || 'check_in_at' in body || 'checkIn' in body || 'check_in' in body) {
    input.checkInAt = text(body.checkInAt ?? body.check_in_at ?? body.checkIn ?? body.check_in);
  }
  if ('checkOutAt' in body || 'check_out_at' in body || 'checkOut' in body || 'check_out' in body) {
    input.checkOutAt = text(body.checkOutAt ?? body.check_out_at ?? body.checkOut ?? body.check_out);
  }
  if ('notes' in body) input.notes = text(body.notes);
  if ('manualNextAction' in body || 'manual_next_action' in body) {
    input.manualNextAction = text(body.manualNextAction ?? body.manual_next_action);
  }
  if ('blockerReason' in body || 'blocker_reason' in body) {
    input.blockerReason = text(body.blockerReason ?? body.blocker_reason);
  }
  if ('isBlocked' in body || 'is_blocked' in body) {
    input.isBlocked = body.isBlocked === true || body.is_blocked === true;
  }

  const fields: Array<{
    key: keyof UpdateBookingOpsInput;
    raw: unknown;
    allowed: readonly string[];
    label: string;
    bodyKeys: string[];
  }> = [
    {
      key: 'opsStatus',
      raw: body.opsStatus ?? body.ops_status,
      allowed: BOOKING_OPS_STATUSES,
      label: 'Статус',
      bodyKeys: ['opsStatus', 'ops_status'],
    },
    {
      key: 'documentsStatus',
      raw: body.documentsStatus ?? body.documents_status,
      allowed: BOOKING_OPS_DOCUMENTS_STATUSES,
      label: 'Статус документов',
      bodyKeys: ['documentsStatus', 'documents_status'],
    },
    {
      key: 'contractStatus',
      raw: body.contractStatus ?? body.contract_status,
      allowed: BOOKING_OPS_CONTRACT_STATUSES,
      label: 'Статус договора',
      bodyKeys: ['contractStatus', 'contract_status'],
    },
    {
      key: 'depositStatus',
      raw: body.depositStatus ?? body.deposit_status,
      allowed: BOOKING_OPS_DEPOSIT_STATUSES,
      label: 'Статус депозита',
      bodyKeys: ['depositStatus', 'deposit_status'],
    },
    {
      key: 'mvdStatus',
      raw: body.mvdStatus ?? body.mvd_status,
      allowed: BOOKING_OPS_MVD_STATUSES,
      label: 'Статус МВД',
      bodyKeys: ['mvdStatus', 'mvd_status'],
    },
    {
      key: 'checkinReadinessStatus',
      raw: body.checkinReadinessStatus ?? body.checkin_readiness_status,
      allowed: BOOKING_OPS_CHECKIN_READINESS_STATUSES,
      label: 'Готовность к заезду',
      bodyKeys: ['checkinReadinessStatus', 'checkin_readiness_status'],
    },
  ];

  for (const field of fields) {
    if (!field.bodyKeys.some((key) => key in body)) continue;
    const parsed = parseEnum(field.raw, field.allowed as readonly string[], field.label);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) return parsed;
    if (typeof parsed === 'string') {
      input[field.key] = parsed as never;
    }
  }

  Object.assign(input, parseBookingOpsIntakeFields(body));

  for (const field of [
    {
      key: 'documentVerificationStatus' as const,
      raw: body.documentVerificationStatus ?? body.document_verification_status,
      allowed: BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES,
      label: 'Статус проверки документов',
      bodyKeys: ['documentVerificationStatus', 'document_verification_status'],
    },
    {
      key: 'contractProvider' as const,
      raw: body.contractProvider ?? body.contract_provider,
      allowed: BOOKING_OPS_CONTRACT_PROVIDERS,
      label: 'Провайдер договора',
      bodyKeys: ['contractProvider', 'contract_provider'],
    },
    {
      key: 'contractIntakeStatus' as const,
      raw: body.contractIntakeStatus ?? body.contract_intake_status,
      allowed: BOOKING_OPS_CONTRACT_INTAKE_STATUSES,
      label: 'Статус договора (intake)',
      bodyKeys: ['contractIntakeStatus', 'contract_intake_status'],
    },
    {
      key: 'depositIntakeStatus' as const,
      raw: body.depositIntakeStatus ?? body.deposit_intake_status,
      allowed: BOOKING_OPS_DEPOSIT_INTAKE_STATUSES,
      label: 'Статус депозита (intake)',
      bodyKeys: ['depositIntakeStatus', 'deposit_intake_status'],
    },
    {
      key: 'mvdDataStatus' as const,
      raw: body.mvdDataStatus ?? body.mvd_data_status,
      allowed: BOOKING_OPS_MVD_DATA_STATUSES,
      label: 'Статус данных МВД',
      bodyKeys: ['mvdDataStatus', 'mvd_data_status'],
    },
  ]) {
    if (!field.bodyKeys.some((key) => key in body)) continue;
    const parsed = parseEnum(field.raw, field.allowed as readonly string[], field.label);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) return parsed;
    if (typeof parsed === 'string') {
      input[field.key] = parsed as never;
    }
  }

  return { input };
}
