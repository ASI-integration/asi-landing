import type {
  CanonicalReportDashboardViewModel,
  CanonicalReportPdfViewModel,
  CanonicalReportWebViewModel,
} from './report-document-render';
import type { MaterializedReportLifecycleMetadata } from './report-lifecycle-policy';
import type { ReportSnapshotPreviewModel } from './report-snapshot-preview';

export const MATERIALIZED_REPORT_TARGET = {
  web: 'web',
  pdf: 'pdf',
  dashboard: 'dashboard',
  preview: 'preview',
} as const;

export const MATERIALIZED_REPORT_TARGETS = [
  MATERIALIZED_REPORT_TARGET.web,
  MATERIALIZED_REPORT_TARGET.pdf,
  MATERIALIZED_REPORT_TARGET.dashboard,
  MATERIALIZED_REPORT_TARGET.preview,
] as const;

export type MaterializedReportTarget = (typeof MATERIALIZED_REPORT_TARGETS)[number];

export const MATERIALIZED_REPORT_STATUS = {
  ready: 'ready',
  stale: 'stale',
  rebuilding: 'rebuilding',
  failed: 'failed',
} as const;

export const MATERIALIZED_REPORT_STATUSES = [
  MATERIALIZED_REPORT_STATUS.ready,
  MATERIALIZED_REPORT_STATUS.stale,
  MATERIALIZED_REPORT_STATUS.rebuilding,
  MATERIALIZED_REPORT_STATUS.failed,
] as const;

export type MaterializedReportStatus = (typeof MATERIALIZED_REPORT_STATUSES)[number];

export type MaterializedReportPayloadByTarget = {
  web: CanonicalReportWebViewModel;
  pdf: CanonicalReportPdfViewModel;
  dashboard: CanonicalReportDashboardViewModel;
  preview: ReportSnapshotPreviewModel;
};

export type MaterializedReportPayload = MaterializedReportPayloadByTarget[MaterializedReportTarget];

export type MaterializedReportMetadata = Record<string, unknown> & {
  renderer_id?: string;
  materialized_at?: string;
  source?: 'renderer' | 'snapshot_render_outputs' | 'canonical_fallback';
  lifecycle?: MaterializedReportLifecycleMetadata;
};

export type MaterializedReport = {
  materialized_id: string;
  snapshot_id: string;
  report_id: string | null;
  target: MaterializedReportTarget;
  version: number;
  status: MaterializedReportStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  payload: MaterializedReportPayload;
  metadata: MaterializedReportMetadata;
};

export type UpsertMaterializedReportInput = {
  materialized_id?: string;
  snapshot_id: string;
  report_id?: string | null;
  target: MaterializedReportTarget;
  version: number;
  status?: MaterializedReportStatus;
  expires_at?: string | null;
  payload: MaterializedReportPayload;
  metadata?: MaterializedReportMetadata;
  created_at?: string;
  updated_at?: string;
};

export type GetMaterializedReportQuery = {
  snapshot_id: string;
  target: MaterializedReportTarget;
};

export type ListMaterializedReportsOptions = {
  snapshot_id?: string;
  report_id?: string;
  target?: MaterializedReportTarget;
  status?: MaterializedReportStatus;
  limit?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function isMaterializedReportTarget(value: unknown): value is MaterializedReportTarget {
  return typeof value === 'string' && MATERIALIZED_REPORT_TARGETS.includes(value as MaterializedReportTarget);
}

export function isMaterializedReportStatus(value: unknown): value is MaterializedReportStatus {
  return typeof value === 'string' && MATERIALIZED_REPORT_STATUSES.includes(value as MaterializedReportStatus);
}

export function normalizeMaterializedReportStatus(
  value: unknown,
  fallback: MaterializedReportStatus = MATERIALIZED_REPORT_STATUS.ready,
): MaterializedReportStatus {
  return isMaterializedReportStatus(value) ? value : fallback;
}

export function buildMaterializedReport(input: UpsertMaterializedReportInput): MaterializedReport {
  const timestamp = input.updated_at ?? input.created_at ?? nowIso();
  return {
    materialized_id: input.materialized_id ?? crypto.randomUUID(),
    snapshot_id: input.snapshot_id,
    report_id: input.report_id ?? null,
    target: input.target,
    version: input.version,
    status: input.status ?? MATERIALIZED_REPORT_STATUS.ready,
    created_at: input.created_at ?? timestamp,
    updated_at: timestamp,
    expires_at: input.expires_at ?? null,
    payload: input.payload,
    metadata: input.metadata ?? {},
  };
}

export function isMaterializedReportFresh(
  materialized: MaterializedReport,
  snapshotVersion: number,
  now: Date = new Date(),
): boolean {
  if (materialized.status !== MATERIALIZED_REPORT_STATUS.ready) return false;
  if (materialized.version !== snapshotVersion) return false;
  if (materialized.expires_at && new Date(materialized.expires_at) <= now) return false;
  return true;
}

export function collectStaleMaterializedIds(
  snapshotVersion: number,
  materialized: readonly MaterializedReport[],
): string[] {
  return materialized
    .filter(
      row =>
        row.status === MATERIALIZED_REPORT_STATUS.ready
        && row.version !== snapshotVersion,
    )
    .map(row => row.materialized_id);
}
