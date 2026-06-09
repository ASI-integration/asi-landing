/**
 * OPS v1 foundation — persistence layer.
 * Все запросы account-scoped через properties.account_id.
 */

import { supabase } from '@/lib/supabase';
import type {
  CreateOpsIncidentInput,
  CreateOpsPropertyTaskInput,
  CreatePropertyInput,
  CreatePropertyMediaInput,
  CreateReservationInput,
  OpsFoundationContext,
  OpsIncident,
  OpsProperty,
  OpsPropertyTask,
  OpsReservation,
  PropertyMasterCard,
  PropertyMedia,
  UpdateMasterCardInput,
  UpdateOpsIncidentInput,
  UpdateOpsPropertyTaskInput,
  UpdatePropertyInput,
  UpdatePropertyMediaInput,
  UpdateReservationInput,
} from './types';

export class OpsFoundationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsFoundationUnavailableError';
  }
}

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('does not exist') || msg.includes('relation');
}

function wrapDbError(err: unknown): never {
  if (isMissingTableError(err)) {
    throw new OpsFoundationUnavailableError('ops_foundation_tables_unavailable');
  }
  throw err instanceof Error ? err : new Error(String(err));
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

type PropertyRow = {
  id: string;
  account_id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  timezone: string | null;
  status: OpsProperty['status'];
  created_at: string;
  updated_at: string;
};

function mapProperty(row: PropertyRow): OpsProperty {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.name,
    address: row.address_line,
    city: row.city,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type MasterCardRow = {
  id: string;
  property_id: string;
  public_title: string | null;
  short_description: string | null;
  full_description: string | null;
  amenities: unknown;
  house_rules: string | null;
  check_in_instructions: string | null;
  check_out_instructions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  parking_info: string | null;
  deposit_info: string | null;
  extra_fees_info: string | null;
  cancellation_info: string | null;
  guest_contacts_info: string | null;
  internal_notes: string | null;
  content_version: number;
  publication_status: PropertyMasterCard['publicationStatus'];
  created_at: string;
  updated_at: string;
};

function mapAmenities(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

function mapMasterCard(row: MasterCardRow): PropertyMasterCard {
  return {
    id: row.id,
    propertyId: row.property_id,
    publicTitle: row.public_title,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    amenities: mapAmenities(row.amenities),
    houseRules: row.house_rules,
    checkInInstructions: row.check_in_instructions,
    checkOutInstructions: row.check_out_instructions,
    wifiName: row.wifi_name,
    wifiPassword: row.wifi_password,
    parkingInfo: row.parking_info,
    depositInfo: row.deposit_info,
    extraFeesInfo: row.extra_fees_info,
    cancellationInfo: row.cancellation_info,
    guestContactsInfo: row.guest_contacts_info,
    internalNotes: row.internal_notes,
    contentVersion: row.content_version,
    publicationStatus: row.publication_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type MediaRow = {
  id: string;
  property_id: string;
  url: string | null;
  storage_path: string | null;
  title: string | null;
  description: string | null;
  sort_order: number;
  is_cover: boolean;
  status: PropertyMedia['status'];
  created_at: string;
  updated_at: string;
};

function mapMedia(row: MediaRow): PropertyMedia {
  return {
    id: row.id,
    propertyId: row.property_id,
    url: row.url,
    storagePath: row.storage_path,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
    isCover: row.is_cover,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ReservationRow = {
  id: string;
  property_id: string;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  source_channel: OpsReservation['sourceChannel'];
  external_reservation_id: string | null;
  check_in_date: string;
  check_out_date: string;
  status: OpsReservation['status'];
  payment_status: OpsReservation['paymentStatus'];
  deposit_status: OpsReservation['depositStatus'];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapReservation(row: ReservationRow): OpsReservation {
  return {
    id: row.id,
    propertyId: row.property_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    guestEmail: row.guest_email,
    sourceChannel: row.source_channel,
    externalReservationId: row.external_reservation_id,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    status: row.status,
    paymentStatus: row.payment_status,
    depositStatus: row.deposit_status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type TaskRow = {
  id: string;
  property_id: string;
  reservation_id: string | null;
  title: string;
  description: string | null;
  category: OpsPropertyTask['category'];
  priority: OpsPropertyTask['priority'];
  status: OpsPropertyTask['status'];
  due_at: string | null;
  assigned_to: string | null;
  source: OpsPropertyTask['source'];
  escalation_source: string | null;
  created_at: string;
  updated_at: string;
};

function mapTask(row: TaskRow): OpsPropertyTask {
  return {
    id: row.id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    dueAt: row.due_at,
    assignedTo: row.assigned_to,
    source: row.source,
    escalationSource: row.escalation_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type IncidentRow = {
  id: string;
  property_id: string;
  reservation_id: string | null;
  title: string;
  description: string | null;
  severity: OpsIncident['severity'];
  status: OpsIncident['status'];
  source: OpsIncident['source'];
  escalation_required: boolean;
  escalation_source: string | null;
  created_at: string;
  updated_at: string;
};

function mapIncident(row: IncidentRow): OpsIncident {
  return {
    id: row.id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    source: row.source,
    escalationRequired: row.escalation_required,
    escalationSource: row.escalation_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Property access guard ───────────────────────────────────────────────────

async function getPropertyRowForAccount(
  ctx: OpsFoundationContext,
  propertyId: string,
): Promise<PropertyRow | null> {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    return (data as PropertyRow | null) ?? null;
  } catch (err) {
    wrapDbError(err);
  }
}

async function assertPropertyAccess(
  ctx: OpsFoundationContext,
  propertyId: string,
): Promise<PropertyRow> {
  const row = await getPropertyRowForAccount(ctx, propertyId);
  if (!row) throw new Error('property_not_found');
  return row;
}

async function assertReservationAccess(
  ctx: OpsFoundationContext,
  reservationId: string,
): Promise<ReservationRow> {
  try {
    const { data, error } = await supabase
      .from('ops_reservations')
      .select('*')
      .eq('id', reservationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('reservation_not_found');

    const row = data as ReservationRow;
    await assertPropertyAccess(ctx, row.property_id);
    return row;
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      throw new Error('reservation_not_found');
    }
    wrapDbError(err);
  }
}

// ─── Properties ──────────────────────────────────────────────────────────────

export async function listProperties(ctx: OpsFoundationContext): Promise<OpsProperty[]> {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as PropertyRow[]).map(mapProperty);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function getProperty(ctx: OpsFoundationContext, propertyId: string): Promise<OpsProperty | null> {
  const row = await getPropertyRowForAccount(ctx, propertyId);
  return row ? mapProperty(row) : null;
}

export async function createProperty(ctx: OpsFoundationContext, input: CreatePropertyInput): Promise<OpsProperty> {
  const now = nowIso();
  try {
    const { data, error } = await supabase
      .from('properties')
      .insert({
        account_id: ctx.accountId,
        name: input.title,
        address_line: input.address ?? null,
        city: input.city ?? null,
        timezone: input.timezone ?? null,
        status: input.status ?? 'draft',
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) throw error;

    const property = mapProperty(data as PropertyRow);

    await supabase.from('property_master_cards').insert({
      property_id: property.id,
      created_at: now,
      updated_at: now,
    });

    return property;
  } catch (err) {
    wrapDbError(err);
  }
}

export async function updateProperty(
  ctx: OpsFoundationContext,
  propertyId: string,
  input: UpdatePropertyInput,
): Promise<OpsProperty> {
  await assertPropertyAccess(ctx, propertyId);

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (input.title !== undefined) updates.name = input.title;
  if (input.address !== undefined) updates.address_line = input.address;
  if (input.city !== undefined) updates.city = input.city;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.status !== undefined) updates.status = input.status;

  try {
    const { data, error } = await supabase
      .from('properties')
      .update(updates)
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();
    if (error) throw error;
    return mapProperty(data as PropertyRow);
  } catch (err) {
    wrapDbError(err);
  }
}

// ─── Master card ─────────────────────────────────────────────────────────────

export async function getMasterCard(
  ctx: OpsFoundationContext,
  propertyId: string,
): Promise<PropertyMasterCard | null> {
  await assertPropertyAccess(ctx, propertyId);

  try {
    const { data, error } = await supabase
      .from('property_master_cards')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapMasterCard(data as MasterCardRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function updateMasterCard(
  ctx: OpsFoundationContext,
  propertyId: string,
  input: UpdateMasterCardInput,
): Promise<PropertyMasterCard> {
  await assertPropertyAccess(ctx, propertyId);

  const existing = await getMasterCard(ctx, propertyId);
  const now = nowIso();

  const row = {
    public_title: input.publicTitle,
    short_description: input.shortDescription,
    full_description: input.fullDescription,
    amenities: input.amenities,
    house_rules: input.houseRules,
    check_in_instructions: input.checkInInstructions,
    check_out_instructions: input.checkOutInstructions,
    wifi_name: input.wifiName,
    wifi_password: input.wifiPassword,
    parking_info: input.parkingInfo,
    deposit_info: input.depositInfo,
    extra_fees_info: input.extraFeesInfo,
    cancellation_info: input.cancellationInfo,
    guest_contacts_info: input.guestContactsInfo,
    internal_notes: input.internalNotes,
    publication_status: input.publicationStatus,
    updated_at: now,
  };

  const patch = Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== undefined),
  );

  try {
    if (!existing) {
      const { data, error } = await supabase
        .from('property_master_cards')
        .insert({ property_id: propertyId, ...patch, created_at: now })
        .select('*')
        .single();
      if (error) throw error;
      return mapMasterCard(data as MasterCardRow);
    }

    const nextVersion = existing.contentVersion + 1;
    const { data, error } = await supabase
      .from('property_master_cards')
      .update({ ...patch, content_version: nextVersion })
      .eq('property_id', propertyId)
      .select('*')
      .single();
    if (error) throw error;
    return mapMasterCard(data as MasterCardRow);
  } catch (err) {
    wrapDbError(err);
  }
}

// ─── Media ───────────────────────────────────────────────────────────────────

export async function listPropertyMedia(
  ctx: OpsFoundationContext,
  propertyId: string,
): Promise<PropertyMedia[]> {
  await assertPropertyAccess(ctx, propertyId);

  try {
    const { data, error } = await supabase
      .from('property_media')
      .select('*')
      .eq('property_id', propertyId)
      .neq('status', 'deleted')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as MediaRow[]).map(mapMedia);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function addPropertyMedia(
  ctx: OpsFoundationContext,
  propertyId: string,
  input: CreatePropertyMediaInput,
): Promise<PropertyMedia> {
  await assertPropertyAccess(ctx, propertyId);

  if (!input.url && !input.storagePath) {
    throw new Error('url_or_storage_path_required');
  }

  const now = nowIso();
  try {
    const { data, error } = await supabase
      .from('property_media')
      .insert({
        property_id: propertyId,
        url: input.url ?? null,
        storage_path: input.storagePath ?? null,
        title: input.title ?? null,
        description: input.description ?? null,
        sort_order: input.sortOrder ?? 0,
        is_cover: input.isCover ?? false,
        status: input.status ?? 'active',
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapMedia(data as MediaRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function updatePropertyMedia(
  ctx: OpsFoundationContext,
  propertyId: string,
  mediaId: string,
  input: UpdatePropertyMediaInput,
): Promise<PropertyMedia> {
  await assertPropertyAccess(ctx, propertyId);

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (input.url !== undefined) updates.url = input.url;
  if (input.storagePath !== undefined) updates.storage_path = input.storagePath;
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;
  if (input.isCover !== undefined) updates.is_cover = input.isCover;
  if (input.status !== undefined) updates.status = input.status;

  try {
    const { data, error } = await supabase
      .from('property_media')
      .update(updates)
      .eq('id', mediaId)
      .eq('property_id', propertyId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('media_not_found');
    return mapMedia(data as MediaRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function deletePropertyMedia(
  ctx: OpsFoundationContext,
  propertyId: string,
  mediaId: string,
): Promise<PropertyMedia> {
  return updatePropertyMedia(ctx, propertyId, mediaId, { status: 'deleted' });
}

// ─── Reservations ──────────────────────────────────────────────────────────────

export async function listReservations(
  ctx: OpsFoundationContext,
  propertyId?: string,
): Promise<OpsReservation[]> {
  try {
    let query = supabase.from('ops_reservations').select('*').order('check_in_date', { ascending: false });

    if (propertyId) {
      await assertPropertyAccess(ctx, propertyId);
      query = query.eq('property_id', propertyId) as typeof query;
    } else {
      const properties = await listProperties(ctx);
      const ids = properties.map((p) => p.id);
      if (ids.length === 0) return [];
      query = query.in('property_id', ids) as typeof query;
    }

    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as ReservationRow[]).map(mapReservation);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function getReservation(
  ctx: OpsFoundationContext,
  reservationId: string,
): Promise<OpsReservation | null> {
  try {
    const row = await assertReservationAccess(ctx, reservationId);
    return mapReservation(row);
  } catch (err) {
    if (err instanceof Error && err.message === 'reservation_not_found') return null;
    wrapDbError(err);
  }
}

export async function createReservation(
  ctx: OpsFoundationContext,
  input: CreateReservationInput,
): Promise<OpsReservation> {
  await assertPropertyAccess(ctx, input.propertyId);

  const now = nowIso();
  try {
    const { data, error } = await supabase
      .from('ops_reservations')
      .insert({
        property_id: input.propertyId,
        guest_name: input.guestName,
        guest_phone: input.guestPhone ?? null,
        guest_email: input.guestEmail ?? null,
        source_channel: input.sourceChannel ?? 'direct',
        external_reservation_id: input.externalReservationId ?? null,
        check_in_date: input.checkInDate,
        check_out_date: input.checkOutDate,
        status: input.status ?? 'new',
        payment_status: input.paymentStatus ?? 'unknown',
        deposit_status: input.depositStatus ?? 'not_required',
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapReservation(data as ReservationRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function updateReservation(
  ctx: OpsFoundationContext,
  reservationId: string,
  input: UpdateReservationInput,
): Promise<OpsReservation> {
  await assertReservationAccess(ctx, reservationId);

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (input.guestName !== undefined) updates.guest_name = input.guestName;
  if (input.guestPhone !== undefined) updates.guest_phone = input.guestPhone;
  if (input.guestEmail !== undefined) updates.guest_email = input.guestEmail;
  if (input.sourceChannel !== undefined) updates.source_channel = input.sourceChannel;
  if (input.externalReservationId !== undefined) updates.external_reservation_id = input.externalReservationId;
  if (input.checkInDate !== undefined) updates.check_in_date = input.checkInDate;
  if (input.checkOutDate !== undefined) updates.check_out_date = input.checkOutDate;
  if (input.status !== undefined) updates.status = input.status;
  if (input.paymentStatus !== undefined) updates.payment_status = input.paymentStatus;
  if (input.depositStatus !== undefined) updates.deposit_status = input.depositStatus;
  if (input.notes !== undefined) updates.notes = input.notes;

  try {
    const { data, error } = await supabase
      .from('ops_reservations')
      .update(updates)
      .eq('id', reservationId)
      .select('*')
      .single();
    if (error) throw error;
    return mapReservation(data as ReservationRow);
  } catch (err) {
    wrapDbError(err);
  }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function listOpsPropertyTasks(
  ctx: OpsFoundationContext,
  propertyId?: string,
): Promise<OpsPropertyTask[]> {
  try {
    let query = supabase.from('ops_property_tasks').select('*').order('created_at', { ascending: false });

    if (propertyId) {
      await assertPropertyAccess(ctx, propertyId);
      query = query.eq('property_id', propertyId) as typeof query;
    } else {
      const properties = await listProperties(ctx);
      const ids = properties.map((p) => p.id);
      if (ids.length === 0) return [];
      query = query.in('property_id', ids) as typeof query;
    }

    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as TaskRow[]).map(mapTask);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function getOpsPropertyTask(
  ctx: OpsFoundationContext,
  taskId: string,
): Promise<OpsPropertyTask | null> {
  try {
    const { data, error } = await supabase
      .from('ops_property_tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = data as TaskRow;
    await assertPropertyAccess(ctx, row.property_id);
    return mapTask(row);
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') return null;
    wrapDbError(err);
  }
}

export async function createOpsPropertyTask(
  ctx: OpsFoundationContext,
  input: CreateOpsPropertyTaskInput,
): Promise<OpsPropertyTask> {
  await assertPropertyAccess(ctx, input.propertyId);
  if (input.reservationId) {
    await assertReservationAccess(ctx, input.reservationId);
  }

  const now = nowIso();
  try {
    const { data, error } = await supabase
      .from('ops_property_tasks')
      .insert({
        property_id: input.propertyId,
        reservation_id: input.reservationId ?? null,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? 'other',
        priority: input.priority ?? 'normal',
        status: input.status ?? 'open',
        due_at: input.dueAt ?? null,
        assigned_to: input.assignedTo ?? null,
        source: input.source ?? 'manual',
        escalation_source: input.escalationSource ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapTask(data as TaskRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function updateOpsPropertyTask(
  ctx: OpsFoundationContext,
  taskId: string,
  input: UpdateOpsPropertyTaskInput,
): Promise<OpsPropertyTask> {
  const existing = await getOpsPropertyTask(ctx, taskId);
  if (!existing) throw new Error('task_not_found');

  if (input.reservationId) {
    await assertReservationAccess(ctx, input.reservationId);
  }

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (input.reservationId !== undefined) updates.reservation_id = input.reservationId;
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.category !== undefined) updates.category = input.category;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.status !== undefined) updates.status = input.status;
  if (input.dueAt !== undefined) updates.due_at = input.dueAt;
  if (input.assignedTo !== undefined) updates.assigned_to = input.assignedTo;
  if (input.escalationSource !== undefined) updates.escalation_source = input.escalationSource;

  try {
    const { data, error } = await supabase
      .from('ops_property_tasks')
      .update(updates)
      .eq('id', taskId)
      .select('*')
      .single();
    if (error) throw error;
    return mapTask(data as TaskRow);
  } catch (err) {
    wrapDbError(err);
  }
}

// ─── Incidents ─────────────────────────────────────────────────────────────────

export async function listOpsIncidents(
  ctx: OpsFoundationContext,
  propertyId?: string,
): Promise<OpsIncident[]> {
  try {
    let query = supabase.from('ops_incidents').select('*').order('created_at', { ascending: false });

    if (propertyId) {
      await assertPropertyAccess(ctx, propertyId);
      query = query.eq('property_id', propertyId) as typeof query;
    } else {
      const properties = await listProperties(ctx);
      const ids = properties.map((p) => p.id);
      if (ids.length === 0) return [];
      query = query.in('property_id', ids) as typeof query;
    }

    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as IncidentRow[]).map(mapIncident);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function getOpsIncident(
  ctx: OpsFoundationContext,
  incidentId: string,
): Promise<OpsIncident | null> {
  try {
    const { data, error } = await supabase
      .from('ops_incidents')
      .select('*')
      .eq('id', incidentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = data as IncidentRow;
    await assertPropertyAccess(ctx, row.property_id);
    return mapIncident(row);
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') return null;
    wrapDbError(err);
  }
}

export async function createOpsIncident(
  ctx: OpsFoundationContext,
  input: CreateOpsIncidentInput,
): Promise<OpsIncident> {
  await assertPropertyAccess(ctx, input.propertyId);
  if (input.reservationId) {
    await assertReservationAccess(ctx, input.reservationId);
  }

  const now = nowIso();
  try {
    const { data, error } = await supabase
      .from('ops_incidents')
      .insert({
        property_id: input.propertyId,
        reservation_id: input.reservationId ?? null,
        title: input.title,
        description: input.description ?? null,
        severity: input.severity ?? 'medium',
        status: input.status ?? 'open',
        source: input.source ?? 'manual',
        escalation_required: input.escalationRequired ?? false,
        escalation_source: input.escalationSource ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapIncident(data as IncidentRow);
  } catch (err) {
    wrapDbError(err);
  }
}

export async function updateOpsIncident(
  ctx: OpsFoundationContext,
  incidentId: string,
  input: UpdateOpsIncidentInput,
): Promise<OpsIncident> {
  const existing = await getOpsIncident(ctx, incidentId);
  if (!existing) throw new Error('incident_not_found');

  if (input.reservationId) {
    await assertReservationAccess(ctx, input.reservationId);
  }

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (input.reservationId !== undefined) updates.reservation_id = input.reservationId;
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.severity !== undefined) updates.severity = input.severity;
  if (input.status !== undefined) updates.status = input.status;
  if (input.source !== undefined) updates.source = input.source;
  if (input.escalationRequired !== undefined) updates.escalation_required = input.escalationRequired;
  if (input.escalationSource !== undefined) updates.escalation_source = input.escalationSource;

  try {
    const { data, error } = await supabase
      .from('ops_incidents')
      .update(updates)
      .eq('id', incidentId)
      .select('*')
      .single();
    if (error) throw error;
    return mapIncident(data as IncidentRow);
  } catch (err) {
    wrapDbError(err);
  }
}
