/**
 * Extra JSON diagnostics for `npm run location:golden` — not used by UI.
 */

import type { LocationDecision } from './location-decision-contract';
import type { LocationDemandKernelDemandType, LocationDemandScoredDriver } from './location-scoring-contract';
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

/** Serialized subset of {@link LocationDecision.warnings} for golden `latest.json` readability. */
export interface LocationDecisionWarningHarness {
  readonly locationDecisionWarnings: readonly string[];
  readonly geocodeCityMismatchWarning: string | null;
  readonly cityScaleRelatedWarnings: readonly string[];
  readonly scoreCapRelatedWarnings: readonly string[];
  readonly publicSummaryWarnings: readonly string[];
}

export interface GoldenHarnessMedicalDriverRow {
  readonly sourceName: string;
  readonly category: string;
  readonly scaleClass: string;
  readonly resolvedTier: number;
  readonly distanceMeters: number;
  readonly contribution: number;
  readonly publicDisplayEligible: boolean;
  readonly anchorKind:
    | 'verified_major_medical_signal'
    | 'medium_medical_anchor'
    | 'weak_local_clinic_or_dispensary_like'
    | 'other_medical_or_health_adjacent';
}

export interface GoldenHarnessNonMedicalCompetitorRow {
  readonly demandType: string | null;
  readonly sourceName: string;
  readonly category: string;
  readonly scaleClass: string;
  readonly resolvedTier: number;
  readonly distanceMeters: number;
  readonly contribution: number;
  readonly publicDisplayEligible: boolean;
  readonly publicDisplayRejectReason: string | null;
}

export interface GoldenHarnessMedicalPrimaryAudit {
  readonly caseMatchesMedicalDominanceFocusList: boolean;
  readonly topMedicalDrivers: readonly GoldenHarnessMedicalDriverRow[];
  readonly strongestNonMedicalDrivers: readonly GoldenHarnessNonMedicalCompetitorRow[];
  readonly contributionTotalsByDemandVote: Readonly<Partial<Record<LocationDemandKernelDemandType, number>>>;
  readonly proposedPolicyGuardNotes: readonly string[];
}

/** Live golden harness only — explains Overpass wall-clock vs per-request budgets (not UI). */
export interface GoldenHarnessOverpassDiagnostics {
  readonly harnessWallClockBudgetMs: number;
  readonly perHttpRequestTimeoutMs: number;
  readonly overpassClauseTimeoutSeconds: number;
  readonly pipelineSummary: string;
  readonly denseAreaStagedPipelineAvailable: boolean;
  readonly denseAreaStagedWouldActivateWithTheseOptions: boolean;
  readonly denseAreaStagedActivationRequires: string;
  readonly harnessWallClockBudgetExceeded: boolean;
  readonly elementCountReturned: number;
  readonly partialElementsCapturedBeforeHarnessCutoff: boolean;
  readonly usedFallbackQuery: boolean;
  readonly hadProviderFailure: boolean;
  readonly bottleneckSummary: string;
  readonly suggestedNextFallbackPath: string;
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
  /** Present when {@link LocationDecision.publicSummary}.primaryDemandType is `medical`. */
  readonly medicalPrimaryAudit: GoldenHarnessMedicalPrimaryAudit | null;
}

const MEDICAL_DOMINANCE_FOCUS_CASE_IDS = new Set<string>([
  'live_msk_tverskaya_10',
  'live_kzn_baumana_47',
  'live_stavropol_dzerzhinskogo_160',
  'live_anapa_krymskaya_99',
  'live_krasnoyarsk_lenina_122',
  'live_sochi_navaginskaya_7',
]);

function medicalAnchorKind(
  d: LocationDemandScoredDriver,
  categoryLabel: string,
): GoldenHarnessMedicalDriverRow['anchorKind'] {
  if (d.demandTypeVote !== 'medical') return 'other_medical_or_health_adjacent';
  if (d.scaleClass === 'verified_major') return 'verified_major_medical_signal';
  if (d.scaleClass === 'medium') return 'medium_medical_anchor';
  if (d.scaleClass === 'weak_local' || d.scaleClass === 'unknown') {
    void categoryLabel;
    return 'weak_local_clinic_or_dispensary_like';
  }
  return 'other_medical_or_health_adjacent';
}

export function buildLocationDecisionWarningHarness(
  decision: LocationDecision | null,
): LocationDecisionWarningHarness | null {
  if (!decision) return null;
  const w = [...decision.warnings];
  const psW = [...(decision.publicSummary?.warnings ?? [])];
  const geocodeCityMismatchWarning = w.find(x => x.startsWith('warning: geocode_city_mismatch')) ?? null;
  const cityScaleRelatedWarnings = w.filter(
    x =>
      x.includes('city_scale') ||
      x.includes('cityScale') ||
      x.startsWith('warning: geocode_city_mismatch') ||
      x.includes('geocode_city_mismatch'),
  );
  const kernelW = decision.demandKernelV1?.warnings ?? [];
  const scoreCapRelatedWarnings = [
    ...w.filter(
      x =>
        x.includes('city_gravity') ||
        x.includes('small_city_sparse') ||
        /^cap:/i.test(x) ||
        x.includes('score_cap') ||
        x.includes('kernel:integrity'),
    ),
    ...kernelW.filter(x => x.includes('cap') || x.includes('sparse') || x.includes('gravity')),
    ...(decision.publicSummary?.scoreCapReason ? [decision.publicSummary.scoreCapReason] : []),
    ...(decision.demandKernelV1?.scoreCapReason ? [decision.demandKernelV1.scoreCapReason] : []),
  ];
  const dedup = (a: string[]) => [...new Set(a.filter(Boolean))];
  return {
    locationDecisionWarnings: w,
    geocodeCityMismatchWarning,
    cityScaleRelatedWarnings: dedup([...cityScaleRelatedWarnings]),
    scoreCapRelatedWarnings: dedup([...scoreCapRelatedWarnings]),
    publicSummaryWarnings: psW,
  };
}

