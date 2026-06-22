import type {
  ChannelManagerAccessSituation,
  ChannelManagerConnectionMethod,
  ChannelManagerConnectionStatus,
} from './types';

export const CHANNEL_MANAGER_CONNECTION_METHOD_LABELS: Record<ChannelManagerConnectionMethod, string> = {
  realtycalendar: 'RealtyCalendar',
  bnovo: 'Bnovo',
  manual_import: 'Ручной импорт',
  other: 'Другой Менеджер Каналов',
  none_yet: 'Пока нет Менеджера Каналов',
};

export const CHANNEL_MANAGER_ACCESS_SITUATION_LABELS: Record<ChannelManagerAccessSituation, string> = {
  has_access: 'У меня есть доступ',
  from_scratch: 'Нужно подключить с нуля',
  needs_help: 'Нужна помощь',
};

export const CHANNEL_MANAGER_CONNECTION_STATUS_LABELS: Record<ChannelManagerConnectionStatus, string> = {
  ready_to_connect: 'Готов к подключению',
  waiting_access: 'Ждём доступы',
  verifying_data: 'Проверяем данные',
  prepared: 'Подключение подготовлено',
  needs_operator: 'Требует оператора',
  connected: 'Подключено',
  primary_setup_needed: 'Нужна первичная настройка',
};

export function methodLabel(method: ChannelManagerConnectionMethod | null): string | null {
  if (!method) return null;
  return CHANNEL_MANAGER_CONNECTION_METHOD_LABELS[method];
}

export function statusLabel(status: ChannelManagerConnectionStatus): string {
  return CHANNEL_MANAGER_CONNECTION_STATUS_LABELS[status];
}
