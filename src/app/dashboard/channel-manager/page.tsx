'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OpsProperty } from '@/lib/ops-foundation/types';
import type {
  BronevikDryRunPreview,
  BronevikMtsTravelCredentialStatus,
} from '@/lib/channel-manager/bronevik-mts-real-adapter';
import type {
  ChannelCapability,
  ChannelCode,
  ChannelManagerChannel,
  ChannelReservation,
  ChannelShadowBookingEvent,
  ChannelShadowDiscrepancy,
  ChannelSyncJob,
  ChannelSyncLog,
  InventoryDay,
  SyncMode,
} from '@/lib/channel-manager/types';

type ApiState = {
  channels: ChannelManagerChannel[];
  registry: ChannelCapability[];
  inventoryDays: InventoryDay[];
  reservations: ChannelReservation[];
  syncJobs: ChannelSyncJob[];
  syncLogs: ChannelSyncLog[];
  shadowEvents: ChannelShadowBookingEvent[];
  shadowDiscrepancies: ChannelShadowDiscrepancy[];
  bronevikMtsTravel: {
    channelId: string | null;
    credentials: BronevikMtsTravelCredentialStatus;
    health: {
      ok: boolean;
      message: string;
      externalCalls: 0;
    };
    mode: 'sandbox_shadow_read_only';
    sandbox: boolean;
    dryRunPreview: BronevikDryRunPreview | null;
    missingMappings: BronevikDryRunPreview['missingMappings'];
    latestSyncJobs: ChannelSyncJob[];
    latestSyncLogs: ChannelSyncLog[];
  } | null;
};

