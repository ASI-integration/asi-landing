import { buildCanonicalRenderOutputsForDocument } from './canonical-report-render-pipeline';
import { buildCanonicalReportDocument } from './canonical-report-document';
import {
  LOCATION_REPORT_SAMPLE_PATH,
  LOCATION_REPORT_SAMPLE_PDF_PATH,
} from './report-state';
import {
  REPORT_ARTIFACT_STATUS,
  type ReportArtifact,
} from './report-artifact';
import {
  collectReportSignalsForLayers,
  type ReportSignalAdapterRegistry,
} from './report-signal-adapters';
import { buildReportSections } from './report-sections';
import {
  artifactStatusForReportLayer,
  buildReportSnapshotFromArtifactUpdate,
} from './report-snapshot';
import type { MaterializedReportTarget } from './report-materialized';
import {
  DEFAULT_FINAL_SNAPSHOT_PREMATERIALIZE_TARGETS,
  materializeReportSnapshotTargets,
} from './report-materialization';
import type { MaterializedReportRepository } from './report-materialized-repository';
import type { ReportSnapshotRepository } from './report-snapshot-repository';
import type { ReportSnapshot } from './report-snapshot';
import {
  REPORT_AUDIT_EVENT_TYPE,
  REPORT_AUDIT_LAYER,
} from './report-audit-event';
import { auditReportEvent } from './report-audit';

export type ArtifactUpdate = Partial<
  Pick<
    ReportArtifact,
    'preliminary_report_url' | 'final_report_url' | 'pdf_url' | 'generated_at' | 'metadata'
  >
>;

export type PaidReportProducerKind = 'preliminary' | 'final' | 'pdf';

export type PaidReportProducer = {
  kind: PaidReportProducerKind;
  generate(requestId: string): Promise<ArtifactUpdate>;
};

export type PaidReportProducerOptions = {
  adapterRegistry?: ReportSignalAdapterRegistry;
  snapshotRepository?: ReportSnapshotRepository;
  materializedRepository?: MaterializedReportRepository;
  persistPreliminarySnapshot?: boolean;
  preMaterializeTargets?: readonly MaterializedReportTarget[] | false;
};

async function persistProducerSnapshot(
  options: PaidReportProducerOptions,
  args: {
    requestId: string;
    reportLayer: 'preliminary' | 'final';
    update: ArtifactUpdate;
  },
): Promise<void> {
  const repository = options.snapshotRepository;
  if (!repository) return;
  if (args.reportLayer === 'preliminary' && options.persistPreliminarySnapshot === false) {
    return;
  }

  const snapshotInput = buildReportSnapshotFromArtifactUpdate({
    requestId: args.requestId,
    reportId: args.requestId,
    reportLayer: args.reportLayer,
    update: args.update,
    artifactStatus: artifactStatusForReportLayer(args.reportLayer),
  });
  if (!snapshotInput) return;
  const snapshot = await repository.createSnapshot(snapshotInput);
  void auditReportEvent({
    request_id: args.requestId,
    report_id: snapshot.report_id ?? args.requestId,
    snapshot_id: snapshot.snapshot_id,
    event_type: REPORT_AUDIT_EVENT_TYPE.snapshotCreated,
    layer: REPORT_AUDIT_LAYER.snapshot,
    message: `snapshot_${args.reportLayer}_created`,
    metadata: {
      report_layer: args.reportLayer,
      version: snapshot.version,
    },
  });
  if (args.reportLayer !== 'final') return;

  const targets = options.preMaterializeTargets === false
    ? []
    : options.preMaterializeTargets ?? DEFAULT_FINAL_SNAPSHOT_PREMATERIALIZE_TARGETS;
  if (targets.length === 0 || !options.materializedRepository) return;

  await materializeReportSnapshotTargets(snapshot, targets, {
    repository: options.materializedRepository,
    now: snapshot.created_at,
  });
}

function requestQuery(requestId: string): string {
  return new URLSearchParams({ requestId }).toString();
}

