import type { AddressSuggestionRow } from './types';

const TIMEOUT_MS = 6_000;

interface YandexSuggestResponse {
  results?: Array<{
    title?: { text?: string };
    address?: { formatted_address?: string };
    uri?: string;
  }>;
}

export async function yandexGeosuggest(
  query: string,
  apiKey: string,
): Promise<AddressSuggestionRow[]> {
  const url = new URL('https://suggest-maps.yandex.ru/v1/suggest');
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('text', query);
  url.searchParams.set('lang', 'ru');
  url.searchParams.set('results', '7');
  url.searchParams.set('attrs', 'uri');
  url.searchParams.set('print_address', '1');

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(`[address-suggest:yandex] http status=${res.status}`);
    return [];
  }

  const data = (await res.json()) as YandexSuggestResponse;
  const rows: AddressSuggestionRow[] = [];
  for (const r of data.results ?? []) {
    const value =
      (r.address?.formatted_address && r.address.formatted_address.trim()) ||
      (r.title?.text && r.title.text.trim()) ||
      '';
    if (!value) continue;
    rows.push({
      value,
      lat: null,
      lon: null,
      yandexUri: r.uri,
    });
  }
  return rows;
}
