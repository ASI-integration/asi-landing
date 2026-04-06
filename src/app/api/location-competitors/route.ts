/**
 * POST /api/location-competitors
 *
 * Returns competitor market data (ADR, RevPAR, listing count) for a given
 * location by scraping Airbnb, Booking.com, and VRBO in parallel.
 *
 * Request body:
 *   {
 *     lat:                 number          // required
 *     lng:                 number          // required
 *     address:             string          // required — human-readable address
 *     osmCompetitorCount?: number          // from gravity engine (optional)
 *     locationScore?:      number (0–100)  // for RevPAR calibration (optional)
 *   }
 *
 * Response (200):
 *   {
 *     competitors:  number
 *     avgADR:       number    // RUB
 *     minPrice:     number    // RUB
 *     maxPrice:     number    // RUB
 *     revpar:       number    // RUB
 *     densityScore: number    // 0–1
 *     source:       "live" | "partial" | "fallback"
 *     listings:     MarketListing[]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchCompetitorData } from '@/lib/location/competitors';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // ── Parse & validate ───────────────────────────────────────────────────────
  let lat:                number;
  let lng:                number;
  let address:            string;
  let osmCompetitorCount: number | undefined;
  let locationScore:      number | undefined;

  try {
    const body = await req.json() as {
      lat?:                unknown;
      lng?:                unknown;
      address?:            unknown;
      osmCompetitorCount?: unknown;
      locationScore?:      unknown;
    };

    if (typeof body.lat !== 'number' || !Number.isFinite(body.lat)) {
      return NextResponse.json({ error: 'lat must be a finite number' }, { status: 400 });
    }
    if (typeof body.lng !== 'number' || !Number.isFinite(body.lng)) {
      return NextResponse.json({ error: 'lng must be a finite number' }, { status: 400 });
    }
    if (typeof body.address !== 'string' || !body.address.trim()) {
      return NextResponse.json({ error: 'address required' }, { status: 400 });
    }

    lat     = body.lat;
    lng     = body.lng;
    address = body.address.trim();

    if (typeof body.osmCompetitorCount === 'number' && body.osmCompetitorCount >= 0) {
      osmCompetitorCount = body.osmCompetitorCount;
    }
    if (typeof body.locationScore === 'number' &&
        body.locationScore >= 0 &&
        body.locationScore <= 100) {
      locationScore = body.locationScore;
    }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // ── Fetch competitor data ──────────────────────────────────────────────────
  try {
    const data = await fetchCompetitorData({
      lat,
      lng,
      address,
      osmCompetitorCount,
      locationScore,
    });

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[location-competitors] error lat=${lat} lng=${lng}: ${msg}`);
    return NextResponse.json(
      { error: 'Competitor analysis failed', detail: msg },
      { status: 502 },
    );
  }
}
