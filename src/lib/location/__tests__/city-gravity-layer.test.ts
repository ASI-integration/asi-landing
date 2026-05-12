import { describe, it, expect } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';
import { buildLocationDecision } from '../location-decision-kernel';

const ORIGIN = { lat: 60.7267, lon: 33.5431 }; // Lodeynoye Pole-ish coords for distance determinism

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return {
    type: 'node',
    id,
    lat: ORIGIN.lat + dLat,
    lon: ORIGIN.lon + dLon,
    tags,
  };
}

function decisionForCity(inputAddress: string, elements: OSMElement[]) {
  const analysis = buildAnalysis(elements, ORIGIN.lat, ORIGIN.lon, {
    spatialFoundation: false,
    inputAddress,
  });
  const projected = enrichAnalysisWithReportProjection(analysis, {
    reportMode: 'free',
    rawElements: elements,
  });
  const trace = projected.scoringTrace;
  if (!trace?.coordinates) throw new Error('missing scoringTrace.coordinates');
  return buildLocationDecision({
    analysis: projected,
    inputAddress,
    coordinates: trace.coordinates,
    rawElements: elements,
    selectedGeocodeResult: inputAddress,
    locale: 'ru',
  });
}

const basePoiElements: OSMElement[] = [
  node(1, 0.0015, 0.0008, {
    amenity: 'hospital',
    name: 'Городская клиническая больница',
  }),
  node(2, 0.0018, -0.0009, {
    tourism: 'attraction',
    name: 'МКУ Лодейнопольский центр ремесел',
  }),
  node(3, -0.0012, -0.0016, {
    man_made: 'works',
    name: 'Завод',
  }),
];

describe('city gravity layer (deterministic cityScale + populationTier)', () => {
  it('A: micro/small city without flags — local hospital + local museum + generic plant stay weak', () => {
    const d = decisionForCity('Лодейное Поле, тестовая улица', basePoiElements);
    const s = d.publicSummary!;
    expect(s.cityScale).toBe('micro_city');
    expect(s.primaryDemandType === 'medical').toBe(false);
    expect(s.primaryDemandType === 'tourist').toBe(false);
    expect(['weak/unclear', 'mixed'] as const).toContain(s.primaryDemandType);

    const kernel = d.demandKernelV1!;
    // No tier-1 promotion for weak/local POIs in micro cities.
    expect(kernel.scoredDrivers.every(x => x.resolvedTier !== 1)).toBe(true);
    expect(s.finalScore).not.toBeNull();
    expect(s.finalScore!).toBeLessThanOrEqual(58);
  });

  it('B: million-plus city — same POIs can score higher, but generic museum/plant never become public drivers', () => {
    const d = decisionForCity('Новосибирск, тестовая улица', basePoiElements);
    const s = d.publicSummary!;
    const kernel = d.demandKernelV1!;

    expect(s.cityScale).toBe('million_plus');
    expect(s.finalScore).not.toBeNull();
    // City gravity cap must not be forced down to micro-city values.
    expect(kernel.cityGravityScoreCapGuard?.applied ?? false).toBe(false);

    const publicDriverTexts = s.publicDrivers.map(x => x.textRu).join('\n').toLowerCase();
    // Local museum / generic plant must remain non-public.
    expect(publicDriverTexts).not.toMatch(/ремесел/i);
    expect(publicDriverTexts).not.toMatch(/\bзавод\b/i);

    // Strong medical anchor can surface in million-plus cities.
    expect(publicDriverTexts).toMatch(/больниц|больница/i);
  });

  it('C: small resort exception — tourist headline can rise only when resort_exception exists', () => {
    const d = decisionForCity('Ялта, тестовая улица', basePoiElements);
    const s = d.publicSummary!;
    expect(s.cityScale).toBe('small_city');
    expect(s.specialMarketFlags).toContain('resort_exception');

    expect(['tourist', 'mixed'] as const).toContainEqual(s.primaryDemandType);
    expect(s.primaryDemandType === 'tourist' || /туристическ|событийн|досугов/i.test(s.headlineRu)).toBe(true);
  });

  it('D: unknown cityScale — conservative caps apply', () => {
    const d = decisionForCity('Неизвестный город, тестовая улица', basePoiElements);
    const s = d.publicSummary!;
    expect(s.cityScale).toBe('unknown');
    expect(s.populationTier).toBe('unknown');

    // Should be capped conservatively (no optimistic lift for unknown city scale).
    expect(s.finalScore).not.toBeNull();
    expect(s.finalScore!).toBeLessThanOrEqual(62);
    const guard = d.demandKernelV1?.cityGravityScoreCapGuard;
    if (guard?.applied) expect(s.scoreCapReason).toMatch(/city_gravity_cap:applied/);
    else expect(s.scoreCapReason).toBeNull();

    const kernel = d.demandKernelV1!;
    expect(kernel.scoredDrivers.every(x => x.resolvedTier !== 1)).toBe(true);
    expect(kernel.warnings.some(w => w.includes('city_scale_unknown_conservative_cap'))).toBe(true);
  });
});

