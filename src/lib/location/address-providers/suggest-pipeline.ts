import type { AddressMarket, SuggestPipelineResult } from './types';
import { dadataAddressSuggest } from './suggest-dadata';
import { googlePlacesAutocomplete } from './suggest-google';
import { photonSuggest } from './suggest-photon';

function googleMapsKey(): string | null {
  const k =
    (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  return k || null;
}

/**
 * Locale-routed suggestion chain. Always returns a terminal status (never hangs).
 *
 * RU and EN: Google Places Autocomplete (language/bias by market) → Photon → optional DaData (RU only)
 */
export async function runSuggestPipeline(market: AddressMarket, query: string): Promise<SuggestPipelineResult> {
  const t0 = Date.now();
  const q = query.trim();
  if (q.length < 2) {
    return { suggestions: [], status: 'ok', elapsed_ms: Date.now() - t0 };
  }

  const googleLang = market === 'ru' ? 'ru' : 'en';
  const googleComponents = market === 'ru' ? 'country:ru' : undefined;

  try {
    const gKey = googleMapsKey();
    if (gKey) {
      const primary = await googlePlacesAutocomplete(q, gKey, {
        language: googleLang,
        components: googleComponents,
      });
      if (primary.length > 0) {
        return { suggestions: primary, status: 'ok', elapsed_ms: Date.now() - t0 };
      }
    }

    const photon = await photonSuggest(q, market);
    if (photon.length > 0) {
      console.warn(`[address-suggest] market=${market} fallback=photon after_google_empty_or_no_key`);
      return { suggestions: photon, status: 'ok', elapsed_ms: Date.now() - t0 };
    }

    if (market === 'ru') {
      const dadataKey = (process.env.DADATA_API_KEY ?? '').trim();
      if (dadataKey) {
        const dd = await dadataAddressSuggest(q, dadataKey);
        if (dd.length > 0) {
          console.warn('[address-suggest] ru fallback=dadata');
          return { suggestions: dd, status: 'ok', elapsed_ms: Date.now() - t0 };
        }
        return { suggestions: [], status: 'no_results', elapsed_ms: Date.now() - t0 };
      }
    }

    if (!gKey) {
      console.warn(
        '[address-suggest] status=no_key (GOOGLE_MAPS_SERVER_API_KEY and NEXT_PUBLIC_GOOGLE_MAPS_API_KEY unset or empty)',
      );
      return { suggestions: [], status: 'no_key', elapsed_ms: Date.now() - t0 };
    }
    return { suggestions: [], status: 'no_results', elapsed_ms: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[address-suggest] pipeline_error market=${market} ${message}`);
    return { suggestions: [], status: 'error', elapsed_ms: Date.now() - t0 };
  }
}
