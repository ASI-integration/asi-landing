import { describe, expect, it } from 'vitest';
import {
  buildLocationDemoAnalyzePostBody,
  parseLooseGeocodeResult,
} from '@/lib/location/location-demo-analyze-client-body';

describe('buildLocationDemoAnalyzePostBody', () => {
  it('includes inputAddress and geocodeResult for RU Kemerovo vs Sosnovka mismatch scenario', () => {
    const inputAddress = 'Кемерово, 2-я Луговая ул., 27';
    const geocodeResult = {
      lat: 54.0,
      lon: 86.0,
      locality: 'Сосновка',
      municipality: 'Сосновка',
      adminArea2: 'Новокузнецкий округ',
      adminArea1: 'Кемеровская область',
      displayName: '2-я Луговая ул., 27, Сосновка',
    };
    const body = buildLocationDemoAnalyzePostBody({
      lat: 54.0,
      lon: 86.0,
      locale: 'ru',
      inputAddress,
      geocodeResult,
    });
    expect(body.lat).toBe(54.0);
    expect(body.lon).toBe(86.0);
    expect(body.locale).toBe('ru');
    expect(body.inputAddress).toBe(inputAddress);
    expect(body.geocodeResult).toEqual(geocodeResult);
    expect(body.spatialFoundation).toBeUndefined();
  });

  it('omits empty inputAddress and null geocodeResult', () => {
    const body = buildLocationDemoAnalyzePostBody({
      lat: 1,
      lon: 2,
      locale: 'en',
      inputAddress: '   ',
      geocodeResult: null,
    });
    expect(body.inputAddress).toBeUndefined();
    expect(body.geocodeResult).toBeUndefined();
  });

  it('passes spatialFoundation when set', () => {
    const body = buildLocationDemoAnalyzePostBody({
      lat: 1,
      lon: 2,
      locale: 'ru',
      spatialFoundation: true,
      inputAddress: 'Москва',
    });
    expect(body.spatialFoundation).toBe(true);
  });
});

describe('parseLooseGeocodeResult', () => {
  it('accepts structured geocode payloads from APIs', () => {
    const raw = {
      lat: 60.014315,
      lon: 30.253552,
      locality: 'Сосновка',
      adminArea2: 'Новокузнецкий округ',
      displayName: 'test',
    };
    expect(parseLooseGeocodeResult(raw)).toMatchObject({
      lat: 60.014315,
      lon: 30.253552,
      locality: 'Сосновка',
      adminArea2: 'Новокузнецкий округ',
      displayName: 'test',
    });
  });

  it('returns undefined for invalid payloads', () => {
    expect(parseLooseGeocodeResult(null)).toBeUndefined();
    expect(parseLooseGeocodeResult({ lat: 'x', lon: 1 })).toBeUndefined();
  });
});
