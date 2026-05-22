import {
  buildCanonicalRenderOutputsForDocument,
} from './canonical-report-render-pipeline';
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
  buildMaterializedReportLifecycleMetadata,
  computeReportLifecycleTimestamps,
  type ReportLifecyclePolicyOverrides,
  resolveMaterializedReportLifecyclePolicy,
} from './report-lifecycle-policy';
import type { MaterializedReportRepository } from './report-materialized-repository';
import { reportMaterializedRepository } from './report-materialized-repository';
import {
  MATERIALIZED_REPORT_STATUS,
  MATERIALIZED_REPORT_TARGET,
  type MaterializedReport,
  type MaterializedReportTarget,
} from './report-materialized';
import type { ReportRendererTarget } from './report-renderer';
import type { ReportSnapshot } from './report-snapshot';
import { reportSnapshotToPreviewModel } from './report-snapshot-preview';

export type MaterializeReportSnapshotOptions = {
  repository?: MaterializedReportRepository;
  now?: string;
  expiresAt?: string | null;
  force?: boolean;
  lifecyclePolicies?: ReportLifecyclePolicyOverrides;
};

const RENDERER_TARGET_BY_MATERIALIZED: Record<
  Exclude<MaterializedReportTarget, 'preview'>,
  ReportRendererTarget
> = {
  web: 'web',
  pdf: 'pdf',
  dashboard: 'dashboard',
};

function payloadFromSnapshotRenderOutputs(
  snapshot: ReportSnapshot,
  target: MaterializedReportTarget,
): { payload: MaterializedReport['payload']; source: 'snapshot_render_outputs' } | null {
  const outputs = snapshot.render_outputs;
  if (!outputs) return null;

  if (target === MATERIALIZED_REPORT_TARGET.web && outputs.web) {
    return { payload: outputs.web, source: 'snapshot_render_outputs' };
  }
  if (target === MATERIALIZED_REPORT_TARGET.pdf && outputs.pdf) {
    return { payload: outputs.pdf, source: 'snapshot_render_outputs' };
  }
  if (target === MATERIALIZED_REPORT_TARGET.dashboard && outputs.dashboard) {
    return { payload: outputs.dashboard, source: 'snapshot_render_outputs' };
  }
  if (target === MATERIALIZED_REPORT_TARGET.preview) {
    return {
      payload: reportSnapshotToPreviewModel(snapshot),
      source: 'snapshot_render_outputs',
    };
  }
  return null;
}

function payloadFromCanonicalFallback(
  snapshot: ReportSnapshot,
  target: MaterializedReportTarget,
): { payload: MaterializedReport['payload']; source: 'canonical_fallback' } {
  const document = snapshot.canonical_document;
  if (target === MATERIALIZED_REPORT_TARGET.web) {
    return { payload: canonicalDocumentToWebViewModel(document), source: 'canonical_fallback' };
  }
  if (target === MATERIALIZED_REPORT_TARGET.pdf) {
    return { payload: canonicalDocumentToPdfViewModel(document), source: 'canonical_fallback' };
  }
  if (target === MATERIALIZED_REPORT_TARGET.dashboard) {
    return { payload: canonicalDocumentToDashboardViewModel(document), source: 'canonical_fallback' };
  }
  return {
    payload: reportSnapshotToPreviewModel(snapshot),
    source: 'canonical_fallback',
  };
}

async function buildRendererPayload(
  snapshot: ReportSnapshot,
  target: Exclude<MaterializedReportTarget, 'preview'>,
  now: string,
): Promise<{
  payload: CanonicalReportWebViewModel | CanonicalReportPdfViewModel | CanonicalReportDashboardViewModel;
  outputs?: CanonicalReportRenderOutputsMetadata;
}> {
  const rendererTarget = RENDERER_TARGET_BY_MATERIALIZED[target];
  const outputs = await buildCanonicalRenderOutputsForDocument(snapshot.canonical_document, {
    now,
    targets: [rendererTarget],
  });

  if (target === MATERIALIZED_REPORT_TARGET.web && outputs?.web) {
    return { payload: outputs.web, outputs };
  }
  if (target === MATERIALIZED_REPORT_TARGET.pdf && outputs?.pdf) {
    return { payload: outputs.pdf, outputs };
  }
  if (target === MATERIALIZED_REPORT_TARGET.dashboard && outputs?.dashboard) {
    return { payload: outputs.dashboard, outputs };
  }

  const fallback = payloadFromCanonicalFallback(snapshot, target);
  return { payload: fallback.payload as CanonicalReportWebViewModel, outputs };
}

