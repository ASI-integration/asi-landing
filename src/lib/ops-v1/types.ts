export const OPS_V1_TASK_TYPES = [
  'checkin',
  'checkout',
  'cleaning',
  'issue',
  'manual_review',
] as const;

export type OpsV1TaskType = (typeof OPS_V1_TASK_TYPES)[number];

export const OPS_V1_STATUSES = ['new', 'in_progress', 'done', 'needs_attention'] as const;

export type OpsV1Status = (typeof OPS_V1_STATUSES)[number];

export const OPS_V1_SOURCES = [
  'crm',
  'object_passport',
  'communications',
  'booking',
  'admin',
  'telegram',
] as const;

export type OpsV1Source = (typeof OPS_V1_SOURCES)[number];

export const OPS_V1_ORIGINS = ['auto', 'manual'] as const;

export type OpsV1Origin = (typeof OPS_V1_ORIGINS)[number];

export const OPS_V1_TASK_TYPE_LABELS: Record<OpsV1TaskType, string> = {
  checkin: 'Заезд',
  checkout: 'Выезд',
  cleaning: 'Уборка',
  issue: 'Проблема',
  manual_review: 'Ручная проверка',
};

export const OPS_V1_STATUS_LABELS: Record<OpsV1Status, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Готово',
  needs_attention: 'Требует внимания',
};

export const OPS_V1_SOURCE_LABELS: Record<OpsV1Source, string> = {
  crm: 'CRM',
  object_passport: 'Паспорт объекта',
  communications: 'Коммуникации',
  booking: 'Бронь',
  admin: 'Админ',
  telegram: 'Telegram',
};

export const OPS_V1_ORIGIN_LABELS: Record<OpsV1Origin, string> = {
  auto: 'Авто',
  manual: 'Вручную',
};

export type OpsV1Task = {
  id: string;
  propertyId: string | null;
  objectLabel: string | null;
  taskType: OpsV1TaskType;
  status: OpsV1Status;
  source: OpsV1Source;
  origin: OpsV1Origin;
  scheduledAt: string | null;
  comment: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type OpsV1Summary = {
  checkinsToday: number;
  checkoutsToday: number;
  cleaningNeeded: number;
  needsAttention: number;
};

export type CreateOpsV1TaskInput = {
  taskType: OpsV1TaskType;
  objectLabel?: string | null;
  propertyId?: string | null;
  comment?: string | null;
  scheduledAt?: string | null;
};

export type UpdateOpsV1TaskInput = {
  status: OpsV1Status;
};
