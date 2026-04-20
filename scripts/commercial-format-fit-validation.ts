/**
 * Commercial format-fit validation — 20 hand-picked real-world addresses.
 * Runs live OSM fetch + buildAnalysis + buildCommercialFormatFit for each.
 *
 * Usage: npx --yes tsx scripts/commercial-format-fit-validation.ts
 * Output:
 *   - scripts/commercial-format-fit-validation-results.json (spatialFoundation: true, legacy shape)
 *   - scripts/commercial-spatial-foundation-v1-ab.json (before/after per case)
 *   - docs/spatial-foundation-v1-validation.md (summary + tables)
 *
 * Control set covers: retail street, food/cafe, service point, convenience/transit,
 * showroom/appointment, destination venue — across strong/weak/disputed/tourist/transit buckets.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';
import { buildCommercialFormatFit } from '../src/lib/location/commercial-format-fit';
import { createDisabledSpatialFoundation } from '../src/lib/location/spatial-foundation';
import type { LocationAnalysis } from '../src/lib/location/types';
import type { CommercialFormatFit, CommercialOverallVerdict } from '../src/lib/location/commercial-format-fit';

// ── Control set ───────────────────────────────────────────────────────────────
const CASES = [
  // ── Strong central commercial ─────────────────────────────────────────────
  {
    id: 'red_square_moscow',
    label: 'Красная площадь, Москва',
    city: 'Москва, Россия',
    lat: 55.7540, lon: 37.6208,
    bucket: 'strong',
    primaryType: 'destination_venue',
    humanExpected: {
      retail: 'high',
      food_beverage: 'high',
      service: 'medium',
      convenience: 'medium',
      showroom: 'low',
      destination_venue: 'high',
    },
    humanRationale: 'Сильнейший туристический якорь. Destination HIGH — очевидно. Retail и food HIGH — большой поток туристов и москвичей. Convenience MEDIUM — туристы иногда покупают мелочёвку, но цены и формат не типичны для ежедневного. Service LOW — туристы не ходят к барберу. Showroom LOW — нет целевой аудитории.',
  },
  {
    id: 'arbat_moscow',
    label: 'Арбат, Москва',
    city: 'Москва, Россия',
    lat: 55.7500, lon: 37.5958,
    bucket: 'strong',
    primaryType: 'retail',
    humanExpected: {
      retail: 'high',
      food_beverage: 'high',
      service: 'medium',
      convenience: 'low',
      showroom: 'low',
      destination_venue: 'medium',
    },
    humanRationale: 'Туристическая пешеходная улица. Retail HIGH — сувениры, одежда, книги. Food HIGH — кафе, рестораны, Street food. Destination MEDIUM — знаковое место, но не массовый аттракцион как Красная площадь. Convenience LOW — туристическая улица, не ежедневный шопинг.',
  },
  {
    id: 'tverskaya_moscow',
    label: 'Тверская улица, Москва',
    city: 'Москва, Россия',
    lat: 55.7654, lon: 37.6064,
    bucket: 'strong',
    primaryType: 'retail',
    humanExpected: {
      retail: 'high',
      food_beverage: 'high',
      service: 'high',
      convenience: 'medium',
      showroom: 'medium',
      destination_venue: 'medium',
    },
    humanRationale: 'Главная деловая и торговая улица Москвы. Retail HIGH — флагманские магазины, премиум. Food HIGH — рестораны на любой вкус. Service HIGH — деловая аудитория + туристы + locals. Showroom MEDIUM — есть примеры luxury showroom. Convenience MEDIUM — метро рядом, потребительский трафик.',
  },
  {
    id: 'nevsky_spb',
    label: 'Невский проспект, Санкт-Петербург',
    city: 'Санкт-Петербург, Россия',
    lat: 59.9344, lon: 30.3424,
    bucket: 'strong',
    primaryType: 'retail',
    humanExpected: {
      retail: 'high',
      food_beverage: 'high',
      service: 'medium',
      convenience: 'medium',
      showroom: 'low',
      destination_venue: 'medium',
    },
    humanRationale: 'Центральная улица СПб, туристы + деловые + locals. Retail HIGH, Food HIGH очевидно. Destination MEDIUM — есть знаковые точки, но Невский — скорее shopping street, чем destination itself.',
  },
  // ── Transit / convenience heavy ───────────────────────────────────────────
  {
    id: 'kursky_station_moscow',
    label: 'Курский вокзал, Москва',
    city: 'Москва, Россия',
    lat: 55.7592, lon: 37.6600,
    bucket: 'transit',
    primaryType: 'convenience',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'medium',
      service: 'low',
      convenience: 'high',
      showroom: 'poor',
      destination_venue: 'low',
    },
    humanRationale: 'Вокзал — классическая convenience точка. Люди в транзите, нужны быстрые покупки: вода, еда на вынос, аптека, снеки. Food MEDIUM — rush-формат, не destination ресторан. Service LOW — никто не идёт к парикмахеру в транзите. Showroom POOR — неподходящая аудитория. Destination LOW — вокзал сам по себе не destination.',
  },
  {
    id: 'gare_du_nord_paris',
    label: 'Gare du Nord, Париж',
    city: 'Париж, Франция',
    lat: 48.8809, lon: 2.3553,
    bucket: 'transit',
    primaryType: 'convenience',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'medium',
      service: 'low',
      convenience: 'high',
      showroom: 'poor',
      destination_venue: 'low',
    },
    humanRationale: 'Крупнейший вокзал Парижа (Eurostar, RER). Масштабнее Курского. Convenience HIGH — огромный транзитный поток. Food MEDIUM — быстрые форматы в вокзале. Showroom POOR — абсолютно неподходящий контекст.',
  },
  // ── Business-led / service ────────────────────────────────────────────────
  {
    id: 'moscow_city',
    label: 'Москва-Сити',
    city: 'Москва, Россия',
    lat: 55.7482, lon: 37.5403,
    bucket: 'business',
    primaryType: 'service',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'high',
      service: 'high',
      convenience: 'medium',
      showroom: 'high',
      destination_venue: 'medium',
    },
    humanRationale: 'Деловой центр, корпоративная аудитория. Service HIGH — барбершоп, химчистка, ремонт техники. Food HIGH — бизнес-ланчи, кофе. Showroom HIGH — B2B шоурумы, офисная техника, предметы интерьера. Retail MEDIUM — деловой трафик есть, но не shopping-формат. Destination MEDIUM — туристы смотрят на небоскрёбы.',
  },
  {
    id: 'canary_wharf_london',
    label: 'Canary Wharf, Лондон',
    city: 'Лондон, Великобритания',
    lat: 51.5054, lon: -0.0235,
    bucket: 'business',
    primaryType: 'service',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'high',
      service: 'high',
      convenience: 'medium',
      showroom: 'medium',
      destination_venue: 'low',
    },
    humanRationale: 'Деловой квартал. Аудитория — офисные работники финансового сектора. Food HIGH — корпоративный обед обязателен. Service HIGH — стрижка, химчистка. Retail MEDIUM — есть торговый центр внутри. Destination LOW — не туристическое место, хотя вид на Темзу привлекает немного.',
  },
  // ── Destination / tourist / leisure ──────────────────────────────────────
  {
    id: 'covent_garden_london',
    label: 'Covent Garden, Лондон',
    city: 'Лондон, Великобритания',
    lat: 51.5121, lon: -0.1230,
    bucket: 'destination',
    primaryType: 'destination_venue',
    humanExpected: {
      retail: 'high',
      food_beverage: 'high',
      service: 'low',
      convenience: 'low',
      showroom: 'low',
      destination_venue: 'high',
    },
    humanRationale: 'Один из самых посещаемых туристических рынков Лондона. Destination HIGH очевидно. Retail HIGH — boutique, сувениры, уличная торговля. Food HIGH — рестораны, кафе обслуживают толпы. Service LOW — туристы не ищут сервисные услуги здесь. Convenience LOW — не ежедневный трафик жителей.',
  },
  {
    id: 'shoreditch_london',
    label: 'Shoreditch High Street, Лондон',
    city: 'Лондон, Великобритания',
    lat: 51.5227, lon: -0.0783,
    bucket: 'destination',
    primaryType: 'food_beverage',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'high',
      service: 'medium',
      convenience: 'medium',
      showroom: 'low',
      destination_venue: 'medium',
    },
    humanRationale: 'Creative / hipster hub. Food HIGH — рестораны, бары, кофе — главная ценность Shoreditch. Destination MEDIUM — люди специально едут, но не как в Covent Garden (более нишевая аудитория). Retail MEDIUM — независимые бутики, дизайнерские магазины. Service MEDIUM — модные барбершопы, татуировки, студии йоги.',
  },
  {
    id: 'times_square_nyc',
    label: 'Times Square, Нью-Йорк',
    city: 'Нью-Йорк, США',
    lat: 40.7580, lon: -73.9855,
    bucket: 'strong',
    primaryType: 'destination_venue',
    humanExpected: {
      retail: 'high',
      food_beverage: 'high',
      service: 'low',
      convenience: 'medium',
      showroom: 'low',
      destination_venue: 'high',
    },
    humanRationale: 'Главная точка притяжения туристов в мире. Destination HIGH однозначно. Retail HIGH — крупнейшие flagship-магазины. Food HIGH — но скорее сетевые форматы, не gourmet. Service LOW — не для этой аудитории. Showroom LOW — слишком хаотичная аудитория для appointment-based.',
  },
  {
    id: 'vdnkh_moscow',
    label: 'ВДНХ, Москва',
    city: 'Москва, Россия',
    lat: 55.8278, lon: 37.6316,
    bucket: 'destination',
    primaryType: 'destination_venue',
    humanExpected: {
      retail: 'low',
      food_beverage: 'medium',
      service: 'low',
      convenience: 'medium',
      showroom: 'medium',
      destination_venue: 'high',
    },
    humanRationale: 'ВДНХ — крупный рекреационный destination. Destination HIGH — выставки, парк, музеи. Food MEDIUM — есть кафе, но туристическое. Retail LOW — сувенирный, не retail-сегмент. Showroom MEDIUM — на ВДНХ традиционно размещают экспозиции, техника, авто. Convenience MEDIUM — есть метро рядом, местный трафик.',
  },
  {
    id: 'el_poblado_medellin',
    label: 'El Poblado, Медельин',
    city: 'Медельин, Колумбия',
    lat: 6.2089, lon: -75.5690,
    bucket: 'destination',
    primaryType: 'food_beverage',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'high',
      service: 'medium',
      convenience: 'low',
      showroom: 'low',
      destination_venue: 'medium',
    },
    humanRationale: 'Туристический / expat районOn с концентрацией баров, ресторанов. Food HIGH — это суть El Poblado. Destination MEDIUM — туристический, но скорее neighbourhood, чем single landmark. Retail MEDIUM — бутики, ремёсла. Convenience LOW — жизнеобеспечение туристов, но не ежедневное хозяйство местных.',
  },
  // ── Showroom / appointment-appropriate ───────────────────────────────────
  {
    id: 'leningradsky_showroom_moscow',
    label: 'Ленинградский пр-т (авто-шоурумы), Москва',
    city: 'Москва, Россия',
    lat: 55.7855, lon: 37.5245,
    bucket: 'showroom',
    primaryType: 'showroom',
    humanExpected: {
      retail: 'low',
      food_beverage: 'low',
      service: 'medium',
      convenience: 'low',
      showroom: 'high',
      destination_venue: 'low',
    },
    humanRationale: 'Исторически сложившийся кластер автодилеров и шоурумов на Ленинградке. Showroom HIGH — целевая аудитория приезжает намеренно, хорошая доступность. Retail LOW — не shopping area. Food LOW — нет сформированного пешеходного потока. Service MEDIUM — автосервисы, смежные услуги.',
  },
  {
    id: 'dubai_marina',
    label: 'Dubai Marina, Дубай',
    city: 'Дубай, ОАЭ',
    lat: 25.0819, lon: 55.1407,
    bucket: 'destination',
    primaryType: 'destination_venue',
    humanExpected: {
      retail: 'medium',
      food_beverage: 'high',
      service: 'medium',
      convenience: 'medium',
      showroom: 'high',
      destination_venue: 'high',
    },
    humanRationale: 'Премиальный жилой / туристический кластер с набережной. Destination HIGH — Marina Walk, яхты, прогулки. Food HIGH — рестораны с видом на марину. Showroom HIGH — luxury brands, интерьер, авто в соседних кварталах. Retail MEDIUM — торговые центры рядом. Convenience MEDIUM — живут здесь экспаты.',
  },
  // ── Weak / industrial / suburban ─────────────────────────────────────────
  {
    id: 'lyubertsy_center',
    label: 'Центр Люберец, Подмосковье',
    city: 'Люберцы, Московская область',
    lat: 55.6769, lon: 37.8942,
    bucket: 'weak',
    primaryType: 'convenience',
    humanExpected: {
      retail: 'low',
      food_beverage: 'low',
      service: 'medium',
      convenience: 'medium',
      showroom: 'poor',
      destination_venue: 'poor',
    },
    humanRationale: 'Слабый подмосковный центр. Convenience MEDIUM — есть местный жилой поток. Service MEDIUM — для местных жителей. Retail LOW — нет достаточного целевого потока. Showroom POOR — нет аудитории. Destination POOR — никто не едет в Люберцы целенаправленно.',
  },
  {
    id: 'elektrozavodskaya_moscow',
    label: 'Электрозаводская, Москва (промзона)',
    city: 'Москва, Россия',
    lat: 55.7840, lon: 37.7062,
    bucket: 'industrial',
    primaryType: 'service',
    humanExpected: {
      retail: 'poor',
      food_beverage: 'low',
      service: 'low',
      convenience: 'low',
      showroom: 'poor',
      destination_venue: 'poor',
    },
    humanRationale: 'Промышленная / транзитная зона. Есть метро, но поток транзитный, не потребительский. Retail POOR — промышленное окружение. Food LOW — есть рабочие столовые, но не cafe-формат. Service LOW — минимальный. Showroom POOR — нет целевой аудитории. Destination POOR — ничего нет.',
  },
  {
    id: 'pokrovskoye_streshnevo',
    label: 'Покровское-Стрешнево, Москва',
    city: 'Москва, Россия',
    lat: 55.8178, lon: 37.4253,
    bucket: 'residential',
    primaryType: 'service',
    humanExpected: {
      retail: 'low',
      food_beverage: 'low',
      service: 'medium',
      convenience: 'high',
      showroom: 'poor',
      destination_venue: 'low',
    },
    humanRationale: 'Тихий жилой район с парком. Convenience HIGH — местные жители + есть метро. Service MEDIUM — neighbourhood services (парикмахер, аптека). Retail LOW — нет торгового потока. Food LOW — максимум местная кофейня. Destination LOW — парк Стрешнево, но небольшой. Showroom POOR.',
  },
  {
    id: 'khamovniki_moscow',
    label: 'Хамовники (жилой), Москва',
    city: 'Москва, Россия',
    lat: 55.7309, lon: 37.5783,
    bucket: 'residential',
    primaryType: 'service',
    humanExpected: {
      retail: 'low',
      food_beverage: 'medium',
      service: 'high',
      convenience: 'high',
      showroom: 'low',
      destination_venue: 'low',
    },
    humanRationale: 'Центральный жилой район с хорошим локальным потоком. Service HIGH — высокая плотность проживания, доходная аудитория. Convenience HIGH — метро рядом, жители. Food MEDIUM — neighbourhood cafes, не destination. Retail LOW — не торговая улица. Showroom LOW — residential area.',
  },
  {
    id: 'gorky_park_moscow',
    label: 'Парк Горького, Москва',
    city: 'Москва, Россия',
    lat: 55.7290, lon: 37.6015,
    bucket: 'destination',
    primaryType: 'food_beverage',
    humanExpected: {
      retail: 'low',
      food_beverage: 'high',
      service: 'low',
      convenience: 'medium',
      showroom: 'low',
      destination_venue: 'high',
    },
    humanRationale: 'Крупный рекреационный destination. Food HIGH — парк Горького знаменит кафе, уличной едой, ресторанами. Destination HIGH — специально едут, место для отдыха. Retail LOW — в парке нет торговли. Service LOW — парковый контекст. Convenience MEDIUM — есть поток людей с мелкими покупками.',
  },
] as const;

type CaseRow = (typeof CASES)[number];

const FIT_LEVELS = ['poor', 'low', 'medium', 'high'] as const;
const VERDICT_RANK: Record<CommercialOverallVerdict, number> = {
  poor: 0,
  weak: 1,
  selective: 2,
  strong: 3,
};

function buildBarriersRuLocal(a: LocationAnalysis): string[] {
  const barriers: string[] = [];
  const env = a.neighborhoodEnvironment;
  if ((env.breakdown.industrial01 ?? 0) > 0.4)
    barriers.push('Промышленная инфраструктура снижает потребительский контекст');
  if ((env.breakdown.majorRoads01 ?? 0) > 0.55)
    barriers.push('Перегруженные магистрали затрудняют пешеходный подход');
  if ((env.breakdown.nightlife01 ?? 0) > 0.45)
    barriers.push('Ночная активность — возможные конфликты формата');
  if ((env.breakdown.aviation01 ?? 0) > 0.4)
    barriers.push('Близость авиационных объектов (шум)');
  if (a.gravityExplanation.competitorPressureLevel === 'high')
    barriers.push('Высокая конкурентная плотность');
  return barriers;
}

function fitLevelIndex(level: string): number {
  const i = FIT_LEVELS.indexOf(level as (typeof FIT_LEVELS)[number]);
  return i < 0 ? -1 : i;
}

function spatialSnap(a: LocationAnalysis) {
  const sf = a.spatialFoundation ?? createDisabledSpatialFoundation();
  return {
    enabled: sf.enabled,
    spatialTier: sf.spatialTier,
    barrierPenaltyApplied: sf.barrierPenaltyApplied,
    penalizedMagnetCount: sf.penalizedMagnetCount,
    barrierKindsDetected: sf.barrierKindsDetected,
    corridorSnapM: sf.corridorSnapM,
    distanceInflationM: sf.distanceInflationM,
  };
}

function commercialSnap(a: LocationAnalysis, formatFit: CommercialFormatFit) {
  const fitMap: Record<string, string> = {};
  for (const e of formatFit.entries) fitMap[e.format] = e.fitLevel;
  const limitingByFormat: Record<string, string[]> = {};
  for (const e of formatFit.entries) limitingByFormat[e.format] = [...e.limitingFactorsRu];
  return {
    overallVerdict: formatFit.overallVerdict,
    overallVerdictLabelRu: formatFit.overallVerdictLabelRu,
    fitMap,
    limitingByFormat,
    barriers: buildBarriersRuLocal(a),
    spatial: spatialSnap(a),
    entries: formatFit.entries.map(e => ({
      format: e.format,
      fitLevel: e.fitLevel,
      explanationRu: e.explanationRu,
      supportingFactors: e.supportingFactorsRu,
      limitingFactors: e.limitingFactorsRu,
    })),
  };
}

function humanDiscrepancies(
  c: CaseRow,
  fitMap: Record<string, string>,
): Array<{ format: string; expected: string; actual: string; severity: string }> {
  const discrepancies: Array<{ format: string; expected: string; actual: string; severity: string }> = [];
  for (const [format, expected] of Object.entries(c.humanExpected)) {
    const actual = fitMap[format] ?? 'unknown';
    if (actual !== expected) {
      const levels = ['poor', 'low', 'medium', 'high'];
      const diff = Math.abs(levels.indexOf(actual) - levels.indexOf(expected));
      const severity = diff >= 2 ? 'critical' : diff === 1 ? 'medium' : 'minor';
      discrepancies.push({ format, expected, actual, severity });
    }
  }
  return discrepancies;
}

function primaryDistanceToHuman(c: CaseRow, fitMap: Record<string, string>): number {
  const exp = c.humanExpected[c.primaryType as keyof typeof c.humanExpected];
  const act = fitMap[c.primaryType] ?? 'unknown';
  if (!exp || act === 'unknown') return 999;
  return Math.abs(fitLevelIndex(act) - fitLevelIndex(exp as string));
}

function classifyAb(c: CaseRow, before: ReturnType<typeof commercialSnap>, after: ReturnType<typeof commercialSnap>) {
  const sameCore =
    before.overallVerdict === after.overallVerdict
    && JSON.stringify(before.fitMap) === JSON.stringify(after.fitMap)
    && JSON.stringify(before.barriers) === JSON.stringify(after.barriers)
    && JSON.stringify(before.limitingByFormat) === JSON.stringify(after.limitingByFormat);

  if (sameCore) return 'no_effect' as const;

  const critBefore = humanDiscrepancies(c, before.fitMap).filter(d => d.severity === 'critical').length;
  const critAfter = humanDiscrepancies(c, after.fitMap).filter(d => d.severity === 'critical').length;
  const distBefore = primaryDistanceToHuman(c, before.fitMap);
  const distAfter = primaryDistanceToHuman(c, after.fitMap);
  const vRankBefore = VERDICT_RANK[before.overallVerdict as CommercialOverallVerdict];
  const vRankAfter = VERDICT_RANK[after.overallVerdict as CommercialOverallVerdict];

  const regressed =
    vRankAfter < vRankBefore
    || critAfter > critBefore
    || distAfter > distBefore;

  const improved =
    vRankAfter > vRankBefore
    || critAfter < critBefore
    || distAfter < distBefore;

  if (regressed && improved) return 'mixed' as const;
  if (regressed) return 'regression' as const;
  if (improved) return 'improved' as const;
  return 'mixed' as const;
}

function abScore(c: CaseRow, snap: ReturnType<typeof commercialSnap>): number {
  /** Higher = closer to human labels on primary format (for ranking top improvements). */
  return -primaryDistanceToHuman(c, snap.fitMap) * 10
    - humanDiscrepancies(c, snap.fitMap).filter(d => d.severity === 'critical').length * 5
    + VERDICT_RANK[snap.overallVerdict as CommercialOverallVerdict];
}

