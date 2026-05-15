export type PendingLocationReportStatus =
  | 'payment_pending'
  | 'processing'
  | 'ready'
  | 'failed';

export type PendingLocationReportContext = {
  address: string;
  lat?: number;
  lon?: number;
  freeReportId?: string;
  freeReportPermalink?: string;
  mode: 'residential';
  createdAt: string;
  requestId?: string;
  paidReportId?: string;
  status?: PendingLocationReportStatus;
  updatedAt?: string;
};

export const PENDING_LOCATION_REPORT_STORAGE_KEY = 'asi.pendingLocationReport';

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function cleanCreatedAt(value: unknown): string {
  const raw = cleanString(value);
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function cleanStatus(value: unknown): PendingLocationReportStatus | undefined {
  if (
    value === 'payment_pending' ||
    value === 'processing' ||
    value === 'ready' ||
    value === 'failed'
  ) {
    return value;
  }
  return undefined;
}

export function sanitizePendingLocationReportContext(
  input: Partial<PendingLocationReportContext> | null | undefined,
): PendingLocationReportContext | null {
  const address = cleanString(input?.address);
  if (!address) return null;

  const lat = finiteNumber(input?.lat);
  const lon = finiteNumber(input?.lon);
  return {
    address,
    ...(lat !== undefined ? { lat } : {}),
    ...(lon !== undefined ? { lon } : {}),
    ...(cleanString(input?.freeReportId) ? { freeReportId: cleanString(input?.freeReportId) } : {}),
    ...(cleanString(input?.freeReportPermalink) ? { freeReportPermalink: cleanString(input?.freeReportPermalink) } : {}),
    mode: 'residential',
    createdAt: cleanCreatedAt(input?.createdAt),
    ...(cleanString(input?.requestId) ? { requestId: cleanString(input?.requestId) } : {}),
    ...(cleanString(input?.paidReportId) ? { paidReportId: cleanString(input?.paidReportId) } : {}),
    ...(cleanStatus(input?.status) ? { status: cleanStatus(input?.status) } : {}),
    ...(cleanString(input?.updatedAt) ? { updatedAt: cleanString(input?.updatedAt) } : {}),
  };
}

export function pendingLocationReportFromSearchParams(
  params: Pick<URLSearchParams, 'get'>,
): PendingLocationReportContext | null {
  const status = params.get('status');
  return sanitizePendingLocationReportContext({
    address: params.get('address') ?? undefined,
    lat: finiteNumber(params.get('lat')),
    lon: finiteNumber(params.get('lon')),
    freeReportId: params.get('freeReportId') ?? undefined,
    freeReportPermalink: params.get('freeReportPermalink') ?? undefined,
    mode: 'residential',
    createdAt: params.get('createdAt') ?? undefined,
    requestId: params.get('requestId') ?? undefined,
    paidReportId: params.get('paidReportId') ?? undefined,
    status: (status ?? undefined) as PendingLocationReportStatus | undefined,
    updatedAt: params.get('updatedAt') ?? undefined,
  });
}

export function buildDashboardReportRequestHref(
  context: PendingLocationReportContext,
): string {
  const safe = sanitizePendingLocationReportContext(context);
  const params = new URLSearchParams();
  if (safe) {
    params.set('address', safe.address);
    if (safe.lat !== undefined) params.set('lat', String(safe.lat));
    if (safe.lon !== undefined) params.set('lon', String(safe.lon));
    if (safe.freeReportId) params.set('freeReportId', safe.freeReportId);
    if (safe.freeReportPermalink) params.set('freeReportPermalink', safe.freeReportPermalink);
    params.set('mode', safe.mode);
    params.set('createdAt', safe.createdAt);
  }
  return `/dashboard/reports${params.toString() ? `?${params.toString()}` : ''}`;
}
