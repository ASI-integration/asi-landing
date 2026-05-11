import type { GeocodeResult } from '../providers/types';

const TIMEOUT_MS = 8_000;

interface GoogleGeocodeResponse {
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
  }>;
  status: string;
}

interface GooglePlaceDetailsResponse {
  result?: { geometry?: { location?: { lat: number; lng: number } } };
  status: string;
}

export async function googleForwardGeocode(
  address: string,
  apiKey: string,
  options?: { region?: string },
): Promise<GeocodeResult | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  if (options?.region) {
    url.searchParams.set('region', options.region);
  }
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GoogleGeocodeResponse;
    if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) return null;
    const loc = data.results[0].geometry.location;
    return {
      lat: loc.lat,
      lon: loc.lng,
      displayName: data.results[0].formatted_address,
    };
  } catch {
    return null;
  }
}

export async function googlePlaceDetailsLatLon(placeId: string, apiKey: string): Promise<GeocodeResult | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'geometry,formatted_address');
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GooglePlaceDetailsResponse;
    if (data.status !== 'OK' || !data.result?.geometry?.location) return null;
    const loc = data.result.geometry.location;
    return {
      lat: loc.lat,
      lon: loc.lng,
      displayName: undefined,
    };
  } catch {
    return null;
  }
}
