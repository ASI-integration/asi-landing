import { PARTIAL_CARTOGRAPHIC_WARNING_CODES } from '@/lib/location/location-demo-partial-warnings';
import {
  resolveLocationDemoPublicScoreState,
  type LocationDemoPublicScoreState,
} from '@/lib/location/location-demo-public-score-state';
import { LOCATION_DEMO_INCOMPLETE_RU } from '@/lib/location/location-data-integrity';
import type { AnalysisMeta, LocationAnalysis } from '@/lib/location/types';

/** Boundaries for staged RU demo loading copy (ms elapsed since analysis request started). */
export const RU_DEMO_LOADING_STAGE_BOUNDARIES_MS = [10_000, 25_000] as const;

export function ruDemoLoadingStageIndex(elapsedMs: number): 0 | 1 | 2 {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  if (elapsedMs < RU_DEMO_LOADING_STAGE_BOUNDARIES_MS[0]) return 0;
  if (elapsedMs < RU_DEMO_LOADING_STAGE_BOUNDARIES_MS[1]) return 1;
  return 2;
}

export type LocationDemoReportDeferMode = 'residential' | 'commercial';

/**
 * RU demo: when the headline preview is blocked or map data is incomplete without a usable
 * public summary, paid-report CTAs read as misleading — prioritize retry and clarify prerequisites.
 *
 * Note: `locationDecision.publicDrivers` may still contain lines while
 * `scoreBlockedDueToIncompleteData` is true (kernel attaches before presentation gates). Residential
 * must not treat those as “usable” for CTA ordering when the score is blocked.
 */
export function ruDemoDeferPaidReportForMapRetry(args: {
  locale: string;
  meta: AnalysisMeta | null | undefined;
  analysis: LocationAnalysis;
  mode: LocationDemoReportDeferMode;
}): boolean {
  if (args.locale !== 'ru') return false;
  return resolveLocationDemoPublicScoreState({
    meta: args.meta,
    analysis: args.analysis,
    mode: args.mode,
  }).retryRecommended;
}

export function metaHasPartialCartographicWarning(meta: AnalysisMeta | null | undefined): boolean {
  const list = meta?.warnings;
  if (!list?.length) return false;
  return list.some(w => PARTIAL_CARTOGRAPHIC_WARNING_CODES.has(w.code));
}

export function partialCartographicBannerMessage(meta: AnalysisMeta, fallback: string): string {
  const hit = meta.warnings?.find(w => PARTIAL_CARTOGRAPHIC_WARNING_CODES.has(w.code));
  const m = hit?.message?.trim();
  return m ? m : fallback;
}

export interface RuDemoResultCtaSurface {
  title: string | null;
  text: string | null;
  primaryCta: string;
  reportCtaLabel: string | null;
  showRetryCta: boolean;
  showReportCta: boolean;
  showDemoPermalink: boolean;
}

export function resolveRuDemoResultCtaSurface(args: {
  locale: string;
  publicScoreState: Pick<
    LocationDemoPublicScoreState,
    'analysisUsableForPublicScore' | 'reportCtaEligible'
  >;
  partialUsableResult: boolean;
}): RuDemoResultCtaSurface {
  const noUsableRuResult = args.locale === 'ru' && !args.publicScoreState.reportCtaEligible;

  if (noUsableRuResult) {
    return {
      title: 'Анализ не завершён',
      text: LOCATION_DEMO_INCOMPLETE_RU,
      primaryCta: 'Повторить анализ',
      reportCtaLabel: null,
      showRetryCta: true,
      showReportCta: false,
      showDemoPermalink: false,
    };
  }

  const reportCtaLabel =
    args.locale === 'ru'
      ? (args.partialUsableResult ? 'Заказать полный отчёт' : 'Заказать отчёт')
      : 'Request report';

  return {
    title: null,
    text: null,
    primaryCta: reportCtaLabel,
    reportCtaLabel,
    showRetryCta: false,
    showReportCta: true,
    showDemoPermalink: args.locale === 'ru' && args.publicScoreState.analysisUsableForPublicScore,
  };
}
