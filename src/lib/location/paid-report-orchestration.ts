import {
  getLocationReportRequestById,
  markLocationReportRequestCompleted,
  markLocationReportRequestFailed,
  markLocationReportRequestProcessing,
} from './report-request-store';
import {
  REPORT_ARTIFACT_STATUS,
  type ReportArtifact,
} from './report-artifact';
import {
  reportArtifactRepository,
  type ReportArtifactRepository,
} from './report-artifact-repository';
import {
  ensurePaidLocationReportForRequest,
  isPaidReportRecoverableProcessingError,
} from './location-report-engine';
import {
  createPaidReportProducers,
  type PaidReportProducer,
} from './report-producers';
import { createPaidReportCalculationAdapterRegistry } from './report-signal-adapters';
import type { ReportSnapshotRepository } from './report-snapshot-repository';
import { reportSnapshotRepository } from './report-snapshot-repository';
import { ensureEntitlementsAfterFinalSnapshot } from './report-access-entitlement-orchestration';
import {
  reportAccessEntitlementRepository,
  type ReportAccessEntitlementRepository,
} from './report-access-entitlement-repository';
import { ensureDeliveriesAfterFinalSnapshot } from './report-delivery-orchestration';
import {
  reportDeliveryRepository,
  type ReportDeliveryRepository,
} from './report-delivery-repository';
import {
  REPORT_AUDIT_EVENT_TYPE,
  REPORT_AUDIT_LAYER,
  REPORT_AUDIT_STATUS,
} from './report-audit-event';
import { auditReportEvent, auditReportFailure } from './report-audit';
import {
  reportAuditRepository,
  type ReportAuditRepository,
} from './report-audit-repository';
import {
  checkReportPipelineReadiness,
  type CheckReportPipelineReadinessOptions,
} from './report-pipeline-readiness-resolver';
import type { ReportPipelineReadiness } from './report-pipeline-readiness';
import { ReportPipelineNotReadyError } from './report-pipeline-not-ready-error';

type PaidReportProducerSet = {
  preliminary: PaidReportProducer;
  final: PaidReportProducer;
  pdf: PaidReportProducer;
};

export type ProcessPaidReportRequestOptions = {
  producers?: PaidReportProducerSet;
  artifactRepository?: ReportArtifactRepository;
  snapshotRepository?: ReportSnapshotRepository;
  deliveryRepository?: ReportDeliveryRepository;
  entitlementRepository?: ReportAccessEntitlementRepository;
  auditRepository?: ReportAuditRepository;
  checkPipelineReadiness?: (
    options?: CheckReportPipelineReadinessOptions,
  ) => Promise<ReportPipelineReadiness>;
  readinessCheckOptions?: CheckReportPipelineReadinessOptions;
};

