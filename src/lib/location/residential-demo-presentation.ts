import type { LocationAnalysis } from './types';
import { withAdjustedLocationScoreHeadline } from './location-score';
import {
  computeResidentialDemoPresentation,
  type ResidentialDemoSanity,
} from './rules/residential-location-rules';
import { scoreBandFromPublicScore } from './location-score-public';

/**
 * Shallow clone so cached analyses are not mutated when applying demo-only trace caps.
 */
export function cloneAnalysisForResidentialDemoPatch(base: LocationAnalysis): LocationAnalysis {
  const ls = base.locationScore;
  const trace = base.scoringTrace;
  return {
    ...base,
    locationScore: ls ? { ...ls, breakdown: { ...ls.breakdown } } : ls,
    scoringTrace: trace
      ? {
          ...trace,
          capsApplied: [...trace.capsApplied],
          scoreFeatures: { ...trace.scoreFeatures },
          classifiedMagnets: [...trace.classifiedMagnets],
          coordinates: { ...trace.coordinates },
          evidence: [...trace.evidence],
          publicBullets: [...trace.publicBullets],
          removedPublicBullets: [...trace.removedPublicBullets],
          warnings: [...trace.warnings],
        }
      : trace,
  };
}

/**
 * Applies RU residential demo headline guards via trace caps + `finalScore` / `location_score` / `scoreBand`.
 * Idempotent when run twice on the same object.
 */
export function applyResidentialDemoPresentationToAnalysis(
  analysis: LocationAnalysis,
): ResidentialDemoSanity | null {
  if (analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData) return null;
  const trace = analysis.scoringTrace;
  if (!trace || !analysis.locationScore) return null;

  const before = trace.finalScore;
  const { sanity, cappedHeadline } = computeResidentialDemoPresentation(analysis, before);

  if (cappedHeadline !== before) {
    const summaryReason =
      sanity.capReasonsRu.length > 0
        ? sanity.capReasonsRu.join(' ')
        : 'RU residential demo: headline capped for public presentation.';
    trace.capsApplied.push({
      kind: 'ru_residential_demo_presentation',
      phase: 'composite_headline',
      reason: summaryReason,
      scoreBefore: before,
      scoreAfter: cappedHeadline,
    });
    trace.finalScore = cappedHeadline;
    analysis.locationScore = withAdjustedLocationScoreHeadline(analysis.locationScore, cappedHeadline);
    analysis.scoreBand = scoreBandFromPublicScore(cappedHeadline);
  }

  return sanity;
}
