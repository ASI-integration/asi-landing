import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { recommendPriceForDate, type AdjustmentReason } from '@/lib/booking-ops/pricing-intelligence-autopilot';
import type { AuthenticatedPartnerPrincipal } from '@/lib/partner-communication/auth';
import type { NightlyRevenueObservation, PartnerRevenueEvent } from './contract';
import { buildShadowRecommendation, classifyDataSufficiency, computeRecommendationConfidence, derivePilotKpis, type ShadowRecommendation } from './intelligence';

type PropertyBinding = { id: string; account_id: string; partner_account_binding_id: string; external_property_id: string; property_id: string; status: string };
type EventRow = { id: string; account_id: string; partner_account_binding_id: string; partner_property_binding_id: string; external_event_id: string; event_type: string; event_fingerprint: string; audit_ref: string; response: PartnerRevenueResponse | null; error_code: string | null; processed_at: string | null; created_at: string };
type ObservationRow = { id: string; public_observation_ref: string; stay_date: string; current_price: number | string; available_inventory: number; sold_inventory: number; realized_room_revenue: number | string; booking_lead_days: number | null; bookings_created: number | null; cancellations: number | null; min_stay: number | null; closed_to_arrival: boolean | null; currency: string; source: 'partner_supplied' | 'synthetic_demo'; observed_at: string };
type PricingProfileRow = { id: string; property_setup_id: string | null; property_id: string | null; status: string; pricing_strategy: string; base_price: number | string | null; min_price: number | string | null; max_price: number | string | null; currency: string; guardrails: Record<string, unknown> };
type MarketSignalRow = { source: string; confidence_score: number; updated_at: string };
type RecommendationRow = { id: string; public_recommendation_ref: string; stay_date: string; current_price: number | string; recommended_price: number | string; confidence: number | string; confidence_band: 'low' | 'medium' | 'high'; strategy: string; reason_codes: string[]; adjustment_reasons: AdjustmentReason[] };
type FeedbackRow = { id: string; status: 'accepted' | 'rejected' | 'ignored'; reason_code: string | null; recorded_at: string };
type Insert<T> = { row: T | null; conflict: boolean };

export type ObservationResponse = Readonly<{ schemaVersion: 'partner.revenue.response.v1'; accepted: true; duplicate: boolean; auditRef: string; observationRef: string; status: 'recorded' }>;
export type ShadowResponse = Readonly<{ schemaVersion: 'partner.revenue.response.v1'; accepted: true; duplicate: boolean; auditRef: string; property: Readonly<{ propertyId: string }>; recommendations: readonly ShadowRecommendation[]; summary: Readonly<{
  coverage: number; averageConfidence: number | null;
  pilotBaseline: Readonly<{ observationCount: number; actualOccupancy: number | null; actualADR: number | null; actualRevPAR: number | null; averageCurrentPrice: number | null; averageBookingLeadTime: number | null; cancellationRate: number | null; confidenceDistribution: Readonly<{ low: number; medium: number; high: number }>; dataSufficiency: 'insufficient' | 'limited' | 'usable' | 'strong'; missingData: readonly string[]; }>;
  counterfactual: Readonly<{ provenRevenueUplift: null; status: 'NOT_PROVEN' }>;
}>; mode: 'shadow' }>;
export type FeedbackResponse = Readonly<{ schemaVersion: 'partner.revenue.response.v1'; accepted: true; duplicate: boolean; auditRef: string; recommendationRef: string; feedback: Readonly<{ status: 'accepted' | 'rejected' | 'ignored'; reasonCode: string | null; recordedAt: string }>; priceChanged: false }>;
export type PartnerRevenueResponse = ObservationResponse | ShadowResponse | FeedbackResponse;

export class PartnerRevenueError extends Error {
  constructor(readonly code: 'partner_event_conflict' | 'partner_revenue_scope_invalid' | 'pricing_not_ready' | 'observation_not_available' | 'recommendation_not_found' | 'partner_revenue_processing_failed') {
    super(code); this.name = 'PartnerRevenueError';
  }
}

