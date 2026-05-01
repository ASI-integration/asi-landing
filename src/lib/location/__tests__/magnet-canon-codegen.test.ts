import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  GENERATED_MAGNET_REGISTRY,
  CANONICAL_MAGNET_TYPES,
} from '../canonical/magnet-registry';
import {
  loadMagnetCanonJson,
  validateMagnetCanon,
} from '../canonical/magnet-canon.schema';

function repoPath(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

describe('magnet canon codegen pipeline', () => {
  it('generated registry file exists on disk', () => {
    const p = repoPath('src', 'lib', 'location', 'canonical', 'generated-magnet-registry.ts');
    expect(fs.existsSync(p)).toBe(true);
    const s = fs.readFileSync(p, 'utf8');
    expect(s).toContain('AUTO-GENERATED FILE. DO NOT EDIT.');
    expect(s).toContain('Source of truth: src/lib/location/canonical/magnet-canon.json');
  });

  it('generated registry matches magnet-canon.json (shape + values)', () => {
    const canonPath = repoPath('src', 'lib', 'location', 'canonical', 'magnet-canon.json');
    const canon = validateMagnetCanon(loadMagnetCanonJson(canonPath));

    // Same type list.
    const fromJson = [...canon.magnets].map(m => m.canonicalType).sort();
    const fromGenerated = [...CANONICAL_MAGNET_TYPES].slice().sort();
    expect(fromGenerated).toEqual(fromJson);

    // Entry-by-entry equivalence on all fields emitted by the generator.
    for (const m of canon.magnets) {
      expect(GENERATED_MAGNET_REGISTRY[m.canonicalType]).toEqual(m);
    }
  });

  it('magnet-registry.ts is a pure facade (no manual magnet definitions)', () => {
    const p = repoPath('src', 'lib', 'location', 'canonical', 'magnet-registry.ts');
    const s = fs.readFileSync(p, 'utf8');
    expect(s).toContain("export * from './generated-magnet-registry'");
    expect(s).not.toMatch(/CANONICAL_MAGNET_REGISTRY\s*=/);
    expect(s).not.toMatch(/railway_station\s*:/);
    expect(s).not.toMatch(/aliases\s*:/);
  });

  it('museum/theater/tourist_attraction are capped below Tier-1 by default', () => {
    const m = GENERATED_MAGNET_REGISTRY.museum;
    const t = GENERATED_MAGNET_REGISTRY.theater;
    const a = GENERATED_MAGNET_REGISTRY.tourist_attraction;
    for (const x of [m, t, a]) {
      expect(x.maxTier).not.toBe(1);
      expect(x.residentialEligibility.maxTier).not.toBe(1);
      expect(x.scoringCaps.tier1CreditMax).toBe(0);
    }
  });

  it('weak/tertiary amenities cannot become prime magnets', () => {
    const weak = GENERATED_MAGNET_REGISTRY.weak_amenity;
    const tertiary = GENERATED_MAGNET_REGISTRY.tertiary_local_amenity;
    for (const x of [weak, tertiary]) {
      expect(x.residentialEligibility.primeEligible).toBe(false);
      expect(x.maxTier).toBe(3);
      expect(x.residentialEligibility.maxTier).toBe(3);
      expect(x.scoringCaps.tier1CreditMax).toBe(0);
    }
  });

  it('scoring/explanation must consume canonical classifier via magnet-registry facade', () => {
    const scoringPath = repoPath('src', 'lib', 'location', 'audience-scoring.ts');
    const explanationPath = repoPath('src', 'lib', 'location', 'explanation.ts');
    const scoring = fs.readFileSync(scoringPath, 'utf8');
    const explanation = fs.readFileSync(explanationPath, 'utf8');

    expect(scoring).toContain("from './canonical/magnet-registry'");
    expect(scoring).toContain('classifyCanonicalMagnet');

    expect(explanation).toContain("from './canonical/magnet-registry'");
    expect(explanation).toContain('classifyCanonicalMagnet');
  });
});

