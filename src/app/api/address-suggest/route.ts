import { NextRequest, NextResponse } from 'next/server';

interface DaDataSuggestion {
  value: string;
  data: {
    geo_lat: string | null;
    geo_lon: string | null;
  };
}

interface DaDataResponse {
  suggestions: DaDataSuggestion[];
}

export const dynamic = 'force-dynamic';

/** DaDat request timeout — 5 s is generous for autocomplete; fail-fast after. */
const TIMEOUT_MS   = 5_000;
/** Retry once on timeout or network error before giving up. */
const MAX_ATTEMPTS = 2;

async function fetchDaDat(q: string, apiKey: string, attempt: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Token ${apiKey}`,
        },
        body: JSON.stringify({ query: q, count: 7 }),
        cache: 'no-store',
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
  // eslint-disable-next-line no-unreachable -- TypeScript needs this to know return type
  void attempt;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: [], status: 'no_key' });
  }

  const t0 = Date.now();
  let lastErr: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchDaDat(q, apiKey, attempt);

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        let providerBodyPreview: string | null = null;
        try {
          const raw = await res.text();
          providerBodyPreview = raw.slice(0, 200);
        } catch { /* ignore */ }

        console.warn(
          `[address-suggest] provider_error attempt=${attempt} status=${res.status} ` +
          `q_len=${q.length} elapsed_ms=${elapsed}`,
        );

        return NextResponse.json({
          suggestions: [],
          status: 'error',
          hasKey: true,
          providerStatus: res.status,
          providerStatusText: res.statusText || null,
          providerErrorKind: 'provider_http_error',
          providerBodyPreview,
          queryLength: q.length,
          elapsed_ms: elapsed,
        });
      }

      const data: DaDataResponse = await res.json();

      const suggestions = data.suggestions.map(s => ({
        value: s.value,
        lat: s.data.geo_lat,
        lon: s.data.geo_lon,
      }));

      if (attempt > 1) {
        console.log(
          `[address-suggest] ok_after_retry attempt=${attempt} results=${suggestions.length} ` +
          `q_len=${q.length} elapsed_ms=${elapsed}`,
        );
      }

      return NextResponse.json({
        suggestions,
        status: suggestions.length > 0 ? 'ok' : 'no_results',
        elapsed_ms: elapsed,
      });

    } catch (err) {
      const elapsed = Date.now() - t0;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = err instanceof Error ? err.message : String(err);
      lastErr = message;

      console.warn(
        `[address-suggest] fetch_error attempt=${attempt}/${MAX_ATTEMPTS} ` +
        `kind=${isAbort ? 'timeout' : 'network'} q_len=${q.length} elapsed_ms=${elapsed}: ${message}`,
      );

      if (attempt < MAX_ATTEMPTS) continue;

      return NextResponse.json({
        suggestions: [],
        status: 'error',
        hasKey: Boolean(process.env.DADATA_API_KEY),
        providerStatus: null,
        providerStatusText: null,
        providerErrorKind: isAbort ? 'timeout' : 'fetch_exception',
        providerBodyPreview: lastErr?.slice(0, 200) ?? null,
        queryLength: q.length,
        elapsed_ms: elapsed,
        attempts: attempt,
      });
    }
  }

  // Unreachable but satisfies TypeScript
  return NextResponse.json({ suggestions: [], status: 'error' });
}
