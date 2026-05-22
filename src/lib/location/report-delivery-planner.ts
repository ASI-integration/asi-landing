import {
  REPORT_DELIVERY_CHANNEL,
  REPORT_DELIVERY_STATUS,
  type CreateReportDeliveryInput,
} from './report-delivery';
import type { ReportSnapshot } from './report-snapshot';
import { buildReportGatewayPath } from './report-gateway-paths';
import { LOCATION_REPORT_STATUS_PATH } from './report-state';

export type PlanReportDeliveriesOptions = {
  emailTarget?: string | null;
};

function requestQuery(requestId: string): string {
  return new URLSearchParams({ requestId }).toString();
}

export function planReportDeliveries(
  snapshot: ReportSnapshot,
  options: PlanReportDeliveriesOptions = {},
): CreateReportDeliveryInput[] {
  const requestId = snapshot.request_id;
  const query = requestQuery(requestId);
  const reportId = snapshot.report_id ?? snapshot.canonical_document.report_id ?? requestId;
  const permalinkTarget = buildReportGatewayPath(reportId, 'full');
  const pdfGatewayTarget = buildReportGatewayPath(reportId, 'pdf');

  const emailTarget =
    typeof options.emailTarget === 'string' && options.emailTarget.trim()
      ? options.emailTarget.trim()
      : null;

  const planned: CreateReportDeliveryInput[] = [
    {
      request_id: requestId,
      snapshot_id: snapshot.snapshot_id,
      channel: REPORT_DELIVERY_CHANNEL.cabinet,
      status: REPORT_DELIVERY_STATUS.ready,
      target: `${LOCATION_REPORT_STATUS_PATH}?${query}`,
    },
    {
      request_id: requestId,
      snapshot_id: snapshot.snapshot_id,
      channel: REPORT_DELIVERY_CHANNEL.permalink,
      status: REPORT_DELIVERY_STATUS.ready,
      target: permalinkTarget,
    },
    {
      request_id: requestId,
      snapshot_id: snapshot.snapshot_id,
      channel: REPORT_DELIVERY_CHANNEL.pdfDownload,
      status: REPORT_DELIVERY_STATUS.ready,
      target: pdfGatewayTarget,
    },
    {
      request_id: requestId,
      snapshot_id: snapshot.snapshot_id,
      channel: REPORT_DELIVERY_CHANNEL.email,
      status: emailTarget ? REPORT_DELIVERY_STATUS.pending : REPORT_DELIVERY_STATUS.skipped,
      target: emailTarget,
      metadata: emailTarget ? { placeholder: true } : { reason: 'missing_email_target' },
    },
  ];

  return planned;
}
