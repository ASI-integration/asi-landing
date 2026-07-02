import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getPropertySetupById } from './owner-object-setup-autopilot';
import {
  getAudienceProfile,
  getAudiencePricingWeights,
  inferPropertyAudience,
  type AudienceProfile,
} from './property-audience-intelligence';
import {
  computeMarketPressureScore,
  getAudienceRadiusWeights,
  getSignalsForPricingDate,
  ingestManualMarketSnapshot,
  validateMarketSnapshot,
} from './market-signals-ingestion';

export const PRICING_PROFILE_STATUSES = [
  'draft', 'incomplete', 'ready_for_recommendations', 'recommendations_ready',
  'auto_apply_ready', 'auto_apply_enabled', 'blocked',
] as const;

export const PRICING_STRATEGIES = [
  'balanced', 'occupancy_first', 'adr_first', 'aggressive_growth',
  'conservative', 'event_driven', 'custom',
] as const;

export const SIGNAL_TYPES = [
  'competitor_prices', 'available_supply', 'occupancy_pressure', 'event_pressure',
  'weather_pressure', 'seasonality', 'booking_pace', 'channel_snapshot',
  'manual_snapshot', 'other',
] as const;

export const SIGNAL_SOURCES = [
  'manual', 'channel_import', 'weather_provider_placeholder',
  'events_provider_placeholder', 'market_provider_placeholder', 'internal',
] as const;

export const ALLOWED_RADIUS_KM = [1, 3, 7, 10] as const;
export const TARIFF_GRID_DAYS_OPTIONS = [30, 60, 90, 180] as const;

export type PricingProfileStatus = (typeof PRICING_PROFILE_STATUSES)[number];
export type PricingStrategy = (typeof PRICING_STRATEGIES)[number];
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type TariffGridDayStatus = 'draft' | 'recommended' | 'approved' | 'auto_applied_placeholder' | 'blocked';

export type PricingProfile = {
  id: string;
  propertySetupId: string | null;
  propertyId: string | null;
  connectionId: string | null;
  status: PricingProfileStatus;
  pricingStrategy: PricingStrategy;
  basePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  cleaningFee: number | null;
  depositAmount: number | null;
  currency: string;
  minStayDefault: number | null;
  maxStayDefault: number | null;
  readinessScore: number;
  missingFields: string[];
  guardrails: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  autoApplyIsPlaceholder: true;
};

export type MarketSignal = {
  id: string;
  propertySetupId: string | null;
  propertyId: string | null;
  signalDate: string;
  radiusKm: number;
  signalType: SignalType;
  source: string;
  value: Record<string, unknown>;
  confidenceScore: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TariffGridDay = {
  id: string;
  pricingProfileId: string;
  date: string;
  basePrice: number | null;
  recommendedPrice: number | null;
  finalPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minStay: number | null;
  demandScore: number;
  supplyScore: number;
  eventScore: number;
  weatherScore: number;
  audienceScore: number;
  adjustmentReason: AdjustmentReason[];
  status: TariffGridDayStatus;
  createdAt: string;
  updatedAt: string;
};

export type AdjustmentReason = {
  factor: string;
  direction: 'up' | 'down' | 'neutral';
  percent: number;
  explanation: string;
};

export type RecommendationRun = {
  id: string;
  pricingProfileId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  strategy: PricingStrategy;
  signalsUsed: string[];
  warnings: string[];
  errors: string[];
  safeSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualMarketSnapshot = {
  radius_km: number;
  date: string;
  competitor_prices?: { median?: number; p25?: number; p75?: number; min?: number; max?: number; count?: number; confidence_score?: number };
  available_supply?: { available_count?: number; total_count?: number; availability_ratio?: number; booked_count?: number; confidence_score?: number };
  events?: Array<{ name?: string; type?: string; date?: string; distance_km?: number; expected_impact?: string; confidence_score?: number }>;
  weather?: { date?: string; condition?: string; temperature_c?: number; precipitation_probability?: number; impact?: string; confidence_score?: number };
};

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_SNAPSHOT_BYTES = 32_768;
const FORBIDDEN_KEY_RE = /(?:password|passwd|парол|token|secret|credential|guest|payment|passport)/iu;

function text(value: unknown): string { return String(value ?? '').trim(); }
function nullableNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }

export function assertPricingUuid(value: unknown, label = 'ID'): string {
  const id = text(value);
  if (!UUID_RE.test(id)) throw new Error(`${label} указан неверно.`);
  return id;
}

export function assertAllowedRadius(radiusKm: unknown): number {
  const radius = Number(radiusKm);
  if (!ALLOWED_RADIUS_KM.includes(radius as typeof ALLOWED_RADIUS_KM[number])) {
    throw new Error('Радиус должен быть 1, 3, 7 или 10 км.');
  }
  return radius;
}

function assertSafePayload(value: unknown, path = 'payload'): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_SNAPSHOT_BYTES) throw new Error('Слишком большой объём данных.');
  if (FORBIDDEN_KEY_RE.test(serialized)) throw new Error('Недопустимые данные в снимке рынка.');
}

function safeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  const value = metadata ?? {};
  assertSafePayload(value);
  return value;
}

