import type { AddressSuggestionRow } from './types';

const TIMEOUT_MS = 6_000;

interface DgisSuggestResponse {
  meta?: { code?: number };
  result?: {
    items?: Array<Record<string, unknown>>;
  };
}

function parsePoint(point: unknown): { lat: number; lon: number } | null {
  if (point == null) return null;
  if (typeof point === 'object' && point !== null && 'lat' in point && 'lon' in point) {
    const lat = Number((point as { lat: unknown }).lat);
    const lon = Number((point as { lon: unknown }).lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }
  if (typeof point === 'string') {
    const parts = point.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }
  }
  return null;
}

function itemDisplayValue(item: Record<string, unknown>): string {
  const full = item.full_address_name;
  if (typeof full === 'string' && full.trim()) return full.trim();
  const addrName = item.address_name;
  if (typeof addrName === 'string' && addrName.trim()) return addrName.trim();
  const name = item.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const sa = item.search_attributes as Record<string, unknown> | undefined;
  const st = sa?.suggested_text;
  if (typeof st === 'string' && st.trim()) return st.trim();
  return '';
}

/**
 * 2GIS Catalog Suggest API (address hints). Requires a Catalog / Search API key.
 */
export async function twogisAddressSuggest(query: string, apiKey: string): Promise<AddressSuggestionRow[]> {
  const url = new URL('https://catalog.api.2gis.com/3.0/suggests');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('suggest_type', 'address');
  url.searchParams.set('locale', 'ru_RU');
  url.searchParams.set('page_size', '7');
  url.searchParams.set('fields', 'items.point,items.full_address_name,items.address_name,items.name');

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const preview = errBody.length > 500 ? `${errBody.slice(0, 500)}…` : errBody;
    console.warn(`[address-suggest:2gis] http status=${res.status} body=${preview || '(empty)'}`);
    return [];
  }

  const data = (await res.json()) as DgisSuggestResponse;
  if (data.meta?.code != null && data.meta.code !== 200) {
    console.warn(`[address-suggest:2gis] meta.code=${data.meta.code}`);
    return [];
  }

  const rows: AddressSuggestionRow[] = [];
  for (const raw of data.result?.items ?? []) {
    const value = itemDisplayValue(raw);
    if (!value) continue;

    const pt = parsePoint(raw.point);
    const id = typeof raw.id === 'string' ? raw.id : undefined;

    rows.push({
      value,
      lat: pt ? String(pt.lat) : null,
      lon: pt ? String(pt.lon) : null,
      twogisItemId: id,
    });
  }
  return rows;
}
