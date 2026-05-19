/**
 * Single RU residential demo public presentation contract.
 * All hero/demand/verdict/bullets/strategy copy for the free demo must derive from here only.
 */

import type { LocationAnalysis, MagnetItem } from './types';
import type { SpecialMarketFlag } from './city-scale-from-address';
import type {
  DemandSignal,
  LocationDecisionScoreBand,
  LocationEvidenceItem,
  LocationPublicClaim,
  LocationPublicDriverRow,
  LocationPublicPresentationDiagnostics,
  LocationPublicRejectedRow,
  LocationPublicSummary,
  LocationPublicSummaryDemandType,
  MagnetFact,
  MagnetTier,
} from './location-decision-contract';
import type {
  LocationDemandScoredDriver,
  LocationDemandScoringKernelResult,
} from './location-scoring-contract';
import { computeResidentialDemoPresentation } from './rules/residential-location-rules';
import { formatPublicEvidenceLineRu } from './location-decision-rules';
import {
  isStrongBusinessAnchorPoi,
  looksLikeSmallCommunityMuseumPublicSurfacePoi,
  looksLikeWeakLocalAttractionPoi,
  looksLikeWeakLocalBusinessPoi,
  looksLikeWeakLocalRetailPoi,
  looksLikeWeakPublicTouristSurfacePoi,
} from './signals/location-signal-taxonomy';
import { magnetRoleForScoredDriver } from './location-scoring-kernel';
import { medicalPrimaryStrongPublicCopyEligible } from './location-medical-surface-policy';
import {
  canonicalLevel1Priority,
  canonicalMagnetDedupeKey,
  classifyLevel1Magnet,
  isBackgroundMinorPoi,
} from './level1-magnet-taxonomy';
import {
  buildPortCityStrategicContextCopyRu,
  CITY_LEVEL_STRATEGIC_WEAK_DEMAND_BLOCKED_RU,
  cityLevelStrategicAnchorOnlyContext,
  hasPortLogisticsMagnet,
  inferPublicScoreConfidence,
  portCityStrategicContextActive,
  publicScoreLabelRuForConfidence,
} from './location-evidence-anchor';
import type { LocationPublicScoreConfidence } from './location-decision-contract';

export const CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID = 'mf:canonical:market_context_port';
export const CANONICAL_PORT_MARKET_CONTEXT_EVIDENCE_ID = 'ev:canonical:market_context_port';

/** @deprecated Prefer {@link buildPortCityStrategicContextCopyRu} with city name from kernel inference. */
export const CANONICAL_PORT_MARKET_CONTEXT_FALLBACK_RU = buildPortCityStrategicContextCopyRu('город');

function magnetForDriver(d: LocationDemandScoredDriver, magnets: readonly MagnetItem[]): MagnetItem | undefined {
  const parts = d.magnetFactId.split(':');
  const i = parts.length >= 2 ? Number.parseInt(parts[1]!, 10) : NaN;
  if (!Number.isFinite(i)) return undefined;
  return magnets[i];
}

type MagnetProximity = Pick<MagnetItem, 'categoryId' | 'distance'>;

/** Map-backed stadium/convention proximity strong enough to justify promoting cautious attractions in public copy. */
export function hasVerifiedPublicTouristClusterProximity(magnets: readonly MagnetProximity[]): boolean {
  return magnets.some(
    m => (m.categoryId === 'stadium' || m.categoryId === 'convention') && m.distance <= 1200,
  );
}

function maxEvidenceSupportCountForFact(demandSignals: readonly DemandSignal[], factId: string): number {
  let best = 0;
  for (const s of demandSignals) {
    if (!s.evidenceFactIds.includes(factId)) continue;
    best = Math.max(best, s.evidenceFactIds.length);
  }
  return best;
}

/**
 * Weak-pattern / neighbourhood museum attractions need extra evidence before they may headline as tourist demand.
 */
export function passesRuResidentialWeakTouristPromotionGate(args: {
  d: LocationDemandScoredDriver;
  magnet: Pick<MagnetItem, 'categoryId' | 'name'>;
  proximityMagnets: readonly MagnetProximity[];
  demandSignals: readonly DemandSignal[];
  specialMarketFlags: readonly SpecialMarketFlag[];
}): boolean {
  const { d, magnet, proximityMagnets, demandSignals, specialMarketFlags } = args;
  const weakSurface = looksLikeWeakPublicTouristSurfacePoi(magnet);
  const smallMuseum = looksLikeSmallCommunityMuseumPublicSurfacePoi(magnet);
  if (!weakSurface && !smallMuseum) return true;

  const tierStrong = d.resolvedTier === 1 && d.scaleClass === 'verified_major';
  const multiEvidence = maxEvidenceSupportCountForFact(demandSignals, d.magnetFactId) >= 2;
  const cluster = hasVerifiedPublicTouristClusterProximity(proximityMagnets);
  const resort =
    specialMarketFlags.includes('resort_exception') || specialMarketFlags.includes('federal_tourist_anchor');

  if (tierStrong) return true;
  if (multiEvidence) return true;
  if (cluster) return true;

  if (resort && d.driverKind === 'real_demand_driver' && d.scaleClass !== 'weak_local') {
    return !weakSurface;
  }

  return false;
}

function needsRuResidentialWeakTouristPromotionGate(m: MagnetItem, d: LocationDemandScoredDriver): boolean {
  return (
    d.demandTypeVote === 'tourist' &&
    m.categoryId === 'attraction' &&
    (looksLikeWeakPublicTouristSurfacePoi(m) || looksLikeSmallCommunityMuseumPublicSurfacePoi(m))
  );
}

