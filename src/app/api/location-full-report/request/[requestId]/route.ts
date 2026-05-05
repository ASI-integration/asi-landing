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
      report_request_id: entity.id,
      status: entity.status,
      access_status: entity.access_status,
      payment_provider: entity.payment_provider,
      payment_id: entity.payment_id,
      payment_url: entity.payment_url,
      payment_confirmed_at: entity.payment_confirmed_at,
      product_type: entity.product_type,
      reportId: entity.report_id,
      error: entity.error,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
      mode: entity.mode,
      locale: entity.locale,
      next_action: (entity.access_status === 'generated' || entity.access_status === 'granted') && entity.report_id
        ? {
          type: 'open_report',
          url: entity.locale === 'ru'
            ? `/ru/location-report/${entity.report_id}`
            : `/location-report/${entity.report_id}`,
        }
        : entity.access_status === 'paid'
          ? { type: 'generate_report' }
          : entity.access_status === 'granted'
            ? { type: 'processing_unlocked' }
          : entity.access_status === 'pending_payment'
            ? {
              type: 'payment_required',
              url: entity.payment_url ?? (entity.locale === 'ru'
                ? `/ru/location-report?requestId=${encodeURIComponent(entity.id)}`
                : `/location-report`),
            }
            : { type: 'wait' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'read_failed', detail: msg }, { status: 502 });
  }
}