export async function buildMaterializedPayloadForTarget(
  snapshot: ReportSnapshot,
  target: MaterializedReportTarget,
  options: { now?: string } = {},
): Promise<{
  payload: MaterializedReport['payload'];
  metadata: MaterializedReport['metadata'];
}> {
  const now = options.now ?? new Date().toISOString();
  const fromSnapshot = payloadFromSnapshotRenderOutputs(snapshot, target);
  if (fromSnapshot) {
    return {
      payload: fromSnapshot.payload,
      metadata: {
        materialized_at: now,
        source: fromSnapshot.source,
      },
    };
  }

  if (target !== MATERIALIZED_REPORT_TARGET.preview) {
    const rendered = await buildRendererPayload(snapshot, target, now);
    return {
      payload: rendered.payload,
      metadata: {
        materialized_at: now,
        source: 'renderer',
        renderer_id: `${target}_renderer`,
      },
    };
  }

  const fallback = payloadFromCanonicalFallback(snapshot, target);
  return {
    payload: fallback.payload,
    metadata: {
      materialized_at: now,
      source: fallback.source,
    },
  };
}

export async function materializeReportSnapshot(
  snapshot: ReportSnapshot,
  target: MaterializedReportTarget,
  options: MaterializeReportSnapshotOptions = {},
): Promise<MaterializedReport> {
  const repository = options.repository ?? reportMaterializedRepository;
  const now = options.now ?? new Date().toISOString();

  if (!options.force) {
    const existing = await repository.getMaterializedReport({
      snapshot_id: snapshot.snapshot_id,
      target,
    });
    if (
      existing
      && existing.status === MATERIALIZED_REPORT_STATUS.ready
      && existing.version === snapshot.version
    ) {
      return existing;
    }
  }

  const { payload, metadata } = await buildMaterializedPayloadForTarget(snapshot, target, { now });
  const policy = resolveMaterializedReportLifecyclePolicy(target, options.lifecyclePolicies);
  const lifecycleTimestamps = computeReportLifecycleTimestamps(policy, now);
  const lifecycleMetadata = buildMaterializedReportLifecycleMetadata(policy, lifecycleTimestamps);

  return repository.upsertMaterializedReport({
    snapshot_id: snapshot.snapshot_id,
    report_id: snapshot.report_id ?? snapshot.canonical_document.report_id ?? null,
    target,
    version: snapshot.version,
    status: MATERIALIZED_REPORT_STATUS.ready,
    payload,
    metadata: {
      ...metadata,
      materialized_at: now,
      lifecycle: lifecycleMetadata,
    },
    updated_at: now,
    expires_at: options.expiresAt ?? lifecycleTimestamps.expires_at,
  });
}

export async function materializeReportSnapshotTargets(
  snapshot: ReportSnapshot,
  targets: readonly MaterializedReportTarget[],
  options: MaterializeReportSnapshotOptions = {},
): Promise<MaterializedReport[]> {
  const results: MaterializedReport[] = [];
  for (const target of targets) {
    results.push(await materializeReportSnapshot(snapshot, target, options));
  }
  return results;
}

export const DEFAULT_FINAL_SNAPSHOT_PREMATERIALIZE_TARGETS = [
  MATERIALIZED_REPORT_TARGET.web,
  MATERIALIZED_REPORT_TARGET.dashboard,
  MATERIALIZED_REPORT_TARGET.preview,
] as const satisfies readonly MaterializedReportTarget[];
