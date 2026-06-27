import { supabase } from '@/lib/supabase';
import { buildBookingOpsAutomationPatch } from './decision-engine';
import {
  buildSafeSourceFieldPatch,
  mapGuestReservationRow,
  mapReservationToBookingOpsInput,
  shouldSkipReservationBookingOpsSync,
  wouldDowngradeOpsStatus,
  type GuestReservationRow,
  type GuestReservationSnapshot,
} from './reservation-mapping';
import {
  createBookingOpsRecord,
  getBookingOpsByBookingId,
  getBookingOpsRecord,
  updateBookingOpsRecord,
} from './repository';
import type { BookingOpsRecord } from './types';
import { BOOKING_OPS_NEXT_ACTION_LABELS_RU } from './types';

export type BookingOpsSyncOutcome =
  | 'created'
  | 'updated'
  | 'already_exists'
  | 'skipped'
  | 'failed';

export type BookingOpsSyncResult = {
  outcome: BookingOpsSyncOutcome;
  bookingId: string;
  recordId?: string;
  reason?: string;
  error?: string;
  record?: BookingOpsRecord;
};

export async function fetchGuestReservationSnapshot(
  reservationId: string,
): Promise<GuestReservationSnapshot | null> {
  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('*')
    .eq('id', reservationId)
    .maybeSingle();

  if (error || !data) return null;
  return mapGuestReservationRow(data as GuestReservationRow);
}

function buildAutomationPatchSafely(record: BookingOpsRecord): ReturnType<typeof buildBookingOpsAutomationPatch> {
  const patch = buildBookingOpsAutomationPatch(record);
  if (patch.opsStatus && wouldDowngradeOpsStatus(record.opsStatus, patch.opsStatus)) {
    const { opsStatus: _ignored, ...rest } = patch;
    return rest;
  }
  return patch;
}

async function applyAutomationAfterSync(record: BookingOpsRecord): Promise<BookingOpsRecord> {
  const patch = buildAutomationPatchSafely(record);
  if (Object.keys(patch).length === 0) return record;

  const result = await updateBookingOpsRecord(record.id, patch);
  if (!result.ok || !result.record) return record;
  return result.record;
}

export async function syncBookingOpsFromReservation(
  reservationId: string,
  options?: { dryRun?: boolean },
): Promise<BookingOpsSyncResult> {
  const bookingId = String(reservationId ?? '').trim();
  if (!bookingId) {
    return { outcome: 'failed', bookingId: '', error: 'reservation_id_required' };
  }

  const snapshot = await fetchGuestReservationSnapshot(bookingId);
  if (!snapshot) {
    return { outcome: 'failed', bookingId, error: 'reservation_not_found' };
  }

  const skipReason = shouldSkipReservationBookingOpsSync(snapshot);
  if (skipReason) {
    return { outcome: 'skipped', bookingId, reason: skipReason };
  }

  const derived = mapReservationToBookingOpsInput(snapshot);
  const existing = await getBookingOpsByBookingId(bookingId);

  if (!existing) {
    if (options?.dryRun) {
      return { outcome: 'created', bookingId, reason: 'dry_run_would_create' };
    }

    const created = await createBookingOpsRecord(derived);
    if (!created.ok || !created.record) {
      return {
        outcome: 'failed',
        bookingId,
        error: created.error ?? 'create_failed',
      };
    }

    const withAutomation = await applyAutomationAfterSync(created.record);
    return {
      outcome: 'created',
      bookingId,
      recordId: withAutomation.id,
      record: withAutomation,
    };
  }

  const fieldPatch = buildSafeSourceFieldPatch(existing, derived);
  const automationPatch = buildAutomationPatchSafely({
    ...existing,
    ...fieldPatch,
    opsStatus: fieldPatch.opsStatus ?? existing.opsStatus,
  });
  const combinedPatch = { ...fieldPatch, ...automationPatch };

  if (Object.keys(combinedPatch).length === 0) {
    return {
      outcome: 'already_exists',
      bookingId,
      recordId: existing.id,
      record: existing,
    };
  }

  if (options?.dryRun) {
    return {
      outcome: 'updated',
      bookingId,
      recordId: existing.id,
      reason: 'dry_run_would_update',
      record: existing,
    };
  }

  const updated = await updateBookingOpsRecord(existing.id, combinedPatch);
  if (!updated.ok || !updated.record) {
    return {
      outcome: 'failed',
      bookingId,
      recordId: existing.id,
      error: updated.error ?? 'update_failed',
    };
  }

  return {
    outcome: 'updated',
    bookingId,
    recordId: updated.record.id,
    record: updated.record,
  };
}

export async function ensureBookingOpsForReservation(
  reservationId: string,
  options?: { dryRun?: boolean },
): Promise<BookingOpsSyncResult> {
  return syncBookingOpsFromReservation(reservationId, options);
}

export type BookingOpsBackfillSummary = {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  created: number;
  updated: number;
  alreadyExists: number;
  skipped: number;
  failed: number;
  results: BookingOpsSyncResult[];
  error?: string;
};

export async function backfillBookingOpsFromReservations(options?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<BookingOpsBackfillSummary> {
  const limit = options?.limit ?? 500;
  const dryRun = options?.dryRun === true;

  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    return {
      ok: false,
      dryRun,
      scanned: 0,
      created: 0,
      updated: 0,
      alreadyExists: 0,
      skipped: 0,
      failed: 0,
      results: [],
      error: error.message,
    };
  }

  const results: BookingOpsSyncResult[] = [];
  let created = 0;
  let updated = 0;
  let alreadyExists = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of data ?? []) {
    const reservationId = String((row as { id?: string }).id ?? '').trim();
    if (!reservationId) continue;

    const result = await syncBookingOpsFromReservation(reservationId, { dryRun });
    results.push(result);

    switch (result.outcome) {
      case 'created':
        created += 1;
        break;
      case 'updated':
        updated += 1;
        break;
      case 'already_exists':
        alreadyExists += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      default:
        break;
    }
  }

  return {
    ok: failed === 0,
    dryRun,
    scanned: results.length,
    created,
    updated,
    alreadyExists,
    skipped,
    failed,
    results,
  };
}

export function describeBookingOpsSyncResult(result: BookingOpsSyncResult): string {
  switch (result.outcome) {
    case 'created':
      return `Создана ops-запись для брони ${result.bookingId}`;
    case 'updated':
      return `Обновлена ops-запись для брони ${result.bookingId}`;
    case 'already_exists':
      return `Ops-запись для брони ${result.bookingId} уже актуальна`;
    case 'skipped':
      return `Пропущена бронь ${result.bookingId}: ${result.reason ?? 'skipped'}`;
    case 'failed':
      return `Ошибка для брони ${result.bookingId}: ${result.error ?? 'failed'}`;
    default:
      return result.bookingId;
  }
}

export function nextActionLabelForRecord(record: BookingOpsRecord | undefined): string | null {
  const nextAction = record?.automation?.nextAction;
  if (!nextAction) return null;
  return BOOKING_OPS_NEXT_ACTION_LABELS_RU[nextAction];
}

export async function loadBookingOpsRecord(recordId: string): Promise<BookingOpsRecord | null> {
  return getBookingOpsRecord(recordId);
}
