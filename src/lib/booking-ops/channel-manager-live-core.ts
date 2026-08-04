/**
 * Channel Manager Live Core — provider-independent read-only sync contract
 * and one-shot initial sync engine. Reuses Access Import + Booking Intake.
 * No real provider APIs, polling, webhooks, or outbound OTA writes.
 */
import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { updateBookingOpsRecord } from './repository';
import {
  CHANNEL_PROVIDER_ADAPTERS,
  createBookingFromImportedChannelBooking,
  findSecretPath,
  getChannelImportConflicts,
  getChannelManagerConnectionStatus,
  importChannelBookings,
  importChannelCalendar,
  importChannelObjects,
  listChannelImportRuns,
  reconcileImportedBookings,
  reconcileImportedObjects,
  type ChannelImportConflict,
  type ChannelImportRun,
  type ChannelManagerConnection,
  type ChannelManagerProvider,
  type ManualChannelSnapshot,
  validateManualChannelSnapshot,
} from './channel-manager-access-import';
import { auditChannelImportAvailability } from './availability-overbooking-protection';

// ---------------------------------------------------------------------------
// 1. Provider-independent adapter contract (no credentials / raw secrets)
// ---------------------------------------------------------------------------

export const CHANNEL_LIVE_SYNC_STAGES = [
  'queued',
  'acquire_guard',
  'load_provider_data',
  'import_objects',
  'import_bookings',
  'import_calendar',
  'reconcile_properties',
  'reconcile_bookings',
  'process_bookings',
  'persist_counters',
  'completed',
  'failed',
] as const;
export type ChannelLiveSyncStage = (typeof CHANNEL_LIVE_SYNC_STAGES)[number];

export type ChannelLiveCapabilities = {
  listExternalProperties: boolean;
  initialBookingSnapshot: boolean;
  calendarSnapshot: boolean;
  incrementalCursor: boolean;
  webhooks: boolean;
  writePrices: boolean;
  writeAvailability: boolean;
};

export type NormalizedExternalBookingStatus =
  | 'new'
  | 'confirmed'
  | 'cancelled'
  | 'modified'
  | 'restored'
  | 'unknown';

export type ChannelLiveExternalProperty = {
  externalObjectId: string;
  externalListingId?: string | null;
  title?: string | null;
  city?: string | null;
  safeAddressSummary?: string | null;
  capacity?: number | null;
  status?: string;
  propertySetupId?: string | null;
};

export type ChannelLiveBookingChangeKind = 'created' | 'updated' | 'cancelled' | 'restored' | 'unchanged';

export type ChannelLiveExternalBooking = {
  externalBookingId: string;
  externalObjectId?: string | null;
  guestSafeName?: string | null;
  guestContactRef?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  guestCount?: number | null;
  status: NormalizedExternalBookingStatus;
  changeKind: ChannelLiveBookingChangeKind;
};

export type ChannelLiveCalendarDay = {
  externalObjectId: string;
  date: string;
  availabilityStatus?: string;
  minStay?: number | null;
  priceAmount?: number | null;
  currency?: string | null;
};

export type ChannelLiveProviderCursor = {
  stream: 'objects' | 'bookings' | 'calendar' | 'incremental';
  checkpoint: string | null;
  note?: string;
};

export type ChannelLiveSafeError = {
  stage: ChannelLiveSyncStage | string;
  code: string;
  message: string;
  retryable: boolean;
};

export type ChannelLiveAdapterIdentity = {
  provider: ChannelManagerProvider;
  label: string;
  supportsRealApi: boolean;
};

export type ChannelLiveInitialSnapshot = {
  properties: ChannelLiveExternalProperty[];
  bookings: ChannelLiveExternalBooking[];
  calendar: ChannelLiveCalendarDay[];
  pricing: ChannelLiveCalendarDay[];
  cursors: ChannelLiveProviderCursor[];
};

/** Provider-independent Live Core adapter. Must never carry credentials or secrets. */
export interface ChannelManagerLiveCoreAdapter {
  readonly provider: ChannelManagerProvider;
  readonly capabilities: ChannelLiveCapabilities;
  getIdentity(): ChannelLiveAdapterIdentity;
  listExternalProperties(): Promise<ChannelLiveExternalProperty[]>;
  fetchInitialBookingSnapshot(): Promise<ChannelLiveExternalBooking[]>;
  fetchCalendarSnapshot(): Promise<ChannelLiveCalendarDay[]>;
  fetchPricingSnapshot?(): Promise<ChannelLiveCalendarDay[]>;
  normalizeBookingStatus(raw: unknown): NormalizedExternalBookingStatus;
  classifyBookingChange(previousStatus: string | null | undefined, next: NormalizedExternalBookingStatus): ChannelLiveBookingChangeKind;
  getProviderCursorPlaceholder(): ChannelLiveProviderCursor[];
  loadInitialSnapshot(): Promise<ChannelLiveInitialSnapshot>;
}

