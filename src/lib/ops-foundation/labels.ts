/** Русские подписи статусов и перечислений OPS v1 foundation. */

import type {
  MasterCardPublicationStatus,
  OpsIncidentSeverity,
  OpsIncidentSource,
  OpsIncidentStatus,
  OpsPropertyTaskCategory,
  OpsPropertyTaskPriority,
  OpsPropertyTaskSource,
  OpsPropertyTaskStatus,
  PropertyMediaStatus,
  PropertyStatus,
  ReservationDepositStatus,
  ReservationPaymentStatus,
  ReservationSourceChannel,
  ReservationStatus,
} from './types';

export const propertyStatusLabels: Record<PropertyStatus, string> = {
  draft: 'Черновик',
  active: 'Активен',
  paused: 'Приостановлен',
  archived: 'В архиве',
  inactive: 'Неактивен',
};

export const masterCardPublicationStatusLabels: Record<MasterCardPublicationStatus, string> = {
  draft: 'Черновик',
  ready: 'Готова',
  needs_review: 'Нужна проверка',
  published: 'Опубликована',
};

export const propertyMediaStatusLabels: Record<PropertyMediaStatus, string> = {
  active: 'Активно',
  hidden: 'Скрыто',
  deleted: 'Удалено',
};

export const reservationSourceChannelLabels: Record<ReservationSourceChannel, string> = {
  direct: 'Прямое бронирование',
  ostrovok: 'Островок',
  yandex_travel: 'Яндекс Путешествия',
  avito: 'Авито',
  sutochno: 'Суточно.ру',
  cian: 'Циан',
  other: 'Другое',
};

export const reservationStatusLabels: Record<ReservationStatus, string> = {
  new: 'Новая',
  confirmed: 'Подтверждена',
  checked_in: 'Заехал',
  checked_out: 'Выехал',
  cancelled: 'Отменена',
  no_show: 'Неявка',
};

export const reservationPaymentStatusLabels: Record<ReservationPaymentStatus, string> = {
  unknown: 'Неизвестно',
  unpaid: 'Не оплачено',
  partial: 'Частично оплачено',
  paid: 'Оплачено',
  refunded: 'Возврат',
};

export const reservationDepositStatusLabels: Record<ReservationDepositStatus, string> = {
  not_required: 'Не требуется',
  pending: 'Ожидается',
  received: 'Получен',
  returned: 'Возвращён',
  withheld: 'Удержан',
};

export const opsPropertyTaskCategoryLabels: Record<OpsPropertyTaskCategory, string> = {
  cleaning: 'Уборка',
  check_in: 'Заезд',
  check_out: 'Выезд',
  maintenance: 'Обслуживание',
  guest_request: 'Запрос гостя',
  payment: 'Оплата',
  documents: 'Документы',
  lock: 'Замок/доступ',
  internet: 'Интернет',
  other: 'Прочее',
};

export const opsPropertyTaskPriorityLabels: Record<OpsPropertyTaskPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
};

export const opsPropertyTaskStatusLabels: Record<OpsPropertyTaskStatus, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  blocked: 'Заблокирована',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const opsPropertyTaskSourceLabels: Record<OpsPropertyTaskSource, string> = {
  manual: 'Вручную',
  bot: 'Бот',
  system: 'Система',
};

export const opsIncidentSeverityLabels: Record<OpsIncidentSeverity, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
  critical: 'Критическая',
};

export const opsIncidentStatusLabels: Record<OpsIncidentStatus, string> = {
  open: 'Открыт',
  investigating: 'Разбираемся',
  resolved: 'Решён',
  closed: 'Закрыт',
};

export const opsIncidentSourceLabels: Record<OpsIncidentSource, string> = {
  manual: 'Вручную',
  bot: 'Бот',
  guest: 'Гость',
  system: 'Система',
};
