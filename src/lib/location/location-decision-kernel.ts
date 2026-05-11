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
  demandSignalsFromMagnetFacts,
  evidenceItemsFromMagnetFacts,
  magnetItemToMagnetFact,
} from './location-decision-rules';
import {
  buildPublicClaimsRu,
  validatePublicClaimPipeline,
} from './location-public-claims';

export interface LocationDecisionBuildInput {
  analysis: LocationAnalysis;
  inputAddress: string;
  coordinates: { lat: number; lon: number };
  rawElements?: readonly OSMElement[];
  selectedGeocodeResult?: string | null;
  geocodeSubjectHint?: 'address' | 'poi' | 'ambiguous';
  locale?: 'en' | 'ru';
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

  let demandSignals = demandSignalsFromMagnetFacts(magnetFacts);

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

  const finalScore =
    trace && Number.isFinite(trace.finalScore)
      ? trace.finalScore
      : publicLocationScore(analysis);

  const scoreBand = scoreBandFromPublicScore(finalScore ?? 0) as LocationDecision['scoreBand'];

  const evidenceItems = evidenceItemsFromMagnetFacts(magnetFacts, 5);
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
  return {
    ...analysis,
    locationDecision: buildLocationDecision({ ...ctx, analysis }),
  };
}
