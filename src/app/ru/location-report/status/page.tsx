import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { LOCATION_REPORT_PRODUCT_PATH } from '@/lib/location/report-state';
import {
  isValidLocationReportRequestId,
  LOCATION_REPORT_STATUS_DELIVERY_HINT,
  LOCATION_REPORT_STATUS_INVALID_REQUEST_MESSAGE,
} from '@/lib/location/report-status-flow';
import { StatusProgressClient } from './StatusProgressClient';

export const metadata: Metadata = {
  title: 'Формирование полного отчёта — ASI',
  description: 'Статус формирования полного отчёта после оплаты.',
  robots: { index: false, follow: false },
};

function StatusPageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-slate-800/70 bg-slate-900/30 p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <div className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-200 sm:text-base">{intro}</div>
          {children}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={LOCATION_REPORT_PRODUCT_PATH}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:text-white"
            >
              Вернуться к форме
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function RuLocationReportStatusPage(props: {
  searchParams?: { requestId?: string };
}) {
  const rawRequestId = typeof props.searchParams?.requestId === 'string'
    ? props.searchParams.requestId.trim()
    : '';
  const hasRequestId = rawRequestId.length > 0;
  const requestIdValid = isValidLocationReportRequestId(rawRequestId);

  if (!hasRequestId || !requestIdValid) {
    return (
      <StatusPageShell
        eyebrow="Статус платного отчёта"
        title="Заявка не найдена"
        intro={(
          <p data-location-report-invalid-request="true">
            {LOCATION_REPORT_STATUS_INVALID_REQUEST_MESSAGE}
          </p>
        )}
      />
    );
  }

  return (
    <StatusPageShell
      eyebrow="Статус платного отчёта"
      title="Отчёт формируется"
      intro={(
        <p>
          Оплата прошла. Отчёт формируется — ссылки появятся по мере готовности.
          {' '}
          {LOCATION_REPORT_STATUS_DELIVERY_HINT}
        </p>
      )}
    >
      <StatusProgressClient requestId={rawRequestId} />
    </StatusPageShell>
  );
}
