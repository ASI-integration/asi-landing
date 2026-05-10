import type { AddressMarket, AddressSuggestionRow, SuggestPipelineResult } from './types';
import { dadataAddressSuggest } from './suggest-dadata';
import { googlePlacesAutocomplete } from './suggest-google';
import { twogisAddressSuggest } from './suggest-2gis';
import { photonSuggest } from './suggest-photon';
import {
  buildProviderQueryWithContextCity,
  canonicalizeRuSuggestionValue,
  normalizeRuAddressQuery,
  rerankRuSuggestionsByLocality,
} from './ru-normalize';
import {
  buildRuMetroSuggestQueryVariants,
  resolveRuAddressSearchProfiles,
  shouldExpandRuMetroSuggest,
} from './ru-address-search-profile';
import { geocodePlainAddressForMarket } from './geocode-pipeline';

function googleMapsKey(): string | null {
  const k =
    (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  return k || null;
}

function twogisCatalogKey(): string | null {
  const k = (process.env.TWOGIS_CATALOG_API_KEY ?? '').trim();
  return k || null;
}

function uniqueSuggestQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const t = q.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function dedupeSuggestionRows(rows: AddressSuggestionRow[]): AddressSuggestionRow[] {
  const seen = new Set<string>();
  const out: AddressSuggestionRow[] = [];
  for (const row of rows) {
    const pid = row.placeId?.trim();
    const tgis = row.twogisItemId?.trim();
    const key = pid || tgis || row.value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 14) break;
  }
  return out;
}

async function mergeGoogleAutocomplete(
  queries: string[],
  apiKey: string,
  opts: {
    language: string;
    components?: string;
    bias?: { location: string; radius: number };
  },
): Promise<AddressSuggestionRow[]> {
  const batches = await Promise.all(
    queries.map(q =>
      googlePlacesAutocomplete(q, apiKey, opts).catch(() => [] as AddressSuggestionRow[]),
    ),
  );
  return dedupeSuggestionRows(batches.flat());
}

async function mergeTwogis(queries: string[], apiKey: string): Promise<AddressSuggestionRow[]> {
  const batches = await Promise.all(
    queries.map(q => twogisAddressSuggest(q, apiKey).catch(() => [] as AddressSuggestionRow[])),
  );
  return dedupeSuggestionRows(batches.flat());
}

async function mergePhoton(queries: string[], market: AddressMarket): Promise<AddressSuggestionRow[]> {
  const batches = await Promise.all(
    queries.map(q => photonSuggest(q, market).catch(() => [] as AddressSuggestionRow[])),
  );
  return dedupeSuggestionRows(batches.flat());
}

async function mergeDadata(queries: string[], apiKey: string): Promise<AddressSuggestionRow[]> {
  const batches = await Promise.all(
    queries.map(q => dadataAddressSuggest(q, apiKey).catch(() => [] as AddressSuggestionRow[])),
  );
  return dedupeSuggestionRows(batches.flat());
}

export interface RunSuggestPipelineOptions {
  /** Resolved city context for the RU market (typed > viewport > last-pick > session).
   *  Used both as a provider-query hint (when query has no explicit city) and as
   *  the city-bias signal for the local reranker. */
  contextCity?: string | null;
  /** Optional viewport bias (browser geolocation lat/lon). Forwarded to providers
   *  that accept location/radius bias (Google Places). Not converted to a city. */
  biasLat?: number | null;
  biasLon?: number | null;
}

/**
 * Locale-routed suggestion chain. Always returns a terminal status (never hangs).
 *
 * RU and EN: Google Places Autocomplete (language/bias by market) → Photon → optional DaData (RU only)
 * RU only: optional 2GIS Catalog suggest is tried before Photon if configured.
 */