function buildMedicalPrimaryAudit(args: {
  caseId: string;
  scored: readonly LocationDemandScoredDriver[];
  magnets: readonly MagnetItem[];
  specialMarketFlags: readonly string[];
}): GoldenHarnessMedicalPrimaryAudit {
  const { caseId, scored, magnets, specialMarketFlags } = args;
  const focus = MEDICAL_DOMINANCE_FOCUS_CASE_IDS.has(caseId);
  const resortOrFederal =
    specialMarketFlags.includes('resort_exception') || specialMarketFlags.includes('federal_tourist_anchor');

  const medicalDrivers = scored
    .filter(d => d.demandTypeVote === 'medical' && d.accepted)
    .sort((a, b) => b.finalContribution - a.finalContribution)
    .slice(0, 12)
    .map((d): GoldenHarnessMedicalDriverRow => {
      const idx = magnetIndexFromMagnetFactId(d.magnetFactId);
      const cat = idx != null ? magnets[idx]?.categoryId ?? d.category : d.category;
      const catStr = String(cat);
      return {
        sourceName: idx != null ? magnets[idx]?.name ?? d.sourceName : d.sourceName,
        category: catStr,
        scaleClass: d.scaleClass,
        resolvedTier: d.resolvedTier,
        distanceMeters: d.distanceMeters,
        contribution: Math.round(d.finalContribution * 1000) / 1000,
        publicDisplayEligible: Boolean(d.publicDisplayEligible),
        anchorKind: medicalAnchorKind(d, catStr),
      };
    });

  const nonMedical = scored
    .filter(d => d.demandTypeVote && d.demandTypeVote !== 'medical' && d.accepted && d.finalContribution >= 0.04)
    .sort((a, b) => b.finalContribution - a.finalContribution)
    .slice(0, 14)
    .map((d): GoldenHarnessNonMedicalCompetitorRow => {
      const idx = magnetIndexFromMagnetFactId(d.magnetFactId);
      const cat = idx != null ? magnets[idx]?.categoryId ?? d.category : d.category;
      return {
        demandType: d.demandTypeVote,
        sourceName: idx != null ? magnets[idx]?.name ?? d.sourceName : d.sourceName,
        category: String(cat),
        scaleClass: d.scaleClass,
        resolvedTier: d.resolvedTier,
        distanceMeters: d.distanceMeters,
        contribution: Math.round(d.finalContribution * 1000) / 1000,
        publicDisplayEligible: Boolean(d.publicDisplayEligible),
        publicDisplayRejectReason: d.publicDisplayRejectReason ?? null,
      };
    });

  const contributionTotalsByDemandVote: Partial<Record<LocationDemandKernelDemandType, number>> = {};
  for (const d of scored) {
    if (!d.demandTypeVote || !d.accepted) continue;
    contributionTotalsByDemandVote[d.demandTypeVote] =
      (contributionTotalsByDemandVote[d.demandTypeVote] ?? 0) + d.finalContribution;
  }

  const proposedPolicyGuardNotes: string[] = [
    'Policy (not implemented): allow medical as headline primary only when ≥1 scored medical driver uses scaleClass=verified_major (or equivalent OSM hospital bundle) and outranks non-medical totals on the same patch.',
    'Policy (not implemented): clinics, dentists, polyclinics / weak_local medical should not dominate primary on pedestrian/tourist/commercial corridors.',
    'Policy (not implemented): when specialMarketFlags include resort_exception or federal_tourist_anchor, tourist drivers must beat weak_local/medical unless verified_major medical exists.',
    'Policy (not implemented): require positive margin (Σ medical public-eligible contributions − Σ next demand type) before choosing medicalPrimary.',
  ];
  if (focus) {
    proposedPolicyGuardNotes.unshift(
      'Harness medical-dominance focus corridor case — compare topMedicalDrivers vs strongestNonMedicalDrivers.',
    );
  }
  if (resortOrFederal) {
    proposedPolicyGuardNotes.push(
      'This run used resort_exception or federal_tourist_anchor — validate headline vs tourist anchors and weak medical.',
    );
  }

  return {
    caseMatchesMedicalDominanceFocusList: focus,
    topMedicalDrivers: medicalDrivers,
    strongestNonMedicalDrivers: nonMedical,
    contributionTotalsByDemandVote,
    proposedPolicyGuardNotes,
  };
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
  readonly caseId: string;
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

  const primary = args.decision?.publicSummary?.primaryDemandType ?? null;
  const medicalPrimaryAudit =
    primary === 'medical' && k
      ? buildMedicalPrimaryAudit({
          caseId: args.caseId,
          scored,
          magnets,
          specialMarketFlags: scaleFields.specialMarketFlags,
        })
      : null;

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
    medicalPrimaryAudit,
  };
}
