import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getCrmContactById } from '@/lib/crm/repository';
import type { CrmContact, CrmSource } from '@/lib/crm/types';
import {
  attachAutoSendDecisionMetadata,
  canAutoSendCommunicationIntent,
} from './communication-auto-send-policy';

export const OWNER_SETUP_STATUSES = [
  'new',
  'instruction_sent',
  'data_collection_started',
  'data_incomplete',
  'data_ready',
  'access_requested',
  'access_received',
  'test_object_selected',
  'ready_for_setup',
  'blocked',
] as const;

export type OwnerSetupStatus = (typeof OWNER_SETUP_STATUSES)[number];

export const PROPERTY_SETUP_STATUSES = [
  'new',
  'collecting_data',
  'incomplete',
  'ready_for_review',
  'ready_for_channel_preparation',
  'blocked',
] as const;

export type PropertySetupStatus = (typeof PROPERTY_SETUP_STATUSES)[number];

export const OWNER_SETUP_PILOT_GROUPS = ['bragin', 'strigunov', 'other'] as const;
export type OwnerSetupPilotGroup = (typeof OWNER_SETUP_PILOT_GROUPS)[number];

export const PROPERTY_WIFI_STATUSES = ['unknown', 'missing', 'provided', 'verified'] as const;
export type PropertyWifiStatus = (typeof PROPERTY_WIFI_STATUSES)[number];

export const PROPERTY_RULES_STATUSES = ['missing', 'partial', 'complete'] as const;
export type PropertyRulesStatus = (typeof PROPERTY_RULES_STATUSES)[number];

export const PROPERTY_PHOTOS_STATUSES = ['missing', 'partial', 'enough', 'ready'] as const;
export type PropertyPhotosStatus = (typeof PROPERTY_PHOTOS_STATUSES)[number];

export const PROPERTY_PRICING_STATUSES = ['missing', 'partial', 'ready'] as const;
export type PropertyPricingStatus = (typeof PROPERTY_PRICING_STATUSES)[number];

export const PROPERTY_CHANNEL_ACCESS_STATUSES = [
  'not_requested',
  'requested',
  'received',
  'invalid',
  'blocked',
] as const;
export type PropertyChannelAccessStatus = (typeof PROPERTY_CHANNEL_ACCESS_STATUSES)[number];

export const PROPERTY_ASSET_TYPES = ['photo', 'document', 'instruction', 'video', 'other'] as const;
export type PropertyAssetType = (typeof PROPERTY_ASSET_TYPES)[number];

export const PROPERTY_ASSET_STATUSES = ['uploaded', 'accepted', 'rejected', 'needs_replacement'] as const;
export type PropertyAssetStatus = (typeof PROPERTY_ASSET_STATUSES)[number];

export const OWNER_SETUP_MESSAGE_TYPES = [
  'owner_setup_started',
  'request_property_missing_data',
  'request_property_photos',
  'request_channel_manager_access',
  'object_data_received_acknowledgement',
  'object_ready_for_review_notice',
  'internal_status_notice',
] as const;

export type OwnerSetupMessageType = (typeof OWNER_SETUP_MESSAGE_TYPES)[number];

export const CHANNEL_HANDOFF_STATUSES = [
  'ready_for_channel_preparation',
  'manual_channel_publication_pending',
  'channel_access_received',
  'object_data_ready',
  'publication_blocked',
] as const;

export type ChannelHandoffStatus = (typeof CHANNEL_HANDOFF_STATUSES)[number];

