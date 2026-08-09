import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { handleGuestLifecycleEvent, listGuestLifecycleVisibility } from './guest-lifecycle-runtime';
import {
  SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE,
} from './guest-lifecycle-synthetic';
import type { GuestLifecycleEvent } from './guest-lifecycle';

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export const GUEST_LIFECYCLE_SYNTHETIC_HARNESS = 'guest_lifecycle_communications_v1';
export const GUEST_LIFECYCLE_SYNTHETIC_SOURCE = 'synthetic_acceptance';
export const GUEST_LIFECYCLE_SYNTHETIC_RUN_PREFIX = 'glc-synthetic-';
export const GUEST_LIFECYCLE_SYNTHETIC_CONFIRM = 'RUN ISOLATED GUEST LIFECYCLE SYNTHETIC ACCEPTANCE';

export type GuestLifecycleSyntheticManifest = {
  schemaVersion: 'asi.guest-lifecycle.synthetic-manifest.v1';
  runId: string;
  token: string;
  bookingOpsRecordId: string;
  reservationId: string;
  propertyId: string;
  guestId: string;
  guestEmail: string;
  autoSendScopeId: string;
  autoSendPolicyIds: [string, string, string];
  source: typeof GUEST_LIFECYCLE_SYNTHETIC_SOURCE;
  sourceEventIds: string[];
};

export type GuestLifecycleSyntheticCounts = {
  lifecycleEvents: number;
  intents: number;
  deliveries: number;
  attempts: number;
  memoryEvents: number;
};

export type GuestLifecycleSyntheticProjectionEvidence = {
  reservationId: string;
  guest: string;
  currentStage: string;
  mostRecentEvent: string;
  mostRecentCommunication: string | null;
  deliveryStatus: string;
  operatorActionRequired: boolean;
};

export type GuestLifecycleSyntheticPassReport = {
  ok: true;
  runId: string;
  noExternalActions: true;
  allDeliveriesDryRun: true;
  duplicateCount: number;
  counts: GuestLifecycleSyntheticCounts;
  projection: GuestLifecycleSyntheticProjectionEvidence;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requireSafeToken(value: string): string {
  const token = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(token)) throw new Error('synthetic_token_must_be_uuid');
  return token;
}

function expectedIds(token: string) {
  return {
    runId: `${GUEST_LIFECYCLE_SYNTHETIC_RUN_PREFIX}${token}`,
    propertyId: `${GUEST_LIFECYCLE_SYNTHETIC_RUN_PREFIX}property-${token}`,
    guestId: `${GUEST_LIFECYCLE_SYNTHETIC_RUN_PREFIX}guest-${token}`,
    guestEmail: `${GUEST_LIFECYCLE_SYNTHETIC_RUN_PREFIX}${token}@example.invalid`,
  };
}

export function createGuestLifecycleSyntheticManifest(input: {
  token?: string;
  bookingOpsRecordId?: string;
  autoSendScopeId?: string;
  autoSendPolicyIds?: [string, string, string];
} = {}): GuestLifecycleSyntheticManifest {
  const token = requireSafeToken(input.token ?? randomUUID());
  const bookingOpsRecordId = requireSafeToken(input.bookingOpsRecordId ?? randomUUID());
  const autoSendScopeId = requireSafeToken(input.autoSendScopeId ?? randomUUID());
  const autoSendPolicyIds = input.autoSendPolicyIds ?? [randomUUID(), randomUUID(), randomUUID()];
  autoSendPolicyIds.forEach(requireSafeToken);
  const ids = expectedIds(token);
  return {
    schemaVersion: 'asi.guest-lifecycle.synthetic-manifest.v1',
    runId: ids.runId,
    token,
    bookingOpsRecordId,
    reservationId: bookingOpsRecordId,
    propertyId: ids.propertyId,
    guestId: ids.guestId,
    guestEmail: ids.guestEmail,
    autoSendScopeId,
    autoSendPolicyIds,
    source: GUEST_LIFECYCLE_SYNTHETIC_SOURCE,
    sourceEventIds: SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE.map((eventType) => `${ids.runId}:${eventType}`),
  };
}

