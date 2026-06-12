import { supabase } from '@/lib/supabase';
import { allChannelCapabilities, defaultChannelSeed, getChannelAdapter } from './adapters';
import {
  buildBronevikMtsTravelDryRunPreview,
  getBronevikMtsTravelCredentialStatus,
  loadBronevikMtsTravelCredentials,
  type BronevikDryRunPreview,
} from './bronevik-mts-real-adapter';
import { calculateShadowAvailabilityProjection, enumerateNights } from './core';
import type { OpsFoundationContext } from '@/lib/ops-foundation/types';
import type {
  CancelReservationResult,
  ChannelListing,
  ChannelManagerChannel,
  ChannelReservation,
  ChannelShadowBookingEvent,
  ChannelShadowDiscrepancy,
  ChannelSyncJob,
  ChannelSyncLog,
  CreateShadowBookingEventInput,
  CreateChannelReservationInput,
  InventoryDay,
  ModifyReservationDatesResult,
  ReservationCommandResult,
  SetInventoryInput,
  UpdateChannelInput,
} from './types';

export class ChannelManagerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelManagerUnavailableError';
  }
}

function extractDbErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(err);
}

/**
 * Detects "table/feature not provisioned yet" errors across Postgres and PostgREST.
 * Postgres raises `relation "x" does not exist` (code 42P01); PostgREST returns
 * `Could not find the table 'public.x' in the schema cache` (code PGRST205) when a
 * table is missing or the schema cache is stale right after a deploy/migration.
 * Supabase surfaces these as plain objects (not Error instances), so both the
 * message and the code are inspected.
 */
function isChannelManagerTablesUnavailable(err: unknown): boolean {
  const msg = extractDbErrorMessage(err).toLowerCase();
  const code = typeof err === 'object' && err !== null ? String((err as { code?: unknown }).code ?? '') : '';
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  );
}

function wrapDbError(err: unknown): never {
  if (isChannelManagerTablesUnavailable(err)) {
    throw new ChannelManagerUnavailableError('channel_manager_tables_unavailable');
  }
  throw err instanceof Error ? err : new Error(extractDbErrorMessage(err));
}

