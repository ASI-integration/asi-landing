import type { AddressSuggestionRow } from './types';

const TIMEOUT_MS = 5_000;

interface DaDataSuggestion {
  value: string;
  data: { geo_lat: string | null; geo_lon: string | null };
}

interface DaDataResponse {
  suggestions: DaDataSuggestion[];
}

export async function dadataAddressSuggest(query: string, apiKey: string): Promise<AddressSuggestionRow[]> {
  try {
    const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify({ query, count: 7 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as DaDataResponse;
    return data.suggestions.map(s => ({
      value: s.value,
      lat: s.data.geo_lat,
      lon: s.data.geo_lon,
    }));
  } catch {
    return [];
  }
}
