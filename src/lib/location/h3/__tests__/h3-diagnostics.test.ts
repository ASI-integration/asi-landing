import { describe, expect, it } from 'vitest';
import { attachLocationDecisionToAnalysis } from '../../location-decision-kernel';
import { buildAnalysis } from '../../gravity-scoring';
import type { OSMElement } from '../../types';
import type { H3DiagnosticPoi } from '..';
import { buildH3Diagnostics, buildH3DiagnosticsForAnalysis } from '..';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function poi(partial: Partial<H3DiagnosticPoi> & Pick<H3DiagnosticPoi, 'name' | 'categoryId'>): H3DiagnosticPoi {
  return {
    lat: ORIGIN.lat,
    lon: ORIGIN.lon,
    distanceMeters: 80,
    ...partial,
  };
}

describe('H3 location diagnostics', () => {
  it('assigns POIs to H3 cells', () => {
    const diagnostics = buildH3Diagnostics({
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      resolution: 9,
      pois: [
        poi({ name: 'Hospital A', categoryId: 'hospital' }),
        poi({ name: 'Office A', categoryId: 'business', lon: ORIGIN.lon + 0.0004 }),
        poi({ name: 'Metro A', categoryId: 'metro', lat: ORIGIN.lat + 0.0004 }),
      ],
    });

    expect(diagnostics.resolution).toBe(9);
    expect(diagnostics.centerCell).toBeTruthy();
    expect(diagnostics.neighboringCells.length).toBeGreaterThan(0);
    expect(diagnostics.poiCells).toHaveLength(3);
    expect(Object.values(diagnostics.poiCountByCell).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('allows configurable resolution 8/9/10 for tests', () => {
    for (const resolution of [8, 9, 10] as const) {
      const diagnostics = buildH3Diagnostics({
        lat: ORIGIN.lat,
        lon: ORIGIN.lon,
        resolution,
        pois: [poi({ name: 'Hospital A', categoryId: 'hospital' })],
      });

      expect(diagnostics.resolution).toBe(resolution);
      expect(diagnostics.centerCell).toEqual(expect.any(String));
    }
  });

  it('detects 2+ nearby medical objects as a cluster signal', () => {
    const diagnostics = buildH3Diagnostics({
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      resolution: 9,
      pois: [
        poi({ name: 'Hospital A', categoryId: 'hospital', distanceMeters: 90 }),
        poi({ name: 'Clinic B', categoryId: 'specializedMedicalAnchor', lat: ORIGIN.lat + 0.0003, distanceMeters: 120 }),
      ],
    });

    expect(diagnostics.medicalClusterScore).toBeGreaterThanOrEqual(0.48);
    expect(diagnostics.dominantClusterTypes).toContain('medical');
    expect(diagnostics.evidenceSummary.find(row => row.type === 'medical')?.poiCount).toBe(2);
  });

  it('does not treat one isolated POI as a cluster', () => {
    const diagnostics = buildH3Diagnostics({
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      pois: [poi({ name: 'Single hospital', categoryId: 'hospital', distanceMeters: 180 })],
    });

    expect(diagnostics.medicalClusterScore).toBeLessThan(0.22);
    expect(diagnostics.clusterConfidence).toBe('none');
    expect(diagnostics.dominantClusterTypes).not.toContain('medical');
    expect(diagnostics.isolatedPoiPenaltySignal).toBeGreaterThanOrEqual(0.7);
  });

  it('computes dominantClusterTypes correctly', () => {
    const diagnostics = buildH3Diagnostics({
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      pois: [
        poi({ name: 'Office A', categoryId: 'business', distanceMeters: 70 }),
        poi({ name: 'Office B', categoryId: 'business', lat: ORIGIN.lat + 0.0002, distanceMeters: 95 }),
        poi({ name: 'Convention C', categoryId: 'convention', lon: ORIGIN.lon + 0.0002, distanceMeters: 110 }),
        poi({ name: 'Metro D', categoryId: 'metro', lat: ORIGIN.lat + 0.0007, distanceMeters: 210 }),
      ],
    });

    expect(diagnostics.businessClusterScore).toBeGreaterThan(diagnostics.transportClusterScore);
    expect(diagnostics.dominantClusterTypes).toEqual(['business']);
  });

  it('diagnostics do not alter LocationDecision.finalScore', () => {
    const elements: OSMElement[] = [
      { type: 'node' as const, id: 1, lat: ORIGIN.lat + 0.0002, lon: ORIGIN.lon, tags: { amenity: 'hospital', name: 'Hospital A' } },
      { type: 'node' as const, id: 2, lat: ORIGIN.lat + 0.0003, lon: ORIGIN.lon, tags: { amenity: 'hospital', name: 'Hospital B' } },
      { type: 'node' as const, id: 3, lat: ORIGIN.lat + 0.0004, lon: ORIGIN.lon, tags: { office: 'company', name: 'Office C' } },
    ];
    const analysis = buildAnalysis(elements, ORIGIN.lat, ORIGIN.lon);
    const withDecision = attachLocationDecisionToAnalysis(analysis, {
      inputAddress: 'diagnostic fixture',
      coordinates: ORIGIN,
      rawElements: elements,
      locale: 'ru',
    });
    const decisionBefore = withDecision.locationDecision.finalScore;
    const traceBefore = analysis.scoringTrace?.finalScore ?? null;

    const diagnostics = buildH3DiagnosticsForAnalysis({ analysis, lat: ORIGIN.lat, lon: ORIGIN.lon });

    expect(diagnostics.medicalClusterScore).toBeGreaterThanOrEqual(0.48);
    expect(withDecision.locationDecision.finalScore).toBe(decisionBefore);
    expect(analysis.scoringTrace?.finalScore ?? null).toBe(traceBefore);
  });
});
