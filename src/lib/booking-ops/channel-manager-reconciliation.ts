/**
 * Channel Manager Reconciliation & Recovery v1.
 * Compares a manual normalized provider snapshot with ASI state.
 * Preview is read-only (persist report only). Apply reuses Access Import +
 * Booking Ops / reservation ledger paths — no second mutation system.
 * Never advances incremental cursor. Never auto-cancels missing-external.
 */
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { cancelReservation, getUnifiedAvailability, restoreReservation } from '@/lib/reservations/ledger';
import { updateBookingOpsRecord } from './repository';
import {
  createBookingFromImportedChannelBooking,
  findSecretPath,
  getChannelManagerConnectionStatus,
  importChannelBookings,
  importChannelCalendar,
  listChannelCalendarSnapshots,
  listChannelImportRuns,
  listImportedChannelBookings,
  reconcileImportedBookings,
  type ChannelImportRun,
  type ChannelManagerConnection,
} from './channel-manager-access-import';
import { auditChannelImportAvailability } from './availability-overbooking-protection';
import {
  acquireChannelLiveSyncGuard,
  classifyBookingChange,
  hashCursorCheckpoint,
  normalizeExternalBookingStatus,
  probeChannelLiveCoreSchema,
  readCommittedIncrementalCursor,
  recoverStaleLiveSyncRuns,
  redactLiveCoreErrorMessage,
  releaseChannelLiveSyncLease,
  resolveIncrementalConnectionScope,
  STALE_LIVE_SYNC_TIMEOUT_MS,
  toChannelLiveSafeError,
  validateChannelLiveProviderCursor,
  type ChannelLiveCalendarDay,
  type ChannelLiveCommittedCursor,
  type ChannelLiveExternalBooking,
  type ChannelLiveSafeError,
  type NormalizedExternalBookingStatus,
} from './channel-manager-live-core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS =
  'APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS';
export const MAX_RECONCILIATION_SNAPSHOT_BYTES = 500_000;
export const MAX_RECONCILIATION_SNAPSHOT_ROWS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelReconciliationSnapshot = {
  snapshotKind: 'complete' | 'bounded';
  asOf: string;
  providerCursor?: { stream: 'incremental'; checkpoint: string } | null;
  bookings: ChannelLiveExternalBooking[];
  calendar: ChannelLiveCalendarDay[];
  pricing: ChannelLiveCalendarDay[];
};

export type ChannelReconciliationCategory =
  | 'booking_missing_internal'
  | 'booking_field_drift'
  | 'booking_status_drift'
  | 'booking_cancel_missed'
  | 'booking_restore_missed'
  | 'invalid_booking_match'
  | 'duplicate_internal_booking'
  | 'booking_missing_external'
  | 'booking_unchanged'
  | 'calendar_day_missing_internal'
  | 'calendar_availability_drift'
  | 'calendar_orphan_internal_day'
  | 'pricing_missing_internal'
  | 'pricing_value_drift'
  | 'pricing_orphan_internal_day'
  | 'stale_running_sync'
  | 'failed_retryable_sync'
  | 'lease_run_mismatch'
  | 'cursor_missing_source_run'
  | 'cursor_run_status_mismatch'
  | 'cursor_checkpoint_difference'
  | 'partial_sync_detected';

export type ChannelReconciliationSeverity = 'info' | 'warning' | 'blocker';
export type ChannelReconciliationRepairability = 'safe_auto' | 'operator_review' | 'unsupported';
export type ChannelReconciliationItemStatus =
  | 'detected'
  | 'planned'
  | 'applied'
  | 'skipped'
  | 'blocked'
  | 'failed';

export type ChannelReconciliationRunMode = 'preview' | 'apply';
export type ChannelReconciliationRunStatus =
  | 'queued'
  | 'analyzing'
  | 'preview_ready'
  | 'applying'
  | 'completed'
  | 'completed_with_blockers'
  | 'failed';

export type ChannelReconciliationDriftItem = {
  category: ChannelReconciliationCategory;
  severity: ChannelReconciliationSeverity;
  repairability: ChannelReconciliationRepairability;
  status: ChannelReconciliationItemStatus;
  externalIdentityHash: string | null;
  importedBookingId: string | null;
  bookingOpsRecordId: string | null;
  propertyId: string | null;
  safeBefore: Record<string, unknown>;
  safeAfter: Record<string, unknown>;
  deterministicActionKey: string;
  safeMessage: string;
  entityIdentity: string;
  safeIntendedState: string;
};