export async function processPaidReportRequest(
  requestId: string,
  options: ProcessPaidReportRequestOptions = {},
): Promise<ReportArtifact> {
  const entity = await getLocationReportRequestById(requestId);
  if (!entity) throw new Error('request_not_found');
  if (entity.access_tier === 'paid_required' && entity.payment_status !== 'paid_unlocked') {
    throw new Error('paid_unlock_required');
  }

  const artifacts = options.artifactRepository ?? reportArtifactRepository;

  async function upsertArtifactWithRetry(
    requestIdForUpsert: string,
    patch: Parameters<ReportArtifactRepository['upsert']>[1],
  ): Promise<ReportArtifact> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await artifacts.upsert(requestIdForUpsert, patch);
      } catch (err) {
        lastError = err;
        if (!isPaidReportRecoverableProcessingError(err) || attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  const snapshots = options.snapshotRepository ?? reportSnapshotRepository;
  const deliveries = options.deliveryRepository ?? reportDeliveryRepository;
  const entitlements = options.entitlementRepository ?? reportAccessEntitlementRepository;
  const audit = options.auditRepository ?? reportAuditRepository;
  const auditOptions = { repository: audit };
  let reportId = entity.report_id ?? requestId;
  let existingArtifact: ReportArtifact | null = null;
  try {
    existingArtifact = await artifacts.getByRequestId(requestId);
  } catch (err) {
    if (!isPaidReportRecoverableProcessingError(err)) throw err;
  }
  if (existingArtifact?.status === REPORT_ARTIFACT_STATUS.pdfReady) {
    return existingArtifact;
  }
  const resumeFromPreliminary =
    existingArtifact?.status === REPORT_ARTIFACT_STATUS.preliminaryReady
    || existingArtifact?.status === REPORT_ARTIFACT_STATUS.finalReady;
  const resumeFromFinal = existingArtifact?.status === REPORT_ARTIFACT_STATUS.finalReady;

  const checkReadiness = options.checkPipelineReadiness ?? checkReportPipelineReadiness;
  const readiness = await checkReadiness(options.readinessCheckOptions);
  if (!readiness.ready) {
    const blockerSummary = readiness.blockers.join('; ') || 'report_pipeline_not_ready';
    await auditReportEvent({
      request_id: requestId,
      report_id: reportId,
      event_type: REPORT_AUDIT_EVENT_TYPE.orchestrationStarted,
      layer: REPORT_AUDIT_LAYER.lifecycle,
      status: REPORT_AUDIT_STATUS.skipped,
      message: blockerSummary,
      metadata: {
        readiness_blockers: readiness.blockers,
        readiness_warnings: readiness.warnings,
      },
    }, auditOptions);
    await upsertArtifactWithRetry(requestId, {
      status: REPORT_ARTIFACT_STATUS.reportForming,
    });
    throw new ReportPipelineNotReadyError(readiness);
  }

  const calculation = await ensurePaidLocationReportForRequest(requestId, { entity });
  reportId = calculation.reportId;
  const producerOptions = {
    reportId,
    adapterRegistry: createPaidReportCalculationAdapterRegistry(calculation.context),
    snapshotRepository: options.snapshotRepository,
  };
  const producers = options.producers ?? createPaidReportProducers(producerOptions);

  await markLocationReportRequestProcessing(requestId);
  await upsertArtifactWithRetry(requestId, {
    status: REPORT_ARTIFACT_STATUS.reportForming,
  });
  await auditReportEvent({
    request_id: requestId,
    report_id: reportId,
    event_type: REPORT_AUDIT_EVENT_TYPE.orchestrationStarted,
    layer: REPORT_AUDIT_LAYER.lifecycle,
    status: REPORT_AUDIT_STATUS.started,
    message: 'paid_report_orchestration_started',
  }, auditOptions);

  try {
    if (!resumeFromPreliminary) {
      const preliminary = await producers.preliminary.generate(requestId);
      await auditReportEvent({
        request_id: requestId,
        report_id: reportId,
        event_type: REPORT_AUDIT_EVENT_TYPE.producerPreliminaryCompleted,
        layer: REPORT_AUDIT_LAYER.producer,
        status: REPORT_AUDIT_STATUS.success,
        metadata: { producer_kind: 'preliminary' },
      }, auditOptions);
      await upsertArtifactWithRetry(requestId, {
        ...preliminary,
        status: REPORT_ARTIFACT_STATUS.preliminaryReady,
      });
    }

    if (!resumeFromFinal) {
      const final = await producers.final.generate(requestId);
      await auditReportEvent({
        request_id: requestId,
        report_id: reportId,
        event_type: REPORT_AUDIT_EVENT_TYPE.producerFinalCompleted,
        layer: REPORT_AUDIT_LAYER.producer,
        status: REPORT_AUDIT_STATUS.success,
        metadata: { producer_kind: 'final' },
      }, auditOptions);
      await upsertArtifactWithRetry(requestId, {
        ...final,
        status: REPORT_ARTIFACT_STATUS.finalReady,
      });

      await ensureDeliveriesAfterFinalSnapshot({
        requestId,
        request: entity,
        snapshotRepository: snapshots,
        deliveryRepository: deliveries,
      });

      await ensureEntitlementsAfterFinalSnapshot({
        requestId,
        request: entity,
        snapshotRepository: snapshots,
        entitlementRepository: entitlements,
      });
    }

    const pdf = await producers.pdf.generate(requestId);
    await auditReportEvent({
      request_id: requestId,
      report_id: reportId,
      event_type: REPORT_AUDIT_EVENT_TYPE.producerPdfCompleted,
      layer: REPORT_AUDIT_LAYER.producer,
      status: REPORT_AUDIT_STATUS.success,
      metadata: { producer_kind: 'pdf' },
    }, auditOptions);
    const completed = await upsertArtifactWithRetry(requestId, {
      ...pdf,
      status: REPORT_ARTIFACT_STATUS.pdfReady,
    });

    await markLocationReportRequestCompleted({
      requestId,
      reportId: calculation.reportId,
    });
    await auditReportEvent({
      request_id: requestId,
      report_id: reportId,
      event_type: REPORT_AUDIT_EVENT_TYPE.orchestrationCompleted,
      layer: REPORT_AUDIT_LAYER.lifecycle,
      status: REPORT_AUDIT_STATUS.success,
      message: 'paid_report_orchestration_completed',
    }, auditOptions);

    return completed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const recoverable = isPaidReportRecoverableProcessingError(err);
    await auditReportFailure({
      request_id: requestId,
      report_id: reportId,
      event_type: REPORT_AUDIT_EVENT_TYPE.orchestrationFailed,
      layer: REPORT_AUDIT_LAYER.lifecycle,
      message: msg,
      metadata: recoverable ? { recoverable: true } : undefined,
    }, auditOptions);
    if (recoverable) {
      await upsertArtifactWithRetry(requestId, {
        status: REPORT_ARTIFACT_STATUS.reportForming,
        metadata: {
          ...(existingArtifact?.metadata ?? {}),
          last_processing_error: msg,
          recoverable: true,
        },
      }).catch(() => undefined);
    } else {
      await markLocationReportRequestFailed({ requestId, errorMessage: msg });
      await upsertArtifactWithRetry(requestId, {
        status: REPORT_ARTIFACT_STATUS.failed,
      }).catch(() => undefined);
    }
    throw err;
  }
}

export { isPaidReportRecoverableProcessingError };
