export const OWNER_SETUP_STATUSES = [
  'new',
  'instruction_sent',
  'data_collection_started',
  'data_incomplete',
  'data_ready',
  'access_requested',
  'access_received',
  'test_object_selected',
  'ready_for_setup',
  'blocked',
] as const;

export type OwnerSetupStatus = (typeof OWNER_SETUP_STATUSES)[number];

export const PROPERTY_SETUP_STATUSES = [
  'new',
  'collecting_data',
  'incomplete',
  'ready_for_review',
  'ready_for_channel_preparation',
  'blocked',
] as const;

export type PropertySetupStatus = (typeof PROPERTY_SETUP_STATUSES)[number];

export const PROPERTY_WIFI_STATUSES = ['unknown', 'missing', 'provided', 'verified'] as const;
export type PropertyWifiStatus = (typeof PROPERTY_WIFI_STATUSES)[number];

export const PROPERTY_RULES_STATUSES = ['missing', 'partial', 'complete'] as const;
export type PropertyRulesStatus = (typeof PROPERTY_RULES_STATUSES)[number];

export const PROPERTY_PHOTOS_STATUSES = ['missing', 'partial', 'enough', 'ready'] as const;
export type PropertyPhotosStatus = (typeof PROPERTY_PHOTOS_STATUSES)[number];

export const PROPERTY_PRICING_STATUSES = ['missing', 'partial', 'ready'] as const;
export type PropertyPricingStatus = (typeof PROPERTY_PRICING_STATUSES)[number];

export const PROPERTY_CHANNEL_ACCESS_STATUSES = [
  'not_requested',
  'requested',
  'received',
  'invalid',
  'blocked',
] as const;
export type PropertyChannelAccessStatus = (typeof PROPERTY_CHANNEL_ACCESS_STATUSES)[number];

export const OWNER_SETUP_PILOT_GROUPS = ['bragin', 'strigunov', 'other'] as const;
export type OwnerSetupPilotGroup = (typeof OWNER_SETUP_PILOT_GROUPS)[number];

export const PROPERTY_ASSET_TYPES = ['photo', 'document', 'instruction', 'video', 'other'] as const;
export type PropertyAssetType = (typeof PROPERTY_ASSET_TYPES)[number];

export const PROPERTY_ASSET_STATUSES = ['uploaded', 'accepted', 'rejected', 'needs_replacement'] as const;
export type PropertyAssetStatus = (typeof PROPERTY_ASSET_STATUSES)[number];

export const CHANNEL_HANDOFF_STATUSES = [
  'ready_for_channel_preparation',
  'manual_channel_publication_pending',
  'channel_access_received',
  'object_data_ready',
  'publication_blocked',
] as const;

export type ChannelHandoffStatus = (typeof CHANNEL_HANDOFF_STATUSES)[number];

export type PropertySetupReadinessInput = {
  status: PropertySetupStatus;
  title: string | null;
  addressCity: string | null;
  addressSafeSummary: string | null;
  propertyType: string | null;
  roomCount: number | null;
  guestCapacity: number | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  wifiStatus: PropertyWifiStatus;
  rulesStatus: PropertyRulesStatus;
  photosStatus: PropertyPhotosStatus;
  pricingStatus: PropertyPricingStatus;
  channelAccessStatus: PropertyChannelAccessStatus;
};

const MISSING_FIELD_LABELS_RU: Record<string, string> = {
  title: 'название объекта',
  address: 'город или район',
  property_type: 'тип объекта',
  capacity: 'вместимость',
  checkin_checkout: 'время заезда и выезда',
  rules: 'правила проживания',
  photos: 'фотографии',
  pricing: 'базовая цена',
  channel_access: 'доступ к менеджеру каналов',
  wifi: 'данные Wi-Fi',
};

const OWNER_SETUP_STATUS_LABELS_RU: Record<OwnerSetupStatus, string> = {
  new: 'Новый',
  instruction_sent: 'Инструкция отправлена',
  data_collection_started: 'Сбор данных начат',
  data_incomplete: 'Данные неполные',
  data_ready: 'Данные готовы',
  access_requested: 'Запрошен доступ',
  access_received: 'Доступ получен',
  test_object_selected: 'Тестовый объект выбран',
  ready_for_setup: 'Готов к настройке',
  blocked: 'Заблокирован',
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function labelMissingField(key: string): string {
  return MISSING_FIELD_LABELS_RU[key] ?? key;
}

export function ownerSetupStatusLabel(status: OwnerSetupStatus): string {
  return OWNER_SETUP_STATUS_LABELS_RU[status] ?? status;
}

export function getMissingPropertySetupFields(profile: PropertySetupReadinessInput): string[] {
  const missing: string[] = [];
  if (!text(profile.title)) missing.push('title');
  if (!text(profile.addressCity) && !text(profile.addressSafeSummary)) missing.push('address');
  if (!text(profile.propertyType)) missing.push('property_type');
  if (!profile.guestCapacity && !profile.roomCount) missing.push('capacity');
  if (!text(profile.checkinTime) || !text(profile.checkoutTime)) missing.push('checkin_checkout');
  if (profile.rulesStatus === 'missing') missing.push('rules');
  if (!['enough', 'ready', 'partial'].includes(profile.photosStatus)) missing.push('photos');
  if (profile.pricingStatus === 'missing') missing.push('pricing');
  if (!['received', 'requested'].includes(profile.channelAccessStatus)) missing.push('channel_access');
  if (profile.wifiStatus === 'missing') missing.push('wifi');
  return missing;
}

export function computePropertySetupReadiness(profile: PropertySetupReadinessInput): {
  readinessScore: number;
  missingFields: string[];
  status: PropertySetupStatus;
} {
  const missingFields = getMissingPropertySetupFields(profile);
  const weights = {
    title: 12,
    address: 12,
    property_type: 10,
    capacity: 10,
    checkin_checkout: 12,
    rules: 10,
    photos: 14,
    pricing: 10,
    channel_access: 10,
  };
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const lost = missingFields.reduce((sum, key) => sum + (weights[key as keyof typeof weights] ?? 5), 0);
  const readinessScore = Math.max(0, Math.round(((total - lost) / total) * 100));

  let status: PropertySetupStatus = profile.status;
  if (profile.status !== 'blocked') {
    if (missingFields.length === 0 && readinessScore >= 85) {
      status = profile.channelAccessStatus === 'received'
        ? 'ready_for_channel_preparation'
        : 'ready_for_review';
    } else if (missingFields.length > 0) {
      status = profile.status === 'new' ? 'collecting_data' : 'incomplete';
    }
  }

  return { readinessScore, missingFields, status };
}
