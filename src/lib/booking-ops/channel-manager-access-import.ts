import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { auditChannelImportAvailability } from './availability-overbooking-protection';
import {
  attachAutoSendDecisionMetadata,
  canAutoSendCommunicationIntent,
} from './communication-auto-send-policy';
import { processInboundBookingRequest } from './real-booking-intake-autopilot';

export const CHANNEL_MANAGER_PROVIDERS = ['manual', 'bnovo', 'realtycalendar', 'travelline', 'other'] as const;
export type ChannelManagerProvider = (typeof CHANNEL_MANAGER_PROVIDERS)[number];
export const CHANNEL_MANAGER_ONBOARDING_STATUSES = [
  'not_started', 'provider_selected', 'account_required', 'access_requested', 'access_received',
  'operator_review', 'import_ready', 'manual_snapshot_available', 'pilot_activation_pending',
  'connected_placeholder', 'blocked',
] as const;
export type ChannelManagerOnboardingStatus = (typeof CHANNEL_MANAGER_ONBOARDING_STATUSES)[number];
export const CHANNEL_MANAGER_ONBOARDING_STATUS_LABELS: Record<ChannelManagerOnboardingStatus, string> = {
  not_started: 'Не начато',
  provider_selected: 'Провайдер выбран',
  account_required: 'Нужен аккаунт провайдера',
  access_requested: 'Доступ запрошен',
  access_received: 'Доступ получен безопасно',
  operator_review: 'Проверка оператором',
  import_ready: 'Готово к импорту',
  manual_snapshot_available: 'Доступен импорт snapshot',
  pilot_activation_pending: 'Ожидает пилотной активации',
  connected_placeholder: 'Подготовка завершена — API ещё не активен',
  blocked: 'Подключение заблокировано',
};
export const CHANNEL_IMPORT_TYPES = ['full', 'objects', 'bookings', 'calendar', 'pricing', 'availability', 'manual_snapshot'] as const;
export type ChannelImportType = (typeof CHANNEL_IMPORT_TYPES)[number];

export type ChannelManagerConnection = {
  id: string;
  ownerSetupId: string | null;
  propertySetupId: string | null;
  ownerId: string | null;
  provider: ChannelManagerProvider;
  status: string;
  accessStatus: string;
  safeAccessRef: string | null;
  providerAccountRef: string | null;
  lastImportAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ChannelImportRun = {
  id: string;
  connectionId: string;
  provider: ChannelManagerProvider;
  status: string;
  importType: ChannelImportType;
  startedAt: string | null;
  finishedAt: string | null;
  importedObjectsCount: number;
  importedBookingsCount: number;
  importedCalendarDaysCount: number;
  importedPricesCount: number;
  warnings: unknown[];
  errors: unknown[];
  safeSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ManualChannelSnapshot = {
  objects?: Array<Record<string, unknown>>;
  bookings?: Array<Record<string, unknown>>;
  calendar?: Array<Record<string, unknown>>;
  pricing?: Array<Record<string, unknown>>;
};

export type ChannelProviderAdapter = {
  provider_key: ChannelManagerProvider;
  supports_objects_import: boolean;
  supports_bookings_import: boolean;
  supports_calendar_import: boolean;
  supports_pricing_import: boolean;
  supports_real_api: boolean;
  importObjects: (connectionId: string, rows: Array<Record<string, unknown>>, options?: { importRunId?: string }) => Promise<number>;
  importBookings: (connectionId: string, rows: Array<Record<string, unknown>>, options?: { importRunId?: string }) => Promise<number>;
  importCalendar: (connectionId: string, rows: Array<Record<string, unknown>>, options?: { importRunId?: string }) => Promise<number>;
  importPricing: (connectionId: string, rows: Array<Record<string, unknown>>, options?: { importRunId?: string }) => Promise<number>;
};

const SECRET_KEY_RE = /(?:password|passwd|парол|token|токен|api[_-]?key|secret|client[_-]?secret|authorization|cookie|login|логин)/iu;
const SECRET_VALUE_RE = /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:password|пароль|token|api[_-]?key|secret)\s*[:=]\s*\S+)/iu;
const SAFE_REF_RE = /^(?:vault|secret|credential|operator|manual|ref|cm):[a-z0-9_./:@-]+$/iu;
const MAX_SNAPSHOT_BYTES = 1_000_000;
const MAX_SNAPSHOT_ROWS = 500;

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

function normalizeProvider(value: unknown): ChannelManagerProvider {
  const provider = text(value).toLowerCase();
  if ((CHANNEL_MANAGER_PROVIDERS as readonly string[]).includes(provider)) return provider as ChannelManagerProvider;
  return 'other';
}

export function parseChannelManagerProvider(value: unknown): ChannelManagerProvider {
  const provider = text(value).toLowerCase();
  if (!(CHANNEL_MANAGER_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error('Выберите поддерживаемого провайдера.');
  }
  return provider as ChannelManagerProvider;
}

function assertUuid(value: unknown, label = 'ID'): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error(`${label} указан неверно.`);
  }
  return id;
}

