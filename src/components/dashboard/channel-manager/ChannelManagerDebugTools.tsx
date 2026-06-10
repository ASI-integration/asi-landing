'use client';

import { useState } from 'react';
import type { BronevikDryRunPreview } from '@/lib/channel-manager/bronevik-mts-real-adapter';
import type {
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
import type { OpsProperty } from '@/lib/ops-foundation/types';
import {
  adapterKindLabel,
  channelStatusLabel,
  formatDateTime,
  integrationTypeLabel,
  isApiLikeChannel,
  rejectionReasonLabel,
  shadowDiscrepancyLabel,
  shadowEventStatusLabel,
  statusLabel,
  syncDirectionLabel,
  syncJobStatusLabel,
  syncLogStatusLabel,
  syncMessageLabel,
  syncModeLabel,
  syncReasonLabel,
  yesNoLabel,
} from './labels';

export type ChannelManagerDebugToolsProps = {
  loading: boolean;
  saving: boolean;
  propertyId: string;
  selectedProperty: OpsProperty | null;
  state: {
    channels: ChannelManagerChannel[];
    inventoryDays: InventoryDay[];
    reservations: ChannelReservation[];
    syncJobs: ChannelSyncJob[];
    syncLogs: ChannelSyncLog[];
    shadowEvents: ChannelShadowBookingEvent[];
    shadowDiscrepancies: ChannelShadowDiscrepancy[];
    bronevikMtsTravel: {
      credentials: { ok: boolean; maskedValues: Record<string, string> };
      health: { ok: boolean; message: string; externalCalls: number };
      missingMappings: BronevikDryRunPreview['missingMappings'];
      latestSyncJobs: ChannelSyncJob[];
      latestSyncLogs: ChannelSyncLog[];
    } | null;
  };
  bronevikPreview: BronevikDryRunPreview | null;
  channelNameByCode: Map<ChannelCode, string>;
  channelNameById: Map<string, string>;
  selectableChannels: ChannelManagerChannel[];
  selectedChannel: ChannelManagerChannel | null;
  conflictReservations: ChannelReservation[];
  inventoryDay: string;
  totalUnits: number;
  blockedUnits: number;
  channelCode: ChannelCode;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  externalBookingId: string;
  totalAmount: number;
  confirmationMode: 'confirm' | 'pending';
  editingReservationId: string | null;
  editCheckInDate: string;
  editCheckOutDate: string;
  onInventoryDayChange: (value: string) => void;
  onTotalUnitsChange: (value: number) => void;
  onBlockedUnitsChange: (value: number) => void;
  onChannelCodeChange: (value: ChannelCode) => void;
  onGuestNameChange: (value: string) => void;
  onCheckInDateChange: (value: string) => void;
  onCheckOutDateChange: (value: string) => void;
  onExternalBookingIdChange: (value: string) => void;
  onTotalAmountChange: (value: number) => void;
  onConfirmationModeChange: (value: 'confirm' | 'pending') => void;
  onEditCheckInDateChange: (value: string) => void;
  onEditCheckOutDateChange: (value: string) => void;
  onChannelPatch: (channel: ChannelManagerChannel, patch: Record<string, unknown>) => void;
  onHealthCheck: (channel: ChannelManagerChannel) => void;
  onBronevikDryRun: () => void;
  onInventorySubmit: (e: React.FormEvent) => void;
  onReservationSubmit: (e: React.FormEvent) => void;
  onStartReservationEdit: (reservation: ChannelReservation) => void;
  onModify: (reservationId: string) => void;
  onCancel: (reservationId: string) => void;
  onCloseReservationEdit: () => void;
};

export function ChannelManagerDebugTools(props: ChannelManagerDebugToolsProps) {
  const {
    loading,
    saving,
    propertyId,
    selectedProperty,
    state,
    bronevikPreview,
    channelNameByCode,
    channelNameById,
    selectableChannels,
    selectedChannel,
    conflictReservations,
    inventoryDay,
    totalUnits,
    blockedUnits,
    channelCode,
    guestName,
    checkInDate,
    checkOutDate,
    externalBookingId,
    totalAmount,
    confirmationMode,
    editingReservationId,
    editCheckInDate,
    editCheckOutDate,
    onInventoryDayChange,
    onTotalUnitsChange,
    onBlockedUnitsChange,
    onChannelCodeChange,
    onGuestNameChange,
    onCheckInDateChange,
    onCheckOutDateChange,
    onExternalBookingIdChange,
    onTotalAmountChange,
    onConfirmationModeChange,
    onEditCheckInDateChange,
    onEditCheckOutDateChange,
    onChannelPatch,
    onHealthCheck,
    onBronevikDryRun,
    onInventorySubmit,
    onReservationSubmit,
    onStartReservationEdit,
    onModify,
    onCancel,
    onCloseReservationEdit,
  } = props;

  const bronevikState = state.bronevikMtsTravel;
  const activeBronevikPreview = bronevikPreview ?? null;
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">Внутренние инструменты / тестовый режим</h2>
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
              Только для команды ASI
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Ручная доступность, mock-брони, журналы синхронизации, Bronevik dry-run и предпросмотр payload.
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600">
          {open ? 'Скрыть' : 'Показать'}
        </span>
      </button>

      {open ? (
      <div className="space-y-6 border-t border-slate-200 p-5">
        <section className="rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Список каналов (управление)</h3>
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
                        onChange={(e) => void onChannelPatch(channel, { syncMode: e.target.value })}
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
                          onChange={(e) => void onChannelPatch(channel, { isAutoSellEnabled: e.target.checked })}
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
                          onChange={(e) => void onChannelPatch(channel, { isOverbookingProtectionEnabled: e.target.checked })}
                        />
                        <span>{yesNoLabel(channel.isOverbookingProtectionEnabled)}</span>
                      </label>
                    </td>
                    <td className="px-5 py-3">
                      <p>{channelStatusLabel(channel.status)}</p>
                      <p className="text-xs text-slate-500">тип: {adapterKindLabel(channel.adapterKind)}</p>
                    </td>
                    <td className="px-5 py-3">{formatDateTime(channel.lastSyncAt)}</td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void onHealthCheck(channel)}
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
            <h3 className="text-base font-semibold text-slate-900">Bronevik / МТС Travel (dry-run)</h3>
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <div className="rounded-md bg-slate-50 p-4">
                <p className="text-sm text-slate-600">
                  {bronevikState?.credentials.ok ? 'Все обязательные env заданы.' : 'Не все обязательные env заданы.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">С даты</span>
                  <input type="date" value={checkInDate} onChange={(e) => onCheckInDateChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">До даты</span>
                  <input type="date" value={checkOutDate} onChange={(e) => onCheckOutDateChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>
              <button type="button" disabled={saving || !propertyId} onClick={() => void onBronevikDryRun()} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                Создать предпросмотр
              </button>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Предпросмотр payload</h4>
              {activeBronevikPreview ? (
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                  {JSON.stringify(activeBronevikPreview.payload, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Выберите объект и даты, затем создайте предпросмотр.</p>
              )}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-6">
            <section className="rounded-md border border-slate-200 bg-white p-5">
              <h3 className="text-base font-semibold text-slate-900">Ручная доступность</h3>
              <form onSubmit={onInventorySubmit} className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Дата</span>
                  <input type="date" value={inventoryDay} onChange={(e) => onInventoryDayChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Всего мест</span>
                  <input type="number" min={0} value={totalUnits} onChange={(e) => onTotalUnitsChange(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Заблокировано вручную</span>
                  <input type="number" min={0} value={blockedUnits} onChange={(e) => onBlockedUnitsChange(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <button disabled={saving || !propertyId} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  Сохранить доступность
                </button>
              </form>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-5">
              <h3 className="text-base font-semibold text-slate-900">Создать тестовую бронь</h3>
              <form onSubmit={onReservationSubmit} className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Канал</span>
                  <select value={channelCode} onChange={(e) => onChannelCodeChange(e.target.value as ChannelCode)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                    {selectableChannels.map((channel) => (
                      <option key={channel.code} value={channel.code}>{channel.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Гость</span>
                  <input value={guestName} onChange={(e) => onGuestNameChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Заезд</span>
                    <input type="date" value={checkInDate} onChange={(e) => onCheckInDateChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Выезд</span>
                    <input type="date" value={checkOutDate} onChange={(e) => onCheckOutDateChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Сумма</span>
                  <input type="number" min={0} value={totalAmount} onChange={(e) => onTotalAmountChange(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Внешний номер</span>
                  <input value={externalBookingId} onChange={(e) => onExternalBookingIdChange(e.target.value)} placeholder="бронь-1001" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={confirmationMode === 'pending'} onChange={(e) => onConfirmationModeChange(e.target.checked ? 'pending' : 'confirm')} />
                  Создать как неподтверждённую заявку
                </label>
                <button disabled={saving || !propertyId} className="w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  Создать тестовую бронь
                </button>
                {selectedChannel?.syncMode === 'shadow' ? (
                  <p className="text-xs text-slate-500">Выбран теневой канал — событие пойдёт в shadow/events.</p>
                ) : null}
              </form>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Календарь доступности</h3>
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
                <h3 className="text-base font-semibold text-slate-900">Shadow-события</h3>
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
                      {event.checkInDate} - {event.checkOutDate} · {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Расхождения shadow-режима</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {state.shadowDiscrepancies.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500">Расхождений пока нет.</p>
                ) : state.shadowDiscrepancies.map((item) => (
                  <div key={item.id} className="px-5 py-4">
                    <p className="font-medium text-slate-900">{shadowDiscrepancyLabel(item.discrepancyType)}</p>
                    <p className="text-sm text-amber-700">{item.message}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Брони (тест)</h3>
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
                          {channelNameByCode.get(reservation.channelCode) ?? reservation.channelCode} · {statusLabel(reservation.status)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={saving || reservation.status === 'cancelled'} onClick={() => onStartReservationEdit(reservation)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
                          Изменить
                        </button>
                        <button type="button" disabled={saving || reservation.status === 'cancelled'} onClick={() => void onCancel(reservation.id)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
                          Отменить
                        </button>
                      </div>
                    </div>
                    {editingReservationId === reservation.id ? (
                      <div className="grid gap-3 rounded-md bg-slate-50 p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                        <label className="block">
                          <span className="text-sm font-medium text-slate-700">Новый заезд</span>
                          <input type="date" value={editCheckInDate} onChange={(e) => onEditCheckInDateChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium text-slate-700">Новый выезд</span>
                          <input type="date" value={editCheckOutDate} onChange={(e) => onEditCheckOutDateChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                        </label>
                        <button type="button" disabled={saving} onClick={() => void onModify(reservation.id)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                          Сохранить
                        </button>
                        <button type="button" disabled={saving} onClick={onCloseReservationEdit} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
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
                <h3 className="text-base font-semibold text-slate-900">Журнал задач синхронизации</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {state.syncJobs.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500">Задач пока нет.</p>
                ) : state.syncJobs.map((job) => (
                  <div key={job.id} className="px-5 py-4">
                    <p className="font-medium text-slate-900">{syncReasonLabel(job.reason)}</p>
                    <p className="text-sm text-slate-500">{syncJobStatusLabel(job.status)} · {formatDateTime(job.createdAt)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Журнал событий синхронизации</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {state.syncLogs.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500">Записей пока нет.</p>
                ) : state.syncLogs.map((log) => (
                  <div key={log.id} className="px-5 py-4">
                    <p className="font-medium text-slate-900">{log.message ? syncMessageLabel(log.message) : 'Событие'}</p>
                    <p className="text-sm text-slate-500">{syncDirectionLabel(log.direction)} · {syncLogStatusLabel(log.status)}</p>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                      {JSON.stringify(log.requestJson, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Журнал конфликтов</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {conflictReservations.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500">Конфликтов пока нет.</p>
                ) : conflictReservations.map((reservation) => (
                  <div key={reservation.id} className="px-5 py-4">
                    <p className="font-medium text-slate-900">{reservation.guestName}</p>
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
      ) : null}
    </section>
  );
}
