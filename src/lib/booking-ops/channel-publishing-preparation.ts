import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { attachAutoSendDecisionMetadata, canAutoSendCommunicationIntent } from './communication-auto-send-policy';
import { findSecretPath, type ChannelManagerProvider } from './channel-manager-access-import';
import { buildPricingSnapshotForPublicationPackage, getPricingReadiness } from './pricing-intelligence-autopilot';

export const PUBLICATION_PROVIDERS = ['manual', 'bnovo', 'realtycalendar', 'travelline', 'other'] as const;
export const PUBLICATION_PACKAGE_STATUSES = ['draft', 'incomplete', 'ready_for_review', 'ready_for_publication', 'publication_pending', 'published_placeholder', 'blocked'] as const;
export const PUBLICATION_CHANNEL_KEYS = ['ostrovok', 'yandex_travel', 'avito_travel', 'sutochno', 'cian', '101hotels', 'bronevik', 'kvartirka', 'ozon_travel', 'mts_travel', 'onetwotrip', 'twil', 'otello', 'other'] as const;
export const PUBLICATION_CHANNEL_STATUSES = ['not_selected', 'selected', 'ready', 'missing_data', 'publication_pending', 'published_placeholder', 'blocked'] as const;
export const PUBLICATION_NOTICE_TYPES = ['publication_package_ready_notice', 'publication_missing_data_request', 'channel_selection_needed_notice', 'publication_pending_notice', 'internal_status_notice'] as const;

export type PublicationProvider = (typeof PUBLICATION_PROVIDERS)[number];
export type PublicationPackageStatus = (typeof PUBLICATION_PACKAGE_STATUSES)[number];
export type PublicationChannelKey = (typeof PUBLICATION_CHANNEL_KEYS)[number];
export type PublicationChannelStatus = (typeof PUBLICATION_CHANNEL_STATUSES)[number];
export type PublicationCheckStatus = 'pass' | 'warning' | 'fail' | 'skipped';

export type PublicationChannel = {
  id: string; packageId: string; channelKey: PublicationChannelKey; selected: boolean;
  status: PublicationChannelStatus; missingFields: string[]; metadata: Record<string, unknown>;
  createdAt: string; updatedAt: string;
};

export type PublicationCheck = {
  id: string; packageId: string; checkKey: string; status: PublicationCheckStatus;
  message: string; metadata: Record<string, unknown>; createdAt: string; updatedAt: string;
};

export type PublicationPackage = {
  id: string; propertySetupId: string | null; propertyId: string | null; connectionId: string | null;
  provider: PublicationProvider; status: PublicationPackageStatus; readinessScore: number;
  missingFields: string[]; warnings: string[]; safeSummary: string | null;
  packagePayload: Record<string, unknown>; metadata: Record<string, unknown>;
  channels: PublicationChannel[]; checks: PublicationCheck[]; nextAction: string;
  createdAt: string; updatedAt: string; realOtaPublishingEnabled: false;
};

type Row = Record<string, unknown>;
type CheckDraft = { checkKey: string; status: PublicationCheckStatus; message: string; metadata?: Record<string, unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_KEY_RE = /(?:wifi.*pass|password|passwd|парол|door.*code|lockbox|intercom|access.*code|код.*(?:двер|домоф|доступ)|token|токен|api[_-]?key|secret|credential|passport|document|guest|payment)/iu;
const FORBIDDEN_VALUE_RE = /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:password|пароль|token|api[_-]?key|secret|код\s+(?:двери|домофона|доступа))\s*[:=]\s*\S+)/iu;