// ── Runner ────────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function buildMarkdownReport(args: {
  abRows: unknown[];
  improved: string[];
  noEffect: string[];
  regressions: string[];
  mixed: string[];
  topImproved: Array<{ id: string; label: string; delta: string }>;
  executiveLines: string[];
}): string {
  const { abRows, improved, noEffect, regressions, mixed, topImproved, executiveLines } = args;
  const fetchErrors = abRows.filter(r => (r as Record<string, unknown>).error).length;
  const fetchOk = abRows.length - fetchErrors;
  let fitMapChanged = 0;
  for (const raw of abRows) {
    const r = raw as Record<string, unknown>;
    if (r.error) continue;
    const b = r.before as Record<string, unknown>;
    const a = r.after as Record<string, unknown>;
    if (JSON.stringify(b.fitMap) !== JSON.stringify(a.fitMap)) fitMapChanged++;
  }
  const lines: string[] = [];
  lines.push('# Spatial Foundation v1 — commercial validation (A/B)');
  lines.push('');
  lines.push('**Дата:** 2026-04-19  ');
  lines.push('**Метод:** один и тот же live OSM fetch на кейс → `buildAnalysis(..., { spatialFoundation: false })` vs `true` → `buildCommercialFormatFit`.');
  lines.push('');
  lines.push('Исходные данные: `scripts/commercial-spatial-foundation-v1-ab.json`. Legacy выгрузка «только after»: `scripts/commercial-format-fit-validation-results.json`.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 0. Качество fetch (Overpass)');
  lines.push('');
  lines.push(`Успешных запросов: **${fetchOk} / ${abRows.length}**. Ошибок (таймаут и т.п.): **${fetchErrors}**.`);
  lines.push(`Среди успешных, число кейсов где изменился хотя бы один уровень format‑fit (**fitMap**): **${fitMapChanged} / ${fetchOk}**.`);
  lines.push('При деградации публичного Overpass перезапустите `npx tsx scripts/commercial-format-fit-validation.ts` в другое время, чтобы закрыть пропуски в матрице.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Сводка');
  lines.push('');
  lines.push(`| Класс | Кейсы (${abRows.length} всего) |`);
  lines.push('|--------|----------------|');
  lines.push(`| Улучшились (по вердикту / critical human diff / primary vs human) | ${improved.join(', ') || '—'} |`);
  lines.push(`| Без эффекта (вердикт, fitMap, barriers, limiting — совпали) | ${noEffect.join(', ') || '—'} |`);
  lines.push(`| Регрессии | ${regressions.join(', ') || '—'} |`);
  lines.push(`| Смешанный сигнал | ${mixed.join(', ') || '—'} |`);
  lines.push('');
  lines.push('### Топ‑5 по сдвигу к human‑ожиданиям на primary format');
  lines.push('');
  for (let i = 0; i < topImproved.length; i++) {
    const t = topImproved[i];
    lines.push(`${i + 1}. **${t.id}** — ${t.label}: ${t.delta}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. Таблица before → after');
  lines.push('');
  lines.push('| ID | Вердикт | Primary fit | Spatial (after) | Barriers Δ |');
  lines.push('|----|---------|---------------|-----------------|------------|');
  for (const raw of abRows as Array<Record<string, unknown>>) {
    if (raw.error) continue;
    const b = raw.before as Record<string, unknown>;
    const a = raw.after as Record<string, unknown>;
    const pt = raw.primaryType as string;
    const bf = (b.fitMap as Record<string, string>)[pt] ?? '?';
    const af = (a.fitMap as Record<string, string>)[pt] ?? '?';
    const bs = (b.spatial as Record<string, unknown>);
    const as = (a.spatial as Record<string, unknown>);
    const barrEq = JSON.stringify(b.barriers) === JSON.stringify(a.barriers);
    lines.push(
      `| ${raw.id} | ${b.overallVerdict} → ${a.overallVerdict} | ${bf} → ${af} | `
        + `tier=${as.spatialTier}, penalty=${as.barrierPenaltyApplied}, kinds=${(as.barrierKindsDetected as string[]).join('/') || '—'} | `
        + `${barrEq ? '—' : 'изм.'} |`,
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 3. Карточки по кейсам (verdict, format‑fit, barriers, limiting, spatial tier)');
  lines.push('');
  for (const raw of abRows as Array<Record<string, unknown>>) {
    if (raw.error) {
      lines.push(`### ${raw.id}`);
      lines.push(`**Ошибка:** ${raw.error}`);
      lines.push('');
      continue;
    }
    lines.push(`### ${raw.id} — ${raw.label}`);
    lines.push('');
    lines.push(`**Классификация:** ${raw.abClass} (${raw.abRationale})`);
    lines.push('');
    const b = raw.before as Record<string, unknown>;
    const a = raw.after as Record<string, unknown>;
    lines.push('| Поле | Before (SF off) | After (SF on) |');
    lines.push('|------|-------------------|---------------|');
    lines.push(`| Вердикт | ${b.overallVerdict} (${b.overallVerdictLabelRu}) | ${a.overallVerdict} (${a.overallVerdictLabelRu}) |`);
    lines.push(`| Spatial tier | ${(b.spatial as Record<string, unknown>).spatialTier} enabled=${(b.spatial as Record<string, unknown>).enabled} | ${(a.spatial as Record<string, unknown>).spatialTier} enabled=${(a.spatial as Record<string, unknown>).enabled} |`);
    lines.push(`| barrier_penalty | ${(b.spatial as Record<string, unknown>).barrierPenaltyApplied} (${(b.spatial as Record<string, unknown>).penalizedMagnetCount} magnets) | ${(a.spatial as Record<string, unknown>).barrierPenaltyApplied} (${(a.spatial as Record<string, unknown>).penalizedMagnetCount}) |`);
    lines.push(`| Barriers (report‑style) | ${(b.barriers as string[]).join('; ') || '—'} | ${(a.barriers as string[]).join('; ') || '—'} |`);
    lines.push('');
    lines.push('**Format fit (limiting factors — только если отличаются):**');
    lines.push('');
    const eb = b.entries as Array<Record<string, unknown>>;
    const ea = a.entries as Array<Record<string, unknown>>;
    for (let i = 0; i < eb.length; i++) {
      const fmt = eb[i].format as string;
      const lb = (eb[i].limitingFactors as string[]).join(' | ');
      const la = (ea[i].limitingFactors as string[]).join(' | ');
      const fb = eb[i].fitLevel;
      const fa = ea[i].fitLevel;
      if (fb === fa && lb === la) continue;
      lines.push(`- **${fmt}** ${fb} → ${fa}`);
      if (lb !== la) {
        lines.push(`  - limiting before: ${lb || '—'}`);
        lines.push(`  - limiting after: ${la || '—'}`);
      }
    }
    const anyDiff = eb.some((e, i) => e.fitLevel !== ea[i].fitLevel || (e.limitingFactors as string[]).join('¦') !== (ea[i].limitingFactors as string[]).join('¦'));
    if (!anyDiff) lines.push('_Нет отличий в fit level / limiting между before и after._');
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## 4. Выводы (кратко)');
  lines.push('');
  for (const ln of executiveLines) lines.push(ln);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const rows: unknown[] = [];
  const abRows: unknown[] = [];
  const outPath = join(process.cwd(), 'scripts', 'commercial-format-fit-validation-results.json');
  const abPath = join(process.cwd(), 'scripts', 'commercial-spatial-foundation-v1-ab.json');
  const mdPath = join(process.cwd(), 'docs', 'spatial-foundation-v1-validation.md');

  console.log(`Running ${CASES.length} cases (A/B per case)…\n`);

  for (const c of CASES) {
    process.stdout.write(`[${c.id}] ${c.label} … `);
    try {
      const { elements } = await withTimeout(
        fetchOsmData(c.lat, c.lon),
        120_000,
        c.id,
      );
      const analysisOff = buildAnalysis(elements, c.lat, c.lon, { spatialFoundation: false });
      const analysisOn = buildAnalysis(elements, c.lat, c.lon, { spatialFoundation: true });
      const formatFitOff = buildCommercialFormatFit(analysisOff);
      const formatFitOn = buildCommercialFormatFit(analysisOn);
      const snapOff = commercialSnap(analysisOff, formatFitOff);
      const snapOn = commercialSnap(analysisOn, formatFitOn);

      const fitMap = snapOn.fitMap;

      const discrepancies = humanDiscrepancies(c, fitMap);

      const abClass = classifyAb(c, snapOff, snapOn);
      const critOff = humanDiscrepancies(c, snapOff.fitMap).filter(d => d.severity === 'critical').length;
      const critOn = humanDiscrepancies(c, snapOn.fitMap).filter(d => d.severity === 'critical').length;
      const abRationale = `verdict ${snapOff.overallVerdict}→${snapOn.overallVerdict}; primary(${c.primaryType}) ${snapOff.fitMap[c.primaryType]}→${snapOn.fitMap[c.primaryType]}; human critical ${critOff}→${critOn}; spatial penalty ${snapOff.spatial.barrierPenaltyApplied}→${snapOn.spatial.barrierPenaltyApplied}`;

      rows.push({
        id: c.id,
        label: c.label,
        city: c.city,
        lat: c.lat,
        lon: c.lon,
        bucket: c.bucket,
        primaryType: c.primaryType,
        humanRationale: c.humanRationale,
        humanExpected: c.humanExpected,
        elementCount: elements.length,
        spatialFoundation: snapOn.spatial,
        analysis: {
          evergreenIndex: analysisOn.evergreenIndex,
          scoreBand: analysisOn.scoreBand,
          demandType: analysisOn.demandType,
          transitShare: analysisOn.footTraffic.transitVsTarget.transitShare,
          localActiveShare: analysisOn.footTraffic.transitVsTarget.localActiveShare,
          destinationShare: analysisOn.footTraffic.transitVsTarget.destinationShare,
          movementDensity: analysisOn.footTraffic.movementDensity,
          modifierTier: analysisOn.footTraffic.modifierTier,
          flowCharacter: analysisOn.footTraffic.flowCharacter,
          clusterDetected: analysisOn.gravityExplanation.clusterDetected,
          competitorPressure: analysisOn.gravityExplanation.competitorPressureLevel,
          magnets: analysisOn.magnets.map(m => ({ category: m.categoryId, name: m.name, distance: Math.round(m.distance) })),
          industrial01: analysisOn.neighborhoodEnvironment.breakdown.industrial01 ?? 0,
          majorRoads01: analysisOn.neighborhoodEnvironment.breakdown.majorRoads01 ?? 0,
        },
        formatFit: {
          overallVerdict: formatFitOn.overallVerdict,
          overallVerdictLabelRu: formatFitOn.overallVerdictLabelRu,
          entries: formatFitOn.entries.map(e => ({
            format: e.format,
            fitLevel: e.fitLevel,
            explanationRu: e.explanationRu,
            supportingFactors: e.supportingFactorsRu,
            limitingFactors: e.limitingFactorsRu,
          })),
        },
        fitMap,
        discrepancies,
        discrepancyCount: discrepancies.length,
        criticalCount: discrepancies.filter(d => d.severity === 'critical').length,
        error: null,
      });

      abRows.push({
        id: c.id,
        label: c.label,
        city: c.city,
        bucket: c.bucket,
        primaryType: c.primaryType,
        humanExpected: c.humanExpected,
        elementCount: elements.length,
        before: snapOff,
        after: snapOn,
        abClass,
        abRationale,
        error: null,
      });

      const disc = discrepancies.length > 0
        ? ` ⚠ ${discrepancies.length} diffs (${discrepancies.filter(d => d.severity === 'critical').length} critical)`
        : ' ✓';
      console.log(`ev=${analysisOn.evergreenIndex} verdict=${formatFitOn.overallVerdict} [AB:${abClass}]${disc}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({ id: c.id, label: c.label, error: msg });
      abRows.push({ id: c.id, label: c.label, error: msg });
      console.log(`ERROR: ${msg}`);
    }

    writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
    writeFileSync(abPath, JSON.stringify(abRows, null, 2), 'utf8');
    await sleep(1500);
  }

  const improved = abRows
    .filter(r => (r as Record<string, unknown>).abClass === 'improved')
    .map(r => (r as Record<string, unknown>).id as string);
  const noEffect = abRows
    .filter(r => (r as Record<string, unknown>).abClass === 'no_effect')
    .map(r => (r as Record<string, unknown>).id as string);
  const regressions = abRows
    .filter(r => (r as Record<string, unknown>).abClass === 'regression')
    .map(r => (r as Record<string, unknown>).id as string);
  const mixed = abRows
    .filter(r => (r as Record<string, unknown>).abClass === 'mixed')
    .map(r => (r as Record<string, unknown>).id as string);

  const scored = abRows
    .filter(r => !(r as Record<string, unknown>).error)
    .map(r => {
      const row = r as Record<string, unknown>;
      const caseObj = CASES.find(x => x.id === row.id)!;
      const before = row.before as ReturnType<typeof commercialSnap>;
      const after = row.after as ReturnType<typeof commercialSnap>;
      const gain = abScore(caseObj, after) - abScore(caseObj, before);
      return {
        id: row.id as string,
        label: row.label as string,
        gain,
        delta: (row.abRationale as string) ?? '',
      };
    })
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 5);

  const nReg = regressions.length;
  const fetchOk = abRows.filter(r => !(r as Record<string, unknown>).error).length;
  let fitMapChanged = 0;
  for (const raw of abRows) {
    const r = raw as Record<string, unknown>;
    if (r.error) continue;
    const b = r.before as Record<string, unknown>;
    const a = r.after as Record<string, unknown>;
    if (JSON.stringify(b.fitMap) !== JSON.stringify(a.fitMap)) fitMapChanged++;
  }
  const productJump =
    fitMapChanged >= 3 && nReg === 0
      ? 'Да: в нескольких кейсах spatial v1 меняет сами уровни format‑fit в сторону human‑разметки, без регрессий по вердикту.'
    : fitMapChanged >= 1
      ? 'Скорее нет как «скачок продукта»: изменения **fitMap** точечные; основной эффект v1 — barrier/corridor в магнитах + дисклеймеры в limiting factors (stub tier).'
    : 'Нет: при включённом spatial слой не сдвинул уровни format‑fit (только тексты/объяснения), см. секцию 0.';

  const executiveLines = [
    `- **Product jump?** ${productJump}`,
    `- **Кейсы с реальным изменением fitMap (уровни форматов):** см. JSON diff \`before.fitMap\` vs \`after.fitMap\` — в этом прогоне таких **${fitMapChanged}** из **${fetchOk}** успешных.`,
    `- **Главный spatial gap до Phase 2:** tier остаётся \`stub\` — нет графа улиц / провайдера маршрутов; barrier/corridor — прокси по OSM, без реальной walkability, входных групп, пересадок «дверь‑в‑дверь».`,
    `- **Sellable commercial V1:** v1 приближает продукт к «честному объяснению риска доступа», но не заменяет тюнинг format‑fit по туризму/destination/transit. Для sellable V1 нужны стабильные данные + Phase 2 geometry.`,
  ];

  const md = buildMarkdownReport({
    abRows,
    improved,
    noEffect,
    regressions,
    mixed,
    topImproved: scored.map(s => ({ id: s.id, label: s.label, delta: `gain=${s.gain.toFixed(1)}; ${s.delta}` })),
    executiveLines,
  });
  writeFileSync(mdPath, md, 'utf8');

  console.log(`\nWrote ${outPath}`);
  console.log(`Wrote ${abPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
