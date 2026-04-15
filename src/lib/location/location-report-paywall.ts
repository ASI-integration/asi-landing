import type { LocationScoreOutput, RecommendedStrategy } from './types';

export type LockedField = 'breakdown' | 'full_income' | 'strategy';

export type LocationReportPreview = {
  is_preview: true;
  locked_fields: LockedField[];
  location_score: number;
  rating: LocationScoreOutput['rating'];
  estimated_monthly_income: {
    hybrid: number;
    /** Preview shows a single ориентир for the recommended scenario. */
    recommended: number;
  };
  top_positive_factors: string[];
  recommended_strategy: RecommendedStrategy;
};

export type LocationReportFull = {
  is_preview: false;
  location_score: number;
  rating: LocationScoreOutput['rating'];
  breakdown: LocationScoreOutput['breakdown'];
  estimated_monthly_income: LocationScoreOutput['estimated_monthly_income'];
  recommended_strategy: RecommendedStrategy;
  top_positive_factors: string[];
  top_negative_factors: string[];
};

export type LocationReportOutput = LocationReportPreview | LocationReportFull;

export function toLocationReportPreview(full: LocationScoreOutput): LocationReportPreview {
  const positives = Array.isArray(full.top_positive_factors) ? full.top_positive_factors : [];
  const recommendedIncome =
    full.recommended_strategy === 'short_term'
      ? full.estimated_monthly_income.short_term
      : full.recommended_strategy === 'mid_term'
        ? full.estimated_monthly_income.mid_term
        : full.estimated_monthly_income.hybrid;
  return {
    is_preview: true,
    locked_fields: ['breakdown', 'full_income', 'strategy'],
    location_score: full.location_score,
    rating: full.rating,
    estimated_monthly_income: {
      hybrid: full.estimated_monthly_income.hybrid,
      recommended: recommendedIncome,
    },
    top_positive_factors: positives.slice(0, 3),
    recommended_strategy: full.recommended_strategy,
  };
}

export function toLocationReportFull(full: LocationScoreOutput): LocationReportFull {
  return {
    is_preview: false,
    location_score: full.location_score,
    rating: full.rating,
    breakdown: full.breakdown,
    estimated_monthly_income: full.estimated_monthly_income,
    recommended_strategy: full.recommended_strategy,
    top_positive_factors: full.top_positive_factors,
    top_negative_factors: full.top_negative_factors,
  };
}

export function wrapLocationReport(full: LocationScoreOutput, isPaid: boolean): LocationReportOutput {
  return isPaid ? toLocationReportFull(full) : toLocationReportPreview(full);
}

