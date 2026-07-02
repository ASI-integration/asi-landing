import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getPropertySetupById } from './owner-object-setup-autopilot';
import { getAudienceProfile, type PrimaryAudience } from './property-audience-intelligence';
import { getChannelManagerConnectionStatus } from './channel-manager-access-import';

export const MARKET_SIGNAL_RADII_KM = [1, 3, 7, 10] as const;
export const MARKET_SIGNAL_TYPES = ['competitor_prices', 'available_supply', 'event_pressure', 'weather_pressure', 'channel_snapshot'] as const;
export const MARKET_SOURCE_TYPES = [
  'manual', 'channel_import', 'weather_provider_placeholder', 'events_provider_placeholder',
  'market_provider_placeholder', 'competitor_snapshot', 'supply_snapshot', 'internal',
] as const;
export const MARKET_SOURCE_PROVIDERS = [
  'manual', 'openweather_placeholder', 'yandex_weather_placeholder',
  'event_provider_placeholder', 'channel_manager', 'other',
] as const;

export type MarketSignalType = (typeof MARKET_SIGNAL_TYPES)[number];
export type MarketSourceType = (typeof MARKET_SOURCE_TYPES)[number];
export type MarketSourceProvider = (typeof MARKET_SOURCE_PROVIDERS)[number];
export type MarketSourceStatus = 'draft' | 'configured' | 'active_placeholder' | 'active_manual' | 'paused' | 'failed' | 'blocked';

type Row = Record<string, unknown>;
type DateRange = { from: string; to: string };
type CompetitorSnapshot = { median?: number; p25?: number; p75?: number; min?: number; max?: number; count?: number; confidence_score?: number };
type SupplySnapshot = { available_count?: number; total_count?: number; availability_ratio?: number; booked_count?: number; confidence_score?: number };
type EventSnapshot = { name?: string; type?: string; date?: string; distance_km?: number; expected_impact?: 'low' | 'medium' | 'high' | 'unknown'; confidence_score?: number };
type WeatherSnapshot = { date?: string; condition?: string; temperature_c?: number; precipitation_probability?: number; impact?: 'positive' | 'neutral' | 'medium_negative' | 'high_negative' | 'unknown'; confidence_score?: number };

export type ManualMarketSnapshotInput = {
  date: string;
  radius_km: number;
  competitor_prices?: CompetitorSnapshot;
  available_supply?: SupplySnapshot;
  events?: EventSnapshot[];
  weather?: WeatherSnapshot;
};

export type NormalizedMarketSignal = {
  id: string;
  propertySetupId: string | null;
  propertyId: string | null;
  signalDate: string;
  radiusKm: number;
  signalType: MarketSignalType;
  source: string;
  value: Record<string, unknown>;
  confidenceScore: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MarketSignalSource = {
  id: string;
  propertySetupId: string | null;
  propertyId: string | null;
  sourceType: MarketSourceType;
  provider: MarketSourceProvider;
  status: MarketSourceStatus;
  radiusKm: number | null;
  scheduleStatus: string;
  lastIngestedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureReason: string | null;
  safeSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_PAYLOAD_BYTES = 32_768;
const MAX_TEXT_LENGTH = 240;
const MAX_PRICE = 10_000_000;
const FORBIDDEN_RE = /(?:password|passwd|парол|token|secret|credential|payment|passport|cookie|authorization)/iu;

function text(value: unknown): string { return String(value ?? '').trim(); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function numberOrNull(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, Math.round(value))); }
function safeText(value: unknown, label: string, required = false): string {
  const result = text(value);
  if (required && !result) throw new Error(`Укажите ${label}.`);
  if (result.length > MAX_TEXT_LENGTH || /[<>\u0000-\u001f]/u.test(result) || FORBIDDEN_RE.test(result)) throw new Error(`Поле «${label}» содержит недопустимые данные.`);
  return result;
}

export function assertMarketUuid(value: unknown, label = 'ID'): string {
  const id = text(value);
  if (!UUID_RE.test(id)) throw new Error(`${label} указан неверно.`);
  return id;
}

export function assertMarketRadius(value: unknown): number {
  const radius = Number(value);
  if (!MARKET_SIGNAL_RADII_KM.includes(radius as (typeof MARKET_SIGNAL_RADII_KM)[number])) throw new Error('Радиус должен быть 1, 3, 7 или 10 км.');
  return radius;
}

function assertSafePayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Слишком большой объём данных.');
  if (FORBIDDEN_RE.test(serialized) || /<script|javascript:|data:text\/html/iu.test(serialized)) throw new Error('Недопустимые данные в снимке рынка.');
}