function text(value: unknown): string { return String(value ?? '').trim(); }
function nullableText(value: unknown): string | null { return text(value) || null; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function assertPublicationUuid(value: unknown, label = 'ID'): string {
  const id = text(value);
  if (!UUID_RE.test(id)) throw new Error(`${label} указан неверно.`);
  return id;
}

export function parsePublicationProvider(value: unknown): PublicationProvider {
  const provider = text(value).toLowerCase();
  if (!(PUBLICATION_PROVIDERS as readonly string[]).includes(provider)) throw new Error('Выберите поддерживаемого провайдера.');
  return provider as PublicationProvider;
}

export function parsePublicationChannelKeys(value: unknown): PublicationChannelKey[] {
  if (!Array.isArray(value)) throw new Error('Передайте список каналов.');
  const keys = [...new Set(value.map((item) => text(item).toLowerCase()).filter(Boolean))];
  const invalid = keys.find((key) => !(PUBLICATION_CHANNEL_KEYS as readonly string[]).includes(key));
  if (invalid) throw new Error(`Канал ${invalid} не поддерживается.`);
  return keys as PublicationChannelKey[];
}

export function findUnsafePublicationPath(value: unknown, path = 'payload'): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) { const found = findUnsafePublicationPath(value[i], `${path}[${i}]`); if (found) return found; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_RE.test(key)) return `${path}.${key}`;
      const found = findUnsafePublicationPath(child, `${path}.${key}`); if (found) return found;
    }
    return null;
  }
  return typeof value === 'string' && FORBIDDEN_VALUE_RE.test(value) ? path : null;
}

export function assertSafePublicationInput(value: unknown): void {
  if (findSecretPath(value) || findUnsafePublicationPath(value)) {
    throw new Error('Пакет публикации не может содержать пароли, коды доступа, данные гостей или платёжные секреты.');
  }
}

function safeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  const value = metadata ?? {};
  assertSafePublicationInput(value);
  return value;
}

function mapChannel(row: Row): PublicationChannel {
  return { id: text(row.id), packageId: text(row.package_id), channelKey: text(row.channel_key) as PublicationChannelKey,
    selected: Boolean(row.selected), status: text(row.status) as PublicationChannelStatus, missingFields: strings(row.missing_fields),
    metadata: object(row.metadata), createdAt: text(row.created_at), updatedAt: text(row.updated_at) };
}

function mapCheck(row: Row): PublicationCheck {
  return { id: text(row.id), packageId: text(row.package_id), checkKey: text(row.check_key), status: text(row.status) as PublicationCheckStatus,
    message: text(row.message), metadata: object(row.metadata), createdAt: text(row.created_at), updatedAt: text(row.updated_at) };
}

function nextAction(status: PublicationPackageStatus, missing: string[], selected: number): string {
  if (status === 'blocked') return 'Устранить причину блокировки';
  if (selected === 0) return 'Выбрать каналы публикации';
  if (missing.length) return 'Дополнить данные объекта';
  if (status === 'draft' || status === 'incomplete') return 'Проверить пакет';
  if (status === 'ready_for_review') return 'Проверить и отметить готовность к публикации';
  if (status === 'ready_for_publication') return 'Запустить ручную или пилотную публикацию через выбранный менеджер каналов';
  if (status === 'publication_pending') return 'Дождаться активации провайдера или ручного подтверждения';
  return 'Проверить ручное подтверждение по каждому каналу';
}

async function hydratePackage(row: Row): Promise<PublicationPackage> {
  const [channelsResult, checksResult] = await Promise.all([
    supabase.from('booking_channel_publication_channels').select('*').eq('package_id', text(row.id)).order('channel_key'),
    supabase.from('booking_channel_publication_checks').select('*').eq('package_id', text(row.id)).order('check_key'),
  ]);
  if (channelsResult.error) throw new Error(channelsResult.error.message);
  if (checksResult.error) throw new Error(checksResult.error.message);
  const channels = ((channelsResult.data ?? []) as Row[]).map(mapChannel);
  const checks = ((checksResult.data ?? []) as Row[]).map(mapCheck);
  const missingFields = strings(row.missing_fields);
  const status = text(row.status) as PublicationPackageStatus;
  return { id: text(row.id), propertySetupId: nullableText(row.property_setup_id), propertyId: nullableText(row.property_id),
    connectionId: nullableText(row.connection_id), provider: text(row.provider) as PublicationProvider, status,
    readinessScore: Number(row.readiness_score ?? 0), missingFields, warnings: strings(row.warnings),
    safeSummary: nullableText(row.safe_summary), packagePayload: object(row.package_payload), metadata: object(row.metadata),
    channels, checks, nextAction: nextAction(status, missingFields, channels.filter((item) => item.selected).length),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at), realOtaPublishingEnabled: false };
}

