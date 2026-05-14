import { buildResidentialPurchaseExplanation } from './explanation';
import { computeFutureTrajectoryScore } from './future-trajectory-score';
import { classifyPurchaseTerritory } from './territory-purchase-classifier';
import type {
  PurchaseEarlyWarningSignal,
  PurchaseScoreBand,
  PurchaseScoreDimensions,
  PurchaseTerritoryType,
  ResidentialPurchaseScore,
  ResidentialPurchaseScoreInput,
} from './types';

function clampScore(value: number | undefined, fallback = 50): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value as number)));
}

function ratioScore(value: number | undefined, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  const n = value as number;
  return n <= 1 ? clampScore(n * 100, fallback) : clampScore(n, fallback);
}

function weighted(parts: Array<[number, number]>): number {
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) return 50;
  return clampScore(parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight);
}

function positiveSignalTypes(signal: PurchaseEarlyWarningSignal): boolean {
  return signal.impact === 'positive' || signal.impact === 'mixed';
}

function signalConfidenceScore(signal: PurchaseEarlyWarningSignal): number {
  if (signal.confidence === 'high') return 100;
  if (signal.confidence === 'medium') return 65;
  return 35;
}

function scoreFutureUpside(signals: PurchaseEarlyWarningSignal[]): number {
  const positives = signals.filter(positiveSignalTypes);
  if (positives.length === 0) return 30;
  const stacked = positives
    .map(signalConfidenceScore)
    .sort((a, b) => b - a)
    .reduce((sum, value, index) => sum + value * Math.pow(0.58, index), 0);
  return clampScore(stacked);
}

function scoreDeclineRisk(signals: PurchaseEarlyWarningSignal[]): number {
  const negatives = signals.filter(signal => signal.impact === 'negative' || signal.type.includes('risk'));
  if (negatives.length === 0) return 20;
  const stacked = negatives
    .map(signalConfidenceScore)
    .sort((a, b) => b - a)
    .reduce((sum, value, index) => sum + value * Math.pow(0.62, index), 0);
  return clampScore(stacked);
}

function scoreOverbuildingRisk(input: ResidentialPurchaseScoreInput): number {
  const territoryPressure = clampScore(input.territory?.overbuildingPressureScore, 0);
  const signalPressure = input.earlyWarningSignals?.some(signal => signal.type === 'overbuilding_risk')
    ? Math.max(...input.earlyWarningSignals
        .filter(signal => signal.type === 'overbuilding_risk')
        .map(signalConfidenceScore))
    : 0;
  return Math.max(territoryPressure, signalPressure);
}

function territoryBase(type: PurchaseTerritoryType): Partial<PurchaseScoreDimensions> {
  switch (type) {
    case 'dense_urban_core':
      return {
        liquidityScore: 82,
        livingQualityScore: 62,
        infrastructureScore: 82,
        transportScore: 78,
        ecologyScore: 48,
        prestigeLifestyleScore: 60,
        optionalRentalScore: 72,
      };
    case 'premium_low_density_residential':
      return {
        liquidityScore: 74,
        livingQualityScore: 84,
        infrastructureScore: 58,
        transportScore: 56,
        ecologyScore: 82,
        prestigeLifestyleScore: 86,
        optionalRentalScore: 38,
      };
    case 'family_residential':
      return {
        liquidityScore: 70,
        livingQualityScore: 76,
        infrastructureScore: 72,
        transportScore: 60,
        ecologyScore: 64,
        prestigeLifestyleScore: 58,
        optionalRentalScore: 44,
      };
    case 'suburban_commuter_zone':
      return {
        liquidityScore: 56,
        livingQualityScore: 66,
        infrastructureScore: 48,
        transportScore: 52,
        ecologyScore: 70,
        prestigeLifestyleScore: 52,
        optionalRentalScore: 28,
      };
    case 'weak_peripheral_residential':
      return {
        liquidityScore: 36,
        livingQualityScore: 42,
        infrastructureScore: 34,
        transportScore: 34,
        ecologyScore: 52,
        prestigeLifestyleScore: 32,
        optionalRentalScore: 24,
      };
    case 'industrial_or_road_risk_zone':
      return {
        liquidityScore: 38,
        livingQualityScore: 30,
        infrastructureScore: 44,
        transportScore: 58,
        ecologyScore: 24,
        prestigeLifestyleScore: 26,
        optionalRentalScore: 34,
      };
    case 'resort_or_leisure_residential':
      return {
        liquidityScore: 62,
        livingQualityScore: 72,
        infrastructureScore: 48,
        transportScore: 46,
        ecologyScore: 78,
        prestigeLifestyleScore: 68,
        optionalRentalScore: 56,
      };
    case 'no_evidence_uncertain':
      return {
        liquidityScore: 50,
        livingQualityScore: 50,
        infrastructureScore: 50,
        transportScore: 50,
        ecologyScore: 50,
        prestigeLifestyleScore: 50,
        optionalRentalScore: 35,
      };
    case 'mixed_city_residential':
      return {
        liquidityScore: 64,
        livingQualityScore: 62,
        infrastructureScore: 62,
        transportScore: 60,
        ecologyScore: 54,
        prestigeLifestyleScore: 52,
        optionalRentalScore: 46,
      };
  }
}

