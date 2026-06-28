export const BOOKING_OPS_TASK_TYPES = [
  'complete_booking_data',
  'request_guest_documents',
  'verify_guest_documents',
  'prepare_contract',
  'send_contract_manual',
  'follow_up_contract_signature',
  'request_deposit',
  'confirm_deposit',
  'track_deposit_return',
  'collect_mvd_data',
  'prepare_mvd_report',
  'submit_mvd_report',
  'generate_telegram_drafts',
  'review_telegram_drafts',
  'manual_send_telegram_drafts',
] as const;

export type BookingOpsTaskType = (typeof BOOKING_OPS_TASK_TYPES)[number];

export const BOOKING_OPS_TASK_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
] as const;

export type BookingOpsTaskStatus = (typeof BOOKING_OPS_TASK_STATUSES)[number];

export const BOOKING_OPS_TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export type BookingOpsTaskPriority = (typeof BOOKING_OPS_TASK_PRIORITIES)[number];

export const BOOKING_OPS_TASK_SOURCES = ['readiness_gate', 'manual', 'system'] as const;

export type BookingOpsTaskSource = (typeof BOOKING_OPS_TASK_SOURCES)[number];

export const BOOKING_OPS_OPEN_TASK_STATUSES: BookingOpsTaskStatus[] = [
  'open',
  'in_progress',
  'blocked',
];

export const BOOKING_OPS_TASK_TYPE_LABELS_RU: Record<BookingOpsTaskType, string> = {
  complete_booking_data: 'Заполнить данные брони',
  request_guest_documents: 'Запросить документы гостя',
  verify_guest_documents: 'Проверить документы гостя',
  prepare_contract: 'Подготовить договор',
  send_contract_manual: 'Отправить договор вручную',
  follow_up_contract_signature: 'Проконтролировать подписание договора',
  request_deposit: 'Запросить депозит',
  confirm_deposit: 'Подтвердить депозит',
  track_deposit_return: 'Отследить возврат депозита',
  collect_mvd_data: 'Собрать данные МВД',
  prepare_mvd_report: 'Подготовить отчёт МВД',
  submit_mvd_report: 'Отправить отчёт МВД',
  generate_telegram_drafts: 'Создать черновики Telegram',
  review_telegram_drafts: 'Проверить черновики Telegram',
  manual_send_telegram_drafts: 'Отправить черновики Telegram вручную',
};

export const BOOKING_OPS_TASK_STATUS_LABELS_RU: Record<BookingOpsTaskStatus, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  blocked: 'Заблокирована',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

export type BookingOpsTask = {
  id: string;
  bookingOpsRecordId: string;
  bookingId: string | null;
  taskType: BookingOpsTaskType;
  title: string;
  description: string | null;
  status: BookingOpsTaskStatus;
  priority: BookingOpsTaskPriority;
  source: BookingOpsTaskSource;
  dueAt: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BookingOpsTaskPlanItem = {
  taskType: BookingOpsTaskType;
  title: string;
  description: string | null;
  priority: BookingOpsTaskPriority;
  metadata?: Record<string, unknown>;
};

export type CreateBookingOpsTaskInput = {
  bookingOpsRecordId: string;
  bookingId?: string | null;
  taskType: BookingOpsTaskType;
  title: string;
  description?: string | null;
  priority?: BookingOpsTaskPriority;
  source?: BookingOpsTaskSource;
  dueAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateBookingOpsTaskInput = {
  status?: BookingOpsTaskStatus;
  priority?: BookingOpsTaskPriority;
  description?: string | null;
};

function includesValue<T extends string>(values: readonly T[], raw: string): raw is T {
  return (values as readonly string[]).includes(raw);
}

export function normalizeBookingOpsTaskType(value: unknown): BookingOpsTaskType | null {
  const raw = String(value ?? '').trim();
  return includesValue(BOOKING_OPS_TASK_TYPES, raw) ? raw : null;
}

export function normalizeBookingOpsTaskStatus(value: unknown): BookingOpsTaskStatus | null {
  const raw = String(value ?? '').trim();
  return includesValue(BOOKING_OPS_TASK_STATUSES, raw) ? raw : null;
}

export function normalizeBookingOpsTaskPriority(value: unknown): BookingOpsTaskPriority | null {
  const raw = String(value ?? '').trim();
  return includesValue(BOOKING_OPS_TASK_PRIORITIES, raw) ? raw : null;
}

export function normalizeBookingOpsTaskSource(value: unknown): BookingOpsTaskSource | null {
  const raw = String(value ?? '').trim();
  return includesValue(BOOKING_OPS_TASK_SOURCES, raw) ? raw : null;
}
