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
  'checkout_confirmed',
  'cleaning_needed',
  'cleaning_assigned',
  'cleaning_in_progress',
  'cleaning_done',
  'unit_inspection_needed',
  'unit_ready_for_next_guest',
  'linen_pickup_needed',
  'linen_replaced',
  'laundry_dropoff_needed',
  'laundry_return_needed',
  'supplies_check_needed',
  'inspection_needed',
  'maintenance_needed',
  'unit_ready_confirmation',
  'guest_intake_operator_fallback',
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

export const BOOKING_OPS_TASK_SOURCE_LABELS_RU: Record<BookingOpsTaskSource, string> = {
  readiness_gate: 'из готовности',
  manual: 'ручной ввод',
  system: 'система',
};

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
  checkout_confirmed: 'Подтвердить выезд',
  cleaning_needed: 'Нужна уборка',
  cleaning_assigned: 'Уборка назначена',
  cleaning_in_progress: 'Уборка в процессе',
  cleaning_done: 'Уборка завершена',
  unit_inspection_needed: 'Нужен осмотр объекта',
  unit_ready_for_next_guest: 'Объект готов к заезду',
  linen_pickup_needed: 'Забрать бельё',
  linen_replaced: 'Заменить бельё',
  laundry_dropoff_needed: 'Сдать бельё в прачечную',
  laundry_return_needed: 'Получить бельё из прачечной',
  supplies_check_needed: 'Проверить расходники',
  inspection_needed: 'Провести осмотр',
  maintenance_needed: 'Устранить поломку',
  unit_ready_confirmation: 'Подтвердить готовность объекта',
  guest_intake_operator_fallback: 'Помочь гостю с данными',
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

export const BOOKING_OPS_TASK_ACTION_LABELS_RU: Partial<Record<BookingOpsTaskType, string>> = {
  complete_booking_data: 'Показать, чего не хватает',
  request_guest_documents: 'Создать черновик запроса',
  verify_guest_documents: 'Открыть чеклист проверки',
  prepare_contract: 'Открыть чеклист подготовки',
  send_contract_manual: 'Подготовить черновик отправки',
  follow_up_contract_signature: 'Создать напоминание',
  request_deposit: 'Создать черновик запроса депозита',
  confirm_deposit: 'Открыть чеклист подтверждения',
  track_deposit_return: 'Открыть чеклист возврата',
  collect_mvd_data: 'Открыть чеклист сбора данных',
  prepare_mvd_report: 'Открыть чеклист подготовки отчёта',
  submit_mvd_report: 'Открыть чеклист отправки',
  generate_telegram_drafts: 'Создать черновики Telegram',
  review_telegram_drafts: 'Показать черновики',
  manual_send_telegram_drafts: 'Пакет для ручной отправки',
  checkout_confirmed: 'Чеклист выезда',
  cleaning_needed: 'Черновик инструкции по уборке',
  cleaning_assigned: 'Черновик инструкции по уборке',
  cleaning_in_progress: 'Черновик инструкции по уборке',
  cleaning_done: 'Черновик инструкции по уборке',
  unit_inspection_needed: 'Чеклист осмотра',
  unit_ready_for_next_guest: 'Подтвердить готовность',
  linen_pickup_needed: 'Чеклист белья',
  linen_replaced: 'Чеклист белья',
  laundry_dropoff_needed: 'Чеклист прачечной',
  laundry_return_needed: 'Чеклист прачечной',
  supplies_check_needed: 'Чеклист расходников',
  inspection_needed: 'Чеклист осмотра',
  maintenance_needed: 'Чеклист ремонта',
  unit_ready_confirmation: 'Подтвердить готовность',
  guest_intake_operator_fallback: 'Открыть ручную помощь',
};

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
