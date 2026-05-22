import { resolveEmailDeliveryTarget } from './report-delivery-orchestration';
import {
  REPORT_ACCESS_LEVEL,
  REPORT_ACCESS_SUBJECT_TYPE,
  type CreateReportAccessEntitlementInput,
} from './report-access-entitlement';
import type { LocationReportRequestEntity } from './report-request-store';
import type { ReportSnapshot } from './report-snapshot';

export function planReportAccessEntitlements(
  snapshot: ReportSnapshot,
  request: Pick<LocationReportRequestEntity, 'delivery_channel' | 'delivery_target'>,
): CreateReportAccessEntitlementInput[] {
  const requestId = snapshot.request_id;
  const reportId = snapshot.report_id ?? snapshot.canonical_document.report_id ?? requestId;
  const emailTarget = resolveEmailDeliveryTarget(request);

  const planned: CreateReportAccessEntitlementInput[] = [
    {
      request_id: requestId,
      report_id: reportId,
      snapshot_id: snapshot.snapshot_id,
      subject_type: REPORT_ACCESS_SUBJECT_TYPE.guest,
      subject_id: requestId,
      access_level: REPORT_ACCESS_LEVEL.admin,
    },
    {
      request_id: requestId,
      report_id: reportId,
      snapshot_id: snapshot.snapshot_id,
      subject_type: REPORT_ACCESS_SUBJECT_TYPE.shareLink,
      subject_id: reportId,
      access_level: REPORT_ACCESS_LEVEL.fullReport,
    },
  ];

  if (emailTarget) {
    planned.push({
      request_id: requestId,
      report_id: reportId,
      snapshot_id: snapshot.snapshot_id,
      subject_type: REPORT_ACCESS_SUBJECT_TYPE.email,
      subject_id: emailTarget,
      access_level: REPORT_ACCESS_LEVEL.fullReport,
      metadata: { placeholder: true },
    });
  }

  return planned;
}
