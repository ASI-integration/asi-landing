import type { CrmContact, CrmOnboardingStatus } from './types';
import type { CrmEventRow } from './queue-events';
import type { CrmQueueItem } from './queue';

export const CRM_ACTIVITY_FEED_LIMIT = 50;
export const CRM_CARD_ACTIVITY_LIMIT = 5;

export type CrmActivityTone = 'done' | 'pending' | 'processing' | 'attention';

export type CrmActivityItem = {
  id: string;
  label: string;
  tone: CrmActivityTone;
  createdAt: string;
};

export type CrmActivityFeedEntry = CrmActivityItem & {
  actor: 'ASI' | 'Владелец' | 'Гость' | 'Система' | 'Оператор';
  objectTitle: string | null;
  contactId: string | null;
};

export type CrmOperationalStatus = 'ready' | 'waiting_owner' | 'processing' | 'needs_attention';

export const CRM_OPERATIONAL_STATUS_LABELS: Record<CrmOperationalStatus, string> = {
  ready: 'Готово',
  waiting_owner: 'Ожидает ответ владельца',
  processing: 'ASI обрабатывает данные',
  needs_attention: 'Требует внимания',
};

const ONBOARDING_FIELD_KEYS = [
  'address',
  'property_name',
  'house_rules',
  'wifi',
  'checkin_checkout',
  'photos',
  'channels',
] as const;

type OnboardingFieldKey = (typeof ONBOARDING_FIELD_KEYS)[number];

const FIELD_KEY_ALIASES: Record<string, OnboardingFieldKey> = {
  address: 'address',
  'адрес': 'address',
  'адрес объекта': 'address',
  property_name: 'property_name',
  'название или тип объекта': 'property_name',
  object_type: 'property_name',
  'тип объекта': 'property_name',
  checkin_time: 'checkin_checkout',
  checkout_time: 'checkin_checkout',
  'время выезда': 'checkin_checkout',
  rules: 'house_rules',
  'правила': 'house_rules',
  'название объекта': 'property_name',
  house_rules: 'house_rules',
  'правила проживания': 'house_rules',
  wifi: 'wifi',
  'wi-fi': 'wifi',
  checkin_checkout: 'checkin_checkout',
  'время заезда и выезда': 'checkin_checkout',
  'время заезда': 'checkin_checkout',
  photos: 'photos',
  'фото': 'photos',
  'фото объекта': 'photos',
  channels: 'channels',
  'каналы': 'channels',
  'каналы бронирования': 'channels',
};

const FIELD_DONE_LABELS: Record<OnboardingFieldKey, string> = {
  address: 'Адрес сохранён',
  property_name: 'Тип объекта определён',
  house_rules: 'Правила проживания сохранены',
  wifi: 'Wi-Fi сохранён',
  checkin_checkout: 'Время заезда сохранено',
  photos: 'Фото можно добавить позже',
  channels: 'Каналы сохранены',
};

const FIELD_PENDING_LABELS: Record<OnboardingFieldKey, string> = {
  address: 'Ожидается адрес',
  property_name: 'Ожидается тип объекта',
  house_rules: 'Запрошены правила проживания',
  wifi: 'Ожидается Wi-Fi',
  checkin_checkout: 'Ожидается время заезда',
  photos: 'Ожидаются фото',
  channels: 'Ожидаются каналы',
};

const FIELD_FEED_DONE: Record<OnboardingFieldKey, string> = {
  address: 'сохранила адрес объекта',
  property_name: 'определила тип объекта',
  house_rules: 'сохранила правила проживания',
  wifi: 'сохранила данные Wi-Fi',
  checkin_checkout: 'сохранила время заезда',
  photos: 'отметила фото как «добавить позже»',
  channels: 'сохранила каналы бронирования',
};

const FIELD_FEED_PENDING: Record<OnboardingFieldKey, string> = {
  address: 'ожидает адрес объекта',
  property_name: 'ожидает тип объекта',
  house_rules: 'запросила правила проживания',
  wifi: 'ожидает данные Wi-Fi',
  checkin_checkout: 'ожидает время заезда',
  photos: 'ожидает фото объекта',
  channels: 'ожидает каналы бронирования',
};

const ONBOARDING_STATUS_FEED: Partial<Record<CrmOnboardingStatus, { label: string; tone: CrmActivityTone }>> = {
  onboarding_started: { label: 'начала подключение объекта', tone: 'processing' },
  missing_required_data: { label: 'запросила недостающие данные', tone: 'processing' },
  ready_for_channel_manager: { label: 'подготовила переход к Менеджеру Каналов', tone: 'done' },
  channel_manager_started: { label: 'открыла Менеджер Каналов', tone: 'done' },
  needs_operator: { label: 'передала задачу оператору', tone: 'attention' },
};

