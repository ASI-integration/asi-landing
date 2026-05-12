import type { AnalysisMeta } from '@/lib/location/types';

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
> = new Set(['partial_result', 'overpass_timeout', 'geocode_timeout']);

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
