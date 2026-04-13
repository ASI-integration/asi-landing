export interface RuNormalizedQuery {
  raw: string;
  normalized: string;
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

  return { raw: q0, normalized: q };
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

export function rerankRuSuggestionsByLocality(
  normalizedQuery: string,
  suggestions: Array<{ value: string }>,
): Array<{ value: string }> {
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

