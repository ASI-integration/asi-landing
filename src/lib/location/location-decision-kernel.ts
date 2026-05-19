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
  buildPortCityStrategicContextCopyRu,
  portCityStrategicEvidenceItem,
  portCityStrategicMagnetFact,
} from './location-evidence-anchor';
import {
  CANONICAL_PORT_MARKET_CONTEXT_EVIDENCE_ID,
  CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID,
  buildLocationPublicSummary,
  evidenceItemsFromStrictSummaryDrivers,
  publicSummaryToClaims,
  selectStrictPublicSummaryDrivers,
} from './location-public-summary';
import {
  auditMedicalPrimaryEvidence,
  countVerifiedMajorMedicalAnchors,
  medicalPrimaryHighScoreEligible,
  medicalPrimaryStrongPublicCopyEligible,
  strongestStrictNonMedicalDemandContribution,
  strictPublicDriversAreMedicalLed,
  strictPublicDriversAreMedicalOnly,
  strictPublicDriversAreOnlyGenericMedical,
} from './location-medical-surface-policy';
import { inferPartialCartographicPreviewFromAnalysis } from './location-partial-cartographic-policy';

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
  /** When true, RU public headline score is capped for preliminary / partial map fetches (matches demo meta warnings). */
  partialCartographicPreview?: boolean;
}

const DEMO_COORD_MATCH_EPS = 1e-4;
const FALLBACK_MEDICAL_CLUSTER_SCORE_FLOOR = 35;
const FALLBACK_MEDICAL_CLUSTER_FLOOR_MAX_INPUT_SCORE = 24;

interface FallbackMedicalClusterDiagnostics {
  fallbackPoiCount: number | null;
  fallbackMedicalPoiCount: number | null;
  nearbyClusterDetected: boolean;
  conservativeClusterFloorApplied: boolean;
  clusterFloorReason: string | null;
}

function demoCoordinatesMatch(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): boolean {
  return Math.abs(a.lat - b.lat) <= DEMO_COORD_MATCH_EPS && Math.abs(a.lon - b.lon) <= DEMO_COORD_MATCH_EPS;
}

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const toRad = (v: number) => v * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function osmElementPoint(el: OSMElement): { lat: number; lon: number } | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : null;
}

function isMedicalRawElement(el: OSMElement): boolean {
  const t = el.tags ?? {};
  const amenity = t.amenity ?? '';
  const healthcare = t.healthcare ?? '';
  if (
    ['hospital', 'clinic', 'doctors', 'dentist'].includes(amenity) ||
    ['hospital', 'clinic', 'doctor', 'doctors', 'laboratory', 'surgery', 'centre', 'center'].includes(healthcare)
  ) {
    return true;
  }
  const name = `${t.name ?? ''} ${t['name:ru'] ?? ''}`;
  return /больниц|поликлин|клиник|диспанс|медиц|лаборатор|hospital|clinic|medical|laborator/i.test(name);
}

function isNamedMedicalRawElement(el: OSMElement): boolean {
  const name = (el.tags?.name ?? el.tags?.['name:ru'] ?? '').normalize('NFKC').trim().toLowerCase();
  if (!name) return false;
  return !/^(?:больница|госпиталь|поликлиника|клиника|мед(?:ицинский)?\s*центр|диспансер|hospital|clinic)$/iu.test(
    name,
  );
}

