/**
 * Single RU residential demo public presentation contract.
 * All hero/demand/verdict/bullets/strategy copy for the free demo must derive from here only.
 */

import type { LocationAnalysis, MagnetItem } from './types';
import type {
  DemandSignal,
  LocationDecisionScoreBand,
  LocationEvidenceItem,
  LocationPublicClaim,
  LocationPublicDriverRow,
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
  looksLikeWeakLocalAttractionPoi,
  looksLikeWeakLocalBusinessPoi,
  looksLikeWeakLocalRetailPoi,
} from './signals/location-signal-taxonomy';
import { magnetRoleForScoredDriver } from './location-scoring-kernel';

function magnetForDriver(d: LocationDemandScoredDriver, magnets: readonly MagnetItem[]): MagnetItem | undefined {
  const parts = d.magnetFactId.split(':');
  const i = parts.length >= 2 ? Number.parseInt(parts[1]!, 10) : NaN;
  if (!Number.isFinite(i)) return undefined;
  return magnets[i];
}

const TOURIST_ANCHOR_CATS = new Set(['stadium', 'convention', 'attraction']);

/** Verified map-backed tourist anchors for STR (not hotels / nightlife / generic retail). */
export function verifiedTouristAnchorDrivers(
  drivers: readonly LocationDemandScoredDriver[],
  magnets: readonly MagnetItem[],
): LocationDemandScoredDriver[] {
  return drivers.filter(d => {
    if (!d.accepted || d.demandTypeVote !== 'tourist') return false;
    if (d.driverKind !== 'real_demand_driver') return false;
    const m = magnetForDriver(d, magnets);
    const cat = m?.categoryId;
    if (!cat || cat === 'major_hotel' || cat === 'mid_hotel' || cat === 'entertainment') return false;
    if (!TOURIST_ANCHOR_CATS.has(cat)) return false;
    if (cat === 'attraction' && (d.resolvedTier >= 3 || d.scaleClass === 'weak_local')) return false;
    return d.resolvedTier <= 2;
  });
}

/**
 * Stricter than kernel `publicDisplayEligible` — residential demo bullets / headline drivers only.
 */
export function selectStrictPublicSummaryDrivers(args: {
  kernel: LocationDemandScoringKernelResult;
  magnets: readonly MagnetItem[];
}): LocationDemandScoredDriver[] {
  const { kernel, magnets } = args;
  const pool = kernel.scoredDrivers.filter(d => d.publicDisplayEligible);
  const demandAnchors = pool.filter(
    d => d.driverKind === 'real_demand_driver' || d.driverKind === 'unknown_uncapped',
  );
  const transit = pool.filter(d => {
    if (d.driverKind !== 'supporting_infrastructure') return false;
    const m = magnetForDriver(d, magnets);
    return m?.categoryId === 'metro' || m?.categoryId === 'railway_station';
  });

  const ranked = [...demandAnchors, ...transit].sort((a, b) => b.finalContribution - a.finalContribution);

  const out: LocationDemandScoredDriver[] = [];
  const seen = new Set<string>();
  for (const d of ranked) {
    if (seen.has(d.magnetFactId)) continue;
    const m = magnetForDriver(d, magnets);
    if (!m) continue;
    if (!passesResidentialPublicSurfaceGate(d, m)) {
      continue;
    }
    seen.add(d.magnetFactId);
    out.push(d);
  }
  return out;
}

