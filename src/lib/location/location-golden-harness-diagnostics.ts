/**
 * Extra JSON diagnostics for `npm run location:golden` — not used by UI.
 */

import type { LocationDecision } from './location-decision-contract';
import type { LocationDemandScoredDriver } from './location-scoring-contract';
import type { MagnetItem } from './types';
import type { GeocodeResult } from './providers/types';
import { inferCityScaleFromRuAddress } from './city-scale-from-address';
import { evaluateRuGeocodeCitySanity } from './address-providers/geocode-city-sanity';
import { magnetIndexFromMagnetFactId } from './location-scoring-kernel';

export interface GoldenFixtureExpectations {
  readonly expectedCity?: string;
  readonly expectedRegion?: string;
  readonly expectedProfileExpectation?: string;
}

export interface GoldenHarnessPublicDriverDiag {
  readonly name: string;
  readonly category: string;
  readonly demandType: string | null;
  readonly tier: number;
  readonly contribution: number;
  readonly distanceMeters: number;
  readonly publicDisplayEligible: boolean;
  readonly reason: string;
}

export interface GoldenHarnessRejectedDiag {
  readonly sourceName: string;
  readonly category: string;
  readonly demandType: string | null;
  readonly tier: number;
  readonly distanceMeters: number;
  readonly reason: string;
  readonly contribution: number;
}

export interface GoldenHarnessCaseDiagnostics {
  readonly lat: number | null;
  readonly lon: number | null;
  readonly geocodeDisplayName: string | null;
  readonly requestedCity: string | null;
  readonly geocodeCity: string | null;
  readonly geocodeAdminArea1: string | null;
  readonly geocodeAdminArea2: string | null;
  readonly geocodeSettlement: string | null;
  readonly cityMismatch: boolean;
  readonly mismatchReason: string | null;
  readonly expectedCity?: string;
  readonly expectedRegion?: string;
  readonly expectedProfileExpectation?: string;
  readonly cityPopulationApprox: number | null;
  readonly cityScale: string;
  readonly populationTier: string;
  readonly marketGravityCoefficient: number;
  readonly specialMarketFlags: readonly string[];
  readonly cityScaleInference: string;
  readonly smallCitySparseScoreGuard: {
    readonly applied: boolean;
    readonly reason: string;
    readonly scoreBefore: number;
    readonly scoreAfter: number;
  } | null;
  readonly cityGravityScoreCapGuard: {
    readonly applied: boolean;
    readonly reason: string;
    readonly cap: number;
    readonly scoreBefore: number;
    readonly scoreAfter: number;
  } | null;
  readonly scoreCapReason: string | null;
  readonly publicDrivers: readonly GoldenHarnessPublicDriverDiag[];
  readonly rejectedFromPublicTop: readonly GoldenHarnessRejectedDiag[];
}

function driverDiag(d: LocationDemandScoredDriver, magnets: readonly MagnetItem[]): GoldenHarnessPublicDriverDiag {
  const idx = magnetIndexFromMagnetFactId(d.magnetFactId);
  const cat = idx != null ? magnets[idx]?.categoryId ?? d.category : d.category;
  const nm = idx != null ? magnets[idx]?.name ?? d.sourceName : d.sourceName;
  const reason = [d.reason, d.publicDisplayRejectReason].filter(Boolean).join(' | ');
  return {
    name: nm,
    category: String(cat),
    demandType: d.demandTypeVote,
    tier: d.resolvedTier,
    contribution: Math.round(d.finalContribution * 1000) / 1000,
    distanceMeters: d.distanceMeters,
    publicDisplayEligible: Boolean(d.publicDisplayEligible),
    reason: reason || '—',
  };
}