async function getPackage(packageId: string): Promise<PublicationPackage> {
  const id = assertPublicationUuid(packageId, 'ID пакета');
  const { data, error } = await supabase.from('booking_channel_publication_packages').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'Пакет публикации не найден.');
  return hydratePackage(data as Row);
}

async function getPropertySetup(propertySetupId: string): Promise<Row> {
  const id = assertPublicationUuid(propertySetupId, 'ID профиля объекта');
  const { data, error } = await supabase.from('booking_property_setup_profiles').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'Профиль объекта не найден.');
  return data as Row;
}

async function queuePublicationIntent(pkg: PublicationPackage, messageType: typeof PUBLICATION_NOTICE_TYPES[number], messageText: string, metadata?: Record<string, unknown>): Promise<string | null> {
  if (!pkg.propertySetupId) return null;
  const { data: setup } = await supabase.from('booking_property_setup_profiles').select('owner_setup_id,property_id').eq('id', pkg.propertySetupId).maybeSingle();
  const ownerSetupId = nullableText(setup?.owner_setup_id);
  if (!ownerSetupId) return null;
  const decision = await canAutoSendCommunicationIntent({ actorType: 'owner', purpose: 'internal_status_notice', channel: 'manual', messageText,
    metadata: { messageType, channelPublishingPreparation: true } }, { ownerId: null, propertyId: nullableText(setup?.property_id) });
  const id = randomUUID(); const now = new Date().toISOString();
  const intentMetadata = attachAutoSendDecisionMetadata({ messageType, packageId: pkg.id, channelPublishingPreparation: true, realOtaPublishingEnabled: false, ...safeMetadata(metadata) }, decision);
  const { error } = await supabase.from('booking_owner_setup_communication_intents').insert({ id, owner_setup_id: ownerSetupId,
    property_setup_id: pkg.propertySetupId, message_type: messageType, channel: 'manual', status: 'draft_ready',
    message_text: messageText, message_template_key: messageType, metadata: intentMetadata, created_at: now, updated_at: now });
  if (error) throw new Error(error.message);
  return id;
}

export async function initializePublicationPackage(propertySetupId: string, provider?: PublicationProvider, metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  const setup = await getPropertySetup(propertySetupId);
  const setupId = text(setup.id);
  let connectionQuery = supabase.from('booking_channel_manager_connections').select('*').eq('property_setup_id', setupId).order('updated_at', { ascending: false }).limit(1);
  if (provider) connectionQuery = connectionQuery.eq('provider', parsePublicationProvider(provider));
  const { data: connectionRows, error: connectionError } = await connectionQuery;
  if (connectionError) throw new Error(connectionError.message);
  const connection = ((connectionRows ?? []) as Row[])[0] ?? null;
  const resolvedProvider = provider ? parsePublicationProvider(provider) : connection ? parsePublicationProvider(connection.provider) : 'manual';
  let existingQuery = supabase.from('booking_channel_publication_packages').select('*').eq('property_setup_id', setupId).eq('provider', resolvedProvider).order('updated_at', { ascending: false }).limit(1);
  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) throw new Error(existingError.message);
  if ((existingRows ?? []).length) return hydratePackage((existingRows as Row[])[0]);
  const now = new Date().toISOString(); const id = randomUUID();
  const { data, error } = await supabase.from('booking_channel_publication_packages').insert({ id, property_setup_id: setupId,
    property_id: nullableText(setup.property_id), connection_id: connection ? text(connection.id) : null, provider: resolvedProvider,
    status: 'draft', readiness_score: 0, missing_fields: [], warnings: [], safe_summary: 'Черновик безопасного пакета публикации.',
    package_payload: {}, metadata: { ...safeMetadata(metadata), real_ota_publishing_enabled: false }, created_at: now, updated_at: now }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать пакет публикации.');
  const channelRows = PUBLICATION_CHANNEL_KEYS.map((channelKey) => ({ id: randomUUID(), package_id: id, channel_key: channelKey,
    selected: false, status: 'not_selected', missing_fields: [], metadata: {}, created_at: now, updated_at: now }));
  const { error: channelError } = await supabase.from('booking_channel_publication_channels').insert(channelRows);
  if (channelError) throw new Error(channelError.message);
  const pkg = await hydratePackage(data as Row);
  await queuePublicationIntent(pkg, 'channel_selection_needed_notice', 'Выберите каналы, в которых нужно подготовить публикацию. API-синхронизация включается отдельно.');
  return pkg;
}

