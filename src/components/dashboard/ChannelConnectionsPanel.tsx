'use client';

import { productSupportEmail } from '@/config/contact';
import {
  CHANNEL_CONNECTIONS_ACCESS_NOTE,
  CHANNEL_CONNECTIONS_FUTURE_PROVIDER_HINT,
  CHANNEL_CONNECTIONS_LOCATION_ANALYTICS_NOTE,
  CHANNEL_CONNECTIONS_MANUAL_IMPORT_HINT,
  CHANNEL_CONNECTIONS_PAGE_LEAD,
  CHANNEL_CONNECTIONS_PAGE_TITLE,
  CHANNEL_CONNECTIONS_REDUCTION_NOTE,
  CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE,
  CHANNEL_MANAGER_PROVIDERS,
  providerAvailabilityLabelRu,
} from '@/lib/channel-connections';
import type { ChannelManagerProviderAvailability } from '@/lib/channel-connections';

const primaryProviderCodes = ['realtycalendar', 'bnovo', 'manual_import', 'future'];

function providerStatusClass(availability: ChannelManagerProviderAvailability): string {
  switch (availability) {
    case 'available':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'foundation':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'on_request':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'planned':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-500 border-slate-200';
  }
}

export function ChannelConnectionsPanel({ compact = false }: { compact?: boolean }) {
  const primaryProviders = CHANNEL_MANAGER_PROVIDERS.filter((provider) =>
    primaryProviderCodes.includes(provider.code),
  );
  const platformProviders = CHANNEL_MANAGER_PROVIDERS.filter(
    (provider) => !primaryProviderCodes.includes(provider.code),
  );

  return (
    <div className={compact ? 'space-y-6 max-w-5xl' : 'space-y-8 max-w-5xl'}>
      {!compact ? (
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          {CHANNEL_CONNECTIONS_PAGE_TITLE}
        </h1>
        <p className="mt-2 text-lg text-slate-600 leading-relaxed max-w-3xl">
          {CHANNEL_CONNECTIONS_PAGE_LEAD}
        </p>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed max-w-3xl">
          {CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE}
        </p>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-3xl">
          {CHANNEL_CONNECTIONS_LOCATION_ANALYTICS_NOTE}
        </p>
      </header>
      ) : null}

      {!compact ? (
      <>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">1. Сначала Менеджер Каналов</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Подключаемся к уже рабочему контуру, чтобы не переносить объект на новую систему вручную.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">2. Затем адаптеры площадок</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Российские OTA и площадки продаж добавляются поэтапно через отдельные адаптеры.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">3. Меньше ручной работы</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            ASI сводит календарь, цены, брони и заявки в один рабочий контур для будущей автоматизации.
          </p>
        </div>
      </section>
      </>
      ) : null}

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Менеджеры каналов и базовый ввод</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Это первый слой: ASI использует существующий Менеджер Каналов или ручную загрузку как основу для данных.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {primaryProviders.map((provider) => {
            const badge = providerAvailabilityLabelRu(provider.availability);
            const isFuture = provider.code === 'future';
            const hint = provider.code === 'manual_import'
              ? CHANNEL_CONNECTIONS_MANUAL_IMPORT_HINT
              : provider.description;

            if (isFuture) {
              return (
                <a
                  key={provider.code}
                  href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Запрос на подключение менеджера каналов')}`}
                  className="group flex items-center justify-between rounded-xl border border-slate-200 px-6 py-5 hover:border-slate-300 hover:bg-slate-50 transition-all"
                >
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{provider.displayName}</p>
                    <p className="mt-0.5 text-sm text-slate-500 group-hover:text-slate-700">
                      {CHANNEL_CONNECTIONS_FUTURE_PROVIDER_HINT}
                    </p>
                  </div>
                  <span className={`shrink-0 ml-4 text-sm px-3 py-1 rounded-full border ${providerStatusClass(provider.availability)}`}>
                    {badge}
                  </span>
                </a>
              );
            }

            return (
              <div
                key={provider.code}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-6 py-5"
              >
                <div>
                  <p className="text-lg font-semibold text-slate-700">{provider.displayName}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{hint}</p>
                </div>
                <span className={`shrink-0 ml-4 text-sm px-3 py-1 rounded-full border ${providerStatusClass(provider.availability)}`}>
                  {badge}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Адаптеры российских площадок</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Эти подключения не заявлены как live-интеграции. Сейчас это карта адаптеров для поэтапного запуска.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {platformProviders.map((provider) => {
            const badge = providerAvailabilityLabelRu(provider.availability);

            return (
              <div
                key={provider.code}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-6 py-5"
              >
                <div>
                  <p className="text-lg font-semibold text-slate-700">{provider.displayName}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{provider.description}</p>
                </div>
                <span className={`shrink-0 ml-4 text-sm px-3 py-1 rounded-full border ${providerStatusClass(provider.availability)}`}>
                  {badge}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {!compact ? (
      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Что дает этот этап</h2>
        <ol className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed list-none">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">
              1
            </span>
            <span>Единая основа для объектов, календарей, цен, броней и заявок</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">
              2
            </span>
            <span>{CHANNEL_CONNECTIONS_ACCESS_NOTE}</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">
              3
            </span>
            <span>{CHANNEL_CONNECTIONS_REDUCTION_NOTE}</span>
          </li>
        </ol>
      </section>
      ) : null}
    </div>
  );
}
