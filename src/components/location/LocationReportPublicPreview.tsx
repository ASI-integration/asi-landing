import Link from 'next/link';
import type { LocationStandaloneReport } from '@/lib/location';
import { buildDashboardReportRequestHref } from '@/lib/location/pending-location-report';
import {
  FREE_REPORT_LIMITATIONS_RU,
  normalizeFreeReportFactors,
} from '@/lib/location/free-report-content';
import { YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';
import { publicScoreRange } from '@/lib/location/location-score-public';

export const LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL = 'Получить полный отчёт';

const EXAMPLE_REPORT_SLIDES_RU = [
  {
    id: 'summary',
    title: 'Общий вывод по объекту',
    answer: 'Показывает, стоит ли рассматривать объект',
    signal: 'итог',
    footer: 'решение по объекту',
    accent: 'from-emerald-400/40 to-cyan-400/10',
    visual: 'score',
  },
  {
    id: 'demand',
    title: 'Спрос и целевая аудитория',
    answer: 'Показывает, кто может здесь бронировать',
    signal: 'спрос',
    footer: 'портрет гостей',
    accent: 'from-sky-400/40 to-indigo-400/10',
    visual: 'audience',
  },
  {
    id: 'competition',
    title: 'Конкуренция рядом',
    answer: 'Показывает, насколько рядом плотная конкуренция',
    signal: 'рынок',
    footer: 'позиционирование',
    accent: 'from-rose-400/40 to-orange-400/10',
    visual: 'bars',
  },
  {
    id: 'transport',
    title: 'Транспорт и магниты спроса',
    answer: 'Показывает, что приводит гостей к адресу',
    signal: 'доступность',
    footer: 'точки притяжения',
    accent: 'from-violet-400/40 to-fuchsia-400/10',
    visual: 'map',
  },
  {
    id: 'yield',
    title: 'Доходность и сценарии',
    answer: 'Показывает, как меняется экономика в разных сценариях',
    signal: 'сценарии',
    footer: 'экономика',
    accent: 'from-amber-300/40 to-lime-400/10',
    visual: 'scenarios',
  },
  {
    id: 'risks',
    title: 'Риски и рекомендации',
    answer: 'Показывает, что проверить до решения',
    signal: 'проверки',
    footer: 'план действий',
    accent: 'from-red-400/40 to-slate-400/10',
    visual: 'risks',
  },
  {
    id: 'future',
    title: 'Будущее района',
    answer: 'Показывает, как район может измениться',
    signal: 'развитие',
    footer: 'горизонт до 10 лет',
    accent: 'from-teal-300/40 to-blue-400/10',
    visual: 'timeline',
  },
] as const;

type ExampleReportSlide = (typeof EXAMPLE_REPORT_SLIDES_RU)[number];

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

function SlideVisual({ slide }: { slide: ExampleReportSlide }) {
  if (slide.visual === 'score') {
    return (
      <div className="grid grid-cols-[92px_1fr] items-center gap-3" aria-hidden>
        <div className="grid aspect-square place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10">
          <div className="grid h-16 w-16 place-items-center rounded-full border-[10px] border-emerald-300/80 border-r-white/10 text-center text-xs font-black leading-tight text-white">
            75–85%
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-3 rounded-full bg-white/20" />
          <div className="h-3 w-10/12 rounded-full bg-emerald-300/40" />
          <div className="h-3 w-7/12 rounded-full bg-white/10" />
        </div>
      </div>
    );
  }

  if (slide.visual === 'audience') {
    return (
      <div className="grid grid-cols-3 gap-2" aria-hidden>
        <div className="h-20 rounded-xl bg-sky-300/25 p-2">
          <div className="h-7 w-7 rounded-full bg-white/40" />
          <div className="mt-5 h-2 rounded-full bg-white/30" />
        </div>
        <div className="h-20 rounded-xl bg-indigo-300/25 p-2">
          <div className="h-7 w-7 rounded-full bg-white/30" />
          <div className="mt-5 h-2 rounded-full bg-white/25" />
        </div>
        <div className="h-20 rounded-xl bg-cyan-300/20 p-2">
          <div className="h-7 w-7 rounded-full bg-white/25" />
          <div className="mt-5 h-2 rounded-full bg-white/20" />
        </div>
      </div>
    );
  }

  if (slide.visual === 'bars') {
    return (
      <div className="flex h-24 items-end gap-2" aria-hidden>
        <div className="h-12 flex-1 rounded-t-xl bg-rose-300/40" />
        <div className="h-20 flex-1 rounded-t-xl bg-orange-300/60" />
        <div className="h-16 flex-1 rounded-t-xl bg-white/20" />
        <div className="h-9 flex-1 rounded-t-xl bg-rose-300/25" />
        <div className="h-14 flex-1 rounded-t-xl bg-white/10" />
      </div>
    );
  }

  if (slide.visual === 'map') {
    return (
      <div className="relative h-24 overflow-hidden rounded-xl bg-violet-300/10" aria-hidden>
        <div className="absolute left-3 top-3 h-16 w-16 rounded-full border border-violet-200/30" />
        <div className="absolute right-4 top-4 h-12 w-20 rounded-full border border-fuchsia-200/25" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
        <div className="absolute left-[42%] top-[38%] h-5 w-5 rounded-full border-4 border-white bg-violet-300" />
        <div className="absolute bottom-3 right-5 h-3 w-3 rounded-full bg-fuchsia-300" />
      </div>
    );
  }

  if (slide.visual === 'scenarios') {
    return (
      <div className="grid grid-cols-3 gap-2" aria-hidden>
        <div className="rounded-xl bg-white/10 p-2">
          <div className="h-12 rounded-lg bg-amber-200/20" />
          <div className="mt-2 h-2 rounded-full bg-white/20" />
        </div>
        <div className="rounded-xl bg-amber-300/20 p-2">
          <div className="h-16 rounded-lg bg-amber-200/40" />
          <div className="mt-2 h-2 rounded-full bg-white/30" />
        </div>
        <div className="rounded-xl bg-lime-300/20 p-2">
          <div className="h-20 rounded-lg bg-lime-200/40" />
          <div className="mt-2 h-2 rounded-full bg-white/30" />
        </div>
      </div>
    );
  }

  if (slide.visual === 'risks') {
    return (
      <div className="space-y-2" aria-hidden>
        <div className="flex items-center gap-2 rounded-xl bg-red-300/20 p-3">
          <div className="h-3 w-3 rounded-full bg-red-300" />
          <div className="h-2 flex-1 rounded-full bg-white/20" />
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/10 p-3">
          <div className="h-3 w-3 rounded-full bg-amber-200" />
          <div className="h-2 flex-1 rounded-full bg-white/20" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-24 rounded-xl bg-teal-300/10 p-4" aria-hidden>
      <div className="absolute left-5 right-5 top-1/2 h-px bg-white/20" />
      <div className="relative flex h-full items-center justify-between">
        <div className="h-4 w-4 rounded-full bg-teal-200" />
        <div className="h-5 w-5 rounded-full bg-white/40" />
        <div className="h-6 w-6 rounded-full bg-blue-300" />
      </div>
    </div>
  );
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
  const scoreRange =
    publicScoreRange(report.freeSummary?.publicScore ?? null) ??
    publicScoreRange(78);
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
        <section className="overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-900/40">
          <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-stretch">
            <div>
              <p className="text-sm font-semibold text-cyan-200">Анализ локации ASI</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Отчёт по локации
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-300">
                Краткий вывод по адресу уже сформирован: ниже показаны ключевой вывод, сильная сторона,
                главный риск и формат страниц будущего полного отчёта.
              </p>
            </div>

            <div className="relative min-h-[220px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-300/20 via-indigo-300/10 to-emerald-300/10 p-5">
              <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-cyan-200/20" />
              <div className="absolute bottom-4 right-5 h-20 w-28 rounded-2xl bg-white/10" />
              <div className="relative">
                <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/70">Краткий вывод по адресу</p>
                <p className="mt-4 text-3xl font-black tabular-nums text-white">{scoreRange?.labelRu ?? 'Потенциал: 75–85%'}</p>
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-full rounded-full bg-white/10" />
                  <div className="h-3 w-10/12 rounded-full bg-cyan-200/40" />
                  <div className="h-3 w-7/12 rounded-full bg-emerald-200/40" />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-7 pb-7 sm:grid-cols-[1.4fr_0.8fr] sm:px-10 sm:pb-10">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{report.address}</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Дата и время расчёта</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{calculatedAt ?? 'Уточняется'}</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-6 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Общий вывод по локации</p>
              <p className="mt-3 text-lg font-semibold leading-snug text-white sm:text-xl">{verdict}</p>
            </div>

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
            Ниже показаны примеры страниц полного отчёта.
            В полной версии больше разделов: экономика, конкуренция, транспорт, якоря спроса, развитие района и горизонт до 10 лет.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLE_REPORT_SLIDES_RU.map(slide => (
              <div
                key={slide.id}
                className="group min-h-[320px] overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4 shadow-2xl shadow-slate-950/20 transition-colors hover:border-slate-700"
              >
                <div className={`flex h-full flex-col rounded-xl border border-white/10 bg-gradient-to-br ${slide.accent} p-4`}>
                  <div className={`h-1.5 rounded-full bg-gradient-to-r ${slide.accent}`} />
                  <div className="mt-5 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{slide.signal}</p>
                      <h3 className="mt-2 text-lg font-bold leading-tight text-white">{slide.title}</h3>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-100">{slide.answer}</p>
                  <div className="mt-auto pt-6">
                    <SlideVisual slide={slide} />
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
            ASI смотрит не только на то, что есть рядом сейчас, но и на горизонт развития до 10 лет: стройки, дороги, транспорт, госзакупки, деловая активность и ранние признаки роста территории.
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
