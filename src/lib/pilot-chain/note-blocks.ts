import type { CrmContact, CrmOnboardingStatus, CrmOwnerObject } from '@/lib/crm/types';
import { buildChannelManagerConnectionHref } from '@/lib/channel-manager-connection/flow';
import type { ObjectReadinessResult } from '@/lib/object-readiness/engine';
import { REQUIRED_FIELD_LABELS_RU } from '@/lib/object-readiness/engine';

export const ONBOARDING_NOTE_HEADER = 'Онбординг ASI';
export const OWNER_OBJECTS_NOTE_HEADER = 'Объекты владельца';

const STRUCTURED_BLOCK_HEADERS = new Set([
  ONBOARDING_NOTE_HEADER,
  OWNER_OBJECTS_NOTE_HEADER,
  'Подключение МК ASI',
]);

export function extractObjectIdFromNote(note: string | null | undefined): string | null {
  const raw = String(note ?? '');
  const objectMatch = raw.match(/object_id=([^\s\n]+)/);
  if (objectMatch?.[1]) return objectMatch[1];
  const propertyMatch = raw.match(/property_id=([^\s\n]+)/);
  return propertyMatch?.[1] ?? null;
}

export function extractLinkedObjectId(contact: CrmContact): string | null {
  const fromOwner = contact.ownerObjects?.[0]?.objectId?.trim();
  if (fromOwner) return fromOwner;
  const fromOnboarding = extractObjectIdFromNote(contact.note);
  if (fromOnboarding) return fromOnboarding;
  const fromCm = contact.channelManagerConnection?.objectId?.trim();
  if (fromCm) return fromCm;
  return null;
}

export function defaultObjectTitleForContact(contact: CrmContact): string {
  if (contact.activeObjectTitle?.trim()) return contact.activeObjectTitle.trim();
  if (contact.city.trim()) return `Объект в ${contact.city.trim()}`;
  if (contact.name.trim()) return `Объект ${contact.name.trim()}`;
  return 'Новый объект';
}

function noteWithoutStructuredBlocks(note: string): string {
  const lines = String(note ?? '').split('\n');
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (STRUCTURED_BLOCK_HEADERS.has(trimmed)) {
      index += 1;
      while (index < lines.length && lines[index].trim() !== '') index += 1;
      if (lines[index]?.trim() === '') index += 1;
      continue;
    }
    kept.push(lines[index]);
    index += 1;
  }
  return kept.join('\n').trim();
}

export function buildOwnerObjectsNoteBlock(objects: CrmOwnerObject[]): string {
  if (objects.length === 0) return '';
  const lines = objects.map(
    (item) =>
      `${item.objectId} | ${item.title} | готовность: ${item.readinessPercent ?? 0}% | активная сессия: ${item.isActiveSession ? 'да' : 'нет'}`,
  );
  return [OWNER_OBJECTS_NOTE_HEADER, ...lines].join('\n');
}

export function buildOnboardingNoteBlock(input: {
  objectId: string;
  contactId: string;
  onboardingStatus: CrmOnboardingStatus;
  readiness: ObjectReadinessResult;
  contact: CrmContact;
  channelManagerHref: string;
  lastMessage?: string;
}): string {
  const onboarding = input.contact.onboarding;
  const missingLabels = input.readiness.missing_required_labels_ru.length
    ? input.readiness.missing_required_labels_ru.join(', ')
    : 'ничего';

  return [
    ONBOARDING_NOTE_HEADER,
    `object_id=${input.objectId}`,
    `contact_id=${input.contactId}`,
    `Статус: ${input.onboardingStatus}`,
    `Готовность: ${input.readiness.readiness_percent}%`,
    `Статус готовности: ${input.readiness.readiness_status_label_ru}`,
    input.contact.city ? `Город: ${input.contact.city}` : null,
    onboarding?.objectType ? `Тип объекта: ${onboarding.objectType}` : null,
    onboarding?.checkinTime ? `Заезд: ${onboarding.checkinTime}` : null,
    onboarding?.checkoutTime ? `Выезд: ${onboarding.checkoutTime}` : null,
    onboarding?.channels?.length ? `Каналы: ${onboarding.channels.join(', ')}` : null,
    onboarding?.rules?.length ? `Правила: ${onboarding.rules.join(', ')}` : null,
    onboarding?.wifiName ? `Wi-Fi имя: ${onboarding.wifiName}` : null,
    onboarding?.wifiPassword ? `Wi-Fi пароль: ${onboarding.wifiPassword}` : null,
    `Фото: ${onboarding?.photosCount ?? 0}`,
    `Не хватает: ${missingLabels}`,
    input.readiness.missing_optional_labels_ru.length
      ? `Не хватает (дополнительно): ${input.readiness.missing_optional_labels_ru.join(', ')}`
      : null,
    `Следующий шаг: ${input.readiness.next_best_step_ru}`,
    `Последнее сообщение: ${input.lastMessage ?? 'создано из CRM'}`,
    `Менеджер каналов: ${input.channelManagerHref}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function mergePilotChainNoteBlocks(input: {
  existingNote: string;
  ownerObjects: CrmOwnerObject[];
  onboardingBlock: string;
}): string {
  const base = noteWithoutStructuredBlocks(input.existingNote);
  const ownerBlock = buildOwnerObjectsNoteBlock(input.ownerObjects);
  return [base, ownerBlock, input.onboardingBlock].filter(Boolean).join('\n\n').slice(0, 4000);
}

export function mapReadinessToOnboardingStatus(readiness: ObjectReadinessResult): CrmOnboardingStatus {
  if (readiness.readiness_status === 'ready_for_channel_manager') return 'ready_for_channel_manager';
  if (readiness.required_done_count === 0) return 'onboarding_started';
  return 'missing_required_data';
}

export function readinessInputFromContact(contact: CrmContact): {
  address?: string;
  object_type?: string;
  checkin_time?: string;
  checkout_time?: string;
  channels?: string[];
  rules?: string[];
  wifi_name?: string;
  wifi_password?: string;
  photos_count?: number;
  onboardingStatus?: CrmOnboardingStatus;
} {
  const onboarding = contact.onboarding;
  return {
    address: contact.city || undefined,
    object_type: onboarding?.objectType ?? undefined,
    checkin_time: onboarding?.checkinTime ?? undefined,
    checkout_time: onboarding?.checkoutTime ?? undefined,
    channels: onboarding?.channels,
    rules: onboarding?.rules,
    wifi_name: onboarding?.wifiName ?? undefined,
    wifi_password: onboarding?.wifiPassword ?? undefined,
    photos_count: onboarding?.photosCount ?? undefined,
    onboardingStatus: onboarding?.status,
  };
}

export function missingFieldLabelsForOps(readiness: ObjectReadinessResult): string[] {
  return readiness.missing_required_fields.map((field) => REQUIRED_FIELD_LABELS_RU[field]);
}

export function buildChannelManagerHrefForContact(contactId: string, objectId: string): string {
  return buildChannelManagerConnectionHref({
    objectId,
    contactId,
    source: 'pilot_chain',
  });
}

export function buildObjectSetupHref(objectId: string): string {
  return `/dashboard/properties/prepare?propertyId=${encodeURIComponent(objectId)}`;
}

export function buildOpsBoardHref(): string {
  return '/dashboard/ops';
}
