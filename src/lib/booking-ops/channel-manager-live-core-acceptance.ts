/**
 * Channel Manager Live Core Acceptance Harness v1
 *
 * Owner-only synthetic acceptance: prepare/reuse a marked test contour,
 * run initial sync twice, verify import + idempotency, cleanup harness rows only.
 * No real CM API, OTA writes, credentials, or guest messages.
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import {
  findSecretPath,
  initializeChannelManagerConnection,
  listImportedChannelBookings,
  listChannelImportRuns,
  markChannelManagerAccessReceived,
  type ManualChannelSnapshot,
  type ChannelManagerConnection,
} from './channel-manager-access-import';
import {
  getChannelLiveCoreStatus,
  probeChannelLiveCoreSchema,
  runChannelManagerInitialSync,
  type ChannelLiveCoreSchemaState,
  type ChannelLiveSyncResult,
} from './channel-manager-live-core';
import {
  getOwnerSetupById,
  getOwnerSetupByLeadId,
  startObjectDataCollection,
  upsertPropertySetupData,
  type OwnerSetupProfile,
  type PropertySetupProfile,
} from './owner-object-setup-autopilot';

export const LIVE_CORE_ACCEPTANCE_HARNESS = 'channel_manager_live_core_v1' as const;
export const LIVE_CORE_ACCEPTANCE_LEAD_ID = 'acceptance:channel_manager_live_core_v1';
export const LIVE_CORE_ACCEPTANCE_PROPERTY_ID = 'asi-live-core-acceptance-v1';
export const LIVE_CORE_ACCEPTANCE_EXTERNAL_OBJECT_ID = 'asi-lc-accept-obj-v1';
export const LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID = 'asi-lc-accept-book-v1';
export const LIVE_CORE_ACCEPTANCE_SAFE_ACCESS_REF = 'operator:acceptance-harness-v1';
export const LIVE_CORE_ACCEPTANCE_GUEST_NAME = 'Тестовый Гость ASI';
export const LIVE_CORE_ACCEPTANCE_OBJECT_TITLE = 'ASI Live Core Acceptance Object';
export const LIVE_CORE_ACCEPTANCE_OBJECT_CITY = 'Тверь';

export type LiveCoreAcceptanceStepKey =
  | 'schema'
  | 'setup'
  | 'connection'
  | 'first_sync'
  | 'booking_check'
  | 'second_sync'
  | 'duplicate_check';

export type LiveCoreAcceptanceStepStatus = 'waiting' | 'running' | 'passed' | 'failed';

export type LiveCoreAcceptanceStep = {
  key: LiveCoreAcceptanceStepKey;
  label: string;
  status: LiveCoreAcceptanceStepStatus;
  detail: string | null;
};

export type LiveCoreAcceptanceEvidence = {
  schemaReady: boolean;
  ownerSetupId: string | null;
  propertySetupId: string | null;
  connectionId: string | null;
  firstRunId: string | null;
  secondRunId: string | null;
  bookingOpsRecordId: string | null;
  firstRunStatus: string | null;
  secondRunStatus: string | null;
  importedFirstRun: number | null;
  importedSecondRun: number | null;
  duplicateCount: number | null;
  passed: boolean;
  blocker: string | null;
  failedStep: LiveCoreAcceptanceStepKey | null;
  steps: LiveCoreAcceptanceStep[];
  schema: ChannelLiveCoreSchemaState | null;
};

export type LiveCoreAcceptanceCleanupResult = {
  ok: true;
  deleted: {
    bookingOpsRecords: number;
    connections: number;
    propertySetups: number;
    ownerSetups: number;
    communicationIntents: number;
  };
  preservedOrdinaryData: true;
};

const STEP_LABELS: Record<LiveCoreAcceptanceStepKey, string> = {
  schema: 'Схема Live Core',
  setup: 'Тестовый объект',
  connection: 'Подключение МК',
  first_sync: 'Первый initial sync',
  booking_check: 'Проверка брони',
  second_sync: 'Повторный sync',
  duplicate_check: 'Проверка дублей',
};

const STEP_ORDER: LiveCoreAcceptanceStepKey[] = [
  'schema',
  'setup',
  'connection',
  'first_sync',
  'booking_check',
  'second_sync',
  'duplicate_check',
];

function harnessMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS,
    acceptance_safe: true,
    environment: 'test',
    ...extra,
  };
}

function emptySteps(): LiveCoreAcceptanceStep[] {
  return STEP_ORDER.map((key) => ({
    key,
    label: STEP_LABELS[key],
    status: 'waiting',
    detail: null,
  }));
}

function setStep(
  steps: LiveCoreAcceptanceStep[],
  key: LiveCoreAcceptanceStepKey,
  status: LiveCoreAcceptanceStepStatus,
  detail: string | null = null,
): void {
  const step = steps.find((item) => item.key === key);
  if (!step) return;
  step.status = status;
  step.detail = detail;
}

function emptyEvidence(partial: Partial<LiveCoreAcceptanceEvidence> = {}): LiveCoreAcceptanceEvidence {
  return {
    schemaReady: false,
    ownerSetupId: null,
    propertySetupId: null,
    connectionId: null,
    firstRunId: null,
    secondRunId: null,
    bookingOpsRecordId: null,
    firstRunStatus: null,
    secondRunStatus: null,
    importedFirstRun: null,
    importedSecondRun: null,
    duplicateCount: null,
    passed: false,
    blocker: null,
    failedStep: null,
    steps: emptySteps(),
    schema: null,
    ...partial,
  };
}

function failEvidence(
  evidence: LiveCoreAcceptanceEvidence,
  failedStep: LiveCoreAcceptanceStepKey,
  blocker: string,
): LiveCoreAcceptanceEvidence {
  setStep(evidence.steps, failedStep, 'failed', blocker);
  for (const step of evidence.steps) {
    if (step.status === 'waiting' || step.status === 'running') {
      step.status = 'waiting';
    }
  }
  return {
    ...evidence,
    passed: false,
    failedStep,
    blocker,
  };
}

function futureDate(daysFromNow: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

/** Safe fictional snapshot — no phone, email, address, credentials, door codes. */
export function buildLiveCoreAcceptanceSnapshot(propertySetupId: string): ManualChannelSnapshot {
  const checkIn = futureDate(30);
  const checkOut = futureDate(32);
  const snapshot: ManualChannelSnapshot = {
    objects: [{
      external_object_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_OBJECT_ID,
      title: LIVE_CORE_ACCEPTANCE_OBJECT_TITLE,
      city: LIVE_CORE_ACCEPTANCE_OBJECT_CITY,
      capacity: 2,
      status: 'active',
      property_setup_id: propertySetupId,
      safe_address_summary: 'Синтетический тестовый район',
    }],
    bookings: [{
      external_booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      external_object_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_OBJECT_ID,
      guest_safe_name: LIVE_CORE_ACCEPTANCE_GUEST_NAME,
      checkin_date: checkIn,
      checkout_date: checkOut,
      guest_count: 2,
      status: 'confirmed',
    }],
    calendar: [{
      external_object_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_OBJECT_ID,
      date: checkIn,
      availability_status: 'booked',
    }],
    pricing: [{
      external_object_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_OBJECT_ID,
      date: checkOut,
      availability_status: 'available',
      price_amount: 4500,
      currency: 'RUB',
    }],
  };
  if (findSecretPath(snapshot)) {
    throw new Error('Синтетический снимок содержит запрещённые секреты или контакты.');
  }
  return snapshot;
}

