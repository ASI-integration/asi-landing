import { NextRequest, NextResponse } from 'next/server';
import { fetchOsmData, buildAnalysis } from '@/lib/location';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { lat?: unknown; lon?: unknown };
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lon = typeof body.lon === 'number' ? body.lon : null;

    if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'lat/lon required' }, { status: 400 });
    }

    const elements = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon);

    return NextResponse.json({
      analysis,
      source: 'osm-overpass',
      elementsCount: elements.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[location-demo-analyze] failed: ${message}`);
    return NextResponse.json({ error: 'analysis_failed' }, { status: 502 });
  }
}
