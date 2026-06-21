import type { CrmContact, CrmOnboardingStatus, CrmStatus } from './types';
import type { CrmActivityItem, CrmOperationalStatus } from './activity-feed';
import { CRM_OPERATIONAL_STATUS_LABELS, resolveOperationalStatus } from './activity-feed';

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
  ready_for_cm: 'Готов к Менеджеру каналов',
  needs_operator: 'Требует внимания',
  completed: 'Завершено',
};

export const CRM_QUEUE_STATUS_LABELS: Record<CrmOnboardingStatus, string> = {
  onboarding_started: 'Идёт подключение',
  missing_required_data: 'Не хватает данных',
  ready_for_channel_manager: 'Готов к Менеджеру каналов',
  channel_manager_started: 'Менеджер каналов открыт',
  needs_operator: 'Требует внимания',
};

export const CRM_QUEUE_FILTER_LABELS: Record<CrmQueueFilter, string> = {
  all: 'Все',
  needs_operator: 'Нужен оператор',
  ready_for_cm: 'Готов к Менеджеру каналов',
  active: 'Только активные',
  completed: 'Только завершённые',
};

const COMPLETED_STATUSES: CrmStatus[] = ['pilot', 'ready_for_test', 'rejected', 'not_relevant'];
const INACTIVE_STATUSES: CrmStatus[] = ['paused', 'rejected', 'not_relevant'];

const ONBOARDING_FIELD_LABELS: Record<string, string> = {
  address: 'адрес',
  property_name: 'название объекта',
  house_rules: 'правила проживания',
  wifi: 'Wi-Fi',
  checkin_checkout: 'время заезда и выезда',
  photos: 'фото',
  channels: 'каналы',
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
  onboardingStatus: CrmOnboardingStatus | null;
  onboardingStatusLabel: string;
  column: CrmQueueColumn;
  lastContactAt: string | null;
  updatedAt: string;
  missingFields: string[];
  readyForChannelManager: boolean;
  needsOperator: boolean;
  channelManagerStatus: string | null;
  channelManagerHref: string | null;
  propertyId: string | null;
  crmStatus: CrmStatus;
  lastMessagePreview: string | null;
  messages: CrmQueueMessage[];
  operationalStatus: CrmOperationalStatus;
  operationalStatusLabel: string;
  recentActivities: CrmActivityItem[];
};

export type CrmQueueMetrics = {
  activeObjects: number;
  onboarding: number;
  readyForChannelManager: number;
  needsAttention: number;
  completed: number;
};

function extractPropertyId(note: string): string | null {
  const match = note.match(/property_id=([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function objectTitleFor(contact: CrmContact): string {
  if (contact.city.trim()) return `Объект в ${contact.city.trim()}`;
  if (contact.objectsCount > 0) return `Объект (${contact.objectsCount})`;
  return contact.name.trim() || 'Новый объект';
}

function channelManagerStatusFor(contact: CrmContact): string | null {
  const status = contact.onboarding?.status;
  if (status === 'ready_for_channel_manager') return 'Готов к подключению';
  if (status === 'channel_manager_started') return 'Менеджер каналов открыт';
  return null;
}

function missingFieldsRu(missing: string[]): string[] {
  return missing.map((field) => ONBOARDING_FIELD_LABELS[field] ?? field);
}

export function resolveQueueColumn(contact: CrmContact): CrmQueueColumn {
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

export function buildQueueItem(
  contact: CrmContact,
  messages: CrmQueueMessage[] = [],
  recentActivities: CrmActivityItem[] = []
): CrmQueueItem {
  const column = resolveQueueColumn(contact);
  const onboardingStatus = contact.onboarding?.status ?? null;
  const missing = contact.onboarding?.missing ?? [];

  const flags = {
    needsOperator: contactNeedsOperator(contact),
    readyForChannelManager: contactReadyForChannelManager(contact),
    column,
  };
  const operationalStatus = resolveOperationalStatus(contact, flags);

  return {
    id: contact.id,
    objectTitle: objectTitleFor(contact),
    ownerName: contact.name,
    telegramUsername: contact.telegramUsername.trim() || null,
    onboardingStatus,
    onboardingStatusLabel: onboardingStatus
      ? CRM_QUEUE_STATUS_LABELS[onboardingStatus]
      : CRM_QUEUE_COLUMN_LABELS[column],
    column,
    lastContactAt: contact.lastContactAt,
    updatedAt: contact.updatedAt,
    missingFields: missingFieldsRu(missing),
    readyForChannelManager: flags.readyForChannelManager,
    needsOperator: flags.needsOperator,
    channelManagerStatus: channelManagerStatusFor(contact),
    channelManagerHref: contact.onboarding?.channelManagerHref ?? '/dashboard/channel-connections?source=crm_queue',
    propertyId: extractPropertyId(contact.note),
    crmStatus: contact.status,
    lastMessagePreview: contact.onboarding?.lastMessage || messages[0]?.text || contact.nextStep || null,
    messages,
    operationalStatus,
    operationalStatusLabel: CRM_OPERATIONAL_STATUS_LABELS[operationalStatus],
    recentActivities,
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
