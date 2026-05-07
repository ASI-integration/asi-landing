import type { AddressMarket, AddressSuggestionRow, SuggestPipelineResult } from './types';
import { dadataAddressSuggest } from './suggest-dadata';
import { googlePlacesAutocomplete } from './suggest-google';
import { twogisAddressSuggest } from './suggest-2gis';
import { photonSuggest } from './suggest-photon';
import {
  buildProviderQueryWithContextCity,
  canonicalizeRuSuggestionValue,
  hasExplicitRuCity,
  normalizeRuAddressQuery,
  rerankRuSuggestionsByLocality,
} from './ru-normalize';
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

const RU_NORTHWEST_DISAMBIGUATION_HINTS: readonly string[] = [
  'Санкт-Петербург',
  'Мурино, Ленинградская область',
];

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
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

  // For RU queries that don't name a city, append the caller-supplied context
  // city (typed > viewport > last selection > session) so providers return
  // local matches first instead of street-name lookalikes scattered across the
  // country. With no context the query is sent as-is — UI disambiguates.
  const providerQuery =
    market === 'ru'
      ? buildProviderQueryWithContextCity(providerQueryRaw, contextCity)
      : providerQueryRaw;

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

  // For RU street+house queries that have no explicit city, one provider query
  // is not enough: a city-biased query collapses to one locality, while a raw
  // nationwide query can return unrelated same-street matches. Fetch a tiny set
  // of northwest locality hints as well, then merge and rerank so the UI can
  // show both Санкт-Петербург and nearby Мурино / Ленобласть variants.
  const shouldExpandRuDisambiguation =
    market === 'ru' &&
    !hasExplicitRuCity(normalized) &&
    /\d/u.test(normalized);

  try {
    const gKey = googleMapsKey();
    if (gKey) {
      const expandedRuQueries = shouldExpandRuDisambiguation
        ? [
            ...RU_NORTHWEST_DISAMBIGUATION_HINTS.map(hint => `${providerQueryRaw}, ${hint}, Россия`),
            providerQueryRaw,
          ]
        : [];
      const googleQueries = uniqueStrings([
        ...(providerQuery !== providerQueryRaw ? [providerQuery] : []),
        ...expandedRuQueries,
        ...(providerQuery === providerQueryRaw && !shouldExpandRuDisambiguation ? [providerQuery] : []),
      ]);

      let [primary, ...secondaryResults] = await Promise.all(
        googleQueries.map((q, idx) =>
          googlePlacesAutocomplete(q, gKey, {
            language: googleLang,
            components: googleComponents,
            bias: googleBias,
          }).catch(() => {
            // Preserve the primary failure behavior from googlePlacesAutocomplete
            // (it logs and returns []); this guard is only for network throws.
            if (idx === 0) throw new Error('google_primary_failed');
            return [] as AddressSuggestionRow[];
          }),
        ),
      );

      if (secondaryResults.length > 0) {
        const seen = new Set<string>(primary.map(s => s.value.trim().toLowerCase()));
        for (const secondary of secondaryResults) {
          for (const s of secondary) {
            const key = s.value.trim().toLowerCase();
            if (!seen.has(key)) {
              primary.push(s);
              seen.add(key);
            }
          }
        }
      }

      if (market === 'ru') {
        primary = rerankRuSuggestionsByLocality(normalized, primary, { contextCity });
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
        let dg = await twogisAddressSuggest(providerQuery, dgKey);
        dg = rerankRuSuggestionsByLocality(normalized, dg, { contextCity });
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

    let photon = await photonSuggest(providerQuery, market);
    if (market === 'ru') {
      photon = rerankRuSuggestionsByLocality(normalized, photon, { contextCity });
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
        let dd = await dadataAddressSuggest(providerQuery, dadataKey);
        dd = rerankRuSuggestionsByLocality(normalized, dd, { contextCity });
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

    // Last resort: forward-geocode the normalized query so autocomplete outages
    // (Photon down, Places empty, etc.) do not hard-block the UI.
    try {
      const geo = await geocodePlainAddressForMarket(market, normalized);
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