function inspectFallbackMedicalCluster(
  rawElements: readonly OSMElement[] | undefined,
  coords: { lat: number; lon: number },
  partialCartographicPreview: boolean,
): FallbackMedicalClusterDiagnostics {
  if (!partialCartographicPreview || !rawElements) {
    return {
      fallbackPoiCount: partialCartographicPreview ? rawElements?.length ?? null : null,
      fallbackMedicalPoiCount: null,
      nearbyClusterDetected: false,
      conservativeClusterFloorApplied: false,
      clusterFloorReason: null,
    };
  }

  const medical = rawElements
    .map(el => ({ el, point: osmElementPoint(el) }))
    .filter((x): x is { el: OSMElement; point: { lat: number; lon: number } } => Boolean(x.point) && isMedicalRawElement(x.el))
    .map(x => ({
      distance: haversineMeters(coords, x.point),
      named: isNamedMedicalRawElement(x.el),
    }));

  const namedWithin300 = medical.filter(x => x.named && x.distance <= 300).length;
  const namedWithin500 = medical.filter(x => x.named && x.distance <= 500).length;
  const namedWithin1000 = medical.filter(x => x.named && x.distance <= 1000).length;
  const totalWithin300 = medical.filter(x => x.distance <= 300).length;
  const totalWithin500 = medical.filter(x => x.distance <= 500).length;

  let clusterFloorReason: string | null = null;
  if (namedWithin500 >= 2) {
    clusterFloorReason = `nearby_named_medical_cluster:namedWithin500=${namedWithin500}`;
  } else if (namedWithin1000 >= 3 && totalWithin500 >= 2) {
    clusterFloorReason =
      `nearby_medical_campus_pattern:namedWithin1000=${namedWithin1000}:totalWithin500=${totalWithin500}`;
  } else if (namedWithin1000 >= 2 && totalWithin300 >= 2) {
    clusterFloorReason =
      `close_medical_campus_pattern:namedWithin1000=${namedWithin1000}:totalWithin300=${totalWithin300}`;
  }

  return {
    fallbackPoiCount: rawElements.length,
    fallbackMedicalPoiCount: medical.length,
    nearbyClusterDetected: clusterFloorReason != null,
    conservativeClusterFloorApplied: false,
    clusterFloorReason,
  };
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

  const partialCartographicPreview =
    Boolean(input.partialCartographicPreview) || inferPartialCartographicPreviewFromAnalysis(analysis);

  const verifiedMajorMedicalAnchorCount = countVerifiedMajorMedicalAnchors(
    demandKernelV1.scoredDrivers,
    analysis.magnets,
    demandKernelV1.specialMarketFlags,
  );
  const strongPartialMedicalLift =
    demandKernelV1.specialMarketFlags.includes('regional_medical_cluster') &&
    verifiedMajorMedicalAnchorCount >= 2 &&
    medicalPrimaryStrongPublicCopyEligible({
      strictDrivers: strictPublicDrivers,
      magnets: analysis.magnets,
      specialMarketFlags: demandKernelV1.specialMarketFlags,
    });

  let finalScore = demandKernelV1.blendedPublicScore;
  let partialDataScoreCapApplied = false;
  let partialDataScoreCapReason: string | null = null;
  let scoreBeforePartialDataCap: number | null = null;
  let scoreAfterPartialDataCap: number | null = Number.isFinite(finalScore) ? Math.round(finalScore) : null;
  const fallbackClusterDiagnostics = inspectFallbackMedicalCluster(
    input.rawElements,
    coords,
    partialCartographicPreview,
  );

  if (Number.isFinite(finalScore) && partialCartographicPreview) {
    const blocked = Boolean(analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData);
    const genericOnly = strictPublicDriversAreOnlyGenericMedical(strictPublicDrivers, analysis.magnets);
    let cap = 101;
    let capBasis = 'partial_cartographic_preview';
    if (blocked) cap = Math.min(cap, 79);
    if (genericOnly) {
      cap = Math.min(cap, 65);
      capBasis = 'partial_generic_medical_public_drivers';
    } else if (!strongPartialMedicalLift) {
      cap = Math.min(cap, 70);
      capBasis = verifiedMajorMedicalAnchorCount > 0
        ? 'partial_verified_anchor_without_strong_cluster_evidence'
        : 'partial_no_verified_named_major_anchor';
    } else {
      cap = Math.min(cap, 79);
      capBasis = 'partial_strong_regional_medical_cluster_lift';
    }
    const rounded = Math.round(finalScore);
    scoreBeforePartialDataCap = rounded;
    if (rounded > cap) {
      partialDataScoreCapApplied = true;
      partialDataScoreCapReason =
        `partial_cartographic_public_cap:${capBasis}:from=${rounded}:to=${cap}:` +
        `strongLift=${strongPartialMedicalLift}:blocked=${blocked}`;
      finalScore = cap;
    }
    scoreAfterPartialDataCap = Math.round(finalScore);
  }

  if (
    Number.isFinite(finalScore) &&
    partialCartographicPreview &&
    !analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData &&
    fallbackClusterDiagnostics.nearbyClusterDetected &&
    Math.round(finalScore) <= FALLBACK_MEDICAL_CLUSTER_FLOOR_MAX_INPUT_SCORE
  ) {
    const before = Math.round(finalScore);
    finalScore = Math.max(finalScore, FALLBACK_MEDICAL_CLUSTER_SCORE_FLOOR);
    fallbackClusterDiagnostics.conservativeClusterFloorApplied = Math.round(finalScore) > before;
    fallbackClusterDiagnostics.clusterFloorReason =
      `conservative_cluster_floor:${fallbackClusterDiagnostics.clusterFloorReason}:from=${before}:to=${Math.round(finalScore)}`;
    scoreAfterPartialDataCap = Math.round(finalScore);
    demandKernelV1.warnings.push(fallbackClusterDiagnostics.clusterFloorReason);
  }

  if (
    Number.isFinite(finalScore) &&
    !partialCartographicPreview &&
    Math.round(finalScore) >= 83 &&
    (demandKernelV1.dominantDemandType === 'medical' ||
      strictPublicDriversAreMedicalLed(strictPublicDrivers)) &&
    !medicalPrimaryHighScoreEligible({
      scoredDrivers: demandKernelV1.scoredDrivers,
      magnets: analysis.magnets,
      specialMarketFlags: demandKernelV1.specialMarketFlags,
    })
  ) {
    const before = Math.round(finalScore);
    const medicalAudit = auditMedicalPrimaryEvidence({
      scoredDrivers: demandKernelV1.scoredDrivers,
      magnets: analysis.magnets,
      specialMarketFlags: demandKernelV1.specialMarketFlags,
    });
    finalScore = 82;
    scoreAfterPartialDataCap = Math.round(finalScore);
    demandKernelV1.warnings.push(
      `medical_primary_high_score_cap:ordinary_medical_surface:from=${before}:to=82:` +
        `strong=${medicalAudit.strongNamedAnchorCount}:ordinary=${medicalAudit.ordinaryOrGenericTotal.toFixed(2)}`,
    );
  }

  if (
    Number.isFinite(finalScore) &&
    (demandKernelV1.dominantDemandType === 'medical' ||
      strictPublicDriversAreMedicalLed(strictPublicDrivers)) &&
    !medicalPrimaryHighScoreEligible({
      scoredDrivers: demandKernelV1.scoredDrivers,
      magnets: analysis.magnets,
      specialMarketFlags: demandKernelV1.specialMarketFlags,
    })
  ) {
    const before = Math.round(finalScore);
    const medicalOnly = strictPublicDriversAreMedicalOnly(strictPublicDrivers);
    const strongestNonMedical = strongestStrictNonMedicalDemandContribution(strictPublicDrivers);
    const cap = partialCartographicPreview
      ? medicalOnly
        ? 58
        : 69
      : medicalOnly
        ? 62
        : 69;

    if (before > cap) {
      const medicalAudit = auditMedicalPrimaryEvidence({
        scoredDrivers: demandKernelV1.scoredDrivers,
        magnets: analysis.magnets,
        specialMarketFlags: demandKernelV1.specialMarketFlags,
      });
      finalScore = cap;
      scoreAfterPartialDataCap = Math.round(finalScore);
      demandKernelV1.warnings.push(
        `medical_primary_ordinary_surface_cap:` +
          `${partialCartographicPreview ? 'partial' : 'complete'}:` +
          `${medicalOnly ? 'medical_only' : 'medical_led_mixed'}:` +
          `from=${before}:to=${cap}:` +
          `strong=${medicalAudit.strongNamedAnchorCount}:` +
          `ordinary=${medicalAudit.ordinaryOrGenericTotal.toFixed(2)}:` +
          `strongestNonMedical=${strongestNonMedical.toFixed(2)}`,
      );
    }
  }

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

  let evidenceItems = evidenceItemsFromStrictSummaryDrivers({
    strictDrivers: strictPublicDrivers,
    magnetFacts,
    magnets: analysis.magnets,
  });

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
    partialCartographicContext: partialCartographicPreview,
    dataIntegrity,
    classifiedMagnetCount: analysis.magnets.length,
    inferredCityName: cityScaleInference.cityName ?? null,
    presentationDiagnostics: {
      partialCartographicPreview,
      partialDataScoreCapApplied,
      partialDataScoreCapReason,
      scoreBeforePartialDataCap,
      scoreAfterPartialDataCap,
      genericMedicalSuppressed: false,
      verifiedMajorMedicalAnchorCount,
      fallbackPoiCount: fallbackClusterDiagnostics.fallbackPoiCount,
      fallbackMedicalPoiCount: fallbackClusterDiagnostics.fallbackMedicalPoiCount,
      nearbyClusterDetected: fallbackClusterDiagnostics.nearbyClusterDetected,
      conservativeClusterFloorApplied: fallbackClusterDiagnostics.conservativeClusterFloorApplied,
      clusterFloorReason: fallbackClusterDiagnostics.clusterFloorReason,
    },
  });

  let decisionMagnetFacts = magnetFacts;
  if (
    publicSummary.publicDrivers.some(
      row => row.trace.magnetFactId === CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID,
    )
  ) {
    const portStrategicCopyRu =
      publicSummary.publicDrivers.find(
        row => row.trace.magnetFactId === CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID,
      )?.textRu ??
      buildPortCityStrategicContextCopyRu(
        cityScaleInference.cityName ?? 'город',
        publicSummary.publicScoreConfidence,
      );
    const portStrategicFact = portCityStrategicMagnetFact({
      id: CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID,
      cityName: cityScaleInference.cityName ?? 'город',
      explanationRu: portStrategicCopyRu,
    });
    decisionMagnetFacts = [...magnetFacts, portStrategicFact];
    evidenceItems = [
      portCityStrategicEvidenceItem({
        evidenceId: CANONICAL_PORT_MARKET_CONTEXT_EVIDENCE_ID,
        factId: CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID,
        publicExplanationRu: portStrategicCopyRu,
      }),
      ...evidenceItems,
    ];
  }

  const publicClaims = publicSummaryToClaims(publicSummary.publicDrivers);
  const keyEvidenceBullets = publicClaims.map(c => c.textRu);

  const claimProblems = validatePublicClaimPipeline({
    magnetFacts: decisionMagnetFacts,
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
    magnetFacts: decisionMagnetFacts,
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
