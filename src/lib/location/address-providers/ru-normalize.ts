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

  const streetWords = new Set(['улица', 'проспект', 'дом']);
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

export function rerankRuSuggestionsByLocality<T extends { value: string }>(
  normalizedQuery: string,
  suggestions: T[],
): T[] {
  const localityTokens = extractRuLocalityTokens(normalizedQuery);
  if (localityTokens.length === 0 || suggestions.length < 2) return suggestions;

  const scored = suggestions.map((s, idx) => {
    const v = normalizeForMatch(s.value);
    const hits = localityTokens.reduce((acc, t) => acc + (v.includes(t) ? 1 : 0), 0);
    const all = hits === localityTokens.length ? 1 : 0;

    // Strongly prefer "all locality tokens present", then "some present".
    const score = all * 100 + hits * 10 - idx * 0.01;
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.s);
}

