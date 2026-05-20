/**
 * Canonical evidence anchor kinds — local POI vs city-level strategic context.
 * Public surfaces must use these fields; city-level anchors are not nearby POIs.
 */

import type { SpecialMarketFlag } from './city-scale-from-address';
import {
  classifyLevel1Magnet,
  type Level1MagnetGroupId,
} from './level1-magnet-taxonomy';
import type {
  LocationEvidenceAnchorKind,
  LocationEvidenceItem,
  MagnetFact,
} from './location-decision-contract';
import type { MagnetItem } from './types';

export const LOCAL_POI_ANCHOR_DEFAULTS = {
  anchorKind: 'local_poi' as const,
  isNearbyPoi: true,
  contributesToLocalDistanceScore: true,
} satisfies Pick<MagnetFact, 'anchorKind' | 'isNearbyPoi' | 'contributesToLocalDistanceScore'>;

export const CITY_LEVEL_STRATEGIC_ANCHOR_DEFAULTS = {
  anchorKind: 'city_level_strategic' as const,
  isNearbyPoi: false,
  contributesToLocalDistanceScore: false,
  distanceMeters: null,
} satisfies Pick<MagnetFact, 'anchorKind' | 'isNearbyPoi' | 'contributesToLocalDistanceScore' | 'distanceMeters'>;

export function isCityLevelStrategicAnchor(
  item: Pick<MagnetFact, 'anchorKind'> | Pick<LocationEvidenceItem, 'anchorKind'>,
): boolean {
  return item.anchorKind === 'city_level_strategic';
}

export function isLocalPoiAnchor(
  item: Pick<MagnetFact, 'anchorKind'> | Pick<LocationEvidenceItem, 'anchorKind'>,
): boolean {
  return !item.anchorKind || item.anchorKind === 'local_poi';
}

export function hasPortLogisticsMagnet(magnets: readonly MagnetItem[]): boolean {
  return magnets.some(m => {
    const classified = classifyLevel1Magnet(m);
    return (
      classified.isLevel1 &&
      classified.groupId === 'transport_logistics' &&
      (classified.entityType === 'seaport' ||
        classified.entityType === 'cargo_port' ||
        classified.entityType === 'river_port' ||
        classified.entityType === 'logistics_terminal')
    );
  });
}

export function portCityStrategicContextActive(args: {
  specialMarketFlags: readonly SpecialMarketFlag[];
  magnets: readonly MagnetItem[];
}): boolean {
  return (
    args.specialMarketFlags.includes('port_or_logistics_gateway') && !hasPortLogisticsMagnet(args.magnets)
  );
}

export type PublicScoreConfidence = 'sufficient' | 'requires_full_check' | 'insufficient_map_data';

export function buildPortCityStrategicContextCopyRu(
  cityName: string,
  confidence: PublicScoreConfidence = 'sufficient',
): string {
  const city = cityName.trim() || 'город';
  void confidence;
  return (
    `Есть городской драйвер спроса: ${city} даёт портово-логистический спрос. ` +
    'Портово-логистический профиль города может усиливать деловые и командировочные сценарии. ' +
    'Полный отчёт покажет, какой формат запуска здесь выгоднее.'
  );
}

/** Legacy export — prefer `cityLevelStrategicWeakDemandBlockedRu(confidence)`. */
export const CITY_LEVEL_STRATEGIC_WEAK_DEMAND_BLOCKED_RU =
  'Есть городской драйвер спроса — локация может подойти для делового и командировочного сценария. Полный отчёт покажет, как это влияет на аренду, конкуренцию и формат запуска.';

export function cityLevelStrategicWeakDemandBlockedRu(confidence: PublicScoreConfidence): string {
  void confidence;
  return CITY_LEVEL_STRATEGIC_WEAK_DEMAND_BLOCKED_RU;
}

const PORT_CITY_STRATEGIC_SUBTYPE = 'port_city_context';

export function portCityStrategicMagnetFact(args: {
  id: string;
  cityName: string;
  explanationRu: string;
}): MagnetFact {
  return {
    id: args.id,
    name: 'Городовой портово-логистический фактор',
    category: 'Транспорт и логистика',
    subtype: PORT_CITY_STRATEGIC_SUBTYPE,
    tier: 'secondary',
    role: 'transport_anchor',
    evidenceSource: 'strategic_hub_layer',
    includedInScore: false,
    includedInPublicReport: true,
    explanationRu: args.explanationRu,
    explanationEn: 'City-level port/logistics demand context — address impact requires full map.',
    ...CITY_LEVEL_STRATEGIC_ANCHOR_DEFAULTS,
  };
}

