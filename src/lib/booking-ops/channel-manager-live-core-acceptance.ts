/**
 * Channel Manager Live Core Acceptance Harness v1
 *
 * Owner-only synthetic acceptance: prepare/reuse a marked test contour,
 * reset prior execution artifacts, run initial sync twice, verify import +
 * idempotency, cleanup harness rows only.
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
export const LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE = 'channel_manager_placeholder' as const;
export const LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY =
  `ext:${LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE}:${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID}`;

export const HARNESS_IDENTITY_COLLISION = 'harness_identity_collision';

export type LiveCoreAcceptanceStepKey =
  | 'schema'
  | 'setup'
  | 'connection'
  | 'execution_reset'
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
  acceptanceExecutionId: string | null;
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

export type LiveCoreAcceptanceCleanupDeleted = {
  bookingOpsRecords: number;
  connections: number;
  propertySetups: number;
  ownerSetups: number;
  communicationIntents: number;
  intakeEvents: number;
  availabilityHolds: number;
  overbookingChecks: number;
  telegramDrafts: number;
  reservationImportRows: number;
  reservationReconciliationItems: number;
  reservationLedgerAudit: number;
  importedBookings: number;
};

export type LiveCoreAcceptanceCleanupResult = {
  ok: boolean;
  cleanupPassed: boolean;
  scopeVerified: boolean;
  remainingHarnessRows: number;
  remainingActiveHolds: number;
  remainingIntakeEvents: number;
  deleted: LiveCoreAcceptanceCleanupDeleted;
  failedStage: string | null;
  blocker: string | null;
};

export class LiveCoreAcceptanceHarnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LiveCoreAcceptanceHarnessError';
    this.code = code;
  }
}

const STEP_LABELS: Record<LiveCoreAcceptanceStepKey, string> = {
  schema: 'Схема Live Core',
  setup: 'Тестовый объект',
  connection: 'Подключение МК',
  execution_reset: 'Сброс предыдущего прогона',
  first_sync: 'Первый initial sync',
  booking_check: 'Проверка брони',
  second_sync: 'Повторный sync',
  duplicate_check: 'Проверка дублей',
};

const STEP_ORDER: LiveCoreAcceptanceStepKey[] = [
  'schema',
  'setup',
  'connection',
  'execution_reset',
  'first_sync',
  'booking_check',
  'second_sync',
  'duplicate_check',
];

const BOOKING_OPS_CASCADE_CHILD_TABLES = [
  'booking_ops_worker_tasks',
  'booking_ops_tasks',
  'booking_ops_events',
  'booking_ops_communication_intents',
  'booking_ops_communication_deliveries',
  'booking_ops_lifecycle_drafts',
  'booking_ops_lifecycle_states',
] as const;

function emptyDeletedCounters(): LiveCoreAcceptanceCleanupDeleted {
  return {
    bookingOpsRecords: 0,
    connections: 0,
    propertySetups: 0,
    ownerSetups: 0,
    communicationIntents: 0,
    intakeEvents: 0,
    availabilityHolds: 0,
    overbookingChecks: 0,
    telegramDrafts: 0,
    reservationImportRows: 0,
    reservationReconciliationItems: 0,
    reservationLedgerAudit: 0,
    importedBookings: 0,
  };
}

function harnessMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS,
    acceptance_safe: true,
    environment: 'test',
    ...extra,
  };
}

function hasHarnessMarker(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>).acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS;
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
    acceptanceExecutionId: null,
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

function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist|does not exist/i.test(error.message ?? '');
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || /column .* does not exist/i.test(error.message ?? '');
}

function isRestrictiveOrPermissionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '23503'
    || error.code === '42501'
    || /foreign key|violates foreign key|permission denied|insufficient privilege/i.test(error.message ?? '');
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

function mapPropertyRow(row: Record<string, unknown>): PropertySetupProfile {
  return {
    id: String(row.id),
    ownerSetupId: row.owner_setup_id ? String(row.owner_setup_id) : null,
    leadId: row.lead_id ? String(row.lead_id) : null,
    propertyId: row.property_id ? String(row.property_id) : null,
    title: row.title ? String(row.title) : null,
    addressCity: row.address_city ? String(row.address_city) : null,
    addressArea: row.address_area ? String(row.address_area) : null,
    addressSafeSummary: row.address_safe_summary ? String(row.address_safe_summary) : null,
    propertyType: row.property_type ? String(row.property_type) : null,
    guestCapacity: typeof row.guest_capacity === 'number' ? row.guest_capacity : null,
    roomCount: typeof row.room_count === 'number' ? row.room_count : null,
    checkinTime: row.checkin_time ? String(row.checkin_time) : null,
    checkoutTime: row.checkout_time ? String(row.checkout_time) : null,
    wifiStatus: (row.wifi_status as PropertySetupProfile['wifiStatus']) ?? 'missing',
    rulesStatus: (row.rules_status as PropertySetupProfile['rulesStatus']) ?? 'missing',
    photosStatus: (row.photos_status as PropertySetupProfile['photosStatus']) ?? 'missing',
    pricingStatus: (row.pricing_status as PropertySetupProfile['pricingStatus']) ?? 'missing',
    channelAccessStatus: (row.channel_access_status as PropertySetupProfile['channelAccessStatus']) ?? 'not_requested',
    status: String(row.status ?? 'collecting_data') as PropertySetupProfile['status'],
    missingFields: Array.isArray(row.missing_fields) ? row.missing_fields.map(String) : [],
    readinessScore: typeof row.readiness_score === 'number' ? row.readiness_score : 0,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    channelHandoffStatus: (row.channel_handoff_status as PropertySetupProfile['channelHandoffStatus']) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/**
 * Resolve harness owner by exact marker only.
 * Reserved lead_id without marker → fail closed (never adopt/relabel).
 */
