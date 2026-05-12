import type { GeocodeResult } from '../providers/types';

const TIMEOUT_MS = 8_000;

interface GoogleGeocodeResponse {
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
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
    const hit = data.results[0];
    const g = hit.geometry?.location;
    if (!g) return null;
    const out: GeocodeResult = {
      lat: g.lat,
      lon: g.lng,
      displayName: hit.formatted_address,
    };
    const comps = hit.address_components;
    if (comps?.length) {
      const pick = (...types: string[]) => {
        for (const ty of types) {
          const c = comps.find(x => x.types.includes(ty));
          if (c?.long_name) return c.long_name;
        }
        return undefined;
      };
      const locality =
        pick('locality') ?? pick('postal_town') ?? pick('administrative_area_level_3') ?? pick('administrative_area_level_4');
      const admin1 = pick('administrative_area_level_1');
      const admin2 = pick('administrative_area_level_2');
      const municipality = pick('administrative_area_level_5', 'administrative_area_level_6');
      if (locality) out.locality = locality;
      if (admin1) out.adminArea1 = admin1;
      if (admin2) out.adminArea2 = admin2;
      if (municipality) out.municipality = municipality;
    }
    return out;
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