export function assertLiveCoreAcceptanceSnapshotSafe(snapshot: ManualChannelSnapshot): void {
  const secret = findSecretPath(snapshot);
  if (secret) throw new Error(`Синтетический снимок небезопасен: ${secret}`);
  const serialized = JSON.stringify(snapshot).toLowerCase();
  for (const banned of ['password', 'token', 'api_key', 'secret', 'door', 'wifi', '@', '+7', 'vault:']) {
    if (banned === '@') {
      // guest email patterns only — allow none
      if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(serialized)) {
        throw new Error('Синтетический снимок не должен содержать email.');
      }
      continue;
    }
    if (serialized.includes(banned)) {
      throw new Error(`Синтетический снимок не должен содержать «${banned}».`);
    }
  }
}

async function findHarnessOwnerSetup(): Promise<OwnerSetupProfile | null> {
  const byLead = await getOwnerSetupByLeadId(LIVE_CORE_ACCEPTANCE_LEAD_ID);
  if (byLead) return byLead;

  const byMeta = await supabase
    .from('booking_owner_setup_profiles')
    .select('id')
    .contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })
    .limit(1)
    .maybeSingle();
  if (byMeta.error) throw new Error(byMeta.error.message);
  if (!byMeta.data?.id) return null;
  return getOwnerSetupById(String(byMeta.data.id));
}

