export interface RuNormalizedQuery {
  raw: string;
  normalized: string;
  /** Query to send to geocoding providers — locality type prefixes stripped so
   *  verbose Russian phrases (e.g. "поселок городского типа") don't kill recall. */
  providerQuery: string;
}

// Abbreviation expansions are intentionally conservative (token-boundary only).
const RU_ABBREV_RULES: Array<{ re: RegExp; replace: string }> = [
  // street
  { re: /(^|[\s,.-])ул\.?(?=$|[\s,.-])/giu, replace: '$1улица' },
  { re: /(^|[\s,.-])пр\.?(?=$|[\s,.-])/giu, replace: '$1проспект' },
  // house
  { re: /(^|[\s,.-])д\.?(?=$|[\s,.-])/giu, replace: '$1дом' },
  // locality
  { re: /(^|[\s,.-])пос\.?(?=$|[\s,.-])/giu, replace: '$1поселок' },
  { re: /(^|[\s,.-])пгт\.?(?=$|[\s,.-])/giu, replace: '$1поселок городского типа' },
  // region
  { re: /(^|[\s,.-])обл\.?(?=$|[\s,.-])/giu, replace: '$1область' },
];

// Matches a leading settlement-type qualifier in a single address segment.
// Must be kept in sync with RU_ABBREV_RULES expansions above.
const LEADING_LOCALITY_TYPE_RE =
  /^(?:поселок городского типа|посёлок городского типа|поселок|посёлок)\s+/iu;

/**
 * Build a provider query from a normalized RU address string.
 *
 * Strips leading settlement-type qualifiers ("поселок городского типа",
 * "поселок", "посёлок") before the locality name in the first comma segment so
 * that geocoders receive a clean name ("Невская Дубровка") rather than the
 * verbose phrase ("поселок городского типа Невская Дубровка") that returns
 * zero results from Google / Photon / DaData.
 *
 * The full normalized form is kept for locality-token extraction and reranking.
 */
export function buildRuProviderQuery(normalized: string): string {
  const commaIdx = normalized.indexOf(', ');
  if (commaIdx === -1) {
    // Locality-only query — strip leading type qualifier entirely.
    const stripped = normalized.replace(LEADING_LOCALITY_TYPE_RE, '').trim();
    return stripped || normalized;
  }
  // Full address — strip leading type qualifier only from the locality block
  // (first comma segment); keep the rest (street, house number) intact.
  const localityBlock = normalized.slice(0, commaIdx).replace(LEADING_LOCALITY_TYPE_RE, '').trim();
  const rest = normalized.slice(commaIdx); // includes the leading ", "
  return (localityBlock + rest).trim() || normalized;
}

