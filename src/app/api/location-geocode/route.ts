/**
 * POST /api/location-geocode
 *
 * Resolves a plain address string to lat/lon coordinates.
 * Checks the persistent location cache first (via address_key index) —
 * if the address has already been analysed we return the cached coords
 * without hitting Nominatim.
 *
 * On cache miss: Nominatim, then Photon (Komoot) if the first fails or returns empty.
 * The result (coords + displayName) is returned to the caller so they can
 * proceed to POST /api/location-demo-analyze with the resolved lat/lon.
 *
 * Accepts:  { address: string }
 * Returns:  { address: string; lat: number; lon: number; fromCache: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeAddress, cacheGetByAddress } from '@/lib/location/cache';
import { geocodeWithFallback } from '@/lib/location/providers/geocoding';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let rawAddress: string;

  try {
    const body = await req.json() as { address?: unknown };
    if (typeof body.address !== 'string' || !body.address.trim()) {
      return NextResponse.json({ error: 'Укажите адрес' }, { status: 400 });
    }
    rawAddress = body.address.trim();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  // ── Address cache lookup ───────────────────────────────────────────────────
  // If this address has been analysed before we already have lat/lon stored.
  const cached = await cacheGetByAddress(rawAddress);
  if (cached?.entry.lat != null && cached.entry.lon != null) {
    return NextResponse.json({
      address: normalizeAddress(rawAddress),
      lat: cached.entry.lat,
      lon: cached.entry.lon,
      fromCache: true,
    });
  }

  // ── Geocode chain (Nominatim → Photon) ─────────────────────────────────────
  const { result } = await geocodeWithFallback(rawAddress);

  if (!result) {
    return NextResponse.json(
      { error: 'Адрес не найден. Уточните название или добавьте город.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    address: result.displayName ?? normalizeAddress(rawAddress),
    lat: result.lat,
    lon: result.lon,
    fromCache: false,
  });
}
