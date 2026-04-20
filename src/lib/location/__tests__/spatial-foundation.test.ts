import { describe, it, expect } from 'vitest';
import type { OSMElement, MagnetItem } from '../types';
import {
  stubBarrierMultiplierForMagnet,
  closestPointOnSegmentPlanar,
  applySpatialFoundationLayer,
  collectBarrierSamples,
} from '../spatial-foundation';
import { calcMagnetAttraction } from '../gravity-scoring';

function offsetNorthMeters(lat: number, lon: number, meters: number): { lat: number; lon: number } {
  return { lat: lat + meters / 110_540, lon };
}

describe('spatial foundation v1 (stub)', () => {
  it('layout A: water sample on the subject→magnet segment applies strong dampening (≥35% attraction loss)', () => {
    const subjectLat = 55.751;
    const subjectLon = 37.618;
    const magnet = offsetNorthMeters(subjectLat, subjectLon, 620);
    const mid = offsetNorthMeters(subjectLat, subjectLon, 310);

    const barriers = [{ lat: mid.lat, lon: mid.lon, kind: 'water' as const }];
    const { mult } = stubBarrierMultiplierForMagnet({
      subjectLat,
      subjectLon,
      magnet: { lat: magnet.lat, lon: magnet.lon, distance: 620 },
      barriers,
    });

    expect(mult).toBeLessThanOrEqual(0.4);
    const base = calcMagnetAttraction(8, 'permanent', 620);
    const damped = calcMagnetAttraction(8, 'permanent', 620) * mult;
    expect(damped / base).toBeLessThan(0.65);
  });

  it('layout B: barrier far off the ray does not dampen', () => {
    const subjectLat = 55.751;
    const subjectLon = 37.618;
    const magnet = offsetNorthMeters(subjectLat, subjectLon, 640);
    const side = { lat: subjectLat + 0.004, lon: subjectLon + 0.006 };

    const { mult } = stubBarrierMultiplierForMagnet({
      subjectLat,
      subjectLon,
      magnet: { lat: magnet.lat, lon: magnet.lon, distance: 640 },
      barriers: [{ lat: side.lat, lon: side.lon, kind: 'water' }],
    });

    expect(mult).toBe(1);
  });

  it('layout C: rail on the segment applies rail-class dampening', () => {
    const subjectLat = 59.934;
    const subjectLon = 30.335;
    const magnet = offsetNorthMeters(subjectLat, subjectLon, 580);
    const mid = offsetNorthMeters(subjectLat, subjectLon, 290);

    const { mult } = stubBarrierMultiplierForMagnet({
      subjectLat,
      subjectLon,
      magnet: { lat: magnet.lat, lon: magnet.lon, distance: 580 },
      barriers: [{ lat: mid.lat, lon: mid.lon, kind: 'rail' }],
    });

    expect(mult).toBeLessThanOrEqual(0.55);
    const base = calcMagnetAttraction(7, 'permanent', 580);
    const damped = calcMagnetAttraction(7, 'permanent', 580) * mult;
    expect(damped / base).toBeLessThan(0.8);
  });

  it('closestPointOnSegmentPlanar places midpoint on northbound segment at t≈0.5 with low cross-track', () => {
    const sLat = 55.0;
    const sLon = 37.0;
    const m = offsetNorthMeters(sLat, sLon, 500);
    const mid = offsetNorthMeters(sLat, sLon, 250);
    const { t, crossTrackM } = closestPointOnSegmentPlanar(sLat, sLon, m.lat, m.lon, mid.lat, mid.lon);
    expect(t).toBeGreaterThan(0.45);
    expect(t).toBeLessThan(0.55);
    expect(crossTrackM).toBeLessThan(5);
  });

  it('applySpatialFoundationLayer marks barrier_penalty_applied when OSM water lies on path', () => {
    const subjectLat = 55.752;
    const subjectLon = 37.62;
    const magnetPos = offsetNorthMeters(subjectLat, subjectLon, 600);
    const mid = offsetNorthMeters(subjectLat, subjectLon, 300);

    const elements: OSMElement[] = [
      { type: 'node', id: 9001, lat: mid.lat, lon: mid.lon, tags: { natural: 'water' } },
    ];

    const baseMag: MagnetItem = {
      categoryId: 'attraction',
      categoryLabel: 'Test',
      icon: 'T',
      name: 'Far anchor',
      subType: undefined,
      lat: magnetPos.lat,
      lon: magnetPos.lon,
      distance: 600,
      weight: 8,
      permanenceType: 'permanent',
      scopeLevel: 'city',
      strengthClass: 'strong',
      attractionScore: calcMagnetAttraction(8, 'permanent', 600),
    };

    const magnets: MagnetItem[] = [{ ...baseMag }];
    const before = magnets[0].attractionScore;

    const snap = applySpatialFoundationLayer({
      magnets,
      elements,
      subjectLat,
      subjectLon,
      enabled: true,
    });

    expect(snap.barrierPenaltyApplied).toBe(true);
    expect(magnets[0].attractionScore).toBeLessThan(before * 0.7);
  });

  it('collectBarrierSamples recognises water + rail tags', () => {
    const els: OSMElement[] = [
      { type: 'node', id: 1, lat: 1, lon: 2, tags: { natural: 'water' } },
      { type: 'way', id: 2, center: { lat: 1.01, lon: 2 }, tags: { railway: 'rail' } },
      { type: 'node', id: 3, lat: 1.02, lon: 2, tags: { highway: 'bus_stop' } },
    ];
    const b = collectBarrierSamples(els);
    expect(b.some(x => x.kind === 'water')).toBe(true);
    expect(b.some(x => x.kind === 'rail')).toBe(true);
  });
});
