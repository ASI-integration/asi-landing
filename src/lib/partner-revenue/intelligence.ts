import type { AdjustmentReason, PricingProfile } from '@/lib/booking-ops/pricing-intelligence-autopilot';
import type { FeedbackStatus, NightlyRevenueObservation } from './contract';

export type ConfidenceBand = 'low' | 'medium' | 'high';
export type ConfidenceInput = Readonly<{
  profileReady: boolean;
  signals: readonly Readonly<{ source: string; confidenceScore: number; updatedAt: string }>[];
  observation: NightlyRevenueObservation | null;
  historicalSampleSize: number;
  conflictingSignals?: boolean;
  now?: Date;
}>;
export type ConfidenceResult = Readonly<{ confidence: number; confidenceBand: ConfidenceBand; reasonCodes: readonly string[] }>;

const PLACEHOLDER_SOURCE = /(?:^|[_:-])(?:placeholder|synthetic|demo)(?:$|[_:-])/iu;
const round = (value: number, places = 4) => Number(value.toFixed(places));
const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator : null;

export function occupancy(soldInventory: number, availableInventory: number): number | null {
  return ratio(soldInventory, availableInventory);
}
export function adr(realizedRoomRevenue: number, soldInventory: number): number | null {
  return ratio(realizedRoomRevenue, soldInventory);
}
export function revParEquivalent(realizedRoomRevenue: number, availableInventory: number): number | null {
  return ratio(realizedRoomRevenue, availableInventory);
}

