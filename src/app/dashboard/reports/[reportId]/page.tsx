import { ReportPlaceholderClient } from './ReportPlaceholderClient';

export default async function DashboardReportPage(
  props: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await props.params;
  return <ReportPlaceholderClient reportId={reportId} />;
}
