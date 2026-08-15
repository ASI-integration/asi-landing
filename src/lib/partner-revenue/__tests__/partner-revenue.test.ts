import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPartnerPrincipal } from '@/lib/partner-communication/auth';
import { SYNTHETIC_APARTMENT_101_OBSERVATIONS, validatePartnerRevenueEvent, type PartnerRevenueEvent } from '../contract';
import { adr, buildShadowRecommendation, classifyDataSufficiency, computeRecommendationConfidence, derivePilotKpis, occupancy, revParEquivalent, runShadowBacktest } from '../intelligence';
import { createPartnerRevenueProcessor, PartnerRevenueError, type PartnerRevenueDatabase } from '../repository';
import { handlePartnerRevenueEvent } from '@/app/api/partner/v1/revenue/events/route';

vi.mock('server-only', () => ({}));

const accountId = '10000000-0000-4000-8000-000000000001';
const propertyId = '30000000-0000-4000-8000-000000000003';
const bindingId = '50000000-0000-4000-8000-000000000007';
const propertyBindingId = '60000000-0000-4000-8000-000000000008';
const profileId = '70000000-0000-4000-8000-000000000009';
const principal = { accountId, partnerId: 'apart-sharing', externalPartnerAccountId: 'portfolio-1', credentialId: 'cred-1', partnerAccountBindingId: bindingId } as unknown as AuthenticatedPartnerPrincipal;
const base = { schemaVersion: 'partner.revenue.v1', eventId: 'evt-1', occurredAt: '2026-08-15T10:00:00Z', partner: { partnerId: 'apart-sharing', accountId: 'portfolio-1' }, property: { propertyId: 'apartment-101' } };
const observationInput = { ...base, eventType: 'revenue.observation.recorded', observation: { stayDate: '2026-08-22', currentPrice: 6000, availableInventory: 1, soldInventory: 1, realizedRoomRevenue: 6000, bookingLeadDays: 14, bookingsCreated: 1, cancellations: 0, minStay: 2, closedToArrival: false, currency: 'RUB' } };
const shadowInput = { ...base, eventId: 'evt-shadow', eventType: 'pricing.shadow.requested', request: { stayDates: ['2026-08-22'] } };

