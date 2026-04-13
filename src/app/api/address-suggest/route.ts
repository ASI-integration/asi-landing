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
  const { suggestions, status, elapsed_ms, raw_query, normalized_query } = await runSuggestPipeline(market, q);

  return NextResponse.json({
    suggestions,
    status,
    elapsed_ms,
    raw_query,
    normalized_query,
  });
}
