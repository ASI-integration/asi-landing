import { describe, expect, it } from 'vitest';
import type { GeocodeResult } from '../providers/types';
import { evaluateRuGeocodeCitySanity, extractRuRequestedCityToken } from '../address-providers/geocode-city-sanity';
import { inferCityScaleFromRuAddress } from '../city-scale-from-address';
import { buildAnalysis } from '../gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';
import { buildLocationDecision } from '../location-decision-kernel';

describe('geocode city sanity (RU)', () => {
  it('flags Kemerovo request vs Sosnovka locality', () => {
    const geo: GeocodeResult = {
      lat: 54.1,
      lon: 86.2,
      displayName: '2-я Луговая ул., 27, Сосновка, Россия',
      locality: 'Сосновка',
      adminArea1: 'Кемеровская область',
    };
    const r = evaluateRuGeocodeCitySanity('Кемерово, 2-я Луговая, 27', geo);
    expect(r.cityMismatch).toBe(true);
    expect(r.requestedCity).toMatch(/кемерово/i);
    expect(r.mismatchReason).toBeTruthy();
  });

  it('accepts matching locality', () => {
    const geo: GeocodeResult = {
      lat: 55.0,
      lon: 82.9,
      displayName: 'Кемерово, Россия',
      locality: 'Кемерово',
      adminArea1: 'Кемеровская область',
    };
    const r = evaluateRuGeocodeCitySanity('проспект Химиков, 32, Кемерово', geo);
    expect(r.cityMismatch).toBe(false);
  });

  it('extracts city from street-first Kemerovo addresses', () => {
    expect(extractRuRequestedCityToken('проспект Химиков, 32, Кемерово')).toMatch(/кемерово/i);
  });
});

describe('canonical cityScale table gaps', () => {
  it.each([
    ['Казань, улица Тест', 'million_plus'],
    ['Ставрополь, улица Тест', 'large_regional'],
    ['Сочи, улица Тест', 'medium_city'],
    ['Анапа, улица Тест', 'medium_city'],
    ['Владивосток, улица Тест', 'large_regional'],
    ['Норильск, улица Тест', 'medium_city'],
    ['Нижний Новгород, улица Тест', 'million_plus'],
    ['Санкт Петербург, Невский проспект', 'mega_city'],
  ] as const)('%s → %s', (addr, scale) => {
    expect(inferCityScaleFromRuAddress(addr).cityScale).toBe(scale);
  });

  it('Sochi / Anapa / Vladivostok / Norilsk carry expected special flags', () => {
    expect(inferCityScaleFromRuAddress('Сочи').specialMarketFlags).toEqual(
      expect.arrayContaining(['resort_exception', 'large_transport_hub']),
    );
    expect(inferCityScaleFromRuAddress('Анапа').specialMarketFlags).toEqual(expect.arrayContaining(['resort_exception']));
    expect(inferCityScaleFromRuAddress('Владивосток').specialMarketFlags).toEqual(
      expect.arrayContaining(['port_or_logistics_gateway']),
    );
    expect(inferCityScaleFromRuAddress('Норильск').specialMarketFlags).toEqual(
      expect.arrayContaining(['major_industrial_employer', 'shift_worker_demand']),
    );
  });
});

describe('geocode mismatch → unknown macro + warnings', () => {
  it('buildLocationDecision downgrades scale when geocode disagrees', () => {
    const elements = [
      {
        type: 'node' as const,
        id: 9_000_001,
        lat: 55.0,
        lon: 82.9,
        tags: { amenity: 'hospital', name: 'Городская клиническая больница №1' },
      },
    ];
    const analysis = buildAnalysis(elements, 55.0, 82.9, {
      spatialFoundation: false,
      inputAddress: 'Кемерово, тестовая улица',
    });
    const projected = enrichAnalysisWithReportProjection(analysis, {
      reportMode: 'free',
      rawElements: elements,
    });
    const trace = projected.scoringTrace;
    if (!trace?.coordinates) throw new Error('missing coordinates');

    const badGeo: GeocodeResult = {
      lat: 54.0,
      lon: 86.0,
      displayName: 'Сосновка',
      locality: 'Сосновка',
    };

    const d = buildLocationDecision({
      analysis: projected,
      inputAddress: 'Кемерово, тестовая улица',
      coordinates: trace.coordinates,
      rawElements: elements,
      locale: 'ru',
      geocodeResult: badGeo,
    });

    expect(d.publicSummary?.cityScale).toBe('unknown');
    expect(d.warnings.some(w => w.includes('warning: geocode_city_mismatch'))).toBe(true);
    expect(d.demandKernelV1?.cityScaleInferenceProvenance).toMatch(/geocode_city_mismatch/);
  });
});
