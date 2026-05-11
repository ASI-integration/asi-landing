/**
 * Location Decision Kernel — assembles {@link LocationDecision} from engine output.
 * All location semantics for UI/report/free/paid must be traced here or marked projection-only downstream.
 */

import type { LocationAnalysis, OSMElement } from './types';
import type { CanonicalLocationFact, LocationDecision, MagnetTier } from './location-decision-contract';
import { haversineMeters } from './gravity-scoring';
import { classifyElement } from './overpass-classify';
import { publicLocationScore, scoreBandFromPublicScore } from './location-score-public';
import {
  assertDemandSignalsHaveEvidence,
  buildAddressIdentity,
  canonicalFactsFromMagnetsFallback,
  canonicalFactsFromOsmElements,
  formatPublicEvidenceLineRu,
  magnetItemToMagnetFact,
} from './location-decision-rules';
import {
  buildPublicClaimsRu,
  validatePublicClaimPipeline,
} from './location-public-claims';
import {
  buildDemandSignalsFromKernel,
  kernelDriversEligibleForPublicClaims,
  magnetRoleForScoredDriver,
  runLocationDemandScoringKernel,
} from './location-scoring-kernel';

export interface LocationDecisionBuildInput {
  analysis: LocationAnalysis;
  inputAddress: string;
  coordinates: { lat: number; lon: number };
  rawElements?: readonly OSMElement[];
  selectedGeocodeResult?: string | null;
  geocodeSubjectHint?: 'address' | 'poi' | 'ambiguous';
  locale?: 'en' | 'ru';
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

/** Align OSM tags to classified magnets by nearest matching category (deterministic v1). */
function canonicalFactsWithOsmTagsForKernel(args: {
  magnets: LocationAnalysis['magnets'];
  rawElements?: readonly OSMElement[];
  origin: { lat: number; lon: number };
}): CanonicalLocationFact[] {
  const base = canonicalFactsFromMagnetsFallback(args.magnets);
  const { rawElements, magnets, origin } = args;
  if (!rawElements?.length) return base;

  const candidates: Array<{
    categoryId: string;
    lat: number;
    lon: number;
    tags: Record<string, string>;
  }> = [];

  for (const el of rawElements) {
    const cl = classifyElement(el);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!cl || lat == null || lon == null) continue;
    candidates.push({ categoryId: cl.categoryId, lat, lon, tags: el.tags ?? {} });
  }

  return base.map((cf, idx) => {
    const m = magnets[idx];
    if (!m) return cf;
    let bestTags: Record<string, string> | undefined;
    let bestD = Infinity;
    for (const c of candidates) {
      if (c.categoryId !== m.categoryId) continue;
      const d = haversineMeters(m.lat, m.lon, c.lat, c.lon);
      if (d < bestD && d < 180) {
        bestD = d;
        bestTags = c.tags;
      }
    }
    return bestTags ? { ...cf, rawTags: bestTags } : cf;
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

  const canonicalFactsForKernel = canonicalFactsWithOsmTagsForKernel({
    magnets: analysis.magnets,
    rawElements: input.rawElements,
    origin: coords,
  });

  const demandKernelV1 = runLocationDemandScoringKernel({
    magnets: analysis.magnets,
    magnetFacts,
    canonicalFacts: canonicalFactsForKernel,
    engineFinalScore: engineFinal,
    analysisIncomplete: Boolean(analysis.analysisIntegrity?.analysisIncomplete),
    scoreBlockedDueToIncompleteData: Boolean(
      analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData,
    ),
  });

  const evidenceDrivers = kernelDriversEligibleForPublicClaims({
    kernel: demandKernelV1,
    magnets: analysis.magnets,
  }).slice(0, 5);

  const evidenceItems = evidenceDrivers.flatMap(d => {
    const mf = magnetFacts.find(m => m.id === d.magnetFactId);
    if (!mf) return [];
    const role = magnetRoleForScoredDriver(d) ?? mf.role;
    const tierLabel: MagnetTier =
      d.resolvedTier === 1 ? 'primary' : d.resolvedTier === 2 ? 'secondary' : 'weak';
    const patched = { ...mf, role, tier: tierLabel };
    return [
      {
        evidenceId: d.evidenceId,
        factId: mf.id,
        objectName: mf.name,
        typeRu: mf.category,
        subtypeRu: mf.subtype,
        distanceMeters: mf.distanceMeters,
        publicExplanationRu: formatPublicEvidenceLineRu(patched),
      },
    ];
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

  const finalScore = demandKernelV1.blendedPublicScore;

  const scoreBand = scoreBandFromPublicScore(finalScore ?? 0) as LocationDecision['scoreBand'];

  const publicClaims = buildPublicClaimsRu({ evidenceItems, magnetFacts, demandSignals });
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

  const strategySummary =
    analysis.residentialAnalysis?.strategyRationaleRu ??
    analysis.residentialAnalysis?.operationalNoteRu ??
    analysis.conclusion;

  const heroTitle =
    locale === 'ru'
      ? `Индекс локации: ${finalScore ?? '—'}/100`
      : `Location index: ${finalScore ?? '—'}/100`;

  const warnings = [...addressIdentity.warnings, ...(trace?.warnings ?? [])];
  for (const s of demandSignals) {
    if (!s.evidenceFactIds.length && s.id !== 'ds:generic_incomplete_data') {
      warnings.push(`kernel: demand signal ${s.id} lacks evidenceFactIds`);
    }
  }
  for (const p of claimProblems) {
    warnings.push(`kernel:public_claim:${p}`);
  }
  for (const w of demandKernelV1.warnings) {
    warnings.push(w);
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