function buildDescription(setup: Row): string | null {
  const metadata = object(setup.metadata);
  const explicit = nullableText(metadata.public_description ?? metadata.description ?? metadata.safe_description);
  if (explicit) return explicit;
  const parts = [nullableText(setup.property_type), nullableText(setup.address_safe_summary ?? setup.address_city),
    setup.guest_capacity ? `до ${Number(setup.guest_capacity)} гостей` : null].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : null;
}

function checksFor(input: { setup: Row; assets: Row[]; connection: Row | null; selectedChannels: PublicationChannel[]; payload: Record<string, unknown>; pricingReadiness?: { readinessScore: number; missingFields: string[]; status: string } }): CheckDraft[] {
  const { setup, assets, connection, selectedChannels, payload, pricingReadiness } = input; const metadata = object(setup.metadata);
  const photos = assets.filter((asset) => text(asset.asset_type) === 'photo' && ['uploaded', 'accepted'].includes(text(asset.status)));
  const description = nullableText(payload.description);
  const accessReady = connection
    ? text(connection.access_status) === 'received' || ['access_received', 'import_ready', 'pilot_activation_pending', 'connected_placeholder'].includes(text(connection.status))
    : false;
  const checks: CheckDraft[] = [
    { checkKey: 'title', status: nullableText(setup.title) ? 'pass' : 'fail', message: nullableText(setup.title) ? 'Название заполнено.' : 'Добавьте название объекта.' },
    { checkKey: 'safe_location', status: nullableText(setup.address_safe_summary ?? setup.address_city) ? 'pass' : 'fail', message: nullableText(setup.address_safe_summary ?? setup.address_city) ? 'Безопасное описание расположения заполнено.' : 'Добавьте город или безопасное описание расположения.' },
    { checkKey: 'property_type', status: nullableText(setup.property_type) ? 'pass' : 'fail', message: nullableText(setup.property_type) ? 'Тип объекта заполнен.' : 'Добавьте тип объекта.' },
    { checkKey: 'capacity', status: Number(setup.guest_capacity ?? 0) > 0 ? 'pass' : 'fail', message: Number(setup.guest_capacity ?? 0) > 0 ? 'Вместимость заполнена.' : 'Добавьте вместимость.' },
    { checkKey: 'photos', status: photos.length >= 3 || ['enough', 'ready'].includes(text(setup.photos_status)) ? 'pass' : 'fail', message: photos.length >= 3 || ['enough', 'ready'].includes(text(setup.photos_status)) ? 'Фотографий достаточно.' : 'Нужно минимум 3 безопасных фото.' , metadata: { safePhotoCount: photos.length } },
    { checkKey: 'description', status: description ? 'pass' : 'fail', message: description ? 'Описание готово.' : 'Добавьте описание или данные для его безопасной генерации.' },
    { checkKey: 'rules', status: text(setup.rules_status) === 'complete' ? 'pass' : 'fail', message: text(setup.rules_status) === 'complete' ? 'Правила подтверждены.' : 'Дополните правила проживания.' },
    { checkKey: 'checkin_checkout', status: nullableText(setup.checkin_time) && nullableText(setup.checkout_time) ? 'pass' : 'fail', message: nullableText(setup.checkin_time) && nullableText(setup.checkout_time) ? 'Время заезда и выезда заполнено.' : 'Добавьте время заезда и выезда.' },
    {
      checkKey: 'pricing',
      status: pricingReadiness && pricingReadiness.readinessScore >= 75 && !pricingReadiness.missingFields.length
        ? 'pass'
        : text(setup.pricing_status) === 'ready' && nullableText(metadata.base_price_label)
          ? 'warning'
          : 'fail',
      message: pricingReadiness?.status === 'recommendations_ready' || pricingReadiness?.status === 'auto_apply_ready' || pricingReadiness?.status === 'auto_apply_enabled'
        ? 'Рекомендации по ценам готовы.'
        : pricingReadiness && pricingReadiness.readinessScore >= 75
          ? 'Профиль ценообразования заполнен.'
          : text(setup.pricing_status) === 'ready' && nullableText(metadata.base_price_label)
            ? 'Базовая цена есть, но профиль ценообразования неполный.'
            : 'Инициализируйте профиль ценообразования и укажите базовую цену.',
      metadata: pricingReadiness ? { pricing_status: pricingReadiness.status, readiness_score: pricingReadiness.readinessScore } : {},
    },
    { checkKey: 'selected_channels', status: selectedChannels.length ? 'pass' : 'fail', message: selectedChannels.length ? 'Каналы выбраны.' : 'Выберите хотя бы один канал.' },
    { checkKey: 'provider_connection', status: connection ? 'pass' : 'fail', message: connection ? 'Провайдер и подключение выбраны.' : 'Выберите провайдера и подключение.' },
    { checkKey: 'channel_manager_access', status: accessReady ? 'pass' : 'fail', message: accessReady ? 'Подготовка доступа подтверждена.' : 'Нужен статус доступа: получен, готов к импорту или ожидает пилотной активации.' },
    { checkKey: 'safe_payload', status: findUnsafePublicationPath(payload) || findSecretPath(payload) ? 'fail' : 'pass', message: findUnsafePublicationPath(payload) || findSecretPath(payload) ? 'В пакете обнаружены закрытые данные.' : 'Закрытые данные в пакет не включены.' },
  ];
  return checks;
}

