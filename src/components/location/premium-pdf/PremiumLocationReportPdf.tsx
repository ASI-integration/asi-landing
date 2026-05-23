import type { PremiumPdfTextField, PremiumPdfViewModel } from '@/lib/location/premium-pdf-view-model';
import {
  PLACEHOLDER_BADGE_RU,
  PREMIUM_PDF_BRAND,
  PREMIUM_PDF_COVER,
  PREMIUM_PDF_PAGE_COUNT,
  PREMIUM_PDF_PAGES,
} from '@/lib/location/premium-pdf-copy';

function PlaceholderBadge() {
  return (
    <span className="premium-pdf-placeholder-badge ml-2 inline-flex shrink-0 rounded-full border border-dashed border-amber-400/80 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
      {PLACEHOLDER_BADGE_RU}
    </span>
  );
}

function PdfText({
  field,
  className = '',
  as: Tag = 'span',
}: {
  field: PremiumPdfTextField;
  className?: string;
  as?: 'p' | 'span';
}) {
  const TagName = Tag;
  return (
    <TagName className={className}>
      {field.value}
      {field.isPlaceholder ? <PlaceholderBadge /> : null}
    </TagName>
  );
}

function PageShell({
  page,
  eyebrow,
  title,
  children,
}: {
  page: number;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="premium-pdf-page" data-page={page}>
      <div className="premium-pdf-page-inner flex min-h-[250mm] flex-col px-1">
        <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-600">{eyebrow}</p>
            <h2 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-slate-950">{title}</h2>
          </div>
          <p className="shrink-0 pt-1 text-xs font-medium tabular-nums text-slate-500">
            {page} / {PREMIUM_PDF_PAGE_COUNT}
          </p>
        </header>
        <div className="mt-8 flex-1 space-y-6">{children}</div>
        <footer className="mt-10 border-t border-slate-100 pt-4 text-[11px] leading-relaxed text-slate-500">
          <span>{PREMIUM_PDF_BRAND}</span>
          <span className="mx-2 text-slate-300">·</span>
          <span>{title}</span>
        </footer>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  suffix,
  tone = 'indigo',
  isPlaceholder = false,
  compact = false,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: 'indigo' | 'emerald' | 'violet' | 'amber';
  isPlaceholder?: boolean;
  compact?: boolean;
}) {
  const toneClasses = {
    indigo: 'border-indigo-100 bg-gradient-to-br from-indigo-50 to-white',
    emerald: 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white',
    violet: 'border-violet-100 bg-gradient-to-br from-violet-50 to-white',
    amber: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white',
  }[tone];

  return (
    <div className={`premium-pdf-avoid-break rounded-2xl border ${compact ? 'p-4' : 'p-5'} ${toneClasses}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 font-bold tabular-nums leading-none text-slate-950 ${compact ? 'text-2xl' : 'text-3xl'}`}>
        {value}
        {suffix ? <span className="text-lg font-semibold text-slate-500">{suffix}</span> : null}
        {isPlaceholder ? <PlaceholderBadge /> : null}
      </p>
    </div>
  );
}

function InfoCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`premium-pdf-avoid-break rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      <p className="text-[15px] font-bold text-slate-950">{title}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: PremiumPdfTextField[] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-500">Нет данных для отображения.</p>;
  }
  return (
    <ul className="space-y-3.5">
      {items.map((item, index) => (
        <li key={`${item.value}-${index}`} className="flex gap-3 text-[15px] leading-relaxed text-slate-800">
          <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
          <PdfText field={item} as="span" />
        </li>
      ))}
    </ul>
  );
}

function CoverMetaCard({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`premium-pdf-avoid-break rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-sm ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-100/85">{label}</p>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-white">{value}</p>
    </div>
  );
}

function ScoreDimensionRow({
  dim,
}: {
  dim: { id: string; labelRu: string; score: number; isPlaceholder: boolean };
}) {
  return (
    <div className="premium-pdf-avoid-break">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">
          {dim.labelRu}
          {dim.isPlaceholder ? <PlaceholderBadge /> : null}
        </span>
        <span className="font-bold tabular-nums text-slate-950">{dim.score}</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          style={{ width: `${Math.max(0, Math.min(100, dim.score))}%` }}
        />
      </div>
    </div>
  );
}