function memoryDatabase(options?: { noBinding?: boolean; noProfile?: boolean; secondTenant?: boolean }) {
  const events: Array<Record<string, any>> = [];
  const observations: Array<Record<string, any>> = [];
  const recommendations: Array<Record<string, any>> = [];
  const feedback: Array<Record<string, any>> = [];
  const db = {
    events, observations, recommendations, feedback,
    async findPropertyBindings(input: Record<string, string>) {
      if (options?.noBinding || input.externalPropertyId !== 'apartment-101') return [];
      return [{ id: options?.secondTenant ? 'other-property-binding' : propertyBindingId, account_id: input.accountId, partner_account_binding_id: input.partnerAccountBindingId, external_property_id: input.externalPropertyId, property_id: options?.secondTenant ? '40000000-0000-4000-8000-000000000004' : propertyId, status: 'active' }];
    },
    async findEvent(input: Record<string, string>) { return events.find((row) => row.partner_account_binding_id === input.partnerAccountBindingId && row.external_event_id === input.externalEventId) ?? null; },
    async insertEvent(row: Record<string, any>) { if (events.some((item) => item.partner_account_binding_id === row.partner_account_binding_id && item.external_event_id === row.external_event_id)) return { row: null, conflict: true }; events.push(row); return { row, conflict: false }; },
    async completeEvent(input: Record<string, any>) { const row = events.find((item) => item.id === input.eventId)!; row.response = input.response; row.processed_at = input.processedAt; },
    async failEvent(input: Record<string, any>) { const row = events.find((item) => item.id === input.eventId)!; row.error_code = input.errorCode; row.processed_at = input.processedAt; },
    async saveObservation(input: Record<string, any>) {
      const current = observations.find((item) => item.partner_account_binding_id === input.event.partner_account_binding_id && item.partner_property_binding_id === input.binding.id && item.stay_date === input.observation.stayDate && item.source === input.observation.source);
      const row = Object.assign(current ?? {}, { id: current?.id ?? `observation-${observations.length}`, account_id: input.event.account_id, partner_account_binding_id: input.event.partner_account_binding_id, partner_property_binding_id: input.binding.id, property_id: input.binding.property_id, public_observation_ref: current?.public_observation_ref ?? `obs_${String.fromCharCode(97 + observations.length).repeat(32)}`, stay_date: input.observation.stayDate, current_price: input.observation.currentPrice, available_inventory: input.observation.availableInventory, sold_inventory: input.observation.soldInventory, realized_room_revenue: input.observation.realizedRoomRevenue, booking_lead_days: input.observation.bookingLeadDays, bookings_created: input.observation.bookingsCreated, cancellations: input.observation.cancellations, min_stay: input.observation.minStay, closed_to_arrival: input.observation.closedToArrival, currency: input.observation.currency, source: input.observation.source, observed_at: input.occurredAt });
      if (!current) observations.push(row); return row;
    },
    async findObservations(input: Record<string, any>) { const rows = observations.filter((row) => row.account_id === input.accountId && row.partner_account_binding_id === input.partnerAccountBindingId && row.partner_property_binding_id === input.partnerPropertyBindingId && row.property_id === input.propertyId && (!input.stayDates || input.stayDates.includes(row.stay_date))); return rows.slice(0, input.limit ?? 90); },
    async findPricingProfiles() { return options?.noProfile ? [] : [{ id: profileId, property_setup_id: '80000000-0000-4000-8000-000000000010', property_id: propertyId, status: 'ready_for_recommendations', pricing_strategy: 'balanced', base_price: 6000, min_price: 5500, max_price: 6500, currency: 'RUB', guardrails: {} }]; },
    async findSignals() { return [{ source: 'internal', confidence_score: 90, updated_at: '2026-08-15T09:00:00Z' }, { source: 'events_provider_placeholder', confidence_score: 100, updated_at: '2026-08-15T09:00:00Z' }]; },
    async insertRecommendation(row: Record<string, any>) { recommendations.push(row); return { row, conflict: false }; },
    async findRecommendationsForEvent(eventId: string) { return recommendations.filter((row) => row.source_event_id === eventId); },
    async findRecommendation(input: Record<string, string>) { return recommendations.find((row) => row.account_id === input.accountId && row.partner_account_binding_id === input.partnerAccountBindingId && row.partner_property_binding_id === input.partnerPropertyBindingId && row.public_recommendation_ref === input.recommendationRef) ?? null; },
    async insertFeedback(row: Record<string, any>) { feedback.push(row); return { row, conflict: false }; },
  };
  return db as unknown as PartnerRevenueDatabase & { events: Array<Record<string, any>>; observations: Array<Record<string, any>>; recommendations: Array<Record<string, any>>; feedback: Array<Record<string, any>> };
}
const engine = { recommend: async () => ({ recommendedPrice: 7000, reasons: [{ factor: 'events', direction: 'up' as const, percent: 10, explanation: 'Synthetic event pressure' }] }) };

describe('Partner Revenue Contract v1', () => {
  it('accepts a strict normalized observation and defaults its real source', () => {
    const event = validatePartnerRevenueEvent(observationInput);
    expect(event.eventType).toBe('revenue.observation.recorded');
    if (event.eventType === 'revenue.observation.recorded') expect(event.observation.source).toBe('partner_supplied');
  });
  it.each([
    [{ ...observationInput, observation: { ...observationInput.observation, soldInventory: 2 } }, 'inventory'],
    [{ ...observationInput, observation: { ...observationInput.observation, currentPrice: -1 } }, 'price'],
  ])('rejects invalid %s math', (value) => expect(() => validatePartnerRevenueEvent(value)).toThrow('partner_contract_invalid'));
});

