const automationItems = [
  {
    title: 'Доступность считается автоматически',
    description: 'ASI ведёт календарь по броням и правилам объекта. Ручной ввод нужен только в тестовом режиме.',
  },
  {
    title: 'Брони принимаются автоматически',
    description: 'Заявки с подключённых каналов попадают в единый контур без ручного копирования.',
  },
  {
    title: 'Конфликты ловятся автоматически',
    description: 'При риске овербукинга ASI блокирует продажу и показывает предупреждение.',
  },
  {
    title: 'Каналы синхронизируются автоматически',
    description: 'Цены, ограничения и доступность уходят на площадки после подключения.',
  },
  {
    title: 'Ручное вмешательство — только при проблемах',
    description: 'Вы видите статусы и действия там, где нужно подтверждение человека.',
  },
];

export function AsiAutomationInfo() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Что ASI делает автоматически</h2>
        <p className="mt-1 text-sm text-slate-500">
          После загрузки данных объекта и подключения каналов ручная работа не нужна.
        </p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {automationItems.map((item) => (
          <div key={item.title} className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{item.title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
