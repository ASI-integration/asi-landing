/**
 * Vendor-neutral address suggestion / resolution types for locale-routed providers.
 */

export type AddressMarket = 'ru' | 'en';

/** One row returned by GET /api/address-suggest (matches client Suggestion shape). */
export interface AddressSuggestionRow {
  value: string;
  lat: string | null;
  lon: string | null;
  /** Google Places prediction id (EN). */
  placeId?: string;
  /** 2GIS catalog item id (RU) — optional hint when resolving without inline coords. */
  twogisItemId?: string;
}

export type SuggestPipelineStatus = 'ok' | 'no_results' | 'no_key' | 'error';

export interface SuggestPipelineResult {
  suggestions: AddressSuggestionRow[];
  status: SuggestPipelineStatus;
  elapsed_ms?: number;
  raw_query?: string;
  normalized_query?: string;
}
