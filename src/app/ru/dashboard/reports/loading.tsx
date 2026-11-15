export default function RuDashboardReportsLoading() {
  return (
    <main lang="ru" className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold text-slate-900">Прогресс и отчёты</h1>
      <p role="status" aria-live="polite" className="text-slate-700">
        Загружаем страницу отчётов…
      </p>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-40 rounded-xl bg-slate-100" />
        <div className="h-40 rounded-xl bg-slate-100" />
      </div>
    </main>
  );
}