export function assertGuestLifecycleSyntheticManifest(input: unknown): asserts input is GuestLifecycleSyntheticManifest {
  if (!input || typeof input !== 'object') throw new Error('synthetic_manifest_required');
  const manifest = input as GuestLifecycleSyntheticManifest;
  if (manifest.schemaVersion !== 'asi.guest-lifecycle.synthetic-manifest.v1') throw new Error('synthetic_manifest_version_mismatch');
  const token = requireSafeToken(manifest.token);
  const ids = expectedIds(token);
  if (manifest.runId !== ids.runId) throw new Error('synthetic_run_id_mismatch');
  if (manifest.propertyId !== ids.propertyId) throw new Error('synthetic_property_id_mismatch');
  if (manifest.guestId !== ids.guestId) throw new Error('synthetic_guest_id_mismatch');
  if (manifest.guestEmail !== ids.guestEmail) throw new Error('synthetic_guest_email_mismatch');
  if (!UUID_RE.test(manifest.bookingOpsRecordId) || manifest.reservationId !== manifest.bookingOpsRecordId) {
    throw new Error('synthetic_reservation_id_mismatch');
  }
  if (!UUID_RE.test(manifest.autoSendScopeId)) throw new Error('synthetic_scope_id_mismatch');
  if (!Array.isArray(manifest.autoSendPolicyIds) || manifest.autoSendPolicyIds.length !== 3
    || manifest.autoSendPolicyIds.some((id) => !UUID_RE.test(id))) {
    throw new Error('synthetic_policy_ids_mismatch');
  }
  if (manifest.source !== GUEST_LIFECYCLE_SYNTHETIC_SOURCE) throw new Error('synthetic_source_mismatch');
  const expectedSourceIds = SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE.map((eventType) => `${ids.runId}:${eventType}`);
  if (JSON.stringify(manifest.sourceEventIds) !== JSON.stringify(expectedSourceIds)) {
    throw new Error('synthetic_source_event_ids_mismatch');
  }
}

export function guestLifecycleSyntheticEvents(
  manifest: GuestLifecycleSyntheticManifest,
  startedAt = new Date(),
): GuestLifecycleEvent[] {
  assertGuestLifecycleSyntheticManifest(manifest);
  return SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE.map((eventType, index) => ({
    eventType,
    reservationId: manifest.reservationId,
    propertyId: manifest.propertyId,
    guestId: manifest.guestId,
    occurredAt: new Date(startedAt.getTime() + index * 60_000).toISOString(),
    source: manifest.source,
    sourceEventId: manifest.sourceEventIds[index]!,
    language: 'ru',
    facts: eventType === 'stay.completed' ? { feedbackAppropriate: true } : undefined,
  }));
}

async function requireNoError(response: { error?: { message?: string } | null }, code: string): Promise<void> {
  if (response?.error) throw new Error(`${code}:${response.error.message ?? 'database_error'}`);
}

async function exactCount(query: any, code: string): Promise<number> {
  const response = await query;
  if (response?.error) throw new Error(`${code}:${response.error.message ?? 'database_error'}`);
  return Number(response?.count ?? (Array.isArray(response?.data) ? response.data.length : 0));
}

