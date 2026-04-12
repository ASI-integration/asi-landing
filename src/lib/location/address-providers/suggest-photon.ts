import type { AddressMarket, AddressSuggestionRow } from './types';

const TIMEOUT_MS = 6_000;

/**
 * Open fallback — no API key. Weaker than vendor suggest but prevents total failure.
 */
export async function photonSuggest(query: string, market: AddressMarket): Promise<AddressSuggestionRow[]> {
  const lang = market === 'ru' ? 'ru' : 'en';
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=7&lang=${lang}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'asi-landing-location-demo/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { name?: string; street?: string; city?: string; country?: string };
      }>;
    };

    const out: AddressSuggestionRow[] = [];
    for (const f of data.features ?? []) {
      const props = f.properties;
      const label = [props?.name, props?.street, props?.city, props?.country]
        .filter(Boolean)
        .join(', ');
      if (!label.trim()) continue;
      const coords = f.geometry?.coordinates;
      const lon = coords?.[0];
      const lat = coords?.[1];
      out.push({
        value: label,
        lat: lat != null && Number.isFinite(lat) ? String(lat) : null,
        lon: lon != null && Number.isFinite(lon) ? String(lon) : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
