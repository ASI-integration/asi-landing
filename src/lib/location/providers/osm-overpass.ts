// ── OSM Overpass — MagnetProvider implementation ──────────────────────────────
// Wraps the low-level overpass fetch + OSM element classification.
// The gravity scoring engine (buildAnalysis) calls classifyElement internally,
// so this provider only needs to deliver raw OSMElement[].
//
// To switch to a different data source (HERE, Foursquare, proprietary DB):
//   1. Implement MagnetProvider with your own fetchElements()
//   2. Pass the new provider to the API route — no other file changes needed.

import type { MagnetProvider, MagnetFetchResult } from './types';
import { fetchOsmData } from '../overpass';

function createOsmOverpassProvider(): MagnetProvider {
  return {
    id: 'osm-overpass',

    async fetchElements(lat: number, lon: number): Promise<MagnetFetchResult> {
      return fetchOsmData(lat, lon);
    },
  };
}

/** Default singleton — use this unless you need a custom instance. */
export const osmOverpassProvider: MagnetProvider = createOsmOverpassProvider();
