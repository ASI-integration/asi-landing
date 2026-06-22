export const OPS_TASK_TYPES = [
  'prepare_checkin',
  'prepare_checkout',
  'verify_cleaning',
  'verify_guest_issue',
  'request_owner_data',
  'verify_channel_manager',
  'contact_owner',
  'other',
] as const;

export type OpsTaskType = (typeof OPS_TASK_TYPES)[number];

export const OPS_TASK_STATUSES = [
  'new',
  'in_progress',
  'waiting_owner',
  'needs_operator',
  'done',
  'closed',
] as const;

export type OpsTaskStatus = (typeof OPS_TASK_STATUSES)[number];

export const OPS_OPEN_STATUSES: OpsTaskStatus[] = [
  'new',
  'in_progress',
  'waiting_owner',
  'needs_operator',
];

export const OPS_TASK_PRIORITIES = ['normal', 'urgent', 'critical'] as const;

export type OpsTaskPriority = (typeof OPS_TASK_PRIORITIES)[number];

export const OPS_TASK_SOURCES = [
  'telegram',
  'crm',
  'communication_autopilot',
  'channel_manager',
  'manual',
] as const;

export type OpsTaskSource = (typeof OPS_TASK_SOURCES)[number];

export const OPS_TASK_TYPE_LABELS: Record<OpsTaskType, string> = {
  prepare_checkin: 'Подготовить заезд',
  prepare_checkout: 'Подготовить выезд',
  verify_cleaning: 'Проверить уборку',
  verify_guest_issue: 'Проверить проблему гостя',
  request_owner_data: 'Запросить данные у владельца',
  verify_channel_manager: 'Проверить подключение Менеджера Каналов',
  contact_owner: 'Связаться с владельцем',
  other: 'Другое',
};

export const OPS_TASK_STATUS_LABELS: Record<OpsTaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting_owner: 'Ждёт владельца',
  needs_operator: 'Требует оператора',
  done: 'Готово',
  closed: 'Закрыта',
};

export const OPS_TASK_PRIORITY_LABELS: Record<OpsTaskPriority, string> = {
  normal: 'Обычный',
  urgent: 'Срочно',
  critical: 'Критично',
};

export const OPS_TASK_SOURCE_LABELS: Record<OpsTaskSource, string> = {
  telegram: 'Telegram',
  crm: 'CRM',
  communication_autopilot: 'Communication Autopilot',
  channel_manager: 'Channel Manager',
  manual: 'Manual',
};

export type OpsOperatorTask = {
  id: string;
  taskType: OpsTaskType;
  taskStatus: OpsTaskStatus;
  priority: OpsTaskPriority;
  source: OpsTaskSource;
  title: string;
  description: string | null;
  objectId: string | null;
  contactId: string | null;
  guestName: string | null;
  ownerName: string | null;
  objectLabel: string | null;
  lastEventText: string | null;
  lastEventAt: string | null;
  dedupKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type OpsContactSummary = {
  contactId: string;
  openCount: number;
  highestPriority: OpsTaskPriority | null;
};

export type CreateOpsOperatorTaskInput = {
  taskType: OpsTaskType;
  taskStatus?: OpsTaskStatus;
  priority?: OpsTaskPriority;
  source: OpsTaskSource;
  title?: string;
  description?: string | null;
  objectId?: string | null;
  contactId?: string | null;
  guestName?: string | null;
  ownerName?: string | null;
  objectLabel?: string | null;
  lastEventText?: string | null;
  metadata?: Record<string, unknown>;
  dedupKey?: string | null;
  updateIfExists?: {
    description?: string | null;
    taskStatus?: OpsTaskStatus;
    lastEventText?: string | null;
  };
};

export type UpdateOpsOperatorTaskInput = {
  taskStatus: OpsTaskStatus;
  lastEventText?: string | null;
};
