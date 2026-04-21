/**
 * Lightweight validation harness for 10–20 real addresses.
 *
 * Goal: capture outputs + run basic sanity checks so the location demo/report
 * does not overstate proxy outputs and remains testable.
 *
 * Usage:
 *   npx tsx scripts/location-validation-harness.ts
 *
 * Outputs:
 *   - scripts/location-validation-harness.results.json
 *   - scripts/location-validation-harness.report.md
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';
import type { DemandType, LocationAnalysis } from '../src/lib/location/types';

type Case = {
  id: string;
  address: string;
  lat: number;
  lon: number;
  notes?: string;
};

// 12 real, globally recognisable addresses with fixed coordinates (no geocoding dependency).
const CASES: Case[] = [
  { id: 'ny_times_square', address: 'Times Square, Manhattan, New York, NY, USA', lat: 40.75645, lon: -73.9865 },
  { id: 'paris_la_defense', address: 'La Défense, Puteaux, Paris, France', lat: 48.8919, lon: 2.2387 },
  { id: 'tokyo_station', address: 'Tokyo Station, Chiyoda, Tokyo, Japan', lat: 35.681236, lon: 139.767125 },
  { id: 'osaka_dotonbori', address: 'Dotonbori, Chuo Ward, Osaka, Japan', lat: 34.6687, lon: 135.5011 },
  { id: 'berlin_messe', address: 'Messe Berlin, Berlin, Germany', lat: 52.5016, lon: 13.2781 },
  { id: 'houston_tmc', address: 'Texas Medical Center, Houston, TX, USA', lat: 29.7071, lon: -95.4014 },
  { id: 'moscow_red_square', address: 'Red Square, Moscow, Russia', lat: 55.753544, lon: 37.620794 },
  { id: 'spb_palace_square', address: 'Palace Square, Saint Petersburg, Russia', lat: 59.9398, lon: 30.3146 },
  { id: 'london_kings_cross', address: "King's Cross Station, London, UK", lat: 51.5308, lon: -0.1238 },
  { id: 'rome_termini', address: 'Roma Termini, Rome, Italy', lat: 41.9010, lon: 12.5019 },
  { id: 'dubai_marina', address: 'Dubai Marina, Dubai, UAE', lat: 25.0773, lon: 55.1400 },
  { id: 'rotterdam_europoort', address: 'Europoort, Port of Rotterdam, Netherlands', lat: 51.9567, lon: 4.1383 },
];

const ALLOWED_DEMAND: DemandType[] = ['tourism-led', 'business-led', 'transport-led', 'mixed'];

type Check = { id: string; level: 'pass' | 'warn' | 'fail'; message: string };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function competitorPressureSanity(a: LocationAnalysis): Check {
  const pressure = a.gravityExplanation?.competitorPressureLevel ?? 'low';
  const count = a.competitors?.length ?? 0;
  if (pressure === 'high' && count < 2) {
    return { id: 'competitor_pressure', level: 'fail', message: `pressure=high but competitors=${count}` };
  }
  if (pressure === 'low' && count > 25) {
    return { id: 'competitor_pressure', level: 'warn', message: `pressure=low but competitors=${count}` };
  }
  return { id: 'competitor_pressure', level: 'pass', message: `pressure=${pressure} competitors=${count}` };
}

function accessibilitySanity(a: LocationAnalysis): Check {
  const stops = a.accessibilityStops?.length ?? 0;
  if (stops === 0) return { id: 'accessibility', level: 'warn', message: 'no transport stops detected (may be sparse OSM)' };
  return { id: 'accessibility', level: 'pass', message: `stops=${stops}` };
}

function scorePlausibility(a: LocationAnalysis): Check {
  const s = a.locationScore?.location_score;
  if (s == null || !Number.isFinite(s)) return { id: 'score', level: 'fail', message: 'locationScore.location_score missing' };
  if (s < 0 || s > 100) return { id: 'score', level: 'fail', message: `locationScore out of range: ${s}` };
  if (a.evergreenIndex < 0 || a.evergreenIndex > 100) return { id: 'score', level: 'fail', message: `evergreenIndex out of range: ${a.evergreenIndex}` };
  return { id: 'score', level: 'pass', message: `evergreen=${a.evergreenIndex} score=${s}` };
}

function demandTypeSanity(a: LocationAnalysis): Check {
  if (!ALLOWED_DEMAND.includes(a.demandType)) {
    return { id: 'demand_type', level: 'fail', message: `unexpected demandType: ${String(a.demandType)}` };
  }
  return { id: 'demand_type', level: 'pass', message: `demandType=${a.demandType}` };
}

function proxyEstimateSanity(a: LocationAnalysis): Check {
  const model = a.locationScore?.income_model;
  const income = a.locationScore?.estimated_monthly_income;
  if (!model || !income) return { id: 'proxy_estimates', level: 'warn', message: 'income model missing (no proxy checks)' };

  const adr = model.base_adr_rub;
  const occ = model.base_occupancy_pct;
  const incomes = [income.short_term, income.hybrid, income.mid_term].filter(n => typeof n === 'number');
  const maxIncome = incomes.length ? Math.max(...incomes) : null;

  if (!Number.isFinite(adr) || adr < 500 || adr > 80_000) {
    return { id: 'proxy_estimates', level: 'fail', message: `base_adr_rub implausible: ${adr}` };
  }
  if (!Number.isFinite(occ) || occ < 10 || occ > 95) {
    return { id: 'proxy_estimates', level: 'fail', message: `base_occupancy_pct implausible: ${occ}` };
  }
  if (maxIncome != null && (maxIncome < 10_000 || maxIncome > 2_500_000)) {
    return { id: 'proxy_estimates', level: 'warn', message: `monthly income range looks extreme (max=${maxIncome})` };
  }
  return {
    id: 'proxy_estimates',
    level: 'pass',
    message: `adr≈${Math.round(adr)}₽ occ≈${Math.round(occ)}%`,
  };
}

function signalQuality(elementsCount: number, usedFallbackQuery: boolean): { confidence: 'high' | 'medium' | 'low'; note: string } {
  const sparse = elementsCount < 60;
  const medium = elementsCount < 140;
  const confidence = sparse ? 'low' : (usedFallbackQuery || medium) ? 'medium' : 'high';
  const note = `elements=${elementsCount}${usedFallbackQuery ? ' fallback_query=true' : ''}`;
  return { confidence, note };
}

async function main() {
  const results: Array<{
    id: string;
    address: string;
    lat: number;
    lon: number;
    elementsCount: number;
    usedFallbackQuery: boolean;
    confidence: 'high' | 'medium' | 'low';
    checks: Check[];
    summary: {
      demandType: DemandType;
      competitorPressure: string;
      evergreenIndex: number;
      locationScore: number | null;
      recommendedStrategy: string | null;
    };
  }> = [];

  for (const c of CASES) {
    const { elements, usedFallbackQuery } = await fetchOsmData(c.lat, c.lon);
    const analysis = buildAnalysis(elements, c.lat, c.lon);
    const q = signalQuality(elements.length, Boolean(usedFallbackQuery));

    const checks: Check[] = [
      demandTypeSanity(analysis),
      accessibilitySanity(analysis),
      competitorPressureSanity(analysis),
      scorePlausibility(analysis),
      proxyEstimateSanity(analysis),
      {
        id: 'signal_quality',
        level: q.confidence === 'low' ? 'warn' : 'pass',
        message: `${q.confidence} confidence (${q.note})`,
      },
    ];

    results.push({
      id: c.id,
      address: c.address,
      lat: c.lat,
      lon: c.lon,
      elementsCount: elements.length,
      usedFallbackQuery: Boolean(usedFallbackQuery),
      confidence: q.confidence,
      checks,
      summary: {
        demandType: analysis.demandType,
        competitorPressure: analysis.gravityExplanation?.competitorPressureLevel ?? 'n/a',
        evergreenIndex: analysis.evergreenIndex,
        locationScore: analysis.locationScore?.location_score ?? null,
        recommendedStrategy: analysis.locationScore?.recommended_strategy ?? null,
      },
    });
  }

  const outJson = join(process.cwd(), 'scripts', 'location-validation-harness.results.json');
  writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), cases: results }, null, 2), 'utf8');

  const totals = results.reduce(
    (acc, r) => {
      for (const ch of r.checks) {
        acc[ch.level] += 1;
      }
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 } as Record<'pass' | 'warn' | 'fail', number>,
  );

  const mdLines: string[] = [];
  mdLines.push(`# Location validation harness report`);
  mdLines.push(`Generated: ${new Date().toISOString()}`);
  mdLines.push('');
  mdLines.push(`Totals: pass=${totals.pass} · warn=${totals.warn} · fail=${totals.fail}`);
  mdLines.push('');
  mdLines.push(`## Cases`);
  for (const r of results) {
    const failCount = r.checks.filter(c => c.level === 'fail').length;
    const warnCount = r.checks.filter(c => c.level === 'warn').length;
    mdLines.push(`- **${r.id}** — ${r.address}`);
    mdLines.push(`  - coords: ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)} · elements=${r.elementsCount} · fallback=${r.usedFallbackQuery}`);
    mdLines.push(`  - summary: demand=${r.summary.demandType} · pressure=${r.summary.competitorPressure} · evergreen=${r.summary.evergreenIndex} · score=${r.summary.locationScore ?? '—'} · strategy=${r.summary.recommendedStrategy ?? '—'}`);
    mdLines.push(`  - checks: fail=${failCount} · warn=${warnCount}`);
    for (const ch of r.checks) {
      const tag = ch.level === 'pass' ? 'PASS' : ch.level === 'warn' ? 'WARN' : 'FAIL';
      mdLines.push(`    - ${tag} ${ch.id}: ${ch.message}`);
    }
  }

  const outMd = join(process.cwd(), 'scripts', 'location-validation-harness.report.md');
  writeFileSync(outMd, mdLines.join('\n'), 'utf8');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

