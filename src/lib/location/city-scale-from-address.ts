/**
 * Heuristic city-scale tier for demand-kernel safeguards (RU residential demo).
 * Uses address text only — no external population API.
 */

export type InferredCityScaleTier = 'micro' | 'small' | 'medium' | 'large' | 'unknown';

export interface CityScaleInference {
  readonly tier: InferredCityScaleTier;
  /** Approximate population when known from static table; null if unknown */
  readonly populationApprox: number | null;
  /** Human-readable provenance for diagnostics */
  readonly inferredFrom: string;
}

const TABLE: ReadonlyArray<{
  needle: string;
  tier: InferredCityScaleTier;
  populationApprox: number | null;
}> = [
  { needle: 'лодейное поле', tier: 'small', populationApprox: 21_000 },
  { needle: 'ростов-на-дону', tier: 'large', populationApprox: 1_150_000 },
  { needle: 'новосибирск', tier: 'large', populationApprox: 1_630_000 },
  { needle: 'кемерово', tier: 'large', populationApprox: 550_000 },
  { needle: 'саранск', tier: 'medium', populationApprox: 318_000 },
  { needle: 'ялта', tier: 'medium', populationApprox: 82_000 },
];

function normAddr(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Longest-match static table over normalized address (Cyrillic city names in fixtures).
 */
export function inferCityScaleFromRuAddress(addressRu: string): CityScaleInference {
  const n = normAddr(addressRu);
  if (!n || n === 'fixture') {
    return { tier: 'unknown', populationApprox: null, inferredFrom: 'no_city_token' };
  }

  let best: (typeof TABLE)[number] | null = null;
  for (const row of TABLE) {
    if (!n.includes(row.needle)) continue;
    if (!best || row.needle.length > best.needle.length) {
      best = row;
    }
  }
  if (best) {
    return {
      tier: best.tier,
      populationApprox: best.populationApprox,
      inferredFrom: `static_table:${best.needle}`,
    };
  }
  return { tier: 'unknown', populationApprox: null, inferredFrom: 'no_match' };
}
