const PILOT_GUEST_PREFIX = 'ASI_BOOKING_OPS_PILOT_DRY_RUN_';
const PILOT_NOTES_PREFIX = `${PILOT_GUEST_PREFIX}notes`;

const DEMO_PROPERTY_LABELS_RU: Record<string, string> = {
  'Dry Run Apartments': 'Тестовый объект',
};

const OTA_SOURCE_LABELS_RU: Record<string, string> = {
  manual: 'Ручной ввод',
};

export type BookingOpsEditDisplayField = 'guestName' | 'propertyLabel' | 'otaSource' | 'notes';

export function isPilotDryRunGuestName(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim();
  return raw.startsWith(PILOT_GUEST_PREFIX) && !raw.startsWith(PILOT_NOTES_PREFIX);
}

export function isPilotDryRunNotes(value: string | null | undefined): boolean {
  return String(value ?? '').trim().startsWith(PILOT_NOTES_PREFIX);
}

export function formatBookingOpsGuestNameDisplay(guestName: string | null | undefined): string {
  const raw = String(guestName ?? '').trim();
  if (!raw) return '—';
  if (isPilotDryRunGuestName(raw)) return 'Тестовый гость';
  return raw;
}

export function formatBookingOpsPropertyLabelDisplay(
  propertyLabel: string | null | undefined,
  propertyId?: string | null,
): string {
  const raw = String(propertyLabel ?? '').trim();
  if (raw) return DEMO_PROPERTY_LABELS_RU[raw] ?? raw;
  const id = String(propertyId ?? '').trim();
  return id || '—';
}

export function formatBookingOpsOtaSourceDisplay(otaSource: string | null | undefined): string {
  const raw = String(otaSource ?? '').trim();
  if (!raw) return '—';
  return OTA_SOURCE_LABELS_RU[raw] ?? raw;
}

export function formatBookingOpsNotesDisplay(notes: string | null | undefined): string {
  const raw = String(notes ?? '').trim();
  if (!raw) return '';
  if (isPilotDryRunNotes(raw)) return 'Тестовая заметка';
  return raw;
}

export function guestNameForGuestFacingCopy(guestName: string | null | undefined): string {
  const raw = String(guestName ?? '').trim();
  if (!raw) return '[имя гостя]';
  if (isPilotDryRunGuestName(raw)) return 'Тестовый гость';
  return raw;
}

export function propertyLabelForGuestFacingCopy(
  propertyLabel: string | null | undefined,
  propertyId?: string | null,
): string {
  const label = String(propertyLabel ?? '').trim();
  if (label) return formatBookingOpsPropertyLabelDisplay(label, propertyId);
  const id = String(propertyId ?? '').trim();
  if (id) return id;
  return '[объект]';
}

export function formatBookingOpsMessageTextDisplay(text: string): string {
  return String(text)
    .replace(/ASI_BOOKING_OPS_PILOT_DRY_RUN_(?!notes)\S*/g, 'Тестовый гость')
    .replace(/ASI_BOOKING_OPS_PILOT_DRY_RUN_notes\s*\S*/g, 'Тестовая заметка')
    .replace(/Dry Run Apartments/g, 'Тестовый объект');
}

export function toBookingOpsEditDraftDisplayValue(
  field: BookingOpsEditDisplayField,
  raw: string | null | undefined,
  propertyId?: string | null,
): string {
  switch (field) {
    case 'guestName': {
      const display = formatBookingOpsGuestNameDisplay(raw);
      return display === '—' ? '' : display;
    }
    case 'propertyLabel': {
      const label = String(raw ?? '').trim();
      if (!label) return '';
      return formatBookingOpsPropertyLabelDisplay(label, propertyId);
    }
    case 'otaSource': {
      const source = String(raw ?? '').trim();
      if (!source) return '';
      return formatBookingOpsOtaSourceDisplay(source);
    }
    case 'notes':
      return formatBookingOpsNotesDisplay(raw);
    default:
      return String(raw ?? '');
  }
}

export function resolveBookingOpsEditDraftSaveValue(
  field: BookingOpsEditDisplayField,
  edited: string,
  original: string | null | undefined,
  propertyId?: string | null,
): string {
  const displayOriginal = toBookingOpsEditDraftDisplayValue(field, original, propertyId);
  if (edited === displayOriginal) return String(original ?? '');
  return edited;
}
