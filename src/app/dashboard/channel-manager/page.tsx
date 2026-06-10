'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { ChannelManagerDebugTools } from '@/components/dashboard/channel-manager/ChannelManagerDebugTools';
import { ChannelManagerOwnerView } from '@/components/dashboard/channel-manager/ChannelManagerOwnerView';
import { isApiLikeChannel, statusLabel } from '@/components/dashboard/channel-manager/labels';
import type { BronevikDryRunPreview } from '@/lib/channel-manager/bronevik-mts-real-adapter';
import type { PropertyReadiness } from '@/lib/channel-manager/property-lifecycle';
import {
  userFacingChannelManagerActionError,
  userFacingChannelManagerLoadError,
} from '@/lib/channel-manager/user-messages';
import type {
  ChannelCode,
  ChannelManagerChannel,
  ChannelReservation,
  ChannelShadowBookingEvent,
  ChannelShadowDiscrepancy,
  ChannelSyncJob,
  ChannelSyncLog,
  InventoryDay,
} from '@/lib/channel-manager/types';
import type { OpsProperty } from '@/lib/ops-foundation/types';

type ApiState = {
  channels: ChannelManagerChannel[];
  inventoryDays: InventoryDay[];
  reservations: ChannelReservation[];
  syncJobs: ChannelSyncJob[];
  syncLogs: ChannelSyncLog[];
  shadowEvents: ChannelShadowBookingEvent[];
  shadowDiscrepancies: ChannelShadowDiscrepancy[];
  bronevikMtsTravel: {
    channelId: string | null;
    credentials: { ok: boolean; maskedValues: Record<string, string> };
    health: { ok: boolean; message: string; externalCalls: number };
    mode: 'sandbox_shadow_read_only';
    sandbox: boolean;
    dryRunPreview: BronevikDryRunPreview | null;
    missingMappings: BronevikDryRunPreview['missingMappings'];
    latestSyncJobs: ChannelSyncJob[];
    latestSyncLogs: ChannelSyncLog[];
  } | null;
};

