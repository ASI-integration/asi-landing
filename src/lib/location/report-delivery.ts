export const REPORT_DELIVERY_CHANNEL = {
  cabinet: 'cabinet',
  email: 'email',
  permalink: 'permalink',
  pdfDownload: 'pdf_download',
} as const;

export const REPORT_DELIVERY_CHANNELS = [
  REPORT_DELIVERY_CHANNEL.cabinet,
  REPORT_DELIVERY_CHANNEL.email,
  REPORT_DELIVERY_CHANNEL.permalink,
  REPORT_DELIVERY_CHANNEL.pdfDownload,
] as const;

export type ReportDeliveryChannel = (typeof REPORT_DELIVERY_CHANNELS)[number];

export const REPORT_DELIVERY_STATUS = {
  pending: 'pending',
  ready: 'ready',
  delivered: 'delivered',
  failed: 'failed',
  skipped: 'skipped',
} as const;

export const REPORT_DELIVERY_STATUSES = [
  REPORT_DELIVERY_STATUS.pending,
  REPORT_DELIVERY_STATUS.ready,
  REPORT_DELIVERY_STATUS.delivered,
  REPORT_DELIVERY_STATUS.failed,
  REPORT_DELIVERY_STATUS.skipped,
] as const;

export type ReportDeliveryStatus = (typeof REPORT_DELIVERY_STATUSES)[number];

export type ReportDeliveryMetadata = Record<string, unknown>;

export type ReportDelivery = {
  delivery_id: string;
  request_id: string;
  snapshot_id: string;
  channel: ReportDeliveryChannel;
  status: ReportDeliveryStatus;
  target: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  metadata: ReportDeliveryMetadata;
};

export type CreateReportDeliveryInput = {
  request_id: string;
  snapshot_id: string;
  channel: ReportDeliveryChannel;
  status: ReportDeliveryStatus;
  target?: string | null;
  delivered_at?: string | null;
  metadata?: ReportDeliveryMetadata;
  delivery_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ReportDeliverySummary = {
  cabinet: ReportDeliveryStatus;
  permalink: ReportDeliveryStatus;
  pdf: ReportDeliveryStatus;
  email: ReportDeliveryStatus;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function isReportDeliveryChannel(value: unknown): value is ReportDeliveryChannel {
  return typeof value === 'string' && REPORT_DELIVERY_CHANNELS.includes(value as ReportDeliveryChannel);
}

export function isReportDeliveryStatus(value: unknown): value is ReportDeliveryStatus {
  return typeof value === 'string' && REPORT_DELIVERY_STATUSES.includes(value as ReportDeliveryStatus);
}

export function normalizeReportDeliveryChannel(
  value: unknown,
  fallback: ReportDeliveryChannel = REPORT_DELIVERY_CHANNEL.cabinet,
): ReportDeliveryChannel {
  return isReportDeliveryChannel(value) ? value : fallback;
}

export function normalizeReportDeliveryStatus(
  value: unknown,
  fallback: ReportDeliveryStatus = REPORT_DELIVERY_STATUS.pending,
): ReportDeliveryStatus {
  return isReportDeliveryStatus(value) ? value : fallback;
}

function normalizeDeliveryMetadata(value: unknown): ReportDeliveryMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ReportDeliveryMetadata;
}

export function createReportDelivery(input: CreateReportDeliveryInput): ReportDelivery {
  const timestamp = input.created_at ?? input.updated_at ?? nowIso();
  return {
    delivery_id: input.delivery_id ?? crypto.randomUUID(),
    request_id: input.request_id,
    snapshot_id: input.snapshot_id,
    channel: input.channel,
    status: input.status,
    target: input.target ?? null,
    created_at: timestamp,
    updated_at: input.updated_at ?? timestamp,
    delivered_at: input.delivered_at ?? null,
    metadata: input.metadata ?? {},
  };
}

export function normalizeReportDeliveryRow(row: unknown): ReportDelivery {
  const delivery = row as Partial<ReportDelivery> & {
    delivery_id: string;
    request_id: string;
    snapshot_id: string;
  };
  const timestamp = delivery.updated_at ?? delivery.created_at ?? nowIso();
  return {
    delivery_id: delivery.delivery_id,
    request_id: delivery.request_id,
    snapshot_id: delivery.snapshot_id,
    channel: normalizeReportDeliveryChannel(delivery.channel),
    status: normalizeReportDeliveryStatus(delivery.status),
    target: typeof delivery.target === 'string' ? delivery.target : delivery.target ?? null,
    created_at: delivery.created_at ?? timestamp,
    updated_at: timestamp,
    delivered_at: delivery.delivered_at ?? null,
    metadata: normalizeDeliveryMetadata(delivery.metadata),
  };
}

export function buildReportDeliverySummary(deliveries: ReportDelivery[]): ReportDeliverySummary {
  const byChannel = new Map<ReportDeliveryChannel, ReportDeliveryStatus>();
  for (const delivery of deliveries) {
    byChannel.set(delivery.channel, delivery.status);
  }

  return {
    cabinet: byChannel.get(REPORT_DELIVERY_CHANNEL.cabinet) ?? REPORT_DELIVERY_STATUS.pending,
    permalink: byChannel.get(REPORT_DELIVERY_CHANNEL.permalink) ?? REPORT_DELIVERY_STATUS.pending,
    pdf: byChannel.get(REPORT_DELIVERY_CHANNEL.pdfDownload) ?? REPORT_DELIVERY_STATUS.pending,
    email: byChannel.get(REPORT_DELIVERY_CHANNEL.email) ?? REPORT_DELIVERY_STATUS.pending,
  };
}
