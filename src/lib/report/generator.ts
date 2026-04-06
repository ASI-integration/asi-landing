/**
 * lib/report/generator.ts
 *
 * Deterministic report data generator for the /report/[id] page.
 *
 * The report ID is either:
 *   1. A base64url-encoded address string (e.g. from the demo tool)
 *   2. A URL-safe slug (spaces replaced with hyphens)
 *
 * All fields are derived deterministically from the address, so the same
 * address always produces the same report — no database required for demos.
 */

import { analyzeAddress } from '@/lib/location/scoring';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ReportData {
  id: string;
  address: string;
  score: number;
  bandLabel: string;     // "Strong location" | "Average location" | "Needs optimization"
  bandLabelEn: string;   // "strong" | "medium" | "weak"
  bandColor: string;     // tailwind class e.g. "text-emerald-400"
  strokeColor: string;   // hex e.g. "#34d399"
  verdict: string;

  demandStability: 'High' | 'Moderate' | 'Low';
  demandStabilityColor: string; // tailwind class

  // Market snapshot
  competitors500m: number;
  avgADR: number;     // USD nightly
  occupancy: number;  // 0–100
  revpar: number;     // USD nightly
  strategy: string;   // "Short-term" | "Mid-term" | "Hybrid"

  // Platform breakdown
  airbnbCount: number;
  bookingCount: number;
  vrboCount: number;
  priceMin: number;   // USD
  priceMax: number;   // USD

  // Demand drivers
  attractions: string[];
  businessHubs: string[];
  transport: string[];
  seasonality: string;

  // Revenue model
  monthlyMin: number;
  monthlyMax: number;

  // Strategy block
  recommendedStrategy: string;
  targetAudience: string;
  pricingApproach: string;

  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h || 1;
}

function lcg(n: number): number {
  return (n * 48271) % 2_147_483_647;
}

// ── ID decoding ───────────────────────────────────────────────────────────────

export function decodeReportId(id: string): string {
  // 1. Try base64url decode
  try {
    const decoded = Buffer.from(id, 'base64url').toString('utf8');
    // Must look like a plausible address (has space or comma, min 5 chars)
    if (decoded.length >= 5 && /[\s,]/.test(decoded)) return decoded;
  } catch {
    // ignore
  }
  // 2. Fallback: slug → spaces
  return decodeURIComponent(id).replace(/-/g, ' ');
}

// ── Generator ─────────────────────────────────────────────────────────────────

