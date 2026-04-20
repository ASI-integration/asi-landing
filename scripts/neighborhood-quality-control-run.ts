/**
 * One-shot control run: 12–15 hand-picked locations.
 * Fetches OSM via production selectors (incl. neighborhood-environment geometry).
 *
 * Usage: npx --yes tsx scripts/neighborhood-quality-control-run.ts
 * Output: scripts/neighborhood-quality-control-results.json
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';

const CASES = [
  { id: 'ozone_park', label: 'Ozone Park (Queens) — weak suburb / airport–transit friction', lat: 40.6786, lon: -73.8464, bucket: 'contested' },
  { id: 'downtown_brooklyn', label: 'Downtown Brooklyn (MetroTech / court district) — urban friction edge', lat: 40.6925, lon: -73.989, bucket: 'contested' },
  { id: 'lic_queens', label: 'Long Island City — Brooklyn/Queens urban friction (transit + corridor)', lat: 40.7448, lon: -73.9485, bucket: 'contested' },
  { id: 'causeway_bay', label: 'Causeway Bay, Hong Kong', lat: 22.28, lon: 114.1838, bucket: 'strong' },
  { id: 'kazan_center', label: 'Kazan center (Baumana)', lat: 55.7963, lon: 49.1088, bucket: 'strong' },
  { id: 'sochi_center', label: 'Sochi city center', lat: 43.5855, lon: 39.7231, bucket: 'strong' },
  { id: 'el_poblado', label: 'El Poblado, Medellín', lat: 6.2089, lon: -75.569, bucket: 'strong' },
  { id: 'miami_brickell', label: 'Miami Brickell', lat: 25.7617, lon: -80.1918, bucket: 'strong' },
  { id: 'dubai_marina', label: 'Dubai Marina', lat: 25.0819, lon: 55.1407, bucket: 'strong' },
  { id: 'cannes', label: 'Cannes Croisette', lat: 43.5505, lon: 7.0178, bucket: 'strong' },
  { id: 'times_square', label: 'Times Square', lat: 40.758, lon: -73.9855, bucket: 'strong' },
  { id: 'canary_wharf', label: 'Canary Wharf (strong CBD)', lat: 51.5054, lon: -0.0235, bucket: 'strong' },
  { id: 'lyubertsy', label: 'Lyubertsy (Moscow Oblast — weak suburb)', lat: 55.6769, lon: 37.8942, bucket: 'weak' },
  { id: 'copacabana', label: 'Copacabana (resort / beach)', lat: -22.9715, lon: -43.1822, bucket: 'strong' },
  { id: 'pechatniki', label: 'Pechatniki industrial / logistics (Moscow)', lat: 55.6882, lon: 37.6984, bucket: 'contested' },
] as const;

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

const PER_CASE_MS = 200_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
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
  const rows: unknown[] = [];
  const outPath = join(process.cwd(), 'scripts', 'neighborhood-quality-control-results.json');

  for (const c of CASES) {
    process.stdout.write(`${c.id} … `);
    try {
      const { elements, hadProviderFailure } = await withTimeout(
        fetchOsmData(c.lat, c.lon),
        PER_CASE_MS,
        c.id,
      );
      const analysis = buildAnalysis(elements, c.lat, c.lon);
      const loc = analysis.locationScore;
      if (!loc) throw new Error('buildAnalysis: missing locationScore');
      const ne = analysis.neighborhoodEnvironment;
      rows.push({
        ...c,
        elementCount: elements.length,
        hadProviderFailure,
        commercial: {
          evergreenIndex: analysis.evergreenIndex,
          scoreBand: analysis.scoreBand,
          locationScore: loc.location_score,
          locationScoreBase: analysis.commercialNeighborhoodModifier?.baseLocationScore ?? loc.location_score,
          locationRating: loc.rating,
          demandType: analysis.demandType,
        },
        commercialNeighborhoodModifier: analysis.commercialNeighborhoodModifier ?? null,
        neighborhood: {
          environmentalFrictionScore: ne.environmentalFrictionScore,
          concernLevel: ne.concernLevel,
          concernLabelEn: ne.concernLabelEn,
          concernLabelRu: ne.concernLabelRu,
          confidence: ne.confidence,
          breakdown: ne.breakdown,
          reasonsEn: ne.reasonsEn,
          reasonsRu: ne.reasonsRu,
          environmentNarrativeEn: ne.environmentNarrativeEn,
          environmentNarrativeRu: ne.environmentNarrativeRu,
        },
        commercialNarrativeEn: analysis.conclusion,
        error: null,
      });
      const mod = analysis.commercialNeighborhoodModifier;
      const modHint = mod?.applied ? ` mod=${mod.baseLocationScore}→${mod.adjustedLocationScore}` : '';
      console.log(
        `ev=${analysis.evergreenIndex} loc=${loc.location_score} ne=${ne.environmentalFrictionScore} (${ne.concernLevel})${modHint}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({ ...c, error: msg, elementCount: 0, commercial: null, neighborhood: null });
      console.log(`ERROR: ${msg}`);
    }
    writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
    await sleep(900);
  }

  console.log(`\nWrote ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
