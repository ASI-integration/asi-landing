/**
 * POST /api/location-geocode
 *
 * Resolves a plain address string to lat/lon coordinates.
 * Checks the persistent location cache first (via address_key index) —
 * if the address has already been analysed we return the cached coords
 * without hitting Nominatim.
 *
 * On cache miss: Google Geocoding (all locales), then
 * Nominatim → Photon if needed.
 * The result (coords + displayName) is returned to the caller so they can
 * proceed to POST /api/location-demo-analyze with the resolved lat/lon.
 *
 * Accepts:  { address: string }
 * Returns:  { address: string; lat: number; lon: number; fromCache: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { geocodePlainAddressForMarket } from '@/lib/location/address-providers/geocode-pipeline';
import type { AddressMarket } from '@/lib/location/address-providers/types';
import { normalizeAddress, cacheGetByAddress } from '@/lib/location/cache';

export const dynamic = 'force-dynamic';

function parseMarket(v: unknown): AddressMarket {
  return v === 'ru' ? 'ru' : 'en';
}

export async function POST(req: NextRequest) {
  let rawAddress: string;
  let market: AddressMarket = 'en';

  try {
    const body = await req.json() as { address?: unknown; locale?: unknown };
    if (typeof body.address !== 'string' || !body.address.trim()) {
      return NextResponse.json({ error: 'Укажите адрес' }, { status: 400 });
    }
    rawAddress = body.address.trim();
    if (body.locale !== undefined) {
      market = parseMarket(body.locale);
    }
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

  // ── Geocode chain (market primary → Nominatim → Photon) ────────────────────
  const { result } = await geocodePlainAddressForMarket(market, rawAddress);

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