const TOURIST_ANCHOR_CATS = new Set(['stadium', 'convention', 'attraction']);

/** Verified map-backed tourist anchors for STR (not hotels / nightlife / generic retail). */
export function verifiedTouristAnchorDrivers(
  drivers: readonly LocationDemandScoredDriver[],
  magnets: readonly MagnetItem[],
  args?: {
    allowWeakLocalAttractionInResort?: boolean;
    demandSignals?: readonly DemandSignal[];
    specialMarketFlags?: readonly SpecialMarketFlag[];
  },
): LocationDemandScoredDriver[] {
  const allowWeakLocalAttractionInResort = Boolean(args?.allowWeakLocalAttractionInResort);
  const demandSignals = args?.demandSignals ?? [];
  const specialMarketFlags = args?.specialMarketFlags ?? [];
  const proximityMagnets = magnets.map(m => ({ categoryId: m.categoryId, distance: m.distance }));

  return drivers.filter(d => {
    if (!d.accepted || d.demandTypeVote !== 'tourist') return false;
    if (d.driverKind !== 'real_demand_driver') return false;
    const m = magnetForDriver(d, magnets);
    const cat = m?.categoryId;
    if (!cat || cat === 'major_hotel' || cat === 'mid_hotel' || cat === 'entertainment') return false;
    if (!TOURIST_ANCHOR_CATS.has(cat)) return false;
    if (
      cat === 'attraction' &&
      (d.resolvedTier >= 3 || (d.scaleClass === 'weak_local' && !allowWeakLocalAttractionInResort))
    ) {
      return false;
    }
    if (m && cat === 'attraction' && needsRuResidentialWeakTouristPromotionGate(m, d)) {
      if (
        !passesRuResidentialWeakTouristPromotionGate({
          d,
          magnet: m,
          proximityMagnets,
          demandSignals,
          specialMarketFlags,
        })
      ) {
        return false;
      }
    }
    return d.resolvedTier <= 2;
  });
}

/**
 * Stricter than kernel `publicDisplayEligible` — residential demo bullets / headline drivers only.
 */
export function selectStrictPublicSummaryDrivers(args: {
  kernel: LocationDemandScoringKernelResult;
  magnets: readonly MagnetItem[];
  allowWeakLocalAttractionInResort?: boolean;
  /** When omitted, multi-evidence promotion for cautious attractions is unavailable (conservative). */
  demandSignals?: readonly DemandSignal[];
}): LocationDemandScoredDriver[] {
  const { kernel, magnets, allowWeakLocalAttractionInResort } = args;
  const demandSignals = args.demandSignals ?? [];
  const specialMarketFlags = kernel.specialMarketFlags;
  const pool = kernel.scoredDrivers.filter(d => {
    if (d.publicDisplayEligible) return true;
    if (!d.accepted || d.driverKind === 'noise' || d.driverKind === 'local_interest') return false;
    const m = magnetForDriver(d, magnets);
    return Boolean(m && classifyLevel1Magnet(m).isLevel1 && !isBackgroundMinorPoi(m));
  });
  const demandAnchors = pool.filter(
    d => d.driverKind === 'real_demand_driver' || d.driverKind === 'unknown_uncapped',
  );
  const transit = pool.filter(d => {
    if (d.driverKind !== 'supporting_infrastructure') return false;
    const m = magnetForDriver(d, magnets);
    return m?.categoryId === 'metro' || m?.categoryId === 'railway_station';
  });

  const prefiltered = [...demandAnchors, ...transit].sort((a, b) => {
    const aMagnet = magnetForDriver(a, magnets);
    const bMagnet = magnetForDriver(b, magnets);
    if (!aMagnet || !bMagnet) return b.finalContribution - a.finalContribution;
    const aLevel1 = classifyLevel1Magnet(aMagnet).isLevel1;
    const bLevel1 = classifyLevel1Magnet(bMagnet).isLevel1;
    if (aLevel1 !== bLevel1) return aLevel1 ? -1 : 1;
    const canonicalDiff = canonicalLevel1Priority(aMagnet) - canonicalLevel1Priority(bMagnet);
    if (canonicalDiff !== 0) return canonicalDiff;
    return b.finalContribution - a.finalContribution;
  });

  const out: LocationDemandScoredDriver[] = [];
  const seenFacts = new Set<string>();
  const seenCanonicalMagnets = new Set<string>();
  for (const d of prefiltered) {
    if (seenFacts.has(d.magnetFactId)) continue;
    const m = magnetForDriver(d, magnets);
    if (!m) continue;
    if (isBackgroundMinorPoi(m)) continue;
    if (
      !passesResidentialPublicSurfaceGate(d, m, {
        allowWeakLocalAttractionInResort: Boolean(allowWeakLocalAttractionInResort),
        magnets,
        demandSignals,
        specialMarketFlags,
      })
    ) {
      continue;
    }
    const canonicalKey = canonicalMagnetDedupeKey(m);
    if (seenCanonicalMagnets.has(canonicalKey)) continue;
    seenFacts.add(d.magnetFactId);
    seenCanonicalMagnets.add(canonicalKey);
    out.push(d);
  }

  return out.sort((a, b) => {
    const aMagnet = magnetForDriver(a, magnets);
    const bMagnet = magnetForDriver(b, magnets);
    if (!aMagnet || !bMagnet) return b.finalContribution - a.finalContribution;
    const aLevel1 = classifyLevel1Magnet(aMagnet).isLevel1;
    const bLevel1 = classifyLevel1Magnet(bMagnet).isLevel1;
    if (aLevel1 !== bLevel1) return aLevel1 ? -1 : 1;
    const canonicalDiff = canonicalLevel1Priority(aMagnet) - canonicalLevel1Priority(bMagnet);
    if (canonicalDiff !== 0) return canonicalDiff;
    return b.finalContribution - a.finalContribution;
  });
}