export function computeRecommendationConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  let score = input.profileReady ? 0.25 : 0;
  if (input.profileReady) reasons.push('profile_complete'); else reasons.push('profile_incomplete');
  const now = input.now ?? new Date();
  const eligible = input.signals.filter((signal) => {
    if (PLACEHOLDER_SOURCE.test(signal.source)) { reasons.push('synthetic_or_placeholder_signal_excluded'); return false; }
    return true;
  });
  const recent = eligible.filter((signal) => now.getTime() - Date.parse(signal.updatedAt) <= 14 * 86_400_000);
  if (recent.length) {
    score += Math.min(0.25, recent.length * 0.07);
    score += Math.min(0.1, (mean(recent.map((signal) => signal.confidenceScore)) ?? 0) / 1000);
    reasons.push('recent_market_signals');
  } else reasons.push('no_recent_real_market_signals');
  if (input.observation && input.observation.availableInventory > 0) { score += 0.13; reasons.push('inventory_observed'); }
  if (input.observation?.bookingLeadDays != null || input.observation?.bookingsCreated != null) { score += 0.07; reasons.push('booking_pace_available'); }
  if (input.historicalSampleSize >= 90) { score += 0.2; reasons.push('strong_history'); }
  else if (input.historicalSampleSize >= 30) { score += 0.15; reasons.push('usable_history'); }
  else if (input.historicalSampleSize >= 14) { score += 0.08; reasons.push('limited_history'); }
  else reasons.push('insufficient_history');
  if (input.conflictingSignals) { score -= 0.12; reasons.push('conflicting_signals'); }
  score = round(Math.max(0, Math.min(1, score)));
  return Object.freeze({ confidence: score, confidenceBand: score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low', reasonCodes: Object.freeze([...new Set(reasons)]) });
}

export type ShadowRecommendation = Readonly<{
  recommendationRef: string;
  stayDate: string;
  currentPrice: number;
  recommendedPrice: number;
  changeAmount: number;
  changePercent: number | null;
  confidence: number;
  confidenceBand: ConfidenceBand;
  strategy: string;
  reasonCodes: readonly string[];
  adjustmentReasons: readonly AdjustmentReason[];
  guardrails: Readonly<{ minPrice: number; maxPrice: number }>;
  mode: 'shadow';
}>;

export function buildShadowRecommendation(input: {
  recommendationRef: string;
  observation: NightlyRevenueObservation;
  recommendedPrice: number;
  profile: Pick<PricingProfile, 'pricingStrategy' | 'minPrice' | 'maxPrice'>;
  confidence: ConfidenceResult;
  adjustmentReasons: readonly AdjustmentReason[];
}): ShadowRecommendation {
  if (input.profile.minPrice == null || input.profile.maxPrice == null) throw new Error('pricing_not_ready');
  const recommendedPrice = Math.max(input.profile.minPrice, Math.min(input.profile.maxPrice, input.recommendedPrice));
  const changeAmount = round(recommendedPrice - input.observation.currentPrice, 2);
  return Object.freeze({
    recommendationRef: input.recommendationRef, stayDate: input.observation.stayDate,
    currentPrice: input.observation.currentPrice, recommendedPrice, changeAmount,
    changePercent: input.observation.currentPrice > 0 ? round(changeAmount / input.observation.currentPrice, 4) : null,
    confidence: input.confidence.confidence, confidenceBand: input.confidence.confidenceBand,
    strategy: input.profile.pricingStrategy,
    reasonCodes: Object.freeze([...new Set([...input.confidence.reasonCodes, ...input.adjustmentReasons.map((reason) => reason.factor)])]),
    adjustmentReasons: Object.freeze([...input.adjustmentReasons]),
    guardrails: Object.freeze({ minPrice: input.profile.minPrice, maxPrice: input.profile.maxPrice }), mode: 'shadow',
  });
}

export type DataSufficiency = Readonly<{ level: 'insufficient' | 'limited' | 'usable' | 'strong'; missing: readonly string[] }>;
export function classifyDataSufficiency(observations: readonly NightlyRevenueObservation[]): DataSufficiency {
  const eligible = observations.filter((item) => item.availableInventory > 0);
  const occupied = eligible.filter((item) => item.soldInventory > 0).length;
  const missing: string[] = [];
  if (eligible.length < 14) missing.push('at_least_14_eligible_nights');
  if (!occupied) missing.push('occupied_nights');
  if (!eligible.some((item) => item.bookingLeadDays != null)) missing.push('booking_lead_time');
  if (new Set(eligible.map((item) => item.currentPrice)).size < 2) missing.push('price_variation');
  const level = eligible.length < 14 ? 'insufficient' : eligible.length < 30 ? 'limited' : eligible.length < 90 ? 'usable' : 'strong';
  return Object.freeze({ level, missing: Object.freeze(missing) });
}

export type PilotKpis = Readonly<{
  observationCount: number;
  recommendationCoverage: number | null;
  recommendationAcceptanceRate: number | null;
  averageConfidence: number | null;
  highConfidenceCoverage: number | null;
  actualOccupancy: number | null;
  actualADR: number | null;
  actualRevPAR: number | null;
  averageCurrentPrice: number | null;
  averageBookingLeadTime: number | null;
  cancellationRate: number | null;
  averagePriceDelta: number | null;
  percentRecommendationsUp: number | null;
  percentRecommendationsDown: number | null;
  percentRecommendationsUnchanged: number | null;
  confidenceDistribution: Readonly<{ low: number; medium: number; high: number }>;
}>;

export function derivePilotKpis(input: {
  observations: readonly NightlyRevenueObservation[];
  recommendations: readonly Pick<ShadowRecommendation, 'stayDate' | 'currentPrice' | 'recommendedPrice' | 'confidence' | 'confidenceBand'>[];
  feedback?: readonly Readonly<{ status: FeedbackStatus }>[];
}): PilotKpis {
  const inventory = input.observations.reduce((sum, item) => sum + item.availableInventory, 0);
  const sold = input.observations.reduce((sum, item) => sum + item.soldInventory, 0);
  const revenue = input.observations.reduce((sum, item) => sum + item.realizedRoomRevenue, 0);
  const lead = input.observations.flatMap((item) => item.bookingLeadDays == null ? [] : [item.bookingLeadDays]);
  const cancellationRows = input.observations.filter((item) => item.cancellations != null && item.bookingsCreated != null);
  const cancellations = cancellationRows.reduce((sum, item) => sum + (item.cancellations ?? 0), 0);
  const bookingOpportunities = cancellationRows.reduce((sum, item) => sum + (item.bookingsCreated ?? 0) + (item.cancellations ?? 0), 0);
  const deltas = input.recommendations.map((item) => item.recommendedPrice - item.currentPrice);
  const feedback = input.feedback ?? [];
  const distribution = { low: 0, medium: 0, high: 0 };
  input.recommendations.forEach((item) => { distribution[item.confidenceBand] += 1; });
  return Object.freeze({
    observationCount: input.observations.length,
    recommendationCoverage: ratio(input.recommendations.length, input.observations.length),
    recommendationAcceptanceRate: ratio(feedback.filter((item) => item.status === 'accepted').length, feedback.filter((item) => item.status !== 'ignored').length),
    averageConfidence: mean(input.recommendations.map((item) => item.confidence)),
    highConfidenceCoverage: ratio(distribution.high, input.recommendations.length),
    actualOccupancy: occupancy(sold, inventory), actualADR: adr(revenue, sold), actualRevPAR: revParEquivalent(revenue, inventory),
    averageCurrentPrice: mean(input.observations.map((item) => item.currentPrice)), averageBookingLeadTime: mean(lead),
    cancellationRate: ratio(cancellations, bookingOpportunities), averagePriceDelta: mean(deltas),
    percentRecommendationsUp: ratio(deltas.filter((value) => value > 0).length, deltas.length),
    percentRecommendationsDown: ratio(deltas.filter((value) => value < 0).length, deltas.length),
    percentRecommendationsUnchanged: ratio(deltas.filter((value) => value === 0).length, deltas.length),
    confidenceDistribution: Object.freeze(distribution),
  });
}

export function runShadowBacktest(input: Parameters<typeof derivePilotKpis>[0]) {
  const kpis = derivePilotKpis(input);
  const byDate = new Map(input.observations.map((item) => [item.stayDate, item]));
  const deltas = input.recommendations.map((item) => item.recommendedPrice - item.currentPrice);
  const percentageDeltas = input.recommendations.flatMap((item) => item.currentPrice > 0 ? [Math.abs(item.recommendedPrice - item.currentPrice) / item.currentPrice] : []);
  return Object.freeze({
    methodology: 'observed_metrics_and_shadow_price_difference',
    observedMetrics: Object.freeze({ occupancy: kpis.actualOccupancy, adr: kpis.actualADR, revParEquivalent: kpis.actualRevPAR }),
    shadowPriceDifference: Object.freeze({
      coverage: kpis.recommendationCoverage,
      averagePriceDelta: kpis.averagePriceDelta,
      averageAbsolutePriceDelta: mean(deltas.map(Math.abs)),
      averagePercentageDelta: mean(percentageDeltas),
      recommendationsUp: deltas.filter((value) => value > 0).length,
      recommendationsDown: deltas.filter((value) => value < 0).length,
      recommendationsUnchanged: deltas.filter((value) => value === 0).length,
      confidenceCounts: kpis.confidenceDistribution,
    }),
    provenRevenueUplift: null,
    counterfactualStatus: 'NOT_PROVEN' as const,
    dataSufficiency: classifyDataSufficiency(input.observations),
    nights: input.recommendations.map((item) => {
      const actual = byDate.get(item.stayDate);
      return Object.freeze({
        stayDate: item.stayDate, actualPrice: item.currentPrice, shadowRecommendedPrice: item.recommendedPrice,
        delta: item.recommendedPrice - item.currentPrice, confidence: item.confidence, confidenceBand: item.confidenceBand,
        availableInventory: actual?.availableInventory ?? null, soldInventory: actual?.soldInventory ?? null,
        actualOccupancy: actual ? occupancy(actual.soldInventory, actual.availableInventory) : null,
        realizedRoomRevenue: actual?.realizedRoomRevenue ?? null,
        reasonCodes: 'reasonCodes' in item ? item.reasonCodes : [],
        adjustmentReasons: 'adjustmentReasons' in item ? item.adjustmentReasons : [],
        observed: true as const,
      });
    }),
    pilotKpis: kpis,
  });
}
