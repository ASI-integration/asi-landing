'use client';

import { productSupportEmail } from '@/config/contact';

const pmsItems = [
  { name: 'RealtyCalendar', status: 'soon' as const },
  { name: 'Bnovo', status: 'soon' as const },
  { name: 'TravelLine', status: 'soon' as const },
  { name: 'Другая система', status: 'request' as const },
] as const;

export default function DataSourcePage() {
  return (
    <div className="space-y-8 max-w-3xl">

      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Источник данных</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Подключите PMS или менеджер каналов как основной источник бронирований, доступности и
          тарифов. Это первый и ключевой шаг для работы всей системы.
        </p>
      </header>

      {/* What this section is for */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Зачем подключать менеджер каналов?</h2>
        <div className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed">
          <p>
            ASI строится вокруг единого источника данных — системы, в которой вы уже ведёте
            объекты, бронирования и доступность. Это может быть PMS, менеджер каналов или
            аналогичная платформа.
          </p>
          <p>
            После подключения ASI сможет автоматически импортировать объекты, получать актуальные
            данные о бронированиях и синхронизировать доступность. Вам не нужно будет вводить
            одни и те же данные вручную в нескольких местах.
          </p>
        </div>
      </section>

      {/* PMS list */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Выберите систему</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Интеграции подключаются поэтапно. Вы можете запросить подключение вашей системы заранее.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {pmsItems.map((item) =>
            item.status === 'request' ? (
              <a
                key={item.name}
                href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Запрос на подключение PMS / Channel Manager')}`}
                className="group flex items-center justify-between rounded-xl border border-slate-200 px-6 py-5 hover:border-slate-300 hover:bg-slate-50 transition-all"
              >
                <div>
                  <p className="text-lg font-semibold text-slate-900">{item.name}</p>
                  <p className="mt-0.5 text-sm text-slate-500 group-hover:text-slate-700">
                    Напишите нам — обсудим подключение вашей системы
                  </p>
                </div>
                <span className="shrink-0 ml-4 text-sm px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  По запросу
                </span>
              </a>
            ) : (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-6 py-5 cursor-default"
              >
                <div>
                  <p className="text-lg font-semibold text-slate-400">{item.name}</p>
                  <p className="mt-0.5 text-sm text-slate-400">Интеграция в разработке</p>
                </div>
                <span className="shrink-0 ml-4 text-sm px-3 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                  Скоро
                </span>
              </div>
            )
          )}
        </div>
      </section>

      {/* What happens after connection */}
      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Что произойдёт после подключения</h2>
        <ol className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed list-none">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">1</span>
            <span>ASI импортирует список объектов из подключённой системы</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">2</span>
            <span>Система оценит полноту данных по каждому объекту</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">3</span>
            <span>Вы будете проведены через заполнение только недостающих данных</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">4</span>
            <span>Остальные разделы системы станут доступны для настройки</span>
          </li>
        </ol>
      </section>

    </div>
  );
}
