/**
 * Replays soft commercial headline modifier on cached control JSON (no network).
 * npx --yes tsx scripts/neighborhood-quality-soft-modifier-from-json.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { NeighborhoodEnvironmentLayer } from '../src/lib/location/types';
import { computeNeighborhoodEnvironmentCommercialModifier } from '../src/lib/location/neighborhood-environment-commercial-modifier';

type Row = {
  id: string;
  label: string;
  elementCount?: number;
  commercial: null | {
    locationScore: number;
    locationScoreBase?: number;
    evergreenIndex?: number;
  };
  neighborhood: null | Partial<NeighborhoodEnvironmentLayer> & {
    concernLevel: NeighborhoodEnvironmentLayer['concernLevel'];
    confidence: NeighborhoodEnvironmentLayer['confidence'];
  };
  error?: string | null;
};

/** Same order as the requested control checklist. */
const PRIORITY_IDS = [
  'ozone_park',
  'times_square',
  'cannes',
  'causeway_bay',
  'kazan_center',
  'sochi_center',
  'el_poblado',
  'miami_brickell',
  'dubai_marina',
  'canary_wharf',
  'lyubertsy',
  'pechatniki',
] as const;

function asLayer(ne: Row['neighborhood']): NeighborhoodEnvironmentLayer | null {
  if (!ne || ne.concernLevel == null || ne.confidence == null) return null;
  return ne as NeighborhoodEnvironmentLayer;
}

function main() {
  const path = join(process.cwd(), 'scripts', 'neighborhood-quality-control-results.json');
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[];

  const lines: string[] = [];
  lines.push('| Case | EV | Base loc | NE tier | NE conf | OSM n | Applied | After | Δ |');
  lines.push('|------|--:|----------|---------|---------|------|---------|------|--:|');

  const byId = new Map(rows.map(r => [r.id, r]));

  for (const id of PRIORITY_IDS) {
    const r = byId.get(id);
    if (!r) {
      lines.push(`| ${id} | — | — | — | — | — | — | — | — |`);
      continue;
    }
    if (!r.commercial || !r.neighborhood) {
      lines.push(`| ${id} | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const ne = asLayer(r.neighborhood);
    if (!ne) {
      lines.push(`| ${id} | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const base =
      typeof r.commercial.locationScoreBase === 'number'
        ? r.commercial.locationScoreBase
        : r.commercial.locationScore;
    const n = r.elementCount ?? 0;
    const ev = r.commercial.evergreenIndex ?? null;
    const snap = computeNeighborhoodEnvironmentCommercialModifier({
      baseLocationScore: base,
      neighborhoodEnvironment: ne,
      osmElementCount: n,
    });
    const applied = snap.applied ? 'yes' : 'no';
    const after = snap.adjustedLocationScore;
    const delta = snap.pointsRemoved > 0 ? `-${snap.pointsRemoved}` : '0';
    lines.push(
      `| ${id} | ${ev ?? '—'} | ${base} | ${ne.concernLevel} | ${ne.confidence} | ${n} | ${applied} | ${after} | ${delta} |`,
    );
  }

  console.log(lines.join('\n'));
}

main();