function passesResidentialPublicSurfaceGate(
  d: LocationDemandScoredDriver,
  m: MagnetItem,
  args: {
    allowWeakLocalAttractionInResort: boolean;
    magnets: readonly MagnetItem[];
    demandSignals: readonly DemandSignal[];
    specialMarketFlags: readonly SpecialMarketFlag[];
  },
): boolean {
  if (m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel') return false;
  if (m.categoryId === 'entertainment') return false;
  if (m.categoryId === 'shopping_local' || m.categoryId === 'food') return false;
  if (m.categoryId === 'shopping_major' && looksLikeWeakLocalRetailPoi(m)) return false;
  if (m.categoryId === 'shopping_major') return false;

  if (m.categoryId === 'business') {
    if (looksLikeWeakLocalBusinessPoi(m)) return false;
    if (!isStrongBusinessAnchorPoi(m)) return false;
  }

  if (m.categoryId === 'attraction' && looksLikeWeakLocalAttractionPoi(m) && !args.allowWeakLocalAttractionInResort) {
    return false;
  }

  const n = `${m.name} ${m.subType ?? ''}`.toLowerCase();
  if (
    /nightclub|ночн(ой|ая)\s+клуб|клуб\s+ночн/i.test(n) ||
    /ремонт\s*(?:телефон|смартфон|мобильн)|телефонн|сотов|mobile\s*phone|phone\s*repair|айфон|iphone/i.test(n) ||
    /кадров(ое|ая|ый)\s+агентств/i.test(n)
  ) {
    return false;
  }

  if (needsRuResidentialWeakTouristPromotionGate(m, d)) {
    const proximityMagnets = args.magnets.map(x => ({ categoryId: x.categoryId, distance: x.distance }));
    if (
      !passesRuResidentialWeakTouristPromotionGate({
        d,
        magnet: m,
        proximityMagnets,
        demandSignals: args.demandSignals,
        specialMarketFlags: args.specialMarketFlags,
      })
    ) {
      return false;
    }
  }

  if (m.categoryId === 'attraction' && d.resolvedTier >= 3) return false;

  return true;
}

function contributionWeight(d: LocationDemandScoredDriver): number {
  if (!d.accepted) return 0;
  if (d.driverKind === 'noise' || d.driverKind === 'local_interest') return 0;
  if (d.driverKind === 'supporting_infrastructure') return d.finalContribution * 0.35;
  return d.finalContribution;
}

function arbitratePrimaryFromDrivers(
  drivers: readonly LocationDemandScoredDriver[],
): LocationPublicSummaryDemandType {
  const buckets = new Map<LocationPublicSummaryDemandType, number>();
  for (const d of drivers) {
    const w = contributionWeight(d);
    if (!d.demandTypeVote || w <= 0) continue;
    buckets.set(d.demandTypeVote, (buckets.get(d.demandTypeVote) ?? 0) + w);
  }
  if (buckets.size === 0) return 'weak/unclear';

  let bestType: LocationPublicSummaryDemandType = 'weak/unclear';
  let best = 0;
  let second = 0;
  for (const [t, v] of buckets) {
    if (v > best) {
      second = best;
      best = v;
      bestType = t;
    } else if (v > second) second = v;
  }
  const total = [...buckets.values()].reduce((a, b) => a + b, 0);
  if (best < total * 0.28) return 'mixed';
  if (second >= best * 0.85 && bestType !== 'weak/unclear') return 'mixed';
  return bestType;
}

function medicalMass(drivers: readonly LocationDemandScoredDriver[]): number {
  return drivers
    .filter(d => d.demandTypeVote === 'medical' && contributionWeight(d) > 0)
    .reduce((s, d) => s + contributionWeight(d), 0);
}

function touristMass(drivers: readonly LocationDemandScoredDriver[]): number {
  return drivers
    .filter(d => d.demandTypeVote === 'tourist' && contributionWeight(d) > 0)
    .reduce((s, d) => s + contributionWeight(d), 0);
}

function businessMass(drivers: readonly LocationDemandScoredDriver[]): number {
  return drivers
    .filter(
      d =>
        (d.demandTypeVote === 'corporate/business' ||
          d.demandTypeVote === 'industrial' ||
          d.demandTypeVote === 'education') &&
        contributionWeight(d) > 0,
    )
    .reduce((s, d) => s + contributionWeight(d), 0);
}

function commanderEligibleEducationCluster(drivers: readonly LocationDemandScoredDriver[]): boolean {
  const strongUniversity = drivers.filter(
    d =>
      d.demandTypeVote === 'education' &&
      contributionWeight(d) >= 0.42 &&
      /университет|академия|федеральн|государственн|кампус|university|campus/i.test(d.sourceName),
  );
  return strongUniversity.length >= 2;
}

function commanderEligibleTransportCluster(drivers: readonly LocationDemandScoredDriver[]): boolean {
  return drivers.some(
    d =>
      d.demandTypeVote === 'transport' &&
      contributionWeight(d) >= 1.5 &&
      (d.driverKind === 'real_demand_driver' || d.driverKind === 'unknown_uncapped'),
  );
}

function commanderEligibleMedicalCluster(drivers: readonly LocationDemandScoredDriver[]): boolean {
  const strongNamedMedical = drivers.filter(
    d =>
      d.demandTypeVote === 'medical' &&
      contributionWeight(d) >= 0.42 &&
      /областн|краев|республик|федеральн|научн|научно-исследовательск|(?:^|\s)нии(?:$|\s|\W)|университетск|перинатальн|онколог|кардиолог|инфекцион|многопрофильн|гематолог|трансфузиолог/i.test(
        d.sourceName,
      ),
  );
  return strongNamedMedical.length >= 2;
}

function commanderEligibleBusinessCluster(args: {
  primary: LocationPublicSummaryDemandType;
  secondaries: readonly LocationPublicSummaryDemandType[];
  drivers: readonly LocationDemandScoredDriver[];
}): boolean {
  const businessDrivers = args.drivers.filter(
    d =>
      (d.demandTypeVote === 'corporate/business' || d.demandTypeVote === 'industrial') &&
      contributionWeight(d) >= 0.42,
  );
  const mass = businessDrivers.reduce((s, d) => s + contributionWeight(d), 0);
  if (businessDrivers.length >= 2) return true;
  if (args.primary === 'medical' || args.primary === 'education') return false;
  return hasStrongSecondaryBusiness(args.secondaries) && mass >= 1.5;
}

function secondariesFromPrimary(
  primary: LocationPublicSummaryDemandType,
  drivers: readonly LocationDemandScoredDriver[],
): LocationPublicSummaryDemandType[] {
  const buckets = new Map<LocationPublicSummaryDemandType, number>();
  for (const d of drivers) {
    const w = contributionWeight(d);
    if (!d.demandTypeVote || w <= 0) continue;
    if (d.demandTypeVote === primary) continue;
    buckets.set(d.demandTypeVote, (buckets.get(d.demandTypeVote) ?? 0) + w);
  }
  return [...buckets.entries()]
    .filter(([, v]) => v >= 0.18)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 3);
}

