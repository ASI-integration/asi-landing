import type { AnalysisMeta, LocationAnalysis } from '@/lib/location/types';

/** Boundaries for staged RU demo loading copy (ms elapsed since analysis request started). */
export const RU_DEMO_LOADING_STAGE_BOUNDARIES_MS = [10_000, 25_000] as const;

export function ruDemoLoadingStageIndex(elapsedMs: number): 0 | 1 | 2 {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  if (elapsedMs < RU_DEMO_LOADING_STAGE_BOUNDARIES_MS[0]) return 0;
  if (elapsedMs < RU_DEMO_LOADING_STAGE_BOUNDARIES_MS[1]) return 1;
  return 2;
}

export const PARTIAL_CARTOGRAPHIC_WARNING_CODES: ReadonlySet<
  NonNullable<AnalysisMeta['warnings']>[number]['code']
> = new Set(['partial_result', 'overpass_timeout', 'geocode_timeout', 'insufficient_data']);

export type LocationDemoReportDeferMode = 'residential' | 'commercial';

/** Non-empty public driver lines from the kernel-backed summary (headline-only incomplete states have zero rows). */
function ruDemoAnalysisHasUsablePublicDriverLines(analysis: LocationAnalysis): boolean {
  const rows = analysis.locationDecision?.publicSummary?.publicDrivers;
  if (!rows?.length) return false;
  return rows.some(r => typeof r.textRu === 'string' && r.textRu.trim().length > 0);
}

/**
 * RU demo: when scoring is blocked *and* there is nothing actionable in `publicDrivers`,
 * paid-report CTAs read as misleading — prioritize retry and clarify prerequisites.
 * Partial `partial_result` with a real preliminary score (`!scoreBlocked`) stays unchanged.
 */
export function ruDemoDeferPaidReportForMapRetry(args: {
  locale: string;
  meta: AnalysisMeta | null | undefined;
  analysis: LocationAnalysis;
  mode: LocationDemoReportDeferMode;
}): boolean {
  if (args.locale !== 'ru') return false;
  const blocked =
    Boolean(args.meta?.scoreBlockedDueToIncompleteData) ||
    Boolean(args.analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData);
  if (!blocked) return false;

  if (args.mode === 'commercial') return true;

  return !ruDemoAnalysisHasUsablePublicDriverLines(args.analysis);
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
