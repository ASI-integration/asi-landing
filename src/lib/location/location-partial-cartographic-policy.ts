import type { LocationAnalysis } from './types';

const TRACE_NEEDLES = [
  'partial_result',
  'overpass_timeout',
  'geocode_timeout',
  'insufficient_data',
  'osm_sparse_result',
  'analysis_incomplete',
] as const;

/**
 * Best-effort preview degradation (map slow/partial, sparse urban pull, incomplete integrity).
 * API should still pass {@link LocationDecisionBuildInput.partialCartographicPreview} from response meta when available.
 */
export function inferPartialCartographicPreviewFromAnalysis(analysis: LocationAnalysis): boolean {
  const integ = analysis.analysisIntegrity;
  if (integ?.analysisIncomplete) return true;
  if (integ?.scoreBlockedDueToIncompleteData) return true;
  const rw = analysis.scoringTrace?.warnings ?? [];
  return rw.some(w => TRACE_NEEDLES.some(n => w.includes(n)));
}
