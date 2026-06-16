import type {
  ChannelConnectionStatus,
  ChannelManagerProviderAvailability,
  ChannelSyncStatus,
  ReservationImportStatus,
} from './types';

export function connectionStatusLabelRu(status: ChannelConnectionStatus): string {
  switch (status) {
    case 'not_connected':
      return 'Не подключено';
    case 'pending_setup':
      return 'Настройка';
    case 'connected':
      return 'Подключено';
    case 'disabled':
      return 'Отключено';
    case 'error':
      return 'Ошибка';
    default:
      return status;
  }
}

export function syncStatusLabelRu(status: ChannelSyncStatus): string {
  switch (status) {
    case 'never':
      return 'Синхронизация не выполнялась';
    case 'idle':
      return 'Ожидание';
    case 'syncing':
      return 'Синхронизация...';
    case 'succeeded':
      return 'Успешно';
    case 'failed':
      return 'Ошибка синхронизации';
    default:
      return status;
  }
}

export function reservationImportStatusLabelRu(status: ReservationImportStatus): string {
  switch (status) {
    case 'not_started':
      return 'Импорт не начат';
    case 'pending':
      return 'Импорт запланирован';
    case 'partial':
      return 'Частичный импорт';
    case 'complete':
      return 'Импорт завершен';
    case 'failed':
      return 'Ошибка импорта';
    default:
      return status;
  }
}

export function providerAvailabilityLabelRu(
  availability: ChannelManagerProviderAvailability,
): string {
  switch (availability) {
    case 'available':
      return 'Подключается вручную';
    case 'foundation':
      return 'Пилотный режим';
    case 'manual':
      return 'Вручную';
    case 'on_request':
      return 'Подключается вручную';
    case 'planned':
      return 'Скоро';
    default:
      return availability;
  }
}