function AudiencePills({ items }: { items: PremiumPdfTextField[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <li
          key={`${item.value}-${index}`}
          className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-900"
        >
          {item.value}
          {item.isPlaceholder ? (
            <span className="ml-1 text-[10px] uppercase text-amber-700">· {PLACEHOLDER_BADGE_RU}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CoverScoreBlock({ score, recommendation }: { score: number; recommendation: PremiumPdfTextField }) {
  return (
    <div className="premium-pdf-avoid-break mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-end gap-4">
        <p className="text-[72px] font-bold leading-none tabular-nums tracking-tight text-white">{score}</p>
        <div className="pb-2">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-indigo-100/90">из 100</p>
          <p className="mt-1 text-sm text-indigo-100/80">итоговый балл</p>
        </div>
      </div>
      <div className="max-w-md rounded-2xl border border-white/25 bg-white/10 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-100/85">Рекомендация</p>
        <PdfText field={recommendation} className="mt-2 text-lg font-semibold leading-snug text-white" as="p" />
      </div>
    </div>
  );
}

export function PremiumLocationReportPdf({ model }: { model: PremiumPdfViewModel }) {
  return (
    <div className="premium-location-report-pdf bg-slate-100 text-slate-950">
      <section className="premium-pdf-page premium-pdf-cover" data-page={1}>
        <div className="premium-pdf-page-inner relative flex min-h-[250mm] flex-col overflow-hidden bg-gradient-to-br from-indigo-700 via-violet-700 to-slate-900 p-10 text-white">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-violet-400/20 blur-3xl" />
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-100/90">{PREMIUM_PDF_BRAND}</p>
            <p className="mt-8 inline-flex rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]">
              {model.cover.reportKindLabel || PREMIUM_PDF_COVER.reportKindPaid}
            </p>
            <h1 className="mt-6 max-w-2xl text-[44px] font-bold leading-[1.08] tracking-tight">{model.cover.title}</h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-indigo-100/95">{model.cover.subtitle}</p>
            <CoverScoreBlock
              score={model.cover.score.value}
              recommendation={model.cover.recommendationLabel}
            />
          </div>
          <div className="relative z-10 mt-auto grid gap-4 pt-10 sm:grid-cols-2">
            <CoverMetaCard label="Адрес объекта" value={model.address} className="sm:col-span-2" />
            <CoverMetaCard label="Дата расчёта" value={model.calculatedAtRu} />
            <CoverMetaCard label="Номер отчёта" value={model.reportId} />
            {model.location.coordinatesLabel ? (
              <CoverMetaCard label="Координаты" value={model.location.coordinatesLabel.value} className="sm:col-span-2" />
            ) : null}
            {model.location.mapUnavailableNotice ? (
              <div className="premium-pdf-avoid-break sm:col-span-2 rounded-2xl border border-amber-200/50 bg-amber-500/20 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100">Карта недоступна</p>
                <PdfText
                  field={model.location.mapUnavailableNotice}
                  className="mt-2 text-sm font-medium leading-relaxed text-amber-50"
                  as="p"
                />
              </div>
            ) : null}
          </div>
          <p className="relative z-10 mt-8 max-w-2xl text-xs leading-relaxed text-indigo-100/75">{model.cover.disclaimerRu}</p>
        </div>
      </section>

      <PageShell page={2} eyebrow={PREMIUM_PDF_PAGES.summary.eyebrow} title={PREMIUM_PDF_PAGES.summary.title}>
        <InfoCard title={PREMIUM_PDF_PAGES.summary.conclusionTitle}>
          <PdfText field={model.summary.conclusion} className="text-[17px] font-semibold leading-relaxed text-slate-900" as="p" />
        </InfoCard>
        <div className="grid gap-5 lg:grid-cols-2">
          <InfoCard title={PREMIUM_PDF_PAGES.summary.strengthsTitle}>
            <BulletList items={model.summary.strengths} />
          </InfoCard>
          <InfoCard title={PREMIUM_PDF_PAGES.summary.risksTitle}>
            <BulletList items={model.summary.mainRisks} />
          </InfoCard>
        </div>
        <InfoCard title={PREMIUM_PDF_PAGES.summary.audienceTitle}>
          <PdfText field={model.summary.audienceSummary} className="text-[15px] leading-relaxed text-slate-700" as="p" />
          <div className="mt-4">
            <AudiencePills items={model.summary.suitableFor} />
          </div>
        </InfoCard>
      </PageShell>

      <PageShell page={3} eyebrow={PREMIUM_PDF_PAGES.transport.eyebrow} title={PREMIUM_PDF_PAGES.transport.title}>
        <InfoCard title={PREMIUM_PDF_PAGES.transport.linesTitle}>
          <BulletList items={model.transport.lines} />
        </InfoCard>
        {model.transport.balanceNote ? (
          <InfoCard title={PREMIUM_PDF_PAGES.transport.balanceTitle}>
            <PdfText field={model.transport.balanceNote} className="text-[15px] leading-relaxed text-slate-700" as="p" />
          </InfoCard>
        ) : null}
        {model.location.mapUnavailableNotice ? (
          <div className="premium-pdf-avoid-break rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm font-bold text-amber-900">Карта в отчёте недоступна</p>
            <PdfText field={model.location.mapUnavailableNotice} className="mt-2 text-sm leading-relaxed text-amber-900/90" as="p" />
          </div>
        ) : null}
      </PageShell>

      <PageShell page={4} eyebrow={PREMIUM_PDF_PAGES.magnets.eyebrow} title={PREMIUM_PDF_PAGES.magnets.title}>
        <div className="grid gap-5 lg:grid-cols-2">
          <InfoCard title={PREMIUM_PDF_PAGES.magnets.primaryTitle}>
            <BulletList items={model.magnets.primary} />
          </InfoCard>
          {model.magnets.secondary.length ? (
            <InfoCard title={PREMIUM_PDF_PAGES.magnets.secondaryTitle}>
              <BulletList items={model.magnets.secondary} />
            </InfoCard>
          ) : null}
        </div>
        {model.magnets.insight ? (
          <p className="premium-pdf-avoid-break rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-relaxed text-slate-600">
            <PdfText field={model.magnets.insight} as="span" />
          </p>
        ) : null}
      </PageShell>

      <PageShell page={5} eyebrow={PREMIUM_PDF_PAGES.demand.eyebrow} title={PREMIUM_PDF_PAGES.demand.title}>
        <InfoCard title={PREMIUM_PDF_PAGES.demand.explanationTitle}>
          <PdfText field={model.demand.explanation} className="text-[15px] leading-relaxed text-slate-700" as="p" />
        </InfoCard>
        <InfoCard title={PREMIUM_PDF_PAGES.demand.segmentsTitle}>
          <AudiencePills items={model.demand.suitableFor} />
        </InfoCard>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label={PREMIUM_PDF_PAGES.demand.incomeTitle}
            value={model.demand.monthlyIncomeLabel.value}
            tone="emerald"
            isPlaceholder={model.demand.monthlyIncomeLabel.isPlaceholder}
          />
          <StatCard
            label={PREMIUM_PDF_PAGES.demand.strategyTitle}
            value={model.demand.strategyLabel.value}
            tone="violet"
            isPlaceholder={model.demand.strategyLabel.isPlaceholder}
          />
        </div>
      </PageShell>

      <PageShell page={6} eyebrow={PREMIUM_PDF_PAGES.score.eyebrow} title={PREMIUM_PDF_PAGES.score.title}>
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <StatCard
              label={PREMIUM_PDF_PAGES.score.overallLabel}
              value={model.score.overall.value}
              suffix=" / 100"
              tone="indigo"
              isPlaceholder={model.score.overall.isPlaceholder}
            />
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label={PREMIUM_PDF_PAGES.score.competitionTitle}
                value={model.score.competitionPressure.value}
                tone="amber"
                compact
                isPlaceholder={model.score.competitionPressure.isPlaceholder}
              />
              <StatCard
                label="Объектов рядом"
                value={model.score.competitorCount.value}
                tone="amber"
                compact
                isPlaceholder={model.score.competitorCount.isPlaceholder}
              />
            </div>
          </div>
          <div className="lg:col-span-3">
            <InfoCard title={PREMIUM_PDF_PAGES.score.dimensionsTitle}>
              <div className="space-y-4">
                {model.score.dimensions.map(dim => (
                  <ScoreDimensionRow key={dim.id} dim={dim} />
                ))}
              </div>
            </InfoCard>
          </div>
        </div>
        {model.revenueScenarios.length ? (
          <InfoCard title="Сценарии дохода">
            <div className="grid gap-3 sm:grid-cols-3">
              {model.revenueScenarios.map(scenario => (
                <div
                  key={scenario.id}
                  className={`premium-pdf-avoid-break rounded-xl border p-4 text-sm ${
                    scenario.id === 'base' ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <p className="font-bold text-slate-950">{scenario.titleRu}</p>
                  <p className="mt-3 text-slate-700">
                    Загрузка: <span className="font-semibold">{scenario.occupancyLabelRu}</span>
                  </p>
                  <p className="mt-2 text-slate-700">
                    Цена за ночь: <span className="font-semibold">{scenario.nightlyRateLabelRu}</span>
                  </p>
                  <p className="mt-2 text-slate-700">
                    Доход: <span className="font-semibold">{scenario.monthlyRevenueLabelRu}</span>
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-slate-600">{scenario.conditionRu}</p>
                </div>
              ))}
            </div>
          </InfoCard>
        ) : null}
      </PageShell>

      <PageShell page={7} eyebrow={PREMIUM_PDF_PAGES.urban.eyebrow} title={PREMIUM_PDF_PAGES.urban.title}>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label={PREMIUM_PDF_PAGES.urban.forecastLabel}
            value={model.urban.forecastScore.value}
            suffix=" / 100"
            tone="violet"
            compact
            isPlaceholder={model.urban.forecastScore.isPlaceholder}
          />
          <StatCard
            label={PREMIUM_PDF_PAGES.urban.levelLabel}
            value={model.urban.levelLabel.value}
            tone="indigo"
            compact
            isPlaceholder={model.urban.levelLabel.isPlaceholder}
          />
          <StatCard
            label={PREMIUM_PDF_PAGES.urban.signalsLabel}
            value={model.urban.signalCount.value}
            tone="emerald"
            compact
            isPlaceholder={model.urban.signalCount.isPlaceholder}
          />
        </div>
        <InfoCard title={PREMIUM_PDF_PAGES.urban.reasonsTitle}>
          <BulletList items={model.urban.reasons} />
          <p className="mt-4 text-xs text-slate-500">
            Уверенность прогноза:{' '}
            <PdfText field={model.urban.confidenceLabel} as="span" className="inline font-medium text-slate-700" />
          </p>
        </InfoCard>
        {model.futureDevelopmentSlots.length ? (
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-950">Сигналы развития района</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {model.futureDevelopmentSlots.map(slot => (
                <div key={slot.id} className="premium-pdf-avoid-break rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <p className="font-bold text-slate-950">{slot.titleRu}</p>
                  <ul className="mt-3 space-y-2">
                    {slot.items.map((item, index) => (
                      <li
                        key={`${slot.id}-${index}`}
                        className={`leading-relaxed ${item.isPlaceholder ? 'italic text-slate-500' : 'text-slate-700'}`}
                      >
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {model.urban.disclaimerRu ? (
          <p className="premium-pdf-avoid-break rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">
            {model.urban.disclaimerRu}
          </p>
        ) : null}
      </PageShell>

      <PageShell page={8} eyebrow={PREMIUM_PDF_PAGES.risks.eyebrow} title={PREMIUM_PDF_PAGES.risks.title}>
        <div className="grid gap-5 lg:grid-cols-5">
          <InfoCard className="lg:col-span-3" title={PREMIUM_PDF_PAGES.risks.risksTitle}>
            <BulletList items={model.risks.items} />
          </InfoCard>
          <InfoCard className="lg:col-span-2" title={PREMIUM_PDF_PAGES.risks.confidenceTitle}>
            <StatCard
              label="Уровень уверенности"
              value={model.risks.confidenceLabel.value}
              tone="indigo"
              compact
              isPlaceholder={model.risks.confidenceLabel.isPlaceholder}
            />
            <ul className="mt-4 space-y-3">
              {model.risks.confidenceNotes.map((note, index) => (
                <li key={`${note.value}-${index}`} className="text-sm leading-relaxed text-slate-600">
                  <PdfText field={note} as="span" />
                </li>
              ))}
            </ul>
          </InfoCard>
        </div>
        <div className="premium-pdf-avoid-break rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {PREMIUM_PDF_PAGES.risks.recommendationsTitle}
          </p>
          <PdfText field={model.recommendations.verdict} className="mt-3 text-xl font-bold leading-snug text-slate-950" as="p" />
          <PdfText field={model.recommendations.action} className="mt-3 text-sm leading-relaxed text-slate-700" as="p" />
          <p className="mt-6 text-sm font-bold text-slate-950">{PREMIUM_PDF_PAGES.risks.stepsTitle}</p>
          <ol className="mt-4 space-y-3.5">
            {model.recommendations.steps.map((step, index) => (
              <li key={`${step.value}-${index}`} className="flex gap-3 text-[15px] leading-relaxed text-slate-800">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <PdfText field={step} as="span" />
              </li>
            ))}
          </ol>
        </div>
      </PageShell>
    </div>
  );
}
