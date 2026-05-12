import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { inferCityScaleFromRuAddress } from '../city-scale-from-address';
import { buildLocationDecision } from '../location-decision-kernel';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

/** Dense metro + retail + offices — pushes composite engine score clearly above satellite baseline cap. */
function murinoStyleDenseResidentialMagnets(): OSMElement[] {
  return [
    node(1, 0.0018, 0.0011, {
      railway: 'subway',
      station: 'subway',
      interchange: 'yes',
      name: 'Fixture Metro Devyatkino',
    }),
    node(2, 0.002, 0.0018, { tourism: 'museum', name: 'Fixture Local Museum' }),
    node(3, 0.0024, 0.0012, { office: 'yes', name: 'Fixture BC Oboronnaya' }),
    node(4, 0.0022, 0.0014, { shop: 'mall', name: 'Fixture District Mall' }),
    node(5, 0.0015, 0.0016, { shop: 'supermarket', name: 'Fixture Лента' }),
    node(6, 0.0016, 0.00155, { shop: 'convenience', name: 'Fixture Пятёрочка' }),
    node(7, 0.00155, 0.00162, { amenity: 'cafe', name: 'Fixture Coffee' }),
    node(8, 0.00135, 0.00138, { shop: 'department_store', name: 'Fixture Department Store' }),
    node(9, 0.00142, 0.0014, { tourism: 'attraction', name: 'Fixture River Walk' }),
  ];
}

function decisionFor(address: string, elements: OSMElement[]) {
  const analysis = buildAnalysis(elements, ORIGIN.lat, ORIGIN.lon, {
    spatialFoundation: false,
    inputAddress: address,
  });
  const projected = enrichAnalysisWithReportProjection(analysis, {
    reportMode: 'free',
    rawElements: elements,
  });
  const trace = projected.scoringTrace;
  if (!trace?.coordinates) throw new Error('missing scoringTrace.coordinates');
  return buildLocationDecision({
    analysis: projected,
    inputAddress: address,
    coordinates: trace.coordinates,
    rawElements: elements,
    selectedGeocodeResult: address,
    locale: 'ru',
  });
}

describe('RU market context — satellite commuter suburbs', () => {
  it('Murino wins over Санкт-Петербург substring: no mega_city gravity', () => {
    const addr = 'Санкт-Петербург, Ленинградская область, Мурино, Оборонная ул., 37к1';
    const inf = inferCityScaleFromRuAddress(addr);
    expect(inf.cityScale).toBe('medium_city');
    expect(inf.marketGravityCoefficient).toBe(0.85);
    expect(inf.ruMarketContext?.marketType).toBe('satellite_commuter_suburb');
    expect(inf.ruMarketContext?.normalizedName).toBe('Мурино');
    expect(inf.inferredFrom.startsWith('ru_market_context:')).toBe(true);
  });

  it('Kudrovo + SPB prefix still resolves satellite market context', () => {
    const inf = inferCityScaleFromRuAddress('СПб, Кудрово, Европейский пр., 1');
    expect(inf.ruMarketContext?.normalizedName).toBe('Кудрово');
    expect(inf.marketGravityCoefficient).toBe(0.85);
  });

  it('Murino-style metro + retail + dense residential: headline ≤ 75 without verified major anchors', () => {
    const addr = 'Мурино, Оборонная 37 к1';
    const els = murinoStyleDenseResidentialMagnets();
    const d = decisionFor(addr, els);
    const engine = d.scoreTrace?.finalScore ?? 0;
    expect(engine).toBeGreaterThan(75);
    expect(d.finalScore).not.toBeNull();
    expect(d.finalScore!).toBeLessThanOrEqual(75);
    const diag = d.demandKernelV1?.marketContextDiagnostics;
    expect(diag?.marketType).toBe('satellite_commuter_suburb');
    if ((diag?.scoreBeforeMarketCap ?? 0) > 75) {
      expect(diag?.capApplied).toBe(true);
    }
    expect(diag?.scoreAfterMarketCap).toBeLessThanOrEqual(75);
  });

  it('verified major education anchor can lift Murino headline above baseline cap', () => {
    const addr = 'Ленинградская область, Мурино, Оборонная 37 к1';
    const els = [
      ...murinoStyleDenseResidentialMagnets(),
      node(80, 0.0025, 0.0022, {
        amenity: 'university',
        name: 'Фикстура Политехнический институт',
      }),
    ];
    const d = decisionFor(addr, els);
    expect(d.finalScore).not.toBeNull();
    expect(d.finalScore!).toBeGreaterThan(75);
    expect(d.finalScore!).toBeLessThanOrEqual(88);
    expect(d.demandKernelV1?.marketContextDiagnostics?.marketType).toBe('satellite_commuter_suburb');
  });

  it('two verified major education anchors can reach 90+ band (lifted cap)', () => {
    const addr = 'Мурино, Оборонная 37 к1';
    const els = [
      ...murinoStyleDenseResidentialMagnets(),
      node(80, 0.0025, 0.0022, {
        amenity: 'university',
        name: 'Фикстура Политехнический институт Север',
      }),
      node(81, 0.0028, 0.0025, {
        amenity: 'university',
        name: 'Фикстура Государственный университет Юг',
      }),
    ];
    const d = decisionFor(addr, els);
    expect(d.finalScore).not.toBeNull();
    expect(d.finalScore!).toBeGreaterThanOrEqual(88);
    expect(d.finalScore!).toBeLessThanOrEqual(96);
  });

  it('metro + retail alone cannot justify 90+ on satellite belt (capped)', () => {
    const addr = 'Новое Девяткино, ул. Тестовая 1';
    const d = decisionFor(addr, murinoStyleDenseResidentialMagnets());
    expect(d.finalScore).not.toBeNull();
    expect(d.finalScore!).toBeLessThan(90);
  });
});