export const MANUAL_LIVE_CAPABILITIES: ChannelLiveCapabilities = {
  listExternalProperties: true,
  initialBookingSnapshot: true,
  calendarSnapshot: true,
  incrementalCursor: false,
  webhooks: false,
  writePrices: false,
  writeAvailability: false,
};

const SECRET_VALUE_RE = /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:password|пароль|token|api[_-]?key|secret)\s*[:=]\s*\S+)/iu;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

export function redactLiveCoreErrorMessage(message: unknown): string {
  let safe = text(message).slice(0, 500) || 'Неизвестная ошибка синхронизации.';
  safe = safe.replace(SECRET_VALUE_RE, '[redacted]');
  if (findSecretPath({ message: safe })) {
    return 'Ошибка синхронизации (детали скрыты: возможны секреты).';
  }
  return safe;
}

export function toChannelLiveSafeError(stage: ChannelLiveSyncStage | string, error: unknown, code = 'sync_failed'): ChannelLiveSafeError {
  return {
    stage,
    code,
    message: redactLiveCoreErrorMessage(error instanceof Error ? error.message : error),
    retryable: true,
  };
}

export function normalizeExternalBookingStatus(raw: unknown): NormalizedExternalBookingStatus {
  const value = text(raw).toLowerCase();
  if (['new', 'created', 'pending'].includes(value)) return 'new';
  if (['confirmed', 'active', 'booked', 'ok'].includes(value)) return 'confirmed';
  if (['cancelled', 'canceled', 'void'].includes(value)) return 'cancelled';
  if (['modified', 'updated', 'changed'].includes(value)) return 'modified';
  if (['restored', 'reactivated', 'reopened'].includes(value)) return 'restored';
  return 'unknown';
}

export function classifyBookingChange(
  previousStatus: string | null | undefined,
  next: NormalizedExternalBookingStatus,
): ChannelLiveBookingChangeKind {
  const prev = normalizeExternalBookingStatus(previousStatus ?? 'unknown');
  if (next === 'cancelled' && prev !== 'cancelled') return 'cancelled';
  if (next === 'restored' || (prev === 'cancelled' && next !== 'cancelled')) return 'restored';
  if (prev === 'unknown' && next !== 'cancelled') return 'created';
  if (next === 'modified' || next === 'confirmed' || next === 'new') return 'updated';
  if (next === prev) return 'unchanged';
  return 'updated';
}

function propertyToRow(property: ChannelLiveExternalProperty): Record<string, unknown> {
  return {
    external_object_id: property.externalObjectId,
    external_listing_id: property.externalListingId ?? null,
    title: property.title ?? null,
    city: property.city ?? null,
    safe_address_summary: property.safeAddressSummary ?? null,
    capacity: property.capacity ?? null,
    status: property.status ?? 'unknown',
    property_setup_id: property.propertySetupId ?? null,
  };
}

function bookingToRow(booking: ChannelLiveExternalBooking): Record<string, unknown> {
  return {
    external_booking_id: booking.externalBookingId,
    external_object_id: booking.externalObjectId ?? null,
    guest_safe_name: booking.guestSafeName ?? null,
    guest_contact_ref: booking.guestContactRef ?? null,
    checkin_date: booking.checkInDate ?? null,
    checkout_date: booking.checkOutDate ?? null,
    guest_count: booking.guestCount ?? null,
    status: booking.status === 'restored' ? 'confirmed' : booking.status,
  };
}

function calendarToRow(day: ChannelLiveCalendarDay): Record<string, unknown> {
  return {
    external_object_id: day.externalObjectId,
    date: day.date,
    availability_status: day.availabilityStatus ?? 'unknown',
    min_stay: day.minStay ?? null,
    price_amount: day.priceAmount ?? null,
    currency: day.currency ?? null,
  };
}

// ---------------------------------------------------------------------------
// 2. Manual JSON reference adapter (wraps existing snapshot validation)
// ---------------------------------------------------------------------------

export class ManualChannelLiveCoreAdapter implements ChannelManagerLiveCoreAdapter {
  readonly provider: ChannelManagerProvider = 'manual';
  readonly capabilities = MANUAL_LIVE_CAPABILITIES;
  private readonly snapshot: Required<ManualChannelSnapshot>;

  constructor(snapshot: ManualChannelSnapshot) {
    this.snapshot = validateManualChannelSnapshot(snapshot);
  }

  getIdentity(): ChannelLiveAdapterIdentity {
    return {
      provider: 'manual',
      label: 'Ручной снимок JSON',
      supportsRealApi: false,
    };
  }

