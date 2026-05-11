/**
 * Report/demo projection — attaches evidence + public wording AFTER numeric scoring.
 */

import type { LocationAnalysis, OSMElement } from './types';
import type { LocationScoringTrace } from './location-scoring-trace';
import { normalizeRuDemoExplanationLines, sanitizeRuPublicFactor } from './demo-public-copy';
import { SCORING_EVIDENCE_GROUPS } from './location-scoring-rules';
import { buildLocationDecision } from './location-decision-kernel';

function cloneTrace(trace: LocationScoringTrace): LocationScoringTrace {
  return {
    ...trace,
    classifiedMagnets: [...trace.classifiedMagnets],
    capsApplied: [...trace.capsApplied],
    evidence: [...trace.evidence],
    publicBullets: [...trace.publicBullets],
    removedPublicBullets: [...trace.removedPublicBullets],
    warnings: [...trace.warnings],
  };
}

/** Minimal engine evidence refs — detailed blocks stay in unified-report.ts (report-only). */
function engineEvidenceFromTrace(trace: LocationScoringTrace): LocationScoringTrace['evidence'] {
  return [
    {
      id: 'ev-evergreen',
      group: SCORING_EVIDENCE_GROUPS.engine,
      evidenceType: 'evergreen_index',
      title: 'Evergreen index',
      detail: String(trace.scoreFeatures.evergreenIndex),
    },
    {
      id: 'ev-composite-base',
      group: SCORING_EVIDENCE_GROUPS.engine,
      evidenceType: 'composite_base_headline',
      title: 'Композитный балл до корректировки среды',
      detail: String(trace.baseScore),
    },
    {
      id: 'ev-magnet-count',
      group: SCORING_EVIDENCE_GROUPS.magnets,
      evidenceType: 'magnet_pool',
      title: 'Классифицированные магниты в расчёте',
      detail: `${trace.classifiedMagnets.length} шт.`,
    },
  ];
}

export type LocationReportPublicMode = 'paid_factors' | 'free_demo_sanitize';

export function applyReportProjectionToTrace(
  trace: LocationScoringTrace,
  mode: LocationReportPublicMode,
  score: NonNullable<LocationAnalysis['locationScore']>,
  opts?: { kernelBullets?: string[] },
): LocationScoringTrace {
  const next = cloneTrace(trace);
  next.evidence = engineEvidenceFromTrace(trace);

  const rawFactors = [...(score.top_positive_factors ?? []), ...(score.top_negative_factors ?? [])];

  if (mode === 'paid_factors') {
    next.publicBullets = (score.top_positive_factors ?? []).slice(0, 5);
    next.removedPublicBullets = [];
    return next;
  }

  const kernelFirst = (opts?.kernelBullets ?? []).filter(Boolean).slice(0, 6);
  if (kernelFirst.length > 0) {
    next.publicBullets = kernelFirst;
    next.removedPublicBullets = rawFactors.filter(line => sanitizeRuPublicFactor(line) == null);
    return next;
  }

  next.publicBullets = normalizeRuDemoExplanationLines(rawFactors, 6);
  next.removedPublicBullets = rawFactors.filter(line => sanitizeRuPublicFactor(line) == null);

  return next;
}

export function enrichAnalysisWithReportProjection(
  analysis: LocationAnalysis,
  opts: { reportMode: 'free' | 'paid'; rawElements?: readonly OSMElement[] },
): LocationAnalysis {
  const trace = analysis.scoringTrace;
  const score = analysis.locationScore;
  if (!trace || !score) return analysis;

  const mode: LocationReportPublicMode = opts.reportMode === 'free' ? 'free_demo_sanitize' : 'paid_factors';

  const kernelBullets =
    mode === 'free_demo_sanitize'
      ? buildLocationDecision({
          analysis,
          inputAddress: trace.inputAddress ?? '',
          coordinates: trace.coordinates,
          rawElements: opts.rawElements,
          selectedGeocodeResult: trace.selectedGeocodeResult,
          locale: 'ru',
        }).uiProjection.keyEvidenceBullets
      : undefined;

  return {
    ...analysis,
    scoringTrace: applyReportProjectionToTrace(trace, mode, score, { kernelBullets }),
  };
}