function hasStrongSecondaryBusiness(secondaries: readonly LocationPublicSummaryDemandType[]): boolean {
  return secondaries.some(t => t === 'corporate/business' || t === 'industrial');
}

/** Strong enough to justify «командированных» copy alongside a tourist-primary headline. */
export function strongBusinessContributionFromDrivers(drivers: readonly LocationDemandScoredDriver[]): number {
  return drivers
    .filter(d => d.demandTypeVote === 'corporate/business' || d.demandTypeVote === 'industrial')
    .reduce((s, d) => s + contributionWeight(d), 0);
}

function buildHeadlineRu(args: {
  primary: LocationPublicSummaryDemandType;
  strictDrivers: readonly LocationDemandScoredDriver[];
  magnets: readonly MagnetItem[];
  incompleteLabel: string | null;
  allowWeakLocalAttractionInResort: boolean;
  demandSignals: readonly DemandSignal[];
  specialMarketFlags: readonly SpecialMarketFlag[];
  partialCartographicContext: boolean;
}): { text: string; reason: string; genericMedicalSuppressed?: boolean } {
  const { primary, strictDrivers, magnets, incompleteLabel, partialCartographicContext } = args;
  if (incompleteLabel) {
    return { text: incompleteLabel, reason: 'integrity:generic_incomplete_data_signal' };
  }

  const anchors = verifiedTouristAnchorDrivers(strictDrivers, magnets, {
    allowWeakLocalAttractionInResort: args.allowWeakLocalAttractionInResort,
    demandSignals: args.demandSignals,
    specialMarketFlags: args.specialMarketFlags,
  });
  const mixedUnstable = 'Данных пока недостаточно для уверенного вывода';

  if (strictDrivers.length === 0) {
    return { text: mixedUnstable, reason: 'no_strict_public_drivers_after_surface_gates' };
  }

  if (primary === 'tourist' && anchors.length === 0) {
    const hasNonTouristMass = strictDrivers.some(
      x => Boolean(x.demandTypeVote && x.demandTypeVote !== 'tourist' && contributionWeight(x) > 0),
    );
    return {
      text: hasNonTouristMass ? 'Смешанный локальный спрос' : 'Обычная жилая локация с отдельными точками интереса',
      reason: 'tourist_primary_without_promotable_tourist_anchor',
    };
  }

  const med = medicalMass(strictDrivers);
  const tour = touristMass(strictDrivers);
  if (med > tour * 1.12 && med >= 0.14) {
    if (primary === 'tourist') {
      const medEligible = medicalPrimaryStrongPublicCopyEligible({
        strictDrivers,
        magnets,
        specialMarketFlags: args.specialMarketFlags,
      });
      if (medEligible) {
        return {
          text: 'Смешанный спрос: медицина в окружении заметнее досуга',
          reason: 'medical_public_driver_mass_over_tourist',
        };
      }
    }
  }

  switch (primary) {
    case 'weak/unclear':
      return {
        text: 'Профиль спроса пока выглядит ограниченно — сильные точки спроса рядом не подтверждены.',
        reason: 'primary_weak_unclear',
      };
    case 'medical': {
      const eligible = medicalPrimaryStrongPublicCopyEligible({
        strictDrivers,
        magnets,
        specialMarketFlags: args.specialMarketFlags,
      });
      if (!eligible) {
        return {
          text: partialCartographicContext
            ? 'Предварительно: рядом есть медицинские объекты, нужна проверка карты'
            : 'Обычная жилая локация с отдельными медицинскими объектами поблизости',
          reason: partialCartographicContext
            ? 'medical_primary_suppressed_generic_partial_map'
            : 'medical_primary_suppressed_generic_surface',
          genericMedicalSuppressed: true,
        };
      }
      return {
        text: 'Медицинские объекты рядом могут поддерживать спрос',
        reason: 'primary_medical',
      };
    }
    case 'corporate/business':
      return { text: 'Спрос от делового и офисного трафика', reason: 'primary_business' };
    case 'transport':
      return { text: 'Транзитный и транспортно-связанный спрос', reason: 'primary_transport' };
    case 'industrial':
      return { text: 'Промышленно-деловой профиль спроса', reason: 'primary_industrial' };
    case 'tourist':
      return {
        text: 'Туристический и событийный спрос: рядом есть точки досуга и интереса',
        reason: 'primary_tourist_verified',
      };
    case 'education':
      return { text: 'Образовательно-деловой профиль спроса', reason: 'primary_education' };
    case 'mixed':
      if (med >= 0.14 && businessMass(strictDrivers) >= 0.12) {
        return { text: 'Смешанный спрос: медицина и деловой контекст', reason: 'mixed_medical_business' };
      }
      return { text: 'Предварительная оценка: спрос выглядит неоднозначным', reason: 'primary_mixed' };
    default:
      return { text: mixedUnstable, reason: 'fallback' };
  }
}