export async function findHarnessOwnerSetup(): Promise<OwnerSetupProfile | null> {
  const byLead = await getOwnerSetupByLeadId(LIVE_CORE_ACCEPTANCE_LEAD_ID);
  if (byLead) {
    if (!hasHarnessMarker(byLead.metadata)) {
      throw new LiveCoreAcceptanceHarnessError(
        HARNESS_IDENTITY_COLLISION,
        `${HARNESS_IDENTITY_COLLISION}: lead_id ${LIVE_CORE_ACCEPTANCE_LEAD_ID} занят записью без acceptanceHarness.`,
      );
    }
    return byLead;
  }

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

async function findMarkedPropertySetup(ownerSetupId: string): Promise<PropertySetupProfile | null> {
  const byPropertyId = await supabase
    .from('booking_property_setup_profiles')
    .select('*')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .limit(1)
    .maybeSingle();
  if (byPropertyId.error) throw new Error(byPropertyId.error.message);
  if (byPropertyId.data) {
    if (!hasHarnessMarker(byPropertyId.data.metadata)) {
      throw new LiveCoreAcceptanceHarnessError(
        HARNESS_IDENTITY_COLLISION,
        `${HARNESS_IDENTITY_COLLISION}: property_id ${LIVE_CORE_ACCEPTANCE_PROPERTY_ID} занят записью без acceptanceHarness.`,
      );
    }
    return mapPropertyRow(byPropertyId.data as Record<string, unknown>);
  }

  const marked = await supabase
    .from('booking_property_setup_profiles')
    .select('*')
    .eq('owner_setup_id', ownerSetupId)
    .contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })
    .limit(1)
    .maybeSingle();
  if (marked.error) throw new Error(marked.error.message);
  if (!marked.data) return null;
  return mapPropertyRow(marked.data as Record<string, unknown>);
}

