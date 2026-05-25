import { describe, it, expect } from 'vitest';
import {
  CHANNEL_MANAGER_PROVIDERS,
  buildChannelConnectionsFoundationSnapshot,
  buildPlaceholderConnection,
  CHANNEL_CONNECTIONS_PAGE_TITLE,
  CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE,
} from '../index';

describe('channel-connections foundation', () => {
  it('lists RU-first providers including manual import and future slot', () => {
    const codes = CHANNEL_MANAGER_PROVIDERS.map((p) => p.code);
    expect(codes).toEqual([
      'realtycalendar',
      'bnovo',
      'sutochno',
      'yandex_travel',
      'ozon_travel',
      'avito',
      'cian',
      'hotels_101',
      'otello',
      'manual_import',
      'future',
    ]);
    expect(CHANNEL_MANAGER_PROVIDERS.every((p) => p.primaryMarket === 'ru')).toBe(true);
  });

  it('returns empty connections without credentials', () => {
    const snapshot = buildChannelConnectionsFoundationSnapshot('acc_test');
    expect(snapshot.accountId).toBe('acc_test');
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.providers.length).toBe(11);
  });

  it('builds neutral placeholder connection', () => {
    const conn = buildPlaceholderConnection('acc_test', 'bnovo');
    expect(conn.provider).toBe('bnovo');
    expect(conn.connectionStatus).toBe('not_connected');
    expect(conn.syncStatus).toBe('never');
    expect(conn.reservationImportStatus).toBe('not_started');
    expect(conn.lastSyncAt).toBeNull();
    expect(conn.syncErrorMessage).toBeNull();
  });

  it('exposes required Russian UI copy', () => {
    expect(CHANNEL_CONNECTIONS_PAGE_TITLE).toBe('Подключения каналов');
    expect(CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE).toContain('RealtyCalendar');
    expect(CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE).toContain('Яндекс.Путешествия');
    expect(CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE).toContain('Авито');
  });
});
