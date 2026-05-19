import type { PremiumCommercialRetailContent } from '@/lib/location/premium-paid-report-content';
import {
  PREMIUM_COMMERCIAL_SECTION_TITLES_RU,
  PREMIUM_PAID_SECTION_ANCHORS,
} from '@/lib/location/premium-paid-report-content';
import {
  COMMERCIAL_REPORT_SEGMENT_BADGE_RU,
  COMMERCIAL_REPORT_SEGMENT_INTRO_RU,
} from '@/lib/location/location-report-structure';
import { ReportSegmentGroup } from '@/components/location/ReportSegmentGroup';

function OwnerHint({ children }: { children: string }) {
  return (
    <p className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-sm leading-relaxed text-indigo-100/90">
      <span className="font-semibold text-indigo-200">Для владельца: </span>
      {children}
    </p>
  );
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
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Коммерция и ритейл</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
          {lead ? <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">{lead}</p> : null}
        </div>
        <div className="px-6 sm:px-8 py-6 sm:py-7">{children}</div>
      </div>
    </section>
  );
}

export function PremiumCommercialRetailReportSections({
  commercial,
}: {
  commercial: PremiumCommercialRetailContent;
}) {
  return (
    <ReportSegmentGroup
      id="segment-commercial"
      badgeRu={COMMERCIAL_REPORT_SEGMENT_BADGE_RU}
      introRu={COMMERCIAL_REPORT_SEGMENT_INTRO_RU}
    >
      <SectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.commercialPotential}
        title={PREMIUM_COMMERCIAL_SECTION_TITLES_RU.commercialPotential}
        lead="Отдельная оценка для коммерческих помещений — не смешивается с выводом по жилью и посуточной аренде."
      >
        <p className="text-lg font-semibold text-white">{commercial.commercialPotentialRu}</p>
        <OwnerHint>{commercial.ownerMeaningRu}</OwnerHint>
      </SectionShell>

      <SectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.targetTraffic}
        title={PREMIUM_COMMERCIAL_SECTION_TITLES_RU.targetTraffic}
        lead="Оценка целевого потока в зоне объекта — индекс и тепловая карта, без почасового подсчёта пешеходов."
      >
        <div className="rounded-xl border border-amber-400/25 bg-amber-950/20 px-4 py-3 text-sm leading-relaxed text-amber-100">
          {commercial.retailTrafficWarningRu}
        </div>
        <p className="mt-4 text-sm font-semibold text-white">{commercial.targetTrafficIndexRu}</p>
        <p className="mt-3 text-sm text-slate-200 leading-relaxed">{commercial.targetTrafficSummaryRu}</p>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">{commercial.heatmapNoteRu}</p>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">{commercial.h3NoteRu}</p>
      </SectionShell>

      <SectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.streetFrontage}
        title={PREMIUM_COMMERCIAL_SECTION_TITLES_RU.streetFrontage}
        lead="Первая линия, вход с улицы и видимость — только при явных данных или с пометкой о ручной проверке."
      >
        <ul className="space-y-2">
          {commercial.frontageLinesRu.map(line => (
            <li key={line} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </SectionShell>

      <SectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.businessFormatFit}
        title={PREMIUM_COMMERCIAL_SECTION_TITLES_RU.businessFormatFit}
        lead="Какие форматы бизнеса лучше сочетаются с потоком и ограничениями помещения."
      >
        {commercial.formatFitLinesRu.length ? (
          <ul className="space-y-4">
            {commercial.formatFitLinesRu.map(entry => (
              <li
                key={entry.labelRu}
                className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{entry.labelRu}</p>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-300">
                    {entry.fitLabelRu}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300 leading-relaxed">{entry.explanationRu}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Недостаточно сигналов для форматной матрицы — нужна проверка на месте.</p>
        )}
      </SectionShell>

      <SectionShell
        id={PREMIUM_PAID_SECTION_ANCHORS.retailConstraints}
        title={PREMIUM_COMMERCIAL_SECTION_TITLES_RU.retailConstraints}
        lead="Этаж, цоколь, ступеньки, видимость и барьеры — что может снизить потенциал street-retail."
      >
        <ul className="space-y-2">
          {commercial.constraintsRu.map(item => (
            <li key={item} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </SectionShell>
    </ReportSegmentGroup>
  );
}
