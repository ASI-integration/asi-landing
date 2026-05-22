import {
  REPORT_AUDIT_EVENT_TYPE,
  REPORT_AUDIT_LAYER,
  REPORT_AUDIT_STATUS,
  type CreateReportAuditEventInput,
  type ReportAuditEvent,
  type ReportAuditLayer,
  type ReportAuditStatus,
} from './report-audit-event';
import {
  reportAuditRepository,
  type ReportAuditRepository,
} from './report-audit-repository';
import type { ReportGatewayAccessResult } from './report-gateway';
import { REPORT_GATEWAY_ACCESS_STATUS } from './report-gateway';

export type AuditReportEventInput = Omit<CreateReportAuditEventInput, 'status'> & {
  status?: ReportAuditStatus;
  repository?: ReportAuditRepository;
};

export type AuditReportEventOptions = {
  repository?: ReportAuditRepository;
  swallowErrors?: boolean;
};

function resolveRepository(
  input?: AuditReportEventOptions | ReportAuditRepository,
): ReportAuditRepository {
  if (input && 'createAuditEvent' in input) return input;
  return input?.repository ?? reportAuditRepository;
}

function shouldSwallowErrors(
  input?: AuditReportEventOptions | ReportAuditRepository,
): boolean {
  if (input && 'createAuditEvent' in input) {
    return true;
  }
  return input?.swallowErrors ?? true;
}

async function persistAuditEvent(
  input: CreateReportAuditEventInput,
  options?: AuditReportEventOptions | ReportAuditRepository,
): Promise<ReportAuditEvent | null> {
  const repository = resolveRepository(options);
  try {
    return await repository.createAuditEvent(input);
  } catch {
    if (shouldSwallowErrors(options)) return null;
    throw new Error('failed_to_persist_report_audit_event');
  }
}

export async function auditReportEvent(
  input: AuditReportEventInput,
  options?: AuditReportEventOptions,
): Promise<ReportAuditEvent | null> {
  const { repository: _repository, status: explicitStatus, ...rest } = input;
  return persistAuditEvent(
    {
      ...rest,
      status: explicitStatus ?? REPORT_AUDIT_STATUS.success,
    },
    options ?? { repository: input.repository },
  );
}

export async function auditReportWarning(
  input: Omit<AuditReportEventInput, 'status'>,
  options?: AuditReportEventOptions,
): Promise<ReportAuditEvent | null> {
  return auditReportEvent(
    { ...input, status: REPORT_AUDIT_STATUS.warning },
    options ?? { repository: input.repository },
  );
}

export async function auditReportFailure(
  input: Omit<AuditReportEventInput, 'status'>,
  options?: AuditReportEventOptions,
): Promise<ReportAuditEvent | null> {
  return auditReportEvent(
    { ...input, status: REPORT_AUDIT_STATUS.failed },
    options ?? { repository: input.repository },
  );
}

export async function recordReportGatewayAccessAudit(
  result: ReportGatewayAccessResult,
  options?: AuditReportEventOptions,
): Promise<ReportAuditEvent | null> {
  const denied = result.status === REPORT_GATEWAY_ACCESS_STATUS.denied;
  return auditReportEvent({
    request_id: result.request_id,
    report_id: result.report_id,
    snapshot_id: result.snapshot?.snapshot_id ?? null,
    event_type: denied
      ? REPORT_AUDIT_EVENT_TYPE.gatewayAccessDenied
      : REPORT_AUDIT_EVENT_TYPE.gatewayAccessAllowed,
    layer: REPORT_AUDIT_LAYER.gateway,
    status: denied ? REPORT_AUDIT_STATUS.failed : REPORT_AUDIT_STATUS.success,
    message: result.denial_reason ?? null,
    metadata: {
      gateway_status: result.status,
      allowed_actions: result.allowed_actions,
    },
  }, options);
}

export async function recordReportMaterializationLifecycleAudit(args: {
  request_id: string;
  report_id?: string | null;
  snapshot_id?: string | null;
  stale_materialized_ids: readonly string[];
  expired_materialized_ids: readonly string[];
}, options?: AuditReportEventOptions): Promise<void> {
  if (args.expired_materialized_ids.length > 0) {
    await auditReportWarning({
      request_id: args.request_id,
      report_id: args.report_id ?? null,
      snapshot_id: args.snapshot_id ?? null,
      event_type: REPORT_AUDIT_EVENT_TYPE.materializationExpiredDetected,
      layer: REPORT_AUDIT_LAYER.materialization,
      message: 'expired_materialized_detected',
      metadata: { materialized_ids: [...args.expired_materialized_ids] },
    }, options);
  }

  if (args.stale_materialized_ids.length > 0) {
    await auditReportWarning({
      request_id: args.request_id,
      report_id: args.report_id ?? null,
      snapshot_id: args.snapshot_id ?? null,
      event_type: REPORT_AUDIT_EVENT_TYPE.materializationStaleDetected,
      layer: REPORT_AUDIT_LAYER.materialization,
      message: 'stale_materialized_detected',
      metadata: { materialized_ids: [...args.stale_materialized_ids] },
    }, options);
  }
}