/**
 * Create/reuse synthetic owner + property setup marked with acceptanceHarness.
 * Never adopts or relabels unmarked records.
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
        status: 'data_collection_started',
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
    if (!hasHarnessMarker(owner.metadata)) {
      throw new LiveCoreAcceptanceHarnessError(
        HARNESS_IDENTITY_COLLISION,
        `${HARNESS_IDENTITY_COLLISION}: созданный owner setup потерял acceptanceHarness.`,
      );
    }
    createdOwner = true;
  }

  let propertySetup = await findMarkedPropertySetup(owner.id);
  let createdProperty = false;
  const now = new Date().toISOString();

  if (!propertySetup) {
    const id = randomUUID();
    const { data, error } = await supabase
      .from('booking_property_setup_profiles')
      .insert({
        id,
        owner_setup_id: owner.id,
        lead_id: owner.leadId,
        property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
        title: LIVE_CORE_ACCEPTANCE_OBJECT_TITLE,
        address_city: LIVE_CORE_ACCEPTANCE_OBJECT_CITY,
        address_safe_summary: 'Синтетический тестовый район',
        property_type: 'apartment',
        guest_capacity: 2,
        room_count: 1,
        checkin_time: '15:00',
        checkout_time: '11:00',
        status: 'collecting_data',
        missing_fields: [],
        readiness_score: 0,
        channel_access_status: 'not_requested',
        metadata: harnessMetadata({ synthetic: true, kind: 'property_setup' }),
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Не удалось создать тестовый профиль объекта.');
    propertySetup = mapPropertyRow(data as Record<string, unknown>);
    createdProperty = true;
  } else {
    const { data, error } = await supabase
      .from('booking_property_setup_profiles')
      .update({
        title: LIVE_CORE_ACCEPTANCE_OBJECT_TITLE,
        address_city: LIVE_CORE_ACCEPTANCE_OBJECT_CITY,
        address_safe_summary: 'Синтетический тестовый район',
        property_type: 'apartment',
        guest_capacity: 2,
        room_count: 1,
        checkin_time: '15:00',
        checkout_time: '11:00',
        property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
        metadata: harnessMetadata({
          ...propertySetup.metadata,
          synthetic: true,
          kind: 'property_setup',
        }),
        updated_at: now,
      })
      .eq('id', propertySetup.id)
      .contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить помеченный тестовый объект.');
    propertySetup = mapPropertyRow(data as Record<string, unknown>);
  }

  if (!hasHarnessMarker(propertySetup.metadata)) {
    throw new LiveCoreAcceptanceHarnessError(
      HARNESS_IDENTITY_COLLISION,
      `${HARNESS_IDENTITY_COLLISION}: property setup без acceptanceHarness.`,
    );
  }

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

  if (existing.data) {
    if (!hasHarnessMarker(existing.data.metadata)) {
      throw new LiveCoreAcceptanceHarnessError(
        HARNESS_IDENTITY_COLLISION,
        `${HARNESS_IDENTITY_COLLISION}: подключение МК для тестового объекта существует без acceptanceHarness.`,
      );
    }
  }

  const created = !existing.data;
  let connection = await initializeChannelManagerConnection(
    propertySetupId,
    'manual',
    harnessMetadata({ synthetic: true, kind: 'connection', liveCore: true }),
  );

  if (!hasHarnessMarker(connection.metadata)) {
    throw new LiveCoreAcceptanceHarnessError(
      HARNESS_IDENTITY_COLLISION,
      `${HARNESS_IDENTITY_COLLISION}: подключение МК без acceptanceHarness — изменение запрещено.`,
    );
  }

  if (connection.accessStatus !== 'received' || connection.status === 'not_requested' || connection.status === 'not_started') {
    connection = await markChannelManagerAccessReceived(
      connection.id,
      LIVE_CORE_ACCEPTANCE_SAFE_ACCESS_REF,
      harnessMetadata({ synthetic: true }),
    );
    if (!hasHarnessMarker(connection.metadata)) {
      throw new LiveCoreAcceptanceHarnessError(
        HARNESS_IDENTITY_COLLISION,
        `${HARNESS_IDENTITY_COLLISION}: подключение потеряло acceptanceHarness после markAccessReceived.`,
      );
    }
  }

  return { connection, created };
}

async function markBookingOpsAsHarness(
  bookingOpsRecordId: string,
  acceptanceExecutionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,reservation_metadata')
    .eq('id', bookingOpsRecordId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const current = (data.reservation_metadata as Record<string, unknown>) ?? {};
  const { error: updateError } = await supabase.from('booking_ops_records').update({
    reservation_metadata: harnessMetadata({
      ...current,
      synthetic: true,
      kind: 'booking_ops',
      test_reservation: true,
      acceptanceExecutionId,
    }),
    updated_at: new Date().toISOString(),
  }).eq('id', bookingOpsRecordId);
  if (updateError) throw new Error(updateError.message);
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
  return (data ?? []).filter((row) => hasHarnessMarker(row.reservation_metadata)).length;
}

async function listMarkedHarnessBookingOpsIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,reservation_metadata,property_id,booking_id')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => (
      hasHarnessMarker(row.reservation_metadata)
      && String(row.booking_id ?? '') === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID
    ))
    .map((row) => String(row.id));
}

type MutationResult = { deleted: number; error: string | null; optionalMissing?: boolean };

async function deleteByBookingOpsIds(
  table: string,
  column: string,
  bookingOpsIds: string[],
  options?: { optional?: boolean },
): Promise<MutationResult> {
  if (bookingOpsIds.length === 0) return { deleted: 0, error: null };
  const { data, error } = await supabase
    .from(table)
    .delete()
    .in(column, bookingOpsIds)
    .select('id');
  if (error) {
    if (options?.optional && (isMissingRelationError(error) || isMissingColumnError(error))) {
      return { deleted: 0, error: null, optionalMissing: true };
    }
    return { deleted: 0, error: `${table}: ${error.message}` };
  }
  return { deleted: (data ?? []).length, error: null };
}

async function releaseOrDeleteAvailabilityHolds(bookingOpsIds: string[]): Promise<MutationResult> {
  let deleted = 0;

  if (bookingOpsIds.length > 0) {
    const byBooking = await supabase
      .from('booking_availability_holds')
      .delete()
      .in('booking_id', bookingOpsIds)
      .select('id');
    if (byBooking.error) {
      if (isRestrictiveOrPermissionError(byBooking.error) || (!isMissingRelationError(byBooking.error) && !isMissingColumnError(byBooking.error))) {
        return { deleted: 0, error: `booking_availability_holds: ${byBooking.error.message}` };
      }
    } else {
      deleted += (byBooking.data ?? []).length;
    }
  }

  const byProperty = await supabase
    .from('booking_availability_holds')
    .delete()
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .select('id');
  if (byProperty.error) {
    if (isMissingRelationError(byProperty.error)) return { deleted, error: null, optionalMissing: true };
    return { deleted, error: `booking_availability_holds: ${byProperty.error.message}` };
  }
  deleted += (byProperty.data ?? []).length;

  // Release any residual active holds that could not be deleted (SET NULL leftovers).
  const release = await supabase
    .from('booking_availability_holds')
    .update({ status: 'released', updated_at: new Date().toISOString() })
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .in('status', ['active', 'confirmed'])
    .select('id');
  if (release.error && !isMissingRelationError(release.error) && !isMissingColumnError(release.error)) {
    return { deleted, error: `booking_availability_holds.release: ${release.error.message}` };
  }

  return { deleted, error: null };
}

async function deleteOverbookingChecks(bookingOpsIds: string[]): Promise<MutationResult> {
  let deleted = 0;
  if (bookingOpsIds.length > 0) {
    const byBooking = await supabase
      .from('booking_overbooking_conflict_checks')
      .delete()
      .in('booking_id', bookingOpsIds)
      .select('id');
    if (byBooking.error) {
      if (!isMissingRelationError(byBooking.error) && !isMissingColumnError(byBooking.error)) {
        return { deleted: 0, error: `booking_overbooking_conflict_checks: ${byBooking.error.message}` };
      }
    } else {
      deleted += (byBooking.data ?? []).length;
    }
  }

  const byProperty = await supabase
    .from('booking_overbooking_conflict_checks')
    .delete()
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .select('id');
  if (byProperty.error) {
    if (isMissingRelationError(byProperty.error)) return { deleted, error: null, optionalMissing: true };
    return { deleted, error: `booking_overbooking_conflict_checks: ${byProperty.error.message}` };
  }
  deleted += (byProperty.data ?? []).length;
  return { deleted, error: null };
}

async function deleteTelegramDrafts(bookingOpsIds: string[]): Promise<MutationResult> {
  let deleted = 0;
  if (bookingOpsIds.length > 0) {
    const byRecord = await supabase
      .from('booking_ops_telegram_drafts')
      .delete()
      .in('booking_ops_record_id', bookingOpsIds)
      .select('id');
    if (byRecord.error) {
      return { deleted: 0, error: `booking_ops_telegram_drafts: ${byRecord.error.message}` };
    }
    deleted += (byRecord.data ?? []).length;
  }

  const bySource = await supabase
    .from('booking_ops_telegram_drafts')
    .delete()
    .eq('source_booking_id', LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID)
    .select('id');
  if (bySource.error) {
    if (isMissingColumnError(bySource.error)) return { deleted, error: null };
    return { deleted, error: `booking_ops_telegram_drafts.source: ${bySource.error.message}` };
  }
  deleted += (bySource.data ?? []).length;
  return { deleted, error: null };
}

async function deleteReservationArtifacts(bookingOpsIds: string[]): Promise<{
  importRows: MutationResult;
  reconciliation: MutationResult;
  ledger: MutationResult;
}> {
  const importRows = await deleteByBookingOpsIds(
    'reservation_import_rows',
    'booking_ops_record_id',
    bookingOpsIds,
    { optional: true },
  );
  const reconciliation = await deleteByBookingOpsIds(
    'reservation_reconciliation_items',
    'booking_ops_record_id',
    bookingOpsIds,
    { optional: true },
  );
  const ledger = await deleteByBookingOpsIds(
    'reservation_ledger_audit',
    'booking_ops_record_id',
    bookingOpsIds,
    { optional: true },
  );
  return { importRows, reconciliation, ledger };
}

/**
 * Delete only the exact synthetic intake event for this harness booking.
 * Uses production table booking_inbound_intake_events.
 */
