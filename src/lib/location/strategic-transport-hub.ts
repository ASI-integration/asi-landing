/**
 * Extended-radius scoring + reporting for major transport hubs only (airports,
 * major rail/bus hubs, ports, interchanges). Does not widen fetch radii for
 * ordinary local magnets (metro stays ~1.2 km in Overpass).
 */

import type { MagnetItem } from './types';

export const STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M = 2000;
export const STRATEGIC_TRANSPORT_SECONDARY_RADIUS_M = 5000;
export const STRATEGIC_TRANSPORT_FETCH_RADIUS_M = 8000;

/** Mirrors MagnetItem.subType for strategicTransportHub magnets */
export type StrategicHubSubType =
  | 'airport'
  | 'railway_station'
  | 'bus_station'
  | 'port'
  | 'river_port'
  | 'transport_interchange'
  | 'metro_hub';

export type StrategicReachBand = 'secondary' | 'strategic';

/**
 * Map classified POI + tags to a strategic-hub role, or null when this object
 * must never use the extended strategic fetch radius bucket for scoring.
 */
export function resolveStrategicHubSubtype(
  classified: { categoryId: string; subType?: string },
  tags: Record<string, string>,
): StrategicHubSubType | null {
  if (classified.categoryId === 'airport') return 'airport';
  if (classified.categoryId === 'metro' && classified.subType === 'metro_hub') return 'metro_hub';
  if (classified.categoryId === 'railway_station') {
    if (classified.subType === 'port' || classified.subType === 'river_port') {
      return classified.subType;
    }
    if (classified.subType === 'transport_interchange') return 'transport_interchange';
    if (tags.amenity === 'bus_station') return 'bus_station';
    if (tags.railway === 'halt') return null;
    if (
      tags.amenity === 'ferry_terminal' ||
      tags.landuse === 'harbour' ||
      tags.waterway === 'dock' ||
      tags.industrial === 'port' ||
      tags.industrial === 'logistics' ||
      tags.harbour === 'yes'
    ) {
      return tags.waterway === 'dock' ? 'river_port' : 'port';
    }
    if (tags.railway === 'station') return 'railway_station';
    return null;
  }
  return null;
}

export function strategicReachBandFromDistance(distanceM: number): StrategicReachBand | null {
  if (
    distanceM <= STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M ||
    distanceM > STRATEGIC_TRANSPORT_FETCH_RADIUS_M
  ) {
    return null;
  }
  return distanceM <= STRATEGIC_TRANSPORT_SECONDARY_RADIUS_M ? 'secondary' : 'strategic';
}

/** Tier multiplier applied to category weight before standard distance decay */
export function strategicHubWeightTierMultiplier(band: StrategicReachBand): number {
  return band === 'secondary' ? 0.48 : 0.13;
}

export function strategicHubSubtypeLabelRu(subType: string | undefined): string {
  switch (subType) {
    case 'airport':
      return 'Аэропорт';
    case 'railway_station':
      return 'Ж/д вокзал';
    case 'bus_station':
      return 'Автовокзал';
    case 'port':
      return 'Морской порт';
    case 'river_port':
      return 'Речной порт';
    case 'transport_interchange':
      return 'Транспортно-пересадочный узел (ТПУ)';
    case 'metro_hub':
      return 'Узловая станция метро';
    default:
      return 'Транспортный узел';
  }
}

/** Short free-tier line — strategic band (≈5–8 km) or secondary maritime/logistics ports */
export function strategicHubFreeBriefRu(
  hubs: Array<{ strategicReachBand?: StrategicReachBand; subType?: string }>,
): string | null {
  const strategic = hubs.filter(h => h.strategicReachBand === 'strategic');
  if (strategic.length > 0) return 'Крупный транспортный узел в транспортной доступности.';
  const portSecondary = hubs.some(
    h => h.strategicReachBand === 'secondary' && (h.subType === 'port' || h.subType === 'river_port'),
  );
  if (portSecondary) return 'Крупный транспортно-логистический узел в зоне доступности.';
  return null;
}

export function strategicHubPaidDetailLinesRu(magnets: MagnetItem[]): string[] {
  const lines: string[] = [];
  for (const m of magnets) {
    if (m.categoryId !== 'strategicTransportHub') continue;
    const band = m.strategicReachBand;
    if (!band) continue;
    const kind = strategicHubSubtypeLabelRu(m.subType);
    const distRu =
      m.distance < 1000
        ? `примерно ${Math.round(m.distance / 10) * 10} м`
        : `примерно ${(m.distance / 1000).toFixed(1)} км`;
    const isPort = m.subType === 'port' || m.subType === 'river_port';
    if (isPort) {
      const head =
        band === 'secondary'
          ? 'Крупный транспортно-логистический узел в зоне доступности'
          : 'Транспортно-логистический узел в транспортной досягаемости';
      lines.push(
        `${head}: ${kind} — ${m.name} (${distRu}). Поддерживает транспортные коридоры и смежный деловой спрос; это не пеший якорь — рассчитывайте на авто или общественный транспорт.`,
      );
      continue;
    }
    const accessWarn =
      band === 'strategic'
        ? ' Это не пешая доступность: рассчитывайте на такси/авто или общественный транспорт до узла.'
        : ' Пешая доступность к узлу ограничена — для гостей важна связка на транспорте.';
    const audience =
      band === 'strategic'
        ? ' Полезно для транзитных и командированных гостей, ориентированных на перелёты/межгород.'
        : ' Поддерживает транзитных и командированных гостей, но без эффекта «шаговой» локации.';
    lines.push(`Крупный транспортный узел в зоне транспортной доступности: ${kind} — ${m.name} (${distRu}).${audience}${accessWarn}`);
  }
  return lines;
}
