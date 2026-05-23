import type {
  ReportInput,
  ReportLifecycleStatus,
  ReportLocale,
  ReportMode,
  ReportSource,
  ReportStateRecord,
} from './report-contract';

export type ReportPermalinkSurface = 'public' | 'ru-public' | 'dashboard';

export const LOCATION_REPORT_PRODUCT_PATH = '/ru/otchet-po-dohodnosti-obektov' as const;
export const LOCATION_REPORT_SAMPLE_PATH = '/ru/location-report/sample' as const;
export const LOCATION_REPORT_SAMPLE_PRINT_PATH = '/ru/location-report/sample/print' as const;
export const LOCATION_REPORT_SAMPLE_PDF_PATH = '/ru/location-report/sample/pdf' as const;
export const LOCATION_REPORT_STATUS_PATH = '/ru/location-report/status' as const;
export const LEGACY_REPORT_REDIRECT_PATH = LOCATION_REPORT_SAMPLE_PATH;

export function buildLocationReportPermalink(args: {
  reportId: string;
  locale?: ReportLocale;
  surface?: ReportPermalinkSurface;
}): string {
  const encodedReportId = encodeURIComponent(args.reportId);
  if (args.surface === 'dashboard') return `/dashboard/reports/${encodedReportId}`;
  if (args.locale === 'ru' || args.surface === 'ru-public') return `/ru/location-report/${encodedReportId}`;
  return `/location-report/${encodedReportId}`;
}

export function createReportStateRecord(args: {
  reportId?: string;
  requestId?: string;
  status: ReportLifecycleStatus;
  source: ReportSource;
  input?: ReportInput;
  locale?: ReportLocale;
  mode?: ReportMode;
  error?: string;
}): ReportStateRecord {
  const createdAtIso = new Date().toISOString();
  const permalink = args.reportId
    ? buildLocationReportPermalink({
        reportId: args.reportId,
        locale: args.input?.locale ?? args.locale,
      })
    : undefined;

  return {
    reportId: args.reportId,
    requestId: args.requestId,
    status: args.status,
    source: args.source,
    createdAtIso,
    updatedAtIso: createdAtIso,
    permalink,
    input: args.input,
    error: args.error,
  };
}

export function createPreviewReportInput(args: {
  address: string;
  locale: ReportLocale;
  mode: ReportMode;
  lat?: number | null;
  lon?: number | null;
}): ReportInput {
  return {
    address: args.address,
    locale: args.locale,
    mode: args.mode,
    requestedAtIso: new Date().toISOString(),
    coordinates:
      typeof args.lat === 'number' &&
      Number.isFinite(args.lat) &&
      typeof args.lon === 'number' &&
      Number.isFinite(args.lon)
        ? { lat: args.lat, lon: args.lon }
        : undefined,
  };
}
