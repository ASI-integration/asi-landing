import type { CanonicalReportDocument } from './canonical-report-document';
import type { CanonicalReportRenderOutputsMetadata } from './report-artifact';
import type {
  CanonicalReportDashboardViewModel,
  CanonicalReportPdfViewModel,
  CanonicalReportWebViewModel,
} from './report-document-render';
import {
  getEnabledReportRenderers,
  getEnabledReportRenderersForTargets,
  type RenderResult,
  type ReportRenderer,
  REPORT_RENDERER_REGISTRY,
  type ReportRendererRegistry,
  type ReportRendererResultStatus,
  type ReportRendererTarget,
} from './report-renderer';

export type TargetRenderOutcome = {
  renderer_id: string;
  target: ReportRendererTarget;
  status: ReportRendererResultStatus;
  payload: unknown;
  metadata: Record<string, unknown>;
  warnings: string[];
  error?: string;
};

export type CanonicalReportRenderFailure = {
  renderer_id: string;
  target: ReportRendererTarget;
  error: string;
};

export type CanonicalReportRenderAggregation = {
  request_id: string;
  rendered_at: string;
  by_target: Partial<Record<ReportRendererTarget, TargetRenderOutcome>>;
  failures: CanonicalReportRenderFailure[];
};

export type RenderCanonicalReportDocumentOptions = {
  registry?: ReportRendererRegistry;
  targets?: readonly ReportRendererTarget[];
  now?: string;
};

function outcomeFromResult(
  renderer: ReportRenderer,
  result: RenderResult,
): TargetRenderOutcome {
  return {
    renderer_id: renderer.id,
    target: renderer.target,
    status: result.status,
    payload: result.payload,
    metadata: result.metadata,
    warnings: result.warnings,
  };
}

function failedOutcome(renderer: ReportRenderer, error: string): TargetRenderOutcome {
  return {
    renderer_id: renderer.id,
    target: renderer.target,
    status: 'failed',
    payload: null,
    metadata: {
      renderer_id: renderer.id,
      target: renderer.target,
    },
    warnings: [error],
    error,
  };
}

export async function renderCanonicalReportDocument(
  document: CanonicalReportDocument,
  options: RenderCanonicalReportDocumentOptions = {},
): Promise<CanonicalReportRenderAggregation> {
  const registry = options.registry ?? REPORT_RENDERER_REGISTRY;
  const renderers = options.targets
    ? getEnabledReportRenderersForTargets(options.targets, registry)
    : getEnabledReportRenderers(registry);

  const by_target: Partial<Record<ReportRendererTarget, TargetRenderOutcome>> = {};
  const failures: CanonicalReportRenderFailure[] = [];

  for (const renderer of renderers) {
    try {
      const result = await renderer.render(document);
      by_target[renderer.target] = outcomeFromResult(renderer, result);
      if (result.status === 'failed') {
        failures.push({
          renderer_id: renderer.id,
          target: renderer.target,
          error: result.warnings[0] ?? 'render_failed',
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({
        renderer_id: renderer.id,
        target: renderer.target,
        error,
      });
      by_target[renderer.target] = failedOutcome(renderer, error);
    }
  }

  return {
    request_id: document.request_id,
    rendered_at: options.now ?? new Date().toISOString(),
    by_target,
    failures,
  };
}

export function buildCanonicalRenderOutputsMetadata(
  aggregation: CanonicalReportRenderAggregation,
): CanonicalReportRenderOutputsMetadata | undefined {
  const web = aggregation.by_target.web;
  const pdf = aggregation.by_target.pdf;
  const dashboard = aggregation.by_target.dashboard;

  const hasPayload =
    web?.status === 'success'
    || pdf?.status === 'success'
    || dashboard?.status === 'success';

  if (!hasPayload) return undefined;

  const outputs: CanonicalReportRenderOutputsMetadata = {
    rendered_at: aggregation.rendered_at,
  };

  if (web?.status === 'success') {
    outputs.web = web.payload as CanonicalReportWebViewModel;
  }
  if (pdf?.status === 'success') {
    outputs.pdf = pdf.payload as CanonicalReportPdfViewModel;
  }
  if (dashboard?.status === 'success') {
    outputs.dashboard = dashboard.payload as CanonicalReportDashboardViewModel;
  }

  return outputs;
}

export async function buildCanonicalRenderOutputsForDocument(
  document: CanonicalReportDocument,
  options: RenderCanonicalReportDocumentOptions = {},
): Promise<CanonicalReportRenderOutputsMetadata | undefined> {
  const aggregation = await renderCanonicalReportDocument(document, {
    ...options,
    targets: options.targets ?? ['web', 'pdf', 'dashboard'],
  });
  return buildCanonicalRenderOutputsMetadata(aggregation);
}
