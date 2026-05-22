import {
  accessLevelGrants,
  buildReportAccessSummary,
  isReportAccessEntitlementEffective,
  type ReportAccessEntitlement,
  type ReportAccessResolution,
  type ReportAccessSubjectType,
  type ReportAccessSummary,
} from './report-access-entitlement';

export type ResolveReportAccessInput = {
  entitlements: ReportAccessEntitlement[];
  requestId: string;
  subjectType?: ReportAccessSubjectType;
  subjectId?: string;
  now?: Date;
};

const EMPTY_RESOLUTION: ReportAccessResolution = {
  can_view_preview: false,
  can_view_full: false,
  can_download_pdf: false,
  can_access_dashboard: false,
};

export function resolveReportAccess(input: ResolveReportAccessInput): ReportAccessResolution {
  const now = input.now ?? new Date();
  const scoped = input.entitlements.filter(entitlement => {
    if (entitlement.request_id !== input.requestId) return false;
    if (input.subjectType && entitlement.subject_type !== input.subjectType) return false;
    if (input.subjectId && entitlement.subject_id !== input.subjectId) return false;
    return isReportAccessEntitlementEffective(entitlement, now);
  });

  if (scoped.length === 0) return { ...EMPTY_RESOLUTION };

  return scoped.reduce<ReportAccessResolution>((resolution, entitlement) => {
    const grants = accessLevelGrants(entitlement.access_level);
    return {
      can_view_preview: resolution.can_view_preview || grants.can_view_preview,
      can_view_full: resolution.can_view_full || grants.can_view_full,
      can_download_pdf: resolution.can_download_pdf || grants.can_download_pdf,
      can_access_dashboard: resolution.can_access_dashboard || grants.can_access_dashboard,
    };
  }, { ...EMPTY_RESOLUTION });
}

export function resolveReportAccessSummary(input: ResolveReportAccessInput): ReportAccessSummary {
  return buildReportAccessSummary(resolveReportAccess(input));
}
