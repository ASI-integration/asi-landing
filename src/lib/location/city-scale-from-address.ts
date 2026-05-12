/**
 * Canonical, deterministic RU city scale inference used by the demand/scoring kernel.
 *
 * Important:
 * - No live population data (static metadata only).
 * - Longest-match static table over normalized address (fixture city names).
 */

import type { RuMarketContextKernelSlice } from './canon/ru-market-context';
import { buildRuMarketContextKernelSlice, resolveRuMarketContextFromRuAddress } from './canon/ru-market-context';

export type CityScale =
  | 'federal_mega'
  | 'mega_city'
  | 'million_plus'
  | 'large_regional'
  | 'medium_city'
  | 'small_city'
  | 'micro_city'
  | 'settlement'
  | 'unknown';

export type PopulationTier = '5m+' | '1m-5m' | '500k-1m' | '100k-500k' | '30k-100k' | '<30k' | 'unknown';

export type SpecialMarketFlag =
  | 'resort_exception'
  | 'federal_tourist_anchor'
  | 'major_industrial_employer'
  | 'large_transport_hub'
  | 'port_or_logistics_gateway'
  | 'university_town'
  | 'shift_worker_demand'
  | 'regional_medical_cluster';

export interface CityScaleInference {
  readonly cityScale: CityScale;
  readonly populationTier: PopulationTier;
  readonly marketGravityCoefficient: number;
  readonly specialMarketFlags: readonly SpecialMarketFlag[];
  /** Approximate population when known from static table; null if unknown */
  readonly populationApprox: number | null;
  /** Human-readable provenance for diagnostics */
  readonly inferredFrom: string;
  /** Conservative hardcoded metadata (static table only). */
  readonly cityName?: string;
  readonly region?: string;
  /**
   * When set, address matched canonical RU market-context (e.g. satellite commuter suburb).
   * Prevents inheriting mega-city gravity from a co-mentioned macro city in the same string.
   */
  readonly ruMarketContext?: RuMarketContextKernelSlice;
}

export type { RuMarketContextKernelSlice } from './canon/ru-market-context';

function normAddr(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsCityToken(normalizedAddress: string, needle: string): boolean {
  const escaped = escapeRegExp(needle);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalizedAddress);
}

export function marketGravityCoefficientFromCityScale(cityScale: CityScale): number {
  const MARKET_GRAVITY: Readonly<Record<CityScale, number>> = {
    federal_mega: 1.35,
    mega_city: 1.25,
    million_plus: 1.15,
    large_regional: 0.95,
    medium_city: 0.85,
    small_city: 0.7,
    micro_city: 0.5,
    settlement: 0.35,
    unknown: 0.72,
  };
  return MARKET_GRAVITY[cityScale] ?? MARKET_GRAVITY.unknown;
}

type Row = {
  needle: string;
  cityScale: CityScale;
  populationTier: PopulationTier;
  populationApprox: number | null;
  cityName: string;
  region: string;
  specialMarketFlags?: readonly SpecialMarketFlag[];
};

/**
 * Deterministic metadata for cities present in golden / validation fixtures.
 * Add new rows here (no external APIs).
 */
