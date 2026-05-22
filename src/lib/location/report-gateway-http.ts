import type { ReportAccessEntitlement } from './report-access-entitlement';
import {
  resolveReportGatewayAccess,
  type ReportGatewayAccessResult,
  type ReportGatewayIntent,
} from './report-gateway';
import type { ReportSnapshot } from './report-snapshot';
import type { ReportSnapshotRepository } from './report-snapshot-repository';
import type { ReportAccessEntitlementRepository } from './report-access-entitlement-repository';
import { recordReportGatewayAccessAudit } from './report-audit';

export type ReportGatewayHttpQuery = {
  shareToken?: string | null;
  snapshotId?: string | null;
  requestId?: string | null;
};

export type ReportGatewayHttpDeps = {
  entitlementRepository: Pick<ReportAccessEntitlementRepository, 'getEntitlementsByRequestId'>;
  snapshotRepository: Pick<ReportSnapshotRepository, 'getLatestSnapshot' | 'listSnapshots'>;
};

function pickQueryValue(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function loadReportGatewayContext(
  reportId: string,
  query: ReportGatewayHttpQuery,
  deps: ReportGatewayHttpDeps,
): Promise<{
  entitlements: ReportAccessEntitlement[];
  snapshot: ReportSnapshot | null;
  snapshots: ReportSnapshot[];
  requestId: string;
}> {
  const requestId = pickQueryValue(query.requestId) ?? reportId;
  const [entitlements, snapshot, snapshots] = await Promise.all([
    deps.entitlementRepository.getEntitlementsByRequestId(requestId),
    deps.snapshotRepository.getLatestSnapshot(requestId, { reportLayer: 'final' }),
    deps.snapshotRepository.listSnapshots(requestId, { reportLayer: 'final', limit: 20 }),
  ]);

  return { entitlements, snapshot, snapshots, requestId };
}

export async function resolveReportGatewayHttpAccess(
  reportId: string,
  intent: ReportGatewayIntent,
  query: ReportGatewayHttpQuery,
  deps: ReportGatewayHttpDeps,
): Promise<ReportGatewayAccessResult> {
  const context = await loadReportGatewayContext(reportId, query, deps);
  const result = resolveReportGatewayAccess({
    reportId,
    requestId: context.requestId,
    snapshotId: pickQueryValue(query.snapshotId),
    shareToken: pickQueryValue(query.shareToken),
    entitlements: context.entitlements,
    snapshot: context.snapshot,
    snapshots: context.snapshots,
    intent,
  });
  void recordReportGatewayAccessAudit(result);
  return result;
}