describe('Partner revenue HTTP boundary', () => {
  it('authenticates before accepting an event and exposes no internal IDs', async () => {
    const request = new Request('http://localhost/api/partner/v1/revenue/events', { method: 'POST', body: JSON.stringify(observationInput) });
    const response = await handlePartnerRevenueEvent(request, { authenticate: async () => principal, process: async () => ({ schemaVersion: 'partner.revenue.response.v1', accepted: true, duplicate: false, auditRef: `prv_${'a'.repeat(32)}`, observationRef: `obs_${'b'.repeat(32)}`, status: 'recorded' }) });
    expect(response.status).toBe(202); const body = await response.json(); expect(body).not.toHaveProperty('accountId'); expect(body).not.toHaveProperty('propertyId');
  });
  it('fails closed for missing authentication and partner identity mismatch', async () => {
    const unauthenticated = await handlePartnerRevenueEvent(new Request('http://localhost', { method: 'POST', body: JSON.stringify(observationInput) }), { authenticate: async () => { throw new Error('database detail'); }, process: async () => { throw new Error('unreachable'); } });
    expect(unauthenticated.status).toBe(401); expect(await unauthenticated.json()).toEqual({ ok: false, error: 'partner_authentication_failed' });
    const mismatch = await handlePartnerRevenueEvent(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...observationInput, partner: { ...observationInput.partner, accountId: 'other' } }) }), { authenticate: async () => principal, process: async () => { throw new Error('unreachable'); } });
    expect(mismatch.status).toBe(403);
  });
});