export interface PartnerRevenueDatabase {
  findPropertyBindings(input: { accountId: string; partnerAccountBindingId: string; externalPropertyId: string }): Promise<PropertyBinding[]>;
  findEvent(input: { partnerAccountBindingId: string; externalEventId: string }): Promise<EventRow | null>;
  insertEvent(row: EventRow): Promise<Insert<EventRow>>;
  completeEvent(input: { eventId: string; accountId: string; response: PartnerRevenueResponse; processedAt: string }): Promise<void>;
  failEvent(input: { eventId: string; accountId: string; errorCode: string; processedAt: string }): Promise<void>;
  saveObservation(input: { event: EventRow; binding: PropertyBinding; observation: NightlyRevenueObservation; occurredAt: string }): Promise<ObservationRow>;
  findObservations(input: { accountId: string; partnerAccountBindingId: string; partnerPropertyBindingId: string; propertyId: string; stayDates?: readonly string[]; limit?: number }): Promise<ObservationRow[]>;
  findPricingProfiles(input: { propertyId: string }): Promise<PricingProfileRow[]>;
  findSignals(input: { propertySetupId: string; stayDates: readonly string[] }): Promise<MarketSignalRow[]>;
  insertRecommendation(row: Record<string, unknown>): Promise<Insert<RecommendationRow>>;
  findRecommendationsForEvent(eventId: string): Promise<RecommendationRow[]>;
  findRecommendation(input: { accountId: string; partnerAccountBindingId: string; partnerPropertyBindingId: string; recommendationRef: string }): Promise<RecommendationRow | null>;
  insertFeedback(row: Record<string, unknown>): Promise<Insert<FeedbackRow>>;
}

type Dependencies = {
  recommend(profileId: string, stayDate: string): Promise<{ recommendedPrice: number; reasons: AdjustmentReason[] }>;
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const publicRef = (prefix: 'prv' | 'obs' | 'prc') => `${prefix}_${randomBytes(24).toString('base64url')}`;
const number = (value: number | string | null): number | null => value == null ? null : Number(value);
function observation(row: ObservationRow): NightlyRevenueObservation {
  return { stayDate: row.stay_date, currentPrice: Number(row.current_price), availableInventory: row.available_inventory,
    soldInventory: row.sold_inventory, realizedRoomRevenue: Number(row.realized_room_revenue), bookingLeadDays: row.booking_lead_days,
    bookingsCreated: row.bookings_created, cancellations: row.cancellations, minStay: row.min_stay,
    closedToArrival: row.closed_to_arrival, currency: row.currency, source: row.source };
}
function replay(response: PartnerRevenueResponse): PartnerRevenueResponse { return Object.freeze({ ...response, duplicate: true }); }
async function waitForEvent(database: PartnerRevenueDatabase, identity: { partnerAccountBindingId: string; externalEventId: string }) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await database.findEvent(identity);
    if (row?.response || row?.error_code) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}
function throwStored(row: EventRow): never { throw new PartnerRevenueError((row.error_code as PartnerRevenueError['code']) || 'partner_revenue_processing_failed'); }
function profileReady(profile: PricingProfileRow): boolean {
  const base = number(profile.base_price); const min = number(profile.min_price); const max = number(profile.max_price);
  return Boolean(profile.property_setup_id && base != null && base > 0 && min != null && min >= 0 && max != null && max > 0
    && min <= base && base <= max && /^[A-Z]{3}$/u.test(profile.currency) && profile.status !== 'blocked');
}