/**
 * Create/reuse synthetic owner + property setup marked with acceptanceHarness.
 * Uses canonical startObjectDataCollection / upsertPropertySetupData after owner row exists.
 * Owner row is inserted directly because initializeOwnerSetupFromLead requires a CRM lead.
 */
export async function ensureLiveCoreAcceptanceSetup(): Promise<{
  ownerSetup: OwnerSetupProfile;
  propertySetup: PropertySetupProfile;
  createdOwner: boolean;
  createdProperty: boolean;
}> {
  let createdOwner = false;
  let owner = await findHarnessOwnerSetup();
  if (!owner) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const { data, error } = await supabase
      .from('booking_owner_setup_profiles')
      .insert({
        id,
        lead_id: LIVE_CORE_ACCEPTANCE_LEAD_ID,
        owner_id: null,
        owner_name: 'ASI Live Core Acceptance Owner',
        owner_contact_ref: null,
        status: 'new',
        pilot_group: null,
        missing_fields: [],
        readiness_score: 0,
        metadata: harnessMetadata({ synthetic: true, kind: 'owner_setup' }),
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Не удалось создать тестовый профиль владельца.');
    owner = await getOwnerSetupById(String((data as { id: string }).id));
    if (!owner) throw new Error('Тестовый профиль владельца не найден после создания.');
    createdOwner = true;
  } else if (owner.metadata?.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS) {
    const now = new Date().toISOString();
    await supabase.from('booking_owner_setup_profiles').update({
      metadata: harnessMetadata({ ...owner.metadata, synthetic: true, kind: 'owner_setup' }),
      updated_at: now,
    }).eq('id', owner.id);
  }

  const before = await supabase
    .from('booking_property_setup_profiles')
    .select('id')
    .eq('owner_setup_id', owner.id)
    .limit(1)
    .maybeSingle();
  if (before.error) throw new Error(before.error.message);
  const createdProperty = !before.data;

  await startObjectDataCollection(owner.id, harnessMetadata({ synthetic: true, kind: 'property_setup' }));
  const propertySetup = await upsertPropertySetupData(owner.id, {
    title: LIVE_CORE_ACCEPTANCE_OBJECT_TITLE,
    addressCity: LIVE_CORE_ACCEPTANCE_OBJECT_CITY,
    addressSafeSummary: 'Синтетический тестовый район',
    propertyType: 'apartment',
    guestCapacity: 2,
    roomCount: 1,
    checkinTime: '15:00',
    checkoutTime: '11:00',
    propertyId: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
  }, harnessMetadata({ synthetic: true, kind: 'property_setup' }));

  return { ownerSetup: owner, propertySetup, createdOwner, createdProperty };
}

export async function ensureLiveCoreAcceptanceConnection(
  propertySetupId: string,
): Promise<{ connection: ChannelManagerConnection; created: boolean }> {
  const existing = await supabase
    .from('booking_channel_manager_connections')
    .select('*')
    .eq('property_setup_id', propertySetupId)
    .eq('provider', 'manual')
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const created = !existing.data;
  let connection = await initializeChannelManagerConnection(
    propertySetupId,
    'manual',
    harnessMetadata({ synthetic: true, kind: 'connection', liveCore: true }),
  );

  // Ensure harness marker survives ignoreDuplicates upsert path.
  if (connection.metadata?.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS) {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('booking_channel_manager_connections').update({
      metadata: harnessMetadata({ ...connection.metadata, synthetic: true, kind: 'connection', liveCore: true }),
      updated_at: now,
    }).eq('id', connection.id).select('*').single();
    if (error || !data) throw new Error(error?.message ?? 'Не удалось пометить тестовое подключение.');
    connection = {
      ...connection,
      metadata: (data.metadata as Record<string, unknown>) ?? connection.metadata,
      updatedAt: String(data.updated_at),
    };
  }

  if (connection.accessStatus !== 'received' || connection.status === 'not_requested' || connection.status === 'not_started') {
    connection = await markChannelManagerAccessReceived(
      connection.id,
      LIVE_CORE_ACCEPTANCE_SAFE_ACCESS_REF,
      harnessMetadata({ synthetic: true }),
    );
  }

  return { connection, created };
}

async function markBookingOpsAsHarness(bookingOpsRecordId: string): Promise<void> {
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,reservation_metadata')
    .eq('id', bookingOpsRecordId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const current = (data.reservation_metadata as Record<string, unknown>) ?? {};
  await supabase.from('booking_ops_records').update({
    reservation_metadata: harnessMetadata({
      ...current,
      synthetic: true,
      kind: 'booking_ops',
      test_reservation: true,
    }),
    updated_at: new Date().toISOString(),
  }).eq('id', bookingOpsRecordId);
}

async function countExternalBookings(connectionId: string, externalBookingId: string): Promise<number> {
  const { data, error } = await supabase
    .from('booking_channel_imported_bookings')
    .select('id,matched_booking_id,external_booking_id')
    .eq('connection_id', connectionId)
    .eq('external_booking_id', externalBookingId);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

async function resolveMatchedBookingOpsId(connectionId: string): Promise<string | null> {
  const bookings = await listImportedChannelBookings(connectionId);
  const match = bookings.find((row) => String(row.external_booking_id) === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);
  if (!match) return null;
  return match.matched_booking_id ? String(match.matched_booking_id) : null;
}

async function countBookingOpsForHarnessProperty(): Promise<number> {
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,reservation_metadata,property_id,booking_id')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return rows.filter((row) => {
    const meta = (row.reservation_metadata as Record<string, unknown>) ?? {};
    return meta.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS
      || String(row.booking_id ?? '') === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID;
  }).length;
}

/**
 * Full acceptance sequence A–H. Never sets passed unless every assertion is verified.
 */
export async function runChannelManagerLiveCoreAcceptance(): Promise<LiveCoreAcceptanceEvidence> {
  const evidence = emptyEvidence();
  const steps = evidence.steps;

  // A. Schema probe — fail before setup when not ready.
  setStep(steps, 'schema', 'running');
  const schema = await probeChannelLiveCoreSchema();
  evidence.schema = schema;
  evidence.schemaReady = schema.ready === true;
  if (!schema.ready) {
    return failEvidence(
      evidence,
      'schema',
      schema.blocker ?? 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.',
    );
  }
  setStep(steps, 'schema', 'passed', 'Схема Live Core готова.');

  // B. Create/reuse acceptance setup
  setStep(steps, 'setup', 'running');
  let ownerSetup: OwnerSetupProfile;
  let propertySetup: PropertySetupProfile;
  try {
    const setup = await ensureLiveCoreAcceptanceSetup();
    ownerSetup = setup.ownerSetup;
    propertySetup = setup.propertySetup;
    evidence.ownerSetupId = ownerSetup.id;
    evidence.propertySetupId = propertySetup.id;
    if (ownerSetup.metadata?.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS
      && propertySetup.metadata?.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS) {
      // upsertPropertySetupData merges metadata — re-check from DB if needed
      const { data } = await supabase.from('booking_property_setup_profiles').select('metadata').eq('id', propertySetup.id).maybeSingle();
      const meta = (data?.metadata as Record<string, unknown>) ?? {};
      if (meta.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS) {
        return failEvidence(evidence, 'setup', 'Тестовый объект не помечен acceptanceHarness.');
      }
    }
    setStep(steps, 'setup', 'passed', setup.createdOwner || setup.createdProperty ? 'Тестовый контур создан.' : 'Тестовый контур переиспользован.');
  } catch (error) {
    return failEvidence(evidence, 'setup', error instanceof Error ? error.message : 'Не удалось подготовить тестовый объект.');
  }

  // Connection
  setStep(steps, 'connection', 'running');
  let connection: ChannelManagerConnection;
  try {
    const ensured = await ensureLiveCoreAcceptanceConnection(propertySetup.id);
    connection = ensured.connection;
    evidence.connectionId = connection.id;
    if (connection.metadata?.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS) {
      return failEvidence(evidence, 'connection', 'Подключение МК не помечено acceptanceHarness.');
    }
    setStep(steps, 'connection', 'passed', ensured.created ? 'Подключение создано.' : 'Подключение переиспользовано.');
  } catch (error) {
    return failEvidence(evidence, 'connection', error instanceof Error ? error.message : 'Не удалось создать подключение МК.');
  }

  const snapshot = buildLiveCoreAcceptanceSnapshot(propertySetup.id);
  try {
    assertLiveCoreAcceptanceSnapshotSafe(snapshot);
  } catch (error) {
    return failEvidence(evidence, 'first_sync', error instanceof Error ? error.message : 'Снимок небезопасен.');
  }

  // C. First initial sync
  setStep(steps, 'first_sync', 'running');
  let first: ChannelLiveSyncResult;
  try {
    first = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot,
      metadata: harnessMetadata({ acceptanceRun: 'first' }),
    });
    evidence.firstRunId = first.run.id;
    evidence.firstRunStatus = first.status;
    evidence.importedFirstRun = first.counters.imported;
    if (first.status !== 'completed' && first.status !== 'completed_with_warnings') {
      return failEvidence(
        evidence,
        'first_sync',
        first.safeError?.message ?? `Первый sync завершился со статусом ${first.status}.`,
      );
    }
    setStep(steps, 'first_sync', 'passed', `Статус ${first.status}, imported=${first.counters.imported}.`);
  } catch (error) {
    return failEvidence(evidence, 'first_sync', error instanceof Error ? error.message : 'Первый initial sync не выполнен.');
  }

  // D. Verify exactly one imported external booking
  setStep(steps, 'booking_check', 'running');
  try {
    const importedCount = await countExternalBookings(connection.id, LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);
    if (importedCount !== 1) {
      return failEvidence(evidence, 'booking_check', `Ожидалась ровно 1 импортированная бронь, найдено ${importedCount}.`);
    }
    if (evidence.importedFirstRun !== 1) {
      return failEvidence(
        evidence,
        'booking_check',
        `Счётчик imported первого запуска должен быть 1, получено ${evidence.importedFirstRun}.`,
      );
    }
    const bookingOpsId = await resolveMatchedBookingOpsId(connection.id);
    if (!bookingOpsId) {
      return failEvidence(evidence, 'booking_check', 'Booking Ops запись для импортированной брони не найдена.');
    }
    evidence.bookingOpsRecordId = bookingOpsId;
    await markBookingOpsAsHarness(bookingOpsId);
    setStep(steps, 'booking_check', 'passed', 'Импортирована ровно одна бронь и создана запись Booking Ops.');
  } catch (error) {
    return failEvidence(evidence, 'booking_check', error instanceof Error ? error.message : 'Проверка брони не выполнена.');
  }

  // E. Second initial sync
  setStep(steps, 'second_sync', 'running');
  let second: ChannelLiveSyncResult;
  try {
    second = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot,
      metadata: harnessMetadata({ acceptanceRun: 'second' }),
    });
    evidence.secondRunId = second.run.id;
    evidence.secondRunStatus = second.status;
    evidence.importedSecondRun = second.counters.imported;
    if (second.status !== 'completed' && second.status !== 'completed_with_warnings') {
      return failEvidence(
        evidence,
        'second_sync',
        second.safeError?.message ?? `Повторный sync завершился со статусом ${second.status}.`,
      );
    }
    if (evidence.secondRunId === evidence.firstRunId) {
      return failEvidence(evidence, 'second_sync', 'Повторный sync не создал отдельный run id.');
    }
    setStep(steps, 'second_sync', 'passed', `Статус ${second.status}, imported=${second.counters.imported}.`);
  } catch (error) {
    return failEvidence(evidence, 'second_sync', error instanceof Error ? error.message : 'Повторный sync не выполнен.');
  }

  // F–G. No duplicate + counters / last successful sync
  setStep(steps, 'duplicate_check', 'running');
  try {
    if (evidence.importedSecondRun !== 0) {
      return failEvidence(
        evidence,
        'duplicate_check',
        `Повторный sync должен импортировать 0 броней, получено ${evidence.importedSecondRun}.`,
      );
    }
    const importedCount = await countExternalBookings(connection.id, LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);
    if (importedCount !== 1) {
      return failEvidence(evidence, 'duplicate_check', `После повтора ожидалась 1 строка импорта, найдено ${importedCount}.`);
    }
    const opsCount = await countBookingOpsForHarnessProperty();
    evidence.duplicateCount = Math.max(0, opsCount - 1);
    if (opsCount !== 1) {
      return failEvidence(evidence, 'duplicate_check', `Ожидалась 1 Booking Ops запись, найдено ${opsCount}.`);
    }

    const status = await getChannelLiveCoreStatus(connection.id);
    if (!status.lastSuccessfulSyncAt) {
      return failEvidence(evidence, 'duplicate_check', 'lastSuccessfulSyncAt не зафиксирован после успешного sync.');
    }
    const runs = await listChannelImportRuns(connection.id);
    const firstRun = runs.find((run) => run.id === evidence.firstRunId);
    const secondRun = runs.find((run) => run.id === evidence.secondRunId);
    if (!firstRun || !secondRun) {
      return failEvidence(evidence, 'duplicate_check', 'Не удалось проверить evidence обоих import runs.');
    }
    if (!['completed', 'completed_with_warnings'].includes(firstRun.status)
      || !['completed', 'completed_with_warnings'].includes(secondRun.status)) {
      return failEvidence(evidence, 'duplicate_check', 'Статусы import runs не подтверждены.');
    }

    setStep(steps, 'duplicate_check', 'passed', 'Дублей нет; счётчики и last successful sync подтверждены.');
  } catch (error) {
    return failEvidence(evidence, 'duplicate_check', error instanceof Error ? error.message : 'Проверка дублей не выполнена.');
  }

  const allPassed = evidence.steps.every((step) => step.status === 'passed');
  if (!allPassed) {
    const failed = evidence.steps.find((step) => step.status === 'failed');
    return failEvidence(evidence, failed?.key ?? 'duplicate_check', failed?.detail ?? 'Не все шаги подтверждены.');
  }

  return {
    ...evidence,
    passed: true,
    blocker: null,
    failedStep: null,
  };
}

