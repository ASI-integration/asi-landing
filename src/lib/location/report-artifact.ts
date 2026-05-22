import type { CanonicalReportDocument } from './canonical-report-document';
import type {
  CanonicalReportDashboardViewModel,
  CanonicalReportPdfViewModel,
  CanonicalReportWebViewModel,
} from './report-document-render';
import { LOCATION_REPORT_SAMPLE_PATH, LOCATION_REPORT_SAMPLE_PDF_PATH } from './report-state';
import type { ReportSection } from './report-sections';
import type { ReportSignalCollectionSummary } from './report-signal-adapters';
import type {
  LocationReportPaymentStatus,
  LocationReportRequestStatus,
} from './report-request-store';

export const REPORT_ARTIFACT_STATUS = {
  reportForming: 'report_forming',
  preliminaryReady: 'preliminary_ready',
  finalReady: 'final_ready',
  pdfReady: 'pdf_ready',
  failed: 'failed',
} as const;

export const REPORT_ARTIFACT_STATUSES = [
  REPORT_ARTIFACT_STATUS.reportForming,
  REPORT_ARTIFACT_STATUS.preliminaryReady,
  REPORT_ARTIFACT_STATUS.finalReady,
  REPORT_ARTIFACT_STATUS.pdfReady,
  REPORT_ARTIFACT_STATUS.failed,
] as const;

export type ReportArtifactStatus = typeof REPORT_ARTIFACT_STATUSES[number];

export type CanonicalReportRenderOutputsMetadata = {
  rendered_at: string;
  web?: CanonicalReportWebViewModel;
  pdf?: CanonicalReportPdfViewModel;
  dashboard?: CanonicalReportDashboardViewModel;
};

export type ReportArtifactMetadata = Record<string, unknown> & {
  adapter_summary?: ReportSignalCollectionSummary;
  report_sections?: ReportSection[];
  canonical_document?: CanonicalReportDocument;
  canonical_render_outputs?: CanonicalReportRenderOutputsMetadata;
};

export type ReportArtifact = {
  request_id: string;
  status: ReportArtifactStatus;
  preliminary_report_url: string | null;
  final_report_url: string | null;
  pdf_url: string | null;
  generated_at: string | null;
  expires_at: string | null;
  cleanup_ready: boolean;
  metadata: ReportArtifactMetadata;
  created_at: string;
  updated_at: string;
};

export type LocationReportRequestArtifactSource = {
  id: string;
  payment_status: LocationReportPaymentStatus;
  status: LocationReportRequestStatus;
  report_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function isReportArtifactStatus(value: unknown): value is ReportArtifactStatus {
  return typeof value === 'string' && REPORT_ARTIFACT_STATUSES.includes(value as ReportArtifactStatus);
}

export function normalizeReportArtifactStatus(
  value: unknown,
  fallback: ReportArtifactStatus = REPORT_ARTIFACT_STATUS.reportForming,
): ReportArtifactStatus {
  return isReportArtifactStatus(value) ? value : fallback;
}

export function buildReportArtifactUrls(reportId: string | null | undefined): Pick<
  ReportArtifact,
  'preliminary_report_url' | 'final_report_url' | 'pdf_url'
> {
  if (!reportId) {
    return {
      preliminary_report_url: null,
      final_report_url: null,
      pdf_url: null,
    };
  }

  const encodedReportId = encodeURIComponent(reportId);
  const finalReportUrl = `/ru/location-report/${encodedReportId}`;
  return {
    preliminary_report_url: `${finalReportUrl}?view=preliminary`,
    final_report_url: finalReportUrl,
    pdf_url: `/api/location-report/${encodedReportId}/pdf`,
  };
}

export function createReportArtifact(args: {
  requestId: string;
  status?: ReportArtifactStatus;
  reportId?: string | null;
  now?: string;
}): ReportArtifact {
  const timestamp = args.now ?? nowIso();
  return {
    request_id: args.requestId,
    status: args.status ?? REPORT_ARTIFACT_STATUS.reportForming,
    ...buildReportArtifactUrls(args.reportId),
    generated_at: null,
    expires_at: null,
    cleanup_ready: false,
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function reportArtifactFromLocationReportRequest(
  request: LocationReportRequestArtifactSource,
): ReportArtifact {
  const timestamp = request.updated_at ?? request.created_at ?? nowIso();

  if (request.status === 'failed') {
    return {
      ...createReportArtifact({
        requestId: request.id,
        status: REPORT_ARTIFACT_STATUS.failed,
        reportId: request.report_id,
        now: timestamp,
      }),
      generated_at: null,
    };
  }

  if (request.status === 'completed' && request.report_id) {
    return {
      ...createReportArtifact({
        requestId: request.id,
        status: REPORT_ARTIFACT_STATUS.pdfReady,
        reportId: request.report_id,
        now: timestamp,
      }),
      generated_at: timestamp,
    };
  }

  if (request.status === 'processing') {
    return createReportArtifact({
      requestId: request.id,
      status: REPORT_ARTIFACT_STATUS.reportForming,
      reportId: request.report_id,
      now: timestamp,
    });
  }

  return createReportArtifact({
    requestId: request.id,
    status: REPORT_ARTIFACT_STATUS.reportForming,
    reportId: request.report_id,
    now: timestamp,
  });
}

export type PublicReportArtifactPayload = Omit<ReportArtifact, 'metadata' | 'cleanup_ready'>;

export function toPublicReportArtifactPayload(artifact: ReportArtifact): PublicReportArtifactPayload {
  const {
    metadata: _metadata,
    cleanup_ready: _cleanupReady,
    ...payload
  } = artifact;
  return payload;
}

export function reportArtifactWithSampleUrls(
  artifact: ReportArtifact,
): ReportArtifact {
  return {
    ...artifact,
    preliminary_report_url: artifact.preliminary_report_url ?? `${LOCATION_REPORT_SAMPLE_PATH}?view=preliminary`,
    final_report_url: artifact.final_report_url ?? LOCATION_REPORT_SAMPLE_PATH,
    pdf_url: artifact.pdf_url ?? LOCATION_REPORT_SAMPLE_PDF_PATH,
  };
}
