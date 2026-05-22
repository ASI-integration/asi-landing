import {
  REPORT_AUDIT_LAYER,
  REPORT_AUDIT_STATUS,
  type ReportAuditEvent,
  type ReportAuditLayer,
  type ReportAuditStatus,
} from './report-audit-event';
import type { ReportAccessEntitlement } from './report-access-entitlement';
import type { ReportArtifact, ReportArtifactStatus } from './report-artifact';
import { REPORT_ARTIFACT_STATUS } from './report-artifact';
import type { CanonicalReportDocumentMetadata } from './canonical-report-document';
import type { ReportDelivery } from './report-delivery';
import type { ReportSnapshot } from './report-snapshot';

export const REPORT_DEBUG_TIMELINE_SEVERITY = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const;

export type ReportDebugTimelineSeverity =
  (typeof REPORT_DEBUG_TIMELINE_SEVERITY)[keyof typeof REPORT_DEBUG_TIMELINE_SEVERITY];

export type ReportDebugTimelineItem = {
  time: string;
  layer: ReportAuditLayer | 'artifact' | 'snapshot';
  status: ReportAuditStatus | ReportArtifactStatus | string;
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
  severity: ReportDebugTimelineSeverity;
};

export type ReportSnapshotDebugSummary = {
  snapshot_id: string;
  report_id: string | null;
  request_id: string;
  version: number;
  status: ReportSnapshot['status'];
  report_layer: ReportSnapshot['report_layer'];
  generated_at: string | null;
  created_at: string;
  source_summary: ReportSnapshot['source_summary'];
  document_metadata: CanonicalReportDocumentMetadata;
};

export type ReportArtifactDebugView = Omit<ReportArtifact, 'metadata'> & {
  metadata: Record<string, unknown>;
};

export const REPORT_DEBUG_REDACTED = '[redacted]';

const SENSITIVE_METADATA_KEY = /^(token|secret|password|api[_-]?key|authorization|cookie|session|email|phone)$/i;

const EMAIL_LIKE_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const BEARER_TOKEN_VALUE = /^Bearer\s+\S+/i;

const API_KEY_PREFIX_VALUE = /^(sk_|pk_|rk_|api[_-]?key[_-]?)/i;

const HEAVY_ARTIFACT_METADATA_KEYS = new Set([
  'canonical_document',
  'canonical_render_outputs',
  'report_sections',
  'adapter_summary',
]);

export function isSensitiveReportDebugMetadataKey(key: string): boolean {
  return SENSITIVE_METADATA_KEY.test(key);
}

export function looksLikeSensitiveReportDebugString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (EMAIL_LIKE_VALUE.test(trimmed)) return true;
  if (BEARER_TOKEN_VALUE.test(trimmed)) return true;
  if (API_KEY_PREFIX_VALUE.test(trimmed)) return true;
  if (/secret|password|token/i.test(trimmed) && trimmed.length >= 12) return true;
  return false;
}

export function redactReportDebugString(value: string): string {
  return looksLikeSensitiveReportDebugString(value) ? REPORT_DEBUG_REDACTED : value;
}

export function sanitizeReportDebugDeliveryTarget(target: string | null): string | null {
  if (target == null) return null;
  return redactReportDebugString(target);
}

export function sanitizeReportDebugEntitlementSubject(subjectId: string): string {
  return REPORT_DEBUG_REDACTED;
}

function sanitizeReportDebugValue(value: unknown): unknown {
  if (typeof value === 'string') return redactReportDebugString(value);
  if (Array.isArray(value)) return value.map(sanitizeReportDebugValue);
  if (value && typeof value === 'object') {
    return sanitizeReportDebugMetadata(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeReportDebugMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'subject_id') {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeReportDebugEntitlementSubject(value);
      }
      continue;
    }
    if (isSensitiveReportDebugMetadataKey(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeReportDebugMetadata(value as Record<string, unknown>);
      continue;
    }
    sanitized[key] = sanitizeReportDebugValue(value);
  }
  return sanitized;
}

