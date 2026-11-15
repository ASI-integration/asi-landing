import { Suspense } from 'react';

type ReportPageProps = { params: Promise<{ reportId: string }> };

async function ReportDetails({ params }: ReportPageProps) {
  let reportId: string;
  try {
    ({ reportId } = await params);
  } catch {
    return (
      <div role="status">
        <h2 className="text-xl font-semibold">Не удалось открыть отчёт</h2>
        <p>Данные недоступны. Попробуйте открыть страницу позже.</p>
      </div>
    );
  }

  if (typeof reportId !== 'string' || !reportId.trim()) {
    return (
      <div role="status">
        <h2 className="text-xl font-semibold">Не указан отчёт</h2>
        <p>Вернитесь к списку отчётов и проверьте ссылку.</p>
      </div>
    );
  }

  // A route identifier is not evidence of an existing or completed report.
  // No owner-scoped evidence source is connected to this pilot route yet.
  return (
    <section aria-labelledby="report-evidence-heading" className="space-y-4">
      <h2 id="report-evidence-heading" className="text-xl font-semibold">Отчёт пока недоступен</h2>
      <p role="status">Подтверждённые данные этого отчёта к странице пока не подключены.</p>
      <p>Это не подтверждает наличие отчёта, завершение работ или отсутствие результатов у команды пилота.</p>
      <dl className="space-y-4">
        <div>
          <dt className="font-medium">Ход работ и автоматизация объекта</dt>
          <dd>Нет подтверждённых данных о выполненных задачах и результатах.</dd>
        </div>
        <div>
          <dt className="font-medium">Прямые бронирования и зависимость от площадок</dt>
          <dd>Нет подтверждённых данных для оценки изменений.</dd>
        </div>
        <div>
          <dt className="font-medium">Оплата и начисления</dt>
          <dd>Платёжные данные не подключены. Статус оплаты и суммы не подтверждены.</dd>
        </div>
      </dl>
      <p>Уточните доступность отчёта у команды пилота по согласованному каналу связи.</p>
    </section>
  );
}

export default function RuDashboardReportPage({ params }: ReportPageProps) {
  return (
    <main lang="ru" className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <p className="text-sm text-slate-600">Пилот · Только просмотр</p>
        <h1 className="text-3xl font-bold">Отчёт по объекту</h1>
      </header>
      <Suspense fallback={<p role="status" aria-live="polite" aria-busy="true">Загрузка отчёта…</p>}>
        <ReportDetails params={params} />
      </Suspense>
      <p className="text-sm text-slate-600">На этой странице нельзя запустить работы, создать отчёт, оплатить услуги или отправить сообщение.</p>
      <a href="/ru/dashboard/reports" className="inline-block underline">К списку отчётов</a>
    </main>
  );
}
