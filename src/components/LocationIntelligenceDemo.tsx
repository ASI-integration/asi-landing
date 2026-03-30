'use client';

import { useState, useEffect, useRef } from 'react';
import { AsiCat } from './AsiCat';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Suggestion {
  value: string;
  lat: string | null;
  lon: string | null;
}

interface SelectedAddress {
  value: string;
  lat: number;
  lon: number;
}

// ── Magnet category config (easily extendable) ────────────────────────────────
// Add new categories here — the rest of the system picks them up automatically.

type PermanenceType = 'permanent' | 'semi' | 'temporary';

interface MagnetCategory {
  id: string;
  label: string;             // Russian label shown in UI
  icon: string;              // short badge text
  weight: number;            // 1–10, demand importance for short-term rental
  permanenceType: PermanenceType; // demand source stability
}

export const MAGNET_CATEGORIES: MagnetCategory[] = [
  { id: 'metro',         label: 'Метро',                    icon: 'М',  weight: 10, permanenceType: 'permanent' },
  { id: 'transport',     label: 'Остановки транспорта',     icon: 'А',  weight: 5,  permanenceType: 'permanent' },
  { id: 'attraction',    label: 'Достопримечательности',    icon: '★',  weight: 8,  permanenceType: 'permanent' },
  { id: 'business',      label: 'Бизнес-центры',            icon: 'Б',  weight: 6,  permanenceType: 'permanent' },
  { id: 'entertainment', label: 'Развлечения',               icon: '▶',  weight: 5,  permanenceType: 'semi'      },
  { id: 'shopping',      label: 'Супермаркеты / ТЦ',        icon: '⊞',  weight: 4,  permanenceType: 'permanent' },
  { id: 'food',          label: 'Кафе и рестораны',         icon: '◈',  weight: 3,  permanenceType: 'semi'      },
];

// Search radius per category (meters)
const CATEGORY_RADIUS: Record<string, number> = {
  metro:         1200,
  transport:     600,
  attraction:    1000,
  business:      700,
  entertainment: 800,
  shopping:      700,
  food:          500,
};

// Max items shown per category in the UI
const CATEGORY_MAX_SHOW: Record<string, number> = {
  metro:         3,
  transport:     4,
  attraction:    3,
  business:      3,
  entertainment: 3,
  shopping:      3,
  food:          4,
};

const COMPETITOR_RADIUS = 800;

// ── Gravity / attraction model config ─────────────────────────────────────────
// All weights and decay params are here — tune without touching logic.

const PERMANENCE_MULTIPLIER: Record<PermanenceType, number> = {
  permanent: 1.3,   // stable, year-round demand sources
  semi:      1.0,   // mostly stable, some seasonal variation
  temporary: 0.65,  // event-based or short-lived
};

const GRAVITY_CONFIG = {
  // Smooth decay: factor = 1 / (1 + (dist/refDist)^power)
  // 0m → 1.0 | refDist → ~0.5 | 2×refDist → ~0.2
  distanceDecayRefDist: 400,    // meters — half-attraction distance
  distanceDecayPower:   1.5,    // curve steepness

  // Cluster: several strong magnets close together = demand zone
  clusterRadius:     600,       // search radius (meters)
  clusterMinMagnets:   3,       // min magnets to qualify as cluster
  clusterBonusMax:    15,       // max bonus points from cluster effect

  // Competitor pressure
  competitorBaseWeight:   3,    // pressure per competitor
  competitorDensityGain:  0.15, // multiplier gain per close competitor
  competitorDensityMax:   0.9,  // cap on density multiplier
  competitorCloseRadius:  500,  // "close" threshold (meters)
  competitorPressureMax:  22,   // cap on total pressure

  scoreScale: 3.5,              // final calibration before capping
} as const;

// ── OSM / Overpass types ───────────────────────────────────────────────────────

interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface MagnetItem {
  categoryId: string;
  categoryLabel: string;
  icon: string;
  name: string;
  distance: number;        // meters
  weight: number;
  permanenceType: PermanenceType;
  attractionScore: number; // computed gravity attraction
}

interface CompetitorItem {
  name: string;
  distance: number;
}

interface GravityExplanation {
  dominantMagnets: string[];
  strongestZoneLabel: string;
  competitorPressureLevel: 'низкое' | 'среднее' | 'высокое';
  demandDistribution: 'concentrated' | 'split' | 'weak';
  clusterDetected: boolean;
  clusterSize: number;
  scoreBreakdown: { attraction: number; competitorPressure: number; clusterBonus: number };
}

interface LocationAnalysis {
  magnets: MagnetItem[];
  magnetCountByCategory: Record<string, number>;
  competitors: CompetitorItem[];
  evergreenIndex: number;
  conclusion: string;
  gravityExplanation: GravityExplanation;
}

// ── Distance helpers ───────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`;
}