type ChannelRow = {
  id: string;
  account_id: string;
  code: ChannelManagerChannel['code'];
  name: string;
  adapter_kind: ChannelManagerChannel['adapterKind'];
  status: ChannelManagerChannel['status'];
  integration_type: ChannelManagerChannel['integrationType'];
  sync_mode: ChannelManagerChannel['syncMode'];
  is_enabled: boolean;
  is_auto_sell_enabled: boolean;
  is_overbooking_protection_enabled: boolean;
  reliability_level: number;
  commission_percent: number;
  supports_availability_push: boolean;
  supports_rates_push: boolean;
  supports_restrictions_push: boolean;
  supports_booking_pull: boolean;
  supports_booking_webhook: boolean;
  supports_cancellation_webhook: boolean;
  supports_modification_webhook: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapChannel(row: ChannelRow): ChannelManagerChannel {
  return {
    id: row.id,
    accountId: row.account_id,
    code: row.code,
    name: row.name,
    adapterKind: row.adapter_kind,
    status: row.status,
    integrationType: row.integration_type,
    syncMode: row.sync_mode,
    isEnabled: row.is_enabled,
    isAutoSellEnabled: row.is_auto_sell_enabled,
    isOverbookingProtectionEnabled: row.is_overbooking_protection_enabled,
    reliabilityLevel: row.reliability_level,
    commissionPercent: Number(row.commission_percent),
    supportsAvailabilityPush: row.supports_availability_push,
    supportsRatesPush: row.supports_rates_push,
    supportsRestrictionsPush: row.supports_restrictions_push,
    supportsBookingPull: row.supports_booking_pull,
    supportsBookingWebhook: row.supports_booking_webhook,
    supportsCancellationWebhook: row.supports_cancellation_webhook,
    supportsModificationWebhook: row.supports_modification_webhook,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ListingRow = {
  id: string;
  account_id: string;
  channel_id: string;
  property_id: string;
  unit_key: string;
  external_listing_id: string;
  title: string | null;
  status: ChannelListing['status'];
  created_at: string;
  updated_at: string;
};

function mapListing(row: ListingRow): ChannelListing {
  return {
    id: row.id,
    accountId: row.account_id,
    channelId: row.channel_id,
    propertyId: row.property_id,
    unitKey: row.unit_key,
    externalListingId: row.external_listing_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type InventoryRow = {
  id: string;
  account_id: string;
  property_id: string;
  unit_key: string;
  day: string;
  total_units: number;
  booked_units: number;
  manual_blocked_units: number;
  available_units: number;
  created_at: string;
  updated_at: string;
};

function mapInventory(row: InventoryRow): InventoryDay {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    unitKey: row.unit_key,
    day: row.day,
    totalUnits: row.total_units,
    bookedUnits: row.booked_units,
    manualBlockedUnits: row.manual_blocked_units,
    availableUnits: row.available_units,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ReservationRow = {
  id: string;
  account_id: string;
  property_id: string;
  unit_key: string;
  channel_id: string | null;
  channel_code: ChannelReservation['channelCode'];
  external_booking_id: string | null;
  idempotency_key: string | null;
  guest_name: string;
  check_in_date: string;
  check_out_date: string;
  quantity: number;
  status: ChannelReservation['status'];
  rejection_reason: string | null;
  priority_score: number | null;
  total_amount: number | null;
  commission_percent: number | null;
  channel_reliability_level: number | null;
  guest_type: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
};

function mapReservation(row: ReservationRow): ChannelReservation {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    unitKey: row.unit_key,
    channelId: row.channel_id,
    channelCode: row.channel_code,
    externalBookingId: row.external_booking_id,
    idempotencyKey: row.idempotency_key,
    guestName: row.guest_name,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    quantity: row.quantity,
    status: row.status,
    rejectionReason: row.rejection_reason,
    priorityScore: Number(row.priority_score ?? 0),
    totalAmount: row.total_amount === null ? null : Number(row.total_amount),
    commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
    channelReliabilityLevel: row.channel_reliability_level,
    guestType: row.guest_type,
    receivedAt: row.received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type SyncJobRow = {
  id: string;
  account_id: string;
  channel_id: string;
  listing_id: string | null;
  property_id: string;
  unit_key: string;
  date_from: string;
  date_to: string;
  reason: string;
  status: ChannelSyncJob['status'];
  sync_mode: ChannelSyncJob['syncMode'];
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapSyncJob(row: SyncJobRow): ChannelSyncJob {
  return {
    id: row.id,
    accountId: row.account_id,
    channelId: row.channel_id,
    listingId: row.listing_id,
    propertyId: row.property_id,
    unitKey: row.unit_key,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    reason: row.reason,
    status: row.status,
    syncMode: row.sync_mode,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type SyncLogRow = {
  id: string;
  account_id: string;
  job_id: string | null;
  channel_id: string | null;
  listing_id: string | null;
  direction: ChannelSyncLog['direction'];
  status: ChannelSyncLog['status'];
  message: string | null;
  request_json: Record<string, unknown> | null;
  response_json: Record<string, unknown> | null;
  created_at: string;
};

function mapSyncLog(row: SyncLogRow): ChannelSyncLog {
  return {
    id: row.id,
    accountId: row.account_id,
    jobId: row.job_id,
    channelId: row.channel_id,
    listingId: row.listing_id,
    direction: row.direction,
    status: row.status,
    message: row.message,
    requestJson: row.request_json ?? {},
    responseJson: row.response_json ?? {},
    createdAt: row.created_at,
  };
}

export interface BronevikMtsTravelAdminState {
  channelId: string | null;
  credentials: ReturnType<typeof getBronevikMtsTravelCredentialStatus>;
  health: {
    ok: boolean;
    message: string;
    externalCalls: 0;
  };
  mode: 'sandbox_shadow_read_only';
  sandbox: boolean;
  dryRunPreview: BronevikDryRunPreview | null;
  missingMappings: BronevikDryRunPreview['missingMappings'];
  latestSyncJobs: ChannelSyncJob[];
  latestSyncLogs: ChannelSyncLog[];
}

type ShadowBookingEventRow = {
  id: string;
  account_id: string;
  channel_id: string | null;
  listing_id: string | null;
  property_id: string;
  unit_key: string;
  event_type: ChannelShadowBookingEvent['eventType'];
  external_booking_id: string | null;
  idempotency_key: string | null;
  guest_name: string | null;
  check_in_date: string;
  check_out_date: string;
  quantity: number;
  status: ChannelShadowBookingEvent['status'];
  available: boolean;
  reservation_id: string | null;
  projected_availability_json: Record<string, number> | null;
  external_availability_json: Record<string, number> | null;
  created_at: string;
};

function mapShadowBookingEvent(row: ShadowBookingEventRow): ChannelShadowBookingEvent {
  return {
    id: row.id,
    accountId: row.account_id,
    channelId: row.channel_id,
    listingId: row.listing_id,
    propertyId: row.property_id,
    unitKey: row.unit_key,
    eventType: row.event_type,
    externalBookingId: row.external_booking_id,
    idempotencyKey: row.idempotency_key,
    guestName: row.guest_name,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    quantity: row.quantity,
    status: row.status,
    available: row.available,
    reservationId: row.reservation_id,
    projectedAvailability: row.projected_availability_json ?? {},
    externalAvailability: row.external_availability_json ?? {},
    createdAt: row.created_at,
  };
}

type ShadowDiscrepancyRow = {
  id: string;
  account_id: string;
  shadow_event_id: string;
  channel_id: string | null;
  property_id: string;
  unit_key: string;
  day: string | null;
  discrepancy_type: ChannelShadowDiscrepancy['discrepancyType'];
  severity: ChannelShadowDiscrepancy['severity'];
  expected_value: string | null;
  observed_value: string | null;
  message: string;
  created_at: string;
};

function mapShadowDiscrepancy(row: ShadowDiscrepancyRow): ChannelShadowDiscrepancy {
  return {
    id: row.id,
    accountId: row.account_id,
    shadowEventId: row.shadow_event_id,
    channelId: row.channel_id,
    propertyId: row.property_id,
    unitKey: row.unit_key,
    day: row.day,
    discrepancyType: row.discrepancy_type,
    severity: row.severity,
    expectedValue: row.expected_value,
    observedValue: row.observed_value,
    message: row.message,
    createdAt: row.created_at,
  };
}

export function isApiLikeChannel(channel: Pick<ChannelManagerChannel, 'integrationType'>): boolean {
  return channel.integrationType === 'api' || channel.integrationType === 'partner_channel_manager_api';
}

export function assertChannelGuardrails(channel: ChannelManagerChannel, patch: UpdateChannelInput): UpdateChannelInput {
  const nextSyncMode = patch.syncMode ?? channel.syncMode;
  const nextAutoSell = patch.isAutoSellEnabled ?? channel.isAutoSellEnabled;
  const nextProtection = patch.isOverbookingProtectionEnabled ?? channel.isOverbookingProtectionEnabled;

  if (!isApiLikeChannel(channel) && (nextSyncMode === 'active' || nextAutoSell || nextProtection)) {
    throw new Error('non_api_channels_cannot_use_active_auto_sell');
  }

  if (nextSyncMode === 'active' && !channel.supportsAvailabilityPush) {
    throw new Error('active_mode_requires_availability_push');
  }

  if (channel.code === 'bronevik_mts_travel' && nextSyncMode === 'active') {
    throw new Error('real_ota_adapter_active_mode_disabled');
  }

  if (nextAutoSell && nextSyncMode !== 'active') {
    throw new Error('auto_sell_requires_active_mode');
  }

  return patch;
}

export async function ensureDefaultChannels(ctx: OpsFoundationContext): Promise<ChannelManagerChannel[]> {
  try {
    const rows = defaultChannelSeed.map((channel) => ({
      account_id: ctx.accountId,
      code: channel.code,
      name: channel.name,
      adapter_kind: channel.adapterKind,
      status: channel.status,
      integration_type: channel.integrationType,
      sync_mode: channel.syncMode,
      is_enabled: channel.isEnabled,
      is_auto_sell_enabled: channel.isAutoSellEnabled,
      is_overbooking_protection_enabled: channel.isOverbookingProtectionEnabled,
      reliability_level: channel.reliabilityLevel,
      commission_percent: channel.commissionPercent,
      supports_availability_push: channel.supportsAvailabilityPush,
      supports_rates_push: channel.supportsRatesPush,
      supports_restrictions_push: channel.supportsRestrictionsPush,
      supports_booking_pull: channel.supportsBookingPull,
      supports_booking_webhook: channel.supportsBookingWebhook,
      supports_cancellation_webhook: channel.supportsCancellationWebhook,
      supports_modification_webhook: channel.supportsModificationWebhook,
    }));

    const { error } = await supabase
      .from('cm_channels')
      .upsert(rows, { onConflict: 'account_id,code', ignoreDuplicates: true });
    if (error) throw error;

    await Promise.all(defaultChannelSeed.map(async (channel) => {
      const { error: updateError } = await supabase
        .from('cm_channels')
        .update({
          name: channel.name,
          adapter_kind: channel.adapterKind,
          status: channel.status,
          integration_type: channel.integrationType,
          reliability_level: channel.reliabilityLevel,
          commission_percent: channel.commissionPercent,
          supports_availability_push: channel.supportsAvailabilityPush,
          supports_rates_push: channel.supportsRatesPush,
          supports_restrictions_push: channel.supportsRestrictionsPush,
          supports_booking_pull: channel.supportsBookingPull,
          supports_booking_webhook: channel.supportsBookingWebhook,
          supports_cancellation_webhook: channel.supportsCancellationWebhook,
          supports_modification_webhook: channel.supportsModificationWebhook,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
        .eq('code', channel.code);
      if (updateError) throw updateError;
    }));

    const { data, error: listError } = await supabase
      .from('cm_channels')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('name', { ascending: true });
    if (listError) throw listError;
    return ((data ?? []) as ChannelRow[]).map(mapChannel);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function ensureManualListing(
  ctx: OpsFoundationContext,
  propertyId: string,
  unitKey = 'default',
): Promise<ChannelListing> {
  const channels = await ensureDefaultChannels(ctx);
  const manual = channels.find((channel) => channel.code === 'manual');
  if (!manual) throw new Error('manual_channel_not_found');

  try {
    const { data, error } = await supabase
      .from('cm_channel_listings')
      .upsert(
        {
          account_id: ctx.accountId,
          channel_id: manual.id,
          property_id: propertyId,
          unit_key: unitKey,
          external_listing_id: `${propertyId}:${unitKey}:manual`,
          title: 'Ручное управление',
          status: 'active',
        },
        { onConflict: 'channel_id,property_id,unit_key' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return mapListing(data as ListingRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function ensureDefaultChannelListings(
  ctx: OpsFoundationContext,
  propertyId: string,
  unitKey = 'default',
): Promise<ChannelListing[]> {
  const channels = await ensureDefaultChannels(ctx);

  try {
    const rows = channels.map((channel) => ({
      account_id: ctx.accountId,
      channel_id: channel.id,
      property_id: propertyId,
      unit_key: unitKey,
      external_listing_id: `${propertyId}:${unitKey}:${channel.code}`,
      title: `${channel.name}: ${unitKey}`,
      status: channel.isEnabled ? 'active' : 'disabled',
    }));

    const { data, error } = await supabase
      .from('cm_channel_listings')
      .upsert(rows, { onConflict: 'channel_id,property_id,unit_key' })
      .select('*');
    if (error) throw error;
    return ((data ?? []) as ListingRow[]).map(mapListing);
  } catch (err) {
    wrapDbError(err);
  }
}

export interface ChannelManagerState {
  channels: ChannelManagerChannel[];
  registry: typeof allChannelCapabilities;
  listings: ChannelListing[];
  inventoryDays: InventoryDay[];
  reservations: ChannelReservation[];
  syncJobs: ChannelSyncJob[];
  syncLogs: ChannelSyncLog[];
  shadowEvents: ChannelShadowBookingEvent[];
  shadowDiscrepancies: ChannelShadowDiscrepancy[];
  bronevikMtsTravel: BronevikMtsTravelAdminState | null;
}

function emptyChannelManagerState(): ChannelManagerState {
  return {
    channels: [],
    registry: allChannelCapabilities,
    listings: [],
    inventoryDays: [],
    reservations: [],
    syncJobs: [],
    syncLogs: [],
    shadowEvents: [],
    shadowDiscrepancies: [],
    bronevikMtsTravel: null,
  };
}

/**
 * Read-only state for the owner/admin view. When the channel manager tables are
 * not provisioned yet (fresh VM, stale PostgREST schema cache), this is treated
 * as an empty "nothing connected yet" state rather than a hard error — the UI
 * then renders empty states instead of a red error banner. Genuine failures
 * (connection errors, unexpected DB errors) still propagate.
 */
export async function listChannelManagerState(
  ctx: OpsFoundationContext,
  propertyId?: string,
): Promise<ChannelManagerState> {
  try {
    return await loadChannelManagerState(ctx, propertyId);
  } catch (err) {
    if (err instanceof ChannelManagerUnavailableError) {
      return emptyChannelManagerState();
    }
    throw err;
  }
}

async function loadChannelManagerState(
  ctx: OpsFoundationContext,
  propertyId?: string,
): Promise<ChannelManagerState> {
  const channels = await ensureDefaultChannels(ctx);

  try {
    let listingsQuery = supabase.from('cm_channel_listings').select('*').eq('account_id', ctx.accountId);
    let inventoryQuery = supabase
      .from('cm_inventory_days')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('day', { ascending: true })
      .limit(90);
    let reservationsQuery = supabase
      .from('cm_reservations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    let jobsQuery = supabase
      .from('cm_channel_sync_jobs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(30);
    let logsQuery = supabase
      .from('cm_channel_sync_logs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(30);
    let shadowEventsQuery = supabase
      .from('cm_shadow_booking_events')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(30);
    let shadowDiscrepanciesQuery = supabase
      .from('cm_shadow_discrepancies')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (propertyId) {
      listingsQuery = listingsQuery.eq('property_id', propertyId);
      inventoryQuery = inventoryQuery.eq('property_id', propertyId);
      reservationsQuery = reservationsQuery.eq('property_id', propertyId);
      jobsQuery = jobsQuery.eq('property_id', propertyId);
      shadowEventsQuery = shadowEventsQuery.eq('property_id', propertyId);
      shadowDiscrepanciesQuery = shadowDiscrepanciesQuery.eq('property_id', propertyId);
    }

    const [
      listingsRes,
      inventoryRes,
      reservationsRes,
      jobsRes,
      logsRes,
      shadowEventsRes,
      shadowDiscrepanciesRes,
    ] = await Promise.all([
      listingsQuery,
      inventoryQuery,
      reservationsQuery,
      jobsQuery,
      logsQuery,
      shadowEventsQuery,
      shadowDiscrepanciesQuery,
    ]);

    for (const res of [
      listingsRes,
      inventoryRes,
      reservationsRes,
      jobsRes,
      logsRes,
      shadowEventsRes,
      shadowDiscrepanciesRes,
    ]) {
      if (res.error) throw res.error;
    }

    const listings = ((listingsRes.data ?? []) as ListingRow[]).map(mapListing);
    const inventoryDays = ((inventoryRes.data ?? []) as InventoryRow[]).map(mapInventory);
    const reservations = ((reservationsRes.data ?? []) as ReservationRow[]).map(mapReservation);
    const syncJobs = ((jobsRes.data ?? []) as SyncJobRow[]).map(mapSyncJob);
    const syncLogs = ((logsRes.data ?? []) as SyncLogRow[]).map(mapSyncLog);

    return {
      channels,
      registry: allChannelCapabilities,
      listings,
      inventoryDays,
      reservations,
      syncJobs,
      syncLogs,
      shadowEvents: ((shadowEventsRes.data ?? []) as ShadowBookingEventRow[]).map(mapShadowBookingEvent),
      shadowDiscrepancies: ((shadowDiscrepanciesRes.data ?? []) as ShadowDiscrepancyRow[]).map(mapShadowDiscrepancy),
      bronevikMtsTravel: buildBronevikMtsTravelAdminState({
        channels,
        listings,
        inventoryDays,
        reservations,
        syncJobs,
        syncLogs,
        propertyId,
      }),
    };
  } catch (err) {
    wrapDbError(err);
  }
}

export async function listChannels(ctx: OpsFoundationContext): Promise<{
  channels: ChannelManagerChannel[];
  registry: typeof allChannelCapabilities;
}> {
  const channels = await ensureDefaultChannels(ctx);
  return { channels, registry: allChannelCapabilities };
}

export async function updateChannel(
  ctx: OpsFoundationContext,
  channelId: string,
  input: UpdateChannelInput,
): Promise<ChannelManagerChannel> {
  const channels = await ensureDefaultChannels(ctx);
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) throw new Error('channel_not_found');

  const patch = assertChannelGuardrails(channel, input);
  const rowPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.syncMode !== undefined) rowPatch.sync_mode = patch.syncMode;
  if (patch.isEnabled !== undefined) rowPatch.is_enabled = patch.isEnabled;
  if (patch.isAutoSellEnabled !== undefined) rowPatch.is_auto_sell_enabled = patch.isAutoSellEnabled;
  if (patch.isOverbookingProtectionEnabled !== undefined) {
    rowPatch.is_overbooking_protection_enabled = patch.isOverbookingProtectionEnabled;
  }

  try {
    const { data, error } = await supabase
      .from('cm_channels')
      .update(rowPatch)
      .eq('account_id', ctx.accountId)
      .eq('id', channelId)
      .select('*')
      .single();
    if (error) throw error;
    return mapChannel(data as ChannelRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function healthCheckChannel(
  ctx: OpsFoundationContext,
  channelId: string,
): Promise<{ ok: boolean; message: string; externalCalls: number }> {
  const channels = await ensureDefaultChannels(ctx);
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) throw new Error('channel_not_found');

  const adapter = getChannelAdapter(channel.code);
  const result = await adapter.healthCheck();

  try {
    await supabase.from('cm_channel_sync_logs').insert({
      account_id: ctx.accountId,
      channel_id: channel.id,
      direction: 'outbound',
      status: result.ok ? 'ok' : 'error',
      message: result.message,
      request_json: {
        operation: 'health_check',
        channel_code: channel.code,
        sandbox_shadow_read_only: channel.code === 'bronevik_mts_travel',
      },
      response_json: {
        external_calls: result.externalCalls,
        details: result.details ?? {},
      },
    });

    await supabase
      .from('cm_channels')
      .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId)
      .eq('id', channelId);
  } catch (err) {
    wrapDbError(err);
  }

  return result;
}

function buildBronevikMtsTravelAdminState(input: {
  channels: ChannelManagerChannel[];
  listings: ChannelListing[];
  inventoryDays: InventoryDay[];
  reservations: ChannelReservation[];
  syncJobs: ChannelSyncJob[];
  syncLogs: ChannelSyncLog[];
  propertyId?: string;
}): BronevikMtsTravelAdminState | null {
  const channel = input.channels.find((item) => item.code === 'bronevik_mts_travel');
  if (!channel) return null;

  const unitKey = 'default';
  const listing = input.listings.find((item) => item.channelId === channel.id && item.unitKey === unitKey) ?? null;
  const preview = input.propertyId
    ? buildBronevikMtsTravelDryRunPreview({
        channel,
        listing,
        propertyId: input.propertyId,
        unitKey,
        inventoryDays: input.inventoryDays.filter((day) => day.unitKey === unitKey),
        reservation: input.reservations.find((reservation) => reservation.channelCode === 'bronevik_mts_travel') ?? null,
      })
    : null;
  const credentials = getBronevikMtsTravelCredentialStatus(loadBronevikMtsTravelCredentials());

  return {
    channelId: channel.id,
    credentials,
    health: {
      ok: credentials.ok,
      message: credentials.ok
        ? 'Доступы для sandbox заданы. Внешняя проверка не выполнялась.'
        : 'Часть доступов для sandbox не задана. Адаптер не падает и остается в теневом режиме.',
      externalCalls: 0,
    },
    mode: 'sandbox_shadow_read_only',
    sandbox: true,
    dryRunPreview: preview,
    missingMappings: preview?.missingMappings ?? [],
    latestSyncJobs: input.syncJobs.filter((job) => job.channelId === channel.id).slice(0, 5),
    latestSyncLogs: input.syncLogs.filter((log) => log.channelId === channel.id).slice(0, 5),
  };
}

export async function createBronevikMtsTravelDryRun(
  ctx: OpsFoundationContext,
  input: {
    propertyId: string;
    unitKey?: string;
    dateFrom: string;
    dateTo: string;
  },
): Promise<{
  preview: BronevikDryRunPreview;
  syncJob: ChannelSyncJob;
  syncLog: ChannelSyncLog;
  externalCalls: 0;
}> {
  const unitKey = input.unitKey || 'default';
  if (input.dateTo <= input.dateFrom) throw new Error('invalid_dates');

  const channels = await ensureDefaultChannels(ctx);
  const channel = channels.find((item) => item.code === 'bronevik_mts_travel');
  if (!channel) throw new Error('channel_not_found');
  if (channel.syncMode === 'active') throw new Error('real_ota_adapter_active_mode_disabled');

  const listings = await ensureDefaultChannelListings(ctx, input.propertyId, unitKey);
  const listing = listings.find((item) => item.channelId === channel.id) ?? null;

  try {
    const { data: inventoryRows, error: inventoryError } = await supabase
      .from('cm_inventory_days')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('property_id', input.propertyId)
      .eq('unit_key', unitKey)
      .gte('day', input.dateFrom)
      .lt('day', input.dateTo)
      .order('day', { ascending: true });
    if (inventoryError) throw inventoryError;

    const { data: reservationRows, error: reservationError } = await supabase
      .from('cm_reservations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('property_id', input.propertyId)
      .eq('unit_key', unitKey)
      .eq('channel_code', 'bronevik_mts_travel')
      .order('created_at', { ascending: false })
      .limit(1);
    if (reservationError) throw reservationError;

    const preview = buildBronevikMtsTravelDryRunPreview({
      channel,
      listing,
      propertyId: input.propertyId,
      unitKey,
      inventoryDays: ((inventoryRows ?? []) as InventoryRow[]).map(mapInventory),
      reservation: ((reservationRows ?? []) as ReservationRow[]).map(mapReservation)[0] ?? null,
    });

    const { data: jobRow, error: jobError } = await supabase
      .from('cm_channel_sync_jobs')
      .insert({
        account_id: ctx.accountId,
        channel_id: channel.id,
        listing_id: listing?.id ?? null,
        property_id: input.propertyId,
        unit_key: unitKey,
        date_from: input.dateFrom,
        date_to: input.dateTo,
        reason: 'bronevik_dry_run_preview',
        status: 'queued',
        sync_mode: 'shadow',
        idempotency_key: `bronevik-dry-run:${ctx.accountId}:${input.propertyId}:${unitKey}:${input.dateFrom}:${input.dateTo}:${Date.now()}`,
      })
      .select('*')
      .single();
    if (jobError) throw jobError;
    const syncJob = mapSyncJob(jobRow as SyncJobRow);

    const { data: logRow, error: logError } = await supabase
      .from('cm_channel_sync_logs')
      .insert({
        account_id: ctx.accountId,
        job_id: syncJob.id,
        channel_id: channel.id,
        listing_id: listing?.id ?? null,
        direction: 'outbound',
        status: 'skipped',
        message: 'shadow_mode_external_send_blocked',
        request_json: {
          operation: 'bronevik_dry_run_preview',
          sync_mode: 'shadow',
          payload_preview: preview.payload,
          missing_mappings: preview.missingMappings,
        },
        response_json: {
          external_calls: 0,
          real_ota_changed: false,
          credentials: preview.credentials.maskedValues,
        },
      })
      .select('*')
      .single();
    if (logError) throw logError;

    return {
      preview,
      syncJob,
      syncLog: mapSyncLog(logRow as SyncLogRow),
      externalCalls: 0,
    };
  } catch (err) {
    wrapDbError(err);
  }
}

export async function listReservationConflicts(
  ctx: OpsFoundationContext,
  propertyId?: string,
): Promise<ChannelReservation[]> {
  try {
    let query = supabase
      .from('cm_reservations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .in('status', ['conflict', 'rejected_by_inventory', 'declined'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (propertyId) query = query.eq('property_id', propertyId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as ReservationRow[]).map(mapReservation);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function listSyncJobs(ctx: OpsFoundationContext, propertyId?: string): Promise<ChannelSyncJob[]> {
  try {
    let query = supabase
      .from('cm_channel_sync_jobs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (propertyId) query = query.eq('property_id', propertyId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as SyncJobRow[]).map(mapSyncJob);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function listSyncLogs(ctx: OpsFoundationContext): Promise<ChannelSyncLog[]> {
  try {
    const { data, error } = await supabase
      .from('cm_channel_sync_logs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as SyncLogRow[]).map(mapSyncLog);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function setInventoryDay(
  ctx: OpsFoundationContext,
  input: SetInventoryInput,
): Promise<{ inventoryId: string; availableUnits: number; syncJobs: number }> {
  const unitKey = input.unitKey || 'default';
  await ensureDefaultChannelListings(ctx, input.propertyId, unitKey);

  try {
    const { data, error } = await supabase.rpc('cm_set_inventory_day', {
      p_account_id: ctx.accountId,
      p_property_id: input.propertyId,
      p_unit_key: unitKey,
      p_day: input.day,
      p_total_units: input.totalUnits,
      p_manual_blocked_units: input.manualBlockedUnits,
    });
    if (error) throw error;
    const row = (data as Array<{ inventory_id: string; available_units: number; sync_jobs: number }>)[0];
    return { inventoryId: row.inventory_id, availableUnits: row.available_units, syncJobs: row.sync_jobs };
  } catch (err) {
    wrapDbError(err);
  }
}

function normalizeExternalAvailability(input?: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [day, value] of Object.entries(input ?? {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(value)) {
      normalized[day] = Math.max(Math.trunc(value), 0);
    }
  }
  return normalized;
}

export async function createShadowBookingEvent(
  ctx: OpsFoundationContext,
  input: CreateShadowBookingEventInput,
): Promise<{
  eventId: string;
  reservationId: string | null;
  status: ChannelShadowBookingEvent['status'];
  available: boolean;
  syncJobs: number;
  discrepancies: number;
  externalCalls: 0;
  idempotent: boolean;
}> {
  const unitKey = input.unitKey || 'default';
  const channelCode = input.channelCode || 'yandex_travel';
  const eventType = input.eventType ?? 'reservation_created';
  const quantity = input.quantity ?? 1;
  const externalAvailability = normalizeExternalAvailability(input.externalAvailabilityByDay);
  const listings = await ensureDefaultChannelListings(ctx, input.propertyId, unitKey);
  const channels = await ensureDefaultChannels(ctx);
  const channel = channels.find((item) => item.code === channelCode);
  if (!channel) throw new Error('channel_not_found');
  if (!isApiLikeChannel(channel) || !channel.isEnabled || channel.syncMode !== 'shadow') {
    throw new Error('channel_shadow_mode_required');
  }
  const listing = listings.find((item) => item.channelId === channel.id) ?? null;
  const nights = enumerateNights(input.checkInDate, input.checkOutDate);

  try {
    if (input.idempotencyKey) {
      const { data: existingEvent, error: existingEventError } = await supabase
        .from('cm_shadow_booking_events')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (existingEventError) throw existingEventError;
      if (existingEvent) {
        const event = mapShadowBookingEvent(existingEvent as ShadowBookingEventRow);
        await supabase.from('cm_channel_sync_logs').insert({
          account_id: ctx.accountId,
          channel_id: event.channelId,
          listing_id: event.listingId,
          direction: 'inbound',
          status: 'skipped',
          message: 'shadow_duplicate_event',
          request_json: { event_type: eventType, idempotency_key: input.idempotencyKey },
          response_json: { shadow_event_id: event.id, external_calls: 0 },
        });
        return {
          eventId: event.id,
          reservationId: event.reservationId,
          status: 'duplicate',
          available: event.available,
          syncJobs: 0,
          discrepancies: 0,
          externalCalls: 0,
          idempotent: true,
        };
      }
    }

    const { data: inventoryRows, error: inventoryError } = await supabase
      .from('cm_inventory_days')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('property_id', input.propertyId)
      .eq('unit_key', unitKey)
      .in('day', nights);
    if (inventoryError) throw inventoryError;

    const inventoryByDay = new Map(
      ((inventoryRows ?? []) as InventoryRow[]).map((row) => [row.day, mapInventory(row)]),
    );
    const availableByDay = Object.fromEntries(
      nights.map((day) => [day, inventoryByDay.get(day)?.availableUnits ?? 0]),
    );
    const { available, projectedAvailability } = calculateShadowAvailabilityProjection({
      eventType,
      nights,
      availableByDay,
      quantity,
    });

    const { data: existingReservation, error: existingReservationError } = input.externalBookingId
      ? await supabase
          .from('cm_reservations')
          .select('*')
          .eq('account_id', ctx.accountId)
          .eq('property_id', input.propertyId)
          .eq('channel_code', channelCode)
          .eq('external_booking_id', input.externalBookingId)
          .maybeSingle()
      : { data: null, error: null };
    if (existingReservationError) throw existingReservationError;

    let reservationId = existingReservation ? (existingReservation as ReservationRow).id : null;
    const shouldInsertReservation = !reservationId && eventType !== 'reservation_cancelled';
    if (shouldInsertReservation) {
      const { data: reservation, error: reservationError } = await supabase
        .from('cm_reservations')
        .insert({
          account_id: ctx.accountId,
          property_id: input.propertyId,
          unit_key: unitKey,
          channel_id: channel.id,
          channel_code: channelCode,
          external_booking_id: input.externalBookingId ?? null,
          idempotency_key: input.idempotencyKey ? `shadow:${input.idempotencyKey}` : null,
          guest_name: input.guestName || 'Гость',
          check_in_date: input.checkInDate,
          check_out_date: input.checkOutDate,
          quantity,
          status: available ? 'pending' : 'conflict',
          rejection_reason: available ? null : 'no_availability',
          priority_score: 0,
          total_amount: input.totalAmount ?? null,
          commission_percent: channel.commissionPercent,
          channel_reliability_level: channel.reliabilityLevel,
          guest_type: input.guestType ?? null,
          raw_payload: {
            shadow_mode: true,
            event_type: eventType,
            external_availability_by_day: externalAvailability,
          },
        })
        .select('*')
        .single();
      if (reservationError) throw reservationError;
      reservationId = (reservation as ReservationRow).id;
    }

    const eventStatus: ChannelShadowBookingEvent['status'] = available ? 'processed' : 'conflict';
    const { data: eventRow, error: eventError } = await supabase
      .from('cm_shadow_booking_events')
      .insert({
        account_id: ctx.accountId,
        channel_id: channel.id,
        listing_id: listing?.id ?? null,
        property_id: input.propertyId,
        unit_key: unitKey,
        event_type: eventType,
        external_booking_id: input.externalBookingId ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        guest_name: input.guestName || null,
        check_in_date: input.checkInDate,
        check_out_date: input.checkOutDate,
        quantity,
        status: eventStatus,
        available,
        reservation_id: reservationId,
        projected_availability_json: projectedAvailability,
        external_availability_json: externalAvailability,
        payload_json: {
          total_amount: input.totalAmount ?? null,
          guest_type: input.guestType ?? null,
          confirmation_mode: input.confirmationMode ?? null,
        },
      })
      .select('*')
      .single();
    if (eventError) throw eventError;
    const event = mapShadowBookingEvent(eventRow as ShadowBookingEventRow);

    const discrepancyRows: Array<Record<string, unknown>> = [];
    if (!available && eventType !== 'reservation_cancelled') {
      for (const day of nights) {
        const observed = availableByDay[day] ?? 0;
        if (observed < quantity) {
          discrepancyRows.push({
            account_id: ctx.accountId,
            shadow_event_id: event.id,
            channel_id: channel.id,
            property_id: input.propertyId,
            unit_key: unitKey,
            day,
            discrepancy_type: 'insufficient_availability',
            severity: 'critical',
            expected_value: String(quantity),
            observed_value: String(observed),
            message: 'ASI не подтвердил бы эту бронь: на даты не хватает мест.',
          });
        }
      }
    }

    if (eventType === 'reservation_cancelled' && !existingReservation) {
      discrepancyRows.push({
        account_id: ctx.accountId,
        shadow_event_id: event.id,
        channel_id: channel.id,
        property_id: input.propertyId,
        unit_key: unitKey,
        day: null,
        discrepancy_type: 'reservation_not_found',
        severity: 'warning',
        expected_value: input.externalBookingId ?? null,
        observed_value: null,
        message: 'Событие отмены пришло, но подходящая бронь в ASI не найдена.',
      });
    }

    for (const [day, externalUnits] of Object.entries(externalAvailability)) {
      const asiUnits = projectedAvailability[day];
      if (asiUnits !== undefined && asiUnits !== externalUnits) {
        discrepancyRows.push({
          account_id: ctx.accountId,
          shadow_event_id: event.id,
          channel_id: channel.id,
          property_id: input.propertyId,
          unit_key: unitKey,
          day,
          discrepancy_type: 'external_availability_mismatch',
          severity: Math.abs(asiUnits - externalUnits) > 1 ? 'critical' : 'warning',
          expected_value: String(asiUnits),
          observed_value: String(externalUnits),
          message: 'Расчет ASI отличается от снимка доступности площадки.',
        });
      }
    }

    if (discrepancyRows.length > 0) {
      const { error: discrepanciesError } = await supabase.from('cm_shadow_discrepancies').insert(discrepancyRows);
      if (discrepanciesError) throw discrepanciesError;
    }

    const { data: jobRow, error: jobError } = await supabase
      .from('cm_channel_sync_jobs')
      .insert({
        account_id: ctx.accountId,
        channel_id: channel.id,
        listing_id: listing?.id ?? null,
        property_id: input.propertyId,
        unit_key: unitKey,
        date_from: input.checkInDate,
        date_to: input.checkOutDate,
        reason: `${eventType}_shadow`,
        status: 'queued',
        sync_mode: 'shadow',
        idempotency_key: `shadow:${event.id}:${channel.id}`,
      })
      .select('*')
      .single();
    if (jobError) throw jobError;
    const job = mapSyncJob(jobRow as SyncJobRow);

    const { error: logsError } = await supabase.from('cm_channel_sync_logs').insert([
      {
        account_id: ctx.accountId,
        job_id: null,
        channel_id: channel.id,
        listing_id: listing?.id ?? null,
        direction: 'inbound',
        status: available ? 'ok' : 'skipped',
        message: 'shadow_event_received',
        request_json: {
          event_type: eventType,
          external_booking_id: input.externalBookingId ?? null,
          external_availability_by_day: externalAvailability,
        },
        response_json: {
          shadow_event_id: event.id,
          reservation_id: reservationId,
          available,
          external_calls: 0,
        },
      },
      {
        account_id: ctx.accountId,
        job_id: job.id,
        channel_id: channel.id,
        listing_id: listing?.id ?? null,
        direction: 'outbound',
        status: 'skipped',
        message: 'shadow_mode_external_send_blocked',
        request_json: {
          operation: 'availability_push',
          sync_mode: 'shadow',
          projected_availability_by_day: projectedAvailability,
        },
        response_json: {
          shadow_event_id: event.id,
          external_calls: 0,
          real_ota_changed: false,
        },
      },
    ]);
    if (logsError) throw logsError;

    return {
      eventId: event.id,
      reservationId,
      status: event.status,
      available,
      syncJobs: 1,
      discrepancies: discrepancyRows.length,
      externalCalls: 0,
      idempotent: false,
    };
  } catch (err) {
    wrapDbError(err);
  }
}

export async function createChannelReservation(
  ctx: OpsFoundationContext,
  input: CreateChannelReservationInput,
): Promise<ReservationCommandResult> {
  const unitKey = input.unitKey || 'default';
  const channelCode = input.channelCode || 'manual';
  await ensureDefaultChannelListings(ctx, input.propertyId, unitKey);

  try {
    const { data, error } = await supabase.rpc('cm_create_reservation', {
      p_account_id: ctx.accountId,
      p_property_id: input.propertyId,
      p_unit_key: unitKey,
      p_channel_code: channelCode,
      p_external_booking_id: input.externalBookingId ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_guest_name: input.guestName,
      p_check_in_date: input.checkInDate,
      p_check_out_date: input.checkOutDate,
      p_quantity: input.quantity ?? 1,
      p_total_amount: input.totalAmount ?? null,
      p_guest_type: input.guestType ?? null,
      p_confirmation_mode: input.confirmationMode ?? 'confirm',
      p_raw_payload: {},
    });
    if (error) throw error;
    const row = (data as Array<{
      reservation_id: string;
      reservation_status: ReservationCommandResult['status'];
      available: boolean;
      sync_jobs: number;
      idempotent: boolean;
      priority_score: number;
    }>)[0];
    return {
      reservationId: row.reservation_id,
      status: row.reservation_status,
      available: row.available,
      syncJobs: row.sync_jobs,
      idempotent: row.idempotent,
      priorityScore: Number(row.priority_score ?? 0),
    };
  } catch (err) {
    wrapDbError(err);
  }
}

export async function cancelChannelReservation(
  ctx: OpsFoundationContext,
  reservationId: string,
): Promise<CancelReservationResult> {
  try {
    const { data, error } = await supabase.rpc('cm_cancel_reservation', {
      p_account_id: ctx.accountId,
      p_reservation_id: reservationId,
    });
    if (error) throw error;
    const row = (data as Array<{
      reservation_id: string;
      reservation_status: CancelReservationResult['status'];
      sync_jobs: number;
      idempotent: boolean;
    }>)[0];
    return {
      reservationId: row.reservation_id,
      status: row.reservation_status,
      syncJobs: row.sync_jobs,
      idempotent: row.idempotent,
    };
  } catch (err) {
    wrapDbError(err);
  }
}

export async function modifyChannelReservationDates(
  ctx: OpsFoundationContext,
  reservationId: string,
  checkInDate: string,
  checkOutDate: string,
): Promise<ModifyReservationDatesResult> {
  try {
    const { data, error } = await supabase.rpc('cm_modify_reservation_dates', {
      p_account_id: ctx.accountId,
      p_reservation_id: reservationId,
      p_check_in_date: checkInDate,
      p_check_out_date: checkOutDate,
    });
    if (error) throw error;
    const row = (data as Array<{
      reservation_id: string;
      reservation_status: ModifyReservationDatesResult['status'];
      available: boolean;
      sync_jobs: number;
    }>)[0];
    return {
      reservationId: row.reservation_id,
      status: row.reservation_status,
      available: row.available,
      syncJobs: row.sync_jobs,
    };
  } catch (err) {
    wrapDbError(err);
  }
}
