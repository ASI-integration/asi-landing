import type { CanonicalReportRenderOutputsMetadata } from './report-artifact';
import {
  canonicalDocumentToDashboardViewModel,
  canonicalDocumentToPdfViewModel,
  canonicalDocumentToWebViewModel,
  type CanonicalReportDashboardViewModel,
  type CanonicalReportPdfViewModel,
  type CanonicalReportWebViewModel,
} from './report-document-render';
import {
  collectLifecycleActions,
  evaluateMaterializedReportLifecycle,
  type MaterializedReportLifecycleEvaluation,
  type ReportLifecycleAction,
} from './report-lifecycle-resolver';
import type { ReportLifecyclePolicyOverrides } from './report-lifecycle-policy';
import {
  collectStaleMaterializedIds,
  isMaterializedReportFresh,
  MATERIALIZED_REPORT_TARGET,
  MATERIALIZED_REPORT_TARGETS,
  type MaterializedReport,
  type MaterializedReportTarget,
} from './report-materialized';
import type { ReportSnapshot } from './report-snapshot';
import type { ReportSnapshotPreviewModel } from './report-snapshot-preview';
import { reportSnapshotToPreviewModel } from './report-snapshot-preview';
import { recordReportMaterializationLifecycleAudit } from './report-audit';

export type ReportGatewayRenderSource =
  | 'materialized'
  | 'snapshot_render'
  | 'canonical_fallback';

export type ReportGatewayRenderLifecycle = {
  per_target: Record<MaterializedReportTarget, MaterializedReportLifecycleEvaluation | null>;
  actions: ReportLifecycleAction[];
  expired_materialized_ids: string[];
  time_stale_materialized_ids: string[];
  recommend_lazy_regeneration_targets: MaterializedReportTarget[];
};

export type ReportGatewayRenderTargets = {
  web: CanonicalReportWebViewModel;
  pdf: CanonicalReportPdfViewModel;
  dashboard: CanonicalReportDashboardViewModel;
  preview: ReportSnapshotPreviewModel;
  source: ReportGatewayRenderSource;
  sources: {
    web: ReportGatewayRenderSource;
    pdf: ReportGatewayRenderSource;
    dashboard: ReportGatewayRenderSource;
    preview: ReportGatewayRenderSource;
  };
  stale_materialized_ids: string[];
  lifecycle: ReportGatewayRenderLifecycle;
};

export type ResolveReportGatewayRenderTargetsOptions = {
  materialized?: readonly MaterializedReport[];
  now?: Date;
  lifecyclePolicies?: ReportLifecyclePolicyOverrides;
  onStaleMaterialized?: (materializedIds: string[]) => void;
};

function hasSnapshotRenderPayload(outputs: CanonicalReportRenderOutputsMetadata | null | undefined): boolean {
  if (!outputs) return false;
  return Boolean(outputs.web || outputs.pdf || outputs.dashboard);
}

function pickMaterializedPayload<T>(
  materialized: readonly MaterializedReport[],
  snapshot: ReportSnapshot,
  target: MaterializedReport['target'],
  now: Date,
): { payload: T; materialized_id: string } | null {
  const row = materialized.find(item => item.target === target);
  if (!row || !isMaterializedReportFresh(row, snapshot.version, now)) return null;
  const evaluation = evaluateMaterializedReportLifecycle(row, snapshot.version, {}, now);
  if (evaluation.stale || evaluation.expired) return null;
  return { payload: row.payload as T, materialized_id: row.materialized_id };
}

function resolveTargetPayload<T>(
  snapshot: ReportSnapshot,
  target: 'web' | 'pdf' | 'dashboard',
  materialized: readonly MaterializedReport[],
  outputs: CanonicalReportRenderOutputsMetadata | null | undefined,
  fallback: T,
  outputKey: 'web' | 'pdf' | 'dashboard',
  now: Date,
): { value: T; source: ReportGatewayRenderSource } {
  const fromMaterialized = pickMaterializedPayload<T>(materialized, snapshot, target, now);
  if (fromMaterialized) {
    return { value: fromMaterialized.payload, source: 'materialized' };
  }

  const rendered = outputs?.[outputKey];
  if (rendered) {
    return { value: rendered as T, source: 'snapshot_render' };
  }

  return { value: fallback, source: 'canonical_fallback' };
}

