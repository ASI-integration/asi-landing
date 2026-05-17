'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LocationStandaloneReport, LocationStandaloneReportSectionId } from '@/lib/location';
import { URBAN_DEVELOPMENT_LIVE_SOURCES_DISCLAIMER_RU } from '@/lib/location/report-contract';
import { LOCATION_REPORT_PRODUCT_PATH } from '@/lib/location/report-state';
import { buildDashboardReportRequestHref } from '@/lib/location/pending-location-report';
import { LocationReportPublicPreview } from '@/components/location/LocationReportPublicPreview';
import { PremiumPaidReportSections } from '@/components/location/PremiumPaidReportSections';
import {
  buildPremiumPaidReportContent,
  PREMIUM_PAID_SECTION_ANCHORS,
  PREMIUM_PAID_SECTION_TITLES_RU,
} from '@/lib/location/premium-paid-report-content';

function urbanForecastLevelRu(level: 'low' | 'moderate' | 'high' | 'very_high'): string {
  if (level === 'low') return 'низкий';
  if (level === 'moderate') return 'умеренный';
  if (level === 'high') return 'высокий';
  return 'очень высокий';
}

function urbanForecastConfidenceRu(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'высокая';
  if (level === 'medium') return 'средняя';
  return 'низкая';
}

function fmtRub(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₽${Math.round(n).toLocaleString('ru-RU')}`;
}

function fmtRubRange(range: { low: number; high: number } | null): string {
  if (!range) return 'недостаточно данных';
  return `${Math.round(range.low).toLocaleString('ru-RU')}–${Math.round(range.high).toLocaleString('ru-RU')} ₽/мес`;
}

function fmtMeters(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  return `${(m / 1000).toFixed(1)} км`;
}

type AnchorType = 'POSITIVE_DEMAND_ANCHOR' | 'MIXED_CONTEXT_ANCHOR' | 'RESTRICTIVE_OR_FRICTION_ANCHOR';

function AnchorTypeBadge({ anchorType }: { anchorType: AnchorType | undefined }) {
  if (!anchorType || anchorType === 'POSITIVE_DEMAND_ANCHOR') return null;
  if (anchorType === 'MIXED_CONTEXT_ANCHOR') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-900/40 text-amber-300 border border-amber-700/40">
        Смешанный контекст
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-900/40 text-rose-300 border border-rose-700/40">
      Фрикционный объект
    </span>
  );
}

function strategyTitleRu(s: NonNullable<LocationStandaloneReport['sections'][number] & { id: 'summary' }>['recommended_strategy']): string {
  if (s === 'short_term') return 'Посуточная аренда (деловой фокус)';
  if (s === 'hybrid') return 'Гибрид (посуточно + среднесрок)';
  return 'Среднесрочная аренда';
}

function pressureLabelRu(p: 'low' | 'medium' | 'high'): { label: string; className: string } {
  if (p === 'low') return { label: 'низкое', className: 'text-emerald-300' };
  if (p === 'medium') return { label: 'среднее', className: 'text-amber-300' };
  return { label: 'высокое', className: 'text-rose-300' };
}

function confidenceLabelRu(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'высокая';
  if (level === 'medium') return 'средняя';
  return 'низкая';
}

function weakZoneLabelRu(level: 'low' | 'medium' | 'high' | 'unknown'): { label: string; className: string } {
  if (level === 'high') return { label: 'высокий', className: 'text-rose-300' };
  if (level === 'medium') return { label: 'средний', className: 'text-amber-300' };
  if (level === 'low') return { label: 'низкий', className: 'text-emerald-300' };
  return { label: 'недостаточно данных', className: 'text-slate-400' };
}

function fitLabelRu(v: 'fit' | 'not_fit' | 'unknown'): { title: string; className: string } {
  if (v === 'fit') return { title: 'Подходит', className: 'text-emerald-300' };
  if (v === 'not_fit') return { title: 'Скорее не подходит', className: 'text-slate-200' };
  return { title: 'Недостаточно данных', className: 'text-slate-400' };
}

function pickSection<T extends LocationStandaloneReportSectionId>(
  report: LocationStandaloneReport,
  id: T,
): Extract<LocationStandaloneReport['sections'][number], { id: T }> | null {
  const s = report.sections.find(x => x.id === id);
  return (s ?? null) as any;
}

function SectionShell({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="report-section scroll-mt-24">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/20 overflow-hidden">
        <div className="px-6 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-slate-800/60">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Раздел</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
          {lead ? <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">{lead}</p> : null}
        </div>
        <div className="px-6 sm:px-8 py-6 sm:py-7">{children}</div>
      </div>
    </section>
  );
}

function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Навигация по отчёту</p>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map(i => (
          <a
            key={i.id}
            href={`#${i.id}`}
            className="text-sm text-slate-300 hover:text-white transition-colors rounded-lg px-3 py-2 bg-slate-900/30 border border-slate-800/60 hover:border-slate-700/70"
          >
            {i.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export function LocationStandaloneFullReport({
  report,
  reportId,
}: {
  report: LocationStandaloneReport;
  reportId?: string;
}) {
  if (report.reportMode === 'free') {
    return <LocationReportPublicPreview report={report} reportId={reportId} />;
  }

  const isFreePreview = false;
  const persistedReportId = reportId ?? report.reportId;
  const reportStructure = report.reportStructure;
  const primaryCtaLabel =
    reportStructure?.cta.primaryLabel ??
    (isFreePreview ? 'Получить полный отчёт' : 'Подключить управление');
  const secondaryCtaLabel = reportStructure?.cta.secondaryLabel ?? 'Обсудить объект';
  const summary = pickSection(report, 'summary');
  const businessFit = pickSection(report, 'business_fit');
  const magnets = pickSection(report, 'magnets');
  const competition = pickSection(report, 'competition');
  const incomeStrategy = pickSection(report, 'income_strategy');
  const freeBrief = report.free_brief ?? (isFreePreview ? summary?.verdict ?? null : null);
  const strReport = !isFreePreview ? report.strReport : undefined;
  const premiumPaidReport = useMemo(() => {
    if (isFreePreview || !strReport) return null;
    return (
      report.premiumPaidReport ??
      buildPremiumPaidReportContent({ report, strReport })
    );
  }, [isFreePreview, report, strReport]);
  const urbanForecast = !isFreePreview ? report.unifiedReport?.urbanDevelopmentForecastScore : undefined;
  const detailedReportHref =
    isFreePreview
      ? buildDashboardReportRequestHref({
        address: report.address,
        ...(persistedReportId ? { freeReportId: persistedReportId } : {}),
        ...(persistedReportId ? { freeReportPermalink: `/ru/location-report/${encodeURIComponent(persistedReportId)}` } : {}),
        mode: 'residential',
        createdAt: report.metadata?.calculatedAt ?? report.generated_at_iso,
      })
      : LOCATION_REPORT_PRODUCT_PATH;
  const pdfDownloadHref = persistedReportId
    ? `/api/location-report/${encodeURIComponent(persistedReportId)}/pdf`
    : null;
  const pdfDownloadFilename = persistedReportId
    ? `location-report-${persistedReportId}.pdf`
    : undefined;
  const urbanForecastNoLiveData =
    urbanForecast != null && urbanForecast.score === 0 && urbanForecast.contributingSignals.length === 0;

  const demandSignalLines = useMemo(() => {
    if (isFreePreview || !report.unifiedReport?.sections) return [];
    const demandSec = report.unifiedReport.sections.find(s => s.id === 'demand');
    return (demandSec?.items ?? []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  }, [isFreePreview, report.unifiedReport]);

  const tocItems = useMemo(() => {
    if (isFreePreview) {
      return [
        { id: 'summary', label: 'Краткий итог' },
        { id: 'next-step', label: 'Полный отчёт' },
      ];
    }
    const premiumToc = premiumPaidReport
      ? [
          { id: PREMIUM_PAID_SECTION_ANCHORS.executiveSummary, label: PREMIUM_PAID_SECTION_TITLES_RU.executiveSummary },
          { id: PREMIUM_PAID_SECTION_ANCHORS.audienceFit, label: PREMIUM_PAID_SECTION_TITLES_RU.audienceFit },
          { id: PREMIUM_PAID_SECTION_ANCHORS.primeMagnets, label: PREMIUM_PAID_SECTION_TITLES_RU.primeMagnets },
          { id: PREMIUM_PAID_SECTION_ANCHORS.competition, label: PREMIUM_PAID_SECTION_TITLES_RU.competition },
          { id: PREMIUM_PAID_SECTION_ANCHORS.revenueScenarios, label: PREMIUM_PAID_SECTION_TITLES_RU.revenueScenarios },
          { id: PREMIUM_PAID_SECTION_ANCHORS.futureDevelopment, label: PREMIUM_PAID_SECTION_TITLES_RU.futureDevelopment },
          { id: PREMIUM_PAID_SECTION_ANCHORS.risks, label: PREMIUM_PAID_SECTION_TITLES_RU.risks },
          { id: PREMIUM_PAID_SECTION_ANCHORS.launchStrategy, label: PREMIUM_PAID_SECTION_TITLES_RU.launchStrategy },
          { id: PREMIUM_PAID_SECTION_ANCHORS.finalRecommendation, label: PREMIUM_PAID_SECTION_TITLES_RU.finalRecommendation },
        ]
      : [];

    const base = [
      { id: 'summary', label: 'Итог' },
      ...premiumToc,
      { id: 'data-freshness', label: 'Свежесть данных' },
    ];
    const demandToc =
      demandSignalLines.length > 0 ? [{ id: 'demand-signals-detail', label: 'Факторы спроса' } as const] : [];
    const legacyDetailToc = premiumPaidReport
      ? []
      : [
          { id: 'magnets', label: 'Магниты' },
          { id: 'competition', label: 'Конкуренция' },
          { id: 'income-strategy', label: 'Доход / стратегия' },
          { id: 'manual-risks', label: 'Проверки' },
          { id: 'urban-forecast', label: 'Прогноз развития района' },
        ];

    return [
      ...base,
      ...demandToc,
      ...legacyDetailToc,
      { id: 'next-step', label: 'Следующий шаг' },
    ];
  }, [isFreePreview, demandSignalLines.length, premiumPaidReport]);

  const meta = report.metadata;

  const generatedAt = useMemo(() => {
    const d = new Date(report.generated_at_iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, [report.generated_at_iso]);

  const calculatedAtDisplay = useMemo(() => {
    const iso = meta?.calculatedAt ?? report.generated_at_iso;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, [meta?.calculatedAt, report.generated_at_iso]);

  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canShare = typeof window !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard;
  const shareLink = async () => {
    try {
      if (!canShare) throw new Error('clipboard not available');
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('copied');
      window.setTimeout(() => setShareStatus('idle'), 2200);
    } catch {
      setShareStatus('failed');
      window.setTimeout(() => setShareStatus('idle'), 2200);
    }
  };

  return (
    <div className="location-report-print min-h-screen bg-slate-950 text-white">
      <header className="print-hide sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              {isFreePreview ? 'Обзор локации' : 'Отчёт по локации'}
            </p>
            <p className="mt-1 text-sm text-slate-200 truncate" title={report.address}>{report.address}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isFreePreview && pdfDownloadHref ? (
              <a
                href={pdfDownloadHref}
                download={pdfDownloadFilename}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors text-sm"
              >
                Скачать PDF
              </a>
            ) : null}
            <a
              href="#next-step"
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
            >
              {primaryCtaLabel}
            </a>
            <Link
              href="/ru"
              className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-800/70 text-slate-300 hover:text-white hover:border-slate-700 transition-colors text-sm"
            >
              На главную
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        {/* Hero */}
        <div className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-indigo-950/25 via-slate-900/40 to-slate-950/20 p-7 sm:p-10">
          <div className="flex flex-col gap-5">
            <div>
              {!isFreePreview ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex rounded-full border border-indigo-500/35 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-200">
                    Полный отчёт
                  </span>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    ASI · Анализ локации · {generatedAt ? `сформировано ${generatedAt}` : 'сформировано'}
                  </p>
                </div>
              ) : (
                <p className="text-[15px] sm:text-[17px] font-semibold text-slate-300 tracking-tight">
                  Анализ локации ASI
                  {generatedAt ? ` · ${generatedAt}` : ''}
                </p>
              )}
              <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-white">
                {isFreePreview ? 'Краткий обзор локации' : 'Отчёт по локации'}
              </h1>
              {!isFreePreview && summary?.verdict ? (
                <div className="mt-5 rounded-2xl border border-indigo-500/30 bg-indigo-950/30 p-5 sm:p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-200/90">Главный вывод</p>
                  <p className="mt-2 text-lg font-semibold leading-snug text-white sm:text-xl">{summary.verdict}</p>
                </div>
              ) : (
                <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">
                  {isFreePreview
                    ? freeBrief
                    : 'Документ, чтобы выбрать сценарий монетизации, понять вероятный спрос и заранее увидеть риски, которые стоит проверить вручную.'}
                </p>
              )}
            </div>

            <div className={`grid gap-3 ${isFreePreview ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}`}>
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
                <p className="mt-2 text-sm text-slate-200 leading-snug">{report.address}</p>
              </div>
              {!isFreePreview ? (
                <>
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Ориентир по доходу (оценка)</p>
                    <p className="mt-2 text-xl font-bold text-white tabular-nums">
                      {summary?.income_rub_month != null ? `${fmtRub(summary.income_rub_month)} / мес` : '—'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Оценка по открытым данным, не гарантированная «рыночная правда»</p>
                    <p className="mt-1 text-xs text-slate-600">До расходов и комиссий управления</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Рекомендуемая стратегия</p>
                    <p className="mt-2 text-sm font-semibold text-slate-100">
                      {summary?.recommended_strategy ? strategyTitleRu(summary.recommended_strategy) : '—'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Вывод из окружения + конкуренции</p>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-indigo-500/25 bg-indigo-950/15 p-5">
                  <p className="text-[16px] sm:text-[17px] font-semibold text-slate-100 leading-snug">
                    Подробный отчёт доступен в личном кабинете.
                  </p>
                  <div className="print-hide mt-4">
                    <Link
                      href={detailedReportHref}
                      className="inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
                    >
                      {primaryCtaLabel}
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {isFreePreview && meta ? (
              <div className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-950/45 p-5 sm:p-6 space-y-2 text-[15px] sm:text-[16px] text-slate-200 leading-relaxed">
                <p>
                  <span className="font-semibold text-white">{meta.inputAddress}</span>
                </p>
                <p className="tabular-nums text-slate-300">
                  Расчёт: {calculatedAtDisplay ?? '—'}
                </p>
                {persistedReportId ? (
                  <p className="text-xs text-slate-600 leading-snug">Номер отчёта: {persistedReportId}</p>
                ) : null}
              </div>
            ) : null}

            <Toc items={tocItems} />
          </div>
        </div>

        <div className="mt-10 sm:mt-12 space-y-6">
          {/* 1) Summary */}
          <SectionShell
            id="summary"
            title={isFreePreview ? 'Краткий итог' : 'Итог'}
            lead={
              isFreePreview
                ? 'Это быстрая предварительная оценка по открытым данным.'
                : premiumPaidReport
                  ? 'Три главных фактора спроса — подробный разбор по разделам ниже.'
                  : 'Первое, что важно: вердикт и три главных фактора, которые дают основной вклад в спрос и стратегию.'
            }
          >
            <div className={premiumPaidReport && !isFreePreview ? 'space-y-4' : 'grid lg:grid-cols-3 gap-5'}>
              <div className={premiumPaidReport && !isFreePreview ? undefined : 'lg:col-span-2'}>
                {!isFreePreview && !premiumPaidReport ? (
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Вердикт</p>
                    <p className="mt-2 text-lg sm:text-xl font-semibold text-white leading-snug">
                      {summary?.verdict ?? '—'}
                    </p>
                  </div>
                ) : null}

                <div
                  className={`${!isFreePreview && !premiumPaidReport ? 'mt-4 ' : ''}rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6`}
                >
                  {!isFreePreview ? (
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Главные факторы спроса</p>
                  ) : (
                    <p className="text-[17px] sm:text-[18px] font-semibold text-slate-100 leading-snug">
                      Факторы оценки
                    </p>
                  )}
                  {summary?.drivers?.length ? (
                    <ul className="mt-3 space-y-2">
                      {summary.drivers.slice(0, isFreePreview ? 5 : 3).map((d, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                          <span className={`leading-relaxed ${isFreePreview ? 'text-[15px] sm:text-[16px] text-slate-200' : 'text-slate-200'}`}>{d}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-slate-400">Нет данных по факторам спроса.</p>
                  )}
                </div>

                {isFreePreview && report.freeSummary?.risksAndLimitsRu?.length ? (
                  <div className="mt-4 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[17px] sm:text-[18px] font-semibold text-slate-100 leading-snug">
                      Риски и ограничения
                    </p>
                    <ul className="mt-3 space-y-2">
                      {report.freeSummary.risksAndLimitsRu.slice(0, 4).map((line, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-[15px] sm:text-[16px] text-slate-200 leading-relaxed">{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              {isFreePreview || !premiumPaidReport ? (
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                {!isFreePreview ? (
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Что делаем с этим</p>
                ) : (
                  <p className="text-[17px] font-semibold text-slate-100 leading-snug">Стратегия запуска</p>
                )}
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                    {!isFreePreview ? (
                      <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Стратегия</p>
                    ) : null}
                    <p className={`${isFreePreview ? '' : 'mt-1'} text-sm font-semibold text-white`}>
                      {summary?.recommended_strategy
                        ? strategyTitleRu(summary.recommended_strategy)
                        : isFreePreview
                          ? 'Сравнение моделей — в полном отчёте'
                          : '—'}
                    </p>
                  </div>
                  {!isFreePreview ? (
                    <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Доход (ориентир)</p>
                      <p className="mt-1 text-lg font-bold text-white tabular-nums">
                        {summary?.income_rub_month != null ? fmtRub(summary.income_rub_month) : '—'}
                        <span className="text-slate-500 text-sm font-normal"> / мес</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-600">Потенциал зависит от упаковки, цены и каналов</p>
                    </div>
                  ) : null}
                </div>
              </div>
              ) : null}
            </div>
          </SectionShell>

          {!isFreePreview && premiumPaidReport ? (
            <PremiumPaidReportSections content={premiumPaidReport} />
          ) : null}

          {!isFreePreview && strReport && !premiumPaidReport ? (
            <>
              <SectionShell
                id="str-suitability"
                title="Вывод по посуточной аренде"
                lead="Главный коммерческий вывод: какой сценарий монетизации подходит объекту и какие проверки нужны до вложений."
              >
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Оценка пригодности</p>
                    <p className="mt-2 text-4xl font-bold text-white tabular-nums">
                      {strReport.suitabilityScore ?? '—'}
                      <span className="text-lg font-medium text-slate-500"> / 100</span>
                    </p>
                  </div>
                  <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Рекомендация</p>
                    <p className="mt-2 text-2xl font-bold text-white">{strReport.recommendationLabelRu}</p>
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">{strReport.executiveConclusionRu}</p>
                  </div>
                </div>
              </SectionShell>

              <SectionShell
                id="audience-fit"
                title="Кому подходит объект"
                lead="Показываем вероятные сценарии спроса: кто будет искать жильё рядом и почему."
              >
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Подходит для</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {strReport.audienceFit.suitableForRu.map(item => (
                        <span key={item} className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-sm text-indigo-100">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-sm text-slate-200 leading-relaxed">{strReport.audienceFit.explanationRu}</p>
                  </div>
                </div>
              </SectionShell>

              <SectionShell
                id="demand-signals"
                title="Сигналы спроса"
                lead="Разделяем деловой, транспортный, медицинский, учебный, туристический и локальный спрос, чтобы не смешивать разные причины бронирований."
              >
                <div className="grid gap-5 lg:grid-cols-3">
                  {[
                    { title: 'Бизнес и командировки', lines: strReport.signalGroups.businessCorporateRu },
                    { title: 'Транспорт', lines: strReport.signalGroups.transportRu },
                    { title: 'Медицина, учёба, туризм, локальные магниты', lines: strReport.signalGroups.medicalUniversityTourismLocalRu },
                  ].map(group => (
                    <div key={group.title} className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                      <p className="text-sm font-semibold text-white">{group.title}</p>
                      {group.lines.length ? (
                        <ul className="mt-3 space-y-2">
                          {group.lines.map(line => (
                            <li key={line} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-slate-500 leading-relaxed">Сильных сигналов в этом блоке не найдено.</p>
                      )}
                    </div>
                  ))}
                </div>
              </SectionShell>

              <SectionShell
                id="territory-risk"
                title="Территория и риски окружения"
                lead="Территориальный разбор помогает понять, какие функции спроса есть рядом и какие факторы стоит проверить до решения."
              >
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Интерпретация территории</p>
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                      {strReport.territorialInterpretation.summaryRu}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-3">
                        <p className="text-slate-500">Качество сигналов</p>
                        <p className="mt-1 font-semibold text-white">{strReport.territorialInterpretation.signalQualityRu}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-3">
                        <p className="text-slate-500">Разнообразие</p>
                        <p className="mt-1 font-semibold text-white">{strReport.territorialInterpretation.diversityRu}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-3">
                        <p className="text-slate-500">Деловой спрос</p>
                        <p className="mt-1 font-semibold text-white">{strReport.territorialInterpretation.businessSuitabilityRu}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-3">
                        <p className="text-slate-500">Транспорт</p>
                        <p className="mt-1 font-semibold text-white">{strReport.territorialInterpretation.transportBalanceRu}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Риск неравномерного спроса</p>
                    <p className={`mt-2 text-2xl font-bold ${weakZoneLabelRu(strReport.weakZoneRisk.level).className}`}>
                      {weakZoneLabelRu(strReport.weakZoneRisk.level).label}
                    </p>
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">{strReport.weakZoneRisk.summaryRu}</p>
                  </div>
                </div>
              </SectionShell>
            </>
          ) : null}

          {!isFreePreview && meta ? (
            <SectionShell
              id="data-freshness"
              title="Свежесть данных"
              lead="Когда сформирован отчёт и какие источники уже участвуют в расчёте — без технических подробностей интеграций."
            >
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Расчёт выполнен</p>
                  <p className="mt-2 text-lg font-semibold text-white tabular-nums">{calculatedAtDisplay ?? generatedAt ?? '—'}</p>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                    Адрес запроса: <span className="text-slate-200">{meta.inputAddress}</span>
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Уже используется в этом отчёте</p>
                  <ul className="mt-3 space-y-2">
                    {meta.clientFreshnessRu.usedSources.map((line, i) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {meta.clientFreshnessRu.preparingSources.length ? (
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">В подготовке / подключается отдельно</p>
                    <ul className="mt-3 space-y-2">
                      {meta.clientFreshnessRu.preparingSources.map((line, i) => (
                        <li key={i} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-amber-400/90 shrink-0" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">{meta.dataFreshness.summaryRu}</p>
              </div>
            </SectionShell>
          ) : !isFreePreview && !meta ? (
            <SectionShell id="data-freshness" title="Свежесть данных">
              <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
                Данные рассчитаны ранее, точное время расчёта недоступно.
              </p>
            </SectionShell>
          ) : null}

          {/* 2) Business-fit */}
          {!isFreePreview && !premiumPaidReport ? (
          <>
          <SectionShell
            id="business-fit"
            title="Деловой спрос"
            lead="Оцениваем, тянет ли локация деловой сценарий: командировки, проектные команды, корпоративные размещения."
          >
            {businessFit ? (
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="lg:col-span-1 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Вердикт</p>
                  <p className={`mt-2 text-xl font-bold ${fitLabelRu(businessFit.business_fit_verdict).className}`}>
                    {fitLabelRu(businessFit.business_fit_verdict).title}
                  </p>
                  {businessFit.note ? (
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">{businessFit.note}</p>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                      Нужны дополнительные сигналы (аудитория/магниты), чтобы дать уверенный вывод.
                    </p>
                  )}
                </div>

                <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Первостепенные магниты</p>
                  {businessFit.primary_magnets.length ? (
                    <div className="mt-4 grid sm:grid-cols-2 gap-3">
                      {businessFit.primary_magnets.map((m, i) => (
                        <div key={i} className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-white leading-snug flex-1">{m.title}</p>
                            {m.anchor_type && <AnchorTypeBadge anchorType={m.anchor_type as AnchorType} />}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Дистанция: {fmtMeters(m.distance_m)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-slate-400">Магниты не найдены.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Секция business-fit отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 3) Главные магниты */}
          <SectionShell
            id="magnets"
            title="Главные магниты"
            lead="Устойчивые точки притяжения вокруг объекта — то, что формирует реальный спрос на проживание рядом. Только крупные городские и региональные объекты."
          >
            {magnets ? (
              <>
                {magnets.no_magnets_note ? (
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-slate-400 leading-relaxed">{magnets.no_magnets_note}</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {magnets.primary.length > 0 && (
                      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Основные магниты</p>
                        <div className="mt-4 space-y-3">
                          {magnets.primary.map((m, i) => (
                            <div key={i} className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-white">{m.name}</p>
                                  <AnchorTypeBadge anchorType={m.anchor_type as AnchorType} />
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">{m.category_label_ru ?? m.category_id}</p>
                              </div>
                              <span className="text-sm text-slate-300 tabular-nums shrink-0">{fmtMeters(m.distance_m)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {magnets.secondary.length > 0 && (
                      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Дополнительные магниты</p>
                        <div className="mt-4 space-y-3">
                          {magnets.secondary.map((m, i) => (
                            <div key={i} className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm text-slate-200">{m.name}</p>
                                  <AnchorTypeBadge anchorType={m.anchor_type as AnchorType} />
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">{m.category_label_ru ?? m.category_id}</p>
                              </div>
                              <span className="text-sm text-slate-400 tabular-nums shrink-0">{fmtMeters(m.distance_m)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {magnets.primary.length === 0 && magnets.secondary.length === 0 && (
                      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                        <p className="text-slate-400">Prime-магниты в зоне 1 км не обнаружены.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-400">Секция магнитов отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {demandSignalLines.length > 0 ? (
            <SectionShell
              id="demand-signals-detail"
              title="Факторы спроса (детализация)"
              lead="Региональные транспортные узлы и крупная медицина не входят в список prime-магнитов в пешей доступности — они показываются отдельно как контекст спроса."
            >
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                <ul className="space-y-3">
                  {demandSignalLines.map((line, i) => (
                    <li key={i} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-cyan-400/90 shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </SectionShell>
          ) : null}

          {/* 4) Конкуренция */}
          <SectionShell
            id="competition"
            title="Конкуренция"
            lead="Чем выше давление конкурентов, тем больше значение имеют упаковка, ценовая стратегия и каналы продаж."
          >
            {competition ? (
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Конкурентов рядом</p>
                  <p className="mt-2 text-3xl font-bold text-white tabular-nums">{competition.competitor_count}</p>
                  <p className="mt-1 text-xs text-slate-600">Счётчик по данным анализа</p>
                </div>

                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Давление конкуренции</p>
                  <p className={`mt-2 text-2xl font-bold ${pressureLabelRu(competition.pressure_level).className}`}>
                    {pressureLabelRu(competition.pressure_level).label}
                  </p>
                  <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                    При {competition.pressure_level === 'high' ? 'высоком' : competition.pressure_level === 'medium' ? 'среднем' : 'низком'} давлении
                    ключевой рычаг — позиционирование и дисциплина по цене/каналам.
                  </p>
                </div>
                {strReport?.competitionOta.notesRu.length ? (
                  <div className="sm:col-span-3 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Площадки бронирования и ручная проверка</p>
                    <ul className="mt-3 space-y-2">
                      {strReport.competitionOta.notesRu.map(note => (
                        <li key={note} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-slate-400">Секция конкуренции отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 5) Доход / стратегия */}
          <SectionShell
            id="income-strategy"
            title="Доход / стратегия"
            lead="Сравниваем потенциал дохода по трём моделям и фиксируем, какая стратегия даёт лучший баланс спроса и конкуренции."
          >
            {incomeStrategy ? (
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Сравнение стратегий</p>
                  {strReport?.monetization.monthlyIncomeRangeRub ? (
                    <div className="mt-4 rounded-2xl border border-indigo-500/35 bg-indigo-500/10 p-5">
                      <p className="text-xs text-indigo-200 uppercase tracking-[0.18em]">Ориентир по посуточному сценарию</p>
                      <p className="mt-2 text-2xl font-bold text-white tabular-nums">
                        {fmtRubRange(strReport.monetization.monthlyIncomeRangeRub)}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">Диапазон, а не обещание результата.</p>
                    </div>
                  ) : null}
                  <div className="mt-4 grid sm:grid-cols-3 gap-3">
                    {([
                      { key: 'short_term', label: 'Посуточно', val: incomeStrategy.monthly_income_rub.short_term },
                      { key: 'hybrid', label: 'Гибрид', val: incomeStrategy.monthly_income_rub.hybrid },
                      { key: 'mid_term', label: 'Среднесрок', val: incomeStrategy.monthly_income_rub.mid_term },
                    ] as const).map(s => {
                      const isRec = incomeStrategy.recommended_strategy === s.key;
                      return (
                        <div
                          key={s.key}
                          className={`rounded-2xl border p-5 ${isRec ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-slate-800/70 bg-slate-900/20'}`}
                        >
                          <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">{s.label}</p>
                          <p className="mt-2 text-xl font-bold text-white tabular-nums">
                            {fmtRub(s.val)}
                            <span className="text-slate-500 text-sm font-normal"> / мес</span>
                          </p>
                          {isRec ? (
                            <p className="mt-2 text-xs text-indigo-200">Рекомендовано</p>
                          ) : (
                            <p className="mt-2 text-xs text-slate-600">Альтернатива</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {incomeStrategy.positioning_hint ? (
                    <p className="mt-5 text-sm text-slate-300 leading-relaxed">{incomeStrategy.positioning_hint}</p>
                  ) : null}
                  {strReport?.monetization.notesRu.length ? (
                    <ul className="mt-4 space-y-2">
                      {strReport.monetization.notesRu.map(note => (
                        <li key={note} className="text-xs text-slate-500 leading-relaxed">{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Стратегический акцент</p>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Рекомендация</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {incomeStrategy.recommended_strategy ? strategyTitleRu(incomeStrategy.recommended_strategy as any) : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Что докручиваем</p>
                      <ul className="mt-2 space-y-2 text-sm text-slate-300 leading-relaxed">
                        <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />Упаковка под целевой спрос (оформление + УТП)</li>
                        <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />Ценообразование под конкуренцию и сезонность</li>
                        <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />Каналы продаж: где брать стабильный поток</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Секция дохода/стратегии отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {strReport ? (
            <SectionShell
              id="manual-risks"
              title="Риски и что проверить вручную"
              lead="Отчёт снижает риск ошибки, но финальное решение должно учитывать объект, дом, сезон и реальные цены на площадках."
            >
              <div className="grid gap-5 lg:grid-cols-3">
                <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <ul className="space-y-3">
                    {strReport.risksAndManualChecksRu.map(item => (
                      <li key={item} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Уверенность вывода</p>
                  <p className="mt-2 text-2xl font-bold text-white">{confidenceLabelRu(strReport.confidence.level)}</p>
                  <ul className="mt-4 space-y-2">
                    {strReport.confidence.reasonsRu.map(reason => (
                      <li key={reason} className="text-sm text-slate-400 leading-relaxed">{reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </SectionShell>
          ) : null}

          {!isFreePreview && urbanForecast ? (
            <SectionShell
              id="urban-forecast"
              title="Прогноз развития района"
              lead="Отдельный слой по сигналам градостроительного развития. Основной вердикт и итоговая оценка по спросу здесь не меняются."
            >
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Индикатор прогноза</p>
                  <p className="mt-2 text-4xl font-bold text-white tabular-nums">
                    {urbanForecast.score}
                    <span className="text-lg font-medium text-slate-500"> / 100</span>
                  </p>
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                    при отсутствии нормализованных сигналов остаётся 0 и низкий уровень ожиданий
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Уровень / уверенность</p>
                  <p className="mt-2 text-xl font-bold text-white">{urbanForecastLevelRu(urbanForecast.level)}</p>
                  <p className="mt-2 text-sm text-slate-400">уверенность прогноза: {urbanForecastConfidenceRu(urbanForecast.confidence)}</p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Сигналов с вкладом</p>
                  <p className="mt-2 text-3xl font-bold text-white tabular-nums">{urbanForecast.contributingSignals.length}</p>
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">учитываются нормализованные источники градоразвития</p>
                </div>
              </div>

              {urbanForecast.reasonsRu.length ? (
                <div className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Объяснение</p>
                  <ul className="mt-3 space-y-2">
                    {urbanForecast.reasonsRu.map((line, i) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {urbanForecastNoLiveData ? (
                <p className="mt-6 rounded-2xl border border-slate-800/60 bg-slate-900/25 p-5 text-sm text-slate-300 leading-relaxed">
                  {URBAN_DEVELOPMENT_LIVE_SOURCES_DISCLAIMER_RU}
                </p>
              ) : null}
            </SectionShell>
          ) : null}
          </>
          ) : null}

          {/* 6) Next step + single CTA */}
          <SectionShell
            id="next-step"
            title="Следующий шаг"
            lead={
              isFreePreview
                ? 'Это быстрая предварительная оценка по открытым данным.'
                : 'Вы уже получили базовую оценку потенциала локации и направление по стратегии. Дальше — превратить это в решение: как сравнить сценарии, какие вложения планировать и что проверить до запуска.'
            }
          >
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-7 sm:p-8">
              <div className="grid lg:grid-cols-5 gap-6 items-start">
                <div className="lg:col-span-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-200/80">
                    {isFreePreview ? 'Полный отчёт' : 'Дальше по объекту'}
                  </p>
                  <h3 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">
                    {isFreePreview
                      ? 'Получить подробную аналитику по этой локации'
                      : 'Перевести отчёт в план действий по объекту'}
                  </h3>
                  <p className="mt-3 text-[15px] sm:text-[16px] text-slate-300 leading-relaxed max-w-2xl">
                    {isFreePreview
                      ? 'Подробный расчёт и разбор под вашу модель доступны в полном отчёте.'
                      : 'Мы уже посчитали базовый потенциал локации: спрос, конкуренцию и ориентир по доходу. Следующий шаг — прикладной разбор под вашу модель и выбор стратегии монетизации.'}
                  </p>

                  {!isFreePreview ? (
                    <div className="mt-5">
                      <p className="text-xs font-semibold text-slate-200 uppercase tracking-[0.18em]">
                        Что вы получите дальше
                      </p>
                      <ul className="mt-3 space-y-2 text-sm text-slate-200">
                        <li className="flex gap-3">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                          Какая стратегия подходит именно под этот объект и какие доработки стоит учесть заранее
                        </li>
                        <li className="flex gap-3">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                          Где потенциал может отличаться от ожиданий: аудитория, каналы, ограничения, конкуренты
                        </li>
                        <li className="flex gap-3">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                          Как снизить ошибки перед запуском: упаковка, прайс, операционные «узкие места»
                        </li>
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="lg:col-span-2">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Один следующий шаг</p>
                    <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                      Используйте отчёт до покупки, запуска или подключения управления, чтобы сравнить сценарии и не принимать решение вслепую.
                    </p>

                    <div className="print-hide mt-5">
                      <div className="grid gap-2">
                        <Link
                          href={detailedReportHref}
                          className="inline-flex items-center justify-center w-full px-7 py-4 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors shadow-lg"
                        >
                          {primaryCtaLabel}
                        </Link>
                        {!isFreePreview ? (
                          <Link
                            href={LOCATION_REPORT_PRODUCT_PATH}
                            className="inline-flex items-center justify-center w-full px-7 py-3 rounded-xl border border-slate-700 text-slate-100 hover:border-slate-500 transition-colors"
                          >
                            {secondaryCtaLabel}
                          </Link>
                        ) : null}
                      </div>
                      {!isFreePreview ? (
                        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                          Коротко опишите объект — вернёмся с полным отчётом и рекомендациями по модели запуска.
                        </p>
                      ) : null}
                    </div>

                    <div className="print-hide mt-5 pt-5 border-t border-slate-800/70">
                      <button
                        type="button"
                        onClick={shareLink}
                        disabled={!canShare}
                        className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {shareStatus === 'copied' ? 'Ссылка скопирована' : shareStatus === 'failed' ? 'Не удалось скопировать' : 'Скопировать ссылку на отчёт'}
                      </button>
                      {!isFreePreview ? (
                        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                          Ссылку можно сохранить или отправить партнёру/инвестору — отчёт откроется как отдельная страница.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionShell>
        </div>
      </main>
    </div>
  );
}

