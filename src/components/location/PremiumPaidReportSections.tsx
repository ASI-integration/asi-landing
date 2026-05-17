import type { PremiumPaidReportContent } from '@/lib/location/premium-paid-report-content';
import {
  PREMIUM_PAID_SECTION_ANCHORS,
  PREMIUM_PAID_SECTION_TITLES_RU,
} from '@/lib/location/premium-paid-report-content';

function OwnerHint({ children }: { children: string }) {
  return (
    <p className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-sm leading-relaxed text-indigo-100/90">
      <span className="font-semibold text-indigo-200">Для владельца: </span>
      {children}
    </p>
  );
}

function PremiumSectionShell({
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
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Платный раздел</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
          {lead ? <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">{lead}</p> : null}
        </div>
        
        <div className="px-6 sm:px-8 py-6 sm:py-7">{children}</div>
      </div>
    </section>
  );
}

export function PremiumPaidReportSections({ content }: { content: PremiumPaidReportContent }) {
  const {
    executiveSummary,
    audienceFit,
    primeDemandMagnets,
    competitionAnalysis,
    revenueScenarios,
    futureAreaDevelopment,
    risks,
    launchStrategy,
    finalRecommendation,
  } = content;

  return (
    <>
      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.executiveSummary}
        title={PREMIUM_PAID_SECTION_TITLES_RU.executiveSummary}
        lead="Главный ответ по адресу — без формул и внутренних расчётов."
      >
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
          <p className="text-xl font-semibold text-white leading-snug">{executiveSummary.headlineRu}</p>
          <ul className="mt-4 space-y-2">
            {executiveSummary.bulletsRu.map(line => (
              <li key={line} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <OwnerHint>{executiveSummary.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.audienceFit}
        title={PREMIUM_PAID_SECTION_TITLES_RU.audienceFit}
        lead="Кто с большей вероятностью забронирует жильё в этой точке."
      >
        <div className="flex flex-wrap gap-2">
          {audienceFit.suitableForRu.map(item => (
            <span
              key={item}
              className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-sm text-indigo-100"
            >
              {item}
            </span>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-200 leading-relaxed">{audienceFit.explanationRu}</p>
        <OwnerHint>{audienceFit.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.primeMagnets}
        title={PREMIUM_PAID_SECTION_TITLES_RU.primeMagnets}
        lead="Точки, из-за которых люди ищут жильё рядом с вами."
      >
        {primeDemandMagnets.primaryLinesRu.length ? (
          <ul className="space-y-2">
            {primeDemandMagnets.primaryLinesRu.map(line => (
              <li key={line} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Сильные магниты в пешей зоне не найдены — спрос нужно подтверждать вручную.</p>
        )}
        {primeDemandMagnets.secondaryLinesRu.length ? (
          <div className="mt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Дополнительно</p>
            <ul className="mt-2 space-y-2">
              {primeDemandMagnets.secondaryLinesRu.map(line => (
                <li key={line} className="text-sm text-slate-400 leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <OwnerHint>{primeDemandMagnets.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.competition}
        title={PREMIUM_PAID_SECTION_TITLES_RU.competition}
        lead="Сколько похожих объектов рядом и насколько тяжело выделиться."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Объектов рядом</p>
            <p className="mt-2 text-3xl font-bold text-white tabular-nums">{competitionAnalysis.competitorCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Давление</p>
            <p className="mt-2 text-2xl font-bold capitalize text-white">{competitionAnalysis.pressureLabelRu}</p>
          </div>
        </div>
        {competitionAnalysis.notesRu.length ? (
          <ul className="mt-5 space-y-2">
            {competitionAnalysis.notesRu.map(note => (
              <li key={note} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <OwnerHint>{competitionAnalysis.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.revenueScenarios}
        title={PREMIUM_PAID_SECTION_TITLES_RU.revenueScenarios}
        lead="Три простых сценария — осторожный, рабочий и удачный запуск."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {revenueScenarios.map(scenario => (
            <div
              key={scenario.id}
              className={`rounded-2xl border p-5 ${scenario.id === 'base' ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-slate-800/70 bg-slate-950/30'}`}
            >
              <p className="text-sm font-bold text-white">{scenario.titleRu}</p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Загрузка</dt>
                  <dd className="font-semibold text-slate-100">{scenario.occupancyLabelRu}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Средняя цена за ночь</dt>
                  <dd className="font-semibold text-slate-100">{scenario.nightlyRateLabelRu}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Доход в месяц (оценка)</dt>
                  <dd className="font-semibold text-white tabular-nums">{scenario.monthlyRevenueLabelRu}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Когда сценарий реалистичен</dt>
                  <dd className="text-slate-300 leading-relaxed">{scenario.conditionRu}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-slate-400 leading-relaxed">{scenario.ownerMeaningRu}</p>
            </div>
          ))}
        </div>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.futureDevelopment}
        title={PREMIUM_PAID_SECTION_TITLES_RU.futureDevelopment}
        lead="Что может изменить район в ближайшие годы — ключевое преимущество полного отчёта."
      >
        <p className="text-sm text-slate-200 leading-relaxed">{futureAreaDevelopment.summaryRu}</p>
        {futureAreaDevelopment.forecastScore != null ? (
          <p className="mt-3 text-sm text-slate-400">
            Индикатор изменений: {futureAreaDevelopment.forecastScore}
            {futureAreaDevelopment.forecastLevelRu
              ? ` · ожидаемый эффект ${futureAreaDevelopment.forecastLevelRu}`
              : ''}
          </p>
        ) : null}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {futureAreaDevelopment.slots.map(slot => (
            <div key={slot.id} className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
              <p className="text-sm font-semibold text-white">{slot.titleRu}</p>
              <ul className="mt-3 space-y-2">
                {slot.items.map(item => (
                  <li
                    key={`${slot.id}-${item.text}`}
                    className={`text-sm leading-relaxed ${item.isPlaceholder ? 'text-slate-500 italic' : 'text-slate-300'}`}
                  >
                    {item.text}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500 leading-relaxed">{slot.ownerMeaningRu}</p>
            </div>
          ))}
        </div>
        <OwnerHint>{futureAreaDevelopment.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.risks}
        title={PREMIUM_PAID_SECTION_TITLES_RU.risks}
        lead="Что модель не видит сама — проверьте до вложений."
      >
        <ul className="space-y-2">
          {risks.itemsRu.map(item => (
            <li key={item} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <OwnerHint>{risks.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.launchStrategy}
        title={PREMIUM_PAID_SECTION_TITLES_RU.launchStrategy}
        lead="Практические шаги на первые недели после решения о запуске."
      >
        <ol className="space-y-3">
          {launchStrategy.stepsRu.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-200">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <OwnerHint>{launchStrategy.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>

      <PremiumSectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.finalRecommendation}
        title={PREMIUM_PAID_SECTION_TITLES_RU.finalRecommendation}
        lead="Итог: делать, отложить или зайти осторожно."
      >
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-6">
          <p className="text-lg font-semibold text-white leading-snug">{finalRecommendation.verdictRu}</p>
          <p className="mt-4 text-sm text-slate-200 leading-relaxed">{finalRecommendation.actionRu}</p>
        </div>
        <OwnerHint>{finalRecommendation.ownerMeaningRu}</OwnerHint>
      </PremiumSectionShell>
    </>
  );
}
