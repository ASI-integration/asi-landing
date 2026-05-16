import { ReportPlaceholderClient } from './ReportPlaceholderClient';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { CommercialReportView } from '@/components/location/CommercialReportView';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import {
  isCanonicalLocationReportPayload,
  isLocationCommercialReport,
  isLocationStandaloneReportV1,
} from '@/lib/location/standalone-report';

export default async function DashboardReportPage(
  props: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await props.params;
  const entity = await getStandaloneReportById(reportId);
  if (entity && isCanonicalLocationReportPayload(entity.report)) {
    if (isLocationCommercialReport(entity.report)) {
      return <CommercialReportView report={entity.report} />;
    }
    if (isLocationStandaloneReportV1(entity.report) && entity.report.reportMode !== 'free') {
      return <LocationStandaloneFullReport report={entity.report} reportId={entity.id} />;
    }
  }

  return <ReportPlaceholderClient reportId={reportId} />;
}
