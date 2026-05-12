import { describe, expect, it, vi } from 'vitest';
import type { GeocodeResult } from '../providers/types';
import { evaluateRuGeocodeCitySanity, extractRuRequestedCityToken } from '../address-providers/geocode-city-sanity';
import { inferCityScaleFromRuAddress } from '../city-scale-from-address';
import { buildAnalysis } from '../gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';
import * as decisionKernel from '../location-decision-kernel';

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
    ['Россия, Красноярский край, Норильск, Ленинский проспект, 19', 'medium_city'],
    ['Россия, Самара, Ленинградская улица, 64', 'million_plus'],
    ['Россия, Уфа, улица Менделеева, 137', 'million_plus'],
    ['Россия, Калининград, улица Горького, 162', 'large_regional'],
    ['Россия, Краснодар, Красная улица, 176', 'million_plus'],
    ['Россия, Тула, проспект Ленина, 85', 'large_regional'],
    ['Россия, Хабаровск, улица Муравьёва-Амурского, 36', 'large_regional'],
    ['Россия, Мурманск, проспект Ленина, 82', 'medium_city'],
    ['Россия, Улан-Удэ, улица Ленина, 24', 'medium_city'],
    ['Россия, Астрахань, улица Свердлова, 53', 'medium_city'],
  ] as const)('%s → %s', (addr, scale) => {
    expect(inferCityScaleFromRuAddress(addr).cityScale).toBe(scale);
  });

  it('does not match regional adjectives as city tokens', () => {
    const norilsk = inferCityScaleFromRuAddress('Россия, Красноярский край, Норильск, Ленинский проспект, 19');
    expect(norilsk.cityName).toBe('Норильск');
    expect(norilsk.cityScale).toBe('medium_city');
    expect(norilsk.inferredFrom).toMatch(/ru_market_context:Норильск/);
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
  it('attachLocationDecisionToAnalysis (demo API path): Кемерово typed vs Сосновка + Новокузнецкий округ', () => {
    const elements = [
      {
        type: 'node' as const,
        id: 9_000_002,
        lat: 54.1,
        lon: 86.2,
        tags: { amenity: 'hospital', name: 'Поликлиника' },
      },
    ];
    const analysis = buildAnalysis(elements, 54.1, 86.2, {
      spatialFoundation: false,
      inputAddress: 'Кемерово, 2-я Луговая ул., 27',
    });
    const geo: GeocodeResult = {
      lat: 54.1,
      lon: 86.2,
      displayName: '2-я Луговая ул., 27, Сосновка, Россия',
      locality: 'Сосновка',
      municipality: 'Сосновка',
      adminArea2: 'Новокузнецкий округ',
      adminArea1: 'Кемеровская область',
    };
    const merged = decisionKernel.attachLocationDecisionToAnalysis(analysis, {
      inputAddress: 'Кемерово, 2-я Луговая ул., 27',
      coordinates: { lat: 54.1, lon: 86.2 },
      rawElements: elements,
      locale: 'ru',
      geocodeResult: geo,
    });
    expect(merged.locationDecision.publicSummary?.cityScale).toBe('unknown');
    expect(merged.locationDecision.warnings.some(w => w.includes('warning: geocode_city_mismatch'))).toBe(true);
    expect(merged.locationDecision.demandKernelV1?.cityScaleInferenceProvenance).toMatch(/geocode_city_mismatch/);
  });

  it('enrichAnalysisWithReportProjection forwards geocodeResult to buildLocationDecision', () => {
    const elements = [
      {
        type: 'node' as const,
        id: 9_000_003,
        lat: 55.0,
        lon: 82.9,
        tags: { amenity: 'cafe', name: 'Кафе' },
      },
    ];
    const analysis = buildAnalysis(elements, 55.0, 82.9, { spatialFoundation: false, inputAddress: 'Кемерово, ул. Тест' });
    const geo: GeocodeResult = { lat: 54.0, lon: 86.0, locality: 'Сосновка' };
    const spy = vi.spyOn(decisionKernel, 'buildLocationDecision');
    enrichAnalysisWithReportProjection(analysis, { reportMode: 'free', rawElements: elements, geocodeResult: geo });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        geocodeResult: expect.objectContaining({ locality: 'Сосновка' }),
      }),
    );
    spy.mockRestore();
  });

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

    const d = decisionKernel.buildLocationDecision({
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
