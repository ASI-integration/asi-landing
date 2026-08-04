/**
 * Channel Manager Live Core — provider-independent read-only sync contract
 * and one-shot initial sync engine. Reuses Access Import + Booking Intake.
 * No real provider APIs, polling, webhooks, or outbound OTA writes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { cancelReservation, getUnifiedAvailability } from '@/lib/reservations/ledger';
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
  listChannelCalendarSnapshots,
  listImportedChannelBookings,
  listImportedChannelObjects,
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

/** Bounded timeout after which a stuck running initial_sync is recoverable. */
export const STALE_INITIAL_SYNC_TIMEOUT_MS = 30 * 60 * 1000;

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
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const SCHEMA_STATE_TTL_MS = 30_000;
const SCHEMA_STATE_FAILURE_TTL_MS = 5_000;
const LIVE_CORE_MIGRATION_BLOCKER = 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.';

export type ChannelLiveCoreSchemaState = {
  schemaVersion: number;
  initialSyncTypeReady: boolean;
  atomicRunningGuardReady: boolean;
  ready: boolean;
  blocker: string | null;
};

/** Test override for schema readiness. null = probe live via RPC. */
let schemaStateOverride: ChannelLiveCoreSchemaState | null = null;
let schemaStateCache: { at: number; state: ChannelLiveCoreSchemaState } | null = null;

export function clearChannelLiveCoreSchemaStateCache(): void {
  schemaStateCache = null;
}

export function setChannelLiveCoreSchemaStateOverride(state: ChannelLiveCoreSchemaState | null): void {
  schemaStateOverride = state;
  schemaStateCache = null;
}

/** @deprecated Prefer setChannelLiveCoreSchemaStateOverride for partial readiness cases. */
export function setChannelLiveCoreSchemaReadyOverride(value: boolean | null): void {
  if (value === null) {
    schemaStateOverride = null;
  } else if (value) {
    schemaStateOverride = {
      schemaVersion: 1,
      initialSyncTypeReady: true,
      atomicRunningGuardReady: true,
      ready: true,
      blocker: null,
    };
  } else {
    schemaStateOverride = {
      schemaVersion: 0,
      initialSyncTypeReady: false,
      atomicRunningGuardReady: false,
      ready: false,
      blocker: LIVE_CORE_MIGRATION_BLOCKER,
    };
  }
  schemaStateCache = null;
}

function schemaStateFromRpcPayload(data: unknown): ChannelLiveCoreSchemaState {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const initialSyncTypeReady = row.initialSyncTypeReady === true;
  const atomicRunningGuardReady = row.atomicRunningGuardReady === true;
  const ready = initialSyncTypeReady && atomicRunningGuardReady && row.ready !== false;
  let blocker: string | null = null;
  if (!ready) {
    if (!initialSyncTypeReady && !atomicRunningGuardReady) blocker = LIVE_CORE_MIGRATION_BLOCKER;
    else if (!initialSyncTypeReady) {
      blocker = 'Миграция Live Core неполная: отсутствует разрешение import_type=initial_sync.';
    } else {
      blocker = 'Миграция Live Core неполная: отсутствует atomic running-run guard index.';
    }
  }
  return {
    schemaVersion: Number(row.schemaVersion ?? 1) || 0,
    initialSyncTypeReady,
    atomicRunningGuardReady,
    ready: ready && initialSyncTypeReady && atomicRunningGuardReady,
    blocker,
  };
}

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

export function resolveChannelLiveSyncFinalStatus(
  counters: ChannelLiveSyncCounters,
  warnings: ChannelImportConflict[],
): 'completed' | 'completed_with_warnings' | 'failed' {
  const hasBlocker = warnings.some((item) => item.severity === 'blocker') || counters.failed > 0;
  if (hasBlocker) return 'failed';
  if (warnings.length > 0) return 'completed_with_warnings';
  return 'completed';
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === UNIQUE_VIOLATION || /duplicate key|unique constraint/i.test(text(error.message));
}