function defaultStrategyRu(primary: LocationPublicSummaryDemandType, cautious: boolean): string[] {
  if (cautious) {
    return [
      'Публичная демо-оценка показывает только самые надёжные объекты на карте — спорные места скрыты.',
      'Для посуточной аренды и оценки конкуренции лучше заказать полный отчёт с детализацией.',
    ];
  }
  switch (primary) {
    case 'medical':
      return [
        'Держите чистоту и тишину в часы пик у клиник — это напрямую влияет на отзывы гостей.',
        'Короткие заезды «у клиники» часто чувствительны к парковке и быстрому заселению.',
      ];
    case 'corporate/business':
    case 'industrial':
      return [
        'Командировочный спрос любит предсказуемость: чёткие правила, быстрый Wi‑Fi, простое продление.',
        'Планируйте уборку и прачечную под график «вечер прилёта / ранний выезд».',
      ];
    case 'tourist':
      return [
        'Событийные пики требуют гибкой цены и минимального трения при заселении в часы концерта/матча.',
        'Сильные фото локации и «что рядом за 10 минут пешком» повышают конверсию туристического сегмента.',
      ];
    case 'transport':
      return [
        'Транзитный спрос ценит скорость ответа и позднее/раннее заселение без сюрпризов.',
        'Проверьте шум от линий и вибрацию окон — это частая причина негативных отзывов у вокзалов.',
      ];
    default:
      return [
        'Зафиксируйте сценарий гостя (1–3 ночи vs неделя) и под него настройте минимальный стандарт уборки и расходников.',
        'Если точки спроса спорные, полный отчёт поможет отделить привлекательную карту от реальной загрузки.',
      ];
  }
}

export function applyVerdictContradictionGuards(args: {
  baseVerdict: string;
  primary: LocationPublicSummaryDemandType;
  secondaries: readonly LocationPublicSummaryDemandType[];
  strictDrivers: readonly LocationDemandScoredDriver[];
}): { verdict: string; warnings: string[] } {
  const warnings: string[] = [];
  let verdict = args.baseVerdict;
  const { primary, secondaries, strictDrivers } = args;
  const bizMass = strongBusinessContributionFromDrivers(strictDrivers);

  if (primary === 'tourist' && /командированных/i.test(verdict)) {
    if (!hasStrongSecondaryBusiness(secondaries) || bizMass < 0.42) {
      warnings.push('contradiction_guard:tourist_primary_with_business_verdict_without_secondary_business');
      verdict = verdict.replace(/командированных/gi, 'посуточной аренды');
    }
  }

  if (primary === 'medical' && /туристическ/i.test(verdict)) {
    warnings.push('contradiction_guard:medical_primary_with_tourist_verdict');
    verdict = 'Рядом сильнее медицина — туризм для этой точки вторичен';
  }

  if (primary === 'tourist' && /медицинск/i.test(verdict)) {
    warnings.push('contradiction_guard:tourist_primary_with_medical_verdict');
    verdict = 'Туризм и события доминируют — медицинский профиль в публичном выводе не главный';
  }

  if (/командированных/i.test(verdict)) {
    const commanderEvidence =
      commanderEligibleBusinessCluster({ primary, secondaries, drivers: strictDrivers }) ||
      commanderEligibleTransportCluster(strictDrivers) ||
      commanderEligibleEducationCluster(strictDrivers) ||
      commanderEligibleMedicalCluster(strictDrivers);
    if (!commanderEvidence) {
      warnings.push('contradiction_guard:commander_verdict_without_strong_travel_evidence');
      verdict =
        primary === 'medical'
          ? 'Предварительно: рядом есть медицинские объекты, нужна проверка карты'
          : 'Хорошая локация с неоднозначным профилем спроса';
    }
  }

  return { verdict, warnings };
}

function cautiousVerdictFromScore(score: number): string {
  if (score >= 60) return 'Потенциал есть, но точки спроса рядом неоднозначны — нужен детальный разбор';
  if (score >= 45) return 'Осторожный вывод: явных сильных точек спроса мало';
  return 'Предварительная оценка слабая — для точного вывода нужен полный расчёт';
}

