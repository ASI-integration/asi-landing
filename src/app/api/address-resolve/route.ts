import { NextRequest, NextResponse } from 'next/server';
import { resolveAddressSelection } from '@/lib/location/address-providers/resolve-selection';
import type { AddressMarket, AddressSuggestionRow } from '@/lib/location/address-providers/types';

export const dynamic = 'force-dynamic';

const RESOLVE_TIMEOUT_MS = 12_000;

function isMarket(v: unknown): v is AddressMarket {
  return v === 'ru' || v === 'en';
}

function parseSuggestion(body: Record<string, unknown>): AddressSuggestionRow | null {
  const s = body.suggestion;
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (typeof o.value !== 'string' || !o.value.trim()) return null;
  return {
    value: o.value.trim(),
    lat: typeof o.lat === 'string' || o.lat === null ? (o.lat as string | null) : null,
    lon: typeof o.lon === 'string' || o.lon === null ? (o.lon as string | null) : null,
    placeId: typeof o.placeId === 'string' ? o.placeId : undefined,
    twogisItemId: typeof o.twogisItemId === 'string' ? o.twogisItemId : undefined,
  };
}

/**
 * POST /api/address-resolve
 * Body: { locale: 'ru' | 'en', suggestion: AddressSuggestionRow }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const market = body.locale;
  if (!isMarket(market)) {
    return NextResponse.json({ error: 'locale must be ru or en' }, { status: 400 });
  }

  const suggestion = parseSuggestion(body);
  if (!suggestion) {
    return NextResponse.json({ error: 'suggestion.value required' }, { status: 400 });
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), RESOLVE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([resolveAddressSelection(market, suggestion), timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);

    if (!result) {
      return NextResponse.json(
        { error: 'Could not resolve coordinates', status: 'unresolved' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      lat: result.lat,
      lon: result.lon,
      displayName: result.displayName,
      ...(result.geocodeResult ? { geocodeResult: result.geocodeResult } : {}),
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err instanceof Error && err.message === 'timeout') {
      console.warn(`[address-resolve] timeout market=${market}`);
      return NextResponse.json(
        { error: 'Resolution timed out', status: 'error' },
        { status: 502 },
      );
    }
    console.warn(`[address-resolve] error market=${market}`, err);
    return NextResponse.json({ error: 'Resolution failed', status: 'error' }, { status: 502 });
  }
}