export function createPartnerRevenueProcessor(database: PartnerRevenueDatabase, dependencies: Dependencies = {
  recommend: async (profileId, stayDate) => recommendPriceForDate(profileId, stayDate),
}) {
  return async function process(principal: AuthenticatedPartnerPrincipal, context: PartnerRevenueEvent): Promise<PartnerRevenueResponse> {
    if (principal.partnerId !== context.partner.partnerId || principal.externalPartnerAccountId !== context.partner.accountId) throw new PartnerRevenueError('partner_revenue_scope_invalid');
    const bindings = await database.findPropertyBindings({ accountId: principal.accountId, partnerAccountBindingId: principal.partnerAccountBindingId, externalPropertyId: context.property.propertyId });
    if (bindings.length !== 1 || bindings[0].status !== 'active' || bindings[0].account_id !== principal.accountId || bindings[0].partner_account_binding_id !== principal.partnerAccountBindingId) throw new PartnerRevenueError('partner_revenue_scope_invalid');
    const binding = bindings[0];
    const identity = { partnerAccountBindingId: principal.partnerAccountBindingId, externalEventId: context.eventId };
    const fingerprint = sha(context);
    const existing = await database.findEvent(identity);
    if (existing) {
      if (existing.event_fingerprint !== fingerprint) throw new PartnerRevenueError('partner_event_conflict');
      if (existing.error_code) throwStored(existing);
      if (existing.response) return replay(existing.response);
      const completed = await waitForEvent(database, identity);
      if (!completed) throw new PartnerRevenueError('partner_revenue_processing_failed');
      if (completed.error_code) throwStored(completed);
      if (!completed.response) throw new PartnerRevenueError('partner_revenue_processing_failed');
      return replay(completed.response);
    }
    const now = new Date().toISOString();
    const event: EventRow = { id: randomUUID(), account_id: principal.accountId, partner_account_binding_id: principal.partnerAccountBindingId,
      partner_property_binding_id: binding.id, external_event_id: context.eventId, event_type: context.eventType,
      event_fingerprint: fingerprint, audit_ref: publicRef('prv'), response: null, error_code: null, processed_at: null, created_at: now };
    const inserted = await database.insertEvent(event);
    if (!inserted.row) {
      if (!inserted.conflict) throw new PartnerRevenueError('partner_revenue_processing_failed');
      const concurrent = await waitForEvent(database, identity);
      if (!concurrent || concurrent.event_fingerprint !== fingerprint) throw new PartnerRevenueError('partner_event_conflict');
      if (concurrent.error_code) throwStored(concurrent);
      if (!concurrent.response) throw new PartnerRevenueError('partner_revenue_processing_failed');
      return replay(concurrent.response);
    }
    try {
      let response: PartnerRevenueResponse;
      if (context.eventType === 'revenue.observation.recorded') {
        const row = await database.saveObservation({ event, binding, observation: context.observation, occurredAt: context.occurredAt });
        response = Object.freeze({ schemaVersion: 'partner.revenue.response.v1', accepted: true, duplicate: false, auditRef: event.audit_ref, observationRef: row.public_observation_ref, status: 'recorded' });
      } else if (context.eventType === 'pricing.shadow.requested') {
        const profiles = await database.findPricingProfiles({ propertyId: binding.property_id });
        if (profiles.length !== 1 || !profileReady(profiles[0])) throw new PartnerRevenueError('pricing_not_ready');
        const profile = profiles[0];
        const observationScope = { accountId: principal.accountId, partnerAccountBindingId: principal.partnerAccountBindingId, partnerPropertyBindingId: binding.id, propertyId: binding.property_id };
        const observations = await database.findObservations({ ...observationScope, stayDates: context.request.stayDates });
        const byDate = new Map(observations.map((row) => [row.stay_date, row]));
        if (!observations.length) throw new PartnerRevenueError('observation_not_available');
        if (observations.some((row) => row.currency !== profile.currency)) throw new PartnerRevenueError('pricing_not_ready');
        const [signals, history] = await Promise.all([
          database.findSignals({ propertySetupId: profile.property_setup_id!, stayDates: context.request.stayDates }),
          database.findObservations({ ...observationScope, limit: 365 }),
        ]);
        for (const stayDate of context.request.stayDates) {
          const observed = byDate.get(stayDate); if (!observed) continue;
          const engine = await dependencies.recommend(profile.id, stayDate);
          const confidence = computeRecommendationConfidence({ profileReady: true, signals: signals.map((signal) => ({ source: signal.source, confidenceScore: signal.confidence_score, updatedAt: signal.updated_at })), observation: observation(observed), historicalSampleSize: history.length });
          const recommendation = buildShadowRecommendation({ recommendationRef: publicRef('prc'), observation: observation(observed), recommendedPrice: engine.recommendedPrice,
            profile: { pricingStrategy: profile.pricing_strategy as never, minPrice: Number(profile.min_price), maxPrice: Number(profile.max_price) }, confidence, adjustmentReasons: engine.reasons });
          const saved = await database.insertRecommendation({ id: randomUUID(), account_id: principal.accountId, partner_account_binding_id: principal.partnerAccountBindingId,
            partner_property_binding_id: binding.id, property_id: binding.property_id, pricing_profile_id: profile.id, source_event_id: event.id, observation_id: observed.id,
            public_recommendation_ref: recommendation.recommendationRef, stay_date: stayDate, current_price: recommendation.currentPrice,
            recommended_price: recommendation.recommendedPrice, confidence: recommendation.confidence, confidence_band: recommendation.confidenceBand,
            strategy: recommendation.strategy, reason_codes: recommendation.reasonCodes, adjustment_reasons: recommendation.adjustmentReasons, mode: 'shadow', created_at: now });
          if (!saved.row && !saved.conflict) throw new PartnerRevenueError('partner_revenue_processing_failed');
        }
        const stored = await database.findRecommendationsForEvent(event.id);
        const recommendations = stored.map((row): ShadowRecommendation => {
          const currentPrice = Number(row.current_price); const recommendedPrice = Number(row.recommended_price); const delta = recommendedPrice - currentPrice;
          return Object.freeze({ recommendationRef: row.public_recommendation_ref, stayDate: row.stay_date, currentPrice, recommendedPrice,
            changeAmount: delta, changePercent: currentPrice > 0 ? Number((delta / currentPrice).toFixed(4)) : null, confidence: Number(row.confidence),
            confidenceBand: row.confidence_band, strategy: row.strategy, reasonCodes: Object.freeze(row.reason_codes), adjustmentReasons: Object.freeze(row.adjustment_reasons),
            guardrails: Object.freeze({ minPrice: Number(profile.min_price), maxPrice: Number(profile.max_price) }), mode: 'shadow' });
        });
        const observedValues = observations.map(observation);
        const pilot = derivePilotKpis({ observations: observedValues, recommendations });
        const sufficiency = classifyDataSufficiency(observedValues);
        response = Object.freeze({ schemaVersion: 'partner.revenue.response.v1', accepted: true, duplicate: false, auditRef: event.audit_ref,
          property: Object.freeze({ propertyId: context.property.propertyId }), recommendations: Object.freeze(recommendations),
          summary: Object.freeze({ coverage: recommendations.length / context.request.stayDates.length, averageConfidence: pilot.averageConfidence,
            pilotBaseline: Object.freeze({ observationCount: pilot.observationCount, actualOccupancy: pilot.actualOccupancy, actualADR: pilot.actualADR,
              actualRevPAR: pilot.actualRevPAR, averageCurrentPrice: pilot.averageCurrentPrice, averageBookingLeadTime: pilot.averageBookingLeadTime,
              cancellationRate: pilot.cancellationRate, confidenceDistribution: pilot.confidenceDistribution, dataSufficiency: sufficiency.level, missingData: sufficiency.missing }),
            counterfactual: Object.freeze({ provenRevenueUplift: null, status: 'NOT_PROVEN' }) }), mode: 'shadow' });
      } else {
        const recommendation = await database.findRecommendation({ accountId: principal.accountId, partnerAccountBindingId: principal.partnerAccountBindingId, partnerPropertyBindingId: binding.id, recommendationRef: context.feedback.recommendationRef });
        if (!recommendation) throw new PartnerRevenueError('recommendation_not_found');
        const recordedAt = context.occurredAt;
        const stored = await database.insertFeedback({ id: randomUUID(), account_id: principal.accountId, partner_account_binding_id: principal.partnerAccountBindingId,
          partner_property_binding_id: binding.id, recommendation_id: recommendation.id, source_event_id: event.id, status: context.feedback.status,
          reason_code: context.feedback.reasonCode, recorded_at: recordedAt, created_at: now });
        if (!stored.row) throw new PartnerRevenueError('partner_revenue_processing_failed');
        response = Object.freeze({ schemaVersion: 'partner.revenue.response.v1', accepted: true, duplicate: false, auditRef: event.audit_ref,
          recommendationRef: context.feedback.recommendationRef, feedback: Object.freeze({ status: context.feedback.status, reasonCode: context.feedback.reasonCode, recordedAt }), priceChanged: false });
      }
      await database.completeEvent({ eventId: event.id, accountId: principal.accountId, response, processedAt: now });
      return response;
    } catch (error) {
      const code = error instanceof PartnerRevenueError ? error.code : 'partner_revenue_processing_failed';
      await database.failEvent({ eventId: event.id, accountId: principal.accountId, errorCode: code, processedAt: now }).catch(() => undefined);
      throw error instanceof PartnerRevenueError ? error : new PartnerRevenueError(code);
    }
  };
}