export function generateReport(id: string): ReportData {
  const address = decodeReportId(id);
  const { score, band } = analyzeAddress(address);

  const h = simpleHash(address.trim().toLowerCase());
  let s = h;

  // Advance the LCG to get independent streams
  const r: number[] = [];
  for (let i = 0; i < 12; i++) {
    s = lcg(s);
    r.push(s);
  }

  // ── ADR ───────────────────────────────────────────────────────────────────
  const adrBase = score >= 70 ? 115 : score >= 45 ? 78 : 55;
  const avgADR  = Math.max(45, adrBase + ((r[0] % 25) - 12));

  // ── Occupancy ─────────────────────────────────────────────────────────────
  const occBase = score >= 70 ? 73 : score >= 45 ? 63 : 55;
  const occupancy = Math.max(45, Math.min(83, occBase + ((r[1] % 9) - 4)));

  // ── RevPAR ────────────────────────────────────────────────────────────────
  const revpar = Math.round(avgADR * occupancy / 100);

  // ── Competitors ───────────────────────────────────────────────────────────
  const compBase = score >= 70 ? 19 : score >= 45 ? 12 : 6;
  const competitors500m = compBase + (r[2] % 9);

  // ── Platform breakdown ────────────────────────────────────────────────────
  const airbnbCount  = 3 + (r[3] % 9);
  const bookingCount = 7 + (r[4] % 14);
  const vrboCount    = 1 + (r[5] % 6);

  // ── Price range ───────────────────────────────────────────────────────────
  const priceMin = Math.round(avgADR * 0.52);
  const priceMax = Math.round(avgADR * 1.55);

  // ── Monthly revenue ───────────────────────────────────────────────────────
  const monthlyMin = Math.round(avgADR * (occupancy - 6) / 100 * 28);
  const monthlyMax = Math.round(avgADR * Math.min(82, occupancy + 8) / 100 * 30);

  // ── Demand stability ──────────────────────────────────────────────────────
  const demandStability: ReportData['demandStability'] =
    score >= 70 ? 'High' : score >= 45 ? 'Moderate' : 'Low';

  const demandStabilityColor =
    score >= 70 ? 'text-emerald-400'
    : score >= 45 ? 'text-amber-400'
    : 'text-yellow-400';

  // ── Verdict ───────────────────────────────────────────────────────────────
  const verdicts: Record<string, string[]> = {
    strong: [
      'Strong demand with excellent short-term potential',
      'High-traffic location with consistent booking demand',
      'Premium position — strong corporate and leisure mix',
    ],
    medium: [
      'Moderate demand with strong mid-term potential',
      'Solid location — demand grows with channel optimization',
      'Developing market with clear upside opportunity',
    ],
    weak: [
      'Emerging location — niche positioning recommended',
      'Early-stage demand — targeted strategy required',
      'Limited signals — channel mix is the key lever',
    ],
  };
  const vPool  = verdicts[band.labelEn] ?? verdicts.medium;
  const verdict = vPool[h % vPool.length];

  // ── Strategy type ─────────────────────────────────────────────────────────
  const strategy = score >= 70 ? 'Short-term' : score >= 45 ? 'Mid-term' : 'Hybrid';

  // ── Demand drivers ────────────────────────────────────────────────────────
  const attractionPool = [
    'City center park', 'Historic district', 'Museum quarter',
    'Riverside promenade', 'Shopping district', 'Exhibition hall',
    'University campus', 'Cultural center', 'Botanical gardens',
    'Entertainment complex',
  ];
  const businessPool = [
    'Financial district (1.2 km)', 'Tech hub cluster',
    'Convention center (800 m)', 'Co-working corridor',
    'Business park (1.5 km)', 'Medical district',
    'Government quarter (900 m)',
  ];
  const transportPool = [
    'Metro station (250 m)', 'Main train station (1.1 km)',
    'Bus terminal (400 m)', 'Tram corridor',
    'Highway access (2 km)', 'Airport express (3 stops)',
    'Bike-share hub (120 m)',
  ];
  const seasonalityPool = [
    'Year-round demand — peak in summer and December',
    'Moderate seasonality — business travel flattens dips',
    'Strong Q2/Q3, stable Q1/Q4 from corporate bookings',
    'Consistent year-round with spring/fall peaks',
  ];

  const attractions = [
    attractionPool[r[6] % attractionPool.length],
    attractionPool[(r[7] + 3) % attractionPool.length],
  ];
  const businessHubs = [
    businessPool[r[8] % businessPool.length],
  ];
  const transport = [
    transportPool[r[9] % transportPool.length],
    transportPool[(r[10] + 2) % transportPool.length],
  ];
  const seasonality = seasonalityPool[h % seasonalityPool.length];

  // ── Strategy detail ───────────────────────────────────────────────────────
  type StratDetail = Pick<ReportData, 'recommendedStrategy' | 'targetAudience' | 'pricingApproach'>;
  const strategyDetails: Record<string, StratDetail> = {
    strong: {
      recommendedStrategy: 'Short-term rentals with dynamic pricing',
      targetAudience: 'Business travelers, weekend leisure guests, corporate accounts',
      pricingApproach: 'Dynamic daily pricing with 20–30% weekend premium',
    },
    medium: {
      recommendedStrategy: 'Mid-term rentals (1–3 months)',
      targetAudience: 'Relocating professionals, project workers, extended-stay guests',
      pricingApproach: 'Stable monthly rate with 15% short-term premium on calendar gaps',
    },
    weak: {
      recommendedStrategy: 'Hybrid — long-term base with short-term gap filling',
      targetAudience: 'Local professionals, students, remote workers',
      pricingApproach: 'Competitive market-rate pricing to maximize occupancy first',
    },
  };

  const stratDetail = strategyDetails[band.labelEn] ?? strategyDetails.medium;

  return {
    id,
    address,
    score,
    bandLabel:    band.label,
    bandLabelEn:  band.labelEn,
    bandColor:    band.textColor,
    strokeColor:  band.stroke,
    verdict,
    demandStability,
    demandStabilityColor,
    competitors500m,
    avgADR,
    occupancy,
    revpar,
    strategy,
    airbnbCount,
    bookingCount,
    vrboCount,
    priceMin,
    priceMax,
    attractions,
    businessHubs,
    transport,
    seasonality,
    monthlyMin,
    monthlyMax,
    ...stratDetail,
    generatedAt: new Date().toISOString(),
  };
}
