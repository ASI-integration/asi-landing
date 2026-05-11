import { describe, expect, it } from 'vitest';
import { looksLikeRuStreetWithHouseNumber } from '../ru-house-number';
import {
  pickGoogleGeocodeResultForQuery,
  type GoogleGeocodeRawResult,
} from '../geocode-google-pick';

describe('RU street + house number geocode preference', () => {
  it('detects Parkhomenko-style address strings', () => {
    expect(looksLikeRuStreetWithHouseNumber('проспект Пархоменко, 15, Санкт-Петербург')).toBe(true);
    expect(looksLikeRuStreetWithHouseNumber('ул. Ленина, д. 3')).toBe(true);
    expect(looksLikeRuStreetWithHouseNumber('центр города')).toBe(false);
  });

  it('prefers street_address over medical POI when user typed house number', () => {
    const q = 'проспект Пархоменко, 15, Санкт-Петербург';
    const clinicFirst: GoogleGeocodeRawResult[] = [
      {
        formatted_address: 'Клиника, проспект Пархоменко, 15',
        geometry: { location: { lat: 59.98, lng: 30.32 }, location_type: 'ROOFTOP' },
        types: ['doctor', 'health', 'establishment', 'point_of_interest'],
      },
      {
        formatted_address: 'проспект Пархоменко, 15, Санкт-Петербург',
        geometry: { location: { lat: 59.981, lng: 30.319 }, location_type: 'ROOFTOP' },
        types: ['street_address'],
      },
    ];
    const r = pickGoogleGeocodeResultForQuery(q, clinicFirst);
    expect(r?.lat).toBeCloseTo(59.981, 2);
    expect(r?.displayName).toContain('проспект Пархоменко');
    expect(r?.displayName).not.toContain('Клиника');
    expect(r?.geocodeDebug?.skippedEstablishment).toBe(true);
  });

  it('keeps default first Google hit when query does not specify house number', () => {
    const q = 'Гостиница Балчуг Москва';
    const poiOk: GoogleGeocodeRawResult[] = [
      {
        formatted_address: 'Hotel Mock',
        geometry: { location: { lat: 55.74, lng: 37.62 }, location_type: 'ROOFTOP' },
        types: ['establishment', 'lodging'],
      },
    ];
    const r = pickGoogleGeocodeResultForQuery(q, poiOk);
    expect(r?.displayName).toBe('Hotel Mock');
  });
});
