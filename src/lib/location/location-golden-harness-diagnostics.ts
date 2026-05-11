/**
 * Extra JSON diagnostics for `npm run location:golden` — not used by UI.
 */

import type { LocationDecision } from './location-decision-contract';
import type { LocationDemandScoredDriver } from './location-scoring-contract';
import type { MagnetItem } from './types';
import { inferCityScaleFromRuAddress } from './city-scale-from-address';
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
  readonly reason: string;
  readonly contribution: number;
}

export interface GoldenHarnessCaseDiagnostics {
  readonly lat: number | null;
  readonly lon: number | null;
  readonly geocodeDisplayName: string | null;
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
  readonly addressRu: string;
  readonly magnets: readonly MagnetItem[];
  readonly decision: LocationDecision | null;
}): GoldenHarnessCaseDiagnostics {
  const scale = inferCityScaleFromRuAddress(args.addressRu);
  const k = args.decision?.demandKernelV1;
  const guard = k?.smallCitySparseScoreGuard ?? null;
  const cityGravityGuard = k?.cityGravityScoreCapGuard ?? null;

  const magnets = args.magnets;
  const scored = k?.scoredDrivers ?? [];
  const rejectedTop = [...scored]
    .filter(d => !d.publicDisplayEligible && d.accepted && d.finalContribution >= 0.08)
    .sort((a, b) => b.finalContribution - a.finalContribution)
    .slice(0, 12)
    .map(d => ({
      sourceName: d.sourceName,
      reason: d.publicDisplayRejectReason ?? d.reason ?? '—',
      contribution: Math.round(d.finalContribution * 1000) / 1000,
    }));

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
    expectedCity: args.fixtureMeta.expectedCity,
    expectedRegion: args.fixtureMeta.expectedRegion,
    expectedProfileExpectation: args.fixtureMeta.expectedProfileExpectation,
    cityPopulationApprox: scale.populationApprox,
    cityScale: scale.cityScale,
    populationTier: scale.populationTier,
    marketGravityCoefficient: scale.marketGravityCoefficient,
    specialMarketFlags: scale.specialMarketFlags,
    cityScaleInference: scale.inferredFrom,
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