function passesResidentialPublicSurfaceGate(d: LocationDemandScoredDriver, m: MagnetItem): boolean {
  if (m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel') return false;
  if (m.categoryId === 'entertainment') return false;
  if (m.categoryId === 'shopping_local' || m.categoryId === 'food') return false;
  if (m.categoryId === 'shopping_major' && looksLikeWeakLocalRetailPoi(m)) return false;
  if (m.categoryId === 'shopping_major') return false;

  if (m.categoryId === 'business') {
    if (looksLikeWeakLocalBusinessPoi(m)) return false;
    if (!isStrongBusinessAnchorPoi(m)) return false;
  }

  if (m.categoryId === 'attraction' && looksLikeWeakLocalAttractionPoi(m)) return false;

  const n = `${m.name} ${m.subType ?? ''}`.toLowerCase();
  if (
    /nightclub|ночн(ой|ая)\s+клуб|клуб\s+ночн/i.test(n) ||
    /ремонт\s*(?:телефон|смартфон|мобильн)|телефонн|сотов|mobile\s*phone|phone\s*repair|айфон|iphone/i.test(n) ||
    /кадров(ое|ая|ый)\s+агентств/i.test(n)
  ) {
    return false;
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
}): { text: string; reason: string } {
  const { primary, strictDrivers, magnets, incompleteLabel } = args;
  if (incompleteLabel) {
    return { text: incompleteLabel, reason: 'integrity:generic_incomplete_data_signal' };
  }

  const anchors = verifiedTouristAnchorDrivers(strictDrivers, magnets);
  const mixedUnstable = 'Смешанный / неустойчивый спрос по данным карты';

  if (strictDrivers.length === 0) {
    return { text: mixedUnstable, reason: 'no_strict_public_drivers_after_surface_gates' };
  }

  if (primary === 'tourist' && anchors.length === 0) {
    return { text: mixedUnstable, reason: 'tourist_vote_without_verified_map_tourist_anchor' };
  }

  const med = medicalMass(strictDrivers);
  const tour = touristMass(strictDrivers);
  if (med > tour * 1.12 && med >= 0.14) {
    if (primary === 'tourist') {
      return {
        text: 'Смешанный спрос: медицинский якорь заметнее досуговых сигналов',
        reason: 'medical_public_driver_mass_over_tourist',
      };
    }
  }

  switch (primary) {
    case 'weak/unclear':
      return {
        text: 'Профиль спроса по карте ограничен — устойчивые якоря спроса не подтверждены.',
        reason: 'primary_weak_unclear',
      };
    case 'medical':
      return { text: 'Спрос с медицинским якорем в зоне (по устойчивым публичным драйверам)', reason: 'primary_medical' };
    case 'corporate/business':
      return { text: 'Спрос от делового и офисного трафика (по устойчивым публичным драйверам)', reason: 'primary_business' };
    case 'transport':
      return { text: 'Транзитный и транспортно-связанный спрос', reason: 'primary_transport' };
    case 'industrial':
      return { text: 'Промышленно-деловой профиль спроса', reason: 'primary_industrial' };
    case 'tourist':
      return { text: 'Туристический и событийный спрос по якорям карты', reason: 'primary_tourist_verified' };
    case 'education':
      return { text: 'Образовательно-деловой профиль спроса', reason: 'primary_education' };
    case 'mixed':
      if (med >= 0.14 && businessMass(strictDrivers) >= 0.12) {
        return { text: 'Смешанный спрос: медицина и деловой контекст', reason: 'mixed_medical_business' };
      }
      return { text: 'Смешанный профиль спроса по данным карты', reason: 'primary_mixed' };
    default:
      return { text: mixedUnstable, reason: 'fallback' };
  }
}

function defaultStrategyRu(primary: LocationPublicSummaryDemandType, cautious: boolean): string[] {
  if (cautious) {
    return [
      'Публичная демо-оценка опирается только на устойчивые якоря карты — спорные сигналы скрыты.',
      'Для сценария посуточной аренды и рисков по конкуренции лучше заказать полный отчёт с детализацией.',
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
        'Если якоря спроса спорные, полный отчёт поможет отделить «красивую карту» от устойчивого дохода.',
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
    verdict = 'Спрос с медицинским якорем — туристический сценарий здесь вторичен';
  }

  if (primary === 'tourist' && /медицинск/i.test(verdict)) {
    warnings.push('contradiction_guard:tourist_primary_with_medical_verdict');
    verdict = 'Туристический и событийный контекст — медицинский сценарий не доминирует в публичном выводе';
  }

  return { verdict, warnings };
}

function cautiousVerdictFromScore(score: number): string {
  if (score >= 60) return 'Потенциал есть, но публичные якоря спроса неоднозначны — нужен детальный разбор';
  if (score >= 45) return 'Осторожный вывод: устойчивые публичные драйверы не выделены';
  return 'Слабый публичный сигнал — для сценария дохода нужен полный отчёт';
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
}): LocationPublicSummary {
  const debugTrace: string[] = [];
  const warnings = [...args.baseWarnings];
  const { kernel, magnets, magnetFacts, demandSignals, finalScore, scoreBand } = args;

  const incomplete = demandSignals.find(s => s.id === 'ds:generic_incomplete_data');

  const strictDrivers = args.strictDrivers ?? selectStrictPublicSummaryDrivers({ kernel, magnets });
  debugTrace.push(`strict_public_drivers=${strictDrivers.length}`);

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
    if (m && !passesResidentialPublicSurfaceGate(d, m)) {
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
      primary = medM > businessMass(strictDrivers) * 1.05 ? 'medical' : 'mixed';
      debugTrace.push('override_primary_to_medical_or_mixed_by_public_driver_mass');
    }
  }

  const secondaries = secondariesFromPrimary(primary, strictDrivers);

  const headline = buildHeadlineRu({
    primary,
    strictDrivers,
    magnets,
    incompleteLabel: incomplete?.publicLabelRu ?? null,
  });

  const headlineRu = headline.text;
  debugTrace.push(`headline:${headline.reason}`);

  const scoreForSanity = finalScore ?? 0;
  const { sanity } = computeResidentialDemoPresentation(args.analysis, scoreForSanity);

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
  audienceVerdictRu = contradiction.verdict;
  warnings.push(...contradiction.warnings);

  const supportingContext: string[] = [];
  if (strictDrivers.length > 0 && rejectedFromPublic.length > 0) {
    supportingContext.push(
      `Рядом есть дополнительные объекты карты (${rejectedFromPublic.length}), не используемые как публичные драйверы балла.`,
    );
  }

  const sliceDrivers = strictDrivers.slice(0, Math.min(5, strictDrivers.length));

  const publicDrivers: LocationPublicDriverRow[] = [];
  for (const d of sliceDrivers) {
    const mf = magnetFacts.find(m => m.id === d.magnetFactId);
    if (!mf) continue;
    const role = magnetRoleForScoredDriver(d) ?? mf.role;
    const tierLabel: MagnetTier = d.resolvedTier === 1 ? 'primary' : d.resolvedTier === 2 ? 'secondary' : 'weak';
    const patched = { ...mf, role, tier: tierLabel };
    const ds = demandSignals.find(s => s.evidenceFactIds.includes(mf.id)) ?? null;
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
    headlineRu,
    audienceVerdictRu,
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
      publicExplanationRu: formatPublicEvidenceLineRu(patched),
    });
  }
  return out;
}