export const CRM_EVENT_FEED: Record<string, { actor: CrmActivityFeedEntry['actor']; label: string; tone: CrmActivityTone }> = {
  guest_concierge_answered: { actor: 'ASI', label: 'ответила гостю', tone: 'done' },
  autopilot_guest_reply: { actor: 'ASI', label: 'ответила гостю', tone: 'done' },
  conversation_resolved: { actor: 'ASI', label: 'закрыла обращение', tone: 'done' },
  autopilot_clarification_requested: { actor: 'ASI', label: 'запросила уточнение', tone: 'processing' },
  autopilot_operator_handoff: { actor: 'ASI', label: 'передала оператору', tone: 'attention' },
  auto_reply: { actor: 'ASI', label: 'отправила автоответ', tone: 'done' },
  message_outbound: { actor: 'ASI', label: 'отправила сообщение', tone: 'done' },
  message_inbound: { actor: 'Владелец', label: 'отправил сообщение', tone: 'processing' },
  missing_data: { actor: 'ASI', label: 'зафиксировала недостающие данные', tone: 'attention' },
  guest_test_missing_data: { actor: 'ASI', label: 'зафиксировала недостающие данные', tone: 'attention' },
  operator_followup_required: { actor: 'Гость', label: 'запросил помощь оператора', tone: 'attention' },
  operator_followup_sent: { actor: 'ASI', label: 'отправила запрос оператору', tone: 'processing' },
  operator_reply_sent: { actor: 'ASI', label: 'отправила ответ от оператора', tone: 'done' },
  guest_test_question: { actor: 'Гость', label: 'задал вопрос', tone: 'processing' },
  guest_test_started: { actor: 'ASI', label: 'запустила тест гостя', tone: 'processing' },
  guest_test_ready: { actor: 'ASI', label: 'подготовила тест гостя', tone: 'done' },
  guest_test_passed_basic: { actor: 'ASI', label: 'подтвердила базовый тест гостя', tone: 'done' },
  role_selected_owner: { actor: 'Владелец', label: 'выбрал роль владельца', tone: 'done' },
  role_selected_lead: { actor: 'Владелец', label: 'выбрал роль лида', tone: 'done' },
  role_selected_guest: { actor: 'Гость', label: 'выбрал роль гостя', tone: 'done' },
  pilot_application_submitted: { actor: 'Владелец', label: 'отправил заявку на пилот', tone: 'processing' },
  pilot_selected: { actor: 'ASI', label: 'зафиксировала выбор пилотного объекта', tone: 'done' },
  status_change: { actor: 'ASI', label: 'обновила статус подключения', tone: 'processing' },
  escalation: { actor: 'ASI', label: 'эскалировала задачу', tone: 'attention' },
  blocked: { actor: 'ASI', label: 'заблокировала автоответ', tone: 'attention' },
  note: { actor: 'ASI', label: 'добавила заметку', tone: 'processing' },
  object_readiness_updated: { actor: 'ASI', label: 'обновила готовность объекта', tone: 'processing' },
  object_readiness_missing_photos: { actor: 'ASI', label: 'обнаружила недостающие фото', tone: 'pending' },
  object_readiness_ready_for_cm: {
    actor: 'ASI',
    label: 'перевела объект в «Готов к Менеджеру Каналов»',
    tone: 'done',
  },
  object_readiness_requested_channels: { actor: 'ASI', label: 'запросила каналы бронирования', tone: 'pending' },
  onboarding_channel_saved: { actor: 'ASI', label: 'сохранила канал бронирования', tone: 'done' },
  owner_object_created: { actor: 'ASI', label: 'создала новый объект', tone: 'processing' },
  owner_object_switched: { actor: 'ASI', label: 'переключила активный объект', tone: 'processing' },
  owner_object_continued: { actor: 'ASI', label: 'продолжила работу с объектом', tone: 'processing' },
  channel_manager_flow_prepared: {
    actor: 'ASI',
    label: 'подготовила переход к Менеджеру Каналов',
    tone: 'done',
  },
  channel_manager_method_selected: {
    actor: 'ASI',
    label: 'зафиксировала способ подключения каналов',
    tone: 'done',
  },
  channel_manager_access_requested: { actor: 'ASI', label: 'запросила доступы', tone: 'pending' },
  channel_manager_needs_operator: {
    actor: 'ASI',
    label: 'отметила подключение как требующее оператора',
    tone: 'attention',
  },
  channel_manager_connection_prepared: {
    actor: 'ASI',
    label: 'подготовила подключение каналов',
    tone: 'done',
  },
  crm_queue_archived: {
    actor: 'Оператор',
    label: 'скрыл объект из очереди CRM',
    tone: 'processing',
  },
};

