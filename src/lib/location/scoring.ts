/**
 * Location scoring — deterministic, pure functions.
 *
 * These are shared between:
 *   - src/components/LocationIntelligenceDemo.tsx  (client-side demo)
 *   - src/app/api/location-analyze/route.ts        (server-side cache path)
 *
 * All functions are pure (no side-effects, no I/O) so they can run in any
 * runtime (Node, Edge, browser).
 *
 * NOTE: scores are intentionally deterministic/simulated for the pilot demo.
 * Production upgrade path: replace scoreAddress() with a real provider call
 * (2GIS, Overpass, etc.) and derive metrics from live data.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Metric  { label: string; value: number }
export interface AudienceScore { label: string; value: number }

export type BandLabel = 'strong' | 'medium' | 'weak';

export interface Band {
  label:     string;
  labelEn:   BandLabel;
  desc:      string;
  textColor: string;
  stroke:    string;
  border:    string;
  bg:        string;
  bar:       string;
}

export interface LocationAnalysisResult {
  score:         number;
  band:          Band;
  metrics:       Metric[];
  audienceScores: AudienceScore[];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h || 1;
}

function lcg(n: number): number {
  return (n * 48271) % 2147483647;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** Deterministic score 0–100 derived from address string. */
export function scoreAddress(value: string): number {
  return 42 + (simpleHash(value.trim().toLowerCase()) % 55);
}

export function deriveMetrics(score: number, h: number): Metric[] {
  const LABELS = [
    'Транспортная доступность',
    'Плотность спроса',
    'Конкурентная активность',
    'Соответствие аудитории',
    'Притяжение района',
  ];
  let s = h;
  return LABELS.map(label => {
    s = lcg(s);
    const delta = (s % 25) - 12;
    return { label, value: Math.max(22, Math.min(97, score + delta)) };
  });
}

export function deriveAudienceScores(
  score: number,
  metrics: Metric[],
  h: number,
): AudienceScore[] {
  const transport   = metrics[0]?.value ?? score;
  const demand      = metrics[1]?.value ?? score;
  const competition = metrics[2]?.value ?? score;
  const audience    = metrics[3]?.value ?? score;
  const district    = metrics[4]?.value ?? score;

  let s = lcg(h ^ 0x5a3c);
  const n1 = (s % 11) - 5; s = lcg(s);
  const n2 = (s % 11) - 5; s = lcg(s);
  const n3 = (s % 11) - 5; s = lcg(s);
  const n4 = (s % 11) - 5;

  const cl = (v: number) => Math.max(18, Math.min(97, Math.round(v)));

  return [
    { label: 'Командированные / B2B', value: cl(transport * 0.45 + audience * 0.35 + score * 0.20 + n1) },
    { label: 'Бизнес-поездки',        value: cl(transport * 0.40 + demand * 0.30 + score * 0.20 + audience * 0.10 + n2) },
    { label: 'Туристы',               value: cl(district * 0.45 + demand * 0.25 + (100 - competition) * 0.15 + score * 0.15 + n3) },
    { label: 'Семьи',                 value: cl(district * 0.40 + (100 - competition) * 0.25 + (100 - transport) * 0.10 + score * 0.15 + demand * 0.10 + n4) },
  ];
}

export function getBand(score: number): Band {
  if (score >= 70) return {
    label: 'Сильная локация', labelEn: 'strong',
    desc: 'Высокий спрос, развитая инфраструктура, хорошая видимость.',
    textColor: 'text-emerald-400', stroke: '#34d399',
    border: 'border-emerald-700/40', bg: 'bg-emerald-900/10', bar: 'bg-emerald-500',
  };
  if (score >= 45) return {
    label: 'Средняя локация', labelEn: 'medium',
    desc: 'Умеренный потенциал. Есть пространство для усиления.',
    textColor: 'text-amber-400', stroke: '#fbbf24',
    border: 'border-amber-700/40', bg: 'bg-amber-900/10', bar: 'bg-amber-500',
  };
  return {
    label: 'Требует усиления', labelEn: 'weak',
    desc: 'Спрос ограничен. Рекомендуется усиление каналами и упаковкой.',
    textColor: 'text-rose-400', stroke: '#f87171',
    border: 'border-rose-700/40', bg: 'bg-rose-900/10', bar: 'bg-rose-500',
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** Compute full analysis for a given address string. */
export function analyzeAddress(address: string): LocationAnalysisResult {
  const h     = simpleHash(address.trim().toLowerCase());
  const score = scoreAddress(address);
  const metrics = deriveMetrics(score, h);
  return {
    score,
    band: getBand(score),
    metrics,
    audienceScores: deriveAudienceScores(score, metrics, h),
  };
}
