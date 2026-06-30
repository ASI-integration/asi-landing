export const BOOKING_LIFECYCLE_GATE_KEYS = [
  'booking_received',
  'guest_data_requested',
  'guest_data_completed',
  'documents_requested',
  'documents_received',
  'documents_verified',
  'contract_prepared',
  'contract_sent',
  'contract_signed',
  'deposit_requested',
  'deposit_received',
  'mvd_report_prepared',
  'mvd_report_submitted',
  'cleaning_scheduled',
  'linen_scheduled',
  'inspection_scheduled',
  'maintenance_required',
  'maintenance_resolved',
  'property_ready',
  'checkin_instructions_sent',
  'guest_checked_in',
  'guest_checked_out',
  'post_checkout_inspection_done',
  'deposit_return_ready',
  'booking_closed',
] as const;

export type BookingLifecycleGateKey = (typeof BOOKING_LIFECYCLE_GATE_KEYS)[number];

export const BOOKING_LIFECYCLE_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'skipped',
  'failed',
] as const;

export type BookingLifecycleStatus = (typeof BOOKING_LIFECYCLE_STATUSES)[number];

export const BOOKING_LIFECYCLE_SOURCES = [
  'system',
  'admin',
  'guest',
  'cleaner',
  'master',
  'integration',
] as const;

export type BookingLifecycleSource = (typeof BOOKING_LIFECYCLE_SOURCES)[number];

export const BOOKING_LIFECYCLE_GATE_LABELS_RU: Record<BookingLifecycleGateKey, string> = {
  booking_received: 'Бронь получена',
  guest_data_requested: 'Данные гостя запрошены',
  guest_data_completed: 'Данные гостя заполнены',
  documents_requested: 'Документы запрошены',
  documents_received: 'Документы получены',
  documents_verified: 'Документы проверены',
  contract_prepared: 'Договор подготовлен',
  contract_sent: 'Договор отправлен',
  contract_signed: 'Договор подписан',
  deposit_requested: 'Депозит запрошен',
  deposit_received: 'Депозит получен',
  mvd_report_prepared: 'Отчет МВД подготовлен',
  mvd_report_submitted: 'Отчет МВД отправлен',
  cleaning_scheduled: 'Уборка назначена',
  linen_scheduled: 'Белье запланировано',
  inspection_scheduled: 'Осмотр назначен',
  maintenance_required: 'Нужен ремонт',
  maintenance_resolved: 'Ремонт закрыт',
  property_ready: 'Объект готов',
  checkin_instructions_sent: 'Инструкции заезда отправлены',
  guest_checked_in: 'Гость заехал',
  guest_checked_out: 'Гость выехал',
  post_checkout_inspection_done: 'Осмотр после выезда выполнен',
  deposit_return_ready: 'Возврат депозита готов',
  booking_closed: 'Бронь закрыта',
};

export const BOOKING_LIFECYCLE_STATUS_LABELS_RU: Record<BookingLifecycleStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  completed: 'Готово',
  blocked: 'Блокер',
  skipped: 'Пропущено',
  failed: 'Ошибка',
};

export type BookingLifecycleGate = {
  id: string;
  bookingId: string;
  gateKey: BookingLifecycleGateKey;
  status: BookingLifecycleStatus;
  source: BookingLifecycleSource;
  updatedAt: string;
  completedAt: string | null;
  reason: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
};

export type BookingLifecycleException = {
  id: string;
  bookingId: string;
  gateKey: BookingLifecycleGateKey;
  status: 'open' | 'resolved';
  reason: string;
  source: BookingLifecycleSource;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type BookingLifecycleSnapshot = {
  bookingId: string;
  gates: BookingLifecycleGate[];
  readinessScore: number;
  currentActiveGate: BookingLifecycleGate | null;
  blockedGates: BookingLifecycleGate[];
  completedGates: BookingLifecycleGate[];
  nextRequiredGates: BookingLifecycleGate[];
  exceptions: BookingLifecycleException[];
};
