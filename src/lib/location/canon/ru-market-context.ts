/**
 * Canonical RU market-context / settlement-type layer (static, deterministic).
 * Resolves satellite commuter suburbs and similar settlements so they do not
 * inherit federal/mega city gravity from a co-mentioned macro city in the same address string.
 *
 * Intentionally does not import `./city-scale-from-address` to avoid a circular module graph.
 */

export type RuMarketType =
  | 'satellite_commuter_suburb'
  | 'exurb_settlement'
  | 'remote_industrial_city'
  | 'mono_industrial_city';

export type RuMarketKernelCityScale = 'medium_city';

export type RuMarketPopulationTier = '100k-500k' | '30k-100k';

export type RuMarketSpecialFlag =
  | 'resort_exception'
  | 'federal_tourist_anchor'
  | 'major_industrial_employer'
  | 'large_transport_hub'
  | 'port_or_logistics_gateway'
  | 'university_town'
  | 'shift_worker_demand'
  | 'regional_medical_cluster';

export interface RuMarketContextCapOverrideRule {
  readonly id: string;
  /** Minimum count of verified-major demand anchors (tier-1, or tier-2 + verified_major scale). */
  readonly minVerifiedMajorAnchors: number;
  readonly scoreCap: number;
}

export interface RuMarketContextEntry {
  readonly normalizedName: string;
  /** Cyrillic / Latin tokens matched with longest-wins over the normalized address. */
  readonly aliases: readonly string[];
  /** City-scale used only for kernel gravity / tier heuristics — not inherited from co-mentioned mega city. */
  readonly kernelCityScale: RuMarketKernelCityScale;
  readonly populationTier: RuMarketPopulationTier;
  readonly populationApprox: number | null;
  readonly marketType: RuMarketType;
  readonly specialMarketFlags: readonly RuMarketSpecialFlag[];
  /** Baseline public headline cap without verified major anchors (metro/retail/dense housing alone). */
  readonly defaultScoreCap: number;
  /** Ordered ascending by minVerifiedMajorAnchors; last rule wins on ties. */
  readonly capOverrideRules: readonly RuMarketContextCapOverrideRule[];
  /** Optional human hint for diagnostics (not matched). */
  readonly regionHint?: string;
}

export interface RuMarketContextResolution {
  readonly entry: RuMarketContextEntry;
  /** Alias string as matched (original casing from table). */
  readonly matchedAlias: string;
}

/** Kernel attaches this slice to {@link CityScaleInference}. */
export interface RuMarketContextKernelSlice {
  readonly normalizedName: string;
  readonly marketType: RuMarketType;
  readonly matchedToken: string;
  readonly baselineScoreCap: number;
  readonly scoreCapSingleMajor: number;
  readonly scoreCapMultiMajor: number;
  readonly liftMultiMajorMinCount: number;
}

