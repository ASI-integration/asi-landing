import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandSecondaryCta,
} from '@/components/brand';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuLocationProductNav } from '@/components/ru/RuLocationProductNav';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
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

const ANALYSIS_HREF = '/ru/location-analysis?mode=residential#location-check';

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
    <div className="min-h-screen flex flex-col font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main className="flex-1 px-5 sm:px-8 py-12 sm:py-20">
        <div className="max-w-6xl mx-auto">
          <RuLocationProductNav currentPath="/ru/location-report/status" />

          <div className="max-w-3xl border border-asi-border bg-asi-paper p-8 sm:p-10">
            <div className="flex items-center gap-3">
              <BrandLogoMark size={28} />
              <span className="font-serif text-lg text-asi-navy">ASI</span>
            </div>
            <p className="mt-6 text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
              {eyebrow}
            </p>
            <BrandHeadline as="h1" className="mt-4 text-3xl sm:text-4xl">
              {title}
            </BrandHeadline>
            <BrandGoldRule className="mt-6 mb-6" />
            <div className="max-w-3xl text-asi-navy/70 leading-relaxed">{intro}</div>
            {children}
            <div className="mt-8">
              <BrandSecondaryCta href={ANALYSIS_HREF}>К проверке адреса</BrandSecondaryCta>
            </div>
          </div>
        </div>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
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
