import type { OSMElement } from './types';
import {
  qualifiesSpecializedMedicalAnchor,
  inferSpecializedMedicalSubType,
} from './specialized-medical-anchor';

/**
 * Luxury hotel chains: their presence is a quality signal independent of star rating.
 * These brands do not operate in commercially weak locations.
 */
const LUXURY_CHAINS = [
  'marriott', 'hilton', 'hyatt', 'sheraton', 'radisson', 'intercontinental',
  'four seasons', 'ritz', 'pullman', 'doubletree', 'crowne plaza', 'holiday inn',
  'ramada', 'wyndham', 'novotel', 'mercure', 'westin', 'sofitel', 'renaissance',
  'kempinski', 'swissôtel', 'swissotel', 'shangri-la', 'fairmont', 'waldorf',
  'mandarin oriental', 'okura', 'lotte hotel', 'azimut', 'cosmos hotel',
  'national hotel', 'metropol', 'savoy', 'astoria', 'lotte',
] as const;

/**
 * Returns true when a tourism=hotel element represents a major 4–5★ property.
 * Checks: OSM stars tag ≥ 4 first; then chain-name heuristic as fallback.
 * Returns false for untagged, 1–3★, or unknown hotels (→ classified as competitor).
 */
/**
 * Russian ЗАГС / civil registry name pattern. ZAGS offices are tagged
 * inconsistently in OSM (sometimes office=government, sometimes amenity=public_building,
 * sometimes nothing). When the name matches we surface them as a civic anchor.
 */
const ZAGS_NAME_RE = /\bЗАГС\b|registry\s+office|записи\s+актов\s+гражданского/i;

function isMajorHotel(t: Record<string, string>): boolean {
  const stars = parseInt(t.stars ?? '0', 10);
  if (stars >= 4) return true;
  const nameLower = (t.name ?? '').toLowerCase();
  return LUXURY_CHAINS.some(chain => nameLower.includes(chain));
}

