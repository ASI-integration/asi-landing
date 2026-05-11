/**
 * Test helpers / debug snapshots for demo location pipeline — not user-facing.
 */

import type { GeocodeResult } from './providers/types';
import type { LocationAnalysis } from './types';
import { applyDemoFreeHeadlineCaps, buildDemoPublicEvidenceFlags, listStrongDemoAnchors } from './demo-free-evidence';
import {
  normalizeRuDemoExplanationLines,
  type RuDemoExplanationDiagnostics,
} from './demo-public-copy';

export type DemoLocationDebugSnapshot = {
  address: string;
  selectedGeocode: Pick<GeocodeResult, 'lat' | 'lon' | 'displayName' | 'geocodeDebug'> | null;
  evidenceFlags: ReturnType<typeof buildDemoPublicEvidenceFlags>;
  strongAnchorsForDemoCap: ReturnType<typeof listStrongDemoAnchors>;
  headlineCap: ReturnType<typeof applyDemoFreeHeadlineCaps>;
  /** Normalized magnets used in scoring (subset of full magnet list). */
  magnetsUsedInScoring: Array<{
    categoryId: string;
    subType?: string;
    distanceM: number;
    name: string;
  }>;
  rawPositiveFactors: string[];
  rawNegativeFactors: string[];
  reportBullets: string[];
  bulletsRemovedByEvidenceGate: string[];
  bulletsCollapsedSemanticDup: string[];
};

export function buildDemoLocationDiagnosticsSnapshot(args: {
  address: string;
  geocode?: GeocodeResult | null;
  analysis: LocationAnalysis;
}): DemoLocationDebugSnapshot {
  const ls = args.analysis.locationScore;
  const pos = ls?.top_positive_factors ?? [];
  const neg = ls?.top_negative_factors ?? [];

  const diag: RuDemoExplanationDiagnostics = {
    bulletsKept: [],
    bulletsRemovedByEvidenceGate: [],
    bulletsCollapsedSemanticDup: [],
  };

  const mergedFactors = [...pos, ...neg];
  const reportBullets = normalizeRuDemoExplanationLines(mergedFactors, {
    max: 5,
    analysis: args.analysis,
    diagnostics: diag,
  });

  const surfaced = args.analysis.magnetDiagnostics?.surfacedMagnets ?? [];

  return {
    address: args.address,
    selectedGeocode: args.geocode
      ? {
          lat: args.geocode.lat,
          lon: args.geocode.lon,
          displayName: args.geocode.displayName,
          geocodeDebug: args.geocode.geocodeDebug,
        }
      : null,
    evidenceFlags: buildDemoPublicEvidenceFlags(args.analysis),
    strongAnchorsForDemoCap: listStrongDemoAnchors(args.analysis),
    headlineCap: applyDemoFreeHeadlineCaps(args.analysis),
    magnetsUsedInScoring:
      surfaced.length > 0
        ? surfaced.map(s => ({
            categoryId: s.classifiedCategoryId ?? '',
            subType: s.classifiedSubType,
            distanceM: s.distanceM,
            name: s.name,
          }))
        : (args.analysis.magnets ?? []).map(m => ({
            categoryId: m.categoryId,
            subType: m.subType,
            distanceM: Math.round(m.distance),
            name: m.name,
          })),
    rawPositiveFactors: [...pos],
    rawNegativeFactors: [...neg],
    reportBullets,
    bulletsRemovedByEvidenceGate: [...diag.bulletsRemovedByEvidenceGate],
    bulletsCollapsedSemanticDup: [...diag.bulletsCollapsedSemanticDup],
  };
}
