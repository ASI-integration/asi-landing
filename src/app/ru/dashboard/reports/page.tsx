export default function RuDashboardReportsPage() {
  return (
    <main lang="ru" className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <p className="text-sm font-medium text-slate-600">Пилот · Только просмотр</p>
        <h1 className="text-3xl font-bold text-slate-900">Прогресс и отчёты</h1>
        <p className="max-w-2xl text-slate-700">
          Здесь можно будет оценить ход пилота: снижение зависимости от площадок
          бронирования и автоматизацию работы объекта. Сейчас подтверждённые данные
          к этому разделу не подключены.
        </p>
      </header>

      <section aria-labelledby="progress-heading" className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 id="progress-heading" className="text-xl font-semibold text-slate-900">Прогресс пилота</h2>
        <p className="mt-2 text-slate-700">
          Статус работ по вашему объекту пока не подтверждён в этом разделе.
          Отсутствие данных не означает, что работы не начались или завершены.
        </p>
        <dl className="mt-6 space-y-4">
          <div>
            <dt className="font-medium text-slate-900">Прямые бронирования и зависимость от площадок</dt>
            <dd className="mt-1 text-slate-700">Нет подтверждённых данных для оценки изменений.</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Автоматизация работы объекта</dt>
            <dd className="mt-1 text-slate-700">Нет подтверждённых данных о выполненных задачах и результатах.</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="reports-heading" className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 id="reports-heading" className="text-xl font-semibold text-slate-900">Отчёты</h2>
        <div className="mt-4 rounded-lg bg-slate-50 p-5">
          <h3 className="font-semibold text-slate-900">Нет доступных отчётов</h3>
          <p className="mt-2 text-slate-700">
            Подтверждённые отчёты к этой странице пока не подключены. Это не
            означает, что отчётов нет в других разделах или у команды пилота.
          </p>
          <p className="mt-2 text-slate-700">
            Чтобы уточнить текущий прогресс и доступность отчёта, обратитесь к
            команде пилота по согласованному каналу связи.
          </p>
        </div>
      </section>

      <p className="text-sm text-slate-600">
        На этой странице нельзя запустить работы, создать отчёт или отправить
        сообщение. Действия по объекту здесь не выполняются.
      </p>
    </main>
  );
}
