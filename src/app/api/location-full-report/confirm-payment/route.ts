import { NextRequest, NextResponse } from 'next/server';
import { confirmLocationReportManualPayment } from '@/lib/location/report-request-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

  try {
    const entity = await confirmLocationReportManualPayment(requestId);

    return NextResponse.json({
      requestId: entity.id,
      report_request_id: entity.id,
      status: entity.status,
      access_status: entity.access_status,
      payment_confirmed_at: entity.payment_confirmed_at,
      payment_provider: entity.payment_provider,
      payment_url: entity.payment_url,
      product_type: entity.product_type,
      reportId: entity.report_id,
      next_action: {
        type: 'open_report',
        url: `/ru/location-report/${entity.report_id}`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (msg === 'report_not_ready') {
      return NextResponse.json({
        error: 'report_not_ready',
        next_action: { type: 'wait', message: 'подготовка отчёта...' },
      }, { status: 409 });
    }
    return NextResponse.json({ error: 'confirm_failed', detail: msg }, { status: 502 });
  }
}
