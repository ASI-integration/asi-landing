import { describe, it, expect } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { patchLegacyLocationAnalysis } from '../foot-traffic';

describe('patchLegacyLocationAnalysis strategic hub healing', () => {
  it('derives strategicTransportHubMagnets from magnets when legacy cache omitted the array', () => {
    const korzunLat = 59.8369;
    const korzunLon = 30.3178;
    const metro: OSMElement = {
      type: 'node',
      id: 1,
      lat: korzunLat + 0.004,
      lon: korzunLon + 0.004,
      tags: { name: 'Тестовая', station: 'subway', railway: 'station' },
    };
    const pulkovoOsm: OSMElement = {
      type: 'node',
      id: 99,
      lat: 59.800278,
      lon: 30.262503,
      tags: { aeroway: 'aerodrome', name: 'Пулково' },
    };
    const full = buildAnalysis([metro, pulkovoOsm], korzunLat, korzunLon);
    const legacyLike = {
      ...full,
      strategicTransportHubMagnets: [] as typeof full.strategicTransportHubMagnets,
    };
    const patched = patchLegacyLocationAnalysis(legacyLike);
    expect(patched.strategicTransportHubMagnets?.some(m => m.subType === 'airport')).toBe(true);
  });
});