const TABLE: ReadonlyArray<Row> = [
  // Federal / mega
  {
    needle: 'москва',
    cityScale: 'federal_mega',
    populationTier: '5m+',
    populationApprox: 12_500_000,
    cityName: 'Москва',
    region: 'Москва',
    specialMarketFlags: ['large_transport_hub'],
  },
  {
    needle: 'санкт-петербург',
    cityScale: 'mega_city',
    populationTier: '5m+',
    populationApprox: 5_400_000,
    cityName: 'Санкт‑Петербург',
    region: 'Санкт‑Петербург',
    specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'],
  },
  {
    needle: 'санкт петербург',
    cityScale: 'mega_city',
    populationTier: '5m+',
    populationApprox: 5_400_000,
    cityName: 'Санкт‑Петербург',
    region: 'Санкт‑Петербург',
    specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'],
  },
  { needle: 'спб', cityScale: 'mega_city', populationTier: '5m+', populationApprox: 5_400_000, cityName: 'Санкт‑Петербург', region: 'Санкт‑Петербург', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },

  // Million-plus
  { needle: 'нижний новгород', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_250_000, cityName: 'Нижний Новгород', region: 'Нижегородская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'казань', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_250_000, cityName: 'Казань', region: 'Республика Татарстан', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'екатеринбург', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_500_000, cityName: 'Екатеринбург', region: 'Свердловская область' },
  { needle: 'новосибирск', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_630_000, cityName: 'Новосибирск', region: 'Новосибирская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'красноярск', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_090_000, cityName: 'Красноярск', region: 'Красноярский край', specialMarketFlags: ['large_transport_hub', 'port_or_logistics_gateway'] },
  { needle: 'самара', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_160_000, cityName: 'Самара', region: 'Самарская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'уфа', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_140_000, cityName: 'Уфа', region: 'Республика Башкортостан', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'пермь', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_030_000, cityName: 'Пермь', region: 'Пермский край', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'воронеж', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_050_000, cityName: 'Воронеж', region: 'Воронежская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'волгоград', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_020_000, cityName: 'Волгоград', region: 'Волгоградская область', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'омск', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_110_000, cityName: 'Омск', region: 'Омская область', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'краснодар', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_100_000, cityName: 'Краснодар', region: 'Краснодарский край', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'ростов-на-дону', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_150_000, cityName: 'Ростов-на-Дону', region: 'Ростовская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'ростов', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_150_000, cityName: 'Ростов-на-Дону', region: 'Ростовская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },

  // Large regional (500k–1m)
  { needle: 'кемерово', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 550_000, cityName: 'Кемерово', region: 'Кемеровская область', specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand', 'regional_medical_cluster'] },
  { needle: 'севастополь', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 520_000, cityName: 'Севастополь', region: 'Севастополь', specialMarketFlags: ['resort_exception', 'port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'саратов', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 900_000, cityName: 'Саратов', region: 'Саратовская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'калининград', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 490_000, cityName: 'Калининград', region: 'Калининградская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub', 'university_town'] },
  { needle: 'хабаровск', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 610_000, cityName: 'Хабаровск', region: 'Хабаровский край', specialMarketFlags: ['large_transport_hub', 'port_or_logistics_gateway'] },
  { needle: 'иркутск', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 620_000, cityName: 'Иркутск', region: 'Иркутская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'ярославль', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 570_000, cityName: 'Ярославль', region: 'Ярославская область', specialMarketFlags: ['large_transport_hub', 'university_town'] },
  { needle: 'тольятти', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 670_000, cityName: 'Тольятти', region: 'Самарская область', specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'] },
  { needle: 'набережные челны', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 550_000, cityName: 'Набережные Челны', region: 'Республика Татарстан', specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'] },
  { needle: 'тула', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 470_000, cityName: 'Тула', region: 'Тульская область', specialMarketFlags: ['large_transport_hub', 'major_industrial_employer'] },
  { needle: 'рязань', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 530_000, cityName: 'Рязань', region: 'Рязанская область', specialMarketFlags: ['large_transport_hub'] },
  {
    needle: 'владивосток',
    cityScale: 'large_regional',
    populationTier: '500k-1m',
    populationApprox: 600_000,
    cityName: 'Владивосток',
    region: 'Приморский край',
    specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'],
  },
  {
    needle: 'ставрополь',
    cityScale: 'large_regional',
    populationTier: '500k-1m',
    populationApprox: 450_000,
    cityName: 'Ставрополь',
    region: 'Ставропольский край',
    specialMarketFlags: ['regional_medical_cluster'],
  },

  // Medium city (100k–500k)
  { needle: 'сочи', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 430_000, cityName: 'Сочи', region: 'Краснодарский край', specialMarketFlags: ['resort_exception', 'federal_tourist_anchor', 'large_transport_hub'] },
  { needle: 'анапа', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 80_000, cityName: 'Анапа', region: 'Краснодарский край', specialMarketFlags: ['resort_exception', 'federal_tourist_anchor'] },
  { needle: 'саранск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 318_000, cityName: 'Саранск', region: 'Республика Мордовия', specialMarketFlags: ['university_town'] },
  { needle: 'тверь', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 420_000, cityName: 'Тверь', region: 'Тверская область', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'калуга', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 340_000, cityName: 'Калуга', region: 'Калужская область', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'рыбинск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 180_000, cityName: 'Рыбинск', region: 'Ярославская область' },
  { needle: 'муром', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 110_000, cityName: 'Муром', region: 'Владимирская область' },
  { needle: 'елец', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 100_000, cityName: 'Елец', region: 'Липецкая область' },
  { needle: 'геленджик', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 75_000, cityName: 'Геленджик', region: 'Краснодарский край', specialMarketFlags: ['resort_exception', 'federal_tourist_anchor'] },
  { needle: 'кисловодск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 130_000, cityName: 'Кисловодск', region: 'Ставропольский край', specialMarketFlags: ['resort_exception', 'federal_tourist_anchor'] },
  { needle: 'пятигорск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 150_000, cityName: 'Пятигорск', region: 'Ставропольский край', specialMarketFlags: ['resort_exception', 'large_transport_hub'] },
  { needle: 'череповец', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 300_000, cityName: 'Череповец', region: 'Вологодская область', specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'] },
  { needle: 'новороссийск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 300_000, cityName: 'Новороссийск', region: 'Краснодарский край', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'астрахань', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 470_000, cityName: 'Астрахань', region: 'Астраханская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'архангельск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 300_000, cityName: 'Архангельск', region: 'Архангельская область', specialMarketFlags: ['port_or_logistics_gateway'] },
  { needle: 'мурманск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 270_000, cityName: 'Мурманск', region: 'Мурманская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'улан-удэ', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 440_000, cityName: 'Улан-Удэ', region: 'Республика Бурятия', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'улан удэ', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 440_000, cityName: 'Улан-Удэ', region: 'Республика Бурятия', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'якутск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 350_000, cityName: 'Якутск', region: 'Республика Саха (Якутия)', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'петропавловск-камчатский', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 160_000, cityName: 'Петропавловск-Камчатский', region: 'Камчатский край', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'петропавловск камчатский', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 160_000, cityName: 'Петропавловск-Камчатский', region: 'Камчатский край', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'реутов', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 110_000, cityName: 'Реутов', region: 'Московская область' },
  { needle: 'мытищи', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 260_000, cityName: 'Мытищи', region: 'Московская область' },
  { needle: 'химки', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 260_000, cityName: 'Химки', region: 'Московская область', specialMarketFlags: ['large_transport_hub'] },
  { needle: 'балашиха', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 520_000, cityName: 'Балашиха', region: 'Московская область' },
  { needle: 'прокопьевск', cityScale: 'medium_city', populationTier: '100k-500k', populationApprox: 200_000, cityName: 'Прокопьевск', region: 'Кемеровская область', specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'] },
  {
    needle: 'норильск',
    cityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 180_000,
    cityName: 'Норильск',
    region: 'Красноярский край',
    specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'],
  },

  // Small city (30k–100k)
  { needle: 'ялта', cityScale: 'small_city', populationTier: '30k-100k', populationApprox: 82_000, cityName: 'Ялта', region: 'Крым', specialMarketFlags: ['resort_exception', 'federal_tourist_anchor'] },
  { needle: 'торжок', cityScale: 'small_city', populationTier: '30k-100k', populationApprox: 45_000, cityName: 'Торжок', region: 'Тверская область' },
  { needle: 'кинешма', cityScale: 'small_city', populationTier: '30k-100k', populationApprox: 80_000, cityName: 'Кинешма', region: 'Ивановская область' },
  { needle: 'светлогорск', cityScale: 'small_city', populationTier: '30k-100k', populationApprox: 17_000, cityName: 'Светлогорск', region: 'Калининградская область', specialMarketFlags: ['resort_exception'] },

  // Micro / settlement (<30k)
  { needle: 'лодейное поле', cityScale: 'micro_city', populationTier: '<30k', populationApprox: 21_000, cityName: 'Лодейное Поле', region: 'Ленинградская область' },
];

/**
 * Longest-match static table over normalized address (Cyrillic city names in fixtures).
 */
export function inferCityScaleFromRuAddress(addressRu: string): CityScaleInference {
  const n = normAddr(addressRu);
  if (!n || n === 'fixture') {
    return {
      cityScale: 'unknown',
      populationTier: 'unknown',
      populationApprox: null,
      marketGravityCoefficient: marketGravityCoefficientFromCityScale('unknown'),
      specialMarketFlags: [],
      inferredFrom: 'no_city_token',
    };
  }

  const marketResolution = resolveRuMarketContextFromRuAddress(addressRu);
  if (marketResolution) {
    const e = marketResolution.entry;
    return {
      cityScale: e.kernelCityScale as CityScale,
      populationTier: e.populationTier as PopulationTier,
      populationApprox: e.populationApprox,
      marketGravityCoefficient: marketGravityCoefficientFromCityScale(e.kernelCityScale as CityScale),
      specialMarketFlags: [...e.specialMarketFlags] as SpecialMarketFlag[],
      inferredFrom: `ru_market_context:${e.normalizedName}|alias=${marketResolution.matchedAlias}`,
      cityName: e.normalizedName,
      region: e.regionHint,
      ruMarketContext: buildRuMarketContextKernelSlice(marketResolution),
    };
  }

  let best: Row | null = null;
  for (const row of TABLE) {
    if (!containsCityToken(n, row.needle)) continue;
    if (!best || row.needle.length > best.needle.length) best = row;
  }

  if (!best) {
    return {
      cityScale: 'unknown',
      populationTier: 'unknown',
      populationApprox: null,
      marketGravityCoefficient: marketGravityCoefficientFromCityScale('unknown'),
      specialMarketFlags: [],
      inferredFrom: 'no_match',
    };
  }

  return {
    cityScale: best.cityScale,
    populationTier: best.populationTier,
    populationApprox: best.populationApprox,
    marketGravityCoefficient: marketGravityCoefficientFromCityScale(best.cityScale),
    specialMarketFlags: best.specialMarketFlags ?? [],
    inferredFrom: `static_table:${best.needle}`,
    cityName: best.cityName,
    region: best.region,
  };
}

/** Strip static-table macro when geocoder coordinates disagree with typed city. */
export function cityScaleInferenceAfterGeocodeMismatch(base: CityScaleInference): CityScaleInference {
  return {
    cityScale: 'unknown',
    populationTier: 'unknown',
    populationApprox: null,
    marketGravityCoefficient: marketGravityCoefficientFromCityScale('unknown'),
    specialMarketFlags: [],
    inferredFrom: `${base.inferredFrom}|geocode_city_mismatch`,
    // Drop settlement market-context when typed city disagrees with geocoder — macro layer unreliable.
  };
}
