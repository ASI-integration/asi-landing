import Link from 'next/link';
import type { GeneratedFreeLocationReportData } from '@/lib/location/location-report-engine';
import { buildDashboardReportRequestHref } from '@/lib/location/pending-location-report';

function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LocationFreeReportView({ report }: { report: GeneratedFreeLocationReportData }) {
  const detailedReportHref = buildDashboardReportRequestHref({
    address: report.inputAddress,
    freeReportId: report.reportId,
    freeReportPermalink: `/ru/location-report/${encodeURIComponent(report.reportId)}`,
    mode: 'residential',
    createdAt: report.calculatedAt,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800/70 bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Бесплатный отчёт по локации</p>
            <p className="mt-1 truncate text-sm text-slate-200" title={report.inputAddress}>{report.inputAddress}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/ru/location-report/${encodeURIComponent(report.reportId)}/print`}
              className="inline-flex items-center justify-center rounded-lg border border-slate-800/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-700 hover:text-white"
            >
              Печать / PDF
            </Link>
            <Link
              href="/ru"
              className="inline-flex items-center justify-center rounded-lg border border-slate-800/70 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
            >
              На главную
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <section className="rounded-3xl border border-slate-800/70 bg-slate-900/25 p-7 sm:p-10">
          <p className="text-sm font-semibold text-slate-300">Анализ локации ASI</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Краткий обзор локации</h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-200">{report.verdictSummary}</p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{report.inputAddress}</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Оценка</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                {report.score ?? '—'}
                {report.score == null ? null : <span className="text-base font-medium text-slate-500"> / 100</span>}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5 text-sm leading-relaxed text-slate-300">
            <p>Расчёт: {formatDateRu(report.calculatedAt)}</p>
            <p className="mt-1 text-xs text-slate-500">Номер отчёта: {report.reportId}</p>
            {report.dataFreshness?.summaryRu ? (
              <p className="mt-3 text-slate-400">{report.dataFreshness.summaryRu}</p>
            ) : null}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-800/70 bg-slate-900/20 p-6 lg:col-span-2">
            <h2 className="text-2xl font-bold text-white">Ключевые факторы</h2>
            {report.evidenceBullets.length ? (
              <ul className="mt-4 space-y-3">
                {report.evidenceBullets.map(item => (
                  <li key={item} className="flex gap-3 text-slate-200">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-slate-400">По этому адресу пока нет коротких факторов для показа.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800/70 bg-slate-900/20 p-6">
            <h2 className="text-2xl font-bold text-white">Что дальше</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{report.recommendationRu}</p>
            <Link
              href={detailedReportHref}
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100"
            >
              Получить подробный отчёт
            </Link>
          </section>
        </div>

        {report.risksAndLimitsRu.length ? (
          <section className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-900/20 p-6">
            <h2 className="text-2xl font-bold text-white">Риски и ограничения</h2>
            <ul className="mt-4 space-y-3">
              {report.risksAndLimitsRu.map(item => (
                <li key={item} className="flex gap-3 text-slate-200">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