/** Smooth distance decay: 1 / (1 + (dist/refDist)^power) — continuous gravity model */
function distanceDecaySmooth(meters: number): number {
  const { distanceDecayRefDist, distanceDecayPower } = GRAVITY_CONFIG;
  return 1 / (1 + Math.pow(meters / distanceDecayRefDist, distanceDecayPower));
}

// ── Overpass API — fetch real nearby objects ───────────────────────────────────

async function fetchOverpass(lat: number, lon: number): Promise<OSMElement[]> {
  // Hardcoded query for reliability (no regex, just explicit tag=value pairs)
  const parts = [
    // Transport magnets
    `node["railway"="subway_entrance"](around:${CATEGORY_RADIUS.metro},${lat},${lon});`,
    `node["highway"="bus_stop"](around:${CATEGORY_RADIUS.transport},${lat},${lon});`,
    `node["public_transport"="stop_position"](around:${CATEGORY_RADIUS.transport},${lat},${lon});`,
    // Attractions
    `node["tourism"="attraction"](around:${CATEGORY_RADIUS.attraction},${lat},${lon});`,
    `node["historic"="monument"](around:${CATEGORY_RADIUS.attraction},${lat},${lon});`,
    `node["historic"="memorial"](around:${CATEGORY_RADIUS.attraction},${lat},${lon});`,
    // Business
    `node["office"="yes"]["name"](around:${CATEGORY_RADIUS.business},${lat},${lon});`,
    `node["office"="company"]["name"](around:${CATEGORY_RADIUS.business},${lat},${lon});`,
    // Entertainment
    `node["amenity"="cinema"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    `node["amenity"="theatre"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    `node["amenity"="arts_centre"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    `node["amenity"="nightclub"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    // Shopping
    `node["shop"="supermarket"](around:${CATEGORY_RADIUS.shopping},${lat},${lon});`,
    `node["shop"="mall"](around:${CATEGORY_RADIUS.shopping},${lat},${lon});`,
    `node["shop"="department_store"](around:${CATEGORY_RADIUS.shopping},${lat},${lon});`,
    // Food
    `node["amenity"="restaurant"](around:${CATEGORY_RADIUS.food},${lat},${lon});`,
    `node["amenity"="cafe"](around:${CATEGORY_RADIUS.food},${lat},${lon});`,
    `node["amenity"="fast_food"](around:${CATEGORY_RADIUS.food},${lat},${lon});`,
    // Competitors (short-term rental proxies)
    `node["tourism"="hotel"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `node["tourism"="apartment"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `node["tourism"="guest_house"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `node["tourism"="hostel"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `way["tourism"="hotel"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `way["tourism"="apartment"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
  ];

  const query = `[out:json][timeout:14];(${parts.join('')});out center;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.elements ?? []) as OSMElement[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Map raw OSM element to a category id + display name */
function classifyElement(el: OSMElement): { categoryId: string; name: string } | null {
  const t = el.tags ?? {};

  if (t.railway === 'subway_entrance')
    return { categoryId: 'metro', name: t.name || 'Метро' };

  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position')
    return { categoryId: 'transport', name: t.name || 'Остановка' };

  if (t.tourism === 'attraction' || t.historic === 'monument' || t.historic === 'memorial')
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };

  if (t.office && t.name)
    return { categoryId: 'business', name: t.name };

  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };

  if (t.shop === 'supermarket' || t.shop === 'mall' || t.shop === 'department_store')
    return { categoryId: 'shopping', name: t.name || 'Магазин' };

  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };

  if (t.tourism === 'hotel' || t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };

  return null;
}

function buildAnalysis(elements: OSMElement[], lat: number, lon: number): LocationAnalysis {
  const byCategory: Record<string, MagnetItem[]> = {};
  const competitors: CompetitorItem[] = [];

  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!elLat || !elLon) continue;

    const classified = classifyElement(el);
    if (!classified) continue;

    const dist = haversineMeters(lat, lon, elLat, elLon);

    if (classified.categoryId === 'competitor') {
      competitors.push({ name: classified.name, distance: dist });
      continue;
    }

    const cat = MAGNET_CATEGORIES.find(c => c.id === classified.categoryId);
    if (!cat) continue;

    if (!byCategory[classified.categoryId]) byCategory[classified.categoryId] = [];
    byCategory[classified.categoryId].push({
      categoryId: cat.id,
      categoryLabel: cat.label,
      icon: cat.icon,
      name: classified.name,
      distance: dist,
      weight: cat.weight,
      permanenceType: cat.permanenceType,
      attractionScore: calcMagnetAttraction(cat.weight, cat.permanenceType, dist),
    });
  }

  // Sort each category by distance; track total count; slice to maxShow
  const magnets: MagnetItem[] = [];
  const magnetCountByCategory: Record<string, number> = {};

  for (const cat of MAGNET_CATEGORIES) {
    const items = (byCategory[cat.id] ?? []).sort((a, b) => a.distance - b.distance);
    magnetCountByCategory[cat.id] = items.length;
    magnets.push(...items.slice(0, CATEGORY_MAX_SHOW[cat.id] ?? 3));
  }

  competitors.sort((a, b) => a.distance - b.distance);

  const { index: evergreenIndex, gravityExplanation } = calcEvergreenIndex(magnets, competitors);
  const conclusion = generateConclusion(evergreenIndex, magnets, competitors, magnetCountByCategory, gravityExplanation);

  return { magnets, magnetCountByCategory, competitors, evergreenIndex, conclusion, gravityExplanation };
}

// ── Gravity / Attraction Engine ────────────────────────────────────────────────
// Internal scoring model. Public attribution: методика курса Ярослава Стригунова.

/** Per-magnet attraction: category weight × permanence multiplier × distance decay */
function calcMagnetAttraction(weight: number, permanenceType: PermanenceType, distance: number): number {
  return weight * PERMANENCE_MULTIPLIER[permanenceType] * distanceDecaySmooth(distance);
}

/** Competitor pressure: distance-decayed sum amplified by close-competitor density */
function calcCompetitorPressure(competitors: CompetitorItem[]): number {
  if (competitors.length === 0) return 0;
  let pressure = 0;
  for (const c of competitors) {
    pressure += GRAVITY_CONFIG.competitorBaseWeight * distanceDecaySmooth(c.distance);
  }
  const closeCount = competitors.filter(c => c.distance <= GRAVITY_CONFIG.competitorCloseRadius).length;
  const densityMul = 1 + Math.min(closeCount * GRAVITY_CONFIG.competitorDensityGain, GRAVITY_CONFIG.competitorDensityMax);
  return Math.min(pressure * densityMul, GRAVITY_CONFIG.competitorPressureMax);
}

/** Cluster bonus: dense magnet groups signal one strong demand zone */
function calcClusterBonus(magnets: MagnetItem[]): { bonus: number; clusterSize: number } {
  const nearby = magnets.filter(m => m.distance <= GRAVITY_CONFIG.clusterRadius);
  const clusterSize = nearby.length;
  if (clusterSize < GRAVITY_CONFIG.clusterMinMagnets) return { bonus: 0, clusterSize };
  const bonus = Math.min(
    GRAVITY_CONFIG.clusterBonusMax,
    (clusterSize - GRAVITY_CONFIG.clusterMinMagnets + 1) * 2.5,
  );
  return { bonus, clusterSize };
}

/** Demand distribution: concentrated around one type, split across zones, or too weak */
function detectDemandDistribution(magnets: MagnetItem[]): 'concentrated' | 'split' | 'weak' {
  if (magnets.length < 2) return 'weak';
  const total = magnets.reduce((s, m) => s + m.attractionScore, 0);
  if (total === 0) return 'weak';
  const byCategory: Record<string, number> = {};
  for (const m of magnets) {
    byCategory[m.categoryId] = (byCategory[m.categoryId] ?? 0) + m.attractionScore;
  }
  const maxShare = Math.max(...Object.values(byCategory)) / total;
  if (maxShare >= 0.55) return 'concentrated';
  if (Object.keys(byCategory).length >= 3) return 'split';
  return 'weak';
}

/** Combined gravity index and explanation fields */
function calcEvergreenIndex(
  magnets: MagnetItem[],
  competitors: CompetitorItem[],
): { index: number; gravityExplanation: GravityExplanation } {
  const emptyExplanation: GravityExplanation = {
    dominantMagnets: [],
    strongestZoneLabel: '',
    competitorPressureLevel: 'низкое',
    demandDistribution: 'weak',
    clusterDetected: false,
    clusterSize: 0,
    scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0 },
  };
  if (magnets.length === 0) return { index: 0, gravityExplanation: emptyExplanation };

  // Attraction scores already computed per-magnet in buildAnalysis
  const totalAttraction = magnets.reduce((s, m) => s + m.attractionScore, 0);
  const competitorPressure = calcCompetitorPressure(competitors);
  const { bonus: clusterBonus, clusterSize } = calcClusterBonus(magnets);

  const rawScore =
    totalAttraction * GRAVITY_CONFIG.scoreScale
    - competitorPressure
    + clusterBonus;

  const index = Math.max(5, Math.min(96, Math.round(rawScore)));

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);
  const dominantMagnets = sorted.slice(0, 3).map(m => m.name);
  const strongestZoneLabel = sorted[0]?.categoryLabel ?? '';
  const demandDistribution = detectDemandDistribution(magnets);
  const competitorPressureLevel: GravityExplanation['competitorPressureLevel'] =
    competitorPressure < 6 ? 'низкое' : competitorPressure < 14 ? 'среднее' : 'высокое';

  return {
    index,
    gravityExplanation: {
      dominantMagnets,
      strongestZoneLabel,
      competitorPressureLevel,
      demandDistribution,
      clusterDetected: clusterSize >= GRAVITY_CONFIG.clusterMinMagnets,
      clusterSize,
      scoreBreakdown: {
        attraction: Math.round(totalAttraction * GRAVITY_CONFIG.scoreScale),
        competitorPressure: Math.round(competitorPressure),
        clusterBonus: Math.round(clusterBonus),
      },
    },
  };
}

// ── Conclusion generator ───────────────────────────────────────────────────────

function generateConclusion(
  idx: number,
  magnets: MagnetItem[],
  competitors: CompetitorItem[],
  countByCategory: Record<string, number>,
  gravity: GravityExplanation,
): string {
  if (magnets.length === 0) return '';

  const hasMetro       = (countByCategory.metro ?? 0) > 0;
  const hasAttractions = (countByCategory.attraction ?? 0) > 0;
  const hasBusiness    = (countByCategory.business ?? 0) > 0;

  const splitNote = gravity.demandDistribution === 'split'
    ? ' Спрос распределён между несколькими зонами притяжения.'
    : gravity.clusterDetected
      ? ' Рядом сформирована зона устойчивого спроса.'
      : '';

  const compNote = gravity.competitorPressureLevel === 'высокое'
    ? ' Конкуренция высокая — важна упаковка и дифференциация объекта.'
    : gravity.competitorPressureLevel === 'среднее'
      ? ' Конкуренция умеренная.'
      : '';

  if (idx >= 70) {
    const driver = hasMetro
      ? 'Метро рядом — устойчивый поток гостей.'
      : hasAttractions
        ? 'Близость к достопримечательностям обеспечивает стабильный спрос.'
        : 'Насыщенное окружение создаёт постоянный трафик.';
    return `Сильная локация для посуточной аренды. ${driver}${splitNote}${compNote}`;
  }

  if (idx >= 45) {
    const note = !hasMetro && !hasBusiness
      ? 'Транспортная доступность — ключевой фактор усиления.'
      : 'Окружение поддерживает умеренный спрос.';
    return `Рабочая локация. ${note}${splitNote}${compNote} Результат во многом определяется упаковкой и каналами продаж.`;
  }

  return `Магниты вокруг ограничены.${splitNote} Рекомендуется точечное позиционирование и проработка каналов продаж.`;
}

// ── Band (score bracket) ───────────────────────────────────────────────────────

type Band = {
  label: string;
  textColor: string;
  stroke: string;
  border: string;
  bg: string;
  bar: string;
};

function getBand(idx: number): Band {
  if (idx >= 70) return {
    label: 'Сильная локация',
    textColor: 'text-emerald-400', stroke: '#34d399',
    border: 'border-emerald-700/40', bg: 'bg-emerald-900/10', bar: 'bg-emerald-500',
  };
  if (idx >= 45) return {
    label: 'Средняя локация',
    textColor: 'text-amber-400', stroke: '#fbbf24',
    border: 'border-amber-700/40', bg: 'bg-amber-900/10', bar: 'bg-amber-500',
  };
  if (idx > 0) return {
    label: 'Требует усиления',
    textColor: 'text-rose-400', stroke: '#f87171',
    border: 'border-rose-700/40', bg: 'bg-rose-900/10', bar: 'bg-rose-500',
  };
  return {
    label: 'Нет данных',
    textColor: 'text-slate-400', stroke: '#475569',
    border: 'border-slate-700/40', bg: 'bg-slate-900/10', bar: 'bg-slate-600',
  };
}

// ── Address suggestion fetch ───────────────────────────────────────────────────

type SuggestStatus = 'idle' | 'ok' | 'no_results' | 'no_key' | 'error';

async function fetchSuggestions(q: string): Promise<{ suggestions: Suggestion[]; status: SuggestStatus }> {
  try {
    const res = await fetch(`/api/address-suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return { suggestions: [], status: 'error' };
    const data = await res.json();
    const suggestions = (data.suggestions ?? []) as Suggestion[];
    const status: SuggestStatus = data.status ?? (suggestions.length > 0 ? 'ok' : 'no_results');
    return { suggestions, status };
  } catch {
    return { suggestions: [], status: 'error' };
  }
}

// ── Idle map panel ────────────────────────────────────────────────────────────

const BLOBS = [
  { top: 28, left: 24, size: 130, op: 0.18 },
  { top: 52, left: 60, size: 160, op: 0.14 },
  { top: 18, left: 70, size: 90,  op: 0.22 },
  { top: 72, left: 38, size: 110, op: 0.11 },
  { top: 62, left: 78, size: 75,  op: 0.16 },
];

const DOT_POOL = [
  { top: 14, left: 12 }, { top: 11, left: 35 }, { top: 18, left: 58 }, { top: 12, left: 80 },
  { top: 34, left: 22 }, { top: 40, left: 48 }, { top: 37, left: 72 }, { top: 31, left: 90 },
  { top: 58, left: 15 }, { top: 62, left: 40 }, { top: 55, left: 65 }, { top: 61, left: 85 },
  { top: 80, left: 28 }, { top: 76, left: 52 }, { top: 83, left: 74 }, { top: 78, left: 92 },
];

function IdleMapPanel() {
  const [activeDots, setActiveDots] = useState<number[]>([]);

  useEffect(() => {
    function pick() {
      const count = 2 + Math.floor(Math.random() * 3);
      const shuffled = [...DOT_POOL.keys()].sort(() => Math.random() - 0.5);
      setActiveDots(shuffled.slice(0, count));
    }
    pick();
    const id = setInterval(pick, 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 420 }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundColor: '#0d1117',
        }}
      />
      <div className="absolute inset-0">
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              top: `${b.top}%`, left: `${b.left}%`,
              width: b.size, height: b.size,
              background: 'radial-gradient(circle, rgba(99,102,241,1) 0%, transparent 70%)',
              opacity: b.op, filter: 'blur(22px)', transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </div>
      {DOT_POOL.map((d, i) => {
        const isActive = activeDots.includes(i);
        return (
          <span
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              top: `${d.top}%`, left: `${d.left}%`,
              width: isActive ? 7 : 4, height: isActive ? 7 : 4,
              transform: 'translate(-50%, -50%)',
              background: isActive ? '#818cf8' : '#1e293b',
              boxShadow: isActive ? '0 0 10px 4px rgba(99,102,241,0.35)' : 'none',
              opacity: isActive ? 0.9 : 0.25,
              transition: 'all 0.5s ease',
            }}
          />
        );
      })}
      {activeDots.map((idx) => {
        const d = DOT_POOL[idx];
        return (
          <span
            key={`ring-${idx}`}
            className="absolute rounded-full pointer-events-none animate-ping"
            style={{
              top: `${d.top}%`, left: `${d.left}%`,
              width: 12, height: 12,
              transform: 'translate(-50%, -50%)',
              border: '1px solid rgba(99,102,241,0.5)',
              animationDuration: `${1.2 + (idx % 5) * 0.3}s`,
              opacity: 0.4,
            }}
          />
        );
      })}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center px-6">
          <div className="w-11 h-11 rounded-full border border-slate-700/60 bg-slate-900/70 flex items-center justify-center mx-auto mb-3">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 1.5C6.1 1.5 3.75 3.85 3.75 6.75c0 4.22 5.25 9.75 5.25 9.75s5.25-5.53 5.25-9.75C14.25 3.85 11.9 1.5 9 1.5zm0 7a2.25 2.25 0 110-4.5 2.25 2.25 0 010 4.5z" fill="rgba(99,102,241,0.45)" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">Введите адрес объекта</p>
          <p className="mt-1.5 text-xs text-slate-700 leading-snug">Анализ начнётся после выбора<br />точного адреса из списка</p>
        </div>
      </div>
    </div>
  );
}

// ── Yandex Map Panel ──────────────────────────────────────────────────────────

function YandexMapPanel({
  lat, lon, loading,
}: {
  lat: number;
  lon: number;
  loading: boolean;
}) {
  // Official Yandex Maps iframe embed URL
  const src = `https://yandex.ru/maps/?ll=${lon},${lat}&z=16&pt=${lon},${lat},pm2rdm&l=map&origin=constructor&from=api-maps`;

  return (
    <div
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 420 }}
    >
      <iframe
        src={src}
        width="100%"
        height="100%"
        frameBorder="0"
        allowFullScreen
        title="Карта окружения объекта — Яндекс Карты"
        loading="lazy"
        style={{ display: 'block' }}
      />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-2xl">
          <div className="w-7 h-7 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin mb-4" />
          <p className="text-white font-semibold text-sm">Запрашиваем окружение...</p>
          <p className="mt-1 text-xs text-slate-500">реальные объекты вокруг адреса</p>
        </div>
      )}
    </div>
  );
}

