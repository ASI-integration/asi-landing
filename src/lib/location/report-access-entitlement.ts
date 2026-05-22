export const REPORT_ACCESS_SUBJECT_TYPE = {
  user: 'user',
  guest: 'guest',
  email: 'email',
  shareLink: 'share_link',
} as const;

export const REPORT_ACCESS_SUBJECT_TYPES = [
  REPORT_ACCESS_SUBJECT_TYPE.user,
  REPORT_ACCESS_SUBJECT_TYPE.guest,
  REPORT_ACCESS_SUBJECT_TYPE.email,
  REPORT_ACCESS_SUBJECT_TYPE.shareLink,
] as const;

export type ReportAccessSubjectType = (typeof REPORT_ACCESS_SUBJECT_TYPES)[number];

export const REPORT_ACCESS_LEVEL = {
  preview: 'preview',
  fullReport: 'full_report',
  pdfDownload: 'pdf_download',
  admin: 'admin',
} as const;

export const REPORT_ACCESS_LEVELS = [
  REPORT_ACCESS_LEVEL.preview,
  REPORT_ACCESS_LEVEL.fullReport,
  REPORT_ACCESS_LEVEL.pdfDownload,
  REPORT_ACCESS_LEVEL.admin,
] as const;

export type ReportAccessLevel = (typeof REPORT_ACCESS_LEVELS)[number];

export const REPORT_ACCESS_ENTITLEMENT_STATUS = {
  active: 'active',
  expired: 'expired',
  revoked: 'revoked',
} as const;

export const REPORT_ACCESS_ENTITLEMENT_STATUSES = [
  REPORT_ACCESS_ENTITLEMENT_STATUS.active,
  REPORT_ACCESS_ENTITLEMENT_STATUS.expired,
  REPORT_ACCESS_ENTITLEMENT_STATUS.revoked,
] as const;

export type ReportAccessEntitlementStatus = (typeof REPORT_ACCESS_ENTITLEMENT_STATUSES)[number];

export type ReportAccessEntitlementMetadata = Record<string, unknown>;

export type ReportAccessEntitlement = {
  entitlement_id: string;
  request_id: string;
  report_id: string | null;
  snapshot_id: string;
  subject_type: ReportAccessSubjectType;
  subject_id: string;
  access_level: ReportAccessLevel;
  status: ReportAccessEntitlementStatus;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: ReportAccessEntitlementMetadata;
};