describe('Partner revenue intelligence', () => {
  it('uses null-safe observed KPI definitions', () => {
    expect(occupancy(3, 4)).toBe(0.75); expect(occupancy(0, 0)).toBeNull();
    expect(adr(9000, 3)).toBe(3000); expect(adr(0, 0)).toBeNull();
    expect(revParEquivalent(9000, 4)).toBe(2250); expect(revParEquivalent(0, 0)).toBeNull();
  });
  it('excludes placeholder evidence and raises confidence for high-quality history', () => {
    const low = computeRecommendationConfidence({ profileReady: true, signals: [{ source: 'events_provider_placeholder', confidenceScore: 100, updatedAt: '2026-08-15T00:00:00Z' }], observation: null, historicalSampleSize: 2, now: new Date('2026-08-15') });
    const high = computeRecommendationConfidence({ profileReady: true, signals: [{ source: 'channel_import', confidenceScore: 95, updatedAt: '2026-08-14T00:00:00Z' }], observation: SYNTHETIC_APARTMENT_101_OBSERVATIONS[20], historicalSampleSize: 90, now: new Date('2026-08-15') });
    expect(low.reasonCodes).toContain('synthetic_or_placeholder_signal_excluded'); expect(high.confidence).toBeGreaterThan(low.confidence); expect(high.confidenceBand).toBe('high');
  });
  it('clamps shadow output to both guardrails and calculates deltas', () => {
    const confidence = { confidence: 0.5, confidenceBand: 'medium' as const, reasonCodes: ['profile_complete'] };
    const common = { recommendationRef: `prc_${'a'.repeat(32)}`, observation: SYNTHETIC_APARTMENT_101_OBSERVATIONS[0], profile: { pricingStrategy: 'balanced' as const, minPrice: 4500, maxPrice: 6000 }, confidence, adjustmentReasons: [] };
    expect(buildShadowRecommendation({ ...common, recommendedPrice: 3000 }).recommendedPrice).toBe(4500);
    const max = buildShadowRecommendation({ ...common, recommendedPrice: 9000 }); expect(max.recommendedPrice).toBe(6000); expect(max.changeAmount).toBe(1000); expect(max.changePercent).toBeCloseTo(1000 / 5000);
  });
  it('classifies bounded data sufficiency and emits no causal uplift', () => {
    expect(classifyDataSufficiency(SYNTHETIC_APARTMENT_101_OBSERVATIONS.slice(0, 10)).level).toBe('insufficient');
    expect(classifyDataSufficiency(SYNTHETIC_APARTMENT_101_OBSERVATIONS).level).toBe('usable');
    const recommendations = SYNTHETIC_APARTMENT_101_OBSERVATIONS.map((item) => ({ stayDate: item.stayDate, currentPrice: item.currentPrice, recommendedPrice: item.currentPrice + 200, confidence: 0.7, confidenceBand: 'medium' as const }));
    const result = runShadowBacktest({ observations: SYNTHETIC_APARTMENT_101_OBSERVATIONS, recommendations });
    expect(result.methodology).toBe('observed_metrics_and_shadow_price_difference'); expect(result.provenRevenueUplift).toBeNull(); expect(result.counterfactualStatus).toBe('NOT_PROVEN'); expect(result.pilotKpis.recommendationCoverage).toBe(1);
  });
  it('derives pilot acceptance and price-direction KPIs without inventing denominators', () => {
    const items = SYNTHETIC_APARTMENT_101_OBSERVATIONS.slice(0, 3);
    const result = derivePilotKpis({ observations: items, recommendations: items.map((item, index) => ({ stayDate: item.stayDate, currentPrice: item.currentPrice, recommendedPrice: item.currentPrice + [-100, 0, 100][index], confidence: 0.6, confidenceBand: 'medium' as const })), feedback: [{ status: 'accepted' }, { status: 'rejected' }, { status: 'ignored' }] });
    expect(result.recommendationAcceptanceRate).toBe(0.5); expect(result.percentRecommendationsUp).toBeCloseTo(1 / 3); expect(result.percentRecommendationsDown).toBeCloseTo(1 / 3); expect(result.percentRecommendationsUnchanged).toBeCloseTo(1 / 3);
  });
  it('keeps the documented 75-night Apartment 101 baseline deterministic', () => {
    const confidence = SYNTHETIC_APARTMENT_101_OBSERVATIONS.map((item) => computeRecommendationConfidence({ profileReady: true,
      signals: [{ source: 'internal', confidenceScore: 90, updatedAt: '2026-08-15T09:00:00Z' }, { source: 'events_provider_placeholder', confidenceScore: 100, updatedAt: '2026-08-15T09:00:00Z' }],
      observation: item, historicalSampleSize: 75, now: new Date('2026-08-15T12:00:00Z') }));
    const result = derivePilotKpis({ observations: SYNTHETIC_APARTMENT_101_OBSERVATIONS, recommendations: SYNTHETIC_APARTMENT_101_OBSERVATIONS.map((item, index) => ({ stayDate: item.stayDate, currentPrice: item.currentPrice, recommendedPrice: item.currentPrice, confidence: confidence[index].confidence, confidenceBand: confidence[index].confidenceBand })) });
    expect(result).toMatchObject({ observationCount: 75, recommendationCoverage: 1, confidenceDistribution: { low: 0, medium: 5, high: 70 } });
    expect(result.actualOccupancy).toBeCloseTo(0.7464788732); expect(result.actualADR).toBeCloseTo(5315.09434); expect(result.actualRevPAR).toBeCloseTo(3967.605634); expect(result.averageConfidence).toBeCloseTo(0.7512);
  });
});