function isInitialSyncTypeRejected(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = text(error.message);
  return error.code === CHECK_VIOLATION
    || (/import_type|initial_sync|check constraint/i.test(message) && /violat|fail|reject/i.test(message));
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

function cursorPlaceholder(): ChannelLiveProviderCursor[] {
  return [
    { stream: 'objects', checkpoint: null, note: 'Initial sync only; incremental cursor reserved for v2.' },
    { stream: 'bookings', checkpoint: null, note: 'Initial sync only; incremental cursor reserved for v2.' },
    { stream: 'calendar', checkpoint: null, note: 'Initial sync only; incremental cursor reserved for v2.' },
    { stream: 'incremental', checkpoint: null, note: 'Polling/webhooks not implemented.' },
  ];
}

// ---------------------------------------------------------------------------
// 2. Manual JSON reference adapter + reuse of already-imported rows
// ---------------------------------------------------------------------------

export class ManualChannelLiveCoreAdapter implements ChannelManagerLiveCoreAdapter {
  readonly provider: ChannelManagerProvider = 'manual';
  readonly capabilities = MANUAL_LIVE_CAPABILITIES;
  private readonly snapshot: Required<ManualChannelSnapshot>;

  constructor(snapshot: ManualChannelSnapshot) {
    this.snapshot = validateManualChannelSnapshot(snapshot);
  }

  getIdentity(): ChannelLiveAdapterIdentity {
    return { provider: 'manual', label: 'Ручной снимок JSON', supportsRealApi: false };
  }

  normalizeBookingStatus(raw: unknown): NormalizedExternalBookingStatus {
    return normalizeExternalBookingStatus(raw);
  }

  classifyBookingChange(previousStatus: string | null | undefined, next: NormalizedExternalBookingStatus): ChannelLiveBookingChangeKind {
    return classifyBookingChange(previousStatus, next);
  }

  getProviderCursorPlaceholder(): ChannelLiveProviderCursor[] {
    return cursorPlaceholder();
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

/** Explicit safe path: reuse already-imported normalized rows (no full snapshot in metadata). */
export class ImportedRowsChannelLiveCoreAdapter implements ChannelManagerLiveCoreAdapter {
  readonly provider: ChannelManagerProvider;
  readonly capabilities = MANUAL_LIVE_CAPABILITIES;
  private readonly connectionId: string;

  constructor(connectionId: string, provider: ChannelManagerProvider) {
    this.connectionId = connectionId;
    this.provider = provider;
  }

  getIdentity(): ChannelLiveAdapterIdentity {
    return { provider: this.provider, label: 'Уже импортированные строки', supportsRealApi: false };
  }

  normalizeBookingStatus(raw: unknown): NormalizedExternalBookingStatus {
    return normalizeExternalBookingStatus(raw);
  }

  classifyBookingChange(previousStatus: string | null | undefined, next: NormalizedExternalBookingStatus): ChannelLiveBookingChangeKind {
    return classifyBookingChange(previousStatus, next);
  }

  getProviderCursorPlaceholder(): ChannelLiveProviderCursor[] {
    return cursorPlaceholder();
  }

  async listExternalProperties(): Promise<ChannelLiveExternalProperty[]> {
    const rows = await listImportedChannelObjects(this.connectionId);
    return rows.map((item) => ({
      externalObjectId: text(item.external_object_id),
      externalListingId: nullableText(item.external_listing_id),
      title: nullableText(item.title),
      city: nullableText(item.city),
      safeAddressSummary: nullableText(item.safe_address_summary),
      capacity: numberOrNull(item.capacity),
      status: text(item.status) || 'unknown',
      propertySetupId: nullableText(item.matched_property_setup_id),
    })).filter((item) => item.externalObjectId);
  }

  async fetchInitialBookingSnapshot(): Promise<ChannelLiveExternalBooking[]> {
    const rows = await listImportedChannelBookings(this.connectionId);
    return rows.map((item) => {
      const status = this.normalizeBookingStatus(item.status);
      return {
        externalBookingId: text(item.external_booking_id),
        externalObjectId: nullableText(item.external_object_id),
        guestSafeName: nullableText(item.guest_safe_name),
        guestContactRef: nullableText(item.guest_contact_ref),
        checkInDate: normalizeDate(item.checkin_date),
        checkOutDate: normalizeDate(item.checkout_date),
        guestCount: numberOrNull(item.guest_count),
        status,
        changeKind: this.classifyBookingChange(null, status),
      };
    }).filter((item) => item.externalBookingId);
  }

  async fetchCalendarSnapshot(): Promise<ChannelLiveCalendarDay[]> {
    const rows = await listChannelCalendarSnapshots(this.connectionId);
    return rows.map((item) => ({
      externalObjectId: text(item.external_object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status) || 'unknown',
      minStay: numberOrNull(item.min_stay),
      priceAmount: numberOrNull(item.price_amount),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date);
  }

  async fetchPricingSnapshot(): Promise<ChannelLiveCalendarDay[]> {
    return this.fetchCalendarSnapshot();
  }

  async loadInitialSnapshot(): Promise<ChannelLiveInitialSnapshot> {
    const [properties, bookings, calendar] = await Promise.all([
      this.listExternalProperties(),
      this.fetchInitialBookingSnapshot(),
      this.fetchCalendarSnapshot(),
    ]);
    if (!properties.length && !bookings.length && !calendar.length) {
      throw new Error('Нет ранее импортированных строк. Передайте JSON-снимок или сначала выполните manual snapshot import.');
    }
    return { properties, bookings, calendar, pricing: [], cursors: this.getProviderCursorPlaceholder() };
  }
}

export function createChannelLiveCoreAdapter(
  provider: ChannelManagerProvider,
  options?: { snapshot?: ManualChannelSnapshot; reuseImportedRows?: boolean; connectionId?: string },
): ChannelManagerLiveCoreAdapter {
  if (options?.snapshot) return new ManualChannelLiveCoreAdapter(options.snapshot);
  if (options?.reuseImportedRows) {
    if (!options.connectionId) throw new Error('Для повторного использования импортированных строк нужен ID подключения.');
    return new ImportedRowsChannelLiveCoreAdapter(options.connectionId, provider);
  }
  if (provider === 'manual') throw new Error('Для ручного Live Core нужен JSON-снимок или явное reuseImportedRows.');
  throw new Error(`Реальный API ${provider} в этой версии не подключён. Используйте ручной снимок JSON как reference adapter.`);
}

// ---------------------------------------------------------------------------
// Sync counters / status / atomic execution guard
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
  initialSyncEnabled: boolean;
  incrementalSyncEnabled: boolean;
  realProviderApiEnabled: boolean;
  schemaReady: boolean;
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

function stripFullSnapshot(metadata: Record<string, unknown>): Record<string, unknown> {
  const { lastManualSnapshot: _omit, ...rest } = metadata;
  return rest;
}

function snapshotReceipt(snapshot: ManualChannelSnapshot, runId: string): Record<string, unknown> {
  const normalized = validateManualChannelSnapshot(snapshot);
  return {
    snapshotHash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    sourceImportRunId: runId,
    rowCounts: {
      objects: normalized.objects.length,
      bookings: normalized.bookings.length,
      calendar: normalized.calendar.length,
      pricing: normalized.pricing.length,
    },
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Read-only schema readiness probe via service-role RPC.
 * Must never insert/delete booking_channel_import_runs rows.
 */
export async function probeChannelLiveCoreSchema(_connectionId?: string): Promise<ChannelLiveCoreSchemaState> {
  if (schemaStateOverride) return schemaStateOverride;

  const now = Date.now();
  if (schemaStateCache) {
    const ttl = schemaStateCache.state.ready ? SCHEMA_STATE_TTL_MS : SCHEMA_STATE_FAILURE_TTL_MS;
    if (now - schemaStateCache.at < ttl) return schemaStateCache.state;
  }

  const { data, error } = await supabase.rpc('channel_manager_live_core_schema_state');
  if (error || data == null) {
    const failed: ChannelLiveCoreSchemaState = {
      schemaVersion: 0,
      initialSyncTypeReady: false,
      atomicRunningGuardReady: false,
      ready: false,
      blocker: LIVE_CORE_MIGRATION_BLOCKER,
    };
    schemaStateCache = { at: now, state: failed };
    return failed;
  }

  const state = schemaStateFromRpcPayload(data);
  // ready requires both components even if RPC omits/mis-sets ready.
  if (!state.initialSyncTypeReady || !state.atomicRunningGuardReady) {
    state.ready = false;
    if (!state.blocker) state.blocker = LIVE_CORE_MIGRATION_BLOCKER;
  } else {
    state.ready = true;
    state.blocker = null;
  }
  schemaStateCache = { at: now, state };
  return state;
}

/** Mark stale running initial_sync rows failed, preserving evidence. */
export async function recoverStaleInitialSyncRuns(
  connectionId: string,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const connection = await getConnection(connectionId);
  const { data: running, error } = await supabase
    .from('booking_channel_import_runs')
    .select('*')
    .eq('connection_id', connection.id)
    .eq('import_type', 'initial_sync')
    .eq('status', 'running');
  if (error) throw new Error(error.message);

  const recovered: string[] = [];
  for (const row of (running ?? []) as Record<string, unknown>[]) {
    const startedAt = Date.parse(text(row.started_at || row.created_at));
    if (!Number.isFinite(startedAt) || nowMs - startedAt < STALE_INITIAL_SYNC_TIMEOUT_MS) continue;
    const finishedAt = new Date(nowMs).toISOString();
    const metadata = {
      ...((row.metadata as Record<string, unknown>) ?? {}),
      liveCore: true,
      liveCoreStage: 'failed',
      staleRecovered: true,
      staleRecoveredAt: finishedAt,
      failedStage: text((row.metadata as Record<string, unknown>)?.liveCoreStage) || 'acquire_guard',
      safeError: {
        stage: text((row.metadata as Record<string, unknown>)?.liveCoreStage) || 'acquire_guard',
        code: 'stale_running_run',
        message: 'Зависший initial sync помечен как failed по timeout; evidence сохранены.',
        retryable: true,
      },
    };
    const { error: updateError } = await supabase.from('booking_channel_import_runs').update({
      status: 'failed',
      finished_at: finishedAt,
      errors: [metadata.safeError],
      safe_summary: 'Initial sync прерван по stale timeout. Ранее сохранённые данные не удалены.',
      metadata,
      updated_at: finishedAt,
    }).eq('id', row.id).eq('status', 'running');
    if (updateError) throw new Error(updateError.message);
    recovered.push(text(row.id));
  }
  return recovered;
}

/**
 * Atomic per-connection execution guard: insert running initial_sync row.
 * Unique partial index enforces exclusivity; 23505 => execution_guard.
 */
export async function acquireChannelLiveSyncGuard(connectionId: string): Promise<
  { ok: true; run: ChannelImportRun } | { ok: false; reason: string; code: 'execution_guard' | 'migration_missing' }
> {
  const connection = await getConnection(connectionId);
  const schema = await probeChannelLiveCoreSchema(connection.id);
  if (!schema.ready) {
    return { ok: false, reason: schema.blocker ?? 'Миграция Live Core не применена.', code: 'migration_missing' };
  }

  await recoverStaleInitialSyncRuns(connection.id);

  const runId = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_import_runs').insert({
    id: runId,
    connection_id: connection.id,
    provider: connection.provider,
    status: 'running',
    import_type: 'initial_sync',
    started_at: now,
    warnings: [],
    errors: [],
    metadata: {
      liveCore: true,
      liveCoreStage: 'acquire_guard',
      liveCoreCounters: emptyCounters(),
      cursorPlaceholder: [],
    },
    created_at: now,
    updated_at: now,
  }).select('*').single();

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'Синхронизация уже выполняется для этого подключения.', code: 'execution_guard' };
    }
    if (isInitialSyncTypeRejected(error)) {
      return { ok: false, reason: 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.', code: 'migration_missing' };
    }
    throw new Error(error.message);
  }

  // Diagnostic lease only — not the primary lock.
  await supabase.from('booking_channel_manager_connections').update({
    last_import_at: now,
    metadata: {
      ...stripFullSnapshot(connection.metadata),
      liveSyncLease: { runId, status: 'held', acquiredAt: now },
    },
    updated_at: now,
  }).eq('id', connection.id);

  return { ok: true, run: mapRun(data as Record<string, unknown>) };
}

export async function releaseChannelLiveSyncLease(connectionId: string, runId: string): Promise<void> {
  const connection = await getConnection(connectionId);
  const lease = connection.metadata?.liveSyncLease as Record<string, unknown> | undefined;
  if (lease && text(lease.runId) !== runId) return;
  const now = new Date().toISOString();
  await supabase.from('booking_channel_manager_connections').update({
    metadata: {
      ...stripFullSnapshot(connection.metadata),
      liveSyncLease: { runId, status: 'released', releasedAt: now },
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
    .select('id,account_id,normalized_status,ops_status')
    .eq('id', matchedBookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) return 'skipped';
  const status = text(booking.normalized_status || booking.ops_status).toLowerCase();
  if (status === 'cancelled' || status === 'canceled') return 'skipped';
  const accountId = nullableText(booking.account_id);
  if (!accountId) {
    throw Object.assign(
      new Error('Нельзя отменить бронь: не указан account_id. Нужна проверка оператором.'),
      { code: 'missing_account_id' },
    );
  }
  const result = await cancelReservation({
    accountId,
    reservationId: matchedBookingId,
    actorId: 'channel-manager-live-core',
    reason: 'channel_manager_live_core_external_cancel',
  });
  return result.changed ? 'cancelled' : 'skipped';
}

type UpdateOutcome = 'updated' | 'skipped' | 'failed';

async function applyExternalBookingUpdate(
  imported: Record<string, unknown>,
  warnings: ChannelImportConflict[],
): Promise<UpdateOutcome> {
  const matchedBookingId = text(imported.matched_booking_id);
  if (!matchedBookingId) return 'skipped';
  const checkIn = nullableText(imported.checkin_date);
  const checkOut = nullableText(imported.checkout_date);
  const guestName = nullableText(imported.guest_safe_name);
  const { data: current, error } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,unit_id,guest_name,check_in_at,check_out_at,normalized_status')
    .eq('id', matchedBookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) return 'skipped';
  if (text(current.normalized_status).toLowerCase() === 'cancelled') return 'skipped';

  const currentCheckIn = current.check_in_at ? String(current.check_in_at).slice(0, 10) : null;
  const currentCheckOut = current.check_out_at ? String(current.check_out_at).slice(0, 10) : null;
  const datesChanged = Boolean((checkIn && checkIn !== currentCheckIn) || (checkOut && checkOut !== currentCheckOut));
  const guestChanged = Boolean(guestName && guestName !== text(current.guest_name));
  if (!datesChanged && !guestChanged) return 'skipped';

  if (datesChanged) {
    const accountId = nullableText(current.account_id);
    const propertyId = nullableText(current.property_id);
    if (!accountId || !propertyId || !checkIn || !checkOut) {
      warnings.push({
        type: 'availability_update_blocked',
        severity: 'blocker',
        entityId: text(imported.id),
        message: 'Нельзя изменить даты: недостаточно account_id/property_id/дат. Нужна проверка оператором.',
      });
      return 'failed';
    }
    const availability = await getUnifiedAvailability({
      accountId,
      propertyId,
      unitId: nullableText(current.unit_id),
      checkIn,
      checkOut,
      excludeReservationId: matchedBookingId,
    });
    if (!availability.available) {
      warnings.push({
        type: 'availability_conflict',
        severity: 'blocker',
        entityId: text(imported.id),
        message: 'Подтверждённый конфликт доступности — даты не изменены.',
      });
      return 'failed';
    }
    const result = await updateBookingOpsRecord(matchedBookingId, {
      guestName: guestChanged ? guestName ?? undefined : undefined,
      checkInAt: checkIn,
      checkOutAt: checkOut,
    }, { actorType: 'admin' });
    if (!result.ok) throw new Error(result.error ?? 'Не удалось обновить бронь.');
    return 'updated';
  }

  const result = await updateBookingOpsRecord(matchedBookingId, {
    guestName: guestName ?? undefined,
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
        const outcome = await applyExternalBookingUpdate(imported, warnings);
        if (outcome === 'updated') counters.updated += 1;
        else if (outcome === 'failed') {
          counters.failed += 1;
          counters.skipped += 1;
        } else counters.skipped += 1;
        continue;
      }

      if (matchStatus === 'unmatched' || !imported.matched_booking_id) {
        const created = await createBookingFromImportedChannelBooking(text(imported.id));
        if (created.duplicate) counters.skipped += 1;
        else if (created.created) counters.imported += 1;
        else counters.skipped += 1;
        continue;
      }

      counters.skipped += 1;
    } catch (error) {
      counters.failed += 1;
      warnings.push({
        type: (error as { code?: string })?.code === 'missing_account_id' ? 'cancel_missing_account' : 'booking_sync_failed',
        severity: 'blocker',
        entityId: text(imported.id),
        message: redactLiveCoreErrorMessage(error instanceof Error ? error.message : error),
      });
    }
  }
}

async function finalizeFailedConnection(input: {
  connection: ChannelManagerConnection;
  runId: string;
  stage: ChannelLiveSyncStage;
  counters: ChannelLiveSyncCounters;
  warnings: ChannelImportConflict[];
  safeError: ChannelLiveSafeError;
  cursors: ChannelLiveProviderCursor[];
  snapshotReceipt?: Record<string, unknown> | null;
}): Promise<ChannelManagerConnection> {
  const finishedAt = new Date().toISOString();
  await updateRunProgress(input.runId, {
    stage: 'failed',
    status: 'failed',
    finishedAt,
    counters: input.counters,
    warnings: input.warnings,
    errors: [input.safeError],
    safeSummary: `Live Core initial sync остановлен на этапе ${input.stage}.`,
    metadata: {
      cursorPlaceholder: input.cursors,
      liveCoreCounters: input.counters,
      failedStage: input.stage,
      safeError: input.safeError,
    },
  }).catch(() => undefined);

  const patch: Record<string, unknown> = {
    status: 'import_failed',
    last_failure_at: finishedAt,
    failure_reason: input.safeError.message.slice(0, 500),
    metadata: {
      ...stripFullSnapshot(input.connection.metadata),
      liveCore: true,
      lastFailedStage: input.stage,
      lastSafeError: input.safeError,
      lastLiveCoreCounters: input.counters,
      cursorPlaceholder: input.cursors,
      liveSyncLease: { runId: input.runId, status: 'released', releasedAt: finishedAt },
      ...(input.snapshotReceipt ? { lastManualSnapshotReceipt: input.snapshotReceipt } : {}),
    },
    updated_at: finishedAt,
  };
  // Do not touch last_success_at or clear prior failure semantics incorrectly.
  const { data } = await supabase.from('booking_channel_manager_connections').update(patch).eq('id', input.connection.id).select('*').single();
  if (!data) return input.connection;
  return {
    ...input.connection,
    status: text(data.status),
    lastFailureAt: nullableText(data.last_failure_at),
    failureReason: nullableText(data.failure_reason),
    metadata: (data.metadata as Record<string, unknown>) ?? input.connection.metadata,
    updatedAt: text(data.updated_at),
  };
}

// ---------------------------------------------------------------------------
// 3. One-shot initial sync engine
// ---------------------------------------------------------------------------

export async function runChannelManagerInitialSync(input: {
  connectionId: string;
  snapshot?: ManualChannelSnapshot;
  reuseImportedRows?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<ChannelLiveSyncResult> {
  if (input.metadata && findSecretPath(input.metadata)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
  }

  let stage: ChannelLiveSyncStage = 'acquire_guard';
  let runId: string | null = null;
  const counters = emptyCounters();
  let warnings: ChannelImportConflict[] = [];
  let cursors: ChannelLiveProviderCursor[] = [];
  let connection = await getConnection(input.connectionId);
  let receipt: Record<string, unknown> | null = null;
  let bookingsImported = 0;

  try {
    const guard = await acquireChannelLiveSyncGuard(connection.id);
    if (!guard.ok) {
      throw Object.assign(new Error(guard.reason), { code: guard.code });
    }
    runId = guard.run.id;

    stage = 'load_provider_data';
    await updateRunProgress(runId, { stage, counters });
    const adapter = createChannelLiveCoreAdapter(connection.provider, {
      snapshot: input.snapshot,
      reuseImportedRows: input.reuseImportedRows === true,
      connectionId: connection.id,
    });
    if (input.snapshot) receipt = snapshotReceipt(input.snapshot, runId);
    const snapshot = await adapter.loadInitialSnapshot();
    cursors = snapshot.cursors;

    const skipRowImport = input.reuseImportedRows === true && !input.snapshot;

    if (!skipRowImport) {
      stage = 'import_objects';
      await updateRunProgress(runId, { stage, counters, metadata: { cursorPlaceholder: cursors } });
      counters.objects = await importChannelObjects(connection.id, snapshot.properties.map(propertyToRow), { importRunId: runId });

      stage = 'import_bookings';
      await updateRunProgress(runId, { stage, counters, objects: counters.objects });
      bookingsImported = await importChannelBookings(connection.id, snapshot.bookings.map(bookingToRow), { importRunId: runId });

      stage = 'import_calendar';
      await updateRunProgress(runId, { stage, counters, bookings: bookingsImported });
      counters.calendarDays = await importChannelCalendar(connection.id, snapshot.calendar.map(calendarToRow), { importRunId: runId });
      counters.prices = await importChannelCalendar(connection.id, snapshot.pricing.map(calendarToRow), { importRunId: runId, pricing: true });
    } else {
      counters.objects = snapshot.properties.length;
      bookingsImported = snapshot.bookings.length;
      counters.calendarDays = snapshot.calendar.length;
    }

    stage = 'reconcile_properties';
    await updateRunProgress(runId, {
      stage, counters, bookings: bookingsImported, calendarDays: counters.calendarDays, prices: counters.prices,
      metadata: { cursorPlaceholder: cursors },
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
    const status = resolveChannelLiveSyncFinalStatus(counters, warnings);

    if (status === 'failed') {
      const safeError = toChannelLiveSafeError('process_bookings', 'Initial sync завершён с blocker/ошибками обработки.', 'sync_failed');
      connection = await finalizeFailedConnection({
        connection, runId, stage: 'process_bookings', counters, warnings, safeError, cursors, snapshotReceipt: receipt,
      });
      const runs = await listChannelImportRuns(connection.id);
      const run = runs.find((item) => item.id === runId)!;
      return {
        run, connection, stage: 'failed', status: 'failed', counters, warnings, safeError, cursors, retryable: true,
      };
    }

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
      },
    });

    const { data: connectionRow } = await supabase.from('booking_channel_manager_connections').update({
      status: connection.status === 'blocked' ? connection.status : 'import_ready',
      last_success_at: finishedAt,
      failure_reason: null,
      metadata: {
        ...stripFullSnapshot(connection.metadata),
        liveCore: true,
        lastSuccessfulInitialSyncAt: finishedAt,
        cursorPlaceholder: cursors,
        lastLiveCoreCounters: counters,
        liveSyncLease: { runId, status: 'released', releasedAt: finishedAt },
        ...(receipt ? { lastManualSnapshotReceipt: receipt } : {}),
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
      run, connection, stage: 'completed', status, counters, warnings, safeError: null, cursors, retryable: true,
    };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const safeError = toChannelLiveSafeError(
      stage,
      error,
      code === 'execution_guard' || code === 'migration_missing' ? code : 'sync_failed',
    );
    if (runId) {
      connection = await finalizeFailedConnection({
        connection, runId, stage, counters, warnings, safeError, cursors, snapshotReceipt: receipt,
      });
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
  const schema = await probeChannelLiveCoreSchema(connection.id);
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

  const latestWarnings = Array.isArray(latest?.warnings) ? latest!.warnings as ChannelImportConflict[] : [];
  const blockerWarning = latestWarnings.find((item) => item && typeof item === 'object' && (item as ChannelImportConflict).severity === 'blocker') as ChannelImportConflict | undefined;

  let warning: string | null = null;
  let blocker: string | null = null;
  if (!schema.ready) blocker = schema.blocker;
  else if (connection.status === 'blocked') blocker = connection.failureReason ?? 'Подключение заблокировано.';
  else if (latest?.status === 'failed') {
    blocker = redactLiveCoreErrorMessage(
      blockerWarning?.message
        ?? safeError?.message
        ?? connection.failureReason
        ?? 'Последняя синхронизация завершилась ошибкой.',
    );
  } else if (blockerWarning) blocker = redactLiveCoreErrorMessage(blockerWarning.message);
  else if (counters?.failed) blocker = `Есть ошибки обработки броней: ${counters.failed}.`;
  else if (latestWarnings.length > 0) warning = 'Есть предупреждения сверки после initial sync.';

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
    liveCoreEnabled: schema.ready,
    initialSyncEnabled: schema.ready,
    incrementalSyncEnabled: false,
    realProviderApiEnabled: CHANNEL_PROVIDER_ADAPTERS[connection.provider]?.supports_real_api === true,
    schemaReady: schema.ready,
    cursorPlaceholder: cursors ?? cursorPlaceholder(),
  };
}
