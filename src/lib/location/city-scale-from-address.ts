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
  { needle: 'ростов-на-дону', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_150_000, cityName: 'Ростов-на-Дону', region: 'Ростовская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },
  { needle: 'ростов', cityScale: 'million_plus', populationTier: '1m-5m', populationApprox: 1_150_000, cityName: 'Ростов-на-Дону', region: 'Ростовская область', specialMarketFlags: ['port_or_logistics_gateway', 'large_transport_hub'] },

  // Large regional (500k–1m)
  { needle: 'кемерово', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 550_000, cityName: 'Кемерово', region: 'Кемеровская область', specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand', 'regional_medical_cluster'] },
  { needle: 'севастополь', cityScale: 'large_regional', populationTier: '500k-1m', populationApprox: 520_000, cityName: 'Севастополь', region: 'Севастополь', specialMarketFlags: ['resort_exception', 'port_or_logistics_gateway', 'large_transport_hub'] },
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
    if (!n.includes(row.needle)) continue;
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
