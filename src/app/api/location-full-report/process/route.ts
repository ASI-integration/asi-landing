import { NextRequest, NextResponse } from 'next/server';
import {
  getLocationReportRequestById,
} from '@/lib/location/report-request-store';
import { generateAndAttachLocationReportForRequest } from '@/lib/location/full-report-generation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

  const entity = await getLocationReportRequestById(requestId);
  if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Idempotency: if already done, return the result.
  if (entity.status === 'completed' && entity.report_id) {
    return NextResponse.json({
      status: 'completed',
      access_status: entity.access_status,
      reportId: entity.report_id,
    });
  }
  if (entity.status === 'processing') {
    return NextResponse.json({ status: 'processing' }, { status: 202 });
  }

  try {
    const { reportId } = await generateAndAttachLocationReportForRequest(requestId);
    const updated = await getLocationReportRequestById(requestId);

    return NextResponse.json({
      status: 'completed',
      access_status: updated?.access_status ?? entity.access_status,
      reportId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'address_not_found') return NextResponse.json({ status: 'failed', error: msg }, { status: 404 });
    if (msg === 'already_processing') return NextResponse.json({ status: 'processing' }, { status: 202 });
    return NextResponse.json({ status: 'failed', error: msg }, { status: 502 });
  }
}

