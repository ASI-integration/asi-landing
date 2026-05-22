export const REPORT_AUDIT_LAYER = {
  payment: 'payment',
  artifact: 'artifact',
  producer: 'producer',
  adapter: 'adapter',
  document: 'document',
  renderer: 'renderer',
  snapshot: 'snapshot',
  materialization: 'materialization',
  delivery: 'delivery',
  entitlement: 'entitlement',
  gateway: 'gateway',
  lifecycle: 'lifecycle',
} as const;

export const REPORT_AUDIT_LAYERS = [
  REPORT_AUDIT_LAYER.payment,
  REPORT_AUDIT_LAYER.artifact,
  REPORT_AUDIT_LAYER.producer,
  REPORT_AUDIT_LAYER.adapter,
  REPORT_AUDIT_LAYER.document,
  REPORT_AUDIT_LAYER.renderer,
  REPORT_AUDIT_LAYER.snapshot,
  REPORT_AUDIT_LAYER.materialization,
  REPORT_AUDIT_LAYER.delivery,
  REPORT_AUDIT_LAYER.entitlement,
  REPORT_AUDIT_LAYER.gateway,
  REPORT_AUDIT_LAYER.lifecycle,
] as const;

export type ReportAuditLayer = (typeof REPORT_AUDIT_LAYERS)[number];

export const REPORT_AUDIT_STATUS = {
  started: 'started',
  success: 'success',
  skipped: 'skipped',
  failed: 'failed',
  warning: 'warning',
} as const;

export const REPORT_AUDIT_STATUSES = [
  REPORT_AUDIT_STATUS.started,
  REPORT_AUDIT_STATUS.success,
  REPORT_AUDIT_STATUS.skipped,
  REPORT_AUDIT_STATUS.failed,
  REPORT_AUDIT_STATUS.warning,
] as const;

export type ReportAuditStatus = (typeof REPORT_AUDIT_STATUSES)[number];

export const REPORT_AUDIT_EVENT_TYPE = {
  orchestrationStarted: 'orchestration.started',
  orchestrationCompleted: 'orchestration.completed',
  orchestrationFailed: 'orchestration.failed',
  producerPreliminaryCompleted: 'producer.preliminary.completed',
  producerFinalCompleted: 'producer.final.completed',
  producerPdfCompleted: 'producer.pdf.completed',
  snapshotCreated: 'snapshot.created',
  deliveryPlanned: 'delivery.planned',
  entitlementCreated: 'entitlement.created',
  materializationStaleDetected: 'materialization.stale_detected',
  materializationExpiredDetected: 'materialization.expired_detected',
  gatewayAccessDenied: 'gateway.access.denied',
  gatewayAccessAllowed: 'gateway.access.allowed',
} as const;

export type ReportAuditEventType =
  (typeof REPORT_AUDIT_EVENT_TYPE)[keyof typeof REPORT_AUDIT_EVENT_TYPE];

export type ReportAuditMetadata = Record<string, unknown>;

export type ReportAuditEvent = {
  event_id: string;
  request_id: string;
  report_id: string | null;
  snapshot_id: string | null;
  event_type: string;
  layer: ReportAuditLayer;
  status: ReportAuditStatus;
  message: string | null;
  created_at: string;
  metadata: ReportAuditMetadata;
};

export type CreateReportAuditEventInput = {
  request_id: string;
  report_id?: string | null;
  snapshot_id?: string | null;
  event_type: string;
  layer: ReportAuditLayer;
  status: ReportAuditStatus;
  message?: string | null;
  metadata?: ReportAuditMetadata;
  event_id?: string;
  created_at?: string;
};

export type ReportAuditSummary = {
  latest_event: {
    event_type: string;
    layer: ReportAuditLayer;
    status: ReportAuditStatus;
    created_at: string;
  } | null;
  warning_count: number;
  failure_count: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function isReportAuditLayer(value: unknown): value is ReportAuditLayer {
  return typeof value === 'string' && REPORT_AUDIT_LAYERS.includes(value as ReportAuditLayer);
}

export function isReportAuditStatus(value: unknown): value is ReportAuditStatus {
  return typeof value === 'string' && REPORT_AUDIT_STATUSES.includes(value as ReportAuditStatus);
}

export function normalizeReportAuditLayer(
  value: unknown,
  fallback: ReportAuditLayer = REPORT_AUDIT_LAYER.lifecycle,
): ReportAuditLayer {
  return isReportAuditLayer(value) ? value : fallback;
}

export function normalizeReportAuditStatus(
  value: unknown,
  fallback: ReportAuditStatus = REPORT_AUDIT_STATUS.started,
): ReportAuditStatus {
  return isReportAuditStatus(value) ? value : fallback;
}

function normalizeAuditMetadata(value: unknown): ReportAuditMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ReportAuditMetadata;
}

export function createReportAuditEvent(input: CreateReportAuditEventInput): ReportAuditEvent {
  return {
    event_id: input.event_id ?? crypto.randomUUID(),
    request_id: input.request_id,
    report_id: input.report_id ?? null,
    snapshot_id: input.snapshot_id ?? null,
    event_type: input.event_type,
    layer: input.layer,
    status: input.status,
    message: input.message ?? null,
    created_at: input.created_at ?? nowIso(),
    metadata: input.metadata ?? {},
  };
}

export function normalizeReportAuditEventRow(row: unknown): ReportAuditEvent {
  const event = row as Partial<ReportAuditEvent> & {
    event_id: string;
    request_id: string;
  };
  return {
    event_id: event.event_id,
    request_id: event.request_id,
    report_id: typeof event.report_id === 'string' ? event.report_id : event.report_id ?? null,
    snapshot_id: typeof event.snapshot_id === 'string' ? event.snapshot_id : event.snapshot_id ?? null,
    event_type: event.event_type ?? 'unknown',
    layer: normalizeReportAuditLayer(event.layer),
    status: normalizeReportAuditStatus(event.status),
    message: typeof event.message === 'string' ? event.message : event.message ?? null,
    created_at: event.created_at ?? nowIso(),
    metadata: normalizeAuditMetadata(event.metadata),
  };
}

export function buildReportAuditSummary(events: readonly ReportAuditEvent[]): ReportAuditSummary {
  const sorted = [...events].sort((left, right) => {
    if (left.created_at === right.created_at) return 0;
    return left.created_at < right.created_at ? 1 : -1;
  });
  const latest = sorted[0] ?? null;
  let warning_count = 0;
  let failure_count = 0;
  for (const event of events) {
    if (event.status === REPORT_AUDIT_STATUS.warning) warning_count += 1;
    if (event.status === REPORT_AUDIT_STATUS.failed) failure_count += 1;
  }

  return {
    latest_event: latest
      ? {
          event_type: latest.event_type,
          layer: latest.layer,
          status: latest.status,
          created_at: latest.created_at,
        }
      : null,
    warning_count,
    failure_count,
  };
}
