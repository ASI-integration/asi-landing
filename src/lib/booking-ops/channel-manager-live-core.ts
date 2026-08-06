/**
 * Channel Manager Live Core — provider-independent read-only sync contract
 * and one-shot initial sync engine. Reuses Access Import + Booking Intake.
 * No real provider APIs, polling, webhooks, or outbound OTA writes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { cancelReservation, getUnifiedAvailability, restoreReservation } from '@/lib/reservations/ledger';
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
import {
  LIVE_CORE_ACCEPTANCE_HARNESS,
} from './channel-manager-live-core-acceptance-constants';
import {
  buildLiveCoreAcceptanceReservationMetadata,
  runWithLiveCoreAcceptanceCreateContext,
} from './channel-manager-live-core-acceptance-context';

// ---------------------------------------------------------------------------
// 1. Provider-independent adapter contract (no credentials / raw secrets)
// ---------------------------------------------------------------------------

export const CHANNEL_LIVE_SYNC_STAGES = [
  'queued',
  'acquire_guard',
  'load_provider_data',
  'load_cursor',
  'load_incremental_batch',
  'import_objects',
  'import_bookings',
  'import_calendar',
  'reconcile_properties',
  'reconcile_bookings',
  'process_bookings',
  'process_booking_changes',
  'audit_availability',
  'commit_cursor',
  'persist_counters',
  'completed',
  'failed',
] as const;
export type ChannelLiveSyncStage = (typeof CHANNEL_LIVE_SYNC_STAGES)[number];

/** Bounded timeout after which a stuck running live sync is recoverable. */
export const STALE_INITIAL_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
export const STALE_LIVE_SYNC_TIMEOUT_MS = STALE_INITIAL_SYNC_TIMEOUT_MS;

export const MAX_INCREMENTAL_BATCH_BYTES = 500_000;
export const MAX_INCREMENTAL_BATCH_ROWS = 200;
export const MAX_CURSOR_CHECKPOINT_CHARS = 512;

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

export type ChannelLiveIncrementalBatch = {
  bookings: ChannelLiveExternalBooking[];
  calendar: ChannelLiveCalendarDay[];
  pricing: ChannelLiveCalendarDay[];
  currentCursor: ChannelLiveProviderCursor | null;
  nextCursor: ChannelLiveProviderCursor;
  hasMore: boolean;
};

export type ManualChannelIncrementalDelta = {
  bookings?: Array<Record<string, unknown>>;
  calendar?: Array<Record<string, unknown>>;
  pricing?: Array<Record<string, unknown>>;
  currentCursor?: ChannelLiveProviderCursor | null;
  nextCursor: ChannelLiveProviderCursor;
  hasMore?: boolean;
};

export type ChannelLiveCommittedCursor = {
  stream: 'incremental';
  checkpoint: string;
  batchHash: string; // full sha256 hex
  updatedAt: string;
  sourceRunId: string;
};

export type IncrementalCursorProtocolResult =
  | { kind: 'replay' }
  | { kind: 'advance' };

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
  /** Optional: present only when incremental capability is enabled for the adapter. */
  loadIncrementalBatch?(input: {
    cursor: ChannelLiveProviderCursor | null;
    limit?: number;
  }): Promise<ChannelLiveIncrementalBatch>;
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

export const MANUAL_INCREMENTAL_LIVE_CAPABILITIES: ChannelLiveCapabilities = {
  ...MANUAL_LIVE_CAPABILITIES,
  incrementalCursor: true,
};

const LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER =
  'Миграция Channel Manager Live Incremental Sync ещё не применена. Incremental sync недоступен.';

const SECRET_VALUE_RE = /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:password|пароль|token|api[_-]?key|secret)\s*[:=]\s*\S+)/iu;
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const SCHEMA_STATE_TTL_MS = 30_000;
const SCHEMA_STATE_FAILURE_TTL_MS = 5_000;
const LIVE_CORE_MIGRATION_BLOCKER = 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.';

export type ChannelLiveCoreSchemaState = {
  schemaVersion: number;
  initialSyncTypeReady: boolean;
  incrementalSyncTypeReady: boolean;
  atomicRunningGuardReady: boolean;
  atomicLiveSyncGuardReady: boolean;
  cursorStorageReady: boolean;
  ready: boolean;
  blocker: string | null;
};

/** Test override for schema readiness. null = probe live via RPC. */
let schemaStateOverride: ChannelLiveCoreSchemaState | null = null;
let schemaStateCache: { at: number; state: ChannelLiveCoreSchemaState } | null = null;

export function clearChannelLiveCoreSchemaStateCache(): void {
  schemaStateCache = null;
}

export function setChannelLiveCoreSchemaStateOverride(
  state: (Partial<ChannelLiveCoreSchemaState> & Pick<ChannelLiveCoreSchemaState, 'ready'>) | null,
): void {
  if (state == null) {
    schemaStateOverride = null;
  } else {
    const atomicLiveSyncGuardReady = state.atomicLiveSyncGuardReady === true
      || state.atomicRunningGuardReady === true;
    schemaStateOverride = {
      schemaVersion: Number(state.schemaVersion ?? 0) || 0,
      initialSyncTypeReady: state.initialSyncTypeReady === true,
      incrementalSyncTypeReady: state.incrementalSyncTypeReady === true,
      atomicRunningGuardReady: atomicLiveSyncGuardReady,
      atomicLiveSyncGuardReady,
      cursorStorageReady: state.cursorStorageReady === true,
      ready: state.ready === true,
      blocker: state.blocker ?? null,
    };
  }
  schemaStateCache = null;
}

/** @deprecated Prefer setChannelLiveCoreSchemaStateOverride for partial readiness cases. */
export function setChannelLiveCoreSchemaReadyOverride(value: boolean | null): void {
  if (value === null) {
    schemaStateOverride = null;
  } else if (value) {
    schemaStateOverride = {
      schemaVersion: 2,
      initialSyncTypeReady: true,
      incrementalSyncTypeReady: true,
      atomicRunningGuardReady: true,
      atomicLiveSyncGuardReady: true,
      cursorStorageReady: true,
      ready: true,
      blocker: null,
    };
  } else {
    schemaStateOverride = {
      schemaVersion: 0,
      initialSyncTypeReady: false,
      incrementalSyncTypeReady: false,
      atomicRunningGuardReady: false,
      atomicLiveSyncGuardReady: false,
      cursorStorageReady: false,
      ready: false,
      blocker: LIVE_CORE_MIGRATION_BLOCKER,
    };
  }
  schemaStateCache = null;
}

