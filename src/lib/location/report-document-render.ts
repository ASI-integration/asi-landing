import type { CanonicalReportDocument } from './canonical-report-document';
import type { ReportArtifact, ReportArtifactMetadata } from './report-artifact';
import type { ReportSection } from './report-sections';

export type CanonicalReportWebSectionViewModel = {
  id: string;
  title: string;
  summary: string;
  status: ReportSection['status'];
  item_count: number;
  warning_count: number;
};

export type CanonicalReportWebViewModel = {
  report_id: string | null;
  request_id: string;
  report_layer: CanonicalReportDocument['report_layer'];
  headline: string;
  sections: CanonicalReportWebSectionViewModel[];
  adapter_count: number;
  signal_count: number;
  warning_count: number;
};

export type CanonicalReportPdfSectionItemViewModel = {
  label: string;
  value_text: string;
};

export type CanonicalReportPdfSectionViewModel = {
  id: string;
  title: string;
  summary: string;
  items: CanonicalReportPdfSectionItemViewModel[];
};

export type CanonicalReportPdfViewModel = {
  report_id: string | null;
  request_id: string;
  generated_at: string | null;
  report_layer: CanonicalReportDocument['report_layer'];
  sections: CanonicalReportPdfSectionViewModel[];
};

export type CanonicalReportDashboardViewModel = {
  report_id: string | null;
  request_id: string;
  report_layer: CanonicalReportDocument['report_layer'];
  title: string;
  section_count: number;
  ready_section_count: number;
  warning_section_count: number;
  signal_count: number;
  warning_count: number;
};

const WEB_HEADLINE_BY_LAYER: Record<CanonicalReportDocument['report_layer'], string> = {
  preliminary: 'Предварительный отчёт',
  final: 'Полный отчёт',
};

function formatReportValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function canonicalDocumentToWebViewModel(
  document: CanonicalReportDocument,
): CanonicalReportWebViewModel {
  return {
    report_id: document.report_id,
    request_id: document.request_id,
    report_layer: document.report_layer,
    headline: WEB_HEADLINE_BY_LAYER[document.report_layer],
    sections: document.sections.map(section => ({
      id: section.id,
      title: section.title,
      summary: section.summary,
      status: section.status,
      item_count: section.items.length,
      warning_count: section.warnings.length,
    })),
    adapter_count: document.source_summary.adapter_count,
    signal_count: document.source_summary.signal_count,
    warning_count: document.source_summary.warning_count,
  };
}

export function canonicalDocumentToPdfViewModel(
  document: CanonicalReportDocument,
): CanonicalReportPdfViewModel {
  return {
    report_id: document.report_id,
    request_id: document.request_id,
    generated_at: document.generated_at,
    report_layer: document.report_layer,
    sections: document.sections.map(section => ({
      id: section.id,
      title: section.title,
      summary: section.summary,
      items: section.items.map(item => ({
        label: item.label,
        value_text: formatReportValue(item.value),
      })),
    })),
  };
}

export function canonicalDocumentToDashboardViewModel(
  document: CanonicalReportDocument,
): CanonicalReportDashboardViewModel {
  return {
    report_id: document.report_id,
    request_id: document.request_id,
    report_layer: document.report_layer,
    title: WEB_HEADLINE_BY_LAYER[document.report_layer],
    section_count: document.metadata.section_count,
    ready_section_count: document.metadata.ready_section_count,
    warning_section_count: document.metadata.warning_section_count,
    signal_count: document.source_summary.signal_count,
    warning_count: document.source_summary.warning_count,
  };
}

export function getCanonicalReportDocumentFromMetadata(
  metadata: ReportArtifactMetadata | undefined,
): CanonicalReportDocument | null {
  const document = metadata?.canonical_document;
  if (!document) return null;
  return document;
}

export function resolveReportSectionsFromArtifact(
  artifact: ReportArtifact | null | undefined,
): ReportSection[] {
  const canonical = getCanonicalReportDocumentFromMetadata(artifact?.metadata);
  if (canonical?.sections?.length) return canonical.sections;

  const sections = artifact?.metadata?.report_sections;
  return Array.isArray(sections) ? sections : [];
}
