import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { CommercialReportView } from '@/components/location/CommercialReportView';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import {
  isCanonicalLocationReportPayload,
  isLocationCommercialReport,
  isLocationStandaloneReportV1,
} from '@/lib/location/standalone-report';
import { LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export const dynamic = 'force-dynamic';

function MissingReport() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="rounded-3xl border border-slate-800/70 bg-slate-900/20 p-8 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Отчёт не найден</h1>
          <p className="mt-3 text-slate-300 leading-relaxed">
            Ссылка устарела или отчёт был удалён. Запустите анализ заново или откройте пример отчёта.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Link
              href="/ru"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
            >
              Вернуться на главную
            </Link>
            <Link
              href={LOCATION_REPORT_SAMPLE_PATH}
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors"
            >
              Посмотреть пример отчёта
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function RuLocationReportByIdPage(props: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await props.params;
  if (!reportId) notFound();

  const entity = await getStandaloneReportById(reportId);
  if (!entity) return <MissingReport />;

  if (entity.locale !== 'ru') {
    // RU-first route: if we ever persist EN here, treat as not found for now.
    return <MissingReport />;
  }

  if (!isCanonicalLocationReportPayload(entity.report)) return <MissingReport />;

  if (isLocationCommercialReport(entity.report)) {
    return <CommercialReportView report={entity.report} />;
  }

  if (!isLocationStandaloneReportV1(entity.report)) return <MissingReport />;

  return <LocationStandaloneFullReport report={entity.report} />;
}

