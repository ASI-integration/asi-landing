import { describe, expect, it, vi } from 'vitest';
import {
  formatApiErrorField,
  userFacingChannelManagerActionError,
  userFacingChannelManagerLoadError,
} from '../user-messages';

describe('channel manager user messages', () => {
  it('formats plain string errors', () => {
    expect(formatApiErrorField('invalid_dates')).toBe('invalid_dates');
  });

  it('extracts message from error objects instead of [object Object]', () => {
    expect(formatApiErrorField({ message: 'channel_manager_tables_unavailable' })).toBe(
      'channel_manager_tables_unavailable',
    );
  });

  it('logs and hides raw object payloads from users', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(formatApiErrorField({ code: 503, meta: { retry: true } })).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns friendly load error fallback', () => {
    expect(userFacingChannelManagerLoadError({ foo: 'bar' }, undefined)).toBe(
      'Не удалось загрузить данные менеджера каналов. Обновите страницу или обратитесь в поддержку.',
    );
  });

  it('maps known action error codes to Russian text', () => {
    expect(userFacingChannelManagerActionError('invalid_dates')).toBe('Проверьте даты заезда и выезда.');
  });
});
