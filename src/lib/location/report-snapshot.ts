import type { CanonicalReportDocument, CanonicalReportLayer, CanonicalReportSourceSummary } from './canonical-report-document';
import { isCanonicalReportDocument } from './canonical-report-document';
import type { CanonicalReportRenderOutputsMetadata } from './report-artifact';
import { REPORT_ARTIFACT_STATUS, type ReportArtifactStatus } from './report-artifact';
import type { ArtifactUpdate } from './report-producers';

export const REPORT_SNAPSHOT_STATUS = {
  ready: 'ready',
  failed: 'failed',
} as const;

export const REPORT_SNAPSHOT_STATUSES = [
  REPORT_SNAPSHOT_STATUS.ready,
  REPORT_SNAPSHOT_STATUS.failed,
] as const;

export type ReportSnapshotStatus = (typeof REPORT_SNAPSHOT_STATUSES)[number];

export type ReportSnapshotMetadata = Record<string, unknown> & {
  producer?: CanonicalReportLayer;
  artifact_status?: ReportArtifactStatus;
};

export type ReportSnapshot = {
  snapshot_id: string;
  report_id: string | null;
  request_id: string;
  version: number;
  status: ReportSnapshotStatus;
  created_at: string;
  generated_at: string | null;
  report_layer: CanonicalReportLayer;
  canonical_document: CanonicalReportDocument;
  render_outputs: CanonicalReportRenderOutputsMetadata | null;
  source_summary: CanonicalReportSourceSummary;
  metadata: ReportSnapshotMetadata;
};

export type CreateReportSnapshotInput = {
  report_id?: string | null;
  request_id: string;
  status?: ReportSnapshotStatus;
  generated_at?: string | null;
  report_layer: CanonicalReportLayer;
  canonical_document: CanonicalReportDocument;
  render_outputs?: CanonicalReportRenderOutputsMetadata | null;
  source_summary?: CanonicalReportSourceSummary;
  metadata?: ReportSnapshotMetadata;
  created_at?: string;
  snapshot_id?: string;
  version?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function isReportSnapshotStatus(value: unknown): value is ReportSnapshotStatus {
  return typeof value === 'string' && REPORT_SNAPSHOT_STATUSES.includes(value as ReportSnapshotStatus);
}

export function normalizeReportSnapshotStatus(
  value: unknown,
  fallback: ReportSnapshotStatus = REPORT_SNAPSHOT_STATUS.ready,
): ReportSnapshotStatus {
  return isReportSnapshotStatus(value) ? value : fallback;
}

export function buildReportSnapshot(input: CreateReportSnapshotInput): ReportSnapshot {
  const created_at = input.created_at ?? nowIso();
  const canonical_document = input.canonical_document;
  return {
    snapshot_id: input.snapshot_id ?? crypto.randomUUID(),
    report_id: input.report_id ?? canonical_document.report_id ?? null,
    request_id: input.request_id,
    version: input.version ?? 1,
    status: input.status ?? REPORT_SNAPSHOT_STATUS.ready,
    created_at,
    generated_at: input.generated_at ?? canonical_document.generated_at ?? null,
    report_layer: input.report_layer,
    canonical_document,
    render_outputs: input.render_outputs ?? null,
    source_summary: input.source_summary ?? canonical_document.source_summary,
    metadata: input.metadata ?? {},
  };
}

export function buildReportSnapshotFromArtifactUpdate(args: {
  requestId: string;
  reportId?: string | null;
  reportLayer: CanonicalReportLayer;
  update: ArtifactUpdate;
  artifactStatus: ReportArtifactStatus;
  now?: string;
}): CreateReportSnapshotInput | null {
  const canonical_document = args.update.metadata?.canonical_document;
  if (!canonical_document || !isCanonicalReportDocument(canonical_document)) {
    return null;
  }

  const generated_at = args.update.generated_at ?? canonical_document.generated_at ?? args.now ?? null;
  return {
    request_id: args.requestId,
    report_id: args.reportId ?? canonical_document.report_id ?? null,
    status: REPORT_SNAPSHOT_STATUS.ready,
    generated_at,
    report_layer: args.reportLayer,
    canonical_document,
    render_outputs: args.update.metadata?.canonical_render_outputs ?? null,
    metadata: {
      producer: args.reportLayer,
      artifact_status: args.artifactStatus,
    },
  };
}

export function artifactStatusForReportLayer(layer: CanonicalReportLayer): ReportArtifactStatus {
  return layer === 'preliminary'
    ? REPORT_ARTIFACT_STATUS.preliminaryReady
    : REPORT_ARTIFACT_STATUS.finalReady;
}
