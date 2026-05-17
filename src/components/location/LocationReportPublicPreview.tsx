import Link from 'next/link';
import type { LocationStandaloneReport } from '@/lib/location';
import { buildDashboardReportRequestHref } from '@/lib/location/pending-location-report';
import {
  FREE_REPORT_LIMITATIONS_RU,
  normalizeFreeReportFactors,
} from '@/lib/location/free-report-content';

export const LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL = 'Получить полный отчёт';

const LOCKED_SECTION_TITLES_RU = [
  'Итог и стратегия запуска',
  'Аудитория и спрос',
  'Главные магниты',
  'Конкуренция',
  'Сценарии дохода',
  'Развитие района',
  'Риски и проверки',
] as const;

function pickSummary(report: LocationStandaloneReport) {
  const section = report.sections.find(s => s.id === 'summary');
  return section?.id === 'summary' ? section : null;
}

function pickKeyStrength(report: LocationStandaloneReport): string | null {
  const summary = pickSummary(report);
  const raw = summary?.drivers?.[0] ?? report.freeSummary?.keyFactorsRu?.[0];
  if (!raw?.trim()) return null;
  const normalized = normalizeFreeReportFactors([raw]);
  return normalized[0] ?? raw.trim();
}

function pickKeyRisk(report: LocationStandaloneReport): string {
  const fromSummary = report.freeSummary?.risksAndLimitsRu?.find(line => line.trim().length > 0);
  if (fromSummary) return fromSummary.trim();
  return FREE_REPORT_LIMITATIONS_RU[0];
}

function lockedSections(report: LocationStandaloneReport): readonly { id: string; titleRu: string }[] {
  const fromStructure = report.reportStructure?.paidPreviewSections;
  if (fromStructure?.length) {
    return fromStructure.map(section => ({ id: section.id, titleRu: section.titleRu }));
  }
  return LOCKED_SECTION_TITLES_RU.map((titleRu, index) => ({
    id: `locked-${index}`,
    titleRu,
  }));
}

function formatDateRu(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LocationReportPublicPreview({
  report,
  reportId,
}: {
  report: LocationStandaloneReport;
  reportId?: string;
}) {
  const persistedReportId = reportId ?? report.reportId;
  const summary = pickSummary(report);
  const verdict = summary?.verdict ?? report.freeSummary?.conclusionRu ?? '—';
  const keyStrength = pickKeyStrength(report);
  const keyRisk = pickKeyRisk(report);
  const calculatedAt = formatDateRu(report.metadata?.calculatedAt ?? report.generated_at_iso);
  const detailedReportHref = buildDashboardReportRequestHref({
    address: report.address,
    ...(persistedReportId ? { freeReportId: persistedReportId } : {}),
    ...(persistedReportId
      ? { freeReportPermalink: `/ru/location-report/${encodeURIComponent(persistedReportId)}` }
      : {}),
    mode: 'residential',
    createdAt: report.metadata?.calculatedAt ?? report.generated_at_iso,
  });
  const locked = lockedSections(report);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800/70 bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Обзор локации</p>
            <p className="mt-1 truncate text-sm text-slate-200" title={report.address}>
              {report.address}
            </p>
          </div>
          <Link
            href="/ru"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-800/70 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
          >
            На главную
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <section className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-900/40 to-slate-950/20 p-7 sm:p-10">
          <p className="text-sm font-semibold text-slate-300">Анализ локации ASI</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Предпросмотр отчёта по локации
          </h1>

          <div className="mt-7 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-200">{report.address}</p>
            {calculatedAt ? <p className="mt-3 text-xs text-slate-500">Расчёт: {calculatedAt}</p> : null}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-6">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Общий вывод по локации</p>
            <p className="mt-3 text-lg font-semibold leading-snug text-white sm:text-xl">{verdict}</p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-300/80">Сильная сторона</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-200">
                {keyStrength ?? 'По открытым данным сильный фактор пока не выделен — полный отчёт покажет детали.'}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300/80">Главный риск</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-200">{keyRisk}</p>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">В полном отчёте</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Разделы с подробным разбором</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Ниже — только названия блоков. Содержимое откроется после получения полного отчёта.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {locked.map(section => (
              <div
                key={section.id}
                className="relative overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/25 p-5"
              >
                <div className="pointer-events-none select-none blur-[6px] opacity-40" aria-hidden>
                  <p className="text-sm font-semibold text-white">{section.titleRu}</p>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">
                    Подробный разбор по этому блоку доступен в полном отчёте.
                  </p>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 px-4">
                  <span className="rounded-full border border-slate-700/80 bg-slate-900/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">
                    Доступно в полном отчёте
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-7 sm:p-8">
          <h2 className="text-2xl font-bold text-white">Нужен полный разбор?</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
            В полном отчёте — конкуренция, сценарии дохода, развитие района, риски и рекомендации по запуску.
          </p>
          <Link
            href={detailedReportHref}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-7 py-4 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100 sm:w-auto"
          >
            {LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL}
          </Link>
        </section>
      </main>
    </div>
  );
}
