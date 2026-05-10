import type { AddressSearchProfile } from './address-search-profile';
import { pointInBBox } from './address-search-profile';
import { buildRuProviderQuery, hasExplicitRuCity, normalizeRuAddressQuery } from './ru-normalize';

function nf(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeStreetHouseQuery(normalizedQuery: string): boolean {
  const trimmed = normalizedQuery.trim();
  if (!trimmed) return false;
  const matchQ = nf(trimmed);
  if (!matchQ) return false;
  const tokens = new Set(matchQ.split(' ').filter(Boolean));
  if (tokens.has('переулок') || tokens.has('пер')) return true;
  if (tokens.has('улица') || tokens.has('ул')) return true;
  if (tokens.has('проспект') || tokens.has('пр')) return true;
  if (tokens.has('набережная') || tokens.has('наб')) return true;
  if (tokens.has('площадь') || tokens.has('пл')) return true;
  if (tokens.has('бульвар') || tokens.has('бул')) return true;
  if (tokens.has('шоссе') || tokens.has('ш')) return true;
  if (tokens.has('проезд')) return true;
  return /\d/u.test(matchQ);
}

export const RU_METRO_PROFILE_ORDER: readonly AddressSearchProfile[] = [
  {
    id: 'ru-spb-lo',
    country: 'RU',
    primaryCities: ['санкт петербург', 'петербург', 'спб', 'питер', 'ленинград'],
    regionNames: ['ленинградская область', 'ленинградская'],
    satelliteCities: ['мурино', 'девяткино', 'всеволожск', 'всеволожский', 'кудрово', 'шушары', 'лахта'],
    bbox: { minLat: 59.45, maxLat: 61.05, minLon: 27.85, maxLon: 34.05 },
    biasCenter: { lat: 59.93, lon: 30.33 },
    negativeRegions: ['краснодар', 'ставрополь', 'ростов на дону', 'белгород', 'старый оскол', 'воронеж'],
    queryExpansionTemplates: [
      'Мурино, {tail}',
      'Ленинградская область, Мурино, {tail}',
      'Санкт-Петербург, Ленинградская область, {tail}',
    ],
  },
  {
    id: 'ru-moscow-mo',
    country: 'RU',
    primaryCities: ['москва', 'мск'],
    regionNames: ['московская область', 'московская'],
    satelliteCities: ['химки', 'подольск', 'мытищи', 'люберцы', 'балашиха', 'одинцово', 'королев', 'долгопрудный'],
    bbox: { minLat: 54.82, maxLat: 56.45, minLon: 35.9, maxLon: 38.45 },
    biasCenter: { lat: 55.75, lon: 37.62 },
    negativeRegions: ['новосибирск', 'краснодар', 'екатеринбург', 'казань', 'самара'],
    queryExpansionTemplates: [
      'Химки, {tail}',
      'Московская область, Химки, {tail}',
      'Москва, Московская область, {tail}',
    ],
  },
  {
    id: 'ru-krasnodar',
    country: 'RU',
    primaryCities: ['краснодар'],
    regionNames: ['краснодарский край', 'краснодарская'],
    satelliteCities: ['сочи', 'новороссийск', 'армавир', 'анапа', 'геленджик'],
    bbox: { minLat: 43.35, maxLat: 46.15, minLon: 36.85, maxLon: 41.35 },
    biasCenter: { lat: 45.04, lon: 38.98 },
    negativeRegions: ['санкт петербург', 'петербург', 'москва', 'новосибирск'],
    queryExpansionTemplates: [
      'Краснодар, {tail}',
      'Краснодарский край, Краснодар, {tail}',
      'Краснодар, Краснодарский край, {tail}',
    ],
  },
  {
    id: 'ru-tatarstan',
    country: 'RU',
    primaryCities: ['казань'],
    regionNames: ['татарстан', 'республика татарстан'],
    satelliteCities: ['набережные челны', 'альметьевск', 'нижнекамск'],
    bbox: { minLat: 53.95, maxLat: 56.35, minLon: 47.35, maxLon: 54.25 },
    biasCenter: { lat: 55.79, lon: 49.12 },
    negativeRegions: ['москва', 'новосибирск', 'краснодар'],
    queryExpansionTemplates: [
      'Казань, {tail}',
      'Республика Татарстан, Казань, {tail}',
      'Казань, Республика Татарстан, {tail}',
    ],
  },
  {
    id: 'ru-sverdlovsk',
    country: 'RU',
    primaryCities: ['екатеринбург'],
    regionNames: ['свердловская область', 'свердловская'],
    satelliteCities: ['нижний тагил', 'каменск уральский', 'первоуральск'],
    bbox: { minLat: 55.95, maxLat: 59.05, minLon: 57.85, maxLon: 66.25 },
    biasCenter: { lat: 56.84, lon: 60.61 },
    negativeRegions: ['москва', 'краснодар', 'новосибирск'],
    queryExpansionTemplates: [
      'Екатеринбург, {tail}',
      'Свердловская область, Екатеринбург, {tail}',
      'Екатеринбург, Свердловская область, {tail}',
    ],
  },
  {
    id: 'ru-novosibirsk',
    country: 'RU',
    primaryCities: ['новосибирск'],
    regionNames: ['новосибирская область', 'новосибирская'],
    satelliteCities: ['бердск', 'искитим'],
    bbox: { minLat: 53.95, maxLat: 56.05, minLon: 75.95, maxLon: 84.85 },
    biasCenter: { lat: 55.03, lon: 82.92 },
    negativeRegions: ['москва', 'санкт петербург', 'краснодар'],
    queryExpansionTemplates: [
      'Новосибирск, {tail}',
      'Новосибирская область, Новосибирск, {tail}',
      'Новосибирск, Новосибирская область, {tail}',
    ],
  },
  {
    id: 'ru-nizhny',
    country: 'RU',
    primaryCities: ['нижний новгород'],
    regionNames: ['нижегородская область', 'нижегородская'],
    satelliteCities: ['дзержинск', 'арзамас'],
    bbox: { minLat: 54.75, maxLat: 57.65, minLon: 41.95, maxLon: 47.05 },
    biasCenter: { lat: 56.33, lon: 44.0 },
    negativeRegions: ['москва', 'краснодар', 'новосибирск'],
    queryExpansionTemplates: [
      'Нижний Новгород, {tail}',
      'Нижегородская область, Нижний Новгород, {tail}',
      'Нижний Новгород, Нижегородская область, {tail}',
    ],
  },
  {
    id: 'ru-rostov',
    country: 'RU',
    primaryCities: ['ростов на дону'],
    regionNames: ['ростовская область', 'ростовская'],
    satelliteCities: ['таганрог', 'шахты', 'волгодонск'],
    bbox: { minLat: 46.35, maxLat: 50.55, minLon: 38.15, maxLon: 44.95 },
    biasCenter: { lat: 47.24, lon: 39.71 },
    negativeRegions: ['москва', 'санкт петербург', 'новосибирск'],
    queryExpansionTemplates: [
      'Ростов-на-Дону, {tail}',
      'Ростовская область, Ростов-на-Дону, {tail}',
      'Ростов-на-Дону, Ростовская область, {tail}',
    ],
  },
  {
    id: 'ru-samara',
    country: 'RU',
    primaryCities: ['самара'],
    regionNames: ['самарская область', 'самарская'],
    satelliteCities: ['тольятти', 'сызрань', 'новокуйбышевск'],
    bbox: { minLat: 52.05, maxLat: 54.95, minLon: 47.65, maxLon: 52.65 },
    biasCenter: { lat: 53.2, lon: 50.15 },
    negativeRegions: ['москва', 'краснодар', 'новосибирск'],
    queryExpansionTemplates: [
      'Самара, {tail}',
      'Самарская область, Самара, {tail}',
      'Самара, Самарская область, {tail}',
    ],
  },
  {
    id: 'ru-bashkortostan',
    country: 'RU',
    primaryCities: ['уфа'],
    regionNames: ['башкортостан', 'республика башкортостан'],
    satelliteCities: ['стерлитамак', 'салават', 'нефтекамск'],
    bbox: { minLat: 52.35, maxLat: 56.85, minLon: 53.55, maxLon: 60.35 },
    biasCenter: { lat: 54.74, lon: 55.97 },
    negativeRegions: ['москва', 'краснодар', 'новосибирск'],
    queryExpansionTemplates: [
      'Уфа, {tail}',
      'Республика Башкортостан, Уфа, {tail}',
      'Уфа, Республика Башкортостан, {tail}',
    ],
  },
];

const RU_PROFILE_BY_ID = new Map(RU_METRO_PROFILE_ORDER.map(p => [p.id, p]));

/** Geocode fallback chain uses full metro order when context is locked; otherwise a capped subset (latency). */
export const RU_GEOCODE_FALLBACK_PROFILE_IDS: readonly string[] = [
  'ru-spb-lo',
  'ru-moscow-mo',
  'ru-krasnodar',
  'ru-tatarstan',
  'ru-sverdlovsk',
  'ru-novosibirsk',
  'ru-nizhny',
  'ru-rostov',
  'ru-samara',
  'ru-bashkortostan',
];

export interface RuAddressSearchResolution {
  profiles: AddressSearchProfile[];
  /** True when query / session city / viewport locked at least one profile (not nationwide fallback). */
  contextLocked: boolean;
}

function dedupeProfiles(rows: AddressSearchProfile[]): AddressSearchProfile[] {
  const seen = new Set<string>();
  const out: AddressSearchProfile[] = [];
  for (const p of rows) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function profileHintsQuery(normalizedQueryNorm: string, p: AddressSearchProfile): boolean {
  const tokens = [...p.primaryCities, ...p.regionNames, ...p.satelliteCities];
  const words = normalizedQueryNorm.split(' ').filter(Boolean);
  return tokens.some(t => {
    if (!t || t.length < 2) return false;
    if (t.includes(' ')) {
      return normalizedQueryNorm.includes(t);
    }
    if (t.length <= 4) {
      return words.some(w => w === t || w.startsWith(`${t}.`));
    }
    const idx = normalizedQueryNorm.indexOf(t);
    if (idx === -1) return false;
    const after = normalizedQueryNorm[idx + t.length];
    return !after || !/[а-яёa-z]/iu.test(after);
  });
}

function profileMatchesCityHint(cityNorm: string, p: AddressSearchProfile): boolean {
  const tokens = [...p.primaryCities, ...p.regionNames, ...p.satelliteCities];
  return tokens.some(t => cityNorm.includes(t) || (t.length >= 4 && cityNorm.length >= 4 && t.includes(cityNorm)));
}

/**
 * Pick metro profiles from explicit query text, session/viewport hint, or fall back to all metros for expansions.
 */
export function resolveRuAddressSearchProfiles(input: {
  normalizedQuery: string;
  contextCity?: string | null;
  biasLat?: number | null;
  biasLon?: number | null;
}): RuAddressSearchResolution {
  const qn = nf(input.normalizedQuery);

  const explicitHits = RU_METRO_PROFILE_ORDER.filter(p => profileHintsQuery(qn, p));
  if (explicitHits.length === 1) {
    return { profiles: explicitHits, contextLocked: true };
  }
  if (explicitHits.length > 1) {
    return { profiles: dedupeProfiles(explicitHits), contextLocked: true };
  }

  const fromHint: AddressSearchProfile[] = [];
  const city = (input.contextCity ?? '').trim();
  if (city) {
    const cn = nf(city);
    for (const p of RU_METRO_PROFILE_ORDER) {
      if (profileMatchesCityHint(cn, p)) fromHint.push(p);
    }
  }
  if (fromHint.length) {
    return { profiles: dedupeProfiles(fromHint), contextLocked: true };
  }

  const lat = input.biasLat;
  const lon = input.biasLon;
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    const fromBox = RU_METRO_PROFILE_ORDER.filter(p => p.bbox && pointInBBox(lat, lon, p.bbox));
    if (fromBox.length) {
      return { profiles: dedupeProfiles(fromBox), contextLocked: true };
    }
  }

  return { profiles: [...RU_METRO_PROFILE_ORDER], contextLocked: false };
}

export function anyRuMetroLocalityInQuery(normalizedQuery: string): boolean {
  const qn = nf(normalizedQuery);
  return RU_METRO_PROFILE_ORDER.some(p => profileHintsQuery(qn, p));
}

export function shouldExpandRuMetroSuggest(normalizedQuery: string): boolean {
  const q = normalizedQuery.trim();
  if (q.length < 3) return false;
  if (hasExplicitRuCity(q)) return false;
  if (anyRuMetroLocalityInQuery(q)) return false;
  return looksLikeStreetHouseQuery(q);
}

function tailForExpand(providerQueryRaw: string): string {
  const tail = buildRuProviderQuery(providerQueryRaw.trim());
  return tail || providerQueryRaw.trim();
}

function uniqueStrings(rows: string[]): string[] {
  const s = new Set<string>();
  const out: string[] = [];
  for (const x of rows) {
    const t = x.replace(/\s+/g, ' ').trim();
    if (!t || s.has(t)) continue;
    s.add(t);
    out.push(t);
  }
  return out;
}

export function buildRuMetroSuggestQueryVariants(
  providerQueryRaw: string,
  normalizedQuery: string,
  profiles: readonly AddressSearchProfile[],
): string[] {
  if (!shouldExpandRuMetroSuggest(normalizedQuery)) return [];
  const tail = tailForExpand(providerQueryRaw);
  if (!tail) return [];

  const built: string[] = [];
  for (const p of profiles) {
    for (const tmpl of p.queryExpansionTemplates ?? []) {
      built.push(tmpl.replace(/\{tail\}/g, tail).replace(/\s+/g, ' ').trim());
    }
  }
  return uniqueStrings(built).slice(0, 40);
}

export function buildRuMetroGeocodeVariants(
  rawAddress: string,
  resolution: RuAddressSearchResolution,
): string[] {
  const { normalized, providerQuery } = normalizeRuAddressQuery(rawAddress);
  if (!shouldExpandRuMetroSuggest(normalized)) return [];

  const core = providerQuery.trim();
  if (!core) return [];

  const profileSource = resolution.contextLocked
    ? resolution.profiles
    : RU_GEOCODE_FALLBACK_PROFILE_IDS.map(id => RU_PROFILE_BY_ID.get(id)).filter(Boolean) as AddressSearchProfile[];

  const built: string[] = [];
  for (const p of profileSource) {
    for (const tmpl of p.queryExpansionTemplates ?? []) {
      built.push(`${tmpl.replace(/\{tail\}/g, core)}, Россия`.replace(/\s+/g, ' ').trim());
    }
  }
  return uniqueStrings(built).slice(0, 24);
}
