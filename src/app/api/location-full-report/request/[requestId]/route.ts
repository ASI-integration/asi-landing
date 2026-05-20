import { NextRequest, NextResponse } from 'next/server';
import { getLocationReportRequestById } from '@/lib/location/report-request-store';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params;
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

  try {
    const entity = await getLocationReportRequestById(requestId);
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({
      requestId: entity.id,
      status: entity.status,
      paymentStatus: entity.payment_status,
      reportId: entity.report_id,
      address: entity.address,
      lat: entity.lat,
      lon: entity.lon,
      error: entity.error,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
      mode: entity.mode,
      locale: entity.locale,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'read_failed', detail: msg }, { status: 502 });
  }
}