export function findSecretPath(value: unknown, path = 'payload'): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) return `${path}.${key}`;
      const found = findSecretPath(child, `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return typeof value === 'string' && SECRET_VALUE_RE.test(value) ? path : null;
}

function assertNoSecrets(value: unknown): void {
  if (findSecretPath(value)) throw new Error('Пароли, токены и другие секреты нельзя передавать или сохранять в импорте.');
}

function validateSafeAccessRef(value: unknown): string | null {
  const ref = nullableText(value);
  if (!ref) return null;
  if (ref.length > 255 || SECRET_VALUE_RE.test(ref) || !SAFE_REF_RE.test(ref)) {
    throw new Error('Укажите только безопасную ссылку на доступ, например vault:cm/object-1 или operator:confirmed.');
  }
  return ref;
}

function safeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  const result = metadata ?? {};
  assertNoSecrets(result);
  return result;
}

function mapConnection(row: Record<string, unknown>): ChannelManagerConnection {
  return {
    id: text(row.id), ownerSetupId: nullableText(row.owner_setup_id), propertySetupId: nullableText(row.property_setup_id),
    ownerId: nullableText(row.owner_id), provider: normalizeProvider(row.provider), status: text(row.status),
    accessStatus: text(row.access_status), safeAccessRef: nullableText(row.safe_access_ref),
    providerAccountRef: nullableText(row.provider_account_ref), lastImportAt: nullableText(row.last_import_at),
    lastSuccessAt: nullableText(row.last_success_at), lastFailureAt: nullableText(row.last_failure_at),
    failureReason: nullableText(row.failure_reason), metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): ChannelImportRun {
  return {
    id: text(row.id), connectionId: text(row.connection_id), provider: normalizeProvider(row.provider),
    status: text(row.status), importType: text(row.import_type) as ChannelImportType,
    startedAt: nullableText(row.started_at), finishedAt: nullableText(row.finished_at),
    importedObjectsCount: Number(row.imported_objects_count ?? 0), importedBookingsCount: Number(row.imported_bookings_count ?? 0),
    importedCalendarDaysCount: Number(row.imported_calendar_days_count ?? 0), importedPricesCount: Number(row.imported_prices_count ?? 0),
    warnings: Array.isArray(row.warnings) ? row.warnings : [], errors: Array.isArray(row.errors) ? row.errors : [],
    safeSummary: nullableText(row.safe_summary), metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

async function getConnection(connectionId: string): Promise<ChannelManagerConnection> {
  const id = assertUuid(connectionId, 'ID подключения');
  const { data, error } = await supabase.from('booking_channel_manager_connections').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'Подключение не найдено.');
  return mapConnection(data as Record<string, unknown>);
}

export async function queueChannelManagerCommunication(connection: ChannelManagerConnection, messageType: string, messageText: string): Promise<string | null> {
  if (!connection.ownerSetupId) return null;
  const decision = await canAutoSendCommunicationIntent({
    actorType: 'owner', purpose: 'internal_status_notice', channel: 'manual', messageText,
    metadata: { messageType, channelManagerAccessImport: true },
  }, { ownerId: connection.ownerId, propertyId: null });
  const id = randomUUID();
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_owner_setup_communication_intents').insert({
    id, owner_setup_id: connection.ownerSetupId, property_setup_id: connection.propertySetupId,
    message_type: messageType, channel: 'manual', status: 'draft_ready', message_text: messageText,
    message_template_key: messageType,
    metadata: attachAutoSendDecisionMetadata({ channelManagerAccessImport: true, connectionId: connection.id }, decision),
    created_at: now, updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

function unavailableAdapter(provider: ChannelManagerProvider): ChannelProviderAdapter {
  const fail = async (): Promise<never> => {
    throw new Error(`Реальный API ${provider} в этой версии не подключён. Используйте ручной снимок JSON.`);
  };
  return {
    provider_key: provider,
    supports_objects_import: false, supports_bookings_import: false, supports_calendar_import: false,
    supports_pricing_import: false, supports_real_api: false,
    importObjects: fail, importBookings: fail, importCalendar: fail, importPricing: fail,
  };
}

export const CHANNEL_PROVIDER_ADAPTERS: Record<ChannelManagerProvider, ChannelProviderAdapter> = {
  manual: {
    provider_key: 'manual', supports_objects_import: true, supports_bookings_import: true,
    supports_calendar_import: true, supports_pricing_import: true, supports_real_api: false,
    importObjects: importChannelObjects, importBookings: importChannelBookings,
    importCalendar: importChannelCalendar,
    importPricing: (connectionId, rows, options) => importChannelCalendar(connectionId, rows, { ...options, pricing: true }),
  },
  bnovo: unavailableAdapter('bnovo'),
  realtycalendar: unavailableAdapter('realtycalendar'),
  travelline: unavailableAdapter('travelline'),
  other: unavailableAdapter('other'),
};

export async function initializeChannelManagerConnection(propertySetupId: string, provider: ChannelManagerProvider, metadata?: Record<string, unknown>): Promise<ChannelManagerConnection> {
  const propertyId = assertUuid(propertySetupId, 'ID профиля объекта');
  const normalizedProvider = normalizeProvider(provider);
  const { data: property, error: propertyError } = await supabase.from('booking_property_setup_profiles').select('*').eq('id', propertyId).maybeSingle();
  if (propertyError || !property) throw new Error('Профиль объекта не найден.');
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), owner_setup_id: property.owner_setup_id ?? null, property_setup_id: propertyId,
    owner_id: null, provider: normalizedProvider, status: 'not_started', access_status: 'unknown',
    metadata: safeMetadata(metadata), created_at: now, updated_at: now,
  };
  const { data, error } = await supabase.from('booking_channel_manager_connections').upsert(row, { onConflict: 'property_setup_id,provider', ignoreDuplicates: true }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return mapConnection(data as Record<string, unknown>);
  const { data: existing, error: existingError } = await supabase.from('booking_channel_manager_connections').select('*').eq('property_setup_id', propertyId).eq('provider', normalizedProvider).single();
  if (existingError || !existing) throw new Error(existingError?.message ?? 'Не удалось создать подключение.');
  return mapConnection(existing as Record<string, unknown>);
}

export async function requestChannelManagerAccess(propertySetupId: string, provider: ChannelManagerProvider, metadata?: Record<string, unknown>): Promise<ChannelManagerConnection> {
  const connection = await initializeChannelManagerConnection(propertySetupId, provider, metadata);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_manager_connections').update({ status: 'requested', access_status: 'requested', updated_at: now }).eq('id', connection.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось запросить доступ.');
  const updated = mapConnection(data as Record<string, unknown>);
  await supabase.from('booking_property_setup_profiles').update({ channel_access_status: 'requested', updated_at: now }).eq('id', propertySetupId);
  await queueChannelManagerCommunication(updated, 'request_channel_manager_access', 'Для подготовки импорта нужен доступ к менеджеру каналов. Передайте его безопасным способом — не отправляйте пароль или токен в сообщении.');
  return updated;
}

export async function markChannelManagerAccessReceived(connectionId: string, safeAccessRef?: string | null, metadata?: Record<string, unknown>): Promise<ChannelManagerConnection> {
  const connection = await getConnection(connectionId);
  const ref = validateSafeAccessRef(safeAccessRef);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_manager_connections').update({
    status: ref ? 'access_received' : 'credential_ref_pending', access_status: 'received', safe_access_ref: ref,
    metadata: { ...connection.metadata, ...safeMetadata(metadata) }, failure_reason: null, updated_at: now,
  }).eq('id', connection.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось отметить получение доступа.');
  if (connection.propertySetupId) await supabase.from('booking_property_setup_profiles').update({ channel_access_status: 'received', updated_at: now }).eq('id', connection.propertySetupId);
  const updated = mapConnection(data as Record<string, unknown>);
  await queueChannelManagerCommunication(updated, 'channel_access_received_acknowledgement', 'Доступ к менеджеру каналов отмечен как полученный. Пароли и токены в ASI не сохранены.');
  return updated;
}

export async function markChannelManagerAccessInvalid(connectionId: string, reason: string, metadata?: Record<string, unknown>): Promise<ChannelManagerConnection> {
  const connection = await getConnection(connectionId);
  assertNoSecrets(reason);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_manager_connections').update({
    status: 'blocked', access_status: 'invalid', safe_access_ref: null, failure_reason: text(reason).slice(0, 500),
    metadata: { ...connection.metadata, ...safeMetadata(metadata) }, last_failure_at: now, updated_at: now,
  }).eq('id', connection.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить доступ.');
  if (connection.propertySetupId) await supabase.from('booking_property_setup_profiles').update({ channel_access_status: 'invalid', updated_at: now }).eq('id', connection.propertySetupId);
  return mapConnection(data as Record<string, unknown>);
}

export async function getChannelManagerConnectionStatus(ref: string | { connectionId?: string; propertySetupId?: string }): Promise<ChannelManagerConnection | null> {
  const connectionId = typeof ref === 'string' ? ref : ref.connectionId;
  let query = supabase.from('booking_channel_manager_connections').select('*');
  if (connectionId) query = query.eq('id', assertUuid(connectionId, 'ID подключения'));
  else if (typeof ref !== 'string' && ref.propertySetupId) query = query.eq('property_setup_id', assertUuid(ref.propertySetupId, 'ID профиля объекта')).order('updated_at', { ascending: false });
  else throw new Error('Укажите подключение или профиль объекта.');
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapConnection(data as Record<string, unknown>) : null;
}

export async function listChannelManagerConnections(propertySetupId?: string): Promise<ChannelManagerConnection[]> {
  let query = supabase.from('booking_channel_manager_connections').select('*').order('updated_at', { ascending: false });
  if (propertySetupId) query = query.eq('property_setup_id', assertUuid(propertySetupId, 'ID профиля объекта'));
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapConnection);
}

export async function startChannelImportRun(connectionId: string, importType: ChannelImportType, options?: { dryRun?: boolean; executeProvider?: boolean; metadata?: Record<string, unknown> }): Promise<ChannelImportRun> {
  const connection = await getConnection(connectionId);
  if (!(CHANNEL_IMPORT_TYPES as readonly string[]).includes(importType)) throw new Error('Недопустимый тип импорта.');
  if (options?.executeProvider && !CHANNEL_PROVIDER_ADAPTERS[connection.provider].supports_real_api) {
    throw new Error(`Реальный API ${connection.provider} в этой версии не подключён. Используйте ручной снимок JSON.`);
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_import_runs').insert({
    id: randomUUID(), connection_id: connection.id, provider: connection.provider,
    status: options?.dryRun ? 'dry_run' : 'running', import_type: importType, started_at: now,
    warnings: [], errors: [], metadata: safeMetadata(options?.metadata), created_at: now, updated_at: now,
  }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось начать импорт.');
  await supabase.from('booking_channel_manager_connections').update({ last_import_at: now, updated_at: now }).eq('id', connection.id);
  return mapRun(data as Record<string, unknown>);
}

export async function completeChannelImportRun(importRunId: string, result: { objects?: number; bookings?: number; calendarDays?: number; prices?: number; warnings?: unknown[]; safeSummary?: string; dryRun?: boolean }, metadata?: Record<string, unknown>): Promise<ChannelImportRun> {
  const id = assertUuid(importRunId, 'ID запуска');
  assertNoSecrets(result);
  const now = new Date().toISOString();
  const warnings = result.warnings ?? [];
  const { data, error } = await supabase.from('booking_channel_import_runs').update({
    status: result.dryRun ? 'dry_run' : warnings.length ? 'completed_with_warnings' : 'completed', finished_at: now,
    imported_objects_count: result.objects ?? 0, imported_bookings_count: result.bookings ?? 0,
    imported_calendar_days_count: result.calendarDays ?? 0, imported_prices_count: result.prices ?? 0,
    warnings, safe_summary: nullableText(result.safeSummary), metadata: safeMetadata(metadata), updated_at: now,
  }).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось завершить импорт.');
  await supabase.from('booking_channel_manager_connections').update({ status: 'import_ready', last_success_at: now, failure_reason: null, updated_at: now }).eq('id', data.connection_id);
  return mapRun(data as Record<string, unknown>);
}

export async function failChannelImportRun(importRunId: string, reason: string, metadata?: Record<string, unknown>): Promise<ChannelImportRun> {
  const id = assertUuid(importRunId, 'ID запуска');
  assertNoSecrets(reason);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_import_runs').update({
    status: 'failed', finished_at: now, errors: [text(reason).slice(0, 500)], safe_summary: 'Импорт не завершён.',
    metadata: safeMetadata(metadata), updated_at: now,
  }).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось отметить ошибку импорта.');
  await supabase.from('booking_channel_manager_connections').update({ status: 'import_failed', last_failure_at: now, failure_reason: text(reason).slice(0, 500), updated_at: now }).eq('id', data.connection_id);
  return mapRun(data as Record<string, unknown>);
}

export async function importChannelObjects(connectionId: string, objects: Array<Record<string, unknown>>, options?: { importRunId?: string }): Promise<number> {
  const connection = await getConnection(connectionId);
  if (!Array.isArray(objects) || objects.length > MAX_SNAPSHOT_ROWS) throw new Error('Слишком много объектов в одном импорте.');
  assertNoSecrets(objects);
  const now = new Date().toISOString();
  const { data: existingRows } = await supabase.from('booking_channel_imported_objects').select('*').eq('connection_id', connection.id);
  const existingByExternalId = new Map(((existingRows ?? []) as Record<string, unknown>[]).map((row) => [text(row.external_object_id), row]));
  const rows = objects.map((item) => {
    const externalId = text(item.external_object_id ?? item.externalObjectId ?? item.id);
    if (!externalId) throw new Error('У каждого объекта должен быть внешний ID.');
    const existing = existingByExternalId.get(externalId);
    return {
      id: existing?.id ?? randomUUID(), connection_id: connection.id, import_run_id: options?.importRunId ?? null, provider: connection.provider,
      external_object_id: externalId, external_listing_id: nullableText(item.external_listing_id ?? item.externalListingId),
      matched_property_setup_id: existing?.matched_property_setup_id ?? null, matched_property_id: existing?.matched_property_id ?? null,
      match_status: existing?.match_status ?? 'unmatched',
      title: nullableText(item.title ?? item.name), city: nullableText(item.city),
      safe_address_summary: nullableText(item.safe_address_summary ?? item.safeAddressSummary ?? item.address),
      capacity: numberOrNull(item.capacity ?? item.guest_capacity), status: ['active', 'inactive', 'draft', 'blocked'].includes(text(item.status)) ? text(item.status) : 'unknown',
      raw_snapshot: item, created_at: existing?.created_at ?? now, updated_at: now,
    };
  });
  if (!rows.length) return 0;
  const { error } = await supabase.from('booking_channel_imported_objects').upsert(rows, { onConflict: 'connection_id,external_object_id' });
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function importChannelBookings(connectionId: string, bookings: Array<Record<string, unknown>>, options?: { importRunId?: string }): Promise<number> {
  const connection = await getConnection(connectionId);
  if (!Array.isArray(bookings) || bookings.length > MAX_SNAPSHOT_ROWS) throw new Error('Слишком много броней в одном импорте.');
  assertNoSecrets(bookings);
  const now = new Date().toISOString();
  const { data: existingRows } = await supabase.from('booking_channel_imported_bookings').select('*').eq('connection_id', connection.id);
  const existingByExternalId = new Map(((existingRows ?? []) as Record<string, unknown>[]).map((row) => [text(row.external_booking_id), row]));
  const rows = bookings.map((item) => {
    const externalId = text(item.external_booking_id ?? item.externalBookingId ?? item.id);
    if (!externalId) throw new Error('У каждой брони должен быть внешний ID.');
    const existing = existingByExternalId.get(externalId);
    return {
      id: existing?.id ?? randomUUID(), connection_id: connection.id, import_run_id: options?.importRunId ?? null, provider: connection.provider,
      external_booking_id: externalId, external_object_id: nullableText(item.external_object_id ?? item.externalObjectId),
      matched_booking_id: existing?.matched_booking_id ?? null, matched_property_setup_id: existing?.matched_property_setup_id ?? null,
      guest_safe_name: nullableText(item.guest_safe_name ?? item.guestName),
      guest_contact_ref: nullableText(item.guest_contact_ref ?? item.guestContactRef), checkin_date: normalizeDate(item.checkin_date ?? item.checkIn),
      checkout_date: normalizeDate(item.checkout_date ?? item.checkOut), guest_count: numberOrNull(item.guest_count ?? item.guestCount),
      status: ['new', 'confirmed', 'cancelled', 'modified'].includes(text(item.status)) ? text(item.status) : 'unknown',
      match_status: existing?.match_status ?? 'unmatched', raw_snapshot: item, created_at: existing?.created_at ?? now, updated_at: now,
    };
  });
  if (!rows.length) return 0;
  const { error } = await supabase.from('booking_channel_imported_bookings').upsert(rows, { onConflict: 'connection_id,external_booking_id' });
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function importChannelCalendar(connectionId: string, calendarRows: Array<Record<string, unknown>>, options?: { importRunId?: string; pricing?: boolean }): Promise<number> {
  const connection = await getConnection(connectionId);
  if (!Array.isArray(calendarRows) || calendarRows.length > MAX_SNAPSHOT_ROWS) throw new Error('Слишком много строк календаря в одном импорте.');
  assertNoSecrets(calendarRows);
  const now = new Date().toISOString();
  const rows = await Promise.all(calendarRows.map(async (item) => {
    const objectId = text(item.external_object_id ?? item.externalObjectId ?? item.object_id);
    const date = normalizeDate(item.date);
    if (!objectId || !date) throw new Error('Для календаря нужны внешний ID объекта и дата.');
    const { data: existing } = await supabase.from('booking_channel_calendar_snapshots').select('*').eq('connection_id', connection.id).eq('external_object_id', objectId).eq('date', date).maybeSingle();
    const availability = text(item.availability_status ?? item.availability);
    return {
      id: existing?.id ?? randomUUID(), connection_id: connection.id, import_run_id: options?.importRunId ?? null, provider: connection.provider,
      external_object_id: objectId, date,
      availability_status: ['available', 'blocked', 'booked'].includes(availability) ? availability : existing?.availability_status ?? 'unknown',
      min_stay: numberOrNull(item.min_stay ?? item.minStay) ?? existing?.min_stay ?? null,
      price_amount: numberOrNull(item.price_amount ?? item.price) ?? existing?.price_amount ?? null,
      currency: nullableText(item.currency) ?? existing?.currency ?? null,
      raw_snapshot: { ...((existing?.raw_snapshot as Record<string, unknown>) ?? {}), ...item, snapshot_kind: options?.pricing ? 'pricing' : 'calendar' },
      created_at: existing?.created_at ?? now, updated_at: now,
    };
  }));
  if (!rows.length) return 0;
  const { error } = await supabase.from('booking_channel_calendar_snapshots').upsert(rows, { onConflict: 'connection_id,external_object_id,date' });
  if (error) throw new Error(error.message);
  return rows.length;
}

function validateSnapshot(snapshot: ManualChannelSnapshot): Required<ManualChannelSnapshot> {
  assertNoSecrets(snapshot);
  const size = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  if (size > MAX_SNAPSHOT_BYTES) throw new Error('Снимок слишком большой. Максимальный размер — 1 МБ.');
  const normalized = {
    objects: Array.isArray(snapshot.objects) ? snapshot.objects : [], bookings: Array.isArray(snapshot.bookings) ? snapshot.bookings : [],
    calendar: Array.isArray(snapshot.calendar) ? snapshot.calendar : [], pricing: Array.isArray(snapshot.pricing) ? snapshot.pricing : [],
  };
  if (Object.values(normalized).some((rows) => rows.length > MAX_SNAPSHOT_ROWS)) throw new Error('В одном разделе снимка должно быть не более 500 строк.');
  return normalized;
}

export async function registerManualChannelSnapshot(connectionId: string, snapshot: ManualChannelSnapshot, metadata?: Record<string, unknown>): Promise<{ run: ChannelImportRun; summary: Record<string, number>; conflicts: ChannelImportConflict[] }> {
  const connection = await getConnection(connectionId);
  if (connection.provider !== 'manual' && !CHANNEL_PROVIDER_ADAPTERS[connection.provider].supports_real_api) {
    // A provider-labelled connection may still use the honest manual fallback.
  }
  const normalized = validateSnapshot(snapshot);
  const run = await startChannelImportRun(connection.id, 'manual_snapshot', { metadata: safeMetadata(metadata) });
  try {
    const objects = await importChannelObjects(connection.id, normalized.objects, { importRunId: run.id });
    const bookings = await importChannelBookings(connection.id, normalized.bookings, { importRunId: run.id });
    const calendar = await importChannelCalendar(connection.id, normalized.calendar, { importRunId: run.id });
    const prices = await importChannelCalendar(connection.id, normalized.pricing, { importRunId: run.id, pricing: true });
    await reconcileImportedObjects(connection.id);
    await reconcileImportedBookings(connection.id);
    const availabilityChecks = await auditChannelImportAvailability(connection.id);
    const conflicts = await getChannelImportConflicts(connection.id);
    for (const check of availabilityChecks) {
      if (check.status === 'no_conflict') continue;
      conflicts.push({
        type: 'availability_conflict',
        severity: check.status === 'confirmed_conflict' ? 'blocker' : 'warning',
        message: check.safeSummary,
      });
    }
    const completed = await completeChannelImportRun(run.id, {
      objects, bookings, calendarDays: calendar, prices, warnings: conflicts,
      safeSummary: `Импортировано: объектов ${objects}, броней ${bookings}, строк календаря ${calendar}, цен ${prices}.`,
    });
    await queueChannelManagerCommunication(connection, conflicts.length ? 'channel_import_needs_review_notice' : 'channel_import_completed_notice',
      conflicts.length ? `Импорт менеджера каналов завершён. Нужна проверка: ${conflicts.length} несоответствий.` : 'Импорт менеджера каналов завершён без найденных несоответствий.');
    return { run: completed, summary: { objects, bookings, calendar, prices }, conflicts };
  } catch (error) {
    await failChannelImportRun(run.id, error instanceof Error ? error.message : 'Ошибка ручного импорта.');
    throw error;
  }
}

export async function reconcileImportedObjects(connectionId: string): Promise<{ matched: number; possible: number; unmatched: number }> {
  const connection = await getConnection(connectionId);
  const [{ data: objects, error: objectsError }, { data: setups, error: setupsError }] = await Promise.all([
    supabase.from('booking_channel_imported_objects').select('*').eq('connection_id', connection.id).neq('match_status', 'ignored'),
    supabase.from('booking_property_setup_profiles').select('*'),
  ]);
  if (objectsError || setupsError) throw new Error(objectsError?.message ?? setupsError?.message ?? 'Не удалось сверить объекты.');
  let matched = 0; let possible = 0; let unmatched = 0;
  for (const object of (objects ?? []) as Record<string, unknown>[]) {
    const raw = (object.raw_snapshot as Record<string, unknown>) ?? {};
    const requestedSetupId = nullableText(raw.property_setup_id ?? raw.propertySetupId);
    const exact = requestedSetupId ? (setups ?? []).find((setup) => setup.id === requestedSetupId) : null;
    const title = text(object.title).toLowerCase(); const city = text(object.city).toLowerCase(); const capacity = numberOrNull(object.capacity);
    const candidates = (setups ?? []).filter((setup) => text(setup.title).toLowerCase() === title && text(setup.address_city).toLowerCase() === city);
    const high = exact ?? candidates.find((setup) => capacity !== null && Number(setup.guest_capacity) === capacity);
    const tentative = !high && candidates.length === 1 ? candidates[0] : null;
    const status = high ? 'matched' : tentative ? 'possible_match' : 'unmatched';
    if (status === 'matched') matched += 1; else if (status === 'possible_match') possible += 1; else unmatched += 1;
    await supabase.from('booking_channel_imported_objects').update({
      match_status: status, matched_property_setup_id: high?.id ?? tentative?.id ?? null,
      matched_property_id: high?.property_id ?? tentative?.property_id ?? null, updated_at: new Date().toISOString(),
    }).eq('id', object.id);
  }
  return { matched, possible, unmatched };
}

export async function reconcileImportedBookings(connectionId: string): Promise<{ matched: number; possibleDuplicates: number; unmatched: number }> {
  const connection = await getConnection(connectionId);
  const { data: bookings, error } = await supabase.from('booking_channel_imported_bookings').select('*').eq('connection_id', connection.id).neq('match_status', 'ignored');
  if (error) throw new Error(error.message);
  let matched = 0; let possibleDuplicates = 0; let unmatched = 0;
  for (const booking of (bookings ?? []) as Record<string, unknown>[]) {
    if (booking.matched_booking_id) { matched += 1; continue; }
    const { data: byReference } = await supabase.from('booking_ops_records').select('id').eq('booking_id', text(booking.external_booking_id)).limit(1).maybeSingle();
    let status = byReference ? 'matched' : 'unmatched'; let bookingId = byReference?.id ?? null;
    if (!byReference && booking.checkin_date && booking.checkout_date) {
      const { data: importedObject } = booking.external_object_id
        ? await supabase.from('booking_channel_imported_objects').select('matched_property_id').eq('connection_id', connection.id).eq('external_object_id', booking.external_object_id).maybeSingle()
        : { data: null };
      let overlapQuery = supabase.from('booking_ops_records').select('id').gte('check_in_at', `${booking.checkin_date}T00:00:00.000Z`).lte('check_in_at', `${booking.checkin_date}T23:59:59.999Z`).gte('check_out_at', `${booking.checkout_date}T00:00:00.000Z`).lte('check_out_at', `${booking.checkout_date}T23:59:59.999Z`);
      if (importedObject?.matched_property_id) overlapQuery = overlapQuery.eq('property_id', importedObject.matched_property_id);
      if (booking.guest_safe_name) overlapQuery = overlapQuery.eq('guest_name', booking.guest_safe_name);
      const { data: overlap } = await overlapQuery.limit(2);
      if ((overlap ?? []).length) { status = 'possible_duplicate'; bookingId = overlap?.[0]?.id ?? null; }
    }
    if (status === 'matched') matched += 1; else if (status === 'possible_duplicate') possibleDuplicates += 1; else unmatched += 1;
    await supabase.from('booking_channel_imported_bookings').update({ match_status: status, matched_booking_id: bookingId, updated_at: new Date().toISOString() }).eq('id', booking.id);
  }
  return { matched, possibleDuplicates, unmatched };
}

export type ChannelImportConflict = { type: string; severity: 'warning' | 'blocker'; entityId?: string; message: string };

export async function getChannelImportConflicts(connectionId: string): Promise<ChannelImportConflict[]> {
  const connection = await getConnection(connectionId);
  const [{ data: objects }, { data: bookings }, { data: calendar }] = await Promise.all([
    supabase.from('booking_channel_imported_objects').select('id,match_status').eq('connection_id', connection.id),
    supabase.from('booking_channel_imported_bookings').select('id,match_status,matched_booking_id').eq('connection_id', connection.id),
    supabase.from('booking_channel_calendar_snapshots').select('id,external_object_id,date,price_amount,availability_status').eq('connection_id', connection.id),
  ]);
  const conflicts: ChannelImportConflict[] = [];
  for (const item of objects ?? []) if (item.match_status === 'unmatched' || item.match_status === 'possible_match') conflicts.push({ type: 'object_not_confirmed', severity: 'warning', entityId: item.id, message: 'Объект импорта не сопоставлен однозначно.' });
  for (const item of bookings ?? []) if (item.match_status === 'unmatched' || item.match_status === 'possible_duplicate') conflicts.push({ type: item.match_status === 'possible_duplicate' ? 'possible_duplicate_booking' : 'booking_missing_in_asi', severity: 'warning', entityId: item.id, message: item.match_status === 'possible_duplicate' ? 'Возможен дубликат брони.' : 'Бронь есть в импорте, но ещё не создана в ASI.' });
  for (const item of calendar ?? []) if (item.price_amount === null) conflicts.push({ type: 'price_missing', severity: 'warning', entityId: item.id, message: 'Для даты не указана цена.' });
  const confirmedBookings = ((bookings ?? []) as Record<string, unknown>[]).filter((item) => ['unmatched', 'matched', 'imported_to_booking_ops'].includes(text(item.match_status)));
  const { data: importedBookingRows } = await supabase.from('booking_channel_imported_bookings').select('id,external_object_id,checkin_date,status,matched_booking_id').eq('connection_id', connection.id);
  for (const booking of importedBookingRows ?? []) {
    const availableDay = (calendar ?? []).find((day) => day.availability_status === 'available' && day.date === booking.checkin_date && day.external_object_id === booking.external_object_id);
    if (booking.status !== 'cancelled' && availableDay) conflicts.push({ type: 'availability_mismatch', severity: 'warning', entityId: booking.id, message: 'На дату существующей брони календарь показывает доступность.' });
  }
  if (!objects?.length) conflicts.push({ type: 'setup_object_not_present_in_cm', severity: 'warning', message: 'В импорте нет объектов для сверки.' });
  if (connection.propertySetupId) {
    const { data: setup } = await supabase.from('booking_property_setup_profiles').select('property_id').eq('id', connection.propertySetupId).maybeSingle();
    if (setup?.property_id) {
      const { data: asiBookings } = await supabase.from('booking_ops_records').select('id').eq('property_id', setup.property_id);
      const importedIds = new Set(confirmedBookings.map((item) => text(item.matched_booking_id)).filter(Boolean));
      for (const booking of asiBookings ?? []) if (!importedIds.has(text(booking.id))) conflicts.push({ type: 'booking_missing_in_cm', severity: 'warning', entityId: booking.id, message: 'Бронь есть в ASI, но отсутствует в снимке менеджера каналов.' });
    }
  }
  return conflicts;
}

export async function getChannelImportReadiness(propertySetupId: string): Promise<Record<string, unknown>> {
  const connection = await getChannelManagerConnectionStatus({ propertySetupId });
  if (!connection) return { ready: false, status: 'not_initialized', blockers: ['Подключение не создано.'], conflicts: [] };
  const [conflicts, { count: objects }, { count: bookings }, { count: calendar }] = await Promise.all([
    getChannelImportConflicts(connection.id),
    supabase.from('booking_channel_imported_objects').select('id', { count: 'exact', head: true }).eq('connection_id', connection.id),
    supabase.from('booking_channel_imported_bookings').select('id', { count: 'exact', head: true }).eq('connection_id', connection.id),
    supabase.from('booking_channel_calendar_snapshots').select('id', { count: 'exact', head: true }).eq('connection_id', connection.id),
  ]);
  const blockers = await getChannelManagerBlockers(connection.id);
  return { ready: blockers.length === 0, status: connection.status, accessStatus: connection.accessStatus, objects: objects ?? 0, bookings: bookings ?? 0, calendar: calendar ?? 0, conflicts, blockers, nextAction: blockers[0] ?? (conflicts.length ? 'Проверить расхождения.' : 'Импорт готов к передаче в следующий этап.') };
}

export async function getChannelManagerBlockers(propertySetupIdOrConnectionId: string): Promise<string[]> {
  const id = assertUuid(propertySetupIdOrConnectionId);
  let connection = await getChannelManagerConnectionStatus({ connectionId: id });
  if (!connection) connection = await getChannelManagerConnectionStatus({ propertySetupId: id });
  if (!connection) return ['Подключение не создано.'];
  const blockers: string[] = [];
  if (!['received'].includes(connection.accessStatus) && connection.provider !== 'manual') blockers.push('Безопасная ссылка на доступ не подтверждена.');
  if (connection.status === 'blocked' || connection.accessStatus === 'invalid') blockers.push('Подключение заблокировано или доступ недействителен.');
  if (!connection.lastSuccessAt) blockers.push('Успешный импорт ещё не выполнен.');
  return blockers;
}

export async function createBookingFromImportedChannelBooking(importedBookingId: string, options?: { force?: boolean }): Promise<Record<string, unknown>> {
  const id = assertUuid(importedBookingId, 'ID импортированной брони');
  const { data: imported, error } = await supabase.from('booking_channel_imported_bookings').select('*').eq('id', id).maybeSingle();
  if (error || !imported) throw new Error('Импортированная бронь не найдена.');
  if (imported.matched_booking_id && !options?.force) return { created: false, duplicate: true, bookingId: imported.matched_booking_id };
  const { data: object } = imported.external_object_id
    ? await supabase.from('booking_channel_imported_objects').select('*').eq('connection_id', imported.connection_id).eq('external_object_id', imported.external_object_id).maybeSingle()
    : { data: null };
  const result = await processInboundBookingRequest({
    guestName: imported.guest_safe_name, checkInAt: imported.checkin_date, checkOutAt: imported.checkout_date,
    guestCount: imported.guest_count, propertyId: object?.matched_property_id ?? null, propertyLabel: object?.title ?? null,
    bookingReference: imported.external_booking_id, externalSourceId: imported.external_booking_id,
    metadata: { channelImport: true, importedBookingId: imported.id, provider: imported.provider },
  }, 'channel_manager_placeholder');
  if (!result.bookingId) throw new Error('Booking Ops не создал бронь: нужна проверка данных.');
  await supabase.from('booking_channel_imported_bookings').update({ matched_booking_id: result.bookingId, match_status: 'imported_to_booking_ops', matched_property_setup_id: object?.matched_property_setup_id ?? null, updated_at: new Date().toISOString() }).eq('id', id);
  return { created: result.intakeStatus !== 'duplicate', duplicate: result.intakeStatus === 'duplicate', bookingId: result.bookingId, intake: result };
}

export async function listChannelImportRuns(connectionId?: string): Promise<ChannelImportRun[]> {
  let query = supabase.from('booking_channel_import_runs').select('*').order('created_at', { ascending: false });
  if (connectionId) query = query.eq('connection_id', assertUuid(connectionId, 'ID подключения'));
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapRun);
}

export async function listImportedChannelObjects(connectionId?: string): Promise<Record<string, unknown>[]> {
  let query = supabase.from('booking_channel_imported_objects').select('*').order('updated_at', { ascending: false });
  if (connectionId) query = query.eq('connection_id', assertUuid(connectionId, 'ID подключения'));
  const { data, error } = await query.limit(200); if (error) throw new Error(error.message); return (data ?? []) as Record<string, unknown>[];
}

export async function listImportedChannelBookings(connectionId?: string): Promise<Record<string, unknown>[]> {
  let query = supabase.from('booking_channel_imported_bookings').select('*').order('updated_at', { ascending: false });
  if (connectionId) query = query.eq('connection_id', assertUuid(connectionId, 'ID подключения'));
  const { data, error } = await query.limit(200); if (error) throw new Error(error.message); return (data ?? []) as Record<string, unknown>[];
}

export async function listChannelCalendarSnapshots(connectionId?: string): Promise<Record<string, unknown>[]> {
  let query = supabase.from('booking_channel_calendar_snapshots').select('*').order('date', { ascending: false });
  if (connectionId) query = query.eq('connection_id', assertUuid(connectionId, 'ID подключения'));
  const { data, error } = await query.limit(500); if (error) throw new Error(error.message); return (data ?? []) as Record<string, unknown>[];
}

export async function updateChannelImportEntity(table: 'booking_channel_imported_objects' | 'booking_channel_imported_bookings', id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', assertUuid(id));
  if (error) throw new Error(error.message);
}

export async function blockChannelManagerConnection(connectionId: string, reason: string): Promise<ChannelManagerConnection> {
  const connection = await getConnection(connectionId); assertNoSecrets(reason);
  const { data, error } = await supabase.from('booking_channel_manager_connections').update({ status: 'blocked', access_status: 'blocked', failure_reason: text(reason).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', connection.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось заблокировать подключение.'); return mapConnection(data as Record<string, unknown>);
}

export async function addChannelManagerNote(connectionId: string, note: string): Promise<ChannelManagerConnection> {
  const connection = await getConnection(connectionId); assertNoSecrets(note);
  const notes = Array.isArray(connection.metadata.notes) ? connection.metadata.notes : [];
  const { data, error } = await supabase.from('booking_channel_manager_connections').update({ metadata: { ...connection.metadata, notes: [...notes, { text: text(note).slice(0, 1000), createdAt: new Date().toISOString() }] }, updated_at: new Date().toISOString() }).eq('id', connection.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось добавить заметку.'); return mapConnection(data as Record<string, unknown>);
}

export type ChannelManagerProviderOnboardingAction =
  | 'select_provider' | 'request_account_creation' | 'mark_account_created' | 'request_access'
  | 'mark_access_received' | 'mark_operator_review' | 'mark_import_ready' | 'upload_manual_snapshot'
  | 'run_reconciliation' | 'mark_pilot_activation_pending' | 'mark_connected_placeholder'
  | 'block_connection' | 'add_note';

export type ChannelManagerProviderOnboardingResult = {
  connection: ChannelManagerConnection;
  importSummary?: Record<string, number>;
  conflicts?: ChannelImportConflict[];
};

async function updateProviderOnboardingStatus(
  connectionId: string,
  status: ChannelManagerOnboardingStatus,
  metadata?: Record<string, unknown>,
): Promise<ChannelManagerConnection> {
  const connection = await getConnection(connectionId);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_channel_manager_connections').update({
    status,
    metadata: { ...connection.metadata, ...safeMetadata(metadata), realApiSyncEnabled: false },
    failure_reason: status === 'blocked' ? connection.failureReason : null,
    updated_at: now,
  }).eq('id', connection.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить этап подключения.');
  return mapConnection(data as Record<string, unknown>);
}

export async function performChannelManagerProviderOnboardingAction(input: {
  action: ChannelManagerProviderOnboardingAction;
  propertySetupId?: string;
  connectionId?: string;
  provider?: ChannelManagerProvider;
  safeAccessRef?: string | null;
  snapshot?: ManualChannelSnapshot;
  note?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<ChannelManagerProviderOnboardingResult> {
  assertNoSecrets(input.metadata);
  const provider = input.provider === undefined ? undefined : parseChannelManagerProvider(input.provider);
  let connection: ChannelManagerConnection;

  if (input.action === 'select_provider') {
    if (!provider) throw new Error('Выберите провайдера.');
    connection = await initializeChannelManagerConnection(input.propertySetupId ?? '', provider, input.metadata);
    connection = await updateProviderOnboardingStatus(connection.id, 'provider_selected', { selectedAt: new Date().toISOString() });
    await queueChannelManagerCommunication(connection, 'channel_provider_selected_notice', `Выбран менеджер каналов ${provider}. API-синхронизация пока не активна; доступен контролируемый этап подготовки.`);
    return { connection };
  }

  connection = await getConnection(input.connectionId ?? '');
  if (input.action === 'request_account_creation') {
    connection = await updateProviderOnboardingStatus(connection.id, 'account_required', { accountCreationRequestedAt: new Date().toISOString() });
    await queueChannelManagerCommunication(connection, 'internal_status_notice', 'Для продолжения нужен аккаунт выбранного менеджера каналов.');
  } else if (input.action === 'mark_account_created') {
    connection = await updateProviderOnboardingStatus(connection.id, 'provider_selected', { accountCreatedAt: new Date().toISOString() });
  } else if (input.action === 'request_access') {
    if (!connection.propertySetupId) throw new Error('У подключения не указан профиль объекта.');
    connection = await requestChannelManagerAccess(connection.propertySetupId, connection.provider, input.metadata);
    connection = await updateProviderOnboardingStatus(connection.id, 'access_requested');
  } else if (input.action === 'mark_access_received') {
    if (!input.safeAccessRef) throw new Error('Укажите безопасную ссылку на доступ. Пароль или API-токен сюда вставлять нельзя.');
    connection = await markChannelManagerAccessReceived(connection.id, input.safeAccessRef, input.metadata);
    connection = await updateProviderOnboardingStatus(connection.id, 'access_received', { accessReceivedSafelyAt: new Date().toISOString() });
  } else if (input.action === 'mark_operator_review') {
    connection = await updateProviderOnboardingStatus(connection.id, 'operator_review', { operatorReviewAt: new Date().toISOString() });
    await queueChannelManagerCommunication(connection, 'internal_status_notice', 'Подключение передано оператору на проверку.');
  } else if (input.action === 'mark_import_ready') {
    connection = await updateProviderOnboardingStatus(connection.id, 'import_ready');
    await queueChannelManagerCommunication(connection, 'channel_snapshot_upload_request', 'Можно загрузить безопасный snapshot объектов, броней, календаря и цен.');
  } else if (input.action === 'upload_manual_snapshot') {
    const result = await registerManualChannelSnapshot(connection.id, input.snapshot ?? {}, input.metadata);
    connection = await updateProviderOnboardingStatus(connection.id, 'manual_snapshot_available', { snapshotImportedAt: new Date().toISOString() });
    return { connection, importSummary: result.summary, conflicts: result.conflicts };
  } else if (input.action === 'run_reconciliation') {
    await reconcileImportedObjects(connection.id);
    await reconcileImportedBookings(connection.id);
    const conflicts = await getChannelImportConflicts(connection.id);
    connection = await updateProviderOnboardingStatus(connection.id, 'import_ready', { reconciledAt: new Date().toISOString(), conflictCount: conflicts.length });
    return { connection, conflicts };
  } else if (input.action === 'mark_pilot_activation_pending') {
    connection = await updateProviderOnboardingStatus(connection.id, 'pilot_activation_pending');
    await queueChannelManagerCommunication(connection, 'channel_pilot_activation_pending_notice', 'Подготовка завершена. API-синхронизация будет включена отдельно после настройки провайдера оператором.');
  } else if (input.action === 'mark_connected_placeholder') {
    connection = await updateProviderOnboardingStatus(connection.id, 'connected_placeholder', { onboardingCompletedAt: new Date().toISOString() });
  } else if (input.action === 'block_connection') {
    connection = await blockChannelManagerConnection(connection.id, input.reason ?? 'Заблокировано оператором.');
  } else if (input.action === 'add_note') {
    connection = await addChannelManagerNote(connection.id, input.note ?? '');
  } else {
    throw new Error('Недопустимое действие.');
  }
  return { connection };
}
