import { planReportAccessEntitlements } from './report-access-entitlement-planner';
import {
  createPlannedReportAccessEntitlements,
  reportAccessEntitlementRepository,
  type ReportAccessEntitlementRepository,
} from './report-access-entitlement-repository';
import type { ReportAccessEntitlement } from './report-access-entitlement';
import type { LocationReportRequestEntity } from './report-request-store';
import type { ReportSnapshot } from './report-snapshot';
import type { ReportSnapshotRepository } from './report-snapshot-repository';
import {
  REPORT_AUDIT_EVENT_TYPE,
  REPORT_AUDIT_LAYER,
} from './report-audit-event';
import { auditReportEvent } from './report-audit';

export async function createEntitlementsForFinalSnapshot(args: {
  snapshot: ReportSnapshot;
  request: Pick<LocationReportRequestEntity, 'delivery_channel' | 'delivery_target'>;
  entitlementRepository?: ReportAccessEntitlementRepository;
}): Promise<ReportAccessEntitlement[]> {
  const planned = planReportAccessEntitlements(args.snapshot, args.request);
  const created = await createPlannedReportAccessEntitlements(
    planned,
    args.entitlementRepository ?? reportAccessEntitlementRepository,
  );
  void auditReportEvent({
    request_id: args.snapshot.request_id,
    report_id: args.snapshot.report_id,
    snapshot_id: args.snapshot.snapshot_id,
    event_type: REPORT_AUDIT_EVENT_TYPE.entitlementCreated,
    layer: REPORT_AUDIT_LAYER.entitlement,
    message: 'entitlements_planned_for_final_snapshot',
    metadata: {
      planned_count: planned.length,
      created_count: created.length,
    },
  });
  return created;
}

export async function ensureEntitlementsAfterFinalSnapshot(args: {
  requestId: string;
  request: Pick<LocationReportRequestEntity, 'delivery_channel' | 'delivery_target'>;
  snapshotRepository: ReportSnapshotRepository;
  entitlementRepository?: ReportAccessEntitlementRepository;
}): Promise<ReportAccessEntitlement[]> {
  const snapshot = await args.snapshotRepository.getLatestSnapshot(args.requestId, {
    reportLayer: 'final',
  });
  if (!snapshot) return [];

  const entitlements = args.entitlementRepository ?? reportAccessEntitlementRepository;
  const existing = await entitlements.getEntitlementsByRequestId(args.requestId);
  if (existing.length > 0) return existing;

  return createEntitlementsForFinalSnapshot({
    snapshot,
    request: args.request,
    entitlementRepository: entitlements,
  });
}
