import type { LocationAnalysis, ScoreBand } from './types';

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

export function publicScoreRange(score: number | null | undefined): PublicScoreRange | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const low = Math.max(0, Math.floor((clamped - 5) / 10) * 10 + 5);
  const high = Math.min(100, low + 10);
  const label = `${low}–${high}%`;
  return {
    low,
    high,
    label,
    labelRu: `Потенциал: ${label}`,
  };
}
