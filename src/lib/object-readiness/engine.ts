import type { OwnerOnboardingField } from '@/lib/communication/owner-onboarding-smart-parser';
import type { OwnerOnboardingStatus } from '@/lib/communication/telegram-owner-onboarding';

export type ObjectReadinessRequiredField = OwnerOnboardingField;

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
  'property_name',
  'house_rules',
  'wifi',
  'checkin_checkout',
  'photos',
  'channels',
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
  property_name: 'тип объекта',
  house_rules: 'правила проживания',
  wifi: 'Wi-Fi',
  checkin_checkout: 'время заезда и выезда',
  photos: 'фото объекта',
  channels: 'каналы бронирования',
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
  ready_for_channel_manager: 'Готов к Менеджеру каналов',
  needs_attention: 'Требует внимания',
  completed: 'Завершено',
};

const NEXT_STEP_BY_FIELD: Record<ObjectReadinessRequiredField, string> = {
  address: 'Попросить владельца указать адрес объекта',
  property_name: 'Попросить владельца указать тип объекта',
  house_rules: 'Попросить владельца прислать правила проживания',
  wifi: 'Попросить владельца прислать данные Wi-Fi',
  checkin_checkout: 'Попросить владельца указать время заезда и выезда',
  photos: 'Попросить владельца добавить фото',
  channels: 'Запросить каналы бронирования',
};

export type ObjectReadinessInput = {
  address?: string;
  property_name?: string;
  house_rules?: string;
  wifi?: string;
  checkin_checkout?: string;
  photos?: string;
  photos_intent?: 'now' | 'later' | null;
  channels?: string;
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

function isRequiredFieldDone(input: ObjectReadinessInput, field: ObjectReadinessRequiredField): boolean {
  if (field === 'photos') {
    return Boolean(text(input.photos)) || input.photos_intent === 'later';
  }
  return Boolean(text(input[field]));
}

function detectOptionalFromText(input: ObjectReadinessInput): Set<ObjectReadinessOptionalField> {
  const found = new Set<ObjectReadinessOptionalField>();
  const rules = text(input.house_rules).toLowerCase();
  const extras = [
    { field: 'parking' as const, value: input.parking, patterns: [/парков/] },
    { field: 'deposit' as const, value: input.deposit, patterns: [/залог/] },
    { field: 'checkin_keys' as const, value: input.checkin_keys, patterns: [/ключ|код|засел|домофон/] },
    { field: 'reporting_docs' as const, value: input.reporting_docs, patterns: [/отч[её]т|документ/] },
    { field: 'pets' as const, value: undefined, patterns: [/животн|питом/] },
    { field: 'guests' as const, value: undefined, patterns: [/гост/] },
    { field: 'quiet_hours' as const, value: undefined, patterns: [/тишин|шум|quiet/] },
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
  const next_best_step_ru = nextField ? NEXT_STEP_BY_FIELD[nextField] : 'Открыть Менеджер каналов';

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
    next_best_step_ru: next_best_step_ru,
  };
}

export function readinessInputFromOnboardingState(state: {
  address?: string;
  property_name?: string;
  house_rules?: string;
  wifi?: string;
  checkin_checkout?: string;
  photos?: string;
  photos_intent?: 'now' | 'later' | null;
  channels?: string;
  status?: OwnerOnboardingStatus;
}): ObjectReadinessInput {
  return {
    address: state.address,
    property_name: state.property_name,
    house_rules: state.house_rules,
    wifi: state.wifi,
    checkin_checkout: state.checkin_checkout,
    photos: state.photos,
    photos_intent: state.photos_intent,
    channels: state.channels,
    onboardingStatus: state.status,
  };
}