function normalizeFieldKey(raw: string): OnboardingFieldKey | null {
  const key = raw.trim().toLowerCase();
  return FIELD_KEY_ALIASES[key] ?? null;
}

function normalizeMissingFields(missing: string[]): Set<OnboardingFieldKey> {
  const result = new Set<OnboardingFieldKey>();
  for (const item of missing) {
    const key = normalizeFieldKey(item);
    if (key) result.add(key);
  }
  return result;
}

function objectTitleFor(contact: CrmContact): string {
  if (contact.activeObjectTitle?.trim()) return contact.activeObjectTitle.trim();
  if (contact.city.trim()) return `Объект в ${contact.city.trim()}`;
  if (contact.objectsCount > 0) return `Объект (${contact.objectsCount})`;
  return contact.name.trim() || 'Новый объект';
}

function offsetIso(baseIso: string, minutesAgo: number): string {
  const base = new Date(baseIso).getTime();
  return new Date(base - minutesAgo * 60_000).toISOString();
}

export function resolveOperationalStatus(
  contact: CrmContact,
  item: Pick<CrmQueueItem, 'needsOperator' | 'readyForChannelManager' | 'column'>
): CrmOperationalStatus {
  if (item.needsOperator) return 'needs_attention';
  if (item.readyForChannelManager || item.column === 'ready_for_cm') return 'ready';
  if (item.column === 'completed') return 'ready';
  if (item.column === 'new_lead') return 'waiting_owner';
  if (contact.communicationStatus === 'waiting_reply' || contact.communicationStatus === 'no_contact') {
    return 'waiting_owner';
  }
  if (item.column === 'onboarding' || item.column === 'missing_data') return 'processing';
  return 'processing';
}

function onboardingFieldActivities(contact: CrmContact): CrmActivityItem[] {
  const onboarding = contact.onboarding;
  if (!onboarding) return [];

  const missingKeys = normalizeMissingFields(onboarding.missing);
  const activities: CrmActivityItem[] = [];
  const baseTime = contact.updatedAt || contact.lastContactAt || contact.createdAt;

  ONBOARDING_FIELD_KEYS.forEach((field, index) => {
    const isMissing = missingKeys.has(field);
    activities.push({
      id: `${contact.id}:field:${field}`,
      label: isMissing ? FIELD_PENDING_LABELS[field] : FIELD_DONE_LABELS[field],
      tone: isMissing ? 'pending' : 'done',
      createdAt: offsetIso(baseTime, ONBOARDING_FIELD_KEYS.length - index),
    });
  });

  const statusMeta = ONBOARDING_STATUS_FEED[onboarding.status];
  if (statusMeta) {
    activities.push({
      id: `${contact.id}:status:${onboarding.status}`,
      label: statusMeta.label.charAt(0).toUpperCase() + statusMeta.label.slice(1),
      tone: statusMeta.tone,
      createdAt: baseTime,
    });
  }

  return activities;
}

function onboardingFieldFeedEntries(contact: CrmContact): CrmActivityFeedEntry[] {
  const onboarding = contact.onboarding;
  if (!onboarding) return [];

  const missingKeys = normalizeMissingFields(onboarding.missing);
  const objectTitle = objectTitleFor(contact);
  const baseTime = contact.updatedAt || contact.lastContactAt || contact.createdAt;
  const entries: CrmActivityFeedEntry[] = [];

  for (const [index, field] of ONBOARDING_FIELD_KEYS.entries()) {
    const isMissing = missingKeys.has(field);
    entries.push({
      id: `${contact.id}:feed:field:${field}`,
      actor: 'ASI',
      label: isMissing ? FIELD_FEED_PENDING[field] : FIELD_FEED_DONE[field],
      tone: isMissing ? 'pending' : 'done',
      createdAt: offsetIso(baseTime, ONBOARDING_FIELD_KEYS.length - index + 2),
      objectTitle,
      contactId: contact.id,
    });
  }

  const statusMeta = ONBOARDING_STATUS_FEED[onboarding.status];
  if (statusMeta) {
    entries.push({
      id: `${contact.id}:feed:status:${onboarding.status}`,
      actor: 'ASI',
      label: statusMeta.label,
      tone: statusMeta.tone,
      createdAt: baseTime,
      objectTitle,
      contactId: contact.id,
    });
  }

  return entries;
}

