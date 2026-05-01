import { describe, it, expect } from 'vitest';
import { applyMagnetTuning, defaultTuningProfile, validateTuningProfile } from '../canonical/magnet-tuning';
import { classifyCanonicalMagnet } from '../canonical/magnet-registry';
import type { MagnetItem } from '../types';

function canonMagnet(family: any): MagnetItem {
  return {
    categoryId: 'attraction',
    categoryLabel: 'attraction',
    icon: '',
    name: 'X',
    lat: 0,
    lon: 0,
    distance: 600,
    weight: 1,
    permanenceType: 'permanent',
    scopeLevel: 'city',
    strengthClass: 'medium',
    attractionScore: 0,
    canonicalType: family,
    canonicalMapping: {
      confidence: 0.6,
      matchedBy: 'nameFallback',
      ambiguous: true,
      ambiguityReasons: ['test'],
      warnings: ['test'],
      normalizedTags: {},
      source: 'test',
    },
  };
}

describe('magnet tuning (safe bounded multipliers)', () => {
  it('valid multipliers adjust contribution within bounds', () => {
    const canonical = classifyCanonicalMagnet({ magnet: canonMagnet('office_cluster') });
    const base = 10;
    const out = applyMagnetTuning(
      { canonical, baseContribution: base, confidence01: 1 },
      { ...defaultTuningProfile, localDemandMultiplier: 1.2 },
    );
    expect(out.tunedContribution).toBeGreaterThan(base);
    expect(out.tunedContribution).toBeLessThanOrEqual(base * 1.25);
  });

  it('invalid multipliers are clamped', () => {
    const { profile, warnings } = validateTuningProfile({ localDemandMultiplier: 999, audienceFitMultiplier: -3 } as any);
    expect(profile.localDemandMultiplier).toBeLessThanOrEqual(1.25);
    expect(profile.audienceFitMultiplier).toBeGreaterThanOrEqual(0.75);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('tuning cannot promote museum/theater/tourist_attraction to Tier-1 credit', () => {
    for (const fam of ['museum', 'theater', 'tourist_attraction'] as const) {
      const canonical = classifyCanonicalMagnet({ magnet: canonMagnet(fam) });
      expect(canonical.scoreCaps.tier1CreditMax).toBe(0);
      const out = applyMagnetTuning({ canonical, baseContribution: 10, confidence01: 1 }, { localDemandMultiplier: 1.25 });
      // Contribution may change, but tier caps remain in canonical decision.
      expect(canonical.scoreCaps.tier1CreditMax).toBe(0);
      expect(out.tunedContribution).toBeLessThanOrEqual(12.5);
    }
  });

  it('tuning cannot make weak amenities prime / amplify unknowns', () => {
    const canonical = classifyCanonicalMagnet({ magnet: canonMagnet('weak_amenity') });
    const base = 5;
    const out = applyMagnetTuning(
      { canonical, baseContribution: base, confidence01: 0.2, unknownOrAmbiguous: true },
      { localDemandMultiplier: 1.25, confidencePenaltyMultiplier: 1.35 },
    );
    expect(out.tunedContribution).toBeLessThanOrEqual(base);
  });

  it('tuning cannot change canonical type or override audience eligibility', () => {
    const magnet = canonMagnet('hospital');
    const canonical = classifyCanonicalMagnet({ magnet });
    const out = applyMagnetTuning({ canonical, baseContribution: 10 }, { audienceFitMultiplier: 1.1 });
    expect(canonical.family).toBe('hospital');
    expect(canonical.audiences.medical).toBe(true);
    expect(out.tunedContribution).toBeGreaterThan(0);
  });

  it('tuning cannot bypass anti-signals', () => {
    // Use a weak-local attraction anti-signal path: museum of a factory-like name.
    const m = canonMagnet('museum');
    m.name = 'Музей истории завода';
    const canonical = classifyCanonicalMagnet({ magnet: m });
    expect(canonical.antiSignals.length).toBeGreaterThan(0);
    const out = applyMagnetTuning({ canonical, baseContribution: 10, confidence01: 0.4, unknownOrAmbiguous: true }, { localDemandMultiplier: 1.25 });
    // The decision still contains antiSignals; tuning only adjusts numeric contribution with clamps.
    expect(canonical.antiSignals.length).toBeGreaterThan(0);
    expect(out.tunedContribution).toBeLessThanOrEqual(10);
  });
});

