'use client';

export default function AutomationsPage() {
  return (
    <div className="space-y-8 max-w-3xl">

      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Автоматизация</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Контур автоматизации координирует операционные процессы и снижает ручную нагрузку. Он
          строится поверх подключённых источников данных и готовых объектов.
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Что будет автоматизировано</h2>
        <ul className="mt-5 space-y-4 text-base text-slate-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Коммуникация с гостями по этапам пребывания: до заезда, во время, после выезда</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Операционные задачи: уборка, передача ключей, проверка готовности объекта</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Уведомления команде по событиям в системе</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Сценарии обработки нестандартных ситуаций</span>
          </li>
        </ul>
      </section>

      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Порядок активации</h2>
        <p className="mt-3 text-base text-slate-600 leading-relaxed">
          Автоматизации становятся доступны поэтапно — по мере готовности системы:
        </p>
        <ol className="mt-4 space-y-2 text-sm text-slate-500 leading-relaxed">
          <li>1. Подключить источник данных (PMS / менеджер каналов)</li>
          <li>2. Импортировать и заполнить объекты</li>
          <li>3. Настроить контур коммуникации</li>
          <li>4. Включить и настроить нужные автоматизации</li>
        </ol>
      </section>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-5">
        <p className="text-base font-medium text-slate-700">Раздел будет доступен позже</p>
        <p className="mt-1 text-sm text-slate-500">
          Настройка автоматизаций станет возможной после подключения источника данных и заполнения
          объектов.
        </p>
      </div>

    </div>
  );
}
