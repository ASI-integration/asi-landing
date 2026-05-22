import type { CanonicalReportDocument } from './canonical-report-document';
import {
  canonicalDocumentToDashboardViewModel,
  canonicalDocumentToPdfViewModel,
  canonicalDocumentToWebViewModel,
} from './report-document-render';

export const REPORT_RENDERER_TARGETS = [
  'web',
  'pdf',
  'dashboard',
  'email_preview',
  'api_export',
] as const;

export type ReportRendererTarget = (typeof REPORT_RENDERER_TARGETS)[number];

export const REPORT_RENDERER_RESULT_STATUSES = ['success', 'skipped', 'failed'] as const;
export type ReportRendererResultStatus = (typeof REPORT_RENDERER_RESULT_STATUSES)[number];

export type RenderResult = {
  status: ReportRendererResultStatus;
  payload: unknown;
  metadata: Record<string, unknown>;
  warnings: string[];
};

export type ReportRenderer = {
  id: string;
  label: string;
  target: ReportRendererTarget;
  enabled: boolean;
  render(document: CanonicalReportDocument): Promise<RenderResult>;
};

export type ReportRendererRegistry = readonly ReportRenderer[];

function successResult(
  renderer: Pick<ReportRenderer, 'id' | 'target'>,
  payload: unknown,
  warnings: string[] = [],
): RenderResult {
  return {
    status: 'success',
    payload,
    metadata: {
      renderer_id: renderer.id,
      target: renderer.target,
    },
    warnings,
  };
}

function skippedResult(renderer: Pick<ReportRenderer, 'id' | 'target'>, reason: string): RenderResult {
  return {
    status: 'skipped',
    payload: null,
    metadata: {
      renderer_id: renderer.id,
      target: renderer.target,
      reason,
    },
    warnings: [reason],
  };
}

export const webReportRenderer: ReportRenderer = {
  id: 'web_renderer',
  label: 'Web',
  target: 'web',
  enabled: true,
  async render(document) {
    return successResult(webReportRenderer, canonicalDocumentToWebViewModel(document));
  },
};

export const pdfReportRenderer: ReportRenderer = {
  id: 'pdf_renderer',
  label: 'PDF',
  target: 'pdf',
  enabled: true,
  async render(document) {
    return successResult(pdfReportRenderer, canonicalDocumentToPdfViewModel(document));
  },
};

export const dashboardReportRenderer: ReportRenderer = {
  id: 'dashboard_renderer',
  label: 'Dashboard',
  target: 'dashboard',
  enabled: true,
  async render(document) {
    return successResult(dashboardReportRenderer, canonicalDocumentToDashboardViewModel(document));
  },
};

export const emailPreviewReportRenderer: ReportRenderer = {
  id: 'email_preview_renderer',
  label: 'Email preview',
  target: 'email_preview',
  enabled: false,
  async render() {
    return skippedResult(emailPreviewReportRenderer, 'renderer_disabled');
  },
};

export const apiExportReportRenderer: ReportRenderer = {
  id: 'api_export_renderer',
  label: 'API export',
  target: 'api_export',
  enabled: false,
  async render() {
    return skippedResult(apiExportReportRenderer, 'renderer_disabled');
  },
};

export const REPORT_RENDERER_REGISTRY = [
  webReportRenderer,
  pdfReportRenderer,
  dashboardReportRenderer,
  emailPreviewReportRenderer,
  apiExportReportRenderer,
] as const satisfies ReportRendererRegistry;

export function getEnabledReportRenderers(
  registry: ReportRendererRegistry = REPORT_RENDERER_REGISTRY,
): ReportRenderer[] {
  return registry.filter(renderer => renderer.enabled);
}

export function getReportRenderersByTarget(
  target: ReportRendererTarget,
  registry: ReportRendererRegistry = REPORT_RENDERER_REGISTRY,
): ReportRenderer[] {
  return registry.filter(renderer => renderer.target === target);
}

export function getEnabledReportRenderersForTargets(
  targets: readonly ReportRendererTarget[],
  registry: ReportRendererRegistry = REPORT_RENDERER_REGISTRY,
): ReportRenderer[] {
  const targetSet = new Set(targets);
  return registry.filter(renderer => renderer.enabled && targetSet.has(renderer.target));
}