export function buildGoldenHarnessCaseDiagnostics(args: {
  readonly fixtureMeta: GoldenFixtureExpectations;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly geocodeDisplayName: string | null;
  readonly geocodeResult?: GeocodeResult | null;
  readonly addressRu: string;
  readonly magnets: readonly MagnetItem[];
  readonly decision: LocationDecision | null;
}): GoldenHarnessCaseDiagnostics {
  const sanity = args.geocodeResult ? evaluateRuGeocodeCitySanity(args.addressRu, args.geocodeResult) : null;
  const tableScale = inferCityScaleFromRuAddress(args.addressRu);
  const k = args.decision?.demandKernelV1;
  const scaleFields =
    k != null
      ? {
          cityScale: k.cityScale,
          populationTier: k.populationTier,
          marketGravityCoefficient: k.marketGravityCoefficient,
          specialMarketFlags: [...k.specialMarketFlags],
          cityScaleInference: k.cityScaleInferenceProvenance ?? tableScale.inferredFrom,
        }
      : {
          cityScale: tableScale.cityScale,
          populationTier: tableScale.populationTier,
          marketGravityCoefficient: tableScale.marketGravityCoefficient,
          specialMarketFlags: [...tableScale.specialMarketFlags],
          cityScaleInference: tableScale.inferredFrom,
        };

  const cityPopulationApprox = sanity?.cityMismatch ? null : tableScale.populationApprox;
  const guard = k?.smallCitySparseScoreGuard ?? null;
  const cityGravityGuard = k?.cityGravityScoreCapGuard ?? null;

  const magnets = args.magnets;
  const scored = k?.scoredDrivers ?? [];
  const rejectedTop = [...scored]
    .filter(d => !d.publicDisplayEligible && d.accepted && d.finalContribution >= 0.08)
    .sort((a, b) => b.finalContribution - a.finalContribution)
    .slice(0, 12)
    .map(d => {
      const idx = magnetIndexFromMagnetFactId(d.magnetFactId);
      const cat = idx != null ? magnets[idx]?.categoryId ?? d.category : d.category;
      return {
        sourceName: d.sourceName,
        category: String(cat),
        demandType: d.demandTypeVote,
        tier: d.resolvedTier,
        distanceMeters: d.distanceMeters,
        reason: d.publicDisplayRejectReason ?? d.reason ?? '—',
        contribution: Math.round(d.finalContribution * 1000) / 1000,
      };
    });

  const publicDriverRows =
    args.decision?.publicSummary?.publicDrivers.map((row, i) => {
      const id = row.trace.magnetFactId;
      const d = scored.find(x => x.magnetFactId === id);
      if (!d) {
        return {
          name: row.textRu.slice(0, 80),
          category: '—',
          demandType: null,
          tier: 0,
          contribution: 0,
          distanceMeters: 0,
          publicDisplayEligible: true,
          reason: 'summary_only',
        };
      }
      return driverDiag(d, magnets);
    }) ?? [];

  return {
    lat: args.lat,
    lon: args.lon,
    geocodeDisplayName: args.geocodeDisplayName,
    requestedCity: sanity?.requestedCity ?? null,
    geocodeCity: sanity?.geocodeCity ?? args.geocodeResult?.locality?.trim() ?? null,
    geocodeAdminArea1: sanity?.geocodeAdminArea1 ?? args.geocodeResult?.adminArea1?.trim() ?? null,
    geocodeAdminArea2: sanity?.geocodeAdminArea2 ?? args.geocodeResult?.adminArea2?.trim() ?? null,
    geocodeSettlement: sanity?.geocodeSettlement ?? args.geocodeResult?.settlement?.trim() ?? null,
    cityMismatch: sanity?.cityMismatch ?? false,
    mismatchReason: sanity?.mismatchReason ?? null,
    expectedCity: args.fixtureMeta.expectedCity,
    expectedRegion: args.fixtureMeta.expectedRegion,
    expectedProfileExpectation: args.fixtureMeta.expectedProfileExpectation,
    cityPopulationApprox,
    cityScale: scaleFields.cityScale,
    populationTier: scaleFields.populationTier,
    marketGravityCoefficient: scaleFields.marketGravityCoefficient,
    specialMarketFlags: scaleFields.specialMarketFlags,
    cityScaleInference: scaleFields.cityScaleInference,
    smallCitySparseScoreGuard: guard
      ? {
          applied: guard.applied,
          reason: guard.reason,
          scoreBefore: guard.scoreBefore,
          scoreAfter: guard.scoreAfter,
        }
      : null,
    cityGravityScoreCapGuard: cityGravityGuard
      ? {
          applied: cityGravityGuard.applied,
          reason: cityGravityGuard.reason,
          cap: cityGravityGuard.cap,
          scoreBefore: cityGravityGuard.scoreBefore,
          scoreAfter: cityGravityGuard.scoreAfter,
        }
      : null,
    scoreCapReason: k?.scoreCapReason ?? null,
    publicDrivers: publicDriverRows,
    rejectedFromPublicTop: rejectedTop,
  };
}