function normAddr(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normAlias(a: string): string {
  return normAddr(a);
}

const SATELLITE_DEFAULT_RULES: readonly RuMarketContextCapOverrideRule[] = [
  { id: 'single_verified_major_anchor', minVerifiedMajorAnchors: 1, scoreCap: 88 },
  { id: 'multiple_verified_major_anchors', minVerifiedMajorAnchors: 2, scoreCap: 96 },
];

const REMOTE_INDUSTRIAL_DEFAULT_RULES: readonly RuMarketContextCapOverrideRule[] = [
  { id: 'single_verified_major_anchor', minVerifiedMajorAnchors: 1, scoreCap: 82 },
  { id: 'multiple_verified_major_anchors', minVerifiedMajorAnchors: 2, scoreCap: 86 },
];

const MONO_INDUSTRIAL_DEFAULT_RULES: readonly RuMarketContextCapOverrideRule[] = [
  { id: 'single_verified_major_anchor', minVerifiedMajorAnchors: 1, scoreCap: 84 },
  { id: 'multiple_verified_major_anchors', minVerifiedMajorAnchors: 2, scoreCap: 88 },
];

/**
 * Static satellite / near-metro commuter settlements (Leningrad Oblast belt and analogues).
 * Policy: metro + generic retail + dense housing cannot exceed defaultScoreCap without verified majors.
 */
export const RU_MARKET_CONTEXT_ENTRIES: readonly RuMarketContextEntry[] = [
  {
    normalizedName: 'Норильск',
    aliases: ['норильск', 'norilsk'],
    kernelCityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 180_000,
    marketType: 'remote_industrial_city',
    specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'],
    defaultScoreCap: 76,
    capOverrideRules: REMOTE_INDUSTRIAL_DEFAULT_RULES,
    regionHint: 'Красноярский край',
  },
  {
    normalizedName: 'Магнитогорск',
    aliases: ['магнитогорск', 'magnitogorsk'],
    kernelCityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 410_000,
    marketType: 'mono_industrial_city',
    specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'],
    defaultScoreCap: 78,
    capOverrideRules: MONO_INDUSTRIAL_DEFAULT_RULES,
    regionHint: 'Челябинская область',
  },
  {
    normalizedName: 'Нижний Тагил',
    aliases: ['нижний тагил', 'ntagil'],
    kernelCityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 340_000,
    marketType: 'mono_industrial_city',
    specialMarketFlags: ['major_industrial_employer', 'shift_worker_demand'],
    defaultScoreCap: 78,
    capOverrideRules: MONO_INDUSTRIAL_DEFAULT_RULES,
    regionHint: 'Свердловская область',
  },
  {
    normalizedName: 'Мурино',
    aliases: ['мурино', 'murino'],
    kernelCityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 110_000,
    marketType: 'satellite_commuter_suburb',
    specialMarketFlags: [],
    defaultScoreCap: 75,
    capOverrideRules: SATELLITE_DEFAULT_RULES,
    regionHint: 'Ленинградская область',
  },
  {
    normalizedName: 'Девяткино',
    aliases: ['девяткино', 'devyatkino'],
    kernelCityScale: 'medium_city',
    populationTier: '30k-100k',
    populationApprox: 28_000,
    marketType: 'satellite_commuter_suburb',
    specialMarketFlags: [],
    defaultScoreCap: 75,
    capOverrideRules: SATELLITE_DEFAULT_RULES,
    regionHint: 'Ленинградская область',
  },
  {
    normalizedName: 'Новое Девяткино',
    aliases: ['новое девяткино', 'novoye devyatkino', 'novoe devyatkino'],
    kernelCityScale: 'medium_city',
    populationTier: '30k-100k',
    populationApprox: 35_000,
    marketType: 'satellite_commuter_suburb',
    specialMarketFlags: [],
    defaultScoreCap: 75,
    capOverrideRules: SATELLITE_DEFAULT_RULES,
    regionHint: 'Ленинградская область',
  },
  {
    normalizedName: 'Кудрово',
    aliases: ['кудрово', 'kudrovo'],
    kernelCityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 75_000,
    marketType: 'satellite_commuter_suburb',
    specialMarketFlags: [],
    defaultScoreCap: 75,
    capOverrideRules: SATELLITE_DEFAULT_RULES,
    regionHint: 'Ленинградская область',
  },
  {
    normalizedName: 'Шушары',
    aliases: ['шушары', 'shushary'],
    kernelCityScale: 'medium_city',
    populationTier: '100k-500k',
    populationApprox: 140_000,
    marketType: 'satellite_commuter_suburb',
    specialMarketFlags: [],
    defaultScoreCap: 75,
    capOverrideRules: SATELLITE_DEFAULT_RULES,
    regionHint: 'Санкт-Петербург / Ленинградская область',
  },
  {
    normalizedName: 'Парнас',
    aliases: ['парнас', 'parnas'],
    kernelCityScale: 'medium_city',
    populationTier: '30k-100k',
    populationApprox: 20_000,
    marketType: 'satellite_commuter_suburb',
    specialMarketFlags: [],
    defaultScoreCap: 75,
    capOverrideRules: SATELLITE_DEFAULT_RULES,
    regionHint: 'Санкт-Петербург (северная зона)',
  },
];

export function resolveRuMarketContextFromRuAddress(addressRu: string): RuMarketContextResolution | null {
  const n = normAddr(addressRu);
  if (!n || n === 'fixture') return null;

  let best: { needleLen: number; entry: RuMarketContextEntry; matchedAlias: string } | null = null;

  for (const entry of RU_MARKET_CONTEXT_ENTRIES) {
    for (const alias of entry.aliases) {
      const needle = normAlias(alias);
      if (!needle || !n.includes(needle)) continue;
      if (!best || needle.length > best.needleLen) {
        best = { needleLen: needle.length, entry, matchedAlias: alias };
      }
    }
  }

  return best ? { entry: best.entry, matchedAlias: best.matchedAlias } : null;
}

export function buildRuMarketContextKernelSlice(resolution: RuMarketContextResolution): RuMarketContextKernelSlice {
  const e = resolution.entry;
  const single = e.capOverrideRules.find(r => r.minVerifiedMajorAnchors === 1);
  const multi = e.capOverrideRules.find(r => r.minVerifiedMajorAnchors >= 2);
  return {
    normalizedName: e.normalizedName,
    marketType: e.marketType,
    matchedToken: resolution.matchedAlias,
    baselineScoreCap: e.defaultScoreCap,
    scoreCapSingleMajor: single?.scoreCap ?? 88,
    scoreCapMultiMajor: multi?.scoreCap ?? 96,
    liftMultiMajorMinCount: multi?.minVerifiedMajorAnchors ?? 2,
  };
}

/** Effective cap from market-context rules (verified-major anchor counts). */
export function marketContextEffectivePublicCap(
  slice: RuMarketContextKernelSlice,
  verifiedMajorAnchorCount: number,
): { cap: number; reasonKey: string } {
  if (verifiedMajorAnchorCount >= slice.liftMultiMajorMinCount) {
    return { cap: slice.scoreCapMultiMajor, reasonKey: 'multiple_verified_major_anchors' };
  }
  if (verifiedMajorAnchorCount >= 1) {
    return { cap: slice.scoreCapSingleMajor, reasonKey: 'single_verified_major_anchor' };
  }
  return { cap: slice.baselineScoreCap, reasonKey: 'satellite_commuter_baseline' };
}