function compactRuNameList(names: readonly string[]): string {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }
  if (cleaned.length === 0) return '';
  if (cleaned.length <= 3) return cleaned.join(', ');
  return `${cleaned.slice(0, 3).join(', ')} и ещё ${cleaned.length - 3}`;
}

export function applyCityLevelStrategicVerdictGuard(args: {
  verdict: string;
  hasCityLevelStrategicAnchor: boolean;
  strictDrivers: readonly LocationDemandScoredDriver[];
  specialMarketFlags: readonly SpecialMarketFlag[];
  magnets: readonly MagnetItem[];
}): string {
  const { verdict, hasCityLevelStrategicAnchor, strictDrivers, specialMarketFlags, magnets } = args;
  if (!hasCityLevelStrategicAnchor) return verdict;

  if (/Слабый спрос/i.test(verdict)) {
    return CITY_LEVEL_STRATEGIC_WEAK_DEMAND_BLOCKED_RU;
  }

  const localLevel1 = strictDrivers.some(d => {
    const m = magnetForDriver(d, magnets);
    return Boolean(m && classifyLevel1Magnet(m).isLevel1);
  });
  if (localLevel1) return verdict;

  if (
    portCityStrategicContextActive({ specialMarketFlags, magnets }) &&
    /слаб|ограничен|неоднозначн|требует проверки/i.test(verdict)
  ) {
    return CITY_LEVEL_STRATEGIC_WEAK_DEMAND_BLOCKED_RU;
  }
  return verdict;
}

