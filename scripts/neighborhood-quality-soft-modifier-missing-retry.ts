/**
 * Retry only control rows that were missing for the soft-modifier checklist
 * (timeouts / no data in neighborhood-quality-control-results.json).
 *
 * Merges each successful fetch into scripts/neighborhood-quality-control-results.json
 * after every case so partial progress survives interruptions.
 *
 * Usage: npx --yes tsx scripts/neighborhood-quality-soft-modifier-missing-retry.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';

/** Same ids/coords as neighborhood-quality-control-run.ts — only rows that were "—" in the pass doc. */
const MISSING = [
  { id: 'times_square', label: 'Times Square', lat: 40.758, lon: -73.9855, bucket: 'strong' },
  { id: 'kazan_center', label: 'Kazan center (Baumana)', lat: 55.7963, lon: 49.1088, bucket: 'strong' },
  { id: 'sochi_center', label: 'Sochi city center', lat: 43.5855, lon: 39.7231, bucket: 'strong' },
  { id: 'lyubertsy', label: 'Lyubertsy (Moscow Oblast — weak suburb)', lat: 55.6769, lon: 37.8942, bucket: 'weak' },
  { id: 'pechatniki', label: 'Pechatniki industrial / logistics (Moscow)', lat: 55.6882, lon: 37.6984, bucket: 'contested' },
] as const;

/** Longer than default control run (200s) for flaky Overpass endpoints. */
const PER_CASE_MS = 360_000;

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

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

type ResultRow = Record<string, unknown> & { id: string };

function mergeRow(resultsPath: string, newRow: ResultRow) {
  const raw = readFileSync(resultsPath, 'utf8');
  const all = JSON.parse(raw) as ResultRow[];
  const idx = all.findIndex(r => r.id === newRow.id);
  if (idx < 0) {
    throw new Error(`mergeRow: unknown id ${newRow.id}`);
  }
  const prev = all[idx];
  all[idx] = {
    ...prev,
    ...newRow,
    label: prev.label ?? newRow.label,
    lat: prev.lat ?? newRow.lat,
    lon: prev.lon ?? newRow.lon,
    bucket: prev.bucket ?? newRow.bucket,
  };
  writeFileSync(resultsPath, JSON.stringify(all, null, 2), 'utf8');
}

async function main() {
  const resultsPath = join(process.cwd(), 'scripts', 'neighborhood-quality-control-results.json');
  const auditPath = join(process.cwd(), 'scripts', 'neighborhood-quality-soft-modifier-missing-retry.json');
  const audit: unknown[] = [];

  for (const c of MISSING) {
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
      const row: ResultRow = {
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
      };
      mergeRow(resultsPath, row);
      audit.push({ ...row, _mergedAt: new Date().toISOString() });
      writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
      const mod = analysis.commercialNeighborhoodModifier;
      const hint = mod?.applied ? ` mod ${mod.baseLocationScore}→${mod.adjustedLocationScore}` : '';
      console.log(`ok ev=${analysis.evergreenIndex} loc=${loc.location_score} ne=${ne.environmentalFrictionScore} (${ne.concernLevel})${hint}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`ERROR: ${msg}`);
      audit.push({ id: c.id, error: msg, _failedAt: new Date().toISOString() });
      writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
    }
    await sleep(2000);
  }

  console.log(`\nMerged into ${resultsPath}; audit: ${auditPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
