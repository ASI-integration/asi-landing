import { NextRequest, NextResponse } from 'next/server';
import {
  getLocationReportRequestById,
  markLocationReportRequestPaymentUnlocked,
} from '@/lib/location/report-request-store';
import {
  buildLocationReportStatusHref,
} from '@/lib/location/report-status-flow';
import { REPORT_ARTIFACT_STATUS } from '@/lib/location/report-artifact';
import { processPaidReportRequest } from '@/lib/location/paid-report-orchestration';
import { isPaidReportRecoverableProcessingError } from '@/lib/location/location-report-engine';
import { ReportPipelineNotReadyError } from '@/lib/location/report-pipeline-not-ready-error';
import { toReportPipelineNotReadyPayload } from '@/lib/location/report-pipeline-readiness';
import { isYooKassaEnabled, YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

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
    const reportArtifact = await processPaidReportRequest(requestId);

    return NextResponse.json({
      requestId,
      status: reportArtifact.status,
      paymentStatus: 'paid_unlocked',
      report_artifact: reportArtifact,
      reportId: entity.report_id,
      yookassa: 'disabled',
      next: buildLocationReportStatusHref(undefined, requestId),
      process: { triggered: true },
    });
  } catch (err) {
    if (err instanceof ReportPipelineNotReadyError) {
      return NextResponse.json(
        {
          requestId,
          status: REPORT_ARTIFACT_STATUS.reportForming,
          paymentStatus: 'paid_unlocked',
          next: buildLocationReportStatusHref(undefined, requestId),
          process: { triggered: false },
          ...toReportPipelineNotReadyPayload(err.readiness),
        },
        { status: 503 },
      );
    }
    if (isPaidReportRecoverableProcessingError(err)) {
      return NextResponse.json(
        {
          requestId,
          status: REPORT_ARTIFACT_STATUS.reportForming,
          paymentStatus: 'paid_unlocked',
          error: 'report_processing_deferred',
          retryable: true,
          next: buildLocationReportStatusHref(undefined, requestId),
          process: { triggered: false },
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'simulation_failed' }, { status: 502 });
  }
}
