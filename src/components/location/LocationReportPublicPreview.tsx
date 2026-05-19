import Link from 'next/link';
import type { LocationStandaloneReport } from '@/lib/location';
import { buildDashboardReportRequestHref } from '@/lib/location/pending-location-report';
import {
  FREE_REPORT_LIMITATIONS_RU,
  normalizeFreeReportFactors,
} from '@/lib/location/free-report-content';
import { YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

export const LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL = 'Получить полный отчёт';

const EXAMPLE_REPORT_SLIDES_RU = [
  {
    id: 'summary',
    title: 'Общий вывод по объекту',
    covers: 'Стоит ли рассматривать объект дальше и какой формат запуска выглядит сильнее.',
    signal: 'итог',
    footer: 'решение по объекту',
    accent: 'from-emerald-400/35 to-cyan-400/10',
  },
  {
    id: 'demand',
    title: 'Спрос и целевая аудитория',
    covers: 'Кто будет выбирать локацию: туристы, командировки, локальный спрос или смешанный поток.',
    signal: 'спрос',
    footer: 'портрет гостей',
    accent: 'from-sky-400/35 to-indigo-400/10',
  },
  {
    id: 'competition',
    title: 'Конкуренция рядом',
    covers: 'Какие объекты уже борются за гостя и где можно выделиться без ценовой гонки.',
    signal: 'рынок',
    footer: 'позиционирование',
    accent: 'from-rose-400/35 to-orange-400/10',
  },
  {
    id: 'transport',
    title: 'Транспорт и магниты спроса',
    covers: 'Что реально приводит гостей: станции, деловые точки, медицина, учебные и туристические места.',
    signal: 'доступность',
    footer: 'точки притяжения',
    accent: 'from-violet-400/35 to-fuchsia-400/10',
  },
  {
    id: 'yield',
    title: 'Доходность и сценарии',
    covers: 'Как меняется потенциал при осторожном, базовом и сильном сценарии запуска.',
    signal: 'сценарии',
    footer: 'экономика',
    accent: 'from-amber-300/40 to-lime-400/10',
  },
  {
    id: 'risks',
    title: 'Риски и рекомендации',
    covers: 'Что проверить до решения и какие шаги снизят риск ошибки при запуске.',
    signal: 'проверки',
    footer: 'план действий',
    accent: 'from-red-400/35 to-slate-400/10',
  },
  {
    id: 'future',
    title: 'Будущее района',
    covers: 'Какие изменения территории могут усилить или ослабить объект в ближайшие годы.',
    signal: 'развитие',
    footer: 'горизонт 2-3 года',
    accent: 'from-teal-300/35 to-blue-400/10',
  },
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Отчёт по локации</p>
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
            Отчёт по локации
          </h1>

          <div className="mt-7 grid gap-4 sm:grid-cols-[1.4fr_0.8fr]">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{report.address}</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Дата и время расчёта</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{calculatedAt ?? 'Уточняется'}</p>
            </div>
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
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полная версия</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Разделы с подробным разбором</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Примеры страниц показывают, какие решения закрывает полный отчёт.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLE_REPORT_SLIDES_RU.map(slide => (
              <div
                key={slide.id}
                className="group min-h-[260px] overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/35 p-4 shadow-2xl shadow-slate-950/20 transition-colors hover:border-slate-700"
              >
                <div className="flex h-full flex-col rounded-xl border border-white/10 bg-slate-950/55 p-4">
                  <div className={`h-1.5 rounded-full bg-gradient-to-r ${slide.accent}`} />
                  <div className="mt-5 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{slide.signal}</p>
                      <h3 className="mt-2 text-lg font-bold leading-tight text-white">{slide.title}</h3>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-300">{slide.covers}</p>
                  <div className="mt-auto pt-6">
                    <div className="grid grid-cols-3 gap-2" aria-hidden>
                      <div className="h-12 rounded-lg bg-white/10" />
                      <div className="h-12 rounded-lg bg-white/5" />
                      <div className="h-12 rounded-lg bg-white/10" />
                    </div>
                    <p className="mt-4 text-xs font-semibold text-slate-400">{slide.footer}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-7 sm:p-8">
          <h2 className="text-2xl font-bold text-white">Нужен полный разбор?</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
            Полная версия открывает подробные страницы по спросу, конкуренции, доходности, развитию района и рискам.
          </p>
          <div className="mt-5 rounded-xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">
            {YOOKASSA_PENDING_REVIEW_MESSAGE}
          </div>
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
