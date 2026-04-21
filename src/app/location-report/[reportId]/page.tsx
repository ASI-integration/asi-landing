import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { CommercialReportView } from '@/components/location/CommercialReportView';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import { isLocationStandaloneReportV1, isLocationCommercialReport } from '@/lib/location/standalone-report';

export const dynamic = 'force-dynamic';

function MissingReport() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="rounded-3xl border border-slate-800/70 bg-slate-900/20 p-8 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Location report</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Report not found</h1>
          <p className="mt-3 text-slate-300 leading-relaxed">
            This link may be expired or the report was deleted.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
            >
              Back to home
            </Link>
            <Link
              href="/features/location-analysis"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors"
            >
              Run the demo preview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function LocationReportByIdPage(props: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await props.params;
  if (!reportId) notFound();

  const entity = await getStandaloneReportById(reportId);
  if (!entity) return <MissingReport />;

  if (isLocationCommercialReport(entity.report)) {
    return <CommercialReportView report={entity.report} />;
  }

  if (!isLocationStandaloneReportV1(entity.report)) return <MissingReport />;
  return <LocationStandaloneFullReport report={entity.report} />;
}

