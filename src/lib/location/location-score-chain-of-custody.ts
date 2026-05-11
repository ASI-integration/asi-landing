import type { LocationAnalysis } from './types';
import type { LocationScoringCapApplied } from './location-scoring-trace';
import { publicLocationScore, scoreBandFromPublicScore } from './location-score-public';

/** Audit row for scripts/tests — every public headline must trace to `scoringTrace.finalScore`. */
export interface LocationScoreCustodySnapshot {
  inputAddress: string | undefined;
  coordinates: { lat: number; lon: number } | undefined;
  rawObjectsCount: number | undefined;
  classifiedMagnetsLength: number | undefined;
  scoreFeaturesEvergreenIndex: number | undefined;
  baseScore: number | undefined;
  capsApplied: LocationScoringCapApplied[];
  finalScore: number | undefined;
  /** Must equal `finalScore` when trace exists. */
  publicScoreShown: number;
  /** Score bands for public UI must be derived from this value (= `finalScore`). */
  scoreBandSource: number | undefined;
  uiScoreSource: 'scoringTrace.finalScore' | 'location_score_fallback' | 'none';
}

export function buildLocationScoreCustodySnapshot(analysis: LocationAnalysis): LocationScoreCustodySnapshot {
  const trace = analysis.scoringTrace;
  const finalScore = trace && Number.isFinite(trace.finalScore) ? trace.finalScore : undefined;
  const publicScoreShown = publicLocationScore(analysis);

  let uiScoreSource: LocationScoreCustodySnapshot['uiScoreSource'] = 'none';
  if (trace && Number.isFinite(trace.finalScore)) uiScoreSource = 'scoringTrace.finalScore';
  else if (analysis.locationScore && Number.isFinite(analysis.locationScore.location_score)) {
    uiScoreSource = 'location_score_fallback';
  }

  return {
    inputAddress: trace?.inputAddress,
    coordinates: trace?.coordinates,
    rawObjectsCount: trace?.rawObjectsCount,
    classifiedMagnetsLength: trace?.classifiedMagnets?.length,
    scoreFeaturesEvergreenIndex: trace?.scoreFeatures?.evergreenIndex,
    baseScore: trace?.baseScore,
    capsApplied: trace?.capsApplied ? [...trace.capsApplied] : [],
    finalScore,
    publicScoreShown,
    scoreBandSource: finalScore,
    uiScoreSource,
  };
}

/** Throws when public headline / band diverge from trace custody rules. */
export function assertPublicScoreCustody(analysis: LocationAnalysis): void {
  const trace = analysis.scoringTrace;
  if (!trace) return;
  const snap = buildLocationScoreCustodySnapshot(analysis);
  if (snap.publicScoreShown !== snap.finalScore) {
    throw new Error(
      `location score custody: publicScoreShown (${snap.publicScoreShown}) !== finalScore (${snap.finalScore})`,
    );
  }
  if (snap.scoreBandSource !== snap.finalScore) {
    throw new Error(
      `location score custody: scoreBandSource (${snap.scoreBandSource}) !== finalScore (${snap.finalScore})`,
    );
  }
  const ls = analysis.locationScore?.location_score;
  if (ls !== undefined && ls !== trace.finalScore) {
    throw new Error(
      `location score custody: location_score (${ls}) !== trace.finalScore (${trace.finalScore})`,
    );
  }
  const expectedBand = scoreBandFromPublicScore(trace.finalScore);
  if (analysis.scoreBand !== expectedBand) {
    throw new Error(
      `location score custody: scoreBand (${analysis.scoreBand}) !== band(${expectedBand}) from finalScore ${trace.finalScore}`,
    );
  }
}
