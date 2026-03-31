import type { MagnetCategory, PermanenceType } from './types';

// ── Magnet categories ─────────────────────────────────────────────────────────
// IDs must match classifyElement() in overpass.ts. Public-transport *stops* are
// not listed here — they go to accessibilityStops + a tiny capped bonus only.

export const MAGNET_CATEGORIES: MagnetCategory[] = [
  { id: 'metro',            label: 'Метро',                         icon: 'М',  weight: 9,  permanenceType: 'permanent', scopeLevel: 'regional', strengthClass: 'strong' },
  { id: 'railway_station',  label: 'Ж/д и крупные транспортные узлы', icon: 'Ж',  weight: 5,  permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'medium' },
  { id: 'attraction',       label: 'Достопримечательности',         icon: '★',  weight: 8,  permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'strong' },
  { id: 'university',       label: 'Университеты',                icon: 'У',  weight: 6,  permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'education_local',  label: 'Локальные учебные заведения',   icon: 'у',  weight: 1.5, permanenceType: 'permanent', scopeLevel: 'local', strengthClass: 'weak' },
  { id: 'entertainment',    label: 'Развлечения',                   icon: '▶',  weight: 5,  permanenceType: 'semi',      scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'shopping_major',   label: 'ТЦ и крупная розница',          icon: '⊞',  weight: 5,  permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'shopping_local',   label: 'Супермаркеты',                 icon: '+',  weight: 1.2, permanenceType: 'permanent', scopeLevel: 'local',    strengthClass: 'weak' },
  { id: 'business',         label: 'Офисы и бизнес',               icon: 'Б',  weight: 2.5, permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'weak' },
  { id: 'food',             label: 'Кафе и рестораны',             icon: '◈',  weight: 1,  permanenceType: 'semi',      scopeLevel: 'local',    strengthClass: 'weak' },
];

// OSM search radius per category (meters)
export const CATEGORY_RADIUS: Record<string, number> = {
  metro:             1200,
  railway_station:   1400,
  attraction:        1000,
  university:        1000,
  education_local:   650,
  entertainment:     800,
  shopping_major:    900,
  shopping_local:    450,
  business:          550,
  food:              450,
  /** Fetch-only: bus / tram stop nodes (scored only via accessibility bonus) */
  accessibility_stop: 550,
};

// Max items displayed in UI per category
export const CATEGORY_MAX_SHOW: Record<string, number> = {
  metro:             3,
  railway_station:   3,
  attraction:        3,
  university:        3,
  education_local:   3,
  entertainment:     3,
  shopping_major:    3,
  shopping_local:    3,
  business:          3,
  food:              4,
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
  competitorPressureMax: 20,

  /** Stops / platforms add at most this many raw index points (not scaled like attraction) */
  accessibilityBonusMax:   3.2,
  accessibilityBonusScale: 1.05,

  foodClusterRadius:   220,
  foodClusterMinCount:   5,
  foodClusterWeight:   3.2,

  scoreScale: 1.94,
} as const;

// ── Heatmap display colors per category ──────────────────────────────────────

export const CATEGORY_COLOR: Record<string, string> = {
  metro:             '#818cf8',
  railway_station:   '#38bdf8',
  attraction:        '#fbbf24',
  university:        '#c084fc',
  education_local:   '#94a3b8',
  business:          '#a78bfa',
  entertainment:     '#f472b6',
  shopping_major:    '#2dd4bf',
  shopping_local:    '#4ade80',
  food:              '#fb923c',
  accessibility_stop:'#64748b',
  competitor:        '#f87171',
};
