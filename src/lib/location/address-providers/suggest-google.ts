import type { AddressSuggestionRow } from './types';

const TIMEOUT_MS = 8_000;

interface GoogleAutocompleteResponse {
  predictions?: Array<{ description: string; place_id: string }>;
  status: string;
}

export async function googlePlacesAutocomplete(
  query: string,
  apiKey: string,
): Promise<AddressSuggestionRow[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', query);
  url.searchParams.set('language', 'en');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(`[address-suggest:google] http status=${res.status}`);
    return [];
  }

  const data = (await res.json()) as GoogleAutocompleteResponse;
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn(`[address-suggest:google] places_status=${data.status}`);
    return [];
  }

  return (data.predictions ?? []).map(p => ({
    value: p.description,
    lat: null,
    lon: null,
    placeId: p.place_id,
  }));
}
