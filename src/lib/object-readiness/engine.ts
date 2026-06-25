import type { OwnerOnboardingField } from '@/lib/communication/owner-onboarding-smart-parser';
import type { OwnerOnboardingStatus } from '@/lib/communication/telegram-owner-onboarding';
import type { OwnerOnboardingWizardField } from '@/lib/communication/telegram-owner-onboarding-wizard';

export type ObjectReadinessRequiredField = OwnerOnboardingWizardField;

/** @deprecated Legacy field keys kept for smart-parser and fallback parsing. */
export type ObjectReadinessLegacyField = OwnerOnboardingField;

export type ObjectReadinessOptionalField =
  | 'parking'
  | 'deposit'
  | 'checkin_keys'
  | 'reporting_docs'
  | 'pets'
  | 'guests'
  | 'quiet_hours';

export type ObjectReadinessStatusKey =
  | 'not_started'
  | 'in_progress'
  | 'missing_data'
  | 'ready_for_channel_manager'
  | 'needs_attention'
  | 'completed';

export const REQUIRED_FIELDS: ObjectReadinessRequiredField[] = [
  'address',
  'object_type',
  'checkin_time',
  'checkout_time',
  'channels',
  'rules',
  'wifi',
  'photos',
];

export const OPTIONAL_FIELDS: ObjectReadinessOptionalField[] = [
  'parking',
  'deposit',
  'checkin_keys',
  'reporting_docs',
  'pets',
  'guests',
  'quiet_hours',
];

export const REQUIRED_FIELD_LABELS_RU: Record<ObjectReadinessRequiredField, string> = {
  address: 'адрес',
  object_type: 'тип объекта',
  checkin_time: 'время заезда',
  checkout_time: 'время выезда',
  channels: 'каналы бронирования',
  rules: 'правила проживания',
  wifi: 'Wi-Fi',
  photos: 'фото объекта',
};

export const OPTIONAL_FIELD_LABELS_RU: Record<ObjectReadinessOptionalField, string> = {
  parking: 'парковка',
  deposit: 'залог',
  checkin_keys: 'ключи / инструкция заселения',
  reporting_docs: 'отчётные документы',
  pets: 'животные',
  guests: 'гости',
  quiet_hours: 'тишина',
};

export const READINESS_STATUS_LABELS_RU: Record<ObjectReadinessStatusKey, string> = {
  not_started: 'Не начат',
  in_progress: 'Идёт заполнение',
  missing_data: 'Не хватает данных',
  ready_for_channel_manager: 'Готов к менеджеру каналов',
  needs_attention: 'Требует внимания',
  completed: 'Завершено',
};

const NEXT_STEP_BY_FIELD: Record<ObjectReadinessRequiredField, string> = {
  address: 'Попросить владельца указать адрес объекта',
  object_type: 'Попросить владельца указать тип объекта',
  checkin_time: 'Попросить владельца указать время заезда',
  checkout_time: 'Попросить владельца указать время выезда',
  channels: 'Запросить каналы бронирования',
  rules: 'Попросить владельца выбрать правила проживания',
  wifi: 'Попросить владельца прислать данные Wi-Fi',
  photos: 'Попросить владельца добавить фото',
};

export type ObjectReadinessInput = {
  address?: string;
  object_type?: string;
  checkin_time?: string;
  checkout_time?: string;
  channels?: string | string[];
  rules?: string | string[];
  wifi?: string;
  wifi_name?: string;
  wifi_password?: string;
  wifi_skipped?: boolean;
  photos?: string;
  photos_intent?: 'now' | 'later' | null;
  photos_count?: number;
  /** Legacy combined fields for fallback parsing. */
  property_name?: string;
  house_rules?: string;
  checkin_checkout?: string;
  parking?: string;
  deposit?: string;
  checkin_keys?: string;
  reporting_docs?: string;
  onboardingStatus?: OwnerOnboardingStatus;
};

