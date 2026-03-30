/**
 * POST /api/location-analyze — server-side proxy to ASI-automation-core
 *
 * asi-landing is a thin UI layer. This route forwards location analysis
 * requests to ASI-automation-core, which owns the scoring logic and the
 * Supabase-backed result cache.
 *
 * No deterministic scoring logic lives in asi-landing.
 * No Supabase cache in asi-landing for this domain.
 *
 * Accepts: { address: string; lat?: number | null; lon?: number | null }
 * Returns: { source, address, lat, lon, score, band, bandLabel, metrics, audienceScores }
 *          (contract identical to what ASI-automation-core returns — no adapter needed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeLocation } from '@/lib/core-api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let address: string;
  let lat: number | null = null;
  let lon: number | null = null;

  try {
    const body = await req.json() as { address?: unknown; lat?: unknown; lon?: unknown };
    if (typeof body.address !== 'string' || !body.address.trim()) {
      return NextResponse.json({ error: 'address required' }, { status: 400 });
    }
    address = body.address.trim();
    if (typeof body.lat === 'number') lat = body.lat;
    if (typeof body.lon === 'number') lon = body.lon;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const result = await analyzeLocation(address, lat, lon);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[location-analyze] proxy error address="${address}": ${msg}`);
    return NextResponse.json({ error: 'Не удалось запустить анализ', detail: msg }, { status: 502 });
  }
}