export async function runSuggestPipeline(
  market: AddressMarket,
  query: string,
  opts?: RunSuggestPipelineOptions,
): Promise<SuggestPipelineResult> {
  const t0 = Date.now();
  const raw = query;
  const trimmed = raw.trim();
  if (trimmed.length < 2) {
    return { suggestions: [], status: 'ok', elapsed_ms: Date.now() - t0 };
  }

  const { normalized, providerQuery: providerQueryRaw } =
    market === 'ru'
      ? normalizeRuAddressQuery(trimmed)
      : { normalized: trimmed, providerQuery: trimmed };

  const contextCity = opts?.contextCity ?? null;

  const providerQuery =
    market === 'ru'
      ? buildProviderQueryWithContextCity(providerQueryRaw, contextCity)
      : providerQueryRaw;

  const ruResolution =
    market === 'ru'
      ? resolveRuAddressSearchProfiles({
          normalizedQuery: normalized,
          contextCity,
          biasLat: Number.isFinite(opts?.biasLat ?? NaN) ? (opts?.biasLat as number) : null,
          biasLon: Number.isFinite(opts?.biasLon ?? NaN) ? (opts?.biasLon as number) : null,
        })
      : null;

  const profileExpansionActive = market === 'ru' && shouldExpandRuMetroSuggest(normalized);

  const ruSuggestQueries =
    market === 'ru'
      ? uniqueSuggestQueries([
          providerQuery,
          ...(profileExpansionActive
            ? buildRuMetroSuggestQueryVariants(
                providerQueryRaw.trim(),
                normalized,
                ruResolution?.profiles ?? [],
              )
            : []),
        ])
      : [providerQuery];

  const rerankOpts =
    market === 'ru'
      ? {
          contextCity,
          biasLat: Number.isFinite(opts?.biasLat ?? NaN) ? (opts?.biasLat as number) : null,
          biasLon: Number.isFinite(opts?.biasLon ?? NaN) ? (opts?.biasLon as number) : null,
          addressSearchProfiles: ruResolution?.profiles ?? [],
          addressSearchContextLocked: ruResolution?.contextLocked ?? false,
          addressSearchExpansionActive: profileExpansionActive,
        }
      : { contextCity, biasLat: opts?.biasLat ?? null, biasLon: opts?.biasLon ?? null };

  const googleLang = market === 'ru' ? 'ru' : 'en';
  const googleComponents = market === 'ru' ? 'country:ru' : undefined;
  const biasLat = Number.isFinite(opts?.biasLat ?? NaN) ? (opts?.biasLat as number) : null;
  const biasLon = Number.isFinite(opts?.biasLon ?? NaN) ? (opts?.biasLon as number) : null;
  const googleBias =
    biasLat !== null && biasLon !== null
      ? { location: `${biasLat},${biasLon}`, radius: 50_000 }
      : undefined;

  const finalize = (suggestions: AddressSuggestionRow[]): AddressSuggestionRow[] =>
    market === 'ru'
      ? suggestions.map(s => ({ ...s, value: canonicalizeRuSuggestionValue(s.value) }))
      : suggestions;

  try {
    const gKey = googleMapsKey();
    if (gKey) {
      let primary =
        market === 'ru'
          ? await mergeGoogleAutocomplete(ruSuggestQueries, gKey, {
              language: googleLang,
              components: googleComponents,
              bias: googleBias,
            })
          : await googlePlacesAutocomplete(providerQuery, gKey, {
              language: googleLang,
              components: googleComponents,
              bias: googleBias,
            });
      if (market === 'ru') {
        primary = rerankRuSuggestionsByLocality(normalized, primary, rerankOpts);
      }
      if (primary.length > 0) {
        return {
          suggestions: finalize(primary),
          status: 'ok',
          elapsed_ms: Date.now() - t0,
          raw_query: trimmed,
          normalized_query: normalized,
        };
      }
    }

    if (market === 'ru') {
      const dgKey = twogisCatalogKey();
      if (dgKey) {
        let dg = await mergeTwogis(ruSuggestQueries, dgKey);
        dg = rerankRuSuggestionsByLocality(normalized, dg, rerankOpts);
        if (dg.length > 0) {
          console.warn('[address-suggest] ru fallback=2gis_catalog');
          return {
            suggestions: finalize(dg),
            status: 'ok',
            elapsed_ms: Date.now() - t0,
            raw_query: trimmed,
            normalized_query: normalized,
          };
        }
      }
    }

    let photon =
      market === 'ru'
        ? await mergePhoton(ruSuggestQueries, market)
        : await photonSuggest(providerQuery, market);
    if (market === 'ru') {
      photon = rerankRuSuggestionsByLocality(normalized, photon, rerankOpts);
    }
    if (photon.length > 0) {
      console.warn(`[address-suggest] market=${market} fallback=photon after_google_empty_or_no_key`);
      return {
        suggestions: finalize(photon),
        status: 'ok',
        elapsed_ms: Date.now() - t0,
        raw_query: trimmed,
        normalized_query: normalized,
      };
    }

    if (market === 'ru') {
      const dadataKey = (process.env.DADATA_API_KEY ?? '').trim();
      if (dadataKey) {
        let dd = await mergeDadata(ruSuggestQueries, dadataKey);
        dd = rerankRuSuggestionsByLocality(normalized, dd, rerankOpts);
        if (dd.length > 0) {
          console.warn('[address-suggest] ru fallback=dadata');
          return {
            suggestions: finalize(dd),
            status: 'ok',
            elapsed_ms: Date.now() - t0,
            raw_query: trimmed,
            normalized_query: normalized,
          };
        }
      }
    }

    try {
      const geo = await geocodePlainAddressForMarket(market, trimmed);
      if (geo.result) {
        const r = geo.result;
        const label = (r.displayName ?? trimmed).trim() || trimmed;
        console.warn(
          `[address-suggest] fallback=plain_geocode winner=${geo.winner ?? 'none'} market=${market} q=${JSON.stringify(trimmed.slice(0, 80))}`,
        );
        return {
          suggestions: [
            {
              value: market === 'ru' ? canonicalizeRuSuggestionValue(label) : label,
              lat: String(r.lat),
              lon: String(r.lon),
            },
          ],
          status: 'ok',
          elapsed_ms: Date.now() - t0,
          raw_query: trimmed,
          normalized_query: normalized,
        };
      }
    } catch (geoErr) {
      const m = geoErr instanceof Error ? geoErr.message : String(geoErr);
      console.warn(`[address-suggest] plain_geocode_last_resort_failed market=${market} ${m}`);
    }

    if (!gKey) {
      console.warn(
        '[address-suggest] status=no_key (GOOGLE_MAPS_SERVER_API_KEY and NEXT_PUBLIC_GOOGLE_MAPS_API_KEY unset or empty)',
      );
      return { suggestions: [], status: 'no_key', elapsed_ms: Date.now() - t0 };
    }
    return {
      suggestions: [],
      status: 'no_results',
      elapsed_ms: Date.now() - t0,
      raw_query: trimmed,
      normalized_query: normalized,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[address-suggest] pipeline_error market=${market} ${message}`);
    return {
      suggestions: [],
      status: 'error',
      elapsed_ms: Date.now() - t0,
      raw_query: trimmed,
      normalized_query: normalized,
    };
  }
}
