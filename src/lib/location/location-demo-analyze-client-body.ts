import type { GeocodeResult } from '@/lib/location/providers/types';

export type LocationDemoAnalyzePostOptions = {
  lat: number;
  lon: number;
  locale: 'en' | 'ru';
  spatialFoundation?: boolean;
  /** User-entered or chosen address text (RU city-mismatch guard). */
  inputAddress?: string;
  geocodeResult?: GeocodeResult | null;
};

/** POST JSON body for `/api/location-demo-analyze` from the location demo UI. */
export function buildLocationDemoAnalyzePostBody(opts: LocationDemoAnalyzePostOptions): Record<string, unknown> {
  const trimmedInput = (opts.inputAddress ?? '').trim();
  const body: Record<string, unknown> = {
    lat: opts.lat,
    lon: opts.lon,
    locale: opts.locale,
    ...(opts.spatialFoundation ? { spatialFoundation: true } : {}),
  };
  if (trimmedInput) body.inputAddress = trimmedInput;
  if (opts.geocodeResult) body.geocodeResult = opts.geocodeResult;
  return body;
}

/** Best-effort parse of `geocodeResult` from `/api/location-geocode` or `/api/address-resolve`. */
export function parseLooseGeocodeResult(v: unknown): GeocodeResult | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.lat !== 'number' || typeof o.lon !== 'number') return undefined;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return undefined;
  const s = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
  return {
    lat: o.lat,
    lon: o.lon,
    displayName: s(o.displayName),
    locality: s(o.locality),
    settlement: s(o.settlement),
    municipality: s(o.municipality),
    adminArea1: s(o.adminArea1),
    adminArea2: s(o.adminArea2),
  };
}