export async function deleteHarnessIntakeEvents(): Promise<MutationResult> {
  const { data, error } = await supabase
    .from('booking_inbound_intake_events')
    .delete()
    .eq('source', LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE)
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .or(
      `source_ref.eq.${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID},idempotency_key.eq.${LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY}`,
    )
    .select('id');
  if (error) {
    return { deleted: 0, error: `booking_inbound_intake_events: ${error.message}` };
  }
  return { deleted: (data ?? []).length, error: null };
}

export async function countHarnessIntakeEvents(): Promise<number> {
  const { data, error } = await supabase
    .from('booking_inbound_intake_events')
    .select('id')
    .eq('source', LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE)
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .or(
      `source_ref.eq.${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID},idempotency_key.eq.${LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY}`,
    );
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

async function deleteBookingOpsDescendants(bookingOpsIds: string[]): Promise<{ error: string | null }> {
  if (bookingOpsIds.length === 0) return { error: null };

  for (const table of BOOKING_OPS_CASCADE_CHILD_TABLES) {
    const byRecord = await supabase.from(table).delete().in('booking_ops_record_id', bookingOpsIds).select('id');
    if (byRecord.error) {
      if (isMissingRelationError(byRecord.error) || isMissingColumnError(byRecord.error)) {
        const byBooking = await supabase.from(table).delete().in('booking_id', bookingOpsIds).select('id');
        if (byBooking.error) {
          if (isMissingRelationError(byBooking.error) || isMissingColumnError(byBooking.error)) continue;
          if (isRestrictiveOrPermissionError(byBooking.error)) {
            return { error: `${table}: ${byBooking.error.message}` };
          }
          return { error: `${table}: ${byBooking.error.message}` };
        }
        continue;
      }
      return { error: `${table}: ${byRecord.error.message}` };
    }
  }
  return { error: null };
}

async function deleteMarkedBookingOpsRecords(bookingOpsIds: string[]): Promise<MutationResult> {
  if (bookingOpsIds.length === 0) return { deleted: 0, error: null };
  const { data, error } = await supabase
    .from('booking_ops_records')
    .delete()
    .in('id', bookingOpsIds)
    .select('id');
  if (error) return { deleted: 0, error: `booking_ops_records: ${error.message}` };
  return { deleted: (data ?? []).length, error: null };
}

async function deleteHarnessImportedBookings(connectionIds: string[]): Promise<MutationResult> {
  if (connectionIds.length === 0) return { deleted: 0, error: null };
  const { data, error } = await supabase
    .from('booking_channel_imported_bookings')
    .delete()
    .in('connection_id', connectionIds)
    .eq('external_booking_id', LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID)
    .select('id');
  if (error) return { deleted: 0, error: `booking_channel_imported_bookings: ${error.message}` };
  return { deleted: (data ?? []).length, error: null };
}

/**
 * Reset previous synthetic execution artifacts while preserving marked
 * owner / property / connection setup. Required before each acceptance run.
 */
export async function resetLiveCoreAcceptanceExecutionArtifacts(input: {
  connectionId: string;
  propertySetupId: string;
}): Promise<{ ok: true } | { ok: false; stage: string; blocker: string }> {
  const bookingOpsIds = await listMarkedHarnessBookingOpsIds();

  // Also collect booking ops referenced by harness imported bookings on this connection.
  const imported = await supabase
    .from('booking_channel_imported_bookings')
    .select('id,matched_booking_id,external_booking_id')
    .eq('connection_id', input.connectionId)
    .eq('external_booking_id', LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);
  if (imported.error) {
    return { ok: false, stage: 'imported_bookings_lookup', blocker: imported.error.message };
  }
  const ids = new Set(bookingOpsIds);
  for (const row of imported.data ?? []) {
    if (row.matched_booking_id) ids.add(String(row.matched_booking_id));
  }
  const opsIds = [...ids];

  const intake = await deleteHarnessIntakeEvents();
  if (intake.error) return { ok: false, stage: 'intake_events', blocker: intake.error };

  const holds = await releaseOrDeleteAvailabilityHolds(opsIds);
  if (holds.error) return { ok: false, stage: 'availability_holds', blocker: holds.error };

  const checks = await deleteOverbookingChecks(opsIds);
  if (checks.error) return { ok: false, stage: 'overbooking_checks', blocker: checks.error };

  const drafts = await deleteTelegramDrafts(opsIds);
  if (drafts.error) return { ok: false, stage: 'telegram_drafts', blocker: drafts.error };

  const reservation = await deleteReservationArtifacts(opsIds);
  if (reservation.importRows.error) {
    return { ok: false, stage: 'reservation_import_rows', blocker: reservation.importRows.error };
  }
  if (reservation.reconciliation.error) {
    return { ok: false, stage: 'reservation_reconciliation_items', blocker: reservation.reconciliation.error };
  }
  if (reservation.ledger.error) {
    return { ok: false, stage: 'reservation_ledger_audit', blocker: reservation.ledger.error };
  }

  const descendants = await deleteBookingOpsDescendants(opsIds);
  if (descendants.error) return { ok: false, stage: 'booking_ops_descendants', blocker: descendants.error };

  // Clear FK from imported bookings before deleting booking ops (ON DELETE SET NULL, but be explicit).
  if (opsIds.length > 0) {
    const clearMatch = await supabase
      .from('booking_channel_imported_bookings')
      .update({ matched_booking_id: null, match_status: 'unmatched', updated_at: new Date().toISOString() })
      .in('matched_booking_id', opsIds)
      .select('id');
    if (clearMatch.error && !isMissingColumnError(clearMatch.error)) {
      return { ok: false, stage: 'clear_imported_matches', blocker: clearMatch.error.message };
    }
  }

  const opsDelete = await deleteMarkedBookingOpsRecords(opsIds);
  if (opsDelete.error) return { ok: false, stage: 'booking_ops_records', blocker: opsDelete.error };

  const importedDelete = await deleteHarnessImportedBookings([input.connectionId]);
  if (importedDelete.error) {
    return { ok: false, stage: 'imported_bookings', blocker: importedDelete.error };
  }

  const remainingIntake = await countHarnessIntakeEvents();
  if (remainingIntake > 0) {
    return {
      ok: false,
      stage: 'intake_events_verify',
      blocker: `Ожидалось 0 intake events перед новым прогоном, найдено ${remainingIntake}.`,
    };
  }

  const remainingImported = await countExternalBookings(input.connectionId, LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);
  if (remainingImported > 0) {
    return {
      ok: false,
      stage: 'imported_bookings_verify',
      blocker: `Ожидалось 0 imported bookings перед новым прогоном, найдено ${remainingImported}.`,
    };
  }

  const remainingOps = await countBookingOpsForHarnessProperty();
  if (remainingOps > 0) {
    return {
      ok: false,
      stage: 'booking_ops_verify',
      blocker: `Ожидалось 0 harness Booking Ops перед новым прогоном, найдено ${remainingOps}.`,
    };
  }

  return { ok: true };
}

async function countRemainingHarnessRows(): Promise<number> {
  const [owners, properties, connections, ops, imported, intake] = await Promise.all([
    supabase.from('booking_owner_setup_profiles').select('id').contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS }),
    supabase.from('booking_property_setup_profiles').select('id').contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS }),
    supabase.from('booking_channel_manager_connections').select('id').contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS }),
    supabase.from('booking_ops_records').select('id,reservation_metadata').eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID),
    supabase.from('booking_channel_imported_bookings').select('id').eq('external_booking_id', LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID),
    supabase
      .from('booking_inbound_intake_events')
      .select('id')
      .eq('source', LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE)
      .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
      .or(
        `source_ref.eq.${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID},idempotency_key.eq.${LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY}`,
      ),
  ]);

  for (const result of [owners, properties, connections, ops, imported, intake]) {
    if (result.error && !isMissingRelationError(result.error)) {
      throw new Error(result.error.message);
    }
  }

  const markedOps = (ops.data ?? []).filter((row) => hasHarnessMarker(row.reservation_metadata)).length;
  return (owners.data?.length ?? 0)
    + (properties.data?.length ?? 0)
    + (connections.data?.length ?? 0)
    + markedOps
    + (imported.data?.length ?? 0)
    + (intake.data?.length ?? 0);
}