export function portCityStrategicEvidenceItem(args: {
  evidenceId: string;
  factId: string;
  publicExplanationRu: string;
}): LocationEvidenceItem {
  return {
    evidenceId: args.evidenceId,
    factId: args.factId,
    objectName: 'Городовой портово-логистический фактор',
    typeRu: 'Транспорт и логистика',
    subtypeRu: PORT_CITY_STRATEGIC_SUBTYPE,
    publicExplanationRu: args.publicExplanationRu,
    ...CITY_LEVEL_STRATEGIC_ANCHOR_DEFAULTS,
  };
}

export function strictDriversHaveLocalLevel1Anchor(
  magnets: readonly MagnetItem[],
  strictDriverMagnetIndices: readonly number[],
): boolean {
  for (const idx of strictDriverMagnetIndices) {
    const m = magnets[idx];
    if (!m) continue;
    if (classifyLevel1Magnet(m).isLevel1) return true;
  }
  return false;
}

export function cityLevelStrategicAnchorOnlyContext(args: {
  specialMarketFlags: readonly SpecialMarketFlag[];
  magnets: readonly MagnetItem[];
  strictPublicDriverCount: number;
  hasCanonicalPortFallback: boolean;
}): boolean {
  if (!args.hasCanonicalPortFallback && !portCityStrategicContextActive(args)) return false;
  if (args.strictPublicDriverCount > 0) {
    return false;
  }
  return true;
}

export function inferPublicScoreConfidence(args: {
  score: number | null;
  partialCartographicPreview: boolean;
  analysisIncomplete?: boolean;
  scoreBlockedDueToIncompleteData?: boolean;
  cityLevelStrategicOnly: boolean;
  strictPublicDriverCount: number;
  classifiedMagnetCount: number;
}): PublicScoreConfidence {
  if (args.analysisIncomplete || args.scoreBlockedDueToIncompleteData) {
    return 'insufficient_map_data';
  }
  if (args.partialCartographicPreview) {
    return 'requires_full_check';
  }
  const weakMapCoverage =
    args.classifiedMagnetCount <= 2 ||
    (args.strictPublicDriverCount === 0 && (args.score == null || args.score < 40));
  if (args.cityLevelStrategicOnly && weakMapCoverage) {
    if (typeof args.score === 'number' && args.score >= 45) {
      return 'sufficient';
    }
    return 'requires_full_check';
  }
  if (weakMapCoverage && typeof args.score === 'number' && args.score < 35) {
    return 'requires_full_check';
  }
  return 'sufficient';
}

export function publicScoreLabelRuForConfidence(
  confidence: PublicScoreConfidence,
  score: number | null,
): string {
  if (confidence !== 'sufficient') {
    return 'Предварительный вывод: есть факторы спроса';
  }
  const range = publicScoreNumericRange(score);
  return range?.labelRu ?? 'Предварительный потенциал: умеренный';
}

/** Numeric % band — only when confidence is sufficient. */
export function publicScoreNumericRange(score: number | null | undefined): {
  low: number;
  high: number;
  label: string;
  labelRu: string;
} | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const low = Math.max(0, Math.floor((clamped - 5) / 10) * 10 + 5);
  const high = Math.min(100, low + 10);
  const label = `${low}–${high}%`;
  const labelRu =
    clamped >= 75
      ? 'Предварительный потенциал: высокий'
      : clamped >= 45
        ? 'Предварительный потенциал: умеренный'
        : 'Предварительный вывод: есть факторы спроса';
  return {
    low,
    high,
    label,
    labelRu,
  };
}

export function magnetFactAnchorKindForCategory(
  categoryId: string,
  entityType?: string,
): LocationEvidenceAnchorKind {
  void categoryId;
  void entityType;
  return 'local_poi';
}

export function level1GroupIsCityStrategicOnly(groupId: Level1MagnetGroupId | null): boolean {
  return groupId === 'transport_logistics';
}