  normalizeBookingStatus(raw: unknown): NormalizedExternalBookingStatus {
    return normalizeExternalBookingStatus(raw);
  }

  classifyBookingChange(previousStatus: string | null | undefined, next: NormalizedExternalBookingStatus): ChannelLiveBookingChangeKind {
    return classifyBookingChange(previousStatus, next);
  }

  getProviderCursorPlaceholder(): ChannelLiveProviderCursor[] {
    return [
      { stream: 'objects', checkpoint: null, note: 'Initial sync only; incremental cursor reserved for v2.' },
      { stream: 'bookings', checkpoint: null, note: 'Initial sync only; incremental cursor reserved for v2.' },
      { stream: 'calendar', checkpoint: null, note: 'Initial sync only; incremental cursor reserved for v2.' },
      { stream: 'incremental', checkpoint: null, note: 'Polling/webhooks not implemented.' },
    ];
  }

  async listExternalProperties(): Promise<ChannelLiveExternalProperty[]> {
    return this.snapshot.objects.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.id),
      externalListingId: nullableText(item.external_listing_id ?? item.externalListingId),
      title: nullableText(item.title ?? item.name),
      city: nullableText(item.city),
      safeAddressSummary: nullableText(item.safe_address_summary ?? item.safeAddressSummary ?? item.address),
      capacity: numberOrNull(item.capacity ?? item.guest_capacity),
      status: text(item.status) || 'unknown',
      propertySetupId: nullableText(item.property_setup_id ?? item.propertySetupId),
    })).filter((item) => item.externalObjectId);
  }

  async fetchInitialBookingSnapshot(): Promise<ChannelLiveExternalBooking[]> {
    return this.snapshot.bookings.map((item) => {
      const status = this.normalizeBookingStatus(item.status);
      return {
        externalBookingId: text(item.external_booking_id ?? item.externalBookingId ?? item.id),
        externalObjectId: nullableText(item.external_object_id ?? item.externalObjectId),
        guestSafeName: nullableText(item.guest_safe_name ?? item.guestName),
        guestContactRef: nullableText(item.guest_contact_ref ?? item.guestContactRef),
        checkInDate: normalizeDate(item.checkin_date ?? item.checkIn),
        checkOutDate: normalizeDate(item.checkout_date ?? item.checkOut),
        guestCount: numberOrNull(item.guest_count ?? item.guestCount),
        status,
        changeKind: this.classifyBookingChange(null, status),
      };
    }).filter((item) => item.externalBookingId);
  }

  async fetchCalendarSnapshot(): Promise<ChannelLiveCalendarDay[]> {
    return this.snapshot.calendar.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status ?? item.availability) || 'unknown',
      minStay: numberOrNull(item.min_stay ?? item.minStay),
      priceAmount: numberOrNull(item.price_amount ?? item.price),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date);
  }

  async fetchPricingSnapshot(): Promise<ChannelLiveCalendarDay[]> {
    return this.snapshot.pricing.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status ?? item.availability) || 'unknown',
      minStay: numberOrNull(item.min_stay ?? item.minStay),
      priceAmount: numberOrNull(item.price_amount ?? item.price),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date);
  }

  async loadInitialSnapshot(): Promise<ChannelLiveInitialSnapshot> {
    const [properties, bookings, calendar, pricing] = await Promise.all([
      this.listExternalProperties(),
      this.fetchInitialBookingSnapshot(),
      this.fetchCalendarSnapshot(),
      this.fetchPricingSnapshot(),
    ]);
    return { properties, bookings, calendar, pricing, cursors: this.getProviderCursorPlaceholder() };
  }
}

export function createChannelLiveCoreAdapter(
  provider: ChannelManagerProvider,
  options?: { snapshot?: ManualChannelSnapshot },
): ChannelManagerLiveCoreAdapter {
  if (provider === 'manual' || options?.snapshot) {
    if (!options?.snapshot) throw new Error('Для ручного Live Core нужен JSON-снимок.');
    return new ManualChannelLiveCoreAdapter(options.snapshot);
  }
  const adapter = CHANNEL_PROVIDER_ADAPTERS[provider];
  if (!adapter.supports_real_api) {
    throw toChannelLiveProviderUnavailableError(provider);
  }
  throw toChannelLiveProviderUnavailableError(provider);
}

function toChannelLiveProviderUnavailableError(provider: ChannelManagerProvider): Error {
  return new Error(`Реальный API ${provider} в этой версии не подключён. Используйте ручной снимок JSON как reference adapter.`);
}

// ---------------------------------------------------------------------------
// Sync counters / status / execution guard
// ---------------------------------------------------------------------------

export type ChannelLiveSyncCounters = {
  imported: number;
  updated: number;
  cancelled: number;
  skipped: number;
  failed: number;
  objects: number;
  calendarDays: number;
  prices: number;
};