export type ObjectReadinessResult = {
  readiness_percent: number;
  required_done_count: number;
  required_total_count: number;
  missing_required_fields: ObjectReadinessRequiredField[];
  missing_optional_fields: ObjectReadinessOptionalField[];
  readiness_status: ObjectReadinessStatusKey;
  readiness_status_label_ru: string;
  missing_required_labels_ru: string[];
  missing_optional_labels_ru: string[];
  next_best_step_ru: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function listValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(', ');
  return text(value);
}

function normalizedObjectType(input: ObjectReadinessInput): string {
  return text(input.object_type) || text(input.property_name);
}

function extractTimeFromCombined(combined: string, kind: 'checkin' | 'checkout'): string {
  const raw = text(combined);
  if (!raw) return '';
  const pattern = kind === 'checkin' ? /заезд[^,.;]*/i : /выезд[^,.;]*/i;
  const match = raw.match(pattern);
  if (match) return text(match[0]);
  if (kind === 'checkin' && /\b\d{1,2}[:.]\d{2}\b/.test(raw) && !/выезд/.test(raw.toLowerCase())) return raw;
  if (kind === 'checkout' && /\b\d{1,2}[:.]\d{2}\b/.test(raw) && !/заезд/.test(raw.toLowerCase())) return raw;
  return '';
}

function normalizedCheckinTime(input: ObjectReadinessInput): string {
  return text(input.checkin_time) || extractTimeFromCombined(text(input.checkin_checkout), 'checkin');
}

function normalizedCheckoutTime(input: ObjectReadinessInput): string {
  return text(input.checkout_time) || extractTimeFromCombined(text(input.checkin_checkout), 'checkout');
}

function normalizedChannels(input: ObjectReadinessInput): string {
  const direct = listValue(input.channels);
  return direct;
}

function normalizedRules(input: ObjectReadinessInput): string {
  const direct = listValue(input.rules);
  return direct || text(input.house_rules);
}

function normalizedWifi(input: ObjectReadinessInput): string {
  if (input.wifi_skipped) return 'skipped';
  const name = text(input.wifi_name);
  const password = text(input.wifi_password);
  if (name || password) return [name, password].filter(Boolean).join(' / ');
  return text(input.wifi);
}

function isRequiredFieldDone(input: ObjectReadinessInput, field: ObjectReadinessRequiredField): boolean {
  switch (field) {
    case 'address':
      return Boolean(text(input.address));
    case 'object_type':
      return Boolean(normalizedObjectType(input));
    case 'checkin_time':
      return Boolean(normalizedCheckinTime(input));
    case 'checkout_time':
      return Boolean(normalizedCheckoutTime(input));
    case 'channels':
      return Boolean(normalizedChannels(input));
    case 'rules':
      return Boolean(normalizedRules(input));
    case 'wifi':
      return Boolean(normalizedWifi(input));
    case 'photos':
      return Boolean(text(input.photos)) || input.photos_intent === 'later' || (input.photos_count ?? 0) > 0;
    default:
      return false;
  }
}

function detectOptionalFromText(input: ObjectReadinessInput): Set<ObjectReadinessOptionalField> {
  const found = new Set<ObjectReadinessOptionalField>();
  const rules = normalizedRules(input).toLowerCase();
  const extras = [
    { field: 'parking' as const, value: input.parking, patterns: [/парков/] },
    { field: 'deposit' as const, value: input.deposit, patterns: [/залог/] },
    { field: 'checkin_keys' as const, value: input.checkin_keys, patterns: [/ключ|код|засел|домофон/] },
    { field: 'reporting_docs' as const, value: input.reporting_docs, patterns: [/отч[её]т|документ/] },
    { field: 'pets' as const, value: undefined, patterns: [/животн|питом/] },
    { field: 'guests' as const, value: undefined, patterns: [/гост|дет/] },
    { field: 'quiet_hours' as const, value: undefined, patterns: [/тишин|шум|quiet|22:00/] },
  ];

  for (const item of extras) {
    if (text(item.value)) {
      found.add(item.field);
      continue;
    }
    if (rules && item.patterns.some((pattern) => pattern.test(rules))) {
      found.add(item.field);
    }
  }

  return found;
}