async function deleteBookingOpsTree(bookingOpsIds: string[]): Promise<number> {
  if (bookingOpsIds.length === 0) return 0;
  const childTables = [
    'booking_ops_worker_tasks',
    'booking_ops_tasks',
    'booking_ops_events',
    'booking_ops_communication_intents',
    'booking_ops_communication_deliveries',
    'booking_ops_lifecycle_drafts',
    'booking_ops_lifecycle_states',
    'booking_ops_inbound_intake_events',
  ] as const;

  for (const table of childTables) {
    // Best-effort: table may not exist in all environments.
    const byRecord = await supabase.from(table).delete().in('booking_ops_record_id', bookingOpsIds);
    if (byRecord.error && byRecord.error.code !== '42P01' && !/column .* does not exist/i.test(byRecord.error.message ?? '')) {
      const byBooking = await supabase.from(table).delete().in('booking_id', bookingOpsIds);
      if (byBooking.error && byBooking.error.code !== '42P01' && !/column .* does not exist/i.test(byBooking.error.message ?? '')) {
        // ignore missing alternate FK column
      }
    }
  }

  const { data, error } = await supabase
    .from('booking_ops_records')
    .delete()
    .in('id', bookingOpsIds)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/**
 * Delete only records carrying acceptanceHarness = channel_manager_live_core_v1.
 * Never deletes ordinary pilot/customer data.
 */
export async function cleanupLiveCoreAcceptanceHarness(): Promise<LiveCoreAcceptanceCleanupResult> {
  const owners = await supabase
    .from('booking_owner_setup_profiles')
    .select('id,metadata,lead_id')
    .or(`lead_id.eq.${LIVE_CORE_ACCEPTANCE_LEAD_ID},metadata->>acceptanceHarness.eq.${LIVE_CORE_ACCEPTANCE_HARNESS}`);
  if (owners.error) throw new Error(owners.error.message);

  const ownerIds = (owners.data ?? [])
    .filter((row) => {
      const meta = (row.metadata as Record<string, unknown>) ?? {};
      return row.lead_id === LIVE_CORE_ACCEPTANCE_LEAD_ID
        || meta.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS;
    })
    .map((row) => String(row.id));

  if (ownerIds.length === 0) {
    return {
      ok: true,
      deleted: { bookingOpsRecords: 0, connections: 0, propertySetups: 0, ownerSetups: 0, communicationIntents: 0 },
      preservedOrdinaryData: true,
    };
  }

  const properties = await supabase
    .from('booking_property_setup_profiles')
    .select('id,metadata,property_id,owner_setup_id')
    .in('owner_setup_id', ownerIds);
  if (properties.error) throw new Error(properties.error.message);

  const propertyRows = (properties.data ?? []).filter((row) => {
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    return meta.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS
      || ownerIds.includes(String(row.owner_setup_id));
  });
  const propertyIds = propertyRows.map((row) => String(row.id));

  const connections = propertyIds.length
    ? await supabase
      .from('booking_channel_manager_connections')
      .select('id,metadata,property_setup_id')
      .in('property_setup_id', propertyIds)
    : { data: [], error: null };
  if (connections.error) throw new Error(connections.error.message);

  const connectionRows = (connections.data ?? []).filter((row) => {
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    return meta.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS
      || propertyIds.includes(String(row.property_setup_id));
  });
  const connectionIds = connectionRows.map((row) => String(row.id));

  const bookingOpsIds = new Set<string>();
  if (connectionIds.length) {
    const imported = await supabase
      .from('booking_channel_imported_bookings')
      .select('matched_booking_id')
      .in('connection_id', connectionIds);
    if (imported.error) throw new Error(imported.error.message);
    for (const row of imported.data ?? []) {
      if (row.matched_booking_id) bookingOpsIds.add(String(row.matched_booking_id));
    }
  }

  const markedOps = await supabase
    .from('booking_ops_records')
    .select('id,reservation_metadata,property_id')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID);
  if (!markedOps.error) {
    for (const row of markedOps.data ?? []) {
      const meta = (row.reservation_metadata as Record<string, unknown>) ?? {};
      if (meta.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS) {
        bookingOpsIds.add(String(row.id));
      }
    }
  }

  const deletedOps = await deleteBookingOpsTree([...bookingOpsIds]);

  let deletedConnections = 0;
  if (connectionIds.length) {
    const { data, error } = await supabase
      .from('booking_channel_manager_connections')
      .delete()
      .in('id', connectionIds)
      .select('id');
    if (error) throw new Error(error.message);
    deletedConnections = (data ?? []).length;
  }

  let deletedProperties = 0;
  if (propertyIds.length) {
    const { data, error } = await supabase
      .from('booking_property_setup_profiles')
      .delete()
      .in('id', propertyIds)
      .select('id');
    if (error) throw new Error(error.message);
    deletedProperties = (data ?? []).length;
  }

  let deletedIntents = 0;
  const intents = await supabase
    .from('booking_owner_setup_communication_intents')
    .delete()
    .in('owner_setup_id', ownerIds)
    .select('id');
  if (!intents.error) deletedIntents = (intents.data ?? []).length;

  const { data: deletedOwners, error: ownerDeleteError } = await supabase
    .from('booking_owner_setup_profiles')
    .delete()
    .in('id', ownerIds)
    .select('id');
  if (ownerDeleteError) throw new Error(ownerDeleteError.message);

  return {
    ok: true,
    deleted: {
      bookingOpsRecords: deletedOps,
      connections: deletedConnections,
      propertySetups: deletedProperties,
      ownerSetups: (deletedOwners ?? []).length,
      communicationIntents: deletedIntents,
    },
    preservedOrdinaryData: true,
  };
}

export function describeLiveCoreAcceptanceUnavailable(schema: ChannelLiveCoreSchemaState | null): string {
  if (!schema) return 'Статус схемы Live Core ещё не проверен.';
  if (!schema.ready) {
    return schema.blocker
      ?? 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.';
  }
  return 'Тестовый контур Live Core ещё не подготовлен. Нажмите «Подготовить и запустить тест».';
}
