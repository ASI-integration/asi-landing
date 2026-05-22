import { buildLocationReportPermalink } from './report-state';
import type { ReportGatewayAccessResult } from './report-gateway';
import { REPORT_GATEWAY_ACCESS_STATUS } from './report-gateway';

export function reportGatewayLegacyFullHref(reportId: string): string {
  return buildLocationReportPermalink({ reportId, locale: 'ru', surface: 'ru-public' });
}

export function reportGatewayLegacyPdfHref(reportId: string): string {
  const encodedReportId = encodeURIComponent(reportId);
  return `/api/location-report/${encodedReportId}/pdf`;
}

export function isReportGatewayAccessGranted(
  result: ReportGatewayAccessResult,
  intent: 'preview' | 'full' | 'pdf',
): boolean {
  if (result.status === REPORT_GATEWAY_ACCESS_STATUS.denied) return false;
  if (intent === 'pdf') return result.access.can_download_pdf;
  if (intent === 'preview') return result.access.can_view_preview;
  return result.status === REPORT_GATEWAY_ACCESS_STATUS.full || result.access.can_view_full;
}
