import { NextRequest, NextResponse } from 'next/server';
import {
  getLocationReportRequestById,
  markLocationReportRequestPaymentUnlocked,
} from '@/lib/location/report-request-store';
import { isYooKassaEnabled, YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

export const dynamic = 'force-dynamic';

function isPaymentSimulationAllowed(): boolean {
  if (isYooKassaEnabled()) return false;
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ requestId: string }> }) {
  if (!isPaymentSimulationAllowed()) {
    return NextResponse.json(
      {
        error: 'simulation_disabled',
        message: YOOKASSA_PENDING_REVIEW_MESSAGE,
      },
      { status: 403 },
    );
  }

  const { requestId } = await ctx.params;
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

  try {
    const entity = await getLocationReportRequestById(requestId);
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (entity.access_tier !== 'paid_required') {
      return NextResponse.json({ error: 'not_paid_required' }, { status: 400 });
    }

    if (entity.payment_status !== 'paid_unlocked') {
      await markLocationReportRequestPaymentUnlocked(requestId);
    }

    return NextResponse.json({
      requestId,
      status: entity.status,
      paymentStatus: 'paid_unlocked',
      reportId: entity.report_id,
      yookassa: 'disabled',
      next: `/dashboard/reports/${encodeURIComponent(entity.report_id ?? requestId)}`,
      process: {
        method: 'POST',
        url: '/api/location-full-report/process',
        body: { requestId },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'simulation_failed', detail: msg }, { status: 502 });
  }
}
