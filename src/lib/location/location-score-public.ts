import type { LocationDecision } from './location-decision-contract';
import type { LocationAnalysis, ScoreBand } from './types';
import {
  inferPublicScoreConfidence,
  publicScoreLabelRuForConfidence,
  publicScoreNumericRange,
  type PublicScoreConfidence,
} from './location-evidence-anchor';

/** Single public headline number: frozen trace outcome wired to `locationScore.location_score` when trace exists. */
export function publicLocationScore(analysis: LocationAnalysis): number {
  const trace = analysis.scoringTrace;
  if (trace && Number.isFinite(trace.finalScore)) return trace.finalScore;
  return analysis.locationScore?.location_score ?? 0;
}

/** Thresholds aligned with historic evergreen bands — applied to public headline, not internal evergreen feature. */
export function scoreBandFromPublicScore(score: number): ScoreBand {
  if (score >= 70) return 'strong';
  if (score >= 45) return 'medium';
  if (score > 0) return 'weak';
  return 'none';
}

export interface PublicScoreRange {
  low: number;
  high: number;
  label: string;
  labelRu: string;
}

export type { PublicScoreConfidence };

export function publicScoreRange(
  score: number | null | undefined,
  options?: { confidence?: PublicScoreConfidence },
): PublicScoreRange | null {
  const confidence = options?.confidence ?? 'sufficient';
  if (confidence !== 'sufficient') {
    return {
      low: 0,
      high: 0,
      label: '',
      labelRu: publicScoreLabelRuForConfidence(confidence, score ?? null),
    };
  }
  const numeric = publicScoreNumericRange(score);
  if (!numeric) return null;
  if (typeof score === 'number' && score < 30) {
    return {
      low: 0,
      high: 0,
      label: '',
      labelRu: 'Предварительный вывод: есть факторы спроса',
    };
  }
  return numeric;
}

export function publicScorePresentationFromDecision(
  decision: LocationDecision | null,
  scoreOverride?: number | null,
): PublicScoreRange | null {
  if (!decision) return publicScoreRange(scoreOverride ?? null);
  const summary = decision.publicSummary;
  if (summary?.publicScoreLabelRu) {
    return {
      low: 0,
      high: 0,
      label: '',
      labelRu: summary.publicScoreLabelRu,
    };
  }
  const score =
    scoreOverride ??
    summary?.finalScore ??
    decision.finalScore ??
    decision.uiProjection?.publicScore ??
    null;
  const confidence =
    summary?.publicScoreConfidence ??
    inferPublicScoreConfidence({
      score: typeof score === 'number' ? score : null,
      partialCartographicPreview: Boolean(summary?.presentationDiagnostics?.partialCartographicPreview),
      analysisIncomplete: decision.dataIntegrity?.analysisIncomplete,
      scoreBlockedDueToIncompleteData: decision.dataIntegrity?.scoreBlockedDueToIncompleteData,
      cityLevelStrategicOnly: Boolean(summary?.presentationDiagnostics?.cityLevelStrategicAnchorOnly),
      strictPublicDriverCount: summary?.publicDrivers.length ?? 0,
      classifiedMagnetCount: decision.rawObjectStats?.classifiedMagnetCount ?? 0,
    });
  return publicScoreRange(score, { confidence });
}