export type OwnerSetupProfile = {
  id: string;
  leadId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerContactRef: string | null;
  status: OwnerSetupStatus;
  pilotGroup: OwnerSetupPilotGroup | null;
  missingFields: string[];
  readinessScore: number;
  metadata: Record<string, unknown>;
  publicToken: string | null;
  publicSetupUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertySetupProfile = {
  id: string;
  ownerSetupId: string | null;
  propertyId: string | null;
  leadId: string | null;
  status: PropertySetupStatus;
  title: string | null;
  addressCity: string | null;
  addressArea: string | null;
  addressSafeSummary: string | null;
  propertyType: string | null;
  roomCount: number | null;
  guestCapacity: number | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  wifiStatus: PropertyWifiStatus;
  rulesStatus: PropertyRulesStatus;
  photosStatus: PropertyPhotosStatus;
  pricingStatus: PropertyPricingStatus;
  channelAccessStatus: PropertyChannelAccessStatus;
  readinessScore: number;
  missingFields: string[];
  metadata: Record<string, unknown>;
  channelHandoffStatus: ChannelHandoffStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyAsset = {
  id: string;
  propertySetupId: string;
  assetType: PropertyAssetType;
  status: PropertyAssetStatus;
  storageRef: string | null;
  safeLabel: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OwnerSetupCommunicationIntent = {
  id: string;
  ownerSetupId: string;
  propertySetupId: string | null;
  messageType: OwnerSetupMessageType;
  channel: string;
  status: string;
  messageText: string;
  messageTemplateKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PropertySetupPayload = {
  title?: string | null;
  addressCity?: string | null;
  addressArea?: string | null;
  addressSafeSummary?: string | null;
  propertyType?: string | null;
  roomCount?: number | null;
  guestCapacity?: number | null;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  wifiStatus?: PropertyWifiStatus;
  rulesStatus?: PropertyRulesStatus;
  rulesText?: string | null;
  photosStatus?: PropertyPhotosStatus;
  pricingStatus?: PropertyPricingStatus;
  basePriceLabel?: string | null;
  channelAccessStatus?: PropertyChannelAccessStatus;
  propertyId?: string | null;
};

export type OwnerObjectSetupBlockers = {
  ownerSetupId: string;
  propertySetupId: string | null;
  blockers: string[];
  missingFields: string[];
  nextAction: string | null;
  channelHandoffStatus: ChannelHandoffStatus | null;
};

const CREDENTIAL_FIELD_RE = /(?:password|пароль|token|токен|api[_-]?key|secret|код\s*доступа|логин\s*и\s*пароль)/iu;
const CREDENTIAL_VALUE_RE = /(?:^|\s)(?:pass(?:word)?|пароль)\s*[:=]\s*\S+/iu;

const MISSING_FIELD_LABELS_RU: Record<string, string> = {
  title: 'название объекта',
  address: 'город или район',
  property_type: 'тип объекта',
  capacity: 'вместимость',
  checkin_checkout: 'время заезда и выезда',
  rules: 'правила проживания',
  photos: 'фотографии',
  pricing: 'базовая цена',
  channel_access: 'доступ к менеджеру каналов',
  wifi: 'данные Wi-Fi',
};

const OWNER_SETUP_STATUS_LABELS_RU: Record<OwnerSetupStatus, string> = {
  new: 'Новый',
  instruction_sent: 'Инструкция отправлена',
  data_collection_started: 'Сбор данных начат',
  data_incomplete: 'Данные неполные',
  data_ready: 'Данные готовы',
  access_requested: 'Запрошен доступ',
  access_received: 'Доступ получен',
  test_object_selected: 'Тестовый объект выбран',
  ready_for_setup: 'Готов к настройке',
  blocked: 'Заблокирован',
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function safeInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

function mergeMetadata(
  base: Record<string, unknown>,
  ...patches: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  return patches.reduce<Record<string, unknown>>(
    (acc, patch) => ({ ...acc, ...(patch ?? {}) }),
    { ...base },
  );
}

function rejectCredentialPayload(payload: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(payload)) {
    if (CREDENTIAL_FIELD_RE.test(key)) return 'Нельзя передавать пароли и токены через эту форму.';
    const raw = text(value);
    if (raw && CREDENTIAL_VALUE_RE.test(raw)) return 'Нельзя передавать пароли и токены через эту форму.';
  }
  return null;
}

function buildOwnerSetupUrl(token: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL || 'https://asi-global.ru')
    .replace(/\/$/, '');
  return `${origin}/owner-setup/${encodeURIComponent(token)}`;
}

function resolvePilotGroup(contact: CrmContact): OwnerSetupPilotGroup {
  if (contact.source === ('bragin_group' as CrmSource)) return 'bragin';
  const note = `${contact.note ?? ''}`.toLowerCase();
  if (note.includes('стригунов') || note.includes('community_member')) return 'strigunov';
  return 'other';
}

function ownerContactRefFromLead(contact: CrmContact): string | null {
  if (contact.telegramUsername) return `telegram:@${contact.telegramUsername}`;
  if (contact.phone) return `phone:${contact.phone}`;
  if (contact.email) return `email:${contact.email}`;
  return null;
}

type OwnerSetupRow = {
  id: string;
  lead_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_contact_ref: string | null;
  status: OwnerSetupStatus;
  pilot_group: OwnerSetupPilotGroup | null;
  missing_fields: string[] | null;
  readiness_score: number;
  metadata: Record<string, unknown> | null;
  public_token?: string | null;
  created_at: string;
  updated_at: string;
};

type PropertySetupRow = {
  id: string;
  owner_setup_id: string | null;
  property_id: string | null;
  lead_id: string | null;
  status: PropertySetupStatus;
  title: string | null;
  address_city: string | null;
  address_area: string | null;
  address_safe_summary: string | null;
  property_type: string | null;
  room_count: number | null;
  guest_capacity: number | null;
  checkin_time: string | null;
  checkout_time: string | null;
  wifi_status: PropertyWifiStatus;
  rules_status: PropertyRulesStatus;
  photos_status: PropertyPhotosStatus;
  pricing_status: PropertyPricingStatus;
  channel_access_status: PropertyChannelAccessStatus;
  readiness_score: number;
  missing_fields: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type PropertyAssetRow = {
  id: string;
  property_setup_id: string;
  asset_type: PropertyAssetType;
  status: PropertyAssetStatus;
  storage_ref: string | null;
  safe_label: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function mapOwnerRow(row: OwnerSetupRow): OwnerSetupProfile {
  const publicToken = text(row.public_token) || null;
  return {
    id: row.id,
    leadId: text(row.lead_id) || null,
    ownerId: text(row.owner_id) || null,
    ownerName: text(row.owner_name) || null,
    ownerContactRef: text(row.owner_contact_ref) || null,
    status: row.status,
    pilotGroup: row.pilot_group,
    missingFields: row.missing_fields ?? [],
    readinessScore: row.readiness_score ?? 0,
    metadata: row.metadata ?? {},
    publicToken,
    publicSetupUrl: publicToken ? buildOwnerSetupUrl(publicToken) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveChannelHandoffStatus(profile: PropertySetupProfile): ChannelHandoffStatus | null {
  const meta = profile.metadata;
  if (text(meta.channel_handoff_status)) return text(meta.channel_handoff_status) as ChannelHandoffStatus;
  if (profile.status === 'blocked') return 'publication_blocked';
  if (profile.status === 'ready_for_channel_preparation') {
    if (profile.channelAccessStatus === 'received') return 'channel_access_received';
    return 'ready_for_channel_preparation';
  }
  if (profile.readinessScore >= 80 && profile.missingFields.length === 0) return 'object_data_ready';
  return null;
}

function mapPropertyRow(row: PropertySetupRow): PropertySetupProfile {
  const profile: PropertySetupProfile = {
    id: row.id,
    ownerSetupId: text(row.owner_setup_id) || null,
    propertyId: text(row.property_id) || null,
    leadId: text(row.lead_id) || null,
    status: row.status,
    title: text(row.title) || null,
    addressCity: text(row.address_city) || null,
    addressArea: text(row.address_area) || null,
    addressSafeSummary: text(row.address_safe_summary) || null,
    propertyType: text(row.property_type) || null,
    roomCount: row.room_count,
    guestCapacity: row.guest_capacity,
    checkinTime: text(row.checkin_time) || null,
    checkoutTime: text(row.checkout_time) || null,
    wifiStatus: row.wifi_status,
    rulesStatus: row.rules_status,
    photosStatus: row.photos_status,
    pricingStatus: row.pricing_status,
    channelAccessStatus: row.channel_access_status,
    readinessScore: row.readiness_score ?? 0,
    missingFields: row.missing_fields ?? [],
    metadata: row.metadata ?? {},
    channelHandoffStatus: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  profile.channelHandoffStatus = resolveChannelHandoffStatus(profile);
  return profile;
}

function mapAssetRow(row: PropertyAssetRow): PropertyAsset {
  return {
    id: row.id,
    propertySetupId: row.property_setup_id,
    assetType: row.asset_type,
    status: row.status,
    storageRef: text(row.storage_ref) || null,
    safeLabel: text(row.safe_label) || null,
    rejectionReason: text(row.rejection_reason) || null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function labelMissingField(key: string): string {
  return MISSING_FIELD_LABELS_RU[key] ?? key;
}

export function ownerSetupStatusLabel(status: OwnerSetupStatus): string {
  return OWNER_SETUP_STATUS_LABELS_RU[status] ?? status;
}

export async function ensureOwnerSetupPublicToken(
  ownerSetup: OwnerSetupProfile,
): Promise<OwnerSetupProfile> {
  if (ownerSetup.publicToken) return ownerSetup;
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('booking_owner_setup_profiles')
    .update({ public_token: token, token_created_at: now, updated_at: now })
    .eq('id', ownerSetup.id)
    .is('public_token', null)
    .select('*')
    .maybeSingle();
  if (error || !data) return ownerSetup;
  return mapOwnerRow(data as OwnerSetupRow);
}

async function queueOwnerSetupCommunication(input: {
  ownerSetupId: string;
  propertySetupId?: string | null;
  messageType: OwnerSetupMessageType;
  messageText: string;
  templateKey?: string;
  channel?: string;
  ownerId?: string | null;
  propertyId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const channel = input.channel ?? 'manual';
  const autoSendDecision = await canAutoSendCommunicationIntent({
    actorType: 'owner',
    purpose: 'internal_status_notice',
    channel: channel as 'telegram' | 'email' | 'manual' | 'internal' | 'phone',
    messageText: input.messageText,
    metadata: { messageType: input.messageType, ownerSetupAutopilot: true },
  }, {
    ownerId: input.ownerId ?? null,
    propertyId: input.propertyId ?? null,
  });
  const metadata = attachAutoSendDecisionMetadata(
    mergeMetadata(
      {
        messageType: input.messageType,
        ownerSetupAutopilot: true,
        ownerSetupId: input.ownerSetupId,
        propertySetupId: input.propertySetupId ?? null,
      },
      input.metadata,
    ),
    autoSendDecision,
  );
  const now = new Date().toISOString();
  const id = randomUUID();
  await supabase.from('booking_owner_setup_communication_intents').insert({
    id,
    owner_setup_id: input.ownerSetupId,
    property_setup_id: input.propertySetupId ?? null,
    message_type: input.messageType,
    channel,
    status: 'draft_ready',
    message_text: input.messageText,
    message_template_key: input.templateKey ?? input.messageType,
    metadata,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function initializeOwnerSetupFromLead(
  leadId: string,
  metadata?: Record<string, unknown>,
): Promise<{ ownerSetup: OwnerSetupProfile; created: boolean; propertySetup: PropertySetupProfile | null }> {
  const lead = text(leadId);
  if (!lead) throw new Error('Укажите ID заявки.');

  const { data: existing } = await supabase
    .from('booking_owner_setup_profiles')
    .select('*')
    .eq('lead_id', lead)
    .maybeSingle();
  if (existing) {
    const ownerSetup = mapOwnerRow(existing as OwnerSetupRow);
    const properties = await listPropertySetupsForOwner(ownerSetup.id);
    return { ownerSetup, created: false, propertySetup: properties[0] ?? null };
  }

  const contact = await getCrmContactById(lead);
  if (!contact) throw new Error('Заявка не найдена.');

  const now = new Date().toISOString();
  const id = randomUUID();
  const ownerRow = {
    id,
    lead_id: lead,
    owner_id: null,
    owner_name: formatCrmContactNameForDisplay(contact),
    owner_contact_ref: ownerContactRefFromLead(contact),
    status: 'new' as OwnerSetupStatus,
    pilot_group: resolvePilotGroup(contact),
    missing_fields: ['property_data'],
    readiness_score: 0,
    metadata: mergeMetadata({ initialized_from: 'lead', pilot_wording: pilotWordingForGroup(resolvePilotGroup(contact)) }, metadata),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_owner_setup_profiles')
    .insert(ownerRow)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать профиль владельца.');

  const ownerSetup = mapOwnerRow(data as OwnerSetupRow);
  await queueOwnerSetupCommunication({
    ownerSetupId: ownerSetup.id,
    messageType: 'owner_setup_started',
    messageText: buildOwnerSetupStartedMessage(ownerSetup),
    ownerId: ownerSetup.ownerId,
    metadata: { leadId: lead },
  });

  return { ownerSetup, created: true, propertySetup: null };
}

function formatCrmContactNameForDisplay(contact: CrmContact): string {
  const name = text(contact.name);
  if (name) return name;
  if (contact.telegramUsername) return `@${contact.telegramUsername}`;
  return 'Владелец';
}

function pilotWordingForGroup(group: OwnerSetupPilotGroup): string {
  if (group === 'bragin') return 'Участник группы Анатолия Брагина';
  if (group === 'strigunov') return 'Участник группы Ярослава Стригунова';
  return 'Пилот ASI';
}

function buildOwnerSetupStartedMessage(owner: OwnerSetupProfile): string {
  const greeting = owner.ownerName ? `${owner.ownerName}, здравствуйте!` : 'Здравствуйте!';
  return `${greeting} Начинаем подготовку объекта к работе в ASI. Соберём базовые данные: название, адрес, правила, фото и доступ к менеджеру каналов.`;
}

export async function getOwnerSetupByLeadId(leadId: string): Promise<OwnerSetupProfile | null> {
  const lead = text(leadId);
  if (!lead) return null;
  const { data } = await supabase
    .from('booking_owner_setup_profiles')
    .select('*')
    .eq('lead_id', lead)
    .maybeSingle();
  return data ? mapOwnerRow(data as OwnerSetupRow) : null;
}

export async function getOwnerSetupById(ownerSetupId: string): Promise<OwnerSetupProfile | null> {
  const id = text(ownerSetupId);
  if (!id) return null;
  const { data } = await supabase
    .from('booking_owner_setup_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data ? mapOwnerRow(data as OwnerSetupRow) : null;
}

export async function getOwnerSetupStatus(
  ref: { ownerSetupId?: string; leadId?: string },
): Promise<{
  ownerSetup: OwnerSetupProfile | null;
  propertySetups: PropertySetupProfile[];
  communications: OwnerSetupCommunicationIntent[];
  blockers: OwnerObjectSetupBlockers | null;
}> {
  const ownerSetup = ref.ownerSetupId
    ? await getOwnerSetupById(ref.ownerSetupId)
    : ref.leadId
      ? await getOwnerSetupByLeadId(ref.leadId)
      : null;
  if (!ownerSetup) {
    return { ownerSetup: null, propertySetups: [], communications: [], blockers: null };
  }
  const propertySetups = await listPropertySetupsForOwner(ownerSetup.id);
  const communications = await listOwnerSetupCommunications(ownerSetup.id);
  const primary = propertySetups[0] ?? null;
  const blockers = await getOwnerObjectSetupBlockers({
    ownerSetupId: ownerSetup.id,
    propertySetupId: primary?.id,
  });
  return { ownerSetup, propertySetups, communications, blockers };
}

async function listPropertySetupsForOwner(ownerSetupId: string): Promise<PropertySetupProfile[]> {
  const { data } = await supabase
    .from('booking_property_setup_profiles')
    .select('*')
    .eq('owner_setup_id', ownerSetupId)
    .order('updated_at', { ascending: false });
  return ((data ?? []) as PropertySetupRow[]).map(mapPropertyRow);
}

async function listOwnerSetupCommunications(ownerSetupId: string): Promise<OwnerSetupCommunicationIntent[]> {
  const { data } = await supabase
    .from('booking_owner_setup_communication_intents')
    .select('*')
    .eq('owner_setup_id', ownerSetupId)
    .in('status', ['draft_ready', 'waiting_for_external_input'])
    .order('updated_at', { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    ownerSetupId: String(row.owner_setup_id),
    propertySetupId: text(row.property_setup_id) || null,
    messageType: text(row.message_type) as OwnerSetupMessageType,
    channel: text(row.channel),
    status: text(row.status),
    messageText: text(row.message_text),
    messageTemplateKey: text(row.message_template_key),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function startObjectDataCollection(
  ownerSetupId: string,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const owner = await getOwnerSetupById(ownerSetupId);
  if (!owner) throw new Error('Профиль владельца не найден.');

  const existing = (await listPropertySetupsForOwner(ownerSetupId))[0];
  if (existing) {
    const now = new Date().toISOString();
    await supabase
      .from('booking_owner_setup_profiles')
      .update({
        status: 'data_collection_started',
        metadata: mergeMetadata(owner.metadata, metadata),
        updated_at: now,
      })
      .eq('id', ownerSetupId);
    return existing;
  }

  const now = new Date().toISOString();
  const propertyId = randomUUID();
  const { data, error } = await supabase
    .from('booking_property_setup_profiles')
    .insert({
      id: propertyId,
      owner_setup_id: ownerSetupId,
      lead_id: owner.leadId,
      status: 'collecting_data',
      metadata: metadata ?? {},
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось начать сбор данных.');

  await supabase
    .from('booking_owner_setup_profiles')
    .update({
      status: 'data_collection_started',
      updated_at: now,
    })
    .eq('id', ownerSetupId);

  return mapPropertyRow(data as PropertySetupRow);
}

export async function getPropertySetupById(propertySetupId: string): Promise<PropertySetupProfile | null> {
  const id = text(propertySetupId);
  if (!id) return null;
  const { data } = await supabase
    .from('booking_property_setup_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data ? mapPropertyRow(data as PropertySetupRow) : null;
}

function deriveFieldStatuses(payload: PropertySetupPayload, current: PropertySetupProfile): {
  wifiStatus: PropertyWifiStatus;
  rulesStatus: PropertyRulesStatus;
  photosStatus: PropertyPhotosStatus;
  pricingStatus: PropertyPricingStatus;
} {
  const wifiStatus = payload.wifiStatus ?? current.wifiStatus;
  const rulesStatus = payload.rulesStatus
    ?? (text(payload.rulesText) ? (text(payload.rulesText).length > 20 ? 'complete' : 'partial') : current.rulesStatus);
  const photosStatus = payload.photosStatus ?? current.photosStatus;
  const pricingStatus = payload.pricingStatus
    ?? (text(payload.basePriceLabel) ? 'partial' : current.pricingStatus);
  return { wifiStatus, rulesStatus, photosStatus, pricingStatus };
}

export async function upsertPropertySetupData(
  ownerSetupId: string,
  payload: PropertySetupPayload,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const credentialError = rejectCredentialPayload(payload as Record<string, unknown>);
  if (credentialError) throw new Error(credentialError);

  let property = (await listPropertySetupsForOwner(ownerSetupId))[0];
  if (!property) property = await startObjectDataCollection(ownerSetupId);

  const derived = deriveFieldStatuses(payload, property);
  const patch: Record<string, unknown> = {
    title: payload.title !== undefined ? text(payload.title) || null : property.title,
    address_city: payload.addressCity !== undefined ? text(payload.addressCity) || null : property.addressCity,
    address_area: payload.addressArea !== undefined ? text(payload.addressArea) || null : property.addressArea,
    address_safe_summary: payload.addressSafeSummary !== undefined
      ? text(payload.addressSafeSummary) || null
      : property.addressSafeSummary,
    property_type: payload.propertyType !== undefined ? text(payload.propertyType) || null : property.propertyType,
    room_count: payload.roomCount !== undefined ? safeInt(payload.roomCount) : property.roomCount,
    guest_capacity: payload.guestCapacity !== undefined ? safeInt(payload.guestCapacity) : property.guestCapacity,
    checkin_time: payload.checkinTime !== undefined ? text(payload.checkinTime) || null : property.checkinTime,
    checkout_time: payload.checkoutTime !== undefined ? text(payload.checkoutTime) || null : property.checkoutTime,
    wifi_status: derived.wifiStatus,
    rules_status: derived.rulesStatus,
    photos_status: derived.photosStatus,
    pricing_status: derived.pricingStatus,
    channel_access_status: payload.channelAccessStatus ?? property.channelAccessStatus,
    property_id: payload.propertyId !== undefined ? text(payload.propertyId) || null : property.propertyId,
    metadata: mergeMetadata(property.metadata, mergeMetadata(
      payload.rulesText ? { rules_text_safe: text(payload.rulesText).slice(0, 2000) } : {},
      payload.basePriceLabel ? { base_price_label: text(payload.basePriceLabel) } : {},
      metadata,
    )),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('booking_property_setup_profiles')
    .update(patch)
    .eq('id', property.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить данные объекта.');

  return validatePropertySetup(property.id);
}

export async function addPropertyAsset(
  propertySetupId: string,
  asset: {
    assetType: PropertyAssetType;
    storageRef?: string | null;
    safeLabel?: string | null;
    status?: PropertyAssetStatus;
  },
  metadata?: Record<string, unknown>,
): Promise<{ asset: PropertyAsset; propertySetup: PropertySetupProfile }> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');

  const credentialError = rejectCredentialPayload(asset as Record<string, unknown>);
  if (credentialError) throw new Error(credentialError);

  const now = new Date().toISOString();
  const id = randomUUID();
  const { data, error } = await supabase
    .from('booking_property_assets')
    .insert({
      id,
      property_setup_id: propertySetupId,
      asset_type: asset.assetType,
      status: asset.status ?? 'uploaded',
      storage_ref: text(asset.storageRef) || null,
      safe_label: text(asset.safeLabel) || null,
      metadata: metadata ?? {},
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось добавить файл.');

  const propertySetup = await recomputePhotosStatus(propertySetupId);
  return { asset: mapAssetRow(data as PropertyAssetRow), propertySetup };
}

async function recomputePhotosStatus(propertySetupId: string): Promise<PropertySetupProfile> {
  const { data: assets } = await supabase
    .from('booking_property_assets')
    .select('id,status,asset_type')
    .eq('property_setup_id', propertySetupId)
    .eq('asset_type', 'photo')
    .not('status', 'eq', 'rejected');

  const photoCount = (assets ?? []).length;
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');

  let photosStatus: PropertyPhotosStatus = 'missing';
  if (photoCount >= 5) photosStatus = 'ready';
  else if (photoCount >= 3) photosStatus = 'enough';
  else if (photoCount > 0) photosStatus = 'partial';
  else if (text(property.metadata.photos_placeholder) === 'later') photosStatus = 'partial';

  await supabase
    .from('booking_property_setup_profiles')
    .update({ photos_status: photosStatus, updated_at: new Date().toISOString() })
    .eq('id', propertySetupId);

  return validatePropertySetup(propertySetupId);
}

export function getMissingPropertySetupFields(profile: PropertySetupProfile): string[] {
  const missing: string[] = [];
  if (!text(profile.title)) missing.push('title');
  if (!text(profile.addressCity) && !text(profile.addressSafeSummary)) missing.push('address');
  if (!text(profile.propertyType)) missing.push('property_type');
  if (!profile.guestCapacity && !profile.roomCount) missing.push('capacity');
  if (!text(profile.checkinTime) || !text(profile.checkoutTime)) missing.push('checkin_checkout');
  if (profile.rulesStatus === 'missing') missing.push('rules');
  if (!['enough', 'ready', 'partial'].includes(profile.photosStatus)) missing.push('photos');
  if (profile.pricingStatus === 'missing') missing.push('pricing');
  if (!['received', 'requested'].includes(profile.channelAccessStatus)) missing.push('channel_access');
  if (profile.wifiStatus === 'missing') missing.push('wifi');
  return missing;
}

export function computePropertySetupReadiness(profile: PropertySetupProfile): {
  readinessScore: number;
  missingFields: string[];
  status: PropertySetupStatus;
} {
  const missingFields = getMissingPropertySetupFields(profile);
  const weights = {
    title: 12,
    address: 12,
    property_type: 10,
    capacity: 10,
    checkin_checkout: 12,
    rules: 10,
    photos: 14,
    pricing: 10,
    channel_access: 10,
  };
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const lost = missingFields.reduce((sum, key) => sum + (weights[key as keyof typeof weights] ?? 5), 0);
  const readinessScore = Math.max(0, Math.round(((total - lost) / total) * 100));

  let status: PropertySetupStatus = profile.status;
  if (profile.status !== 'blocked') {
    if (missingFields.length === 0 && readinessScore >= 85) {
      status = profile.channelAccessStatus === 'received'
        ? 'ready_for_channel_preparation'
        : 'ready_for_review';
    } else if (missingFields.length > 0) {
      status = profile.status === 'new' ? 'collecting_data' : 'incomplete';
    }
  }

  return { readinessScore, missingFields, status };
}

export async function validatePropertySetup(propertySetupId: string): Promise<PropertySetupProfile> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');

  const { readinessScore, missingFields, status } = computePropertySetupReadiness(property);
  const channelHandoff = status === 'ready_for_channel_preparation'
    ? 'ready_for_channel_preparation'
    : property.channelAccessStatus === 'received'
      ? 'channel_access_received'
      : readinessScore >= 80 && missingFields.length === 0
        ? 'object_data_ready'
        : property.status === 'blocked'
          ? 'publication_blocked'
          : null;

  const { data, error } = await supabase
    .from('booking_property_setup_profiles')
    .update({
      readiness_score: readinessScore,
      missing_fields: missingFields,
      status,
      metadata: mergeMetadata(property.metadata, channelHandoff ? { channel_handoff_status: channelHandoff } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertySetupId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось проверить готовность.');

  const updated = mapPropertyRow(data as PropertySetupRow);
  if (property.ownerSetupId) await syncOwnerSetupAggregate(property.ownerSetupId);
  return updated;
}

async function syncOwnerSetupAggregate(ownerSetupId: string): Promise<void> {
  const owner = await getOwnerSetupById(ownerSetupId);
  if (!owner) return;
  const properties = await listPropertySetupsForOwner(ownerSetupId);
  const primary = properties[0];
  if (!primary) return;

  const missing = [...new Set(properties.flatMap((p) => p.missingFields))];
  const readinessScore = primary.readinessScore;
  let status: OwnerSetupStatus = owner.status;
  if (owner.status !== 'blocked') {
    if (primary.status === 'ready_for_channel_preparation') status = 'ready_for_setup';
    else if (primary.channelAccessStatus === 'received') status = 'access_received';
    else if (primary.channelAccessStatus === 'requested') status = 'access_requested';
    else if (missing.length === 0) status = 'data_ready';
    else if (owner.status === 'new') status = 'data_collection_started';
    else status = 'data_incomplete';
  }

  await supabase
    .from('booking_owner_setup_profiles')
    .update({
      status,
      missing_fields: missing,
      readiness_score: readinessScore,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ownerSetupId);
}

function buildMissingDataMessage(property: PropertySetupProfile): string {
  const labels = property.missingFields.map(labelMissingField);
  const title = property.title ? `по объекту «${property.title}»` : 'по объекту';
  return `Пожалуйста, пришлите недостающие данные ${title}: ${labels.join(', ')}.`;
}

export async function requestMissingPropertySetupData(
  propertySetupId: string,
  metadata?: Record<string, unknown>,
): Promise<{ propertySetup: PropertySetupProfile; communicationIntentId: string }> {
  const property = await validatePropertySetup(propertySetupId);
  if (property.missingFields.length === 0) {
    throw new Error('Все обязательные поля уже заполнены.');
  }
  const owner = property.ownerSetupId ? await getOwnerSetupById(property.ownerSetupId) : null;
  const communicationIntentId = await queueOwnerSetupCommunication({
    ownerSetupId: owner?.id ?? property.ownerSetupId ?? '',
    propertySetupId: property.id,
    messageType: 'request_property_missing_data',
    messageText: buildMissingDataMessage(property),
    ownerId: owner?.ownerId ?? null,
    propertyId: property.propertyId,
    metadata,
  });
  return { propertySetup: property, communicationIntentId };
}

export async function requestPropertyPhotos(
  propertySetupId: string,
  metadata?: Record<string, unknown>,
): Promise<{ propertySetup: PropertySetupProfile; communicationIntentId: string }> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');
  const owner = property.ownerSetupId ? await getOwnerSetupById(property.ownerSetupId) : null;
  const communicationIntentId = await queueOwnerSetupCommunication({
    ownerSetupId: owner?.id ?? property.ownerSetupId ?? '',
    propertySetupId: property.id,
    messageType: 'request_property_photos',
    messageText: 'Пожалуйста, пришлите фотографии объекта: комнаты, кухня, санузел и вход. Минимум 3–5 снимков.',
    ownerId: owner?.ownerId ?? null,
    propertyId: property.propertyId,
    metadata,
  });
  return { propertySetup: property, communicationIntentId };
}

export async function markChannelAccessRequested(
  propertySetupId: string,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');

  await supabase
    .from('booking_property_setup_profiles')
    .update({
      channel_access_status: 'requested',
      metadata: mergeMetadata(property.metadata, metadata),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertySetupId);

  const owner = property.ownerSetupId ? await getOwnerSetupById(property.ownerSetupId) : null;
  await queueOwnerSetupCommunication({
    ownerSetupId: owner?.id ?? property.ownerSetupId ?? '',
    propertySetupId: property.id,
    messageType: 'request_channel_manager_access',
    messageText: 'Для подключения объекта нужен доступ к менеджеру каналов. Пришлите приглашение или укажите, какой сервис используете — без паролей в переписке.',
    ownerId: owner?.ownerId ?? null,
    propertyId: property.propertyId,
    metadata: mergeMetadata({ safe_secret_reference: true }, metadata),
  });

  if (property.ownerSetupId) await syncOwnerSetupAggregate(property.ownerSetupId);
  return validatePropertySetup(propertySetupId);
}

export async function markChannelAccessReceived(
  propertySetupId: string,
  safeAccessRef?: string | null,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');

  await supabase
    .from('booking_property_setup_profiles')
    .update({
      channel_access_status: 'received',
      metadata: mergeMetadata(property.metadata, mergeMetadata(
        safeAccessRef ? { channel_access_ref: text(safeAccessRef).slice(0, 120) } : {},
        { channel_handoff_status: 'channel_access_received' },
        metadata,
      )),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertySetupId);

  const owner = property.ownerSetupId ? await getOwnerSetupById(property.ownerSetupId) : null;
  await queueOwnerSetupCommunication({
    ownerSetupId: owner?.id ?? property.ownerSetupId ?? '',
    propertySetupId: property.id,
    messageType: 'internal_status_notice',
    messageText: 'Доступ к менеджеру каналов отмечен как полученный. Оператор проверит подключение.',
    channel: 'internal',
    ownerId: owner?.ownerId ?? null,
    propertyId: property.propertyId,
    metadata: { safe_secret_reference: true },
  });

  if (property.ownerSetupId) await syncOwnerSetupAggregate(property.ownerSetupId);
  return validatePropertySetup(propertySetupId);
}

export async function markTestObjectSelected(
  ownerSetupId: string,
  propertySetupId: string,
  metadata?: Record<string, unknown>,
): Promise<OwnerSetupProfile> {
  const owner = await getOwnerSetupById(ownerSetupId);
  const property = await getPropertySetupById(propertySetupId);
  if (!owner || !property) throw new Error('Профиль не найден.');

  const { data } = await supabase
    .from('booking_owner_setup_profiles')
    .update({
      status: 'test_object_selected',
      metadata: mergeMetadata(owner.metadata, { test_object_setup_id: propertySetupId, ...metadata }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', ownerSetupId)
    .select('*')
    .single();
  if (!data) throw new Error('Не удалось отметить тестовый объект.');

  await queueOwnerSetupCommunication({
    ownerSetupId,
    propertySetupId,
    messageType: 'internal_status_notice',
    messageText: `Тестовый объект выбран: ${property.title ?? 'без названия'}.`,
    channel: 'internal',
    ownerId: owner.ownerId,
    propertyId: property.propertyId,
  });

  return mapOwnerRow(data as OwnerSetupRow);
}

export async function markReadyForChannelPreparation(
  propertySetupId: string,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const property = await validatePropertySetup(propertySetupId);
  if (property.missingFields.length > 0) {
    throw new Error(`Нельзя подготовить объект: не хватает ${property.missingFields.map(labelMissingField).join(', ')}.`);
  }
  if (property.channelAccessStatus !== 'received') {
    throw new Error('Нужен полученный доступ к менеджеру каналов.');
  }

  const { data } = await supabase
    .from('booking_property_setup_profiles')
    .update({
      status: 'ready_for_channel_preparation',
      metadata: mergeMetadata(property.metadata, {
        channel_handoff_status: 'manual_channel_publication_pending',
        ...metadata,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertySetupId)
    .select('*')
    .single();
  if (!data) throw new Error('Не удалось отметить готовность.');

  const owner = property.ownerSetupId ? await getOwnerSetupById(property.ownerSetupId) : null;
  await queueOwnerSetupCommunication({
    ownerSetupId: owner?.id ?? property.ownerSetupId ?? '',
    propertySetupId: property.id,
    messageType: 'object_ready_for_review_notice',
    messageText: 'Данные объекта собраны. Оператор проверит карточку и подготовит публикацию в менеджере каналов.',
    ownerId: owner?.ownerId ?? null,
    propertyId: property.propertyId,
  });

  if (property.ownerSetupId) await syncOwnerSetupAggregate(property.ownerSetupId);
  return mapPropertyRow(data as PropertySetupRow);
}

export async function blockPropertySetup(
  propertySetupId: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');

  const { data } = await supabase
    .from('booking_property_setup_profiles')
    .update({
      status: 'blocked',
      metadata: mergeMetadata(property.metadata, {
        block_reason: text(reason).slice(0, 500),
        channel_handoff_status: 'publication_blocked',
        ...metadata,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertySetupId)
    .select('*')
    .single();
  if (!data) throw new Error('Не удалось заблокировать объект.');

  if (property.ownerSetupId) {
    await supabase
      .from('booking_owner_setup_profiles')
      .update({ status: 'blocked', updated_at: new Date().toISOString() })
      .eq('id', property.ownerSetupId);
  }

  return mapPropertyRow(data as PropertySetupRow);
}

export async function addPropertySetupNote(
  propertySetupId: string,
  note: string,
  metadata?: Record<string, unknown>,
): Promise<PropertySetupProfile> {
  const property = await getPropertySetupById(propertySetupId);
  if (!property) throw new Error('Профиль объекта не найден.');
  const notes = Array.isArray(property.metadata.notes)
    ? [...(property.metadata.notes as string[]), text(note)]
    : [text(note)];
  const { data } = await supabase
    .from('booking_property_setup_profiles')
    .update({
      metadata: mergeMetadata(property.metadata, { notes, ...metadata }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertySetupId)
    .select('*')
    .single();
  if (!data) throw new Error('Не удалось добавить заметку.');
  return mapPropertyRow(data as PropertySetupRow);
}

export async function getOwnerObjectSetupBlockers(
  ref: { ownerSetupId?: string; propertySetupId?: string },
): Promise<OwnerObjectSetupBlockers | null> {
  const property = ref.propertySetupId
    ? await getPropertySetupById(ref.propertySetupId)
    : null;
  const ownerSetupId = ref.ownerSetupId ?? property?.ownerSetupId ?? null;
  if (!ownerSetupId) return null;

  const owner = await getOwnerSetupById(ownerSetupId);
  const primary = property ?? (await listPropertySetupsForOwner(ownerSetupId))[0] ?? null;
  const blockers: string[] = [];

  if (owner?.status === 'blocked' || primary?.status === 'blocked') {
    blockers.push(text(primary?.metadata.block_reason) || 'Настройка заблокирована.');
  }
  if (primary) {
    for (const field of primary.missingFields) {
      blockers.push(`Не хватает: ${labelMissingField(field)}`);
    }
    if (primary.channelAccessStatus === 'not_requested') {
      blockers.push('Доступ к менеджеру каналов ещё не запрошен.');
    }
    if (primary.channelAccessStatus === 'requested') {
      blockers.push('Ожидаем доступ к менеджеру каналов.');
    }
  }

  let nextAction: string | null = null;
  if (!primary) nextAction = 'Начать сбор данных объекта';
  else if (primary.missingFields.includes('photos')) nextAction = 'Запросить фотографии';
  else if (primary.missingFields.length > 0) nextAction = 'Запросить недостающие данные';
  else if (primary.channelAccessStatus === 'not_requested') nextAction = 'Запросить доступ к менеджеру каналов';
  else if (primary.status === 'ready_for_review') nextAction = 'Проверить данные и отметить готовность';
  else if (primary.status === 'ready_for_channel_preparation') nextAction = 'Передать в менеджер каналов (вручную)';

  return {
    ownerSetupId,
    propertySetupId: primary?.id ?? null,
    blockers,
    missingFields: primary?.missingFields ?? owner?.missingFields ?? [],
    nextAction,
    channelHandoffStatus: primary?.channelHandoffStatus ?? null,
  };
}

export async function listPropertySetups(filters?: {
  ownerSetupId?: string;
  leadId?: string;
  status?: PropertySetupStatus;
  limit?: number;
}): Promise<PropertySetupProfile[]> {
  let query = supabase
    .from('booking_property_setup_profiles')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(filters?.limit ?? 50);

  if (filters?.ownerSetupId) query = query.eq('owner_setup_id', filters.ownerSetupId);
  if (filters?.leadId) query = query.eq('lead_id', filters.leadId);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data } = await query;
  return ((data ?? []) as PropertySetupRow[]).map(mapPropertyRow);
}

const PUBLIC_SUBMIT_RATE = new Map<string, { count: number; resetAt: number }>();
const PUBLIC_RATE_LIMIT = 20;
const PUBLIC_RATE_WINDOW_MS = 60_000;

export function checkOwnerSetupSubmitRateLimit(token: string): boolean {
  const key = text(token).slice(0, 64);
  if (!key) return false;
  const now = Date.now();
  const entry = PUBLIC_SUBMIT_RATE.get(key);
  if (!entry || entry.resetAt < now) {
    PUBLIC_SUBMIT_RATE.set(key, { count: 1, resetAt: now + PUBLIC_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= PUBLIC_RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export type OwnerSetupPublicSubmitPayload = {
  title?: string;
  addressCity?: string;
  addressArea?: string;
  propertyType?: string;
  guestCapacity?: number;
  checkinTime?: string;
  checkoutTime?: string;
  rulesText?: string;
  basePriceLabel?: string;
  wifiProvided?: boolean;
  photosPlaceholder?: boolean;
};

export function validateOwnerSetupPublicPayload(
  payload: OwnerSetupPublicSubmitPayload,
): string | null {
  if (!text(payload.title) && !text(payload.addressCity)) {
    return 'Укажите название объекта или город.';
  }
  const credentialError = rejectCredentialPayload(payload as Record<string, unknown>);
  if (credentialError) return credentialError;
  return null;
}

export async function getOwnerSetupByPublicToken(token: string): Promise<OwnerSetupProfile | null> {
  const value = text(token);
  if (!value) return null;
  const { data } = await supabase
    .from('booking_owner_setup_profiles')
    .select('*')
    .eq('public_token', value)
    .maybeSingle();
  return data ? mapOwnerRow(data as OwnerSetupRow) : null;
}

export async function submitOwnerSetupPublicData(
  token: string,
  payload: OwnerSetupPublicSubmitPayload,
): Promise<{ propertySetup: PropertySetupProfile; acknowledgementIntentId: string }> {
  const validationError = validateOwnerSetupPublicPayload(payload);
  if (validationError) throw new Error(validationError);
  if (!checkOwnerSetupSubmitRateLimit(token)) throw new Error('Слишком много запросов. Попробуйте позже.');

  const owner = await getOwnerSetupByPublicToken(token);
  if (!owner) throw new Error('Ссылка недействительна.');

  await supabase
    .from('booking_owner_setup_profiles')
    .update({ token_opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', owner.id)
    .is('token_opened_at', null);

  const propertySetup = await upsertPropertySetupData(owner.id, {
    title: payload.title,
    addressCity: payload.addressCity,
    addressArea: payload.addressArea,
    propertyType: payload.propertyType,
    guestCapacity: payload.guestCapacity,
    checkinTime: payload.checkinTime,
    checkoutTime: payload.checkoutTime,
    rulesText: payload.rulesText,
    basePriceLabel: payload.basePriceLabel,
    wifiStatus: payload.wifiProvided ? 'provided' : undefined,
    photosStatus: payload.photosPlaceholder ? 'partial' : undefined,
  }, {
    submitted_via: 'public_token',
    photos_placeholder: payload.photosPlaceholder ? 'later' : undefined,
  });

  const acknowledgementIntentId = await queueOwnerSetupCommunication({
    ownerSetupId: owner.id,
    propertySetupId: propertySetup.id,
    messageType: 'object_data_received_acknowledgement',
    messageText: 'Спасибо! Мы получили данные по объекту и проверим их.',
    ownerId: owner.ownerId,
    propertyId: propertySetup.propertyId,
  });

  return { propertySetup, acknowledgementIntentId };
}

export async function markOwnerInstructionSent(ownerSetupId: string): Promise<OwnerSetupProfile> {
  const owner = await getOwnerSetupById(ownerSetupId);
  if (!owner) throw new Error('Профиль владельца не найден.');
  await ensureOwnerSetupPublicToken(owner);
  const { data } = await supabase
    .from('booking_owner_setup_profiles')
    .update({ status: 'instruction_sent', updated_at: new Date().toISOString() })
    .eq('id', ownerSetupId)
    .select('*')
    .single();
  if (!data) throw new Error('Не удалось обновить статус.');
  return mapOwnerRow(data as OwnerSetupRow);
}
