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
 * LEGACY / DEMO ONLY: simulated deterministic scores — not the gravity / evergreen engine.
 * Production paths use `gravity-scoring.ts` + `location-scoring-pipeline.ts`; do not merge this module into scoring traces.
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
    'Transit access',
    'Demand density',
    'Competitive activity',
    'Audience fit',
    'Neighborhood pull',
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
    { label: 'Corporate / B2B', value: cl(transport * 0.45 + audience * 0.35 + score * 0.20 + n1) },
    { label: 'Business travel', value: cl(transport * 0.40 + demand * 0.30 + score * 0.20 + audience * 0.10 + n2) },
    { label: 'Leisure tourists', value: cl(district * 0.45 + demand * 0.25 + (100 - competition) * 0.15 + score * 0.15 + n3) },
    { label: 'Families', value: cl(district * 0.40 + (100 - competition) * 0.25 + (100 - transport) * 0.10 + score * 0.15 + demand * 0.10 + n4) },
  ];
}

export function getBand(score: number): Band {
  if (score >= 70) return {
    label: 'Strong location', labelEn: 'strong',
    desc: 'High demand, solid infrastructure, good visibility.',
    textColor: 'text-emerald-400', stroke: '#34d399',
    border: 'border-emerald-700/40', bg: 'bg-emerald-900/10', bar: 'bg-emerald-500',
  };
  if (score >= 45) return {
    label: 'Average location', labelEn: 'medium',
    desc: 'Moderate potential. Room to strengthen positioning.',
    textColor: 'text-amber-400', stroke: '#fbbf24',
    border: 'border-amber-700/40', bg: 'bg-amber-900/10', bar: 'bg-amber-500',
  };
  return {
    label: 'Needs optimization', labelEn: 'weak',
    desc: 'Limited demand signals. Improve channels and positioning.',
    textColor: 'text-yellow-400', stroke: '#facc15',
    border: 'border-yellow-700/40', bg: 'bg-yellow-900/10', bar: 'bg-yellow-500',
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