export async function assertGuestLifecycleSyntheticFixtureVacant(
  manifest: GuestLifecycleSyntheticManifest,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<void> {
  assertGuestLifecycleSyntheticManifest(manifest);
  const checks = await Promise.all([
    exactCount(db.from('booking_ops_records').select('id', { count: 'exact', head: true }).eq('id', manifest.bookingOpsRecordId), 'booking_fixture_check_failed'),
    exactCount(db.from('tg_guest_reservations').select('id', { count: 'exact', head: true }).eq('id', manifest.reservationId), 'reservation_fixture_check_failed'),
    exactCount(db.from('tg_property_knowledge').select('property_id', { count: 'exact', head: true }).eq('property_id', manifest.propertyId), 'property_fixture_check_failed'),
    exactCount(db.from('tg_contacts').select('id', { count: 'exact', head: true }).eq('id', manifest.guestId), 'contact_fixture_check_failed'),
    exactCount(db.from('tg_guest_identities').select('guest_id', { count: 'exact', head: true }).eq('guest_id', manifest.guestId), 'identity_fixture_check_failed'),
    exactCount(db.from('booking_ops_communication_auto_send_scopes').select('id', { count: 'exact', head: true }).eq('scope_type', 'booking').eq('scope_ref', manifest.reservationId), 'scope_fixture_check_failed'),
    exactCount(db.from('booking_ops_communication_policies').select('id', { count: 'exact', head: true }).eq('scope', 'booking').eq('scope_ref', manifest.reservationId), 'policy_fixture_check_failed'),
  ]);
  if (checks.some((count) => count !== 0)) throw new Error('synthetic_fixture_collision');
}

export async function createGuestLifecycleSyntheticFixtures(
  manifest: GuestLifecycleSyntheticManifest,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<void> {
  assertGuestLifecycleSyntheticManifest(manifest);
  await assertGuestLifecycleSyntheticFixtureVacant(manifest, db);
  const now = new Date().toISOString();
  const checkInAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const checkOutAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();

  await requireNoError(await db.from('tg_property_knowledge').insert({
    property_id: manifest.propertyId,
    location: 'Synthetic acceptance property',
    check_in_time: '15:00',
    check_out_time: '12:00',
    wifi_name: 'SyntheticWiFi',
    wifi_password: null,
    checkin_instructions: 'Use the verified synthetic reception desk.',
    access_notes: 'Synthetic acceptance only; no real access details.',
    house_rules: 'Quiet hours start at 22:00.',
    checkout_notes: 'Return the synthetic key to reception.',
    pilot_acceptance_marker: manifest.runId,
    active: true,
    created_at: now,
    updated_at: now,
  }), 'synthetic_property_create_failed');

  await requireNoError(await db.from('tg_contacts').insert({
    id: manifest.guestId,
    email: manifest.guestEmail,
    first_name: 'Synthetic',
    last_name: 'Guest',
    created_at: now,
    updated_at: now,
  }), 'synthetic_contact_create_failed');

  await requireNoError(await db.from('tg_guest_identities').insert({
    guest_id: manifest.guestId,
    email: manifest.guestEmail,
    display_name: 'Synthetic Guest',
    trust_status: 'normal',
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  }), 'synthetic_identity_create_failed');

  await requireNoError(await db.from('guest_memory_profiles').insert({
    guest_id: manifest.guestId,
    preferred_language: 'ru',
    preferred_language_source: 'deterministic_system',
    preferred_communication_mode: 'text',
    preferred_communication_mode_source: 'deterministic_system',
    stay_count: 0,
    first_seen_at: now,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  }), 'synthetic_memory_profile_create_failed');

  await requireNoError(await db.from('booking_ops_records').insert({
    id: manifest.bookingOpsRecordId,
    booking_id: manifest.reservationId,
    account_id: manifest.runId,
    guest_name: 'Synthetic Guest',
    guest_email: manifest.guestEmail,
    property_id: manifest.propertyId,
    property_label: 'Synthetic acceptance property',
    ota_source: 'manual',
    asi_reference: `GLC-SYN-${manifest.token}`,
    source_type: 'manual',
    normalized_status: 'confirmed',
    check_in_at: checkInAt,
    check_out_at: checkOutAt,
    ops_status: 'ready_for_checkin',
    documents_status: 'verified',
    contract_status: 'signed',
    deposit_status: 'confirmed',
    mvd_status: 'not_required',
    checkin_readiness_status: 'ready',
    unit_readiness_status: 'ready',
    reservation_metadata: {
      acceptanceHarness: GUEST_LIFECYCLE_SYNTHETIC_HARNESS,
      acceptanceRunId: manifest.runId,
      synthetic: true,
      noExternalActions: true,
    },
    notes: `Synthetic acceptance ${manifest.runId}`,
    created_at: now,
    updated_at: now,
  }), 'synthetic_booking_create_failed');

  await requireNoError(await db.from('booking_guest_legal_readiness').insert({
    id: randomUUID(),
    booking_id: manifest.bookingOpsRecordId,
    property_id: manifest.propertyId,
    status: 'ready_for_checkin',
    documents_status: 'verified',
    contract_status: 'signed_manual',
    deposit_status: 'waived_manual',
    mvd_status: 'not_required',
    availability_status: 'no_conflict',
    blockers: [],
    warnings: [],
    safe_summary: 'Synthetic legal readiness verified.',
    last_checked_at: now,
    metadata: { acceptanceHarness: GUEST_LIFECYCLE_SYNTHETIC_HARNESS, acceptanceRunId: manifest.runId },
    created_at: now,
    updated_at: now,
  }), 'synthetic_legal_readiness_create_failed');

  await requireNoError(await db.from('booking_cleaning_tasks').insert({
    id: randomUUID(), booking_id: manifest.bookingOpsRecordId, property_id: manifest.propertyId,
    status: 'verified', report_payload: {}, verified_at: now, created_at: now, updated_at: now,
  }), 'synthetic_cleaning_readiness_create_failed');
  await requireNoError(await db.from('booking_linen_tasks').insert({
    id: randomUUID(), booking_id: manifest.bookingOpsRecordId, property_id: manifest.propertyId,
    status: 'verified', report_payload: {}, verified_at: now, created_at: now, updated_at: now,
  }), 'synthetic_linen_readiness_create_failed');
  await requireNoError(await db.from('booking_supplies_tasks').insert({
    id: randomUUID(), booking_id: manifest.bookingOpsRecordId, property_id: manifest.propertyId,
    status: 'verified', critical_items: [], report_payload: {}, verified_at: now, created_at: now, updated_at: now,
  }), 'synthetic_supplies_readiness_create_failed');
  await requireNoError(await db.from('booking_physical_readiness').insert({
    id: randomUUID(), booking_id: manifest.bookingOpsRecordId, property_id: manifest.propertyId,
    status: 'approved', blockers: [], final_ready: true, approved_at: now,
    approved_by: GUEST_LIFECYCLE_SYNTHETIC_HARNESS,
    metadata: { acceptanceHarness: GUEST_LIFECYCLE_SYNTHETIC_HARNESS, acceptanceRunId: manifest.runId },
    created_at: now, updated_at: now,
  }), 'synthetic_physical_readiness_create_failed');

  await requireNoError(await db.from('tg_guest_reservations').insert({
    id: manifest.reservationId,
    booking_id: manifest.reservationId,
    reservation_ref: manifest.reservationId,
    property_id: manifest.propertyId,
    guest_id: manifest.guestId,
    guest_name: 'Synthetic Guest',
    guest_contact: manifest.guestEmail,
    check_in: checkInAt,
    check_out: checkOutAt,
    status: 'confirmed',
    access_verified_at: now,
    pilot_acceptance_marker: manifest.runId,
    created_at: now,
    updated_at: now,
  }), 'synthetic_reservation_create_failed');

  await requireNoError(await db.from('booking_ops_communication_auto_send_scopes').insert({
    id: manifest.autoSendScopeId,
    scope_type: 'booking',
    scope_ref: manifest.reservationId,
    actual_send_enabled: true,
    enabled_by: GUEST_LIFECYCLE_SYNTHETIC_HARNESS,
    enabled_at: now,
    reason: `${GUEST_LIFECYCLE_SYNTHETIC_HARNESS}:${manifest.runId}`,
    max_batch_size: 20,
    allowed_channels: ['email'],
    allowed_message_types: ['neutral_booking_acknowledgement', 'neutral_status_update', 'send_checkin_instructions'],
    dry_run_only: true,
    emergency_stop: false,
    created_at: now,
    updated_at: now,
  }), 'synthetic_scope_create_failed');

  const policyTypes = ['neutral_booking_acknowledgement', 'neutral_status_update', 'send_checkin_instructions'];
  await requireNoError(await db.from('booking_ops_communication_policies').insert(policyTypes.map((messageType, index) => ({
    id: manifest.autoSendPolicyIds[index],
    scope: 'booking',
    scope_ref: manifest.reservationId,
    message_type: messageType,
    channel: 'any',
    auto_send_enabled: true,
    actual_send_enabled: true,
    requires_review: false,
    quiet_hours_enabled: false,
    max_auto_sends_per_booking_per_day: 20,
    max_auto_sends_per_guest_per_day: 20,
    allowed_recipient_roles: ['guest'],
    blocked_keywords: [],
    required_metadata: messageType === 'send_checkin_instructions'
      ? ['lifecycle_event_type', 'identity_verified', 'access_allowed']
      : [],
    created_at: now,
    updated_at: now,
  }))), 'synthetic_policies_create_failed');
}

export async function readGuestLifecycleSyntheticCounts(
  manifest: GuestLifecycleSyntheticManifest,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<GuestLifecycleSyntheticCounts> {
  assertGuestLifecycleSyntheticManifest(manifest);
  const [lifecycleEvents, intents, deliveries, attempts, memoryEvents] = await Promise.all([
    exactCount(db.from('guest_lifecycle_events').select('id', { count: 'exact', head: true }).eq('reservation_id', manifest.reservationId).eq('source', manifest.source), 'lifecycle_count_failed'),
    exactCount(db.from('booking_ops_communication_intents').select('id', { count: 'exact', head: true }).eq('booking_ops_record_id', manifest.bookingOpsRecordId), 'intent_count_failed'),
    exactCount(db.from('booking_ops_communication_deliveries').select('id', { count: 'exact', head: true }).eq('booking_id', manifest.reservationId), 'delivery_count_failed'),
    exactCount(db.from('booking_ops_communication_auto_send_attempts').select('id', { count: 'exact', head: true }).eq('booking_id', manifest.reservationId), 'attempt_count_failed'),
    exactCount(db.from('guest_memory_events').select('id', { count: 'exact', head: true }).eq('guest_id', manifest.guestId).eq('booking_reference', manifest.reservationId), 'memory_count_failed'),
  ]);
  return { lifecycleEvents, intents, deliveries, attempts, memoryEvents };
}

export function sameGuestLifecycleSyntheticCounts(
  left: GuestLifecycleSyntheticCounts,
  right: GuestLifecycleSyntheticCounts,
): boolean {
  return Object.keys(left).every((key) => left[key as keyof GuestLifecycleSyntheticCounts] === right[key as keyof GuestLifecycleSyntheticCounts]);
}

export async function runGuestLifecycleSyntheticDatabasePass(
  manifest: GuestLifecycleSyntheticManifest,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<GuestLifecycleSyntheticPassReport> {
  assertGuestLifecycleSyntheticManifest(manifest);
  const events = guestLifecycleSyntheticEvents(manifest, new Date('2030-01-01T12:00:00.000Z'));
  const results = [];
  for (const event of events) {
    results.push(await handleGuestLifecycleEvent(event, {
      db,
      dryRun: true,
      now: new Date(event.occurredAt),
      autoSendOptions: {
        sender: async () => { throw new Error('synthetic_external_send_forbidden'); },
        voiceSender: async () => { throw new Error('synthetic_external_voice_forbidden'); },
      },
    }));
  }
  if (results.some((result) => !result.ok)) {
    throw new Error(`synthetic_lifecycle_pass_failed:${results.find((result) => !result.ok)?.record.failureReason ?? 'unknown'}`);
  }
  const deliveries = await db.from('booking_ops_communication_deliveries')
    .select('status')
    .eq('booking_id', manifest.reservationId);
  await requireNoError(deliveries, 'synthetic_deliveries_read_failed');
  const deliveryRows = Array.isArray(deliveries?.data) ? deliveries.data : [];
  if (deliveryRows.length !== SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE.length || deliveryRows.some((row: any) => row.status !== 'dry_run')) {
    throw new Error('synthetic_delivery_not_strict_dry_run');
  }
  const visibility = await listGuestLifecycleVisibility({ limit: 1000, db });
  if (!visibility.ok) throw new Error(`synthetic_projection_failed:${visibility.error}`);
  const projection = visibility.items.find((item) => item.reservationId === manifest.reservationId);
  if (!projection || projection.currentStage !== 'completed' || projection.mostRecentEvent !== 'stay.completed') {
    throw new Error('synthetic_dashboard_projection_mismatch');
  }
  return {
    ok: true,
    runId: manifest.runId,
    noExternalActions: true,
    allDeliveriesDryRun: true,
    duplicateCount: results.filter((result) => result.duplicate).length,
    counts: await readGuestLifecycleSyntheticCounts(manifest, db),
    projection: {
      reservationId: projection.reservationId,
      guest: projection.guest,
      currentStage: projection.currentStage,
      mostRecentEvent: projection.mostRecentEvent,
      mostRecentCommunication: projection.mostRecentCommunication,
      deliveryStatus: projection.deliveryStatus,
      operatorActionRequired: projection.operatorActionRequired,
    },
  };
}

export async function previewGuestLifecycleSyntheticCleanup(
  manifest: GuestLifecycleSyntheticManifest,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<Record<string, unknown>> {
  assertGuestLifecycleSyntheticManifest(manifest);
  const response = await db.rpc('cleanup_guest_lifecycle_synthetic_acceptance', {
    p_run_id: manifest.runId,
    p_booking_ops_record_id: manifest.bookingOpsRecordId,
    p_reservation_id: manifest.reservationId,
    p_property_id: manifest.propertyId,
    p_guest_id: manifest.guestId,
    p_scope_id: manifest.autoSendScopeId,
    p_policy_ids: manifest.autoSendPolicyIds,
    p_dry_run: true,
    p_confirm: 'DRY_RUN',
  });
  if (response.error) throw new Error(`synthetic_cleanup_preview_failed:${response.error.message ?? 'database_error'}`);
  return response.data as Record<string, unknown>;
}

export async function cleanupGuestLifecycleSyntheticRows(
  manifest: GuestLifecycleSyntheticManifest,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<Record<string, unknown>> {
  assertGuestLifecycleSyntheticManifest(manifest);
  const response = await db.rpc('cleanup_guest_lifecycle_synthetic_acceptance', {
    p_run_id: manifest.runId,
    p_booking_ops_record_id: manifest.bookingOpsRecordId,
    p_reservation_id: manifest.reservationId,
    p_property_id: manifest.propertyId,
    p_guest_id: manifest.guestId,
    p_scope_id: manifest.autoSendScopeId,
    p_policy_ids: manifest.autoSendPolicyIds,
    p_dry_run: false,
    p_confirm: `CLEAN GUEST LIFECYCLE ${manifest.runId}`,
  });
  if (response.error) throw new Error(`synthetic_cleanup_failed:${response.error.message ?? 'database_error'}`);
  const result = response.data as Record<string, unknown>;
  if (result?.zeroResidue !== true || Number(result?.residueCount ?? -1) !== 0) {
    throw new Error(`synthetic_cleanup_residue:${String(result?.residueCount ?? 'unknown')}`);
  }
  return result;
}
