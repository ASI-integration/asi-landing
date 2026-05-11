import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('location scoring golden magnet fixtures (non-live)', () => {
  it('strong_city_center: metro + museum + named office cluster', () => {
    const els: OSMElement[] = [
      node(1, 0.0018, 0.0011, {
        railway: 'subway',
        station: 'subway',
        interchange: 'yes',
        name: 'Fixture Metro Hub',
      }),
      node(2, 0.002, 0.0018, { tourism: 'museum', name: 'Fixture Museum' }),
      node(3, 0.0024, 0.0012, { office: 'yes', name: 'Fixture Business Tower' }),
      node(4, 0.0022, 0.0014, { shop: 'mall', name: 'Fixture Mall' }),
    ];
    const { scoringTrace } = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(scoringTrace!.finalScore).toBeGreaterThanOrEqual(72);
    expect(scoringTrace!.finalScore).toBeLessThanOrEqual(96);
  });

  it('medium_urban: university + mall + regional rail', () => {
    const els: OSMElement[] = [
      node(90, 0.0022, 0.0019, { railway: 'subway', station: 'subway', name: 'Fixture Metro Link' }),
      node(1, 0.004, 0.003, { university: 'yes', name: 'Fixture University' }),
      node(2, 0.0045, 0.0035, { shop: 'mall', name: 'Fixture Shopping Mall' }),
      node(3, 0.0055, 0.004, { railway: 'station', name: 'Fixture City Station' }),
      node(4, 0.0048, 0.0045, { tourism: 'hotel', stars: '4', name: 'Fixture Marriott' }),
    ];
    const { scoringTrace } = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(scoringTrace!.finalScore).toBeGreaterThanOrEqual(40);
    expect(scoringTrace!.finalScore).toBeLessThanOrEqual(82);
  });

  it('weak_low_demand: sparse local retail only', () => {
    const els: OSMElement[] = [
      node(1, 0.012, 0.011, { shop: 'convenience', name: 'Fixture Mini Market' }),
      node(2, 0.0121, 0.0111, { amenity: 'cafe', name: 'Fixture Cafe' }),
    ];
    const { scoringTrace } = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(scoringTrace!.finalScore).toBeGreaterThanOrEqual(18);
    expect(scoringTrace!.finalScore).toBeLessThanOrEqual(48);
  });

  it('near_major_hospital: full-service hospital + supporting offices', () => {
    const els: OSMElement[] = [
      node(1, 0.003, 0.0025, { amenity: 'hospital', name: 'Fixture City Hospital' }),
      node(2, 0.0034, 0.0024, { office: 'yes', name: 'Fixture Medical Offices' }),
      node(3, 0.004, 0.003, { shop: 'mall', name: 'Fixture Retail Pod' }),
    ];
    const { scoringTrace } = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(scoringTrace!.finalScore).toBeGreaterThanOrEqual(48);
    expect(scoringTrace!.finalScore).toBeLessThanOrEqual(92);
  });

  it('near_local_medical: small surgery clinic without major anchor mix', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.0035, {
        amenity: 'clinic',
        healthcare: 'surgery',
        name: 'Fixture Surgery Clinic',
      }),
      node(2, 0.0045, 0.004, { shop: 'supermarket', name: 'Fixture Market' }),
    ];
    const { scoringTrace } = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(scoringTrace!.finalScore).toBeLessThan(88);
    expect(scoringTrace!.finalScore).toBeGreaterThanOrEqual(18);
  });

  it('near_major_transport_hub: distant strategic rail hub + weak local retail', () => {
    const els: OSMElement[] = [
      node(1, 0.022, 0.004, { railway: 'station', name: 'Fixture Regional Rail Hub' }),
      node(2, 0.0015, 0.0012, { shop: 'supermarket', name: 'Fixture Neighborhood Shop' }),
      node(3, 0.0022, 0.0018, { office: 'yes', name: 'Fixture Nearby Offices' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(analysis.strategicTransportHubMagnets?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(analysis.scoringTrace!.finalScore).toBeGreaterThanOrEqual(20);
    expect(analysis.scoringTrace!.finalScore).toBeLessThanOrEqual(88);
  });

  it('near_local_rail_metro_only: walkable metro + commuter rail without strategic halo', () => {
    const els: OSMElement[] = [
      node(1, 0.0028, 0.0022, { railway: 'subway', station: 'subway', name: 'Fixture Local Metro' }),
      node(2, 0.004, 0.003, { railway: 'station', name: 'Fixture Commuter Stop' }),
      node(3, 0.0035, 0.0038, { amenity: 'cafe', name: 'Fixture Corner Cafe' }),
    ];
    const { scoringTrace } = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(scoringTrace!.finalScore).toBeGreaterThanOrEqual(38);
    expect(scoringTrace!.finalScore).toBeLessThanOrEqual(82);
  });
});
