import { NextRequest, NextResponse } from 'next/server';
import { runSuggestPipeline } from '@/lib/location/address-providers/suggest-pipeline';
import type { AddressMarket } from '@/lib/location/address-providers/types';

export const dynamic = 'force-dynamic';

function parseMarket(request: NextRequest): AddressMarket {
  const raw = (request.nextUrl.searchParams.get('locale') ?? 'en').trim().toLowerCase();
  return raw === 'ru' ? 'ru' : 'en';
}

function parseFiniteFloat(raw: string | null, min: number, max: number): number | null {
  if (raw == null) return null;
  const v = Number.parseFloat(raw.trim());
  if (!Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

function parseContextCity(raw: string | null): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (!v) return null;
  // Defensive bound — providers cap city names well under this.
  return v.slice(0, 80);
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
  const params = request.nextUrl.searchParams;
  const contextCity = parseContextCity(params.get('cityHint'));
  const biasLat = parseFiniteFloat(params.get('biasLat'), -90, 90);
  const biasLon = parseFiniteFloat(params.get('biasLon'), -180, 180);
  const cityHintSource = params.get('cityHintSource')?.trim() || undefined;
  console.info('[address-suggest] request_start', {
    market,
    qLen: q.length,
    q: qPreview,
    contextCity: contextCity ?? null,
    cityHintSource,
    hasBias: biasLat !== null && biasLon !== null,
  });

  const { suggestions, status, elapsed_ms, raw_query, normalized_query } = await runSuggestPipeline(
    market,
    q,
    { contextCity, biasLat, biasLon },
  );

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
