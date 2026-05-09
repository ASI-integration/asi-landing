'use client';

import Link from 'next/link';
import type {
  FullLocationReport,
  IncomeEstimate,
  RecommendationItem,
  RiskItem,
} from '@/lib/location/report-contract';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtMoneyRange(e: IncomeEstimate): string {
  if (e.rangeMonthly) {
    return `${e.rangeMonthly.low.toLocaleString('ru-RU')}–${e.rangeMonthly.high.toLocaleString('ru-RU')} ₽/мес`;
  }
  if (typeof e.amountMonthly === 'number') {
    return `${e.amountMonthly.toLocaleString('ru-RU')} ₽/мес`;
  }
  return 'Недостаточно данных';
}

function confidenceLabel(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'Высокая';
  if (level === 'medium') return 'Средняя';
  return 'Низкая';
}

function pressureLabel(level: FullLocationReport['competition']['pressureLevel']): string {
  if (level === 'high') return 'Высокое';
  if (level === 'medium') return 'Среднее';
  if (level === 'low') return 'Низкое';
  return 'Недостаточно данных';
}

function severityClass(severity: RiskItem['severity']): string {
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-900';
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

function priorityLabel(priority: RecommendationItem['priority']): string {
  if (priority === 'now') return 'Сейчас';
  if (priority === 'next') return 'Следом';
  return 'Позже';
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="report-section scroll-mt-24">
      <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
        <h2 className="text-xl font-bold tracking-tight text-slate-950">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

export function LocationReportProductView({ report }: { report: FullLocationReport }) {
  const scoreRows = report.scoreBreakdown
    ? Object.entries(report.scoreBreakdown).filter(([, value]) => typeof value === 'number')
    : [];

  return (
    <div className="location-report-print min-h-screen bg-slate-100 text-slate-950">
      <header className="print-hide sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">ASI Location Report</p>
            <p className="mt-0.5 max-w-xl truncate text-sm text-slate-700">{report.input.address}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Печать / PDF
            </button>
            <Link
              href="/ru/location-analysis?mode=residential"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Новый preview
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {report.isSample ? 'Sample / demo data' : 'Paid report'}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {fmtDate(report.createdAtIso)}
                </span>
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                Отчёт по потенциалу локации
              </h1>
              <p className="mt-3 text-base leading-relaxed text-slate-700">{report.executiveSummary.summary}</p>
            </div>
            <div className="grid min-w-[260px] grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Score</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-slate-950">
                  {report.overallScore ?? '—'}
                  <span className="text-base font-medium text-slate-500"> / 100</span>
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Confidence</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{confidenceLabel(report.confidence.level)}</p>
                <p className="mt-1 text-xs text-slate-500">data quality: {report.confidence.dataQuality}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 border-t border-slate-200 pt-5 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Адрес / объект</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{report.input.address}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Вердикт</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{report.executiveSummary.verdict}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Стратегия</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {report.incomePotential.recommendedStrategy ?? 'Требует уточнения'}
              </p>
            </div>
          </div>
        </div>

        {report.isSample ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
            Это демонстрационный sample-отчёт. Он показывает структуру продукта и PDF/print-вид, но не является
            анализом реального адреса и не должен использоваться как инвестиционная рекомендация.
          </div>
        ) : null}

        <Section id="executive-summary" title="Executive Summary">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">Главные драйверы</p>
              <ul className="mt-3 space-y-2">
                {report.executiveSummary.keyDrivers.map(driver => (
                  <li key={driver} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    {driver}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Основные риски</p>
              <ul className="mt-3 space-y-2">
                {report.executiveSummary.keyRisks.map(risk => (
                  <li key={risk} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section id="score-breakdown" title="Score Breakdown">
            {scoreRows.length ? (
              <div className="space-y-3">
                {scoreRows.map(([key, value]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-700">{key.replace(/_/g, ' ')}</span>
                      <span className="font-bold tabular-nums text-slate-950">{value as number}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-slate-900"
                        style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">Breakdown недоступен для этого отчёта.</p>
            )}
          </Section>

          <Section id="competition" title="Competition Overview">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Видимых конкурентов</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">
                  {report.competition.competitorCount ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Давление</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{pressureLabel(report.competition.pressureLevel)}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {report.competition.notes.map(note => (
                <li key={note} className="text-sm leading-relaxed text-slate-600">{note}</li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="demand-magnets" title="Demand Drivers And Magnets">
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Demand drivers</p>
              <ul className="mt-3 space-y-2">
                {report.demandDrivers.map(driver => (
                  <li key={driver} className="text-sm leading-relaxed text-slate-700">{driver}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Primary magnets</p>
              <div className="mt-3 space-y-2">
                {report.primaryMagnets.map(magnet => (
                  <div key={`${magnet.categoryId}-${magnet.name}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-950">{magnet.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {magnet.categoryId} · {magnet.distanceM != null ? `${magnet.distanceM} м` : 'дистанция недоступна'} · {magnet.source}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{magnet.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Secondary magnets</p>
              <div className="mt-3 space-y-2">
                {report.secondaryMagnets.length ? report.secondaryMagnets.map(magnet => (
                  <div key={`${magnet.categoryId}-${magnet.name}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-950">{magnet.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {magnet.categoryId} · {magnet.distanceM != null ? `${magnet.distanceM} м` : 'дистанция недоступна'}
                    </p>
                  </div>
                )) : (
                  <p className="text-sm text-slate-600">Дополнительные магниты не выделены.</p>
                )}
              </div>
            </div>
          </div>
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section id="audience-fit" title="Target Audience Fit">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Primary audience</p>
              <p className="mt-2 text-xl font-bold capitalize text-slate-950">{report.audienceFit.primaryAudience}</p>
              <p className="mt-1 text-sm text-slate-600">
                score: {report.audienceFit.score ?? '—'} · confidence: {confidenceLabel(report.audienceFit.confidence)}
              </p>
            </div>
            <ul className="mt-4 space-y-2">
              {[...report.audienceFit.drivers, ...report.audienceFit.caveats].map(item => (
                <li key={item} className="text-sm leading-relaxed text-slate-700">{item}</li>
              ))}
            </ul>
          </Section>

          <Section id="income" title="Income Potential">
            <div className="space-y-2">
              {report.incomePotential.estimates.map(estimate => (
                <div
                  key={estimate.strategy}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{estimate.label}</p>
                    <p className="text-xs text-slate-500">{estimate.basis === 'sample' ? 'sample/demo range' : estimate.basis}</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-slate-950">{fmtMoneyRange(estimate)}</p>
                </div>
              ))}
            </div>
            <ul className="mt-4 space-y-2">
              {[...report.incomePotential.assumptions, ...report.incomePotential.limitations].map(item => (
                <li key={item} className="text-xs leading-relaxed text-slate-600">{item}</li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="risks" title="Risks And Limitations">
          <div className="grid gap-3 lg:grid-cols-3">
            {report.risks.map(risk => (
              <div key={risk.title} className={`rounded-lg border p-4 ${severityClass(risk.severity)}`}>
                <p className="text-sm font-bold">{risk.title}</p>
                <p className="mt-2 text-sm leading-relaxed">{risk.description}</p>
                <p className="mt-3 text-xs font-medium">Validate: {risk.validationNeeded}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="recommendations" title="Recommended Strategy">
          <div className="grid gap-3 lg:grid-cols-3">
            {report.recommendations.map(item => (
              <div key={item.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{priorityLabel(item.priority)}</p>
                <p className="mt-2 text-sm font-bold text-slate-950">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.rationale}</p>
                <p className="mt-3 text-xs font-medium text-slate-600">{item.action}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">OTA / channel strategy</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{report.otaChannelStrategyNote}</p>
          </div>
        </Section>

        <Section id="confidence" title="Confidence And Data Quality">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">Why this confidence</p>
              <ul className="mt-3 space-y-2">
                {report.confidence.reasons.map(reason => (
                  <li key={reason} className="text-sm leading-relaxed text-slate-700">{reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Limitations</p>
              <ul className="mt-3 space-y-2">
                {report.confidence.limitations.map(limit => (
                  <li key={limit} className="text-sm leading-relaxed text-slate-700">{limit}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section id="next-steps" title="Next Steps">
          <ol className="grid gap-3 sm:grid-cols-3">
            {report.nextSteps.map((step, index) => (
              <li key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Step {index + 1}</p>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-900">{step}</p>
              </li>
            ))}
          </ol>
        </Section>
      </main>
    </div>
  );
}
