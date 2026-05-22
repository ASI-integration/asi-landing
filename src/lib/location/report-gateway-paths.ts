export const REPORT_GATEWAY_RU_BASE = '/ru/report' as const;

export type ReportGatewaySurface = 'full' | 'preview' | 'pdf';

export function buildReportGatewayPath(
  reportId: string,
  surface: ReportGatewaySurface = 'full',
): string {
  const encodedReportId = encodeURIComponent(reportId);
  if (surface === 'preview') return `${REPORT_GATEWAY_RU_BASE}/${encodedReportId}/preview`;
  if (surface === 'pdf') return `${REPORT_GATEWAY_RU_BASE}/${encodedReportId}/pdf`;
  return `${REPORT_GATEWAY_RU_BASE}/${encodedReportId}`;
}
