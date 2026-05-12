/**
 * Location Decision Kernel — assembles {@link LocationDecision} from engine output.
 * All location semantics for UI/report/free/paid must be traced here or marked projection-only downstream.
 */

import type { LocationAnalysis, OSMElement } from './types';
import type { LocationDecision } from './location-decision-contract';
import { publicLocationScore, scoreBandFromPublicScore } from './location-score-public';
import {
  assertDemandSignalsHaveEvidence,
  buildAddressIdentity,
  canonicalFactsFromMagnetsFallback,
  canonicalFactsFromOsmElements,
  magnetItemToMagnetFact,
} from './location-decision-rules';
import { validatePublicClaimPipeline } from './location-public-claims';
import { attachOsmTagsToMagnetCanonicalFacts } from './kernel-osm-tag-alignment';
import {
  cityScaleInferenceAfterGeocodeMismatch,
  inferCityScaleFromRuAddress,
} from './city-scale-from-address';
import { evaluateRuGeocodeCitySanity } from './address-providers/geocode-city-sanity';
import { buildDemandSignalsFromKernel, runLocationDemandScoringKernel } from './location-scoring-kernel';
import {
  buildLocationPublicSummary,
  evidenceItemsFromStrictSummaryDrivers,
  publicSummaryToClaims,
  selectStrictPublicSummaryDrivers,
} from './location-public-summary';

export interface LocationDecisionBuildInput {
  analysis: LocationAnalysis;
  inputAddress: string;
  coordinates: { lat: number; lon: number };
  rawElements?: readonly OSMElement[];
  selectedGeocodeResult?: string | null;
  geocodeSubjectHint?: 'address' | 'poi' | 'ambiguous';
  locale?: 'en' | 'ru';
  /** Structured geocode (RU): enables city token vs returned locality sanity before macro layer. */
  geocodeResult?: import('./providers/types').GeocodeResult | null;
}

const DEMO_COORD_MATCH_EPS = 1e-4;

function demoCoordinatesMatch(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): boolean {
  return Math.abs(a.lat - b.lat) <= DEMO_COORD_MATCH_EPS && Math.abs(a.lon - b.lon) <= DEMO_COORD_MATCH_EPS;
}

/**
 * RU residential demo: reuse API-attached `locationDecision` on the analysis when present so the UI matches
 * server-side kernel input (OSM tags via rawElements). Falls back to `buildLocationDecision` for legacy payloads.
 */
export function ruResidentialLocationDecisionForDemo(input: {
  analysis: LocationAnalysis;
  inputAddress: string;
  coordinates: { lat: number; lon: number };
  locale?: 'en' | 'ru';
}): LocationDecision {
  const attached = input.analysis.locationDecision;
  if (
    attached?.demandKernelV1 &&
    demoCoordinatesMatch(attached.coordinates, input.coordinates)
  ) {
    return attached;
  }
  return buildLocationDecision({
    analysis: input.analysis,
    inputAddress: input.inputAddress,
    coordinates: input.coordinates,
    locale: input.locale ?? 'ru',
  });
}

export function syncDemandKernelHeadlineOntoAnalysis(
  analysis: LocationAnalysis,
  decision: LocationDecision,
): void {
  const trace = analysis.scoringTrace;
  const next = decision.finalScore;
  if (!trace || next == null || !Number.isFinite(next)) return;
  const rounded = Math.round(next);
  const prevRounded = Math.round(trace.finalScore);
  if (rounded === prevRounded) return;

  trace.finalScore = rounded;
  trace.capsApplied.push({
    kind: 'demand_kernel_v1',
    phase: 'composite_headline',
    reason: `Demand kernel v1 headline blend (${prevRounded} → ${rounded})`,
    scoreBefore: prevRounded,
    scoreAfter: rounded,
  });

  if (analysis.locationScore) {
    analysis.locationScore = { ...analysis.locationScore, location_score: rounded };
  }
  analysis.scoreBand = scoreBandFromPublicScore(rounded);
}