export function buildLocationPublicSummary(args: {
  analysis: LocationAnalysis;
  magnets: readonly MagnetItem[];
  magnetFacts: readonly MagnetFact[];
  kernel: LocationDemandScoringKernelResult;
  demandSignals: readonly DemandSignal[];
  finalScore: number | null;
  scoreBand: LocationDecisionScoreBand;
  baseWarnings: readonly string[];
  /** When provided, must match evidence construction in {@link buildLocationDecision}. */
  strictDrivers?: readonly LocationDemandScoredDriver[];
  /** Partial / incomplete map preview — tightens medical headline copy. */
  partialCartographicContext?: boolean;
  /** Seeded by {@link buildLocationDecision}; headline step may set `genericMedicalSuppressed`. */
  presentationDiagnostics?: LocationPublicPresentationDiagnostics;
  dataIntegrity?: {
    analysisIncomplete?: boolean;
    scoreBlockedDueToIncompleteData?: boolean;
  };
  classifiedMagnetCount?: number;
  inferredCityName?: string | null;
}): LocationPublicSummary {
  const debugTrace: string[] = [];
  const warnings = [...args.baseWarnings];
  const { kernel, magnets, magnetFacts, demandSignals, finalScore, scoreBand } = args;
  const partialCartographicContext = Boolean(args.partialCartographicContext);
  const diagSeed = args.presentationDiagnostics;

  debugTrace.push(
    `cityScale=${kernel.cityScale}:populationTier=${kernel.populationTier}:marketGravity=${kernel.marketGravityCoefficient.toFixed(
      2,
    )}:flags=${kernel.specialMarketFlags.length ? kernel.specialMarketFlags.join(',') : 'none'}`,
  );
  if (kernel.scoreCapReason) {
    debugTrace.push(`scoreCapReason=${kernel.scoreCapReason}`);
  }

  const incomplete = demandSignals.find(s => s.id === 'ds:generic_incomplete_data');

  const strictDrivers =
    args.strictDrivers ??
    selectStrictPublicSummaryDrivers({
      kernel,
      magnets,
      demandSignals,
      allowWeakLocalAttractionInResort:
        kernel.specialMarketFlags.includes('resort_exception') ||
        kernel.specialMarketFlags.includes('federal_tourist_anchor'),
    });
  debugTrace.push(`strict_public_drivers=${strictDrivers.length}`);

  const allowWeakLocalAttractionInResort =
    kernel.specialMarketFlags.includes('resort_exception') ||
    kernel.specialMarketFlags.includes('federal_tourist_anchor');

  const rejectedFromPublic: LocationPublicRejectedRow[] = [];
  for (const d of kernel.scoredDrivers) {
    if (!d.publicDisplayEligible) {
      if (d.accepted && d.finalContribution >= 0.08) {
        rejectedFromPublic.push({
          sourceName: d.sourceName,
          reason: d.publicDisplayRejectReason ?? 'not_public_display_eligible',
        });
      }
      continue;
    }
    const m = magnetForDriver(d, magnets);
    if (
      m &&
      !passesResidentialPublicSurfaceGate(d, m, {
        allowWeakLocalAttractionInResort,
        magnets,
        demandSignals,
        specialMarketFlags: kernel.specialMarketFlags,
      })
    ) {
      rejectedFromPublic.push({
        sourceName: d.sourceName,
        reason: 'summary_surface_gate:non_anchor_category_or_weak_business',
      });
    }
  }

  let primary = arbitratePrimaryFromDrivers(strictDrivers);
  const medM = medicalMass(strictDrivers);
  const tourM = touristMass(strictDrivers);
  if (strictDrivers.length > 0 && medM > tourM * 1.15 && medM >= 0.16) {
    if (primary === 'tourist' || primary === 'mixed') {
      const wouldMedical = medM > businessMass(strictDrivers) * 1.05;
      const medSurfaceOk = medicalPrimaryStrongPublicCopyEligible({
        strictDrivers,
        magnets,
        specialMarketFlags: kernel.specialMarketFlags,
      });
      primary = wouldMedical ? (medSurfaceOk ? 'medical' : 'mixed') : 'mixed';
      debugTrace.push('override_primary_to_medical_or_mixed_by_public_driver_mass');
    }
  }

  const secondaries = secondariesFromPrimary(primary, strictDrivers);

  const headline = buildHeadlineRu({
    primary,
    strictDrivers,
    magnets,
    incompleteLabel: incomplete?.publicLabelRu ?? null,
    allowWeakLocalAttractionInResort:
      kernel.specialMarketFlags.includes('resort_exception') || kernel.specialMarketFlags.includes('federal_tourist_anchor'),
    demandSignals,
    specialMarketFlags: kernel.specialMarketFlags,
    partialCartographicContext,
  });

  const headlineRu = headline.text;
  debugTrace.push(`headline:${headline.reason}`);

  const portFallbackActive =
    kernel.specialMarketFlags.includes('port_or_logistics_gateway') && !hasPortLogisticsMagnet(magnets);
  const cityLevelStrategicOnly = cityLevelStrategicAnchorOnlyContext({
    specialMarketFlags: kernel.specialMarketFlags,
    magnets,
    strictPublicDriverCount: strictDrivers.length,
    hasCanonicalPortFallback: portFallbackActive,
  });
  const hasCityLevelStrategicAnchor = portFallbackActive;

  const publicScoreConfidence: LocationPublicScoreConfidence = inferPublicScoreConfidence({
    score: finalScore,
    partialCartographicPreview: partialCartographicContext,
    analysisIncomplete: args.dataIntegrity?.analysisIncomplete,
    scoreBlockedDueToIncompleteData: args.dataIntegrity?.scoreBlockedDueToIncompleteData,
    cityLevelStrategicOnly,
    strictPublicDriverCount: strictDrivers.length,
    classifiedMagnetCount: args.classifiedMagnetCount ?? magnets.length,
  });
  const publicScoreLabelRu = publicScoreLabelRuForConfidence(publicScoreConfidence, finalScore);

  const presentationDiagnostics: LocationPublicPresentationDiagnostics = {
    partialCartographicPreview: diagSeed?.partialCartographicPreview ?? partialCartographicContext,
    partialDataScoreCapApplied: diagSeed?.partialDataScoreCapApplied ?? false,
    partialDataScoreCapReason: diagSeed?.partialDataScoreCapReason ?? null,
    scoreBeforePartialDataCap: diagSeed?.scoreBeforePartialDataCap ?? null,
    scoreAfterPartialDataCap: diagSeed?.scoreAfterPartialDataCap ?? finalScore,
    genericMedicalSuppressed: Boolean(headline.genericMedicalSuppressed),
    verifiedMajorMedicalAnchorCount: diagSeed?.verifiedMajorMedicalAnchorCount ?? 0,
    fallbackPoiCount: diagSeed?.fallbackPoiCount ?? null,
    fallbackMedicalPoiCount: diagSeed?.fallbackMedicalPoiCount ?? null,
    nearbyClusterDetected: diagSeed?.nearbyClusterDetected ?? false,
    conservativeClusterFloorApplied: diagSeed?.conservativeClusterFloorApplied ?? false,
    clusterFloorReason: diagSeed?.clusterFloorReason ?? null,
    hasCityLevelStrategicAnchor,
    cityLevelStrategicAnchorOnly: cityLevelStrategicOnly,
  };

  const scoreForSanity = finalScore ?? 0;
  const { sanity } = computeResidentialDemoPresentation(args.analysis, scoreForSanity, {
    hasCityLevelStrategicAnchor: hasCityLevelStrategicAnchor,
  });

  const noClean = strictDrivers.length === 0;
  let audienceVerdictRu = sanity.verdictLabelRu;
  let verdictReason = 'residential_demo_presentation_verdict';

  if (noClean) {
    audienceVerdictRu = cautiousVerdictFromScore(scoreForSanity);
    verdictReason = 'no_strict_public_drivers:cautious_verdict';
  } else if (/Сильная/i.test(audienceVerdictRu)) {
    if (primary === 'mixed' || primary === 'weak/unclear') {
      audienceVerdictRu = scoreForSanity >= 60 ? 'Хорошая локация с неоднозначным профилем спроса' : cautiousVerdictFromScore(scoreForSanity);
      verdictReason = 'downgrade_strong_verdict_for_mixed_or_weak_primary';
    }
  }

  const contradiction = applyVerdictContradictionGuards({
    baseVerdict: audienceVerdictRu,
    primary,
    secondaries,
    strictDrivers,
  });
  audienceVerdictRu = applyCityLevelStrategicVerdictGuard({
    verdict: contradiction.verdict,
    hasCityLevelStrategicAnchor,
    strictDrivers,
    specialMarketFlags: kernel.specialMarketFlags,
    magnets,
  });
  warnings.push(...contradiction.warnings);

  const supportingContext: string[] = [];
  if (strictDrivers.length > 0 && rejectedFromPublic.length > 0) {
    supportingContext.push(
      `Рядом есть дополнительные объекты на карте (${rejectedFromPublic.length}), они не учтены в упрощённом балле.`,
    );
  }

  const sliceDrivers = strictDrivers.slice(0, Math.min(5, strictDrivers.length));
  const medicalSliceDrivers = sliceDrivers.filter(d => d.demandTypeVote === 'medical');
  const medicalNames = medicalSliceDrivers
    .map(d => magnetFacts.find(m => m.id === d.magnetFactId)?.name ?? d.sourceName)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
  const groupedMedicalNames = compactRuNameList(medicalNames);
  const firstMedicalDriver = medicalSliceDrivers[0] ?? null;

  const portCityName = args.inferredCityName?.trim() || 'город';
  const portStrategicCopyRu = buildPortCityStrategicContextCopyRu(portCityName);

  const publicDrivers: LocationPublicDriverRow[] = [];
  if (portFallbackActive) {
    publicDrivers.push({
      textRu: portStrategicCopyRu,
      trace: {
        magnetFactId: CANONICAL_PORT_MARKET_CONTEXT_MAGNET_FACT_ID,
        evidenceId: CANONICAL_PORT_MARKET_CONTEXT_EVIDENCE_ID,
        demandSignalId: null,
        eligibilityReason: 'canonical_market_context:city_level_strategic_port_without_osm_port',
      },
    });
  }
  for (const d of sliceDrivers) {
    if (publicDrivers.length >= 5) break;
    const mf = magnetFacts.find(m => m.id === d.magnetFactId);
    if (!mf) continue;
    const role = magnetRoleForScoredDriver(d) ?? mf.role;
    const tierLabel: MagnetTier = d.resolvedTier === 1 ? 'primary' : d.resolvedTier === 2 ? 'secondary' : 'weak';
    const patched = { ...mf, role, tier: tierLabel };
    const ds = demandSignals.find(s => s.evidenceFactIds.includes(mf.id)) ?? null;
    if (d.demandTypeVote === 'medical') {
      if (d !== firstMedicalDriver) continue;
      const trace = {
        magnetFactId: mf.id,
        evidenceId: d.evidenceId,
        demandSignalId: ds?.id ?? null,
        eligibilityReason: `location_public_summary:${headline.reason}:grouped_medical`,
      };
      if (medicalSliceDrivers.length >= 3) {
        publicDrivers.push({
          textRu: groupedMedicalNames
            ? `Рядом есть несколько медицинских учреждений: ${groupedMedicalNames}.`
            : 'Рядом есть несколько медицинских учреждений.',
          trace,
        });
        publicDrivers.push({
          textRu: 'Они могут давать небольшой дополнительный спрос, но сами по себе не делают локацию сильной.',
          trace,
        });
      } else {
        publicDrivers.push({
          textRu: 'Поблизости есть медицинские учреждения, но этого недостаточно для сильного вывода по спросу.',
          trace,
        });
      }
      continue;
    }
    publicDrivers.push({
      textRu: formatPublicEvidenceLineRu(patched),
      trace: {
        magnetFactId: mf.id,
        evidenceId: d.evidenceId,
        demandSignalId: ds?.id ?? null,
        eligibilityReason: `location_public_summary:${headline.reason}`,
      },
    });
  }

  const cautiousStrategy = noClean || primary === 'weak/unclear' || primary === 'mixed';
  const recommendedStrategyBulletsRu = defaultStrategyRu(primary, cautiousStrategy);

  return {
    finalScore,
    scoreBand,
    primaryDemandType: primary,
    secondaryDemandTypes: secondaries,
    cityScale: kernel.cityScale,
    populationTier: kernel.populationTier,
    marketGravityCoefficient: kernel.marketGravityCoefficient,
    specialMarketFlags: kernel.specialMarketFlags,
    scoreCapReason: kernel.scoreCapReason,
    headlineRu,
    audienceVerdictRu,
    publicScoreLabelRu,
    publicScoreConfidence,
    publicDrivers,
    supportingContext,
    rejectedFromPublic: rejectedFromPublic.slice(0, 24),
    warnings,
    debugTrace,
    recommendedStrategyBulletsRu,
    trace: {
      headlineReason: headline.reason,
      verdictReason,
      contradictionWarnings: contradiction.warnings,
    },
    presentationDiagnostics,
  };
}