function mapPricingProfile(row: Row): PricingProfile {
  return {
    id: text(row.id),
    propertySetupId: text(row.property_setup_id) || null,
    propertyId: text(row.property_id) || null,
    connectionId: text(row.connection_id) || null,
    status: text(row.status) as PricingProfileStatus,
    pricingStrategy: text(row.pricing_strategy) as PricingStrategy,
    basePrice: nullableNumber(row.base_price),
    minPrice: nullableNumber(row.min_price),
    maxPrice: nullableNumber(row.max_price),
    cleaningFee: nullableNumber(row.cleaning_fee),
    depositAmount: nullableNumber(row.deposit_amount),
    currency: text(row.currency) || 'RUB',
    minStayDefault: nullableNumber(row.min_stay_default),
    maxStayDefault: nullableNumber(row.max_stay_default),
    readinessScore: Number(row.readiness_score ?? 0),
    missingFields: strings(row.missing_fields),
    guardrails: object(row.guardrails),
    metadata: object(row.metadata),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    autoApplyIsPlaceholder: true,
  };
}

function mapMarketSignal(row: Row): MarketSignal {
  return {
    id: text(row.id),
    propertySetupId: text(row.property_setup_id) || null,
    propertyId: text(row.property_id) || null,
    signalDate: text(row.signal_date),
    radiusKm: Number(row.radius_km),
    signalType: text(row.signal_type) as SignalType,
    source: text(row.source),
    value: object(row.value),
    confidenceScore: Number(row.confidence_score ?? 50),
    metadata: object(row.metadata),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapTariffGridDay(row: Row): TariffGridDay {
  return {
    id: text(row.id),
    pricingProfileId: text(row.pricing_profile_id),
    date: text(row.date),
    basePrice: nullableNumber(row.base_price),
    recommendedPrice: nullableNumber(row.recommended_price),
    finalPrice: nullableNumber(row.final_price),
    minPrice: nullableNumber(row.min_price),
    maxPrice: nullableNumber(row.max_price),
    minStay: nullableNumber(row.min_stay),
    demandScore: Number(row.demand_score ?? 50),
    supplyScore: Number(row.supply_score ?? 50),
    eventScore: Number(row.event_score ?? 50),
    weatherScore: Number(row.weather_score ?? 50),
    audienceScore: Number(row.audience_score ?? 50),
    adjustmentReason: Array.isArray(row.adjustment_reason) ? row.adjustment_reason as AdjustmentReason[] : [],
    status: text(row.status) as TariffGridDayStatus,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapRecommendationRun(row: Row): RecommendationRun {
  return {
    id: text(row.id),
    pricingProfileId: text(row.pricing_profile_id),
    status: text(row.status),
    dateFrom: text(row.date_from),
    dateTo: text(row.date_to),
    strategy: text(row.strategy) as PricingStrategy,
    signalsUsed: strings(row.signals_used),
    warnings: strings(row.warnings),
    errors: strings(row.errors),
    safeSummary: text(row.safe_summary) || null,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function computeMissingFields(profile: Partial<PricingProfile>): string[] {
  const missing: string[] = [];
  if (!profile.basePrice) missing.push('base_price');
  if (!profile.minPrice) missing.push('min_price');
  if (!profile.maxPrice) missing.push('max_price');
  if (!profile.pricingStrategy) missing.push('pricing_strategy');
  return missing;
}

function computeReadinessScore(missing: string[]): number {
  const total = 4;
  return Math.round((total - missing.length) / total * 100);
}

function deriveStatus(missing: string[], current: PricingProfileStatus): PricingProfileStatus {
  if (current === 'blocked' || current === 'auto_apply_enabled' || current === 'auto_apply_ready' || current === 'recommendations_ready') {
    return current;
  }
  if (missing.length) return 'incomplete';
  return 'ready_for_recommendations';
}

async function getPricingProfileRow(id: string): Promise<Row> {
  const { data, error } = await supabase.from('booking_pricing_profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Профиль ценообразования не найден.');
  return data as Row;
}

export async function getPricingProfileBySetup(propertySetupId: string): Promise<PricingProfile | null> {
  const setupId = assertPricingUuid(propertySetupId, 'propertySetupId');
  const { data, error } = await supabase
    .from('booking_pricing_profiles')
    .select('*')
    .eq('property_setup_id', setupId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapPricingProfile(data as Row) : null;
}

export async function getPricingProfile(pricingProfileId: string): Promise<PricingProfile> {
  const row = await getPricingProfileRow(assertPricingUuid(pricingProfileId));
  return mapPricingProfile(row);
}

export async function listPricingProfiles(propertySetupId?: string): Promise<PricingProfile[]> {
  let query = supabase.from('booking_pricing_profiles').select('*').order('updated_at', { ascending: false }).limit(50);
  if (propertySetupId) query = query.eq('property_setup_id', assertPricingUuid(propertySetupId));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapPricingProfile(row as Row));
}

export async function initializePricingProfile(propertySetupId: string, metadata?: Record<string, unknown>): Promise<PricingProfile> {
  const setupId = assertPricingUuid(propertySetupId, 'propertySetupId');
  const existing = await getPricingProfileBySetup(setupId);
  if (existing) return existing;

  const setup = await getPropertySetupById(setupId);
  if (!setup) throw new Error('Профиль объекта не найден.');

  const setupMeta = object(setup.metadata);
  const baseFromLabel = parseBasePriceFromLabel(text(setupMeta.base_price_label));
  const now = new Date().toISOString();
  const id = randomUUID();

  const draft: Partial<PricingProfile> = {
    basePrice: baseFromLabel,
    minPrice: baseFromLabel ? Math.round(baseFromLabel * 0.7) : null,
    maxPrice: baseFromLabel ? Math.round(baseFromLabel * 1.8) : null,
    pricingStrategy: 'balanced',
  };
  const missing = computeMissingFields(draft);

  const { data, error } = await supabase.from('booking_pricing_profiles').insert({
    id,
    property_setup_id: setupId,
    property_id: setup.propertyId,
    status: deriveStatus(missing, 'draft'),
    pricing_strategy: 'balanced',
    base_price: draft.basePrice,
    min_price: draft.minPrice,
    max_price: draft.maxPrice,
    currency: 'RUB',
    readiness_score: computeReadinessScore(missing),
    missing_fields: missing,
    guardrails: {},
    metadata: { ...safeMetadata(metadata), initialized_at: now, auto_apply_is_placeholder: true },
    created_at: now,
    updated_at: now,
  }).select('*').single();

  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать профиль ценообразования.');
  return mapPricingProfile(data as Row);
}

function parseBasePriceFromLabel(label: string): number | null {
  const match = label.replace(/\s/g, '').match(/(\d[\d\s]*)/u);
  if (!match) return null;
  const num = Number(match[1].replace(/\s/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

export async function updatePricingGuardrails(
  pricingProfileId: string,
  guardrails: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Promise<PricingProfile> {
  const id = assertPricingUuid(pricingProfileId);
  const profile = await getPricingProfile(id);
  assertSafePayload(guardrails);

  const updates: Row = {
    guardrails: { ...profile.guardrails, ...guardrails },
    metadata: { ...profile.metadata, ...safeMetadata(metadata) },
    updated_at: new Date().toISOString(),
  };

  if ('base_price' in guardrails) updates.base_price = nullableNumber(guardrails.base_price);
  if ('min_price' in guardrails) updates.min_price = nullableNumber(guardrails.min_price);
  if ('max_price' in guardrails) updates.max_price = nullableNumber(guardrails.max_price);
  if (guardrails.pricing_strategy != null) {
    const strategy = text(guardrails.pricing_strategy);
    if (!(PRICING_STRATEGIES as readonly string[]).includes(strategy)) throw new Error('Недопустимая стратегия.');
    updates.pricing_strategy = strategy;
  }
  if (guardrails.cleaning_fee != null) updates.cleaning_fee = nullableNumber(guardrails.cleaning_fee);
  if (guardrails.deposit_amount != null) updates.deposit_amount = nullableNumber(guardrails.deposit_amount);
  if (guardrails.min_stay_default != null) updates.min_stay_default = nullableNumber(guardrails.min_stay_default);

  const merged = { ...profile, ...updates };
  const missing = computeMissingFields({
    basePrice: nullableNumber(updates.base_price ?? profile.basePrice),
    minPrice: nullableNumber(updates.min_price ?? profile.minPrice),
    maxPrice: nullableNumber(updates.max_price ?? profile.maxPrice),
    pricingStrategy: text(updates.pricing_strategy ?? profile.pricingStrategy) as PricingStrategy,
  });
  updates.missing_fields = missing;
  updates.readiness_score = computeReadinessScore(missing);
  updates.status = deriveStatus(missing, profile.status);

  const { data, error } = await supabase.from('booking_pricing_profiles').update(updates).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить ограничения.');
  return mapPricingProfile(data as Row);
}

export function validateManualMarketSnapshot(snapshot: unknown): ManualMarketSnapshot {
  return validateMarketSnapshot(snapshot) as ManualMarketSnapshot;
}

export async function ingestMarketSignals(
  propertySetupId: string,
  signals: ManualMarketSnapshot | ManualMarketSnapshot[],
  metadata?: Record<string, unknown>,
): Promise<MarketSignal[]> {
  const result = await ingestManualMarketSnapshot(propertySetupId, signals, metadata);
  return result.signals as MarketSignal[];
}

export async function getMarketSignals(
  propertySetupId: string,
  dateRange: { from: string; to: string },
  radiusKm?: number,
): Promise<MarketSignal[]> {
  const setupId = assertPricingUuid(propertySetupId, 'propertySetupId');
  let query = supabase
    .from('booking_pricing_market_signals')
    .select('*')
    .eq('property_setup_id', setupId)
    .gte('signal_date', dateRange.from)
    .lte('signal_date', dateRange.to)
    .order('signal_date', { ascending: true });
  if (radiusKm != null) query = query.eq('radius_km', assertAllowedRadius(radiusKm));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapMarketSignal(row as Row));
}

async function signalsForDate(propertySetupId: string, date: string, radiusKm = 3): Promise<MarketSignal[]> {
  const { data, error } = await supabase
    .from('booking_pricing_market_signals')
    .select('*')
    .eq('property_setup_id', propertySetupId)
    .eq('signal_date', date)
    .eq('radius_km', radiusKm);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapMarketSignal(row as Row));
}

export async function computeDemandScore(propertySetupId: string, date: string, options?: { radiusKm?: number }): Promise<number> {
  const signals = await signalsForDate(propertySetupId, date, options?.radiusKm ?? 3);
  let score = 50;
  const supply = signals.find((s) => s.signalType === 'available_supply');
  if (supply?.value) {
    const ratio = Number(supply.value.availability_ratio ?? 0);
    if (ratio < 0.2) score += 25;
    else if (ratio < 0.4) score += 15;
    else if (ratio > 0.7) score -= 15;
  }
  const competitor = signals.find((s) => s.signalType === 'competitor_prices');
  if (competitor?.value?.median) score += 5;
  const day = new Date(date).getDay();
  if (day === 5 || day === 6) score += 10;
  return Math.max(0, Math.min(100, score));
}

export async function computeSupplyScore(propertySetupId: string, date: string, options?: { radiusKm?: number }): Promise<number> {
  const signals = await signalsForDate(propertySetupId, date, options?.radiusKm ?? 3);
  const supply = signals.find((s) => s.signalType === 'available_supply');
  if (!supply?.value) return 50;
  const ratio = Number(supply.value.availability_ratio ?? 0.5);
  return Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));
}

export async function computeEventScore(propertySetupId: string, date: string, options?: { radiusKm?: number }): Promise<number> {
  const signals = await signalsForDate(propertySetupId, date, options?.radiusKm ?? 3);
  const eventSignal = signals.find((s) => s.signalType === 'event_pressure');
  if (!eventSignal?.value?.events) return 50;
  const events = eventSignal.value.events as Array<{ expected_impact?: string }>;
  let score = 50;
  for (const event of events) {
    const impact = text(event.expected_impact).toLowerCase();
    if (impact === 'high') score += 25;
    else if (impact === 'medium') score += 12;
    else if (impact === 'low') score += 5;
  }
  return Math.max(0, Math.min(100, score));
}

export async function computeWeatherScore(propertySetupId: string, date: string, options?: { radiusKm?: number }): Promise<number> {
  const signals = await signalsForDate(propertySetupId, date, options?.radiusKm ?? 3);
  const weather = signals.find((s) => s.signalType === 'weather_pressure');
  if (!weather?.value) return 50;
  const impact = text(weather.value.impact).toLowerCase();
  if (impact.includes('high_negative')) return 25;
  if (impact.includes('medium_negative')) return 40;
  if (impact.includes('positive')) return 70;
  return 50;
}

export async function computeAudienceScore(
  propertySetupId: string,
  date: string,
  audienceProfile?: AudienceProfile | null,
): Promise<number> {
  const profile = audienceProfile ?? await getAudienceProfile(propertySetupId);
  if (!profile) return 50;
  const weights = getAudiencePricingWeights(profile);
  const day = new Date(date).getDay();
  const isWeekend = day === 0 || day === 6;
  let score = 50 + (profile.confidenceScore - 50) * 0.3;
  if (isWeekend) score += 10 * weights.weekendWeight;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const STRATEGY_MULTIPLIERS: Record<PricingStrategy, number> = {
  balanced: 1,
  occupancy_first: 0.95,
  adr_first: 1.08,
  aggressive_growth: 1.12,
  conservative: 0.92,
  event_driven: 1.05,
  custom: 1,
};

function seasonalityFactor(date: string): { factor: number; reason: AdjustmentReason } {
  const month = new Date(date).getMonth() + 1;
  if (month >= 6 && month <= 8) return { factor: 1.12, reason: { factor: 'seasonality', direction: 'up', percent: 12, explanation: 'Летний сезон' } };
  if (month === 12 || month <= 2) return { factor: 0.95, reason: { factor: 'seasonality', direction: 'down', percent: 5, explanation: 'Зимний период' } };
  return { factor: 1, reason: { factor: 'seasonality', direction: 'neutral', percent: 0, explanation: 'Межсезонье' } };
}

function dayOfWeekFactor(date: string): { factor: number; reason: AdjustmentReason } {
  const day = new Date(date).getDay();
  if (day === 6 || day === 0) return { factor: 1.08, reason: { factor: 'day_of_week', direction: 'up', percent: 8, explanation: 'Выходные' } };
  if (day === 5) return { factor: 1.04, reason: { factor: 'day_of_week', direction: 'up', percent: 4, explanation: 'Пятница' } };
  return { factor: 1, reason: { factor: 'day_of_week', direction: 'neutral', percent: 0, explanation: 'Будний день' } };
}

function leadTimeFactor(date: string): { factor: number; reason: AdjustmentReason } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days <= 3) return { factor: 1.08, reason: { factor: 'lead_time', direction: 'up', percent: 8, explanation: 'Близкая дата (≤3 дней)' } };
  if (days <= 7) return { factor: 1.05, reason: { factor: 'lead_time', direction: 'up', percent: 5, explanation: 'Близкая дата (≤7 дней)' } };
  return { factor: 1, reason: { factor: 'lead_time', direction: 'neutral', percent: 0, explanation: 'Достаточный запас по дате' } };
}

function weightedSignalValue(signals: MarketSignal[], signalType: SignalType, key: string, radiusWeights: Record<number, number>): number | null {
  const matches = signals.filter((signal) => signal.signalType === signalType && Number.isFinite(Number(signal.value[key])));
  if (!matches.length) return null;
  let weighted = 0; let total = 0;
  for (const signal of matches) {
    const weight = (radiusWeights[signal.radiusKm] ?? 0.5) * signal.confidenceScore / 100;
    weighted += Number(signal.value[key]) * weight; total += weight;
  }
  return total ? weighted / total : null;
}

function competitorFactor(basePrice: number, signals: MarketSignal[], radiusWeights: Record<number, number>): { factor: number; reason: AdjustmentReason } {
  const medianValue = weightedSignalValue(signals, 'competitor_prices', 'median', radiusWeights);
  if (medianValue == null) return { factor: 1, reason: { factor: 'competitor', direction: 'neutral', percent: 0, explanation: 'Нет данных конкурентов' } };
  const median = Math.round(medianValue);
  const delta = (median - basePrice) / basePrice;
  const capped = Math.max(-0.15, Math.min(0.15, delta * 0.5));
  return {
    factor: 1 + capped,
    reason: {
      factor: 'competitor',
      direction: capped > 0 ? 'up' : capped < 0 ? 'down' : 'neutral',
      percent: Math.round(capped * 100),
      explanation: `Взвешенная медиана конкурентов ${median} ₽`,
    },
  };
}

function supplyFactor(signals: MarketSignal[], radiusWeights: Record<number, number>): { factor: number; reason: AdjustmentReason } {
  const ratio = weightedSignalValue(signals, 'available_supply', 'availability_ratio', radiusWeights);
  if (ratio == null) return { factor: 1, reason: { factor: 'supply', direction: 'neutral', percent: 0, explanation: 'Нет данных о предложении' } };
  if (ratio < 0.25) return { factor: 1.1, reason: { factor: 'supply', direction: 'up', percent: 10, explanation: 'Низкая доступность на рынке' } };
  if (ratio > 0.65) return { factor: 0.95, reason: { factor: 'supply', direction: 'down', percent: 5, explanation: 'Высокая доступность на рынке' } };
  return { factor: 1, reason: { factor: 'supply', direction: 'neutral', percent: 0, explanation: 'Средняя доступность' } };
}

function eventFactor(signals: MarketSignal[], eventWeight: number): { factor: number; reason: AdjustmentReason } {
  const events = signals.filter((s) => s.signalType === 'event_pressure').flatMap((signal) => Array.isArray(signal.value.events) ? signal.value.events as Array<{ name?: string; expected_impact?: string }> : []);
  if (!events.length) return { factor: 1, reason: { factor: 'events', direction: 'neutral', percent: 0, explanation: 'Нет событий' } };
  const hasHigh = events.some((e) => text(e.expected_impact).toLowerCase() === 'high');
  if (hasHigh) {
    const pct = Math.round(20 * eventWeight);
    return { factor: 1 + pct / 100, reason: { factor: 'events', direction: 'up', percent: pct, explanation: `Событие: ${text(events[0]?.name) || 'высокое влияние'}` } };
  }
  return { factor: 1, reason: { factor: 'events', direction: 'neutral', percent: 0, explanation: 'События без сильного влияния' } };
}

function weatherFactor(signals: MarketSignal[], weatherWeight: number): { factor: number; reason: AdjustmentReason } {
  const weather = signals.filter((s) => s.signalType === 'weather_pressure').sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  if (!weather?.value) return { factor: 1, reason: { factor: 'weather', direction: 'neutral', percent: 0, explanation: 'Нет данных о погоде' } };
  const impact = text(weather.value.impact).toLowerCase();
  if (impact.includes('negative')) {
    const pct = Math.round(8 * weatherWeight);
    return { factor: 1 - pct / 100, reason: { factor: 'weather', direction: 'down', percent: pct, explanation: `Погода: ${text(weather.value.condition) || 'негатив'}` } };
  }
  return { factor: 1, reason: { factor: 'weather', direction: 'neutral', percent: 0, explanation: 'Погода нейтральна' } };
}

export async function recommendPriceForDate(
  pricingProfileId: string,
  date: string,
  options?: { radiusKm?: number; audienceProfile?: AudienceProfile | null },
): Promise<{ recommendedPrice: number; reasons: AdjustmentReason[]; scores: Pick<TariffGridDay, 'demandScore' | 'supplyScore' | 'eventScore' | 'weatherScore' | 'audienceScore'>; signalsUsed: string[]; missingSignals: string[] }> {
  const profile = await getPricingProfile(pricingProfileId);
  if (!profile.basePrice) throw new Error('Укажите базовую цену.');

  const setupId = profile.propertySetupId;
  if (!setupId) throw new Error('Профиль не привязан к объекту.');

  const audience = options?.audienceProfile ?? await getAudienceProfile(setupId);
  const weights = getAudiencePricingWeights(audience);
  const signals = (await getSignalsForPricingDate(setupId, date, options?.radiusKm)) as MarketSignal[];
  const primaryAudience = audience?.primaryAudience ?? 'unknown';
  const competitorRadiusWeights = getAudienceRadiusWeights(primaryAudience, 'competitor_prices');
  const supplyRadiusWeights = getAudienceRadiusWeights(primaryAudience, 'available_supply');

  const reasons: AdjustmentReason[] = [];
  let price = profile.basePrice;

  const dow = dayOfWeekFactor(date);
  price *= dow.factor * (dow.factor !== 1 ? weights.weekendWeight : 1);
  reasons.push(dow.reason);

  const season = seasonalityFactor(date);
  price *= season.factor * (season.factor !== 1 ? weights.seasonalityWeight : 1);
  reasons.push(season.reason);

  const lead = leadTimeFactor(date);
  price *= lead.factor * (lead.factor !== 1 ? weights.leadTimeWeight : 1);
  reasons.push(lead.reason);

  const comp = competitorFactor(profile.basePrice, signals, competitorRadiusWeights);
  price *= 1 + (comp.factor - 1) * weights.competitorWeight;
  reasons.push(comp.reason);

  const sup = supplyFactor(signals, supplyRadiusWeights);
  price *= 1 + (sup.factor - 1) * weights.supplyWeight;
  reasons.push(sup.reason);

  const evt = eventFactor(signals, weights.eventWeight);
  price *= evt.factor;
  reasons.push(evt.reason);

  const wth = weatherFactor(signals, weights.weatherWeight);
  price *= wth.factor;
  reasons.push(wth.reason);

  const strategyMult = STRATEGY_MULTIPLIERS[profile.pricingStrategy] ?? 1;
  if (strategyMult !== 1) {
    const pct = Math.round((strategyMult - 1) * 100);
    price *= strategyMult;
    reasons.push({ factor: 'strategy', direction: pct > 0 ? 'up' : 'down', percent: Math.abs(pct), explanation: `Стратегия: ${profile.pricingStrategy}` });
  }

  const minP = profile.minPrice ?? profile.basePrice * 0.5;
  const maxP = profile.maxPrice ?? profile.basePrice * 2;
  const raw = Math.round(price / 50) * 50;
  const clamped = Math.max(minP, Math.min(maxP, raw));
  if (clamped !== raw) {
    reasons.push({ factor: 'guardrails', direction: clamped < raw ? 'down' : 'up', percent: Math.round(Math.abs(clamped - raw) / profile.basePrice * 100), explanation: `Ограничено: ${minP}–${maxP} ₽` });
  }

  const [pressure, audienceScore] = await Promise.all([
    computeMarketPressureScore(setupId, date, { audience: primaryAudience }),
    computeAudienceScore(setupId, date, audience),
  ]);
  const signalsUsed = [...new Set(signals.map((signal) => signal.signalType))];
  const requiredSignals = ['competitor_prices', 'available_supply', 'event_pressure', 'weather_pressure'];
  const missingSignals = requiredSignals.filter((signal) => !signalsUsed.includes(signal as SignalType));
  return {
    recommendedPrice: clamped,
    reasons,
    scores: {
      demandScore: pressure.score,
      supplyScore: pressure.components.available_supply ?? 50,
      eventScore: pressure.components.event_pressure ?? 50,
      weatherScore: pressure.components.weather_pressure ?? 50,
      audienceScore,
    },
    signalsUsed,
    missingSignals,
  };
}

function dateRange(from: string, days: number): string[] {
  const dates: string[] = [];
  const start = new Date(from);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export async function generateTariffGrid(
  pricingProfileId: string,
  dateFrom: string,
  dateTo: string,
  options?: { radiusKm?: number },
): Promise<TariffGridDay[]> {
  const profile = await getPricingProfile(pricingProfileId);
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 180) throw new Error('Диапазон должен быть от 1 до 180 дней.');

  const setupId = profile.propertySetupId;
  const audience = setupId ? await getAudienceProfile(setupId) : null;
  const now = new Date().toISOString();
  const results: TariffGridDay[] = [];

  for (const date of dateRange(dateFrom, days)) {
    const { recommendedPrice, reasons, scores } = await recommendPriceForDate(pricingProfileId, date, { ...options, audienceProfile: audience });
    const row = {
      id: randomUUID(),
      pricing_profile_id: pricingProfileId,
      date,
      base_price: profile.basePrice,
      recommended_price: recommendedPrice,
      final_price: recommendedPrice,
      min_price: profile.minPrice,
      max_price: profile.maxPrice,
      min_stay: profile.minStayDefault,
      demand_score: scores.demandScore,
      supply_score: scores.supplyScore,
      event_score: scores.eventScore,
      weather_score: scores.weatherScore,
      audience_score: scores.audienceScore,
      adjustment_reason: reasons,
      status: 'recommended',
      created_at: now,
      updated_at: now,
    };
    results.push(mapTariffGridDay(row));
  }

  const { error } = await supabase.from('booking_tariff_grid_days').upsert(
    results.map((day) => ({
      id: day.id,
      pricing_profile_id: day.pricingProfileId,
      date: day.date,
      base_price: day.basePrice,
      recommended_price: day.recommendedPrice,
      final_price: day.finalPrice,
      min_price: day.minPrice,
      max_price: day.maxPrice,
      min_stay: day.minStay,
      demand_score: day.demandScore,
      supply_score: day.supplyScore,
      event_score: day.eventScore,
      weather_score: day.weatherScore,
      audience_score: day.audienceScore,
      adjustment_reason: day.adjustmentReason,
      status: day.status,
      created_at: day.createdAt,
      updated_at: day.updatedAt,
    })),
    { onConflict: 'pricing_profile_id,date' },
  );
  if (error) throw new Error(error.message);
  return results;
}

export async function runPricingRecommendation(
  pricingProfileId: string,
  dateFrom: string,
  dateTo: string,
  options?: { dryRun?: boolean; radiusKm?: number },
): Promise<RecommendationRun> {
  const profile = await getPricingProfile(pricingProfileId);
  const now = new Date().toISOString();
  const runId = randomUUID();
  const warnings: string[] = [];
  const errors: string[] = [];
  const signalsUsed: string[] = [];

  if (profile.missingFields.length) warnings.push(`Не заполнено: ${profile.missingFields.join(', ')}`);

  const setupId = profile.propertySetupId;
  if (setupId) {
    const signals = await getMarketSignals(setupId, { from: dateFrom, to: dateTo }, options?.radiusKm);
    if (!signals.length) warnings.push('Нет рыночных сигналов — рекомендации основаны на базовых правилах.');
    signalsUsed.push(...[...new Set(signals.map((s) => s.signalType))]);
    for (const type of ['competitor_prices', 'available_supply', 'event_pressure', 'weather_pressure']) {
      if (!signalsUsed.includes(type)) warnings.push(`Нет сигнала «${type}» — применены базовые правила.`);
    }
  }

  let status = 'running';
  const { data: runRow, error: insertError } = await supabase.from('booking_pricing_recommendation_runs').insert({
    id: runId,
    pricing_profile_id: pricingProfileId,
    status: 'running',
    date_from: dateFrom,
    date_to: dateTo,
    strategy: profile.pricingStrategy,
    signals_used: signalsUsed,
    warnings,
    errors,
    created_at: now,
    updated_at: now,
  }).select('*').single();
  if (insertError) throw new Error(insertError.message);

  try {
    if (!options?.dryRun) await generateTariffGrid(pricingProfileId, dateFrom, dateTo, options);
    status = warnings.length ? 'completed_with_warnings' : 'completed';
  } catch (err) {
    status = 'failed';
    errors.push(err instanceof Error ? err.message : 'Ошибка расчёта');
  }

  const safeSummary = status === 'failed'
    ? 'Расчёт рекомендаций не выполнен.'
    : options?.dryRun
      ? 'Пробный расчёт без сохранения сетки.'
      : `Рекомендации рассчитаны с ${dateFrom} по ${dateTo}. Это не публикация цен в OTA.`;

  const { data, error } = await supabase.from('booking_pricing_recommendation_runs').update({
    status: options?.dryRun ? 'dry_run' : status,
    warnings,
    errors,
    safe_summary: safeSummary,
    updated_at: new Date().toISOString(),
  }).eq('id', runId).select('*').single();
  if (error) throw new Error(error.message);

  if (!options?.dryRun && status.startsWith('completed')) {
    await supabase.from('booking_pricing_profiles').update({
      status: 'recommendations_ready',
      metadata: { ...profile.metadata, last_recommendation_run_id: runId },
      updated_at: new Date().toISOString(),
    }).eq('id', pricingProfileId);
  }

  return mapRecommendationRun((data ?? runRow) as Row);
}

export async function getTariffGrid(pricingProfileId: string, limit = 90): Promise<TariffGridDay[]> {
  const { data, error } = await supabase
    .from('booking_tariff_grid_days')
    .select('*')
    .eq('pricing_profile_id', assertPricingUuid(pricingProfileId))
    .order('date', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapTariffGridDay(row as Row));
}

export async function getLatestRecommendationRun(pricingProfileId: string): Promise<RecommendationRun | null> {
  const { data, error } = await supabase
    .from('booking_pricing_recommendation_runs')
    .select('*')
    .eq('pricing_profile_id', assertPricingUuid(pricingProfileId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRecommendationRun(data as Row) : null;
}

export async function getPricingReadiness(ref: string): Promise<{ readinessScore: number; missingFields: string[]; status: PricingProfileStatus; profile: PricingProfile | null }> {
  let profile: PricingProfile | null;
  if (UUID_RE.test(ref) && ref.includes('-')) {
    try {
      profile = await getPricingProfileBySetup(ref);
      if (!profile) profile = await getPricingProfile(ref).catch(() => null);
    } catch {
      profile = await getPricingProfileBySetup(ref);
    }
  } else {
    profile = await getPricingProfileBySetup(ref);
  }
  if (!profile) return { readinessScore: 0, missingFields: ['pricing_profile'], status: 'draft', profile: null };
  return { readinessScore: profile.readinessScore, missingFields: profile.missingFields, status: profile.status, profile };
}

export async function getPricingBlockers(ref: string): Promise<string[]> {
  const { profile, missingFields } = await getPricingReadiness(ref);
  const blockers = [...missingFields];
  if (!profile) blockers.push('Инициализируйте профиль ценообразования.');
  if (profile?.status === 'blocked') blockers.push('Ценообразование заблокировано.');
  return blockers;
}

export async function buildPricingSnapshotForPublicationPackage(propertySetupId: string): Promise<Record<string, unknown>> {
  const profile = await getPricingProfileBySetup(propertySetupId);
  const audience = await getAudienceProfile(propertySetupId);
  const grid = profile ? await getTariffGrid(profile.id, 7) : [];

  return {
    pricing_readiness_score: profile?.readinessScore ?? 0,
    pricing_status: profile?.status ?? 'missing',
    pricing_strategy: profile?.pricingStrategy ?? null,
    base_price: profile?.basePrice ?? null,
    min_price: profile?.minPrice ?? null,
    max_price: profile?.maxPrice ?? null,
    currency: profile?.currency ?? 'RUB',
    primary_audience: audience?.primaryAudience ?? 'unknown',
    audience_confidence: audience?.confidenceScore ?? 0,
    tariff_grid_snapshot: grid.map((day) => ({
      date: day.date,
      recommended_price: day.recommendedPrice,
      final_price: day.finalPrice,
      status: day.status,
    })),
    auto_apply_is_placeholder: true,
    warnings: profile?.missingFields.length ? [`Не заполнено: ${profile.missingFields.join(', ')}`] : [],
    honest_label: 'Рекомендации ценообразования — не live-цены в OTA.',
  };
}

export async function markPricingRecommendationsReady(pricingProfileId: string, metadata?: Record<string, unknown>): Promise<PricingProfile> {
  const profile = await getPricingProfile(pricingProfileId);
  if (profile.missingFields.length) throw new Error('Заполните обязательные поля перед отметкой готовности.');
  const { data, error } = await supabase.from('booking_pricing_profiles').update({
    status: 'recommendations_ready',
    metadata: { ...profile.metadata, ...safeMetadata(metadata), recommendations_ready_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq('id', pricingProfileId).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить статус.');
  return mapPricingProfile(data as Row);
}

export async function markPricingAutoApplyReady(pricingProfileId: string, metadata?: Record<string, unknown>): Promise<PricingProfile> {
  const profile = await getPricingProfile(pricingProfileId);
  if (profile.status !== 'recommendations_ready') throw new Error('Сначала отметьте рекомендации готовыми.');
  const { data, error } = await supabase.from('booking_pricing_profiles').update({
    status: 'auto_apply_ready',
    metadata: { ...profile.metadata, ...safeMetadata(metadata), auto_apply_ready_at: new Date().toISOString(), auto_apply_is_placeholder: true },
    updated_at: new Date().toISOString(),
  }).eq('id', pricingProfileId).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить статус.');
  return mapPricingProfile(data as Row);
}

export async function markPricingAutoApplyEnabledPlaceholder(pricingProfileId: string, metadata?: Record<string, unknown>): Promise<PricingProfile> {
  const profile = await getPricingProfile(pricingProfileId);
  if (profile.status !== 'auto_apply_ready') throw new Error('Сначала отметьте готовность к пилотному авто-применению.');
  const { data, error } = await supabase.from('booking_pricing_profiles').update({
    status: 'auto_apply_enabled',
    metadata: {
      ...profile.metadata,
      ...safeMetadata(metadata),
      auto_apply_enabled_at: new Date().toISOString(),
      auto_apply_is_placeholder: true,
      honest_notice: 'Пилотное авто-применение — не live-пуш цен в OTA.',
    },
    updated_at: new Date().toISOString(),
  }).eq('id', pricingProfileId).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить статус.');
  return mapPricingProfile(data as Row);
}

export async function blockPricing(pricingProfileId: string, reason: string, metadata?: Record<string, unknown>): Promise<PricingProfile> {
  const profile = await getPricingProfile(pricingProfileId);
  const { data, error } = await supabase.from('booking_pricing_profiles').update({
    status: 'blocked',
    metadata: { ...profile.metadata, ...safeMetadata(metadata), blocked_reason: text(reason) || 'Заблокировано оператором' },
    updated_at: new Date().toISOString(),
  }).eq('id', pricingProfileId).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось заблокировать.');
  return mapPricingProfile(data as Row);
}

export async function addPricingNote(pricingProfileId: string, note: string, metadata?: Record<string, unknown>): Promise<PricingProfile> {
  const profile = await getPricingProfile(pricingProfileId);
  const notes = Array.isArray(profile.metadata.notes) ? profile.metadata.notes as Array<Record<string, unknown>> : [];
  const { data, error } = await supabase.from('booking_pricing_profiles').update({
    metadata: {
      ...profile.metadata,
      ...safeMetadata(metadata),
      notes: [...notes, { text: text(note), created_at: new Date().toISOString() }].slice(-20),
    },
    updated_at: new Date().toISOString(),
  }).eq('id', pricingProfileId).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось добавить заметку.');
  return mapPricingProfile(data as Row);
}

export { inferPropertyAudience };