export function buildLocationDecision(input: LocationDecisionBuildInput): LocationDecision {
  const { analysis } = input;
  const trace = analysis.scoringTrace ?? null;
  const coords = input.coordinates;

  const addressIdentity = buildAddressIdentity({
    inputAddress: input.inputAddress,
    coordinates: coords,
    geocodeSubjectHint: input.geocodeSubjectHint,
  });

  const rawObjectsCount =
    trace?.rawObjectsCount ?? analysis.scoringTrace?.rawObjectsCount ?? analysis.magnets.length;

  const dataIntegrity = {
    analysisIncomplete: analysis.analysisIntegrity?.analysisIncomplete,
    scoreBlockedDueToIncompleteData: analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData,
    integrityReasons: [...(analysis.analysisIntegrity?.reasons ?? [])],
    traceIntegritySnapshot: trace?.integrity,
  };

  const canonicalFacts = input.rawElements?.length
    ? canonicalFactsFromOsmElements(input.rawElements, coords)
    : canonicalFactsFromMagnetsFallback(analysis.magnets);

  const magnetFacts = analysis.magnets.map((m, idx) =>
    magnetItemToMagnetFact(m, idx, analysis.magnets),
  );

  const engineFinal =
    trace && Number.isFinite(trace.finalScore)
      ? trace.finalScore
      : publicLocationScore(analysis);

  const canonicalFactsForKernel = attachOsmTagsToMagnetCanonicalFacts({
    magnets: analysis.magnets,
    baseFacts: canonicalFactsFromMagnetsFallback(analysis.magnets),
    rawElements: input.rawElements ?? [],
  });

  const baseCityScaleInference = inferCityScaleFromRuAddress(input.inputAddress);
  const geoSanity =
    (input.locale ?? 'ru') === 'ru' && input.geocodeResult
      ? evaluateRuGeocodeCitySanity(input.inputAddress, input.geocodeResult)
      : null;
  const cityScaleInference =
    geoSanity?.cityMismatch === true
      ? cityScaleInferenceAfterGeocodeMismatch(baseCityScaleInference)
      : baseCityScaleInference;

  const geocodeHarnessWarnings: string[] = [];
  if (geoSanity?.cityMismatch) {
    geocodeHarnessWarnings.push(`warning: geocode_city_mismatch:${geoSanity.mismatchReason ?? 'unknown'}`);
  }

  const demandKernelV1 = runLocationDemandScoringKernel({
    magnets: analysis.magnets,
    magnetFacts,
    canonicalFacts: canonicalFactsForKernel,
    engineFinalScore: engineFinal,
    analysisIncomplete: Boolean(analysis.analysisIntegrity?.analysisIncomplete),
    scoreBlockedDueToIncompleteData: Boolean(
      analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData,
    ),
    cityScaleInference,
  });

  let demandSignals = buildDemandSignalsFromKernel({
    accepted: demandKernelV1.acceptedDrivers,
    magnetFacts,
    magnets: analysis.magnets,
  });

  /** Generic low-confidence allowance — still carries empty evidence only as explicit warning signal */
  if (
    analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData &&
    demandSignals.length === 0
  ) {
    demandSignals = [
      {
        id: 'ds:generic_incomplete_data',
        type: 'data_quality_low_confidence',
        strength: 'weak',
        evidenceFactIds: [],
        reason: 'Недостаточно картографических данных для уверенных выводов спроса.',
        publicLabelRu: 'Данных карты недостаточно для уверенных выводов о спросе.',
        internalReason: 'integrity_gate:blocked_or_incomplete',
      },
    ];
  } else {
    const sigProblems = assertDemandSignalsHaveEvidence(demandSignals);
    if (sigProblems.length) {
      demandSignals = demandSignals.filter(s => s.evidenceFactIds.length > 0);
    }
  }

  const strictPublicDrivers = selectStrictPublicSummaryDrivers({
    kernel: demandKernelV1,
    magnets: analysis.magnets,
    demandSignals,
    allowWeakLocalAttractionInResort:
      demandKernelV1.specialMarketFlags.includes('resort_exception') ||
      demandKernelV1.specialMarketFlags.includes('federal_tourist_anchor'),
  });

  const evidenceItems = evidenceItemsFromStrictSummaryDrivers({
    strictDrivers: strictPublicDrivers,
    magnetFacts,
    magnets: analysis.magnets,
  });

  const finalScore = demandKernelV1.blendedPublicScore;

  const scoreBand = scoreBandFromPublicScore(finalScore ?? 0) as LocationDecision['scoreBand'];

  const baseWarningsPreSummary = [...geocodeHarnessWarnings, ...addressIdentity.warnings, ...(trace?.warnings ?? [])];
  for (const s of demandSignals) {
    if (!s.evidenceFactIds.length && s.id !== 'ds:generic_incomplete_data') {
      baseWarningsPreSummary.push(`kernel: demand signal ${s.id} lacks evidenceFactIds`);
    }
  }
  for (const w of demandKernelV1.warnings) {
    baseWarningsPreSummary.push(w);
  }

  const publicSummary = buildLocationPublicSummary({
    analysis,
    magnets: analysis.magnets,
    magnetFacts,
    kernel: demandKernelV1,
    demandSignals,
    finalScore: Number.isFinite(finalScore) ? finalScore : null,
    scoreBand,
    baseWarnings: baseWarningsPreSummary,
    strictDrivers: strictPublicDrivers,
  });

  const publicClaims = publicSummaryToClaims(publicSummary.publicDrivers);
  const keyEvidenceBullets = publicClaims.map(c => c.textRu);

  const claimProblems = validatePublicClaimPipeline({
    magnetFacts,
    evidenceItems,
    demandSignals,
    publicClaims,
  });

  const locale = input.locale ?? 'ru';
  const env =
    locale === 'ru'
      ? analysis.neighborhoodEnvironment.environmentNarrativeRu
      : analysis.neighborhoodEnvironment.environmentNarrativeEn;

  const strategySummary = publicSummary.recommendedStrategyBulletsRu.join(' ');

  const heroTitle =
    locale === 'ru'
      ? `Индекс локации: ${finalScore ?? '—'}/100`
      : `Location index: ${finalScore ?? '—'}/100`;

  const warnings = [...publicSummary.warnings];
  for (const p of claimProblems) {
    warnings.push(`kernel:public_claim:${p}`);
  }

  const uiProjection = {
    publicScore: finalScore ?? 0,
    scoreBand,
    heroTitle,
    keyEvidenceBullets,
    environmentSummary: env,
    strategySummary: strategySummary.slice(0, 280),
    warnings,
  };

  const publicReportSections = [
    {
      id: 'evidence',
      titleRu: 'Ключевые факторы',
      summaryRu: keyEvidenceBullets.slice(0, 5).join('\n'),
    },
    {
      id: 'environment',
      titleRu: 'Среда',
      summaryRu: analysis.neighborhoodEnvironment.environmentNarrativeRu,
    },
  ];

  return {
    inputAddress: input.inputAddress,
    addressIdentity,
    coordinates: coords,
    dataIntegrity,
    rawObjectStats: {
      rawObjectsCount,
      classifiedMagnetCount: analysis.magnets.length,
      competitorCount: analysis.competitors.length,
    },
    canonicalFacts,
    magnetFacts,
    demandKernelV1,
    demandSignals,
    scoreTrace: trace,
    finalScore: Number.isFinite(finalScore) ? finalScore : null,
    scoreBand,
    evidenceItems,
    publicClaims,
    publicSummary,
    publicReportSections,
    uiProjection,
    warnings,
  };
}

export function attachLocationDecisionToAnalysis(
  analysis: LocationAnalysis,
  ctx: Omit<LocationDecisionBuildInput, 'analysis'>,
): LocationAnalysis & { locationDecision: LocationDecision } {
  const decision = buildLocationDecision({ ...ctx, analysis });
  syncDemandKernelHeadlineOntoAnalysis(analysis, decision);
  return {
    ...analysis,
    locationDecision: decision,
  };
}
