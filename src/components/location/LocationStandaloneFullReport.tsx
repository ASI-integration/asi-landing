'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LocationStandaloneReport, LocationStandaloneReportSectionId } from '@/lib/location';

function fmtRub(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₽${Math.round(n).toLocaleString('ru-RU')}`;
}

function fmtMeters(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  return `${(m / 1000).toFixed(1)} км`;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
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

function residentialStrategyTitleRu(s: string | null): string {
  if (s === 'selective_premium_short_term') return 'Избирательная посуточная аренда под premium-комфорт';
  if (s === 'cautious_manual_only') return 'Осторожный ручной режим';
  if (s === 'short_term') return 'Посуточная аренда';
  if (s === 'hybrid') return 'Гибрид: посуточно + среднесрок';
  if (s === 'mid_term') return 'Среднесрочная аренда';
  return '—';
}

function residentialAudienceTitleRu(s: string | null): string {
  if (s === 'premium_comfort') return 'Premium-комфорт';
  if (s === 'mixed_use_adjacent') return 'Смешанная жилая среда рядом с коммерцией';
  if (s === 'standard_residential') return 'Стандартная жилая аудитория';
  return '—';
}

function confidenceLabelRu(s: string | null): string {
  if (s === 'high') return 'высокая';
  if (s === 'medium') return 'средняя';
  if (s === 'low') return 'низкая';
  return '—';
}

function pressureLabelRu(p: 'low' | 'medium' | 'high'): { label: string; className: string } {
  if (p === 'low') return { label: 'низкое', className: 'text-emerald-300' };
  if (p === 'medium') return { label: 'среднее', className: 'text-amber-300' };
  return { label: 'высокое', className: 'text-rose-300' };
}

function fitLabelRu(v: 'fit' | 'not_fit' | 'unknown'): { title: string; className: string } {
  if (v === 'fit') return { title: 'Подходит', className: 'text-emerald-300' };
  if (v === 'not_fit') return { title: 'Скорее не подходит', className: 'text-slate-200' };
  return { title: 'Недостаточно данных', className: 'text-slate-400' };
}

function decisionTone(verdict: string | null | undefined): { card: string; text: string; dot: string } {
  if (verdict === 'стоит') {
    return {
      card: 'border-emerald-500/45 bg-emerald-950/20',
      text: 'text-emerald-200',
      dot: 'bg-emerald-400',
    };
  }
  if (verdict === 'не стоит') {
    return {
      card: 'border-rose-500/45 bg-rose-950/20',
      text: 'text-rose-200',
      dot: 'bg-rose-400',
    };
  }
  return {
    card: 'border-amber-500/45 bg-amber-950/20',
    text: 'text-amber-200',
    dot: 'bg-amber-400',
  };
}

type MetricTone = {
  label: 'высокий' | 'средний' | 'низкий';
  dotClassName: string;
  textClassName: string;
  barClassName: string;
  pillClassName: string;
};

function metricTone(value: number, mode: 'positive' | 'risk' = 'positive'): MetricTone {
  const high = value >= 67;
  const medium = value >= 34;

  if (mode === 'risk') {
    if (high) {
      return {
        label: 'высокий',
        dotClassName: 'bg-rose-400',
        textClassName: 'text-rose-300',
        barClassName: 'bg-rose-400',
        pillClassName: 'border-rose-900/60 bg-rose-950/35 text-rose-200',
      };
    }
    if (medium) {
      return {
        label: 'средний',
        dotClassName: 'bg-amber-400',
        textClassName: 'text-amber-300',
        barClassName: 'bg-amber-400',
        pillClassName: 'border-amber-900/60 bg-amber-950/35 text-amber-200',
      };
    }
    return {
      label: 'низкий',
      dotClassName: 'bg-emerald-400',
      textClassName: 'text-emerald-300',
      barClassName: 'bg-emerald-400',
      pillClassName: 'border-emerald-900/60 bg-emerald-950/35 text-emerald-200',
    };
  }

  if (high) {
    return {
      label: 'высокий',
      dotClassName: 'bg-emerald-400',
      textClassName: 'text-emerald-300',
      barClassName: 'bg-emerald-400',
      pillClassName: 'border-emerald-900/60 bg-emerald-950/35 text-emerald-200',
    };
  }
  if (medium) {
    return {
      label: 'средний',
      dotClassName: 'bg-amber-400',
      textClassName: 'text-amber-300',
      barClassName: 'bg-amber-400',
      pillClassName: 'border-amber-900/60 bg-amber-950/35 text-amber-200',
    };
  }
  return {
    label: 'низкий',
    dotClassName: 'bg-rose-400',
    textClassName: 'text-rose-300',
    barClassName: 'bg-rose-400',
    pillClassName: 'border-rose-900/60 bg-rose-950/35 text-rose-200',
  };
}

function pickExistingOverallScore(report: LocationStandaloneReport): number | null {
  const candidate = report as LocationStandaloneReport & {
    overall_score?: unknown;
    score?: unknown;
    location_score?: unknown;
    analytics?: { location_score?: unknown; overall_score?: unknown };
  };

  const values = [
    candidate.overall_score,
    candidate.score,
    candidate.location_score,
    candidate.analytics?.location_score,
    candidate.analytics?.overall_score,
  ];

  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return clampPct(value);
  }
  return null;
}

function MetricBar({
  title,
  value,
  valueLabel,
  sourceLabel,
  tone,
}: {
  title: string;
  value: number | null;
  valueLabel: string;
  sourceLabel: string;
  tone: MetricTone;
}) {
  const pct = value == null ? 0 : clampPct(value);
  return (
    <div className="w-full min-w-0 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-0.5 text-[12px] text-slate-500 leading-snug">{sourceLabel}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.pillClassName}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dotClassName}`} />
          {tone.label}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <span className={`text-xl font-bold tabular-nums ${tone.textClassName}`}>{value == null ? '—' : fmtPct(pct)}</span>
          <span className="text-xs text-slate-400 text-right leading-snug">{valueLabel}</span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full ${tone.barClassName}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
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
    <section id={id} className="scroll-mt-24">
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
}: {
  report: LocationStandaloneReport;
}) {
  const summary = pickSection(report, 'summary');
  const businessFit = pickSection(report, 'business_fit');
  const magnets = pickSection(report, 'magnets');
  const competition = pickSection(report, 'competition');
  const risks = pickSection(report, 'risks');
  const recommendations = pickSection(report, 'recommendations');
  const incomeStrategy = pickSection(report, 'income_strategy');
  const residentialAnalysis = pickSection(report, 'residential_analysis');
  const summaryDecisionTone = decisionTone(summary?.verdict);

  const tocItems = useMemo(() => ([
    { id: 'summary', label: 'Итог' },
    { id: 'business-fit', label: 'Business-fit' },
    { id: 'magnets', label: 'Магниты' },
    { id: 'competition', label: 'Конкуренция' },
    { id: 'risks', label: 'Риски' },
    { id: 'income-strategy', label: 'Доход / стратегия' },
    { id: 'residential-analysis', label: 'Жилая модель' },
    { id: 'next-step', label: 'Следующий шаг' },
  ]), []);

  const generatedAt = useMemo(() => {
    const d = new Date(report.generated_at_iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, [report.generated_at_iso]);

  const visualMetrics = useMemo(() => {
    const primaryDemandCount = magnets?.primary.length ?? 0;
    const secondaryDemandCount = magnets?.secondary.length ?? 0;
    const demandPct = magnets
      ? clampPct((primaryDemandCount / 3) * 70 + (secondaryDemandCount / 2) * 30)
      : null;

    const competitorCount = competition?.competitor_count;
    const competitionPct = competitorCount == null
      ? null
      : clampPct((competitorCount / 20) * 100);

    const incomeValues = incomeStrategy
      ? [
          incomeStrategy.monthly_income_rub.short_term,
          incomeStrategy.monthly_income_rub.hybrid,
          incomeStrategy.monthly_income_rub.mid_term,
        ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
      : [];
    const maxIncome = incomeValues.length ? Math.max(...incomeValues) : null;
    const displayedIncome = summary?.income_rub_month ?? maxIncome;
    const incomePct = displayedIncome != null && maxIncome != null && maxIncome > 0
      ? clampPct((displayedIncome / maxIncome) * 100)
      : null;

    const explicitScore = pickExistingOverallScore(report);

    return {
      demandPct,
      demandLabel: `${primaryDemandCount + secondaryDemandCount} магнитов спроса`,
      competitionPct,
      competitionLabel: competitorCount == null ? 'нет данных' : `${competitorCount} объектов рядом`,
      incomePct,
      incomeLabel: displayedIncome == null ? 'нет данных' : `${fmtRub(displayedIncome)} / мес`,
      scorePct: explicitScore,
      scoreSource: explicitScore != null
        ? 'из analysis.locationScore.location_score'
        : 'location_score отсутствует в отчёте',
    };
  }, [competition, incomeStrategy, magnets, report, summary]);

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
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт по локации</p>
            <p className="mt-1 text-sm text-slate-200 truncate" title={report.address}>{report.address}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="#next-step"
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
            >
              Сохранить / обсудить
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
        <div className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-900/40 to-slate-950/20 p-7 sm:p-10">
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                ASI · Location Intelligence · {generatedAt ? `сформировано ${generatedAt}` : 'сформировано'}
              </p>
              <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-white">
                Отчёт по потенциалу локации
              </h1>
              <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">
                Документ, чтобы решить, стоит ли заходить в объект и какой моделью дохода идти: посуточно, среднесрок или гибрид.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
                <p className="mt-2 text-sm text-slate-200 leading-snug">{report.address}</p>
              </div>
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Ориентир по доходу (оценка)</p>
                <p className="mt-2 text-xl font-bold text-white tabular-nums">
                  {summary?.income_rub_month != null ? `${fmtRub(summary.income_rub_month)} / мес` : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-500">Оценка / прокси, не гарантированная «рыночная правда»</p>
                <p className="mt-1 text-xs text-slate-600">До расходов и комиссий управления</p>
              </div>
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Рекомендуемая стратегия</p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  {summary?.recommended_strategy ? strategyTitleRu(summary.recommended_strategy) : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-500">Вывод из окружения + конкуренции</p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/70 bg-slate-950/35 p-5 sm:p-6">
              <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-4 sm:gap-5">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/25 p-5">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Общий score</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className={`text-5xl font-black tracking-tight tabular-nums ${metricTone(visualMetrics.scorePct ?? 0).textClassName}`}>
                      {visualMetrics.scorePct == null ? '—' : Math.round(visualMetrics.scorePct)}
                    </span>
                    {visualMetrics.scorePct == null ? null : (
                      <span className="pb-1 text-xl font-bold text-slate-500">%</span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${metricTone(visualMetrics.scorePct ?? 0).dotClassName}`} />
                    <span className={`text-sm font-semibold ${metricTone(visualMetrics.scorePct ?? 0).textClassName}`}>
                      {visualMetrics.scorePct == null ? 'нет данных' : metricTone(visualMetrics.scorePct).label}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500 leading-relaxed">{visualMetrics.scoreSource}</p>
                </div>

                <div className="grid gap-3">
                  <MetricBar
                    title="Спрос"
                    value={visualMetrics.demandPct}
                    valueLabel={visualMetrics.demandLabel}
                    sourceLabel="по primary/secondary магнитам"
                    tone={metricTone(visualMetrics.demandPct ?? 0)}
                  />
                  <MetricBar
                    title="Конкуренция"
                    value={visualMetrics.competitionPct}
                    valueLabel={visualMetrics.competitionLabel}
                    sourceLabel="по счётчику конкурентов рядом"
                    tone={metricTone(visualMetrics.competitionPct ?? 0, 'risk')}
                  />
                  <MetricBar
                    title="Доходный потенциал"
                    value={visualMetrics.incomePct}
                    valueLabel={visualMetrics.incomeLabel}
                    sourceLabel="по сценариям income_strategy"
                    tone={metricTone(visualMetrics.incomePct ?? 0)}
                  />
                </div>
              </div>
            </div>

            <Toc items={tocItems} />
          </div>
        </div>

        <div className="mt-10 sm:mt-12 space-y-6">
          {/* 1) Summary */}
          <SectionShell
            id="summary"
            title="Итог"
            lead="Первое, что важно для решения: score, вердикт, короткая причина, доход и стратегия."
          >
            <div className={`rounded-3xl border p-6 sm:p-8 ${summaryDecisionTone.card}`}>
              <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-6 items-start">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Location score</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="text-6xl sm:text-7xl font-black tracking-tight tabular-nums text-white">
                      {summary?.location_score == null ? '—' : Math.round(summary.location_score)}
                    </span>
                    {summary?.location_score == null ? null : (
                      <span className="pb-2 text-2xl font-bold text-slate-400">/100</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    <span className={`h-2 w-2 rounded-full ${summaryDecisionTone.dot}`} />
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300">Вердикт</span>
                  </div>
                  <p className={`mt-3 text-3xl sm:text-4xl font-black leading-tight ${summaryDecisionTone.text}`}>
                    {summary?.verdict ?? '—'}
                  </p>
                  <p className="mt-3 text-base sm:text-lg text-slate-100 leading-relaxed max-w-2xl">
                    {summary?.short_reason ?? 'Нет короткого объяснения.'}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Доход</p>
                  <p className="mt-2 text-2xl font-bold text-white tabular-nums">
                    {summary?.income_rub_month != null ? `${fmtRub(summary.income_rub_month)} / мес` : '—'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Стратегия</p>
                  <p className="mt-2 text-base font-bold text-white leading-snug">
                    {summary?.recommended_strategy ? strategyTitleRu(summary.recommended_strategy) : '—'}
                  </p>
                </div>
              </div>
            </div>
          </SectionShell>

          {/* 2) Business-fit */}
          <SectionShell
            id="business-fit"
            title="Business-fit"
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
            lead="Устойчивые точки притяжения вокруг объекта — то, что формирует реальный спрос на проживание рядом. Только крупные городские и региональные якоря."
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
              </div>
            ) : (
              <p className="text-slate-400">Секция конкуренции отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 5) Риски */}
          <SectionShell
            id="risks"
            title="Риски"
            lead="Факторы, которые могут снизить доходность или сделать стратегию менее устойчивой."
          >
            {risks?.items.length ? (
              <ul className="grid sm:grid-cols-2 gap-2">
                {risks.items.slice(0, 6).map((risk, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-xl border border-slate-800/70 bg-slate-950/30 px-4 py-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-100 leading-snug">{risk.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-400">Явные риски в отчёте не выделены.</p>
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

                  {incomeStrategy.assumptions?.length ? (
                    <div className="mt-5 rounded-2xl border border-slate-800/70 bg-slate-900/20 p-5">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Допущения расчёта</p>
                      <div className="mt-3 space-y-3">
                        {incomeStrategy.assumptions.map((a, i) => (
                          <div key={i}>
                            <p className="text-sm font-semibold text-white">{a.title}</p>
                            <p className="mt-1 text-sm text-slate-300 leading-relaxed">{a.explanation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
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
                    {recommendations ? (
                      <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                        <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Рекомендации</p>
                        <ul className="mt-3 space-y-2 text-sm text-slate-300 leading-relaxed">
                          <li className="flex gap-3">
                            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                            <span>Начать с ручной проверки: {recommendations.location_action}</span>
                          </li>
                          <li className="flex gap-3">
                            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                            <span>Ориентироваться на аудиторию: {recommendations.target_audience}</span>
                          </li>
                          <li className="flex gap-3">
                            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                            <span>{recommendations.avoid}</span>
                          </li>
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Секция дохода/стратегии отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 6) Жилая модель */}
          <SectionShell
            id="residential-analysis"
            title="Жилая модель"
            lead="Отдельный residential-слой: аудитория, стратегия, уверенность и операционный режим."
          >
            {residentialAnalysis ? (
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Аудитория</p>
                  <p className="mt-2 text-lg font-bold text-white">{residentialAudienceTitleRu(residentialAnalysis.residentialAudienceType)}</p>
                  <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-slate-500">Стратегия</p>
                  <p className="mt-2 text-sm font-semibold text-slate-100">{residentialStrategyTitleRu(residentialAnalysis.residentialStrategy)}</p>
                  <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-slate-500">Уверенность</p>
                  <p className="mt-2 text-sm font-semibold text-slate-100">{confidenceLabelRu(residentialAnalysis.confidence)}</p>
                </div>
                <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Обоснование стратегии</p>
                  <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                    {residentialAnalysis.strategyRationaleRu ?? 'Нет residential-обоснования.'}
                  </p>
                  <p className="mt-5 text-[11px] uppercase tracking-[0.22em] text-slate-500">Операционно</p>
                  <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                    {residentialAnalysis.operationalNoteRu ?? 'Нет операционной заметки.'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Residential-анализ отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 6) Next step + single CTA */}
          <SectionShell
            id="next-step"
            title="Следующий шаг"
            lead="Сохраните отчёт или обсудите выводы с партнёром перед решением по объекту."
          >
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-7 sm:p-8">
              <div className="grid lg:grid-cols-5 gap-6 items-start">
                <div className="lg:col-span-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-200/80">Commercial bridge</p>
                  <h3 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">
                    Перевести отчёт в план действий по объекту
                  </h3>
                  <p className="mt-3 text-slate-300 leading-relaxed max-w-2xl">
                    В отчёте зафиксированы потенциал локации, риски, доходные допущения и residential-стратегия. Следующий шаг — сохранить выводы и сверить их с фактическими условиями объекта.
                  </p>

                  <div className="mt-5">
                    <p className="text-xs font-semibold text-slate-200 uppercase tracking-[0.18em]">Что вы получите дальше</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-200">
                      <li className="flex gap-3">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                        Какая стратегия подходит именно под этот объект — и где она требует ручной проверки
                      </li>
                      <li className="flex gap-3">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                        Где потенциал выше/ниже ожиданий: аудитория, ограничения, конкуренты
                      </li>
                      <li className="flex gap-3">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                        Что проверить до решения: договор, состояние, цена, операционные ограничения
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Один следующий шаг</p>
                    <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                      Если объект рассматривается к запуску/покупке — сохраните ссылку или обсудите выводы с партнёром.
                    </p>

                    <div className="mt-5">
                      <Link
                        href="/connect"
                        className="inline-flex items-center justify-center w-full px-7 py-4 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors shadow-lg"
                      >
                        Обсудить отчёт
                      </Link>
                      <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                        Коротко опишите объект и вопрос, который нужно разобрать.
                      </p>
                    </div>

                    <div className="mt-5 pt-5 border-t border-slate-800/70">
                      <button
                        type="button"
                        onClick={shareLink}
                        disabled={!canShare}
                        className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {shareStatus === 'copied' ? 'Ссылка скопирована' : shareStatus === 'failed' ? 'Не удалось скопировать' : 'Скопировать ссылку на отчёт'}
                      </button>
                      <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                        Ссылку можно сохранить или отправить партнёру/инвестору — отчёт откроется по permalink.
                      </p>
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

