const PILOT_GUEST_PREFIX = 'ASI_BOOKING_OPS_PILOT_DRY_RUN_';

const DEMO_PROPERTY_LABELS_RU: Record<string, string> = {
  'Dry Run Apartments': 'Тестовый объект',
};

const OTA_SOURCE_LABELS_RU: Record<string, string> = {
  manual: 'Ручной ввод',
};

export function formatBookingOpsGuestNameDisplay(guestName: string | null | undefined): string {
  const raw = String(guestName ?? '').trim();
  if (!raw) return '—';
  if (raw.startsWith(PILOT_GUEST_PREFIX)) return 'Тестовый гость';
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