function computeDimensions(input: ResidentialPurchaseScoreInput): PurchaseScoreDimensions {
  const territory = classifyPurchaseTerritory(input.territory);
  const base = territoryBase(territory.type);
  const t = input.territory;
  const object = input.object;
  const signals = input.earlyWarningSignals ?? [];

  const infrastructureScore = clampScore(t?.socialInfrastructureScore, base.infrastructureScore);
  const transportScore = Math.max(
    clampScore(t?.transportAccessScore, base.transportScore),
    ratioScore(t?.territorialSignals?.transportBalance?.value, 0),
    t?.h3?.businessTravelerSuitability?.hasTransportAccess ? 58 : 0,
  );
  const ecologyScore = weighted([
    [clampScore(t?.greenScore, base.ecologyScore), 0.7],
    [100 - Math.max(clampScore(t?.industrialRiskScore, 0), clampScore(t?.roadNoiseRiskScore, 0)), 0.3],
  ]);
  const livingQualityScore = weighted([
    [clampScore(t?.housingQualityScore, base.livingQualityScore), 0.34],
    [clampScore(t?.safetyScore, base.livingQualityScore), 0.18],
    [ecologyScore, 0.2],
    [infrastructureScore, 0.16],
    [clampScore(object?.buildingQualityScore, base.livingQualityScore), 0.12],
  ]);
  const prestigeLifestyleScore = weighted([
    [clampScore(t?.prestigeScore, base.prestigeLifestyleScore), 0.55],
    [clampScore(t?.housingQualityScore, base.prestigeLifestyleScore), 0.22],
    [ecologyScore, 0.23],
  ]);
  const riskPenalty = clampScore(
    Math.max(
      clampScore(t?.industrialRiskScore, 0),
      clampScore(t?.roadNoiseRiskScore, 0),
      clampScore(object?.priceOverheatScore, 0) * 0.75,
    ),
    0,
  );
  const liquidityScore = weighted([
    [clampScore(object?.resaleDepthScore, base.liquidityScore), 0.26],
    [clampScore(base.liquidityScore, 50), 0.26],
    [transportScore, 0.16],
    [infrastructureScore, 0.16],
    [prestigeLifestyleScore, 0.1],
    [100 - riskPenalty, 0.06],
  ]);
  const futureUpsideScore = scoreFutureUpside(signals);
  const declineRiskScore = Math.max(scoreDeclineRisk(signals), Math.round(riskPenalty * 0.72));
  const overbuildingRiskScore = scoreOverbuildingRisk(input);
  const optionalRentalScore = weighted([
    [clampScore(object?.optionalRentalDemandScore, base.optionalRentalScore), 0.58],
    [clampScore(t?.strBusinessMagnetScore, base.optionalRentalScore), 0.42],
  ]);

  return {
    liquidityScore,
    livingQualityScore,
    infrastructureScore,
    transportScore,
    ecologyScore,
    prestigeLifestyleScore,
    futureUpsideScore,
    declineRiskScore,
    overbuildingRiskScore,
    riskPenalty: Math.max(riskPenalty, Math.round(overbuildingRiskScore * 0.42)),
    optionalRentalScore,
  };
}

function purchaseBand(score: number): PurchaseScoreBand {
  if (score >= 78) return 'very_strong';
  if (score >= 64) return 'strong';
  if (score >= 45) return 'moderate';
  return 'weak';
}

function currentPurchaseScore(dimensions: PurchaseScoreDimensions): number {
  return clampScore(
    dimensions.liquidityScore * 0.24 +
    dimensions.livingQualityScore * 0.22 +
    dimensions.infrastructureScore * 0.13 +
    dimensions.transportScore * 0.11 +
    dimensions.ecologyScore * 0.12 +
    dimensions.prestigeLifestyleScore * 0.1 +
    dimensions.optionalRentalScore * 0.04 -
    dimensions.riskPenalty * 0.14 -
    dimensions.overbuildingRiskScore * 0.06,
  );
}

export function computeResidentialPurchaseScore(
  input: ResidentialPurchaseScoreInput,
): ResidentialPurchaseScore {
  const territory = classifyPurchaseTerritory(input.territory);
  const dimensions = computeDimensions(input);
  const currentScore = currentPurchaseScore(dimensions);
  const trajectory = computeFutureTrajectoryScore({
    currentScore,
    signals: input.earlyWarningSignals,
    horizon: input.horizon,
  });
  const finalScore = clampScore(
    currentScore +
    dimensions.futureUpsideScore * 0.1 -
    dimensions.declineRiskScore * 0.1 -
    dimensions.overbuildingRiskScore * 0.05,
  );
  const explanation = buildResidentialPurchaseExplanation({
    input,
    dimensions,
    territoryType: territory.type,
    trajectoryDirection: trajectory.direction,
    currentScore,
  });

  return {
    version: 'residential-purchase-score-v1',
    territory,
    dimensions,
    currentScore,
    finalScore,
    band: purchaseBand(finalScore),
    trajectory,
    explanation,
  };
}
