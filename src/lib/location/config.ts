import type { MagnetCategory, PermanenceType } from './types';

// ── Magnet categories ─────────────────────────────────────────────────────────
// IDs normally match classifyElement() in overpass-classify.ts (transport stops go to accessibility).
// Exceptions: `strategicTransportHub` and tiered `specializedMedicalAnchor` are emitted in buildAnalysis().

export const MAGNET_CATEGORIES: MagnetCategory[] = [
  // ── Tier 1: Regional / city-scale anchors (weight 7–9) ───────────────────────
  { id: 'metro',            label: 'Metro',                            labelRu: 'Метро',                              icon: 'М',  weight: 9,   permanenceType: 'permanent', scopeLevel: 'regional', strengthClass: 'strong' },
  { id: 'airport',          label: 'Airports',                         labelRu: 'Аэропорты',                          icon: '✈',  weight: 8,   permanenceType: 'permanent', scopeLevel: 'regional', strengthClass: 'strong' },
  { id: 'attraction',       label: 'Attractions',                      labelRu: 'Достопримечательности',              icon: '★',  weight: 8,   permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'strong' },
  { id: 'hospital',         label: 'Hospitals & medical clusters',     labelRu: 'Больницы и медкластеры',             icon: '+',  weight: 7,   permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'strong' },
  // ── Tier 2: District anchors (weight 5–6) ─────────────────────────────────────
  { id: 'major_hotel',      label: 'Major 4–5★ hotels',               labelRu: 'Крупные отели 4–5★',                 icon: '⛟',  weight: 6,   permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'strong' },
  { id: 'convention',       label: 'Convention & expo centers',        labelRu: 'Конгресс- и выставочные центры',     icon: '⊟',  weight: 6,   permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'strong' },
  { id: 'university',       label: 'Universities',                     labelRu: 'Университеты',                       icon: 'У',  weight: 6,   permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'business',         label: 'Offices, factories & business',   labelRu: 'Офисы, заводы и бизнес',             icon: 'Б',  weight: 5.5, permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'medium' },
  { id: 'railway_station',  label: 'Rail & major transit hubs',       labelRu: 'Ж/д и крупные транспортные узлы',    icon: 'Ж',  weight: 5,   permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'medium' },
  /** Beyond-primary-radius airports/rail/ports/bus hubs — scored with capped pull (see strategic-transport-hub.ts). */
  { id: 'strategicTransportHub', label: 'Strategic transport hubs',    labelRu: 'Крупные транспортные узлы',          icon: '⇄',  weight: 5.5, permanenceType: 'permanent', scopeLevel: 'regional', strengthClass: 'weak' },
  /** Large healthcare beyond ordinary hospital radius — tiered, capped pull (see specialized-medical-anchor.ts). */
  { id: 'specializedMedicalAnchor', label: 'Major healthcare anchors', labelRu: 'Крупная медицина',                  icon: '⚕',  weight: 4.5, permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'weak' },
  { id: 'entertainment',    label: 'Entertainment',                    labelRu: 'Развлечения',                        icon: '▶',  weight: 5,   permanenceType: 'semi',      scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'shopping_major',   label: 'Malls & major retail',            labelRu: 'ТЦ и крупная розница',               icon: '⊞',  weight: 5,   permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'stadium',          label: 'Stadiums & arenas',               labelRu: 'Стадионы и арены',                   icon: '⬡',  weight: 5,   permanenceType: 'semi',      scopeLevel: 'city',     strengthClass: 'medium' },
  // Secondary district anchors — civic/admin and mid-tier hotels.
  // Low weights: these contribute to the "secondary cluster" rule
  // (rules/residential-location-rules.ts) but must not push
  // evergreenIndex into a strong band on their own.
  { id: 'civic',            label: 'Civic / administrative anchors',  labelRu: 'Гражданские/административные центры', icon: '⌂',  weight: 3,   permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'medium' },
  { id: 'mid_hotel',        label: 'Mid-tier hotels (1–3★)',          labelRu: 'Отели среднего класса (1–3★)',       icon: '⛟',  weight: 2.5, permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'medium' },
  // ── Tier 3: Local / weak signals (weight 1–1.5) ───────────────────────────────
  { id: 'education_local',  label: 'Local schools',                   labelRu: 'Локальные учебные заведения',        icon: 'у',  weight: 1.5, permanenceType: 'permanent', scopeLevel: 'local',    strengthClass: 'weak' },
  { id: 'shopping_local',   label: 'Supermarkets',                    labelRu: 'Супермаркеты',                       icon: '⊕',  weight: 1.2, permanenceType: 'permanent', scopeLevel: 'local',    strengthClass: 'weak' },
  { id: 'food',             label: 'Cafés & restaurants',             labelRu: 'Кафе и рестораны',                   icon: '◈',  weight: 1,   permanenceType: 'semi',      scopeLevel: 'local',    strengthClass: 'weak' },
];

