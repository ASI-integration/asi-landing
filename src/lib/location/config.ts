import type { MagnetCategory, PermanenceType } from './types';

// ── Magnet categories ─────────────────────────────────────────────────────────
// Add new categories here — the rest of the engine picks them up automatically.

export const MAGNET_CATEGORIES: MagnetCategory[] = [
  { id: 'metro',         label: 'Метро',                 icon: 'М',  weight: 10, permanenceType: 'permanent', scopeLevel: 'regional', strengthClass: 'strong' },
  { id: 'transport',     label: 'Остановки транспорта',  icon: 'А',  weight: 5,  permanenceType: 'permanent', scopeLevel: 'local',    strengthClass: 'weak' },
  { id: 'attraction',    label: 'Достопримечательности', icon: '★',  weight: 8,  permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'strong' },
  { id: 'business',      label: 'Бизнес-центры',         icon: 'Б',  weight: 6,  permanenceType: 'permanent', scopeLevel: 'district', strengthClass: 'medium' },
  { id: 'entertainment', label: 'Развлечения',            icon: '▶',  weight: 5,  permanenceType: 'semi',      scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'shopping',      label: 'Супермаркеты / ТЦ',     icon: '⊞',  weight: 4,  permanenceType: 'permanent', scopeLevel: 'city',     strengthClass: 'medium' },
  { id: 'food',          label: 'Кафе и рестораны',      icon: '◈',  weight: 3,  permanenceType: 'semi',      scopeLevel: 'local',    strengthClass: 'weak' },
];

// OSM search radius per category (meters)
export const CATEGORY_RADIUS: Record<string, number> = {
  metro:         1200,
  transport:     600,
  attraction:    1000,
  business:      700,
  entertainment: 800,
  shopping:      700,
  food:          500,
};

// Max items displayed in UI per category
export const CATEGORY_MAX_SHOW: Record<string, number> = {
  metro:         3,
  transport:     4,
  attraction:    3,
  business:      3,
  entertainment: 3,
  shopping:      3,
  food:          4,
};

export const COMPETITOR_RADIUS = 800;

// ── Gravity model config ──────────────────────────────────────────────────────
// All weights and decay params here — tune without touching logic.

export const PERMANENCE_MULTIPLIER: Record<PermanenceType, number> = {
  permanent: 1.3,   // stable, year-round demand sources
  semi:      1.0,   // mostly stable, some seasonal variation
  temporary: 0.65,  // event-based or short-lived
};

export const GRAVITY_CONFIG = {
  // Smooth decay: factor = 1 / (1 + (dist/refDist)^power)
  // 0m → 1.0 | refDist → ~0.5 | 2×refDist → ~0.2
  distanceDecayRefDist: 400,   // meters — half-attraction distance
  distanceDecayPower:   1.5,   // curve steepness

  // Cluster: several strong magnets close together = demand zone
  clusterRadius:      600,     // search radius (meters)
  clusterMinMagnets:    3,     // min magnets to qualify as cluster
  clusterBonusMax:     15,     // max bonus points from cluster effect

  // Competitor pressure
  competitorBaseWeight:  3,    // pressure per competitor
  competitorDensityGain: 0.15, // multiplier gain per close competitor
  competitorDensityMax:  0.9,  // cap on density multiplier
  competitorCloseRadius: 500,  // "close" threshold (meters)
  competitorPressureMax: 22,   // cap on total pressure

  scoreScale: 3.5,             // final calibration before capping
} as const;

// ── Heatmap display colors per category ──────────────────────────────────────

export const CATEGORY_COLOR: Record<string, string> = {
  metro:         '#818cf8', // indigo
  transport:     '#60a5fa', // blue
  attraction:    '#fbbf24', // amber
  business:      '#a78bfa', // violet
  entertainment: '#f472b6', // pink
  shopping:      '#2dd4bf', // teal
  food:          '#fb923c', // orange
  competitor:    '#f87171', // rose
};
