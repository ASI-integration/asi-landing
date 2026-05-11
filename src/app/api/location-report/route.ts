/**
 * POST /api/location-report
 *
 * Paywalled wrapper around the existing location scoring output.
 * Core calculation is unchanged: we compute the full result and then
 * trim fields for preview mode.
 *
 * TODO(location-decision-kernel): optionally attach `attachLocationDecisionToAnalysis` on the JSON
 * payload so previews reuse the same Decision spine as `/api/location-demo-analyze`.
 *
 * Request body:
 *   { address: string; is_paid: boolean; locale?: "ru" | "en" }
 *
 * Response:
 *   {
 *     address: string;
 *     lat: number;
 *     lon: number;
 *     report: { is_preview, ... }  // preview or full
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { geocodePlainAddressForMarket } from '@/lib/location/address-providers/geocode-pipeline';
import type { AddressMarket } from '@/lib/location/address-providers/types';
import { normalizeAddress, cacheGetByAddress, cacheSet } from '@/lib/location/cache';
import { fetchOsmData, buildAnalysis, wrapLocationReport, applyLocationDataIntegrityGate } from '@/lib/location';
import { buildLocationReportResultMetadata } from '@/lib/location/report-result-metadata';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function parseMarket(v: unknown): AddressMarket {
  return v === 'ru' ? 'ru' : 'en';
}

function sourceLabel(usedFallback: boolean | undefined): string {
  return usedFallback ? 'osm-overpass+fallback' : 'osm-overpass';
}

export async function POST(req: NextRequest) {
  let rawAddress: string;
  let isPaid: boolean;
  let market: AddressMarket = 'en';

  try {
    const body = await req.json() as { address?: unknown; is_paid?: unknown; locale?: unknown };
    if (typeof body.address !== 'string' || !body.address.trim()) {
      return NextResponse.json({ error: 'address required' }, { status: 400 });
    }
    if (typeof body.is_paid !== 'boolean') {
      return NextResponse.json({ error: 'is_paid required' }, { status: 400 });
    }
    rawAddress = body.address.trim();
    isPaid = body.is_paid;
    if (body.locale !== undefined) market = parseMarket(body.locale);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // ── Resolve coords ─────────────────────────────────────────────────────────
  let lat: number | null = null;
  let lon: number | null = null;

  const cachedByAddr = await cacheGetByAddress(rawAddress);
  if (cachedByAddr?.entry.lat != null && cachedByAddr.entry.lon != null) {
    lat = cachedByAddr.entry.lat;
    lon = cachedByAddr.entry.lon;
  } else {
    const { result } = await geocodePlainAddressForMarket(market, rawAddress);
    if (!result) {
      return NextResponse.json(
        { error: 'Адрес не найден. Уточните название или добавьте город.' },
        { status: 404 },
      );
    }
    lat = result.lat;
    lon = result.lon;
  }

  // ── Compute full analysis (core logic) ─────────────────────────────────────
  try {
    const { elements, hadProviderFailure, usedFallbackQuery } = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon);
    applyLocationDataIntegrityGate(analysis, {
      lat,
      lon,
      rawObjectsCount: elements.length,
      hadProviderFailure,
      usedFallbackQuery,
      cacheServed: false,
    });
    const locationScore = analysis.locationScore;

    if (!locationScore) {
      return NextResponse.json({ error: 'locationScore unavailable' }, { status: 502 });
    }

    // Cache the analysis under the resolved coords (reuses existing cache; no new services)
    try {
      if (!analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData) {
        const src = sourceLabel(usedFallbackQuery);
        await cacheSet(lat, lon, analysis, src, elements.length);
      }
    } catch {
      // cache is best-effort; do not fail the request
    }

    if (elements.length === 0) {
      console.warn(
        `[location-report] magnet_provider status=${hadProviderFailure ? 'unavailable' : 'empty_area'} lat=${lat} lon=${lon}`,
      );
    }

    const report = wrapLocationReport(locationScore, isPaid);
    const normalizedAddr = normalizeAddress(rawAddress);
    const calculatedAtIso = new Date().toISOString();
    const metadata = buildLocationReportResultMetadata({
      inputAddress: rawAddress,
      normalizedAddress: normalizedAddr,
      reportMode: isPaid ? 'paid' : 'free',
      calculatedAtIso,
    });

    return NextResponse.json({
      address: normalizedAddr,
      lat,
      lon,
      report,
      metadata,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[location-report] failed address="${rawAddress}": ${msg}`);
    return NextResponse.json({ error: 'analysis_failed', detail: msg }, { status: 502 });
  }
}