// OSM search radius per category (meters)
export const CATEGORY_RADIUS: Record<string, number> = {
  metro:             1200,
  airport:           2000,
  attraction:        1000,
  hospital:          1000,
  major_hotel:        800,
  convention:        1000,
  university:        1000,
  business:          1200,
  railway_station:   1400,
  entertainment:      800,
  shopping_major:     900,
  stadium:           1500,
  civic:              900,
  mid_hotel:          700,
  education_local:    650,
  shopping_local:     450,
  food:               450,
  /** Used only for documentation — actual fetch radii are in overpass.ts selectors */
  specializedMedicalAnchor: 3000,
  /** Fetch-only: bus / tram stop nodes (scored only via accessibility bonus) */
  accessibility_stop: 550,
};

// Max items included in scoring per category (caps both scoring and display pool)
export const CATEGORY_MAX_SHOW: Record<string, number> = {
  metro:             3,
  airport:           2,
  strategicTransportHub: 2,
  specializedMedicalAnchor: 2,
  attraction:        3,
  hospital:          2,
  major_hotel:       2,
  convention:        2,
  university:        3,
  business:          5,
  railway_station:   3,
  entertainment:     3,
  shopping_major:    3,
  stadium:           2,
  civic:             2,
  mid_hotel:         2,
  education_local:   1,
  shopping_local:    1,
  food:              3,
};

export const COMPETITOR_RADIUS = 800;

// ── Gravity model config ──────────────────────────────────────────────────────

export const PERMANENCE_MULTIPLIER: Record<PermanenceType, number> = {
  permanent: 1.25,
  semi:      1.0,
  temporary: 0.65,
};

export const GRAVITY_CONFIG = {
  distanceDecayRefDist: 520,
  distanceDecayPower:   1.55,

  clusterRadius:      520,
  clusterMinMagnets:    3,
  clusterBonusMax:      8,

  competitorBaseWeight:  2.8,
  competitorDensityGain: 0.14,
  competitorDensityMax:  0.85,
  competitorCloseRadius: 500,
  competitorPressureMax: 15,

  /** Stops / platforms add at most this many raw index points (not scaled like attraction) */
  accessibilityBonusMax:   3.2,
  accessibilityBonusScale: 1.05,

  foodClusterRadius:   220,
  foodClusterMinCount:   5,
  foodClusterWeight:   3.2,

  scoreScale: 1.94,
} as const;

/**
 * Optional soft headline adjustment for the explainable composite `location_score`
 * when neighborhood-environment concern is elevated/high with sufficient OSM confidence.
 * Does not change `evergreenIndex` or score breakdown inputs.
 * Disable at runtime with `ASI_NEIGHBORHOOD_ENV_SCORE_MODIFIER=0`.
 */
export const NEIGHBORHOOD_ENV_SCORE_MODIFIER = {
  minOsmElementsForPenalty: 10,
  /** Hard cap on how many index points may be shaved off the headline score */
  maxPointReduction: 9,
} as const;

// ── Heatmap display colors per category ──────────────────────────────────────

export const CATEGORY_COLOR: Record<string, string> = {
  metro:             '#818cf8',
  airport:           '#67e8f9',
  strategicTransportHub: '#22d3ee',
  specializedMedicalAnchor: '#fb7185',
  attraction:        '#fbbf24',
  hospital:          '#f43f5e',
  major_hotel:       '#fde68a',
  convention:        '#e879f9',
  university:        '#c084fc',
  business:          '#a78bfa',
  railway_station:   '#38bdf8',
  entertainment:     '#f472b6',
  shopping_major:    '#2dd4bf',
  stadium:           '#a3e635',
  civic:             '#fcd34d',
  mid_hotel:         '#fde68a',
  education_local:   '#94a3b8',
  shopping_local:    '#4ade80',
  food:              '#fb923c',
  accessibility_stop:'#64748b',
  competitor:        '#f87171',
};
