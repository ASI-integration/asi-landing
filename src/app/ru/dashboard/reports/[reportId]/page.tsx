import { redirect } from 'next/navigation';

export default async function RuDashboardReportPage(
  props: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await props.params;
  redirect(`/dashboard/reports/${encodeURIComponent(reportId)}`);
}
