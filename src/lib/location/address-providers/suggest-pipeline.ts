import type { AddressMarket, SuggestPipelineResult } from './types';
import { dadataAddressSuggest } from './suggest-dadata';
import { googlePlacesAutocomplete } from './suggest-google';
import { twogisAddressSuggest } from './suggest-2gis';
import { photonSuggest } from './suggest-photon';
import { normalizeRuAddressQuery, rerankRuSuggestionsByLocality } from './ru-normalize';
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

/**
 * Locale-routed suggestion chain. Always returns a terminal status (never hangs).
 *
 * RU and EN: Google Places Autocomplete (language/bias by market) → Photon → optional DaData (RU only)
 * RU only: optional 2GIS Catalog suggest is tried before Photon if configured.
 */
export async function runSuggestPipeline(market: AddressMarket, query: string): Promise<SuggestPipelineResult> {
  const t0 = Date.now();
  const raw = query;
  const trimmed = raw.trim();
  if (trimmed.length < 2) {
    return { suggestions: [], status: 'ok', elapsed_ms: Date.now() - t0 };
  }

  const { normalized, providerQuery } =
    market === 'ru'
      ? normalizeRuAddressQuery(trimmed)
      : { normalized: trimmed, providerQuery: trimmed };

  const googleLang = market === 'ru' ? 'ru' : 'en';
  const googleComponents = market === 'ru' ? 'country:ru' : undefined;

  try {
    const gKey = googleMapsKey();
    if (gKey) {
      let primary = await googlePlacesAutocomplete(providerQuery, gKey, {
        language: googleLang,
        components: googleComponents,
      });
      if (market === 'ru') {
        primary = rerankRuSuggestionsByLocality(normalized, primary);
      }
      if (primary.length > 0) {
        return {
          suggestions: primary,
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
        dg = rerankRuSuggestionsByLocality(normalized, dg);
        if (dg.length > 0) {
          console.warn('[address-suggest] ru fallback=2gis_catalog');
          return {
            suggestions: dg,
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
      photon = rerankRuSuggestionsByLocality(normalized, photon);
    }
    if (photon.length > 0) {
      console.warn(`[address-suggest] market=${market} fallback=photon after_google_empty_or_no_key`);
      return {
        suggestions: photon,
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
        dd = rerankRuSuggestionsByLocality(normalized, dd);
        if (dd.length > 0) {
          console.warn('[address-suggest] ru fallback=dadata');
          return {
            suggestions: dd,
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
              value: label,
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