function safeMetadata(value?: Record<string, unknown>): Record<string, unknown> {
  const metadata = value ?? {};
  assertSafePayload(metadata);
  return metadata;
}

function validDate(value: unknown, label = 'дату'): string {
  const date = text(value);
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new Error(`Укажите ${label} в формате YYYY-MM-DD.`);
  return date;
}

function optionalNonNegative(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label} указано неверно.`);
  return n;
}

export function validateMarketSnapshot(input: unknown): ManualMarketSnapshotInput {
  const value = object(input);
  assertSafePayload(value);
  const date = validDate(value.date);
  const radius = assertMarketRadius(value.radius_km);
  const competitorRaw = value.competitor_prices == null ? null : object(value.competitor_prices);
  const supplyRaw = value.available_supply == null ? null : object(value.available_supply);
  const weatherRaw = value.weather == null ? null : object(value.weather);

  const competitor = competitorRaw ? {
    median: optionalNonNegative(competitorRaw.median, 'Медианная цена', MAX_PRICE),
    p25: optionalNonNegative(competitorRaw.p25, 'Цена p25', MAX_PRICE),
    p75: optionalNonNegative(competitorRaw.p75, 'Цена p75', MAX_PRICE),
    min: optionalNonNegative(competitorRaw.min, 'Минимальная цена', MAX_PRICE),
    max: optionalNonNegative(competitorRaw.max, 'Максимальная цена', MAX_PRICE),
    count: optionalNonNegative(competitorRaw.count, 'Количество конкурентов', 100_000),
    confidence_score: optionalNonNegative(competitorRaw.confidence_score, 'Уверенность', 100),
  } : undefined;
  if (competitor && competitor.min != null && competitor.max != null && competitor.min > competitor.max) throw new Error('Минимальная цена не может быть выше максимальной.');
  if (competitor && competitor.p25 != null && competitor.p75 != null && competitor.p25 > competitor.p75) throw new Error('Цена p25 не может быть выше p75.');

  const supply = supplyRaw ? {
    available_count: optionalNonNegative(supplyRaw.available_count, 'Доступное предложение', 1_000_000),
    total_count: optionalNonNegative(supplyRaw.total_count, 'Общее предложение', 1_000_000),
    availability_ratio: optionalNonNegative(supplyRaw.availability_ratio, 'Доля доступности', 1),
    booked_count: optionalNonNegative(supplyRaw.booked_count, 'Забронировано', 1_000_000),
    confidence_score: optionalNonNegative(supplyRaw.confidence_score, 'Уверенность', 100),
  } : undefined;
  if (supply?.available_count != null && supply.total_count != null && supply.total_count < supply.available_count) throw new Error('Общее предложение не может быть меньше доступного.');
  if (supply && supply.availability_ratio == null && supply.available_count != null && supply.total_count) supply.availability_ratio = supply.available_count / supply.total_count;

  const events = Array.isArray(value.events) ? value.events.map((item) => {
    const event = object(item);
    const impact = text(event.expected_impact || 'unknown');
    if (!['low', 'medium', 'high', 'unknown'].includes(impact)) throw new Error('Влияние события указано неверно.');
    return {
      name: safeText(event.name, 'название события', true),
      type: safeText(event.type, 'тип события'),
      date: event.date ? validDate(event.date, 'дату события') : date,
      distance_km: optionalNonNegative(event.distance_km, 'Расстояние до события', 1000),
      expected_impact: impact as EventSnapshot['expected_impact'],
      confidence_score: optionalNonNegative(event.confidence_score, 'Уверенность', 100),
    };
  }) : undefined;
  if (events && events.length > 50) throw new Error('Слишком много событий в одном снимке.');

  let weather: WeatherSnapshot | undefined;
  if (weatherRaw) {
    const impact = text(weatherRaw.impact || 'unknown');
    if (!['positive', 'neutral', 'medium_negative', 'high_negative', 'unknown'].includes(impact)) throw new Error('Влияние погоды указано неверно.');
    weather = {
      date: weatherRaw.date ? validDate(weatherRaw.date, 'дату погоды') : date,
      condition: safeText(weatherRaw.condition, 'погода'),
      temperature_c: weatherRaw.temperature_c == null ? undefined : Number(weatherRaw.temperature_c),
      precipitation_probability: optionalNonNegative(weatherRaw.precipitation_probability, 'Вероятность осадков', 1),
      impact: impact as WeatherSnapshot['impact'],
      confidence_score: optionalNonNegative(weatherRaw.confidence_score, 'Уверенность', 100),
    };
    if (weather.temperature_c != null && (!Number.isFinite(weather.temperature_c) || weather.temperature_c < -90 || weather.temperature_c > 70)) throw new Error('Температура указана неверно.');
  }

  if (!competitor && !supply && !events?.length && !weather) throw new Error('Снимок не содержит распознаваемых сигналов.');
  return { date, radius_km: radius, competitor_prices: competitor, available_supply: supply, events, weather };
}

function mapSignal(row: Row): NormalizedMarketSignal {
  return {
    id: text(row.id), propertySetupId: text(row.property_setup_id) || null, propertyId: text(row.property_id) || null,
    signalDate: text(row.signal_date), radiusKm: Number(row.radius_km), signalType: text(row.signal_type) as MarketSignalType,
    source: text(row.source), value: object(row.value), confidenceScore: Number(row.confidence_score ?? 50),
    metadata: object(row.metadata), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function mapSource(row: Row): MarketSignalSource {
  return {
    id: text(row.id), propertySetupId: text(row.property_setup_id) || null, propertyId: text(row.property_id) || null,
    sourceType: text(row.source_type) as MarketSourceType, provider: text(row.provider) as MarketSourceProvider,
    status: text(row.status) as MarketSourceStatus, radiusKm: numberOrNull(row.radius_km), scheduleStatus: text(row.schedule_status),
    lastIngestedAt: text(row.last_ingested_at) || null, lastSuccessAt: text(row.last_success_at) || null,
    lastFailureAt: text(row.last_failure_at) || null, failureReason: text(row.failure_reason) || null,
    safeSummary: text(row.safe_summary) || null, metadata: object(row.metadata), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function snapshotConfidence(snapshot: ManualMarketSnapshotInput): number {
  const explicit = [snapshot.competitor_prices?.confidence_score, snapshot.available_supply?.confidence_score, snapshot.weather?.confidence_score]
    .filter((n): n is number => typeof n === 'number');
  if (explicit.length) return clamp(explicit.reduce((a, b) => a + b, 0) / explicit.length);
  let score = 40;
  if ((snapshot.competitor_prices?.count ?? 0) >= 10) score += 20;
  if (snapshot.available_supply?.total_count) score += 15;
  if (snapshot.events?.length) score += 15;
  if (snapshot.weather) score += 10;
  return clamp(score, 25, 95);
}

async function resolveSetup(propertySetupId: string) {
  const setupId = assertMarketUuid(propertySetupId, 'propertySetupId');
  const setup = await getPropertySetupById(setupId);
  if (!setup) throw new Error('Профиль объекта не найден.');
  return { setupId, setup };
}

async function insertSignals(propertySetupId: string, snapshots: ManualMarketSnapshotInput[], source: string, metadata?: Record<string, unknown>): Promise<NormalizedMarketSignal[]> {
  const { setupId, setup } = await resolveSetup(propertySetupId);
  const now = new Date().toISOString();
  const rows: Row[] = [];
  for (const snapshot of snapshots) {
    const confidence = snapshotConfidence(snapshot);
    const base = { property_setup_id: setupId, property_id: setup.propertyId, radius_km: snapshot.radius_km, source, confidence_score: confidence, metadata: safeMetadata(metadata), created_at: now, updated_at: now };
    if (snapshot.competitor_prices) rows.push({ id: randomUUID(), ...base, signal_date: snapshot.date, signal_type: 'competitor_prices', value: snapshot.competitor_prices });
    if (snapshot.available_supply) rows.push({ id: randomUUID(), ...base, signal_date: snapshot.date, signal_type: 'available_supply', value: snapshot.available_supply });
    if (snapshot.events?.length) rows.push({ id: randomUUID(), ...base, signal_date: snapshot.date, signal_type: 'event_pressure', value: { events: snapshot.events } });
    if (snapshot.weather) rows.push({ id: randomUUID(), ...base, signal_date: snapshot.weather.date ?? snapshot.date, signal_type: 'weather_pressure', value: snapshot.weather });
  }
  if (!rows.length) throw new Error('Снимок не содержит распознаваемых сигналов.');
  const { data, error } = await supabase.from('booking_pricing_market_signals').insert(rows).select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSignal(row as Row));
}

export async function initializeMarketSignalSource(propertySetupId: string, sourceType: MarketSourceType, provider: MarketSourceProvider = 'manual', metadata?: Record<string, unknown>): Promise<MarketSignalSource> {
  if (!MARKET_SOURCE_TYPES.includes(sourceType)) throw new Error('Недопустимый тип источника.');
  if (!MARKET_SOURCE_PROVIDERS.includes(provider)) throw new Error('Недопустимый поставщик данных.');
  const { setupId, setup } = await resolveSetup(propertySetupId);
  const now = new Date().toISOString();
  const placeholder = sourceType.includes('placeholder');
  const { data, error } = await supabase.from('booking_market_signal_sources').insert({
    id: randomUUID(), property_setup_id: setupId, property_id: setup.propertyId, source_type: sourceType, provider,
    status: placeholder ? 'active_placeholder' : sourceType === 'manual' ? 'active_manual' : 'configured',
    schedule_status: 'not_scheduled', safe_summary: placeholder ? 'Источник подготовлен, live-поставщик не подключён.' : 'Источник готов к ручному запуску.',
    metadata: safeMetadata(metadata), created_at: now, updated_at: now,
  }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать источник.');
  return mapSource(data as Row);
}

export async function configureMarketSignalSource(sourceId: string, config: Record<string, unknown>, metadata?: Record<string, unknown>): Promise<MarketSignalSource> {
  const id = assertMarketUuid(sourceId, 'sourceId');
  assertSafePayload(config);
  const current = await supabase.from('booking_market_signal_sources').select('*').eq('id', id).maybeSingle();
  if (current.error || !current.data) throw new Error(current.error?.message ?? 'Источник не найден.');
  const existing = mapSource(current.data as Row);
  const updates: Row = { updated_at: new Date().toISOString(), metadata: { ...existing.metadata, ...safeMetadata(metadata), config: { ...object(existing.metadata.config), ...safeMetadata(config) } } };
  if (config.radius_km != null) updates.radius_km = assertMarketRadius(config.radius_km);
  if (config.status != null) {
    const status = text(config.status);
    if (!['draft', 'configured', 'active_placeholder', 'active_manual', 'paused', 'failed', 'blocked'].includes(status)) throw new Error('Недопустимый статус источника.');
    updates.status = status;
  }
  updates.safe_summary = 'Настройки источника обновлены.';
  const { data, error } = await supabase.from('booking_market_signal_sources').update(updates).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Источник не найден.');
  return mapSource(data as Row);
}

async function getOrCreateManualSource(propertySetupId: string): Promise<MarketSignalSource> {
  const setupId = assertMarketUuid(propertySetupId, 'propertySetupId');
  const { data } = await supabase.from('booking_market_signal_sources').select('*').eq('property_setup_id', setupId).eq('source_type', 'manual').order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data ? mapSource(data as Row) : initializeMarketSignalSource(setupId, 'manual', 'manual');
}

async function createRun(source: MarketSignalSource | null, propertySetupId: string, input: { status?: string; types: string[]; dates: string[]; radii: number[]; metadata?: Record<string, unknown> }): Promise<string> {
  const { setupId, setup } = await resolveSetup(propertySetupId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const dates = input.dates.sort();
  const { error } = await supabase.from('booking_market_signal_ingestion_runs').insert({
    id, source_id: source?.id ?? null, property_setup_id: setupId, property_id: setup.propertyId,
    status: input.status ?? 'running', signal_types: [...new Set(input.types)], date_from: dates[0] ?? null, date_to: dates.at(-1) ?? null,
    radii_km: [...new Set(input.radii)], metadata: safeMetadata(input.metadata), created_at: now, updated_at: now,
  });
  if (error) throw new Error(error.message);
  return id;
}

async function finishRun(runId: string, sourceId: string | null, count: number, warnings: string[], dryRun = false): Promise<void> {
  const now = new Date().toISOString();
  const status = dryRun ? 'dry_run' : warnings.length ? 'completed_with_warnings' : 'completed';
  const { error } = await supabase.from('booking_market_signal_ingestion_runs').update({ status, ingested_count: count, warnings, safe_summary: dryRun ? 'Пробный запуск завершён без записи сигналов.' : `Загружено сигналов: ${count}.`, updated_at: now }).eq('id', runId);
  if (error) throw new Error(error.message);
  if (sourceId) await supabase.from('booking_market_signal_sources').update({ last_ingested_at: now, last_success_at: now, failure_reason: null, safe_summary: dryRun ? 'Пробный запуск выполнен.' : `Последняя загрузка: ${count} сигналов.`, updated_at: now }).eq('id', sourceId);
}

export async function ingestManualMarketSnapshot(propertySetupId: string, snapshot: unknown, metadata?: Record<string, unknown>): Promise<{ signals: NormalizedMarketSignal[]; runId: string }> {
  const snapshots = (Array.isArray(snapshot) ? snapshot : [snapshot]).map(validateMarketSnapshot);
  if (snapshots.length > 31) throw new Error('Слишком много снимков в одном запросе.');
  const source = await getOrCreateManualSource(propertySetupId);
  const types = snapshots.flatMap((item) => [item.competitor_prices && 'competitor_prices', item.available_supply && 'available_supply', item.events?.length && 'event_pressure', item.weather && 'weather_pressure'].filter(Boolean) as string[]);
  const runId = await createRun(source, propertySetupId, { types, dates: snapshots.map((s) => s.date), radii: snapshots.map((s) => s.radius_km), metadata });
  try {
    const signals = await insertSignals(propertySetupId, snapshots, 'manual', { ...safeMetadata(metadata), ingestion_run_id: runId, source_id: source.id });
    await finishRun(runId, source.id, signals.length, []);
    return { signals, runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка загрузки.';
    const now = new Date().toISOString();
    await supabase.from('booking_market_signal_ingestion_runs').update({ status: 'failed', errors: [message], safe_summary: 'Загрузка не выполнена.', updated_at: now }).eq('id', runId);
    await supabase.from('booking_market_signal_sources').update({ status: 'failed', last_failure_at: now, failure_reason: message.slice(0, MAX_TEXT_LENGTH), updated_at: now }).eq('id', source.id);
    throw error;
  }
}

export async function ingestCompetitorSnapshot(propertySetupId: string, snapshot: Record<string, unknown>, metadata?: Record<string, unknown>) {
  return ingestManualMarketSnapshot(propertySetupId, { date: snapshot.date, radius_km: snapshot.radius_km, competitor_prices: snapshot.competitor_prices ?? snapshot }, metadata);
}
export async function ingestSupplySnapshot(propertySetupId: string, snapshot: Record<string, unknown>, metadata?: Record<string, unknown>) {
  return ingestManualMarketSnapshot(propertySetupId, { date: snapshot.date, radius_km: snapshot.radius_km, available_supply: snapshot.available_supply ?? snapshot }, metadata);
}
export async function ingestEventsSnapshot(propertySetupId: string, events: unknown[], metadata?: Record<string, unknown>) {
  const meta = metadata ?? {};
  return ingestManualMarketSnapshot(propertySetupId, { date: meta.date, radius_km: meta.radius_km, events }, metadata);
}
export async function ingestWeatherSnapshot(propertySetupId: string, weatherRows: unknown[], metadata?: Record<string, unknown>) {
  const meta = metadata ?? {};
  const snapshots = weatherRows.map((row) => ({ date: object(row).date, radius_km: object(row).radius_km ?? meta.radius_km, weather: row }));
  return ingestManualMarketSnapshot(propertySetupId, snapshots, metadata);
}

export async function importChannelPricingSignals(propertySetupId: string, connectionId?: string, metadata?: Record<string, unknown>): Promise<{ signals: NormalizedMarketSignal[]; runId: string; warnings: string[] }> {
  const { setupId, setup } = await resolveSetup(propertySetupId);
  const connection = await getChannelManagerConnectionStatus(connectionId ? { connectionId } : { propertySetupId: setupId });
  if (!connection) throw new Error('Подключение менеджера каналов не найдено.');
  let source: MarketSignalSource;
  const { data: existing } = await supabase.from('booking_market_signal_sources').select('*').eq('property_setup_id', setupId).eq('source_type', 'channel_import').limit(1).maybeSingle();
  source = existing ? mapSource(existing as Row) : await initializeMarketSignalSource(setupId, 'channel_import', 'channel_manager', { connection_id: connection.id });
  const { data, error } = await supabase.from('booking_channel_calendar_snapshots').select('date,price_amount,availability_status,updated_at').eq('connection_id', connection.id).order('date', { ascending: true }).limit(3660);
  if (error) throw new Error(error.message);
  const snapshots = (data ?? []) as Row[];
  const dates = [...new Set(snapshots.map((row) => text(row.date)).filter(Boolean))];
  const runId = await createRun(source, setupId, { types: ['channel_snapshot'], dates, radii: [3], metadata });
  const now = new Date().toISOString();
  const signalRows = dates.map((date) => {
    const dayRows = snapshots.filter((row) => text(row.date) === date);
    const prices = dayRows.map((row) => numberOrNull(row.price_amount)).filter((n): n is number => n != null && n >= 0);
    const available = dayRows.filter((row) => text(row.availability_status) === 'available').length;
    return {
      id: randomUUID(), property_setup_id: setupId, property_id: setup.propertyId, signal_date: date, radius_km: 3,
      signal_type: 'channel_snapshot', source: 'channel_import', confidence_score: 70,
      value: { price_count: prices.length, median_price: prices.length ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null, available_count: available, total_count: dayRows.length },
      metadata: { ...safeMetadata(metadata), ingestion_run_id: runId, source_id: source.id, connection_id: connection.id }, created_at: now, updated_at: now,
    };
  });
  const warnings = signalRows.length ? [] : ['В импортированном календаре пока нет цен или доступности.'];
  let signals: NormalizedMarketSignal[] = [];
  if (signalRows.length) {
    const inserted = await supabase.from('booking_pricing_market_signals').insert(signalRows).select('*');
    if (inserted.error) throw new Error(inserted.error.message);
    signals = (inserted.data ?? []).map((row) => mapSignal(row as Row));
  }
  await finishRun(runId, source.id, signals.length, warnings);
  return { signals, runId, warnings };
}

export async function runMarketSignalIngestion(sourceId: string, options?: { dryRun?: boolean; metadata?: Record<string, unknown> }) {
  const id = assertMarketUuid(sourceId, 'sourceId');
  const { data, error } = await supabase.from('booking_market_signal_sources').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'Источник не найден.');
  const source = mapSource(data as Row);
  if (source.status === 'blocked' || source.status === 'paused') throw new Error('Источник остановлен.');
  if (source.sourceType === 'channel_import' && !options?.dryRun) return importChannelPricingSignals(source.propertySetupId ?? '', text(source.metadata.connection_id) || undefined, options?.metadata);
  const runId = await createRun(source, source.propertySetupId ?? '', { status: options?.dryRun ? 'dry_run' : 'running', types: [], dates: [], radii: source.radiusKm ? [source.radiusKm] : [], metadata: options?.metadata });
  const warnings = source.sourceType.includes('placeholder') ? ['Live-поставщик не подключён; источник остаётся placeholder.'] : ['Для источника нужен ручной снимок.'];
  await finishRun(runId, source.id, 0, warnings, Boolean(options?.dryRun));
  return { runId, status: options?.dryRun ? 'dry_run' : 'completed_with_warnings', ingestedCount: 0, warnings };
}

function defaultRange(): DateRange {
  const from = new Date().toISOString().slice(0, 10);
  const toDate = new Date(`${from}T00:00:00Z`); toDate.setUTCDate(toDate.getUTCDate() + 6);
  return { from, to: toDate.toISOString().slice(0, 10) };
}

async function listSignals(propertySetupId: string, dateRange = defaultRange(), radiusKm?: number): Promise<NormalizedMarketSignal[]> {
  const setupId = assertMarketUuid(propertySetupId, 'propertySetupId');
  let query = supabase.from('booking_pricing_market_signals').select('*').eq('property_setup_id', setupId).gte('signal_date', validDate(dateRange.from)).lte('signal_date', validDate(dateRange.to)).order('signal_date', { ascending: true });
  if (radiusKm != null) query = query.eq('radius_km', assertMarketRadius(radiusKm));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSignal(row as Row));
}

export async function getSignalsForPricingDate(propertySetupId: string, date: string, radiusKm?: number) {
  const targetDate = validDate(date);
  return listSignals(propertySetupId, { from: targetDate, to: targetDate }, radiusKm);
}

export async function getMarketSignalsByRadius(propertySetupId: string, radiusKm: number, dateRange?: DateRange) {
  return listSignals(propertySetupId, dateRange, radiusKm);
}

export function getAudienceRadiusWeights(audience: PrimaryAudience | 'unknown' = 'unknown', signalType?: MarketSignalType): Record<number, number> {
  const balanced = { 1: 1, 3: 1, 7: 0.75, 10: 0.55 };
  if (audience === 'business_center') return { 1: 1.4, 3: 1.3, 7: signalType === 'event_pressure' ? 1 : 0.55, 10: 0.35 };
  if (audience === 'leisure_seaside') return { 1: 0.55, 3: 1.15, 7: 1.3, 10: signalType === 'weather_pressure' ? 1.35 : 1.05 };
  if (audience === 'family_vacation') return { 1: 0.65, 3: 1.25, 7: 1.2, 10: 0.75 };
  if (audience === 'event_visitors') return { 1: 1.5, 3: 1.45, 7: 1.25, 10: 1.05 };
  if (audience === 'medical_travel') return { 1: 0.9, 3: 1.1, 7: 1, 10: 0.8 };
  return balanced;
}

function signalScore(signal: NormalizedMarketSignal): number {
  if (signal.signalType === 'competitor_prices') return signal.value.median != null ? 60 : 50;
  if (signal.signalType === 'available_supply') {
    const ratio = Number(signal.value.availability_ratio ?? 0.5);
    return clamp((1 - ratio) * 100);
  }
  if (signal.signalType === 'event_pressure') {
    const events = Array.isArray(signal.value.events) ? signal.value.events as Row[] : [];
    return clamp(50 + events.reduce((sum, event) => sum + (text(event.expected_impact) === 'high' ? 25 : text(event.expected_impact) === 'medium' ? 12 : 5), 0));
  }
  if (signal.signalType === 'weather_pressure') {
    const impact = text(signal.value.impact);
    return impact === 'positive' ? 70 : impact === 'high_negative' ? 25 : impact === 'medium_negative' ? 40 : 50;
  }
  if (signal.signalType === 'channel_snapshot') {
    const available = Number(signal.value.available_count ?? 0); const total = Number(signal.value.total_count ?? 0);
    return total > 0 ? clamp((1 - available / total) * 100) : 50;
  }
  return 50;
}

export async function computeRadiusWeightedSignal(propertySetupId: string, signalType: MarketSignalType, date: string, options?: { audience?: PrimaryAudience; radiiKm?: number[] }) {
  const targetDate = validDate(date);
  const profile = options?.audience ? null : await getAudienceProfile(propertySetupId);
  const audience = options?.audience ?? profile?.primaryAudience ?? 'unknown';
  const radii = options?.radiiKm?.map(assertMarketRadius) ?? [...MARKET_SIGNAL_RADII_KM];
  const weights = getAudienceRadiusWeights(audience, signalType);
  const signals = (await listSignals(propertySetupId, { from: targetDate, to: targetDate })).filter((signal) => signal.signalType === signalType && radii.includes(signal.radiusKm));
  if (!signals.length) return { score: 50, signalType, audience, signalsUsed: [], warning: 'Нет данных для выбранного сигнала.' };
  let totalWeight = 0; let weighted = 0;
  for (const signal of signals) {
    const weight = (weights[signal.radiusKm] ?? 0.5) * (signal.confidenceScore / 100);
    weighted += signalScore(signal) * weight; totalWeight += weight;
  }
  return { score: clamp(weighted / Math.max(totalWeight, 0.01)), signalType, audience, signalsUsed: signals.map((s) => ({ id: s.id, radiusKm: s.radiusKm, confidenceScore: s.confidenceScore })), warning: null };
}

export async function computeMarketPressureScore(propertySetupId: string, date: string, options?: { audience?: PrimaryAudience }) {
  const results = await Promise.all(MARKET_SIGNAL_TYPES.slice(0, 4).map((type) => computeRadiusWeightedSignal(propertySetupId, type, date, options)));
  const profile = options?.audience ? null : await getAudienceProfile(propertySetupId);
  const audience = options?.audience ?? profile?.primaryAudience ?? 'unknown';
  const typeWeights: Record<string, number> = { competitor_prices: 1, available_supply: 1, event_pressure: audience === 'event_visitors' || audience === 'business_center' ? 1.5 : 1, weather_pressure: audience === 'leisure_seaside' ? 1.5 : 0.8 };
  let weighted = 0; let total = 0;
  for (const result of results) { const w = typeWeights[result.signalType] ?? 1; weighted += result.score * w; total += w; }
  return { score: clamp(weighted / total), date: validDate(date), audience, components: Object.fromEntries(results.map((r) => [r.signalType, r.score])), signalsUsed: results.flatMap((r) => r.signalsUsed), warnings: results.map((r) => r.warning).filter(Boolean) as string[] };
}

export async function getMarketSignalCoverage(propertySetupId: string) {
  const setupId = assertMarketUuid(propertySetupId, 'propertySetupId');
  const range = defaultRange();
  const [signals, sourcesResult, runsResult] = await Promise.all([
    listSignals(setupId, range),
    supabase.from('booking_market_signal_sources').select('*').eq('property_setup_id', setupId).order('updated_at', { ascending: false }),
    supabase.from('booking_market_signal_ingestion_runs').select('*').eq('property_setup_id', setupId).order('created_at', { ascending: false }).limit(1),
  ]);
  if (sourcesResult.error) throw new Error(sourcesResult.error.message);
  if (runsResult.error) throw new Error(runsResult.error.message);
  const presentTypes = [...new Set(signals.map((s) => s.signalType))];
  const presentRadii = [...new Set(signals.map((s) => s.radiusKm))].sort((a, b) => a - b);
  const typeCoverage = MARKET_SIGNAL_TYPES.slice(0, 4).filter((type) => presentTypes.includes(type)).length / 4;
  const radiusCoverage = MARKET_SIGNAL_RADII_KM.filter((radius) => presentRadii.includes(radius)).length / 4;
  const coverageScore = clamp((typeCoverage * 0.7 + radiusCoverage * 0.3) * 100);
  const statuses = Object.fromEntries(MARKET_SIGNAL_TYPES.map((type) => [type, presentTypes.includes(type) ? 'available' : 'missing']));
  const warnings = MARKET_SIGNAL_TYPES.slice(0, 4).filter((type) => !presentTypes.includes(type)).map((type) => `Нет сигнала: ${type}.`);
  return {
    coverageScore, dateRange: range, supportedRadiiKm: [...MARKET_SIGNAL_RADII_KM], presentRadiiKm: presentRadii, signalStatuses: statuses,
    sources: (sourcesResult.data ?? []).map((row) => mapSource(row as Row)), latestIngestion: (runsResult.data ?? [])[0] ?? null,
    warnings, nextAction: warnings.length ? 'Добавить ручной снимок рынка или импортировать календарь.' : 'Обновить данные перед следующим расчётом.',
    honestNotice: 'Основа загрузки сигналов: ручные и provider-ready данные. Live-поставщики не подключены.',
  };
}

export async function getMarketSignalsSummary(propertySetupId: string, dateRange?: DateRange) {
  const range = dateRange ?? defaultRange();
  const [signals, coverage] = await Promise.all([listSignals(propertySetupId, range), getMarketSignalCoverage(propertySetupId)]);
  const byDate = Object.values(signals.reduce<Record<string, { date: string; types: Set<string>; radii: Set<number>; count: number }>>((acc, signal) => {
    const item = acc[signal.signalDate] ?? { date: signal.signalDate, types: new Set<string>(), radii: new Set<number>(), count: 0 };
    item.types.add(signal.signalType); item.radii.add(signal.radiusKm); item.count += 1; acc[signal.signalDate] = item; return acc;
  }, {})).map((item) => ({ date: item.date, signalTypes: [...item.types], radiiKm: [...item.radii].sort((a, b) => a - b), count: item.count }));
  return { coverage, signals, next7Days: byDate };
}

export async function getMarketSignalBlockers(propertySetupId: string): Promise<string[]> {
  const coverage = await getMarketSignalCoverage(propertySetupId);
  const blockers: string[] = [];
  if (!coverage.sources.length) blockers.push('Не создан источник рыночных сигналов.');
  if (coverage.coverageScore === 0) blockers.push('Нет рыночных сигналов на ближайшие 7 дней.');
  if (coverage.sources.some((source) => source.status === 'blocked')) blockers.push('Один или несколько источников заблокированы.');
  return blockers;
}

export async function explainMarketSignals(propertySetupId: string, date?: string) {
  const targetDate = date ? validDate(date) : new Date().toISOString().slice(0, 10);
  const [pressure, coverage, blockers] = await Promise.all([computeMarketPressureScore(propertySetupId, targetDate), getMarketSignalCoverage(propertySetupId), getMarketSignalBlockers(propertySetupId)]);
  return { date: targetDate, pressure, coverage, blockers, explanation: pressure.signalsUsed.length ? `Рыночное давление: ${pressure.score}/100. Использованы нормализованные сигналы по доступным радиусам.` : 'Рыночных сигналов нет; pricing продолжит расчёт по базовым ограничениям.' };
}

export async function blockMarketSignalSource(sourceId: string, reason: string, metadata?: Record<string, unknown>) {
  const safeReason = safeText(reason, 'причину', true);
  return configureMarketSignalSource(sourceId, { status: 'blocked' }, { ...safeMetadata(metadata), block_reason: safeReason });
}

export async function addMarketSignalNote(sourceId: string, note: string, metadata?: Record<string, unknown>) {
  const safeNote = safeText(note, 'заметку', true);
  return configureMarketSignalSource(sourceId, {}, { ...safeMetadata(metadata), note: safeNote });
}

export async function runMarketSignalIngestionBatch({ dryRun = true, maxBatchSize = 10 }: { dryRun?: boolean; maxBatchSize?: number }) {
  const limit = Math.max(1, Math.min(50, Math.floor(maxBatchSize)));
  const { data, error } = await supabase.from('booking_market_signal_sources').select('*').in('status', ['configured', 'active_manual', 'active_placeholder']).order('updated_at', { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  const results = [];
  for (const row of data ?? []) {
    const source = mapSource(row as Row);
    try { results.push({ sourceId: source.id, ok: true, result: await runMarketSignalIngestion(source.id, { dryRun }) }); }
    catch (error) { results.push({ sourceId: source.id, ok: false, error: error instanceof Error ? error.message : 'Ошибка запуска.' }); }
  }
  return { dryRun, processed: results.length, results, schedulerReady: true, liveCronEnabled: false };
}
