import { describe, it, expect } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';
import { accessVerdictRu } from '../explanation';
import {
  STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M,
  STRATEGIC_TRANSPORT_SECONDARY_RADIUS_M,
  STRATEGIC_TRANSPORT_FETCH_RADIUS_M,
} from '../strategic-transport-hub';
import { CATEGORY_RADIUS } from '../config';

describe('strategicTransportHub extended-radius hubs', () => {
  /** ~ ул. Солдата Корзуна 12к — anchors Пулково ~6.5 км от точки */
  const korzunLat = 59.8369;
  const korzunLon = 30.3178;

  const pulkovoOsm: OSMElement = {
    type: 'node',
    id: 99,
    lat: 59.800278,
    lon: 30.262503,
    tags: { aeroway: 'aerodrome', name: 'Пулково' },
  };

  it('places aerodrome beyond primary radius into strategicTransportHub (not airport category)', () => {
    const analysis = buildAnalysis([pulkovoOsm], korzunLat, korzunLon);
    expect(analysis.magnets.some(m => m.categoryId === 'airport')).toBe(false);
    const hub = analysis.magnets.find(m => m.categoryId === 'strategicTransportHub');
    expect(hub).toBeTruthy();
    expect(hub!.subType).toBe('airport');
    expect(hub!.distance).toBeGreaterThan(STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M);
    expect(hub!.distance).toBeLessThanOrEqual(STRATEGIC_TRANSPORT_FETCH_RADIUS_M);
    expect(hub!.strategicReachBand).toBe('strategic');
  });

  it('does not treat distant hub as pedestrian magnet (access verdict)', () => {
    const analysis = buildAnalysis([pulkovoOsm], korzunLat, korzunLon);
    const hub = analysis.magnets.find(m => m.categoryId === 'strategicTransportHub');
    expect(hub).toBeTruthy();
    expect(accessVerdictRu(hub!.distance)).toBe('не пешая доступность');
  });

  it('does not give excessive evergreen lift vs close metro baseline (remote-airport-only stays modest)', () => {
    const metro: OSMElement = {
      type: 'node',
      id: 1,
      lat: korzunLat + 0.004,
      lon: korzunLon + 0.004,
      tags: { name: 'Тестовая', station: 'subway', railway: 'station' },
    };
    const baseline = buildAnalysis([metro], korzunLat, korzunLon);
    const withFarAirport = buildAnalysis([metro, pulkovoOsm], korzunLat, korzunLon);
    const delta = withFarAirport.evergreenIndex - baseline.evergreenIndex;
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThanOrEqual(12);
  });

  it('keeps airport within primary radius as ordinary airport magnet', () => {
    const closeAir: OSMElement = {
      type: 'node',
      id: 2,
      lat: korzunLat + 0.003,
      lon: korzunLon + 0.003,
      tags: { aeroway: 'aerodrome', name: 'Малый аэродром' },
    };
    const analysis = buildAnalysis([closeAir], korzunLat, korzunLon);
    expect(analysis.magnets.some(m => m.categoryId === 'airport')).toBe(true);
    expect(analysis.magnets.some(m => m.categoryId === 'strategicTransportHub')).toBe(false);
  });

  it('local magnet Overpass radii stay tight — food fetch radius not aligned with strategic hub fetch', () => {
    expect(CATEGORY_RADIUS.food).toBeLessThan(STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M);
    expect(STRATEGIC_TRANSPORT_FETCH_RADIUS_M).toBeGreaterThan(CATEGORY_RADIUS.metro);
  });

  it('places harbour / port landuse in strategicTransportHub secondary band (~2–5 km)', () => {
    const harbour: OSMElement = {
      type: 'way',
      id: 77,
      center: { lat: korzunLat, lon: korzunLon + 0.071 },
      tags: { landuse: 'harbour', name: 'Тестовая гавань' },
    };
    const analysis = buildAnalysis([harbour], korzunLat, korzunLon);
    const hub = analysis.magnets.find(m => m.categoryId === 'strategicTransportHub' && m.subType === 'port');
    expect(hub).toBeTruthy();
    expect(hub!.distance).toBeGreaterThan(STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M);
    expect(hub!.distance).toBeLessThanOrEqual(STRATEGIC_TRANSPORT_SECONDARY_RADIUS_M);
    expect(hub!.strategicReachBand).toBe('secondary');
    expect(accessVerdictRu(hub!.distance)).toBe('не пешая доступность');
  });

  it('records low_priority in magnetDiagnostics when strategic hubs exceed category max show', () => {
    const hubs: OSMElement[] = [
      {
        type: 'node',
        id: 81,
        lat: korzunLat + 0.025,
        lon: korzunLon + 0.02,
        tags: { aeroway: 'aerodrome', name: 'Аэродром Альфа' },
      },
      {
        type: 'node',
        id: 82,
        lat: korzunLat + 0.028,
        lon: korzunLon + 0.023,
        tags: { aeroway: 'aerodrome', name: 'Аэродром Бета' },
      },
      {
        type: 'node',
        id: 83,
        lat: korzunLat + 0.031,
        lon: korzunLon + 0.026,
        tags: { aeroway: 'aerodrome', name: 'Аэродром Гамма' },
      },
    ];
    const analysis = buildAnalysis(hubs, korzunLat, korzunLon);
    expect(analysis.magnets.filter(m => m.categoryId === 'strategicTransportHub').length).toBe(2);
    expect(
      analysis.magnetDiagnostics?.suppressedMagnets.some(
        s => s.reason === 'low_priority' && s.detail?.startsWith('category_max_show'),
      ),
    ).toBe(true);
  });

  it('preserves metro magnet radius behaviour for nearby subway stations', () => {
    const metro: OSMElement = {
      type: 'node',
      id: 4,
      lat: korzunLat + 0.002,
      lon: korzunLon + 0.002,
      tags: { name: 'Метро Локальное', station: 'subway', railway: 'station' },
    };
    const analysis = buildAnalysis([metro], korzunLat, korzunLon);
    expect(analysis.magnets.some(m => m.categoryId === 'metro')).toBe(true);
    expect(CATEGORY_RADIUS.metro).toBeLessThan(STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M);
  });
});