export function publicSummaryToClaims(rows: readonly LocationPublicDriverRow[]): LocationPublicClaim[] {
  return rows.map(r => ({ textRu: r.textRu, trace: r.trace }));
}

export function evidenceItemsFromStrictSummaryDrivers(args: {
  strictDrivers: readonly LocationDemandScoredDriver[];
  magnetFacts: readonly MagnetFact[];
  magnets: readonly MagnetItem[];
}): LocationEvidenceItem[] {
  const { strictDrivers, magnetFacts, magnets } = args;
  const maxN = 5;
  const out: LocationEvidenceItem[] = [];
  for (const d of strictDrivers.slice(0, maxN)) {
    const mf = magnetFacts.find(m => m.id === d.magnetFactId);
    if (!mf) continue;
    const role = magnetRoleForScoredDriver(d) ?? mf.role;
    const tierLabel: MagnetTier = d.resolvedTier === 1 ? 'primary' : d.resolvedTier === 2 ? 'secondary' : 'weak';
    const patched = { ...mf, role, tier: tierLabel };
    out.push({
      evidenceId: d.evidenceId,
      factId: mf.id,
      objectName: mf.name,
      typeRu: mf.category,
      subtypeRu: mf.subtype,
      distanceMeters: mf.distanceMeters,
      anchorKind: mf.anchorKind ?? 'local_poi',
      isNearbyPoi: mf.isNearbyPoi ?? true,
      contributesToLocalDistanceScore: mf.contributesToLocalDistanceScore ?? true,
      publicExplanationRu: formatPublicEvidenceLineRu(patched),
    });
  }
  return out;
}
