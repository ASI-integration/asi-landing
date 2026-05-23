import type { Metadata } from 'next';
import Link from 'next/link';
import { REPORT_ARTIFACT_STATUS } from '@/lib/location/report-artifact';
import { LOCATION_REPORT_PRODUCT_PATH } from '@/lib/location/report-state';
import {
  LOCATION_REPORT_STATUS_DELIVERY_HINT,
  normalizeLocationReportStatusStage,
} from '@/lib/location/report-status-flow';
import { StatusProgressClient } from './StatusProgressClient';

export const metadata: Metadata = {
  title: 'Формирование полного отчёта — ASI',
  description: 'Статус формирования полного отчёта после оплаты.',
  robots: { index: false, follow: false },
};

export default function RuLocationReportStatusPage(props: {
  searchParams?: { stage?: string; requestId?: string };
}) {
  const requestId = typeof props.searchParams?.requestId === 'string'
    ? props.searchParams.requestId.trim()
    : '';
  const activeStatus = requestId
    ? REPORT_ARTIFACT_STATUS.reportForming
    : normalizeLocationReportStatusStage(props.searchParams?.stage);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-slate-800/70 bg-slate-900/30 p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Статус платного отчёта</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Отчёт формируется</h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-200 sm:text-base">
            Оплата прошла. Отчёт формируется — ссылки появятся по мере готовности.
            {' '}
            {LOCATION_REPORT_STATUS_DELIVERY_HINT}
          </p>

          <StatusProgressClient initialStatus={activeStatus} requestId={requestId || undefined} />

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={LOCATION_REPORT_PRODUCT_PATH}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:text-white"
            >
              Вернуться к форме отчёта
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