export function buildStaticPaidReportArtifactUrls(requestId: string): Pick<
  ReportArtifact,
  'preliminary_report_url' | 'final_report_url' | 'pdf_url'
> {
  const query = requestQuery(requestId);
  return {
    preliminary_report_url: `${LOCATION_REPORT_SAMPLE_PATH}?${query}&view=preliminary`,
    final_report_url: `${LOCATION_REPORT_SAMPLE_PATH}?${query}`,
    pdf_url: `${LOCATION_REPORT_SAMPLE_PDF_PATH}?${query}`,
  };
}

export function createPreliminaryReportProducer(
  options: PaidReportProducerOptions = {},
): PaidReportProducer {
  return {
    kind: 'preliminary',
    async generate(requestId) {
      const adapterSummary = await collectReportSignalsForLayers({
        request: { requestId, stage: 'preliminary' },
        layers: ['fast'],
        registry: options.adapterRegistry,
      });
      const report_sections = buildReportSections(adapterSummary);
      const generatedAt = new Date().toISOString();

      const update: ArtifactUpdate = {
        preliminary_report_url: buildStaticPaidReportArtifactUrls(requestId).preliminary_report_url,
        metadata: {
          adapter_summary: adapterSummary,
          report_sections,
          canonical_document: buildCanonicalReportDocument({
            requestId,
            reportId: requestId,
            status: REPORT_ARTIFACT_STATUS.preliminaryReady,
            reportLayer: 'preliminary',
            sections: report_sections,
            adapterSummary,
            generatedAt,
            createdAt: generatedAt,
            updatedAt: generatedAt,
          }),
        },
      };
      await persistProducerSnapshot(options, {
        requestId,
        reportLayer: 'preliminary',
        update,
      });
      return update;
    },
  };
}

export function createFinalReportProducer(
  options: PaidReportProducerOptions = {},
): PaidReportProducer {
  return {
    kind: 'final',
    async generate(requestId) {
      const adapterSummary = await collectReportSignalsForLayers({
        request: { requestId, stage: 'final' },
        layers: ['fast', 'full'],
        registry: options.adapterRegistry,
      });
      const report_sections = buildReportSections(adapterSummary);
      const generatedAt = new Date().toISOString();
      const canonical_document = buildCanonicalReportDocument({
        requestId,
        reportId: requestId,
        status: REPORT_ARTIFACT_STATUS.finalReady,
        reportLayer: 'final',
        sections: report_sections,
        adapterSummary,
        generatedAt,
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
      const canonical_render_outputs = await buildCanonicalRenderOutputsForDocument(
        canonical_document,
        { now: generatedAt },
      );

      const update: ArtifactUpdate = {
        final_report_url: buildStaticPaidReportArtifactUrls(requestId).final_report_url,
        metadata: {
          adapter_summary: adapterSummary,
          report_sections,
          canonical_document,
          ...(canonical_render_outputs ? { canonical_render_outputs } : {}),
        },
      };
      await persistProducerSnapshot(options, {
        requestId,
        reportLayer: 'final',
        update,
      });
      return update;
    },
  };
}

export const pdfReportProducer: PaidReportProducer = {
  kind: 'pdf',
  async generate(requestId) {
    return {
      pdf_url: buildStaticPaidReportArtifactUrls(requestId).pdf_url,
      generated_at: new Date().toISOString(),
    };
  },
};

export function createPaidReportProducers(options: PaidReportProducerOptions = {}) {
  return {
    preliminary: createPreliminaryReportProducer(options),
    final: createFinalReportProducer(options),
    pdf: pdfReportProducer,
  } satisfies Record<PaidReportProducerKind, PaidReportProducer>;
}

export const preliminaryReportProducer = createPreliminaryReportProducer();
export const finalReportProducer = createFinalReportProducer();

export const paidReportProducers = {
  preliminary: preliminaryReportProducer,
  final: finalReportProducer,
  pdf: pdfReportProducer,
} satisfies Record<PaidReportProducerKind, PaidReportProducer>;