export type ChannelLiveSyncResult = {
  run: ChannelImportRun;
  connection: ChannelManagerConnection;
  stage: ChannelLiveSyncStage;
  status: 'completed' | 'completed_with_warnings' | 'failed';
  counters: ChannelLiveSyncCounters;
  warnings: ChannelImportConflict[];
  safeError: ChannelLiveSafeError | null;
  cursors: ChannelLiveProviderCursor[];
  retryable: boolean;
};

export type ChannelLiveCoreStatus = {
  provider: ChannelManagerProvider;
  connectionId: string;
  connectionState: string;
  lastSuccessfulSyncAt: string | null;
  latestRun: {
    id: string;
    status: string;
    importType: string;
    startedAt: string | null;
    finishedAt: string | null;
    stage: string | null;
    counters: ChannelLiveSyncCounters | null;
    safeError: ChannelLiveSafeError | null;
  } | null;
  counters: ChannelLiveSyncCounters | null;
  warning: string | null;
  blocker: string | null;
  liveCoreEnabled: boolean;
  incrementalSyncEnabled: boolean;
  realProviderApiEnabled: boolean;
  cursorPlaceholder: ChannelLiveProviderCursor[];
};

function emptyCounters(): ChannelLiveSyncCounters {
  return { imported: 0, updated: 0, cancelled: 0, skipped: 0, failed: 0, objects: 0, calendarDays: 0, prices: 0 };
}

function readCounters(metadata: Record<string, unknown> | undefined): ChannelLiveSyncCounters | null {
  const raw = metadata?.liveCoreCounters;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    imported: Number(row.imported ?? 0),
    updated: Number(row.updated ?? 0),
    cancelled: Number(row.cancelled ?? 0),
    skipped: Number(row.skipped ?? 0),
    failed: Number(row.failed ?? 0),
    objects: Number(row.objects ?? 0),
    calendarDays: Number(row.calendarDays ?? 0),
    prices: Number(row.prices ?? 0),
  };
}

function assertUuid(value: unknown, label = 'ID'): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error(`${label} указан неверно.`);
  }
  return id;
}

async function getConnection(connectionId: string): Promise<ChannelManagerConnection> {
  const connection = await getChannelManagerConnectionStatus({ connectionId: assertUuid(connectionId, 'ID подключения') });
  if (!connection) throw new Error('Подключение не найдено.');
  return connection;
}

function mapRun(row: Record<string, unknown>): ChannelImportRun {
  return {
    id: text(row.id),
    connectionId: text(row.connection_id),
    provider: text(row.provider) as ChannelManagerProvider,
    status: text(row.status),
    importType: text(row.import_type) as ChannelImportRun['importType'],
    startedAt: nullableText(row.started_at),
    finishedAt: nullableText(row.finished_at),
    importedObjectsCount: Number(row.imported_objects_count ?? 0),
    importedBookingsCount: Number(row.imported_bookings_count ?? 0),
    importedCalendarDaysCount: Number(row.imported_calendar_days_count ?? 0),
    importedPricesCount: Number(row.imported_prices_count ?? 0),
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    errors: Array.isArray(row.errors) ? row.errors : [],
    safeSummary: nullableText(row.safe_summary),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

/**
 * Per-connection execution guard: refuses a second concurrent initial_sync run.
 * Uses an existing running run row when present; otherwise stamps connection metadata.
 */
export async function acquireChannelLiveSyncGuard(connectionId: string): Promise<{ ok: true; lockId: string } | { ok: false; reason: string }> {
  const connection = await getConnection(connectionId);
  const { data: running } = await supabase
    .from('booking_channel_import_runs')
    .select('id,status,import_type,metadata')
    .eq('connection_id', connection.id)
    .eq('status', 'running')
    .eq('import_type', 'initial_sync')
    .limit(1)
    .maybeSingle();
  if (running?.id) {
    return { ok: false, reason: 'Синхронизация уже выполняется для этого подключения.' };
  }
  const existingLock = connection.metadata?.liveSyncLock;
  if (existingLock && typeof existingLock === 'object') {
    const lock = existingLock as Record<string, unknown>;
    if (text(lock.status) === 'held') {
      return { ok: false, reason: 'Синхронизация уже выполняется для этого подключения.' };
    }
  }
  const lockId = randomUUID();
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_channel_manager_connections').update({
    metadata: {
      ...connection.metadata,
      liveSyncLock: { id: lockId, status: 'held', acquiredAt: now },
    },
    updated_at: now,
  }).eq('id', connection.id);
  if (error) throw new Error(error.message);
  return { ok: true, lockId };
}

