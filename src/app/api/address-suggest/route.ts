import { NextRequest, NextResponse } from 'next/server';
import { runSuggestPipeline } from '@/lib/location/address-providers/suggest-pipeline';
import type { AddressMarket } from '@/lib/location/address-providers/types';

export const dynamic = 'force-dynamic';

function parseMarket(request: NextRequest): AddressMarket {
  const raw = (request.nextUrl.searchParams.get('locale') ?? 'en').trim().toLowerCase();
  return raw === 'ru' ? 'ru' : 'en';
}

/**
 * GET /api/address-suggest?q=&locale=en|ru
 *
 * Locale-routed provider pipeline (server-side; UI stays vendor-agnostic).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const market = parseMarket(request);
  const qPreview = q.length > 100 ? `${q.slice(0, 100)}…` : q;
  console.info('[address-suggest] request_start', { market, qLen: q.length, q: qPreview });

  const { suggestions, status, elapsed_ms, raw_query, normalized_query } = await runSuggestPipeline(market, q);

  console.info('[address-suggest] request_done', {
    market,
    status,
    suggestionCount: suggestions.length,
    elapsed_ms,
    normalized_query: normalized_query ? (normalized_query.length > 80 ? `${normalized_query.slice(0, 80)}…` : normalized_query) : undefined,
  });

  return NextResponse.json({
    suggestions,
    status,
    elapsed_ms,
    raw_query,
    normalized_query,
  });
}