const conflict = (error: { code?: string } | null) => error?.code === '23505';
function persistence(): never { throw new PartnerRevenueError('partner_revenue_processing_failed'); }
export function createSupabasePartnerRevenueDatabase(client: SupabaseClient): PartnerRevenueDatabase {
  return {
    async findPropertyBindings(input) { const { data, error } = await client.from('partner_property_bindings').select('*').eq('account_id', input.accountId).eq('partner_account_binding_id', input.partnerAccountBindingId).eq('external_property_id', input.externalPropertyId).limit(2); if (error) persistence(); return (data ?? []) as PropertyBinding[]; },
    async findEvent(input) { const { data, error } = await client.from('partner_revenue_events').select('*').eq('partner_account_binding_id', input.partnerAccountBindingId).eq('external_event_id', input.externalEventId).maybeSingle(); if (error) persistence(); return data as EventRow | null; },
    async insertEvent(row) { const { data, error } = await client.from('partner_revenue_events').insert(row).select('*').maybeSingle(); if (error && !conflict(error)) persistence(); return { row: data as EventRow | null, conflict: conflict(error) }; },
    async completeEvent(input) { const { data, error } = await client.from('partner_revenue_events').update({ response: input.response, processed_at: input.processedAt }).eq('account_id', input.accountId).eq('id', input.eventId).is('processed_at', null).select('id').maybeSingle(); if (error || !data) persistence(); },
    async failEvent(input) { const { error } = await client.from('partner_revenue_events').update({ error_code: input.errorCode, processed_at: input.processedAt }).eq('account_id', input.accountId).eq('id', input.eventId).is('processed_at', null); if (error) persistence(); },
    async saveObservation(input) {
      const base = { account_id: input.event.account_id, partner_account_binding_id: input.event.partner_account_binding_id, partner_property_binding_id: input.binding.id, property_id: input.binding.property_id,
        source_event_id: input.event.id, stay_date: input.observation.stayDate, current_price: input.observation.currentPrice, available_inventory: input.observation.availableInventory,
        sold_inventory: input.observation.soldInventory, realized_room_revenue: input.observation.realizedRoomRevenue, booking_lead_days: input.observation.bookingLeadDays,
        bookings_created: input.observation.bookingsCreated, cancellations: input.observation.cancellations, min_stay: input.observation.minStay,
        closed_to_arrival: input.observation.closedToArrival, currency: input.observation.currency, source: input.observation.source, observed_at: input.occurredAt, updated_at: new Date().toISOString() };
      const { data: current, error: findError } = await client.from('partner_revenue_observations').select('id,public_observation_ref').eq('account_id', input.event.account_id).eq('partner_account_binding_id', input.event.partner_account_binding_id).eq('partner_property_binding_id', input.binding.id).eq('property_id', input.binding.property_id).eq('stay_date', input.observation.stayDate).eq('source', input.observation.source).maybeSingle(); if (findError) persistence();
      const query = current ? client.from('partner_revenue_observations').update(base).eq('account_id', input.event.account_id).eq('partner_account_binding_id', input.event.partner_account_binding_id).eq('partner_property_binding_id', input.binding.id).eq('property_id', input.binding.property_id).eq('id', current.id) : client.from('partner_revenue_observations').insert({ ...base, id: randomUUID(), public_observation_ref: publicRef('obs'), created_at: new Date().toISOString() });
      const { data, error } = await query.select('*').single(); if (error || !data) persistence(); return data as ObservationRow;
    },
    async findObservations(input) { let query = client.from('partner_revenue_observations').select('*').eq('account_id', input.accountId).eq('partner_account_binding_id', input.partnerAccountBindingId).eq('partner_property_binding_id', input.partnerPropertyBindingId).eq('property_id', input.propertyId).order('stay_date', { ascending: true }).limit(input.limit ?? 90); if (input.stayDates) query = query.in('stay_date', [...input.stayDates]); const { data, error } = await query; if (error) persistence(); return (data ?? []) as ObservationRow[]; },
    async findPricingProfiles(input) { const { data, error } = await client.from('booking_pricing_profiles').select('id,property_setup_id,property_id,status,pricing_strategy,base_price,min_price,max_price,currency,guardrails').eq('property_id', input.propertyId).limit(2); if (error) persistence(); return (data ?? []) as PricingProfileRow[]; },
    async findSignals(input) { const { data, error } = await client.from('booking_pricing_market_signals').select('source,confidence_score,updated_at').eq('property_setup_id', input.propertySetupId).in('signal_date', [...input.stayDates]).limit(1000); if (error) persistence(); return (data ?? []) as MarketSignalRow[]; },
    async insertRecommendation(row) { const { data, error } = await client.from('partner_shadow_pricing_recommendations').insert(row).select('*').maybeSingle(); if (error && !conflict(error)) persistence(); return { row: data as RecommendationRow | null, conflict: conflict(error) }; },
    async findRecommendationsForEvent(eventId) { const { data, error } = await client.from('partner_shadow_pricing_recommendations').select('*').eq('source_event_id', eventId).order('stay_date'); if (error) persistence(); return (data ?? []) as RecommendationRow[]; },
    async findRecommendation(input) { const { data, error } = await client.from('partner_shadow_pricing_recommendations').select('*').eq('account_id', input.accountId).eq('partner_account_binding_id', input.partnerAccountBindingId).eq('partner_property_binding_id', input.partnerPropertyBindingId).eq('public_recommendation_ref', input.recommendationRef).maybeSingle(); if (error) persistence(); return data as RecommendationRow | null; },
    async insertFeedback(row) { const { data, error } = await client.from('partner_pricing_recommendation_feedback').insert(row).select('*').maybeSingle(); if (error && !conflict(error)) persistence(); return { row: data as FeedbackRow | null, conflict: conflict(error) }; },
  };
}

export const processPartnerRevenueEvent = createPartnerRevenueProcessor(createSupabasePartnerRevenueDatabase(supabase));
