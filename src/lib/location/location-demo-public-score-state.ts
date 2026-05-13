import type { LocationPublicSummary } from './location-decision-contract';
import { metaWarningsIndicatePartialCartography } from './location-demo-partial-warnings';
import type { AnalysisMeta, LocationAnalysis } from './types';

export type LocationDemoPublicScoreMode = 'residential' | 'commercial';

export interface LocationDemoPublicScoreState {
  analysisUsableForPublicScore: boolean;
  reportCtaEligible: boolean;
  retryRecommended: boolean;
  noDataReason: string | null;
}

export function locationDemoPublicSummaryHasUsableDriverLines(
  summary: LocationPublicSummary | null | undefined,
): boolean {
  const rows = summary?.publicDrivers;
  if (!rows?.length) return false;
  return rows.some(r => typeof r.textRu === 'string' && r.textRu.trim().length > 0);
}

export function locationDemoAnalysisHasUsablePublicSummary(analysis: LocationAnalysis): boolean {
  return locationDemoPublicSummaryHasUsableDriverLines(analysis.locationDecision?.publicSummary);
}

export function resolveLocationDemoPublicScoreState(args: {
  meta: AnalysisMeta | null | undefined;
  analysis: LocationAnalysis;
  mode: LocationDemoPublicScoreMode;
  hasUsablePublicSummary?: boolean;
}): LocationDemoPublicScoreState {
  const scoreBlocked =
    Boolean(args.meta?.scoreBlockedDueToIncompleteData) ||
    Boolean(args.analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData);
  const analysisIncomplete =
    Boolean(args.meta?.analysisIncomplete) ||
    Boolean(args.analysis.analysisIntegrity?.analysisIncomplete);
  const partialMapWarning = metaWarningsIndicatePartialCartography(args.meta?.warnings);
  const hasUsablePublicSummary =
    args.hasUsablePublicSummary ?? locationDemoAnalysisHasUsablePublicSummary(args.analysis);

  const residentialNoUsablePublicSummary =
    args.mode === 'residential' &&
    analysisIncomplete &&
    partialMapWarning &&
    !hasUsablePublicSummary;

  const noDataReason = scoreBlocked
    ? args.analysis.analysisIntegrity?.reasons?.[0] ?? 'score_blocked_due_to_incomplete_data'
    : residentialNoUsablePublicSummary
      ? 'no_usable_public_summary'
      : null;

  const analysisUsableForPublicScore = !scoreBlocked && !residentialNoUsablePublicSummary;

  return {
    analysisUsableForPublicScore,
    reportCtaEligible: analysisUsableForPublicScore,
    retryRecommended: !analysisUsableForPublicScore,
    noDataReason,
  };
}