// ── Address Input ─────────────────────────────────────────────────────────────

function AddressInput({
  onSelect,
  onClear,
  disabled,
}: {
  onSelect: (addr: SelectedAddress) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockedValue, setLockedValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fetching, setFetching] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setText(val);
    setActiveIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length >= 2) {
      setFetching(true);
      debounceRef.current = setTimeout(async () => {
        const result = await fetchSuggestions(val);
        setSuggestions(result.suggestions);
        setSuggestStatus(result.status);
        setOpen(result.suggestions.length > 0);
        setFetching(false);
      }, 280);
    } else {
      setSuggestions([]);
      setOpen(false);
      setSuggestStatus('idle');
      setFetching(false);
    }
  }

  function pick(s: Suggestion) {
    if (!s.lat || !s.lon) return;
    setLocked(true);
    setLockedValue(s.value);
    setText('');
    setSuggestions([]);
    setOpen(false);
    setSuggestStatus('idle');
    onSelect({ value: s.value, lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
  }

  function clear() {
    setLocked(false);
    setLockedValue('');
    setText('');
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    setSuggestStatus('idle');
    onClear();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      {locked && (
        <div className="flex items-center gap-1.5 mb-2">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-[0.18em]">Точный адрес выбран</span>
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={locked ? lockedValue : text}
          onChange={locked ? () => undefined : handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Введите адрес объекта"
          disabled={disabled}
          readOnly={locked}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          className={`w-full py-4 rounded-xl bg-slate-800/80 border text-base focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
            locked
              ? 'border-emerald-700/60 focus:ring-emerald-500/20 pl-10 pr-12 text-emerald-300 cursor-default'
              : 'border-slate-700 text-white placeholder-slate-500 focus:ring-white/15 focus:border-slate-600 px-5 pr-10'
          }`}
        />
        {locked && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="7" stroke="#34d399" strokeOpacity="0.35" />
              <path d="M4.5 7.5L6.5 9.5L10.5 5.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        {locked && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="Изменить адрес"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 transition-all"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8" />
              <line x1="8" y1="1" x2="1" y2="8" />
            </svg>
          </button>
        )}
        {!locked && fetching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin pointer-events-none" />
        )}
      </div>

      {open && suggestions.length > 0 && !locked && (
        <ul
          role="listbox"
          className="absolute z-50 w-full mt-1 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-y-auto"
          style={{ maxHeight: 260 }}
        >
          {suggestions.map((s, i) => (
            <li
              key={i}
              role="option"
              aria-selected={activeIdx === i}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); pick(s); }}
              className={`px-4 py-3 cursor-pointer text-sm leading-snug transition-colors ${
                activeIdx === i ? 'bg-slate-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              {s.value}
            </li>
          ))}
        </ul>
      )}

      {!locked && !open && !fetching && text.trim().length >= 2 && (
        suggestStatus === 'no_results' ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">Адрес не найден — попробуйте уточнить запрос</p>
        ) : (suggestStatus === 'no_key' || suggestStatus === 'error') ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">Подсказки временно недоступны</p>
        ) : null
      )}
    </div>
  );
}

// ── Evergreen ring SVG ────────────────────────────────────────────────────────

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

function EvergreenRing({
  index, band, animated,
}: {
  index: number;
  band: Band;
  animated: boolean;
}) {
  const fill = animated ? (index / 100) * RING_C : 0;
  return (
    <svg width="108" height="108" viewBox="0 0 108 108" className="shrink-0" aria-hidden="true">
      <circle cx="54" cy="54" r={RING_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
      <circle
        cx="54" cy="54" r={RING_R}
        fill="none"
        stroke={band.stroke}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${fill} ${RING_C}`}
        transform="rotate(-90 54 54)"
        style={{ transition: animated ? 'stroke-dasharray 1.0s cubic-bezier(0.4,0,0.2,1)' : 'none' }}
      />
      <text x="54" y="49" textAnchor="middle" fill="white" fontSize="21" fontWeight="700" fontFamily="inherit">
        {index > 0 ? index : '—'}
      </text>
      <text x="54" y="63" textAnchor="middle" fill="rgb(100,116,139)" fontSize="8.5" fontFamily="inherit">
        Индекс вечной
      </text>
      <text x="54" y="74" textAnchor="middle" fill="rgb(100,116,139)" fontSize="8.5" fontFamily="inherit">
        локации
      </text>
    </svg>
  );
}

// ── ASI results panel ─────────────────────────────────────────────────────────

function ASIPanel({
  analysis, address, animated,
}: {
  analysis: LocationAnalysis;
  address: string;
  animated: boolean;
}) {
  const { magnets, magnetCountByCategory, competitors, evergreenIndex, conclusion, gravityExplanation } = analysis;
  const band = getBand(evergreenIndex);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Group shown magnets by category
  const magnetGroups: Record<string, MagnetItem[]> = {};
  for (const m of magnets) {
    if (!magnetGroups[m.categoryId]) magnetGroups[m.categoryId] = [];
    magnetGroups[m.categoryId].push(m);
  }

  const hasMagnets = magnets.length > 0;
  const hasCompetitors = competitors.length > 0;

  return (
    <div
      className={`rounded-2xl border ${band.border} ${band.bg} overflow-hidden`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {/* ── Header: index ring + verdict ── */}
      <div className="p-5 flex items-center gap-4 border-b border-slate-800/60">
        <EvergreenRing index={evergreenIndex} band={band} animated={animated} />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-1">
            Итог анализа
          </p>
          <p className={`text-xl font-bold leading-tight ${band.textColor}`}>
            {band.label}
          </p>
          {conclusion && (
            <p className="mt-2 text-xs text-slate-400 leading-snug">{conclusion}</p>
          )}
          <p
            className="mt-2 text-[10px] text-slate-600 leading-snug"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            title={address}
          >
            {address}
          </p>
        </div>
      </div>

      {/* ── Gravity insight ── */}
      {hasMagnets && gravityExplanation.dominantMagnets.length > 0 && (
        <div className="px-5 pt-4 pb-3 border-b border-slate-800/40">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-2.5">
            Анализ притяжения
          </p>
          <div className="space-y-1.5">
            {gravityExplanation.strongestZoneLabel && (
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-slate-600 shrink-0 w-36">Ключевая зона</span>
                <span className="text-[11px] text-slate-300">{gravityExplanation.strongestZoneLabel}</span>
              </div>
            )}
            {gravityExplanation.dominantMagnets[0] && (
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-slate-600 shrink-0 w-36">Главный магнит</span>
                <span className="text-[11px] text-slate-300 truncate" style={{ maxWidth: 160 }}>
                  {gravityExplanation.dominantMagnets[0]}
                </span>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-slate-600 shrink-0 w-36">Давление конкурентов</span>
              <span className={`text-[11px] font-medium ${
                gravityExplanation.competitorPressureLevel === 'высокое' ? 'text-rose-400'
                : gravityExplanation.competitorPressureLevel === 'среднее' ? 'text-amber-400'
                : 'text-emerald-400'
              }`}>
                {gravityExplanation.competitorPressureLevel}
              </span>
            </div>
            {gravityExplanation.clusterDetected && (
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-slate-600 shrink-0 w-36">Зона спроса</span>
                <span className="text-[11px] text-slate-300">
                  кластер · {gravityExplanation.clusterSize} объектов рядом
                </span>
              </div>
            )}
            {gravityExplanation.demandDistribution === 'split' && (
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-slate-600 shrink-0 w-36">Распределение</span>
                <span className="text-[11px] text-slate-400">спрос разделён между зонами</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Magnets ── */}
      {hasMagnets && (
        <div className="px-5 pt-4 pb-3">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-3">
            Магниты вокруг объекта
          </p>
          <div className="space-y-3">
            {MAGNET_CATEGORIES.map(cat => {
              const items = magnetGroups[cat.id];
              const totalCount = magnetCountByCategory[cat.id] ?? 0;
              if (!items || items.length === 0) return null;
              return (
                <div key={cat.id}>
                  {/* Category header */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-800/60 px-1.5 py-0.5 rounded">
                      {cat.icon}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">{cat.label}</span>
                    {totalCount > (CATEGORY_MAX_SHOW[cat.id] ?? 3) && (
                      <span className="text-[10px] text-slate-700 ml-0.5">
                        +{totalCount - (CATEGORY_MAX_SHOW[cat.id] ?? 3)} ещё
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-700">
                      вес {cat.weight}/10
                    </span>
                  </div>
                  {/* Items */}
                  {items.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between pl-5 py-0.5"
                    >
                      <span
                        className="text-xs text-slate-400 truncate mr-2"
                        style={{ maxWidth: 180 }}
                      >
                        {m.name}
                      </span>
                      <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                        {formatDist(m.distance)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Competitors ── */}
      {hasCompetitors && (
        <div className="px-5 pt-3 pb-4 border-t border-slate-800/40">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-3">
            Конкуренты в окружении
          </p>
          {/* Stats row */}
          <div className="flex gap-5 mb-3">
            <div>
              <p className="text-base font-bold text-slate-200 tabular-nums">{competitors.length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">всего</p>
            </div>
            <div>
              <p className="text-base font-bold text-slate-200 tabular-nums">
                {competitors.filter(c => c.distance <= 500).length}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">в 500 м</p>
            </div>
            <div>
              <p className="text-base font-bold text-slate-200 tabular-nums">
                {formatDist(
                  Math.round(competitors.reduce((s, c) => s + c.distance, 0) / competitors.length)
                )}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">ср. расстояние</p>
            </div>
          </div>
          {/* Closest competitors list */}
          <div className="space-y-0.5">
            {competitors.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between py-0.5">
                <span
                  className="text-xs text-slate-400 truncate mr-2"
                  style={{ maxWidth: 180 }}
                >
                  {c.name}
                </span>
                <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                  {formatDist(c.distance)}
                </span>
              </div>
            ))}
            {competitors.length > 5 && (
              <p className="text-[10px] text-slate-700 mt-1 pl-0">
                +{competitors.length - 5} ещё
              </p>
            )}
          </div>
        </div>
      )}

      {/* No data state */}
      {!hasMagnets && !hasCompetitors && (
        <div className="px-5 py-4">
          <p className="text-xs text-slate-600">
            По этому адресу объектов в базе OpenStreetMap не найдено.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Loading steps ─────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  'Запрашиваем окружение...',
  'Рассчитываем притяжение...',
  'Анализируем конкурентов...',
];

// ── Main export ───────────────────────────────────────────────────────────────

export function LocationIntelligenceDemo() {
  const [selected, setSelected] = useState<SelectedAddress | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [animated, setAnimated] = useState(false);
  const [validationErr, setValidationErr] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) { setValidationErr(true); return; }
    setValidationErr(false);
    setPhase('loading');
    setStep(0);
    setAnalysis(null);
    setAnimated(false);
  }

  function reset() {
    setSelected(null);
    setPhase('idle');
    setAnalysis(null);
    setAnimated(false);
    setValidationErr(false);
    setInputKey(k => k + 1);
  }

  // Loading: step ticker + Overpass fetch
  useEffect(() => {
    if (phase !== 'loading' || !selected) return;
    let cancelled = false;

    // Step ticker
    const tickers = LOADING_STEPS.map((_, i) =>
      i === 0 ? null : setTimeout(() => { if (!cancelled) setStep(i); }, i * 900)
    ).filter(Boolean) as ReturnType<typeof setTimeout>[];

    const fetchStart = Date.now();
    fetchOverpass(selected.lat, selected.lon).then(elements => {
      if (cancelled) return;
      const result = buildAnalysis(elements, selected.lat, selected.lon);
      const elapsed = Date.now() - fetchStart;
      const minDelay = 2500;
      setTimeout(() => {
        if (cancelled) return;
        setAnalysis(result);
        setPhase('result');
        setTimeout(() => { if (!cancelled) setAnimated(true); }, 80);
      }, Math.max(0, minDelay - elapsed));
    });

    return () => {
      cancelled = true;
      tickers.forEach(clearTimeout);
    };
  }, [phase, selected]);

  return (
    <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-5xl mx-auto">

        {/* Section header */}
        <div className="flex items-start gap-5 mb-10">
          <AsiCat mode="location" size={72} className="shrink-0 mt-1" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-1">
              Демо 1 из 2
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
              Система понимает потенциал вашего объекта
            </h2>
            <p className="mt-2 text-slate-400 max-w-lg">
              Введите адрес — и посмотрите, как ASI оценивает локацию: магниты, конкурентов и индекс вечной локации.
            </p>
          </div>
        </div>

        {/* Slogan */}
        <div className="mb-10 pl-1">
          <p className="text-xl sm:text-2xl font-semibold leading-snug">
            <span className="text-slate-200">Карта показывает, что находится вокруг.</span>
          </p>
          <p className="text-xl sm:text-2xl font-semibold leading-snug mt-0.5">
            <span className="text-indigo-400">ASI показывает, как это влияет на ваш объект.</span>
          </p>
        </div>

        {/* ── RESULT PHASE ── */}
        {phase === 'result' && analysis ? (
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">

            {/* Left: Yandex map */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Карта окружения
                </span>
                <span className="text-[10px] text-slate-700">· Яндекс Карты</span>
              </div>
              <YandexMapPanel lat={selected!.lat} lon={selected!.lon} loading={false} />
              <div className="mt-3">
                <p className="text-[11px] text-slate-500 mb-2 truncate">{selected?.value}</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Объект на карте', 'Транспорт', 'Объекты вокруг', 'Реальная карта'].map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-500 border border-slate-800">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={reset}
                className="mt-5 w-full py-3 px-6 rounded-xl border border-slate-700/80 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
              >
                Проверить другой адрес
              </button>
            </div>

            {/* Right: ASI analysis */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-400">
                  ASI · Анализ локации
                </span>
              </div>
              <ASIPanel
                analysis={analysis}
                address={selected?.value ?? ''}
                animated={animated}
              />
            </div>

          </div>
        ) : (
          // ── IDLE / LOADING PHASE ──
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">

            {/* Left: form */}
            <div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <AddressInput
                  key={inputKey}
                  onSelect={addr => { setSelected(addr); setValidationErr(false); }}
                  onClear={() => setSelected(null)}
                  disabled={phase === 'loading'}
                />
                {validationErr && (
                  <p className="text-sm text-rose-400 px-1" role="alert">
                    Выберите точный адрес из списка
                  </p>
                )}
                <button
                  type="submit"
                  disabled={phase === 'loading'}
                  className="w-full py-4 px-8 bg-white text-slate-900 font-bold text-base rounded-xl hover:bg-slate-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-white/5 hover:shadow-white/10 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {phase === 'loading' ? LOADING_STEPS[step] : 'Рассчитать локацию'}
                </button>
              </form>
              {phase === 'idle' && (
                <p className="mt-5 text-xs text-slate-600">
                  Используются реальные данные OpenStreetMap / Яндекс Карты
                </p>
              )}
            </div>

            {/* Right: map */}
            <div>
              {selected ? (
                <YandexMapPanel lat={selected.lat} lon={selected.lon} loading={phase === 'loading'} />
              ) : (
                <IdleMapPanel />
              )}
            </div>

          </div>
        )}

        {/* Attribution */}
        <p className="mt-10 text-[11px] text-slate-500 text-center leading-relaxed max-w-lg mx-auto">
          Методика ASI построена на логике оценки локации, изученной в курсе Ярослава Стригунова, и адаптирована под автоматизированный расчёт.
        </p>

      </div>
    </section>
  );
}
