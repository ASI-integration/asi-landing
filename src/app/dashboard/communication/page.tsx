'use client';

export default function CommunicationPage() {
  return (
    <div className="space-y-8 max-w-3xl">

      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Коммуникация</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Контур коммуникации — это слой взаимодействия с гостями и операционная среда для
          AI-поддержки. Он станет доступен после подключения источника данных.
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Роль этого раздела</h2>
        <div className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed">
          <p>
            Контур коммуникации — это не просто мессенджер. Это рабочая среда, в которой система
            ведёт переписку с гостями, помогает операторам настраивать процессы и снижает нагрузку
            на ручную поддержку.
          </p>
          <p>
            Здесь будет сосредоточена переписка с гостями, уведомления, шаблоны ответов и
            AI-ассистент, который помогает проводить гостя через весь цикл пребывания.
          </p>
        </div>
      </section>

      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Что будет доступно</h2>
        <ul className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Рабочее пространство для переписки с гостями</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>AI-ассистент для автоматических ответов и сопровождения гостей</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Шаблоны и сценарии коммуникации по этапам пребывания</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Интеграция с мессенджерами и каналами связи</span>
          </li>
        </ul>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
        <p className="text-base font-medium text-amber-800">Требует настройки источника данных</p>
        <p className="mt-1 text-sm text-amber-700">
          Этот раздел станет доступен после подключения PMS или менеджера каналов.
        </p>
      </div>

    </div>
  );
}
