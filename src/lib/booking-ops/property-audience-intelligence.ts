import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getPropertySetupById } from './owner-object-setup-autopilot';

export const PRIMARY_AUDIENCES = [
  'leisure_seaside', 'business_center', 'family_vacation', 'medical_travel',
  'event_visitors', 'students', 'nightlife', 'transit', 'remote_work',
  'budget', 'premium', 'mixed', 'unknown',
] as const;

export type PrimaryAudience = (typeof PRIMARY_AUDIENCES)[number];

export type AudienceProfile = {
  id: string;
  propertySetupId: string | null;
  propertyId: string | null;
  primaryAudience: PrimaryAudience;
  secondaryAudiences: PrimaryAudience[];
  confidenceScore: number;
  signals: Record<string, unknown>;
  explanation: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AudiencePricingWeights = {
  weekendWeight: number;
  eventWeight: number;
  weatherWeight: number;
  leadTimeWeight: number;
  seasonalityWeight: number;
  competitorWeight: number;
  supplyWeight: number;
  minStayBias: number;
};

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function text(value: unknown): string { return String(value ?? '').trim(); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }

export function assertAudienceUuid(value: unknown, label = 'ID'): string {
  const id = text(value);
  if (!UUID_RE.test(id)) throw new Error(`${label} указан неверно.`);
  return id;
}

function mapAudienceRow(row: Row): AudienceProfile {
  return {
    id: text(row.id),
    propertySetupId: text(row.property_setup_id) || null,
    propertyId: text(row.property_id) || null,
    primaryAudience: text(row.primary_audience) as PrimaryAudience,
    secondaryAudiences: (Array.isArray(row.secondary_audiences) ? row.secondary_audiences : []).map(text) as PrimaryAudience[],
    confidenceScore: Number(row.confidence_score ?? 0),
    signals: object(row.signals),
    explanation: text(row.explanation) || null,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

const SEASIDE_KEYWORDS = /(?:море|пляж|берег|курорт|сочи|анапа|геленджик|крым|калининград|байкал|озеро|набережн)/iu;
const BUSINESS_KEYWORDS = /(?:делов|бизнес|центр|офис|конференц|экспо|москва|спб|санкт-петербург|казань|екатеринбург|новосибирск)/iu;
const MEDICAL_KEYWORDS = /(?:клиник|больниц|медицин|госпитал|поликлиник|лечени)/iu;
const STUDENT_KEYWORDS = /(?:университет|вуз|студен|кампус|общежити)/iu;
const NIGHTLIFE_KEYWORDS = /(?:клуб|ночн|бар|развлечен)/iu;
const TRANSIT_KEYWORDS = /(?:вокзал|аэропорт|метро|транзит|жд)/iu;
const FAMILY_KEYWORDS = /(?:семь|дет|детск|семейн|парк|зоопарк)/iu;
const REMOTE_KEYWORDS = /(?:wi-?fi|wifi|рабоч|стол|коворкинг|remote)/iu;
const BUDGET_KEYWORDS = /(?:бюджет|эконом|недорог)/iu;
const PREMIUM_KEYWORDS = /(?:премиум|люкс|элит|vip|penthouse|пентхаус)/iu;

type InferenceInput = {
  city: string;
  area: string;
  locationSummary: string;
  propertyType: string;
  capacity: number;
  roomCount: number;
  amenities: string[];
  checkinTime: string;
  checkoutTime: string;
  pricingStrategy: string;
};

function scoreAudience(input: InferenceInput): { audience: PrimaryAudience; score: number; signals: Record<string, unknown> }[] {
  const haystack = [input.city, input.area, input.locationSummary, input.propertyType, ...input.amenities].join(' ').toLowerCase();
  const results: { audience: PrimaryAudience; score: number; signals: Record<string, unknown> }[] = [];

  const add = (audience: PrimaryAudience, score: number, reason: string) => {
    results.push({ audience, score, signals: { reason } });
  };

  if (SEASIDE_KEYWORDS.test(haystack)) add('leisure_seaside', 75, 'Прибрежная или курортная локация');
  if (BUSINESS_KEYWORDS.test(haystack)) add('business_center', 70, 'Деловой центр или крупный город');
  if (MEDICAL_KEYWORDS.test(haystack)) add('medical_travel', 65, 'Близость к медицинским объектам');
  if (STUDENT_KEYWORDS.test(haystack)) add('students', 60, 'Университетская зона');
  if (NIGHTLIFE_KEYWORDS.test(haystack)) add('nightlife', 55, 'Развлекательная зона');
  if (TRANSIT_KEYWORDS.test(haystack)) add('transit', 55, 'Транспортный узел');
  if (FAMILY_KEYWORDS.test(haystack) || input.capacity >= 4) add('family_vacation', 50, 'Подходит для семейного отдыха');
  if (REMOTE_KEYWORDS.test(haystack) || input.amenities.some((a) => /wi-?fi|wifi|стол|рабоч/i.test(a))) add('remote_work', 50, 'Удобства для удалённой работы');
  if (BUDGET_KEYWORDS.test(haystack)) add('budget', 45, 'Бюджетное позиционирование');
  if (PREMIUM_KEYWORDS.test(haystack) || input.roomCount >= 3) add('premium', 45, 'Премиальные признаки');

  if (input.pricingStrategy === 'event_driven') add('event_visitors', 40, 'Стратегия ориентирована на события');

  const checkinHour = parseInt(input.checkinTime.split(':')[0] ?? '15', 10);
  if (checkinHour <= 14) add('business_center', 20, 'Ранний заезд — деловые гости');

  return results;
}

export async function inferPropertyAudience(propertySetupId: string, metadata?: Record<string, unknown>): Promise<AudienceProfile> {
  const setupId = assertAudienceUuid(propertySetupId, 'propertySetupId');
  const setup = await getPropertySetupById(setupId);
  if (!setup) throw new Error('Профиль объекта не найден.');

  const meta = object(setup.metadata);
  const input: InferenceInput = {
    city: text(setup.addressCity),
    area: text(setup.addressArea),
    locationSummary: text(setup.addressSafeSummary),
    propertyType: text(setup.propertyType),
    capacity: setup.guestCapacity ?? 0,
    roomCount: setup.roomCount ?? 0,
    amenities: strings(meta.amenities),
    checkinTime: text(setup.checkinTime) || '15:00',
    checkoutTime: text(setup.checkoutTime) || '12:00',
    pricingStrategy: text(metadata?.pricing_strategy),
  };

  const scored = scoreAudience(input).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];

  let primaryAudience: PrimaryAudience = 'unknown';
  let confidenceScore = 0;
  let secondaryAudiences: PrimaryAudience[] = [];
  let explanation: string;

  if (!top || top.score < 30) {
    primaryAudience = scored.length >= 2 ? 'mixed' : 'unknown';
    confidenceScore = scored.length >= 2 ? 25 : 10;
    secondaryAudiences = scored.slice(0, 3).map((s) => s.audience);
    explanation = 'Недостаточно данных для уверенного определения аудитории. Уточните локацию, тип объекта и удобства.';
  } else if (second && second.score >= top.score * 0.7) {
    primaryAudience = 'mixed';
    confidenceScore = Math.min(60, Math.round((top.score + second.score) / 2));
    secondaryAudiences = [top.audience, second.audience];
    explanation = `Смешанная аудитория: ${top.signals.reason} и ${second.signals.reason}.`;
  } else {
    primaryAudience = top.audience;
    confidenceScore = Math.min(95, top.score);
    secondaryAudiences = scored.slice(1, 3).map((s) => s.audience);
    explanation = String(top.signals.reason);
  }

  const signals: Record<string, unknown> = {
    inferred_from: { city: input.city, property_type: input.propertyType, capacity: input.capacity },
    scores: scored.map((s) => ({ audience: s.audience, score: s.score })),
    ...safeMetadata(metadata),
  };

  return updatePropertyAudienceProfile(setupId, {
    primaryAudience,
    secondaryAudiences,
    confidenceScore,
    signals,
    explanation,
  }, metadata);
}

function safeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  return metadata ?? {};
}

export async function updatePropertyAudienceProfile(
  propertySetupId: string,
  audiencePayload: Partial<Pick<AudienceProfile, 'primaryAudience' | 'secondaryAudiences' | 'confidenceScore' | 'signals' | 'explanation'>>,
  metadata?: Record<string, unknown>,
): Promise<AudienceProfile> {
  const setupId = assertAudienceUuid(propertySetupId, 'propertySetupId');
  const setup = await getPropertySetupById(setupId);
  if (!setup) throw new Error('Профиль объекта не найден.');

  const primaryAudience = audiencePayload.primaryAudience ?? 'unknown';
  if (!(PRIMARY_AUDIENCES as readonly string[]).includes(primaryAudience)) {
    throw new Error('Недопустимый тип аудитории.');
  }

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('booking_property_audience_profiles')
    .select('*')
    .eq('property_setup_id', setupId)
    .maybeSingle();

  const row = {
    property_setup_id: setupId,
    property_id: setup.propertyId,
    primary_audience: primaryAudience,
    secondary_audiences: audiencePayload.secondaryAudiences ?? [],
    confidence_score: Math.max(0, Math.min(100, audiencePayload.confidenceScore ?? 0)),
    signals: { ...(audiencePayload.signals ?? {}), ...safeMetadata(metadata) },
    explanation: audiencePayload.explanation ?? null,
    updated_at: now,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('booking_property_audience_profiles')
      .update(row)
      .eq('id', text(existing.id))
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить профиль аудитории.');
    return mapAudienceRow(data as Row);
  }

  const { data, error } = await supabase
    .from('booking_property_audience_profiles')
    .insert({ id: randomUUID(), ...row, created_at: now })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать профиль аудитории.');
  return mapAudienceRow(data as Row);
}

export async function getAudienceProfile(propertySetupId: string): Promise<AudienceProfile | null> {
  const setupId = assertAudienceUuid(propertySetupId, 'propertySetupId');
  const { data, error } = await supabase
    .from('booking_property_audience_profiles')
    .select('*')
    .eq('property_setup_id', setupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAudienceRow(data as Row) : null;
}

export async function explainAudienceProfile(propertySetupId: string): Promise<{ profile: AudienceProfile | null; explanation: string }> {
  const profile = await getAudienceProfile(propertySetupId);
  if (!profile) return { profile: null, explanation: 'Профиль аудитории не создан. Запустите определение аудитории.' };

  const audienceLabels: Record<PrimaryAudience, string> = {
    leisure_seaside: 'Отдых у моря / курорт',
    business_center: 'Деловые гости',
    family_vacation: 'Семейный отдых',
    medical_travel: 'Медицинский туризм',
    event_visitors: 'Гости мероприятий',
    students: 'Студенты',
    nightlife: 'Ночная жизнь',
    transit: 'Транзитные гости',
    remote_work: 'Удалённая работа',
    budget: 'Бюджетный сегмент',
    premium: 'Премиум',
    mixed: 'Смешанная аудитория',
    unknown: 'Не определена',
  };

  const label = audienceLabels[profile.primaryAudience] ?? profile.primaryAudience;
  const confidence = profile.confidenceScore < 40
    ? 'низкая уверенность — рекомендуется уточнить данные'
    : profile.confidenceScore < 70
      ? 'средняя уверенность'
      : 'высокая уверенность';

  return {
    profile,
    explanation: `${label}. ${profile.explanation ?? ''} Уверенность: ${profile.confidenceScore}% (${confidence}).`,
  };
}

export function getAudiencePricingWeights(audienceProfile: AudienceProfile | null): AudiencePricingWeights {
  const base: AudiencePricingWeights = {
    weekendWeight: 1,
    eventWeight: 1,
    weatherWeight: 1,
    leadTimeWeight: 1,
    seasonalityWeight: 1,
    competitorWeight: 1,
    supplyWeight: 1,
    minStayBias: 1,
  };
  if (!audienceProfile) return base;

  switch (audienceProfile.primaryAudience) {
    case 'leisure_seaside':
      return { ...base, weekendWeight: 1.3, weatherWeight: 1.4, seasonalityWeight: 1.3, eventWeight: 0.8 };
    case 'business_center':
      return { ...base, weekendWeight: 0.7, eventWeight: 1.3, leadTimeWeight: 1.2, weatherWeight: 0.5 };
    case 'family_vacation':
      return { ...base, weekendWeight: 1.2, seasonalityWeight: 1.2, minStayBias: 1.3 };
    case 'medical_travel':
      return { ...base, leadTimeWeight: 0.8, seasonalityWeight: 0.7, minStayBias: 1.5, competitorWeight: 0.8 };
    case 'event_visitors':
      return { ...base, eventWeight: 1.5, leadTimeWeight: 1.3, weekendWeight: 1.1 };
    case 'remote_work':
      return { ...base, weekendWeight: 0.9, minStayBias: 1.4, leadTimeWeight: 0.9 };
    case 'budget':
      return { ...base, competitorWeight: 1.2, supplyWeight: 1.1 };
    case 'premium':
      return { ...base, competitorWeight: 0.9, supplyWeight: 0.8, seasonalityWeight: 1.1 };
    case 'mixed':
    case 'unknown':
      return { ...base, weekendWeight: 1, eventWeight: 1, weatherWeight: 0.8 };
    default:
      return base;
  }
}