function resolveReadinessStatus(params: {
  requiredDoneCount: number;
  missingRequired: ObjectReadinessRequiredField[];
  onboardingStatus?: OwnerOnboardingStatus;
}): ObjectReadinessStatusKey {
  const status = params.onboardingStatus;

  if (status === 'needs_operator') return 'needs_attention';
  if (status === 'channel_manager_started') return 'completed';
  if (params.missingRequired.length === 0) return 'ready_for_channel_manager';
  if (params.requiredDoneCount === 0) return 'not_started';
  if (status === 'onboarding_started') return 'in_progress';
  return 'missing_data';
}

function readinessPercent(requiredDoneCount: number, requiredTotal: number): number {
  if (requiredDoneCount <= 0) return 5;
  return Math.round((requiredDoneCount / requiredTotal) * 100);
}

export function computeObjectReadiness(input: ObjectReadinessInput): ObjectReadinessResult {
  const requiredTotal = REQUIRED_FIELDS.length;
  const missingRequired = REQUIRED_FIELDS.filter((field) => !isRequiredFieldDone(input, field));
  const requiredDoneCount = requiredTotal - missingRequired.length;

  const optionalPresent = detectOptionalFromText(input);
  const missingOptional = OPTIONAL_FIELDS.filter((field) => !optionalPresent.has(field));

  const readiness_status = resolveReadinessStatus({
    requiredDoneCount,
    missingRequired,
    onboardingStatus: input.onboardingStatus,
  });

  const nextField = missingRequired[0];
  const next_best_step_ru = nextField ? NEXT_STEP_BY_FIELD[nextField] : 'Открыть менеджер каналов';

  return {
    readiness_percent: readinessPercent(requiredDoneCount, requiredTotal),
    required_done_count: requiredDoneCount,
    required_total_count: requiredTotal,
    missing_required_fields: missingRequired,
    missing_optional_fields: missingOptional,
    readiness_status,
    readiness_status_label_ru: READINESS_STATUS_LABELS_RU[readiness_status],
    missing_required_labels_ru: missingRequired.map((field) => REQUIRED_FIELD_LABELS_RU[field]),
    missing_optional_labels_ru: missingOptional.map((field) => OPTIONAL_FIELD_LABELS_RU[field]),
    next_best_step_ru,
  };
}

export function readinessInputFromOnboardingState(state: {
  address?: string;
  object_type?: string;
  checkin_time?: string;
  checkout_time?: string;
  channels?: string | string[];
  rules?: string | string[];
  wifi?: string;
  wifi_name?: string;
  wifi_password?: string;
  wifi_skipped?: boolean;
  photos?: string;
  photos_intent?: 'now' | 'later' | null;
  photos_count?: number;
  property_name?: string;
  house_rules?: string;
  checkin_checkout?: string;
  status?: OwnerOnboardingStatus;
}): ObjectReadinessInput {
  return {
    address: state.address,
    object_type: state.object_type ?? state.property_name,
    checkin_time: state.checkin_time,
    checkout_time: state.checkout_time,
    channels: state.channels,
    rules: state.rules ?? state.house_rules,
    wifi: state.wifi,
    wifi_name: state.wifi_name,
    wifi_password: state.wifi_password,
    wifi_skipped: state.wifi_skipped,
    photos: state.photos,
    photos_intent: state.photos_intent,
    photos_count: state.photos_count,
    property_name: state.property_name,
    house_rules: state.house_rules,
    checkin_checkout: state.checkin_checkout,
    onboardingStatus: state.status,
  };
}
