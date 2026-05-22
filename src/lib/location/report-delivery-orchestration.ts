import { planReportDeliveries } from './report-delivery-planner';
import {
  createPlannedReportDeliveries,
  reportDeliveryRepository,
  type ReportDeliveryRepository,
} from './report-delivery-repository';
import type { ReportDelivery } from './report-delivery';
import type { LocationReportRequestEntity } from './report-request-store';
import type { ReportSnapshot } from './report-snapshot';
import type { ReportSnapshotRepository } from './report-snapshot-repository';
import {
  REPORT_AUDIT_EVENT_TYPE,
  REPORT_AUDIT_LAYER,
} from './report-audit-event';
import { auditReportEvent } from './report-audit';

export function resolveEmailDeliveryTarget(
  entity: Pick<LocationReportRequestEntity, 'delivery_channel' | 'delivery_target'>,
): string | null {
  if (entity.delivery_channel !== 'email') return null;
  const target = entity.delivery_target?.trim();
  return target || null;
}

export async function createDeliveriesForFinalSnapshot(args: {
  snapshot: ReportSnapshot;
  request: Pick<LocationReportRequestEntity, 'delivery_channel' | 'delivery_target'>;
  deliveryRepository?: ReportDeliveryRepository;
}): Promise<ReportDelivery[]> {
  const planned = planReportDeliveries(args.snapshot, {
    emailTarget: resolveEmailDeliveryTarget(args.request),
  });
  const created = await createPlannedReportDeliveries(
    planned,
    args.deliveryRepository ?? reportDeliveryRepository,
  );
  void auditReportEvent({
    request_id: args.snapshot.request_id,
    report_id: args.snapshot.report_id,
    snapshot_id: args.snapshot.snapshot_id,
    event_type: REPORT_AUDIT_EVENT_TYPE.deliveryPlanned,
    layer: REPORT_AUDIT_LAYER.delivery,
    message: 'deliveries_planned_for_final_snapshot',
    metadata: {
      planned_count: planned.length,
      created_count: created.length,
      channels: created.map(delivery => delivery.channel),
    },
  });
  return created;
}

export async function ensureDeliveriesAfterFinalSnapshot(args: {
  requestId: string;
  request: Pick<LocationReportRequestEntity, 'delivery_channel' | 'delivery_target'>;
  snapshotRepository: ReportSnapshotRepository;
  deliveryRepository?: ReportDeliveryRepository;
}): Promise<ReportDelivery[]> {
  const snapshot = await args.snapshotRepository.getLatestSnapshot(args.requestId, {
    reportLayer: 'final',
  });
  if (!snapshot) return [];

  const deliveries = args.deliveryRepository ?? reportDeliveryRepository;
  const existing = await deliveries.getDeliveriesByRequestId(args.requestId);
  if (existing.length > 0) return existing;

  return createDeliveriesForFinalSnapshot({
    snapshot,
    request: args.request,
    deliveryRepository: deliveries,
  });
}