export async function releaseChannelLiveSyncGuard(connectionId: string, lockId: string): Promise<void> {
  const connection = await getConnection(connectionId);
  const existing = connection.metadata?.liveSyncLock as Record<string, unknown> | undefined;
  if (existing && text(existing.id) !== lockId) return;
  const now = new Date().toISOString();
  await supabase.from('booking_channel_manager_connections').update({
    metadata: {
      ...connection.metadata,
      liveSyncLock: { id: lockId, status: 'released', releasedAt: now },
    },
    updated_at: now,
  }).eq('id', connection.id);
}

async function updateRunProgress(
  runId: string,
  patch: {
    stage: ChannelLiveSyncStage;
    counters?: ChannelLiveSyncCounters;
    warnings?: unknown[];
    errors?: unknown[];
    status?: string;
    finishedAt?: string | null;
    safeSummary?: string | null;
    metadata?: Record<string, unknown>;
    objects?: number;
    bookings?: number;
    calendarDays?: number;
    prices?: number;
  },
): Promise<ChannelImportRun> {
  const { data: current, error: loadError } = await supabase.from('booking_channel_import_runs').select('*').eq('id', runId).maybeSingle();
  if (loadError || !current) throw new Error(loadError?.message ?? 'Запуск синхронизации не найден.');
  const metadata = {
    ...((current.metadata as Record<string, unknown>) ?? {}),
    ...(patch.metadata ?? {}),
    liveCore: true,
    liveCoreStage: patch.stage,
    liveCoreCounters: patch.counters ?? readCounters(current.metadata as Record<string, unknown>) ?? emptyCounters(),
  };
  if (findSecretPath(metadata)) throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_import_runs').update({
    status: patch.status ?? current.status,
    finished_at: patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
    imported_objects_count: patch.objects ?? current.imported_objects_count,
    imported_bookings_count: patch.bookings ?? current.imported_bookings_count,
    imported_calendar_days_count: patch.calendarDays ?? current.imported_calendar_days_count,
    imported_prices_count: patch.prices ?? current.imported_prices_count,
    warnings: patch.warnings ?? current.warnings,
    errors: patch.errors ?? current.errors,
    safe_summary: patch.safeSummary === undefined ? current.safe_summary : patch.safeSummary,
    metadata,
    updated_at: now,
  }).eq('id', runId).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить запуск синхронизации.');
  return mapRun(data as Record<string, unknown>);
}

async function applyExternalCancellation(matchedBookingId: string): Promise<'cancelled' | 'skipped'> {
  const { data: booking, error } = await supabase
    .from('booking_ops_records')
    .select('id,normalized_status,ops_status')
    .eq('id', matchedBookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) return 'skipped';
  const status = text(booking.normalized_status || booking.ops_status).toLowerCase();
  if (status === 'cancelled' || status === 'canceled') return 'skipped';
  const result = await updateBookingOpsRecord(matchedBookingId, {
    isBlocked: true,
    blockerReason: 'Отменено внешним менеджером каналов (Live Core initial sync).',
  }, { actorType: 'admin' });
  if (!result.ok) throw new Error(result.error ?? 'Не удалось отметить отмену брони.');
  const now = new Date().toISOString();
  const { error: statusError } = await supabase.from('booking_ops_records').update({
    normalized_status: 'cancelled',
    cancelled_at: now,
    cancellation_reason: 'channel_manager_live_core_external_cancel',
    updated_at: now,
  }).eq('id', matchedBookingId);
  if (statusError) throw new Error(statusError.message);
  return 'cancelled';
}

async function applyExternalBookingUpdate(imported: Record<string, unknown>): Promise<'updated' | 'skipped'> {
  const matchedBookingId = text(imported.matched_booking_id);
  if (!matchedBookingId) return 'skipped';
  const checkIn = nullableText(imported.checkin_date);
  const checkOut = nullableText(imported.checkout_date);
  const guestName = nullableText(imported.guest_safe_name);
  const { data: current } = await supabase
    .from('booking_ops_records')
    .select('id,guest_name,check_in_at,check_out_at,normalized_status')
    .eq('id', matchedBookingId)
    .maybeSingle();
  if (!current) return 'skipped';
  if (text(current.normalized_status).toLowerCase() === 'cancelled') return 'skipped';
  const currentCheckIn = current.check_in_at ? String(current.check_in_at).slice(0, 10) : null;
  const currentCheckOut = current.check_out_at ? String(current.check_out_at).slice(0, 10) : null;
  const changed =
    (checkIn && checkIn !== currentCheckIn)
    || (checkOut && checkOut !== currentCheckOut)
    || (guestName && guestName !== text(current.guest_name));
  if (!changed) return 'skipped';
  const result = await updateBookingOpsRecord(matchedBookingId, {
    guestName: guestName ?? undefined,
    checkInAt: checkIn ?? undefined,
    checkOutAt: checkOut ?? undefined,
  }, { actorType: 'admin' });
  if (!result.ok) throw new Error(result.error ?? 'Не удалось обновить бронь.');
  return 'updated';
}

