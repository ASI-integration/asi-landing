'use client';

import { productSupportEmail } from '@/config/contact';
import {
  CHANNEL_CONNECTIONS_FUTURE_PROVIDER_HINT,
  CHANNEL_CONNECTIONS_MANUAL_IMPORT_HINT,
  CHANNEL_CONNECTIONS_PAGE_LEAD,
  CHANNEL_CONNECTIONS_PAGE_TITLE,
  CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE,
  CHANNEL_MANAGER_PROVIDERS,
  providerAvailabilityLabelRu,
} from '@/lib/channel-connections';

export function ChannelConnectionsPanel() {
  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          {CHANNEL_CONNECTIONS_PAGE_TITLE}
        </h1>
        <p className="mt-2 text-lg text-slate-600 leading-relaxed max-w-2xl">
          {CHANNEL_CONNECTIONS_PAGE_LEAD}
        </p>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed max-w-2xl">
          {CHANNEL_CONNECTIONS_RU_PROVIDERS_NOTE}
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Провайдеры</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Интеграции подключаются поэтапно. Учётные данные API пока не запрашиваются.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {CHANNEL_MANAGER_PROVIDERS.map((provider) => {
            const badge = providerAvailabilityLabelRu(provider.availability);
            const isFuture = provider.code === 'future';
            const isManual = provider.code === 'manual_import';

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
                  <span className="shrink-0 ml-4 text-sm px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
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
                  <p
                    className={`text-lg font-semibold ${
                      provider.availability === 'coming_soon' ? 'text-slate-400' : 'text-slate-700'
                    }`}
                  >
                    {provider.displayName}
                  </p>
                  {isManual ? (
                    <p className="mt-0.5 text-sm text-slate-500">{CHANNEL_CONNECTIONS_MANUAL_IMPORT_HINT}</p>
                  ) : (
                    <p className="mt-0.5 text-sm text-slate-400">Интеграция в разработке</p>
                  )}
                </div>
                <span className="shrink-0 ml-4 text-sm px-3 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  {badge}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Что появится после подключения</h2>
        <ol className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed list-none">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">
              1
            </span>
            <span>Импорт объектов и статусов синхронизации по каждому объекту</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">
              2
            </span>
            <span>Актуальные брони, даты заезда и выезда, цены и занятость</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">
              3
            </span>
            <span>Разделы «Операции» и «Коммуникация» получат контекст из одного источника</span>
          </li>
        </ol>
      </section>
    </div>
  );
}