type ApiResult<T> = { ok?: boolean; error?: string; detail?: string } & T;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function statusLabel(status: ChannelReservation['status'] | ChannelShadowBookingEvent['status']): string {
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

function syncModeLabel(mode: SyncMode): string {
  const labels: Record<SyncMode, string> = {
    disabled: 'Выключен',
    read_only: 'Только чтение',
    shadow: 'Теневой',
    active: 'Активный',
  };
  return labels[mode];
}

function integrationTypeLabel(type: ChannelManagerChannel['integrationType']): string {
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

function channelStatusLabel(status: ChannelManagerChannel['status']): string {
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

function syncJobStatusLabel(status: ChannelSyncJob['status']): string {
  const labels: Record<ChannelSyncJob['status'], string> = {
    queued: 'В очереди',
    running: 'Выполняется',
    succeeded: 'Выполнена',
    failed: 'Ошибка',
    cancelled: 'Отменена',
  };
  return labels[status];
}

function syncLogStatusLabel(status: ChannelSyncLog['status']): string {
  const labels: Record<ChannelSyncLog['status'], string> = {
    ok: 'Успешно',
    error: 'Ошибка',
    skipped: 'Пропущено',
  };
  return labels[status];
}

function syncDirectionLabel(direction: ChannelSyncLog['direction']): string {
  return direction === 'inbound' ? 'Входящее' : 'Исходящее';
}

function adapterKindLabel(kind: ChannelManagerChannel['adapterKind']): string {
  const labels: Record<ChannelManagerChannel['adapterKind'], string> = {
    mock: 'Тестовый',
    manual: 'Ручной',
    api: 'API',
  };
  return labels[kind];
}

function yesNoLabel(value: boolean): string {
  return value ? 'Включено' : 'Выключено';
}

function formatDateTime(value: string | null): string {
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

function syncReasonLabel(reason: string): string {
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

function syncMessageLabel(message: string): string {
  const labels: Record<string, string> = {
    duplicate_external_booking_id: 'Повторное событие пропущено',
    no_availability: 'Нет доступности на выбранные даты',
    shadow_mode_external_send_blocked: 'Отправка наружу заблокирована в теневом режиме',
  };
  return labels[message] ?? message;
}

function shadowEventStatusLabel(status: ChannelShadowBookingEvent['status']): string {
  const labels: Record<ChannelShadowBookingEvent['status'], string> = {
    processed: 'Обработано',
    duplicate: 'Дубль',
    conflict: 'Расхождение',
    skipped: 'Пропущено',
  };
  return labels[status];
}

function shadowDiscrepancyLabel(type: ChannelShadowDiscrepancy['discrepancyType']): string {
  const labels: Record<ChannelShadowDiscrepancy['discrepancyType'], string> = {
    external_availability_mismatch: 'Доступность не совпала',
    insufficient_availability: 'Не хватает мест',
    reservation_not_found: 'Бронь не найдена',
    shadow_mode_required: 'Нужен shadow-режим',
  };
  return labels[type];
}

function rejectionReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    no_availability: 'нет доступности на выбранные даты',
    insufficient_availability: 'недостаточно доступности',
  };
  return labels[reason] ?? reason;
}

function isApiLikeChannel(channel: ChannelManagerChannel): boolean {
  return channel.integrationType === 'api' || channel.integrationType === 'partner_channel_manager_api';
}

function errorText(code?: string): string {
  const labels: Record<string, string> = {
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
  };
  return code ? labels[code] ?? code : 'Не удалось выполнить действие';
}

export default function ChannelManagerPage() {
  const [properties, setProperties] = useState<OpsProperty[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [state, setState] = useState<ApiState>({
    channels: [],
    registry: [],
    inventoryDays: [],
    reservations: [],
    syncJobs: [],
    syncLogs: [],
    shadowEvents: [],
    shadowDiscrepancies: [],
    bronevikMtsTravel: null,
  });
  const [bronevikPreview, setBronevikPreview] = useState<BronevikDryRunPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inventoryDay, setInventoryDayValue] = useState(todayIso());
  const [totalUnits, setTotalUnits] = useState(1);
  const [blockedUnits, setBlockedUnits] = useState(0);

  const [channelCode, setChannelCode] = useState<ChannelCode>('yandex_travel');
  const [guestName, setGuestName] = useState('Тестовый гость');
  const [checkInDate, setCheckInDate] = useState(todayIso());
  const [checkOutDate, setCheckOutDate] = useState(addDaysIso(todayIso(), 2));
  const [externalBookingId, setExternalBookingId] = useState('');
  const [totalAmount, setTotalAmount] = useState(12000);
  const [confirmationMode, setConfirmationMode] = useState<'confirm' | 'pending'>('confirm');
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);
  const [editCheckInDate, setEditCheckInDate] = useState(todayIso());
  const [editCheckOutDate, setEditCheckOutDate] = useState(addDaysIso(todayIso(), 2));

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertyId) ?? null,
    [properties, propertyId],
  );
  const conflictReservations = state.reservations.filter((reservation) =>
    ['conflict', 'rejected_by_inventory', 'declined'].includes(reservation.status),
  );
  const channelNameByCode = useMemo(
    () => new Map(state.channels.map((channel) => [channel.code, channel.name])),
    [state.channels],
  );
  const channelNameById = useMemo(
    () => new Map(state.channels.map((channel) => [channel.id, channel.name])),
    [state.channels],
  );
  const selectableChannels = state.channels.filter(isApiLikeChannel);
  const selectedChannel = state.channels.find((channel) => channel.code === channelCode) ?? null;
  const bronevikState = state.bronevikMtsTravel;
  const activeBronevikPreview = bronevikPreview ?? bronevikState?.dryRunPreview ?? null;

  const load = useCallback(async (nextPropertyId = propertyId) => {
    setLoading(true);
    setError(null);
    try {
      const propertiesRes = await fetch('/api/ops/properties');
      const propertiesJson = (await propertiesRes.json()) as ApiResult<{ properties?: OpsProperty[] }>;
      if (!propertiesRes.ok || !propertiesJson.ok) {
        setError(propertiesJson.detail ?? propertiesJson.error ?? 'Не удалось загрузить объекты');
        return;
      }

      const loadedProperties = propertiesJson.properties ?? [];
      setProperties(loadedProperties);
      const activePropertyId = nextPropertyId || loadedProperties[0]?.id || '';
      if (!propertyId && activePropertyId) setPropertyId(activePropertyId);

      const url = activePropertyId
        ? `/api/channel-manager/summary?propertyId=${activePropertyId}`
        : '/api/channel-manager/summary';
      const stateRes = await fetch(url);
      const stateJson = (await stateRes.json()) as ApiResult<Partial<ApiState>>;
      if (!stateRes.ok || !stateJson.ok) {
        setError(stateJson.detail ?? stateJson.error ?? 'Не удалось загрузить менеджер каналов');
        return;
      }

      setState({
        channels: stateJson.channels ?? [],
        registry: stateJson.registry ?? [],
        inventoryDays: stateJson.inventoryDays ?? [],
        reservations: stateJson.reservations ?? [],
        syncJobs: stateJson.syncJobs ?? [],
        syncLogs: stateJson.syncLogs ?? [],
        shadowEvents: stateJson.shadowEvents ?? [],
        shadowDiscrepancies: stateJson.shadowDiscrepancies ?? [],
        bronevikMtsTravel: stateJson.bronevikMtsTravel ?? null,
      });
    } catch {
      setError('Ошибка сети при загрузке данных');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postJson<T>(url: string, body?: Record<string, unknown>, method = 'POST'): Promise<ApiResult<T>> {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as ApiResult<T>;
  }

  async function handlePropertyChange(nextId: string) {
    setPropertyId(nextId);
    setBronevikPreview(null);
    await load(nextId);
  }

  async function handleChannelPatch(channel: ChannelManagerChannel, patch: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await postJson<{ channel?: ChannelManagerChannel }>(
      `/api/channel-manager/channels/${channel.id}`,
      patch,
      'PATCH',
    );
    setSaving(false);
    if (!result.ok) {
      setError(errorText(result.detail ?? result.error));
      return;
    }
    setMessage('Настройки канала обновлены.');
    await load(propertyId);
  }

  async function handleHealthCheck(channel: ChannelManagerChannel) {
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await postJson<{ result?: { message: string; externalCalls: number } }>(
      `/api/channel-manager/channels/${channel.id}/health-check`,
    );
    setSaving(false);
    if (!result.ok) {
      setError(errorText(result.detail ?? result.error));
      return;
    }
    setMessage(`${result.result?.message ?? 'Проверка выполнена.'} Внешних вызовов: ${result.result?.externalCalls ?? 0}.`);
    await load(propertyId);
  }

  async function handleBronevikDryRun() {
    if (!propertyId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await postJson<{
      result?: {
        preview: BronevikDryRunPreview;
        externalCalls: 0;
      };
    }>('/api/channel-manager/bronevik-mts-travel/dry-run', {
      propertyId,
      unitKey: 'default',
      dateFrom: checkInDate,
      dateTo: checkOutDate,
    });
    setSaving(false);
    if (!result.ok || !result.result) {
      setError(errorText(result.detail ?? result.error) || 'Не удалось подготовить предпросмотр.');
      return;
    }
    setBronevikPreview(result.result.preview);
    setMessage(`Предпросмотр Bronevik / МТС Travel создан. Внешних вызовов: ${result.result.externalCalls}.`);
    await load(propertyId);
  }

  async function handleInventorySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await postJson<{ result?: { availableUnits: number; syncJobs: number } }>('/api/channel-manager/inventory', {
      propertyId,
      unitKey: 'default',
      day: inventoryDay,
      totalUnits,
      manualBlockedUnits: blockedUnits,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.detail ?? result.error ?? 'Не удалось обновить доступность');
      return;
    }
    setMessage(`Доступно к продаже: ${result.result?.availableUnits ?? 0}. Задач синхронизации: ${result.result?.syncJobs ?? 0}.`);
    await load(propertyId);
  }

  async function handleReservationSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const isShadowEvent = selectedChannel?.syncMode === 'shadow';
    const result = await postJson<{
      result?: {
        status: ChannelReservation['status'] | ChannelShadowBookingEvent['status'];
        syncJobs: number;
        idempotent: boolean;
        priorityScore?: number;
        discrepancies?: number;
        externalCalls?: number;
      };
    }>(isShadowEvent ? '/api/channel-manager/shadow/events' : '/api/channel-manager/mock/reservation', {
      propertyId,
      unitKey: 'default',
      channelCode,
      eventType: 'reservation_created',
      guestName,
      checkInDate,
      checkOutDate,
      externalBookingId: externalBookingId || undefined,
      idempotencyKey: externalBookingId ? `${channelCode}:${externalBookingId}` : undefined,
      totalAmount,
      confirmationMode,
      externalAvailabilityByDay: isShadowEvent ? { [checkInDate]: 0 } : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      if (result.result?.status === 'conflict' || result.result?.status === 'rejected_by_inventory') {
        setMessage('Бронь ушла в конфликт: на выбранные даты нет доступности.');
        await load(propertyId);
        return;
      }
      setError(errorText(result.detail ?? result.error) || 'Не удалось создать тестовую бронь');
      return;
    }
    if (isShadowEvent) {
      setMessage(
        `Shadow-событие обработано. Задач: ${result.result?.syncJobs ?? 0}. Расхождений: ${result.result?.discrepancies ?? 0}. Внешних вызовов: ${result.result?.externalCalls ?? 0}.`,
      );
      await load(propertyId);
      return;
    }
    setMessage(
      result.result?.idempotent
        ? 'Повторное событие обработано без дубля.'
        : `Тестовая бронь создана. Статус: ${statusLabel(result.result?.status ?? 'pending')}. Приоритет: ${result.result?.priorityScore ?? 0}.`,
    );
    await load(propertyId);
  }

  function startReservationEdit(reservation: ChannelReservation) {
    setEditingReservationId(reservation.id);
    setEditCheckInDate(reservation.checkInDate);
    setEditCheckOutDate(reservation.checkOutDate);
  }

  async function handleModify(reservationId: string) {
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await postJson<{ result?: { status: ChannelReservation['status']; available: boolean; syncJobs: number } }>(
      '/api/channel-manager/mock/modification',
      {
        reservationId,
        checkInDate: editCheckInDate,
        checkOutDate: editCheckOutDate,
      },
    );
    setSaving(false);
    if (!result.ok) {
      if (result.result && !result.result.available) {
        setMessage('Изменение не применено: на выбранные даты нет доступности.');
        await load(propertyId);
        return;
      }
      setError(errorText(result.detail ?? result.error) || 'Не удалось изменить тестовую бронь');
      return;
    }
    setEditingReservationId(null);
    setMessage(`Тестовая бронь изменена. Статус: ${statusLabel(result.result?.status ?? 'modified')}. Задач синхронизации: ${result.result?.syncJobs ?? 0}.`);
    await load(propertyId);
  }

  async function handleCancel(reservationId: string) {
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await postJson<{ result?: { syncJobs: number } }>('/api/channel-manager/mock/cancellation', {
      reservationId,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.detail ?? result.error ?? 'Не удалось отменить бронь');
      return;
    }
    setMessage(`Бронь отменена. Задач синхронизации: ${result.result?.syncJobs ?? 0}.`);
    await load(propertyId);
  }

  return (
    <div className="max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Менеджер каналов</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Контур с приоритетом API: теневые проверки, тестовые события, защита от овербукинга и журналы синхронизации.
          </p>
        </div>
        <label className="block min-w-72">
          <span className="text-sm font-medium text-slate-700">Объект</span>
          <select
            value={propertyId}
            onChange={(e) => void handlePropertyChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.title}</option>
            ))}
          </select>
        </label>
      </header>

      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Список каналов</h2>
          <p className="text-sm text-slate-500">iCal, ручной ввод и разбор почты не допускаются в боевую автопродажу.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Канал</th>
                <th className="px-5 py-3">Тип интеграции</th>
                <th className="px-5 py-3">Режим синхронизации</th>
                <th className="px-5 py-3">Автопродажа</th>
                <th className="px-5 py-3">Защита от овербукинга</th>
                <th className="px-5 py-3">Статус адаптера</th>
                <th className="px-5 py-3">Последняя синхронизация</th>
                <th className="px-5 py-3">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td className="px-5 py-6 text-slate-500" colSpan={8}>Загрузка...</td></tr>
              ) : state.channels.length === 0 ? (
                <tr><td className="px-5 py-6 text-slate-500" colSpan={8}>Каналы пока не заведены.</td></tr>
              ) : state.channels.map((channel) => (
                <tr key={channel.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{channel.name}</p>
                    <p className="text-xs text-slate-500">{channel.code}</p>
                  </td>
                  <td className="px-5 py-3">{integrationTypeLabel(channel.integrationType)}</td>
                  <td className="px-5 py-3">
                    <select
                      value={channel.syncMode}
                      disabled={saving}
                      onChange={(e) => void handleChannelPatch(channel, { syncMode: e.target.value })}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      {(['disabled', 'read_only', 'shadow', 'active'] as SyncMode[]).map((mode) => (
                        <option
                          key={mode}
                          value={mode}
                          disabled={
                            mode === 'active' &&
                            (!isApiLikeChannel(channel) ||
                              !channel.supportsAvailabilityPush ||
                              channel.code === 'bronevik_mts_travel')
                          }
                        >
                          {syncModeLabel(mode)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={channel.isAutoSellEnabled}
                        disabled={saving || !isApiLikeChannel(channel) || channel.code === 'bronevik_mts_travel'}
                        onChange={(e) => void handleChannelPatch(channel, { isAutoSellEnabled: e.target.checked })}
                      />
                      <span>{yesNoLabel(channel.isAutoSellEnabled)}</span>
                    </label>
                  </td>
                  <td className="px-5 py-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={channel.isOverbookingProtectionEnabled}
                        disabled={saving || !isApiLikeChannel(channel) || channel.code === 'bronevik_mts_travel'}
                        onChange={(e) => void handleChannelPatch(channel, { isOverbookingProtectionEnabled: e.target.checked })}
                      />
                      <span>{yesNoLabel(channel.isOverbookingProtectionEnabled)}</span>
                    </label>
                  </td>
                  <td className="px-5 py-3">
                    <p>{channelStatusLabel(channel.status)}</p>
                    <p className="text-xs text-slate-500">тип: {adapterKindLabel(channel.adapterKind)}</p>
                  </td>
                  <td className="px-5 py-3">
                    {formatDateTime(channel.lastSyncAt)}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleHealthCheck(channel)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Проверить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Первый реальный OTA: Bronevik / МТС Travel</h2>
          <p className="text-sm text-slate-500">
            Контур работает только как песочница, теневой режим и предпросмотр. Отправка изменений наружу отключена.
          </p>
        </div>
        <div className="grid gap-5 p-5 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <div className="rounded-md bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Доступы</h3>
              <p className="mt-1 text-sm text-slate-600">
                {bronevikState?.credentials.ok ? 'Все обязательные env заданы.' : 'Не все обязательные env заданы.'}
              </p>
              <dl className="mt-3 space-y-1 text-sm">
                {Object.entries(bronevikState?.credentials.maskedValues ?? {}).map(([name, value]) => (
                  <div key={name} className="flex justify-between gap-3">
                    <dt className="truncate text-slate-500">{name}</dt>
                    <dd className="shrink-0 font-medium text-slate-700">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-md bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Проверка</h3>
              <p className="mt-1 text-sm text-slate-600">{bronevikState?.health.message ?? 'Канал не найден.'}</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                Внешних вызовов: {bronevikState?.health.externalCalls ?? 0}
              </p>
              <p className="text-sm text-slate-600">Режим: песочница / теневой / только чтение</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">С даты</span>
                <input
                  type="date"
                  value={checkInDate}
                  onChange={(e) => setCheckInDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">До даты</span>
                <input
                  type="date"
                  value={checkOutDate}
                  onChange={(e) => setCheckOutDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={saving || !propertyId}
              onClick={() => void handleBronevikDryRun()}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Создать предпросмотр
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Недостающие сопоставления</h3>
              {bronevikState?.missingMappings.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {bronevikState.missingMappings.map((item) => (
                    <li key={`${item.field}:${item.label}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                      <span className="font-medium">{item.field}</span>: {item.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Критичных пропусков по текущим данным нет.</p>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900">Предпросмотр payload</h3>
              {activeBronevikPreview ? (
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                  {JSON.stringify(activeBronevikPreview.payload, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Выберите объект и даты, затем создайте предпросмотр.</p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Последние задачи</h3>
                <div className="mt-2 space-y-2">
                  {(bronevikState?.latestSyncJobs ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">Задач пока нет.</p>
                  ) : bronevikState?.latestSyncJobs.map((job) => (
                    <div key={job.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-medium text-slate-900">{syncReasonLabel(job.reason)}</p>
                      <p className="text-slate-500">{job.dateFrom} - {job.dateTo} · {syncJobStatusLabel(job.status)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Последние записи</h3>
                <div className="mt-2 space-y-2">
                  {(bronevikState?.latestSyncLogs ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">Записей пока нет.</p>
                  ) : bronevikState?.latestSyncLogs.map((log) => (
                    <div key={log.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-medium text-slate-900">{log.message ? syncMessageLabel(log.message) : 'Событие'}</p>
                      <p className="text-slate-500">{syncDirectionLabel(log.direction)} · {syncLogStatusLabel(log.status)} · {formatDateTime(log.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <section className="rounded-md border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">Доступность</h2>
            <form onSubmit={handleInventorySubmit} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Дата</span>
                <input type="date" value={inventoryDay} onChange={(e) => setInventoryDayValue(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Всего мест</span>
                <input type="number" min={0} value={totalUnits} onChange={(e) => setTotalUnits(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Заблокировано вручную</span>
                <input type="number" min={0} value={blockedUnits} onChange={(e) => setBlockedUnits(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <button disabled={saving || !propertyId} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                Сохранить доступность
              </button>
            </form>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">Тестовая бронь</h2>
            <form onSubmit={handleReservationSubmit} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Канал</span>
                <select value={channelCode} onChange={(e) => setChannelCode(e.target.value as ChannelCode)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                  {selectableChannels.map((channel) => (
                    <option key={channel.code} value={channel.code}>{channel.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Гость</span>
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Заезд</span>
                  <input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Выезд</span>
                  <input type="date" value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Сумма</span>
                <input type="number" min={0} value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Внешний номер</span>
                <input value={externalBookingId} onChange={(e) => setExternalBookingId(e.target.value)} placeholder="бронь-1001" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmationMode === 'pending'}
                  onChange={(e) => setConfirmationMode(e.target.checked ? 'pending' : 'confirm')}
                />
                Создать как неподтверждённую заявку
              </label>
              <button disabled={saving || !propertyId} className="w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                Создать тестовую бронь
              </button>
            </form>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Календарь доступности</h2>
              <p className="text-sm text-slate-500">{selectedProperty?.title ?? 'Объект не выбран'}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Дата</th>
                    <th className="px-5 py-3">Всего</th>
                    <th className="px-5 py-3">Брони</th>
                    <th className="px-5 py-3">Блок</th>
                    <th className="px-5 py-3">К продаже</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td className="px-5 py-6 text-slate-500" colSpan={5}>Загрузка...</td></tr>
                  ) : state.inventoryDays.length === 0 ? (
                    <tr><td className="px-5 py-6 text-slate-500" colSpan={5}>Даты пока не заведены.</td></tr>
                  ) : state.inventoryDays.map((day) => (
                    <tr key={day.id}>
                      <td className="px-5 py-3 font-medium text-slate-900">{day.day}</td>
                      <td className="px-5 py-3">{day.totalUnits}</td>
                      <td className="px-5 py-3">{day.bookedUnits}</td>
                      <td className="px-5 py-3">{day.manualBlockedUnits}</td>
                      <td className="px-5 py-3 font-semibold text-emerald-700">{day.availableUnits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Shadow-события</h2>
              <p className="text-sm text-slate-500">ASI считает, создает внутренние задачи и не отправляет изменения на площадки.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {state.shadowEvents.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Shadow-событий пока нет.</p>
              ) : state.shadowEvents.map((event) => (
                <div key={event.id} className="px-5 py-4">
                  <p className="font-medium text-slate-900">
                    {channelNameById.get(event.channelId ?? '') ?? 'Канал'} · {shadowEventStatusLabel(event.status)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {event.checkInDate} - {event.checkOutDate} · мест: {event.quantity} · доступно: {event.available ? 'да' : 'нет'} · {formatDateTime(event.createdAt)}
                  </p>
                  {event.externalBookingId ? (
                    <p className="text-xs text-slate-400">Внешний номер: {event.externalBookingId}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Расхождения shadow-режима</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {state.shadowDiscrepancies.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Расхождений пока нет.</p>
              ) : state.shadowDiscrepancies.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <p className="font-medium text-slate-900">{shadowDiscrepancyLabel(item.discrepancyType)}</p>
                  <p className="text-sm text-slate-500">
                    {item.day ?? 'без даты'} · ожидалось: {item.expectedValue ?? 'нет'} · получено: {item.observedValue ?? 'нет'} · уровень: {item.severity}
                  </p>
                  <p className="text-sm text-amber-700">{item.message}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Брони</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {state.reservations.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Броней пока нет.</p>
              ) : state.reservations.map((reservation) => (
                <div key={reservation.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{reservation.guestName}</p>
                      <p className="text-sm text-slate-500">
                        {channelNameByCode.get(reservation.channelCode) ?? reservation.channelCode} · {reservation.checkInDate} - {reservation.checkOutDate} · {statusLabel(reservation.status)} · приоритет {reservation.priorityScore}
                      </p>
                      {reservation.rejectionReason ? <p className="text-sm text-red-700">Причина: {rejectionReasonLabel(reservation.rejectionReason)}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving || reservation.status === 'cancelled'}
                        onClick={() => startReservationEdit(reservation)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Изменить тестовую бронь
                      </button>
                      <button
                        type="button"
                        disabled={saving || reservation.status === 'cancelled'}
                        onClick={() => void handleCancel(reservation.id)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Отменить тестовую бронь
                      </button>
                    </div>
                  </div>
                  {editingReservationId === reservation.id ? (
                    <div className="grid gap-3 rounded-md bg-slate-50 p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">Новый заезд</span>
                        <input type="date" value={editCheckInDate} onChange={(e) => setEditCheckInDate(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">Новый выезд</span>
                        <input type="date" value={editCheckOutDate} onChange={(e) => setEditCheckOutDate(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleModify(reservation.id)}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setEditingReservationId(null)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Закрыть
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Журнал задач синхронизации</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {state.syncJobs.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Задач пока нет.</p>
              ) : state.syncJobs.map((job) => (
                <div key={job.id} className="px-5 py-4">
                  <p className="font-medium text-slate-900">{syncReasonLabel(job.reason)}</p>
                  <p className="text-sm text-slate-500">
                    {job.dateFrom} - {job.dateTo} · {syncJobStatusLabel(job.status)} · режим {syncModeLabel(job.syncMode)} · попыток: {job.attemptCount}
                  </p>
                  {job.lastError ? <p className="text-sm text-red-700">Ошибка: {syncMessageLabel(job.lastError)}</p> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Журнал событий синхронизации</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {state.syncLogs.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Записей пока нет.</p>
              ) : state.syncLogs.map((log) => (
                <div key={log.id} className="px-5 py-4">
                  <p className="font-medium text-slate-900">{log.message ? syncMessageLabel(log.message) : 'Событие без сообщения'}</p>
                  <p className="text-sm text-slate-500">{syncDirectionLabel(log.direction)} · {syncLogStatusLabel(log.status)} · {formatDateTime(log.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Журнал конфликтов</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {conflictReservations.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Конфликтов пока нет.</p>
              ) : conflictReservations.map((reservation) => (
                <div key={reservation.id} className="px-5 py-4">
                  <p className="font-medium text-slate-900">{reservation.guestName}</p>
                  <p className="text-sm text-slate-500">
                    {channelNameByCode.get(reservation.channelCode) ?? reservation.channelCode} · {reservation.checkInDate} - {reservation.checkOutDate} · {statusLabel(reservation.status)}
                  </p>
                  <p className="text-sm text-red-700">
                    Причина: {reservation.rejectionReason ? rejectionReasonLabel(reservation.rejectionReason) : 'требуется ручная проверка'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
