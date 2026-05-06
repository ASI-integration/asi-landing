import type { LocationScoreOutput, RecommendedStrategy } from './types';
import type {
  LocationDisplayAudience,
  LocationDisplayModel,
  LocationSafeDriver,
} from './location-display-model';

export type LockedField = 'breakdown' | 'full_income' | 'strategy';

/** Income figures, point numbers nulled at low confidence to never present income as guaranteed. */
export type LocationReportIncomeFigures = {
  /** Hybrid strategy point estimate. Null when income_confidence === 'low'. */
  hybrid: number | null;
  /** Recommended strategy point estimate. Null when income_confidence === 'low'. */
  recommended: number | null;
  /** Cautious income range. Always shown when computable. */
  range: { low: number; high: number } | null;
  confidence: 'high' | 'medium' | 'low';
  note: string;
};

export type LocationReportFullIncomeFigures = {
  /** Per-strategy point estimates. All null when income_confidence === 'low'. */
  short_term: number | null;
  hybrid: number | null;
  mid_term: number | null;
  range: { low: number; high: number } | null;
  confidence: 'high' | 'medium' | 'low';
  note: string;
};

/** Canonical display projection of LocationDisplayModel that travels with paywalled responses. */
export type LocationReportDisplay = {
  display_score: number;
  display_audience: LocationDisplayAudience;
  verdict_label_ru: string;
  verdict_tone: 'strong' | 'medium' | 'weak';
  cap_reasons: string[];
  safe_drivers: LocationSafeDriver[];
  residential_sanity_applied: boolean;
};

export type LocationReportPreview = {
  is_preview: true;
  locked_fields: LockedField[];
  /** Public score from LocationDisplayModel.displayScore — never the raw evergreenIndex. */
  location_score: number;
  rating: LocationScoreOutput['rating'];
  display: LocationReportDisplay;
  estimated_monthly_income: LocationReportIncomeFigures;
  /** Public-safe positive drivers — sourced from LocationDisplayModel.safeDrivers, never raw factors. */
  top_positive_factors: string[];
  recommended_strategy: RecommendedStrategy;
};

export type LocationReportFull = {
  is_preview: false;
  /** Public score from LocationDisplayModel.displayScore — never the raw evergreenIndex. */
  location_score: number;
  rating: LocationScoreOutput['rating'];
  display: LocationReportDisplay;
  breakdown: LocationScoreOutput['breakdown'];
  estimated_monthly_income: LocationReportFullIncomeFigures;
  recommended_strategy: RecommendedStrategy;
  /** Public-safe positive drivers — sourced from LocationDisplayModel.safeDrivers, never raw factors. */
  top_positive_factors: string[];
  top_negative_factors: string[];
};

export type LocationReportOutput = LocationReportPreview | LocationReportFull;

/** Cap raw rating so a sanity-clamped displayScore can never expose 'exceptional'/'strong' headlines. */
function ratingFromDisplay(
  rawRating: LocationScoreOutput['rating'],
  display: LocationDisplayModel,
): LocationScoreOutput['rating'] {
  if (display.verdictTone === 'weak') return 'risky';
  if (display.verdictTone === 'medium') {
    return rawRating === 'exceptional' || rawRating === 'strong' ? 'viable' : rawRating;
  }
  return rawRating;
}

function roundIncomeRub(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 5000) * 5000;
}

/**
 * Income figures keyed off LocationDisplayModel.
 * Mirrors buildIncomeRange in standalone-report.ts: at low confidence (displayScore <= 55 or
 * missing object data), point numbers are nulled and only the cautious range is exposed.
 */
function buildPaywallIncome(
  full: LocationScoreOutput,
  display: LocationDisplayModel,
): {
  shared: { range: { low: number; high: number } | null; confidence: 'high' | 'medium' | 'low'; note: string };
  preview: LocationReportIncomeFigures;
  full: LocationReportFullIncomeFigures;
} {
  const recommendedPoint =
    full.recommended_strategy === 'short_term'
      ? full.estimated_monthly_income.short_term
      : full.recommended_strategy === 'mid_term'
        ? full.estimated_monthly_income.mid_term
        : full.estimated_monthly_income.hybrid;

  const isCautiousScore = display.displayScore <= 55;
  const confidence: 'high' | 'medium' | 'low' = isCautiousScore ? 'low' : 'medium';
  const lowMul = isCautiousScore ? 0.55 : 0.65;
  const highMul = isCautiousScore ? 0.9 : 1.1;

  let range: { low: number; high: number } | null = null;
  if (Number.isFinite(recommendedPoint) && recommendedPoint > 0) {
    const low = roundIncomeRub(recommendedPoint * lowMul);
    const high = Math.max(low + 5000, roundIncomeRub(recommendedPoint * highMul));
    range = { low, high };
  }

  const note = isCautiousScore
    ? 'Осторожная доходная вилка: публичный score средний или слабый. Доход трактуем как диапазон, не как гарантию.'
    : 'Доход показан как диапазон с уровнем уверенности, а не как гарантированная сумма.';

  const shared = { range, confidence, note };
  const suppress = confidence === 'low';

  return {
    shared,
    preview: {
      hybrid: suppress ? null : full.estimated_monthly_income.hybrid,
      recommended: suppress ? null : recommendedPoint,
      ...shared,
    },
    full: {
      short_term: suppress ? null : full.estimated_monthly_income.short_term,
      hybrid: suppress ? null : full.estimated_monthly_income.hybrid,
      mid_term: suppress ? null : full.estimated_monthly_income.mid_term,
      ...shared,
    },
  };
}

function displayProjection(d: LocationDisplayModel): LocationReportDisplay {
  return {
    display_score: d.displayScore,
    display_audience: d.displayAudience,
    verdict_label_ru: d.verdictLabelRu,
    verdict_tone: d.verdictTone,
    cap_reasons: d.capReasons,
    safe_drivers: d.safeDrivers,
    residential_sanity_applied: d.residentialSanityApplied,
  };
}

/** Public-safe positive drivers — never reuse raw top_positive_factors as they can name industrial/factory POIs. */
function publicPositiveFactors(d: LocationDisplayModel): string[] {
  return d.safeDrivers
    .filter(s => s.kind === 'positive')
    .map(s => s.labelRu)
    .slice(0, 3);
}

export function toLocationReportPreview(
  full: LocationScoreOutput,
  display: LocationDisplayModel,
): LocationReportPreview {
  const income = buildPaywallIncome(full, display);
  return {
    is_preview: true,
    locked_fields: ['breakdown', 'full_income', 'strategy'],
    location_score: display.displayScore,
    rating: ratingFromDisplay(full.rating, display),
    display: displayProjection(display),
    estimated_monthly_income: income.preview,
    top_positive_factors: publicPositiveFactors(display),
    recommended_strategy: full.recommended_strategy,
  };
}

export function toLocationReportFull(
  full: LocationScoreOutput,
  display: LocationDisplayModel,
): LocationReportFull {
  const income = buildPaywallIncome(full, display);
  return {
    is_preview: false,
    location_score: display.displayScore,
    rating: ratingFromDisplay(full.rating, display),
    display: displayProjection(display),
    breakdown: full.breakdown,
    estimated_monthly_income: income.full,
    recommended_strategy: full.recommended_strategy,
    top_positive_factors: publicPositiveFactors(display),
    top_negative_factors: full.top_negative_factors,
  };
}

export function wrapLocationReport(
  full: LocationScoreOutput,
  isPaid: boolean,
  display: LocationDisplayModel,
): LocationReportOutput {
  return isPaid ? toLocationReportFull(full, display) : toLocationReportPreview(full, display);
}
