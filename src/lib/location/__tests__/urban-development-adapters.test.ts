import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  collectUrbanDevelopmentSignals,
  normalizeUrbanDevelopmentSignals,
  urbanDevelopmentSnapshotFromSignals,
} from '../data-sources/urban-development';
import { buildFullLocationReport, locationReportInputFromLegacy } from '../unified-report';

function minimalAnalysis() {
  const subject = { lat: 55.751, lon: 37.618 };
  const elements: OSMElement[] = [
    {
      type: 'node',
      id: 1,
      lat: 55.752,
      lon: 37.621,
      tags: { name: 'Fixture POI', tourism: 'hotel' },
    },
  ];
  return buildAnalysis(elements, subject.lat, subject.lon, { spatialFoundation: false });
}

describe('urban development adapter layer', () => {
  it('collector returns not_configured when no adapters exist', async () => {
    const result = await collectUrbanDevelopmentSignals({ regionOrCity: 'Test region' }, []);
    expect(result.status).toBe('not_configured');
    expect(result.signals).toEqual([]);
    expect(result.limitations).toContain(
      'Urban development source adapters are not connected yet.',
    );
    expect(result.manualVerificationNeeded).toBe(true);
  });

  it('collector returns not_configured when every adapter is disabled', async () => {
    const result = await collectUrbanDevelopmentSignals(
      { regionOrCity: 'Test region' },
      [
        {
          id: 'stub',
          kind: 'masterPlan',
          enabled: false,
          label: 'Disabled stub',
          collect: async () => [],
        },
      ],
    );
    expect(result.status).toBe('not_configured');
    expect(result.signals).toEqual([]);
  });

  it('normalize preserves evidence entries', () => {
    const evidence = [{ label: 'Doc clause ref.', detail: '§ mock section', reference: 'INTERNAL-REF-1' }];
    const [row] = normalizeUrbanDevelopmentSignals([
      {
        kind: 'zoningRules',
        signalType: 'zoning_code',
        title: 'Structural normalization probe',
        summary: 'Unit-test probe only; no municipal claims.',
        confidence: 'high',
        sourceUrl: 'https://example.com/planning/doc',
        evidence,
      },
    ]);
    expect(row.evidence).toEqual(evidence);
  });

  it('missing source URL does not crash snapshot mapping', () => {
    const normalized = normalizeUrbanDevelopmentSignals([
      {
        kind: 'planningProjects',
        title: 'Structural normalization probe',
        summary: 'Unit-test probe only.',
      },
    ]);
    expect(() => urbanDevelopmentSnapshotFromSignals(normalized)).not.toThrow();
    const snapshot = urbanDevelopmentSnapshotFromSignals(normalized);
    expect(snapshot.plannedConstructionProjects).toHaveLength(1);
    expect(snapshot.plannedConstructionProjects[0].source.url).toBeUndefined();
  });

  it('sets manualVerificationNeeded when confidence is low or primary source URL is missing', () => {
    const [low] = normalizeUrbanDevelopmentSignals([
      {
        kind: 'masterPlan',
        title: 'Structural normalization probe',
        summary: 'Probe.',
        confidence: 'low',
        sourceUrl: 'https://example.com/a',
      },
    ]);
    expect(low.manualVerificationNeeded).toBe(true);

    const [missingUrl] = normalizeUrbanDevelopmentSignals([
      {
        kind: 'masterPlan',
        title: 'Structural normalization probe',
        summary: 'Probe.',
        confidence: 'high',
      },
    ]);
    expect(missingUrl.manualVerificationNeeded).toBe(true);

    const [highWithUrl] = normalizeUrbanDevelopmentSignals([
      {
        kind: 'masterPlan',
        title: 'Structural normalization probe',
        summary: 'Probe.',
        confidence: 'high',
        sourceUrl: 'https://example.com/reliable-source',
      },
    ]);
    expect(highWithUrl.manualVerificationNeeded).toBe(false);
  });

  it('unified full report accepts an urban-development snapshot produced from normalized signals', () => {
    const normalized = normalizeUrbanDevelopmentSignals([
      {
        kind: 'infrastructurePlans',
        signalType: 'road_project',
        title: 'Structural snapshot wiring probe',
        summary: 'Unit-test probe only; not a real road project.',
        status: 'planned',
        confidence: 'medium',
        sourceUrl: 'https://example.com/source',
        evidence: [{ label: 'Citation placeholder', detail: 'Attachment id only.' }],
        limitations: ['Synthetic fixture for wiring tests.'],
      },
    ]);
    const snapshot = urbanDevelopmentSnapshotFromSignals(normalized);

    const report = buildFullLocationReport(
      locationReportInputFromLegacy({
        address: 'Test address',
        locale: 'ru',
        mode: 'residential',
      }),
      { analysis: minimalAnalysis(), urbanDevelopment: snapshot },
    );

    expect(report.signals.urbanDevelopment.roadTransportChanges).toHaveLength(1);
    expect(report.signals.urbanDevelopment.status).toBe('available');
    expect(report.signals.urbanDevelopment.evidence.length).toBeGreaterThan(0);
  });
});
