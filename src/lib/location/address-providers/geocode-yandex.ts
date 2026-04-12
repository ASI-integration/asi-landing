import type { GeocodeResult } from '../providers/types';

const TIMEOUT_MS = 8_000;

interface YandexGeocodeJson {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject?: {
          name?: string;
          description?: string;
          Point?: { pos?: string };
        };
      }>;
    };
  };
}

/**
 * Forward geocode or resolve a Geosuggest `uri` via Yandex Geocoder HTTP API.
 */
export async function yandexGeocode(params: {
  apiKey: string;
  /** Free-text address */
  text?: string;
  /** From Geosuggest `attrs=uri` — takes precedence over text when set */
  uri?: string;
}): Promise<GeocodeResult | null> {
  const geocodeParam = (params.uri ?? params.text ?? '').trim();
  if (!geocodeParam) return null;

  const url = new URL('https://geocode-maps.yandex.ru/1.x/');
  url.searchParams.set('apikey', params.apiKey);
  url.searchParams.set('geocode', geocodeParam);
  url.searchParams.set('format', 'json');
  url.searchParams.set('results', '1');
  url.searchParams.set('lang', 'ru_RU');

  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as YandexGeocodeJson;
    const pos =
      data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
    if (!pos) return null;
    const parts = pos.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const geo = data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const displayName = [geo?.name, geo?.description].filter(Boolean).join(', ') || undefined;

    return { lat, lon, displayName };
  } catch {
    return null;
  }
}