export function sanitizeReportSnapshotSourceSummary(
  summary: ReportSnapshot['source_summary'],
): ReportSnapshot['source_summary'] {
  return {
    ...summary,
    adapters: summary.adapters.map(adapter => ({
      ...adapter,
      label: redactReportDebugString(adapter.label),
    })),
  };
}

export function compactReportArtifactMetadata(
  metadata: ReportArtifact['metadata'] | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (HEAVY_ARTIFACT_METADATA_KEYS.has(key)) continue;
    compact[key] = value;
  }
  return sanitizeReportDebugMetadata(compact);
}

export function toDebugReportArtifact(artifact: ReportArtifact): ReportArtifactDebugView {
  const { metadata, ...rest } = artifact;
  return {
    ...rest,
    metadata: compactReportArtifactMetadata(metadata),
  };
}

export function buildReportSnapshotDebugSummary(
  snapshot: ReportSnapshot,
): ReportSnapshotDebugSummary {
  return {
    snapshot_id: snapshot.snapshot_id,
    report_id: snapshot.report_id,
    request_id: snapshot.request_id,
    version: snapshot.version,
    status: snapshot.status,
    report_layer: snapshot.report_layer,
    generated_at: snapshot.generated_at,
    created_at: snapshot.created_at,
    source_summary: sanitizeReportSnapshotSourceSummary(snapshot.source_summary),
    document_metadata: snapshot.canonical_document.metadata,
  };
}

export function auditStatusToDebugTimelineSeverity(
  status: ReportAuditStatus,
): ReportDebugTimelineSeverity {
  switch (status) {
    case REPORT_AUDIT_STATUS.success:
      return REPORT_DEBUG_TIMELINE_SEVERITY.success;
    case REPORT_AUDIT_STATUS.warning:
      return REPORT_DEBUG_TIMELINE_SEVERITY.warning;
    case REPORT_AUDIT_STATUS.failed:
      return REPORT_DEBUG_TIMELINE_SEVERITY.error;
    case REPORT_AUDIT_STATUS.skipped:
    case REPORT_AUDIT_STATUS.started:
    default:
      return REPORT_DEBUG_TIMELINE_SEVERITY.info;
  }
}

function artifactStatusToTimelineSeverity(
  status: ReportArtifactStatus,
): ReportDebugTimelineSeverity {
  if (status === REPORT_ARTIFACT_STATUS.failed) {
    return REPORT_DEBUG_TIMELINE_SEVERITY.error;
  }
  if (
    status === REPORT_ARTIFACT_STATUS.pdfReady
    || status === REPORT_ARTIFACT_STATUS.finalReady
    || status === REPORT_ARTIFACT_STATUS.preliminaryReady
  ) {
    return REPORT_DEBUG_TIMELINE_SEVERITY.success;
  }
  return REPORT_DEBUG_TIMELINE_SEVERITY.info;
}

function formatAuditEventTitle(event: ReportAuditEvent): string {
  return event.event_type.replaceAll('.', ' ');
}

function auditEventToTimelineItem(event: ReportAuditEvent): ReportDebugTimelineItem {
  return {
    time: event.created_at,
    layer: event.layer,
    status: event.status,
    title: formatAuditEventTitle(event),
    message: event.message,
    metadata: sanitizeReportDebugMetadata({
      event_id: event.event_id,
      event_type: event.event_type,
      report_id: event.report_id,
      snapshot_id: event.snapshot_id,
      ...event.metadata,
    }),
    severity: auditStatusToDebugTimelineSeverity(event.status),
  };
}

function artifactToTimelineItem(artifact: ReportArtifact): ReportDebugTimelineItem {
  return {
    time: artifact.updated_at,
    layer: REPORT_AUDIT_LAYER.artifact,
    status: artifact.status,
    title: 'Artifact state',
    message: null,
    metadata: sanitizeReportDebugMetadata({
      status: artifact.status,
      generated_at: artifact.generated_at,
      expires_at: artifact.expires_at,
      cleanup_ready: artifact.cleanup_ready,
      ...compactReportArtifactMetadata(artifact.metadata),
    }),
    severity: artifactStatusToTimelineSeverity(artifact.status),
  };
}