function crmEventToFeedEntry(row: CrmEventRow, contact?: CrmContact): CrmActivityFeedEntry | null {
  const mapped = CRM_EVENT_FEED[row.event_type];
  if (!mapped) return null;

  const metadata = row.metadata ?? {};
  let label = mapped.label;
  let tone = mapped.tone;
  let actor = mapped.actor;

  if (row.event_type === 'missing_data' || row.event_type === 'guest_test_missing_data') {
    const missingFields = Array.isArray(metadata.missing_fields)
      ? metadata.missing_fields.map(String)
      : [];
    if (missingFields.length > 0) {
      const first = normalizeFieldKey(missingFields[0] ?? '');
      if (first) {
        label = FIELD_FEED_PENDING[first];
        tone = 'pending';
      }
    }
  }

  if (row.event_type === 'message_inbound') {
    const role = typeof metadata.role === 'string' ? metadata.role : '';
    if (role === 'guest') actor = 'Гость';
    else if (role === 'owner' || role === 'manager') actor = 'Владелец';
  }

  if (row.event_type === 'object_readiness_updated') {
    const percent = metadata.readiness_percent;
    if (typeof percent === 'number') {
      label = `обновила готовность объекта: ${percent}%`;
    }
  }

  if (
    row.event_type === 'owner_object_created' ||
    row.event_type === 'owner_object_switched' ||
    row.event_type === 'owner_object_continued'
  ) {
    const objectId = typeof metadata.object_id === 'string' ? metadata.object_id : '';
    if (objectId) {
      label = `${mapped.label} (${objectId})`;
    }
  }

  if (row.event_type === 'onboarding_channel_saved') {
    const channelLabel = typeof metadata.channel_label === 'string' ? metadata.channel_label.trim() : '';
    if (channelLabel) {
      label = `сохранила канал бронирования: ${channelLabel}`;
    }
  }

  if (row.event_type === 'channel_manager_method_selected') {
    const methodLabel = typeof metadata.method_label === 'string' ? metadata.method_label.trim() : '';
    if (methodLabel) {
      label = `выбрала способ подключения: ${methodLabel}`;
    }
  }

  if (row.event_type === 'channel_manager_connection_prepared') {
    label = 'подготовила подключение каналов';
  }

  return {
    id: row.id,
    actor,
    label,
    tone,
    createdAt: row.created_at,
    objectTitle: contact ? objectTitleFor(contact) : null,
    contactId: row.contact_id,
  };
}

function cardLabelFromFeed(entry: CrmActivityFeedEntry): string {
  const pending = Object.entries(FIELD_FEED_PENDING).find(([, value]) => value === entry.label);
  if (pending) return FIELD_PENDING_LABELS[pending[0] as OnboardingFieldKey];
  const done = Object.entries(FIELD_FEED_DONE).find(([, value]) => value === entry.label);
  if (done) return FIELD_DONE_LABELS[done[0] as OnboardingFieldKey];
  return entry.label.charAt(0).toUpperCase() + entry.label.slice(1);
}

export function buildCardActivities(
  contact: CrmContact,
  events: CrmEventRow[] = [],
  limit = CRM_CARD_ACTIVITY_LIMIT
): CrmActivityItem[] {
  const fromEvents = events
    .map((row) => {
      const feed = crmEventToFeedEntry(row, contact);
      if (!feed) return null;
      return {
        id: feed.id,
        label: cardLabelFromFeed(feed),
        tone: feed.tone,
        createdAt: feed.createdAt,
      } satisfies CrmActivityItem;
    })
    .filter(Boolean) as CrmActivityItem[];

  const fromOnboarding = onboardingFieldActivities(contact);
  const merged = [...fromEvents, ...fromOnboarding];
  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const seen = new Set<string>();
  const unique: CrmActivityItem[] = [];
  for (const item of merged) {
    if (seen.has(item.label)) continue;
    seen.add(item.label);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function buildActivityFeed(
  contacts: CrmContact[],
  events: CrmEventRow[] = [],
  limit = CRM_ACTIVITY_FEED_LIMIT
): CrmActivityFeedEntry[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const fromEvents = events
    .map((row) => crmEventToFeedEntry(row, contactById.get(row.contact_id)))
    .filter(Boolean) as CrmActivityFeedEntry[];

  const fromOnboarding = contacts.flatMap((contact) => onboardingFieldFeedEntries(contact));
  const merged = [...fromEvents, ...fromOnboarding];
  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const seen = new Set<string>();
  const unique: CrmActivityFeedEntry[] = [];
  for (const item of merged) {
    const key = `${item.contactId ?? 'none'}:${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function formatFeedLine(entry: CrmActivityFeedEntry): string {
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(entry.createdAt));
  return `${time} ${entry.actor} ${entry.label}`;
}

export function activityToneEmoji(tone: CrmActivityTone): string {
  switch (tone) {
    case 'done':
      return '🟢';
    case 'pending':
      return '🟡';
    case 'attention':
      return '🔴';
    default:
      return '🟣';
  }
}

export function operationalStatusEmoji(status: CrmOperationalStatus): string {
  switch (status) {
    case 'ready':
      return '🟢';
    case 'waiting_owner':
      return '🟡';
    case 'needs_attention':
      return '🔴';
    default:
      return '🟣';
  }
}
