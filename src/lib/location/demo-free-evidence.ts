/**
 * Structured evidence + headline caps for RU demo / free-tier surfaces only.
 */

import type { LocationAnalysis, MagnetItem } from './types';

export const DEMO_FREE_HIGH_SCORE_CAP = 80;
export const DEMO_FREE_HIGH_SCORE_THRESHOLD = 90;

export type DemoStructuredEvidence = {
  categoryId: string;
  subType?: string;
  distanceMeters: number;
  source: 'surfaced_magnet' | 'strategic_hub_attachment';
};

export type DemoPublicEvidenceFlags = {
  transport: boolean;
  medical: boolean;
  businessCluster: boolean;
  demandStrong: boolean;
};

function magnetPassesDiagnostics(m: MagnetItem, analysis: LocationAnalysis): boolean {
  const diag = analysis.magnetDiagnostics?.surfacedMagnets;
  if (!diag || diag.length === 0) return true;
  return diag.some(
    d =>
      d.classifiedCategoryId === m.categoryId &&
      Math.abs(d.distanceM - Math.round(m.distance)) <= 160,
  );
}

/** Anchors that justify a 90+ headline on demo/free without misleading users. */
export function listStrongDemoAnchors(analysis: LocationAnalysis): DemoStructuredEvidence[] {
  const out: DemoStructuredEvidence[] = [];
  const seen = new Set<string>();

  const push = (m: MagnetItem, source: DemoStructuredEvidence['source']) => {
    if (!magnetPassesDiagnostics(m, analysis)) return;
    const key = `${m.categoryId}:${Math.round(m.distance)}:${m.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      categoryId: m.categoryId,
      subType: m.subType,
      distanceMeters: Math.round(m.distance),
      source,
    });
  };

  for (const m of analysis.magnets ?? []) {
    if (m.categoryId === 'metro' && m.distance <= 1500) push(m, 'surfaced_magnet');
    if (m.categoryId === 'railway_station' && m.distance <= 1400) push(m, 'surfaced_magnet');
    if (m.categoryId === 'airport' && m.distance <= 8000) push(m, 'surfaced_magnet');
    if (m.categoryId === 'strategicTransportHub' && m.strategicReachBand) push(m, 'surfaced_magnet');
    if (m.categoryId === 'specializedMedicalAnchor' && m.specializedMedicalReachBand) {
      push(m, 'surfaced_magnet');
    }
    if (
      m.categoryId === 'hospital' &&
      m.distance <= 1000 &&
      m.strengthClass !== 'weak'
    ) {
      push(m, 'surfaced_magnet');
    }
    if (m.categoryId === 'business') {
      const weakOffice = m.subType === 'office_anon' || m.subType === 'bank';
      const cluster = analysis.audienceAnalysis?.businessClusterDetected === true;
      if (!weakOffice && m.distance <= 1500 && cluster) push(m, 'surfaced_magnet');
    }
  }

  for (const m of analysis.strategicTransportHubMagnets ?? []) {
    if (m.strategicReachBand) push(m, 'strategic_hub_attachment');
  }

  return out;
}

export function hasStrongConfirmedDemoAnchor(analysis: LocationAnalysis): boolean {
  return listStrongDemoAnchors(analysis).length > 0;
}

export function buildDemoPublicEvidenceFlags(analysis?: LocationAnalysis): DemoPublicEvidenceFlags {
  const empty: DemoPublicEvidenceFlags = {
    transport: false,
    medical: false,
    businessCluster: false,
    demandStrong: false,
  };
  if (!analysis) return empty;

  const magnets = analysis.magnets ?? [];
  for (const m of magnets) {
    if (!magnetPassesDiagnostics(m, analysis)) continue;
    if (m.categoryId === 'metro' && m.distance <= 1500) empty.transport = true;
    if (m.categoryId === 'railway_station' && m.distance <= 1400) empty.transport = true;
    if (m.categoryId === 'airport' && m.distance <= 8000) empty.transport = true;
    if (m.categoryId === 'strategicTransportHub' && m.strategicReachBand) empty.transport = true;
    if (
      m.categoryId === 'specializedMedicalAnchor' &&
      m.specializedMedicalReachBand
    ) {
      empty.medical = true;
    }
    if (
      m.categoryId === 'hospital' &&
      m.distance <= 1200 &&
      m.strengthClass !== 'weak'
    ) {
      empty.medical = true;
    }
  }

  if (analysis.audienceAnalysis?.businessClusterDetected) {
    empty.businessCluster = magnets.some(
      m =>
        m.categoryId === 'business' &&
        m.distance <= 1800 &&
        magnetPassesDiagnostics(m, analysis) &&
        m.subType !== 'office_anon' &&
        m.subType !== 'bank',
    );
  }

  for (const m of analysis.strategicTransportHubMagnets ?? []) {
    if (m.strategicReachBand) empty.transport = true;
  }

  const breakdown = analysis.locationScore?.breakdown;
  empty.demandStrong =
    breakdown != null &&
    breakdown.demand_score >= 68 &&
    (analysis.gravityExplanation.clusterDetected || magnets.length >= 5);

  return empty;
}

function fmtKmRu(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM / 10) * 10} м`;
  return `${(distanceM / 1000).toFixed(1)} км`;
}

/** Evidence-backed one-liner for strategic transport (names intentionally omitted). */
export function strategicHubDemoPublicLineRu(analysis: LocationAnalysis): string | null {
  const magnets = analysis.magnets ?? [];
  const cands: MagnetItem[] = [
    ...(analysis.strategicTransportHubMagnets ?? []),
    ...magnets.filter(m => m.categoryId === 'strategicTransportHub'),
  ];

  const keys = new Set<string>();
  const dedup: MagnetItem[] = [];
  for (const m of cands) {
    const k = `${m.name}:${Math.round(m.distance)}`;
    if (keys.has(k)) continue;
    keys.add(k);
    dedup.push(m);
  }

  const usable = dedup.filter(m => m.strategicReachBand);
  if (!usable.length) return null;

  usable.sort((a, b) => a.distance - b.distance);
  const m = usable[0];
  if (!magnetPassesDiagnostics(m, analysis)) return null;

  const dist = fmtKmRu(Math.round(m.distance));
  return `Транспортный объект в зоне доступности, около ${dist}.`;
}

/** Evidence-backed one-liner for specialized / major healthcare context. */
export function specializedMedicalDemoPublicLineRu(analysis: LocationAnalysis): string | null {
  const candidates = (analysis.magnets ?? []).filter(
    x => x.categoryId === 'specializedMedicalAnchor' && x.specializedMedicalReachBand,
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  const m = candidates[0];
  if (!magnetPassesDiagnostics(m, analysis)) return null;
  const dist = fmtKmRu(Math.round(m.distance));
  return `Медицинский объект в зоне доступности, около ${dist}.`;
}

export type DemoFreeHeadlineCapResult = {
  evergreenDisplay: number;
  locationScoreDisplay: number;
  capApplied: boolean;
  reasonRu: string | null;
};

/**
 * Caps headline scores on demo/free when ≥90 but no strong confirmed anchor
 * (verified against surfaced magnet diagnostics when present).
 */
export function applyDemoFreeHeadlineCaps(analysis: LocationAnalysis): DemoFreeHeadlineCapResult {
  const evergreen = analysis.evergreenIndex;
  const rawLs = analysis.locationScore?.location_score ?? evergreen;
  const hasAnchor = hasStrongConfirmedDemoAnchor(analysis);

  let capApplied = false;
  let ev = evergreen;
  let ls = rawLs;
  let reasonRu: string | null = null;

  if (!hasAnchor && evergreen >= DEMO_FREE_HIGH_SCORE_THRESHOLD) {
    ev = Math.min(ev, DEMO_FREE_HIGH_SCORE_CAP);
    capApplied = true;
    reasonRu =
      'Для бесплатного фрагмента балл ограничен: рядом нет подтверждённого «тяжёлого» якоря (метро, вокзал, аэропорт, порт, крупная медицина или устойчивый деловой кластер) в допустимой дистанции.';
  }
  if (!hasAnchor && rawLs >= DEMO_FREE_HIGH_SCORE_THRESHOLD) {
    ls = Math.min(ls, DEMO_FREE_HIGH_SCORE_CAP);
    capApplied = true;
    reasonRu =
      reasonRu ??
      'Для бесплатного фрагмента итоговый балл ограничен без подтверждённого сильного якоря по карте.';
  }

  return {
    evergreenDisplay: ev,
    locationScoreDisplay: ls,
    capApplied,
    reasonRu: capApplied ? reasonRu : null,
  };
}

