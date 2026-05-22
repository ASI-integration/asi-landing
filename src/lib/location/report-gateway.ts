import type { ReportAccessEntitlement, ReportAccessSubjectType } from './report-access-entitlement';
import { REPORT_ACCESS_SUBJECT_TYPE } from './report-access-entitlement';
import {
  resolveReportAccess,
  type ResolveReportAccessInput,
} from './report-access-resolver';
import type { ReportAccessResolution, ReportAccessSummary } from './report-access-entitlement';
import { buildReportAccessSummary } from './report-access-entitlement';
import type { ReportDeliveryChannel } from './report-delivery';
import type { ReportGatewayRenderTargets } from './report-gateway-render';
import { resolveReportGatewayRenderTargets } from './report-gateway-render';
import type { MaterializedReport } from './report-materialized';
import type { ReportSnapshot } from './report-snapshot';

export const REPORT_GATEWAY_ACCESS_STATUS = {
  denied: 'denied',
  preview: 'preview',
  full: 'full',
} as const;

export type ReportGatewayAccessStatus =
  (typeof REPORT_GATEWAY_ACCESS_STATUS)[keyof typeof REPORT_GATEWAY_ACCESS_STATUS];

export const REPORT_GATEWAY_ALLOWED_ACTION = {
  viewPreview: 'view_preview',
  viewFull: 'view_full',
  downloadPdf: 'download_pdf',
} as const;

export type ReportGatewayAllowedAction =
  (typeof REPORT_GATEWAY_ALLOWED_ACTION)[keyof typeof REPORT_GATEWAY_ALLOWED_ACTION];

export type ReportGatewayIntent = 'preview' | 'full' | 'pdf';

export type ReportGatewaySubjectContext = {
  subjectType?: ReportAccessSubjectType;
  subjectId?: string;
};

export type ResolveReportGatewayAccessInput = {
  reportId: string;
  requestId?: string;
  snapshotId?: string;
  shareToken?: string;
  subject?: ReportGatewaySubjectContext;
  deliveryChannel?: ReportDeliveryChannel;
  entitlements: ReportAccessEntitlement[];
  snapshot?: ReportSnapshot | null;
  snapshots?: ReportSnapshot[];
  materialized?: readonly MaterializedReport[];
  intent?: ReportGatewayIntent;
  now?: Date;
  onStaleMaterialized?: (materializedIds: string[]) => void;
};

export type ReportGatewayAccessResult = {
  status: ReportGatewayAccessStatus;
  request_id: string;
  report_id: string;
  snapshot: ReportSnapshot | null;
  access: ReportAccessResolution;
  summary: ReportAccessSummary;
  render_targets: ReportGatewayRenderTargets | null;
  allowed_actions: ReportGatewayAllowedAction[];
  denial_reason?: string;
};

function resolveGatewayRequestId(
  reportId: string,
  entitlements: ReportAccessEntitlement[],
  snapshot: ReportSnapshot | null,
  explicitRequestId?: string,
): string {
  if (explicitRequestId) return explicitRequestId;
  if (snapshot?.request_id) return snapshot.request_id;
  const entitlementMatch = entitlements.find(
    entitlement => entitlement.report_id === reportId || entitlement.request_id === reportId,
  );
  return entitlementMatch?.request_id ?? reportId;
}

function resolveGatewaySubject(
  reportId: string,
  requestId: string,
  input: ResolveReportGatewayAccessInput,
): Pick<ResolveReportAccessInput, 'subjectType' | 'subjectId'> {
  if (input.shareToken) {
    return {
      subjectType: REPORT_ACCESS_SUBJECT_TYPE.shareLink,
      subjectId: input.shareToken,
    };
  }

  if (input.subject?.subjectType && input.subject.subjectId) {
    return {
      subjectType: input.subject.subjectType,
      subjectId: input.subject.subjectId,
    };
  }

  return {
    subjectType: REPORT_ACCESS_SUBJECT_TYPE.guest,
    subjectId: requestId,
  };
}

