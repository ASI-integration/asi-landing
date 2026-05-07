import { Suspense } from 'react';
import { CommercialReportView } from '@/components/location/CommercialReportView';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { getLocationReportRequestById } from '@/lib/location/report-request-store';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import { isLocationCommercialReport, isLocationStandaloneReportV1 } from '@/lib/location/standalone-report';
import {
  LocationReportStatusClient,
  type RequestStatus,
} from './LocationReportStatusClient';

export const dynamic = 'force-dynamic';

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function PreparingReport() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="rounded-3xl border border-slate-800/70 bg-slate-900/20 p-8 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">подготовка отчёта...</h1>
        </div>
      </div>
    </div>
  );
}

function toRequestStatus(entity: Awaited<ReturnType<typeof getLocationReportRequestById>>): RequestStatus | null {
  if (!entity) return null;

  return {
    requestId: entity.id,
    status: entity.status,
    access_status: entity.access_status,
    payment_provider: entity.payment_provider,
    payment_id: entity.payment_id,
    payment_url: entity.payment_url,
    reportId: entity.report_id,
    error: entity.error ?? undefined,
    next_action: (entity.access_status === 'generated' || entity.access_status === 'granted') && entity.report_id
      ? {
        type: 'open_report',
        url: `/ru/location-report/${entity.report_id}`,
      }
      : entity.access_status === 'pending_payment'
        ? {
          type: 'payment_required',
          url: entity.payment_url ?? `/ru/location-report?requestId=${encodeURIComponent(entity.id)}`,
        }
        : { type: 'wait' },
  };
}

export default async function RuLocationFullReportPage(
  props: { searchParams: Promise<{ requestId?: string | string[] }> },
) {
  const searchParams = await props.searchParams;
  const requestId = firstParam(searchParams.requestId);

  if (requestId) {
    const request = await getLocationReportRequestById(requestId);

    if (request?.access_status === 'granted') {
      if (!request.report_id) return <PreparingReport />;

      const persisted = await getStandaloneReportById(request.report_id);
      if (!persisted) return <PreparingReport />;

      if (isLocationCommercialReport(persisted.report)) {
        return <CommercialReportView report={persisted.report} />;
      }

      if (isLocationStandaloneReportV1(persisted.report)) {
        return <LocationStandaloneFullReport report={persisted.report} />;
      }

      return <PreparingReport />;
    }

    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <LocationReportStatusClient initialRequestId={requestId} initialStatus={toRequestStatus(request)} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LocationReportStatusClient />
    </Suspense>
  );
}