type ApiEnvelope = { ok?: boolean; error?: unknown; detail?: unknown; result?: unknown };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export default function ChannelManagerPage() {
  const { session } = useSession();
  const isInternal = session?.isInternal === true;

  const [properties, setProperties] = useState<OpsProperty[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [readiness, setReadiness] = useState<PropertyReadiness | null>(null);
  const [state, setState] = useState<ApiState>({
    channels: [],
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

  const load = useCallback(async (nextPropertyId = propertyId) => {
    setLoading(true);
    setError(null);
    try {
      const propertiesRes = await fetch('/api/ops/properties');
      const propertiesJson = (await propertiesRes.json()) as ApiEnvelope & { properties?: OpsProperty[] };
      if (!propertiesRes.ok || !propertiesJson.ok) {
        console.error('[channel-manager] properties load failed', propertiesJson);
        setError(userFacingChannelManagerLoadError(propertiesJson.detail, propertiesJson.error));
        return;
      }

      const loadedProperties = propertiesJson.properties ?? [];
      setProperties(loadedProperties);
      const activePropertyId = nextPropertyId || loadedProperties[0]?.id || '';
      if (!propertyId && activePropertyId) setPropertyId(activePropertyId);

      const summaryUrl = activePropertyId
        ? `/api/channel-manager/summary?propertyId=${activePropertyId}`
        : '/api/channel-manager/summary';
      const readinessUrl = activePropertyId
        ? `/api/channel-manager/readiness?propertyId=${activePropertyId}`
        : '/api/channel-manager/readiness';

      const [stateRes, readinessRes] = await Promise.all([fetch(summaryUrl), fetch(readinessUrl)]);
      const stateJson = (await stateRes.json()) as ApiEnvelope & Partial<ApiState>;
      const readinessJson = (await readinessRes.json()) as ApiEnvelope & { readiness?: PropertyReadiness };

      if (!stateRes.ok || !stateJson.ok) {
        console.error('[channel-manager] summary load failed', stateJson);
        setError(userFacingChannelManagerLoadError(stateJson.detail, stateJson.error));
        return;
      }

      setState({
        channels: stateJson.channels ?? [],
        inventoryDays: stateJson.inventoryDays ?? [],
        reservations: stateJson.reservations ?? [],
        syncJobs: stateJson.syncJobs ?? [],
        syncLogs: stateJson.syncLogs ?? [],
        shadowEvents: stateJson.shadowEvents ?? [],
        shadowDiscrepancies: stateJson.shadowDiscrepancies ?? [],
        bronevikMtsTravel: stateJson.bronevikMtsTravel ?? null,
      });

      if (readinessRes.ok && readinessJson.ok && readinessJson.readiness) {
        setReadiness(readinessJson.readiness);
      } else {
        console.warn('[channel-manager] readiness load failed', readinessJson);
        setReadiness(null);
      }
    } catch (loadError) {
      console.error('[channel-manager] network error', loadError);
      setError('Ошибка сети при загрузке данных. Обновите страницу.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postJson<T>(url: string, body?: Record<string, unknown>, method = 'POST'): Promise<ApiEnvelope & T> {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as ApiEnvelope & T;
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
      console.error('[channel-manager] channel patch failed', result);
      setError(userFacingChannelManagerActionError(result.detail, result.error));
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
      setError(userFacingChannelManagerActionError(result.detail, result.error));
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
      result?: { preview: BronevikDryRunPreview; externalCalls: 0 };
    }>('/api/channel-manager/bronevik-mts-travel/dry-run', {
      propertyId,
      unitKey: 'default',
      dateFrom: checkInDate,
      dateTo: checkOutDate,
    });
    setSaving(false);
    if (!result.ok || !result.result) {
      setError(userFacingChannelManagerActionError(result.detail, result.error) || 'Не удалось подготовить предпросмотр.');
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
      setError(userFacingChannelManagerActionError(result.detail, result.error) || 'Не удалось обновить доступность');
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
      setError(userFacingChannelManagerActionError(result.detail, result.error) || 'Не удалось создать тестовую бронь');
      return;
    }
    if (isShadowEvent) {
      setMessage(
        `Shadow-событие обработано. Задач: ${result.result?.syncJobs ?? 0}. Расхождений: ${result.result?.discrepancies ?? 0}.`,
      );
      await load(propertyId);
      return;
    }
    setMessage(
      result.result?.idempotent
        ? 'Повторное событие обработано без дубля.'
        : `Тестовая бронь создана. Статус: ${statusLabel(result.result?.status ?? 'pending')}.`,
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
      { reservationId, checkInDate: editCheckInDate, checkOutDate: editCheckOutDate },
    );
    setSaving(false);
    if (!result.ok) {
      if (result.result && !result.result.available) {
        setMessage('Изменение не применено: на выбранные даты нет доступности.');
        await load(propertyId);
        return;
      }
      setError(userFacingChannelManagerActionError(result.detail, result.error) || 'Не удалось изменить тестовую бронь');
      return;
    }
    setEditingReservationId(null);
    setMessage(`Тестовая бронь изменена. Статус: ${statusLabel(result.result?.status ?? 'modified')}.`);
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
      setError(userFacingChannelManagerActionError(result.detail, result.error) || 'Не удалось отменить бронь');
      return;
    }
    setMessage(`Бронь отменена. Задач синхронизации: ${result.result?.syncJobs ?? 0}.`);
    await load(propertyId);
  }

  return (
    <div className="max-w-7xl space-y-6">
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <ChannelManagerOwnerView
        properties={properties}
        propertyId={propertyId}
        selectedProperty={selectedProperty}
        readiness={readiness}
        channels={state.channels}
        conflictReservations={conflictReservations}
        discrepancyCount={state.shadowDiscrepancies.length}
        loading={loading}
        onPropertyChange={(nextId) => void handlePropertyChange(nextId)}
      />

      {isInternal ? (
        <ChannelManagerDebugTools
          loading={loading}
          saving={saving}
          propertyId={propertyId}
          selectedProperty={selectedProperty}
          state={state}
          bronevikPreview={bronevikPreview}
          channelNameByCode={channelNameByCode}
          channelNameById={channelNameById}
          selectableChannels={selectableChannels}
          selectedChannel={selectedChannel}
          conflictReservations={conflictReservations}
          inventoryDay={inventoryDay}
          totalUnits={totalUnits}
          blockedUnits={blockedUnits}
          channelCode={channelCode}
          guestName={guestName}
          checkInDate={checkInDate}
          checkOutDate={checkOutDate}
          externalBookingId={externalBookingId}
          totalAmount={totalAmount}
          confirmationMode={confirmationMode}
          editingReservationId={editingReservationId}
          editCheckInDate={editCheckInDate}
          editCheckOutDate={editCheckOutDate}
          onInventoryDayChange={setInventoryDayValue}
          onTotalUnitsChange={setTotalUnits}
          onBlockedUnitsChange={setBlockedUnits}
          onChannelCodeChange={setChannelCode}
          onGuestNameChange={setGuestName}
          onCheckInDateChange={setCheckInDate}
          onCheckOutDateChange={setCheckOutDate}
          onExternalBookingIdChange={setExternalBookingId}
          onTotalAmountChange={setTotalAmount}
          onConfirmationModeChange={setConfirmationMode}
          onEditCheckInDateChange={setEditCheckInDate}
          onEditCheckOutDateChange={setEditCheckOutDate}
          onChannelPatch={(channel, patch) => void handleChannelPatch(channel, patch)}
          onHealthCheck={(channel) => void handleHealthCheck(channel)}
          onBronevikDryRun={() => void handleBronevikDryRun()}
          onInventorySubmit={(e) => void handleInventorySubmit(e)}
          onReservationSubmit={(e) => void handleReservationSubmit(e)}
          onStartReservationEdit={startReservationEdit}
          onModify={(id) => void handleModify(id)}
          onCancel={(id) => void handleCancel(id)}
          onCloseReservationEdit={() => setEditingReservationId(null)}
        />
      ) : null}
    </div>
  );
}