async function persistValidation(pkg: PublicationPackage, payload: Record<string, unknown>, checks: CheckDraft[]): Promise<PublicationPackage> {
  assertSafePublicationInput(payload);
  const now = new Date().toISOString();
  const checkRows = checks.map((check) => ({ id: randomUUID(), package_id: pkg.id, check_key: check.checkKey, status: check.status,
    message: check.message, metadata: check.metadata ?? {}, created_at: now, updated_at: now }));
  const { error: deleteError } = await supabase.from('booking_channel_publication_checks').delete().eq('package_id', pkg.id);
  if (deleteError) throw new Error(deleteError.message);
  const { error: checkError } = await supabase.from('booking_channel_publication_checks').insert(checkRows);
  if (checkError) throw new Error(checkError.message);
  const failed = checks.filter((check) => check.status === 'fail').map((check) => check.checkKey);
  const warnings = checks.filter((check) => check.status === 'warning').map((check) => check.message);
  const readinessScore = Math.round(checks.filter((check) => check.status === 'pass').length / checks.length * 100);
  const currentState = pkg.status;
  const status: PublicationPackageStatus = currentState === 'blocked' ? 'blocked' : failed.length ? 'incomplete' : currentState === 'ready_for_publication' || currentState === 'publication_pending' || currentState === 'published_placeholder' ? currentState : 'ready_for_review';
  const summary = failed.length ? `Пакет заполнен на ${readinessScore}%. Не хватает: ${failed.join(', ')}.` : 'Пакет публикации готов к проверке. Реальная публикация не выполнялась.';
  const { data, error } = await supabase.from('booking_channel_publication_packages').update({ status, readiness_score: readinessScore,
    missing_fields: failed, warnings, safe_summary: summary, package_payload: payload, updated_at: now }).eq('id', pkg.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось сохранить проверку пакета.');
  const channelStatus = failed.length ? 'missing_data' : 'ready';
  await supabase.from('booking_channel_publication_channels').update({ status: channelStatus, missing_fields: failed, updated_at: now }).eq('package_id', pkg.id).eq('selected', true);
  const updated = await hydratePackage(data as Row);
  if (failed.length) await queuePublicationIntent(updated, 'publication_missing_data_request', `Для подготовки публикации нужно дополнить: ${failed.join(', ')}.`);
  else await queuePublicationIntent(updated, 'publication_package_ready_notice', 'Пакет публикации готов к проверке. Готово к ручной или пилотной публикации через выбранный менеджер каналов.');
  return updated;
}

export async function buildPublicationPackage(propertySetupId: string, options?: { packageId?: string; provider?: PublicationProvider; metadata?: Record<string, unknown> }): Promise<PublicationPackage> {
  const pkg = options?.packageId ? await getPackage(options.packageId) : await initializePublicationPackage(propertySetupId, options?.provider, options?.metadata);
  const setup = await getPropertySetup(pkg.propertySetupId ?? propertySetupId);
  const [assetsResult, connectionResult] = await Promise.all([
    supabase.from('booking_property_assets').select('*').eq('property_setup_id', text(setup.id)),
    pkg.connectionId ? supabase.from('booking_channel_manager_connections').select('*').eq('id', pkg.connectionId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  if (connectionResult.error) throw new Error(connectionResult.error.message);
  const metadata = object(setup.metadata);
  const photos = ((assetsResult.data ?? []) as Row[]).filter((asset) => text(asset.asset_type) === 'photo' && ['uploaded', 'accepted'].includes(text(asset.status)));
  const selectedChannels = pkg.channels.filter((channel) => channel.selected);
  const pricingSnapshot = await buildPricingSnapshotForPublicationPackage(text(setup.id));
  const pricingReadiness = await getPricingReadiness(text(setup.id));
  const pricingLabel = pricingSnapshot.pricing_status === 'recommendations_ready'
    ? 'Рекомендации по ценам готовы'
    : pricingSnapshot.pricing_status === 'auto_apply_ready'
      ? 'Авто-применение готово к пилоту (не live OTA)'
      : pricingSnapshot.pricing_status === 'auto_apply_enabled'
        ? 'Пилотное авто-применение включено (не live OTA)'
        : nullableText(metadata.base_price_label);
  const payload: Record<string, unknown> = {
    title: nullableText(setup.title), location_summary: nullableText(setup.address_safe_summary ?? setup.address_city),
    property_type: nullableText(setup.property_type), capacity: Number(setup.guest_capacity ?? 0) || null,
    room_count: Number(setup.room_count ?? 0) || null, amenities: strings(metadata.amenities),
    description: buildDescription(setup), safe_rules: nullableText(metadata.rules_text ?? metadata.safe_rules) ?? (text(setup.rules_status) === 'complete' ? 'Правила проживания подтверждены владельцем.' : null),
    checkin_time: nullableText(setup.checkin_time), checkout_time: nullableText(setup.checkout_time),
    checkin_description: nullableText(metadata.non_secret_checkin_description ?? metadata.public_checkin_description),
    photos: photos.map((asset) => ({ storage_ref: nullableText(asset.storage_ref), safe_label: nullableText(asset.safe_label) })).filter((asset) => asset.storage_ref || asset.safe_label),
    pricing_summary: pricingLabel,
    pricing_intelligence: pricingSnapshot,
    selected_channels: selectedChannels.map((channel) => channel.channelKey),
    provider_key: pkg.provider, readiness_checks: [], real_ota_publishing_enabled: false,
  };
  assertSafePublicationInput(payload);
  const checks = checksFor({ setup, assets: (assetsResult.data ?? []) as Row[], connection: connectionResult.data as Row | null, selectedChannels, payload, pricingReadiness });
  payload.readiness_checks = checks.map(({ checkKey, status, message }) => ({ check_key: checkKey, status, message }));
  return persistValidation(pkg, payload, checks);
}

export async function validatePublicationPackage(packageId: string): Promise<PublicationPackage> {
  const pkg = await getPackage(packageId);
  if (!pkg.propertySetupId) throw new Error('У пакета не указан профиль объекта.');
  return buildPublicationPackage(pkg.propertySetupId, { packageId: pkg.id });
}

export async function computePublicationReadiness(packageId: string): Promise<number> { return (await validatePublicationPackage(packageId)).readinessScore; }
export async function getPublicationMissingFields(packageId: string): Promise<string[]> { return (await validatePublicationPackage(packageId)).missingFields; }

export async function selectPublicationChannels(packageId: string, channelKeys: PublicationChannelKey[], metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  const pkg = await getPackage(packageId); const selected = parsePublicationChannelKeys(channelKeys); const now = new Date().toISOString(); const meta = safeMetadata(metadata);
  const { error: clearError } = await supabase.from('booking_channel_publication_channels').update({ selected: false, status: 'not_selected', missing_fields: [], updated_at: now }).eq('package_id', pkg.id);
  if (clearError) throw new Error(clearError.message);
  if (selected.length) {
    const { error } = await supabase.from('booking_channel_publication_channels').update({ selected: true, status: 'selected', metadata: meta, updated_at: now }).eq('package_id', pkg.id).in('channel_key', selected);
    if (error) throw new Error(error.message);
  }
  return validatePublicationPackage(pkg.id);
}

export async function selectAllSupportedPublicationChannels(packageId: string, metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  return selectPublicationChannels(packageId, PUBLICATION_CHANNEL_KEYS.filter((key) => key !== 'other'), metadata);
}

export async function updateChannelPublicationStatus(packageId: string, channelKey: PublicationChannelKey, status: PublicationChannelStatus, metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  const pkg = await getPackage(packageId); const key = parsePublicationChannelKeys([channelKey])[0];
  if (!(PUBLICATION_CHANNEL_STATUSES as readonly string[]).includes(status)) throw new Error('Недопустимый статус канала.');
  const { error } = await supabase.from('booking_channel_publication_channels').update({ selected: status !== 'not_selected', status, metadata: safeMetadata(metadata), updated_at: new Date().toISOString() }).eq('package_id', pkg.id).eq('channel_key', key);
  if (error) throw new Error(error.message); return getPackage(pkg.id);
}

async function markPackageStatus(packageId: string, status: PublicationPackageStatus, metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  const pkg = await getPackage(packageId); const meta = { ...pkg.metadata, ...safeMetadata(metadata), real_ota_publishing_enabled: false }; const now = new Date().toISOString();
  if (['ready_for_review', 'ready_for_publication', 'publication_pending', 'published_placeholder'].includes(status)) {
    const validated = await validatePublicationPackage(pkg.id);
    if (validated.missingFields.length) throw new Error(`Пакет ещё не готов: ${validated.missingFields.join(', ')}.`);
  }
  const summary = status === 'published_placeholder' ? 'Ручная публикация отмечена как подтверждённая. Это не подтверждение автоматической OTA-синхронизации.' :
    status === 'publication_pending' ? 'Публикация ожидает активации провайдера или ручного подтверждения.' :
    status === 'ready_for_publication' ? 'Готово к ручной или пилотной публикации через выбранный менеджер каналов.' : 'Пакет публикации готов к проверке.';
  const { data, error } = await supabase.from('booking_channel_publication_packages').update({ status, safe_summary: summary, metadata: meta, updated_at: now }).eq('id', pkg.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить статус пакета.');
  if (status === 'publication_pending' || status === 'published_placeholder') {
    await supabase.from('booking_channel_publication_channels').update({ status: status === 'publication_pending' ? 'publication_pending' : 'published_placeholder', updated_at: now }).eq('package_id', pkg.id).eq('selected', true);
  }
  const updated = await hydratePackage(data as Row);
  if (status === 'publication_pending') await queuePublicationIntent(updated, 'publication_pending_notice', summary);
  else await queuePublicationIntent(updated, status === 'ready_for_review' || status === 'ready_for_publication' ? 'publication_package_ready_notice' : 'internal_status_notice', summary);
  return updated;
}

export const markReadyForReview = (packageId: string, metadata?: Record<string, unknown>) => markPackageStatus(packageId, 'ready_for_review', metadata);
export const markReadyForPublication = (packageId: string, metadata?: Record<string, unknown>) => markPackageStatus(packageId, 'ready_for_publication', metadata);
export const markPublicationPending = (packageId: string, metadata?: Record<string, unknown>) => markPackageStatus(packageId, 'publication_pending', metadata);
export const markPublishedPlaceholder = (packageId: string, metadata?: Record<string, unknown>) => markPackageStatus(packageId, 'published_placeholder', { ...metadata, manual_placeholder: true });

export async function blockPublicationPackage(packageId: string, reason: string, metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  const pkg = await getPackage(packageId); const safeReason = text(reason).slice(0, 1000); if (!safeReason) throw new Error('Укажите причину блокировки.'); assertSafePublicationInput({ reason: safeReason, ...metadata });
  const now = new Date().toISOString(); const { data, error } = await supabase.from('booking_channel_publication_packages').update({ status: 'blocked', safe_summary: `Публикация заблокирована: ${safeReason}`, metadata: { ...pkg.metadata, ...safeMetadata(metadata), blocked_reason: safeReason }, updated_at: now }).eq('id', pkg.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось заблокировать пакет.');
  await supabase.from('booking_channel_publication_channels').update({ status: 'blocked', updated_at: now }).eq('package_id', pkg.id).eq('selected', true);
  const updated = await hydratePackage(data as Row); await queuePublicationIntent(updated, 'internal_status_notice', updated.safeSummary ?? 'Публикация заблокирована.'); return updated;
}

export async function addPublicationNote(packageId: string, note: string, metadata?: Record<string, unknown>): Promise<PublicationPackage> {
  const pkg = await getPackage(packageId); const value = text(note).slice(0, 1000); if (!value) throw new Error('Введите заметку.'); assertSafePublicationInput({ note: value, ...metadata });
  const notes = Array.isArray(pkg.metadata.notes) ? pkg.metadata.notes : [];
  const { data, error } = await supabase.from('booking_channel_publication_packages').update({ metadata: { ...pkg.metadata, ...safeMetadata(metadata), notes: [...notes, { text: value, created_at: new Date().toISOString() }].slice(-20) }, updated_at: new Date().toISOString() }).eq('id', pkg.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось сохранить заметку.'); return hydratePackage(data as Row);
}

export async function listPublicationPackages(propertySetupId?: string): Promise<PublicationPackage[]> {
  let query = supabase.from('booking_channel_publication_packages').select('*').order('updated_at', { ascending: false }).limit(50);
  if (propertySetupId) query = query.eq('property_setup_id', assertPublicationUuid(propertySetupId, 'ID профиля объекта'));
  const { data, error } = await query; if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as Row[]).map(hydratePackage));
}

async function resolvePackage(ref: string): Promise<PublicationPackage | null> {
  const id = assertPublicationUuid(ref); const { data } = await supabase.from('booking_channel_publication_packages').select('*').eq('id', id).maybeSingle();
  if (data) return hydratePackage(data as Row);
  const packages = await listPublicationPackages(id); return packages[0] ?? null;
}

export async function getPublicationReadinessStatus(propertySetupIdOrPackageId: string): Promise<PublicationPackage | null> { return resolvePackage(propertySetupIdOrPackageId); }
export async function getPublicationBlockers(propertySetupIdOrPackageId: string): Promise<string[]> { return (await resolvePackage(propertySetupIdOrPackageId))?.missingFields ?? []; }

export function providerFromChannelManager(provider: ChannelManagerProvider): PublicationProvider { return parsePublicationProvider(provider); }
