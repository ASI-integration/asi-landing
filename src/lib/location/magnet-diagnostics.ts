/**
 * Internal magnet pipeline diagnostics — not shown to end users.
 * Used from tests and optional metadata consumers only.
 */

export type SuppressedMagnetReason =
  | 'outside_radius'
  | 'low_priority'
  | 'unknown_category'
  | 'hidden_from_free_report'
  | 'missing_required_tags'
  | 'duplicate_or_weak_signal';

export interface MagnetDiagnosticCandidate {
  osmType?: 'node' | 'way' | 'relation';
  osmId?: number;
  name: string;
  distanceM: number;
  /** Snapshot of OSM tags for debugging */
  tags?: Record<string, string>;
  /** After classifyElement / hub classification */
  classifiedCategoryId?: string;
  classifiedSubType?: string;
}

export interface SuppressedMagnetEntry extends MagnetDiagnosticCandidate {
  reason: SuppressedMagnetReason;
  /** Optional clarifying note for tests */
  detail?: string;
}

export interface MagnetDiagnosticsLayer {
  queriedCandidates: MagnetDiagnosticCandidate[];
  classifiedCandidates: MagnetDiagnosticCandidate[];
  surfacedMagnets: MagnetDiagnosticCandidate[];
  suppressedMagnets: SuppressedMagnetEntry[];
}

export function emptyMagnetDiagnostics(): MagnetDiagnosticsLayer {
  return {
    queriedCandidates: [],
    classifiedCandidates: [],
    surfacedMagnets: [],
    suppressedMagnets: [],
  };
}
