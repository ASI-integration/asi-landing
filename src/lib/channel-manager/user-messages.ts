const ERROR_CODE_LABELS: Record<string, string> = {
  non_api_channels_cannot_use_active_auto_sell:
    'В боевой режим можно включать только каналы с полноценной API-интеграцией.',
  active_mode_requires_availability_push: 'Для активного режима канал должен поддерживать отправку доступности.',
  auto_sell_requires_active_mode: 'Автопродажа доступна только в активном режиме.',
  real_ota_adapter_active_mode_disabled: 'Для первого реального OTA активный режим отключен.',
  bronevik_dry_run_payload_required: 'Нужно выбрать объект и даты для предпросмотра.',
  channel_patch_required: 'Нужно передать изменение канала.',
  mock_reservation_payload_required: 'Нужно заполнить данные тестовой брони.',
  reservation_id_and_dates_required: 'Нужно выбрать бронь и новые даты.',
  reservation_id_required: 'Нужно выбрать бронь.',
  reservation_not_found: 'Бронь не найдена.',
  invalid_dates: 'Проверьте даты заезда и выезда.',
  channel_manager_unavailable:
    'Менеджер каналов временно недоступен. Обновите страницу или обратитесь в поддержку.',
  channel_manager_tables_unavailable:
    'Менеджер каналов ещё не настроен на сервере. Обратитесь в поддержку.',
  ops_backend_unavailable:
    'Сервис объектов временно недоступен. Обновите страницу или обратитесь в поддержку.',
  account_workspace_unavailable:
    'Рабочее пространство аккаунта ещё не готово. Обратитесь в поддержку.',
  ops_request_failed: 'Не удалось выполнить запрос. Попробуйте ещё раз.',
  Unauthorized: 'Нужно войти в аккаунт.',
};

export function formatApiErrorField(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value instanceof Error) return value.message;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
    if (typeof record.detail === 'string' && record.detail.trim()) return record.detail.trim();
    if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
    console.error('[channel-manager] API returned non-string error payload', value);
  }
  return undefined;
}

export function channelManagerErrorText(code?: string): string {
  if (!code) return 'Не удалось выполнить действие';
  return ERROR_CODE_LABELS[code] ?? code;
}

export function userFacingChannelManagerLoadError(detail?: unknown, code?: unknown): string {
  const detailText = formatApiErrorField(detail);
  const codeText = formatApiErrorField(code);
  const primary = detailText ?? codeText;
  if (!primary) {
    return 'Не удалось загрузить данные менеджера каналов. Обновите страницу или обратитесь в поддержку.';
  }
  return channelManagerErrorText(primary);
}

export function userFacingChannelManagerActionError(detail?: unknown, code?: unknown): string {
  const detailText = formatApiErrorField(detail);
  const codeText = formatApiErrorField(code);
  return channelManagerErrorText(detailText ?? codeText);
}
