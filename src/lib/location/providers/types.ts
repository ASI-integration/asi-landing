// ── Location provider interfaces ───────────────────────────────────────────────
// Each concern is its own interface so vendors can be swapped independently:
//   • MagnetProvider   — fetches raw nearby objects (Overpass, HERE, etc.)
//   • GeocodingProvider — converts addresses ↔ coordinates (Nominatim, Yandex, 2GIS)
//   • MapDisplayProvider — map tile/UI vendor (Leaflet, Yandex Maps, 2GIS)
//
// The ASI gravity scoring engine (gravity-scoring.ts) imports NONE of these —
// it only knows about OSMElement[], MagnetItem[], and CompetitorItem[].

import type { OSMElement } from '../types';

// ── Magnet / competitor data provider ────────────────────────────────────────

export interface MagnetFetchResult {
  elements: OSMElement[];
  /** true when every endpoint failed (no data retrieved) */
  hadProviderFailure: boolean;
  /** True when a reduced Overpass query recovered after primary failures */
  usedFallbackQuery?: boolean;
}

/**
 * Fetches raw nearby objects (magnets + competitors) for a coordinate.
 * Decoupled from geocoding: receives lat/lon, not an address string.
 * Decoupled from the scoring engine: returns raw OSMElement[], not MagnetItem[].
 */
export interface MagnetProvider {
  readonly id: string;
  fetchElements(lat: number, lon: number): Promise<MagnetFetchResult>;
}

// ── Geocoding provider ────────────────────────────────────────────────────────

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** Display name returned by the provider, if available */
  displayName?: string;
  /** Primary city / town from structured response when available */
  locality?: string;
  settlement?: string;
  municipality?: string;
  adminArea1?: string;
  adminArea2?: string;
}

/**
 * Converts addresses to coordinates and vice-versa.
 * Entirely separate from magnet fetching — swap Nominatim for Yandex/2GIS
 * geocoder without touching the magnet or scoring pipeline.
 */
export interface GeocodingProvider {
  readonly id: string;
  geocode(address: string): Promise<GeocodeResult | null>;
  reverseGeocode?(lat: number, lon: number): Promise<string | null>;
}

// ── Map display provider (UI only) ────────────────────────────────────────────

/**
 * Describes a map tile / rendering vendor.
 * Intentionally thin — the scoring engine never imports this.
 * Implement for Yandex Maps, 2GIS, Mapbox, etc. when adding map UI.
 */
export interface MapDisplayProvider {
  readonly id: string;
  /** Tile URL template, e.g. "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" */
  readonly tileUrl: string;
  readonly attribution: string;
  readonly supportsHeatmap: boolean;
  readonly supportsClustering: boolean;
}