function snapshotToTimelineItem(snapshot: ReportSnapshot): ReportDebugTimelineItem {
  const summary = buildReportSnapshotDebugSummary(snapshot);
  return {
    time: snapshot.created_at,
    layer: REPORT_AUDIT_LAYER.snapshot,
    status: snapshot.status,
    title: 'Latest snapshot',
    message: `${snapshot.report_layer} v${snapshot.version}`,
    metadata: sanitizeReportDebugMetadata({
      snapshot_id: summary.snapshot_id,
      report_layer: summary.report_layer,
      version: summary.version,
      adapter_count: summary.source_summary.adapter_count,
      signal_count: summary.source_summary.signal_count,
      warning_count: summary.source_summary.warning_count,
      document_metadata: summary.document_metadata,
    }),
    severity: snapshot.status === 'ready'
      ? REPORT_DEBUG_TIMELINE_SEVERITY.success
      : REPORT_DEBUG_TIMELINE_SEVERITY.error,
  };
}

function deliveryToTimelineItem(delivery: ReportDelivery): ReportDebugTimelineItem {
  const status = delivery.status;
  const severity = status === 'failed'
    ? REPORT_DEBUG_TIMELINE_SEVERITY.error
    : status === 'skipped'
      ? REPORT_DEBUG_TIMELINE_SEVERITY.warning
      : status === 'delivered' || status === 'ready'
        ? REPORT_DEBUG_TIMELINE_SEVERITY.success
        : REPORT_DEBUG_TIMELINE_SEVERITY.info;

  return {
    time: delivery.updated_at,
    layer: REPORT_AUDIT_LAYER.delivery,
    status,
    title: `Delivery ${delivery.channel}`,
    message: sanitizeReportDebugDeliveryTarget(delivery.target),
    metadata: sanitizeReportDebugMetadata({
      delivery_id: delivery.delivery_id,
      channel: delivery.channel,
      snapshot_id: delivery.snapshot_id,
      delivered_at: delivery.delivered_at,
      ...delivery.metadata,
    }),
    severity,
  };
}

function entitlementToTimelineItem(entitlement: ReportAccessEntitlement): ReportDebugTimelineItem {
  const status = entitlement.status;
  const severity = status === 'revoked' || status === 'expired'
    ? REPORT_DEBUG_TIMELINE_SEVERITY.warning
    : REPORT_DEBUG_TIMELINE_SEVERITY.success;

  return {
    time: entitlement.updated_at,
    layer: REPORT_AUDIT_LAYER.entitlement,
    status,
    title: `Entitlement ${entitlement.access_level}`,
    message: null,
    metadata: sanitizeReportDebugMetadata({
      entitlement_id: entitlement.entitlement_id,
      access_level: entitlement.access_level,
      subject_type: entitlement.subject_type,
      subject_id: sanitizeReportDebugEntitlementSubject(entitlement.subject_id),
      snapshot_id: entitlement.snapshot_id,
      expires_at: entitlement.expires_at,
      ...entitlement.metadata,
    }),
    severity,
  };
}

export type BuildReportDebugTimelineInput = {
  auditEvents: readonly ReportAuditEvent[];
  artifact: ReportArtifact | null;
  latestSnapshot: ReportSnapshot | null;
  deliveries: readonly ReportDelivery[];
  entitlements: readonly ReportAccessEntitlement[];
};

export function buildReportDebugTimeline(
  input: BuildReportDebugTimelineInput,
): ReportDebugTimelineItem[] {
  const items: ReportDebugTimelineItem[] = input.auditEvents.map(auditEventToTimelineItem);

  if (input.artifact) items.push(artifactToTimelineItem(input.artifact));
  if (input.latestSnapshot) items.push(snapshotToTimelineItem(input.latestSnapshot));
  for (const delivery of input.deliveries) items.push(deliveryToTimelineItem(delivery));
  for (const entitlement of input.entitlements) items.push(entitlementToTimelineItem(entitlement));

  return items.sort((left, right) => {
    if (left.time === right.time) return 0;
    return left.time < right.time ? -1 : 1;
  });
}
