'use client';

import Link from 'next/link';
import type { OpsProperty } from '@/lib/ops-foundation/types';
import type { PropertyReadiness } from '@/lib/channel-manager/property-lifecycle';
import type { ChannelManagerChannel, ChannelReservation } from '@/lib/channel-manager/types';
import { AsiAutomationInfo } from './AsiAutomationInfo';
import { PropertyPreparationSteps } from './PropertyPreparationSteps';
import { channelStatusLabel, formatDateTime, integrationTypeLabel, syncModeLabel } from './labels';

type OwnerViewProps = {
  properties: OpsProperty[];
  propertyId: string;
  selectedProperty: OpsProperty | null;
  readiness: PropertyReadiness | null;
  channels: ChannelManagerChannel[];
  conflictReservations: ChannelReservation[];
  discrepancyCount: number;
  loading: boolean;
  onPropertyChange: (propertyId: string) => void;
};

function ownerChannelStatus(channel: ChannelManagerChannel): string {
  if (channel.status === 'error') return 'Ошибка подключения';
  if (channel.status === 'ready_for_credentials') return 'Нужны доступы';
  if (channel.syncMode === 'shadow') return 'Теневой режим — сверка без продаж';
  if (channel.syncMode === 'read_only') return 'Только чтение';
  if (channel.syncMode === 'active') return 'Синхронизация активна';
  if (channel.syncMode === 'disabled') return 'Ожидает подключения';
  return channelStatusLabel(channel.status);
}

export function ChannelManagerOwnerView({
  properties,
  propertyId,
  selectedProperty,
  readiness,
  channels,
  conflictReservations,
  discrepancyCount,
  loading,
  onPropertyChange,
}: OwnerViewProps) {
  const apiChannels = channels.filter(
    (channel) => channel.integrationType === 'api' || channel.integrationType === 'partner_channel_manager_api',
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Автономный контур ASI</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Продажи и каналы</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Загрузите данные объекта, подключите каналы — ASI сам синхронизирует доступность, цены и брони.
          </p>
        </div>
        <label className="block min-w-72">
          <span className="text-sm font-medium text-slate-700">Объект</span>
          <select
            value={propertyId}
            onChange={(e) => onPropertyChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      {readiness ? <PropertyPreparationSteps readiness={readiness} propertyId={propertyId} /> : null}

      <AsiAutomationInfo />

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Статус каналов</h2>
          <p className="mt-1 text-sm text-slate-500">
            {selectedProperty?.title ?? 'Объект не выбран'} — ASI управляет синхронизацией автоматически.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {loading ? (
            <p className="px-5 py-6 text-sm text-slate-500">Загрузка...</p>
          ) : apiChannels.length === 0 ? (
            <div className="px-5 py-6">
              <p className="text-sm text-slate-500">Каналы ещё не подключены.</p>
              <Link
                href="/dashboard/channel-connections"
                className="mt-3 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Подключить каналы
              </Link>
            </div>
          ) : (
            apiChannels.map((channel) => (
              <div key={channel.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium text-slate-900">{channel.name}</p>
                  <p className="text-sm text-slate-500">
                    {integrationTypeLabel(channel.integrationType)} · {syncModeLabel(channel.syncMode)}
                  </p>
                </div>
                <div className="text-sm text-slate-600">
                  <p className="font-medium text-slate-900">{ownerChannelStatus(channel)}</p>
                  <p className="text-xs text-slate-500">Последняя синхронизация: {formatDateTime(channel.lastSyncAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {(conflictReservations.length > 0 || discrepancyCount > 0) && (
        <section className="rounded-xl border border-red-200 bg-red-50">
          <div className="border-b border-red-100 px-5 py-4">
            <h2 className="text-base font-semibold text-red-900">Нужно ваше действие</h2>
            <p className="mt-1 text-sm text-red-700">
              ASI остановил автоматическую обработку там, где есть риск ошибки.
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            {conflictReservations.map((reservation) => (
              <div key={reservation.id} className="rounded-md border border-red-200 bg-white px-4 py-3 text-sm">
                <p className="font-medium text-slate-900">{reservation.guestName}</p>
                <p className="text-slate-600">
                  {reservation.checkInDate} — {reservation.checkOutDate} · конфликт бронирования
                </p>
              </div>
            ))}
            {discrepancyCount > 0 ? (
              <p className="text-sm text-red-800">
                Обнаружено расхождений в теневом режиме: {discrepancyCount}. Команда ASI проверит детали.
              </p>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