async function countRemainingActiveHolds(): Promise<number> {
  const { data, error } = await supabase
    .from('booking_availability_holds')
    .select('id,status')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .in('status', ['active', 'confirmed']);
  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw new Error(error.message);
  }
  return (data ?? []).length;
}

/**
 * Full acceptance sequence. Never sets passed unless every assertion is verified.
 * Safely repeatable: resets prior execution artifacts before each run.
 */
export async function runChannelManagerLiveCoreAcceptance(): Promise<LiveCoreAcceptanceEvidence> {
  const acceptanceExecutionId = randomUUID();
  const evidence = emptyEvidence({ acceptanceExecutionId });
  const steps = evidence.steps;

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

  setStep(steps, 'setup', 'running');
  let ownerSetup: OwnerSetupProfile;
  let propertySetup: PropertySetupProfile;
  try {
    const setup = await ensureLiveCoreAcceptanceSetup();
    ownerSetup = setup.ownerSetup;
    propertySetup = setup.propertySetup;
    evidence.ownerSetupId = ownerSetup.id;
    evidence.propertySetupId = propertySetup.id;
    if (!hasHarnessMarker(ownerSetup.metadata) || !hasHarnessMarker(propertySetup.metadata)) {
      return failEvidence(evidence, 'setup', `${HARNESS_IDENTITY_COLLISION}: тестовый контур без точного acceptanceHarness.`);
    }
    setStep(
      steps,
      'setup',
      'passed',
      setup.createdOwner || setup.createdProperty ? 'Тестовый контур создан.' : 'Тестовый контур переиспользован.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подготовить тестовый объект.';
    return failEvidence(evidence, 'setup', message);
  }

  setStep(steps, 'connection', 'running');
  let connection: ChannelManagerConnection;
  try {
    const ensured = await ensureLiveCoreAcceptanceConnection(propertySetup.id);
    connection = ensured.connection;
    evidence.connectionId = connection.id;
    if (!hasHarnessMarker(connection.metadata)) {
      return failEvidence(evidence, 'connection', `${HARNESS_IDENTITY_COLLISION}: подключение МК не помечено acceptanceHarness.`);
    }
    setStep(steps, 'connection', 'passed', ensured.created ? 'Подключение создано.' : 'Подключение переиспользовано.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось создать подключение МК.';
    return failEvidence(evidence, 'connection', message);
  }

  setStep(steps, 'execution_reset', 'running');
  try {
    const reset = await resetLiveCoreAcceptanceExecutionArtifacts({
      connectionId: connection.id,
      propertySetupId: propertySetup.id,
    });
    if (!reset.ok) {
      return failEvidence(evidence, 'execution_reset', `${reset.stage}: ${reset.blocker}`);
    }
    setStep(steps, 'execution_reset', 'passed', 'Предыдущие synthetic artifacts сброшены.');
  } catch (error) {
    return failEvidence(
      evidence,
      'execution_reset',
      error instanceof Error ? error.message : 'Не удалось сбросить предыдущий прогон.',
    );
  }

  const snapshot = buildLiveCoreAcceptanceSnapshot(propertySetup.id);
  try {
    assertLiveCoreAcceptanceSnapshotSafe(snapshot);
  } catch (error) {
    return failEvidence(evidence, 'first_sync', error instanceof Error ? error.message : 'Снимок небезопасен.');
  }

  setStep(steps, 'first_sync', 'running');
  let first: ChannelLiveSyncResult;
  try {
    first = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot,
      metadata: harnessMetadata({ acceptanceRun: 'first', acceptanceExecutionId }),
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
        `Счётчик imported первого запуска должен быть 1 (новый прогон), получено ${evidence.importedFirstRun}. Нельзя засчитывать уже импортированную бронь как успешный first run.`,
      );
    }
    const bookingOpsId = await resolveMatchedBookingOpsId(connection.id);
    if (!bookingOpsId) {
      return failEvidence(evidence, 'booking_check', 'Booking Ops запись для импортированной брони не найдена.');
    }
    evidence.bookingOpsRecordId = bookingOpsId;
    await markBookingOpsAsHarness(bookingOpsId, acceptanceExecutionId);
    setStep(steps, 'booking_check', 'passed', 'Импортирована ровно одна бронь и создана запись Booking Ops.');
  } catch (error) {
    return failEvidence(evidence, 'booking_check', error instanceof Error ? error.message : 'Проверка брони не выполнена.');
  }

  setStep(steps, 'second_sync', 'running');
  let second: ChannelLiveSyncResult;
  try {
    second = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot,
      metadata: harnessMetadata({ acceptanceRun: 'second', acceptanceExecutionId }),
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

function cleanupFailure(
  deleted: LiveCoreAcceptanceCleanupDeleted,
  failedStage: string,
  blocker: string,
  extras: Partial<LiveCoreAcceptanceCleanupResult> = {},
): LiveCoreAcceptanceCleanupResult {
  return {
    ok: false,
    cleanupPassed: false,
    scopeVerified: false,
    remainingHarnessRows: extras.remainingHarnessRows ?? -1,
    remainingActiveHolds: extras.remainingActiveHolds ?? -1,
    remainingIntakeEvents: extras.remainingIntakeEvents ?? -1,
    deleted,
    failedStage,
    blocker,
  };
}

/**
 * Delete only records carrying acceptanceHarness = channel_manager_live_core_v1
 * plus deterministic harness booking identifiers.
 * Never deletes unmarked children merely because a parent is marked.
 */
export async function cleanupLiveCoreAcceptanceHarness(): Promise<LiveCoreAcceptanceCleanupResult> {
  const deleted = emptyDeletedCounters();

  try {
    const owners = await supabase
      .from('booking_owner_setup_profiles')
      .select('id,metadata,lead_id')
      .contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS });
    if (owners.error) {
      return cleanupFailure(deleted, 'owner_lookup', owners.error.message);
    }

    const ownerIds = (owners.data ?? []).map((row) => String(row.id));

    const properties = ownerIds.length
      ? await supabase
        .from('booking_property_setup_profiles')
        .select('id,metadata,property_id,owner_setup_id')
        .in('owner_setup_id', ownerIds)
      : { data: [] as Array<Record<string, unknown>>, error: null };
    if (properties.error) {
      return cleanupFailure(deleted, 'property_lookup', properties.error.message);
    }

    // Exact marker only — never include unmarked children of marked owners.
    const propertyRows = (properties.data ?? []).filter((row) => hasHarnessMarker(row.metadata));
    const propertyIds = propertyRows.map((row) => String(row.id));

    const connections = propertyIds.length
      ? await supabase
        .from('booking_channel_manager_connections')
        .select('id,metadata,property_setup_id')
        .in('property_setup_id', propertyIds)
      : { data: [] as Array<Record<string, unknown>>, error: null };
    if (connections.error) {
      return cleanupFailure(deleted, 'connection_lookup', connections.error.message);
    }

    // Exact marker only — never include unmarked connections under marked properties.
    const connectionRows = (connections.data ?? []).filter((row) => hasHarnessMarker(row.metadata));
    const connectionIds = connectionRows.map((row) => String(row.id));

    const bookingOpsIds = new Set<string>(await listMarkedHarnessBookingOpsIds());
    if (connectionIds.length) {
      const imported = await supabase
        .from('booking_channel_imported_bookings')
        .select('matched_booking_id,external_booking_id')
        .in('connection_id', connectionIds)
        .eq('external_booking_id', LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);
      if (imported.error) {
        return cleanupFailure(deleted, 'imported_bookings_lookup', imported.error.message);
      }
      for (const row of imported.data ?? []) {
        if (row.matched_booking_id) bookingOpsIds.add(String(row.matched_booking_id));
      }
    }
    // Only keep ops that are marked OR were matched from harness imported booking on marked connection.
    // Re-filter marked to avoid deleting unmarked ops that somehow share property_id.
    const verifiedOpsIds: string[] = [];
    if (bookingOpsIds.size > 0) {
      const { data: opsRows, error: opsError } = await supabase
        .from('booking_ops_records')
        .select('id,reservation_metadata,property_id,booking_id')
        .in('id', [...bookingOpsIds]);
      if (opsError) return cleanupFailure(deleted, 'booking_ops_lookup', opsError.message);
      for (const row of opsRows ?? []) {
        const marked = hasHarnessMarker(row.reservation_metadata);
        const deterministic = String(row.property_id ?? '') === LIVE_CORE_ACCEPTANCE_PROPERTY_ID
          && String(row.booking_id ?? '') === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID;
        if (marked || deterministic) verifiedOpsIds.push(String(row.id));
      }
    }

    const intake = await deleteHarnessIntakeEvents();
    if (intake.error) return cleanupFailure(deleted, 'intake_events', intake.error);
    deleted.intakeEvents = intake.deleted;

    const holds = await releaseOrDeleteAvailabilityHolds(verifiedOpsIds);
    if (holds.error) return cleanupFailure(deleted, 'availability_holds', holds.error);
    deleted.availabilityHolds = holds.deleted;

    const checks = await deleteOverbookingChecks(verifiedOpsIds);
    if (checks.error) return cleanupFailure(deleted, 'overbooking_checks', checks.error);
    deleted.overbookingChecks = checks.deleted;

    const drafts = await deleteTelegramDrafts(verifiedOpsIds);
    if (drafts.error) return cleanupFailure(deleted, 'telegram_drafts', drafts.error);
    deleted.telegramDrafts = drafts.deleted;

    const reservation = await deleteReservationArtifacts(verifiedOpsIds);
    if (reservation.importRows.error) {
      return cleanupFailure(deleted, 'reservation_import_rows', reservation.importRows.error);
    }
    if (reservation.reconciliation.error) {
      return cleanupFailure(deleted, 'reservation_reconciliation_items', reservation.reconciliation.error);
    }
    if (reservation.ledger.error) {
      return cleanupFailure(deleted, 'reservation_ledger_audit', reservation.ledger.error);
    }
    deleted.reservationImportRows = reservation.importRows.deleted;
    deleted.reservationReconciliationItems = reservation.reconciliation.deleted;
    deleted.reservationLedgerAudit = reservation.ledger.deleted;

    const descendants = await deleteBookingOpsDescendants(verifiedOpsIds);
    if (descendants.error) return cleanupFailure(deleted, 'booking_ops_descendants', descendants.error);

    const opsDelete = await deleteMarkedBookingOpsRecords(verifiedOpsIds);
    if (opsDelete.error) return cleanupFailure(deleted, 'booking_ops_records', opsDelete.error);
    deleted.bookingOpsRecords = opsDelete.deleted;

    const importedDelete = await deleteHarnessImportedBookings(connectionIds);
    if (importedDelete.error) return cleanupFailure(deleted, 'imported_bookings', importedDelete.error);
    deleted.importedBookings = importedDelete.deleted;

    if (connectionIds.length) {
      const { data, error } = await supabase
        .from('booking_channel_manager_connections')
        .delete()
        .in('id', connectionIds)
        .select('id');
      if (error) return cleanupFailure(deleted, 'connections', error.message);
      deleted.connections = (data ?? []).length;
    }

    if (propertyIds.length) {
      const { data, error } = await supabase
        .from('booking_property_setup_profiles')
        .delete()
        .in('id', propertyIds)
        .select('id');
      if (error) return cleanupFailure(deleted, 'property_setups', error.message);
      deleted.propertySetups = (data ?? []).length;
    }

    if (ownerIds.length) {
      const intents = await supabase
        .from('booking_owner_setup_communication_intents')
        .delete()
        .in('owner_setup_id', ownerIds)
        .select('id');
      if (intents.error) {
        if (!isMissingRelationError(intents.error) && !isMissingColumnError(intents.error)) {
          return cleanupFailure(deleted, 'owner_communication_intents', intents.error.message);
        }
      } else {
        deleted.communicationIntents = (intents.data ?? []).length;
      }

      const { data: deletedOwners, error: ownerDeleteError } = await supabase
        .from('booking_owner_setup_profiles')
        .delete()
        .in('id', ownerIds)
        .select('id');
      if (ownerDeleteError) return cleanupFailure(deleted, 'owner_setups', ownerDeleteError.message);
      deleted.ownerSetups = (deletedOwners ?? []).length;
    }

    const remainingHarnessRows = await countRemainingHarnessRows();
    const remainingActiveHolds = await countRemainingActiveHolds();
    const remainingIntakeEvents = await countHarnessIntakeEvents();
    const scopeVerified = remainingHarnessRows === 0
      && remainingActiveHolds === 0
      && remainingIntakeEvents === 0;
    const cleanupPassed = scopeVerified;

    return {
      ok: cleanupPassed,
      cleanupPassed,
      scopeVerified,
      remainingHarnessRows,
      remainingActiveHolds,
      remainingIntakeEvents,
      deleted,
      failedStage: cleanupPassed ? null : 'post_delete_verification',
      blocker: cleanupPassed
        ? null
        : `После cleanup остались harness rows=${remainingHarnessRows}, active holds=${remainingActiveHolds}, intake events=${remainingIntakeEvents}.`,
    };
  } catch (error) {
    return cleanupFailure(
      deleted,
      'unexpected',
      error instanceof Error ? error.message : 'Неожиданная ошибка cleanup.',
    );
  }
}

export function describeLiveCoreAcceptanceUnavailable(schema: ChannelLiveCoreSchemaState | null): string {
  if (!schema) return 'Статус схемы Live Core ещё не проверен.';
  if (!schema.ready) {
    return schema.blocker
      ?? 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.';
  }
  return 'Тестовый контур Live Core ещё не подготовлен. Нажмите «Подготовить и запустить тест».';
}
