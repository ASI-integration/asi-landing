import type { CrmContact, CrmOnboardingStatus, CrmStatus } from './types';
import type { CrmActivityItem, CrmOperationalStatus } from './activity-feed';
import { CRM_OPERATIONAL_STATUS_LABELS, resolveOperationalStatus } from './activity-feed';
import { resolveChannelManagerQueueSummary, buildChannelManagerConnectionHref } from '@/lib/channel-manager-connection/flow';
import {
  computeObjectReadiness,
  readinessInputFromOnboardingState,
  REQUIRED_FIELD_LABELS_RU,
} from '@/lib/object-readiness/engine';
import { sanitizeCrmMessageTextForDisplay } from './message-display';

export const CRM_QUEUE_COLUMN_VALUES = [
  'new_lead',
  'onboarding',
  'missing_data',
  'ready_for_cm',
  'needs_operator',
  'completed',
] as const;

export type CrmQueueColumn = (typeof CRM_QUEUE_COLUMN_VALUES)[number];

export const CRM_QUEUE_FILTER_VALUES = [
  'all',
  'needs_operator',
  'ready_for_cm',
  'active',
  'completed',
] as const;

export type CrmQueueFilter = (typeof CRM_QUEUE_FILTER_VALUES)[number];

export const CRM_QUEUE_COLUMN_LABELS: Record<CrmQueueColumn, string> = {
  new_lead: 'Новый лид',
  onboarding: 'Идёт подключение',
  missing_data: 'Не хватает данных',
  ready_for_cm: 'Готов к Менеджеру Каналов',
  needs_operator: 'Требует внимания',
  completed: 'Завершено',
};

export const CRM_QUEUE_STATUS_LABELS: Record<CrmOnboardingStatus, string> = {
  onboarding_started: 'Идёт подключение',
  missing_required_data: 'Не хватает данных',
  ready_for_channel_manager: 'Готов к Менеджеру Каналов',
  channel_manager_started: 'Менеджер Каналов открыт',
  needs_operator: 'Требует внимания',
};

export const CRM_QUEUE_FILTER_LABELS: Record<CrmQueueFilter, string> = {
  all: 'Все',
  needs_operator: 'Нужен оператор',
  ready_for_cm: 'Готов к Менеджеру Каналов',
  active: 'Только активные',
  completed: 'Только завершённые',
};

const COMPLETED_STATUSES: CrmStatus[] = ['pilot', 'ready_for_test', 'rejected', 'not_relevant'];
const INACTIVE_STATUSES: CrmStatus[] = ['paused', 'rejected', 'not_relevant'];

const ONBOARDING_FIELD_LABELS: Record<string, string> = {
  address: 'адрес',
  object_type: 'тип объекта',
  property_name: 'название объекта',
  checkin_time: 'время заезда',
  checkout_time: 'время выезда',
  checkin_checkout: 'время заезда и выезда',
  channels: 'каналы',
  rules: 'правила проживания',
  house_rules: 'правила проживания',
  wifi: 'Wi-Fi',
  photos: 'фото',
};

export type CrmQueueMessage = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  status?: string | null;
  guestQuestion?: string | null;
  asiReply?: string | null;
};

export type CrmQueueItem = {
  id: string;
  objectTitle: string;
  ownerName: string;
  telegramUsername: string | null;
  objectsCount: number;
  activeObjectTitle: string | null;
  onboardingStatus: CrmOnboardingStatus | null;
  onboardingStatusLabel: string;
  column: CrmQueueColumn;
  lastContactAt: string | null;
  updatedAt: string;
  missingFields: string[];
  missingOptionalFields: string[];
  readinessPercent: number | null;
  readinessStatusLabel: string | null;
  nextBestStep: string | null;
  readyForChannelManager: boolean;
  needsOperator: boolean;
  channelManagerStatus: string | null;
  channelManagerMethod: string | null;
  channelManagerNextStep: string | null;
  channelManagerHref: string | null;
  propertyId: string | null;
  crmStatus: CrmStatus;
  lastMessagePreview: string | null;
  messages: CrmQueueMessage[];
  operationalStatus: CrmOperationalStatus;
  operationalStatusLabel: string;
  recentActivities: CrmActivityItem[];
  isTestGuest: boolean;
};