/** Map a raw OSM element to a category id + display name (+ optional subType), or null if unrecognised */
export function classifyElement(el: OSMElement): { categoryId: string; name: string; subType?: string } | null {
  const t = el.tags ?? {};

  // ── Tier 1: Regional / city-scale anchors ──────────────────────────────────

  // Metro: only actual subway systems (underground rapid transit).
  if (t.railway === 'subway_entrance' || t.station === 'subway') {
    const subType = t.interchange === 'yes' ? 'metro_hub' : undefined;
    return { categoryId: 'metro', name: t.name || 'Метро', subType };
  }

  // Airports: scheduled / general aviation hubs — exclude helipads (noise + false transport-led).
  if (t.aeroway === 'helipad') return null;
  if (t.aeroway === 'aerodrome' || t.aeroway === 'terminal') {
    const nameLower = (t.name ?? '').toLowerCase();
    if (t.aerodrome === 'helipad' || /heliport|helipad|\bheli pad\b/i.test(nameLower)) return null;
    return { categoryId: 'airport', name: t.name || 'Аэропорт' };
  }

  // Major tourism/cultural objects — local memorials and parks excluded
  if (t.tourism === 'attraction' || t.tourism === 'museum' || t.tourism === 'gallery' || t.historic === 'monument')
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };

  // Hospitals / major medical clusters — evergreen demand from staff and visitors
  if (t.amenity === 'hospital' || t.healthcare === 'hospital')
    return { categoryId: 'hospital', name: t.name || 'Больница' };

  // Specialized healthcare — tiered scoring only via `specializedMedicalAnchor` in buildAnalysis
  if (t.amenity === 'dentist' && qualifiesSpecializedMedicalAnchor(t)) {
    return {
      categoryId: 'specializedMedicalAnchor',
      name: t.name || 'Стоматология',
      subType: inferSpecializedMedicalSubType(t),
    };
  }
  if (t.amenity === 'clinic' && qualifiesSpecializedMedicalAnchor(t)) {
    return {
      categoryId: 'specializedMedicalAnchor',
      name: t.name || 'Клиника',
      subType: inferSpecializedMedicalSubType(t),
    };
  }
  if (t.healthcare === 'surgery' && t.amenity !== 'hospital') {
    if (!qualifiesSpecializedMedicalAnchor(t)) return null;
    return {
      categoryId: 'specializedMedicalAnchor',
      name: t.name || 'Хирургия',
      subType: inferSpecializedMedicalSubType(t),
    };
  }

  // ── Tier 2: District anchors ────────────────────────────────────────────────

  // Major hotels (4–5★ / luxury chains): quality proxy signal.
  // buildAnalysis also adds these to the competitor array for supply pressure.
  if (t.tourism === 'hotel') {
    if (isMajorHotel(t))
      return { categoryId: 'major_hotel', name: t.name || 'Крупный отель' };
    // Mid-tier hotels (1–3★ / unknown stars but named): surfaced as a Tier-2
    // demand anchor for the secondary-cluster rule. Untagged anonymous hotels
    // stay as competitor-only (no name = no positive demand evidence).
    const stars = parseInt(t.stars ?? '0', 10);
    const hasName = Boolean(t.name && t.name.trim());
    if (hasName || (stars >= 1 && stars <= 3)) {
      return { categoryId: 'mid_hotel', name: t.name || 'Отель', subType: stars > 0 ? `stars_${stars}` : undefined };
    }
    return { categoryId: 'competitor', name: t.name || 'Отель' };
  }

  // Civic / administrative anchors — Tier-2 demand anchor.
  if (t.amenity === 'townhall')
    return { categoryId: 'civic', name: t.name || 'Администрация', subType: 'townhall' };
  if (t.office === 'government' && (t.name && t.name.trim()))
    return { categoryId: 'civic', name: t.name, subType: 'government' };
  if (
    (t.amenity === 'public_building' || t.office === 'register' || t.office === 'notary') &&
    t.name && ZAGS_NAME_RE.test(t.name)
  )
    return { categoryId: 'civic', name: t.name, subType: 'zags' };

  // Convention / expo / conference centers — corporate demand anchor
  if (t.amenity === 'conference_centre' || t.amenity === 'exhibition_centre' || t.amenity === 'convention_centre')
    return { categoryId: 'convention', name: t.name || 'Конгресс-центр' };

  if (t.amenity === 'university')
    return { categoryId: 'university', name: t.name || 'Университет' };

  // Vocational / local colleges
  if (t.amenity === 'college')
    return { categoryId: 'education_local', name: t.name || 'Колледж' };

  // Ports / ferries — same magnet lineage as rail hubs for baseline scoring within primary radius
  if (t.amenity === 'ferry_terminal')
    return { categoryId: 'railway_station', name: t.name || 'Порт', subType: 'port' };
  if (t.landuse === 'harbour')
    return { categoryId: 'railway_station', name: t.name || 'Порт', subType: 'port' };
  if (t.waterway === 'dock')
    return { categoryId: 'railway_station', name: t.name || 'Речной порт', subType: 'river_port' };
  if (t.industrial === 'port' || t.industrial === 'logistics')
    return { categoryId: 'railway_station', name: t.name || 'Порт', subType: 'port' };
  if (t.harbour === 'yes' && t.name?.trim())
    return { categoryId: 'railway_station', name: t.name, subType: 'port' };

  // Railway stations + major bus hubs (classified AFTER metro)
  if (t.amenity === 'bus_station')
    return { categoryId: 'railway_station', name: t.name || 'Транспортный узел' };
  if (t.railway === 'station' || t.railway === 'halt') {
    let subType: string | undefined;
    if (t.interchange === 'yes') subType = 'transport_interchange';
    else if (t.railway === 'halt') subType = 'halt';
    return { categoryId: 'railway_station', name: t.name || 'Станция', subType };
  }

  // City-scale entertainment (sports centres excluded — local only)
  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };

  // Large shopping formats (city-scale draw)
  if (t.shop === 'mall' || t.shop === 'department_store')
    return { categoryId: 'shopping_major', name: t.name || 'ТЦ' };

  // Stadiums / arenas — year-round event venues with periodic demand spikes
  if (t.leisure === 'stadium')
    return { categoryId: 'stadium', name: t.name || 'Стадион' };
  if (t.leisure === 'sports_centre' && t.name)
    return { categoryId: 'stadium', name: t.name, subType: 'sports_centre' };

  // Business: factories, works, offices, industrial zones
  if (t.man_made === 'works')
    return { categoryId: 'business', name: t.name || 'Завод', subType: 'factory' };
  if (t.landuse === 'industrial')
    return { categoryId: 'business', name: t.name || 'Промзона', subType: 'industrial' };
  if (t.building === 'industrial')
    return { categoryId: 'business', name: t.name || 'Производство', subType: 'factory' };
  if (t.landuse === 'commercial')
    return { categoryId: 'business', name: t.name || 'Коммерческая зона', subType: 'commercial' };
  if (t.amenity === 'bank')
    return { categoryId: 'business', name: t.name || 'Банк', subType: 'bank' };
  if (t.office) {
    const hasName = Boolean(t.name && t.name.trim());
    return { categoryId: 'business', name: t.name || 'Офис', subType: hasName ? 'office' : 'office_anon' };
  }

  // ── Tier 3: Local / accessibility-only ──────────────────────────────────────

  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position' || t.public_transport === 'platform' || t.railway === 'tram_stop')
    return { categoryId: 'accessibility_stop', name: t.name || 'Остановка' };

  if (t.shop === 'supermarket' || t.shop === 'convenience')
    return { categoryId: 'shopping_local', name: t.name || 'Магазин' };

  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'bar' || t.amenity === 'pub')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };

  // ── Competitors (non-major STR supply) ─────────────────────────────────────
  if (t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };

  return null;
}

