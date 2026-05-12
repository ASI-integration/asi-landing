import { PARTIAL_CARTOGRAPHIC_WARNING_CODES } from '@/lib/location/location-demo-partial-warnings';
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

/** Non-empty public driver lines from the kernel-backed summary (headline-only incomplete states have zero rows). */
function ruDemoAnalysisHasUsablePublicDriverLines(analysis: LocationAnalysis): boolean {
  const rows = analysis.locationDecision?.publicSummary?.publicDrivers;
  if (!rows?.length) return false;
  return rows.some(r => typeof r.textRu === 'string' && r.textRu.trim().length > 0);
}

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
  const blockedScore =
    Boolean(args.meta?.scoreBlockedDueToIncompleteData) ||
    Boolean(args.analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData);

  if (args.mode === 'commercial') return blockedScore;

  if (blockedScore) return true;

  const analysisIncomplete = Boolean(args.analysis.analysisIntegrity?.analysisIncomplete);
  const partialMapWarn = metaHasPartialCartographicWarning(args.meta);
  const noUsablePublic = !ruDemoAnalysisHasUsablePublicDriverLines(args.analysis);

  if (analysisIncomplete && partialMapWarn && noUsablePublic) return true;

  return false;
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
