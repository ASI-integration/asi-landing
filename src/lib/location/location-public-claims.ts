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
import { passesRuResidentialWeakTouristPromotionGate } from './location-public-summary';
import {
  FORBIDDEN_PUBLIC_WORDING_RU,
  looksLikeSmallCommunityMuseumPublicSurfacePoi,
  looksLikeWeakPublicTouristSurfacePoi,
} from './signals/location-signal-taxonomy';

function magnetCategoryIdFromFactKey(id: string): string {
  const parts = id.split(':');
  return parts.length >= 3 ? parts[2]! : '';
}

/** Hotels / weak leisure never qualify as “real tourist anchor” for headline copy */
function kernelAllowsTourismPublicHeadline(decision: LocationDecision): boolean {
  const k = decision.demandKernelV1;
  if (!k) return false;

  const anchorCats = new Set(['stadium', 'convention', 'entertainment', 'attraction']);

  const proximityMagnets = decision.magnetFacts.map(mf => ({
    categoryId: magnetCategoryIdFromFactKey(mf.id),
    distance: mf.distanceMeters ?? 0,
  }));

  return k.scoredDrivers.some(d => {
    if (!d.publicDisplayEligible || d.demandTypeVote !== 'tourist') return false;
    if (d.driverKind !== 'real_demand_driver') return false;

    const cat = magnetCategoryIdFromFactKey(d.magnetFactId);
    if (cat === 'major_hotel' || cat === 'mid_hotel') return false;
    if (!anchorCats.has(cat)) return false;
    if (cat === 'attraction' && (d.resolvedTier >= 3 || d.scaleClass === 'weak_local')) return false;
    if (d.resolvedTier > 2) return false;

    if (cat === 'attraction') {
      const mf = decision.magnetFacts.find(m => m.id === d.magnetFactId);
      if (!mf) return false;
      const magnet = { categoryId: cat, name: mf.name };
      const cautiousAttraction =
        looksLikeWeakPublicTouristSurfacePoi(magnet) || looksLikeSmallCommunityMuseumPublicSurfacePoi(magnet);
      if (
        cautiousAttraction &&
        !passesRuResidentialWeakTouristPromotionGate({
          d,
          magnet,
          proximityMagnets,
          demandSignals: decision.demandSignals,
          specialMarketFlags: k.specialMarketFlags,
        })
      ) {
        return false;
      }
    }

    return true;
  });
}

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
  if (decision.publicSummary && locale === 'ru') {
    return decision.publicSummary.headlineRu;
  }

  const kernel = decision.demandKernelV1;
  if (kernel) {
    const dominantKernel = kernel.dominantDemandType;

    if (dominantKernel === 'weak/unclear') {
      const incomplete = decision.demandSignals.find(s => s.id === 'ds:generic_incomplete_data');
      if (locale === 'ru') {
        if (incomplete) return incomplete.publicLabelRu;
        return 'Профиль спроса пока выглядит ограниченно — сильные точки спроса рядом не подтверждены.';
      }
      if (incomplete?.reason) return 'Insufficient map evidence to profile demand.';
      return 'Limited demand profile — no stable demand anchors confirmed on the map.';
    }

    if (locale === 'ru') {
      switch (dominantKernel) {
        case 'medical':
          return 'Медицинские объекты рядом могут поддерживать спрос';
        case 'corporate/business':
          return 'Спрос от делового и офисного трафика';
        case 'transport':
          return 'Транзитный и транспортно-связанный спрос';
        case 'industrial':
          return 'Промышленно-деловой профиль спроса';
        case 'tourist':
          if (!kernelAllowsTourismPublicHeadline(decision)) {
            return 'Предварительная оценка: спрос выглядит неоднозначным';
          }
          return 'Туристический и событийный спрос: рядом есть точки досуга и интереса';
        case 'education':
          return 'Образовательно-деловой профиль спроса';
        case 'mixed':
          return 'Предварительная оценка: спрос выглядит неоднозначным';
        default:
          break;
      }
    } else {
      switch (dominantKernel) {
        case 'medical':
          return 'Medical-anchor demand (kernel-weighted)';
        case 'corporate/business':
          return 'Business and office traffic demand';
        case 'transport':
          return 'Transit-linked demand';
        case 'industrial':
          return 'Industrial/business-led demand';
        case 'tourist':
          if (!kernelAllowsTourismPublicHeadline(decision)) {
            return 'Mixed demand profile from map evidence';
          }
          return 'Tourism/event-led demand (map anchors)';
        case 'education':
          return 'Education-related demand profile';
        case 'mixed':
          return 'Mixed demand profile from map evidence';
        default:
          break;
      }
    }
  }

  const incomplete = decision.demandSignals.find(s => s.id === 'ds:generic_incomplete_data');
  const signals = decision.demandSignals.filter(s => s.id !== 'ds:generic_incomplete_data');
  if (signals.length === 0) {
    if (locale === 'ru') {
      if (incomplete) return incomplete.publicLabelRu;
      return decision.demandKernelV1
        ? 'Профиль спроса пока выглядит ограниченно — сильные точки спроса рядом не подтверждены.'
        : 'По открытым данным профиль спроса пока не выделен.';
    }
    if (incomplete?.reason) return 'Insufficient map evidence to profile demand.';
    return decision.demandKernelV1
      ? 'Limited demand profile — no stable demand anchors confirmed on the map.'
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
        return 'Туристический и событийный спрос: рядом есть точки досуга и интереса';
      case 'business_demand':
        return 'Спрос от делового и офисного трафика';
      case 'accessibility':
      case 'transport_anchor':
        return 'Транзитный и транспортно-связанный спрос';
      case 'medical_demand':
        return 'Рядом есть медицинские объекты';
      default:
        return 'Предварительная оценка: спрос выглядит неоднозначным';
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
