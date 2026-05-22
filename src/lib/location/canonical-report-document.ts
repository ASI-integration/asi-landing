import type { ReportArtifact, ReportArtifactStatus } from './report-artifact';
import type { ReportSection } from './report-sections';
import type {
  ReportSignalAdapterSummary,
  ReportSignalCollectionSummary,
  ReportSignalLayer,
  ReportSignalResultStatus,
} from './report-signal-adapters';

export const CANONICAL_REPORT_LAYERS = ['preliminary', 'final'] as const;
export type CanonicalReportLayer = (typeof CANONICAL_REPORT_LAYERS)[number];

export type CanonicalReportSourceSummary = {
  requested_layers: ReportSignalLayer[];
  adapter_count: number;
  signal_count: number;
  warning_count: number;
  adapters: readonly CanonicalReportSourceAdapterSummary[];
};

export type CanonicalReportSourceAdapterSummary = {
  id: string;
  label: string;
  layer: ReportSignalLayer;
  status: ReportSignalResultStatus;
  signal_count: number;
  warning_count: number;
};

export type CanonicalReportDocumentMetadata = {
  producer: CanonicalReportLayer;
  section_count: number;
  ready_section_count: number;
  empty_section_count: number;
  warning_section_count: number;
  failed_section_count: number;
};

export type CanonicalReportDocument = {
  report_id: string | null;
  request_id: string;
  status: ReportArtifactStatus;
  created_at: string;
  updated_at: string;
  generated_at: string | null;
  report_layer: CanonicalReportLayer;
  sections: ReportSection[];
  metadata: CanonicalReportDocumentMetadata;
  source_summary: CanonicalReportSourceSummary;
};

export function buildCanonicalReportSourceSummary(
  adapterSummary: ReportSignalCollectionSummary,
): CanonicalReportSourceSummary {
  const adapters = adapterSummary.adapters.map(adapterSummaryFromAdapter);
  return {
    requested_layers: [...adapterSummary.requested_layers],
    adapter_count: adapters.length,
    signal_count: adapters.reduce((sum, adapter) => sum + adapter.signal_count, 0),
    warning_count: adapters.reduce((sum, adapter) => sum + adapter.warning_count, 0),
    adapters,
  };
}

function adapterSummaryFromAdapter(
  adapter: ReportSignalAdapterSummary,
): CanonicalReportSourceAdapterSummary {
  return {
    id: adapter.id,
    label: adapter.label,
    layer: adapter.layer,
    status: adapter.status,
    signal_count: adapter.signal_count,
    warning_count: adapter.warning_count,
  };
}

export function normalizeCanonicalReportSections(sections: readonly ReportSection[]): ReportSection[] {
  return [...sections].sort((left, right) => left.order - right.order);
}

export function countSectionsByStatus(
  sections: readonly ReportSection[],
): Pick<
  CanonicalReportDocumentMetadata,
  'section_count' | 'ready_section_count' | 'empty_section_count' | 'warning_section_count' | 'failed_section_count'
> {
  const section_count = sections.length;
  const ready_section_count = sections.filter(section => section.status === 'ready').length;
  const empty_section_count = sections.filter(section => section.status === 'empty').length;
  const warning_section_count = sections.filter(section => section.status === 'warning').length;
  const failed_section_count = sections.filter(section => section.status === 'failed').length;
  return {
    section_count,
    ready_section_count,
    empty_section_count,
    warning_section_count,
    failed_section_count,
  };
}

export function buildCanonicalReportDocumentMetadata(
  reportLayer: CanonicalReportLayer,
  sections: readonly ReportSection[],
): CanonicalReportDocumentMetadata {
  return {
    producer: reportLayer,
    ...countSectionsByStatus(sections),
  };
}

export type BuildCanonicalReportDocumentInput = {
  requestId: string;
  reportId?: string | null;
  status: ReportArtifactStatus;
  reportLayer: CanonicalReportLayer;
  sections: readonly ReportSection[];
  adapterSummary: ReportSignalCollectionSummary;
  createdAt?: string;
  updatedAt?: string;
  generatedAt?: string | null;
};

export type BuildCanonicalReportDocumentFromArtifactInput = {
  artifact: Pick<ReportArtifact, 'request_id' | 'created_at' | 'updated_at' | 'generated_at'>;
  reportId?: string | null;
  status: ReportArtifactStatus;
  reportLayer: CanonicalReportLayer;
  sections: readonly ReportSection[];
  adapterSummary: ReportSignalCollectionSummary;
  generatedAt?: string | null;
};

export function buildCanonicalReportDocumentFromArtifact(
  input: BuildCanonicalReportDocumentFromArtifactInput,
): CanonicalReportDocument {
  return buildCanonicalReportDocument({
    requestId: input.artifact.request_id,
    reportId: input.reportId,
    status: input.status,
    reportLayer: input.reportLayer,
    sections: input.sections,
    adapterSummary: input.adapterSummary,
    createdAt: input.artifact.created_at,
    updatedAt: input.artifact.updated_at,
    generatedAt: input.generatedAt ?? input.artifact.generated_at,
  });
}

export function buildCanonicalReportDocument(
  input: BuildCanonicalReportDocumentInput,
): CanonicalReportDocument {
  const created_at = input.createdAt ?? input.updatedAt ?? new Date().toISOString();
  const updated_at = input.updatedAt ?? created_at;
  const sections = normalizeCanonicalReportSections(input.sections);

  return {
    report_id: input.reportId ?? null,
    request_id: input.requestId,
    status: input.status,
    created_at,
    updated_at,
    generated_at: input.generatedAt ?? null,
    report_layer: input.reportLayer,
    sections,
    metadata: buildCanonicalReportDocumentMetadata(input.reportLayer, sections),
    source_summary: buildCanonicalReportSourceSummary(input.adapterSummary),
  };
}

export function isCanonicalReportDocument(value: unknown): value is CanonicalReportDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<CanonicalReportDocument>;
  return (
    typeof candidate.request_id === 'string'
    && typeof candidate.report_layer === 'string'
    && CANONICAL_REPORT_LAYERS.includes(candidate.report_layer as CanonicalReportLayer)
    && Array.isArray(candidate.sections)
    && typeof candidate.source_summary === 'object'
  );
}
