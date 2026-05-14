/**
 * Single place assembling {@link LocationScoringTrace} after magnets exist.
 * Numeric headline is frozen as {@link LocationScoringTrace.finalScore}; report/UI layers mutate only projection fields.
 */

import type {
  EvergreenIndexDiagnostics,
  LocationScoringCapApplied,
  LocationScoringTrace,
} from './location-scoring-trace';
import type {
  MagnetItem,
  LocationScoreOutput,
  NeighborhoodEnvironmentCommercialModifierSnapshot,
} from './types';
import type { TerritorialScoringModifierSnapshot } from './territorial-scoring-modifier';
import { computeLocationScoreFeatures, type LocationScoreComputationInput } from './location-score';
import { EVERGREEN_SOFT_CAP } from './location-scoring-rules';

export function buildLocationScoringTrace(args: {
  inputAddress?: string;
  coordinates: { lat: number; lon: number };
  selectedGeocodeResult?: string | null;
  rawObjectsCount: number;
  magnets: MagnetItem[];
  evergreenDiagnostics?: EvergreenIndexDiagnostics;
  locationScoreInput: LocationScoreComputationInput;
  baseLocationScore: LocationScoreOutput;
  modifier: NeighborhoodEnvironmentCommercialModifierSnapshot;
  territorialModifier?: TerritorialScoringModifierSnapshot;
  headlineLocationScore: LocationScoreOutput;
}): LocationScoringTrace {
  const feats = computeLocationScoreFeatures(args.locationScoreInput);
  const capsApplied: LocationScoringCapApplied[] = [];

  if (args.evergreenDiagnostics?.softCapApplied) {
    capsApplied.push({
      kind: 'evergreen_soft_cap',
      phase: 'evergreen_raw',
      reason: `Сжатие сырой evergreen-линии выше порога ${EVERGREEN_SOFT_CAP.thresholdRaw} (коэффициент ${EVERGREEN_SOFT_CAP.compressionAbove}).`,
      scoreBefore: args.evergreenDiagnostics.rawGravityScoreBeforeSoftCap,
      scoreAfter: args.evergreenDiagnostics.rawGravityScoreAfterSoftCap,
    });
  }

  if (args.modifier.applied) {
    capsApplied.push({
      kind: 'neighborhood_environment_headline',
      phase: 'composite_headline',
      reason: args.modifier.explainRu,
      scoreBefore: args.modifier.baseLocationScore,
      scoreAfter: args.modifier.adjustedLocationScore,
    });
  }

  if (args.territorialModifier?.applied) {
    capsApplied.push({
      kind: 'territorial_signals_headline',
      phase: 'composite_headline',
      reason: args.territorialModifier.explainRu,
      scoreBefore: args.territorialModifier.baseLocationScore,
      scoreAfter: args.territorialModifier.adjustedLocationScore,
    });
  }

  return {
    inputAddress: args.inputAddress,
    coordinates: args.coordinates,
    selectedGeocodeResult: args.selectedGeocodeResult ?? null,
    rawObjectsCount: args.rawObjectsCount,
    classifiedMagnets: args.magnets.map(m => ({
      categoryId: m.categoryId,
      name: m.name,
      distanceM: Math.round(m.distance),
      attractionScore: m.attractionScore,
      strengthClass: m.strengthClass,
    })),
    scoreFeatures: {
      evergreenIndex: feats.evergreenIndex,
      attractionScaled: feats.attractionScaled,
      competitorPressure: feats.competitorPressure,
      magnet_score: feats.magnet_score,
      demand_score: feats.demand_score,
      supply_score: feats.supply_score,
      accessibility_score: feats.accessibility_score,
      audience_fit_score: feats.audience_fit_score,
      seasonality_score: feats.seasonality_score,
    },
    baseScore: args.baseLocationScore.location_score,
    capsApplied,
    finalScore: args.headlineLocationScore.location_score,
    evidence: [],
    publicBullets: [],
    removedPublicBullets: [],
    warnings: [],
  };
}
