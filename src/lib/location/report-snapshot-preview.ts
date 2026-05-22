import { canonicalDocumentToWebViewModel, type CanonicalReportWebViewModel } from './report-document-render';
import type { ReportSnapshotRepository } from './report-snapshot-repository';
import type { ReportSnapshot } from './report-snapshot';
import type { CanonicalReportLayer } from './canonical-report-document';

export type ReportSnapshotPreviewModel = {
  snapshot_id: string;
  request_id: string;
  report_id: string | null;
  version: number;
  report_layer: CanonicalReportLayer;
  generated_at: string | null;
  web: CanonicalReportWebViewModel;
};

export type ResolveLatestReportSnapshotOptions = {
  reportLayer?: CanonicalReportLayer;
};

export async function resolveLatestReportSnapshot(
  requestId: string,
  repository: ReportSnapshotRepository,
  options: ResolveLatestReportSnapshotOptions = {},
): Promise<ReportSnapshot | null> {
  return repository.getLatestSnapshot(requestId, options);
}

export function reportSnapshotToPreviewModel(snapshot: ReportSnapshot): ReportSnapshotPreviewModel {
  return {
    snapshot_id: snapshot.snapshot_id,
    request_id: snapshot.request_id,
    report_id: snapshot.report_id,
    version: snapshot.version,
    report_layer: snapshot.report_layer,
    generated_at: snapshot.generated_at,
    web: canonicalDocumentToWebViewModel(snapshot.canonical_document),
  };
}
