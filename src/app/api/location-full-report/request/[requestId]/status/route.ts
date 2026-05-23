import { NextRequest, NextResponse } from 'next/server';
import { getLocationReportRequestById } from '@/lib/location/report-request-store';
import {
  reportArtifactFromLocationReportRequest,
  toPublicReportArtifactPayload,
} from '@/lib/location/report-artifact';
import { reportArtifactRepository } from '@/lib/location/report-artifact-repository';
import { reportAccessEntitlementRepository } from '@/lib/location/report-access-entitlement-repository';
import { resolveReportAccessSummary } from '@/lib/location/report-access-resolver';
import { buildReportDeliverySummary } from '@/lib/location/report-delivery';
import { reportDeliveryRepository } from '@/lib/location/report-delivery-repository';
import { buildReportAuditSummary } from '@/lib/location/report-audit-event';
import { reportAuditRepository } from '@/lib/location/report-audit-repository';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params;
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

  try {
    const entity = await getLocationReportRequestById(requestId);
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const reportArtifact =
      (await reportArtifactRepository.getByRequestId(requestId)) ??
      reportArtifactFromLocationReportRequest(entity);
    const deliveries = await reportDeliveryRepository.getDeliveriesByRequestId(requestId);
    const delivery_summary = deliveries.length > 0
      ? buildReportDeliverySummary(deliveries)
      : undefined;
    const entitlements = await reportAccessEntitlementRepository.getActiveEntitlements(requestId);
    const access_summary = entitlements.length > 0
      ? resolveReportAccessSummary({ entitlements, requestId })
      : undefined;
    const auditEvents = await reportAuditRepository.listAuditEventsByRequestId(requestId);
    const audit_summary = auditEvents.length > 0
      ? buildReportAuditSummary(auditEvents)
      : undefined;

    return NextResponse.json({
      ...toPublicReportArtifactPayload(reportArtifact),
      access_status: entity.payment_status,
      request_status: entity.status,
      report_id: entity.report_id,
      ...(delivery_summary ? { delivery_summary } : {}),
      ...(access_summary ? { access_summary } : {}),
      ...(audit_summary ? { audit_summary } : {}),
    });
  } catch {
    return NextResponse.json({ error: 'read_failed' }, { status: 502 });
  }
}