export type ChannelReconciliationRunRow = {
  id: string;
  connectionId: string;
  provider: string;
  mode: ChannelReconciliationRunMode;
  status: ChannelReconciliationRunStatus;
  snapshotKind: 'complete' | 'bounded';
  snapshotHash: string;
  reportHash: string;
  committedCursorHashAtPreview: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  safeSummary: string | null;
  safeError: Record<string, unknown>;
  counts: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ChannelReconciliationItemRow = {
  id: string;
  reconciliationRunId: string;
  connectionId: string;
  category: ChannelReconciliationCategory;
  severity: ChannelReconciliationSeverity;
  repairability: ChannelReconciliationRepairability;
  status: ChannelReconciliationItemStatus;
  externalIdentityHash: string | null;
  importedBookingId: string | null;
  bookingOpsRecordId: string | null;
  propertyId: string | null;
  safeBefore: Record<string, unknown>;
  safeAfter: Record<string, unknown>;
  deterministicActionKey: string;
  safeMessage: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Recovered from safe_after.entityIdentity (not a DB column). */
  entityIdentity: string;
};

export type SafeReconciliationReport = {
  runId: string;
  connectionId: string;
  mode: ChannelReconciliationRunMode;
  status: ChannelReconciliationRunStatus;
  snapshotKind: 'complete' | 'bounded';
  snapshotHashPrefix: string;
  reportHashPrefix: string;
  reportHash: string;
  committedCursorHashAtPreview: string | null;
  cursorChangedSincePreview: boolean | null;
  startedAt: string | null;
  finishedAt: string | null;
  safeSummary: string | null;
  safeError: ChannelLiveSafeError | Record<string, unknown> | null;
  counts: Record<string, unknown>;
  items: Array<{
    id: string;
    category: ChannelReconciliationCategory;
    severity: ChannelReconciliationSeverity;
    repairability: ChannelReconciliationRepairability;
    status: ChannelReconciliationItemStatus;
    externalIdentityHash: string | null;
    bookingOpsRecordId: string | null;
    propertyId: string | null;
    safeBefore: Record<string, unknown>;
    safeAfter: Record<string, unknown>;
    deterministicActionKey: string;
    safeMessage: string | null;
    appliedAt: string | null;
  }>;
  repairableCount: number;
  blockerCount: number;
  nextAction: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function isIsoTimestamp(value: unknown): boolean {
  const raw = text(value);
  if (!raw) return false;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed);
}

function stableJsonValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonValue(item)).join(',')}]`;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonValue(row[key])}`).join(',')}}`;
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export function hashExternalIdentity(externalBookingId: string): string {
  return sha256Hex(text(externalBookingId)).slice(0, 32);
}

/** In-memory lookup only — never persist this raw key in recon records. */
function dayLookupKey(externalObjectId: string, date: string): string {
  return `${externalObjectId}\0${date}`;
}

function calendarEntityIdentity(externalObjectId: string, date: string): string {
  return `calendar:${hashExternalIdentity(externalObjectId)}:${date}`;
}

function pricingEntityIdentity(externalObjectId: string, date: string): string {
  return `pricing:${hashExternalIdentity(externalObjectId)}:${date}`;
}

function parseHashedDayEntityIdentity(
  kind: 'calendar' | 'pricing',
  entityIdentity: string,
): { objectHash: string; date: string } | null {
  const match = entityIdentity.match(
    kind === 'calendar'
      ? /^calendar:([a-f0-9]{32}):(\d{4}-\d{2}-\d{2})$/
      : /^pricing:([a-f0-9]{32}):(\d{4}-\d{2}-\d{2})$/,
  );
  if (!match) return null;
  return { objectHash: match[1], date: match[2] };
}

function findSnapshotDayByObjectHash<T extends { externalObjectId: string; date: string }>(
  days: T[],
  objectHash: string,
  date: string,
): T | null {
  for (const day of days) {
    if (day.date === date && hashExternalIdentity(day.externalObjectId) === objectHash) {
      return day;
    }
  }
  return null;
}

function bookingToImportRow(booking: ChannelLiveExternalBooking): Record<string, unknown> {
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

function calendarToImportRow(day: ChannelLiveCalendarDay): Record<string, unknown> {
  return {
    external_object_id: day.externalObjectId,
    date: day.date,
    availability_status: day.availabilityStatus ?? 'unknown',
    min_stay: day.minStay ?? null,
    price_amount: day.priceAmount ?? null,
    currency: day.currency ?? null,
  };
}

function dedupeByKey<T>(items: T[], keyOf: (item: T) => string, label: string): T[] {
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

function safeBookingFields(input: {
  status?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  guestCount?: number | null;
  externalIdentityHash?: string | null;
}): Record<string, unknown> {
  return {
    status: input.status ?? null,
    checkInDate: input.checkInDate ?? null,
    checkOutDate: input.checkOutDate ?? null,
    guestCount: input.guestCount ?? null,
    externalIdentityHash: input.externalIdentityHash ?? null,
  };
}

function mapRunRow(row: Record<string, unknown>): ChannelReconciliationRunRow {
  return {
    id: text(row.id),
    connectionId: text(row.connection_id),
    provider: text(row.provider),
    mode: text(row.mode) as ChannelReconciliationRunMode,
    status: text(row.status) as ChannelReconciliationRunStatus,
    snapshotKind: text(row.snapshot_kind) as 'complete' | 'bounded',
    snapshotHash: text(row.snapshot_hash),
    reportHash: text(row.report_hash),
    committedCursorHashAtPreview: nullableText(row.committed_cursor_hash_at_preview),
    startedAt: nullableText(row.started_at),
    finishedAt: nullableText(row.finished_at),
    safeSummary: nullableText(row.safe_summary),
    safeError: (row.safe_error as Record<string, unknown>) ?? {},
    counts: (row.counts as Record<string, unknown>) ?? {},
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapItemRow(row: Record<string, unknown>): ChannelReconciliationItemRow {
  const safeAfter = (row.safe_after as Record<string, unknown>) ?? {};
  const safeBefore = (row.safe_before as Record<string, unknown>) ?? {};
  return {
    id: text(row.id),
    reconciliationRunId: text(row.reconciliation_run_id),
    connectionId: text(row.connection_id),
    category: text(row.category) as ChannelReconciliationCategory,
    severity: text(row.severity) as ChannelReconciliationSeverity,
    repairability: text(row.repairability) as ChannelReconciliationRepairability,
    status: text(row.status) as ChannelReconciliationItemStatus,
    externalIdentityHash: nullableText(row.external_identity_hash),
    importedBookingId: nullableText(row.imported_booking_id),
    bookingOpsRecordId: nullableText(row.booking_ops_record_id),
    propertyId: nullableText(row.property_id),
    safeBefore,
    safeAfter,
    deterministicActionKey: text(row.deterministic_action_key),
    safeMessage: nullableText(row.safe_message),
    appliedAt: nullableText(row.applied_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    entityIdentity: text(safeAfter.entityIdentity) || text(safeBefore.entityIdentity) || text(row.deterministic_action_key),
  };
}

async function requireConnection(connectionId: string): Promise<ChannelManagerConnection> {
  const connection = await getChannelManagerConnectionStatus({ connectionId });
  if (!connection) throw new Error('Подключение Channel Manager не найдено.');
  return connection;
}

async function requireSuccessfulInitialSync(connectionId: string): Promise<string> {
  const runs = await listChannelImportRuns(connectionId);
  const success = runs.find((run) => (
    run.importType === 'initial_sync'
    && ['completed', 'completed_with_warnings'].includes(run.status)
  ));
  if (!success) {
    throw Object.assign(
      new Error('Сверка доступна только после успешного Initial Sync.'),
      { code: 'initial_sync_required' },
    );
  }
  return success.id;
}

function isCalendarPricingRow(row: Record<string, unknown>): boolean {
  const raw = row.raw_snapshot;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return text((raw as Record<string, unknown>).snapshot_kind) === 'pricing';
}

function internalStatus(record: Record<string, unknown>): string {
  return text(record.normalized_status || record.ops_status).toLowerCase();
}

function isCancelledStatus(status: string): boolean {
  return status === 'cancelled' || status === 'canceled';
}

/** Explicit safe status-drift mappings only — no invented status system. */
function resolveStatusDriftRepair(
  intended: NormalizedExternalBookingStatus | string,
  currentInternalStatus: string,
): 'cancel' | 'restore' | 'unsupported' {
  const intendedStatus = normalizeExternalBookingStatus(intended);
  if (intendedStatus === 'cancelled' && !isCancelledStatus(currentInternalStatus)) {
    return 'cancel';
  }
  if (
    (intendedStatus === 'restored' || intendedStatus === 'confirmed' || intendedStatus === 'new')
    && isCancelledStatus(currentInternalStatus)
  ) {
    return 'restore';
  }
  return 'unsupported';
}

function intendedStatusFromItem(item: ChannelReconciliationItemRow): string {
  const fromAfter = nullableText(item.safeAfter.status);
  if (fromAfter) return fromAfter;
  const intended = text(item.safeAfter.safeIntendedState) || '';
  if (intended.startsWith('status:')) return intended.slice('status:'.length);
  // Recovered from persisted safe_after.safeIntendedState when entity helpers rehydrate.
  return '';
}

// ---------------------------------------------------------------------------
// Snapshot validation + hashes
// ---------------------------------------------------------------------------

export function validateChannelReconciliationSnapshot(raw: unknown): ChannelReconciliationSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Нужен нормализованный reconciliation snapshot JSON.');
  }
  if (findSecretPath(raw)) {
    throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в сверке.');
  }
  const size = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (size > MAX_RECONCILIATION_SNAPSHOT_BYTES) {
    throw new Error(
      `Снимок сверки слишком большой. Максимальный размер — ${MAX_RECONCILIATION_SNAPSHOT_BYTES} байт.`,
    );
  }

  const row = raw as Record<string, unknown>;
  const snapshotKind = text(row.snapshotKind ?? row.snapshot_kind).toLowerCase();
  if (snapshotKind !== 'complete' && snapshotKind !== 'bounded') {
    throw new Error('snapshotKind должен быть complete или bounded.');
  }
  const asOf = text(row.asOf ?? row.as_of);
  if (!asOf || !isIsoTimestamp(asOf)) {
    throw new Error('asOf обязателен и должен быть ISO-датой.');
  }

  const bookingsRaw = Array.isArray(row.bookings) ? row.bookings as Array<Record<string, unknown>> : [];
  const calendarRaw = Array.isArray(row.calendar) ? row.calendar as Array<Record<string, unknown>> : [];
  const pricingRaw = Array.isArray(row.pricing) ? row.pricing as Array<Record<string, unknown>> : [];
  if (
    bookingsRaw.length > MAX_RECONCILIATION_SNAPSHOT_ROWS
    || calendarRaw.length > MAX_RECONCILIATION_SNAPSHOT_ROWS
    || pricingRaw.length > MAX_RECONCILIATION_SNAPSHOT_ROWS
  ) {
    throw new Error(
      `В одном разделе снимка сверки должно быть не более ${MAX_RECONCILIATION_SNAPSHOT_ROWS} строк.`,
    );
  }

  let providerCursor: ChannelReconciliationSnapshot['providerCursor'] = null;
  const cursorRaw = row.providerCursor ?? row.provider_cursor;
  if (cursorRaw != null) {
    const validated = validateChannelLiveProviderCursor(cursorRaw, { requiredCheckpoint: true });
    if (!validated || validated.stream !== 'incremental' || !validated.checkpoint) {
      throw new Error('providerCursor должен иметь stream=incremental и checkpoint.');
    }
    providerCursor = { stream: 'incremental', checkpoint: validated.checkpoint };
  }

  const bookings = dedupeByKey(
    bookingsRaw.map((item) => {
      const status = normalizeExternalBookingStatus(item.status);
      const explicitKind = text(item.changeKind ?? item.change_kind).toLowerCase();
      const changeKind = (
        ['created', 'updated', 'cancelled', 'restored', 'unchanged'] as const
      ).includes(explicitKind as ChannelLiveExternalBooking['changeKind'])
        ? explicitKind as ChannelLiveExternalBooking['changeKind']
        : classifyBookingChange(nullableText(item.previous_status ?? item.previousStatus), status);
      return {
        externalBookingId: text(item.external_booking_id ?? item.externalBookingId ?? item.id),
        externalObjectId: nullableText(item.external_object_id ?? item.externalObjectId),
        guestSafeName: nullableText(item.guest_safe_name ?? item.guestName),
        guestContactRef: nullableText(item.guest_contact_ref ?? item.guestContactRef),
        checkInDate: normalizeDate(item.checkin_date ?? item.checkInDate ?? item.checkIn),
        checkOutDate: normalizeDate(item.checkout_date ?? item.checkOutDate ?? item.checkOut),
        guestCount: numberOrNull(item.guest_count ?? item.guestCount),
        status,
        changeKind,
      };
    }).filter((item) => item.externalBookingId),
    (item) => item.externalBookingId,
    'bookings',
  );

  const calendar = dedupeByKey(
    calendarRaw.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status ?? item.availability) || 'unknown',
      minStay: numberOrNull(item.min_stay ?? item.minStay),
      priceAmount: numberOrNull(item.price_amount ?? item.price),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date),
    (item) => dayLookupKey(item.externalObjectId, item.date),
    'calendar',
  );

  const pricing = dedupeByKey(
    pricingRaw.map((item) => ({
      externalObjectId: text(item.external_object_id ?? item.externalObjectId ?? item.object_id),
      date: normalizeDate(item.date) ?? '',
      availabilityStatus: text(item.availability_status ?? item.availability) || 'unknown',
      minStay: numberOrNull(item.min_stay ?? item.minStay),
      priceAmount: numberOrNull(item.price_amount ?? item.price),
      currency: nullableText(item.currency),
    })).filter((item) => item.externalObjectId && item.date),
    (item) => dayLookupKey(item.externalObjectId, item.date),
    'pricing',
  );

  return {
    snapshotKind: snapshotKind as 'complete' | 'bounded',
    asOf: new Date(asOf).toISOString(),
    providerCursor,
    bookings,
    calendar,
    pricing,
  };
}

export function computeReconciliationSnapshotHash(snapshot: ChannelReconciliationSnapshot): string {
  const cursorHash = snapshot.providerCursor?.checkpoint
    ? hashCursorCheckpoint(snapshot.providerCursor.checkpoint)
    : null;
  const bookings = [...snapshot.bookings]
    .map((item) => ({
      changeKind: item.changeKind,
      checkInDate: item.checkInDate ?? null,
      checkOutDate: item.checkOutDate ?? null,
      externalBookingId: item.externalBookingId,
      externalObjectId: item.externalObjectId ?? null,
      guestCount: item.guestCount ?? null,
      status: item.status,
    }))
    .sort((a, b) => a.externalBookingId.localeCompare(b.externalBookingId));
  const calendar = [...snapshot.calendar]
    .map((item) => ({
      availabilityStatus: item.availabilityStatus ?? null,
      currency: item.currency ?? null,
      date: item.date,
      externalObjectId: item.externalObjectId,
      minStay: item.minStay ?? null,
      priceAmount: item.priceAmount ?? null,
    }))
    .sort((a, b) => dayLookupKey(a.externalObjectId, a.date).localeCompare(dayLookupKey(b.externalObjectId, b.date)));
  const pricing = [...snapshot.pricing]
    .map((item) => ({
      availabilityStatus: item.availabilityStatus ?? null,
      currency: item.currency ?? null,
      date: item.date,
      externalObjectId: item.externalObjectId,
      minStay: item.minStay ?? null,
      priceAmount: item.priceAmount ?? null,
    }))
    .sort((a, b) => dayLookupKey(a.externalObjectId, a.date).localeCompare(dayLookupKey(b.externalObjectId, b.date)));
  return sha256Hex(stableJsonValue({
    asOf: snapshot.asOf,
    bookings,
    calendar,
    cursorHash,
    pricing,
    snapshotKind: snapshot.snapshotKind,
  }));
}

export function computeReconciliationReportHash(input: {
  snapshotHash: string;
  cursorHash: string | null;
  items: Array<{
    category: string;
    severity: string;
    repairability: string;
    entityIdentity: string;
    safeIntendedState: string;
  }>;
}): string {
  const items = [...input.items]
    .map((item) => ({
      category: item.category,
      entityIdentity: item.entityIdentity,
      repairability: item.repairability,
      safeIntendedState: item.safeIntendedState,
      severity: item.severity,
    }))
    .sort((a, b) => (
      `${a.category}\0${a.entityIdentity}\0${a.safeIntendedState}`
        .localeCompare(`${b.category}\0${b.entityIdentity}\0${b.safeIntendedState}`)
    ));
  return sha256Hex(stableJsonValue({
    cursorHash: input.cursorHash,
    items,
    snapshotHash: input.snapshotHash,
  }));
}

export function computeReconciliationActionKey(input: {
  connectionId: string;
  reportHash: string;
  category: string;
  entityIdentity: string;
  safeIntendedState: string;
}): string {
  return sha256Hex(stableJsonValue({
    category: input.category,
    connectionId: input.connectionId,
    entityIdentity: input.entityIdentity,
    reportHash: input.reportHash,
    safeIntendedState: input.safeIntendedState,
  }));
}

// ---------------------------------------------------------------------------
// Analyzer (pure)
// ---------------------------------------------------------------------------

function buildDriftItem(input: {
  connectionId: string;
  reportHashPlaceholder: string;
  category: ChannelReconciliationCategory;
  severity: ChannelReconciliationSeverity;
  repairability: ChannelReconciliationRepairability;
  entityIdentity: string;
  safeIntendedState: string;
  safeMessage: string;
  externalIdentityHash?: string | null;
  importedBookingId?: string | null;
  bookingOpsRecordId?: string | null;
  propertyId?: string | null;
  safeBefore?: Record<string, unknown>;
  safeAfter?: Record<string, unknown>;
  status?: ChannelReconciliationItemStatus;
}): ChannelReconciliationDriftItem {
  const deterministicActionKey = computeReconciliationActionKey({
    connectionId: input.connectionId,
    reportHash: input.reportHashPlaceholder,
    category: input.category,
    entityIdentity: input.entityIdentity,
    safeIntendedState: input.safeIntendedState,
  });
  return {
    category: input.category,
    severity: input.severity,
    repairability: input.repairability,
    status: input.status ?? (input.repairability === 'safe_auto' ? 'planned' : 'detected'),
    externalIdentityHash: input.externalIdentityHash ?? null,
    importedBookingId: input.importedBookingId ?? null,
    bookingOpsRecordId: input.bookingOpsRecordId ?? null,
    propertyId: input.propertyId ?? null,
    safeBefore: input.safeBefore ?? {},
    safeAfter: input.safeAfter ?? {},
    deterministicActionKey,
    safeMessage: input.safeMessage,
    entityIdentity: input.entityIdentity,
    safeIntendedState: input.safeIntendedState,
  };
}

export function analyzeChannelReconciliationDrift(input: {
  connectionId: string;
  snapshot: ChannelReconciliationSnapshot;
  importedBookings: Record<string, unknown>[];
  bookingOpsRecords: Record<string, unknown>[];
  calendarRows: Record<string, unknown>[];
  recentImportRuns: ChannelImportRun[];
  liveSyncLease: Record<string, unknown> | null;
  committedCursor: ChannelLiveCommittedCursor | null;
  scope: { accountId: string; propertyId: string };
  nowMs: number;
  snapshotHash: string;
  cursorHashAtPreview: string | null;
}): ChannelReconciliationDriftItem[] {
  const reportHashPlaceholder = input.snapshotHash;
  const items: ChannelReconciliationDriftItem[] = [];
  const push = (partial: Omit<Parameters<typeof buildDriftItem>[0], 'connectionId' | 'reportHashPlaceholder'>) => {
    items.push(buildDriftItem({
      connectionId: input.connectionId,
      reportHashPlaceholder,
      ...partial,
    }));
  };

  const importedByExternal = new Map<string, Record<string, unknown>>();
  for (const row of input.importedBookings) {
    const externalId = text(row.external_booking_id);
    if (externalId) importedByExternal.set(externalId, row);
  }

  const opsById = new Map<string, Record<string, unknown>>();
  const opsByBookingId = new Map<string, Record<string, unknown>[]>();
  for (const record of input.bookingOpsRecords) {
    const id = text(record.id);
    if (id) opsById.set(id, record);
    const bookingId = text(record.booking_id);
    if (!bookingId) continue;
    const list = opsByBookingId.get(bookingId) ?? [];
    list.push(record);
    opsByBookingId.set(bookingId, list);
  }

  const snapshotExternalIds = new Set(input.snapshot.bookings.map((b) => b.externalBookingId));

  for (const booking of input.snapshot.bookings) {
    const extHash = hashExternalIdentity(booking.externalBookingId);
    const imported = importedByExternal.get(booking.externalBookingId) ?? null;
    const byRef = opsByBookingId.get(booking.externalBookingId) ?? [];
    const matchedId = imported ? nullableText(imported.matched_booking_id) : null;
    const matchedRecord = matchedId ? opsById.get(matchedId) ?? null : null;

    if (matchedId && !matchedRecord) {
      push({
        category: 'invalid_booking_match',
        severity: 'blocker',
        repairability: 'operator_review',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: 'clear_or_repair_match',
        safeMessage: 'Сопоставление брони указывает вне контура объекта. Нужна проверка оператором.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: matchedId,
        propertyId: input.scope.propertyId,
        safeBefore: { matchStatus: imported ? text(imported.match_status) : null, matchedPresentInScope: false },
        safeAfter: { matchStatus: 'unmatched' },
      });
      continue;
    }

    if (byRef.length > 1) {
      push({
        category: 'duplicate_internal_booking',
        severity: 'blocker',
        repairability: 'operator_review',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: 'operator_dedupe',
        safeMessage: 'Найдено несколько внутренних броней с одним внешним ID. Автоисправление недоступно.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: text(byRef[0]?.id) || null,
        propertyId: input.scope.propertyId,
        safeBefore: { duplicateCount: byRef.length },
        safeAfter: {},
      });
      continue;
    }

    const internal = matchedRecord ?? byRef[0] ?? null;
    if (!internal) {
      push({
        category: 'booking_missing_internal',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: `create:${booking.status}:${booking.checkInDate ?? ''}:${booking.checkOutDate ?? ''}:${booking.guestCount ?? ''}`,
        safeMessage: 'Бронь есть во внешнем снимке, но отсутствует внутри ASI. Можно создать безопасно.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        propertyId: input.scope.propertyId,
        safeBefore: {},
        safeAfter: safeBookingFields({
          status: booking.status,
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          guestCount: booking.guestCount,
          externalIdentityHash: extHash,
        }),
      });
      continue;
    }

    // Exact single match repair opportunity when imported unmatched but one scoped ops exists
    if (imported && !nullableText(imported.matched_booking_id) && byRef.length === 1) {
      push({
        category: 'booking_field_drift',
        severity: 'info',
        repairability: 'safe_auto',
        entityIdentity: `match:${extHash}`,
        safeIntendedState: `match:${text(internal.id)}`,
        safeMessage: 'Найдено точное сопоставление в контуре. Можно проставить matched_booking_id.',
        externalIdentityHash: extHash,
        importedBookingId: text(imported.id),
        bookingOpsRecordId: text(internal.id),
        propertyId: input.scope.propertyId,
        safeBefore: { matchStatus: text(imported.match_status) },
        safeAfter: { matchStatus: 'matched', bookingOpsRecordId: text(internal.id) },
      });
    }

    const curStatus = internalStatus(internal);
    const extStatus = booking.status;
    const curCheckIn = internal.check_in_at ? String(internal.check_in_at).slice(0, 10) : null;
    const curCheckOut = internal.check_out_at ? String(internal.check_out_at).slice(0, 10) : null;
    const curGuestCount = numberOrNull(internal.guest_count);

    if (extStatus === 'cancelled' && !isCancelledStatus(curStatus)) {
      push({
        category: 'booking_cancel_missed',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: 'cancel',
        safeMessage: 'Внешняя бронь отменена, внутри ASI отмена ещё не применена.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: text(internal.id),
        propertyId: input.scope.propertyId,
        safeBefore: safeBookingFields({
          status: curStatus,
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
        safeAfter: safeBookingFields({
          status: 'cancelled',
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
      });
      continue;
    }

    if (
      (extStatus === 'restored' || (isCancelledStatus(curStatus) && extStatus !== 'cancelled' && extStatus !== 'unknown'))
      && isCancelledStatus(curStatus)
    ) {
      push({
        category: 'booking_restore_missed',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: `restore:${booking.checkInDate ?? curCheckIn ?? ''}:${booking.checkOutDate ?? curCheckOut ?? ''}`,
        safeMessage: 'Внешняя бронь активна, а внутри ASI она отменена. Можно восстановить с проверкой доступности.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: text(internal.id),
        propertyId: input.scope.propertyId,
        safeBefore: safeBookingFields({
          status: curStatus,
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
        safeAfter: safeBookingFields({
          status: extStatus === 'restored' ? 'confirmed' : extStatus,
          checkInDate: booking.checkInDate ?? curCheckIn,
          checkOutDate: booking.checkOutDate ?? curCheckOut,
          guestCount: booking.guestCount ?? curGuestCount,
          externalIdentityHash: extHash,
        }),
      });
      continue;
    }

    const statusDrift = normalizeExternalBookingStatus(curStatus) !== extStatus
      && !(extStatus === 'confirmed' && !isCancelledStatus(curStatus))
      && !(extStatus === 'new' && !isCancelledStatus(curStatus))
      && !(extStatus === 'modified' && !isCancelledStatus(curStatus))
      && !(extStatus === 'restored' && !isCancelledStatus(curStatus));

    // Narrow status drift: only meaningful mismatches not covered above
    const normalizedInternal: NormalizedExternalBookingStatus = isCancelledStatus(curStatus)
      ? 'cancelled'
      : normalizeExternalBookingStatus(curStatus);
    const meaningfulStatusDrift = (
      (extStatus === 'cancelled') !== (normalizedInternal === 'cancelled')
    ) || (
      extStatus !== 'unknown'
      && normalizedInternal !== 'unknown'
      && extStatus !== normalizedInternal
      && !(extStatus === 'modified' && normalizedInternal !== 'cancelled')
      && !(extStatus === 'confirmed' && normalizedInternal === 'new')
      && !(extStatus === 'new' && normalizedInternal === 'confirmed')
      && !(extStatus === 'restored' && normalizedInternal === 'confirmed')
    );

    const datesDrift = Boolean(
      (booking.checkInDate && booking.checkInDate !== curCheckIn)
      || (booking.checkOutDate && booking.checkOutDate !== curCheckOut),
    );
    const guestCountDrift = booking.guestCount != null && booking.guestCount !== curGuestCount;

    if (meaningfulStatusDrift && statusDrift) {
      const intended = extStatus;
      const statusRepair = resolveStatusDriftRepair(intended, curStatus);
      push({
        category: 'booking_status_drift',
        severity: statusRepair === 'unsupported' ? 'blocker' : 'warning',
        repairability: statusRepair === 'unsupported' ? 'operator_review' : 'safe_auto',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: `status:${extStatus}`,
        safeMessage: statusRepair === 'unsupported'
          ? 'Статус брони отличается, но безопасного автоисправления нет. Нужна проверка оператором.'
          : 'Статус брони во внешнем снимке отличается от внутреннего.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: text(internal.id),
        propertyId: input.scope.propertyId,
        safeBefore: safeBookingFields({
          status: curStatus,
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
        safeAfter: safeBookingFields({
          status: extStatus,
          checkInDate: booking.checkInDate ?? curCheckIn,
          checkOutDate: booking.checkOutDate ?? curCheckOut,
          guestCount: booking.guestCount ?? curGuestCount,
          externalIdentityHash: extHash,
        }),
      });
    } else if (datesDrift || guestCountDrift) {
      push({
        category: 'booking_field_drift',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: `fields:${booking.checkInDate ?? ''}:${booking.checkOutDate ?? ''}:${booking.guestCount ?? ''}`,
        safeMessage: 'Даты или число гостей во внешнем снимке отличаются от ASI.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: text(internal.id),
        propertyId: input.scope.propertyId,
        safeBefore: safeBookingFields({
          status: curStatus,
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
        safeAfter: safeBookingFields({
          status: curStatus,
          checkInDate: booking.checkInDate ?? curCheckIn,
          checkOutDate: booking.checkOutDate ?? curCheckOut,
          guestCount: booking.guestCount ?? curGuestCount,
          externalIdentityHash: extHash,
        }),
      });
    } else {
      push({
        category: 'booking_unchanged',
        severity: 'info',
        repairability: 'unsupported',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: 'unchanged',
        safeMessage: 'Бронь совпадает со снимком. Изменения не нужны.',
        externalIdentityHash: extHash,
        importedBookingId: imported ? text(imported.id) : null,
        bookingOpsRecordId: text(internal.id),
        propertyId: input.scope.propertyId,
        status: 'detected',
        safeBefore: safeBookingFields({
          status: curStatus,
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
        safeAfter: safeBookingFields({
          status: curStatus,
          checkInDate: curCheckIn,
          checkOutDate: curCheckOut,
          guestCount: curGuestCount,
          externalIdentityHash: extHash,
        }),
      });
    }
  }

  // Cross-account invalid matches: imported matched_booking_id outside scope
  for (const imported of input.importedBookings) {
    const matchedId = nullableText(imported.matched_booking_id);
    if (!matchedId) continue;
    if (opsById.has(matchedId)) continue;
    const externalId = text(imported.external_booking_id);
    if (!externalId || !snapshotExternalIds.has(externalId)) continue;
    // Already emitted above when processing snapshot booking without matchedRecord
  }

  if (input.snapshot.snapshotKind === 'complete') {
    for (const record of input.bookingOpsRecords) {
      const bookingId = text(record.booking_id);
      if (!bookingId || snapshotExternalIds.has(bookingId)) continue;
      // Only report channel-linked records (have booking_id that looks like external id present in imports)
      const linkedImport = input.importedBookings.find((row) => text(row.matched_booking_id) === text(record.id));
      if (!linkedImport && !importedByExternal.has(bookingId)) continue;
      const extHash = hashExternalIdentity(bookingId);
      push({
        category: 'booking_missing_external',
        severity: 'warning',
        repairability: 'unsupported',
        entityIdentity: `booking:${extHash}`,
        safeIntendedState: 'no_auto_cancel',
        safeMessage: 'Бронь есть в ASI, но отсутствует в полном внешнем снимке. Автоотмена запрещена.',
        externalIdentityHash: extHash,
        importedBookingId: linkedImport ? text(linkedImport.id) : null,
        bookingOpsRecordId: text(record.id),
        propertyId: input.scope.propertyId,
        status: 'detected',
        safeBefore: safeBookingFields({
          status: internalStatus(record),
          checkInDate: record.check_in_at ? String(record.check_in_at).slice(0, 10) : null,
          checkOutDate: record.check_out_at ? String(record.check_out_at).slice(0, 10) : null,
          guestCount: numberOrNull(record.guest_count),
          externalIdentityHash: extHash,
        }),
        safeAfter: {},
      });
    }
  }

  // Calendar / pricing
  const calendarInternal = new Map<string, Record<string, unknown>>();
  const pricingInternal = new Map<string, Record<string, unknown>>();
  for (const row of input.calendarRows) {
    const key = dayLookupKey(text(row.external_object_id), text(row.date));
    if (!key.includes('\0') || key.startsWith('\0') || key.endsWith('\0')) continue;
    if (isCalendarPricingRow(row)) pricingInternal.set(key, row);
    else calendarInternal.set(key, row);
  }

  for (const day of input.snapshot.calendar) {
    const lookupKey = dayLookupKey(day.externalObjectId, day.date);
    const objectHash = hashExternalIdentity(day.externalObjectId);
    const entityIdentity = calendarEntityIdentity(day.externalObjectId, day.date);
    const internal = calendarInternal.get(lookupKey);
    if (!internal) {
      push({
        category: 'calendar_day_missing_internal',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity,
        safeIntendedState: `upsert:${day.availabilityStatus ?? 'unknown'}`,
        safeMessage: 'День календаря отсутствует внутри ASI. Можно добавить.',
        externalIdentityHash: objectHash,
        propertyId: input.scope.propertyId,
        safeBefore: {},
        safeAfter: {
          externalObjectIdHash: objectHash,
          date: day.date,
          availabilityStatus: day.availabilityStatus ?? null,
        },
      });
      continue;
    }
    const curAvail = text(internal.availability_status) || 'unknown';
    const nextAvail = text(day.availabilityStatus) || 'unknown';
    if (curAvail !== nextAvail) {
      push({
        category: 'calendar_availability_drift',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity,
        safeIntendedState: `availability:${nextAvail}`,
        safeMessage: 'Доступность дня календаря отличается от внешнего снимка.',
        externalIdentityHash: objectHash,
        propertyId: input.scope.propertyId,
        safeBefore: { date: day.date, availabilityStatus: curAvail, externalObjectIdHash: objectHash },
        safeAfter: { date: day.date, availabilityStatus: nextAvail, externalObjectIdHash: objectHash },
      });
    }
  }

  for (const day of input.snapshot.pricing) {
    const lookupKey = dayLookupKey(day.externalObjectId, day.date);
    const objectHash = hashExternalIdentity(day.externalObjectId);
    const entityIdentity = pricingEntityIdentity(day.externalObjectId, day.date);
    const internal = pricingInternal.get(lookupKey) ?? calendarInternal.get(lookupKey);
    if (!internal || (pricingInternal.size > 0 && !pricingInternal.has(lookupKey) && numberOrNull(internal.price_amount) == null)) {
      push({
        category: 'pricing_missing_internal',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity,
        safeIntendedState: `upsert:${day.priceAmount ?? ''}:${day.currency ?? ''}`,
        safeMessage: 'Цена за день отсутствует внутри ASI. Можно добавить.',
        externalIdentityHash: objectHash,
        propertyId: input.scope.propertyId,
        safeBefore: {},
        safeAfter: {
          date: day.date,
          priceAmount: day.priceAmount ?? null,
          currency: day.currency ?? null,
          externalObjectIdHash: objectHash,
        },
      });
      continue;
    }
    const curPrice = numberOrNull(internal.price_amount);
    const curCurrency = nullableText(internal.currency);
    if (
      (day.priceAmount != null && day.priceAmount !== curPrice)
      || (day.currency != null && day.currency !== curCurrency)
    ) {
      push({
        category: 'pricing_value_drift',
        severity: 'warning',
        repairability: 'safe_auto',
        entityIdentity,
        safeIntendedState: `price:${day.priceAmount ?? ''}:${day.currency ?? ''}`,
        safeMessage: 'Цена за день отличается от внешнего снимка.',
        externalIdentityHash: objectHash,
        propertyId: input.scope.propertyId,
        safeBefore: {
          date: day.date,
          priceAmount: curPrice,
          currency: curCurrency,
          externalObjectIdHash: objectHash,
        },
        safeAfter: {
          date: day.date,
          priceAmount: day.priceAmount ?? null,
          currency: day.currency ?? null,
          externalObjectIdHash: objectHash,
        },
      });
    }
  }

  if (input.snapshot.snapshotKind === 'complete') {
    const snapCal = new Set(input.snapshot.calendar.map((d) => dayLookupKey(d.externalObjectId, d.date)));
    const snapPrice = new Set(input.snapshot.pricing.map((d) => dayLookupKey(d.externalObjectId, d.date)));
    for (const [key, row] of calendarInternal) {
      if (snapCal.has(key)) continue;
      const objectId = text(row.external_object_id);
      const date = text(row.date);
      const objectHash = hashExternalIdentity(objectId);
      push({
        category: 'calendar_orphan_internal_day',
        severity: 'info',
        repairability: 'unsupported',
        entityIdentity: calendarEntityIdentity(objectId, date),
        safeIntendedState: 'no_delete',
        safeMessage: 'День календаря есть в ASI, но отсутствует в полном снимке. Удаление запрещено.',
        externalIdentityHash: objectHash,
        propertyId: input.scope.propertyId,
        status: 'detected',
        safeBefore: { present: true, date, externalObjectIdHash: objectHash },
        safeAfter: {},
      });
    }
    for (const [key, row] of pricingInternal) {
      if (snapPrice.has(key)) continue;
      const objectId = text(row.external_object_id);
      const date = text(row.date);
      const objectHash = hashExternalIdentity(objectId);
      push({
        category: 'pricing_orphan_internal_day',
        severity: 'info',
        repairability: 'unsupported',
        entityIdentity: pricingEntityIdentity(objectId, date),
        safeIntendedState: 'no_delete',
        safeMessage: 'Цена есть в ASI, но отсутствует в полном снимке. Удаление запрещено.',
        externalIdentityHash: objectHash,
        propertyId: input.scope.propertyId,
        status: 'detected',
        safeBefore: { present: true, date, externalObjectIdHash: objectHash },
        safeAfter: {},
      });
    }
  }

  // Run / cursor / lease
  const liveRuns = input.recentImportRuns.filter((run) => (
    ['initial_sync', 'incremental_sync', 'reconciliation_recovery'].includes(run.importType)
  ));
  for (const run of liveRuns) {
    if (run.status === 'running') {
      const startedAt = Date.parse(run.startedAt || run.createdAt || '');
      if (Number.isFinite(startedAt) && input.nowMs - startedAt >= STALE_LIVE_SYNC_TIMEOUT_MS) {
        push({
          category: 'stale_running_sync',
          severity: 'warning',
          repairability: 'safe_auto',
          entityIdentity: `run:${run.id}`,
          safeIntendedState: `mark_failed:${run.id}`,
          safeMessage: 'Синхронизация зависла в статусе running. Можно пометить как failed.',
          safeBefore: { runId: run.id, importType: run.importType, status: run.status },
          safeAfter: { status: 'failed' },
        });
      }
    }
    if (run.status === 'failed') {
      const safeError = run.metadata?.safeError as ChannelLiveSafeError | undefined;
      if (safeError?.retryable === true) {
        push({
          category: 'failed_retryable_sync',
          severity: 'info',
          repairability: 'operator_review',
          entityIdentity: `run:${run.id}`,
          safeIntendedState: 'retry_manual',
          safeMessage: 'Последняя синхронизация завершилась ошибкой и может быть повторена.',
          status: 'detected',
          safeBefore: { runId: run.id, importType: run.importType },
          safeAfter: {},
        });
      }
    }
    if (['completed_with_warnings', 'completed_with_blockers'].includes(run.status)) {
      push({
        category: 'partial_sync_detected',
        severity: 'warning',
        repairability: 'operator_review',
        entityIdentity: `run:${run.id}`,
        safeIntendedState: 'review_partial',
        safeMessage: 'Обнаружена частичная синхронизация. Проверьте предупреждения.',
        status: 'detected',
        safeBefore: { runId: run.id, status: run.status },
        safeAfter: {},
      });
    }
  }

  const lease = input.liveSyncLease;
  if (lease && text(lease.status) === 'held') {
    const leaseRunId = text(lease.runId);
    const matching = liveRuns.find((run) => run.id === leaseRunId && run.status === 'running');
    if (leaseRunId && !matching) {
      push({
        category: 'lease_run_mismatch',
        severity: 'warning',
        repairability: 'operator_review',
        entityIdentity: `lease:${leaseRunId}`,
        safeIntendedState: `review_lease:${leaseRunId}`,
        safeMessage: 'Блокировка sync указывает на несуществующий running-запуск. Нужна проверка оператором — автоснятие запрещено.',
        status: 'detected',
        safeBefore: { leaseRunId, leaseStatus: text(lease.status) },
        safeAfter: {},
      });
    }
  }

  const cursor = input.committedCursor;
  if (cursor) {
    if (!cursor.sourceRunId) {
      push({
        category: 'cursor_missing_source_run',
        severity: 'warning',
        repairability: 'operator_review',
        entityIdentity: 'cursor:committed',
        safeIntendedState: 'review_cursor',
        safeMessage: 'У сохранённого курсора нет sourceRunId. Нужна проверка оператором.',
        status: 'detected',
        safeBefore: {
          cursorHash: hashCursorCheckpoint(cursor.checkpoint),
          updatedAt: cursor.updatedAt || null,
        },
        safeAfter: {},
      });
    } else {
      const sourceRun = input.recentImportRuns.find((run) => run.id === cursor.sourceRunId);
      if (!sourceRun || !['completed', 'completed_with_warnings'].includes(sourceRun.status)) {
        push({
          category: 'cursor_run_status_mismatch',
          severity: 'warning',
          repairability: 'operator_review',
          entityIdentity: `cursor:run:${cursor.sourceRunId}`,
          safeIntendedState: 'review_cursor',
          safeMessage: 'Курсор ссылается на запуск с неожиданным статусом.',
          status: 'detected',
          safeBefore: {
            cursorHash: hashCursorCheckpoint(cursor.checkpoint),
            sourceRunId: cursor.sourceRunId,
            sourceRunStatus: sourceRun?.status ?? null,
          },
          safeAfter: {},
        });
      }
    }
  }

  if (input.snapshot.providerCursor?.checkpoint && cursor?.checkpoint) {
    const snapHash = hashCursorCheckpoint(input.snapshot.providerCursor.checkpoint);
    const committedHash = hashCursorCheckpoint(cursor.checkpoint);
    if (snapHash !== committedHash) {
      push({
        category: 'cursor_checkpoint_difference',
        severity: 'info',
        repairability: 'operator_review',
        entityIdentity: 'cursor:checkpoint',
        safeIntendedState: 'no_cursor_advance',
        safeMessage: 'Хэш курсора снимка отличается от сохранённого. Курсор не будет изменён сверкой.',
        status: 'detected',
        safeBefore: { committedCursorHash: committedHash },
        safeAfter: { snapshotCursorHash: snapHash },
      });
    }
  }

  // Recompute action keys with final report-hash placeholder; caller will rewrite after report hash.
  void input.cursorHashAtPreview;
  return items.sort((a, b) => (
    `${a.category}\0${a.entityIdentity}\0${a.safeIntendedState}`
      .localeCompare(`${b.category}\0${b.entityIdentity}\0${b.safeIntendedState}`)
  ));
}

function rekeyDriftItems(
  connectionId: string,
  reportHash: string,
  items: ChannelReconciliationDriftItem[],
): ChannelReconciliationDriftItem[] {
  return items.map((item) => ({
    ...item,
    deterministicActionKey: computeReconciliationActionKey({
      connectionId,
      reportHash,
      category: item.category,
      entityIdentity: item.entityIdentity,
      safeIntendedState: item.safeIntendedState,
    }),
  }));
}

function summarizeCounts(items: ChannelReconciliationDriftItem[]): Record<string, unknown> {
  const byCategory: Record<string, number> = {};
  let repairable = 0;
  let blockers = 0;
  let warnings = 0;
  let info = 0;
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    if (item.repairability === 'safe_auto') repairable += 1;
    if (item.severity === 'blocker') blockers += 1;
    else if (item.severity === 'warning') warnings += 1;
    else info += 1;
  }
  return {
    total: items.length,
    repairable,
    blockers,
    warnings,
    info,
    byCategory,
  };
}

export function toSafeReconciliationReport(
  run: ChannelReconciliationRunRow,
  items: ChannelReconciliationItemRow[],
  options?: { cursorChangedSincePreview?: boolean | null },
): SafeReconciliationReport {
  const repairableCount = items.filter((item) => item.repairability === 'safe_auto' && !['applied', 'skipped'].includes(item.status)).length;
  const blockerCount = items.filter((item) => item.severity === 'blocker' || item.status === 'blocked').length;
  let nextAction: string | null = null;
  if (run.status === 'preview_ready' && repairableCount > 0) {
    nextAction = 'Подтвердите APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS для безопасных исправлений.';
  } else if (blockerCount > 0) {
    nextAction = 'Есть блокирующие расхождения — нужна проверка оператором.';
  } else if (run.status === 'completed' || run.status === 'completed_with_blockers') {
    nextAction = 'Сверка завершена. Курсор incremental не изменён.';
  }

  return {
    runId: run.id,
    connectionId: run.connectionId,
    mode: run.mode,
    status: run.status,
    snapshotKind: run.snapshotKind,
    snapshotHashPrefix: run.snapshotHash.slice(0, 16),
    reportHashPrefix: run.reportHash.slice(0, 16),
    reportHash: run.reportHash,
    committedCursorHashAtPreview: run.committedCursorHashAtPreview,
    cursorChangedSincePreview: options?.cursorChangedSincePreview ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    safeSummary: run.safeSummary,
    safeError: Object.keys(run.safeError || {}).length ? run.safeError : null,
    counts: run.counts,
    items: items.map((item) => ({
      id: item.id,
      category: item.category,
      severity: item.severity,
      repairability: item.repairability,
      status: item.status,
      externalIdentityHash: item.externalIdentityHash,
      bookingOpsRecordId: item.bookingOpsRecordId,
      propertyId: item.propertyId,
      safeBefore: item.safeBefore,
      safeAfter: item.safeAfter,
      deterministicActionKey: item.deterministicActionKey,
      safeMessage: item.safeMessage,
      appliedAt: item.appliedAt,
    })),
    repairableCount,
    blockerCount,
    nextAction,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadReconciliationRun(runId: string): Promise<ChannelReconciliationRunRow | null> {
  const { data, error } = await supabase
    .from('booking_channel_reconciliation_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRunRow(data as Record<string, unknown>) : null;
}

async function loadReconciliationItems(runId: string): Promise<ChannelReconciliationItemRow[]> {
  const { data, error } = await supabase
    .from('booking_channel_reconciliation_items')
    .select('*')
    .eq('reconciliation_run_id', runId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapItemRow);
}

async function findPreviewRunByReportHash(
  connectionId: string,
  reportHash: string,
): Promise<ChannelReconciliationRunRow | null> {
  const { data, error } = await supabase
    .from('booking_channel_reconciliation_runs')
    .select('*')
    .eq('connection_id', connectionId)
    .eq('report_hash', reportHash)
    .eq('mode', 'preview')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRunRow(data as Record<string, unknown>) : null;
}

function expectedItemKeys(items: Array<{ deterministicActionKey: string }>): string[] {
  return [...items.map((item) => item.deterministicActionKey)].sort();
}

function previewItemsMatchExpected(
  run: ChannelReconciliationRunRow,
  items: ChannelReconciliationItemRow[],
  expectedKeys: string[],
): boolean {
  if (run.status !== 'preview_ready') return false;
  const expectedTotal = Number(run.counts?.total ?? Number.NaN);
  if (!Number.isFinite(expectedTotal) || items.length !== expectedTotal) return false;
  if (expectedKeys.length > 0 && items.length !== expectedKeys.length) return false;
  const actualKeys = expectedItemKeys(items);
  if (actualKeys.length !== expectedKeys.length) return false;
  for (let i = 0; i < expectedKeys.length; i += 1) {
    if (actualKeys[i] !== expectedKeys[i]) return false;
  }
  return true;
}

async function findVerifiedPreviewReadyByReportHash(input: {
  connectionId: string;
  reportHash: string;
  expectedKeys: string[];
}): Promise<{ run: ChannelReconciliationRunRow; items: ChannelReconciliationItemRow[] } | null> {
  const run = await findPreviewRunByReportHash(input.connectionId, input.reportHash);
  if (!run || run.status !== 'preview_ready') return null;
  const items = await loadReconciliationItems(run.id);
  if (!previewItemsMatchExpected(run, items, input.expectedKeys)) return null;
  return { run, items };
}

async function markPreviewRunFailed(
  runId: string,
  message: string,
  statuses: ChannelReconciliationRunStatus[] = ['analyzing', 'failed'],
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_channel_reconciliation_runs').update({
    status: 'failed',
    finished_at: now,
    updated_at: now,
    safe_error: {
      stage: 'preview_persist',
      code: 'preview_persist_incomplete',
      message: redactLiveCoreErrorMessage(message),
    },
    metadata: {
      previewPersistFailed: true,
      previewPersistFailedAt: now,
    },
  }).eq('id', runId).in('status', statuses);
  if (error) throw new Error(error.message);
}

async function deleteReconciliationItemsForRun(runId: string): Promise<void> {
  const { error } = await supabase
    .from('booking_channel_reconciliation_items')
    .delete()
    .eq('reconciliation_run_id', runId);
  if (error) throw new Error(error.message);
}

async function insertPreviewItemRows(input: {
  runId: string;
  connectionId: string;
  items: ChannelReconciliationDriftItem[];
  startedAt: string;
}): Promise<void> {
  if (input.items.length === 0) return;
  const rows = input.items.map((item) => ({
    id: randomUUID(),
    reconciliation_run_id: input.runId,
    connection_id: input.connectionId,
    category: item.category,
    severity: item.severity,
    repairability: item.repairability,
    status: item.status,
    external_identity_hash: item.externalIdentityHash,
    imported_booking_id: item.importedBookingId,
    booking_ops_record_id: item.bookingOpsRecordId,
    property_id: item.propertyId,
    safe_before: { ...item.safeBefore, entityIdentity: item.entityIdentity },
    safe_after: {
      ...item.safeAfter,
      entityIdentity: item.entityIdentity,
      safeIntendedState: item.safeIntendedState,
    },
    deterministic_action_key: item.deterministicActionKey,
    safe_message: item.safeMessage,
    created_at: input.startedAt,
    updated_at: input.startedAt,
  }));
  const { error: insertItemsError } = await supabase
    .from('booking_channel_reconciliation_items')
    .insert(rows);
  if (insertItemsError) throw new Error(insertItemsError.message);
}

async function verifyAndPromotePreviewReady(input: {
  runId: string;
  expectedKeys: string[];
  counts: Record<string, unknown>;
  safeSummary: string;
  metadata: Record<string, unknown>;
}): Promise<ChannelReconciliationRunRow> {
  const persistedItems = await loadReconciliationItems(input.runId);
  const actualKeys = expectedItemKeys(persistedItems);
  if (
    persistedItems.length !== input.expectedKeys.length
    || actualKeys.length !== input.expectedKeys.length
    || actualKeys.some((key, index) => key !== input.expectedKeys[index])
  ) {
    throw new Error('Количество или ключи элементов сверки не совпали после сохранения.');
  }

  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('booking_channel_reconciliation_runs')
    .update({
      status: 'preview_ready',
      finished_at: finishedAt,
      updated_at: finishedAt,
      counts: input.counts,
      safe_summary: input.safeSummary,
      safe_error: {},
      metadata: {
        ...input.metadata,
        previewVerified: true,
        previewItemCount: input.expectedKeys.length,
        previewVerifiedAt: finishedAt,
      },
    })
    .eq('id', input.runId)
    .in('status', ['analyzing', 'failed'])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const raced = await loadReconciliationRun(input.runId);
    if (raced?.status === 'preview_ready') {
      const items = await loadReconciliationItems(input.runId);
      if (previewItemsMatchExpected(raced, items, input.expectedKeys)) return raced;
    }
    throw new Error('Не удалось подтвердить готовность preview-отчёта.');
  }
  return mapRunRow(data as Record<string, unknown>);
}

async function persistPreviewReportStaged(input: {
  connectionId: string;
  provider: string;
  snapshotKind: 'complete' | 'bounded';
  snapshotHash: string;
  reportHash: string;
  cursorHashAtPreview: string | null;
  items: ChannelReconciliationDriftItem[];
  counts: Record<string, unknown>;
  safeSummary: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  runId?: string;
}): Promise<{ run: ChannelReconciliationRunRow; items: ChannelReconciliationItemRow[] }> {
  const expectedKeys = expectedItemKeys(input.items);
  const runId = input.runId ?? randomUUID();

  if (!input.runId) {
    const { error: insertRunError } = await supabase.from('booking_channel_reconciliation_runs').insert({
      id: runId,
      connection_id: input.connectionId,
      provider: input.provider,
      mode: 'preview',
      status: 'analyzing',
      snapshot_kind: input.snapshotKind,
      snapshot_hash: input.snapshotHash,
      report_hash: input.reportHash,
      committed_cursor_hash_at_preview: input.cursorHashAtPreview,
      started_at: input.startedAt,
      finished_at: null,
      safe_summary: input.safeSummary,
      safe_error: {},
      counts: input.counts,
      metadata: {
        ...input.metadata,
        previewPersistStage: 'analyzing',
      },
      created_at: input.startedAt,
      updated_at: input.startedAt,
    });
    if (insertRunError) {
      if (insertRunError.code === '23505') {
        throw Object.assign(new Error(insertRunError.message), { code: '23505' });
      }
      throw new Error(insertRunError.message);
    }
  } else {
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from('booking_channel_reconciliation_runs')
      .update({
        status: 'analyzing',
        started_at: input.startedAt,
        finished_at: null,
        safe_summary: input.safeSummary,
        safe_error: {},
        counts: input.counts,
        metadata: {
          ...input.metadata,
          previewPersistStage: 'analyzing',
          previewRebuildAt: now,
        },
        updated_at: now,
      })
      .eq('id', runId)
      .eq('connection_id', input.connectionId)
      .eq('report_hash', input.reportHash)
      .eq('mode', 'preview')
      .in('status', ['analyzing', 'failed'])
      .select('id')
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) {
      const existing = await findVerifiedPreviewReadyByReportHash({
        connectionId: input.connectionId,
        reportHash: input.reportHash,
        expectedKeys,
      });
      if (existing) return existing;
      throw new Error('Не удалось пересобрать незавершённый preview-отчёт.');
    }
    await deleteReconciliationItemsForRun(runId);
  }

  try {
    await insertPreviewItemRows({
      runId,
      connectionId: input.connectionId,
      items: input.items,
      startedAt: input.startedAt,
    });
    const run = await verifyAndPromotePreviewReady({
      runId,
      expectedKeys,
      counts: input.counts,
      safeSummary: input.safeSummary,
      metadata: input.metadata,
    });
    const persistedItems = await loadReconciliationItems(runId);
    if (!previewItemsMatchExpected(run, persistedItems, expectedKeys)) {
      throw new Error('Проверка preview_ready после сохранения не пройдена.');
    }
    return { run, items: persistedItems };
  } catch (error) {
    try {
      await markPreviewRunFailed(
        runId,
        error instanceof Error ? error.message : 'preview_persist_failed',
      );
    } catch {
      // Prefer surfacing the original persist failure.
    }
    throw error;
  }
}

async function awaitOrRebuildPreviewByReportHash(input: {
  connectionId: string;
  provider: string;
  snapshotKind: 'complete' | 'bounded';
  snapshotHash: string;
  reportHash: string;
  cursorHashAtPreview: string | null;
  items: ChannelReconciliationDriftItem[];
  counts: Record<string, unknown>;
  safeSummary: string;
  metadata: Record<string, unknown>;
  startedAt: string;
}): Promise<{ run: ChannelReconciliationRunRow; items: ChannelReconciliationItemRow[] }> {
  const expectedKeys = expectedItemKeys(input.items);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const verified = await findVerifiedPreviewReadyByReportHash({
      connectionId: input.connectionId,
      reportHash: input.reportHash,
      expectedKeys,
    });
    if (verified) return verified;

    const existing = await findPreviewRunByReportHash(input.connectionId, input.reportHash);
    if (!existing) {
      return persistPreviewReportStaged({ ...input });
    }
    if (existing.status === 'failed') {
      // Incomplete/failed reports must be rebuilt — never returned as ready.
      return persistPreviewReportStaged({ ...input, runId: existing.id });
    }
    if (existing.status === 'analyzing') {
      // Concurrent writer may still be persisting items — wait before taking over.
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 15 + attempt * 10));
        continue;
      }
      return persistPreviewReportStaged({ ...input, runId: existing.id });
    }
    if (existing.status === 'preview_ready') {
      const items = await loadReconciliationItems(existing.id);
      if (previewItemsMatchExpected(existing, items, expectedKeys)) {
        return { run: existing, items };
      }
      // Half-persisted legacy/corrupt preview_ready: fail closed and rebuild.
      await markPreviewRunFailed(existing.id, 'incomplete_preview_ready_rebuilt', ['preview_ready', 'analyzing', 'failed']);
      return persistPreviewReportStaged({ ...input, runId: existing.id });
    }
    await new Promise((resolve) => setTimeout(resolve, 15 + attempt * 10));
  }
  throw new Error('Параллельный preview не сошёлся к одному полному отчёту.');
}

async function loadScopedBookingOps(
  accountId: string,
  propertyId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,unit_id,booking_id,guest_count,check_in_at,check_out_at,normalized_status,ops_status,updated_at')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

async function actionKeyAlreadyApplied(actionKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('booking_channel_reconciliation_items')
    .select('id,status')
    .eq('deterministic_action_key', actionKey)
    .eq('status', 'applied')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Preview engine
// ---------------------------------------------------------------------------

export async function runChannelManagerReconciliationPreview(input: {
  connectionId: string;
  snapshot: unknown;
}): Promise<SafeReconciliationReport> {
  const connection = await requireConnection(input.connectionId);
  const schema = await probeChannelLiveCoreSchema(connection.id);
  if (!schema.reconciliationReady) {
    throw Object.assign(
      new Error(schema.blocker ?? 'Миграция Reconciliation & Recovery ещё не применена.'),
      { code: 'migration_missing' },
    );
  }

  await requireSuccessfulInitialSync(connection.id);
  const scope = await resolveIncrementalConnectionScope(connection);
  if (!scope.accountId || !scope.propertyId) {
    throw Object.assign(
      new Error('Для сверки нужны canonical accountId и propertyId подключения.'),
      { code: 'connection_scope_invalid' },
    );
  }

  const snapshot = validateChannelReconciliationSnapshot(input.snapshot);
  const snapshotHash = computeReconciliationSnapshotHash(snapshot);
  const committed = readCommittedIncrementalCursor(connection.metadata);
  const cursorHashAtPreview = committed?.checkpoint ? hashCursorCheckpoint(committed.checkpoint) : null;

  const [importedBookings, calendarRows, recentImportRuns, bookingOpsRecords] = await Promise.all([
    listImportedChannelBookings(connection.id),
    listChannelCalendarSnapshots(connection.id),
    listChannelImportRuns(connection.id),
    loadScopedBookingOps(scope.accountId, scope.propertyId),
  ]);

  const lease = (connection.metadata?.liveSyncLease as Record<string, unknown> | undefined) ?? null;
  const nowMs = Date.now();

  const draftItems = analyzeChannelReconciliationDrift({
    connectionId: connection.id,
    snapshot,
    importedBookings,
    bookingOpsRecords,
    calendarRows,
    recentImportRuns,
    liveSyncLease: lease,
    committedCursor: committed,
    scope: { accountId: scope.accountId, propertyId: scope.propertyId },
    nowMs,
    snapshotHash,
    cursorHashAtPreview,
  });

  const reportHash = computeReconciliationReportHash({
    snapshotHash,
    cursorHash: cursorHashAtPreview,
    items: draftItems.map((item) => ({
      category: item.category,
      severity: item.severity,
      repairability: item.repairability,
      entityIdentity: item.entityIdentity,
      safeIntendedState: item.safeIntendedState,
    })),
  });

  const existing = await findVerifiedPreviewReadyByReportHash({
    connectionId: connection.id,
    reportHash,
    expectedKeys: expectedItemKeys(rekeyDriftItems(connection.id, reportHash, draftItems)),
  });
  if (existing) {
    return toSafeReconciliationReport(existing.run, existing.items, { cursorChangedSincePreview: false });
  }

  const items = rekeyDriftItems(connection.id, reportHash, draftItems);
  const counts = summarizeCounts(items);
  const startedAt = new Date(nowMs).toISOString();
  const safeSummary = `Сверка (preview): всего ${counts.total}, безопасных исправлений ${counts.repairable}, блокировок ${counts.blockers}. Курсор не изменён.`;

  const metadata = {
    reconciliation: true,
    snapshotKind: snapshot.snapshotKind,
    asOf: snapshot.asOf,
    snapshotHashPrefix: snapshotHash.slice(0, 16),
    reportHashPrefix: reportHash.slice(0, 16),
    cursorHashAtPreview,
    scope: {
      accountId: scope.accountId,
      propertyId: scope.propertyId,
      propertySetupId: scope.propertySetupId,
      ownerSetupId: scope.ownerSetupId,
    },
  };
  if (findSecretPath(metadata)) {
    throw new Error('Пароли, токены и другие секреты нельзя сохранять в сверке.');
  }

  const persistInput = {
    connectionId: connection.id,
    provider: connection.provider,
    snapshotKind: snapshot.snapshotKind,
    snapshotHash,
    reportHash,
    cursorHashAtPreview,
    items,
    counts,
    safeSummary,
    metadata,
    startedAt,
  };

  try {
    const persisted = await persistPreviewReportStaged(persistInput);
    return toSafeReconciliationReport(persisted.run, persisted.items, { cursorChangedSincePreview: false });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      const converged = await awaitOrRebuildPreviewByReportHash(persistInput);
      return toSafeReconciliationReport(converged.run, converged.items, { cursorChangedSincePreview: false });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Apply engine
// ---------------------------------------------------------------------------

async function markItemStatus(
  itemId: string,
  status: ChannelReconciliationItemStatus,
  patch?: { appliedAt?: string | null; safeMessage?: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_channel_reconciliation_items').update({
    status,
    applied_at: patch?.appliedAt ?? (status === 'applied' ? now : null),
    ...(patch?.safeMessage != null ? { safe_message: patch.safeMessage } : {}),
    updated_at: now,
  }).eq('id', itemId);
  if (error) throw new Error(error.message);
}

async function findImportedByExternal(
  connectionId: string,
  externalBookingId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('booking_channel_imported_bookings')
    .select('*')
    .eq('connection_id', connectionId)
    .eq('external_booking_id', externalBookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? null;
}

function externalIdFromHash(
  snapshot: ChannelReconciliationSnapshot,
  externalIdentityHash: string | null,
): string | null {
  if (!externalIdentityHash) return null;
  for (const booking of snapshot.bookings) {
    if (hashExternalIdentity(booking.externalBookingId) === externalIdentityHash) {
      return booking.externalBookingId;
    }
  }
  return null;
}

async function countCanonicalMatchesForExternal(input: {
  accountId: string;
  propertyId: string;
  externalBookingId: string;
}): Promise<number> {
  const { count, error } = await supabase
    .from('booking_ops_records')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', input.accountId)
    .eq('property_id', input.propertyId)
    .eq('booking_id', input.externalBookingId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function revalidateMatchRepairTarget(input: {
  connection: ChannelManagerConnection;
  scope: { accountId: string; propertyId: string };
  snapshot: ChannelReconciliationSnapshot;
  item: ChannelReconciliationItemRow;
}): Promise<
  | { ok: true; importedBookingId: string; bookingOpsRecordId: string; externalBookingId: string }
  | { ok: false; reason: string }
> {
  const importedBookingId = text(input.item.importedBookingId);
  const plannedOpsId = text(input.item.bookingOpsRecordId);
  if (!importedBookingId || !plannedOpsId) {
    return { ok: false, reason: 'Нет imported/booking_ops id для сопоставления.' };
  }

  const { data: imported, error: importedError } = await supabase
    .from('booking_channel_imported_bookings')
    .select('id,connection_id,external_booking_id,matched_booking_id,match_status')
    .eq('id', importedBookingId)
    .maybeSingle();
  if (importedError) throw new Error(importedError.message);
  if (!imported || text(imported.connection_id) !== input.connection.id) {
    return { ok: false, reason: 'Импортированная бронь вне контура подключения.' };
  }

  const externalBookingId = text(imported.external_booking_id)
    || externalIdFromHash(input.snapshot, input.item.externalIdentityHash);
  if (!externalBookingId) {
    return { ok: false, reason: 'Не удалось подтвердить внешний идентификатор брони.' };
  }
  if (
    input.item.externalIdentityHash
    && hashExternalIdentity(externalBookingId) !== input.item.externalIdentityHash
  ) {
    return { ok: false, reason: 'Внешний идентификатор брони больше не совпадает с отчётом сверки.' };
  }

  const { data: ops, error: opsError } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,booking_id')
    .eq('id', plannedOpsId)
    .maybeSingle();
  if (opsError) throw new Error(opsError.message);
  if (!ops) {
    return { ok: false, reason: 'Целевая бронь исчезла. Сопоставление заблокировано.' };
  }
  if (text(ops.account_id) !== input.scope.accountId) {
    return { ok: false, reason: 'Целевая бронь перешла в другой аккаунт. Сопоставление заблокировано.' };
  }
  if (text(ops.property_id) !== input.scope.propertyId) {
    return { ok: false, reason: 'Целевая бронь перешла на другой объект. Сопоставление заблокировано.' };
  }
  if (text(ops.booking_id) !== externalBookingId) {
    return { ok: false, reason: 'Внешний ID целевой брони больше не совпадает. Сопоставление заблокировано.' };
  }

  const matchCount = await countCanonicalMatchesForExternal({
    accountId: input.scope.accountId,
    propertyId: input.scope.propertyId,
    externalBookingId,
  });
  if (matchCount !== 1) {
    return {
      ok: false,
      reason: matchCount > 1
        ? 'Появился дубликат канонической брони. Сопоставление заблокировано.'
        : 'Каноническое совпадение исчезло. Сопоставление заблокировано.',
    };
  }

  return {
    ok: true,
    importedBookingId,
    bookingOpsRecordId: plannedOpsId,
    externalBookingId,
  };
}

async function verifyScopedBookingStatus(input: {
  bookingOpsId: string;
  accountId: string;
  propertyId: string;
  expectCancelled?: boolean;
  expectActiveConfirmed?: boolean;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,normalized_status,ops_status')
    .eq('id', input.bookingOpsId)
    .eq('account_id', input.accountId)
    .eq('property_id', input.propertyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  const status = internalStatus(data);
  if (input.expectCancelled) return isCancelledStatus(status);
  if (input.expectActiveConfirmed) {
    return !isCancelledStatus(status) && (
      normalizeExternalBookingStatus(status) === 'confirmed'
      || normalizeExternalBookingStatus(status) === 'new'
      || status === 'confirmed'
    );
  }
  return true;
}

async function applyStatusDriftItem(input: {
  connection: ChannelManagerConnection;
  scope: { accountId: string; propertyId: string };
  snapshot: ChannelReconciliationSnapshot;
  item: ChannelReconciliationItemRow;
}): Promise<'applied' | 'skipped' | 'blocked' | 'failed'> {
  const bookingOpsId = text(input.item.bookingOpsRecordId);
  if (!bookingOpsId) {
    await markItemStatus(input.item.id, 'failed', { safeMessage: 'Нет booking_ops_record_id для статуса.' });
    return 'failed';
  }

  const { data: current, error } = await supabase
    .from('booking_ops_records')
    .select('id,account_id,property_id,unit_id,check_in_at,check_out_at,normalized_status,ops_status')
    .eq('id', bookingOpsId)
    .eq('account_id', input.scope.accountId)
    .eq('property_id', input.scope.propertyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) {
    await markItemStatus(input.item.id, 'blocked', {
      safeMessage: 'Бронь вне контура подключения. Статус не изменён.',
    });
    return 'blocked';
  }

  const intendedRaw = intendedStatusFromItem(input.item);
  const repair = resolveStatusDriftRepair(intendedRaw || 'unknown', internalStatus(current));
  if (repair === 'unsupported') {
    await markItemStatus(input.item.id, 'blocked', {
      safeMessage: 'Неподдерживаемый переход статуса. Автоисправление недоступно.',
    });
    return 'blocked';
  }

  if (repair === 'cancel') {
    if (isCancelledStatus(internalStatus(current))) {
      await markItemStatus(input.item.id, 'skipped', { safeMessage: 'Бронь уже отменена.' });
      return 'skipped';
    }
    const result = await cancelReservation({
      accountId: input.scope.accountId,
      reservationId: bookingOpsId,
      actorId: 'channel-manager-reconciliation',
      reason: 'channel_manager_reconciliation_status_drift_cancel',
    });
    const verified = await verifyScopedBookingStatus({
      bookingOpsId,
      accountId: input.scope.accountId,
      propertyId: input.scope.propertyId,
      expectCancelled: true,
    });
    if (!result.changed || !verified) {
      await markItemStatus(input.item.id, 'failed', {
        safeMessage: 'Отмена не подтверждена после применения. Статус не помечен applied.',
      });
      return 'failed';
    }
    await markItemStatus(input.item.id, 'applied');
    return 'applied';
  }

  // restore
  if (!isCancelledStatus(internalStatus(current))) {
    const verified = await verifyScopedBookingStatus({
      bookingOpsId,
      accountId: input.scope.accountId,
      propertyId: input.scope.propertyId,
      expectActiveConfirmed: true,
    });
    await markItemStatus(input.item.id, verified ? 'skipped' : 'failed', {
      safeMessage: verified ? 'Бронь уже активна.' : 'Активный статус не подтверждён.',
    });
    return verified ? 'skipped' : 'failed';
  }

  const externalId = externalIdFromHash(input.snapshot, input.item.externalIdentityHash);
  const snapBooking = input.snapshot.bookings.find((b) => b.externalBookingId === externalId);
  const checkIn = snapBooking?.checkInDate
    || nullableText(input.item.safeAfter.checkInDate)
    || (current.check_in_at ? String(current.check_in_at).slice(0, 10) : null);
  const checkOut = snapBooking?.checkOutDate
    || nullableText(input.item.safeAfter.checkOutDate)
    || (current.check_out_at ? String(current.check_out_at).slice(0, 10) : null);
  if (!checkIn || !checkOut) {
    await markItemStatus(input.item.id, 'blocked', {
      safeMessage: 'Недостаточно дат для восстановления статуса.',
    });
    return 'blocked';
  }

  const result = await restoreReservation({
    accountId: input.scope.accountId,
    reservationId: bookingOpsId,
    actorId: 'channel-manager-reconciliation',
    propertyId: input.scope.propertyId,
    unitId: nullableText(current.unit_id),
    checkIn,
    checkOut,
    reason: 'channel_manager_reconciliation_status_drift_restore',
  });
  if (result.blocked) {
    await markItemStatus(input.item.id, 'blocked', {
      safeMessage: 'Восстановление статуса заблокировано: конфликт доступности.',
    });
    return 'blocked';
  }
  const verified = await verifyScopedBookingStatus({
    bookingOpsId,
    accountId: input.scope.accountId,
    propertyId: input.scope.propertyId,
    expectActiveConfirmed: true,
  });
  if (!result.changed || !verified) {
    await markItemStatus(input.item.id, 'failed', {
      safeMessage: 'Восстановление не подтверждено после применения. Статус не помечен applied.',
    });
    return 'failed';
  }
  await markItemStatus(input.item.id, 'applied');
  return 'applied';
}

async function applyOneSafeItem(input: {
  connection: ChannelManagerConnection;
  importRunId: string;
  scope: { accountId: string; propertyId: string };
  snapshot: ChannelReconciliationSnapshot;
  item: ChannelReconciliationItemRow;
}): Promise<'applied' | 'skipped' | 'blocked' | 'failed'> {
  const { connection, importRunId, scope, snapshot, item } = input;

  if (await actionKeyAlreadyApplied(item.deterministicActionKey)) {
    await markItemStatus(item.id, 'skipped', { safeMessage: 'Уже применено ранее (идемпотентно).' });
    return 'skipped';
  }

  try {
    switch (item.category) {
      case 'booking_missing_internal': {
        const externalId = externalIdFromHash(snapshot, item.externalIdentityHash);
        const booking = snapshot.bookings.find((b) => b.externalBookingId === externalId);
        if (!booking) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Бронь не найдена в снимке для создания.' });
          return 'failed';
        }
        await importChannelBookings(connection.id, [bookingToImportRow(booking)], { importRunId });
        await reconcileImportedBookings(connection.id, {
          externalBookingIds: [booking.externalBookingId],
          propertyId: scope.propertyId,
          accountId: scope.accountId,
        });
        const imported = await findImportedByExternal(connection.id, booking.externalBookingId);
        if (!imported) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Импортированная бронь не найдена после upsert.' });
          return 'failed';
        }
        if (nullableText(imported.matched_booking_id)) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Бронь уже сопоставлена.' });
          return 'skipped';
        }
        const created = await createBookingFromImportedChannelBooking(text(imported.id), {
          propertyId: scope.propertyId,
          accountId: scope.accountId,
        });
        if (created.duplicate) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Дубликат — бронь уже существует.' });
          return 'skipped';
        }
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'booking_status_drift':
        return applyStatusDriftItem({ connection, scope, snapshot, item });

      case 'booking_field_drift': {
        // Match repair path — revalidate contour at apply time.
        if (item.entityIdentity.startsWith('match:') && item.importedBookingId && item.bookingOpsRecordId) {
          const revalidated = await revalidateMatchRepairTarget({
            connection,
            scope,
            snapshot,
            item,
          });
          if (!revalidated.ok) {
            await markItemStatus(item.id, 'blocked', { safeMessage: revalidated.reason });
            return 'blocked';
          }
          const { error } = await supabase.from('booking_channel_imported_bookings').update({
            matched_booking_id: revalidated.bookingOpsRecordId,
            match_status: 'matched',
            updated_at: new Date().toISOString(),
          }).eq('id', revalidated.importedBookingId).eq('connection_id', connection.id);
          if (error) throw new Error(error.message);
          await markItemStatus(item.id, 'applied');
          return 'applied';
        }

        const bookingOpsId = item.bookingOpsRecordId;
        if (!bookingOpsId) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Нет booking_ops_record_id для обновления.' });
          return 'failed';
        }
        const externalId = externalIdFromHash(snapshot, item.externalIdentityHash);
        const snapBooking = snapshot.bookings.find((b) => b.externalBookingId === externalId);
        const checkIn = snapBooking?.checkInDate ?? nullableText(item.safeAfter.checkInDate);
        const checkOut = snapBooking?.checkOutDate ?? nullableText(item.safeAfter.checkOutDate);
        const guestCount = snapBooking?.guestCount ?? numberOrNull(item.safeAfter.guestCount);

        const { data: current, error } = await supabase
          .from('booking_ops_records')
          .select('id,account_id,property_id,unit_id,guest_count,check_in_at,check_out_at,normalized_status')
          .eq('id', bookingOpsId)
          .eq('account_id', scope.accountId)
          .eq('property_id', scope.propertyId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!current) {
          await markItemStatus(item.id, 'blocked', {
            safeMessage: 'Бронь вне контура подключения. Обновление заблокировано.',
          });
          return 'blocked';
        }
        if (isCancelledStatus(internalStatus(current))) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Отменённая бронь не обновляется этим действием.' });
          return 'skipped';
        }

        const currentCheckIn = current.check_in_at ? String(current.check_in_at).slice(0, 10) : null;
        const currentCheckOut = current.check_out_at ? String(current.check_out_at).slice(0, 10) : null;
        const datesChanged = Boolean(
          (checkIn && checkIn !== currentCheckIn) || (checkOut && checkOut !== currentCheckOut),
        );
        const guestCountChanged = guestCount != null && guestCount !== numberOrNull(current.guest_count);

        if (datesChanged) {
          if (!checkIn || !checkOut) {
            await markItemStatus(item.id, 'blocked', { safeMessage: 'Недостаточно дат для обновления.' });
            return 'blocked';
          }
          const availability = await getUnifiedAvailability({
            accountId: scope.accountId,
            propertyId: scope.propertyId,
            unitId: nullableText(current.unit_id),
            checkIn,
            checkOut,
            excludeReservationId: bookingOpsId,
          });
          if (!availability.available) {
            await markItemStatus(item.id, 'blocked', {
              safeMessage: 'Конфликт доступности — даты не изменены.',
            });
            return 'blocked';
          }
        }

        if (!datesChanged && !guestCountChanged) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Поля уже совпадают.' });
          return 'skipped';
        }

        if (externalId && snapBooking) {
          await importChannelBookings(connection.id, [bookingToImportRow(snapBooking)], { importRunId });
        }

        const result = await updateBookingOpsRecord(bookingOpsId, {
          guestCount: guestCountChanged ? guestCount ?? undefined : undefined,
          checkInAt: datesChanged ? checkIn ?? undefined : undefined,
          checkOutAt: datesChanged ? checkOut ?? undefined : undefined,
        }, {
          actorType: 'admin',
          expectedScope: {
            accountId: scope.accountId,
            propertyId: scope.propertyId,
          },
        });
        if (!result.ok) {
          if (result.error === 'scope_mismatch') {
            await markItemStatus(item.id, 'blocked', {
              safeMessage: 'Бронь сменила контур до обновления. Обновление заблокировано.',
            });
            return 'blocked';
          }
          await markItemStatus(item.id, 'failed', {
            safeMessage: redactLiveCoreErrorMessage(result.error ?? 'Не удалось обновить бронь.'),
          });
          return 'failed';
        }
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'booking_cancel_missed': {
        const bookingOpsId = item.bookingOpsRecordId;
        if (!bookingOpsId) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Нет id брони для отмены.' });
          return 'failed';
        }
        const { data: booking, error } = await supabase
          .from('booking_ops_records')
          .select('id,account_id,property_id,normalized_status,ops_status')
          .eq('id', bookingOpsId)
          .eq('account_id', scope.accountId)
          .eq('property_id', scope.propertyId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!booking) {
          await markItemStatus(item.id, 'blocked', { safeMessage: 'Бронь вне контура. Отмена заблокирована.' });
          return 'blocked';
        }
        if (isCancelledStatus(internalStatus(booking))) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Бронь уже отменена.' });
          return 'skipped';
        }
        const result = await cancelReservation({
          accountId: scope.accountId,
          reservationId: bookingOpsId,
          actorId: 'channel-manager-reconciliation',
          reason: 'channel_manager_reconciliation_cancel_missed',
        });
        const verified = await verifyScopedBookingStatus({
          bookingOpsId,
          accountId: scope.accountId,
          propertyId: scope.propertyId,
          expectCancelled: true,
        });
        if (!result.changed || !verified) {
          await markItemStatus(item.id, result.changed && !verified ? 'failed' : 'skipped', {
            safeMessage: verified
              ? 'Бронь уже отменена.'
              : 'Отмена не подтверждена после применения.',
          });
          return result.changed && !verified ? 'failed' : 'skipped';
        }
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'booking_restore_missed': {
        const bookingOpsId = item.bookingOpsRecordId;
        if (!bookingOpsId) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Нет id брони для восстановления.' });
          return 'failed';
        }
        const { data: current, error } = await supabase
          .from('booking_ops_records')
          .select('id,account_id,property_id,unit_id,check_in_at,check_out_at,normalized_status')
          .eq('id', bookingOpsId)
          .eq('account_id', scope.accountId)
          .eq('property_id', scope.propertyId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!current) {
          await markItemStatus(item.id, 'blocked', {
            safeMessage: 'Бронь вне контура. Восстановление заблокировано.',
          });
          return 'blocked';
        }
        if (!isCancelledStatus(internalStatus(current))) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Бронь уже активна.' });
          return 'skipped';
        }
        const externalId = externalIdFromHash(snapshot, item.externalIdentityHash);
        const snapBooking = snapshot.bookings.find((b) => b.externalBookingId === externalId);
        const checkIn = snapBooking?.checkInDate
          || (current.check_in_at ? String(current.check_in_at).slice(0, 10) : null);
        const checkOut = snapBooking?.checkOutDate
          || (current.check_out_at ? String(current.check_out_at).slice(0, 10) : null);
        if (!checkIn || !checkOut) {
          await markItemStatus(item.id, 'blocked', {
            safeMessage: 'Недостаточно дат для восстановления.',
          });
          return 'blocked';
        }
        const result = await restoreReservation({
          accountId: scope.accountId,
          reservationId: bookingOpsId,
          actorId: 'channel-manager-reconciliation',
          propertyId: scope.propertyId,
          unitId: nullableText(current.unit_id),
          checkIn,
          checkOut,
          reason: 'channel_manager_reconciliation_restore_missed',
        });
        if (result.blocked) {
          await markItemStatus(item.id, 'blocked', {
            safeMessage: 'Восстановление заблокировано: конфликт доступности (overbooking).',
          });
          return 'blocked';
        }
        const verified = await verifyScopedBookingStatus({
          bookingOpsId,
          accountId: scope.accountId,
          propertyId: scope.propertyId,
          expectActiveConfirmed: true,
        });
        if (!result.changed || !verified) {
          await markItemStatus(item.id, result.changed && !verified ? 'failed' : 'skipped', {
            safeMessage: verified
              ? 'Бронь уже активна.'
              : 'Восстановление не подтверждено после применения.',
          });
          return result.changed && !verified ? 'failed' : 'skipped';
        }
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'calendar_day_missing_internal':
      case 'calendar_availability_drift': {
        const parsed = parseHashedDayEntityIdentity('calendar', item.entityIdentity);
        const objectHash = parsed?.objectHash
          || text(item.externalIdentityHash)
          || text(item.safeAfter.externalObjectIdHash);
        const date = parsed?.date || text(item.safeAfter.date);
        if (!objectHash || !date) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Некорректный идентификатор дня календаря.' });
          return 'failed';
        }
        const day = findSnapshotDayByObjectHash(snapshot.calendar, objectHash, date);
        if (!day) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'День календаря не найден в снимке.' });
          return 'failed';
        }
        await importChannelCalendar(connection.id, [calendarToImportRow(day)], { importRunId });
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'pricing_missing_internal':
      case 'pricing_value_drift': {
        const parsed = parseHashedDayEntityIdentity('pricing', item.entityIdentity);
        const objectHash = parsed?.objectHash
          || text(item.externalIdentityHash)
          || text(item.safeAfter.externalObjectIdHash);
        const date = parsed?.date || text(item.safeAfter.date);
        if (!objectHash || !date) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Некорректный идентификатор цены.' });
          return 'failed';
        }
        const day = findSnapshotDayByObjectHash(snapshot.pricing, objectHash, date);
        if (!day) {
          await markItemStatus(item.id, 'failed', { safeMessage: 'Цена не найдена в снимке.' });
          return 'failed';
        }
        await importChannelCalendar(connection.id, [calendarToImportRow(day)], {
          importRunId,
          pricing: true,
        });
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'stale_running_sync': {
        const runId = text(item.safeBefore.runId) || item.entityIdentity.replace(/^run:/, '');
        const recovered = await recoverStaleLiveSyncRuns(connection.id);
        if (recovered.includes(runId)) {
          await markItemStatus(item.id, 'applied');
          return 'applied';
        }
        // Force-mark exact stale run if still running past threshold
        const { data: runRow } = await supabase
          .from('booking_channel_import_runs')
          .select('*')
          .eq('id', runId)
          .eq('connection_id', connection.id)
          .eq('status', 'running')
          .maybeSingle();
        if (!runRow) {
          await markItemStatus(item.id, 'skipped', { safeMessage: 'Запуск уже не running.' });
          return 'skipped';
        }
        const finishedAt = new Date().toISOString();
        const safeError = {
          stage: 'reconciliation_recovery',
          code: 'stale_running_run',
          message: 'Зависший sync помечен failed через сверку.',
          retryable: true,
        };
        await supabase.from('booking_channel_import_runs').update({
          status: 'failed',
          finished_at: finishedAt,
          errors: [safeError],
          safe_summary: 'Синхронизация прервана сверкой (stale). Курсор сохранён.',
          metadata: {
            ...((runRow.metadata as Record<string, unknown>) ?? {}),
            liveCore: true,
            liveCoreStage: 'failed',
            staleRecovered: true,
            staleRecoveredAt: finishedAt,
            safeError,
          },
          updated_at: finishedAt,
        }).eq('id', runId).eq('status', 'running');

        const fresh = await requireConnection(connection.id);
        const lease = fresh.metadata?.liveSyncLease as Record<string, unknown> | undefined;
        if (lease && text(lease.runId) === runId) {
          await releaseChannelLiveSyncLease(connection.id, runId);
        }
        await markItemStatus(item.id, 'applied');
        return 'applied';
      }

      case 'lease_run_mismatch': {
        // Standalone lease mismatch is operator_review only — never auto-release.
        await markItemStatus(item.id, 'skipped', {
          safeMessage: 'Несовпадение lease требует проверки оператором. Автоснятие запрещено.',
        });
        return 'skipped';
      }

      case 'booking_missing_external':
        await markItemStatus(item.id, 'skipped', {
          safeMessage: 'Автоотмена отсутствующих во внешнем снимке броней запрещена.',
        });
        return 'skipped';

      default:
        await markItemStatus(item.id, 'skipped', { safeMessage: 'Категория не поддерживает auto-repair в v1.' });
        return 'skipped';
    }
  } catch (error) {
    await markItemStatus(item.id, 'failed', {
      safeMessage: redactLiveCoreErrorMessage(error instanceof Error ? error.message : error),
    });
    return 'failed';
  }
}

async function finalizeReconciliationRecovery(input: {
  connectionId: string;
  importRunId: string;
  reconciliationRunId: string;
  reportHash: string;
  status: 'completed' | 'completed_with_blockers' | 'failed';
  counts: Record<string, unknown>;
  safeSummary: string;
  safeError?: Record<string, unknown>;
}): Promise<void> {
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase.rpc('channel_manager_finalize_reconciliation_recovery_v1', {
    p_connection_id: input.connectionId,
    p_import_run_id: input.importRunId,
    p_reconciliation_run_id: input.reconciliationRunId,
    p_expected_report_hash: input.reportHash,
    p_finished_at: finishedAt,
    p_status: input.status,
    p_counts: input.counts,
    p_safe_run_metadata: {
      reconciliationRecovery: true,
      cursorUnchanged: true,
      reportHashPrefix: input.reportHash.slice(0, 16),
    },
    p_safe_summary: input.safeSummary,
    p_safe_error: input.safeError ?? {},
  });
  if (error) throw new Error(error.message);
  const payload = data && typeof data === 'object' ? data as { success?: boolean; message?: string } : null;
  if (!payload?.success) {
    throw new Error(payload?.message || 'Не удалось завершить reconciliation recovery.');
  }
}

async function compensateFailReconciliationRecovery(input: {
  connectionId: string;
  importRunId: string;
  reconciliationRunId: string;
  reportHash: string;
  safeSummary: string;
  safeError?: Record<string, unknown>;
}): Promise<{ ok: true; leaseReleased: boolean } | { ok: false; message: string }> {
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase.rpc('channel_manager_fail_reconciliation_recovery_v1', {
    p_connection_id: input.connectionId,
    p_import_run_id: input.importRunId,
    p_reconciliation_run_id: input.reconciliationRunId,
    p_expected_report_hash: input.reportHash,
    p_finished_at: finishedAt,
    p_safe_summary: input.safeSummary,
    p_safe_error: input.safeError ?? {},
    p_safe_run_metadata: {
      reconciliationRecovery: true,
      failCompensation: true,
      cursorUnchanged: true,
      reportHashPrefix: input.reportHash.slice(0, 16),
    },
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  const payload = data && typeof data === 'object'
    ? data as { success?: boolean; message?: string; leaseReleased?: boolean }
    : null;
  if (!payload?.success) {
    return { ok: false, message: payload?.message || 'Compensation RPC failed.' };
  }
  return { ok: true, leaseReleased: payload.leaseReleased === true };
}

/** Fail only the newly acquired reconciliation import run; keep preview available. */
async function abortReconciliationImportRunKeepPreview(input: {
  connectionId: string;
  importRunId: string;
  code: string;
  message: string;
}): Promise<void> {
  const finishedAt = new Date().toISOString();
  const safeError = toChannelLiveSafeError('reconciliation_recovery', input.message, input.code);
  const { data: runRow, error: loadError } = await supabase
    .from('booking_channel_import_runs')
    .select('id,status,metadata,import_type,connection_id')
    .eq('id', input.importRunId)
    .eq('connection_id', input.connectionId)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (runRow && text(runRow.import_type) === 'reconciliation_recovery' && text(runRow.status) === 'running') {
    const { error } = await supabase.from('booking_channel_import_runs').update({
      status: 'failed',
      finished_at: finishedAt,
      errors: [safeError],
      safe_summary: 'Применение сверки остановлено: отчёт устарел после захвата guard. Курсор не изменён.',
      metadata: {
        ...((runRow.metadata as Record<string, unknown>) ?? {}),
        liveCore: true,
        liveCoreStage: 'failed',
        reconciliationRecovery: true,
        reportStaleAfterGuard: true,
        safeError,
      },
      updated_at: finishedAt,
    }).eq('id', input.importRunId).eq('status', 'running');
    if (error) throw new Error(error.message);
  }
  await releaseChannelLiveSyncLease(input.connectionId, input.importRunId);
}

async function assertReportStillFresh(input: {
  connection: ChannelManagerConnection;
  run: ChannelReconciliationRunRow;
  recentRuns?: ChannelImportRun[];
}): Promise<void> {
  const committed = readCommittedIncrementalCursor(input.connection.metadata);
  const currentHash = committed?.checkpoint ? hashCursorCheckpoint(committed.checkpoint) : null;
  if ((input.run.committedCursorHashAtPreview ?? null) !== (currentHash ?? null)) {
    throw Object.assign(
      new Error('Отчёт сверки устарел: курсор изменился после preview.'),
      { code: 'report_stale_cursor' },
    );
  }

  const startedAtMs = Date.parse(input.run.startedAt || input.run.createdAt || '');
  if (!Number.isFinite(startedAtMs)) return;
  const runs = input.recentRuns ?? await listChannelImportRuns(input.connection.id);
  const newerSuccess = runs.find((run) => (
    ['initial_sync', 'incremental_sync'].includes(run.importType)
    && ['completed', 'completed_with_warnings'].includes(run.status)
    && Date.parse(run.finishedAt || run.updatedAt || '') > startedAtMs
  ));
  if (newerSuccess) {
    throw Object.assign(
      new Error('Отчёт сверки устарел: после preview прошла успешная синхронизация.'),
      { code: 'report_stale_sync' },
    );
  }
}

/**
 * Post-guard freshness: reload connection + recent runs, then re-check cursor hash
 * and newer successful initial/incremental sync against the preview baseline.
 */
async function assertReportStillFreshAfterGuard(input: {
  connectionId: string;
  run: ChannelReconciliationRunRow;
}): Promise<void> {
  const freshConnection = await requireConnection(input.connectionId);
  const recentRuns = await listChannelImportRuns(input.connectionId);
  try {
    await assertReportStillFresh({
      connection: freshConnection,
      run: input.run,
      recentRuns,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'report_stale_cursor' || code === 'report_stale_sync') {
      throw Object.assign(
        new Error(
          code === 'report_stale_cursor'
            ? 'Отчёт сверки устарел после захвата guard: курсор изменился.'
            : 'Отчёт сверки устарел после захвата guard: прошла успешная синхронизация.',
        ),
        { code: 'report_stale_after_guard', causeCode: code },
      );
    }
    throw error;
  }
}

export async function runChannelManagerReconciliationRecovery(input: {
  connectionId: string;
  reconciliationRunId: string;
  reportHash: string;
  confirmationPhrase: string;
  /** Optional same normalized snapshot used at preview (required for apply repairs). */
  snapshot?: unknown;
}): Promise<SafeReconciliationReport> {
  if (input.confirmationPhrase !== APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS) {
    throw Object.assign(
      new Error('Нужна точная фраза подтверждения APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS.'),
      { code: 'confirmation_mismatch' },
    );
  }

  const connection = await requireConnection(input.connectionId);
  const schema = await probeChannelLiveCoreSchema(connection.id);
  if (!schema.reconciliationReady) {
    throw Object.assign(
      new Error(schema.blocker ?? 'Миграция Reconciliation & Recovery ещё не применена.'),
      { code: 'migration_missing' },
    );
  }

  const run = await loadReconciliationRun(input.reconciliationRunId);
  if (!run || run.connectionId !== connection.id) {
    throw Object.assign(new Error('Запуск сверки не найден.'), { code: 'reconciliation_run_not_found' });
  }
  if (run.status !== 'preview_ready' && run.status !== 'applying') {
    throw Object.assign(
      new Error('Применение доступно только для отчёта в статусе preview_ready.'),
      { code: 'invalid_run_status' },
    );
  }
  if (run.reportHash !== text(input.reportHash)) {
    throw Object.assign(new Error('reportHash не совпадает с отчётом сверки.'), {
      code: 'report_hash_mismatch',
    });
  }

  await assertReportStillFresh({ connection, run });

  const scope = await resolveIncrementalConnectionScope(connection);
  if (!scope.accountId || !scope.propertyId) {
    throw Object.assign(
      new Error('Для применения сверки нужны canonical accountId и propertyId.'),
      { code: 'connection_scope_invalid' },
    );
  }

  if (!input.snapshot) {
    throw Object.assign(
      new Error('Для применения безопасных исправлений нужен тот же normalized snapshot.'),
      { code: 'snapshot_required' },
    );
  }
  const snapshot = validateChannelReconciliationSnapshot(input.snapshot);
  const snapshotHash = computeReconciliationSnapshotHash(snapshot);
  if (snapshotHash !== run.snapshotHash) {
    throw Object.assign(
      new Error('Хэш снимка не совпадает с preview. Перезапустите preview.'),
      { code: 'snapshot_hash_mismatch' },
    );
  }

  let importRunId: string | null = null;
  let applied = 0;
  let skipped = 0;
  let blocked = 0;
  let failed = 0;
  let leaseSafeToReleaseSeparately = false;

  try {
    const guard = await acquireChannelLiveSyncGuard(connection.id, {
      importType: 'reconciliation_recovery',
    });
    if (!guard.ok) {
      throw Object.assign(new Error(guard.reason), { code: guard.code });
    }
    importRunId = guard.run.id;

    // Post-guard freshness: Incremental Sync may have committed between pre-check and acquire.
    try {
      await assertReportStillFreshAfterGuard({ connectionId: connection.id, run });
    } catch (staleError) {
      const code = (staleError as { code?: string })?.code;
      if (code === 'report_stale_after_guard' && importRunId) {
        await abortReconciliationImportRunKeepPreview({
          connectionId: connection.id,
          importRunId,
          code,
          message: staleError instanceof Error ? staleError.message : 'report_stale_after_guard',
        });
        importRunId = null; // already failed+released; do not compensate/finalize recon run
      }
      throw staleError;
    }

    const now = new Date().toISOString();
    const { error: modeError } = await supabase.from('booking_channel_reconciliation_runs').update({
      mode: 'apply',
      status: 'applying',
      updated_at: now,
      metadata: {
        ...run.metadata,
        applyImportRunId: importRunId,
        applyingAt: now,
      },
    }).eq('id', run.id).eq('report_hash', run.reportHash);
    if (modeError) throw new Error(modeError.message);

    const items = await loadReconciliationItems(run.id);
    const actionable = items.filter((item) => (
      item.repairability === 'safe_auto'
      && ['detected', 'planned', 'failed'].includes(item.status)
    ));

    for (const item of actionable) {
      const outcome = await applyOneSafeItem({
        connection,
        importRunId,
        scope: { accountId: scope.accountId, propertyId: scope.propertyId },
        snapshot,
        item,
      });
      if (outcome === 'applied') applied += 1;
      else if (outcome === 'skipped') skipped += 1;
      else if (outcome === 'blocked') blocked += 1;
      else failed += 1;
    }

    await auditChannelImportAvailability(connection.id);

    const finalItems = await loadReconciliationItems(run.id);
    const finalStatus: 'completed' | 'completed_with_blockers' | 'failed' = (
      failed > 0 && applied === 0 && blocked === 0
        ? 'failed'
        : (blocked > 0 || failed > 0 || finalItems.some((i) => i.severity === 'blocker' && i.status !== 'applied'))
          ? 'completed_with_blockers'
          : 'completed'
    );
    const counts = {
      applied,
      skipped,
      blocked,
      failed,
      total: finalItems.length,
      repairable: finalItems.filter((i) => i.repairability === 'safe_auto').length,
      blockers: finalItems.filter((i) => i.severity === 'blocker' || i.status === 'blocked').length,
    };
    const safeSummary = `Сверка (apply): применено ${applied}, пропущено ${skipped}, блокировано ${blocked}, ошибок ${failed}. Курсор не изменён.`;

    await finalizeReconciliationRecovery({
      connectionId: connection.id,
      importRunId,
      reconciliationRunId: run.id,
      reportHash: run.reportHash,
      status: finalStatus,
      counts,
      safeSummary,
      safeError: failed > 0
        ? toChannelLiveSafeError('reconciliation_recovery', 'Часть безопасных исправлений завершилась ошибкой.', 'partial_failure')
        : {},
    });
    leaseSafeToReleaseSeparately = true;
  } catch (error) {
    if (importRunId) {
      const safeError = toChannelLiveSafeError(
        'reconciliation_recovery',
        error instanceof Error ? error.message : error,
        (error as { code?: string })?.code || 'recovery_failed',
      );
      let finalized = false;
      let finalizeErrorMessage: string | null = null;
      try {
        await finalizeReconciliationRecovery({
          connectionId: connection.id,
          importRunId,
          reconciliationRunId: run.id,
          reportHash: run.reportHash,
          status: 'failed',
          counts: { applied, skipped, blocked, failed: failed + 1 },
          safeSummary: 'Применение сверки остановлено с ошибкой. Курсор не изменён.',
          safeError,
        });
        finalized = true;
        leaseSafeToReleaseSeparately = true;
      } catch (finalizeError) {
        finalizeErrorMessage = finalizeError instanceof Error
          ? finalizeError.message
          : String(finalizeError);
        const compensation = await compensateFailReconciliationRecovery({
          connectionId: connection.id,
          importRunId,
          reconciliationRunId: run.id,
          reportHash: run.reportHash,
          safeSummary: 'Применение сверки остановлено; выполнен fail-closed compensation. Курсор не изменён.',
          safeError: {
            ...safeError,
            finalizeError: finalizeErrorMessage,
            compensationAttempted: true,
          },
        });
        if (!compensation.ok) {
          throw Object.assign(
            new Error(
              `Reconciliation recovery fail-closed: finalization and compensation both failed. `
              + `finalize=${finalizeErrorMessage}; compensation=${compensation.message}. `
              + `Guard may still be held — lease was not advertised as released.`,
            ),
            {
              code: 'finalization_compensation_failed',
              cause: error,
              finalizeError: finalizeErrorMessage,
              compensationError: compensation.message,
            },
          );
        }
        leaseSafeToReleaseSeparately = compensation.leaseReleased;
        finalized = true;
      }
      void finalized;
    }
    throw error;
  } finally {
    // Only release lease separately when finalize/compensation already made the import run terminal.
    // Never release lease while leaving a running reconciliation import run (orphan guard).
    if (importRunId && leaseSafeToReleaseSeparately) {
      await releaseChannelLiveSyncLease(connection.id, importRunId).catch(() => undefined);
    }
  }

  const finalRun = await loadReconciliationRun(run.id);
  if (!finalRun) throw new Error('Запуск сверки не найден после apply.');
  const finalItems = await loadReconciliationItems(run.id);
  const fresh = await requireConnection(connection.id);
  const committed = readCommittedIncrementalCursor(fresh.metadata);
  const currentHash = committed?.checkpoint ? hashCursorCheckpoint(committed.checkpoint) : null;
  return toSafeReconciliationReport(finalRun, finalItems, {
    cursorChangedSincePreview: (finalRun.committedCursorHashAtPreview ?? null) !== (currentHash ?? null),
  });
}

export async function getChannelManagerReconciliationStatus(
  connectionId: string,
  runId?: string,
): Promise<SafeReconciliationReport | null> {
  const connection = await requireConnection(connectionId);
  let run: ChannelReconciliationRunRow | null = null;
  if (runId) {
    run = await loadReconciliationRun(runId);
    if (run && run.connectionId !== connection.id) run = null;
  } else {
    const { data, error } = await supabase
      .from('booking_channel_reconciliation_runs')
      .select('*')
      .eq('connection_id', connection.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    run = data ? mapRunRow(data as Record<string, unknown>) : null;
  }
  if (!run) return null;
  const items = await loadReconciliationItems(run.id);
  const committed = readCommittedIncrementalCursor(connection.metadata);
  const currentHash = committed?.checkpoint ? hashCursorCheckpoint(committed.checkpoint) : null;
  return toSafeReconciliationReport(run, items, {
    cursorChangedSincePreview: (run.committedCursorHashAtPreview ?? null) !== (currentHash ?? null),
  });
}

export async function listRecentChannelManagerReconciliations(
  connectionId: string,
  limit = 10,
): Promise<SafeReconciliationReport[]> {
  const connection = await requireConnection(connectionId);
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  const { data, error } = await supabase
    .from('booking_channel_reconciliation_runs')
    .select('*')
    .eq('connection_id', connection.id)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(error.message);

  const committed = readCommittedIncrementalCursor(connection.metadata);
  const currentHash = committed?.checkpoint ? hashCursorCheckpoint(committed.checkpoint) : null;
  const reports: SafeReconciliationReport[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const run = mapRunRow(row);
    const items = await loadReconciliationItems(run.id);
    reports.push(toSafeReconciliationReport(run, items, {
      cursorChangedSincePreview: (run.committedCursorHashAtPreview ?? null) !== (currentHash ?? null),
    }));
  }
  return reports;
}