async function processImportedBookingsForLiveSync(
  connectionId: string,
  counters: ChannelLiveSyncCounters,
  warnings: ChannelImportConflict[],
): Promise<void> {
  const { data: bookings, error } = await supabase
    .from('booking_channel_imported_bookings')
    .select('*')
    .eq('connection_id', connectionId);
  if (error) throw new Error(error.message);

  for (const imported of (bookings ?? []) as Record<string, unknown>[]) {
    const matchStatus = text(imported.match_status);
    const externalStatus = normalizeExternalBookingStatus(imported.status);

    if (matchStatus === 'possible_duplicate') {
      counters.skipped += 1;
      warnings.push({
        type: 'possible_duplicate_booking',
        severity: 'warning',
        entityId: text(imported.id),
        message: 'Возможен дубликат брони — создание пропущено.',
      });
      continue;
    }

    if (matchStatus === 'ignored') {
      counters.skipped += 1;
      continue;
    }

    const { data: object } = imported.external_object_id
      ? await supabase
        .from('booking_channel_imported_objects')
        .select('match_status,matched_property_id')
        .eq('connection_id', connectionId)
        .eq('external_object_id', imported.external_object_id)
        .maybeSingle()
      : { data: null };

    if (object && ['unmatched', 'possible_match'].includes(text(object.match_status)) && externalStatus !== 'cancelled') {
      counters.skipped += 1;
      warnings.push({
        type: 'object_not_confirmed',
        severity: 'warning',
        entityId: text(imported.id),
        message: 'Объект не сопоставлен — бронь не создана автоматически.',
      });
      continue;
    }

    try {
      if (externalStatus === 'cancelled') {
        if (imported.matched_booking_id) {
          const outcome = await applyExternalCancellation(text(imported.matched_booking_id));
          if (outcome === 'cancelled') counters.cancelled += 1;
          else counters.skipped += 1;
        } else {
          counters.skipped += 1;
        }
        continue;
      }

      if (imported.matched_booking_id && ['matched', 'imported_to_booking_ops'].includes(matchStatus)) {
        const outcome = await applyExternalBookingUpdate(imported);
        if (outcome === 'updated') counters.updated += 1;
        else counters.skipped += 1;
        continue;
      }

      if (matchStatus === 'unmatched' || !imported.matched_booking_id) {
        const created = await createBookingFromImportedChannelBooking(text(imported.id));
        if (created.duplicate) {
          counters.skipped += 1;
        } else if (created.created) {
          counters.imported += 1;
        } else {
          counters.skipped += 1;
        }
        continue;
      }

      counters.skipped += 1;
    } catch (error) {
      counters.failed += 1;
      warnings.push({
        type: 'booking_sync_failed',
        severity: 'blocker',
        entityId: text(imported.id),
        message: redactLiveCoreErrorMessage(error instanceof Error ? error.message : error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. One-shot initial sync engine
// ---------------------------------------------------------------------------

export async function runChannelManagerInitialSync(input: {
  connectionId: string;
  snapshot?: ManualChannelSnapshot;
  metadata?: Record<string, unknown>;
}): Promise<ChannelLiveSyncResult> {
  if (input.metadata && findSecretPath(input.metadata)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
  }

  let stage: ChannelLiveSyncStage = 'acquire_guard';
  let runId: string | null = null;
  let lockId: string | null = null;
  const counters = emptyCounters();
  let warnings: ChannelImportConflict[] = [];
  let cursors: ChannelLiveProviderCursor[] = [];
  let connection = await getConnection(input.connectionId);

  try {
    const guard = await acquireChannelLiveSyncGuard(connection.id);
    if (!guard.ok) {
      throw Object.assign(new Error(guard.reason), { code: 'execution_guard' });
    }
    lockId = guard.lockId;

    stage = 'queued';
    const now = new Date().toISOString();
    const { data: runRow, error: runError } = await supabase.from('booking_channel_import_runs').insert({
      id: randomUUID(),
      connection_id: connection.id,
      provider: connection.provider,
      status: 'running',
      import_type: 'initial_sync',
      started_at: now,
      warnings: [],
      errors: [],
      metadata: {
        ...(input.metadata ?? {}),
        liveCore: true,
        liveCoreStage: stage,
        liveCoreCounters: counters,
        liveSyncLockId: lockId,
        cursorPlaceholder: [],
      },
      created_at: now,
      updated_at: now,
    }).select('*').single();
    if (runError || !runRow) throw new Error(runError?.message ?? 'Не удалось создать запуск синхронизации.');
    runId = text(runRow.id);
    await supabase.from('booking_channel_manager_connections').update({ last_import_at: now, updated_at: now }).eq('id', connection.id);

    stage = 'load_provider_data';
    await updateRunProgress(runId, { stage, counters });
    const adapter = createChannelLiveCoreAdapter(
      connection.provider === 'manual' ? 'manual' : connection.provider,
      { snapshot: input.snapshot ?? (connection.metadata?.lastManualSnapshot as ManualChannelSnapshot | undefined) },
    );
    const snapshot = await adapter.loadInitialSnapshot();
    cursors = snapshot.cursors;

    stage = 'import_objects';
    await updateRunProgress(runId, { stage, counters, metadata: { cursorPlaceholder: cursors } });
    counters.objects = await importChannelObjects(connection.id, snapshot.properties.map(propertyToRow), { importRunId: runId });

    stage = 'import_bookings';
    await updateRunProgress(runId, { stage, counters, objects: counters.objects });
    const bookingRows = snapshot.bookings.map(bookingToRow);
    const bookingsImported = await importChannelBookings(connection.id, bookingRows, { importRunId: runId });

    stage = 'import_calendar';
    await updateRunProgress(runId, { stage, counters, bookings: bookingsImported });
    counters.calendarDays = await importChannelCalendar(connection.id, snapshot.calendar.map(calendarToRow), { importRunId: runId });
    counters.prices = await importChannelCalendar(connection.id, snapshot.pricing.map(calendarToRow), { importRunId: runId, pricing: true });

    stage = 'reconcile_properties';
    await updateRunProgress(runId, {
      stage, counters, bookings: bookingsImported, calendarDays: counters.calendarDays, prices: counters.prices,
    });
    await reconcileImportedObjects(connection.id);

    stage = 'reconcile_bookings';
    await updateRunProgress(runId, { stage, counters });
    await reconcileImportedBookings(connection.id);
    const availabilityChecks = await auditChannelImportAvailability(connection.id);
    warnings = await getChannelImportConflicts(connection.id);
    for (const check of availabilityChecks) {
      if (check.status === 'no_conflict') continue;
      warnings.push({
        type: 'availability_conflict',
        severity: check.status === 'confirmed_conflict' ? 'blocker' : 'warning',
        message: check.safeSummary,
      });
    }

    stage = 'process_bookings';
    await updateRunProgress(runId, { stage, counters, warnings });
    await processImportedBookingsForLiveSync(connection.id, counters, warnings);

    stage = 'persist_counters';
    const finishedAt = new Date().toISOString();
    const status = warnings.some((item) => item.severity === 'blocker') || counters.failed > 0
      ? 'completed_with_warnings'
      : warnings.length
        ? 'completed_with_warnings'
        : 'completed';
    const run = await updateRunProgress(runId, {
      stage: 'completed',
      status,
      finishedAt,
      counters,
      warnings,
      objects: counters.objects,
      bookings: bookingsImported,
      calendarDays: counters.calendarDays,
      prices: counters.prices,
      safeSummary: `Live Core initial sync: импортировано ${counters.imported}, обновлено ${counters.updated}, отменено ${counters.cancelled}, пропущено ${counters.skipped}, ошибок ${counters.failed}.`,
      metadata: {
        cursorPlaceholder: cursors,
        liveCoreCounters: counters,
        lastSuccessfulInitialSyncAt: finishedAt,
      },
    });

    const { data: connectionRow } = await supabase.from('booking_channel_manager_connections').update({
      status: connection.status === 'blocked' ? connection.status : 'import_ready',
      last_success_at: finishedAt,
      failure_reason: null,
      metadata: {
        ...connection.metadata,
        liveCore: true,
        lastSuccessfulInitialSyncAt: finishedAt,
        cursorPlaceholder: cursors,
        lastLiveCoreCounters: counters,
        lastManualSnapshot: input.snapshot ?? connection.metadata?.lastManualSnapshot ?? null,
        liveSyncLock: { id: lockId, status: 'released', releasedAt: finishedAt },
      },
      updated_at: finishedAt,
    }).eq('id', connection.id).select('*').single();
    if (connectionRow) {
      connection = {
        ...connection,
        status: text(connectionRow.status),
        lastSuccessAt: nullableText(connectionRow.last_success_at),
        failureReason: null,
        metadata: (connectionRow.metadata as Record<string, unknown>) ?? connection.metadata,
        updatedAt: text(connectionRow.updated_at),
      };
    }

    return {
      run,
      connection,
      stage: 'completed',
      status,
      counters,
      warnings,
      safeError: null,
      cursors,
      retryable: true,
    };
  } catch (error) {
    const safeError = toChannelLiveSafeError(stage, error, (error as { code?: string })?.code === 'execution_guard' ? 'execution_guard' : 'sync_failed');
    if (runId) {
      const finishedAt = new Date().toISOString();
      await updateRunProgress(runId, {
        stage: 'failed',
        status: 'failed',
        finishedAt,
        counters,
        warnings,
        errors: [safeError],
        safeSummary: `Live Core initial sync остановлен на этапе ${stage}.`,
        metadata: {
          cursorPlaceholder: cursors,
          liveCoreCounters: counters,
          failedStage: stage,
          safeError,
        },
      }).catch(() => undefined);
      await supabase.from('booking_channel_manager_connections').update({
        status: 'import_failed',
        last_failure_at: finishedAt,
        failure_reason: safeError.message.slice(0, 500),
        metadata: {
          ...connection.metadata,
          liveCore: true,
          lastFailedStage: stage,
          lastSafeError: safeError,
          cursorPlaceholder: cursors,
          lastManualSnapshot: input.snapshot ?? connection.metadata?.lastManualSnapshot ?? null,
          liveSyncLock: lockId ? { id: lockId, status: 'released', releasedAt: finishedAt } : connection.metadata?.liveSyncLock,
        },
        updated_at: finishedAt,
      }).eq('id', connection.id);
    } else if (lockId) {
      await releaseChannelLiveSyncGuard(connection.id, lockId).catch(() => undefined);
    }

    const runs = runId ? await listChannelImportRuns(connection.id) : [];
    const run = runs.find((item) => item.id === runId) ?? {
      id: runId ?? '00000000-0000-4000-8000-000000000000',
      connectionId: connection.id,
      provider: connection.provider,
      status: 'failed',
      importType: 'initial_sync' as const,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      importedObjectsCount: counters.objects,
      importedBookingsCount: counters.imported,
      importedCalendarDaysCount: counters.calendarDays,
      importedPricesCount: counters.prices,
      warnings,
      errors: [safeError],
      safeSummary: safeError.message,
      metadata: { liveCoreStage: stage, liveCoreCounters: counters, safeError },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      run,
      connection: await getConnection(connection.id).catch(() => connection),
      stage: 'failed',
      status: 'failed',
      counters,
      warnings,
      safeError,
      cursors,
      retryable: true,
    };
  }
}

export async function getChannelLiveCoreStatus(connectionId: string): Promise<ChannelLiveCoreStatus> {
  const connection = await getConnection(connectionId);
  const runs = [...await listChannelImportRuns(connection.id)].sort((left, right) => {
    const leftTs = Date.parse(left.updatedAt || left.finishedAt || left.createdAt || left.startedAt || '') || 0;
    const rightTs = Date.parse(right.updatedAt || right.finishedAt || right.createdAt || right.startedAt || '') || 0;
    return rightTs - leftTs;
  });
  const latest = runs.find((run) => run.importType === 'initial_sync') ?? runs[0] ?? null;
  const counters = readCounters(latest?.metadata) ?? readCounters(connection.metadata) ?? null;
  const safeError = (latest?.metadata?.safeError as ChannelLiveSafeError | undefined)
    ?? (connection.metadata?.lastSafeError as ChannelLiveSafeError | undefined)
    ?? null;
  const stage = text(latest?.metadata?.liveCoreStage) || null;
  const cursors = (Array.isArray(latest?.metadata?.cursorPlaceholder)
    ? latest?.metadata?.cursorPlaceholder
    : connection.metadata?.cursorPlaceholder) as ChannelLiveProviderCursor[] | undefined;

  let warning: string | null = null;
  let blocker: string | null = null;
  if (connection.status === 'blocked') blocker = connection.failureReason ?? 'Подключение заблокировано.';
  else if (latest?.status === 'failed') blocker = safeError?.message ?? connection.failureReason ?? 'Последняя синхронизация завершилась ошибкой.';
  else if (counters?.failed) warning = `Есть ошибки обработки броней: ${counters.failed}.`;
  else if ((latest?.warnings?.length ?? 0) > 0) warning = 'Есть предупреждения сверки после initial sync.';

  return {
    provider: connection.provider,
    connectionId: connection.id,
    connectionState: connection.status,
    lastSuccessfulSyncAt: connection.lastSuccessAt,
    latestRun: latest ? {
      id: latest.id,
      status: latest.status,
      importType: latest.importType,
      startedAt: latest.startedAt,
      finishedAt: latest.finishedAt,
      stage,
      counters,
      safeError,
    } : null,
    counters,
    warning,
    blocker,
    liveCoreEnabled: true,
    incrementalSyncEnabled: false,
    realProviderApiEnabled: CHANNEL_PROVIDER_ADAPTERS[connection.provider]?.supports_real_api === true,
    cursorPlaceholder: cursors ?? [
      { stream: 'objects', checkpoint: null },
      { stream: 'bookings', checkpoint: null },
      { stream: 'calendar', checkpoint: null },
      { stream: 'incremental', checkpoint: null },
    ],
  };
}