describe('Partner revenue processor', () => {
  it('persists observations with exact replay idempotency and changed replay conflict', async () => {
    const db = memoryDatabase(); const process = createPartnerRevenueProcessor(db, engine);
    const context = validatePartnerRevenueEvent(observationInput); const first = await process(principal, context); const replay = await process(principal, context);
    expect(first.duplicate).toBe(false); expect(replay).toMatchObject({ duplicate: true, auditRef: first.auditRef }); expect(db.observations).toHaveLength(1);
    const changed = validatePartnerRevenueEvent({ ...observationInput, observation: { ...observationInput.observation, currentPrice: 6100 } });
    await expect(process(principal, changed)).rejects.toEqual(new PartnerRevenueError('partner_event_conflict'));
  });
  it('fails closed for missing/cross-tenant property scope', async () => {
    await expect(createPartnerRevenueProcessor(memoryDatabase({ noBinding: true }), engine)(principal, validatePartnerRevenueEvent(observationInput))).rejects.toEqual(new PartnerRevenueError('partner_revenue_scope_invalid'));
    const other = { ...principal, accountId: '20000000-0000-4000-8000-000000000002', partnerAccountBindingId: 'other-binding' } as unknown as AuthenticatedPartnerPrincipal;
    const isolated = memoryDatabase({ secondTenant: true }); const result = await createPartnerRevenueProcessor(isolated, engine)(other, validatePartnerRevenueEvent(observationInput));
    expect(result.accepted).toBe(true); expect(isolated.observations).toHaveLength(1);
  });
  it('isolates equal external event and property IDs by authenticated partner binding', async () => {
    const db = memoryDatabase(); const process = createPartnerRevenueProcessor(db, engine);
    await process(principal, validatePartnerRevenueEvent(observationInput));
    const other = { ...principal, partnerAccountBindingId: '50000000-0000-4000-8000-000000000099' } as unknown as AuthenticatedPartnerPrincipal;
    await process(other, validatePartnerRevenueEvent(observationInput));
    expect(db.events).toHaveLength(2); expect(db.observations).toHaveLength(2);
  });
  it('returns readiness failure instead of inventing a price', async () => {
    const db = memoryDatabase({ noProfile: true }); const process = createPartnerRevenueProcessor(db, engine); await process(principal, validatePartnerRevenueEvent(observationInput));
    await expect(process(principal, validatePartnerRevenueEvent(shadowInput))).rejects.toEqual(new PartnerRevenueError('pricing_not_ready'));
  });
  it('creates durable opaque shadow evidence, replays the same ref, and never marks a price applied', async () => {
    const db = memoryDatabase(); const process = createPartnerRevenueProcessor(db, engine); await process(principal, validatePartnerRevenueEvent(observationInput));
    const context = validatePartnerRevenueEvent(shadowInput); const first = await process(principal, context); const replay = await process(principal, context);
    if (!('recommendations' in first) || !('recommendations' in replay)) throw new Error('expected shadow');
    expect(first.recommendations[0].recommendationRef).toMatch(/^prc_[A-Za-z0-9_-]{32,96}$/); expect(replay.recommendations[0].recommendationRef).toBe(first.recommendations[0].recommendationRef);
    expect(first.recommendations[0]).toMatchObject({ recommendedPrice: 6500, mode: 'shadow' }); expect(first.summary).toMatchObject({ coverage: 1, pilotBaseline: { observationCount: 1, actualOccupancy: 1, actualADR: 6000, actualRevPAR: 6000 }, counterfactual: { provenRevenueUplift: null, status: 'NOT_PROVEN' } });
    expect(first).not.toHaveProperty('pricingProfileId'); expect(JSON.stringify(first)).not.toMatch(/auto.?appl|final_price|ota/i);
  });
  it.each(['accepted', 'rejected', 'ignored'] as const)('persists %s feedback idempotently without changing price', async (status) => {
    const db = memoryDatabase(); const process = createPartnerRevenueProcessor(db, engine); await process(principal, validatePartnerRevenueEvent(observationInput));
    const shadow = await process(principal, validatePartnerRevenueEvent(shadowInput)); if (!('recommendations' in shadow)) throw new Error('expected shadow');
    const input = validatePartnerRevenueEvent({ ...base, eventId: `feedback-${status}`, eventType: 'pricing.recommendation.feedback', feedback: { recommendationRef: shadow.recommendations[0].recommendationRef, status, reasonCode: 'operator_reviewed' } });
    const first = await process(principal, input); const replay = await process(principal, input); expect(first).toMatchObject({ priceChanged: false }); expect(replay.duplicate).toBe(true);
  });
  it('contains no OTA/provider/final-price write path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/partner-revenue/repository.ts'), 'utf8');
    expect(source).not.toMatch(/\.from\(['"]booking_tariff_grid_days['"]\)[\s\S]*?\.(update|upsert|insert)/u);
    expect(source).not.toMatch(/final_price|auto_applied_placeholder|channel.manager.*rate|ota.*write/iu);
  });
});
