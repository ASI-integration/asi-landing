export const PILOT_READINESS_CHECKS = [
  'name',
  'address',
  'description',
  'rules',
  'checkin_checkout',
  'wifi_access',
  'photos',
  'channels',
  'communication_mode',
  'operator',
] as const;

export type PilotReadinessCheckId = (typeof PILOT_READINESS_CHECKS)[number];

export const PILOT_READINESS_CHECK_LABELS_RU: Record<PilotReadinessCheckId, string> = {
  name: 'Название объекта',
  address: 'Адрес или локация',
  description: 'Описание',
  rules: 'Правила проживания',
  checkin_checkout: 'Время заезда и выезда',
  wifi_access: 'Wi‑Fi или инструкции доступа',
  photos: 'Фото или отметка «добавим позже»',
  channels: 'Каналы бронирования',
  communication_mode: 'Режим коммуникации',
  operator: 'Оператор для эскалаций',
};

export type PilotReadinessCheck = {
  id: PilotReadinessCheckId;
  labelRu: string;
  ok: boolean;
  detailRu: string | null;
};

export type PilotObjectSnapshot = {
  propertyId: string;
  objectLabel: string | null;
  name: string | null;
  address: string | null;
  description: string | null;
  rules: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  wifiSkipped: boolean;
  accessNotes: string | null;
  checkinInstructions: string | null;
  photosDeferred: boolean;
  photosCount: number;
  bookingChannels: string | null;
  communicationMode: string | null;
  contactId: string | null;
  ownerName: string | null;
};

export type PilotReadinessResult = {
  propertyId: string;
  objectLabel: string | null;
  ready: boolean;
  checks: PilotReadinessCheck[];
  missingCheckIds: PilotReadinessCheckId[];
  missingLabelsRu: string[];
};

export const PILOT_ACCEPTANCE_PREFIX = 'ASI_PILOT_READINESS_ACCEPTANCE_';
