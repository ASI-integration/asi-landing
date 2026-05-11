/**
 * Canonical public claim assembly — UI bullets trace to MagnetFact + EvidenceItem + DemandSignal.
 */

import type {
  DemandSignal,
  LocationDecision,
  LocationEvidenceItem,
  LocationPublicClaim,
  MagnetFact,
} from './location-decision-contract';
import { FORBIDDEN_PUBLIC_WORDING_RU } from './signals/location-signal-taxonomy';

export function buildPublicClaimsRu(input: {
  evidenceItems: readonly LocationEvidenceItem[];
  magnetFacts: readonly MagnetFact[];
  demandSignals: readonly DemandSignal[];
}): LocationPublicClaim[] {
  const claims: LocationPublicClaim[] = [];
  for (const ev of input.evidenceItems) {
    const mf = input.magnetFacts.find(m => m.id === ev.factId);
    if (!mf) continue;

    const ds =
      input.demandSignals.find(s => s.evidenceFactIds.includes(ev.factId)) ?? null;
    const eligibilityReason =
      ds?.internalReason ?? `kernel_evidence:${mf.role}:${mf.tier}:score=${mf.includedInScore}`;

    claims.push({
      textRu: ev.publicExplanationRu,
      trace: {
        magnetFactId: mf.id,
        evidenceId: ev.evidenceId,
        demandSignalId: ds?.id ?? null,
        eligibilityReason,
      },
    });
  }
  return claims;
}

export function validatePublicClaimPipeline(input: {
  magnetFacts: readonly MagnetFact[];
  evidenceItems: readonly LocationEvidenceItem[];
  demandSignals: readonly DemandSignal[];
  publicClaims: readonly LocationPublicClaim[];
}): string[] {
  const problems: string[] = [];

  for (const ev of input.evidenceItems) {
    const mf = input.magnetFacts.find(m => m.id === ev.factId);
    if (!mf) problems.push(`orphan_evidence:${ev.evidenceId}->${ev.factId}`);
    else {
      if (
        mf.evidenceSource === 'classified_magnet' &&
        mf.role !== 'accessibility' &&
        (!Number.isFinite(mf.distanceMeters) || mf.distanceMeters <= 0)
      ) {
        problems.push(`distance_missing_magnet:${mf.id}`);
      }
      if (!mf.name.trim() && mf.role !== 'accessibility') {
        problems.push(`unnamed_magnet:${mf.id}`);
      }
    }
  }

  for (const c of input.publicClaims) {
    if (!c.trace.magnetFactId || !c.trace.evidenceId) {
      problems.push('public_claim_missing_trace_ids');
    }
    if (!input.magnetFacts.some(m => m.id === c.trace.magnetFactId)) {
      problems.push(`public_claim_orphan_magnet:${c.trace.magnetFactId}`);
    }
  }

  return problems;
}

/** Test / QA lint — keeps production warnings quiet while guarding copy policy in CI. */
export function lintPublicClaimSurfaceRu(claims: readonly LocationPublicClaim[]): string[] {
  const problems: string[] = [];
  for (const c of claims) {
    const lowered = c.textRu.toLowerCase();
    for (const banned of FORBIDDEN_PUBLIC_WORDING_RU) {
      if (lowered.includes(banned.toLowerCase())) {
        problems.push(`forbidden_wording:${banned}:${c.trace.evidenceId}`);
        break;
      }
    }
    if (!/\d/.test(c.textRu) || !/около/i.test(c.textRu)) {
      problems.push(`distance_token_missing:${c.trace.evidenceId}`);
    }
  }
  return problems;
}

export function publicDemandProfileHeadline(
  decision: LocationDecision,
  locale: 'ru' | 'en',
): string {
  const incomplete = decision.demandSignals.find(s => s.id === 'ds:generic_incomplete_data');
  const signals = decision.demandSignals.filter(s => s.id !== 'ds:generic_incomplete_data');
  if (signals.length === 0) {
    if (locale === 'ru') {
      return incomplete?.publicLabelRu ?? 'Профиль спроса не выделен по данным карты.';
    }
    return incomplete?.reason
      ? 'Insufficient map evidence to profile demand.'
      : 'Demand profile not identifiable from map evidence.';
  }

  const rank = (s: DemandSignal) =>
    s.strength === 'strong' ? 3 : s.strength === 'moderate' ? 2 : 1;
  const ranked = [...signals].sort((a, b) => rank(b) - rank(a));
  const top = ranked[0]!;
  const mf = decision.magnetFacts.find(m => m.id === top.evidenceFactIds[0]);

  const role = mf?.role;
  if (locale === 'ru') {
    switch (role) {
      case 'tourist_demand':
      case 'event_demand':
        return 'Туристический и событийный спрос в зоне (по якорям карты)';
      case 'business_demand':
        return 'Спрос от делового и офисного трафика';
      case 'accessibility':
      case 'transport_anchor':
        return 'Транзитный и транспортно-связанный спрос';
      case 'medical_demand':
        return 'Спрос с медицинским якорем в зоне';
      default:
        return 'Смешанный профиль спроса по данным карты';
    }
  }

  switch (role) {
    case 'tourist_demand':
    case 'event_demand':
      return 'Tourism/event-led demand (map anchors)';
    case 'business_demand':
      return 'Business and office traffic demand';
    case 'accessibility':
    case 'transport_anchor':
      return 'Transit-linked demand';
    case 'medical_demand':
      return 'Medical-anchor demand in the area';
    default:
      return 'Mixed demand profile from map evidence';
  }
}