function buildGatewayRenderLifecycle(
  snapshot: ReportSnapshot,
  materialized: readonly MaterializedReport[],
  options: ResolveReportGatewayRenderTargetsOptions,
  now: Date,
): ReportGatewayRenderLifecycle {
  const policyOverrides = options.lifecyclePolicies ?? {};
  const evaluations = materialized.map(row =>
    evaluateMaterializedReportLifecycle(row, snapshot.version, policyOverrides, now),
  );
  const actions = collectLifecycleActions({
    materialized,
    snapshotVersion: snapshot.version,
    policyOverrides,
    now,
  });

  const perTarget = Object.fromEntries(
    MATERIALIZED_REPORT_TARGETS.map(target => {
      const row = materialized.find(item => item.target === target);
      if (!row) return [target, null];
      return [
        target,
        evaluateMaterializedReportLifecycle(row, snapshot.version, policyOverrides, now),
      ];
    }),
  ) as ReportGatewayRenderLifecycle['per_target'];

  return {
    per_target: perTarget,
    actions,
    expired_materialized_ids: evaluations.filter(item => item.expired).map(item => item.materialized_id),
    time_stale_materialized_ids: evaluations.filter(item => item.time_stale).map(item => item.materialized_id),
    recommend_lazy_regeneration_targets: evaluations
      .filter(item => item.recommend_lazy_regeneration)
      .map(item => item.target),
  };
}

export function resolveReportGatewayRenderTargets(
  snapshot: ReportSnapshot | null,
  options: ResolveReportGatewayRenderTargetsOptions = {},
): ReportGatewayRenderTargets | null {
  if (!snapshot) return null;

  const document = snapshot.canonical_document;
  const outputs = snapshot.render_outputs;
  const materialized = options.materialized ?? [];
  const now = options.now ?? new Date();
  const versionStaleMaterializedIds = collectStaleMaterializedIds(snapshot.version, materialized);
  const lifecycle = buildGatewayRenderLifecycle(snapshot, materialized, options, now);
  const markStaleIds = lifecycle.actions
    .filter(action => action.type === 'mark_stale')
    .map(action => action.materialized_id);
  const idsToMarkStale = [...new Set([...versionStaleMaterializedIds, ...markStaleIds])];
  if (idsToMarkStale.length > 0) {
    options.onStaleMaterialized?.(idsToMarkStale);
  }

  const fallbackWeb = canonicalDocumentToWebViewModel(document);
  const fallbackPdf = canonicalDocumentToPdfViewModel(document);
  const fallbackDashboard = canonicalDocumentToDashboardViewModel(document);
  const fallbackPreview = reportSnapshotToPreviewModel(snapshot);

  const web = resolveTargetPayload(
    snapshot,
    MATERIALIZED_REPORT_TARGET.web,
    materialized,
    outputs,
    fallbackWeb,
    'web',
    now,
  );
  const pdf = resolveTargetPayload(
    snapshot,
    MATERIALIZED_REPORT_TARGET.pdf,
    materialized,
    outputs,
    fallbackPdf,
    'pdf',
    now,
  );
  const dashboard = resolveTargetPayload(
    snapshot,
    MATERIALIZED_REPORT_TARGET.dashboard,
    materialized,
    outputs,
    fallbackDashboard,
    'dashboard',
    now,
  );

  const previewMaterialized = pickMaterializedPayload<ReportSnapshotPreviewModel>(
    materialized,
    snapshot,
    MATERIALIZED_REPORT_TARGET.preview,
    now,
  );
  const preview = previewMaterialized
    ? { value: previewMaterialized.payload, source: 'materialized' as const }
    : {
        value: fallbackPreview,
        source: hasSnapshotRenderPayload(outputs) ? 'snapshot_render' as const : 'canonical_fallback' as const,
      };

  const sources = {
    web: web.source,
    pdf: pdf.source,
    dashboard: dashboard.source,
    preview: preview.source,
  };
  const sourceValues = Object.values(sources);
  const source: ReportGatewayRenderSource = sourceValues.every(item => item === 'materialized')
    ? 'materialized'
    : sourceValues.every(item => item === 'canonical_fallback')
      ? 'canonical_fallback'
      : 'snapshot_render';

  const allStaleIds = [
    ...new Set([
      ...versionStaleMaterializedIds,
      ...lifecycle.time_stale_materialized_ids,
      ...lifecycle.expired_materialized_ids,
    ]),
  ];
  if (lifecycle.expired_materialized_ids.length > 0 || allStaleIds.length > 0) {
    void recordReportMaterializationLifecycleAudit({
      request_id: snapshot.request_id,
      report_id: snapshot.report_id,
      snapshot_id: snapshot.snapshot_id,
      stale_materialized_ids: allStaleIds,
      expired_materialized_ids: lifecycle.expired_materialized_ids,
    });
  }

  return {
    web: web.value,
    pdf: pdf.value,
    dashboard: dashboard.value,
    preview: preview.value,
    source,
    sources,
    stale_materialized_ids: allStaleIds,
    lifecycle,
  };
}