export type CreateReportAccessEntitlementInput = {
  request_id: string;
  report_id?: string | null;
  snapshot_id: string;
  subject_type: ReportAccessSubjectType;
  subject_id: string;
  access_level: ReportAccessLevel;
  status?: ReportAccessEntitlementStatus;
  expires_at?: string | null;
  metadata?: ReportAccessEntitlementMetadata;
  entitlement_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ReportAccessSummary = {
  preview: boolean;
  full_report: boolean;
  pdf: boolean;
};

export type ReportAccessResolution = {
  can_view_preview: boolean;
  can_view_full: boolean;
  can_download_pdf: boolean;
  can_access_dashboard: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function isReportAccessSubjectType(value: unknown): value is ReportAccessSubjectType {
  return typeof value === 'string' && REPORT_ACCESS_SUBJECT_TYPES.includes(value as ReportAccessSubjectType);
}

export function isReportAccessLevel(value: unknown): value is ReportAccessLevel {
  return typeof value === 'string' && REPORT_ACCESS_LEVELS.includes(value as ReportAccessLevel);
}

export function isReportAccessEntitlementStatus(value: unknown): value is ReportAccessEntitlementStatus {
  return typeof value === 'string' && REPORT_ACCESS_ENTITLEMENT_STATUSES.includes(value as ReportAccessEntitlementStatus);
}

export function normalizeReportAccessSubjectType(
  value: unknown,
  fallback: ReportAccessSubjectType = REPORT_ACCESS_SUBJECT_TYPE.guest,
): ReportAccessSubjectType {
  return isReportAccessSubjectType(value) ? value : fallback;
}

export function normalizeReportAccessLevel(
  value: unknown,
  fallback: ReportAccessLevel = REPORT_ACCESS_LEVEL.preview,
): ReportAccessLevel {
  return isReportAccessLevel(value) ? value : fallback;
}

export function normalizeReportAccessEntitlementStatus(
  value: unknown,
  fallback: ReportAccessEntitlementStatus = REPORT_ACCESS_ENTITLEMENT_STATUS.active,
): ReportAccessEntitlementStatus {
  return isReportAccessEntitlementStatus(value) ? value : fallback;
}

function normalizeEntitlementMetadata(value: unknown): ReportAccessEntitlementMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ReportAccessEntitlementMetadata;
}

export function createReportAccessEntitlement(
  input: CreateReportAccessEntitlementInput,
): ReportAccessEntitlement {
  const timestamp = input.created_at ?? input.updated_at ?? nowIso();
  return {
    entitlement_id: input.entitlement_id ?? crypto.randomUUID(),
    request_id: input.request_id,
    report_id: input.report_id ?? null,
    snapshot_id: input.snapshot_id,
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    access_level: input.access_level,
    status: input.status ?? REPORT_ACCESS_ENTITLEMENT_STATUS.active,
    expires_at: input.expires_at ?? null,
    created_at: timestamp,
    updated_at: input.updated_at ?? timestamp,
    metadata: input.metadata ?? {},
  };
}

export function normalizeReportAccessEntitlementRow(row: unknown): ReportAccessEntitlement {
  const entitlement = row as Partial<ReportAccessEntitlement> & {
    entitlement_id: string;
    request_id: string;
    snapshot_id: string;
    subject_id: string;
  };
  const timestamp = entitlement.updated_at ?? entitlement.created_at ?? nowIso();
  return {
    entitlement_id: entitlement.entitlement_id,
    request_id: entitlement.request_id,
    report_id: typeof entitlement.report_id === 'string' ? entitlement.report_id : entitlement.report_id ?? null,
    snapshot_id: entitlement.snapshot_id,
    subject_type: normalizeReportAccessSubjectType(entitlement.subject_type),
    subject_id: entitlement.subject_id,
    access_level: normalizeReportAccessLevel(entitlement.access_level),
    status: normalizeReportAccessEntitlementStatus(entitlement.status),
    expires_at: entitlement.expires_at ?? null,
    created_at: entitlement.created_at ?? timestamp,
    updated_at: timestamp,
    metadata: normalizeEntitlementMetadata(entitlement.metadata),
  };
}

export function isReportAccessEntitlementEffective(
  entitlement: ReportAccessEntitlement,
  now: Date = new Date(),
): boolean {
  if (entitlement.status !== REPORT_ACCESS_ENTITLEMENT_STATUS.active) return false;
  if (!entitlement.expires_at) return true;
  return new Date(entitlement.expires_at).getTime() > now.getTime();
}

export function accessLevelGrants(
  level: ReportAccessLevel,
): Pick<ReportAccessResolution, 'can_view_preview' | 'can_view_full' | 'can_download_pdf' | 'can_access_dashboard'> {
  switch (level) {
    case REPORT_ACCESS_LEVEL.preview:
      return {
        can_view_preview: true,
        can_view_full: false,
        can_download_pdf: false,
        can_access_dashboard: false,
      };
    case REPORT_ACCESS_LEVEL.fullReport:
      return {
        can_view_preview: true,
        can_view_full: true,
        can_download_pdf: false,
        can_access_dashboard: false,
      };
    case REPORT_ACCESS_LEVEL.pdfDownload:
      return {
        can_view_preview: true,
        can_view_full: true,
        can_download_pdf: true,
        can_access_dashboard: false,
      };
    case REPORT_ACCESS_LEVEL.admin:
      return {
        can_view_preview: true,
        can_view_full: true,
        can_download_pdf: true,
        can_access_dashboard: true,
      };
  }
}

export function buildReportAccessSummary(resolution: ReportAccessResolution): ReportAccessSummary {
  return {
    preview: resolution.can_view_preview,
    full_report: resolution.can_view_full,
    pdf: resolution.can_download_pdf,
  };
}