export type CrmQueueMetrics = {
  activeObjects: number;
  onboarding: number;
  readyForChannelManager: number;
  needsAttention: number;
  completed: number;
};

function extractPropertyId(note: string): string | null {
  const objectMatch = note.match(/object_id=(OBJ-\d+)/);
  if (objectMatch?.[1]) return objectMatch[1];
  const match = note.match(/property_id=([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function objectTitleFor(contact: CrmContact): string {
  if (contact.activeObjectTitle?.trim()) return contact.activeObjectTitle.trim();
  if (contact.city.trim()) return `Объект в ${contact.city.trim()}`;
  if (contact.objectsCount > 0) return `Объект (${contact.objectsCount})`;
  return contact.name.trim() || 'Новый объект';
}

function channelManagerFieldsFor(contact: CrmContact): {
  status: string | null;
  method: string | null;
  nextStep: string | null;
  href: string;
} {
  const summary = resolveChannelManagerQueueSummary(
    contact.channelManagerConnection,
    contact.onboarding?.status,
  );
  const objectId = extractPropertyId(contact.note);
  const contactId = contact.id;
  const href =
    contact.onboarding?.channelManagerHref ??
    (objectId
      ? buildChannelManagerConnectionHref({ objectId, contactId, source: 'crm_queue' })
      : '/dashboard/channel-connections?source=crm_queue');

  return {
    status: summary.statusLabel,
    method: summary.methodLabel,
    nextStep: summary.nextStep,
    href,
  };
}

function missingFieldsRu(missing: string[]): string[] {
  return missing.map((field) => ONBOARDING_FIELD_LABELS[field] ?? field);
}

function fieldKeyFromLabel(label: string): string | null {
  const normalized = label.trim().toLowerCase();
  for (const [key, value] of Object.entries(ONBOARDING_FIELD_LABELS)) {
    if (value === normalized || normalized.includes(value)) return key;
  }
  for (const [key, value] of Object.entries(REQUIRED_FIELD_LABELS_RU)) {
    if (value === normalized || normalized.includes(value)) return key;
  }
  return null;
}

function readinessForContact(contact: CrmContact) {
  const onboarding = contact.onboarding;
  if (!onboarding) return null;

  const missingKeys = new Set<string>();
  for (const raw of onboarding.missing) {
    const key = fieldKeyFromLabel(raw);
    if (key) missingKeys.add(key);
  }

  const photosIntent: 'later' | undefined =
    onboarding.missing.some((item) => /фото.*позже|позже.*фото/i.test(item)) ||
    (onboarding.photosCount === 0 && onboarding.missing.some((item) => /фото/i.test(item)))
      ? 'later'
      : undefined;

  if (
    onboarding.objectType ||
    onboarding.checkinTime ||
    onboarding.checkoutTime ||
    onboarding.channels?.length ||
    onboarding.rules?.length
  ) {
    return computeObjectReadiness(
      readinessInputFromOnboardingState({
        address: missingKeys.has('address') ? undefined : 'set',
        object_type: onboarding.objectType ?? (missingKeys.has('object_type') || missingKeys.has('property_name') ? undefined : 'set'),
        checkin_time: onboarding.checkinTime ?? (missingKeys.has('checkin_time') || missingKeys.has('checkin_checkout') ? undefined : 'set'),
        checkout_time: onboarding.checkoutTime ?? (missingKeys.has('checkout_time') || missingKeys.has('checkin_checkout') ? undefined : 'set'),
        channels: onboarding.channels?.length ? onboarding.channels : missingKeys.has('channels') ? undefined : 'set',
        rules: onboarding.rules?.length ? onboarding.rules : missingKeys.has('rules') || missingKeys.has('house_rules') ? undefined : 'set',
        wifi_name: onboarding.wifiName ?? undefined,
        wifi_password: onboarding.wifiPassword ?? undefined,
        wifi_skipped: onboarding.wifiName ? false : missingKeys.has('wifi') ? undefined : true,
        photos: (onboarding.photosCount ?? 0) > 0 ? 'set' : undefined,
        photos_intent: photosIntent ?? null,
        photos_count: onboarding.photosCount ?? undefined,
        status: onboarding.status,
      }),
    );
  }

  return computeObjectReadiness(
    readinessInputFromOnboardingState({
      address: missingKeys.has('address') ? undefined : 'set',
      property_name: missingKeys.has('property_name') ? undefined : 'set',
      house_rules: missingKeys.has('house_rules') ? undefined : 'set',
      wifi: missingKeys.has('wifi') ? undefined : 'set',
      checkin_checkout: missingKeys.has('checkin_checkout') ? undefined : 'set',
      photos: missingKeys.has('photos') && !photosIntent ? undefined : photosIntent ? undefined : 'set',
      photos_intent: photosIntent ?? null,
      channels: missingKeys.has('channels') ? undefined : 'set',
      status: onboarding.status,
    }),
  );
}

export function resolveQueueColumn(contact: CrmContact): CrmQueueColumn {
  // Synthetic Telegram guest sessions must stay in active queue columns, not "completed".
  if (isQueueTestGuestContact(queueTestGuestProbeFromContact(contact))) {
    return 'onboarding';
  }

  const onboarding = contact.onboarding;

  if (onboarding) {
    switch (onboarding.status) {
      case 'needs_operator':
        return 'needs_operator';
      case 'ready_for_channel_manager':
        return 'ready_for_cm';
      case 'channel_manager_started':
        return COMPLETED_STATUSES.includes(contact.status) ? 'completed' : 'ready_for_cm';
      case 'missing_required_data':
        return 'missing_data';
      case 'onboarding_started':
        return 'onboarding';
    }
  }

  if (contact.communicationStatus === 'needs_manual_reaction') {
    return 'needs_operator';
  }

  if (contact.status === 'new_lead') return 'new_lead';
  if (COMPLETED_STATUSES.includes(contact.status)) return 'completed';
  if (contact.status === 'waiting_object_data') return 'missing_data';

  if (
    contact.status === 'contact' ||
    contact.status === 'instruction_sent' ||
    contact.status === 'access_received' ||
    contact.status === 'test_object_selected' ||
    contact.status === 'object_setup'
  ) {
    return 'onboarding';
  }

  return 'onboarding';
}

export function isQueueItemActive(contact: CrmContact): boolean {
  return !INACTIVE_STATUSES.includes(contact.status) && resolveQueueColumn(contact) !== 'completed';
}

export function contactNeedsOperator(contact: CrmContact): boolean {
  return resolveQueueColumn(contact) === 'needs_operator';
}

export function contactReadyForChannelManager(contact: CrmContact): boolean {
  const status = contact.onboarding?.status;
  return status === 'ready_for_channel_manager' || status === 'channel_manager_started';
}

export type QueueTestGuestProbe = {
  name: string;
  note?: string | null;
  lastMessage?: string | null;
  source?: string | null;
  role?: string | null;
  status?: string | null;
};

export function queueTestGuestTextBlob(contact: QueueTestGuestProbe): string {
  return [contact.note ?? '', contact.lastMessage ?? ''].join('\n').toLowerCase();
}

export function isQueueTestGuestContact(contact: QueueTestGuestProbe): boolean {
  const name = contact.name.trim().toLowerCase();
  const blob = queueTestGuestTextBlob(contact);

  if (
    blob.includes('guest_test') ||
    blob.includes('guest_autopilot') ||
    blob.includes('testing_communication')
  ) {
    return true;
  }

  if (name === 'telegram guest' || name.includes('telegram guest')) {
    return true;
  }

  const rawRole = String(contact.role ?? '').trim().toLowerCase();
  const rawSource = String(contact.source ?? '').trim().toLowerCase();
  if (rawRole === 'guest') return true;
  if (rawSource === 'test') return true;

  const status = String(contact.status ?? '').trim().toLowerCase();
  if (status === 'testing_communication' && (rawRole === 'guest' || name.includes('guest'))) {
    return true;
  }

  return false;
}

export function queueTestGuestProbeFromContact(contact: CrmContact): QueueTestGuestProbe {
  return {
    name: contact.name,
    note: contact.note,
    lastMessage: contact.onboarding?.lastMessage ?? contact.nextStep,
    source: contact.source,
    role: contact.role,
    status: contact.status,
  };
}

export function buildQueueItem(
  contact: CrmContact,
  messages: CrmQueueMessage[] = [],
  recentActivities: CrmActivityItem[] = []
): CrmQueueItem {
  const column = resolveQueueColumn(contact);
  const onboardingStatus = contact.onboarding?.status ?? null;
  const onboarding = contact.onboarding;
  const missing = onboarding?.missing ?? [];
  const readiness = readinessForContact(contact);

  const flags = {
    needsOperator: contactNeedsOperator(contact),
    readyForChannelManager: contactReadyForChannelManager(contact),
    column,
  };
  const operationalStatus = resolveOperationalStatus(contact, flags);
  const channelManager = channelManagerFieldsFor(contact);

  return {
    id: contact.id,
    objectTitle: objectTitleFor(contact),
    ownerName: contact.name,
    telegramUsername: contact.telegramUsername.trim() || null,
    objectsCount: contact.objectsCount,
    activeObjectTitle: contact.activeObjectTitle ?? null,
    onboardingStatus,
    onboardingStatusLabel: onboardingStatus
      ? CRM_QUEUE_STATUS_LABELS[onboardingStatus]
      : CRM_QUEUE_COLUMN_LABELS[column],
    column,
    lastContactAt: contact.lastContactAt,
    updatedAt: contact.updatedAt,
    missingFields: readiness?.missing_required_labels_ru ?? missingFieldsRu(missing),
    missingOptionalFields: onboarding?.missingOptional?.length
      ? onboarding.missingOptional
      : (readiness?.missing_optional_labels_ru ?? []),
    readinessPercent: onboarding?.readinessPercent ?? readiness?.readiness_percent ?? null,
    readinessStatusLabel:
      onboarding?.readinessStatusLabel ?? readiness?.readiness_status_label_ru ?? null,
    nextBestStep: channelManager.nextStep ?? onboarding?.nextBestStep ?? readiness?.next_best_step_ru ?? null,
    readyForChannelManager: flags.readyForChannelManager,
    needsOperator: flags.needsOperator,
    channelManagerStatus: channelManager.status,
    channelManagerMethod: channelManager.method,
    channelManagerNextStep: channelManager.nextStep,
    channelManagerHref: channelManager.href,
    propertyId: extractPropertyId(contact.note),
    crmStatus: contact.status,
    lastMessagePreview: sanitizeCrmMessageTextForDisplay(
      contact.onboarding?.lastMessage || messages[0]?.text || contact.nextStep || null,
    ),
    messages: messages.map((message) => ({
      ...message,
      text: sanitizeCrmMessageTextForDisplay(message.text) ?? message.text,
      guestQuestion: sanitizeCrmMessageTextForDisplay(message.guestQuestion) ?? message.guestQuestion,
    })),
    operationalStatus,
    operationalStatusLabel: CRM_OPERATIONAL_STATUS_LABELS[operationalStatus],
    recentActivities,
    isTestGuest: isQueueTestGuestContact(queueTestGuestProbeFromContact(contact)),
  };
}

export function buildQueueItems(
  contacts: CrmContact[],
  messagesByContact: Record<string, CrmQueueMessage[]> = {},
  activitiesByContact: Record<string, CrmActivityItem[]> = {}
): CrmQueueItem[] {
  return contacts.map((contact) =>
    buildQueueItem(contact, messagesByContact[contact.id] ?? [], activitiesByContact[contact.id] ?? [])
  );
}

export function filterQueueItems(items: CrmQueueItem[], filter: CrmQueueFilter): CrmQueueItem[] {
  switch (filter) {
    case 'needs_operator':
      return items.filter((item) => item.needsOperator);
    case 'ready_for_cm':
      return items.filter((item) => item.readyForChannelManager);
    case 'active':
      return items.filter((item) => item.column !== 'completed' && !INACTIVE_STATUSES.includes(item.crmStatus));
    case 'completed':
      return items.filter((item) => item.column === 'completed');
    default:
      return items;
  }
}

export function emptyQueueColumns(): Record<CrmQueueColumn, CrmQueueItem[]> {
  return {
    new_lead: [],
    onboarding: [],
    missing_data: [],
    ready_for_cm: [],
    needs_operator: [],
    completed: [],
  };
}

export function groupQueueByColumn(items: CrmQueueItem[]): Record<CrmQueueColumn, CrmQueueItem[]> {
  const grouped = emptyQueueColumns();

  for (const item of items) {
    grouped[item.column].push(item);
  }

  for (const column of CRM_QUEUE_COLUMN_VALUES) {
    grouped[column].sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });
  }

  return grouped;
}

export function isOperatorInboxItem(item: CrmQueueItem): boolean {
  if (!item.needsOperator) return false;
  if (item.column === 'onboarding' || item.column === 'missing_data' || item.column === 'new_lead') {
    return false;
  }
  return item.column === 'needs_operator' || item.operationalStatus === 'needs_attention';
}

export function buildOperatorInbox(items: CrmQueueItem[]): CrmQueueItem[] {
  return items
    .filter((item) => isOperatorInboxItem(item))
    .sort((a, b) => {
      const aTime = new Date(a.lastContactAt ?? a.updatedAt).getTime();
      const bTime = new Date(b.lastContactAt ?? b.updatedAt).getTime();
      return bTime - aTime;
    });
}

export const CRM_QUEUE_ARCHIVABLE_COLUMNS: CrmQueueColumn[] = [
  'new_lead',
  'onboarding',
  'missing_data',
  'ready_for_cm',
  'needs_operator',
];

export const CRM_QUEUE_KANBAN_ROW_CLASS = 'flex min-w-max items-start content-start gap-4';
export const CRM_QUEUE_KANBAN_COLUMN_CLASS = 'w-80 shrink-0 self-start space-y-3';

export function isQueueItemArchivable(item: Pick<CrmQueueItem, 'column' | 'isTestGuest'>): boolean {
  if (item.isTestGuest) return true;
  return item.column !== 'completed';
}

export function resolveVisibleKanbanColumns(
  columns: Record<CrmQueueColumn, CrmQueueItem[]>,
  filter: CrmQueueFilter,
): CrmQueueColumn[] {
  let base: CrmQueueColumn[];
  if (filter === 'needs_operator') base = ['needs_operator'];
  else if (filter === 'ready_for_cm') base = ['ready_for_cm'];
  else if (filter === 'completed') base = ['completed'];
  else base = [...CRM_QUEUE_COLUMN_VALUES];

  if (filter === 'all' || filter === 'active') {
    return base.filter((column) => (columns[column]?.length ?? 0) > 0);
  }
  return base;
}

export function listTestGuestContactsForBulkArchive(contacts: CrmContact[]): CrmContact[] {
  return contacts.filter((contact) => {
    if (contact.crmArchived) return false;
    if (!isQueueTestGuestContact(queueTestGuestProbeFromContact(contact))) return false;
    return isQueueItemArchivable(buildQueueItem(contact));
  });
}

export function filterArchivableTestGuestQueueItems(items: CrmQueueItem[]): CrmQueueItem[] {
  return items.filter((item) => item.isTestGuest && isQueueItemArchivable(item));
}

export function collectArchivableTestGuestContactIds(
  data: { items: CrmQueueItem[]; operatorInbox: CrmQueueItem[] },
): string[] {
  return filterArchivableTestGuestQueueItems(collectQueueItemsForArchive(data)).map((item) => item.id);
}

export type ArchiveTestGuestsClickGate =
  | { action: 'error'; message: string }
  | { action: 'confirm'; contactIds: string[] };

export function resolveArchiveTestGuestsClick(input: {
  canArchive: boolean;
  contactIds: string[];
}): ArchiveTestGuestsClickGate {
  if (!input.canArchive) {
    return { action: 'error', message: 'Нет прав оператора для скрытия тестовых карточек.' };
  }
  if (input.contactIds.length === 0) {
    return { action: 'error', message: 'Нет тестовых карточек для скрытия. Обновите страницу.' };
  }
  return { action: 'confirm', contactIds: [...input.contactIds] };
}

export function buildArchiveTestGuestsConfirmMessage(count: number): string {
  return `Скрыть ${count} тестовых guest-карточек из очереди CRM? Реальные owner/object карточки не затронуты.`;
}

export function applyBulkArchivedContactsToQueueState(
  data: {
    items: CrmQueueItem[];
    operatorInbox: CrmQueueItem[];
    columns: Record<CrmQueueColumn, CrmQueueItem[]>;
    metrics: CrmQueueMetrics;
  },
  contactIds: ReadonlySet<string>,
  filter: CrmQueueFilter,
): {
  items: CrmQueueItem[];
  operatorInbox: CrmQueueItem[];
  columns: Record<CrmQueueColumn, CrmQueueItem[]>;
  metrics: CrmQueueMetrics;
} {
  const remove = (items: CrmQueueItem[]) => items.filter((item) => !contactIds.has(item.id));
  const remainingUnique = remove(collectQueueItemsForArchive(data));
  const items = remove(data.items);
  return {
    items,
    operatorInbox: remove(data.operatorInbox),
    columns: groupQueueByColumn(filterQueueItems(items, filter)),
    metrics: computeQueueMetrics(remainingUnique),
  };
}

export function applyArchivedContactToQueueState(
  data: {
    items: CrmQueueItem[];
    operatorInbox: CrmQueueItem[];
    columns: Record<CrmQueueColumn, CrmQueueItem[]>;
    metrics: CrmQueueMetrics;
  },
  contactId: string,
  filter: CrmQueueFilter,
): {
  items: CrmQueueItem[];
  operatorInbox: CrmQueueItem[];
  columns: Record<CrmQueueColumn, CrmQueueItem[]>;
  metrics: CrmQueueMetrics;
} {
  const remove = (items: CrmQueueItem[]) => items.filter((item) => item.id !== contactId);
  const remainingUnique = remove(collectQueueItemsForArchive(data));
  const items = remove(data.items);
  return {
    items,
    operatorInbox: remove(data.operatorInbox),
    columns: groupQueueByColumn(filterQueueItems(items, filter)),
    metrics: computeQueueMetrics(remainingUnique),
  };
}

export function collectQueueItemsForArchive(data: {
  items: CrmQueueItem[];
  operatorInbox: CrmQueueItem[];
}): CrmQueueItem[] {
  const byId = new Map<string, CrmQueueItem>();
  for (const item of data.operatorInbox) byId.set(item.id, item);
  for (const item of data.items) byId.set(item.id, item);
  return [...byId.values()];
}

export function excludeArchivedQueueContacts(contacts: CrmContact[]): CrmContact[] {
  return contacts.filter((contact) => !contact.crmArchived);
}

export function computeQueueMetrics(items: CrmQueueItem[]): CrmQueueMetrics {
  return {
    activeObjects: items.filter((item) => item.column !== 'completed' && !INACTIVE_STATUSES.includes(item.crmStatus))
      .length,
    onboarding: items.filter((item) => item.column === 'onboarding' || item.column === 'missing_data').length,
    readyForChannelManager: items.filter((item) => item.readyForChannelManager).length,
    needsAttention: items.filter((item) => item.needsOperator).length,
    completed: items.filter((item) => item.column === 'completed').length,
  };
}
