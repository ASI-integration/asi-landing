/**
 * Retry only timed-out control cases (longer budget, polite delay).
 * Merge manually into neighborhood-quality-control-results.json if needed.
 *
 * npx --yes tsx scripts/neighborhood-quality-retry.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';

const RETRY = [
  { id: 'lic_queens', lat: 40.7448, lon: -73.9485 },
  { id: 'causeway_bay', lat: 22.28, lon: 114.1838 },
  { id: 'kazan_center', lat: 55.7963, lon: 49.1088 },
  { id: 'el_poblado', lat: 6.2089, lon: -75.569 },
  { id: 'miami_brickell', lat: 25.7617, lon: -80.1918 },
  { id: 'cannes', lat: 43.5505, lon: 7.0178 },
  { id: 'copacabana', lat: -22.9715, lon: -43.1822 },
  { id: 'pechatniki', lat: 55.6882, lon: 37.6984 },
] as const;

const MS = 200_000;

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function main() {
  const out: unknown[] = [];
  for (const c of RETRY) {
    process.stdout.write(`${c.id} … `);
    try {
      const { elements, hadProviderFailure } = await withTimeout(
        fetchOsmData(c.lat, c.lon),
        MS,
        c.id,
      );
      const a = buildAnalysis(elements, c.lat, c.lon);
      const loc = a.locationScore;
      if (!loc) throw new Error('buildAnalysis: missing locationScore');
      const ne = a.neighborhoodEnvironment;
      out.push({
        id: c.id,
        elementCount: elements.length,
        hadProviderFailure,
        commercial: {
          evergreenIndex: a.evergreenIndex,
          scoreBand: a.scoreBand,
          locationScore: loc.location_score,
          locationScoreBase: a.commercialNeighborhoodModifier?.baseLocationScore ?? loc.location_score,
          locationRating: loc.rating,
          demandType: a.demandType,
        },
        commercialNeighborhoodModifier: a.commercialNeighborhoodModifier ?? null,
        neighborhood: {
          environmentalFrictionScore: ne.environmentalFrictionScore,
          concernLevel: ne.concernLevel,
          concernLabelEn: ne.concernLabelEn,
          confidence: ne.confidence,
          breakdown: ne.breakdown,
          reasonsEn: ne.reasonsEn,
          environmentNarrativeEn: ne.environmentNarrativeEn,
        },
        error: null,
      });
      console.log(`ok ev=${a.evergreenIndex} loc=${loc.location_score} ne=${ne.environmentalFrictionScore}`);
    } catch (e) {
      console.log(String(e));
      out.push({ id: c.id, error: String(e) });
    }
    writeFileSync(join(process.cwd(), 'scripts', 'neighborhood-quality-retry.json'), JSON.stringify(out, null, 2));
    await sleep(3500);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