function schemaStateFromRpcPayload(data: unknown): ChannelLiveCoreSchemaState {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const schemaVersion = Number(row.schemaVersion ?? 1) || 0;
  const initialSyncTypeReady = row.initialSyncTypeReady === true;
  const incrementalSyncTypeReady = row.incrementalSyncTypeReady === true;
  const atomicLiveSyncGuardReady = row.atomicLiveSyncGuardReady === true
    || row.atomicRunningGuardReady === true;
  const atomicRunningGuardReady = atomicLiveSyncGuardReady;
  const cursorStorageReady = row.cursorStorageReady === true;
  const v2Complete = schemaVersion >= 2
    && initialSyncTypeReady
    && incrementalSyncTypeReady
    && atomicLiveSyncGuardReady
    && cursorStorageReady;
  const v1Complete = schemaVersion < 2
    && initialSyncTypeReady
    && atomicRunningGuardReady;
  const ready = row.ready === false
    ? false
    : (schemaVersion >= 2 ? v2Complete : v1Complete);
  let blocker: string | null = null;
  if (!ready) {
    if (schemaVersion >= 2) {
      if (!incrementalSyncTypeReady || !cursorStorageReady || !atomicLiveSyncGuardReady) {
        blocker = LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER;
      } else if (!initialSyncTypeReady) {
        blocker = LIVE_CORE_MIGRATION_BLOCKER;
      } else {
        blocker = LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER;
      }
    } else if (!initialSyncTypeReady && !atomicRunningGuardReady) {
      blocker = LIVE_CORE_MIGRATION_BLOCKER;
    } else if (!initialSyncTypeReady) {
      blocker = 'Миграция Live Core неполная: отсутствует разрешение import_type=initial_sync.';
    } else {
      blocker = 'Миграция Live Core неполная: отсутствует atomic running-run guard index.';
    }
  }
  return {
    schemaVersion,
    initialSyncTypeReady,
    incrementalSyncTypeReady,
    atomicRunningGuardReady,
    atomicLiveSyncGuardReady,
    cursorStorageReady,
    ready,
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
    || (/import_type|initial_sync|incremental_sync|check constraint/i.test(message) && /violat|fail|reject/i.test(message));
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
    { stream: 'objects', checkpoint: null, note: 'Initial sync only; durable incremental cursor lives in connection.metadata.incrementalCursor.' },
    { stream: 'bookings', checkpoint: null, note: 'Initial sync only; durable incremental cursor lives in connection.metadata.incrementalCursor.' },
    { stream: 'calendar', checkpoint: null, note: 'Initial sync only; durable incremental cursor lives in connection.metadata.incrementalCursor.' },
    { stream: 'incremental', checkpoint: null, note: 'Polling/webhooks not implemented; manual incremental delta uses committed cursor.' },
  ];
}

function stableJsonValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonValue(item)).join(',')}]`;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonValue(row[key])}`).join(',')}}`;
}

export function hashCursorCheckpoint(checkpoint: string): string {
  return createHash('sha256').update(checkpoint).digest('hex').slice(0, 16);
}

export function computeIncrementalBatchHash(batch: ChannelLiveIncrementalBatch): string {
  const bookings = [...batch.bookings]
    .map((item) => ({
      changeKind: item.changeKind,
      checkInDate: item.checkInDate ?? null,
      checkOutDate: item.checkOutDate ?? null,
      externalBookingId: item.externalBookingId,
      externalObjectId: item.externalObjectId ?? null,
      guestContactRef: item.guestContactRef ?? null,
      guestCount: item.guestCount ?? null,
      guestSafeName: item.guestSafeName ?? null,
      status: item.status,
    }))
    .sort((left, right) => left.externalBookingId.localeCompare(right.externalBookingId));
  const calendar = [...batch.calendar]
    .map((item) => ({
      availabilityStatus: item.availabilityStatus ?? null,
      currency: item.currency ?? null,
      date: item.date,
      externalObjectId: item.externalObjectId,
      minStay: item.minStay ?? null,
      priceAmount: item.priceAmount ?? null,
    }))
    .sort((left, right) => (
      `${left.externalObjectId}\0${left.date}`.localeCompare(`${right.externalObjectId}\0${right.date}`)
    ));
  const pricing = [...batch.pricing]
    .map((item) => ({
      availabilityStatus: item.availabilityStatus ?? null,
      currency: item.currency ?? null,
      date: item.date,
      externalObjectId: item.externalObjectId,
      minStay: item.minStay ?? null,
      priceAmount: item.priceAmount ?? null,
    }))
    .sort((left, right) => (
      `${left.externalObjectId}\0${left.date}`.localeCompare(`${right.externalObjectId}\0${right.date}`)
    ));
  const payload = {
    bookings,
    calendar,
    currentCursor: batch.currentCursor
      ? { checkpoint: batch.currentCursor.checkpoint, stream: batch.currentCursor.stream }
      : null,
    hasMore: batch.hasMore === true,
    nextCursor: {
      checkpoint: batch.nextCursor.checkpoint,
      stream: batch.nextCursor.stream,
    },
    pricing,
  };
  return createHash('sha256').update(stableJsonValue(payload)).digest('hex');
}

export function assertFailClosedIncrementalCursorProtocol(
  committed: ChannelLiveCommittedCursor | null,
  batch: ChannelLiveIncrementalBatch,
): IncrementalCursorProtocolResult {
  const nextCheckpoint = text(batch.nextCursor?.checkpoint);
  if (!nextCheckpoint) {
    throw Object.assign(new Error('nextCursor обязателен и должен содержать checkpoint.'), {
      code: 'cursor_protocol_violation',
    });
  }

  if (!committed) {
    if (batch.currentCursor != null) {
      throw Object.assign(
        new Error('currentCursor должен быть null при первом incremental batch.'),
        { code: 'cursor_protocol_violation' },
      );
    }
    return { kind: 'advance' };
  }

  if (nextCheckpoint === committed.checkpoint) {
    const batchHash = computeIncrementalBatchHash(batch);
    const committedHash = text(committed.batchHash);
    if (committedHash && batchHash === committedHash) {
      return { kind: 'replay' };
    }
    throw Object.assign(
      new Error('Повторный nextCursor с другим содержимым batch (cursor_replay_mismatch).'),
      { code: 'cursor_replay_mismatch' },
    );
  }

  const currentCheckpoint = text(batch.currentCursor?.checkpoint);
  if (!batch.currentCursor || !currentCheckpoint) {
    throw Object.assign(
      new Error('После первого commit нужен currentCursor, совпадающий с committed checkpoint.'),
      { code: 'cursor_protocol_violation' },
    );
  }
  if (currentCheckpoint !== committed.checkpoint) {
    throw Object.assign(
      new Error('currentCursor не совпадает с последним committed cursor.'),
      { code: 'cursor_protocol_violation' },
    );
  }
  if (currentCheckpoint === nextCheckpoint) {
    throw Object.assign(
      new Error('currentCursor и nextCursor не должны совпадать для нового batch.'),
      { code: 'cursor_protocol_violation' },
    );
  }
  return { kind: 'advance' };
}

export function buildSafeIncrementalCursorMetadata(input: {
  cursorPresent: boolean;
  cursorCheckpointHash?: string | null;
  currentCursorHash?: string | null;
  nextCursorHash?: string | null;
  hasMore?: boolean;
  sourceRunId?: string | null;
  updatedAt?: string | null;
  replayed?: boolean;
  batchHashPrefix?: string | null;
}): Record<string, unknown> {
  return {
    cursorPresent: input.cursorPresent === true,
    cursorCheckpointHash: input.cursorCheckpointHash ?? null,
    currentCursorHash: input.currentCursorHash ?? null,
    nextCursorHash: input.nextCursorHash ?? null,
    hasMore: input.hasMore === true,
    sourceRunId: input.sourceRunId ?? null,
    updatedAt: input.updatedAt ?? null,
    replayed: input.replayed === true,
    ...(input.batchHashPrefix ? { batchHashPrefix: input.batchHashPrefix } : {}),
  };
}

export function toSafeIncrementalRunSummary(run: ChannelImportRun): SafeIncrementalRunSummary {
  return {
    id: run.id,
    status: run.status,
    importType: run.importType,
    stage: text(run.metadata?.liveCoreStage) || null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    counters: readCounters(run.metadata),
    safeError: (run.metadata?.safeError as ChannelLiveSafeError | undefined) ?? null,
  };
}

function dedupeIncrementalRowsByKey<T>(
  items: T[],
  keyOf: (item: T) => string,
  label: string,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    if (stableJsonValue(existing) !== stableJsonValue(item)) {
      throw new Error(`Конфликт дубликатов в ${label}: ${key}`);
    }
  }
  return [...byKey.values()];
}

export function validateChannelLiveProviderCursor(
  value: unknown,
  options?: { requiredCheckpoint?: boolean },
): ChannelLiveProviderCursor | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Курсор указан в неверном формате.');
  }
  const row = value as Record<string, unknown>;
  const stream = text(row.stream) || 'incremental';
  if (stream !== 'incremental' && stream !== 'objects' && stream !== 'bookings' && stream !== 'calendar') {
    throw new Error('Недопустимый поток курсора.');
  }
  const checkpointRaw = row.checkpoint == null ? null : text(row.checkpoint);
  if (checkpointRaw && checkpointRaw.length > MAX_CURSOR_CHECKPOINT_CHARS) {
    throw new Error(`Checkpoint курсора слишком длинный (макс. ${MAX_CURSOR_CHECKPOINT_CHARS}).`);
  }
  if (options?.requiredCheckpoint && !checkpointRaw) {
    throw new Error('Для nextCursor нужен непустой checkpoint.');
  }
  if (findSecretPath(row)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать в курсоре.');
  }
  return {
    stream: stream as ChannelLiveProviderCursor['stream'],
    checkpoint: checkpointRaw,
    note: nullableText(row.note) ?? undefined,
  };
}

export function validateManualChannelIncrementalDelta(
  delta: ManualChannelIncrementalDelta,
): ChannelLiveIncrementalBatch {
  if (!delta || typeof delta !== 'object') {
    throw new Error('Нужен нормализованный incremental delta JSON.');
  }
  if (findSecretPath(delta)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
  }
  const size = Buffer.byteLength(JSON.stringify(delta), 'utf8');
  if (size > MAX_INCREMENTAL_BATCH_BYTES) {
    throw new Error(`Incremental batch слишком большой. Максимальный размер — ${MAX_INCREMENTAL_BATCH_BYTES} байт.`);
  }
  const bookingsRaw = Array.isArray(delta.bookings) ? delta.bookings : [];
  const calendarRaw = Array.isArray(delta.calendar) ? delta.calendar : [];
  const pricingRaw = Array.isArray(delta.pricing) ? delta.pricing : [];
  if (
    bookingsRaw.length > MAX_INCREMENTAL_BATCH_ROWS
    || calendarRaw.length > MAX_INCREMENTAL_BATCH_ROWS
    || pricingRaw.length > MAX_INCREMENTAL_BATCH_ROWS
  ) {
    throw new Error(`В одном разделе incremental batch должно быть не более ${MAX_INCREMENTAL_BATCH_ROWS} строк.`);
  }

  const nextCursor = validateChannelLiveProviderCursor(delta.nextCursor, { requiredCheckpoint: true });
  if (!nextCursor || nextCursor.stream !== 'incremental' || !nextCursor.checkpoint) {
    throw new Error('nextCursor обязателен и должен содержать stream=incremental и checkpoint.');
  }
  const currentCursor = validateChannelLiveProviderCursor(delta.currentCursor ?? null);

  const bookings = dedupeIncrementalRowsByKey(
    bookingsRaw.map((item) => {
      const status = normalizeExternalBookingStatus(item.status);
      const explicitKind = text(item.changeKind ?? item.change_kind).toLowerCase();
      const changeKind = (
        ['created', 'updated', 'cancelled', 'restored', 'unchanged'] as const
      ).includes(explicitKind as ChannelLiveBookingChangeKind)
        ? explicitKind as ChannelLiveBookingChangeKind
        : classifyBookingChange(nullableText(item.previous_status ?? item.previousStatus), status);
      return {
        externalBookingId: text(item.external_booking_id ?? item.externalBookingId ?? item.id),
        externalObjectId: nullableText(item.external_object_id ?? item.externalObjectId),
        guestSafeName: nullableText(item.guest_safe_name ?? item.guestName),
        guestContactRef: nullableText(item.guest_contact_ref ?? item.guestContactRef),
        checkInDate: normalizeDate(item.checkin_date ?? item.checkIn),
        checkOutDate: normalizeDate(item.checkout_date ?? item.checkOut),
        guestCount: numberOrNull(item.guest_count ?? item.guestCount),
        status,
        changeKind,
      };
    }).filter((item) => item.externalBookingId),
    (item) => item.externalBookingId,
    'bookings',
  );
  const calendar = dedupeIncrementalRowsByKey(
    calendarRaw.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status ?? item.availability) || 'unknown',
      minStay: numberOrNull(item.min_stay ?? item.minStay),
      priceAmount: numberOrNull(item.price_amount ?? item.price),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date),
    (item) => `${item.externalObjectId}\0${item.date}`,
    'calendar',
  );
  const pricing = dedupeIncrementalRowsByKey(
    pricingRaw.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status ?? item.availability) || 'unknown',
      minStay: numberOrNull(item.min_stay ?? item.minStay),
      priceAmount: numberOrNull(item.price_amount ?? item.price),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date),
    (item) => `${item.externalObjectId}\0${item.date}`,
    'pricing',
  );

  return {
    bookings,
    calendar,
    pricing,
    currentCursor,
    nextCursor,
    hasMore: delta.hasMore === true,
  };
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

/** Manual normalized incremental delta adapter — enabled only when an explicit delta is supplied. */
export class ManualChannelLiveIncrementalAdapter implements ChannelManagerLiveCoreAdapter {
  readonly provider: ChannelManagerProvider = 'manual';
  readonly capabilities = MANUAL_INCREMENTAL_LIVE_CAPABILITIES;
  private readonly batch: ChannelLiveIncrementalBatch;

  constructor(delta: ManualChannelIncrementalDelta) {
    this.batch = validateManualChannelIncrementalDelta(delta);
  }

  getIdentity(): ChannelLiveAdapterIdentity {
    return { provider: 'manual', label: 'Ручной incremental delta JSON', supportsRealApi: false };
  }

  normalizeBookingStatus(raw: unknown): NormalizedExternalBookingStatus {
    return normalizeExternalBookingStatus(raw);
  }

  classifyBookingChange(previousStatus: string | null | undefined, next: NormalizedExternalBookingStatus): ChannelLiveBookingChangeKind {
    return classifyBookingChange(previousStatus, next);
  }

  getProviderCursorPlaceholder(): ChannelLiveProviderCursor[] {
    return [{
      stream: 'incremental',
      checkpoint: null,
      note: 'Manual incremental reference cursor (not a real provider API).',
    }];
  }

  async listExternalProperties(): Promise<ChannelLiveExternalProperty[]> {
    return [];
  }

  async fetchInitialBookingSnapshot(): Promise<ChannelLiveExternalBooking[]> {
    return this.batch.bookings;
  }

  async fetchCalendarSnapshot(): Promise<ChannelLiveCalendarDay[]> {
    return this.batch.calendar;
  }

  async fetchPricingSnapshot(): Promise<ChannelLiveCalendarDay[]> {
    return this.batch.pricing;
  }

  async loadInitialSnapshot(): Promise<ChannelLiveInitialSnapshot> {
    throw new Error('Manual incremental adapter не выполняет Initial Sync. Передайте delta в runChannelManagerIncrementalSync.');
  }

  async loadIncrementalBatch(input: {
    cursor: ChannelLiveProviderCursor | null;
    limit?: number;
  }): Promise<ChannelLiveIncrementalBatch> {
    const limit = Math.min(
      Math.max(1, Number(input.limit ?? MAX_INCREMENTAL_BATCH_ROWS) || MAX_INCREMENTAL_BATCH_ROWS),
      MAX_INCREMENTAL_BATCH_ROWS,
    );
    if (this.batch.bookings.length > limit
      || this.batch.calendar.length > limit
      || this.batch.pricing.length > limit) {
      throw new Error(`Incremental batch превышает limit=${limit}.`);
    }
    // Soft defensive check only — fail-closed protocol is enforced in the runner
    // before side effects (including true replay detection).
    const committed = input.cursor?.checkpoint ?? null;
    const expected = this.batch.currentCursor?.checkpoint ?? null;
    if (committed && expected && committed !== expected) {
      throw new Error('currentCursor delta не совпадает с последним committed cursor.');
    }
    return {
      ...this.batch,
      bookings: this.batch.bookings.slice(0, limit),
      calendar: this.batch.calendar.slice(0, limit),
      pricing: this.batch.pricing.slice(0, limit),
    };
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
  options?: {
    snapshot?: ManualChannelSnapshot;
    incrementalDelta?: ManualChannelIncrementalDelta;
    reuseImportedRows?: boolean;
    connectionId?: string;
  },
): ChannelManagerLiveCoreAdapter {
  if (options?.incrementalDelta) return new ManualChannelLiveIncrementalAdapter(options.incrementalDelta);
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
  /** Incremental-friendly aliases (imported == created for create path). */
  created: number;
  restored: number;
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
  cursorCommitted?: boolean;
  committedCursor?: ChannelLiveCommittedCursor | null;
  replayed?: boolean;
};

export type SafeIncrementalRunSummary = {
  id: string;
  status: string;
  importType: string;
  stage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  counters: ChannelLiveSyncCounters | null;
  safeError: ChannelLiveSafeError | null;
};

export type ChannelLiveCoreStatus = {
  provider: ChannelManagerProvider;
  connectionId: string;
  connectionState: string;
  lastSuccessfulSyncAt: string | null;
  lastSuccessfulInitialSyncAt: string | null;
  lastSuccessfulIncrementalSyncAt: string | null;
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
  latestIncrementalRun: {
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
  retryable: boolean;
  liveCoreEnabled: boolean;
  initialSyncEnabled: boolean;
  incrementalSyncEnabled: boolean;
  realProviderApiEnabled: boolean;
  schemaReady: boolean;
  schemaVersion: number;
  cursorPresent: boolean;
  cursorUpdatedAt: string | null;
  cursorSourceRunId: string | null;
  cursorCheckpointHash: string | null;
  cursorPlaceholder: ChannelLiveProviderCursor[];
};

function emptyCounters(): ChannelLiveSyncCounters {
  return {
    imported: 0, updated: 0, cancelled: 0, skipped: 0, failed: 0,
    objects: 0, calendarDays: 0, prices: 0, created: 0, restored: 0,
  };
}

function readCounters(metadata: Record<string, unknown> | undefined): ChannelLiveSyncCounters | null {
  const raw = metadata?.liveCoreCounters;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const imported = Number(row.imported ?? row.created ?? 0);
  const skipped = Number(row.skipped ?? 0);
  return {
    imported,
    updated: Number(row.updated ?? 0),
    cancelled: Number(row.cancelled ?? 0),
    skipped,
    failed: Number(row.failed ?? 0),
    objects: Number(row.objects ?? 0),
    calendarDays: Number(row.calendarDays ?? 0),
    prices: Number(row.prices ?? 0),
    created: Number(row.created ?? imported),
    restored: Number(row.restored ?? 0),
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
      incrementalSyncTypeReady: false,
      atomicRunningGuardReady: false,
      atomicLiveSyncGuardReady: false,
      cursorStorageReady: false,
      ready: false,
      blocker: LIVE_CORE_MIGRATION_BLOCKER,
    };
    schemaStateCache = { at: now, state: failed };
    return failed;
  }

  const state = schemaStateFromRpcPayload(data);
  if (state.schemaVersion >= 2) {
    const complete = state.initialSyncTypeReady
      && state.incrementalSyncTypeReady
      && state.atomicLiveSyncGuardReady
      && state.cursorStorageReady;
    state.ready = complete;
    if (!complete && !state.blocker) {
      state.blocker = LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER;
    }
    if (complete) state.blocker = null;
  } else if (!state.initialSyncTypeReady || !state.atomicRunningGuardReady) {
    state.ready = false;
    if (!state.blocker) state.blocker = LIVE_CORE_MIGRATION_BLOCKER;
  } else {
    state.ready = true;
    state.blocker = null;
  }
  schemaStateCache = { at: now, state };
  return state;
}

/** Mark stale running live sync rows failed, preserving evidence. */
export async function recoverStaleInitialSyncRuns(
  connectionId: string,
  nowMs: number = Date.now(),
): Promise<string[]> {
  return recoverStaleLiveSyncRuns(connectionId, nowMs);
}

export async function recoverStaleLiveSyncRuns(
  connectionId: string,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const connection = await getConnection(connectionId);
  const { data: running, error } = await supabase
    .from('booking_channel_import_runs')
    .select('*')
    .eq('connection_id', connection.id)
    .in('import_type', ['initial_sync', 'incremental_sync'])
    .eq('status', 'running');
  if (error) throw new Error(error.message);

  const recovered: string[] = [];
  for (const row of (running ?? []) as Record<string, unknown>[]) {
    const startedAt = Date.parse(text(row.started_at || row.created_at));
    if (!Number.isFinite(startedAt) || nowMs - startedAt < STALE_LIVE_SYNC_TIMEOUT_MS) continue;
    const finishedAt = new Date(nowMs).toISOString();
    const importType = text(row.import_type) || 'initial_sync';
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
        message: `Зависший ${importType} помечен как failed по timeout; evidence сохранены.`,
        retryable: true,
      },
    };
    const { error: updateError } = await supabase.from('booking_channel_import_runs').update({
      status: 'failed',
      finished_at: finishedAt,
      errors: [metadata.safeError],
      safe_summary: `${importType} прерван по stale timeout. Ранее сохранённые данные не удалены.`,
      metadata,
      updated_at: finishedAt,
    }).eq('id', row.id).eq('status', 'running');
    if (updateError) throw new Error(updateError.message);
    recovered.push(text(row.id));
  }
  return recovered;
}

/**
 * Atomic per-connection live-sync guard: insert running initial_sync or incremental_sync.
 * Unique partial index enforces exclusivity across both types; 23505 => execution_guard.
 */
export async function acquireChannelLiveSyncGuard(
  connectionId: string,
  options?: { importType?: 'initial_sync' | 'incremental_sync' },
): Promise<
  { ok: true; run: ChannelImportRun } | { ok: false; reason: string; code: 'execution_guard' | 'migration_missing' }
> {
  const importType = options?.importType ?? 'initial_sync';
  const connection = await getConnection(connectionId);
  const schema = await probeChannelLiveCoreSchema(connection.id);
  if (importType === 'incremental_sync') {
    if (schema.schemaVersion < 2 || !schema.incrementalSyncTypeReady || !schema.atomicLiveSyncGuardReady || !schema.cursorStorageReady) {
      return { ok: false, reason: schema.blocker ?? LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER, code: 'migration_missing' };
    }
  } else if (!schema.ready && !(schema.initialSyncTypeReady && schema.atomicRunningGuardReady)) {
    return { ok: false, reason: schema.blocker ?? 'Миграция Live Core не применена.', code: 'migration_missing' };
  }

  await recoverStaleLiveSyncRuns(connection.id);

  const runId = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_import_runs').insert({
    id: runId,
    connection_id: connection.id,
    provider: connection.provider,
    status: 'running',
    import_type: importType,
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
      return {
        ok: false,
        reason: importType === 'incremental_sync'
          ? LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER
          : 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.',
        code: 'migration_missing',
      };
    }
    throw new Error(error.message);
  }

  // Diagnostic lease only — not the primary lock.
  await supabase.from('booking_channel_manager_connections').update({
    last_import_at: now,
    metadata: {
      ...stripFullSnapshot(connection.metadata),
      liveSyncLease: { runId, status: 'held', acquiredAt: now, importType },
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
type RestoreOutcome = 'restored' | 'skipped' | 'failed';

async function applyExternalRestoration(
  imported: Record<string, unknown>,
  warnings: ChannelImportConflict[],
): Promise<RestoreOutcome> {
  const matchedBookingId = text(imported.matched_booking_id);
  if (!matchedBookingId) return 'skipped';
  const { data: current, error } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,unit_id,guest_name,check_in_at,check_out_at,normalized_status')
    .eq('id', matchedBookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) return 'skipped';
  const status = text(current.normalized_status).toLowerCase();
  if (status !== 'cancelled' && status !== 'canceled') return 'skipped';

  const checkIn = nullableText(imported.checkin_date) || (current.check_in_at ? String(current.check_in_at).slice(0, 10) : null);
  const checkOut = nullableText(imported.checkout_date) || (current.check_out_at ? String(current.check_out_at).slice(0, 10) : null);
  const accountId = nullableText(current.account_id);
  const propertyId = nullableText(current.property_id);
  if (!accountId || !propertyId || !checkIn || !checkOut) {
    warnings.push({
      type: 'restore_blocked',
      severity: 'blocker',
      entityId: text(imported.id),
      message: 'Нельзя восстановить бронь: недостаточно account_id/property_id/дат. Нужна проверка оператором.',
    });
    return 'failed';
  }

  const result = await restoreReservation({
    accountId,
    reservationId: matchedBookingId,
    actorId: 'channel-manager-live-core',
    propertyId,
    unitId: nullableText(current.unit_id),
    checkIn,
    checkOut,
    reason: 'channel_manager_live_core_external_restore',
  });
  if (result.blocked) {
    warnings.push({
      type: 'availability_conflict',
      severity: 'blocker',
      entityId: text(imported.id),
      message: 'Восстановление заблокировано: подтверждённый конфликт доступности (overbooking).',
    });
    return 'failed';
  }
  return result.changed ? 'restored' : 'skipped';
}

async function applyExternalBookingUpdate(
  imported: Record<string, unknown>,
  warnings: ChannelImportConflict[],
): Promise<UpdateOutcome> {
  const matchedBookingId = text(imported.matched_booking_id);
  if (!matchedBookingId) return 'skipped';
  const checkIn = nullableText(imported.checkin_date);
  const checkOut = nullableText(imported.checkout_date);
  const guestName = nullableText(imported.guest_safe_name);
  const guestCount = numberOrNull(imported.guest_count);
  const { data: current, error } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,unit_id,guest_name,guest_count,check_in_at,check_out_at,normalized_status')
    .eq('id', matchedBookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) return 'skipped';
  if (text(current.normalized_status).toLowerCase() === 'cancelled') return 'skipped';

  const currentCheckIn = current.check_in_at ? String(current.check_in_at).slice(0, 10) : null;
  const currentCheckOut = current.check_out_at ? String(current.check_out_at).slice(0, 10) : null;
  const datesChanged = Boolean((checkIn && checkIn !== currentCheckIn) || (checkOut && checkOut !== currentCheckOut));
  const guestChanged = Boolean(guestName && guestName !== text(current.guest_name));
  const guestCountChanged = guestCount != null && guestCount !== numberOrNull(current.guest_count);
  if (!datesChanged && !guestChanged && !guestCountChanged) return 'skipped';

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
      guestCount: guestCountChanged ? guestCount ?? undefined : undefined,
      checkInAt: checkIn,
      checkOutAt: checkOut,
    }, { actorType: 'admin' });
    if (!result.ok) throw new Error(result.error ?? 'Не удалось обновить бронь.');
    return 'updated';
  }

  const result = await updateBookingOpsRecord(matchedBookingId, {
    guestName: guestChanged ? guestName ?? undefined : undefined,
    guestCount: guestCountChanged ? guestCount ?? undefined : undefined,
  }, { actorType: 'admin' });
  if (!result.ok) throw new Error(result.error ?? 'Не удалось обновить бронь.');
  return 'updated';
}

async function processImportedBookingsForLiveSync(
  connectionId: string,
  counters: ChannelLiveSyncCounters,
  warnings: ChannelImportConflict[],
  options?: {
    reservationMetadata?: Record<string, unknown> | null;
    injectFailureAfterBookingOpsCreate?: boolean;
    /** When set, only process these external booking ids (incremental delta). */
    externalBookingIds?: string[] | null;
    changeKindByExternalId?: Record<string, ChannelLiveBookingChangeKind> | null;
  },
): Promise<void> {
  let query = supabase
    .from('booking_channel_imported_bookings')
    .select('*')
    .eq('connection_id', connectionId);
  // Explicit array (including empty) scopes processing; undefined/null = full Initial Sync set.
  if (Array.isArray(options?.externalBookingIds)) {
    if (options.externalBookingIds.length === 0) {
      return;
    }
    query = query.in('external_booking_id', options.externalBookingIds);
  }
  const { data: bookings, error } = await query;
  if (error) throw new Error(error.message);

  for (const imported of (bookings ?? []) as Record<string, unknown>[]) {
    const matchStatus = text(imported.match_status);
    const externalStatus = normalizeExternalBookingStatus(imported.status);
    const externalId = text(imported.external_booking_id);
    const changeKind = options?.changeKindByExternalId?.[externalId]
      ?? classifyBookingChange(null, externalStatus);

    if (changeKind === 'unchanged') {
      counters.skipped += 1;
      continue;
    }

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

    if (object && ['unmatched', 'possible_match'].includes(text(object.match_status))
      && externalStatus !== 'cancelled'
      && changeKind !== 'cancelled') {
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
      if (changeKind === 'cancelled' || externalStatus === 'cancelled') {
        if (imported.matched_booking_id) {
          const outcome = await applyExternalCancellation(text(imported.matched_booking_id));
          if (outcome === 'cancelled') counters.cancelled += 1;
          else counters.skipped += 1;
        } else {
          counters.skipped += 1;
        }
        continue;
      }

      if (changeKind === 'restored' || externalStatus === 'restored') {
        if (imported.matched_booking_id) {
          const outcome = await applyExternalRestoration(imported, warnings);
          if (outcome === 'restored') {
            counters.restored += 1;
            counters.updated += 1;
          } else if (outcome === 'failed') {
            counters.failed += 1;
            counters.skipped += 1;
          } else counters.skipped += 1;
        } else if (matchStatus === 'unmatched' || !imported.matched_booking_id) {
          const created = await createBookingFromImportedChannelBooking(text(imported.id), {
            reservationMetadata: options?.reservationMetadata ?? null,
          });
          if (created.duplicate) counters.skipped += 1;
          else if (created.created) {
            counters.imported += 1;
            counters.created += 1;
            counters.restored += 1;
          } else counters.skipped += 1;
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
        const created = await createBookingFromImportedChannelBooking(text(imported.id), {
          reservationMetadata: options?.reservationMetadata ?? null,
        });
        if (created.duplicate) counters.skipped += 1;
        else if (created.created) {
          counters.imported += 1;
          counters.created += 1;
          if (options?.injectFailureAfterBookingOpsCreate === true) {
            throw Object.assign(
              new Error('acceptance_inject_failure_after_booking_ops_create'),
              { code: 'acceptance_inject_failure_after_booking_ops_create' },
            );
          }
        } else counters.skipped += 1;
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
      if ((error as { code?: string })?.code === 'acceptance_inject_failure_after_booking_ops_create') {
        throw error;
      }
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
  /** Test/harness-only: fail immediately after Booking Ops create. */
  injectFailureAfterBookingOpsCreate?: boolean;
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
    const harnessMeta = input.metadata;
    const isAcceptanceHarness = harnessMeta?.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS
      && typeof harnessMeta.acceptanceExecutionId === 'string'
      && harnessMeta.acceptanceExecutionId.length > 0;
    const reservationMetadata = isAcceptanceHarness
      ? buildLiveCoreAcceptanceReservationMetadata({
        acceptanceExecutionId: String(harnessMeta.acceptanceExecutionId),
        importRunId: runId,
      })
      : null;
    const processBookings = async () => processImportedBookingsForLiveSync(
      connection.id,
      counters,
      warnings,
      {
        reservationMetadata,
        injectFailureAfterBookingOpsCreate: input.injectFailureAfterBookingOpsCreate === true,
      },
    );
    if (isAcceptanceHarness && reservationMetadata) {
      await runWithLiveCoreAcceptanceCreateContext({
        acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS,
        acceptanceExecutionId: String(harnessMeta.acceptanceExecutionId),
        importRunId: runId,
        reservationMetadata,
      }, processBookings);
    } else {
      await processBookings();
    }

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
  const latest = runs.find((run) => run.importType === 'initial_sync' || run.importType === 'incremental_sync')
    ?? runs[0]
    ?? null;
  const latestIncremental = runs.find((run) => run.importType === 'incremental_sync') ?? null;
  const counters = readCounters(latest?.metadata) ?? readCounters(connection.metadata) ?? null;
  const safeError = (latest?.metadata?.safeError as ChannelLiveSafeError | undefined)
    ?? (connection.metadata?.lastSafeError as ChannelLiveSafeError | undefined)
    ?? null;
  const stage = text(latest?.metadata?.liveCoreStage) || null;
  // Never surface raw checkpoints from run/connection metadata in public status.
  const cursors = cursorPlaceholder();

  const committed = readCommittedIncrementalCursor(connection.metadata);
  const lastSuccessfulInitialSyncAt = nullableText(connection.metadata?.lastSuccessfulInitialSyncAt)
    ?? (latest?.importType === 'initial_sync' && ['completed', 'completed_with_warnings'].includes(latest.status)
      ? latest.finishedAt
      : null);
  const lastSuccessfulIncrementalSyncAt = nullableText(connection.metadata?.lastSuccessfulIncrementalSyncAt);

  const latestWarnings = Array.isArray(latest?.warnings) ? latest!.warnings as ChannelImportConflict[] : [];
  const blockerWarning = latestWarnings.find((item) => item && typeof item === 'object' && (item as ChannelImportConflict).severity === 'blocker') as ChannelImportConflict | undefined;

  const initialSyncReady = schema.initialSyncTypeReady && schema.atomicRunningGuardReady;
  const incrementalReady = schema.schemaVersion >= 2
    && schema.incrementalSyncTypeReady
    && schema.atomicLiveSyncGuardReady
    && schema.cursorStorageReady
    && Boolean(lastSuccessfulInitialSyncAt)
    && connection.status !== 'blocked';

  let warning: string | null = null;
  let blocker: string | null = null;
  if (!schema.ready && !initialSyncReady) blocker = schema.blocker;
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
  else if (latestWarnings.length > 0) warning = 'Есть предупреждения сверки после sync.';
  else if (!lastSuccessfulInitialSyncAt) {
    warning = 'Incremental sync доступен только после успешного Initial Sync.';
  }

  const mapLatest = (run: ChannelImportRun | null) => (run ? {
    id: run.id,
    status: run.status,
    importType: run.importType,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    stage: text(run.metadata?.liveCoreStage) || null,
    counters: readCounters(run.metadata),
    safeError: (run.metadata?.safeError as ChannelLiveSafeError | undefined) ?? null,
  } : null);

  return {
    provider: connection.provider,
    connectionId: connection.id,
    connectionState: connection.status,
    lastSuccessfulSyncAt: connection.lastSuccessAt,
    lastSuccessfulInitialSyncAt,
    lastSuccessfulIncrementalSyncAt,
    latestRun: mapLatest(latest),
    latestIncrementalRun: mapLatest(latestIncremental),
    counters,
    warning,
    blocker,
    retryable: Boolean(safeError?.retryable ?? (latest?.status === 'failed')),
    liveCoreEnabled: initialSyncReady,
    initialSyncEnabled: initialSyncReady && connection.status !== 'blocked',
    incrementalSyncEnabled: incrementalReady,
    realProviderApiEnabled: CHANNEL_PROVIDER_ADAPTERS[connection.provider]?.supports_real_api === true,
    schemaReady: schema.ready || initialSyncReady,
    schemaVersion: schema.schemaVersion,
    cursorPresent: Boolean(committed?.checkpoint),
    cursorUpdatedAt: committed?.updatedAt ?? null,
    cursorSourceRunId: committed?.sourceRunId ?? null,
    cursorCheckpointHash: committed?.checkpoint
      ? hashCursorCheckpoint(committed.checkpoint)
      : null,
    cursorPlaceholder: cursors,
  };
}

function readCommittedIncrementalCursor(
  metadata: Record<string, unknown> | undefined,
): ChannelLiveCommittedCursor | null {
  const raw = metadata?.incrementalCursor;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const checkpoint = text(row.checkpoint);
  if (!checkpoint) return null;
  return {
    stream: 'incremental',
    checkpoint,
    batchHash: text(row.batchHash) || text(row.batch_hash) || '',
    updatedAt: text(row.updatedAt) || text(row.updated_at) || '',
    sourceRunId: text(row.sourceRunId) || text(row.source_run_id) || '',
  };
}

export async function resolveIncrementalConnectionScope(
  connection: ChannelManagerConnection,
): Promise<{
  connectionId: string;
  ownerSetupId: string;
  propertySetupId: string;
  accountId: string | null;
}> {
  const propertySetupId = text(connection.propertySetupId);
  const ownerSetupId = text(connection.ownerSetupId);
  if (!propertySetupId) {
    throw Object.assign(new Error('У подключения не указан профиль объекта.'), {
      code: 'connection_scope_invalid',
    });
  }
  if (!ownerSetupId) {
    throw Object.assign(new Error('У подключения не указан владелец.'), {
      code: 'connection_scope_invalid',
    });
  }

  const { data: property, error } = await supabase
    .from('booking_property_setup_profiles')
    .select('id,owner_setup_id')
    .eq('id', propertySetupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!property) {
    throw Object.assign(new Error('Профиль объекта не найден.'), {
      code: 'connection_scope_invalid',
    });
  }
  if (text(property.owner_setup_id) !== ownerSetupId) {
    throw Object.assign(new Error('Объект не принадлежит владельцу подключения.'), {
      code: 'account_scope_mismatch',
    });
  }

  return {
    connectionId: connection.id,
    ownerSetupId,
    propertySetupId,
    accountId: nullableText(connection.metadata?.accountId),
  };
}

async function requireSuccessfulInitialSync(connectionId: string): Promise<string> {
  const runs = await listChannelImportRuns(connectionId);
  const success = runs.find((run) => (
    run.importType === 'initial_sync'
    && ['completed', 'completed_with_warnings'].includes(run.status)
  ));
  if (!success) {
    throw Object.assign(
      new Error('Incremental sync доступен только после успешного Initial Sync.'),
      { code: 'initial_sync_required' },
    );
  }
  return success.id;
}

// ---------------------------------------------------------------------------
// 4. Live Incremental Sync v1 — one bounded delta batch, no polling/webhooks
// ---------------------------------------------------------------------------

export async function runChannelManagerIncrementalSync(input: {
  connectionId: string;
  delta: ManualChannelIncrementalDelta;
  metadata?: Record<string, unknown>;
  limit?: number;
}): Promise<ChannelLiveSyncResult> {
  if (input.metadata && findSecretPath(input.metadata)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
  }
  if (findSecretPath(input.delta)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
  }

  const validatedBatch = validateManualChannelIncrementalDelta(input.delta);

  let stage: ChannelLiveSyncStage = 'queued';
  let runId: string | null = null;
  const counters = emptyCounters();
  let warnings: ChannelImportConflict[] = [];
  let cursors: ChannelLiveProviderCursor[] = cursorPlaceholder();
  let connection = await getConnection(input.connectionId);
  let previousCursor = readCommittedIncrementalCursor(connection.metadata);
  let cursorCommitted = false;

  try {
    await resolveIncrementalConnectionScope(connection);

    if (connection.status === 'blocked') {
      throw Object.assign(new Error(connection.failureReason ?? 'Подключение заблокировано.'), { code: 'connection_blocked' });
    }

    const schema = await probeChannelLiveCoreSchema(connection.id);
    if (schema.schemaVersion < 2 || !schema.incrementalSyncTypeReady || !schema.atomicLiveSyncGuardReady || !schema.cursorStorageReady) {
      throw Object.assign(new Error(schema.blocker ?? LIVE_CORE_INCREMENTAL_MIGRATION_BLOCKER), { code: 'migration_missing' });
    }

    await requireSuccessfulInitialSync(connection.id);

    stage = 'load_cursor';
    previousCursor = readCommittedIncrementalCursor(connection.metadata);
    const protocol = assertFailClosedIncrementalCursorProtocol(previousCursor, validatedBatch);

    if (protocol.kind === 'replay') {
      const runs = await listChannelImportRuns(connection.id);
      const lastSuccess = runs.find((run) => (
        run.importType === 'incremental_sync'
        && ['completed', 'completed_with_warnings'].includes(run.status)
      ));
      const run = lastSuccess ?? {
        id: previousCursor?.sourceRunId || '00000000-0000-4000-8000-000000000000',
        connectionId: connection.id,
        provider: connection.provider,
        status: 'completed' as const,
        importType: 'incremental_sync' as const,
        startedAt: null,
        finishedAt: previousCursor?.updatedAt ?? null,
        importedObjectsCount: 0,
        importedBookingsCount: 0,
        importedCalendarDaysCount: 0,
        importedPricesCount: 0,
        warnings: [],
        errors: [],
        safeSummary: 'Incremental sync replay (no side effects).',
        metadata: {
          liveCore: true,
          liveCoreStage: 'completed',
          liveCoreCounters: emptyCounters(),
          ...buildSafeIncrementalCursorMetadata({
            cursorPresent: true,
            cursorCheckpointHash: previousCursor?.checkpoint
              ? hashCursorCheckpoint(previousCursor.checkpoint)
              : null,
            sourceRunId: previousCursor?.sourceRunId ?? null,
            updatedAt: previousCursor?.updatedAt ?? null,
            replayed: true,
            batchHashPrefix: previousCursor?.batchHash
              ? previousCursor.batchHash.slice(0, 16)
              : null,
          }),
        },
        createdAt: previousCursor?.updatedAt ?? new Date().toISOString(),
        updatedAt: previousCursor?.updatedAt ?? new Date().toISOString(),
      };

      return {
        run,
        connection,
        stage: 'completed',
        status: 'completed',
        counters: emptyCounters(),
        warnings: [],
        safeError: null,
        cursors: cursorPlaceholder(),
        retryable: true,
        cursorCommitted: true,
        committedCursor: previousCursor,
        replayed: true,
      };
    }

    stage = 'acquire_guard';
    const guard = await acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' });
    if (!guard.ok) {
      throw Object.assign(new Error(guard.reason), { code: guard.code });
    }
    runId = guard.run.id;
    connection = await getConnection(connection.id);
    previousCursor = readCommittedIncrementalCursor(connection.metadata);
    // Re-assert after guard in case another commit landed; still fail-closed.
    assertFailClosedIncrementalCursorProtocol(previousCursor, validatedBatch);

    const nextCheckpoint = validatedBatch.nextCursor.checkpoint!;
    const currentCheckpoint = validatedBatch.currentCursor?.checkpoint ?? null;
    const batchHash = computeIncrementalBatchHash(validatedBatch);

    await updateRunProgress(runId, {
      stage: 'load_cursor',
      counters,
      metadata: buildSafeIncrementalCursorMetadata({
        cursorPresent: Boolean(previousCursor?.checkpoint),
        cursorCheckpointHash: previousCursor?.checkpoint
          ? hashCursorCheckpoint(previousCursor.checkpoint)
          : null,
        currentCursorHash: currentCheckpoint ? hashCursorCheckpoint(currentCheckpoint) : null,
        nextCursorHash: hashCursorCheckpoint(nextCheckpoint),
        hasMore: validatedBatch.hasMore,
        sourceRunId: previousCursor?.sourceRunId ?? null,
        updatedAt: previousCursor?.updatedAt ?? null,
        replayed: false,
        batchHashPrefix: previousCursor?.batchHash
          ? previousCursor.batchHash.slice(0, 16)
          : null,
      }),
    });

    stage = 'load_incremental_batch';
    await updateRunProgress(runId, { stage, counters });
    const adapter = createChannelLiveCoreAdapter(connection.provider, { incrementalDelta: input.delta });
    if (!adapter.capabilities.incrementalCursor || typeof adapter.loadIncrementalBatch !== 'function') {
      throw Object.assign(new Error('Выбранный adapter не поддерживает incremental sync.'), { code: 'incremental_capability_missing' });
    }
    const cursorForLoad: ChannelLiveProviderCursor | null = previousCursor
      ? { stream: 'incremental', checkpoint: previousCursor.checkpoint }
      : null;
    const batch = await adapter.loadIncrementalBatch({
      cursor: cursorForLoad,
      limit: input.limit,
    });
    cursors = cursorPlaceholder();

    stage = 'import_bookings';
    await updateRunProgress(runId, {
      stage,
      counters,
      metadata: buildSafeIncrementalCursorMetadata({
        cursorPresent: Boolean(previousCursor?.checkpoint),
        cursorCheckpointHash: previousCursor?.checkpoint
          ? hashCursorCheckpoint(previousCursor.checkpoint)
          : null,
        currentCursorHash: currentCheckpoint ? hashCursorCheckpoint(currentCheckpoint) : null,
        nextCursorHash: hashCursorCheckpoint(nextCheckpoint),
        hasMore: batch.hasMore,
        sourceRunId: runId,
        replayed: false,
        batchHashPrefix: batchHash.slice(0, 16),
      }),
    });
    const bookingsImported = batch.bookings.length > 0
      ? await importChannelBookings(connection.id, batch.bookings.map(bookingToRow), { importRunId: runId })
      : 0;

    stage = 'import_calendar';
    await updateRunProgress(runId, { stage, counters, bookings: bookingsImported });
    counters.calendarDays = batch.calendar.length > 0
      ? await importChannelCalendar(connection.id, batch.calendar.map(calendarToRow), { importRunId: runId })
      : 0;
    counters.prices = batch.pricing.length > 0
      ? await importChannelCalendar(connection.id, batch.pricing.map(calendarToRow), { importRunId: runId, pricing: true })
      : 0;

    stage = 'reconcile_bookings';
    await updateRunProgress(runId, {
      stage, counters, bookings: bookingsImported, calendarDays: counters.calendarDays, prices: counters.prices,
    });
    await reconcileImportedBookings(connection.id);

    stage = 'process_booking_changes';
    await updateRunProgress(runId, { stage, counters });
    const changeKindByExternalId: Record<string, ChannelLiveBookingChangeKind> = {};
    for (const booking of batch.bookings) {
      changeKindByExternalId[booking.externalBookingId] = booking.changeKind;
    }
    await processImportedBookingsForLiveSync(connection.id, counters, warnings, {
      externalBookingIds: batch.bookings.map((item) => item.externalBookingId),
      changeKindByExternalId,
    });

    stage = 'audit_availability';
    await updateRunProgress(runId, { stage, counters, warnings });
    const availabilityChecks = await auditChannelImportAvailability(connection.id);
    const conflictWarnings = await getChannelImportConflicts(connection.id);
    warnings = [...warnings, ...conflictWarnings];
    for (const check of availabilityChecks) {
      if (check.status === 'no_conflict') continue;
      warnings.push({
        type: 'availability_conflict',
        severity: check.status === 'confirmed_conflict' ? 'blocker' : 'warning',
        message: check.safeSummary,
      });
    }

    stage = 'persist_counters';
    const status = resolveChannelLiveSyncFinalStatus(counters, warnings);
    if (status === 'failed') {
      const safeError = toChannelLiveSafeError('process_booking_changes', 'Incremental sync завершён с blocker/ошибками обработки.', 'sync_failed');
      connection = await finalizeFailedIncrementalConnection({
        connection, runId, stage: 'process_booking_changes', counters, warnings, safeError, cursors, previousCursor,
      });
      const runs = await listChannelImportRuns(connection.id);
      const run = runs.find((item) => item.id === runId)!;
      return {
        run, connection, stage: 'failed', status: 'failed', counters, warnings, safeError, cursors,
        retryable: true, cursorCommitted: false, committedCursor: previousCursor, replayed: false,
      };
    }

    stage = 'commit_cursor';
    const finishedAt = new Date().toISOString();
    const safeRunMetadata = {
      liveCore: true,
      liveCoreCounters: counters,
      ...buildSafeIncrementalCursorMetadata({
        cursorPresent: true,
        cursorCheckpointHash: hashCursorCheckpoint(nextCheckpoint),
        currentCursorHash: currentCheckpoint ? hashCursorCheckpoint(currentCheckpoint) : null,
        nextCursorHash: hashCursorCheckpoint(nextCheckpoint),
        hasMore: batch.hasMore,
        sourceRunId: runId,
        updatedAt: finishedAt,
        replayed: false,
        batchHashPrefix: batchHash.slice(0, 16),
      }),
    };
    await updateRunProgress(runId, {
      stage,
      counters,
      warnings,
      metadata: safeRunMetadata,
    });

    const { data: commitData, error: commitError } = await supabase.rpc(
      'channel_manager_commit_incremental_sync_v1',
      {
        p_connection_id: connection.id,
        p_run_id: runId,
        p_expected_previous_checkpoint: previousCursor?.checkpoint ?? null,
        p_expected_previous_batch_hash: previousCursor?.batchHash || null,
        p_new_checkpoint: nextCheckpoint,
        p_new_batch_hash: batchHash,
        p_finished_at: finishedAt,
        p_status: status,
        p_counters: counters,
        p_safe_run_metadata: safeRunMetadata,
        p_warnings: warnings,
        p_safe_summary: `Live Core incremental sync: создано ${counters.created}, обновлено ${counters.updated}, отменено ${counters.cancelled}, восстановлено ${counters.restored}, пропущено ${counters.skipped}, ошибок ${counters.failed}.`,
        p_bookings: bookingsImported,
        p_calendar_days: counters.calendarDays,
        p_prices: counters.prices,
      },
    );

    const commitPayload = commitData && typeof commitData === 'object'
      ? commitData as { success?: boolean; code?: string; message?: string }
      : null;
    if (commitError || !commitPayload || commitPayload.success !== true) {
      const code = text(commitPayload?.code) || 'cursor_commit_failed';
      const message = text(commitPayload?.message)
        || text(commitError?.message)
        || 'Не удалось атомарно зафиксировать incremental cursor.';
      throw Object.assign(new Error(message), { code });
    }

    cursorCommitted = true;
    connection = await getConnection(connection.id);
    const committed = readCommittedIncrementalCursor(connection.metadata);
    const runs = await listChannelImportRuns(connection.id);
    const run = runs.find((item) => item.id === runId)!;

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
      cursorCommitted: true,
      committedCursor: committed,
      replayed: false,
    };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const safeError = toChannelLiveSafeError(
      stage,
      error,
      code === 'execution_guard'
        || code === 'migration_missing'
        || code === 'initial_sync_required'
        || code === 'account_scope_mismatch'
        || code === 'connection_scope_invalid'
        || code === 'connection_blocked'
        || code === 'cursor_protocol_violation'
        || code === 'cursor_replay_mismatch'
        || code === 'cursor_commit_failed'
        || code === 'stale_expected_cursor'
        || code === 'incremental_capability_missing'
        ? code
        : 'sync_failed',
    );
    if (runId) {
      connection = await finalizeFailedIncrementalConnection({
        connection, runId, stage, counters, warnings, safeError, cursors, previousCursor,
      });
    }

    const runs = runId ? await listChannelImportRuns(connection.id) : [];
    const run = runs.find((item) => item.id === runId) ?? {
      id: runId ?? '00000000-0000-4000-8000-000000000000',
      connectionId: connection.id,
      provider: connection.provider,
      status: 'failed',
      importType: 'incremental_sync' as const,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      importedObjectsCount: counters.objects,
      importedBookingsCount: counters.imported,
      importedCalendarDaysCount: counters.calendarDays,
      importedPricesCount: counters.prices,
      warnings,
      errors: [safeError],
      safeSummary: safeError.message,
      metadata: {
        liveCoreStage: stage,
        liveCoreCounters: counters,
        safeError,
        ...buildSafeIncrementalCursorMetadata({
          cursorPresent: Boolean(previousCursor?.checkpoint),
          cursorCheckpointHash: previousCursor?.checkpoint
            ? hashCursorCheckpoint(previousCursor.checkpoint)
            : null,
          sourceRunId: previousCursor?.sourceRunId ?? null,
          updatedAt: previousCursor?.updatedAt ?? null,
          replayed: false,
        }),
      },
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
      cursorCommitted: false,
      committedCursor: previousCursor,
      replayed: false,
    };
  }
}

async function finalizeFailedIncrementalConnection(input: {
  connection: ChannelManagerConnection;
  runId: string;
  stage: ChannelLiveSyncStage;
  counters: ChannelLiveSyncCounters;
  warnings: ChannelImportConflict[];
  safeError: ChannelLiveSafeError;
  cursors: ChannelLiveProviderCursor[];
  previousCursor: ChannelLiveCommittedCursor | null;
}): Promise<ChannelManagerConnection> {
  const finishedAt = new Date().toISOString();
  await updateRunProgress(input.runId, {
    stage: 'failed',
    status: 'failed',
    finishedAt,
    counters: input.counters,
    warnings: input.warnings,
    errors: [input.safeError],
    safeSummary: `Live Core incremental sync остановлен на этапе ${input.stage}.`,
    metadata: {
      liveCoreCounters: input.counters,
      failedStage: input.stage,
      safeError: input.safeError,
      cursorRetained: true,
      ...buildSafeIncrementalCursorMetadata({
        cursorPresent: Boolean(input.previousCursor?.checkpoint),
        cursorCheckpointHash: input.previousCursor?.checkpoint
          ? hashCursorCheckpoint(input.previousCursor.checkpoint)
          : null,
        sourceRunId: input.previousCursor?.sourceRunId ?? null,
        updatedAt: input.previousCursor?.updatedAt ?? null,
        replayed: false,
        batchHashPrefix: input.previousCursor?.batchHash
          ? input.previousCursor.batchHash.slice(0, 16)
          : null,
      }),
    },
  }).catch(() => undefined);

  // Preserve previous committed cursor — never advance on failure.
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
      ...(input.previousCursor ? { incrementalCursor: input.previousCursor } : {}),
      liveSyncLease: { runId: input.runId, status: 'released', releasedAt: finishedAt, importType: 'incremental_sync' },
    },
    updated_at: finishedAt,
  };
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