export function normalizeRuAddressQuery(raw: string): RuNormalizedQuery {
  const q0 = raw;
  let q = raw.trim();

  // Unify punctuation/spaces for stable tokenization.
  q = q.replace(/[;]+/g, ',');
  q = q.replace(/\s+/g, ' ');

  for (const r of RU_ABBREV_RULES) {
    q = q.replace(r.re, r.replace);
  }

  // Normalize spaces around commas.
  q = q.replace(/\s*,\s*/g, ', ');
  q = q.replace(/\s+/g, ' ').trim();

  return { raw: q0, normalized: q, providerQuery: buildRuProviderQuery(q) };
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRuLocalityTokens(normalizedQuery: string): string[] {
  const q = normalizeForMatch(normalizedQuery);
  if (!q) return [];

  // Prefer the part before the first comma as the locality block if present.
  const beforeComma = q.split(' , ')[0] ?? q;

  // If the query looks like a street address, locality tokens should be empty.
  // Otherwise, street names get misread as "locality" and cause harmful reranking.
  const streetWords = new Set([
    // street types (full)
    'улица', 'проспект', 'переулок', 'проезд', 'шоссе', 'набережная', 'бульвар', 'площадь', 'аллея',
    // common abbreviations users type
    'ул', 'пр', 'пер', 'наб', 'пл', 'бул', 'ш',
    // house
    'дом', 'д',
  ]);
  const localityTypeWords = new Set(['поселок', 'городского', 'типа', 'область']);

  const tokens = beforeComma.split(' ').filter(Boolean);
  const locality: string[] = [];
  for (const t of tokens) {
    if (streetWords.has(t)) break;
    if (/^\d+$/u.test(t)) break;
    if (localityTypeWords.has(t)) continue;
    if (t.length < 3) continue;
    locality.push(t);
  }
  return locality;
}

type RuStreetType =
  | 'street'
  | 'avenue'
  | 'lane'
  | 'embankment'
  | 'square'
  | 'boulevard'
  | 'highway'
  | 'passage'
  | 'unknown';

function detectStreetType(q: string): RuStreetType {
  // `q` is normalizedForMatch() already.
  const tokens = new Set(q.split(' ').filter(Boolean));
  if (tokens.has('переулок') || tokens.has('пер')) return 'lane';
  if (tokens.has('улица') || tokens.has('ул')) return 'street';
  if (tokens.has('проспект') || tokens.has('пр')) return 'avenue';
  if (tokens.has('набережная') || tokens.has('наб')) return 'embankment';
  if (tokens.has('площадь') || tokens.has('пл')) return 'square';
  if (tokens.has('бульвар') || tokens.has('бул')) return 'boulevard';
  if (tokens.has('шоссе') || tokens.has('ш')) return 'highway';
  if (tokens.has('проезд')) return 'passage';
  return 'unknown';
}

function extractFirstHouseNumber(q: string): string | null {
  const m = q.match(/\b(\d{1,4})\b/u);
  return m?.[1] ?? null;
}

function extractStreetStems(q: string): string[] {
  // Keep this conservative: prefer recall via a short stem, not full lemmatization.
  const tokens = q.split(' ').filter(Boolean);
  const stop = new Set([
    'улица', 'ул', 'проспект', 'пр', 'переулок', 'пер', 'проезд', 'шоссе', 'набережная', 'наб',
    'бульвар', 'бул', 'площадь', 'пл', 'аллея',
    'дом', 'д',
    'россия', 'рф',
  ]);
  const out: string[] = [];
  for (const t of tokens) {
    if (stop.has(t)) continue;
    if (/^\d+$/u.test(t)) continue;
    if (t.length < 4) continue;
    // Use a 6-char prefix as a robust-ish stem for Russian adjectives/nouns.
    out.push(t.slice(0, Math.min(6, t.length)));
  }
  // Dedup while preserving order.
  return [...new Set(out)];
}

function streetTypeMatchScore(type: RuStreetType, v: string): number {
  // `v` is normalizeForMatch(s.value)
  const has = (w: string) => v.includes(` ${w} `) || v.startsWith(`${w} `) || v.endsWith(` ${w}`);
  if (type === 'unknown') return 0;

  const typeWords: Record<RuStreetType, string[]> = {
    street: ['улица', 'ул'],
    avenue: ['проспект', 'пр'],
    lane: ['переулок', 'пер'],
    embankment: ['набережная', 'наб'],
    square: ['площадь', 'пл'],
    boulevard: ['бульвар', 'бул'],
    highway: ['шоссе', 'ш'],
    passage: ['проезд'],
    unknown: [],
  };
  const same = typeWords[type].some(has);
  if (same) return 40;

  // Penalize clear mismatches when suggestion contains a different street type word.
  const otherTypeWords = [
    ...typeWords.street,
    ...typeWords.avenue,
    ...typeWords.lane,
    ...typeWords.embankment,
    ...typeWords.square,
    ...typeWords.boulevard,
    ...typeWords.highway,
    ...typeWords.passage,
  ];
  const hasAnyType = otherTypeWords.some(has);
  return hasAnyType ? -18 : 0;
}

function cityTieBreakScore(v: string): number {
  // Keep tiny: only breaks ties once street+house plausibility is strong.
  const spb = v.includes('санкт петербург') || v.includes('санкт-петербург') || v.includes('петербург');
  const msk = v.includes('москва');
  if (spb && !msk) return 6;
  if (msk && !spb) return 0;
  return 0;
}

function scoreRuSuggestionByStreetHouse(normalizedQuery: string, suggestionValue: string, idx: number): number {
  const q = normalizeForMatch(normalizedQuery);
  const v = normalizeForMatch(suggestionValue);
  if (!q || !v) return -idx * 0.01;

  const house = extractFirstHouseNumber(q);
  const type = detectStreetType(q);
  const stems = extractStreetStems(q);

  const stemHits = stems.reduce((acc, s) => acc + (v.includes(s) ? 1 : 0), 0);
  const allStems = stems.length > 0 && stemHits === stems.length ? 1 : 0;

  const houseHit = house && new RegExp(`\\b${house}\\b`, 'u').test(v) ? 1 : 0;

  // Plausibility-first: exact-ish street stem coverage and house match dominate.
  const streetScore = allStems ? 140 : stemHits * 35;
  const houseScore = houseHit ? 120 : 0;
  const typeScore = streetTypeMatchScore(type, v);
  const cityScore = cityTieBreakScore(v);

  return streetScore + houseScore + typeScore + cityScore - idx * 0.01;
}

export function rerankRuSuggestionsByLocality<T extends { value: string }>(
  normalizedQuery: string,
  suggestions: T[],
): T[] {
  const localityTokens = extractRuLocalityTokens(normalizedQuery);
  if (suggestions.length < 2) return suggestions;

  // If there is no locality information in the query, fall back to a
  // street+house plausibility rerank (prevents provider population bias).
  if (localityTokens.length === 0) {
    const scored = suggestions.map((s, idx) => ({
      s,
      score: scoreRuSuggestionByStreetHouse(normalizedQuery, s.value, idx),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(x => x.s);
  }

  const scored = suggestions.map((s, idx) => {
    const v = normalizeForMatch(s.value);
    const hits = localityTokens.reduce((acc, t) => acc + (v.includes(t) ? 1 : 0), 0);
    const all = hits === localityTokens.length ? 1 : 0;

    // Prefer locality match, but still let strong street+house plausibility
    // break ties for partial/locality-ambiguous queries.
    const localityScore = all * 120 + hits * 14;
    const plausibilityScore = scoreRuSuggestionByStreetHouse(normalizedQuery, s.value, idx) * 0.12;
    const score = localityScore + plausibilityScore - idx * 0.01;
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.s);
}