export function resolveReportGatewaySnapshot(
  input: Pick<ResolveReportGatewayAccessInput, 'snapshot' | 'snapshotId' | 'snapshots'>,
): ReportSnapshot | null {
  if (input.snapshot) return input.snapshot;
  const snapshots = input.snapshots ?? [];
  if (input.snapshotId) {
    return snapshots.find(item => item.snapshot_id === input.snapshotId) ?? null;
  }
  if (snapshots.length === 0) return null;
  return [...snapshots].sort((left, right) => right.version - left.version)[0] ?? null;
}

function buildAllowedActions(access: ReportAccessResolution): ReportGatewayAllowedAction[] {
  const actions: ReportGatewayAllowedAction[] = [];
  if (access.can_view_preview) actions.push(REPORT_GATEWAY_ALLOWED_ACTION.viewPreview);
  if (access.can_view_full) actions.push(REPORT_GATEWAY_ALLOWED_ACTION.viewFull);
  if (access.can_download_pdf) actions.push(REPORT_GATEWAY_ALLOWED_ACTION.downloadPdf);
  return actions;
}

function intentDeniedReason(intent: ReportGatewayIntent, access: ReportAccessResolution): string {
  if (intent === 'pdf' && !access.can_download_pdf) return 'pdf_not_allowed';
  if (intent === 'full' && !access.can_view_full) return 'full_report_not_allowed';
  if (intent === 'preview' && !access.can_view_preview) return 'preview_not_allowed';
  return 'access_denied';
}

function resolveGatewayStatus(
  intent: ReportGatewayIntent,
  access: ReportAccessResolution,
): { status: ReportGatewayAccessStatus; denial_reason?: string } {
  if (!access.can_view_preview && !access.can_view_full && !access.can_download_pdf) {
    return { status: REPORT_GATEWAY_ACCESS_STATUS.denied, denial_reason: 'no_effective_entitlement' };
  }

  if (intent === 'pdf') {
    if (!access.can_download_pdf) {
      return { status: REPORT_GATEWAY_ACCESS_STATUS.denied, denial_reason: intentDeniedReason(intent, access) };
    }
    return { status: REPORT_GATEWAY_ACCESS_STATUS.full };
  }

  if (intent === 'preview') {
    if (!access.can_view_preview) {
      return { status: REPORT_GATEWAY_ACCESS_STATUS.denied, denial_reason: intentDeniedReason(intent, access) };
    }
    return { status: REPORT_GATEWAY_ACCESS_STATUS.preview };
  }

  if (!access.can_view_full) {
    if (access.can_view_preview) {
      return { status: REPORT_GATEWAY_ACCESS_STATUS.preview, denial_reason: 'preview_only_entitlement' };
    }
    return { status: REPORT_GATEWAY_ACCESS_STATUS.denied, denial_reason: intentDeniedReason(intent, access) };
  }

  return { status: REPORT_GATEWAY_ACCESS_STATUS.full };
}

export function resolveReportGatewayAccess(
  input: ResolveReportGatewayAccessInput,
): ReportGatewayAccessResult {
  const intent = input.intent ?? 'full';
  const snapshot = resolveReportGatewaySnapshot(input);
  const requestId = resolveGatewayRequestId(input.reportId, input.entitlements, snapshot, input.requestId);
  const subject = resolveGatewaySubject(input.reportId, requestId, input);
  const access = resolveReportAccess({
    entitlements: input.entitlements,
    requestId,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    now: input.now,
  });
  const summary = buildReportAccessSummary(access);
  const { status, denial_reason } = resolveGatewayStatus(intent, access);

  return {
    status,
    request_id: requestId,
    report_id: input.reportId,
    snapshot,
    access,
    summary,
    render_targets: resolveReportGatewayRenderTargets(snapshot, {
      materialized: input.materialized,
      now: input.now,
      onStaleMaterialized: input.onStaleMaterialized,
    }),
    allowed_actions: buildAllowedActions(access),
    denial_reason,
  };
}
