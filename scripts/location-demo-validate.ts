/**
 * One-off validation runner for homepage location demo.
 * Usage: npx tsx scripts/location-demo-validate.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as overpass from '../src/lib/location/overpass';
import * as gravity from '../src/lib/location/gravity-scoring';
import type { OSMElement } from '../src/lib/location/types';

const { fetchOsmData, classifyElement } = overpass;
const { buildAnalysis } = gravity;

const CASES: Array<{
  id: string;
  address: string;
  expected: string;
  lat: number;
  lon: number;
}> = [
  {
    id: 'tourist_center',
    address: 'Times Square, Manhattan, New York, NY, USA',
    expected: 'Strong tourism / city-center demand',
    lat: 40.75645,
    lon: -73.9865,
  },
  {
    id: 'business_cbd',
    address: 'La Défense, Puteaux, Paris, France',
    expected: 'Business / office CBD',
    lat: 48.8919,
    lon: 2.2387,
  },
  {
    id: 'transport_hub',
    address: 'Tokyo Station, Chiyoda, Tokyo, Japan',
    expected: 'Major rail + metro hub',
    lat: 35.681236,
    lon: 139.767125,
  },
  {
    id: 'medical_cluster',
    address: 'Texas Medical Center, Houston, TX, USA',
    expected: 'Hospital / medical-driven',
    lat: 29.7071,
    lon: -95.4014,
  },
  {
    id: 'convention_expo',
    address: 'Messe Berlin, Messedamm, Berlin, Germany',
    expected: 'Convention / expo anchor',
    lat: 52.5016,
    lon: 13.2781,
  },
  {
    id: 'residential_peripheral',
    address: 'Levittown, NY, USA (suburban residential)',
    expected: 'Weak peripheral residential',
    lat: 40.7259,
    lon: -73.5148,
  },
  {
    id: 'borderline_hotel_proxy',
    address: 'Rue des Petites Écuries, Paris 10e (near chain hotels but smaller street)',
    expected: 'Mixed; may lean on nearby major hotels',
    lat: 48.8708,
    lon: 2.3524,
  },
  {
    id: 'noisy_food_cluster',
    address: 'Dotonbori, Chuo Ward, Osaka, Japan',
    expected: 'Many food POIs; true evergreen may be overstated if food dominates',
    lat: 34.6687,
    lon: 135.5011,
  },
  {
    id: 'industrial_logistics',
    address: 'Port of Rotterdam — Europoort industrial zone, Netherlands',
    expected: 'Industrial / logistics demand',
    lat: 51.9567,
    lon: 4.1383,
  },
  {
    id: 'ru_tourist_icon',
    address: 'Red Square, Moscow, Russia',
    expected: 'Iconic tourism + metro/rail',
    lat: 55.753544,
    lon: 37.620794,
  },
];

function rawCategoryHistogram(elements: OSMElement[]) {
  const counts: Record<string, number> = {};
  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat == null || elLon == null) continue;
    const c = classifyElement(el);
    if (!c || c.categoryId === 'competitor' || c.categoryId === 'accessibility_stop') continue;
    counts[c.categoryId] = (counts[c.categoryId] ?? 0) + 1;
  }
  return counts;
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const FETCH_BUDGET_MS = 95_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

async function main() {
  const out: unknown[] = [];
  for (const c of CASES) {
    // eslint-disable-next-line no-console
    console.error(`\n=== ${c.id}: ${c.address} ===`);
    let elements: OSMElement[] = [];
    let usedFallback = false;
    try {
      const r = await withTimeout(fetchOsmData(c.lat, c.lon), FETCH_BUDGET_MS, c.id);
      elements = r.elements;
      usedFallback = r.usedFallbackQuery ?? false;
    } catch (e) {
      out.push({
        ...c,
        error: e instanceof Error ? e.message : String(e),
      });
      await delay(2500);
      continue;
    }

    const rawHist = rawCategoryHistogram(elements);
    const analysis = buildAnalysis(elements, c.lat, c.lon);

    const topMagnets = [...analysis.magnets]
      .sort((a, b) => b.attractionScore - a.attractionScore)
      .slice(0, 8)
      .map(m => ({
        name: m.name,
        type: m.categoryId,
        distM: Math.round(m.distance),
        weight: m.weight,
        strength: m.strengthClass,
        attractionScore: +m.attractionScore.toFixed(3),
      }));

    const hotels = analysis.magnets.filter(m => m.categoryId === 'major_hotel');

    const sb = analysis.gravityExplanation.scoreBreakdown;
    out.push({
      id: c.id,
      address: c.address,
      expected: c.expected,
      lat: c.lat,
      lon: c.lon,
      elementsCount: elements.length,
      usedFallbackQuery: usedFallback,
      rawClassifiedCounts: rawHist,
      scoredMagnetCount: analysis.magnets.length,
      magnetCountByCategory: analysis.magnetCountByCategory,
      evergreenIndex: analysis.evergreenIndex,
      scoreBand: analysis.scoreBand,
      demandType: analysis.demandType,
      locationScore: analysis.locationScore?.location_score,
      recommendedStrategy: analysis.locationScore?.recommended_strategy,
      competitorPressure: analysis.gravityExplanation.competitorPressureLevel,
      clusterDetected: analysis.gravityExplanation.clusterDetected,
      scoreBreakdown: sb,
      hotelProxyMagnets: hotels.map(h => ({
        name: h.name,
        distM: Math.round(h.distance),
        attractionScore: +h.attractionScore.toFixed(3),
      })),
      hotelProxyActive: hotels.length > 0,
      strongestMagnets: analysis.strongestMagnets.map(m => ({
        name: m.name,
        type: m.categoryId,
        distM: Math.round(m.distance),
        score: +m.attractionScore.toFixed(3),
      })),
      topMagnets,
      dominantNames: analysis.gravityExplanation.dominantMagnets,
      conclusion: analysis.conclusion,
      audiencePrimary: analysis.audienceAnalysis?.primaryAudience,
      audienceFit: analysis.audienceAnalysis?.audienceFitScore,
      footTrafficTier: analysis.footTraffic?.modifierTier,
      topPositiveFactors: analysis.locationScore?.top_positive_factors,
    });

    await delay(800);
  }
  const outPath = join(process.cwd(), 'scripts', 'location-validation-results.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.error(`Wrote ${out.length} cases to ${outPath}`);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
