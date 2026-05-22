import { NextRequest, NextResponse } from 'next/server';
import {
  getLocationReportRequestById,
  markLocationReportRequestPaymentUnlocked,
} from '@/lib/location/report-request-store';
import { REPORT_ARTIFACT_STATUS } from '@/lib/location/report-artifact';
import { processPaidReportRequest } from '@/lib/location/paid-report-orchestration';
import { buildLocationReportStatusHref } from '@/lib/location/report-status-flow';
import { ReportPipelineNotReadyError } from '@/lib/location/report-pipeline-not-ready-error';
import { toReportPipelineNotReadyPayload } from '@/lib/location/report-pipeline-readiness';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

function hasManualConfirmation(req: NextRequest): boolean {
  const configured = process.env.LOCATION_REPORT_MANUAL_CONFIRM_KEY?.trim();
  if (!configured) return false;
  const supplied = req.headers.get('x-location-report-confirmation')?.trim();
  return supplied === configured;
}

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

  const paymentUnlocked = entity.payment_status === 'paid_unlocked';
  const manuallyConfirmed = hasManualConfirmation(req);

  if (entity.access_tier === 'paid_required' && !paymentUnlocked && !manuallyConfirmed) {
    return NextResponse.json(
      {
        status: entity.status,
        paymentStatus: entity.payment_status,
        error: 'manual_confirmation_required',
        note: entity.locale === 'ru'
          ? 'Полный отчёт формируется после оплаты или ручного подтверждения заказа.'
          : 'The full report is generated after payment or manual order confirmation.',
      },
      { status: 403 },
    );
  }

  if (entity.access_tier === 'paid_required' && manuallyConfirmed && !paymentUnlocked) {
    await markLocationReportRequestPaymentUnlocked(requestId);
  }

  try {
    const reportArtifact = await processPaidReportRequest(requestId);
    return NextResponse.json({
      status: reportArtifact.status,
      report_artifact: reportArtifact,
      paymentStatus: 'paid_unlocked',
    });
  } catch (err) {
    if (err instanceof ReportPipelineNotReadyError) {
      return NextResponse.json(
        {
          requestId,
          status: REPORT_ARTIFACT_STATUS.reportForming,
          paymentStatus: 'paid_unlocked',
          next: buildLocationReportStatusHref(undefined, requestId),
          ...toReportPipelineNotReadyPayload(err.readiness),
        },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'failed', error: msg }, { status: 502 });
  }
}

