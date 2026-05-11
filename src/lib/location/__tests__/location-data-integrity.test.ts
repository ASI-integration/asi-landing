import { describe, it, expect } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { getBand } from '../explanation';
import {
  applyLocationDataIntegrityGate,
  evaluateLocationDataIntegrity,
  cacheEntryPassesDataIntegrity,
  locationDemoPresentationBlocked,
  LOCATION_DEMO_INCOMPLETE_RU,
} from '../location-data-integrity';

/** SPB bbox sample */
const SPB_LAT = 59.965;
const SPB_LON = 30.31;

describe('location-data-integrity', () => {
  it('empty OSM with provider failure blocks headline score and marks incomplete', () => {
    const analysis = buildAnalysis([], SPB_LAT, SPB_LON);
    applyLocationDataIntegrityGate(analysis, {
      lat: SPB_LAT,
      lon: SPB_LON,
      rawObjectsCount: 0,
      hadProviderFailure: true,
      cacheServed: false,
    });
    expect(analysis.analysisIntegrity?.analysisIncomplete).toBe(true);
    expect(analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData).toBe(true);
    expect(analysis.locationScore?.location_score).toBe(0);
    expect(analysis.evergreenIndex).toBe(0);
    expect(analysis.scoringTrace?.integrity?.scoreBlockedDueToIncompleteData).toBe(true);
    expect(analysis.scoringTrace?.warnings).toContain('score_blocked_due_to_incomplete_data');
  });

  it('evaluateLocationDataIntegrity marks analysisIncomplete for empty raw + failure', () => {
    const r = evaluateLocationDataIntegrity({
      lat: SPB_LAT,
      lon: SPB_LON,
      rawObjectsCount: 0,
      hadProviderFailure: true,
      classifiedMagnetCount: 0,
    });
    expect(r.analysisComplete).toBe(false);
    expect(r.scoreBlockedDueToIncompleteData).toBe(true);
  });

  it('does not cache-complete poisoned urban rows with zero elements', () => {
    const analysis = buildAnalysis([], SPB_LAT, SPB_LON);
    applyLocationDataIntegrityGate(analysis, {
      lat: SPB_LAT,
      lon: SPB_LON,
      rawObjectsCount: 0,
      hadProviderFailure: false,
      cacheServed: false,
    });
    expect(
      cacheEntryPassesDataIntegrity({
        elementsCount: 0,
        lat: SPB_LAT,
        lon: SPB_LON,
        analysis,
      }),
    ).toBe(false);
  });

  it('genuinely weak rural fixture with live OSM-shaped input stays complete (low score allowed)', () => {
    const ruralLat = 51.12;
    const ruralLon = 39.42;
    const weakDental: OSMElement = {
      type: 'node',
      id: 203,
      lat: ruralLat + 0.001,
      lon: ruralLon + 0.001,
      tags: { amenity: 'dentist', name: 'Стоматология «Улыбка»' },
    };
    const analysis = buildAnalysis([weakDental], ruralLat, ruralLon);
    applyLocationDataIntegrityGate(analysis, {
      lat: ruralLat,
      lon: ruralLon,
      rawObjectsCount: 1,
      hadProviderFailure: false,
      cacheServed: false,
    });
    expect(analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData).toBe(false);
    expect(analysis.locationScore?.location_score ?? 0).toBeGreaterThan(0);
    expect(analysis.locationScore?.location_score ?? 0).toBeLessThan(45);
  });

  it('LocationScoringTrace carries integrity + magnet/raw counts when gated', () => {
    const analysis = buildAnalysis([], SPB_LAT, SPB_LON);
    applyLocationDataIntegrityGate(analysis, {
      lat: SPB_LAT,
      lon: SPB_LON,
      rawObjectsCount: 0,
      hadProviderFailure: true,
      cacheServed: false,
    });
    expect(analysis.scoringTrace?.integrity?.rawObjectsCount).toBe(0);
    expect(analysis.scoringTrace?.integrity?.classifiedMagnetsCount).toBe(0);
    expect(analysis.scoringTrace?.integrity?.providerHadFailure).toBe(true);
    expect(analysis.scoringTrace?.integrity?.analysisComplete).toBe(false);
  });

  it('demo presentation flag is false for weak-but-complete urban score band', () => {
    const metro: OSMElement = {
      type: 'node',
      id: 1,
      lat: SPB_LAT + 0.004,
      lon: SPB_LON + 0.004,
      tags: { name: 'Тестовая', station: 'subway', railway: 'station' },
    };
    const analysis = buildAnalysis([metro], SPB_LAT, SPB_LON);
    applyLocationDataIntegrityGate(analysis, {
      lat: SPB_LAT,
      lon: SPB_LON,
      rawObjectsCount: 1,
      hadProviderFailure: false,
      cacheServed: false,
    });
    expect(locationDemoPresentationBlocked(analysis)).toBe(false);
    expect(analysis.evergreenIndex).toBeGreaterThan(0);
    expect(getBand(analysis.evergreenIndex, analysis.audienceAnalysis?.primaryAudience).scoreBand).not.toBe('none');
  });

  it('RU incomplete copy must not read as the normal weak-location verdict', () => {
    expect(LOCATION_DEMO_INCOMPLETE_RU).not.toMatch(/Слабая локация/);
    expect(LOCATION_DEMO_INCOMPLETE_RU.length).toBeGreaterThan(20);
  });
});
