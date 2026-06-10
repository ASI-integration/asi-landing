import type {
  ChannelManagerChannel,
  ChannelReservation,
  ChannelShadowBookingEvent,
  ChannelShadowDiscrepancy,
  ChannelSyncJob,
  ChannelSyncLog,
  SyncMode,
} from '@/lib/channel-manager/types';

export function statusLabel(status: ChannelReservation['status'] | ChannelShadowBookingEvent['status']): string {
  const labels: Record<string, string> = {
    pending: 'Ожидает',
    confirmed: 'Подтверждена',
    cancelled: 'Отменена',
    declined: 'Отклонена',
    conflict: 'Конфликт',
    rejected_by_inventory: 'Нет мест',
    modified: 'Изменена',
  };
  return labels[status] ?? status;
}

export function syncModeLabel(mode: SyncMode): string {
  const labels: Record<SyncMode, string> = {
    disabled: 'Выключен',
    read_only: 'Только чтение',
    shadow: 'Теневой',
    active: 'Активный',
  };
  return labels[mode];
}

export function integrationTypeLabel(type: ChannelManagerChannel['integrationType']): string {
  const labels: Record<ChannelManagerChannel['integrationType'], string> = {
    api: 'API',
    partner_channel_manager_api: 'API партнёра',
    ical: 'iCal',
    manual: 'Ручной ввод',
    email_parsing: 'Разбор почты',
    mock: 'Тестовый канал',
  };
  return labels[type];
}

export function channelStatusLabel(status: ChannelManagerChannel['status']): string {
  const labels: Record<ChannelManagerChannel['status'], string> = {
    planned: 'Планируется',
    mocked: 'Тестовый адаптер',
    ready_for_credentials: 'Нужны доступы',
    sandbox: 'Песочница',
    active: 'Активен',
    disabled: 'Выключен',
    error: 'Ошибка',
  };
  return labels[status];
}

export function syncJobStatusLabel(status: ChannelSyncJob['status']): string {
  const labels: Record<ChannelSyncJob['status'], string> = {
    queued: 'В очереди',
    running: 'Выполняется',
    succeeded: 'Выполнена',
    failed: 'Ошибка',
    cancelled: 'Отменена',
  };
  return labels[status];
}

export function syncLogStatusLabel(status: ChannelSyncLog['status']): string {
  const labels: Record<ChannelSyncLog['status'], string> = {
    ok: 'Успешно',
    error: 'Ошибка',
    skipped: 'Пропущено',
  };
  return labels[status];
}

export function syncDirectionLabel(direction: ChannelSyncLog['direction']): string {
  return direction === 'inbound' ? 'Входящее' : 'Исходящее';
}

export function adapterKindLabel(kind: ChannelManagerChannel['adapterKind']): string {
  const labels: Record<ChannelManagerChannel['adapterKind'], string> = {
    mock: 'Тестовый',
    manual: 'Ручной',
    api: 'API',
  };
  return labels[kind];
}

export function yesNoLabel(value: boolean): string {
  return value ? 'Включено' : 'Выключено';
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'нет';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function syncReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    inventory_changed: 'Изменилась доступность',
    reservation_created: 'Создана бронь',
    reservation_shadow_pending: 'Создана заявка в теневом режиме',
    reservation_cancelled: 'Бронь отменена',
    reservation_modified: 'Бронь изменена',
    bronevik_dry_run_preview: 'Предпросмотр для Bronevik / МТС Travel',
  };
  return labels[reason] ?? reason;
}

export function syncMessageLabel(message: string): string {
  const labels: Record<string, string> = {
    duplicate_external_booking_id: 'Повторное событие пропущено',
    no_availability: 'Нет доступности на выбранные даты',
    shadow_mode_external_send_blocked: 'Отправка наружу заблокирована в теневом режиме',
  };
  return labels[message] ?? message;
}

export function shadowEventStatusLabel(status: ChannelShadowBookingEvent['status']): string {
  const labels: Record<ChannelShadowBookingEvent['status'], string> = {
    processed: 'Обработано',
    duplicate: 'Дубль',
    conflict: 'Расхождение',
    skipped: 'Пропущено',
  };
  return labels[status];
}

export function shadowDiscrepancyLabel(type: ChannelShadowDiscrepancy['discrepancyType']): string {
  const labels: Record<ChannelShadowDiscrepancy['discrepancyType'], string> = {
    external_availability_mismatch: 'Доступность не совпала',
    insufficient_availability: 'Не хватает мест',
    reservation_not_found: 'Бронь не найдена',
    shadow_mode_required: 'Нужен shadow-режим',
  };
  return labels[type];
}

export function rejectionReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    no_availability: 'нет доступности на выбранные даты',
    insufficient_availability: 'недостаточно доступности',
  };
  return labels[reason] ?? reason;
}

export function isApiLikeChannel(channel: ChannelManagerChannel): boolean {
  return channel.integrationType === 'api' || channel.integrationType === 'partner_channel_manager_api';
}
