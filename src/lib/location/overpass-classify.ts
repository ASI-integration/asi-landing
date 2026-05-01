import type { OSMElement } from './types';
import { overpassToCanonical } from './canonical/overpass-to-canonical';
import type { CanonicalMagnetType } from './canonical/generated-magnet-registry';

const LUXURY_CHAINS = [
  'marriott', 'hilton', 'hyatt', 'sheraton', 'radisson', 'intercontinental',
  'four seasons', 'ritz', 'pullman', 'doubletree', 'crowne plaza', 'holiday inn',
  'ramada', 'wyndham', 'novotel', 'mercure', 'westin', 'sofitel', 'renaissance',
  'kempinski', 'swissôtel', 'swissotel', 'shangri-la', 'fairmont', 'waldorf',
  'mandarin oriental', 'okura', 'lotte hotel', 'azimut', 'cosmos hotel',
  'national hotel', 'metropol', 'savoy', 'astoria', 'lotte',
] as const;

function n(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isMajorHotel(normTags: Record<string, string>): boolean {
  const stars = parseInt(normTags.stars ?? '0', 10);
  if (stars >= 4) return true;
  const nameLower = n(normTags.name);
  return LUXURY_CHAINS.some(chain => nameLower.includes(chain));
}

function legacyCategoryForCanonical(t: CanonicalMagnetType): { categoryId: string; subType?: string } | null {
  switch (t) {
    case 'airport': return { categoryId: 'airport' };
    case 'metro_station': return { categoryId: 'metro' };
    case 'railway_station':
    case 'transport_hub':
    case 'port':
      return { categoryId: 'railway_station' };
    case 'hospital':
    case 'medical_cluster':
      return { categoryId: 'hospital' };
    case 'university':
      return { categoryId: 'university' };
    case 'shopping_mall':
      return { categoryId: 'shopping_major' };
    case 'stadium':
      return { categoryId: 'stadium' };
    case 'event_venue':
      return { categoryId: 'convention' };
    case 'museum':
    case 'theater':
    case 'tourist_attraction':
    case 'cultural_landmark':
    case 'park':
    case 'beach':
    case 'waterfront':
    case 'resort_area':
      return { categoryId: 'attraction' };
    case 'business_center':
    case 'office_cluster':
      return { categoryId: 'business', subType: 'office' };
    case 'industrial_anchor':
      return { categoryId: 'business', subType: 'factory' };
    case 'industrial_zone':
      return { categoryId: 'business', subType: 'industrial' };
    case 'weak_amenity':
    case 'tertiary_local_amenity':
    case 'residential_density':
    default:
      return null;
  }
}

/**
 * Map a raw OSM element to a legacy category id (+ optional subType),
 * but ONLY after canonical mapping has produced a canonicalType.
 *
 * NOTE: No Tier/score decisions are allowed here; this is a compatibility bridge
 * for the existing gravity-scoring categories.
 */
export function classifyElement(el: OSMElement): { categoryId: string; name: string; subType?: string; canonicalType: CanonicalMagnetType; mapping: ReturnType<typeof overpassToCanonical> } | null {
  const tags = el.tags ?? {};
  const mapped = overpassToCanonical({
    name: tags.name,
    tags,
    source: 'osm-overpass',
  });

  const norm = mapped.normalizedTags;
  const name = (tags.name && tags.name.trim()) ? tags.name.trim() : '';

  // Competitors: non-hotel STR supply
  if (norm.tourism === 'apartment' || norm.tourism === 'guest_house' || norm.tourism === 'hostel' || norm.tourism === 'motel') {
    return { categoryId: 'competitor', name: name || tags.tourism || 'Объект аренды', canonicalType: mapped.canonicalType, mapping: mapped };
  }

  // Accessibility stops: tiny bonus only
  if (
    norm.highway === 'bus_stop' ||
    norm.public_transport === 'stop_position' ||
    norm.public_transport === 'platform' ||
    norm.railway === 'tram_stop'
  ) {
    return { categoryId: 'accessibility_stop', name: name || 'Остановка', canonicalType: mapped.canonicalType, mapping: mapped };
  }

  // Hotels: canonical type is hotel_cluster, but legacy needs split (major/mid/competitor)
  if (norm.tourism === 'hotel') {
    if (isMajorHotel({ ...norm, name: tags.name ?? '' })) {
      return { categoryId: 'major_hotel', name: name || 'Крупный отель', canonicalType: 'hotel_cluster', mapping: mapped };
    }
    const stars = parseInt(norm.stars ?? '0', 10);
    const hasName = Boolean(name);
    if (hasName || (stars >= 1 && stars <= 3)) {
      return {
        categoryId: 'mid_hotel',
        name: name || 'Отель',
        subType: stars > 0 ? `stars_${stars}` : undefined,
        canonicalType: 'hotel_cluster',
        mapping: mapped,
      };
    }
    return { categoryId: 'competitor', name: name || 'Отель', canonicalType: 'hotel_cluster', mapping: mapped };
  }

  const legacy = legacyCategoryForCanonical(mapped.canonicalType);
  if (!legacy) return null;

  // Provide safe display names when OSM name is missing
  const fallbackName = (() => {
    switch (legacy.categoryId) {
      case 'metro': return 'Метро';
      case 'airport': return 'Аэропорт';
      case 'hospital': return 'Больница';
      case 'railway_station': return 'Транспортный узел';
      case 'university': return 'Университет';
      case 'shopping_major': return 'ТЦ';
      case 'stadium': return 'Стадион';
      case 'convention': return 'Конгресс-центр';
      case 'business': return legacy.subType === 'industrial' ? 'Промзона' : legacy.subType === 'factory' ? 'Завод' : 'Офис';
      case 'attraction': return 'Достопримечательность';
      default: return legacy.categoryId;
    }
  })();

  return {
    categoryId: legacy.categoryId,
    name: name || fallbackName,
    subType: legacy.subType,
    canonicalType: mapped.canonicalType,
    mapping: mapped,
  };
}

